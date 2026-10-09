// Turns the many shapes of "Gemini said no" into one small, plain-language failure
// that the UI can show and act on (wait and retry, or stop and tell someone).
//
// Inputs seen in practice:
//  - the Node SDK throws an Error whose message is `got status: 429 Too Many Requests. {json body}`
//  - the extractor (Python SDK) answers with `{ detail: { code: 'GEMINI_ERROR', gemini_status, gemini_state, message, details } }`
//  - fetch/abort failures with no HTTP status at all

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'     // per-minute limit: wait a few seconds and it works again
  | 'AI_QUOTA_EXHAUSTED'  // per-day (or billing) limit: waiting a minute will not help
  | 'AI_OVERLOADED'       // Google's side is busy (503) or had an internal error (500)
  | 'AI_TIMEOUT'
  | 'AI_NETWORK'
  | 'AI_KEY_INVALID'
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_BLOCKED'          // refused by Gemini's safety filters
  | 'AI_TOO_LARGE'
  | 'AI_BAD_REPLY'        // answered, but not in a form we can use
  | 'AI_ERROR';           // anything else

export interface AiFailure {
  code: AiErrorCode;
  message: string;               // plain language, safe to show a teacher
  retry_after_seconds?: number;  // how long Gemini asked us to wait, when it said
  // Trying the same thing again shortly is likely to work
  retryable: boolean;
  // Every other item in a run will fail the same way, so the run should stop
  fatal: boolean;
}

export interface GeminiErrorInput {
  status?: number;     // HTTP status
  state?: string;      // Google's status string, e.g. RESOURCE_EXHAUSTED
  message?: string;
  details?: unknown;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : null;

// Pull the status, state, message and details out of an SDK error (the JSON body is embedded in its message).
export function parseSdkError(err: unknown): GeminiErrorInput {
  const e = asRecord(err);
  const raw = typeof e?.message === 'string' ? e.message : String(err);
  const out: GeminiErrorInput = { message: raw };
  const statusMatch = raw.match(/got status:\s*(\d{3})/);
  if (statusMatch) out.status = Number(statusMatch[1]);
  else if (typeof e?.status === 'number') out.status = e.status;
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      const body = asRecord(JSON.parse(raw.slice(brace)));
      const inner = asRecord(body?.error) ?? body;
      if (inner) {
        if (typeof inner.message === 'string') out.message = inner.message;
        if (typeof inner.status === 'string') out.state = inner.status;
        if (typeof inner.code === 'number' && out.status === undefined) out.status = inner.code;
        if (inner.details !== undefined) out.details = inner.details;
      }
    } catch { /* keep the raw message */ }
  }
  return out;
}

// "27s", "27.3s", "1m" or a number of seconds
function parseDuration(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return undefined;
  const m = v.trim().match(/^([\d.]+)\s*(ms|s|m)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return m[2] === 'ms' ? n / 1000 : m[2] === 'm' ? n * 60 : n;
}

function retryDelaySeconds(input: GeminiErrorInput): number | undefined {
  if (Array.isArray(input.details)) {
    for (const d of input.details) {
      const r = asRecord(d);
      if (r && String(r['@type'] ?? '').endsWith('RetryInfo')) {
        const s = parseDuration(r.retryDelay);
        if (s !== undefined) return Math.ceil(s);
      }
    }
  }
  const m = input.message?.match(/retry in ([\d.]+)\s*(ms|s|m)?/i);
  if (m) {
    const s = parseDuration(`${m[1]}${m[2] ?? 's'}`);
    if (s !== undefined) return Math.ceil(s);
  }
  return undefined;
}

// Does the quota information name a per-day limit?
function isDailyQuota(input: GeminiErrorInput): boolean {
  const blob = `${input.message ?? ''} ${JSON.stringify(input.details ?? '')}`;
  return /PerDay|per day|daily/i.test(blob);
}

export function humanDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(s / 3600);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

export function classifyGemini(input: GeminiErrorInput): AiFailure {
  const { status, state } = input;
  const msg = input.message ?? '';
  const blob = `${msg} ${JSON.stringify(input.details ?? '')}`;

  if (status === 429 || state === 'RESOURCE_EXHAUSTED') {
    const wait = retryDelaySeconds(input);
    if (isDailyQuota(input)) {
      return {
        code: 'AI_QUOTA_EXHAUSTED', retryable: false, fatal: true,
        message: 'The daily Gemini limit for this key has been reached, so no more AI requests can be made until it resets (usually at midnight US Pacific time). '
          + 'A key on a paid, billing-enabled project has much higher limits.',
      };
    }
    return {
      code: 'AI_RATE_LIMITED', retryable: true, fatal: false, retry_after_seconds: wait,
      message: wait !== undefined
        ? `Gemini is receiving requests faster than this key allows. Try again in about ${humanDuration(wait)}.`
        : 'Gemini is receiving requests faster than this key allows. Wait a minute and try again.',
    };
  }
  if (status === 503 || state === 'UNAVAILABLE' || /overloaded/i.test(msg)) {
    return {
      code: 'AI_OVERLOADED', retryable: true, fatal: false,
      message: 'Gemini is busy at the moment. This usually clears within a minute; try again shortly.',
    };
  }
  if (status === 504 || state === 'DEADLINE_EXCEEDED') {
    return { code: 'AI_TIMEOUT', retryable: true, fatal: false, message: 'Gemini took too long to answer. Try again.' };
  }
  if (status !== undefined && status >= 500) {
    return {
      code: 'AI_OVERLOADED', retryable: true, fatal: false,
      message: 'Gemini had a temporary problem on its side. Try again in a moment.',
    };
  }
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(blob) || status === 401) {
    return {
      code: 'AI_KEY_INVALID', retryable: false, fatal: true,
      message: 'The Gemini API key this site uses is not accepted. An administrator needs to replace it.',
    };
  }
  if (status === 403 || state === 'PERMISSION_DENIED') {
    return {
      code: 'AI_KEY_INVALID', retryable: false, fatal: true,
      message: 'Gemini refused this key (permission denied). An administrator needs to check the key and that the Generative Language API is enabled.',
    };
  }
  if (status === 404 || state === 'NOT_FOUND') {
    return {
      code: 'AI_MODEL_UNAVAILABLE', retryable: false, fatal: true,
      message: 'The Gemini model this site uses is no longer available. An administrator needs to change the model.',
    };
  }
  if (/location is not supported/i.test(blob)) {
    return {
      code: 'AI_KEY_INVALID', retryable: false, fatal: true,
      message: 'Gemini is not available from where this server runs. An administrator needs to check the region.',
    };
  }
  if (/payload size|too large|exceeds the (maximum|limit)/i.test(blob)) {
    return {
      code: 'AI_TOO_LARGE', retryable: false, fatal: false,
      message: 'This answer (with its examples) is too large to send to Gemini. Try again without reference examples.',
    };
  }
  if (/safety|blocked|prohibited/i.test(blob)) {
    return {
      code: 'AI_BLOCKED', retryable: false, fatal: false,
      message: 'Gemini declined to read this answer (its safety filter was triggered). Mark this one by hand.',
    };
  }
  return {
    code: 'AI_ERROR', retryable: false, fatal: false,
    message: `Gemini returned an error${status ? ` (${status})` : ''}. ${msg ? msg.slice(0, 200) : 'Try again.'}`.trim(),
  };
}

// Anything thrown while calling Gemini from this process.
export function classifyThrown(err: unknown, timedOut = false): AiFailure {
  if (timedOut) {
    return { code: 'AI_TIMEOUT', retryable: true, fatal: false, message: 'Gemini took too long to answer. Try again.' };
  }
  const input = parseSdkError(err);
  if (input.status === undefined && input.state === undefined) {
    const text = `${input.message ?? ''} ${(err as { cause?: { code?: string } })?.cause?.code ?? ''}`;
    if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(text)) {
      return {
        code: 'AI_NETWORK', retryable: true, fatal: false,
        message: 'The server could not reach Gemini just now (a network hiccup). Try again.',
      };
    }
  }
  return classifyGemini(input);
}

export function notConfigured(): AiFailure {
  return {
    code: 'AI_NOT_CONFIGURED', retryable: false, fatal: true,
    message: 'AI is not set up on this server (no Gemini key configured).',
  };
}

export function badReply(message: string): AiFailure {
  return { code: 'AI_BAD_REPLY', retryable: true, fatal: false, message: `${message}. Trying again usually fixes this.` };
}

// HTTP status to use when a failure ends a request
export function httpStatusFor(f: AiFailure): number {
  switch (f.code) {
    case 'AI_RATE_LIMITED':
    case 'AI_QUOTA_EXHAUSTED': return 429;
    case 'AI_OVERLOADED':
    case 'AI_NETWORK': return 503;
    case 'AI_TIMEOUT': return 504;
    case 'AI_BLOCKED':
    case 'AI_TOO_LARGE': return 422;
    case 'AI_NOT_CONFIGURED': return 503;
    default: return 502;
  }
}

// Body for an API response
export function failureBody(f: AiFailure) {
  return {
    error: f.message,
    code: f.code,
    retryable: f.retryable,
    fatal: f.fatal,
    ...(f.retry_after_seconds !== undefined ? { retry_after_seconds: f.retry_after_seconds } : {}),
  };
}

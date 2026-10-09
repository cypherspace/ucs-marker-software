// Decides what a batch runner does with the results of one step: which items are done,
// which should be tried again after a wait (Gemini busy or rate limited), which have really
// failed, and whether the whole run should stop because every further item would fail too.

export interface StepResult {
  id: string;
  ok: boolean;
  error?: string;
  code?: string;
  retryable?: boolean;
  fatal?: boolean;
  retryAfter?: number; // seconds Gemini asked us to wait
}

export const MAX_ATTEMPTS = 3;
// A longer wait than this (for example a daily limit) is not worth sitting through: stop and say so.
export const MAX_AUTO_WAIT_S = 90;
const BACKOFF_S = [5, 15, 30];

export interface StepOutcome {
  done: string[];
  retry: string[];                           // go back to the front of the queue
  failed: { id: string; error: string }[];   // give up on these
  stop: string | null;                       // stop the whole run with this message
  waitSeconds: number;                       // pause this long before the next step
  rateLimited: boolean;                      // hit a rate limit: slow down afterwards
}

export function decideStep(results: StepResult[], attempts: Record<string, number>): StepOutcome {
  const out: StepOutcome = { done: [], retry: [], failed: [], stop: null, waitSeconds: 0, rateLimited: false };
  for (const r of results) {
    if (r.ok) { out.done.push(r.id); continue; }
    if (r.code === 'AI_RATE_LIMITED') out.rateLimited = true;
    const message = r.error ?? 'Failed';
    if (r.fatal) {
      out.stop ??= message;
      out.retry.push(r.id); // not the item's fault: keep it queued so Resume carries on after the fix
      continue;
    }
    if (r.retryable) {
      if (r.retryAfter !== undefined && r.retryAfter > MAX_AUTO_WAIT_S) {
        out.stop ??= message;
        out.retry.push(r.id);
        continue;
      }
      const tried = (attempts[r.id] ?? 0) + 1;
      attempts[r.id] = tried;
      if (tried >= MAX_ATTEMPTS) { out.failed.push({ id: r.id, error: message }); continue; }
      out.retry.push(r.id);
      out.waitSeconds = Math.max(out.waitSeconds, r.retryAfter ?? BACKOFF_S[Math.min(tried - 1, BACKOFF_S.length - 1)]);
      continue;
    }
    out.failed.push({ id: r.id, error: message });
  }
  if (out.stop) out.waitSeconds = 0;
  return out;
}

// "Gemini is busy… (3), Gemini declined… (1)": the same message is shown once with a count
export function groupErrors(failed: { error: string }[]): { error: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of failed) counts.set(f.error, (counts.get(f.error) ?? 0) + 1);
  return [...counts].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count);
}

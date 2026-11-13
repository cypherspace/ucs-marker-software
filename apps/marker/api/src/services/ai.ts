import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { getClipBytes } from './clipImages.js';
import { humanMarkFor, judgementAnchors, markingAnchors } from './anchors.js';
import type { ClipContext, QuestionContext } from './access.js';
import type { AiMode, AiStrictness } from '@marker/shared-types';
import { badReply, classifyThrown, notConfigured, type AiFailure } from './aiErrors.js';
import { createPacer, QueueTooLong } from './rateLimit.js';
import { matchNumbered } from './aiBatch.js';

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export class AiError extends Error {
  failure: AiFailure;
  constructor(failure: AiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

// Short, automatic retries inside one request for problems that clear on their own. A wait Gemini asks for
// that is longer than this is passed to the browser instead (it shows a countdown and retries).
const MAX_ATTEMPTS = 2;
const MAX_INLINE_WAIT_S = 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function inlineWaitSeconds(f: AiFailure, attempt: number): number | null {
  if (!f.retryable || attempt >= MAX_ATTEMPTS - 1) return null;
  if (f.code === 'AI_RATE_LIMITED') {
    return f.retry_after_seconds !== undefined && f.retry_after_seconds <= MAX_INLINE_WAIT_S ? f.retry_after_seconds + 1 : null;
  }
  if (f.code === 'AI_OVERLOADED' || f.code === 'AI_NETWORK') return attempt === 0 ? 2 : 5;
  return null;
}

const MODEL_TIMEOUT_MS = 90_000;

// Every Gemini call (including retries) takes its turn here. A queue longer than 2 minutes is not held in
// one request (Cloud Run allows 300 s): the browser is told to wait instead, and tries again.
const pacer = createPacer({ rpm: config.geminiMaxRpm, maxWaitMs: 120_000 });

const image = (buf: Buffer): Part => ({ inlineData: { mimeType: 'image/png', data: buf.toString('base64') } });
const text = (t: string): Part => ({ text: t });

// ── Model call ─────────────────────────────────────────────────────────────
// `seeds` has one entry per answer in the request (it only drives the stub's fake output)
interface ModelRequest { kind: 'mark' | 'judge'; seeds: string[]; maxMarks?: number; parts: Part[] }

function stubResponse(req: ModelRequest): string {
  const results = req.seeds.map((seed, i) => {
    const h = createHash('sha256').update(seed).digest();
    if (req.kind === 'judge') {
      return { n: i + 1, winner: h[0] % 2 === 0 ? 'A' : 'B', reasoning: 'Stub reasoning (AI_STUB)' };
    }
    return {
      n: i + 1,
      marks: h[0] % ((req.maxMarks ?? 1) + 1),
      reasoning: 'Stub reasoning (AI_STUB)',
      feedback: 'Stub feedback (AI_STUB)',
    };
  });
  return JSON.stringify({ results });
}

async function callModelOnce(req: ModelRequest): Promise<string> {
  try {
    await pacer.acquire();
  } catch (err) {
    if (!(err instanceof QueueTooLong)) throw err;
    throw new AiError({
      code: 'AI_RATE_LIMITED', retryable: true, fatal: false, retry_after_seconds: err.waitSeconds,
      message: `Other Gemini requests are queued ahead of this one. Try again in about ${err.waitSeconds} seconds.`,
    });
  }
  const ai = new GoogleGenAI({ apiKey: config.googleApiKey, ...(config.geminiBaseUrl ? { httpOptions: { baseUrl: config.geminiBaseUrl } } : {}) });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: 'user', parts: req.parts }],
      config: { responseMimeType: 'application/json', temperature: 0.2, abortSignal: abort.signal },
    });
    const out = response.text ?? '';
    if (!out) {
      const block = response.promptFeedback?.blockReason;
      if (block) throw new AiError(classifyThrown(new Error(`blocked: ${block}`)));
    }
    return out;
  } catch (err) {
    if (err instanceof AiError) throw err;
    const failure = classifyThrown(err, abort.signal.aborted);
    console.error(`Gemini call failed [${failure.code}]:`, (err as Error).message?.slice(0, 500));
    throw new AiError(failure);
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(req: ModelRequest): Promise<string> {
  if (config.aiStub) return stubResponse(req);
  if (!config.googleApiKey) throw new AiError(notConfigured());
  for (let attempt = 0; ; attempt++) {
    try {
      return await callModelOnce(req);
    } catch (err) {
      const wait = err instanceof AiError ? inlineWaitSeconds(err.failure, attempt) : null;
      if (wait === null) throw err;
      await sleep(wait * 1000);
    }
  }
}

// What to tell the browser about any error thrown while doing AI work for one item.
export function failureOf(err: unknown): AiFailure {
  if (err instanceof AiError) return err.failure;
  return { code: 'AI_ERROR', retryable: false, fatal: false, message: `Something went wrong: ${(err as Error).message}` };
}

export function modelName(): string {
  return config.aiStub ? 'stub' : config.geminiModel;
}

function extractJson(textOut: string): unknown {
  const match = textOut.match(/\{[\s\S]*\}/);
  if (!match) throw new AiError(badReply('Gemini\'s reply did not contain a result'));
  try { return JSON.parse(match[0]); } catch { throw new AiError(badReply('Gemini\'s reply could not be read')); }
}

// One retry if the reply can't be parsed at all (the retry is another request, so only a reply with no readable result gets it).
async function generateJson<T>(req: ModelRequest, schema: z.ZodType<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = schema.safeParse(extractJson(await callModel(req)));
      if (parsed.success) return parsed.data;
      lastErr = new AiError(badReply('Gemini\'s reply was not in the expected format'));
    } catch (err) {
      lastErr = err;
      if (!(err instanceof AiError) || err.failure.code !== 'AI_BAD_REPLY') throw err;
    }
  }
  throw lastErr;
}

// ── Marking ────────────────────────────────────────────────────────────────
const STRICTNESS: Record<AiStrictness, string> = {
  strict: 'Be strict: award a mark only where the mark scheme point is clearly and fully met. Do not give the benefit of the doubt.',
  balanced: 'Follow the mark scheme wording, and use judgement to credit equivalent answers.',
  lenient: 'Be generous: credit work that clearly shows the intended understanding even if it is phrased differently, and give the benefit of the doubt on ambiguous work.',
};

export interface AiMarkOptions {
  mode: AiMode;
  strictness: AiStrictness;
  guidance?: string;
  useExamples: boolean;
}

// One entry per answer, numbered (n) in the order the answers were sent
const MarkReply = z.object({
  results: z.array(z.object({
    n: z.coerce.number(),
    marks: z.coerce.number().optional(),
    reasoning: z.string().default(''),
    feedback: z.string().nullable().optional(),
  })),
});

export type ItemOutcome<T> = ({ ok: true } & T) | { ok: false; failure: AiFailure };

// Mark several answers to ONE question in a single Gemini request. The mark scheme, guidance and reference
// examples are sent once for the whole batch. An answer Gemini skips or garbles fails on its own
// (and is retried by the browser); a failed request fails every answer in it with the same reason.
export async function aiMarkClips(
  clips: ClipContext[], opts: AiMarkOptions,
): Promise<Map<string, ItemOutcome<{ marks_awarded: number | null }>>> {
  const out = new Map<string, ItemOutcome<{ marks_awarded: number | null }>>();
  if (clips.length === 0) return out;
  const q = clips[0];
  const wantMarks = opts.mode !== 'feedback';
  const wantFeedback = opts.mode !== 'marks';
  const lead = q.lead_teacher_id;

  const parts: Part[] = [
    text(`You are an experienced examiner marking anonymous students' handwritten responses to question ${q.question_number}, which is worth ${q.max_marks} marks. `
      + `There ${clips.length === 1 ? 'is 1 response' : `are ${clips.length} responses`} to mark, numbered 1 to ${clips.length}. Mark each one on its own merits, independently of the others. `
      + 'Never mention or guess any student\'s name or identity. Reply only with JSON.'),
  ];
  if (q.ms_clip_image_url) {
    try {
      parts.push(text('MARK SCHEME for this question (image):'), image(await getClipBytes(q.ms_clip_image_url, lead)));
    } catch { /* continue with the guidance text only */ }
  }
  if (opts.guidance?.trim()) parts.push(text(`ADDITIONAL GUIDANCE FROM THE LEAD TEACHER:\n${opts.guidance.trim()}`));
  parts.push(text(STRICTNESS[opts.strictness]));

  if (opts.useExamples) {
    const anchors = await markingAnchors(q.question_id, clips.map((c) => c.clip_id), lead, q.max_marks);
    anchors.forEach((a, i) => {
      parts.push(text(`REFERENCE EXAMPLE ${i + 1}: a teacher awarded the following response ${a.marks} out of ${a.max}.`), image(a.image));
    });
  }

  const unreadable: string[] = [];
  const sent: ClipContext[] = [];
  for (const clip of clips) {
    try {
      const bytes = await getClipBytes(clip.clip_image_url, lead);
      sent.push(clip);
      parts.push(text(`RESPONSE ${sent.length}:`), image(bytes));
    } catch (err) {
      unreadable.push(clip.clip_id);
      out.set(clip.clip_id, { ok: false, failure: { code: 'AI_ERROR', retryable: false, fatal: false, message: `Could not read this clip: ${(err as Error).message}` } });
    }
  }
  if (sent.length === 0) return out;
  if (unreadable.length) parts[0] = text(`${(parts[0] as { text: string }).text} (Responses are numbered 1 to ${sent.length}.)`);

  const fields = [
    '"n": <the response number>',
    wantMarks ? `"marks": <whole number from 0 to ${q.max_marks}>` : null,
    '"reasoning": "<which mark points were met or missed>"',
    wantFeedback ? '"feedback": "<constructive, specific feedback written to the student>"' : null,
  ].filter(Boolean).join(', ');
  parts.push(text(`Reply as JSON with one entry per response, in order: {"results": [{${fields}}, ...]}`));

  let reply;
  try {
    reply = await generateJson({ kind: 'mark', seeds: sent.map((c) => c.clip_id), maxMarks: q.max_marks, parts }, MarkReply);
  } catch (err) {
    const failure = err instanceof AiError ? err.failure : { code: 'AI_ERROR' as const, retryable: false, fatal: false, message: (err as Error).message };
    for (const c of sent) out.set(c.clip_id, { ok: false, failure });
    return out;
  }

  const matched = matchNumbered(sent.length, reply.results);
  for (let i = 0; i < sent.length; i++) {
    const clip = sent[i];
    const r = matched[i];
    if (!r || (wantMarks && r.marks === undefined)) {
      out.set(clip.clip_id, { ok: false, failure: badReply('Gemini did not return a mark for this answer') });
      continue;
    }
    const marks = wantMarks ? Math.min(clip.max_marks, Math.max(0, Math.round(Number.isFinite(r.marks) ? r.marks! : 0))) : null;
    const fieldsToSave = {
      ai_reasoning: r.reasoning,
      ai_model: modelName(),
      status: 'marked' as const,
      ...(wantMarks ? { marks_awarded: marks } : {}),
      ...(wantFeedback ? { ai_feedback: r.feedback ?? null } : {}),
    };
    const existing = await db('script_marks').where({ clip_id: clip.clip_id, mark_source: 'ai' }).first('id');
    if (existing) {
      await db('script_marks').where({ id: existing.id }).update({ ...fieldsToSave, marked_at: db.fn.now() });
    } else {
      await db('script_marks').insert({
        clip_id: clip.clip_id, marker_id: null, mark_source: 'ai', marked_at: db.fn.now(), ...fieldsToSave,
      });
    }
    out.set(clip.clip_id, { ok: true, marks_awarded: marks });
  }
  return out;
}

// ── Judging pairs ──────────────────────────────────────────────────────────
const JudgeReply = z.object({
  results: z.array(z.object({
    n: z.coerce.number(),
    winner: z.string().transform((w) => w.trim().toUpperCase().charAt(0)).pipe(z.enum(['A', 'B'])),
    reasoning: z.string().default(''),
  })),
});

type PairRef = { id: string; clip_a_id: string; clip_b_id: string };

// Judge several pairs of one question in a single Gemini request (mark scheme, guidance and reference
// comparisons sent once). Same failure rules as aiMarkClips. A pair somebody else judged first is an
// ordinary success with no AI row written.
export async function aiJudgePairs(
  pairs: PairRef[], question: QuestionContext, opts: { guidance?: string; useExamples: boolean },
): Promise<Map<string, ItemOutcome<object>>> {
  const out = new Map<string, ItemOutcome<object>>();
  if (pairs.length === 0) return out;
  const lead = question.lead_teacher_id;
  const clipIds = [...new Set(pairs.flatMap((p) => [p.clip_a_id, p.clip_b_id]))];
  const clipRows = await db('script_clips').whereIn('id', clipIds).select<{ id: string; clip_image_url: string }[]>('id', 'clip_image_url');
  const urlOf = new Map(clipRows.map((c) => [c.id, c.clip_image_url]));

  const parts: Part[] = [
    text('You are an experienced examiner. For each numbered comparison below, decide which of two anonymous student responses to '
      + `question ${question.question_number} (worth ${question.max_marks} marks) is the better response (against the mark scheme when one is provided, otherwise on overall quality). `
      + 'Judge each comparison independently. Never mention or guess any student\'s identity. Reply only with JSON.'),
  ];
  if (question.ms_clip_image_url) {
    try {
      parts.push(text('MARK SCHEME for this question (image):'), image(await getClipBytes(question.ms_clip_image_url, lead)));
    } catch { /* guidance only */ }
  }
  if (opts.guidance?.trim()) parts.push(text(`ADDITIONAL GUIDANCE FROM THE LEAD TEACHER:\n${opts.guidance.trim()}`));

  if (opts.useExamples) {
    const examples = await judgementAnchors(question.question_id, pairs.map((p) => p.id), lead);
    examples.forEach((e, i) => {
      parts.push(
        text(`REFERENCE COMPARISON ${i + 1}. Response A:`), image(e.imageA),
        text('Response B:'), image(e.imageB),
        text(`A teacher judged that Response ${e.winner} was the better response.`),
      );
    });
  }

  const sent: PairRef[] = [];
  for (const pair of pairs) {
    const ua = urlOf.get(pair.clip_a_id);
    const ub = urlOf.get(pair.clip_b_id);
    if (!ua || !ub) {
      out.set(pair.id, { ok: false, failure: { code: 'AI_ERROR', retryable: false, fatal: false, message: 'A script in this pair no longer exists' } });
      continue;
    }
    try {
      const [ia, ib] = [await getClipBytes(ua, lead), await getClipBytes(ub, lead)];
      const [markA, markB] = await Promise.all([humanMarkFor(pair.clip_a_id), humanMarkFor(pair.clip_b_id)]);
      sent.push(pair);
      parts.push(text(`COMPARISON ${sent.length}. Response A:`), image(ia), text('Response B:'), image(ib));
      if (markA !== null || markB !== null) {
        parts.push(text(`For reference, teachers have already marked: Response A ${markA ?? 'not marked'}${markA !== null ? ` out of ${question.max_marks}` : ''}; Response B ${markB ?? 'not marked'}${markB !== null ? ` out of ${question.max_marks}` : ''}.`));
      }
    } catch (err) {
      out.set(pair.id, { ok: false, failure: { code: 'AI_ERROR', retryable: false, fatal: false, message: `Could not read a clip in this pair: ${(err as Error).message}` } });
    }
  }
  if (sent.length === 0) return out;
  parts.push(text('You must choose one in every comparison. Reply as JSON: {"results": [{"n": <comparison number>, "winner": "A" or "B", "reasoning": "<why>"}, ...]}'));

  let reply;
  try {
    reply = await generateJson({ kind: 'judge', seeds: sent.map((p) => p.id), parts }, JudgeReply);
  } catch (err) {
    const failure = err instanceof AiError ? err.failure : { code: 'AI_ERROR' as const, retryable: false, fatal: false, message: (err as Error).message };
    for (const p of sent) out.set(p.id, { ok: false, failure });
    return out;
  }

  const matched = matchNumbered(sent.length, reply.results);
  for (let i = 0; i < sent.length; i++) {
    const pair = sent[i];
    const r = matched[i];
    if (!r) { out.set(pair.id, { ok: false, failure: badReply('Gemini did not return a verdict for this pair') }); continue; }
    const winner = r.winner === 'A' ? pair.clip_a_id : pair.clip_b_id;
    try {
      await db('comparative_judgements').insert({
        pair_id: pair.id, source: 'ai', judged_by: null, winner_clip_id: winner, reasoning: r.reasoning,
      });
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err; // another request judged it first: fine
    }
    out.set(pair.id, { ok: true });
  }
  return out;
}

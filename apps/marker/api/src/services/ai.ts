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
const MAX_ATTEMPTS = 3;
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
interface ModelRequest { kind: 'mark' | 'judge'; seed: string; maxMarks?: number; parts: Part[] }

function stubResponse(req: ModelRequest): string {
  const h = createHash('sha256').update(req.seed).digest();
  if (req.kind === 'judge') {
    return JSON.stringify({ winner: h[0] % 2 === 0 ? 'A' : 'B', reasoning: 'Stub reasoning (AI_STUB)' });
  }
  return JSON.stringify({
    marks: h[0] % ((req.maxMarks ?? 1) + 1),
    reasoning: 'Stub reasoning (AI_STUB)',
    feedback: 'Stub feedback (AI_STUB)',
  });
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
  const ai = new GoogleGenAI({ apiKey: config.googleApiKey });
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

// One retry if the reply can't be parsed.
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

const MarkReply = z.object({
  marks: z.coerce.number().optional(),
  reasoning: z.string().default(''),
  feedback: z.string().nullable().optional(),
});

export async function aiMarkClip(clip: ClipContext, opts: AiMarkOptions): Promise<{ marks_awarded: number | null }> {
  const wantMarks = opts.mode !== 'feedback';
  const wantFeedback = opts.mode !== 'marks';
  const lead = clip.lead_teacher_id;

  const parts: Part[] = [
    text(`You are an experienced examiner marking an anonymous student's handwritten response to question ${clip.question_number}, which is worth ${clip.max_marks} marks. Never mention or guess the student's name or identity. Reply only with JSON.`),
  ];
  if (clip.ms_clip_image_url) {
    try {
      parts.push(text('MARK SCHEME for this question (image):'), image(await getClipBytes(clip.ms_clip_image_url, lead)));
    } catch { /* continue with the guidance text only */ }
  }
  if (opts.guidance?.trim()) parts.push(text(`ADDITIONAL GUIDANCE FROM THE LEAD TEACHER:\n${opts.guidance.trim()}`));
  parts.push(text(STRICTNESS[opts.strictness]));

  if (opts.useExamples) {
    const anchors = await markingAnchors(clip.question_id, clip.clip_id, lead, clip.max_marks);
    anchors.forEach((a, i) => {
      parts.push(text(`REFERENCE EXAMPLE ${i + 1}: a teacher awarded the following response ${a.marks} out of ${a.max}.`), image(a.image));
    });
  }

  parts.push(text('NOW MARK THIS RESPONSE:'), image(await getClipBytes(clip.clip_image_url, lead)));
  const fields = [
    wantMarks ? `"marks": <whole number from 0 to ${clip.max_marks}>` : null,
    '"reasoning": "<which mark points were met or missed>"',
    wantFeedback ? '"feedback": "<constructive, specific feedback written to the student>"' : null,
  ].filter(Boolean).join(', ');
  parts.push(text(`Reply as JSON: {${fields}}`));

  const reply = await generateJson({ kind: 'mark', seed: clip.clip_id, maxMarks: clip.max_marks, parts }, MarkReply);
  const marks = wantMarks
    ? Math.min(clip.max_marks, Math.max(0, Math.round(Number.isFinite(reply.marks) ? reply.marks! : 0)))
    : null;
  if (wantMarks && reply.marks === undefined) throw new AiError(badReply('Gemini\'s reply had no mark'));

  const fieldsToSave = {
    ai_reasoning: reply.reasoning,
    ai_model: modelName(),
    status: 'marked' as const,
    ...(wantMarks ? { marks_awarded: marks } : {}),
    ...(wantFeedback ? { ai_feedback: reply.feedback ?? null } : {}),
  };
  const existing = await db('script_marks').where({ clip_id: clip.clip_id, mark_source: 'ai' }).first('id');
  if (existing) {
    await db('script_marks').where({ id: existing.id }).update({ ...fieldsToSave, marked_at: db.fn.now() });
  } else {
    await db('script_marks').insert({
      clip_id: clip.clip_id, marker_id: null, mark_source: 'ai', marked_at: db.fn.now(), ...fieldsToSave,
    });
  }
  return { marks_awarded: marks };
}

// ── Judging a pair ─────────────────────────────────────────────────────────
const JudgeReply = z.object({
  winner: z.string().transform((w) => w.trim().toUpperCase().charAt(0)).pipe(z.enum(['A', 'B'])),
  reasoning: z.string().default(''),
});

export async function aiJudgePair(
  pair: { id: string; clip_a_id: string; clip_b_id: string },
  question: QuestionContext,
  opts: { guidance?: string; useExamples: boolean },
): Promise<{ winner_clip_id: string } | null> {
  const lead = question.lead_teacher_id;
  const clips = await db('script_clips').whereIn('id', [pair.clip_a_id, pair.clip_b_id]).select<{ id: string; clip_image_url: string }[]>('id', 'clip_image_url');
  const a = clips.find((c) => c.id === pair.clip_a_id);
  const b = clips.find((c) => c.id === pair.clip_b_id);
  if (!a || !b) throw new AiError({ code: 'AI_ERROR', retryable: false, fatal: false, message: 'A script in this pair no longer exists' });

  const parts: Part[] = [
    text(`You are an experienced examiner. Compare two anonymous student responses to question ${question.question_number} (worth ${question.max_marks} marks) and decide which is the better response (against the mark scheme when one is provided, otherwise on overall quality). Never mention or guess the students' identities. Reply only with JSON.`),
  ];
  if (question.ms_clip_image_url) {
    try {
      parts.push(text('MARK SCHEME for this question (image):'), image(await getClipBytes(question.ms_clip_image_url, lead)));
    } catch { /* guidance only */ }
  }
  if (opts.guidance?.trim()) parts.push(text(`ADDITIONAL GUIDANCE FROM THE LEAD TEACHER:\n${opts.guidance.trim()}`));

  if (opts.useExamples) {
    const examples = await judgementAnchors(question.question_id, pair.id, lead);
    examples.forEach((e, i) => {
      parts.push(
        text(`REFERENCE COMPARISON ${i + 1}. Response A:`), image(e.imageA),
        text('Response B:'), image(e.imageB),
        text(`A teacher judged that Response ${e.winner} was the better response.`),
      );
    });
  }

  parts.push(text('NOW COMPARE THESE TWO RESPONSES. Response A:'), image(await getClipBytes(a.clip_image_url, lead)));
  parts.push(text('Response B:'), image(await getClipBytes(b.clip_image_url, lead)));
  const [markA, markB] = await Promise.all([humanMarkFor(a.id), humanMarkFor(b.id)]);
  if (markA !== null || markB !== null) {
    parts.push(text(`For reference, teachers have already marked: Response A ${markA ?? 'not marked'}${markA !== null ? ` out of ${question.max_marks}` : ''}; Response B ${markB ?? 'not marked'}${markB !== null ? ` out of ${question.max_marks}` : ''}.`));
  }
  parts.push(text('You must choose one. Reply as JSON: {"winner": "A" or "B", "reasoning": "<why>"}'));

  const reply = await generateJson({ kind: 'judge', seed: pair.id, parts }, JudgeReply);
  const winner = reply.winner === 'A' ? pair.clip_a_id : pair.clip_b_id;
  try {
    await db('comparative_judgements').insert({
      pair_id: pair.id, source: 'ai', judged_by: null, winner_clip_id: winner, reasoning: reply.reasoning,
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return null; // another request judged it first
    throw err;
  }
  return { winner_clip_id: winner };
}

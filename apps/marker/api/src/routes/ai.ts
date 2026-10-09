import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { storage } from '../services/storage.js';
import { fileIdFromUri, getDriveMediaRequest, isDriveUri } from '../services/drive.js';
import { describeExtractorFailure, extractorFetch } from '../services/extractor.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClipAccess, requireQuestionAccess, type ClipContext } from '../services/access.js';
import { aiMarkClip, failureOf, modelName } from '../services/ai.js';
import { classifyGemini, failureBody, httpStatusFor, notConfigured, type GeminiErrorInput } from '../services/aiErrors.js';
import { convertedUrl, renderConvertedPage, saveConvertedImage, stripTextLayer } from '../services/converted.js';
import type { AiPlan, AiResultRow, AiResults, AiStepResult } from '@marker/shared-types';

const router = Router();

const aiConfigured = () => config.aiStub || Boolean(config.googleApiKey);

router.get('/ai/status', requireAuth, (_req, res) => {
  res.json({ data: { configured: aiConfigured(), model: modelName(), max_rpm: config.aiStub ? 0 : config.geminiMaxRpm } });
});

// ── Convert handwriting to text ─────────────────────────────────────────────
// Transcribe a clip's handwriting and render the text as a page image that teachers can annotate.
// Both are saved on the clip, so a clip is converted once: asking again returns what is stored.
// Text that was read earlier but never rendered is rendered without calling Gemini again.
// ?refresh=1 converts again (Gemini and the page image), dropping annotations made on the old page.
router.post('/clips/:id/ocr', requireAuth, async (req, res, next) => {
  try {
    const clip = await requireClipAccess(req, res, req.params.id);
    if (!clip) return;
    const refresh = req.query.refresh === '1';
    const stored = await db('script_clips').where({ id: clip.clip_id }).first<{ text_image_url: string | null }>('text_image_url');

    if (!refresh && clip.ocr_text !== null && stored?.text_image_url) {
      res.json({ data: { ocr_text: clip.ocr_text, converted_url: convertedUrl(clip.clip_id, stored.text_image_url), cached: true } }); return;
    }

    let text: string;
    if (!refresh && clip.ocr_text !== null) {
      text = clip.ocr_text;
    } else {
      if (!aiConfigured()) {
        res.status(503).json({ error: 'Text recognition is not set up (no Gemini key configured).', code: 'AI_NOT_CONFIGURED' }); return;
      }
      if (config.aiStub) {
        text = 'Stub transcription (AI_STUB)';
      } else {
        // The extractor reads local/GCS paths and https URLs; Drive clips need the lead teacher's token, sent as a header.
        const image = isDriveUri(clip.clip_image_url)
          ? await getDriveMediaRequest(clip.lead_teacher_id, fileIdFromUri(clip.clip_image_url))
          : { url: storage.rawUri(clip.clip_image_url), headers: undefined };
        let resp: Response;
        try {
          resp = await extractorFetch('/ocr', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ image_url: image.url, image_headers: image.headers }),
          });
        } catch (err) {
          console.error('OCR: extractor unreachable:', describeExtractorFailure(err));
        res.status(502).json({ error: `The handwriting service could not be reached (${describeExtractorFailure(err)}). Try again in a moment.`, code: 'EXTRACTOR_UNREACHABLE', retryable: true }); return;
        }
        if (!resp.ok) {
          const bodyText = await resp.text();
          console.error(`OCR failed (${resp.status}):`, bodyText.slice(0, 500));
          // The extractor passes Gemini's own error through as structured detail, so it can be explained
          let detail: (GeminiErrorInput & { code?: string; gemini_status?: number; gemini_state?: string }) | undefined;
          try { detail = (JSON.parse(bodyText) as { detail?: typeof detail }).detail; } catch { /* not JSON */ }
          if (detail && typeof detail === 'object' && detail.code === 'GEMINI_NOT_CONFIGURED') {
            const f = notConfigured();
            res.status(httpStatusFor(f)).json(failureBody(f)); return;
          }
          if (detail && typeof detail === 'object' && detail.code === 'GEMINI_ERROR') {
            const f = classifyGemini({ status: detail.gemini_status, state: detail.gemini_state, message: detail.message, details: detail.details });
            res.status(httpStatusFor(f)).json(failureBody(f)); return;
          }
          const why = typeof detail === 'string' ? ` (${String(detail).slice(0, 160)})` : '';
          res.status(502).json({
            error: `Handwriting conversion failed on the server (code ${resp.status})${why}. Try again; if it keeps happening, tell an administrator.`,
            code: 'OCR_ERROR', retryable: true,
          }); return;
        }
        text = ((await resp.json()) as { text: string }).text;
      }
    }

    const rendered = await renderConvertedPage(text);
    if ('fail' in rendered) { res.status(rendered.fail.status).json({ error: rendered.fail.error, code: rendered.fail.code }); return; }
    const uri = await saveConvertedImage({
      clipId: clip.clip_id, questionId: clip.question_id, scriptId: clip.script_id,
      leadTeacherId: clip.lead_teacher_id, examId: clip.exam_id,
    }, rendered.png);

    await db('script_clips').where({ id: clip.clip_id }).update({ ocr_text: text, text_image_url: uri });
    if (refresh) await stripTextLayer([clip.clip_id]);
    res.json({ data: { ocr_text: text, converted_url: convertedUrl(clip.clip_id, uri), cached: false } });
  } catch (err) {
    next(err);
  }
});
// ── AI marking ──────────────────────────────────────────────────────────────
// The browser drives AI runs in small steps: `plan` picks the clips (so the
// teacher sees the count before anything is sent to Gemini), then `step`
// marks up to 3 clips per request. This works on Cloud Run, where background
// work after a response is throttled, and gives visible progress.

const ModeSchema = z.enum(['marks', 'feedback', 'both']);
const ScopeSchema = z.object({
  type: z.enum(['unmarked', 'sample', 'human_marked', 'all']),
  count: z.number().int().min(1).max(500).optional(),
});

router.post('/exams/:id/ai-mark/plan', requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ question_id: z.string().uuid(), scope: ScopeSchema, mode: ModeSchema }).parse(req.body);
    const question = await requireQuestionAccess(req, res, body.question_id, { leadOnly: true, examId: req.params.id });
    if (!question) return;
    if (!aiConfigured()) {
      res.status(503).json({ error: 'AI marking is not set up (no Gemini key configured).', code: 'AI_NOT_CONFIGURED' }); return;
    }

    const needsMarks = body.mode !== 'feedback';
    const needsFeedback = body.mode !== 'marks';
    const q = db('script_clips as sc')
      .leftJoin('script_marks as ai', function () { this.on('ai.clip_id', 'sc.id').andOnVal('ai.mark_source', 'ai'); })
      .where('sc.question_id', body.question_id)
      .select('sc.id');

    const missing = () => q.where((w) => {
      w.whereNull('ai.id');
      if (needsMarks) w.orWhereNull('ai.marks_awarded');
      if (needsFeedback) w.orWhereNull('ai.ai_feedback');
    });
    switch (body.scope.type) {
      case 'unmarked': missing().orderBy('sc.created_at'); break;
      case 'sample': missing().orderByRaw('random()').limit(body.scope.count ?? 10); break;
      case 'human_marked':
        q.whereExists(function () {
          this.select(db.raw('1')).from('script_marks as hm')
            .whereRaw('hm.clip_id = sc.id').andWhere('hm.mark_source', 'human').andWhereNot('hm.status', 'pending');
        }).orderBy('sc.created_at');
        break;
      case 'all': q.orderBy('sc.created_at'); break;
    }
    const rows = await q;
    const plan: AiPlan = {
      clip_ids: rows.map((r: { id: string }) => r.id),
      total: rows.length,
      has_mark_scheme: Boolean(question.ms_clip_image_url),
    };
    res.json({ data: plan });
  } catch (err) {
    next(err);
  }
});

router.post('/exams/:id/ai-mark/step', requireAuth, async (req, res, next) => {
  try {
    const body = z.object({
      question_id: z.string().uuid(),
      clip_ids: z.array(z.string().uuid()).min(1).max(3),
      mode: ModeSchema,
      strictness: z.enum(['strict', 'balanced', 'lenient']).default('balanced'),
      guidance: z.string().max(4000).optional(),
      use_examples: z.boolean().default(false),
    }).parse(req.body);
    const question = await requireQuestionAccess(req, res, body.question_id, { leadOnly: true, examId: req.params.id });
    if (!question) return;
    if (!aiConfigured()) {
      res.status(503).json({ error: 'AI marking is not set up (no Gemini key configured).', code: 'AI_NOT_CONFIGURED' }); return;
    }
    if (!question.ms_clip_image_url && !body.guidance?.trim()) {
      res.status(422).json({ error: 'Give the AI a mark scheme: draw a mark-scheme region for this question, or add marking guidance.', code: 'NO_MARK_SCHEME' }); return;
    }

    const clips = await db('script_clips').whereIn('id', body.clip_ids).andWhere({ question_id: body.question_id })
      .select<{ id: string; script_id: string; clip_image_url: string; ocr_text: string | null }[]>('id', 'script_id', 'clip_image_url', 'ocr_text');
    const byId = new Map(clips.map((c) => [c.id, c]));

    const results: AiStepResult[] = await Promise.all(body.clip_ids.map(async (clipId): Promise<AiStepResult> => {
      const row = byId.get(clipId);
      if (!row) return { clip_id: clipId, ok: false, error: 'Clip not found for this question' };
      const ctx: ClipContext = { ...question, clip_id: row.id, script_id: row.script_id, clip_image_url: row.clip_image_url, ocr_text: row.ocr_text };
      try {
        const out = await aiMarkClip(ctx, {
          mode: body.mode, strictness: body.strictness, guidance: body.guidance, useExamples: body.use_examples,
        });
        return { clip_id: clipId, ok: true, marks_awarded: out.marks_awarded };
      } catch (err) {
        const failure = failureOf(err);
        console.error(`AI marking failed for clip ${clipId} [${failure.code}]:`, (err as Error).message);
        return {
          clip_id: clipId, ok: false, error: failure.message, code: failure.code,
          retryable: failure.retryable, fatal: failure.fatal, retry_after_seconds: failure.retry_after_seconds,
        };
      }
    }));
    res.json({ data: { results } });
  } catch (err) {
    next(err);
  }
});

// Human and AI marks side by side, with how closely they agree.
router.get('/exams/:id/ai-results', requireAuth, async (req, res, next) => {
  try {
    const questionId = z.string().uuid().parse(req.query.question_id);
    const question = await requireQuestionAccess(req, res, questionId, { leadOnly: true, examId: req.params.id });
    if (!question) return;

    const rows = (await db.raw(
      `SELECT sc.id AS clip_id, ss.student_number, h.marks_awarded AS human_mark,
              ai.marks_awarded AS ai_mark, ai.ai_reasoning, ai.ai_feedback
         FROM script_clips sc
         JOIN student_scripts ss ON ss.id = sc.script_id
         LEFT JOIN (
           SELECT DISTINCT ON (clip_id) clip_id, marks_awarded FROM script_marks
            WHERE mark_source = 'human' AND status <> 'pending' AND marks_awarded IS NOT NULL
            ORDER BY clip_id, marked_at DESC NULLS LAST
         ) h ON h.clip_id = sc.id
         LEFT JOIN script_marks ai ON ai.clip_id = sc.id AND ai.mark_source = 'ai'
        WHERE sc.question_id = ?
        ORDER BY ss.student_number`,
      [questionId],
    )).rows as Omit<AiResultRow, 'difference'>[];

    const out: AiResultRow[] = rows.map((r) => ({
      ...r,
      difference: r.human_mark !== null && r.ai_mark !== null ? r.ai_mark - r.human_mark : null,
    }));
    const both = out.filter((r) => r.difference !== null);
    const pct = (n: number) => (both.length ? Math.round((n / both.length) * 100) : null);
    const result: AiResults = {
      max_marks: question.max_marks,
      rows: out,
      stats: {
        compared: both.length,
        exact_pct: pct(both.filter((r) => r.difference === 0).length),
        within_one_pct: pct(both.filter((r) => Math.abs(r.difference!) <= 1).length),
        mean_abs_diff: both.length ? Math.round((both.reduce((a, r) => a + Math.abs(r.difference!), 0) / both.length) * 100) / 100 : null,
        mean_signed_diff: both.length ? Math.round((both.reduce((a, r) => a + r.difference!, 0) / both.length) * 100) / 100 : null,
      },
    };
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;

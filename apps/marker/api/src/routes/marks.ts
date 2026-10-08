import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { storage } from '../services/storage.js';
import { getClipBytes } from '../services/clipImages.js';
import { convertedUrl } from '../services/converted.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClipAccess, requireQuestionAccess } from '../services/access.js';

const router = Router();

const AnnotationSchema = z.object({
  id: z.string(),
  type: z.enum(['tick', 'cross', 'numbered_tick', 'numbered_cross', 'circle', 'underline', 'ruler', 'text', 'mark_tick']),
  // 'clip' (or none) = on the script image; 'text' = on the converted-handwriting page
  layer: z.enum(['clip', 'text']).optional(),
  x: z.number(),
  y: z.number(),
  color: z.string(),
  number: z.number().optional(),
  text: z.string().optional(),
  points: z.array(z.number()).optional(),
  radius: z.number().optional(),
});

const SaveMarkSchema = z.object({
  clip_id: z.string().uuid(),
  // Required for a real save; a draft may have none yet
  marks_awarded: z.number().int().min(0).max(100).nullable().optional(),
  annotation_data: z.object({ annotations: z.array(AnnotationSchema) }),
  // Automatic save when leaving a clip: keeps ticks and any typed mark without counting the clip as marked
  draft: z.boolean().optional(),
});

type ClipState = 'marked' | 'draft' | 'unmarked';

// This teacher's clips for a question in a stable order (by script number, which markers
// only ever see as a position), with how far along each one is for them.
async function clipList(questionId: string, teacherId: string): Promise<{ id: string; state: ClipState }[]> {
  const result = await db.raw(
    `SELECT sc.id,
            CASE
              WHEN EXISTS (SELECT 1 FROM script_marks sm WHERE sm.clip_id = sc.id AND sm.marker_id = ?
                              AND sm.mark_source = 'human' AND sm.status <> 'pending') THEN 'marked'
              WHEN EXISTS (SELECT 1 FROM script_marks sm WHERE sm.clip_id = sc.id AND sm.marker_id = ?
                              AND sm.mark_source = 'human') THEN 'draft'
              ELSE 'unmarked'
            END AS state
       FROM script_clips sc
       JOIN student_scripts ss ON ss.id = sc.script_id
      WHERE sc.question_id = ?
      ORDER BY ss.student_number, sc.id`,
    [teacherId, teacherId, questionId],
  );
  return result.rows as { id: string; state: ClipState }[];
}

// The clips for a question, for the jump menu on the marking page
router.get('/exams/:examId/questions/:questionId/clips', requireAuth, async (req, res, next) => {
  try {
    const access = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!access) return;
    res.json({ data: await clipList(req.params.questionId, req.user!.sub) });
  } catch (err) {
    next(err);
  }
});

// One clip for this teacher to mark: the one asked for (?clip_id=), else the first they haven't finished.
router.get('/exams/:examId/queue/:questionId', requireAuth, async (req, res, next) => {
  try {
    const teacherId = req.user!.sub;
    const access = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!access) return;

    const list = await clipList(req.params.questionId, teacherId);
    const wanted = typeof req.query.clip_id === 'string' ? req.query.clip_id : null;
    let index: number;
    if (wanted) {
      index = list.findIndex((c) => c.id === wanted);
      if (index < 0) { res.status(404).json({ error: 'Clip not found for this question', code: 'NOT_FOUND' }); return; }
    } else {
      index = list.findIndex((c) => c.state !== 'marked');
      if (index < 0) {
        res.json({ data: null, meta: { message: 'All clips marked', total: list.length, first_id: list[0]?.id ?? null } }); return;
      }
    }

    // Select sc columns explicitly: an implicit `select *` over a join lets a NULL right-side id shadow sc.id.
    const clip = await db('script_clips as sc')
      .where('sc.id', list[index].id)
      .first<{
        id: string; script_id: string; ocr_text: string | null; text_image_url: string | null;
        clip_source: string; reclipped_at: string | null; changed_after_marking: boolean;
      }>(
        'sc.id as id',
        'sc.script_id as script_id',
        'sc.ocr_text as ocr_text',
        'sc.text_image_url as text_image_url',
        'sc.clip_source as clip_source',
        'sc.reclipped_at as reclipped_at',
        // A clip re-selected after someone marked it: earlier marks may refer to the old crop
        db.raw(`(sc.reclipped_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM script_marks hm
           WHERE hm.clip_id = sc.id AND hm.mark_source = 'human' AND hm.marked_at < sc.reclipped_at)) AS changed_after_marking`),
      );
    if (!clip) { res.status(404).json({ error: 'Clip not found', code: 'NOT_FOUND' }); return; }

    const question = await db('exam_questions').where({ id: req.params.questionId }).first();

    // The clip image is served by this API (same origin), so the canvas can read it whatever the storage.
    const version = clip.reclipped_at ? new Date(clip.reclipped_at).getTime() : 0;
    const clipUrl = `/api/v1/clips/${clip.id}/image?v=${version}`;

    // Mark-scheme clip URL, if one was produced during clipping
    let msUrl: string | null = null;
    if (question?.ms_clip_image_url) {
      msUrl = await storage.publicUrl(question.ms_clip_image_url);
    }

    // The AI's mark for this clip, if any (shown only if the teacher asks for it)
    const ai = await db('script_marks')
      .where({ clip_id: clip.id, mark_source: 'ai' })
      .first<{ marks_awarded: number | null; ai_reasoning: string | null; ai_feedback: string | null; ai_model: string | null }>(
        'marks_awarded', 'ai_reasoning', 'ai_feedback', 'ai_model',
      );

    // This teacher's own saved ticks and mark, so revisiting a clip shows them
    const mine = await db('script_marks')
      .where({ clip_id: clip.id, marker_id: teacherId, mark_source: 'human' })
      .first<{ marks_awarded: number | null; annotation_data: unknown; status: string }>('marks_awarded', 'annotation_data', 'status');

    const nextUnmarked = [...list.slice(index + 1), ...list.slice(0, index)].find((c) => c.state !== 'marked');

    res.json({
      data: {
        id: clip.id,
        script_id: clip.script_id,
        clip_source: clip.clip_source,
        reclipped_at: clip.reclipped_at,
        changed_after_marking: clip.changed_after_marking,
        clip_url: clipUrl,
        ms_url: msUrl,
        question,
        remaining: list.filter((c) => c.state !== 'marked').length,
        position: index + 1,
        total: list.length,
        prev_id: list[index - 1]?.id ?? null,
        next_id: list[index + 1]?.id ?? null,
        next_unmarked_id: nextUnmarked?.id ?? null,
        state: list[index].state,
        my_mark: mine
          ? { marks_awarded: mine.marks_awarded, annotation_data: mine.annotation_data, status: mine.status }
          : null,
        ai_mark: ai
          ? { marks_awarded: ai.marks_awarded, reasoning: ai.ai_reasoning, feedback: ai.ai_feedback, model: ai.ai_model }
          : null,
        ocr_text: clip.ocr_text,
        converted_url: convertedUrl(clip.id, clip.text_image_url),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Save a mark, or (draft) just the ticks and any typed mark
router.post('/marks', requireAuth, async (req, res, next) => {
  try {
    const body = SaveMarkSchema.parse(req.body);
    const teacherId = req.user!.sub;

    // The teacher must be assigned to this question (or lead the exam)
    const clip = await requireClipAccess(req, res, body.clip_id);
    if (!clip) return;

    if (body.marks_awarded != null && body.marks_awarded > clip.max_marks) {
      res.status(422).json({ error: `Marks exceed max (${clip.max_marks})`, code: 'MARKS_EXCEED_MAX' }); return;
    }
    if (!body.draft && body.marks_awarded == null) {
      res.status(422).json({ error: 'Enter a mark before saving', code: 'MARKS_REQUIRED' }); return;
    }

    const existing = await db('script_marks')
      .where({ clip_id: body.clip_id, marker_id: teacherId, mark_source: 'human' })
      .first<{ status: string; marks_awarded: number | null }>('status', 'marks_awarded');
    const finalised = Boolean(existing && existing.status !== 'pending');

    // A draft never un-marks a clip that was already saved: it only updates the ticks (and the mark if one is given)
    const status = body.draft ? (finalised ? existing!.status : 'pending') : 'marked';
    const marks = body.marks_awarded ?? (finalised ? existing!.marks_awarded : null);

    const values = {
      marks_awarded: marks,
      annotation_data: JSON.stringify(body.annotation_data),
      status,
      ...(body.draft ? {} : { marked_at: db.fn.now() }),
    };
    const [mark] = await db('script_marks')
      .insert({ clip_id: body.clip_id, marker_id: teacherId, mark_source: 'human', ...values })
      .onConflict(['clip_id', 'marker_id'])
      .merge(values)
      .returning('*');

    res.status(201).json({ data: mark });
  } catch (err) {
    next(err);
  }
});

// Get marks for a specific clip
router.get('/clips/:id/marks', requireAuth, async (req, res, next) => {
  try {
    if (!(await requireClipAccess(req, res, req.params.id))) return;
    const marks = await db('script_marks')
      .leftJoin('users as u', 'u.id', 'script_marks.marker_id')
      .where('script_marks.clip_id', req.params.id)
      .select('script_marks.*', 'u.email as marker_email', 'u.name as marker_name');
    res.json({ data: marks });
  } catch (err) {
    next(err);
  }
});

// Get exams assigned to the current teacher
router.get('/my-exams', requireAuth, async (req, res, next) => {
  try {
    const teacherId = req.user!.sub;
    const exams = await db('exams as e')
      .join('marking_assignments as ma', 'ma.exam_id', 'e.id')
      .where('ma.teacher_id', teacherId)
      .distinct('e.*')
      .orderBy('e.created_at', 'desc');
    // For each exam, list the questions this teacher is assigned to
    const withQuestions = await Promise.all(exams.map(async (exam) => {
      const questions = await db('exam_questions as eq')
        .join('marking_assignments as ma', 'ma.question_id', 'eq.id')
        .where({ 'ma.exam_id': exam.id, 'ma.teacher_id': teacherId })
        .select('eq.*');
      return { ...exam, assigned_questions: questions };
    }));
    res.json({ data: withQuestions });
  } catch (err) {
    next(err);
  }
});

// The clip image itself, streamed by this API so the browser always loads it from our own origin
// (Drive and the storage bucket both refuse the cross-origin read the canvas needs).
router.get('/clips/:id/image', requireAuth, async (req, res, next) => {
  try {
    const clip = await requireClipAccess(req, res, req.params.id);
    if (!clip) return;
    const bytes = await getClipBytes(clip.clip_image_url, clip.lead_teacher_id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// The converted-handwriting page for a clip (see routes/ai.ts), streamed the same way as the clip image
router.get('/clips/:id/text-image', requireAuth, async (req, res, next) => {
  try {
    const clip = await requireClipAccess(req, res, req.params.id);
    if (!clip) return;
    const row = await db('script_clips').where({ id: clip.clip_id }).first<{ text_image_url: string | null }>('text_image_url');
    if (!row?.text_image_url) {
      res.status(404).json({ error: 'This clip has not been converted yet', code: 'NOT_CONVERTED' }); return;
    }
    const bytes = await getClipBytes(row.text_image_url, clip.lead_teacher_id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

export default router;

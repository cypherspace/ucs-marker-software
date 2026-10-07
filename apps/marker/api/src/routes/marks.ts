import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { storage } from '../services/storage.js';
import { isDriveUri, fileIdFromUri, getDownloadUrl } from '../services/drive.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClipAccess, requireQuestionAccess } from '../services/access.js';

const router = Router();

const AnnotationSchema = z.object({
  id: z.string(),
  type: z.enum(['tick', 'cross', 'numbered_tick', 'numbered_cross', 'circle', 'underline', 'ruler', 'text']),
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
  marks_awarded: z.number().int().min(0).max(100),
  annotation_data: z.object({ annotations: z.array(AnnotationSchema) }),
});

// Get next unmarked clip for a teacher on a specific question
router.get('/exams/:examId/queue/:questionId', requireAuth, async (req, res, next) => {
  try {
    const teacherId = req.user!.sub;
    const access = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!access) return;

    // Find a clip for this question that this teacher hasn't marked yet
    const clip = await db('script_clips as sc')
      .leftJoin('script_marks as sm', function () {
        this.on('sm.clip_id', 'sc.id').andOn('sm.marker_id', db.raw('?', [teacherId]));
      })
      .where('sc.question_id', req.params.questionId)
      .whereNull('sm.id')
      .orderBy('sc.created_at')
      // Select sc columns explicitly: an implicit `select *` over the join lets
      // sm.id (NULL here) shadow sc.id, returning a null clip id.
      .first<{
        id: string; clip_image_url: string; script_id: string; question_id: string; ocr_text: string | null;
        clip_source: string; reclipped_at: string | null; changed_after_marking: boolean;
      }>(
        'sc.id as id',
        'sc.clip_image_url as clip_image_url',
        'sc.script_id as script_id',
        'sc.question_id as question_id',
        'sc.ocr_text as ocr_text',
        'sc.clip_source as clip_source',
        'sc.reclipped_at as reclipped_at',
        // A clip re-selected after someone marked it: earlier marks may refer to the old crop
        db.raw(`(sc.reclipped_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM script_marks hm
           WHERE hm.clip_id = sc.id AND hm.mark_source = 'human' AND hm.marked_at < sc.reclipped_at)) AS changed_after_marking`),
      );

    if (!clip) {
      res.json({ data: null, meta: { message: 'All clips marked' } }); return;
    }

    // Get the question for max_marks
    const question = await db('exam_questions').where({ id: req.params.questionId }).first();

    // Resolve clip image URL (Drive or local/GCS)
    let clipUrl: string;
    if (isDriveUri(clip.clip_image_url)) {
      clipUrl = await getDownloadUrl(access.lead_teacher_id, fileIdFromUri(clip.clip_image_url));
    } else {
      clipUrl = await storage.publicUrl(clip.clip_image_url);
      // Local storage serves a clip from the same path every time; stamp it so a re-selected clip isn't shown from the browser's cache
      if (clipUrl.startsWith('/files/') && clip.reclipped_at) clipUrl += `?v=${new Date(clip.reclipped_at).getTime()}`;
    }

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

    // Total remaining
    const remaining = await db('script_clips as sc')
      .leftJoin('script_marks as sm', function () {
        this.on('sm.clip_id', 'sc.id').andOn('sm.marker_id', db.raw('?', [teacherId]));
      })
      .where('sc.question_id', req.params.questionId)
      .whereNull('sm.id')
      .count('sc.id as n')
      .first<{ n: string }>();

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
        remaining: Number(remaining?.n ?? 0),
        ai_mark: ai
          ? { marks_awarded: ai.marks_awarded, reasoning: ai.ai_reasoning, feedback: ai.ai_feedback, model: ai.ai_model }
          : null,
        ocr_text: clip.ocr_text,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Save a mark
router.post('/marks', requireAuth, async (req, res, next) => {
  try {
    const body = SaveMarkSchema.parse(req.body);
    const teacherId = req.user!.sub;

    // The teacher must be assigned to this question (or lead the exam)
    const clip = await requireClipAccess(req, res, body.clip_id);
    if (!clip) return;

    if (body.marks_awarded > clip.max_marks) {
      res.status(422).json({ error: `Marks exceed max (${clip.max_marks})`, code: 'MARKS_EXCEED_MAX' }); return;
    }

    const [mark] = await db('script_marks')
      .insert({
        clip_id: body.clip_id,
        marker_id: teacherId,
        mark_source: 'human',
        marks_awarded: body.marks_awarded,
        annotation_data: JSON.stringify(body.annotation_data),
        status: 'marked',
        marked_at: db.fn.now(),
      })
      .onConflict(['clip_id', 'marker_id'])
      .merge(['marks_awarded', 'annotation_data', 'status', 'marked_at'])
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

// Serve clip image, handling Drive and local/GCS — frontend always uses this for <img> src
router.get('/clips/:id/image', requireAuth, async (req, res, next) => {
  try {
    const clip = await requireClipAccess(req, res, req.params.id);
    if (!clip) return;
    let url: string;
    if (isDriveUri(clip.clip_image_url)) {
      url = await getDownloadUrl(clip.lead_teacher_id, fileIdFromUri(clip.clip_image_url));
    } else {
      url = await storage.publicUrl(clip.clip_image_url);
    }
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
});

export default router;

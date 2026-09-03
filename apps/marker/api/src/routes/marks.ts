import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { storage } from '../services/storage.js';
import { isDriveUri, fileIdFromUri, getDownloadUrl } from '../services/drive.js';
import { requireAuth } from '../middleware/requireAuth.js';

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
      .first<{ id: string; clip_image_url: string; script_id: string; question_id: string }>(
        'sc.id as id',
        'sc.clip_image_url as clip_image_url',
        'sc.script_id as script_id',
        'sc.question_id as question_id',
      );

    if (!clip) {
      res.json({ data: null, meta: { message: 'All clips marked' } }); return;
    }

    // Get the question for max_marks
    const question = await db('exam_questions').where({ id: req.params.questionId }).first();

    // Resolve clip image URL (Drive or local/GCS)
    const exam = await db('exams').where({ id: req.params.examId }).first<{ lead_teacher_id: string }>();
    let clipUrl: string;
    if (isDriveUri(clip.clip_image_url)) {
      clipUrl = await getDownloadUrl(exam!.lead_teacher_id, fileIdFromUri(clip.clip_image_url));
    } else {
      clipUrl = await storage.publicUrl(clip.clip_image_url);
    }

    // Mark-scheme clip URL, if one was produced during clipping
    let msUrl: string | null = null;
    if (question?.ms_clip_image_url) {
      msUrl = await storage.publicUrl(question.ms_clip_image_url);
    }
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
      data: { id: clip.id, clip_url: clipUrl, ms_url: msUrl, question, remaining: Number(remaining?.n ?? 0) },
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

    // Verify the teacher is assigned to mark this question
    const clip = await db('script_clips as sc')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .where('sc.id', body.clip_id)
      .first<{ question_id: string; exam_id: string; max_marks: number }>();
    if (!clip) { res.status(404).json({ error: 'Clip not found', code: 'NOT_FOUND' }); return; }

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
    const clip = await db('script_clips as sc')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .join('exams as e', 'e.id', 'eq.exam_id')
      .where('sc.id', req.params.id)
      .first<{ clip_image_url: string; lead_teacher_id: string }>();
    if (!clip) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
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

// Get next comparative pair for essay marking
router.get('/exams/:examId/compare/:questionId', requireAuth, async (req, res, next) => {
  try {
    const pair = await db('comparative_pairs')
      .where({ exam_id: req.params.examId, question_id: req.params.questionId })
      .whereNull('winner_clip_id')
      .first();
    if (!pair) {
      res.json({ data: null, meta: { message: 'No more pairs to compare' } }); return;
    }
    const exam = await db('exams').where({ id: req.params.examId }).first<{ lead_teacher_id: string }>();

    async function resolveClipUrl(clipId: string): Promise<string> {
      const row = await db('script_clips').where({ id: clipId }).first<{ clip_image_url: string }>();
      const uri = row?.clip_image_url ?? '';
      if (isDriveUri(uri)) return getDownloadUrl(exam!.lead_teacher_id, fileIdFromUri(uri)).catch(() => '');
      return storage.publicUrl(uri).catch(() => '');
    }

    const [clipA, clipB] = await Promise.all([resolveClipUrl(pair.clip_a_id), resolveClipUrl(pair.clip_b_id)]);
    res.json({ data: { ...pair, clip_a_image_url: clipA, clip_b_image_url: clipB } });
  } catch (err) {
    next(err);
  }
});

// Record comparative pair result
router.post('/compare/:pairId', requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ winner_clip_id: z.string().uuid() }).parse(req.body);
    const [updated] = await db('comparative_pairs')
      .where({ id: req.params.pairId })
      .update({ winner_clip_id: body.winner_clip_id, compared_at: db.fn.now() })
      .returning('*');
    if (!updated) { res.status(404).json({ error: 'Pair not found', code: 'NOT_FOUND' }); return; }
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;

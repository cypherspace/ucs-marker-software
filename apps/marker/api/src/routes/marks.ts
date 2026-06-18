import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { storage } from '../services/storage.js';
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
      .first<{ id: string; clip_image_url: string; script_id: string; question_id: string }>();

    if (!clip) {
      res.json({ data: null, meta: { message: 'All clips marked' } }); return;
    }

    // Get the question for max_marks and MS url
    const question = await db('exam_questions').where({ id: req.params.questionId }).first();
    // Generate a public URL for the clip image
    const clipUrl = await storage.publicUrl(clip.clip_image_url);
    // MS URL if clip coordinates exist
    let msUrl: string | null = null;
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

// Get next comparative pair for essay marking
router.get('/exams/:examId/compare/:questionId', requireAuth, async (req, res, next) => {
  try {
    // Find an unresolved pair assigned or create one
    const pair = await db('comparative_pairs')
      .where({ exam_id: req.params.examId, question_id: req.params.questionId })
      .whereNull('winner_clip_id')
      .first();
    if (!pair) {
      res.json({ data: null, meta: { message: 'No more pairs to compare' } }); return;
    }
    const [clipA, clipB] = await Promise.all([
      storage.publicUrl(
        (await db('script_clips').where({ id: pair.clip_a_id }).first<{ clip_image_url: string }>())?.clip_image_url ?? ''
      ).catch(() => ''),
      storage.publicUrl(
        (await db('script_clips').where({ id: pair.clip_b_id }).first<{ clip_image_url: string }>())?.clip_image_url ?? ''
      ).catch(() => ''),
    ]);
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

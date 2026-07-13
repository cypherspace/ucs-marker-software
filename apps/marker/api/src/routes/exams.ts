import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { createExamFolder } from '../services/drive.js';

const router = Router();

// jsonb columns must be serialised before insert/update — node-pg otherwise
// renders JS arrays as Postgres array literals, which jsonb rejects.
function jsonbOrNull(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

const CreateExamSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().max(100).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  year_group: z.string().max(50).optional(),
  exam_board: z.string().max(100).optional(),
  exam_series: z.string().max(100).optional(),
  use_drive_storage: z.boolean().optional(),
});

const UpdateExamSchema = CreateExamSchema.partial();

// List exams (lead teachers see exams they created; other teachers see exams they're assigned to)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const role = req.user!.role;

    let rows;
    if (role === 'admin') {
      rows = await db('exams').orderBy('created_at', 'desc');
    } else {
      // Teachers see exams where they are lead OR assigned
      rows = await db('exams')
        .leftJoin('marking_assignments as ma', 'ma.exam_id', 'exams.id')
        .where('exams.lead_teacher_id', userId)
        .orWhere('ma.teacher_id', userId)
        .distinct('exams.*')
        .orderBy('exams.created_at', 'desc');
    }
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// Get single exam
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    res.json({ data: exam });
  } catch (err) {
    next(err);
  }
});

// Create exam (teacher or admin)
router.post('/', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const body = CreateExamSchema.parse(req.body);
    const useDrive = body.use_drive_storage !== false; // default true
    const [exam] = await db('exams')
      .insert({ ...body, use_drive_storage: useDrive, lead_teacher_id: req.user!.sub, status: 'setup' })
      .returning('*');

    if (useDrive) {
      try {
        const folderId = await createExamFolder(req.user!.sub, exam.name);
        await db('exams').where({ id: exam.id }).update({ drive_folder_id: folderId });
        exam.drive_folder_id = folderId;
      } catch (driveErr) {
        // No refresh token yet (user hasn't re-authed with drive.file scope) — non-fatal
        console.warn('[drive] Folder creation deferred:', (driveErr as Error).message);
      }
    }

    res.status(201).json({ data: exam });
  } catch (err) {
    next(err);
  }
});

// Update exam metadata
router.patch('/:id', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const body = UpdateExamSchema.parse(req.body);
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    if (req.user!.role !== 'admin' && exam.lead_teacher_id !== req.user!.sub) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
    }
    const [updated] = await db('exams').where({ id: req.params.id }).update(body).returning('*');

    // Lazily create Drive folder if Drive storage just enabled and no folder exists yet
    if (updated.use_drive_storage && !updated.drive_folder_id) {
      try {
        const folderId = await createExamFolder(exam.lead_teacher_id, updated.name);
        await db('exams').where({ id: req.params.id }).update({ drive_folder_id: folderId });
        updated.drive_folder_id = folderId;
      } catch (driveErr) {
        console.warn('[drive] Lazy folder creation failed:', (driveErr as Error).message);
      }
    }

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// List questions for an exam
router.get('/:id/questions', requireAuth, async (req, res, next) => {
  try {
    const rows = await db('exam_questions')
      .where({ exam_id: req.params.id })
      .orderBy('question_number');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// Create/upsert question regions
router.post('/:id/questions', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const QuestionSchema = z.object({
      question_number: z.string().min(1).max(20),
      max_marks: z.number().int().min(0).max(100),
      clip_coordinates: z.array(z.object({
        page: z.number().int().min(1),
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      })).optional(),
      ms_clip_coordinates: z.array(z.object({
        page: z.number().int().min(1),
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      })).optional(),
      name_zones: z.array(z.object({
        page: z.number().int().min(1),
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      })).optional(),
    });
    const body = QuestionSchema.parse(req.body);
    const [question] = await db('exam_questions')
      .insert({
        exam_id: req.params.id,
        question_number: body.question_number,
        max_marks: body.max_marks,
        clip_coordinates: jsonbOrNull(body.clip_coordinates),
        ms_clip_coordinates: jsonbOrNull(body.ms_clip_coordinates),
        name_zones: jsonbOrNull(body.name_zones),
      })
      .returning('*');
    res.status(201).json({ data: question });
  } catch (err) {
    next(err);
  }
});

// Update question coordinates
router.patch('/:examId/questions/:questionId', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const UpdateSchema = z.object({
      question_number: z.string().max(20).optional(),
      max_marks: z.number().int().min(0).max(100).optional(),
      clip_coordinates: z.array(z.object({
        page: z.number().int().min(1),
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      })).nullable().optional(),
      ms_clip_coordinates: z.array(z.object({
        page: z.number().int().min(1),
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      })).nullable().optional(),
      name_zones: z.array(z.object({
        page: z.number().int().min(1),
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      })).nullable().optional(),
    });
    const body = UpdateSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.question_number !== undefined) patch.question_number = body.question_number;
    if (body.max_marks !== undefined) patch.max_marks = body.max_marks;
    if (body.clip_coordinates !== undefined) patch.clip_coordinates = jsonbOrNull(body.clip_coordinates);
    if (body.ms_clip_coordinates !== undefined) patch.ms_clip_coordinates = jsonbOrNull(body.ms_clip_coordinates);
    if (body.name_zones !== undefined) patch.name_zones = jsonbOrNull(body.name_zones);
    const [updated] = await db('exam_questions')
      .where({ id: req.params.questionId, exam_id: req.params.examId })
      .update(patch)
      .returning('*');
    if (!updated) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Get marking assignments for exam
router.get('/:id/assignments', requireAuth, async (req, res, next) => {
  try {
    const rows = await db('marking_assignments as ma')
      .join('users as u', 'u.id', 'ma.teacher_id')
      .join('exam_questions as eq', 'eq.id', 'ma.question_id')
      .where('ma.exam_id', req.params.id)
      .select(
        'ma.exam_id', 'ma.teacher_id', 'u.email as teacher_email', 'u.name as teacher_name',
        'ma.question_id', 'eq.question_number', 'ma.assigned_at',
      );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// Assign teacher to question
router.post('/:id/assignments', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const body = z.object({
      teacher_id: z.string().uuid(),
      question_id: z.string().uuid(),
    }).parse(req.body);
    await db('marking_assignments')
      .insert({ exam_id: req.params.id, ...body, assigned_by: req.user!.sub })
      .onConflict(['exam_id', 'teacher_id', 'question_id']).ignore();
    res.status(201).json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// Remove assignment
router.delete('/:id/assignments', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const body = z.object({
      teacher_id: z.string().uuid(),
      question_id: z.string().uuid(),
    }).parse(req.body);
    await db('marking_assignments')
      .where({ exam_id: req.params.id, ...body })
      .delete();
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// Get marking progress for exam
router.get('/:id/progress', requireAuth, async (req, res, next) => {
  try {
    const questions = await db('exam_questions').where({ exam_id: req.params.id });
    const progress = await Promise.all(questions.map(async (q) => {
      const total = await db('script_clips').where({ question_id: q.id }).count('id as n').first<{ n: string }>();
      const marked = await db('script_marks')
        .join('script_clips as sc', 'sc.id', 'script_marks.clip_id')
        .where('sc.question_id', q.id)
        .whereNot('script_marks.status', 'pending')
        .countDistinct('script_marks.clip_id as n')
        .first<{ n: string }>();
      const teachers = await db('marking_assignments as ma')
        .join('users as u', 'u.id', 'ma.teacher_id')
        .where('ma.question_id', q.id)
        .select('ma.teacher_id', 'u.email');
      return {
        question_id: q.id,
        question_number: q.question_number,
        max_marks: q.max_marks,
        total_clips: Number(total?.n ?? 0),
        marked_clips: Number(marked?.n ?? 0),
        teachers,
      };
    }));
    res.json({ data: { exam_id: req.params.id, questions: progress } });
  } catch (err) {
    next(err);
  }
});

export default router;

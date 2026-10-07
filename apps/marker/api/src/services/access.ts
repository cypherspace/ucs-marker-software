import type { Request, Response } from 'express';
import { db } from '../db.js';

export interface QuestionContext {
  question_id: string;
  question_number: string;
  max_marks: number;
  marking_mode: 'marks' | 'comparative';
  ms_clip_image_url: string | null;
  exam_id: string;
  lead_teacher_id: string;
}

export interface ClipContext extends QuestionContext {
  clip_id: string;
  script_id: string;
  clip_image_url: string;
  ocr_text: string | null;
}

// Who may work on a question: an admin, the exam's lead teacher, or a teacher
// assigned to that question. `leadOnly` drops the last group (set-up and
// ranking actions).
async function allowed(req: Request, ctx: QuestionContext, leadOnly: boolean): Promise<boolean> {
  const user = req.user!;
  if (user.role === 'admin' || ctx.lead_teacher_id === user.sub) return true;
  if (leadOnly) return false;
  const row = await db('marking_assignments')
    .where({ question_id: ctx.question_id, teacher_id: user.sub })
    .first('teacher_id');
  return Boolean(row);
}

const QUESTION_COLUMNS = [
  'eq.id as question_id', 'eq.question_number', 'eq.max_marks', 'eq.marking_mode',
  'eq.ms_clip_image_url', 'eq.exam_id', 'e.lead_teacher_id',
];

export async function requireQuestionAccess(
  req: Request, res: Response, questionId: string, opts: { leadOnly?: boolean; examId?: string } = {},
): Promise<QuestionContext | null> {
  const ctx = await db('exam_questions as eq')
    .join('exams as e', 'e.id', 'eq.exam_id')
    .where('eq.id', questionId)
    .first<QuestionContext>(...QUESTION_COLUMNS);
  if (!ctx || (opts.examId && ctx.exam_id !== opts.examId)) {
    res.status(404).json({ error: 'Question not found', code: 'NOT_FOUND' }); return null;
  }
  if (!(await allowed(req, ctx, Boolean(opts.leadOnly)))) {
    res.status(403).json({ error: 'You are not assigned to this question', code: 'FORBIDDEN' }); return null;
  }
  return ctx;
}

export async function requireClipAccess(
  req: Request, res: Response, clipId: string, opts: { leadOnly?: boolean } = {},
): Promise<ClipContext | null> {
  const ctx = await db('script_clips as sc')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .join('exams as e', 'e.id', 'eq.exam_id')
    .where('sc.id', clipId)
    .first<ClipContext>(...QUESTION_COLUMNS, 'sc.id as clip_id', 'sc.script_id', 'sc.clip_image_url', 'sc.ocr_text');
  if (!ctx) { res.status(404).json({ error: 'Clip not found', code: 'NOT_FOUND' }); return null; }
  if (!(await allowed(req, ctx, Boolean(opts.leadOnly)))) {
    res.status(403).json({ error: 'You are not assigned to this question', code: 'FORBIDDEN' }); return null;
  }
  return ctx;
}

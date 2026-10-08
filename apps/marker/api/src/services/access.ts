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

// ── Whole exams ──────────────────────────────────────────────────────────────
// Who may see an exam at all: an admin, its lead teacher, or a teacher who has been assigned a question
// on it (or has uploaded scripts to it). Anyone else gets a 403, so exam details, progress and results
// are not readable just by knowing an exam's id.
export interface ExamAccess {
  exam: { id: string; name: string; lead_teacher_id: string; use_drive_storage: boolean; drive_folder_id: string | null; archived_at: string | null };
  /** Admin or the exam's lead teacher: sees everything and may set the exam up */
  isLead: boolean;
  /** Questions this teacher was asked to mark */
  assignedQuestionIds: string[];
}

export async function requireExamMember(
  req: Request, res: Response, examId: string, opts: { leadOnly?: boolean; markerOrLead?: boolean } = {},
): Promise<ExamAccess | null> {
  const exam = await db('exams').where({ id: examId })
    .first<ExamAccess['exam']>('id', 'name', 'lead_teacher_id', 'use_drive_storage', 'drive_folder_id', 'archived_at');
  if (!exam) { res.status(404).json({ error: 'Exam not found', code: 'NOT_FOUND' }); return null; }
  const user = req.user!;
  const isLead = user.role === 'admin' || exam.lead_teacher_id === user.sub;
  const assigned = isLead ? [] : (await db('marking_assignments').where({ exam_id: examId, teacher_id: user.sub })
    .select<{ question_id: string }[]>('question_id')).map((r) => r.question_id);
  let allowed = isLead || assigned.length > 0;
  // Someone who uploaded a class's scripts may see them even if no question has been assigned to them
  if (!allowed && !opts.leadOnly && !opts.markerOrLead) {
    allowed = Boolean(await db('student_scripts').where({ exam_id: examId, uploaded_by: user.sub }).first('id'));
  }
  if (opts.leadOnly && !isLead) allowed = false;
  if (!allowed) { res.status(403).json({ error: 'You do not have access to this exam', code: 'FORBIDDEN' }); return null; }
  return { exam, isLead, assignedQuestionIds: assigned };
}
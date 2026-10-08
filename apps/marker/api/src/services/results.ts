import { db } from '../db.js';
import { finalMarks } from './finalMark.js';
import type { ExamAccess } from './access.js';

// What a person may see of an exam's results. The lead teacher and admins see every script and question.
// Anyone else sees the scripts they uploaded (their own class, all questions) and, for the questions
// they were asked to mark, every script.
export interface ResultsScope {
  all: boolean;
  userId: string;
  assignedQuestionIds: string[];
}

export function scopeFor(access: ExamAccess, userId: string): ResultsScope {
  return { all: access.isLead, userId, assignedQuestionIds: access.assignedQuestionIds };
}

export interface ClassFilter {
  /** A class name to keep; ignored when `none` is set */
  name?: string;
  /** Only scripts with no class */
  none?: boolean;
}

export interface ResultRow {
  script_id: string;
  student_number: string;
  student_name: string | null;
  class_group: string | null;
  question_id: string;
  question_number: string;
  max_marks: number;
  marking_mode: string;
  clip_id: string;
  marks_awarded: number | null;
  mark_source: string | null;
  ai_marks_awarded: number | null;
  ai_feedback: string | null;
}

/** One row per visible script and question. The mark that counts is the teacher's, else the AI's. */
export async function loadResultRows(examId: string, scope: ResultsScope, cls: ClassFilter = {}): Promise<ResultRow[]> {
  return db('student_scripts as ss')
    .join('script_clips as sc', 'sc.script_id', 'ss.id')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .leftJoin(finalMarks('fm'), 'fm.clip_id', 'sc.id')
    .leftJoin('script_marks as aim', function () {
      this.on('aim.clip_id', 'sc.id').andOnVal('aim.mark_source', 'ai');
    })
    .leftJoin('users as u', 'u.id', 'ss.student_id')
    .where('ss.exam_id', examId)
    .modify((qb) => {
      if (!scope.all) {
        qb.where((w) => {
          w.where('ss.uploaded_by', scope.userId);
          if (scope.assignedQuestionIds.length) w.orWhereIn('eq.id', scope.assignedQuestionIds);
        });
      }
      if (cls.none) qb.whereNull('ss.class_group');
      else if (cls.name) qb.where('ss.class_group', cls.name);
    })
    .orderBy(['ss.student_number', 'eq.question_number'])
    .select<ResultRow[]>(
      'ss.id as script_id',
      'ss.student_number',
      'u.name as student_name',
      'ss.class_group',
      'eq.id as question_id',
      'eq.question_number',
      'eq.max_marks',
      'eq.marking_mode',
      'sc.id as clip_id',
      'fm.marks_awarded',
      'fm.mark_source',
      'aim.marks_awarded as ai_marks_awarded',
      'aim.ai_feedback',
    );
}

export function classFilterFrom(query: Record<string, unknown>): ClassFilter {
  if (query.no_class === '1') return { none: true };
  return typeof query.class === 'string' && query.class.trim() ? { name: query.class.trim() } : {};
}

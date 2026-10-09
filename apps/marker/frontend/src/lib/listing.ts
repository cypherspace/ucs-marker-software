// Sorting and filtering for the exam and marking lists, kept apart from the pages so it can be tested.

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const time = (iso: string | undefined) => (iso ? new Date(iso).getTime() : 0);

// ── Exams ────────────────────────────────────────────────────────────────────
export interface ExamLike {
  name: string;
  status: string;
  created_at: string;
  subject?: string | null;
  year_group?: string | null;
  exam_board?: string | null;
  exam_series?: string | null;
  clips_total?: number;
  clips_marked?: number;
}

export type ExamSort = 'newest' | 'name' | 'remaining' | 'progress';
export type ExamStatusFilter = 'all' | 'setup' | 'marking' | 'complete';

const remaining = (e: ExamLike) => Math.max(0, (e.clips_total ?? 0) - (e.clips_marked ?? 0));
const fraction = (e: ExamLike) => ((e.clips_total ?? 0) > 0 ? (e.clips_marked ?? 0) / (e.clips_total ?? 1) : -1);

export function sortExams<T extends ExamLike>(exams: readonly T[], sort: ExamSort): T[] {
  const list = [...exams];
  switch (sort) {
    case 'name': return list.sort((a, b) => byText(a.name, b.name));
    case 'remaining': return list.sort((a, b) => remaining(b) - remaining(a) || time(b.created_at) - time(a.created_at));
    // Least finished first, exams with nothing to mark yet last
    case 'progress': return list.sort((a, b) => {
      const fa = fraction(a); const fb = fraction(b);
      if (fa < 0 && fb < 0) return time(b.created_at) - time(a.created_at);
      if (fa < 0) return 1;
      if (fb < 0) return -1;
      return fa - fb || time(b.created_at) - time(a.created_at);
    });
    default: return list.sort((a, b) => time(b.created_at) - time(a.created_at));
  }
}

export function filterExams<T extends ExamLike>(exams: readonly T[], opts: { status: ExamStatusFilter; query: string }): T[] {
  const q = opts.query.trim().toLowerCase();
  return exams.filter((e) => {
    if (opts.status === 'setup' && e.status !== 'setup' && e.status !== 'clipping') return false;
    if ((opts.status === 'marking' || opts.status === 'complete') && e.status !== opts.status) return false;
    if (!q) return true;
    return [e.name, e.subject, e.year_group, e.exam_board, e.exam_series].some((v) => v?.toLowerCase().includes(q));
  });
}

// ── Marking ──────────────────────────────────────────────────────────────────
export interface MarkQuestionLike { question_number: string; clips_total: number; clips_left: number }
export interface MarkExamLike<Q extends MarkQuestionLike> { name: string; created_at: string; assigned_questions: Q[] }

export type MarkSort = 'left' | 'name' | 'newest';
export type MarkFilter = 'todo' | 'all';

/** Questions with something left for this teacher to mark. */
export const needsMarking = (q: MarkQuestionLike) => q.clips_left > 0;

/** Apply the filter and order to the exams and, inside each, the questions. Exams left with no questions are dropped. */
export function arrangeMarking<Q extends MarkQuestionLike, E extends MarkExamLike<Q>>(
  exams: readonly E[], opts: { filter: MarkFilter; sort: MarkSort },
): E[] {
  const questionOrder = (a: Q, b: Q) => (opts.sort === 'left'
    ? Number(needsMarking(b)) - Number(needsMarking(a)) || b.clips_left - a.clips_left || byText(a.question_number, b.question_number)
    : byText(a.question_number, b.question_number));
  const shaped = exams
    .map((e) => ({
      ...e,
      assigned_questions: e.assigned_questions.filter((q) => opts.filter === 'all' || needsMarking(q)).sort(questionOrder),
    }))
    .filter((e) => e.assigned_questions.length > 0);
  const left = (e: E) => e.assigned_questions.reduce((n, q) => n + q.clips_left, 0);
  switch (opts.sort) {
    case 'name': return shaped.sort((a, b) => byText(a.name, b.name));
    case 'newest': return shaped.sort((a, b) => time(b.created_at) - time(a.created_at));
    default: return shaped.sort((a, b) => left(b) - left(a) || time(b.created_at) - time(a.created_at));
  }
}

import type { ExamResults, ResultsRow } from '@marker/shared-types';
import type { ResultRow } from './results.js';
import { sortByQuestionLabel } from './questionLabel.js';

/** Natural order for student numbers and class names: 2 before 10. */
export const byNumber = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The marks-by-script table (one row per script, one cell per question) from the flat rows. This is the one place the pivot,
 * the totals and the per-question figures are worked out, so the Results screen and the CSV cannot disagree.
 *
 * `everything` is every row this person may see (it decides the class list and the questions, so a class filter does not
 * shrink them); `rows` is the same set after any class filter. A total adds up only the marks-mode answers that have a mark, and
 * `possible` is the maximum for those same answers, so an incomplete script shows how much has been marked so far.
 */
export function buildResultsTable(everything: ResultRow[], rows: ResultRow[], scopeAll: boolean): ExamResults {
  const classScripts = new Map<string | null, Set<string>>();
  for (const r of everything) {
    if (!classScripts.has(r.class_group)) classScripts.set(r.class_group, new Set());
    classScripts.get(r.class_group)!.add(r.script_id);
  }
  const classes = [...classScripts.entries()]
    .map(([name, set]) => ({ name, scripts: set.size }))
    .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : byNumber(a.name, b.name)));

  const questionMap = new Map<string, ExamResults['questions'][number]>();
  for (const r of everything) {
    questionMap.set(r.question_id, {
      id: r.question_id, question_number: r.question_number, max_marks: r.max_marks,
      marking_mode: r.marking_mode as 'marks' | 'comparative',
    });
  }
  const questions = sortByQuestionLabel([...questionMap.values()]);

  const byScript = new Map<string, ResultsRow>();
  for (const r of rows) {
    let row = byScript.get(r.script_id);
    if (!row) {
      row = { script_id: r.script_id, student_number: r.student_number, class_group: r.class_group, cells: {}, total: 0, possible: 0 };
      byScript.set(r.script_id, row);
    }
    row.cells[r.question_id] = { marks: r.marks_awarded, source: (r.mark_source as 'human' | 'ai' | null), ai_marks: r.ai_marks_awarded };
    if (r.marking_mode === 'marks' && r.marks_awarded !== null) {
      row.total += r.marks_awarded;
      row.possible += r.max_marks;
    }
  }

  const stats = questions.map((q) => {
    const cells = rows.filter((r) => r.question_id === q.id);
    const marks = cells.map((r) => r.marks_awarded).filter((m): m is number => m !== null);
    return {
      question_id: q.id,
      scripts: cells.length,
      marked: marks.length,
      mean: marks.length ? round2(marks.reduce((a, b) => a + b, 0) / marks.length) : null,
      min: marks.length ? Math.min(...marks) : null,
      max: marks.length ? Math.max(...marks) : null,
    };
  });

  return {
    scope: scopeAll ? 'all' : 'limited',
    classes,
    questions,
    rows: [...byScript.values()].sort((a, b) => byNumber(a.student_number, b.student_number)),
    stats,
  };
}

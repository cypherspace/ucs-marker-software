import type { ExamResults } from '@marker/shared-types';
import type { ResultRow } from './results.js';
import { byNumber } from './resultsTable.js';
import { normaliseQuestionLabel } from './questionLabel.js';

export type CsvValue = string | number | null | undefined;

// Excel and Sheets run a text cell that starts with one of these as a formula; a leading apostrophe stops that and is not shown
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell. Numbers are written as they are; text is quoted when it needs to be and is made safe against formula injection. */
export function csvCell(v: CsvValue): string {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(v) : v;
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** A UTF-8 byte-order mark first, so Excel reads accents and symbols correctly; rows end CRLF. */
export function toCsv(rows: CsvValue[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const label = (questionNumber: string) => normaliseQuestionLabel(questionNumber);

export interface OverviewExtras {
  /** Student names by script id (lead teacher or admin only, and only when asked for) */
  names?: Map<string, string | null>;
  /** Rank and score of a comparative answer, keyed `${scriptId}:${questionId}` */
  ranks?: Map<string, { rank: number; score: number }>;
}

/**
 * The marks-by-script overview as a CSV: one row per script, one column per question in question order, then the totals.
 * Mark cells are plain numbers (blank when not marked or not visible to this person); answers whose counting mark is the AI's
 * are listed in the last column instead of being flagged inside the cell, so the cells stay numeric.
 */
export function overviewCsv(t: ExamResults, extras: OverviewExtras = {}): string {
  const names = extras.names;
  const questionCols = t.questions.flatMap((q) =>
    q.marking_mode === 'comparative' ? [`Q${label(q.question_number)} rank`, `Q${label(q.question_number)} score`] : [`Q${label(q.question_number)} (/${q.max_marks})`]);
  const out: CsvValue[][] = [[
    'Student number', ...(names ? ['Student name'] : []), 'Class', ...questionCols,
    'Total', 'Out of', 'Percent', 'Questions marked', 'Questions in paper', 'Counted from AI only',
  ]];

  for (const row of t.rows) {
    let marked = 0;
    let inPaper = 0;
    const aiOnly: string[] = [];
    const cells: CsvValue[] = [];
    for (const q of t.questions) {
      const cell = row.cells[q.id];
      if (q.marking_mode === 'comparative') {
        const rk = extras.ranks?.get(`${row.script_id}:${q.id}`);
        cells.push(rk?.rank ?? null, rk?.score ?? null);
        continue;
      }
      if (cell) inPaper += 1;
      if (cell && cell.marks !== null) {
        marked += 1;
        if (cell.source === 'ai') aiOnly.push(`Q${label(q.question_number)}`);
      }
      cells.push(cell?.marks ?? null);
    }
    out.push([
      row.student_number, ...(names ? [names.get(row.script_id) ?? null] : []), row.class_group, ...cells,
      row.possible > 0 ? row.total : null,
      row.possible > 0 ? row.possible : null,
      row.possible > 0 ? round1((row.total / row.possible) * 100) : null,
      marked, inPaper, aiOnly.join('; '),
    ]);
  }
  return toCsv(out);
}

/** The rows with scripts in natural student-number order (2 before 10), keeping each script's questions in the order given. */
export function naturalScriptOrder<T extends { script_id: string; student_number: string }>(rows: T[]): T[] {
  const scripts = [...new Map(rows.map((r) => [r.script_id, r.student_number])).entries()]
    .sort((a, b) => byNumber(a[1], b[1]) || a[0].localeCompare(b[0]));
  const index = new Map(scripts.map(([id], i) => [id, i]));
  return [...rows].sort((a, b) => index.get(a.script_id)! - index.get(b.script_id)!);
}

/** The per-teacher cells of a detailed row: each teacher's mark, then their mean and whether they differ. */
export function teacherExtras(cols: { id: string }[], marks: Map<string, number> | undefined): CsvValue[] {
  const values = marks ? [...marks.values()] : [];
  const mean = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;
  return [...cols.map((t) => marks?.get(t.id) ?? null), mean, values.length > 1 ? (Math.max(...values) !== Math.min(...values) ? 'yes' : 'no') : ''];
}

export interface DetailedOptions {
  includeNames: boolean;
  /** Rank and score by clip id, for comparative questions */
  ranks?: Map<string, { rank: number; score: number }>;
  perTeacher?: { cols: { id: string; email: string }[]; marks: Map<string, Map<string, number>> };
}

/** One row per script and question, for pivot tables and analysis. The same columns as ever, with readable labels and natural ordering. */
export function detailedCsv(rows: ResultRow[], opts: DetailedOptions): string {
  const withRank = Boolean(opts.ranks && opts.ranks.size);
  const per = opts.perTeacher;
  const out: CsvValue[][] = [[
    'student_number', ...(opts.includeNames ? ['student_name'] : []), 'class',
    'question', 'max_marks', 'marks_awarded', 'mark_source', 'ai_marks_awarded', 'ai_feedback',
    ...(withRank ? ['rank', 'score'] : []),
    ...(per ? [...per.cols.map((t) => `mark_${t.email}`), 'teacher_mean', 'teachers_differ'] : []),
  ]];
  for (const r of naturalScriptOrder(rows)) {
    const rk = opts.ranks?.get(r.clip_id);
    out.push([
      r.student_number, ...(opts.includeNames ? [r.student_name] : []), r.class_group,
      label(r.question_number), r.max_marks, r.marks_awarded, r.mark_source, r.ai_marks_awarded, r.ai_feedback,
      ...(withRank ? [rk?.rank ?? null, rk?.score ?? null] : []),
      ...(per ? teacherExtras(per.cols, per.marks.get(r.clip_id)) : []),
    ]);
  }
  return toCsv(out);
}

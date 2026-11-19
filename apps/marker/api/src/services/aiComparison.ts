import type { CsvValue } from './resultsCsv.js';

// How the AI's marks compare with what the teachers decided: per-answer rows with plain reasons for any
// disagreement, and the summaries built from them. Everything here is a pure function over data we already hold
// (no new AI calls, nothing sent anywhere); the database reading is in routes/aiComparison.ts.

export interface TeacherEntry {
  teacher_id: string | null;
  teacher: string;
  marks: number;
  /** The mark typed in the box is not what the Mark ticks / cross on the answer add up to */
  typed_differs: boolean;
  /** Text notes this teacher wrote on the answer */
  notes: string[];
}

export interface AnswerInput {
  clip_id: string;
  script_id: string;
  student_number: string;
  class_group: string | null;
  question_id: string;
  question_label: string;
  max_marks: number;
  /** What the teachers decided (moderated, else combined as the exam says); null if no teacher has marked it */
  teacher_mark: number | null;
  teachers: TeacherEntry[];
  ai_mark: number;
  ai_reasoning: string | null;
  ai_feedback: string | null;
  has_converted: boolean;
}

export type ReasonCode =
  | 'ai_higher' | 'ai_lower' | 'large_gap' | 'teachers_differ' | 'typed_differs'
  | 'teacher_note' | 'teacher_full' | 'teacher_zero' | 'converted' | 'no_teacher_mark';

export interface Reason { code: ReasonCode; label: string }

export interface AnswerRow extends AnswerInput {
  /** AI mark minus the teachers' mark; null when no teacher has marked it */
  gap: number | null;
  direction: 'same' | 'ai_higher' | 'ai_lower' | null;
  teachers_differ: boolean;
  reasons: Reason[];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function buildRow(a: AnswerInput): AnswerRow {
  const gap = a.teacher_mark === null ? null : a.ai_mark - a.teacher_mark;
  const marks = a.teachers.map((t) => t.marks);
  const teachersDiffer = marks.length > 1 && Math.max(...marks) !== Math.min(...marks);
  const reasons: Reason[] = [];
  if (gap === null) {
    reasons.push({ code: 'no_teacher_mark', label: 'No teacher has marked this answer' });
  } else if (gap !== 0) {
    reasons.push(gap > 0
      ? { code: 'ai_higher', label: `AI gave ${plural(gap, 'mark')} more` }
      : { code: 'ai_lower', label: `AI gave ${plural(-gap, 'mark')} fewer` });
    if (Math.abs(gap) >= Math.max(2, Math.ceil(a.max_marks * 0.3))) reasons.push({ code: 'large_gap', label: 'A large gap' });
    if (a.teacher_mark === a.max_marks) reasons.push({ code: 'teacher_full', label: 'Teachers gave full marks' });
    if (a.teacher_mark === 0) reasons.push({ code: 'teacher_zero', label: 'Teachers gave no marks' });
  }
  if (gap !== 0) {
    if (teachersDiffer) reasons.push({ code: 'teachers_differ', label: `Teachers disagree with each other (${Math.min(...marks)} to ${Math.max(...marks)})` });
    if (a.teachers.some((t) => t.typed_differs)) reasons.push({ code: 'typed_differs', label: 'A teacher typed a mark that is not what their ticks add up to' });
    if (a.teachers.some((t) => t.notes.length)) reasons.push({ code: 'teacher_note', label: 'A teacher left a note on the answer' });
    if (a.has_converted) reasons.push({ code: 'converted', label: 'Handwriting was converted to text (it may be hard to read)' });
  }
  return {
    ...a, gap, teachers_differ: teachersDiffer, reasons,
    direction: gap === null ? null : gap === 0 ? 'same' : gap > 0 ? 'ai_higher' : 'ai_lower',
  };
}

// ── Statistics ────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Stats {
  compared: number;
  exact_pct: number | null;
  within_one_pct: number | null;
  mean_abs_gap: number | null;
  /** Average of (AI minus teacher): positive means the AI is more generous */
  bias: number | null;
}

export function statsOf(gaps: number[]): Stats {
  const n = gaps.length;
  if (n === 0) return { compared: 0, exact_pct: null, within_one_pct: null, mean_abs_gap: null, bias: null };
  const pct = (k: number) => Math.round((k / n) * 100);
  return {
    compared: n,
    exact_pct: pct(gaps.filter((g) => g === 0).length),
    within_one_pct: pct(gaps.filter((g) => Math.abs(g) <= 1).length),
    mean_abs_gap: round2(gaps.reduce((a, g) => a + Math.abs(g), 0) / n),
    bias: round2(gaps.reduce((a, g) => a + g, 0) / n),
  };
}

/** Ranks with ties given the average rank, as Spearman's correlation needs */
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k].i] = avg;
    i = j + 1;
  }
  return out;
}

/** Pearson correlation; null when fewer than 2 points or either side does not vary */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return round2(sxy / Math.sqrt(sxx * syy));
}

/** Rank correlation: do the AI and the teachers put the scripts in the same order? */
export const spearman = (xs: number[], ys: number[]): number | null => pearson(ranks(xs), ranks(ys));

// ── Summaries ─────────────────────────────────────────────────────────────────

export interface GroupStats extends Stats { key: string; label: string }

export interface QuestionSummary extends GroupStats {
  question_id: string;
  max_marks: number;
  /** Answers with an AI mark but no teacher mark yet */
  ai_only: number;
  teachers_differ: number;
  /** Counts of [teacher mark][AI mark]; null when the question is out of more than 15 */
  grid: number[][] | null;
  reasons: { code: ReasonCode; label: string; count: number }[];
}

export interface ScriptSummary {
  script_id: string;
  student_number: string;
  class_group: string | null;
  questions_compared: number;
  teacher_total: number;
  ai_total: number;
  max_total: number;
  gap: number;
}

export interface Analysis {
  overall: Stats;
  rows_total: number;
  without_teacher_mark: number;
  by_question: QuestionSummary[];
  by_script: ScriptSummary[];
  script_correlation: { scripts: number; pearson: number | null; rank: number | null };
  by_band: GroupStats[];
  by_class: GroupStats[];
  by_teacher: GroupStats[];
  reasons: { code: ReasonCode; label: string; count: number }[];
}

const GRID_MAX = 15;

function tally(rows: AnswerRow[]) {
  const counts = new Map<ReasonCode, { label: string; count: number }>();
  for (const r of rows) {
    if (r.gap === null || r.gap === 0) continue;
    for (const reason of r.reasons) {
      // the size words differ per row; group them under one heading
      const label = reason.code === 'ai_higher' ? 'AI gave more marks' : reason.code === 'ai_lower' ? 'AI gave fewer marks' : reason.label;
      const cur = counts.get(reason.code) ?? { label, count: 0 };
      cur.count += 1;
      counts.set(reason.code, cur);
    }
  }
  return [...counts].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.count - a.count);
}

export const bandOf = (mark: number, max: number): 'Low marks' | 'Middle marks' | 'High marks' => {
  const f = max > 0 ? mark / max : 0;
  return f <= 1 / 3 ? 'Low marks' : f <= 2 / 3 ? 'Middle marks' : 'High marks';
};

function groupStats(items: { key: string; label: string; gap: number }[]): GroupStats[] {
  const by = new Map<string, { label: string; gaps: number[] }>();
  for (const i of items) {
    const g = by.get(i.key) ?? { label: i.label, gaps: [] };
    g.gaps.push(i.gap);
    by.set(i.key, g);
  }
  return [...by].map(([key, g]) => ({ key, label: g.label, ...statsOf(g.gaps) }));
}

export function analyse(rows: AnswerRow[], compareLabels: (a: string, b: string) => number = (a, b) => a.localeCompare(b)): Analysis {
  const compared = rows.filter((r) => r.gap !== null);

  const byQuestion = new Map<string, AnswerRow[]>();
  for (const r of rows) byQuestion.set(r.question_id, [...(byQuestion.get(r.question_id) ?? []), r]);
  const by_question: QuestionSummary[] = [...byQuestion.values()].map((qr) => {
    const first = qr[0];
    const cmp = qr.filter((r) => r.gap !== null);
    let grid: number[][] | null = null;
    if (first.max_marks <= GRID_MAX) {
      grid = Array.from({ length: first.max_marks + 1 }, () => new Array<number>(first.max_marks + 1).fill(0));
      for (const r of cmp) {
        if (r.teacher_mark! >= 0 && r.teacher_mark! <= first.max_marks && r.ai_mark >= 0 && r.ai_mark <= first.max_marks) grid[r.teacher_mark!][r.ai_mark] += 1;
      }
    }
    return {
      key: first.question_id, label: first.question_label, question_id: first.question_id, max_marks: first.max_marks,
      ...statsOf(cmp.map((r) => r.gap!)),
      ai_only: qr.length - cmp.length,
      teachers_differ: cmp.filter((r) => r.teachers_differ).length,
      grid,
      reasons: tally(cmp),
    };
  }).sort((a, b) => compareLabels(a.label, b.label));

  const byScript = new Map<string, AnswerRow[]>();
  for (const r of compared) byScript.set(r.script_id, [...(byScript.get(r.script_id) ?? []), r]);
  const by_script: ScriptSummary[] = [...byScript.values()].map((sr) => {
    const teacher_total = sr.reduce((a, r) => a + r.teacher_mark!, 0);
    const ai_total = sr.reduce((a, r) => a + r.ai_mark, 0);
    return {
      script_id: sr[0].script_id, student_number: sr[0].student_number, class_group: sr[0].class_group,
      questions_compared: sr.length, teacher_total, ai_total, max_total: sr.reduce((a, r) => a + r.max_marks, 0), gap: ai_total - teacher_total,
    };
  }).sort((a, b) => a.student_number.localeCompare(b.student_number, undefined, { numeric: true }));

  const bands = groupStats(compared.map((r) => ({ key: bandOf(r.teacher_mark!, r.max_marks), label: bandOf(r.teacher_mark!, r.max_marks), gap: r.gap! })));
  const bandOrder = ['Low marks', 'Middle marks', 'High marks'];
  const perTeacher = rows.flatMap((r) => r.teachers.map((t) => ({ key: t.teacher_id ?? t.teacher, label: t.teacher, gap: r.ai_mark - t.marks })));

  return {
    overall: statsOf(compared.map((r) => r.gap!)),
    rows_total: rows.length,
    without_teacher_mark: rows.length - compared.length,
    by_question,
    by_script,
    script_correlation: {
      scripts: by_script.length,
      pearson: pearson(by_script.map((s) => s.teacher_total), by_script.map((s) => s.ai_total)),
      rank: spearman(by_script.map((s) => s.teacher_total), by_script.map((s) => s.ai_total)),
    },
    by_band: bands.sort((a, b) => bandOrder.indexOf(a.key) - bandOrder.indexOf(b.key)),
    by_class: groupStats(compared.map((r) => ({ key: r.class_group ?? '', label: r.class_group ?? 'No class', gap: r.gap! }))).sort((a, b) => a.label.localeCompare(b.label)),
    by_teacher: groupStats(perTeacher).sort((a, b) => a.label.localeCompare(b.label)),
    reasons: tally(compared),
  };
}

// ── Reading a teacher's annotations ───────────────────────────────────────────

interface AnnotationLike { type?: string; text?: string }

/** What a teacher's ticks and crosses add up to by themselves: one per Mark tick, else 0 if crossed, else null (same rule as the marking page) */
export function ticksMark(data: { annotations?: AnnotationLike[] } | null | undefined): number | null {
  const list = data?.annotations ?? [];
  const ticks = list.filter((a) => a.type === 'mark_tick').length;
  if (ticks > 0) return ticks;
  return list.some((a) => a.type === 'cross' || a.type === 'numbered_cross') ? 0 : null;
}

/** The text notes written on an answer */
export function notesOf(data: { annotations?: AnnotationLike[] } | null | undefined): string[] {
  return (data?.annotations ?? []).filter((a) => a.type === 'text' && a.text?.trim()).map((a) => a.text!.trim());
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface ComparisonFilters {
  /** A class name; '' for scripts with no class; undefined for every class */
  class_group?: string;
  question_ids?: string[];
  exclude_conflicts?: boolean;
  /** Only answers where the AI and the teachers are at least this many marks apart */
  min_gap?: number;
}

export function filterRows(rows: AnswerRow[], f: ComparisonFilters): AnswerRow[] {
  return rows.filter((r) => {
    if (f.class_group !== undefined && (r.class_group ?? '') !== f.class_group) return false;
    if (f.question_ids?.length && !f.question_ids.includes(r.question_id)) return false;
    if (f.exclude_conflicts && r.teachers_differ) return false;
    if (f.min_gap && (r.gap === null || Math.abs(r.gap) < f.min_gap)) return false;
    return true;
  });
}

// ── CSV (rows of cells; the caller adds the byte-order mark with toCsv) ───────


export function answersCsvRows(rows: AnswerRow[]): CsvValue[][] {
  const head: CsvValue[] = [
    'Student number', 'Class', 'Question', 'Out of', 'Teacher mark', 'Teachers (each)', 'AI mark', 'Gap (AI minus teacher)', 'Direction',
    'Teachers differ', 'Typed mark differs from ticks', 'Teacher notes', 'Reasons', 'AI reasoning', 'AI feedback',
  ];
  const dir = { same: 'same', ai_higher: 'AI higher', ai_lower: 'AI lower' } as const;
  const body = rows.map((r): CsvValue[] => [
    r.student_number, r.class_group ?? '', r.question_label, r.max_marks, r.teacher_mark, r.teachers.map((t) => `${t.teacher}: ${t.marks}`).join('; '),
    r.ai_mark, r.gap, r.direction ? dir[r.direction] : '',
    r.teachers_differ ? 'yes' : 'no', r.teachers.some((t) => t.typed_differs) ? 'yes' : 'no',
    r.teachers.flatMap((t) => t.notes).join(' | '), r.reasons.map((x) => x.label).join('; '), r.ai_reasoning ?? '', r.ai_feedback ?? '',
  ]);
  return [head, ...body];
}

export function questionsCsvRows(a: Analysis): CsvValue[][] {
  const head: CsvValue[] = ['Question', 'Out of', 'Answers compared', 'Exactly the same %', 'Within 1 mark %', 'Average gap', 'AI minus teachers (average)', 'Teachers differ', 'AI only (no teacher mark)', 'Commonest reasons for disagreement'];
  const body = a.by_question.map((q): CsvValue[] => [
    q.label, q.max_marks, q.compared, q.exact_pct, q.within_one_pct, q.mean_abs_gap, q.bias, q.teachers_differ, q.ai_only,
    q.reasons.slice(0, 4).map((r) => `${r.label} (${r.count})`).join('; '),
  ]);
  return [head, ...body];
}

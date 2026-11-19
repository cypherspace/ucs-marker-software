// What a whole paper says about the class: how each question went, the strongest and weakest ones, and how the totals are
// spread. Pure functions over the marks that count; reading the database is in routes/classFeedback.ts.

export interface MarkRow {
  script_id: string;
  class_group: string | null;
  question_id: string;
  label: string;
  max_marks: number;
  mark: number;
  /** The counting mark is an AI suggestion (no teacher has marked the answer) */
  ai_only: boolean;
}

export type Tone = 'good' | 'mid' | 'low';

export interface ClassQuestion {
  question_id: string;
  label: string;
  max_marks: number;
  /** Answers with a mark */
  n: number;
  average: number;
  /** Average mark as a percentage of the marks available */
  facility_pct: number;
  tone: Tone;
  ai_only: number;
  /** How many answers earned each mark 0..max (null for a question out of more than 15) */
  distribution: number[] | null;
}

export interface ClassFigures {
  scripts: number;
  answers: number;
  ai_only_answers: number;
  /** Total marks earned over total marks available, as a percentage */
  overall_pct: number | null;
  /** Scripts by percentage band: 0-9, 10-19 ... 90-100 */
  histogram: { from: number; to: number; count: number }[];
  by_question: ClassQuestion[];
  strengths: ClassQuestion[];
  weaknesses: ClassQuestion[];
  by_class: { label: string; scripts: number; average_pct: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
export const toneOf = (facilityPct: number): Tone => (facilityPct >= 70 ? 'good' : facilityPct >= 40 ? 'mid' : 'low');
const DISTRIBUTION_MAX = 15;

export function classFigures(rows: MarkRow[], compareLabels: (a: string, b: string) => number = (a, b) => a.localeCompare(b), top = 3): ClassFigures {
  const byQuestion = new Map<string, MarkRow[]>();
  const byScript = new Map<string, MarkRow[]>();
  for (const r of rows) {
    byQuestion.set(r.question_id, [...(byQuestion.get(r.question_id) ?? []), r]);
    byScript.set(r.script_id, [...(byScript.get(r.script_id) ?? []), r]);
  }

  const by_question: ClassQuestion[] = [...byQuestion.values()].map((qr) => {
    const first = qr[0];
    const average = qr.reduce((a, r) => a + r.mark, 0) / qr.length;
    const facility = first.max_marks > 0 ? (average / first.max_marks) * 100 : 0;
    let distribution: number[] | null = null;
    if (first.max_marks <= DISTRIBUTION_MAX) {
      distribution = new Array<number>(first.max_marks + 1).fill(0);
      for (const r of qr) if (r.mark >= 0 && r.mark <= first.max_marks) distribution[r.mark] += 1;
    }
    return {
      question_id: first.question_id, label: first.label, max_marks: first.max_marks, n: qr.length,
      average: round1(average), facility_pct: Math.round(facility), tone: toneOf(facility),
      ai_only: qr.filter((r) => r.ai_only).length, distribution,
    };
  }).sort((a, b) => compareLabels(a.label, b.label));

  // Strongest and weakest, kept apart: a paper with few questions never lists one in both
  const ranked = [...by_question].sort((a, b) => b.facility_pct - a.facility_pct || compareLabels(a.label, b.label));
  const k = Math.min(top, Math.floor(ranked.length / 2));
  const strengths = ranked.slice(0, k);
  const weaknesses = ranked.slice(ranked.length - k).reverse();

  const pctOfScript = (sr: MarkRow[]) => {
    const possible = sr.reduce((a, r) => a + r.max_marks, 0);
    return possible > 0 ? (sr.reduce((a, r) => a + r.mark, 0) / possible) * 100 : 0;
  };
  const histogram = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
  for (const sr of byScript.values()) histogram[Math.min(9, Math.floor(pctOfScript(sr) / 10))].count += 1;

  const classes = new Map<string, MarkRow[][]>();
  for (const sr of byScript.values()) {
    const key = sr[0].class_group ?? '';
    classes.set(key, [...(classes.get(key) ?? []), sr]);
  }
  const possible = rows.reduce((a, r) => a + r.max_marks, 0);

  return {
    scripts: byScript.size,
    answers: rows.length,
    ai_only_answers: rows.filter((r) => r.ai_only).length,
    overall_pct: possible > 0 ? round1((rows.reduce((a, r) => a + r.mark, 0) / possible) * 100) : null,
    histogram,
    by_question,
    strengths,
    weaknesses,
    by_class: [...classes].map(([key, scripts]) => ({
      label: key || 'No class', scripts: scripts.length, average_pct: round1(scripts.reduce((a, sr) => a + pctOfScript(sr), 0) / scripts.length),
    })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

// ── The report as text blocks, with charts, for the PDF maker ────────────────────────────────────────────────────────

export interface Themes { strengths: string[]; weaknesses: string[] }
export interface Overall extends Themes { next_steps: string[] }

export interface ChartItem { label: string; value: number; max: number; tone?: Tone }
export interface ReportBlock {
  heading: string;
  paragraphs: { label?: string; text: string }[];
  chart?: { kind: 'hbar' | 'columns'; items: ChartItem[]; unit: string; caption?: string };
}

const list = (items: string[]) => items.map((t) => `• ${t}`).join('\n');
const clean = (s: string, n = 300) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** `themes` and `overall` are optional: without them the report is figures and charts only. */
export function reportBlocks(
  f: ClassFigures, title: string, themes: Map<string, Themes> = new Map(), overall: Overall | null = null,
): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const summary: ReportBlock['paragraphs'] = [
    { label: 'Scripts', text: `${f.scripts} (${f.answers} marked answers)` },
    { label: 'Average', text: f.overall_pct === null ? 'Not marked yet' : `${f.overall_pct}% of the marks available` },
  ];
  if (f.ai_only_answers > 0) summary.push({ text: `${f.ai_only_answers} of the marks used are AI suggestions where a teacher has not yet marked the answer.` });
  blocks.push({ heading: title, paragraphs: summary });

  if (overall && (overall.strengths.length || overall.weaknesses.length || overall.next_steps.length)) {
    const paragraphs: ReportBlock['paragraphs'] = [];
    if (overall.strengths.length) paragraphs.push({ label: 'What the class did well', text: list(overall.strengths.map((t) => clean(t))) });
    if (overall.weaknesses.length) paragraphs.push({ label: 'Where the class lost marks', text: list(overall.weaknesses.map((t) => clean(t))) });
    if (overall.next_steps.length) paragraphs.push({ label: 'Suggested next steps', text: list(overall.next_steps.map((t) => clean(t))) });
    paragraphs.push({ text: 'These themes were written by an AI from the feedback it gave on each answer. Please check them against your own view of the class.' });
    blocks.push({ heading: 'Summary of strengths and weaknesses', paragraphs });
  }

  const fig = (q: { label: string; facility_pct: number }) => `Q${q.label} (${q.facility_pct}%)`;
  blocks.push({
    heading: 'Strongest and weakest questions',
    paragraphs: [
      ...(f.strengths.length ? [{ label: 'Strongest', text: f.strengths.map(fig).join(', ') }] : []),
      ...(f.weaknesses.length ? [{ label: 'Weakest', text: f.weaknesses.map(fig).join(', ') }] : []),
      { text: 'The figure is the average mark as a percentage of the marks available for that question.' },
    ],
  });
  blocks.push({
    heading: 'How each question went',
    paragraphs: [],
    chart: { kind: 'hbar', unit: '%', items: f.by_question.map((q) => ({ label: `Q${q.label}`, value: q.facility_pct, max: 100, tone: q.tone })) },
  });
  blocks.push({
    heading: 'Spread of totals',
    paragraphs: [],
    chart: {
      kind: 'columns', unit: '', caption: 'Number of scripts by percentage of the marks earned',
      items: f.histogram.map((h) => ({ label: `${h.from}`, value: h.count, max: Math.max(1, ...f.histogram.map((x) => x.count)) })),
    },
  });
  if (f.by_class.length > 1) {
    blocks.push({
      heading: 'By class',
      paragraphs: [],
      chart: { kind: 'hbar', unit: '%', items: f.by_class.map((c) => ({ label: `${c.label} (${c.scripts})`, value: c.average_pct, max: 100, tone: toneOf(c.average_pct) })) },
    });
  }

  const perQuestion = f.by_question.filter((q) => themes.has(q.question_id) && (themes.get(q.question_id)!.strengths.length || themes.get(q.question_id)!.weaknesses.length));
  for (const q of perQuestion) {
    const t = themes.get(q.question_id)!;
    const paragraphs: ReportBlock['paragraphs'] = [];
    if (t.strengths.length) paragraphs.push({ label: 'Did well', text: list(t.strengths.map((x) => clean(x))) });
    if (t.weaknesses.length) paragraphs.push({ label: 'Lost marks', text: list(t.weaknesses.map((x) => clean(x))) });
    blocks.push({ heading: `Q${q.label}: average ${q.average} / ${q.max_marks} (${q.facility_pct}%)`, paragraphs });
  }
  return blocks;
}

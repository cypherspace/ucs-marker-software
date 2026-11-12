// Question labels: a number, then an optional part and sub-part, written 2(a)(i).
// Stored in exam_questions.question_number as that canonical text (older rows may hold "2ai" or "2a").
// KEEP IN SYNC with apps/marker/frontend/src/lib/questionLabel.ts (the API cannot import the frontend).

export interface QuestionParts { number: string; part: string; sub: string }

const ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv'];
const romanValue = (s: string) => ROMANS.indexOf(s.toLowerCase()) + 1; // 0 when not a numeral

// Reads "2", "2a", "2(a)", "2(a)(ii)", "2aii", "2.a.ii", "2 a ii", "Q2ai". Null when it is not that shape.
export function parseQuestionLabel(raw: string): QuestionParts | null {
  const m = raw.trim().replace(/^q(uestion)?\.?\s*/i, '').match(/^(\d+)\s*(.*)$/);
  if (!m) return null;
  const number = String(Number(m[1]));
  const tokens = m[2].split(/[\s().,\-]+/).filter(Boolean).map((t) => t.toLowerCase());
  if (tokens.length === 0) return { number, part: '', sub: '' };
  if (tokens.length === 2) {
    return /^[a-z]$/.test(tokens[0]) && romanValue(tokens[1]) > 0 ? { number, part: tokens[0], sub: tokens[1] } : null;
  }
  if (tokens.length > 2) return null;
  const t = tokens[0];
  if (romanValue(t) > 0) return { number, part: '', sub: t };               // 1(ii), "1iv"
  if (/^[a-z]$/.test(t)) return { number, part: t, sub: '' };               // 1(a)
  if (/^[a-z]/.test(t) && romanValue(t.slice(1)) > 0) return { number, part: t[0], sub: t.slice(1) }; // 1aii
  return null;
}

export function formatQuestionLabel(p: QuestionParts): string {
  return `${p.number}${p.part ? `(${p.part})` : ''}${p.sub ? `(${p.sub})` : ''}`;
}

// The canonical spelling when the text is a recognisable label, otherwise the text as typed
export function normaliseQuestionLabel(raw: string): string {
  const p = parseQuestionLabel(raw);
  return p ? formatQuestionLabel(p) : raw.trim();
}

// Order for sorting: by number, then part (a, b, c), then sub-part (i, ii, iii); odd labels last
export function compareQuestionLabels(a: string, b: string): number {
  const pa = parseQuestionLabel(a);
  const pb = parseQuestionLabel(b);
  if (pa && pb) {
    return Number(pa.number) - Number(pb.number)
      || (pa.part || '').localeCompare(pb.part || '')
      || romanValue(pa.sub) - romanValue(pb.sub);
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export const sortByQuestionLabel = <T extends { question_number: string }>(items: T[]): T[] =>
  [...items].sort((x, y) => compareQuestionLabels(x.question_number, y.question_number));

// Rows already grouped by an earlier sort key (e.g. exam age): keep the groups in order, sort questions within each
export function sortWithinGroups<T extends { question_number: string }>(rows: T[], groupOf: (r: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const g = groups.get(groupOf(r));
    if (g) g.push(r); else groups.set(groupOf(r), [r]);
  }
  return [...groups.values()].flatMap((g) => sortByQuestionLabel(g));
}

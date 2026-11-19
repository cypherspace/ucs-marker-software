import { describe, expect, it } from 'vitest';
import { classFigures, reportBlocks, toneOf, type MarkRow } from './classReport.js';

let n = 0;
const row = (o: Partial<MarkRow>): MarkRow => ({ script_id: `s${n++}`, class_group: '10A', question_id: 'q1', label: '1', max_marks: 4, mark: 2, ai_only: false, ...o });

describe('classFigures', () => {
  // three scripts, three questions
  const rows: MarkRow[] = [
    ...['a', 'b', 'c'].flatMap((s, i) => [
      row({ script_id: s, question_id: 'q1', label: '1', max_marks: 4, mark: [4, 4, 3][i] }),
      row({ script_id: s, question_id: 'q2', label: '2', max_marks: 4, mark: [2, 2, 2][i], class_group: i === 2 ? '10B' : '10A' }),
      row({ script_id: s, question_id: 'q10', label: '10', max_marks: 10, mark: [0, 1, 0][i], ai_only: i === 0 }),
    ]),
  ].map((r, i) => (r.script_id === 'c' ? { ...r, class_group: '10B' } : r));
  const f = classFigures(rows, (a, b) => Number(a) - Number(b));

  it('works out each question, in question order', () => {
    expect(f.by_question.map((q) => [q.label, q.n, q.average, q.facility_pct, q.tone])).toEqual([
      ['1', 3, 3.7, 92, 'good'], ['2', 3, 2, 50, 'mid'], ['10', 3, 0.3, 3, 'low'],
    ]);
    expect(f.by_question[0].distribution).toEqual([0, 0, 0, 1, 2]);
    expect(f.by_question[2].ai_only).toBe(1);
  });
  it('lists the strongest and weakest questions apart (one each when there are only three)', () => {
    expect(f.strengths.map((q) => q.label)).toEqual(['1']);
    expect(f.weaknesses.map((q) => q.label)).toEqual(['10']);
  });
  it('takes up to three of each on a longer paper', () => {
    const many = Array.from({ length: 8 }, (_, i) => row({ script_id: 'x', question_id: `m${i}`, label: String(i + 1), mark: i % 5 }));
    const g = classFigures(many, (a, b) => Number(a) - Number(b));
    expect(g.strengths).toHaveLength(3); expect(g.weaknesses).toHaveLength(3);
    expect(g.strengths.every((s) => !g.weaknesses.includes(s))).toBe(true);
    expect(g.strengths[0].facility_pct).toBeGreaterThanOrEqual(g.strengths[2].facility_pct);
  });
  it('spreads the totals into ten bands, and averages by class', () => {
    expect(f.scripts).toBe(3);
    expect(f.histogram).toHaveLength(10);
    expect(f.histogram.reduce((a, h) => a + h.count, 0)).toBe(3);
    // script a: 6/18 = 33%, b: 7/18 = 38%, c: 5/18 = 27%
    expect(f.histogram[3].count).toBe(2); expect(f.histogram[2].count).toBe(1);
    expect(f.by_class.map((c) => [c.label, c.scripts])).toEqual([['10A', 2], ['10B', 1]]);
    expect(f.overall_pct).toBe(33.3);
    expect(f.ai_only_answers).toBe(1);
  });
  it('a full-marks script lands in the top band, and an empty paper has no figures', () => {
    expect(classFigures([row({ script_id: 'z', mark: 4 })]).histogram[9].count).toBe(1);
    const none = classFigures([]);
    expect(none.scripts).toBe(0); expect(none.overall_pct).toBeNull(); expect(none.by_question).toEqual([]);
  });
  it('tones', () => { expect(toneOf(70)).toBe('good'); expect(toneOf(69.9)).toBe('mid'); expect(toneOf(40)).toBe('mid'); expect(toneOf(39)).toBe('low'); });
  it('no distribution for a question out of more than 15', () => {
    expect(classFigures([row({ max_marks: 20, mark: 10 })]).by_question[0].distribution).toBeNull();
  });
});

describe('reportBlocks', () => {
  const f = classFigures([row({ script_id: 'a', mark: 4 }), row({ script_id: 'b', mark: 1 })]);
  it('has figures and charts without any AI themes', () => {
    const b = reportBlocks(f, 'Mocks');
    expect(b[0].heading).toBe('Mocks');
    expect(b.some((x) => x.chart?.kind === 'hbar')).toBe(true);
    expect(b.some((x) => x.chart?.kind === 'columns')).toBe(true);
    expect(b.some((x) => x.heading === 'Summary of strengths and weaknesses')).toBe(false);
  });
  it('adds the themes, with a note that an AI wrote them', () => {
    const b = reportBlocks(f, 'Mocks', new Map([['q1', { strengths: ['Clear working'], weaknesses: ['Units omitted'] }]]), { strengths: ['Good recall'], weaknesses: ['Units'], next_steps: ['Practise units'] });
    const s = b.find((x) => x.heading === 'Summary of strengths and weaknesses')!;
    expect(s.paragraphs.map((p) => p.label ?? 'note')).toEqual(['What the class did well', 'Where the class lost marks', 'Suggested next steps', 'note']);
    expect(s.paragraphs[0].text).toBe('• Good recall');
    expect(b.find((x) => x.heading.startsWith('Q1:'))!.paragraphs[1].text).toBe('• Units omitted');
  });
  it('only draws the by-class chart when there is more than one class', () => {
    expect(reportBlocks(f, 'x').some((x) => x.heading === 'By class')).toBe(false);
    const two = classFigures([row({ script_id: 'a', class_group: 'A' }), row({ script_id: 'b', class_group: 'B' })]);
    expect(reportBlocks(two, 'x').some((x) => x.heading === 'By class')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { buildResultsTable } from './resultsTable.js';
import type { ResultRow } from './results.js';

let n = 0;
const row = (over: Partial<ResultRow> & Pick<ResultRow, 'script_id' | 'student_number' | 'question_id' | 'question_number'>): ResultRow => ({
  student_name: null, class_group: null, max_marks: 4, marking_mode: 'marks', clip_id: `clip${++n}`,
  marks_awarded: null, mark_source: null, ai_marks_awarded: null, ai_feedback: null, ...over,
});

describe('buildResultsTable', () => {
  const rows: ResultRow[] = [
    row({ script_id: 's10', student_number: '10', question_id: 'q1', question_number: '1', marks_awarded: 3, mark_source: 'human', class_group: '10A' }),
    row({ script_id: 's10', student_number: '10', question_id: 'q2b', question_number: '2(b)', max_marks: 6, marks_awarded: 5, mark_source: 'ai', class_group: '10A' }),
    row({ script_id: 's10', student_number: '10', question_id: 'q2a', question_number: '2(a)', max_marks: 2, marks_awarded: null, class_group: '10A' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q1', question_number: '1', marks_awarded: 4, mark_source: 'human', class_group: '10B' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q2a', question_number: '2(a)', max_marks: 2, marks_awarded: 2, mark_source: 'human', class_group: '10B' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q9', question_number: '9', marking_mode: 'comparative', marks_awarded: 7, mark_source: 'human', class_group: '10B' }),
  ];
  const t = buildResultsTable(rows, rows, true);

  it('lists questions in question order, not text order', () => {
    expect(t.questions.map((q) => q.question_number)).toEqual(['1', '2(a)', '2(b)', '9']);
  });

  it('lists scripts in natural student-number order', () => {
    expect(t.rows.map((r) => r.student_number)).toEqual(['2', '10']);
  });

  it('adds up only marks-mode answers that have a mark, and the maximum for those same answers', () => {
    const s10 = t.rows.find((r) => r.script_id === 's10')!;
    expect(s10.total).toBe(8);      // 3 + 5; 2(a) is unmarked
    expect(s10.possible).toBe(10);  // 4 + 6
    const s2 = t.rows.find((r) => r.script_id === 's2')!;
    expect(s2.total).toBe(6);       // the comparative answer is left out
    expect(s2.possible).toBe(6);
  });

  it('keeps the source of each mark so the AI-only ones can be told apart', () => {
    const s10 = t.rows.find((r) => r.script_id === 's10')!;
    expect(s10.cells.q2b).toMatchObject({ marks: 5, source: 'ai' });
    expect(s10.cells.q2a).toMatchObject({ marks: null });
  });

  it('counts scripts per class, with no-class last', () => {
    const withNone = buildResultsTable([...rows, row({ script_id: 's3', student_number: '3', question_id: 'q1', question_number: '1' })], rows, true);
    expect(withNone.classes).toEqual([{ name: '10A', scripts: 1 }, { name: '10B', scripts: 1 }, { name: null, scripts: 1 }]);
  });

  it('gives the per-question figures', () => {
    const q1 = t.stats.find((s) => s.question_id === 'q1')!;
    expect(q1).toMatchObject({ scripts: 2, marked: 2, mean: 3.5, min: 3, max: 4 });
    const q2a = t.stats.find((s) => s.question_id === 'q2a')!;
    expect(q2a).toMatchObject({ scripts: 2, marked: 1, mean: 2 });
  });

  it('filtering by class keeps the class list and the questions, but only that class\'s scripts', () => {
    const onlyB = buildResultsTable(rows, rows.filter((r) => r.class_group === '10B'), true);
    expect(onlyB.rows.map((r) => r.script_id)).toEqual(['s2']);
    expect(onlyB.classes).toHaveLength(2);
    expect(onlyB.questions).toHaveLength(4);
  });

  it('reports a limited scope', () => {
    expect(buildResultsTable(rows, rows, false).scope).toBe('limited');
  });
});

import { describe, expect, it } from 'vitest';
import { analyse, bandOf, buildRow, pearson, spearman, statsOf, type AnswerInput } from './aiComparison.js';

const base: AnswerInput = {
  clip_id: 'c1', script_id: 's1', student_number: '001', class_group: '10A', question_id: 'q1', question_label: '1(a)', max_marks: 4,
  teacher_mark: 3, teachers: [{ teacher_id: 't1', teacher: 'Ms A', marks: 3, typed_differs: false, notes: [] }],
  ai_mark: 3, ai_reasoning: 'r', ai_feedback: 'f', has_converted: false,
};
const row = (o: Partial<AnswerInput>) => buildRow({ ...base, ...o });
const codes = (r: ReturnType<typeof row>) => r.reasons.map((x) => x.code);

describe('buildRow reasons', () => {
  it('an exact match has no reasons', () => {
    const r = row({});
    expect(r.gap).toBe(0); expect(r.direction).toBe('same'); expect(r.reasons).toEqual([]);
  });
  it('says which way and by how much', () => {
    expect(row({ ai_mark: 4 }).reasons[0]).toEqual({ code: 'ai_higher', label: 'AI gave 1 mark more' });
    expect(row({ ai_mark: 1 }).reasons[0]).toEqual({ code: 'ai_lower', label: 'AI gave 2 marks fewer' });
    expect(row({ ai_mark: 1 }).direction).toBe('ai_lower');
  });
  it('flags a large gap (30% of the marks, at least 2)', () => {
    expect(codes(row({ ai_mark: 4 }))).not.toContain('large_gap');          // gap 1
    expect(codes(row({ ai_mark: 1 }))).toContain('large_gap');              // gap 2 of 4
    expect(codes(row({ max_marks: 10, teacher_mark: 5, ai_mark: 7 }))).not.toContain('large_gap');   // gap 2 < 3
    expect(codes(row({ max_marks: 10, teacher_mark: 5, ai_mark: 8 }))).toContain('large_gap');
  });
  it('notes when teachers gave full marks or none', () => {
    expect(codes(row({ teacher_mark: 4, ai_mark: 2 }))).toContain('teacher_full');
    expect(codes(row({ teacher_mark: 0, ai_mark: 2 }))).toContain('teacher_zero');
  });
  it('says when the teachers disagree with each other, only when the AI disagrees too', () => {
    const t = [
      { teacher_id: 't1', teacher: 'A', marks: 2, typed_differs: false, notes: [] },
      { teacher_id: 't2', teacher: 'B', marks: 4, typed_differs: false, notes: [] },
    ];
    const r = row({ teacher_mark: 3, teachers: t, ai_mark: 1 });
    expect(r.teachers_differ).toBe(true);
    expect(r.reasons.find((x) => x.code === 'teachers_differ')?.label).toContain('2 to 4');
    expect(codes(row({ teacher_mark: 3, teachers: t, ai_mark: 3 }))).toEqual([]);
  });
  it('mentions a typed mark that is not the tick count, a note, and converted handwriting', () => {
    const r = row({ ai_mark: 1, has_converted: true, teachers: [{ teacher_id: 't1', teacher: 'A', marks: 3, typed_differs: true, notes: ['hard to read'] }] });
    expect(codes(r)).toEqual(expect.arrayContaining(['typed_differs', 'teacher_note', 'converted']));
  });
  it('an answer no teacher has marked has no gap', () => {
    const r = row({ teacher_mark: null, teachers: [] });
    expect(r.gap).toBeNull(); expect(r.direction).toBeNull(); expect(codes(r)).toEqual(['no_teacher_mark']);
  });
});

describe('statistics', () => {
  it('statsOf', () => {
    expect(statsOf([])).toEqual({ compared: 0, exact_pct: null, within_one_pct: null, mean_abs_gap: null, bias: null });
    expect(statsOf([0, 1, -1, 3])).toEqual({ compared: 4, exact_pct: 25, within_one_pct: 75, mean_abs_gap: 1.25, bias: 0.75 });
  });
  it('correlations', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBe(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBe(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
    expect(spearman([10, 20, 30, 40], [1, 5, 6, 100])).toBe(1);   // same order even though not linear
    expect(spearman([1, 2, 2, 4], [1, 2, 2, 4])).toBe(1);        // ties
  });
  it('bands by the teachers\' mark', () => {
    expect(bandOf(0, 6)).toBe('Low marks'); expect(bandOf(2, 6)).toBe('Low marks');
    expect(bandOf(3, 6)).toBe('Middle marks'); expect(bandOf(4, 6)).toBe('Middle marks');
    expect(bandOf(5, 6)).toBe('High marks');
  });
});

describe('analyse', () => {
  const rows = [
    row({ clip_id: 'a', script_id: 's1', student_number: '001', teacher_mark: 4, ai_mark: 4, teachers: [{ teacher_id: 't1', teacher: 'A', marks: 4, typed_differs: false, notes: [] }] }),
    row({ clip_id: 'b', script_id: 's2', student_number: '002', class_group: '10B', teacher_mark: 2, ai_mark: 4, teachers: [{ teacher_id: 't1', teacher: 'A', marks: 2, typed_differs: false, notes: [] }] }),
    row({ clip_id: 'c', script_id: 's3', student_number: '003', class_group: '10B', teacher_mark: 0, ai_mark: 1, teachers: [{ teacher_id: 't2', teacher: 'B', marks: 0, typed_differs: false, notes: [] }] }),
    row({ clip_id: 'd', script_id: 's4', student_number: '004', teacher_mark: null, teachers: [], ai_mark: 3 }),
  ];
  const a = analyse(rows);
  it('counts compared answers and those without a teacher mark', () => {
    expect(a.overall.compared).toBe(3); expect(a.without_teacher_mark).toBe(1); expect(a.rows_total).toBe(4);
    expect(a.overall.bias).toBe(1);   // (0 + 2 + 1) / 3
  });
  it('per question: stats, grid and reason counts', () => {
    const q = a.by_question[0];
    expect(q.compared).toBe(3); expect(q.ai_only).toBe(1);
    expect(q.grid![4][4]).toBe(1); expect(q.grid![2][4]).toBe(1); expect(q.grid![0][1]).toBe(1);
    expect(q.reasons.find((r) => r.code === 'ai_higher')?.count).toBe(2);
  });
  it('per script totals and correlation ignore the unmarked answer', () => {
    expect(a.by_script.map((s) => s.student_number)).toEqual(['001', '002', '003']);
    expect(a.by_script[1]).toMatchObject({ teacher_total: 2, ai_total: 4, gap: 2 });
    expect(a.script_correlation.scripts).toBe(3);
  });
  it('groups by band, class and teacher', () => {
    expect(a.by_band.map((b) => b.key)).toEqual(['Low marks', 'Middle marks', 'High marks']);
    expect(a.by_class.map((c) => [c.label, c.compared])).toEqual([['10A', 1], ['10B', 2]]);
    expect(a.by_teacher.map((t) => [t.label, t.compared])).toEqual([['A', 2], ['B', 1]]);
  });
  it('omits the grid for questions out of more than 15', () => {
    const big = analyse([row({ max_marks: 20, teacher_mark: 10, ai_mark: 12 })]);
    expect(big.by_question[0].grid).toBeNull();
  });
});

import { answersCsvRows, filterRows, notesOf, questionsCsvRows, ticksMark } from './aiComparison.js';
import { toCsv } from './resultsCsv.js';

describe('annotations', () => {
  it('ticksMark follows the marking page rule', () => {
    expect(ticksMark({ annotations: [{ type: 'mark_tick' }, { type: 'mark_tick' }, { type: 'text', text: 'x' }] })).toBe(2);
    expect(ticksMark({ annotations: [{ type: 'cross' }] })).toBe(0);
    expect(ticksMark({ annotations: [{ type: 'tick' }] })).toBeNull();
    expect(ticksMark(null)).toBeNull();
  });
  it('notesOf returns the text notes', () => {
    expect(notesOf({ annotations: [{ type: 'text', text: ' hard to read ' }, { type: 'text', text: '  ' }, { type: 'tick' }] })).toEqual(['hard to read']);
  });
});

describe('filters and csv', () => {
  const rows = [
    row({ clip_id: 'a', class_group: '10A', teacher_mark: 3, ai_mark: 3 }),
    row({ clip_id: 'b', class_group: null, teacher_mark: 1, ai_mark: 4 }),
    row({ clip_id: 'c', class_group: '10A', question_id: 'q2', teacher_mark: null, teachers: [], ai_mark: 2 }),
  ];
  it('filters by class (including none), question and minimum gap', () => {
    expect(filterRows(rows, { class_group: '10A' }).map((r) => r.clip_id)).toEqual(['a', 'c']);
    expect(filterRows(rows, { class_group: '' }).map((r) => r.clip_id)).toEqual(['b']);
    expect(filterRows(rows, { question_ids: ['q2'] }).map((r) => r.clip_id)).toEqual(['c']);
    expect(filterRows(rows, { min_gap: 2 }).map((r) => r.clip_id)).toEqual(['b']);
  });
  it('csv carries the reasons, is safe against formulas and has a BOM', () => {
    const csv = toCsv(answersCsvRows([row({ ai_mark: 1, ai_reasoning: '=SUM(A1)', teachers: [{ teacher_id: 't', teacher: 'A', marks: 3, typed_differs: false, notes: ['a, b'] }] })]));
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('AI gave 2 marks fewer');
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('"a, b"');
    expect(toCsv(questionsCsvRows(analyse([row({})])))).toContain('1(a)');
  });
});

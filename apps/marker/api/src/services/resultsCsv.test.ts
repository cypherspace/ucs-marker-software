import { describe, expect, it } from 'vitest';
import { csvCell, detailedCsv, naturalScriptOrder, overviewCsv, teacherExtras, toCsv } from './resultsCsv.js';
import { buildResultsTable } from './resultsTable.js';
import type { ResultRow } from './results.js';

let n = 0;
const row = (over: Partial<ResultRow> & Pick<ResultRow, 'script_id' | 'student_number' | 'question_id' | 'question_number'>): ResultRow => ({
  student_name: null, class_group: null, max_marks: 4, marking_mode: 'marks', clip_id: `clip${++n}`,
  marks_awarded: null, mark_source: null, ai_marks_awarded: null, ai_feedback: null, ...over,
});

describe('csvCell and toCsv', () => {
  it('writes numbers as they are and blanks for nothing', () => {
    expect(csvCell(3)).toBe('3');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('quotes commas, quotes, newlines and carriage returns', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"');
  });
  it('stops text being run as a spreadsheet formula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-x')).toBe("'-x");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('=1,2')).toBe('"\'=1,2"');
    // a real negative number is a number, not text
    expect(csvCell(-2)).toBe('-2');
  });
  it('starts with a byte-order mark and ends rows with CRLF', () => {
    const out = toCsv([['a', 'b'], [1, 2]]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.slice(1)).toBe('a,b\r\n1,2\r\n');
  });
});

describe('overviewCsv', () => {
  const rows: ResultRow[] = [
    row({ script_id: 's10', student_number: '10', question_id: 'q1', question_number: '1', marks_awarded: 3, mark_source: 'human', class_group: '10A', student_name: 'Ann Lee' }),
    row({ script_id: 's10', student_number: '10', question_id: 'q2a', question_number: '2a', max_marks: 6, marks_awarded: 5, mark_source: 'ai', class_group: '10A', student_name: 'Ann Lee' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q1', question_number: '1', marks_awarded: 4, mark_source: 'human', class_group: null, student_name: 'Bo "B" Ng' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q2a', question_number: '2a', max_marks: 6, marks_awarded: null, student_name: 'Bo "B" Ng' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q5', question_number: '5', marking_mode: 'comparative', clip_id: 'cmp-s2', student_name: 'Bo "B" Ng' }),
  ];
  const table = buildResultsTable(rows, rows, true);
  const lines = (csv: string) => csv.replace('﻿', '').trim().split('\r\n');

  it('has one row per script and one column per question, labelled and in order', () => {
    const out = lines(overviewCsv(table));
    expect(out[0]).toBe('Student number,Class,Q1 (/4),Q2(a) (/6),Q5 rank,Q5 score,Total,Out of,Percent,Questions marked,Questions in paper,Counted from AI only');
    expect(out).toHaveLength(3);
  });

  it('lists scripts in natural order with numeric cells, totals, percent and counts', () => {
    const out = lines(overviewCsv(table));
    expect(out[1]).toBe('2,,4,,,,4,4,100,1,2,');
    expect(out[2]).toBe('10,10A,3,5,,,8,10,80,2,2,Q2(a)');
  });

  it('adds names only when asked, quoted safely', () => {
    const names = new Map(rows.map((r) => [r.script_id, r.student_name] as const));
    const out = lines(overviewCsv(table, { names }));
    expect(out[0].startsWith('Student number,Student name,Class,')).toBe(true);
    expect(out[1].startsWith('2,"Bo ""B"" Ng",')).toBe(true);
    expect(lines(overviewCsv(table)).join('\n')).not.toContain('Ann Lee');
  });

  it('fills the comparative rank and score from the ranking', () => {
    const ranks = new Map([['s2:q5', { rank: 1, score: 0.512 }]]);
    const out = lines(overviewCsv(table, { ranks }));
    expect(out[1]).toBe('2,,4,,1,0.512,4,4,100,1,2,');
  });

  it('leaves the totals blank for a script with nothing marked yet', () => {
    const empty = [row({ script_id: 's1', student_number: '1', question_id: 'q1', question_number: '1' })];
    const out = lines(overviewCsv(buildResultsTable(empty, empty, true)));
    expect(out[1]).toBe('1,,,,,,0,1,');
  });
});

describe('detailedCsv', () => {
  const rows: ResultRow[] = [
    row({ script_id: 's10', student_number: '10', question_id: 'q1', question_number: '1', marks_awarded: 3, mark_source: 'human', ai_marks_awarded: 2, ai_feedback: '=bad, "x"', clip_id: 'c10' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q2b', question_number: '2b', marks_awarded: 1, mark_source: 'human', clip_id: 'c2b' }),
    row({ script_id: 's2', student_number: '2', question_id: 'q1', question_number: '1', marks_awarded: 4, mark_source: 'human', clip_id: 'c2a' }),
  ];
  const lines = (csv: string) => csv.replace('﻿', '').trim().split('\r\n');

  it('keeps the long format, with readable labels, natural order and safe text', () => {
    const out = lines(detailedCsv(rows, { includeNames: false }));
    expect(out[0]).toBe('student_number,class,question,max_marks,marks_awarded,mark_source,ai_marks_awarded,ai_feedback');
    expect(out.map((l) => l.split(',')[0] + ':' + l.split(',')[2])).toContain('10:1');
    expect(out[out.length - 1]).toContain('"\'=bad, ""x"""');
  });

  it('orders scripts 2 then 10 and questions within a script as written', () => {
    const order = naturalScriptOrder(rows).map((r) => `${r.student_number}/${r.question_number}`);
    expect(order).toEqual(['2/2b', '2/1', '10/1']);
  });

  it('adds one column per teacher with the mean and whether they differ', () => {
    const marks = new Map([['c10', new Map([['t1', 3], ['t2', 4]])]]);
    const out = lines(detailedCsv(rows, { includeNames: false, perTeacher: { cols: [{ id: 't1', email: 'a@x.org' }, { id: 't2', email: 'b@x.org' }], marks } }));
    expect(out[0].endsWith('mark_a@x.org,mark_b@x.org,teacher_mean,teachers_differ')).toBe(true);
    expect(teacherExtras([{ id: 't1' }, { id: 't2' }], marks.get('c10'))).toEqual([3, 4, 3.5, 'yes']);
    expect(teacherExtras([{ id: 't1' }], new Map([['t1', 2]]))).toEqual([2, 2, '']);
    expect(teacherExtras([{ id: 't1' }], undefined)).toEqual([null, null, '']);
  });
});

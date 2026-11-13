import { describe, expect, it } from 'vitest';
import { agreementState, combineMarks, meanOf, roundHalfUp, spreadOf, type TeacherMark } from './markCombine.js';

const m = (teacher_id: string, marks: number, marked_at: string): TeacherMark => ({ teacher_id, marks, marked_at });

describe('combineMarks', () => {
  const marks = [m('t1', 1, '2026-01-01T10:00:00Z'), m('t2', 2, '2026-01-01T11:00:00Z'), m('lead', 4, '2026-01-01T09:00:00Z')];
  it('latest takes the newest teacher mark', () => expect(combineMarks(marks, 'latest')).toBe(2));
  it('average rounds half up', () => {
    expect(combineMarks([m('a', 1, '2026-01-01'), m('b', 2, '2026-01-01')], 'average')).toBe(2);
    expect(combineMarks(marks, 'average')).toBe(2); // (1+2+4)/3 = 2.33
  });
  it('lead takes the lead teacher mark, else the average', () => {
    expect(combineMarks(marks, 'lead', 'lead')).toBe(4);
    expect(combineMarks(marks.slice(0, 2), 'lead', 'lead')).toBe(2); // 1.5 rounds up
  });
  it('is null when nobody marked it', () => expect(combineMarks([], 'average')).toBeNull());
});

describe('agreement', () => {
  it('classifies none, single, agreed and conflict', () => {
    expect(agreementState([])).toBe('none');
    expect(agreementState([3])).toBe('single');
    expect(agreementState([3, 3])).toBe('agreed');
    expect(agreementState([3, 2])).toBe('conflict');
  });
  it('measures the spread and the mean', () => {
    expect(spreadOf([1, 4, 2])).toBe(3);
    expect(spreadOf([])).toBe(0);
    expect(meanOf([1, 2])).toBe(1.5);
    expect(meanOf([])).toBeNull();
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.49)).toBe(2);
  });
});

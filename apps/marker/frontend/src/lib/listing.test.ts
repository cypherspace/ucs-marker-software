import { describe, expect, it } from 'vitest';
import { arrangeMarking, filterExams, sortExams, type ExamLike } from './listing';

const exam = (name: string, over: Partial<ExamLike> = {}): ExamLike => ({
  name, status: 'marking', created_at: '2026-01-01T00:00:00Z', clips_total: 10, clips_marked: 5, ...over,
});

describe('sortExams', () => {
  const list = [
    exam('Beta', { created_at: '2026-02-01T00:00:00Z', clips_marked: 9 }),
    exam('alpha', { created_at: '2026-03-01T00:00:00Z', clips_marked: 1 }),
    exam('Gamma', { created_at: '2026-01-01T00:00:00Z', clips_total: 0, clips_marked: 0 }),
  ];
  const names = (l: ExamLike[]) => l.map((e) => e.name);
  it('newest first by default', () => expect(names(sortExams(list, 'newest'))).toEqual(['alpha', 'Beta', 'Gamma']));
  it('by name, ignoring case', () => expect(names(sortExams(list, 'name'))).toEqual(['alpha', 'Beta', 'Gamma']));
  it('most left to mark first', () => expect(names(sortExams(list, 'remaining'))).toEqual(['alpha', 'Beta', 'Gamma']));
  it('least finished first, nothing-to-mark last', () => expect(names(sortExams(list, 'progress'))).toEqual(['alpha', 'Beta', 'Gamma']));
  it('does not change the original order', () => {
    const copy = [...list];
    sortExams(list, 'name');
    expect(list).toEqual(copy);
  });
});

describe('filterExams', () => {
  const list = [
    exam('Y12 Physics', { status: 'setup', subject: 'Physics' }),
    exam('Y10 Chemistry', { status: 'clipping', subject: 'Chemistry', exam_board: 'OCR' }),
    exam('Y11 Biology', { status: 'marking' }),
    exam('Y13 Maths', { status: 'complete' }),
  ];
  it('keeps everything for "all" and an empty search', () => expect(filterExams(list, { status: 'all', query: '  ' })).toHaveLength(4));
  it('treats processing as part of setting up', () => {
    expect(filterExams(list, { status: 'setup', query: '' }).map((e) => e.name)).toEqual(['Y12 Physics', 'Y10 Chemistry']);
  });
  it('filters by marking and complete', () => {
    expect(filterExams(list, { status: 'marking', query: '' }).map((e) => e.name)).toEqual(['Y11 Biology']);
    expect(filterExams(list, { status: 'complete', query: '' }).map((e) => e.name)).toEqual(['Y13 Maths']);
  });
  it('searches name, subject and board without caring about case', () => {
    expect(filterExams(list, { status: 'all', query: 'chem' }).map((e) => e.name)).toEqual(['Y10 Chemistry']);
    expect(filterExams(list, { status: 'all', query: 'ocr' }).map((e) => e.name)).toEqual(['Y10 Chemistry']);
    expect(filterExams(list, { status: 'all', query: 'y1' })).toHaveLength(4);
  });
});

describe('arrangeMarking', () => {
  const q = (n: string, total: number, left: number) => ({ question_number: n, clips_total: total, clips_left: left });
  const exams = [
    { name: 'Mock A', created_at: '2026-01-01T00:00:00Z', assigned_questions: [q('2', 30, 0), q('10', 30, 5), q('1', 30, 20)] },
    { name: 'Mock B', created_at: '2026-02-01T00:00:00Z', assigned_questions: [q('1', 30, 40)] },
    { name: 'Mock C', created_at: '2026-03-01T00:00:00Z', assigned_questions: [q('1', 30, 0)] },
  ];
  it('"to do" hides finished questions and exams with nothing left', () => {
    const r = arrangeMarking(exams, { filter: 'todo', sort: 'name' });
    expect(r.map((e) => e.name)).toEqual(['Mock A', 'Mock B']);
    expect(r[0].assigned_questions.map((x) => x.question_number)).toEqual(['1', '10']);
  });
  it('"all" keeps finished questions, last when sorting by what is left', () => {
    const r = arrangeMarking(exams, { filter: 'all', sort: 'left' });
    expect(r.map((e) => e.name)).toEqual(['Mock B', 'Mock A', 'Mock C']);
    expect(r[1].assigned_questions.map((x) => x.question_number)).toEqual(['1', '10', '2']);
  });
  it('orders question numbers naturally (2 before 10) when sorting by name', () => {
    const r = arrangeMarking(exams, { filter: 'all', sort: 'name' });
    expect(r[0].assigned_questions.map((x) => x.question_number)).toEqual(['1', '2', '10']);
  });
  it('newest exam first', () => {
    expect(arrangeMarking(exams, { filter: 'all', sort: 'newest' }).map((e) => e.name)).toEqual(['Mock C', 'Mock B', 'Mock A']);
  });
  it('leaves the input alone', () => {
    arrangeMarking(exams, { filter: 'todo', sort: 'left' });
    expect(exams[0].assigned_questions.map((x) => x.question_number)).toEqual(['2', '10', '1']);
  });
});

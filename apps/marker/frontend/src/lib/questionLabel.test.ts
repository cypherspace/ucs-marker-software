import { describe, expect, it } from 'vitest';
import { compareQuestionLabels, formatQuestionLabel, normaliseQuestionLabel, parseQuestionLabel, sortByQuestionLabel } from './questionLabel';

describe('parseQuestionLabel', () => {
  it('reads the common ways of writing a label', () => {
    for (const s of ['2(a)(ii)', '2aii', '2.a.ii', '2 a ii', 'Q2ai'.replace('ai', 'aii'), '2(a)(ii)']) {
      expect(parseQuestionLabel(s)).toEqual({ number: '2', part: 'a', sub: 'ii' });
    }
    expect(parseQuestionLabel('1a')).toEqual({ number: '1', part: 'a', sub: '' });
    expect(parseQuestionLabel('3')).toEqual({ number: '3', part: '', sub: '' });
    expect(parseQuestionLabel('1(iv)')).toEqual({ number: '1', part: '', sub: 'iv' });
    expect(parseQuestionLabel('10b')).toEqual({ number: '10', part: 'b', sub: '' });
  });
  it('rejects text that is not a label', () => {
    expect(parseQuestionLabel('Bonus')).toBeNull();
    expect(parseQuestionLabel('')).toBeNull();
    expect(parseQuestionLabel('1 a b c')).toBeNull();
  });
});

describe('normaliseQuestionLabel', () => {
  it('writes the canonical form and leaves unknown text alone', () => {
    expect(normaliseQuestionLabel('1aiii')).toBe('1(a)(iii)');
    expect(normaliseQuestionLabel(' 2b ')).toBe('2(b)');
    expect(normaliseQuestionLabel('Bonus')).toBe('Bonus');
    expect(formatQuestionLabel({ number: '4', part: '', sub: '' })).toBe('4');
  });
});

describe('ordering', () => {
  it('sorts by number, part and sub-part, not as text', () => {
    const labels = ['10', '2(b)', '1aiii', '1(a)(ii)', '1ai', '2', '1b', '1(a)(iv)', '2(a)', 'Bonus', '9'];
    expect(sortByQuestionLabel(labels.map((question_number) => ({ question_number }))).map((q) => q.question_number))
      .toEqual(['1ai', '1(a)(ii)', '1aiii', '1(a)(iv)', '1b', '2', '2(a)', '2(b)', '9', '10', 'Bonus']);
  });
  it('is a consistent comparator', () => {
    expect(compareQuestionLabels('1(a)(ii)', '1aii')).toBe(0);
    expect(compareQuestionLabels('2', '10')).toBeLessThan(0);
  });
});

import { composeQuestionLabel, suggestNextQuestionLabel } from './questionLabel';

describe('suggestions and composing', () => {
  it('suggests the next sub-part, part or number', () => {
    expect(suggestNextQuestionLabel(undefined)).toBe('1');
    expect(suggestNextQuestionLabel('1(a)(ii)')).toBe('1(a)(iii)');
    expect(suggestNextQuestionLabel('1ai')).toBe('1(a)(ii)');
    expect(suggestNextQuestionLabel('2(a)')).toBe('2(b)');
    expect(suggestNextQuestionLabel('4')).toBe('5');
    expect(suggestNextQuestionLabel('Bonus')).toBe('');
  });
  it('composes number, part and sub-part into one label', () => {
    expect(composeQuestionLabel({ number: '2', part: 'A', sub: 'I' })).toBe('2(a)(i)');
    expect(composeQuestionLabel({ number: '3', part: '', sub: '' })).toBe('3');
    expect(composeQuestionLabel({ number: '', part: 'a', sub: '' })).toBe('');
  });
});

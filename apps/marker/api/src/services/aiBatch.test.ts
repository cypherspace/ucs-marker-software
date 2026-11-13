import { describe, expect, it } from 'vitest';
import { chunk, matchNumbered, requestsFor } from './aiBatch.js';

describe('matchNumbered', () => {
  it('puts each result with the item it numbers, whatever order they came back in', () => {
    const out = matchNumbered(3, [{ n: 3, v: 'c' }, { n: 1, v: 'a' }, { n: 2, v: 'b' }]);
    expect(out.map((r) => r?.v)).toEqual(['a', 'b', 'c']);
  });
  it('leaves a gap for an item Gemini skipped, without disturbing the others', () => {
    const out = matchNumbered(3, [{ n: 1, v: 'a' }, { n: 3, v: 'c' }]);
    expect(out.map((r) => r?.v ?? null)).toEqual(['a', null, 'c']);
  });
  it('ignores out-of-range and repeated numbers', () => {
    const out = matchNumbered(2, [{ n: 1, v: 'a' }, { n: 1, v: 'dup' }, { n: 9, v: 'x' }]);
    expect(out.map((r) => r?.v ?? null)).toEqual(['a', null]);
  });
  it('reads a full reply in order when it is numbered oddly (0-based)', () => {
    const out = matchNumbered(2, [{ n: 0, v: 'a' }, { n: 7, v: 'b' }]);
    expect(out.map((r) => r?.v)).toEqual(['a', 'b']);
  });
});

describe('batching arithmetic', () => {
  it('chunks into batches of at most the size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it('counts the requests a run needs', () => {
    expect(requestsFor(0, 8)).toBe(0);
    expect(requestsFor(1, 8)).toBe(1);
    expect(requestsFor(100, 8)).toBe(13);
    expect(requestsFor(100, 1)).toBe(100);
  });
});

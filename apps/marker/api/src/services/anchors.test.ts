import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({ db: {} }));
vi.mock('./clipImages.js', () => ({ getClipBytes: vi.fn() }));

import { spread } from './anchors.js';

describe('spread', () => {
  it('returns everything when there are no more than the limit', () => {
    expect(spread([1, 2, 3], 4)).toEqual([1, 2, 3]);
  });

  it('keeps both ends and spaces the rest evenly', () => {
    const marks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(spread(marks, 3)).toEqual([0, 5, 10]);
    expect(spread(marks, 4)).toEqual([0, 3, 7, 10]);
  });

  it('never returns duplicates', () => {
    const picked = spread([1, 2, 3, 4, 5], 5);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('handles a limit of one', () => {
    expect(spread([4, 5, 6], 1)).toEqual([4]);
  });
});

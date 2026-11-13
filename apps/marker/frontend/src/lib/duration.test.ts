import { describe, expect, it } from 'vitest';
import { estimateRun } from './duration';

describe('estimateRun', () => {
  it('is silent when there is nothing to pace', () => {
    expect(estimateRun(1, 6)).toBeNull();
    expect(estimateRun(50, 0)).toBeNull();
  });
  it('spaces calls by 60/rpm', () => {
    expect(estimateRun(6, 6)).toBe('about a minute');
    expect(estimateRun(31, 6)).toBe('about 5 minutes');
    expect(estimateRun(100, 6)).toBe('about 17 minutes');
  });
  it('switches to hours for long runs', () => {
    expect(estimateRun(600, 6)).toBe('about 1.5 hours');
  });
});

import { describeRun } from './duration';

describe('describeRun', () => {
  it('packs answers into requests', () => {
    expect(describeRun(100, 8, 4, 20).requests).toBe(13);
    expect(describeRun(0, 8, 4, 20).requests).toBe(0);
    expect(describeRun(5, 8, 4, 20).requests).toBe(1);
  });
  it('flags a run bigger than the daily allowance', () => {
    expect(describeRun(100, 8, 4, 20).overDailyLimit).toBe(false);
    expect(describeRun(200, 8, 4, 20).overDailyLimit).toBe(true);
    expect(describeRun(200, 8, 4, 0).overDailyLimit).toBe(false);
  });
  it('estimates time from the requests, not the answers', () => {
    expect(describeRun(100, 8, 4, 20).duration).toBe('about 3 minutes');
  });
});

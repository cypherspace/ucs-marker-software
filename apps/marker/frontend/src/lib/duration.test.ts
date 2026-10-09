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

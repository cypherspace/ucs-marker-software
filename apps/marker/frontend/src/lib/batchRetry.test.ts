import { describe, expect, it } from 'vitest';
import { decideStep } from './batchRetry';

describe('decideStep', () => {
  it('keeps successes and real failures apart', () => {
    const o = decideStep([{ id: 'a', ok: true }, { id: 'b', ok: false, error: 'blocked' }], {});
    expect(o.done).toEqual(['a']);
    expect(o.failed).toEqual([{ id: 'b', error: 'blocked' }]);
    expect(o.retry).toEqual([]);
  });

  it('retries a rate-limited item after the wait Gemini asked for', () => {
    const o = decideStep([{ id: 'a', ok: false, error: 'slow', code: 'AI_RATE_LIMITED', retryable: true, retryAfter: 27 }], {});
    expect(o).toMatchObject({ retry: ['a'], waitSeconds: 27, rateLimited: true, stop: null });
  });

  it('uses a growing backoff when no wait was given, and gives up after three tries', () => {
    const attempts: Record<string, number> = {};
    const busy = [{ id: 'a', ok: false, error: 'busy', code: 'AI_OVERLOADED', retryable: true }];
    expect(decideStep(busy, attempts).waitSeconds).toBe(5);
    expect(decideStep(busy, attempts).waitSeconds).toBe(15);
    const last = decideStep(busy, attempts);
    expect(last.retry).toEqual([]);
    expect(last.failed).toEqual([{ id: 'a', error: 'busy' }]);
  });

  it('stops the run on a fatal error and keeps the item queued', () => {
    const o = decideStep([{ id: 'a', ok: false, error: 'Daily limit reached', code: 'AI_QUOTA_EXHAUSTED', fatal: true }], {});
    expect(o.stop).toBe('Daily limit reached');
    expect(o.retry).toEqual(['a']);
    expect(o.waitSeconds).toBe(0);
  });

  it('stops instead of waiting for a very long rate limit', () => {
    const o = decideStep([{ id: 'a', ok: false, error: 'Try again in 20 minutes', code: 'AI_RATE_LIMITED', retryable: true, retryAfter: 1200 }], {});
    expect(o.stop).toBe('Try again in 20 minutes');
    expect(o.retry).toEqual(['a']);
  });
});

import { groupErrors } from './batchRetry';
describe('groupErrors', () => {
  it('counts repeated messages and puts the commonest first', () => {
    expect(groupErrors([{ error: 'b' }, { error: 'a' }, { error: 'a' }])).toEqual([{ error: 'a', count: 2 }, { error: 'b', count: 1 }]);
  });
});

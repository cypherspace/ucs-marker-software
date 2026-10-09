import { describe, expect, it } from 'vitest';
import { classifyGemini, classifyThrown, humanDuration, parseSdkError } from './aiErrors.js';

// The Node SDK puts the status and the JSON body into the Error message.
const sdk = (status: number, text: string, error: object) =>
  new Error(`got status: ${status} ${text}. ${JSON.stringify({ error })}`);

describe('classifyThrown (Node SDK errors)', () => {
  it('reads the wait out of a per-minute rate limit', () => {
    const f = classifyThrown(sdk(429, 'Too Many Requests', {
      code: 429, status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota. Please retry in 27.3s.',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27s' },
      ],
    }));
    expect(f).toMatchObject({ code: 'AI_RATE_LIMITED', retryable: true, fatal: false, retry_after_seconds: 27 });
    expect(f.message).toContain('27 seconds');
  });

  it('falls back to the "retry in" text when there is no RetryInfo', () => {
    const f = classifyThrown(sdk(429, 'Too Many Requests', { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota hit. Please retry in 8.1s.' }));
    expect(f.retry_after_seconds).toBe(9);
  });

  it('treats a per-day quota as fatal, not worth waiting for', () => {
    const f = classifyThrown(sdk(429, 'Too Many Requests', {
      code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota.',
      details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
    }));
    expect(f).toMatchObject({ code: 'AI_QUOTA_EXHAUSTED', retryable: false, fatal: true });
  });

  it('calls an overloaded model busy and retryable', () => {
    const f = classifyThrown(sdk(503, 'Service Unavailable', { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded. Please try again later.' }));
    expect(f).toMatchObject({ code: 'AI_OVERLOADED', retryable: true, fatal: false });
  });

  it('treats a 500 as a temporary problem on Google\'s side', () => {
    const f = classifyThrown(sdk(500, 'Internal Server Error', { code: 500, status: 'INTERNAL', message: 'An internal error has occurred.' }));
    expect(f).toMatchObject({ code: 'AI_OVERLOADED', retryable: true });
  });

  it('flags a bad key as fatal', () => {
    const f = classifyThrown(sdk(400, 'Bad Request', {
      code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
    }));
    expect(f).toMatchObject({ code: 'AI_KEY_INVALID', fatal: true, retryable: false });
  });

  it('flags a retired model as fatal', () => {
    const f = classifyThrown(sdk(404, 'Not Found', { code: 404, status: 'NOT_FOUND', message: 'models/gemini-2.5-flash is no longer available to new users.' }));
    expect(f).toMatchObject({ code: 'AI_MODEL_UNAVAILABLE', fatal: true });
  });

  it('classifies an abort as a timeout and a dropped connection as a network problem', () => {
    expect(classifyThrown(new Error('aborted'), true)).toMatchObject({ code: 'AI_TIMEOUT', retryable: true });
    expect(classifyThrown(new TypeError('fetch failed'))).toMatchObject({ code: 'AI_NETWORK', retryable: true });
  });

  it('never leaks a long raw body for unknown errors', () => {
    const f = classifyThrown(new Error('x'.repeat(5000)));
    expect(f.code).toBe('AI_ERROR');
    expect(f.message.length).toBeLessThan(300);
  });
});

describe('classifyGemini (extractor detail)', () => {
  it('handles the structured shape the extractor sends', () => {
    const f = classifyGemini({
      status: 429, state: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '40s' }],
    });
    expect(f).toMatchObject({ code: 'AI_RATE_LIMITED', retry_after_seconds: 40 });
  });
});

describe('helpers', () => {
  it('parseSdkError extracts status, state and message', () => {
    const p = parseSdkError(sdk(429, 'Too Many Requests', { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'slow down' }));
    expect(p).toMatchObject({ status: 429, state: 'RESOURCE_EXHAUSTED', message: 'slow down' });
  });
  it('humanDuration is readable', () => {
    expect(humanDuration(1)).toBe('1 second');
    expect(humanDuration(45)).toBe('45 seconds');
    expect(humanDuration(300)).toBe('5 minutes');
    expect(humanDuration(7200)).toBe('2 hours');
  });
});

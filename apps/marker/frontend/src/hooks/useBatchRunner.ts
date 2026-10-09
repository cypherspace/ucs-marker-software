import { useCallback, useRef, useState } from 'react';
import { decideStep, MAX_ATTEMPTS, type StepResult } from '../lib/batchRetry';
import { friendlyError } from '../lib/errors';

export interface BatchItemResult extends StepResult {}
export type BatchStatus = 'idle' | 'running' | 'paused' | 'done' | 'stopped';

export interface BatchState {
  status: BatchStatus;
  total: number;
  done: number;
  failed: { id: string; error: string }[];
  // Set when the run stopped early because every further request would fail too (for example AI not set up)
  fatal: string | null;
  // Set while the run is waiting to try again (Gemini busy or rate limited)
  waiting: { until: number; reason: string } | null;
  // How many items were tried again after a temporary problem
  retried: number;
}

const IDLE: BatchState = { status: 'idle', total: 0, done: 0, failed: [], fatal: null, waiting: null, retried: 0 };

// Drives a long job as many short requests (AI work is done by the browser, a few
// items at a time, because background work after a response is throttled on Cloud Run).
// Pausing finishes the batch in flight, and resume carries on from where it stopped.
// Items that fail for a temporary reason (rate limit, Gemini busy) go back in the queue and are
// tried again after a wait; after a rate limit the run slows to one item at a time.
export function useBatchRunner(batchSize = 3) {
  const [state, setState] = useState<BatchState>(IDLE);
  const pauseRef = useRef(false);
  const remainingRef = useRef<string[]>([]);
  const attemptsRef = useRef<Record<string, number>>({});
  const slowRef = useRef(false);
  const requestFailuresRef = useRef(0);
  const stepRef = useRef<((ids: string[]) => Promise<BatchItemResult[]>) | null>(null);

  // Wait, but give up early if the user pauses. Returns false when interrupted.
  const wait = useCallback(async (seconds: number, reason: string) => {
    const until = Date.now() + seconds * 1000;
    setState((s) => ({ ...s, waiting: { until, reason } }));
    while (Date.now() < until) {
      if (pauseRef.current) { setState((s) => ({ ...s, waiting: null })); return false; }
      await new Promise((r) => setTimeout(r, 250));
    }
    setState((s) => ({ ...s, waiting: null }));
    return true;
  }, []);

  const loop = useCallback(async () => {
    const step = stepRef.current;
    if (!step) return;
    pauseRef.current = false;
    setState((s) => ({ ...s, status: 'running' }));
    while (remainingRef.current.length > 0) {
      if (pauseRef.current) { setState((s) => ({ ...s, status: 'paused' })); return; }
      const batch = remainingRef.current.slice(0, slowRef.current ? 1 : batchSize);
      try {
        const results = await step(batch);
        requestFailuresRef.current = 0;
        const outcome = decideStep(results, attemptsRef.current);
        if (outcome.rateLimited) slowRef.current = true;
        remainingRef.current = [...outcome.retry, ...remainingRef.current.slice(batch.length)];
        setState((s) => ({
          ...s,
          done: s.done + outcome.done.length,
          failed: [...s.failed, ...outcome.failed],
          retried: s.retried + (outcome.stop ? 0 : outcome.retry.length),
        }));
        if (outcome.stop) {
          setState((s) => ({ ...s, status: 'stopped', fatal: outcome.stop }));
          return;
        }
        if (outcome.waitSeconds > 0 && remainingRef.current.length > 0) {
          const reason = outcome.rateLimited
            ? 'Gemini\'s rate limit was reached'
            : 'Gemini is busy';
          if (!(await wait(outcome.waitSeconds, reason))) {
            setState((s) => ({ ...s, status: 'paused' }));
            return;
          }
        }
      } catch (err) {
        // The whole request failed (server restarting, connection dropped): try the same batch again a couple of times
        const f = friendlyError(err);
        requestFailuresRef.current += 1;
        if (f.retryable && requestFailuresRef.current < MAX_ATTEMPTS) {
          setState((s) => ({ ...s, retried: s.retried + batch.length }));
          if (!(await wait(f.retryAfter ?? 5 * requestFailuresRef.current, 'The server did not answer'))) {
            setState((s) => ({ ...s, status: 'paused' }));
            return;
          }
          continue;
        }
        setState((s) => ({ ...s, status: 'stopped', fatal: f.message }));
        return;
      }
    }
    setState((s) => ({ ...s, status: 'done' }));
  }, [batchSize, wait]);

  const start = useCallback((ids: string[], step: (ids: string[]) => Promise<BatchItemResult[]>) => {
    stepRef.current = step;
    remainingRef.current = [...ids];
    attemptsRef.current = {};
    slowRef.current = false;
    requestFailuresRef.current = 0;
    setState({ ...IDLE, status: 'running', total: ids.length });
    void loop();
  }, [loop]);

  const pause = useCallback(() => { pauseRef.current = true; }, []);
  const resume = useCallback(() => { attemptsRef.current = {}; requestFailuresRef.current = 0; setState((s) => ({ ...s, fatal: null })); void loop(); }, [loop]);
  const reset = useCallback(() => { pauseRef.current = true; remainingRef.current = []; setState(IDLE); }, []);

  return { state, start, pause, resume, reset };
}

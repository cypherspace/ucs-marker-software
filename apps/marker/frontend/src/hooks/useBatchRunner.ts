import { useCallback, useRef, useState } from 'react';

export interface BatchItemResult { id: string; ok: boolean; error?: string }
export type BatchStatus = 'idle' | 'running' | 'paused' | 'done' | 'stopped';

export interface BatchState {
  status: BatchStatus;
  total: number;
  done: number;
  failed: { id: string; error: string }[];
  // Set when the run stopped early because every further request would fail too (for example AI not set up)
  fatal: string | null;
}

const IDLE: BatchState = { status: 'idle', total: 0, done: 0, failed: [], fatal: null };

// Drives a long job as many short requests (AI work is done by the browser, a few
// items at a time, because background work after a response is throttled on Cloud Run).
// Pausing finishes the batch in flight, and resume carries on from where it stopped.
export function useBatchRunner(batchSize = 3) {
  const [state, setState] = useState<BatchState>(IDLE);
  const pauseRef = useRef(false);
  const remainingRef = useRef<string[]>([]);
  const stepRef = useRef<((ids: string[]) => Promise<BatchItemResult[]>) | null>(null);

  const loop = useCallback(async () => {
    const step = stepRef.current;
    if (!step) return;
    pauseRef.current = false;
    setState((s) => ({ ...s, status: 'running' }));
    while (remainingRef.current.length > 0) {
      if (pauseRef.current) { setState((s) => ({ ...s, status: 'paused' })); return; }
      const batch = remainingRef.current.slice(0, batchSize);
      try {
        const results = await step(batch);
        remainingRef.current = remainingRef.current.slice(batch.length);
        setState((s) => ({
          ...s,
          done: s.done + results.filter((r) => r.ok).length,
          failed: [...s.failed, ...results.filter((r) => !r.ok).map((r) => ({ id: r.id, error: r.error ?? 'Failed' }))],
        }));
      } catch (err) {
        setState((s) => ({ ...s, status: 'stopped', fatal: (err as Error).message }));
        return;
      }
    }
    setState((s) => ({ ...s, status: 'done' }));
  }, [batchSize]);

  const start = useCallback((ids: string[], step: (ids: string[]) => Promise<BatchItemResult[]>) => {
    stepRef.current = step;
    remainingRef.current = [...ids];
    setState({ status: 'running', total: ids.length, done: 0, failed: [], fatal: null });
    void loop();
  }, [loop]);

  const pause = useCallback(() => { pauseRef.current = true; }, []);
  const resume = useCallback(() => { setState((s) => ({ ...s, fatal: null })); void loop(); }, [loop]);
  const reset = useCallback(() => { remainingRef.current = []; setState(IDLE); }, []);

  return { state, start, pause, resume, reset };
}

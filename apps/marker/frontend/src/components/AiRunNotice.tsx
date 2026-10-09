import { useEffect, useState } from 'react';
import type { BatchState } from '../hooks/useBatchRunner';
import { groupErrors } from '../lib/batchRetry';
import { Button } from './ui';

function useSecondsLeft(until: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
}

// What an AI run is doing when things are not going smoothly: waiting out Gemini's rate limit,
// stopped because retrying would not help, or finished with some items that could not be done.
export function AiRunNotice({ state, onResume, onDismiss }: { state: BatchState; onResume: () => void; onDismiss: () => void }) {
  const left = useSecondsLeft(state.waiting?.until ?? null);
  const groups = groupErrors(state.failed);

  return (
    <div className="space-y-2">
      {state.waiting && left !== null && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {state.waiting.reason}. Trying again in <strong>{left}s</strong>; nothing is lost. You can pause instead.
        </div>
      )}
      {state.retried > 0 && state.status === 'running' && !state.waiting && (
        <p className="text-xs text-slate-500">{state.retried} item{state.retried === 1 ? ' was' : 's were'} tried again after a temporary Gemini problem.</p>
      )}
      {state.status === 'stopped' && state.fatal && (
        <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p><strong>The run has stopped.</strong> {state.fatal}</p>
          <p className="text-xs text-red-700">
            {state.done} done so far{state.failed.length > 0 && `, ${state.failed.length} failed`}. Items not yet reached were not sent.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={onResume}>Try again</Button>
            <Button variant="secondary" onClick={onDismiss}>Dismiss</Button>
          </div>
        </div>
      )}
      {groups.length > 0 && state.status !== 'idle' && (
        <ul className="space-y-0.5 text-xs text-red-700">
          {groups.slice(0, 4).map((g) => <li key={g.error}>{g.count} × {g.error}</li>)}
          {groups.length > 4 && <li>…and other problems</li>}
        </ul>
      )}
    </div>
  );
}

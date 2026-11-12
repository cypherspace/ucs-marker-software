import type { BatchState } from '../hooks/useBatchRunner';
import { Button, ProgressBar } from './ui';

interface Props {
  state: BatchState;
  // The final step (mark scheme and status) is running, or finished
  finishing: boolean;
  finished: boolean;
  error: string | null;
  label: (scriptId: string) => string;
  // Scripts that already had all their clips and were left alone (a run that only does what is missing)
  alreadyClipped?: number;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
}

// Progress for clipping a class a few scripts at a time
export function ClipRunPanel({ state, finishing, finished, error, label, alreadyClipped = 0, onPause, onResume, onDismiss }: Props) {
  const handled = state.done + state.failed.length;
  const running = state.status === 'running';
  const message =
    error ? error
    : finished && state.total === 0 ? `Nothing new to clip: all ${alreadyClipped} script${alreadyClipped === 1 ? ' has' : 's have'} their clips already.`
    : finished ? `Finished: ${state.done} script${state.done === 1 ? '' : 's'} clipped${state.failed.length ? `, ${state.failed.length} failed` : ''}${alreadyClipped ? ` (${alreadyClipped} already clipped, left alone)` : ''}.`
    : finishing ? 'Finishing up (mark scheme)…'
    : state.status === 'stopped' ? `Stopped: ${state.fatal ?? 'something went wrong'}`
    : state.status === 'paused' ? `Paused at ${handled} of ${state.total}.`
    : `Clipping script ${Math.min(handled + 1, state.total)} of ${state.total}${alreadyClipped ? ` (${alreadyClipped} already clipped, left alone)` : ''}…`;

  return (
    <div role="status" className="space-y-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`min-w-0 flex-1 ${error || state.status === 'stopped' ? 'text-red-700' : ''}`}>{message}</span>
        {running && <Button onClick={onPause}>Pause</Button>}
        {(state.status === 'paused' || state.status === 'stopped') && !error && <Button variant="primary" onClick={onResume}>Resume</Button>}
        {(finished || error || state.status === 'stopped') && <Button onClick={onDismiss}>Dismiss</Button>}
      </div>
      <ProgressBar value={finished ? state.total : handled} max={state.total} label="Clipping progress" />
      {state.failed.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-700">
          {state.failed.slice(0, 5).map((f) => <li key={f.id}>{label(f.id)}: {f.error}</li>)}
          {state.failed.length > 5 && <li>…and {state.failed.length - 5} more</li>}
        </ul>
      )}
    </div>
  );
}

import type { UploadQueue } from '../hooks/useUploadQueue';
import { Button, ProgressBar } from './ui';

const mb = (bytes: number | null) => (bytes === null ? '' : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

// The list of picked files with per-file status, one upload button and retry.
export function UploadQueuePanel({
  queue, buttonLabel,
}: {
  queue: UploadQueue;
  // Label for the main button given how many files are waiting.
  buttonLabel: (waiting: number) => string;
}) {
  const { items, running, runTotal, runDone, run, remove, clearDone } = queue;
  if (items.length === 0) return null;

  const waiting = items.filter((i) => i.status === 'pending').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const done = items.filter((i) => i.status === 'done').length;
  const toDo = waiting + failed;

  return (
    <div className="mb-3 space-y-3">
      <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm" aria-label="Selected files">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-slate-700" title={i.name}>{i.name}</span>
            <span className="text-xs text-slate-400">{mb(i.size)}</span>
            <span
              className={`text-xs font-medium ${
                i.status === 'done' ? 'text-green-700' : i.status === 'error' ? 'text-red-700' : i.status === 'uploading' ? 'text-indigo-700' : 'text-slate-500'
              }`}
            >
              {i.status === 'pending' ? 'Waiting' : i.status === 'uploading' ? 'Uploading…' : i.status === 'done' ? 'Uploaded' : 'Failed'}
            </span>
            {(i.status === 'pending' || i.status === 'error') && !running && (
              <button
                onClick={() => remove(i.key)}
                aria-label={`Remove ${i.name}`}
                className="text-slate-400 hover:text-red-500"
              >
                ✕
              </button>
            )}
            {i.status === 'error' && i.error && <span role="alert" className="basis-full text-xs text-red-700">{i.error}</span>}
          </li>
        ))}
      </ul>

      {running && (
        <div>
          <ProgressBar value={runDone} max={runTotal} label="Upload progress" />
          <p role="status" className="mt-1 text-xs text-slate-500">{Math.min(runDone + 1, runTotal)} of {runTotal}</p>
        </div>
      )}
      {!running && done > 0 && (
        <p role="status" className="text-sm text-slate-600">
          {done} uploaded{failed > 0 ? `, ${failed} failed` : ''}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={running || toDo === 0} onClick={run}>
          {running ? 'Uploading…' : waiting === 0 && failed > 0 ? `Retry ${failed} failed` : buttonLabel(toDo)}
        </Button>
        {!running && done > 0 && <Button variant="secondary" onClick={clearDone}>Clear finished</Button>}
      </div>
    </div>
  );
}

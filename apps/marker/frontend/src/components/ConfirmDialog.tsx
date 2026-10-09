import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from './ui';

/**
 * A modal box asking the person to confirm. With `requireText`, the confirm button stays disabled until
 * that exact text has been typed, for actions that cannot be undone.
 */
export function ConfirmDialog({
  title, children, confirmLabel, danger = false, requireText, busy = false, error, onConfirm, onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireText?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const ready = !requireText || typed === requireText;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id={titleId} className="mb-3 text-lg font-semibold text-slate-800">{title}</h2>
        <div className="space-y-3 text-sm text-slate-600">{children}</div>
        {requireText && (
          <label className="mt-4 block text-sm text-slate-700">
            Type <strong className="break-all">{requireText}</strong> to confirm
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={!ready || busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

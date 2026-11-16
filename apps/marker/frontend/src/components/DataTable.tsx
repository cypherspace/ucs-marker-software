import { useEffect, useRef, type ReactNode } from 'react';

// Shared pieces for the question tables (AI marking, practice sets, assigning teachers, results...): a scrolling box with a
// header that stays in view, and a tick box for a header or group row that shows a partial state.

export const TH = 'px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500';
export const HEAD = 'sticky top-0 z-10 bg-slate-50';

/** A table inside a box that scrolls both ways, so a long list does not push the rest of the page away. */
export function TableBox({ children, maxHeight = '32rem', className = '' }: { children: ReactNode; maxHeight?: string; className?: string }) {
  return (
    <div className={`overflow-auto rounded-lg border border-slate-200 bg-white ${className}`} style={{ maxHeight }}>
      {children}
    </div>
  );
}

/** A tick box that is ticked when all of `total` are ticked, and partly ticked when only some are. */
export function GroupTick({ ticked, total, onChange, label, disabled }: {
  ticked: number; total: number; onChange: (on: boolean) => void; label: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = ticked > 0 && ticked < total; }, [ticked, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      disabled={disabled || total === 0}
      checked={total > 0 && ticked === total}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

import type { ReactNode } from 'react';

export type StepState = 'done' | 'current' | 'todo';

/**
 * One numbered step of a longer job. A finished step folds down to a single line (its title and what was done)
 * and can be opened again to change it; the step to do next is open by default. `open` is controlled by the page
 * so it can decide which step is current.
 */
export function StepCard({
  number, title, summary, state, open, onToggle, optional = false, children,
}: {
  number: number;
  title: string;
  /** One line shown next to the title: what is done, or what is still to do */
  summary?: ReactNode;
  state: StepState;
  open: boolean;
  onToggle: () => void;
  optional?: boolean;
  children: ReactNode;
}) {
  const badge =
    state === 'done' ? 'bg-green-600 text-white'
    : state === 'current' ? 'bg-indigo-600 text-white'
    : 'bg-slate-200 text-slate-600';
  return (
    <section
      aria-label={`Step ${number}: ${title}`}
      className={`overflow-hidden rounded-lg border bg-white ${state === 'current' ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'}`}
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
        >
          <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${badge}`}>
            {state === 'done' ? '✓' : number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium text-slate-800">{title}</span>
            {optional && <span className="ml-2 text-xs font-normal text-slate-400">optional</span>}
            {summary && <span className="block truncate text-xs font-normal text-slate-500 sm:ml-3 sm:inline">{summary}</span>}
          </span>
          <span aria-hidden className="text-slate-400">{open ? '▾' : '▸'}</span>
        </button>
      </h2>
      {open && <div className="space-y-4 border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
}

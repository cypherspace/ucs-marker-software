import type { ReactNode } from 'react';

/**
 * A titled section that folds away. The page decides whether it is open (`open`) and what a click does
 * (`onToggle`), so it can open or close sections by default from what is on the page. `summary` is the one line
 * shown beside the title while the section is folded.
 */
export function Collapsible({
  title, summary, open, onToggle, children, className = '',
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium text-slate-800">{title}</span>
            {summary && <span className="block truncate text-xs font-normal text-slate-500 sm:ml-3 sm:inline">{summary}</span>}
          </span>
          <span aria-hidden className="text-slate-400">{open ? '▾' : '▸'}</span>
        </button>
      </h2>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
}

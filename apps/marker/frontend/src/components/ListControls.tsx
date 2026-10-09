import type { ReactNode } from 'react';

const fieldCls =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 min-h-11 sm:min-h-9 ' +
  'focus:border-indigo-500 focus:outline-none';

/** A row of filter and sort controls above a list. */
export function ListControls({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">{children}</div>;
}

/** Choose one of a few options, shown as a row of buttons (for filters). */
export function Segmented<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`min-h-11 border-r border-slate-200 px-3 py-2 text-sm font-medium last:border-r-0 sm:min-h-9 ${
            value === v ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Choose how a list is ordered. */
export function SortSelect<T extends string>({
  value, options, onChange,
}: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Sort by
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={fieldCls}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

export function SearchBox({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={`${fieldCls} w-56`}
    />
  );
}

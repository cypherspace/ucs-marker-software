import { NavLink, useLocation } from 'react-router-dom';

export interface TabItem { to: string; label: string; end?: boolean }

/**
 * Tabs that are real pages (each has its own address), so the browser's Back and a bookmark work.
 * Switching tabs replaces the history entry and keeps the remembered "came from" page, so the
 * page's Back button still returns to wherever the person started.
 */
export function TabLinks({ tabs, label }: { tabs: TabItem[]; label: string }) {
  const loc = useLocation();
  return (
    <nav aria-label={label} className="mb-6 flex w-fit max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          replace
          state={loc.state}
          className={({ isActive }) =>
            `min-h-11 whitespace-nowrap border-r border-slate-200 px-4 py-2 text-sm font-medium last:border-r-0 sm:min-h-9 ${
              isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

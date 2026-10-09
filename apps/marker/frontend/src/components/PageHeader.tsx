import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBackTarget, type BackTarget } from '../lib/nav';

export interface Crumb { label: string; to?: string }

/**
 * The top of every page: a Back link that returns to where the person came from (or the
 * page's parent when that is unknown), the trail of pages above this one, the title and the
 * page-level actions.
 */
export function PageHeader({
  title, crumbs, back, subtitle, actions,
}: {
  title: ReactNode;
  /** Ancestors, nearest last, for example Home > Exams. The title is the current page. */
  crumbs: Crumb[];
  /** Where Back goes when the previous page is unknown. Defaults to the nearest ancestor. */
  back?: BackTarget;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const parent = [...crumbs].reverse().find((c) => c.to);
  const target = useBackTarget(back ?? { to: parent?.to ?? '/', label: parent?.label ?? 'Home' });

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link to={target.to} state={target.state} className="font-medium text-indigo-600 hover:underline">← Back to {target.label}</Link>
        <nav aria-label="Breadcrumb" className="hidden text-slate-500 sm:block">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 && <span className="mx-1.5 text-slate-300" aria-hidden>›</span>}
              {c.to ? <Link to={c.to} className="hover:text-indigo-600 hover:underline">{c.label}</Link> : c.label}
            </span>
          ))}
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

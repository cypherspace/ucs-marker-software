import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../../lib/siteInfo';

// A value that still has to be filled in (see lib/siteInfo.ts) shows highlighted, so it cannot be missed in review
export function Fill({ value, label }: { value: string; label: string }) {
  if (value) return <>{value}</>;
  return <mark className="rounded bg-amber-200 px-1 text-amber-900">[{label}]</mark>;
}

export function ContactEmail() {
  return SITE.contactEmail
    ? <a href={`mailto:${SITE.contactEmail}`} className="text-indigo-700 underline">{SITE.contactEmail}</a>
    : <Fill value="" label="contact email to be added" />;
}

// The shared frame for the pages anyone can read without signing in
export function PublicLayout({ title, children }: { title?: string; children: ReactNode }) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE.appName}` : SITE.appName;
  }, [title]);

  return (
    <div className="h-full overflow-auto bg-slate-50">
      <div className="flex min-h-full flex-col">
        <header className="bg-indigo-700 text-white">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <Link to="/" className="text-lg font-semibold hover:opacity-90">{SITE.appName}</Link>
            <nav className="ml-auto flex items-center gap-4 text-sm">
              <Link to="/privacy" className="hover:underline">Privacy</Link>
              <Link to="/terms" className="hover:underline">Terms</Link>
              <Link to="/login" className="rounded bg-indigo-800 px-3 py-1 hover:bg-indigo-900">Sign in</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-slate-500">
            <span>{SITE.appName}{SITE.operatorName ? ` · ${SITE.operatorName}` : ''}</span>
            <Link to="/privacy" className="hover:underline">Privacy</Link>
            <Link to="/terms" className="hover:underline">Terms</Link>
            <span className="ml-auto"><ContactEmail /></span>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Shown on the privacy and terms pages while SITE.draft is true
export function DraftNotice({ items }: { items: string[] }) {
  if (!SITE.draft) return null;
  return (
    <div role="note" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Draft: not yet reviewed</p>
      <p className="mt-1">This text was drafted from how the system works and has to be reviewed by the school&apos;s data protection lead before it is relied on. Still to confirm:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

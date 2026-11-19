import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { NavEntry } from '../lib/navEntries';

const topCls = (active: boolean) => `rounded px-2 py-1 ${active ? 'underline underline-offset-4' : 'opacity-80 hover:opacity-100'}`;

// A button that opens a menu of links. Click or Enter/Space/Down opens it; Up/Down/Home/End move between items; Esc closes
// it and returns to the button; clicking elsewhere, tabbing out or moving to another page closes it.
function NavDropdown({ entry, active }: { entry: Extract<NavEntry, { kind: 'menu' }>; active: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const loc = useLocation();
  const itemsOf = () => Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); button.current?.focus(); return; }
    const items = itemsOf();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') {
      if (!open) { e.preventDefault(); setOpen(true); setTimeout(() => itemsOf()[0]?.focus(), 0); } else go(at + 1);
    } else if (e.key === 'ArrowUp' && open) go(at <= 0 ? items.length - 1 : at - 1);
    else if (e.key === 'Home' && open && at >= 0) go(0);
    else if (e.key === 'End' && open && at >= 0) go(items.length - 1);
  }

  return (
    <div ref={wrap} className="relative" onKeyDown={onKey} onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${topCls(active)} flex items-center gap-1`}
      >
        {entry.label}
        <span aria-hidden className="text-xs">▾</span>
      </button>
      {open && (
        <div role="menu" aria-label={entry.label} className="absolute left-0 z-30 mt-1 min-w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-700 shadow-lg">
          {entry.items.map((it) => (
            <Link key={it.to} to={it.to} role="menuitem" className="block px-4 py-2 hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none">
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The top bar for everyone who is signed in. On a wide screen the areas are a row of links and dropdown menus; on a narrow one
 * they fold into a single Menu button that lists every section.
 */
export function AppHeader({ email, role, entries, onSignOut }: {
  email: string;
  role: 'admin' | 'teacher' | 'student';
  entries: NavEntry[];
  onSignOut: () => void;
}) {
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [loc.pathname, loc.search]);
  const home = role === 'student' ? '/practice' : '/';

  return (
    <header className="bg-indigo-700 text-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <h1 className="whitespace-nowrap text-lg font-semibold"><Link to={home} className="hover:opacity-90">UCS Marking</Link></h1>

        <nav aria-label="Main" className="hidden items-center gap-x-1 text-sm whitespace-nowrap md:flex">
          {entries.map((e) => e.kind === 'link'
            ? <NavLink key={e.to} to={e.to} end={e.end} className={({ isActive }) => topCls(isActive)}>{e.label}</NavLink>
            : <NavDropdown key={e.label} entry={e} active={e.match(loc.pathname)} />)}
        </nav>

        <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-sm">
          <span className="hidden opacity-90 lg:inline">{email}</span>
          {role !== 'student' && <span className="rounded bg-indigo-600 px-2 py-0.5 text-xs">{role}</span>}
          {entries.length > 1 && (
            <button
              type="button"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen((o) => !o)}
              className="rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-900 md:hidden"
            >
              {mobileOpen ? 'Close' : 'Menu'}
            </button>
          )}
          <button onClick={onSignOut} className="rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-900">Sign out</button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Main (menu)" className="border-t border-indigo-600 px-4 pb-3 text-sm md:hidden">
          {entries.map((e) => e.kind === 'link'
            ? <Link key={e.to} to={e.to} className="block py-2 font-medium">{e.label}</Link>
            : (
              <div key={e.label} className="py-1">
                <div className="pt-2 text-xs font-semibold uppercase tracking-wide opacity-70">{e.label}</div>
                {e.items.map((it) => <Link key={it.to} to={it.to} className="block py-1.5 pl-2">{it.label}</Link>)}
              </div>
            ))}
        </nav>
      )}
    </header>
  );
}

import { useLocation } from 'react-router-dom';

// Every in-app link remembers the page it was clicked on (react-router location state), so a
// page's Back button can return to where the person actually came from rather than to a fixed
// parent. When the page was opened directly (a bookmark, a reload in a new tab) there is no
// remembered page and Back goes to the page's parent instead.
// `chain` holds the pages before `from`, nearest first, so going Back repeatedly retraces the
// whole route (Home > Progress > AI marking > Back to Progress > Back to Home).
export interface NavState { from?: string; chain?: string[] }

const MAX_CHAIN = 8;

/** A human label for an in-app path, used for "Back to …". */
export function pathLabel(path: string): string {
  const p = path.split('?')[0].replace(/\/+$/, '') || '/';
  if (p === '/') return 'Home';
  if (p === '/exams') return 'Exams';
  if (p === '/exams/new') return 'New exam';
  if (p === '/marking' || p === '/my-exams') return 'Marking';
  if (p === '/marking/ai' || /^\/marking\/ai\//.test(p)) return 'AI marking';
  if (p === '/marking/comparative') return 'Comparative ranking';
  if (p === '/admin') return 'Admin';
  if (/^\/exams\/[^/]+\/setup$/.test(p)) return 'Setup';
  if (/^\/exams\/[^/]+(\/progress)?$/.test(p)) return 'Exam';
  if (/^\/compare\/[^/]+\/[^/]+\/ranking$/.test(p)) return 'Ranking';
  if (/^\/compare\//.test(p)) return 'Comparisons';
  if (/^\/mark\//.test(p)) return 'Marking';
  return 'previous page';
}

/** `state` is the navigation state to pass along when going Back, so the route behind it is kept. */
export interface BackTarget { to: string; label: string; state?: NavState }

const isLocalPath = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//');

/**
 * Where Back should go: the page the person came from if known (and it is not this page),
 * otherwise the given fallback.
 */
export function useBackTarget(fallback: BackTarget): BackTarget {
  const loc = useLocation();
  const s = loc.state as NavState | null;
  const here = loc.pathname + loc.search;
  if (isLocalPath(s?.from) && s.from !== here) {
    const chain = (s.chain ?? []).filter(isLocalPath);
    return { to: s.from, label: pathLabel(s.from), state: { from: chain[0], chain: chain.slice(1) } };
  }
  return fallback;
}

/** Link state that records the current page as "where I came from", keeping the route before it. */
export function useFromState(): NavState {
  const loc = useLocation();
  const s = loc.state as NavState | null;
  const before = isLocalPath(s?.from) ? [s.from, ...(s.chain ?? []).filter(isLocalPath)] : [];
  return { from: loc.pathname + loc.search, chain: before.slice(0, MAX_CHAIN) };
}

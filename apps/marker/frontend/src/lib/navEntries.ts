import { ADMIN_TABS, NAV } from './navLabels';

export interface MenuItem { to: string; label: string }
export type NavEntry =
  | { kind: 'link'; label: string; to: string; end?: boolean }
  | { kind: 'menu'; label: string; items: MenuItem[]; match: (path: string) => boolean };

// True when `path` is one of the prefixes or below it
const starts = (path: string, ...prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** The navigation for a signed-in person: what they see depends on their role and on whether they lead exams. */
export function navEntries(role: 'admin' | 'teacher' | 'student', access: { leadsAny: boolean; hasComparative: boolean }): NavEntry[] {
  if (role === 'student') return [{ kind: 'link', label: NAV.practiceMarking, to: '/practice', end: true }];
  const canRunAi = role === 'admin' || access.leadsAny;
  const entries: NavEntry[] = [
    { kind: 'link', label: NAV.home, to: '/', end: true },
    {
      kind: 'menu',
      label: NAV.marking,
      match: (p) => starts(p, '/marking', '/mark', '/compare'),
      items: [
        { to: '/marking', label: NAV.myMarking },
        ...(canRunAi ? [{ to: '/marking/ai', label: NAV.aiMarking }] : []),
        ...(access.hasComparative || canRunAi ? [{ to: '/marking/comparative', label: NAV.comparative }] : []),
      ],
    },
    {
      kind: 'menu',
      label: NAV.examAdmin,
      match: (p) => starts(p, '/exams', '/practice-sets'),
      items: [{ to: '/exams', label: NAV.allExams }, { to: '/exams/new', label: NAV.newExam }],
    },
  ];
  if (role === 'admin') {
    entries.push({
      kind: 'menu',
      label: NAV.systemAdmin,
      match: (p) => starts(p, '/admin'),
      items: ADMIN_TABS.map((t) => ({ to: `/admin?tab=${t.id}`, label: t.label })),
    });
  }
  return entries;
}


import { describe, expect, it } from 'vitest';
import { navEntries, type NavEntry } from './navEntries';

const menu = (entries: NavEntry[], label: string) => entries.find((e): e is Extract<NavEntry, { kind: 'menu' }> => e.kind === 'menu' && e.label === label);
const none = { leadsAny: false, hasComparative: false };

describe('navEntries', () => {
  it('gives a student one link and no menus', () => {
    const e = navEntries('student', none);
    expect(e).toEqual([{ kind: 'link', label: 'Practice marking', to: '/practice', end: true }]);
  });

  it('shows a teacher who leads nothing only their own marking, and Exam Admin', () => {
    const e = navEntries('teacher', none);
    expect(e.map((x) => x.label)).toEqual(['Home', 'Marking', 'Exam Admin']);
    expect(menu(e, 'Marking')!.items.map((i) => i.label)).toEqual(['My marking']);
    expect(menu(e, 'Exam Admin')!.items.map((i) => i.to)).toEqual(['/exams', '/exams/new']);
  });

  it('adds AI marking and comparative ranking for a lead teacher', () => {
    const e = navEntries('teacher', { leadsAny: true, hasComparative: false });
    expect(menu(e, 'Marking')!.items.map((i) => i.label)).toEqual(['My marking', 'AI marking', 'Comparative ranking']);
  });

  it('adds comparative ranking for a teacher who only has comparative questions', () => {
    const e = navEntries('teacher', { leadsAny: false, hasComparative: true });
    expect(menu(e, 'Marking')!.items.map((i) => i.label)).toEqual(['My marking', 'Comparative ranking']);
  });

  it('gives an admin System Admin with one entry per section, linked by address', () => {
    const e = navEntries('admin', none);
    expect(e.map((x) => x.label)).toEqual(['Home', 'Marking', 'Exam Admin', 'System Admin']);
    expect(menu(e, 'System Admin')!.items).toEqual([
      { to: '/admin?tab=staff', label: 'Staff' },
      { to: '/admin?tab=overview', label: 'Marking overview' },
      { to: '/admin?tab=activity', label: 'Activity' },
      { to: '/admin?tab=storage', label: 'Storage' },
    ]);
    expect(menu(navEntries('teacher', none), 'System Admin')).toBeUndefined();
  });

  it('marks the right menu active for each part of the app', () => {
    const e = navEntries('admin', none);
    const active = (path: string) => e.filter((x) => x.kind === 'menu' && x.match(path)).map((x) => x.label);
    expect(active('/marking')).toEqual(['Marking']);
    expect(active('/mark/e/q/c')).toEqual(['Marking']);
    expect(active('/compare/e/q/ranking')).toEqual(['Marking']);
    expect(active('/exams/abc/results')).toEqual(['Exam Admin']);
    expect(active('/practice-sets/xyz')).toEqual(['Exam Admin']);
    expect(active('/admin')).toEqual(['System Admin']);
    expect(active('/')).toEqual([]);
    // A path that merely starts with the same letters is not part of the area
    expect(active('/markers')).toEqual([]);
  });
});

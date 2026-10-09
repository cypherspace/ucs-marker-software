import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { api } from '../api';
import { AppLink, Button, Card, ProgressBar, StatusPill } from '../components/ui';
import type { AuditEntry, OverviewExam } from '@marker/shared-types';

type Role = 'admin' | 'teacher';
type Tab = 'staff' | 'overview' | 'activity';

const TABS: [Tab, string][] = [['staff', 'Staff'], ['overview', 'Marking overview'], ['activity', 'Activity']];

export function Admin() {
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me(), retry: false });
  const [tab, setTab] = useState<Tab>('staff');

  if (meQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  const me = meQ.data?.data;
  if (me?.role !== 'admin') {
    return (
      <div className="p-6 text-sm text-slate-600" role="alert">
        Admin access is required to see this page.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="Admin" crumbs={[{ label: 'Home', to: '/' }]} subtitle="Manage who can sign in, and see how marking is going across every exam." />
      <div role="tablist" className="mb-6 flex w-fit overflow-hidden rounded-lg border border-slate-200 bg-white">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-11 border-r border-slate-200 px-4 py-2 text-sm font-medium last:border-r-0 sm:min-h-9 ${
              tab === t ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'staff' && <StaffTab myId={me.id} />}
      {tab === 'overview' && <OverviewTab />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  );
}

// ── Staff ─────────────────────────────────────────────────────────────────────
function StaffTab({ myId }: { myId: string }) {
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.admin.listUsers(), select: (r) => r.data });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('teacher');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
    qc.invalidateQueries({ queryKey: ['teachers'] });
    qc.invalidateQueries({ queryKey: ['home'] });
    setError(null);
  };
  const onError = (e: unknown) => setError((e as Error).message);

  const invite = useMutation({
    mutationFn: () => api.admin.addInvite(email.trim().toLowerCase(), role),
    onSuccess: () => { setEmail(''); refresh(); },
    onError,
  });
  const revoke = useMutation({ mutationFn: (e: string) => api.admin.removeInvite(e), onSuccess: refresh, onError });
  const changeRole = useMutation({
    mutationFn: ({ id, r }: { id: string; r: Role }) => api.admin.setUserRole(id, r),
    onSuccess: refresh,
    onError,
  });
  const deactivate = useMutation({ mutationFn: (id: string) => api.admin.deactivateUser(id), onSuccess: refresh, onError });
  const reactivate = useMutation({ mutationFn: (id: string) => api.admin.reactivateUser(id), onSuccess: refresh, onError });

  if (usersQ.isLoading) return <div className="text-slate-500">Loading…</div>;
  const users = usersQ.data?.users ?? [];
  const invites = usersQ.data?.invites ?? [];
  const busy = changeRole.isPending || deactivate.isPending || reactivate.isPending;

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <Card className="p-4">
        <h2 className="mb-3 font-medium text-slate-700">Invite someone</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.mutate(); }}
        >
          <label className="grid gap-1 text-xs text-slate-600">
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@school.org"
              className="w-72 max-w-full rounded border border-slate-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="teacher">Teacher</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={invite.isPending || !email.trim()}>
            {invite.isPending ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          They can sign in with that Google account straight away. No email is sent.
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium text-slate-700">Staff</h2>
          <span className="text-xs text-slate-500">{users.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Person</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Last sign-in</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isMe = u.id === myId;
                const inactive = Boolean(u.disabled_at);
                return (
                  <tr key={u.id} className={inactive ? 'bg-slate-50 text-slate-500' : ''}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{u.name ?? u.email}{isMe && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}</div>
                      {u.name && <div className="text-xs text-slate-500">{u.email}</div>}
                      {inactive && <div className="text-xs font-medium text-amber-700">Deactivated</div>}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={u.role}
                        disabled={isMe || inactive || busy}
                        onChange={(e) => changeRole.mutate({ id: u.id, r: e.target.value as Role })}
                        aria-label={`Role for ${u.email}`}
                        title={isMe ? 'You cannot change your own role' : undefined}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60"
                      >
                        <option value="teacher">Teacher</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isMe ? null : inactive ? (
                        <Button variant="secondary" disabled={busy} onClick={() => reactivate.mutate(u.id)}>Reactivate</Button>
                      ) : (
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            const warn = u.leads_exams > 0
                              ? ` They lead ${u.leads_exams} exam${u.leads_exams === 1 ? '' : 's'}; those stay in place but nobody else can manage them until a new lead is set.`
                              : '';
                            if (window.confirm(`Deactivate ${u.name ?? u.email}? They will be signed out and unable to sign in. Their marks are kept.${warn}`)) {
                              deactivate.mutate(u.id);
                            }
                          }}
                        >
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium text-slate-700">Pending invites</h2>
          <span className="text-xs text-slate-500">{invites.length}</span>
        </div>
        {invites.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No pending invites. Everyone invited has signed in at least once.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invites.map((i) => (
              <li key={i.email} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-xs capitalize text-slate-500">{i.role}</span>
                <span className="text-xs text-slate-400">added by {i.added_by_email ?? 'unknown'}</span>
                <Button
                  variant="danger"
                  disabled={revoke.isPending}
                  onClick={() => { if (window.confirm(`Revoke the invite for ${i.email}?`)) revoke.mutate(i.email); }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Marking overview ──────────────────────────────────────────────────────────
const STALE_DAYS = 3;

function teacherState(t: OverviewExam['teachers'][number]): { label: string; tone: 'ok' | 'warn' | 'idle' } {
  if (t.clips_assigned === 0) return { label: 'Nothing to mark yet', tone: 'idle' };
  if (t.clips_marked >= t.clips_assigned) return { label: 'Finished', tone: 'ok' };
  if (!t.last_marked_at) return { label: 'Not started', tone: 'warn' };
  const days = (Date.now() - new Date(t.last_marked_at).getTime()) / 86_400_000;
  return days > STALE_DAYS
    ? { label: `No marking for ${Math.floor(days)} days`, tone: 'warn' }
    : { label: 'In progress', tone: 'idle' };
}

function OverviewTab() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.admin.overview(), select: (r) => r.data });
  if (q.isLoading) return <div className="text-slate-500">Loading…</div>;
  const exams = q.data ?? [];
  if (exams.length === 0) return <p className="text-sm text-slate-500">No exams yet.</p>;

  return (
    <div className="space-y-4">
      {exams.map((e) => (
        <Card key={e.exam_id} className="p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="font-medium text-slate-800">{e.name}</h2>
            <StatusPill status={e.status} />
            <span className="text-xs text-slate-500">Lead: {e.lead_email ?? 'unknown'}</span>
            <AppLink to={`/exams/${e.exam_id}`} className="ml-auto text-sm text-indigo-600 hover:underline">Open progress</AppLink>
          </div>
          {e.clips_total > 0 ? (
            <div className="mt-3 max-w-md">
              <ProgressBar value={e.clips_marked} max={e.clips_total} label={`${e.name} progress`} />
              <div className="mt-1 text-xs text-slate-500">{e.clips_marked} of {e.clips_total} clips marked</div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No clips generated yet.</p>
          )}
          {e.teachers.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
              {e.teachers.map((t) => {
                const st = teacherState(t);
                return (
                  <li key={t.teacher_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{t.email}</span>
                    <span className="text-xs text-slate-500">{t.clips_marked} of {t.clips_assigned} marked</span>
                    <span className={`text-xs font-medium ${st.tone === 'warn' ? 'text-amber-700' : st.tone === 'ok' ? 'text-green-700' : 'text-slate-500'}`}>
                      {st.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────
function describe(e: AuditEntry): string {
  const m = (e.metadata ?? {}) as Record<string, string | number | undefined>;
  const who = e.actor_email ?? 'Someone';
  switch (e.action) {
    case 'user.role_changed': return `${who} changed ${m.email} from ${m.from} to ${m.to}`;
    case 'user.deactivated': return `${who} deactivated ${m.email}`;
    case 'user.reactivated': return `${who} reactivated ${m.email}`;
    case 'invite.created': return `${who} invited ${e.target_id} as ${m.role}`;
    case 'invite.revoked': return `${who} revoked the invite for ${e.target_id}`;
    case 'question.updated': return `${who} edited question ${m.question_number}`;
    case 'question.deleted': return `${who} deleted question ${m.question_number}`;
    default: return `${who}: ${e.action}`;
  }
}

function ActivityTab() {
  const [pages, setPages] = useState<AuditEntry[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const first = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api.admin.auditLog(), select: (r) => r.data });
  const more = useMutation({
    mutationFn: (before: string) => api.admin.auditLog(before),
    onSuccess: (r) => { setPages((p) => [...p, r.data.entries]); setCursor(r.data.next_before); },
  });

  if (first.isLoading) return <div className="text-slate-500">Loading…</div>;
  const entries = [...(first.data?.entries ?? []), ...pages.flat()];
  const next = pages.length > 0 ? cursor : first.data?.next_before ?? null;
  if (entries.length === 0) return <p className="text-sm text-slate-500">Nothing has been recorded yet. Role changes, invites and question edits will appear here.</p>;

  return (
    <Card>
      <ul className="divide-y divide-slate-100">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1">{describe(e)}</span>
            <time className="text-xs text-slate-400" dateTime={e.created_at}>{new Date(e.created_at).toLocaleString()}</time>
          </li>
        ))}
      </ul>
      {next && (
        <div className="border-t border-slate-100 p-3 text-center">
          <Button variant="secondary" disabled={more.isPending} onClick={() => more.mutate(next)}>
            {more.isPending ? 'Loading…' : 'Show older'}
          </Button>
        </div>
      )}
    </Card>
  );
}

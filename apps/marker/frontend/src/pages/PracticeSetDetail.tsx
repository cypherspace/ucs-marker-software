import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHeader } from '../components/PageHeader';
import { Button, Card } from '../components/ui';
import type { PracticeStats } from '@marker/shared-types';

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);
const signed = (n: number | null) => (n === null ? '–' : n > 0 ? `+${n}` : String(n));

function StatsCells({ s }: { s: PracticeStats }) {
  return (
    <>
      <td className="px-3 py-2">{pct(s.exact_pct)}</td>
      <td className="px-3 py-2">{pct(s.within_one_pct)}</td>
      <td className="px-3 py-2">{s.mean_abs_diff ?? '–'}</td>
      <td className="px-3 py-2">{signed(s.mean_signed_diff)}</td>
    </>
  );
}

// One set of student practice work: its class links, and how students compared with the teachers.
export function PracticeSetDetail() {
  const { setId } = useParams<{ setId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detailQ = useQuery({ queryKey: ['practice-set', setId], queryFn: () => api.getPracticeSet(setId!) });
  const resultsQ = useQuery({ queryKey: ['practice-results', setId], queryFn: () => api.getPracticeResults(setId!), refetchInterval: 15000 });
  const [className, setClassName] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['practice-set', setId] }); void qc.invalidateQueries({ queryKey: ['practice-results', setId] }); };

  const addLink = useMutation({ mutationFn: () => api.addPracticeLink(setId!, className.trim()), onSuccess: () => { setClassName(''); refresh(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokePracticeLink(id), onSuccess: refresh });
  const closeMut = useMutation({ mutationFn: (closed: boolean) => api.setPracticeClosed(setId!, closed), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.deletePracticeSet(setId!), onSuccess: () => navigate(`/exams/${d?.set.exam_id}/practice`) });
  const exportMut = useMutation({
    mutationFn: () => api.exportPracticeResults(setId!),
    onSuccess: (r) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.data.csv], { type: 'text/csv' }));
      a.download = r.data.filename; a.click(); URL.revokeObjectURL(a.href);
    },
  });

  const d = detailQ.data?.data;
  const r = resultsQ.data?.data;
  if (detailQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (!d) return <div role="alert" className="p-6 text-red-700">{(detailQ.error as Error | null)?.message ?? 'Not found'}</div>;

  const copy = async (url: string, id: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch { window.prompt('Copy this link', url); }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title={d.set.name}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Exams', to: '/exams' }, { label: 'Exam', to: `/exams/${d.set.exam_id}/practice` }, { label: d.set.name }]}
        back={{ to: `/exams/${d.set.exam_id}/practice`, label: 'Student practice' }}
        subtitle={`${d.set.items} clips · ${d.set.students} student${d.set.students === 1 ? '' : 's'} joined · ${d.set.submitted} marks submitted${d.set.closed_at ? ' · closed' : ''}`}
      />

      <h2 className="mb-2 mt-4 text-lg font-semibold text-slate-800">Class links</h2>
      <Card className="mb-6 p-4">
        <p className="mb-3 text-sm text-slate-600">Give each class its own link. Anyone who signs in with a school account and opens it joins that class. You can switch a link off at any time.</p>
        <ul className="mb-3 space-y-2">
          {d.links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
              <span className="font-medium">{l.class_name}</span>
              <span className="text-xs text-slate-500">{l.students} joined</span>
              {l.revoked_at ? <span className="rounded bg-slate-200 px-1.5 text-xs text-slate-600">Switched off</span> : (
                <>
                  <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">{l.url}</code>
                  <Button className="!min-h-8 !px-3" onClick={() => void copy(l.url, l.id)}>{copied === l.id ? 'Copied' : 'Copy'}</Button>
                  <Button variant="danger" className="!min-h-8 !px-3" disabled={revoke.isPending} onClick={() => {
                    if (window.confirm(`Switch off the link for ${l.class_name}? Students who joined through it will lose access.`)) revoke.mutate(l.id);
                  }}>Switch off</Button>
                </>
              )}
            </li>
          ))}
          {d.links.length === 0 && <li className="text-sm text-slate-500">No links yet.</li>}
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (className.trim()) addLink.mutate(); }}>
          <div>
            <label htmlFor="class-name" className="block text-xs font-medium text-slate-600">Class name</label>
            <input id="class-name" value={className} onChange={(e) => setClassName(e.target.value)} maxLength={60}
              className="mt-1 rounded border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. 10A" />
          </div>
          <Button type="submit" variant="primary" disabled={!className.trim() || addLink.isPending}>Make link</Button>
        </form>
        {addLink.error && <ErrorNotice error={addLink.error} className="mt-2 rounded" />}
      </Card>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-800">How students compare with teachers</h2>
        <div className="ml-auto flex gap-2">
          <Button disabled={exportMut.isPending} onClick={() => exportMut.mutate()}>Export CSV</Button>
          <Button onClick={() => closeMut.mutate(!d.set.closed_at)}>{d.set.closed_at ? 'Reopen set' : 'Close set'}</Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete…</Button>
        </div>
      </div>
      {r && r.overall.compared === 0 && <p className="mb-4 text-sm text-slate-500">No marks submitted yet.</p>}
      {r && r.overall.compared > 0 && (
        <Card className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Who</th><th className="px-3 py-2">Done</th><th className="px-3 py-2">Same</th><th className="px-3 py-2">Within 1</th><th className="px-3 py-2">Avg diff</th><th className="px-3 py-2" title="Positive: marks higher than teachers">Bias</th></tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 font-medium"><td className="px-3 py-2">Everyone</td><td className="px-3 py-2">{r.overall.compared}</td><StatsCells s={r.overall} /></tr>
              {r.classes.map((c) => c.students.map((s) => (
                <tr key={`${c.link_id}-${s.student_id}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">{c.class_name}: {s.name ?? s.email}</td><td className="px-3 py-2">{s.done}/{s.total}</td><StatsCells s={s.stats} />
                </tr>
              )))}
            </tbody>
          </table>
        </Card>
      )}

      {r && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Clip</th><th className="px-3 py-2">Question</th><th className="px-3 py-2">Teachers</th><th className="px-3 py-2">Answers</th><th className="px-3 py-2">Marks given (0 → max)</th><th className="px-3 py-2">Same</th><th className="px-3 py-2">Bias</th></tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.item_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{i.position}</td><td className="px-3 py-2">{i.question_number}</td>
                  <td className="px-3 py-2">{i.reference ?? '–'}/{i.max_marks}</td><td className="px-3 py-2">{i.answers}</td>
                  <td className="px-3 py-2 font-mono text-xs">{i.histogram.join(' · ')}</td>
                  <td className="px-3 py-2">{pct(i.exact_pct)}</td><td className="px-3 py-2">{signed(i.mean_signed_diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {confirmDelete && (
        <ConfirmDialog title="Delete this set?" confirmLabel="Delete set" danger busy={del.isPending} error={del.error ? (del.error as Error).message : null}
          onConfirm={() => del.mutate()} onCancel={() => setConfirmDelete(false)}>
          This removes the set, its links and every mark students submitted on it. Teachers' marks are not affected.
        </ConfirmDialog>
      )}
    </div>
  );
}

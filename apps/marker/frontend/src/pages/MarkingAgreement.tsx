import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, LinkButton } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { COMBINE_LABELS } from '../lib/markCombine';
import { questionLabel } from '../lib/questionLabel';
import type { AgreementClip } from '@marker/shared-types';

type Filter = 'all' | 'conflicts' | 'single';

const STATE_STYLE: Record<AgreementClip['state'], string> = {
  none: 'bg-slate-100 text-slate-500',
  single: 'bg-slate-100 text-slate-600',
  agreed: 'bg-green-100 text-green-700',
  conflict: 'bg-amber-100 text-amber-800',
};
const STATE_LABEL: Record<AgreementClip['state'], string> = {
  none: 'Not marked', single: 'One teacher', agreed: 'Agreed', conflict: 'Differ',
};

// Where the teachers who marked a question agree and differ, and the average. Lead teacher or admin.
export function MarkingAgreement() {
  const { id: examId, questionId } = useParams<{ id: string; questionId: string }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [minSpread, setMinSpread] = useState(1);

  const examQ = useQuery({ queryKey: ['exam', examId], queryFn: () => api.getExam(examId!) });
  const agreeQ = useQuery({ queryKey: ['agreement', examId, questionId], queryFn: () => api.getAgreement(examId!, questionId!) });
  const a = agreeQ.data?.data;

  const shown = useMemo(() => {
    const clips = a?.clips ?? [];
    if (filter === 'conflicts') return clips.filter((c) => c.state === 'conflict' && c.spread >= minSpread);
    if (filter === 'single') return clips.filter((c) => c.state === 'single');
    return clips;
  }, [a, filter, minSpread]);

  const examName = examQ.data?.data.name ?? 'Exam';
  const header = (
    <PageHeader
      title={`Teachers' marks: Question ${a ? questionLabel(a.question_number) : ''}`}
      crumbs={[{ label: 'Home', to: '/' }, { label: 'Exams', to: '/exams' }, { label: examName, to: `/exams/${examId}` }, { label: 'Teachers\' marks' }]}
      back={{ to: `/exams/${examId}`, label: examName }}
      subtitle="Each teacher's mark for every script, side by side. Scripts are shown by number only."
    />
  );

  if (agreeQ.isLoading) return <div className="mx-auto max-w-5xl p-4 sm:p-6">{header}<p className="text-slate-500">Loading…</p></div>;
  if (agreeQ.error || !a) {
    return <div className="mx-auto max-w-5xl p-4 sm:p-6">{header}<p role="alert" className="text-red-600">{(agreeQ.error as Error | null)?.message ?? 'Could not load the marks.'}</p></div>;
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      {header}

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card className="p-4"><div className="text-2xl font-semibold text-slate-800">{a.stats.clips_marked}</div><div className="text-xs text-slate-500">scripts marked</div></Card>
        <Card className="p-4"><div className="text-2xl font-semibold text-slate-800">{a.stats.multi_marked}</div><div className="text-xs text-slate-500">marked by two or more teachers</div></Card>
        <Card className="p-4">
          <div className={`text-2xl font-semibold ${a.stats.conflicts ? 'text-amber-700' : 'text-slate-800'}`}>{a.stats.conflicts}</div>
          <div className="text-xs text-slate-500">where teachers differ{a.stats.agreed_pct !== null && ` (${a.stats.agreed_pct}% agree)`}</div>
        </Card>
        <Card className="p-4"><div className="text-2xl font-semibold text-slate-800">{a.stats.mean_spread ?? '–'}</div><div className="text-xs text-slate-500">average gap between highest and lowest</div></Card>
      </div>

      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-3 text-sm">
          <span className="text-slate-600">Marks that count: <strong>{COMBINE_LABELS[a.combine]}</strong> (change this on the Setup tab)</span>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {([['all', 'All'], ['conflicts', 'Where teachers differ'], ['single', 'Marked by one teacher']] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {label}
              </button>
            ))}
            {filter === 'conflicts' && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                gap of at least
                <input type="number" min={1} max={a.max_marks} value={minSpread} onChange={(e) => setMinSpread(Math.max(1, Number(e.target.value) || 1))} className="w-14 rounded border border-slate-300 px-1.5 py-0.5" />
              </label>
            )}
          </div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Script</th>
              {a.teachers.map((t) => <th key={t.teacher_id} className="px-3 py-2 text-center" title={t.email}>{t.name ?? t.email.split('@')[0]}</th>)}
              <th className="px-3 py-2 text-center">Average</th>
              <th className="px-3 py-2 text-center">Counts as</th>
              <th className="px-3 py-2">State</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((c) => (
              <tr key={c.clip_id}>
                <td className="px-4 py-2 font-medium text-slate-700">{c.script}</td>
                {a.teachers.map((t) => {
                  const m = c.marks.find((x) => x.teacher_id === t.teacher_id);
                  return <td key={t.teacher_id} className="px-3 py-2 text-center">{m ? m.marks : <span className="text-slate-300">–</span>}</td>;
                })}
                <td className="px-3 py-2 text-center text-slate-600">{c.mean ?? '–'}</td>
                <td className="px-3 py-2 text-center font-semibold text-slate-800">{c.combined ?? '–'}<span className="font-normal text-slate-400"> / {a.max_marks}</span></td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[c.state]}`}>{STATE_LABEL[c.state]}{c.state === 'conflict' ? ` (${c.spread})` : ''}</span></td>
                <td className="px-4 py-2 text-right"><LinkButton to={`/mark/${examId}/${questionId}/${c.clip_id}`} variant="secondary">Open</LinkButton></td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={a.teachers.length + 5} className="px-4 py-8 text-center text-slate-500">Nothing to show for this filter.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

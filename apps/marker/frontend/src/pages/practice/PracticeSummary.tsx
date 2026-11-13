import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Card } from '../../components/ui';

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);

// How a student's marking compares with the teachers', for the clips they have submitted.
export function PracticeSummary() {
  const { setId } = useParams<{ setId: string }>();
  const q = useQuery({ queryKey: ['practice', 'summary', setId], queryFn: () => api.studentSummary(setId!), gcTime: 0 });
  const s = q.data?.data;
  if (q.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (!s) return <div role="alert" className="p-6 text-red-700">{(q.error as Error | null)?.message ?? 'Not found'}</div>;
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link to="/practice" className="text-sm font-medium text-indigo-600 hover:underline">← Your sets</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-slate-800">{s.set_name}</h1>
      <p className="mb-4 text-sm text-slate-500">{s.finished ? 'You have marked every clip.' : `${s.done} of ${s.total} marked so far.`}</p>

      {s.stats.compared > 0 && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Same as teachers', pct(s.stats.exact_pct)], ['Within 1 mark', pct(s.stats.within_one_pct)],
              ['Average difference', s.stats.mean_abs_diff === null ? '–' : `${s.stats.mean_abs_diff} marks`], ['Compared', String(s.stats.compared)]].map(([k, v]) => (
              <Card key={k} className="p-3 text-center"><div className="text-xl font-semibold text-slate-800">{v}</div><div className="text-xs text-slate-500">{k}</div></Card>
            ))}
          </div>
          {s.bias_note && <p className="mb-4 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">{s.bias_note}</p>}
        </>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Clip</th><th className="px-3 py-2">Question</th><th className="px-3 py-2">You</th><th className="px-3 py-2">Teachers</th><th className="px-3 py-2">Difference</th><th /></tr>
          </thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.item_id} className="border-t border-slate-100">
                <td className="px-3 py-2">{i.position}</td>
                <td className="px-3 py-2">{i.question_label}</td>
                <td className="px-3 py-2">{i.your_mark} / {i.max_marks}</td>
                <td className="px-3 py-2">{i.teacher_mark ?? '–'}</td>
                <td className={`px-3 py-2 ${i.difference === 0 ? 'text-green-700' : 'text-amber-800'}`}>
                  {i.difference === null ? '–' : i.difference > 0 ? `+${i.difference}` : i.difference}
                </td>
                <td className="px-3 py-2 text-right"><Link className="text-indigo-600 hover:underline" to={`/practice/${setId}/${i.item_id}`}>Review</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

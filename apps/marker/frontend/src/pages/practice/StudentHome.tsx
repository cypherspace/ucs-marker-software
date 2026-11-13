import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Card } from '../../components/ui';

// A student's page: the sets of work their teachers have shared with their class.
export function StudentHome() {
  const q = useQuery({ queryKey: ['practice', 'sets'], queryFn: () => api.studentSets() });
  const sets = q.data?.data ?? [];
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-semibold text-slate-800">Practice marking</h1>
      <p className="mb-6 text-sm text-slate-500">Mark real answers, then see how your marks compare with your teachers'. Your marks are for practice only and never change anyone's results.</p>
      {q.isLoading && <p className="text-slate-500">Loading…</p>}
      {q.error && <p role="alert" className="text-red-700">{(q.error as Error).message}</p>}
      {!q.isLoading && sets.length === 0 && (
        <Card className="p-6 text-center text-slate-600">
          You have no sets of work yet. When your teacher shares a link with your class, open it and the set will appear here.
        </Card>
      )}
      <ul className="space-y-3">
        {sets.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{s.name}</div>
                <div className="text-xs text-slate-500">{s.class_name} · {s.done} of {s.total} marked{s.closed ? ' · closed' : ''}</div>
              </div>
              <Link
                to={s.done >= s.total ? `/practice/${s.id}/summary` : `/practice/${s.id}`}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                {s.done >= s.total ? 'See your results' : s.done > 0 ? 'Continue' : 'Start'}
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

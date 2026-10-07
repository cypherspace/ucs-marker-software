import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { LinkButton, ProgressBar, StatusPill } from '../components/ui';
import type { Exam } from '@marker/shared-types';

export function ExamList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.listExams(),
  });

  if (isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">Failed to load exams.</div>;

  const exams = data?.data ?? [];

  return (
    <div className="max-w-4xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Exams</h1>
        <LinkButton to="/exams/new" variant="primary">New exam</LinkButton>
      </div>

      {exams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500">No exams yet.</p>
          <div className="mt-4 flex justify-center">
            <LinkButton to="/exams/new" variant="primary">Create your first exam</LinkButton>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {exams.map((exam: Exam) => {
            const inSetup = exam.status === 'setup' || exam.status === 'clipping';
            const total = exam.clips_total ?? 0;
            const marked = exam.clips_marked ?? 0;
            return (
              <li
                key={exam.id}
                className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="font-medium text-slate-800">{exam.name}</h2>
                    <StatusPill status={exam.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {[exam.subject, exam.year_group, exam.exam_board, exam.exam_series].filter(Boolean).join(' · ')}
                  </div>
                  {total > 0 && (
                    <div className="mt-3 max-w-xs">
                      <ProgressBar value={marked} max={total} label={`${exam.name} marking progress`} />
                      <div className="mt-1 text-xs text-slate-500">{marked} of {total} clips marked</div>
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  <LinkButton to={`/exams/${exam.id}/setup`} variant={inSetup ? 'primary' : 'secondary'}>
                    {inSetup ? 'Continue setup' : 'Setup'}
                  </LinkButton>
                  <LinkButton to={`/exams/${exam.id}/progress`} variant={inSetup ? 'secondary' : 'primary'}>
                    View progress
                  </LinkButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Exam } from '@marker/shared-types';

const STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
  clipping: 'Processing',
  marking: 'Marking',
  complete: 'Complete',
};

const STATUS_COLORS: Record<string, string> = {
  setup: 'bg-slate-100 text-slate-600',
  clipping: 'bg-yellow-100 text-yellow-700',
  marking: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
};

export function ExamList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.listExams(),
  });

  if (isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">Failed to load exams.</div>;

  const exams = data?.data ?? [];

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Exams</h1>
        <Link
          to="/exams/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New Exam
        </Link>
      </div>

      {exams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500">No exams yet.</p>
          <Link to="/exams/new" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Create your first exam →
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {exams.map((exam: Exam) => (
            <div key={exam.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{exam.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {[exam.subject, exam.year_group, exam.exam_board, exam.exam_series].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[exam.status] ?? 'bg-slate-100 text-slate-600'}`}>
                {STATUS_LABELS[exam.status] ?? exam.status}
              </span>
              <div className="flex gap-2 text-sm">
                <Link to={`/exams/${exam.id}/setup`} className="text-indigo-600 hover:underline">Setup</Link>
                <Link to={`/exams/${exam.id}/progress`} className="text-indigo-600 hover:underline">Progress</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

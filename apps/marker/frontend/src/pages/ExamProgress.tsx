import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

export function ExamProgress() {
  const { id } = useParams<{ id: string }>();

  const examQ = useQuery({ queryKey: ['exam', id], queryFn: () => api.getExam(id!) });
  const progressQ = useQuery({ queryKey: ['progress', id], queryFn: () => api.getProgress(id!) });

  if (examQ.isLoading || progressQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  const exam = examQ.data?.data;
  const progress = progressQ.data?.data;

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6 flex items-center gap-4">
        <Link to="/exams" className="text-sm text-indigo-600 hover:underline">← Exams</Link>
        <h1 className="text-2xl font-semibold text-slate-800">{exam?.name}</h1>
      </div>

      <div className="space-y-4">
        {progress?.questions.map((q) => {
          const pct = q.total_clips > 0 ? Math.round((q.marked_clips / q.total_clips) * 100) : 0;
          return (
            <div key={q.question_id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-medium text-slate-800">Question {q.question_number}</span>
                  <span className="ml-2 text-sm text-slate-500">({q.max_marks} marks)</span>
                </div>
                <span className="text-sm text-slate-600">{q.marked_clips}/{q.total_clips} marked ({pct}%)</span>
              </div>
              <div className="mb-3 h-2 rounded-full bg-slate-200">
                <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              {q.teachers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {q.teachers.map((t) => (
                    <span key={t.teacher_id} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                      {t.email}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!progress?.questions.length && (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
            No questions defined yet. <Link to={`/exams/${id}/setup`} className="text-indigo-600 hover:underline">Go to setup →</Link>
          </div>
        )}
      </div>
    </div>
  );
}

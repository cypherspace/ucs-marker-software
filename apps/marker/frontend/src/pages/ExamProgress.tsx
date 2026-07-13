import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

export function ExamProgress() {
  const { id } = useParams<{ id: string }>();
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const examQ = useQuery({ queryKey: ['exam', id], queryFn: () => api.getExam(id!) });
  const progressQ = useQuery({ queryKey: ['progress', id], queryFn: () => api.getProgress(id!) });

  const exportMutation = useMutation({
    mutationFn: (includeNames: boolean) => api.exportResults(id!, includeNames),
    onSuccess: (res, includeNames) => {
      if (res.data.driveUrl) {
        setExportMsg('Exported to Google Drive.');
        window.open(res.data.driveUrl, '_blank', 'noopener');
      } else if (res.data.csv) {
        const blob = new Blob([res.data.csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `results${includeNames ? '-named' : ''}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        setExportMsg('CSV downloaded.');
      }
    },
    onError: (e) => setExportMsg((e as Error).message),
  });

  if (examQ.isLoading || progressQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  const exam = examQ.data?.data;
  const progress = progressQ.data?.data;

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6 flex items-center gap-4">
        <Link to="/exams" className="text-sm text-indigo-600 hover:underline">← Exams</Link>
        <h1 className="text-2xl font-semibold text-slate-800">{exam?.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => { setExportMsg(null); exportMutation.mutate(false); }}
            disabled={exportMutation.isPending}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exportMutation.isPending ? 'Exporting…' : 'Export Results'}
          </button>
          <button
            onClick={() => { setExportMsg(null); exportMutation.mutate(true); }}
            disabled={exportMutation.isPending}
            title="Adds student names via a database join — names never leave the platform otherwise"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Export with Names
          </button>
        </div>
      </div>
      {exportMsg && <p className="mb-4 text-sm text-slate-600">{exportMsg}</p>}

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

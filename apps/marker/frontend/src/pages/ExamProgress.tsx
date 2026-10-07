import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Button, Card, LinkButton, ProgressBar } from '../components/ui';

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
    <div className="max-w-4xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link to="/exams" className="text-sm text-indigo-600 hover:underline">← Exams</Link>
        <h1 className="text-2xl font-semibold text-slate-800">{exam?.name}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <LinkButton to={`/exams/${id}/ai`} variant="secondary">AI marking</LinkButton>
          <Button
            onClick={() => { setExportMsg(null); exportMutation.mutate(false); }}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? 'Exporting…' : 'Export results'}
          </Button>
          <Button
            onClick={() => { setExportMsg(null); exportMutation.mutate(true); }}
            disabled={exportMutation.isPending}
            title="Adds student names via a database join. Names never leave the platform otherwise."
          >
            Export with names
          </Button>
        </div>
      </div>
      {exportMsg && <p role="status" className="mb-4 text-sm text-slate-600">{exportMsg}</p>}

      <div className="space-y-4">
        {progress?.questions.map((q) => {
          const comparative = q.marking_mode === 'comparative';
          return (
            <Card key={q.question_id} className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-800">Question {q.question_number}</span>
                  <span className="ml-2 text-sm text-slate-500">
                    {comparative ? 'ranked by comparison' : `(${q.max_marks} marks)`}
                  </span>
                </div>
                {comparative ? (
                  <LinkButton to={`/compare/${id}/${q.question_id}/ranking`} variant="secondary">Ranking</LinkButton>
                ) : (
                  <span className="text-sm text-slate-600">
                    {q.marked_clips} of {q.total_clips} marked by teachers
                  </span>
                )}
              </div>
              {!comparative && (
                <>
                  <ProgressBar value={q.marked_clips} max={q.total_clips} label={`Question ${q.question_number} marking progress`} />
                  {(q.ai_marked_clips > 0 || q.covered_clips > q.marked_clips) && (
                    <p className="mt-2 text-xs text-slate-500">
                      {q.ai_marked_clips} also marked by the AI · {q.covered_clips} of {q.total_clips} have a mark that counts
                      (a teacher's mark, else the AI's)
                    </p>
                  )}
                </>
              )}
              {q.manual_clips > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {q.manual_clips} clip{q.manual_clips === 1 ? ' uses' : 's use'} pages chosen by hand
                  {q.changed_after_marking_clips > 0 && (
                    <span className="ml-1 font-medium text-amber-700">
                      · {q.changed_after_marking_clips} changed after being marked (earlier marks may refer to the old selection)
                    </span>
                  )}
                </p>
              )}
              {q.teachers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {q.teachers.map((t) => (
                    <span key={t.teacher_id} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                      {t.email}{!comparative && ` · ${t.marked}/${t.total}`}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {!progress?.questions.length && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            No questions defined yet. <Link to={`/exams/${id}/setup`} className="text-indigo-600 hover:underline">Go to setup →</Link>
          </div>
        )}
      </div>
    </div>
  );
}

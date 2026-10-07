import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { buttonClass } from '../components/ui';
import type { ExamQuestion } from '@marker/shared-types';

export function MyExams() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-exams'],
    queryFn: () => api.myExams(),
  });

  if (isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  const exams = data?.data ?? [];

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="mb-6 text-2xl font-semibold text-slate-800">My Marking</h1>

      {exams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500">No exams assigned to you for marking yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {exams.map((exam) => (
            <div key={exam.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="font-semibold text-slate-800 mb-1">{exam.name}</h2>
              <p className="text-xs text-slate-500 mb-3">
                {[exam.subject, exam.year_group, exam.exam_board].filter(Boolean).join(' · ')}
              </p>
              <div className="flex flex-wrap gap-2">
                {exam.assigned_questions.map((q: ExamQuestion) => {
                  const comparative = q.marking_mode === 'comparative';
                  return (
                    <Link
                      key={q.id}
                      to={comparative ? `/compare/${exam.id}/${q.id}` : `/mark/${exam.id}/${q.id}`}
                      className={buttonClass('secondary')}
                    >
                      <span>{comparative ? 'Compare' : 'Mark'} Q{q.question_number}</span>
                      <span className="text-slate-400">·</span>
                      <span>{comparative ? 'ranking' : `${q.max_marks} marks`}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

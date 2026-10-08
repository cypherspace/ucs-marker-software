import { useQueries, useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { api } from '../api';
import { ListControls, Segmented, SortSelect } from '../components/ListControls';
import { PageHeader } from '../components/PageHeader';
import { TabLinks } from '../components/TabLinks';
import { AppLink, buttonClass, Card, LinkButton, ProgressBar, StatusPill } from '../components/ui';
import { arrangeMarking, needsMarking, sortExams, type ExamSort, type MarkFilter, type MarkSort } from '../lib/listing';
import { useViewPref } from '../lib/viewPrefs';
import type { AssignedQuestion, Exam } from '@marker/shared-types';

const examDetails = (e: Exam) => [e.subject, e.year_group, e.exam_board].filter(Boolean).join(' · ');

/** Everything to do with marking: your questions, AI marking (for exams you lead) and comparative judging. */
export function MarkingLayout() {
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });
  const examsQ = useQuery({ queryKey: ['exams'], queryFn: () => api.listExams() });
  const homeQ = useQuery({ queryKey: ['home'], queryFn: () => api.home() });

  const me = meQ.data?.data;
  const led = (examsQ.data?.data ?? []).filter((e) => me && (me.role === 'admin' || e.lead_teacher_id === me.id));
  const leadsAny = led.length > 0;
  // The comparative tab appears when you have comparative questions to judge, or lead an exam that has some
  const ledProgress = useQueries({ queries: led.map((e) => ({ queryKey: ['progress', e.id], queryFn: () => api.getProgress(e.id) })) });
  const hasComparative = (homeQ.data?.data.comparative.questions ?? 0) > 0
    || ledProgress.some((p) => p.data?.data.questions.some((q) => q.marking_mode === 'comparative'));

  return (
    <div className="max-w-4xl p-4 sm:p-6">
      <PageHeader
        title="Marking"
        crumbs={[{ label: 'Home', to: '/' }]}
        back={{ to: '/', label: 'Home' }}
        subtitle={leadsAny ? 'Mark your questions, run AI marking on exams you lead, and judge comparisons.' : 'The questions you have been asked to mark.'}
      />
      <TabLinks
        label="Marking sections"
        tabs={[
          { to: '/marking', label: 'My marking', end: true },
          ...(leadsAny ? [{ to: '/marking/ai', label: 'AI marking' }] : []),
          ...(hasComparative ? [{ to: '/marking/comparative', label: 'Comparative ranking' }] : []),
        ]}
      />
      <Outlet />
    </div>
  );
}

// ── My marking ───────────────────────────────────────────────────────────────
export function MyMarking() {
  const { data, isLoading } = useQuery({ queryKey: ['my-exams'], queryFn: () => api.myExams() });
  const [view, setView] = useViewPref<{ filter: MarkFilter; sort: MarkSort }>('marker.marking.view', { filter: 'todo', sort: 'left' });

  if (isLoading) return <div className="text-slate-500">Loading…</div>;
  const all = data?.data ?? [];
  const exams = arrangeMarking(all, view);
  const hidden = all.flatMap((e) => e.assigned_questions).filter((q) => !needsMarking(q)).length;

  if (all.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-500">No questions have been assigned to you for marking yet.</p>
      </div>
    );
  }

  return (
    <div>
      <ListControls>
        <Segmented
          label="Show"
          value={view.filter}
          options={[['todo', 'To do'], ['all', 'All questions']]}
          onChange={(filter) => setView({ filter })}
        />
        <SortSelect
          value={view.sort}
          options={[['left', 'Most left to mark'], ['name', 'Exam name'], ['newest', 'Newest exam']]}
          onChange={(sort) => setView({ sort })}
        />
      </ListControls>

      {exams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
          <p className="text-lg font-medium text-green-700">All caught up</p>
          <p className="mt-1 text-sm text-slate-500">You have marked everything assigned to you.</p>
          {hidden > 0 && (
            <button type="button" onClick={() => setView({ filter: 'all' })} className="mt-3 text-sm font-medium text-indigo-600 underline">
              Show all {hidden} {hidden === 1 ? 'question' : 'questions'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {exams.map((exam) => {
            const left = exam.assigned_questions.reduce((n, q) => n + q.clips_left, 0);
            return (
              <Card key={exam.id} className="p-4">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-semibold text-slate-800">{exam.name}</h2>
                  <span className="text-xs text-slate-500">{examDetails(exam)}</span>
                  <span className="ml-auto text-sm text-slate-600">
                    {left > 0 ? `${left} left to mark` : <span className="text-green-700">Finished</span>}
                  </span>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {exam.assigned_questions.map((q) => <QuestionRow key={q.id} examId={exam.id} q={q} />)}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuestionRow({ examId, q }: { examId: string; q: AssignedQuestion }) {
  const comparative = q.marking_mode === 'comparative';
  const done = q.clips_total - q.clips_left;
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-medium text-slate-800">Question {q.question_number}</span>
        <span className="text-xs text-slate-500">{comparative ? 'ranked by comparison' : `${q.max_marks} ${q.max_marks === 1 ? 'mark' : 'marks'}`}</span>
      </div>
      {!comparative && (
        q.clips_total > 0 ? (
          <div className="mb-3">
            <ProgressBar value={done} max={q.clips_total} label={`Question ${q.question_number} marked`} />
            <div className="mt-1 text-xs text-slate-500">
              {q.clips_left > 0 ? `${done} of ${q.clips_total} marked` : `All ${q.clips_total} marked`}
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-slate-500">No scripts to mark yet.</p>
        )
      )}
      <LinkButton
        to={comparative ? `/compare/${examId}/${q.id}` : `/mark/${examId}/${q.id}`}
        variant={q.clips_left > 0 && !comparative ? 'primary' : 'secondary'}
        aria-disabled={!comparative && q.clips_total === 0}
        className={!comparative && q.clips_total === 0 ? 'pointer-events-none' : ''}
      >
        {comparative ? 'Judge comparisons' : q.clips_total === 0 ? 'Not ready' : q.clips_left > 0 ? (done > 0 ? 'Continue marking' : 'Start marking') : 'Review marking'}
      </LinkButton>
    </li>
  );
}

// ── AI marking ───────────────────────────────────────────────────────────────
export function AiMarkingOverview() {
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });
  const examsQ = useQuery({ queryKey: ['exams'], queryFn: () => api.listExams() });
  const [view, setView] = useViewPref<{ sort: ExamSort }>('marker.ai.view', { sort: 'newest' });

  const me = meQ.data?.data;
  const led = sortExams(
    (examsQ.data?.data ?? []).filter((e) => me && (me.role === 'admin' || e.lead_teacher_id === me.id) && (e.clips_total ?? 0) > 0),
    view.sort,
  );
  const progress = useQueries({
    queries: led.map((e) => ({ queryKey: ['progress', e.id], queryFn: () => api.getProgress(e.id) })),
  });

  if (examsQ.isLoading || meQ.isLoading) return <div className="text-slate-500">Loading…</div>;

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Gemini suggests a mark and feedback for each answer you choose. Suggestions appear beside teachers' marks;
        where a teacher has marked an answer, their mark is the one used. Only clipped answers are sent, with names blacked out.
      </p>
      {led.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-slate-500">
          {me?.role === 'admin' ? 'No exam has scripts that are ready to mark.' : 'None of the exams you lead has scripts ready to mark yet.'}
        </div>
      ) : (
        <>
          <ListControls>
            <SortSelect
              value={view.sort}
              options={[['newest', 'Newest'], ['name', 'Exam name'], ['remaining', 'Most left to mark'], ['progress', 'Least finished']]}
              onChange={(sort) => setView({ sort })}
            />
          </ListControls>
          <div className="space-y-4">
            {led.map((exam, i) => {
              const questions = (progress[i]?.data?.data.questions ?? []).filter((q) => q.marking_mode !== 'comparative');
              return (
                <Card key={exam.id} className="p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="font-semibold text-slate-800">{exam.name}</h2>
                    <StatusPill status={exam.status} />
                    <span className="text-xs text-slate-500">{examDetails(exam)}</span>
                    <AppLink to={`/marking/ai/${exam.id}`} className="ml-auto text-sm font-medium text-indigo-600 hover:underline">
                      Open AI marking
                    </AppLink>
                  </div>
                  {progress[i]?.isLoading ? (
                    <p className="text-sm text-slate-500">Loading…</p>
                  ) : questions.length === 0 ? (
                    <p className="text-sm text-slate-500">No questions are marked with marks in this exam.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {questions.map((q) => (
                        <li key={q.question_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                          <span className="w-24 font-medium text-slate-800">Question {q.question_number}</span>
                          <span className="text-slate-600">{q.marked_clips} of {q.total_clips} marked by teachers</span>
                          <span className="text-slate-600">{q.ai_marked_clips} marked by AI</span>
                          <AppLink
                            to={`/marking/ai/${exam.id}?q=${q.question_id}`}
                            className={`${buttonClass('secondary')} ml-auto`}
                          >
                            Run AI marking
                          </AppLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Comparative ranking ──────────────────────────────────────────────────────
export function ComparativeOverview() {
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });
  const mineQ = useQuery({ queryKey: ['my-exams'], queryFn: () => api.myExams() });
  const examsQ = useQuery({ queryKey: ['exams'], queryFn: () => api.listExams() });

  const me = meQ.data?.data;
  const led = (examsQ.data?.data ?? []).filter((e) => me && (me.role === 'admin' || e.lead_teacher_id === me.id));
  const progress = useQueries({
    queries: led.map((e) => ({ queryKey: ['progress', e.id], queryFn: () => api.getProgress(e.id) })),
  });

  if (meQ.isLoading || mineQ.isLoading || examsQ.isLoading) return <div className="text-slate-500">Loading…</div>;

  // Judging: comparative questions assigned to me. Ranking: comparative questions in exams I lead.
  const judging = (mineQ.data?.data ?? [])
    .map((e) => ({ exam: e as Exam, questions: e.assigned_questions.filter((q) => q.marking_mode === 'comparative') }))
    .filter((e) => e.questions.length > 0);
  const ranking = led
    .map((exam, i) => ({ exam, questions: (progress[i]?.data?.data.questions ?? []).filter((q) => q.marking_mode === 'comparative') }))
    .filter((e) => e.questions.length > 0);

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-slate-600">
        For each pair of anonymous answers, pick the better one. All the choices together build a ranked order.
      </p>
      <section>
        <h2 className="mb-2 font-medium text-slate-800">Judge comparisons</h2>
        {judging.length === 0 ? (
          <p className="text-sm text-slate-500">No comparative questions have been assigned to you.</p>
        ) : (
          <div className="space-y-3">
            {judging.map(({ exam, questions }) => (
              <Card key={exam.id} className="p-4">
                <h3 className="mb-2 font-semibold text-slate-800">{exam.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {questions.map((q) => (
                    <LinkButton key={q.id} to={`/compare/${exam.id}/${q.id}`} variant="secondary">Question {q.question_number}</LinkButton>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
      {ranking.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium text-slate-800">Rankings for exams you lead</h2>
          <div className="space-y-3">
            {ranking.map(({ exam, questions }) => (
              <Card key={exam.id} className="p-4">
                <h3 className="mb-2 font-semibold text-slate-800">{exam.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {questions.map((q) => (
                    <LinkButton key={q.question_id} to={`/compare/${exam.id}/${q.question_id}/ranking`} variant="secondary">
                      Question {q.question_number} ranking
                    </LinkButton>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

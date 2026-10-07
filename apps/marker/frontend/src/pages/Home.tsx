import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../api';
import { Card, LinkButton, ProgressBar } from '../components/ui';

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

const MarkIcon = () => <Icon><path d="M4 12.5 9 17.5 20 6.5" /></Icon>;
const ExamIcon = () => <Icon><path d="M8 4h8l3 3v13H5V4h3Z" /><path d="M9 11h6M9 15h6" /></Icon>;
const ProgressIcon = () => <Icon><path d="M5 20V10M12 20V4M19 20v-7" /></Icon>;

function HomeCard({
  icon, title, children, actions,
}: { icon: ReactNode; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-4 flex items-center gap-3">
        {icon}
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      </div>
      <div className="flex-1 space-y-3">{children}</div>
      <div className="mt-5 flex flex-wrap gap-2">{actions}</div>
    </Card>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Home() {
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });
  const homeQ = useQuery({ queryKey: ['home'], queryFn: () => api.home() });

  if (homeQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (homeQ.error || !homeQ.data) {
    return <div className="p-6 text-red-600" role="alert">Couldn't load your summary. Try refreshing the page.</div>;
  }

  const me = meQ.data?.data;
  const { marking, exams, progress } = homeQ.data.data;
  const pct = progress.clips_total > 0 ? Math.round((progress.clips_marked / progress.clips_total) * 100) : 0;
  const nothingYet = exams.total === 0 && marking.assigned_questions === 0;

  const examBreakdown = [
    exams.setup > 0 && `${exams.setup} in setup`,
    exams.clipping > 0 && `${exams.clipping} processing`,
    exams.marking > 0 && `${exams.marking} marking`,
    exams.complete > 0 && `${exams.complete} complete`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800">
          Welcome{me?.name ? `, ${me.name.split(' ')[0]}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Here is where things stand.</p>
      </div>

      {nothingYet && (
        <Card className="mb-6 border-dashed p-8 text-center">
          <p className="text-slate-600">Nothing to show yet. Create an exam to get started, or wait to be assigned questions to mark.</p>
          <div className="mt-4 flex justify-center">
            <LinkButton to="/exams/new" variant="primary">Create your first exam</LinkButton>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <HomeCard
          icon={<MarkIcon />}
          title="My marking"
          actions={
            marking.next ? (
              <>
                <LinkButton to={`/mark/${marking.next.exam_id}/${marking.next.question_id}`} variant="primary">Start marking</LinkButton>
                <LinkButton to="/my-exams" variant="secondary">All my questions</LinkButton>
              </>
            ) : (
              <LinkButton to="/my-exams" variant="secondary">See my exams</LinkButton>
            )
          }
        >
          {marking.assigned_questions === 0 ? (
            <p className="text-sm text-slate-500">Nothing has been assigned to you for marking yet.</p>
          ) : marking.clips_left === 0 ? (
            <>
              <p className="text-3xl font-semibold text-green-600">All caught up</p>
              <p className="text-sm text-slate-500">
                You have marked everything assigned to you ({plural(marking.assigned_questions, 'question')} in {plural(marking.exams, 'exam')}).
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-semibold text-slate-800">
                {marking.clips_left} <span className="text-base font-normal text-slate-500">left to mark</span>
              </p>
              <ProgressBar value={marking.clips_total - marking.clips_left} max={marking.clips_total} label="My marking progress" />
              <p className="text-sm text-slate-500">
                {plural(marking.assigned_questions, 'question')} in {plural(marking.exams, 'exam')}
                {marking.next && <> · next: {marking.next.exam_name}, Q{marking.next.question_number}</>}
              </p>
            </>
          )}
        </HomeCard>

        <HomeCard
          icon={<ExamIcon />}
          title="Exams"
          actions={
            <>
              <LinkButton to="/exams" variant="primary">Manage exams</LinkButton>
              <LinkButton to="/exams/new" variant="secondary">New exam</LinkButton>
            </>
          }
        >
          {exams.total === 0 ? (
            <p className="text-sm text-slate-500">No exams yet.</p>
          ) : (
            <>
              <p className="text-3xl font-semibold text-slate-800">
                {exams.total} <span className="text-base font-normal text-slate-500">{exams.total === 1 ? 'exam' : 'exams'}</span>
              </p>
              <p className="text-sm text-slate-500">{examBreakdown}</p>
              {exams.setup > 0 && (
                <p className="text-sm font-medium text-amber-700">
                  {plural(exams.setup, 'exam')} still to be set up before marking can start.
                </p>
              )}
            </>
          )}
        </HomeCard>

        <HomeCard
          icon={<ProgressIcon />}
          title="Progress and results"
          actions={
            <LinkButton to={progress.latest_exam ? `/exams/${progress.latest_exam.id}/progress` : '/exams'} variant="secondary">
              {progress.latest_exam ? 'View progress' : 'Go to exams'}
            </LinkButton>
          }
        >
          {progress.clips_total === 0 ? (
            <p className="text-sm text-slate-500">Marking progress appears here once scripts have been clipped.</p>
          ) : (
            <>
              <p className="text-3xl font-semibold text-slate-800">
                {pct}% <span className="text-base font-normal text-slate-500">marked</span>
              </p>
              <ProgressBar value={progress.clips_marked} max={progress.clips_total} label="Overall marking progress" />
              <p className="text-sm text-slate-500">
                {progress.clips_marked} of {progress.clips_total} clips across {me?.role === 'admin' ? 'all exams' : 'the exams you lead'}.
                Export results from an exam's progress page.
              </p>
            </>
          )}
        </HomeCard>
      </div>
    </div>
  );
}

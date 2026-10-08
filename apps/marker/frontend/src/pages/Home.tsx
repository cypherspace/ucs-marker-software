import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../api';
import { AppLink, Card, LinkButton, ProgressBar, StatusPill } from '../components/ui';

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
const CompareIcon = () => <Icon><path d="M8 4v16M16 4v16" /><path d="M4 8h8M12 16h8" /></Icon>;
const StaffIcon = () => <Icon><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .7 3.5 2.6 3.5 5.6" /></Icon>;

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
  const examsQ = useQuery({ queryKey: ['exams'], queryFn: () => api.listExams() });

  if (homeQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (homeQ.error || !homeQ.data) {
    return <div className="p-6 text-red-600" role="alert">Couldn't load your summary. Try refreshing the page.</div>;
  }

  const me = meQ.data?.data;
  const { marking, exams, progress, admin, comparative } = homeQ.data.data;
  const recentExams = (examsQ.data?.data ?? []).slice(0, 3);
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
          title="Marking"
          actions={
            marking.next ? (
              <>
                <LinkButton to={`/mark/${marking.next.exam_id}/${marking.next.question_id}`} variant="primary">Start marking</LinkButton>
                <LinkButton to="/marking" variant="secondary">All my questions</LinkButton>
                {progress.clips_total > 0 && <LinkButton to="/marking/ai" variant="secondary">AI marking</LinkButton>}
              </>
            ) : (
              <>
                <LinkButton to="/marking" variant="secondary">Open marking</LinkButton>
                {progress.clips_total > 0 && <LinkButton to="/marking/ai" variant="secondary">AI marking</LinkButton>}
              </>
            )
          }
        >
          <p className="text-sm text-slate-500">Mark the questions you have been given, one script at a time.</p>
          {marking.assigned_questions === 0 ? (
            <p className="text-sm text-slate-500">No questions have been assigned to you yet.</p>
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
              <LinkButton to="/exams" variant="primary">All exams</LinkButton>
              <LinkButton to="/exams/new" variant="secondary">New exam</LinkButton>
            </>
          }
        >
          <p className="text-sm text-slate-500">Set up papers, follow marking progress and export results.</p>
          {exams.total === 0 ? (
            <p className="text-sm text-slate-500">No exams yet.</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">{plural(exams.total, 'exam')}: {examBreakdown}</p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {recentExams.map((e) => {
                  const inSetup = e.status === 'setup' || e.status === 'clipping';
                  return (
                    <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-800">{e.name}</span>
                      <StatusPill status={e.status} />
                      <AppLink
                        to={inSetup ? `/exams/${e.id}/setup` : `/exams/${e.id}`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        {inSetup ? 'Continue setup' : 'Open'}
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </HomeCard>

        {comparative.questions > 0 && (
          <HomeCard
            icon={<CompareIcon />}
            title="Comparative ranking"
            actions={
              comparative.next ? (
                <LinkButton to={`/compare/${comparative.next.exam_id}/${comparative.next.question_id}`} variant="primary">Judge comparisons</LinkButton>
              ) : (
                <LinkButton to="/marking" variant="secondary">Open marking</LinkButton>
              )
            }
          >
            <p className="text-sm text-slate-500">Pick the better of two anonymous answers. All the choices build a ranked order.</p>
            {comparative.pairs_left === 0 ? (
              <p className="text-sm text-slate-500">No comparisons are waiting for you right now.</p>
            ) : (
              <>
                <p className="text-3xl font-semibold text-slate-800">
                  {comparative.pairs_left} <span className="text-base font-normal text-slate-500">to judge</span>
                </p>
                <p className="text-sm text-slate-500">
                  {comparative.next && <>Next: {comparative.next.exam_name}, Q{comparative.next.question_number}. </>}
                  You choose how many to judge in each sitting.
                </p>
              </>
            )}
          </HomeCard>
        )}

        {admin && (
          <HomeCard
            icon={<StaffIcon />}
            title="Staff and admin"
            actions={<LinkButton to="/admin" variant="secondary">Manage staff</LinkButton>}
          >
            <p className="text-sm text-slate-500">Invite and remove teachers, and see who has marked what.</p>
            <p className="text-3xl font-semibold text-slate-800">
              {admin.staff} <span className="text-base font-normal text-slate-500">staff {admin.staff === 1 ? 'account' : 'accounts'}</span>
            </p>
            <p className="text-sm text-slate-500">
              {admin.pending_invites === 0
                ? 'No pending invites.'
                : `${plural(admin.pending_invites, 'invite')} waiting for the person to sign in.`}
            </p>
          </HomeCard>
        )}
      </div>
    </div>
  );
}

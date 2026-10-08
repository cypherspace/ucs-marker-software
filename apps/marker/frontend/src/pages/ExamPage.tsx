import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ExamMenu } from '../components/ExamMenu';
import { PageHeader } from '../components/PageHeader';
import { TabLinks } from '../components/TabLinks';
import { StatusPill } from '../components/ui';

/** One exam: its header and tabs. The tab pages (Progress, Setup) render in the outlet below. */
export function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const loc = useLocation();
  const navigate = useNavigate();
  const examQ = useQuery({ queryKey: ['exam', id], queryFn: () => api.getExam(id!) });
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });

  if (examQ.isLoading || meQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  const exam = examQ.data?.data;
  const me = meQ.data?.data;
  if (!exam || !me) return <div className="p-6 text-red-600" role="alert">Couldn't load this exam.</div>;

  // Only the lead teacher (or an admin) sets an exam up
  const isLead = me.role === 'admin' || exam.lead_teacher_id === me.id;
  if (!isLead && loc.pathname.endsWith('/setup')) return <Navigate to={`/exams/${id}`} replace state={loc.state} />;

  const details = [exam.subject, exam.year_group, exam.exam_board, exam.exam_series].filter(Boolean).join(' · ');

  return (
    <div className="max-w-4xl p-4 sm:p-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{exam.name} <StatusPill status={exam.status} /></span>}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Exams', to: '/exams' }, { label: exam.name }]}
        back={{ to: '/exams', label: 'Exams' }}
        subtitle={details || undefined}
        actions={isLead ? <ExamMenu exam={exam} onDeleted={() => navigate('/exams')} /> : undefined}
      />
      {exam.archived_at && (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          This exam is archived. Marking has stopped and it is off the active lists, but its results are still here and can be exported.
          {isLead && ' Use More › Restore to bring it back.'}
        </div>
      )}
      {!exam.archived_at && exam.status === 'complete' && isLead && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          Marking is complete. When you no longer need this exam on your lists, archive it from the More menu.
        </div>
      )}
      <TabLinks
        label={`${exam.name} sections`}
        tabs={[
          { to: `/exams/${id}`, label: 'Progress', end: true },
          ...(isLead && !exam.archived_at ? [{ to: `/exams/${id}/setup`, label: 'Setup' }] : []),
        ]}
      />
      <Outlet context={{ exam, isLead }} />
    </div>
  );
}

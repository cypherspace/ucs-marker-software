import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ListControls, SearchBox, Segmented, SortSelect } from '../components/ListControls';
import { PageHeader } from '../components/PageHeader';
import { LinkButton, ProgressBar, StatusPill } from '../components/ui';
import { filterExams, sortExams, type ExamSort, type ExamStatusFilter } from '../lib/listing';
import { useViewPref } from '../lib/viewPrefs';
import type { Exam } from '@marker/shared-types';

export function ExamList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.listExams(),
  });
  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });
  const [view, setView] = useViewPref<{ status: ExamStatusFilter; sort: ExamSort }>('marker.exams.view', { status: 'all', sort: 'newest' });
  const [query, setQuery] = useState('');

  if (isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">Failed to load exams.</div>;

  const me = meQ.data?.data;
  const all = data?.data ?? [];
  const exams = sortExams(filterExams(all, { status: view.status, query }), view.sort);

  return (
    <div className="max-w-4xl p-4 sm:p-6">
      <PageHeader
        title="Exams"
        crumbs={[{ label: 'Home', to: '/' }]}
        subtitle="Set up papers, follow marking progress and export results."
        actions={<LinkButton to="/exams/new" variant="primary">New exam</LinkButton>}
      />

      {all.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500">No exams yet.</p>
          <div className="mt-4 flex justify-center">
            <LinkButton to="/exams/new" variant="primary">Create your first exam</LinkButton>
          </div>
        </div>
      ) : (
        <>
          <ListControls>
            <SearchBox value={query} onChange={setQuery} placeholder="Search exams" />
            <Segmented
              label="Show"
              value={view.status}
              options={[['all', 'All'], ['setup', 'Setting up'], ['marking', 'Marking'], ['complete', 'Complete']]}
              onChange={(status) => setView({ status })}
            />
            <SortSelect
              value={view.sort}
              options={[['newest', 'Newest'], ['name', 'Name'], ['remaining', 'Most left to mark'], ['progress', 'Least finished']]}
              onChange={(sort) => setView({ sort })}
            />
          </ListControls>

          {exams.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
              No exams match.{' '}
              <button type="button" onClick={() => { setQuery(''); setView({ status: 'all' }); }} className="font-medium text-indigo-600 underline">
                Clear the filters
              </button>
            </p>
          ) : (
            <ul className="space-y-3">
              {exams.map((exam: Exam) => {
                const isLead = Boolean(me && (me.role === 'admin' || exam.lead_teacher_id === me.id));
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
                      {isLead && inSetup ? (
                        <LinkButton to={`/exams/${exam.id}/setup`} variant="primary">Continue setup</LinkButton>
                      ) : (
                        <LinkButton to={`/exams/${exam.id}`} variant="primary">Open</LinkButton>
                      )}
                      {isLead && inSetup && <LinkButton to={`/exams/${exam.id}`} variant="secondary">Progress</LinkButton>}
                      {isLead && !inSetup && <LinkButton to={`/exams/${exam.id}/setup`} variant="secondary">Setup</LinkButton>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

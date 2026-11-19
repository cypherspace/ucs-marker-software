import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { HEAD, TableBox, TH } from '../components/DataTable';
import { AppLink, LinkButton, ProgressBar } from '../components/ui';
import { questionLabel } from '../lib/questionLabel';
import type { QuestionProgress } from '@marker/shared-types';

type Sort = 'order' | 'least' | 'conflicts';

// How far marking has got, one row per question. The default order is the paper's; "Least marked first" puts the
// questions that still need work at the top.
export function ExamProgress() {
  const { id } = useParams<{ id: string }>();
  const { isLead } = useOutletContext<{ isLead: boolean }>();
  const progressQ = useQuery({ queryKey: ['progress', id], queryFn: () => api.getProgress(id!) });
  const [sort, setSort] = useState<Sort>('order');

  const questions = progressQ.data?.data.questions;
  const rows = useMemo(() => {
    const list = [...(questions ?? [])];
    const done = (q: QuestionProgress) => (q.total_clips > 0 ? q.marked_clips / q.total_clips : 1);
    if (sort === 'least') list.sort((a, b) => Number(b.marking_mode === 'comparative') - Number(a.marking_mode === 'comparative') || done(a) - done(b));
    if (sort === 'conflicts') list.sort((a, b) => b.conflict_clips - a.conflict_clips);
    return list;
  }, [questions, sort]);

  if (progressQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  const marking = rows.filter((q) => q.marking_mode !== 'comparative');
  const totalClips = marking.reduce((n, q) => n + q.total_clips, 0);
  const markedClips = marking.reduce((n, q) => n + q.marked_clips, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-slate-500">How far marking has got for each question.</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Order
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
              <option value="order">Question order</option>
              <option value="least">Least marked first</option>
              <option value="conflicts">Most teacher differences first</option>
            </select>
          </label>
          <LinkButton to={`/exams/${id}/results`} variant="secondary">Results and export</LinkButton>
          {isLead && <LinkButton to={`/marking/ai?exam=${id}`} variant="secondary">AI marking</LinkButton>}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No questions defined yet.{' '}
          {isLead && <AppLink to={`/exams/${id}/setup`} className="text-indigo-600 hover:underline">Go to setup</AppLink>}
        </div>
      ) : (
        <TableBox maxHeight="none">
          <table className="w-full min-w-max text-sm">
            <thead className={HEAD}>
              <tr>
                <th className={TH}>Question</th>
                <th className={TH}>Marks</th>
                <th className={`${TH} w-64`}>Marked by teachers</th>
                <th className={TH} title="Clips that also have an AI mark">AI</th>
                <th className={TH} title="Clips where teachers gave different marks">Teachers differ</th>
                <th className={TH}>Teachers</th>
                <th className={TH}>Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((q) => {
                const comparative = q.marking_mode === 'comparative';
                const label = questionLabel(q.question_number);
                const complete = q.total_clips > 0 && q.marked_clips >= q.total_clips;
                return (
                  <tr key={q.question_id} className={q.conflict_clips > 0 ? 'bg-amber-50/40' : ''}>
                    <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800">Q{label}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-600">{comparative ? <span className="text-xs text-slate-500">ranked</span> : q.max_marks}</td>
                    {comparative ? (
                      <td className="px-2 py-2" colSpan={3}>
                        <LinkButton to={`/compare/${id}/${q.question_id}/ranking`} variant="secondary" className="!min-h-8 !px-3">Ranking</LinkButton>
                      </td>
                    ) : (
                      <>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-32 flex-none"><ProgressBar value={q.marked_clips} max={q.total_clips} label={`Question ${label} marking progress`} /></div>
                            <span className={`whitespace-nowrap text-xs tabular-nums ${complete ? 'font-medium text-green-700' : 'text-slate-600'}`}>
                              {q.marked_clips} / {q.total_clips}{complete && ' ✓'}
                            </span>
                          </div>
                          {q.covered_clips > q.marked_clips && (
                            <div className="mt-0.5 text-xs text-slate-500" title="A teacher's mark, else the AI's">{q.covered_clips} / {q.total_clips} have a mark that counts</div>
                          )}
                        </td>
                        <td className="px-2 py-2 tabular-nums text-slate-600">{q.ai_marked_clips > 0 ? q.ai_marked_clips : <span className="text-slate-300">–</span>}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-xs">
                          {q.conflict_clips > 0 ? (
                            <span className="font-medium text-amber-700">
                              {q.conflict_clips}{' '}
                              {isLead && <AppLink to={`/exams/${id}/agreement/${q.question_id}`} className="underline">see where</AppLink>}
                            </span>
                          ) : <span className="text-slate-300">–</span>}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {q.teachers.map((t) => (
                          <span key={t.teacher_id} className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" title={t.email}>
                            {t.email.split('@')[0]}{!comparative && ` · ${t.marked}/${t.total}`}
                          </span>
                        ))}
                        {q.teachers.length === 0 && <span className="text-xs text-amber-700">nobody assigned</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">
                      {q.manual_clips > 0 && <div>{q.manual_clips} with pages chosen by hand</div>}
                      {q.changed_after_marking_clips > 0 && (
                        <div className="font-medium text-amber-700" title="Earlier marks may refer to the old selection">{q.changed_after_marking_clips} changed after being marked</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {marking.length > 1 && (
              <tfoot className="bg-slate-50 text-xs font-medium text-slate-700">
                <tr>
                  <td className="px-2 py-2">All questions</td>
                  <td />
                  <td className="px-2 py-2 tabular-nums" colSpan={5}>{markedClips} of {totalClips} clips marked by teachers ({totalClips > 0 ? Math.round((markedClips / totalClips) * 100) : 0}%)</td>
                </tr>
              </tfoot>
            )}
          </table>
        </TableBox>
      )}
    </div>
  );
}

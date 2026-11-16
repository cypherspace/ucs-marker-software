import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { ErrorNotice } from '../components/ErrorNotice';
import { Button, Card, LinkButton } from '../components/ui';
import { GroupTick, HEAD, TableBox, TH } from '../components/DataTable';
import { questionLabel } from '../lib/questionLabel';
import type { Exam } from '@marker/shared-types';

// The exam's "Student practice" tab (lead teacher / admin): sets of already-marked clips that students mark for practice
// and compare with the teachers' marks, one link per class.
export function PracticeSets() {
  const { exam } = useOutletContext<{ exam: Exam; isLead: boolean }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setsQ = useQuery({ queryKey: ['practice-sets', exam.id], queryFn: () => api.listPracticeSets(exam.id) });
  const questionsQ = useQuery({ queryKey: ['questions', exam.id], queryFn: () => api.listQuestions(exam.id) });
  // How many clips teachers have marked on each question, to show how many a set could use
  const progressQ = useQuery({ queryKey: ['progress', exam.id], queryFn: () => api.getProgress(exam.id) });
  const progressOf = new Map((progressQ.data?.data.questions ?? []).map((p) => [p.question_id, p]));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [per, setPer] = useState(10);
  const [settled, setSettled] = useState(true);
  const [showMs, setShowMs] = useState(true);

  const questions = (questionsQ.data?.data ?? []).filter((q) => q.marking_mode === 'marks');
  const create = useMutation({
    mutationFn: () => api.createPracticeSet(exam.id, { name: name.trim(), question_ids: [...picked], per_question: per, only_settled: settled, show_mark_scheme: showMs }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['practice-sets', exam.id] });
      navigate(`/practice-sets/${r.data.id}`);
    },
  });

  const sets = setsQ.data?.data ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Let students mark real, already-marked answers as practice. They see the teachers' mark only after submitting their own, and
        their marks never count towards anyone's results.
      </p>

      {!creating && <Button variant="primary" onClick={() => setCreating(true)}>New set of work</Button>}

      {creating && (
        <Card className="space-y-4 p-4">
          <div>
            <label htmlFor="set-name" className="block text-sm font-medium text-slate-700">Name (students see this)</label>
            <input id="set-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
              className="mt-1 w-full max-w-md rounded border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. Mock paper: Q1 practice" />
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Questions to include</legend>
            <div className="mb-1 text-xs text-slate-500">{picked.size} of {questions.length} ticked</div>
            {questions.length === 0 ? (
              <span className="text-sm text-slate-500">No questions marked with marks yet.</span>
            ) : (
              <TableBox maxHeight="24rem">
                <table className="w-full text-sm">
                  <thead className={HEAD}>
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <GroupTick
                          label="Tick or clear every question"
                          ticked={picked.size}
                          total={questions.length}
                          onChange={(on) => setPicked(on ? new Set(questions.map((q) => q.id)) : new Set())}
                        />
                      </th>
                      <th className={TH}>Question</th>
                      <th className={TH}>Marks</th>
                      <th className={TH} title="Clips with a teacher's mark">Teacher-marked</th>
                      <th className={TH} title="Clips a set could use with the options below">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {questions.map((q) => {
                      const on = picked.has(q.id);
                      const p = progressOf.get(q.id);
                      const marked = p?.marked_clips ?? 0;
                      const available = settled ? Math.max(0, marked - (p?.conflict_clips ?? 0)) : marked;
                      return (
                        <tr key={q.id} className={on ? 'bg-indigo-50/60' : ''}>
                          <td className="px-3 py-1">
                            <input id={`ps-q-${q.id}`} type="checkbox" checked={on} onChange={(e) => {
                              const n = new Set(picked); if (e.target.checked) n.add(q.id); else n.delete(q.id); setPicked(n);
                            }} />
                          </td>
                          <td className="px-2 py-1 font-medium text-slate-800"><label htmlFor={`ps-q-${q.id}`} className="block cursor-pointer">Q{questionLabel(q.question_number)}</label></td>
                          <td className="px-2 py-1 tabular-nums text-slate-600">{q.max_marks}</td>
                          <td className="px-2 py-1 tabular-nums text-slate-600">{progressQ.isLoading ? '…' : marked}</td>
                          <td className={`px-2 py-1 tabular-nums ${progressQ.isLoading ? 'text-slate-400' : available === 0 ? 'font-medium text-amber-700' : available < per ? 'text-amber-700' : 'text-slate-700'}`}
                              title={available < per && !progressQ.isLoading ? `Fewer than the ${per} clips asked for` : undefined}>
                            {progressQ.isLoading ? '…' : available}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableBox>
            )}
          </fieldset>
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label htmlFor="per-q" className="block text-sm font-medium text-slate-700">Clips per question</label>
              <input id="per-q" type="number" min={1} max={50} value={per} onChange={(e) => setPer(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="mt-1 w-24 rounded border border-slate-300 px-3 py-2 text-sm" />
              <p className="mt-1 text-xs text-slate-500">Chosen to cover weak to strong answers.</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={settled} onChange={(e) => setSettled(e.target.checked)} />
              <span>Only clips where teachers agree<br /><span className="text-xs text-slate-500">Leaves out answers teachers marked differently.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={showMs} onChange={(e) => setShowMs(e.target.checked)} />
              <span>Show students the mark scheme</span>
            </label>
          </div>
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Students see the cropped answers with student names hidden by your name zones. A name written outside a name zone would be visible, and
            students may recognise handwriting, so skim the clips before sharing a link.
          </p>
          {create.error && <ErrorNotice error={create.error} />}
          <div className="flex gap-2">
            <Button variant="primary" disabled={!name.trim() || picked.size === 0 || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create set'}
            </Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {setsQ.isLoading && <p className="text-slate-500">Loading…</p>}
      <ul className="space-y-3">
        {sets.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{s.name}{s.closed_at && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">Closed</span>}</div>
                <div className="text-xs text-slate-500">{s.items} clips · {s.links} active link{s.links === 1 ? '' : 's'} · {s.students} student{s.students === 1 ? '' : 's'} joined · {s.submitted} marks submitted</div>
              </div>
              <LinkButton to={`/practice-sets/${s.id}`}>Open</LinkButton>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

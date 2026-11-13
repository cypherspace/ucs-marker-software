import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { ErrorNotice } from '../components/ErrorNotice';
import { Button, Card, LinkButton } from '../components/ui';
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
            <div className="mt-1 flex flex-wrap gap-2">
              {questions.map((q) => (
                <label key={q.id} className="flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-sm">
                  <input type="checkbox" checked={picked.has(q.id)} onChange={(e) => {
                    const n = new Set(picked); if (e.target.checked) n.add(q.id); else n.delete(q.id); setPicked(n);
                  }} />
                  {questionLabel(q.question_number)} <span className="text-xs text-slate-400">/{q.max_marks}</span>
                </label>
              ))}
              {questions.length === 0 && <span className="text-sm text-slate-500">No questions marked with marks yet.</span>}
            </div>
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

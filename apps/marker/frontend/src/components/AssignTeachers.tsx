import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExamQuestion, MarkingAssignment, TeacherOption } from '@marker/shared-types';
import { api } from '../api';
import { parseQuestionLabel, questionLabel, sortByQuestionLabel } from '../lib/questionLabel';
import { Button } from './ui';

interface Props {
  examId: string;
  teachers: TeacherOption[];
  questions: ExamQuestion[];
  assignments: MarkingAssignment[];
}

const who = (t: TeacherOption) => t.name ? `${t.name} (${t.email})` : t.email;

// Pick a teacher, tick the questions they should mark, save once. The ticks start from what they already have,
// so unticking a question takes it off them.
export function AssignTeachers({ examId, teachers, questions, assignments }: Props) {
  const qc = useQueryClient();
  const [teacherId, setTeacherId] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const ordered = useMemo(() => sortByQuestionLabel(questions), [questions]);
  const current = useMemo(
    () => new Set(assignments.filter((a) => a.teacher_id === teacherId).map((a) => a.question_id)),
    [assignments, teacherId],
  );
  const countFor = (id: string) => assignments.filter((a) => a.teacher_id === id).length;

  // Start the ticks from the teacher's current questions whenever the teacher (or the saved data) changes
  useEffect(() => { setTicked(new Set(current)); }, [current]);

  const toAdd = ordered.filter((q) => ticked.has(q.id) && !current.has(q.id)).map((q) => q.id);
  const toRemove = ordered.filter((q) => !ticked.has(q.id) && current.has(q.id)).map((q) => q.id);
  const changed = toAdd.length + toRemove.length > 0;

  // Questions grouped under their number, so "all of question 2" is one click
  const groups = useMemo(() => {
    const map = new Map<string, ExamQuestion[]>();
    for (const q of ordered) {
      const key = parseQuestionLabel(q.question_number)?.number ?? q.question_number;
      map.set(key, [...(map.get(key) ?? []), q]);
    }
    return [...map];
  }, [ordered]);

  function toggle(ids: string[], on: boolean) {
    setMessage(null);
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: () => api.bulkAssign(examId, { teacher_id: teacherId, add: toAdd, remove: toRemove }),
    onSuccess: (r) => {
      const { added, removed } = r.data;
      setMessage([added && `${added} assigned`, removed && `${removed} removed`].filter(Boolean).join(', ') + '.');
      qc.invalidateQueries({ queryKey: ['assignments', examId] });
      qc.invalidateQueries({ queryKey: ['progress', examId] });
    },
    onError: (e) => setMessage((e as Error).message),
  });

  const allIds = ordered.map((q) => q.id);
  const teacher = teachers.find((t) => t.id === teacherId);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <section aria-label="Teachers" className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 font-medium text-slate-700">1. Choose a teacher</h2>
        {teachers.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No teachers yet. Invite staff from the Admin page.</p>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-auto">
            {teachers.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => { setTeacherId(t.id); setMessage(null); }}
                  aria-pressed={t.id === teacherId}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm ${t.id === teacherId ? 'bg-indigo-50 font-medium text-indigo-800' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="min-w-0 truncate">{who(t)}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{countFor(t.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Questions" className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="font-medium text-slate-700">2. Tick their questions</h2>
          {teacher && <span className="text-sm text-slate-500">for {teacher.name ?? teacher.email}</span>}
          <div className="ml-auto flex gap-2 text-xs">
            <button disabled={!teacherId} onClick={() => toggle(allIds, true)} className="text-indigo-600 hover:underline disabled:opacity-40">Select all</button>
            <button disabled={!teacherId} onClick={() => toggle(allIds, false)} className="text-indigo-600 hover:underline disabled:opacity-40">Clear</button>
          </div>
        </div>

        {!teacherId ? (
          <p className="p-4 text-sm text-slate-500">Choose a teacher on the left.</p>
        ) : ordered.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">This exam has no questions yet. Add them on the Questions tab.</p>
        ) : (
          <div className="space-y-3 p-4">
            {groups.map(([number, qs]) => {
              const ids = qs.map((q) => q.id);
              const all = ids.every((id) => ticked.has(id));
              const some = ids.some((id) => ticked.has(id));
              return (
                <fieldset key={number} className="rounded-md border border-slate-100 p-3">
                  <legend className="px-1">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={all}
                        ref={(el) => { if (el) el.indeterminate = some && !all; }}
                        onChange={(e) => toggle(ids, e.target.checked)}
                        aria-label={`All of question ${number}`}
                      />
                      Question {number}
                    </label>
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {qs.map((q) => (
                      <label
                        key={q.id}
                        className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-sm ${ticked.has(q.id) ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                      >
                        <input type="checkbox" checked={ticked.has(q.id)} onChange={(e) => toggle([q.id], e.target.checked)} />
                        Q{questionLabel(q.question_number)}
                        <span className="text-xs text-slate-500">{q.max_marks}m</span>
                        {current.has(q.id) && <span className="text-xs text-green-700" title="Already assigned">✓</span>}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="primary" onClick={() => save.mutate()} disabled={!changed || save.isPending}>
                {save.isPending ? 'Saving…' : changed
                  ? `Save (${[toAdd.length && `${toAdd.length} to add`, toRemove.length && `${toRemove.length} to remove`].filter(Boolean).join(', ')})`
                  : 'Saved'}
              </Button>
              {changed && !save.isPending && <button onClick={() => setTicked(new Set(current))} className="text-sm text-slate-500 hover:underline">Undo changes</button>}
              {message && <span role="status" className="text-sm text-slate-600">{message}</span>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

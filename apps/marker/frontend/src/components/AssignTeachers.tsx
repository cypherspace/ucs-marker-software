import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExamQuestion, MarkCombine, MarkingAssignment, TeacherOption } from '@marker/shared-types';
import { COMBINES, COMBINE_HELP, COMBINE_LABELS } from '../lib/markCombine';
import { api } from '../api';
import { parseQuestionLabel, questionLabel, sortByQuestionLabel } from '../lib/questionLabel';
import { Button } from './ui';
import { GroupTick, HEAD, TableBox, TH } from './DataTable';

interface Props {
  examId: string;
  teachers: TeacherOption[];
  questions: ExamQuestion[];
  assignments: MarkingAssignment[];
  // How several teachers' marks for one script are combined (saved on the exam)
  markCombine: MarkCombine;
}

const who = (t: TeacherOption) => t.name ? `${t.name} (${t.email})` : t.email;
const short = (t: TeacherOption) => t.name ?? t.email.split('@')[0];

// Choose the teachers you are setting up, then tick the grid: questions down the side, those teachers across the top.
// The ticks start from what is already saved, so unticking takes a question off a teacher, and one Save writes the lot.
export function AssignTeachers({ examId, teachers, questions, assignments, markCombine }: Props) {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const ordered = useMemo(() => sortByQuestionLabel(questions), [questions]);

  // What is saved: teacher id -> question ids
  const saved = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of assignments) m.set(a.teacher_id, (m.get(a.teacher_id) ?? new Set()).add(a.question_id));
    return m;
  }, [assignments]);
  const savedFor = (tid: string) => saved.get(tid) ?? new Set<string>();

  // Which teachers are shown as columns. Starts with everyone who already has questions.
  const [chosen, setChosen] = useState<string[]>([]);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || assignments.length === 0) return;
    started.current = true;
    setChosen([...saved.keys()]);
  }, [assignments, saved]);

  // The ticks being edited, per teacher; reset to what is saved whenever the saved data changes
  const [grid, setGrid] = useState<Map<string, Set<string>>>(new Map());
  useEffect(() => { setGrid(new Map([...saved].map(([tid, qs]) => [tid, new Set(qs)]))); }, [saved]);
  const tickedFor = (tid: string) => grid.get(tid) ?? new Set<string>();

  const columns = teachers.filter((t) => chosen.includes(t.id));

  function setTicks(tid: string, ids: string[], on: boolean) {
    setMessage(null);
    setGrid((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(tid) ?? []);
      for (const id of ids) { if (on) set.add(id); else set.delete(id); }
      next.set(tid, set);
      return next;
    });
  }

  function choose(tid: string, on: boolean) {
    setMessage(null);
    if (on) setChosen((c) => [...c, tid]);
    else {
      setChosen((c) => c.filter((x) => x !== tid));
      setGrid((prev) => new Map(prev).set(tid, new Set(savedFor(tid)))); // unsaved ticks of a hidden column are dropped
    }
  }

  // Changes to write, per shown teacher
  const changes = columns.map((t) => {
    const now = tickedFor(t.id);
    const was = savedFor(t.id);
    return {
      teacher: t,
      add: ordered.filter((q) => now.has(q.id) && !was.has(q.id)).map((q) => q.id),
      remove: ordered.filter((q) => !now.has(q.id) && was.has(q.id)).map((q) => q.id),
    };
  }).filter((c) => c.add.length + c.remove.length > 0);
  const added = changes.reduce((n, c) => n + c.add.length, 0);
  const removed = changes.reduce((n, c) => n + c.remove.length, 0);
  const changed = changes.length > 0;

  // Questions grouped under their number, so "all of question 2" is one tick per teacher
  const groups = useMemo(() => {
    const map = new Map<string, ExamQuestion[]>();
    for (const q of ordered) {
      const key = parseQuestionLabel(q.question_number)?.number ?? q.question_number;
      map.set(key, [...(map.get(key) ?? []), q]);
    }
    return [...map];
  }, [ordered]);

  // How many teachers have each question: shown teachers by their edited ticks, the others as saved
  const teachersFor = (qid: string) => teachers.filter((t) => (chosen.includes(t.id) ? tickedFor(t.id) : savedFor(t.id)).has(qid)).length;
  const nobody = ordered.filter((q) => teachersFor(q.id) === 0);

  const save = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(changes.map((c) => api.bulkAssign(examId, { teacher_id: c.teacher.id, add: c.add, remove: c.remove })));
      const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${short(changes[i].teacher)}: ${(r.reason as Error).message}`] : []));
      return { failed, ok: results.length - failed.length };
    },
    onSuccess: ({ failed, ok }) => {
      setMessage(failed.length ? `Saved for ${ok} teacher${ok === 1 ? '' : 's'}. Not saved: ${failed.join('; ')}` : `Saved: ${[added && `${added} assigned`, removed && `${removed} removed`].filter(Boolean).join(', ')}.`);
      qc.invalidateQueries({ queryKey: ['assignments', examId] });
      qc.invalidateQueries({ queryKey: ['progress', examId] });
    },
    onError: (e) => setMessage((e as Error).message),
  });

  const combine = useMutation({
    mutationFn: (value: MarkCombine) => api.updateExam(examId, { mark_combine: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam', examId] });
      qc.invalidateQueries({ queryKey: ['results', examId] });
    },
  });

  return (
    <div className="space-y-4">
      <section aria-label="Teachers" className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="font-medium text-slate-700">1. Choose the teachers</h2>
          <span className="text-sm text-slate-500">{chosen.length} chosen</span>
          <div className="ml-auto flex gap-3 text-xs">
            <button className="text-indigo-600 hover:underline" onClick={() => { setChosen([...saved.keys()]); setMessage(null); }}>Everyone with questions</button>
            <button className="text-indigo-600 hover:underline" onClick={() => { chosen.forEach((id) => choose(id, false)); }}>Clear</button>
          </div>
        </div>
        {teachers.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No teachers yet. Invite staff from the System Admin page.</p>
        ) : (
          <ul className="grid max-h-60 gap-x-4 overflow-auto p-2 sm:grid-cols-2 lg:grid-cols-3">
            {teachers.map((t) => (
              <li key={t.id}>
                <label className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${chosen.includes(t.id) ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={chosen.includes(t.id)} onChange={(e) => choose(t.id, e.target.checked)} />
                  <span className="min-w-0 flex-1 truncate" title={who(t)}>{who(t)}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" title="Questions assigned (saved)">{savedFor(t.id).size}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Questions" className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="font-medium text-slate-700">2. Tick who marks what</h2>
          {nobody.length > 0 && columns.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {nobody.length} question{nobody.length === 1 ? ' has' : 's have'} nobody assigned
            </span>
          )}
        </div>

        {columns.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Choose one or more teachers above and they will appear here as columns.</p>
        ) : ordered.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">This exam has no questions yet. Add them on the Questions tab.</p>
        ) : (
          <div className="space-y-3 p-4">
            <TableBox maxHeight="36rem">
              <table className="w-full min-w-max text-sm">
                <thead className={HEAD}>
                  <tr>
                    <th className={`${TH} sticky left-0 z-20 bg-slate-50`}>Question</th>
                    <th className={TH}>Marks</th>
                    {columns.map((t) => (
                      <th key={t.id} className={`${TH} min-w-28 text-center normal-case`}>
                        <div className="flex flex-col items-center gap-1">
                          <span className="max-w-36 truncate text-slate-700" title={who(t)}>{short(t)}</span>
                          <GroupTick
                            label={`Tick or clear every question for ${short(t)}`}
                            ticked={ordered.filter((q) => tickedFor(t.id).has(q.id)).length}
                            total={ordered.length}
                            onChange={(on) => setTicks(t.id, ordered.map((q) => q.id), on)}
                          />
                        </div>
                      </th>
                    ))}
                    <th className={TH}>Marked by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.flatMap(([number, qs]) => {
                    const rows = [];
                    if (qs.length > 1) {
                      rows.push(
                        <tr key={`g-${number}`} className="bg-slate-50/70">
                          <td className="sticky left-0 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">Question {number}: all parts</td>
                          <td />
                          {columns.map((t) => (
                            <td key={t.id} className="px-2 py-1 text-center">
                              <GroupTick
                                label={`All of question ${number} for ${short(t)}`}
                                ticked={qs.filter((q) => tickedFor(t.id).has(q.id)).length}
                                total={qs.length}
                                onChange={(on) => setTicks(t.id, qs.map((q) => q.id), on)}
                              />
                            </td>
                          ))}
                          <td />
                        </tr>,
                      );
                    }
                    for (const q of qs) {
                      const n = teachersFor(q.id);
                      rows.push(
                        <tr key={q.id} className={n === 0 ? 'bg-amber-50/70' : ''}>
                          <td className="sticky left-0 whitespace-nowrap bg-inherit px-2 py-1 font-medium text-slate-800">Q{questionLabel(q.question_number)}</td>
                          <td className="px-2 py-1 tabular-nums text-slate-600">{q.max_marks}</td>
                          {columns.map((t) => (
                            <td key={t.id} className="px-2 py-1 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Q${questionLabel(q.question_number)} for ${short(t)}`}
                                checked={tickedFor(t.id).has(q.id)}
                                onChange={(e) => setTicks(t.id, [q.id], e.target.checked)}
                              />
                              {savedFor(t.id).has(q.id) && !tickedFor(t.id).has(q.id) && <span className="ml-1 text-xs text-red-600" title="Will be removed">✗</span>}
                            </td>
                          ))}
                          <td className="whitespace-nowrap px-2 py-1 text-xs">
                            {n === 0 ? <span className="font-medium text-amber-700">nobody assigned</span> : <span className="text-slate-500">{n} teacher{n === 1 ? '' : 's'}</span>}
                          </td>
                        </tr>,
                      );
                    }
                    return rows;
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <td className="sticky left-0 bg-slate-50 px-2 py-1.5 font-medium">Questions each</td>
                    <td />
                    {columns.map((t) => {
                      const c = changes.find((x) => x.teacher.id === t.id);
                      return (
                        <td key={t.id} className="px-2 py-1.5 text-center tabular-nums">
                          {tickedFor(t.id).size} / {ordered.length}
                          {c && <span className="ml-1 text-indigo-700">({[c.add.length && `+${c.add.length}`, c.remove.length && `−${c.remove.length}`].filter(Boolean).join(' ')})</span>}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </TableBox>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => save.mutate()} disabled={!changed || save.isPending}>
                {save.isPending ? 'Saving…' : changed
                  ? `Save (${[added && `${added} to add`, removed && `${removed} to remove`].filter(Boolean).join(', ')})`
                  : 'Saved'}
              </Button>
              {changed && !save.isPending && (
                <button onClick={() => setGrid(new Map([...saved].map(([tid, qs]) => [tid, new Set(qs)])))} className="text-sm text-slate-500 hover:underline">Undo changes</button>
              )}
              {message && <span role="status" className="text-sm text-slate-600">{message}</span>}
            </div>
          </div>
        )}
      </section>

      <section aria-label="Combining marks" className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium text-slate-700">When several teachers mark the same answer</h2>
        <p className="mt-1 text-sm text-slate-500">
          Every teacher's mark is kept on its own. This chooses which mark counts in the results and exports; you can also
          compare them on the Progress tab, and choose differently when you view results.
        </p>
        <label className="mt-3 grid max-w-md gap-1 text-sm font-medium text-slate-700">
          Marks that count
          <select
            value={markCombine}
            disabled={combine.isPending}
            onChange={(e) => combine.mutate(e.target.value as MarkCombine)}
            className="rounded border border-slate-300 px-2 py-2 text-sm font-normal"
          >
            {COMBINES.map((c) => <option key={c} value={c}>{COMBINE_LABELS[c]}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-slate-500">{COMBINE_HELP[markCombine]}</p>
        {combine.error && <p role="alert" className="mt-2 text-xs text-red-600">{(combine.error as Error).message}</p>}
      </section>
    </div>
  );
}

import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, ProgressBar } from './ui';
import { Collapsible } from './Collapsible';
import { useBatchRunner } from '../hooks/useBatchRunner';
import { describeRun } from '../lib/duration';
import { AiRunNotice } from './AiRunNotice';
import { GroupTick } from './DataTable';
import type { AiMode, AiScopeType, AiStrictness } from '@marker/shared-types';
import { questionLabel } from '../lib/questionLabel';

const SCOPES: [AiScopeType, string, string][] = [
  ['unmarked', 'Clips with no AI result yet', 'Skips anything the AI has already done.'],
  ['human_marked', 'Clips teachers have already marked', 'Best for checking how closely the AI agrees with your marking.'],
  ['sample', 'A random sample', 'A quick test on a few clips that have no AI result yet (that many for each ticked question).'],
  ['all', 'Everything again', 'Replaces existing AI marks. Teachers\' marks are never changed.'],
];

const MODES: [AiMode, string][] = [['marks', 'Marks'], ['feedback', 'Feedback'], ['both', 'Marks and feedback']];
const STRICTNESS: [AiStrictness, string][] = [['strict', 'Strict'], ['balanced', 'Balanced'], ['lenient', 'Lenient']];

// What a run of several ticked questions will do: each question's clips, in the exam's order
interface MultiPlan { parts: { question_id: string; label: string; clip_ids: string[] }[]; total: number }

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Everything for AI marking one exam, in two folding sections: choosing the questions and running the marking, and
 * the comparison of the AI's marks with the teachers'. The first is folded once the AI has marked something; the
 * second is folded until it has.
 */
export function AiExamWorkspace({ examId, initialQuestion }: { examId: string; initialQuestion?: string | null }) {
  const qc = useQueryClient();

  const progressQ = useQuery({ queryKey: ['progress', examId], queryFn: () => api.getProgress(examId) });
  const questionsQ = useQuery({ queryKey: ['questions', examId], queryFn: () => api.listQuestions(examId) });
  const aiQ = useQuery({ queryKey: ['ai-status'], queryFn: () => api.aiStatus() });

  // The questions to send, ticked in a list. `initialQuestion` opens with one ticked.
  const [selected, setSelected] = useState<string[]>(() => (initialQuestion ? [initialQuestion] : []));
  // Guidance is per question: each has its own mark scheme and wording
  const [guidanceBy, setGuidanceBy] = useState<Record<string, string>>({});
  // The question whose results are shown below (any question, not only the ones ticked)
  const [viewId, setViewId] = useState('');
  const [scope, setScope] = useState<AiScopeType>('unmarked');
  const [sampleCount, setSampleCount] = useState(10);
  const [mode, setMode] = useState<AiMode>('marks');
  const [strictness, setStrictness] = useState<AiStrictness>('balanced');
  const [useExamples, setUseExamples] = useState(true);
  const [plan, setPlan] = useState<MultiPlan | null>(null);
  const [onlyDisagreements, setOnlyDisagreements] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Sections opened or closed by hand; otherwise they follow what is on the page (see `runOpen` / `compareOpen`)
  const [openBy, setOpenBy] = useState<{ run?: boolean; compare?: boolean }>({});
  const batchSize = aiQ.data?.data.batch_size ?? 5; // answers per Gemini request
  const runner = useBatchRunner(aiQ.data?.data.step_size ?? batchSize); // answers per step (several requests at once)

  const questions = questionsQ.data?.data ?? [];
  // With nothing ticked yet, start with the first question ticked
  const started = useRef(false);
  useEffect(() => {
    if (started.current || questions.length === 0) return;
    started.current = true;
    if (selected.length === 0) setSelected([questions[0].id]);
  }, [selected, questions]);
  const chosen = questions.filter((q) => selected.includes(q.id)); // in the exam's order


  const settingsFor = (questionId: string) => ({
    question_id: questionId, mode, strictness, guidance: guidanceBy[questionId] ?? '', use_examples: useExamples,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-results', examId] });
    qc.invalidateQueries({ queryKey: ['progress', examId] });
    qc.invalidateQueries({ queryKey: ['home'] });
  };

  // One plan per ticked question, put together
  const planMut = useMutation({
    mutationFn: async (): Promise<MultiPlan> => {
      const scopeArg = { type: scope, count: scope === 'sample' ? sampleCount : undefined };
      const parts = await Promise.all(chosen.map(async (q) => ({ question: q, plan: (await api.aiPlan(examId, settingsFor(q.id), scopeArg)).data })));
      return { parts: parts.map((p) => ({ question_id: p.question.id, label: questionLabel(p.question.question_number), clip_ids: p.plan.clip_ids })), total: parts.reduce((n, p) => n + p.plan.total, 0) };
    },
    onSuccess: (r) => setPlan(r),
  });

  function start() {
    if (!plan) return;
    const questionOf = new Map(plan.parts.flatMap((p) => p.clip_ids.map((id) => [id, p.question_id] as const)));
    const ids = plan.parts.flatMap((p) => p.clip_ids);
    setPlan(null);
    runner.start(ids, async (batch) => {
      // A step can hold clips from two questions; each question is its own request (its own mark scheme and guidance)
      const groups = new Map<string, string[]>();
      for (const id of batch) groups.set(questionOf.get(id)!, [...(groups.get(questionOf.get(id)!) ?? []), id]);
      const answers = await Promise.all([...groups].map(([qid, clipIds]) => api.aiStep(examId, settingsFor(qid), clipIds)));
      return answers.flatMap((res) => res.data.results.map((r) => ({
        id: r.clip_id, ok: r.ok, error: r.error, code: r.code, retryable: r.retryable, fatal: r.fatal, retryAfter: r.retry_after_seconds,
      })));
    });
  }

  function toggle(id: string, on: boolean) {
    setSelected((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
    setPlan(null);
  }

  const progressByQ = new Map((progressQ.data?.data.questions ?? []).map((p) => [p.question_id, p]));
  const statsOf = (qid: string) => {
    const p = progressByQ.get(qid);
    return p ? `${p.marked_clips} teachers · ${p.ai_marked_clips} AI · of ${p.total_clips}` : '';
  };
  const totalAi = [...progressByQ.values()].reduce((n, p) => n + p.ai_marked_clips, 0);
  const totalClips = [...progressByQ.values()].reduce((n, p) => n + p.total_clips, 0);
  const hasAi = totalAi > 0;

  // The comparison shows one question at a time: only questions the AI has marked, with arrows to step through them
  const withAi = questions.filter((q) => (progressByQ.get(q.id)?.ai_marked_clips ?? 0) > 0);
  const viewQuestionId = withAi.some((q) => q.id === viewId) ? viewId : (withAi[0]?.id ?? '');
  const resultsQ = useQuery({
    queryKey: ['ai-results', examId, viewQuestionId],
    queryFn: () => api.aiResults(examId, viewQuestionId),
    enabled: Boolean(viewQuestionId),
  });

  if (questionsQ.isLoading || progressQ.isLoading) return <div className="text-slate-500">Loading…</div>;

  const run = describeRun(plan?.total ?? 0, batchSize, aiQ.data?.data.max_rpm ?? 0, aiQ.data?.data.max_rpd ?? 0);
  const configured = aiQ.data?.data.configured ?? true;
  // A question with no mark scheme region needs guidance typed for it
  const lacking = chosen.filter((q) => !q.ms_clip_image_url && !(guidanceBy[q.id] ?? '').trim());
  const needsGuidance = lacking.length > 0;
  const running = runner.state.status === 'running' || runner.state.status === 'paused';

  // Sections: choosing and running is folded once the AI has marked something; the comparison is folded until then.
  // A run in progress, or a plan waiting for a go-ahead, keeps the first one open.
  const runOpen = openBy.run ?? (!hasAi || running || Boolean(plan) || planMut.isError);
  const compareOpen = openBy.compare ?? hasAi;

  const viewIndex = withAi.findIndex((q) => q.id === viewQuestionId);
  const results = resultsQ.data?.data;
  const rows = (results?.rows ?? []).filter((r) => r.ai_mark !== null || r.ai_feedback);
  const shown = onlyDisagreements ? rows.filter((r) => r.difference !== null && r.difference !== 0) : rows;

  return (
    <div className="space-y-3">
      {!configured && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div role="alert">AI isn't set up on this server (no Gemini key), so runs are unavailable.</div>
        </Card>
      )}

      {/* Progress and results of a run stay in view whether or not the settings below are folded */}
      {(running || runner.state.status === 'done' || runner.state.failed.length > 0) && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          {running && (
            <>
              <ProgressBar value={runner.state.done + runner.state.failed.length} max={runner.state.total} label="AI marking progress" />
              <div className="text-sm text-slate-600">
                {runner.state.done} of {runner.state.total} done{runner.state.failed.length > 0 && `, ${runner.state.failed.length} failed`}
              </div>
              {runner.state.status === 'running'
                ? <Button variant="secondary" onClick={runner.pause}>Pause</Button>
                : <Button variant="primary" onClick={runner.resume}>Resume</Button>}
            </>
          )}
          <AiRunNotice state={runner.state} onResume={runner.resume} onDismiss={runner.reset} />
          {runner.state.status === 'done' && (
            <p className="text-sm text-green-700">
              Finished: {runner.state.done} done{runner.state.failed.length > 0 && `, ${runner.state.failed.length} failed (details above). Run it again to retry them`}.
              <button className="ml-2 text-indigo-600 underline" onClick={() => { runner.reset(); refresh(); setOpenBy((o) => ({ ...o, compare: true })); }}>Show results</button>
            </p>
          )}
        </div>
      )}

      <Collapsible
        title="Choose questions and run AI marking"
        open={runOpen}
        onToggle={() => setOpenBy((o) => ({ ...o, run: !runOpen }))}
        summary={hasAi
          ? `AI has marked ${totalAi} of ${totalClips} answers. ${selected.length} of ${questions.length} questions ticked for the next run.`
          : `${selected.length} of ${questions.length} questions ticked`}
      >
        <div className="space-y-5">
        <fieldset disabled={running}>
          <legend className="mb-1 text-sm font-medium text-slate-700">Questions</legend>
          <div className="mb-2 flex gap-3 text-xs">
            <button type="button" className="text-indigo-600 hover:underline" onClick={() => { setSelected(questions.map((q) => q.id)); setPlan(null); }}>Tick all</button>
            <button type="button" className="text-indigo-600 hover:underline" onClick={() => { setSelected([]); setPlan(null); }}>Clear</button>
            <span className="text-slate-500">{selected.length} of {questions.length} ticked</span>
          </div>
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <GroupTick
                      label="Tick or clear every question"
                      ticked={selected.length}
                      total={questions.length}
                      onChange={(on) => { setSelected(on ? questions.map((q) => q.id) : []); setPlan(null); }}
                    />
                  </th>
                  <th className="px-2 py-2">Question</th>
                  <th className="px-2 py-2">Marks</th>
                  <th className="whitespace-nowrap px-2 py-2">Mark scheme</th>
                  <th className="whitespace-nowrap px-2 py-2" title="Clips marked by teachers / by the AI, out of all clips">Marked</th>
                  <th className="w-full px-2 py-2">Marking guidance <span className="font-normal normal-case text-slate-400">(the mark scheme region is used too)</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {questions.map((q) => {
                  const on = selected.includes(q.id);
                  const hasMs = Boolean(q.ms_clip_image_url);
                  const guidance = guidanceBy[q.id] ?? '';
                  const missing = on && !hasMs && !guidance.trim();
                  return (
                    <tr key={q.id} className={on ? 'bg-indigo-50/60' : ''}>
                      <td className="px-3 py-1 align-top">
                        <input id={`ai-q-${q.id}`} type="checkbox" className="mt-1" checked={on} onChange={(e) => toggle(q.id, e.target.checked)} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 align-top font-medium text-slate-800">
                        <label htmlFor={`ai-q-${q.id}`} className="block cursor-pointer py-0.5">Q{questionLabel(q.question_number)}</label>
                      </td>
                      <td className="px-2 py-1 align-top tabular-nums text-slate-600"><span className="block py-0.5">{q.max_marks}</span></td>
                      <td className="whitespace-nowrap px-2 py-1 align-top">
                        <span className={`block py-1.5 text-xs ${hasMs ? 'text-green-700' : 'text-amber-700'}`}>{hasMs ? '✓ clipped' : 'none'}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 align-top text-xs text-slate-600">
                        <span className="block py-1.5">{statsOf(q.id)}</span>
                      </td>
                      <td className="px-2 py-1 align-top">
                        <textarea
                          rows={1}
                          aria-label={`Marking guidance for Q${questionLabel(q.question_number)}`}
                          value={guidance}
                          onChange={(e) => setGuidanceBy((g) => ({ ...g, [q.id]: e.target.value }))}
                          placeholder={hasMs ? 'Optional, e.g. accept equivalent wording' : 'Needed: this question has no mark scheme region'}
                          className={`min-h-8 w-full resize-y rounded border px-2 py-1 text-sm ${missing ? 'border-amber-400 bg-amber-50' : 'border-slate-300'} ${on ? '' : 'opacity-60'}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Which clips</legend>
          <div className="space-y-1">
            {SCOPES.map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-sm text-slate-700">
                <input type="radio" name="scope" checked={scope === value} onChange={() => { setScope(value); setPlan(null); }} className="mt-1" />
                <span>
                  {label} <span className="text-xs text-slate-500">{hint}</span>
                  {value === 'sample' && scope === 'sample' && (
                    <input
                      type="number" min={1} max={500} value={sampleCount}
                      onChange={(e) => setSampleCount(Math.max(1, Number(e.target.value) || 1))}
                      aria-label="Sample size"
                      className="ml-2 w-20 rounded border border-slate-300 px-2 py-0.5 text-sm"
                    />
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">What to produce</legend>
            <div className="flex flex-wrap gap-3">
              {MODES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="radio" name="mode" checked={mode === value} onChange={() => { setMode(value); setPlan(null); }} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">How closely to follow the mark scheme</legend>
            <div className="flex flex-wrap gap-3">
              {STRICTNESS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="radio" name="strictness" checked={strictness === value} onChange={() => setStrictness(value)} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={useExamples} onChange={(e) => setUseExamples(e.target.checked)} className="mt-1" />
          <span>
            Use teachers' marked examples as reference points
            <span className="block text-xs text-slate-500">
              Shows the AI up to four clips teachers have marked on each question, spread from low to high marks. Needs some marking done first.
            </span>
          </span>
        </label>

          {!running && (
            plan ? (
              <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p>
                  <strong>{plan.total}</strong> clip{plan.total === 1 ? '' : 's'}
                  {plan.parts.length > 1 && <> across {plan.parts.length} questions ({plan.parts.map((p) => `Q${p.label}: ${p.clip_ids.length}`).join(', ')})</>} will be sent to Gemini
                  {useExamples ? ', along with a few teacher-marked reference examples' : ''}. This uses your Gemini quota.
                  {' '}{batchSize === 1
                    ? <>Each is marked on its own, in <strong>{run.requests}</strong> request{run.requests === 1 ? '' : 's'}</>
                    : <>They go in <strong>{run.requests}</strong> request{run.requests === 1 ? '' : 's'} of up to {batchSize}</>}
                  {run.duration && <>, which will take {run.duration}; you can leave this page open and pause at any time</>}.
                  {plan.total === 0 && ' There is nothing to do for these settings.'}
                </p>
                {run.overDailyLimit && (
                  <p className="font-medium text-red-800">
                    That is more than the {aiQ.data?.data.max_rpd} requests a day this Gemini key allows. The run will stop when the daily
                    limit is reached and can be resumed tomorrow, or choose a smaller sample now.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button variant="primary" disabled={plan.total === 0} onClick={start}>Start marking</Button>
                  <Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Button variant="primary" disabled={!configured || chosen.length === 0 || needsGuidance || planMut.isPending} onClick={() => planMut.mutate()}>
                  {planMut.isPending ? 'Checking…' : chosen.length > 1 ? `Review and run ${chosen.length} questions` : 'Review and run'}
                </Button>
                {needsGuidance && (
                  <p className="text-xs text-amber-700">Add guidance for {lacking.map((q) => `Q${questionLabel(q.question_number)}`).join(', ')} (no mark scheme region), or untick {lacking.length === 1 ? 'it' : 'them'}.</p>
                )}
              </div>
            )
          )}
          {planMut.error && <p role="alert" className="text-sm text-red-700">{(planMut.error as Error).message}</p>}
        </div>
      </Collapsible>

      <Collapsible
        title="Teachers and AI compared"
        open={compareOpen}
        onToggle={() => setOpenBy((o) => ({ ...o, compare: !compareOpen }))}
        summary={hasAi ? `${withAi.length} question${withAi.length === 1 ? '' : 's'} with AI marks` : 'Nothing to compare until the AI has marked some answers'}
      >
        {!hasAi ? (
          <p className="text-sm text-slate-500">No AI marks yet. Run AI marking above, then come back to see how it compares with the teachers.</p>
        ) : (
          <>
            <div className="-mx-4 -mt-4 mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <button
                  type="button" aria-label="Previous question" disabled={viewIndex <= 0}
                  onClick={() => { setViewId(withAi[viewIndex - 1].id); setOpen(null); }}
                  className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40"
                >‹</button>
                <label className="flex items-center gap-1.5">
                  Question
                  <select value={viewQuestionId} onChange={(e) => { setViewId(e.target.value); setOpen(null); }} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
                    {withAi.map((q) => <option key={q.id} value={q.id}>Q{questionLabel(q.question_number)} ({progressByQ.get(q.id)?.ai_marked_clips} AI)</option>)}
                  </select>
                </label>
                <button
                  type="button" aria-label="Next question" disabled={viewIndex < 0 || viewIndex >= withAi.length - 1}
                  onClick={() => { setViewId(withAi[viewIndex + 1].id); setOpen(null); }}
                  className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40"
                >›</button>
              </div>
              {results && results.stats.compared > 0 && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                  <span><strong>{results.stats.compared}</strong> clips with both</span>
                  <span><strong>{results.stats.exact_pct}%</strong> exactly the same</span>
                  <span><strong>{results.stats.within_one_pct}%</strong> within 1 mark</span>
                  <span>average gap <strong>{results.stats.mean_abs_diff}</strong></span>
                  <span>AI is on average <strong>{signed(results.stats.mean_signed_diff ?? 0)}</strong> vs teachers</span>
                </div>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={onlyDisagreements} onChange={(e) => setOnlyDisagreements(e.target.checked)} /> Disagreements only
              </label>
            </div>
            {rows.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">No AI marks for this question yet.</p>
            ) : shown.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">No disagreements to show.</p>
            ) : (
              <div className="-mx-4 -mb-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Script</th>
                      <th className="px-4 py-2 text-left">Teacher</th>
                      <th className="px-4 py-2 text-left">AI</th>
                      <th className="px-4 py-2 text-left">Difference</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((r) => (
                      <Fragment key={r.clip_id}>
                        <tr>
                          <td className="px-4 py-2">Script {r.student_number}</td>
                          <td className="px-4 py-2">{r.human_mark ?? <span className="text-slate-400">not marked</span>}</td>
                          <td className="px-4 py-2">{r.ai_mark ?? <span className="text-slate-400">no mark</span>} <span className="text-slate-400">/ {results?.max_marks}</span></td>
                          <td className={`px-4 py-2 font-medium ${r.difference === null ? 'text-slate-300' : r.difference === 0 ? 'text-green-700' : 'text-amber-700'}`}>
                            {r.difference === null ? '-' : signed(r.difference)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button className="text-xs text-indigo-600 hover:underline" onClick={() => setOpen(open === r.clip_id ? null : r.clip_id)}>
                              {open === r.clip_id ? 'Hide' : 'Show response and reasoning'}
                            </button>
                          </td>
                        </tr>
                        {open === r.clip_id && (
                          <tr className="bg-slate-50">
                            <td colSpan={5} className="px-4 py-3">
                              <div className="flex flex-col gap-4 md:flex-row">
                                <img src={api.clipImageUrl(r.clip_id)} alt={`Response from script ${r.student_number}`} className="max-h-64 max-w-full rounded border border-slate-200 md:max-w-md" />
                                <div className="space-y-2 text-sm text-slate-700">
                                  {r.ai_reasoning && <p><span className="font-medium">AI reasoning:</span> {r.ai_reasoning}</p>}
                                  {r.ai_feedback && <p><span className="font-medium">AI feedback:</span> {r.ai_feedback}</p>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Collapsible>
    </div>
  );
}

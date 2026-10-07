import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, ProgressBar } from '../components/ui';
import { useBatchRunner } from '../hooks/useBatchRunner';
import type { AiMode, AiPlan, AiScopeType, AiStrictness } from '@marker/shared-types';

const SCOPES: [AiScopeType, string, string][] = [
  ['unmarked', 'Clips with no AI result yet', 'Skips anything the AI has already done.'],
  ['human_marked', 'Clips teachers have already marked', 'Best for checking how closely the AI agrees with your marking.'],
  ['sample', 'A random sample', 'A quick test on a few clips that have no AI result yet.'],
  ['all', 'Everything again', 'Replaces existing AI marks. Teachers\' marks are never changed.'],
];

const MODES: [AiMode, string][] = [['marks', 'Marks'], ['feedback', 'Feedback'], ['both', 'Marks and feedback']];
const STRICTNESS: [AiStrictness, string][] = [['strict', 'Strict'], ['balanced', 'Balanced'], ['lenient', 'Lenient']];

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function AiMarking() {
  const { id: examId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const examQ = useQuery({ queryKey: ['exam', examId], queryFn: () => api.getExam(examId!) });
  const questionsQ = useQuery({ queryKey: ['questions', examId], queryFn: () => api.listQuestions(examId!) });
  const aiQ = useQuery({ queryKey: ['ai-status'], queryFn: () => api.aiStatus() });

  const [questionId, setQuestionId] = useState('');
  const [scope, setScope] = useState<AiScopeType>('unmarked');
  const [sampleCount, setSampleCount] = useState(10);
  const [mode, setMode] = useState<AiMode>('marks');
  const [strictness, setStrictness] = useState<AiStrictness>('balanced');
  const [guidance, setGuidance] = useState('');
  const [useExamples, setUseExamples] = useState(true);
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [onlyDisagreements, setOnlyDisagreements] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const runner = useBatchRunner(3);

  const questions = questionsQ.data?.data ?? [];
  useEffect(() => {
    if (!questionId && questions.length > 0) setQuestionId(questions[0].id);
  }, [questionId, questions]);
  const question = questions.find((q) => q.id === questionId);

  const resultsQ = useQuery({
    queryKey: ['ai-results', examId, questionId],
    queryFn: () => api.aiResults(examId!, questionId),
    enabled: Boolean(questionId),
  });

  const settings = { question_id: questionId, mode, strictness, guidance, use_examples: useExamples };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-results', examId, questionId] });
    qc.invalidateQueries({ queryKey: ['progress', examId] });
    qc.invalidateQueries({ queryKey: ['home'] });
  };

  const planMut = useMutation({
    mutationFn: () => api.aiPlan(examId!, settings, { type: scope, count: scope === 'sample' ? sampleCount : undefined }),
    onSuccess: (r) => setPlan(r.data),
  });

  function start() {
    if (!plan) return;
    const ids = plan.clip_ids;
    setPlan(null);
    runner.start(ids, async (batch) => {
      const res = await api.aiStep(examId!, settings, batch);
      return res.data.results.map((r) => ({ id: r.clip_id, ok: r.ok, error: r.error }));
    });
  }

  if (examQ.isLoading || questionsQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  const configured = aiQ.data?.data.configured ?? true;
  const hasMs = Boolean(question?.ms_clip_image_url);
  const needsGuidance = !hasMs && !guidance.trim();
  const running = runner.state.status === 'running' || runner.state.status === 'paused';
  const results = resultsQ.data?.data;
  const rows = (results?.rows ?? []).filter((r) => r.ai_mark !== null || r.ai_feedback);
  const shown = onlyDisagreements ? rows.filter((r) => r.difference !== null && r.difference !== 0) : rows;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Link to={`/exams/${examId}/progress`} className="text-sm text-indigo-600 hover:underline">← Progress</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-slate-800">AI marking: {examQ.data?.data.name}</h1>
      <p className="mb-5 text-sm text-slate-500">
        AI marks sit alongside teachers' marks and never replace them: where a teacher has marked a clip, their mark counts.
        Only the clipped answers go to Gemini, with names blacked out.
      </p>

      {!configured && (
        <Card className="mb-5 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" >
          <div role="alert">AI isn't set up on this server (no Gemini key), so runs are unavailable.</div>
        </Card>
      )}

      <Card className="mb-6 space-y-5 p-5">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Question
          <select
            value={questionId}
            onChange={(e) => { setQuestionId(e.target.value); setPlan(null); runner.reset(); setOpen(null); }}
            className="max-w-xs rounded border border-slate-300 px-2 py-2 text-sm font-normal"
          >
            {questions.map((q) => (
              <option key={q.id} value={q.id}>Q{q.question_number} ({q.max_marks} marks)</option>
            ))}
          </select>
        </label>

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

        <div>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Marking guidance {hasMs ? <span className="text-xs font-normal text-slate-500">(optional: the mark scheme region for this question is used too)</span>
              : <span className="text-xs font-normal text-amber-700">(needed: this question has no mark scheme region)</span>}
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={3}
              placeholder="For example: 1 mark for each correct definition; accept equivalent wording."
              className="rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
            />
          </label>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={useExamples} onChange={(e) => setUseExamples(e.target.checked)} className="mt-1" />
          <span>
            Use teachers' marked examples as reference points
            <span className="block text-xs text-slate-500">
              Shows the AI up to four clips teachers have marked on this question, spread from low to high marks. Needs some marking done first.
            </span>
          </span>
        </label>

        {running ? (
          <div className="space-y-2">
            <ProgressBar value={runner.state.done + runner.state.failed.length} max={runner.state.total} label="AI marking progress" />
            <div className="text-sm text-slate-600">
              {runner.state.done} of {runner.state.total} done{runner.state.failed.length > 0 && `, ${runner.state.failed.length} failed`}
            </div>
            {runner.state.status === 'running'
              ? <Button variant="secondary" onClick={runner.pause}>Pause</Button>
              : <Button variant="primary" onClick={runner.resume}>Resume</Button>}
          </div>
        ) : plan ? (
          <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              <strong>{plan.total}</strong> clip{plan.total === 1 ? '' : 's'} will be sent to Gemini
              {useExamples ? ', each with a few reference examples' : ''}. This uses your Gemini quota.
              {plan.total === 0 && ' There is nothing to do for these settings.'}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" disabled={plan.total === 0} onClick={start}>Start marking</Button>
              <Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" disabled={!configured || !questionId || needsGuidance || planMut.isPending} onClick={() => planMut.mutate()}>
            {planMut.isPending ? 'Checking…' : 'Review and run'}
          </Button>
        )}
        {planMut.error && <p role="alert" className="text-sm text-red-700">{(planMut.error as Error).message}</p>}
        {runner.state.fatal && <p role="alert" className="text-sm text-red-700">Stopped: {runner.state.fatal}</p>}
        {runner.state.status === 'done' && (
          <p className="text-sm text-green-700">
            Finished: {runner.state.done} done{runner.state.failed.length > 0 && `, ${runner.state.failed.length} failed (${runner.state.failed[0].error}). Run it again to retry them`}.
            <button className="ml-2 text-indigo-600 underline" onClick={() => { runner.reset(); refresh(); }}>Refresh results</button>
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium text-slate-700">Teachers and AI compared</h2>
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
          <p className="px-4 py-6 text-sm text-slate-500">No AI marks for this question yet.</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No disagreements to show.</p>
        ) : (
          <div className="overflow-x-auto">
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
      </Card>
    </div>
  );
}

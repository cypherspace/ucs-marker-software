import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../api';
import { AppLink, Button, Card, LinkButton, ProgressBar } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useBatchRunner } from '../hooks/useBatchRunner';
import { estimateRun } from '../lib/duration';
import { AiRunNotice } from '../components/AiRunNotice';

export function ComparativeRanking() {
  const { examId, questionId } = useParams<{ examId: string; questionId: string }>();
  const qc = useQueryClient();

  const examQ = useQuery({ queryKey: ['exam', examId], queryFn: () => api.getExam(examId!) });
  const statusQ = useQuery({
    queryKey: ['compare-status', examId, questionId],
    queryFn: () => api.compareStatus(examId!, questionId!),
  });
  const rankingQ = useQuery({
    queryKey: ['compare-ranking', examId, questionId],
    queryFn: () => api.compareRanking(examId!, questionId!),
    retry: false,
  });
  const aiQ = useQuery({ queryKey: ['ai-status'], queryFn: () => api.aiStatus() });

  const [perItem, setPerItem] = useState(6);
  const [preview, setPreview] = useState<{ round: number; count: number } | null>(null);
  const [guidance, setGuidance] = useState('');
  const [useExamples, setUseExamples] = useState(true);
  const [plan, setPlan] = useState<{ pair_ids: string[]; total: number; has_mark_scheme: boolean } | null>(null);
  const runner = useBatchRunner(3);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['compare-status', examId, questionId] });
    qc.invalidateQueries({ queryKey: ['compare-ranking', examId, questionId] });
    qc.invalidateQueries({ queryKey: ['home'] });
  };

  const previewMut = useMutation({
    mutationFn: () => api.compareCreatePairs(examId!, questionId!, perItem, true),
    onSuccess: (r) => setPreview({ round: r.data.round, count: r.data.count }),
  });
  const createMut = useMutation({
    mutationFn: () => api.compareCreatePairs(examId!, questionId!, perItem, false),
    onSuccess: () => { setPreview(null); refresh(); },
  });
  const planMut = useMutation({
    mutationFn: () => api.compareAiPlan(examId!, questionId!),
    onSuccess: (r) => setPlan(r.data),
  });

  function startAi() {
    if (!plan) return;
    const ids = plan.pair_ids;
    setPlan(null);
    runner.start(ids, async (batch) => {
      const res = await api.compareAiStep(examId!, questionId!, batch, guidance, useExamples);
      return res.data.results.map((r) => ({ id: r.pair_id, ok: r.ok, error: r.error, code: r.code, retryable: r.retryable, fatal: r.fatal, retryAfter: r.retry_after_seconds }));
    });
  }

  if (statusQ.isLoading || examQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  const status = statusQ.data?.data;
  if (!status) return <div className="p-6 text-red-600" role="alert">Could not load this question.</div>;

  const forbidden = rankingQ.error instanceof HttpError && rankingQ.error.status === 403;
  if (forbidden) {
    return (
      <div className="p-6 text-sm text-slate-600" role="alert">
        Only the lead teacher or an admin can manage comparisons and see the ranking.{' '}
        <AppLink to={`/compare/${examId}/${questionId}`} className="text-indigo-600 hover:underline">Judge some comparisons</AppLink>
      </div>
    );
  }

  const ranking = rankingQ.data?.data;
  const scores = ranking?.ranked.map((r) => r.score) ?? [];
  const lo = Math.min(...scores, 0);
  const hi = Math.max(...scores, 0);
  const pct = (s: number) => (hi === lo ? 50 : Math.round(((s - lo) / (hi - lo)) * 100));
  const running = runner.state.status === 'running' || runner.state.status === 'paused';
  const roundDone = status.pairs_total > 0 && status.unjudged === 0;
  const aiReady = aiQ.data?.data.configured ?? true;
  const createError = (createMut.error ?? previewMut.error) as Error | null;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title={`Ranking: ${examQ.data?.data.name ?? ''}`}
        crumbs={[
          { label: 'Home', to: '/' }, { label: 'Exams', to: '/exams' },
          { label: examQ.data?.data.name ?? 'Exam', to: `/exams/${examId}` }, { label: 'Ranking' },
        ]}
        back={{ to: `/exams/${examId}`, label: 'Progress' }}
        subtitle="Scripts ranked from every comparison made so far. Where a teacher and the AI judged the same pair, the teacher's judgement is used."
      />

      {status.marking_mode !== 'comparative' && (
        <Card className="mb-5 p-4 text-sm text-slate-700">
          This question is not set to "Rank by comparison". Change it on the exam's{' '}
          <AppLink to={`/exams/${examId}/setup`} className="text-indigo-600 hover:underline">setup page</AppLink>.
        </Card>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {([
          ['Scripts', status.clips], ['Comparisons', status.pairs_total], ['Judged by teachers', status.human_judged],
          ['Judged by AI', status.ai_judged], ['Still to judge', status.unjudged],
        ] as [string, number][]).map(([label, n]) => (
          <Card key={label} className="p-3">
            <div className="text-2xl font-semibold text-slate-800">{n}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </Card>
        ))}
      </div>

      {status.marking_mode === 'comparative' && (
        <div className="mb-6 space-y-4">
          {(status.pairs_total === 0 || roundDone) && (
            <Card className="p-4">
              <h2 className="mb-1 font-medium text-slate-700">
                {status.pairs_total === 0 ? 'Set up the comparisons' : `Start round ${status.rounds + 1}`}
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                {status.pairs_total === 0
                  ? 'Each script is paired with several others at random. More comparisons make a more reliable ranking.'
                  : 'The next round compares scripts that are close together in the current ranking, which sharpens the order.'}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-xs text-slate-600">
                  Comparisons per script
                  <select
                    value={perItem}
                    onChange={(e) => { setPerItem(Number(e.target.value)); setPreview(null); }}
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                  >
                    {[3, 4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <Button variant="secondary" disabled={previewMut.isPending || status.clips < 2} onClick={() => previewMut.mutate()}>
                  Preview
                </Button>
                <Button variant="primary" disabled={createMut.isPending || status.clips < 2} onClick={() => createMut.mutate()}>
                  {createMut.isPending ? 'Creating…' : status.pairs_total === 0 ? 'Create comparisons' : 'Create next round'}
                </Button>
              </div>
              {preview && (
                <p className="mt-3 text-sm text-slate-700">
                  This would create <strong>{preview.count}</strong> comparison{preview.count === 1 ? '' : 's'} for {status.clips} scripts.
                </p>
              )}
              {status.clips < 2 && <p className="mt-3 text-sm text-amber-700">At least two clipped scripts are needed.</p>}
              {createError && <p role="alert" className="mt-3 text-sm text-red-700">{createError.message}</p>}
            </Card>
          )}

          {status.unjudged > 0 && (
            <Card className="p-4">
              <h2 className="mb-1 font-medium text-slate-700">Judge the remaining {status.unjudged} comparison{status.unjudged === 1 ? '' : 's'}</h2>
              <p className="mb-3 text-xs text-slate-500">
                Teachers can judge as many as they choose; the AI then judges the rest, using the teachers' judgements and marks as reference points.
              </p>
              <div className="mb-4">
                <LinkButton to={`/compare/${examId}/${questionId}`} variant="primary">Judge some myself</LinkButton>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-medium text-slate-700">Let the AI judge the rest</h3>
                {!aiReady && (
                  <p className="mb-2 text-sm text-amber-700" role="alert">AI isn't set up on this server (no Gemini key), so this is unavailable.</p>
                )}
                <label className="mb-2 grid gap-1 text-xs text-slate-600">
                  Guidance for the AI (optional)
                  <textarea
                    value={guidance}
                    onChange={(e) => setGuidance(e.target.value)}
                    rows={2}
                    placeholder="For example: reward a clear argument over length."
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="mb-3 flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={useExamples} onChange={(e) => setUseExamples(e.target.checked)} className="mt-1" />
                  <span>Use teachers' judgements and marks as reference points <span className="text-xs text-slate-500">(better calibrated; sends a few extra images per comparison)</span></span>
                </label>

                {running ? (
                  <div className="space-y-2">
                    <ProgressBar value={runner.state.done + runner.state.failed.length} max={runner.state.total} label="AI judging progress" />
                    <div className="text-sm text-slate-600">
                      {runner.state.done} of {runner.state.total} judged{runner.state.failed.length > 0 && `, ${runner.state.failed.length} failed`}
                    </div>
                    {runner.state.status === 'running'
                      ? <Button variant="secondary" onClick={runner.pause}>Pause</Button>
                      : <Button variant="primary" onClick={runner.resume}>Resume</Button>}
                  </div>
                ) : plan ? (
                  <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <p>
                      <strong>{plan.total}</strong> comparison{plan.total === 1 ? '' : 's'} will be sent to Gemini (two anonymous images each
                      {useExamples ? ', plus a few reference comparisons' : ''}). Names are blacked out on the clips.
                      {estimateRun(plan.total, aiQ.data?.data.max_rpm ?? 0) && ` To stay within Gemini's limits this will take ${estimateRun(plan.total, aiQ.data?.data.max_rpm ?? 0)}; you can leave this page open and pause at any time.`}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="primary" disabled={plan.total === 0} onClick={startAi}>Start</Button>
                      <Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="secondary" disabled={!aiReady || planMut.isPending} onClick={() => planMut.mutate()}>
                    {planMut.isPending ? 'Checking…' : 'Review and run AI judging'}
                  </Button>
                )}
                {planMut.error && <p role="alert" className="mt-2 text-sm text-red-700">{(planMut.error as Error).message}</p>}
                <AiRunNotice state={runner.state} onResume={runner.resume} onDismiss={runner.reset} />
                {runner.state.status === 'done' && (
                  <p className="mt-2 text-sm text-green-700">
                    AI judging finished{runner.state.failed.length > 0 && `, but ${runner.state.failed.length} comparison${runner.state.failed.length === 1 ? '' : 's'} failed (details above). Run it again to retry them`}.
                    <button className="ml-2 text-indigo-600 underline" onClick={() => { runner.reset(); refresh(); }}>Refresh results</button>
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium text-slate-700">Ranking</h2>
          <span className="text-xs text-slate-500">{ranking ? `${ranking.judged_pairs} of ${ranking.total_pairs} comparisons judged` : ''}</span>
        </div>
        {!ranking || ranking.judged_pairs === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">The ranking appears once some comparisons have been judged.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ranking.ranked.map((r) => (
              <li key={r.clip_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
                <span className="w-8 text-right font-semibold text-slate-700">{r.rank}</span>
                <span className="w-24 text-slate-700">Script {r.student_number}</span>
                <div className="min-w-[8rem] flex-1">
                  <ProgressBar value={pct(r.score)} max={100} label={`Score for script ${r.student_number}`} />
                </div>
                <span className="w-40 text-xs text-slate-500">
                  {r.judgements} comparison{r.judgements === 1 ? '' : 's'} ({r.human} teacher, {r.ai} AI)
                </span>
                <a href={api.clipImageUrl(r.clip_id)} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">View response</a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

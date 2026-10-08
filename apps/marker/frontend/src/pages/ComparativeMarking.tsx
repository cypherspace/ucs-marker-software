import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../api';
import { Button, Card, LinkButton, ProgressBar } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useBackTarget } from '../lib/nav';

function ClipImage({ clipId, label }: { clipId: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="text-sm text-slate-400">Image unavailable</div>
  ) : (
    <img
      src={api.clipImageUrl(clipId)}
      alt={label}
      onError={() => setFailed(true)}
      className="max-w-full rounded border border-slate-200"
    />
  );
}

export function ComparativeMarking() {
  const { examId, questionId } = useParams<{ examId: string; questionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const backTarget = useBackTarget({ to: '/my-exams', label: 'Marking' });

  const meQ = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.me() });
  const examQ = useQuery({ queryKey: ['exam', examId], queryFn: () => api.getExam(examId!) });
  const statusQ = useQuery({
    queryKey: ['compare-status', examId, questionId],
    queryFn: () => api.compareStatus(examId!, questionId!),
  });

  // How many comparisons this teacher has chosen to judge in this sitting.
  const [quota, setQuota] = useState<number | null>(null);
  const [wanted, setWanted] = useState('');
  const [judged, setJudged] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const judging = quota !== null && judged < quota;
  const nextQ = useQuery({
    queryKey: ['compare-next', examId, questionId, judged, nonce],
    queryFn: () => api.compareNext(examId!, questionId!),
    enabled: judging,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  const pair = nextQ.data?.data;

  const judge = useMutation({
    mutationFn: (winner: string) => api.compareJudge(pair!.pair_id, winner),
    onSuccess: () => { setNotice(null); setJudged((j) => j + 1); },
    onError: (err) => {
      if (err instanceof HttpError && err.code === 'ALREADY_JUDGED') {
        setNotice('Someone else just judged that pair, so here is another.');
        setNonce((n) => n + 1);
      } else {
        setNotice((err as Error).message);
      }
    },
  });

  useEffect(() => {
    if (!judging || !pair) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (judge.isPending) return;
      if (e.key === 'ArrowLeft') judge.mutate(pair!.clip_a_id);
      if (e.key === 'ArrowRight') judge.mutate(pair!.clip_b_id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [judging, pair, judge]);

  const status = statusQ.data?.data;
  const me = meQ.data?.data;
  const isLead = Boolean(me && (me.role === 'admin' || examQ.data?.data.lead_teacher_id === me.id));

  function finish() {
    setQuota(null);
    setJudged(0);
    setNotice(null);
    qc.invalidateQueries({ queryKey: ['compare-status', examId, questionId] });
    qc.invalidateQueries({ queryKey: ['home'] });
  }

  if (statusQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (statusQ.error || !status) {
    return <div className="p-6 text-red-600" role="alert">{(statusQ.error as Error | null)?.message ?? 'Could not load this question.'}</div>;
  }

  // ── Start screen: choose how many to judge ─────────────────────────────────
  if (quota === null) {
    const available = status.human_available;
    const max = Math.max(1, available);
    const chosen = Math.min(max, Math.max(1, Number(wanted || Math.min(20, available) || 1)));
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <PageHeader
          title="Comparative marking"
          crumbs={[{ label: 'Home', to: '/' }, { label: 'Marking', to: '/my-exams' }, { label: 'Comparisons' }]}
          back={{ to: '/my-exams', label: 'Marking' }}
          subtitle="For each pair of anonymous responses, pick the better one. The ranking is built from all the comparisons."
        />
        <Card className="space-y-4 p-5">
          {status.marking_mode !== 'comparative' ? (
            <p className="text-sm text-slate-600">This question is marked with marks, not by comparison.</p>
          ) : status.pairs_total === 0 ? (
            <>
              <p className="text-sm text-slate-600">Comparisons haven't been set up for this question yet.</p>
              {isLead && (
                <LinkButton to={`/compare/${examId}/${questionId}/ranking`} variant="primary">Set up comparisons</LinkButton>
              )}
            </>
          ) : available === 0 ? (
            <>
              <p className="text-sm text-slate-600">Every comparison has been judged by a teacher. Thank you.</p>
              {isLead && <LinkButton to={`/compare/${examId}/${questionId}/ranking`} variant="primary">See the ranking</LinkButton>}
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                <strong>{available}</strong> comparison{available === 1 ? ' is' : 's are'} waiting for a teacher
                {status.ai_judged > 0 && ` (the AI has already judged ${status.ai_judged}; your judgement replaces the AI's)`}.
                You have judged {status.my_judged} so far.
              </p>
              <label className="grid gap-1 text-sm text-slate-700">
                How many will you judge now?
                <input
                  type="number"
                  min={1}
                  max={max}
                  value={wanted}
                  placeholder={String(Math.min(20, available))}
                  onChange={(e) => setWanted(e.target.value)}
                  className="w-28 rounded border border-slate-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <p className="text-xs text-slate-500">
                You choose how many; {isLead ? 'the AI can judge the rest from the ranking page.' : 'the lead teacher can have the AI judge the rest.'}
              </p>
              <Button variant="primary" onClick={() => { setJudged(0); setQuota(chosen); }}>
                Start judging {chosen}
              </Button>
            </>
          )}
        </Card>
      </div>
    );
  }

  // ── Finished ───────────────────────────────────────────────────────────────
  if (!judging || (nextQ.isSuccess && !pair)) {
    return (
      <div className="mx-auto max-w-xl p-6 text-center">
        <h1 className="mb-2 text-2xl font-semibold text-slate-800">
          {judged > 0 ? `You judged ${judged} comparison${judged === 1 ? '' : 's'}` : 'No more comparisons'}
        </h1>
        <p className="mb-5 text-sm text-slate-500">
          {nextQ.isSuccess && !pair ? 'There are no more pairs waiting for a teacher.' : 'Thank you. Your judgements are saved.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={finish}>Back to start</Button>
          {isLead && <LinkButton to={`/compare/${examId}/${questionId}/ranking`} variant="primary">See the ranking</LinkButton>}
          <Button variant="secondary" onClick={() => navigate(backTarget.to, { state: backTarget.state })}>Back to {backTarget.label}</Button>
        </div>
      </div>
    );
  }

  // ── Judging ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="font-medium text-slate-700">Which response is better?</div>
        <div className="flex min-w-[10rem] flex-1 items-center gap-3 sm:max-w-xs">
          <ProgressBar value={judged} max={quota} label="Comparisons judged" />
          <span className="whitespace-nowrap text-sm text-slate-500">{judged + 1} of {quota}</span>
        </div>
        <Button variant="secondary" className="ml-auto" onClick={finish}>Finish early</Button>
      </div>
      {notice && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">{notice}</div>}

      {nextQ.isLoading || !pair ? (
        <div className="p-6 text-slate-500">Loading…</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {([['A', pair.clip_a_id, 'ArrowLeft'], ['B', pair.clip_b_id, 'ArrowRight']] as const).map(([label, clipId, key]) => (
            <div key={label} className="flex min-h-0 flex-1 flex-col border-b border-slate-200 md:border-b-0 md:border-r last:md:border-r-0">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-center text-sm font-medium text-slate-600">
                Response {label}
              </div>
              <div className="flex-1 overflow-auto p-4"><ClipImage clipId={clipId} label={`Response ${label}`} /></div>
              <div className="border-t border-slate-200 p-3">
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={judge.isPending}
                  onClick={() => judge.mutate(clipId)}
                >
                  {label} is better <span className="ml-1 hidden text-xs opacity-70 md:inline">({key === 'ArrowLeft' ? '←' : '→'})</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ClassScope } from '../api';
import { friendlyError } from '../lib/errors';
import { saveBlob } from '../lib/saveFile';
import { useBatchRunner } from '../hooks/useBatchRunner';
import { AiRunNotice } from './AiRunNotice';
import { HEAD, TableBox, TH } from './DataTable';
import { Button, ProgressBar } from './ui';
import type { ClassOverall, ClassQuestionFigures, ClassThemes, MarkCombine } from '@marker/shared-types';

const TONE = { good: '#16a34a', mid: '#d97706', low: '#dc2626' } as const;

/** One bar per question: the average mark as a share of the marks available. Green from 70%, amber from 40%, red below. */
function QuestionBars({ questions }: { questions: ClassQuestionFigures[] }) {
  const row = 22;
  const left = 70;
  const width = 560;
  return (
    <svg role="img" aria-label="Average mark as a percentage of the marks available, by question" viewBox={`0 0 ${left + width + 50} ${questions.length * row + 6}`} className="w-full max-w-3xl">
      {questions.map((q, i) => (
        <g key={q.question_id} transform={`translate(0 ${i * row + 3})`}>
          <text x={left - 6} y={13} textAnchor="end" fontSize="11" fill="#475569">Q{q.label}</text>
          <rect x={left} y={2} width={width} height={row - 8} rx={2} fill="#eef0f5" />
          <rect x={left} y={2} width={Math.max(0, (width * q.facility_pct) / 100)} height={row - 8} rx={2} fill={TONE[q.tone]}><title>{`Q${q.label}: ${q.average} / ${q.max_marks} on average (${q.facility_pct}%)`}</title></rect>
          <text x={left + width + 6} y={13} fontSize="11" fontWeight="600" fill="#334155">{q.facility_pct}%</text>
        </g>
      ))}
    </svg>
  );
}

/** Scripts by the share of the marks they earned */
function Histogram({ bins }: { bins: { from: number; to: number; count: number }[] }) {
  const peak = Math.max(1, ...bins.map((b) => b.count));
  const w = 44; const h = 120;
  return (
    <svg role="img" aria-label="Number of scripts by percentage of the marks earned" viewBox={`0 0 ${bins.length * w + 10} ${h + 34}`} className="w-full max-w-xl">
      {bins.map((b, i) => {
        const bh = (h * b.count) / peak;
        return (
          <g key={b.from} transform={`translate(${i * w + 5} 0)`}>
            {b.count > 0 && <rect x={3} y={h - bh + 14} width={w - 6} height={bh} fill="#4f46e5" rx={2}><title>{`${b.from}-${b.to}%: ${b.count} script${b.count === 1 ? '' : 's'}`}</title></rect>}
            {b.count > 0 && <text x={w / 2} y={h - bh + 10} textAnchor="middle" fontSize="11" fill="#475569">{b.count}</text>}
            <text x={w / 2} y={h + 28} textAnchor="middle" fontSize="10" fill="#64748b">{b.from}</text>
          </g>
        );
      })}
      <line x1={5} x2={bins.length * w + 5} y1={h + 14} y2={h + 14} stroke="#cbd5e1" />
    </svg>
  );
}

const Bullets = ({ items }: { items: string[] }) => (items.length ? <ul className="list-disc space-y-0.5 pl-5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="text-slate-400">Nothing clear to report.</p>);

/** How the class did on a whole paper: figures and charts from the marks, and strengths and weaknesses written by the AI from its feedback. */
export function ClassFeedbackSummary({ examId }: { examId: string }) {
  const [classValue, setClassValue] = useState('__all__');
  const [combine, setCombine] = useState<MarkCombine | ''>('');
  const scope: ClassScope = {
    combine: combine || undefined,
    classGroup: classValue === '__all__' ? undefined : classValue === '__none__' ? null : classValue,
  };
  const q = useQuery({ queryKey: ['class-feedback', examId, scope], queryFn: () => api.classFeedback(examId, scope) });

  // Themes the AI has written (kept in the browser; nothing is stored on the server)
  const [themes, setThemes] = useState<Record<string, ClassThemes>>({});
  const [overall, setOverall] = useState<ClassOverall | null>(null);
  const [phase, setPhase] = useState<'idle' | 'questions' | 'overall'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runner = useBatchRunner(3);
  const data = q.data?.data;
  const themeList = useMemo(() => Object.entries(themes).map(([question_id, t]) => ({ question_id, ...t })), [themes]);

  function reset() { setThemes({}); setOverall(null); setPhase('idle'); setMessage(null); runner.reset(); }

  function writeThemes() {
    if (!data) return;
    const ids = data.figures.by_question.filter((x) => (data.feedback_counts[x.question_id] ?? 0) > 0).map((x) => x.question_id);
    if (ids.length === 0) { setMessage('The AI has not written any feedback for these answers yet, so there is nothing to summarise. Run AI marking with "Feedback" or "Marks and feedback" first.'); return; }
    setMessage(null); setOverall(null); setThemes({}); setPhase('questions');
    const found: Record<string, ClassThemes> = {};
    runner.start(ids, async (batch) => {
      const r = await api.classThemesStep(examId, batch, scope);
      return r.data.results.map((x) => {
        if (x.ok) { found[x.question_id] = { strengths: x.strengths ?? [], weaknesses: x.weaknesses ?? [] }; setThemes((t) => ({ ...t, [x.question_id]: found[x.question_id] })); }
        return { id: x.question_id, ok: x.ok, error: x.error, code: x.code, retryable: x.retryable, fatal: x.fatal, retryAfter: x.retry_after_seconds };
      });
    });
  }

  // When every question has its themes, ask for the overall picture (once)
  useEffect(() => {
    if (phase !== 'questions' || runner.state.status !== 'done') return;
    setPhase('overall');
    const list = Object.entries(themes).map(([question_id, t]) => ({ question_id, ...t })).filter((t) => t.strengths.length || t.weaknesses.length);
    if (list.length === 0) { setPhase('idle'); setMessage('The feedback showed no clear patterns to summarise.'); return; }
    api.classOverall(examId, list, scope)
      .then((r) => { setOverall(r.data); setPhase('idle'); })
      .catch((e) => { setPhase('idle'); setMessage(`The overall summary could not be written: ${friendlyError(e).message}`); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runner.state.status]);

  async function download() {
    setBusy(true); setMessage(null);
    try {
      const pdf = await api.classReportPdf(examId, scope, themeList.filter((t) => t.strengths.length || t.weaknesses.length), overall);
      saveBlob(new Blob([pdf.bytes as BlobPart], { type: 'application/pdf' }), pdf.filename);
    } catch (e) { setMessage(friendlyError(e).message); } finally { setBusy(false); }
  }

  if (q.isLoading) return <p className="text-sm text-slate-500">Working out the class figures…</p>;
  if (q.error || !data) return <p role="alert" className="text-sm text-red-700">{friendlyError(q.error).message}</p>;
  const f = data.figures;
  const running = runner.state.status === 'running' || runner.state.status === 'paused';
  const withFeedback = f.by_question.filter((x) => (data.feedback_counts[x.question_id] ?? 0) > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 text-xs text-slate-600">
        {data.classes.length > 1 && (
          <label>Class{' '}
            <select value={classValue} onChange={(e) => { setClassValue(e.target.value); reset(); }} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
              <option value="__all__">All classes</option>
              {data.classes.map((c) => <option key={c || '__none__'} value={c || '__none__'}>{c || 'No class'}</option>)}
            </select>
          </label>
        )}
        <label title="How several teachers' marks on one answer become the mark used here">Marks counted as{' '}
          <select value={combine} onChange={(e) => { setCombine(e.target.value as MarkCombine | ''); reset(); }} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
            <option value="">the exam's setting ({data.combine})</option>
            <option value="latest">the newest mark</option><option value="average">the average</option><option value="lead">the lead teacher's</option>
          </select>
        </label>
        <span className="flex-1" />
        <Button variant="primary" disabled={busy || f.scripts === 0} onClick={() => void download()}>{busy ? 'Making…' : 'Download report (PDF)'}</Button>
      </div>

      {f.scripts === 0 ? (
        <p className="text-sm text-slate-600">Nothing has been marked for this selection yet.</p>
      ) : (
        <>
          <p className="text-sm text-slate-700">
            <strong>{f.scripts}</strong> script{f.scripts === 1 ? '' : 's'}, <strong>{f.answers}</strong> marked answers; the class earned <strong>{f.overall_pct}%</strong> of the marks available.
            {f.ai_only_answers > 0 && <span className="text-slate-500"> {f.ai_only_answers} of the marks used are AI suggestions where no teacher has marked yet.</span>}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-green-200 bg-green-50/60 p-3 text-sm">
              <h3 className="mb-1 font-medium text-green-900">Strongest questions</h3>
              {f.strengths.length ? <ul className="space-y-0.5">{f.strengths.map((s) => <li key={s.question_id}><strong>Q{s.label}</strong> <span className="text-slate-600">{s.facility_pct}% ({s.average} / {s.max_marks} on average)</span></li>)}</ul> : <p className="text-slate-500">Not enough questions to rank.</p>}
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm">
              <h3 className="mb-1 font-medium text-red-900">Weakest questions</h3>
              {f.weaknesses.length ? <ul className="space-y-0.5">{f.weaknesses.map((s) => <li key={s.question_id}><strong>Q{s.label}</strong> <span className="text-slate-600">{s.facility_pct}% ({s.average} / {s.max_marks} on average)</span></li>)}</ul> : <p className="text-slate-500">Not enough questions to rank.</p>}
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-700">How each question went</h3>
            <QuestionBars questions={f.by_question} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-medium text-slate-700">Spread of totals <span className="font-normal text-slate-500">(scripts by % of marks earned)</span></h3>
              <Histogram bins={f.histogram} />
            </div>
            {f.by_class.length > 1 && (
              <div>
                <h3 className="mb-1 text-sm font-medium text-slate-700">By class</h3>
                <ul className="space-y-1 text-sm">
                  {f.by_class.map((c) => (
                    <li key={c.label} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-slate-700">{c.label} <span className="text-slate-400">({c.scripts})</span></span>
                      <span className="h-3 rounded" style={{ width: `${Math.max(2, c.average_pct * 2)}px`, background: TONE[c.average_pct >= 70 ? 'good' : c.average_pct >= 40 ? 'mid' : 'low'] }} />
                      <span className="tabular-nums text-slate-600">{c.average_pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* AI-written themes */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4">
            <h3 className="font-medium text-violet-900">Strengths and weaknesses from the AI's feedback</h3>
            <p className="mb-3 text-xs text-slate-600">
              Gemini reads the feedback it wrote on each answer, question by question, and says what the class did well and where marks were lost. Only the feedback text is sent (no names, no images).
              It uses one request for each question with feedback, plus one for the overall picture, and nothing is saved on the server.
              {' '}{withFeedback === 0 ? 'No answers have AI feedback yet: run AI marking with "Feedback" or "Marks and feedback" first.' : `${withFeedback} question${withFeedback === 1 ? ' has' : 's have'} feedback.`}
            </p>
            {!data.ai_configured && <p role="alert" className="mb-2 text-sm text-amber-800">AI isn't set up on this server (no Gemini key).</p>}
            {running && (
              <div className="mb-2 space-y-1">
                <ProgressBar value={runner.state.done + runner.state.failed.length} max={runner.state.total} label="Reading the feedback" />
                <div className="text-sm text-slate-600">{runner.state.done} of {runner.state.total} questions read</div>
                {runner.state.status === 'running' ? <Button onClick={runner.pause}>Pause</Button> : <Button variant="primary" onClick={runner.resume}>Resume</Button>}
              </div>
            )}
            {phase === 'overall' && <p className="mb-2 text-sm text-slate-600" role="status">Writing the overall summary…</p>}
            <AiRunNotice state={runner.state} onResume={runner.resume} onDismiss={runner.reset} />
            {!running && phase !== 'overall' && (
              <Button variant="primary" disabled={!data.ai_configured || withFeedback === 0} onClick={writeThemes}>
                {overall ? 'Write them again' : 'Write strengths and weaknesses'}
              </Button>
            )}
            {message && <p role="status" className="mt-2 text-sm text-slate-700">{message}</p>}

            {overall && (
              <div className="mt-4 grid gap-4 text-sm text-slate-700 md:grid-cols-3">
                <div><h4 className="mb-1 font-medium text-green-800">What the class did well</h4><Bullets items={overall.strengths} /></div>
                <div><h4 className="mb-1 font-medium text-red-800">Where the class lost marks</h4><Bullets items={overall.weaknesses} /></div>
                <div><h4 className="mb-1 font-medium text-indigo-800">Suggested next steps</h4><Bullets items={overall.next_steps} /></div>
                <p className="text-xs text-slate-500 md:col-span-3">Written by an AI from its own feedback comments: please check it against your view of the class before sharing it. "Download report (PDF)" includes it.</p>
              </div>
            )}
          </div>

          <TableBox maxHeight="30rem">
            <table className="w-full text-sm">
              <thead className={HEAD}>
                <tr><th className={TH}>Question</th><th className={TH}>Out of</th><th className={TH}>Answers</th><th className={TH}>Average</th><th className={TH}>% earned</th><th className={TH}>Did well</th><th className={TH}>Lost marks</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {f.by_question.map((x) => (
                  <tr key={x.question_id}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-800">Q{x.label}</td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-500">{x.max_marks}</td>
                    <td className="px-2 py-1.5 tabular-nums">{x.n}</td>
                    <td className="px-2 py-1.5 tabular-nums">{x.average}</td>
                    <td className="px-2 py-1.5 font-medium tabular-nums" style={{ color: TONE[x.tone] }}>{x.facility_pct}%</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{(themes[x.question_id]?.strengths ?? []).join(' ') || <span className="text-slate-300">–</span>}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{(themes[x.question_id]?.weaknesses ?? []).join(' ') || <span className="text-slate-300">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        </>
      )}
    </div>
  );
}

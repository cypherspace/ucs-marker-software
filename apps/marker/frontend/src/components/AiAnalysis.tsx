import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AiComparisonFilters } from '../api';
import { saveBlob } from '../lib/saveFile';
import { friendlyError } from '../lib/errors';
import { HEAD, TableBox, TH } from './DataTable';
import { Button, LinkButton } from './ui';
import type { AiCmpGroup, AiCmpRow, AiCmpStats, AiComparison, MarkCombine } from '@marker/shared-types';

const signed = (n: number | null) => (n === null ? '–' : n > 0 ? `+${n}` : String(n));
const pct = (n: number | null) => (n === null ? '–' : `${n}%`);
const num = (n: number | null) => (n === null ? '–' : String(n));

type View = 'question' | 'script' | 'one' | 'grid' | 'groups' | 'disagree' | 'reasons';
const VIEWS: [View, string][] = [
  ['question', 'By question'], ['script', 'By script total'], ['one', 'One script'], ['grid', 'Agreement grid'],
  ['groups', 'Mark bands, classes, teachers'], ['disagree', 'Disagreements'], ['reasons', 'Reasons'],
];

export function download(csv: string, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" title={hint}>
      <div className="text-lg font-semibold tabular-nums text-slate-800">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export function Reasons({ reasons }: { reasons: { code: string; label: string }[] }) {
  if (!reasons.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <span key={r.code} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">{r.label}</span>
      ))}
    </span>
  );
}

const gapColour = (g: number | null) => (g === null ? 'text-slate-300' : g === 0 ? 'text-green-700' : 'text-amber-700');

function StatsCells({ s }: { s: AiCmpStats }) {
  return (
    <>
      <td className="px-2 py-1.5 tabular-nums">{s.compared}</td>
      <td className="px-2 py-1.5 tabular-nums">{pct(s.exact_pct)}</td>
      <td className="px-2 py-1.5 tabular-nums">{pct(s.within_one_pct)}</td>
      <td className="px-2 py-1.5 tabular-nums">{num(s.mean_abs_gap)}</td>
      <td className="px-2 py-1.5 tabular-nums">{signed(s.bias)}</td>
    </>
  );
}
const StatsHeads = () => (
  <>
    <th className={TH}>Compared</th><th className={TH}>Exactly same</th><th className={TH}>Within 1</th>
    <th className={TH} title="Average size of the gap, ignoring direction">Average gap</th>
    <th className={TH} title="Positive: the AI gives more marks than the teachers on average">AI minus teachers</th>
  </>
);

function GroupTable({ title, groups }: { title: string; groups: AiCmpGroup[] }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-slate-700">{title}</h3>
      {groups.length === 0 ? <p className="text-sm text-slate-500">Nothing to show.</p> : (
        <TableBox maxHeight="14rem">
          <table className="w-full text-sm">
            <thead className={HEAD}><tr><th className={TH}>{title.replace(/^By /, '')}</th><StatsHeads /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => <tr key={g.key}><td className="px-2 py-1.5 font-medium text-slate-700">{g.label}</td><StatsCells s={g} /></tr>)}
            </tbody>
          </table>
        </TableBox>
      )}
    </div>
  );
}

/** Rows of answers with a way to open each one: the answer image, the AI's reasoning and feedback and the teachers' notes */
export function AnswerList({ rows, showScript = true }: { rows: AiCmpRow[]; showScript?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <p className="py-3 text-sm text-slate-500">Nothing to show.</p>;
  return (
    <TableBox maxHeight="36rem">
      <table className="w-full text-sm">
        <thead className={HEAD}>
          <tr>
            {showScript && <th className={TH}>Script</th>}
            <th className={TH}>Question</th><th className={TH}>Teachers</th><th className={TH}>AI</th><th className={TH}>Gap</th>
            <th className={TH}>Why they may differ</th><th className={TH} />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <Fragment key={r.clip_id}>
              <tr>
                {showScript && <td className="whitespace-nowrap px-2 py-1.5">Script {r.student_number}</td>}
                <td className="whitespace-nowrap px-2 py-1.5 font-medium">Q{r.question_label}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.teacher_mark ?? <span className="text-slate-400">not marked</span>}<span className="text-slate-400"> / {r.max_marks}</span></td>
                <td className="px-2 py-1.5 tabular-nums">{r.ai_mark}</td>
                <td className={`px-2 py-1.5 font-medium tabular-nums ${gapColour(r.gap)}`}>{signed(r.gap)}</td>
                <td className="px-2 py-1.5"><Reasons reasons={r.reasons} /></td>
                <td className="px-2 py-1.5 text-right">
                  <button className="whitespace-nowrap text-xs text-indigo-600 hover:underline" onClick={() => setOpen(open === r.clip_id ? null : r.clip_id)}>
                    {open === r.clip_id ? 'Hide' : 'Show answer and reasoning'}
                  </button>
                </td>
              </tr>
              {open === r.clip_id && (
                <tr className="bg-slate-50">
                  <td colSpan={showScript ? 7 : 6} className="px-3 py-3">
                    <div className="flex flex-col gap-4 md:flex-row">
                      <img src={api.clipImageUrl(r.clip_id)} alt={`Answer from script ${r.student_number}, question ${r.question_label}`} className="max-h-64 max-w-full rounded border border-slate-200 md:max-w-md" />
                      <div className="space-y-2 text-sm text-slate-700">
                        {r.teachers.map((t) => (
                          <p key={t.teacher_id ?? t.teacher}>
                            <span className="font-medium">{t.teacher}:</span> {t.marks}
                            {t.typed_differs && <span className="text-amber-700"> (typed; their ticks add up to something else)</span>}
                            {t.notes.map((n, i) => <span key={i} className="block text-slate-600">Note: “{n}”</span>)}
                          </p>
                        ))}
                        {r.ai_reasoning && <p><span className="font-medium">AI reasoning:</span> {r.ai_reasoning}</p>}
                        {r.ai_feedback && <p><span className="font-medium">AI feedback:</span> {r.ai_feedback}</p>}
                        {!r.ai_reasoning && !r.ai_feedback && <p className="text-slate-500">The AI's reasoning is shown for answers where it differs from the teachers.</p>}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </TableBox>
  );
}

/** The summary and analysis of how the AI's marks compare with the teachers', in views you switch between */
export function AiAnalysis({ examId }: { examId: string }) {
  const [view, setView] = useState<View>('question');
  const [combine, setCombine] = useState<MarkCombine | ''>('');
  const [classValue, setClassValue] = useState('__all__');
  const [excludeConflicts, setExcludeConflicts] = useState(false);
  const [minGap, setMinGap] = useState(0);
  const [scriptId, setScriptId] = useState('');
  const [gridQ, setGridQ] = useState('');
  const [direction, setDirection] = useState<'all' | 'ai_higher' | 'ai_lower'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const filters: AiComparisonFilters = {
    combine: combine || undefined,
    classGroup: classValue === '__all__' ? undefined : classValue === '__none__' ? null : classValue,
    excludeConflicts, minGap: minGap || undefined,
  };
  const reportParams = new URLSearchParams({ exam: examId });
  if (filters.combine) reportParams.set('combine', filters.combine);
  if (filters.classGroup === null) reportParams.set('no_class', '1'); else if (filters.classGroup) reportParams.set('class', filters.classGroup);
  if (filters.excludeConflicts) reportParams.set('exclude_conflicts', '1');
  if (filters.minGap) reportParams.set('min_gap', String(filters.minGap));
  const reportQuery = reportParams.toString();
  const q = useQuery({ queryKey: ['ai-comparison', examId, filters], queryFn: () => api.aiComparison(examId, filters) });
  const data: AiComparison | undefined = q.data?.data;

  async function exportCsv(format: 'answers' | 'questions') {
    setBusy(format); setExportError(null);
    try {
      const r = await api.aiComparisonExport(examId, format, filters);
      download(r.data.csv, r.data.filename);
    } catch (e) {
      setExportError(friendlyError(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function scriptPdf(scriptIdToMake: string, kind: 'ai' | 'annotated') {
    setPdfBusy(kind); setExportError(null);
    try {
      const pdf = kind === 'ai' ? await api.aiFeedbackPdf(scriptIdToMake) : await api.annotatedPdf(scriptIdToMake, false, true);
      saveBlob(new Blob([pdf.bytes as BlobPart], { type: 'application/pdf' }), pdf.filename);
    } catch (e) {
      setExportError(friendlyError(e).message);
    } finally {
      setPdfBusy(null);
    }
  }

  if (q.isLoading) return <p className="text-sm text-slate-500">Working out the comparison…</p>;
  if (q.error || !data) return <p role="alert" className="text-sm text-red-700">{friendlyError(q.error).message}</p>;
  const a = data.analysis;
  const rank = a.script_correlation.rank;

  const disagreements = data.rows
    .filter((r) => r.gap !== null && r.gap !== 0 && (direction === 'all' || r.direction === direction))
    .sort((x, y) => Math.abs(y.gap!) - Math.abs(x.gap!));
  const scripts = a.by_script;
  const oneId = scripts.some((s) => s.script_id === scriptId) ? scriptId : (scripts[0]?.script_id ?? '');
  const oneIndex = scripts.findIndex((s) => s.script_id === oneId);
  const gridQuestions = a.by_question.filter((x) => x.grid);
  const grid = gridQuestions.find((x) => x.question_id === gridQ) ?? gridQuestions[0];
  const gridMax = grid ? Math.max(1, ...grid.grid!.flat()) : 1;

  return (
    <div className="space-y-4">
      {/* What counts */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 text-xs text-slate-600">
        {data.classes.length > 1 && (
          <label>Class{' '}
            <select value={classValue} onChange={(e) => setClassValue(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
              <option value="__all__">All classes</option>
              {data.classes.map((c) => <option key={c || '__none__'} value={c || '__none__'}>{c || 'No class'}</option>)}
            </select>
          </label>
        )}
        <label title="How several teachers' marks on one answer become the mark the AI is compared with">Teachers' mark counted as{' '}
          <select value={combine} onChange={(e) => setCombine(e.target.value as MarkCombine | '')} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
            <option value="">the exam's setting ({data.combine})</option>
            <option value="latest">the newest mark</option><option value="average">the average</option><option value="lead">the lead teacher's</option>
          </select>
        </label>
        <label>Only gaps of{' '}
          <select value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
            <option value={0}>any size</option><option value={1}>1 or more</option><option value={2}>2 or more</option><option value={3}>3 or more</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1">
          <input type="checkbox" checked={excludeConflicts} onChange={(e) => setExcludeConflicts(e.target.checked)} /> Leave out answers where teachers disagree
        </label>
        <span className="flex-1" />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => void exportCsv('answers')}>{busy === 'answers' ? 'Preparing…' : 'CSV: every answer'}</Button>
          <Button disabled={busy !== null} onClick={() => void exportCsv('questions')}>{busy === 'questions' ? 'Preparing…' : 'CSV: by question'}</Button>
          <LinkButton to={`/marking/ai/report?${reportQuery}`} target="_blank">Printable report</LinkButton>
        </div>
      </div>
      {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}

      {a.overall.compared === 0 ? (
        <p className="text-sm text-slate-600">
          Nothing to compare for these settings{a.without_teacher_mark > 0 ? `: ${a.without_teacher_mark} answer${a.without_teacher_mark === 1 ? ' has' : 's have'} an AI mark but no teacher has marked ${a.without_teacher_mark === 1 ? 'it' : 'them'} yet` : ''}.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="answers compared" value={String(a.overall.compared)} hint="Answers with both an AI mark and a teacher mark" />
            <Stat label="exactly the same" value={pct(a.overall.exact_pct)} />
            <Stat label="within 1 mark" value={pct(a.overall.within_one_pct)} />
            <Stat label="average gap" value={num(a.overall.mean_abs_gap)} hint="Average size of the gap in marks, ignoring direction" />
            <Stat label="AI minus teachers" value={signed(a.overall.bias)} hint="Positive: the AI gives more marks than the teachers on average" />
            <Stat label="same order of scripts" value={rank === null ? '–' : rank.toFixed(2)} hint="Rank correlation of each script's total: 1 means the AI and the teachers put the scripts in the same order" />
          </div>
          {a.without_teacher_mark > 0 && (
            <p className="text-xs text-slate-500">{a.without_teacher_mark} more answer{a.without_teacher_mark === 1 ? ' has' : 's have'} an AI mark but no teacher mark yet and {a.without_teacher_mark === 1 ? 'is' : 'are'} left out of these figures.</p>
          )}
        </>
      )}

      <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1 border-b border-slate-200">
        {VIEWS.map(([v, label]) => (
          <button
            key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${view === v ? 'border-slate-200 border-b-white bg-white font-medium text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`}
          >{label}</button>
        ))}
      </div>

      {view === 'question' && (
        a.by_question.length === 0 ? <p className="text-sm text-slate-500">No answers.</p> : (
          <TableBox maxHeight="30rem">
            <table className="w-full text-sm">
              <thead className={HEAD}><tr><th className={TH}>Question</th><th className={TH}>Out of</th><StatsHeads /><th className={TH}>Teachers differ</th><th className={TH} title="AI marks with no teacher mark yet">AI only</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {a.by_question.map((x) => (
                  <tr key={x.question_id}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-800">Q{x.label}</td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-500">{x.max_marks}</td>
                    <StatsCells s={x} />
                    <td className="px-2 py-1.5 tabular-nums">{x.teachers_differ || <span className="text-slate-300">–</span>}</td>
                    <td className="px-2 py-1.5 tabular-nums">{x.ai_only || <span className="text-slate-300">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        )
      )}

      {view === 'script' && (
        scripts.length === 0 ? <p className="text-sm text-slate-500">No scripts with both an AI mark and a teacher mark.</p> : (
          <>
            <p className="text-xs text-slate-500">
              Each script's total over the answers that have both marks. Teachers' and AI totals agree on the order of the scripts
              {rank === null ? ' (not enough scripts to tell)' : ` with a rank correlation of ${rank.toFixed(2)}`}
              {a.script_correlation.pearson !== null && `; the totals themselves correlate at ${a.script_correlation.pearson.toFixed(2)}`}.
            </p>
            <TableBox maxHeight="30rem">
              <table className="w-full text-sm">
                <thead className={HEAD}><tr><th className={TH}>Script</th><th className={TH}>Class</th><th className={TH}>Answers</th><th className={TH}>Teachers' total</th><th className={TH}>AI total</th><th className={TH}>Out of</th><th className={TH}>Gap</th><th className={TH} /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {scripts.map((s) => (
                    <tr key={s.script_id}>
                      <td className="px-2 py-1.5 font-medium">Script {s.student_number}</td>
                      <td className="px-2 py-1.5 text-slate-600">{s.class_group ?? <span className="text-slate-400">No class</span>}</td>
                      <td className="px-2 py-1.5 tabular-nums">{s.questions_compared}</td>
                      <td className="px-2 py-1.5 tabular-nums">{s.teacher_total}</td>
                      <td className="px-2 py-1.5 tabular-nums">{s.ai_total}</td>
                      <td className="px-2 py-1.5 tabular-nums text-slate-500">{s.max_total}</td>
                      <td className={`px-2 py-1.5 font-medium tabular-nums ${gapColour(s.gap)}`}>{signed(s.gap)}</td>
                      <td className="px-2 py-1.5 text-right"><button className="text-xs text-indigo-600 hover:underline" onClick={() => { setScriptId(s.script_id); setView('one'); }}>Look at this script</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBox>
          </>
        )
      )}

      {view === 'one' && (
        scripts.length === 0 ? <p className="text-sm text-slate-500">No scripts with both an AI mark and a teacher mark.</p> : (
          <>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <button type="button" aria-label="Previous script" disabled={oneIndex <= 0} onClick={() => setScriptId(scripts[oneIndex - 1].script_id)} className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">‹</button>
              <label>Script{' '}
                <select value={oneId} onChange={(e) => setScriptId(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
                  {scripts.map((s) => <option key={s.script_id} value={s.script_id}>{s.student_number}{s.class_group ? ` (${s.class_group})` : ''}</option>)}
                </select>
              </label>
              <button type="button" aria-label="Next script" disabled={oneIndex < 0 || oneIndex >= scripts.length - 1} onClick={() => setScriptId(scripts[oneIndex + 1].script_id)} className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">›</button>
              {oneIndex >= 0 && <span>Teachers {scripts[oneIndex].teacher_total}, AI {scripts[oneIndex].ai_total} of {scripts[oneIndex].max_total} (over the answers with both marks)</span>}
              <span className="flex-1" />
              <Button disabled={pdfBusy !== null || !oneId} onClick={() => void scriptPdf(oneId, 'ai')} title="Only the AI's feedback and reasoning for this script">
                {pdfBusy === 'ai' ? 'Making…' : 'AI comments (PDF)'}
              </Button>
              <Button disabled={pdfBusy !== null || !oneId} onClick={() => void scriptPdf(oneId, 'annotated')} title="The whole script with the marking drawn on, and the AI's comments at the end">
                {pdfBusy === 'annotated' ? 'Making…' : 'Script with AI comments (PDF)'}
              </Button>
            </div>
            <AnswerList rows={data.rows.filter((r) => r.script_id === oneId)} showScript={false} />
          </>
        )
      )}

      {view === 'grid' && (
        !grid ? <p className="text-sm text-slate-500">No question to show (grids are shown for questions out of 15 or fewer).</p> : (
          <>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <label>Question{' '}
                <select value={grid.question_id} onChange={(e) => setGridQ(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
                  {gridQuestions.map((x) => <option key={x.question_id} value={x.question_id}>Q{x.label}</option>)}
                </select>
              </label>
              <span>Down: the teachers' mark. Across: the AI's mark. The diagonal is agreement.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm" aria-label={`Agreement grid for question ${grid.label}`}>
                <thead>
                  <tr><th className="p-1" /><th className="p-1 text-xs font-normal text-slate-500" colSpan={grid.max_marks + 1}>AI mark</th></tr>
                  <tr><th className="p-1 text-xs font-normal text-slate-500">Teachers' mark</th>{grid.grid![0].map((_, i) => <th key={i} className="w-10 p-1 text-center text-xs text-slate-500">{i}</th>)}</tr>
                </thead>
                <tbody>
                  {grid.grid!.map((rowCounts, t) => (
                    <tr key={t}>
                      <th className="p-1 pr-3 text-right text-xs text-slate-500">{t}</th>
                      {rowCounts.map((n, ai) => (
                        <td
                          key={ai}
                          title={`Teachers ${t}, AI ${ai}: ${n} answer${n === 1 ? '' : 's'}`}
                          className={`h-9 w-10 border border-white text-center tabular-nums ${t === ai ? 'ring-1 ring-inset ring-green-300' : ''}`}
                          style={{ background: n ? `rgba(79, 70, 229, ${0.12 + 0.6 * (n / gridMax)})` : undefined, color: n / gridMax > 0.5 ? 'white' : undefined }}
                        >{n || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {view === 'groups' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <GroupTable title="By mark band" groups={a.by_band} />
          <GroupTable title="By class" groups={a.by_class} />
          <GroupTable title="By teacher" groups={a.by_teacher} />
          <p className="text-xs text-slate-500 lg:col-span-3">
            A band is the teachers' mark as a share of the marks for the question (up to a third, up to two thirds, above). A positive "AI minus teachers" means the AI is more generous
            there. "By teacher" compares the AI with each teacher's own marks.
          </p>
        </div>
      )}

      {view === 'disagree' && (
        <>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span>{disagreements.length} answer{disagreements.length === 1 ? '' : 's'} where they differ, biggest gap first.</span>
            <label>Show{' '}
              <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} className="rounded border border-slate-300 px-1.5 py-1 text-sm">
                <option value="all">all</option><option value="ai_higher">AI gave more</option><option value="ai_lower">AI gave fewer</option>
              </select>
            </label>
          </div>
          <AnswerList rows={disagreements} />
        </>
      )}

      {view === 'reasons' && (
        a.reasons.length === 0 ? <p className="text-sm text-slate-500">No disagreements to explain.</p> : (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              These come from what is already recorded about each answer (the marks, the ticks and notes, the AI's marks); nothing is guessed by another AI.
              An answer can have several. Open "Disagreements" to see each one with the AI's own reasoning.
            </p>
            <ul className="space-y-1">
              {a.reasons.map((r) => {
                const max = a.reasons[0].count;
                return (
                  <li key={r.code} className="flex items-center gap-3 text-sm">
                    <span className="w-80 shrink-0 text-slate-700">{r.label}</span>
                    <span className="h-2.5 rounded bg-indigo-400" style={{ width: `${Math.max(4, (r.count / max) * 240)}px` }} aria-hidden />
                    <span className="tabular-nums text-slate-600">{r.count}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}
    </div>
  );
}

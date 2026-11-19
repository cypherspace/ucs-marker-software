import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, type AiComparisonFilters } from '../api';
import { friendlyError } from '../lib/errors';
import { Button } from '../components/ui';
import type { AiCmpGroup, AiCmpStats, MarkCombine } from '@marker/shared-types';

const signed = (n: number | null) => (n === null ? '–' : n > 0 ? `+${n}` : String(n));
const pct = (n: number | null) => (n === null ? '–' : `${n}%`);
const num = (n: number | null) => (n === null ? '–' : String(n));

function Row({ s }: { s: AiCmpStats }) {
  return (
    <>
      <td className="px-2 py-1 tabular-nums">{s.compared}</td><td className="px-2 py-1 tabular-nums">{pct(s.exact_pct)}</td>
      <td className="px-2 py-1 tabular-nums">{pct(s.within_one_pct)}</td><td className="px-2 py-1 tabular-nums">{num(s.mean_abs_gap)}</td>
      <td className="px-2 py-1 tabular-nums">{signed(s.bias)}</td>
    </>
  );
}
const Heads = ({ first }: { first: string }) => (
  <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
    <th className="px-2 py-1">{first}</th><th className="px-2 py-1">Compared</th><th className="px-2 py-1">Same</th><th className="px-2 py-1">Within 1</th>
    <th className="px-2 py-1">Avg gap</th><th className="px-2 py-1">AI minus teachers</th>
  </tr>
);

function Groups({ title, groups }: { title: string; groups: AiCmpGroup[] }) {
  if (!groups.length) return null;
  return (
    <section className="break-inside-avoid">
      <h3 className="mb-1 text-sm font-semibold text-slate-800">{title}</h3>
      <table className="w-full text-sm"><thead><Heads first={title.replace(/^By /, '')} /></thead>
        <tbody>{groups.map((g) => <tr key={g.key} className="border-b border-slate-100"><td className="px-2 py-1 font-medium">{g.label}</td><Row s={g} /></tr>)}</tbody>
      </table>
    </section>
  );
}

/** A report of how the AI's marks compare with the teachers', laid out to print or save as a PDF (lead teacher / admin). */
export function AiReport() {
  const [search] = useSearchParams();
  const examId = search.get('exam') ?? '';
  const filters: AiComparisonFilters = {
    combine: (search.get('combine') as MarkCombine | null) ?? undefined,
    classGroup: search.get('no_class') ? null : search.get('class') ?? undefined,
    excludeConflicts: search.get('exclude_conflicts') === '1',
    minGap: Number(search.get('min_gap') ?? 0) || undefined,
  };
  const examQ = useQuery({ queryKey: ['exam', examId], queryFn: () => api.getExam(examId), enabled: Boolean(examId) });
  const q = useQuery({ queryKey: ['ai-comparison', examId, filters], queryFn: () => api.aiComparison(examId, filters), enabled: Boolean(examId) });

  if (!examId) return <div className="p-6 text-red-700" role="alert">No exam chosen.</div>;
  if (q.isLoading || examQ.isLoading) return <div className="p-6 text-slate-500">Working out the report…</div>;
  if (q.error || !q.data) return <div className="p-6 text-red-700" role="alert">{friendlyError(q.error).message}</div>;
  const d = q.data.data;
  const a = d.analysis;
  const big = d.rows.filter((r) => r.gap !== null && r.gap !== 0).sort((x, y) => Math.abs(y.gap!) - Math.abs(x.gap!)).slice(0, 25);
  const scope = [
    filters.classGroup === null ? 'scripts with no class' : filters.classGroup ? `class ${filters.classGroup}` : 'all classes',
    `teachers' mark counted as ${d.combine === 'latest' ? 'the newest mark' : d.combine === 'average' ? 'the average' : "the lead teacher's mark"}`,
    filters.excludeConflicts ? 'answers where teachers disagree left out' : null,
    filters.minGap ? `only gaps of ${filters.minGap} or more` : null,
  ].filter(Boolean).join('; ');

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6 print:max-w-none print:p-0">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-slate-900">AI marking compared with the teachers</h1>
          <p className="text-slate-600">{examQ.data?.data.name} · {new Date().toLocaleDateString()}</p>
          <p className="text-xs text-slate-500">Covers {scope}.</p>
        </div>
        <Button variant="primary" className="print:hidden" onClick={() => window.print()}>Print or save as PDF</Button>
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Summary</h2>
        {a.overall.compared === 0 ? <p className="text-sm text-slate-600">Nothing to compare for these settings.</p> : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            <li><strong>{a.overall.compared}</strong> answers have both an AI mark and a teacher mark.</li>
            <li>The AI gave exactly the same mark on <strong>{pct(a.overall.exact_pct)}</strong>, and was within 1 mark on <strong>{pct(a.overall.within_one_pct)}</strong>. The average gap is <strong>{num(a.overall.mean_abs_gap)}</strong> marks.</li>
            <li>On average the AI gives <strong>{signed(a.overall.bias)}</strong> marks compared with the teachers (positive means more generous).</li>
            {a.script_correlation.rank !== null && <li>Across {a.script_correlation.scripts} scripts, the AI and the teachers put the scripts in a similar order (rank correlation <strong>{a.script_correlation.rank.toFixed(2)}</strong>; 1 means the same order).</li>}
            {a.without_teacher_mark > 0 && <li>{a.without_teacher_mark} more answer{a.without_teacher_mark === 1 ? ' has' : 's have'} an AI mark but no teacher mark yet and {a.without_teacher_mark === 1 ? 'is' : 'are'} left out.</li>}
          </ul>
        )}
      </section>

      {a.by_question.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-1 text-lg font-semibold">By question</h2>
          <table className="w-full text-sm"><thead><Heads first="Question" /></thead>
            <tbody>{a.by_question.map((x) => <tr key={x.question_id} className="border-b border-slate-100"><td className="px-2 py-1 font-medium">Q{x.label} <span className="text-xs font-normal text-slate-400">/{x.max_marks}</span></td><Row s={x} /></tr>)}</tbody>
          </table>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-1">
        <Groups title="By mark band" groups={a.by_band} />
        <Groups title="By class" groups={a.by_class} />
        <Groups title="By teacher" groups={a.by_teacher} />
      </div>

      {a.reasons.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-1 text-lg font-semibold">Why they differ</h2>
          <p className="mb-1 text-xs text-slate-500">Drawn from what is recorded about each answer (marks, ticks, notes). An answer can have several.</p>
          <ul className="text-sm text-slate-700">{a.reasons.map((r) => <li key={r.code} className="flex justify-between border-b border-slate-100 py-0.5"><span>{r.label}</span><span className="tabular-nums">{r.count}</span></li>)}</ul>
        </section>
      )}

      {big.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">The biggest disagreements</h2>
          <p className="mb-2 text-xs text-slate-500">The {big.length} answers where the AI and the teachers are furthest apart, with the AI's own reasoning. Script numbers only; no names.</p>
          <ul className="space-y-3">
            {big.map((r) => (
              <li key={r.clip_id} className="break-inside-avoid rounded border border-slate-200 p-2 text-sm">
                <div className="flex flex-wrap gap-x-4 font-medium"><span>Script {r.student_number}</span><span>Q{r.question_label}</span><span>Teachers {r.teacher_mark}/{r.max_marks}</span><span>AI {r.ai_mark}</span><span>Gap {signed(r.gap)}</span></div>
                <div className="my-1 flex flex-wrap gap-1">{r.reasons.map((x) => <span key={x.code} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">{x.label}</span>)}</div>
                {r.teachers.flatMap((t) => t.notes).map((n, i) => <p key={i} className="text-slate-600">Teacher note: “{n}”</p>)}
                {r.ai_reasoning && <p className="text-slate-700"><span className="font-medium">AI reasoning:</span> {r.ai_reasoning}</p>}
                {r.ai_feedback && <p className="text-slate-700"><span className="font-medium">AI feedback:</span> {r.ai_feedback}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { AnnotatedExport } from '../components/AnnotatedExport';
import { Button, Card } from '../components/ui';
import { saveBlob } from '../lib/saveFile';
import { HEAD, TableBox } from '../components/DataTable';
import type { Exam, MarkCombine } from '@marker/shared-types';
import { COMBINES, COMBINE_LABELS } from '../lib/markCombine';
import { questionLabel } from '../lib/questionLabel';

// undefined = every class; null = scripts with no class; a string = that class
type ClassChoice = string | null | undefined;
const ALL = '__all__';
const NONE = '__none__';
const toValue = (c: ClassChoice) => (c === undefined ? ALL : c === null ? NONE : c);
const fromValue = (v: string): ClassChoice => (v === ALL ? undefined : v === NONE ? null : v);

function download(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The marks for an exam: how each question went, and every script's marks, for the classes you may see. */
export function ExamResults() {
  const { id } = useParams<{ id: string }>();
  const { exam, isLead } = useOutletContext<{ exam: Exam; isLead: boolean }>();
  // undefined = the exam's own setting; anything else is just a different way of looking at the same marks
  const [combine, setCombine] = useState<MarkCombine | undefined>(undefined);
  const [cls, setCls] = useState<ClassChoice>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const [pdfNames, setPdfNames] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  // Click a column heading to sort by it; click again to reverse
  const [sortKey, setSortKey] = useState<string>('student');
  const [sortDesc, setSortDesc] = useState(false);
  const sortBy = (key: string) => { if (key === sortKey) setSortDesc((d) => !d); else { setSortKey(key); setSortDesc(key !== 'student'); } };

  async function downloadPdf(scriptId: string) {
    setPdfBusy(scriptId); setMsg(null);
    try {
      const pdf = await api.annotatedPdf(scriptId, pdfNames);
      saveBlob(new Blob([pdf.bytes as BlobPart], { type: 'application/pdf' }), pdf.filename);
    } catch (e) { setMsg((e as Error).message); } finally { setPdfBusy(null); }
  }

  const resultsQ = useQuery({ queryKey: ['results', id, toValue(cls), combine ?? 'exam'], queryFn: () => api.getResults(id!, cls, combine), placeholderData: (prev) => prev });

  // What the CSV looks like: one row per script like the table below (the default), or one row per answer for pivot tables
  const [format, setFormat] = useState<'overview' | 'detailed'>('overview');
  const [withNames, setWithNames] = useState(false);
  const [perTeacher, setPerTeacher] = useState(false);

  const exportMut = useMutation({
    mutationFn: ({ names, perTeacher: every, format: fmt }: { names: boolean; perTeacher: boolean; format: 'overview' | 'detailed' }) =>
      api.exportResults(id!, { names, classGroup: cls, combine, perTeacher: every, format: fmt }),
    onSuccess: (res, { names }) => {
      if (res.data.driveUrl) {
        setMsg('Exported to Google Drive.');
        window.open(res.data.driveUrl, '_blank', 'noopener');
      } else if (res.data.csv) {
        download(res.data.csv, res.data.filename ?? `results${names ? '-named' : ''}.csv`);
        setMsg('CSV downloaded.');
      }
    },
    onError: (e) => setMsg((e as Error).message),
  });

  if (resultsQ.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (resultsQ.error || !resultsQ.data) return <div className="text-red-600" role="alert">Couldn't load the results.</div>;
  const r = resultsQ.data.data;
  const statsFor = new Map(r.stats.map((s) => [s.question_id, s]));
  const showClassColumn = r.classes.some((c) => c.name !== null);
  const valueOf = (row: (typeof r.rows)[number]): number | string => {
    if (sortKey === 'student') return row.student_number;
    if (sortKey === 'total') return row.possible > 0 ? row.total / row.possible : -1;
    return row.cells[sortKey]?.marks ?? -1;
  };
  const sortedRows = [...r.rows].sort((a, b) => {
    const x = valueOf(a), y = valueOf(b);
    const c = typeof x === 'string' ? x.localeCompare(String(y), undefined, { numeric: true }) : Number(x) - Number(y);
    return sortDesc ? -c : c;
  });
  const maxOf = new Map(r.questions.map((q) => [q.id, q.max_marks]));
  // A soft tint by how much of the marks were earned, so strong and weak answers stand out down a column
  const tint = (marks: number | null, max: number | undefined) => {
    if (marks === null || !max) return undefined;
    const f = Math.max(0, Math.min(1, marks / max));
    return `hsl(${Math.round(f * 120)} 65% ${f === 1 ? 94 : 92}%)`;
  };
  const sortMark = (key: string) => (sortKey === key ? (sortDesc ? ' ↓' : ' ↑') : '');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <p className="max-w-xl text-sm text-slate-500">
          {r.scope === 'all'
            ? 'Every script and question in this exam.'
            : 'The scripts you uploaded, and the questions you were asked to mark.'}
        </p>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          {isLead && (
            <label className="text-sm text-slate-600">
              Marks that count
              <select
                value={combine ?? ''}
                onChange={(e) => setCombine((e.target.value || undefined) as MarkCombine | undefined)}
                className="ml-2 min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:min-h-9"
                title="How several teachers' marks for one script are combined. Changing it here only changes this view and the export; the exam's own setting is on the Setup tab."
              >
                <option value="">Exam setting ({COMBINE_LABELS[exam.mark_combine ?? 'latest']})</option>
                {COMBINES.map((c) => <option key={c} value={c}>{COMBINE_LABELS[c]}</option>)}
              </select>
            </label>
          )}
          {showClassColumn && (
            <label className="text-sm text-slate-600">
              Class
              <select
                value={toValue(cls)}
                onChange={(e) => setCls(fromValue(e.target.value))}
                className="ml-2 min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:min-h-9"
              >
                <option value={ALL}>All classes</option>
                {r.classes.map((c) => (
                  <option key={c.name ?? NONE} value={c.name ?? NONE}>{c.name ?? 'No class'} ({c.scripts})</option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <legend className="px-1 text-xs font-medium text-slate-500">Export to CSV</legend>
            <label className="text-sm text-slate-600">
              Layout
              <select
                value={perTeacher ? 'detailed' : format}
                disabled={perTeacher}
                onChange={(e) => setFormat(e.target.value as 'overview' | 'detailed')}
                className="ml-2 min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:min-h-9"
                title="One row per script, with a column for each question and the total (like the table below), or one row per answer for pivot tables."
              >
                <option value="overview">One row per script (like the table)</option>
                <option value="detailed">One row per answer (for pivot tables)</option>
              </select>
            </label>
            {isLead && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600" title="Adds student names via a database join. Names never leave the platform otherwise, and the export is logged.">
                <input type="checkbox" checked={withNames} onChange={(e) => setWithNames(e.target.checked)} /> Student names
              </label>
            )}
            {isLead && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600" title="One row per answer with a column for each teacher's own mark, their mean, and whether they differ. The export is logged.">
                <input type="checkbox" checked={perTeacher} onChange={(e) => setPerTeacher(e.target.checked)} /> Every teacher&apos;s marks
              </label>
            )}
            <Button
              variant="primary"
              disabled={exportMut.isPending || r.rows.length === 0}
              onClick={() => { setMsg(null); exportMut.mutate({ names: withNames, perTeacher, format }); }}
            >
              {exportMut.isPending ? 'Exporting…' : cls === undefined ? 'Export results' : 'Export this class'}
            </Button>
          </fieldset>
        </div>
      </div>
      {msg && <p role="status" className="mb-4 text-sm text-slate-600">{msg}</p>}
      {isLead && r.rows.length > 0 && <AnnotatedExport examId={id!} classGroup={cls} names={pdfNames} onNames={setPdfNames} />}

      {r.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No marked scripts to show yet. Results appear here once scripts have been uploaded and clipped.
        </div>
      ) : (
        <div className="space-y-6">
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="border-b border-slate-200 px-4 py-3 text-left font-medium text-slate-800">How each question went</caption>
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Question</th>
                  <th className="px-4 py-2">Marked</th>
                  <th className="px-4 py-2">Average</th>
                  <th className="px-4 py-2">Lowest</th>
                  <th className="px-4 py-2">Highest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.questions.map((q) => {
                  const s = statsFor.get(q.id);
                  return (
                    <tr key={q.id}>
                      <td className="px-4 py-2 font-medium text-slate-800">
                        Q{questionLabel(q.question_number)} <span className="font-normal text-slate-500">{q.marking_mode === 'comparative' ? 'ranked' : `out of ${q.max_marks}`}</span>
                      </td>
                      <td className="px-4 py-2">{s?.marked ?? 0} of {s?.scripts ?? 0}</td>
                      <td className="px-4 py-2">{s?.mean ?? '–'}</td>
                      <td className="px-4 py-2">{s?.min ?? '–'}</td>
                      <td className="px-4 py-2">{s?.max ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card>
            <div className="border-b border-slate-200 px-4 py-3 font-medium text-slate-800">
              Marks by script <span className="font-normal text-slate-500">({r.rows.length})</span>
              <span className="ml-3 text-xs font-normal text-slate-500">Click a heading to sort. Shading shows how much of the marks were earned.</span>
            </div>
            <TableBox maxHeight="70vh" className="rounded-none border-0">
              <table className="w-full min-w-max text-left text-sm">
                <thead className={`${HEAD} text-xs uppercase tracking-wide text-slate-500`}>
                  <tr>
                    <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2"><button className="font-medium uppercase hover:text-slate-800" onClick={() => sortBy('student')}>Student{sortMark('student')}</button></th>
                    {showClassColumn && <th className="px-4 py-2">Class</th>}
                    {r.questions.map((q) => (
                      <th key={q.id} className="px-3 py-2 text-center" title={`Out of ${q.max_marks}`}>
                        <button className="font-medium uppercase hover:text-slate-800" onClick={() => sortBy(q.id)}>Q{questionLabel(q.question_number)}{sortMark(q.id)}</button>
                        <div className="text-[10px] font-normal normal-case text-slate-400">/{q.max_marks}</div>
                      </th>
                    ))}
                    <th className="px-4 py-2 text-center"><button className="font-medium uppercase hover:text-slate-800" onClick={() => sortBy('total')}>Total{sortMark('total')}</button></th>
                    {isLead && <th className="px-4 py-2"><span className="sr-only">Annotated PDF</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRows.map((row) => (
                    <tr key={row.script_id}>
                      <td className="sticky left-0 bg-white px-4 py-2 font-medium text-slate-800">{row.student_number}</td>
                      {showClassColumn && <td className="px-4 py-2 text-slate-600">{row.class_group ?? '–'}</td>}
                      {r.questions.map((q) => {
                        const cell = row.cells[q.id];
                        return (
                          <td key={q.id} className="px-3 py-2 text-center tabular-nums" style={{ backgroundColor: cell && cell.source !== 'ai' ? tint(cell.marks, maxOf.get(q.id)) : undefined }}>
                            {!cell ? <span className="text-slate-300" title="Not one of your questions">·</span>
                              : cell.marks === null ? <span className="text-slate-400">–</span>
                              : cell.source === 'ai' ? <span className="italic text-violet-700" title="Marked by the AI only">{cell.marks}</span>
                              : cell.marks}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-center font-medium tabular-nums">{row.possible > 0 ? `${row.total} / ${row.possible}` : '–'}</td>
                      {isLead && (
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            disabled={pdfBusy !== null}
                            onClick={() => void downloadPdf(row.script_id)}
                            title="Download this script as a PDF with the marking drawn on"
                            className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                          >
                            {pdfBusy === row.script_id ? 'Making…' : 'PDF'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBox>
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              A teacher's mark is shown where there is one; <span className="italic text-violet-700">italic</span> marks are the AI's, where no teacher has marked yet.
              Totals add up the answers marked so far.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

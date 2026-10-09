import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { Button, Card } from '../components/ui';
import type { Exam } from '@marker/shared-types';

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
  const { isLead } = useOutletContext<{ exam: Exam; isLead: boolean }>();
  const [cls, setCls] = useState<ClassChoice>(undefined);
  const [msg, setMsg] = useState<string | null>(null);

  const resultsQ = useQuery({ queryKey: ['results', id, toValue(cls)], queryFn: () => api.getResults(id!, cls), placeholderData: (prev) => prev });

  const exportMut = useMutation({
    mutationFn: (names: boolean) => api.exportResults(id!, { names, classGroup: cls }),
    onSuccess: (res, names) => {
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <p className="max-w-xl text-sm text-slate-500">
          {r.scope === 'all'
            ? 'Every script and question in this exam.'
            : 'The scripts you uploaded, and the questions you were asked to mark.'}
        </p>
        <div className="ml-auto flex flex-wrap items-end gap-2">
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
          <Button variant="primary" disabled={exportMut.isPending || r.rows.length === 0} onClick={() => { setMsg(null); exportMut.mutate(false); }}>
            {exportMut.isPending ? 'Exporting…' : cls === undefined ? 'Export results' : 'Export this class'}
          </Button>
          {isLead && (
            <Button
              disabled={exportMut.isPending || r.rows.length === 0}
              onClick={() => { setMsg(null); exportMut.mutate(true); }}
              title="Adds student names via a database join. Names never leave the platform otherwise."
            >
              Export with names
            </Button>
          )}
        </div>
      </div>
      {msg && <p role="status" className="mb-4 text-sm text-slate-600">{msg}</p>}

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
                        Q{q.question_number} <span className="font-normal text-slate-500">{q.marking_mode === 'comparative' ? 'ranked' : `out of ${q.max_marks}`}</span>
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

          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="border-b border-slate-200 px-4 py-3 text-left font-medium text-slate-800">
                Marks by script <span className="font-normal text-slate-500">({r.rows.length})</span>
              </caption>
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Student</th>
                  {showClassColumn && <th className="px-4 py-2">Class</th>}
                  {r.questions.map((q) => <th key={q.id} className="px-3 py-2 text-center">Q{q.question_number}</th>)}
                  <th className="px-4 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.rows.map((row) => (
                  <tr key={row.script_id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{row.student_number}</td>
                    {showClassColumn && <td className="px-4 py-2 text-slate-600">{row.class_group ?? '–'}</td>}
                    {r.questions.map((q) => {
                      const cell = row.cells[q.id];
                      return (
                        <td key={q.id} className="px-3 py-2 text-center tabular-nums">
                          {!cell ? <span className="text-slate-300" title="Not one of your questions">·</span>
                            : cell.marks === null ? <span className="text-slate-400">–</span>
                            : cell.source === 'ai' ? <span className="italic text-violet-700" title="Marked by the AI only">{cell.marks}</span>
                            : cell.marks}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-center font-medium tabular-nums">{row.possible > 0 ? `${row.total} / ${row.possible}` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

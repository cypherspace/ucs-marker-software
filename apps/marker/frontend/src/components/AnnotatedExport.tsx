import { useRef, useState } from 'react';
import { Zip, ZipPassThrough } from 'fflate';
import { api } from '../api';
import { Button } from './ui';
import { saveBlob } from '../lib/saveFile';

// "Download every script" as a zip of annotated PDFs, fetched one at a time (a whole class is too much for one request).
// Lead teacher or admin only. `classGroup`: undefined = every script, null = scripts with no class, a string = that class.
export function AnnotatedExport({ examId, classGroup, names, onNames }: {
  examId: string; classGroup: string | null | undefined; names: boolean; onNames: (v: boolean) => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cancel = useRef(false);

  async function run() {
    setMessage(null);
    cancel.current = false;
    try {
      const plan = (await api.annotatedScripts(examId)).data;
      const scripts = plan.scripts.filter((s) => s.clips > 0
        && (classGroup === undefined || (classGroup === null ? s.class_group === null : s.class_group === classGroup)));
      if (scripts.length === 0) { setMessage('There are no clipped scripts to export.'); return; }

      const parts: Uint8Array[] = [];
      const zip = new Zip((err, chunk) => { if (!err) parts.push(chunk); });
      const failed: string[] = [];
      let done = 0;
      setProgress({ done, total: scripts.length });
      for (const s of scripts) {
        if (cancel.current) break;
        try {
          const pdf = await api.annotatedPdf(s.id, names);
          const entry = new ZipPassThrough(pdf.filename); // PDFs are already compressed
          zip.add(entry);
          entry.push(pdf.bytes, true);
        } catch (e) {
          failed.push(`${s.student_number}: ${(e as Error).message}`);
        }
        setProgress({ done: ++done, total: scripts.length });
      }
      zip.end();
      if (cancel.current) { setMessage('Cancelled.'); return; }
      if (failed.length === scripts.length) { setMessage(`No script could be exported. ${failed[0]}`); return; }
      const label = `${plan.exam_name.replace(/[^\w .-]+/g, '').trim() || 'Exam'} - annotated scripts`;
      saveBlob(new Blob(parts as BlobPart[], { type: 'application/zip' }), `${label}.zip`);
      setMessage(failed.length
        ? `Downloaded ${scripts.length - failed.length} of ${scripts.length}. Could not make: ${failed.join('; ')}`
        : `Downloaded ${scripts.length} script${scripts.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-800">Annotated scripts</div>
          <p className="text-xs text-slate-500">
            The whole script as a PDF with each teacher's ticks, notes and marks drawn on, plus a summary page. Use "PDF" on a row for one script.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={names} onChange={(e) => onNames(e.target.checked)} disabled={progress !== null} />
          Include student names
        </label>
        {progress ? (
          <>
            <span className="text-sm text-slate-600" role="status">Making {progress.done} of {progress.total}…</span>
            <Button onClick={() => { cancel.current = true; }}>Cancel</Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => void run()}>Download all (zip)</Button>
        )}
      </div>
      {!names && <p className="mt-2 text-xs text-slate-500">Name zones are removed from the pages. A name written anywhere else on a script stays visible.</p>}
      {names && <p className="mt-2 text-xs text-amber-700">Names are left on the pages and added to the file names. Handle these files as personal data.</p>}
      {message && <p role="status" className="mt-2 text-sm text-slate-600">{message}</p>}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { friendlyError } from '../lib/errors';
import { ConfirmDialog } from './ConfirmDialog';
import { GroupTick, HEAD, TableBox, TH } from './DataTable';
import { Button } from './ui';
import type { StudentScript } from '@marker/shared-types';

/** The scripts uploaded to an exam, with tick boxes to remove some (lead teacher or admin). */
export function ScriptList({ examId, scripts, disabled }: { examId: string; scripts: StudentScript[]; disabled?: boolean }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [classFilter, setClassFilter] = useState('');

  const classes = [...new Set(scripts.map((s) => s.class_group ?? ''))].sort();
  const shown = scripts.filter((s) => !classFilter || (s.class_group ?? '') === (classFilter === '(none)' ? '' : classFilter));
  const pickedHere = shown.filter((s) => picked.has(s.id));
  const ids = [...picked].filter((id) => scripts.some((s) => s.id === id));

  const preview = useQuery({
    queryKey: ['remove-preview', examId, ids.join(',')],
    queryFn: () => api.removeScriptsPreview(examId, ids),
    enabled: confirming && ids.length > 0,
  });
  const remove = useMutation({
    mutationFn: () => api.removeScripts(examId, ids),
    onSuccess: () => {
      setConfirming(false);
      setPicked(new Set());
      for (const key of ['scripts', 'results', 'progress', 'questions', 'queue']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });

  function toggle(id: string, on: boolean) {
    setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  }
  function toggleAll(on: boolean) {
    setPicked((p) => { const n = new Set(p); for (const s of shown) { if (on) n.add(s.id); else n.delete(s.id); } return n; });
  }

  const f = preview.data?.data;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700">{scripts.length} script{scripts.length === 1 ? '' : 's'} uploaded</span>
        {classes.length > 1 && (
          <label className="text-xs text-slate-500">
            Show{' '}
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs">
              <option value="">all classes</option>
              {classes.map((c) => <option key={c || '(none)'} value={c || '(none)'}>{c || 'No class'}</option>)}
            </select>
          </label>
        )}
        <span className="flex-1" />
        <Button variant="danger" disabled={disabled || ids.length === 0} onClick={() => setConfirming(true)}>
          Remove {ids.length > 0 ? ids.length : ''} selected…
        </Button>
      </div>
      <TableBox maxHeight="16rem">
        <table className="w-full text-sm">
          <thead className={HEAD}>
            <tr>
              <th className={`${TH} w-8`}>
                <GroupTick ticked={pickedHere.length} total={shown.length} onChange={toggleAll} label="Select all scripts shown" disabled={disabled} />
              </th>
              <th className={TH}>Student</th>
              <th className={TH}>Class</th>
              <th className={TH}>Uploaded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((s) => (
              <tr key={s.id} className={picked.has(s.id) ? 'bg-red-50/50' : ''}>
                <td className="px-2 py-1.5">
                  <input type="checkbox" aria-label={`Select student ${s.student_number}`} checked={picked.has(s.id)} disabled={disabled}
                    onChange={(e) => toggle(s.id, e.target.checked)} />
                </td>
                <td className="px-2 py-1.5 font-medium text-slate-700">Student {s.student_number}</td>
                <td className="px-2 py-1.5 text-slate-600">{s.class_group ?? <span className="text-slate-400">No class</span>}</td>
                <td className="px-2 py-1.5 text-xs text-slate-400">{new Date(s.uploaded_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableBox>

      {confirming && (
        <ConfirmDialog
          title={`Remove ${ids.length} script${ids.length === 1 ? '' : 's'} from this exam?`}
          confirmLabel="Remove"
          danger
          busy={remove.isPending}
          error={remove.error ? friendlyError(remove.error).message : preview.error ? friendlyError(preview.error).message : null}
          onConfirm={() => remove.mutate()}
          onCancel={() => { if (!remove.isPending) setConfirming(false); }}
        >
          {!f ? <p>Checking what this removes…</p> : (
            <>
              <p>
                {f.scripts.length <= 6
                  ? <>Student {f.scripts.map((x) => x.student_number).join(', ')} will be removed.</>
                  : <>{f.scripts.length} scripts will be removed.</>}
                {' '}This takes with it:
              </p>
              <ul className="list-disc pl-5">
                <li>{f.clips} clipped answer{f.clips === 1 ? '' : 's'}</li>
                <li>{f.human_marks} teacher mark{f.human_marks === 1 ? '' : 's'} and {f.ai_marks} AI mark{f.ai_marks === 1 ? '' : 's'}</li>
                {f.practice_items > 0 && <li>{f.practice_items} student practice item{f.practice_items === 1 ? '' : 's'} (and students' practice marks on them)</li>}
                <li>the script PDFs and clip images: files in Google Drive go to your Drive bin</li>
              </ul>
              <p className="font-medium text-red-700">This cannot be undone from here.</p>
            </>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

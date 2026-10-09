import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ConfirmDialog } from './ConfirmDialog';
import type { Exam } from '@marker/shared-types';

const itemCls = 'block w-full px-4 py-2 text-left text-sm hover:bg-slate-50';

/**
 * "More" menu for an exam you lead: archive or restore it, or delete it for good.
 * Archiving is reversible and keeps everything; deleting needs the exam archived first (or no marks).
 */
export function ExamMenu({ exam, onDeleted }: { exam: Exam; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [dialog, setDialog] = useState<'archive' | 'delete' | null>(null);
  const archived = Boolean(exam.archived_at);
  const close = () => { setDialog(null); if (menuRef.current) menuRef.current.open = false; };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['exams'] });
    void qc.invalidateQueries({ queryKey: ['exam', exam.id] });
    void qc.invalidateQueries({ queryKey: ['home'] });
    void qc.invalidateQueries({ queryKey: ['my-exams'] });
  };

  const archive = useMutation({ mutationFn: () => api.archiveExam(exam.id), onSuccess: () => { refresh(); close(); } });
  const restore = useMutation({ mutationFn: () => api.restoreExam(exam.id), onSuccess: () => { refresh(); close(); } });

  return (
    <>
      <details ref={menuRef} className="relative">
        <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:min-h-9 [&::-webkit-details-marker]:hidden">
          More ▾
        </summary>
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {archived ? (
            <button type="button" className={`${itemCls} text-slate-700`} onClick={() => restore.mutate()} disabled={restore.isPending}>
              {restore.isPending ? 'Restoring…' : 'Restore to the active list'}
            </button>
          ) : (
            <button type="button" className={`${itemCls} text-slate-700`} onClick={() => setDialog('archive')}>Archive</button>
          )}
          <button type="button" className={`${itemCls} text-red-600`} onClick={() => setDialog('delete')}>Delete…</button>
        </div>
      </details>

      {dialog === 'archive' && (
        <ConfirmDialog
          title={`Archive "${exam.name}"?`}
          confirmLabel="Archive"
          busy={archive.isPending}
          error={archive.error ? (archive.error as Error).message : null}
          onConfirm={() => archive.mutate()}
          onCancel={close}
        >
          <p>It moves off your lists and out of marking, and nothing is lost. Results can still be exported, and you can restore it whenever you like.</p>
        </ConfirmDialog>
      )}
      {dialog === 'delete' && <DeleteDialog exam={exam} onClose={close} onDone={() => { refresh(); close(); onDeleted?.(); }} onArchive={() => setDialog('archive')} />}
    </>
  );
}

function DeleteDialog({ exam, onClose, onDone, onArchive }: { exam: Exam; onClose: () => void; onDone: () => void; onArchive: () => void }) {
  const previewQ = useQuery({ queryKey: ['delete-preview', exam.id], queryFn: () => api.deletePreview(exam.id), gcTime: 0 });
  const del = useMutation({ mutationFn: () => api.deleteExam(exam.id, exam.name), onSuccess: onDone });
  const p = previewQ.data?.data;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

  if (!p) {
    return (
      <ConfirmDialog title={`Delete "${exam.name}"?`} confirmLabel="Delete" danger busy={previewQ.isLoading} requireText={exam.name} onConfirm={() => undefined} onCancel={onClose}>
        <p>{previewQ.error ? (previewQ.error as Error).message : 'Checking what would be removed…'}</p>
      </ConfirmDialog>
    );
  }

  if (!p.allowed) {
    return (
      <ConfirmDialog title="Archive this exam first" confirmLabel="Archive instead" onConfirm={onArchive} onCancel={onClose}>
        <p>
          "{exam.name}" has {plural(p.marks, 'mark')} saved, so it can only be deleted once it is archived.
          Archiving keeps everything and takes it off your lists; you can then delete it from the Archived list.
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      title={`Delete "${exam.name}" for good?`}
      confirmLabel="Delete permanently"
      danger
      requireText={exam.name}
      busy={del.isPending}
      error={del.error ? (del.error as Error).message : null}
      onConfirm={() => del.mutate()}
      onCancel={onClose}
    >
      <p>This cannot be undone. It permanently removes:</p>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>{plural(p.scripts, 'uploaded script')} and {plural(p.clips, 'clipped answer')}</li>
        <li>{plural(p.questions, 'question')} and the mark scheme</li>
        <li>{plural(p.marks, 'saved mark')}, and every AI mark, ranking and annotation</li>
      </ul>
      {p.drive_files && <p>Files stored in Google Drive are not removed; they stay in the lead teacher's Drive.</p>}
    </ConfirmDialog>
  );
}

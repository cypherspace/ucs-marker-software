import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { DrivePicker, driveConfigured } from './DrivePicker';
import { UploadQueuePanel } from './UploadQueuePanel';
import { useUploadQueue } from '../hooks/useUploadQueue';
import type { Exam, StudentScript } from '@marker/shared-types';

/**
 * Upload student scripts, filed under a class name. Every PDF in one upload goes into the class typed
 * here, so a class is uploaded in one go and another class by repeating with a different name.
 */
export function ScriptUploader({ exam, scripts }: { exam: Exam | undefined; scripts: StudentScript[] }) {
  const qc = useQueryClient();
  const [classGroup, setClassGroup] = useState('');
  const known = [...new Set(scripts.map((s) => s.class_group).filter((c): c is string => Boolean(c)))].sort();

  // One request per PDF, in name order, so a big or failing file doesn't sink the rest.
  const queue = useUploadQueue((file) => api.uploadScripts(exam!.id, [file], classGroup), {
    onDone: () => { void qc.invalidateQueries({ queryKey: ['scripts', exam!.id] }); void qc.invalidateQueries({ queryKey: ['results', exam!.id] }); },
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-medium text-slate-700">Upload Student Scripts</h2>
      <p className="mb-3 text-xs text-slate-500">
        Upload one PDF per student. Scripts are automatically assigned student numbers (001, 002, …), continuing across classes.
        Student names are <strong>never</strong> stored alongside the scripts. The system uses numbers only until export.
      </p>
      <label className="mb-3 block text-sm font-medium text-slate-700">
        Class
        <input
          list="script-classes"
          value={classGroup}
          onChange={(e) => setClassGroup(e.target.value)}
          maxLength={50}
          disabled={queue.running}
          placeholder="e.g. 10A (optional)"
          className="mt-1 block w-48 rounded-md border border-slate-300 px-3 py-2 text-sm font-normal focus:border-indigo-500 focus:outline-none"
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Every PDF in this upload is filed under this class. Upload another class by changing the name.
        </span>
        <datalist id="script-classes">{known.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      {exam?.use_drive_storage && driveConfigured && (
        <DrivePicker
          onPick={queue.addDrive}
          disabled={queue.running}
          title="Choose script PDFs"
          buttonLabel="Choose from Google Drive"
        />
      )}
      <label className="mb-3 block text-xs text-slate-500">
        {exam?.use_drive_storage && driveConfigured ? 'Or upload from this computer' : 'Choose PDFs from this computer'}
        <input
          type="file"
          accept=".pdf"
          multiple
          disabled={queue.running}
          onChange={(e) => { queue.addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
          className="mt-1 block text-sm text-slate-600"
        />
      </label>
      <p className="mb-3 text-xs text-slate-500">Files are numbered in name order, and each PDF can be up to 32 MB.</p>
      <UploadQueuePanel
        queue={queue}
        buttonLabel={(n) => `Upload ${n} script${n === 1 ? '' : 's'}${classGroup.trim() ? ` to ${classGroup.trim()}` : ''}`}
      />
    </div>
  );
}

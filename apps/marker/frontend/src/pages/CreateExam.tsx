import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function CreateExam() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    subject: '',
    year: '',
    year_group: '',
    exam_board: '',
    exam_series: '',
  });
  const [useDrive, setUseDrive] = useState(true);

  const mutation = useMutation({
    mutationFn: () => api.createExam({
      name: form.name,
      subject: form.subject || undefined,
      year: form.year ? Number(form.year) : undefined,
      year_group: form.year_group || undefined,
      exam_board: form.exam_board || undefined,
      exam_series: form.exam_series || undefined,
      use_drive_storage: useDrive,
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['exams'] });
      navigate(`/exams/${data.data.id}/setup`);
    },
  });

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold text-slate-800">New Exam</h1>
      <form
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Exam name *</label>
          <input
            required
            type="text"
            placeholder="e.g. Year 12 Physics Mock January 2026"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            {...field('name')}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
            <input type="text" placeholder="e.g. Physics" className={inputCls} {...field('subject')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
            <input type="number" placeholder="e.g. 2026" className={inputCls} {...field('year')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Year Group</label>
            <input type="text" placeholder="e.g. Year 12" className={inputCls} {...field('year_group')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Exam Board</label>
            <input type="text" placeholder="e.g. AQA" className={inputCls} {...field('exam_board')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Exam Series</label>
            <input type="text" placeholder="e.g. January 2026" className={inputCls} {...field('exam_series')} />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <input
            type="checkbox"
            checked={useDrive}
            onChange={(e) => setUseDrive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <span className="block text-sm font-medium text-slate-700">Store files in school Google Drive</span>
            <span className="block text-xs text-slate-500">Script PDFs and clip images stay in your Google Workspace — student data never leaves your school account.</span>
          </div>
        </label>

        {mutation.error && (
          <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {(mutation.error as Error).message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating…' : 'Create Exam'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/exams')}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

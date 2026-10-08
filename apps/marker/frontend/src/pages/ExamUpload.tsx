import { useQuery } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { ScriptUploader } from '../components/ScriptUploader';
import type { Exam } from '@marker/shared-types';

/** For a teacher who is not the exam's lead: upload their own class's scripts and see what they have uploaded. */
export function ExamUpload() {
  const { id } = useParams<{ id: string }>();
  const { exam } = useOutletContext<{ exam: Exam; isLead: boolean }>();
  const scriptsQ = useQuery({ queryKey: ['scripts', id], queryFn: () => api.listScripts(id!) });
  const scripts = scriptsQ.data?.data ?? [];

  const byClass = new Map<string, number>();
  for (const s of scripts) byClass.set(s.class_group ?? 'No class', (byClass.get(s.class_group ?? 'No class') ?? 0) + 1);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Upload your class's scripts here. You will see their results in the Results tab, and the lead teacher turns them into questions to mark.
      </p>
      <ScriptUploader exam={exam} scripts={scripts} />
      {scripts.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-3 font-medium text-slate-700">Your uploads</h2>
          <ul className="divide-y divide-slate-100">
            {[...byClass.entries()].map(([name, n]) => (
              <li key={name} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-700">{name}</span>
                <span className="text-slate-500">{n} script{n === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

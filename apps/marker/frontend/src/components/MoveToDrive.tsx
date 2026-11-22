import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BucketFilesExam } from '../api';
import { useBatchRunner } from '../hooks/useBatchRunner';
import { groupErrors } from '../lib/batchRetry';
import { friendlyError } from '../lib/errors';
import { Button, Card, ProgressBar } from './ui';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function describe(c: BucketFilesExam['counts']): string {
  const parts: string[] = [];
  if (c.script_pdf) parts.push(plural(c.script_pdf, 'script'));
  if (c.clip) parts.push(plural(c.clip, 'clip'));
  if (c.converted) parts.push(plural(c.converted, 'converted image'));
  if (c.mark_scheme_pdf) parts.push('the mark scheme');
  if (c.mark_scheme_clip) parts.push(plural(c.mark_scheme_clip, 'mark scheme image'));
  return parts.join(', ');
}

// Moves one exam's old bucket files into the lead teacher's Drive, a few at a time, with a check on every file.
export function MoveToDrive() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'bucket-files'], queryFn: () => api.admin.bucketFiles(), enabled: false });
  const runner = useBatchRunner(3);
  const [examId, setExamId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState(0);
  const { state } = runner;
  const running = state.status === 'running' || state.status === 'paused' || starting;
  const exams = q.data?.data.exams ?? [];
  const current = exams.find((e) => e.exam_id === examId);

  const begin = async (exam: BucketFilesExam) => {
    setStartError(null); setWarnings(0); setExamId(exam.exam_id); setStarting(true);
    try {
      const { data } = await api.admin.startMoveToDrive(exam.exam_id);
      runner.start(data.ids, async (ids) => {
        const res = await api.admin.moveToDriveStep(exam.exam_id, ids);
        setWarnings((w) => w + res.data.results.filter((r) => r.warning).length);
        return res.data.results.map((r) => ({ id: r.id, ok: r.ok, error: r.error, code: r.code, retryable: r.retryable, fatal: r.fatal }));
      });
    } catch (err) {
      setStartError(friendlyError(err).message);
    } finally {
      setStarting(false);
    }
  };

  const handled = state.done + state.failed.length;
  const finished = state.status === 'done';

  return (
    <Card className="max-w-3xl space-y-3 p-4">
      <h2 className="font-medium text-slate-800">Move old files into Google Drive</h2>
      <p className="text-sm text-slate-600">
        Every exam should keep its student work in the lead teacher's Drive. Files made before that may still be in the app's storage bucket.
        This lists them, then moves one exam at a time. Each file is uploaded, checked against Drive's own copy, and only then removed from the bucket.
        A file that cannot be moved is left exactly where it was, and you can run it again. Check first, and try one small exam before the rest.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={q.isFetching || running} onClick={() => void q.refetch()}>{q.isFetching ? 'Checking…' : 'Check'}</Button>
        {q.data && <span role="status" className="text-sm text-slate-600">
          {q.data.data.total === 0 ? 'Nothing is left in the bucket: every file is in Drive.' : `${plural(q.data.data.total, 'file')} still in the bucket, in ${plural(exams.length, 'exam')}.`}
        </span>}
      </div>
      {q.error && <p role="alert" className="text-sm text-red-700">{friendlyError(q.error).message}</p>}

      {exams.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {exams.map((e) => (
            <li key={e.exam_id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{e.name}{e.archived ? ' (archived)' : ''}</div>
                <div className="text-slate-600">{describe(e.counts)}</div>
                <div className="text-xs text-slate-500">
                  Lead teacher: {e.lead_email ?? 'none'}
                  {e.drive_connected ? '' : ' · Drive not connected: they need to sign out and in again before this exam can be moved'}
                </div>
              </div>
              <Button
                variant="primary"
                disabled={running || !e.drive_connected}
                onClick={() => {
                  if (window.confirm(`Move ${plural(e.total, 'file')} of "${e.name}" into ${e.lead_email ?? 'the lead teacher'}'s Google Drive? Each one is checked before the bucket copy is removed.`)) void begin(e);
                }}
              >
                Move {e.total}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {(examId && (running || state.total > 0 || startError)) && (
        <div role="status" className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`min-w-0 flex-1 ${state.status === 'stopped' || startError ? 'text-red-700' : ''}`}>
              {startError ? startError
                : starting ? 'Listing the files…'
                : finished ? `Finished "${current?.name ?? 'exam'}": ${plural(state.done, 'file')} moved${state.failed.length ? `, ${state.failed.length} could not be moved` : ''}${warnings ? `, ${plural(warnings, 'bucket copy', 'bucket copies')} could not be deleted` : ''}.`
                : state.status === 'stopped' ? `Stopped: ${state.fatal ?? 'something went wrong'}`
                : state.status === 'paused' ? `Paused at ${handled} of ${state.total}.`
                : state.waiting ? `Waiting to try again (${state.waiting.reason})…`
                : `Moving file ${Math.min(handled + 1, state.total)} of ${state.total}…`}
            </span>
            {state.status === 'running' && <Button onClick={runner.pause}>Pause</Button>}
            {(state.status === 'paused' || state.status === 'stopped') && <Button variant="primary" onClick={runner.resume}>Resume</Button>}
            {(finished || state.status === 'stopped' || startError) && (
              <Button onClick={() => { runner.reset(); setExamId(null); setStartError(null); void qc.invalidateQueries({ queryKey: ['admin', 'bucket-files'] }); void q.refetch(); }}>Dismiss and check again</Button>
            )}
          </div>
          {state.total > 0 && <ProgressBar value={finished ? state.total : handled} max={state.total} label="Moving files" />}
          {state.failed.length > 0 && (
            <ul className="space-y-0.5 text-xs text-red-700">
              {groupErrors(state.failed).map((g) => <li key={g.error}>{g.count} × {g.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

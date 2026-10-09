import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../api';
import type { ExamQuestion } from '@marker/shared-types';
import { DrivePicker, driveConfigured } from '../components/DrivePicker';
import { UploadQueuePanel } from '../components/UploadQueuePanel';
import { ScriptUploader } from '../components/ScriptUploader';
import { QuestionClipper, type ClipperMode, type ClipperResult } from '../components/QuestionClipper';
import { ClipRunPanel } from '../components/ClipRunPanel';
import { Button } from '../components/ui';
import { useBatchRunner } from '../hooks/useBatchRunner';
import { useUploadQueue } from '../hooks/useUploadQueue';

type SetupTab = 'scripts' | 'questions' | 'assign';

export function ExamSetup() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<SetupTab>('scripts');

  const examQ = useQuery({ queryKey: ['exam', id], queryFn: () => api.getExam(id!) });
  const scriptsQ = useQuery({ queryKey: ['scripts', id], queryFn: () => api.listScripts(id!) });
  const questionsQ = useQuery({ queryKey: ['questions', id], queryFn: () => api.listQuestions(id!) });
  const assignmentsQ = useQuery({ queryKey: ['assignments', id], queryFn: () => api.listAssignments(id!) });
  const usersQ = useQuery({ queryKey: ['teachers'], queryFn: () => api.listTeachers() });
  const progressQ = useQuery({ queryKey: ['progress', id], queryFn: () => api.getProgress(id!) });

  const exam = examQ.data?.data;
  const scripts = scriptsQ.data?.data ?? [];
  const questions = questionsQ.data?.data ?? [];
  const assignments = assignmentsQ.data?.data ?? [];
  const teachers = usersQ.data?.data ?? [];
  const progressByQuestion = new Map((progressQ.data?.data.questions ?? []).map((p) => [p.question_id, p]));

  // ── Script upload ─────────────────────────────────────────────────────────
  // ── Clipping (a few scripts per request, so a whole class can't hit the request time limit) ──
  const clipRunner = useBatchRunner(3);
  const [clipJob, setClipJob] = useState<{ questionIds?: string[]; finishing: boolean; finished: boolean; error: string | null } | null>(null);
  const clipBusy = clipRunner.state.status === 'running' || clipRunner.state.status === 'paused' || Boolean(clipJob?.finishing);

  async function runClipping(questionIds?: string[]) {
    setClipJob({ questionIds, finishing: false, finished: false, error: null });
    try {
      const plan = await api.planClipping(id!, questionIds);
      clipRunner.start(plan.data.script_ids, async (scriptIds) => {
        const r = await api.clipStep(id!, scriptIds, questionIds);
        return r.data.results.map((x) => ({ id: x.id, ok: x.ok, error: x.error }));
      });
    } catch (err) {
      setClipJob({ questionIds, finishing: false, finished: false, error: (err as Error).message });
    }
  }

  useEffect(() => {
    if (clipRunner.state.status !== 'done' || !clipJob || clipJob.finishing || clipJob.finished || clipJob.error) return;
    setClipJob({ ...clipJob, finishing: true });
    api.finishClipping(id!, clipJob.questionIds)
      .then(() => {
        setReclip(null);
        qc.invalidateQueries({ queryKey: ['exam', id] });
        qc.invalidateQueries({ queryKey: ['questions', id] });
        qc.invalidateQueries({ queryKey: ['progress', id] });
        setClipJob((j) => j && { ...j, finishing: false, finished: true });
      })
      .catch((err) => setClipJob((j) => j && { ...j, finishing: false, error: (err as Error).message }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipRunner.state.status, clipJob]);

  function dismissClipJob() {
    clipRunner.reset();
    setClipJob(null);
  }

  // ── Mark scheme upload ────────────────────────────────────────────────────
  const msQueue = useUploadQueue((file) => api.uploadMarkScheme(id!, file), {
    single: true,
    onDone: () => qc.invalidateQueries({ queryKey: ['exam', id] }),
  });

  // ── Question edit / delete ────────────────────────────────────────────────
  const [editingQId, setEditingQId] = useState<string | null>(null);
  const [editNumber, setEditNumber] = useState('');
  const [editMarks, setEditMarks] = useState('');
  const [questionError, setQuestionError] = useState<string | null>(null);

  function refreshQuestions() {
    qc.invalidateQueries({ queryKey: ['questions', id] });
    qc.invalidateQueries({ queryKey: ['progress', id] });
  }

  function startEditing(q: ExamQuestion) {
    setQuestionError(null);
    setEditingQId(q.id);
    setEditNumber(q.question_number);
    setEditMarks(String(q.max_marks));
  }

  const updateQuestionMutation = useMutation({
    mutationFn: (q: ExamQuestion) => api.updateQuestion(id!, q.id, {
      question_number: editNumber.trim(),
      max_marks: Number(editMarks),
    }),
    onSuccess: () => {
      setEditingQId(null);
      setQuestionError(null);
      refreshQuestions();
    },
    onError: (e) => setQuestionError((e as Error).message),
  });

  const modeMutation = useMutation({
    mutationFn: ({ q, comparative }: { q: ExamQuestion; comparative: boolean }) =>
      api.updateQuestion(id!, q.id, { marking_mode: comparative ? 'comparative' : 'marks' }),
    onSuccess: refreshQuestions,
    onError: (e) => setQuestionError((e as Error).message),
  });

  async function deleteQuestion(q: ExamQuestion) {
    setQuestionError(null);
    if (!window.confirm(`Delete question ${q.question_number}?`)) return;
    try {
      await api.deleteQuestion(id!, q.id);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'CONFIRM_REQUIRED') {
        if (!window.confirm(`${e.message}. This cannot be undone. Delete it anyway?`)) return;
        try {
          await api.deleteQuestion(id!, q.id, true);
        } catch (e2) {
          setQuestionError((e2 as Error).message);
          return;
        }
      } else {
        setQuestionError((e as Error).message);
        return;
      }
    }
    refreshQuestions();
    qc.invalidateQueries({ queryKey: ['assignments', id] });
  }

  // ── The clipping window (add questions / edit regions / mark scheme) ──────
  const [clipper, setClipper] = useState<{ mode: ClipperMode; question?: ExamQuestion } | null>(null);
  const [reclip, setReclip] = useState<{ question: ExamQuestion; clips: number; marked: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error'; generate?: boolean } | null>(null);

  async function handleClipperFinish(result: ClipperResult) {
    setClipper(null);
    refreshQuestions();
    qc.invalidateQueries({ queryKey: ['exam', id] });
    if (result.added) {
      setNotice({
        text: `Added ${result.added} question${result.added === 1 ? '' : 's'}. Generate the clips when you have also set up the mark scheme (or now, if there isn't one).`,
        tone: 'ok',
        generate: true,
      });
    } else if (result.msClipped !== undefined) {
      setNotice({ text: `Mark scheme clipped: ${result.msClipped} question${result.msClipped === 1 ? '' : 's'} now have a mark-scheme image for markers.`, tone: 'ok' });
    } else if (result.msError) {
      setNotice({ text: `The mark-scheme regions were saved, but clipping them failed: ${result.msError}. Generate Clips will try again.`, tone: 'error' });
    }
    // If crops were already generated for a question whose regions changed, they are now out of date.
    if (result.changedQuestion) {
      const q = result.changedQuestion;
      try {
        const progress = await api.getProgress(id!);
        const p = progress.data.questions.find((x) => x.question_id === q.id);
        if (p && p.total_clips > 0) setReclip({ question: q, clips: p.total_clips, marked: p.marked_clips });
        else setReclip(null);
      } catch { /* the banner is a convenience only */ }
    }
  }

  // ── Assignments ───────────────────────────────────────────────────────────
  const [assignTeacher, setAssignTeacher] = useState('');
  const [assignQuestion, setAssignQuestion] = useState('');
  const assignMutation = useMutation({
    mutationFn: () => api.createAssignment(id!, { teacher_id: assignTeacher, question_id: assignQuestion }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments', id] }),
  });

  if (examQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">Upload the scripts and mark scheme, mark out the questions and choose who marks what.</p>

      {/* Tabs */}
      <div className="mb-6 flex gap-0 rounded-lg border border-slate-200 bg-white overflow-hidden w-fit">
        {([['scripts', 'Scripts'], ['questions', 'Questions'], ['assign', 'Assign Teachers']] as [SetupTab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium border-r last:border-r-0 border-slate-200 transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Scripts tab */}
      {tab === 'scripts' && (
        <div className="space-y-4">
          <ScriptUploader exam={exam} scripts={scripts} />

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-medium text-slate-700 mb-3">Mark Scheme</h2>
            <p className="text-xs text-slate-500 mb-3">
              Upload the mark scheme PDF. After drawing each question's <strong>mark scheme</strong> region,
              "Generate Clips" produces a per-question MS image that markers can toggle on while marking.
            </p>
            {exam?.mark_scheme_pdf_url && (
              <p className="mb-2 text-sm text-green-700">✓ Mark scheme uploaded</p>
            )}
            {exam?.use_drive_storage && driveConfigured && (
              <DrivePicker
                multiple={false}
                onPick={msQueue.addDrive}
                disabled={msQueue.running}
                title="Choose the mark scheme PDF"
                buttonLabel="Choose from Google Drive"
              />
            )}
            <label className="mb-3 block text-xs text-slate-500">
              {exam?.use_drive_storage && driveConfigured ? 'Or upload from this computer' : 'Choose the mark scheme PDF'}
              <input
                type="file"
                accept=".pdf"
                disabled={msQueue.running}
                onChange={(e) => { msQueue.addFiles(Array.from(e.target.files ?? []).slice(0, 1)); e.target.value = ''; }}
                className="mt-1 block text-sm text-slate-600"
              />
            </label>
            <UploadQueuePanel
              queue={msQueue}
              buttonLabel={() => (exam?.mark_scheme_pdf_url ? 'Replace Mark Scheme' : 'Upload Mark Scheme')}
            />
          </div>

          {scripts.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <h2 className="font-medium text-slate-700">{scripts.length} Scripts Uploaded</h2>
                <button
                  onClick={() => void runClipping()}
                  disabled={clipBusy || questions.length === 0}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  title={questions.length === 0 ? 'Define questions first' : ''}
                >
                  {clipBusy ? 'Clipping…' : 'Generate Clips'}
                </button>
              </div>
              {clipJob && (
                <ClipRunPanel
                  state={clipRunner.state}
                  finishing={clipJob.finishing}
                  finished={clipJob.finished}
                  error={clipJob.error}
                  label={(sid) => `Student ${scripts.find((s) => s.id === sid)?.student_number ?? sid}`}
                  onPause={clipRunner.pause}
                  onResume={clipRunner.resume}
                  onDismiss={dismissClipJob}
                />
              )}
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                {scripts.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-600">Student {s.student_number}{s.class_group ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{s.class_group}</span> : null}</span>
                    <span className="text-xs text-slate-400">{new Date(s.uploaded_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Questions tab */}
      {tab === 'questions' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-medium text-slate-700 mb-1">Questions</h2>
            <p className="text-xs text-slate-500 mb-3">
              <strong>Add questions</strong> opens a script: type the question number and marks, draw the question on
              the page, and carry straight on to the next question. When the questions are in,{' '}
              <strong>Clip the mark scheme</strong> shows the mark scheme itself so you can draw each answer's region on it.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={() => { setNotice(null); setClipper({ mode: 'add' }); }}
                disabled={scripts.length === 0}
                title={scripts.length === 0 ? 'Upload a script first, so there is something to draw on' : 'Add questions by drawing them on a script'}
              >
                Add questions
              </Button>
              <Button
                onClick={() => { setNotice(null); setClipper({ mode: 'mark-scheme' }); }}
                disabled={!exam?.mark_scheme_pdf_url || questions.length === 0}
                title={
                  !exam?.mark_scheme_pdf_url ? 'Upload the mark scheme first (on the Scripts tab)'
                  : questions.length === 0 ? 'Add some questions first'
                  : 'Draw each question\'s region on the mark scheme'
                }
              >
                Clip the mark scheme
              </Button>
              {scripts.length === 0 && <span className="text-xs text-slate-500">Upload a script first (Scripts tab).</span>}
              {scripts.length > 0 && !exam?.mark_scheme_pdf_url && (
                <span className="text-xs text-slate-500">No mark scheme uploaded yet (Scripts tab).</span>
              )}
            </div>
          </div>

          {notice && (
            <div
              role="status"
              className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                notice.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <span className="min-w-0 flex-1">{notice.text}</span>
              {notice.generate && (
                <Button variant="primary" onClick={() => { setNotice(null); void runClipping(); }} disabled={clipBusy}>
                  Generate clips now
                </Button>
              )}
              <button onClick={() => setNotice(null)} className="text-xs underline">Dismiss</button>
            </div>
          )}

          {reclip && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="min-w-0 flex-1">
                Regions for Q{reclip.question.question_number} changed, so its {reclip.clips} generated clip{reclip.clips === 1 ? '' : 's'} use the old crop.
                {reclip.marked > 0 && ` ${reclip.marked} of them ${reclip.marked === 1 ? 'has' : 'have'} already been marked on the old crop.`}
              </span>
              <button
                onClick={() => void runClipping([reclip.question.id])}
                disabled={clipBusy}
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {clipBusy ? 'Re-clipping…' : `Re-clip Q${reclip.question.question_number}`}
              </button>
              <button onClick={() => setReclip(null)} className="rounded-lg px-3 py-1.5 text-amber-800 hover:bg-amber-100">Not now</button>
              {clipJob?.error && <span className="w-full text-red-700">{clipJob.error}</span>}
            </div>
          )}

          {clipJob && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <ClipRunPanel
                state={clipRunner.state}
                finishing={clipJob.finishing}
                finished={clipJob.finished}
                error={clipJob.error}
                label={(sid) => `Student ${scripts.find((s) => s.id === sid)?.student_number ?? sid}`}
                onPause={clipRunner.pause}
                onResume={clipRunner.resume}
                onDismiss={dismissClipJob}
              />
            </div>
          )}

          {questionError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{questionError}</div>
          )}

          {questions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {questions.map((q: ExamQuestion) => {
                const isEditing = editingQId === q.id;
                const clips = progressByQuestion.get(q.id)?.total_clips ?? 0;
                return (
                  <div key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    {isEditing ? (
                      <>
                        <label className="flex items-center gap-1 text-sm text-slate-500">
                          Q
                          <input
                            type="text"
                            value={editNumber}
                            onChange={(e) => setEditNumber(e.target.value)}
                            aria-label="Question number"
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-sm text-slate-500">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={editMarks}
                            onChange={(e) => setEditMarks(e.target.value)}
                            aria-label="Maximum marks"
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                          />
                          marks
                        </label>
                        <div className="ml-auto flex items-center gap-2 text-xs">
                          <button
                            onClick={() => updateQuestionMutation.mutate(q)}
                            disabled={!editNumber.trim() || editMarks === '' || updateQuestionMutation.isPending}
                            className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingQId(null); setQuestionError(null); }}
                            className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="w-12 font-medium text-slate-700">Q{q.question_number}</span>
                        <span className="text-sm text-slate-500">{q.max_marks} marks</span>
                        {clips > 0 && <span className="text-xs text-slate-400">{clips} clip{clips === 1 ? '' : 's'}</span>}
                        <label
                          className="flex items-center gap-1.5 text-xs text-slate-600"
                          title="Rank the scripts by comparing pairs instead of giving marks. Useful for essay questions."
                        >
                          <input
                            type="checkbox"
                            checked={q.marking_mode === 'comparative'}
                            disabled={modeMutation.isPending}
                            onChange={(e) => modeMutation.mutate({ q, comparative: e.target.checked })}
                          />
                          Rank by comparison
                        </label>
                        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                          {(() => {
                            const coords: { page: number }[] = q.clip_coordinates ?? [];
                            if (coords.length === 0) {
                              return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">No regions yet</span>;
                            }
                            const pages = [...new Set(coords.map((r) => r.page))].sort((a, b) => a - b);
                            return (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                                {coords.length} region{coords.length !== 1 ? 's' : ''} · p.{pages.join(', ')}
                              </span>
                            );
                          })()}
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              (q.ms_clip_coordinates ?? []).length > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                            }`}
                            title="Where this question's answer is on the mark scheme"
                          >
                            {(q.ms_clip_coordinates ?? []).length > 0 ? 'Mark scheme ✓' : 'No mark scheme region'}
                          </span>
                          <button
                            onClick={() => { setNotice(null); setClipper({ mode: 'edit', question: q }); }}
                            disabled={scripts.length === 0}
                            title={scripts.length === 0 ? 'Upload a script first to draw on' : 'Draw or edit clip regions'}
                            className="rounded bg-indigo-600 px-2.5 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            {(q.clip_coordinates ?? []).length > 0 ? 'Edit regions' : 'Draw regions'}
                          </button>
                          {exam?.mark_scheme_pdf_url && (
                            <button
                              onClick={() => { setNotice(null); setClipper({ mode: 'mark-scheme', question: q }); }}
                              title="Draw this question's region on the mark scheme"
                              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Mark scheme
                            </button>
                          )}
                          <button
                            onClick={() => startEditing(q)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteQuestion(q)}
                            className="rounded border border-red-200 bg-white px-2.5 py-1.5 font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {questions.length === 0 && (
            <div className="text-sm text-slate-500">No questions defined yet.</div>
          )}
        </div>
      )}

      {/* Assign teachers tab */}
      {tab === 'assign' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-medium text-slate-700 mb-3">Assign Teachers to Questions</h2>
            <div className="flex gap-3 flex-wrap">
              <select
                value={assignTeacher}
                onChange={(e) => setAssignTeacher(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select teacher…</option>
                {teachers.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
              <select
                value={assignQuestion}
                onChange={(e) => setAssignQuestion(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select question…</option>
                {questions.map((q: ExamQuestion) => <option key={q.id} value={q.id}>Q{q.question_number} ({q.max_marks}m)</option>)}
              </select>
              <button
                onClick={() => assignMutation.mutate()}
                disabled={!assignTeacher || !assignQuestion || assignMutation.isPending}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Assign
              </button>
            </div>
          </div>

          {assignments.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {assignments.map((a) => (
                <div key={`${a.teacher_id}-${a.question_id}`} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-700">{a.teacher_email}</span>
                  <span className="text-slate-500">→ Q{a.question_number}</span>
                  <button
                    onClick={() => api.deleteAssignment(id!, { teacher_id: a.teacher_id, question_id: a.question_id }).then(() => qc.invalidateQueries({ queryKey: ['assignments', id] }))}
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {clipper && (
        <QuestionClipper
          key={`${clipper.mode}-${clipper.question?.id ?? 'none'}`}
          examId={id!}
          mode={clipper.mode}
          scripts={scripts}
          questions={questions}
          question={clipper.question}
          markSchemeKey={exam?.mark_scheme_pdf_url ?? undefined}
          onChanged={refreshQuestions}
          onFinish={(result) => void handleClipperFinish(result)}
        />
      )}
    </div>
  );
}

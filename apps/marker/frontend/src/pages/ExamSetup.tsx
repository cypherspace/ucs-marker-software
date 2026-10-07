import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, HttpError } from '../api';
import type { ExamQuestion } from '@marker/shared-types';
import {
  CoordinatePicker,
  toClipRegions,
  toNameZones,
  fromQuestionRegions,
  type DrawnRegion,
  type RegionType,
} from '../components/CoordinatePicker';
import { DrivePicker, driveConfigured } from '../components/DrivePicker';

type SetupTab = 'scripts' | 'questions' | 'assign';

// Compare region sets ignoring their generated ids.
const strip = (rs: DrawnRegion[]) =>
  rs.map(({ type, page, x, y, width, height }) => [type, page, Math.round(x), Math.round(y), Math.round(width), Math.round(height)]);

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
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const uploadMutation = useMutation({
    mutationFn: () => api.uploadScripts(id!, uploadFiles),
    onSuccess: () => {
      setUploadFiles([]);
      qc.invalidateQueries({ queryKey: ['scripts', id] });
    },
  });

  const clipMutation = useMutation({
    mutationFn: () => api.triggerClipping(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam', id] });
      qc.invalidateQueries({ queryKey: ['questions', id] });
    },
  });

  // ── Mark scheme upload ────────────────────────────────────────────────────
  const [msFile, setMsFile] = useState<File | null>(null);
  const msUploadMutation = useMutation({
    mutationFn: () => api.uploadMarkScheme(id!, msFile!),
    onSuccess: () => {
      setMsFile(null);
      qc.invalidateQueries({ queryKey: ['exam', id] });
    },
  });

  // ── Question definition ───────────────────────────────────────────────────
  const [newQ, setNewQ] = useState({ question_number: '', max_marks: '' });
  const addQuestionMutation = useMutation({
    mutationFn: () => api.createQuestion(id!, {
      question_number: newQ.question_number,
      max_marks: Number(newQ.max_marks),
    }),
    onSuccess: () => {
      setNewQ({ question_number: '', max_marks: '' });
      qc.invalidateQueries({ queryKey: ['questions', id] });
    },
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

  // ── Region drawing (CoordinatePicker) ─────────────────────────────────────
  const [editingQuestion, setEditingQuestion] = useState<ExamQuestion | null>(null);
  const [initialRegions, setInitialRegions] = useState<DrawnRegion[]>([]);
  const [editorRegions, setEditorRegions] = useState<DrawnRegion[]>([]);
  const [editorPage, setEditorPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [editorType, setEditorType] = useState<RegionType>('question');
  const [templateScriptId, setTemplateScriptId] = useState<string>('');
  const [reclip, setReclip] = useState<{ question: ExamQuestion; clips: number; marked: number } | null>(null);

  function openRegionEditor(q: ExamQuestion) {
    const regions = fromQuestionRegions(q);
    setEditingQuestion(q);
    setInitialRegions(regions);
    setEditorRegions(regions);
    setEditorPage(1);
    setPageCount(null);
    setEditorType('question');
    setTemplateScriptId(scripts[0]?.id ?? '');
  }

  function closeRegionEditor() {
    const dirty = JSON.stringify(strip(editorRegions)) !== JSON.stringify(strip(initialRegions));
    if (dirty && !window.confirm('Discard the changes you made to these regions?')) return;
    setEditingQuestion(null);
  }

  const saveRegionsMutation = useMutation({
    mutationFn: () => api.updateQuestion(id!, editingQuestion!.id, {
      clip_coordinates: toClipRegions(editorRegions, 'question'),
      ms_clip_coordinates: toClipRegions(editorRegions, 'ms'),
      name_zones: toNameZones(editorRegions),
    }),
    onSuccess: async () => {
      const q = editingQuestion!;
      setEditingQuestion(null);
      refreshQuestions();
      // If crops were already generated for this question they are now out of date.
      try {
        const progress = await api.getProgress(id!);
        const p = progress.data.questions.find((x) => x.question_id === q.id);
        if (p && p.total_clips > 0) setReclip({ question: q, clips: p.total_clips, marked: p.marked_clips });
        else setReclip(null);
      } catch { /* the banner is a convenience only */ }
    },
  });

  const reclipMutation = useMutation({
    mutationFn: (q: ExamQuestion) => api.triggerClipping(id!, [q.id]),
    onSuccess: () => {
      setReclip(null);
      qc.invalidateQueries({ queryKey: ['exam', id] });
      refreshQuestions();
    },
  });

  // ── Assignments ───────────────────────────────────────────────────────────
  const [assignTeacher, setAssignTeacher] = useState('');
  const [assignQuestion, setAssignQuestion] = useState('');
  const assignMutation = useMutation({
    mutationFn: () => api.createAssignment(id!, { teacher_id: assignTeacher, question_id: assignQuestion }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments', id] }),
  });

  if (examQ.isLoading) return <div className="p-6 text-slate-500">Loading…</div>;

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-4 flex items-center gap-4">
        <Link to="/exams" className="text-sm text-indigo-600 hover:underline">← Exams</Link>
        <h1 className="text-2xl font-semibold text-slate-800">{exam?.name}</h1>
        <Link to={`/exams/${id}/progress`} className="ml-auto text-sm text-indigo-600 hover:underline">View Progress →</Link>
      </div>

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
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-medium text-slate-700 mb-3">Upload Student Scripts</h2>
            <p className="text-xs text-slate-500 mb-3">
              Upload one PDF per student. Scripts are automatically assigned student numbers (001, 002, …).
              Student names are <strong>never</strong> stored alongside the scripts — the system uses numbers only until export.
            </p>
            {exam?.use_drive_storage && driveConfigured ? (
              <DrivePicker onFiles={setUploadFiles} disabled={uploadMutation.isPending} />
            ) : (
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
                className="mb-3 block text-sm text-slate-600"
              />
            )}
            {uploadFiles.length > 0 && (
              <p className="mb-3 text-sm text-slate-600">{uploadFiles.length} file(s) selected</p>
            )}
            <button
              onClick={() => uploadMutation.mutate()}
              disabled={uploadFiles.length === 0 || uploadMutation.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload Scripts'}
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-medium text-slate-700 mb-3">Mark Scheme</h2>
            <p className="text-xs text-slate-500 mb-3">
              Upload the mark scheme PDF. After drawing each question's <strong>mark scheme</strong> region,
              "Generate Clips" produces a per-question MS image that markers can toggle on while marking.
            </p>
            {exam?.mark_scheme_pdf_url && (
              <p className="mb-2 text-sm text-green-700">✓ Mark scheme uploaded</p>
            )}
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setMsFile(e.target.files?.[0] ?? null)}
              className="mb-3 block text-sm text-slate-600"
            />
            <button
              onClick={() => msUploadMutation.mutate()}
              disabled={!msFile || msUploadMutation.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {msUploadMutation.isPending ? 'Uploading…' : exam?.mark_scheme_pdf_url ? 'Replace Mark Scheme' : 'Upload Mark Scheme'}
            </button>
          </div>

          {scripts.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <h2 className="font-medium text-slate-700">{scripts.length} Scripts Uploaded</h2>
                <button
                  onClick={() => clipMutation.mutate()}
                  disabled={clipMutation.isPending || questions.length === 0}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  title={questions.length === 0 ? 'Define questions first' : ''}
                >
                  {clipMutation.isPending ? 'Processing…' : 'Generate Clips'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                {scripts.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-600">Student {s.student_number}</span>
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
            <h2 className="font-medium text-slate-700 mb-3">Define Question Regions</h2>
            <p className="text-xs text-slate-500 mb-3">
              Add each question/part and its mark allocation. After adding questions here,
              use the coordinate tool to draw clip regions on the exam paper PDFs.
            </p>
            <div className="flex gap-3 mb-3">
              <input
                type="text"
                placeholder="e.g. 1a"
                value={newQ.question_number}
                onChange={(e) => setNewQ((q) => ({ ...q, question_number: e.target.value }))}
                className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <input
                type="number"
                placeholder="Marks"
                min={1}
                max={50}
                value={newQ.max_marks}
                onChange={(e) => setNewQ((q) => ({ ...q, max_marks: e.target.value }))}
                className="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={() => addQuestionMutation.mutate()}
                disabled={!newQ.question_number || !newQ.max_marks || addQuestionMutation.isPending}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {addQuestionMutation.error && (
              <p role="alert" className="text-sm text-red-700">{(addQuestionMutation.error as Error).message}</p>
            )}
          </div>

          {reclip && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="min-w-0 flex-1">
                Regions for Q{reclip.question.question_number} changed, so its {reclip.clips} generated clip{reclip.clips === 1 ? '' : 's'} use the old crop.
                {reclip.marked > 0 && ` ${reclip.marked} of them ${reclip.marked === 1 ? 'has' : 'have'} already been marked on the old crop.`}
              </span>
              <button
                onClick={() => reclipMutation.mutate(reclip.question)}
                disabled={reclipMutation.isPending}
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {reclipMutation.isPending ? 'Re-clipping…' : `Re-clip Q${reclip.question.question_number}`}
              </button>
              <button onClick={() => setReclip(null)} className="rounded-lg px-3 py-1.5 text-amber-800 hover:bg-amber-100">Not now</button>
              {reclipMutation.error && <span className="w-full text-red-700">{(reclipMutation.error as Error).message}</span>}
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
                          <button
                            onClick={() => openRegionEditor(q)}
                            disabled={scripts.length === 0}
                            title={scripts.length === 0 ? 'Upload a script first to draw on' : 'Draw or edit clip regions'}
                            className="rounded bg-indigo-600 px-2.5 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            {(q.clip_coordinates ?? []).length > 0 ? 'Edit regions' : 'Draw regions'}
                          </button>
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

      {/* Region drawing modal */}
      {editingQuestion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeRegionEditor}
        >
          <div
            role="dialog"
            aria-label={`Draw regions for question ${editingQuestion.question_number}`}
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header / toolbar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
              <span className="font-medium text-slate-700">Regions: Q{editingQuestion.question_number}</span>

              <div className="ml-2 flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 text-xs">
                {([['question', 'Question'], ['ms', 'Mark scheme'], ['name_zone', 'Name zone']] as [RegionType, string][]).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setEditorType(t)}
                    className={`rounded px-2.5 py-1 font-medium transition-colors ${editorType === t ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {(() => {
                const pagesWithRegions = new Set(editorRegions.map((r) => r.page));
                const lastPage = pageCount ?? Infinity;
                return (
                  <div className="flex items-center gap-1 text-xs text-slate-600">
                    <span>Page</span>
                    <button
                      onClick={() => setEditorPage((p) => Math.max(1, p - 1))}
                      disabled={editorPage <= 1}
                      aria-label="Previous page"
                      className="rounded bg-slate-100 px-2 py-1 hover:bg-slate-200 disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="relative min-w-[3.5rem] text-center font-medium">
                      {editorPage}{pageCount ? ` of ${pageCount}` : ''}
                      {pagesWithRegions.has(editorPage) && (
                        <span className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500" />
                      )}
                    </span>
                    <button
                      onClick={() => setEditorPage((p) => Math.min(lastPage, p + 1))}
                      disabled={editorPage >= lastPage}
                      aria-label="Next page"
                      className="rounded bg-slate-100 px-2 py-1 hover:bg-slate-200 disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                );
              })()}

              {scripts.length > 1 && (
                <select
                  value={templateScriptId}
                  onChange={(e) => { setTemplateScriptId(e.target.value); setPageCount(null); setEditorPage(1); }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                  title="Script used as the layout template"
                  aria-label="Template script"
                >
                  {scripts.map((s) => <option key={s.id} value={s.id}>Script {s.student_number}</option>)}
                </select>
              )}
              {scripts.length === 1 && (
                <span className="text-xs text-slate-500">Script {scripts[0].student_number}</span>
              )}

              <button onClick={closeRegionEditor} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {/* Canvas */}
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {templateScriptId ? (
                <CoordinatePicker
                  key={`${editingQuestion.id}-${templateScriptId}`}
                  scriptId={templateScriptId}
                  page={editorPage}
                  initialRegions={editorRegions}
                  onRegionsChange={setEditorRegions}
                  activeType={editorType}
                  onPageCount={(n) => { setPageCount(n); setEditorPage((p) => Math.min(p, n)); }}
                  onRequestPage={setEditorPage}
                />
              ) : (
                <div className="text-sm text-slate-500">No script available to draw on. Upload a script first.</div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-2.5">
              <span className="text-xs text-slate-500">
                Drag on the page to draw a {editorType === 'name_zone' ? 'name zone (blacked out)' : editorType === 'ms' ? 'mark-scheme region' : 'question region'}.
                Move between pages to add regions on several pages; they are stitched into one image at clip time.
              </span>
              {saveRegionsMutation.error && (
                <span role="alert" className="text-xs text-red-600">{(saveRegionsMutation.error as Error).message}</span>
              )}
              <div className="ml-auto flex gap-2">
                <button onClick={closeRegionEditor} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
                <button
                  onClick={() => saveRegionsMutation.mutate()}
                  disabled={saveRegionsMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saveRegionsMutation.isPending ? 'Saving…' : 'Save regions'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ExamQuestion } from '@marker/shared-types';

type SetupTab = 'scripts' | 'questions' | 'assign';

export function ExamSetup() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<SetupTab>('scripts');

  const examQ = useQuery({ queryKey: ['exam', id], queryFn: () => api.getExam(id!) });
  const scriptsQ = useQuery({ queryKey: ['scripts', id], queryFn: () => api.listScripts(id!) });
  const questionsQ = useQuery({ queryKey: ['questions', id], queryFn: () => api.listQuestions(id!) });
  const assignmentsQ = useQuery({ queryKey: ['assignments', id], queryFn: () => api.listAssignments(id!) });
  const usersQ = useQuery({ queryKey: ['admin-users'], queryFn: () => api.admin.listUsers() });

  const exam = examQ.data?.data;
  const scripts = scriptsQ.data?.data ?? [];
  const questions = questionsQ.data?.data ?? [];
  const assignments = assignmentsQ.data?.data ?? [];
  const teachers = usersQ.data?.data?.users ?? [];

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exam', id] }),
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
            <input
              type="file"
              accept=".pdf"
              multiple
              onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
              className="mb-3 block text-sm text-slate-600"
            />
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
          </div>

          {questions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {questions.map((q: ExamQuestion) => (
                <div key={q.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-12 font-medium text-slate-700">Q{q.question_number}</span>
                  <span className="text-sm text-slate-500">{q.max_marks} marks</span>
                  <div className="ml-auto flex items-center gap-2 text-xs">
                    {q.clip_coordinates ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">Regions set</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">No regions yet</span>
                    )}
                  </div>
                </div>
              ))}
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
    </div>
  );
}

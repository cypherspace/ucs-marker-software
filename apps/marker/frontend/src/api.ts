import type {
  ApiSuccess, AuthMe, Exam, ExamQuestion, StudentScript, ScriptClip,
  ScriptMark, AnnotationData, MarkingAssignment, ExamProgress, ComparativePair,
} from '@marker/shared-types';

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new HttpError(
      res.status,
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
      (body as { code?: string }).code,
    );
    if (res.status === 401) window.dispatchEvent(new CustomEvent('marker:unauthorized'));
    throw err;
  }
  return (await res.json()) as T;
}

const A = '/api/v1';
const ADM = '/admin/v1';

export const api = {
  me: () => http<ApiSuccess<AuthMe>>('/auth/me'),
  logout: () => http<ApiSuccess<{ ok: true }>>('/auth/logout', { method: 'POST' }),

  // Exams
  listExams: () => http<ApiSuccess<Exam[]>>(`${A}/`),
  getExam: (id: string) => http<ApiSuccess<Exam>>(`${A}/${id}`),
  createExam: (body: Partial<Exam>) =>
    http<ApiSuccess<Exam>>(`${A}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateExam: (id: string, body: Partial<Exam>) =>
    http<ApiSuccess<Exam>>(`${A}/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Questions
  listQuestions: (examId: string) => http<ApiSuccess<ExamQuestion[]>>(`${A}/${examId}/questions`),
  createQuestion: (examId: string, body: Partial<ExamQuestion>) =>
    http<ApiSuccess<ExamQuestion>>(`${A}/${examId}/questions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateQuestion: (examId: string, questionId: string, body: Partial<ExamQuestion>) =>
    http<ApiSuccess<ExamQuestion>>(`${A}/${examId}/questions/${questionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Scripts
  listScripts: (examId: string) => http<ApiSuccess<StudentScript[]>>(`${A}/exams/${examId}/scripts`),
  uploadScripts: async (examId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('scripts', f));
    return http<ApiSuccess<{ id: string; student_number: string }[]>>(`${A}/exams/${examId}/scripts`, {
      method: 'POST',
      body: form,
    });
  },
  triggerClipping: (examId: string) =>
    http<ApiSuccess<{ clips_created: number; ms_clips_created: number }>>(`${A}/exams/${examId}/clip`, { method: 'POST' }),
  uploadMarkScheme: (examId: string, file: File) => {
    const form = new FormData();
    form.append('mark_scheme', file);
    return http<ApiSuccess<{ mark_scheme_pdf_url: string }>>(`${A}/exams/${examId}/mark-scheme`, {
      method: 'POST',
      body: form,
    });
  },
  // URL for an <img> — renders a script PDF page to PNG via the extractor
  renderScriptPageUrl: (scriptId: string, page: number) => `${A}/scripts/${scriptId}/render?page=${page}`,

  // Assignments
  listAssignments: (examId: string) => http<ApiSuccess<MarkingAssignment[]>>(`${A}/${examId}/assignments`),
  createAssignment: (examId: string, body: { teacher_id: string; question_id: string }) =>
    http<ApiSuccess<{ ok: true }>>(`${A}/${examId}/assignments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteAssignment: (examId: string, body: { teacher_id: string; question_id: string }) =>
    http<ApiSuccess<{ ok: true }>>(`${A}/${examId}/assignments`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Progress
  getProgress: (examId: string) => http<ApiSuccess<ExamProgress>>(`${A}/${examId}/progress`),

  // Marking
  myExams: () => http<ApiSuccess<(Exam & { assigned_questions: ExamQuestion[] })[]>>(`${A}/my-exams`),
  getNextClip: (examId: string, questionId: string) =>
    http<ApiSuccess<{ id: string; clip_url: string; ms_url: string | null; question: ExamQuestion; remaining: number } | null>>(
      `${A}/exams/${examId}/queue/${questionId}`,
    ),
  saveMark: (body: { clip_id: string; marks_awarded: number; annotation_data: AnnotationData }) =>
    http<ApiSuccess<ScriptMark>>(`${A}/marks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getScriptUrl: (clipId: string) => http<ApiSuccess<{ url: string }>>(`${A}/clips/${clipId}/script`),

  // Comparative marking
  getNextPair: (examId: string, questionId: string) =>
    http<ApiSuccess<ComparativePair | null>>(`${A}/exams/${examId}/compare/${questionId}`),
  recordComparison: (pairId: string, winnerClipId: string) =>
    http<ApiSuccess<ComparativePair>>(`${A}/compare/${pairId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ winner_clip_id: winnerClipId }),
    }),

  // AI
  runOcr: (clipId: string) => http<ApiSuccess<{ ocr_text: string }>>(`${A}/clips/${clipId}/ocr`, { method: 'POST' }),
  aiMark: (clipId: string, body: { mark_scheme_text: string; examiner_report_text?: string; generate_feedback?: boolean }) =>
    http<ApiSuccess<{ mark: ScriptMark; reasoning: string }>>(`${A}/clips/${clipId}/ai-mark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  triggerAiMarking: (examId: string, body: { question_id: string; mark_scheme_text: string; generate_feedback?: boolean }) =>
    http<ApiSuccess<{ queued: number }>>(`${A}/exams/${examId}/ai-mark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Admin
  admin: {
    listUsers: () => http<ApiSuccess<{ users: AuthMe[]; invites: { email: string; role: string }[] }>>(`${ADM}/users`),
    addInvite: (email: string, role: 'admin' | 'teacher') =>
      http<ApiSuccess<{ ok: true }>>(`${ADM}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      }),
    setUserRole: (id: string, role: 'admin' | 'teacher') =>
      http<ApiSuccess<AuthMe>>(`${ADM}/users/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      }),
  },
};

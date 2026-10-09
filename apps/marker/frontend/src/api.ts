import type {
  ApiSuccess, AssignedQuestion, AuthMe, Exam, ExamDeletePreview, ExamQuestion, ExamResults, StudentScript, ScriptClip,
  ScriptMark, AnnotationData, MarkingAssignment, ExamProgress, ComparativePair, HomeSummary,
  AdminUser, AdminInvite, AuditEntry, OverviewExam, TeacherOption,
  QueueClip, AiPlan, AiStepResult, AiResults, AiSettings, AiScopeType,
  ComparativeStatus, ComparativeNextPair, Ranking, ClipSettings, ClipRegion, NameZone, ClipListItem,
} from '@marker/shared-types';

export class HttpError extends Error {
  status: number;
  code?: string;
  body?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
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
      body as Record<string, unknown>,
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

  home: () => http<ApiSuccess<HomeSummary>>(`${A}/home`),

  // Exams
  listExams: (which: 'active' | 'archived' | 'all' = 'active') =>
    http<ApiSuccess<Exam[]>>(which === 'active' ? `${A}/` : `${A}/?archived=${which}`),
  archiveExam: (id: string) => http<ApiSuccess<Exam>>(`${A}/${id}/archive`, { method: 'POST' }),
  restoreExam: (id: string) => http<ApiSuccess<Exam>>(`${A}/${id}/restore`, { method: 'POST' }),
  deletePreview: (id: string) => http<ApiSuccess<ExamDeletePreview>>(`${A}/${id}/delete-preview`),
  deleteExam: (id: string, name: string) =>
    http<ApiSuccess<{ deleted: boolean; drive_files_left: boolean }>>(`${A}/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
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
  deleteQuestion: (examId: string, questionId: string, confirm = false) =>
    http<ApiSuccess<{ ok: true }>>(`${A}/${examId}/questions/${questionId}${confirm ? '?confirm=1' : ''}`, { method: 'DELETE' }),
  updateQuestion: (examId: string, questionId: string, body: Partial<ExamQuestion>) =>
    http<ApiSuccess<ExamQuestion>>(`${A}/${examId}/questions/${questionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Scripts
  listScripts: (examId: string) => http<ApiSuccess<StudentScript[]>>(`${A}/exams/${examId}/scripts`),
  // classGroup: the class these scripts belong to (optional); every file in the call is filed under it
  uploadScripts: async (examId: string, files: File[], classGroup?: string) => {
    const form = new FormData();
    if (classGroup?.trim()) form.append('class_group', classGroup.trim());
    files.forEach((f) => form.append('scripts', f));
    return http<ApiSuccess<{ id: string; student_number: string }[]>>(`${A}/exams/${examId}/scripts`, {
      method: 'POST',
      body: form,
    });
  },
  triggerClipping: (examId: string, questionIds?: string[]) =>
    http<ApiSuccess<{ clips_created: number; ms_clips_created: number }>>(`${A}/exams/${examId}/clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(questionIds ? { question_ids: questionIds } : {}),
    }),
  // Clipping in small steps (a class is too much for one request)
  planClipping: (examId: string, questionIds?: string[]) =>
    http<ApiSuccess<{ script_ids: string[]; questions: number }>>(`${A}/exams/${examId}/clip/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(questionIds ? { question_ids: questionIds } : {}),
    }),
  clipStep: (examId: string, scriptIds: string[], questionIds?: string[]) =>
    http<ApiSuccess<{ results: { id: string; ok: boolean; error?: string; clips?: number; kept?: number }[] }>>(
      `${A}/exams/${examId}/clip/step`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ script_ids: scriptIds, ...(questionIds ? { question_ids: questionIds } : {}) }),
      },
    ),
  finishClipping: (examId: string, questionIds?: string[]) =>
    http<ApiSuccess<{ ms_clips_created: number }>>(`${A}/exams/${examId}/clip/finish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(questionIds ? { question_ids: questionIds } : {}),
    }),
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
  // Fetch a rendered page as an object URL so failures surface as real errors (status + message)
  fetchScriptPage: async (scriptId: string, page: number): Promise<{ objectUrl: string; pageCount: number | null }> => {
    const res = await fetch(`${A}/scripts/${scriptId}/render?page=${page}`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) window.dispatchEvent(new CustomEvent('marker:unauthorized'));
      throw new HttpError(
        res.status,
        (body as { error?: string }).error ?? `HTTP ${res.status}`,
        (body as { code?: string }).code,
        body as Record<string, unknown>,
      );
    }
    const count = Number(res.headers.get('x-page-count'));
    return { objectUrl: URL.createObjectURL(await res.blob()), pageCount: Number.isFinite(count) && count > 0 ? count : null };
  },

  // The mark scheme PDF rendered page by page (lead teacher / admin), for drawing mark-scheme regions on it
  fetchMarkSchemePage: async (examId: string, page: number): Promise<{ objectUrl: string; pageCount: number | null }> => {
    const res = await fetch(`${A}/exams/${examId}/mark-scheme/render?page=${page}`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) window.dispatchEvent(new CustomEvent('marker:unauthorized'));
      throw new HttpError(
        res.status,
        (body as { error?: string }).error ?? `HTTP ${res.status}`,
        (body as { code?: string }).code,
        body as Record<string, unknown>,
      );
    }
    const count = Number(res.headers.get('x-page-count'));
    return { objectUrl: URL.createObjectURL(await res.blob()), pageCount: Number.isFinite(count) && count > 0 ? count : null };
  },
  // Clip the mark scheme now: one image per question that has a mark-scheme region
  clipMarkScheme: (examId: string) =>
    http<ApiSuccess<{ ms_clips_created: number }>>(`${A}/exams/${examId}/mark-scheme/clip`, { method: 'POST' }),

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
  myExams: () => http<ApiSuccess<(Exam & { assigned_questions: AssignedQuestion[] })[]>>(`${A}/my-exams`),
  // The clip asked for, or the first one this teacher hasn't finished
  getNextClip: (examId: string, questionId: string, clipId?: string) =>
    http<ApiSuccess<QueueClip | null>>(
      `${A}/exams/${examId}/queue/${questionId}${clipId ? `?clip_id=${encodeURIComponent(clipId)}` : ''}`,
    ),
  listClips: (examId: string, questionId: string) =>
    http<ApiSuccess<ClipListItem[]>>(`${A}/exams/${examId}/questions/${questionId}/clips`),
  // draft: an automatic save when leaving a clip; it keeps the ticks without counting the clip as marked
  saveMark: (body: { clip_id: string; marks_awarded: number | null; annotation_data: AnnotationData; draft?: boolean }) =>
    http<ApiSuccess<ScriptMark>>(`${A}/marks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  // Per-script clips: choose the pages/areas for one script's answer to one question
  getClipSettings: (scriptId: string, questionId: string) =>
    http<ApiSuccess<ClipSettings>>(`${A}/scripts/${scriptId}/questions/${questionId}/clip`),
  setClipRegions: (scriptId: string, questionId: string, body: { regions: ClipRegion[]; name_zones?: NameZone[] }) =>
    http<ApiSuccess<{ clip_id: string; clip_source: 'manual'; marked_before: boolean }>>(
      `${A}/scripts/${scriptId}/questions/${questionId}/clip`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    ),
  resetClipRegions: (scriptId: string, questionId: string) =>
    http<ApiSuccess<{ clip_id: string; clip_source: 'auto' }>>(
      `${A}/scripts/${scriptId}/questions/${questionId}/clip`,
      { method: 'DELETE' },
    ),
  // Stable URL for clip image — redirects to Drive/GCS/local as appropriate
  clipImageUrl: (clipId: string) => `${A}/clips/${clipId}/image`,

  // Comparative marking
  compareStatus: (examId: string, questionId: string) =>
    http<ApiSuccess<ComparativeStatus>>(`${A}/exams/${examId}/compare/${questionId}/status`),
  compareCreatePairs: (examId: string, questionId: string, perItem: number, preview: boolean) =>
    http<ApiSuccess<{ round: number; count: number; created: number }>>(`${A}/exams/${examId}/compare/${questionId}/pairs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ per_item: perItem, preview }),
    }),
  compareNext: (examId: string, questionId: string) =>
    http<ApiSuccess<ComparativeNextPair | null>>(`${A}/exams/${examId}/compare/${questionId}/next`),
  compareJudge: (pairId: string, winnerClipId: string) =>
    http<ApiSuccess<{ ok: true }>>(`${A}/compare/pairs/${pairId}/judge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ winner_clip_id: winnerClipId }),
    }),
  compareRanking: (examId: string, questionId: string) =>
    http<ApiSuccess<Ranking>>(`${A}/exams/${examId}/compare/${questionId}/ranking`),
  compareAiPlan: (examId: string, questionId: string) =>
    http<ApiSuccess<{ pair_ids: string[]; total: number; has_mark_scheme: boolean }>>(
      `${A}/exams/${examId}/compare/${questionId}/ai-judge/plan`, { method: 'POST' }),
  compareAiStep: (examId: string, questionId: string, pairIds: string[], guidance: string, useExamples: boolean) =>
    http<ApiSuccess<{ results: (Pick<AiStepResult, 'ok' | 'error' | 'code' | 'retryable' | 'fatal' | 'retry_after_seconds'> & { pair_id: string })[] }>>(
      `${A}/exams/${examId}/compare/${questionId}/ai-judge/step`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pair_ids: pairIds, guidance: guidance || undefined, use_examples: useExamples }),
      }),

  // Export
  exportResults: (examId: string, opts: { names?: boolean; classGroup?: string | null } = {}) => {
    // classGroup: a class name, null for scripts with no class, undefined for everything
    const q = new URLSearchParams();
    if (opts.names) q.set('names', '1');
    if (opts.classGroup === null) q.set('no_class', '1');
    else if (opts.classGroup) q.set('class', opts.classGroup);
    const qs = q.toString();
    return http<ApiSuccess<{ driveUrl?: string; csv?: string; filename?: string }>>(`${A}/exams/${examId}/export${qs ? `?${qs}` : ''}`);
  },
  getResults: (examId: string, classGroup?: string | null) => {
    const q = new URLSearchParams();
    if (classGroup === null) q.set('no_class', '1');
    else if (classGroup) q.set('class', classGroup);
    const qs = q.toString();
    return http<ApiSuccess<ExamResults>>(`${A}/exams/${examId}/results${qs ? `?${qs}` : ''}`);
  },

  // AI
  aiStatus: () => http<ApiSuccess<{ configured: boolean; model: string; max_rpm: number }>>(`${A}/ai/status`),
  runOcr: (clipId: string, refresh = false) =>
    http<ApiSuccess<{ ocr_text: string; converted_url: string; cached: boolean }>>(`${A}/clips/${clipId}/ocr${refresh ? '?refresh=1' : ''}`, { method: 'POST' }),
  aiPlan: (examId: string, settings: AiSettings, scope: { type: AiScopeType; count?: number }) =>
    http<ApiSuccess<AiPlan>>(`${A}/exams/${examId}/ai-mark/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question_id: settings.question_id, mode: settings.mode, scope }),
    }),
  aiStep: (examId: string, settings: AiSettings, clipIds: string[]) =>
    http<ApiSuccess<{ results: AiStepResult[] }>>(`${A}/exams/${examId}/ai-mark/step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...settings, guidance: settings.guidance || undefined, clip_ids: clipIds }),
    }),
  aiResults: (examId: string, questionId: string) =>
    http<ApiSuccess<AiResults>>(`${A}/exams/${examId}/ai-results?question_id=${questionId}`),

  // Admin
  listTeachers: () => http<ApiSuccess<TeacherOption[]>>(`${A}/teachers`),
  admin: {
    listUsers: () => http<ApiSuccess<{ users: AdminUser[]; invites: AdminInvite[] }>>(`${ADM}/users`),
    addInvite: (email: string, role: 'admin' | 'teacher') =>
      http<ApiSuccess<{ ok: true }>>(`${ADM}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      }),
    removeInvite: (email: string) =>
      http<ApiSuccess<{ ok: true }>>(`${ADM}/invites/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    setUserRole: (id: string, role: 'admin' | 'teacher') =>
      http<ApiSuccess<{ id: string; email: string; role: 'admin' | 'teacher' }>>(`${ADM}/users/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      }),
    deactivateUser: (id: string) =>
      http<ApiSuccess<{ id: string; disabled: true; leads_exams: number }>>(`${ADM}/users/${id}/deactivate`, { method: 'POST' }),
    reactivateUser: (id: string) =>
      http<ApiSuccess<{ id: string; disabled: false }>>(`${ADM}/users/${id}/reactivate`, { method: 'POST' }),
    auditLog: (before?: string) =>
      http<ApiSuccess<{ entries: AuditEntry[]; next_before: string | null }>>(
        `${ADM}/audit?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`,
      ),
    overview: () => http<ApiSuccess<OverviewExam[]>>(`${ADM}/overview`),
  },
};

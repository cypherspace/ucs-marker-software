// ─── Shared API envelope ────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
  meta?: { page?: number; limit?: number; total?: number };
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthMe {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'teacher';
}

// ─── Exams ───────────────────────────────────────────────────────────────────

export type ExamStatus = 'setup' | 'clipping' | 'marking' | 'complete';

export interface Exam {
  id: string;
  name: string;
  subject: string | null;
  year: number | null;
  year_group: string | null;
  exam_board: string | null;
  exam_series: string | null;
  lead_teacher_id: string;
  status: ExamStatus;
  mark_scheme_pdf_url: string | null;
  use_drive_storage: boolean;
  drive_folder_id: string | null;
  created_at: string;
  // Present on the exam list only
  clips_total?: number;
  clips_marked?: number;
}

// Coordinate region in PDF user-space (points at 72 DPI)
export interface ClipRegion {
  page: number;  // 1-indexed
  x: number;
  y: number;
  width: number;
  height: number;
}

// Name zones to black out before any AI processing
export interface NameZone extends ClipRegion {}

export interface ExamQuestion {
  id: string;
  exam_id: string;
  question_number: string;
  max_marks: number;
  clip_coordinates: ClipRegion[] | null;
  ms_clip_coordinates: ClipRegion[] | null;
  name_zones: NameZone[] | null;
  ms_clip_image_url: string | null;
  marking_mode: MarkingMode;
  created_at: string;
}

export type MarkingMode = 'marks' | 'comparative';

// ─── Scripts ─────────────────────────────────────────────────────────────────

export interface StudentScript {
  id: string;
  exam_id: string;
  student_id: string | null;
  student_number: string;
  original_pdf_url: string;
  uploaded_at: string;
}

export interface ScriptClip {
  id: string;
  script_id: string;
  question_id: string;
  clip_image_url: string;
  ocr_text: string | null;
  created_at: string;
}

// ─── Marking ─────────────────────────────────────────────────────────────────

export type AnnotationTool =
  | 'tick'
  | 'cross'
  | 'numbered_tick'
  | 'numbered_cross'
  | 'circle'
  | 'underline'
  | 'ruler'
  | 'text';

export interface Annotation {
  id: string;
  type: AnnotationTool;
  x: number;
  y: number;
  color: string;
  number?: number;    // for numbered_tick / numbered_cross
  text?: string;      // for text annotations
  points?: number[];  // [x1,y1,x2,y2] for ruler / underline
  radius?: number;    // for circle
}

export interface AnnotationData {
  annotations: Annotation[];
}

export type MarkSource = 'human' | 'ai';
export type MarkStatus = 'pending' | 'marked' | 'moderated';

export interface ScriptMark {
  id: string;
  clip_id: string;
  marker_id: string | null;
  mark_source: MarkSource;
  marks_awarded: number | null;
  annotation_data: AnnotationData | null;
  ai_feedback: string | null;
  ai_reasoning?: string | null;
  ai_model?: string | null;
  status: MarkStatus;
  marked_at: string | null;
  created_at: string;
}

// The next clip in a teacher's marking queue
export interface QueueClip {
  id: string;
  clip_url: string;
  ms_url: string | null;
  question: ExamQuestion;
  remaining: number;
  ai_mark: { marks_awarded: number | null; reasoning: string | null; feedback: string | null; model: string | null } | null;
  ocr_text: string | null;
}

// ─── Comparative marking ─────────────────────────────────────────────────────

export interface ComparativePair {
  id: string;
  exam_id: string;
  question_id: string;
  clip_a_id: string;
  clip_b_id: string;
  clip_a_image_url?: string;
  clip_b_image_url?: string;
  winner_clip_id: string | null;
  gemini_reasoning: string | null;
  compared_at: string | null;
}

// ─── Progress ────────────────────────────────────────────────────────────────

export interface QuestionProgress {
  question_id: string;
  question_number: string;
  max_marks: number;
  total_clips: number;
  // Clips a teacher has marked
  marked_clips: number;
  // Clips with an AI mark, and clips with any final mark (human, else AI)
  ai_marked_clips: number;
  covered_clips: number;
  marking_mode: MarkingMode;
  teachers: { teacher_id: string; email: string; marked: number; total: number }[];
}

export interface ExamProgress {
  exam_id: string;
  questions: QuestionProgress[];
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export interface MarkingAssignment {
  exam_id: string;
  teacher_id: string;
  teacher_email: string;
  teacher_name: string | null;
  question_id: string;
  question_number: string;
  assigned_at: string;
}

// ─── Home summary ────────────────────────────────────────────────────────────

export interface HomeSummary {
  marking: {
    assigned_questions: number;
    exams: number;
    clips_total: number;
    clips_left: number;
    next: { exam_id: string; exam_name: string; question_id: string; question_number: string } | null;
  };
  exams: { total: number; setup: number; clipping: number; marking: number; complete: number };
  progress: {
    clips_total: number;
    clips_marked: number;
    latest_exam: { id: string; name: string } | null;
  };
  // AI marks on the exams you lead (all exams for admins)
  ai: { ai_marked: number };
  // Comparison pairs waiting for a teacher, on questions assigned to you
  comparative: {
    questions: number;
    pairs_left: number;
    next: { exam_id: string; exam_name: string; question_id: string; question_number: string } | null;
  };
  // Admins only
  admin?: { staff: number; pending_invites: number };
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'teacher';
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
  leads_exams: number;
}

export interface AdminInvite {
  email: string;
  role: 'admin' | 'teacher';
  created_at: string;
  added_by_email: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_email: string | null;
}

export interface TeacherOption {
  id: string;
  email: string;
  name: string | null;
}

export interface OverviewTeacher {
  teacher_id: string;
  email: string;
  clips_assigned: number;
  clips_marked: number;
  last_marked_at: string | null;
}

export interface OverviewExam {
  exam_id: string;
  name: string;
  status: ExamStatus;
  lead_email: string | null;
  clips_total: number;
  clips_marked: number;
  teachers: OverviewTeacher[];
}

// ─── AI marking ──────────────────────────────────────────────────────────────

export type AiScopeType = 'unmarked' | 'sample' | 'human_marked' | 'all';
export type AiMode = 'marks' | 'feedback' | 'both';
export type AiStrictness = 'strict' | 'balanced' | 'lenient';

export interface AiSettings {
  question_id: string;
  mode: AiMode;
  strictness: AiStrictness;
  guidance?: string;
  use_examples: boolean;
}

export interface AiPlan {
  clip_ids: string[];
  total: number;
  has_mark_scheme: boolean;
}

export interface AiStepResult {
  clip_id: string;
  ok: boolean;
  marks_awarded?: number | null;
  error?: string;
}

export interface AiResultRow {
  clip_id: string;
  student_number: string;
  human_mark: number | null;
  ai_mark: number | null;
  difference: number | null;
  ai_reasoning: string | null;
  ai_feedback: string | null;
}

export interface AiResults {
  max_marks: number;
  rows: AiResultRow[];
  stats: {
    compared: number;
    exact_pct: number | null;
    within_one_pct: number | null;
    mean_abs_diff: number | null;
    mean_signed_diff: number | null;
  };
}

// ─── Comparative marking (extended) ──────────────────────────────────────────

export interface ComparativeStatus {
  marking_mode: MarkingMode;
  max_marks: number;
  clips: number;
  pairs_total: number;
  rounds: number;
  human_judged: number;
  ai_judged: number;
  unjudged: number;
  // Pairs a teacher can still judge (no human judgement yet)
  human_available: number;
  my_judged: number;
}

export interface ComparativeNextPair {
  pair_id: string;
  clip_a_id: string;
  clip_b_id: string;
  remaining: number;
}

export interface RankedClip {
  rank: number;
  clip_id: string;
  student_number: string;
  score: number;
  judgements: number;
  human: number;
  ai: number;
}

export interface Ranking {
  ranked: RankedClip[];
  judged_pairs: number;
  total_pairs: number;
}

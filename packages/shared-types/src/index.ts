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
  created_at: string;
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
  created_at: string;
}

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
  status: MarkStatus;
  marked_at: string | null;
  created_at: string;
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
  marked_clips: number;
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

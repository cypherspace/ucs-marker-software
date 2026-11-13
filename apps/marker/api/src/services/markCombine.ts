// How several teachers' marks for one clip become one mark, and whether they agree.
// The SQL twin of this is `finalMarks()` in finalMark.ts: keep the two in step (a test checks them against each other).

export type MarkCombine = 'latest' | 'average' | 'lead';
export const MARK_COMBINES: readonly MarkCombine[] = ['latest', 'average', 'lead'];

export const isMarkCombine = (v: unknown): v is MarkCombine => MARK_COMBINES.includes(v as MarkCombine);

export interface TeacherMark {
  teacher_id: string | null;
  marks: number;
  marked_at: string | Date | null;
}

// Half marks round up, so two teachers giving 1 and 2 average to 2
export const roundHalfUp = (x: number): number => Math.floor(x + 0.5);

export const meanOf = (marks: number[]): number | null =>
  marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null;

const time = (m: TeacherMark) => (m.marked_at ? new Date(m.marked_at).getTime() : 0);

// The single mark for a clip from its teacher marks (oldest first or any order), or null when nobody marked it
export function combineMarks(marks: TeacherMark[], mode: MarkCombine, leadTeacherId?: string | null): number | null {
  if (marks.length === 0) return null;
  const average = () => roundHalfUp(meanOf(marks.map((m) => m.marks))!);
  switch (mode) {
    case 'latest':
      return [...marks].sort((a, b) => time(b) - time(a))[0].marks;
    case 'average':
      return average();
    case 'lead': {
      const lead = leadTeacherId ? marks.find((m) => m.teacher_id === leadTeacherId) : undefined;
      return lead ? lead.marks : average();
    }
  }
}

export type AgreementState = 'none' | 'single' | 'agreed' | 'conflict';

// none: nobody marked it; single: one teacher; agreed: two or more with the same mark; conflict: two or more who differ
export function agreementState(marks: number[]): AgreementState {
  if (marks.length === 0) return 'none';
  if (marks.length === 1) return 'single';
  return Math.max(...marks) === Math.min(...marks) ? 'agreed' : 'conflict';
}

export const spreadOf = (marks: number[]): number => (marks.length ? Math.max(...marks) - Math.min(...marks) : 0);

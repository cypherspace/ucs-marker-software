import { db } from '../db.js';
import type { MarkCombine } from './markCombine.js';

// A clip can carry several teachers' marks (one each) and an AI mark side by side. The mark that counts is, in order:
// a moderated mark, then the teachers' marks combined as the exam says (`latest`, `average` or `lead`, see
// markCombine.ts), then the AI mark. Use this sub-query (one row per clip) instead of joining script_marks
// directly, so a clip is never counted or exported twice.
//
//   db('script_clips as sc').leftJoin(finalMarks('fm', exam.mark_combine), 'fm.clip_id', 'sc.id')
//
// `humanOnly` leaves the AI mark out: a clip nobody has marked has no row. Use it wherever a mark is shown as "what the
// teachers decided" (for example the reference a student's mark is compared with).
export function finalMarks(alias = 'fm', combine: MarkCombine = 'latest', humanOnly = false) {
  if (combine === 'latest') {
    return db.raw(
      `(SELECT DISTINCT ON (clip_id) clip_id, marks_awarded, mark_source, ai_feedback, ai_reasoning, status, marker_id, marked_at
          FROM script_marks
         WHERE status <> 'pending' AND marks_awarded IS NOT NULL ${humanOnly ? `AND mark_source = 'human'` : ''}
         ORDER BY clip_id, (status = 'moderated') DESC, (mark_source = 'human') DESC,
                  marked_at DESC NULLS LAST, created_at DESC) AS ${alias}`,
    );
  }
  // average / lead: aggregate the teachers' marks per clip; moderated first, AI last
  const teacherMark = combine === 'lead'
    ? `COALESCE(
         MAX(sm.marks_awarded) FILTER (WHERE sm.mark_source = 'human' AND sm.marker_id = e.lead_teacher_id),
         FLOOR(AVG(sm.marks_awarded) FILTER (WHERE sm.mark_source = 'human') + 0.5))`
    : `FLOOR(AVG(sm.marks_awarded) FILTER (WHERE sm.mark_source = 'human') + 0.5)`;
  return db.raw(
    `(SELECT sm.clip_id,
            COALESCE(
              MAX(sm.marks_awarded) FILTER (WHERE sm.status = 'moderated'),
              ${teacherMark}
              ${humanOnly ? '' : `, MAX(sm.marks_awarded) FILTER (WHERE sm.mark_source = 'ai')`}
            )::int AS marks_awarded,
            (CASE WHEN bool_or(sm.mark_source = 'human') THEN 'human' ELSE 'ai' END)::mark_source AS mark_source,
            MAX(sm.ai_feedback) FILTER (WHERE sm.mark_source = 'ai') AS ai_feedback,
            MAX(sm.ai_reasoning) FILTER (WHERE sm.mark_source = 'ai') AS ai_reasoning,
            'marked'::mark_status AS status,
            NULL::uuid AS marker_id,
            MAX(sm.marked_at) AS marked_at
       FROM script_marks sm
       JOIN script_clips sc ON sc.id = sm.clip_id
       JOIN exam_questions eq ON eq.id = sc.question_id
       JOIN exams e ON e.id = eq.exam_id
      WHERE sm.status <> 'pending' AND sm.marks_awarded IS NOT NULL ${humanOnly ? `AND sm.mark_source = 'human'` : ''}
      GROUP BY sm.clip_id, e.lead_teacher_id) AS ${alias}`,
  );
}

// "Marked" in progress figures means a teacher has marked it; AI marks are
// counted separately.
export const HUMAN_MARK_SQL = `sm.status <> 'pending' AND sm.mark_source = 'human' AND sm.marks_awarded IS NOT NULL`;

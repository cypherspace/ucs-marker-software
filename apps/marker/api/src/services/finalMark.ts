import { db } from '../db.js';

// A clip can carry a teacher's mark and an AI mark side by side. The mark that
// counts is, in order: a moderated mark, the latest human mark, the AI mark.
// Use this sub-query (one row per clip) instead of joining script_marks directly,
// so a clip is never counted or exported twice.
//
//   db('script_clips as sc').leftJoin(finalMarks('fm'), 'fm.clip_id', 'sc.id')
export function finalMarks(alias = 'fm') {
  return db.raw(
    `(SELECT DISTINCT ON (clip_id) clip_id, marks_awarded, mark_source, ai_feedback, ai_reasoning, status, marker_id, marked_at
        FROM script_marks
       WHERE status <> 'pending' AND marks_awarded IS NOT NULL
       ORDER BY clip_id, (status = 'moderated') DESC, (mark_source = 'human') DESC,
                marked_at DESC NULLS LAST, created_at DESC) AS ${alias}`,
  );
}

// "Marked" in progress figures means a teacher has marked it; AI marks are
// counted separately.
export const HUMAN_MARK_SQL = `sm.status <> 'pending' AND sm.mark_source = 'human' AND sm.marks_awarded IS NOT NULL`;

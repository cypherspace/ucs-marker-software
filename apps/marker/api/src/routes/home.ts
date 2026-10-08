import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

const num = (v: unknown) => Number(v ?? 0);

// One round-trip summary for the homepage cards. Admins see every exam; teachers
// see exams they lead or are assigned to (same rule as the exam list).
router.get('/home', requireAuth, async (req, res, next) => {
  try {
    const uid = req.user!.sub;
    const isAdmin = req.user!.role === 'admin';

    const visibleExams = isAdmin
      ? 'SELECT id FROM exams WHERE archived_at IS NULL'
      : `SELECT e.id FROM exams e
         WHERE e.archived_at IS NULL
           AND (e.lead_teacher_id = :uid
                OR EXISTS (SELECT 1 FROM marking_assignments ma WHERE ma.exam_id = e.id AND ma.teacher_id = :uid))`;
    const ledExams = isAdmin
      ? 'SELECT id FROM exams WHERE archived_at IS NULL'
      : 'SELECT id FROM exams WHERE archived_at IS NULL AND lead_teacher_id = :uid';

    const statusRows = (await db.raw(
      `SELECT status, COUNT(*) AS n FROM exams WHERE id IN (${visibleExams}) GROUP BY status`,
      { uid },
    )).rows as { status: string; n: string }[];
    const exams = { total: 0, setup: 0, clipping: 0, marking: 0, complete: 0 };
    for (const r of statusRows) {
      const n = num(r.n);
      exams.total += n;
      if (r.status in exams) (exams as Record<string, number>)[r.status] = n;
    }

    // Clips this teacher still has to mark: same rule as the marking queue.
    const markingRows = (await db.raw(
      `SELECT ma.exam_id, e.name AS exam_name, e.created_at AS exam_created, eq.id AS question_id, eq.question_number,
              COUNT(sc.id) AS clips_total,
              COUNT(sc.id) FILTER (WHERE sm.id IS NULL) AS clips_left
         FROM marking_assignments ma
         JOIN exams e ON e.id = ma.exam_id
         JOIN exam_questions eq ON eq.id = ma.question_id
         LEFT JOIN script_clips sc ON sc.question_id = eq.id
         LEFT JOIN script_marks sm ON sm.clip_id = sc.id AND sm.marker_id = :uid AND sm.mark_source = 'human'
                                  AND sm.status <> 'pending'
        WHERE ma.teacher_id = :uid AND e.archived_at IS NULL
        GROUP BY ma.exam_id, e.name, e.created_at, eq.id, eq.question_number
        ORDER BY e.created_at, eq.question_number`,
      { uid },
    )).rows as {
      exam_id: string; exam_name: string; question_id: string; question_number: string;
      clips_total: string; clips_left: string;
    }[];
    const next = markingRows.find((r) => num(r.clips_left) > 0) ?? null;
    const marking = {
      assigned_questions: markingRows.length,
      exams: new Set(markingRows.map((r) => r.exam_id)).size,
      clips_total: markingRows.reduce((a, r) => a + num(r.clips_total), 0),
      clips_left: markingRows.reduce((a, r) => a + num(r.clips_left), 0),
      next: next
        ? { exam_id: next.exam_id, exam_name: next.exam_name, question_id: next.question_id, question_number: next.question_number }
        : null,
    };

    const progressRow = (await db.raw(
      `SELECT COUNT(DISTINCT sc.id) AS clips_total,
              COUNT(DISTINCT sc.id) FILTER (WHERE sm.id IS NOT NULL) AS clips_marked
         FROM script_clips sc
         JOIN exam_questions eq ON eq.id = sc.question_id
         LEFT JOIN script_marks sm ON sm.clip_id = sc.id AND sm.status <> 'pending' AND sm.mark_source = 'human'
        WHERE eq.exam_id IN (${ledExams})`,
      { uid },
    )).rows[0] as { clips_total: string; clips_marked: string };
    const latest = (await db.raw(
      `SELECT id, name FROM exams WHERE id IN (${ledExams}) AND status = 'marking'
        ORDER BY created_at DESC LIMIT 1`,
      { uid },
    )).rows[0] as { id: string; name: string } | undefined;

    const aiRow = (await db.raw(
      `SELECT COUNT(DISTINCT sc.id) AS ai_marked
         FROM script_clips sc
         JOIN exam_questions eq ON eq.id = sc.question_id
         JOIN script_marks sm ON sm.clip_id = sc.id AND sm.mark_source = 'ai' AND sm.marks_awarded IS NOT NULL
        WHERE eq.exam_id IN (${ledExams})`,
      { uid },
    )).rows[0] as { ai_marked: string };

    // Comparisons a teacher can still judge on questions assigned to them.
    const compRows = (await db.raw(
      `SELECT e.id AS exam_id, e.name AS exam_name, eq.id AS question_id, eq.question_number,
              COUNT(p.id) FILTER (WHERE h.id IS NULL) AS pairs_left
         FROM marking_assignments ma
         JOIN exam_questions eq ON eq.id = ma.question_id AND eq.marking_mode = 'comparative'
         JOIN exams e ON e.id = eq.exam_id
         LEFT JOIN comparative_pairs p ON p.question_id = eq.id
         LEFT JOIN comparative_judgements h ON h.pair_id = p.id AND h.source = 'human'
        WHERE ma.teacher_id = :uid AND e.archived_at IS NULL
        GROUP BY e.id, e.name, e.created_at, eq.id, eq.question_number
        ORDER BY e.created_at, eq.question_number`,
      { uid },
    )).rows as { exam_id: string; exam_name: string; question_id: string; question_number: string; pairs_left: string }[];
    const compNext = compRows.find((r) => num(r.pairs_left) > 0) ?? null;

    const summary: Record<string, unknown> = {
      ai: { ai_marked: num(aiRow?.ai_marked) },
      comparative: {
        questions: compRows.length,
        pairs_left: compRows.reduce((a, r) => a + num(r.pairs_left), 0),
        next: compNext
          ? { exam_id: compNext.exam_id, exam_name: compNext.exam_name, question_id: compNext.question_id, question_number: compNext.question_number }
          : null,
      },
      marking,
      exams,
      progress: {
        clips_total: num(progressRow?.clips_total),
        clips_marked: num(progressRow?.clips_marked),
        latest_exam: latest ?? null,
      },
    };

    if (isAdmin) {
      const staff = await db('users').count('id as n').first<{ n: string }>();
      const invites = await db('allowed_emails').count('email as n').first<{ n: string }>();
      summary.admin = { staff: num(staff?.n), pending_invites: num(invites?.n) };
    }

    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

export default router;

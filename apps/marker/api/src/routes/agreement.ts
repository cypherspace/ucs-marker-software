import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireQuestionAccess } from '../services/access.js';
import { agreementState, combineMarks, meanOf, spreadOf, type TeacherMark } from '../services/markCombine.js';
import type { AgreementClip, QuestionAgreement } from '@marker/shared-types';

const router = Router();

// Every teacher's mark for each clip of a question side by side, so the lead teacher can see where they agree and
// differ and what the average is. Lead teacher or admin only (it shows other teachers' marks). Scripts are shown by
// number only, never by student name.
router.get('/exams/:examId/questions/:questionId/agreement', requireAuth, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { leadOnly: true, examId: req.params.examId });
    if (!q) return;
    const exam = await db('exams').where({ id: q.exam_id }).first<{ mark_combine: 'latest' | 'average' | 'lead' }>('mark_combine');

    const rows = await db('script_clips as sc')
      .join('student_scripts as ss', 'ss.id', 'sc.script_id')
      .join('script_marks as sm', function () {
        this.on('sm.clip_id', 'sc.id').andOnVal('sm.mark_source', 'human');
      })
      .leftJoin('users as u', 'u.id', 'sm.marker_id')
      .where('sc.question_id', q.question_id)
      .whereNot('sm.status', 'pending')
      .whereNotNull('sm.marks_awarded')
      .orderBy(['ss.student_number', 'sm.marked_at'])
      .select<{
        clip_id: string; student_number: string; marker_id: string | null; email: string | null; name: string | null;
        marks_awarded: number; marked_at: string | null; status: string;
      }[]>('sc.id as clip_id', 'ss.student_number', 'sm.marker_id', 'u.email', 'u.name', 'sm.marks_awarded', 'sm.marked_at', 'sm.status');

    const byClip = new Map<string, AgreementClip>();
    const teachers = new Map<string, { teacher_id: string; email: string; name: string | null; marked: number }>();
    for (const r of rows) {
      let clip = byClip.get(r.clip_id);
      if (!clip) {
        clip = {
          clip_id: r.clip_id, script: r.student_number, marks: [], mean: null, min: null, max: null, spread: 0,
          state: 'none', moderated: null, combined: null,
        };
        byClip.set(r.clip_id, clip);
      }
      if (r.status === 'moderated') clip.moderated = r.marks_awarded;
      clip.marks.push({ teacher_id: r.marker_id, email: r.email ?? 'unknown', marks: r.marks_awarded, marked_at: r.marked_at });
      if (r.marker_id) {
        const t = teachers.get(r.marker_id) ?? { teacher_id: r.marker_id, email: r.email ?? 'unknown', name: r.name, marked: 0 };
        t.marked += 1;
        teachers.set(r.marker_id, t);
      }
    }

    const clips = [...byClip.values()];
    for (const clip of clips) {
      const values = clip.marks.map((m) => m.marks);
      const mean = meanOf(values);
      clip.mean = mean === null ? null : Math.round(mean * 100) / 100;
      clip.min = values.length ? Math.min(...values) : null;
      clip.max = values.length ? Math.max(...values) : null;
      clip.spread = spreadOf(values);
      clip.state = agreementState(values);
      const teacherMarks: TeacherMark[] = clip.marks.map((m) => ({ teacher_id: m.teacher_id, marks: m.marks, marked_at: m.marked_at }));
      clip.combined = clip.moderated ?? combineMarks(teacherMarks, exam?.mark_combine ?? 'latest', q.lead_teacher_id);
    }

    const multi = clips.filter((c) => c.marks.length >= 2);
    const agreed = multi.filter((c) => c.state === 'agreed').length;
    const result: QuestionAgreement = {
      question_id: q.question_id,
      question_number: q.question_number,
      max_marks: q.max_marks,
      combine: exam?.mark_combine ?? 'latest',
      teachers: [...teachers.values()].sort((a, b) => a.email.localeCompare(b.email)),
      clips,
      stats: {
        clips_marked: clips.length,
        multi_marked: multi.length,
        agreed,
        conflicts: multi.length - agreed,
        agreed_pct: multi.length ? Math.round((agreed / multi.length) * 100) : null,
        mean_spread: multi.length ? Math.round((multi.reduce((a, c) => a + c.spread, 0) / multi.length) * 100) / 100 : null,
      },
    };
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from 'express';
import { db } from '../db.js';
import { exportCsv } from '../services/drive.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

const router = Router();

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// Export marks as CSV. ?names=1 adds student names (de-anonymization JOIN —
// happens only here, in the platform DB; never involves Gemini).
// If the exam uses Drive storage, the CSV is written to the lead teacher's
// Drive and { driveUrl } is returned; otherwise { csv } is returned inline.
router.get('/exams/:id/export', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) { res.status(404).json({ error: 'Exam not found', code: 'NOT_FOUND' }); return; }
    if (req.user!.role !== 'admin' && exam.lead_teacher_id !== req.user!.sub) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
    }

    const includeNames = req.query.names === '1';

    const rows = await db('student_scripts as ss')
      .join('script_clips as sc', 'sc.script_id', 'ss.id')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .leftJoin('script_marks as sm', function () {
        this.on('sm.clip_id', 'sc.id').andOnVal('sm.status', '!=', 'pending');
      })
      .leftJoin('users as u', 'u.id', 'ss.student_id')
      .where('ss.exam_id', req.params.id)
      .orderBy(['ss.student_number', 'eq.question_number'])
      .select(
        'ss.student_number',
        'u.name as student_name',
        'eq.question_number',
        'eq.max_marks',
        'sm.marks_awarded',
        'sm.mark_source',
        'sm.ai_feedback',
      );

    const header = includeNames
      ? ['student_number', 'student_name', 'question', 'max_marks', 'marks_awarded', 'mark_source', 'ai_feedback']
      : ['student_number', 'question', 'max_marks', 'marks_awarded', 'mark_source', 'ai_feedback'];

    const lines = [header.join(',')];
    for (const r of rows) {
      const cells = includeNames
        ? [r.student_number, r.student_name, r.question_number, r.max_marks, r.marks_awarded, r.mark_source, r.ai_feedback]
        : [r.student_number, r.question_number, r.max_marks, r.marks_awarded, r.mark_source, r.ai_feedback];
      lines.push(cells.map(csvEscape).join(','));
    }
    const csv = lines.join('\n') + '\n';

    const filename = `${exam.name.replaceAll(/[^\w\- ]+/g, '')} results${includeNames ? ' (named)' : ''}.csv`;

    if (exam.use_drive_storage && exam.drive_folder_id) {
      try {
        const driveUrl = await exportCsv(exam.lead_teacher_id, exam.drive_folder_id, filename, csv);
        res.json({ data: { driveUrl } });
        return;
      } catch (err) {
        console.warn('[drive] CSV export to Drive failed, returning inline:', (err as Error).message);
      }
    }

    res.json({ data: { csv } });
  } catch (err) {
    next(err);
  }
});

export default router;

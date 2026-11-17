import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireExamMember, requireQuestionAccess } from '../services/access.js';
import { recordAudit } from '../services/audit.js';
import { OverlaySchema } from '../services/overlay.js';
import { normaliseQuestionLabel, sortByQuestionLabel } from '../services/questionLabel.js';
import type { OverlayData, OverlayListItem } from '@marker/shared-types';

// Tracing-paper overlays: the correct graph or picture, drawn once per question and laid over each candidate's answer
// while marking. Any teacher who may work on a question (an admin, the lead teacher or an assigned teacher) can
// create, change or remove its overlay, and copy one from another question they can work on.
const router = Router();
const staff = [requireAuth, requireRole(['teacher', 'admin'])];

// The questions of this exam that have an overlay and that this person may work on (to copy from)
router.get('/exams/:examId/overlays', ...staff, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.examId);
    if (!access) return;
    const rows = await db('exam_questions')
      .where({ exam_id: req.params.examId }).whereNotNull('overlay_data')
      .select<{ id: string; question_number: string; overlay_data: OverlayData }[]>('id', 'question_number', 'overlay_data');
    const allowed = access.isLead ? rows : rows.filter((r) => access.assignedQuestionIds.includes(r.id));
    const items: OverlayListItem[] = sortByQuestionLabel(allowed.map((r) => ({ ...r, question_number: r.question_number })))
      .map((r) => ({ question_id: r.id, question_number: normaliseQuestionLabel(r.question_number), shapes: r.overlay_data.shapes.length }));
    res.json({ data: items });
  } catch (err) { next(err); }
});

router.get('/exams/:examId/questions/:questionId/overlay', ...staff, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!q) return;
    const row = await db('exam_questions').where({ id: q.question_id }).first<{ overlay_data: OverlayData | null }>('overlay_data');
    res.json({ data: row?.overlay_data ?? null });
  } catch (err) { next(err); }
});

router.put('/exams/:examId/questions/:questionId/overlay', ...staff, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!q) return;
    const body = OverlaySchema.parse(req.body);
    await db('exam_questions').where({ id: q.question_id }).update({ overlay_data: JSON.stringify(body) });
    await recordAudit(req, 'question.overlay_saved', 'question', q.question_id, { question_number: q.question_number, shapes: body.shapes.length });
    res.json({ data: body });
  } catch (err) { next(err); }
});

router.delete('/exams/:examId/questions/:questionId/overlay', ...staff, async (req, res, next) => {
  try {
    const q = await requireQuestionAccess(req, res, req.params.questionId, { examId: req.params.examId });
    if (!q) return;
    await db('exam_questions').where({ id: q.question_id }).update({ overlay_data: null });
    await recordAudit(req, 'question.overlay_removed', 'question', q.question_id, { question_number: q.question_number });
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { shownEmail, shownName } from '../services/hiddenStaff.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireExamMember } from '../services/access.js';
import { recordAudit } from '../services/audit.js';
import { finalMarks } from '../services/finalMark.js';
import { isMarkCombine, type MarkCombine } from '../services/markCombine.js';
import { compareQuestionLabels, normaliseQuestionLabel } from '../services/questionLabel.js';
import { toCsv } from '../services/resultsCsv.js';
import {
  analyse, answersCsvRows, buildRow, filterRows, notesOf, questionsCsvRows, ticksMark,
  type AnswerInput, type AnswerRow, type ComparisonFilters, type TeacherEntry,
} from '../services/aiComparison.js';

// How the AI's marks compare with the teachers': lead teacher or admin only. Built from data already held (the
// teachers' marks, their ticks and notes, the AI's marks and reasoning); nothing is sent to the AI.
const router = Router();

const QuerySchema = z.object({
  combine: z.string().optional(),
  class: z.string().optional(),
  no_class: z.string().optional(),
  question_ids: z.string().optional(),
  exclude_conflicts: z.string().optional(),
  min_gap: z.coerce.number().int().min(0).max(100).optional(),
});

async function loadRows(examId: string, defaultCombine: MarkCombine, q: z.infer<typeof QuerySchema>) {
  const combine: MarkCombine = isMarkCombine(q.combine) ? q.combine : defaultCombine;
  const clips = await db('script_clips as sc')
    .join('student_scripts as ss', 'ss.id', 'sc.script_id')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .join('script_marks as ai', function joinAi() { this.on('ai.clip_id', 'sc.id').andOn(db.raw("ai.mark_source = 'ai'")); })
    .leftJoin(finalMarks('fm', combine, true), 'fm.clip_id', 'sc.id')
    .where('eq.exam_id', examId).where('eq.marking_mode', 'marks')
    .whereNotNull('ai.marks_awarded')
    .select<{
      clip_id: string; script_id: string; student_number: string; class_group: string | null; question_id: string;
      question_number: string; max_marks: number; has_converted: boolean; teacher_mark: number | null;
      ai_mark: number; ai_reasoning: string | null; ai_feedback: string | null;
    }[]>(
      'sc.id as clip_id', 'sc.script_id', 'ss.student_number', 'ss.class_group', 'eq.id as question_id', 'eq.question_number', 'eq.max_marks',
      db.raw('(sc.text_image_url IS NOT NULL) AS has_converted'),
      'fm.marks_awarded as teacher_mark', 'ai.marks_awarded as ai_mark', 'ai.ai_reasoning', 'ai.ai_feedback',
    );

  const humans = await db('script_marks as sm')
    .join('script_clips as sc', 'sc.id', 'sm.clip_id')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .leftJoin('users as u', 'u.id', 'sm.marker_id')
    .where('eq.exam_id', examId).where('sm.mark_source', 'human')
    .where('sm.status', '<>', 'pending').whereNotNull('sm.marks_awarded')
    .select<{ clip_id: string; marker_id: string | null; name: string | null; email: string | null; marks_awarded: number; annotation_data: unknown }[]>(
      'sm.clip_id', 'sm.marker_id', db.raw(`${shownName()} AS name`), db.raw(`${shownEmail()} AS email`), 'sm.marks_awarded', 'sm.annotation_data',
    );
  const byClip = new Map<string, TeacherEntry[]>();
  for (const h of humans) {
    const ticked = ticksMark(h.annotation_data as never);
    const entry: TeacherEntry = {
      teacher_id: h.marker_id, teacher: h.name || h.email || 'A teacher', marks: h.marks_awarded,
      typed_differs: ticked !== null && ticked !== h.marks_awarded, notes: notesOf(h.annotation_data as never),
    };
    byClip.set(h.clip_id, [...(byClip.get(h.clip_id) ?? []), entry]);
  }

  const inputs: AnswerInput[] = clips.map((c) => ({
    clip_id: c.clip_id, script_id: c.script_id, student_number: c.student_number, class_group: c.class_group,
    question_id: c.question_id, question_label: normaliseQuestionLabel(c.question_number), max_marks: c.max_marks,
    teacher_mark: c.teacher_mark, teachers: byClip.get(c.clip_id) ?? [], ai_mark: c.ai_mark,
    ai_reasoning: c.ai_reasoning, ai_feedback: c.ai_feedback, has_converted: Boolean(c.has_converted),
  }));
  const rows = inputs.map(buildRow).sort((a, b) =>
    a.student_number.localeCompare(b.student_number, undefined, { numeric: true }) || compareQuestionLabels(a.question_label, b.question_label));

  const filters: ComparisonFilters = {
    class_group: q.no_class ? '' : q.class || undefined,
    question_ids: q.question_ids ? q.question_ids.split(',').filter(Boolean) : undefined,
    exclude_conflicts: q.exclude_conflicts === '1',
    min_gap: q.min_gap,
  };
  return { combine, rows: filterRows(rows, filters), all: rows };
}

router.get('/exams/:id/ai-comparison', requireAuth, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id, { leadOnly: true });
    if (!access) return;
    const q = QuerySchema.parse(req.query);
    const { combine, rows, all } = await loadRows(access.exam.id, access.exam.mark_combine, q);
    const analysis = analyse(rows, compareQuestionLabels);
    // The reasoning and feedback text is only sent for answers where the AI and the teachers differ (that is what
    // is reviewed); a long class of exact matches would otherwise make the response large.
    const slim: AnswerRow[] = rows.map((r) => (r.gap === 0 ? { ...r, ai_reasoning: null, ai_feedback: null } : r));
    res.json({ data: {
      combine,
      classes: [...new Set(all.map((r) => r.class_group ?? ''))].sort(),
      questions: [...new Map(all.map((r) => [r.question_id, { id: r.question_id, label: r.question_label, max_marks: r.max_marks }])).values()]
        .sort((a, b) => compareQuestionLabels(a.label, b.label)),
      analysis,
      rows: slim,
    } });
  } catch (err) { next(err); }
});

// The same answers as a CSV: one row per answer with the reasons, or one row per question
router.get('/exams/:id/ai-comparison/export', requireAuth, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id, { leadOnly: true });
    if (!access) return;
    const q = QuerySchema.parse(req.query);
    const format = req.query.format === 'questions' ? 'questions' : 'answers';
    const { combine, rows } = await loadRows(access.exam.id, access.exam.mark_combine, q);
    const csv = toCsv(format === 'questions' ? questionsCsvRows(analyse(rows, compareQuestionLabels)) : answersCsvRows(rows));
    const filename = `${access.exam.name.replaceAll(/[^\w\- ]+/g, '')} AI vs teachers${format === 'questions' ? ' by question' : ''}.csv`;
    // The export holds the AI's reasoning, teachers' notes and marks, so it is recorded
    await recordAudit(req, 'ai.comparison_exported', 'exam', access.exam.id, { format, rows: rows.length, combine });
    res.json({ data: { csv, filename } });
  } catch (err) { next(err); }
});

export default router;

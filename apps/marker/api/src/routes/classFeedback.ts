import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireExamMember } from '../services/access.js';
import { aiOverallThemes, aiQuestionThemes, failureOf } from '../services/ai.js';
import { failureBody } from '../services/aiErrors.js';
import { recordAudit } from '../services/audit.js';
import { describeExtractorFailure, extractorFetch } from '../services/extractor.js';
import { finalMarks } from '../services/finalMark.js';
import { isMarkCombine, type MarkCombine } from '../services/markCombine.js';
import { compareQuestionLabels, normaliseQuestionLabel } from '../services/questionLabel.js';
import { classFigures, reportBlocks, type MarkRow, type Overall, type Themes } from '../services/classReport.js';
import { safeFilePart } from '../services/scriptExport.js';

// What a whole paper says about the class (lead teacher / admin): per-question figures and charts from the marks that
// count, and, if asked, strengths and weaknesses written by the AI from the feedback it gave (text only, no names).
const router = Router();
const aiConfigured = () => config.aiStub || Boolean(config.googleApiKey);

const ScopeSchema = z.object({
  class: z.string().max(50).optional(),
  no_class: z.union([z.boolean(), z.string()]).optional(),
  combine: z.string().optional(),
});
type Scope = z.infer<typeof ScopeSchema>;

const classFilter = (s: Scope): string | undefined => (s.no_class === true || s.no_class === '1' ? '' : s.class || undefined);

async function loadRows(examId: string, defaultCombine: MarkCombine, s: Scope) {
  const combine: MarkCombine = isMarkCombine(s.combine) ? s.combine : defaultCombine;
  const only = classFilter(s);
  const rows = await db('script_clips as sc')
    .join('student_scripts as ss', 'ss.id', 'sc.script_id')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .join(finalMarks('fm', combine), 'fm.clip_id', 'sc.id')
    .where('eq.exam_id', examId).where('eq.marking_mode', 'marks')
    .whereNotNull('fm.marks_awarded')
    .modify((qb) => { if (only !== undefined) { if (only === '') qb.whereNull('ss.class_group'); else qb.where('ss.class_group', only); } })
    .select<{ script_id: string; class_group: string | null; question_id: string; question_number: string; max_marks: number; mark: number; mark_source: string }[]>(
      'sc.script_id', 'ss.class_group', 'eq.id as question_id', 'eq.question_number', 'eq.max_marks', 'fm.marks_awarded as mark', 'fm.mark_source',
    );
  const marks: MarkRow[] = rows.map((r) => ({
    script_id: r.script_id, class_group: r.class_group, question_id: r.question_id, label: normaliseQuestionLabel(r.question_number),
    max_marks: r.max_marks, mark: r.mark, ai_only: r.mark_source === 'ai',
  }));
  return { combine, marks, figures: classFigures(marks, compareQuestionLabels) };
}

// The AI's feedback comments on one question within the scope (lowest marks first so weaknesses are not crowded out)
async function commentsFor(questionId: string, s: Scope): Promise<string[]> {
  const only = classFilter(s);
  const rows = await db('script_clips as sc')
    .join('student_scripts as ss', 'ss.id', 'sc.script_id')
    .join('script_marks as ai', function joinAi() { this.on('ai.clip_id', 'sc.id').andOn(db.raw("ai.mark_source = 'ai'")); })
    .where('sc.question_id', questionId)
    .whereRaw("btrim(coalesce(ai.ai_feedback, '')) <> ''")
    .modify((qb) => { if (only !== undefined) { if (only === '') qb.whereNull('ss.class_group'); else qb.where('ss.class_group', only); } })
    .orderBy('ai.marks_awarded', 'asc')
    .limit(60)
    .select<{ ai_feedback: string }[]>('ai.ai_feedback');
  return rows.map((r) => r.ai_feedback);
}

router.get('/exams/:id/class-feedback', requireAuth, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id, { leadOnly: true });
    if (!access) return;
    const scope = ScopeSchema.parse(req.query);
    const { combine, figures } = await loadRows(access.exam.id, access.exam.mark_combine, scope);
    const all = await db('script_clips as sc')
      .join('student_scripts as ss', 'ss.id', 'sc.script_id').join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .where('eq.exam_id', access.exam.id).distinct('ss.class_group').select<{ class_group: string | null }[]>('ss.class_group');
    const withFeedback = await db('script_clips as sc')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .join('script_marks as ai', function joinAi() { this.on('ai.clip_id', 'sc.id').andOn(db.raw("ai.mark_source = 'ai'")); })
      .where('eq.exam_id', access.exam.id).whereRaw("btrim(coalesce(ai.ai_feedback, '')) <> ''")
      .groupBy('sc.question_id').select<{ question_id: string; n: string }[]>('sc.question_id', db.raw('COUNT(*) AS n'));
    res.json({ data: {
      combine, figures,
      classes: [...new Set(all.map((r) => r.class_group ?? ''))].sort(),
      feedback_counts: Object.fromEntries(withFeedback.map((r) => [r.question_id, Number(r.n)])),
      ai_configured: aiConfigured(),
    } });
  } catch (err) { next(err); }
});

// Themes for a few questions at a time; the browser drives this in steps (one Gemini request per question).
router.post('/exams/:id/class-feedback/themes', requireAuth, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id, { leadOnly: true });
    if (!access) return;
    if (!aiConfigured()) { res.status(503).json({ error: 'AI is not set up on this server (no Gemini key).', code: 'AI_NOT_CONFIGURED' }); return; }
    const body = ScopeSchema.extend({ question_ids: z.array(z.string().uuid()).min(1).max(6) }).parse(req.body);
    const { figures } = await loadRows(access.exam.id, access.exam.mark_combine, body);
    const byId = new Map(figures.by_question.map((q) => [q.question_id, q]));
    const results = await Promise.all(body.question_ids.map(async (qid) => {
      const q = byId.get(qid);
      if (!q) return { question_id: qid, ok: true as const, strengths: [] as string[], weaknesses: [] as string[], skipped: 'no_marks' };
      const comments = await commentsFor(qid, body);
      if (comments.length === 0) return { question_id: qid, ok: true as const, strengths: [], weaknesses: [], skipped: 'no_feedback' };
      try {
        const t = await aiQuestionThemes({ label: q.label, max_marks: q.max_marks, facility_pct: q.facility_pct, n: q.n }, comments);
        return { question_id: qid, ok: true as const, ...t };
      } catch (err) {
        const f = failureOf(err);
        console.error(`Class themes failed for question ${qid} [${f.code}]:`, f.message);
        return { question_id: qid, ok: false as const, ...failureBody(f) };
      }
    }));
    res.json({ data: { results } });
  } catch (err) { next(err); }
});

const ThemesInput = z.array(z.object({
  question_id: z.string().uuid(),
  strengths: z.array(z.string().max(400)).max(6),
  weaknesses: z.array(z.string().max(400)).max(6),
})).max(200);

router.post('/exams/:id/class-feedback/overall', requireAuth, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id, { leadOnly: true });
    if (!access) return;
    if (!aiConfigured()) { res.status(503).json({ error: 'AI is not set up on this server (no Gemini key).', code: 'AI_NOT_CONFIGURED' }); return; }
    const body = ScopeSchema.extend({ themes: ThemesInput }).parse(req.body);
    const { figures } = await loadRows(access.exam.id, access.exam.mark_combine, body);
    const themes = new Map(body.themes.map((t) => [t.question_id, t]));
    try {
      const out = await aiOverallThemes({
        scripts: figures.scripts, overall_pct: figures.overall_pct,
        questions: figures.by_question.map((q) => ({
          label: q.label, max_marks: q.max_marks, facility_pct: q.facility_pct,
          strengths: themes.get(q.question_id)?.strengths ?? [], weaknesses: themes.get(q.question_id)?.weaknesses ?? [],
        })),
      });
      res.json({ data: out });
    } catch (err) {
      const f = failureOf(err);
      console.error(`Class overall themes failed [${f.code}]:`, f.message);
      res.status(f.retryable ? 503 : 502).json(failureBody(f));
    }
  } catch (err) { next(err); }
});

// The report as a PDF with charts. The figures are worked out here again (never taken from the browser); only the
// AI-written themes, which the teacher may have read and kept, come from the request.
router.post('/exams/:id/class-feedback/report.pdf', requireAuth, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id, { leadOnly: true });
    if (!access) return;
    const body = ScopeSchema.extend({
      themes: ThemesInput.optional(),
      overall: z.object({
        strengths: z.array(z.string().max(400)).max(6), weaknesses: z.array(z.string().max(400)).max(6), next_steps: z.array(z.string().max(400)).max(6),
      }).optional(),
    }).parse(req.body ?? {});
    const { figures } = await loadRows(access.exam.id, access.exam.mark_combine, body);
    if (figures.scripts === 0) { res.status(404).json({ error: 'Nothing has been marked for this selection yet.', code: 'NOTHING_MARKED' }); return; }
    const only = classFilter(body);
    const scopeLabel = only === undefined ? '' : only === '' ? ', scripts with no class' : `, class ${only}`;
    const themes = new Map<string, Themes>((body.themes ?? []).map((t) => [t.question_id, { strengths: t.strengths, weaknesses: t.weaknesses }]));
    const overall: Overall | null = body.overall ?? null;
    const blocks = reportBlocks(figures, `${access.exam.name}${scopeLabel}`, themes, overall);
    let resp: Awaited<ReturnType<typeof extractorFetch>>;
    try {
      resp = await extractorFetch('/text-document', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Class feedback summary', blocks }),
      });
    } catch (err) {
      res.status(502).json({ error: `Could not reach the PDF maker: ${describeExtractorFailure(err)}`, code: 'EXTRACTOR_UNREACHABLE' }); return;
    }
    if (!resp.ok) { res.status(502).json({ error: `The PDF could not be made (${resp.status})`, code: 'EXPORT_FAILED' }); return; }
    await recordAudit(req, 'class_feedback.exported', 'exam', access.exam.id, { class: only ?? null, with_themes: Boolean(overall || themes.size) });
    const filename = `${safeFilePart(`${access.exam.name}${scopeLabel}`)} class feedback summary.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(await resp.arrayBuffer()));
  } catch (err) { next(err); }
});

export default router;

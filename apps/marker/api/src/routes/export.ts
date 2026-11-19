import { Router } from 'express';
import { exportCsv } from '../services/drive.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireExamMember } from '../services/access.js';
import { isMarkCombine, type MarkCombine } from '../services/markCombine.js';
import { db } from '../db.js';
import { computeRanking } from '../services/rankingData.js';
import { classFilterFrom, loadResultRows, scopeFor, type ResultRow } from '../services/results.js';
import { buildResultsTable } from '../services/resultsTable.js';
import { detailedCsv, overviewCsv } from '../services/resultsCsv.js';
import { recordAudit } from '../services/audit.js';

const router = Router();

// ?combine=latest|average|lead overrides how the exam combines several teachers' marks, for this request only
const combineFrom = (q: unknown, fallback: MarkCombine): MarkCombine => (isMarkCombine(q) ? q : fallback);

// Results for the people who may see them. The lead teacher and admins see every class and question; any
// other teacher on the exam sees the scripts they uploaded plus the questions they were asked to mark.
// ?class=10A or ?no_class=1 narrows it to one class.
router.get('/exams/:id/results', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id);
    if (!access) return;
    const scope = scopeFor(access, req.user!.sub);

    // The class list always covers everything this person can see, so the filter does not shrink itself
    const combine = combineFrom(req.query.combine, access.exam.mark_combine);
    const everything = await loadResultRows(req.params.id, scope, {}, combine);
    const rows = Object.keys(classFilterFrom(req.query)).length ? await loadResultRows(req.params.id, scope, classFilterFrom(req.query), combine) : everything;

    const data = buildResultsTable(everything, rows, scope.all);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// Export marks as CSV, for the same people and the same scripts as the Results page.
//   ?format=overview (the default) is the marks-by-script table: one row per script, one column per question, then totals.
//   ?format=detailed is one row per script and question, for pivot tables (?per_teacher=1 implies it and adds a column per teacher).
// ?names=1 adds student names (de-anonymization JOIN, lead teacher or admin only; happens only here, in the platform DB, never
// involves Gemini, and is recorded in the audit log). If the exam uses Drive storage, a lead teacher's CSV is written to their
// Drive and { driveUrl } is returned; otherwise { csv, filename } is returned inline.
router.get('/exams/:id/export', requireAuth, requireRole(['teacher', 'admin']), async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id);
    if (!access) return;
    const includeNames = req.query.names === '1';
    if (includeNames && !access.isLead) {
      res.status(403).json({ error: 'Only the lead teacher or an admin can export student names', code: 'FORBIDDEN' }); return;
    }
    const cls = classFilterFrom(req.query);
    const combine = combineFrom(req.query.combine, access.exam.mark_combine);
    const perTeacher = req.query.per_teacher === '1';
    if (perTeacher && !access.isLead) {
      res.status(403).json({ error: 'Only the lead teacher or an admin can export every teacher\'s marks', code: 'FORBIDDEN' }); return;
    }
    const format: 'overview' | 'detailed' = perTeacher || req.query.format === 'detailed' ? 'detailed' : 'overview';
    const scope = scopeFor(access, req.user!.sub);
    const rows: ResultRow[] = await loadResultRows(req.params.id, scope, cls, combine);

    // Comparative questions are ranked rather than marked: rank and score come from the ranking, keyed by clip
    const comparativeIds = [...new Set(rows.filter((r) => r.marking_mode === 'comparative').map((r) => r.question_id))];
    const ranksByClip = new Map<string, { rank: number; score: number }>();
    for (const qid of comparativeIds) {
      for (const r of (await computeRanking(qid)).ranked) ranksByClip.set(r.clip_id, { rank: r.rank, score: r.score });
    }

    let csv: string;
    if (format === 'overview') {
      const everything = Object.keys(cls).length ? await loadResultRows(req.params.id, scope, {}, combine) : rows;
      const table = buildResultsTable(everything, rows, scope.all);
      const names = includeNames ? new Map(rows.map((r) => [r.script_id, r.student_name] as const)) : undefined;
      const ranks = new Map(rows.filter((r) => ranksByClip.has(r.clip_id)).map((r) => [`${r.script_id}:${r.question_id}`, ranksByClip.get(r.clip_id)!] as const));
      csv = overviewCsv(table, { names, ranks });
    } else {
      // Every teacher's own mark for each clip, one column per teacher (lead teacher or admin only)
      const teacherCols: { id: string; email: string }[] = [];
      const teacherMarks = new Map<string, Map<string, number>>(); // clip id -> teacher id -> mark
      if (perTeacher && rows.length) {
        const found = await db('script_marks as sm').join('users as u', 'u.id', 'sm.marker_id')
          .whereIn('sm.clip_id', rows.map((r) => r.clip_id))
          .where({ 'sm.mark_source': 'human' }).whereNot('sm.status', 'pending').whereNotNull('sm.marks_awarded')
          .select<{ clip_id: string; marker_id: string; email: string; marks_awarded: number }[]>('sm.clip_id', 'sm.marker_id', 'u.email', 'sm.marks_awarded');
        for (const f of found) {
          if (!teacherCols.some((t) => t.id === f.marker_id)) teacherCols.push({ id: f.marker_id, email: f.email });
          if (!teacherMarks.has(f.clip_id)) teacherMarks.set(f.clip_id, new Map());
          teacherMarks.get(f.clip_id)!.set(f.marker_id, f.marks_awarded);
        }
        teacherCols.sort((a, b) => a.email.localeCompare(b.email));
      }
      csv = detailedCsv(rows, {
        includeNames, ranks: ranksByClip,
        perTeacher: perTeacher ? { cols: teacherCols, marks: teacherMarks } : undefined,
      });
    }

    const exam = access.exam;
    const which = cls.none ? ' - no class' : cls.name ? ` - ${cls.name.replaceAll(/[^\w\- ]+/g, '')}` : '';
    const kind = perTeacher ? ' (every teacher)' : format === 'detailed' ? ' (detailed)' : '';
    const filename = `${exam.name.replaceAll(/[^\w\- ]+/g, '')} results${which}${kind}${includeNames ? ' (named)' : ''}.csv`;

    // Names and other teachers' marks leave the platform here, so the export is recorded
    if (includeNames || perTeacher) {
      await recordAudit(req, includeNames ? 'results.export_named' : 'results.export_per_teacher', 'exam', exam.id, { format, class: cls.name ?? (cls.none ? '(none)' : null) });
    }

    // Only the lead teacher's export goes into the lead teacher's Drive; everyone else gets the file directly
    if (access.isLead && exam.drive_folder_id) {
      try {
        const driveUrl = await exportCsv(exam.lead_teacher_id, exam.drive_folder_id, filename, csv);
        res.json({ data: { driveUrl } });
        return;
      } catch (err) {
        console.warn('[drive] CSV export to Drive failed, returning inline:', (err as Error).message);
      }
    }

    res.json({ data: { csv, filename } });
  } catch (err) {
    next(err);
  }
});

export default router;

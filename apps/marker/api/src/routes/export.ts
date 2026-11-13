import { Router } from 'express';
import { exportCsv } from '../services/drive.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireExamMember } from '../services/access.js';
import { isMarkCombine, type MarkCombine } from '../services/markCombine.js';
import { db } from '../db.js';
import { computeRanking } from '../services/rankingData.js';
import { classFilterFrom, loadResultRows, scopeFor, type ResultRow } from '../services/results.js';
import type { ExamResults, ResultsRow } from '@marker/shared-types';
import { sortByQuestionLabel } from '../services/questionLabel.js';

const router = Router();

// ?combine=latest|average|lead overrides how the exam combines several teachers' marks, for this request only
const combineFrom = (q: unknown, fallback: MarkCombine): MarkCombine => (isMarkCombine(q) ? q : fallback);

// The per-teacher cells of a CSV row: each teacher's mark, then the mean and whether they differ
function teacherExtras(cols: { id: string }[], marks: Map<string, number> | undefined): (number | string | null)[] {
  const values = marks ? [...marks.values()] : [];
  const mean = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;
  return [...cols.map((t) => marks?.get(t.id) ?? null), mean, values.length > 1 ? (Math.max(...values) !== Math.min(...values) ? 'yes' : 'no') : ''];
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

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

    const classScripts = new Map<string | null, Set<string>>();
    for (const r of everything) {
      if (!classScripts.has(r.class_group)) classScripts.set(r.class_group, new Set());
      classScripts.get(r.class_group)!.add(r.script_id);
    }
    const classes = [...classScripts.entries()]
      .map(([name, set]) => ({ name, scripts: set.size }))
      .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : byNumber(a.name, b.name)));

    const questionMap = new Map<string, ExamResults['questions'][number]>();
    for (const r of everything) {
      questionMap.set(r.question_id, {
        id: r.question_id, question_number: r.question_number, max_marks: r.max_marks,
        marking_mode: r.marking_mode as 'marks' | 'comparative',
      });
    }
    const questions = sortByQuestionLabel([...questionMap.values()]);

    const byScript = new Map<string, ResultsRow>();
    for (const r of rows) {
      let row = byScript.get(r.script_id);
      if (!row) {
        row = { script_id: r.script_id, student_number: r.student_number, class_group: r.class_group, cells: {}, total: 0, possible: 0 };
        byScript.set(r.script_id, row);
      }
      row.cells[r.question_id] = {
        marks: r.marks_awarded, source: (r.mark_source as 'human' | 'ai' | null), ai_marks: r.ai_marks_awarded,
      };
      if (r.marking_mode === 'marks' && r.marks_awarded !== null) {
        row.total += r.marks_awarded;
        row.possible += r.max_marks;
      }
    }

    const stats = questions.map((q) => {
      const cells = rows.filter((r) => r.question_id === q.id);
      const marks = cells.map((r) => r.marks_awarded).filter((m): m is number => m !== null);
      return {
        question_id: q.id,
        scripts: cells.length,
        marked: marks.length,
        mean: marks.length ? Math.round((marks.reduce((a, b) => a + b, 0) / marks.length) * 100) / 100 : null,
        min: marks.length ? Math.min(...marks) : null,
        max: marks.length ? Math.max(...marks) : null,
      };
    });

    const data: ExamResults = {
      scope: scope.all ? 'all' : 'limited',
      classes,
      questions,
      rows: [...byScript.values()].sort((a, b) => byNumber(a.student_number, b.student_number)),
      stats,
    };
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// Export marks as CSV, for the same people and the same scripts as the Results page. ?names=1 adds student
// names (de-anonymization JOIN, lead teacher or admin only; happens only here, in the platform DB, never
// involves Gemini). If the exam uses Drive storage, a lead teacher's CSV is written to their Drive and
// { driveUrl } is returned; otherwise { csv } is returned inline.
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
    const rows: ResultRow[] = await loadResultRows(req.params.id, scopeFor(access, req.user!.sub), cls, combine);

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

    // Comparative questions are ranked rather than marked: add rank and score columns.
    const comparativeIds = [...new Set(rows.filter((r) => r.marking_mode === 'comparative').map((r) => r.question_id))];
    const ranks = new Map<string, { rank: number; score: number }>();
    for (const qid of comparativeIds) {
      for (const r of (await computeRanking(qid)).ranked) ranks.set(r.clip_id, { rank: r.rank, score: r.score });
    }
    const withRank = comparativeIds.length > 0;

    const header = [
      'student_number', ...(includeNames ? ['student_name'] : []), 'class',
      'question', 'max_marks', 'marks_awarded', 'mark_source', 'ai_marks_awarded', 'ai_feedback',
      ...(withRank ? ['rank', 'score'] : []),
      ...(perTeacher ? [...teacherCols.map((t) => `mark_${t.email}`), 'teacher_mean', 'teachers_differ'] : []),
    ];

    const lines = [header.join(',')];
    for (const r of rows) {
      const rk = ranks.get(r.clip_id);
      const cells = [
        r.student_number, ...(includeNames ? [r.student_name] : []), r.class_group,
        r.question_number, r.max_marks, r.marks_awarded, r.mark_source, r.ai_marks_awarded, r.ai_feedback,
        ...(withRank ? [rk?.rank, rk?.score] : []),
        ...(perTeacher ? teacherExtras(teacherCols, teacherMarks.get(r.clip_id)) : []),
      ];
      lines.push(cells.map(csvEscape).join(','));
    }
    const csv = lines.join('\n') + '\n';

    const exam = access.exam;
    const which = cls.none ? ' - no class' : cls.name ? ` - ${cls.name.replaceAll(/[^\w\- ]+/g, '')}` : '';
    const filename = `${exam.name.replaceAll(/[^\w\- ]+/g, '')} results${which}${includeNames ? ' (named)' : ''}.csv`;

    // Only the lead teacher's export goes into the lead teacher's Drive; everyone else gets the file directly
    if (access.isLead && exam.use_drive_storage && exam.drive_folder_id) {
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

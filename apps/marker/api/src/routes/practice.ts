import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireExamMember } from '../services/access.js';
import { finalMarks } from '../services/finalMark.js';
import { compareStats, histogram, newLinkToken, sampleClips, shuffled, type EligibleClip } from '../services/practice.js';
import { normaliseQuestionLabel as questionLabel } from '../services/questionLabel.js';
import type { MarkCombine } from '../services/markCombine.js';
import type { PracticeItemInfo, PracticeLinkInfo, PracticeResults, PracticeSetDetail, PracticeSetSummary } from '@marker/shared-types';

// The teacher side of practice marking: choose already-marked clips into a set, share a link per class, and see how
// students' marks compare with the teachers'. Lead teacher or admin of the exam only (it shows student names).
const router = Router();
const staff = [requireAuth, requireRole(['teacher', 'admin'])];

function publicBase(req: Request): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${proto}://${host}`;
}

interface SetRow {
  id: string; exam_id: string; name: string; created_at: string; closed_at: string | null; show_mark_scheme: boolean;
  items: string; links: string; students: string; submitted: string;
}

const SET_SELECT = `
  SELECT ps.id, ps.exam_id, ps.name, ps.created_at, ps.closed_at, ps.show_mark_scheme,
    (SELECT COUNT(*) FROM practice_set_items pi WHERE pi.set_id = ps.id) AS items,
    (SELECT COUNT(*) FROM practice_links pl WHERE pl.set_id = ps.id AND pl.revoked_at IS NULL) AS links,
    (SELECT COUNT(DISTINCT pe.student_id) FROM practice_enrolments pe JOIN practice_links pl ON pl.id = pe.link_id WHERE pl.set_id = ps.id) AS students,
    (SELECT COUNT(*) FROM student_marks sm JOIN practice_set_items pi ON pi.id = sm.item_id WHERE pi.set_id = ps.id) AS submitted
  FROM practice_sets ps`;

const toSummary = (r: SetRow): PracticeSetSummary => ({
  id: r.id, exam_id: r.exam_id, name: r.name, created_at: r.created_at, closed_at: r.closed_at, show_mark_scheme: r.show_mark_scheme,
  items: Number(r.items), links: Number(r.links), students: Number(r.students), submitted: Number(r.submitted),
});

// A set, and the access of its exam's lead teacher (or an admin)
async function loadSet(req: Request, res: Response, setId: string) {
  const row = (await db.raw(`${SET_SELECT} WHERE ps.id = ?`, [setId])).rows[0] as SetRow | undefined;
  if (!row) { res.status(404).json({ error: 'Set not found', code: 'NOT_FOUND' }); return null; }
  const access = await requireExamMember(req, res, row.exam_id, { leadOnly: true });
  if (!access) return null;
  return { set: toSummary(row), access };
}

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  question_ids: z.array(z.string().uuid()).min(1).max(40),
  per_question: z.number().int().min(1).max(50).default(10),
  only_settled: z.boolean().default(true),
  show_mark_scheme: z.boolean().default(true),
});

// Clips with a teacher's mark (never an AI mark), for marks-mode questions of this exam
async function eligibleClips(examId: string, questionIds: string[], combine: MarkCombine): Promise<EligibleClip[]> {
  const rows = await db('script_clips as sc')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .join(finalMarks('fm', combine, true), 'fm.clip_id', 'sc.id')
    .where('eq.exam_id', examId)
    .whereIn('eq.id', questionIds)
    .where('eq.marking_mode', 'marks')
    .select<{ clip_id: string; question_id: string; reference: number; distinct_marks: number; moderated: boolean }[]>(
      'sc.id as clip_id', 'sc.question_id', 'fm.marks_awarded as reference',
      db.raw(`(SELECT COUNT(DISTINCT hm.marks_awarded)::int FROM script_marks hm
                WHERE hm.clip_id = sc.id AND hm.mark_source = 'human' AND hm.status <> 'pending'
                  AND hm.marks_awarded IS NOT NULL) AS distinct_marks`),
      db.raw(`EXISTS (SELECT 1 FROM script_marks mm WHERE mm.clip_id = sc.id AND mm.status = 'moderated') AS moderated`),
    );
  return rows;
}

router.post('/exams/:id/practice-sets', ...staff, async (req, res, next) => {
  try {
    const access = await requireExamMember(req, res, req.params.id, { leadOnly: true });
    if (!access) return;
    const body = CreateSchema.parse(req.body);
    const valid = await db('exam_questions').where({ exam_id: req.params.id, marking_mode: 'marks' }).whereIn('id', body.question_ids).select<{ id: string }[]>('id');
    if (valid.length !== new Set(body.question_ids).size) {
      res.status(400).json({ error: 'Choose questions from this exam that are marked with marks (not ranked by comparison)', code: 'INVALID_QUESTION' }); return;
    }
    const eligible = await eligibleClips(req.params.id, body.question_ids, access.exam.mark_combine);
    const picked = shuffled(sampleClips(eligible, body.per_question, body.only_settled));
    if (picked.length === 0) {
      res.status(422).json({
        error: body.only_settled
          ? 'No clips on those questions have a teacher mark that teachers agree on yet. Mark some first, or allow clips where teachers differ.'
          : 'No clips on those questions have been marked by a teacher yet.',
        code: 'NO_ELIGIBLE_CLIPS',
      }); return;
    }
    const setId = await db.transaction(async (trx) => {
      const [set] = await trx('practice_sets')
        .insert({ exam_id: req.params.id, name: body.name, created_by: req.user!.sub, show_mark_scheme: body.show_mark_scheme })
        .returning<{ id: string }[]>('id');
      await trx('practice_set_items').insert(picked.map((c, i) => ({ set_id: set.id, clip_id: c.clip_id, position: i + 1 })));
      return set.id;
    });
    const row = (await db.raw(`${SET_SELECT} WHERE ps.id = ?`, [setId])).rows[0] as SetRow;
    res.status(201).json({ data: toSummary(row) });
  } catch (err) {
    next(err);
  }
});

router.get('/exams/:id/practice-sets', ...staff, async (req, res, next) => {
  try {
    if (!(await requireExamMember(req, res, req.params.id, { leadOnly: true }))) return;
    const rows = (await db.raw(`${SET_SELECT} WHERE ps.exam_id = ? ORDER BY ps.created_at DESC`, [req.params.id])).rows as SetRow[];
    res.json({ data: rows.map(toSummary) });
  } catch (err) {
    next(err);
  }
});

router.get('/practice-sets/:id', ...staff, async (req, res, next) => {
  try {
    const loaded = await loadSet(req, res, req.params.id);
    if (!loaded) return;
    const combine = loaded.access.exam.mark_combine;
    const items = await db('practice_set_items as pi')
      .join('script_clips as sc', 'sc.id', 'pi.clip_id')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .leftJoin(finalMarks('fm', combine, true), 'fm.clip_id', 'pi.clip_id')
      .where('pi.set_id', loaded.set.id)
      .orderBy('pi.position')
      .select<{ id: string; position: number; clip_id: string; question_id: string; question_number: string; max_marks: number; reference: number | null }[]>(
        'pi.id', 'pi.position', 'pi.clip_id', 'eq.id as question_id', 'eq.question_number', 'eq.max_marks', 'fm.marks_awarded as reference',
      );
    const links = (await db.raw(
      `SELECT pl.id, pl.class_name, pl.token, pl.expires_at, pl.revoked_at, pl.created_at,
              (SELECT COUNT(*) FROM practice_enrolments pe WHERE pe.link_id = pl.id) AS students
         FROM practice_links pl WHERE pl.set_id = ? ORDER BY pl.created_at`,
      [loaded.set.id],
    )).rows as { id: string; class_name: string; token: string; expires_at: string | null; revoked_at: string | null; created_at: string; students: string }[];
    const base = publicBase(req);
    const detail: PracticeSetDetail = {
      set: loaded.set,
      items: items.map((i): PracticeItemInfo => ({ ...i, question_number: questionLabel(i.question_number) })),
      links: links.map((l): PracticeLinkInfo => ({ ...l, students: Number(l.students), url: `${base}/join/${l.token}` })),
    };
    res.json({ data: detail });
  } catch (err) {
    next(err);
  }
});

router.post('/practice-sets/:id/links', ...staff, async (req, res, next) => {
  try {
    const loaded = await loadSet(req, res, req.params.id);
    if (!loaded) return;
    const body = z.object({
      class_name: z.string().trim().min(1).max(60),
      expires_at: z.string().datetime().nullable().optional(),
    }).parse(req.body);
    const [link] = await db('practice_links')
      .insert({ set_id: loaded.set.id, class_name: body.class_name, token: newLinkToken(), created_by: req.user!.sub, expires_at: body.expires_at ?? null })
      .returning<{ id: string; token: string }[]>(['id', 'token']);
    res.status(201).json({ data: { id: link.id, token: link.token, url: `${publicBase(req)}/join/${link.token}` } });
  } catch (err) {
    next(err);
  }
});

// Revoking a link stops anyone joining with it and cuts off the students who joined through it
router.post('/practice-links/:id/revoke', ...staff, async (req, res, next) => {
  try {
    const link = await db('practice_links').where({ id: req.params.id }).first<{ id: string; set_id: string }>('id', 'set_id');
    if (!link) { res.status(404).json({ error: 'Link not found', code: 'NOT_FOUND' }); return; }
    if (!(await loadSet(req, res, link.set_id))) return;
    await db('practice_links').where({ id: link.id }).update({ revoked_at: db.fn.now() });
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.post('/practice-sets/:id/close', ...staff, async (req, res, next) => {
  try {
    if (!(await loadSet(req, res, req.params.id))) return;
    await db('practice_sets').where({ id: req.params.id }).update({ closed_at: db.fn.now() });
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.post('/practice-sets/:id/reopen', ...staff, async (req, res, next) => {
  try {
    if (!(await loadSet(req, res, req.params.id))) return;
    await db('practice_sets').where({ id: req.params.id }).update({ closed_at: null });
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// Deleting a set also deletes the students' marks on it
router.delete('/practice-sets/:id', ...staff, async (req, res, next) => {
  try {
    if (!(await loadSet(req, res, req.params.id))) return;
    await db('practice_sets').where({ id: req.params.id }).delete();
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// How the students compared with the teachers: per class and student, and per clip. ?format=csv for a spreadsheet.
router.get('/practice-sets/:id/results', ...staff, async (req, res, next) => {
  try {
    const loaded = await loadSet(req, res, req.params.id);
    if (!loaded) return;
    const combine = loaded.access.exam.mark_combine;

    const items = await db('practice_set_items as pi')
      .join('script_clips as sc', 'sc.id', 'pi.clip_id')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .leftJoin(finalMarks('fm', combine, true), 'fm.clip_id', 'pi.clip_id')
      .where('pi.set_id', loaded.set.id)
      .orderBy('pi.position')
      .select<{ id: string; position: number; question_number: string; max_marks: number; reference: number | null }[]>(
        'pi.id', 'pi.position', 'eq.question_number', 'eq.max_marks', 'fm.marks_awarded as reference',
      );
    const reference = new Map(items.map((i) => [i.id, i.reference]));

    const enrolled = (await db.raw(
      `SELECT pl.id AS link_id, pl.class_name, u.id AS student_id, u.name, u.email
         FROM practice_enrolments pe
         JOIN practice_links pl ON pl.id = pe.link_id
         JOIN users u ON u.id = pe.student_id
        WHERE pl.set_id = ? ORDER BY pl.created_at, u.email`,
      [loaded.set.id],
    )).rows as { link_id: string; class_name: string; student_id: string; name: string | null; email: string }[];

    const marks = await db('student_marks as sm')
      .join('practice_set_items as pi', 'pi.id', 'sm.item_id')
      .where('pi.set_id', loaded.set.id)
      .select<{ item_id: string; student_id: string; marks_awarded: number }[]>('sm.item_id', 'sm.student_id', 'sm.marks_awarded');

    const pairsOf = (list: typeof marks) => list
      .filter((m) => reference.get(m.item_id) != null)
      .map((m) => ({ mine: m.marks_awarded, teacher: reference.get(m.item_id) as number }));

    const classes = new Map<string, PracticeResults['classes'][number]>();
    for (const e of enrolled) {
      if (!classes.has(e.link_id)) classes.set(e.link_id, { link_id: e.link_id, class_name: e.class_name, students: [] });
      const mine = marks.filter((m) => m.student_id === e.student_id);
      classes.get(e.link_id)!.students.push({
        student_id: e.student_id, name: e.name, email: e.email, done: mine.length, total: items.length, stats: compareStats(pairsOf(mine)),
      });
    }

    const results: PracticeResults = {
      set: loaded.set,
      overall: compareStats(pairsOf(marks)),
      classes: [...classes.values()],
      items: items.map((i) => {
        const given = marks.filter((m) => m.item_id === i.id);
        const stats = compareStats(pairsOf(given));
        return {
          item_id: i.id, position: i.position, question_number: questionLabel(i.question_number), max_marks: i.max_marks,
          reference: i.reference, answers: given.length, histogram: histogram(given.map((m) => m.marks_awarded), i.max_marks),
          exact_pct: stats.exact_pct, mean_signed_diff: stats.mean_signed_diff,
        };
      }),
    };

    if (req.query.format === 'csv') {
      const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
      const itemOf = new Map(items.map((i) => [i.id, i]));
      const studentOf = new Map(enrolled.map((e) => [e.student_id, e]));
      const lines = [['class', 'student_name', 'student_email', 'clip', 'question', 'max_marks', 'student_mark', 'teacher_mark', 'difference'].join(',')];
      const all = await db('student_marks as sm').join('practice_set_items as pi', 'pi.id', 'sm.item_id').where('pi.set_id', loaded.set.id)
        .select<{ item_id: string; student_id: string; marks_awarded: number }[]>('sm.item_id', 'sm.student_id', 'sm.marks_awarded');
      for (const m of all) {
        const i = itemOf.get(m.item_id)!; const st = studentOf.get(m.student_id); const ref = reference.get(m.item_id);
        lines.push([st?.class_name, st?.name, st?.email, i.position, questionLabel(i.question_number), i.max_marks, m.marks_awarded, ref, ref == null ? '' : m.marks_awarded - ref].map(esc).join(','));
      }
      res.json({ data: { csv: lines.join('\n') + '\n', filename: `${loaded.set.name.replaceAll(/[^\w\- ]+/g, '')} - student marking.csv` } });
      return;
    }
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

export default router;

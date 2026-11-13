import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireStudent } from '../middleware/requireAuth.js';
import { finalMarks } from '../services/finalMark.js';
import { getClipBytes } from '../services/clipImages.js';
import { biasNote, compareStats } from '../services/practice.js';
import { normaliseQuestionLabel as questionLabel } from '../services/questionLabel.js';
import type { MarkCombine } from '../services/markCombine.js';
import type { PracticeReveal, StudentItemView, StudentSetListItem, StudentSetView, StudentSummary } from '@marker/shared-types';

// What a student may do: join a set through a class link, mark its clips and, only after submitting each one, see the
// teachers' mark. Nothing here exposes a script, a student or an exam by id or name: items are opaque handles, images
// are streamed through the API after an enrolment check, and the mark that is compared is the teachers' only (never AI).
// Student marks live in their own table, so none of this can reach a teacher's results.
const router = Router();
router.use(requireStudent);

const gone = (res: Response, status: number, error: string, code: string) => { res.status(status).json({ error, code }); };

interface ItemContext {
  item_id: string; set_id: string; set_name: string; position: number; closed: boolean; show_mark_scheme: boolean;
  clip_id: string; clip_image_url: string; question_id: string; question_number: string; max_marks: number;
  ms_clip_image_url: string | null; lead_teacher_id: string; mark_combine: MarkCombine;
}

// An item the signed-in student may work on: they joined its set through a link that has not been revoked
async function loadItem(req: Request, res: Response, itemId: string): Promise<ItemContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) { gone(res, 404, 'Not found', 'NOT_FOUND'); return null; }
  const row = await db('practice_set_items as pi')
    .join('practice_sets as ps', 'ps.id', 'pi.set_id')
    .join('script_clips as sc', 'sc.id', 'pi.clip_id')
    .join('exam_questions as eq', 'eq.id', 'sc.question_id')
    .join('exams as e', 'e.id', 'eq.exam_id')
    .where('pi.id', itemId)
    .whereExists(
      db('practice_enrolments as pe').join('practice_links as pl', 'pl.id', 'pe.link_id')
        .whereRaw('pl.set_id = ps.id').where('pe.student_id', req.user!.sub).whereNull('pl.revoked_at').select(db.raw('1')),
    )
    .first<ItemContext>(
      'pi.id as item_id', 'ps.id as set_id', 'ps.name as set_name', 'pi.position', db.raw('(ps.closed_at IS NOT NULL) as closed'), 'ps.show_mark_scheme',
      'sc.id as clip_id', 'sc.clip_image_url', 'eq.id as question_id', 'eq.question_number', 'eq.max_marks', 'eq.ms_clip_image_url',
      'e.lead_teacher_id', 'e.mark_combine',
    );
  if (!row) { gone(res, 404, 'Not found', 'NOT_FOUND'); return null; }
  return row;
}

const teacherMark = async (ctx: ItemContext): Promise<number | null> => {
  const r = await db(finalMarks('fm', ctx.mark_combine, true)).where('fm.clip_id', ctx.clip_id).first<{ marks_awarded: number }>('fm.marks_awarded');
  return r ? r.marks_awarded : null;
};

// Join through a class link. Idempotent. The same message for a bad, revoked or expired link, so tokens can't be probed.
router.post('/join', async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.body);
    const link = await db('practice_links as pl').join('practice_sets as ps', 'ps.id', 'pl.set_id')
      .where('pl.token', token)
      .first<{ id: string; set_id: string; class_name: string; revoked_at: string | null; expires_at: string | null; closed_at: string | null; set_name: string }>(
        'pl.id', 'pl.set_id', 'pl.class_name', 'pl.revoked_at', 'pl.expires_at', 'ps.closed_at', 'ps.name as set_name');
    const bad = !link || link.revoked_at || link.closed_at || (link.expires_at && new Date(link.expires_at) < new Date());
    if (bad) { gone(res, 410, 'This link is no longer working. Ask your teacher for a new one.', 'LINK_INVALID'); return; }
    await db('practice_enrolments').insert({ link_id: link.id, student_id: req.user!.sub }).onConflict(['link_id', 'student_id']).ignore();
    res.json({ data: { set_id: link.set_id, set_name: link.set_name } });
  } catch (err) { next(err); }
});

router.get('/sets', async (req, res, next) => {
  try {
    const rows = (await db.raw(
      `SELECT ps.id, ps.name, pl.class_name, (ps.closed_at IS NOT NULL) AS closed,
              (SELECT COUNT(*) FROM practice_set_items pi WHERE pi.set_id = ps.id) AS total,
              (SELECT COUNT(*) FROM student_marks sm JOIN practice_set_items pi ON pi.id = sm.item_id
                WHERE pi.set_id = ps.id AND sm.student_id = :sid) AS done
         FROM practice_enrolments pe
         JOIN practice_links pl ON pl.id = pe.link_id AND pl.revoked_at IS NULL
         JOIN practice_sets ps ON ps.id = pl.set_id
        WHERE pe.student_id = :sid ORDER BY pe.joined_at DESC`,
      { sid: req.user!.sub },
    )).rows as { id: string; name: string; class_name: string; closed: boolean; total: string; done: string }[];
    const seen = new Set<string>();
    const data: StudentSetListItem[] = rows.filter((r) => !seen.has(r.id) && seen.add(r.id))
      .map((r) => ({ ...r, total: Number(r.total), done: Number(r.done) }));
    res.json({ data });
  } catch (err) { next(err); }
});

async function enrolledSet(req: Request, res: Response, setId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(setId)) { gone(res, 404, 'Not found', 'NOT_FOUND'); return null; }
  const set = await db('practice_sets as ps')
    .where('ps.id', setId)
    .whereExists(db('practice_enrolments as pe').join('practice_links as pl', 'pl.id', 'pe.link_id')
      .whereRaw('pl.set_id = ps.id').where('pe.student_id', req.user!.sub).whereNull('pl.revoked_at').select(db.raw('1')))
    .first<{ id: string; name: string; closed: boolean; exam_id: string }>('ps.id', 'ps.name', 'ps.exam_id', db.raw('(ps.closed_at IS NOT NULL) as closed'));
  if (!set) { gone(res, 404, 'Not found', 'NOT_FOUND'); return null; }
  return set;
}

router.get('/sets/:setId', async (req, res, next) => {
  try {
    const set = await enrolledSet(req, res, req.params.setId);
    if (!set) return;
    const items = (await db.raw(
      `SELECT pi.id AS item_id, pi.position, (sm.id IS NOT NULL) AS done
         FROM practice_set_items pi
         LEFT JOIN student_marks sm ON sm.item_id = pi.id AND sm.student_id = ?
        WHERE pi.set_id = ? ORDER BY pi.position`,
      [req.user!.sub, set.id],
    )).rows as StudentSetView['items'];
    const data: StudentSetView = { id: set.id, name: set.name, closed: set.closed, items };
    res.json({ data });
  } catch (err) { next(err); }
});

async function submittedMark(studentId: string, itemId: string) {
  return db('student_marks').where({ item_id: itemId, student_id: studentId }).first<{ marks_awarded: number; annotation_data: unknown }>('marks_awarded', 'annotation_data');
}

async function reveal(ctx: ItemContext, mine: { marks_awarded: number; annotation_data: unknown }): Promise<PracticeReveal> {
  const teacher = await teacherMark(ctx);
  return { your_mark: mine.marks_awarded, teacher_mark: teacher, difference: teacher == null ? null : mine.marks_awarded - teacher, annotation_data: mine.annotation_data };
}

router.get('/items/:itemId', async (req, res, next) => {
  try {
    const ctx = await loadItem(req, res, req.params.itemId);
    if (!ctx) return;
    const mine = await submittedMark(req.user!.sub, ctx.item_id);
    const siblings = (await db('practice_set_items as pi')
      .leftJoin('student_marks as sm', function () { this.on('sm.item_id', 'pi.id').andOn('sm.student_id', db.raw('?', [req.user!.sub])); })
      .where('pi.set_id', ctx.set_id).orderBy('pi.position')
      .select<{ id: string; position: number; done: boolean }[]>('pi.id', 'pi.position', db.raw('(sm.id IS NOT NULL) as done')));
    const at = siblings.findIndex((s) => s.id === ctx.item_id);
    const after = [...siblings.slice(at + 1), ...siblings.slice(0, at)];
    const data: StudentItemView = {
      item_id: ctx.item_id, set_id: ctx.set_id, set_name: ctx.set_name, position: ctx.position, total: siblings.length,
      max_marks: ctx.max_marks, question_label: questionLabel(ctx.question_number),
      clip_url: `/api/v1/practice/items/${ctx.item_id}/image`,
      ms_url: ctx.show_mark_scheme && ctx.ms_clip_image_url ? `/api/v1/practice/items/${ctx.item_id}/ms` : null,
      closed: ctx.closed, submitted: Boolean(mine),
      // Enforced here, not in the UI: no reference mark leaves the server until this student has submitted
      result: mine ? await reveal(ctx, mine) : null,
      prev_id: at > 0 ? siblings[at - 1].id : null,
      next_id: at < siblings.length - 1 ? siblings[at + 1].id : null,
      next_undone_id: after.find((s) => !s.done)?.id ?? null,
    };
    res.json({ data });
  } catch (err) { next(err); }
});

const SubmitSchema = z.object({
  marks_awarded: z.number().int().min(0),
  annotation_data: z.array(z.unknown()).max(500).optional(),
});

// Final: a student's mark cannot be changed once they have seen the teachers'
router.post('/items/:itemId/submit', async (req, res, next) => {
  try {
    const ctx = await loadItem(req, res, req.params.itemId);
    if (!ctx) return;
    if (ctx.closed) { gone(res, 409, 'This set has been closed by your teacher.', 'SET_CLOSED'); return; }
    const body = SubmitSchema.parse(req.body);
    if (body.marks_awarded > ctx.max_marks) { gone(res, 400, `Marks must be between 0 and ${ctx.max_marks}`, 'INVALID_MARKS'); return; }
    const link = await db('practice_enrolments as pe').join('practice_links as pl', 'pl.id', 'pe.link_id')
      .where('pl.set_id', ctx.set_id).where('pe.student_id', req.user!.sub).whereNull('pl.revoked_at')
      .first<{ link_id: string }>('pe.link_id');
    const inserted = await db('student_marks')
      .insert({
        item_id: ctx.item_id, student_id: req.user!.sub, link_id: link?.link_id ?? null,
        marks_awarded: body.marks_awarded, annotation_data: JSON.stringify(body.annotation_data ?? []),
      })
      .onConflict(['item_id', 'student_id']).ignore()
      .returning<{ id: string }[]>('id');
    if (inserted.length === 0) { gone(res, 409, 'You have already submitted a mark for this one.', 'ALREADY_SUBMITTED'); return; }
    const mine = (await submittedMark(req.user!.sub, ctx.item_id))!;
    res.status(201).json({ data: await reveal(ctx, mine) });
  } catch (err) { next(err); }
});

router.get('/items/:itemId/image', async (req, res, next) => {
  try {
    const ctx = await loadItem(req, res, req.params.itemId);
    if (!ctx) return;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(await getClipBytes(ctx.clip_image_url, ctx.lead_teacher_id));
  } catch (err) { next(err); }
});

router.get('/items/:itemId/ms', async (req, res, next) => {
  try {
    const ctx = await loadItem(req, res, req.params.itemId);
    if (!ctx) return;
    if (!ctx.show_mark_scheme || !ctx.ms_clip_image_url) { gone(res, 404, 'No mark scheme for this one', 'NOT_FOUND'); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(await getClipBytes(ctx.ms_clip_image_url, ctx.lead_teacher_id));
  } catch (err) { next(err); }
});

// How this student's marks compare with the teachers', for what they have submitted so far
router.get('/sets/:setId/summary', async (req, res, next) => {
  try {
    const set = await enrolledSet(req, res, req.params.setId);
    if (!set) return;
    const combine = (await db('exams').where({ id: set.exam_id }).first<{ mark_combine: MarkCombine }>('mark_combine'))!.mark_combine;
    const total = Number((await db('practice_set_items').where({ set_id: set.id }).count<{ count: string }>('id as count').first())?.count ?? 0);
    const rows = await db('student_marks as sm')
      .join('practice_set_items as pi', 'pi.id', 'sm.item_id')
      .join('script_clips as sc', 'sc.id', 'pi.clip_id')
      .join('exam_questions as eq', 'eq.id', 'sc.question_id')
      .leftJoin(finalMarks('fm', combine, true), 'fm.clip_id', 'pi.clip_id')
      .where('pi.set_id', set.id).where('sm.student_id', req.user!.sub).orderBy('pi.position')
      .select<{ item_id: string; position: number; question_number: string; max_marks: number; mine: number; teacher: number | null }[]>(
        'pi.id as item_id', 'pi.position', 'eq.question_number', 'eq.max_marks', 'sm.marks_awarded as mine', 'fm.marks_awarded as teacher');
    const stats = compareStats(rows.filter((r) => r.teacher != null).map((r) => ({ mine: r.mine, teacher: r.teacher as number })));
    const data: StudentSummary = {
      set_name: set.name, finished: rows.length === total, done: rows.length, total, stats, bias_note: biasNote(stats.mean_signed_diff),
      items: rows.map((r) => ({
        item_id: r.item_id, position: r.position, question_label: questionLabel(r.question_number), max_marks: r.max_marks,
        your_mark: r.mine, teacher_mark: r.teacher, difference: r.teacher == null ? null : r.mine - r.teacher,
      })),
    };
    res.json({ data });
  } catch (err) { next(err); }
});

export default router;

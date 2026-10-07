import { Router, type Request, type Response } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { recordAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth, requireRole(['admin']));

const RoleSchema = z.enum(['admin', 'teacher']);
const IdParam = z.string().uuid();

interface UserRow {
  id: string;
  email: string;
  role: 'admin' | 'teacher';
  disabled_at: Date | null;
}

class GuardError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

// The built-in placeholder admin (used when AUTH_DISABLED) cannot sign in with
// Google, so it never counts towards "there is still an admin".
function isPlaceholder(id: string): boolean {
  return id === config.adminUserId;
}

// Runs a change to one user inside a transaction that locks the active admin rows,
// so two admins can't simultaneously demote each other and leave nobody in charge.
async function changeUser(
  req: Request,
  res: Response,
  targetId: string,
  change: (trx: Knex.Transaction, target: UserRow) => Promise<{ guard: 'none' | 'removes_admin'; run: () => Promise<void> }>,
): Promise<UserRow | null> {
  try {
    return await db.transaction(async (trx) => {
      const admins = await trx('users')
        .where({ role: 'admin' }).whereNull('disabled_at').forUpdate().select<{ id: string }[]>('id');
      const target = await trx('users').where({ id: targetId }).forUpdate()
        .first<UserRow>('id', 'email', 'role', 'disabled_at');
      if (!target) throw new GuardError(404, 'User not found', 'NOT_FOUND');

      const plan = await change(trx, target);
      if (plan.guard === 'removes_admin' && target.role === 'admin' && !target.disabled_at) {
        if (target.id === req.user!.sub) {
          throw new GuardError(400, "You can't remove your own admin access. Ask another admin to do it.", 'CANNOT_CHANGE_SELF');
        }
        const remaining = admins.filter((a) => !isPlaceholder(a.id) && a.id !== target.id).length;
        if (remaining < 1) {
          throw new GuardError(409, 'There must always be at least one active admin.', 'LAST_ADMIN');
        }
      }
      await plan.run();
      return target;
    });
  } catch (err) {
    if (err instanceof GuardError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return null;
    }
    throw err;
  }
}

// ── Users and invites ───────────────────────────────────────────────────────
router.get('/users', async (_req, res, next) => {
  try {
    const users = await db('users as u')
      .select(
        'u.id', 'u.email', 'u.name', 'u.role', 'u.created_at', 'u.last_login_at', 'u.disabled_at',
        db.raw('(SELECT COUNT(*)::int FROM exams e WHERE e.lead_teacher_id = u.id) AS leads_exams'),
      )
      .modify((qb) => { if (!config.authDisabled) qb.whereNot('u.id', config.adminUserId); })
      .orderBy('u.email');
    const invites = await db('allowed_emails as a')
      .leftJoin('users as u', 'u.id', 'a.added_by')
      .select('a.email', 'a.role', 'a.created_at', 'u.email as added_by_email')
      .orderBy('a.email');
    res.json({ data: { users, invites } });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const id = IdParam.parse(req.params.id);
    const { role } = z.object({ role: RoleSchema }).parse(req.body);
    const target = await changeUser(req, res, id, async (trx) => ({
      guard: role !== 'admin' ? 'removes_admin' : 'none',
      run: async () => { await trx('users').where({ id }).update({ role }); },
    }));
    if (!target) return;
    if (target.role !== role) {
      await recordAudit(req, 'user.role_changed', 'user', id, { email: target.email, from: target.role, to: role });
    }
    res.json({ data: { id, email: target.email, role } });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/deactivate', async (req, res, next) => {
  try {
    const id = IdParam.parse(req.params.id);
    if (id === req.user!.sub) {
      res.status(400).json({ error: "You can't deactivate your own account.", code: 'CANNOT_CHANGE_SELF' }); return;
    }
    const target = await changeUser(req, res, id, async (trx) => ({
      guard: 'removes_admin',
      run: async () => {
        await trx('users').where({ id }).update({ disabled_at: trx.fn.now() });
        await trx('sessions').where({ user_id: id }).del();
      },
    }));
    if (!target) return;
    const leads = await db('exams').where({ lead_teacher_id: id }).count('id as n').first<{ n: string }>();
    const leadsExams = Number(leads?.n ?? 0);
    await recordAudit(req, 'user.deactivated', 'user', id, { email: target.email, leads_exams: leadsExams });
    res.json({ data: { id, email: target.email, disabled: true, leads_exams: leadsExams } });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/reactivate', async (req, res, next) => {
  try {
    const id = IdParam.parse(req.params.id);
    const target = await changeUser(req, res, id, async (trx) => ({
      guard: 'none',
      run: async () => { await trx('users').where({ id }).update({ disabled_at: null }); },
    }));
    if (!target) return;
    await recordAudit(req, 'user.reactivated', 'user', id, { email: target.email });
    res.json({ data: { id, email: target.email, disabled: false } });
  } catch (err) {
    next(err);
  }
});

router.post('/invites', async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().trim().email().max(254), role: RoleSchema.default('teacher') }).parse(req.body);
    const email = body.email.toLowerCase();
    const existing = await db('users').whereRaw('LOWER(email) = ?', [email]).first('id');
    if (existing) {
      res.status(409).json({ error: 'That person already has an account. Change their role instead.', code: 'ALREADY_USER' }); return;
    }
    await db('allowed_emails')
      .insert({ email, role: body.role, added_by: req.user!.sub })
      .onConflict('email').merge(['role']);
    await recordAudit(req, 'invite.created', 'invite', email, { role: body.role });
    res.status(201).json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.delete('/invites/:email', async (req, res, next) => {
  try {
    const email = req.params.email.toLowerCase();
    const count = await db('allowed_emails').whereRaw('LOWER(email) = ?', [email]).delete();
    if (!count) { res.status(404).json({ error: 'Invite not found', code: 'NOT_FOUND' }); return; }
    await recordAudit(req, 'invite.revoked', 'invite', email);
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// ── Activity log ────────────────────────────────────────────────────────────
router.get('/audit', async (req, res, next) => {
  try {
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      before: z.string().datetime({ offset: true }).optional(),
    }).parse(req.query);
    const rows = await db('audit_log as a')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .select('a.id', 'a.action', 'a.target_type', 'a.target_id', 'a.metadata', 'a.created_at', 'u.email as actor_email')
      .modify((qb) => { if (q.before) qb.where('a.created_at', '<', q.before); })
      .orderBy('a.created_at', 'desc')
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    res.json({
      data: {
        entries: page,
        next_before: rows.length > q.limit ? new Date(page[page.length - 1].created_at).toISOString() : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Marking overview ────────────────────────────────────────────────────────
router.get('/overview', async (_req, res, next) => {
  try {
    const exams = (await db.raw(
      `SELECT e.id AS exam_id, e.name, e.status, u.email AS lead_email,
              COALESCE(c.clips_total, 0) AS clips_total, COALESCE(c.clips_marked, 0) AS clips_marked
         FROM exams e
         LEFT JOIN users u ON u.id = e.lead_teacher_id
         LEFT JOIN (
           SELECT eq.exam_id,
                  COUNT(DISTINCT sc.id) AS clips_total,
                  COUNT(DISTINCT sm.clip_id) AS clips_marked
             FROM script_clips sc
             JOIN exam_questions eq ON eq.id = sc.question_id
             LEFT JOIN script_marks sm ON sm.clip_id = sc.id AND sm.status <> 'pending' AND sm.mark_source = 'human'
            GROUP BY eq.exam_id
         ) c ON c.exam_id = e.id
        ORDER BY e.created_at DESC`,
    )).rows as { exam_id: string; name: string; status: string; lead_email: string | null; clips_total: string; clips_marked: string }[];

    const teachers = (await db.raw(
      `SELECT ma.exam_id, ma.teacher_id, u.email,
              COUNT(sc.id) AS clips_assigned,
              COUNT(sm.id) AS clips_marked,
              MAX(sm.marked_at) AS last_marked_at
         FROM marking_assignments ma
         JOIN users u ON u.id = ma.teacher_id
         LEFT JOIN script_clips sc ON sc.question_id = ma.question_id
         LEFT JOIN script_marks sm ON sm.clip_id = sc.id AND sm.marker_id = ma.teacher_id AND sm.status <> 'pending'
        GROUP BY ma.exam_id, ma.teacher_id, u.email
        ORDER BY u.email`,
    )).rows as { exam_id: string; teacher_id: string; email: string; clips_assigned: string; clips_marked: string; last_marked_at: Date | null }[];

    const byExam = new Map<string, typeof teachers>();
    for (const t of teachers) byExam.set(t.exam_id, [...(byExam.get(t.exam_id) ?? []), t]);

    res.json({
      data: exams.map((e) => ({
        exam_id: e.exam_id,
        name: e.name,
        status: e.status,
        lead_email: e.lead_email,
        clips_total: Number(e.clips_total),
        clips_marked: Number(e.clips_marked),
        teachers: (byExam.get(e.exam_id) ?? []).map((t) => ({
          teacher_id: t.teacher_id,
          email: t.email,
          clips_assigned: Number(t.clips_assigned),
          clips_marked: Number(t.clips_marked),
          last_marked_at: t.last_marked_at ? new Date(t.last_marked_at).toISOString() : null,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

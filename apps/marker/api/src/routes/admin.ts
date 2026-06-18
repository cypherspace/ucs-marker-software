import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

const router = Router();

// List all users
router.get('/users', requireAuth, requireRole(['admin']), async (_req, res, next) => {
  try {
    const users = await db('users').select('id', 'email', 'name', 'role', 'created_at', 'last_login_at').orderBy('created_at');
    const invites = await db('allowed_emails').select('email', 'role', 'created_at');
    res.json({ data: { users, invites } });
  } catch (err) {
    next(err);
  }
});

// Grant/update user role
router.patch('/users/:id', requireAuth, requireRole(['admin']), async (req, res, next) => {
  try {
    const body = z.object({ role: z.enum(['admin', 'teacher']) }).parse(req.body);
    const [user] = await db('users').where({ id: req.params.id }).update(body).returning(['id', 'email', 'role']);
    if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

// Add invite (allow-list an email)
router.post('/invites', requireAuth, requireRole(['admin']), async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), role: z.enum(['admin', 'teacher']) }).parse(req.body);
    await db('allowed_emails')
      .insert({ email: body.email.toLowerCase(), role: body.role, added_by: req.user!.sub })
      .onConflict('email').merge(['role']);
    res.status(201).json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// Remove invite
router.delete('/invites/:email', requireAuth, requireRole(['admin']), async (req, res, next) => {
  try {
    await db('allowed_emails').whereRaw('LOWER(email) = ?', [req.params.email.toLowerCase()]).delete();
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

export default router;

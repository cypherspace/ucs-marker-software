import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';

const router = Router();

// Active staff a lead teacher can assign questions to. Open to teachers (the
// admin user list is admin-only and returned an empty picker for them).
router.get('/teachers', requireAuth, requireRole(['teacher', 'admin']), async (_req, res, next) => {
  try {
    const rows = await db('users')
      .select('id', 'email', 'name')
      .whereNull('disabled_at')
      .modify((qb) => { if (!config.authDisabled) qb.whereNot('id', config.adminUserId); })
      .orderBy('email');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;

import type { Request } from 'express';
import { db } from '../db.js';

// Record who did what. Failures are logged but never block the action itself.
export async function recordAudit(
  req: Request,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db('audit_log').insert({
      actor_id: req.user?.sub ?? null,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata: JSON.stringify(metadata),
      ip_address: req.ip ? req.ip.replace(/^::ffff:/, '') : null,
    });
  } catch (err) {
    console.error('[audit] failed to record', action, (err as Error).message);
  }
}

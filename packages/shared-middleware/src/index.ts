import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

// ─── Auth types ──────────────────────────────────────────────────────────────

export interface AuthUser {
  sub: string;
  role: 'admin' | 'teacher';
  email?: string;
  name?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ─── Error handler ───────────────────────────────────────────────────────────

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(422).json({ error: 'Validation failed', code: 'VALIDATION', details: err.issues });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
}

// ─── Audit log helper ────────────────────────────────────────────────────────

export interface AuditEvent {
  actor_id: string;
  action: string;
  target_type?: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
}

// Injected at runtime by the app — avoids a circular dep on the db module.
let _auditLogger: ((event: AuditEvent) => Promise<void>) | null = null;

export function registerAuditLogger(fn: (event: AuditEvent) => Promise<void>): void {
  _auditLogger = fn;
}

export async function auditLog(event: AuditEvent): Promise<void> {
  if (!_auditLogger) return;
  try {
    await _auditLogger(event);
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

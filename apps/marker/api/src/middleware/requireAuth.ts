import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { loadSessionUser } from '../services/sessions.js';
import { readCookie, SID_COOKIE } from '../routes/auth.js';

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

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (config.authDisabled) {
    req.user = { sub: config.adminUserId, role: 'admin' };
    next();
    return;
  }

  const sid = readCookie(req, SID_COOKIE);
  const user = sid ? await loadSessionUser(sid) : null;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', code: 'NO_AUTH' });
    return;
  }

  req.user = { sub: user.id, role: user.role, email: user.email, name: user.name };
  next();
}

export function requireRole(roles: AuthUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

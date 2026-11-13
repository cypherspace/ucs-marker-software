import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { loadSessionUser } from '../services/sessions.js';
import { readCookie, SID_COOKIE } from '../routes/auth.js';

export interface AuthUser {
  sub: string;
  role: 'admin' | 'teacher' | 'student';
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

// Signed-in staff only. A student session is refused here, which closes every route that only checks requireAuth (exams,
// marks, clip images, files, results, AI...) to students without each one having to remember to. The few routes
// students may use say so by using requireStudent instead.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  await authenticate(req, res, next, false);
}

// Signed-in students only (the practice-marking routes). Staff are refused so the two sets of routes never mix.
export async function requireStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  await authenticate(req, res, next, true);
}

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  studentRoute: boolean,
): Promise<void> {
  if (config.authDisabled) {
    if (studentRoute) {
      res.status(403).json({ error: 'Students only', code: 'STUDENTS_ONLY' });
      return;
    }
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

  if (studentRoute !== (user.role === 'student')) {
    res.status(403).json(studentRoute
      ? { error: 'This is for students only', code: 'STUDENTS_ONLY' }
      : { error: 'Students cannot use this', code: 'STUDENT_FORBIDDEN' });
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

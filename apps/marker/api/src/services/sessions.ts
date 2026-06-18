import { randomBytes } from 'node:crypto';
import { db } from '../db.js';

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  user_agent: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'teacher';
}

const SESSION_TTL_DAYS = 7;

export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const id = newSessionId();
  const expires_at = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db('sessions').insert({ id, user_id: userId, expires_at, user_agent: userAgent ?? null });
  return id;
}

export async function loadSessionUser(sid: string): Promise<SessionUser | null> {
  if (!sid) return null;
  const row = await db('sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .where('s.id', sid)
    .andWhere('s.expires_at', '>', db.fn.now())
    .first<SessionUser>('u.id', 'u.email', 'u.name', 'u.role');
  return row ?? null;
}

export async function destroySession(sid: string): Promise<void> {
  if (!sid) return;
  await db('sessions').where({ id: sid }).del();
}

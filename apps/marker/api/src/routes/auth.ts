import { Router, type Request, type Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { createSession, destroySession, loadSessionUser } from '../services/sessions.js';

const router = Router();

export const SID_COOKIE = 'sid';

const STATE_TTL_MS = 10 * 60 * 1000;

function signState(): string {
  const ts = Date.now().toString(36);
  const nonce = randomBytes(12).toString('hex');
  const payload = `${ts}.${nonce}`;
  const secret = config.googleOAuthClientSecret || 'unset';
  const sig = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);
  return `${payload}.${sig}`;
}

function verifyState(state: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  if (!ts || !nonce || !sig) return false;
  const age = Date.now() - parseInt(ts, 36);
  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) return false;
  const secret = config.googleOAuthClientSecret || 'unset';
  const expected = createHmac('sha256', secret).update(`${ts}.${nonce}`).digest('hex').slice(0, 24);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean; httpOnly?: boolean } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('SameSite=Lax');
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure !== false && config.cookieSecure) parts.push('Secure');
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  const existing = res.getHeader('Set-Cookie');
  const out = Array.isArray(existing)
    ? [...existing, parts.join('; ')]
    : existing
    ? [String(existing), parts.join('; ')]
    : parts.join('; ');
  res.setHeader('Set-Cookie', out);
}

function clearCookie(res: Response, name: string): void {
  setCookie(res, name, '', { maxAge: 0 });
}

function publicUrl(req: Request): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${proto}://${host}`;
}

function frontendUrl(req: Request): string {
  return config.frontendUrl || publicUrl(req);
}

router.get('/google', (req, res) => {
  if (!config.googleOAuthClientId) {
    res.status(500).json({ error: 'OAuth not configured', code: 'AUTH_NOT_CONFIGURED' });
    return;
  }
  const state = signState();
  const redirectUri = `${publicUrl(req)}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: config.googleOAuthClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res, next) => {
  const bounceToLogin = (errorCode: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams({ error: errorCode, ...(extra ?? {}) });
    res.redirect(`${frontendUrl(req)}/login?${params.toString()}`);
  };

  try {
    if (typeof req.query.error === 'string' && req.query.error.trim()) {
      bounceToLogin('google_error', { detail: String(req.query.error) });
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    if (!code || !state) { bounceToLogin('missing_params'); return; }
    if (!verifyState(state)) { bounceToLogin('stale_state'); return; }

    const redirectUri = `${publicUrl(req)}/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.googleOAuthClientId,
        client_secret: config.googleOAuthClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) { bounceToLogin('oauth_failed'); return; }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) { bounceToLogin('oauth_failed'); return; }

    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
    );
    if (!verifyRes.ok) { bounceToLogin('oauth_failed'); return; }
    const claims = (await verifyRes.json()) as {
      sub: string; email?: string; email_verified?: string | boolean; name?: string; aud?: string;
    };
    if (claims.aud !== config.googleOAuthClientId) { bounceToLogin('oauth_failed'); return; }
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    if (!claims.email || !emailVerified) { bounceToLogin('unverified_email'); return; }

    const email = claims.email.toLowerCase();
    let user = await db('users')
      .where({ email })
      .first<{ id: string; email: string; role: 'admin' | 'teacher'; google_sub: string | null }>(
        'id', 'email', 'role', 'google_sub',
      );

    if (!user) {
      const invite = await db('allowed_emails')
        .whereRaw('LOWER(email) = ?', [email])
        .first<{ role: 'admin' | 'teacher' }>('role');

      if (invite) {
        const [created] = await db('users')
          .insert({ email, name: claims.name ?? null, google_sub: claims.sub, role: invite.role })
          .returning(['id', 'email', 'role', 'google_sub']);
        user = created as typeof user;
        await db('allowed_emails').whereRaw('LOWER(email) = ?', [email]).delete();
      } else if (!config.allowSignup) {
        res.redirect(`${frontendUrl(req)}/login?error=not_allowed&email=${encodeURIComponent(email)}`);
        return;
      } else {
        const [created] = await db('users')
          .insert({ email, name: claims.name ?? null, google_sub: claims.sub, role: 'teacher' })
          .returning(['id', 'email', 'role', 'google_sub']);
        user = created as typeof user;
      }
    } else if (user.google_sub !== claims.sub) {
      await db('users').where({ id: user.id }).update({ google_sub: claims.sub, name: claims.name ?? null, last_login_at: db.fn.now() });
    } else {
      await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });
    }

    const sid = await createSession(user!.id, req.get('user-agent') ?? undefined);
    setCookie(res, SID_COOKIE, sid, { maxAge: 7 * 24 * 60 * 60 });
    res.redirect(frontendUrl(req));
  } catch (err) {
    next(err);
  }
});

router.get('/me', async (req, res) => {
  if (config.authDisabled) {
    res.json({ data: { id: config.adminUserId, email: 'admin@marker.local', name: 'Admin', role: 'admin' } });
    return;
  }
  const sid = readCookie(req, SID_COOKIE);
  const user = sid ? await loadSessionUser(sid) : null;
  if (!user) {
    res.status(401).json({ error: 'Not signed in', code: 'NO_SESSION' });
    return;
  }
  res.json({ data: user });
});

router.post('/logout', async (req, res) => {
  const sid = readCookie(req, SID_COOKIE);
  if (sid) await destroySession(sid);
  clearCookie(res, SID_COOKIE);
  res.json({ data: { ok: true } });
});

export default router;

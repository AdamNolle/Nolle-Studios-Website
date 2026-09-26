import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { HttpBindings } from '@hono/node-server';
import type { Db } from './db.ts';
import type { Settings } from './settings.ts';

const SESSION_SECONDS = 12 * 60 * 60;
const COOKIE = 'nolle_cms_session';
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; since: number }>();

export type AppEnv = { Bindings: HttpBindings; Variables: { session: Session } };
export interface Session { token: string; csrfToken: string }

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, settings: Settings) {
  if (settings.adminPasswordHash) {
    const [kind, salt, digest] = settings.adminPasswordHash.split('$');
    if (kind !== 'scrypt' || !/^[a-f0-9]{32,}$/i.test(salt || '') || !/^[a-f0-9]{128}$/i.test(digest || '')) {
      throw new Error('CMS_ADMIN_PASSWORD_HASH has an invalid format');
    }
    return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
  }
  if (settings.production || !settings.localAdminPassword) return false;
  const expected = createHash('sha256').update(settings.localAdminPassword).digest();
  return timingSafeEqual(expected, createHash('sha256').update(password).digest());
}

const tokenHash = (token: string, settings: Settings) =>
  createHash('sha256').update(settings.sessionSecret).update(':').update(token).digest('hex');

function writeCookie(c: Context, token: string, settings: Settings) {
  setCookie(c, COOKIE, token, {
    httpOnly: true, sameSite: 'Strict', path: '/api/admin', maxAge: token ? SESSION_SECONDS : 0, secure: settings.production,
  });
}

/** The client address. One proxy hop (Caddy) is trusted, as before. */
function clientAddress(c: Context<AppEnv>) {
  const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
  return forwarded || c.env?.incoming?.socket.remoteAddress || 'unknown';
}

export async function login(c: Context<AppEnv>, db: Db, settings: Settings, password: unknown) {
  const ip = clientAddress(c);
  const time = Date.now();
  // Drop stale entries so the table cannot grow without bound.
  if (attempts.size > 1000) for (const [key, value] of attempts) if (time - value.since > WINDOW_MS) attempts.delete(key);
  const state = attempts.get(ip) ?? { count: 0, since: time };
  if (time - state.since > WINDOW_MS) { state.count = 0; state.since = time; }
  if (state.count >= 8) return c.json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }, 429);
  if (typeof password !== 'string' || !verifyPassword(password, settings)) {
    state.count++;
    attempts.set(ip, state);
    return c.json({ error: 'Incorrect password' }, 401);
  }
  attempts.delete(ip);
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  await db.query('DELETE FROM admin_sessions WHERE expires_at <= ?', [new Date().toISOString()]);
  await db.query('INSERT INTO admin_sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)',
    [tokenHash(token, settings), csrfToken, new Date(time + SESSION_SECONDS * 1000).toISOString()]);
  writeCookie(c, token, settings);
  return c.json({ authenticated: true, csrfToken });
}

export async function currentSession(c: Context, db: Db, settings: Settings): Promise<Session | null> {
  const token = getCookie(c, COOKIE) ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await db.query<{ csrf_token: string; expires_at: string }>(
    'SELECT csrf_token, expires_at FROM admin_sessions WHERE token_hash = ?', [tokenHash(token, settings)]);
  if (!rows[0] || rows[0].expires_at <= new Date().toISOString()) return null;
  return { token, csrfToken: rows[0].csrf_token };
}

export function requireAdmin(db: Db, settings: Settings): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await currentSession(c, db, settings);
    if (!session) return c.json({ error: 'Sign in required' }, 401);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-csrf-token') !== session.csrfToken) {
      return c.json({ error: 'Invalid session token' }, 403);
    }
    c.set('session', session);
    await next();
  };
}

export async function logout(c: Context<AppEnv>, db: Db, settings: Settings) {
  await db.query('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash(c.get('session').token, settings)]);
  writeCookie(c, '', settings);
  return c.json({ authenticated: false });
}

export const requireSameOrigin: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== c.req.header('host')) return c.json({ error: 'Cross-origin request denied' }, 403);
    } catch { return c.json({ error: 'Invalid origin' }, 403); }
  } else if (c.req.header('sec-fetch-site') === 'cross-site') {
    return c.json({ error: 'Cross-site request denied' }, 403);
  }
  await next();
};

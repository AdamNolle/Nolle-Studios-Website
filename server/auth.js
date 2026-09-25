import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_LENGTH_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'nolle_cms_session';
const attempts = new Map();

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, settings) {
  if (settings.adminPasswordHash) {
    const [kind, salt, digest] = settings.adminPasswordHash.split('$');
    if (kind !== 'scrypt' || !/^[a-f0-9]{32,}$/i.test(salt || '') || !/^[a-f0-9]{128}$/i.test(digest || '')) {
      throw new Error('CMS_ADMIN_PASSWORD_HASH has an invalid format');
    }
    const candidate = scryptSync(password, salt, 64);
    return timingSafeEqual(candidate, Buffer.from(digest, 'hex'));
  }
  if (settings.production || !settings.localAdminPassword) return false;
  const expected = createHash('sha256').update(settings.localAdminPassword).digest();
  const candidate = createHash('sha256').update(password).digest();
  return timingSafeEqual(expected, candidate);
}

function getCookie(req) {
  const item = (req.headers.cookie || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(`${COOKIE}=`));
  return item?.slice(COOKIE.length + 1) || '';
}

function tokenHash(token, settings) {
  return createHash('sha256').update(settings.sessionSecret).update(':').update(token).digest('hex');
}

function setCookie(res, token, settings) {
  const secure = settings.production ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${token ? 43200 : 0}${secure}`);
}

export async function login(req, res, db, settings) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const state = attempts.get(ip) || { count: 0, since: Date.now() };
  if (Date.now() - state.since > 15 * 60 * 1000) { state.count = 0; state.since = Date.now(); }
  if (state.count >= 8) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  if (typeof req.body?.password !== 'string' || !verifyPassword(req.body.password, settings)) {
    state.count++;
    attempts.set(ip, state);
    return res.status(401).json({ error: 'Incorrect password' });
  }
  attempts.delete(ip);
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_LENGTH_MS).toISOString();
  await db.query('DELETE FROM admin_sessions WHERE expires_at <= ?', [new Date().toISOString()]);
  await db.query('INSERT INTO admin_sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)', [tokenHash(token, settings), csrf, expiresAt]);
  setCookie(res, token, settings);
  res.json({ authenticated: true, csrfToken: csrf });
}

export async function session(req, db, settings) {
  const token = getCookie(req);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await db.query('SELECT csrf_token, expires_at FROM admin_sessions WHERE token_hash = ?', [tokenHash(token, settings)]);
  if (!rows[0] || rows[0].expires_at <= new Date().toISOString()) return null;
  return { token, csrfToken: rows[0].csrf_token };
}

export function requireAdmin(db, settings) {
  return async (req, res, next) => {
    try {
      const current = await session(req, db, settings);
      if (!current) return res.status(401).json({ error: 'Sign in required' });
      req.adminSession = current;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== current.csrfToken) {
        return res.status(403).json({ error: 'Invalid session token' });
      }
      next();
    } catch (error) { next(error); }
  };
}

export async function logout(req, res, db, settings) {
  await db.query('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash(req.adminSession.token, settings)]);
  setCookie(res, '', settings);
  res.json({ authenticated: false });
}

export function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request denied' });
    } catch { return res.status(403).json({ error: 'Invalid origin' }); }
  } else if (req.headers['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ error: 'Cross-site request denied' });
  }
  next();
}

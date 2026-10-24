const crypto = require('crypto');

const COOKIE_NAME = '11ka.auth';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sessionSecret() {
  return process.env.SESSION_SECRET || 'dev-change-me';
}

function sign(data) {
  return crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
}

function encode(user) {
  const payload = JSON.stringify({
    i: user.id,
    e: user.email,
    r: user.role,
    R: user.roles || (user.role ? [user.role] : []),
  });
  const data = Buffer.from(payload).toString('base64url');
  return `${data}.${sign(data)}`;
}

function decode(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(data);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!parsed || parsed.i == null || !parsed.e) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_MS,
  };
}

function set(res, user) {
  if (!res || typeof res.cookie !== 'function' || !user || user.id == null || !user.email) return;
  res.cookie(COOKIE_NAME, encode(user), cookieOptions());
}

function clear(res) {
  if (!res || typeof res.clearCookie !== 'function') return;
  const opts = cookieOptions();
  res.clearCookie(COOKIE_NAME, { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path });
}

function read(req) {
  const header = String((req && req.headers && req.headers.cookie) || '');
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== COOKIE_NAME) continue;
    let value = part.slice(idx + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw */
    }
    return decode(value);
  }
  return null;
}

function restoreToSession(req, res, next) {
  try {
    if (req.session && req.session.userId) return next();
    const payload = read(req);
    if (!payload || !req.session) return next();
    req.session.userId = payload.i;
    req.session.email = payload.e;
    req.session.role = payload.r || null;
    req.session.roles = Array.isArray(payload.R) ? payload.R : payload.r ? [payload.r] : [];
  } catch (err) {
    console.error('[11ka] auth cookie restore failed:', err && err.message);
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  set,
  clear,
  read,
  restoreToSession,
};

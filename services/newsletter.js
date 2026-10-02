const { getDb } = require('../db');
const crypto = require('crypto');

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** @returns {'ok'|'bad'} */
function subscribe(email) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return 'bad';
  const now = new Date().toISOString();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, unsubscribed_at FROM newsletter_subscribers WHERE email = ?`
    )
    .get(e);
  if (row) {
    if (row.unsubscribed_at) {
      db.prepare(
        `UPDATE newsletter_subscribers SET unsubscribed_at = NULL, created_at = ? WHERE id = ?`
      ).run(now, row.id);
    }
    return 'ok';
  }
  db.prepare(
    `INSERT INTO newsletter_subscribers (email, created_at) VALUES (?, ?)`
  ).run(e, now);
  return 'ok';
}

function listEmails() {
  return getDb()
    .prepare(
      `SELECT email FROM newsletter_subscribers WHERE unsubscribed_at IS NULL ORDER BY id`
    )
    .all()
    .map((r) => r.email);
}

function getTokenSecret() {
  return (
    process.env.NEWSLETTER_SECRET ||
    process.env.SESSION_SECRET ||
    'dev-change-me'
  );
}

function buildUnsubscribeToken(email) {
  const e = normalizeEmail(email);
  const secret = getTokenSecret();
  return crypto.createHmac('sha256', secret).update(e).digest('hex');
}

function verifyUnsubscribeToken(email, token) {
  const e = normalizeEmail(email);
  if (!e || !token || typeof token !== 'string') return false;
  const expected = buildUnsubscribeToken(e);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

function unsubscribe(email) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return false;
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `UPDATE newsletter_subscribers SET unsubscribed_at = ? WHERE email = ? AND unsubscribed_at IS NULL`
    )
    .run(now, e);
  return info.changes > 0;
}

module.exports = {
  subscribe,
  listEmails,
  unsubscribe,
  buildUnsubscribeToken,
  verifyUnsubscribeToken,
  isValidEmail,
  normalizeEmail,
};

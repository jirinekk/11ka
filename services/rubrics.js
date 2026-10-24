const { getDb } = require('../db');
const { slugify, uniqueSlug } = require('../lib/slug');
const { hasAnyRole } = require('../lib/roles');

const DEFAULT_RUBRICS = [
  { slug: 'hlas-edenu', label: 'Hlas Edenu', description: 'Slávistický sloupek' },
  { slug: 'spartanska-konina', label: 'Sparťanská konina', description: 'Spartanský sloupek' },
];

const LABEL_MAX = 80;
const DESC_MAX = 500;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    description: row.description || '',
    owner_user_id: row.owner_user_id || null,
    owner_name: row.owner_name || null,
    owner_email: row.owner_email || null,
    owner_slug: row.owner_slug || null,
    owner_avatar: row.owner_avatar || null,
    notify_enabled: Number(row.notify_enabled) === 1,
    sort_order: Number(row.sort_order) || 0,
    article_count: Number(row.article_count || 0),
    subscriber_count: Number(row.subscriber_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ensureColumn(table, name, definition) {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((col) => col.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function ensureTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS rubrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT,
      owner_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
      notify_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rubrics_sort ON rubrics (sort_order, label, id);
    CREATE TABLE IF NOT EXISTS rubric_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rubric_id INTEGER NOT NULL REFERENCES rubrics (id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      UNIQUE (rubric_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_rubric_subscriptions_email ON rubric_subscriptions (email);
  `);
  ensureColumn('rubrics', 'description', 'description TEXT');
  ensureColumn('rubrics', 'owner_user_id', 'owner_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL');
  ensureColumn('rubrics', 'notify_enabled', 'notify_enabled INTEGER NOT NULL DEFAULT 1');
  seedDefaults();
}

function seedDefaults() {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO rubrics (slug, label, description, owner_user_id, notify_enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 1, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  DEFAULT_RUBRICS.forEach((item, index) => {
    const exists = db.prepare(`SELECT id FROM rubrics WHERE slug = ?`).get(item.slug);
    if (exists) return;
    insert.run(item.slug, item.label, item.description, index, now, now);
  });
}

const SELECT_SQL = `
  SELECT r.*,
         u.display_name AS owner_name,
         u.email AS owner_email,
         u.slug AS owner_slug,
         u.avatar_path AS owner_avatar,
         (SELECT COUNT(*) FROM articles a WHERE a.rubric_slug = r.slug AND a.status = 'published') AS article_count,
         (SELECT COUNT(*) FROM rubric_subscriptions s WHERE s.rubric_id = r.id) AS subscriber_count
  FROM rubrics r
  LEFT JOIN users u ON u.id = r.owner_user_id
`;

function listRubrics() {
  return getDb()
    .prepare(`${SELECT_SQL} ORDER BY r.sort_order ASC, r.label COLLATE NOCASE ASC, r.id ASC`)
    .all()
    .map(mapRow);
}

function getBySlug(slug) {
  const key = String(slug || '').trim();
  if (!key) return null;
  return mapRow(getDb().prepare(`${SELECT_SQL} WHERE r.slug = ?`).get(key));
}

function getById(id) {
  const num = parseInt(id, 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  return mapRow(getDb().prepare(`${SELECT_SQL} WHERE r.id = ?`).get(num));
}

function isRubricSlug(slug) {
  return !!getBySlug(slug);
}

function slugExists(slug, exceptId) {
  const key = String(slug || '').trim();
  if (!key) return false;
  const row = exceptId
    ? getDb().prepare(`SELECT id FROM rubrics WHERE slug = ? AND id != ?`).get(key, exceptId)
    : getDb().prepare(`SELECT id FROM rubrics WHERE slug = ?`).get(key);
  return !!row;
}

function makeSlug(label, exceptId) {
  return uniqueSlug(String(label || '').trim() || 'rubrika', (candidate) => slugExists(candidate, exceptId));
}

function normalizeLabel(value) {
  return String(value || '').trim().slice(0, LABEL_MAX);
}

function normalizeDescription(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, DESC_MAX) : null;
}

function normalizeOwnerId(value) {
  if (value == null || value === '') return null;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  const user = getDb().prepare(`SELECT id, role, roles FROM users WHERE id = ?`).get(num);
  if (!user) return null;
  let roles = [];
  try {
    const parsed = JSON.parse(user.roles || '[]');
    if (Array.isArray(parsed)) roles = parsed;
  } catch {
    roles = user.role ? [user.role] : [];
  }
  if (!hasAnyRole({ role: user.role, roles }, 'majitel', 'vedeni', 'sefredaktor', 'redaktor')) {
    return null;
  }
  return num;
}

function createRubric({ label, slug, description, owner_user_id, notify_enabled }) {
  const name = normalizeLabel(label);
  if (!name) {
    const err = new Error('Zadejte název rubriky.');
    err.code = 'INVALID';
    throw err;
  }
  const rawSlug = String(slug || '').trim();
  const finalSlug = rawSlug
    ? uniqueSlug(rawSlug, (candidate) => slugExists(candidate))
    : makeSlug(name);
  const now = new Date().toISOString();
  const maxSort = getDb().prepare(`SELECT MAX(sort_order) AS n FROM rubrics`).get();
  const info = getDb()
    .prepare(
      `INSERT INTO rubrics (slug, label, description, owner_user_id, notify_enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      finalSlug,
      name,
      normalizeDescription(description),
      normalizeOwnerId(owner_user_id),
      notify_enabled ? 1 : 0,
      (Number(maxSort && maxSort.n) || 0) + 1,
      now,
      now
    );
  return getById(info.lastInsertRowid);
}

function updateRubric(id, { label, description, owner_user_id, notify_enabled }) {
  const current = getById(id);
  if (!current) {
    const err = new Error('Rubrika neexistuje.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const name = normalizeLabel(label);
  if (!name) {
    const err = new Error('Zadejte název rubriky.');
    err.code = 'INVALID';
    throw err;
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE rubrics
       SET label = ?, description = ?, owner_user_id = ?, notify_enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      name,
      normalizeDescription(description),
      normalizeOwnerId(owner_user_id),
      notify_enabled ? 1 : 0,
      now,
      current.id
    );
  return getById(current.id);
}

function removeRubric(id) {
  const current = getById(id);
  if (!current) return false;
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE articles SET rubric_slug = NULL WHERE rubric_slug = ?`).run(current.slug);
    db.prepare(`DELETE FROM rubrics WHERE id = ?`).run(current.id);
  });
  tx();
  return true;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  if (!e || e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isSubscribed(rubricId, email) {
  const e = normalizeEmail(email);
  if (!rubricId || !isValidEmail(e)) return false;
  const row = getDb()
    .prepare(`SELECT id FROM rubric_subscriptions WHERE rubric_id = ? AND email = ? COLLATE NOCASE`)
    .get(rubricId, e);
  return !!row;
}

/** @returns {'ok'|'dupe'|'bad'} */
function subscribe(rubricId, { email, userId } = {}) {
  const e = normalizeEmail(email);
  if (!rubricId || !isValidEmail(e)) return 'bad';
  const rubric = getById(rubricId);
  if (!rubric || !rubric.notify_enabled) return 'bad';
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM rubric_subscriptions WHERE rubric_id = ? AND email = ? COLLATE NOCASE`)
    .get(rubricId, e);
  if (existing) return 'dupe';
  const uid = Number.isFinite(Number(userId)) && Number(userId) > 0 ? Number(userId) : null;
  db.prepare(
    `INSERT INTO rubric_subscriptions (rubric_id, user_id, email, created_at) VALUES (?, ?, ?, ?)`
  ).run(rubricId, uid, e, new Date().toISOString());
  return 'ok';
}

function unsubscribe(rubricId, email) {
  const e = normalizeEmail(email);
  if (!rubricId || !isValidEmail(e)) return false;
  const result = getDb()
    .prepare(`DELETE FROM rubric_subscriptions WHERE rubric_id = ? AND email = ? COLLATE NOCASE`)
    .run(rubricId, e);
  return result.changes > 0;
}

function listSubscriberEmails(rubricId) {
  if (!rubricId) return [];
  return getDb()
    .prepare(`SELECT email FROM rubric_subscriptions WHERE rubric_id = ? ORDER BY id`)
    .all(rubricId)
    .map((row) => row.email)
    .filter(Boolean);
}

function listSubscriptionsForEmail(email) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return [];
  return getDb()
    .prepare(
      `${SELECT_SQL}
       INNER JOIN rubric_subscriptions s ON s.rubric_id = r.id
       WHERE s.email = ? COLLATE NOCASE
       ORDER BY r.sort_order ASC, r.label COLLATE NOCASE ASC`
    )
    .all(e)
    .map(mapRow);
}

function ownerHref(rubric) {
  if (!rubric || !rubric.owner_slug) return null;
  return `/uzivatel/${encodeURIComponent(rubric.owner_slug)}`;
}

function ownerInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '11';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0].charAt(1) || '';
  return (first + last).toUpperCase();
}

module.exports = {
  LABEL_MAX,
  DESC_MAX,
  ensureTables,
  listRubrics,
  getBySlug,
  getById,
  isRubricSlug,
  createRubric,
  updateRubric,
  removeRubric,
  makeSlug,
  isValidEmail,
  normalizeEmail,
  isSubscribed,
  subscribe,
  unsubscribe,
  listSubscriberEmails,
  listSubscriptionsForEmail,
  ownerHref,
  ownerInitials,
};

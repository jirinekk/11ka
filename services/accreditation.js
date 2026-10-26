const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

const SEED_PATH = path.join(__dirname, '..', 'data', 'seed-accreditations.json');

const VALID_STATUSES = new Set(['requested', 'pending', 'approved', 'rejected']);

function normalizeStatus(status) {
  const s = String(status || 'pending').trim().toLowerCase();
  return VALID_STATUSES.has(s) ? s : 'pending';
}

/** @param {string} status @param {{ long?: boolean }} [opts] */
function getStatusLabel(status, opts = {}) {
  const s = normalizeStatus(status);
  if (s === 'approved') return 'Schváleno';
  if (s === 'rejected') return 'Zamítnuto';
  if (s === 'requested') return 'Zažádáno';
  return opts.long ? 'Čeká na vyřízení' : 'Čeká';
}

/** @returns {'approved'|'rejected'|'requested'|'pending'} */
function getStatusTone(status) {
  const s = normalizeStatus(status);
  if (s === 'approved' || s === 'rejected' || s === 'requested') return s;
  return 'pending';
}

function formatMatchDateCs(value) {
  const s = String(value || '').trim();
  if (!s) return '-';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

function isValidMatchDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    hidden_from_web: Number(row.hidden_from_web) === 1 ? 1 : 0,
  };
}

function create(data) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO accreditation_requests
        (email, phone, name, match_name, match_date, accreditation_type, email_sent, status, hidden_from_web, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', 0, ?)`
    )
    .run(
      data.email,
      data.phone,
      data.name,
      data.match,
      data.match_date,
      data.accreditation_type,
      now
    );
  return Number(result.lastInsertRowid);
}

function markEmailSent(id) {
  getDb()
    .prepare(`UPDATE accreditation_requests SET email_sent = 1 WHERE id = ?`)
    .run(id);
}

function setStatus(id, status) {
  const normalized = normalizeStatus(status);
  const result = getDb()
    .prepare(`UPDATE accreditation_requests SET status = ? WHERE id = ?`)
    .run(normalized, id);
  return result.changes > 0;
}

function setHiddenFromWeb(id, hidden) {
  const value = hidden ? 1 : 0;
  const result = getDb()
    .prepare(`UPDATE accreditation_requests SET hidden_from_web = ? WHERE id = ?`)
    .run(value, id);
  return result.changes > 0;
}

function getById(id) {
  const row = getDb()
    .prepare(
      `SELECT id, email, phone, name, match_name, match_date, accreditation_type, email_sent, status, hidden_from_web, created_at
       FROM accreditation_requests WHERE id = ?`
    )
    .get(id);
  return mapRow(row);
}

function countAll() {
  const row = getDb().prepare(`SELECT COUNT(*) AS c FROM accreditation_requests`).get();
  return Number(row?.c || 0);
}

function countPublic() {
  return countByWebVisibility(false);
}

function matchDateFilter(opts = {}) {
  let dateFrom = isValidMatchDate(opts.dateFrom) ? String(opts.dateFrom).trim() : '';
  let dateTo = isValidMatchDate(opts.dateTo) ? String(opts.dateTo).trim() : '';
  if (dateFrom && dateTo && dateFrom > dateTo) {
    const swap = dateFrom;
    dateFrom = dateTo;
    dateTo = swap;
  }
  const clauses = [];
  const params = [];
  if (dateFrom) {
    clauses.push('match_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('match_date <= ?');
    params.push(dateTo);
  }
  return { dateFrom, dateTo, clauses, params };
}

function countByWebVisibility(hidden, opts = {}) {
  const flag = hidden ? 1 : 0;
  const filter = matchDateFilter(opts);
  const where = ['COALESCE(hidden_from_web, 0) = ?', ...filter.clauses].join(' AND ');
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM accreditation_requests WHERE ${where}`)
    .get(flag, ...filter.params);
  return Number(row?.c || 0);
}

function listPaged(limit, offset) {
  return getDb()
    .prepare(
      `SELECT id, email, phone, name, match_name, match_date, accreditation_type, email_sent, status, hidden_from_web, created_at
       FROM accreditation_requests
       ORDER BY
         CASE WHEN match_date IS NULL OR match_date = '' THEN 1 ELSE 0 END,
         match_date ASC,
         created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map(mapRow);
}

function listPagedByWebVisibility(hidden, limit, offset, opts = {}) {
  const flag = hidden ? 1 : 0;
  const filter = matchDateFilter(opts);
  const where = ['COALESCE(hidden_from_web, 0) = ?', ...filter.clauses].join(' AND ');
  return getDb()
    .prepare(
      `SELECT id, email, phone, name, match_name, match_date, accreditation_type, email_sent, status, hidden_from_web, created_at
       FROM accreditation_requests
       WHERE ${where}
       ORDER BY
         CASE WHEN match_date IS NULL OR match_date = '' THEN 1 ELSE 0 END,
         match_date ASC,
         created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(flag, ...filter.params, limit, offset)
    .map(mapRow);
}

function listPublicPaged(limit, offset) {
  return getDb()
    .prepare(
      `SELECT email, phone, name, match_name, match_date, accreditation_type, status, created_at
       FROM accreditation_requests
       WHERE COALESCE(hidden_from_web, 0) = 0
       ORDER BY
         CASE WHEN match_date IS NULL OR match_date = '' THEN 1 ELSE 0 END,
         match_date ASC,
         created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map((row) => ({
      ...row,
      match: row.match_name,
      match_date_display: formatMatchDateCs(row.match_date),
    }));
}

function remove(id) {
  const result = getDb()
    .prepare(`DELETE FROM accreditation_requests WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

function normalizePersonKey(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * Spis žadatelů: agregace podle e-mailu (stejný člověk = stejný e-mail).
 * @param {{ search?: string, limit?: number, offset?: number }} [opts]
 */
function listApplicantStats(opts = {}) {
  const search = String(opts.search || '')
    .trim()
    .toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);

  const rows = getDb()
    .prepare(
      `SELECT
         LOWER(TRIM(email)) AS email_key,
         MAX(email) AS email,
         MAX(name) AS name,
         MAX(phone) AS phone,
         COUNT(*) AS total,
         SUM(CASE WHEN LOWER(TRIM(status)) = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN LOWER(TRIM(status)) = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN LOWER(TRIM(status)) = 'requested' THEN 1 ELSE 0 END) AS requested,
         SUM(CASE WHEN LOWER(TRIM(COALESCE(status, 'pending'))) NOT IN ('approved', 'rejected', 'requested') THEN 1 ELSE 0 END) AS pending,
         MAX(created_at) AS last_created_at
       FROM accreditation_requests
       GROUP BY LOWER(TRIM(email))
       ORDER BY MAX(created_at) DESC`
    )
    .all();

  // Prefer most recent name/phone for each email (MAX(name) is lexicographic, not by date).
  const latestMeta = getDb()
    .prepare(
      `SELECT LOWER(TRIM(email)) AS email_key, name, phone, email, created_at
       FROM accreditation_requests
       ORDER BY created_at DESC, id DESC`
    )
    .all();
  const metaByKey = new Map();
  for (const row of latestMeta) {
    const key = row.email_key;
    if (!key || metaByKey.has(key)) continue;
    metaByKey.set(key, {
      name: row.name,
      phone: row.phone,
      email: row.email,
    });
  }

  let items = rows.map((row) => {
    const key = row.email_key;
    const meta = metaByKey.get(key) || {};
    return {
      email_key: key,
      email: meta.email || row.email,
      name: meta.name || row.name || '-',
      phone: meta.phone || row.phone || '-',
      total: Number(row.total || 0),
      approved: Number(row.approved || 0),
      rejected: Number(row.rejected || 0),
      requested: Number(row.requested || 0),
      pending: Number(row.pending || 0),
      last_created_at: row.last_created_at || null,
    };
  });

  if (search) {
    items = items.filter((item) => {
      const hay = `${item.name} ${item.email} ${item.phone}`.toLowerCase();
      return hay.includes(search);
    });
  }

  const totalItems = items.length;
  const pageItems = items.slice(offset, offset + limit);
  return { items: pageItems, totalItems };
}

function countApplicants(search) {
  return listApplicantStats({ search, limit: 100000, offset: 0 }).totalItems;
}

function getApplicantStatsByEmail(email) {
  const key = normalizePersonKey(email);
  if (!key) return null;

  const row = getDb()
    .prepare(
      `SELECT
         LOWER(TRIM(email)) AS email_key,
         COUNT(*) AS total,
         SUM(CASE WHEN LOWER(TRIM(status)) = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN LOWER(TRIM(status)) = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN LOWER(TRIM(status)) = 'requested' THEN 1 ELSE 0 END) AS requested,
         SUM(CASE WHEN LOWER(TRIM(COALESCE(status, 'pending'))) NOT IN ('approved', 'rejected', 'requested') THEN 1 ELSE 0 END) AS pending,
         MAX(created_at) AS last_created_at
       FROM accreditation_requests
       WHERE LOWER(TRIM(email)) = ?
       GROUP BY LOWER(TRIM(email))`
    )
    .get(key);
  if (!row) return null;

  const latest = getDb()
    .prepare(
      `SELECT email, name, phone
       FROM accreditation_requests
       WHERE LOWER(TRIM(email)) = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(key);

  return {
    email_key: key,
    email: (latest && latest.email) || key,
    name: (latest && latest.name) || '-',
    phone: (latest && latest.phone) || '-',
    total: Number(row.total || 0),
    approved: Number(row.approved || 0),
    rejected: Number(row.rejected || 0),
    requested: Number(row.requested || 0),
    pending: Number(row.pending || 0),
    last_created_at: row.last_created_at || null,
  };
}

function loadSeedRequests() {
  try {
    if (!fs.existsSync(SEED_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.requests) ? raw.requests : [];
    return list.filter((item) => item && item.email && item.name && item.match_name);
  } catch (e) {
    console.error('[11ka] seed-accreditations.json unreadable:', e && e.message);
    return [];
  }
}

function seedRequestKey(row) {
  return [
    normalizePersonKey(row && row.email),
    String((row && row.match_name) || '')
      .trim()
      .toLowerCase(),
    String((row && row.match_date) || '').trim(),
  ].join('|');
}

function insertSeedRequest(item) {
  const type = item.accreditation_type === 'pisi' ? 'pisi' : 'photo';
  const status = normalizeStatus(item.status);
  const hidden = Number(item.hidden_from_web) === 1 ? 1 : 0;
  const sent = Number(item.email_sent) === 1 ? 1 : 0;
  const createdAt = item.created_at || new Date().toISOString();
  const matchDate = isValidMatchDate(item.match_date) ? String(item.match_date).trim() : null;
  getDb()
    .prepare(
      `INSERT INTO accreditation_requests
        (email, phone, name, match_name, match_date, accreditation_type, email_sent, status, hidden_from_web, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(item.email).trim(),
      String(item.phone || '').trim(),
      String(item.name).trim(),
      String(item.match_name).trim(),
      matchDate,
      type,
      sent,
      status,
      hidden,
      createdAt
    );
}

function seedIfEmpty() {
  const seeded = loadSeedRequests();
  if (!seeded.length) return 0;
  const existing = new Set(getDb().prepare(`SELECT email, match_name, match_date FROM accreditation_requests`).all().map(seedRequestKey));
  const missing = seeded.filter((item) => !existing.has(seedRequestKey(item)));
  if (!missing.length) return 0;
  const insertMany = getDb().transaction((items) => {
    for (const item of items) insertSeedRequest(item);
  });
  insertMany(missing);
  console.log(`[11ka] Seeded ${missing.length} accreditation request(s) from data/seed-accreditations.json`);
  return missing.length;
}

function listByEmail(email) {
  const key = normalizePersonKey(email);
  if (!key) return [];
  return getDb()
    .prepare(
      `SELECT id, email, phone, name, match_name, match_date, accreditation_type, email_sent, status, hidden_from_web, created_at
       FROM accreditation_requests
       WHERE LOWER(TRIM(email)) = ?
       ORDER BY
         CASE WHEN match_date IS NULL OR match_date = '' THEN 1 ELSE 0 END,
         match_date DESC,
         created_at DESC`
    )
    .all(key)
    .map(mapRow);
}

module.exports = {
  create,
  getById,
  markEmailSent,
  setStatus,
  setHiddenFromWeb,
  countAll,
  countPublic,
  countByWebVisibility,
  listPaged,
  listPagedByWebVisibility,
  listPublicPaged,
  remove,
  listApplicantStats,
  countApplicants,
  getApplicantStatsByEmail,
  listByEmail,
  seedIfEmpty,
  normalizePersonKey,
  normalizeStatus,
  getStatusLabel,
  getStatusTone,
  formatMatchDateCs,
  isValidMatchDate,
  matchDateFilter,
};

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

function normalizeTitle(value) {
  return String(value || '').trim();
}

function normalizeHeadline(value) {
  return String(value || '').trim();
}

function normalizePosterImage(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function normalizeSortOrder(value) {
  const parsed = Number.parseInt(String(value || '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSourceType() {
  return 'upload';
}

function normalizeActive(value) {
  if (value === true || value === 1 || value === '1' || value === 'on') return 1;
  return 0;
}

function listAll() {
  return getDb()
    .prepare(`SELECT * FROM reels ORDER BY datetime(created_at) DESC, id DESC`)
    .all();
}

function buildAdminReelsFilterWhere(filters) {
  const where = [];
  const params = [];
  const f = filters || {};
  const q = f.q != null ? String(f.q).trim() : '';
  const status = f.status != null ? String(f.status).trim() : '';

  if (q) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    where.push(
      `(headline LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR IFNULL(source_url, '') LIKE ? ESCAPE '\\' OR IFNULL(file_path, '') LIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like, like);
  }
  if (status === 'active') {
    where.push(`is_active = 1`);
  } else if (status === 'inactive') {
    where.push(`is_active = 0`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function listAllForAdminFilteredPaged(limit, offset, filters) {
  const lim = limit != null ? limit : 7;
  const off = offset != null ? offset : 0;
  const { clause, params } = buildAdminReelsFilterWhere(filters);
  return getDb()
    .prepare(
      `SELECT * FROM reels
       ${clause}
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, lim, off);
}

function countAllForAdminFiltered(filters) {
  const { clause, params } = buildAdminReelsFilterWhere(filters);
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM reels ${clause}`)
    .get(...params).n;
}

function listActive() {
  return getDb()
    .prepare(`SELECT * FROM reels WHERE is_active = 1 ORDER BY datetime(created_at) DESC, id DESC`)
    .all();
}

function getById(id) {
  return getDb()
    .prepare(`SELECT * FROM reels WHERE id = ?`)
    .get(id);
}

function createReel(input) {
  const headline = normalizeHeadline(input.headline);
  const title = normalizeTitle(input.title);
  const source_type = normalizeSourceType(input.source_type);
  const file_path = String(input.file_path || '').trim() || null;
  if (!headline) throw new Error('Nadpis je povinný.');
  if (headline.length > 100) throw new Error('Nadpis může mít maximálně 100 znaků.');
  if (!title) throw new Error('Název je povinný.');
  if (!file_path) throw new Error('U upload videa je povinný soubor.');
  const poster_image = normalizePosterImage(input.poster_image);
  const is_active = normalizeActive(input.is_active);
  const sort_order = normalizeSortOrder(input.sort_order);
  const now = new Date().toISOString();

  const result = getDb()
    .prepare(
      `INSERT INTO reels (headline, title, source_type, source_url, file_path, poster_image, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(headline, title, source_type, null, file_path, poster_image, is_active, sort_order, now, now);
  return getById(result.lastInsertRowid);
}

function unlinkLocalReelFile(filePath) {
  const p = String(filePath || '');
  if (!p.startsWith('/uploads/reels/')) return;
  const abs = path.join(__dirname, '..', 'public', p.replace(/^\//, ''));
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function updateReel(id, patch) {
  const current = getById(id);
  if (!current) throw new Error('Reels položka nebyla nalezena.');

  const headline = patch.headline !== undefined ? normalizeHeadline(patch.headline) : current.headline;
  const title = patch.title !== undefined ? normalizeTitle(patch.title) : current.title;
  const source_type = 'upload';
  const file_path =
    patch.file_path !== undefined ? (String(patch.file_path || '').trim() || null) : current.file_path;
  const poster_image =
    patch.poster_image !== undefined ? normalizePosterImage(patch.poster_image) : current.poster_image;
  const is_active = patch.is_active !== undefined ? normalizeActive(patch.is_active) : current.is_active;
  const sort_order =
    patch.sort_order !== undefined ? normalizeSortOrder(patch.sort_order) : current.sort_order;
  if (!headline) throw new Error('Nadpis je povinný.');
  if (headline.length > 100) throw new Error('Nadpis může mít maximálně 100 znaků.');
  if (!title) throw new Error('Název je povinný.');
  if (!file_path) throw new Error('U upload videa je povinný soubor.');

  if (current.file_path && current.file_path !== file_path) {
    unlinkLocalReelFile(current.file_path);
  }

  getDb()
    .prepare(
      `UPDATE reels
       SET headline = ?, title = ?, source_type = ?, source_url = ?, file_path = ?, poster_image = ?, is_active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      headline,
      title,
      source_type,
      null,
      file_path,
      poster_image,
      is_active,
      sort_order,
      new Date().toISOString(),
      id
    );
  return getById(id);
}

function deleteReel(id) {
  const row = getById(id);
  if (row && row.file_path) unlinkLocalReelFile(row.file_path);
  getDb()
    .prepare(`DELETE FROM reels WHERE id = ?`)
    .run(id);
}

module.exports = {
  listAll,
  listAllForAdminFilteredPaged,
  countAllForAdminFiltered,
  listActive,
  getById,
  createReel,
  updateReel,
  deleteReel,
};

const { getDb } = require('../db');

const STATUS_OPTIONS = ['Budeme', 'Byli jsme', 'Sponzorujeme'];

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

function normalizeStatus(v) {
  const t = normalizeText(v);
  if (!t) return null;
  return STATUS_OPTIONS.includes(t) ? t : t;
}

function normalizeLink(v) {
  const t = normalizeText(v);
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function nextSortOrder() {
  const row = getDb().prepare(`SELECT MAX(sort_order) AS m FROM pomaha_events`).get();
  return (row && row.m != null ? row.m : -1) + 1;
}

function listAllForAdmin() {
  return getDb()
    .prepare(
      `SELECT id, status, title, event_date, place, note, link_url, is_published, sort_order, created_at, updated_at
       FROM pomaha_events
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
}

function listPublishedForWeb() {
  return getDb()
    .prepare(
      `SELECT id, status, title, event_date, place, note, link_url
       FROM pomaha_events
       WHERE is_published = 1
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
}

function create(data) {
  const now = nowIso();
  const title = normalizeText(data.title);
  if (!title) {
    const err = new Error('Název akce je povinný.');
    err.code = 'VALIDATION';
    throw err;
  }

  const r = getDb()
    .prepare(
      `INSERT INTO pomaha_events (status, title, event_date, place, note, link_url, is_published, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      normalizeStatus(data.status),
      title,
      normalizeText(data.event_date),
      normalizeText(data.place),
      normalizeText(data.note),
      normalizeLink(data.link_url),
      data.is_published ? 1 : 0,
      nextSortOrder(),
      now,
      now
    );
  return r.lastInsertRowid;
}

function update(id, data) {
  const now = nowIso();
  const title = normalizeText(data.title);
  if (!title) {
    const err = new Error('Název akce je povinný.');
    err.code = 'VALIDATION';
    throw err;
  }
  getDb()
    .prepare(
      `UPDATE pomaha_events
       SET status = ?, title = ?, event_date = ?, place = ?, note = ?, link_url = ?, is_published = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      normalizeStatus(data.status),
      title,
      normalizeText(data.event_date),
      normalizeText(data.place),
      normalizeText(data.note),
      normalizeLink(data.link_url),
      data.is_published ? 1 : 0,
      now,
      id
    );
}

function reorder(orderedIds) {
  const now = nowIso();
  const stmt = getDb().prepare(
    `UPDATE pomaha_events SET sort_order = ?, updated_at = ? WHERE id = ?`
  );
  orderedIds.forEach((id, index) => stmt.run(index, now, id));
}

function move(id, direction) {
  const items = listAllForAdmin();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  const target = idx + direction;
  if (target < 0 || target >= items.length) return false;
  const ids = items.map((i) => i.id);
  const t = ids[idx];
  ids[idx] = ids[target];
  ids[target] = t;
  reorder(ids);
  return true;
}

function remove(id) {
  getDb().prepare(`DELETE FROM pomaha_events WHERE id = ?`).run(id);
  const remaining = listAllForAdmin().map((i) => i.id);
  reorder(remaining);
}

module.exports = {
  STATUS_OPTIONS,
  listAllForAdmin,
  listPublishedForWeb,
  create,
  update,
  move,
  remove,
};

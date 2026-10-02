const { getDb } = require('../db');

const DEFAULT_SLOTS = [
  'home_top_728',
  'home_sidebar_300',
  'article_sidebar_300',
];

const CREATIVE_SLOTS = [
  {
    slot: 'home_below_social',
    label: 'Reklama #1 – pod Sleduj nás (homepage)',
  },
  {
    slot: 'article_between_google_penalty',
    label: 'Reklama #2 – mezi Google zprávy a Penalty (článek)',
  },
];

function listAll() {
  return getDb().prepare(`SELECT * FROM ads ORDER BY slot`).all();
}

function getBySlot(slot) {
  return getDb().prepare(`SELECT * FROM ads WHERE slot = ?`).get(slot);
}

function getActiveMap() {
  const rows = getDb()
    .prepare(`SELECT slot, content_html, image_path, link_url, active, label FROM ads WHERE active = 1`)
    .all();
  const map = {};
  for (const r of rows) {
    map[r.slot] = r;
  }
  return map;
}

function updateSlot(slot, { label, content_html, link_url, active, image_path }) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE ads SET label = ?, content_html = ?, link_url = ?, image_path = ?, active = ?, updated_at = ?
       WHERE slot = ?`
    )
    .run(
      label ?? null,
      content_html ?? null,
      link_url ?? null,
      image_path ?? null,
      active ? 1 : 0,
      now,
      slot
    );
}

function normalizeLinkUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function listCreativesBySlot(slot) {
  return getDb()
    .prepare(
      `SELECT * FROM ad_creatives
       WHERE slot = ?
       ORDER BY sort_order ASC, id DESC`
    )
    .all(String(slot || ''));
}

function listActiveCreativesBySlot(slot) {
  return getDb()
    .prepare(
      `SELECT * FROM ad_creatives
       WHERE slot = ? AND is_active = 1
       ORDER BY sort_order ASC, id DESC`
    )
    .all(String(slot || ''));
}

function getCreativeById(id) {
  return getDb().prepare(`SELECT * FROM ad_creatives WHERE id = ?`).get(id);
}

function createCreative({ slot, image_path, link_url, is_active = 1, sort_order = 0 }) {
  const now = new Date().toISOString();
  const link = normalizeLinkUrl(link_url);
  const info = getDb()
    .prepare(
      `INSERT INTO ad_creatives (slot, image_path, link_url, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(slot || ''),
      String(image_path || ''),
      link,
      is_active ? 1 : 0,
      Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0,
      now,
      now
    );
  return getCreativeById(info.lastInsertRowid);
}

function updateCreative(id, { link_url, is_active, image_path, sort_order }) {
  const cur = getCreativeById(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  const nextLink = link_url !== undefined ? normalizeLinkUrl(link_url) : cur.link_url;
  const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : cur.is_active;
  const nextImage = image_path !== undefined ? image_path || cur.image_path : cur.image_path;
  const nextSort =
    sort_order !== undefined && Number.isFinite(Number(sort_order))
      ? Number(sort_order)
      : cur.sort_order;
  getDb()
    .prepare(
      `UPDATE ad_creatives
       SET image_path = ?, link_url = ?, is_active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextImage, nextLink, nextActive, nextSort, now, id);
  return getCreativeById(id);
}

function deleteCreative(id) {
  const cur = getCreativeById(id);
  if (!cur) return null;
  getDb().prepare(`DELETE FROM ad_creatives WHERE id = ?`).run(id);
  return cur;
}

function pickCreative(slot) {
  const rows = listActiveCreativesBySlot(slot);
  if (!rows.length) return null;
  const idx = Math.floor(Math.random() * rows.length);
  return rows[idx] || null;
}

function listCreativeSlotsWithItems() {
  return CREATIVE_SLOTS.map((meta) => ({
    ...meta,
    creatives: listCreativesBySlot(meta.slot),
  }));
}

module.exports = {
  DEFAULT_SLOTS,
  CREATIVE_SLOTS,
  listAll,
  getBySlot,
  getActiveMap,
  updateSlot,
  normalizeLinkUrl,
  listCreativesBySlot,
  listActiveCreativesBySlot,
  getCreativeById,
  createCreative,
  updateCreative,
  deleteCreative,
  pickCreative,
  listCreativeSlotsWithItems,
};

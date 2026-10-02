const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { optimizeUploadImage } = require('../lib/optimize-upload-image');
const { cleanTitle } = require('./ai-rss');
const { classifyItem } = require('./ai-tags');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function nowIso() {
  return new Date().toISOString();
}

function ensureTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      filter TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'inbox',
      source_id INTEGER,
      source_name TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL UNIQUE,
      source_title TEXT NOT NULL DEFAULT '',
      source_perex TEXT NOT NULL DEFAULT '',
      source_body TEXT NOT NULL DEFAULT '',
      source_image TEXT,
      source_published_at TEXT,
      title TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      body_blocks_json TEXT,
      category TEXT,
      tag TEXT,
      author_id INTEGER,
      article_id INTEGER,
      published_url TEXT,
      rewrite_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_queue_status ON ai_queue (status, created_at DESC);
  `);
}

const DEFAULT_SOURCES = [
  {
    name: 'Sport.cz fotbal',
    url: 'https://www.sport.cz/rss/fotbal',
    filter: 'fotbal',
  },
  {
    name: 'iSport fotbal',
    url: 'https://isport.blesk.cz/rss/56',
    filter: '',
  },
  {
    name: 'inFotbal',
    url: 'https://infotbal.cz/feed/',
    filter: '',
  },
  {
    name: 'TransferFeed Chance Liga',
    url: 'https://www.transferfeed.com/leagues/fortuna-liga/96',
    filter: '',
  },
  {
    name: 'eFotbal Chance Liga',
    url: 'https://www.efotbal.cz/topic/chance-liga-18da4ffd-45bc-4447-bc04-ed5f5120c048',
    filter: '',
  },
  {
    name: 'Livesport fotbal',
    url: 'https://www.livesport.cz/zpravy/fotbal/',
    filter: '',
  },
  {
    name: 'Fortuna Liga žen',
    url: 'https://www.fortunaligazen.cz',
    filter: '',
  },
];

const OBSOLETE_SOURCE_URLS = [
  'https://isport.blesk.cz/rss',
  'https://www.sport.cz/rss',
  'https://news.google.com/rss/search?q=site:efotbal.cz+when:7d&hl=cs&gl=CZ&ceid=CZ:cs',
];

function seedSourcesIfEmpty() {
  syncDefaultSources();
}

function syncDefaultSources() {
  ensureTables();
  const db = getDb();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO ai_sources (name, url, filter, enabled, created_at) VALUES (?, ?, ?, 1, ?)`
  );
  const update = db.prepare(
    `UPDATE ai_sources SET name = ?, url = ?, filter = ?, enabled = 1, last_error = NULL WHERE id = ?`
  );

  for (const source of DEFAULT_SOURCES) {
    const existing = db
      .prepare(`SELECT id FROM ai_sources WHERE url = ? OR name = ?`)
      .get(source.url, source.name);
    if (existing) {
      update.run(source.name, source.url, source.filter, existing.id);
    } else {
      insert.run(source.name, source.url, source.filter, now);
    }
  }

  if (OBSOLETE_SOURCE_URLS.length) {
    db.prepare(
      `DELETE FROM ai_sources WHERE url IN (${OBSOLETE_SOURCE_URLS.map(() => '?').join(',')})`
    ).run(...OBSOLETE_SOURCE_URLS);
  }
  sanitizeStoredTitles();
  sanitizeStoredLabels();
}

function listSources() {
  ensureTables();
  return getDb()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM ai_queue q WHERE q.source_id = s.id) AS article_count
       FROM ai_sources s ORDER BY s.id ASC`
    )
    .all();
}

function listEnabledSources() {
  ensureTables();
  return getDb().prepare(`SELECT * FROM ai_sources WHERE enabled = 1 ORDER BY id ASC`).all();
}

function createSource({ name, url, filter }) {
  ensureTables();
  const info = getDb()
    .prepare(`INSERT INTO ai_sources (name, url, filter, enabled, created_at) VALUES (?, ?, ?, 1, ?)`)
    .run(String(name || '').trim(), String(url || '').trim(), String(filter || '').trim(), nowIso());
  return info.lastInsertRowid;
}

function toggleSource(id, enabled) {
  getDb().prepare(`UPDATE ai_sources SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

function deleteSource(id) {
  getDb().prepare(`DELETE FROM ai_sources WHERE id = ?`).run(id);
}

function markSourceFetched(id, error) {
  getDb()
    .prepare(`UPDATE ai_sources SET last_fetched_at = ?, last_error = ? WHERE id = ?`)
    .run(nowIso(), error || null, id);
}

function getLastFetchedAt() {
  ensureTables();
  const row = getDb()
    .prepare(`SELECT MAX(last_fetched_at) AS t FROM ai_sources WHERE enabled = 1`)
    .get();
  return row && row.t ? row.t : null;
}

function countByStatus(status) {
  ensureTables();
  if (status) {
    return getDb().prepare(`SELECT COUNT(*) AS n FROM ai_queue WHERE status = ?`).get(status).n;
  }
  return getDb().prepare(`SELECT COUNT(*) AS n FROM ai_queue`).get().n;
}

function polishQueueRow(row) {
  if (!row) return row;
  return {
    ...row,
    source_title: cleanTitle(row.source_title || ''),
    title: cleanTitle(row.title || '') || row.title,
  };
}

function sanitizeStoredTitles() {
  ensureTables();
  const rows = getDb().prepare(`SELECT id, source_title, title FROM ai_queue`).all();
  const upd = getDb().prepare(`UPDATE ai_queue SET source_title = ?, title = ? WHERE id = ?`);
  for (const row of rows) {
    const sourceTitle = cleanTitle(row.source_title || '');
    const title = cleanTitle(row.title || '') || row.title || '';
    if (sourceTitle !== row.source_title || title !== row.title) {
      upd.run(sourceTitle, title, row.id);
    }
  }
}

function sanitizeStoredLabels() {
  ensureTables();
  const rows = getDb()
    .prepare(`SELECT id, source_name, source_title, source_perex, title, excerpt, category, tag FROM ai_queue`)
    .all();
  const upd = getDb().prepare(`UPDATE ai_queue SET category = ?, tag = ? WHERE id = ?`);
  for (const row of rows) {
    const labels = classifyItem({
      source_name: row.source_name,
      source_title: row.source_title || row.title,
      source_perex: row.source_perex || row.excerpt,
    });
    if (labels.category !== row.category || labels.tag !== row.tag) {
      upd.run(labels.category, labels.tag, row.id);
    }
  }
}

function listQueue(status, limit = 60) {
  ensureTables();
  const rows = status
    ? getDb()
        .prepare(`SELECT * FROM ai_queue WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
        .all(status, limit)
    : getDb().prepare(`SELECT * FROM ai_queue ORDER BY created_at DESC LIMIT ?`).all(limit);
  return rows.map(polishQueueRow);
}

function getQueueItem(id) {
  ensureTables();
  return polishQueueRow(getDb().prepare(`SELECT * FROM ai_queue WHERE id = ?`).get(id));
}

function findBySourceUrl(url) {
  return getDb().prepare(`SELECT * FROM ai_queue WHERE source_url = ?`).get(url);
}

function insertInbox(row) {
  ensureTables();
  const now = nowIso();
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO ai_queue (
          status, source_id, source_name, source_url, source_title, source_perex, source_body,
          source_image, source_published_at, title, excerpt, body_html, category, tag, author_id,
          created_at, updated_at
        ) VALUES ('inbox', ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, ?, ?)`
      )
      .run(
        row.source_id || null,
        row.source_name || '',
        row.source_url,
        cleanTitle(row.source_title || ''),
        row.source_perex || '',
        row.source_body || '',
        row.source_image || null,
        row.source_published_at || null,
        row.category || 'Český Fotbal',
        row.tag || null,
        row.author_id || null,
        now,
        now
      );
    return getQueueItem(info.lastInsertRowid);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return findBySourceUrl(row.source_url);
    throw err;
  }
}

function updateQueueItem(id, patch) {
  const cur = getQueueItem(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updated_at: nowIso() };
  getDb()
    .prepare(
      `UPDATE ai_queue SET
        status = ?, title = ?, excerpt = ?, body_html = ?, body_blocks_json = ?,
        category = ?, tag = ?, author_id = ?, source_image = ?,
        article_id = ?, published_url = ?, rewrite_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.status,
      next.title || '',
      next.excerpt || '',
      next.body_html || '',
      next.body_blocks_json || null,
      next.category || null,
      next.tag || null,
      next.author_id || null,
      next.source_image || null,
      next.article_id || null,
      next.published_url || null,
      next.rewrite_error || null,
      next.updated_at,
      id
    );
  return getQueueItem(id);
}

function listPendingRewrite(limit = 8) {
  ensureTables();
  return getDb()
    .prepare(
      `SELECT * FROM ai_queue WHERE status IN ('inbox', 'failed') ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit);
}

async function saveHeroImage(imageUrl, options = {}) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), options.timeoutMs || 20000);
  try {
    const headers = {
      'User-Agent': UA,
      Accept: 'image/*,*/*',
      ...(options.headers || {}),
    };
    const res = await fetch(imageUrl, {
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.length > 12 * 1024 * 1024) return null;
    const type = String(res.headers.get('content-type') || '');
    let ext = '.jpg';
    if (type.includes('png') || imageUrl.toLowerCase().includes('.png')) ext = '.png';
    else if (type.includes('webp')) ext = '.webp';
    const destDir = path.join(__dirname, '..', 'public', 'uploads', 'articles');
    fs.mkdirSync(destDir, { recursive: true });
    const filename = crypto.randomBytes(16).toString('hex') + ext;
    const abs = path.join(destDir, filename);
    fs.writeFileSync(abs, buf);
    try {
      await optimizeUploadImage(abs);
    } catch {
      /* keep original */
    }
    return `/uploads/articles/${filename}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  UA,
  ensureTables,
  seedSourcesIfEmpty,
  syncDefaultSources,
  listSources,
  listEnabledSources,
  createSource,
  toggleSource,
  deleteSource,
  markSourceFetched,
  getLastFetchedAt,
  countByStatus,
  listQueue,
  getQueueItem,
  findBySourceUrl,
  insertInbox,
  updateQueueItem,
  listPendingRewrite,
  saveHeroImage,
  sanitizeStoredTitles,
  sanitizeStoredLabels,
};

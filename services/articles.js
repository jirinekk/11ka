const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { sanitizeArticleBody } = require('../lib/html');
const { uniqueSlug } = require('../lib/slug');
const chanceLigaLogos = require('./chance-liga-logos');
const { getRubric } = require('../config/rubrics');

const TITLE_MAX = 100;
const EXCERPT_MAX = 250;

function clipTitle(value) {
  return String(value || '').trim().slice(0, TITLE_MAX);
}

function clipExcerpt(value) {
  if (value == null || value === '') return null;
  const t = String(value).trim();
  if (!t) return null;
  return t.slice(0, EXCERPT_MAX);
}

function articleCopyError(title, excerpt) {
  const t = String(title || '').trim();
  if (!t) return 'Nadpis je povinný.';
  if (t.length > TITLE_MAX) return `Nadpis může mít maximálně ${TITLE_MAX} znaků.`;
  const e = excerpt == null || excerpt === '' ? '' : String(excerpt).trim();
  if (e.length > EXCERPT_MAX) return `Perex může mít maximálně ${EXCERPT_MAX} znaků.`;
  return null;
}

let _hasTagColumnCache = null;
let _hasBlocksColumnCache = null;
let _hasHeroPositionColumnCache = null;
let _hasHeroCardPositionColumnCache = null;
let _hasHeroSliderMobilePositionColumnCache = null;
let _hasHeroSliderDesktopPositionColumnCache = null;
let _hasLineupColumnCache = null;
let _hasSourcesColumnCache = null;
const { serializeLineup } = require('../lib/lineup');
function hasArticlesTagColumn() {
  if (_hasTagColumnCache != null) return _hasTagColumnCache;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    const has = Array.isArray(cols) && cols.some((c) => c && c.name === 'tag');
    if (!has) {
      // Ensure column exists even without server restart.
      try {
        getDb().exec(`ALTER TABLE articles ADD COLUMN tag TEXT;`);
      } catch {
        /* ignore */
      }
      const cols2 = getDb().prepare(`PRAGMA table_info(articles)`).all();
      _hasTagColumnCache = Array.isArray(cols2) && cols2.some((c) => c && c.name === 'tag');
      return _hasTagColumnCache;
    }
    _hasTagColumnCache = true;
  } catch {
    _hasTagColumnCache = false;
  }
  return _hasTagColumnCache;
}

function hasArticlesBlocksColumn() {
  if (_hasBlocksColumnCache != null) return _hasBlocksColumnCache;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    const has = Array.isArray(cols) && cols.some((c) => c && c.name === 'body_blocks_json');
    if (!has) {
      try {
        getDb().exec(`ALTER TABLE articles ADD COLUMN body_blocks_json TEXT;`);
      } catch {
        /* ignore */
      }
      const cols2 = getDb().prepare(`PRAGMA table_info(articles)`).all();
      _hasBlocksColumnCache = Array.isArray(cols2) && cols2.some((c) => c && c.name === 'body_blocks_json');
      return _hasBlocksColumnCache;
    }
    _hasBlocksColumnCache = true;
  } catch {
    _hasBlocksColumnCache = false;
  }
  return _hasBlocksColumnCache;
}

function hasArticlesHeroPositionColumn() {
  if (_hasHeroPositionColumnCache === true) return true;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    const has = Array.isArray(cols) && cols.some((c) => c && c.name === 'hero_position');
    if (!has) {
      try {
        getDb().exec(`ALTER TABLE articles ADD COLUMN hero_position TEXT;`);
      } catch {
        /* ignore */
      }
      const cols2 = getDb().prepare(`PRAGMA table_info(articles)`).all();
      _hasHeroPositionColumnCache =
        Array.isArray(cols2) && cols2.some((c) => c && c.name === 'hero_position');
      return _hasHeroPositionColumnCache;
    }
    _hasHeroPositionColumnCache = true;
  } catch {
    _hasHeroPositionColumnCache = false;
  }
  return _hasHeroPositionColumnCache;
}

function hasArticlesHeroCardPositionColumn() {
  if (_hasHeroCardPositionColumnCache === true) return true;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    const has = Array.isArray(cols) && cols.some((c) => c && c.name === 'hero_card_position');
    if (!has) {
      try {
        getDb().exec(`ALTER TABLE articles ADD COLUMN hero_card_position TEXT;`);
      } catch {
        /* ignore */
      }
      const cols2 = getDb().prepare(`PRAGMA table_info(articles)`).all();
      _hasHeroCardPositionColumnCache =
        Array.isArray(cols2) && cols2.some((c) => c && c.name === 'hero_card_position');
      return _hasHeroCardPositionColumnCache;
    }
    _hasHeroCardPositionColumnCache = true;
  } catch {
    _hasHeroCardPositionColumnCache = false;
  }
  return _hasHeroCardPositionColumnCache;
}

function ensureArticlesHeroColumn(columnName, cacheRef) {
  if (cacheRef.value === true) return true;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    const has = Array.isArray(cols) && cols.some((c) => c && c.name === columnName);
    if (!has) {
      try {
        getDb().exec(`ALTER TABLE articles ADD COLUMN ${columnName} TEXT;`);
      } catch {
        /* ignore */
      }
      const cols2 = getDb().prepare(`PRAGMA table_info(articles)`).all();
      cacheRef.value =
        Array.isArray(cols2) && cols2.some((c) => c && c.name === columnName);
      return cacheRef.value;
    }
    cacheRef.value = true;
  } catch {
    cacheRef.value = false;
  }
  return cacheRef.value;
}

const _heroSliderMobileColumnCache = { value: null };
const _heroSliderDesktopColumnCache = { value: null };

function hasArticlesHeroSliderMobilePositionColumn() {
  if (_hasHeroSliderMobilePositionColumnCache === true) return true;
  if (_hasHeroSliderMobilePositionColumnCache === false) return false;
  const ok = ensureArticlesHeroColumn('hero_slider_mobile_position', _heroSliderMobileColumnCache);
  _hasHeroSliderMobilePositionColumnCache = ok;
  return ok;
}

function hasArticlesHeroSliderDesktopPositionColumn() {
  if (_hasHeroSliderDesktopPositionColumnCache === true) return true;
  if (_hasHeroSliderDesktopPositionColumnCache === false) return false;
  const ok = ensureArticlesHeroColumn('hero_slider_desktop_position', _heroSliderDesktopColumnCache);
  _hasHeroSliderDesktopPositionColumnCache = ok;
  return ok;
}

function resolveStoredHeroPosition(value, ...fallbacks) {
  const candidates = [value, ...fallbacks];
  for (let i = 0; i < candidates.length; i += 1) {
    const normalized = normalizeHeroPosition(candidates[i]);
    if (normalized) return normalized;
  }
  return '50% 50%';
}

function hasArticlesLineupColumn() {
  if (_hasLineupColumnCache === true) return true;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    const has = Array.isArray(cols) && cols.some((c) => c && c.name === 'lineup_json');
    if (!has) {
      try {
        getDb().exec(`ALTER TABLE articles ADD COLUMN lineup_json TEXT;`);
      } catch {
        /* ignore */
      }
      const cols2 = getDb().prepare(`PRAGMA table_info(articles)`).all();
      _hasLineupColumnCache =
        Array.isArray(cols2) && cols2.some((c) => c && c.name === 'lineup_json');
      return _hasLineupColumnCache;
    }
    _hasLineupColumnCache = true;
  } catch {
    _hasLineupColumnCache = false;
  }
  return _hasLineupColumnCache;
}

function hasArticlesSourcesColumn() {
  if (_hasSourcesColumnCache === true) return true;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    const has = Array.isArray(cols) && cols.some((c) => c && c.name === 'sources');
    if (!has) {
      try {
        getDb().exec(`ALTER TABLE articles ADD COLUMN sources TEXT;`);
      } catch {
        /* ignore */
      }
      const cols2 = getDb().prepare(`PRAGMA table_info(articles)`).all();
      _hasSourcesColumnCache =
        Array.isArray(cols2) && cols2.some((c) => c && c.name === 'sources');
      return _hasSourcesColumnCache;
    }
    _hasSourcesColumnCache = true;
  } catch {
    _hasSourcesColumnCache = false;
  }
  return _hasSourcesColumnCache;
}

function normalizeSources(value) {
  if (value == null || value === '') return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function hasArticlesColumn(name) {
  try {
    const cols = getDb().prepare(`PRAGMA table_info(articles)`).all();
    return Array.isArray(cols) && cols.some((c) => c && c.name === name);
  } catch {
    return false;
  }
}

function parseRelatedIds(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => parseInt(item, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => parseInt(item, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
  } catch {
    /* ignore */
  }
  return [];
}

function normalizeRubricSlug(value) {
  const slug = String(value || '').trim();
  return getRubric(slug) ? slug : null;
}

function listArticleTeamCodes(articleId) {
  return getDb()
    .prepare(`SELECT team_code FROM article_teams WHERE article_id = ? ORDER BY team_code`)
    .all(articleId)
    .map((row) => row.team_code);
}

function setArticleTeams(articleId, codes) {
  const unique = [];
  const seen = new Set();
  for (const raw of codes || []) {
    const code = String(raw || '').trim().toLowerCase();
    if (!chanceLigaLogos.isClubCode(code) || seen.has(code)) continue;
    seen.add(code);
    unique.push(code);
  }
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM article_teams WHERE article_id = ?`).run(articleId);
    const insert = db.prepare(
      `INSERT INTO article_teams (article_id, team_code) VALUES (?, ?)`
    );
    for (const code of unique) insert.run(articleId, code);
  });
  tx();
  return unique;
}

function normalizeMatchKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('chance:')) {
    const slug = raw.slice(7).trim();
    return slug ? `chance:${slug}` : null;
  }
  return null;
}

function parseMatchKey(value) {
  const key = normalizeMatchKey(value);
  if (!key) return null;
  const slug = key.slice(7);
  return { type: 'chance', slug, href: `/zapasy/chance/${encodeURIComponent(slug)}` };
}

function persistCommunityFields(articleId, { mentionedTeamCodes, relatedArticleIds, rubricSlug, matchKey } = {}) {
  if (!articleId) return;
  if (mentionedTeamCodes !== undefined) {
    setArticleTeams(articleId, mentionedTeamCodes);
  }
  if (relatedArticleIds !== undefined && hasArticlesColumn('related_article_ids')) {
    const ids = parseRelatedIds(relatedArticleIds).filter((id) => id !== Number(articleId));
    getDb()
      .prepare(`UPDATE articles SET related_article_ids = ? WHERE id = ?`)
      .run(JSON.stringify(ids), articleId);
  }
  if (rubricSlug !== undefined && hasArticlesColumn('rubric_slug')) {
    getDb()
      .prepare(`UPDATE articles SET rubric_slug = ? WHERE id = ?`)
      .run(normalizeRubricSlug(rubricSlug), articleId);
  }
  if (matchKey !== undefined && hasArticlesColumn('match_key')) {
    getDb()
      .prepare(`UPDATE articles SET match_key = ? WHERE id = ?`)
      .run(normalizeMatchKey(matchKey), articleId);
  }
}

function listPublishedByMatchKey(matchKey, limit = 8) {
  const key = normalizeMatchKey(matchKey);
  if (!key || !hasArticlesColumn('match_key')) return [];
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(24, Number(limit))) : 8;
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published' AND a.match_key = ?
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(key, lim);
}

function getMentionedTeams(articleId) {
  return chanceLigaLogos.clubsFromCodes(listArticleTeamCodes(articleId));
}

function listPublishedByTeamCode(code, limit = 6) {
  const key = String(code || '').trim().toLowerCase();
  if (!key) return [];
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(24, Number(limit))) : 6;
  try {
    return getDb()
      .prepare(
        `SELECT a.*, u.display_name AS author_display
         FROM articles a
         JOIN article_teams t ON t.article_id = a.id
         JOIN users u ON u.id = a.author_id
         WHERE a.status = 'published' AND t.team_code = ?
         ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
         LIMIT ?`
      )
      .all(key, lim);
  } catch {
    return [];
  }
}

function listRelatedByIds(ids, excludeId, limit) {
  const unique = [];
  const seen = new Set();
  for (const id of ids || []) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0 || n === Number(excludeId) || seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  if (!unique.length) return [];
  const lim = limit != null ? limit : unique.length;
  const rows = getDb()
    .prepare(
      `SELECT
         a.id,
         a.slug,
         a.title,
         a.excerpt,
         a.category,
         a.tag,
         a.hero_image_path,
         a.hero_position,
         a.hero_card_position,
         a.published_at,
         a.created_at
       FROM articles a
       WHERE a.status = 'published'
         AND a.id IN (${unique.map(() => '?').join(', ')})`
    )
    .all(...unique);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.map((id) => byId.get(id)).filter(Boolean).slice(0, lim);
}

function listForRelatedPicker(excludeId, selectedIds = [], limit = 40) {
  const lim = limit != null ? limit : 40;
  const latest = getDb()
    .prepare(
      `SELECT a.id, a.slug, a.title, a.published_at, a.created_at, a.status
       FROM articles a
       WHERE a.status = 'published' AND (? IS NULL OR a.id != ?)
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(excludeId || null, excludeId || 0, lim);
  const have = new Set(latest.map((row) => row.id));
  const extras = [];
  for (const id of selectedIds) {
    if (have.has(id) || id === Number(excludeId)) continue;
    const row = getDb()
      .prepare(
        `SELECT a.id, a.slug, a.title, a.published_at, a.created_at, a.status
         FROM articles a WHERE a.id = ? AND a.status = 'published'`
      )
      .get(id);
    if (row) extras.push(row);
  }
  return extras.concat(latest);
}

function normalizeLineupJson(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  const serialized = serializeLineup(value);
  return serialized || null;
}

function normalizeHeroPosition(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/);
  if (!m) return null;
  const x = Math.max(0, Math.min(100, Number(m[1])));
  const y = Math.max(0, Math.min(100, Number(m[2])));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `${x}% ${y}%`;
}

function rowToArticle(row) {
  if (!row) return null;
  return { ...row };
}

function getById(id) {
  return rowToArticle(getDb().prepare(`SELECT * FROM articles WHERE id = ?`).get(id));
}

function getBySlug(slug) {
  return rowToArticle(getDb().prepare(`SELECT * FROM articles WHERE slug = ?`).get(slug));
}

function slugExists(slug, excludeId) {
  const row = getDb().prepare(`SELECT id FROM articles WHERE slug = ?`).get(slug);
  if (!row) return false;
  if (excludeId != null && row.id === excludeId) return false;
  return true;
}

function listPending() {
  return getDb()
    .prepare(
      `SELECT a.*, u.email AS author_email, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'pending' ORDER BY a.updated_at DESC`
    )
    .all();
}

function listPendingPaged(limit, offset) {
  const lim = limit != null ? limit : 7;
  const off = offset != null ? offset : 0;
  return getDb()
    .prepare(
      `SELECT a.*, u.email AS author_email, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'pending'
       ORDER BY a.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(lim, off);
}

function countPending() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM articles WHERE status = 'pending'`).get().n;
}

function listForAuthor(userId) {
  return getDb()
    .prepare(`SELECT * FROM articles WHERE author_id = ? ORDER BY updated_at DESC`)
    .all(userId);
}

function listAllForAdmin() {
  return getDb()
    .prepare(
      `SELECT a.*, u.email AS author_email, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       ORDER BY a.updated_at DESC`
    )
    .all();
}

function listAllForAdminPaged(limit, offset) {
  const lim = limit != null ? limit : 8;
  const off = offset != null ? offset : 0;
  return getDb()
    .prepare(
      `SELECT a.*, u.email AS author_email, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       ORDER BY a.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(lim, off);
}

function countAllForAdmin() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM articles`).get().n;
}

function buildAdminArticlesFilterWhere(filters) {
  const where = [];
  const params = [];
  const f = filters || {};
  const q = f.q != null ? String(f.q).trim() : '';
  const status = f.status != null ? String(f.status).trim() : '';

  if (q) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    where.push(
      `(a.title LIKE ? ESCAPE '\\' OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\' OR IFNULL(u.display_name, '') LIKE ? ESCAPE '\\' OR IFNULL(u.email, '') LIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like, like);
  }

  if (status) {
    where.push(`a.status = ?`);
    params.push(status);
  }

  const category = f.category != null ? String(f.category).trim() : '';
  if (category) {
    where.push(`IFNULL(a.category, '') = ?`);
    params.push(category);
  }

  const authorId = f.author_id != null ? parseInt(f.author_id, 10) : null;
  if (Number.isFinite(authorId) && authorId > 0) {
    where.push(`a.author_id = ?`);
    params.push(authorId);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function listAllForAdminFilteredPaged(limit, offset, filters) {
  const lim = limit != null ? limit : 8;
  const off = offset != null ? offset : 0;
  const { clause, params } = buildAdminArticlesFilterWhere(filters);
  return getDb()
    .prepare(
      `SELECT a.*, u.email AS author_email, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       ${clause}
       ORDER BY a.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, lim, off);
}

function countAllForAdminFiltered(filters) {
  const { clause, params } = buildAdminArticlesFilterWhere(filters);
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM articles a JOIN users u ON u.id = a.author_id
       ${clause}`
    )
    .get(...params).n;
}

function listPublishedLatestSafe(limit) {
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display, u.email AS author_email
       FROM articles a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(limit);
}

function listPublishedLatestPaged(limit, offset, tag) {
  const lim = limit != null ? limit : 6;
  const off = offset != null ? offset : 0;
  const tg = tag != null ? String(tag).trim() : '';
  const canTag = hasArticlesTagColumn();
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display, u.email AS author_email
       FROM articles a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
         ${canTag ? 'AND (? = \'\' OR IFNULL(a.tag, \'\') = ?)' : ''}
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...(canTag ? [tg, tg] : []), lim, off);
}

function listMostRead(limit) {
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
       ORDER BY COALESCE(a.view_count, 0) DESC, COALESCE(a.published_at, a.created_at) DESC
       LIMIT ?`
    )
    .all(limit);
}

function listMostReadWeekly(limit = 3) {
  const lim = limit != null ? limit : 3;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekly = getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
         AND COALESCE(a.published_at, a.created_at) >= ?
       ORDER BY COALESCE(a.view_count, 0) DESC, COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(weekAgo, lim);

  if (weekly.length >= lim) return weekly;

  const seen = new Set(weekly.map((row) => row.id));
  const fallback = listMostRead(lim + weekly.length);
  for (const row of fallback) {
    if (seen.has(row.id)) continue;
    weekly.push(row);
    seen.add(row.id);
    if (weekly.length >= lim) break;
  }
  return weekly;
}

function listMostReadPaged(limit, offset) {
  const lim = limit != null ? limit : 6;
  const off = offset != null ? offset : 0;
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display
       FROM articles a JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
       ORDER BY COALESCE(a.view_count, 0) DESC, COALESCE(a.published_at, a.created_at) DESC
       LIMIT ? OFFSET ?`
    )
    .all(lim, off);
}

function countPublished(tag) {
  const tg = tag != null ? String(tag).trim() : '';
  const canTag = hasArticlesTagColumn();
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM articles
       WHERE status = 'published'
         ${canTag ? 'AND (? = \'\' OR IFNULL(tag, \'\') = ?)' : ''}`
    )
    .get(...(canTag ? [tg, tg] : [])).n;
}

function listDistinctCategories(limit = 200) {
  const lim = limit != null ? Number(limit) : 200;
  return getDb()
    .prepare(
      `SELECT DISTINCT TRIM(category) AS category
       FROM articles
       WHERE category IS NOT NULL AND TRIM(category) <> ''
       ORDER BY TRIM(category) COLLATE NOCASE
       LIMIT ?`
    )
    .all(lim)
    .map((r) => r.category)
    .filter(Boolean);
}

function listDistinctTags(limit = 200) {
  if (!hasArticlesTagColumn()) return [];
  const lim = limit != null ? Number(limit) : 200;
  return getDb()
    .prepare(
      `SELECT DISTINCT TRIM(tag) AS tag
       FROM articles
       WHERE tag IS NOT NULL AND TRIM(tag) <> ''
       ORDER BY TRIM(tag) COLLATE NOCASE
       LIMIT ?`
    )
    .all(lim)
    .map((r) => r.tag)
    .filter(Boolean);
}

function countPublishedByAuthor(authorId) {
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND author_id = ?`)
    .get(authorId).n;
}

function listPublishedByAuthorPaged(authorId, limit, offset) {
  const lim = limit != null ? limit : 6;
  const off = offset != null ? offset : 0;
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display, u.email AS author_email
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published' AND a.author_id = ?
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(authorId, lim, off);
}

function listPublishedByCategory(category, limit) {
  const lim = limit != null ? limit : 12;
  const cats = Array.isArray(category)
    ? category.map((c) => (c != null ? String(c).trim() : '')).filter(Boolean)
    : category != null && String(category).trim()
      ? [String(category).trim()]
      : [];
  const db = getDb();
  const baseSelect = `SELECT
         a.id,
         a.slug,
         a.title,
         a.excerpt,
         a.hero_image_path,
         a.hero_position,
         a.published_at,
         a.created_at,
         u.display_name AS author_display
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'`;
  if (!cats.length) {
    const cat = category ? String(category).trim() : '';
    return db
      .prepare(
        `${baseSelect} AND a.category = ?
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
      )
      .all(cat, lim);
  }
  if (cats.length === 1) {
    return db
      .prepare(
        `${baseSelect} AND a.category = ?
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
      )
      .all(cats[0], lim);
  }
  const placeholders = cats.map(() => '?').join(', ');
  return db
    .prepare(
      `${baseSelect} AND a.category IN (${placeholders})
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(...cats, lim);
}

function listPublishedByCategoryPaged(category, limit, offset, tag) {
  const lim = limit != null ? limit : 6;
  const off = offset != null ? offset : 0;
  const tg = tag != null ? String(tag).trim() : '';
  const canTag = hasArticlesTagColumn();
  const cats = Array.isArray(category)
    ? category.map((c) => (c != null ? String(c).trim() : '')).filter(Boolean)
    : category != null && String(category).trim()
      ? [String(category).trim()]
      : [];
  const db = getDb();
  const baseSelect = `SELECT
         a.id,
         a.slug,
         a.title,
         a.excerpt,
         a.hero_image_path,
         a.hero_position,
         a.published_at,
         a.created_at,
         u.display_name AS author_display
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
         ${canTag ? 'AND (? = \'\' OR IFNULL(a.tag, \'\') = ?)' : ''}`;
  if (!cats.length) {
    const cat = category ? String(category).trim() : '';
    return db
      .prepare(
        `${baseSelect} AND a.category = ?
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
      )
      .all(...(canTag ? [tg, tg] : []), cat, lim, off);
  }
  if (cats.length === 1) {
    return db
      .prepare(
        `${baseSelect} AND a.category = ?
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
      )
      .all(...(canTag ? [tg, tg] : []), cats[0], lim, off);
  }
  const placeholders = cats.map(() => '?').join(', ');
  return db
    .prepare(
      `${baseSelect} AND a.category IN (${placeholders})
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...(canTag ? [tg, tg] : []), ...cats, lim, off);
}

function countPublishedByCategory(category, tag, extra = {}) {
  const { clause, params } = categoryScopeClause({
    category,
    tag,
    typeCategory: extra.typeCategory,
    regionTags: extra.regionTags,
  });
  if (clause === ' AND 1=0') return 0;
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM articles a WHERE a.status = 'published'${clause}`)
    .get(...params).n;
}

function listPublishedForSitemap(limit) {
  const lim = limit != null ? limit : 5000;
  return getDb()
    .prepare(
      `SELECT id, slug, title, excerpt, updated_at, published_at, created_at
       FROM articles
       WHERE status = 'published'
       ORDER BY COALESCE(published_at, created_at) DESC, id DESC
       LIMIT ?`
    )
    .all(lim);
}

function listPublishedForRss(limit) {
  const lim = limit != null ? limit : 50;
  return getDb()
    .prepare(
      `SELECT
         a.id,
         a.slug,
         a.title,
         a.excerpt,
         a.category,
         a.hero_image_path,
         a.published_at,
         a.created_at,
         a.updated_at,
         u.display_name AS author_display,
         u.email AS author_email
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(lim);
}

function listRelatedPublished(articleId, category, limit) {
  const lim = limit != null ? limit : 3;
  const cat = category ? String(category).trim() : '';
  return getDb()
    .prepare(
      `SELECT
         a.id,
         a.slug,
         a.title,
         a.excerpt,
         a.category,
         a.tag,
         a.hero_image_path,
         a.hero_position,
         a.hero_card_position,
         a.published_at,
         a.created_at
       FROM articles a
       WHERE a.status = 'published'
         AND a.id != ?
         AND (? = '' OR IFNULL(a.category, '') = ?)
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(articleId, cat, cat, lim);
}

function listRelatedForArticle(article, limit = 3) {
  if (!article) return [];
  const lim = limit != null ? limit : 3;
  const stored = listRelatedByIds(parseRelatedIds(article.related_article_ids), article.id, lim);
  if (stored.length) return stored;
  return listRelatedPublished(article.id, article.category, lim);
}

function searchPublished(query, limit, tag) {
  return searchPublishedFull(query, limit, tag);
}

function searchPublishedFull(query, limit, tag) {
  const q = query ? String(query).trim() : '';
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const lim = limit != null ? limit : 24;
  const tg = tag != null ? String(tag).trim() : '';
  const canTag = hasArticlesTagColumn();
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS author_display, u.email AS author_email
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
         ${canTag ? 'AND (? = \'\' OR IFNULL(a.tag, \'\') = ?)' : ''}
         AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(...(canTag ? [tg, tg] : []), like, like, like, lim);
}

function countSearchPublished(query, tag) {
  const q = query ? String(query).trim() : '';
  if (!q) return 0;
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const tg = tag != null ? String(tag).trim() : '';
  const canTag = hasArticlesTagColumn();
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM articles a
       WHERE a.status = 'published'
         ${canTag ? 'AND (? = \'\' OR IFNULL(a.tag, \'\') = ?)' : ''}
         AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )`
    )
    .get(...(canTag ? [tg, tg] : []), like, like, like).n;
}

function normalizeListingCategories(category) {
  if (Array.isArray(category)) {
    return category.map((c) => (c != null ? String(c).trim() : '')).filter(Boolean);
  }
  if (category != null && String(category).trim()) {
    return [String(category).trim()];
  }
  return [];
}

const TYPE_LISTING_CATEGORIES = ['Zápasy', 'Analýzy', 'Rozhovory'];

function normalizeListingTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((t) => (t != null ? String(t).trim() : '')).filter(Boolean);
  }
  if (tags != null && String(tags).trim()) {
    return [String(tags).trim()];
  }
  return [];
}

function appendExactTagFilter(clause, params, tag) {
  const tg = tag != null ? String(tag).trim() : '';
  if (!tg) return { clause, params };
  return {
    clause: `${clause} AND IFNULL(a.tag, '') = ?`,
    params: [...params, tg],
  };
}

function categoryScopeClause({ category, tag, typeCategory, regionTags } = {}) {
  const cats = normalizeListingCategories(category);
  const tg = tag != null ? String(tag).trim() : '';
  const typeCat = typeCategory != null ? String(typeCategory).trim() : '';
  const rTags = normalizeListingTags(regionTags);

  if (typeCat) {
    const parts = [];
    const params = [];
    if (cats.length) {
      parts.push(
        `(LOWER(TRIM(a.category)) IN (${cats.map(() => 'LOWER(?)').join(', ')}) AND IFNULL(a.tag, '') = ?)`
      );
      params.push(...cats, typeCat);
    }
    if (rTags.length) {
      parts.push(
        `(LOWER(TRIM(a.category)) = LOWER(?) AND IFNULL(a.tag, '') IN (${rTags.map(() => '?').join(', ')}))`
      );
      params.push(typeCat, ...rTags);
    } else {
      parts.push(`LOWER(TRIM(a.category)) = LOWER(?)`);
      params.push(typeCat);
    }
    if (!parts.length) {
      return { clause: ' AND 1=0', params: [] };
    }
    return appendExactTagFilter(` AND (${parts.join(' OR ')})`, params, tg);
  }

  if (!cats.length) {
    return { clause: ' AND 1=0', params: [] };
  }

  if (rTags.length) {
    const parts = [
      `LOWER(TRIM(a.category)) IN (${cats.map(() => 'LOWER(?)').join(', ')})`,
      `(LOWER(TRIM(a.category)) IN (${TYPE_LISTING_CATEGORIES.map(() => 'LOWER(?)').join(', ')}) AND IFNULL(a.tag, '') IN (${rTags.map(() => '?').join(', ')}))`,
    ];
    const params = [...cats, ...TYPE_LISTING_CATEGORIES, ...rTags];
    return appendExactTagFilter(` AND (${parts.join(' OR ')})`, params, tg);
  }

  if (tg) {
    if (cats.length === 1) {
      return {
        clause: ` AND LOWER(TRIM(a.category)) = LOWER(?) AND IFNULL(a.tag, '') = ?`,
        params: [cats[0], tg],
      };
    }
    return {
      clause: ` AND LOWER(TRIM(a.category)) IN (${cats.map(() => 'LOWER(?)').join(', ')}) AND IFNULL(a.tag, '') = ?`,
      params: [...cats, tg],
    };
  }

  if (cats.length === 1) {
    return {
      clause: ` AND LOWER(TRIM(a.category)) = LOWER(?)`,
      params: [cats[0]],
    };
  }
  return {
    clause: ` AND LOWER(TRIM(a.category)) IN (${cats.map(() => 'LOWER(?)').join(', ')})`,
    params: [...cats],
  };
}

function listingSearchLike(query) {
  const q = query ? String(query).trim() : '';
  if (!q) return null;
  return `%${q.replace(/[%_]/g, '\\$&')}%`;
}

function appendListingFilters(sql, params, { scope, category, tag, query, typeCategory, regionTags, rubricSlug }) {
  const canTag = hasArticlesTagColumn();
  const tg = tag != null ? String(tag).trim() : '';
  const like = listingSearchLike(query);
  const cats = normalizeListingCategories(category);

  if (scope === 'rubric') {
    if (!hasArticlesColumn('rubric_slug')) return null;
    const slug = rubricSlug != null ? String(rubricSlug).trim() : '';
    if (slug) {
      sql += ` AND IFNULL(a.rubric_slug, '') = ?`;
      params.push(slug);
    } else {
      sql += ` AND IFNULL(TRIM(a.rubric_slug), '') != ''`;
    }
    if (like) {
      sql += ` AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )`;
      params.push(like, like, like);
    }
    return sql;
  }

  if (scope === 'search') {
    if (!like) return null;
    if (canTag) {
      sql += ` AND (? = '' OR IFNULL(a.tag, '') = ?)`;
      params.push(tg, tg);
    }
    sql += ` AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )`;
    params.push(like, like, like);
    return sql;
  }

  if (scope === 'tag') {
    if (!tg) return null;
    if (canTag) {
      sql += ` AND IFNULL(a.tag, '') = ?`;
      params.push(tg);
    }
    return sql;
  }

  if (scope === 'all') {
    if (canTag) {
      sql += ` AND (? = '' OR IFNULL(a.tag, '') = ?)`;
      params.push(tg, tg);
    }
    if (like) {
      sql += ` AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )`;
      params.push(like, like, like);
    }
    return sql;
  }

  if (cats.length >= 1 || (typeCategory && String(typeCategory).trim())) {
    const scoped = categoryScopeClause({ category, tag, typeCategory, regionTags });
    if (scoped.clause === ' AND 1=0') return null;
    sql += scoped.clause;
    params.push(...scoped.params);
  } else {
    return null;
  }
  if (like) {
    sql += ` AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )`;
    params.push(like, like, like);
  }
  return sql;
}

function countForListing({ scope = 'category', category, tag, query, typeCategory, regionTags, rubricSlug } = {}) {
  if (scope === 'rubric') {
    if (!hasArticlesColumn('rubric_slug')) return 0;
    let sql = `SELECT COUNT(*) AS n FROM articles a WHERE a.status = 'published'`;
    const params = [];
    sql = appendListingFilters(sql, params, { scope, query, rubricSlug });
    if (!sql) return 0;
    return getDb().prepare(sql).get(...params).n;
  }
  if (scope === 'search') {
    return countSearchPublished(query, tag);
  }
  if (scope === 'tag') {
    return countPublished(tag);
  }
  if (scope === 'all') {
    if (listingSearchLike(query)) {
      return countSearchPublished(query, tag);
    }
    return countPublished(tag);
  }
  if (listingSearchLike(query)) {
    return countPublishedByCategoryQuery(category, query, tag, { typeCategory, regionTags });
  }
  return countPublishedByCategory(category, tag, { typeCategory, regionTags });
}

function runListingQuery({ scope, category, tag, query, typeCategory, regionTags, rubricSlug, orderBy, limit, offset }) {
  let sql = `SELECT a.*, u.display_name AS author_display, u.email AS author_email
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'`;
  const params = [];
  sql = appendListingFilters(sql, params, { scope, category, tag, query, typeCategory, regionTags, rubricSlug });
  if (!sql) return [];
  sql += ` ORDER BY ${orderBy}`;
  if (limit != null) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  if (offset != null) {
    sql += ` OFFSET ?`;
    params.push(offset);
  }
  return getDb().prepare(sql).all(...params);
}

function listLatestForListing({ scope = 'category', category, tag, query, typeCategory, regionTags, rubricSlug, limit = 3 } = {}) {
  return runListingQuery({
    scope,
    category,
    tag,
    query,
    typeCategory,
    regionTags,
    rubricSlug,
    orderBy: 'COALESCE(a.published_at, a.created_at) DESC, a.id DESC',
    limit,
  });
}

function listMostReadForListing({ scope = 'category', category, tag, query, typeCategory, regionTags, rubricSlug, limit = 6 } = {}) {
  return runListingQuery({
    scope,
    category,
    tag,
    query,
    typeCategory,
    regionTags,
    rubricSlug,
    orderBy: 'COALESCE(a.view_count, 0) DESC, COALESCE(a.published_at, a.created_at) DESC, a.id DESC',
    limit,
  });
}

function listPagedForListing({
  scope = 'category',
  category,
  tag,
  query,
  typeCategory,
  regionTags,
  rubricSlug,
  limit = 6,
  offset = 0,
} = {}) {
  return runListingQuery({
    scope,
    category,
    tag,
    query,
    typeCategory,
    regionTags,
    rubricSlug,
    orderBy: 'COALESCE(a.published_at, a.created_at) DESC, a.id DESC',
    limit,
    offset,
  });
}

function countPublishedByCategoryQuery(category, query, tag, extra = {}) {
  const q = query ? String(query).trim() : '';
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const tg = tag != null ? String(tag).trim() : '';
  const db = getDb();
  if (!q) return countPublishedByCategory(category, tg, extra);

  const { clause, params: scopeParams } = categoryScopeClause({
    category,
    tag: tg,
    typeCategory: extra.typeCategory,
    regionTags: extra.regionTags,
  });
  if (clause === ' AND 1=0') return 0;

  return db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM articles a
       WHERE a.status = 'published'
         ${clause}
         AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )`
    )
    .get(...scopeParams, like, like, like).n;
}

function listPublishedByCategoryQueryPaged(category, query, limit, offset, tag) {
  const q = query ? String(query).trim() : '';
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const lim = limit != null ? limit : 6;
  const off = offset != null ? offset : 0;
  const tg = tag != null ? String(tag).trim() : '';
  const canTag = hasArticlesTagColumn();
  const cats = Array.isArray(category)
    ? category.map((c) => (c != null ? String(c).trim() : '')).filter(Boolean)
    : category != null && String(category).trim()
      ? [String(category).trim()]
      : [];
  const db = getDb();
  if (!q) return listPublishedByCategoryPaged(category, lim, off, tg);

  const baseSelect = `SELECT
         a.id,
         a.slug,
         a.title,
         a.excerpt,
         a.hero_image_path,
         a.hero_position,
         a.published_at,
         a.created_at,
         u.display_name AS author_display
       FROM articles a
       JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
         ${canTag ? 'AND (? = \'\' OR IFNULL(a.tag, \'\') = ?)' : ''}
         AND (
           a.title LIKE ? ESCAPE '\\'
           OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
           OR IFNULL(a.body_html, '') LIKE ? ESCAPE '\\'
         )`;

  if (!cats.length) {
    const cat = category ? String(category).trim() : '';
    return db
      .prepare(
        `${baseSelect} AND a.category = ?
         ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...(canTag ? [tg, tg] : []), like, like, like, cat, lim, off);
  }
  if (cats.length === 1) {
    return db
      .prepare(
        `${baseSelect} AND a.category = ?
         ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...(canTag ? [tg, tg] : []), like, like, like, cats[0], lim, off);
  }
  const placeholders = cats.map(() => '?').join(', ');
  return db
    .prepare(
      `${baseSelect} AND a.category IN (${placeholders})
       ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...(canTag ? [tg, tg] : []), like, like, like, ...cats, lim, off);
}

function incrementView(articleId, req) {
  const key = `viewedArticle:${articleId}`;
  if (req.session && req.session[key]) return;
  getDb().prepare(`UPDATE articles SET view_count = view_count + 1 WHERE id = ?`).run(articleId);
  if (req.session) req.session[key] = true;
}

function promoteScheduled() {
  const now = new Date().toISOString();
  const ids = getDb()
    .prepare(
      `SELECT id FROM articles WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`
    )
    .all(now)
    .map((r) => r.id);
  for (const articleId of ids) {
    try {
      updateArticle(articleId, { status: 'published', published_at: now });
    } catch (e) {
      console.error('[11ka] promoteScheduled', articleId, e);
    }
  }
}

function createArticle({
  author_id,
  title,
  slug,
  excerpt,
  body_html,
  body_blocks_json,
  hero_image_path,
  hero_position,
  hero_card_position,
  hero_slider_mobile_position,
  hero_slider_desktop_position,
  hero_credit,
  lineup_json,
  category,
  tag,
  sources,
  status,
  mentionedTeamCodes,
  relatedArticleIds,
  rubricSlug,
  matchKey,
}) {
  const now = new Date().toISOString();
  title = clipTitle(title);
  excerpt = clipExcerpt(excerpt);
  const body = sanitizeArticleBody(body_html);
  const canBlocks = hasArticlesBlocksColumn();
  const canHeroPosition = hasArticlesHeroPositionColumn();
  const canHeroCardPosition = hasArticlesHeroCardPositionColumn();
  const canHeroSliderMobilePosition = hasArticlesHeroSliderMobilePositionColumn();
  const canHeroSliderDesktopPosition = hasArticlesHeroSliderDesktopPositionColumn();
  const canLineup = hasArticlesLineupColumn();
  const blocksJson = body_blocks_json != null ? String(body_blocks_json) : null;
  const heroPosition = normalizeHeroPosition(hero_position) || '50% 50%';
  const heroCardPosition = resolveStoredHeroPosition(hero_card_position, hero_position);
  const heroSliderMobilePosition = resolveStoredHeroPosition(
    hero_slider_mobile_position,
    hero_position
  );
  const heroSliderDesktopPosition = resolveStoredHeroPosition(
    hero_slider_desktop_position,
    hero_position
  );
  const lineupJson = normalizeLineupJson(lineup_json);
  const finalSlug = uniqueSlug(slug || title, (s) => slugExists(s, null));
  const info = canBlocks && canHeroPosition && canLineup
    ? getDb()
        .prepare(
          `INSERT INTO articles (
            slug, title, excerpt, body_html, body_blocks_json, hero_image_path, hero_position, hero_credit, lineup_json, status,
            scheduled_at, published_at, author_id, view_count, category, tag, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)`
        )
        .run(
          finalSlug,
          title.trim(),
          excerpt ? excerpt.trim() : null,
          body,
          blocksJson,
          hero_image_path || null,
          heroPosition,
          hero_credit ? hero_credit.trim() : null,
          lineupJson,
          status || 'draft',
          author_id,
          category ? category.trim() : null,
          tag ? String(tag).trim() : null,
          now,
          now
        )
    : canBlocks && canHeroPosition
    ? getDb()
        .prepare(
          `INSERT INTO articles (
            slug, title, excerpt, body_html, body_blocks_json, hero_image_path, hero_position, hero_credit, status,
            scheduled_at, published_at, author_id, view_count, category, tag, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)`
        )
        .run(
          finalSlug,
          title.trim(),
          excerpt ? excerpt.trim() : null,
          body,
          blocksJson,
          hero_image_path || null,
          heroPosition,
          hero_credit ? hero_credit.trim() : null,
          status || 'draft',
          author_id,
          category ? category.trim() : null,
          tag ? String(tag).trim() : null,
          now,
          now
        )
    : canBlocks
      ? getDb()
          .prepare(
            `INSERT INTO articles (
              slug, title, excerpt, body_html, body_blocks_json, hero_image_path, hero_credit, status,
              scheduled_at, published_at, author_id, view_count, category, tag, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)`
          )
          .run(
            finalSlug,
            title.trim(),
            excerpt ? excerpt.trim() : null,
            body,
            blocksJson,
            hero_image_path || null,
            hero_credit ? hero_credit.trim() : null,
            status || 'draft',
            author_id,
            category ? category.trim() : null,
            tag ? String(tag).trim() : null,
            now,
            now
          )
    : canHeroPosition
      ? getDb()
          .prepare(
            `INSERT INTO articles (
              slug, title, excerpt, body_html, hero_image_path, hero_position, hero_credit, status,
              scheduled_at, published_at, author_id, view_count, category, tag, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)`
          )
          .run(
            finalSlug,
            title.trim(),
            excerpt ? excerpt.trim() : null,
            body,
            hero_image_path || null,
            heroPosition,
            hero_credit ? hero_credit.trim() : null,
            status || 'draft',
            author_id,
            category ? category.trim() : null,
            tag ? String(tag).trim() : null,
            now,
            now
          )
      : getDb()
        .prepare(
          `INSERT INTO articles (
            slug, title, excerpt, body_html, hero_image_path, hero_credit, status,
            scheduled_at, published_at, author_id, view_count, category, tag, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)`
        )
        .run(
          finalSlug,
          title.trim(),
          excerpt ? excerpt.trim() : null,
          body,
          hero_image_path || null,
          hero_credit ? hero_credit.trim() : null,
          status || 'draft',
          author_id,
          category ? category.trim() : null,
          tag ? String(tag).trim() : null,
          now,
          now
        );
  const created = getById(info.lastInsertRowid);
  if (canHeroCardPosition) {
    getDb().prepare(`UPDATE articles SET hero_card_position = ? WHERE id = ?`).run(heroCardPosition, created.id);
  }
  if (canHeroSliderMobilePosition) {
    getDb()
      .prepare(`UPDATE articles SET hero_slider_mobile_position = ? WHERE id = ?`)
      .run(heroSliderMobilePosition, created.id);
  }
  if (canHeroSliderDesktopPosition) {
    getDb()
      .prepare(`UPDATE articles SET hero_slider_desktop_position = ? WHERE id = ?`)
      .run(heroSliderDesktopPosition, created.id);
  }
  if (canLineup && lineupJson && !(canBlocks && canHeroPosition && canLineup)) {
    getDb().prepare(`UPDATE articles SET lineup_json = ? WHERE id = ?`).run(lineupJson, created.id);
  }
  if (hasArticlesSourcesColumn() && sources !== undefined) {
    getDb()
      .prepare(`UPDATE articles SET sources = ? WHERE id = ?`)
      .run(normalizeSources(sources), created.id);
  }
  persistCommunityFields(created.id, {
    mentionedTeamCodes,
    relatedArticleIds,
    rubricSlug,
    matchKey,
  });
  return getById(created.id);
}

function updateArticle(id, patch) {
  const cur = getById(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  const title = patch.title != null ? clipTitle(patch.title) : cur.title;
  let slug = cur.slug;
  if (patch.slug != null && patch.slug.trim()) {
    const candidate = uniqueSlug(patch.slug, (s) => slugExists(s, id));
    slug = candidate;
  }
  const excerpt = patch.excerpt !== undefined ? clipExcerpt(patch.excerpt) : cur.excerpt;
  const body_html =
    patch.body_html !== undefined ? sanitizeArticleBody(patch.body_html) : cur.body_html;
  const hero_image_path =
    patch.hero_image_path !== undefined ? patch.hero_image_path || null : cur.hero_image_path;
  const hero_credit =
    patch.hero_credit !== undefined
      ? patch.hero_credit
        ? String(patch.hero_credit).trim()
        : null
      : cur.hero_credit;
  const canHeroPosition = hasArticlesHeroPositionColumn();
  const canHeroCardPosition = hasArticlesHeroCardPositionColumn();
  const canHeroSliderMobilePosition = hasArticlesHeroSliderMobilePositionColumn();
  const canHeroSliderDesktopPosition = hasArticlesHeroSliderDesktopPositionColumn();
  const canLineup = hasArticlesLineupColumn();
  const hero_position =
    patch.hero_position !== undefined
      ? resolveStoredHeroPosition(patch.hero_position, cur.hero_position)
      : resolveStoredHeroPosition(cur.hero_position);
  const hero_card_position =
    patch.hero_card_position !== undefined
      ? resolveStoredHeroPosition(patch.hero_card_position, cur.hero_card_position, cur.hero_position)
      : resolveStoredHeroPosition(cur.hero_card_position, cur.hero_position);
  const hero_slider_mobile_position =
    patch.hero_slider_mobile_position !== undefined
      ? resolveStoredHeroPosition(
          patch.hero_slider_mobile_position,
          cur.hero_slider_mobile_position,
          cur.hero_position
        )
      : resolveStoredHeroPosition(cur.hero_slider_mobile_position, cur.hero_position);
  const hero_slider_desktop_position =
    patch.hero_slider_desktop_position !== undefined
      ? resolveStoredHeroPosition(
          patch.hero_slider_desktop_position,
          cur.hero_slider_desktop_position,
          cur.hero_position
        )
      : resolveStoredHeroPosition(cur.hero_slider_desktop_position, cur.hero_position);
  const lineup_json =
    patch.lineup_json !== undefined
      ? normalizeLineupJson(patch.lineup_json)
      : normalizeLineupJson(cur.lineup_json);
  const category =
    patch.category !== undefined ? (patch.category ? String(patch.category).trim() : null) : cur.category;
  const tag =
    patch.tag !== undefined ? (patch.tag ? String(patch.tag).trim() : null) : cur.tag;
  const canBlocks = hasArticlesBlocksColumn();
  const body_blocks_json =
    patch.body_blocks_json !== undefined
      ? patch.body_blocks_json
        ? String(patch.body_blocks_json)
        : null
      : cur.body_blocks_json;

  let status = patch.status !== undefined ? patch.status : cur.status;
  let scheduled_at = cur.scheduled_at;
  let published_at = cur.published_at;

  if (patch.scheduled_at !== undefined) {
    scheduled_at = patch.scheduled_at || null;
  }
  if (patch.published_at !== undefined) {
    published_at = patch.published_at || null;
  }

  if (status === 'published' && !published_at) {
    published_at = now;
  }
  if (status === 'scheduled') {
    published_at = null;
  }
  if (status !== 'scheduled') {
    scheduled_at = null;
  }

  const wasPublished = cur.status === 'published';

  let author_id = cur.author_id;
  if (patch.author_id !== undefined) {
    const parsedAuthor = parseInt(patch.author_id, 10);
    if (Number.isFinite(parsedAuthor) && parsedAuthor > 0) {
      author_id = parsedAuthor;
    }
  }

  if (canBlocks && canHeroPosition && canLineup) {
    getDb()
      .prepare(
        `UPDATE articles SET slug = ?, title = ?, excerpt = ?, body_html = ?, body_blocks_json = ?, hero_image_path = ?, hero_position = ?, hero_credit = ?, lineup_json = ?,
         status = ?, scheduled_at = ?, published_at = ?, category = ?, tag = ?, author_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        slug,
        title,
        excerpt,
        body_html,
        body_blocks_json,
        hero_image_path,
        hero_position,
        hero_credit,
        lineup_json,
        status,
        scheduled_at,
        published_at,
        category,
        tag,
        author_id,
        now,
        id
      );
  } else if (canBlocks && canHeroPosition) {
    getDb()
      .prepare(
        `UPDATE articles SET slug = ?, title = ?, excerpt = ?, body_html = ?, body_blocks_json = ?, hero_image_path = ?, hero_position = ?, hero_credit = ?,
         status = ?, scheduled_at = ?, published_at = ?, category = ?, tag = ?, author_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        slug,
        title,
        excerpt,
        body_html,
        body_blocks_json,
        hero_image_path,
        hero_position,
        hero_credit,
        status,
        scheduled_at,
        published_at,
        category,
        tag,
        author_id,
        now,
        id
      );
  } else if (canBlocks) {
    getDb()
      .prepare(
        `UPDATE articles SET slug = ?, title = ?, excerpt = ?, body_html = ?, body_blocks_json = ?, hero_image_path = ?, hero_credit = ?,
         status = ?, scheduled_at = ?, published_at = ?, category = ?, tag = ?, author_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        slug,
        title,
        excerpt,
        body_html,
        body_blocks_json,
        hero_image_path,
        hero_credit,
        status,
        scheduled_at,
        published_at,
        category,
        tag,
        author_id,
        now,
        id
      );
  } else if (canHeroPosition) {
    getDb()
      .prepare(
        `UPDATE articles SET slug = ?, title = ?, excerpt = ?, body_html = ?, hero_image_path = ?, hero_position = ?, hero_credit = ?,
         status = ?, scheduled_at = ?, published_at = ?, category = ?, tag = ?, author_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        slug,
        title,
        excerpt,
        body_html,
        hero_image_path,
        hero_position,
        hero_credit,
        status,
        scheduled_at,
        published_at,
        category,
        tag,
        author_id,
        now,
        id
      );
  } else {
    getDb()
      .prepare(
        `UPDATE articles SET slug = ?, title = ?, excerpt = ?, body_html = ?, hero_image_path = ?, hero_credit = ?,
         status = ?, scheduled_at = ?, published_at = ?, category = ?, tag = ?, author_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        slug,
        title,
        excerpt,
        body_html,
        hero_image_path,
        hero_credit,
        status,
        scheduled_at,
        published_at,
        category,
        tag,
        author_id,
        now,
        id
      );
  }

  if (canLineup && !(canBlocks && canHeroPosition && canLineup) && patch.lineup_json !== undefined) {
    getDb().prepare(`UPDATE articles SET lineup_json = ?, updated_at = ? WHERE id = ?`).run(
      lineup_json,
      now,
      id
    );
  }

  if (canHeroPosition && patch.hero_position !== undefined) {
    getDb().prepare(`UPDATE articles SET hero_position = ?, updated_at = ? WHERE id = ?`).run(
      hero_position,
      now,
      id
    );
  }
  if (canHeroCardPosition && patch.hero_card_position !== undefined) {
    getDb().prepare(`UPDATE articles SET hero_card_position = ?, updated_at = ? WHERE id = ?`).run(
      hero_card_position,
      now,
      id
    );
  }
  if (canHeroSliderMobilePosition && patch.hero_slider_mobile_position !== undefined) {
    getDb()
      .prepare(`UPDATE articles SET hero_slider_mobile_position = ?, updated_at = ? WHERE id = ?`)
      .run(hero_slider_mobile_position, now, id);
  }
  if (canHeroSliderDesktopPosition && patch.hero_slider_desktop_position !== undefined) {
    getDb()
      .prepare(`UPDATE articles SET hero_slider_desktop_position = ?, updated_at = ? WHERE id = ?`)
      .run(hero_slider_desktop_position, now, id);
  }

  if (hasArticlesSourcesColumn() && patch.sources !== undefined) {
    getDb().prepare(`UPDATE articles SET sources = ?, updated_at = ? WHERE id = ?`).run(
      normalizeSources(patch.sources),
      now,
      id
    );
  }

  persistCommunityFields(id, {
    mentionedTeamCodes: patch.mentionedTeamCodes,
    relatedArticleIds: patch.relatedArticleIds,
    rubricSlug: patch.rubricSlug,
    matchKey: patch.matchKey,
  });

  const updated = getById(id);
  if (!wasPublished && status === 'published' && updated) {
    setImmediate(() => {
      try {
        const { notifyNewArticle, notifyRubricArticle } = require('./mail');
        notifyNewArticle(updated).catch((err) =>
          console.error('[11ka] newsletter mail:', err && err.message)
        );
        const slug = updated.rubric_slug;
        if (slug) {
          try {
            const rubric = require('./rubrics').getBySlug(slug);
            if (rubric && rubric.notify_enabled) {
              notifyRubricArticle(updated, rubric).catch((err) =>
                console.error('[11ka] rubric mail:', err && err.message)
              );
            }
          } catch (e) {
            console.error('[11ka] rubric mail:', e && e.message);
          }
        }
      } catch (e) {
        console.error('[11ka] newsletter mail:', e && e.message);
      }
    });
  }

  return updated;
}

function deleteArticle(id) {
  getDb().prepare(`DELETE FROM articles WHERE id = ?`).run(id);
}

function unlinkHeroIfLocal(hero_image_path) {
  if (!hero_image_path || typeof hero_image_path !== 'string') return;
  if (!hero_image_path.startsWith('/uploads/articles/')) return;
  const rel = hero_image_path.replace(/^\//, '');
  const abs = path.join(__dirname, '..', 'public', rel);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

/** Remove hero file from disk (if under /uploads/articles/) then DB row. */
function deleteArticleCompletely(id) {
  const row = getById(id);
  if (!row) return false;
  unlinkHeroIfLocal(row.hero_image_path);
  deleteArticle(id);
  return true;
}

function countPublishedForStats(query) {
  const q = query != null ? String(query).trim() : '';
  const like = q ? `%${q.replace(/[%_]/g, '\\$&')}%` : '';
  let whereSql = `WHERE a.status = 'published'`;
  const params = [];
  if (like) {
    whereSql += ` AND (
      a.title LIKE ? ESCAPE '\\'
      OR IFNULL(a.slug, '') LIKE ? ESCAPE '\\'
      OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
      OR IFNULL(a.category, '') LIKE ? ESCAPE '\\'
      OR IFNULL(u.display_name, '') LIKE ? ESCAPE '\\'
      OR IFNULL(u.email, '') LIKE ? ESCAPE '\\'
    )`;
    params.push(like, like, like, like, like, like);
  }
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM articles a
       JOIN users u ON u.id = a.author_id
       ${whereSql}`
    )
    .get(...params).n;
}

function statsSummary(topLimit, topOffset, query) {
  const lim = topLimit != null ? topLimit : 20;
  const off = topOffset != null ? topOffset : 0;
  const q = query != null ? String(query).trim() : '';
  const like = q ? `%${q.replace(/[%_]/g, '\\$&')}%` : '';
  const db = getDb();
  const totalViews = db.prepare(`SELECT COALESCE(SUM(view_count), 0) AS v FROM articles`).get().v;
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS c FROM articles GROUP BY status`).all();

  let whereSql = `WHERE a.status = 'published'`;
  const params = [];
  if (like) {
    whereSql += ` AND (
      a.title LIKE ? ESCAPE '\\'
      OR IFNULL(a.slug, '') LIKE ? ESCAPE '\\'
      OR IFNULL(a.excerpt, '') LIKE ? ESCAPE '\\'
      OR IFNULL(a.category, '') LIKE ? ESCAPE '\\'
      OR IFNULL(u.display_name, '') LIKE ? ESCAPE '\\'
      OR IFNULL(u.email, '') LIKE ? ESCAPE '\\'
    )`;
    params.push(like, like, like, like, like, like);
  }

  const topTotal = countPublishedForStats(q);
  const top = db
    .prepare(
      `SELECT a.id, a.slug, a.title, a.view_count, a.published_at, a.category,
              u.display_name AS author_display
       FROM articles a
       JOIN users u ON u.id = a.author_id
       ${whereSql}
       ORDER BY a.view_count DESC, COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, lim, off);

  return { totalViews, byStatus, top, topTotal };
}

const SEED_ARTICLES_PATH = path.join(__dirname, '..', 'data', 'seed-articles.json');
const DEMO_PLACEHOLDER_SLUG = 'slavia-sparta-derby';

function loadSeedArticlesFile() {
  try {
    if (!fs.existsSync(SEED_ARTICLES_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(SEED_ARTICLES_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.articles) ? raw.articles : [];
    return list.filter((item) => item && item.title && item.slug);
  } catch (e) {
    console.error('[11ka] seed-articles.json unreadable:', e && e.message);
    return [];
  }
}

function normalizeSeedTag(tag) {
  const value = tag != null ? String(tag).trim() : '';
  if (!value) return null;
  if (value === 'Fortuna Lyga') return 'Fortuna Liga';
  return value;
}

function ensureSeedAuthorId(displayName, fallbackId) {
  const name = String(displayName || '').trim() || 'Redakce';
  const existing = getDb()
    .prepare(
      `SELECT id FROM users
       WHERE display_name = ? COLLATE NOCASE
       ORDER BY CASE role
         WHEN 'majitel' THEN 1
         WHEN 'vedeni' THEN 2
         WHEN 'sefredaktor' THEN 3
         WHEN 'redaktor' THEN 4
         ELSE 5
       END, id ASC
       LIMIT 1`
    )
    .get(name);
  if (existing) return existing.id;

  try {
    const usersService = require('./users');
    const crypto = require('crypto');
    const email = `seed.${uniqueSlug(name, () => false)}@11ka.local`;
    const byEmail = usersService.getByEmail(email);
    if (byEmail) return byEmail.id;
    return usersService.createUser({
      email,
      password: crypto.randomBytes(24).toString('hex'),
      role: 'redaktor',
      roles: ['redaktor'],
      display_name: name,
    });
  } catch (e) {
    console.error('[11ka] seed author failed:', name, e && e.message);
    return fallbackId;
  }
}

function seedArticleSlug(item) {
  const raw = String(item.slug || '').trim();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(raw) && raw.length <= 120) return raw;
  return uniqueSlug(item.slug || item.title, (s) => slugExists(s, null));
}

function seedArticleStatus(value) {
  const status = String(value || 'published').trim();
  if (status === 'draft' || status === 'pending' || status === 'scheduled' || status === 'published') {
    return status;
  }
  return 'published';
}

function insertSeedArticle(item, fallbackAuthorId) {
  const now = new Date().toISOString();
  const slug = seedArticleSlug(item);
  if (slugExists(slug, null)) return false;
  const status = seedArticleStatus(item.status);
  const publishedAt = item.published_at || (status === 'published' ? now : null);
  const createdAt = item.created_at || publishedAt || now;
  const heroPosition = normalizeHeroPosition(item.hero_position) || '50% 50%';
  const authorId = ensureSeedAuthorId(item.author_name, fallbackAuthorId);
  const canHero = hasArticlesHeroPositionColumn();
  const canTag = hasArticlesTagColumn();
  const body = sanitizeArticleBody(item.body_html || '');
  const tag = normalizeSeedTag(item.tag);
  const cols = [
    'slug',
    'title',
    'excerpt',
    'body_html',
    'hero_image_path',
    'hero_credit',
    'status',
    'scheduled_at',
    'published_at',
    'author_id',
    'view_count',
    'category',
    'created_at',
    'updated_at',
  ];
  const vals = [
    slug,
    String(item.title).trim(),
    item.excerpt ? String(item.excerpt).trim() : null,
    body,
    item.hero_image_path || null,
    item.hero_credit ? String(item.hero_credit).trim() : null,
    status,
    item.scheduled_at || null,
    publishedAt,
    authorId,
    Number.isFinite(Number(item.view_count)) ? Number(item.view_count) : 0,
    item.category ? String(item.category).trim() : null,
    createdAt,
    now,
  ];
  if (canHero) {
    cols.splice(5, 0, 'hero_position');
    vals.splice(5, 0, heroPosition);
  }
  if (canTag) {
    cols.splice(cols.indexOf('created_at'), 0, 'tag');
    vals.splice(vals.length - 2, 0, tag);
  }
  const placeholders = cols.map(() => '?').join(', ');
  const info = getDb()
    .prepare(`INSERT INTO articles (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...vals);
  persistCommunityFields(info.lastInsertRowid, {
    mentionedTeamCodes: item.mentioned_teams || item.mentionedTeamCodes,
    relatedArticleIds: item.related_article_ids || item.relatedArticleIds,
    rubricSlug: item.rubric_slug || item.rubricSlug,
  });
  return true;
}

function seedDemoIfEmpty() {
  const db = getDb();
  const countRow = db.prepare(`SELECT COUNT(*) AS n FROM articles`).get();
  let count = countRow ? countRow.n : 0;
  if (count === 1) {
    const dummy = db.prepare(`SELECT id FROM articles WHERE slug = ?`).get(DEMO_PLACEHOLDER_SLUG);
    if (dummy) {
      db.prepare(`DELETE FROM articles WHERE id = ?`).run(dummy.id);
      count = 0;
    }
  }

  const fallbackAuthor = db.prepare(`SELECT id FROM users ORDER BY id LIMIT 1`).get();
  if (!fallbackAuthor) return;

  const seeded = loadSeedArticlesFile();
  if (seeded.length) {
    const existing = new Set(
      db.prepare(`SELECT slug FROM articles`).all().map((row) => row && row.slug).filter(Boolean)
    );
    const missing = seeded.filter((item) => item && item.slug && !existing.has(item.slug));
    if (missing.length) {
      const insertMany = db.transaction((items) => {
        for (const item of items) insertSeedArticle(item, fallbackAuthor.id);
      });
      insertMany(missing);
      console.log(`[11ka] Seeded ${missing.length} published article(s) from data/seed-articles.json`);
      try {
        require('./article-ratings').seedDemoIfEmpty();
      } catch (e) {
        console.error('[11ka] article ratings seed failed:', e && e.message);
      }
    }
    return;
  }

  if (count > 0) return;

  const title = 'Slavia Praha dominuje v derby proti Spartě';
  const slug = DEMO_PLACEHOLDER_SLUG;
  const excerpt =
    'V emotivním šlágru kola proměnili domácí převahu ve druhém poločase v rozhodoucí góly.';
  const body = sanitizeArticleBody(
    `<p>${excerpt}</p><p>Článek byl vytvořen jako ukázka po instalaci CMS.</p>`
  );
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO articles (
      slug, title, excerpt, body_html, hero_image_path, hero_credit, status,
      scheduled_at, published_at, author_id, view_count, category, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, 'published', NULL, ?, ?, 0, 'Český Fotbal', ?, ?)`
  ).run(slug, title, excerpt, body, now, fallbackAuthor.id, now, now);
}

module.exports = {
  TITLE_MAX,
  EXCERPT_MAX,
  clipTitle,
  clipExcerpt,
  articleCopyError,
  normalizeHeroPosition,
  resolveStoredHeroPosition,
  getById,
  getBySlug,
  slugExists,
  listPending,
  listPendingPaged,
  countPending,
  listForAuthor,
  listAllForAdmin,
  listAllForAdminPaged,
  countAllForAdmin,
  listAllForAdminFilteredPaged,
  countAllForAdminFiltered,
  listPublishedLatestSafe,
  listPublishedLatestPaged,
  countPublished,
  countPublishedByAuthor,
  listDistinctCategories,
  listDistinctTags,
  listPublishedByCategory,
  listPublishedByCategoryPaged,
  countPublishedByCategory,
  listPublishedByAuthorPaged,
  listPublishedForSitemap,
  listPublishedForRss,
  listRelatedPublished,
  listRelatedForArticle,
  listForRelatedPicker,
  parseRelatedIds,
  persistCommunityFields,
  normalizeMatchKey,
  parseMatchKey,
  listPublishedByMatchKey,
  listArticleTeamCodes,
  getMentionedTeams,
  listPublishedByTeamCode,
  setArticleTeams,
  normalizeRubricSlug,
  listMostRead,
  listMostReadWeekly,
  listMostReadPaged,
  searchPublished,
  searchPublishedFull,
  countSearchPublished,
  countForListing,
  listLatestForListing,
  listMostReadForListing,
  listPagedForListing,
  countPublishedByCategoryQuery,
  listPublishedByCategoryQueryPaged,
  incrementView,
  promoteScheduled,
  createArticle,
  updateArticle,
  deleteArticle,
  deleteArticleCompletely,
  countPublishedForStats,
  statsSummary,
  seedDemoIfEmpty,
};

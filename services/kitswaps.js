const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

const MAX_KITSWAPS = 6;
const HOME_LIMIT = MAX_KITSWAPS;

const DEFAULT_CARD_IMAGE =
  'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&q=80';

function nowIso() {
  return new Date().toISOString();
}

function countAll() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM kitswaps`).get().n;
}

function listAllForAdmin() {
  return getDb()
    .prepare(
      `SELECT
         k.id,
         k.image_path,
         k.article_id,
         k.label,
         k.sort_order,
         k.is_active,
         k.created_at,
         k.updated_at,
         a.title AS article_title,
         a.slug AS article_slug,
         a.status AS article_status,
         a.hero_image_path AS article_hero
       FROM kitswaps k
       JOIN articles a ON a.id = k.article_id
       ORDER BY k.sort_order ASC, k.id ASC`
    )
    .all();
}

function listPublishedArticlesForPicker(limit = 500) {
  const lim = limit != null ? limit : 500;
  return getDb()
    .prepare(
      `SELECT id, title, slug, hero_image_path, published_at, created_at
       FROM articles
       WHERE status = 'published'
       ORDER BY COALESCE(published_at, created_at) DESC, id DESC
       LIMIT ?`
    )
    .all(lim);
}

function getUsedArticleIds() {
  return new Set(
    getDb()
      .prepare(`SELECT article_id FROM kitswaps`)
      .all()
      .map((r) => r.article_id)
  );
}

function listActiveForHome(limit = HOME_LIMIT) {
  const lim = limit != null ? limit : HOME_LIMIT;
  return getDb()
    .prepare(
      `SELECT
         k.id,
         k.image_path,
         k.label,
         a.id AS article_id,
         a.slug,
         a.title AS article_title,
         a.excerpt AS article_excerpt
       FROM kitswaps k
       INNER JOIN articles a ON a.id = k.article_id
       WHERE k.is_active = 1 AND a.status = 'published'
       ORDER BY k.sort_order ASC, k.id ASC
       LIMIT ?`
    )
    .all(lim)
    .map((row) => ({
      id: row.id,
      image: row.image_path,
      label: row.label ? String(row.label).trim() : '',
      href: '/clanek/' + encodeURIComponent(row.slug),
      articleTitle: row.article_title,
      articleExcerpt: row.article_excerpt || '',
    }));
}

function getById(id) {
  return getDb().prepare(`SELECT * FROM kitswaps WHERE id = ?`).get(id);
}

function getPublishedArticle(articleId) {
  return getDb()
    .prepare(
      `SELECT id, title, slug, hero_image_path, status
       FROM articles
       WHERE id = ? AND status = 'published'`
    )
    .get(articleId);
}

function nextSortOrder() {
  const row = getDb().prepare(`SELECT MAX(sort_order) AS m FROM kitswaps`).get();
  return (row.m != null ? row.m : -1) + 1;
}

function create({ image_path, article_id, label, sort_order, is_active }) {
  const now = nowIso();
  const r = getDb()
    .prepare(
      `INSERT INTO kitswaps (image_path, article_id, label, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      image_path,
      article_id,
      label ? String(label).trim() : null,
      sort_order != null ? sort_order : 0,
      is_active ? 1 : 0,
      now,
      now
    );
  return getById(r.lastInsertRowid);
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function titleMatchesQuery(title, query) {
  const tokens = String(query || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return false;
  const haystack = normalizeSearchText(title);
  return tokens.every((tok) => haystack.includes(normalizeSearchText(tok)));
}

function searchPublishedArticles(query, limit = 50) {
  const q = query != null ? String(query).trim() : '';
  if (!q) return [];

  const used = getUsedArticleIds();
  return listPublishedArticlesForPicker(500)
    .filter((a) => !used.has(a.id) && titleMatchesQuery(a.title, q))
    .slice(0, limit)
    .map((a) => ({ id: a.id, title: a.title, slug: a.slug }));
}

function resolvePublishedArticleByQuery(query) {
  const q = query != null ? String(query).trim() : '';
  if (!q) return null;

  const rows = searchPublishedArticles(q, 20);
  if (!rows.length) return null;

  const qNorm = normalizeSearchText(q);
  const exact = rows.filter((r) => normalizeSearchText(r.title) === qNorm);
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];

  const err = new Error('Nalezeno více článků - vyberte jeden ze seznamu.');
  err.code = 'AMBIGUOUS';
  throw err;
}

function publishArticleByQuery(query) {
  const article = resolvePublishedArticleByQuery(query);
  if (!article) {
    const err = new Error('Zadejte název článku k vyhledání.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return publishArticle(article.id);
}

function publishArticle(articleId) {
  if (countAll() >= MAX_KITSWAPS) {
    const err = new Error(`Maximum je ${MAX_KITSWAPS} kitswapů. Nejdřív nějaký odeberte.`);
    err.code = 'MAX_REACHED';
    throw err;
  }
  const article = getPublishedArticle(articleId);
  if (!article) {
    const err = new Error('Článek neexistuje nebo není publikovaný.');
    err.code = 'INVALID_ARTICLE';
    throw err;
  }
  const existing = getDb()
    .prepare(`SELECT id FROM kitswaps WHERE article_id = ?`)
    .get(articleId);
  if (existing) {
    const err = new Error('Tento článek už v kitswapech je.');
    err.code = 'DUPLICATE';
    throw err;
  }
  const image_path =
    article.hero_image_path && String(article.hero_image_path).trim()
      ? String(article.hero_image_path).trim()
      : DEFAULT_CARD_IMAGE;
  return create({
    image_path,
    article_id: articleId,
    label: null,
    sort_order: nextSortOrder(),
    is_active: true,
  });
}

function reorder(orderedIds) {
  const now = nowIso();
  const stmt = getDb().prepare(
    `UPDATE kitswaps SET sort_order = ?, updated_at = ? WHERE id = ?`
  );
  orderedIds.forEach((id, index) => {
    stmt.run(index, now, id);
  });
}

function move(id, direction) {
  const items = listAllForAdmin();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  const target = idx + direction;
  if (target < 0 || target >= items.length) return false;
  const ids = items.map((i) => i.id);
  const tmp = ids[idx];
  ids[idx] = ids[target];
  ids[target] = tmp;
  reorder(ids);
  return true;
}

function remove(id) {
  const row = getById(id);
  if (!row) return false;
  getDb().prepare(`DELETE FROM kitswaps WHERE id = ?`).run(id);
  if (row.image_path && row.image_path.startsWith('/uploads/kitswaps/')) {
    const filePath = path.join(__dirname, '..', 'public', row.image_path.replace(/^\//, ''));
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
  const remaining = listAllForAdmin();
  reorder(remaining.map((i) => i.id));
  return true;
}

module.exports = {
  MAX_KITSWAPS,
  HOME_LIMIT,
  countAll,
  listAllForAdmin,
  listPublishedArticlesForPicker,
  searchPublishedArticles,
  getUsedArticleIds,
  listActiveForHome,
  getById,
  publishArticle,
  publishArticleByQuery,
  move,
  remove,
};

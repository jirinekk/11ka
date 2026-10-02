const articlesService = require('./articles');
const { relativeTime } = require('../lib/format');

const DISPLAY_LIMIT = 6;
const REFRESH_MS = 30 * 1000;

const DEFAULT_CARD_IMAGE =
  'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=600&q=80';
const SIDEBAR_CARD_IMAGE =
  'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=200&q=80';

const caches = new Map();

function heroCardPositionFor(article) {
  return (
    article?.hero_card_position ||
    article?.hero_position ||
    '50% 50%'
  );
}

function mapArticleRow(article, imageFallback, layout = 'grid') {
  const row = {
    id: article.id,
    image: article.hero_image_path || imageFallback,
    heroPosition: heroCardPositionFor(article),
    title: article.title,
    href: '/clanek/' + encodeURIComponent(article.slug),
    viewCount: article.view_count || 0,
  };
  if (layout === 'grid') {
    row.excerpt = article.excerpt || '';
    row.isoTime = article.published_at || article.created_at || '';
    row.timeAgo = relativeTime(article.published_at || article.created_at);
  }
  return row;
}

function normalizeScope(scope) {
  const s = scope != null ? String(scope).trim() : 'global';
  if (s === 'category' || s === 'all' || s === 'tag' || s === 'search') return s;
  return 'global';
}

function normalizeCategoryKey(category) {
  if (Array.isArray(category)) {
    return category.map((c) => String(c || '').trim()).filter(Boolean).join('|');
  }
  return category != null ? String(category).trim() : '';
}

function cacheKey({ scope, category, tag, query, limit }) {
  const lim = Number(limit) > 0 ? Number(limit) : DISPLAY_LIMIT;
  return [
    normalizeScope(scope),
    normalizeCategoryKey(category),
    tag != null ? String(tag).trim() : '',
    query != null ? String(query).trim() : '',
    String(lim),
  ].join('::');
}

function fetchRows({ scope, category, tag, query, force, limit }) {
  const key = cacheKey({ scope, category, tag, query, limit });
  const lim = Number(limit) > 0 ? Number(limit) : DISPLAY_LIMIT;
  const now = Date.now();
  const cached = caches.get(key);
  if (!force && cached && cached.rows.length && now - cached.fetchedAt < REFRESH_MS) {
    return cached.rows;
  }

  let rows;
  const listingScope = normalizeScope(scope);
  if (listingScope === 'global') {
    rows = articlesService.listMostRead(lim);
  } else {
    rows = articlesService.listMostReadForListing({
      scope: listingScope,
      category,
      tag,
      query,
      limit: lim,
    });
  }

  caches.set(key, { rows, fetchedAt: now });
  return rows;
}

function getMostReadCards({
  force = false,
  layout = 'grid',
  scope = 'global',
  category,
  tag,
  query,
  limit,
} = {}) {
  const fallback = layout === 'sidebar' ? SIDEBAR_CARD_IMAGE : DEFAULT_CARD_IMAGE;
  return fetchRows({ scope, category, tag, query, force, limit }).map((row) =>
    mapArticleRow(row, fallback, layout)
  );
}

function getLiveSignature(items) {
  return items.map((item) => `${item.id}:${item.viewCount}`).join('|');
}

module.exports = {
  DISPLAY_LIMIT,
  REFRESH_MS,
  getMostReadCards,
  getLiveSignature,
  cacheKey,
};

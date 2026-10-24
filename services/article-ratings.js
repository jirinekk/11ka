const { getDb } = require('../db');

const MIN_STARS = 1;
const MAX_STARS = 3;
const FAVORITES_LIMIT = 3;
const SIDEBAR_CARD_IMAGE =
  'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=200&q=80';

function clampStars(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < MIN_STARS || n > MAX_STARS) return null;
  return n;
}

function formatAvg(avg) {
  if (!Number.isFinite(avg) || avg <= 0) return '';
  return avg.toFixed(1).replace('.', ',');
}

function emptySummary() {
  return {
    count: 0,
    avg: 0,
    avgLabel: '',
    rounded: 0,
    countLabel: 'Zatím bez hodnocení',
  };
}

function buildSummary(count, avg) {
  const n = Number(count) || 0;
  const a = n > 0 ? Number(avg) || 0 : 0;
  if (n <= 0) return emptySummary();
  return {
    count: n,
    avg: a,
    avgLabel: formatAvg(a),
    rounded: Math.max(MIN_STARS, Math.min(MAX_STARS, Math.round(a))),
    countLabel: n === 1 ? '1 hodnocení' : `${n} hodnocení`,
  };
}

function getSummary(articleId) {
  if (!articleId) return emptySummary();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n, AVG(stars) AS avg
       FROM article_ratings
       WHERE article_id = ?`
    )
    .get(articleId);
  return buildSummary(row && row.n, row && row.avg);
}

function getUserStars(articleId, userId) {
  if (!articleId || !userId) return null;
  const row = getDb()
    .prepare(
      `SELECT stars FROM article_ratings WHERE article_id = ? AND user_id = ? LIMIT 1`
    )
    .get(articleId, userId);
  return row ? clampStars(row.stars) : null;
}

function rateArticle({ articleId, userId, stars }) {
  const value = clampStars(stars);
  if (!articleId || !userId || !value) {
    throw new Error('invalid_rating');
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO article_ratings (article_id, user_id, stars, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(article_id, user_id) DO UPDATE SET
         stars = excluded.stars,
         updated_at = excluded.updated_at`
    )
    .run(articleId, userId, value, now, now);
  return getSummary(articleId);
}

function heroPositionFor(article) {
  return article?.hero_card_position || article?.hero_position || '50% 50%';
}

function listFavorites(limit = FAVORITES_LIMIT) {
  const lim = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(20, Number(limit)))
    : FAVORITES_LIMIT;
  return getDb()
    .prepare(
      `SELECT
         a.id,
         a.slug,
         a.title,
         a.hero_image_path,
         a.hero_position,
         a.hero_card_position,
         AVG(r.stars) AS rating_avg,
         COUNT(r.user_id) AS rating_count
       FROM article_ratings r
       JOIN articles a ON a.id = r.article_id
       WHERE a.status = 'published'
       GROUP BY a.id
       ORDER BY rating_avg DESC, rating_count DESC, COALESCE(a.published_at, a.created_at) DESC, a.id DESC
       LIMIT ?`
    )
    .all(lim)
    .map((row, index) => {
      const summary = buildSummary(row.rating_count, row.rating_avg);
      return {
        id: row.id,
        rank: index + 1,
        title: row.title,
        href: '/clanek/' + encodeURIComponent(row.slug),
        image: row.hero_image_path || SIDEBAR_CARD_IMAGE,
        heroPosition: heroPositionFor(row),
        avg: summary.avg,
        avgLabel: summary.avgLabel,
        count: summary.count,
        countLabel: summary.countLabel,
        rounded: summary.rounded,
      };
    });
}

function seedDemoIfEmpty() {
  const db = getDb();
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM article_ratings`).get();
  if (existing && existing.n > 0) return 0;

  const articles = db
    .prepare(
      `SELECT id FROM articles WHERE status = 'published' ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 10`
    )
    .all();
  const users = db
    .prepare(`SELECT id FROM users WHERE id IS NOT NULL ORDER BY id ASC LIMIT 8`)
    .all();
  if (!articles.length || users.length < 2) return 0;

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO article_ratings (article_id, user_id, stars, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  let added = 0;
  const write = db.transaction(() => {
    articles.forEach((article, articleIndex) => {
      users.forEach((user, userIndex) => {
        if ((articleIndex + userIndex) % 4 === 3) return;
        const stars = 1 + ((articleIndex * 2 + userIndex) % 3);
        insert.run(article.id, user.id, stars, now, now);
        added += 1;
      });
    });
  });
  write();
  if (added) {
    console.log(`[11ka] Seeded ${added} article rating(s) for Oblíbené`);
  }
  return added;
}

module.exports = {
  MIN_STARS,
  MAX_STARS,
  FAVORITES_LIMIT,
  clampStars,
  formatAvg,
  getSummary,
  getUserStars,
  rateArticle,
  listFavorites,
  seedDemoIfEmpty,
};

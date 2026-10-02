const { getDb } = require('../db');

const PUBLIC_LIMIT = 20;

function nowIso() {
  return new Date().toISOString();
}

function normalizeArticleSlug(value) {
  const t = value == null ? '' : String(value).trim();
  if (!t) return null;
  return t.slice(0, 120);
}

function normalizePlayerId(value) {
  const id = parseInt(value, 10);
  if (!Number.isFinite(id) || id < 1) return null;
  return id;
}

function rowToEntry(row) {
  return {
    player_id: row.player_id,
    display_name: row.display_name,
    points: row.points != null ? row.points : 0,
    updated_at: row.updated_at,
  };
}

const GLOBAL_SELECT = `
  SELECT l.player_id,
         SUM(l.points) AS points,
         MAX(l.updated_at) AS updated_at,
         p.display_name
  FROM penalty_leaderboard l
  JOIN penalty_players p ON p.id = l.player_id
  GROUP BY l.player_id
  HAVING SUM(l.points) > 0
`;

function addScore(playerId, articleSlug, points) {
  const id = normalizePlayerId(playerId);
  const slug = normalizeArticleSlug(articleSlug);
  const pts = Math.max(0, parseInt(points, 10) || 0);
  if (!id || !slug) {
    const err = new Error('Neplatná data skóre.');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!pts) {
    return {
      totalPoints: getPlayerPoints(id, slug),
      globalPoints: getPlayerTotalPoints(id),
    };
  }
  const player = getDb().prepare('SELECT id FROM penalty_players WHERE id = ?').get(id);
  if (!player) {
    const err = new Error('Hráč nebyl nalezen.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO penalty_leaderboard (player_id, article_slug, points, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(player_id, article_slug) DO UPDATE SET
         points = penalty_leaderboard.points + excluded.points,
         updated_at = excluded.updated_at`
    )
    .run(id, slug, pts, now);
  return {
    totalPoints: getPlayerPoints(id, slug),
    globalPoints: getPlayerTotalPoints(id),
  };
}

function getPlayerPoints(playerId, articleSlug) {
  const id = normalizePlayerId(playerId);
  const slug = normalizeArticleSlug(articleSlug);
  if (!id || !slug) return 0;
  const row = getDb()
    .prepare('SELECT points FROM penalty_leaderboard WHERE player_id = ? AND article_slug = ?')
    .get(id, slug);
  return row && row.points != null ? row.points : 0;
}

function getPlayerTotalPoints(playerId) {
  const id = normalizePlayerId(playerId);
  if (!id) return 0;
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(points), 0) AS points FROM penalty_leaderboard WHERE player_id = ?')
    .get(id);
  return row && row.points != null ? row.points : 0;
}

function listTopGlobal(limit = PUBLIC_LIMIT) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || PUBLIC_LIMIT));
  return getDb()
    .prepare(
      `${GLOBAL_SELECT}
       ORDER BY points DESC, datetime(updated_at) ASC, player_id ASC
       LIMIT ?`
    )
    .all(safeLimit)
    .map(rowToEntry);
}

function listTopForArticle(articleSlug, limit = PUBLIC_LIMIT) {
  return listTopGlobal(limit);
}

function countForAdmin() {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT player_id
         FROM penalty_leaderboard
         GROUP BY player_id
         HAVING SUM(points) > 0
       )`
    )
    .get();
  return row && row.c != null ? row.c : 0;
}

function listForAdmin({ limit = 7, offset = 0 } = {}) {
  return getDb()
    .prepare(
      `${GLOBAL_SELECT}
       ORDER BY points DESC, datetime(updated_at) DESC, player_id DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map(rowToEntry);
}

function resetAllPoints() {
  getDb()
    .prepare(
      `UPDATE penalty_leaderboard
       SET points = 0, updated_at = ?`
    )
    .run(nowIso());
}

function removePlayer(playerId) {
  const id = normalizePlayerId(playerId);
  if (!id) {
    const err = new Error('Neplatná položka žebříčku.');
    err.code = 'VALIDATION';
    throw err;
  }
  getDb().prepare('DELETE FROM penalty_leaderboard WHERE player_id = ?').run(id);
}

module.exports = {
  PUBLIC_LIMIT,
  addScore,
  getPlayerPoints,
  getPlayerTotalPoints,
  listTopGlobal,
  listTopForArticle,
  countForAdmin,
  listForAdmin,
  resetAllPoints,
  removePlayer,
};

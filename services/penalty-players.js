const { getDb } = require('../db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nowIso() {
  return new Date().toISOString();
}

function normalizeDisplayName(value) {
  const t = value == null ? '' : String(value).trim();
  if (!t) return null;
  if (t.length < 2) return null;
  return t.slice(0, 80);
}

function normalizeEmail(value) {
  const t = value == null ? '' : String(value).trim().toLowerCase();
  if (!t || t.length > 120 || !EMAIL_RE.test(t)) return null;
  return t;
}

function normalizeArticleSlug(value) {
  const t = value == null ? '' : String(value).trim();
  if (!t) return null;
  return t.slice(0, 120);
}

function normalizeArticleTitle(value) {
  const t = value == null ? '' : String(value).trim();
  if (!t) return null;
  return t.slice(0, 200);
}

function normalizePlayerId(value) {
  const id = parseInt(value, 10);
  if (!Number.isFinite(id) || id < 1) return null;
  return id;
}

function rowToPlayer(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    article_slug: row.article_slug,
    article_title: row.article_title,
    created_at: row.created_at,
  };
}

function rowToProgress(row) {
  if (!row) return null;
  return {
    goals: row.goals != null ? row.goals : 0,
    round: row.round != null ? row.round : 1,
    points_per_goal: row.points_per_goal != null ? row.points_per_goal : 1,
    keeper_id: row.keeper_id != null ? row.keeper_id : null,
    started: !!row.started,
    finished: !!row.finished,
    article_slug: row.article_slug,
    article_title: row.article_title,
    updated_at: row.updated_at,
  };
}

function findPlayerByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const row = getDb()
    .prepare(
      `SELECT id, display_name, email, article_slug, article_title, created_at
       FROM penalty_players
       WHERE email = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(normalized);
  return row ? rowToPlayer(row) : null;
}

function findPlayerById(id) {
  const playerId = normalizePlayerId(id);
  if (!playerId) return null;
  const row = getDb()
    .prepare(
      `SELECT id, display_name, email, article_slug, article_title, created_at
       FROM penalty_players
       WHERE id = ?`
    )
    .get(playerId);
  return row ? rowToPlayer(row) : null;
}

function getProgress(playerId, articleSlug) {
  const id = normalizePlayerId(playerId);
  const slug = normalizeArticleSlug(articleSlug);
  if (!id || !slug) return null;
  const row = getDb()
    .prepare(
      `SELECT player_id, article_slug, article_title, goals, round, points_per_goal, keeper_id, started, finished, updated_at
       FROM penalty_progress
       WHERE player_id = ? AND article_slug = ?`
    )
    .get(id, slug);
  return rowToProgress(row);
}

function saveProgress(data) {
  const playerId = normalizePlayerId(data.player_id);
  const slug = normalizeArticleSlug(data.article_slug);
  if (!playerId || !slug) {
    const err = new Error('Neplatná data hry.');
    err.code = 'VALIDATION';
    throw err;
  }
  const player = findPlayerById(playerId);
  if (!player) {
    const err = new Error('Hráč nebyl nalezen.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const goals = Math.max(0, parseInt(data.goals, 10) || 0);
  const round = Math.max(1, parseInt(data.round, 10) || 1);
  const pointsPerGoal = Math.max(1, parseInt(data.points_per_goal, 10) || 1);
  const keeperIdRaw = parseInt(data.keeper_id, 10);
  const keeperId = Number.isFinite(keeperIdRaw) && keeperIdRaw > 0 ? keeperIdRaw : null;
  const started = data.started ? 1 : 0;
  const finished = data.finished ? 1 : 0;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO penalty_progress (
        player_id, article_slug, article_title, goals, round, points_per_goal, keeper_id, started, finished, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id, article_slug) DO UPDATE SET
        article_title = excluded.article_title,
        goals = excluded.goals,
        round = excluded.round,
        points_per_goal = excluded.points_per_goal,
        keeper_id = excluded.keeper_id,
        started = excluded.started,
        finished = excluded.finished,
        updated_at = excluded.updated_at`
    )
    .run(
      playerId,
      slug,
      normalizeArticleTitle(data.article_title),
      goals,
      round,
      pointsPerGoal,
      keeperId,
      started,
      finished,
      now
    );
  return getProgress(playerId, slug);
}

function clearProgress(playerId, articleSlug) {
  const id = normalizePlayerId(playerId);
  const slug = normalizeArticleSlug(articleSlug);
  if (!id || !slug) return;
  getDb().prepare('DELETE FROM penalty_progress WHERE player_id = ? AND article_slug = ?').run(id, slug);
}

function playerSessionPayload(player, articleSlug) {
  const slug = normalizeArticleSlug(articleSlug);
  const progress = slug ? getProgress(player.id, slug) : null;
  return {
    playerId: player.id,
    displayName: player.display_name,
    email: player.email,
    progress,
  };
}

function createPlayer(data) {
  const displayName = normalizeDisplayName(data.display_name);
  if (!displayName) {
    const err = new Error('Zadejte jméno nebo přezdívku (alespoň 2 znaky).');
    err.code = 'VALIDATION';
    throw err;
  }
  const email = normalizeEmail(data.email);
  if (!email) {
    const err = new Error('Zadejte platný e-mail.');
    err.code = 'VALIDATION';
    throw err;
  }
  const existing = findPlayerByEmail(email);
  if (existing) {
    const err = new Error('Tento e-mail už je zaregistrovaný. Přihlaste se pomocí e-mailu.');
    err.code = 'EMAIL_EXISTS';
    throw err;
  }
  const now = nowIso();
  const r = getDb()
    .prepare(
      `INSERT INTO penalty_players (display_name, email, article_slug, article_title, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      displayName,
      email,
      normalizeArticleSlug(data.article_slug),
      normalizeArticleTitle(data.article_title),
      now
    );
  const player = {
    id: r.lastInsertRowid,
    display_name: displayName,
    email,
  };
  return playerSessionPayload(player, data.article_slug);
}

function loginPlayer(data) {
  const email = normalizeEmail(data.email);
  if (!email) {
    const err = new Error('Zadejte platný e-mail.');
    err.code = 'VALIDATION';
    throw err;
  }
  const player = findPlayerByEmail(email);
  if (!player) {
    const err = new Error('Pod tímto e-mailem zatím nikdo nehraje. Nejdřív se zaregistruj.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return playerSessionPayload(player, data.article_slug);
}

function restorePlayerSession(data) {
  const player = findPlayerById(data.player_id);
  if (!player) {
    const err = new Error('Hráč nebyl nalezen.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return playerSessionPayload(player, data.article_slug);
}

function normalizePlayersSearchQuery(value) {
  const t = value == null ? '' : String(value).trim();
  if (!t) return '';
  return t.slice(0, 80);
}

function playersSearchClause(search) {
  const q = normalizePlayersSearchQuery(search);
  if (!q) return { sql: '', params: [] };
  const like = `%${q}%`;
  return {
    sql: ' WHERE display_name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE',
    params: [like, like],
  };
}

function countPlayersForAdmin(search = '') {
  const clause = playersSearchClause(search);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM penalty_players${clause.sql}`)
    .get(...clause.params);
  return row && row.c != null ? row.c : 0;
}

function listPlayersForAdmin({ limit = 7, offset = 0, search = '' } = {}) {
  const clause = playersSearchClause(search);
  return getDb()
    .prepare(
      `SELECT id, display_name, email, article_slug, article_title, created_at
       FROM penalty_players${clause.sql}
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...clause.params, limit, offset)
    .map(rowToPlayer);
}

function removePlayer(id) {
  const playerId = normalizePlayerId(id);
  if (!playerId) return;
  getDb().prepare('DELETE FROM penalty_progress WHERE player_id = ?').run(playerId);
  getDb().prepare('DELETE FROM penalty_players WHERE id = ?').run(playerId);
}

module.exports = {
  createPlayer,
  loginPlayer,
  restorePlayerSession,
  saveProgress,
  clearProgress,
  getProgress,
  countPlayersForAdmin,
  listPlayersForAdmin,
  removePlayer,
  normalizeDisplayName,
  normalizeEmail,
};

const { getDb } = require('../db');

const ROSTER_SECTIONS = ['Brankáři', 'Obránci', 'Záložníci', 'Útočníci', 'Trenér'];

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

function normalizePath(v) {
  const t = normalizeText(v);
  if (!t) return null;
  return t.startsWith('/') ? t : `/${t}`;
}

function normalizeOptionalInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeNationality(v) {
  const t = normalizeText(v);
  if (!t) return null;
  return t.toUpperCase().slice(0, 3);
}

function defaultRoster() {
  return ROSTER_SECTIONS.map((section) => ({ section, players: [] }));
}

function normalizePlayer(raw, isCoach) {
  const name = normalizeText(raw && raw.name);
  if (!name) return null;
  return {
    number: normalizeText(raw.number),
    name,
    nationality: normalizeNationality(raw.nationality),
    age: normalizeOptionalInt(raw.age),
    injured: !!(raw && raw.injured),
    isCoach: !!isCoach,
  };
}

function normalizeRoster(input) {
  if (!input) return defaultRoster();
  let sections = input;
  if (typeof input === 'string') {
    try {
      sections = JSON.parse(input);
    } catch {
      return defaultRoster();
    }
  }
  if (!Array.isArray(sections)) return defaultRoster();

  const bySection = new Map();
  sections.forEach((block) => {
    const section = normalizeText(block && block.section);
    if (!section || !ROSTER_SECTIONS.includes(section)) return;
    const players = Array.isArray(block.players)
      ? block.players
          .map((player) => normalizePlayer(player, section === 'Trenér'))
          .filter(Boolean)
      : [];
    bySection.set(section, players);
  });

  return ROSTER_SECTIONS.map((section) => ({
    section,
    players: bySection.get(section) || [],
  }));
}

function serializeRoster(input) {
  return JSON.stringify(normalizeRoster(input));
}

function parseRosterJson(raw) {
  if (!raw) return defaultRoster();
  if (typeof raw === 'string') return normalizeRoster(raw);
  return normalizeRoster(raw);
}

function rowToTeam(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    short_name: row.short_name,
    competition: row.competition,
    logo_path: row.logo_path,
    roster: parseRosterJson(row.roster_json),
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ensureTeamColumns() {
  const cols = getDb().prepare('PRAGMA table_info(match_teams)').all();
  const names = new Set(cols.map((c) => c && c.name));
  if (!names.has('logo_path')) {
    try {
      getDb().exec('ALTER TABLE match_teams ADD COLUMN logo_path TEXT;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('roster_json')) {
    try {
      getDb().exec('ALTER TABLE match_teams ADD COLUMN roster_json TEXT;');
    } catch {
      /* column already exists */
    }
  }
}

function nextSortOrder() {
  ensureTeamColumns();
  const row = getDb().prepare(`SELECT MAX(sort_order) AS m FROM match_teams`).get();
  return (row && row.m != null ? row.m : -1) + 1;
}

function listAllForAdmin() {
  ensureTeamColumns();
  return getDb()
    .prepare(
      `SELECT id, name, short_name, competition, logo_path, sort_order, created_at, updated_at
       FROM match_teams
       ORDER BY sort_order ASC, name ASC, id ASC`
    )
    .all();
}

function listNamesForSelect() {
  return listAllForAdmin().map((row) => row.name);
}

function buildLogoLookup() {
  const lookup = Object.create(null);
  listAllForAdmin().forEach((row) => {
    if (row.name) lookup[row.name] = row.logo_path || '';
  });
  return lookup;
}

function getByName(name) {
  ensureTeamColumns();
  const normalized = normalizeText(name);
  if (!normalized) return null;
  const row = getDb().prepare(`SELECT * FROM match_teams WHERE name = ?`).get(normalized) || null;
  return rowToTeam(row);
}

function getById(id) {
  ensureTeamColumns();
  const row = getDb().prepare(`SELECT * FROM match_teams WHERE id = ?`).get(id) || null;
  return rowToTeam(row);
}

function create(data) {
  ensureTeamColumns();
  const now = nowIso();
  const name = normalizeText(data.name);
  if (!name) {
    const err = new Error('Název týmu je povinný.');
    err.code = 'VALIDATION';
    throw err;
  }

  const r = getDb()
    .prepare(
      `INSERT INTO match_teams (name, short_name, competition, logo_path, roster_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      normalizeText(data.short_name),
      normalizeText(data.competition),
      normalizePath(data.logo_path),
      serializeRoster(data.roster_json || data.roster),
      nextSortOrder(),
      now,
      now
    );
  return r.lastInsertRowid;
}

function update(id, data) {
  ensureTeamColumns();
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Tým nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }

  const now = nowIso();
  const name = normalizeText(data.name);
  if (!name) {
    const err = new Error('Název týmu je povinný.');
    err.code = 'VALIDATION';
    throw err;
  }

  const logoPath =
    data.logo_path !== undefined ? normalizePath(data.logo_path) : normalizePath(existing.logo_path);
  const rosterJson =
    data.roster_json !== undefined || data.roster !== undefined
      ? serializeRoster(data.roster_json || data.roster)
      : serializeRoster(existing.roster);

  getDb()
    .prepare(
      `UPDATE match_teams
       SET name = ?, short_name = ?, competition = ?, logo_path = ?, roster_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      name,
      normalizeText(data.short_name),
      normalizeText(data.competition),
      logoPath,
      rosterJson,
      now,
      id
    );
}

function move(id, direction) {
  const items = listAllForAdmin();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const swap = idx + direction;
  if (swap < 0 || swap >= items.length) return;
  const now = nowIso();
  const a = items[idx];
  const b = items[swap];
  const stmt = getDb().prepare(`UPDATE match_teams SET sort_order = ?, updated_at = ? WHERE id = ?`);
  stmt.run(b.sort_order, now, a.id);
  stmt.run(a.sort_order, now, b.id);
}

function remove(id) {
  getDb().prepare(`DELETE FROM match_teams WHERE id = ?`).run(id);
}

module.exports = {
  ROSTER_SECTIONS,
  defaultRoster,
  normalizeRoster,
  parseRosterJson,
  listAllForAdmin,
  listNamesForSelect,
  buildLogoLookup,
  getByName,
  getById,
  create,
  update,
  move,
  remove,
};

const { getDb } = require('../db');
const { parsePragueDatetimeLocal, formatPragueDateTime } = require('../lib/prague-datetime');
const { ROSTER_SECTIONS } = require('./match-teams');

const STATUS_OPTIONS = ['Nadcházející', 'Odloženo'];
const MANAGE_STATUS_OPTIONS = ['Nadcházející', 'Probíhá', 'Poločas', 'Odehráno', 'Kontumace', 'Odloženo', 'Zrušeno'];
const LINEUP_GROUPS = ['Základní sestava', 'Náhradníci', 'Hrát nebudou'];
const LIVE_EVENT_ACTIONS = {
  goal_home: { label: 'Gól domácí', homeDelta: 1, awayDelta: 0 },
  goal_away: { label: 'Gól hosté', homeDelta: 0, awayDelta: 1 },
  yellow_home: { label: 'Žlutá karta domácí' },
  yellow_away: { label: 'Žlutá karta hosté' },
  red_home: { label: 'Červená karta domácí' },
  red_away: { label: 'Červená karta hosté' },
  sub_home: { label: 'Střídání domácí' },
  sub_away: { label: 'Střídání hosté' },
  var: { label: 'VAR' },
  forfeit_home: { label: 'Kontumace domácí' },
  forfeit_away: { label: 'Kontumace hosté' },
  disallowed_goal_home: { label: 'Neuznaný gól domácí' },
  disallowed_goal_away: { label: 'Neuznaný gól hosté' },
  penalty_scored_home: { label: 'Proměněná penalta domácí', homeDelta: 1, awayDelta: 0 },
  penalty_scored_away: { label: 'Proměněná penalta hosté', homeDelta: 0, awayDelta: 1 },
  penalty_missed_home: { label: 'Neproměněná penalta domácí' },
  penalty_missed_away: { label: 'Neproměněná penalta hosté' },
};
const GOAL_EVENT_KEYS = new Set(['goal_home', 'goal_away']);
const YELLOW_EVENT_KEYS = new Set(['yellow_home', 'yellow_away']);
const RED_EVENT_KEYS = new Set(['red_home', 'red_away']);
const SUB_EVENT_KEYS = new Set(['sub_home', 'sub_away']);
const DISALLOWED_EVENT_KEYS = new Set(['disallowed_goal_home', 'disallowed_goal_away']);
const PENALTY_EVENT_KEYS = new Set(['penalty_scored_home', 'penalty_scored_away', 'penalty_missed_home', 'penalty_missed_away']);

function resolveEventKey(raw) {
  let value = raw;
  if (Array.isArray(value)) value = value.find((item) => normalizeText(item)) || value[0];
  if (value && typeof value === 'object') {
    value = value.key || value.mk || value.match_key || value.match_event_key || value.event_key || null;
  }
  let key = normalizeText(value);
  if (key && key.length >= 2) {
    const first = key[0];
    const last = key[key.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      key = normalizeText(key.slice(1, -1)) || key;
    }
    if (key[0] === '"' && key[key.length - 1] === '"') {
      try {
        key = normalizeText(JSON.parse(key)) || key;
      } catch {
        // keep original key
      }
    }
  }
  if (!key) return null;
  if (LIVE_EVENT_ACTIONS[key]) return key;
  const lower = key.toLowerCase();
  if (LIVE_EVENT_ACTIONS[lower]) return lower;
  const byLabel = Object.entries(LIVE_EVENT_ACTIONS).find((entry) => {
    return String(entry[1] && entry[1].label || '').toLowerCase() === lower;
  });
  return byLabel ? byLabel[0] : null;
}

function pickEventKeyFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  const direct =
    resolveEventKey(body.mk) ||
    resolveEventKey(body.match_key) ||
    resolveEventKey(body.match_event_key) ||
    resolveEventKey(body.event_key) ||
    resolveEventKey(body.eventKey) ||
    null;
  if (direct) return direct;

  // Last-resort fallback: detect any submitted scalar matching known event keys/labels.
  const values = Object.values(body);
  for (const value of values) {
    const resolved = resolveEventKey(value);
    if (resolved) return resolved;
  }
  return null;
}

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
  if (!t) return 'Nadcházející';
  return STATUS_OPTIONS.includes(t) ? t : 'Nadcházející';
}

function normalizeManageStatus(v) {
  const t = normalizeText(v);
  if (!t) return 'Nadcházející';
  return MANAGE_STATUS_OPTIONS.includes(t) ? t : 'Nadcházející';
}

function normalizeLink(v) {
  const t = normalizeText(v);
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function normalizeScore(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeOptionalInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeNonNegativeInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeNationality(v) {
  const t = normalizeText(v);
  if (!t) return null;
  return t.toUpperCase().slice(0, 3);
}

function defaultLineupPositions() {
  return ROSTER_SECTIONS.map((section) => ({ section, players: [] }));
}

function defaultLineupSide() {
  return LINEUP_GROUPS.map((group) => ({
    group,
    positions: defaultLineupPositions(),
  }));
}

function defaultLineup() {
  return {
    home: defaultLineupSide(),
    away: defaultLineupSide(),
  };
}

function normalizeLineupPlayer(raw, { isCoach, withReason }) {
  const name = normalizeText(raw && raw.name);
  if (!name) return null;
  return {
    number: normalizeText(raw && raw.number),
    name,
    nationality: normalizeNationality(raw && raw.nationality),
    age: normalizeOptionalInt(raw && raw.age),
    injured: !!(raw && raw.injured),
    reason: withReason ? normalizeText(raw && raw.reason) : null,
    isCoach: !!isCoach,
  };
}

function normalizeLineupPositions(blocks, withReason) {
  const bySection = new Map();
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    const section = normalizeText(block && block.section);
    if (!section || !ROSTER_SECTIONS.includes(section)) return;
    const players = Array.isArray(block.players)
      ? block.players
          .map((player) => normalizeLineupPlayer(player, { isCoach: section === 'Trenér', withReason }))
          .filter(Boolean)
      : [];
    bySection.set(section, players);
  });

  return ROSTER_SECTIONS.map((section) => ({
    section,
    players: bySection.get(section) || [],
  }));
}

function isLegacyLineupFormat(sections) {
  return sections.some((block) => {
    const section = normalizeText(block && block.section);
    return section && LINEUP_GROUPS.includes(section);
  });
}

function migrateLegacyLineup(sections) {
  const byGroup = new Map();
  sections.forEach((block) => {
    const group = normalizeText(block && block.section);
    if (!group || !LINEUP_GROUPS.includes(group)) return;
    const withReason = group === 'Hrát nebudou';
    const legacyPlayers = Array.isArray(block.players) ? block.players : [];
    const positions = defaultLineupPositions();
    if (legacyPlayers.length) {
      const bucket = positions.find((pos) => pos.section === 'Záložníci');
      if (bucket) {
        bucket.players = legacyPlayers
          .map((player) => normalizeLineupPlayer(player, { isCoach: false, withReason }))
          .filter(Boolean);
      }
    }
    byGroup.set(group, positions);
  });

  return LINEUP_GROUPS.map((group) => ({
    group,
    positions: byGroup.get(group) || defaultLineupPositions(),
  }));
}

function isSingleTeamLineupArray(input) {
  if (!Array.isArray(input)) return false;
  return input.some((block) => {
    const group = normalizeText(block && block.group);
    const section = normalizeText(block && block.section);
    return (group && LINEUP_GROUPS.includes(group)) || (section && LINEUP_GROUPS.includes(section));
  });
}

function normalizeLineupSide(input) {
  if (!input) return defaultLineupSide();
  let sections = input;
  if (!Array.isArray(sections)) return defaultLineupSide();

  if (isLegacyLineupFormat(sections)) {
    return migrateLegacyLineup(sections);
  }

  const byGroup = new Map();
  sections.forEach((block) => {
    const group = normalizeText(block && block.group);
    if (!group || !LINEUP_GROUPS.includes(group)) return;
    const withReason = group === 'Hrát nebudou';
    byGroup.set(group, normalizeLineupPositions(block.positions, withReason));
  });

  return LINEUP_GROUPS.map((group) => ({
    group,
    positions: byGroup.get(group) || defaultLineupPositions(),
  }));
}

function normalizeLineup(input) {
  if (!input) return defaultLineup();
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      return defaultLineup();
    }
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      home: normalizeLineupSide(parsed.home),
      away: normalizeLineupSide(parsed.away),
    };
  }

  if (isSingleTeamLineupArray(parsed)) {
    return {
      home: normalizeLineupSide(parsed),
      away: defaultLineupSide(),
    };
  }

  return defaultLineup();
}

function serializeLineup(input) {
  return JSON.stringify(normalizeLineup(input));
}

function parseEvents(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((event) => ({
      key: resolveEventKey(event && event.key) || normalizeText(event && event.key),
      label: normalizeText(event && event.label),
      at: normalizeText(event && event.at),
      details: {
        scorer_number: normalizeText(event && event.details && event.details.scorer_number),
        scorer_name: normalizeText(event && event.details && event.details.scorer_name),
        assist_number: normalizeText(event && event.details && event.details.assist_number),
        assist_name: normalizeText(event && event.details && event.details.assist_name),
        player_number: normalizeText(event && event.details && event.details.player_number),
        player_name: normalizeText(event && event.details && event.details.player_name),
        off_number: normalizeText(event && event.details && event.details.off_number),
        off_name: normalizeText(event && event.details && event.details.off_name),
        on_number: normalizeText(event && event.details && event.details.on_number),
        on_name: normalizeText(event && event.details && event.details.on_name),
        target_event_at: normalizeText(event && event.details && event.details.target_event_at),
        reason: normalizeText(event && event.details && event.details.reason),
        var_used: !!(event && event.details && event.details.var_used),
        disallowed: !!(event && event.details && event.details.disallowed),
        disallowed_at: normalizeText(event && event.details && event.details.disallowed_at),
        disallowed_reason: normalizeText(event && event.details && event.details.disallowed_reason),
        disallowed_var_used: !!(event && event.details && event.details.disallowed_var_used),
        minute: normalizeNonNegativeInt(event && event.details && event.details.minute),
        minute_extra: normalizeNonNegativeInt(event && event.details && event.details.minute_extra),
      },
    }))
    .filter((event) => event.key && event.label && event.at);
}

function normalizeMinuteFields(payload) {
  return {
    minute: normalizeNonNegativeInt(payload && payload.minute),
    minute_extra: normalizeNonNegativeInt(payload && payload.minute_extra),
  };
}

function normalizeGoalDetails(payload) {
  return {
    scorer_number: normalizeText(payload && payload.scorer_number),
    scorer_name: normalizeText(payload && payload.scorer_name),
    assist_number: normalizeText(payload && payload.assist_number),
    assist_name: normalizeText(payload && payload.assist_name),
    ...normalizeMinuteFields(payload),
  };
}

function normalizePenaltyDetails(payload) {
  return {
    scorer_number: normalizeText(payload && payload.scorer_number),
    scorer_name: normalizeText(payload && payload.scorer_name),
    ...normalizeMinuteFields(payload),
  };
}

function normalizeYellowDetails(payload) {
  return {
    player_number: normalizeText(payload && payload.player_number),
    player_name: normalizeText(payload && payload.player_name),
    ...normalizeMinuteFields(payload),
  };
}

function normalizeSubDetails(payload) {
  return {
    off_number: normalizeText(payload && payload.off_number),
    off_name: normalizeText(payload && payload.off_name),
    on_number: normalizeText(payload && payload.on_number),
    on_name: normalizeText(payload && payload.on_name),
    ...normalizeMinuteFields(payload),
  };
}

function normalizeDisallowedDetails(payload) {
  return {
    target_event_at: normalizeText(payload && payload.target_event_at),
    reason: normalizeText(payload && payload.reason),
    var_used:
      payload && (payload.var_used === true || payload.var_used === '1' || payload.var_used === 1 || payload.var_used === 'on')
        ? true
        : false,
  };
}

function normalizeEventDetails(eventKey, payload) {
  if (GOAL_EVENT_KEYS.has(eventKey)) return normalizeGoalDetails(payload);
  if (PENALTY_EVENT_KEYS.has(eventKey)) return normalizePenaltyDetails(payload);
  if (YELLOW_EVENT_KEYS.has(eventKey)) return normalizeYellowDetails(payload);
  if (RED_EVENT_KEYS.has(eventKey)) return normalizeYellowDetails(payload);
  if (SUB_EVENT_KEYS.has(eventKey)) return normalizeSubDetails(payload);
  if (DISALLOWED_EVENT_KEYS.has(eventKey)) return normalizeDisallowedDetails(payload);
  return null;
}

function isScoringEventKey(key) {
  return key === 'goal_home' || key === 'goal_away' || key === 'penalty_scored_home' || key === 'penalty_scored_away';
}

function normalizeKickoffAt(v) {
  const t = normalizeText(v);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) {
    const prague = parsePragueDatetimeLocal(t.slice(0, 16));
    if (prague) return prague;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function resolveKickoffAt(data, existing) {
  const date = normalizeText(data.kickoff_at);
  const time = normalizeText(data.kickoff_time);
  if (date) {
    if (time && /^\d{2}:\d{2}/.test(time)) {
      return normalizeKickoffAt(`${date}T${time}`);
    }
    return normalizeKickoffAt(date);
  }
  if (existing && existing.kickoff_at) return existing.kickoff_at;
  return null;
}

function kickoffLabelFromIso(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('cs-CZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

function formatKickoffTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  });
}

function formatKickoffDateShort(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'Europe/Prague',
  });
}

function fixtureSideLabel(row) {
  const status = row.status || 'Nadcházející';
  if (status === 'Kontumace') return 'Kontumace';
  if (status === 'Odehráno') return 'Konec';
  if (status === 'Probíhá') return 'Live';
  if (status === 'Poločas') return 'Poločas';
  if (status === 'Odloženo') return 'Odlož.';
  if (status === 'Zrušeno') return 'Zruš.';
  return formatKickoffTime(row.kickoff_at) || '-';
}

function nextSortOrder() {
  const row = getDb().prepare(`SELECT MAX(sort_order) AS m FROM match_fixtures`).get();
  return (row && row.m != null ? row.m : -1) + 1;
}

function listAllForAdmin() {
  return getDb()
    .prepare(
      `SELECT id, competition, home_team, away_team, kickoff_at, kickoff_label, venue,
              home_score, away_score, status, preview_url, note, lineup_json, live_started_at,
              first_half_extra_minutes, first_half_extra_set, second_half_extra_minutes, second_half_extra_set,
              events_json, is_published, sort_order, created_at, updated_at
       FROM match_fixtures
       ORDER BY sort_order ASC, kickoff_at ASC, id ASC`
    )
    .all();
}

function countForWeb() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM match_fixtures`).get().n;
}

function countPublishedForWeb() {
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM match_fixtures WHERE is_published = 1`)
    .get().n;
}

let liveListCache = null;
let liveListCacheAt = 0;
const LIVE_LIST_CACHE_MS = 15000;

function listPublishedLiveForWeb() {
  const now = Date.now();
  if (liveListCache && now - liveListCacheAt < LIVE_LIST_CACHE_MS) {
    return liveListCache;
  }
  const rows = getDb()
    .prepare(
      `SELECT id, competition, home_team, away_team, kickoff_at, kickoff_label, venue,
              home_score, away_score, status, preview_url, note, lineup_json, live_started_at,
              first_half_extra_minutes, first_half_extra_set, second_half_extra_minutes, second_half_extra_set, events_json
       FROM match_fixtures
       WHERE is_published = 1 AND status IN ('Probíhá', 'Poločas')
       ORDER BY sort_order ASC, kickoff_at ASC, id ASC`
    )
    .all();
  liveListCache = rows;
  liveListCacheAt = now;
  return rows;
}

function clearLiveListCache() {
  liveListCache = null;
  liveListCacheAt = 0;
}

function listForWebPaged(limit, offset) {
  return getDb()
    .prepare(
      `SELECT id, competition, home_team, away_team, kickoff_at, kickoff_label, venue,
              home_score, away_score, status, preview_url, note, lineup_json, live_started_at,
              first_half_extra_minutes, first_half_extra_set, second_half_extra_minutes, second_half_extra_set, events_json
       FROM match_fixtures
       ORDER BY
         CASE status
           WHEN 'Probíhá' THEN 0
           WHEN 'Nadcházející' THEN 1
           WHEN 'Odloženo' THEN 2
          WHEN 'Kontumace' THEN 3
          WHEN 'Odehráno' THEN 4
          WHEN 'Zrušeno' THEN 5
          ELSE 6
         END,
         CASE WHEN status = 'Odehráno' THEN kickoff_at END DESC,
         CASE WHEN status != 'Odehráno' THEN kickoff_at END ASC,
         sort_order ASC,
         id ASC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
}

function listPublishedForWebPaged(limit, offset) {
  return getDb()
    .prepare(
      `SELECT id, competition, home_team, away_team, kickoff_at, kickoff_label, venue,
              home_score, away_score, status, preview_url, note, lineup_json, live_started_at,
              first_half_extra_minutes, first_half_extra_set, second_half_extra_minutes, second_half_extra_set, events_json
       FROM match_fixtures
       WHERE is_published = 1
       ORDER BY
         CASE status
           WHEN 'Probíhá' THEN 0
           WHEN 'Nadcházející' THEN 1
           WHEN 'Odloženo' THEN 2
          WHEN 'Kontumace' THEN 3
          WHEN 'Odehráno' THEN 4
          WHEN 'Zrušeno' THEN 5
          ELSE 6
         END,
         CASE WHEN status = 'Odehráno' THEN kickoff_at END DESC,
         CASE WHEN status != 'Odehráno' THEN kickoff_at END ASC,
         sort_order ASC,
         id ASC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
}

function getById(id) {
  return getDb().prepare(`SELECT * FROM match_fixtures WHERE id = ?`).get(id) || null;
}

function resolvePublished(data, existing) {
  if (data.is_published !== undefined && data.is_published !== '') {
    return data.is_published === true || data.is_published === '1' || data.is_published === 1;
  }
  if (existing) return !!existing.is_published;
  return true;
}

function resolveScore(data, field, existing) {
  if (data[field] !== undefined) return normalizeScore(data[field]);
  if (existing) return normalizeScore(existing[field]);
  return null;
}

function resolveKickoffLabel(data, kickoffAt, existing) {
  if (data.kickoff_label !== undefined) {
    return normalizeText(data.kickoff_label) || kickoffLabelFromIso(kickoffAt) || null;
  }
  if (existing && existing.kickoff_label) return existing.kickoff_label;
  return kickoffLabelFromIso(kickoffAt) || null;
}

function create(data) {
  const now = nowIso();
  const homeTeam = normalizeText(data.home_team);
  const awayTeam = normalizeText(data.away_team);
  if (!homeTeam || !awayTeam) {
    const err = new Error('Domácí i hostující tým jsou povinné.');
    err.code = 'VALIDATION';
    throw err;
  }

  const kickoffAt = resolveKickoffAt(data, null);
  const kickoffLabel = resolveKickoffLabel(data, kickoffAt, null);

  const r = getDb()
    .prepare(
      `INSERT INTO match_fixtures (
        competition, home_team, away_team, kickoff_at, kickoff_label, venue,
        home_score, away_score, status, preview_url, note, lineup_json, events_json,
        first_half_extra_minutes, first_half_extra_set, second_half_extra_minutes, second_half_extra_set,
        is_published, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      normalizeText(data.competition),
      homeTeam,
      awayTeam,
      kickoffAt,
      kickoffLabel,
      normalizeText(data.venue),
      resolveScore(data, 'home_score', null),
      resolveScore(data, 'away_score', null),
      normalizeStatus(data.status),
      normalizeLink(data.preview_url),
      normalizeText(data.note),
      null,
      null,
      null,
      0,
      null,
      0,
      resolvePublished(data, null) ? 1 : 0,
      nextSortOrder(),
      now,
      now
    );
  clearLiveListCache();
  return r.lastInsertRowid;
}

function update(id, data) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }

  const now = nowIso();
  const homeTeam = normalizeText(data.home_team);
  const awayTeam = normalizeText(data.away_team);
  if (!homeTeam || !awayTeam) {
    const err = new Error('Domácí i hostující tým jsou povinné.');
    err.code = 'VALIDATION';
    throw err;
  }

  const kickoffAt = resolveKickoffAt(data, existing);
  const kickoffLabel = resolveKickoffLabel(data, kickoffAt, existing);

  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET competition = ?, home_team = ?, away_team = ?, kickoff_at = ?, kickoff_label = ?, venue = ?,
           home_score = ?, away_score = ?, status = ?, preview_url = ?, note = ?, lineup_json = ?, events_json = ?,
           first_half_extra_minutes = ?, first_half_extra_set = ?, second_half_extra_minutes = ?, second_half_extra_set = ?,
           is_published = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      normalizeText(data.competition),
      homeTeam,
      awayTeam,
      kickoffAt,
      kickoffLabel,
      normalizeText(data.venue),
      resolveScore(data, 'home_score', existing),
      resolveScore(data, 'away_score', existing),
      normalizeManageStatus(data.status),
      normalizeLink(data.preview_url),
      normalizeText(data.note),
      existing.lineup_json || null,
      existing.events_json || null,
      normalizeNonNegativeInt(existing.first_half_extra_minutes),
      existing.first_half_extra_set ? 1 : 0,
      normalizeNonNegativeInt(existing.second_half_extra_minutes),
      existing.second_half_extra_set ? 1 : 0,
      resolvePublished(data, existing) ? 1 : 0,
      now,
      id
    );
  clearLiveListCache();
}

function saveLineup(id, lineupInput) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  const lineupJson = serializeLineup(lineupInput);
  getDb()
    .prepare(`UPDATE match_fixtures SET lineup_json = ?, updated_at = ? WHERE id = ?`)
    .run(lineupJson, now, id);
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
  const stmt = getDb().prepare(
    `UPDATE match_fixtures SET sort_order = ?, updated_at = ? WHERE id = ?`
  );
  stmt.run(b.sort_order, now, a.id);
  stmt.run(a.sort_order, now, b.id);
  clearLiveListCache();
}

function remove(id) {
  getDb().prepare(`DELETE FROM match_fixtures WHERE id = ?`).run(id);
  clearLiveListCache();
}

function startMatch(id) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET status = 'Probíhá',
           home_score = COALESCE(home_score, 0),
           away_score = COALESCE(away_score, 0),
           live_started_at = ?,
           first_half_extra_minutes = NULL,
           first_half_extra_set = 0,
           second_half_extra_minutes = NULL,
           second_half_extra_set = 0,
           updated_at = ?
       WHERE id = ?`
    )
    .run(now, now, id);
  clearLiveListCache();
}

function setFirstHalfExtra(id, minutes, isSet) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  if (existing.status !== 'Probíhá') {
    const err = new Error('Nastavení lze provést jen u probíhajícího zápasu.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  const value = isSet ? normalizeNonNegativeInt(minutes) : null;
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET first_half_extra_minutes = ?,
           first_half_extra_set = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(value, isSet ? 1 : 0, now, id);
  clearLiveListCache();
}

function setSecondHalfExtra(id, minutes, isSet) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  if (existing.status !== 'Probíhá') {
    const err = new Error('Nastavení lze provést jen u probíhajícího zápasu.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  const value = isSet ? normalizeNonNegativeInt(minutes) : null;
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET second_half_extra_minutes = ?,
           second_half_extra_set = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(value, isSet ? 1 : 0, now, id);
  clearLiveListCache();
}

function halftimeMatch(id) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET status = 'Poločas',
           live_started_at = NULL,
           updated_at = ?
       WHERE id = ?`
    )
    .run(now, id);
  clearLiveListCache();
}

function resumeMatchFromHalftime(id) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = new Date();
  const startFrom45 = new Date(now.getTime() - 45 * 60 * 1000).toISOString();
  const nowIsoValue = now.toISOString();
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET status = 'Probíhá',
           live_started_at = ?,
           first_half_extra_minutes = NULL,
           first_half_extra_set = 0,
           second_half_extra_minutes = NULL,
           second_half_extra_set = 0,
           updated_at = ?
       WHERE id = ?`
    )
    .run(startFrom45, nowIsoValue, id);
  clearLiveListCache();
}

function finishMatch(id, managedBy) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  const manager =
    managedBy != null && String(managedBy).trim() ? String(managedBy).trim().slice(0, 120) : null;
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET status = 'Odehráno',
           live_started_at = NULL,
           managed_by = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(manager, now, id);
  clearLiveListCache();
}

function postponeMatch(id, reason) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  const note = normalizeText(reason) || existing.note || null;
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET status = 'Odloženo',
           note = ?,
           live_started_at = NULL,
           first_half_extra_minutes = NULL,
           first_half_extra_set = 0,
           second_half_extra_minutes = NULL,
           second_half_extra_set = 0,
           updated_at = ?
       WHERE id = ?`
    )
    .run(note, now, id);
  clearLiveListCache();
}

function cancelMatch(id, reason) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  const note = normalizeText(reason) || existing.note || null;
  getDb()
    .prepare(
      `UPDATE match_fixtures
       SET status = 'Zrušeno',
           note = ?,
           live_started_at = NULL,
           first_half_extra_minutes = NULL,
           first_half_extra_set = 0,
           second_half_extra_minutes = NULL,
           second_half_extra_set = 0,
           updated_at = ?
       WHERE id = ?`
    )
    .run(note, now, id);
  clearLiveListCache();
}

function setMatchClock(id, totalMinutes) {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  if (existing.status !== 'Probíhá') {
    const err = new Error('Čas lze upravit jen u probíhajícího zápasu.');
    err.code = 'VALIDATION';
    throw err;
  }
  const mins = normalizeNonNegativeInt(totalMinutes);
  if (mins == null || mins > 200) {
    const err = new Error('Neplatná minuta (0–200).');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = new Date();
  const newStartedAt = new Date(now.getTime() - mins * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  getDb()
    .prepare(`UPDATE match_fixtures SET live_started_at = ?, updated_at = ? WHERE id = ?`)
    .run(newStartedAt, nowIso, id);
  clearLiveListCache();
}

function addLiveEvent(id, eventKey, payload = {}, managedBy = '') {
  const existing = getById(id);
  if (!existing) {
    const err = new Error('Zápas nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  if (existing.status !== 'Probíhá') {
    const err = new Error('Akce lze zapisovat jen u probíhajícího zápasu.');
    err.code = 'VALIDATION';
    throw err;
  }
  const resolvedEventKey = resolveEventKey(eventKey);
  const eventDef = resolvedEventKey ? LIVE_EVENT_ACTIONS[resolvedEventKey] : null;
  if (!eventDef) {
    const err = new Error('Neznámý typ akce zápasu.');
    err.code = 'VALIDATION';
    throw err;
  }

  const homeBase = Number.isFinite(existing.home_score) ? existing.home_score : 0;
  const awayBase = Number.isFinite(existing.away_score) ? existing.away_score : 0;
  let homeScore = homeBase + (eventDef.homeDelta || 0);
  let awayScore = awayBase + (eventDef.awayDelta || 0);
  let status = existing.status;
  let liveStartedAt = existing.live_started_at;
  let firstHalfExtraMinutes = normalizeNonNegativeInt(existing.first_half_extra_minutes);
  let firstHalfExtraSet = existing.first_half_extra_set ? 1 : 0;
  let secondHalfExtraMinutes = normalizeNonNegativeInt(existing.second_half_extra_minutes);
  let secondHalfExtraSet = existing.second_half_extra_set ? 1 : 0;
  if (resolvedEventKey === 'forfeit_home') {
    homeScore = 3;
    awayScore = 0;
    status = 'Kontumace';
    liveStartedAt = null;
    firstHalfExtraMinutes = null;
    firstHalfExtraSet = 0;
    secondHalfExtraMinutes = null;
    secondHalfExtraSet = 0;
  } else if (resolvedEventKey === 'forfeit_away') {
    homeScore = 0;
    awayScore = 3;
    status = 'Kontumace';
    liveStartedAt = null;
    firstHalfExtraMinutes = null;
    firstHalfExtraSet = 0;
    secondHalfExtraMinutes = null;
    secondHalfExtraSet = 0;
  }
  const now = nowIso();
  const events = parseEvents(existing.events_json);
  const details = normalizeEventDetails(resolvedEventKey, payload);

  if (DISALLOWED_EVENT_KEYS.has(resolvedEventKey)) {
    const targetAt = normalizeText(details && details.target_event_at);
    const targetIdx = targetAt
      ? events.findIndex((event) => {
          if (!event || !event.at || event.at !== targetAt) return false;
          return isScoringEventKey(event.key);
        })
      : -1;
    if (targetIdx < 0) {
      const err = new Error('Vybraný gól pro neuznání nebyl nalezen.');
      err.code = 'VALIDATION';
      throw err;
    }
    const targetEvent = events[targetIdx];
    const targetDetails = targetEvent.details && typeof targetEvent.details === 'object' ? targetEvent.details : {};
    if (!targetDetails.disallowed) {
      const targetDef = LIVE_EVENT_ACTIONS[targetEvent.key] || null;
      const hDelta = targetDef && Number.isFinite(targetDef.homeDelta) ? targetDef.homeDelta : 0;
      const aDelta = targetDef && Number.isFinite(targetDef.awayDelta) ? targetDef.awayDelta : 0;
      homeScore = Math.max(0, homeScore - hDelta);
      awayScore = Math.max(0, awayScore - aDelta);
    }
    targetEvent.details = {
      ...targetDetails,
      disallowed: true,
      disallowed_at: now,
      disallowed_reason: normalizeText(details && details.reason),
      disallowed_var_used: !!(details && details.var_used),
    };
  }

  events.push({
    key: resolvedEventKey,
    label: eventDef.label,
    at: now,
    details,
  });

  const manager =
    status === 'Kontumace' && managedBy != null && String(managedBy).trim()
      ? String(managedBy).trim().slice(0, 120)
      : null;

  if (status === 'Kontumace') {
    getDb()
      .prepare(
        `UPDATE match_fixtures
         SET home_score = ?,
             away_score = ?,
             status = ?,
             live_started_at = ?,
             first_half_extra_minutes = ?,
             first_half_extra_set = ?,
             second_half_extra_minutes = ?,
             second_half_extra_set = ?,
             managed_by = ?,
             events_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        homeScore,
        awayScore,
        status,
        liveStartedAt,
        firstHalfExtraMinutes,
        firstHalfExtraSet,
        secondHalfExtraMinutes,
        secondHalfExtraSet,
        manager,
        JSON.stringify(events),
        now,
        id
      );
  } else {
    getDb()
      .prepare(
        `UPDATE match_fixtures
         SET home_score = ?,
             away_score = ?,
             status = ?,
             live_started_at = ?,
             first_half_extra_minutes = ?,
             first_half_extra_set = ?,
             second_half_extra_minutes = ?,
             second_half_extra_set = ?,
             events_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        homeScore,
        awayScore,
        status,
        liveStartedAt,
        firstHalfExtraMinutes,
        firstHalfExtraSet,
        secondHalfExtraMinutes,
        secondHalfExtraSet,
        JSON.stringify(events),
        now,
        id
      );
  }
  clearLiveListCache();
  return eventDef.label;
}

function formatForWeb(row) {
  if (!row) return null;
  const hasScore =
    row.home_score != null &&
    row.away_score != null &&
    (row.status === 'Odehráno' || row.status === 'Kontumace' || row.status === 'Probíhá' || row.status === 'Poločas');
  return {
    id: row.id,
    competition: row.competition || '',
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    detailUrl: `/zapasy/${row.id}`,
    kickoffLabel: row.kickoff_at
      ? formatPragueDateTime(row.kickoff_at)
      : row.kickoff_label || kickoffLabelFromIso(row.kickoff_at) || '',
    kickoffTime: formatKickoffTime(row.kickoff_at),
    kickoffDate: formatKickoffDateShort(row.kickoff_at),
    sideLabel: fixtureSideLabel(row),
    venue: row.venue || '',
    homeScore: row.home_score,
    awayScore: row.away_score,
    scoreText: hasScore ? `${row.home_score} : ${row.away_score}` : null,
    showScore: hasScore,
    isLive: row.status === 'Probíhá',
    liveStartedAt: row.live_started_at || '',
    firstHalfExtraMinutes: normalizeNonNegativeInt(row.first_half_extra_minutes),
    firstHalfExtraSet: !!row.first_half_extra_set,
    secondHalfExtraMinutes: normalizeNonNegativeInt(row.second_half_extra_minutes),
    secondHalfExtraSet: !!row.second_half_extra_set,
    events: parseEvents(row.events_json),
    lineup: normalizeLineup(row.lineup_json),
    status: row.status || 'Nadcházející',
    previewUrl: row.preview_url || '',
    note: row.note || '',
    managedBy: row.managed_by || '',
  };
}

module.exports = {
  STATUS_OPTIONS,
  MANAGE_STATUS_OPTIONS,
  listAllForAdmin,
  countForWeb,
  countPublishedForWeb,
  listPublishedLiveForWeb,
  listForWebPaged,
  listPublishedForWebPaged,
  getById,
  create,
  update,
  move,
  remove,
  saveLineup,
  startMatch,
  postponeMatch,
  cancelMatch,
  setFirstHalfExtra,
  setSecondHalfExtra,
  halftimeMatch,
  resumeMatchFromHalftime,
  finishMatch,
  setMatchClock,
  addLiveEvent,
  pickEventKeyFromBody,
  formatForWeb,
  kickoffLabelFromIso,
};

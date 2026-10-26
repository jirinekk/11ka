const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const { slugify } = require('../lib/slug');
const fotoS3 = require('./foto-s3');
const { chancePlayerPhoto } = require('../lib/player-photos');

const SEED_PATH = path.join(__dirname, '..', 'data', 'seed-foto.json');
const FIXTURES_PATH = path.join(__dirname, '..', 'data', 'seed-foto-fixtures.json');

const COMPETITIONS = [
  'Chance Liga',
  'Chance Národní Liga',
  'MOL Cup',
  'Fortuna liga žen',
  'Liga mistrů',
  'Evropská liga',
  'Konferenční liga',
  'Liga národů UEFA',
  'ME do 21 let',
  'Reprezentace',
  'Dorost',
  'Přátelské',
];

function newId() {
  return `c${crypto.randomBytes(12).toString('hex')}`;
}

function ensureTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS foto_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      slug TEXT UNIQUE COLLATE NOCASE,
      avatar TEXT,
      role TEXT NOT NULL DEFAULT 'VIEWER',
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS foto_teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      short_name TEXT NOT NULL,
      city TEXT,
      color TEXT NOT NULL DEFAULT '#16dffb',
      logo TEXT,
      league TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_foto_teams_league ON foto_teams (league, name);
    CREATE TABLE IF NOT EXISTS foto_players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      number INTEGER,
      position TEXT,
      photo TEXT,
      livesport_id TEXT,
      role TEXT NOT NULL DEFAULT 'PLAYER',
      team_id TEXT REFERENCES foto_teams (id) ON DELETE SET NULL,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_foto_players_team ON foto_players (team_id, name);
    CREATE INDEX IF NOT EXISTS idx_foto_players_role ON foto_players (role, name);
    CREATE TABLE IF NOT EXISTS foto_albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      match_date TEXT NOT NULL,
      competition TEXT NOT NULL,
      venue TEXT,
      notes TEXT,
      home_score INTEGER,
      away_score INTEGER,
      home_team_id TEXT NOT NULL REFERENCES foto_teams (id),
      away_team_id TEXT NOT NULL REFERENCES foto_teams (id),
      photographer_id TEXT NOT NULL REFERENCES foto_users (id),
      cover_photo_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_foto_albums_date ON foto_albums (match_date DESC);
    CREATE TABLE IF NOT EXISTS foto_photos (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL REFERENCES foto_albums (id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      original_path TEXT NOT NULL,
      thumb_path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'ACTION',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_foto_photos_album ON foto_photos (album_id, sort_order, created_at);
    CREATE TABLE IF NOT EXISTS foto_photo_tags (
      id TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL REFERENCES foto_photos (id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES foto_players (id) ON DELETE CASCADE,
      x REAL NOT NULL,
      y REAL NOT NULL,
      UNIQUE (photo_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_foto_photo_tags_player ON foto_photo_tags (player_id);
    CREATE TABLE IF NOT EXISTS foto_album_officials (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL REFERENCES foto_albums (id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES foto_players (id) ON DELETE CASCADE,
      duty TEXT NOT NULL DEFAULT 'Hlavní',
      UNIQUE (album_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS foto_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      app TEXT,
      file_name TEXT,
      file_path TEXT,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      before_path TEXT,
      after_path TEXT,
      created_by_id TEXT REFERENCES foto_users (id) ON DELETE SET NULL,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS foto_shares (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      player_id TEXT NOT NULL REFERENCES foto_players (id) ON DELETE CASCADE,
      created_by_id TEXT REFERENCES foto_users (id) ON DELETE SET NULL,
      created_at TEXT,
      revoked_at TEXT,
      last_seen_at TEXT
    );
  `);
  seedIfEmpty();
}

function seedIfEmpty() {
  const db = getDb();
  const n = db.prepare('SELECT COUNT(*) AS c FROM foto_albums').get().c;
  if (n > 0) return;
  if (!fs.existsSync(SEED_PATH)) return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  } catch (err) {
    console.error('[11ka] foto seed parse failed:', err && err.message);
    return;
  }

  const insertUsers = db.prepare(
    `INSERT OR IGNORE INTO foto_users (id, email, name, slug, avatar, role, status, created_at)
     VALUES (@id, @email, @name, @slug, @avatar, @role, @status, @created_at)`
  );
  const insertTeams = db.prepare(
    `INSERT OR IGNORE INTO foto_teams (id, name, slug, short_name, city, color, logo, league)
     VALUES (@id, @name, @slug, @short_name, @city, @color, @logo, @league)`
  );
  const insertPlayers = db.prepare(
    `INSERT OR IGNORE INTO foto_players (id, name, slug, number, position, photo, livesport_id, role, team_id, created_at)
     VALUES (@id, @name, @slug, @number, @position, @photo, @livesport_id, @role, @team_id, @created_at)`
  );
  const insertAlbums = db.prepare(
    `INSERT OR IGNORE INTO foto_albums (id, title, match_date, competition, venue, notes, home_score, away_score, home_team_id, away_team_id, photographer_id, cover_photo_id, created_at, updated_at)
     VALUES (@id, @title, @match_date, @competition, @venue, @notes, @home_score, @away_score, @home_team_id, @away_team_id, @photographer_id, @cover_photo_id, @created_at, @updated_at)`
  );
  const insertPhotos = db.prepare(
    `INSERT OR IGNORE INTO foto_photos (id, album_id, original_name, mime_type, size, width, height, original_path, thumb_path, kind, sort_order, created_at)
     VALUES (@id, @album_id, @original_name, @mime_type, @size, @width, @height, @original_path, @thumb_path, @kind, @sort_order, @created_at)`
  );
  const insertTags = db.prepare(
    `INSERT OR IGNORE INTO foto_photo_tags (id, photo_id, player_id, x, y) VALUES (@id, @photo_id, @player_id, @x, @y)`
  );
  const insertOfficials = db.prepare(
    `INSERT OR IGNORE INTO foto_album_officials (id, album_id, player_id, duty) VALUES (@id, @album_id, @player_id, @duty)`
  );
  const insertPresets = db.prepare(
    `INSERT OR IGNORE INTO foto_presets (id, name, app, file_name, file_path, mime_type, size, before_path, after_path, created_by_id, created_at)
     VALUES (@id, @name, @app, @file_name, @file_path, @mime_type, @size, @before_path, @after_path, @created_by_id, @created_at)`
  );
  const insertShares = db.prepare(
    `INSERT OR IGNORE INTO foto_shares (id, token, player_id, created_by_id, created_at, revoked_at, last_seen_at)
     VALUES (@id, @token, @player_id, @created_by_id, @created_at, @revoked_at, @last_seen_at)`
  );

  const run = db.transaction(() => {
    for (const u of payload.users || []) {
      insertUsers.run({
        id: u.id,
        email: u.email || null,
        name: u.name,
        slug: u.slug,
        avatar: u.avatar || null,
        role: u.role || 'VIEWER',
        status: u.status || 'PENDING',
        created_at: u.createdAt || null,
      });
    }
    for (const t of payload.teams || []) {
      insertTeams.run({
        id: t.id,
        name: t.name,
        slug: t.slug,
        short_name: t.shortName || t.name,
        city: t.city || null,
        color: t.color || '#16dffb',
        logo: t.logo || null,
        league: t.league || '',
      });
    }
    for (const p of payload.players || []) {
      insertPlayers.run({
        id: p.id,
        name: p.name,
        slug: p.slug,
        number: p.number == null ? null : p.number,
        position: p.position || null,
        photo: p.photo || null,
        livesport_id: p.livesportId || null,
        role: p.role || 'PLAYER',
        team_id: p.teamId || null,
        created_at: p.createdAt || null,
      });
    }
    for (const a of payload.albums || []) {
      insertAlbums.run({
        id: a.id,
        title: a.title,
        match_date: a.matchDate,
        competition: a.competition,
        venue: a.venue || null,
        notes: a.notes || null,
        home_score: a.homeScore == null ? null : a.homeScore,
        away_score: a.awayScore == null ? null : a.awayScore,
        home_team_id: a.homeTeamId,
        away_team_id: a.awayTeamId,
        photographer_id: a.photographerId,
        cover_photo_id: a.coverPhotoId || null,
        created_at: a.createdAt || null,
        updated_at: a.updatedAt || null,
      });
    }
    for (const p of payload.photos || []) {
      insertPhotos.run({
        id: p.id,
        album_id: p.albumId,
        original_name: p.originalName,
        mime_type: p.mimeType || 'image/jpeg',
        size: p.size || 0,
        width: p.width || 0,
        height: p.height || 0,
        original_path: p.originalPath,
        thumb_path: p.thumbPath,
        kind: p.kind || 'ACTION',
        sort_order: p.sortOrder || 0,
        created_at: p.createdAt || null,
      });
    }
    for (const t of payload.tags || []) {
      insertTags.run({
        id: t.id,
        photo_id: t.photoId,
        player_id: t.playerId,
        x: t.x,
        y: t.y,
      });
    }
    for (const o of payload.officials || []) {
      insertOfficials.run({
        id: o.id,
        album_id: o.albumId,
        player_id: o.playerId,
        duty: o.duty || 'Hlavní',
      });
    }
    for (const p of payload.presets || []) {
      insertPresets.run({
        id: p.id,
        name: p.name,
        app: p.app || null,
        file_name: p.fileName || null,
        file_path: p.filePath || null,
        mime_type: p.mimeType || null,
        size: p.size || 0,
        before_path: p.beforePath || null,
        after_path: p.afterPath || null,
        created_by_id: p.createdById || null,
        created_at: p.createdAt || null,
      });
    }
    for (const s of payload.shares || []) {
      insertShares.run({
        id: s.id,
        token: s.token,
        player_id: s.playerId,
        created_by_id: s.createdById || null,
        created_at: s.createdAt || null,
        revoked_at: s.revokedAt || null,
        last_seen_at: s.lastSeenAt || null,
      });
    }
  });
  run();
}

function dateInput(iso) {
  if (!iso) return '';
  const raw = String(iso);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateTimeString
    ? d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
    : d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });
}

function pragueDayKey(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '11';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function mediaUrl(id, variant, extra) {
  const q = extra ? `&${extra}` : '';
  return `/foto/media/${encodeURIComponent(id)}?v=${encodeURIComponent(variant || 'thumb')}${q}`;
}

function albumScore(album) {
  if (album.home_score != null && album.away_score != null) {
    return `${album.home_score}–${album.away_score}`;
  }
  return 'vs';
}

const ALBUM_SELECT = `
  a.id, a.title, a.match_date, a.competition, a.venue, a.notes,
  a.home_score, a.away_score, a.cover_photo_id, a.photographer_id,
  a.home_team_id, a.away_team_id,
  ht.name AS home_name, ht.short_name AS home_short, ht.slug AS home_slug, ht.logo AS home_logo, ht.color AS home_color, ht.league AS home_league,
  at.name AS away_name, at.short_name AS away_short, at.slug AS away_slug, at.logo AS away_logo, at.color AS away_color, at.league AS away_league,
  u.name AS photographer_name, u.slug AS photographer_slug, u.avatar AS photographer_avatar, u.id AS photographer_id,
  (SELECT COUNT(*) FROM foto_photos p WHERE p.album_id = a.id) AS photo_count
`;

function shapeAlbum(row) {
  if (!row) return null;
  const title =
    row.title === 'Obnovené album' ? `${row.home_short} vs ${row.away_short}` : row.title;
  return {
    ...row,
    title,
    score: albumScore(row),
    date_label: formatDate(row.match_date),
    date_input: dateInput(row.match_date),
    cover_url: row.cover_photo_id ? mediaUrl(row.cover_photo_id, 'thumb') : null,
    photographer_initials: initials(row.photographer_name),
  };
}

function listAlbums({ tym, liga, q } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (tym) {
    where.push('(ht.slug = @tym OR at.slug = @tym)');
    params.tym = tym;
  } else if (liga) {
    where.push('(ht.league = @liga OR at.league = @liga OR a.competition = @liga)');
    params.liga = liga;
  }
  if (q) {
    where.push(
      `(a.title LIKE @q OR a.competition LIKE @q OR a.venue LIKE @q OR ht.name LIKE @q OR at.name LIKE @q OR u.name LIKE @q)`
    );
    params.q = `%${q}%`;
  }
  const sql = `
    SELECT ${ALBUM_SELECT}
    FROM foto_albums a
    JOIN foto_teams ht ON ht.id = a.home_team_id
    JOIN foto_teams at ON at.id = a.away_team_id
    JOIN foto_users u ON u.id = a.photographer_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.match_date DESC
  `;
  return db.prepare(sql).all(params).map(shapeAlbum);
}

function packSquad(teamId, name, shortName, logo) {
  if (!teamId) {
    return { id: null, name: name || '', short: shortName || '', logo: logo || '', players: [] };
  }
  return {
    id: teamId,
    name: name || '',
    short: shortName || '',
    logo: logo || '',
    players: listTeamPlayers(teamId, 'PLAYER').map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      number: p.number,
      position: p.position || '',
      livesportId: p.livesport_id || '',
      photo: chancePlayerPhoto(p.livesport_id, p.name, name) || p.photo || '/user.png',
    })),
  };
}

function albumSquads(album) {
  if (!album) return { home: packSquad(null), away: packSquad(null) };
  return {
    home: packSquad(album.home_team_id, album.home_name, album.home_short, album.home_logo),
    away: packSquad(album.away_team_id, album.away_name, album.away_short, album.away_logo),
  };
}

function getAlbum(id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ${ALBUM_SELECT}
       FROM foto_albums a
       JOIN foto_teams ht ON ht.id = a.home_team_id
       JOIN foto_teams at ON at.id = a.away_team_id
       JOIN foto_users u ON u.id = a.photographer_id
       WHERE a.id = ?`
    )
    .get(id);
  return shapeAlbum(row);
}

function listAlbumPhotos(albumId) {
  const db = getDb();
  const photos = db
    .prepare(
      `SELECT id, album_id, original_name, mime_type, size, width, height, kind, sort_order
       FROM foto_photos WHERE album_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC`
    )
    .all(albumId);
  const tags = db
    .prepare(
      `SELECT t.id, t.photo_id, t.x, t.y, p.name, p.slug, p.number, tm.short_name AS team, tm.slug AS team_slug
       FROM foto_photo_tags t
       JOIN foto_players p ON p.id = t.player_id
       LEFT JOIN foto_teams tm ON tm.id = p.team_id
       WHERE t.photo_id IN (SELECT id FROM foto_photos WHERE album_id = ?)`
    )
    .all(albumId);
  const byPhoto = new Map();
  for (const tag of tags) {
    if (!byPhoto.has(tag.photo_id)) byPhoto.set(tag.photo_id, []);
    byPhoto.get(tag.photo_id).push({
      id: tag.id,
      x: tag.x,
      y: tag.y,
      player: {
        name: tag.name,
        slug: tag.slug,
        number: tag.number,
        team: tag.team || null,
        teamSlug: tag.team_slug || null,
      },
    });
  }
  return photos.map((p) => ({
    id: p.id,
    width: p.width,
    height: p.height,
    originalName: p.original_name,
    size: p.size,
    kind: p.kind,
    thumbSrc: mediaUrl(p.id, 'thumb'),
    viewSrc: mediaUrl(p.id, 'view'),
    tags: byPhoto.get(p.id) || [],
  }));
}

function getPhoto(id) {
  return getDb().prepare('SELECT * FROM foto_photos WHERE id = ?').get(id);
}

function usedTeams() {
  return getDb()
    .prepare(
      `SELECT slug, name, short_name, color, logo, league
       FROM foto_teams
       WHERE id IN (SELECT home_team_id FROM foto_albums UNION SELECT away_team_id FROM foto_albums)
       ORDER BY name ASC`
    )
    .all();
}

function usedLeagues() {
  return getDb()
    .prepare(
      `SELECT DISTINCT league
       FROM foto_teams
       WHERE league IS NOT NULL AND TRIM(league) != ''
         AND id IN (SELECT home_team_id FROM foto_albums UNION SELECT away_team_id FROM foto_albums)
       ORDER BY league ASC`
    )
    .all()
    .map((row) => row.league);
}

function getTeam(slug) {
  return getDb().prepare('SELECT * FROM foto_teams WHERE slug = ?').get(slug);
}

function listTeams({ q, liga } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (liga) {
    where.push('league = @liga');
    params.liga = liga;
  }
  if (q) {
    where.push('(name LIKE @q OR short_name LIKE @q)');
    params.q = `%${q}%`;
  }
  return db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM foto_players p WHERE p.team_id = t.id AND p.role = 'PLAYER') AS player_count,
        (SELECT COUNT(*) FROM foto_albums a WHERE a.home_team_id = t.id OR a.away_team_id = t.id) AS album_count
       FROM foto_teams t
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.name ASC`
    )
    .all(params);
}

function listTeamPlayers(teamId, role) {
  const db = getDb();
  if (role) {
    return db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM foto_photo_tags t WHERE t.player_id = p.id) AS tag_count
         FROM foto_players p WHERE p.team_id = ? AND p.role = ? ORDER BY (p.number IS NULL), p.number, p.name`
      )
      .all(teamId, role);
  }
  return db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM foto_photo_tags t WHERE t.player_id = p.id) AS tag_count
       FROM foto_players p WHERE p.team_id = ? ORDER BY p.role, (p.number IS NULL), p.number, p.name`
    )
    .all(teamId);
}

function getPlayer(slug) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*, t.name AS team_name, t.short_name AS team_short, t.slug AS team_slug, t.logo AS team_logo
       FROM foto_players p LEFT JOIN foto_teams t ON t.id = p.team_id WHERE p.slug = ?`
    )
    .get(slug);
  if (row) {
    row.photo = chancePlayerPhoto(row.livesport_id, row.name, row.team_name) || row.photo;
  }
  return row;
}

function listPlayers({ q, role } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (role) {
    where.push('p.role = @role');
    params.role = role;
  }
  if (q) {
    where.push('p.name LIKE @q');
    params.q = `%${q}%`;
  }
  return db
    .prepare(
      `SELECT p.*, t.name AS team_name, t.short_name AS team_short, t.slug AS team_slug, t.logo AS team_logo,
        (SELECT COUNT(*) FROM foto_photo_tags tg WHERE tg.player_id = p.id) AS tag_count
       FROM foto_players p
       LEFT JOIN foto_teams t ON t.id = p.team_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY tag_count DESC, p.name ASC
       LIMIT 200`
    )
    .all(params);
}

function playerPhotos(playerId, limit = 60) {
  const db = getDb();
  return db
    .prepare(
      `SELECT ph.id, ph.width, ph.height, ph.kind, a.id AS album_id, a.title AS album_title
       FROM foto_photo_tags t
       JOIN foto_photos ph ON ph.id = t.photo_id
       JOIN foto_albums a ON a.id = ph.album_id
       WHERE t.player_id = ?
       ORDER BY a.match_date DESC
       LIMIT ?`
    )
    .all(playerId, limit)
    .map((p) => ({
      ...p,
      thumbSrc: mediaUrl(p.id, 'thumb'),
      viewSrc: mediaUrl(p.id, 'view'),
    }));
}

function listPhotographers() {
  return getDb()
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM foto_albums a WHERE a.photographer_id = u.id) AS album_count
       FROM foto_users u
       WHERE u.status = 'APPROVED' AND u.role IN ('PHOTOGRAPHER', 'ADMIN')
       ORDER BY album_count DESC, u.name ASC`
    )
    .all();
}

function getPhotographer(slug) {
  return getDb()
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM foto_albums a WHERE a.photographer_id = u.id) AS album_count
       FROM foto_users u WHERE u.slug = ?`
    )
    .get(slug);
}

function listPresets() {
  return getDb().prepare('SELECT * FROM foto_presets ORDER BY created_at DESC').all();
}

function getShare(token) {
  const db = getDb();
  const share = db
    .prepare(
      `SELECT s.*, p.name AS player_name, p.slug AS player_slug, p.photo AS player_photo, p.number AS player_number
       FROM foto_shares s JOIN foto_players p ON p.id = s.player_id WHERE s.token = ?`
    )
    .get(token);
  if (!share || share.revoked_at) return null;
  return share;
}

function sharePhotos(playerId) {
  return playerPhotos(playerId, 400);
}

function searchAll(q) {
  const query = String(q || '').trim();
  if (query.length < 2) {
    return { players: [], albums: [], teams: [], photographers: [] };
  }
  return {
    players: listPlayers({ q: query }).slice(0, 12),
    albums: listAlbums({ q: query }).slice(0, 9),
    teams: listTeams({ q: query }).slice(0, 12),
    photographers: listPhotographers().filter((p) =>
      String(p.name || '').toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8),
  };
}

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function listFixtures({ liga, q } = {}) {
  const now = Date.now();
  const today = pragueDayKey(new Date(now).toISOString());
  const liveWindow = 3 * 60 * 60 * 1000 + 15 * 60 * 1000;
  const query = String(q || '').trim().toLowerCase();
  return loadFixtures()
    .map((f) => {
      const t = new Date(f.kickoff).getTime();
      const dateKey = pragueDayKey(f.kickoff);
      let state = 'pre';
      if (Number.isFinite(t)) {
        if (now >= t + liveWindow) state = 'post';
        else if (now >= t) state = 'in';
      }
      const isLive = state === 'in';
      const isToday = dateKey === today;
      return {
        ...f,
        date_label: formatDate(f.kickoff),
        time_label: isLive ? 'Živě' : formatTime(f.kickoff),
        date_key: dateKey,
        isLive,
        isToday,
        isDone: state === 'post',
        state,
      };
    })
    .filter((f) => f.isLive || f.isToday || f.date_key >= today)
    .filter((f) => (liga ? f.league === liga : true))
    .filter((f) => {
      if (!query) return true;
      return (
        String(f.homeName || '').toLowerCase().includes(query) ||
        String(f.awayName || '').toLowerCase().includes(query) ||
        String(f.venue || '').toLowerCase().includes(query) ||
        String(f.city || '').toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return String(a.kickoff).localeCompare(String(b.kickoff));
    });
}

function fixtureToMatchCard(f) {
  const slug = `${slugify(f.homeName || 'domaci')}-vs-${slugify(f.awayName || 'hoste')}-${f.id}`;
  return {
    id: f.id,
    home: f.homeName,
    away: f.awayName,
    homeLogo: f.homeLogo || '',
    awayLogo: f.awayLogo || '',
    date: f.kickoff,
    kickoff: f.kickoff,
    dayKey: f.date_key,
    isLive: Boolean(f.isLive),
    isDone: Boolean(f.isDone),
    time: f.time_label,
    badge: f.isLive ? 'LIVE' : f.isDone ? 'FT' : f.time_label,
    scoreLine: '–',
    score: '',
    league: f.league || '',
    round: f.round || '',
    detailHref: `/zapasy/chance/${slug}`,
    matchKey: `foto:${f.id}`,
  };
}

function fixtureLeagues() {
  const set = new Set(loadFixtures().map((f) => f.league).filter(Boolean));
  return COMPETITIONS.filter((c) => set.has(c)).concat(
    [...set].filter((c) => !COMPETITIONS.includes(c))
  );
}

function stats() {
  const db = getDb();
  return {
    albums: db.prepare('SELECT COUNT(*) AS c FROM foto_albums').get().c,
    photos: db.prepare('SELECT COUNT(*) AS c FROM foto_photos').get().c,
    players: db.prepare("SELECT COUNT(*) AS c FROM foto_players WHERE role = 'PLAYER'").get().c,
    teams: db.prepare('SELECT COUNT(*) AS c FROM foto_teams').get().c,
  };
}

function ensurePhotographerForUser(user) {
  const db = getDb();
  const email = String(user && user.email ? user.email : '').trim().toLowerCase();
  if (email) {
    const existing = db.prepare('SELECT * FROM foto_users WHERE email = ?').get(email);
    if (existing) return existing;
  }
  const name = (user && (user.display_name || user.email)) || 'Redakce 11ka';
  const baseSlug = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'redakce';
  let slug = baseSlug;
  let i = 2;
  while (db.prepare('SELECT id FROM foto_users WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${i++}`;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO foto_users (id, email, name, slug, avatar, role, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'PHOTOGRAPHER', 'APPROVED', ?)`
  ).run(id, email || null, name, slug, user && user.avatar_path ? user.avatar_path : null, new Date().toISOString());
  return db.prepare('SELECT * FROM foto_users WHERE id = ?').get(id);
}

function findOrCreateTeam({ id, name, shortName }) {
  const db = getDb();
  if (id) {
    const existing = db.prepare('SELECT * FROM foto_teams WHERE id = ?').get(id);
    if (existing) return existing;
  }
  const n = String(name || '').trim();
  if (n.length < 2) return null;
  const existing = db.prepare('SELECT * FROM foto_teams WHERE name = ? COLLATE NOCASE').get(n);
  if (existing) return existing;
  const slugBase = n
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || `tym-${newId().slice(0, 6)}`;
  let slug = slugBase;
  let i = 2;
  while (db.prepare('SELECT id FROM foto_teams WHERE slug = ?').get(slug)) {
    slug = `${slugBase}-${i++}`;
  }
  const teamId = newId();
  const short = String(shortName || n).trim().slice(0, 8).toUpperCase();
  db.prepare(
    `INSERT INTO foto_teams (id, name, slug, short_name, city, color, logo, league)
     VALUES (?, ?, ?, ?, NULL, '#16dffb', NULL, '')`
  ).run(teamId, n, slug, short);
  return db.prepare('SELECT * FROM foto_teams WHERE id = ?').get(teamId);
}

function createAlbum(input) {
  const db = getDb();
  const home = findOrCreateTeam({ id: input.homeTeamId, name: input.homeTeamName, shortName: input.homeTeamShort });
  const away = findOrCreateTeam({ id: input.awayTeamId, name: input.awayTeamName, shortName: input.awayTeamShort });
  if (!home || !away || home.id === away.id) return { error: 'teams' };
  const id = newId();
  const title = String(input.title || '').trim() || `${home.short_name} vs ${away.short_name}`;
  const now = new Date().toISOString();
  const matchDate = input.matchDate ? `${input.matchDate}T12:00:00.000Z` : now;
  db.prepare(
    `INSERT INTO foto_albums (id, title, match_date, competition, venue, notes, home_score, away_score, home_team_id, away_team_id, photographer_id, cover_photo_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    id,
    title,
    matchDate,
    input.competition || 'Chance Liga',
    input.venue || null,
    input.notes || null,
    input.homeScore == null || input.homeScore === '' ? null : Number(input.homeScore),
    input.awayScore == null || input.awayScore === '' ? null : Number(input.awayScore),
    home.id,
    away.id,
    input.photographerId,
    now,
    now
  );
  return { id };
}

function updateAlbum(id, input) {
  const db = getDb();
  const current = getAlbum(id);
  if (!current) return { error: 'missing' };
  const home = findOrCreateTeam({
    id: input.homeTeamId || current.home_team_id,
    name: input.homeTeamName,
    shortName: input.homeTeamShort,
  });
  const away = findOrCreateTeam({
    id: input.awayTeamId || current.away_team_id,
    name: input.awayTeamName,
    shortName: input.awayTeamShort,
  });
  if (!home || !away || home.id === away.id) return { error: 'teams' };
  const title = String(input.title || '').trim() || `${home.short_name} vs ${away.short_name}`;
  const matchDate = input.matchDate
    ? `${input.matchDate}T12:00:00.000Z`
    : current.match_date;
  db.prepare(
    `UPDATE foto_albums
     SET title = ?, match_date = ?, competition = ?, venue = ?, notes = ?,
         home_score = ?, away_score = ?, home_team_id = ?, away_team_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    title,
    matchDate,
    input.competition || current.competition || 'Chance Liga',
    input.venue || null,
    input.notes || null,
    input.homeScore == null || input.homeScore === '' ? null : Number(input.homeScore),
    input.awayScore == null || input.awayScore === '' ? null : Number(input.awayScore),
    home.id,
    away.id,
    new Date().toISOString(),
    id
  );
  return { id };
}

async function addPhotoFile(albumId, file) {
  const db = getDb();
  const album = db.prepare('SELECT id FROM foto_albums WHERE id = ?').get(albumId);
  if (!album) return null;
  const sharp = require('sharp');
  const buf = file.buffer;
  const id = newId();
  let width = 0;
  let height = 0;
  let thumbBuf = buf;
  try {
    const image = sharp(buf, { failOn: 'none' }).rotate();
    const meta = await image.metadata();
    width = meta.width || 0;
    height = meta.height || 0;
    thumbBuf = await image
      .clone()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    thumbBuf = buf;
  }

  let originalPath;
  let thumbPath;
  if (fotoS3.hasS3Store()) {
    originalPath = await fotoS3.putS3Object(
      fotoS3.newObjectKey(`albums/${albumId}`, file.originalname || `${id}.jpg`),
      buf,
      file.mimetype || 'application/octet-stream'
    );
    thumbPath = await fotoS3.putS3Object(
      fotoS3.newObjectKey(`albums/${albumId}/thumbs`, `${id}.jpg`),
      thumbBuf,
      'image/jpeg'
    );
  } else {
    const { storageDir } = require('../db');
    const dir = path.join(storageDir, 'foto-uploads', albumId);
    fs.mkdirSync(dir, { recursive: true });
    const origName = `${id}${path.extname(file.originalname || '') || '.jpg'}`;
    fs.writeFileSync(path.join(dir, origName), buf);
    fs.writeFileSync(path.join(dir, `${id}_thumb.jpg`), thumbBuf);
    originalPath = path.join(dir, origName);
    thumbPath = path.join(dir, `${id}_thumb.jpg`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO foto_photos (id, album_id, original_name, mime_type, size, width, height, original_path, thumb_path, kind, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTION', 0, ?)`
  ).run(
    id,
    albumId,
    file.originalname || 'foto.jpg',
    file.mimetype || 'image/jpeg',
    buf.length,
    width,
    height,
    originalPath,
    thumbPath,
    now
  );
  const cover = db.prepare('SELECT cover_photo_id FROM foto_albums WHERE id = ?').get(albumId);
  if (!cover.cover_photo_id) {
    db.prepare('UPDATE foto_albums SET cover_photo_id = ?, updated_at = ? WHERE id = ?').run(id, now, albumId);
  }
  return id;
}

function deletePhoto(photoId) {
  const db = getDb();
  const photo = getPhoto(photoId);
  if (!photo) return false;
  db.prepare('DELETE FROM foto_photos WHERE id = ?').run(photoId);
  db.prepare('UPDATE foto_albums SET cover_photo_id = NULL WHERE cover_photo_id = ?').run(photoId);
  return true;
}

function shapeTag(row) {
  if (!row) return null;
  return {
    id: row.id,
    photo_id: row.photo_id,
    x: row.x,
    y: row.y,
    player: {
      id: row.player_id,
      name: row.name,
      slug: row.slug,
      number: row.number,
      team: row.team || null,
      teamSlug: row.team_slug || null,
    },
  };
}

function getTag(id) {
  return shapeTag(
    getDb()
      .prepare(
        `SELECT t.id, t.photo_id, t.x, t.y, t.player_id, p.name, p.slug, p.number,
                tm.short_name AS team, tm.slug AS team_slug
         FROM foto_photo_tags t
         JOIN foto_players p ON p.id = t.player_id
         LEFT JOIN foto_teams tm ON tm.id = p.team_id
         WHERE t.id = ?`
      )
      .get(id)
  );
}

function addTag(photoId, playerId, x, y) {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM foto_photo_tags WHERE photo_id = ? AND player_id = ?')
    .get(photoId, playerId);
  if (existing) {
    db.prepare('UPDATE foto_photo_tags SET x = ?, y = ? WHERE id = ?').run(
      Number(x) || 50,
      Number(y) || 50,
      existing.id
    );
    return getTag(existing.id);
  }
  const id = newId();
  db.prepare(
    `INSERT INTO foto_photo_tags (id, photo_id, player_id, x, y) VALUES (?, ?, ?, ?, ?)`
  ).run(id, photoId, playerId, Number(x) || 50, Number(y) || 50);
  return getTag(id);
}

function removeTag(tagId) {
  getDb().prepare('DELETE FROM foto_photo_tags WHERE id = ?').run(tagId);
}

function searchPlayers(q, { homeTeamId, awayTeamId } = {}) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const list = listPlayers({ q: query }).slice(0, 24);
  if (!homeTeamId && !awayTeamId) return list.slice(0, 20);
  return list
    .sort((a, b) => {
      const rank = (p) => (p.team_id === homeTeamId || p.team_id === awayTeamId ? 0 : 1);
      return rank(a) - rank(b);
    })
    .slice(0, 20);
}

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findHeroByTag(query) {
  const hay = ` ${norm(query)} `;
  if (hay.trim().length < 4) return null;
  const db = getDb();
  const players = db
    .prepare(
      `SELECT p.id, p.name, p.slug, t.name AS team_name
       FROM foto_players p
       LEFT JOIN foto_teams t ON t.id = p.team_id
       WHERE EXISTS (SELECT 1 FROM foto_photo_tags tg WHERE tg.player_id = p.id)
       LIMIT 2500`
    )
    .all();
  const hits = players
    .map((p) => {
      const parts = String(p.name || '').trim().split(/\s+/).filter(Boolean);
      const ln = parts[parts.length - 1] || '';
      if (ln.length < 4) return null;
      const needle = norm(ln);
      if (!new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(hay)) return null;
      return { player: p, score: needle.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  for (const hit of hits.slice(0, 8)) {
    const photo = db
      .prepare(
        `SELECT ph.id, u.name AS photographer
         FROM foto_photo_tags t
         JOIN foto_photos ph ON ph.id = t.photo_id
         JOIN foto_albums a ON a.id = ph.album_id
         JOIN foto_users u ON u.id = a.photographer_id
         WHERE t.player_id = ?
         ORDER BY ph.kind ASC, ph.created_at DESC
         LIMIT 1`
      )
      .get(hit.player.id);
    if (!photo) continue;
    return {
      photoId: photo.id,
      player: { name: hit.player.name, slug: hit.player.slug, team: hit.player.team_name || null },
      credit: `${photo.photographer || 'Foták 11ka'} / foto.11ka.cz`,
    };
  }
  return null;
}

async function readMediaBytes(photo, variant) {
  const rel = variant === 'view' || variant === 'original' ? photo.original_path : photo.thumb_path;
  if (fotoS3.isS3Path(rel) && fotoS3.hasS3Store()) {
    try {
      const hit = await fotoS3.readS3Bytes(rel);
      if (hit) return hit;
    } catch (err) {
      console.error('[11ka] foto s3 read failed:', err && err.message);
    }
  }
  if (rel && !fotoS3.isS3Path(rel) && !String(rel).startsWith('http')) {
    const abs = path.isAbsolute(rel)
      ? rel
      : rel.startsWith('public/')
        ? path.join(__dirname, '..', rel)
        : path.join(__dirname, '..', 'public', String(rel).replace(/^\//, ''));
    if (fs.existsSync(abs)) {
      return { buf: fs.readFileSync(abs), contentType: photo.mime_type || 'image/jpeg' };
    }
  }
  const remote = await fotoS3.readRemotePublicMedia(photo.id, variant === 'view' || variant === 'original' ? 'view' : 'thumb');
  if (remote) return remote;
  return null;
}

module.exports = {
  COMPETITIONS,
  ensureTables,
  stats,
  formatDate,
  initials,
  mediaUrl,
  listAlbums,
  getAlbum,
  albumSquads,
  listAlbumPhotos,
  getPhoto,
  usedTeams,
  usedLeagues,
  getTeam,
  listTeams,
  listTeamPlayers,
  getPlayer,
  listPlayers,
  playerPhotos,
  listPhotographers,
  getPhotographer,
  listPresets,
  getShare,
  sharePhotos,
  searchAll,
  listFixtures,
  fixtureToMatchCard,
  fixtureLeagues,
  ensurePhotographerForUser,
  createAlbum,
  updateAlbum,
  addPhotoFile,
  deletePhoto,
  addTag,
  removeTag,
  searchPlayers,
  findHeroByTag,
  readMediaBytes,
};

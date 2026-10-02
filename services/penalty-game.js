const { getDb } = require('../db');

const DEFAULT_OPPONENT = {
  stand: '/images/penalty-keeper.webp',
  left: '/images/penalty-keeper-dive-left.webp',
  right: '/images/penalty-keeper-dive-right.webp',
  high: '/images/penalty-keeper-dive-high.webp',
};

const DEFAULT_THUMB_POSITION = '50% calc(50% + 0px)';
const DEFAULT_THUMB_SCALE = 1;
const MIN_THUMB_SCALE = 0.5;
const MAX_THUMB_SCALE = 5;

const DEFAULT_FACE_TOP_PCT = 14;
const DEFAULT_FACE_LEFT_PCT = 50;
const DEFAULT_FACE_SIZE_PCT = 100;
const DEFAULT_FACE_CROP = '50% 32%';
const DEFAULT_FACE_CROP_SCALE = 1;
const MIN_FACE_SIZE_PCT = 3;
const MAX_FACE_SIZE_PCT = 500;
const MIN_FACE_CROP_SCALE = 0.5;
const MAX_FACE_CROP_SCALE = 3;

const KEEPER_SELECT_COLS = `id, slug, name, experience_stars, points_per_goal, thumb_path, thumb_position, thumb_scale,
              thumb_mobile_position, thumb_mobile_scale,
              face_top_pct, face_left_pct, face_size_pct, face_crop, face_crop_scale,
              team_name, image_stand, image_left, image_right, image_high`;

const DEFAULT_TEXTS = {
  menu_title: 'Připraven na penalty?',
  menu_desc: '5 střel na branku. Vyberte směr - trefíte síť, nebo vás chytí brankář?',
  pick_title: 'Než se pustíš do penalt…',
  pick_desc: 'Vyber si brankáře. Čím víc hvězd má, tím častěji střelu chytí.',
  pick_button: 'Do penalt',
  register_title: 'Než vstoupíš na hřiště…',
  register_desc:
    'Pro pokračování vyplň jméno nebo přezdívku a e-mail. E-mail uvidí jen správci webu - můžeme vás v budoucnu kontaktovat ohledně soutěží a dalších akcí kolem této hry.',
  register_name_label: 'Jméno nebo přezdívka',
  register_email_label: 'E-mail',
  register_button: 'Pokračovat k výběru brankáře',
  login_tab: 'Přihlášení',
  register_tab: 'Registrace',
  login_desc: 'Už jsi hrál? Zadej e-mail a pokračuj ve svém skóre.',
  login_button: 'Přihlásit se a pokračovat',
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

function normalizeSlug(v) {
  const t = normalizeText(v);
  if (!t) return null;
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePath(v) {
  const t = normalizeText(v);
  if (!t) return null;
  return t.startsWith('/') ? t : `/${t}`;
}

function normalizeImagePosition(value, fallback) {
  if (value == null || value === '') return fallback || null;
  const str = String(value).trim();
  if (!str) return fallback || null;
  const m = str.match(/^(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/);
  if (!m) return fallback || null;
  const x = Math.max(0, Math.min(100, Number(m[1])));
  const y = Math.max(0, Math.min(100, Number(m[2])));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback || null;
  return `${x}% ${y}%`;
}

function normalizeThumbPosition(value, fallback) {
  if (value == null || value === '') return fallback || DEFAULT_THUMB_POSITION;
  const str = String(value).trim();
  const calcMatch = str.match(/^50%\s+calc\(50%\s*\+\s*(-?\d+(?:\.\d+)?)px\)$/i);
  if (calcMatch) {
    const px = Number(calcMatch[1]);
    if (!Number.isFinite(px)) return fallback || DEFAULT_THUMB_POSITION;
    return `50% calc(50% + ${Math.round(px * 10) / 10}px)`;
  }
  const m = str.match(/^(\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
  if (!m) return fallback || DEFAULT_THUMB_POSITION;
  const y = Number(m[2]);
  if (!Number.isFinite(y)) return DEFAULT_THUMB_POSITION;
  return `50% ${Math.round(y * 10) / 10}%`;
}

function normalizeThumbScale(value, fallback) {
  const fb = fallback != null ? fallback : DEFAULT_THUMB_SCALE;
  if (value == null || value === '') return fb;
  const n = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return fb;
  const clamped = Math.max(MIN_THUMB_SCALE, Math.min(MAX_THUMB_SCALE, n));
  return Math.round(clamped * 100) / 100;
}

function normalizeFacePct(value, fallback, min = 0, max = 100) {
  const fb = fallback != null ? fallback : 0;
  if (value == null || value === '') return fb;
  const n = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return fb;
  return Math.round(Math.max(min, Math.min(max, n)) * 10) / 10;
}

function normalizeFaceCropScale(value, fallback) {
  const fb = fallback != null ? fallback : DEFAULT_FACE_CROP_SCALE;
  if (value == null || value === '') return fb;
  const n = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return fb;
  const clamped = Math.max(MIN_FACE_CROP_SCALE, Math.min(MAX_FACE_CROP_SCALE, n));
  return Math.round(clamped * 100) / 100;
}

function normalizePoints(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 99) return 99;
  return n;
}

function normalizeExperienceStars(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

function slugExists(slug, excludeId) {
  if (!slug) return false;
  const row =
    excludeId != null
      ? getDb().prepare('SELECT id FROM penalty_keepers WHERE slug = ? AND id != ?').get(slug, excludeId)
      : getDb().prepare('SELECT id FROM penalty_keepers WHERE slug = ?').get(slug);
  return !!row;
}

function uniqueSlugForKeeper(name, excludeId) {
  let base = normalizeSlug(name) || 'brankar';
  let slug = base;
  let n = 2;
  while (slugExists(slug, excludeId)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

function normalizeMaxRounds(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return 5;
  if (n > 20) return 20;
  return n;
}

function pointsMetaLabel(points) {
  if (points === 1) return '1 bod za gól';
  if (points >= 2 && points <= 4) return `${points} body za gól`;
  return `${points} bodů za gól`;
}

function rowToSettings(row) {
  if (!row) return null;
  return {
    max_rounds: row.max_rounds,
    menu_title: row.menu_title,
    menu_desc: row.menu_desc,
    pick_title: row.pick_title,
    pick_desc: row.pick_desc,
    pick_button: row.pick_button,
    opponent_stand: row.opponent_stand,
    opponent_left: row.opponent_left,
    opponent_right: row.opponent_right,
    opponent_high: row.opponent_high,
    is_active: !!row.is_active,
    updated_at: row.updated_at,
  };
}

function isCustomKeeperThumb(path) {
  const p = normalizePath(path);
  if (!p) return false;
  return p.includes('/uploads/');
}

function rowToKeeper(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    experience_stars: row.experience_stars != null ? row.experience_stars : 1,
    points_per_goal: row.points_per_goal,
    thumb_path: row.thumb_path,
    thumb_position: normalizeThumbPosition(row.thumb_position, DEFAULT_THUMB_POSITION),
    thumb_scale: normalizeThumbScale(row.thumb_scale, DEFAULT_THUMB_SCALE),
    thumb_mobile_position:
      row.thumb_mobile_position != null && row.thumb_mobile_position !== ''
        ? normalizeThumbPosition(row.thumb_mobile_position, DEFAULT_THUMB_POSITION)
        : null,
    thumb_mobile_scale:
      row.thumb_mobile_scale != null && row.thumb_mobile_scale !== ''
        ? normalizeThumbScale(row.thumb_mobile_scale, DEFAULT_THUMB_SCALE)
        : null,
    face_top_pct: normalizeFacePct(row.face_top_pct, DEFAULT_FACE_TOP_PCT),
    face_left_pct: normalizeFacePct(row.face_left_pct, DEFAULT_FACE_LEFT_PCT),
    face_size_pct: normalizeFacePct(
      row.face_size_pct,
      DEFAULT_FACE_SIZE_PCT,
      MIN_FACE_SIZE_PCT,
      MAX_FACE_SIZE_PCT
    ),
    face_crop: normalizeImagePosition(row.face_crop, DEFAULT_FACE_CROP),
    face_crop_scale: normalizeFaceCropScale(row.face_crop_scale, DEFAULT_FACE_CROP_SCALE),
    team_name: row.team_name,
    image_stand: row.image_stand,
    image_left: row.image_left,
    image_right: row.image_right,
    image_high: row.image_high,
    is_active: !!row.is_active,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getSettingsRow() {
  return getDb().prepare('SELECT * FROM penalty_settings WHERE id = 1').get();
}

function ensureSettingsRow() {
  const existing = getSettingsRow();
  if (existing) return existing;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO penalty_settings (
        id, max_rounds, menu_title, menu_desc, pick_title, pick_desc, pick_button,
        opponent_stand, opponent_left, opponent_right, opponent_high, is_active, updated_at
      ) VALUES (1, 5, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      DEFAULT_TEXTS.menu_title,
      DEFAULT_TEXTS.menu_desc,
      DEFAULT_TEXTS.pick_title,
      DEFAULT_TEXTS.pick_desc,
      DEFAULT_TEXTS.pick_button,
      DEFAULT_OPPONENT.stand,
      DEFAULT_OPPONENT.left,
      DEFAULT_OPPONENT.right,
      DEFAULT_OPPONENT.high,
      now
    );
  return getSettingsRow();
}

function seedKeepersIfEmpty() {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM penalty_keepers').get();
  if (row.c > 0) return;
  const now = nowIso();
  const stmt = getDb().prepare(
    `INSERT INTO penalty_keepers (
      slug, name, experience_stars, points_per_goal, thumb_path, thumb_position, thumb_scale, team_name, image_stand, image_left, image_right, image_high,
      is_active, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 1, ?, ?, ?)`
  );
  const defaults = [
    ['novacek', 'Nováček', 1, 1, DEFAULT_OPPONENT.stand, null, 0],
    ['profik', 'Profík', 2, 2, DEFAULT_OPPONENT.stand, null, 1],
    ['legenda', 'Legenda', 3, 3, DEFAULT_OPPONENT.stand, null, 2],
  ];
  defaults.forEach(([slug, name, stars, points, thumb, teamName, sort]) => {
    stmt.run(slug, name, stars, points, thumb, DEFAULT_THUMB_POSITION, DEFAULT_THUMB_SCALE, teamName, sort, now, now);
  });
}

function ensureKeeperColumns() {
  const cols = getDb().prepare('PRAGMA table_info(penalty_keepers)').all();
  const names = new Set(cols.map((c) => c && c.name));
  if (!names.has('thumb_position')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN thumb_position TEXT;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('thumb_scale')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN thumb_scale REAL;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('thumb_mobile_position')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN thumb_mobile_position TEXT;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('thumb_mobile_scale')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN thumb_mobile_scale REAL;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('face_top_pct')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN face_top_pct REAL;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('face_left_pct')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN face_left_pct REAL;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('face_size_pct')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN face_size_pct REAL;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('face_crop')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN face_crop TEXT;');
    } catch {
      /* column already exists */
    }
  }
  if (!names.has('face_crop_scale')) {
    try {
      getDb().exec('ALTER TABLE penalty_keepers ADD COLUMN face_crop_scale REAL;');
    } catch {
      /* column already exists */
    }
  }
}

function migratePickDescText() {
  const row = getSettingsRow();
  if (!row?.pick_desc) return;
  const migrated = row.pick_desc
    .replace(/\s*Čím víc bodů za gól, tím vyšší násobitel skóre\.?\s*$/, '')
    .trim();
  if (migrated && migrated !== row.pick_desc) {
    getDb().prepare('UPDATE penalty_settings SET pick_desc = ? WHERE id = 1').run(migrated);
  }
}

function migrateFaceSizeDefault() {
  try {
    getDb().exec('UPDATE penalty_keepers SET face_size_pct = 100 WHERE face_size_pct IS NULL');
  } catch {
    /* ignore */
  }
}

function initPenaltyGame() {
  ensureKeeperColumns();
  migrateFaceSizeDefault();
  ensureSettingsRow();
  migratePickDescText();
  seedKeepersIfEmpty();
}

function getSettings() {
  initPenaltyGame();
  return rowToSettings(ensureSettingsRow());
}

function updateSettings(data) {
  initPenaltyGame();
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE penalty_settings SET
        max_rounds = ?, menu_title = ?, menu_desc = ?, pick_title = ?, pick_desc = ?, pick_button = ?,
        opponent_stand = ?, opponent_left = ?, opponent_right = ?, opponent_high = ?,
        is_active = ?, updated_at = ?
       WHERE id = 1`
    )
    .run(
      normalizeMaxRounds(data.max_rounds),
      normalizeText(data.menu_title) || DEFAULT_TEXTS.menu_title,
      normalizeText(data.menu_desc) || DEFAULT_TEXTS.menu_desc,
      normalizeText(data.pick_title) || DEFAULT_TEXTS.pick_title,
      normalizeText(data.pick_desc) || DEFAULT_TEXTS.pick_desc,
      normalizeText(data.pick_button) || DEFAULT_TEXTS.pick_button,
      normalizePath(data.opponent_stand) || DEFAULT_OPPONENT.stand,
      normalizePath(data.opponent_left) || DEFAULT_OPPONENT.left,
      normalizePath(data.opponent_right) || DEFAULT_OPPONENT.right,
      normalizePath(data.opponent_high) || DEFAULT_OPPONENT.high,
      data.is_active ? 1 : 0,
      now
    );
}

function getKeeperById(id) {
  initPenaltyGame();
  const row = getDb()
    .prepare(
      `SELECT ${KEEPER_SELECT_COLS},
              is_active, sort_order, created_at, updated_at
       FROM penalty_keepers WHERE id = ?`
    )
    .get(id);
  return row ? rowToKeeper(row) : null;
}

function listKeepersForAdmin() {
  initPenaltyGame();
  return getDb()
    .prepare(
      `SELECT ${KEEPER_SELECT_COLS},
              is_active, sort_order, created_at, updated_at
       FROM penalty_keepers
       ORDER BY sort_order ASC, id ASC`
    )
    .all()
    .map(rowToKeeper);
}

function listActiveKeepersForWeb() {
  initPenaltyGame();
  return getDb()
    .prepare(
      `SELECT ${KEEPER_SELECT_COLS}
       FROM penalty_keepers
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    )
    .all()
    .map((row) => {
      const thumb = row.thumb_path || DEFAULT_OPPONENT.stand;
      const hasCustomPoses = !!(
        row.image_stand ||
        row.image_left ||
        row.image_right ||
        row.image_high
      );
      const thumbPosition = normalizeThumbPosition(row.thumb_position, DEFAULT_THUMB_POSITION);
      const thumbScale = normalizeThumbScale(row.thumb_scale, DEFAULT_THUMB_SCALE);
      const thumbMobilePosition =
        row.thumb_mobile_position != null && row.thumb_mobile_position !== ''
          ? normalizeThumbPosition(row.thumb_mobile_position, thumbPosition)
          : thumbPosition;
      const thumbMobileScale =
        row.thumb_mobile_scale != null && row.thumb_mobile_scale !== ''
          ? normalizeThumbScale(row.thumb_mobile_scale, thumbScale)
          : thumbScale;
      return {
        id: row.slug,
        dbId: row.id,
        name: row.name,
        experience: normalizeExperienceStars(row.experience_stars),
        points: row.points_per_goal,
        meta: pointsMetaLabel(row.points_per_goal),
        thumb,
        thumbPosition,
        thumbScale,
        thumbMobilePosition,
        thumbMobileScale,
        faceTopPct: normalizeFacePct(row.face_top_pct, DEFAULT_FACE_TOP_PCT),
        faceLeftPct: normalizeFacePct(row.face_left_pct, DEFAULT_FACE_LEFT_PCT),
        faceSizePct: normalizeFacePct(
          row.face_size_pct,
          DEFAULT_FACE_SIZE_PCT,
          MIN_FACE_SIZE_PCT,
          MAX_FACE_SIZE_PCT
        ),
        faceCrop: normalizeImagePosition(row.face_crop, DEFAULT_FACE_CROP),
        faceCropScale: normalizeFaceCropScale(row.face_crop_scale, DEFAULT_FACE_CROP_SCALE),
        teamName: row.team_name || '',
        useFaceThumb: !hasCustomPoses && isCustomKeeperThumb(row.thumb_path),
        stand: row.image_stand || thumb,
        left: row.image_left || thumb,
        right: row.image_right || thumb,
        high: row.image_high || thumb,
      };
    });
}

function nextKeeperSortOrder() {
  const row = getDb().prepare('SELECT MAX(sort_order) AS m FROM penalty_keepers').get();
  return (row && row.m != null ? row.m : -1) + 1;
}

function createKeeper(data) {
  initPenaltyGame();
  const name = normalizeText(data.name);
  if (!name) {
    const err = new Error('Název brankáře je povinný.');
    err.code = 'VALIDATION';
    throw err;
  }
  const slug = uniqueSlugForKeeper(name, null);
  const experience = normalizeExperienceStars(data.experience_stars);
  const now = nowIso();
  const thumb = normalizePath(data.thumb_path) || DEFAULT_OPPONENT.stand;
  const r = getDb()
    .prepare(
      `INSERT INTO penalty_keepers (
        slug, name, experience_stars, points_per_goal, thumb_path, thumb_position, thumb_scale,
        thumb_mobile_position, thumb_mobile_scale,
        face_top_pct, face_left_pct, face_size_pct, face_crop, face_crop_scale,
        team_name, image_stand, image_left, image_right, image_high,
        is_active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      slug,
      name,
      experience,
      normalizePoints(data.points_per_goal),
      thumb,
      normalizeThumbPosition(data.thumb_position, DEFAULT_THUMB_POSITION),
      normalizeThumbScale(data.thumb_scale, DEFAULT_THUMB_SCALE),
      normalizeThumbPosition(
        data.thumb_mobile_position,
        normalizeThumbPosition(data.thumb_position, DEFAULT_THUMB_POSITION)
      ),
      normalizeThumbScale(
        data.thumb_mobile_scale,
        normalizeThumbScale(data.thumb_scale, DEFAULT_THUMB_SCALE)
      ),
      normalizeFacePct(data.face_top_pct, DEFAULT_FACE_TOP_PCT),
      normalizeFacePct(data.face_left_pct, DEFAULT_FACE_LEFT_PCT),
      normalizeFacePct(
        data.face_size_pct,
        DEFAULT_FACE_SIZE_PCT,
        MIN_FACE_SIZE_PCT,
        MAX_FACE_SIZE_PCT
      ),
      normalizeImagePosition(data.face_crop, DEFAULT_FACE_CROP),
      normalizeFaceCropScale(data.face_crop_scale, DEFAULT_FACE_CROP_SCALE),
      normalizeText(data.team_name),
      normalizePath(data.image_stand),
      normalizePath(data.image_left),
      normalizePath(data.image_right),
      normalizePath(data.image_high),
      data.is_active === false ? 0 : 1,
      nextKeeperSortOrder(),
      now,
      now
    );
  return r.lastInsertRowid;
}

function updateKeeper(id, data) {
  initPenaltyGame();
  const name = normalizeText(data.name);
  if (!name) {
    const err = new Error('Název brankáře je povinný.');
    err.code = 'VALIDATION';
    throw err;
  }
  const now = nowIso();
  const existing = getDb()
    .prepare(
      'SELECT slug, is_active, thumb_path, thumb_position, thumb_scale, thumb_mobile_position, thumb_mobile_scale, face_top_pct, face_left_pct, face_size_pct, face_crop, face_crop_scale, team_name FROM penalty_keepers WHERE id = ?'
    )
    .get(id);
  if (!existing) {
    const err = new Error('Brankář nebyl nalezen.');
    err.code = 'VALIDATION';
    throw err;
  }
  const slug = existing.slug;
  const experience = normalizeExperienceStars(data.experience_stars);
  const isActive =
    data.is_active === undefined ? (existing ? existing.is_active : 1) : data.is_active ? 1 : 0;
  const thumbPath =
    data.thumb_path !== undefined
      ? normalizePath(data.thumb_path) || DEFAULT_OPPONENT.stand
      : existing.thumb_path || DEFAULT_OPPONENT.stand;
  const teamName = data.team_name !== undefined ? normalizeText(data.team_name) : existing.team_name;
  const thumbPosition =
    data.thumb_position !== undefined
      ? normalizeThumbPosition(data.thumb_position, DEFAULT_THUMB_POSITION)
      : normalizeThumbPosition(existing.thumb_position, DEFAULT_THUMB_POSITION);
  const thumbScale =
    data.thumb_scale !== undefined
      ? normalizeThumbScale(data.thumb_scale, DEFAULT_THUMB_SCALE)
      : normalizeThumbScale(existing.thumb_scale, DEFAULT_THUMB_SCALE);
  const thumbMobilePosition =
    data.thumb_mobile_position !== undefined
      ? normalizeThumbPosition(data.thumb_mobile_position, thumbPosition)
      : existing.thumb_mobile_position != null && existing.thumb_mobile_position !== ''
        ? normalizeThumbPosition(existing.thumb_mobile_position, thumbPosition)
        : thumbPosition;
  const thumbMobileScale =
    data.thumb_mobile_scale !== undefined
      ? normalizeThumbScale(data.thumb_mobile_scale, thumbScale)
      : existing.thumb_mobile_scale != null && existing.thumb_mobile_scale !== ''
        ? normalizeThumbScale(existing.thumb_mobile_scale, thumbScale)
        : thumbScale;
  const faceTopPct =
    data.face_top_pct !== undefined
      ? normalizeFacePct(data.face_top_pct, DEFAULT_FACE_TOP_PCT)
      : normalizeFacePct(existing.face_top_pct, DEFAULT_FACE_TOP_PCT);
  const faceLeftPct =
    data.face_left_pct !== undefined
      ? normalizeFacePct(data.face_left_pct, DEFAULT_FACE_LEFT_PCT)
      : normalizeFacePct(existing.face_left_pct, DEFAULT_FACE_LEFT_PCT);
  const faceSizePct =
    data.face_size_pct !== undefined
      ? normalizeFacePct(data.face_size_pct, DEFAULT_FACE_SIZE_PCT, MIN_FACE_SIZE_PCT, MAX_FACE_SIZE_PCT)
      : normalizeFacePct(existing.face_size_pct, DEFAULT_FACE_SIZE_PCT, MIN_FACE_SIZE_PCT, MAX_FACE_SIZE_PCT);
  const faceCrop =
    data.face_crop !== undefined
      ? normalizeImagePosition(data.face_crop, DEFAULT_FACE_CROP)
      : normalizeImagePosition(existing.face_crop, DEFAULT_FACE_CROP);
  const faceCropScale =
    data.face_crop_scale !== undefined
      ? normalizeFaceCropScale(data.face_crop_scale, DEFAULT_FACE_CROP_SCALE)
      : normalizeFaceCropScale(existing.face_crop_scale, DEFAULT_FACE_CROP_SCALE);
  getDb()
    .prepare(
      `UPDATE penalty_keepers SET
        name = ?, experience_stars = ?, points_per_goal = ?, thumb_path = ?, thumb_position = ?, thumb_scale = ?,
        thumb_mobile_position = ?, thumb_mobile_scale = ?,
        face_top_pct = ?, face_left_pct = ?, face_size_pct = ?, face_crop = ?, face_crop_scale = ?,
        team_name = ?,
        image_stand = ?, image_left = ?, image_right = ?, image_high = ?,
        is_active = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      name,
      experience,
      normalizePoints(data.points_per_goal),
      thumbPath,
      thumbPosition,
      thumbScale,
      thumbMobilePosition,
      thumbMobileScale,
      faceTopPct,
      faceLeftPct,
      faceSizePct,
      faceCrop,
      faceCropScale,
      teamName,
      normalizePath(data.image_stand),
      normalizePath(data.image_left),
      normalizePath(data.image_right),
      normalizePath(data.image_high),
      isActive,
      now,
      id
    );
}

function moveKeeper(id, direction) {
  const items = listKeepersForAdmin();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const swap = idx + direction;
  if (swap < 0 || swap >= items.length) return;
  const now = nowIso();
  const a = items[idx];
  const b = items[swap];
  const stmt = getDb().prepare('UPDATE penalty_keepers SET sort_order = ?, updated_at = ? WHERE id = ?');
  stmt.run(b.sort_order, now, a.id);
  stmt.run(a.sort_order, now, b.id);
}

function removeKeeper(id) {
  getDb().prepare('DELETE FROM penalty_keepers WHERE id = ?').run(id);
}

function getPublicConfig() {
  initPenaltyGame();
  const settings = getSettings();
  const keepers = listActiveKeepersForWeb();
  if (!settings.is_active || !keepers.length) {
    return { active: false };
  }
  return {
    active: true,
    maxRounds: settings.max_rounds || 5,
    opponent: {
      stand: settings.opponent_stand || DEFAULT_OPPONENT.stand,
      left: settings.opponent_left || DEFAULT_OPPONENT.left,
      right: settings.opponent_right || DEFAULT_OPPONENT.right,
      high: settings.opponent_high || DEFAULT_OPPONENT.high,
    },
    texts: {
      menuTitle: settings.menu_title || DEFAULT_TEXTS.menu_title,
      menuDesc: settings.menu_desc || DEFAULT_TEXTS.menu_desc,
      pickTitle: settings.pick_title || DEFAULT_TEXTS.pick_title,
      pickDesc: settings.pick_desc || DEFAULT_TEXTS.pick_desc,
      pickButton: settings.pick_button || DEFAULT_TEXTS.pick_button,
      registerTitle: DEFAULT_TEXTS.register_title,
      registerDesc: DEFAULT_TEXTS.register_desc,
      registerNameLabel: DEFAULT_TEXTS.register_name_label,
      registerEmailLabel: DEFAULT_TEXTS.register_email_label,
      registerButton: DEFAULT_TEXTS.register_button,
      loginTab: DEFAULT_TEXTS.login_tab,
      registerTab: DEFAULT_TEXTS.register_tab,
      loginDesc: DEFAULT_TEXTS.login_desc,
      loginButton: DEFAULT_TEXTS.login_button,
    },
    keepers,
  };
}

module.exports = {
  DEFAULT_OPPONENT,
  DEFAULT_THUMB_POSITION,
  DEFAULT_THUMB_SCALE,
  DEFAULT_TEXTS,
  normalizeImagePosition,
  normalizeThumbPosition,
  normalizeThumbScale,
  pointsMetaLabel,
  initPenaltyGame,
  getSettings,
  updateSettings,
  getKeeperById,
  listKeepersForAdmin,
  listActiveKeepersForWeb,
  createKeeper,
  updateKeeper,
  moveKeeper,
  removeKeeper,
  getPublicConfig,
};

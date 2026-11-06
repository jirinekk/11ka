const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const { reservedOwnerEmails, serializeRoles } = require('../lib/roles');

// Vercel’s function filesystem is read-only except /tmp (and even /tmp is ephemeral).
const storageDir =
  process.env.STORAGE_DIR ||
  (process.env.VERCEL
    ? path.join(os.tmpdir(), '11ka-storage')
    : path.join(__dirname, '..', 'storage'));
const dbPath = path.join(storageDir, '11ka.sqlite');
const schemaPath = path.join(__dirname, 'schema.sql');

function ensureStorage() {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
}

let db;

function initDb() {
  ensureStorage();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Lightweight migrations (SQLite doesn't ALTER inside CREATE IF NOT EXISTS).
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN tag TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN body_blocks_json TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN hero_position TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN hero_card_position TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN hero_slider_mobile_position TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN hero_slider_desktop_position TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN lineup_json TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE articles ADD COLUMN sources TEXT;`);
  } catch {
    /* column already exists */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL,
      unsubscribed_at TEXT
    );
  `);

  try {
    db.exec(
      `ALTER TABLE newsletter_subscribers ADD COLUMN unsubscribed_at TEXT;`
    );
  } catch {
    /* column already exists */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_article ON comments (article_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accreditation_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      match_name TEXT NOT NULL,
      match_date TEXT,
      accreditation_type TEXT NOT NULL,
      email_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_accreditation_requests_created
      ON accreditation_requests (created_at DESC);
  `);

  try {
    db.exec(`ALTER TABLE accreditation_requests ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE accreditation_requests ADD COLUMN match_date TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(
      `ALTER TABLE accreditation_requests ADD COLUMN hidden_from_web INTEGER NOT NULL DEFAULT 0;`
    );
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE accreditation_requests ADD COLUMN album_id TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(
      `ALTER TABLE accreditation_requests ADD COLUMN applicant_email_sent INTEGER NOT NULL DEFAULT 0;`
    );
  } catch {
    /* column already exists */
  }
  try {
    db.exec(
      `ALTER TABLE accreditation_requests ADD COLUMN match_day_email_sent INTEGER NOT NULL DEFAULT 0;`
    );
  } catch {
    /* column already exists */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS reels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      headline TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'youtube',
      source_url TEXT,
      file_path TEXT,
      poster_image TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reels_active_sort ON reels (is_active, sort_order, id DESC);
  `);

  try {
    db.exec(`ALTER TABLE reels ADD COLUMN file_path TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE reels ADD COLUMN headline TEXT NOT NULL DEFAULT '';`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`UPDATE reels SET headline = title WHERE IFNULL(TRIM(headline), '') = '';`);
  } catch {
    /* ignore */
  }

  // Old schema had source_type CHECK limited to youtube.
  // Recreate table once to allow multiple source types.
  try {
    const reelsSqlRow = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reels'`)
      .get();
    const reelsSql = String(reelsSqlRow && reelsSqlRow.sql ? reelsSqlRow.sql : '');
    if (reelsSql.includes("source_type IN ('youtube')")) {
      db.exec(`
        BEGIN;
        ALTER TABLE reels RENAME TO reels_legacy;
        CREATE TABLE reels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          headline TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'youtube',
          source_url TEXT,
          file_path TEXT,
          poster_image TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO reels (id, headline, title, source_type, source_url, file_path, poster_image, is_active, sort_order, created_at, updated_at)
        SELECT id, title, title, source_type, source_url, NULL, poster_image, is_active, sort_order, created_at, updated_at
        FROM reels_legacy;
        DROP TABLE reels_legacy;
        CREATE INDEX IF NOT EXISTS idx_reels_active_sort ON reels (is_active, sort_order, id DESC);
        COMMIT;
      `);
    }
  } catch (e) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      /* ignore */
    }
    console.error('[11ka] reels table migration failed:', e && e.message);
  }

  try {
    db.exec(`ALTER TABLE users ADD COLUMN author_bio TEXT;`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN author_bio_pending TEXT;`);
  } catch {
    /* column already exists */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS kitswaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_path TEXT NOT NULL,
      article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
      label TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kitswaps_active_sort ON kitswaps (is_active, sort_order, id DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pomaha_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT,
      title TEXT NOT NULL,
      event_date TEXT,
      place TEXT,
      note TEXT,
      link_url TEXT,
      is_published INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pomaha_events_sort ON pomaha_events (sort_order, id DESC);
    CREATE INDEX IF NOT EXISTS idx_pomaha_events_published ON pomaha_events (is_published, sort_order, id DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS match_fixtures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition TEXT,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      kickoff_at TEXT,
      kickoff_label TEXT,
      venue TEXT,
      home_score INTEGER,
      away_score INTEGER,
      status TEXT NOT NULL DEFAULT 'Nadcházející',
      preview_url TEXT,
      note TEXT,
      lineup_json TEXT,
      events_json TEXT,
      live_started_at TEXT,
      first_half_extra_minutes INTEGER,
      first_half_extra_set INTEGER NOT NULL DEFAULT 0,
      second_half_extra_minutes INTEGER,
      second_half_extra_set INTEGER NOT NULL DEFAULT 0,
      is_published INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_match_fixtures_sort ON match_fixtures (sort_order, id DESC);
    CREATE INDEX IF NOT EXISTS idx_match_fixtures_published ON match_fixtures (is_published, sort_order, kickoff_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS match_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT,
      competition TEXT,
      logo_path TEXT,
      roster_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_match_teams_sort ON match_teams (sort_order, name, id);
  `);

  try {
    db.exec(`ALTER TABLE match_teams ADD COLUMN logo_path TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_teams ADD COLUMN roster_json TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN live_started_at TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN lineup_json TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN events_json TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN first_half_extra_minutes INTEGER;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN first_half_extra_set INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN second_half_extra_minutes INTEGER;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN second_half_extra_set INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE match_fixtures ADD COLUMN managed_by TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.prepare(
      `UPDATE match_fixtures
       SET live_started_at = updated_at
       WHERE status = 'Probíhá' AND live_started_at IS NULL`
    ).run();
  } catch {
    /* backfill best-effort */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS penalty_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      max_rounds INTEGER NOT NULL DEFAULT 5,
      menu_title TEXT NOT NULL,
      menu_desc TEXT NOT NULL,
      pick_title TEXT NOT NULL,
      pick_desc TEXT NOT NULL,
      pick_button TEXT NOT NULL,
      opponent_stand TEXT NOT NULL,
      opponent_left TEXT NOT NULL,
      opponent_right TEXT NOT NULL,
      opponent_high TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS penalty_keepers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      experience_stars INTEGER NOT NULL DEFAULT 1,
      points_per_goal INTEGER NOT NULL DEFAULT 1,
      thumb_path TEXT,
      thumb_position TEXT,
      thumb_scale REAL,
      thumb_mobile_position TEXT,
      thumb_mobile_scale REAL,
      team_name TEXT,
      image_stand TEXT,
      image_left TEXT,
      image_right TEXT,
      image_high TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_penalty_keepers_sort ON penalty_keepers (is_active, sort_order, id);
    CREATE TABLE IF NOT EXISTS penalty_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      article_slug TEXT,
      article_title TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_penalty_players_created ON penalty_players (created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS penalty_progress (
      player_id INTEGER NOT NULL,
      article_slug TEXT NOT NULL,
      article_title TEXT,
      goals INTEGER NOT NULL DEFAULT 0,
      round INTEGER NOT NULL DEFAULT 1,
      points_per_goal INTEGER NOT NULL DEFAULT 1,
      keeper_id INTEGER,
      started INTEGER NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (player_id, article_slug),
      FOREIGN KEY (player_id) REFERENCES penalty_players(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_penalty_progress_updated ON penalty_progress (updated_at DESC);
    CREATE TABLE IF NOT EXISTS penalty_leaderboard (
      player_id INTEGER NOT NULL,
      article_slug TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (player_id, article_slug),
      FOREIGN KEY (player_id) REFERENCES penalty_players(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_penalty_leaderboard_rank ON penalty_leaderboard (article_slug, points DESC, updated_at ASC);
  `);

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN experience_stars INTEGER NOT NULL DEFAULT 1;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN team_name TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN thumb_position TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN thumb_scale REAL;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN thumb_mobile_position TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN thumb_mobile_scale REAL;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN face_top_pct REAL;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN face_left_pct REAL;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN face_size_pct REAL;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN face_crop TEXT;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`ALTER TABLE penalty_keepers ADD COLUMN face_crop_scale REAL;`);
  } catch {
    /* column already exists */
  }

  try {
    db.exec(`UPDATE penalty_keepers SET experience_stars = 1 WHERE slug = 'novacek';`);
    db.exec(`UPDATE penalty_keepers SET experience_stars = 2 WHERE slug = 'profik';`);
    db.exec(`UPDATE penalty_keepers SET experience_stars = 3 WHERE slug = 'legenda';`);
  } catch {
    /* backfill best-effort */
  }

  try {
    require('../services/penalty-game').initPenaltyGame();
  } catch (e) {
    console.error('[11ka] penalty game seed failed:', e && e.message);
  }

  migrateUsersRoleCheck();
  migrateUsersRolesColumn();
  migrateUsersMajitelRole();
  initCommunityFeatures();
  seedStaffFromFile();
  try {
    require('../services/rubrics').ensureTables();
  } catch (e) {
    console.error('[11ka] rubrics tables failed:', e && e.message);
  }
  try {
    require('../services/foto').ensureTables();
  } catch (e) {
    console.error('[11ka] foto tables failed:', e && e.message);
  }
  ensureAdminFromEnv();
  grantMajitelToOwners();
  seedDefaultAdsIfEmpty();
  ensureExtraAdSlots();
  ensureAdCreativesTable();
  migrateLegacyCategories();
  migrateTypographyDashes();
  migrateMatchFixturesPublishAll();
  initAiArticleTables();
}

function migrateUsersRolesColumn() {
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all();
    const hasRoles = cols.some((c) => c.name === 'roles');
    if (!hasRoles) {
      db.exec(`ALTER TABLE users ADD COLUMN roles TEXT;`);
      console.log('[11ka] users.roles column added');
    }
    const rows = db.prepare(`SELECT id, role, roles FROM users`).all();
    const update = db.prepare(`UPDATE users SET roles = ? WHERE id = ?`);
    let filled = 0;
    for (const row of rows) {
      const raw = row.roles != null ? String(row.roles).trim() : '';
      if (raw) continue;
      if (!row.role) continue;
      update.run(JSON.stringify([row.role]), row.id);
      filled += 1;
    }
    if (filled > 0) {
      console.log(`[11ka] Backfilled roles for ${filled} user(s)`);
    }
    try {
      const usersService = require('../services/users');
      if (typeof usersService.resetRolesColumnCache === 'function') {
        usersService.resetRolesColumnCache();
      }
    } catch {
      /* users service may not be loaded yet */
    }
  } catch (e) {
    console.error('[11ka] users.roles migration failed:', e && e.message);
  }
}

function migrateUsersRoleCheck() {
  try {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
      .get();
    if (!row || !row.sql || row.sql.includes('spravce_akreditace')) return;

    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('vedeni', 'sefredaktor', 'redaktor', 'spravce_akreditace')),
        display_name TEXT,
        avatar_path TEXT,
        author_bio TEXT,
        author_bio_pending TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users_new (
        id, email, password_hash, role, display_name, avatar_path,
        author_bio, author_bio_pending, created_at, updated_at
      )
      SELECT
        id, email, password_hash, role, display_name, avatar_path,
        author_bio, author_bio_pending, created_at, updated_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('[11ka] users.role CHECK migrated (spravce_akreditace)');
  } catch (e) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      /* ignore */
    }
    try {
      db.pragma('foreign_keys = ON');
    } catch {
      /* ignore */
    }
    console.error('[11ka] users role migration failed:', e && e.message);
  }
}

function migrateMatchFixturesPublishAll() {
  try {
    const result = getDb()
      .prepare(`UPDATE match_fixtures SET is_published = 1 WHERE is_published = 0`)
      .run();
    if (result.changes > 0) {
      console.log(`[11ka] Published ${result.changes} match fixture(s) for web`);
    }
  } catch (e) {
    console.error('[11ka] match fixtures publish migration failed:', e && e.message);
  }
}

function migrateTypographyDashes() {
  try {
    const database = getDb();
    const tables = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all();
    let updatedCells = 0;
    for (const { name: table } of tables) {
      const cols = database
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .filter((c) => String(c.type).toUpperCase() === 'TEXT');
      for (const col of cols) {
        const colName = col.name;
        const sql = `UPDATE "${table}"
          SET "${colName}" = REPLACE(REPLACE("${colName}", char(8212), '-'), char(8211), '-')
          WHERE instr("${colName}", char(8212)) > 0 OR instr("${colName}", char(8211)) > 0`;
        const result = database.prepare(sql).run();
        updatedCells += result.changes;
      }
    }
    if (updatedCells > 0) {
      console.log(`[11ka] Replaced typography dashes in ${updatedCells} DB field(s)`);
    }
  } catch (e) {
    console.error('[11ka] typography dash migration failed:', e && e.message);
  }
}

function migrateLegacyCategories() {
  try {
    getDb().prepare(`UPDATE articles SET category = TRIM(category) WHERE category != TRIM(category)`).run();
    const result = getDb()
      .prepare(
        `UPDATE articles SET category = 'Ženský Fotbal'
         WHERE TRIM(category) IN (
           'Ženský fotbal',
           'Zensky Fotbal',
           'zensky fotbal'
         )`
      )
      .run();
    if (result.changes > 0) {
      console.log(`[11ka] Migrated ${result.changes} article(s) to Ženský Fotbal`);
    }
  } catch (e) {
    console.error('[11ka] legacy category migration failed:', e && e.message);
  }
}

function migrateUsersMajitelRole() {
  try {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
      .get();
    if (row && row.sql && row.sql.includes("'majitel'")) return;

    const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN;
      CREATE TABLE users_majitel (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('majitel', 'vedeni', 'sefredaktor', 'redaktor', 'spravce_akreditace')),
        roles TEXT,
        display_name TEXT,
        avatar_path TEXT,
        author_bio TEXT,
        author_bio_pending TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const dest = [
      'id',
      'email',
      'password_hash',
      'role',
      'roles',
      'display_name',
      'avatar_path',
      'author_bio',
      'author_bio_pending',
      'created_at',
      'updated_at',
    ].filter((c) => cols.includes(c));
    db.exec(
      `INSERT INTO users_majitel (${dest.join(', ')}) SELECT ${dest.join(', ')} FROM users;
       DROP TABLE users;
       ALTER TABLE users_majitel RENAME TO users;
       COMMIT;`
    );
    db.pragma('foreign_keys = ON');
    console.log('[11ka] users.role CHECK migrated (majitel)');
  } catch (e) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      /* ignore */
    }
    try {
      db.pragma('foreign_keys = ON');
    } catch {
      /* ignore */
    }
    console.error('[11ka] users majitel migration failed:', e && e.message);
  }
}

function tableHasColumn(table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c && c.name === column);
  } catch {
    return false;
  }
}

function addColumnIfMissing(table, column, ddl) {
  if (tableHasColumn(table, column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch {
    /* column already exists */
  }
}

function uniqueUserSlugValue(base, excludeId) {
  const { uniqueSlug } = require('../lib/slug');
  return uniqueSlug(base || 'uzivatel', (candidate) => {
    const row = db
      .prepare(`SELECT id FROM users WHERE slug = ? COLLATE NOCASE`)
      .get(candidate);
    if (!row) return false;
    if (excludeId != null && row.id === excludeId) return false;
    return true;
  });
}

function backfillUserSlugs() {
  if (!tableHasColumn('users', 'slug')) return;
  const rows = db
    .prepare(`SELECT id, display_name, email, slug FROM users`)
    .all();
  const update = db.prepare(`UPDATE users SET slug = ? WHERE id = ?`);
  for (const row of rows) {
    if (row.slug && String(row.slug).trim()) continue;
    const emailLocal = String(row.email || '').split('@')[0] || 'uzivatel';
    const base = row.display_name || emailLocal;
    update.run(uniqueUserSlugValue(base, row.id), row.id);
  }
}

function migrateUsersCtenarRole() {
  try {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
      .get();
    if (row && row.sql && row.sql.includes("'ctenar'")) return;

    const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN;
      CREATE TABLE users_ctenar (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('majitel', 'vedeni', 'sefredaktor', 'redaktor', 'spravce_akreditace', 'ctenar')),
        roles TEXT,
        display_name TEXT,
        avatar_path TEXT,
        author_bio TEXT,
        author_bio_pending TEXT,
        slug TEXT UNIQUE COLLATE NOCASE,
        public_bio TEXT,
        favorite_team_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const dest = [
      'id',
      'email',
      'password_hash',
      'role',
      'roles',
      'display_name',
      'avatar_path',
      'author_bio',
      'author_bio_pending',
      'slug',
      'public_bio',
      'favorite_team_code',
      'created_at',
      'updated_at',
    ].filter((c) => cols.includes(c));
    db.exec(
      `INSERT INTO users_ctenar (${dest.join(', ')}) SELECT ${dest.join(', ')} FROM users;
       DROP TABLE users;
       ALTER TABLE users_ctenar RENAME TO users;
       COMMIT;`
    );
    db.pragma('foreign_keys = ON');
    console.log('[11ka] users.role CHECK migrated (ctenar)');
  } catch (e) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      /* ignore */
    }
    try {
      db.pragma('foreign_keys = ON');
    } catch {
      /* ignore */
    }
    console.error('[11ka] users ctenar migration failed:', e && e.message);
  }
}

function migrateUsersFotografRole() {
  try {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
      .get();
    if (row && row.sql && row.sql.includes("'fotograf'")) return;

    const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN;
      CREATE TABLE users_fotograf (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('majitel', 'vedeni', 'sefredaktor', 'redaktor', 'fotograf', 'spravce_akreditace', 'ctenar')),
        roles TEXT,
        display_name TEXT,
        avatar_path TEXT,
        author_bio TEXT,
        author_bio_pending TEXT,
        slug TEXT UNIQUE COLLATE NOCASE,
        public_bio TEXT,
        favorite_team_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const dest = [
      'id',
      'email',
      'password_hash',
      'role',
      'roles',
      'display_name',
      'avatar_path',
      'author_bio',
      'author_bio_pending',
      'slug',
      'public_bio',
      'favorite_team_code',
      'created_at',
      'updated_at',
    ].filter((c) => cols.includes(c));
    db.exec(
      `INSERT INTO users_fotograf (${dest.join(', ')}) SELECT ${dest.join(', ')} FROM users;
       DROP TABLE users;
       ALTER TABLE users_fotograf RENAME TO users;
       COMMIT;`
    );
    db.pragma('foreign_keys = ON');
    console.log('[11ka] users.role CHECK migrated (fotograf)');
  } catch (e) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      /* ignore */
    }
    try {
      db.pragma('foreign_keys = ON');
    } catch {
      /* ignore */
    }
    console.error('[11ka] users fotograf migration failed:', e && e.message);
  }
}

function initCommunityFeatures() {
  addColumnIfMissing('users', 'slug', 'slug TEXT');
  addColumnIfMissing('users', 'public_bio', 'public_bio TEXT');
  addColumnIfMissing('users', 'favorite_team_code', 'favorite_team_code TEXT');
  migrateUsersCtenarRole();
  migrateUsersFotografRole();
  addColumnIfMissing('users', 'slug', 'slug TEXT');
  addColumnIfMissing('users', 'public_bio', 'public_bio TEXT');
  addColumnIfMissing('users', 'favorite_team_code', 'favorite_team_code TEXT');
  addColumnIfMissing('users', 'acc_prefill', 'acc_prefill TEXT');
  backfillUserSlugs();

  addColumnIfMissing('comments', 'user_id', 'user_id INTEGER');
  addColumnIfMissing('articles', 'rubric_slug', 'rubric_slug TEXT');
  addColumnIfMissing('articles', 'related_article_ids', 'related_article_ids TEXT');
  addColumnIfMissing('articles', 'match_key', 'match_key TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS article_ratings (
      article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      stars INTEGER NOT NULL CHECK (stars IN (1, 2, 3)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (article_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_article_ratings_article ON article_ratings (article_id);
    CREATE INDEX IF NOT EXISTS idx_article_ratings_user ON article_ratings (user_id);
    CREATE TABLE IF NOT EXISTS user_team_stars (
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      team_code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, team_code)
    );
    CREATE TABLE IF NOT EXISTS article_teams (
      article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
      team_code TEXT NOT NULL,
      PRIMARY KEY (article_id, team_code)
    );
  `);

  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug ON users (slug);`);
  } catch {
    /* ignore */
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_rubric ON articles (rubric_slug);`);
  } catch {
    /* ignore */
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_match_key ON articles (match_key);`);
  } catch {
    /* ignore */
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_user ON comments (user_id);`);
  } catch {
    /* ignore */
  }
}

function seedStaffFromFile() {
  try {
    const usersService = require('../services/users');
    if (typeof usersService.seedStaffUsers === 'function') {
      usersService.seedStaffUsers();
    }
  } catch (e) {
    console.error('[11ka] staff seed failed:', e && e.message);
  }
}

function grantMajitelToOwners() {
  try {
    const emails = reservedOwnerEmails();
    const users = db.prepare(`SELECT id, email, role, roles FROM users`).all();
    const update = db.prepare(`UPDATE users SET role = ?, roles = ? WHERE id = ?`);
    for (const user of users) {
      const email = String(user.email || '').trim().toLowerCase();
      if (!emails.includes(email)) continue;
      let roles = [];
      try {
        const parsed = JSON.parse(user.roles || '[]');
        if (Array.isArray(parsed)) roles = parsed;
      } catch {
        roles = user.role ? [user.role] : [];
      }
      if (!roles.includes('majitel')) roles.unshift('majitel');
      if (!roles.includes('vedeni')) roles.push('vedeni');
      const unique = [...new Set(roles)];
      update.run('majitel', JSON.stringify(unique), user.id);
    }
  } catch (e) {
    console.error('[11ka] grant majitel failed:', e && e.message);
  }
}

function initAiArticleTables() {
  try {
    const aiQueue = require('../services/ai-queue');
    aiQueue.ensureTables();
    aiQueue.syncDefaultSources();
  } catch (e) {
    console.error('[11ka] AI queue tables failed:', e && e.message);
  }
}

function getDb() {
  if (!db) initDb();
  return db;
}

function usersHasRolesColumn() {
  const cols = getDb().prepare(`PRAGMA table_info(users)`).all();
  return cols.some((c) => c && c.name === 'roles');
}

function insertMajitelUser(email, passwordHash, now) {
  const hasRoles = usersHasRolesColumn();
  if (hasRoles) {
    getDb()
      .prepare(
        `INSERT INTO users (email, password_hash, role, roles, display_name, created_at, updated_at)
         VALUES (?, ?, 'majitel', ?, ?, ?, ?)`
      )
      .run(email, passwordHash, serializeRoles(['majitel', 'vedeni']), 'Administrátor', now, now);
  } else {
    getDb()
      .prepare(
        `INSERT INTO users (email, password_hash, role, display_name, created_at, updated_at)
         VALUES (?, ?, 'majitel', ?, ?, ?)`
      )
      .run(email, passwordHash, 'Administrátor', now, now);
  }
}

function updateMajitelUser(id, passwordHash, now) {
  const hasRoles = usersHasRolesColumn();
  if (hasRoles) {
    getDb()
      .prepare(
        `UPDATE users SET password_hash = ?, role = 'majitel', roles = ?, updated_at = ? WHERE id = ?`
      )
      .run(passwordHash, serializeRoles(['majitel', 'vedeni']), now, id);
  } else {
    getDb()
      .prepare(`UPDATE users SET password_hash = ?, role = 'majitel', updated_at = ? WHERE id = ?`)
      .run(passwordHash, now, id);
  }
}

function findUserByEmail(email) {
  return getDb()
    .prepare(`SELECT id, email, password_hash, role, roles, display_name FROM users WHERE email = ? COLLATE NOCASE`)
    .get(email);
}

function ensureAdminFromEnv() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const hasEnv = Boolean(email && password);

  if (!hasEnv) {
    const staffCount = getDb().prepare('SELECT COUNT(*) AS c FROM users').get();
    if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && !(staffCount && staffCount.c)) {
      console.error(
        '[11ka] ADMIN_EMAIL / ADMIN_PASSWORD nejsou nastavené a seed redakce je prázdný. Nastavte je ve Vercel → Settings → Environment Variables, nebo doplňte data/seed-users.json.'
      );
    }
    return;
  }

  const existing = findUserByEmail(email);
  if (existing) {
    return;
  }

  const galbaAliases = ['admin@11ka.local', 'jgalba@11ka.cz'];
  if (galbaAliases.includes(email)) {
    const alias = galbaAliases.find((candidate) => candidate !== email && findUserByEmail(candidate));
    if (alias) return;
  }

  const now = new Date().toISOString();
  insertMajitelUser(email, bcrypt.hashSync(password, 12), now);
  console.warn('[11ka] Ensured Majitel user from ADMIN_EMAIL:', email);
}

function seedDefaultAdsIfEmpty() {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM ads').get();
  if (row.c > 0) return;

  const now = new Date().toISOString();
  const slots = [
    ['home_top_728', 'Horní banner (domů)', 1],
    ['home_sidebar_300', 'Postranní reklama (domů)', 1],
    ['article_sidebar_300', 'Postranní u článku (300×600)', 1],
  ];
  const stmt = getDb().prepare(
    `INSERT INTO ads (slot, label, content_html, active, updated_at) VALUES (?, ?, NULL, ?, ?)`
  );
  for (const [slot, label, active] of slots) {
    stmt.run(slot, label, active, now);
  }
}

function ensureExtraAdSlots() {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO ads (slot, label, content_html, active, updated_at) VALUES (?, ?, NULL, 0, ?)`
  );
  stmt.run('home_pomaha_11ka', '11ka Pomáhá - prostor mezi sekcemi', now);
}

function ensureAdCreativesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_creatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot TEXT NOT NULL,
      image_path TEXT NOT NULL,
      link_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_creatives_slot_active
      ON ad_creatives (slot, is_active, sort_order, id DESC);
  `);
}

module.exports = {
  initDb,
  getDb,
  storageDir,
};

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const storageDir = path.join(__dirname, '..', 'storage');
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
  seedAdminIfEmpty();
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

function grantMajitelToOwners() {
  try {
    const emails = ['admin@11ka.local', 'jgalba@11ka.cz', 'jbrabec@11ka.cz', process.env.ADMIN_EMAIL]
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean);
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

function seedAdminIfEmpty() {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c > 0) return;

  const email = process.env.ADMIN_EMAIL || 'admin@11ka.local';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  const hash = bcrypt.hashSync(password, 12);
  const now = new Date().toISOString();

  const cols = getDb().prepare(`PRAGMA table_info(users)`).all();
  const hasRoles = cols.some((c) => c && c.name === 'roles');
  if (hasRoles) {
    getDb()
      .prepare(
        `INSERT INTO users (email, password_hash, role, roles, display_name, created_at, updated_at)
         VALUES (?, ?, 'majitel', ?, ?, ?, ?)`
      )
      .run(email, hash, JSON.stringify(['majitel', 'vedeni']), 'Administrátor', now, now);
  } else {
    getDb()
      .prepare(
        `INSERT INTO users (email, password_hash, role, display_name, created_at, updated_at)
         VALUES (?, ?, 'majitel', ?, ?, ?)`
      )
      .run(email, hash, 'Administrátor', now, now);
  }

  console.warn('[11ka] Created default Majitel user:', email, '(set ADMIN_EMAIL / ADMIN_PASSWORD in .env)');
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

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  body_html TEXT NOT NULL DEFAULT '',
  body_blocks_json TEXT,
  hero_image_path TEXT,
  hero_position TEXT,
  hero_card_position TEXT,
  hero_slider_mobile_position TEXT,
  hero_slider_desktop_position TEXT,
  hero_credit TEXT,
  lineup_json TEXT,
  sources TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'scheduled', 'published')),
  scheduled_at TEXT,
  published_at TEXT,
  author_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  view_count INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  tag TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles (status);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles (author_id);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at);
CREATE INDEX IF NOT EXISTS idx_articles_view_count ON articles (view_count);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL,
  unsubscribed_at TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_article ON comments (article_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot TEXT NOT NULL UNIQUE,
  label TEXT,
  content_html TEXT,
  image_path TEXT,
  link_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

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
  managed_by TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_fixtures_sort ON match_fixtures (sort_order, id DESC);
CREATE INDEX IF NOT EXISTS idx_match_fixtures_published ON match_fixtures (is_published, sort_order, kickoff_at);

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

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { initDb, getDb } = require('../db');
const foto = require('../services/foto');

function ensureFallbackTeam(db, name, shortName, slug) {
  const existing = db.prepare('SELECT * FROM foto_teams WHERE slug = ?').get(slug);
  if (existing) return existing;
  const id = `c${crypto.randomBytes(12).toString('hex')}`;
  db.prepare(
    `INSERT INTO foto_teams (id, name, slug, short_name, city, color, logo, league)
     VALUES (?, ?, ?, ?, NULL, '#16dffb', NULL, '')`
  ).run(id, name, slug, shortName);
  return db.prepare('SELECT * FROM foto_teams WHERE id = ?').get(id);
}

const FALLBACK_PHOTOGRAPHER = 'cmunrfnbz0000mpe07mqks65b'; // Matěj Kubeš
const PREFIX_PHOTOGRAPHERS = {
  _MG_: 'cmup4hz1f0004mpozr4rg7etz', // Adina Králová
  DSCF: 'cmunwtr8e0003mpkjacj5s2b8', // Dominik Schweigl
  _A7: 'cmups9s4o0000js046x6xilet', // Oskar Charvat
  IMG_: 'cmujqmfyv0000jp04gafzp5eh', // Robin Veselý (numbered dumps also)
  DSC_: 'cmup4hz530005mpoz450hq31i', // Ester Spáčilová
};

const ALBUM_HINTS = {
  c2c991258777c55e158be3d27: {
    home: 'Sparta Praha',
    away: 'Bournemouth',
    date: '2026-11-05',
    competition: 'Evropská liga',
  },
  cfdaddde006b7227c73493071: {
    home: 'Sparta Praha',
    away: 'Bournemouth',
    date: '2026-11-05',
    competition: 'Evropská liga',
  },
  c7baed1022102a45d22b023ab: {
    home: 'Artis Brno',
    away: 'Bohemians',
    date: '2026-11-04',
    competition: 'Chance Liga',
  },
  cbeadf8968bc5acc86aa11138: {
    home: 'Mladá Boleslav',
    away: 'Hradec Králové',
    date: '2026-11-01',
    competition: 'Chance Liga',
  },
  ca561b491fc45d1f665449184: {
    home: 'Artis Brno',
    away: 'Zlín',
    date: '2026-10-31',
    competition: 'Chance Liga',
  },
  c3acc72b6ca972be8ce1d2ace: {
    home: 'Sigma Olomouc',
    away: 'Mladá Boleslav',
    date: '2026-10-29',
    competition: 'Chance Liga',
  },
  c7582ea9c80b97e9b6dfb2b02: {
    home: 'Sparta Praha',
    away: 'Neznámý soupeř',
    date: '2026-10-30',
    competition: 'Chance Liga',
  },
};

const NAME_ALIASES = {
  artis: 'Artis Brno',
  'artis brno': 'Artis Brno',
  bohemians: 'Bohemians',
  boleslav: 'Mladá Boleslav',
  'mlada boleslav': 'Mladá Boleslav',
  hradec: 'Hradec Králové',
  zlin: 'Zlín',
  'zli n': 'Zlín',
  sparta: 'Sparta Praha',
  acs: 'Sparta Praha',
  bournemouth: 'Bournemouth',
  sigma: 'Sigma Olomouc',
  sks: 'Sigma Olomouc',
  olomouc: 'Sigma Olomouc',
};

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function s3Client() {
  return new S3Client({
    region: process.env.STORAGE_S3_REGION || 'eu-central-1',
    endpoint: process.env.STORAGE_S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

function bucket() {
  return process.env.STORAGE_S3_BUCKET || 'fotky';
}

async function listPrefixes(client) {
  const prefixes = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: 'albums/',
        Delimiter: '/',
        ContinuationToken: token,
      })
    );
    for (const p of res.CommonPrefixes || []) {
      const id = String(p.Prefix || '')
        .replace(/^albums\//, '')
        .replace(/\/$/, '');
      if (id) prefixes.push(id);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return prefixes;
}

async function listAlbum(client, id) {
  const files = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: `albums/${id}/`,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents || []) {
      files.push({
        key: obj.Key,
        size: obj.Size || 0,
        last: obj.LastModified ? obj.LastModified.toISOString() : null,
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return files;
}

function origName(key) {
  const base = (key.split('/').pop() || '').replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{27}-/i, '');
  return base || (key.split('/').pop() || 'foto.jpg');
}

function isImageKey(key) {
  return /\.(jpe?g|png|webp|gif|heic)$/i.test(key);
}

function mimeOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function photoIdFromKey(key) {
  return `c${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

function findTeam(db, query) {
  const raw = String(query || '').trim();
  if (!raw) return null;
  const aliased = NAME_ALIASES[fold(raw)] || raw;
  const target = fold(aliased);
  if (!target) return null;
  const teams = db
    .prepare('SELECT * FROM foto_teams')
    .all()
    .filter((t) => !/\bu19\b|\bu21\b|žen|zeny/i.test(`${t.name} ${t.league}`));
  const scored = [];
  for (const team of teams) {
    const names = [team.name, team.short_name, team.slug.replace(/-/g, ' ')].map(fold);
    let score = 0;
    if (names.includes(target)) score = 100;
    else if (names.some((n) => n === target || n.endsWith(' ' + target) || n.startsWith(target + ' '))) score = 90;
    else if (names.some((n) => n.includes(target) || target.includes(n))) score = Math.min(nLength(target), 70);
    if (!score) continue;
    if (team.league === 'Chance Liga') score += 8;
    if (team.league === 'Evropská liga') score += 5;
    scored.push({ team, score });
  }
  scored.sort((a, b) => b.score - a.score || a.team.name.length - b.team.name.length);
  return scored[0] ? scored[0].team : null;
}

function nLength(value) {
  return Math.min(String(value).length, 70);
}

function parseNames(names) {
  const blob = names.join(' ');
  const dateA = blob.match(/(\d{1,2})[.](\d{1,2})[.]-?(\d{4})/);
  const dateB = blob.match(/(\d{4})[_-](\d{2})[_-](\d{2})/);
  let date = null;
  if (dateA) {
    date = `${dateA[3]}-${dateA[2].padStart(2, '0')}-${dateA[1].padStart(2, '0')}`;
  } else if (dateB) {
    date = `${dateB[1]}-${dateB[2]}-${dateB[3]}`;
  }

  const sample =
    names.find((n) => /artis|bohemian|boleslav|hradec|zli|sparta|sigma|bournemouth/i.test(n)) ||
    names.find((n) => /---/.test(n)) ||
    '';
  const cleaned = sample
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/-\d+$/, '')
    .replace(/[_]+/g, '-');
  const parts = cleaned
    .split(/\s*(?:---|–|—|\svs\.?\s|\s-\s)\s*/i)
    .map((p) =>
      p
        .replace(/[-_]+/g, ' ')
        .replace(/\d{1,2}\s+\d{1,2}\s+\d{4}/g, '')
        .replace(/\d{4}\s+\d{2}\s+\d{2}/g, '')
        .trim()
    )
    .filter((p) => p.length > 2 && !/^\d+$/.test(p));

  return { date, home: parts[0] || null, away: parts[1] || null };
}

function pragueDate(iso) {
  if (!iso) return new Date().toISOString().slice(0, 10);
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

function photographerFromNames(names, db) {
  const counts = {};
  for (const name of names) {
    let key = null;
    if (/^_MG_/i.test(name)) key = '_MG_';
    else if (/^DSCF/i.test(name)) key = 'DSCF';
    else if (/^_A7/i.test(name)) key = '_A7';
    else if (/^DSC_/i.test(name)) key = 'DSC_';
    else if (/^IMG_/i.test(name) || /^\d+\.jpe?g$/i.test(name)) key = 'IMG_';
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const id = best ? PREFIX_PHOTOGRAPHERS[best[0]] : FALLBACK_PHOTOGRAPHER;
  const row = db.prepare('SELECT id FROM foto_users WHERE id = ?').get(id);
  return row ? id : FALLBACK_PHOTOGRAPHER;
}

function pairThumbs(originals, thumbs) {
  const byName = new Map();
  for (const t of thumbs) byName.set(origName(t.key).toLowerCase(), t);
  return originals.map((orig, i) => {
    const name = origName(orig.key).toLowerCase();
    return byName.get(name) || thumbs[i] || null;
  });
}

async function main() {
  initDb();
  foto.ensureTables();
  const db = getDb();
  const client = s3Client();
  const prefixes = await listPrefixes(client);
  const have = new Set(db.prepare('SELECT id FROM foto_albums').all().map((r) => r.id));
  const missing = prefixes.filter((id) => !have.has(id));
  console.log(JSON.stringify({ s3: prefixes.length, local: have.size, missing: missing.length }));

  const insertAlbum = db.prepare(
    `INSERT OR IGNORE INTO foto_albums
      (id, title, match_date, competition, venue, notes, home_score, away_score, home_team_id, away_team_id, photographer_id, cover_photo_id, created_at, updated_at)
     VALUES (@id, @title, @match_date, @competition, @venue, @notes, @home_score, @away_score, @home_team_id, @away_team_id, @photographer_id, @cover_photo_id, @created_at, @updated_at)`
  );
  const insertPhoto = db.prepare(
    `INSERT OR IGNORE INTO foto_photos
      (id, album_id, original_name, mime_type, size, width, height, original_path, thumb_path, kind, sort_order, created_at)
     VALUES (@id, @album_id, @original_name, @mime_type, @size, @width, @height, @original_path, @thumb_path, 'ACTION', @sort_order, @created_at)`
  );
  const setCover = db.prepare('UPDATE foto_albums SET cover_photo_id = ? WHERE id = ? AND cover_photo_id IS NULL');

  const imported = [];
  for (const albumId of missing) {
    const files = await listAlbum(client, albumId);
    const originals = files
      .filter((f) => isImageKey(f.key) && !/\/thumbs?\//i.test(f.key))
      .sort((a, b) => origName(a.key).localeCompare(origName(b.key), 'cs') || String(a.last).localeCompare(String(b.last)));
    if (!originals.length) continue;
    const thumbs = files
      .filter((f) => isImageKey(f.key) && /\/thumbs?\//i.test(f.key))
      .sort((a, b) => origName(a.key).localeCompare(origName(b.key), 'cs') || String(a.last).localeCompare(String(b.last)));
    const paired = pairThumbs(originals, thumbs);
    const names = originals.map((f) => origName(f.key));
    const parsed = parseNames(names);
    const hint = ALBUM_HINTS[albumId] || {};
    const date = hint.date || parsed.date || pragueDate(originals[0].last);
    const home =
      findTeam(db, hint.home || parsed.home) || ensureFallbackTeam(db, 'Domácí', 'DOM', 'domaci-neznamy');
    const away =
      findTeam(db, hint.away || parsed.away) ||
      ensureFallbackTeam(
        db,
        hint.away === 'Neznámý soupeř' ? 'Neznámý soupeř' : 'Hosté',
        'HOS',
        hint.away === 'Neznámý soupeř' ? 'neznamy-souper' : 'hoste-neznamy'
      );
    if (!home || !away || home.id === away.id) {
      console.error('skip teams', albumId);
      continue;
    }
    const competition =
      hint.competition ||
      (home.league === 'Evropská liga' || away.league === 'Evropská liga' ? 'Evropská liga' : home.league || 'Chance Liga');
    const title =
      hint.home && hint.away
        ? `${findTeam(db, hint.home)?.short_name || home.short_name} vs ${findTeam(db, hint.away)?.short_name || away.short_name}`
        : parsed.home && parsed.away
          ? `${home.short_name} vs ${away.short_name}`
          : `${home.short_name} vs ${away.short_name}`;
    const photographerId = photographerFromNames(names, db);
    const now = originals[originals.length - 1].last || new Date().toISOString();
    const matchDate = `${date}T12:00:00.000Z`;
    const firstPhotoId = photoIdFromKey(originals[0].key);

    const run = db.transaction(() => {
      insertAlbum.run({
        id: albumId,
        title,
        match_date: matchDate,
        competition,
        venue: null,
        notes: 'Doplněno z úložiště fotek 11ka.cz',
        home_score: null,
        away_score: null,
        home_team_id: home.id,
        away_team_id: away.id,
        photographer_id: photographerId,
        cover_photo_id: firstPhotoId,
        created_at: originals[0].last || now,
        updated_at: now,
      });
      originals.forEach((file, i) => {
        const thumb = paired[i];
        insertPhoto.run({
          id: photoIdFromKey(file.key),
          album_id: albumId,
          original_name: origName(file.key),
          mime_type: mimeOf(origName(file.key)),
          size: file.size,
          width: 0,
          height: 0,
          original_path: `s3://${bucket()}/${file.key}`,
          thumb_path: `s3://${bucket()}/${(thumb && thumb.key) || file.key}`,
          sort_order: i,
          created_at: file.last || now,
        });
      });
      setCover.run(firstPhotoId, albumId);
    });
    run();
    imported.push({ id: albumId, title, date, photos: originals.length, competition });
    console.log(`${date} ${title}  (${originals.length} fotek)  ${albumId}`);
  }

  const local = {
    albums: db.prepare('SELECT COUNT(*) AS c FROM foto_albums').get().c,
    photos: db.prepare('SELECT COUNT(*) AS c FROM foto_photos').get().c,
    newest: db
      .prepare('SELECT title, match_date FROM foto_albums ORDER BY match_date DESC LIMIT 8')
      .all()
      .map((a) => `${String(a.match_date).slice(0, 10)} ${a.title}`),
  };
  console.log(JSON.stringify({ imported: imported.length, local }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { initDb, getDb } = require('../db');
const { slugify } = require('../lib/slug');
const foto = require('../services/foto');
const livesport = require('../services/livesport-chance');

const fotakRequire = createRequire('/Users/jirigalba/fotak_11ka/package.json');
const exifr = fotakRequire('exifr');

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
  jablonec: 'Jablonec',
  rangers: 'Rangers',
  slavia: 'Slavia Praha',
  plzen: 'Viktoria Plzeň',
  liberec: 'Slovan Liberec',
  banik: 'Baník Ostrava',
  ostrava: 'Baník Ostrava',
  teplice: 'Teplice',
  slovacko: 'Slovácko',
};

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function origName(keyOrName) {
  const base = String(keyOrName || '').split('/').pop() || '';
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || base;
}

function s3Key(value) {
  const raw = String(value || '');
  if (raw.startsWith('s3://')) {
    const without = raw.slice(5);
    const slash = without.indexOf('/');
    return slash === -1 ? without : without.slice(slash + 1);
  }
  return raw;
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

async function readExif(client, s3Path) {
  const key = s3Key(s3Path);
  const res = await client.send(
    new GetObjectCommand({
      Bucket: process.env.STORAGE_S3_BUCKET || 'fotky',
      Key: key,
      Range: 'bytes=0-393215',
    })
  );
  const buf = Buffer.from(await res.Body.transformToByteArray());
  const parsed = await exifr
    .parse(buf, {
      tiff: true,
      xmp: true,
      iptc: true,
      icc: false,
      jfif: false,
      mergeOutput: true,
      translateKeys: true,
      reviveValues: true,
    })
    .catch(() => null);
  if (!parsed) return { serial: '', artist: '', caption: '', date: null, make: '', model: '' };
  const artist = [parsed.Artist, parsed.Creator, parsed.Copyright, parsed['By-line'], parsed.Credit, parsed.creator]
    .map((v) => (Array.isArray(v) ? v.join(' ') : v))
    .map((v) => String(v || '').trim())
    .find((v) => v && !/^unknown$/i.test(v)) || '';
  const caption = [parsed.Caption, parsed.Headline, parsed.ObjectName, parsed.ImageDescription, parsed.description]
    .map((v) => String(v || '').trim())
    .find((v) => v.length > 3) || '';
  const serial = String(parsed.SerialNumber || parsed.BodySerialNumber || parsed.InternalSerialNumber || '').trim();
  const dt = parsed.DateTimeOriginal || parsed.CreateDate || parsed.DateCreated || null;
  return {
    serial,
    artist,
    caption,
    date: dt ? new Date(dt) : null,
    make: String(parsed.Make || ''),
    model: String(parsed.Model || ''),
  };
}

function findTeam(db, query) {
  const raw = String(query || '').trim();
  if (!raw) return null;
  const aliased = NAME_ALIASES[fold(raw)] || raw;
  const target = fold(aliased);
  if (!target || target.length < 3) return null;
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
    else if (names.some((n) => n.includes(target) || (target.length >= 5 && target.includes(n) && n.length >= 5))) score = 70;
    if (!score) continue;
    if (team.league === 'Chance Liga') score += 8;
    if (team.league === 'Evropská liga') score += 5;
    scored.push({ team, score });
  }
  scored.sort((a, b) => b.score - a.score || a.team.name.length - b.team.name.length);
  return scored[0] ? scored[0].team : null;
}

function parseVersus(text) {
  const src = String(text || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/-+/g, ' ');
  const dateA = String(text || '').match(/(\d{1,2})[.](\d{1,2})[.]-?(\d{4})/);
  const dateB = String(text || '').match(/(\d{4})[_-](\d{2})[_-](\d{2})/);
  let date = null;
  if (dateA) date = `${dateA[3]}-${dateA[2].padStart(2, '0')}-${dateA[1].padStart(2, '0')}`;
  else if (dateB) date = `${dateB[1]}-${dateB[2]}-${dateB[3]}`;
  const split = src.split(/\s*(?:---|–|—|\sx\s|\svs\.?\s|\s-\s)\s*/i).map((p) => p.replace(/\d{1,2}\s+\d{1,2}\s+\d{4}/g, '').replace(/\d{4}\s+\d{2}\s+\d{2}/g, '').trim()).filter((p) => p.length > 2 && !/^\d+$/.test(p));
  return { date, home: split[0] || null, away: split[1] || null };
}

function cleanArtistName(artist) {
  return String(artist || '')
    .replace(/@[\w.]+/g, ' ')
    .replace(/\b(photo|photography|foto|photographer|fotos)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchPhotographer(db, { artist, serial }, serialMap) {
  if (serial && serialMap.has(serial)) return serialMap.get(serial);
  const name = cleanArtistName(artist);
  if (!name) return null;
  const folded = fold(name);
  const users = db.prepare(`SELECT id, name FROM foto_users WHERE role IN ('PHOTOGRAPHER','ADMIN') AND status='APPROVED'`).all();
  let best = null;
  for (const user of users) {
    const un = fold(user.name);
    if (!un) continue;
    let score = 0;
    if (un === folded) score = 100;
    else if (folded.includes(un) || un.includes(folded)) score = 80;
    else {
      const [ufirst, ...urest] = un.split(' ');
      const ulast = urest[urest.length - 1];
      const [afirst, ...arest] = folded.split(' ');
      const alast = arest[arest.length - 1];
      if (ulast && alast && ulast === alast && ufirst[0] === afirst[0]) score = 70;
    }
    if (score && (!best || score > best.score)) best = { user, score };
  }
  return best && best.score >= 70 ? best.user : null;
}

function ensurePhotographer(db, artist) {
  const name = cleanArtistName(artist);
  if (name.length < 4) return null;
  const existing = matchPhotographer(db, { artist: name, serial: '' }, new Map());
  if (existing) return existing;
  const slug = slugify(name);
  const taken = db.prepare('SELECT id FROM foto_users WHERE slug = ?').get(slug);
  const id = `c${crypto.randomBytes(12).toString('hex')}`;
  const finalSlug = taken ? `${slug}-${id.slice(-4)}` : slug;
  db.prepare(
    `INSERT INTO foto_users (id, email, name, slug, avatar, role, status, created_at)
     VALUES (?, ?, ?, ?, NULL, 'PHOTOGRAPHER', 'APPROVED', ?)`
  ).run(id, `${finalSlug}@foto.11ka.local`, name, finalSlug, new Date().toISOString());
  return db.prepare('SELECT id, name FROM foto_users WHERE id = ?').get(id);
}

function pickDate(filenameDate, exifDate, uploadIso) {
  if (filenameDate) return filenameDate;
  const uploadDay = foto.pragueDayKey ? foto.pragueDayKey(uploadIso) : String(uploadIso).slice(0, 10);
  if (exifDate && !Number.isNaN(exifDate.getTime()) && exifDate.getUTCFullYear() >= 2025) {
    const exifDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(exifDate);
    if (uploadDay) {
      const diff = Math.abs(Date.parse(exifDay) - Date.parse(uploadDay));
      if (diff <= 21 * 24 * 3600 * 1000) return exifDay;
    } else {
      return exifDay;
    }
    return exifDay;
  }
  return uploadDay;
}

function prefixPhotographer(names, prefixMap) {
  const counts = {};
  for (const name of names) {
    const n = origName(name);
    let key = null;
    if (/^_MG_/i.test(n)) key = '_MG_';
    else if (/^DSCF/i.test(n)) key = 'DSCF';
    else if (/^_A7/i.test(n)) key = '_A7';
    else if (/^DSC_/i.test(n)) key = 'DSC_';
    else if (/^_DSC/i.test(n)) key = '_DSC';
    else if (/^8F3A/i.test(n)) key = '8F3A';
    else if (/^_R3/i.test(n)) key = '_R3';
    else if (/^IMG_/i.test(n) || /^\d+\.jpe?g$/i.test(n)) key = 'IMG_';
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  return prefixMap.get(best[0]) || null;
}

async function loadMatches() {
  try {
    const rows = await livesport.listResults(100);
    return (rows || []).map((m) => ({
      date: livesport.pragueDayKey(m.date || m.kickoff),
      home: m.home,
      away: m.away,
      competition: m.league || m.competition || 'Chance Liga',
      homeScore: m.homeScore,
      awayScore: m.awayScore,
    }));
  } catch (err) {
    console.error('livesport', err && err.message);
    return [];
  }
}

async function main() {
  initDb();
  foto.ensureTables();
  const db = getDb();
  const client = s3Client();

  const seedPhotos = db
    .prepare(
      `SELECT u.id AS photographer_id, u.name, p.original_path
       FROM foto_photos p
       JOIN foto_albums a ON a.id = p.album_id
       JOIN foto_users u ON u.id = a.photographer_id
       WHERE IFNULL(a.notes,'') NOT LIKE 'Doplněno%'
       GROUP BY u.id`
    )
    .all();
  const serialMap = new Map();
  const prefixMap = new Map();
  for (const row of seedPhotos) {
    const ex = await readExif(client, row.original_path).catch(() => null);
    if (ex && ex.serial) serialMap.set(ex.serial, { id: row.photographer_id, name: row.name });
    const name = origName(row.original_path);
    let key = null;
    if (/^_MG_/i.test(name)) key = '_MG_';
    else if (/^DSCF/i.test(name)) key = 'DSCF';
    else if (/^_A7/i.test(name)) key = '_A7';
    else if (/^DSC_/i.test(name)) key = 'DSC_';
    else if (/^IMG_/i.test(name) || /^\d+\.jpe?g$/i.test(name)) key = 'IMG_';
    if (key && !prefixMap.has(key)) prefixMap.set(key, { id: row.photographer_id, name: row.name });
  }

  const imported = db
    .prepare(
      `SELECT a.id, a.title, a.match_date, a.home_team_id, a.away_team_id, a.photographer_id, a.created_at
       FROM foto_albums a
       WHERE IFNULL(a.notes,'') LIKE 'Doplněno%'`
    )
    .all();

  const albumExif = [];
  for (const album of imported) {
    const photos = db
      .prepare(
        `SELECT id, original_path, original_name FROM foto_photos WHERE album_id = ? ORDER BY sort_order, created_at LIMIT 3`
      )
      .all(album.id);
    const names = db
      .prepare(`SELECT original_name, original_path FROM foto_photos WHERE album_id = ?`)
      .all(album.id)
      .map((p) => origName(p.original_name || p.original_path));
    let ex = { serial: '', artist: '', caption: '', date: null };
    for (const photo of photos) {
      const hit = await readExif(client, photo.original_path).catch(() => null);
      if (!hit) continue;
      if (hit.artist || hit.serial || hit.caption || (hit.date && hit.date.getUTCFullYear() >= 2025)) {
        ex = hit;
        if (hit.artist || hit.caption) break;
      }
    }
    albumExif.push({ album, names, ex, upload: photos[0] ? null : album.created_at, firstPath: photos[0] && photos[0].original_path });
  }

  for (const row of albumExif) {
    if (row.ex.serial && row.ex.artist) {
      const user = matchPhotographer(db, row.ex, serialMap) || ensurePhotographer(db, row.ex.artist);
      if (user && row.ex.serial) serialMap.set(row.ex.serial, user);
    }
  }

  const matches = await loadMatches();
  const byDay = new Map();
  for (const m of matches) {
    if (!m.date) continue;
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(m);
  }

  const updAlbum = db.prepare(
    `UPDATE foto_albums
     SET title = ?, match_date = ?, competition = ?, home_team_id = ?, away_team_id = ?,
         photographer_id = ?, home_score = ?, away_score = ?, updated_at = ?
     WHERE id = ?`
  );
  const updName = db.prepare('UPDATE foto_photos SET original_name = ? WHERE id = ?');

  const report = [];
  const now = new Date().toISOString();
  for (const row of albumExif) {
    const { album, names, ex } = row;
    const blob = names.join(' | ') + ' ' + (ex.caption || '');
    const parsed = parseVersus(ex.caption || '') ;
    const parsedFn = parseVersus(names.find((n) => /artis|bohemian|boleslav|hradec|zlin|sparta|sigma|---|vs/i.test(n)) || names[0] || '');
    const date = pickDate(parsed.date || parsedFn.date, ex.date, album.created_at || album.match_date);
    let photog = matchPhotographer(db, ex, serialMap);
    if (!photog && ex.artist) photog = ensurePhotographer(db, ex.artist);
    if (!photog) photog = prefixPhotographer(names, prefixMap);
    if (!photog && ex.serial && serialMap.has(ex.serial)) photog = serialMap.get(ex.serial);

    let home = findTeam(db, parsed.home || parsedFn.home);
    let away = findTeam(db, parsed.away || parsedFn.away);
    const dayMatches = byDay.get(date) || [];
    if ((!home || !away) && dayMatches.length) {
      const hinted = dayMatches.filter((m) => {
        const blobFold = fold(blob);
        return blobFold.includes(fold(m.home).slice(0, 6)) || blobFold.includes(fold(m.away).slice(0, 6));
      });
      const pick = hinted[0] || (dayMatches.length === 1 ? dayMatches[0] : null);
      if (pick) {
        home = home || findTeam(db, pick.home);
        away = away || findTeam(db, pick.away);
      }
    }
    const currentHome = db.prepare('SELECT * FROM foto_teams WHERE id = ?').get(album.home_team_id);
    const currentAway = db.prepare('SELECT * FROM foto_teams WHERE id = ?').get(album.away_team_id);
    const homeIsFake = !currentHome || /domaci|neznamy/i.test(currentHome.slug);
    const awayIsFake = !currentAway || /hoste|neznamy/i.test(currentAway.slug);
    if (!home && !homeIsFake) home = currentHome;
    if (!away && !awayIsFake) away = currentAway;
    if (!home) home = currentHome;
    if (!away) away = currentAway;

    const competition =
      home && away && (home.league === 'Evropská liga' || away.league === 'Evropská liga')
        ? 'Evropská liga'
        : home && home.league && !/domaci/i.test(home.slug)
          ? home.league
          : 'Chance Liga';
    const realTeams = home && away && !/domaci|hoste|neznamy/i.test(`${home.slug} ${away.slug}`);
    const title = realTeams ? `${home.short_name} vs ${away.short_name}` : `Fotky ${date.slice(8, 10).replace(/^0/, '')}. ${date.slice(5, 7).replace(/^0/, '')}. ${date.slice(0, 4)}`;
    const matchDate = `${date}T12:00:00.000Z`;
    const photographerId = photog ? photog.id : album.photographer_id;
    const dayHit = realTeams
      ? dayMatches.find(
          (m) =>
            (fold(m.home).includes(fold(home.name).slice(0, 6)) || fold(home.name).includes(fold(m.home).slice(0, 6))) &&
            (fold(m.away).includes(fold(away.name).slice(0, 6)) || fold(away.name).includes(fold(m.away).slice(0, 6)))
        )
      : null;

    updAlbum.run(
      title,
      matchDate,
      competition,
      home.id,
      away.id,
      photographerId,
      dayHit && dayHit.homeScore != null ? dayHit.homeScore : null,
      dayHit && dayHit.awayScore != null ? dayHit.awayScore : null,
      now,
      album.id
    );

    const photos = db.prepare('SELECT id, original_name, original_path FROM foto_photos WHERE album_id = ?').all(album.id);
    for (const photo of photos) {
      const cleaned = origName(photo.original_name || photo.original_path);
      if (cleaned && cleaned !== photo.original_name) updName.run(cleaned, photo.id);
    }

    report.push({
      id: album.id,
      title,
      date,
      photog: photog ? photog.name : '—',
      artist: ex.artist || '',
      home: home.name,
      away: away.name,
    });
    console.log(`${date}  ${title.padEnd(22)}  ${(photog && photog.name) || 'neznámý'}  [${ex.artist || ex.serial || ''}]`);
  }

  console.log(JSON.stringify({ updated: report.length, photographers: [...new Set(report.map((r) => r.photog))] }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

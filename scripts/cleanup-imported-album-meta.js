'use strict';

const path = require('path');
const { createRequire } = require('module');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { initDb, getDb } = require('../db');
const fotakRequire = createRequire('/Users/jirigalba/fotak_11ka/package.json');
const exifr = fotakRequire('exifr');

function s3() {
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
function s3Key(value) {
  const raw = String(value || '');
  if (!raw.startsWith('s3://')) return raw;
  const without = raw.slice(5);
  const slash = without.indexOf('/');
  return slash === -1 ? without : without.slice(slash + 1);
}
function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
function origName(value) {
  const base = String(value || '').split('/').pop() || '';
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || base;
}
function pragueDay(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
function datedTitle(day) {
  const [y, m, d] = day.split('-');
  return `Fotky ${Number(d)}. ${Number(m)}. ${y}`;
}

async function readExif(client, s3Path) {
  const res = await client.send(
    new GetObjectCommand({
      Bucket: process.env.STORAGE_S3_BUCKET || 'fotky',
      Key: s3Key(s3Path),
      Range: 'bytes=0-393215',
    })
  );
  const buf = Buffer.from(await res.Body.transformToByteArray());
  const parsed = await exifr.parse(buf, { tiff: true, xmp: true, iptc: true, mergeOutput: true }).catch(() => null);
  if (!parsed) return { artist: '', serial: '', date: null };
  const artist = [parsed.Artist, parsed.Creator, parsed.Copyright, parsed['By-line']]
    .map((v) => (Array.isArray(v) ? v.join(' ') : String(v || '')))
    .map((v) => v.replace(/©/g, '').trim())
    .find((v) => v && !/^unknown$/i.test(v)) || '';
  return {
    artist,
    serial: String(parsed.SerialNumber || '').trim(),
    date: parsed.DateTimeOriginal ? new Date(parsed.DateTimeOriginal) : null,
  };
}

function prettyName(name) {
  const map = {
    'lukas ponechal': 'Lukáš Ponechal',
    'milos backovsky': 'Miloš Bačkovský',
    janpolacek: 'Jan Poláček',
    'jan polacek': 'Jan Poláček',
    'jonas michale': 'Jonáš Michale',
    'ondrej kalous': 'Ondřej Kalous',
    'martin kuchar': 'Martin Kuchař',
    'krajic photos': 'Krajíč Photos',
  };
  const f = String(name || '')
    .replace(/©/g, '')
    .replace(/[._]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return map[fold(f)] || f.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

async function main() {
  initDb();
  const db = getDb();
  const client = s3();

  const realPolacek = db.prepare(`SELECT id FROM foto_users WHERE slug = 'jan-polacek'`).get();
  const dummies = db
    .prepare(
      `SELECT id FROM foto_users WHERE slug IN ('janpolacek','jan-polacek-2') OR name LIKE '©%'`
    )
    .all();
  if (realPolacek) {
    for (const dummy of dummies) {
      db.prepare('UPDATE foto_albums SET photographer_id = ? WHERE photographer_id = ?').run(realPolacek.id, dummy.id);
      db.prepare('DELETE FROM foto_users WHERE id = ?').run(dummy.id);
    }
  }

  const created = db.prepare(`SELECT id, name FROM foto_users WHERE email LIKE '%@foto.11ka.local'`).all();
  for (const user of created) {
    db.prepare('UPDATE foto_users SET name = ? WHERE id = ?').run(prettyName(user.name), user.id);
  }

  const artis = db.prepare(`SELECT * FROM foto_teams WHERE slug = 'artis-brno'`).get();
  const bohemians = db.prepare(`SELECT * FROM foto_teams WHERE slug = 'bohemians-1905'`).get();
  if (artis && bohemians) {
    db.prepare(
      `UPDATE foto_albums SET title = 'ART vs BOH', home_team_id = ?, away_team_id = ?, competition = 'Chance Liga'
       WHERE notes LIKE 'Doplněno%' AND title = 'BOH vs BOH'`
    ).run(artis.id, bohemians.id);
  }

  const imported = db
    .prepare(
      `SELECT a.id, a.title, a.match_date, a.created_at, a.photographer_id, u.name AS photog
       FROM foto_albums a JOIN foto_users u ON u.id = a.photographer_id
       WHERE IFNULL(a.notes,'') LIKE 'Doplněno%'`
    )
    .all();

  const serialToUser = new Map();
  for (const album of imported) {
    const photo = db.prepare(`SELECT original_path FROM foto_photos WHERE album_id = ? LIMIT 1`).get(album.id);
    if (!photo) continue;
    const ex = await readExif(client, photo.original_path).catch(() => null);
    if (ex && ex.serial && !/Kubeš/i.test(album.photog)) {
      serialToUser.set(ex.serial, album.photographer_id);
    }
  }

  for (const album of imported) {
    const photos = db
      .prepare(`SELECT id, original_path, created_at FROM foto_photos WHERE album_id = ? ORDER BY created_at`)
      .all(album.id);
    const uploadDay = pragueDay(photos[0] && photos[0].created_at ? photos[0].created_at : album.created_at);
    const matchDay = String(album.match_date).slice(0, 10);
    const drift = Math.abs(Date.parse(matchDay) - Date.parse(uploadDay));
    if (drift > 21 * 24 * 3600 * 1000 || Number(matchDay.slice(0, 4)) < 2026) {
      const title = /^[A-Z]{2,3} vs [A-Z]{2,3}$/.test(album.title) ? album.title : datedTitle(uploadDay);
      db.prepare(`UPDATE foto_albums SET match_date = ?, title = ? WHERE id = ?`).run(`${uploadDay}T12:00:00.000Z`, title, album.id);
      console.log('date', album.id, matchDay, '->', uploadDay);
    }

    if (!/Kubeš/i.test(album.photog)) continue;
    let found = null;
    for (const photo of photos.slice(0, 6)) {
      const ex = await readExif(client, photo.original_path).catch(() => null);
      if (!ex) continue;
      if (ex.serial && serialToUser.has(ex.serial)) {
        found = serialToUser.get(ex.serial);
        break;
      }
      if (ex.artist) {
        const f = fold(ex.artist);
        const users = db.prepare(`SELECT id, name FROM foto_users WHERE role IN ('PHOTOGRAPHER','ADMIN')`).all();
        const hit = users.find((u) => {
          const un = fold(u.name);
          return un && (f.includes(un) || un.includes(f) || f.includes(un.replace(/\s/g, '')));
        });
        if (hit) {
          found = hit.id;
          if (ex.serial) serialToUser.set(ex.serial, hit.id);
          break;
        }
      }
    }
    if (found) {
      db.prepare('UPDATE foto_albums SET photographer_id = ? WHERE id = ?').run(found, album.id);
      const name = db.prepare('SELECT name FROM foto_users WHERE id = ?').get(found).name;
      console.log('photog', album.id, 'Matej ->', name);
    }
  }

  const out = db
    .prepare(
      `SELECT a.title, substr(a.match_date,1,10) d, u.name photog, ht.short_name home, at.short_name away
       FROM foto_albums a
       JOIN foto_users u ON u.id = a.photographer_id
       JOIN foto_teams ht ON ht.id = a.home_team_id
       JOIN foto_teams at ON at.id = a.away_team_id
       WHERE IFNULL(a.notes,'') LIKE 'Doplněno%'
       ORDER BY a.match_date DESC`
    )
    .all();
  const byP = {};
  for (const r of out) byP[r.photog] = (byP[r.photog] || 0) + 1;
  console.log(JSON.stringify({ byP, newest: out.slice(0, 15) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

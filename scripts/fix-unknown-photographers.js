#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const path = require('path');
const { createRequire } = require('module');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { initDb, getDb } = require('../db');
const { slugify } = require('../lib/slug');

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
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function origName(value) {
  const base = String(value || '').split('/').pop() || '';
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || base;
}

function filePrefix(name) {
  const n = origName(name);
  if (/^_DSC/i.test(n)) return '_DSC';
  if (/^DSC_/i.test(n)) return 'DSC_';
  if (/^DSC[0-9]/i.test(n)) return 'DSC0';
  if (/^_MG_/i.test(n)) return '_MG_';
  if (/^8F3A/i.test(n)) return '8F3A';
  if (/^2X0A/i.test(n)) return '2X0A';
  if (/^HC1A/i.test(n)) return 'HC1A';
  if (/^_A7/i.test(n)) return '_A7';
  if (/^DSCF/i.test(n)) return 'DSCF';
  if (/^IMG_/i.test(n)) return 'IMG_';
  if (/^_R3/i.test(n)) return '_R3';
  return n.slice(0, 4).toUpperCase();
}

function cleanArtistName(artist) {
  return String(artist || '')
    .replace(/©/g, ' ')
    .replace(/@[\w.]+/g, ' ')
    .replace(/\b(photo|photography|foto|photographer|fotos|images)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readExif(client, s3Path) {
  const res = await client.send(
    new GetObjectCommand({
      Bucket: process.env.STORAGE_S3_BUCKET || 'fotky',
      Key: s3Key(s3Path),
      Range: 'bytes=0-524287',
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
  if (!parsed) {
    return { serial: '', artist: '', caption: '', make: '', model: '', lens: '', owner: '', keys: [] };
  }
  const pick = (...keys) => {
    for (const key of keys) {
      const val = parsed[key];
      const text = Array.isArray(val) ? val.join(' ') : String(val || '').trim();
      if (text && !/^unknown$/i.test(text)) return text;
    }
    return '';
  };
  return {
    serial: pick('SerialNumber', 'BodySerialNumber', 'InternalSerialNumber', 'CameraSerialNumber'),
    artist: pick('Artist', 'Creator', 'creator', 'Copyright', 'CopyrightNotice', 'By-line', 'Credit', 'Writer-Editor'),
    caption: pick('Caption', 'Headline', 'ObjectName', 'ImageDescription', 'description'),
    make: pick('Make'),
    model: pick('Model'),
    lens: pick('LensModel', 'Lens', 'LensInfo'),
    owner: pick('OwnerName', 'CameraOwnerName', 'Owner'),
    keys: Object.keys(parsed).filter((k) => {
      const v = parsed[k];
      return v != null && String(v).length > 0 && String(v).length < 180;
    }),
    raw: parsed,
  };
}

function matchPhotographer(db, name) {
  const folded = fold(cleanArtistName(name));
  if (!folded || folded.length < 4) return null;
  const users = db
    .prepare(`SELECT id, name, slug FROM foto_users WHERE role IN ('PHOTOGRAPHER','ADMIN') AND status IN ('APPROVED','PENDING')`)
    .all();
  let best = null;
  for (const user of users) {
    if (user.slug === 'neznamy-fotograf') continue;
    const un = fold(user.name);
    if (!un) continue;
    let score = 0;
    if (un === folded) score = 100;
    else if (folded.includes(un) || un.includes(folded)) score = 80;
    else {
      const uParts = un.split(' ');
      const aParts = folded.split(' ');
      const ulast = uParts[uParts.length - 1];
      const alast = aParts[aParts.length - 1];
      if (ulast && alast && ulast === alast && uParts[0][0] === aParts[0][0]) score = 70;
    }
    if (score && (!best || score > best.score)) best = { user, score };
  }
  return best && best.score >= 70 ? best.user : null;
}

function ensurePhotographer(db, artist) {
  const name = cleanArtistName(artist);
  if (name.length < 4) return null;
  const existing = matchPhotographer(db, name);
  if (existing) return existing;
  const slug = slugify(name);
  const taken = db.prepare('SELECT id FROM foto_users WHERE slug = ?').get(slug);
  const id = `c${crypto.randomBytes(12).toString('hex')}`;
  const finalSlug = taken ? `${slug}-${id.slice(-4)}` : slug;
  db.prepare(
    `INSERT INTO foto_users (id, email, name, slug, avatar, role, status, created_at)
     VALUES (?, ?, ?, ?, NULL, 'PHOTOGRAPHER', 'APPROVED', ?)`
  ).run(id, `${finalSlug}@foto.11ka.local`, name, finalSlug, new Date().toISOString());
  return db.prepare('SELECT id, name, slug FROM foto_users WHERE id = ?').get(id);
}

function pickSamplePhotos(db, albumId) {
  const all = db
    .prepare(`SELECT id, original_path, original_name FROM foto_photos WHERE album_id = ? ORDER BY sort_order, created_at`)
    .all(albumId);
  if (!all.length) return [];
  const idxs = new Set([0, Math.floor(all.length / 2), all.length - 1, Math.min(4, all.length - 1)]);
  return [...idxs].filter((i) => i >= 0).map((i) => all[i]);
}

async function fingerprintAlbum(client, db, albumId) {
  const photos = pickSamplePhotos(db, albumId);
  const names = db
    .prepare(`SELECT original_name, original_path FROM foto_photos WHERE album_id = ?`)
    .all(albumId)
    .map((p) => origName(p.original_name || p.original_path));
  const prefixCounts = {};
  for (const name of names) {
    const key = filePrefix(name);
    prefixCounts[key] = (prefixCounts[key] || 0) + 1;
  }
  const hits = [];
  for (const photo of photos) {
    try {
      const ex = await readExif(client, photo.original_path);
      if (ex) hits.push({ ...ex, file: origName(photo.original_name || photo.original_path) });
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (/SlowDown|currently blocked/i.test(msg)) throw err;
    }
  }
  return { hits, prefixCounts, names };
}

function nameFromExif(ex) {
  return cleanArtistName(ex.artist || ex.owner || '');
}

async function main() {
  initDb();
  const db = getDb();
  const client = s3();
  const now = new Date().toISOString();

  const serialMap = new Map();
  const cameraMap = new Map();
  const prefixMap = new Map();

  const known = db
    .prepare(
      `SELECT u.id AS photographer_id, u.name, u.slug,
              (SELECT p.original_path FROM foto_photos p JOIN foto_albums a ON a.id = p.album_id
               WHERE a.photographer_id = u.id ORDER BY p.sort_order LIMIT 1) AS original_path,
              (SELECT p.original_name FROM foto_photos p JOIN foto_albums a ON a.id = p.album_id
               WHERE a.photographer_id = u.id ORDER BY p.sort_order LIMIT 1) AS original_name
       FROM foto_users u
       WHERE u.slug != 'neznamy-fotograf'
         AND EXISTS (SELECT 1 FROM foto_albums a WHERE a.photographer_id = u.id)`
    )
    .all();

  for (const row of known) {
    if (!row.original_path) continue;
    let ex;
    try {
      ex = await readExif(client, row.original_path);
    } catch (err) {
      const msg = String(err && err.message || '');
      if (/SlowDown|currently blocked/i.test(msg)) {
        console.error('S3 SlowDown — zastavuji, zkus později.');
        process.exit(2);
      }
      continue;
    }
    const photog = { id: row.photographer_id, name: row.name, slug: row.slug };
    if (ex && ex.serial) serialMap.set(ex.serial, photog);
    if (ex && ex.make && ex.model) {
      const cam = `${fold(ex.make)}|${fold(ex.model)}|${ex.serial || ''}`;
      if (!cameraMap.has(cam)) cameraMap.set(cam, photog);
    }
    const pref = filePrefix(row.original_name || row.original_path);
    if (pref && !['DSC0', 'DSC_', 'IMG_', '_DSC'].includes(pref) && !prefixMap.has(pref)) {
      prefixMap.set(pref, photog);
    }
  }

  const unknown = db
    .prepare(
      `SELECT a.id, a.title, a.match_date
       FROM foto_albums a
       JOIN foto_users u ON u.id = a.photographer_id
       WHERE u.slug = 'neznamy-fotograf'
       ORDER BY a.match_date, a.created_at`
    )
    .all();

  const report = [];
  for (const album of unknown) {
    let fp;
    try {
      fp = await fingerprintAlbum(client, db, album.id);
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (/SlowDown|currently blocked/i.test(msg)) {
        console.error('S3 SlowDown — zastavuji, zkus později.');
        process.exit(2);
      }
      throw err;
    }
    let photog = null;
    let via = '';
    for (const hit of fp.hits) {
      if (hit.serial && serialMap.has(hit.serial)) {
        photog = serialMap.get(hit.serial);
        via = `serial ${hit.serial}`;
        break;
      }
    }
    if (!photog) {
      for (const hit of fp.hits) {
        const label = nameFromExif(hit);
        if (!label) continue;
        photog = matchPhotographer(db, label) || ensurePhotographer(db, label);
        if (photog) {
          via = `exif ${label}`;
          if (hit.serial) serialMap.set(hit.serial, photog);
          break;
        }
      }
    }
    if (!photog) {
      const topPrefix = Object.entries(fp.prefixCounts).sort((a, b) => b[1] - a[1])[0];
      if (topPrefix && prefixMap.has(topPrefix[0])) {
        photog = prefixMap.get(topPrefix[0]);
        via = `prefix ${topPrefix[0]}`;
      }
    }

    const sample = fp.hits[0] || {};
    if (photog) {
      db.prepare(`UPDATE foto_albums SET photographer_id = ?, updated_at = ? WHERE id = ?`).run(photog.id, now, album.id);
    }
    report.push({
      id: album.id,
      title: album.title,
      assigned: photog ? photog.name : null,
      via: photog ? via : '',
      prefixes: fp.prefixCounts,
      serial: sample.serial || '',
      artist: sample.artist || '',
      owner: sample.owner || '',
      make: sample.make || '',
      model: sample.model || '',
      lens: sample.lens || '',
      file: sample.file || '',
      keys: sample.keys || [],
    });
  }

  const leftover = db
    .prepare(
      `SELECT COUNT(*) AS c FROM foto_albums a JOIN foto_users u ON u.id = a.photographer_id WHERE u.slug = 'neznamy-fotograf'`
    )
    .get().c;
  if (!leftover) {
    db.prepare(`DELETE FROM foto_users WHERE slug = 'neznamy-fotograf'`).run();
  }

  console.log(JSON.stringify({ serials: [...serialMap.entries()].map(([k, v]) => [k, v.name]), report, leftover }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

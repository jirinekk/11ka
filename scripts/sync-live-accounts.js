#!/usr/bin/env node
'use strict';

/**
 * Přenese účty z živé 11ka.cz + Fotáku do lokálního CMS.
 * Hesla z produkce nemáme — nové účty dostanou náhodný hash (reset v administraci).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { initDb, getDb } = require('../db');
const { parseRoles, serializeRoles, primaryRole } = require('../lib/roles');

const ORIGIN = 'https://11ka.cz';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PUBLIC = path.join(ROOT, 'public');

const SKIP_FOTO_SLUGS = new Set(['neznamy-fotograf', 'novy-fotograf', 'petr-fotograf']);
const SKIP_EMAILS = new Set(['ceka@11ka.cz', 'fotograf@11ka.cz', 'admin@11ka.cz']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const html = await res.text();
  if (/Nenalezeno/i.test(html) && html.length < 8000) return null;
  return html;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

function localUploadPath(url) {
  const raw = String(url || '').trim().split('?')[0];
  const m = raw.match(/\/uploads\/[^#]+$/i);
  if (m) return m[0];
  if (raw.startsWith('/uploads/')) return raw;
  return '';
}

async function saveUpload(relOrUrl) {
  const rel = localUploadPath(relOrUrl);
  if (!rel) return '';
  const dest = path.join(PUBLIC, rel.replace(/^\//, ''));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 200) return rel;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const abs = relOrUrl.startsWith('http') ? relOrUrl.split('?')[0] : ORIGIN + rel;
  const buf = await fetchBuffer(abs);
  if (!buf || buf.length < 200) return '';
  fs.writeFileSync(dest, buf);
  return rel;
}

function parseProfile(html, fallbackName) {
  if (!html) return null;
  const title = ((html.match(/<title>([^<]+)/i) || [])[1] || '')
    .replace(/\s*[-–|].*$/, '')
    .replace(/\s*články\s*$/i, '')
    .trim();
  const og = ((html.match(/property="og:title" content="([^"]+)"/i) || [])[1] || '')
    .replace(/\s*[-–|].*$/, '')
    .replace(/\s*články\s*$/i, '')
    .trim();
  const name = title || og || fallbackName;
  const avatar =
    localUploadPath((html.match(/\/uploads\/avatars\/[a-z0-9._-]+/i) || [])[0] || '') ||
    localUploadPath(
      (html.match(/<img[^>]+class="[^"]*(?:rounded-full|avatar)[^"]*"[^>]+src="([^"]+)"/i) || [])[1] || ''
    );
  const bioMatch = html.match(
    /<p class="[^"]*(?:mt-8|author-bio|public-bio)[^"]*"[^>]*>([\s\S]*?)<\/p>/i
  );
  let public_bio = '';
  if (bioMatch) {
    const text = bioMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && !/Zatím bez bio/i.test(text)) public_bio = text.slice(0, 500);
  }
  const authorBio = ((html.match(/author-bio[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
  return {
    name,
    avatar,
    public_bio,
    author_bio: authorBio && !/Zatím bez bio/i.test(authorBio) ? authorBio : '',
  };
}

function findLocalUser(db, { email, slug, name }) {
  if (email) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (byEmail) return byEmail;
  }
  if (slug) {
    const bySlug = db.prepare('SELECT * FROM users WHERE slug = ? COLLATE NOCASE').get(slug);
    if (bySlug) return bySlug;
  }
  if (name) {
    const folded = fold(name);
    const rows = db.prepare('SELECT * FROM users').all();
    const hit = rows.find((row) => fold(row.display_name) === folded);
    if (hit) return hit;
  }
  return null;
}

function bumpSequence(db, id) {
  const row = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'users'`).get();
  if (!row) {
    db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('users', ?)`).run(id);
    return;
  }
  if (Number(row.seq) < id) {
    db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'users'`).run(id);
  }
}

function insertUser(db, { id, email, roles, display_name, slug, avatar_path, author_bio, public_bio, created_at }) {
  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(crypto.randomBytes(18).toString('hex'), 12);
  const primary = primaryRole(roles);
  const created = created_at || now;
  if (id) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, roles, display_name, slug, avatar_path, author_bio, public_bio, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      email,
      hash,
      primary,
      serializeRoles(roles),
      display_name,
      slug,
      avatar_path || null,
      author_bio || null,
      public_bio || null,
      created,
      now
    );
    bumpSequence(db, id);
    return id;
  }
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, role, roles, display_name, slug, avatar_path, author_bio, public_bio, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      email,
      hash,
      primary,
      serializeRoles(roles),
      display_name,
      slug,
      avatar_path || null,
      author_bio || null,
      public_bio || null,
      created,
      now
    );
  return info.lastInsertRowid;
}

function mergeRoles(user, extra) {
  return [...new Set([...parseRoles(user.roles, user.role), ...extra])];
}

function updateUserRow(db, user, patch) {
  const now = new Date().toISOString();
  const roles = patch.roles || parseRoles(user.roles, user.role);
  db.prepare(
    `UPDATE users
     SET email = ?, role = ?, roles = ?, display_name = ?, slug = ?, avatar_path = ?,
         author_bio = ?, public_bio = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.email || user.email,
    primaryRole(roles),
    serializeRoles(roles),
    patch.display_name || user.display_name,
    patch.slug || user.slug,
    patch.avatar_path !== undefined ? patch.avatar_path : user.avatar_path,
    patch.author_bio !== undefined ? patch.author_bio : user.author_bio,
    patch.public_bio !== undefined ? patch.public_bio : user.public_bio,
    now,
    user.id
  );
}

function isPlaceholderEmail(email) {
  const key = String(email || '').toLowerCase();
  return (
    key.endsWith('@11ka.local') ||
    key.endsWith('@foto.11ka.local') ||
    /^live\.[a-f0-9]+@/i.test(key)
  );
}

async function scrapeEditorial() {
  const found = [];
  for (let id = 1; id <= 80; id += 1) {
    const html = await fetchText(`${ORIGIN}/redaktor/${id}`);
    if (!html) continue;
    const parsed = parseProfile(html, '');
    if (!parsed || !parsed.name) continue;
    found.push({ liveId: id, ...parsed, href: `/redaktor/${id}` });
    await sleep(40);
  }
  return found;
}

async function scrapeUzivatel(slug, fallbackName) {
  const html = await fetchText(`${ORIGIN}/uzivatel/${slug}`);
  if (!html) return null;
  return parseProfile(html, fallbackName);
}

function fotoCmsRole(foto) {
  if (foto.role === 'VIEWER') return ['ctenar'];
  return ['fotograf'];
}

async function main() {
  initDb();
  const db = getDb();
  const report = { created: [], updated: [], skipped: [], editorial: [] };

  const editorial = await scrapeEditorial();
  report.editorial = editorial.map((row) => `${row.liveId} ${row.name}`);

  for (const person of editorial) {
    let avatar = '';
    if (person.avatar) avatar = await saveUpload(person.avatar);
    const existing = findLocalUser(db, { slug: null, name: person.name });
    if (existing) {
      const patch = {
        roles: parseRoles(existing.roles, existing.role),
      };
      if (avatar && (!existing.avatar_path || String(existing.avatar_path).includes('11ka.cz'))) {
        patch.avatar_path = avatar;
      }
      if (person.author_bio && !existing.author_bio) patch.author_bio = person.author_bio;
      if (person.public_bio && !existing.public_bio) patch.public_bio = person.public_bio;
      const taken = person.liveId !== existing.id && db.prepare('SELECT id FROM users WHERE id = ?').get(person.liveId);
      if (!taken && existing.id !== person.liveId && existing.id >= 23 && isPlaceholderEmail(existing.email)) {
        /* keep local id — articles may already point here */
      }
      updateUserRow(db, existing, patch);
      report.updated.push(`${existing.id} ${existing.display_name} (redakce ${person.liveId})`);
      continue;
    }
    const slugBase = person.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const email = `${slugBase.replace(/-/g, '.')}@11ka.local`;
    const idTaken = db.prepare('SELECT id FROM users WHERE id = ?').get(person.liveId);
    const newId = insertUser(db, {
      id: idTaken ? null : person.liveId,
      email,
      roles: ['redaktor'],
      display_name: person.name,
      slug: slugBase,
      avatar_path: avatar || null,
      author_bio: person.author_bio || null,
      public_bio: person.public_bio || null,
    });
    report.created.push(`${newId} ${person.name} redaktor (live ${person.liveId})`);
  }

  const fotoUsers = db.prepare(`SELECT * FROM foto_users ORDER BY name COLLATE NOCASE`).all();
  for (const foto of fotoUsers) {
    const email = String(foto.email || '').trim().toLowerCase();
    if (SKIP_FOTO_SLUGS.has(foto.slug) || SKIP_EMAILS.has(email)) {
      report.skipped.push(`${foto.name} (${foto.slug})`);
      continue;
    }
    const live = await scrapeUzivatel(foto.slug, foto.name);
    await sleep(40);
    let avatar = '';
    if (live && live.avatar) avatar = await saveUpload(live.avatar);
    const rolesWanted = fotoCmsRole(foto);
    const existing = findLocalUser(db, { email, slug: foto.slug, name: foto.name });
    if (existing) {
      const roles = mergeRoles(existing, rolesWanted);
      const patch = { roles };
      if (email && !isPlaceholderEmail(email) && isPlaceholderEmail(existing.email)) {
        const clash = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email, existing.id);
        if (!clash) patch.email = email;
      }
      if (avatar && (!existing.avatar_path || String(existing.avatar_path).startsWith('http'))) {
        patch.avatar_path = avatar;
      }
      if (live && live.author_bio && !existing.author_bio) patch.author_bio = live.author_bio;
      if (live && live.public_bio && !existing.public_bio) patch.public_bio = live.public_bio;
      if (!existing.slug && foto.slug) patch.slug = foto.slug;
      updateUserRow(db, existing, patch);
      report.updated.push(`${existing.id} ${existing.display_name} +${rolesWanted.join(',')}`);
      continue;
    }
    const newId = insertUser(db, {
      email: email || `${foto.slug}@foto.11ka.local`,
      roles: rolesWanted,
      display_name: foto.name,
      slug: foto.slug,
      avatar_path: avatar || null,
      author_bio: live && live.author_bio ? live.author_bio : null,
      public_bio: live && live.public_bio ? live.public_bio : null,
      created_at: foto.created_at,
    });
    report.created.push(`${newId} ${foto.name} ${rolesWanted.join(',')} <${email}>`);
  }

  const cms = db.prepare('SELECT id, email, role, roles, display_name, slug FROM users ORDER BY id').all();
  console.log(JSON.stringify({ report, users: cms.length, created: report.created, updated: report.updated, skipped: report.skipped, editorial: report.editorial }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

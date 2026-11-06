#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const FOTAK = '/Users/jirigalba/fotak_11ka';
const OUT = path.join(ROOT, 'data', 'seed-foto.json');

process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

function parseEnvFile(filePath) {
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq)] = value;
  }
  return out;
}

const fotakEnv = parseEnvFile(path.join(FOTAK, '.env.local'));
const dbUrl = fotakEnv.DATABASE_URL_UNPOOLED || fotakEnv.DATABASE_URL;
if (!dbUrl) {
  throw new Error('Chybí DATABASE_URL ve fotak_11ka/.env.local');
}
process.env.DATABASE_URL = dbUrl;
process.env.DATABASE_URL_UNPOOLED = dbUrl;

const fotakRequire = createRequire(path.join(FOTAK, 'package.json'));
const { PrismaClient } = fotakRequire('@prisma/client');

function iso(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

async function exportLive() {
  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });
  try {
    const optionalMany = async (run) => {
      try {
        return await run();
      } catch (err) {
        const code = err && err.code;
        if (code === 'P2021' || /does not exist/i.test(String(err && err.message))) return [];
        throw err;
      }
    };
    const [users, teams, players, albums, photos, tags, officials, presets, shares] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          slug: true,
          avatar: true,
          role: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.team.findMany(),
      prisma.player.findMany(),
      prisma.album.findMany(),
      prisma.photo.findMany(),
      optionalMany(() => prisma.photoTag.findMany()),
      optionalMany(() => prisma.albumOfficial.findMany()),
      optionalMany(() => prisma.preset.findMany()),
      optionalMany(() =>
        prisma.playerShare.findMany({
          select: {
            id: true,
            token: true,
            playerId: true,
            createdById: true,
            createdAt: true,
            revokedAt: true,
            lastSeenAt: true,
          },
        })
      ),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      users: users.map((u) => ({ ...u, createdAt: iso(u.createdAt) })),
      teams,
      players: players.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
      albums: albums.map((a) => ({
        ...a,
        matchDate: iso(a.matchDate),
        createdAt: iso(a.createdAt),
        updatedAt: iso(a.updatedAt),
      })),
      photos: photos.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
      tags,
      officials,
      presets: presets.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
      shares: shares.map((s) => ({
        ...s,
        createdAt: iso(s.createdAt),
        revokedAt: iso(s.revokedAt),
        lastSeenAt: iso(s.lastSeenAt),
      })),
    };

    fs.writeFileSync(OUT, JSON.stringify(payload));
    const newest = payload.albums
      .slice()
      .sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate)))
      .slice(0, 8)
      .map((a) => `${String(a.matchDate).slice(0, 10)} ${a.title}`);
    return {
      users: users.length,
      teams: teams.length,
      players: players.length,
      albums: albums.length,
      photos: photos.length,
      tags: tags.length,
      officials: officials.length,
      presets: presets.length,
      shares: shares.length,
      bytes: fs.statSync(OUT).size,
      newest,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function reseedSqlite() {
  const { initDb, getDb } = require('../db');
  initDb();
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM foto_photo_tags;
    DELETE FROM foto_album_officials;
    DELETE FROM foto_photos;
    DELETE FROM foto_shares;
    DELETE FROM foto_presets;
    DELETE FROM foto_albums;
    DELETE FROM foto_players;
    DELETE FROM foto_teams;
    DELETE FROM foto_users;
    PRAGMA foreign_keys = ON;
  `);
  require('../services/foto').ensureTables();
  const albums = db.prepare('SELECT COUNT(*) AS c FROM foto_albums').get().c;
  const photos = db.prepare('SELECT COUNT(*) AS c FROM foto_photos').get().c;
  const newest = db
    .prepare('SELECT title, match_date FROM foto_albums ORDER BY match_date DESC LIMIT 8')
    .all()
    .map((a) => `${String(a.match_date).slice(0, 10)} ${a.title}`);
  return { albums, photos, newest };
}

async function main() {
  console.log('exporting live Foták…');
  const exported = await exportLive();
  console.log(JSON.stringify({ exported }, null, 2));
  const newest = String((exported.newest && exported.newest[0]) || '');
  if (exported.albums < 44) {
    throw new Error(`Live dump má jen ${exported.albums} alb, neseeduju (lokálně je 44).`);
  }
  console.log('reseeding local sqlite…');
  const local = reseedSqlite();
  console.log(JSON.stringify({ local }, null, 2));
  console.log(newest);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

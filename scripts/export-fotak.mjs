/**
 * Dump Foták 11ka (Postgres) into data/seed-foto.json.
 * Run from the fotak_11ka directory so Prisma + .env.local resolve:
 *   cd /Users/jirigalba/fotak_11ka && npx tsx /Users/jirigalba/11ka.mod/scripts/export-fotak.mjs
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const outPath = path.join('/Users/jirigalba/11ka.mod/data/seed-foto.json');
const prisma = new PrismaClient();

function iso(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

async function main() {
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
    prisma.photoTag.findMany(),
    prisma.albumOfficial.findMany(),
    prisma.preset.findMany(),
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
    }),
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

  writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    JSON.stringify({
      out: outPath,
      users: users.length,
      teams: teams.length,
      players: players.length,
      albums: albums.length,
      photos: photos.length,
      tags: tags.length,
      officials: officials.length,
      presets: presets.length,
      shares: shares.length,
      bytes: Buffer.byteLength(JSON.stringify(payload)),
    })
  );
}

main()
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

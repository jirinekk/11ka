#!/usr/bin/env node
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { initDb, getDb } = require('../db');
const foto = require('../services/foto');
const livesport = require('../services/livesport-chance');

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findTeam(db, name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const direct = db.prepare('SELECT * FROM foto_teams WHERE name = ? COLLATE NOCASE').get(raw);
  if (direct) return direct;
  const target = fold(raw);
  const teams = db.prepare('SELECT * FROM foto_teams').all();
  let best = null;
  for (const team of teams) {
    const names = [team.name, team.short_name, String(team.slug || '').replace(/-/g, ' ')].map(fold);
    if (names.includes(target)) return team;
    if (names.some((n) => n === target || n.endsWith(' ' + target) || n.startsWith(target + ' '))) {
      if (!best || team.name.length < best.name.length) best = team;
    }
  }
  return best;
}

function apply(db, albumId, { photographerId, title, home, away, date, competition, homeScore, awayScore }) {
  const album = db.prepare('SELECT * FROM foto_albums WHERE id = ?').get(albumId);
  if (!album) return;
  const now = new Date().toISOString();
  const homeTeam = home ? findTeam(db, home) : null;
  const awayTeam = away ? findTeam(db, away) : null;
  const matchDate = date ? `${date}T12:00:00.000Z` : album.match_date;
  const pretty =
    title ||
    (homeTeam && awayTeam ? `${homeTeam.name} vs ${awayTeam.name}` : album.title);
  db.prepare(
    `UPDATE foto_albums
     SET title = ?, match_date = ?, competition = ?, photographer_id = ?,
         home_team_id = ?, away_team_id = ?, home_score = ?, away_score = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    pretty,
    matchDate,
    competition || album.competition || 'Chance Liga',
    photographerId || album.photographer_id,
    homeTeam ? homeTeam.id : album.home_team_id,
    awayTeam ? awayTeam.id : album.away_team_id,
    homeScore != null ? homeScore : album.home_score,
    awayScore != null ? awayScore : album.away_score,
    now,
    albumId
  );
}

async function main() {
  initDb();
  foto.ensureTables();
  const db = getDb();
  const id = (slug) => db.prepare('SELECT id FROM foto_users WHERE slug = ?').get(slug).id;

  const VO = id('david-vo');
  const ESTER = id('ester-spacilova');
  const OSKAR = id('oskar-charvat');
  const KRAJIC = id('krajic-photos');
  const ROBIN = id('robin-vesely');
  const KALOUS = id('ondrej-kalous');
  const SCHWEIGL = id('dominik-schweigl');
  const POLACEK = id('jan-polacek');
  const BACKOVSKY = id('milos-backovsky');
  const MICHALE = id('jonas-michale');
  const JANECEK = id('alexandr-janecek');

  for (const [albumId, patch] of [
    ['cmvfhcsk200hhwa3o9p8au2z3', { photographerId: VO, home: 'Pardubice', away: 'Zlín', date: '2026-10-17', homeScore: 3, awayScore: 0 }],
    ['cb908fa431d1820a19888b877', { photographerId: VO, home: 'Pardubice', away: 'Zlín', date: '2026-10-17', homeScore: 3, awayScore: 0 }],
    ['c5b60873fed6e23035fc07cc6', { photographerId: VO, home: 'Pardubice', away: 'Slovan Liberec', date: '2026-10-31', homeScore: 1, awayScore: 2 }],
    ['c7582ea9c80b97e9b6dfb2b02', { photographerId: SCHWEIGL, home: 'Sparta Praha', away: 'Slovácko', date: '2026-10-25', homeScore: 5, awayScore: 1 }],
    ['c3acc72b6ca972be8ce1d2ace', { home: 'Sigma Olomouc', away: 'Mladá Boleslav' }],
    ['ca561b491fc45d1f665449184', { home: 'Artis Brno', away: 'Zlín', date: '2026-10-31', homeScore: 2, awayScore: 2 }],
    ['cbeadf8968bc5acc86aa11138', { home: 'Mladá Boleslav', away: 'Hradec Králové', date: '2026-11-01', homeScore: 3, awayScore: 1 }],
    ['c5aca6828a7da2dadd06fe8d5', { home: 'Mladá Boleslav', away: 'Hradec Králové', date: '2026-11-01', homeScore: 3, awayScore: 1 }],
    ['c7baed1022102a45d22b023ab', { home: 'Artis Brno', away: 'Bohemians', date: '2026-11-04', homeScore: 1, awayScore: 2 }],
    ['c2c991258777c55e158be3d27', { home: 'Sparta Praha', away: 'Bournemouth', date: '2026-11-05', competition: 'Evropská liga' }],
    ['cfdaddde006b7227c73493071', { home: 'Sparta Praha', away: 'Bournemouth', date: '2026-11-05', competition: 'Evropská liga' }],
  ]) {
    apply(db, albumId, patch);
  }

  const ester17 = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 17. 10.%'`).all(ESTER);
  for (const row of ester17) apply(db, row.id, { home: 'Sigma Olomouc', away: 'Slovan Liberec', date: '2026-10-17', homeScore: 1, awayScore: 0 });

  const esterNov = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 1. 11.%'`).all(ESTER);
  for (const row of esterNov) apply(db, row.id, { home: 'Sigma Olomouc', away: 'Zbrojovka Brno', date: '2026-10-31', homeScore: 3, awayScore: 0 });

  const oskar18 = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 18. 10.%'`).all(OSKAR);
  for (const row of oskar18) apply(db, row.id, { home: 'Pardubice', away: 'Zlín', date: '2026-10-17', homeScore: 3, awayScore: 0 });

  const oskar24 = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 24. 10.%'`).all(OSKAR);
  for (const row of oskar24) apply(db, row.id, { home: 'Zlín', away: 'Sigma Olomouc', date: '2026-10-24', homeScore: 1, awayScore: 1 });

  const krajic = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 18. 10.%' ORDER BY a.created_at`).all(KRAJIC);
  if (krajic[0]) apply(db, krajic[0].id, { home: 'Jablonec', away: 'Viktoria Plzeň', date: '2026-10-18', homeScore: 2, awayScore: 3 });
  if (krajic[1]) apply(db, krajic[1].id, { home: 'Slovácko', away: 'Zbrojovka Brno', date: '2026-10-18', homeScore: 1, awayScore: 2 });

  const robin22 = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 22. 10.%'`).all(ROBIN);
  for (const row of robin22) apply(db, row.id, { home: 'Jablonec', away: 'Brighton', date: '2026-10-22', competition: 'Konferenční liga' });

  const kalous = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 24. 10.%' ORDER BY a.created_at`).all(KALOUS);
  if (kalous[0]) apply(db, kalous[0].id, { home: 'Teplice', away: 'Artis Brno', date: '2026-10-24', homeScore: 0, awayScore: 0 });
  if (kalous[1]) apply(db, kalous[1].id, { home: 'Zbrojovka Brno', away: 'Bohemians', date: '2026-10-24', homeScore: 2, awayScore: 2 });

  const polacek = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 27. 10.%'`).all(POLACEK);
  for (const row of polacek) apply(db, row.id, { home: 'Slovan Liberec', away: 'Teplice', date: '2026-10-27' });

  const backovsky = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 27. 10.%'`).all(BACKOVSKY);
  for (const row of backovsky) apply(db, row.id, { home: 'Slavia Praha', away: 'Zbrojovka Brno', date: '2026-10-27' });

  const michale = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 28. 10.%'`).all(MICHALE);
  for (const row of michale) apply(db, row.id, { home: 'Mladá Boleslav', away: 'Bohemians', date: '2026-10-28' });

  const janecek = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.photographer_id = ? AND a.title LIKE 'Fotky 31. 10.%'`).all(JANECEK);
  for (const row of janecek) apply(db, row.id, { home: 'Jablonec', away: 'Slavia Praha', date: '2026-10-31', homeScore: 0, awayScore: 5 });

  const marik = db.prepare(`SELECT a.id FROM foto_albums a WHERE a.title = 'JAB vs BHA'`).all();
  for (const row of marik) apply(db, row.id, { home: 'Jablonec', away: 'Brighton', date: '2026-10-22', competition: 'Konferenční liga' });

  const sedlakCodes = db.prepare(`SELECT a.id, a.title FROM foto_albums a JOIN foto_users u ON u.id = a.photographer_id WHERE u.slug = 'lukas-sedlak' AND a.title LIKE '% vs %'`).all();
  for (const row of sedlakCodes) {
    if (row.title === 'MLA vs SPA') apply(db, row.id, { home: 'Mladá Boleslav', away: 'Sparta Praha' });
    if (row.title === 'HRA vs PAN') apply(db, row.id, { home: 'Hradec Králové', away: 'Panathinaikos', competition: 'Konferenční liga' });
    if (row.title === 'RBL vs PSV') apply(db, row.id, { home: 'RB Lipsko', away: 'PSV', competition: 'Liga mistrů' });
  }

  const leftover = db.prepare(`
    SELECT a.title, u.name, count(*) c
    FROM foto_albums a JOIN foto_users u ON u.id = a.photographer_id
    WHERE a.title LIKE 'Fotky %' OR u.slug = 'neznamy-fotograf'
    GROUP BY a.title, u.name
  `).all();
  const galbaRow = db.prepare(`SELECT id FROM foto_users WHERE slug = 'jiri-galba'`).get();
  console.log(
    JSON.stringify(
      {
        leftover,
        galba: galbaRow
          ? db.prepare(`SELECT count(*) c FROM foto_albums WHERE photographer_id = ?`).get(galbaRow.id).c
          : 0,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

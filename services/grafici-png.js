const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const chanceLigaLogos = require('./chance-liga-logos');
const livesportChance = require('./livesport-chance');
const { ZONE_COLORS, ZONE_LEGEND, zoneForRank } = require('../lib/chance-table-zones');

const PUBLIC = path.join(__dirname, '..', 'public');
const ACCENT = '#16dffb';
const WHITE = '#ffffff';
const MUTED = '#9aa8b8';
const LINE = 'rgba(255,255,255,0.16)';
const FONT = 'DejaVu Sans, Arial, Helvetica, sans-serif';

const logoUriCache = new Map();
const pngCache = new Map();
const PNG_TTL_MS = 30 * 1000;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scoreText(value) {
  if (value == null || value === '') return '–';
  return String(value);
}

function seasonLabel(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 6 ? y : y - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
}

function formatCsDate(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      timeZone: 'Europe/Prague',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function formatCsKickoff(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      timeZone: 'Europe/Prague',
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function formLabel(form) {
  return (form || [])
    .map((f) => (f === 'W' ? 'V' : f === 'D' ? 'R' : 'P'))
    .join(' · ');
}

function formPts(form) {
  return (form || []).reduce((sum, f) => sum + (f === 'W' ? 3 : f === 'D' ? 1 : 0), 0);
}

function publicPathFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) return '';
  return path.join(PUBLIC, raw.replace(/^\//, ''));
}

async function fileToDataUri(abs, size = 80) {
  if (!abs || !fs.existsSync(abs)) return '';
  const buf = await sharp(abs)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function logoDataUri(logoUrl, size = 80) {
  const key = `${logoUrl}|${size}`;
  if (logoUriCache.has(key)) return logoUriCache.get(key);
  const abs = publicPathFromUrl(logoUrl);
  const uri = await fileToDataUri(abs, size);
  logoUriCache.set(key, uri);
  return uri;
}

async function brandLogoUri() {
  return '';
}

function svgImage(href, x, y, w, h) {
  if (!href) return '';
  return `<image href="${href}" xlink:href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" />`;
}

function crest(href, cx, cy, size) {
  const r = size / 2;
  const img = svgImage(href, cx - r + 3, cy - r + 3, size - 6, size - 6);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/>${img}`;
}

async function svgToPng(svg, cacheKey) {
  const hit = pngCache.get(cacheKey);
  if (hit && Date.now() < hit.exp) return hit.buf;
  const buf = await sharp(Buffer.from(svg), { density: 192 })
    .ensureAlpha()
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
  pngCache.set(cacheKey, { buf, exp: Date.now() + PNG_TTL_MS });
  return buf;
}

function wrapSvg(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font-family: ${FONT}; font-variant-numeric: tabular-nums; }
  </style>
  ${body}
</svg>`;
}

function headerBlock(_brandUri, title, subtitle, width) {
  return `
    <text x="8" y="36" fill="${ACCENT}" font-size="22" font-weight="800">11ka</text>
    <text x="${width - 8}" y="36" text-anchor="end" fill="${ACCENT}" font-size="15" font-weight="700" letter-spacing="1.4">11KA.CZ</text>
    <text x="8" y="78" fill="${WHITE}" font-size="34" font-weight="800">${esc(title)}</text>
    <text x="8" y="104" fill="${MUTED}" font-size="16" font-weight="600">${esc(subtitle)}</text>
  `;
}

function footerBlock(y, width) {
  return `<text x="${width - 8}" y="${y}" text-anchor="end" fill="${MUTED}" font-size="13">11ka.cz</text>`;
}

function cardFromRaw(row) {
  return chanceLigaLogos.withLogos({
    id: row.id,
    home: row.home,
    away: row.away,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    scoreHome: row.homeScore,
    scoreAway: row.awayScore,
    round: row.round || '',
    date: row.date,
    league: row.league || 'Chance Liga',
    homeLogo: row.homeLogo || '',
    awayLogo: row.awayLogo || '',
  });
}

function matchesForRound(all, predicate, pickLatest) {
  const pool = (all || []).filter(predicate);
  let best = null;
  for (const match of pool) {
    const ts = Date.parse(match.date || 0) || 0;
    if (!best) {
      best = { ts, round: match.round || '' };
      continue;
    }
    if (pickLatest ? ts > best.ts : ts < best.ts) best = { ts, round: match.round || '' };
  }
  const round = best?.round || '';
  const matches = pool
    .filter((m) => (round ? m.round === round : true))
    .sort((a, b) => (Date.parse(a.date || 0) || 0) - (Date.parse(b.date || 0) || 0))
    .map(cardFromRaw);
  return {
    round,
    matches,
    dateLabel: best ? formatCsDate(new Date(best.ts).toISOString()) : '',
  };
}

async function latestFinishedRound(all) {
  return matchesForRound(all, (m) => m.state === 'post', true);
}

async function nextRound(all) {
  const upcoming = matchesForRound(all, (m) => m.state !== 'post', false);
  if (upcoming.matches.length) return upcoming;
  return matchesForRound(all, (m) => m.state === 'post', true);
}

async function getContext() {
  const [standings, all] = await Promise.all([livesportChance.getStandings(), livesportChance.listAllMatches()]);
  const roundInfo = await latestFinishedRound(all);
  const upcoming = await nextRound(all);
  return {
    standings,
    season: seasonLabel(),
    round: roundInfo.round,
    dateLabel: roundInfo.dateLabel,
    matches: roundInfo.matches,
    upcomingRound: upcoming.round,
    upcomingDateLabel: upcoming.dateLabel,
    upcoming: upcoming.matches,
  };
}

function leagueStats(standings) {
  const rows = standings || [];
  if (!rows.length) return [];
  const leader = rows[0];
  const attack = [...rows].sort((a, b) => b.gf - a.gf || b.pts - a.pts)[0];
  const defense = [...rows].sort((a, b) => a.ga - b.ga || b.pts - a.pts)[0];
  const form = [...rows].sort((a, b) => formPts(b.form) - formPts(a.form) || b.pts - a.pts)[0];
  return [
    { key: 'lider', label: 'Lídr tabulky', value: `${leader.pts} b`, detail: `${leader.played} zápasů`, club: leader },
    { key: 'utok', label: 'Nejlepší útok', value: String(attack.gf), detail: 'vstřelených gólů', club: attack },
    { key: 'obrana', label: 'Nejlepší obrana', value: String(defense.ga), detail: 'obdržených gólů', club: defense },
    { key: 'forma', label: 'Nejlepší forma', value: formLabel(form.form) || '–', detail: 'posledních 5 zápasů', club: form },
  ];
}

async function renderTablePng() {
  const ctx = await getContext();
  const rows = ctx.standings;
  const brand = await brandLogoUri();
  const logos = {};
  await Promise.all(
    rows.map(async (row) => {
      logos[row.code] = await logoDataUri(row.logo, 72);
    })
  );

  const width = 1000;
  const top = 128;
  const rowH = 46;
  const legendY = top + 28 + rows.length * rowH + 28;
  const height = legendY + 36;
  const cols = [
    { x: 46, label: '#', anchor: 'middle' },
    { x: 78, label: 'Tým', anchor: 'start' },
    { x: 560, label: 'Z', anchor: 'middle' },
    { x: 620, label: 'V', anchor: 'middle' },
    { x: 680, label: 'R', anchor: 'middle' },
    { x: 740, label: 'P', anchor: 'middle' },
    { x: 830, label: 'Góly', anchor: 'middle' },
    { x: 910, label: '+/−', anchor: 'middle' },
    { x: 972, label: 'B', anchor: 'middle' },
  ];

  const head = cols
    .map((c) => `<text x="${c.x}" y="${top}" fill="${MUTED}" font-size="13" font-weight="700" text-anchor="${c.anchor}">${c.label}</text>`)
    .join('');

  const body = rows
    .map((row, i) => {
      const y = top + 28 + i * rowH;
      const cy = y - 6;
      const zone = zoneForRank(row.rank);
      const color = (zone && ZONE_COLORS[zone]) || MUTED;
      const logo = logos[row.code] || '';
      return `
        <rect x="0" y="${y - 34}" width="4" height="${rowH - 2}" rx="1" fill="${color}"/>
        <line x1="18" y1="${y + 10}" x2="${width - 8}" y2="${y + 10}" stroke="${LINE}" stroke-width="1"/>
        <text x="46" y="${cy + 6}" fill="${color}" font-size="18" font-weight="800" text-anchor="middle">${row.rank}</text>
        ${crest(logo, 96, cy, 28)}
        <text x="118" y="${cy + 6}" fill="${WHITE}" font-size="18" font-weight="700">${esc(row.short || row.name)}</text>
        <text x="560" y="${cy + 6}" fill="${MUTED}" font-size="16" font-weight="600" text-anchor="middle">${row.played}</text>
        <text x="620" y="${cy + 6}" fill="${MUTED}" font-size="16" font-weight="600" text-anchor="middle">${row.won}</text>
        <text x="680" y="${cy + 6}" fill="${MUTED}" font-size="16" font-weight="600" text-anchor="middle">${row.drawn}</text>
        <text x="740" y="${cy + 6}" fill="${MUTED}" font-size="16" font-weight="600" text-anchor="middle">${row.lost}</text>
        <text x="830" y="${cy + 6}" fill="${WHITE}" font-size="16" font-weight="600" text-anchor="middle">${esc(row.goalsLabel)}</text>
        <text x="910" y="${cy + 6}" fill="${WHITE}" font-size="16" font-weight="600" text-anchor="middle">${esc(row.gdLabel)}</text>
        <text x="972" y="${cy + 6}" fill="${ACCENT}" font-size="20" font-weight="800" text-anchor="middle">${row.pts}</text>
      `;
    })
    .join('');

  const legendXs = [8, 160, 332, 548, 680];
  const legend = ZONE_LEGEND.map((item, i) => {
    const x = legendXs[i] || 8 + i * 198;
    return `
      <rect x="${x}" y="${legendY - 12}" width="10" height="10" rx="2" fill="${item.color}"/>
      <text x="${x + 16}" y="${legendY - 2}" fill="${MUTED}" font-size="13" font-weight="600">${esc(item.label)}</text>
    `;
  }).join('');

  const svg = wrapSvg(
    width,
    height,
    `${headerBlock(brand, 'Tabulka', `Chance Liga ${ctx.season}`, width)}${head}${body}${legend}${footerBlock(height - 12, width)}`
  );
  return svgToPng(svg, 'tabulka');
}

async function renderResultsPng() {
  const ctx = await getContext();
  const matches = ctx.matches;
  const brand = await brandLogoUri();
  const logos = {};
  await Promise.all(
    matches.map(async (m) => {
      logos[`${m.id}-h`] = await logoDataUri(m.homeLogo, 80);
      logos[`${m.id}-a`] = await logoDataUri(m.awayLogo, 80);
    })
  );

  const width = 1000;
  const top = 128;
  const rowH = 78;
  const height = top + matches.length * rowH + 48;
  const subtitle = [ctx.round || 'Poslední kolo', ctx.dateLabel, `Chance Liga ${ctx.season}`].filter(Boolean).join('  ·  ');

  const body = matches
    .map((m, i) => {
      const y = top + i * rowH;
      const cy = y + 36;
      return `
        <line x1="8" y1="${y}" x2="${width - 8}" y2="${y}" stroke="${LINE}" stroke-width="1"/>
        ${crest(logos[`${m.id}-h`], 48, cy, 40)}
        <text x="78" y="${cy + 7}" fill="${WHITE}" font-size="20" font-weight="700">${esc(m.homeLabel || m.home)}</text>
        <text x="500" y="${cy + 8}" fill="${ACCENT}" font-size="28" font-weight="800" text-anchor="middle">${esc(scoreText(m.scoreHome))} : ${esc(scoreText(m.scoreAway))}</text>
        <text x="922" y="${cy + 7}" fill="${WHITE}" font-size="20" font-weight="700" text-anchor="end">${esc(m.awayLabel || m.away)}</text>
        ${crest(logos[`${m.id}-a`], 952, cy, 40)}
      `;
    })
    .join('');

  const svg = wrapSvg(
    width,
    height,
    `${headerBlock(brand, 'Výsledky', subtitle, width)}${body}${footerBlock(height - 12, width)}`
  );
  return svgToPng(svg, `vysledky:${ctx.round}`);
}

async function renderProgramPng() {
  const ctx = await getContext();
  const matches = ctx.upcoming;
  const brand = await brandLogoUri();
  const logos = {};
  await Promise.all(
    matches.map(async (m) => {
      logos[`${m.id}-h`] = await logoDataUri(m.homeLogo, 80);
      logos[`${m.id}-a`] = await logoDataUri(m.awayLogo, 80);
    })
  );

  const width = 1000;
  const top = 128;
  const rowH = 78;
  const height = top + Math.max(matches.length, 1) * rowH + 48;
  const subtitle = [ctx.upcomingRound || 'Další kolo', ctx.upcomingDateLabel, `Chance Liga ${ctx.season}`]
    .filter(Boolean)
    .join('  ·  ');

  const body = matches.length
    ? matches
        .map((m, i) => {
          const y = top + i * rowH;
          const cy = y + 36;
          return `
        <line x1="8" y1="${y}" x2="${width - 8}" y2="${y}" stroke="${LINE}" stroke-width="1"/>
        ${crest(logos[`${m.id}-h`], 48, cy, 40)}
        <text x="78" y="${cy + 7}" fill="${WHITE}" font-size="20" font-weight="700">${esc(m.homeLabel || m.home)}</text>
        <text x="500" y="${cy + 8}" fill="${ACCENT}" font-size="18" font-weight="800" text-anchor="middle">${esc(formatCsKickoff(m.date))}</text>
        <text x="922" y="${cy + 7}" fill="${WHITE}" font-size="20" font-weight="700" text-anchor="end">${esc(m.awayLabel || m.away)}</text>
        ${crest(logos[`${m.id}-a`], 952, cy, 40)}
      `;
        })
        .join('')
    : `<text x="500" y="${top + 40}" fill="${MUTED}" font-size="18" font-weight="600" text-anchor="middle">Žádné nadcházející zápasy</text>`;

  const svg = wrapSvg(
    width,
    height,
    `${headerBlock(brand, 'Program', subtitle, width)}${body}${footerBlock(height - 12, width)}`
  );
  return svgToPng(svg, `program:${ctx.upcomingRound}`);
}

async function renderStatsPng() {
  const ctx = await getContext();
  const stats = leagueStats(ctx.standings);
  const brand = await brandLogoUri();
  const logos = {};
  await Promise.all(
    stats.map(async (item) => {
      logos[item.key] = await logoDataUri(item.club.logo, 96);
    })
  );

  const width = 1000;
  const top = 128;
  const tileW = 484;
  const tileH = 168;
  const gap = 16;
  const height = top + 2 * tileH + gap + 48;

  const tiles = stats
    .map((item, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 8 + col * (tileW + gap);
      const y = top + row * (tileH + gap);
      return `
        <rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="18" fill="none" stroke="${LINE}" stroke-width="1.5"/>
        <text x="${x + 22}" y="${y + 36}" fill="${MUTED}" font-size="14" font-weight="700" letter-spacing="1.2">${esc(item.label.toUpperCase())}</text>
        ${crest(logos[item.key], x + 44, y + 88, 52)}
        <text x="${x + 82}" y="${y + 78}" fill="${WHITE}" font-size="22" font-weight="700">${esc(item.club.short || item.club.name)}</text>
        <text x="${x + 82}" y="${y + 112}" fill="${ACCENT}" font-size="28" font-weight="800">${esc(item.value)}</text>
        <text x="${x + 22}" y="${y + 148}" fill="${MUTED}" font-size="13">${esc(item.detail)}</text>
      `;
    })
    .join('');

  const svg = wrapSvg(
    width,
    height,
    `${headerBlock(brand, 'Statistiky', `Chance Liga ${ctx.season}`, width)}${tiles}${footerBlock(height - 12, width)}`
  );
  return svgToPng(svg, 'statistiky');
}

async function renderMatchPng(id) {
  const all = await livesportChance.listAllMatches();
  const raw = (all || []).find((m) => String(m.id) === String(id));
  if (!raw) return null;
  const match = cardFromRaw(raw);
  const brand = await brandLogoUri();
  const homeLogo = await logoDataUri(match.homeLogo, 140);
  const awayLogo = await logoDataUri(match.awayLogo, 140);
  const width = 1080;
  const height = 420;
  const subtitle = [match.round, match.league || 'Chance Liga', formatCsDate(match.date)].filter(Boolean).join('  ·  ');
  const homeScore = scoreText(match.scoreHome);
  const awayScore = scoreText(match.scoreAway);

  const svg = wrapSvg(
    width,
    height,
    `
      ${headerBlock(brand, 'Výsledek', subtitle, width)}
      ${crest(homeLogo, 160, 250, 88)}
      <text x="160" y="330" fill="${WHITE}" font-size="24" font-weight="700" text-anchor="middle">${esc(match.homeLabel || match.home)}</text>
      <text x="540" y="262" fill="${ACCENT}" font-size="72" font-weight="800" text-anchor="middle">${esc(homeScore)} : ${esc(awayScore)}</text>
      ${crest(awayLogo, 920, 250, 88)}
      <text x="920" y="330" fill="${WHITE}" font-size="24" font-weight="700" text-anchor="middle">${esc(match.awayLabel || match.away)}</text>
      ${footerBlock(height - 16, width)}
    `
  );
  return svgToPng(svg, `zapas:${id}`);
}

module.exports = {
  getContext,
  renderTablePng,
  renderResultsPng,
  renderProgramPng,
  renderStatsPng,
  renderMatchPng,
};

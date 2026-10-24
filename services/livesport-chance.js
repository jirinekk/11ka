const { slugify } = require('../lib/slug');
const chanceLigaLogos = require('./chance-liga-logos');

const LISTING_URL = 'https://www.livesport.cz/fotbal/cesko/chance-liga/';
const NARODNI_URL = 'https://www.livesport.cz/fotbal/cesko/chance-narodni-liga/';
const CZECH_NT_URL = 'https://www.livesport.cz/tym/cesko/6LHwBDGU/';
const FEED_BASE = 'https://www.livesport.cz/x/feed/';
const GQL_MAIN = 'https://1.ds.lsapp.eu/pq_graphql';
const FSIGN = 'SW9D1eZo';
const PROJECT_ID = '1';
const LOGO_BASE = 'https://static.flashscore.com/res/image/data/';

const LISTING_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 75 * 1000;
const SQUAD_TTL_MS = 30 * 60 * 1000;
const FETCH_MS = 8000;
const CHANCE_TOURNAMENT_ID = 'b56zL2iK';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

let listingCache = { expiresAt: 0, data: null };
let narodniCache = { expiresAt: 0, data: null };
let czechNtCache = { expiresAt: 0, data: null };
const detailCache = new Map();
const squadCache = new Map();

function foldName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fc|fk|sk|ac|sc|mfk|1 fc)\b/g, '')
    .replace(/\b(praha|1905)\b/g, '')
    .trim();
}

function parseFields(chunk) {
  const out = {};
  const re = /([A-Z0-9]{1,5})÷([^¬]*)/g;
  let m;
  while ((m = re.exec(String(chunk || '')))) {
    out[m[1]] = m[2];
  }
  return out;
}

function logoUrl(file) {
  const f = String(file || '').trim();
  if (!f) return '';
  if (/^https?:\/\//i.test(f)) return f;
  return LOGO_BASE + f.replace(/^\//, '');
}

function isoFromUnix(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 1) return null;
  return new Date(n * 1000).toISOString();
}

function eventIdFromSlug(slug) {
  const s = String(slug || '').trim();
  const m = s.match(/([A-Za-z0-9]{8})$/);
  return m ? m[1] : '';
}

function matchSlug(row) {
  const home = slugify(row.home || 'domaci');
  const away = slugify(row.away || 'hoste');
  return `${home}-vs-${away}-${row.id}`;
}

function detailPath(row) {
  return `/zapasy/chance/${matchSlug(row)}`;
}

function statusFromAb(ab, kickoffIso) {
  const code = String(ab || '');
  if (code === '2') return 'in';
  if (code === '3' || code === '10' || code === '11') return 'post';
  if (code === '4' || code === '5' || code === '9' || code === '36' || code === '37' || code === '43' || code === '54') {
    return 'post';
  }
  const ts = kickoffIso ? Date.parse(kickoffIso) : NaN;
  if (Number.isFinite(ts) && Date.now() >= ts && Date.now() - ts < 2.5 * 60 * 60 * 1000) {
    return 'in';
  }
  return 'pre';
}

function displayScore(home, away, state) {
  if (state === 'pre') return '0:0';
  const h = home != null && String(home).trim() !== '' ? String(home).trim() : '0';
  const a = away != null && String(away).trim() !== '' ? String(away).trim() : '0';
  if (!/^\d+$/.test(h) || !/^\d+$/.test(a)) return state === 'pre' ? '0:0' : '';
  return `${h}:${a}`;
}

function statusLabel(state, iso) {
  if (state === 'in') return 'Živě';
  if (state === 'post') return 'Konec';
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  });
}

async function fetchBuffer(url, { headers = {}, timeoutMs = FETCH_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
        Referer: LISTING_URL,
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, opts) {
  const buf = await fetchBuffer(url, opts);
  try {
    return buf.toString('utf8');
  } catch {
    return buf.toString('latin1');
  }
}

async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  return JSON.parse(text);
}

function parseListingEvents(html, { requireRound = true, league = 'Chance Liga' } = {}) {
  const src = String(html || '');
  const parts = src.split(/~AA÷/);
  const out = [];
  const seen = new Set();
  for (let i = 1; i < parts.length; i += 1) {
    const fields = parseFields(`AA÷${parts[i]}`);
    const id = fields.AA;
    if (!id || seen.has(id)) continue;
    const home = fields.AE || fields.FH || '';
    const away = fields.AF || fields.FK || '';
    const round = fields.ER || '';
    if (!home || !away) continue;
    if (requireRound && !/\d+\s*\.?\s*kolo/i.test(round)) continue;
    seen.add(id);
    const iso = isoFromUnix(fields.AD || fields.ADE);
    const state = statusFromAb(fields.AB, iso);
    const score = displayScore(fields.AG, fields.AH, state);
    out.push({
      id,
      home,
      away,
      homeLogo: logoUrl(fields.OA),
      awayLogo: logoUrl(fields.OB),
      homeAbbr: fields.WM || '',
      awayAbbr: fields.WN || '',
      homeSlug: fields.WU || slugify(home),
      awaySlug: fields.WV || slugify(away),
      homeTeamId: fields.PX || '',
      awayTeamId: fields.PY || '',
      homeParticipantId: fields.JA || '',
      awayParticipantId: fields.JB || '',
      round,
      date: iso,
      kickoff: iso,
      state,
      score,
      homeScore: fields.AG != null && fields.AG !== '' ? Number(fields.AG) : state === 'pre' ? 0 : null,
      awayScore: fields.AH != null && fields.AH !== '' ? Number(fields.AH) : state === 'pre' ? 0 : null,
      league,
    });
  }
  return out.sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
}

async function listAllMatches() {
  const now = Date.now();
  if (listingCache.data && now < listingCache.expiresAt) return listingCache.data;
  const html = await fetchText(LISTING_URL);
  const rows = parseListingEvents(html);
  listingCache = { expiresAt: now + LISTING_TTL_MS, data: rows };
  return rows;
}

async function listNarodniLiga() {
  const now = Date.now();
  if (narodniCache.data && now < narodniCache.expiresAt) return narodniCache.data;
  const html = await fetchText(NARODNI_URL);
  const rows = parseListingEvents(html, { requireRound: true, league: 'Chance Národní liga' });
  const mapped = rows.map((row) => {
    const card = toCardMatch(row);
    return {
      ...card,
      league: 'Chance Národní liga',
      detailHref: '',
      homeHref: '',
      awayHref: '',
      matchKey: `narodni:${row.id}`,
    };
  });
  narodniCache = { expiresAt: now + LISTING_TTL_MS, data: mapped };
  return mapped;
}

async function listCzechNational() {
  const now = Date.now();
  if (czechNtCache.data && now < czechNtCache.expiresAt) return czechNtCache.data;
  const html = await fetchText(CZECH_NT_URL);
  const rows = parseListingEvents(html, { requireRound: false, league: 'Česká reprezentace' });
  const mapped = rows.map((row) => {
    const card = toCardMatch(row);
    return {
      ...card,
      league: 'Česká reprezentace',
      detailHref: '',
      homeHref: '',
      awayHref: '',
      matchKey: `repre:${row.id}`,
    };
  });
  czechNtCache = { expiresAt: now + LISTING_TTL_MS, data: mapped };
  return mapped;
}

function formatCardMeta(row) {
  const bits = [];
  if (row.round) bits.push(row.round);
  if (row.date) {
    try {
      bits.push(
        new Date(row.date).toLocaleDateString('cs-CZ', {
          day: 'numeric',
          month: 'numeric',
          timeZone: 'Europe/Prague',
        })
      );
    } catch {
      /* ignore */
    }
  }
  return bits.join(' · ');
}

function pragueDayKey(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function todayKey() {
  return pragueDayKey(new Date().toISOString());
}

function shiftDayKey(key, delta) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(delta || 0));
  return dt.toISOString().slice(0, 10);
}

function formatDayNavLabel(key) {
  if (!key) return '';
  const today = todayKey();
  if (key === today) return 'Dnes';
  if (key === shiftDayKey(today, 1)) return 'Zítra';
  if (key === shiftDayKey(today, -1)) return 'Včera';
  try {
    return new Date(`${key}T12:00:00`).toLocaleDateString('cs-CZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      timeZone: 'Europe/Prague',
    });
  } catch {
    return key;
  }
}

function splitScore(score) {
  const raw = String(score || '').replace(/\s+/g, '');
  const m = raw.match(/^(\d+)[:\-](\d+)$/);
  if (!m) return { home: '', away: '', line: raw || '–' };
  return { home: m[1], away: m[2], line: `${m[1]} - ${m[2]}` };
}

function toCardMatch(row) {
  const state = row.state;
  const score = displayScore(row.homeScore, row.awayScore, state);
  const parts = splitScore(score);
  const time = statusLabel(state, row.date);
  return chanceLigaLogos.withLogos({
    id: row.id,
    home: row.home,
    away: row.away,
    homeLogo: row.homeLogo || '',
    awayLogo: row.awayLogo || '',
    homeInitials: (row.homeAbbr || row.home || '?').slice(0, 3).toUpperCase(),
    awayInitials: (row.awayAbbr || row.away || '?').slice(0, 3).toUpperCase(),
    date: row.date,
    kickoff: row.kickoff || row.date,
    time,
    score,
    scoreHome: parts.home,
    scoreAway: parts.away,
    scoreLine: state === 'pre' ? '–' : parts.line,
    badge: state === 'post' ? 'FT' : state === 'in' ? 'LIVE' : time,
    dayKey: pragueDayKey(row.date),
    isLive: state === 'in',
    isDone: state === 'post',
    league: row.league || 'Chance Liga',
    round: row.round || '',
    meta: formatCardMeta(row),
    detailHref: row.league && row.league !== 'Chance Liga' ? '' : detailPath(row),
    matchKey: (row.league && row.league !== 'Chance Liga' ? 'repre:' : 'chance:') + matchSlug(row),
    livesportId: row.id,
  });
}

async function listPickerMatches(limit = 48) {
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(80, Number(limit))) : 48;
  const all = await listAllMatches();
  return all
    .slice()
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, lim)
    .map(toCardMatch);
}

async function listUpcoming(limit = 16) {
  const all = await listAllMatches();
  const now = Date.now();
  const cutoff = now - 3 * 60 * 60 * 1000;
  const future = all.filter((m) => {
    const ts = Date.parse(m.date);
    return Number.isFinite(ts) && ts >= cutoff && m.state !== 'post';
  });
  return future.slice(0, limit).map(toCardMatch);
}

async function getMatchesHub(requestedDay) {
  const all = await listAllMatches();
  const days = Array.from(new Set(all.map((m) => pragueDayKey(m.date)).filter(Boolean))).sort();
  const today = todayKey();
  let day = String(requestedDay || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (days.length && !days.includes(day))) {
    day = days.includes(today) ? today : days.find((d) => d >= today) || days[days.length - 1] || today;
  }
  const idx = days.indexOf(day);
  const matches = all.filter((m) => pragueDayKey(m.date) === day).map(toCardMatch);
  return {
    day,
    dayLabel: formatDayNavLabel(day),
    prevDay: idx > 0 ? days[idx - 1] : '',
    nextDay: idx >= 0 && idx < days.length - 1 ? days[idx + 1] : '',
    liveCount: matches.filter((m) => m.isLive).length,
    matches,
    leagues: matches.length ? [{ id: 'chance-liga', label: 'Chance Liga', matches }] : [],
  };
}

async function getMatchesAgenda() {
  const all = (await listAllMatches()).map(toCardMatch);
  const today = todayKey();
  const keys = Array.from(new Set(all.map((m) => m.dayKey).filter(Boolean))).sort();
  let keep = keys.filter((d) => d >= today);
  if (!keep.length) keep = keys.slice(-4);
  if (keep.length > 12) keep = keep.slice(0, 12);
  const keepSet = new Set(keep);
  return {
    today,
    liveCount: all.filter((m) => m.isLive).length,
    matches: all.filter((m) => keepSet.has(m.dayKey)),
  };
}

async function listSameRound(round, excludeId) {
  const key = String(round || '').trim();
  if (!key) return [];
  const all = await listAllMatches();
  return all
    .filter((m) => m.round === key && m.id !== excludeId)
    .map(toCardMatch);
}

async function listResults(limit = 40) {
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(120, Number(limit))) : 40;
  const all = await listAllMatches();
  return all
    .filter((m) => m.state === 'post')
    .slice()
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, lim)
    .map(toCardMatch);
}

function emptyStanding(club) {
  return {
    code: club.code,
    slug: club.slug,
    href: club.href,
    name: club.name,
    short: club.short,
    logo: club.logo,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
    form: [],
  };
}

function applyResult(row, scored, conceded, result) {
  row.played += 1;
  row.gf += scored;
  row.ga += conceded;
  if (result === 'W') {
    row.won += 1;
    row.pts += 3;
  } else if (result === 'D') {
    row.drawn += 1;
    row.pts += 1;
  } else {
    row.lost += 1;
  }
  row.form.push(result);
}

function computeStandings(matches) {
  const rows = new Map();
  for (const club of chanceLigaLogos.listClubs()) {
    rows.set(club.code, emptyStanding(club));
  }
  const finished = (matches || [])
    .filter((m) => m.state === 'post')
    .slice()
    .sort((a, b) => (Date.parse(a.date || 0) || 0) - (Date.parse(b.date || 0) || 0));
  for (const match of finished) {
    const homeClub = chanceLigaLogos.matchTeam(match.home);
    const awayClub = chanceLigaLogos.matchTeam(match.away);
    if (!homeClub || !awayClub) continue;
    const hg = Number(match.homeScore);
    const ag = Number(match.awayScore);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    const home = rows.get(homeClub.code);
    const away = rows.get(awayClub.code);
    if (!home || !away) continue;
    if (hg > ag) {
      applyResult(home, hg, ag, 'W');
      applyResult(away, ag, hg, 'L');
    } else if (hg < ag) {
      applyResult(home, hg, ag, 'L');
      applyResult(away, ag, hg, 'W');
    } else {
      applyResult(home, hg, ag, 'D');
      applyResult(away, ag, hg, 'D');
    }
  }
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      gd: row.gf - row.ga,
      goalsLabel: `${row.gf}:${row.ga}`,
      gdLabel: row.gf - row.ga > 0 ? `+${row.gf - row.ga}` : String(row.gf - row.ga),
      form: row.form.slice(-5),
    }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.short.localeCompare(b.short, 'cs'))
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

async function getStandings() {
  const all = await listAllMatches();
  return computeStandings(all);
}

function isClubInMatch(match, club) {
  if (!club) return false;
  const home = chanceLigaLogos.matchTeam(match.home);
  const away = chanceLigaLogos.matchTeam(match.away);
  return (home && home.code === club.code) || (away && away.code === club.code);
}

function livesportTeamForClub(matches, club) {
  for (const match of matches || []) {
    const home = chanceLigaLogos.matchTeam(match.home);
    if (home && home.code === club.code && match.homeTeamId) {
      return { id: match.homeTeamId, slug: match.homeSlug || slugify(match.home), name: match.home };
    }
    const away = chanceLigaLogos.matchTeam(match.away);
    if (away && away.code === club.code && match.awayTeamId) {
      return { id: match.awayTeamId, slug: match.awaySlug || slugify(match.away), name: match.away };
    }
  }
  return null;
}

function flipPersonName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts.slice(1).join(' ')} ${parts[0]}`;
}

function cellText(rowHtml, className) {
  const re = new RegExp(`lineupTable__cell--${className}[^>]*>\\s*([^<]*)`);
  const m = String(rowHtml || '').match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function isCoachTitle(title) {
  return /trener/.test(foldName(title));
}

function parseSquadHtml(html) {
  const src = String(html || '');
  const leagueMark = `id="league-${CHANCE_TOURNAMENT_ID}-table"`;
  const start = src.indexOf(leagueMark) >= 0 ? src.indexOf(leagueMark) : src.indexOf('id="overall-all-table"');
  if (start < 0) return { groups: [], coach: null };
  const rest = src.slice(start);
  const nextTable = rest.search(/id="(?!league-b56zL2iK-table|overall-all-table)[^"]*table"/);
  const block = nextTable > 0 ? rest.slice(0, nextTable) : rest.slice(0, 90000);
  const groups = [];
  let coach = null;
  const titleRe = /<div class="lineupTable__title">([^<]+)<\/div>([\s\S]*?)(?=<div class="lineupTable__title">|$)/g;
  let titleMatch;
  while ((titleMatch = titleRe.exec(block))) {
    const title = titleMatch[1].trim();
    const chunk = titleMatch[2];
    const players = [];
    const rowRe = /<div class="lineupTable__row">([\s\S]*?)(?=<div class="lineupTable__row">|$)/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(chunk))) {
      const row = rowMatch[1];
      const nameRaw = (row.match(/lineupTable__cell--name"[^>]*>\s*([^<]+)/) || [])[1];
      const name = flipPersonName(nameRaw);
      if (!name) continue;
      const jersey = cellText(row, 'jersey');
      const player = {
        name,
        jersey: /^\d+$/.test(jersey) ? jersey : '',
        age: cellText(row, 'age'),
        played: cellText(row, 'matchesPlayed'),
        minutes: cellText(row, 'minutesPlayed'),
        goals: cellText(row, 'goal'),
        assists: cellText(row, 'assist'),
        out: /Mimo soupisku/i.test(row),
      };
      if (isCoachTitle(title)) {
        coach = { name, age: player.age };
        continue;
      }
      players.push(player);
    }
    if (players.length && !isCoachTitle(title)) {
      groups.push({ title, players });
    }
  }
  return { groups, coach };
}

async function getSquad(teamId, teamSlug) {
  const id = String(teamId || '').trim();
  const slug = String(teamSlug || '').trim();
  if (!id || !slug) return { groups: [], coach: null };
  const now = Date.now();
  const cached = squadCache.get(id);
  if (cached && now < cached.expiresAt) return cached.data;
  const url = `https://www.livesport.cz/tym/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/soupiska/`;
  let html = '';
  try {
    html = await fetchText(url);
  } catch {
    html = '';
  }
  const data = parseSquadHtml(html);
  squadCache.set(id, { expiresAt: now + SQUAD_TTL_MS, data });
  return data;
}

async function getClubProfile(slug) {
  const club = chanceLigaLogos.getClubBySlug(slug);
  if (!club) return null;
  const all = await listAllMatches();
  const standings = computeStandings(all);
  const row = standings.find((item) => item.code === club.code) || null;
  const clubMatches = all.filter((m) => isClubInMatch(m, club));
  const results = clubMatches
    .filter((m) => m.state === 'post')
    .slice()
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .map(toCardMatch);
  const now = Date.now() - 3 * 60 * 60 * 1000;
  const program = clubMatches
    .filter((m) => m.state !== 'post' && Date.parse(m.date || 0) >= now)
    .map(toCardMatch);
  const lsTeam = livesportTeamForClub(all, club);
  const squad = lsTeam ? await getSquad(lsTeam.id, lsTeam.slug) : { groups: [], coach: null };
  return { club, row, standings, results, program, squad };
}

function findListedMatch(id) {
  const rows = listingCache.data || [];
  return rows.find((m) => m.id === id) || null;
}

function fieldList(rec, key) {
  return Array.from(String(rec || '').matchAll(new RegExp(`${key}÷([^¬]*)`, 'g'))).map((x) => x[1]);
}

function parseIncidents(feed) {
  const events = [];
  const scorers = { home: [], away: [] };
  const records = String(feed || '').split('~');
  let period = '';
  for (const rec of records) {
    const f = parseFields(rec);
    if (f.AC && !f.III && !f.IA) {
      period = f.AC;
      continue;
    }
    if (!f.IA && !f.III) continue;
    const side = String(f.IA) === '2' ? 'away' : 'home';
    const minute = String(f.IB || '').trim();
    const labels = fieldList(rec, 'IK');
    const players = fieldList(rec, 'IF');
    const score =
      f.INX != null && f.IOX != null && f.INX !== '' && f.IOX !== '' ? `${f.INX}:${f.IOX}` : '';
    const goalIdx = labels.findIndex((l) => /g[oó]l/i.test(l));
    if (goalIdx >= 0) {
      const player = (players[goalIdx] || players[0] || '').trim();
      const item = { side, kind: 'goal', label: 'Gól', minute, player, period, score };
      events.push(item);
      if (player) scorers[side].push({ player, minute, score });
      continue;
    }
    const label = String(labels[0] || f.IK || '').trim();
    const player = String(players[0] || f.IF || '').trim();
    const kind = /červen/i.test(label)
      ? 'red'
      : /žlut/i.test(label)
        ? 'yellow'
        : /stříd/i.test(label)
          ? 'sub'
          : 'other';
    if (kind === 'other' || /asist/i.test(label)) continue;
    events.push({ side, kind, label: label || 'Událost', minute, player, period, score });
  }
  return { events, scorers };
}

function parseSummary(feed) {
  const f = parseFields(feed);
  const out = { referee: '', venue: '', city: '', attendance: '', tv: '' };
  const pairs = [];
  const re = /MIT÷([^¬]*)¬MIV÷([^¬]*)/g;
  let m;
  const src = String(feed || '');
  while ((m = re.exec(src))) pairs.push([m[1], m[2]]);
  for (const [k, v] of pairs) {
    if (k === 'REF') out.referee = v;
    if (k === 'VEN') out.venue = v;
    if (k === 'TWN') out.city = v;
    if (k === 'ATT') out.attendance = v;
  }
  if (f.TA) out.tv = f.TA;
  if (f.TVT) out.tv = f.TVT;
  return out;
}

function parseTopStats(feed) {
  const stats = [];
  const src = String(feed || '');
  const chunks = src.split(/~?SE÷/);
  const matchChunk = chunks.find((c) => /^Zápas\b/i.test(c.trim())) || chunks[0] || src;
  const re = /SG÷([^¬]+)¬SH÷([^¬]*)¬SI÷([^¬]*)/g;
  let m;
  while ((m = re.exec(matchChunk))) {
    const label = m[1].trim();
    if (!label) continue;
    if (/kurz|odds|1\s*x\s*2|tipsport|betano|sázk|sazk/i.test(label)) continue;
    stats.push({ label, home: m[2].trim(), away: m[3].trim() });
    if (stats.length >= 8) break;
  }
  return stats;
}

function parseLineups(payload) {
  const participants = payload?.data?.findEventById?.eventParticipants;
  if (!Array.isArray(participants)) return { home: null, away: null };
  const result = { home: null, away: null };
  for (const p of participants) {
    const side = String(p?.type?.side || '').toLowerCase() === 'away' ? 'away' : 'home';
    const lu = p?.lineup;
    if (!lu) {
      result[side] = { name: p?.name || '', formation: '', starters: [], bench: [], coach: '' };
      continue;
    }
    const byId = new Map((lu.players || []).map((pl) => [pl.id, pl]));
    const groups = Array.isArray(lu.groups) ? lu.groups : [];
    const starterIds = groups.find((g) => g.groupType === 'STARTERS')?.playerIds || [];
    const benchIds =
      groups.find((g) => g.groupType === 'SUBSTITUTES' || g.groupType === 'BENCH')?.playerIds || [];
    const mapPlayer = (id) => {
      const pl = byId.get(id);
      if (!pl) return null;
      return {
        id,
        name: pl.listName || pl.fieldName || '',
        number: pl.number || '',
        role: (pl.playerRoles && pl.playerRoles[0] && pl.playerRoles[0].title) || '',
      };
    };
    const coach = lu.coaches?.players?.[0]?.listName || lu.coaches?.players?.[0]?.name || '';
    result[side] = {
      name: p?.name || '',
      formation: lu.formation?.name || '',
      starters: starterIds.map(mapPlayer).filter(Boolean),
      bench: benchIds.map(mapPlayer).filter(Boolean),
      coach,
    };
  }
  return result;
}

async function fetchDetailFeeds(id) {
  const headers = {
    'X-Fsign': FSIGN,
    'X-Requested-With': 'XMLHttpRequest',
  };
  const q = (hash, extra = {}) => {
    const params = new URLSearchParams({ _hash: hash, eventId: id, projectId: PROJECT_ID, ...extra });
    return params.toString();
  };
  const [incidents, summary, stats, lineups] = await Promise.all([
    fetchText(`${FEED_BASE}df_sui_1_${id}`, { headers }).catch(() => ''),
    fetchText(`${FEED_BASE}df_sur_1_${id}`, { headers }).catch(() => ''),
    fetchText(`${FEED_BASE}df_st_1_${id}`, { headers }).catch(() => ''),
    fetchJson(`${GQL_MAIN}?${q('dlie2')}`, {
      headers: { Accept: 'application/json', Origin: 'https://www.livesport.cz' },
    }).catch(() => null),
  ]);
  return { incidents, summary, stats, lineups };
}

async function getMatchDetail(slugOrId) {
  const id = eventIdFromSlug(slugOrId);
  if (!id) return null;
  const now = Date.now();
  const cached = detailCache.get(id);
  if (cached && now < cached.expiresAt) return cached.data;

  let listed = findListedMatch(id);
  if (!listed) {
    try {
      const all = await listAllMatches();
      listed = all.find((m) => m.id === id) || null;
    } catch {
      listed = null;
    }
  }

  const feeds = await fetchDetailFeeds(id);
  const { events, scorers } = parseIncidents(feeds.incidents);
  const info = parseSummary(feeds.summary || feeds.incidents);
  const stats = parseTopStats(feeds.stats);
  const lineups = parseLineups(feeds.lineups);

  if (!listed && !lineups.home && !lineups.away && !events.length) return null;

  const homeName = listed?.home || lineups.home?.name || 'Domácí';
  const awayName = listed?.away || lineups.away?.name || 'Hosté';
  const iso = listed?.date || null;
  const state = listed?.state || (events.length ? 'post' : 'pre');
  const score = listed
    ? displayScore(listed.homeScore, listed.awayScore, state)
    : scorers.home.length || scorers.away.length
      ? `${scorers.home.length}:${scorers.away.length}`
      : '0:0';

  const data = {
    id,
    slug: listed ? matchSlug(listed) : id,
    href: listed ? detailPath(listed) : `/zapasy/chance/${id}`,
    home: homeName,
    away: awayName,
    homeLogo: listed?.homeLogo || '',
    awayLogo: listed?.awayLogo || '',
    league: 'Chance Liga',
    round: listed?.round || '',
    date: iso,
    kickoff: iso,
    state,
    isLive: state === 'in',
    isDone: state === 'post',
    score,
    scoreHome: splitScore(score).home,
    scoreAway: splitScore(score).away,
    scoreLine: state === 'pre' ? statusLabel(state, iso) : splitScore(score).line,
    statusLabel: statusLabel(state, iso),
    venue: info.venue,
    city: info.city,
    referee: info.referee,
    attendance: info.attendance,
    tv: info.tv,
    events,
    scorers,
    stats,
    lineups,
    source: 'Livesport',
  };
  const withCrests = chanceLigaLogos.withLogos(data);
  detailCache.set(id, { expiresAt: now + DETAIL_TTL_MS, data: withCrests });
  return withCrests;
}

function namesMatch(a, b) {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  return fa.includes(fb) || fb.includes(fa);
}

function attachLivesport(cardMatches, livesportRows) {
  return (cardMatches || []).map((m) => {
    const ts = Date.parse(m.date || m.kickoff || '');
    const hit = (livesportRows || []).find((ls) => {
      if (!namesMatch(m.home, ls.home) || !namesMatch(m.away, ls.away)) return false;
      if (!Number.isFinite(ts) || !ls.date) return true;
      return Math.abs(ts - Date.parse(ls.date)) < 36 * 60 * 60 * 1000;
    });
    if (!hit) {
      return chanceLigaLogos.withLogos({
        ...m,
        score: m.isLive || m.isDone ? m.score || '0:0' : '0:0',
        detailHref: m.detailHref && String(m.detailHref).startsWith('/') ? m.detailHref : '',
      });
    }
    return chanceLigaLogos.withLogos({
      ...m,
      ...toCardMatch({ ...hit, homeLogo: m.homeLogo || hit.homeLogo, awayLogo: m.awayLogo || hit.awayLogo }),
      home: m.home || hit.home,
      away: m.away || hit.away,
    });
  });
}

module.exports = {
  listAllMatches,
  listNarodniLiga,
  listCzechNational,
  listUpcoming,
  listResults,
  listPickerMatches,
  getMatchesHub,
  getMatchesAgenda,
  listSameRound,
  getStandings,
  getClubProfile,
  getMatchDetail,
  attachLivesport,
  eventIdFromSlug,
  matchSlug,
  detailPath,
  pragueDayKey,
  formatDayNavLabel,
};

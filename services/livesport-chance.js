const { slugify } = require('../lib/slug');
const chanceLigaLogos = require('./chance-liga-logos');
const clubCrests = require('../lib/club-crests');
const { chancePlayerPhoto } = require('../lib/player-photos');

const LISTING_URL = 'https://www.livesport.cz/fotbal/cesko/chance-liga/';
const NARODNI_URL = 'https://www.livesport.cz/fotbal/cesko/chance-narodni-liga/';
const MOL_CUP_URL = 'https://www.livesport.cz/fotbal/cesko/mol-cup/';
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
let molCupCache = { expiresAt: 0, data: null };
let czechNtCache = { expiresAt: 0, data: null };
const detailCache = new Map();
const squadCache = new Map();

const EUROPE_COMPS = [
  {
    id: 'liga-mistru',
    label: 'Liga mistrů',
    url: 'https://www.livesport.cz/fotbal/evropa/liga-mistru/',
  },
  {
    id: 'evropska-liga',
    label: 'Evropská liga',
    url: 'https://www.livesport.cz/fotbal/evropa/evropska-liga/',
  },
  {
    id: 'konferencni-liga',
    label: 'Konferenční liga',
    url: 'https://www.livesport.cz/fotbal/evropa/konferencni-liga/',
  },
];
const europeCaches = Object.fromEntries(
  EUROPE_COMPS.map((comp) => [comp.id, { expiresAt: 0, data: null }])
);

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

function matchKeyPrefix(league) {
  const n = foldName(league);
  if (n.includes('narodni')) return 'narodni';
  if (n.includes('mol')) return 'mol';
  if (n.includes('reprezent') || n.includes('liga narodu')) return 'repre';
  if (n.includes('mistr')) return 'ucl';
  if (n.includes('konferenc')) return 'ecl';
  if (n.includes('evropsk')) return 'el';
  return 'chance';
}

function isEuropeanLeague(league) {
  const prefix = matchKeyPrefix(league);
  return prefix === 'ucl' || prefix === 'el' || prefix === 'ecl';
}

function normalizeLeagueName(name, fallback = '') {
  const raw = String(name || '').trim();
  const n = foldName(raw);
  if (n.includes('chance') && n.includes('narodni')) return 'Chance Národní liga';
  if (n.includes('chance') && n.includes('liga')) return 'Chance Liga';
  if (n.includes('mol')) return 'MOL Cup';
  if (n.includes('konferenc')) return 'Konferenční liga';
  if (n.includes('mistr')) return 'Liga mistrů';
  if (n.includes('evropsk')) return 'Evropská liga';
  if (n.includes('reprezent')) return 'Česká reprezentace';
  return raw || fallback;
}

function parseTournamentZa(za, fallback) {
  const raw = String(za || '').trim();
  if (!raw) return { league: fallback, stage: '' };
  const after = raw.includes(':') ? raw.split(':').slice(1).join(':').trim() : raw;
  const parts = after.split(/\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
  const league = normalizeLeagueName(parts[0] || raw, fallback);
  const stage = parts.slice(1).join(' · ');
  return { league, stage };
}

function isCzechClubName(name) {
  if (chanceLigaLogos.matchTeam(name)) return true;
  const n = foldName(name);
  return /\b(sparta|slavia|plzen|viktoria|banik|ostrava|jablonec|liberec|olomouc|sigma|hradec|teplice|slovacko|pardubice|zlin|bohemians|boleslav|zbrojovka|artis|lisen)\b/.test(
    n
  );
}

function isCzechInvolved(match) {
  return isCzechClubName(match && match.home) || isCzechClubName(match && match.away);
}

function sortCzechFirst(cards) {
  return (cards || [])
    .slice()
    .sort((a, b) => {
      const ac = isCzechInvolved(a) ? 0 : 1;
      const bc = isCzechInvolved(b) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (Date.parse(a.date || 0) || 0) - (Date.parse(b.date || 0) || 0);
    });
}

function rememberRowCrests(row) {
  clubCrests.remember({
    id: row.homeTeamId || row.homeParticipantId,
    slug: row.homeSlug,
    name: row.home,
    url: row.homeLogo,
  });
  clubCrests.remember({
    id: row.awayTeamId || row.awayParticipantId,
    slug: row.awaySlug,
    name: row.away,
    url: row.awayLogo,
  });
}

function decorateMatch(match) {
  return chanceLigaLogos.withLogos(clubCrests.apply(match));
}

function windowedCards(cards, limit = 16) {
  const pastN = Math.max(10, Number(limit) || 16);
  const futureN = Math.max(10, Number(limit) || 16);
  const now = Date.now();
  const cutoff = now - 3 * 60 * 60 * 1000;
  const sorted = (cards || [])
    .slice()
    .sort((a, b) => (Date.parse(a.date || 0) || 0) - (Date.parse(b.date || 0) || 0));
  const past = sorted.filter((m) => {
    if (m.isLive) return false;
    const ts = Date.parse(m.date);
    return m.isDone || (Number.isFinite(ts) && ts < cutoff);
  }).slice(-pastN);
  const liveFuture = sorted.filter((m) => {
    if (m.isLive) return true;
    if (m.isDone) return false;
    const ts = Date.parse(m.date);
    return Number.isFinite(ts) && ts >= cutoff;
  }).slice(0, futureN);
  const seen = new Set();
  const out = [];
  for (const m of past.concat(liveFuture)) {
    const key = m.id || `${m.home}|${m.away}|${m.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

async function listEuropeRaw() {
  const packs = await Promise.all(
    EUROPE_COMPS.map(async (comp) => {
      const rows = await loadCompetition(comp.url, europeCaches[comp.id], {
        requireRound: false,
        league: comp.label,
      }).catch(() => []);
      return { ...comp, rows: rows || [] };
    })
  );
  return packs;
}

async function listEuropeLeagues(limit = 36) {
  const packs = await listEuropeRaw();
  return packs
    .map((pack) => ({
      id: pack.id,
      label: pack.label,
      matches: sortCzechFirst(windowedCards((pack.rows || []).map(toCardMatch), limit)),
    }))
    .filter((league) => league.matches && league.matches.length);
}

async function listBoardLeagues(limit = 16) {
  const [chance, narodni, mol, europe] = await Promise.all([
    listAllMatches().then((rows) => windowedCards(rows.map(toCardMatch), limit)).catch(() => []),
    listNarodniLiga().then((cards) => windowedCards(cards, limit)).catch(() => []),
    listMolCup().then((cards) => windowedCards(cards, limit)).catch(() => []),
    listEuropeLeagues(Math.max(24, Number(limit) || 16)).catch(() => []),
  ]);
  return [
    { id: 'chance-liga', label: 'Chance Liga', matches: chance },
    { id: 'chance-narodni', label: 'Chance Národní liga', matches: narodni },
    { id: 'mol-cup', label: 'MOL Cup', matches: mol },
    ...europe,
  ].filter((league) => league.matches && league.matches.length);
}

const LIVE_AB = new Set(['2', '6', '7', '12', '13', '14', '15', '16']);
const POST_AB = new Set(['3', '4', '5', '9', '36', '37', '43', '54']);

function statusFromAb(ab, kickoffIso) {
  const code = String(ab || '').trim();
  if (LIVE_AB.has(code)) return 'in';
  if (POST_AB.has(code)) return 'post';
  const ts = kickoffIso ? Date.parse(kickoffIso) : NaN;
  if (!Number.isFinite(ts)) return 'pre';
  const age = Date.now() - ts;
  if (age >= 0 && age < 3.25 * 60 * 60 * 1000) return 'in';
  if (age >= 3.25 * 60 * 60 * 1000) return 'post';
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
  const out = [];
  const seen = new Set();
  let currentLeague = league;
  let currentStage = '';
  for (const rec of src.split('~')) {
    const fields = parseFields(rec);
    if (fields.ZA) {
      const parsed = parseTournamentZa(fields.ZA, league);
      currentLeague = parsed.league || currentLeague;
      currentStage = parsed.stage || '';
      continue;
    }
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
    const row = {
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
      stage: currentStage,
      date: iso,
      kickoff: iso,
      state,
      score,
      homeScore: fields.AG != null && fields.AG !== '' ? Number(fields.AG) : state === 'pre' ? 0 : null,
      awayScore: fields.AH != null && fields.AH !== '' ? Number(fields.AH) : state === 'pre' ? 0 : null,
      league: currentLeague || league,
    };
    rememberRowCrests(row);
    out.push(row);
  }
  return out.sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
}

function listingUrls(baseUrl) {
  const base = String(baseUrl || '').replace(/\/?$/, '/');
  return [base, `${base}vysledky/`, `${base}program/`];
}

function stateRank(state) {
  if (state === 'post') return 3;
  if (state === 'in') return 2;
  return 1;
}

function preferMatchRow(prev, next) {
  if (!prev) return next;
  const prevRank = stateRank(prev.state);
  const nextRank = stateRank(next.state);
  if (nextRank !== prevRank) return nextRank > prevRank ? next : prev;
  const prevHas = prev.homeScore != null && prev.awayScore != null;
  const nextHas = next.homeScore != null && next.awayScore != null;
  if (nextHas && !prevHas) return next;
  return prev;
}

async function loadCompetition(baseUrl, cache, opts) {
  const now = Date.now();
  if (cache.data && now < cache.expiresAt) return cache.data;
  const pages = await Promise.all(listingUrls(baseUrl).map((url) => fetchText(url).catch(() => '')));
  const byId = new Map();
  for (const html of pages) {
    for (const row of parseListingEvents(html, opts)) {
      byId.set(row.id, preferMatchRow(byId.get(row.id), row));
    }
  }
  const rows = Array.from(byId.values()).sort(
    (a, b) => (Date.parse(a.date || 0) || 0) - (Date.parse(b.date || 0) || 0)
  );
  cache.data = rows;
  cache.expiresAt = now + (rows.some((row) => row.state === 'in') ? 20 * 1000 : LISTING_TTL_MS);
  return rows;
}

async function listAllMatches() {
  return loadCompetition(LISTING_URL, listingCache, { requireRound: true, league: 'Chance Liga' });
}

async function listNarodniLiga() {
  const rows = await loadCompetition(NARODNI_URL, narodniCache, {
    requireRound: true,
    league: 'Chance Národní liga',
  });
  return rows.map((row) => toCardMatch(row));
}

async function listMolCup() {
  const rows = await loadCompetition(MOL_CUP_URL, molCupCache, {
    requireRound: false,
    league: 'MOL Cup',
  });
  return rows.map((row) => toCardMatch(row));
}

async function listCzechNational() {
  const now = Date.now();
  if (czechNtCache.data && now < czechNtCache.expiresAt) return czechNtCache.data;
  const html = await fetchText(CZECH_NT_URL);
  const rows = parseListingEvents(html, { requireRound: false, league: 'Česká reprezentace' });
  const mapped = rows.map((row) => ({
    ...toCardMatch(row),
    homeHref: '',
    awayHref: '',
  }));
  czechNtCache = { expiresAt: now + LISTING_TTL_MS, data: mapped, rows };
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
  return decorateMatch({
    id: row.id,
    home: row.home,
    away: row.away,
    homeLogo: row.homeLogo || '',
    awayLogo: row.awayLogo || '',
    homeLogoFile: row.homeLogoFile || '',
    awayLogoFile: row.awayLogoFile || '',
    homeInitials: (row.homeAbbr || row.home || '?').slice(0, 3).toUpperCase(),
    awayInitials: (row.awayAbbr || row.away || '?').slice(0, 3).toUpperCase(),
    date: row.date,
    kickoff: row.kickoff || row.date,
    time,
    state,
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
    stage: row.stage || '',
    meta: formatCardMeta(row),
    detailHref: detailPath(row),
    matchKey: `${matchKeyPrefix(row.league)}:${matchSlug(row)}`,
    livesportId: row.id,
    homeTeamId: row.homeTeamId || '',
    awayTeamId: row.awayTeamId || '',
    homeSlug: row.homeSlug || '',
    awaySlug: row.awaySlug || '',
  });
}

async function listPickerMatches(limit = 80) {
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(160, Number(limit))) : 80;
  const [chance, narodni, mol, repre, europe] = await Promise.all([
    listAllMatches().then((rows) => rows.map(toCardMatch)).catch(() => []),
    listNarodniLiga().catch(() => []),
    listMolCup().catch(() => []),
    listCzechNational().catch(() => []),
    listEuropeLeagues(40).then((leagues) => leagues.flatMap((l) => l.matches || [])).catch(() => []),
  ]);
  const czechEurope = europe.filter(isCzechInvolved);
  return chance
    .concat(narodni, mol, repre, czechEurope)
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, lim);
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
  const past = keys.filter((d) => d < today).slice(-14);
  const future = keys.filter((d) => d >= today).slice(0, 14);
  const keep = past.concat(future.length ? future : keys.slice(-4));
  const keepSet = new Set(keep);
  keepSet.add(today);
  return {
    today,
    liveCount: all.filter((m) => m.isLive).length,
    matches: all.filter((m) => m.isLive || keepSet.has(m.dayKey)),
  };
}

async function listSameRound(round, excludeId, league) {
  const key = String(round || '').trim();
  if (!key) return [];
  const prefix = matchKeyPrefix(league);
  let source = [];
  try {
    if (prefix === 'narodni') {
      source = await loadCompetition(NARODNI_URL, narodniCache, {
        requireRound: true,
        league: 'Chance Národní liga',
      });
    } else if (prefix === 'mol') {
      source = await loadCompetition(MOL_CUP_URL, molCupCache, {
        requireRound: false,
        league: 'MOL Cup',
      });
    } else if (prefix === 'ucl' || prefix === 'el' || prefix === 'ecl') {
      const packs = await listEuropeRaw();
      const pack = packs.find((item) => matchKeyPrefix(item.label) === prefix);
      source = pack ? pack.rows : [];
    } else {
      source = await listAllMatches();
    }
  } catch {
    source = [];
  }
  return sortCzechFirst(
    source.filter((m) => m.round === key && m.id !== excludeId).map(toCardMatch)
  );
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

const NAME_PARTICLE = /^(van|von|de|der|den|di|da|la|le|del|du|ter|ten|tot|te)$/i;

function flipPersonName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const particleAt = parts.findIndex((p) => NAME_PARTICLE.test(p));
  if (particleAt === 0 && parts.length >= 3) {
    return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`;
  }
  if (particleAt > 0) return name;
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

function squadPhoto(id, name, teamName) {
  const photo = chancePlayerPhoto(id, name, teamName);
  if (photo) return photo;
  if (id) return `/players/${encodeURIComponent(id)}.jpg`;
  return '';
}

function parseSquadHtml(html, teamName) {
  const src = String(html || '');
  const startOverall = src.indexOf('id="overall-all-table"');
  const startLeague = src.indexOf(`id="league-${CHANCE_TOURNAMENT_ID}-table"`);
  const start = startOverall >= 0 ? startOverall : startLeague;
  if (start < 0) return { groups: [], coach: null };
  const rest = src.slice(start);
  const nextTable = rest.search(/id="(?!overall-all-table|league-b56zL2iK-table)[^"]*table"/);
  const block = nextTable > 0 ? rest.slice(0, nextTable) : rest.slice(0, 90000);
  const groups = [];
  let coach = null;
  const seenTitles = new Set();
  const titleRe = /<div class="lineupTable__title">([^<]+)<\/div>([\s\S]*?)(?=<div class="lineupTable__title">|$)/g;
  let titleMatch;
  while ((titleMatch = titleRe.exec(block))) {
    const title = titleMatch[1].trim();
    if (seenTitles.has(title) && !isCoachTitle(title)) break;
    seenTitles.add(title);
    const chunk = titleMatch[2];
    const players = [];
    const rowRe = /<div class="lineupTable__row">([\s\S]*?)(?=<div class="lineupTable__row">|$)/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(chunk))) {
      const row = rowMatch[1];
      const hrefMatch = row.match(/href="\/hrac\/([^/]+)\/([A-Za-z0-9]+)\//);
      const nameRaw = (row.match(/lineupTable__cell--name"[^>]*>\s*([^<]+)/) || [])[1];
      const name = flipPersonName(nameRaw);
      if (!name) continue;
      const id = hrefMatch ? hrefMatch[2] : '';
      const jersey = cellText(row, 'jersey');
      const nation = ((row.match(/lineupTable__cell--flag[^>]*title="([^"]+)"/) || [])[1] || '').trim();
      const player = {
        id,
        name,
        jersey: /^\d+$/.test(jersey) ? jersey : '',
        age: cellText(row, 'age'),
        played: cellText(row, 'matchesPlayed'),
        minutes: cellText(row, 'minutesPlayed'),
        goals: cellText(row, 'goal'),
        assists: cellText(row, 'assist'),
        nation,
        photo: squadPhoto(id, name, teamName),
        out: /Mimo soupisku/i.test(row),
      };
      if (isCoachTitle(title)) {
        if (!coach) coach = { id, name, age: player.age, nation, photo: player.photo };
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

async function getSquad(teamId, teamSlug, teamName) {
  const id = String(teamId || '').trim();
  const slug = String(teamSlug || '').trim();
  if (!id || !slug) return { groups: [], coach: null };
  const now = Date.now();
  const cacheKey = `${id}:p2`;
  const cached = squadCache.get(cacheKey);
  if (cached && now < cached.expiresAt) return cached.data;
  const url = `https://www.livesport.cz/tym/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/soupiska/`;
  let html = '';
  try {
    html = await fetchText(url);
  } catch {
    html = '';
  }
  const data = parseSquadHtml(html, teamName);
  squadCache.set(cacheKey, { expiresAt: now + SQUAD_TTL_MS, data });
  return data;
}

function isSideTeamName(name) {
  return /\b(B|C|U1[679]|U21|ženy|zeny|women)\b/i.test(String(name || '')) || /[Žž]\s*$/.test(String(name || '').trim());
}

function clubForSquadName(teamName) {
  const club = chanceLigaLogos.matchTeam(teamName);
  if (!club) return null;
  const folded = chanceLigaLogos.foldName(teamName);
  const aliases = [club.name, club.short, ...(club.aliases || [])]
    .map((item) => chanceLigaLogos.foldName(item))
    .filter(Boolean);
  return aliases.includes(folded) ? club : null;
}

function findLivesportTeam(matches, teamName) {
  const folded = chanceLigaLogos.foldName(teamName);
  if (!folded) return null;
  if (!isSideTeamName(teamName)) {
    const club = clubForSquadName(teamName);
    if (club) {
      const mapped = livesportTeamForClub(matches, club);
      if (mapped) return mapped;
    }
  }
  let best = null;
  let bestScore = 0;
  for (const match of matches || []) {
    const sides = [
      { name: match.home, id: match.homeTeamId, slug: match.homeSlug },
      { name: match.away, id: match.awayTeamId, slug: match.awaySlug },
    ];
    for (const side of sides) {
      if (!side.id || !side.name) continue;
      if (isSideTeamName(teamName) !== isSideTeamName(side.name)) continue;
      const other = chanceLigaLogos.foldName(side.name);
      if (!other) continue;
      if (other === folded && 100 > bestScore) {
        bestScore = 100;
        best = { id: side.id, slug: side.slug || slugify(side.name), name: side.name };
      }
    }
  }
  return bestScore >= 100 ? best : null;
}

async function getSquadForTeamName(teamName) {
  const name = String(teamName || '').trim();
  if (!name) return { groups: [], coach: null };
  let chance = [];
  let narodni = [];
  try {
    [chance, narodni] = await Promise.all([listAllMatches(), listNarodniLiga()]);
  } catch {
    chance = [];
    narodni = [];
  }
  const ls = findLivesportTeam([].concat(chance || [], narodni || []), name);
  if (!ls) return { groups: [], coach: null };
  return getSquad(ls.id, ls.slug, name);
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
  const squad = lsTeam ? await getSquad(lsTeam.id, lsTeam.slug, club.name) : { groups: [], coach: null };
  let europeRows = [];
  try {
    const packs = await listEuropeRaw();
    europeRows = packs.flatMap((pack) => pack.rows || []).filter((m) => isClubInMatch(m, club));
  } catch {
    europeRows = [];
  }
  const europeCards = europeRows.map(toCardMatch);
  const mergedResults = results
    .concat(europeCards.filter((m) => m.isDone))
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));
  const mergedProgram = program
    .concat(europeCards.filter((m) => !m.isDone))
    .sort((a, b) => (Date.parse(a.date || 0) || 0) - (Date.parse(b.date || 0) || 0));
  const seen = new Set();
  const uniq = (arr) =>
    arr.filter((m) => {
      const key = m.id || `${m.home}|${m.away}|${m.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    club,
    row,
    standings,
    results: uniq(mergedResults),
    program: uniq(mergedProgram),
    squad,
  };
}

function findListedMatch(id) {
  const pools = [
    listingCache.data,
    narodniCache.data,
    molCupCache.data,
    czechNtCache.rows,
    czechNtCache.data,
    ...Object.values(europeCaches).map((cache) => cache.data),
  ];
  for (const rows of pools) {
    const hit = (rows || []).find((m) => m && (m.id === id || m.livesportId === id));
    if (hit) return hit;
  }
  return null;
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
    const blob = labels.join(' ');
    const goalIdx = labels.findIndex((l) => /g[oó]l/i.test(l) && !/neuzn/i.test(l));
    if (goalIdx >= 0) {
      const player = (players[goalIdx] || players[0] || '').trim();
      const assistIdx = labels.findIndex((l) => /asist/i.test(l));
      const item = {
        side,
        kind: /vlastní/i.test(blob) ? 'own' : 'goal',
        label: /penalt/i.test(blob) ? 'Penalta' : /vlastní/i.test(blob) ? 'Vlastní gól' : 'Gól',
        minute,
        player,
        period,
        score,
        penalty: /penalt/i.test(blob),
        assist: assistIdx >= 0 ? String(players[assistIdx] || '').trim() : '',
      };
      events.push(item);
      if (player && item.kind === 'goal') scorers[side].push({ player, minute, score });
      if (player && item.kind === 'own') scorers[side].push({ player: `${player} (vl.g.)`, minute, score });
      continue;
    }
    const label = String(labels[0] || f.IK || '').trim();
    const player = String(players[0] || f.IF || '').trim();
    const kind = /var/i.test(blob)
      ? 'var'
      : /červen/i.test(label)
        ? 'red'
        : /žlut/i.test(label)
          ? 'yellow'
          : /stříd/i.test(blob)
            ? 'sub'
            : /asist/i.test(label)
              ? 'assist'
              : 'other';
    if (kind === 'other') continue;
    if (kind === 'assist' && events.length) {
      const prev = events[events.length - 1];
      if ((prev.kind === 'goal' || prev.kind === 'own') && prev.side === side) {
        prev.assist = player;
        continue;
      }
    }
    if (kind === 'sub') {
      const outName = String(players[0] || '').trim();
      const inName = String(players[1] || '').trim();
      events.push({
        side,
        kind: 'sub',
        label: 'Střídání',
        minute,
        player: inName || outName,
        playerIn: inName,
        playerOut: outName,
        period,
        score,
      });
      continue;
    }
    events.push({
      side,
      kind,
      label: label || 'Událost',
      minute,
      player,
      period,
      score,
      reason: String(f.IL || f.IJ || labels.slice(1).filter(Boolean).join(', ')).trim(),
    });
  }
  return { events, scorers };
}

function parseSummary(feed) {
  const f = parseFields(feed);
  const out = {
    referee: '',
    venue: '',
    city: '',
    attendance: '',
    tv: '',
    stage: '',
    homeScore: null,
    awayScore: null,
    period: '',
  };
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
  if (f.AC && /^\d+$/.test(String(f.AC).trim())) out.stage = String(f.AC).trim();
  else if (f.AC) out.period = String(f.AC).trim();
  if (f.IG != null && f.IG !== '') out.homeScore = Number(f.IG);
  if (f.IH != null && f.IH !== '') out.awayScore = Number(f.IH);
  return out;
}

function parseLiveScore(feed) {
  const src = String(feed || '');
  const first = src.split('~')[0] || src;
  const f = parseFields(first);
  return {
    home: f.IG != null && f.IG !== '' ? Number(f.IG) : null,
    away: f.IH != null && f.IH !== '' ? Number(f.IH) : null,
    period: f.AC || '',
  };
}

function gqlTeamLogo(participant) {
  const imgs = participant?.participants?.[0]?.participant?.images;
  return lsImage(imgs);
}

function parseTournamentTable(feed) {
  const src = String(feed || '');
  if (!src || src === '0') return [];
  const logoById = Object.create(null);
  let slugById = {};
  const rows = [];
  let current = null;
  const flush = () => {
    if (!current || !current.name) return;
    const gf = Number(current.gf) || 0;
    const ga = Number(current.ga) || 0;
    const gd = gf - ga;
    rows.push({
      ...current,
      gf,
      ga,
      gd,
      goalsLabel: `${gf}:${ga}`,
      gdLabel: gd > 0 ? `+${gd}` : String(gd),
      form: (current.form || []).slice(-5),
      logo: current.logo || logoById[current.teamId] || '',
    });
    current = null;
  };
  for (const rec of src.split('~')) {
    const f = parseFields(rec);
    if (f.IPI && f.IPU) {
      const url = logoUrl(f.IPU);
      logoById[f.IPI] = url;
      clubCrests.remember({ id: f.IPI, file: f.IPU });
    }
    if (f.PIU) {
      try {
        slugById = { ...slugById, ...JSON.parse(f.PIU) };
      } catch {
        /* ignore */
      }
    }
    if (f.TN && f.TI) {
      flush();
      const slug = slugById[f.TI] || String(f.TIU || '').split('/').filter(Boolean)[1] || slugify(f.TN);
      const [gf, ga] = String(f.TG || '0:0').split(':').map((n) => Number(n) || 0);
      current = {
        rank: Number(f.TR) || rows.length + 1,
        code: f.TI,
        teamId: f.TI,
        slug,
        href: (() => {
          const club = chanceLigaLogos.matchTeam(f.TN);
          return club ? `/klub/${club.slug}` : '#';
        })(),
        name: f.TN,
        short: f.TN,
        played: Number(f.TM) || 0,
        won: Number(f.TW) || 0,
        drawn: Number(f.TDR) || 0,
        lost: Number(f.TL) || 0,
        pts: Number(f.TP) || 0,
        gf,
        ga,
        logo: logoById[f.TI] || '',
        form: [],
      };
      clubCrests.remember({ id: f.TI, slug, name: f.TN, url: current.logo });
      continue;
    }
    if (current && f.LMU) {
      const code = String(f.LMU).toLowerCase();
      if (code === 'w') current.form.push('W');
      else if (code === 'd') current.form.push('D');
      else if (code === 'l') current.form.push('L');
    }
  }
  flush();
  return rows.map((row, idx) => ({ ...row, rank: row.rank || idx + 1, logo: row.logo || logoById[row.teamId] || '' }));
}

function leagueFromEuropeTable(tableRows) {
  if (!tableRows || tableRows.length < 8) return '';
  const ids = new Set(tableRows.map((row) => row.teamId).filter(Boolean));
  let best = null;
  let bestN = 0;
  for (const comp of EUROPE_COMPS) {
    const rows = europeCaches[comp.id] && europeCaches[comp.id].data;
    if (!rows || !rows.length) continue;
    let n = 0;
    for (const row of rows) {
      if (ids.has(row.homeTeamId) || ids.has(row.awayTeamId)) n += 1;
    }
    if (n > bestN) {
      bestN = n;
      best = comp.label;
    }
  }
  if (best && bestN >= 4) return best;
  if (tableRows.length >= 30) return 'Evropská liga';
  return '';
}

function inferLeague(listed, home, away, tableRows) {
  const listedLeague = listed && listed.league ? String(listed.league).trim() : '';
  const homeClub = chanceLigaLogos.matchTeam(home);
  const awayClub = chanceLigaLogos.matchTeam(away);
  const bothChance = Boolean(homeClub && awayClub);
  if (listedLeague) {
    const misleadingChance =
      /chance liga/i.test(listedLeague) && !/narodni/i.test(listedLeague) && !bothChance;
    if (!misleadingChance) return listedLeague;
  }
  const fromTable = leagueFromEuropeTable(tableRows);
  if (fromTable) return fromTable;
  if (bothChance) return 'Chance Liga';
  return '';
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

function lsImage(images) {
  const list = Array.isArray(images) ? images : [];
  const hit = list.find((img) => img && img.path) || null;
  const path = hit && hit.path ? String(hit.path) : '';
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return LOGO_BASE + path.replace(/^\//, '');
}

function playerBadges(incidents) {
  const badges = { goals: 0, yellow: 0, red: 0, assist: 0, subIn: false, subOut: false };
  for (const inc of incidents || []) {
    const t = String(inc && inc.__typename ? inc.__typename : '');
    if (/Yellow/i.test(t)) badges.yellow += 1;
    else if (/Red/i.test(t)) badges.red += 1;
    else if (/OwnGoal/i.test(t)) badges.goals += 1;
    else if (/Goal/i.test(t) && !/Assist/i.test(t)) badges.goals += 1;
    else if (/Assist/i.test(t)) badges.assist += 1;
    else if (/SubstitutionIn|SubIn/i.test(t)) badges.subIn = true;
    else if (/SubstitutionOut|SubOut|Substitution/i.test(t)) badges.subOut = true;
  }
  return badges;
}

function mapLineupPlayer(pl, teamName) {
  if (!pl) return null;
  const ratingVal = pl.rating && pl.rating.value != null ? String(pl.rating.value) : '';
  const ratingNum = parseFloat(ratingVal);
  const role = (pl.playerRoles && pl.playerRoles[0]) || {};
  const name = pl.listName || pl.fieldName || '';
  return {
    id: pl.id,
    name,
    short: pl.fieldName || (pl.listName || '').split(' ')[0] || '',
    number: pl.number || '',
    role: role.title || '',
    suffix: role.suffix || '',
    isCaptain: /kapitán|\(C\)/i.test(`${role.title || ''} ${role.suffix || ''}`),
    photo:
      chancePlayerPhoto(pl.id, name, teamName) ||
      lsImage(pl.images) ||
      `/players/${encodeURIComponent(pl.id)}.png`,
    rating: Number.isFinite(ratingNum) ? ratingVal : '',
    isBest: Boolean(pl.rating && pl.rating.isBest),
    badges: playerBadges(pl.incidents),
  };
}

function pitchRowTops(count) {
  if (count <= 1) return [50];
  if (count === 2) return [31, 69];
  if (count === 3) return [17, 50, 83];
  if (count === 4) return [12, 34, 66, 88];
  if (count === 5) return [10, 27, 50, 73, 90];
  const pad = 10;
  return Array.from({ length: count }, (_, i) => pad + (i / (count - 1)) * (100 - pad * 2));
}

function pitchRowAdvance(count, index) {
  if (count === 4 && (index === 0 || index === 3)) return 2.8;
  if (count === 3 && index === 1) return -1.4;
  if (count === 3) return 1.6;
  if (count === 5 && (index === 0 || index === 4)) return 5.4;
  if (count === 5 && index === 2) return -0.8;
  if (count === 2) return 0.9;
  return 0;
}

function pitchLineX(rowIndex, rowCount) {
  if (rowCount <= 1) return 24;
  if (rowIndex === 0) return 7.2;
  const u = (rowIndex - 1) / Math.max(rowCount - 2, 1);
  const eased = 1 - (1 - u) ** 1.2;
  return 18.2 + eased * 26.2;
}

function pitchPlayers(formation, byId, side) {
  const rows = (formation && formation.lines && formation.lines[0] && formation.lines[0].rows) || [];
  const ordered = rows.slice().sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
  if (!ordered.length) return [];
  const home = side !== 'away';
  const n = ordered.length;
  const out = [];
  ordered.forEach((row, ri) => {
    const ids = row.playerIds || [];
    const tops = pitchRowTops(ids.length);
    const baseX = pitchLineX(ri, n);
    ids.forEach((id, pi) => {
      const p = byId.get(id);
      if (!p) return;
      const x = baseX + pitchRowAdvance(ids.length, pi);
      out.push({
        ...p,
        left: Math.round((home ? x : 100 - x) * 10) / 10,
        top: Math.round(tops[pi] * 10) / 10,
        side,
      });
    });
  });
  return out;
}

function parseLineups(payload) {
  const participants = payload?.data?.findEventById?.eventParticipants;
  if (!Array.isArray(participants)) return { home: null, away: null };
  const result = { home: null, away: null };
  for (const p of participants) {
    const side = String(p?.type?.side || '').toLowerCase() === 'away' ? 'away' : 'home';
    const lu = p?.lineup;
    if (!lu) {
      result[side] = {
        name: p?.name || '',
        logo: gqlTeamLogo(p),
        formation: '',
        rating: '',
        starters: [],
        bench: [],
        pitch: [],
        substitutions: [],
        coach: '',
      };
      continue;
    }
    const mapped = new Map((lu.players || []).map((pl) => [pl.id, mapLineupPlayer(pl, p?.name)]));
    const groups = Array.isArray(lu.groups) ? lu.groups : [];
    const starterIds = groups.find((g) => g.groupType === 'STARTERS')?.playerIds || [];
    const benchIds =
      groups.find((g) => g.groupType === 'SUBSTITUTES' || g.groupType === 'BENCH')?.playerIds || [];
    const coach = lu.coaches?.players?.[0]?.listName || lu.coaches?.players?.[0]?.name || '';
    const avg = p.averageRating != null ? String(p.averageRating) : '';
    const substitutions = (lu.usedSubstitutions || [])
      .map((s) => {
        const inn = mapped.get(s.playerId);
        const out = mapped.get(s.playerOutId);
        if (!inn && !out) return null;
        if (inn && inn.badges) inn.badges.subIn = true;
        if (out && out.badges) out.badges.subOut = true;
        return {
          minute: s.minute || '',
          in: inn || null,
          out: out || null,
        };
      })
      .filter(Boolean);
    result[side] = {
      name: p?.name || '',
      logo: gqlTeamLogo(p),
      formation: lu.formation?.name || '',
      rating: avg,
      starters: starterIds.map((id) => mapped.get(id)).filter(Boolean),
      bench: benchIds.map((id) => mapped.get(id)).filter(Boolean),
      pitch: pitchPlayers(lu.formation, mapped, side),
      substitutions,
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
  const [incidents, summary, stats, lineups, table] = await Promise.all([
    fetchText(`${FEED_BASE}df_sui_1_${id}`, { headers }).catch(() => ''),
    fetchText(`${FEED_BASE}df_sur_1_${id}`, { headers }).catch(() => ''),
    fetchText(`${FEED_BASE}df_st_1_${id}`, { headers }).catch(() => ''),
    fetchJson(`${GQL_MAIN}?${q('dlie2')}`, {
      headers: { Accept: 'application/json', Origin: 'https://www.livesport.cz' },
    }).catch(() => null),
    fetchText(`${FEED_BASE}df_to_1_${id}`, { headers }).catch(() => ''),
  ]);
  return { incidents, summary, stats, lineups, table };
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
      const pools = await Promise.all([
        listAllMatches().catch(() => []),
        listNarodniLiga().catch(() => []),
        listMolCup().catch(() => []),
        listEuropeRaw().catch(() => []),
      ]);
      const rows = pools.flatMap((item) => {
        if (Array.isArray(item)) return item;
        if (item && Array.isArray(item.rows)) return item.rows;
        if (item && Array.isArray(item.matches)) return item.matches;
        return [];
      });
      listed = rows.find((m) => m && (m.id === id || m.livesportId === id)) || findListedMatch(id);
    } catch {
      listed = findListedMatch(id);
    }
  }

  const feeds = await fetchDetailFeeds(id);
  const { events, scorers } = parseIncidents(feeds.incidents);
  const info = parseSummary(feeds.summary || feeds.incidents);
  const liveScore = parseLiveScore(feeds.incidents || feeds.summary);
  const stats = parseTopStats(feeds.stats);
  const lineups = parseLineups(feeds.lineups);
  const tableRows = parseTournamentTable(feeds.table);

  if (!listed && !lineups.home && !lineups.away && !events.length && !tableRows.length) return null;

  const homeName = listed?.home || lineups.home?.name || 'Domácí';
  const awayName = listed?.away || lineups.away?.name || 'Hosté';
  const iso = listed?.date || listed?.kickoff || null;
  const gqlStage = feeds.lineups?.data?.findEventById?.eventStage?.eventStage;
  const state =
    listed?.state ||
    statusFromAb(String(gqlStage || info.stage || ''), iso);
  const homeScore =
    listed?.homeScore != null && listed.homeScore !== ''
      ? Number(listed.homeScore)
      : Number.isFinite(info.homeScore)
        ? info.homeScore
        : Number.isFinite(liveScore.home)
          ? liveScore.home
          : null;
  const awayScore =
    listed?.awayScore != null && listed.awayScore !== ''
      ? Number(listed.awayScore)
      : Number.isFinite(info.awayScore)
        ? info.awayScore
        : Number.isFinite(liveScore.away)
          ? liveScore.away
          : null;
  const score = listed
    ? listed.homeScore != null && listed.awayScore != null
      ? displayScore(listed.homeScore, listed.awayScore, state)
      : listed.score && state !== 'pre'
        ? listed.score
        : displayScore(homeScore, awayScore, state)
    : displayScore(homeScore, awayScore, state);

  const league = inferLeague(listed, homeName, awayName, tableRows) || listed?.league || '';
  const gqlHomeLogo = gqlTeamLogo(feeds.lineups?.data?.findEventById?.eventParticipants?.find((p) => String(p?.type?.side || '').toLowerCase() !== 'away'));
  const gqlAwayLogo = gqlTeamLogo(feeds.lineups?.data?.findEventById?.eventParticipants?.find((p) => String(p?.type?.side || '').toLowerCase() === 'away'));
  const tableHome = tableRows.find((row) => foldName(row.name) === foldName(homeName));
  const tableAway = tableRows.find((row) => foldName(row.name) === foldName(awayName));
  if (gqlHomeLogo) clubCrests.remember({ name: homeName, slug: listed?.homeSlug, id: listed?.homeTeamId || tableHome?.teamId, url: gqlHomeLogo });
  if (gqlAwayLogo) clubCrests.remember({ name: awayName, slug: listed?.awaySlug, id: listed?.awayTeamId || tableAway?.teamId, url: gqlAwayLogo });

  const data = {
    id,
    slug: listed && listed.home && listed.away ? matchSlug(listed) : `${slugify(homeName)}-vs-${slugify(awayName)}-${id}`,
    href: listed && listed.home && listed.away ? detailPath(listed) : `/zapasy/chance/${slugify(homeName)}-vs-${slugify(awayName)}-${id}`,
    home: homeName,
    away: awayName,
    homeLogo: listed?.homeLogo || lineups.home?.logo || gqlHomeLogo || tableHome?.logo || '',
    awayLogo: listed?.awayLogo || lineups.away?.logo || gqlAwayLogo || tableAway?.logo || '',
    homeTeamId: listed?.homeTeamId || tableHome?.teamId || '',
    awayTeamId: listed?.awayTeamId || tableAway?.teamId || '',
    homeSlug: listed?.homeSlug || slugify(homeName),
    awaySlug: listed?.awaySlug || slugify(awayName),
    league,
    round: listed?.round || '',
    stage: listed?.stage || '',
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
    standings: isEuropeanLeague(league) ? tableRows : [],
    source: 'Livesport',
  };
  const withCrests = decorateMatch(data);
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
      return decorateMatch({
        ...m,
        score: m.isLive || m.isDone ? m.score || '0:0' : '0:0',
        detailHref: m.detailHref && String(m.detailHref).startsWith('/') ? m.detailHref : '',
      });
    }
    return decorateMatch({
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
  listMolCup,
  listBoardLeagues,
  listEuropeLeagues,
  listCzechNational,
  listUpcoming,
  listResults,
  listPickerMatches,
  getMatchesHub,
  getMatchesAgenda,
  listSameRound,
  getStandings,
  getClubProfile,
  getSquadForTeamName,
  getMatchDetail,
  attachLivesport,
  eventIdFromSlug,
  matchSlug,
  detailPath,
  matchKeyPrefix,
  isEuropeanLeague,
  decorateMatch,
  pragueDayKey,
  formatDayNavLabel,
};

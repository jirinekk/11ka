const ESPN_SOCCER_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';
const ESPN_SOCCER_SUMMARY_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=';
const ESPN_SOCCER_SUMMARY_WEB_URL =
  'https://site.web.api.espn.com/apis/v2/sports/soccer/all/summary?event=';
const CHANCE_LIGA_SCHEDULE_URL = 'https://www.chanceliga.cz/rozpis-zapasu';
const CHNL_SCHEDULE_URL = 'https://www.fnliga.cz/zapasy/';

const fs = require('fs');
const path = require('path');
const livesportChance = require('./livesport-chance');
const chanceLigaLogos = require('./chance-liga-logos');

const CS_REGION_NAMES =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['cs-CZ'], { type: 'region' })
    : null;

const CACHE_TTL_MS = 60 * 1000;
let cache = {
  expiresAt: 0,
  data: null,
  dayKeyPrague: null,
};

let dayCache = {
  expiresAt: 0,
  data: null,
  dayKeyPrague: null,
};

function pragueDayKeyFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  if (!map.year || !map.month || !map.day) return null;
  return `${map.year}-${map.month}-${map.day}`;
}

function pragueTodayKey() {
  return pragueDayKeyFromIso(new Date().toISOString());
}

function yyyymmddFromDayKey(dayKey) {
  if (!dayKey) return null;
  const s = String(dayKey).replace(/-/g, '');
  return /^\d{8}$/.test(s) ? s : null;
}

/** Klíč statistiky ESPN (`name`) → český popisek */
const FOOTBALL_STAT_NAME_CS = {
  possessionPct: 'Držení míče',
  possession: 'Držení míče',
  shotsTotal: 'Střely',
  shots: 'Střely',
  totalShots: 'Střely',
  shotsOnTarget: 'Střely na bránu',
  shotsOffTarget: 'Střely mimo',
  cornerKicks: 'Rohy',
  corners: 'Rohy',
  foulsCommitted: 'Fauly',
  fouls: 'Fauly',
  foulsConceded: 'Fauly',
  offsides: 'Ofsajdy',
  offside: 'Ofsajdy',
  yellowCards: 'Žluté karty',
  redCards: 'Červené karty',
  saves: 'Zákroky brankáře',
  goalkeeperSaves: 'Zákroky brankáře',
  goals: 'Góly',
  expectedGoals: 'Očekávané góly (xG)',
  bigChances: 'Velké šance',
  bigChancesCreated: 'Vytvořené velké šance',
  passesCompleted: 'Úspěšné přihrávky',
  passesAttempted: 'Pokusy o přihrávku',
  passingPct: 'Úspěšnost přihrávek',
  accuratePasses: 'Přesné přihrávky',
  totalPasses: 'Přihrávky celkem',
  tackles: 'Důrazné vstupy',
  interceptions: 'Zachycení',
  blockedShots: 'Zblokované střely',
  hitWoodwork: 'Rány do konstrukce',
  attacks: 'Útoky',
  duelsWon: 'Vyhrané souboje',
  duels: 'Souboje',
  aerialDuelsWon: 'Vyhrané vzdušné souboje',
  crosses: 'Centry',
  throwIns: 'Vhazování',
  penaltyKicks: 'Pokutové kopy',
  substitutions: 'Střídání',
  cards: 'Karty',
};

/** V tabulce zápasu zobrazíme jen tyto klíče ESPN (`name`) – zbytek z boxscore vynecháme. */
const CORE_FOOTBALL_STAT_ORDER = [
  'possessionPct',
  'possession',
  'shotsTotal',
  'shots',
  'totalShots',
  'shotsOnTarget',
  'cornerKicks',
  'corners',
  'foulsCommitted',
  'fouls',
  'foulsConceded',
  'offsides',
  'offside',
  'yellowCards',
  'redCards',
  'saves',
  'goalkeeperSaves',
];
const CORE_FOOTBALL_STAT_NAMES = new Set(CORE_FOOTBALL_STAT_ORDER);

/** Anglické popisky z API → čeština (regex, od konkrétnějších k obecnějším) */
const FOOTBALL_STAT_LABEL_RULES = [
  [/possession\s*%?$/i, 'Držení míče'],
  [/goalkeeper\s*saves?|^\s*saves?\s*$/i, 'Zákroky brankáře'],
  [/shots?\s*on\s*(goal|target)/i, 'Střely na bránu'],
  [/shots?\s*off\s/i, 'Střely mimo'],
  [/expected\s*goals?|\bxg\b/i, 'Očekávané góly (xG)'],
  [/total\s*shots?/i, 'Střely'],
  [/^(shots?)$/i, 'Střely'],
  [/corners?/i, 'Rohy'],
  [/fouls?/i, 'Fauly'],
  [/offsides?/i, 'Ofsajdy'],
  [/yellow\s*cards?/i, 'Žluté karty'],
  [/red\s*cards?/i, 'Červené karty'],
  [/pass(?:es)?\s*accuracy|passing\s*%/i, 'Úspěšnost přihrávek'],
  [/(?:accurate\s*)?pass(?:es)?(?:\s*\(%\))?/i, 'Přihrávky'],
  [/tackles?/i, 'Důrazné vstupy'],
  [/cross(?:es)?/i, 'Centry'],
  [/interceptions?/i, 'Zachycení'],
  [/blocked\s*shots?/i, 'Zblokované střely'],
  [/woodwork|hit\s*(?:the\s*)?(?:post|bar)/i, 'Rány do konstrukce'],
  [/big\s*chances?/i, 'Velké šance'],
  [/attacks?/i, 'Útoky'],
  [/^goals?$/i, 'Góly'],
];

function czechStatLabel(statName, apiLabel) {
  const name = statName != null ? String(statName).trim() : '';
  if (name && FOOTBALL_STAT_NAME_CS[name]) return FOOTBALL_STAT_NAME_CS[name];

  const raw = apiLabel != null ? String(apiLabel).trim() : '';
  if (!raw) return name || 'Statistika';

  for (const [re, cs] of FOOTBALL_STAT_LABEL_RULES) {
    if (re.test(raw)) return cs;
  }
  return raw;
}

function mapStatus(event) {
  const comp0 = event?.competitions?.[0];
  const statusObj = event?.status || comp0?.status || null;
  const type = statusObj?.type || null;
  const raw = String(type?.shortDetail || type?.detail || '').trim();
  const state = String(type?.state || '').trim(); // "pre" | "in" | "post"
  const displayClock = String(statusObj?.displayClock || statusObj?.clock?.displayValue || '').trim();
  const dateIso = String(event?.date || comp0?.date || '').trim();

  // If ESPN omits type.detail, still honor completed state.
  if (!raw && type?.completed === true) return 'Konec';

  return statusToCzech(raw, state, displayClock, dateIso);
}

function formatKickoffTimeCz(dateIso) {
  const d = String(dateIso || '').trim();
  if (!d) return null;
  const ts = Date.parse(d);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function decodeHtmlText(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absoluteUrl(base, src) {
  const s = String(src || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  try {
    return new URL(s, base).toString();
  } catch {
    return '';
  }
}

function normalizeRoundLabel(raw) {
  const t = decodeHtmlText(raw).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const kolo = t.match(/^(\d+)\s*\.?\s*kolo$/i);
  if (kolo) return `${Number(kolo[1])}. kolo`;
  return t;
}

function teamInitials(name) {
  const cleaned = String(name || '')
    .replace(/^\d+\./, '')
    .replace(/\b(FC|FK|SK|AC|SC|MFK|1\.FC)\b/gi, '')
    .trim();
  const parts = (cleaned || String(name || '')).split(/\s+/).filter(Boolean);
  const letters = parts
    .map((p) => p.charAt(0))
    .join('')
    .replace(/[^A-Za-zÀ-ž]/g, '')
    .slice(0, 3);
  return letters.toUpperCase() || '?';
}

function formatMatchMeta(iso, roundLabel) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return roundLabel || '';
  const d = new Date(ts);
  const weekdayRaw = new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'short',
    timeZone: 'Europe/Prague',
  }).format(d);
  const wd = String(weekdayRaw || '').replace(/\./g, '').trim();
  const weekday = wd ? wd.charAt(0).toUpperCase() + wd.slice(1) : '';
  const date = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'Europe/Prague',
  })
    .format(d)
    .replace(/\.$/, '');
  const time = formatKickoffTimeCz(iso) || '';
  const when = [weekday, date].filter(Boolean).join(', ') + (time ? `, ${time}` : '');
  return roundLabel ? `${roundLabel} · ${when}` : when;
}

function toDisplayScore(score) {
  const raw = String(score || '').replace(/\s+/g, '');
  if (!raw || raw === '-:-') return '';
  return raw.replace(':', '–');
}

function toIsoFromCzDateTime(datePart, timePart) {
  const dateRaw = String(datePart || '').trim();
  const timeRaw = String(timePart || '').trim();
  const tm = timeRaw.match(/(\d{1,2}):(\d{2})/);
  if (!tm) return null;
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const slash = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const dd = Number(slash[1]);
    const mo = Number(slash[2]);
    const yyRaw = Number(slash[3]);
    const yy = slash[3].length === 2 ? 2000 + yyRaw : yyRaw;
    if (!Number.isFinite(dd) || !Number.isFinite(mo) || !Number.isFinite(yy)) return null;
    const d = new Date(yy, mo - 1, dd, hh, mm, 0, 0);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  const dot = dateRaw.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if (dot) {
    const dd = Number(dot[1]);
    const mo = Number(dot[2]);
    const yyRaw = Number(dot[3]);
    const yy = dot[3].length === 2 ? 2000 + yyRaw : yyRaw;
    if (!Number.isFinite(dd) || !Number.isFinite(mo) || !Number.isFinite(yy)) return null;
    const d = new Date(yy, mo - 1, dd, hh, mm, 0, 0);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  return null;
}

function statusToCzech(detail, state, displayClock, matchDateIso) {
  const d = String(detail || '').trim();
  const clk = String(displayClock || '').trim();
  const kickoff = formatKickoffTimeCz(matchDateIso);

  // ESPN sometimes sends kickoff as text like "3/31 - 5:00 AM EDT" in detail fields.
  // For upcoming matches prefer our parsed kickoff time (CZ) instead of that string.
  if (state === 'pre' && kickoff) {
    if (
      !d ||
      /\b(?:EDT|EST|CDT|CST|MDT|MST|PDT|PST|UTC|GMT)\b/i.test(d) ||
      /\b\d{1,2}\/\d{1,2}\b\s*-\s*/.test(d)
    ) {
      return kickoff;
    }
  }

  // If match is live and we have a clock, prefer it over generic labels.
  if (state === 'in' && clk) {
    // ESPN uses formats like "56'", "45'+2'", "90'+6'"
    if (/^\d{1,3}'\+\d{1,2}'$/i.test(clk)) return clk;
    if (/^\d{1,3}'\+\d{1,2}$/i.test(clk)) return `${clk}'`;
    if (/^\d{1,3}'$/i.test(clk)) return clk;
    if (/^\d{1,3}\+\d{1,2}'?$/i.test(clk)) return clk.endsWith("'") ? clk : `${clk}'`;
    if (/^\d{1,3}'?\s*$/.test(clk)) return clk.endsWith("'") ? clk : `${clk.trim()}'`;
  }

  if (!d) {
    if (state === 'pre') return kickoff || 'Brzy';
    if (state === 'post') return 'Konec';
    // Live with no clock provided → fallback timer label
    return state === 'in' ? "0'" : 'Živě';
  }

  // Minute formats: "57'", "57'" (already ok), "45'+2'", "90+3"
  if (/^\d{1,3}\s*\+?\s*\d{0,2}\s*'?$/i.test(d)) {
    return d.endsWith("'") ? d : `${d}'`;
  }
  if (/^\d{1,3}'\+\d{1,2}'$/i.test(d)) return d;

  const upper = d.toUpperCase();

  // Common short codes
  if (upper === 'HT') return 'Poločas';
  if (upper === 'FT') return 'Konec';
  if (upper === 'AET') return 'Po prodloužení';
  if (upper === 'PEN') return 'Na penalty';

  // English → Czech (best-effort)
  const rules = [
    [/HALF[\s-]*TIME|\bHT\b/i, 'Poločas'],
    [/FULL[\s-]*TIME|\bFT\b/i, 'Konec'],
    [/AFTER\s+EXTRA\s+TIME|\bAET\b/i, 'Po prodloužení'],
    [/EXTRA\s+TIME/i, 'Prodloužení'],
    [/PENALT(?:Y|IES)|SHOOTOUT|\bPEN\b/i, 'Penalty'],
    [/POSTPONED/i, 'Odloženo'],
    [/CANCELLED|CANCELED/i, 'Zrušeno'],
    [/SUSPENDED/i, 'Přerušeno'],
    [/DELAYED/i, 'Zpožděno'],
    [/ABANDONED/i, 'Ukončeno'],
    [/FINAL/i, 'Konec'],
    // Prefer clock for live matches; if none, fall back to 0'
    [/IN\s*PROGRESS|LIVE/i, state === 'in' ? (clk || "0'") : 'Živě'],
    [/NOT\s*STARTED|SCHEDULED/i, kickoff || 'Brzy'],
    [/KICK[\s-]*OFF/i, 'Začátek'],
  ];
  for (const [re, out] of rules) {
    if (re.test(d)) return out;
  }

  // If it's a kickoff time / date-like, keep it (UI shows date separately anyway)
  return d;
}

function leagueToCzech(nameOrAbbr) {
  const raw = String(nameOrAbbr || '').trim();
  if (!raw) return null;

  // Generic phrase translations (apply inside string).
  // Keep this list short and high-signal; it runs for every match.
  const PHRASES = [
    // Confederations / competitions
    [/\bAFC\s+Asian\s+Cup\s+Qualifiers\b/gi, 'Kvalifikace na Asijský pohár (AFC)'],
    [/\bAFC\s+Asian\s+Cup\b/gi, 'Asijský pohár (AFC)'],
    [/\bCAF\s+Africa\s+Cup\s+of\s+Nations\b/gi, 'Africký pohár národů (CAF)'],
    [/\bCONCACAF\s+Gold\s+Cup\b/gi, 'Zlatý pohár CONCACAF'],
    [/\bCONCACAF\b/gi, 'CONCACAF'],
    [/\bAFC\b/gi, 'AFC'],
    [/\bCAF\b/gi, 'CAF'],
    [/\bUEFA\b/gi, 'UEFA'],
    [/\bFIFA\b/gi, 'FIFA'],

    // Common terms
    [/\bAsian\b/gi, 'Asijský'],
    [/\bAfrica(?:n)?\b/gi, 'Africký'],
    [/\bEuropean\b/gi, 'Evropský'],
    // "U21" / "U-21" / "U 21" → "do 21 let"
    [/\bU\s*-?\s*(\d{1,2})\b/gi, 'do $1 let'],
    [/\bUnder-?21\b/gi, 'do 21 let'],
    [/\bChampionship\b/gi, 'mistrovství'],
    [/\bWorld\s+Cup\b/gi, 'Mistrovství světa'],
    [/\bNations\s+League\b/gi, 'Liga národů'],
    [/\bQualifiers?\b/gi, 'kvalifikace'],
    [/\bQualification\b/gi, 'kvalifikace'],
    [/\bQualifying\b/gi, 'kvalifikace'],
    [/\bPlay[- ]?offs?\b/gi, 'play-off'],
    [/\bCup\b/gi, 'pohár'],
  ];

  // Replace inside string (ESPN sometimes includes year/prefix/suffix).
  // Examples:
  // - "2026 International Friendly" → "2026 Mezinárodní přátelské utkání"
  // - "International Friendly" → "Mezinárodní přátelské utkání"
  let s = raw;
  s = s.replace(/(\d{4})\s+International\s+Friendly/gi, '$1 Mezinárodní přátelské utkání');
  s = s.replace(/\bInternational\s+Friendly\b/gi, 'Mezinárodní přátelské utkání');
  s = s.replace(/\bMen's\s+International\s+Friendly\b/gi, 'Mezinárodní přátelské utkání (muži)');
  // Competition phases / rounds that sometimes show up in the "league" field.
  s = s.replace(/\bGroup\s+Stage\b/gi, 'Skupinová fáze');
  s = s.replace(/\bFinal\b/gi, 'Finále');
  s = s.replace(/\bPlayoff\s+Finals\b/gi, 'Finále play-off');
  s = s.replace(/\bRelegation\s+Playoffs\b/gi, 'Baráž');
  s = s.replace(/\bRegular\s+Season\b/gi, 'Základní část');
  s = s.replace(/\bPreliminary\s+Round\b/gi, 'Předkolo');
  s = s.replace(/\bSecond\s+Round\b/gi, '2. kolo');
  s = s.replace(/\bThird\s+Round\b/gi, '3. kolo');
  s = s.replace(/\bFourth\s+Round\b/gi, '4. kolo');
  s = s.replace(/\bRound\s+of\s+(\d+)\b/gi, 'Kolo $1');
  s = s.replace(/\bQuarterfinals?\b/gi, 'Čtvrtfinále');
  s = s.replace(/\bSemifinals?\b/gi, 'Semifinále');

  // Apply generic phrase translation.
  for (const [re, to] of PHRASES) {
    s = s.replace(re, to);
  }

  // Normalize some casing after replacements.
  s = s.replace(/\bplay-off\b/g, 'Play-off');
  s = s.replace(/\bkvalifikace\b/g, 'Kvalifikace');
  s = s.replace(/\bpohár\b/g, 'pohár'); // keep lower-case in middle of strings

  if (s !== raw) return s;

  const rules = [
    [/^International\s+Friendly$/i, 'Mezinárodní přátelské utkání'],
    [/^Friendly$/i, 'Přátelské utkání'],
    [/^Club\s+Friendly$/i, 'Klubové přátelské utkání'],
    [/^International\s+Friendlies$/i, 'Mezinárodní přátelská utkání'],
    [/^UEFA\s+Champions\s+League$/i, 'Liga mistrů UEFA'],
    [/^UEFA\s+Europa\s+League$/i, 'Evropská liga UEFA'],
    [/^UEFA\s+Europa\s+Conference\s+League$/i, 'Konferenční liga UEFA'],
    [/^UEFA\s+Super\s+Cup$/i, 'Superpohár UEFA'],
    [/^FIFA\s+World\s+Cup$/i, 'Mistrovství světa'],
    [/^UEFA\s+European\s+Championship$/i, 'Mistrovství Evropy'],
    [/^Copa\s+America$/i, 'Copa América'],
  ];
  for (const [re, out] of rules) {
    const m = raw.match(re);
    if (!m) continue;
    if (typeof out === 'function') return out(...m);
    return out;
  }
  return raw;
}

function translateLeague(value) {
  return leagueToCzech(value) || value || null;
}

function czechRegionNameFromCode(code2) {
  const code = String(code2 || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (!CS_REGION_NAMES) return null;
  const out = CS_REGION_NAMES.of(code);
  return out ? String(out) : null;
}

function countryCode2FromTeam(team) {
  const raw =
    team?.country?.isoCode ||
    team?.country?.code ||
    team?.country?.abbreviation ||
    null;
  const code = String(raw || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  return null;
}

function czechTeamName(team, fallbackName) {
  return fallbackName;
}

function humanizeSlug(slug) {
  const s = String(slug || '').trim();
  if (!s) return null;
  const words = s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 10);
  if (!words.length) return null;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function leagueLabelFromEvent(event) {
  const year = event?.season?.year != null ? String(event.season.year) : '';
  const slug = String(event?.season?.slug || '').trim();
  if (year && slug && slug.includes('international-friendly')) {
    return `${year} International Friendly`;
  }
  if (slug) return humanizeSlug(slug);
  return null;
}

function extractAgeGroup(label) {
  const s = String(label || '');
  const m1 = s.match(/\bU\s*-?\s*(\d{1,2})\b/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = s.match(/\bUnder-?\s*(\d{1,2})\b/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = s.match(/\bdo\s*(\d{1,2})\s*let\b/i);
  if (m3) return parseInt(m3[1], 10);
  return null;
}

function appendAgeToTeamName(name, age) {
  const n = String(name || '').trim();
  const a = Number(age);
  if (!n || !Number.isFinite(a) || a < 5 || a > 40) return n;
  if (/\bU\s*-?\s*\d{1,2}\b/i.test(n)) return n;
  if (/\bUnder-?\s*\d{1,2}\b/i.test(n)) return n;
  if (/\bdo\s*\d{1,2}\s*let\b/i.test(n)) return n;
  return `${n} U${a}`;
}

function flagEmojiFromCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const A = 0x1f1e6;
  const chars = [...c].map((ch) => String.fromCodePoint(A + (ch.charCodeAt(0) - 65)));
  return chars.join('');
}

function normalizeEspnHexColor(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const hex = v.startsWith('#') ? v.slice(1) : v;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toLowerCase()}`;
}

function kitStrokeForFill(fillHex) {
  // Simple default that works on dark pitch background.
  // (We can tune later based on luminance.)
  if (!fillHex) return 'rgba(255,255,255,0.16)';
  return 'rgba(255,255,255,0.20)';
}

function hexToRgb(hex) {
  const h = normalizeEspnHexColor(hex);
  if (!h) return null;
  const s = h.slice(1);
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return { r, g, b };
}

function relLuminance({ r, g, b }) {
  // sRGB → linear
  const f = (x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const R = f(r);
  const G = f(g);
  const B = f(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function colorDistance(a, b) {
  if (!a || !b) return Infinity;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function kitCandidatesFromTeam(team) {
  const raw = [
    team?.uniform?.color,
    team?.alternateColor,
    team?.color,
    // ESPN sometimes nests uniform on competitors; keep it tolerant
    team?.uniforms?.[0]?.color,
  ];
  const unique = [];
  for (const v of raw) {
    const h = normalizeEspnHexColor(v);
    if (h && !unique.includes(h)) unique.push(h);
  }
  return unique;
}

function teamLogoUrl(team) {
  const direct = typeof team?.logo === 'string' ? team.logo.trim() : '';
  if (direct) return direct;

  const logos = Array.isArray(team?.logos) ? team.logos : [];
  const href =
    logos.find((l) => Array.isArray(l?.rel) && l.rel.includes('full') && l.rel.includes('default') && l?.href)?.href ||
    logos.find((l) => Array.isArray(l?.rel) && l.rel.includes('default') && l?.href)?.href ||
    logos.find((l) => typeof l?.href === 'string' && l.href)?.href ||
    null;
  return href ? String(href) : null;
}

function chooseDistinctKits(homeTeam, awayTeam) {
  const homeCandidates = kitCandidatesFromTeam(homeTeam);
  const awayCandidates = kitCandidatesFromTeam(awayTeam);

  const home = homeCandidates[0] || null;
  if (!home) {
    return { home: null, away: awayCandidates[0] || null };
  }

  // Pick first away candidate that is not too close to home.
  const homeRgb = hexToRgb(home);
  const minDist = 90; // tuned visually; avoids "same kit" collisions
  let away = null;
  for (const cand of awayCandidates) {
    const d = colorDistance(homeRgb, hexToRgb(cand));
    if (d >= minDist) {
      away = cand;
      break;
    }
  }
  away = away || awayCandidates[0] || null;

  // If still too similar (or identical), force a high-contrast fallback for away.
  const awayRgb = hexToRgb(away);
  const d0 = colorDistance(homeRgb, awayRgb);
  if (away && d0 < minDist) {
    const L = relLuminance(homeRgb);
    away = L > 0.55 ? '#0a0a0a' : '#ffffff';
  }

  return { home, away };
}

function toMatch(event) {
  const competition = event?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((c) => c?.homeAway === 'home');
  const away = competitors.find((c) => c?.homeAway === 'away');
  if (!home || !away) return null;

  const kits = chooseDistinctKits(home.team, away.team);
  const homeKit = kits.home;
  const awayKit = kits.away;
  const statusObj = event?.status || competition?.status || null;
  const state = String(statusObj?.type?.state || '').trim() || null;
  const leagueRaw = event?.league?.name || event?.league?.abbreviation || leagueLabelFromEvent(event) || '';
  const ageGroup = extractAgeGroup(leagueRaw);

  const homeCountry =
    home.team?.country?.abbreviation ||
    home.team?.country?.code ||
    home.team?.country?.isoCode ||
    null;
  const awayCountry =
    away.team?.country?.abbreviation ||
    away.team?.country?.code ||
    away.team?.country?.isoCode ||
    null;

  return {
    id: event?.id || competition?.id || null,
    date: event?.date || competition?.date || null,
    home: appendAgeToTeamName(home.team?.shortDisplayName || home.team?.displayName || 'Domácí', ageGroup),
    away: appendAgeToTeamName(away.team?.shortDisplayName || away.team?.displayName || 'Hosté', ageGroup),
    homeLogo: teamLogoUrl(home.team),
    awayLogo: teamLogoUrl(away.team),
    homeAbbr: home.team?.abbreviation || null,
    awayAbbr: away.team?.abbreviation || null,
    homeFlag: flagEmojiFromCode(homeCountry),
    awayFlag: flagEmojiFromCode(awayCountry),
    score: `${home.score || 0}:${away.score || 0}`,
    status: mapStatus(event),
    state,
    league: leagueToCzech(leagueRaw) || null,
    ageGroup,
    homeKitColor: homeKit,
    awayKitColor: awayKit,
  };
}

function postProcessMatchItem(m) {
  if (!m || typeof m !== 'object') return m;
  const next = { ...m };
  if (next.league) next.league = leagueToCzech(next.league) || next.league;
  return next;
}

function isCzechishMatchItem(item) {
  const txt = `${item.home || ''} ${item.away || ''} ${item.league || ''}`.toLowerCase();
  return (
    txt.includes('czech') ||
    txt.includes('čes') ||
    txt.includes('praha') ||
    txt.includes('slavia') ||
    txt.includes('sparta') ||
    txt.includes('plze') ||
    txt.includes('baník') ||
    txt.includes('ostrava') ||
    txt.includes('liberec') ||
    txt.includes('mladá') ||
    txt.includes('boleslav') ||
    txt.includes('olomouc') ||
    txt.includes('teplice') ||
    txt.includes('bohemians') ||
    txt.includes('sigma')
  );
}

function isCzechRepublicMatchItem(item) {
  if (!item) return false;
  const home = String(item.home || '').toLowerCase();
  const away = String(item.away || '').toLowerCase();
  const homeAbbr = String(item.homeAbbr || '').toUpperCase();
  const awayAbbr = String(item.awayAbbr || '').toUpperCase();

  const hasCzName =
    home.includes('česko') ||
    away.includes('česko') ||
    home.includes('česká republika') ||
    away.includes('česká republika') ||
    home.includes('czech republic') ||
    away.includes('czech republic') ||
    home.includes('czechia') ||
    away.includes('czechia');

  const hasCzAbbr = homeAbbr === 'CZE' || awayAbbr === 'CZE';
  return hasCzName || hasCzAbbr;
}

function sortMatchesForWidget(a, b) {
  const acz = isCzechishMatchItem(a) ? 0 : 1;
  const bcz = isCzechishMatchItem(b) ? 0 : 1;
  if (acz !== bcz) return acz - bcz;

  const orderState = (s) => (s === 'in' ? 0 : s === 'pre' ? 1 : s === 'post' ? 2 : 3);
  const as = orderState(a.state);
  const bs = orderState(b.state);
  if (as !== bs) return as - bs;

  const at = a.date ? Date.parse(a.date) : NaN;
  const bt = b.date ? Date.parse(b.date) : NaN;
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function normalizeLeagueForFilter(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isChanceLeagueMatch(item) {
  const league = normalizeLeagueForFilter(item?.league);
  return league.includes('chance liga') || league.includes('chance narodni liga');
}

function parseStateFromScoreAndDate(scoreText, dateIso) {
  const score = String(scoreText || '').trim();
  const ts = dateIso ? Date.parse(dateIso) : NaN;
  const now = Date.now();
  if (score === '-:-') {
    if (Number.isFinite(ts) && ts > now) return 'pre';
    return 'pre';
  }
  if (!/^\d+\s*:\s*\d+$/.test(score)) return 'pre';
  if (Number.isFinite(ts)) {
    const ageMs = now - ts;
    if (ageMs >= 0 && ageMs <= 2.5 * 60 * 60 * 1000) return 'in';
  }
  return 'post';
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': '11ka-live-score/1.0' },
    });
    if (!res.ok) throw new Error(`Schedule source returned ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseChanceLigaUpcomingFromHtml(html, limit = 6) {
  const src = String(html || '');
  const out = [];
  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/g;
  let round = '';
  let m;
  while ((m = rowRe.exec(src))) {
    if (out.length >= limit) break;
    const attrs = m[1] || '';
    const chunk = m[2] || '';
    const header = chunk.match(/<td class="header"[^>]*>\s*([^<]+)/i);
    if (header) {
      round = normalizeRoundLabel(header[1]);
      continue;
    }
    if (!/\bgame\b/.test(attrs) && !/class="team home/.test(chunk)) continue;
    const dateMatch = chunk.match(/hidden-xs">(?:[a-z]{2},\s*)?(\d{2}\/\d{2}\/\d{2,4})<\/span>/i);
    const timeMatch = chunk.match(/<td class="time hidden-xs">(\d{1,2}:\d{2})<\/td>/i);
    const scoreMatch = chunk.match(/<td class="score"><a[^>]*>\s*([^<]+)\s*<\/a>/i);
    const homeMatch = chunk.match(/<td class="team home [^"]*">[\s\S]*?hidden-xs">([\s\S]*?)<\/span>/i);
    const awayMatch = chunk.match(/<td class="team away [^"]*">[\s\S]*?hidden-xs">([\s\S]*?)<\/span>/i);
    const home = homeMatch ? decodeHtmlText(homeMatch[1]).trim() : null;
    const away = awayMatch ? decodeHtmlText(awayMatch[1]).trim() : null;
    if (!dateMatch || !timeMatch || !home || !away) continue;
    const score = scoreMatch ? String(scoreMatch[1] || '').trim() : '-:-';
    const iso = toIsoFromCzDateTime(dateMatch[1], timeMatch[1]);
    if (!iso) continue;
    const logos = Array.from(chunk.matchAll(/<td class="logo">[\s\S]*?<img src="([^"]+)"/gi)).map((x) => x[1]);
    const detailMatch = chunk.match(/href="(\/zapas\/[^"#]+)"/i);
    const state = parseStateFromScoreAndDate(score, iso);
    const status = state === 'post' ? 'Konec' : state === 'in' ? 'Živě' : (formatKickoffTimeCz(iso) || timeMatch[1]);
    out.push({
      id: detailMatch ? detailMatch[1] : null,
      date: iso,
      home,
      away,
      homeLogo: absoluteUrl('https://www.chanceliga.cz', logos[0]),
      awayLogo: absoluteUrl('https://www.chanceliga.cz', logos[1]),
      detailHref: absoluteUrl('https://www.chanceliga.cz', detailMatch && detailMatch[1]),
      round: round,
      score,
      status,
      state,
      league: 'Chance Liga',
    });
  }
  return out;
}

function parseChnlUpcomingFromHtml(html, limit = 6) {
  const src = String(html || '');
  const out = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let round = '';
  let m;
  while ((m = rowRe.exec(src))) {
    if (out.length >= limit) break;
    const chunk = m[1] || '';
    const roundMatch = chunk.match(/schedule_table__round[^>]*>\s*<span>([^<]+)/i);
    if (roundMatch) {
      round = normalizeRoundLabel(roundMatch[1]);
      continue;
    }
    if (!/schedule_table__team/.test(chunk)) continue;
    const dateMatch = chunk.match(/<span>(\d{2}\.\d{2}\.\d{2,4})<\/span>/);
    const timeMatch = chunk.match(/<span>[a-z]{2}\s*(\d{1,2}:\d{2})\s*hod\.<\/span>/i);
    const scoreMatch = chunk.match(/schedule_table__score__box">\s*<a[^>]*>\s*([^<]+)\s*<\/a>/);
    const teamMatches = Array.from(
      chunk.matchAll(/schedule_table__team__name">\s*<a[^>]*>\s*([\s\S]*?)\s*<\/a>/g),
    ).map((x) => decodeHtmlText(x[1]).trim());
    const home = teamMatches[0] || null;
    const away = teamMatches[1] || null;
    if (!dateMatch || !timeMatch || !home || !away) continue;
    const score = scoreMatch ? String(scoreMatch[1] || '').trim() : '-:-';
    const iso = toIsoFromCzDateTime(dateMatch[1], timeMatch[1]);
    if (!iso) continue;
    const logos = Array.from(chunk.matchAll(/schedule_table__score__logo[\s\S]*?<img src="([^"]+)"/gi)).map((x) => x[1]);
    const detailMatch = chunk.match(/href="(\/zapas\/[^"#]+)"/i);
    const state = parseStateFromScoreAndDate(score, iso);
    const status = state === 'post' ? 'Konec' : state === 'in' ? 'Živě' : (formatKickoffTimeCz(iso) || timeMatch[1]);
    out.push({
      id: detailMatch ? detailMatch[1] : null,
      date: iso,
      home,
      away,
      homeLogo: absoluteUrl('https://www.fnliga.cz', logos[0]),
      awayLogo: absoluteUrl('https://www.fnliga.cz', logos[1]),
      detailHref: absoluteUrl('https://www.fnliga.cz', detailMatch && detailMatch[1]),
      round: round,
      score,
      status,
      state,
      league: 'Chance Národní liga',
    });
  }
  return out;
}

async function getOfficialChanceUpcoming(limit = 3) {
  try {
    const [aHtml, bHtml] = await Promise.all([
      fetchText(CHANCE_LIGA_SCHEDULE_URL),
      fetchText(CHNL_SCHEDULE_URL),
    ]);
    const merged = [
      ...parseChanceLigaUpcomingFromHtml(aHtml, 12),
      ...parseChnlUpcomingFromHtml(bHtml, 12),
    ]
      .filter((m) => m && m.date)
      .sort((x, y) => Date.parse(x.date) - Date.parse(y.date));
    const now = Date.now();
    const future = merged.filter((m) => {
      const ts = Date.parse(m.date);
      return Number.isFinite(ts) && ts >= now - 2 * 60 * 60 * 1000;
    });
    const source = future.length ? future : merged;
    if (!source.length) return [];

    const picked = [];
    const byLeague = {
      chance: source.filter((m) => normalizeLeagueForFilter(m.league).includes('chance liga')),
      narodni: source.filter((m) => normalizeLeagueForFilter(m.league).includes('chance narodni liga')),
    };

    // Ensure both leagues are represented when available.
    if (byLeague.chance.length) picked.push(byLeague.chance[0]);
    if (
      byLeague.narodni.length &&
      !picked.some((p) => p.home === byLeague.narodni[0].home && p.away === byLeague.narodni[0].away && p.date === byLeague.narodni[0].date)
    ) {
      picked.push(byLeague.narodni[0]);
    }

    for (const item of source) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.home === item.home && p.away === item.away && p.date === item.date)) continue;
      picked.push(item);
    }
    return picked.slice(0, limit);
  } catch {
    return [];
  }
}

async function getOfficialChanceDayMatches() {
  const [aHtml, bHtml] = await Promise.all([
    fetchText(CHANCE_LIGA_SCHEDULE_URL),
    fetchText(CHNL_SCHEDULE_URL),
  ]);
  const mergedAll = [
    ...parseChanceLigaUpcomingFromHtml(aHtml, 200),
    ...parseChnlUpcomingFromHtml(bHtml, 200),
  ]
    .filter((m) => m && m.date)
    .sort((x, y) => Date.parse(x.date) - Date.parse(y.date));

  const todayKey = pragueTodayKey();
  const groups = new Map();
  for (const m of mergedAll) {
    const key = pragueDayKeyFromIso(m.date);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const dayKeys = Array.from(groups.keys()).sort();
  const todayTs = todayKey ? Date.parse(`${todayKey}T00:00:00`) : NaN;

  function hasChanceLiga(dayKey) {
    const list = groups.get(dayKey) || [];
    return list.some((m) => normalizeLeagueForFilter(m.league).includes('chance liga'));
  }
  function hasNarodniLiga(dayKey) {
    const list = groups.get(dayKey) || [];
    return list.some((m) => normalizeLeagueForFilter(m.league).includes('chance narodni liga'));
  }
  function hasBothLeagues(dayKey) {
    return hasChanceLiga(dayKey) && hasNarodniLiga(dayKey);
  }

  let selectedDayKey = null;
  if (todayKey && groups.has(todayKey) && hasBothLeagues(todayKey)) {
    selectedDayKey = todayKey;
  } else {
    const withBoth = dayKeys.filter(hasBothLeagues);
    const withChance = dayKeys.filter(hasChanceLiga);

    if (withBoth.length) {
      if (Number.isFinite(todayTs)) {
        selectedDayKey =
          withBoth.find((k) => Date.parse(`${k}T00:00:00`) >= todayTs) ||
          withBoth[withBoth.length - 1];
      } else {
        selectedDayKey = withBoth[0];
      }
    } else if (withChance.length) {
      if (Number.isFinite(todayTs)) {
        selectedDayKey =
          withChance.find((k) => Date.parse(`${k}T00:00:00`) >= todayTs) ||
          withChance[withChance.length - 1];
      } else {
        selectedDayKey = withChance[0];
      }
    } else if (dayKeys.length) {
      if (Number.isFinite(todayTs)) {
        selectedDayKey =
          dayKeys.find((k) => Date.parse(`${k}T00:00:00`) >= todayTs) ||
          dayKeys[dayKeys.length - 1];
      } else {
        selectedDayKey = dayKeys[0];
      }
    }
  }

  const matches = selectedDayKey ? (groups.get(selectedDayKey) || []) : [];

  return {
    matches,
    source: 'official-cz-leagues',
    fetchedAt: new Date().toISOString(),
  };
}

function pickWidgetMatches(baseMatches) {
  const pool = (Array.isArray(baseMatches) ? baseMatches : []).map(postProcessMatchItem);
  const chance = pool.filter((m) => m && isChanceLeagueMatch(m)).slice().sort(sortMatchesForWidget);
  const upcoming = chance
    .filter((m) => String(m.state || '') === 'pre')
    .slice()
    .sort((a, b) => {
      const at = a.date ? Date.parse(a.date) : NaN;
      const bt = b.date ? Date.parse(b.date) : NaN;
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
      if (!Number.isFinite(at) && Number.isFinite(bt)) return 1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .slice(0, 3);
  if (upcoming.length) return upcoming;
  return [];
}

async function pickWidgetMatchesWithDayFallback(baseMatches) {
  const official = await getOfficialChanceUpcoming(3);
  if (official.length) return official;

  const primary = pickWidgetMatches(baseMatches);
  if (primary.length) return primary;
  try {
    const dayFeed = await getDayMatches();
    const dayPicked = pickWidgetMatches(dayFeed?.matches || []);
    if (dayPicked.length) return dayPicked;
  } catch {
    // ignore and continue to multi-day fallback
  }
  const nextDays = await findNextChanceMatches(3, 10);
  if (nextDays.length) return nextDays;
  return [];
}

async function findNextChanceMatches(limit = 3, maxDays = 10) {
  const out = [];
  const startKey = pragueTodayKey();
  if (!startKey) return out;
  const m = String(startKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return out;
  const startUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(startUtc)) return out;

  for (let i = 0; i < maxDays && out.length < limit; i++) {
    const d = new Date(startUtc + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const ymd = yyyymmddFromDayKey(key);
    if (!ymd) continue;
    try {
      const feed = await fetchFromApiForDate(ymd);
      const chance = (Array.isArray(feed?.matches) ? feed.matches : [])
        .map(postProcessMatchItem)
        .filter((mItem) => mItem && isChanceLeagueMatch(mItem))
        .filter((mItem) => String(mItem.state || '') === 'pre')
        .sort((a, b) => {
          const at = a.date ? Date.parse(a.date) : NaN;
          const bt = b.date ? Date.parse(b.date) : NaN;
          if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
          return String(a.id || '').localeCompare(String(b.id || ''));
        });
      for (const match of chance) {
        if (out.length >= limit) break;
        if (!out.some((x) => String(x.id || '') === String(match.id || ''))) out.push(match);
      }
    } catch {
      // continue to next day
    }
  }

  return out.slice(0, limit);
}

function toMatchDetail(event) {
  const competition = event?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((c) => c?.homeAway === 'home');
  const away = competitors.find((c) => c?.homeAway === 'away');
  if (!home || !away) return null;

  const kits = chooseDistinctKits(home.team, away.team);
  const homeKit = kits.home;
  const awayKit = kits.away;
  const leagueRaw = event?.league?.name || event?.league?.abbreviation || leagueLabelFromEvent(event) || '';
  const ageGroup = extractAgeGroup(leagueRaw);

  const homeCountry =
    home.team?.country?.abbreviation ||
    home.team?.country?.code ||
    home.team?.country?.isoCode ||
    null;
  const awayCountry =
    away.team?.country?.abbreviation ||
    away.team?.country?.code ||
    away.team?.country?.isoCode ||
    null;

  const venue = competition?.venue;
  const espnLink = Array.isArray(event?.links)
    ? event.links.find((l) => l?.rel?.includes?.('desktop') && typeof l?.href === 'string')
    : null;

  return {
    id: event?.id || competition?.id || null,
    name:
      event?.name ||
      `${home.team?.displayName || 'Domácí'} vs ${away.team?.displayName || 'Hosté'}`,
    status: mapStatus(event),
    state: event?.status?.type?.state || null,
    date: event?.date || competition?.date || null,
    league:
      leagueToCzech(leagueRaw) || null,
    ageGroup,
    venue: venue
      ? {
          name: venue.fullName || venue.name || null,
          city: venue.address?.city || null,
          country: venue.address?.country || null,
        }
      : null,
    teams: {
      home: {
        name: appendAgeToTeamName(home.team?.displayName || 'Domácí', ageGroup),
        shortName: appendAgeToTeamName(home.team?.shortDisplayName || home.team?.displayName || 'Domácí', ageGroup),
        abbreviation: home.team?.abbreviation || null,
        score: Number(home.score || 0),
        logo: teamLogoUrl(home.team),
        flag: flagEmojiFromCode(homeCountry),
        kitColor: homeKit,
        kitStroke: kitStrokeForFill(homeKit),
      },
      away: {
        name: appendAgeToTeamName(away.team?.displayName || 'Hosté', ageGroup),
        shortName: appendAgeToTeamName(away.team?.shortDisplayName || away.team?.displayName || 'Hosté', ageGroup),
        abbreviation: away.team?.abbreviation || null,
        score: Number(away.score || 0),
        logo: teamLogoUrl(away.team),
        flag: flagEmojiFromCode(awayCountry),
        kitColor: awayKit,
        kitStroke: kitStrokeForFill(awayKit),
      },
    },
    formations: {
      home: home?.formation || null,
      away: away?.formation || null,
    },
    link: espnLink?.href || null,
  };
}

function matchDetailFromSummaryPayload(summaryPayload) {
  const header = summaryPayload?.header;
  const competition = header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((c) => c?.homeAway === 'home');
  const away = competitors.find((c) => c?.homeAway === 'away');
  if (!home || !away) return null;

  const kits = chooseDistinctKits(home.team, away.team);
  const homeKit = kits.home;
  const awayKit = kits.away;
  const leagueRaw = header?.leagues?.[0]?.name || header?.league?.name || '';
  const ageGroup = extractAgeGroup(leagueRaw);

  const homeCountry =
    home.team?.country?.abbreviation ||
    home.team?.country?.code ||
    home.team?.country?.isoCode ||
    null;
  const awayCountry =
    away.team?.country?.abbreviation ||
    away.team?.country?.code ||
    away.team?.country?.isoCode ||
    null;

  const venue = competition?.venue || summaryPayload?.gameInfo?.venue || summaryPayload?.boxscore?.gameInfo?.venue || null;
  const links = Array.isArray(summaryPayload?.links) ? summaryPayload.links : [];
  const espnLink =
    links.find((l) => l?.rel?.includes?.('desktop') && typeof l?.href === 'string') ||
    links.find((l) => typeof l?.href === 'string') ||
    null;

  return {
    id: header?.id || header?.eventId || summaryPayload?.gameId || competition?.id || null,
    name:
      header?.name ||
      `${home.team?.displayName || 'Domácí'} vs ${away.team?.displayName || 'Hosté'}`,
    status: mapStatus(header || competition || summaryPayload),
    state: header?.competitions?.[0]?.status?.type?.state || header?.status?.type?.state || null,
    date: header?.competitions?.[0]?.date || header?.date || competition?.date || null,
    league: leagueToCzech(leagueRaw) || null,
    ageGroup,
    venue: venue
      ? {
          name: venue.fullName || venue.name || venue.shortName || null,
          city: venue.address?.city || null,
          country: venue.address?.country || null,
        }
      : null,
    teams: {
      home: {
        name: appendAgeToTeamName(home.team?.displayName || 'Domácí', ageGroup),
        shortName: appendAgeToTeamName(home.team?.shortDisplayName || home.team?.displayName || 'Domácí', ageGroup),
        abbreviation: home.team?.abbreviation || null,
        score: Number(home.score || 0),
        logo: teamLogoUrl(home.team),
        flag: flagEmojiFromCode(homeCountry),
        kitColor: homeKit,
        kitStroke: kitStrokeForFill(homeKit),
      },
      away: {
        name: appendAgeToTeamName(away.team?.displayName || 'Hosté', ageGroup),
        shortName: appendAgeToTeamName(away.team?.shortDisplayName || away.team?.displayName || 'Hosté', ageGroup),
        abbreviation: away.team?.abbreviation || null,
        score: Number(away.score || 0),
        logo: teamLogoUrl(away.team),
        flag: flagEmojiFromCode(awayCountry),
        kitColor: awayKit,
        kitStroke: kitStrokeForFill(awayKit),
      },
    },
    formations: {
      home: home?.formation || null,
      away: away?.formation || null,
    },
    link: espnLink?.href || null,
  };
}

function statMapFromSummary(summaryPayload) {
  const competition = summaryPayload?.header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((c) => c?.homeAway === 'home');
  const away = competitors.find((c) => c?.homeAway === 'away');

  // ESPN summary often provides competitor[].statistics = [{name,displayValue}]
  function statsToObj(team) {
    const out = {};
    const stats = Array.isArray(team?.statistics) ? team.statistics : [];
    for (const s of stats) {
      if (!s?.name) continue;
      out[s.name] = s.displayValue != null ? String(s.displayValue) : s.value != null ? String(s.value) : '';
    }
    return out;
  }

  const homeStats = statsToObj(home);
  const awayStats = statsToObj(away);

  const keyOrder = [
    { key: 'possessionPct', label: 'Držení míče' },
    { key: 'shotsTotal', label: 'Střely' },
    { key: 'shotsOnTarget', label: 'Střely na bránu' },
    { key: 'cornerKicks', label: 'Rohy' },
    { key: 'foulsCommitted', label: 'Fauly' },
    { key: 'offsides', label: 'Ofsajdy' },
    { key: 'yellowCards', label: 'Žluté karty' },
    { key: 'redCards', label: 'Červené karty' },
    { key: 'saves', label: 'Zákroky brankáře' },
  ];

  const keyStats = keyOrder
    .map((k) => ({
      key: k.key,
      label: k.label,
      home: homeStats[k.key] || null,
      away: awayStats[k.key] || null,
    }))
    .filter((row) => row.home != null || row.away != null);

  return { keyStats };
}

function mapEspnSummaryRosterPlayer(entry) {
  const ath = entry?.athlete;
  if (!ath || (!ath.displayName && !ath.shortName && !ath.fullName)) return null;
  return {
    athleteId: ath.id != null ? String(ath.id) : null,
    name: ath.displayName || ath.fullName || ath.shortName || null,
    position: entry?.position?.abbreviation || entry?.position?.name || null,
    positionName: entry?.position?.name || null,
    positionAbbr: entry?.position?.abbreviation || null,
    jersey: entry?.jersey != null ? String(entry.jersey) : null,
    starter: entry?.starter === true,
    headshot: ath.headshot?.href || null,
    formationPlace: entry?.formationPlace != null ? String(entry.formationPlace) : null,
  };
}

function splitLineupStartersBench(athletes) {
  let starters = athletes.filter((p) => p.starter).slice(0, 30);
  let bench = athletes.filter((p) => !p.starter).slice(0, 40);
  if (!starters.length && athletes.length) {
    starters = athletes.slice(0, 11);
    bench = athletes.slice(11, 51);
  }
  if (!starters.length && !bench.length) return null;
  return { starters, bench };
}

/** Z řetězce typu "4-2-3-1" / "4231" → [4,2,3,1] (součet musí být 10). */
function parseFormationLines(formationStr) {
  if (formationStr == null || formationStr === '') return null;
  const nums = String(formationStr).match(/\d+/g);
  if (!nums || !nums.length) return null;
  const parts = nums.map((x) => parseInt(x, 10)).filter((n) => n > 0);
  if (!parts.length) return null;
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== 10) return null;
  return parts;
}

/** Popisek formace pro UI: "4 - 2 - 3 - 1". */
function formatFormationLabel(formationStr) {
  if (formationStr == null || formationStr === '') return null;
  const lines = parseFormationLines(formationStr);
  if (lines) return lines.join(' - ');
  return null;
}

/**
 * Souřadnice slotů 1–11 podle ESPN `formationPlace` (stejná data jako na webu; API neposílá x/y).
 * `l` = left %, `t` = top % pro domácí (vlastní branka dole = vysoké t). Hosté: t zrcadlíme.
 * Zdroj: rozložení odpovídající ESPN / běžné mapování formationPlace u dané formace.
 */
const FORMATION_SLOT_PCT_HOME = {
  '4-2-3-1': {
    '1': { l: 50, t: 90 },
    '2': { l: 86, t: 74 },
    '3': { l: 14, t: 74 },
    '4': { l: 10, t: 48 },
    '5': { l: 68, t: 76 },
    '6': { l: 32, t: 76 },
    '7': { l: 82, t: 36 },
    '8': { l: 90, t: 50 },
    '9': { l: 50, t: 16 },
    '10': { l: 50, t: 34 },
    '11': { l: 18, t: 36 },
  },
  '4-1-4-1': {
    '1': { l: 50, t: 90 },
    '2': { l: 86, t: 74 },
    '3': { l: 14, t: 74 },
    '4': { l: 50, t: 60 },
    '5': { l: 68, t: 76 },
    '6': { l: 32, t: 76 },
    '7': { l: 88, t: 44 },
    '8': { l: 68, t: 48 },
    '9': { l: 50, t: 16 },
    '10': { l: 32, t: 48 },
    '11': { l: 12, t: 44 },
  },
  '4-3-3': {
    '1': { l: 50, t: 90 },
    '2': { l: 84, t: 74 },
    '3': { l: 16, t: 74 },
    '4': { l: 66, t: 76 },
    '5': { l: 34, t: 76 },
    '6': { l: 72, t: 50 },
    '7': { l: 50, t: 56 },
    '8': { l: 28, t: 50 },
    '9': { l: 86, t: 30 },
    '10': { l: 50, t: 18 },
    '11': { l: 14, t: 30 },
  },
  '4-4-2': {
    '1': { l: 50, t: 90 },
    '2': { l: 86, t: 74 },
    '3': { l: 14, t: 74 },
    '4': { l: 66, t: 76 },
    '5': { l: 34, t: 76 },
    '6': { l: 90, t: 48 },
    '7': { l: 70, t: 50 },
    '8': { l: 30, t: 50 },
    '9': { l: 10, t: 48 },
    '10': { l: 60, t: 26 },
    '11': { l: 40, t: 26 },
  },
  '3-5-2': {
    '1': { l: 50, t: 90 },
    '2': { l: 78, t: 74 },
    '3': { l: 50, t: 76 },
    '4': { l: 22, t: 74 },
    '5': { l: 90, t: 50 },
    '6': { l: 72, t: 48 },
    '7': { l: 50, t: 52 },
    '8': { l: 28, t: 48 },
    '9': { l: 10, t: 50 },
    '10': { l: 58, t: 22 },
    '11': { l: 42, t: 22 },
  },
  '5-4-1': {
    '1': { l: 50, t: 90 },
    '2': { l: 88, t: 72 },
    '3': { l: 68, t: 76 },
    '4': { l: 50, t: 78 },
    '5': { l: 32, t: 76 },
    '6': { l: 12, t: 72 },
    '7': { l: 82, t: 46 },
    '8': { l: 60, t: 50 },
    '9': { l: 40, t: 50 },
    '10': { l: 18, t: 46 },
    '11': { l: 50, t: 16 },
  },
  '5-3-2': {
    '1': { l: 50, t: 90 },
    '2': { l: 90, t: 72 },
    '3': { l: 72, t: 76 },
    '4': { l: 50, t: 78 },
    '5': { l: 28, t: 76 },
    '6': { l: 10, t: 72 },
    '7': { l: 66, t: 48 },
    '8': { l: 50, t: 52 },
    '9': { l: 34, t: 48 },
    '10': { l: 58, t: 24 },
    '11': { l: 42, t: 24 },
  },
  '4-5-1': {
    '1': { l: 50, t: 90 },
    '2': { l: 86, t: 74 },
    '3': { l: 14, t: 74 },
    '4': { l: 66, t: 76 },
    '5': { l: 34, t: 76 },
    '6': { l: 88, t: 46 },
    '7': { l: 72, t: 50 },
    '8': { l: 50, t: 54 },
    '9': { l: 28, t: 50 },
    '10': { l: 12, t: 46 },
    '11': { l: 50, t: 18 },
  },
  '3-4-3': {
    '1': { l: 50, t: 90 },
    '2': { l: 76, t: 74 },
    '3': { l: 50, t: 76 },
    '4': { l: 24, t: 74 },
    '5': { l: 86, t: 48 },
    '6': { l: 62, t: 50 },
    '7': { l: 38, t: 50 },
    '8': { l: 14, t: 48 },
    '9': { l: 82, t: 28 },
    '10': { l: 50, t: 18 },
    '11': { l: 18, t: 28 },
  },
  '4-1-3-2': {
    '1': { l: 50, t: 90 },
    '2': { l: 86, t: 74 },
    '3': { l: 14, t: 74 },
    '4': { l: 66, t: 76 },
    '5': { l: 34, t: 76 },
    '6': { l: 50, t: 58 },
    '7': { l: 74, t: 42 },
    '8': { l: 50, t: 40 },
    '9': { l: 26, t: 42 },
    '10': { l: 58, t: 22 },
    '11': { l: 42, t: 22 },
  },
  '3-4-1-2': {
    '1': { l: 50, t: 90 },
    '2': { l: 76, t: 74 },
    '3': { l: 50, t: 76 },
    '4': { l: 24, t: 74 },
    '5': { l: 86, t: 50 },
    '6': { l: 62, t: 48 },
    '7': { l: 38, t: 48 },
    '8': { l: 14, t: 50 },
    '9': { l: 50, t: 34 },
    '10': { l: 58, t: 20 },
    '11': { l: 42, t: 20 },
  },
  '4-2-2-2': {
    '1': { l: 50, t: 90 },
    '2': { l: 86, t: 74 },
    '3': { l: 14, t: 74 },
    '4': { l: 66, t: 76 },
    '5': { l: 34, t: 76 },
    '6': { l: 72, t: 54 },
    '7': { l: 28, t: 54 },
    '8': { l: 68, t: 32 },
    '9': { l: 32, t: 32 },
    '10': { l: 58, t: 20 },
    '11': { l: 42, t: 20 },
  },
  '4-3-1-2': {
    '1': { l: 50, t: 90 },
    '2': { l: 86, t: 74 },
    '3': { l: 14, t: 74 },
    '4': { l: 66, t: 76 },
    '5': { l: 34, t: 76 },
    '6': { l: 72, t: 50 },
    '7': { l: 50, t: 52 },
    '8': { l: 28, t: 50 },
    '9': { l: 50, t: 34 },
    '10': { l: 58, t: 20 },
    '11': { l: 42, t: 20 },
  },
  '5-2-3': {
    '1': { l: 50, t: 90 },
    '2': { l: 92, t: 70 },
    '3': { l: 74, t: 74 },
    '4': { l: 50, t: 76 },
    '5': { l: 26, t: 74 },
    '6': { l: 8, t: 70 },
    '7': { l: 68, t: 48 },
    '8': { l: 32, t: 48 },
    '9': { l: 82, t: 28 },
    '10': { l: 50, t: 22 },
    '11': { l: 18, t: 28 },
  },
};

function formationGridKeyFromString(formationStr) {
  const lines = parseFormationLines(formationStr);
  return lines ? lines.join('-') : null;
}

/** Stáhne hráče od bočních čar (méně ořezů u křídel). */
function compressPitchLeftTowardCenter(leftPct, factor = 0.9) {
  const v = 50 + (leftPct - 50) * factor;
  return Math.min(90, Math.max(10, v));
}

/**
 * @returns {Array|null} umístění podle ESPN slotů, nebo null → použij fallback
 */
function assignPitchFromEspnSlotGrid(list, flip, formationStr) {
  const key = formationGridKeyFromString(formationStr);
  const grid = key ? FORMATION_SLOT_PCT_HOME[key] : null;
  if (!grid || list.length !== 11) return null;

  const byPlace = {};
  for (const p of list) {
    const fp = String(p.formationPlace ?? '').trim();
    if (!fp || byPlace[fp]) return null;
    if (!grid[fp]) return null;
    byPlace[fp] = p;
  }
  if (Object.keys(byPlace).length !== 11) return null;

  const placed = list.map((p) => {
    const slot = grid[String(p.formationPlace)];
    const t = flip ? 100 - slot.t : slot.t;
    return {
      ...p,
      // V grid režimu chceme přesné x souřadnice podle slotu (formationPlace),
      // aby hráči seděli "každý na svém".
      pitchLeft: Math.round(slot.l * 10) / 10,
      pitchTop: Math.round(t * 10) / 10,
    };
  });
  placed.sort(
    (a, b) =>
      (parseInt(String(a.formationPlace), 10) || 99) -
      (parseInt(String(b.formationPlace), 10) || 99),
  );
  return placed;
}

/**
 * Hloubka pro řazení do řádků formace (nižší = blíž vlastní brance).
 * Outfield jen - brankář se bere zvlášť.
 */
function depthScoreForFormationSlice(player) {
  const L = String(player.positionName || '').toUpperCase();
  const ab = String(player.positionAbbr || player.position || '').toUpperCase();

  if (L.includes('DEFENSIVE MIDFIELD') || ab === 'DM') return 15;

  if (
    L.includes('LEFT BACK') ||
    L.includes('RIGHT BACK') ||
    (L.includes('CENTER') && L.includes('DEFENDER')) ||
    L.includes('CD-') ||
    (L.includes('DEFENDER') && !L.includes('MIDFIELD')) ||
    ab === 'LB' ||
    ab === 'RB'
  ) {
    return 10;
  }

  if (L.includes('ATTACKING MIDFIELD')) return 40;

  if ((L.includes('FORWARD') || ab === 'F' || L.includes('STRIKER')) && !L.includes('MIDFIELD')) {
    return 60;
  }

  if (L.includes('LEFT MIDFIELDER') || L.includes('RIGHT MIDFIELDER') || ab === 'LM' || ab === 'RM') {
    return 25;
  }

  if ((L.includes('CENTER') && L.includes('MIDFIELD')) || ab === 'CM') return 22;

  return 30;
}

/** Pořadí v řádku zleva doprava podle strany z ESPN popisu. */
function lateralHint(player) {
  const L = String(player.positionName || '').toUpperCase();
  const ab = String(player.positionAbbr || player.position || '').toUpperCase();

  if (L.includes('LEFT BACK') || L.includes('LEFT MIDFIELDER') || L.includes('ATTACKING MIDFIELDER LEFT')) {
    return 5;
  }
  if (ab === 'LB' || ab === 'LM') return 5;

  if (L.includes('RIGHT BACK') || L.includes('RIGHT MIDFIELDER') || L.includes('ATTACKING MIDFIELDER RIGHT')) {
    return 95;
  }
  if (ab === 'RB' || ab === 'RM') return 95;

  if (L.includes('CENTER LEFT')) return 32;
  if (L.includes('CENTER RIGHT')) return 68;

  if (L.includes('ATTACKING MIDFIELDER') && !L.includes('LEFT') && !L.includes('RIGHT')) return 50;
  if ((L.includes('FORWARD') || ab === 'F') && !L.includes('MIDFIELD')) return 50;

  const fp = parseInt(String(player.formationPlace || ''), 10);
  return Number.isFinite(fp) ? 15 + fp * 6 : 50;
}

function rowTopPercentsFormation(numRows, flip) {
  if (numRows <= 0) return [];
  if (numRows === 1) return [flip ? 12 : 88];
  const out = [];
  for (let r = 0; r < numRows; r++) {
    const t = r / (numRows - 1);
    if (flip) out.push(12 + t * 76);
    else out.push(88 - t * 76);
  }
  return out;
}

function spreadXInFormationRow(rowPlayers) {
  // Fallback: seřadíme podle formationPlace (slot číslo), ne podle detekce role,
  // aby se hráči "nepřehazovali" v rámci řádku.
  const sorted = [...rowPlayers].sort(
    (a, b) =>
      (parseInt(String(a.formationPlace), 10) || 0) -
      (parseInt(String(b.formationPlace), 10) || 0),
  );
  const n = sorted.length;
  const margin = 6;
  const usable = 88;
  return sorted.map((p, i) => {
    const raw = n === 1 ? 50 : margin + ((i + 1) / (n + 1)) * usable;
    const left = Math.min(90, Math.max(10, raw));
    return { ...p, pitchLeft: Math.round(left * 10) / 10 };
  });
}

function isGoalkeeperPlayer(p) {
  const L = String(p.positionName || '').toUpperCase();
  const ab = String(p.positionAbbr || p.position || '').toUpperCase();
  return L.includes('GOALKEEPER') || ab === 'G';
}

/**
 * Souřadnice na hřišti z ESPN `position.name` / zkratky (API neposílá x/y).
 * Domácí: vlastní branka dole (vysoké top %). Hosté: stejná logika, pak flip přes enrich.
 */
function pitchPercentsFromEspnRoles(player) {
  const long = String(player.positionName || '').trim();
  const abbr = String(player.positionAbbr || player.position || '').trim();
  const L = long.toUpperCase();
  const ab = abbr.toUpperCase();
  const s = `${L} ${ab}`;

  if (L.includes('GOALKEEPER') || ab === 'G') {
    return { topHome: 89, left: 50 };
  }

  let topHome = 47;
  if (L.includes('ATTACKING MIDFIELD')) topHome = 33;
  else if (L.includes('DEFENSIVE MIDFIELD') || ab === 'DM') topHome = 57;
  else if (
    (ab === 'F' || L === 'FORWARD' || L.includes('STRIKER')) &&
    !L.includes('MIDFIELD')
  ) {
    topHome = 23;
  } else if (
    L.includes('MIDFIELD') ||
    ab === 'CM' ||
    ab === 'LM' ||
    ab === 'RM' ||
    ab === 'WM'
  ) {
    topHome = 45;
  } else if (
    L.includes('BACK') ||
    L.includes('DEFENDER') ||
    L.includes(' CD-') ||
    ab === 'CB' ||
    ab === 'LB' ||
    ab === 'RB'
  ) {
    topHome = 71;
  }

  let left = 50;
  if (L.includes('LEFT BACK') || ab === 'LB') left = 16;
  else if (L.includes('RIGHT BACK') || ab === 'RB') left = 84;
  else if (L.includes('LEFT MIDFIELDER') || ab === 'LM') left = 14;
  else if (L.includes('RIGHT MIDFIELDER') || ab === 'RM') left = 86;
  else if (L.includes('ATTACKING MIDFIELDER LEFT')) left = 22;
  else if (L.includes('ATTACKING MIDFIELDER RIGHT')) left = 78;
  else if (L.includes('CENTER LEFT DEFENDER') || L.includes('CENTER LEFT MID')) left = 36;
  else if (L.includes('CENTER RIGHT DEFENDER') || L.includes('CENTER RIGHT MID')) left = 64;
  else if (L.includes('ATTACKING MIDFIELDER') && !L.includes('LEFT') && !L.includes('RIGHT')) left = 50;
  else if ((L.includes('FORWARD') || ab === 'F') && !L.includes('MIDFIELD')) left = 50;

  const fp = parseInt(String(player.formationPlace || ''), 10);
  const nudge = Number.isFinite(fp) ? (fp - 6) * 0.4 : 0;
  left = Math.min(91, Math.max(9, left + nudge));

  return { topHome, left };
}

function assignPitchPlayersRoleFallback(list, flip) {
  const placed = list.map((p) => {
    const { topHome, left } = pitchPercentsFromEspnRoles(p);
    const top = flip ? 100 - topHome : topHome;
    return {
      ...p,
      pitchLeft: Math.round(left * 10) / 10,
      pitchTop: Math.round(top * 10) / 10,
    };
  });
  placed.sort(
    (a, b) =>
      (parseInt(String(a.formationPlace), 10) || 99) -
      (parseInt(String(b.formationPlace), 10) || 99),
  );
  return placed;
}

/**
 * Řádky = brankář + čísla z formace (např. 4-2-3-1). Hráče v poli řadíme podle hloubky role z ESPN,
 * v řádku zleva doprava podle Left/Center/Right z popisu pozice.
 */
function assignPitchPlayersFromEspn(starters, side, formationStr) {
  // UI chce mít obě hrací pole ve stejném směru (zdola nahoru),
  // takže nepřeklápíme pitchTop ani řádky podle "away".
  const flip = false;
  const list = starters.slice(0, 11).map((p) => ({ ...p }));
  if (!list.length) return [];

  const fromGrid = assignPitchFromEspnSlotGrid(list, flip, formationStr);
  if (fromGrid) return fromGrid;

  const lines = parseFormationLines(formationStr);
  if (!lines || list.length !== 11) return assignPitchPlayersRoleFallback(list, flip);

  const gk = list.filter(isGoalkeeperPlayer);
  const outfield = list.filter((p) => !isGoalkeeperPlayer(p));
  if (gk.length !== 1 || outfield.length !== 10) return assignPitchPlayersRoleFallback(list, flip);

  outfield.sort((a, b) => {
    const da = depthScoreForFormationSlice(a);
    const db = depthScoreForFormationSlice(b);
    if (da !== db) return da - db;
    return (
      (parseInt(String(a.formationPlace), 10) || 99) -
      (parseInt(String(b.formationPlace), 10) || 99)
    );
  });

  const rows = [[gk[0]]];
  let idx = 0;
  for (const count of lines) {
    rows.push(outfield.slice(idx, idx + count));
    idx += count;
  }
  if (idx !== outfield.length) {
    return assignPitchPlayersRoleFallback(list, flip);
  }

  const rowYs = rowTopPercentsFormation(rows.length, flip);
  const result = [];
  for (let r = 0; r < rows.length; r++) {
    const y = rowYs[r];
    const withX = spreadXInFormationRow(rows[r]).map((p) => ({
      ...p,
      pitchTop: Math.round(y * 10) / 10,
    }));
    result.push(...withX);
  }

  result.sort(
    (a, b) =>
      (parseInt(String(a.formationPlace), 10) || 99) -
      (parseInt(String(b.formationPlace), 10) || 99),
  );
  return result;
}

function enrichLineupsWithPitch(lineups, formations) {
  if (!lineups) return { home: null, away: null };
  const next = { home: null, away: null };
  for (const side of ['home', 'away']) {
    const lu = lineups[side];
    if (!lu) continue;
    const form = formations?.[side] ?? null;
    const starters = lu.starters || [];
    next[side] = {
      ...lu,
      pitchPlayers: assignPitchPlayersFromEspn(starters, side, form),
      formationLabel: formatFormationLabel(form),
    };
  }
  return next;
}

/** Formace z `rosters[].formation` - na site.api je to hlavní zdroj (boxscore.form ji často nemá). */
function formationsFromRosterBlocks(blocks, competitorHomeId, competitorAwayId) {
  const out = { home: null, away: null };
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks) {
    let ha = block?.homeAway;
    const tid = block?.team?.id != null ? String(block.team.id) : null;
    if ((ha !== 'home' && ha !== 'away') && tid) {
      if (competitorHomeId && tid === competitorHomeId) ha = 'home';
      else if (competitorAwayId && tid === competitorAwayId) ha = 'away';
    }
    if (ha !== 'home' && ha !== 'away') continue;
    const f = block?.formation != null ? String(block.formation).trim() : null;
    if (f) out[ha] = f;
  }
  return out;
}

/**
 * Fotbalové summary na site.api má často `rosters` (někdy i `lineups`) ve tvaru
 * [{ homeAway, team, roster: [{ athlete, starter, jersey, position }] }].
 * `boxscore.players` u zápasu často chybí – odtud bereme sestavy.
 */
function lineupsFromEspnRosterBlocks(blocks, competitorHomeId, competitorAwayId) {
  const out = { home: null, away: null };
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks) {
    let ha = block?.homeAway;
    const tid = block?.team?.id != null ? String(block.team.id) : null;
    if ((ha !== 'home' && ha !== 'away') && tid) {
      if (competitorHomeId && tid === competitorHomeId) ha = 'home';
      else if (competitorAwayId && tid === competitorAwayId) ha = 'away';
    }
    if (ha !== 'home' && ha !== 'away') continue;
    const roster = Array.isArray(block?.roster) ? block.roster : [];
    const athletes = roster.map(mapEspnSummaryRosterPlayer).filter(Boolean);
    const split = splitLineupStartersBench(athletes);
    if (split) out[ha] = split;
  }
  return out;
}

function mergeMatchDetail(base, summaryPayload) {
  const header = summaryPayload?.header;
  const competition = header?.competitions?.[0];
  const venue =
    competition?.venue || summaryPayload?.gameInfo?.venue || summaryPayload?.boxscore?.gameInfo?.venue || null;
  const competitors = competition?.competitors || [];
  const home = competitors.find((c) => c?.homeAway === 'home');
  const away = competitors.find((c) => c?.homeAway === 'away');

  const officials =
    (Array.isArray(summaryPayload?.gameInfo?.officials) ? summaryPayload.gameInfo.officials : []) ||
    (Array.isArray(summaryPayload?.boxscore?.gameInfo?.officials) ? summaryPayload.boxscore.gameInfo.officials : []);
  const referee =
    Array.isArray(officials) && officials.length
      ? [...officials]
          .sort((a, b) => (Number(a?.order || 999) || 999) - (Number(b?.order || 999) || 999))
          .map((o) => o?.displayName || o?.fullName || null)
          .find(Boolean)
      : null;

  // Formations are not consistently on competitors; many summaries provide them via boxscore.form.
  const competitorHomeId = home?.team?.id != null ? String(home.team.id) : null;
  const competitorAwayId = away?.team?.id != null ? String(away.team.id) : null;
  const formEntries = Array.isArray(summaryPayload?.boxscore?.form) ? summaryPayload.boxscore.form : [];
  let formHome = null;
  let formAway = null;
  for (const f of formEntries) {
    const tid = f?.team?.id != null ? String(f.team.id) : null;
    const formation = f?.formation != null ? String(f.formation) : null;
    if (!tid || !formation) continue;
    if (competitorHomeId && tid === competitorHomeId) formHome = formation;
    if (competitorAwayId && tid === competitorAwayId) formAway = formation;
  }

  const links = Array.isArray(summaryPayload?.links) ? summaryPayload.links : [];
  const recap = links.find((l) => l?.rel?.includes?.('recap') && typeof l?.href === 'string') || null;

  const broadcasts = Array.isArray(competition?.broadcasts) ? competition.broadcasts : [];
  const broadcastNames = broadcasts
    .map((b) => b?.names)
    .flat()
    .filter(Boolean)
    .slice(0, 6);

  const details = statMapFromSummary(summaryPayload);

  // Scoring plays / timeline (best-effort, schema varies)
  const scoringPlays = Array.isArray(summaryPayload?.scoringPlays)
    ? summaryPayload.scoringPlays
    : Array.isArray(summaryPayload?.plays)
      ? summaryPayload.plays.filter((p) => p?.scoringPlay)
      : [];

  const timeline = scoringPlays
    .map((p) => {
      const clock = p?.clock?.displayValue || p?.clock?.value || null;
      const text = p?.text || p?.shortText || p?.type?.text || null;
      const teamName = p?.team?.displayName || p?.team?.name || null;
      const athlete =
        p?.athletesInvolved?.[0]?.displayName ||
        p?.participants?.[0]?.athlete?.displayName ||
        p?.participants?.[0]?.displayName ||
        null;
      if (!text && !athlete && !teamName) return null;
      return {
        clock: clock ? String(clock) : null,
        team: teamName ? String(teamName) : null,
        athlete: athlete ? String(athlete) : null,
        text: text ? String(text) : null,
      };
    })
    .filter(Boolean)
    .slice(0, 20);

  function parseMinuteSortKey(clock) {
    if (!clock) return null;
    const s = String(clock).trim();
    // Examples: "56'", "45+2'", "HT"
    const m = s.match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
    if (!m) return null;
    const base = parseInt(m[1], 10);
    const extra = m[2] ? parseInt(m[2], 10) : 0;
    if (!Number.isFinite(base)) return null;
    return base * 100 + (Number.isFinite(extra) ? extra : 0);
  }

  function buildGoals(payload) {
    const plays = Array.isArray(payload?.plays) ? payload.plays : [];
    const keyEvents = Array.isArray(payload?.keyEvents) ? payload.keyEvents : [];
    const scoringPlaysLocal = Array.isArray(payload?.scoringPlays)
      ? payload.scoringPlays
      : plays.filter((p) => p?.scoringPlay);

    function nameFromObj(obj) {
      if (!obj) return null;
      return obj.displayName || obj.fullName || obj.shortName || obj.name || null;
    }

    function extractAssistFromParticipants(parts) {
      if (!Array.isArray(parts) || !parts.length) return null;
      // ESPN schemas vary; try common patterns
      const assistPart =
        parts.find((p) => /assist/i.test(String(p?.type || ''))) ||
        parts.find((p) => /a\b/i.test(String(p?.type || ''))) ||
        null;
      const ath = assistPart?.athlete || assistPart;
      return nameFromObj(ath);
    }

    function extractAssistFromText(text) {
      const raw = String(text || '');
      // Examples: "Goal! X. Assisted by Y."
      const m = raw.match(/assisted\s+by\s+([^.;]+)[.;]?/i);
      if (!m) return null;
      let name = String(m[1]).trim();
      // Trim trailing descriptors like "with a cross", "from a corner", etc.
      name = name
        .replace(/\s+with\s+.*$/i, '')
        .replace(/\s+from\s+.*$/i, '')
        .replace(/\s*\(.*\)\s*$/i, '')
        .replace(/\s*-\s*.*$/i, '')
        .trim();
      return name || null;
    }

    function extractScorer(play) {
      const involved = Array.isArray(play?.athletesInvolved) ? play.athletesInvolved : [];
      const participants = Array.isArray(play?.participants) ? play.participants : [];
      const ath =
        involved?.[0] ||
        participants.find((p) => /scorer|goal/i.test(String(p?.type || '')) && p?.athlete)?.athlete ||
        participants.find((p) => p?.athlete)?.athlete ||
        null;
      return nameFromObj(ath);
    }

    const out = scoringPlaysLocal
      .map((p) => {
        const clock = p?.clock?.displayValue || p?.clock?.value || null;
        const text = p?.text || p?.shortText || null;
        const participants = Array.isArray(p?.participants) ? p.participants : [];
        const teamId = p?.team?.id != null ? String(p.team.id) : null;
        const team = p?.team?.displayName || p?.team?.name || p?.team?.shortDisplayName || null;
        const scorer = extractScorer(p);
        const assist = extractAssistFromParticipants(participants) || extractAssistFromText(text);
        if (!clock && !scorer) return null;
        return {
          clock: clock ? String(clock) : null,
          teamId,
          team: team ? String(team) : null,
          scorer: scorer ? String(scorer) : null,
          assist: assist ? String(assist) : null,
          sortKey: parseMinuteSortKey(clock),
        };
      })
      .filter(Boolean);

    // Fallback: some summaries only expose goals via keyEvents
    for (const ev of keyEvents) {
      const type = String(ev?.type?.text || ev?.type?.name || ev?.type || '').toLowerCase();
      const text = String(ev?.text || ev?.shortText || '').toLowerCase();
      const t = `${type} ${text}`;
      if (!t.includes('goal') && !t.includes('gól') && !t.includes('scored')) continue;

      const clock =
        ev?.clock?.displayValue ||
        ev?.time?.displayValue ||
        ev?.time?.value ||
        ev?.clock?.value ||
        null;
      const team =
        ev?.team?.displayName ||
        ev?.team?.name ||
        ev?.team?.shortDisplayName ||
        null;
      const teamId = ev?.team?.id != null ? String(ev.team.id) : null;
      const ath = ev?.athlete || ev?.player || ev?.participants?.[0]?.athlete || ev?.participants?.[0] || null;
      const scorer = nameFromObj(ath);

      const assist =
        nameFromObj(ev?.assistAthlete || ev?.assistPlayer || null) ||
        extractAssistFromText(ev?.text || ev?.shortText || '');

      if (!clock && !scorer) continue;
      out.push({
        clock: clock ? String(clock) : null,
        teamId,
        team: team ? String(team) : null,
        scorer: scorer ? String(scorer) : null,
        assist: assist ? String(assist) : null,
        sortKey: parseMinuteSortKey(clock),
      });
    }

    // Dedupe & sort by time
    const seen = new Set();
    const deduped = [];
    for (const g of out) {
      const key = `${g.clock || ''}||${g.scorer || ''}||${g.assist || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(g);
    }
    deduped.sort((a, b) => {
      const ak = a.sortKey;
      const bk = b.sortKey;
      if (ak != null && bk != null && ak !== bk) return ak - bk;
      if (ak != null && bk == null) return -1;
      if (ak == null && bk != null) return 1;
      return String(a.clock || '').localeCompare(String(b.clock || ''));
    });
    return deduped.slice(0, 30);
  }

  function buildYellowCards(payload) {
    const plays = Array.isArray(payload?.plays) ? payload.plays : [];
    const keyEvents = Array.isArray(payload?.keyEvents) ? payload.keyEvents : [];

    function nameFromObj(obj) {
      if (!obj) return null;
      return obj.displayName || obj.fullName || obj.shortName || obj.name || null;
    }

    function reasonToCzech(raw) {
      const s = String(raw || '').trim();
      if (!s) return null;
      const t = s.toLowerCase();
      const rules = [
        [/unsporting\s*behavior|unsporting\s*conduct/i, 'nesportovní chování'],
        [/time\s*wasting|delaying\s*the\s*restart|delay\s*of\s*game/i, 'zdržování hry'],
        [/dissent|arguing|complaining/i, 'protesty / nesouhlas'],
        [/foul|bad\s*foul|reckless/i, 'faul'],
        [/hand\s*ball|handball/i, 'hra rukou'],
        [/simulation|diving/i, 'simulování'],
        [/persistent\s*infringement/i, 'opakované přestupky'],
        [/dangerous\s*play/i, 'nebezpečná hra'],
      ];
      for (const [re, cz] of rules) {
        if (re.test(t)) return cz;
      }
      // fallback: return original (but trimmed)
      return s;
    }

    function extractReason(typeText, text) {
      const raw = String(text || typeText || '').trim();
      if (!raw) return null;
      // Common ESPN phrasing: "Yellow Card for <reason> (<player>)"
      // or "... (Reason: ...)"
      const m1 = raw.match(/\byellow\s*card\s*for\s+([^.(]+?)(?:\(|\.|$)/i);
      const m2 = raw.match(/\bfor\s+([^.(]+?)(?:\(|\.|$)/i);
      const m3 = raw.match(/\breason:\s*([^.)]+)\)?/i);
      const picked = (m1 && m1[1]) || (m3 && m3[1]) || (m2 && m2[1]) || null;
      if (!picked) return null;
      return reasonToCzech(picked);
    }

    function isYellowFromText(typeText, text) {
      const t = `${typeText || ''} ${text || ''}`.toLowerCase();
      // Be strict: avoid matching generic "yellow" strings that are not card events.
      return (
        t.includes('yellow card') ||
        t.includes('žlut') ||
        t.includes('booking') ||
        t.includes('caution') ||
        t.includes('second yellow')
      );
    }

    const out = [];

    for (const p of plays) {
      const typeText = p?.type?.text || p?.type?.name || '';
      const text = p?.text || p?.shortText || '';
      if (!isYellowFromText(typeText, text)) continue;

      const clock = p?.clock?.displayValue || p?.clock?.value || null;
      const sortKey = parseMinuteSortKey(clock);
      if (sortKey == null) continue;
      const teamId = p?.team?.id != null ? String(p.team.id) : null;
      const team = p?.team?.displayName || p?.team?.name || p?.team?.shortDisplayName || null;
      const reason = extractReason(typeText, text) || 'důvod neuveden';

      const involved = Array.isArray(p?.athletesInvolved) ? p.athletesInvolved : [];
      const participants = Array.isArray(p?.participants) ? p.participants : [];
      const athlete =
        involved?.[0] ||
        participants.find((x) => x?.athlete)?.athlete ||
        participants?.[0]?.athlete ||
        null;
      const player = nameFromObj(athlete) || participants?.[0]?.displayName || null;
      if (!clock && !player) continue;

      out.push({
        clock: clock ? String(clock) : null,
        teamId,
        team: team ? String(team) : null,
        player: player ? String(player) : null,
        reason: reason ? String(reason) : null,
        sortKey,
      });
    }

    for (const ev of keyEvents) {
      const typeText = ev?.type?.text || ev?.type?.name || ev?.type || '';
      const text = ev?.text || ev?.shortText || '';
      if (!isYellowFromText(typeText, text)) continue;

      const clock =
        ev?.clock?.displayValue ||
        ev?.time?.displayValue ||
        ev?.time?.value ||
        ev?.clock?.value ||
        null;
      const sortKey = parseMinuteSortKey(clock);
      if (sortKey == null) continue;
      const teamId = ev?.team?.id != null ? String(ev.team.id) : null;
      const team =
        ev?.team?.displayName ||
        ev?.team?.name ||
        ev?.team?.shortDisplayName ||
        null;
      const ath = ev?.athlete || ev?.player || ev?.participants?.[0]?.athlete || ev?.participants?.[0] || null;
      const player = nameFromObj(ath) || ev?.athleteDisplayName || null;
      const reason = extractReason(typeText, text) || 'důvod neuveden';
      if (!clock && !player) continue;

      out.push({
        clock: clock ? String(clock) : null,
        teamId,
        team: team ? String(team) : null,
        player: player ? String(player) : null,
        reason: reason ? String(reason) : null,
        sortKey,
      });
    }

    const seen = new Set();
    const deduped = [];
    for (const c of out) {
      const key = `${c.sortKey || ''}||${c.player || ''}||${c.teamId || c.team || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }
    deduped.sort((a, b) => {
      const ak = a.sortKey;
      const bk = b.sortKey;
      if (ak != null && bk != null && ak !== bk) return ak - bk;
      if (ak != null && bk == null) return -1;
      if (ak == null && bk != null) return 1;
      return String(a.clock || '').localeCompare(String(b.clock || ''));
    });
    return deduped.slice(0, 40);
  }

  function buildRedCards(payload) {
    const plays = Array.isArray(payload?.plays) ? payload.plays : [];
    const keyEvents = Array.isArray(payload?.keyEvents) ? payload.keyEvents : [];

    function nameFromObj(obj) {
      if (!obj) return null;
      return obj.displayName || obj.fullName || obj.shortName || obj.name || null;
    }

    function reasonToCzech(raw) {
      const s = String(raw || '').trim();
      if (!s) return null;
      const t = s.toLowerCase();
      const rules = [
        [/unsporting\s*behavior|unsporting\s*conduct/i, 'nesportovní chování'],
        [/time\s*wasting|delaying\s*the\s*restart|delay\s*of\s*game/i, 'zdržování hry'],
        [/dissent|arguing|complaining/i, 'protesty / nesouhlas'],
        [/foul|bad\s*foul|reckless/i, 'faul'],
        [/hand\s*ball|handball/i, 'hra rukou'],
        [/simulation|diving/i, 'simulování'],
        [/persistent\s*infringement/i, 'opakované přestupky'],
        [/dangerous\s*play/i, 'nebezpečná hra'],
        [/violent\s*conduct/i, 'násilné chování'],
        [/serious\s*foul\s*play/i, 'hrubý faul'],
        [/denial\s+of\s+goal|denying\s+an?\s+obvious\s+goal/i, 'zmaření zjevné brankové příležitosti'],
      ];
      for (const [re, cz] of rules) {
        if (re.test(t)) return cz;
      }
      return s;
    }

    function extractReason(typeText, text) {
      const raw = String(text || typeText || '').trim();
      if (!raw) return null;
      const m1 = raw.match(/\bred\s*card\s*for\s+([^.(]+?)(?:\(|\.|$)/i);
      const m2 = raw.match(/\bfor\s+([^.(]+?)(?:\(|\.|$)/i);
      const m3 = raw.match(/\breason:\s*([^.)]+)\)?/i);
      const picked = (m1 && m1[1]) || (m3 && m3[1]) || (m2 && m2[1]) || null;
      if (!picked) return null;
      return reasonToCzech(picked);
    }

    function isRedFromText(typeText, text) {
      const t = `${typeText || ''} ${text || ''}`.toLowerCase();
      return (
        t.includes('red card') ||
        t.includes('červen') ||
        (t.includes('red') && t.includes('card')) ||
        t.includes('sent off') ||
        t.includes('dismiss') ||
        t.includes('second yellow')
      );
    }

    const out = [];

    for (const p of plays) {
      const typeText = p?.type?.text || p?.type?.name || '';
      const text = p?.text || p?.shortText || '';
      if (!isRedFromText(typeText, text)) continue;

      const clock = p?.clock?.displayValue || p?.clock?.value || null;
      const teamId = p?.team?.id != null ? String(p.team.id) : null;
      const team = p?.team?.displayName || p?.team?.name || p?.team?.shortDisplayName || null;
      const reason = extractReason(typeText, text) || 'důvod neuveden';
      const t = `${typeText || ''} ${text || ''}`.toLowerCase();
      const finalReason = t.includes('second yellow') ? 'druhá žlutá karta' : reason;

      const involved = Array.isArray(p?.athletesInvolved) ? p.athletesInvolved : [];
      const participants = Array.isArray(p?.participants) ? p.participants : [];
      const athlete =
        involved?.[0] ||
        participants.find((x) => x?.athlete)?.athlete ||
        participants?.[0]?.athlete ||
        null;
      const player = nameFromObj(athlete) || participants?.[0]?.displayName || null;
      if (!clock && !player) continue;

      out.push({
        clock: clock ? String(clock) : null,
        teamId,
        team: team ? String(team) : null,
        player: player ? String(player) : null,
        reason: finalReason ? String(finalReason) : null,
        sortKey: parseMinuteSortKey(clock),
      });
    }

    for (const ev of keyEvents) {
      const typeText = ev?.type?.text || ev?.type?.name || ev?.type || '';
      const text = ev?.text || ev?.shortText || '';
      if (!isRedFromText(typeText, text)) continue;

      const clock =
        ev?.clock?.displayValue ||
        ev?.time?.displayValue ||
        ev?.time?.value ||
        ev?.clock?.value ||
        null;
      const teamId = ev?.team?.id != null ? String(ev.team.id) : null;
      const team =
        ev?.team?.displayName ||
        ev?.team?.name ||
        ev?.team?.shortDisplayName ||
        null;
      const ath = ev?.athlete || ev?.player || ev?.participants?.[0]?.athlete || ev?.participants?.[0] || null;
      const player = nameFromObj(ath) || ev?.athleteDisplayName || null;
      const reason = extractReason(typeText, text) || 'důvod neuveden';
      const t = `${typeText || ''} ${text || ''}`.toLowerCase();
      const finalReason = t.includes('second yellow') ? 'druhá žlutá karta' : reason;
      if (!clock && !player) continue;

      out.push({
        clock: clock ? String(clock) : null,
        teamId,
        team: team ? String(team) : null,
        player: player ? String(player) : null,
        reason: finalReason ? String(finalReason) : null,
        sortKey: parseMinuteSortKey(clock),
      });
    }

    const seen = new Set();
    const deduped = [];
    for (const c of out) {
      const key = `${c.clock || ''}||${c.player || ''}||${c.teamId || c.team || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }
    deduped.sort((a, b) => {
      const ak = a.sortKey;
      const bk = b.sortKey;
      if (ak != null && bk != null && ak !== bk) return ak - bk;
      if (ak != null && bk == null) return -1;
      if (ak == null && bk != null) return 1;
      return String(a.clock || '').localeCompare(String(b.clock || ''));
    });
    return deduped.slice(0, 20);
  }

  // Leaders / top performers (best-effort)
  const leaders = Array.isArray(summaryPayload?.leaders) ? summaryPayload.leaders : [];
  const topPerformers = leaders
    .map((group) => {
      const cat = group?.displayName || group?.name || null;
      const leader = group?.leaders?.[0];
      const athlete = leader?.athlete?.displayName || leader?.athlete?.shortName || null;
      const value = leader?.displayValue || leader?.value || null;
      if (!cat || !athlete) return null;
      return { category: String(cat), athlete: String(athlete), value: value != null ? String(value) : null };
    })
    .filter(Boolean)
    .slice(0, 8);

  // Boxscore / team stats table (best-effort)
  const boxTeams = Array.isArray(summaryPayload?.boxscore?.teams) ? summaryPayload.boxscore.teams : [];
  const boxByHomeAway = {};
  for (const t of boxTeams) {
    let ha = t?.homeAway;
    const tid = t?.team?.id != null ? String(t.team.id) : null;
    if ((ha !== 'home' && ha !== 'away') && tid) {
      if (competitorHomeId && tid === competitorHomeId) ha = 'home';
      else if (competitorAwayId && tid === competitorAwayId) ha = 'away';
    }
    if (ha === 'home' || ha === 'away') boxByHomeAway[ha] = t;
  }
  const boxStats = [];
  const homeBoxStats = Array.isArray(boxByHomeAway.home?.statistics) ? boxByHomeAway.home.statistics : [];
  const awayBoxStats = Array.isArray(boxByHomeAway.away?.statistics) ? boxByHomeAway.away.statistics : [];
  // If home/away still missing (ESPN schema quirks), fall back to first/second by team id order.
  if ((!homeBoxStats.length || !awayBoxStats.length) && boxTeams.length >= 2) {
    const t0id = boxTeams[0]?.team?.id != null ? String(boxTeams[0].team.id) : null;
    const t1id = boxTeams[1]?.team?.id != null ? String(boxTeams[1].team.id) : null;
    if (!homeBoxStats.length && competitorHomeId && t0id === competitorHomeId) {
      const s = Array.isArray(boxTeams[0]?.statistics) ? boxTeams[0].statistics : [];
      if (s.length) boxByHomeAway.home = boxTeams[0];
    } else if (!homeBoxStats.length && competitorHomeId && t1id === competitorHomeId) {
      const s = Array.isArray(boxTeams[1]?.statistics) ? boxTeams[1].statistics : [];
      if (s.length) boxByHomeAway.home = boxTeams[1];
    }
    if (!awayBoxStats.length && competitorAwayId && t0id === competitorAwayId) {
      const s = Array.isArray(boxTeams[0]?.statistics) ? boxTeams[0].statistics : [];
      if (s.length) boxByHomeAway.away = boxTeams[0];
    } else if (!awayBoxStats.length && competitorAwayId && t1id === competitorAwayId) {
      const s = Array.isArray(boxTeams[1]?.statistics) ? boxTeams[1].statistics : [];
      if (s.length) boxByHomeAway.away = boxTeams[1];
    }
  }
  const homeBoxStats2 = Array.isArray(boxByHomeAway.home?.statistics) ? boxByHomeAway.home.statistics : homeBoxStats;
  const awayBoxStats2 = Array.isArray(boxByHomeAway.away?.statistics) ? boxByHomeAway.away.statistics : awayBoxStats;
  const byNameAway = new Map(awayBoxStats2.map((s) => [s?.name, s]));
  for (const hs of homeBoxStats2) {
    const name = hs?.name;
    if (!name || !CORE_FOOTBALL_STAT_NAMES.has(name)) continue;
    const as = byNameAway.get(name);
    const label = hs?.label || hs?.displayName || name;
    const hv = hs?.displayValue ?? hs?.value;
    const av = as?.displayValue ?? as?.value;
    if (hv == null && av == null) continue;
    boxStats.push({
      name,
      label: czechStatLabel(name, label),
      home: hv != null ? String(hv) : null,
      away: av != null ? String(av) : null,
    });
  }
  boxStats.sort(
    (a, b) =>
      CORE_FOOTBALL_STAT_ORDER.indexOf(a.name) - CORE_FOOTBALL_STAT_ORDER.indexOf(b.name),
  );

  // Headlines / story (best-effort)
  const headlines = Array.isArray(summaryPayload?.headlines) ? summaryPayload.headlines : [];
  const story = headlines[0]
    ? {
        title: headlines[0]?.headline || null,
        description: headlines[0]?.description || null,
        shortLink: headlines[0]?.links?.web?.href || null,
        byline: headlines[0]?.byline || null,
      }
    : null;

  // Lineups: `rosters` / `lineups` na summary (site.api), jinak boxscore.players
  const boxPlayers = Array.isArray(summaryPayload?.boxscore?.players)
    ? summaryPayload.boxscore.players
    : [];
  const fromLineupsKey = lineupsFromEspnRosterBlocks(
    Array.isArray(summaryPayload?.lineups) ? summaryPayload.lineups : [],
    competitorHomeId,
    competitorAwayId,
  );
  const fromRosters = lineupsFromEspnRosterBlocks(
    Array.isArray(summaryPayload?.rosters) ? summaryPayload.rosters : [],
    competitorHomeId,
    competitorAwayId,
  );
  let lineups = {
    home: fromLineupsKey.home || fromRosters.home || null,
    away: fromLineupsKey.away || fromRosters.away || null,
  };

  function extractTeamLineup(teamBlock) {
    const statsGroups = Array.isArray(teamBlock?.statistics) ? teamBlock.statistics : [];
    const athletes = [];
    for (const g of statsGroups) {
      const groupAthletes = Array.isArray(g?.athletes) ? g.athletes : [];
      for (const a of groupAthletes) {
        const ath = a?.athlete || a;
        if (!ath || (!ath.displayName && !ath.shortName)) continue;
        athletes.push({
          athleteId: ath.id != null ? String(ath.id) : null,
          name: ath.displayName || ath.shortName || null,
          position: ath.position?.abbreviation || ath.position?.name || null,
          positionName: ath.position?.name || null,
          positionAbbr: ath.position?.abbreviation || null,
          jersey: ath.jersey != null ? String(ath.jersey) : null,
          starter: a.starter === true,
          headshot: ath.headshot?.href || null,
          formationPlace: a?.formationPlace != null ? String(a.formationPlace) : null,
        });
      }
    }
    return splitLineupStartersBench(athletes);
  }

  function normalizePlayerNameKey(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    // Strip diacritics to make matching ESPN vs UI names more forgiving.
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function summarizePlayerEventsFromPlays(payload) {
    const plays = Array.isArray(payload?.plays) ? payload.plays : [];
    const scoringPlays = Array.isArray(payload?.scoringPlays)
      ? payload.scoringPlays
      : plays.filter((p) => p?.scoringPlay);
    const keyEvents = Array.isArray(payload?.keyEvents) ? payload.keyEvents : [];

    const byAthleteId = new Map(); // athleteId -> {goals,yellow,red,subIn,subOut}
    const byNameKey = new Map(); // fallback (name->events)

    function getOrInit(key, map) {
      if (!map.has(key)) map.set(key, { goals: 0, yellow: 0, red: 0, subIn: 0, subOut: 0 });
      return map.get(key);
    }

    function classify(text, typeText, scoringPlay) {
      const t = `${typeText} ${text}`.toLowerCase();
      if (scoringPlay === true || t.includes('goal')) return 'goal';
      if (t.includes('yellow card')) return 'yellow';
      if (t.includes('red card')) return 'red';
      if (t.includes('substitution')) return 'sub';
      return null;
    }

    function addForNameOrId(idMaybe, nameMaybe, field, amount = 1) {
      const id = idMaybe != null && idMaybe !== '' ? String(idMaybe) : null;
      const name = nameMaybe != null ? String(nameMaybe) : '';
      if (id) {
        const e = getOrInit(id, byAthleteId);
        e[field] = (e[field] || 0) + amount;
        // also index by name as helper
        const nk = normalizePlayerNameKey(name);
        if (nk) {
          const en = getOrInit(nk, byNameKey);
          en[field] = (en[field] || 0) + amount;
          const last = nk.split(' ').pop();
          if (last && last.length >= 3) {
            const el = getOrInit(last, byNameKey);
            el[field] = (el[field] || 0) + amount;
          }
        }
        return;
      }
      const nk = normalizePlayerNameKey(name);
      if (!nk) return;
      const e = getOrInit(nk, byNameKey);
      e[field] = (e[field] || 0) + amount;
      const last = nk.split(' ').pop();
      if (last && last.length >= 3) {
        const el = getOrInit(last, byNameKey);
        el[field] = (el[field] || 0) + amount;
      }
    }

    function extractAthleteFromPlay(play) {
      const participants = Array.isArray(play?.participants) ? play.participants : [];
      const involved = Array.isArray(play?.athletesInvolved) ? play.athletesInvolved : [];
      const athObj =
        involved?.[0] ||
        participants.find((p) => p?.athlete)?.athlete ||
        participants?.[0]?.athlete ||
        null;
      const id =
        athObj?.id ??
        participants?.[0]?.athlete?.id ??
        participants?.[0]?.id ??
        null;
      const name =
        athObj?.displayName ||
        athObj?.fullName ||
        athObj?.shortName ||
        participants?.[0]?.athlete?.displayName ||
        participants?.[0]?.displayName ||
        null;
      return { id, name, participants };
    }

    function extractAthleteFromKeyEvent(ev) {
      const ath =
        ev?.athlete ||
        ev?.player ||
        ev?.participants?.[0]?.athlete ||
        ev?.participants?.[0] ||
        null;
      const id = ath?.id ?? ev?.athleteId ?? ev?.playerId ?? null;
      const name = ath?.displayName || ath?.fullName || ath?.shortName || ev?.athleteDisplayName || null;
      return { id, name };
    }

    for (const ev of keyEvents) {
      const type =
        String(ev?.type?.text || ev?.type?.name || ev?.type || ev?.category || '').toLowerCase();
      const text = String(ev?.text || ev?.shortText || '').toLowerCase();
      const t = `${type} ${text}`;

      let kind = null;
      if (t.includes('goal') || t.includes('gól') || t.includes('scored')) kind = 'goal';
      else if (t.includes('yellow') || t.includes('žlut')) kind = 'yellow';
      else if (t.includes('red') || t.includes('červen')) kind = 'red';
      else if (t.includes('sub') || t.includes('stříd')) kind = 'sub';

      if (!kind) continue;

      if (kind === 'sub') {
        const inAth = ev?.inAthlete || ev?.playerIn || ev?.inPlayer || null;
        const outAth = ev?.outAthlete || ev?.playerOut || ev?.outPlayer || null;
        if (inAth) {
          addForNameOrId(inAth.id, inAth.displayName || inAth.fullName || null, 'subIn', 1);
        }
        if (outAth) {
          addForNameOrId(outAth.id, outAth.displayName || outAth.fullName || null, 'subOut', 1);
        }
        continue;
      }

      const { id, name } = extractAthleteFromKeyEvent(ev);
      if (kind === 'goal') addForNameOrId(id, name, 'goals', 1);
      if (kind === 'yellow') addForNameOrId(id, name, 'yellow', 1);
      if (kind === 'red') addForNameOrId(id, name, 'red', 1);
    }

    for (const play of scoringPlays) {
      const text = play?.text || play?.shortText || '';
      const typeText = play?.type?.text || play?.type?.name || '';
      const kind = classify(text, typeText, true);
      if (kind !== 'goal') continue;
      const { id, name } = extractAthleteFromPlay(play);
      addForNameOrId(id, name, 'goals', 1);
    }

    for (const play of plays) {
      const text = play?.text || play?.shortText || '';
      const typeText = play?.type?.text || play?.type?.name || '';
      const kind = classify(text, typeText, play?.scoringPlay === true);
      if (!kind) continue;

      const { id, name, participants } = extractAthleteFromPlay(play);

      if (kind === 'goal') {
        addForNameOrId(id, name, 'goals', 1);
      } else if (kind === 'yellow') {
        addForNameOrId(id, name, 'yellow', 1);
      } else if (kind === 'red') {
        addForNameOrId(id, name, 'red', 1);
      } else if (kind === 'sub') {
        const inPart =
          participants.find((p) => /player.?in/i.test(String(p?.type || ''))) ||
          participants.find((p) => /\bin\b/i.test(String(p?.type || ''))) ||
          null;
        const outPart =
          participants.find((p) => /player.?out/i.test(String(p?.type || ''))) ||
          participants.find((p) => /\bout\b/i.test(String(p?.type || ''))) ||
          null;

        if (inPart?.athlete) {
          addForNameOrId(
            inPart.athlete.id,
            inPart.athlete.displayName || inPart.athlete.fullName || inPart.displayName || null,
            'subIn',
            1,
          );
        }
        if (outPart?.athlete) {
          addForNameOrId(
            outPart.athlete.id,
            outPart.athlete.displayName || outPart.athlete.fullName || outPart.displayName || null,
            'subOut',
            1,
          );
        }
      }
    }

    return { byAthleteId, byNameKey };
  }

  function attachEventsToLineups(lineupsEnriched, playerEvents) {
    if (!lineupsEnriched) return lineupsEnriched;
    if (!playerEvents) return lineupsEnriched;

    const { byAthleteId, byNameKey } = playerEvents;

    function eventsForPlayer(p) {
      const id = p?.athleteId != null ? String(p.athleteId) : null;
      if (id && byAthleteId.has(id)) return byAthleteId.get(id);
      const nk = normalizePlayerNameKey(p?.name);
      if (nk) {
        if (byNameKey.has(nk)) return byNameKey.get(nk);
        const last = nk.split(' ').pop();
        if (last && byNameKey.has(last)) return byNameKey.get(last);
      }
      return null;
    }

    function withEvents(p) {
      const e = eventsForPlayer(p);
      if (!e) return p;
      return { ...p, events: { ...e } };
    }

    const next = { ...lineupsEnriched };
    for (const side of ['home', 'away']) {
      const lu = next[side];
      if (!lu) continue;
      next[side] = {
        ...lu,
        starters: Array.isArray(lu.starters) ? lu.starters.map(withEvents) : lu.starters,
        bench: Array.isArray(lu.bench) ? lu.bench.map(withEvents) : lu.bench,
        pitchPlayers: Array.isArray(lu.pitchPlayers) ? lu.pitchPlayers.map(withEvents) : lu.pitchPlayers,
      };
    }
    return next;
  }

  for (const teamBlock of boxPlayers) {
    let ha = teamBlock?.team?.homeAway;
    const tid = teamBlock?.team?.id != null ? String(teamBlock.team.id) : null;
    if ((ha !== 'home' && ha !== 'away') && tid) {
      if (competitorHomeId && tid === competitorHomeId) ha = 'home';
      else if (competitorAwayId && tid === competitorAwayId) ha = 'away';
    }
    if (ha !== 'home' && ha !== 'away') continue;
    if (lineups[ha]) continue;
    const l = extractTeamLineup(teamBlock);
    if (l) lineups[ha] = l;
  }

  const rosterFormations = formationsFromRosterBlocks(
    Array.isArray(summaryPayload?.rosters) ? summaryPayload.rosters : [],
    competitorHomeId,
    competitorAwayId,
  );
  const formationsResolved = {
    home: rosterFormations.home || base?.formations?.home || formHome || home?.formation || null,
    away: rosterFormations.away || base?.formations?.away || formAway || away?.formation || null,
  };

  const leagueResolved =
    leagueToCzech(
      base?.league ||
        header?.leagues?.[0]?.name ||
        header?.league?.name ||
        summaryPayload?.season?.slug ||
        null,
    ) || base?.league || null;

  const enrichedLineups = enrichLineupsWithPitch(lineups, formationsResolved);
  const playerEvents = summarizePlayerEventsFromPlays(summaryPayload);
  const lineupsWithEvents = attachEventsToLineups(enrichedLineups, playerEvents);
  const goalsRaw = buildGoals(summaryPayload);
  const goals = (Array.isArray(goalsRaw) ? goalsRaw : []).map((g) => {
    const tid = g?.teamId != null ? String(g.teamId) : null;
    if (tid && competitorHomeId && tid === competitorHomeId) {
      return { ...g, team: base?.teams?.home?.name || g.team };
    }
    if (tid && competitorAwayId && tid === competitorAwayId) {
      return { ...g, team: base?.teams?.away?.name || g.team };
    }
    return g;
  });
  const yellowCardsRaw = buildYellowCards(summaryPayload);
  const yellowCards = (Array.isArray(yellowCardsRaw) ? yellowCardsRaw : []).map((c) => {
    const tid = c?.teamId != null ? String(c.teamId) : null;
    if (tid && competitorHomeId && tid === competitorHomeId) {
      return { ...c, team: base?.teams?.home?.name || c.team };
    }
    if (tid && competitorAwayId && tid === competitorAwayId) {
      return { ...c, team: base?.teams?.away?.name || c.team };
    }
    return c;
  });
  const redCardsRaw = buildRedCards(summaryPayload);
  const redCards = (Array.isArray(redCardsRaw) ? redCardsRaw : []).map((c) => {
    const tid = c?.teamId != null ? String(c.teamId) : null;
    if (tid && competitorHomeId && tid === competitorHomeId) {
      return { ...c, team: base?.teams?.home?.name || c.team };
    }
    if (tid && competitorAwayId && tid === competitorAwayId) {
      return { ...c, team: base?.teams?.away?.name || c.team };
    }
    return c;
  });

  return {
    ...base,
    league: leagueResolved,
    formations: formationsResolved,
    attendance: competition?.attendance != null ? Number(competition.attendance) : null,
    venue: venue
      ? {
          name: venue.fullName || venue.name || venue.shortName || base?.venue?.name || null,
          city: venue.address?.city || base?.venue?.city || null,
          country: venue.address?.country || base?.venue?.country || null,
        }
      : base.venue || null,
    referee,
    broadcast: broadcastNames.length ? broadcastNames.join(', ') : null,
    recapUrl: recap?.href || null,
    stats: details.keyStats,
    timeline,
    goals,
    yellowCards,
    redCards,
    topPerformers,
    boxStats,
    story,
    lineups: lineupsWithEvents,
  };
}

async function fetchFromApi() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(ESPN_SOCCER_SCOREBOARD_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': '11ka-live-score/1.0' },
    });
    if (!response.ok) {
      throw new Error(`Live API returned ${response.status}`);
    }
    const payload = await response.json();
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const matches = events.map(toMatch).filter(Boolean).slice(0, 80);
    return {
      matches,
      source: 'espn',
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromApiForDate(yyyymmdd) {
  const dateParam = String(yyyymmdd || '').trim();
  const url = dateParam ? `${ESPN_SOCCER_SCOREBOARD_URL}?dates=${encodeURIComponent(dateParam)}` : ESPN_SOCCER_SCOREBOARD_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': '11ka-live-score/1.0' },
    });
    if (!response.ok) {
      throw new Error(`Live API returned ${response.status}`);
    }
    const payload = await response.json();
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const matches = events.map(toMatch).filter(Boolean).slice(0, 200);
    return {
      matches,
      source: 'espn',
      fetchedAt: new Date().toISOString(),
      date: dateParam || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getLiveScores() {
  if (cache.data && Date.now() < cache.expiresAt) {
    const base = cache.data;
    const widgetMatches = await pickWidgetMatchesWithDayFallback(base?.matches);
    const widget = {
      ...base,
      matches: widgetMatches,
    };
    return widget;
  }

  try {
    const fresh = await fetchFromApi();
    cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data: fresh,
      dayKeyPrague: pragueTodayKey(),
    };
    const widgetMatches = await pickWidgetMatchesWithDayFallback(fresh?.matches);
    const widget = {
      ...fresh,
      matches: widgetMatches,
    };
    return widget;
  } catch (error) {
    if (cache.data) {
      const base = cache.data;
      const widgetMatches = await pickWidgetMatchesWithDayFallback(base?.matches);
      const widget = {
        ...base,
        matches: widgetMatches,
      };
      return widget;
    }
    return {
      matches: [],
      source: 'fallback',
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'unknown',
    };
  }
}

async function getDayMatches() {
  const todayKey = pragueTodayKey();
  const todayYmd = yyyymmddFromDayKey(todayKey);

  // Půlnoc v CZ: jakmile se změní den, zahodíme cache (a načteme nový feed).
  if (dayCache.data && todayKey) {
    const cachedKey =
      dayCache.dayKeyPrague ||
      pragueDayKeyFromIso(dayCache.data?.fetchedAt) ||
      pragueDayKeyFromIso(dayCache.data?.matches?.[0]?.date) ||
      null;
    if (cachedKey && cachedKey !== todayKey) dayCache.expiresAt = 0;
  }

  if (dayCache.data && Date.now() < dayCache.expiresAt) {
    const base = dayCache.data;
    const list = (Array.isArray(base?.matches) ? base.matches : [])
      .map(postProcessMatchItem)
      .filter((m) => {
        if (!todayKey) return true;
        return pragueDayKeyFromIso(m?.date) === todayKey;
      })
      .slice();
    list.sort((a, b) => {
      const at = a.date ? Date.parse(a.date) : NaN;
      const bt = b.date ? Date.parse(b.date) : NaN;
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    return { ...base, matches: list };
  }

  const fresh = await fetchFromApiForDate(todayYmd || '');
  let mergedFresh = fresh;

  // ESPN `?dates=YYYYMMDD` někdy vrací hlavně "scheduled". Pro kompletní "Zápasy dne"
  // proto sloučíme ještě aktuální scoreboard (který často obsahuje live/dohrané).
  try {
    const [byDate, current] = await Promise.all([
      fetchFromApiForDate(todayYmd || ''),
      fetchFromApi(),
    ]);
    const map = new Map();
    for (const m of Array.isArray(byDate?.matches) ? byDate.matches : []) {
      if (m && m.id) map.set(String(m.id), m);
    }
    for (const m of Array.isArray(current?.matches) ? current.matches : []) {
      if (m && m.id && !map.has(String(m.id))) map.set(String(m.id), m);
    }
    mergedFresh = {
      matches: Array.from(map.values()),
      source: 'espn',
      fetchedAt: new Date().toISOString(),
      date: todayYmd || null,
    };
  } catch {
    // If merge fails, fall back to date-only feed.
    mergedFresh = fresh;
  }

  dayCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data: mergedFresh,
    dayKeyPrague: todayKey,
  };
  const list = (Array.isArray(mergedFresh?.matches) ? mergedFresh.matches : [])
    .map(postProcessMatchItem)
    .filter((m) => {
      if (!todayKey) return true;
      return pragueDayKeyFromIso(m?.date) === todayKey;
    })
    .slice();
  list.sort((a, b) => {
    const at = a.date ? Date.parse(a.date) : NaN;
    const bt = b.date ? Date.parse(b.date) : NaN;
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  return { ...mergedFresh, matches: list };
}

async function getMatchDetail(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    // Try richer "summary" first (includes stats & venue).
    try {
      const urls = [
        `${ESPN_SOCCER_SUMMARY_WEB_URL}${encodeURIComponent(id)}`,
        `${ESPN_SOCCER_SUMMARY_URL}${encodeURIComponent(id)}`,
      ];
      for (const url of urls) {
        const summaryRes = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': '11ka-live-score/1.0' },
        });
        if (!summaryRes.ok) continue;
        const summaryPayload = await summaryRes.json();
        const base = matchDetailFromSummaryPayload(summaryPayload);
        if (base) {
          const merged = mergeMatchDetail(base, summaryPayload);
          return merged;
        }
      }
    } catch {
      // Fall back to scoreboard below
    }

    const response = await fetch(ESPN_SOCCER_SCOREBOARD_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': '11ka-live-score/1.0' },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const event = events.find((e) => String(e?.id) === id);
    const base = toMatchDetail(event);
    return base;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

let chanceBoardCache = { expiresAt: 0, data: null };

function formatCzDayHeading(iso) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const weekday = new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    timeZone: 'Europe/Prague',
  }).format(d);
  const date = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'Europe/Prague',
  }).format(d);
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${cap} ${date}`;
}

function pickUpcomingMatches(all, limit, now) {
  const rows = (all || []).filter((m) => m && m.date).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const cutoff = now - 3 * 60 * 60 * 1000;
  const future = rows.filter((m) => {
    const ts = Date.parse(m.date);
    return Number.isFinite(ts) && ts >= cutoff;
  });
  return future.slice(0, limit).map((m) => {
    const isLive = m.state === 'in';
    const isDone = m.state === 'post';
    const raw = String(m.score || '').replace(/\s+/g, '').replace('–', ':');
    const score = isLive || isDone ? (/^\d+:\d+$/.test(raw) ? raw : '0:0') : '0:0';
    return {
      home: m.home,
      away: m.away,
      homeLogo: m.homeLogo || '',
      awayLogo: m.awayLogo || '',
      homeInitials: teamInitials(m.home),
      awayInitials: teamInitials(m.away),
      date: m.date,
      time: formatKickoffTimeCz(m.date) || m.status,
      score,
      isLive,
      isDone,
      league: m.league || 'Chance Liga',
      round: m.round || '',
      meta: formatMatchMeta(m.date, m.round || ''),
      detailHref: m.detailHref && String(m.detailHref).startsWith('/') ? m.detailHref : '',
      kickoff: m.date,
    };
  });
}

async function listChanceLigaSchedule({ limit = 40 } = {}) {
  const now = Date.now();
  if (chanceBoardCache.data && now < chanceBoardCache.expiresAt) {
    return chanceBoardCache.data;
  }
  try {
    const [aHtml, bHtml, lsMatches] = await Promise.all([
      fetchText(CHANCE_LIGA_SCHEDULE_URL).catch(() => ''),
      fetchText(CHNL_SCHEDULE_URL).catch(() => ''),
      livesportChance.listUpcoming(limit).catch(() => []),
    ]);
    const officialChance = pickUpcomingMatches(parseChanceLigaUpcomingFromHtml(aHtml, 200), limit, now);
    let chanceMatches = officialChance;
    if (lsMatches && lsMatches.length) {
      chanceMatches = livesportChance.attachLivesport(
        officialChance.length ? officialChance : lsMatches,
        lsMatches,
      );
    }
    chanceMatches = (chanceMatches || []).map((m) =>
      chanceLigaLogos.withLogos({
        ...m,
        meta: m.meta || formatMatchMeta(m.date, m.round || ''),
        score: m.isLive || m.isDone ? m.score || '0:0' : '0:0',
        homeInitials: m.homeInitials || teamInitials(m.home),
        awayInitials: m.awayInitials || teamInitials(m.away),
        detailHref: m.detailHref && String(m.detailHref).startsWith('/zapasy/chance/') ? m.detailHref : '',
      }),
    );

    const leagues = [
      {
        id: 'chance-liga',
        label: 'Chance Liga',
        matches: chanceMatches,
      },
      {
        id: 'chance-narodni',
        label: 'Chance Národní liga',
        matches: pickUpcomingMatches(parseChnlUpcomingFromHtml(bHtml, 200), limit, now),
      },
    ].filter((league) => league.matches && league.matches.length);
    chanceBoardCache = { expiresAt: now + 5 * 60 * 1000, data: leagues };
    return leagues;
  } catch {
    return chanceBoardCache.data || [];
  }
}

module.exports = {
  getLiveScores,
  getDayMatches,
  getOfficialChanceDayMatches,
  listChanceLigaSchedule,
  getMatchDetail,
  translateLeague,
};

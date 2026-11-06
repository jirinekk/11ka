const fs = require('fs');
const path = require('path');

const LOGO_BASE = 'https://static.flashscore.com/res/image/data/';
const MAP_PATH = path.join(__dirname, '..', 'data', 'crest-map.json');
const BROKEN_LOCAL = /^\/teams\//i;

const map = {
  byId: Object.create(null),
  bySlug: Object.create(null),
  byName: Object.create(null),
};

let loaded = false;
let writeTimer = null;

function foldName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fc|fk|sk|ac|sc|afc|cf|cd|ss|us|as|ssc|rcd|vfb|vfl|bsc|tsg|1|1905|praha)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadMap() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(MAP_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    Object.assign(map.byId, raw.byId || {});
    Object.assign(map.bySlug, raw.bySlug || {});
    Object.assign(map.byName, raw.byName || {});
  } catch {
    /* keep empty */
  }
}

function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
      fs.writeFileSync(
        MAP_PATH,
        JSON.stringify(
          { byId: map.byId, bySlug: map.bySlug, byName: map.byName },
          null,
          0
        )
      );
    } catch {
      /* ignore disk errors */
    }
  }, 1200);
}

function logoUrl(file) {
  const f = String(file || '').trim();
  if (!f) return '';
  if (/^https?:\/\//i.test(f)) return f;
  if (f.startsWith('/')) return f;
  return LOGO_BASE + f.replace(/^\//, '');
}

function isUsableLogo(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (BROKEN_LOCAL.test(u)) return false;
  if (u === '/user.png' || u.endsWith('/user.png')) return false;
  return true;
}

function remember({ id, slug, name, file, url } = {}) {
  loadMap();
  const logo = isUsableLogo(url) ? String(url).trim() : logoUrl(file);
  if (!isUsableLogo(logo)) return '';
  const teamId = String(id || '').trim();
  const teamSlug = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  const folded = foldName(name);
  if (teamId && map.byId[teamId] !== logo) {
    map.byId[teamId] = logo;
    scheduleWrite();
  }
  if (teamSlug && teamSlug.length > 1 && map.bySlug[teamSlug] !== logo) {
    map.bySlug[teamSlug] = logo;
    scheduleWrite();
  }
  if (folded && folded.length > 2 && map.byName[folded] !== logo) {
    map.byName[folded] = logo;
    scheduleWrite();
  }
  return logo;
}

function fromCache({ id, slug, name } = {}) {
  loadMap();
  const teamId = String(id || '').trim();
  if (teamId && map.byId[teamId]) return map.byId[teamId];
  const teamSlug = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  if (teamSlug && map.bySlug[teamSlug]) return map.bySlug[teamSlug];
  const folded = foldName(name);
  if (folded && map.byName[folded]) return map.byName[folded];
  if (folded) {
    for (const [key, logo] of Object.entries(map.byName)) {
      if (key.length < 4 || !logo) continue;
      if (folded === key || folded.includes(key) || key.includes(folded)) return logo;
    }
  }
  return '';
}

function resolve(name, extras = {}) {
  if (isUsableLogo(extras.url)) {
    remember({ id: extras.id, slug: extras.slug, name, url: extras.url });
    return extras.url;
  }
  if (extras.file) {
    const stored = remember({ id: extras.id, slug: extras.slug, name, file: extras.file });
    if (stored) return stored;
  }
  return fromCache({ id: extras.id, slug: extras.slug, name }) || '';
}

function apply(match) {
  if (!match || typeof match !== 'object') return match;
  const homeLogo = resolve(match.home, {
    id: match.homeTeamId || match.homeParticipantId,
    slug: match.homeSlug,
    url: match.homeLogo,
    file: match.homeLogoFile,
  });
  const awayLogo = resolve(match.away, {
    id: match.awayTeamId || match.awayParticipantId,
    slug: match.awaySlug,
    url: match.awayLogo,
    file: match.awayLogoFile,
  });
  return {
    ...match,
    homeLogo: homeLogo || '',
    awayLogo: awayLogo || '',
    homeInitials: match.homeInitials || initials(match.home),
    awayInitials: match.awayInitials || initials(match.away),
  };
}

function initials(name) {
  const parts = String(name || '')
    .replace(/[.*]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const compact = String(name || '').replace(/[^A-Za-zÁ-ž]/g, '');
  return (compact.slice(0, 2) || '?').toUpperCase();
}

module.exports = {
  foldName,
  logoUrl,
  isUsableLogo,
  remember,
  fromCache,
  resolve,
  apply,
  initials,
};

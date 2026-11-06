const fs = require('fs');
const path = require('path');

let cache = null;

function foldName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fc|fk|sk|ac|sc|mfk|1|praha|1905)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadHq() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chance-hq-photos.json'), 'utf8'));
    if (Array.isArray(raw)) {
      cache = {
        ids: Object.fromEntries(raw.map((id) => [String(id), `/players/${encodeURIComponent(id)}.png`])),
        names: {},
      };
    } else {
      cache = {
        ids: raw && raw.ids ? raw.ids : {},
        names: raw && raw.names ? raw.names : {},
      };
    }
  } catch {
    cache = { ids: {}, names: {} };
  }
  return cache;
}

function lookupKeys(name, teamName) {
  const folded = foldName(name);
  const team = foldName(teamName);
  const parts = folded.split(' ').filter(Boolean);
  const reversed = parts.slice().reverse().join(' ');
  const keys = [];
  if (team && folded) keys.push(`${team}|${folded}`);
  if (folded) keys.push(folded);
  if (reversed && reversed !== folded) {
    if (team) keys.push(`${team}|${reversed}`);
    keys.push(reversed);
  }
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (team && last) keys.push(`${team}|${last}`);
  }
  if (parts.length >= 3) {
    const short = `${parts[0]} ${parts[parts.length - 1]}`;
    const shortRev = `${parts[parts.length - 1]} ${parts[0]}`;
    keys.push(short, shortRev);
    if (team) keys.push(`${team}|${short}`, `${team}|${shortRev}`);
  }
  return keys;
}

function chancePlayerPhoto(livesportId, name, teamName) {
  const hq = loadHq();
  const id = String(livesportId || '').trim();
  if (id && hq.ids[id]) return hq.ids[id];
  for (const key of lookupKeys(name, teamName)) {
    if (key && hq.names[key]) return hq.names[key];
  }
  return '';
}

module.exports = { chancePlayerPhoto, foldName };

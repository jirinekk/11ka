const { UA } = require('./ai-rss');
const aiQueue = require('./ai-queue');

function baseUrl() {
  return String(process.env.FOTO_11KA_URL || 'https://foto.11ka.cz').replace(/\/$/, '');
}

function apiKey() {
  return String(process.env.FOTO_11KA_KEY || process.env.ELEVENKA_API_KEY || '').trim();
}

function isConfigured() {
  return Boolean(apiKey());
}

async function lookupHero(query) {
  const key = apiKey();
  if (!key) return null;
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (q.length < 4) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const url = `${baseUrl()}/api/public/hero?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'x-11ka-key': key,
      },
      signal: ctrl.signal,
    });
    const type = String(res.headers.get('content-type') || '');
    if (!res.ok || !type.includes('json')) return null;
    const data = await res.json();
    if (!data || !data.ok || !data.imageUrl) return null;
    return {
      imageUrl: String(data.imageUrl),
      credit: String(data.credit || 'foto.11ka.cz'),
      player: data.player || null,
      photoId: data.photoId || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function attachHero(query, fallbackUrl) {
  const hit = await lookupHero(query);
  if (!hit) return { imageUrl: fallbackUrl || null, credit: null, fromFoto: false };
  const local = await aiQueue.saveHeroImage(hit.imageUrl, {
    headers: { 'x-11ka-key': apiKey() },
  });
  if (!local) return { imageUrl: fallbackUrl || null, credit: null, fromFoto: false };
  return { imageUrl: local, credit: hit.credit, fromFoto: true };
}

module.exports = {
  isConfigured,
  lookupHero,
  attachHero,
};

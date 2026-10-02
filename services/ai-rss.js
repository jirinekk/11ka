const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const NAMED_ENTITIES = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  raquo: '»',
  laquo: '«',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  minus: '-',
};

function decodeEntities(html) {
  let out = String(html || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[String(name).toLowerCase()] || m)
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
    if (next === out) break;
    out = next;
  }
  return out;
}

function stripHtml(html) {
  return decodeEntities(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(chunk, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = chunk.match(re);
  return m ? decodeEntities(m[1]).trim() : '';
}

function attr(chunk, name) {
  const re = new RegExp(`${name}=["']([^"']+)["']`, 'i');
  return chunk.match(re)?.[1] ?? '';
}

async function fetchText(url, timeoutMs = 18000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml, application/xml, text/html, text/xml, */*',
      },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseRss(xml) {
  const out = [];
  for (const chunk of String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const title = stripHtml(tag(chunk, 'title'));
    const url = stripHtml(tag(chunk, 'link')) || stripHtml(tag(chunk, 'guid'));
    if (!title || !url) continue;
    const description = stripHtml(tag(chunk, 'description') || tag(chunk, 'content:encoded'));
    const publishedAt = new Date(tag(chunk, 'pubDate') || tag(chunk, 'dc:date') || Date.now());
    const media =
      attr(chunk.match(/<media:content\b[^>]*>/i)?.[0] ?? '', 'url') ||
      attr(chunk.match(/<media:thumbnail\b[^>]*>/i)?.[0] ?? '', 'url') ||
      attr(chunk.match(/<enclosure\b[^>]*>/i)?.[0] ?? '', 'url') ||
      null;
    out.push({
      title: cleanTitle(title) || title,
      url,
      description,
      image: media,
      publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    });
  }
  return out;
}

function matchesFilter(item, filter) {
  if (!String(filter || '').trim()) return true;
  const hay = `${item.title} ${item.url}`.toLowerCase();
  return String(filter)
    .split('|')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .some((part) => hay.includes(part));
}

function resolveUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function isListingArticle(url, pageUrl) {
  let parsed;
  let page;
  try {
    parsed = new URL(url);
    page = new URL(pageUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const pageHost = page.hostname.replace(/^www\./, '');
  if (host !== pageHost) return false;
  const path = parsed.pathname;

  if (host === 'transferfeed.com') return /^\/transfers\/[^/]+\/\d+\/?$/.test(path);
  if (host === 'efotbal.cz') return /^\/article\/[^/]+/.test(path);
  if (host === 'livesport.cz') {
    const parts = path.split('/').filter(Boolean);
    if (parts[0] !== 'zpravy' || parts.length < 3) return false;
    const slug = parts[1] || '';
    if (/^(tenis|hokej|basketbal|volejbal|motorsport|silnicni-cyklistika|tennis|davis-cup)/i.test(slug)) {
      return false;
    }
    return slug.length > 28 || (slug.match(/-/g) || []).length >= 3;
  }
  if (host === 'fortunaligazen.cz') return /^\/clanek\/\d+/.test(path);
  if (host === 'sport.cz') return /\/clanek\//.test(path) || /\/c\/\d+/.test(path);
  if (host === 'isport.blesk.cz') return /\/fotbal\//.test(path);
  if (host === 'infotbal.cz') return /\/\d{4}\//.test(path) || /\/clanek\//.test(path);
  return false;
}

function slugTitle(url) {
  try {
    const last = new URL(url).pathname.replace(/\/$/, '').split('/').pop() || '';
    const slug = last.replace(/-\d+$/, '').replace(/\.html$/i, '');
    if (slug.length < 8) return '';
    return slug.replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

function parseListing(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b([^>]*?)href=["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const href = match[2];
    const attrs = `${match[1] || ''} ${match[3] || ''}`;
    const titleAttr = (attrs.match(/title=["']([^"']+)["']/i) || [])[1] || '';
    const inner = stripHtml(match[4] || '');
    const abs = resolveUrl(href, pageUrl);
    if (!abs || !isListingArticle(abs, pageUrl)) continue;
    const key = abs.split('#')[0].replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const picked = (inner.length >= titleAttr.length ? inner : titleAttr).replace(/\s+/g, ' ').trim();
    const title = cleanTitle(picked.length >= 8 ? picked.split(/\s{2,}/)[0].slice(0, 180) : slugTitle(key));
    out.push({
      title: title.length >= 8 ? title : key,
      url: abs,
      description: '',
      image: null,
      publishedAt: new Date(),
    });
  }
  return out;
}

const SOURCE_SUFFIX =
  '(?:inFotbal(?:\\.cz)?|eFotbal(?:\\.cz)?|iSport(?:\\.cz)?|Sport\\.cz|Livesport(?:\\.cz)?|TransferFeed|iDNES\\.cz|Fortuna Liga žen)';

function cleanTitle(title) {
  let t = stripHtml(title);
  t = t.replace(new RegExp(`\\s*[»›]\\s*${SOURCE_SUFFIX}\\s*$`, 'i'), '');
  t = t.replace(new RegExp(`\\s*[-–—|]\\s*${SOURCE_SUFFIX}\\s*$`, 'i'), '');
  t = t.replace(new RegExp(`\\s+${SOURCE_SUFFIX}\\s*$`, 'i'), '');
  return t.replace(/\s+/g, ' ').trim();
}

module.exports = {
  UA,
  decodeEntities,
  stripHtml,
  cleanTitle,
  fetchText,
  parseRss,
  parseListing,
  matchesFilter,
};

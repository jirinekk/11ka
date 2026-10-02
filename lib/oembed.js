function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

const ENDPOINTS = [
  (url) =>
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&theme=dark&dnt=true&align=center&maxwidth=550`,
  (url) => `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}&omitscript=true&maxwidth=320`,
  (url) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  (url) =>
    `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}&omitscript=true&maxwidth=320`,
];

function validateOembedUrl(url) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'Chybí URL' };
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, error: 'Neplatná URL' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Neplatná URL' };
  }
  return { ok: true, url: parsed.toString() };
}

async function fetchOembedHtml(url) {
  const validated = validateOembedUrl(url);
  if (!validated.ok) return { ok: false, error: validated.error };

  for (const build of ENDPOINTS) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(build(validated.url), {
        signal: controller.signal,
        headers: { 'User-Agent': '11ka-cms/1.0' },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const data = await r.json();
      if (data.html) {
        const wrapped = `<div class="embed-card" data-oembed-url="${escapeAttr(validated.url)}">${data.html}</div>`;
        return {
          ok: true,
          html: wrapped,
          title: data.title || data.author_name || '',
        };
      }
    } catch {
      /* try next */
    }
  }

  return { ok: false, error: 'Náhled se nepodařilo načíst (zkuste jinou URL).' };
}

async function resolveOembedUrls(urls) {
  const list = Array.isArray(urls) ? urls.slice(0, 3) : [];
  const html = [];
  for (let i = 0; i < 3; i += 1) {
    const raw = list[i] != null ? String(list[i]).trim() : '';
    if (!raw) {
      html.push('');
      continue;
    }
    const result = await fetchOembedHtml(raw);
    html.push(result.ok ? result.html : '');
  }
  return html;
}

module.exports = {
  escapeAttr,
  validateOembedUrl,
  fetchOembedHtml,
  resolveOembedUrls,
};

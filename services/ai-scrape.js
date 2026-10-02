const { fetchText, stripHtml, cleanTitle } = require('./ai-rss');

function meta(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return stripHtml(m[1]);
  }
  return '';
}

function extractParagraphs(html) {
  const article =
    html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ||
    html.match(
      /<(?:div|section)[^>]*(?:article-body|article__body|entry-content|post-content|story-body)[^>]*>[\s\S]*?<\/(?:div|section)>/i
    )?.[0] ||
    html;

  const cleaned = article
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  return [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((p) => p.length > 60)
    .filter((p) => !/cookie|reklama|newsletter|přihlaš|sledujte nás/i.test(p))
    .slice(0, 12);
}

async function scrapeArticle(url) {
  const html = await fetchText(url, 20000);
  const title =
    meta(html, 'og:title') || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const perex = meta(html, 'og:description') || meta(html, 'description');
  const image = meta(html, 'og:image') || meta(html, 'twitter:image') || null;
  const paragraphs = extractParagraphs(html);
  return {
    title: cleanTitle(title.replace(/\s+[-–|].*$/, '').trim()),
    perex,
    body: paragraphs.join('\n\n'),
    image,
  };
}

module.exports = { scrapeArticle };

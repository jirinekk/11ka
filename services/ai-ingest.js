const { fetchText, parseRss, parseListing, matchesFilter, cleanTitle } = require('./ai-rss');
const { scrapeArticle } = require('./ai-scrape');
const aiArticleDraft = require('./ai-article-draft');
const aiQueue = require('./ai-queue');
const articlesService = require('./articles');
const foto11ka = require('./foto-11ka');
const { CATEGORIES, guessCategory, guessTag, classifyItem } = require('./ai-tags');

const FEED_INTERVAL_MS = 15 * 60 * 1000;

function siteFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatSourceLine(item) {
  const url = String(item && item.source_url ? item.source_url : '').trim();
  const name = String(item && item.source_name ? item.source_name : '').trim();
  const site = siteFromUrl(url);
  const label = name || site;
  if (label && url) return `${label} - ${url}`;
  return url || label || '';
}

let ingestLock = null;
let feedTimer = null;

function getLastFetchedAt() {
  return aiQueue.getLastFetchedAt();
}

function isFeedStale() {
  const t = getLastFetchedAt();
  if (!t) return true;
  const ms = Date.now() - new Date(t).getTime();
  return !Number.isFinite(ms) || ms >= FEED_INTERVAL_MS;
}

async function ingestSourcesSafe(limitPerSource = 8) {
  if (ingestLock) return ingestLock;
  ingestLock = ingestSources(limitPerSource).finally(() => {
    ingestLock = null;
  });
  return ingestLock;
}

function startFeedScheduler() {
  if (feedTimer) return;
  const tick = () => {
    ingestSourcesSafe(8).catch((e) => console.error('[11ka] AI feed', e && e.message));
  };
  tick();
  feedTimer = setInterval(tick, FEED_INTERVAL_MS);
  if (typeof feedTimer.unref === 'function') feedTimer.unref();
}

async function ingestSources(limitPerSource = 6) {
  const sources = aiQueue.listEnabledSources();
  let created = 0;
  let skipped = 0;
  const ids = [];

  for (const source of sources) {
    try {
      const raw = await fetchText(source.url);
      let items = parseRss(raw);
      if (!items.length) items = parseListing(raw, source.url);
      items = items.filter((item) => matchesFilter(item, source.filter)).slice(0, limitPerSource);

      for (const item of items) {
        if (aiQueue.findBySourceUrl(item.url)) {
          skipped += 1;
          continue;
        }
        let title = cleanTitle(item.title);
        let perex = item.description;
        let body = '';
        let image = item.image;
        try {
          const scraped = await scrapeArticle(item.url);
          if (scraped.title.length > 12) title = cleanTitle(scraped.title);
          if (scraped.perex.length > 20) perex = scraped.perex;
          if (scraped.body.length > 80) body = scraped.body;
          if (scraped.image) image = scraped.image;
        } catch {
          /* RSS je dost */
        }
        const labels = classifyItem({
          source_name: source.name,
          source_title: title,
          source_perex: perex,
        });
        let hero = image;
        try {
          const foto = await foto11ka.attachHero(`${title} ${perex}`, image);
          if (foto.imageUrl) hero = foto.imageUrl;
        } catch {
          /* RSS fotka stačí */
        }
        const row = aiQueue.insertInbox({
          source_id: source.id,
          source_name: source.name,
          source_url: item.url,
          source_title: title,
          source_perex: perex,
          source_body: body,
          source_image: hero,
          source_published_at: item.publishedAt ? item.publishedAt.toISOString() : null,
          category: labels.category,
          tag: labels.tag,
        });
        if (row && row.status === 'inbox') {
          created += 1;
          ids.push(row.id);
        } else skipped += 1;
      }
      aiQueue.markSourceFetched(source.id, null);
    } catch (err) {
      aiQueue.markSourceFetched(source.id, err instanceof Error ? err.message : 'Načtení selhalo');
    }
  }

  await enrichInboxHeroes(8);
  return { created, skipped, ids };
}

async function enrichInboxHeroes(limit = 8) {
  const rows = aiQueue.listQueue('inbox', limit);
  for (const row of rows) {
    const current = String(row.source_image || '');
    if (current.startsWith('/uploads/articles/')) continue;
    try {
      const foto = await foto11ka.attachHero(`${row.source_title} ${row.source_perex}`, row.source_image);
      if (foto.fromFoto && foto.imageUrl) {
        aiQueue.updateQueueItem(row.id, { source_image: foto.imageUrl });
      }
    } catch {
      /* nevadí */
    }
  }
}

async function ingestUrl(url, sourceName = 'Ruční URL') {
  if (aiQueue.findBySourceUrl(url)) {
    return { created: false, error: 'Tenhle odkaz už ve frontě je.' };
  }
  const scraped = await scrapeArticle(url);
  const title = cleanTitle(scraped.title || url);
  const labels = classifyItem({
    source_name: sourceName,
    source_title: title,
    source_perex: scraped.perex,
  });
  let hero = scraped.image;
  try {
    const foto = await foto11ka.attachHero(`${title} ${scraped.perex}`, scraped.image);
    if (foto.imageUrl) hero = foto.imageUrl;
  } catch {
    /* RSS fotka stačí */
  }
  const row = aiQueue.insertInbox({
    source_name: sourceName,
    source_url: url,
    source_title: title,
    source_perex: scraped.perex,
    source_body: scraped.body,
    source_image: hero,
    source_published_at: new Date().toISOString(),
    category: labels.category,
    tag: labels.tag,
  });
  return { created: true, id: row.id };
}

function sourceParagraphs(item) {
  const chunks = [item.source_perex, item.source_body]
    .filter(Boolean)
    .join('\n\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40);
  if (chunks.length >= 2) return chunks.slice(0, 8);
  const sentences = String(item.source_body || item.source_perex || item.source_title || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30);
  const packed = [];
  for (let i = 0; i < sentences.length; i += 2) {
    packed.push(sentences.slice(i, i + 2).join(' '));
  }
  return packed.slice(0, 8);
}

function draftFromSource(item) {
  const paragraphs = sourceParagraphs(item);
  while (paragraphs.length < 2) {
    paragraphs.push(cleanTitle(item.source_title) || 'Článek z RSS.');
  }
  return {
    title: String(cleanTitle(item.source_title) || 'Článek z RSS').slice(0, 100),
    excerpt: String(item.source_perex || paragraphs[0] || '').slice(0, 250),
    paragraphs,
  };
}

async function rewriteOne(id, categoryHint) {
  const item = aiQueue.getQueueItem(id);
  if (!item) throw new Error('Položka ve frontě není.');
  const brief = [item.source_title, item.source_perex, item.source_body]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 11000);
  if (brief.length < 40) {
    throw new Error('U zdroje je málo textu na přepis.');
  }
  const category = CATEGORIES.includes(categoryHint) ? categoryHint : item.category;
  const draft = await aiArticleDraft.generateArticleDraft({
    brief,
    sourceNote: `${item.source_name}: ${item.source_url}`,
    category,
  });
  const labels = classifyItem({
    source_title: draft.title || item.source_title,
    source_perex: draft.excerpt || item.source_perex,
    source_name: item.source_name,
  });
  return aiQueue.updateQueueItem(id, {
    status: 'queue',
    title: draft.title,
    excerpt: draft.excerpt,
    body_html: aiArticleDraft.draftToBodyHtml(draft.paragraphs),
    body_blocks_json: aiArticleDraft.draftToBlocksJson(draft.paragraphs),
    category: labels.category,
    tag: labels.tag,
    rewrite_error: null,
  });
}

async function rewritePending(limit = 6) {
  const pending = aiQueue.listPendingRewrite(limit);
  let rewritten = 0;
  for (const item of pending) {
    try {
      await rewriteOne(item.id, item.category);
      rewritten += 1;
    } catch (err) {
      aiQueue.updateQueueItem(item.id, {
        status: 'failed',
        rewrite_error: err instanceof Error ? err.message : 'Přepis selhal',
      });
    }
  }
  return { rewritten, attempted: pending.length };
}

function saveDraftFields(id, fields) {
  return aiQueue.updateQueueItem(id, {
    title: fields.title,
    excerpt: fields.excerpt,
    body_html: fields.body_html,
    body_blocks_json: fields.body_blocks_json,
    category: fields.category,
    tag: fields.tag,
    author_id: fields.author_id,
    status: 'queue',
  });
}

async function resolveHero(item) {
  const query = `${item.title || ''} ${item.source_title || ''} ${item.excerpt || ''} ${item.source_perex || ''}`;
  try {
    const foto = await foto11ka.attachHero(query, item.source_image);
    if (foto.fromFoto && foto.imageUrl) {
      const path = String(foto.imageUrl).startsWith('/')
        ? foto.imageUrl
        : await aiQueue.saveHeroImage(foto.imageUrl);
      return { path, credit: foto.credit };
    }
  } catch {
    /* RSS fotka */
  }
  const existing = String(item.source_image || '');
  if (existing.startsWith('/uploads/')) {
    return { path: existing, credit: item.source_name || null };
  }
  return {
    path: await aiQueue.saveHeroImage(existing),
    credit: item.source_name || null,
  };
}

async function publishQueueItem(id, { authorId, publishNow = true } = {}) {
  const item = aiQueue.getQueueItem(id);
  if (!item) throw new Error('Položka ve frontě není.');
  if (!String(item.title || '').trim() || !String(item.body_html || '').trim()) {
    throw new Error('Doplň titulek a text, než to půjde na 11ku.');
  }

  const hero = await resolveHero(item);
  const article = articlesService.createArticle({
    author_id: authorId || item.author_id,
    title: item.title,
    excerpt: item.excerpt || null,
    body_html: item.body_html,
    body_blocks_json: item.body_blocks_json,
    hero_image_path: hero.path,
    hero_credit: hero.credit || (item.source_name ? `${item.source_name}` : null),
    category: item.category || null,
    tag: item.tag || null,
    sources: formatSourceLine(item),
    status: publishNow ? 'published' : 'draft',
  });

  if (publishNow) {
    articlesService.updateArticle(article.id, {
      status: 'published',
      published_at: new Date().toISOString(),
    });
  }

  const live = articlesService.getById(article.id);
  aiQueue.updateQueueItem(id, {
    status: publishNow ? 'published' : 'queue',
    article_id: live.id,
    published_url: `/clanek/${live.slug}`,
    author_id: authorId || item.author_id,
  });
  return live;
}

function rejectQueueItem(id) {
  return aiQueue.updateQueueItem(id, { status: 'rejected' });
}

async function openInEditor(id, { authorId, forceRewrite = true } = {}) {
  let item = aiQueue.getQueueItem(id);
  if (!item) throw new Error('Položka ve frontě není.');
  const needsRewrite =
    forceRewrite ||
    !String(item.title || '').trim() ||
    !String(item.body_html || '').trim();
  if (needsRewrite) {
    try {
      item = await rewriteOne(id, item.category);
    } catch (err) {
      const fallback = draftFromSource(item);
      item = aiQueue.updateQueueItem(id, {
        status: 'queue',
        title: fallback.title,
        excerpt: fallback.excerpt,
        body_html: aiArticleDraft.draftToBodyHtml(fallback.paragraphs),
        body_blocks_json: aiArticleDraft.draftToBlocksJson(fallback.paragraphs),
        rewrite_error: err instanceof Error ? err.message : 'Přepis selhal',
      });
    }
  }

  const sources = formatSourceLine(item);
  const hero = await resolveHero(item);

  if (item.article_id) {
    const existing = articlesService.getById(item.article_id);
    if (existing && existing.status !== 'published') {
      articlesService.updateArticle(existing.id, {
        title: item.title,
        excerpt: item.excerpt || null,
        body_html: item.body_html,
        body_blocks_json: item.body_blocks_json,
        category: item.category || null,
        tag: item.tag || null,
        sources,
        hero_image_path: hero.path || existing.hero_image_path,
        hero_credit: hero.credit || item.source_name || existing.hero_credit || null,
      });
      return articlesService.getById(existing.id);
    }
  }

  return publishQueueItem(id, { authorId, publishNow: false });
}

module.exports = {
  CATEGORIES,
  FEED_INTERVAL_MS,
  ingestSources,
  ingestSourcesSafe,
  ingestUrl,
  rewriteOne,
  rewritePending,
  saveDraftFields,
  publishQueueItem,
  openInEditor,
  rejectQueueItem,
  guessCategory,
  guessTag,
  formatSourceLine,
  getLastFetchedAt,
  isFeedStale,
  startFeedScheduler,
};

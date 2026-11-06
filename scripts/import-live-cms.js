#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const { initDb, getDb } = require('../db');
const { sanitizeArticleBody } = require('../lib/html');
const articlesService = require('../services/articles');
const usersService = require('../services/users');
const rubricsService = require('../services/rubrics');

const ORIGIN = 'https://11ka.cz';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PUBLIC = path.join(ROOT, 'public');
const SEED_ARTICLES = path.join(ROOT, 'data', 'seed-articles.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (err) {
      last = err;
      await sleep(400 * (i + 1));
    }
  }
  throw last;
}

async function fetchBuffer(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err;
      await sleep(300 * (i + 1));
    }
  }
  throw last;
}

function decodeLd(html) {
  const m = String(html || '').match(/name="11ka-ld" content="([^"]+)"/);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function ldNode(ld, type) {
  const graph = ld && Array.isArray(ld['@graph']) ? ld['@graph'] : [];
  return graph.find((item) => item && item['@type'] === type) || null;
}

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unescapeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function innerDiv(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return '';
  const gt = html.indexOf('>', start);
  if (gt < 0) return '';
  let depth = 1;
  let pos = gt + 1;
  while (pos < html.length && depth > 0) {
    const open = html.indexOf('<div', pos);
    const close = html.indexOf('</div>', pos);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      depth += 1;
      pos = open + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(gt + 1, close).trim();
      pos = close + 6;
    }
  }
  return html.slice(gt + 1).trim();
}

function localUploadPath(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const noQuery = raw.split('?')[0];
  const m = noQuery.match(/\/uploads\/[^#]+$/i);
  if (m) return m[0];
  if (noQuery.startsWith('/uploads/')) return noQuery;
  return '';
}

async function saveUpload(relOrUrl) {
  const rel = localUploadPath(relOrUrl);
  if (!rel) return '';
  const dest = path.join(PUBLIC, rel.replace(/^\//, ''));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 200) return rel;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = await fetchBuffer(`${ORIGIN}${rel}`);
  fs.writeFileSync(dest, buf);
  return rel;
}

function collectUploads(html) {
  const out = new Set();
  const src = String(html || '');
  for (const m of src.matchAll(/(?:src|href)="([^"]*\/uploads\/[^"]+)"/gi)) {
    const rel = localUploadPath(m[1]);
    if (rel && !rel.includes('/penalty/')) out.add(rel);
  }
  return [...out];
}

function matchKeyPrefix(league) {
  const n = String(league || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (n.includes('narodni')) return 'narodni';
  if (n.includes('mol')) return 'mol';
  if (n.includes('reprezent') || n.includes('liga narodu')) return 'repre';
  if (n.includes('mistr')) return 'ucl';
  if (n.includes('konferenc')) return 'ecl';
  if (n.includes('evropsk')) return 'el';
  return 'chance';
}

function parseArticle(slug, html) {
  const ld = decodeLd(html);
  const news = ldNode(ld, 'NewsArticle') || {};
  const title =
    stripTags((html.match(/<h1[^>]*itemprop="headline"[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '') ||
    String(news.headline || '').trim() ||
    stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  if (!title) return null;
  const excerpt =
    stripTags((html.match(/<p class="article-lead"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '') ||
    String(news.description || '').trim() ||
    '';
  const pills = [...html.matchAll(/article-kicker__pill[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map((m) =>
    stripTags(m[1])
  );
  const category = pills[0] || null;
  const tag = pills[1] || null;
  const author =
    stripTags((html.match(/article-author__name[^>]*>([\s\S]*?)<\/(?:a|span)>/i) || [])[1] || '') ||
    (news.author && news.author.name) ||
    'Redakce';
  const avatar = localUploadPath((html.match(/article-author__avatar[^>]*src="([^"]+)"/i) || [])[1] || '');
  const credit = unescapeHtml(
    stripTags((html.match(/hero-credit-badge__text[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '')
  );
  const pos = (html.match(/article-hero__img[^>]*style="[^"]*object-position:\s*([^;"]+)/i) || [])[1] || '';
  const hero =
    localUploadPath((Array.isArray(news.image) ? news.image[0] : news.image) || '') ||
    localUploadPath((html.match(/property="og:image" content="([^"]+)"/i) || [])[1] || '');
  let body = innerDiv(html, '<div class="article-body');
  body = body.replace(/<div[^>]*article-inread-ad[\s\S]*?<\/div>/gi, '');
  body = sanitizeArticleBody(body);
  const matchHref = (html.match(/class="article-match[^"]*"[^>]*href="(\/zapasy\/chance\/[^"]+)"/) || [])[1] || '';
  const matchSlug = matchHref.split('/zapasy/chance/')[1] || '';
  const matchLeague = stripTags((html.match(/article-match__comp[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
  const related = [];
  const relatedList = ldNode(ld, 'ItemList');
  if (relatedList && Array.isArray(relatedList.itemListElement)) {
    for (const item of relatedList.itemListElement) {
      const url = String(item.url || item.item || '');
      const relSlug = url.split('/clanek/')[1];
      if (relSlug) related.push(relSlug.replace(/\/$/, ''));
    }
  }
  return {
    slug,
    title,
    excerpt,
    body_html: body,
    hero_image_path: hero,
    hero_position: articlesService.normalizeHeroPosition(pos) || '50% 50%',
    hero_credit: credit || null,
    category,
    tag,
    author_name: author,
    author_avatar: avatar,
    status: 'published',
    published_at: news.datePublished || (html.match(/<time[^>]+datetime="([^"]+)"/) || [])[1] || new Date().toISOString(),
    created_at: news.datePublished || null,
    rubric_slug: null,
    match_key: matchSlug ? `${matchKeyPrefix(matchLeague)}:${decodeURIComponent(matchSlug)}` : null,
    related_slugs: related,
    source_url: `${ORIGIN}/clanek/${slug}`,
  };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function findAuthorId(name, fallbackId) {
  const n = String(name || '').trim();
  if (!n) return fallbackId;
  const db = getDb();
  const hit = db
    .prepare(
      `SELECT id FROM users WHERE display_name = ? COLLATE NOCASE
       ORDER BY CASE role WHEN 'majitel' THEN 1 WHEN 'vedeni' THEN 2 WHEN 'sefredaktor' THEN 3 WHEN 'redaktor' THEN 4 ELSE 5 END, id
       LIMIT 1`
    )
    .get(n);
  if (hit) return hit.id;
  try {
    return usersService.createUser({
      email: `live.${crypto.randomBytes(6).toString('hex')}@11ka.local`,
      password: crypto.randomBytes(24).toString('hex'),
      role: 'redaktor',
      roles: ['redaktor'],
      display_name: n,
    });
  } catch {
    return fallbackId;
  }
}

function upsertArticle(item, authorId) {
  const db = getDb();
  const existing = db.prepare(`SELECT id, view_count, created_at FROM articles WHERE slug = ?`).get(item.slug);
  const now = new Date().toISOString();
  const publishedAt = item.published_at || now;
  const createdAt = (existing && existing.created_at) || item.created_at || publishedAt;
  const views = existing ? Number(existing.view_count) || 0 : 0;
  const body = item.body_html || '';
  const excerpt = item.excerpt ? String(item.excerpt).trim().slice(0, 400) : null;
  if (existing) {
    db.prepare(
      `UPDATE articles
       SET title = ?, excerpt = ?, body_html = ?, hero_image_path = ?, hero_position = ?, hero_credit = ?,
           status = 'published', scheduled_at = NULL, published_at = ?, author_id = ?, category = ?, tag = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      item.title,
      excerpt,
      body,
      item.hero_image_path || null,
      item.hero_position || '50% 50%',
      item.hero_credit || null,
      publishedAt,
      authorId,
      item.category || null,
      item.tag || null,
      now,
      existing.id
    );
    articlesService.persistCommunityFields(existing.id, {
      rubricSlug: item.rubric_slug,
      matchKey: item.match_key,
    });
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO articles (
         slug, title, excerpt, body_html, hero_image_path, hero_position, hero_credit, status,
         scheduled_at, published_at, author_id, view_count, category, tag, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', NULL, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      item.slug,
      item.title,
      excerpt,
      body,
      item.hero_image_path || null,
      item.hero_position || '50% 50%',
      item.hero_credit || null,
      publishedAt,
      authorId,
      views,
      item.category || null,
      item.tag || null,
      createdAt,
      now
    );
  articlesService.persistCommunityFields(info.lastInsertRowid, {
    rubricSlug: item.rubric_slug,
    matchKey: item.match_key,
  });
  return info.lastInsertRowid;
}

async function importRubrics() {
  const html = await fetchText(`${ORIGIN}/rubriky`);
  const fromListing = new Map();
  for (const m of html.matchAll(/href="\/rubriky\/([^"]+)" class="card-11[\s\S]*?<\/a>/g)) {
    const slug = m[1];
    const block = m[0];
    fromListing.set(slug, {
      label: stripTags((block.match(/text-white">([\s\S]*?)<\/p>/) || [])[1] || ''),
      description: stripTags((block.match(/text-11muted">([\s\S]*?)<\/p>/) || [])[1] || ''),
      owner_name: stripTags((block.match(/Tvůrce:\s*([^<]+)/) || [])[1] || ''),
    });
  }
  const slugs = [...new Set([...html.matchAll(/href="\/rubriky\/([^"]+)"/g)].map((m) => m[1]))];
  const db = getDb();
  const out = [];
  for (const [index, slug] of slugs.entries()) {
    const listed = fromListing.get(slug) || {};
    const page = await fetchText(`${ORIGIN}/rubriky/${encodeURIComponent(slug)}`);
    const label =
      stripTags((page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '') || listed.label || slug;
    const description =
      stripTags((page.match(/<p class="mt-2 text-sm text-11muted">([\s\S]*?)<\/p>/i) || [])[1] || '') ||
      listed.description ||
      '';
    const ownerName =
      listed.owner_name ||
      stripTags((page.match(/Tvůrce:\s*([^<]+)/) || [])[1] || '');
    const ownerId = ownerName ? findAuthorId(ownerName, null) : null;
    const existing = rubricsService.getBySlug(slug);
    if (existing) {
      rubricsService.updateRubric(existing.id, {
        label,
        description,
        owner_user_id: ownerId || existing.owner_user_id,
        notify_enabled: true,
      });
      db.prepare(`UPDATE rubrics SET sort_order = ?, updated_at = ? WHERE id = ?`).run(
        index,
        new Date().toISOString(),
        existing.id
      );
    } else {
      rubricsService.createRubric({
        label,
        slug,
        description,
        owner_user_id: ownerId,
        notify_enabled: true,
      });
      const created = rubricsService.getBySlug(slug);
      if (created) {
        db.prepare(`UPDATE rubrics SET sort_order = ? WHERE id = ?`).run(index, created.id);
      }
    }
    const articleSlugs = [
      ...new Set(
        [...page.matchAll(/href="\/clanek\/([^"#?]+)"/g)]
          .map((m) => m[1])
          .filter((s) => s && !s.includes('/'))
      ),
    ];
    out.push({ slug, label, description, owner_name: ownerName, article_slugs: articleSlugs });
    console.log(`[rubric] ${slug} · ${label} · ${articleSlugs.length} článků`);
  }
  const live = new Set(slugs);
  for (const row of rubricsService.listRubrics()) {
    if (!live.has(row.slug) && Number(row.article_count || 0) === 0) {
      rubricsService.removeRubric(row.id);
      console.log(`[rubric] removed unused ${row.slug}`);
    }
  }
  return out;
}

async function main() {
  initDb();
  const db = getDb();
  const fallbackAuthor = db.prepare(`SELECT id FROM users ORDER BY id LIMIT 1`).get();
  if (!fallbackAuthor) throw new Error('V databázi nejsou uživatelé.');

  console.log('Rubriky…');
  const rubrics = await importRubrics();
  const rubricByArticle = new Map();
  for (const r of rubrics) {
    for (const slug of r.article_slugs || []) rubricByArticle.set(slug, r.slug);
  }

  console.log('Sitemap…');
  const xml = await fetchText(`${ORIGIN}/sitemap.xml`);
  const slugs = [...xml.matchAll(/<loc>https:\/\/11ka\.cz\/clanek\/([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`Článků v sitemapě: ${slugs.length}`);

  const imported = [];
  let ok = 0;
  let fail = 0;
  await mapPool(slugs, 4, async (slug, idx) => {
    try {
      const html = await fetchText(`${ORIGIN}/clanek/${encodeURIComponent(slug)}`);
      const item = parseArticle(slug, html);
      if (!item || !item.body_html) {
        fail += 1;
        console.warn(`[skip] ${slug}`);
        return;
      }
      item.rubric_slug = rubricByArticle.get(slug) || null;
      const uploads = collectUploads(html).concat(item.hero_image_path ? [item.hero_image_path] : []);
      if (item.author_avatar) uploads.push(item.author_avatar);
      for (const rel of uploads) {
        try {
          await saveUpload(rel);
        } catch (err) {
          console.warn(`[img] ${rel}: ${err.message}`);
        }
      }
      if (item.hero_image_path) item.hero_image_path = localUploadPath(item.hero_image_path);
      const authorId = findAuthorId(item.author_name, fallbackAuthor.id);
      if (item.author_avatar) {
        const local = localUploadPath(item.author_avatar);
        if (local) {
          db.prepare(
            `UPDATE users SET avatar_path = ? WHERE id = ? AND (avatar_path IS NULL OR avatar_path LIKE 'http%')`
          ).run(local, authorId);
        }
      }
      upsertArticle(item, authorId);
      imported.push(item);
      ok += 1;
      if ((idx + 1) % 25 === 0 || idx + 1 === slugs.length) {
        console.log(`[articles] ${idx + 1}/${slugs.length} ok=${ok} fail=${fail}`);
      }
    } catch (err) {
      fail += 1;
      console.warn(`[fail] ${slug}: ${err.message}`);
    }
  });

  db.prepare(`UPDATE articles SET rubric_slug = NULL`).run();
  for (const [articleSlug, rubricSlug] of rubricByArticle) {
    db.prepare(`UPDATE articles SET rubric_slug = ? WHERE slug = ?`).run(rubricSlug, articleSlug);
  }

  const idBySlug = new Map(
    db.prepare(`SELECT id, slug FROM articles`).all().map((row) => [row.slug, row.id])
  );
  for (const item of imported) {
    const ids = (item.related_slugs || []).map((s) => idBySlug.get(s)).filter(Boolean);
    const self = idBySlug.get(item.slug);
    if (self && ids.length) {
      articlesService.persistCommunityFields(self, { relatedArticleIds: ids });
    }
  }

  const published = db
    .prepare(
      `SELECT a.*, u.display_name AS author_name
       FROM articles a LEFT JOIN users u ON u.id = a.author_id
       WHERE a.status = 'published'
       ORDER BY COALESCE(a.published_at, a.created_at) DESC`
    )
    .all();
  const seed = {
    source: 'live 11ka.cz sitemap scrape',
    imported_at: new Date().toISOString(),
    articles: published.map((row) => ({
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      body_html: row.body_html,
      hero_image_path: row.hero_image_path,
      hero_position: row.hero_position || '50% 50%',
      hero_credit: row.hero_credit,
      category: row.category,
      tag: row.tag,
      author_name: row.author_name || 'Redakce',
      status: 'published',
      published_at: row.published_at,
      created_at: row.created_at,
      view_count: row.view_count || 0,
      rubric_slug: row.rubric_slug || undefined,
      match_key: row.match_key || undefined,
      source_url: `${ORIGIN}/clanek/${row.slug}`,
    })),
  };
  fs.writeFileSync(SEED_ARTICLES, JSON.stringify(seed, null, 2));
  console.log(
    `Hotovo: ${ok} článků z webu, ${fail} chyb, v DB published=${published.length}, seed=${seed.articles.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

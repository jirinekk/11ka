const express = require('express');
const rateLimit = require('express-rate-limit');
const articlesService = require('../services/articles');
const articleRatingsService = require('../services/article-ratings');
const adsService = require('../services/ads');
const kitswapsService = require('../services/kitswaps');
const mostReadService = require('../services/most-read');
const usersService = require('../services/users');
const homeFallback = require('../data/home');
const { formatCzDate, relativeTime } = require('../lib/format');
const { parseBlocksInput, renderBlocksToHtml } = require('../lib/article-blocks');
const { prepareLineupForView } = require('../lib/lineup');
const { sendAccreditationRequest } = require('../services/mail');
const accreditationService = require('../services/accreditation');
const {
  resolveTagOptions,
  getTagsForNav,
  REGION_PARENTS,
  getTypeSubcat,
  getListingScope,
  resolveArticleSection,
} = require('../config/main-nav');
const { getRubric, listRubrics } = require('../config/rubrics');
const rubricsService = require('../services/rubrics');
const newsletterService = require('../services/newsletter');
const { safeNextPath } = require('../lib/safe-path');
const { buildHomeLeaderboardPlacements, getHomeLeaderboardPlacementsBySlug } = require('../config/ssp-zones');
const { getSidebarInstagramForView } = require('../services/sidebar-instagram-feed');
const pomahaEventsService = require('../services/pomaha-events');
const matchFixturesService = require('../services/match-fixtures');
const matchTeamsService = require('../services/match-teams');
const liveScoresService = require('../services/live-scores');
const livesportChance = require('../services/livesport-chance');
const chanceLigaLogos = require('../services/chance-liga-logos');
const penaltyGameService = require('../services/penalty-game');
const penaltyLeaderboardService = require('../services/penalty-leaderboard');
const articleTts = require('../services/article-tts');

function foldTeamName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function logoForTeam(lookup, name) {
  if (!name) return '';
  if (lookup[name]) return lookup[name];
  const needle = foldTeamName(name);
  if (!needle) return '';
  const entries = Object.entries(lookup || {});
  const exact = entries.find(([key]) => foldTeamName(key) === needle);
  if (exact && exact[1]) return exact[1];
  const partial = entries.find(([key]) => {
    const k = foldTeamName(key);
    return k && (needle.includes(k) || k.includes(needle));
  });
  return partial && partial[1] ? partial[1] : '';
}

function asChanceLeague(id, label, matches) {
  if (!matches || !matches.length) return [];
  return [{ id, label, matches }];
}

async function loadChanceStandings() {
  try {
    return await livesportChance.getStandings();
  } catch {
    return [];
  }
}

async function loadChanceResults(limit = 32) {
  try {
    const matches = await livesportChance.listResults(limit);
    return asChanceLeague('chance-liga-results', 'Chance Liga', matches);
  } catch {
    return [];
  }
}

async function loadChanceMatchLeagues(limit = 36) {
  try {
    const leagues = await liveScoresService.listChanceLigaSchedule({ limit });
    const lookup = matchTeamsService.buildLogoLookup();
    return (leagues || [])
      .map((league) => ({
        ...league,
        matches: (league.matches || []).map((m) => {
          const officialHome = league.id === 'chance-liga' ? chanceLigaLogos.logoForName(m.home) : '';
          const officialAway = league.id === 'chance-liga' ? chanceLigaLogos.logoForName(m.away) : '';
          return chanceLigaLogos.withLogos({
            ...m,
            homeLogo: officialHome || m.homeLogo || logoForTeam(lookup, m.home),
            awayLogo: officialAway || m.awayLogo || logoForTeam(lookup, m.away),
          });
        }),
      }))
      .filter((league) => league.matches && league.matches.length);
  } catch {
    return [];
  }
}

const router = express.Router();

const DEFAULT_CARD_IMAGE =
  'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=600&q=80';

function heroPositionFor(article) {
  return article?.hero_position || '50% 50%';
}

function heroSliderMobilePositionFor(article) {
  return (
    article?.hero_slider_mobile_position ||
    article?.hero_position ||
    '50% 50%'
  );
}

function heroSliderDesktopPositionFor(article) {
  return (
    article?.hero_slider_desktop_position ||
    article?.hero_position ||
    '50% 50%'
  );
}

function heroCardPositionFor(article) {
  return (
    article?.hero_card_position ||
    article?.hero_position ||
    '50% 50%'
  );
}

function mapArticleCard(a, imageFallback = DEFAULT_CARD_IMAGE) {
  return {
    id: a.id,
    image: a.hero_image_path || imageFallback,
    heroPosition: heroCardPositionFor(a),
    title: a.title,
    excerpt: a.excerpt || '',
    category: a.category ? String(a.category).trim() : '',
    tag: a.tag ? String(a.tag).trim() : '',
    isoTime: a.published_at || a.created_at || '',
    timeAgo: relativeTime(a.published_at || a.created_at),
    href: '/clanek/' + encodeURIComponent(a.slug),
  };
}

const HOME_CATEGORY_SECTIONS = REGION_PARENTS.map((parent) => ({
  title: parent.label,
  href: parent.href,
  category: parent.categories,
  regionTags: parent.regionTags,
}));

const HOME_SECTIONS_CACHE_TTL_MS = 30 * 1000;
let homeSectionsCache = { at: 0, sections: null };

function buildHomeSections() {
  const now = Date.now();
  if (homeSectionsCache.sections && now - homeSectionsCache.at < HOME_SECTIONS_CACHE_TTL_MS) {
    return homeSectionsCache.sections;
  }

  const sections = HOME_CATEGORY_SECTIONS.map((section) => ({
    title: section.title,
    href: section.href,
    articles: articlesService
      .listLatestForListing({
        scope: 'category',
        category: section.category,
        regionTags: section.regionTags,
        limit: 3,
      })
      .map((a) => mapArticleCard(a)),
  }));

  homeSectionsCache = { at: now, sections };
  return sections;
}

const HERO_COUNT = 3;
const LISTING_PER_PAGE = 6;
const SEARCH_POOL_LIMIT = 50;

function mapHeroSlides(articles) {
  return (articles || []).slice(0, HERO_COUNT).map((a) => ({
    image:
      a.hero_image_path ||
      'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1200&q=80',
    heroPositionMobile: heroSliderMobilePositionFor(a),
    heroPositionDesktop: heroSliderDesktopPositionFor(a),
    heroPosition: heroSliderDesktopPositionFor(a),
    title: a.title,
    excerpt: a.excerpt || '',
    tag: a.tag ? String(a.tag).trim() : '',
    category: a.category ? String(a.category).trim() : '',
    author: a.author_display || a.author_email || 'Redakce',
    isoTime: a.published_at || a.created_at || '',
    timeAgo: relativeTime(a.published_at || a.created_at),
    href: '/clanek/' + encodeURIComponent(a.slug),
  }));
}

function buildListingPageData(req, opts = {}) {
  const scope = opts.scope || 'category';
  const category = opts.category;
  const typeCategory = opts.typeCategory;
  const regionTags = opts.regionTags;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const tagFromQuery = typeof req.query.tag === 'string' ? req.query.tag.trim().slice(0, 60) : '';
  const tag = scope === 'tag' ? String(opts.fixedTag || tagFromQuery || '').trim() : tagFromQuery;
  const perPage = LISTING_PER_PAGE;
  const listingQuery = scope === 'category' ? q : scope === 'all' ? q : '';
  const listingExtra = { typeCategory, regionTags, rubricSlug: opts.rubricSlug };

  if (scope === 'search') {
    if (!q) {
      return {
        tag,
        query: q,
        articles: [],
        heroSlides: [],
        pagination: null,
      };
    }

    const pool = articlesService.searchPublishedFull(q, SEARCH_POOL_LIMIT, tag);
    const heroArticles =
      pool.length >= HERO_COUNT
        ? [...pool]
            .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
            .slice(0, HERO_COUNT)
        : [];
    const heroIds = new Set(heroArticles.map((a) => a.id));
    const gridPool = heroIds.size
      ? pool.filter((a) => !heroIds.has(a.id))
      : pool;
    return {
      tag,
      query: q,
      articles: (gridPool.length > 0 ? gridPool : pool).map((a) => mapArticleCard(a)),
      heroSlides: mapHeroSlides(heroArticles),
      pagination: null,
    };
  }

  const totalItems = articlesService.countForListing({
    scope,
    category,
    tag,
    query: listingQuery,
    ...listingExtra,
  });
  const page = parsePositiveInt(req.query.page, 1);
  const appliesHero = !listingQuery;
  const minHero = scope === 'rubric' ? 1 : HERO_COUNT;
  const useHero = page === 1 && appliesHero && totalItems >= minHero;
  const pagination = buildPagination({
    pathname: req.path,
    query: req.query,
    page,
    perPage,
    totalItems,
  });
  const gridOffset = (pagination.page - 1) * perPage;

  let heroSlides = [];
  if (useHero) {
    const heroArticles = articlesService.listMostReadForListing({
      scope,
      category,
      tag,
      query: listingQuery,
      ...listingExtra,
      limit: HERO_COUNT,
    });
    heroSlides = mapHeroSlides(heroArticles);
  }

  const dbArticles = articlesService.listPagedForListing({
    scope,
    category,
    tag,
    query: listingQuery,
    ...listingExtra,
    limit: perPage,
    offset: gridOffset,
  });

  return {
    tag,
    query: q,
    articles: dbArticles.map((a) => mapArticleCard(a)),
    heroSlides,
    pagination,
  };
}

const rubricNotifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function buildRubricPage(req, rubric) {
  if (!rubric) return null;
  const email = req.user && req.user.email ? req.user.email : '';
  return {
    slug: rubric.slug,
    label: rubric.label,
    description: rubric.description || '',
    owner_name: rubric.owner_name || '',
    owner_href: rubricsService.ownerHref(rubric),
    owner_avatar: rubric.owner_avatar || '',
    owner_initials: rubricsService.ownerInitials(rubric.owner_name),
    notify_enabled: !!rubric.notify_enabled,
    subscribed: email ? rubricsService.isSubscribed(rubric.id, email) : false,
  };
}

const akreditaceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function parseAkreditaceBody(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const phone = String(body?.phone || '').trim();
  const name = String(body?.name || '').trim();
  const match = String(body?.match || '').trim();
  const match_date = String(body?.match_date || '').trim();
  const accreditation_type = String(body?.accreditation_type || '').trim();
  return { email, phone, name, match, match_date, accreditation_type };
}

function isValidAkreditacePayload(data) {
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return false;
  if (!data.phone || data.phone.length < 6) return false;
  if (!data.name || data.name.length < 2) return false;
  if (!data.match || data.match.length < 2) return false;
  if (!accreditationService.isValidMatchDate(data.match_date)) return false;
  if (data.accreditation_type !== 'photo' && data.accreditation_type !== 'pisi') return false;
  return true;
}

function renderAkreditacePage(req, res, opts = {}) {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
  const formStatus =
    req.query.submitted === 'ok' || req.query.submitted === 'bad' ? req.query.submitted : null;

  const totalItems = accreditationService.countPublic();

  const perPageDesktop = 7;
  const rawPage = parseInt(req.query.page, 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const totalPagesDesktop = Math.max(1, Math.ceil(totalItems / perPageDesktop));
  const page = Math.min(requestedPage, totalPagesDesktop);
  const offsetDesktop = (page - 1) * perPageDesktop;
  const accreditationRequests = accreditationService.listPublicPaged(perPageDesktop, offsetDesktop);

  res.render('akreditace', {
      title: 'Akreditace - 11ka',
      activeNav: 'home',
      formStatus: opts.formStatus || formStatus,
      formValues: opts.formValues || null,
      accreditationRequests,
      pagination: {
        page,
        perPage: perPageDesktop,
        totalItems,
        totalPages: totalPagesDesktop,
        hasPrev: page > 1,
        hasNext: page < totalPagesDesktop,
      },
      newsletter: homeFallback.newsletter,
      newsletterStatus,
      adMap,
      ...seoForPage({
        title: 'Akreditace - 11ka.cz',
        description: 'Žádost o akreditaci pro média na 11ka.cz.',
        path: '/akreditace',
      }),
    });
}
const SEO_BASE_URL = 'https://11ka.cz';
const DEFAULT_OG_IMAGE = `${SEO_BASE_URL}/logo.png`;

router.use(async (req, res, next) => {
  try {
    res.locals.sidebarInstagram = await getSidebarInstagramForView();
  } catch (err) {
    console.error('[11ka] sidebar Instagram:', err && err.message);
    const { getSidebarInstagram } = require('../config/sidebar-instagram');
    res.locals.sidebarInstagram = getSidebarInstagram();
  }
  res.locals.chanceStandings = await loadChanceStandings();
  next();
});

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absoluteUrl(pathname) {
  return `${SEO_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function absoluteImageUrl(url) {
  if (!url) return DEFAULT_OG_IMAGE;
  if (/^https?:\/\//i.test(url)) return url;
  return absoluteUrl(url);
}

function seoForPage({
  title,
  description,
  path,
  ogType = 'website',
  ogImage = DEFAULT_OG_IMAGE,
  metaRobots = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
  metaKeywords,
  metaAuthor,
  structuredData = [],
}) {
  return {
    metaTitle: title,
    metaDescription: description,
    metaKeywords: metaKeywords || undefined,
    metaAuthor: metaAuthor || undefined,
    canonicalUrl: absoluteUrl(path),
    ogTitle: title,
    ogDescription: description,
    ogUrl: absoluteUrl(path),
    ogType,
    ogImage,
    twitterCard: 'summary_large_image',
    metaRobots,
    structuredData,
  };
}

router.get('/robots.txt', (req, res) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(body);
});

router.get('/sitemap.xml', (req, res) => {
  const staticPaths = [
    '/',
    '/zapasy/live',
    '/cesky-fotbal',
    '/cesky-fotbal/zapasy',
    '/cesky-fotbal/analyzy',
    '/cesky-fotbal/rozhovory',
    '/zensky-fotbal',
    '/zensky-fotbal/zapasy',
    '/zensky-fotbal/analyzy',
    '/zensky-fotbal/rozhovory',
    '/svetovy-fotbal',
    '/svetovy-fotbal/zapasy',
    '/svetovy-fotbal/analyzy',
    '/svetovy-fotbal/rozhovory',
    '/vsechny-clanky',
    '/kontakt',
    '/spoluprace',
    '/akreditace',
    '/redakce',
    '/11ka-pomaha',
    '/podminky-uziti',
    '/ochrana-osobnich-udaju',
    '/cookies',
  ];
  const staticEntries = staticPaths.map((p) => ({ loc: absoluteUrl(p), lastmod: new Date().toISOString() }));
  const articleEntries = articlesService.listPublishedForSitemap(5000).map((a) => ({
    loc: absoluteUrl(`/clanek/${encodeURIComponent(a.slug)}`),
    lastmod: a.updated_at || a.published_at || a.created_at || new Date().toISOString(),
  }));
  const entries = [...staticEntries, ...articleEntries];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map((e) => `  <url><loc>${escapeXml(e.loc)}</loc><lastmod>${escapeXml(e.lastmod)}</lastmod></url>`)
      .join('\n') +
    `\n</urlset>\n`;
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(xml);
});

function rssImageMimeType(imageUrl) {
  const pathOnly = String(imageUrl || '').split('?')[0].toLowerCase();
  if (pathOnly.endsWith('.png')) return 'image/png';
  if (pathOnly.endsWith('.webp')) return 'image/webp';
  if (pathOnly.endsWith('.gif')) return 'image/gif';
  if (pathOnly.endsWith('.svg')) return 'image/svg+xml';
  if (pathOnly.endsWith('.jpg') || pathOnly.endsWith('.jpeg') || pathOnly.endsWith('.jfif')) {
    return 'image/jpeg';
  }
  return 'image/jpeg';
}

function rssPublicAuthorEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value || !value.includes('@')) return '';
  if (value.endsWith('.local') || value.endsWith('@localhost') || value.includes('@11ka.local')) {
    return '';
  }
  return String(email || '').trim();
}

function buildRssFeedXml() {
  const latest = articlesService.listPublishedForRss(50);
  const now = new Date().toUTCString();
  const selfUrl = absoluteUrl('/feed.xml');
  const items = latest
    .map((a) => {
      const link = absoluteUrl(`/clanek/${encodeURIComponent(a.slug)}`);
      const pubDate = new Date(a.published_at || a.created_at || Date.now()).toUTCString();
      const authorName = (a.author_display || '').trim() || 'Redakce 11ka.cz';
      const authorEmail = rssPublicAuthorEmail(a.author_email);
      const category = (a.category || '').trim();
      const excerpt = (a.excerpt || '').trim();
      const imageUrl = a.hero_image_path ? absoluteImageUrl(a.hero_image_path) : '';
      const parts = [
        '  <item>',
        `    <title>${escapeXml(a.title || '')}</title>`,
        `    <link>${escapeXml(link)}</link>`,
        `    <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `    <pubDate>${escapeXml(pubDate)}</pubDate>`,
        `    <dc:creator>${escapeXml(authorName)}</dc:creator>`,
      ];
      if (authorEmail) {
        parts.push(`    <author>${escapeXml(`${authorEmail} (${authorName})`)}</author>`);
      }
      if (category) parts.push(`    <category>${escapeXml(category)}</category>`);
      if (excerpt) parts.push(`    <description>${escapeXml(excerpt)}</description>`);
      if (imageUrl) {
        const mime = rssImageMimeType(imageUrl);
        parts.push(
          `    <media:content url="${escapeXml(imageUrl)}" type="${escapeXml(mime)}" medium="image" />`,
          `    <media:thumbnail url="${escapeXml(imageUrl)}" />`
        );
      }
      parts.push('  </item>');
      return parts.join('\n');
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">\n` +
    `<channel>\n` +
    `  <title>11ka.cz</title>\n` +
    `  <link>${escapeXml(absoluteUrl('/'))}</link>\n` +
    `  <description>Fotbalové zprávy, analýzy a rozhovory z 11ka.cz</description>\n` +
    `  <language>cs-CZ</language>\n` +
    `  <lastBuildDate>${escapeXml(now)}</lastBuildDate>\n` +
    `  <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />\n` +
    `${items}\n` +
    `</channel>\n` +
    `</rss>\n`
  );
}

function sendRssFeed(res) {
  res.set('Cache-Control', 'public, max-age=1800');
  res.type('application/rss+xml; charset=utf-8').send(buildRssFeedXml());
}

router.get('/feed.xml', (req, res) => sendRssFeed(res));
router.get('/rss', (req, res) => sendRssFeed(res));
router.get('/rss.xml', (req, res) => sendRssFeed(res));

router.get('/zapasy-dne', (req, res) => res.redirect(301, '/'));
router.get('/zive-skore/:eventId', (req, res) => res.redirect(301, '/zapasy/live'));

router.get('/', async (req, res) => {
  const adMap = adsService.getActiveMap();
  const published = articlesService.listPublishedLatestSafe(12);
  const heroSlides = mapHeroSlides(published);
  const hero = heroSlides[0] || homeFallback.hero;
  const homeSections = buildHomeSections();
  const chanceMatchLeagues = await loadChanceMatchLeagues(16);
  const chanceStandings = await loadChanceStandings();
  const sidebarMostReadDb = mostReadService.getMostReadCards({
    layout: 'sidebar',
    limit: 4,
  });
  const sidebarMostRead = sidebarMostReadDb.length
    ? sidebarMostReadDb
    : homeFallback.mostRead.slice(0, 4);
  const sidebarFavorites = articleRatingsService.listFavorites();
  const kitswaps = kitswapsService.listActiveForHome();
  const pomahaHomeAd = adMap.home_pomaha_11ka || null;

  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;

  res.render('index', {
    title: '11ka - Domů',
    activeNav: 'home',
    hero,
    heroSlides,
    chanceMatchLeagues,
    chanceStandings,
    sidebarMostRead,
    sidebarFavorites,
    homeSections,
    pomahaHomeAd,
    homeLeaderboardPlacements: buildHomeLeaderboardPlacements(),
    homeLeaderboardPlacementsBySlug: getHomeLeaderboardPlacementsBySlug(),
    kitswaps,
    newsletter: homeFallback.newsletter,
    adMap,
    homeBelowSocialAd: adsService.pickCreative('home_below_social'),
    newsletterStatus,
    showRecruitmentModal: true,
    ...seoForPage({
      title: '11ka.cz - Fotbalové zprávy, analýzy a rozhovory',
      description:
        'Online sportovní magazín 11ka.cz: nejnovější fotbalové zprávy, rozhovory, analýzy a nejčtenější články.',
      path: '/',
      metaKeywords: 'fotbal, fotbalové zprávy, 11ka, český fotbal',
      metaAuthor: 'Redakce 11ka.cz',
      structuredData: [
        {
          '@type': 'CollectionPage',
          name: '11ka.cz',
          url: absoluteUrl('/'),
        },
      ],
    }),
  });
});

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function pageUrl(pathname, query, page) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (k === 'page') continue;
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const one of v) params.append(k, String(one));
    } else {
      params.set(k, String(v));
    }
  }
  if (page && page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function buildPagination({ pathname, query, page, perPage, totalItems }) {
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const hasPrev = safePage > 1;
  const hasNext = safePage < totalPages;

  const windowSize = 7;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, safePage - half);
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const pages = [];
  for (let p = start; p <= end; p++) {
    pages.push({ n: p, url: pageUrl(pathname, query, p), current: p === safePage });
  }

  return {
    page: safePage,
    perPage,
    totalItems: totalItems || 0,
    totalPages,
    hasPrev,
    hasNext,
    prevUrl: hasPrev ? pageUrl(pathname, query, safePage - 1) : null,
    nextUrl: hasNext ? pageUrl(pathname, query, safePage + 1) : null,
    pages,
  };
}

async function renderCategoryPage(req, res, opts) {
  const { category, activeNav, activeSubnav, pageTitle, pageSubtitle, emptyTitle, emptySubtitle, searchQuery } = opts;
  const tagPillsMode =
    opts.tagPillsMode != null
      ? opts.tagPillsMode
      : 'full';

  const adMap = adsService.getActiveMap();
  let tagOptions = opts.tagOptions != null
    ? opts.tagOptions
    : resolveTagOptions(activeNav, articlesService.listDistinctTags(200));
  const listing = buildListingPageData(req, {
    scope: opts.scope || 'category',
    category,
    typeCategory: opts.typeCategory,
    regionTags: opts.regionTags,
    rubricSlug: opts.rubricSlug,
  });
  if (listing.tag && !tagOptions.includes(listing.tag)) tagOptions = [listing.tag, ...tagOptions];

  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;

  res.render('category', {
    title: `${pageTitle} - 11ka`,
    activeNav,
    activeSubnav: activeSubnav || '',
    pageTitle,
    pageSubtitle,
    emptyTitle,
    emptySubtitle,
    searchQuery: listing.query || searchQuery,
    tagPillsMode,
    tag: listing.tag,
    tagOptions,
    articles: listing.articles,
    heroSlides: listing.heroSlides,
    pagination: listing.pagination,
    newsletter: homeFallback.newsletter,
    adMap,
    newsletterStatus,
    rubricPage: opts.rubricPage || null,
    rubricCards: opts.rubricCards || null,
    rubricNotifyStatus: opts.rubricNotifyStatus || null,
    ...seoForPage({
      title: `${pageTitle} - 11ka.cz`,
      description: `${pageTitle} na 11ka.cz - nejnovější články, analýzy a přehledy.`,
      path: req.path,
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: pageTitle,
          url: absoluteUrl(req.path),
        },
      ],
    }),
  });
}

const SECTION_META = Object.fromEntries(
  REGION_PARENTS.flatMap((parent) =>
    parent.categories.map((category) => [
      category,
      { label: parent.label, href: parent.href, nav: parent.id },
    ])
  )
);

function fixtureToListRow(fixture) {
  const isLive = !!fixture.isLive;
  const isDone = fixture.status === 'Odehráno' || fixture.status === 'Kontumace';
  return {
    home: fixture.homeTeam,
    away: fixture.awayTeam,
    homeLabel: fixture.homeTeam,
    awayLabel: fixture.awayTeam,
    homeLogo: fixture.homeLogo || '',
    awayLogo: fixture.awayLogo || '',
    isLive,
    isDone,
    dayKey: fixture.dayKey || livesportChance.pragueDayKey(fixture.kickoffAt || fixture.kickoff_at || fixture.date),
    scoreLine: fixture.showScore ? `${fixture.homeScore} - ${fixture.awayScore}` : '–',
    badge: isLive ? 'LIVE' : isDone ? 'FT' : fixture.kickoffTime || '',
    detailHref: fixture.detailUrl,
    homeHref: '',
    awayHref: '',
  };
}

function normalizeAgendaMatch(m) {
  const done = !!m.isDone;
  const live = !!m.isLive;
  const raw = String(m.scoreLine || m.score || '').replace(/\s+/g, '');
  const parts = raw.match(/^(\d+)[:\-](\d+)$/);
  return {
    ...m,
    dayKey: m.dayKey || livesportChance.pragueDayKey(m.date || m.kickoff),
    homeLabel: m.homeLabel || m.home,
    awayLabel: m.awayLabel || m.away,
    scoreLine: live || done ? (parts ? `${parts[1]} - ${parts[2]}` : m.scoreLine || m.score || '0 - 0') : m.scoreLine || '–',
    badge: live ? 'LIVE' : done ? 'FT' : m.badge || m.time || '',
  };
}

function groupAgendaDays(leagues, fromDay) {
  const map = new Map();
  (leagues || []).forEach((league) => {
    (league.matches || []).forEach((m) => {
      const key = m.dayKey || '';
      if (!key) return;
      if (fromDay && key < fromDay) return;
      if (!map.has(key)) {
        map.set(key, {
          day: key,
          dayLabel: livesportChance.formatDayNavLabel(key),
          leagues: [],
        });
      }
      const bucket = map.get(key);
      let group = bucket.leagues.find((item) => item.id === league.id);
      if (!group) {
        group = { id: league.id, label: league.label, matches: [] };
        bucket.leagues.push(group);
      }
      group.matches.push(m);
    });
  });
  let days = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  if (!days.length && fromDay) days = groupAgendaDays(leagues, '');
  return days;
}

function matchesHubQs(base, extra) {
  const params = new URLSearchParams();
  const merged = { ...base, ...extra };
  Object.keys(merged).forEach((key) => {
    const val = merged[key];
    if (val) params.set(key, val);
  });
  const qs = params.toString();
  return qs ? `/zapasy/live?${qs}` : '/zapasy/live';
}

router.get('/zapasy/live', async (req, res) => {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;

  const liveOnly = String(req.query.live || '') === '1';
  const ligaFilter = String(req.query.liga || '').trim();
  const focusDay = String(req.query.den || '').trim().slice(0, 10);
  let agenda = { today: '', liveCount: 0, matches: [] };
  try {
    agenda = await livesportChance.getMatchesAgenda();
  } catch {
    agenda = { today: '', liveCount: 0, matches: [] };
  }

  const today = agenda.today || livesportChance.pragueDayKey(new Date().toISOString());
  const chanceStandings = await loadChanceStandings();
  let narodni = [];
  try {
    narodni = await livesportChance.listNarodniLiga();
  } catch {
    narodni = [];
  }

  let repre = [];
  try {
    repre = await livesportChance.listCzechNational();
  } catch {
    repre = [];
  }

  let leagues = [
    { id: 'chance-liga', label: 'Chance Liga', matches: agenda.matches || [] },
    { id: 'chance-narodni', label: 'Chance Národní liga', matches: narodni },
    { id: 'ceska-reprezentace', label: 'Česká reprezentace', matches: repre },
  ];
  if (liveOnly) {
    leagues = leagues.map((league) => ({
      ...league,
      matches: (league.matches || []).filter((m) => m.isLive),
    }));
  }
  if (ligaFilter) {
    leagues = leagues.filter((league) => league.id === ligaFilter);
  }

  const matchDays = groupAgendaDays(leagues, today).slice(0, 12);
  const liveCount = matchDays.reduce(
    (sum, day) =>
      sum +
      day.leagues.reduce((n, league) => n + (league.matches || []).filter((m) => m.isLive).length, 0),
    0
  );
  const qsBase = { liga: ligaFilter || '', live: liveOnly ? '1' : '' };
  const sidebarMostRead = mostReadService.getMostReadCards({ layout: 'sidebar', limit: 4 });

  res.render('zapasy-live', {
    title: 'Seznam zápasů - 11ka',
    activeNav: 'zapasy',
    pageTitle: 'Zápasy',
    matchDays,
    focusDay: /^\d{4}-\d{2}-\d{2}$/.test(focusDay) ? focusDay : (matchDays[0] && matchDays[0].day) || today,
    liveCount,
    ligaFilter,
    liveOnly,
    liveHref: matchesHubQs({ liga: ligaFilter }, { live: liveOnly ? '' : '1' }),
    ligaHrefs: {
      all: matchesHubQs({ live: liveOnly ? '1' : '' }, { liga: '' }),
      'chance-liga': matchesHubQs(qsBase, { liga: 'chance-liga' }),
      'chance-narodni': matchesHubQs(qsBase, { liga: 'chance-narodni' }),
      'ceska-reprezentace': matchesHubQs(qsBase, { liga: 'ceska-reprezentace' }),
    },
    chanceStandings,
    chanceClubs: chanceLigaLogos.listClubs(),
    sidebarMostRead,
    newsletter: homeFallback.newsletter,
    newsletterStatus,
    adMap,
    ...seoForPage({
      title: 'Zápasy - 11ka.cz',
      description: 'Program, výsledky a tabulka Chance Ligy na 11ka.cz.',
      path: '/zapasy/live',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Zápasy',
          url: absoluteUrl('/zapasy/live'),
        },
      ],
    }),
  });
});

router.get('/klub/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  let profile = null;
  try {
    profile = await livesportChance.getClubProfile(slug);
  } catch {
    profile = null;
  }
  if (!profile || !profile.club) {
    return res.status(404).render('404', { title: 'Klub nenalezen - 11ka', activeNav: 'zapasy' });
  }
  const club = profile.club;
  const clubArticles = articlesService
    .listPublishedByTeamCode(club.code, 6)
    .map((row) => mapArticleCard(row));
  const hubRaw = String(req.query.view || '').trim().toLowerCase();
  const clubHubView = ['soupiska', 'program', 'vysledky', 'tabulka'].includes(hubRaw)
    ? hubRaw
    : 'soupiska';

  res.render('klub', {
    title: `${club.name} - Chance Liga - 11ka`,
    activeNav: 'zapasy',
    club,
    clubRow: profile.row,
    clubSquad: profile.squad,
    chanceStandings: profile.standings || [],
    clubProgramLeagues: asChanceLeague('club-program', 'Program', profile.program),
    clubResultLeagues: asChanceLeague('club-results', 'Výsledky', profile.results),
    clubArticles,
    clubHubView,
    ...seoForPage({
      title: `${club.name} - Chance Liga - 11ka`,
      description: `Profil ${club.name}: soupiska, program, výsledky a tabulka Chance Ligy na 11ka.cz.`,
      path: club.href,
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'SportsTeam',
          name: club.name,
          url: absoluteUrl(club.href),
          sport: 'Soccer',
        },
      ],
    }),
  });
});

router.get('/tym/:slug', (req, res) => {
  res.redirect(301, `/klub/${encodeURIComponent(String(req.params.slug || '').trim())}`);
});

router.get('/zapasy/chance/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  let match = null;
  try {
    match = await livesportChance.getMatchDetail(slug);
  } catch {
    match = null;
  }
  if (!match) {
    return res.status(404).render('404', { title: 'Zápas nenalezen - 11ka', activeNav: 'zapasy' });
  }
  match = chanceLigaLogos.withLogos(match);
  const matchArticles = articlesService
    .listPublishedByMatchKey(`chance:${slug}`, 8)
    .map((row) => mapArticleCard(row));
  const chanceStandings = await loadChanceStandings();
  let roundMates = [];
  try {
    roundMates = await livesportChance.listSameRound(match.round, match.id);
  } catch {
    roundMates = [];
  }

  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
  const newsletterStatus = nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
  const pageTitle = `${match.home} vs ${match.away}`;
  const seoTitle = `${pageTitle} - Chance Liga - 11ka`;

  res.render('chance-zapas-detail', {
    title: seoTitle,
    activeNav: 'zapasy',
    pageTitle,
    match,
    matchArticles,
    chanceStandings,
    roundMates,
    newsletter: homeFallback.newsletter,
    newsletterStatus,
    adMap,
    ...seoForPage({
      title: seoTitle,
      description: `Zápas ${match.home} vs ${match.away} (Chance Liga) na 11ka.cz — skóre, střelci a sestavy.`,
      path: match.href || `/zapasy/chance/${slug}`,
      ogType: 'website',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: pageTitle,
          url: absoluteUrl(match.href || `/zapasy/chance/${slug}`),
          startDate: match.date || undefined,
          homeTeam: { '@type': 'SportsTeam', name: match.home },
          awayTeam: { '@type': 'SportsTeam', name: match.away },
        },
      ],
    }),
  });
});

router.get('/zapasy/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.redirect(302, '/zapasy/live');
  }

  const row = matchFixturesService.getById(id);
  if (!row) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'zapasy' });
  }

  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
  const logoLookup = matchTeamsService.buildLogoLookup();
  const fixture = matchFixturesService.formatForWeb(row);
  fixture.homeLogo = logoLookup[fixture.homeTeam] || '';
  fixture.awayLogo = logoLookup[fixture.awayTeam] || '';

  const pageTitle = `${fixture.homeTeam} vs ${fixture.awayTeam}`;
  const seoTitle = fixture.competition
    ? `${pageTitle} - ${fixture.competition} - 11ka`
    : `${pageTitle} - 11ka`;

  res.render('zapas-detail', {
    title: seoTitle,
    activeNav: 'zapasy',
    pageTitle,
    fixture,
    newsletter: homeFallback.newsletter,
    newsletterStatus,
    adMap,
    ...seoForPage({
      title: seoTitle,
      description: `Zápas ${fixture.homeTeam} vs ${fixture.awayTeam}${fixture.competition ? ` (${fixture.competition})` : ''} na 11ka.cz.`,
      path: `/zapasy/${id}`,
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: pageTitle,
          url: absoluteUrl(`/zapasy/${id}`),
          homeTeam: { '@type': 'SportsTeam', name: fixture.homeTeam },
          awayTeam: { '@type': 'SportsTeam', name: fixture.awayTeam },
        },
      ],
    }),
  });
});

function renderRegionCategory(req, res, parent, subcat) {
  const listing = getListingScope(parent, subcat);
  const pageTitle = subcat ? `${parent.label} · ${subcat.label}` : parent.label;
  return renderCategoryPage(req, res, {
    category: listing.category,
    typeCategory: listing.typeCategory,
    regionTags: listing.regionTags,
    activeNav: parent.id,
    activeSubnav: subcat ? subcat.id : '',
    pageTitle,
  });
}

router.get('/zapasy', (req, res) => {
  res.redirect(301, '/zapasy/live');
});

router.get('/rozhovory', (req, res) => {
  res.redirect(301, '/cesky-fotbal/rozhovory');
});

router.get('/analyzy', (req, res) => {
  res.redirect(301, '/cesky-fotbal/analyzy');
});

router.get('/ceska-liga', (req, res) => {
  res.redirect(301, '/cesky-fotbal');
});

router.get('/evropa', (req, res) => {
  res.redirect(301, '/svetovy-fotbal');
});

router.get('/rubriky', async (req, res) => {
  return renderCategoryPage(req, res, {
    scope: 'rubric',
    activeNav: 'rubriky',
    activeSubnav: '',
    pageTitle: 'Rubriky',
    pageSubtitle: 'Sloupky a pravidelné rubriky 11ky.',
    emptyTitle: 'Zatím tu žádná rubrika není.',
    emptySubtitle: 'Jakmile redakce označí článek jako rubriku, objeví se tady.',
    tagPillsMode: 'none',
    tagOptions: [],
    rubricCards: listRubrics(),
  });
});

router.get('/rubriky/:slug', async (req, res) => {
  const rubric = getRubric(req.params.slug);
  if (!rubric) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'rubriky' });
  }
  const notifyQ = String(req.query.oznameni || '').trim();
  const rubricNotifyStatus =
    notifyQ === 'ok' || notifyQ === 'off' || notifyQ === 'dupe' || notifyQ === 'bad' ? notifyQ : null;
  return renderCategoryPage(req, res, {
    scope: 'rubric',
    rubricSlug: rubric.slug,
    activeNav: 'rubriky',
    activeSubnav: rubric.slug,
    pageTitle: rubric.label,
    pageSubtitle: rubric.description || '',
    emptyTitle: 'V této rubrice zatím nic není.',
    emptySubtitle: 'Nové díly se tu objeví, jakmile je redakce vydá.',
    tagPillsMode: 'none',
    tagOptions: [],
    rubricPage: buildRubricPage(req, rubric),
    rubricNotifyStatus,
  });
});

router.post(
  '/rubriky/:slug/oznameni',
  rubricNotifyLimiter,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const rubric = getRubric(req.params.slug);
    if (!rubric) {
      return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'rubriky' });
    }
    const action = String(req.body.action || 'on').trim();
    const email = (req.user && req.user.email) || req.body.email;
    const userId = req.user && req.user.id;
    let status = 'bad';
    if (action === 'off') {
      status = rubricsService.unsubscribe(rubric.id, email) ? 'off' : 'bad';
    } else {
      status = rubricsService.subscribe(rubric.id, { email, userId });
    }
    return res.redirect(302, `/rubriky/${encodeURIComponent(rubric.slug)}?oznameni=${encodeURIComponent(status)}`);
  }
);

router.get('/rubriky/:slug/oznameni/odhlasit', (req, res) => {
  const rubric = getRubric(req.params.slug);
  if (!rubric) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'rubriky' });
  }
  const email = String(req.query.email || '').trim();
  const token = String(req.query.token || '');
  const okToken = newsletterService.verifyUnsubscribeToken(email, token);
  const removed = okToken ? rubricsService.unsubscribe(rubric.id, email) : false;
  return res.redirect(
    302,
    `/rubriky/${encodeURIComponent(rubric.slug)}?oznameni=${removed ? 'off' : 'bad'}`
  );
});

REGION_PARENTS.forEach((parent) => {
  router.get(`/${parent.slug}`, async (req, res) => {
    return renderRegionCategory(req, res, parent, null);
  });

  router.get(`/${parent.slug}/:subcat`, async (req, res) => {
    const subcat = getTypeSubcat(req.params.subcat);
    if (!subcat) {
      return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: parent.id });
    }
    return renderRegionCategory(req, res, parent, subcat);
  });
});

router.get('/nejctenejsi', (req, res) => {
  res.redirect(301, '/vsechny-clanky');
});

router.get('/vsechny-clanky', async (req, res) => {
  const adMap = adsService.getActiveMap();
  const tagOptions = Array.from(
    new Set([
      ...getTagsForNav('vsechny-clanky'),
      ...articlesService.listDistinctTags(200),
    ].filter(Boolean)),
  );

  const listing = buildListingPageData(req, { scope: 'all' });
  if (listing.tag && !tagOptions.includes(listing.tag)) tagOptions.unshift(listing.tag);

  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;

  res.render('category', {
    title: 'Všechny Články - 11ka',
    activeNav: 'vsechny-clanky',
    pageTitle: 'Všechny Články',
    pageSubtitle: '',
    tag: listing.tag,
    tagOptions,
    articles: listing.articles,
    heroSlides: listing.heroSlides,
    pagination: listing.pagination,
    newsletter: homeFallback.newsletter,
    adMap,
    newsletterStatus,
    ...seoForPage({
      title: 'Všechny Články - 11ka.cz',
      description: 'Přehled článků na 11ka.cz.',
      path: '/vsechny-clanky',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Všechny Články',
          url: absoluteUrl('/vsechny-clanky'),
        },
      ],
    }),
  });
});

router.get('/stitky/:tag', async (req, res) => {
  const tagParam = String(req.params.tag || '').trim();
  if (!tagParam) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
  }

  const adMap = adsService.getActiveMap();
  const tagOptions = articlesService.listDistinctTags(200);
  const listing = buildListingPageData(req, { scope: 'tag', fixedTag: tagParam });

  res.render('category', {
    title: `${tagParam} - 11ka`,
    activeNav: 'tags',
    pageTitle: tagParam,
    pageSubtitle: '',
    tag: listing.tag,
    tagOptions,
    articles: listing.articles,
    heroSlides: listing.heroSlides,
    pagination: listing.pagination,
    newsletter: homeFallback.newsletter,
    adMap,
    newsletterStatus: null,
    ...seoForPage({
      title: `${tagParam} - 11ka.cz`,
      description: `Články se štítkem ${tagParam} na 11ka.cz.`,
      path: `/stitky/${encodeURIComponent(tagParam)}`,
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: tagParam,
          url: absoluteUrl(`/stitky/${encodeURIComponent(tagParam)}`),
        },
      ],
    }),
  });
});

router.get('/hledat', async (req, res) => {
  const qRaw = typeof req.query.q === 'string' ? req.query.q : '';
  const q = qRaw.trim().slice(0, 80);

  const adMap = adsService.getActiveMap();
  const tagOptions = articlesService.listDistinctTags(200);
  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;

  const listing = buildListingPageData(req, { scope: 'search' });

  res.render('category', {
    title: q ? `Vyhledávání: ${q} - 11ka` : 'Vyhledávání - 11ka',
    activeNav: 'search',
    pageTitle: 'Vyhledávání',
    pageSubtitle: q ? `Výsledky pro „${q}“` : 'Zadejte dotaz do vyhledávání nahoře.',
    emptyTitle: q ? 'Nic jsme nenašli.' : 'Zadejte vyhledávací dotaz.',
    emptySubtitle: q ? 'Zkuste jiná klíčová slova.' : 'Např. název týmu, hráče nebo rubriku.',
    tagPillsMode: 'none',
    searchQuery: q,
    tag: listing.tag,
    tagOptions,
    articles: listing.articles,
    heroSlides: listing.heroSlides,
    pagination: listing.pagination,
    newsletter: homeFallback.newsletter,
    adMap,
    newsletterStatus,
    ...seoForPage({
      title: q ? `Vyhledávání „${q}“ - 11ka.cz` : 'Vyhledávání - 11ka.cz',
      description: q
        ? `Výsledky vyhledávání pro „${q}“ na 11ka.cz.`
        : 'Vyhledávání článků na 11ka.cz.',
      path: q ? `/hledat?q=${encodeURIComponent(q)}` : '/hledat',
      metaRobots: 'noindex, follow',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'SearchResultsPage',
          name: q ? `Vyhledávání: ${q}` : 'Vyhledávání',
          url: absoluteUrl('/hledat'),
        },
      ],
    }),
  });
});

router.get('/kontakt', (req, res) => {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
    const newsletterStatus =
      nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
    res.render('static', {
      title: 'Kontakt - 11ka',
      activeNav: 'home',
      pageTitle: 'Kontakt',
      sections: [
        {
          heading: 'Spolupráce',
          paragraphs: [
            'Jiří Galba, majitel - jgalba@11ka.cz',
          ],
        },
        {
          heading: 'Vedení',
          paragraphs: [
            'Jiří Galba, majitel - jgalba@11ka.cz',
            'Jan Brabec, majitel - jbrabec@11ka.cz',
          ],
        },
        {
          heading: 'Redakce',
          paragraphs: [
            'Jan Kryštof Jehne, zástupce šéfredaktora - kjehne@11ka.cz',
          ],
        },
        {
          heading: 'Vedení redakce',
          paragraphs: [
            'Jan Kryštof Jehne, zástupce šéfredaktora - kjehne@11ka.cz',
            'Ferdinand Hlavsa, šéfredaktor - fhlavsa@11ka.cz',
          ],
        },
        {
          heading: 'Vedení fotografů',
          paragraphs: [
            'Matěj Kubeš, koordinátor fotografů - mkubes@11ka.cz',
          ],
        },
      ],
      newsletter: homeFallback.newsletter,
      newsletterStatus,
      adMap,
      ...seoForPage({
        title: 'Kontakt - 11ka.cz',
        description: 'Kontakt na redakci 11ka.cz.',
        path: '/kontakt',
      }),
    });
});

router.get('/spoluprace', (req, res) => {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
  res.render('static', {
    title: 'Spolupráce - 11ka',
    activeNav: 'home',
    pageTitle: 'Nabídka spolupráce',
    sections: [
      {
        heading: 'Dostaňte svou značku mezi fotbalové fanoušky',
        paragraphs: [
          '11ka.cz je české fotbalové médium zaměřené na aktuální dění, český fotbal, fotografie ze zápasů a obsah pro fotbalové fanoušky.',
          'Spolupracujeme s kluby, firmami, značkami a dalšími projekty, kterým pomáháme dostat jejich jméno přímo k fotbalové komunitě.',
        ],
      },
      {
        heading: 'Instagram',
        paragraphs: [
          'Reklamní příspěvek',
          'Samostatný příspěvek věnovaný vaší značce, produktu nebo službě.',
          '600 Kč / příspěvek',
          'Instagram Stories',
          'Propagace prostřednictvím Instagram Stories.',
          '300 Kč / Stories',
          'Příspěvek + Stories',
          'Kombinace příspěvku a Stories pro větší dosah.',
          '800 Kč',
        ],
      },
      {
        heading: 'Instagramová soutěž',
        paragraphs: [
          'Chcete zvýšit povědomí o své značce a zároveň získat nové sledující?',
          'Připravíme a zveřejníme soutěž na Instagramu 11ka.cz, jejíž podmínky mohou zahrnovat například:',
          '• sledování profilu @vaše_značka',
          '• sledování profilu @11kacz',
          '• označení kamaráda v komentáři',
          '• sdílení soutěže do Stories',
          '• případně další podmínky podle dohody',
          'Součástí může být také grafika soutěže, zveřejnění, propagace ve Stories a vyhlášení vítěze.',
          'Cena soutěže: 1 000 Kč',
          'Cena nezahrnuje hodnotu výhry, kterou zajišťuje partner.',
        ],
      },
      {
        heading: 'Propagace přímo ze zápasu',
        paragraphs: [
          'Jsme také přítomni přímo na vybraných fotbalových utkáních, kde vytváříme fotografický obsah.',
          'Vaši značku můžeme propojit například s:',
          '• fotografiemi ze zápasu',
          '• Instagram Stories přímo ze stadionu',
          '• označením značky v příspěvku',
          '• prezentací produktu',
          '• partnerskou zmínkou v obsahu',
          'Cena od 700 Kč / zápas',
          'Konkrétní forma propagace závisí na možnostech konkrétního utkání.',
        ],
      },
      {
        heading: 'Reklama na webu',
        paragraphs: [
          'Chcete být vidět přímo na 11ka.cz?',
          'Nabízíme umístění reklamního banneru na webu.',
          '• 1 měsíc: 1 000 Kč',
          '• 3 měsíce: 2 500 Kč',
          '• 6 měsíců: 4 000 Kč',
          'Grafické podklady můžete dodat vlastní, nebo se můžeme domluvit na jejich vytvoření.',
        ],
      },
      {
        heading: 'Dlouhodobá spolupráce',
        paragraphs: [
          'Pokud hledáte pravidelnou propagaci, můžeme připravit individuální partnerský balíček.',
          'Balíček může obsahovat například: Instagram + Stories + soutěže + webová reklama + propagace ze zápasů.',
          'U dlouhodobé spolupráce nabízíme výhodnější cenu oproti jednotlivým službám.',
        ],
      },
      {
        heading: 'Ceny nejsou konečné',
        paragraphs: [
          'Jsme menší a rostoucí médium, proto se snažíme držet ceny dostupné i pro menší firmy, lokální podniky nebo fotbalové kluby.',
          'Pokud máte zájem o větší spolupráci, více reklamních výstupů nebo dlouhodobé partnerství, jsme schopni se na ceně individuálně domluvit a nabídnout slevu.',
          'Každou spolupráci řešíme individuálně podle rozsahu, délky a vašich možností.',
        ],
      },
      {
        heading: 'Máte zájem?',
        paragraphs: [
          'Napište nám a probereme možnosti spolupráce.',
          'jgalba@11ka.cz',
          'Stačí nám napsat, co potřebujete propagovat a jakou máte představu. Připravíme vám konkrétní nabídku.',
        ],
      },
      {
        heading: 'Podmínky spolupráce',
        paragraphs: [
          'S kým spolupracujeme?',
          'V 11ka.cz chceme budovat dlouhodobě důvěryhodné fotbalové médium. Proto si partnery vybíráme a nespolupracujeme automaticky s každým, kdo o reklamu požádá.',
          'Rádi spolupracujeme především s:',
          '• fotbalovými kluby a sportovními organizacemi',
          '• sportovními značkami a e-shopy',
          '• fotografy, grafiky a kreativci',
          '• lokálními firmami a podniky',
          '• sportovními areály a službami',
          '• pořadateli sportovních akcí',
          '• technologickými a mediálními projekty',
          '• značkami, které mají vztah ke sportu a fotbalu',
          '• dalšími projekty, které mohou být zajímavé pro naši komunitu',
          'Nejde nám pouze o jednorázovou reklamu. Preferujeme smysluplné a férové spolupráce, které dávají hodnotu oběma stranám.',
        ],
      },
      {
        heading: 'S kým se spojovat nechceme',
        paragraphs: [
          'Jsou oblasti, se kterými 11ka.cz spolupracovat nechce.',
          'Odmítáme spolupráce, které by mohly poškodit důvěryhodnost našeho média, našeho publika nebo partnerů.',
          'Spolupráci proto zpravidla nenavazujeme například s:',
          '• podvodnými nebo podezřelými projekty',
          '• projekty propagujícími nelegální činnost',
          '• falešnými soutěžemi nebo podvodnými nabídkami',
          '• projekty, jejichž hlavním účelem je klamání zákazníků',
          '• obsahem, který je v rozporu s našimi hodnotami',
          '• politickou propagací',
          '• nenávistným, diskriminačním nebo extremistickým obsahem',
          '• projekty, které by mohly poškodit jméno 11ka.cz',
          'Vyhrazujeme si také právo odmítnout spolupráci bez udání důvodu, pokud vyhodnotíme, že daný partner nebo jeho nabídka není vhodná pro naše médium.',
        ],
      },
      {
        heading: 'Naše zásady',
        paragraphs: [
          'Důvěryhodnost',
          'Nechceme propagovat něco, čemu sami nevěříme. Partnerství by mělo být transparentní a férové vůči našemu publiku.',
          'Férové jednání',
          'Očekáváme slušnou a profesionální komunikaci z obou stran. Stejný přístup nabízíme i našim partnerům.',
          'Kvalitní obsah',
          'Reklamní spolupráce se snažíme zapojit tak, aby nepůsobila rušivě a zároveň měla pro partnera co největší smysl.',
          'Respekt k médiu',
          'Partner respektuje naši redakční a obsahovou nezávislost. Placená spolupráce automaticky neznamená možnost ovlivňovat náš běžný redakční obsah.',
        ],
      },
      {
        heading: 'Schválení spolupráce',
        paragraphs: [
          'Každou nabídku posuzujeme individuálně.',
          'Před zahájením spolupráce si můžeme vyžádat:',
          '• informace o partnerovi',
          '• informace o propagovaném produktu nebo službě',
          '• podklady k reklamě',
          '• požadovaný termín zveřejnění',
          '• rozsah spolupráce',
          'Pokud zjistíme, že nabídka není vhodná pro 11ka.cz, můžeme ji bez náhrady odmítnout.',
        ],
      },
      {
        heading: 'Chcete spolupracovat?',
        paragraphs: [
          'Pokud máte projekt, značku nebo službu, která by mohla být zajímavá pro fotbalové fanoušky, ozvěte se nám.',
          'jgalba@11ka.cz',
          'Napište nám, kdo jste, co nabízíte a jakou spolupráci si představujete.',
          'Budujeme médium, se kterým chceme být dlouhodobě spokojeni my i naši čtenáři.',
        ],
      },
      {
        partner: {
          name: 'TJ Sokol Bříza',
          text: 'Jsme hrdým partnerem TJ Sokol Bříza',
          logo: '/images/partners/tj-sokol-briza.webp',
        },
      },
    ],
    newsletter: homeFallback.newsletter,
    newsletterStatus,
    adMap,
    ...seoForPage({
      title: 'Spolupráce - 11ka.cz',
      description: 'Nabídka spolupráce a reklamy na 11ka.cz - Instagram, web, soutěže a propagace ze zápasů.',
      path: '/spoluprace',
    }),
  });
});

router.get('/akreditace', (req, res) => {
  renderAkreditacePage(req, res);
});

router.post('/akreditace', akreditaceLimiter, async (req, res) => {
  const data = parseAkreditaceBody(req.body);
  if (!isValidAkreditacePayload(data)) {
    return renderAkreditacePage(req, res, {
      formStatus: 'invalid',
      formValues: data,
    });
  }

  let requestId = 0;
  try {
    requestId = accreditationService.create(data);
  } catch (e) {
    console.error('[11ka] Uložení žádosti o akreditaci:', e);
    return renderAkreditacePage(req, res, {
      formStatus: 'bad',
      formValues: data,
    });
  }

  const mailResult = await sendAccreditationRequest({
    email: data.email,
    phone: data.phone,
    name: data.name,
    match: data.match,
    matchDate: data.match_date,
    accreditationType: data.accreditation_type,
  });

  if (mailResult.ok) {
    accreditationService.markEmailSent(requestId);
  }

  res.redirect(302, '/akreditace?submitted=ok');
});

router.get('/redakce', (req, res) => {
  const adMap = adsService.getActiveMap();
  const staff = usersService
    .listPublicStaff()
    .filter((u) => String(u.email || '').trim().toLowerCase() !== 'danielsmrz25@gmail.com');
  const members = staff.map((u) => ({
    id: u.id,
    role: u.role,
    name: u.display_name || (u.role === 'sefredaktor' ? 'Šéfredaktor' : u.role === 'redaktor' ? 'Redaktor' : 'Redakce'),
    avatar: u.avatar_path || null,
  }));

  const sefredaktori = members.filter((m) => m.role === 'sefredaktor');
  const redaktori = members.filter((m) => m.role === 'redaktor');
  const vedeni = members.filter((m) => m.role === 'vedeni' || m.role === 'majitel');

  res.render('redakce', {
    title: 'Redakce - 11ka',
    activeNav: 'home',
    groups: [
      { title: 'Vedení', members: vedeni },
      { title: 'Šéfredaktor', members: sefredaktori },
      { title: 'Redaktoři', members: redaktori },
    ],
    adMap,
    ...seoForPage({
      title: 'Redakce - 11ka.cz',
      description: 'Seznam členů redakce 11ka.cz.',
      path: '/redakce',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Redakce',
          url: absoluteUrl('/redakce'),
        },
      ],
    }),
  });
});

router.get('/11ka-pomaha', (req, res) => {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
  const newsletterStatus =
    nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
  const events = pomahaEventsService.listPublishedForWeb();
  const rawEventsPage = parseInt(req.query.page, 10);
  const requestedEventsPage = Number.isFinite(rawEventsPage) && rawEventsPage > 0 ? rawEventsPage : 1;
  const eventsPerPage = 4;
  const eventsPagination = buildPagination({
    pathname: '/11ka-pomaha',
    query: req.query,
    page: requestedEventsPage,
    perPage: eventsPerPage,
    totalItems: events.length,
  });
  const eventsPageStart = (eventsPagination.page - 1) * eventsPerPage;
  const eventsPageItems = events.slice(eventsPageStart, eventsPageStart + eventsPerPage);
  const eventItems = eventsPageItems
    .filter((e) => e && e.title)
    .map((e) => {
      return {
        status: e.status ? String(e.status).trim() : null,
        title: String(e.title).trim(),
        date: e.event_date ? String(e.event_date).trim() : null,
        place: e.place ? String(e.place).trim() : null,
        note: e.note ? String(e.note).trim() : null,
        link: e.link_url ? String(e.link_url).trim() : null,
      };
    });

  const sections = [
    {
      heading: '11KA POMÁHÁ',
      paragraphs: [
        'Fotbal není jen o gólech, výsledcích a tabulkách. Je především o lidech, příbězích a vzájemné podpoře. Proto jsme vytvořili projekt 11KA POMÁHÁ.',
        'Chceme pomáhat jednotlivcům, týmům, organizacím i projektům spojeným s fotbalem, které si zaslouží větší pozornost a podporu. Zaměřujeme se především na osoby se zdravotním postižením, charitativní fotbalové akce, benefiční turnaje, mládežnické projekty a další smysluplné iniciativy z fotbalového prostředí.',
      ],
    },
    {
      heading: 'Jak můžeme pomoci?',
      paragraphs: [
        'Vybraným projektům nabízíme zdarma:',
        '• propagaci na webu 11KA.cz',
        '• článek o projektu nebo akci',
        '• propagaci na našich sociálních sítích',
        '• Instagram Stories přímo z akce nebo utkání',
        '• účast našeho fotografa a fotoreportáž',
        '• mediální podporu před akcí i po jejím skončení',
        'Naším cílem je dostat zajímavé a inspirativní příběhy k co největšímu počtu fanoušků a pomoci těm, kteří si to skutečně zaslouží.',
      ],
    },
    {
      heading: 'Co za to chceme?',
      paragraphs: [
        'Projekt 11KA POMÁHÁ je založen na vzájemné spolupráci. Nepožadujeme žádnou finanční odměnu.',
        'Budeme však rádi, pokud bude 11KA uvedena mezi partnery, mediálními partnery nebo sponzory akce. V případě utkání či turnajů uvítáme možnost prezentace našeho loga na propagačních materiálech, v online komunikaci nebo přímo v místě konání.',
      ],
    },
  ];

  sections.push({
    heading: 'Máte projekt, příběh nebo akci, která si zaslouží podporu?',
    paragraphs: [
      'Ozvěte se nám na charita@11ka.cz. Do zprávy nám stručně představte svůj projekt, akci nebo příběh a napište, jakou formu podpory byste uvítali.',
      'Každou žádost si pečlivě projdeme a vybereme projekty, kterým budeme moci pomoci nejvíce.',
      '11KA POMÁHÁ - společně ukazujeme, že fotbal má sílu měnit životy.',
    ],
  });

  sections.push({
    heading: 'Akce, které podporujeme',
    events: eventItems,
    pagination: eventsPagination.totalPages > 1 ? eventsPagination : null,
    emptyText: 'Zatím tu nejsou zveřejněné žádné akce.',
  });

  res.render('static', {
    title: '11ka Pomáhá - 11ka',
    activeNav: 'home',
    pageTitle: '11KA POMÁHÁ',
    sections,
    newsletter: homeFallback.newsletter,
    newsletterStatus,
    adMap,
    ...seoForPage({
      title: '11ka Pomáhá - 11ka.cz',
      description: 'Dobročinné aktivity a projekty, které redakce 11ka.cz podporuje.',
      path: '/11ka-pomaha',
    }),
  });
});

router.get('/uzivatele', (req, res) => {
  const adMap = adsService.getActiveMap();
  const profiles = usersService.listRecentPublic(24);
  res.render('uzivatele', {
    title: 'Uživatelé - 11ka',
    activeNav: 'home',
    profiles,
    adMap,
    ...seoForPage({
      title: 'Uživatelé - 11ka.cz',
      description: 'Veřejné profily čtenářů a redakce 11ka.cz.',
      path: '/uzivatele',
    }),
  });
});

router.get('/uzivatel/:slug', (req, res) => {
  const key = String(req.params.slug || '').trim();
  let user = usersService.getBySlug(key);
  if (!user && /^\d+$/.test(key)) {
    user = usersService.getById(parseInt(key, 10));
  }
  if (!user) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
  }
  const profile = usersService.hydratePublicProfile(user);
  const adMap = adsService.getActiveMap();
  const articleCount = articlesService.countPublishedByAuthor(user.id);
  res.render('uzivatel', {
    title: `${profile.display_name || 'Profil'} - 11ka`,
    activeNav: 'home',
    profile,
    articleCount,
    authorHref: profile.isStaff ? `/redaktor/${encodeURIComponent(String(user.id))}` : null,
    isOwnProfile: !!(req.user && req.user.id === user.id),
    adMap,
    ...seoForPage({
      title: `${profile.display_name || 'Profil'} - 11ka.cz`,
      description: profile.public_bio || `Veřejný profil uživatele ${profile.display_name || '11ka'}.`,
      path: usersService.profilePath(user),
      ogType: 'profile',
    }),
  });
});

router.get('/redaktor/:id', (req, res) => {
  const adMap = adsService.getActiveMap();
  const authorId = parsePositiveInt(req.params.id, null);
  if (!authorId) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
  }

  const author = usersService.getById(authorId);
  if (!author || !author.id) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
  }

  const page = parsePositiveInt(req.query.page, 1);
  const perPage = 3;
  const totalItems = articlesService.countPublishedByAuthor(authorId);
  const pagination = buildPagination({
    pathname: `/redaktor/${encodeURIComponent(String(authorId))}`,
    query: req.query,
    page,
    perPage,
    totalItems,
  });

  const offset = (pagination.page - 1) * perPage;
  const articles = articlesService.listPublishedByAuthorPaged(authorId, perPage, offset);
  res.render('author', {
    title: `${author.display_name || author.email} - články - 11ka`,
    activeNav: 'home',
    author: {
      id: author.id,
      name: author.display_name || author.email || 'Redakce',
      avatar: author.avatar_path || null,
      role: author.role || null,
      bio: usersService.getPublicAuthorBio(author),
      articleCount: totalItems,
    },
    articles,
    pagination,
    adMap,
    relativeTime,
    ...seoForPage({
      title: `${author.display_name || author.email} - články - 11ka.cz`,
      description: `Všechny články autora ${author.display_name || author.email}.`,
      path: `/redaktor/${encodeURIComponent(String(authorId))}`,
      ogType: 'website',
    }),
  });
});

router.get('/podminky-uziti', (req, res) => {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
    const newsletterStatus =
      nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
    res.render('static', {
      title: 'Podmínky užití - 11ka',
      activeNav: 'home',
      pageTitle: 'Podmínky užití webu 11ka.cz',
      sections: [
        {
          heading: 'Platné od',
          paragraphs: ['26. 3. 2026'],
        },
        {
          heading: '1. Úvodní ustanovení',
          paragraphs: [
            'Tyto podmínky užití upravují pravidla používání internetových stránek dostupných na adrese https://www.11ka.cz (dále jen „web“).',
            'Provozovatelem webu je:',
            'Aneta Kozelková',
            'E-mail: jgalba@11ka.cz',
            '(dále jen „provozovatel“)',
            'Používáním tohoto webu vyjadřuje uživatel souhlas s těmito podmínkami.',
          ],
        },
        {
          heading: '2. Charakter a účel webu',
          paragraphs: [
            'Web 11ka.cz je online sportovní médium zaměřené na fotbal, které poskytuje zejména:',
            '• zpravodajství',
            '• komentáře a analýzy',
            '• statistiky a další redakční obsah',
            'Obsah má informativní a publicistický charakter a nepředstavuje oficiální stanoviska sportovních organizací ani klubů.',
          ],
        },
        {
          heading: '3. Autorská práva',
          paragraphs: [
            'Veškerý obsah na webu (texty, fotografie, grafika, loga, videa a další materiály) je chráněn autorským právem.',
            'Bez předchozího písemného souhlasu provozovatele není dovoleno:',
            '• obsah kopírovat nebo šířit,',
            '• publikovat jej na jiných webech,',
            '• upravovat nebo jinak komerčně využívat.',
            'Citace obsahu je možná pouze s uvedením zdroje 11ka.cz a aktivním odkazem na původní článek.',
          ],
        },
        {
          heading: '4. Odpovědnost za obsah',
          paragraphs: [
            'Provozovatel se snaží poskytovat přesné a aktuální informace, avšak neručí za:',
            '• úplnost a aktuálnost zveřejněných informací,',
            '• případné škody vzniklé jejich použitím,',
            '• rozhodnutí uživatelů učiněná na základě obsahu webu.',
            'Používání informací z webu je na vlastní odpovědnost uživatele.',
          ],
        },
        {
          heading: '5. Externí odkazy',
          paragraphs: [
            'Web může obsahovat odkazy na externí internetové stránky.',
            'Provozovatel nenese odpovědnost za obsah těchto stránek ani za jejich dostupnost.',
          ],
        },
        {
          heading: '6. Diskuze a uživatelský obsah',
          paragraphs: [
            'Uživatelé nesmí do komentářů a diskuzí vkládat obsah, který:',
            '• je vulgární, urážlivý nebo diskriminační,',
            '• porušuje zákony České republiky,',
            '• porušuje práva třetích osob.',
            'Provozovatel si vyhrazuje právo takový obsah bez upozornění odstranit.',
          ],
        },
        {
          heading: '7. Dostupnost webu',
          paragraphs: [
            'Provozovatel nezaručuje nepřetržitou dostupnost webu.',
            'Může docházet k výpadkům z technických nebo provozních důvodů.',
          ],
        },
        {
          heading: '8. Ochrana osobních údajů',
          paragraphs: [
            'Zpracování osobních údajů se řídí samostatným dokumentem Zásady ochrany osobních údajů, který je dostupný na webu.',
          ],
        },
        {
          heading: '9. Změny podmínek',
          paragraphs: [
            'Provozovatel si vyhrazuje právo tyto podmínky kdykoli změnit.',
            'Aktuální verze je vždy zveřejněna na této stránce.',
          ],
        },
        {
          heading: '10. Rozhodné právo',
          paragraphs: [
            'Tyto podmínky se řídí právním řádem České republiky.',
            'Případné spory budou řešeny příslušnými soudy České republiky.',
          ],
        },
      ],
      newsletter: homeFallback.newsletter,
      newsletterStatus,
      adMap,
      ...seoForPage({
        title: 'Podmínky užití - 11ka.cz',
        description: 'Podmínky užití webu 11ka.cz.',
        path: '/podminky-uziti',
      }),
    });
});

router.get('/ochrana-osobnich-udaju', (req, res) => {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
    const newsletterStatus =
      nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
    res.render('static', {
      title: 'Zásady ochrany osobních údajů - 11ka',
      activeNav: 'home',
      pageTitle: 'Zásady ochrany osobních údajů - 11ka.cz',
      sections: [
        {
          heading: 'Platné od',
          paragraphs: [
            '26. 3. 2026',
          ],
        },
        {
          heading: '1. Správce osobních údajů',
          paragraphs: [
            'Správcem osobních údajů na webu https://www.11ka.cz je:',
            'Jiří Galba / 11ka.cz',
            'E-mail: jgalba@11ka.cz',
            '(dále jen „správce“)',
            'Správce zpracovává osobní údaje v souladu s:',
            '• Nařízením Evropského parlamentu a Rady (EU) 2016/679 (GDPR)',
            '• zákonem č. 110/2019 Sb., o zpracování osobních údajů',
          ],
        },
        {
          heading: '2. Jaké osobní údaje zpracováváme',
          paragraphs: [
            'Na webu 11ka.cz můžeme zpracovávat tyto údaje:',
            'a) Údaje získané automaticky při návštěvě webu',
            '• IP adresa',
            '• typ zařízení a prohlížeče',
            '• informace o chování na webu',
            'Tyto údaje jsou získávány pomocí cookies a analytických nástrojů.',
            'b) Údaje, které nám poskytnete dobrovolně',
            'Například:',
            '• jméno a e-mail při odeslání kontaktního formuláře',
            '• e-mail při přihlášení k newsletteru',
          ],
        },
        {
          heading: '3. Účely zpracování osobních údajů',
          paragraphs: [
            'Osobní údaje zpracováváme za účelem:',
            '• zajištění provozu a bezpečnosti webu',
            '• analýzy návštěvnosti a zlepšování obsahu',
            '• komunikace s uživateli',
            '• zasílání newsletteru (pokud existuje)',
          ],
        },
        {
          heading: '4. Právní základ zpracování',
          paragraphs: [
            'Osobní údaje zpracováváme na základě:',
            '• oprávněného zájmu - analýza návštěvnosti, zabezpečení webu',
            '• souhlasu uživatele - marketing, newsletter, nepovinné cookies',
            '• plnění právních povinností, pokud je to vyžadováno zákonem',
          ],
        },
        {
          heading: '5. Používané služby třetích stran',
          paragraphs: [
            'Provoz webu může zahrnovat služby třetích stran, které mohou zpracovávat osobní údaje:',
            'Analytika (například: Google Analytics)',
            'Reklama (pokud používáš):',
            '• Google Ads',
            '• Seznam Sklik',
            'Tyto služby mohou používat cookies a přenášet údaje mimo EU, zejména do USA, v souladu s právními mechanismy GDPR.',
          ],
        },
        {
          heading: '6. Cookies',
          paragraphs: [
            'Web používá soubory cookies pro:',
            '• správné fungování webu',
            '• analýzu návštěvnosti',
            '• případné marketingové účely',
            'Podrobnosti o cookies jsou uvedeny v samostatném dokumentu nebo cookie liště.',
            'Uživatel může cookies kdykoli odmítnout nebo vymazat ve svém prohlížeči.',
          ],
        },
        {
          heading: '7. Jak dlouho údaje uchováváme',
          paragraphs: [
            'Osobní údaje uchováváme pouze po dobu nezbytně nutnou:',
            '• analytická data: obvykle 14-26 měsíců',
            '• kontaktní komunikace: po dobu vyřízení a následně maximálně 3 roky',
            '• newsletter: do odhlášení uživatele',
          ],
        },
        {
          heading: '8. Kdo má k údajům přístup',
          paragraphs: [
            'K osobním údajům mohou mít přístup:',
            '• správce webu',
            '• poskytovatel hostingu',
            '• poskytovatel analytických a marketingových služeb',
            'Se všemi zpracovateli máme uzavřeny smlouvy o zpracování osobních údajů, pokud to vyžaduje GDPR.',
          ],
        },
        {
          heading: '9. Práva uživatelů',
          paragraphs: [
            'Podle GDPR máte právo:',
            '• požadovat přístup ke svým údajům',
            '• požadovat opravu nepřesných údajů',
            '• požadovat výmaz („právo být zapomenut“)',
            '• omezit zpracování',
            '• vznést námitku proti zpracování',
            '• podat stížnost u dozorového orgánu',
            'Dozorovým orgánem v České republice je:',
            'Úřad pro ochranu osobních údajů',
            'Pplk. Sochora 27, 170 00 Praha 7',
            'https://www.uoou.cz',
          ],
        },
        {
          heading: '10. Zabezpečení osobních údajů',
          paragraphs: [
            'Osobní údaje jsou chráněny technickými a organizačními opatřeními, která zabraňují:',
            '• neoprávněnému přístupu',
            '• ztrátě nebo zneužití',
            '• neoprávněnému zveřejnění',
          ],
        },
        {
          heading: '11. Změny těchto zásad',
          paragraphs: [
            'Tyto zásady můžeme čas od času aktualizovat.',
            'Aktuální verze je vždy zveřejněna na této stránce.',
          ],
        },
      ],
      newsletter: homeFallback.newsletter,
      newsletterStatus,
      adMap,
      ...seoForPage({
        title: 'Zásady ochrany osobních údajů - 11ka.cz',
        description: 'Informace o zpracování osobních údajů na 11ka.cz.',
        path: '/ochrana-osobnich-udaju',
      }),
    });
});

router.get('/cookies', (req, res) => {
  const adMap = adsService.getActiveMap();
  const nl = req.query.newsletter;
    const newsletterStatus =
      nl === 'ok' || nl === 'dupe' || nl === 'bad' ? nl : null;
    res.render('static', {
      title: 'Cookies - 11ka',
      activeNav: 'home',
      pageTitle: 'Zásady používání cookies - 11ka.cz',
      sections: [
        {
          heading: 'Platné od',
          paragraphs: [
            '26.3.2026',
          ],
        },
        {
          heading: '1. Co jsou cookies',
          paragraphs: [
            'Cookies jsou malé textové soubory, které se ukládají do vašeho zařízení při návštěvě webových stránek. Pomáhají zajistit správné fungování webu, analyzovat návštěvnost a případně zobrazovat relevantní reklamu.',
            'Tyto zásady vysvětlují, jak web https://www.11ka.cz cookies používá.',
          ],
        },
        {
          heading: '2. Kdo cookies spravuje',
          paragraphs: [
            'Správcem cookies je provozovatel webu:',
            'Aneta Kozelková',
            'E-mail: jgalba@11ka.cz',
          ],
        },
        {
          heading: '3. Jaké typy cookies používáme',
          paragraphs: [
            'a) Nezbytné cookies',
            'Tyto cookies jsou nutné pro správné fungování webu a nelze je vypnout.',
            'Používají se například pro:',
            '• zabezpečení webu',
            '• základní technické funkce',
            '• ukládání nastavení souhlasu s cookies',
            '',
            'b) Analytické cookies',
            'Pomáhají nám pochopit, jak návštěvníci web používají, a zlepšovat jeho obsah.',
            'Používané nástroje mohou zahrnovat:',
            '• Google Analytics',
            'Tyto cookies jsou používány pouze s vaším souhlasem.',
            '',
            'c) Marketingové cookies',
            'Používají se pro:',
            '• zobrazování personalizované reklamy',
            '• měření účinnosti reklamních kampaní',
            'Mohou být nastaveny například službami:',
            '• Google Ads',
            '• Seznam Sklik',
          ],
        },
        {
          heading: '4. Cookies třetích stran',
          paragraphs: [
            'Některé cookies jsou ukládány službami třetích stran, které na webu používáme (např. analytika nebo reklama). Tyto služby mohou kombinovat údaje z tohoto webu s dalšími informacemi, které o vás mají.',
          ],
        },
        {
          heading: '5. Jak můžete cookies spravovat',
          paragraphs: [
            'Při první návštěvě webu máte možnost:',
            '• cookies přijmout',
            '• odmítnout',
            'Souhlas můžete kdykoli změnit prostřednictvím:',
            '• nastavení cookies na tomto webu',
            '• nebo nastavení vašeho prohlížeče',
          ],
        },
        {
          heading: '6. Jak cookies odmítnout v prohlížeči',
          paragraphs: [
            'Cookies lze spravovat nebo mazat v nastavení prohlížeče:',
            '• Google Chrome',
            '• Mozilla Firefox',
            '• Safari',
            '• Microsoft Edge',
            'Omezení cookies může ovlivnit funkčnost některých částí webu.',
          ],
        },
        {
          heading: '7. Doba uložení cookies',
          paragraphs: [
            'Cookies mohou být:',
            '• relační - smažou se po zavření prohlížeče',
            '• trvalé - zůstávají uložené po určitou dobu nebo do jejich ručního smazání',
            'Doba uložení závisí na konkrétním typu cookies a použité službě.',
          ],
        },
        {
          heading: '8. Ochrana osobních údajů',
          paragraphs: [
            'Používání cookies může zahrnovat zpracování osobních údajů. Podrobnosti o tom, jak tyto údaje zpracováváme, naleznete v dokumentu: Zásady ochrany osobních údajů - 11ka.cz.',
          ],
        },
        {
          heading: '9. Změny těchto zásad',
          paragraphs: [
            'Tyto zásady můžeme kdykoli aktualizovat. Aktuální verze je vždy dostupná na této stránce.',
          ],
        },
      ],
      newsletter: homeFallback.newsletter,
      newsletterStatus,
      adMap,
      ...seoForPage({
        title: 'Zásady používání cookies - 11ka.cz',
        description: 'Informace o používání cookies na 11ka.cz.',
        path: '/cookies',
      }),
    });
});

router.get('/clanek', (req, res) => {
  const one = articlesService.listPublishedLatestSafe(1)[0];
  if (one) return res.redirect('/clanek/' + encodeURIComponent(one.slug));
  res.redirect('/');
});

router.get('/clanek/:slug', async (req, res) => {
  const article = articlesService.getBySlug(req.params.slug);
  if (!article || article.status !== 'published') {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
  }

  articlesService.incrementView(article.id, req);
  const author = usersService.getById(article.author_id);
  const adMap = adsService.getActiveMap();
  const resolved = resolveArticleSection(article);
  const section =
    resolved && resolved.href
      ? { label: resolved.label, href: resolved.href, nav: resolved.nav }
      : article.category && SECTION_META[article.category]
        ? SECTION_META[article.category]
        : resolved
          ? { label: resolved.label, href: resolved.href, nav: resolved.nav }
          : null;

  const sidebarMostRead = mostReadService.getMostReadCards({ layout: 'sidebar' });
  const articleRating = articleRatingsService.getSummary(article.id);
  const userRatingStars =
    req.user && req.user.id ? articleRatingsService.getUserStars(article.id, req.user.id) : null;
  const ratingLoginNext = `/clanek/${encodeURIComponent(article.slug)}#hodnoceni`;

  const tags = article.category ? [article.category] : ['11ka'];
  const relatedArticles = articlesService
    .listRelatedForArticle(article, 6)
    .map((a) => mapArticleCard(a));
  const mentionedTeams = articlesService.getMentionedTeams(article.id);
  let linkedMatch = null;
  const parsedMatch = articlesService.parseMatchKey(article.match_key);
  if (parsedMatch && parsedMatch.type === 'chance') {
    try {
      linkedMatch = chanceLigaLogos.withLogos(await livesportChance.getMatchDetail(parsedMatch.slug));
      if (linkedMatch && !linkedMatch.detailHref) linkedMatch.detailHref = parsedMatch.href;
    } catch {
      linkedMatch = null;
    }
  }
  const activeNav = section ? section.nav : 'home';
  const activeSubnav = resolved && resolved.subnav ? resolved.subnav : '';
  const breadcrumbSectionLabel = section ? section.label : article.category || 'Článek';
  const breadcrumbSectionHref = section ? section.href : null;
  const breadcrumbTitle = article.title;
  const baseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const articleUrl = `${baseUrl}/clanek/${encodeURIComponent(article.slug)}`;
  const shareUrls = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(articleUrl)}`,
    x: `https://x.com/intent/post?url=${encodeURIComponent(articleUrl)}&text=${encodeURIComponent(article.title)}`,
    article: articleUrl,
  };
  const articlePath = `/clanek/${encodeURIComponent(article.slug)}`;
  const articleCanonical = absoluteUrl(articlePath);
  const sectionPath = breadcrumbSectionHref || '/';
  const articleBlocks = parseBlocksInput(article.body_blocks_json);
  const renderedBlocksHtml = articleBlocks.length ? renderBlocksToHtml(articleBlocks) : '';
  const articleBodyHtml = renderedBlocksHtml || article.body_html || '';
  const lineup = prepareLineupForView(article.lineup_json);

  res.render('article', {
    title: `${article.title} - 11ka`,
    activeNav,
    activeSubnav,
    cmsArticle: true,
    breadcrumbs: [
      { label: 'Domů', href: '/' },
      { label: breadcrumbSectionLabel, href: breadcrumbSectionHref },
      { label: breadcrumbTitle, href: null },
    ],
    category: article.category || 'Článek',
    tag: article.tag || '',
    headline: article.title,
    lead: article.excerpt || '',
    articleSlug: article.slug,
    featuredImage: article.hero_image_path || 'https://images.unsplash.com/photo-1560272564-c83b66b1ad13?w=1200&q=80',
    heroPosition: article.hero_position || '50% 50%',
    heroCredit: article.hero_credit || '',
    body_html: articleBodyHtml,
    sources: article.sources || '',
    lineup,
    author: {
      id: author?.id || null,
      name: author?.display_name || author?.email || 'Redakce',
      avatar: author?.avatar_path || '/logo.png',
      useLogoAvatar: !author?.avatar_path,
      isoDate: article.published_at || article.created_at || '',
      date: formatCzDate(article.published_at || article.created_at),
      readTime: '',
    },
    sidebarMostRead,
    articleRating,
    userRatingStars,
    ratingLoginNext,
    ratingError:
      req.query.rate === 'bad'
        ? 'Hodnocení se nepodařilo uložit.'
        : req.query.rate === 'auth'
          ? 'Pro hodnocení se přihlaste.'
          : null,
    ratingSuccess: req.query.rate === 'ok',
    tags,
    relatedArticles,
    mentionedTeams,
    linkedMatch,
    shareUrls,
    audioDurationSec: articleTts.estimateDurationSec({
      title: article.title,
      excerpt: article.excerpt,
      body_html: articleBodyHtml,
    }),
    adMap,
    articleMidPromoAd: adsService.pickCreative('article_between_google_penalty'),
    penaltyGame: penaltyGameService.getPublicConfig(),
    penaltyLeaderboard: penaltyLeaderboardService.listTopGlobal(),
    ...seoForPage({
      title: `${article.title} - 11ka.cz`,
      description: article.excerpt || `Článek na 11ka.cz: ${article.title}`,
      path: articlePath,
      ogType: 'article',
      ogImage: absoluteImageUrl(article.hero_image_path),
      metaAuthor: author?.display_name || author?.email || 'Redakce 11ka.cz',
      metaKeywords: [article.category, article.tag, 'fotbal', '11ka']
        .filter(Boolean)
        .join(', '),
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Domů',
              item: absoluteUrl('/'),
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: breadcrumbSectionLabel,
              item: absoluteUrl(sectionPath),
            },
            {
              '@type': 'ListItem',
              position: 3,
              name: article.title,
              item: articleCanonical,
            },
          ],
        },
        {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          mainEntityOfPage: articleCanonical,
          headline: article.title,
          description: article.excerpt || '',
          image: [absoluteImageUrl(article.hero_image_path)],
          datePublished: article.published_at || article.created_at,
          dateModified: article.updated_at || article.published_at || article.created_at,
          author: {
            '@type': 'Person',
            name: author?.display_name || author?.email || 'Redakce',
          },
          publisher: {
            '@type': 'Organization',
            name: '11ka.cz',
            logo: {
              '@type': 'ImageObject',
              url: absoluteUrl('/logo.png'),
            },
          },
          ...(articleRating.count
            ? {
                aggregateRating: {
                  '@type': 'AggregateRating',
                  ratingValue: Number(articleRating.avg.toFixed(1)),
                  bestRating: 3,
                  worstRating: 1,
                  ratingCount: articleRating.count,
                },
              }
            : {}),
        },
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Související články',
          itemListElement: relatedArticles.map((item, idx) => ({
            '@type': 'ListItem',
            position: idx + 1,
            url: absoluteUrl(item.href),
            name: item.title,
          })),
        },
      ],
    }),
  });
});

const ratingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/clanek/:slug/hodnoceni', ratingLimiter, express.urlencoded({ extended: true }), (req, res) => {
  const article = articlesService.getBySlug(req.params.slug);
  if (!article || article.status !== 'published') {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
  }
  const articlePath = `/clanek/${encodeURIComponent(article.slug)}`;
  if (!req.user || !req.user.id) {
    const nextUrl = safeNextPath(`${articlePath}#hodnoceni`) || articlePath;
    return res.redirect(`/prihlaseni?next=${encodeURIComponent(nextUrl)}`);
  }
  try {
    articleRatingsService.rateArticle({
      articleId: article.id,
      userId: req.user.id,
      stars: req.body.stars,
    });
    return res.redirect(`${articlePath}?rate=ok#hodnoceni`);
  } catch {
    return res.redirect(`${articlePath}?rate=bad#hodnoceni`);
  }
});

router.post('/clanek/:slug/komentare', (_req, res) => {
  return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
});

module.exports = router;

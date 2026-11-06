const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const {
  requireLogin,
  requireRole,
  canEditArticle,
  canDeleteArticle,
  canPublish,
  canManageUsers,
  canCreateFotografUsers,
  isFotografManagedUser,
  canManageAds,
  canViewStats,
  ROLE_LABELS,
  STAFF_ROLES,
  hasAnyRole,
  hasRole,
  isStaffUser,
  isAkreditaceOnly,
  isFotografOnly,
  isRedaktorWorkflow,
  requireAiDraftAccess,
  canAccessAiDrafts,
} = require('../middleware/auth');
const { rolesFromBody } = require('../lib/roles');
const { asStringArray, asIntArray } = require('../lib/safe-path');
const chanceLigaLogos = require('../services/chance-liga-logos');
const livesportChance = require('../services/livesport-chance');
const graficiPng = require('../services/grafici-png');
const { listRubrics, isRubricSlug } = require('../config/rubrics');
const rubricsService = require('../services/rubrics');
const aiArticleDraft = require('../services/ai-article-draft');
const aiQueue = require('../services/ai-queue');
const aiIngest = require('../services/ai-ingest');

const requireAkreditaceAccess = requireRole('vedeni', 'spravce_akreditace');
const usersService = require('../services/users');
const { optimizeUploadImage } = require('../lib/optimize-upload-image');
const articlesService = require('../services/articles');
const kitswapsService = require('../services/kitswaps');
const pomahaEventsService = require('../services/pomaha-events');
const matchFixturesService = require('../services/match-fixtures');
const matchTeamsService = require('../services/match-teams');
const adsService = require('../services/ads');
const accreditationService = require('../services/accreditation');
const penaltyGameService = require('../services/penalty-game');
const penaltyPlayersService = require('../services/penalty-players');
const penaltyLeaderboardService = require('../services/penalty-leaderboard');
const { sendAccreditationRequest } = require('../services/mail');
const { parseBlocksInput, renderBlocksToHtml } = require('../lib/article-blocks');
const { parsePragueDatetimeLocal, formatPragueDatetimeLocal, formatPragueDateTime } = require('../lib/prague-datetime');
const { validateLineupForSave, serializeLineup } = require('../lib/lineup');
const { mergeAdminTagOptions } = require('../config/main-nav');
const foto = require('../services/foto');

function adminTagOptions() {
  return mergeAdminTagOptions(articlesService.listDistinctTags(200));
}

function resolveHeroPosition(value, fallback) {
  return (
    articlesService.normalizeHeroPosition(value) ||
    articlesService.normalizeHeroPosition(fallback) ||
    '50% 50%'
  );
}

function resolveHeroPositionChain(value, ...fallbacks) {
  return articlesService.resolveStoredHeroPosition(value, ...fallbacks);
}

function resolveLineupJson(raw, options = {}) {
  const result = validateLineupForSave(raw, { requireEnabled: false, ...options });
  if (!result.ok) return result;
  return { ok: true, lineupJson: result.lineup ? serializeLineup(result.lineup) : null };
}


const router = express.Router();

const CATEGORY_OPTIONS = [
  'Český Fotbal',
  'Ženský Fotbal',
  'Světový Fotbal',
  'Zápasy',
  'Rozhovory',
  'Analýzy',
];

function adminNavFromPath(p) {
  if (p === '/administrace' || p === '/administrace/') return 'dashboard';
  if (p.startsWith('/administrace/clanek')) return 'editor';
  if (p === '/administrace/clanky') return 'clanky';
  if (p === '/administrace/moje-clanky') return 'moje';
  if (p === '/administrace/zadosti') return 'zadosti';
  if (p.startsWith('/administrace/akreditace')) return 'akreditace';
  if (p.startsWith('/administrace/ai-clanky') || p.startsWith('/administrace/ai-navrhy')) return 'ai-clanky';
  if (p === '/administrace/uzivatele') return 'uzivatele';
  if (p === '/administrace/bio') return 'bio';
  if (p === '/administrace/pomaha') return 'pomaha';
  if (p === '/administrace/reklamy') return 'reklamy';
  if (p === '/administrace/penalty') return 'penalty';
  if (p.startsWith('/administrace/rubriky')) return 'rubriky';
  if (p === '/administrace/kitswapy') return 'kitswapy';
  if (p.startsWith('/administrace/zapasy')) return 'zapasy';
  if (p === '/administrace/statistiky') return 'statistiky';
  if (p.startsWith('/administrace/grafici')) return 'grafici';
  return 'dashboard';
}

function multerUserMessage(err) {
  if (!(err instanceof multer.MulterError)) return err.message;
  if (err.code === 'LIMIT_FILE_SIZE') return 'Soubor je příliš velký (max. 1 GB).';
  if (err.code === 'LIMIT_FIELD_VALUE') return 'Text článku nebo pole formuláře je příliš dlouhé (max. 1 GB v jednom poli).';
  return err.message;
}

function normalizeExcerpt(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  if (!t) return null;
  return t;
}

async function optimizeUploadedFile(req, res, next) {
  if (!req.file?.path) return next();
  try {
    await optimizeUploadImage(req.file.path);
  } catch (err) {
    console.error('[11ka] upload optimize failed:', err && err.message);
  }
  next();
}

const publicUpload = path.join(__dirname, '..', 'public', 'uploads');
const HERO_PICK_RE = /^\/uploads\/articles\/[a-zA-Z0-9]+\.(jpe?g|png|webp|gif)$/i;

function isSafeHeroPickPath(value) {
  return HERO_PICK_RE.test(String(value || '').trim());
}

function unlinkPublicUpload(relPath) {
  if (!relPath || !String(relPath).startsWith('/uploads/')) return;
  const oldAbs = path.join(__dirname, '..', 'public', String(relPath).replace(/^\//, ''));
  try {
    if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
  } catch {
    /* ignore */
  }
}
/** Max. velikost nahraného obrázku (titulek / TinyMCE) a textových polí v multipart (body HTML). */
const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const multipartArticleLimits = { fileSize: UPLOAD_MAX_BYTES, fieldSize: UPLOAD_MAX_BYTES };
function ensureUploadDirs() {
  for (const sub of ['articles', 'avatars', 'inline', 'penalty/keepers', 'teams', 'ads']) {
    const d = path.join(publicUpload, sub);
    try {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    } catch (err) {
      console.warn('[11ka] cannot create upload dir', d, err && err.message);
    }
  }
}

const PENALTY_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

const penaltyImageFilter = (req, file, cb) => {
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
  if (/^image\/(heic|heif)$/.test(file.mimetype)) {
    return cb(new Error('Formát HEIC/HEIF bohužel nepodporujeme. Nahrajte prosím JPG, PNG, WebP nebo GIF.'));
  }
  return cb(new Error('Povolené jsou jen obrázky JPG/JPEG, PNG, WebP nebo GIF.'));
};

const penaltyStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDirs();
    cb(null, path.join(publicUpload, 'penalty/keepers'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const uploadPenaltyImages = multer({
  storage: penaltyStorage,
  limits: { fileSize: PENALTY_UPLOAD_MAX_BYTES },
  fileFilter: penaltyImageFilter,
});

function penaltyUploadPath(file, subfolder) {
  if (!file) return null;
  return `/uploads/penalty/${subfolder}/${file.filename}`;
}

function removePenaltyUpload(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/penalty/')) return;
  const abs = path.join(__dirname, '..', 'public', filePath);
  if (fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* best-effort */
    }
  }
}

function resolveKeeperThumbPath(files, existing) {
  const uploaded = files?.thumb_file?.[0];
  if (uploaded) return penaltyUploadPath(uploaded, 'keepers');
  return existing || null;
}

const TEAM_LOGO_MAX_BYTES = 4 * 1024 * 1024;

const teamLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDirs();
    cb(null, path.join(publicUpload, 'teams'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const uploadTeamLogo = multer({
  storage: teamLogoStorage,
  limits: { fileSize: TEAM_LOGO_MAX_BYTES },
  fileFilter: penaltyImageFilter,
});

function resolveTeamLogoPath(file, existing) {
  if (file) return `/uploads/teams/${file.filename}`;
  return existing || null;
}

function removeTeamLogo(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/teams/')) return;
  const abs = path.join(__dirname, '..', 'public', filePath);
  if (fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* best-effort */
    }
  }
}

function teamLogoUploadErrorMessage(err) {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return 'Logo je příliš velké (max. 4 MB).';
  }
  if (err instanceof multer.MulterError) return multerUserMessage(err);
  return err && err.message ? err.message : 'Nahrání loga se nezdařilo.';
}

const AD_CREATIVE_MAX_BYTES = 8 * 1024 * 1024;
const adCreativeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDirs();
    cb(null, path.join(publicUpload, 'ads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});
const uploadAdCreative = multer({
  storage: adCreativeStorage,
  limits: { fileSize: AD_CREATIVE_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Povolené formáty: JPG, PNG, WebP, GIF.'));
  },
});

function removeAdCreativeUpload(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/ads/')) return;
  const abs = path.join(__dirname, '..', 'public', filePath);
  if (fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* best-effort */
    }
  }
}

function isKnownCreativeSlot(slot) {
  return adsService.CREATIVE_SLOTS.some((s) => s.slot === slot);
}

function renderReklamyAdmin(req, res, extras = {}) {
  res.render('admin/reklamy', {
    title: 'Reklamy - administrace',
    slots: adsService.listCreativeSlotsWithItems(),
    error: extras.error || null,
    success: extras.success || null,
  });
}

function renderTeamFormError(req, res, view, opts = {}) {
  const draft = {
    name: req.body && req.body.name,
    short_name: req.body && req.body.short_name,
    competition: req.body && req.body.competition,
    logo_path: opts.keepLogo || null,
    roster: matchTeamsService.normalizeRoster(req.body && req.body.roster_json),
  };
  return res.render(view, {
    title: opts.title,
    zapasySection: opts.zapasySection,
    editingTeam: opts.editingTeam || null,
    formDraft: draft,
    pagination: opts.pagination || { page: 1 },
    error: opts.error,
    success: null,
  });
}

function teamPostParser(req, res, next) {
  if (!(req.headers['content-type'] || '').includes('multipart/form-data')) return next();
  return uploadTeamLogo.single('logo_file')(req, res, (err) => {
    if (!err) return next();
    const message = teamLogoUploadErrorMessage(err);
    if (req.path.endsWith('/vytvorit-tym')) {
      return renderTeamFormError(req, res, 'admin/zapasy-vytvorit-tym', {
        title: 'Vytvořit tým - administrace',
        zapasySection: 'create-team',
        error: message,
      });
    }
    const id = parseInt(req.body && req.body.id, 10);
    return renderZapasyTeams(req, res, {
      error: message,
      editTeamId: Number.isFinite(id) ? id : null,
    });
  });
}

function penaltyUploadErrorMessage(err) {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return 'Obrázek je příliš velký (max. 8 MB).';
  }
  if (err instanceof multer.MulterError) return multerUserMessage(err);
  return err && err.message ? err.message : 'Nahrání souboru se nezdařilo.';
}

function penaltyPostParser(req, res, next) {
  if ((req.headers['content-type'] || '').includes('multipart/form-data')) {
    return uploadPenaltyImages.fields([{ name: 'thumb_file', maxCount: 1 }])(req, res, (err) => {
      if (err) {
        const editId = parseInt(req.body && req.body.id, 10);
        return renderPenaltyAdmin(req, res, {
          error: penaltyUploadErrorMessage(err),
          editId: Number.isFinite(editId) ? editId : null,
        });
      }
      next();
    });
  }
  return express.urlencoded({ extended: true })(req, res, next);
}

const heroStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDirs();
    cb(null, path.join(publicUpload, 'articles'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const uploadHero = multer({
  storage: heroStorage,
  limits: multipartArticleLimits,
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Titulní obrázek musí být JPEG, PNG, WebP nebo GIF.'));
  },
});

const inlineStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDirs();
    cb(null, path.join(publicUpload, 'inline'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});

const uploadInline = multer({
  storage: inlineStorage,
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Jen obrázky'));
  },
});

router.use(requireLogin);
router.use((req, res, next) => {
  if (!isStaffUser(req.user)) {
    return res.redirect('/ucet');
  }
  res.locals.adminNav = adminNavFromPath(req.path);
  next();
});

router.get('/administrace/foto', (req, res) => res.redirect('/foto'));

router.get('/administrace', (req, res) => {
  if (req.user && isAkreditaceOnly(req.user)) {
    return res.redirect('/administrace/akreditace');
  }
  if (req.user && isFotografOnly(req.user)) {
    return res.redirect('/foto');
  }
  res.render('admin/dashboard', {
    title: 'Administrace - 11ka',
    role: req.user.role,
    roles: req.user.roles || [],
  });
});

/* --- Bio autorů (Vedení) --- */
function renderBioAdmin(res, { error, success } = {}) {
  const items = usersService.listAuthorBiosForAdmin();
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  res.render('admin/bio', {
    title: 'Bio - administrace',
    items,
    pendingCount,
    authorBioMax: usersService.AUTHOR_BIO_MAX,
    error: error || null,
    success: success || null,
  });
}

router.get('/administrace/bio', requireRole('vedeni'), (req, res) => {
  renderBioAdmin(res);
});

router.get('/administrace/bia', requireRole('vedeni'), (req, res) => {
  res.redirect(301, '/administrace/bio');
});

/* --- 11ka Pomáhá (Vedení) --- */
function buildAdminPagination(basePath, page, perPage, totalItems, query = {}, pageParam = 'page') {
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const hasPrev = safePage > 1;
  const hasNext = safePage < totalPages;
  const pageUrl = (p) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value != null && value !== '') params.set(key, String(value));
    });
    if (p > 1) params.set(pageParam, String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    pages.push({
      n: p,
      current: p === safePage,
      url: pageUrl(p),
    });
  }
  return {
    page: safePage,
    perPage,
    totalItems: totalItems || 0,
    totalPages,
    hasPrev,
    hasNext,
    prevUrl: hasPrev ? pageUrl(safePage - 1) : null,
    nextUrl: hasNext ? pageUrl(safePage + 1) : null,
    pages,
  };
}

function renderPomahaAdmin(req, res, { error, success, editId } = {}) {
  const allItems = pomahaEventsService.listAllForAdmin();
  const rawPage = parseInt((req.query && req.query.page) || (req.body && req.body.page), 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pagination = buildAdminPagination('/administrace/pomaha', requestedPage, 4, allItems.length);
  const offset = (pagination.page - 1) * pagination.perPage;
  const items = allItems.slice(offset, offset + pagination.perPage);
  const editingItem = editId ? items.find((i) => i.id === editId) : null;
  const editingFallback = !editingItem && editId ? allItems.find((i) => i.id === editId) : null;
  const pomahaAd = adsService.getBySlot('home_pomaha_11ka') || {
    slot: 'home_pomaha_11ka',
    label: '11ka Pomáhá - reklamní prostor',
    content_html: '',
    link_url: '',
    active: 0,
  };
  res.render('admin/pomaha', {
    title: '11ka Pomáhá - administrace',
    items,
    pagination,
    statusOptions: pomahaEventsService.STATUS_OPTIONS,
    editingItem: editingItem || editingFallback || null,
    pomahaAd,
    error: error || null,
    success: success || null,
  });
}

router.get('/administrace/pomaha', requireRole('vedeni'), (req, res) => {
  const editId = parseInt(req.query.edit, 10);
  renderPomahaAdmin(req, res, { editId: Number.isFinite(editId) ? editId : null });
});

router.post(
  '/administrace/pomaha',
  requireRole('vedeni'),
  express.urlencoded({ extended: true }),
  (req, res) => {
    const action = req.body.action;
    const id = parseInt(req.body.id, 10);
    try {
      if (action === 'update_pomaha_ad') {
        adsService.updateSlot('home_pomaha_11ka', {
          label: '11ka Pomáhá - reklamní prostor',
          content_html: req.body.content_html || null,
          link_url: null,
          active: req.body.active === '1' || req.body.active === 'on',
          image_path: null,
        });
        return renderPomahaAdmin(req, res, { success: 'Reklamní prostor byl uložen.' });
      }
      if (action === 'create') {
        pomahaEventsService.create(req.body);
        return renderPomahaAdmin(req, res, { success: 'Akce byla přidána.' });
      }
      if (!Number.isFinite(id)) {
        return renderPomahaAdmin(req, res, { error: 'Neplatná akce.' });
      }
      if (action === 'update') {
        pomahaEventsService.update(id, req.body);
        return renderPomahaAdmin(req, res, { success: 'Akce byla upravena.' });
      }
      if (action === 'move_up') {
        pomahaEventsService.move(id, -1);
        return renderPomahaAdmin(req, res, { success: 'Pořadí upraveno.' });
      }
      if (action === 'move_down') {
        pomahaEventsService.move(id, 1);
        return renderPomahaAdmin(req, res, { success: 'Pořadí upraveno.' });
      }
      if (action === 'delete') {
        pomahaEventsService.remove(id);
        return renderPomahaAdmin(req, res, { success: 'Akce byla odebrána.' });
      }
      return renderPomahaAdmin(req, res, { error: 'Neznámá akce.' });
    } catch (e) {
      return renderPomahaAdmin(req, res, {
        error: e && e.message ? e.message : 'Uložení se nezdařilo.',
        editId: Number.isFinite(id) ? id : null,
      });
    }
  }
);

const PENALTY_ADMIN_LIST_PER_PAGE = 7;

function articleEditSchedVal(article, form) {
  if (form && form.scheduled_at) return String(form.scheduled_at);
  if (article && article.scheduled_at) return formatPragueDatetimeLocal(article.scheduled_at);
  return '';
}

function articleAction(body) {
  return String((body && body.action) || '').trim();
}

function resolveScheduleIso(dt) {
  const iso = parsePragueDatetimeLocal(dt);
  if (!iso) {
    return { ok: false, error: 'Neplatné datum a čas plánované publikace.' };
  }
  const minFutureMs = Date.now() + 60 * 1000;
  if (new Date(iso).getTime() < minFutureMs) {
    return {
      ok: false,
      error: 'Čas publikace musí být alespoň 1 minutu v budoucnosti (časová zóna Praha).',
    };
  }
  return { ok: true, iso };
}

function communityFieldsFromBody(body) {
  const mentionedTeamCodes = asStringArray(body && body.mentioned_teams);
  const relatedArticleIds = asIntArray(body && body.related_ids);
  const isRubric = body && (body.is_rubric === '1' || body.is_rubric === 'on');
  const rubricSlug = isRubric && isRubricSlug(body.rubric_slug) ? String(body.rubric_slug).trim() : null;
  const matchKey = articlesService.normalizeMatchKey(body && body.match_key);
  return { mentionedTeamCodes, relatedArticleIds, rubricSlug, matchKey };
}

function selectedTeamCodesFrom(locals) {
  if (locals.form && Object.prototype.hasOwnProperty.call(locals.form, 'mentioned_teams')) {
    return asStringArray(locals.form.mentioned_teams);
  }
  if (locals.article && locals.article.id) {
    return articlesService.listArticleTeamCodes(locals.article.id);
  }
  return [];
}

function selectedRelatedIdsFrom(locals) {
  if (locals.form && Object.prototype.hasOwnProperty.call(locals.form, 'related_ids')) {
    return asIntArray(locals.form.related_ids);
  }
  if (locals.article) {
    return articlesService.parseRelatedIds(locals.article.related_article_ids);
  }
  return [];
}

function selectedMatchKeyFrom(locals) {
  if (locals.form && Object.prototype.hasOwnProperty.call(locals.form, 'match_key')) {
    return articlesService.normalizeMatchKey(locals.form.match_key) || '';
  }
  if (locals.article) {
    return articlesService.normalizeMatchKey(locals.article.match_key) || '';
  }
  return '';
}

async function loadMatchPicker(selectedKey) {
  let matches = [];
  try {
    matches = await livesportChance.listPickerMatches(80);
  } catch {
    matches = [];
  }
  const selected = articlesService.normalizeMatchKey(selectedKey);
  if (selected && !matches.some((m) => m.matchKey === selected)) {
    const parsed = articlesService.parseMatchKey(selected);
    matches.unshift({
      matchKey: selected,
      home: parsed ? parsed.slug : selected,
      away: '',
      homeLabel: parsed ? parsed.slug : selected,
      awayLabel: '',
      date: '',
    });
  }
  return matches;
}

async function renderArticleEdit(res, locals, statusCode) {
  const selectedRelatedIds = selectedRelatedIdsFrom(locals);
  const selectedMatchKey = selectedMatchKeyFrom(locals);
  const matchPickerMatches = await loadMatchPicker(selectedMatchKey);
  const payload = {
    ...locals,
    authors: locals.authors != null ? locals.authors : listArticleAuthors(),
    scheduledAtLocal: articleEditSchedVal(locals.article, locals.form),
    scheduledAtMin: formatPragueDatetimeLocal(new Date().toISOString()),
    chanceLigaClubs: chanceLigaLogos.listClubs(),
    rubrics: listRubrics(),
    selectedTeamCodes: selectedTeamCodesFrom(locals),
    selectedRelatedIds,
    selectedMatchKey,
    matchPickerMatches,
    relatedPickerArticles: articlesService.listForRelatedPicker(
      locals.article && locals.article.id,
      selectedRelatedIds,
      40
    ),
    titleMax: articlesService.TITLE_MAX,
    excerptMax: articlesService.EXCERPT_MAX,
  };
  if (statusCode) return res.status(statusCode).render('admin/article-edit', payload);
  return res.render('admin/article-edit', payload);
}

function listArticleAuthors() {
  return usersService
    .listAll()
    .filter((u) => hasAnyRole(u, 'majitel', 'vedeni', 'sefredaktor', 'redaktor'))
    .map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
    }));
}

function resolveVedeniAuthorId(req, fallbackId) {
  if (!hasRole(req.user, 'vedeni')) return fallbackId;
  const parsed = parseInt(req.body && req.body.author_id, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackId;
  const ok = listArticleAuthors().some((a) => a.id === parsed);
  return ok ? parsed : fallbackId;
}

function renderPenaltyAdmin(req, res, { error, success, editId } = {}) {
  const allKeepers = penaltyGameService.listKeepersForAdmin();
  const rawPage = parseInt((req.query && req.query.page) || (req.body && req.body.page), 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawPlayersPage = parseInt(
    (req.query && req.query.players_page) || (req.body && req.body.players_page),
    10
  );
  const requestedPlayersPage = Number.isFinite(rawPlayersPage) && rawPlayersPage > 0 ? rawPlayersPage : 1;
  const rawLeaderboardPage = parseInt(
    (req.query && req.query.leaderboard_page) || (req.body && req.body.leaderboard_page),
    10
  );
  const requestedLeaderboardPage =
    Number.isFinite(rawLeaderboardPage) && rawLeaderboardPage > 0 ? rawLeaderboardPage : 1;
  const playersSearch =
    (req.query && req.query.players_q != null ? String(req.query.players_q).trim() : '') ||
    (req.body && req.body.players_q != null ? String(req.body.players_q).trim() : '');
  const keeperQuery = {};
  if (requestedPlayersPage > 1) keeperQuery.players_page = requestedPlayersPage;
  if (requestedLeaderboardPage > 1) keeperQuery.leaderboard_page = requestedLeaderboardPage;
  if (playersSearch) keeperQuery.players_q = playersSearch;
  const pagination = buildAdminPagination(
    '/administrace/penalty',
    requestedPage,
    5,
    allKeepers.length,
    keeperQuery
  );
  const offset = (pagination.page - 1) * pagination.perPage;
  const keepers = allKeepers.slice(offset, offset + pagination.perPage);
  const playersQuery = {};
  if (requestedPage > 1) playersQuery.page = requestedPage;
  if (requestedLeaderboardPage > 1) playersQuery.leaderboard_page = requestedLeaderboardPage;
  if (playersSearch) playersQuery.players_q = playersSearch;
  const playersPagination = buildAdminPagination(
    '/administrace/penalty',
    requestedPlayersPage,
    PENALTY_ADMIN_LIST_PER_PAGE,
    penaltyPlayersService.countPlayersForAdmin(playersSearch),
    playersQuery,
    'players_page'
  );
  const playersOffset = (playersPagination.page - 1) * playersPagination.perPage;
  const players = penaltyPlayersService.listPlayersForAdmin({
    limit: playersPagination.perPage,
    offset: playersOffset,
    search: playersSearch,
  });
  const totalLeaderboard = penaltyLeaderboardService.countForAdmin();
  const leaderboardQuery = {};
  if (requestedPage > 1) leaderboardQuery.page = requestedPage;
  if (requestedPlayersPage > 1) leaderboardQuery.players_page = requestedPlayersPage;
  if (playersSearch) leaderboardQuery.players_q = playersSearch;
  const leaderboardPagination = buildAdminPagination(
    '/administrace/penalty',
    requestedLeaderboardPage,
    PENALTY_ADMIN_LIST_PER_PAGE,
    totalLeaderboard,
    leaderboardQuery,
    'leaderboard_page'
  );
  const leaderboardOffset = (leaderboardPagination.page - 1) * leaderboardPagination.perPage;
  const leaderboard = penaltyLeaderboardService.listForAdmin({
    limit: leaderboardPagination.perPage,
    offset: leaderboardOffset,
  });
  const editIdNum = Number.isFinite(editId) ? editId : parseInt(editId, 10);
  const editingKeeper =
    Number.isFinite(editIdNum) && editIdNum > 0
      ? allKeepers.find((k) => k.id === editIdNum) || null
      : null;
  res.render('admin/penalty', {
    title: 'Penalty - administrace',
    error: error || null,
    success: success || null,
    penaltySettings: penaltyGameService.getSettings(),
    keepers,
    pagination,
    editingKeeper,
    players,
    playersPagination,
    playersSearch,
    leaderboard,
    leaderboardPagination,
    formatPragueDateTime,
  });
}

router.get('/administrace/penalty', requireRole('vedeni', 'sefredaktor'), (req, res) => {
  const editId = parseInt(req.query.edit, 10);
  renderPenaltyAdmin(req, res, { editId: Number.isFinite(editId) ? editId : null });
});

router.post(
  '/administrace/penalty',
  requireRole('vedeni', 'sefredaktor'),
  penaltyPostParser,
  (req, res) => {
    const action = req.body.action;
    const id = parseInt(req.body.id, 10);
    try {
      if (action === 'create_keeper') {
        penaltyGameService.createKeeper({
          name: req.body.name,
          experience_stars: req.body.experience_stars,
          points_per_goal: req.body.points_per_goal,
          thumb_path: resolveKeeperThumbPath(req.files, null),
          thumb_position: req.body.thumb_position,
          thumb_scale: req.body.thumb_scale,
          thumb_mobile_position: req.body.thumb_mobile_position,
          thumb_mobile_scale: req.body.thumb_mobile_scale,
          face_top_pct: req.body.face_top_pct,
          face_left_pct: req.body.face_left_pct,
          face_size_pct: req.body.face_size_pct,
          team_name: req.body.team_name,
        });
        return renderPenaltyAdmin(req, res, { success: 'Brankář byl přidán.' });
      }
      if (action === 'delete_leaderboard_entry') {
        const playerId = parseInt(req.body.player_id, 10);
        penaltyLeaderboardService.removePlayer(playerId);
        return renderPenaltyAdmin(req, res, { success: 'Hráč byl odebrán ze žebříčku.' });
      }
      if (action === 'reset_leaderboard_all') {
        penaltyLeaderboardService.resetAllPoints();
        return renderPenaltyAdmin(req, res, { success: 'Celý žebříček byl vynulován.' });
      }
      if (!Number.isFinite(id) || id < 1) {
        return renderPenaltyAdmin(req, res, { error: 'Neplatná položka.' });
      }
      if (action === 'update_keeper') {
        const existing = penaltyGameService.getKeeperById(id);
        if (!existing) {
          return renderPenaltyAdmin(req, res, { error: 'Brankář nebyl nalezen.' });
        }
        const thumbPath = resolveKeeperThumbPath(req.files, existing.thumb_path);
        if (req.files?.thumb_file?.[0] && existing.thumb_path?.startsWith('/uploads/penalty/')) {
          removePenaltyUpload(existing.thumb_path);
        }
        penaltyGameService.updateKeeper(id, {
          name: req.body.name,
          experience_stars: req.body.experience_stars,
          points_per_goal: req.body.points_per_goal,
          thumb_path: thumbPath,
          thumb_position: req.body.thumb_position,
          thumb_scale: req.body.thumb_scale,
          thumb_mobile_position: req.body.thumb_mobile_position,
          thumb_mobile_scale: req.body.thumb_mobile_scale,
          face_top_pct: req.body.face_top_pct,
          face_left_pct: req.body.face_left_pct,
          face_size_pct: req.body.face_size_pct,
          team_name: req.body.team_name,
        });
        return renderPenaltyAdmin(req, res, { success: 'Brankář byl upraven.', editId: id });
      }
      if (action === 'move_up') {
        penaltyGameService.moveKeeper(id, -1);
        return renderPenaltyAdmin(req, res, { success: 'Pořadí upraveno.' });
      }
      if (action === 'move_down') {
        penaltyGameService.moveKeeper(id, 1);
        return renderPenaltyAdmin(req, res, { success: 'Pořadí upraveno.' });
      }
      if (action === 'delete_keeper') {
        const existing = penaltyGameService.getKeeperById(id);
        penaltyGameService.removeKeeper(id);
        if (existing) {
          removePenaltyUpload(existing.thumb_path);
        }
        return renderPenaltyAdmin(req, res, { success: 'Brankář byl odebrán.' });
      }
      if (action === 'delete_player') {
        penaltyPlayersService.removePlayer(id);
        return renderPenaltyAdmin(req, res, { success: 'Záznam hráče byl odebrán.' });
      }
      return renderPenaltyAdmin(req, res, { error: 'Neznámá akce.' });
    } catch (e) {
      return renderPenaltyAdmin(req, res, {
        error: e && e.message ? e.message : 'Uložení se nezdařilo.',
        editId: Number.isFinite(id) ? id : null,
      });
    }
  }
);

router.post(
  '/administrace/bio',
  requireRole('vedeni'),
  express.urlencoded({ extended: true }),
  (req, res) => {
    const uid = parseInt(req.body.id, 10);
    const action = req.body.action;
    let error = null;
    let success = null;

    if (!uid) {
      error = 'Neplatný uživatel.';
    } else if (action === 'approve') {
      const row = usersService.getById(uid);
      const text =
        req.body.author_bio && String(req.body.author_bio).trim()
          ? req.body.author_bio
          : row && row.author_bio_pending;
      if (!text || !String(text).trim()) {
        error = 'Zadejte text k zveřejnění.';
      } else {
        usersService.approveAuthorBio(uid, text);
        success = 'Bio bylo schváleno a je na webu.';
      }
    } else if (action === 'reject') {
      usersService.rejectAuthorBio(uid);
      success = 'Návrh bio byl zamítnut.';
    } else if (action === 'save') {
      usersService.approveAuthorBio(uid, req.body.author_bio);
      success = 'Bio bylo uloženo a zveřejněno.';
    } else if (action === 'clear') {
      usersService.clearAuthorBio(uid);
      success = 'Bio bylo odebráno z webu.';
    } else {
      error = 'Neznámá akce.';
    }

    return renderBioAdmin(res, { error, success });
  }
);

/* --- Users (Vedení) --- */
function listStaffUsers() {
  return usersService.listAll().filter((u) => isStaffUser(u));
}

function fotografOnlyUserMode(user) {
  return canCreateFotografUsers(user) && !canManageUsers(user);
}

function usersVisibleTo(actor) {
  const users = listStaffUsers();
  if (canManageUsers(actor)) return users;
  return users.filter((u) => isFotografManagedUser(u));
}

function renderUsersAdmin(req, res, extra = {}) {
  const limited = fotografOnlyUserMode(req.user);
  res.render('admin/users', {
    title: limited ? 'Fotografové - administrace' : 'Uživatelé - administrace',
    users: usersVisibleTo(req.user),
    roles: limited ? ['fotograf'] : STAFF_ROLES,
    roleLabels: ROLE_LABELS,
    fotografOnlyMode: limited,
    error: extra.error || null,
    success: extra.success || null,
  });
}

router.get('/administrace/uzivatele', requireRole('vedeni', 'spravce_akreditace'), (req, res) => {
  if (!canCreateFotografUsers(req.user)) return res.status(403).send('Nemáte oprávnění');
  renderUsersAdmin(req, res);
});

router.post(
  '/administrace/uzivatele',
  requireRole('vedeni', 'spravce_akreditace'),
  express.urlencoded({ extended: true }),
  (req, res) => {
    if (!canCreateFotografUsers(req.user)) return res.status(403).send('Nemáte oprávnění');
    const limited = fotografOnlyUserMode(req.user);
    const { action } = req.body;
    let error = null;
    let success = null;

    if (action === 'create') {
      const { email, password, display_name } = req.body;
      const roles = limited ? ['fotograf'] : rolesFromBody(req.body);
      if (!email || !password) error = 'E-mail a heslo jsou povinné.';
      else if (!roles.length) error = 'Vyberte alespoň jednu roli.';
      else if (limited && (roles.length !== 1 || roles[0] !== 'fotograf')) {
        error = 'Správce akreditace může přidat jen roli fotograf.';
      } else if (password.length < 8) error = 'Heslo musí mít alespoň 8 znaků.';
      else {
        try {
          usersService.createUser({ email, password, roles, display_name });
          success = limited ? 'Fotograf byl vytvořen.' : 'Uživatel byl vytvořen.';
        } catch (e) {
          error = e.message && e.message.includes('UNIQUE') ? 'Tento e-mail už existuje.' : 'Uložení se nezdařilo.';
        }
      }
    }

    if (action === 'update') {
      const { id, email, display_name, password } = req.body;
      const uid = parseInt(id, 10);
      const target = uid ? usersService.getById(uid) : null;
      const roles = limited ? ['fotograf'] : rolesFromBody(req.body);
      if (!uid || !email || !roles.length) error = 'Neplatné údaje. Vyberte alespoň jednu roli.';
      else if (limited && !isFotografManagedUser(target)) error = 'Můžete upravovat jen účty s rolí fotograf.';
      else {
        try {
          usersService.updateUserAdmin(uid, {
            email,
            roles,
            display_name,
            password,
          });
          success = 'Uživatel byl aktualizován.';
        } catch (e) {
          error = 'Aktualizace se nezdařila.';
        }
      }
    }

    if (action === 'delete') {
      const uid = parseInt(req.body.id, 10);
      const target = uid ? usersService.getById(uid) : null;
      if (uid === req.user.id) error = 'Nemůžete smazat sám sebe.';
      else if (limited && !isFotografManagedUser(target)) error = 'Můžete mazat jen účty s rolí fotograf.';
      else if (uid) {
        if (usersService.countArticlesByUser(uid) > 0) {
          error = 'Uživatele nelze smazat - má přiřazené články.';
        } else {
          try {
            usersService.deleteUser(uid);
            success = 'Uživatel byl smazán.';
          } catch {
            error = 'Smazání se nezdařilo.';
          }
        }
      }
    }

    renderUsersAdmin(req, res, { error, success });
  }
);

router.get('/administrace/reklamy', requireRole('vedeni'), (req, res) => {
  if (!canManageAds(req.user)) return res.status(403).send('Nemáte oprávnění');
  renderReklamyAdmin(req, res);
});

router.post(
  '/administrace/reklamy',
  requireRole('vedeni'),
  (req, res, next) => {
    if (!canManageAds(req.user)) return res.status(403).send('Nemáte oprávnění');
    uploadAdCreative.single('image')(req, res, (err) => {
      if (err) {
        return renderReklamyAdmin(req, res, {
          error:
            err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
              ? 'Obrázek je příliš velký (max. 8 MB).'
              : err.message || 'Nahrání se nezdařilo.',
        });
      }
      next();
    });
  },
  optimizeUploadedFile,
  (req, res) => {
    const action = String(req.body.action || '').trim();
    const slot = String(req.body.slot || '').trim();
    const id = parseInt(req.body.id, 10);

    try {
      if (action === 'create') {
        if (!isKnownCreativeSlot(slot)) {
          if (req.file) removeAdCreativeUpload('/uploads/ads/' + req.file.filename);
          return renderReklamyAdmin(req, res, { error: 'Neplatný reklamní slot.' });
        }
        const link = String(req.body.link_url || '').trim();
        if (!req.file) {
          return renderReklamyAdmin(req, res, { error: 'Nahrajte obrázek reklamy.' });
        }
        if (!link) {
          removeAdCreativeUpload('/uploads/ads/' + req.file.filename);
          return renderReklamyAdmin(req, res, { error: 'Vyplňte odkaz reklamy.' });
        }
        adsService.createCreative({
          slot,
          image_path: '/uploads/ads/' + req.file.filename,
          link_url: link,
          is_active: req.body.is_active === '1' || req.body.is_active === 'on',
        });
        return renderReklamyAdmin(req, res, { success: 'Reklama byla přidána.' });
      }

      if (!Number.isFinite(id)) {
        if (req.file) removeAdCreativeUpload('/uploads/ads/' + req.file.filename);
        return renderReklamyAdmin(req, res, { error: 'Neplatná položka.' });
      }

      const existing = adsService.getCreativeById(id);
      if (!existing) {
        if (req.file) removeAdCreativeUpload('/uploads/ads/' + req.file.filename);
        return renderReklamyAdmin(req, res, { error: 'Reklama nenalezena.' });
      }

      if (action === 'toggle') {
        adsService.updateCreative(id, { is_active: !existing.is_active });
        return renderReklamyAdmin(req, res, {
          success: existing.is_active ? 'Reklama byla vypnuta.' : 'Reklama byla zapnuta.',
        });
      }

      if (action === 'update') {
        const link = String(req.body.link_url || '').trim();
        if (!link) {
          if (req.file) removeAdCreativeUpload('/uploads/ads/' + req.file.filename);
          return renderReklamyAdmin(req, res, { error: 'Vyplňte odkaz reklamy.' });
        }
        let imagePath = existing.image_path;
        if (req.file) {
          imagePath = '/uploads/ads/' + req.file.filename;
          removeAdCreativeUpload(existing.image_path);
        }
        adsService.updateCreative(id, {
          link_url: link,
          image_path: imagePath,
          is_active: req.body.is_active === '1' || req.body.is_active === 'on',
        });
        return renderReklamyAdmin(req, res, { success: 'Reklama byla uložena.' });
      }

      if (action === 'delete') {
        const removed = adsService.deleteCreative(id);
        if (removed) removeAdCreativeUpload(removed.image_path);
        return renderReklamyAdmin(req, res, { success: 'Reklama byla smazána.' });
      }

      if (req.file) removeAdCreativeUpload('/uploads/ads/' + req.file.filename);
      return renderReklamyAdmin(req, res, { error: 'Neznámá akce.' });
    } catch (e) {
      if (req.file) removeAdCreativeUpload('/uploads/ads/' + req.file.filename);
      return renderReklamyAdmin(req, res, {
        error: e && e.message ? e.message : 'Uložení se nezdařilo.',
      });
    }
  }
);

router.get('/administrace/reels', requireRole('vedeni', 'sefredaktor'), (req, res) => res.redirect(301, '/administrace'));
router.get('/administrace/reels/nove', requireRole('vedeni', 'sefredaktor'), (req, res) => res.redirect(301, '/administrace'));
router.get('/administrace/vsechny-reelska', requireRole('vedeni', 'sefredaktor'), (req, res) => res.redirect(301, '/administrace'));
router.get('/administrace/reels/:id/edit', requireRole('vedeni', 'sefredaktor'), (req, res) => res.redirect(301, '/administrace'));
router.post('/administrace/reels/nove', requireRole('vedeni', 'sefredaktor'), (req, res) => res.redirect(301, '/administrace'));
router.post('/administrace/reels/:id/edit', requireRole('vedeni', 'sefredaktor'), (req, res) => res.redirect(301, '/administrace'));
router.post('/administrace/reels/:id/smazat', requireRole('vedeni', 'sefredaktor'), (req, res) => res.redirect(301, '/administrace'));

router.get('/administrace/sidebar-social', requireLogin, (req, res) => {
  res.redirect(301, '/administrace');
});

/* --- Kitswapy (Vedení, Šéfredaktor) --- */
function renderKitswapyAdmin(req, res, { error, success } = {}) {
  const items = kitswapsService.listAllForAdmin();
  const usedIds = kitswapsService.getUsedArticleIds();
  res.render('admin/kitswapy', {
    title: 'Kitswapy - administrace',
    items,
    articlesForSearch: kitswapsService.listPublishedArticlesForPicker(),
    usedArticleIds: Array.from(usedIds),
    maxKitswaps: kitswapsService.MAX_KITSWAPS,
    slotsLeft: Math.max(0, kitswapsService.MAX_KITSWAPS - items.length),
    error: error || null,
    success: success || null,
  });
}

router.get('/administrace/kitswapy', requireRole('vedeni', 'sefredaktor'), (req, res) => {
  renderKitswapyAdmin(req, res);
});

router.post(
  '/administrace/kitswapy',
  requireRole('vedeni', 'sefredaktor'),
  express.urlencoded({ extended: true }),
  (req, res) => {
    const articleId = parseInt(req.body.article_id, 10);
    try {
      if (Number.isFinite(articleId) && articleId > 0) {
        kitswapsService.publishArticle(articleId);
      } else {
        const q = String(req.body.q || req.body.article_query || '').trim();
        if (!q) {
          return renderKitswapyAdmin(req, res, { error: 'Zadejte klíčová slova nebo vyberte článek.' });
        }
        kitswapsService.publishArticleByQuery(q);
      }
      return renderKitswapyAdmin(req, res, { success: 'Článek je v sidebaru na homepage.' });
    } catch (e) {
      const msg =
        e.code === 'MAX_REACHED' ||
        e.code === 'DUPLICATE' ||
        e.code === 'INVALID_ARTICLE' ||
        e.code === 'AMBIGUOUS' ||
        e.code === 'NOT_FOUND'
          ? e.message
          : 'Publikování se nezdařilo.';
      return renderKitswapyAdmin(req, res, { error: msg });
    }
  }
);

router.post(
  '/administrace/kitswapy/:id',
  requireRole('vedeni', 'sefredaktor'),
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/administrace/kitswapy');
    const action = req.body.action;
    if (action === 'delete') {
      kitswapsService.remove(id);
      return renderKitswapyAdmin(req, res, { success: 'Kitswap odebrán.' });
    }
    if (action === 'move_up') {
      kitswapsService.move(id, -1);
      return renderKitswapyAdmin(req, res, { success: 'Pořadí upraveno.' });
    }
    if (action === 'move_down') {
      kitswapsService.move(id, 1);
      return renderKitswapyAdmin(req, res, { success: 'Pořadí upraveno.' });
    }
    return res.redirect('/administrace/kitswapy');
  }
);

/* --- Stats (Vedení) --- */
router.get('/administrace/statistiky', requireRole('vedeni'), (req, res) => {
  const perPage = 7;
  const q = String(req.query.q || '').trim();
  const rawPage = parseInt(req.query.page, 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const totalItems = articlesService.countPublishedForStats(q);
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage) || 1);
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;
  const summary = articlesService.statsSummary(perPage, offset, q);

  res.render('admin/stats', {
    title: 'Statistiky - administrace',
    summary,
    searchQuery: q,
    pagination: {
      page,
      perPage,
      totalItems,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
  });
});

const graficiRole = requireRole('vedeni', 'sefredaktor', 'redaktor', 'fotograf');

function sendGraficiPng(res, buf, filename, download) {
  if (!buf) {
    res.status(404).send('Grafika se nepodařila vygenerovat.');
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  } else {
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  }
  res.send(buf);
}

router.get('/administrace/grafici', graficiRole, async (req, res) => {
  try {
    const ctx = await graficiPng.getContext();
    res.render('admin/grafici', {
      title: 'Grafici - administrace',
      season: ctx.season,
      round: ctx.round,
      dateLabel: ctx.dateLabel,
      matches: ctx.matches,
      upcomingRound: ctx.upcomingRound,
      upcomingDateLabel: ctx.upcomingDateLabel,
      upcoming: ctx.upcoming,
    });
  } catch (err) {
    console.error('[grafici]', err);
    res.status(500).send('Grafici se nepodařilo načíst.');
  }
});

router.get('/administrace/grafici/tabulka.png', graficiRole, async (req, res) => {
  try {
    const buf = await graficiPng.renderTablePng();
    sendGraficiPng(res, buf, '11ka-chance-liga-tabulka.png', req.query.download);
  } catch (err) {
    console.error('[grafici tabulka]', err);
    res.status(500).send('PNG tabulky se nepodařilo vygenerovat.');
  }
});

router.get('/administrace/grafici/vysledky.png', graficiRole, async (req, res) => {
  try {
    const buf = await graficiPng.renderResultsPng();
    sendGraficiPng(res, buf, '11ka-chance-liga-vysledky.png', req.query.download);
  } catch (err) {
    console.error('[grafici vysledky]', err);
    res.status(500).send('PNG výsledků se nepodařilo vygenerovat.');
  }
});

router.get('/administrace/grafici/statistiky.png', graficiRole, async (req, res) => {
  try {
    const buf = await graficiPng.renderStatsPng();
    sendGraficiPng(res, buf, '11ka-chance-liga-statistiky.png', req.query.download);
  } catch (err) {
    console.error('[grafici statistiky]', err);
    res.status(500).send('PNG statistik se nepodařilo vygenerovat.');
  }
});

router.get('/administrace/grafici/program.png', graficiRole, async (req, res) => {
  try {
    const buf = await graficiPng.renderProgramPng();
    sendGraficiPng(res, buf, '11ka-chance-liga-program.png', req.query.download);
  } catch (err) {
    console.error('[grafici program]', err);
    res.status(500).send('PNG programu se nepodařilo vygenerovat.');
  }
});

router.get('/administrace/grafici/zapas/:id.png', graficiRole, async (req, res) => {
  try {
    const buf = await graficiPng.renderMatchPng(req.params.id);
    if (!buf) {
      res.status(404).send('Zápas se nenašel.');
      return;
    }
    sendGraficiPng(res, buf, `11ka-vysledek-${req.params.id}.png`, req.query.download);
  } catch (err) {
    console.error('[grafici zapas]', err);
    res.status(500).send('PNG výsledku se nepodařilo vygenerovat.');
  }
});

/* --- Akreditace (Vedení + Správce Akreditace) --- */
router.get('/administrace/akreditace', requireAkreditaceAccess, (req, res) => {
  const tabRaw = String(req.query.tab || '').trim().toLowerCase();
  const tab =
    tabRaw === 'skryte' ? 'skryte' : tabRaw === 'spis' ? 'spis' : tabRaw === 'statistiky' ? 'statistiky' : 'viditelne';
  const flash = req.query.deleted === 'ok'
    ? 'deleted'
    : req.query.mail === 'ok'
      ? 'ok'
      : req.query.mail === 'fail'
        ? 'fail'
        : null;
  const dateFilter = akreditaceDateFromReq(req.query);

  const visibleCount = accreditationService.countByWebVisibility(false);
  const hiddenCount = accreditationService.countByWebVisibility(true);
  const spisSearch = String(req.query.q || '').trim();
  const personEmail = String(req.query.email || '').trim();

  if (tab === 'statistiky') {
    return res.render('admin/akreditace', {
      title: 'Akreditace - statistiky - administrace',
      requests: [],
      applicants: [],
      personEmail: null,
      personRequests: [],
      personStats: null,
      spisSearch: '',
      tab,
      dateFrom: dateFilter.od,
      dateTo: dateFilter.do,
      coverage: accreditationService.photoCoverageStats(),
      tabCounts: {
        viditelne: visibleCount,
        skryte: hiddenCount,
        spis: accreditationService.countApplicants(''),
      },
      pagination: {
        page: 1,
        perPage: 7,
        totalItems: 0,
        totalPages: 1,
        hasPrev: false,
        hasNext: false,
      },
      flash,
    });
  }

  if (tab === 'spis') {
    const perPage = 7;
    const rawPage = parseInt(req.query.page, 10);
    const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const totalItems = accreditationService.countApplicants(spisSearch);
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * perPage;
    const { items: applicants } = accreditationService.listApplicantStats({
      search: spisSearch,
      limit: perPage,
      offset,
    });
    const personRequests = personEmail
      ? accreditationService.listByEmail(personEmail)
      : [];
    const personStats = personEmail
      ? accreditationService.getApplicantStatsByEmail(personEmail)
      : null;

    return res.render('admin/akreditace', {
      title: 'Akreditace - spis - administrace',
      requests: [],
      applicants,
      personEmail: personEmail || null,
      personRequests,
      personStats,
      spisSearch,
      tab,
      dateFrom: dateFilter.od,
      dateTo: dateFilter.do,
      tabCounts: {
        viditelne: visibleCount,
        skryte: hiddenCount,
        spis: accreditationService.countApplicants(''),
      },
      coverage: null,
      pagination: {
        page,
        perPage,
        totalItems,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
      flash,
    });
  }

  const showHidden = tab === 'skryte';
  const perPage = 7;
  const rawPage = parseInt(req.query.page, 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const dateOpts = { dateFrom: dateFilter.od, dateTo: dateFilter.do };
  const totalItems = accreditationService.countByWebVisibility(showHidden, dateOpts);
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage) || 1);
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;
  const requests = accreditationService.listPagedByWebVisibility(showHidden, perPage, offset, dateOpts);

  res.render('admin/akreditace', {
    title: 'Akreditace - administrace',
    requests,
    applicants: [],
    personEmail: null,
    personRequests: [],
    personStats: null,
    spisSearch: '',
    tab,
    dateFrom: dateFilter.od,
    dateTo: dateFilter.do,
    tabCounts: {
      viditelne: visibleCount,
      skryte: hiddenCount,
      spis: accreditationService.countApplicants(''),
    },
    coverage: null,
    pagination: {
      page,
      perPage,
      totalItems,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
    flash,
  });
});

router.get('/administrace/akreditace/:id', requireAkreditaceAccess, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = Number.isFinite(id) ? accreditationService.getById(id) : null;
  if (!row) {
    return res.status(404).render('404', { title: 'Nenalezeno - 11ka', activeNav: 'home' });
  }
  const rawPage = parseInt(req.query.page, 10);
  const backPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const tabRaw = String(req.query.tab || '').trim().toLowerCase();
  const backTab = tabRaw === 'skryte' ? 'skryte' : tabRaw === 'spis' ? 'spis' : 'viditelne';
  const backEmail = String(req.query.email || '').trim() || null;
  const dateFilter = akreditaceDateFromReq(req.query);
  const flash =
    req.query.status === 'approved'
      ? 'approved'
      : req.query.status === 'rejected'
        ? 'rejected'
        : req.query.status === 'requested'
          ? 'requested'
          : req.query.web === 'hidden'
            ? 'web-hidden'
            : req.query.web === 'shown'
              ? 'web-shown'
              : req.query.mail === 'ok'
                ? 'ok'
                : req.query.mail === 'fail'
                  ? 'fail'
                  : null;
  res.render('admin/akreditace-detail', {
    title: `Akreditace #${row.id} - administrace`,
    request: row,
    backPage,
    backTab,
    backEmail,
    backDateFrom: dateFilter.od,
    backDateTo: dateFilter.do,
    flash,
  });
});

router.post(
  '/administrace/akreditace/:id/odeslat-email',
  requireAkreditaceAccess,
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = Number.isFinite(id) ? accreditationService.getById(id) : null;
    const rawPage = parseInt(req.body.page, 10);
    const pageQ = Number.isFinite(rawPage) && rawPage > 1 ? `&page=${rawPage}` : '';
    const tabQRaw = akreditaceTabQuery(akreditaceTabFromBody(req), req.body.email, req.body);
    const tabQ = tabQRaw ? `&${tabQRaw}` : '';
    const detailBase = `/administrace/akreditace/${id}`;
    if (!row) {
      return res.redirect(302, `${detailBase}?mail=fail${pageQ}${tabQ}`);
    }
    const result = await sendAccreditationRequest({
      email: row.email,
      phone: row.phone,
      name: row.name,
      match: row.match_name,
      matchDate: row.match_date,
      accreditationType: row.accreditation_type,
    });
    if (result.ok) {
      accreditationService.markEmailSent(id);
      return res.redirect(302, `${detailBase}?mail=ok${pageQ}${tabQ}`);
    }
    console.error('[11ka] Ruční odeslání akreditace #%s:', id, result.error);
    return res.redirect(302, `${detailBase}?mail=fail${pageQ}${tabQ}`);
  }
);

function redirectAkreditaceDetail(id, queryParts) {
  const q = queryParts.filter(Boolean).join('&');
  return `/administrace/akreditace/${id}${q ? `?${q}` : ''}`;
}

function akreditaceTabFromBody(req) {
  const t = String(req.body?.tab || '').trim().toLowerCase();
  if (t === 'skryte') return 'skryte';
  if (t === 'spis') return 'spis';
  if (t === 'statistiky') return 'statistiky';
  return 'viditelne';
}

function akreditaceDateFromReq(src) {
  const raw = src || {};
  const exact = accreditationService.isValidMatchDate(raw.datum) ? String(raw.datum).trim() : '';
  let od = accreditationService.isValidMatchDate(raw.od) ? String(raw.od).trim() : '';
  let dateTo = accreditationService.isValidMatchDate(raw.do) ? String(raw.do).trim() : '';
  if (exact && !od && !dateTo) {
    od = exact;
    dateTo = exact;
  }
  return { od, do: dateTo };
}

function akreditaceDateQuery(od, dateTo) {
  const parts = [];
  if (od) parts.push(`od=${encodeURIComponent(od)}`);
  if (dateTo) parts.push(`do=${encodeURIComponent(dateTo)}`);
  return parts.join('&');
}

function akreditaceTabQuery(tab, email, dateSrc) {
  const parts = [];
  if (tab === 'skryte') parts.push('tab=skryte');
  if (tab === 'spis') {
    parts.push('tab=spis');
    const em = String(email || '').trim();
    if (em) parts.push(`email=${encodeURIComponent(em)}`);
  } else if (dateSrc) {
    const dates = akreditaceDateFromReq(dateSrc);
    const dateQ = akreditaceDateQuery(dates.od, dates.do);
    if (dateQ) parts.push(dateQ);
  }
  return parts.join('&');
}

router.post(
  '/administrace/akreditace/:id/zazadano',
  requireAkreditaceAccess,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const rawPage = parseInt(req.body.page, 10);
    const pageQ = Number.isFinite(rawPage) && rawPage > 1 ? `page=${rawPage}` : '';
    const tabQ = akreditaceTabQuery(akreditaceTabFromBody(req), req.body.email, req.body);
    if (Number.isFinite(id)) {
      accreditationService.setStatus(id, 'requested');
    }
    return res.redirect(302, redirectAkreditaceDetail(id, [pageQ, tabQ, 'status=requested']));
  }
);

router.post(
  '/administrace/akreditace/:id/schvalit',
  requireAkreditaceAccess,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const rawPage = parseInt(req.body.page, 10);
    const pageQ = Number.isFinite(rawPage) && rawPage > 1 ? `page=${rawPage}` : '';
    const tabQ = akreditaceTabQuery(akreditaceTabFromBody(req), req.body.email, req.body);
    if (Number.isFinite(id)) {
      accreditationService.setStatus(id, 'approved');
    }
    return res.redirect(302, redirectAkreditaceDetail(id, [pageQ, tabQ, 'status=approved']));
  }
);

router.post(
  '/administrace/akreditace/:id/zamitnout',
  requireAkreditaceAccess,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const rawPage = parseInt(req.body.page, 10);
    const pageQ = Number.isFinite(rawPage) && rawPage > 1 ? `page=${rawPage}` : '';
    const tabQ = akreditaceTabQuery(akreditaceTabFromBody(req), req.body.email, req.body);
    if (Number.isFinite(id)) {
      accreditationService.setStatus(id, 'rejected');
    }
    return res.redirect(302, redirectAkreditaceDetail(id, [pageQ, tabQ, 'status=rejected']));
  }
);

router.post(
  '/administrace/akreditace/:id/odebrat-z-webu',
  requireAkreditaceAccess,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const rawPage = parseInt(req.body.page, 10);
    const pageQ = Number.isFinite(rawPage) && rawPage > 1 ? `page=${rawPage}` : '';
    const dateQ = akreditaceTabQuery('skryte', '', req.body);
    if (Number.isFinite(id)) {
      accreditationService.setHiddenFromWeb(id, true);
    }
    return res.redirect(302, redirectAkreditaceDetail(id, [pageQ, dateQ, 'web=hidden']));
  }
);

router.post(
  '/administrace/akreditace/:id/vratit-na-web',
  requireAkreditaceAccess,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const rawPage = parseInt(req.body.page, 10);
    const pageQ = Number.isFinite(rawPage) && rawPage > 1 ? `page=${rawPage}` : '';
    const dateQ = akreditaceTabQuery('viditelne', '', req.body);
    if (Number.isFinite(id)) {
      accreditationService.setHiddenFromWeb(id, false);
    }
    return res.redirect(302, redirectAkreditaceDetail(id, [pageQ, dateQ, 'web=shown']));
  }
);

router.post(
  '/administrace/akreditace/:id/smazat',
  requireAkreditaceAccess,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const rawPage = parseInt(req.body.page, 10);
    const tab = akreditaceTabFromBody(req);
    const parts = [];
    const tabQ = akreditaceTabQuery(tab, req.body.email, req.body);
    if (tabQ) parts.push(tabQ);
    if (Number.isFinite(rawPage) && rawPage > 1) parts.push(`page=${rawPage}`);
    parts.push('deleted=ok');
    if (Number.isFinite(id)) {
      accreditationService.remove(id);
    }
    return res.redirect(302, `/administrace/akreditace?${parts.join('&')}`);
  }
);

/* --- AI články (role majitel) --- */
function aiBodyFromForm(raw) {
  const text = String(raw || '').trim();
  if (!text) return { html: '', blocks: '[]' };
  if (/<[a-z][\s\S]*>/i.test(text)) {
    const paras = text
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .split(/\n+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return { html: text, blocks: aiArticleDraft.draftToBlocksJson(paras) };
  }
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    html: aiArticleDraft.draftToBodyHtml(paras),
    blocks: aiArticleDraft.draftToBlocksJson(paras),
  };
}

function persistAiForm(req, item) {
  const authorId = parseInt(req.body.author_id, 10);
  const authors = listAiDraftAuthors();
  const authorOk = authors.some((a) => a.id === authorId);
  const body = aiBodyFromForm(req.body.body);
  return aiIngest.saveDraftFields(item.id, {
    title: articlesService.clipTitle(req.body.title || item.title || ''),
    excerpt: articlesService.clipExcerpt(req.body.excerpt) || '',
    body_html: body.html,
    body_blocks_json: body.blocks,
    category: CATEGORY_OPTIONS.includes(String(req.body.category || ''))
      ? String(req.body.category)
      : item.category,
    tag: String(req.body.tag || '').trim() || null,
    author_id: authorOk ? authorId : req.user.id,
  });
}

function renderAiClanky(req, res, extras = {}) {
  const status = ['queue', 'inbox', 'published', 'rejected', 'failed'].includes(req.query.stav)
    ? req.query.stav
    : extras.status || 'inbox';
  const lastFetchedAt = aiIngest.getLastFetchedAt();
  res.render('admin/ai-clanky', {
    title: 'AI články - administrace',
    queueItems: aiQueue.listQueue(status, 80),
    currentStatus: status,
    statusCounts: {
      queue: aiQueue.countByStatus('queue'),
      inbox: aiQueue.countByStatus('inbox'),
      published: aiQueue.countByStatus('published'),
      rejected: aiQueue.countByStatus('rejected'),
      failed: aiQueue.countByStatus('failed'),
    },
    lastFetchedAt,
    lastFetchedLabel: lastFetchedAt ? formatPragueDateTime(lastFetchedAt) : null,
    feedIntervalMs: aiIngest.FEED_INTERVAL_MS,
    feedStale: extras.feedStale != null ? extras.feedStale : aiIngest.isFeedStale(),
    aiConfigured: aiArticleDraft.isConfigured(),
    aiSetupHint: aiArticleDraft.getSetupHint(),
    error: extras.error || null,
    success: extras.success || null,
  });
}

function renderAiClanek(req, res, extras = {}) {
  const id = parseInt(req.params.id, 10);
  const item = extras.queueItem || aiQueue.getQueueItem(id);
  if (!item) return res.status(404).send('Položka není.');
  const authors = listAiDraftAuthors();
  if (!item.author_id && authors.some((a) => a.id === req.user.id)) {
    item.author_id = req.user.id;
  }
  res.render('admin/ai-clanek', {
    title: 'Kontrola AI článku - administrace',
    queueItem: item,
    authors,
    categories: CATEGORY_OPTIONS,
    tagOptions: adminTagOptions(),
    error: extras.error || null,
    success: extras.success || null,
  });
}

router.get('/administrace/ai-clanky', requireAiDraftAccess, (req, res) => {
  renderAiClanky(req, res);
});

router.post(
  '/administrace/ai-clanky',
  requireAiDraftAccess,
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const action = String(req.body.action || '').trim();
    try {
      if (action === 'ingest') {
        const ingested = await aiIngest.ingestSourcesSafe(8);
        if (req.query.ajax === '1' || String(req.headers.accept || '').includes('application/json')) {
          return res.json({
            ok: true,
            created: ingested.created,
            skipped: ingested.skipped,
            lastFetchedAt: aiIngest.getLastFetchedAt(),
          });
        }
        return renderAiClanky(req, res, {
          success: ingested.created
            ? `Feed obnovený, přibylo ${ingested.created} článků.`
            : 'Feed je aktuální.',
        });
      }
      if (action === 'rewrite') {
        const rewritten = await aiIngest.rewritePending(8);
        return renderAiClanky(req, res, {
          success: `Přepsáno ${rewritten.rewritten} z ${rewritten.attempted}.`,
        });
      }
      if (action === 'ingest_url') {
        const url = String(req.body.url || '').trim();
        if (!/^https?:\/\//i.test(url)) {
          return renderAiClanky(req, res, { error: 'Vlož platnou URL.' });
        }
        const result = await aiIngest.ingestUrl(url);
        if (!result.created) {
          return renderAiClanky(req, res, { error: result.error || 'Už ve frontě je.' });
        }
        try {
          const live = await aiIngest.openInEditor(result.id, { authorId: req.user.id });
          return res.redirect(302, `/administrace/clanek/${live.id}/edit?ai=1`);
        } catch (e) {
          return res.redirect(302, `/administrace/ai-clanky/${result.id}`);
        }
      }
      return renderAiClanky(req, res, { error: 'Neznámá akce.' });
    } catch (e) {
      return renderAiClanky(req, res, {
        error: e && e.message ? e.message : 'Akce se nezdařila.',
      });
    }
  }
);

router.get('/administrace/ai-clanky/zdroje', requireAiDraftAccess, (req, res) => {
  res.render('admin/ai-zdroje', {
    title: 'AI zdroje - administrace',
    sources: aiQueue.listSources(),
    error: null,
    success: null,
  });
});

router.post(
  '/administrace/ai-clanky/zdroje',
  requireAiDraftAccess,
  express.urlencoded({ extended: true }),
  (req, res) => {
    const action = String(req.body.action || '').trim();
    try {
      if (action === 'create') {
        const name = String(req.body.name || '').trim();
        const url = String(req.body.url || '').trim();
        if (!name || !url) throw new Error('Název i RSS URL jsou povinné.');
        aiQueue.createSource({ name, url, filter: String(req.body.filter || '').trim() });
      } else if (action === 'toggle') {
        aiQueue.toggleSource(parseInt(req.body.id, 10), String(req.body.enabled) === '1');
      } else if (action === 'delete') {
        aiQueue.deleteSource(parseInt(req.body.id, 10));
      }
      return res.redirect(302, '/administrace/ai-clanky/zdroje');
    } catch (e) {
      return res.render('admin/ai-zdroje', {
        title: 'AI zdroje - administrace',
        sources: aiQueue.listSources(),
        error: e && e.message ? e.message : 'Uložení selhalo.',
        success: null,
      });
    }
  }
);

router.get('/administrace/ai-clanky/:id', requireAiDraftAccess, (req, res) => {
  renderAiClanek(req, res);
});

router.post(
  '/administrace/ai-clanky/:id',
  requireAiDraftAccess,
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = aiQueue.getQueueItem(id);
    if (!item) return res.status(404).send('Položka není.');
    const action = String(req.body.action || '').trim();
    try {
      if (action === 'save' || action === 'draft' || action === 'publish') {
        persistAiForm(req, item);
      }
      if (action === 'rewrite') {
        await aiIngest.rewriteOne(id, req.body.category);
        return renderAiClanek(req, res, { success: 'Přepsáno znovu.' });
      }
      if (action === 'open_editor') {
        if (String(req.body.title || '').trim()) persistAiForm(req, item);
        const live = await aiIngest.openInEditor(id, {
          authorId: parseInt(req.body.author_id, 10) || req.user.id,
        });
        return res.redirect(302, `/administrace/clanek/${live.id}/edit?ai=1`);
      }
      if (action === 'reject') {
        aiIngest.rejectQueueItem(id);
        return res.redirect(302, '/administrace/ai-clanky?stav=rejected');
      }
      if (action === 'draft') {
        const live = await aiIngest.publishQueueItem(id, {
          authorId: parseInt(req.body.author_id, 10) || req.user.id,
          publishNow: false,
        });
        return res.redirect(302, `/administrace/clanek/${live.id}/edit`);
      }
      if (action === 'publish') {
        const live = await aiIngest.publishQueueItem(id, {
          authorId: parseInt(req.body.author_id, 10) || req.user.id,
          publishNow: true,
        });
        return res.redirect(302, `/clanek/${live.slug}`);
      }
      return renderAiClanek(req, res, { success: 'Uloženo.' });
    } catch (e) {
      return renderAiClanek(req, res, {
        error: e && e.message ? e.message : 'Akce se nezdařila.',
      });
    }
  }
);

/* --- AI návrh článku (jen majitel) --- */
function listAiDraftAuthors() {
  return listArticleAuthors();
}

function renderAiNavrhy(req, res, extras = {}) {
  const authors = listAiDraftAuthors();
  const defaultAuthorId =
    authors.some((a) => a.id === req.user.id) ? req.user.id : authors[0] && authors[0].id;
  const formValues = {
    brief: '',
    source_note: '',
    category: CATEGORY_OPTIONS[0],
    author_id: defaultAuthorId,
    ...(extras.formValues || {}),
  };
  res.render('admin/ai-navrhy', {
    title: 'AI návrh článku - administrace',
    categories: CATEGORY_OPTIONS,
    authors,
    aiConfigured: aiArticleDraft.isConfigured(),
    aiProvider: aiArticleDraft.getProvider(),
    aiModel: aiArticleDraft.getModel(),
    aiSetupHint: aiArticleDraft.getSetupHint(),
    draftPreview: extras.draftPreview != null ? extras.draftPreview : req.session.aiDraftPreview || null,
    formValues,
    error: extras.error || null,
    success: extras.success || null,
  });
}

router.get('/administrace/ai-navrhy', requireAiDraftAccess, (req, res) => {
  if (req.query.reset === '1') {
    delete req.session.aiDraftPreview;
  }
  renderAiNavrhy(req, res);
});

router.post(
  '/administrace/ai-navrhy',
  requireAiDraftAccess,
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const action = String(req.body.action || '').trim();

    if (action === 'create') {
      const preview = req.session.aiDraftPreview;
      if (!preview || !preview.title || !Array.isArray(preview.paragraphs)) {
        return renderAiNavrhy(req, res, {
          error: 'Nejdřív vygenerujte návrh.',
        });
      }
      const authorId = parseInt(preview.author_id, 10);
      const authors = listAiDraftAuthors();
      const authorOk = authors.some((a) => a.id === authorId);
      if (!authorOk) {
        return renderAiNavrhy(req, res, {
          error: 'Neplatný autor.',
          draftPreview: preview,
          formValues: {
            brief: preview.brief || '',
            source_note: preview.source_note || '',
            category: preview.category || CATEGORY_OPTIONS[0],
            author_id: req.user.id,
          },
        });
      }

      try {
        const article = articlesService.createArticle({
          author_id: authorId,
          title: preview.title,
          excerpt: preview.excerpt || null,
          body_html: aiArticleDraft.draftToBodyHtml(preview.paragraphs),
          body_blocks_json: aiArticleDraft.draftToBlocksJson(preview.paragraphs),
          category: preview.category || null,
          sources: preview.sources || null,
          status: 'draft',
        });
        delete req.session.aiDraftPreview;
        return res.redirect(302, `/administrace/clanek/${article.id}/edit`);
      } catch (e) {
        return renderAiNavrhy(req, res, {
          error: e && e.message ? e.message : 'Uložení konceptu se nezdařilo.',
          draftPreview: preview,
        });
      }
    }

    if (action !== 'generate') {
      return renderAiNavrhy(req, res, { error: 'Neznámá akce.' });
    }

    const brief = String(req.body.brief || '');
    const source_note = String(req.body.source_note || '').trim();
    const category = String(req.body.category || '').trim();
    const author_id = parseInt(req.body.author_id, 10);
    const formValues = {
      brief,
      source_note,
      category: CATEGORY_OPTIONS.includes(category) ? category : CATEGORY_OPTIONS[0],
      author_id: Number.isFinite(author_id) ? author_id : req.user.id,
    };

    try {
      const draft = await aiArticleDraft.generateArticleDraft({
        brief,
        sourceNote: source_note,
        category: formValues.category,
      });
      req.session.aiDraftPreview = {
        ...draft,
        category: formValues.category,
        author_id: formValues.author_id,
        brief,
        source_note,
      };
      return renderAiNavrhy(req, res, {
        formValues,
        draftPreview: req.session.aiDraftPreview,
        success: 'Návrh je připravený. Zkontrolujte ho a uložte jako koncept.',
      });
    } catch (e) {
      const msg =
        e && e.code === 'NOT_CONFIGURED'
          ? aiArticleDraft.getSetupHint()
          : e && e.code === 'OLLAMA_DOWN'
            ? e.message
            : e && e.message
              ? e.message
              : 'Generování se nezdařilo.';
      return renderAiNavrhy(req, res, {
        formValues,
        error: msg,
        draftPreview: null,
      });
    }
  }
);

/* --- Žádosti (Šéfredaktor + Vedení) --- */
router.get('/administrace/zadosti', requireRole('vedeni', 'sefredaktor'), (req, res) => {
  const perPage = 7;
  const rawPage = parseInt(req.query.page, 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const totalItems = articlesService.countPending();
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;
  const pending = articlesService.listPendingPaged(perPage, offset);

  res.render('admin/zadosti', {
    title: 'Žádosti o vydání - administrace',
    pending,
    pagination: {
      page,
      perPage,
      totalItems,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
  });
});

/* --- Zápasy (Vedení + šéfredaktor) --- */
const ZAPASY_LEGACY_VIEW_REDIRECTS = {
  'create-team': '/administrace/zapasy/vytvorit-tym',
  teams: '/administrace/zapasy/tymy',
  'create-match': '/administrace/zapasy/vytvorit-zapas',
  matches: '/administrace/zapasy/seznam',
};

function zapasyFlash(req, overrides = {}) {
  const q = req.query || {};
  return {
    error: overrides.error != null ? overrides.error : q.error != null ? String(q.error) : null,
    success: overrides.success != null ? overrides.success : q.success != null ? String(q.success) : null,
  };
}

function zapasyRedirect(res, path, message, type = 'success') {
  const sep = path.includes('?') ? '&' : '?';
  return res.redirect(`${path}${sep}${type}=${encodeURIComponent(message)}`);
}

function kickoffInputValue(item) {
  if (!item || !item.kickoff_at) return '';
  return formatPragueDatetimeLocal(item.kickoff_at);
}

function kickoffInputValueFromBody(body) {
  const at = body && body.kickoff_at != null ? String(body.kickoff_at).trim() : '';
  if (!at) return '';
  if (at.includes('T')) return at.slice(0, 16);
  const time = body && body.kickoff_time != null ? String(body.kickoff_time).trim() : '';
  if (time && /^\d{2}:\d{2}/.test(time)) return `${at}T${time}`;
  return at;
}

function zapasyPage(req) {
  const rawPage = parseInt((req.query && req.query.page) || (req.body && req.body.page), 10);
  return Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
}

function renderZapasyTeams(req, res, opts = {}) {
  const allTeams = matchTeamsService.listAllForAdmin();
  const requestedPage = zapasyPage(req);
  const pagination = buildAdminPagination(
    '/administrace/zapasy/tymy',
    requestedPage,
    8,
    allTeams.length
  );
  const offset = (pagination.page - 1) * pagination.perPage;
  const teamItems = allTeams.slice(offset, offset + pagination.perPage);
  const editTeamId = opts.editTeamId != null ? opts.editTeamId : parseInt(req.query.edit_team, 10);
  const editingTeam =
    opts.editingTeam || (Number.isFinite(editTeamId) && editTeamId > 0 ? matchTeamsService.getById(editTeamId) : null);

  res.render('admin/zapasy-tymy', {
    title: 'Seznam týmů - administrace',
    zapasySection: 'teams',
    teamItems,
    pagination,
    editingTeam,
    ...zapasyFlash(req, opts),
  });
}

function renderZapasyMatches(req, res, opts = {}) {
  const allMatches = matchFixturesService.listAllForAdmin();
  const requestedPage = zapasyPage(req);
  const pagination = buildAdminPagination(
    '/administrace/zapasy/seznam',
    requestedPage,
    6,
    allMatches.length
  );
  const offset = (pagination.page - 1) * pagination.perPage;
  const items = allMatches.slice(offset, offset + pagination.perPage);
  const editId = opts.editId != null ? opts.editId : parseInt(req.query.edit, 10);
  const editingMatchInPage = editId ? items.find((i) => i.id === editId) : null;
  const editingMatchFallback = !editingMatchInPage && editId ? allMatches.find((i) => i.id === editId) : null;
  const editingItem = opts.editingItem || editingMatchInPage || editingMatchFallback || null;
  const logoLookup = matchTeamsService.buildLogoLookup();
  const editingFixture = editingItem
    ? (() => {
        const fixture = matchFixturesService.formatForWeb(editingItem);
        fixture.homeLogo = logoLookup[fixture.homeTeam] || '';
        fixture.awayLogo = logoLookup[fixture.awayTeam] || '';
        return fixture;
      })()
    : null;

  const pageSuffix =
    pagination.page > 1 ? `?page=${pagination.page}` : '';
  res.render('admin/zapasy-seznam', {
    title: 'Seznam zápasů - administrace',
    zapasySection: 'matches',
    items,
    pagination,
    formAction: '/administrace/zapasy/seznam',
    cancelHref: `/administrace/zapasy/seznam${pageSuffix}`,
    teamOptions: matchTeamsService.listNamesForSelect(),
    teamLogoLookup: matchTeamsService.buildLogoLookup(),
    statusOptions: matchFixturesService.STATUS_OPTIONS,
    manageStatusOptions: matchFixturesService.MANAGE_STATUS_OPTIONS,
    editingItem,
    editingFixture,
    ...zapasyFlash(req, opts),
  });
}

const zapasyRole = requireRole('vedeni', 'sefredaktor');

router.get('/administrace/zapasy', zapasyRole, (req, res) => {
  const legacyView = req.query.view != null ? String(req.query.view).trim() : '';
  if (legacyView && ZAPASY_LEGACY_VIEW_REDIRECTS[legacyView]) {
    const params = new URLSearchParams();
    if (req.query.page) params.set('page', String(req.query.page));
    if (req.query.edit) params.set('edit', String(req.query.edit));
    if (req.query.edit_team) params.set('edit_team', String(req.query.edit_team));
    const qs = params.toString();
    return res.redirect(ZAPASY_LEGACY_VIEW_REDIRECTS[legacyView] + (qs ? `?${qs}` : ''));
  }
  res.render('admin/zapasy-index', {
    title: 'Zápasy - administrace',
    zapasySection: 'hub',
    ...zapasyFlash(req),
  });
});

router.get('/administrace/zapasy/vytvorit-tym', zapasyRole, (req, res) => {
  res.render('admin/zapasy-vytvorit-tym', {
    title: 'Vytvořit tým - administrace',
    zapasySection: 'create-team',
    ...zapasyFlash(req),
  });
});

router.get('/administrace/zapasy/tymy', zapasyRole, (req, res) => {
  renderZapasyTeams(req, res);
});

router.get('/administrace/zapasy/vytvorit-zapas', zapasyRole, (req, res) => {
  res.render('admin/zapasy-vytvorit-zapas', {
    title: 'Vytvořit zápas - administrace',
    zapasySection: 'create-match',
    editingItem: null,
    formAction: '/administrace/zapasy/vytvorit-zapas',
    cancelHref: '/administrace/zapasy/seznam',
    pagination: { page: 1 },
    kickoffInputValue: '',
    teamOptions: matchTeamsService.listNamesForSelect(),
    statusOptions: matchFixturesService.STATUS_OPTIONS,
    ...zapasyFlash(req),
  });
});

router.get('/administrace/zapasy/seznam', zapasyRole, (req, res) => {
  renderZapasyMatches(req, res);
});

router.post('/administrace/zapasy/vytvorit-tym', zapasyRole, teamPostParser, (req, res) => {
  try {
    matchTeamsService.create({
      name: req.body.name,
      short_name: req.body.short_name,
      competition: req.body.competition,
      roster_json: req.body.roster_json,
      logo_path: resolveTeamLogoPath(req.file, null),
    });
    return zapasyRedirect(res, '/administrace/zapasy/tymy', 'Tým byl přidán.');
  } catch (e) {
    if (req.file) removeTeamLogo(resolveTeamLogoPath(req.file, null));
    return renderTeamFormError(req, res, 'admin/zapasy-vytvorit-tym', {
      title: 'Vytvořit tým - administrace',
      zapasySection: 'create-team',
      error: e && e.message ? e.message : 'Uložení se nezdařilo.',
    });
  }
});

router.post('/administrace/zapasy/tymy', zapasyRole, teamPostParser, (req, res) => {
  const action = req.body.action;
  const id = parseInt(req.body.id, 10);
  const page = zapasyPage(req);
  const pageSuffix = page > 1 ? `?page=${page}` : '';
  try {
    if (action === 'update_team') {
      if (!Number.isFinite(id)) throw new Error('Neplatný tým.');
      const existing = matchTeamsService.getById(id);
      if (!existing) throw new Error('Tým nebyl nalezen.');
      const logoPath = resolveTeamLogoPath(req.file, existing.logo_path);
      if (req.file && existing.logo_path) removeTeamLogo(existing.logo_path);
      matchTeamsService.update(id, {
        name: req.body.name,
        short_name: req.body.short_name,
        competition: req.body.competition,
        roster_json: req.body.roster_json,
        logo_path: logoPath,
      });
      return zapasyRedirect(res, `/administrace/zapasy/tymy${pageSuffix}`, 'Tým byl upraven.');
    }
    if (action === 'move_team_up' || action === 'move_team_down') {
      if (!Number.isFinite(id)) throw new Error('Neplatný tým.');
      matchTeamsService.move(id, action === 'move_team_up' ? -1 : 1);
      return zapasyRedirect(res, `/administrace/zapasy/tymy${pageSuffix}`, 'Pořadí upraveno.');
    }
    if (action === 'delete_team') {
      if (!Number.isFinite(id)) throw new Error('Neplatný tým.');
      const existing = matchTeamsService.getById(id);
      if (existing && existing.logo_path) removeTeamLogo(existing.logo_path);
      matchTeamsService.remove(id);
      return zapasyRedirect(res, `/administrace/zapasy/tymy${pageSuffix}`, 'Tým byl odebrán.');
    }
    throw new Error('Neznámá akce.');
  } catch (e) {
    if (req.file) removeTeamLogo(resolveTeamLogoPath(req.file, null));
    if (action === 'update_team' && Number.isFinite(id)) {
      const existing = matchTeamsService.getById(id);
      return renderZapasyTeams(req, res, {
        error: e && e.message ? e.message : 'Uložení se nezdařilo.',
        editTeamId: id,
        editingTeam: existing
          ? {
              ...existing,
              name: req.body.name || existing.name,
              short_name: req.body.short_name || existing.short_name,
              competition: req.body.competition || existing.competition,
              roster: matchTeamsService.normalizeRoster(req.body.roster_json),
            }
          : null,
      });
    }
    return renderZapasyTeams(req, res, {
      error: e && e.message ? e.message : 'Uložení se nezdařilo.',
      editTeamId: action === 'update_team' && Number.isFinite(id) ? id : null,
    });
  }
});

router.post('/administrace/zapasy/vytvorit-zapas', zapasyRole, (req, res) => {
  try {
    matchFixturesService.create(req.body);
    return zapasyRedirect(res, '/administrace/zapasy/seznam', 'Zápas byl přidán.');
  } catch (e) {
    return res.render('admin/zapasy-vytvorit-zapas', {
      title: 'Vytvořit zápas - administrace',
      zapasySection: 'create-match',
      editingItem: null,
      formAction: '/administrace/zapasy/vytvorit-zapas',
      cancelHref: '/administrace/zapasy/seznam',
      pagination: { page: zapasyPage(req) },
      kickoffInputValue: kickoffInputValueFromBody(req.body),
      teamOptions: matchTeamsService.listNamesForSelect(),
      statusOptions: matchFixturesService.STATUS_OPTIONS,
      error: e && e.message ? e.message : 'Uložení se nezdařilo.',
      success: null,
    });
  }
});

router.post('/administrace/zapasy/seznam', zapasyRole, (req, res) => {
  const action = req.body.action;
  const id = parseInt(req.body.id, 10);
  const page = zapasyPage(req);
  const pageSuffix = page > 1 ? `?page=${page}` : '';
  try {
    if (action === 'update') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.update(id, req.body);
      return zapasyRedirect(res, `/administrace/zapasy/seznam${pageSuffix}`, 'Zápas byl upraven.');
    }
    if (action === 'move_up' || action === 'move_down') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.move(id, action === 'move_up' ? -1 : 1);
      return zapasyRedirect(res, `/administrace/zapasy/seznam${pageSuffix}`, 'Pořadí upraveno.');
    }
    if (action === 'delete') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.remove(id);
      return zapasyRedirect(res, `/administrace/zapasy/seznam${pageSuffix}`, 'Zápas byl odebrán.');
    }
    if (action === 'start_match') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.startMatch(id);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Zápas byl spuštěn.'
      );
    }
    if (action === 'postpone_match') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.postponeMatch(id, req.body.reason);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Zápas byl odložen.'
      );
    }
    if (action === 'cancel_match') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.cancelMatch(id, req.body.reason);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Zápas byl zrušen.'
      );
    }
    if (action === 'save_lineup') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.saveLineup(id, req.body.lineup_json);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Sestava byla uložena.'
      );
    }
    if (action === 'add_match_event') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      const eventSource = { ...(req.query || {}), ...(req.body || {}) };
      const eventKey = matchFixturesService.pickEventKeyFromBody(eventSource);
      if (!eventKey) {
        console.warn('[match_event] unresolved key', {
          query: req.query,
          body: req.body,
        });
      }
      const eventLabel = matchFixturesService.addLiveEvent(
        id,
        eventKey,
        req.body,
        req.user && (req.user.display_name || req.user.email)
          ? String(req.user.display_name || req.user.email).trim()
          : ''
      );
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        `Akce zapsána: ${eventLabel}.`
      );
    }
    if (action === 'save_first_half_extra') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      const mode = String(req.body.extra_mode || '').trim();
      if (mode === 'none') {
        matchFixturesService.setFirstHalfExtra(id, null, true);
      } else if (mode === 'set') {
        const minutes = parseInt(req.body.extra_minutes, 10);
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 20) {
          throw new Error('Nastavení může být 0 až 20 minut.');
        }
        matchFixturesService.setFirstHalfExtra(id, minutes, true);
      } else {
        throw new Error('Neplatná volba nastavení.');
      }
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Nastavení 1. poločasu bylo uloženo.'
      );
    }
    if (action === 'save_second_half_extra') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      const mode = String(req.body.extra_mode || '').trim();
      if (mode === 'none') {
        matchFixturesService.setSecondHalfExtra(id, null, true);
      } else if (mode === 'set') {
        const minutes = parseInt(req.body.extra_minutes, 10);
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 20) {
          throw new Error('Nastavení může být 0 až 20 minut.');
        }
        matchFixturesService.setSecondHalfExtra(id, minutes, true);
      } else {
        throw new Error('Neplatná volba nastavení.');
      }
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Nastavení 2. poločasu bylo uloženo.'
      );
    }
    if (action === 'set_match_clock') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      const totalMinutes = parseInt(req.body.clock_total_minutes, 10);
      matchFixturesService.setMatchClock(id, totalMinutes);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        `Čas zápasu byl nastaven na ${totalMinutes}'.`
      );
    }
    if (action === 'halftime_match') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.halftimeMatch(id);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Zápas je v poločase.'
      );
    }
    if (action === 'resume_match') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      matchFixturesService.resumeMatchFromHalftime(id);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Zápas pokračuje od 45. minuty.'
      );
    }
    if (action === 'finish_match') {
      if (!Number.isFinite(id)) throw new Error('Neplatný zápas.');
      const managedBy =
        req.user && (req.user.display_name || req.user.email)
          ? String(req.user.display_name || req.user.email).trim()
          : '';
      matchFixturesService.finishMatch(id, managedBy);
      const editSuffix = page > 1 ? `&page=${page}` : '';
      return zapasyRedirect(
        res,
        `/administrace/zapasy/seznam?edit=${id}${editSuffix}`,
        'Zápas byl ukončen.'
      );
    }
    if (action === 'create') {
      matchFixturesService.create(req.body);
      return zapasyRedirect(res, '/administrace/zapasy/seznam', 'Zápas byl přidán.');
    }
    throw new Error('Neznámá akce.');
  } catch (e) {
    return renderZapasyMatches(req, res, {
      error: e && e.message ? e.message : 'Uložení se nezdařilo.',
      editId:
        ['update', 'start_match', 'postpone_match', 'cancel_match', 'save_lineup', 'add_match_event', 'save_first_half_extra', 'save_second_half_extra', 'halftime_match', 'resume_match', 'finish_match', 'set_match_clock'].includes(action) &&
        Number.isFinite(id)
          ? id
          : null,
    });
  }
});

/* --- Všechny články (Vedení + šéfredaktor) --- */
router.get('/administrace/clanky', requireRole('vedeni', 'sefredaktor'), (req, res) => {
  const perPage = 7;
  const allowedStatuses = ['draft', 'pending', 'published', 'scheduled'];
  const q = req.query.q != null ? String(req.query.q).trim() : '';
  const statusRaw = req.query.status != null ? String(req.query.status).trim() : '';
  const status = allowedStatuses.includes(statusRaw) ? statusRaw : '';
  const rawPage = parseInt(req.query.page, 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const filters = { q, status };
  const totalItems = articlesService.countAllForAdminFiltered(filters);
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;
  const articles = articlesService.listAllForAdminFilteredPaged(perPage, offset, filters);

  res.render('admin/clanky', {
    title: 'Články - administrace',
    articles,
    all: true,
    filters,
    statusOptions: allowedStatuses,
    pagination: {
      page,
      perPage,
      totalItems,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
  });
});

/* --- Moje články (redaktor) --- */
router.get('/administrace/moje-clanky', (req, res) => {
  if (!isRedaktorWorkflow(req.user)) {
    return res.redirect('/administrace/clanky');
  }
  const articles = articlesService.listForAuthor(req.user.id);
  res.render('admin/moje-clanky', { title: 'Moje články - administrace', articles, all: false });
});

/* --- Foták picker for articles --- */
router.get('/administrace/foto-alba', requireRole('vedeni', 'sefredaktor', 'redaktor'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const albums = foto.listAlbums({ q }).slice(0, 80).map((a) => ({
    id: a.id,
    title: a.title,
    date_label: a.date_label,
    photo_count: a.photo_count,
    photographer_name: a.photographer_name || '',
    credit: foto.photographerCredit(a.photographer_name),
    cover_url: a.cover_url,
  }));
  res.json({ albums });
});

router.get('/administrace/foto-hraci', requireRole('vedeni', 'sefredaktor', 'redaktor'), (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json({ players: foto.pickerPlayers(q) });
});

router.get('/administrace/foto-hraci/:id/fotky', requireRole('vedeni', 'sefredaktor', 'redaktor'), (req, res) => {
  const player = foto.pickerPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: 'Hráč nenalezen' });
  res.json({
    player,
    photos: foto.playerPhotos(player.id, 80).map((p) => ({
      id: p.id,
      album_id: p.album_id,
      album_title: p.album_title,
      thumbSrc: p.thumbSrc,
      viewSrc: p.viewSrc,
      photographer_name: p.photographer_name || '',
      credit: p.credit || foto.photographerCredit(p.photographer_name),
    })),
  });
});

router.get('/administrace/foto-alba/:id/fotky', requireRole('vedeni', 'sefredaktor', 'redaktor'), (req, res) => {
  const album = foto.getAlbum(req.params.id);
  if (!album) return res.status(404).json({ error: 'Album nenalezeno' });
  res.json({
    album: {
      id: album.id,
      title: album.title,
      date_label: album.date_label,
      photographer_name: album.photographer_name || '',
      credit: foto.photographerCredit(album.photographer_name),
    },
    photos: foto.listAlbumPhotos(album.id).map((p) => ({
      id: p.id,
      thumbSrc: p.thumbSrc,
      viewSrc: p.viewSrc,
      width: p.width,
      height: p.height,
    })),
  });
});

async function copyFotoForArticle(req, res, photo, album) {
  if (!photo || (album && photo.album_id !== album.id)) {
    return res.status(404).json({ error: 'Fotka nenalezena' });
  }
  const kind = String(req.body && req.body.kind) === 'hero' ? 'articles' : 'inline';
  ensureUploadDirs();
  const dest = path.join(publicUpload, kind);
  try {
    const result = await foto.copyPhotoForPublic(photo.id, dest, `/uploads/${kind}`);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({
      location: result.path,
      credit: result.credit,
      photographer: result.photographer,
    });
  } catch (err) {
    console.error('[11ka] foto copy for article failed:', err && err.message);
    return res.status(500).json({ error: 'Fotku se nepodařilo zkopírovat' });
  }
}

router.post(
  '/administrace/foto-fotky/:photoId/kopirovat',
  requireRole('vedeni', 'sefredaktor', 'redaktor'),
  express.json(),
  (req, res) => copyFotoForArticle(req, res, foto.getPhoto(req.params.photoId), null)
);

router.post(
  '/administrace/foto-alba/:id/fotky/:photoId/kopirovat',
  requireRole('vedeni', 'sefredaktor', 'redaktor'),
  express.json(),
  (req, res) => {
    const album = foto.getAlbum(req.params.id);
    const photo = foto.getPhoto(req.params.photoId);
    if (!album) return res.status(404).json({ error: 'Fotka nenalezena' });
    return copyFotoForArticle(req, res, photo, album);
  }
);

/* --- TinyMCE image upload --- */
router.post('/administrace/upload-inline', requireRole('vedeni', 'sefredaktor', 'redaktor'), (req, res, next) => {
  uploadInline.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: multerUserMessage(err) });
    if (!req.file) return res.status(400).json({ error: 'Žádný soubor' });
    next();
  });
}, optimizeUploadedFile, (req, res) => {
  const loc = '/uploads/inline/' + req.file.filename;
  res.json({ location: loc });
});

/* --- New article --- */
router.get('/administrace/clanek/novy', requireRole('vedeni', 'sefredaktor', 'redaktor'), async (req, res) => {
  const categories = CATEGORY_OPTIONS;
  const tags = adminTagOptions();
  const presetCategory = req.query.category != null ? String(req.query.category).trim() : '';
  const form =
    presetCategory && CATEGORY_OPTIONS.includes(presetCategory) ? { category: presetCategory } : null;
  await renderArticleEdit(res, {
    title: 'Nový článek - administrace',
    article: null,
    error: null,
    success: null,
    form,
    categories,
    tags,
    initialBlocks: [],
  });
});

router.post(
  '/administrace/clanek/novy',
  requireRole('vedeni', 'sefredaktor', 'redaktor'),
  (req, res, next) => {
    uploadHero.single('hero')(req, res, (err) => {
      if (err) {
        return renderArticleEdit(res, {
          title: 'Nový článek - administrace',
          article: null,
          error: multerUserMessage(err),
          success: null,
          form: req.body,
          categories: CATEGORY_OPTIONS,
          tags: adminTagOptions(),
        }, 400);
      }
      next();
    });
  },
  optimizeUploadedFile,
  (req, res) => {
    const { title, slug, excerpt, category, tag, sources, hero_credit, hero_position, hero_card_position, hero_slider_mobile_position, hero_slider_desktop_position, body_html, lineup_json } =
      req.body;
    const action = articleAction(req.body);
    const blocks = parseBlocksInput(req.body.body_blocks_json);
    const hasBlocks = blocks.length > 0;
    const blocksHtml = hasBlocks ? renderBlocksToHtml(blocks) : '';
    const bodyHtmlFinal = hasBlocks ? blocksHtml : body_html || '';
    const blocksJson = hasBlocks ? JSON.stringify(blocks) : null;
    const excerptNorm = normalizeExcerpt(excerpt);
    let error = articlesService.articleCopyError(title, excerptNorm);
    const pickedHero = isSafeHeroPickPath(req.body.hero_picked_path) ? String(req.body.hero_picked_path).trim() : null;
    const heroPath = req.file ? '/uploads/articles/' + req.file.filename : pickedHero;
    if (heroPath && (!hero_credit || !String(hero_credit).trim())) {
      error = 'U titulního obrázku je povinný credit.';
    }
    const lineupResolved = resolveLineupJson(lineup_json);
    if (!lineupResolved.ok) error = lineupResolved.error;
    if (error) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
      }
      return renderArticleEdit(res, {
        title: 'Nový článek - administrace',
        article: null,
        error,
        success: null,
        form: req.body,
        categories: CATEGORY_OPTIONS,
        tags: adminTagOptions(),
        initialBlocks: blocks,
      });
    }

    const article = articlesService.createArticle({
      author_id: resolveVedeniAuthorId(req, req.user.id),
      title,
      slug: slug || undefined,
      excerpt: excerptNorm,
      body_html: bodyHtmlFinal,
      body_blocks_json: blocksJson,
      hero_image_path: heroPath,
      hero_position: resolveHeroPosition(hero_position),
      hero_card_position: resolveHeroPositionChain(hero_card_position, hero_position),
      hero_slider_mobile_position: resolveHeroPositionChain(hero_slider_mobile_position, hero_position),
      hero_slider_desktop_position: resolveHeroPositionChain(hero_slider_desktop_position, hero_position),
      hero_credit: hero_credit || null,
      lineup_json: lineupResolved.lineupJson,
      sources: sources || null,
      category,
      tag,
      status: 'draft',
      ...communityFieldsFromBody(req.body),
    });

    const id = article.id;

    if (action === 'submit') {
      articlesService.updateArticle(id, { status: 'pending' });
    } else if (action === 'publish' && canPublish(req.user)) {
      articlesService.updateArticle(id, {
        status: 'published',
        hero_position: resolveHeroPosition(hero_position, article.hero_position),
      });
    } else if (action === 'schedule' && canPublish(req.user)) {
      const dt = req.body.scheduled_at;
      if (!dt) {
        return renderArticleEdit(res, {
          title: 'Nový článek - administrace',
          article: articlesService.getById(id),
          error: 'Vyplňte datum a čas plánované publikace.',
          success: null,
          form: req.body,
          categories: CATEGORY_OPTIONS,
          tags: adminTagOptions(),
          initialBlocks: blocks,
        });
      }
      const scheduleResolved = resolveScheduleIso(dt);
      if (!scheduleResolved.ok) {
        return renderArticleEdit(res, {
          title: 'Nový článek - administrace',
          article: articlesService.getById(id),
          error: scheduleResolved.error,
          success: null,
          form: req.body,
          categories: CATEGORY_OPTIONS,
          tags: adminTagOptions(),
          initialBlocks: blocks,
        });
      }
      articlesService.updateArticle(id, {
        status: 'scheduled',
        scheduled_at: scheduleResolved.iso,
        published_at: null,
      });
    }

    res.redirect('/administrace/clanek/' + id + '/edit?success=1');
  }
);

/* --- Edit article --- */
router.get('/administrace/clanek/:id/edit', requireRole('vedeni', 'sefredaktor', 'redaktor'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const article = articlesService.getById(id);
  if (!article) return res.status(404).send('Článek nenalezen');
  if (!canEditArticle(req.user, article)) return res.status(403).send('Nemáte oprávnění upravovat tento článek');

  await renderArticleEdit(res, {
    title: 'Upravit článek - administrace',
    article,
    error: null,
    success: req.query.ai
      ? 'AI přepis je vyplněný. Zkontroluj text, zdroje a případně vydej.'
      : req.query.success
        ? 'Uloženo.'
        : null,
    form: null,
    canDelete: canDeleteArticle(req.user, article),
    categories: CATEGORY_OPTIONS,
    tags: adminTagOptions(),
    initialBlocks: parseBlocksInput(article.body_blocks_json),
  });
});

router.post(
  '/administrace/clanek/:id/smazat',
  requireRole('vedeni', 'sefredaktor', 'redaktor'),
  express.urlencoded({ extended: true }),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const article = articlesService.getById(id);
    if (!article) return res.status(404).send('Článek nenalezen');
    if (!canDeleteArticle(req.user, article)) return res.status(403).send('Nemáte oprávnění smazat tento článek');
    articlesService.deleteArticleCompletely(id);
    if (isRedaktorWorkflow(req.user)) return res.redirect('/administrace/moje-clanky');
    return res.redirect('/administrace/clanky');
  }
);

router.post(
  '/administrace/clanek/:id/edit',
  requireRole('vedeni', 'sefredaktor', 'redaktor'),
  (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const article = articlesService.getById(id);
    if (!article) return res.status(404).send('Článek nenalezen');
    if (!canEditArticle(req.user, article)) return res.status(403).send('Nemáte oprávnění');
    req._article = article;
    uploadHero.single('hero')(req, res, (err) => {
      if (err) {
        return renderArticleEdit(res, {
          title: 'Upravit článek - administrace',
          article,
          error: multerUserMessage(err),
          success: null,
          form: req.body,
          categories: CATEGORY_OPTIONS,
          tags: adminTagOptions(),
          initialBlocks: parseBlocksInput(article.body_blocks_json),
        }, 400);
      }
      next();
    });
  },
  optimizeUploadedFile,
  (req, res) => {
    const article = req._article;
    const id = article.id;
    const { title, slug, excerpt, category, tag, sources, hero_credit, hero_position, hero_card_position, hero_slider_mobile_position, hero_slider_desktop_position, body_html, lineup_json } =
      req.body;
    const action = articleAction(req.body);
    const incomingBlocksRaw = req.body.body_blocks_json;
    const hasBlocksField = Object.prototype.hasOwnProperty.call(req.body, 'body_blocks_json');
    const blocks = parseBlocksInput(incomingBlocksRaw);
    const hasBlocks = blocks.length > 0;
    let bodyHtmlFinal = body_html || '';
    let bodyBlocksJsonPatch = undefined;
    if (hasBlocksField) {
      if (hasBlocks) {
        bodyHtmlFinal = renderBlocksToHtml(blocks);
        bodyBlocksJsonPatch = JSON.stringify(blocks);
      } else if (!String(incomingBlocksRaw || '').trim()) {
        bodyBlocksJsonPatch = null;
      }
    }
    const excerptNorm = normalizeExcerpt(excerpt);

    let hero_image_path = article.hero_image_path;
    const pickedHero = isSafeHeroPickPath(req.body.hero_picked_path) ? String(req.body.hero_picked_path).trim() : null;
    if (req.file) {
      hero_image_path = '/uploads/articles/' + req.file.filename;
      unlinkPublicUpload(article.hero_image_path);
    } else if (pickedHero && pickedHero !== article.hero_image_path) {
      hero_image_path = pickedHero;
      unlinkPublicUpload(article.hero_image_path);
    }

    let error = articlesService.articleCopyError(title, excerptNorm);
    if (hero_image_path && (!hero_credit || !String(hero_credit).trim())) {
      error = 'U titulního obrázku je povinný credit.';
    }
    const lineupResolved = resolveLineupJson(lineup_json);
    if (!lineupResolved.ok) error = lineupResolved.error;
    if (error) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
      }
      return renderArticleEdit(res, {
        title: 'Upravit článek - administrace',
        article: { ...article, ...req.body },
        error,
        success: null,
        form: req.body,
        categories: CATEGORY_OPTIONS,
        tags: adminTagOptions(),
        initialBlocks: blocks,
      });
    }

    let status = article.status;
    if (action === 'save') {
      if (article.status === 'pending' && isRedaktorWorkflow(req.user)) {
        /* redaktor cannot take back from pending in MVP */
      } else if (article.status === 'draft') {
        status = 'draft';
      }
    } else if (action === 'submit' && isRedaktorWorkflow(req.user) && article.status === 'draft') {
      status = 'pending';
    } else if (action === 'submit' && hasAnyRole(req.user, 'vedeni', 'sefredaktor')) {
      status = 'pending';
    } else if (action === 'publish' && canPublish(req.user)) {
      status = 'published';
    } else if (action === 'schedule' && canPublish(req.user)) {
      const dt = req.body.scheduled_at;
      if (!dt) {
        error = 'Vyplňte datum a čas plánované publikace.';
      } else {
        const scheduleResolved = resolveScheduleIso(dt);
        if (!scheduleResolved.ok) {
          error = scheduleResolved.error;
        } else {
          articlesService.updateArticle(id, {
            title,
            slug,
            excerpt: excerptNorm,
            category,
            tag,
            author_id: resolveVedeniAuthorId(req, article.author_id),
            hero_image_path,
            hero_position: resolveHeroPosition(hero_position, article.hero_position),
            hero_card_position: resolveHeroPositionChain(
              hero_card_position,
              article.hero_card_position,
              article.hero_position
            ),
            hero_slider_mobile_position: resolveHeroPositionChain(
              hero_slider_mobile_position,
              article.hero_slider_mobile_position,
              article.hero_position
            ),
            hero_slider_desktop_position: resolveHeroPositionChain(
              hero_slider_desktop_position,
              article.hero_slider_desktop_position,
              article.hero_position
            ),
            hero_credit,
            lineup_json: lineupResolved.lineupJson,
            sources: sources || null,
            body_html: bodyHtmlFinal,
            ...(bodyBlocksJsonPatch !== undefined ? { body_blocks_json: bodyBlocksJsonPatch } : {}),
            status: 'scheduled',
            scheduled_at: scheduleResolved.iso,
            published_at: null,
            ...communityFieldsFromBody(req.body),
          });
          return res.redirect('/administrace/clanek/' + id + '/edit?success=1');
        }
      }
    }

    if (error) {
      return renderArticleEdit(res, {
        title: 'Upravit článek - administrace',
        article: articlesService.getById(id),
        error,
        success: null,
        form: req.body,
        categories: CATEGORY_OPTIONS,
        tags: adminTagOptions(),
        initialBlocks: blocks,
      });
    }

    const patch = {
      title,
      slug,
      excerpt: excerptNorm,
      category,
      tag,
      author_id: resolveVedeniAuthorId(req, article.author_id),
      hero_image_path,
      hero_position: resolveHeroPosition(hero_position, article.hero_position),
      hero_card_position: resolveHeroPositionChain(
        hero_card_position,
        article.hero_card_position,
        article.hero_position
      ),
      hero_slider_mobile_position: resolveHeroPositionChain(
        hero_slider_mobile_position,
        article.hero_slider_mobile_position,
        article.hero_position
      ),
      hero_slider_desktop_position: resolveHeroPositionChain(
        hero_slider_desktop_position,
        article.hero_slider_desktop_position,
        article.hero_position
      ),
      hero_credit,
      lineup_json: lineupResolved.lineupJson,
      sources: sources || null,
      body_html: bodyHtmlFinal,
      ...(bodyBlocksJsonPatch !== undefined ? { body_blocks_json: bodyBlocksJsonPatch } : {}),
      status,
      ...communityFieldsFromBody(req.body),
    };

    if (action === 'publish' && canPublish(req.user)) {
      patch.status = 'published';
      patch.published_at = new Date().toISOString();
    }

    articlesService.updateArticle(id, patch);
    res.redirect('/administrace/clanek/' + id + '/edit?success=1');
  }
);

function renderRubrikyAdmin(req, res, extras = {}) {
  const editId = parseInt((req.query && req.query.id) || (req.body && req.body.id), 10);
  const items = rubricsService.listRubrics();
  const editingItem =
    extras.editingItem ||
    (Number.isFinite(editId) && extras.keepEdit !== false ? rubricsService.getById(editId) : null);
  res.render('admin/rubriky', {
    title: 'Rubriky - administrace',
    items,
    editingItem,
    authors: listArticleAuthors(),
    labelMax: rubricsService.LABEL_MAX,
    descMax: rubricsService.DESC_MAX,
    error: extras.error || null,
    success: extras.success || null,
  });
}

router.get('/administrace/rubriky', requireRole('vedeni', 'sefredaktor'), (req, res) => {
  const ok = String((req.query && req.query.ok) || '').trim();
  const success =
    ok === 'created' ? 'Rubrika je vytvořená.' : ok === 'saved' ? 'Rubrika je uložená.' : ok === 'deleted' ? 'Rubrika je smazaná.' : null;
  renderRubrikyAdmin(req, res, { success, keepEdit: ok ? false : undefined });
});

router.post('/administrace/rubriky', requireRole('vedeni', 'sefredaktor'), (req, res) => {
  const action = String(req.body.action || '').trim();
  const id = parseInt(req.body.id, 10);
  try {
    if (action === 'create') {
      rubricsService.createRubric({
        label: req.body.label,
        slug: req.body.slug,
        description: req.body.description,
        owner_user_id: req.body.owner_user_id,
        notify_enabled: req.body.notify_enabled === '1' || req.body.notify_enabled === 'on',
      });
      return res.redirect('/administrace/rubriky?ok=created');
    }
    if (action === 'update' && Number.isFinite(id)) {
      rubricsService.updateRubric(id, {
        label: req.body.label,
        description: req.body.description,
        owner_user_id: req.body.owner_user_id,
        notify_enabled: req.body.notify_enabled === '1' || req.body.notify_enabled === 'on',
      });
      return res.redirect('/administrace/rubriky?ok=saved');
    }
    if (action === 'delete' && Number.isFinite(id)) {
      rubricsService.removeRubric(id);
      return res.redirect('/administrace/rubriky?ok=deleted');
    }
    return renderRubrikyAdmin(req, res, { error: 'Neplatná akce.' });
  } catch (e) {
    const msg = e.code === 'INVALID' || e.code === 'NOT_FOUND' ? e.message : 'Uložení se nezdařilo.';
    return renderRubrikyAdmin(req, res, {
      error: msg,
      editingItem: action === 'update' && Number.isFinite(id) ? rubricsService.getById(id) : null,
    });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).send(multerUserMessage(err));
  }
  next(err);
});

module.exports = { router, ensureUploadDirs };

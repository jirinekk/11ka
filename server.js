const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '.env'),
  override: true,
});

const { isSmtpConfigured } = require('./services/mail');
if (!isSmtpConfigured()) {
  console.warn(
    '[11ka] SMTP není nastaven - e-maily (akreditace, newsletter) neodejdou. Doplňte SMTP_* v souboru .env (viz .env.example).'
  );
} else if (
  !process.env.NEWSLETTER_SMTP_PASS &&
  !process.env.ACCREDITATION_SMTP_PASS &&
  !String(process.env.SMTP_URL || '').includes('@')
) {
  console.warn('[11ka] SMTP_HOST je nastaven, ale chybí SMTP_PASS - doplňte hesla v .env.');
}

const fs = require('fs');
const express = require('express');
const { getMainNav } = require('./config/main-nav');
const { getGooglePreferredSourceCta } = require('./config/google-preferred-source');
const matchFixturesService = require('./services/match-fixtures');
const { formatPragueDateTime } = require('./lib/prague-datetime');
const compression = require('compression');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { initDb } = require('./db');
const articlesService = require('./services/articles');
const usersService = require('./services/users');
const siteRouter = require('./routes/site');
const authRouter = require('./routes/auth');
const ucetRouter = require('./routes/ucet');
const apiOembed = require('./routes/api-oembed');
const apiMostRead = require('./routes/api-most-read');
const apiPenalty = require('./routes/api-penalty');
const newsletterPublicRouter = require('./routes/newsletter-public');
const { router: adminRouter, ensureUploadDirs } = require('./routes/admin');
const { attachUser } = require('./middleware/auth');
const {
  hasRole,
  hasAnyRole,
  isAkreditaceOnly,
  isRedaktorWorkflow,
  formatRoles,
  ROLE_LABELS,
} = require('./lib/roles');
const { canAccessAiDrafts } = require('./config/ai-drafts');

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 1);
app.disable('x-powered-by');

// Pterodactyl obvykle nastavuje SERVER_PORT; lokálně se často používá PORT
const HOST = '0.0.0.0';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

function getAssetVersion() {
    const candidates = [
        path.join(__dirname, 'public', 'css', 'fonts.css'),
        path.join(__dirname, 'public', 'css', 'tailwind.generated.css'),
        path.join(__dirname, 'public', 'css', 'overrides.css'),
        path.join(__dirname, 'public', 'images', 'penalty-keeper.webp'),
        path.join(__dirname, 'public', 'images', 'penalty-keeper-dive-left.webp'),
        path.join(__dirname, 'public', 'images', 'penalty-keeper-dive-right.webp'),
        path.join(__dirname, 'public', 'images', 'penalty-keeper-dive-high.webp'),
        path.join(__dirname, 'public', 'images', 'penalty-ball.webp'),
        path.join(__dirname, 'public', 'js', 'penalty-game.js'),
        path.join(__dirname, 'public', 'js', 'recruitment-modal.js'),
        path.join(__dirname, 'public', 'js', 'consent-defaults.js'),
        path.join(__dirname, 'public', 'js', 'cookie-banner-ui.js'),
        path.join(__dirname, 'public', 'js', 'adblock-gate.js'),
        path.join(__dirname, 'public', 'js', 'ssp-zone-init.js'),
        path.join(__dirname, 'public', 'js', 'apply-dynamic-styles.js'),
        path.join(__dirname, 'public', 'js', 'inject-ld.js'),
    ];
    let newestMs = 0;
    for (const filePath of candidates) {
        try {
            const stat = fs.statSync(filePath);
            if (Number.isFinite(stat.mtimeMs)) {
                newestMs = Math.max(newestMs, Math.floor(stat.mtimeMs));
            }
        } catch {
            // ignore missing files and keep fallback
        }
    }
    if (newestMs > 0) return String(newestMs);
    return process.env.ASSET_VERSION || 'dev';
}

const ASSET_VERSION_TTL_MS =
    process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 30 * 1000;
let cachedAssetVersion = getAssetVersion();
let cachedAssetVersionAt = Date.now();

function resolveAssetVersion() {
    const now = Date.now();
    if (now - cachedAssetVersionAt < ASSET_VERSION_TTL_MS) {
        return cachedAssetVersion;
    }
    cachedAssetVersion = getAssetVersion();
    cachedAssetVersionAt = now;
    return cachedAssetVersion;
}

// DB + uploads bootstrap
initDb();
articlesService.seedDemoIfEmpty();
ensureUploadDirs();

// Session storage
const storageDir = path.join(__dirname, 'storage');
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

const sessionSecret = process.env.SESSION_SECRET || 'dev-change-me';

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(
    compression({
        threshold: 1024,
    })
);

app.use(express.urlencoded({ extended: true, limit: '1gb' }));
app.use(express.json({ limit: '64kb' }));

app.use(
    session({
        store: new SQLiteStore({
            db: 'sessions.sqlite',
            dir: storageDir,
        }),
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        proxy: true,
        cookie: {
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        },
    })
);

app.use(attachUser(usersService));
app.use((req, res, next) => {
    res.locals.currentUser = req.user || null;
    res.locals.hasRole = hasRole;
    res.locals.hasAnyRole = hasAnyRole;
    res.locals.isAkreditaceOnly = isAkreditaceOnly;
    res.locals.isRedaktorWorkflow = isRedaktorWorkflow;
    res.locals.formatRoles = formatRoles;
    res.locals.roleLabels = ROLE_LABELS;
    res.locals.canAccessAiDrafts = canAccessAiDrafts;
    res.locals.seoBaseUrl = 'https://11ka.cz';
    res.locals.googlePreferredSource = getGooglePreferredSourceCta({
        seoBaseUrl: res.locals.seoBaseUrl,
        siteName: process.env.GOOGLE_PREFERRED_SOURCE_SITE_NAME || '11ka',
        preferredSourceUrl: process.env.GOOGLE_PREFERRED_SOURCE_URL || null,
        followUrl: process.env.GOOGLE_NEWS_FOLLOW_URL || null,
        googleNewsUrl: process.env.GOOGLE_NEWS_URL || null,
    });
    res.locals.requestPath = req.path || '/';
    res.locals.googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION || null;
    res.locals.ga4MeasurementId = process.env.GA4_MEASUREMENT_ID || null;
    res.locals.googleAdsClient = process.env.GOOGLE_ADS_CLIENT || null;
    res.locals.googleAdsSlots = {
        home_top_728: process.env.GOOGLE_ADS_SLOT_HOME_TOP_728 || null,
        home_sidebar_300: process.env.GOOGLE_ADS_SLOT_HOME_SIDEBAR_300 || null,
        article_sidebar_300: process.env.GOOGLE_ADS_SLOT_ARTICLE_SIDEBAR_300 || null,
    };
    res.locals.assetVersion = resolveAssetVersion();
    res.locals.getMainNav = getMainNav;
    res.locals.formatPragueDateTime = formatPragueDateTime;
    try {
        res.locals.sidebarLiveFixtures = matchFixturesService
            .listPublishedLiveForWeb()
            .map((row) => matchFixturesService.formatForWeb(row));
    } catch {
        res.locals.sidebarLiveFixtures = [];
    }
    next();
});

app.use(
    express.static(path.join(__dirname, 'public'), {
        maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
        etag: true,
        setHeaders: (res, filePath) => {
            // HTML nikdy necacheovat dlouze, ostatní statiky ano.
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache');
                return;
            }
            // Versionované CSS/JS přes ?v=... mohou být immutable.
            if (/\.(css|js|mjs|map|png|jpg|jpeg|webp|avif|gif|svg|ico|woff2?)$/i.test(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
            }
        },
    })
);

// Public API (before admin router - admin applies requireLogin to all requests)
app.use('/api', apiOembed);
app.use('/api', apiMostRead);
app.use('/api', apiPenalty);

// Public + CMS routes
app.use(newsletterPublicRouter);
app.use(siteRouter);
app.use(authRouter);
app.use(ucetRouter);
app.use(adminRouter);

app.use((req, res) => {
    res.status(404).render('404', {
        title: 'Nenalezeno - 11ka',
        activeNav: 'home',
        showSearchLogin: true,
    });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Interní chyba serveru');
});

// Promote scheduled articles (and trigger newsletter hook via updateArticle)
try {
  articlesService.promoteScheduled();
} catch (e) {
  console.error(e);
}
setInterval(() => {
    try {
        articlesService.promoteScheduled();
    } catch (e) {
        console.error(e);
    }
}, 60 * 1000);

try {
  require('./services/ai-ingest').startFeedScheduler();
} catch (e) {
  console.error('[11ka] AI feed scheduler failed:', e && e.message);
}

try {
  const { warmSidebarInstagramCache } = require('./services/sidebar-instagram-feed');
  warmSidebarInstagramCache();
} catch (e) {
  console.error('[11ka] sidebar Instagram warm failed:', e && e.message);
}

process.on('uncaughtException', (err) => {
  console.error('[11ka] uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[11ka] unhandledRejection', err);
});

app.listen(PORT, HOST, () => {
    console.log(`11ka listening at http://localhost:${PORT}`);
});
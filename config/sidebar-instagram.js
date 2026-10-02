/** Elfsight widget ID (Instagram Feed). Free plan ~200 views/month - pak APP_VIEWS_LIMIT_REACHED. */
const DEFAULT_APP_ID = 'ba345739-7708-4176-87b7-ecc434958f55';

const APP_ID = String(process.env.ELFSIGHT_INSTAGRAM_APP_ID || DEFAULT_APP_ID)
  .trim()
  .replace(/^elfsight-app-/, '');

const PLATFORM_SCRIPT = 'https://static.elfsight.com/platform/platform.js';

const SOCIAL_LINKS = {
  facebook:
    'https://www.facebook.com/61577474076225/?http_ref=eyJ0cyI6MTc3NDU0NTUwOTAwMCwiciI6IiJ9',
  x: 'https://x.com/11kacz_?s=11&t=YiqAbAhyPJNs0MGi9gno8A',
  instagram: 'https://www.instagram.com/11kacz',
  medium: 'https://medium.seznam.cz/autor/11ka-33809',
};

/** Volitelné URL příspěvků (oddělené |), záloha když Elfsight neběží. */
function parsePostUrls() {
  const raw = String(process.env.INSTAGRAM_SIDEBAR_POSTS || '').trim();
  if (!raw) return [];
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function getSidebarInstagram() {
  const base = {
    links: SOCIAL_LINKS,
    platformScript: PLATFORM_SCRIPT,
    postUrls: parsePostUrls(),
  };

  const disabled =
    String(process.env.ELFSIGHT_INSTAGRAM_DISABLED || '').trim() === '1' ||
    String(process.env.ELFSIGHT_INSTAGRAM_DISABLED || '').trim().toLowerCase() === 'true';

  if (disabled || !APP_ID) {
    return {
      ...base,
      enabled: false,
      appId: '',
      appClass: '',
    };
  }

  return {
    ...base,
    enabled: true,
    appId: APP_ID,
    appClass: `elfsight-app-${APP_ID}`,
  };
}

module.exports = {
  getSidebarInstagram,
};

const { getSidebarInstagram } = require('../config/sidebar-instagram');
const { resolveOembedUrls } = require('../lib/oembed');

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache = { key: '', posts_html: [], at: 0, refreshing: false };

async function refreshSidebarInstagramCache(key, urls) {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    const posts_html = await resolveOembedUrls(urls);
    cache = { key, posts_html, at: Date.now(), refreshing: false };
  } catch (err) {
    console.error('[11ka] sidebar Instagram refresh:', err && err.message);
    cache.refreshing = false;
  }
}

async function getSidebarInstagramForView() {
  const base = getSidebarInstagram();
  const urls = Array.isArray(base.postUrls) ? base.postUrls : [];
  if (!urls.length) {
    return { ...base, posts_html: [] };
  }

  const key = urls.join('|');
  const now = Date.now();
  const hasCache = cache.key === key && Array.isArray(cache.posts_html);
  const cacheFresh = hasCache && cache.at && now - cache.at < CACHE_TTL_MS;

  if (cacheFresh) {
    return { ...base, posts_html: cache.posts_html };
  }

  if (hasCache) {
    refreshSidebarInstagramCache(key, urls);
    return { ...base, posts_html: cache.posts_html };
  }

  refreshSidebarInstagramCache(key, urls);
  return { ...base, posts_html: [] };
}

function warmSidebarInstagramCache() {
  getSidebarInstagramForView().catch((err) => {
    console.error('[11ka] sidebar Instagram warm:', err && err.message);
  });
}

module.exports = {
  getSidebarInstagramForView,
  warmSidebarInstagramCache,
};

function hostFromBaseUrl(baseUrl) {
  const raw = String(baseUrl || 'https://11ka.cz').trim();
  try {
    return new URL(raw).hostname.replace(/^www\./i, '');
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] || '11ka.cz';
  }
}

function getGooglePreferredSourceCta(options = {}) {
  const siteHost = options.siteHost || hostFromBaseUrl(options.seoBaseUrl);
  const siteName = options.siteName || '11ka';
  const encodedHost = encodeURIComponent(siteHost);
  const newsSearchUrl =
    options.googleNewsUrl ||
    `https://news.google.com/search?q=${encodedHost}&hl=cs-CZ&gl=CZ&ceid=CZ:cs`;

  return {
    siteHost,
    siteName,
    preferredSourceUrl:
      options.preferredSourceUrl || `https://www.google.com/preferences/source?q=${encodedHost}`,
    followUrl: options.followUrl || newsSearchUrl,
    googleNewsUrl: newsSearchUrl,
  };
}

module.exports = {
  getGooglePreferredSourceCta,
  hostFromBaseUrl,
};

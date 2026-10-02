const { parsePragueDatetimeLocal } = require('../lib/prague-datetime');

function getHomePromoPopup(options = {}) {
  const delayMs = Number.parseInt(
    options.delayMs || process.env.HOME_PROMO_POPUP_DELAY_MS || '0',
    10
  );

  return {
    enabled: options.enabled !== false && process.env.HOME_PROMO_POPUP_ENABLED !== '0',
    delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0,
    imageUrl:
      options.imageUrl ||
      process.env.HOME_PROMO_IMAGE_URL ||
      '/images/promo-soutez-koller-dres.png',
    imageAlt:
      options.imageAlt ||
      'Soutěž o podepsaný repre dres Jana Kollera – Definice fotbalu',
    brandName: options.brandName || 'Definice fotbalu',
    brandHandle: options.brandHandle || '@definicefotbalu',
    brandLogoUrl:
      options.brandLogoUrl ||
      process.env.HOME_PROMO_BRAND_LOGO_URL ||
      '/images/definice-fotbalu-logo.png',
    brandUrl:
      options.brandUrl ||
      process.env.HOME_PROMO_BRAND_URL ||
      'https://www.instagram.com/definicefotbalu/',
    title:
      options.title ||
      '🏆 SOUTĚŽ O PODEPSANÝ REPRE DRES JANEM KOLLEREM🔥',
    conditionsLabel: options.conditionsLabel || 'Podmínky soutěže:',
    conditions: options.conditions || [
      {
        text: '1️⃣ Sledovat náš profil ',
        link: { label: '@definicefotbalu', href: 'https://www.instagram.com/definicefotbalu/' },
      },
      {
        text: '2️⃣ Sledovat profil ',
        link: { label: '@11kacz', href: 'https://www.instagram.com/11kacz/' },
      },
      {
        text: '3️⃣ Do komentářů označ kamaráda, se kterým sleduješ Mistrovství světa 2026',
      },
    ],
    outro: options.outro || 'Přejeme hodně štěstí! 🤞',
    countdownLabel: options.countdownLabel || 'Zbývá do vyhlášení',
    countdownEndsAt:
      options.countdownEndsAt ||
      parsePragueDatetimeLocal(process.env.HOME_PROMO_COUNTDOWN_ENDS_AT || '2026-07-11T18:00'),
    countdownLiveUntil:
      options.countdownLiveUntil ||
      parsePragueDatetimeLocal(process.env.HOME_PROMO_COUNTDOWN_LIVE_UNTIL || '2026-07-12T18:00'),
    countdownLiveMessage:
      options.countdownLiveMessage || 'Vyhlášení právě probíhá na Instagramu',
    countdownPastMessage:
      options.countdownPastMessage || 'Vyhlášení proběhlo na Instagramu',
    ctaLabel: options.ctaLabel || 'Přejít na Instagram',
    ctaUrl:
      options.ctaUrl ||
      process.env.HOME_PROMO_INSTAGRAM_URL ||
      'https://www.instagram.com/definicefotbalu/',
  };
}

module.exports = {
  getHomePromoPopup,
};

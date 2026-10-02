(() => {
  const STORAGE_KEY = '11ka.cookieConsent';
  const FORCE_OPEN_KEY = '11ka.cookieConsent.forceOpen';
  const ACCEPTED_VALUE = 'accepted';
  const REJECTED_VALUE = 'rejected';
  let lastActiveElement = null;

  function safeGetConsent() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function safeSetConsent(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
  }

  function safeGetForceOpen() {
    try {
      return window.sessionStorage.getItem(FORCE_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  function safeSetForceOpen(enabled) {
    try {
      if (enabled) window.sessionStorage.setItem(FORCE_OPEN_KEY, '1');
      else window.sessionStorage.removeItem(FORCE_OPEN_KEY);
    } catch {
      /* ignore */
    }
  }

  function hideBanner() {
    const el = document.getElementById('cookie-banner');
    if (!el) return;
    el.classList.add('hidden');
    el.removeEventListener('keydown', trapFocus);
    toggleOpenersExpanded(false);
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
    lastActiveElement = null;
  }

  function showBanner() {
    const el = document.getElementById('cookie-banner');
    if (!el) return;
    lastActiveElement = document.activeElement;
    el.classList.remove('hidden');
    toggleOpenersExpanded(true);
    el.addEventListener('keydown', trapFocus);
  }

  function toggleOpenersExpanded(expanded) {
    const settingsOpeners = document.querySelectorAll('[data-cookie-settings-open]');
    settingsOpeners.forEach((el) => {
      el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  function getFocusable(root) {
    if (!root) return [];
    return Array.from(
      root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null);
  }

  function trapFocus(e) {
    const banner = document.getElementById('cookie-banner');
    if (!banner || banner.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      hideBanner();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(banner);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function applyConsentMode(consent) {
    if (typeof window.gtag !== 'function') return;
    const granted = consent === ACCEPTED_VALUE;
    window.gtag('consent', 'update', {
      ad_storage: granted ? 'granted' : 'denied',
      ad_user_data: granted ? 'granted' : 'denied',
      ad_personalization: granted ? 'granted' : 'denied',
      analytics_storage: granted ? 'granted' : 'denied',
    });
  }

  /**
   * Načte GA4 (gtag.js) a/nebo AdSense až po souhlasu. Do té doby se tyto skripty
   * vůbec nestáhnou - fronta window.adsbygoogle.push zůstane v paměti a zpracuje
   * se po načtení adsbygoogle.js (standardní chování).
   */
  function loadMarketingScriptsIfAccepted(consent) {
    if (consent !== ACCEPTED_VALUE) return;
    if (window.__11kaMarketingLoaded) return;
    const gaId = window.__11kaGa4Id;
    const adsId = window.__11kaAdsClientId;
    const hasGa = typeof gaId === 'string' && gaId.length > 0;
    const hasAds = typeof adsId === 'string' && adsId.length > 0;
    if (!hasGa && !hasAds) return;
    window.__11kaMarketingLoaded = true;

    if (hasGa) {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
      s.onload = function () {
        applyConsentMode(ACCEPTED_VALUE);
        window.gtag('js', new Date());
        window.gtag('config', gaId);
      };
      s.onerror = function () {
        /* ignore */
      };
      document.head.appendChild(s);
    }

    if (hasAds) {
      const s = document.createElement('script');
      s.async = true;
      s.src =
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
        encodeURIComponent(adsId);
      s.crossOrigin = 'anonymous';
      s.onerror = function () {
        /* ignore */
      };
      document.head.appendChild(s);
    }
  }

  function init() {
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;

    const acceptBtn = document.getElementById('cookie-accept');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        safeSetConsent(ACCEPTED_VALUE);
        safeSetForceOpen(false);
        loadMarketingScriptsIfAccepted(ACCEPTED_VALUE);
        hideBanner();
      });
    }

    const rejectBtn = document.getElementById('cookie-reject');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => {
        safeSetConsent(REJECTED_VALUE);
        safeSetForceOpen(false);
        applyConsentMode(REJECTED_VALUE);
        hideBanner();
      });
    }

    const settingsOpeners = document.querySelectorAll('[data-cookie-settings-open]');
    if (settingsOpeners.length) {
      settingsOpeners.forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          safeSetForceOpen(true);
          showBanner();
        });
      });
    }

    const consent = safeGetConsent();
    const forceOpen = safeGetForceOpen();
    if (consent === ACCEPTED_VALUE || consent === REJECTED_VALUE) {
      if (consent === ACCEPTED_VALUE) {
        loadMarketingScriptsIfAccepted(ACCEPTED_VALUE);
      } else {
        applyConsentMode(REJECTED_VALUE);
      }
      if (forceOpen) showBanner();
      else hideBanner();
      return;
    }

    showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


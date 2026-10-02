(() => {
  const STORAGE_KEY = '11ka.cookieConsent';
  const ACCEPTED_VALUE = 'accepted';
  const REJECTED_VALUE = 'rejected';
  let lastActiveElement = null;
  let trapBound = false;

  function safeGetConsent() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function hasStoredChoice() {
    const consent = safeGetConsent();
    return consent === ACCEPTED_VALUE || consent === REJECTED_VALUE;
  }

  function syncCloseButton() {
    if (window.__11kaCookieUi && typeof window.__11kaCookieUi.updateCloseButton === 'function') {
      window.__11kaCookieUi.updateCloseButton();
    }
  }

  function hideBanner() {
    const el = document.getElementById('cookie-banner');
    if (!el) return;
    el.classList.remove('cookie-banner--open');
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('data-cookie-manual-open');
    if (trapBound) {
      el.removeEventListener('keydown', trapFocus);
      trapBound = false;
    }
    toggleOpenersExpanded(false);
    syncCloseButton();
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
    lastActiveElement = null;
  }

  function showBanner(manualOpen) {
    const el = document.getElementById('cookie-banner');
    if (!el) return;
    lastActiveElement = document.activeElement;
    if (manualOpen) {
      el.setAttribute('data-cookie-manual-open', 'true');
    } else {
      el.removeAttribute('data-cookie-manual-open');
    }
    el.classList.add('cookie-banner--open');
    el.setAttribute('aria-hidden', 'false');
    toggleOpenersExpanded(true);
    syncCloseButton();
    try {
      window.dispatchEvent(
        new CustomEvent('11ka-consent-open', { detail: { manual: !!manualOpen } })
      );
    } catch {
      /* ignore */
    }
    if (!trapBound) {
      el.addEventListener('keydown', trapFocus);
      trapBound = true;
    }
    window.requestAnimationFrame(function () {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }

  function toggleOpenersExpanded(expanded) {
    document.querySelectorAll('[data-cookie-settings-open]').forEach((el) => {
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
    if (!banner || !banner.classList.contains('cookie-banner--open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      const closeBtn = document.getElementById('cookie-banner-close');
      const canClose =
        hasStoredChoice() || banner.getAttribute('data-cookie-manual-open') === 'true';
      if (canClose) hideBanner();
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
      document.head.appendChild(s);
    }

    if (hasAds) {
      const s = document.createElement('script');
      s.async = true;
      s.src =
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
        encodeURIComponent(adsId);
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
    }
  }

  function applyChoice(choice) {
    if (choice === ACCEPTED_VALUE) {
      loadMarketingScriptsIfAccepted(ACCEPTED_VALUE);
    } else if (choice === REJECTED_VALUE) {
      applyConsentMode(REJECTED_VALUE);
    }
  }

  function init() {
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;

    applyChoice(safeGetConsent());

    window.addEventListener('11ka-consent-change', function (e) {
      const choice = e.detail && e.detail.choice;
      applyChoice(choice);
      syncCloseButton();
    });

    document.addEventListener('click', function (e) {
      const opener = e.target.closest('[data-cookie-settings-open]');
      if (!opener) return;
      e.preventDefault();
      showBanner(true);
    });

    if (hasStoredChoice()) {
      hideBanner();
      try {
        window.dispatchEvent(new CustomEvent('11ka-recruitment-boot'));
      } catch {
        /* ignore */
      }
    } else {
      showBanner(false);
    }
  }

  window.__11kaCookieConsent = {
    show: function (manual) {
      showBanner(!!manual);
    },
    hide: hideBanner,
    hasChoice: hasStoredChoice,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

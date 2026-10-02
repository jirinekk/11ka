(function () {
  var modal = document.querySelector('[data-recruitment-modal]');
  if (!modal) return;

  var STORAGE_KEY = '11ka.recruitmentDismissed';
  var isClosing = false;
  var openTimer = null;
  var savedScrollY = 0;
  var dismissed = false;

  function readDismissed() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (_e) {
      return false;
    }
  }

  function markDismissed() {
    dismissed = true;
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch (_e) {
      /* ignore */
    }
  }

  dismissed = readDismissed();

  function hideCookieBanner() {
    if (window.__11kaCookieConsent && typeof window.__11kaCookieConsent.hide === 'function') {
      window.__11kaCookieConsent.hide();
      return;
    }
    if (window.__11kaCookieUi && typeof window.__11kaCookieUi.closeBanner === 'function') {
      window.__11kaCookieUi.closeBanner();
    }
  }

  function lockScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add('recruitment-modal-open');
    document.body.classList.add('recruitment-modal-open');
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockScroll() {
    document.documentElement.classList.remove('recruitment-modal-open');
    document.body.classList.remove('recruitment-modal-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
  }

  function preventBackgroundScroll(e) {
    if (!modal.classList.contains('recruitment-modal--open')) return;
    var card = modal.querySelector('.recruitment-modal-card');
    if (card && card.contains(e.target)) return;
    e.preventDefault();
  }

  function closeModal() {
    if (isClosing || !modal.classList.contains('recruitment-modal--open')) return;
    isClosing = true;
    modal.classList.remove('recruitment-modal--open');
    modal.setAttribute('aria-hidden', 'true');
    unlockScroll();
    markDismissed();
    if (openTimer) {
      window.clearTimeout(openTimer);
      openTimer = null;
    }
    isClosing = false;
  }

  function openModal() {
    if (dismissed || modal.classList.contains('recruitment-modal--open')) return;
    hideCookieBanner();
    lockScroll();
    modal.classList.add('recruitment-modal--open');
    modal.setAttribute('aria-hidden', 'false');
    var focusTarget = modal.querySelector('[data-recruitment-focus]');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      window.setTimeout(function () {
        focusTarget.focus();
      }, 50);
    }
  }

  function scheduleOpen() {
    if (dismissed) return;
    if (openTimer) window.clearTimeout(openTimer);
    openTimer = window.setTimeout(function () {
      openTimer = null;
      openModal();
    }, 400);
  }

  modal.querySelectorAll('[data-recruitment-close]').forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('recruitment-modal--open')) {
      closeModal();
    }
  });

  document.addEventListener('wheel', preventBackgroundScroll, { passive: false });
  document.addEventListener('touchmove', preventBackgroundScroll, { passive: false });

  if (!dismissed) {
    scheduleOpen();
    window.addEventListener('pageshow', function () {
      if (dismissed) return;
      scheduleOpen();
    });
  }
})();

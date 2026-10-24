(function () {
  var modal = document.querySelector('[data-whats-new]');
  if (!modal) return;

  var version = modal.getAttribute('data-whats-new-version') || '1';
  var STORAGE_KEY = '11ka.whatsNew.' + version;
  var isClosing = false;
  var savedScrollY = 0;
  var dismissed = false;
  var openTimer = null;

  function readDismissed() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_e) {
      return false;
    }
  }

  function markDismissed() {
    dismissed = true;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
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
    document.documentElement.classList.add('whats-new-open');
    document.body.classList.add('whats-new-open');
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockScroll() {
    document.documentElement.classList.remove('whats-new-open');
    document.body.classList.remove('whats-new-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
  }

  function preventBackgroundScroll(e) {
    if (!modal.classList.contains('whats-new--open')) return;
    var card = modal.querySelector('.whats-new__card');
    if (card && card.contains(e.target)) return;
    e.preventDefault();
  }

  function closeModal() {
    if (isClosing || !modal.classList.contains('whats-new--open')) return;
    isClosing = true;
    modal.classList.remove('whats-new--open');
    modal.setAttribute('aria-hidden', 'true');
    unlockScroll();
    markDismissed();
    if (openTimer) {
      window.clearTimeout(openTimer);
      openTimer = null;
    }
    isClosing = false;
    try {
      document.dispatchEvent(new CustomEvent('11ka:whats-new-closed'));
    } catch (_e) {
      /* ignore */
    }
  }

  function openModal() {
    if (dismissed || modal.classList.contains('whats-new--open')) return;
    hideCookieBanner();
    lockScroll();
    modal.classList.add('whats-new--open');
    modal.setAttribute('aria-hidden', 'false');
    var focusTarget = modal.querySelector('[data-whats-new-focus]');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      window.setTimeout(function () {
        focusTarget.focus();
      }, 50);
    }
  }

  modal.querySelectorAll('[data-whats-new-close]').forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('whats-new--open')) {
      closeModal();
    }
  });

  document.addEventListener('wheel', preventBackgroundScroll, { passive: false });
  document.addEventListener('touchmove', preventBackgroundScroll, { passive: false });

  if (!dismissed) {
    openTimer = window.setTimeout(function () {
      openTimer = null;
      openModal();
    }, 400);
  }
})();

(function () {
  var KEY = '11ka.cookieConsent';
  var ACCEPT = 'accepted';
  var REJECT = 'rejected';

  function getConsent() {
    try {
      return window.localStorage.getItem(KEY);
    } catch (_e) {
      return null;
    }
  }

  function hasChoice() {
    var c = getConsent();
    return c === ACCEPT || c === REJECT;
  }

  function updateCloseButton() {
    var closeBtn = document.getElementById('cookie-banner-close');
    var el = document.getElementById('cookie-banner');
    if (!closeBtn || !el) return;
    var manual = el.getAttribute('data-cookie-manual-open') === 'true';
    closeBtn.hidden = !(hasChoice() || manual);
  }

  function closeBanner() {
    var el = document.getElementById('cookie-banner');
    if (!el) return;
    el.classList.remove('cookie-banner--open');
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('data-cookie-manual-open');
    updateCloseButton();
    try {
      window.dispatchEvent(new CustomEvent('11ka-consent-close'));
    } catch (_e) {}
  }

  function updateChoiceUi(choice) {
    document.querySelectorAll('[data-cookie-choice]').forEach(function (btn) {
      var on = btn.getAttribute('data-cookie-choice') === choice;
      btn.classList.toggle('cookie-banner__choice--selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var status = document.getElementById('cookie-banner-status');
    if (!status) return;
    if (choice === ACCEPT) {
      status.hidden = false;
      status.textContent = 'Děkujeme - souhlas byl uložen.';
    } else if (choice === REJECT) {
      status.hidden = false;
      status.textContent = 'Vaše volba byla uložena.';
    } else {
      status.hidden = true;
      status.textContent = '';
    }
    updateCloseButton();
  }

  function setChoice(choice) {
    if (choice !== ACCEPT && choice !== REJECT) return;
    try {
      window.localStorage.setItem(KEY, choice);
    } catch (_e) {}
    updateChoiceUi(choice);
    try {
      window.dispatchEvent(
        new CustomEvent('11ka-consent-change', { detail: { choice: choice } })
      );
    } catch (_e2) {}
    closeBanner();
  }

  var banner = document.getElementById('cookie-banner');
  if (!banner) return;

  banner.addEventListener('click', function (e) {
    if (e.target.closest('[data-cookie-close]')) {
      e.preventDefault();
      if (window.__11kaCookieConsent && typeof window.__11kaCookieConsent.hide === 'function') {
        window.__11kaCookieConsent.hide();
      } else {
        closeBanner();
      }
      return;
    }
    var btn = e.target.closest('[data-cookie-choice]');
    if (!btn) return;
    e.preventDefault();
    setChoice(btn.getAttribute('data-cookie-choice'));
  });

  window.addEventListener('11ka-consent-open', function () {
    updateCloseButton();
  });

  var stored = getConsent();
  if (stored === ACCEPT || stored === REJECT) {
    updateChoiceUi(stored);
  } else {
    banner.classList.add('cookie-banner--open');
    banner.setAttribute('aria-hidden', 'false');
    updateCloseButton();
  }

  window.__11kaCookieUi = {
    updateCloseButton: updateCloseButton,
    closeBanner: closeBanner,
  };
})();

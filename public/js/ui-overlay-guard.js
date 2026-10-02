(function () {
  function releaseStuckScrollLocks() {
    var header = document.querySelector('[data-header11]');
    var menu = document.querySelector('[data-mobile-menu]');
    var menuOpen = header && header.classList.contains('header11--menu-open');
    var menuVisible = menu && menu.getAttribute('aria-hidden') === 'false';
    if (!menuOpen || !menuVisible) {
      document.body.classList.remove('header11-menu-lock');
    }

    var recruitment = document.querySelector('[data-recruitment-modal]');
    var recruitmentOpen = recruitment && recruitment.classList.contains('recruitment-modal--open');
    var overlayScrollLocked = recruitmentOpen;

    if (recruitment && !recruitmentOpen) {
      document.documentElement.classList.remove('recruitment-modal-open');
      document.body.classList.remove('recruitment-modal-open');
    }

    if (!overlayScrollLocked && document.body.style.position === 'fixed') {
      var top = parseInt(document.body.style.top || '0', 10);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      if (!Number.isNaN(top)) window.scrollTo(0, Math.abs(top));
    }

    var gate = document.getElementById('adblock-gate');
    if (!gate || gate.classList.contains('hidden')) {
      if (document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.overflow = '';
      }
      if (document.body.style.overflow === 'hidden') {
        var menuLocked = document.body.classList.contains('header11-menu-lock');
        if (!menuLocked && !overlayScrollLocked) document.body.style.overflow = '';
      }
    }
  }

  function closeMobileMenu() {
    var header = document.querySelector('[data-header11]');
    var menu = document.querySelector('[data-mobile-menu]');
    if (!header || !menu) return;
    header.classList.remove('header11--menu-open');
    header.classList.remove('header11--search-open');
    document.body.classList.remove('header11-menu-lock');
    menu.setAttribute('aria-hidden', 'true');
    menu.setAttribute('inert', '');
    var menuOpenBtn = header.querySelector('[data-mobile-menu-open]');
    if (menuOpenBtn) menuOpenBtn.setAttribute('aria-expanded', 'false');
    var searchWrap = header.querySelector('[data-mobile-search-wrap]');
    if (searchWrap) {
      searchWrap.hidden = true;
      searchWrap.setAttribute('aria-hidden', 'true');
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeMobileMenu();
    releaseStuckScrollLocks();
  });

  window.addEventListener('pageshow', releaseStuckScrollLocks);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) releaseStuckScrollLocks();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', releaseStuckScrollLocks);
  } else {
    releaseStuckScrollLocks();
  }
})();

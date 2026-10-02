(function () {
  var header = document.querySelector('[data-header11]');
  if (!header) return;

  window.addEventListener(
    'scroll',
    function () {
      header.classList.toggle('header11--scrolled', window.scrollY > 8);
    },
    { passive: true }
  );
  header.classList.toggle('header11--scrolled', window.scrollY > 8);

  var track = header.querySelector('[data-nav-track]');
  var glider = header.querySelector('[data-nav-glider]');
  var links = header.querySelectorAll('[data-nav-link]');

  function moveGlider(el) {
    if (!glider || !track || !el) return;
    glider.style.width = el.offsetWidth + 'px';
    glider.style.height = el.offsetHeight + 'px';
    glider.style.transform = 'translate(' + el.offsetLeft + 'px, ' + el.offsetTop + 'px)';
    glider.style.opacity = '1';
  }

  function resetGlider() {
    var active = header.querySelector('[data-nav-link].header11__link--active');
    if (active) moveGlider(active);
    else if (glider) glider.style.opacity = '0';
  }

  function gliderEnabled() {
    return window.matchMedia('(min-width: 1024px)').matches;
  }

  links.forEach(function (link) {
    link.addEventListener('mouseenter', function () {
      if (gliderEnabled()) moveGlider(link);
    });
    link.addEventListener('focus', function () {
      if (gliderEnabled()) moveGlider(link);
    });
  });
  if (track) {
    track.addEventListener('mouseleave', function () {
      if (gliderEnabled()) resetGlider();
    });
  }
  function scrollActiveNavIntoView() {
    var nav = header.querySelector('.header11__nav');
    if (!nav || nav.offsetParent === null) return;
    var active = header.querySelector('[data-nav-link].header11__link--active');
    if (!active) return;
    var navRect = nav.getBoundingClientRect();
    var linkRect = active.getBoundingClientRect();
    if (linkRect.left < navRect.left + 4 || linkRect.right > navRect.right - 4) {
      active.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
    }
  }

  var desktopSearchInput = header.querySelector('.header11__search--desktop .header11__search-input');
  var searchInputFocused = false;

  function hideGlider() {
    if (glider) glider.style.opacity = '0';
  }

  if (desktopSearchInput) {
    desktopSearchInput.addEventListener('focus', function () {
      searchInputFocused = true;
      header.classList.add('header11--search-focus');
      hideGlider();
    });
    desktopSearchInput.addEventListener('blur', function () {
      searchInputFocused = false;
      header.classList.remove('header11--search-focus');
      syncNavUi();
    });
  }

  function syncNavUi() {
    if (gliderEnabled()) {
      resetGlider();
    } else if (glider) {
      glider.style.opacity = '0';
    }
    scrollActiveNavIntoView();
  }

  syncNavUi();
  function closeMobileUi() {
    setMenu(false);
    setMobileSearch(false);
  }

  window.addEventListener('resize', function () {
    if (window.matchMedia('(min-width: 768px)').matches) {
      closeMobileUi();
    }
    if (!searchInputFocused) syncNavUi();
    else scrollActiveNavIntoView();
  }, { passive: true });

  var menuOpenBtn = header.querySelector('[data-mobile-menu-open]');
  var menu = document.querySelector('[data-mobile-menu]');
  var menuCloseEls = menu ? menu.querySelectorAll('[data-mobile-menu-close]') : [];
  var searchToggle = header.querySelector('[data-mobile-search-toggle]');
  var searchWrap = header.querySelector('[data-mobile-search-wrap]');
  var searchInput = searchWrap ? searchWrap.querySelector('[data-mobile-search-input]') : null;

  function setMenu(open) {
    header.classList.toggle('header11--menu-open', open);
    if (menuOpenBtn) {
      menuOpenBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuOpenBtn.classList.toggle('header11__icon-btn--active', open);
    }
    if (!menu) return;
    menu.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) menu.removeAttribute('inert');
    else menu.setAttribute('inert', '');
    document.body.classList.toggle('header11-menu-lock', open);
  }

  function setMobileSearch(open) {
    header.classList.toggle('header11--search-open', open);
    if (searchToggle) {
      searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      searchToggle.classList.toggle('header11__icon-btn--active', open);
      if (!open && typeof searchToggle.blur === 'function') {
        searchToggle.blur();
      }
    }
    if (searchWrap) {
      searchWrap.hidden = !open;
      searchWrap.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if (open && searchInput) {
      window.requestAnimationFrame(function () {
        searchInput.focus();
      });
    }
  }

  if (searchToggle && searchWrap) {
    searchToggle.addEventListener('click', function () {
      var willOpen = !header.classList.contains('header11--search-open');
      if (willOpen && header.classList.contains('header11--menu-open')) {
        setMenu(false);
      }
      setMobileSearch(willOpen);
    });
  }

  if (menuOpenBtn) {
    menuOpenBtn.addEventListener('click', function () {
      var willOpen = !header.classList.contains('header11--menu-open');
      if (willOpen && header.classList.contains('header11--search-open')) {
        setMobileSearch(false);
      }
      setMenu(willOpen);
    });
  }
  menuCloseEls.forEach(function (el) {
    el.addEventListener('click', function () {
      setMenu(false);
      if (menuOpenBtn) menuOpenBtn.focus();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      setMenu(false);
      setMobileSearch(false);
    }
  });
})();

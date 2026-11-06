(function () {
  var DESKTOP = window.matchMedia('(min-width: 1100px)');
  var PAIRS = [
    { root: '.site-shell', main: '.site-shell__main', rail: '.site-shell__rail' },
    { root: '.article-layout', main: '.article-main', rail: '.article-sidebar' },
    { root: '.fm-shell', main: '.fm-main', rail: '.fm-rail--right' },
    { root: '.fm-shell', main: '.fm-main', rail: '.fm-rail--left' },
    { root: '.mc-layout', main: '.mc-layout__main', rail: '.mc-layout__rail' }
  ];
  var fitting = false;
  var timer = 0;

  function blocksOf(rail) {
    return Array.prototype.filter.call(rail.children, function (el) {
      return el.nodeType === 1;
    });
  }

  function restore(rail) {
    Array.prototype.forEach.call(rail.querySelectorAll('[data-rail-hidden]'), function (el) {
      el.removeAttribute('data-rail-hidden');
      el.hidden = false;
    });
    rail.style.removeProperty('max-height');
    rail.style.removeProperty('overflow');
  }

  function pickHide(blocks) {
    var visible = blocks.filter(function (el) {
      return !el.hasAttribute('data-rail-hidden') && !el.hasAttribute('data-rail-keep');
    });
    if (visible.length <= 0) return null;
    var remaining = blocks.filter(function (el) {
      return !el.hasAttribute('data-rail-hidden');
    });
    if (remaining.length <= 1) return null;
    var low = visible.filter(function (el) {
      return el.getAttribute('data-rail-priority') === 'low';
    });
    if (low.length) return low[low.length - 1];
    return visible[visible.length - 1];
  }

  function height(el) {
    return el.getBoundingClientRect().height;
  }

  function fitOne(root, mainSel, railSel) {
    var main = root.querySelector(mainSel);
    var rail = root.querySelector(railSel);
    if (!main || !rail) return;
    restore(rail);
    if (!DESKTOP.matches) return;

    var blocks = blocksOf(rail);
    if (!blocks.length) return;

    var slack = 8;
    var guard = 0;
    while (height(rail) > height(main) + slack && guard < 24) {
      guard += 1;
      var hide = pickHide(blocks);
      if (!hide) break;
      hide.setAttribute('data-rail-hidden', '1');
      hide.hidden = true;
    }

    if (height(rail) > height(main) + slack) {
      rail.style.maxHeight = Math.max(0, Math.round(height(main))) + 'px';
      rail.style.overflow = 'hidden';
    }
  }

  function fitAll() {
    if (fitting) return;
    fitting = true;
    try {
      PAIRS.forEach(function (pair) {
        document.querySelectorAll(pair.root).forEach(function (root) {
          fitOne(root, pair.main, pair.rail);
        });
      });
    } finally {
      fitting = false;
    }
  }

  function schedule() {
    if (!fitting) fitAll();
    clearTimeout(timer);
    timer = setTimeout(function () {
      fitAll();
    }, 120);
  }

  function bindMedia(root) {
    if (!root) return;
    root.querySelectorAll('img, iframe, embed').forEach(function (el) {
      if (el.getAttribute('data-rail-bound') === '1') return;
      el.setAttribute('data-rail-bound', '1');
      el.addEventListener('load', schedule);
    });
  }

  function observe() {
    document.querySelectorAll('.site-shell, .article-layout, .fm-shell, .mc-layout').forEach(function (root) {
      bindMedia(root);
    });

    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        if (fitting) return;
        document.querySelectorAll('.site-shell, .article-layout, .fm-shell, .mc-layout').forEach(bindMedia);
        schedule();
      });
      document.querySelectorAll('.site-shell__rail, .article-sidebar, .fm-rail, .mc-layout__rail').forEach(function (rail) {
        mo.observe(rail, { childList: true, subtree: true });
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        if (fitting) return;
        schedule();
      });
      document.querySelectorAll('.site-shell__main, .article-main, .fm-main, .mc-layout__main').forEach(function (el) {
        ro.observe(el);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      observe();
      schedule();
    });
  } else {
    observe();
    schedule();
  }

  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  if (DESKTOP.addEventListener) DESKTOP.addEventListener('change', schedule);
  else if (DESKTOP.addListener) DESKTOP.addListener(schedule);
})();

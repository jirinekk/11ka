(function () {
  function own(root, sel) {
    return Array.prototype.filter.call(root.querySelectorAll(sel), function (el) {
      return el.closest('[data-cl-hub], [data-cl-matches], [data-mc-hub]') === root;
    });
  }

  function activeScroller(root) {
    var pane = own(root, '[data-cl-pane].is-active')[0] || own(root, '[data-cl-pane]')[0];
    return pane ? pane.querySelector('[data-cl-scroller]') : null;
  }

  function scrollPane(root, dir) {
    var scroller = activeScroller(root);
    if (!scroller) return;
    var card = scroller.querySelector('.cl-card');
    var amount = card ? card.getBoundingClientRect().width + 16 : scroller.clientWidth * 0.85;
    scroller.scrollBy({ left: dir * amount, behavior: 'smooth' });
  }

  function jumpScrollerToNow(scroller) {
    if (!scroller) return;
    var now = Date.now() - 3 * 60 * 60 * 1000;
    var cards = Array.prototype.slice.call(scroller.querySelectorAll('.cl-card'));
    var target = scroller.querySelector('.cl-card.is-live');
    if (!target) {
      target = cards.find(function (card) {
        if (card.classList.contains('is-done')) return false;
        var ts = Date.parse(card.getAttribute('data-cl-kickoff') || '');
        return Number.isFinite(ts) && ts >= now;
      });
    }
    if (!target) return;
    var left = target.offsetLeft - 12;
    scroller.scrollLeft = Math.max(0, left);
  }

  function selectTab(root, id) {
    if (!id) return;
    own(root, '[data-cl-tab]').forEach(function (tab) {
      var on = tab.getAttribute('data-cl-tab') === id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    own(root, '[data-cl-pane]').forEach(function (pane) {
      var on = pane.getAttribute('data-cl-pane') === id;
      pane.classList.toggle('is-active', on);
      if (on) pane.removeAttribute('hidden');
      else pane.setAttribute('hidden', '');
    });
    if (root.hasAttribute('data-cl-hash') && history.replaceState) {
      history.replaceState(null, '', '#' + id);
    }
  }

  function onRootClick(e) {
    var root = e.currentTarget;
    var next = e.target.closest('[data-cl-next]');
    var prev = e.target.closest('[data-cl-prev]');
    var tab = e.target.closest('[data-cl-tab]');
    if (tab && tab.closest('[data-cl-hub], [data-cl-matches], [data-mc-hub]') !== root) return;
    if (next) {
      e.preventDefault();
      scrollPane(root, 1);
    } else if (prev) {
      e.preventDefault();
      scrollPane(root, -1);
    } else if (tab) {
      e.preventDefault();
      selectTab(root, tab.getAttribute('data-cl-tab'));
      jumpScrollerToNow(activeScroller(root));
    }
  }

  function applyHash(root) {
    var hash = (location.hash || '').replace(/^#/, '');
    if (hash && own(root, '[data-cl-tab="' + hash + '"]').length) {
      selectTab(root, hash);
    }
  }

  function chipList(nav) {
    return Array.prototype.slice.call(nav.querySelectorAll('[data-fm-day]'));
  }

  function setActiveDay(day) {
    document.querySelectorAll('[data-fm-day]').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-fm-day') === day);
    });
  }

  function revealChip(chip) {
    if (!chip || typeof chip.scrollIntoView !== 'function') return;
    chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function syncDayArrows(root, nav) {
    var chips = chipList(nav);
    var active = nav.querySelector('[data-fm-day].is-active') || chips[0];
    var index = Math.max(0, chips.indexOf(active));
    var prev = root.querySelector('[data-fm-prev]');
    var next = root.querySelector('[data-fm-next]');
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= chips.length - 1;
  }

  function scrollToDay(day, smooth) {
    var el = document.getElementById('den-' + day);
    if (!el) return false;
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    setActiveDay(day);
    var chip = document.querySelector('[data-fm-day="' + day + '"]');
    revealChip(chip);
    var nav = document.querySelector('[data-fm-days]');
    var root = nav && nav.closest('.fm-daynav');
    if (root && nav) syncDayArrows(root, nav);
    return true;
  }

  function bindDayNav() {
    var nav = document.querySelector('[data-fm-days]');
    if (!nav || nav.getAttribute('data-fm-bound') === '1') return;
    nav.setAttribute('data-fm-bound', '1');
    var root = nav.closest('.fm-daynav') || nav.parentElement;
    function go(delta) {
      var chips = chipList(nav);
      var active = nav.querySelector('[data-fm-day].is-active') || chips[0];
      var index = Math.max(0, chips.indexOf(active)) + delta;
      var chip = chips[index];
      if (!chip) return;
      var day = chip.getAttribute('data-fm-day');
      if (!day) return;
      if (scrollToDay(day, true) && history.replaceState) {
        history.replaceState(null, '', '#den-' + day);
      }
    }
    nav.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-fm-day]');
      if (!chip) return;
      var day = chip.getAttribute('data-fm-day');
      if (!day) return;
      e.preventDefault();
      if (scrollToDay(day, true) && history.replaceState) {
        history.replaceState(null, '', '#den-' + day);
      }
    });
    if (root) {
      root.addEventListener('click', function (e) {
        var prev = e.target.closest('[data-fm-prev]');
        var next = e.target.closest('[data-fm-next]');
        if (prev) {
          e.preventDefault();
          go(-1);
        } else if (next) {
          e.preventDefault();
          go(1);
        }
      });
    }
    var hash = (location.hash || '').replace(/^#den-/, '');
    if (hash && document.getElementById('den-' + hash)) {
      scrollToDay(hash, false);
    } else {
      syncDayArrows(root, nav);
      var active = nav.querySelector('[data-fm-day].is-active');
      if (active) revealChip(active);
    }
  }

  function bind() {
    document.querySelectorAll('[data-cl-matches], [data-cl-hub], [data-mc-hub]').forEach(function (root) {
      if (root.getAttribute('data-cl-bound') === '1') return;
      root.setAttribute('data-cl-bound', '1');
      root.addEventListener('click', onRootClick);
      if (root.hasAttribute('data-cl-hash')) applyHash(root);
      jumpScrollerToNow(activeScroller(root));
    });
    bindDayNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

(function () {
  if (!window.matchMedia('(min-width: 1024px)').matches) return;

  var dataEl = document.getElementById('home-leaderboard-ads-data');
  if (!dataEl) return;

  function b64ToUtf8(b64) {
    var bin = window.atob(b64);
    if (typeof TextDecoder !== 'undefined') {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    try {
      return decodeURIComponent(escape(bin));
    } catch (_e) {
      return bin;
    }
  }

  var placements;
  try {
    var b64 = dataEl.getAttribute('data-placements');
    var raw = b64 ? b64ToUtf8(b64) : '[]';
    placements = JSON.parse(String(raw || '[]').trim() || '[]');
  } catch (_e) {
    return;
  }
  if (!Array.isArray(placements) || !placements.length) return;

  var attempts = 0;
  var maxAttempts = 20;
  var timerId = null;
  var started = false;
  var creativeWatchId = null;
  var creativeChecks = 0;
  var maxCreativeChecks = 40;

  function hasCreative(domId) {
    var zone = document.getElementById(domId);
    return !!(zone && zone.querySelector('iframe, img, ins, object, embed'));
  }

  function revealIfCreative() {
    placements.forEach(function (placement) {
      var wrap = document.getElementById(placement.wrapId);
      if (!wrap || !wrap.classList.contains('is-pending-ad')) return;
      if (hasCreative(placement.domId)) {
        wrap.classList.remove('is-pending-ad');
      }
    });
  }

  function allRevealedOrEmpty() {
    return placements.every(function (placement) {
      var wrap = document.getElementById(placement.wrapId);
      if (!wrap) return true;
      if (!wrap.classList.contains('is-pending-ad')) return true;
      return hasCreative(placement.domId);
    });
  }

  function startCreativeWatcher() {
    if (creativeWatchId) return;
    creativeWatchId = window.setInterval(function () {
      creativeChecks += 1;
      revealIfCreative();
      if (allRevealedOrEmpty() || creativeChecks >= maxCreativeChecks) {
        window.clearInterval(creativeWatchId);
        creativeWatchId = null;
      }
    }, 150);
  }

  function renderAdsOnce() {
    if (started) return true;
    if (!window.sssp || typeof window.sssp.getAds !== 'function') return false;
    started = true;
    window.sssp.getAds(
      placements.map(function (placement) {
        return {
          zoneId: placement.zoneId,
          id: placement.domId,
          width: placement.width,
          height: placement.height,
        };
      })
    );
    startCreativeWatcher();
    return true;
  }

  if (renderAdsOnce()) return;

  timerId = window.setInterval(function () {
    attempts += 1;
    if (renderAdsOnce() || attempts >= maxAttempts) {
      window.clearInterval(timerId);
    }
  }, 150);
})();

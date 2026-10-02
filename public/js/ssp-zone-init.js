(function () {
  function parseMq(raw) {
    if (!raw) return null;
    var value = String(raw).trim();
    if (value.indexOf('max:') === 0) {
      return window.matchMedia('(max-width: ' + value.slice(4) + 'px)');
    }
    if (value.indexOf('min:') === 0) {
      return window.matchMedia('(min-width: ' + value.slice(4) + 'px)');
    }
    return window.matchMedia(value);
  }

  function collectZones() {
    var nodes = document.querySelectorAll('[data-ssp-zone]');
    var zones = [];
    nodes.forEach(function (el) {
      var mq = parseMq(el.getAttribute('data-ssp-mq'));
      if (mq && !mq.matches) return;
      var zoneId = Number(el.getAttribute('data-ssp-zone'));
      var width = Number(el.getAttribute('data-ssp-width') || 300);
      var height = Number(el.getAttribute('data-ssp-height') || 600);
      var id = el.id;
      if (!id || !Number.isFinite(zoneId)) return;
      zones.push({ zoneId: zoneId, id: id, width: width, height: height });
    });
    return zones;
  }

  var zones = collectZones();
  if (!zones.length) return;

  var attempts = 0;
  var maxAttempts = 20;
  var timerId = null;
  var started = false;

  function renderOnce() {
    if (started) return true;
    if (!window.sssp || typeof window.sssp.getAds !== 'function') return false;
    started = true;
    window.sssp.getAds(zones);
    return true;
  }

  if (renderOnce()) return;

  timerId = window.setInterval(function () {
    attempts += 1;
    if (renderOnce() || attempts >= maxAttempts) {
      window.clearInterval(timerId);
    }
  }, 150);
})();

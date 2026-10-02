(function () {
  var gate = document.getElementById('adblock-gate');
  if (!gate) return;
  var host = String(window.location && window.location.hostname ? window.location.hostname : '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return;

  var pageNodes = [];

  function rememberPageNodes() {
    pageNodes = [];
    var header = document.querySelector('header');
    var main = document.getElementById('main-content');
    var footer = document.querySelector('footer');
    if (header) pageNodes.push(header);
    if (main) pageNodes.push(main);
    if (footer) pageNodes.push(footer);
  }

  function hideGate() {
    gate.classList.add('hidden');
    gate.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    pageNodes.forEach(function (node) {
      node.style.visibility = '';
    });
  }

  function showGate() {
    if (!gate.classList.contains('hidden')) return;
    rememberPageNodes();
    gate.classList.remove('hidden');
    gate.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    pageNodes.forEach(function (node) {
      node.style.visibility = 'hidden';
    });
  }

  function adBaitBlocked() {
    var bait = document.createElement('div');
    bait.className = 'adsbox ad ads ad-banner ad-unit text-ad pub_300x250';
    bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;height:10px;width:10px;';
    document.body.appendChild(bait);
    var blocked = false;
    try {
      var style = window.getComputedStyle(bait);
      blocked =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        bait.offsetHeight === 0 ||
        bait.offsetWidth === 0;
    } catch (_e) {
      blocked = false;
    }
    bait.remove();
    return blocked;
  }

  function runDetection() {
    if (!adBaitBlocked()) return;
    window.setTimeout(function () {
      if (adBaitBlocked()) showGate();
    }, 2500);
  }

  gate.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('[data-adblock-reload]')) {
      window.location.reload();
      return;
    }
    if (e.target === gate) hideGate();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !gate.classList.contains('hidden')) {
      hideGate();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runDetection);
  } else {
    runDetection();
  }
})();

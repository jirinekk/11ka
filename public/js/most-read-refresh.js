(function () {
  var INTERVAL_MS = 30000;
  var signatures = new Map();

  function cacheKeyForRoot(root) {
    var layout = root.getAttribute('data-most-read-layout') || 'grid';
    var scope = root.getAttribute('data-most-read-scope') || 'global';
    var category = root.getAttribute('data-most-read-category') || '';
    var tag = root.getAttribute('data-most-read-tag') || '';
    var query = root.getAttribute('data-most-read-query') || '';
    var limit = root.getAttribute('data-most-read-limit') || '';
    return [layout, scope, category, tag, query, limit].join('::');
  }

  function buildFetchUrl(root) {
    var layout = root.getAttribute('data-most-read-layout') || 'grid';
    var scope = root.getAttribute('data-most-read-scope') || 'global';
    var category = root.getAttribute('data-most-read-category') || '';
    var tag = root.getAttribute('data-most-read-tag') || '';
    var query = root.getAttribute('data-most-read-query') || '';
    var limit = root.getAttribute('data-most-read-limit') || '';
    var params = new URLSearchParams();
    params.set('layout', layout);
    params.set('scope', scope);
    if (category) params.set('category', category);
    if (tag) params.set('tag', tag);
    if (query) params.set('q', query);
    if (limit) params.set('limit', limit);
    return '/api/most-read?' + params.toString();
  }

  function refreshRoot(root) {
    var target = root.querySelector('[data-most-read-target]');
    if (!target) return;
    var key = cacheKeyForRoot(root);

    fetch(buildFetchUrl(root), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (response) {
        if (!response.ok) throw new Error('bad status');
        return response.json();
      })
      .then(function (payload) {
        if (!payload || typeof payload.html !== 'string') return;
        if (payload.signature && signatures.get(key) === payload.signature) return;
        signatures.set(key, payload.signature || '');
        target.innerHTML = payload.html;
      })
      .catch(function () {
        /* ignore */
      });
  }

  function refreshAll() {
    document.querySelectorAll('[data-most-read-root]').forEach(refreshRoot);
  }

  function init() {
    var roots = document.querySelectorAll('[data-most-read-root]');
    if (!roots.length) return;
    roots.forEach(function (root) {
      var key = cacheKeyForRoot(root);
      var sig = root.getAttribute('data-most-read-signature');
      if (sig) signatures.set(key, sig);
    });
    window.setInterval(refreshAll, INTERVAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

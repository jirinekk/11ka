(function () {
  var embed = document.querySelector('.sidebar-social__embed--elfsight');
  if (!embed) return;

  var app = embed.querySelector('[class*="elfsight-app-"]');
  var fallback = embed.querySelector('.sidebar-social__embed-fallback');
  if (!app) return;

  function hasWidgetContent() {
    if (app.querySelector('iframe[src], iframe[data-src]')) return true;
    var media = app.querySelectorAll('img[src], [class*="eapps-"]');
    if (media.length && app.offsetHeight > 48) return true;
    return app.childElementCount > 0 && app.offsetHeight > 80;
  }

  function refreshWidget() {
    try {
      if (window.eapps && window.eapps.platform) {
        if (typeof window.eapps.platform.collectWidgets === 'function') {
          window.eapps.platform.collectWidgets();
        }
        if (typeof window.eapps.platform.revise === 'function') {
          window.eapps.platform.revise();
        }
      }
    } catch (_e) { /* ignore */ }
  }

  function syncFallback() {
    if (!fallback) return;
    var loaded = hasWidgetContent();
    fallback.hidden = loaded;
    embed.classList.toggle('sidebar-social__embed--loaded', loaded);
  }

  function scheduleChecks() {
    syncFallback();
    window.setTimeout(syncFallback, 1500);
    window.setTimeout(function () {
      refreshWidget();
      syncFallback();
    }, 3500);
    window.setTimeout(syncFallback, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleChecks, { once: true });
  } else {
    scheduleChecks();
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(syncFallback);
    mo.observe(app, { childList: true, subtree: true, attributes: true });
  }
})();

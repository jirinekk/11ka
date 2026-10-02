(function () {
  var feeds = document.querySelectorAll('[data-sidebar-ig-feed]');
  if (!feeds.length) return;

  feeds.forEach(function (feed) {
    var app = feed.querySelector('[data-sidebar-ig-app]');
    if (!app) return;

    var checks = 0;
    var maxChecks = 50;
    var timerId = null;

    function widgetLoaded() {
      if (app.querySelector('iframe[src], img[src]:not([src=""])')) return true;
      if (app.querySelector('[class*="eapps-"], [class*="elfsight-app"] iframe')) return true;
      return app.offsetHeight > 48 && app.children.length > 0;
    }

    function hasLimitError() {
      var text = (app.textContent || '').toLowerCase();
      return (
        text.indexOf('views limit') !== -1 ||
        text.indexOf('limit reached') !== -1 ||
        text.indexOf('app_views_limit') !== -1
      );
    }

    var observer = null;

    function stopWatching() {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    function sync() {
      checks += 1;
      if (widgetLoaded()) {
        app.classList.add('sidebar-social__elfsight--ready');
        stopWatching();
        return;
      }
      if (hasLimitError() || checks >= maxChecks) {
        app.classList.add('sidebar-social__elfsight--failed');
        stopWatching();
      }
    }

    sync();
    timerId = setInterval(sync, 800);

    if ('MutationObserver' in window) {
      observer = new MutationObserver(function () {
        if (checks >= maxChecks) return;
        sync();
      });
      observer.observe(app, { childList: true, subtree: true });
    }
  });
})();

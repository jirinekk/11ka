(function () {
  function applyObjectPosition(el) {
    var value = el.getAttribute('data-object-position');
    if (value) el.style.objectPosition = value;
  }

  function applyHeroPositions(el) {
    var mobile = el.getAttribute('data-hero-pos-mobile');
    var desktop = el.getAttribute('data-hero-pos-desktop');
    if (mobile) el.style.setProperty('--hero-pos-mobile', mobile);
    if (desktop) el.style.setProperty('--hero-pos-desktop', desktop);
  }

  function run() {
    document.querySelectorAll('[data-object-position]').forEach(applyObjectPosition);
    document.querySelectorAll('[data-hero-pos-mobile], [data-hero-pos-desktop]').forEach(applyHeroPositions);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

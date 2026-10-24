(function () {
  var INTERVAL_MS = 6000;

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function toneFromSlide(slide) {
    if (slide.classList.contains('sidebar-hiring-promo__slide--green')) return 'green';
    if (slide.classList.contains('sidebar-hiring-promo__slide--orange')) return 'orange';
    return 'blue';
  }

  function initPromo(root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll('[data-hiring-slide]'));
    if (slides.length < 2) return;

    var progress = root.querySelector('[data-hiring-progress]');
    var idx = Math.max(
      0,
      slides.findIndex(function (slide) {
        return slide.classList.contains('is-active');
      })
    );
    var timer = null;
    var anim = null;
    var userPaused = false;
    var reduced = prefersReducedMotion();
    var canAnimate = !!(progress && progress.animate && !reduced);

    function setTone() {
      root.setAttribute('data-hiring-tone', toneFromSlide(slides[idx]));
    }

    function show(nextIdx) {
      slides[idx].classList.remove('is-active');
      slides[idx].setAttribute('aria-hidden', 'true');
      slides[idx].setAttribute('tabindex', '-1');
      idx = (nextIdx + slides.length) % slides.length;
      slides[idx].classList.add('is-active');
      slides[idx].removeAttribute('aria-hidden');
      slides[idx].removeAttribute('tabindex');
      setTone();
    }

    function next() {
      show(idx + 1);
    }

    function startProgress() {
      if (!canAnimate) return;
      if (anim) anim.cancel();
      anim = progress.animate(
        [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: INTERVAL_MS, easing: 'linear', fill: 'forwards' }
      );
      anim.onfinish = function () {
        next();
        startProgress();
      };
    }

    function pause() {
      if (anim && anim.playState === 'running') anim.pause();
      if (timer) clearInterval(timer);
      timer = null;
    }

    function play() {
      if (document.hidden || userPaused) return;
      if (canAnimate) {
        if (anim && anim.playState === 'paused') {
          anim.play();
          return;
        }
        startProgress();
        return;
      }
      if (timer) clearInterval(timer);
      timer = setInterval(next, INTERVAL_MS);
    }

    root.addEventListener('mouseenter', function () {
      userPaused = true;
      pause();
    });
    root.addEventListener('mouseleave', function () {
      userPaused = false;
      play();
    });
    root.addEventListener('focusin', function () {
      userPaused = true;
      pause();
    });
    root.addEventListener('focusout', function () {
      if (root.contains(document.activeElement)) return;
      userPaused = false;
      play();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else play();
    });

    setTone();
    play();
  }

  var roots = document.querySelectorAll('[data-hiring-promo]');
  for (var i = 0; i < roots.length; i += 1) initPromo(roots[i]);
})();

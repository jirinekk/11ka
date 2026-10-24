(function () {
  var root = document.querySelector('[data-hero-slider]');
  if (!root) return;

  var count = parseInt(root.getAttribute('data-count') || '0', 10) || 0;
  var slides = Array.prototype.slice.call(root.querySelectorAll('[data-hero-slide]'));
  var segmentBtns = Array.prototype.slice.call(root.querySelectorAll('[data-hero-segment-btn]'));
  var segmentFills = Array.prototype.slice.call(root.querySelectorAll('[data-hero-segment]'));
  var prevBtn = root.querySelector('[data-hero-prev]');
  var nextBtn = root.querySelector('[data-hero-next]');
  var counterEl = root.querySelector('[data-hero-counter]');
  var idx = 0;
  var advanceTimer = null;
  var slideStartedAt = 0;
  var remainingMs = 7000;
  var paused = false;
  var animating = false;
  var INTERVAL_MS = 7500;
  var TRANSITION_MS = 900;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clearAdvanceTimer() {
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  function progressPercentFromElapsed(elapsed) {
    return Math.min(100, Math.max(0, (elapsed / INTERVAL_MS) * 100));
  }

  function syncCounter() {
    if (!counterEl || count <= 1) return;
    counterEl.textContent = idx + 1 + ' / ' + count;
  }

  function syncSegments() {
    segmentBtns.forEach(function (btn, i) {
      var on = i === idx;
      btn.classList.toggle('hero-slider__segment--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    segmentFills.forEach(function (el, i) {
      el.style.transition = 'none';
      el.style.width = i < idx ? '100%' : '0%';
    });
    if (segmentFills[idx]) void segmentFills[idx].offsetWidth;
  }

  function setProgressVisual(pct, animateMs) {
    if (!segmentFills[idx] || reducedMotion) return;
    var fill = segmentFills[idx];
    fill.style.transition = 'none';
    fill.style.width = pct + '%';
    void fill.offsetWidth;
    if (animateMs > 0) {
      fill.style.transition = 'width ' + animateMs + 'ms linear';
      fill.style.width = '100%';
    }
  }

  function scheduleAdvance(ms, resume) {
    if (count <= 1) return;
    clearAdvanceTimer();
    var dur = Math.max(200, ms || INTERVAL_MS);
    remainingMs = dur;
    paused = false;

    if (resume) {
      slideStartedAt = Date.now() - (INTERVAL_MS - dur);
      setProgressVisual(progressPercentFromElapsed(Date.now() - slideStartedAt), dur);
    } else {
      slideStartedAt = Date.now();
      setProgressVisual(0, dur);
    }

    advanceTimer = setTimeout(function () {
      show(idx + 1);
    }, dur);
  }

  function pauseAutoplay() {
    if (paused || count <= 1) return;
    clearAdvanceTimer();
    root.classList.add('is-paused');
    if (reducedMotion) {
      paused = true;
      return;
    }
    var elapsed = Date.now() - slideStartedAt;
    remainingMs = Math.max(200, INTERVAL_MS - elapsed);
    setProgressVisual(progressPercentFromElapsed(elapsed), 0);
    paused = true;
  }

  function resumeAutoplay() {
    if (!paused || count <= 1) return;
    root.classList.remove('is-paused');
    scheduleAdvance(remainingMs, true);
  }

  function setSlideState() {
    slides.forEach(function (el, i) {
      var on = i === idx;
      el.classList.toggle('hero-slider__slide--active', on);
      if (on) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
  }

  function show(n) {
    if (animating && !reducedMotion) return;
    var next = ((n % count) + count) % count;
    if (next === idx) return;

    paused = false;
    root.classList.remove('is-paused');
    if (reducedMotion) {
      idx = next;
      setSlideState();
      syncSegments();
      syncCounter();
      scheduleAdvance(INTERVAL_MS, false);
      return;
    }

    animating = true;
    idx = next;
    setSlideState();
    syncSegments();
    syncCounter();
    scheduleAdvance(INTERVAL_MS, false);
    window.setTimeout(function () {
      animating = false;
    }, TRANSITION_MS);
  }

  if (count > 1) {
    segmentBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var target = parseInt(btn.getAttribute('data-hero-segment-btn') || '0', 10);
        if (target !== idx) show(target);
      });
    });

    if (prevBtn) {
      prevBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        show(idx - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        show(idx + 1);
      });
    }

    root.setAttribute('tabindex', '0');

    root.addEventListener('mouseenter', function (e) {
      if (e.relatedTarget && root.contains(e.relatedTarget)) return;
      pauseAutoplay();
    });
    root.addEventListener('mouseleave', function (e) {
      if (e.relatedTarget && root.contains(e.relatedTarget)) return;
      resumeAutoplay();
    });
    root.addEventListener('focusin', function (e) {
      if (!root.contains(e.target)) return;
      pauseAutoplay();
    });
    root.addEventListener('focusout', function (e) {
      if (root.contains(e.relatedTarget)) return;
      resumeAutoplay();
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        show(idx + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        show(idx - 1);
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseAutoplay();
      else if (paused) resumeAutoplay();
    });

    scheduleAdvance(INTERVAL_MS, false);
  }

  setSlideState();
  syncSegments();
  syncCounter();
})();

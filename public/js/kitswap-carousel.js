(function () {
  var roots = document.querySelectorAll('[data-kitswap-carousel]');
  if (!roots.length) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var INTERVAL_MS = 6000;

  function initCarousel(root) {
    var count = parseInt(root.getAttribute('data-count') || '0', 10) || 0;
    var slides = Array.prototype.slice.call(root.querySelectorAll('[data-kitswap-slide]'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('[data-kitswap-dot]'));
    var prevBtn = root.querySelector('[data-kitswap-prev]');
    var nextBtn = root.querySelector('[data-kitswap-next]');
    var counter = root.querySelector('[data-kitswap-counter]');
    var progressBar = root.querySelector('[data-kitswap-progress]');
    var idx = 0;
    var timer = null;
    var progressTimer = null;

    function clearTimer() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function clearProgress() {
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = null;
      if (progressBar) {
        progressBar.classList.remove('kitswap-carousel__progress-bar--animate');
        progressBar.style.width = '0%';
      }
    }

    function startProgress() {
      clearProgress();
      if (!progressBar || reducedMotion || count <= 1) return;
      progressBar.offsetWidth;
      progressBar.classList.add('kitswap-carousel__progress-bar--animate');
      progressTimer = setTimeout(function () {
        progressBar.classList.remove('kitswap-carousel__progress-bar--animate');
      }, INTERVAL_MS + 50);
    }

    function updateCounter() {
      if (counter) counter.textContent = idx + 1 + ' / ' + slides.length;
    }

    function goTo(next) {
      if (!slides.length) return;
      slides[idx].classList.remove('kitswap-carousel__slide--active');
      slides[idx].removeAttribute('aria-current');
      if (dots[idx]) {
        dots[idx].classList.remove('kitswap-carousel__dot--active');
        dots[idx].setAttribute('aria-selected', 'false');
      }
      idx = (next + slides.length) % slides.length;
      slides[idx].classList.add('kitswap-carousel__slide--active');
      slides[idx].setAttribute('aria-current', 'true');
      if (dots[idx]) {
        dots[idx].classList.add('kitswap-carousel__dot--active');
        dots[idx].setAttribute('aria-selected', 'true');
      }
      updateCounter();
      startProgress();
    }

    function next() {
      goTo(idx + 1);
    }

    function prev() {
      goTo(idx - 1);
    }

    function startAutoplay() {
      if (reducedMotion || count <= 1) return;
      clearTimer();
      startProgress();
      timer = setInterval(next, INTERVAL_MS);
    }

    if (prevBtn) prevBtn.addEventListener('click', function () { clearTimer(); prev(); startAutoplay(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { clearTimer(); next(); startAutoplay(); });
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        clearTimer();
        goTo(i);
        startAutoplay();
      });
    });

    var viewport = root.querySelector('.kitswap-carousel__viewport');
    if (viewport && count > 1) {
      var touchX = 0;
      viewport.addEventListener(
        'touchstart',
        function (e) {
          touchX = e.changedTouches[0].clientX;
        },
        { passive: true }
      );
      viewport.addEventListener(
        'touchend',
        function (e) {
          var dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) < 40) return;
          clearTimer();
          if (dx < 0) next();
          else prev();
          startAutoplay();
        },
        { passive: true }
      );
    }

    root.addEventListener('mouseenter', function () {
      clearTimer();
      clearProgress();
    });
    root.addEventListener('mouseleave', startAutoplay);
    updateCounter();
    startAutoplay();
  }

  Array.prototype.forEach.call(roots, initCarousel);
})();

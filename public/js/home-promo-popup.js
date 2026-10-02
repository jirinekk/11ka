(function () {
  var modal = document.querySelector('[data-home-promo-popup]');
  if (!modal) return;

  var dismissed = false;
  var isClosing = false;
  var openTimer = null;
  var savedScrollY = 0;
  var delayMs = Number.parseInt(modal.getAttribute('data-home-promo-delay') || '0', 10);
  if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = 0;
  var countdownTimer = null;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function stopCountdown() {
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function updateCountdown() {
    var countdown = modal.querySelector('[data-home-promo-countdown]');
    if (!countdown) return;

    var endIso = countdown.getAttribute('data-countdown-end');
    if (!endIso) return;

    var endMs = new Date(endIso).getTime();
    if (!Number.isFinite(endMs)) return;

    var grid = countdown.querySelector('[data-home-promo-countdown-values]');
    var labelEl = countdown.querySelector('[data-home-promo-countdown-label]');
    var liveEl = countdown.querySelector('[data-home-promo-countdown-live]');
    var pastEl = countdown.querySelector('[data-home-promo-countdown-past]');
    var daysEl = countdown.querySelector('[data-countdown-days]');
    var hoursEl = countdown.querySelector('[data-countdown-hours]');
    var minutesEl = countdown.querySelector('[data-countdown-minutes]');
    var secondsEl = countdown.querySelector('[data-countdown-seconds]');
    var diff = endMs - Date.now();

    function hideEndedMessages() {
      if (liveEl) liveEl.classList.add('hidden');
      if (pastEl) pastEl.classList.add('hidden');
    }

    if (diff <= 0) {
      if (grid) grid.classList.add('is-ended');
      if (labelEl) labelEl.classList.add('hidden');
      hideEndedMessages();

      var liveUntilIso = countdown.getAttribute('data-countdown-live-until');
      var liveUntilMs = liveUntilIso ? new Date(liveUntilIso).getTime() : NaN;
      var isLiveWindow = Number.isFinite(liveUntilMs) && Date.now() < liveUntilMs;

      if (isLiveWindow && liveEl) {
        liveEl.classList.remove('hidden');
      } else if (pastEl) {
        pastEl.classList.remove('hidden');
      }

      stopCountdown();
      return;
    }

    if (grid) grid.classList.remove('is-ended');
    if (labelEl) labelEl.classList.remove('hidden');
    hideEndedMessages();

    var totalSeconds = Math.floor(diff / 1000);
    var days = Math.floor(totalSeconds / 86400);
    totalSeconds -= days * 86400;
    var hours = Math.floor(totalSeconds / 3600);
    totalSeconds -= hours * 3600;
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds - minutes * 60;

    if (daysEl) daysEl.textContent = String(days);
    if (hoursEl) hoursEl.textContent = pad(hours);
    if (minutesEl) minutesEl.textContent = pad(minutes);
    if (secondsEl) secondsEl.textContent = pad(seconds);
  }

  function startCountdown() {
    stopCountdown();
    updateCountdown();
    if (!modal.querySelector('[data-home-promo-countdown]')) return;
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function lockScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add('home-promo-popup-open');
    document.body.classList.add('home-promo-popup-open');
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockScroll() {
    document.documentElement.classList.remove('home-promo-popup-open');
    document.body.classList.remove('home-promo-popup-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
  }

  function preventBackgroundScroll(e) {
    if (!modal.classList.contains('home-promo-popup--open')) return;
    var shell = modal.querySelector('.home-promo-popup__shell');
    if (shell && shell.contains(e.target)) return;
    e.preventDefault();
  }

  function closeModal() {
    if (isClosing || !modal.classList.contains('home-promo-popup--open')) return;
    isClosing = true;
    modal.classList.remove('home-promo-popup--open');
    modal.setAttribute('aria-hidden', 'true');
    dismissed = true;
    stopCountdown();
    unlockScroll();
    isClosing = false;
  }

  function openModal() {
    if (dismissed || modal.classList.contains('home-promo-popup--open')) return;
    lockScroll();
    modal.classList.add('home-promo-popup--open');
    modal.setAttribute('aria-hidden', 'false');
    startCountdown();
    var focusTarget = modal.querySelector('[data-home-promo-focus]');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      window.setTimeout(function () {
        focusTarget.focus();
      }, 50);
    }
  }

  function openAfterRecruitment() {
    if (dismissed) return;
    if (openTimer) window.clearTimeout(openTimer);
    if (delayMs === 0) {
      window.requestAnimationFrame(function () {
        openModal();
      });
      return;
    }
    openTimer = window.setTimeout(function () {
      openTimer = null;
      openModal();
    }, delayMs);
  }

  window.__11kaHomePromo = {
    openAfterRecruitment: openAfterRecruitment,
  };

  modal.querySelectorAll('[data-home-promo-close]').forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('home-promo-popup--open')) {
      closeModal();
    }
  });

  document.addEventListener('wheel', preventBackgroundScroll, { passive: false });
  document.addEventListener('touchmove', preventBackgroundScroll, { passive: false });
})();

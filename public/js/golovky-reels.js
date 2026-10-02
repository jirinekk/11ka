(function initGolovkyReels() {
  const videos = Array.from(document.querySelectorAll('[data-reel-card] video'));
  if (!videos.length) return;

  const syncPauseIndicator = (video) => {
    const card = video.closest('[data-reel-card]');
    if (!card) return;
    const indicator = card.querySelector('.reels-pause-indicator');
    if (!indicator) return;
    const userPaused = video.dataset.userPaused === '1';
    indicator.classList.toggle('is-visible', video.paused && userPaused);
  };

  const toggle = (video) => {
    if (video.paused) {
      video.dataset.userPaused = '0';
      video.play().catch(() => {});
      return;
    }
    video.dataset.userPaused = '1';
    video.pause();
  };

  videos.forEach((video) => {
    video.style.cursor = 'pointer';
    video.dataset.userPaused = '0';
    syncPauseIndicator(video);

    video.addEventListener('pause', () => syncPauseIndicator(video));
    video.addEventListener('play', () => {
      video.dataset.userPaused = '0';
      syncPauseIndicator(video);
    });
    video.addEventListener('loadeddata', () => syncPauseIndicator(video));

    let touchHandled = false;
    video.addEventListener('touchend', (event) => {
      touchHandled = true;
      event.preventDefault();
      toggle(video);
      syncPauseIndicator(video);
    });

    video.addEventListener('click', (event) => {
      if (touchHandled) {
        touchHandled = false;
        return;
      }
      event.preventDefault();
      toggle(video);
      syncPauseIndicator(video);
    });
  });

  const toggleButtons = Array.from(document.querySelectorAll('[data-reel-toggle]'));
  toggleButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const caption = button.closest('.reels-video-caption');
      if (!caption) return;
      const expanded = caption.classList.toggle('is-expanded');
      button.textContent = expanded ? 'Zobrazit méně' : 'Zobrazit více';
    });
  });

  const feed = document.querySelector('.reels-feed');
  const cards = feed ? Array.from(feed.querySelectorAll('.reels-card')) : [];
  if (feed && cards.length) {
    const getCurrentIndex = () => {
      const feedRect = feed.getBoundingClientRect();
      const feedCenterY = feedRect.top + feedRect.height / 2;
      let closestIdx = 0;
      let closestDist = Infinity;
      cards.forEach((card, idx) => {
        const cardRect = card.getBoundingClientRect();
        const cardCenterY = cardRect.top + cardRect.height / 2;
        const dist = Math.abs(cardCenterY - feedCenterY);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });
      return closestIdx;
    };

    const scrollToIndex = (idx) => {
      const safeIdx = Math.max(0, Math.min(cards.length - 1, idx));
      feed.scrollTo({ top: cards[safeIdx].offsetTop, behavior: 'smooth' });
    };

    const navUp = document.querySelector('[data-reels-nav="up"]');
    const navDown = document.querySelector('[data-reels-nav="down"]');
    navUp.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      scrollToIndex(getCurrentIndex() - 1);
    });
    navDown.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      scrollToIndex(getCurrentIndex() + 1);
    });

    const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    feed.addEventListener(
      'touchstart',
      (event) => {
        if (!isMobile()) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
      },
      { passive: true }
    );

    feed.addEventListener(
      'touchend',
      (event) => {
        if (!isMobile()) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const elapsed = Date.now() - touchStartTime;
        const isVerticalSwipe = Math.abs(dy) > Math.abs(dx) * 1.15;
        const enoughDistance = Math.abs(dy) > 45;
        const fastEnough = elapsed < 450;
        if (!isVerticalSwipe || (!enoughDistance && !fastEnough)) return;
        if (dy < 0) scrollToIndex(getCurrentIndex() + 1);
        if (dy > 0) scrollToIndex(getCurrentIndex() - 1);
      },
      { passive: true }
    );
  }
})();

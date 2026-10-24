(function () {
  var root = document.querySelector('[data-article-audio]');
  if (!root) return;

  var playBtn = root.querySelector('[data-audio-play]');
  var playIcon = root.querySelector('.article-audio__icon--play');
  var stopIcon = root.querySelector('.article-audio__icon--stop');
  var spinner = root.querySelector('.article-audio__spinner');
  var timeEl = root.querySelector('[data-audio-time]');
  var barEl = root.querySelector('[data-audio-bar]');
  var trackEl = root.querySelector('[data-audio-track]');
  var fillEl = root.querySelector('[data-audio-fill]');
  var knobEl = root.querySelector('[data-audio-knob]');
  var slug = root.getAttribute('data-slug') || '';
  var estimated = parseInt(root.getAttribute('data-duration') || '0', 10) || 0;
  var state = 'idle';
  var audio = new Audio();
  audio.preload = 'auto';
  var chunks = 0;
  var index = 0;
  var objectUrl = '';
  var tickId = 0;
  var starting = false;
  var seeking = false;
  var idleLabel = timeEl ? timeEl.textContent : '';

  function fmt(sec) {
    var s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function totals() {
    var chunkDur =
      audio.duration && isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : estimated / Math.max(1, chunks || 1);
    var total = chunks ? chunkDur * chunks : estimated || chunkDur || 0;
    var current = (chunks ? index * chunkDur : 0) + (audio.currentTime || 0);
    return { current: current, total: total, chunkDur: chunkDur };
  }

  function setTime(current, total) {
    if (!timeEl) return;
    var end = total || estimated;
    if (state === 'playing' || state === 'loading') {
      timeEl.textContent = fmt(current) + (end ? ' / ' + fmt(end) : '');
    } else {
      timeEl.textContent = idleLabel || (end ? fmt(end) : '');
    }
  }

  function setProgress(current, total) {
    var end = total || estimated;
    var pct = end > 0 ? Math.min(100, Math.max(0, (current / end) * 100)) : 0;
    if (fillEl) fillEl.style.width = pct + '%';
    if (knobEl) knobEl.style.left = pct + '%';
    if (trackEl) {
      trackEl.setAttribute('aria-valuemax', String(Math.round(end || 0)));
      trackEl.setAttribute('aria-valuenow', String(Math.round(current || 0)));
    }
  }

  function isOpen() {
    return state === 'playing' || state === 'loading';
  }

  function setPlayingUi(playing, loading, errored) {
    var open = isOpen() && !errored;
    root.classList.toggle('is-playing', !!playing);
    root.classList.toggle('is-loading', !!loading);
    root.classList.toggle('is-open', !!open);
    root.classList.toggle('is-error', !!errored);
    if (playIcon) playIcon.hidden = !!(playing || loading);
    if (stopIcon) stopIcon.hidden = !playing || !!loading;
    if (spinner) spinner.hidden = !loading;
    if (barEl) barEl.hidden = !open;
    if (playBtn) {
      playBtn.setAttribute(
        'aria-label',
        errored
          ? 'Audio se nepodařilo načíst'
          : loading
            ? 'Načítám audio komentář'
            : playing
              ? 'Zastavit audio komentář'
              : 'Pustit audio komentář'
      );
    }
  }

  function stopTick() {
    if (tickId) {
      window.clearInterval(tickId);
      tickId = 0;
    }
  }

  function paint() {
    var t = totals();
    setTime(t.current, t.total);
    setProgress(t.current, t.total);
  }

  function startTick() {
    stopTick();
    tickId = window.setInterval(function () {
      if (state !== 'playing' || seeking) return;
      paint();
    }, 200);
  }

  function stopAll() {
    stopTick();
    seeking = false;
    audio.pause();
    audio.removeAttribute('src');
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    }
    state = 'idle';
    setPlayingUi(false, false, false);
    setTime(0, estimated);
    setProgress(0, estimated);
  }

  async function fetchChunk(chunkIndex) {
    var url = '/api/article-tts?slug=' + encodeURIComponent(slug) + '&chunk=' + chunkIndex;
    var res = await fetch(url, { headers: { Accept: 'audio/*,application/json' } });
    var type = String(res.headers.get('content-type') || '');
    if (!res.ok || type.indexOf('audio') === -1) {
      throw new Error('audio');
    }
    chunks = parseInt(res.headers.get('x-tts-chunks') || '1', 10) || 1;
    return res.blob();
  }

  async function playChunk(chunkIndex) {
    setPlayingUi(true, true, false);
    var blob = await fetchChunk(chunkIndex);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    index = chunkIndex;
    state = 'playing';
    await audio.play();
    setPlayingUi(true, false, false);
    startTick();
    paint();
  }

  audio.addEventListener('ended', function () {
    if (state !== 'playing' || seeking) return;
    var next = index + 1;
    if (next >= chunks) {
      stopAll();
      return;
    }
    playChunk(next).catch(function () {
      stopAll();
      setPlayingUi(false, false, true);
    });
  });

  async function startPlay() {
    if (starting) return;
    if (state === 'playing') {
      stopAll();
      return;
    }

    stopAll();
    if (!slug) {
      setPlayingUi(false, false, true);
      return;
    }
    state = 'loading';
    starting = true;
    setPlayingUi(false, true, false);
    try {
      await playChunk(0);
    } catch (err) {
      stopAll();
      setPlayingUi(false, false, true);
    } finally {
      starting = false;
    }
  }

  async function seekRatio(ratio) {
    if (!isOpen() || starting) return;
    var t = totals();
    if (!t.total) return;
    var target = Math.max(0, Math.min(t.total, ratio * t.total));
    var targetIndex =
      t.chunkDur > 0 ? Math.min(Math.max(chunks - 1, 0), Math.max(0, Math.floor(target / t.chunkDur))) : 0;
    var offset = Math.max(0, target - targetIndex * t.chunkDur);
    setProgress(target, t.total);
    setTime(target, t.total);
    if (targetIndex === index && audio.src) {
      try {
        audio.currentTime = Math.min(audio.duration || offset, offset);
      } catch (err) {}
      return;
    }
    starting = true;
    try {
      await playChunk(targetIndex);
      try {
        audio.currentTime = Math.min(audio.duration || offset, offset);
      } catch (err) {}
    } catch (err) {
      stopAll();
      setPlayingUi(false, false, true);
    } finally {
      starting = false;
    }
  }

  function ratioFromEvent(e) {
    if (!trackEl) return 0;
    var point = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
    var rect = trackEl.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));
  }

  function onSeekStart(e) {
    if (!isOpen()) return;
    e.preventDefault();
    seeking = true;
    seekRatio(ratioFromEvent(e));
  }

  function onSeekMove(e) {
    if (!seeking) return;
    e.preventDefault();
    var ratio = ratioFromEvent(e);
    var t = totals();
    setProgress(ratio * t.total, t.total);
    setTime(ratio * t.total, t.total);
  }

  function onSeekEnd(e) {
    if (!seeking) return;
    var ratio = ratioFromEvent(e);
    seeking = false;
    seekRatio(ratio);
  }

  playBtn.addEventListener('click', function () {
    startPlay();
  });

  if (barEl) {
    barEl.addEventListener('pointerdown', onSeekStart);
    window.addEventListener('pointermove', onSeekMove);
    window.addEventListener('pointerup', onSeekEnd);
    window.addEventListener('pointercancel', onSeekEnd);
  }

  if (trackEl) {
    trackEl.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var t = totals();
      if (!t.total) return;
      var step = e.key === 'ArrowRight' ? 5 : -5;
      seekRatio(Math.max(0, Math.min(1, (t.current + step) / t.total)));
    });
  }

  window.addEventListener('pagehide', stopAll);
  setTime(0, estimated);
})();

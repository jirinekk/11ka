(function () {
  var KEEPER_SAVE_CHANCE = {
    1: 0.22,
    2: 0.34,
    3: 0.46,
    4: 0.58,
    5: 0.7,
  };

  function normalizeExperienceStars(value) {
    var stars = parseInt(value, 10);
    if (!Number.isFinite(stars) || stars < 1) return 1;
    if (stars > 5) return 5;
    return stars;
  }

  function saveChanceForStars(stars) {
    var s = normalizeExperienceStars(stars);
    return KEEPER_SAVE_CHANCE[s] != null ? KEEPER_SAVE_CHANCE[s] : KEEPER_SAVE_CHANCE[1];
  }

  function pickKeeperZone(zones, playerZone, experienceStars) {
    var list = zones && zones.length ? zones : [];
    if (!list.length) return playerZone || 'bc';
    var target = playerZone || list[0];
    if (Math.random() < saveChanceForStars(experienceStars)) {
      return target;
    }
    var others = list.filter(function (zone) {
      return zone !== target;
    });
    if (!others.length) return target;
    return others[Math.floor(Math.random() * others.length)];
  }

  function centerInArena(el, arena, cache) {
    if (cache && el) {
      if (el === cache.spotEl && cache.spot) return cache.spot;
      var zoneKey = el.dataset && el.dataset.zone;
      if (zoneKey && cache.zones && cache.zones[zoneKey]) return cache.zones[zoneKey];
    }
    var rect = el.getBoundingClientRect();
    var arenaRect = cache && cache.arenaRect ? cache.arenaRect : arena.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - arenaRect.left,
      y: rect.top + rect.height / 2 - arenaRect.top,
    };
  }

  function divePose(zone) {
    if (zone === 'tl' || zone === 'bl') return 'left';
    if (zone === 'tr' || zone === 'br') return 'right';
    if (zone === 'tc') return 'high';
    return 'stand';
  }

  function diveScaleForPose(pose, styles) {
    if (pose === 'stand' || pose === 'high') return 1;
    return parseFloat(styles.getPropertyValue('--penalty-dive-scale')) || 0.78;
  }

  function keeperMetrics(root, pose) {
    var styles = getComputedStyle(root);
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var diveScale = diveScaleForPose(pose, styles);
    var canvasH = (parseFloat(styles.getPropertyValue('--penalty-keeper-h')) || 8.25) * rem * diveScale;
    var canvasW = canvasH * (908 / 320);
    var reachRatio = parseFloat(styles.getPropertyValue('--penalty-dive-reach')) || 0.4;
    var liftRatio = parseFloat(styles.getPropertyValue('--penalty-dive-lift')) || 0.42;
    return {
      canvasH: canvasH,
      canvasW: canvasW,
      reach: canvasW * reachRatio,
      lift: canvasH * liftRatio,
      liftTop: parseFloat(styles.getPropertyValue('--penalty-dive-lift-top')) || 0.86,
      liftBottom: parseFloat(styles.getPropertyValue('--penalty-dive-lift-bottom')) || 1.05,
      reachBottom: parseFloat(styles.getPropertyValue('--penalty-dive-reach-bottom')) || 1.04,
    };
  }

  function goalLineOffset(root) {
    var styles = getComputedStyle(root);
    return parseFloat(styles.getPropertyValue('--penalty-goal-line-offset')) || 6;
  }

  function goalLineY(goalEl, arena, root, cache) {
    if (cache && cache.goalLineY != null) return cache.goalLineY;
    var goalRect = goalEl.getBoundingClientRect();
    var arenaRect = arena.getBoundingClientRect();
    return goalRect.bottom - arenaRect.top + goalLineOffset(root);
  }

  function keeperDiveEnd(zone, pose, goalEl, arena, root, cache) {
    var zoneCenter = cache && cache.zones && cache.zones[zone];
    if (!zoneCenter) {
      var zoneEl = goalEl.querySelector('[data-zone="' + zone + '"]');
      if (!zoneEl) {
        var goalRect = goalEl.getBoundingClientRect();
        var arenaRect = arena.getBoundingClientRect();
        return {
          x: goalRect.left + goalRect.width / 2 - arenaRect.left,
          y: goalLineY(goalEl, arena, root, cache),
        };
      }
      zoneCenter = centerInArena(zoneEl, arena, cache);
    }
    if (pose === 'high') {
      return {
        x: zoneCenter.x,
        y: goalLineY(goalEl, arena, root, cache),
      };
    }
    var m = keeperMetrics(root, pose);
    var styles = getComputedStyle(root);
    var arenaRect = cache && cache.arenaRect ? cache.arenaRect : arena.getBoundingClientRect();
    var isTop = zone === 'tl' || zone === 'tr';
    var isBottom = zone === 'bl' || zone === 'br';
    var lift = m.lift * (isTop ? m.liftTop : isBottom ? m.liftBottom : 1);
    var y = zoneCenter.y + lift;
    var glovePad = parseFloat(styles.getPropertyValue('--penalty-dive-glove-pad')) || 2;
    var postKey = pose === 'left' ? 'left' : 'right';
    var postRect = cache && cache.posts ? cache.posts[postKey] : null;
    var x = zoneCenter.x;

    if (postRect) {
      if (pose === 'left') {
        var handFromCenter =
          parseFloat(styles.getPropertyValue('--penalty-dive-hand-left')) || 0.298;
        var gloveX = postRect.right - arenaRect.left + glovePad;
        x = gloveX + m.canvasW * handFromCenter;
      } else {
        var handFromCenterRight =
          parseFloat(styles.getPropertyValue('--penalty-dive-hand-right')) || 0.305;
        var gloveXRight = postRect.left - arenaRect.left - glovePad;
        x = gloveXRight - m.canvasW * handFromCenterRight;
      }
    } else {
      var reach = m.reach * (isBottom ? m.reachBottom : 1);
      if (pose === 'left') x -= reach;
      if (pose === 'right') x += reach;
    }

    return { x: x, y: y };
  }

  function init(root) {
    if (!root || root.dataset.penaltyReady === '1') return;
    root.dataset.penaltyReady = '1';

    var MAX_ROUNDS = parseInt(root.dataset.maxRounds, 10);
    if (!Number.isFinite(MAX_ROUNDS) || MAX_ROUNDS < 1) MAX_ROUNDS = 5;

    var round = 1;
    var goals = 0;
    var locked = false;
    var finished = false;
    var started = false;
    var playerRegistered = false;
    var authMode = 'register';
    var pointsPerGoal = 1;
    var keeperExperience = 1;
    var SESSION_KEY_PREFIX = '11ka-penalty:';

    var arena = root.querySelector('.penalty-game__arena');
    var goalEl = root.querySelector('.penalty-game__goal');
    var keeper = root.querySelector('[data-penalty-keeper]');
    var keeperBody = root.querySelector('[data-keeper-body]');
    var keeperFace = root.querySelector('[data-keeper-face]');
    var keeperFaceWrap = root.querySelector('[data-keeper-face-wrap]');
    var keeperImg = keeperBody;
    var ball = root.querySelector('[data-penalty-ball]');
    var spot = root.querySelector('[data-penalty-spot]');
    var message = root.querySelector('[data-penalty-message]');
    var goalsEl = root.querySelector('[data-penalty-goals]');
    var roundEl = root.querySelector('[data-penalty-round]');
    var restartBtn = root.querySelector('[data-penalty-restart]');
    var startBtn = root.querySelector('[data-penalty-start]');
    var menuEl = root.querySelector('[data-penalty-menu]');
    var registerEl = root.querySelector('[data-penalty-register]');
    var registerForm = root.querySelector('[data-penalty-register-form]');
    var loginForm = root.querySelector('[data-penalty-login-form]');
    var registerNameInput = root.querySelector('[data-penalty-register-name]');
    var registerEmailInput = root.querySelector('[data-penalty-register-email]');
    var loginEmailInput = root.querySelector('[data-penalty-login-email]');
    var registerErrorEl = root.querySelector('[data-penalty-register-error]');
    var loginErrorEl = root.querySelector('[data-penalty-login-error]');
    var registerSubmitBtn = root.querySelector('[data-penalty-register-submit]');
    var loginSubmitBtn = root.querySelector('[data-penalty-login-submit]');
    var authTabs = root.querySelectorAll('[data-penalty-auth-tab]');
    var authDescEl = root.querySelector('[data-penalty-auth-desc]');
    var authKickerEl = root.querySelector('[data-penalty-auth-kicker]');
    var pickEl = root.querySelector('[data-penalty-pick]');
    var pickConfirmBtn = root.querySelector('[data-penalty-pick-confirm]');
    var pickCarousel = root.querySelector('[data-pick-carousel]');
    var pickTrack = root.querySelector('[data-pick-track]');
    var pickPrevBtn = root.querySelector('[data-pick-prev]');
    var pickNextBtn = root.querySelector('[data-pick-next]');
    var pickOptions = root.querySelectorAll('[data-pick-keeper]');
    var pickPage = 0;
    var PICK_PER_PAGE = 3;
    var endEl = root.querySelector('[data-penalty-end]');
    var endGoalsEl = root.querySelector('[data-penalty-end-goals]');
    var endPointsEl = root.querySelector('[data-penalty-end-points]');
    var hudEl = root.querySelector('[data-penalty-hud]');
    var zoneButtons = goalEl ? goalEl.querySelectorAll('[data-zone]') : [];
    var gameWrap = root.closest('.penalty-game-wrap');
    var leaderboardAside = gameWrap ? gameWrap.querySelector('[data-penalty-leaderboard]') : null;
    var leaderboardList = gameWrap ? gameWrap.querySelector('[data-penalty-leaderboard-list]') : null;
    var leaderboardEmpty = gameWrap ? gameWrap.querySelector('[data-penalty-leaderboard-empty]') : null;

    var defaultKeeperSrc = {
      stand: root.dataset.keeperStand,
      left: root.dataset.keeperLeft,
      right: root.dataset.keeperRight,
      high: root.dataset.keeperHigh,
    };
    var keeperSrc = {
      stand: defaultKeeperSrc.stand,
      left: defaultKeeperSrc.left,
      right: defaultKeeperSrc.right,
      high: defaultKeeperSrc.high,
    };

    if (!arena || !goalEl || !keeper || !keeperImg || !ball || !spot || !message) return;

    var layoutCache = null;
    var preloadedSrc = Object.create(null);
    var postLeft = root.querySelector('.penalty-game__post--left');
    var postRight = root.querySelector('.penalty-game__post--right');

    function preloadImage(src) {
      if (!src || preloadedSrc[src]) return;
      preloadedSrc[src] = true;
      var img = new Image();
      img.decoding = 'async';
      img.src = src;
    }

    function preloadKeeperSet(srcMap) {
      Object.keys(srcMap).forEach(function (key) {
        preloadImage(srcMap[key]);
      });
    }

    function invalidateLayoutCache() {
      layoutCache = null;
    }

    function refreshLayoutCache() {
      var arenaRect = arena.getBoundingClientRect();
      var goalRect = goalEl.getBoundingClientRect();
      var zones = {};
      zoneButtons.forEach(function (btn) {
        var rect = btn.getBoundingClientRect();
        zones[btn.dataset.zone] = {
          x: rect.left + rect.width / 2 - arenaRect.left,
          y: rect.top + rect.height / 2 - arenaRect.top,
        };
      });
      var spotRect = spot.getBoundingClientRect();
      var posts = {};
      if (postLeft) posts.left = postLeft.getBoundingClientRect();
      if (postRight) posts.right = postRight.getBoundingClientRect();
      layoutCache = {
        arenaRect: arenaRect,
        goalRect: goalRect,
        goalLineY: goalRect.bottom - arenaRect.top + goalLineOffset(root),
        keeperBaseX: goalRect.left + goalRect.width / 2 - arenaRect.left,
        spotEl: spot,
        spot: {
          x: spotRect.left + spotRect.width / 2 - arenaRect.left,
          y: spotRect.top + spotRect.height / 2 - arenaRect.top,
        },
        zones: zones,
        posts: posts,
      };
      return layoutCache;
    }

    function getLayoutCache() {
      return layoutCache || refreshLayoutCache();
    }

    preloadKeeperSet(keeperSrc);
    pickOptions.forEach(function (btn) {
      preloadImage(btn.getAttribute('data-keeper-thumb'));
      ['stand', 'left', 'right', 'high'].forEach(function (pose) {
        preloadImage(btn.getAttribute('data-keeper-' + pose));
      });
    });

    var poseClasses = [
      'penalty-game__keeper--pose-stand',
      'penalty-game__keeper--pose-left',
      'penalty-game__keeper--pose-right',
      'penalty-game__keeper--pose-high',
    ];

    function updateHud() {
      if (goalsEl) goalsEl.textContent = String(goals);
      if (roundEl) roundEl.textContent = String(Math.min(round, MAX_ROUNDS));
    }

    function formatGoalsLine(count, max) {
      return count + ' z ' + max + ' gólů';
    }

    function calcPoints() {
      return Math.round(goals * pointsPerGoal);
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function renderLeaderboard(entries) {
      if (!leaderboardAside) return;
      var list = entries && entries.length ? entries : [];
      if (!list.length) {
        if (leaderboardList) {
          leaderboardList.innerHTML = '';
          leaderboardList.hidden = true;
        }
        if (leaderboardEmpty) {
          leaderboardEmpty.hidden = false;
        } else if (!leaderboardList) {
          var emptyEl = document.createElement('p');
          emptyEl.className = 'penalty-leaderboard__empty';
          emptyEl.setAttribute('data-penalty-leaderboard-empty', '');
          emptyEl.textContent = 'Zatím žádné body. Buďte první!';
          leaderboardAside.appendChild(emptyEl);
          leaderboardEmpty = emptyEl;
        }
        return;
      }
      if (leaderboardEmpty) leaderboardEmpty.hidden = true;
      var html = list
        .map(function (entry, index) {
          return (
            '<li class="penalty-leaderboard__row" data-penalty-leaderboard-row>' +
            '<span class="penalty-leaderboard__rank">' +
            (index + 1) +
            '.</span>' +
            '<span class="penalty-leaderboard__name">' +
            escapeHtml(entry.display_name) +
            '</span>' +
            '<span class="penalty-leaderboard__points">' +
            escapeHtml(entry.points) +
            '</span>' +
            '</li>'
          );
        })
        .join('');
      if (!leaderboardList) {
        leaderboardList = document.createElement('ol');
        leaderboardList.className = 'penalty-leaderboard__list';
        leaderboardList.setAttribute('data-penalty-leaderboard-list', '');
        leaderboardAside.appendChild(leaderboardList);
      }
      leaderboardList.hidden = false;
      leaderboardList.innerHTML = html;
    }

    function submitScore() {
      var playerId = root.dataset.penaltyPlayerId;
      var points = calcPoints();
      if (!playerId || points <= 0) return;
      fetch('/api/penalty/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          player_id: parseInt(playerId, 10),
          article_slug: root.dataset.articleSlug || '',
          points: points,
        }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data && result.data.ok && result.data.entries) {
            renderLeaderboard(result.data.entries);
          }
        })
        .catch(function () {
          /* best effort */
        });
    }

    function getActivePickOption() {
      return root.querySelector('[data-pick-keeper].penalty-game__pick-option--active') || pickOptions[0];
    }

    function applyKeeperSelection(option) {
      keeperSrc.stand = defaultKeeperSrc.stand;
      keeperSrc.left = defaultKeeperSrc.left;
      keeperSrc.right = defaultKeeperSrc.right;
      keeperSrc.high = defaultKeeperSrc.high;
      keeper.classList.remove('penalty-game__keeper--face');
      if (keeperFaceWrap) {
        keeperFaceWrap.hidden = true;
        keeperFaceWrap.style.removeProperty('--penalty-face-top-fraction');
        keeperFaceWrap.style.removeProperty('--penalty-face-left');
        keeperFaceWrap.style.removeProperty('--penalty-face-size-fraction');
      }
      if (keeperFace) {
        keeperFace.removeAttribute('src');
      }
      if (!option) return;
      pointsPerGoal = parseInt(option.dataset.points, 10) || 1;
      keeperExperience = normalizeExperienceStars(option.dataset.experience);
      root.dataset.penaltyPointsPerGoal = String(pointsPerGoal);
      root.dataset.penaltySelectedKeeper = option.dataset.keeperId || '';
      root.dataset.penaltyKeeperExperience = String(keeperExperience);
      var useFaceThumb = option.dataset.useFaceThumb === '1';
      if (useFaceThumb) {
        keeper.classList.add('penalty-game__keeper--face');
        var faceTopPct = parseFloat(option.dataset.faceTop);
        var faceLeftPct = parseFloat(option.dataset.faceLeft);
        var faceSizePct = parseFloat(option.dataset.faceSize);
        if (!Number.isFinite(faceTopPct)) faceTopPct = 14;
        if (!Number.isFinite(faceLeftPct)) faceLeftPct = 50;
        if (!Number.isFinite(faceSizePct)) faceSizePct = 100;
        if (keeperFaceWrap) {
          keeperFaceWrap.hidden = false;
          keeperFaceWrap.style.setProperty('--penalty-face-top-fraction', String(faceTopPct / 100));
          keeperFaceWrap.style.setProperty('--penalty-face-left', faceLeftPct + '%');
          keeperFaceWrap.style.setProperty('--penalty-face-size-fraction', String(faceSizePct / 100));
        }
        var faceSrc = option.getAttribute('data-keeper-thumb');
        if (keeperFace && faceSrc) {
          preloadImage(faceSrc);
          keeperFace.src = faceSrc;
        }
        preloadKeeperSet(defaultKeeperSrc);
      } else {
        ['stand', 'left', 'right', 'high'].forEach(function (pose) {
          var src = option.getAttribute('data-keeper-' + pose);
          if (src) {
            keeperSrc[pose] = src;
            preloadImage(src);
          }
        });
      }
    }

    function pickPageCount() {
      if (!pickTrack) return 1;
      return Math.max(1, pickTrack.querySelectorAll('.penalty-game__pick-page').length);
    }

    function syncPickCarousel() {
      if (!pickTrack) return;
      var pages = pickPageCount();
      if (pickPage >= pages) pickPage = pages - 1;
      if (pickPage < 0) pickPage = 0;
      var viewport = pickTrack.parentElement;
      var pageWidth = viewport ? viewport.getBoundingClientRect().width : 0;
      if (pageWidth > 0) {
        pickTrack.style.transform = 'translate3d(-' + pickPage * pageWidth + 'px, 0, 0)';
      } else if (pages > 1) {
        pickTrack.style.transform =
          'translate3d(-' + (pickPage * 100) / pages + '%, 0, 0)';
      } else {
        pickTrack.style.transform = 'translate3d(0, 0, 0)';
      }
      if (pickPrevBtn) pickPrevBtn.disabled = pickPage <= 0;
      if (pickNextBtn) pickNextBtn.disabled = pickPage >= pages - 1;
      if (pickCarousel) {
        pickCarousel.classList.toggle('penalty-game__pick-carousel--solo', pages <= 1);
      }
    }

    function resetPickCarousel() {
      pickPage = 0;
      syncPickCarousel();
    }

    function hideRegister() {
      root.classList.remove('penalty-game--register');
      if (registerEl) {
        registerEl.hidden = true;
        registerEl.setAttribute('aria-hidden', 'true');
      }
    }

    function sessionStorageKey() {
      var slug = root.dataset.articleSlug || '';
      return slug ? SESSION_KEY_PREFIX + slug : '';
    }

    function readStoredSession() {
      var key = sessionStorageKey();
      if (!key) return null;
      try {
        var raw = window.localStorage.getItem(key);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (!data || !data.playerId) return null;
        return data;
      } catch (e) {
        return null;
      }
    }

    function storeSession(playerId, email) {
      var key = sessionStorageKey();
      if (!key || playerId == null) return;
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            playerId: playerId,
            email: email || '',
          })
        );
      } catch (e) {
        /* ignore */
      }
    }

    function clearStoredSession() {
      var key = sessionStorageKey();
      if (!key) return;
      try {
        window.localStorage.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    }

    function showAuthError(target, text) {
      var el = target === 'login' ? loginErrorEl : registerErrorEl;
      if (!el) return;
      if (!text) {
        el.hidden = true;
        el.textContent = '';
        return;
      }
      el.hidden = false;
      el.textContent = text;
    }

    function showRegisterError(text) {
      showAuthError('register', text);
    }

    function showLoginError(text) {
      showAuthError('login', text);
    }

    function setAuthBusy(busy) {
      if (registerSubmitBtn) registerSubmitBtn.disabled = !!busy;
      if (loginSubmitBtn) loginSubmitBtn.disabled = !!busy;
      if (registerNameInput) registerNameInput.disabled = !!busy;
      if (registerEmailInput) registerEmailInput.disabled = !!busy;
      if (loginEmailInput) loginEmailInput.disabled = !!busy;
    }

    function switchAuthTab(mode) {
      authMode = mode === 'login' ? 'login' : 'register';
      authTabs.forEach(function (tab) {
        var active = tab.getAttribute('data-penalty-auth-tab') === authMode;
        tab.classList.toggle('penalty-game__register-tab--active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      if (registerForm) registerForm.hidden = authMode !== 'register';
      if (loginForm) loginForm.hidden = authMode !== 'login';
      if (authDescEl) {
        authDescEl.textContent =
          authMode === 'login'
            ? root.dataset.loginDesc || ''
            : root.dataset.registerDesc || '';
      }
      if (authKickerEl) {
        authKickerEl.textContent = authMode === 'login' ? 'Přihlášení' : 'Registrace';
      }
      showRegisterError('');
      showLoginError('');
      window.requestAnimationFrame(function () {
        if (authMode === 'login') {
          if (loginEmailInput) loginEmailInput.focus();
        } else if (registerNameInput) {
          registerNameInput.focus();
        }
      });
    }

    function selectKeeperById(keeperId) {
      if (!keeperId || !pickOptions.length) return;
      var id = String(keeperId);
      var targetIndex = -1;
      pickOptions.forEach(function (btn, index) {
        var active = btn.dataset.keeperId === id;
        btn.classList.toggle('penalty-game__pick-option--active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
        if (active) targetIndex = index;
      });
      if (targetIndex >= 0) {
        pickPage = Math.floor(targetIndex / PICK_PER_PAGE);
        syncPickCarousel();
      }
    }

    function saveProgress() {
      var playerId = root.dataset.penaltyPlayerId;
      if (!playerId) return;
      fetch('/api/penalty/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          player_id: parseInt(playerId, 10),
          article_slug: root.dataset.articleSlug || '',
          article_title: root.dataset.articleTitle || '',
          goals: goals,
          round: round,
          points_per_goal: pointsPerGoal,
          keeper_id: root.dataset.penaltySelectedKeeper || null,
          started: started,
          finished: finished,
        }),
      }).catch(function () {
        /* best effort */
      });
    }

    function clearServerProgress() {
      var playerId = root.dataset.penaltyPlayerId;
      if (!playerId) return;
      fetch('/api/penalty/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          player_id: parseInt(playerId, 10),
          article_slug: root.dataset.articleSlug || '',
          article_title: root.dataset.articleTitle || '',
          goals: 0,
          round: 1,
          points_per_goal: 1,
          keeper_id: null,
          started: false,
          finished: false,
        }),
      }).catch(function () {
        /* best effort */
      });
    }

    function loadPlayerSession(session) {
      if (!session || session.playerId == null) return;
      playerRegistered = true;
      root.dataset.penaltyPlayerId = String(session.playerId);
      storeSession(session.playerId, session.email || '');
      var progress = session.progress || null;
      if (!progress) return;
      goals = progress.goals || 0;
      round = progress.round || 1;
      pointsPerGoal = progress.points_per_goal || 1;
      finished = !!progress.finished;
      started = !!progress.started;
      if (progress.keeper_id) {
        selectKeeperById(progress.keeper_id);
        applyKeeperSelection(getActivePickOption());
      }
    }

    function continueFromMenu() {
      if (finished) {
        hideRegister();
        hidePicker();
        root.classList.remove('penalty-game--register', 'penalty-game--pick');
        showEndScreen();
        return;
      }
      openPicker();
    }

    function resumeFromProgress(progress) {
      if (!progress) {
        openPicker();
        return;
      }
      goals = progress.goals || 0;
      round = progress.round || 1;
      pointsPerGoal = progress.points_per_goal || 1;
      finished = !!progress.finished;
      started = !!progress.started;
      if (progress.keeper_id) {
        selectKeeperById(progress.keeper_id);
        applyKeeperSelection(getActivePickOption());
      }
      if (finished) {
        hideRegister();
        hidePicker();
        root.classList.remove('penalty-game--menu', 'penalty-game--register', 'penalty-game--pick');
        showEndScreen();
        return;
      }
      if (started) {
        hideRegister();
        hidePicker();
        hideEndScreen();
        root.classList.remove('penalty-game--menu', 'penalty-game--register', 'penalty-game--pick', 'penalty-game--end');
        showHud();
        message.hidden = false;
        message.textContent = 'Klikněte na branku.';
        updateHud();
        scheduleLayoutSync();
        return;
      }
      openPicker();
    }

    function applyPlayerSession(session, opts) {
      loadPlayerSession(session);
      if (opts && opts.navigate) {
        continueFromMenu();
        return;
      }
      resumeFromProgress(session && session.progress);
    }

    function handleAuthResponse(result, mode) {
      if (!result.ok || !result.data || !result.data.ok) {
        var err =
          result.data && result.data.error
            ? result.data.error
            : 'Požadavek se nezdařil. Zkuste to prosím znovu.';
        if (mode === 'login') {
          showLoginError(err);
        } else {
          showRegisterError(err);
        }
        if (result.data && result.data.code === 'EMAIL_EXISTS' && registerEmailInput) {
          switchAuthTab('login');
          if (loginEmailInput) loginEmailInput.value = registerEmailInput.value.trim();
        }
        return;
      }
      applyPlayerSession(result.data, { navigate: true });
    }

    function postAuth(endpoint, payload, mode) {
      setAuthBusy(true);
      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          handleAuthResponse(result, mode);
        })
        .catch(function () {
          if (mode === 'login') {
            showLoginError('Požadavek se nezdařil. Zkuste to prosím znovu.');
          } else {
            showRegisterError('Uložení se nezdařilo. Zkuste to prosím znovu.');
          }
        })
        .finally(function () {
          setAuthBusy(false);
        });
    }

    function openRegister() {
      root.classList.remove('penalty-game--menu', 'penalty-game--end', 'penalty-game--pick');
      root.classList.add('penalty-game--register');
      if (menuEl) menuEl.setAttribute('aria-hidden', 'true');
      hideEndScreen();
      hidePicker();
      if (registerEl) {
        registerEl.hidden = false;
        registerEl.setAttribute('aria-hidden', 'false');
      }
      if (hudEl) hudEl.hidden = true;
      message.hidden = true;
      switchAuthTab(authMode);
      scheduleLayoutSync();
    }

    function submitRegistration() {
      if (playerRegistered) {
        openPicker();
        return;
      }
      var displayName = registerNameInput ? String(registerNameInput.value || '').trim() : '';
      var email = registerEmailInput ? String(registerEmailInput.value || '').trim() : '';
      if (displayName.length < 2) {
        showRegisterError('Zadejte jméno nebo přezdívku (alespoň 2 znaky).');
        if (registerNameInput) registerNameInput.focus();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showRegisterError('Zadejte platný e-mail.');
        if (registerEmailInput) registerEmailInput.focus();
        return;
      }
      showRegisterError('');
      postAuth(
        '/api/penalty/register',
        {
          display_name: displayName,
          email: email,
          article_slug: root.dataset.articleSlug || '',
          article_title: root.dataset.articleTitle || '',
        },
        'register'
      );
    }

    function submitLogin() {
      if (playerRegistered) {
        continueFromMenu();
        return;
      }
      var email = loginEmailInput ? String(loginEmailInput.value || '').trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showLoginError('Zadejte platný e-mail.');
        if (loginEmailInput) loginEmailInput.focus();
        return;
      }
      showLoginError('');
      postAuth(
        '/api/penalty/login',
        {
          email: email,
          article_slug: root.dataset.articleSlug || '',
        },
        'login'
      );
    }

    function tryRestoreSession() {
      var stored = readStoredSession();
      if (!stored || !stored.playerId) return Promise.resolve(false);
      var qs =
        'playerId=' +
        encodeURIComponent(String(stored.playerId)) +
        '&articleSlug=' +
        encodeURIComponent(root.dataset.articleSlug || '');
      return fetch('/api/penalty/session?' + qs, {
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data || !result.data.ok) {
            clearStoredSession();
            return false;
          }
          applyPlayerSession(result.data, { navigate: true });
          return true;
        })
        .catch(function () {
          return false;
        });
    }

    function openPicker() {
      root.classList.remove('penalty-game--menu', 'penalty-game--end', 'penalty-game--register');
      root.classList.add('penalty-game--pick');
      if (menuEl) menuEl.setAttribute('aria-hidden', 'true');
      hideRegister();
      hideEndScreen();
      if (pickEl) {
        pickEl.hidden = false;
        pickEl.setAttribute('aria-hidden', 'false');
      }
      if (hudEl) hudEl.hidden = true;
      message.hidden = true;
      resetPickCarousel();
      applyKeeperSelection(getActivePickOption());
      window.requestAnimationFrame(function () {
        syncPickCarousel();
      });
      scheduleLayoutSync();
    }

    function hidePicker() {
      root.classList.remove('penalty-game--pick');
      if (pickEl) {
        pickEl.hidden = true;
        pickEl.setAttribute('aria-hidden', 'true');
      }
    }

    function beginPlay() {
      applyKeeperSelection(getActivePickOption());
      hidePicker();
      started = true;
      finished = false;
      showHud();
      message.hidden = false;
      message.textContent = 'Klikněte na branku.';
      scheduleLayoutSync();
      updateHud();
      saveProgress();
    }

    function updateEndScore() {
      if (endPointsEl) endPointsEl.textContent = String(calcPoints());
      if (endGoalsEl) endGoalsEl.textContent = formatGoalsLine(goals, MAX_ROUNDS);
    }

    function showEndScreen() {
      finished = true;
      locked = true;
      clearMotion();
      updateEndScore();
      saveProgress();
      root.classList.add('penalty-game--end');
      if (endEl) {
        endEl.hidden = false;
        endEl.setAttribute('aria-hidden', 'false');
      }
      message.hidden = true;
    }

    function hideEndScreen() {
      root.classList.remove('penalty-game--end');
      if (endEl) {
        endEl.hidden = true;
        endEl.setAttribute('aria-hidden', 'true');
      }
    }

    function setKeeperPose(pose) {
      poseClasses.forEach(function (cls) {
        keeper.classList.remove(cls);
      });
      keeper.classList.add('penalty-game__keeper--pose-' + pose);
      var nextSrc = keeperSrc[pose];
      if (nextSrc && keeperBody && keeperBody.getAttribute('src') !== nextSrc) {
        preloadImage(nextSrc);
        keeperBody.src = nextSrc;
      }
    }

    function resetBallSpin() {
      var ballImg = ball.querySelector('.penalty-game__ball-img');
      if (!ballImg) return;
      ballImg.style.animation = 'none';
      void ballImg.offsetWidth;
      ballImg.style.removeProperty('animation');
    }

    function restartAnim(el, className) {
      el.classList.remove(className);
      void el.offsetWidth;
      el.classList.add(className);
    }

    function clearMotion() {
      keeper.classList.remove('penalty-game__keeper--anticipation', 'penalty-game__keeper--diving');
      ball.classList.remove(
        'penalty-game__ball-wrap--flying',
        'penalty-game__ball-wrap--goal',
        'penalty-game__ball-wrap--saved'
      );
      resetBallSpin();
      zoneButtons.forEach(function (btn) {
        btn.disabled = false;
        btn.classList.remove('penalty-game__zone--active');
        btn.blur();
      });
    }

    function keeperBasePos(cache) {
      var c = cache || getLayoutCache();
      return {
        x: c.keeperBaseX,
        y: c.goalLineY,
      };
    }

    function placeKeeperAt(pos) {
      keeper.style.setProperty('--from-x', pos.x + 'px');
      keeper.style.setProperty('--from-y', pos.y + 'px');
      keeper.style.setProperty('--to-x', pos.x + 'px');
      keeper.style.setProperty('--to-y', pos.y + 'px');
    }

    function placeIdle() {
      clearMotion();
      var cache = refreshLayoutCache();
      var spotPos = cache.spot;
      var keeperPos = keeperBasePos(cache);

      ball.style.setProperty('--from-x', spotPos.x + 'px');
      ball.style.setProperty('--from-y', spotPos.y + 'px');
      ball.style.setProperty('--to-x', spotPos.x + 'px');
      ball.style.setProperty('--to-y', spotPos.y + 'px');

      setKeeperPose('stand');
      placeKeeperAt(keeperPos);
    }

    function scheduleLayoutSync() {
      invalidateLayoutCache();
      window.requestAnimationFrame(function () {
        if (root.classList.contains('penalty-game--pick')) {
          syncPickCarousel();
        }
        placeIdle();
      });
    }

    function animateShot(playerZone, keeperZone, done) {
      zoneButtons.forEach(function (btn) {
        btn.disabled = true;
        if (btn.dataset.zone === playerZone) btn.classList.add('penalty-game__zone--active');
      });

      var cache = refreshLayoutCache();
      var spotPos = cache.spot;
      var playerPos = cache.zones[playerZone] || centerInArena(goalEl.querySelector('[data-zone="' + playerZone + '"]'), arena, cache);
      var keeperStart = keeperBasePos(cache);
      var pose = divePose(keeperZone);
      var stayCenter = keeperZone === 'bc';

      ball.style.setProperty('--from-x', spotPos.x + 'px');
      ball.style.setProperty('--from-y', spotPos.y + 'px');
      ball.style.setProperty('--to-x', playerPos.x + 'px');
      ball.style.setProperty('--to-y', playerPos.y + 'px');

      keeper.classList.remove('penalty-game__keeper--anticipation', 'penalty-game__keeper--diving');
      setKeeperPose('stand');
      placeKeeperAt(keeperStart);

      resetBallSpin();

      if (stayCenter) {
        restartAnim(ball, 'penalty-game__ball-wrap--flying');
      } else {
        var keeperEnd = keeperDiveEnd(keeperZone, pose, goalEl, arena, root, cache);

        keeper.style.setProperty('--to-x', keeperEnd.x + 'px');
        keeper.style.setProperty('--to-y', keeperEnd.y + 'px');
        keeper.classList.add('penalty-game__keeper--anticipation');
        restartAnim(ball, 'penalty-game__ball-wrap--flying');

        window.setTimeout(function () {
          keeper.classList.remove('penalty-game__keeper--anticipation');
          setKeeperPose(pose);
          invalidateLayoutCache();
          keeper.style.setProperty('--from-x', keeperStart.x + 'px');
          keeper.style.setProperty('--from-y', keeperStart.y + 'px');
          keeperEnd = keeperDiveEnd(keeperZone, pose, goalEl, arena, root, refreshLayoutCache());
          keeper.style.setProperty('--to-x', keeperEnd.x + 'px');
          keeper.style.setProperty('--to-y', keeperEnd.y + 'px');
          restartAnim(keeper, 'penalty-game__keeper--diving');
        }, 110);
      }

      window.setTimeout(function () {
        var scored = playerZone !== keeperZone;
        ball.classList.add(scored ? 'penalty-game__ball-wrap--goal' : 'penalty-game__ball-wrap--saved');
        if (typeof done === 'function') done(scored);
      }, 800);
    }

    function finishRound(scored) {
      if (scored) goals += 1;
      message.textContent = scored ? 'Gól!' : 'Brankář chytil míč!';
      updateHud();

      window.setTimeout(function () {
        if (round >= MAX_ROUNDS) {
          showEndScreen();
          submitScore();
          return;
        }
        round += 1;
        locked = false;
        updateHud();
        saveProgress();
        placeIdle();
        message.textContent = 'Klikněte na branku.';
      }, 1300);
    }

    function resetGame() {
      round = 1;
      goals = 0;
      locked = false;
      finished = false;
      started = false;
      clearServerProgress();
      hideEndScreen();
      openPicker();
      updateHud();
    }

    function showHud() {
      if (hudEl) hudEl.hidden = false;
    }

    function startGame() {
      root.classList.remove('penalty-game--menu');
      if (menuEl) menuEl.setAttribute('aria-hidden', 'true');
      if (playerRegistered) {
        continueFromMenu();
        return;
      }
      tryRestoreSession().then(function (restored) {
        if (!restored) openRegister();
      });
    }

    function handleZonePick(btn) {
      if (!btn || !started || locked || finished) return;
      locked = true;
      btn.blur();
      var zones = Array.prototype.map.call(zoneButtons, function (b) {
        return b.dataset.zone;
      });
      animateShot(
        btn.dataset.zone,
        pickKeeperZone(zones, btn.dataset.zone, keeperExperience),
        finishRound
      );
    }

    goalEl.addEventListener('click', function (e) {
      handleZonePick(e.target.closest('[data-zone]'));
    });

    goalEl.addEventListener(
      'touchend',
      function (e) {
        var btn = e.target.closest('[data-zone]');
        if (!btn || !started || locked || finished) return;
        e.preventDefault();
        handleZonePick(btn);
      },
      { passive: false }
    );

    if (restartBtn) restartBtn.addEventListener('click', resetGame);
    if (startBtn) startBtn.addEventListener('click', startGame);
    if (registerForm) {
      registerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitRegistration();
      });
    }
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitLogin();
      });
    }
    authTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchAuthTab(tab.getAttribute('data-penalty-auth-tab'));
      });
    });
    if (pickConfirmBtn) pickConfirmBtn.addEventListener('click', beginPlay);

    pickOptions.forEach(function (btn) {
      btn.addEventListener('click', function () {
        pickOptions.forEach(function (option) {
          option.classList.remove('penalty-game__pick-option--active');
          option.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('penalty-game__pick-option--active');
        btn.setAttribute('aria-checked', 'true');
        applyKeeperSelection(btn);
        btn.blur();
      });
    });

    if (pickPrevBtn) {
      pickPrevBtn.addEventListener('click', function () {
        if (pickPage <= 0) return;
        pickPage -= 1;
        syncPickCarousel();
      });
    }

    if (pickNextBtn) {
      pickNextBtn.addEventListener('click', function () {
        if (pickPage >= pickPageCount() - 1) return;
        pickPage += 1;
        syncPickCarousel();
      });
    }

    syncPickCarousel();

    var layoutTimer;
    function syncLayout() {
      window.clearTimeout(layoutTimer);
      layoutTimer = window.setTimeout(function () {
        invalidateLayoutCache();
        syncPickCarousel();
        if (locked || finished) return;
        placeIdle();
      }, 160);
    }

    window.addEventListener('resize', syncLayout);
    window.addEventListener('orientationchange', syncLayout);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncLayout);
    }

    placeIdle();
    updateHud();
  }

  function boot() {
    document.querySelectorAll('[data-penalty-game]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

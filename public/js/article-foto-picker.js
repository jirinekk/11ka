(function () {
  var state = {
    open: false,
    kind: 'hero',
    onPick: null,
    mode: 'albums',
    albums: [],
    players: [],
    album: null,
    player: null,
    photos: [],
    q: '',
    loading: false,
    pickingId: '',
  };

  function el(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function root() {
    return document.getElementById('foto-pick-root');
  }

  function inPhotos() {
    return !!(state.album || state.player);
  }

  function ensureRoot() {
    if (root()) return root();
    var node = el(
      '<div id="foto-pick-root" class="foto-pick" hidden>' +
        '<div class="foto-pick__panel" role="dialog" aria-modal="true" aria-labelledby="foto-pick-title">' +
          '<div class="foto-pick__head">' +
            '<div>' +
              '<p class="foto-pick__kicker">Foták 11ky</p>' +
              '<h3 id="foto-pick-title">Vybrat fotku</h3>' +
            '</div>' +
            '<button type="button" class="foto-pick__close" data-foto-pick-close aria-label="Zavřít">×</button>' +
          '</div>' +
          '<div class="foto-pick__modes" data-foto-pick-modes>' +
            '<button type="button" class="foto-pick__mode is-on" data-foto-pick-mode="albums">Alba</button>' +
            '<button type="button" class="foto-pick__mode" data-foto-pick-mode="players">Hráči</button>' +
          '</div>' +
          '<div class="foto-pick__toolbar">' +
            '<button type="button" class="foto-pick__back" data-foto-pick-back hidden>← Zpět</button>' +
            '<input type="search" class="foto-pick__search" placeholder="Hledat album…" autocomplete="off" />' +
          '</div>' +
          '<p class="foto-pick__status" data-foto-pick-status></p>' +
          '<div class="foto-pick__body" data-foto-pick-body></div>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(node);
    node.addEventListener('click', function (e) {
      if (e.target === node || e.target.closest('[data-foto-pick-close]')) close();
    });
    node.querySelector('[data-foto-pick-back]').addEventListener('click', function () {
      goBack();
    });
    node.querySelectorAll('[data-foto-pick-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.getAttribute('data-foto-pick-mode'));
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) close();
    });
    return node;
  }

  function setStatus(text, isError) {
    var status = ensureRoot().querySelector('[data-foto-pick-status]');
    status.textContent = text || '';
    status.classList.toggle('is-error', !!isError);
  }

  function resetDrill() {
    state.album = null;
    state.player = null;
    state.photos = [];
    state.pickingId = '';
  }

  function goBack() {
    resetDrill();
    state.q = '';
    ensureRoot().querySelector('.foto-pick__search').value = '';
    if (state.mode === 'players') loadPlayers();
    else loadAlbums();
  }

  function setMode(mode) {
    state.mode = mode === 'players' ? 'players' : 'albums';
    resetDrill();
    state.q = '';
    var node = ensureRoot();
    node.querySelector('.foto-pick__search').value = '';
    if (state.mode === 'players') loadPlayers();
    else loadAlbums();
  }

  function render() {
    var node = ensureRoot();
    var back = node.querySelector('[data-foto-pick-back]');
    var search = node.querySelector('.foto-pick__search');
    var title = node.querySelector('#foto-pick-title');
    var body = node.querySelector('[data-foto-pick-body]');
    var modes = node.querySelector('[data-foto-pick-modes]');
    var photosView = inPhotos();
    back.hidden = !photosView;
    modes.hidden = photosView;
    node.querySelectorAll('[data-foto-pick-mode]').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-foto-pick-mode') === state.mode);
    });
    search.placeholder = state.mode === 'players' ? 'Hledat hráče…' : 'Hledat album…';
    if (state.album) title.textContent = state.album.title;
    else if (state.player) title.textContent = state.player.name;
    else title.textContent = state.mode === 'players' ? 'Vybrat fotku hráče' : 'Vybrat fotku z alba';

    if (state.loading && !state.albums.length && !state.players.length && !state.photos.length) {
      body.innerHTML = '<p class="foto-pick__empty">Načítám…</p>';
      return;
    }
    if (photosView) {
      renderPhotos(body);
      return;
    }
    if (state.mode === 'players') {
      renderPlayers(body);
      return;
    }
    renderAlbums(body);
  }

  function renderPhotos(body) {
    if (!state.photos.length) {
      body.innerHTML =
        '<p class="foto-pick__empty">' +
        (state.player ? 'Pro tohoto hráče zatím nejsou otagované fotky.' : 'V albu zatím nejsou fotky.') +
        '</p>';
      return;
    }
    body.innerHTML =
      '<div class="foto-pick__grid foto-pick__grid--photos">' +
      state.photos
        .map(function (p) {
          var busy = state.pickingId === p.id ? ' is-busy' : '';
          return (
            '<button type="button" class="foto-pick__photo' +
            busy +
            '" data-foto-id="' +
            escapeHtml(p.id) +
            '">' +
            '<img src="' +
            escapeHtml(p.thumbSrc) +
            '" alt="">' +
            '</button>'
          );
        })
        .join('') +
      '</div>';
    body.querySelectorAll('[data-foto-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pickPhoto(btn.getAttribute('data-foto-id'));
      });
    });
  }

  function renderPlayers(body) {
    if (!state.players.length) {
      body.innerHTML =
        '<p class="foto-pick__empty">' +
        (state.q ? 'Žádný hráč se nenašel.' : 'Zadej jméno hráče.') +
        '</p>';
      return;
    }
    body.innerHTML =
      '<div class="foto-pick__people">' +
      state.players
        .map(function (p) {
          var meta = [];
          if (p.number != null && p.number !== '') meta.push('#' + p.number);
          if (p.team) meta.push(p.team);
          if (p.photo_count) meta.push(p.photo_count + ' fotek');
          return (
            '<button type="button" class="foto-pick__person" data-player-id="' +
            escapeHtml(p.id) +
            '">' +
            '<img src="' +
            escapeHtml(p.photo || '/user.png') +
            '" alt="">' +
            '<span class="foto-pick__meta">' +
            '<strong>' +
            escapeHtml(p.name) +
            '</strong>' +
            '<em>' +
            escapeHtml(meta.join(' · ')) +
            '</em>' +
            '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>';
    body.querySelectorAll('[data-player-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        loadPlayerPhotos(btn.getAttribute('data-player-id'));
      });
    });
  }

  function renderAlbums(body) {
    if (!state.albums.length) {
      body.innerHTML = '<p class="foto-pick__empty">Žádné album se nenašlo.</p>';
      return;
    }
    body.innerHTML =
      '<div class="foto-pick__grid">' +
      state.albums
        .map(function (a) {
          var cover = a.cover_url
            ? '<img src="' + escapeHtml(a.cover_url) + '" alt="">'
            : '<span class="foto-pick__cover-empty"></span>';
          return (
            '<button type="button" class="foto-pick__album" data-album-id="' +
            escapeHtml(a.id) +
            '">' +
            '<span class="foto-pick__cover">' +
            cover +
            '</span>' +
            '<span class="foto-pick__meta">' +
            '<strong>' +
            escapeHtml(a.title) +
            '</strong>' +
            '<em>' +
            escapeHtml((a.date_label || '') + (a.photographer_name ? ' · ' + a.photographer_name : '')) +
            '</em>' +
            '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>';
    body.querySelectorAll('[data-album-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        loadPhotos(btn.getAttribute('data-album-id'));
      });
    });
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || 'Chyba načtení');
        return j;
      });
    });
  }

  function loadAlbums() {
    state.loading = true;
    setStatus('');
    render();
    var q = encodeURIComponent(state.q || '');
    fetchJson('/administrace/foto-alba?q=' + q, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (data) {
        state.albums = data.albums || [];
        state.loading = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        setStatus(err.message || 'Alba se nepodařilo načíst.', true);
        render();
      });
  }

  function loadPlayers() {
    state.loading = true;
    setStatus(state.q ? '' : 'Hledej podle jména, nebo vyber hráče s otagovanými fotkami.');
    render();
    var q = encodeURIComponent(state.q || '');
    fetchJson('/administrace/foto-hraci?q=' + q, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (data) {
        state.players = data.players || [];
        state.loading = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        setStatus(err.message || 'Hráče se nepodařilo načíst.', true);
        render();
      });
  }

  function loadPhotos(albumId) {
    state.loading = true;
    state.q = '';
    state.player = null;
    ensureRoot().querySelector('.foto-pick__search').value = '';
    setStatus('Načítám fotky…');
    render();
    fetchJson('/administrace/foto-alba/' + encodeURIComponent(albumId) + '/fotky', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (data) {
        state.album = data.album;
        state.photos = data.photos || [];
        state.loading = false;
        setStatus(data.album && data.album.credit ? 'Zdroj: ' + data.album.credit : '');
        render();
      })
      .catch(function (err) {
        state.loading = false;
        setStatus(err.message || 'Fotky se nepodařilo načíst.', true);
        render();
      });
  }

  function loadPlayerPhotos(playerId) {
    state.loading = true;
    state.q = '';
    state.album = null;
    ensureRoot().querySelector('.foto-pick__search').value = '';
    setStatus('Načítám fotky hráče…');
    render();
    fetchJson('/administrace/foto-hraci/' + encodeURIComponent(playerId) + '/fotky', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (data) {
        state.player = data.player;
        state.photos = data.photos || [];
        state.loading = false;
        setStatus(
          state.photos.length
            ? 'Zdroj se doplní automaticky jako jméno fotografa / 11ka.'
            : ''
        );
        render();
      })
      .catch(function (err) {
        state.loading = false;
        setStatus(err.message || 'Fotky hráče se nepodařilo načíst.', true);
        render();
      });
  }

  function pickPhoto(photoId) {
    if (state.pickingId) return;
    var photo = state.photos.filter(function (p) {
      return p.id === photoId;
    })[0];
    state.pickingId = photoId;
    setStatus('Připravuji fotku…');
    render();
    fetchJson('/administrace/foto-fotky/' + encodeURIComponent(photoId) + '/kopirovat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ kind: state.kind === 'hero' ? 'hero' : 'inline' }),
    })
      .then(function (data) {
        var picked = {
          location: data.location,
          credit: data.credit || (photo && photo.credit) || (state.album && state.album.credit) || '11ka',
          photographer: data.photographer || (photo && photo.photographer_name) || '',
        };
        var cb = state.onPick;
        close();
        if (typeof cb === 'function') cb(picked);
      })
      .catch(function (err) {
        state.pickingId = '';
        setStatus(err.message || 'Fotku se nepodařilo vybrat.', true);
        render();
      });
  }

  function open(options) {
    options = options || {};
    state.open = true;
    state.kind = options.kind === 'inline' ? 'inline' : 'hero';
    state.onPick = options.onPick || null;
    state.mode = 'albums';
    resetDrill();
    state.albums = [];
    state.players = [];
    state.q = '';
    var node = ensureRoot();
    node.hidden = false;
    node.querySelector('.foto-pick__search').value = '';
    loadAlbums();
  }

  function close() {
    state.open = false;
    state.onPick = null;
    state.pickingId = '';
    var node = root();
    if (node) node.hidden = true;
  }

  var searchInputTimer;
  document.addEventListener('input', function (e) {
    if (!e.target || !e.target.classList || !e.target.classList.contains('foto-pick__search')) return;
    state.q = String(e.target.value || '').trim();
    clearTimeout(searchInputTimer);
    searchInputTimer = setTimeout(function () {
      if (inPhotos()) return;
      if (state.mode === 'players') loadPlayers();
      else loadAlbums();
    }, 180);
  });

  window.ArticleFotoPicker = { open: open, close: close };
})();

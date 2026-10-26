(function () {
  const root = document.getElementById('foto-gallery');
  if (!root) return;
  let photos = [];
  try {
    photos = JSON.parse(decodeURIComponent(root.getAttribute('data-photos') || '') || '[]');
  } catch (e) {
    photos = [];
  }
  let squads = { home: null, away: null };
  try {
    squads = JSON.parse(decodeURIComponent(root.getAttribute('data-squads') || '') || '{}') || {};
  } catch (e) {
    squads = {};
  }
  const canEdit = root.getAttribute('data-edit') === '1';
  const albumId = root.getAttribute('data-album') || '';
  let open = null;
  let showTags = true;
  let player = null;
  let stadiumOnly = false;
  let hold = null;

  function visible() {
    return photos.filter((p) => {
      if (stadiumOnly && p.kind !== 'STADIUM') return false;
      if (player && !(p.tags || []).some((t) => t.player && t.player.slug === player)) return false;
      return true;
    });
  }

  function close() {
    open = null;
    hold = null;
    draw();
  }

  function currentPhoto() {
    const list = visible();
    return open !== null ? list[open] : null;
  }

  function playerRow(p) {
    const num = p.number != null && p.number !== '' ? '#' + p.number : '';
    const on = hold && hold.id === p.id ? ' is-on' : '';
    const src = escapeHtml(p.photo || '/user.png');
    const local = '/players/' + encodeURIComponent(p.livesportId || p.id) + '.jpg';
    return `<button type="button" class="foto-squad__player${on}" data-hold-player="${escapeHtml(p.id)}" data-hold-name="${escapeHtml(p.name)}" data-hold-slug="${escapeHtml(p.slug)}" data-hold-number="${p.number != null ? p.number : ''}">
      <img src="${src}" alt="" loading="lazy" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${local}';}else{this.onerror=null;this.src='/user.png';}" />
      <span class="foto-squad__num">${num}</span>
      <span class="foto-squad__name">${escapeHtml(p.name)}</span>
    </button>`;
  }

  function teamBlock(team, fallback) {
    const name = (team && (team.name || team.short)) || fallback;
    const crest = team && team.logo
      ? `<img class="foto-squad__crest" src="${escapeHtml(team.logo)}" alt="" />`
      : '';
    const people = (team && team.players) || [];
    const list = people.length
      ? people.map(playerRow).join('')
      : '<p class="foto-squad__empty">Soupiska chybí.</p>';
    return `<section class="foto-squad__team">
      <h3>${crest}${escapeHtml(name)}</h3>
      <div class="foto-squad__list">${list}</div>
    </section>`;
  }

  function squadHtml() {
    if (!canEdit) return '';
    const hint = hold
      ? `Klikni na ${escapeHtml(hold.name)} na fotce`
      : 'Vyber hráče, pak klikni na fotku';
    return `<aside class="foto-squad">
      <p class="foto-squad__hint" data-hold-hint="1">${hint}</p>
      ${teamBlock(squads.home, 'Domácí')}
      ${teamBlock(squads.away, 'Hosté')}
    </aside>`;
  }

  function applyHold() {
    root.querySelectorAll('[data-hold-player]').forEach((btn) => {
      btn.classList.toggle('is-on', !!(hold && btn.getAttribute('data-hold-player') === hold.id));
    });
    const pic = root.querySelector('.foto-lb__pic');
    if (pic) pic.classList.toggle('is-edit', !!hold);
    const hint = root.querySelector('[data-hold-hint]');
    if (hint) {
      hint.textContent = hold
        ? 'Klikni na ' + hold.name + ' na fotce'
        : 'Vyber hráče, pak klikni na fotku';
    }
    const chrome = root.querySelector('[data-hold-chrome]');
    if (chrome) {
      const list = visible();
      chrome.textContent =
        open + 1 + ' z ' + list.length + (canEdit ? (hold ? ' · klikni na fotku' : ' · vyber hráče ze soupisky') : '');
    }
  }

  function draw() {
    const list = visible();
    const players = [];
    const seen = new Set();
    let hasStadium = false;
    photos.forEach((p) => {
      if (p.kind === 'STADIUM') hasStadium = true;
      (p.tags || []).forEach((t) => {
        if (t.player && !seen.has(t.player.slug)) {
          seen.add(t.player.slug);
          players.push(t.player);
        }
      });
    });
    const chips = [];
    chips.push(
      `<button type="button" class="team-chip${!player && !stadiumOnly ? ' is-active' : ''}" data-all="1">Vše</button>`
    );
    if (hasStadium) {
      chips.push(
        `<button type="button" class="team-chip${stadiumOnly ? ' is-active' : ''}" data-stadium="1">Stadion</button>`
      );
    }
    players.slice(0, 12).forEach((p) => {
      chips.push(
        `<a class="team-chip" href="/foto/hraci/${encodeURIComponent(p.slug)}">${p.number != null ? '#' + p.number + ' ' : ''}${escapeHtml(p.name)}</a>`
      );
    });

    const tiles = list
      .map((p, i) => {
        return `<button type="button" class="photo-tile" data-open="${i}"><img src="${p.thumbSrc}" alt="" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async" onerror="this.parentNode.classList.add('is-missing')" /></button>`;
      })
      .join('');

    let lightbox = '';
    if (open !== null && list[open]) {
      const cur = list[open];
      const tags = showTags
        ? (cur.tags || [])
            .map((t) => {
              const label = `${t.player.number != null ? '#' + t.player.number + ' ' : ''}${escapeHtml(t.player.name)}`;
              if (canEdit) {
                return `<button type="button" class="foto-tag foto-tag--edit" data-del-tag="${escapeHtml(t.id)}" style="left:${t.x}%;top:${t.y}%" title="Odebrat štítek">${label} ×</button>`;
              }
              return `<a class="foto-tag" href="/foto/hraci/${encodeURIComponent(t.player.slug)}" style="left:${t.x}%;top:${t.y}%">${label}</a>`;
            })
            .join('')
        : '';
      const chromeHint = canEdit
        ? hold
          ? ' · klikni na fotku'
          : ' · vyber hráče ze soupisky'
        : '';
      lightbox = `<div class="foto-lb${canEdit ? ' has-squad' : ''}" data-lb="1">
        <div class="lightbox-chrome">
          <button type="button" class="foto-lb__icon" data-close="1" aria-label="Zavřít">×</button>
          <p class="text-[13px] font-medium tabular-nums tracking-tight text-white/75" data-hold-chrome="1">${open + 1} z ${list.length}${chromeHint}</p>
          <div class="flex items-center gap-1">
            ${(cur.tags || []).length || canEdit ? `<button type="button" class="rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white" data-tags="1">${showTags ? 'Štítky' : 'Bez štítků'}</button>` : ''}
            ${canEdit && albumId ? `<button type="button" class="rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-red-200" data-del-photo="${escapeHtml(cur.id)}">Smazat</button>` : ''}
            <a class="foto-lb__icon" href="${cur.viewSrc}&dl=original" aria-label="Stáhnout">↓</a>
          </div>
        </div>
        <div class="foto-lb__body">
          <div class="foto-lb__stage">
            <button type="button" class="foto-lb__nav foto-lb__nav--prev" data-prev="1" aria-label="Předchozí">‹</button>
            <div class="foto-lb__pic${hold ? ' is-edit' : ''}">
              <img src="${cur.viewSrc}" alt="${escapeHtml(cur.originalName || '')}" data-tag-img="1"${cur.width && cur.height ? ` width="${Number(cur.width)}" height="${Number(cur.height)}"` : ''} />
              ${tags}
            </div>
            <button type="button" class="foto-lb__nav foto-lb__nav--next" data-next="1" aria-label="Další">›</button>
          </div>
          ${squadHtml()}
        </div>
      </div>`;
    }

    root.innerHTML =
      (chips.length > 1 ? `<div class="mt-4 flex gap-1.5 overflow-x-auto pb-1">${chips.join('')}</div>` : '') +
      (list.length
        ? `<div class="photo-grid mt-4">${tiles}</div>`
        : `<p class="mt-16 text-center text-[15px] text-11muted">${photos.length ? 'Pro ten filtr v albu nic není.' : 'V tomhle albu ještě nejsou fotky.'}</p>`) +
      lightbox;
    document.body.style.overflow = open !== null ? 'hidden' : '';
    fitOpenImage();
  }

  function fitOpenImage() {
    const img = root.querySelector('[data-tag-img]');
    const stage = root.querySelector('.foto-lb__stage');
    if (!img || !stage) return;
    const apply = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const cs = getComputedStyle(stage);
      const availW = Math.max(
        1,
        stage.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      );
      const availH = Math.max(
        1,
        stage.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)
      );
      const scale = Math.min(1, availW / img.naturalWidth, availH / img.naturalHeight);
      img.style.width = Math.floor(img.naturalWidth * scale) + 'px';
      img.style.height = Math.floor(img.naturalHeight * scale) + 'px';
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
  }

  async function placeTag(x, y) {
    const cur = currentPhoto();
    if (!hold || !cur) return;
    const extra = {
      id: hold.id,
      name: hold.name,
      slug: hold.slug,
      number: hold.number === '' ? null : hold.number,
    };
    try {
      const res = await fetch('/foto/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          photoId: cur.id,
          playerId: extra.id,
          x,
          y,
        }),
      });
      const data = await res.json();
      const photo = photos.find((p) => p.id === cur.id);
      if (photo) {
        photo.tags = (photo.tags || []).filter((t) => !(t.player && t.player.id === extra.id));
        if (data && data.tag) {
          photo.tags.push(data.tag);
        } else {
          photo.tags.push({
            id: (data && data.id) || extra.id,
            x,
            y,
            player: extra,
          });
        }
      }
    } catch {
      /* keep hold so they can retry */
      return;
    }
    hold = null;
    draw();
  }

  async function deleteTag(id) {
    try {
      await fetch('/foto/api/tags/' + encodeURIComponent(id) + '/smazat', { method: 'POST' });
    } catch {
      /* ignore */
    }
    photos.forEach((p) => {
      p.tags = (p.tags || []).filter((t) => t.id !== id);
    });
    draw();
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  root.addEventListener('click', (e) => {
    const holdBtn = e.target.closest('[data-hold-player]');
    if (holdBtn) {
      e.preventDefault();
      const id = holdBtn.getAttribute('data-hold-player');
      if (hold && hold.id === id) {
        hold = null;
      } else {
        hold = {
          id,
          name: holdBtn.getAttribute('data-hold-name'),
          slug: holdBtn.getAttribute('data-hold-slug'),
          number: holdBtn.getAttribute('data-hold-number'),
        };
      }
      applyHold();
      return;
    }
    const delTag = e.target.closest('[data-del-tag]');
    if (delTag) {
      e.preventDefault();
      e.stopPropagation();
      deleteTag(delTag.getAttribute('data-del-tag'));
      return;
    }
    const delPhoto = e.target.closest('[data-del-photo]');
    if (delPhoto && albumId) {
      if (!confirm('Smazat tuhle fotku z alba?')) return;
      const form = document.createElement('form');
      form.method = 'post';
      form.action = `/foto/studio/alba/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(delPhoto.getAttribute('data-del-photo'))}/smazat`;
      document.body.appendChild(form);
      form.submit();
      return;
    }
    if (canEdit && hold && e.target.closest('[data-tag-img]')) {
      const img = e.target.closest('[data-tag-img]');
      const rect = img.getBoundingClientRect();
      const cur = currentPhoto();
      if (!cur || !rect.width || !rect.height) return;
      placeTag(
        Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100)),
        Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100))
      );
      return;
    }
    const t = e.target.closest('[data-open],[data-close],[data-prev],[data-next],[data-all],[data-stadium],[data-tags]');
    if (!t) return;
    if (t.hasAttribute('data-open')) {
      open = Number(t.getAttribute('data-open'));
    } else if (t.hasAttribute('data-close')) close();
    else if (t.hasAttribute('data-prev')) {
      open = open === null ? open : (open + visible().length - 1) % visible().length;
    } else if (t.hasAttribute('data-next')) {
      open = open === null ? open : (open + 1) % visible().length;
    } else if (t.hasAttribute('data-all')) {
      player = null;
      stadiumOnly = false;
      open = null;
      hold = null;
    } else if (t.hasAttribute('data-stadium')) {
      stadiumOnly = !stadiumOnly;
      player = null;
      open = null;
      hold = null;
    } else if (t.hasAttribute('data-tags')) showTags = !showTags;
    if (!t.hasAttribute('data-close')) draw();
  });

  window.addEventListener('resize', () => {
    if (open !== null) fitOpenImage();
  });

  window.addEventListener('keydown', (e) => {
    if (open === null) return;
    if (e.key === 'Escape') {
      if (hold) {
        hold = null;
        applyHold();
        return;
      }
      close();
    }
    if (e.key === 'ArrowLeft') open = (open + visible().length - 1) % visible().length;
    if (e.key === 'ArrowRight') open = (open + 1) % visible().length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') draw();
  });

  draw();
})();

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
  let squadQuery = '';

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

  function lastName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const particle = /^(van|von|de|der|den|di|da|la|le|del|du|ter|ten|tot|te)$/i;
    if (parts.length >= 4 && particle.test(parts[parts.length - 3]) && particle.test(parts[parts.length - 2])) {
      return parts.slice(-3).join(' ');
    }
    if (parts.length >= 2 && particle.test(parts[parts.length - 2])) {
      return parts.slice(-2).join(' ');
    }
    return parts[parts.length - 1];
  }

  function playerPhoto(player) {
    if (player && player.photo && player.photo !== '/user.png') return player.photo;
    const all = []
      .concat((squads.home && squads.home.players) || [])
      .concat((squads.away && squads.away.players) || []);
    const hit = all.find(
      (p) =>
        (player && player.id && p.id === player.id) ||
        (player && player.slug && p.slug === player.slug) ||
        (player && player.name && p.name === player.name)
    );
    return (hit && hit.photo) || '/user.png';
  }

  function playerRow(p) {
    const num = p.number != null && p.number !== '' ? String(p.number) : '';
    const on = hold && hold.id === p.id ? ' is-on' : '';
    const label = lastName(p.name) || p.name || '';
    const src = escapeHtml(playerPhoto(p));
    return `<button type="button" class="foto-squad__player${on}" title="${escapeHtml(p.name || '')}" data-hold-player="${escapeHtml(p.id)}" data-hold-name="${escapeHtml(p.name)}" data-hold-slug="${escapeHtml(p.slug)}" data-hold-number="${p.number != null ? p.number : ''}" data-hold-photo="${src}">
      <img src="${src}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/user.png'" />
      <span class="foto-squad__num">${escapeHtml(num)}</span>
      <span class="foto-squad__name">${escapeHtml(label)}</span>
    </button>`;
  }

  function teamBlock(team, fallback) {
    const name = (team && (team.short || team.name)) || fallback;
    const crest = team && team.logo
      ? `<img class="foto-squad__crest" src="${escapeHtml(team.logo)}" alt="" />`
      : '';
    const groups = (team && team.groups && team.groups.length)
      ? team.groups
      : [{ title: '', players: (team && team.players) || [] }];
    const hasPeople = groups.some((g) => (g.players || []).length);
    const list = hasPeople
      ? groups.map((g) => {
          const heading = g.title
            ? `<h4 class="foto-squad__pos">${escapeHtml(g.title)}</h4>`
            : '';
          return `${heading}${(g.players || []).map(playerRow).join('')}`;
        }).join('')
      : '<p class="foto-squad__empty">Soupiska chybí.</p>';
    return `<section class="foto-squad__team">
      <h3>${crest}${escapeHtml(name)}</h3>
      <div class="foto-squad__list">${list}</div>
    </section>`;
  }

  function squadHtml() {
    if (!canEdit) return '';
    const hint = hold
      ? `Teď ${escapeHtml(lastName(hold.name) || hold.name)}`
      : 'Vyber hráče';
    return `<aside class="foto-squad">
      <p class="foto-squad__hint" data-hold-hint="1">${hint}</p>
      <input class="foto-squad__find" type="search" data-squad-find placeholder="Hledat…" autocomplete="off" value="${escapeHtml(squadQuery)}" />
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
        ? 'Teď ' + (lastName(hold.name) || hold.name)
        : 'Vyber hráče';
    }
    const chrome = root.querySelector('[data-hold-chrome]');
    if (chrome) {
      const list = visible();
      chrome.textContent =
        open + 1 + ' z ' + list.length + (canEdit ? (hold ? ' · klikni na fotku' : '') : '');
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
      const label = (p.number != null ? p.number + '  ' : '') + lastName(p.name || '');
      chips.push(
        `<a class="team-chip" href="/foto/hraci/${encodeURIComponent(p.slug)}">${escapeHtml(label)}</a>`
      );
    });

    const tiles = list
      .map((p, i) => {
        const del = canEdit
          ? `<button type="button" class="photo-tile__del" data-del-photo="${escapeHtml(p.id)}" aria-label="Smazat fotku">×</button>`
          : '';
        return `<div class="photo-tile-wrap"><button type="button" class="photo-tile" data-open="${i}"><img src="${p.thumbSrc}" alt="" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async" onerror="this.parentNode.classList.add('is-missing')" /></button>${del}</div>`;
      })
      .join('');

    let lightbox = '';
    if (open !== null && list[open]) {
      const cur = list[open];
      const tags = showTags
        ? (cur.tags || [])
            .map((t) => {
              const name = escapeHtml(lastName(t.player.name) || t.player.name || '');
              const pic = `<img class="foto-tag__pic" src="${escapeHtml(playerPhoto(t.player))}" alt="" onerror="this.onerror=null;this.src='/user.png'" />`;
              const no = t.player.number != null ? `<span class="foto-tag__no">${escapeHtml(String(t.player.number))}</span>` : '';
              const inner = `${pic}${no}<span class="foto-tag__name">${name}</span>`;
              if (canEdit) {
                return `<button type="button" class="foto-tag foto-tag--edit" data-del-tag="${escapeHtml(t.id)}" style="left:${t.x}%;top:${t.y}%" title="Odebrat ${escapeHtml(t.player.name)}">${inner}<span class="foto-tag__x" aria-hidden="true">×</span></button>`;
              }
              return `<a class="foto-tag" href="/foto/hraci/${encodeURIComponent(t.player.slug)}" style="left:${t.x}%;top:${t.y}%">${inner}</a>`;
            })
            .join('')
        : '';
      const chromeHint = canEdit && hold ? ' · klikni na fotku' : '';
      lightbox = `<div class="foto-lb${canEdit ? ' has-squad' : ''}" data-lb="1">
        <div class="lightbox-chrome">
          <button type="button" class="foto-lb__icon" data-close="1" aria-label="Zavřít">×</button>
          <p class="text-[13px] font-medium tabular-nums tracking-tight text-white/75" data-hold-chrome="1">${open + 1} z ${list.length}${chromeHint}</p>
          <div class="flex items-center gap-1">
            ${(cur.tags || []).length || canEdit ? `<button type="button" class="foto-lb__chip" data-tags="1">${showTags ? 'Štítky' : 'Bez štítků'}</button>` : ''}
            ${canEdit && albumId ? `<button type="button" class="rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-red-200" data-del-photo="${escapeHtml(cur.id)}">Smazat</button>` : ''}
            ${downloadMenu(cur)}
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
    applySquadFilter();
  }

  function applySquadFilter() {
    const needle = String(squadQuery || '').trim().toLowerCase();
    root.querySelectorAll('.foto-squad__player').forEach((btn) => {
      const hay = String(btn.getAttribute('data-hold-name') || '').toLowerCase();
      btn.hidden = Boolean(needle) && hay.indexOf(needle) === -1;
    });
    root.querySelectorAll('.foto-squad__pos').forEach((heading) => {
      let node = heading.nextElementSibling;
      let any = false;
      while (node && !node.classList.contains('foto-squad__pos')) {
        if (node.classList.contains('foto-squad__player') && !node.hidden) any = true;
        node = node.nextElementSibling;
      }
      heading.hidden = Boolean(needle) && !any;
    });
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
      photo: hold.photo || playerPhoto(hold),
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

  function downloadHref(cur, fmt) {
    try {
      const u = new URL(cur.viewSrc, window.location.origin);
      u.searchParams.delete('v');
      u.searchParams.set('dl', fmt);
      return u.pathname + u.search;
    } catch {
      return `/foto/media/${encodeURIComponent(cur.id)}?dl=${encodeURIComponent(fmt)}`;
    }
  }

  function downloadMenu(cur) {
    return `<details class="foto-dl">
      <summary class="foto-lb__icon" aria-label="Stáhnout">↓</summary>
      <div class="foto-dl__menu">
        <a href="${downloadHref(cur, 'jpeg')}">JPEG</a>
        <a href="${downloadHref(cur, 'webp')}">WebP</a>
        <a href="${downloadHref(cur, 'original')}">Originál</a>
      </div>
    </details>`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  root.addEventListener('input', (e) => {
    const field = e.target.closest('[data-squad-find]');
    if (!field) return;
    squadQuery = String(field.value || '');
    applySquadFilter();
  });

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
          photo: holdBtn.getAttribute('data-hold-photo') || '',
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

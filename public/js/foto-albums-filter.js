(function () {
  function fold(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function syncDateEmpty(label) {
    var input = label.querySelector('input[type="date"]');
    if (!input) return;
    label.classList.toggle('is-empty', !input.value);
  }

  document.querySelectorAll('.fotak-filter__date').forEach(function (label) {
    var input = label.querySelector('input[type="date"]');
    if (!input) return;
    syncDateEmpty(label);
    ['input', 'change'].forEach(function (eventName) {
      input.addEventListener(eventName, function () {
        syncDateEmpty(label);
      });
    });
    input.addEventListener('focus', function () {
      label.classList.add('is-open');
    });
    input.addEventListener('blur', function () {
      label.classList.remove('is-open');
      syncDateEmpty(label);
    });
  });

  var form = document.querySelector('[data-foto-albums-filter]');
  if (!form) return;

  var qInput = form.querySelector('[data-foto-albums-q]');
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.fotak-tile-grid .fotak-tile'));
  var countEl = document.querySelector('[data-foto-albums-count]');
  var emptyEl = document.querySelector('[data-foto-albums-empty]');
  var grid = document.querySelector('.fotak-tile-grid');

  function plural(n) {
    if (n === 1) return '1 zápas v archivu';
    if (n >= 2 && n <= 4) return n + ' zápasy v archivu';
    return n + ' zápasů v archivu';
  }

  function applyQuery() {
    var query = fold(qInput && qInput.value);
    var visible = 0;
    tiles.forEach(function (tile) {
      var hay = fold(tile.getAttribute('data-search') || tile.textContent);
      var ok = !query || hay.indexOf(query) !== -1;
      tile.hidden = !ok;
      if (ok) visible += 1;
    });
    if (countEl) countEl.textContent = plural(visible);
    if (emptyEl) {
      if (visible) emptyEl.setAttribute('hidden', '');
      else emptyEl.removeAttribute('hidden');
    }
    if (grid) {
      if (visible) grid.removeAttribute('hidden');
      else grid.setAttribute('hidden', '');
    }
  }

  if (qInput) {
    qInput.addEventListener('input', applyQuery);
    applyQuery();
  }

  form.querySelectorAll('select[name="liga"], input[type="date"]').forEach(function (el) {
    el.addEventListener('change', function () {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    });
  });
})();

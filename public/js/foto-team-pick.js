(function () {
  var root = document.querySelector('[data-foto-team-form]');
  if (!root) return;

  var dataNode = document.getElementById('foto-team-data');
  var payload = { teams: [], leagues: {}, groups: [] };
  try {
    payload = JSON.parse(dataNode && dataNode.textContent ? dataNode.textContent : '{}');
  } catch (err) {
    payload = { teams: [], leagues: {}, groups: [] };
  }

  var teams = payload.teams || [];
  var leagueMap = payload.leagues || {};
  var byId = {};
  teams.forEach(function (t) {
    byId[t.id] = t;
  });

  function fold(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function preferredLeagues(comp) {
    return leagueMap[comp] || [];
  }

  function competition() {
    var sel = root.querySelector('[data-foto-comp]');
    return sel ? sel.value : '';
  }

  function logoHtml(team) {
    if (team && team.logo) {
      return '<img src="' + String(team.logo).replace(/"/g, '&quot;') + '" alt="">';
    }
    return '<span class="fotak-team-pick__ph">' + String((team && team.short) || '?').slice(0, 3) + '</span>';
  }

  function renderList(picker, query) {
    var list = picker.querySelector('[data-foto-team-list]');
    var needle = fold(query);
    var pref = preferredLeagues(competition());
    var matched = teams.filter(function (t) {
      if (!needle) return true;
      return fold(t.name).indexOf(needle) !== -1 || fold(t.short).indexOf(needle) !== -1 || fold(t.league).indexOf(needle) !== -1;
    });
    var grouped = {};
    matched.forEach(function (t) {
      var key = t.league || 'Ostatní';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    });
    var order = pref.slice();
    Object.keys(grouped)
      .sort(function (a, b) {
        return a.localeCompare(b, 'cs');
      })
      .forEach(function (league) {
        if (order.indexOf(league) === -1) order.push(league);
      });
    var html = '';
    var selected = picker.querySelector('[data-foto-team-id]').value;
    var shown = 0;
    order.forEach(function (league) {
      var rows = grouped[league];
      if (!rows || !rows.length) return;
      var isPref = !pref.length || pref.indexOf(league) !== -1;
      html +=
        '<p class="fotak-team-pick__group' +
        (isPref ? '' : ' is-other') +
        '">' +
        league +
        '</p>';
      rows.forEach(function (t) {
        shown += 1;
        html +=
          '<button type="button" class="fotak-team-pick__opt' +
          (t.id === selected ? ' is-on' : '') +
          '" data-id="' +
          t.id +
          '">' +
          logoHtml(t) +
          '<span><strong>' +
          t.name.replace(/</g, '&lt;') +
          '</strong><em>' +
          String(t.short || '').replace(/</g, '&lt;') +
          '</em></span></button>';
      });
    });
    if (!shown) html = '<p class="fotak-team-pick__empty">Žádný tým se nenašel.</p>';
    list.innerHTML = html;
  }

  function setTeam(picker, team) {
    var hidden = picker.querySelector('[data-foto-team-id]');
    var label = picker.querySelector('[data-foto-team-label]');
    hidden.value = team ? team.id : '';
    label.innerHTML = team
      ? logoHtml(team) + '<span>' + team.name.replace(/</g, '&lt;') + '</span>'
      : picker.getAttribute('data-placeholder') || 'Vybrat tým';
    picker.classList.toggle('has-value', !!team);
    closePicker(picker);
  }

  function openPicker(picker) {
    document.querySelectorAll('[data-foto-team]').forEach(function (node) {
      if (node !== picker) closePicker(node);
    });
    var pop = picker.querySelector('[data-foto-team-pop]');
    var q = picker.querySelector('[data-foto-team-q]');
    pop.hidden = false;
    picker.classList.add('is-open');
    renderList(picker, q.value);
    window.setTimeout(function () {
      q.focus();
      q.select();
    }, 0);
  }

  function closePicker(picker) {
    var pop = picker.querySelector('[data-foto-team-pop]');
    if (pop) pop.hidden = true;
    picker.classList.remove('is-open');
  }

  document.querySelectorAll('[data-foto-team]').forEach(function (picker) {
    var hidden = picker.querySelector('[data-foto-team-id]');
    if (hidden.value && byId[hidden.value]) setTeam(picker, byId[hidden.value]);
    picker.querySelector('[data-foto-team-btn]').addEventListener('click', function () {
      if (picker.classList.contains('is-open')) closePicker(picker);
      else openPicker(picker);
    });
    picker.querySelector('[data-foto-team-q]').addEventListener('input', function (e) {
      renderList(picker, e.target.value);
    });
    picker.querySelector('[data-foto-team-list]').addEventListener('click', function (e) {
      var opt = e.target.closest('[data-id]');
      if (!opt) return;
      setTeam(picker, byId[opt.getAttribute('data-id')]);
    });
  });

  var comp = root.querySelector('[data-foto-comp]');
  if (comp) {
    comp.addEventListener('change', function () {
      document.querySelectorAll('[data-foto-team].is-open').forEach(function (picker) {
        renderList(picker, picker.querySelector('[data-foto-team-q]').value);
      });
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-foto-team]')) return;
    document.querySelectorAll('[data-foto-team]').forEach(closePicker);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('[data-foto-team]').forEach(closePicker);
  });
})();

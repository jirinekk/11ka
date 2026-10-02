(function () {
  var FIRST_HALF_MS = 45 * 60 * 1000;
  var SECOND_HALF_MS = 90 * 60 * 1000;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Returns { text, extraLabel } where extraLabel is e.g. '+3' or null
  function formatClock(elapsedMs, compact, firstHalfExtraMinutes, firstHalfExtraIsSet, secondHalfExtraMinutes, secondHalfExtraIsSet) {
    // First-half stoppage time
    if (firstHalfExtraIsSet && firstHalfExtraMinutes > 0) {
      var fhExtraMs = firstHalfExtraMinutes * 60 * 1000;
      if (elapsedMs >= FIRST_HALF_MS && elapsedMs < FIRST_HALF_MS + fhExtraMs) {
        var fhExtraSec = Math.floor((elapsedMs - FIRST_HALF_MS) / 1000);
        var fhExtraMin = Math.floor(fhExtraSec / 60);
        var fhExtraSecRem = fhExtraSec % 60;
        var fhText = fhExtraMin > 0
          ? (compact ? '45+' + fhExtraMin + '\'' : '45+' + fhExtraMin + ':' + pad2(fhExtraSecRem))
          : (compact ? '45\'' : '45:' + pad2(fhExtraSecRem));
        return { text: fhText, extraLabel: '+' + firstHalfExtraMinutes };
      }
    }

    // Second-half stoppage time
    if (secondHalfExtraIsSet && secondHalfExtraMinutes > 0) {
      var shExtraMs = secondHalfExtraMinutes * 60 * 1000;
      if (elapsedMs >= SECOND_HALF_MS && elapsedMs < SECOND_HALF_MS + shExtraMs) {
        var shExtraSec = Math.floor((elapsedMs - SECOND_HALF_MS) / 1000);
        var shExtraMin = Math.floor(shExtraSec / 60);
        var shExtraSecRem = shExtraSec % 60;
        var shText = shExtraMin > 0
          ? (compact ? '90+' + shExtraMin + '\'' : '90+' + shExtraMin + ':' + pad2(shExtraSecRem))
          : (compact ? '90\'' : '90:' + pad2(shExtraSecRem));
        return { text: shText, extraLabel: '+' + secondHalfExtraMinutes };
      }
    }

    // Show +X label at 45th minute even before entering stoppage window
    if (firstHalfExtraIsSet && firstHalfExtraMinutes > 0 && elapsedMs >= FIRST_HALF_MS) {
      // already past stoppage window - no extra label
    } else if (firstHalfExtraIsSet && firstHalfExtraMinutes > 0) {
      // not yet in stoppage - no label yet
    }

    // Regular time
    var totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    var text = compact ? min + '\'' : min + ':' + pad2(sec);
    return { text: text, extraLabel: null };
  }

  function renderClock(el) {
    var startedAt = el.getAttribute('data-match-live-clock');
    if (!startedAt) return;
    var startMs = Date.parse(startedAt);
    if (!Number.isFinite(startMs)) return;
    var compact = el.getAttribute('data-match-live-clock-compact') === '1';
    var firstHalfExtraMinutes = parseInt(el.getAttribute('data-match-live-clock-first-half-extra'), 10);
    if (!Number.isFinite(firstHalfExtraMinutes) || firstHalfExtraMinutes < 0) firstHalfExtraMinutes = 0;
    var firstHalfExtraIsSet = el.getAttribute('data-match-live-clock-first-half-set') === '1';
    var secondHalfExtraMinutes = parseInt(el.getAttribute('data-match-live-clock-second-half-extra'), 10);
    if (!Number.isFinite(secondHalfExtraMinutes) || secondHalfExtraMinutes < 0) secondHalfExtraMinutes = 0;
    var secondHalfExtraIsSet = el.getAttribute('data-match-live-clock-second-half-set') === '1';
    var elapsed = Date.now() - startMs;
    var result = formatClock(elapsed, compact, firstHalfExtraMinutes, firstHalfExtraIsSet, secondHalfExtraMinutes, secondHalfExtraIsSet);
    el.textContent = result.text;
    el.classList.toggle('match-live-clock--injury', elapsed >= SECOND_HALF_MS);

    // Update adjacent +X indicator if present
    var wrap = el.parentElement;
    var extraEl = wrap ? wrap.querySelector('[data-match-live-extra]') : null;
    if (extraEl) {
      if (result.extraLabel) {
        extraEl.textContent = result.extraLabel;
        extraEl.hidden = false;
      } else {
        extraEl.hidden = true;
        extraEl.textContent = '';
      }
    }
  }

  function tick() {
    document.querySelectorAll('[data-match-live-clock]').forEach(renderClock);
  }

  var clocks = document.querySelectorAll('[data-match-live-clock]');
  if (!clocks.length) return;

  tick();
  window.setInterval(tick, 1000);
})();

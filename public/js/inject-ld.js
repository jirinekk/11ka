(function () {
  function b64ToUtf8(b64) {
    var bin = window.atob(b64);
    if (typeof TextDecoder !== 'undefined') {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    try {
      return decodeURIComponent(escape(bin));
    } catch (_e) {
      return bin;
    }
  }

  function readPayload() {
    var meta = document.querySelector('meta[name="11ka-ld"]');
    if (meta) {
      var b64 = meta.getAttribute('content');
      if (b64) {
        try {
          return b64ToUtf8(b64);
        } catch (_e2) {
          return '';
        }
      }
    }
    return '';
  }

  var raw = String(readPayload() || '').trim();
  if (!raw) return;
  try {
    JSON.parse(raw);
  } catch (_e3) {
    return;
  }
  var script = document.createElement('script');
  script.type = 'application/ld+json';
  script.text = raw;
  document.head.appendChild(script);
})();

const ALLOWED_EMBED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'player.vimeo.com',
  'vimeo.com',
  'twitter.com',
  'www.twitter.com',
  'x.com',
  'www.x.com',
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
]);

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asTrimmedText(value, maxLen) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (maxLen && text.length > maxLen) return text.slice(0, maxLen);
  return text;
}

function sanitizeHttpUrl(url, options = {}) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (options.onlyHosts && options.onlyHosts.size && !options.onlyHosts.has(parsed.hostname)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function sanitizeImageSrc(src) {
  if (!src || typeof src !== 'string') return '';
  const trimmed = src.trim();
  if (trimmed.startsWith('/uploads/')) return trimmed;
  return sanitizeHttpUrl(trimmed);
}

function normalizeBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const type = asTrimmedText(block.type, 32).toLowerCase();
  const data = block.data && typeof block.data === 'object' ? block.data : {};
  if (!type) return null;

  if (type === 'heading') {
    const text = asTrimmedText(data.text, 300);
    const levelRaw = parseInt(data.level, 10);
    const level = [2, 3, 4].includes(levelRaw) ? levelRaw : 2;
    if (!text) return null;
    return { type, data: { text, level } };
  }

  if (type === 'paragraph') {
    const text = asTrimmedText(data.text, 20000);
    if (!text) return null;
    return { type, data: { text } };
  }

  if (type === 'image') {
    const src = sanitizeImageSrc(data.src);
    const alt = asTrimmedText(data.alt, 300);
    const caption = asTrimmedText(data.caption, 500);
    const align = ['left', 'center', 'right', 'full'].includes(data.align) ? data.align : 'center';
    if (!src) return null;
    return { type, data: { src, alt, caption, align } };
  }

  if (type === 'quote') {
    const text = asTrimmedText(data.text, 1500);
    const cite = asTrimmedText(data.cite, 200);
    if (!text) return null;
    return { type, data: { text, cite } };
  }

  if (type === 'embed') {
    const url = sanitizeHttpUrl(data.url, { onlyHosts: ALLOWED_EMBED_HOSTS });
    if (!url) return null;
    return { type, data: { url } };
  }

  if (type === 'spacer') {
    const size = ['s', 'm', 'l'].includes(data.size) ? data.size : 'm';
    return { type, data: { size } };
  }

  return null;
}

function parseBlocksInput(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (let i = 0; i < parsed.length && out.length < 200; i += 1) {
    const normalized = normalizeBlock(parsed[i]);
    if (normalized) out.push(normalized);
  }
  return out;
}

function nl2brEscaped(text) {
  return escapeHtml(text).replace(/\n/g, '<br />');
}

function youtubeEmbedUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
    }
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' && parts[1]) {
        return `https://www.youtube.com/embed/${encodeURIComponent(parts[1])}`;
      }
    }
  } catch {
    return '';
  }
  return '';
}

function vimeoEmbedUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'player.vimeo.com') return url;
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return '';
  }
  return '';
}

function renderEmbedHtml(url) {
  const yt = youtubeEmbedUrl(url);
  if (yt) {
    return `<div class="embed-card block-embed"><iframe src="${escapeHtml(yt)}" title="YouTube video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  const vimeo = vimeoEmbedUrl(url);
  if (vimeo) {
    return `<div class="embed-card block-embed"><iframe src="${escapeHtml(vimeo)}" title="Vimeo player" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (url.includes('twitter.com') || url.includes('x.com')) {
    return `<div class="embed-card block-embed"><blockquote class="twitter-tweet"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></blockquote></div>`;
  }
  return `<p class="block-embed-link"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></p>`;
}

function renderBlocksToHtml(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return '';
  const html = [];
  for (const block of blocks) {
    if (!block || !block.type || !block.data) continue;
    if (block.type === 'heading') {
      const level = [2, 3, 4].includes(block.data.level) ? block.data.level : 2;
      html.push(`<h${level} class="block-heading block-heading-${level}">${escapeHtml(block.data.text)}</h${level}>`);
      continue;
    }
    if (block.type === 'paragraph') {
      html.push(`<p class="block-paragraph">${nl2brEscaped(block.data.text)}</p>`);
      continue;
    }
    if (block.type === 'image') {
      const align = ['left', 'center', 'right', 'full'].includes(block.data.align) ? block.data.align : 'center';
      const cap = block.data.caption ? `<figcaption>${escapeHtml(block.data.caption)}</figcaption>` : '';
      html.push(
        `<figure class="block-image block-image-${align}"><img src="${escapeHtml(block.data.src)}" alt="${escapeHtml(block.data.alt || '')}" loading="lazy" />${cap}</figure>`
      );
      continue;
    }
    if (block.type === 'quote') {
      const cite = block.data.cite ? `<footer>${escapeHtml(block.data.cite)}</footer>` : '';
      html.push(`<blockquote class="block-quote"><p>${escapeHtml(block.data.text)}</p>${cite}</blockquote>`);
      continue;
    }
    if (block.type === 'embed') {
      html.push(renderEmbedHtml(block.data.url));
      continue;
    }
    if (block.type === 'spacer') {
      const size = ['s', 'm', 'l'].includes(block.data.size) ? block.data.size : 'm';
      html.push(`<div class="block-spacer block-spacer-${size}" aria-hidden="true"></div>`);
    }
  }
  return html.join('\n');
}

module.exports = {
  parseBlocksInput,
  renderBlocksToHtml,
};

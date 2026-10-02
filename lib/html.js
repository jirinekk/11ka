const sanitizeHtml = require('sanitize-html');

const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'img',
  'figure',
  'figcaption',
  'iframe',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'pre',
  'code',
]);

const allowedAttributes = {
  ...sanitizeHtml.defaults.allowedAttributes,
  '*': ['class', 'id', 'style'],
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading', 'data-credit'],
  iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'title', 'loading'],
  div: ['class', 'data-oembed-url'],
  blockquote: ['class'],
};

function sanitizeArticleBody(html) {
  if (!html || typeof html !== 'string') return '';
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes,
    allowedStyles: {
      '*': {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
        'font-size': [/^\d+(?:px|rem|em|%)$/i],
        'font-family': [/^[a-z0-9 ,"-]+$/i],
        'line-height': [/^\d+(?:\.\d+)?(?:px|rem|em|%)?$/i],
      },
      img: {
        width: [/^\d+(?:px|%)$/i],
        height: [/^\d+(?:px|%)$/i, /^auto$/i],
        display: [/^block$/i, /^inline$/i, /^inline-block$/i],
        'max-width': [/^\d+(?:px|%)$/i, /^100%$/i],
        'margin-left': [/^0$/i, /^auto$/i, /^\d+(?:px|%)$/i],
        'margin-right': [/^0$/i, /^auto$/i, /^\d+(?:px|%)$/i],
        'object-position': [/^\d+%\s+\d+%$/i, /^(left|right|center)\s+(top|center|bottom)$/i],
        'object-fit': [/^cover$/i, /^contain$/i, /^fill$/i, /^none$/i, /^scale-down$/i],
        float: [/^left$/i, /^right$/i, /^none$/i],
      },
      p: {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
      },
      h1: {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
      },
      h2: {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
      },
      h3: {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
      },
      h4: {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
      },
      div: {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
      },
      figure: {
        width: [/^\d+(?:px|%)$/i],
        'max-width': [/^\d+(?:px|%)$/i, /^100%$/i],
        'margin-left': [/^0$/i, /^auto$/i, /^\d+(?:px|%)$/i],
        'margin-right': [/^0$/i, /^auto$/i, /^\d+(?:px|%)$/i],
        float: [/^left$/i, /^right$/i, /^none$/i],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowVulnerableTags: false,
    allowedIframeHostnames: [
      'www.youtube.com',
      'youtube.com',
      'player.vimeo.com',
      'vimeo.com',
      'twitter.com',
      'platform.twitter.com',
      'www.facebook.com',
    ],
  });
}

module.exports = { sanitizeArticleBody };

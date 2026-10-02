function slugify(input) {
  if (!input || typeof input !== 'string') return 'clanek';
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'clanek';
}

function uniqueSlug(base, existsFn) {
  let s = slugify(base);
  let candidate = s;
  let n = 2;
  while (existsFn(candidate)) {
    candidate = `${s}-${n}`;
    n += 1;
  }
  return candidate;
}

module.exports = { slugify, uniqueSlug };

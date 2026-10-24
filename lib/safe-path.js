function safeNextPath(raw) {
  const value = String(raw || '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '';
  if (value.startsWith('/prihlaseni') || value.startsWith('/registrace') || value.startsWith('/odhlaseni')) {
    return '';
  }
  return value.slice(0, 400);
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function asIntArray(value) {
  return asStringArray(value)
    .map((item) => parseInt(item, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

module.exports = {
  safeNextPath,
  asStringArray,
  asIntArray,
};

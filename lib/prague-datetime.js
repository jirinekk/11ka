const PRAGUE_TZ = 'Europe/Prague';

function getPragueParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: PRAGUE_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function matchesPragueParts(date, target) {
  const parts = getPragueParts(date);
  return (
    parts.year === target.year &&
    parts.month === target.month &&
    parts.day === target.day &&
    parts.hour === target.hour &&
    parts.minute === target.minute
  );
}

function parsePragueDatetimeLocal(value) {
  const s = String(value || '').trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;

  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };

  const start = Date.UTC(target.year, target.month - 1, target.day, target.hour - 3, target.minute);
  const end = Date.UTC(target.year, target.month - 1, target.day, target.hour + 1, target.minute);

  for (let ts = start; ts <= end; ts += 60 * 1000) {
    const date = new Date(ts);
    if (matchesPragueParts(date, target)) {
      return date.toISOString();
    }
  }

  return null;
}

function formatPragueDateTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TZ,
  });
}

function formatPragueDatetimeLocal(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = getPragueParts(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

module.exports = {
  parsePragueDatetimeLocal,
  formatPragueDatetimeLocal,
  formatPragueDateTime,
};

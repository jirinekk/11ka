function formatCzDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.max(0, Date.now() - d.getTime());
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'právě teď';
  if (minutes < 60) {
    if (minutes === 1) return 'před 1 minutou';
    return `před ${minutes} minutami`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    if (hours === 1) return 'před 1 hodinou';
    return `před ${hours} hodinami`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) return 'před 1 dnem';
  if (days < 7) return `před ${days} dny`;
  return formatCzDate(iso);
}

module.exports = { formatCzDate, relativeTime };

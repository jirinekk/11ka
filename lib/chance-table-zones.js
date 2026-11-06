/** Chance Liga 2026/27: evropské poháry a sestup podle herního modelu LFA. */
const ZONE_CL = 'cl';
const ZONE_EL = 'el';
const ZONE_ECL = 'ecl';
const ZONE_PLAYOFF = 'playoff';
const ZONE_DOWN = 'down';

const ZONE_COLORS = {
  [ZONE_CL]: '#60a5fa',
  [ZONE_EL]: '#fb923c',
  [ZONE_ECL]: '#34d399',
  [ZONE_PLAYOFF]: '#fbbf24',
  [ZONE_DOWN]: '#fb7185',
};

const ZONE_LABELS = {
  [ZONE_CL]: 'Liga mistrů',
  [ZONE_EL]: 'Evropská liga',
  [ZONE_ECL]: 'Konferenční liga',
  [ZONE_PLAYOFF]: 'Baráž',
  [ZONE_DOWN]: 'Sestup',
};

const ZONE_SHORT_LABELS = {
  [ZONE_CL]: 'LM',
  [ZONE_EL]: 'EL',
  [ZONE_ECL]: 'KL',
  [ZONE_PLAYOFF]: 'Baráž',
  [ZONE_DOWN]: 'Sestup',
};

const ZONE_CLASSES = {
  [ZONE_CL]: 'is-cl',
  [ZONE_EL]: 'is-el',
  [ZONE_ECL]: 'is-ecl',
  [ZONE_PLAYOFF]: 'is-playoff',
  [ZONE_DOWN]: 'is-down',
};

function zoneForRank(rank) {
  const r = Number(rank) || 0;
  if (r <= 2) return ZONE_CL;
  if (r === 3) return ZONE_EL;
  if (r === 4) return ZONE_ECL;
  if (r === 14 || r === 15) return ZONE_PLAYOFF;
  if (r >= 16) return ZONE_DOWN;
  return null;
}

function zoneClass(rank) {
  const zone = zoneForRank(rank);
  return zone ? ZONE_CLASSES[zone] : '';
}

const ZONE_LEGEND = [ZONE_CL, ZONE_EL, ZONE_ECL, ZONE_PLAYOFF, ZONE_DOWN].map((zone) => ({
  zone,
  className: ZONE_CLASSES[zone],
  label: ZONE_LABELS[zone],
  shortLabel: ZONE_SHORT_LABELS[zone],
  color: ZONE_COLORS[zone],
}));

module.exports = {
  ZONE_CL,
  ZONE_EL,
  ZONE_ECL,
  ZONE_PLAYOFF,
  ZONE_DOWN,
  ZONE_COLORS,
  ZONE_LABELS,
  ZONE_SHORT_LABELS,
  ZONE_CLASSES,
  ZONE_LEGEND,
  zoneForRank,
  zoneClass,
};

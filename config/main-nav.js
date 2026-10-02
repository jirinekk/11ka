const CATEGORY_NAV_TAGS = [
  'Chance Liga',
  'Chance Národní liga',
  'Fortuna Liga',
  'Reprezentace',
  'Svět',
  'Evropa',
  'Ostatní',
];

const REMOVED_TAG_LABELS = new Set(['Světový Fotbal']);

function withoutRemovedTags(tags) {
  return (tags || []).filter((t) => t && !REMOVED_TAG_LABELS.has(String(t).trim()));
}

const NAV_TAG_MAP = {
  'cesky-fotbal': ['Chance Liga', 'Chance Národní liga', 'Reprezentace', 'Ostatní'],
  'zensky-fotbal': ['Fortuna Liga', 'Reprezentace', 'Ostatní'],
  'svetovy-fotbal': ['Svět', 'Evropa', 'Ostatní'],
  zapasy: CATEGORY_NAV_TAGS,
  rozhovory: CATEGORY_NAV_TAGS,
  analyz: CATEGORY_NAV_TAGS,
  'vsechny-clanky': CATEGORY_NAV_TAGS,
};

const MAIN_NAV_ITEMS = [
  { id: 'home', label: 'Domů', href: '/', labelHtml: 'Domů' },
  {
    id: 'cesky-fotbal',
    label: 'Český Fotbal',
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Český&nbsp;Fotbal</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Český</span>',
    href: '/cesky-fotbal',
  },
  {
    id: 'zensky-fotbal',
    label: 'Ženský Fotbal',
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Ženský&nbsp;Fotbal</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Ženský</span>',
    href: '/zensky-fotbal',
  },
  {
    id: 'svetovy-fotbal',
    label: 'Světový Fotbal',
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Světový&nbsp;Fotbal</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Světový</span>',
    href: '/svetovy-fotbal',
  },
  { id: 'zapasy', label: 'Zápasy', href: '/zapasy', labelHtml: 'Zápasy' },
  { id: 'rozhovory', label: 'Rozhovory', href: '/rozhovory', labelHtml: 'Rozhovory' },
  { id: 'analyzy', label: 'Analýzy', href: '/analyzy', labelHtml: 'Analýzy' },
  {
    id: 'vsechny-clanky',
    label: 'Všechny Články',
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Všechny&nbsp;Články</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Všechny</span>',
    href: '/vsechny-clanky',
  },
];

function buildTagHref(basePath, tag) {
  const path = basePath || '/';
  if (!tag) return path;
  return `${path}?tag=${encodeURIComponent(tag)}`;
}

function getTagsForNav(navId) {
  const key = navId === 'analyzy' ? 'analyz' : navId;
  return NAV_TAG_MAP[key] ? [...NAV_TAG_MAP[key]] : [];
}

function resolveTagOptions(activeNav, distinctTags = []) {
  if (['zapasy', 'rozhovory', 'analyzy'].includes(activeNav)) {
    const preferredOrder = CATEGORY_NAV_TAGS;
    const all = withoutRemovedTags(
      Array.from(new Set([...preferredOrder, ...distinctTags].filter(Boolean)))
    );
    const preferredSet = new Set(preferredOrder);
    const rest = all.filter((t) => !preferredSet.has(t));
    return preferredOrder.filter((t) => all.includes(t)).concat(rest);
  }

  const fixed = withoutRemovedTags(getTagsForNav(activeNav));
  if (fixed.length) return fixed;

  const withOstatni = withoutRemovedTags(
    Array.from(new Set([...distinctTags, 'Ostatní'].filter(Boolean)))
  );
  return withOstatni;
}

function getMainNav(activeNav = 'home') {
  return MAIN_NAV_ITEMS.map((item) => ({
    ...item,
    active: activeNav === item.id,
  }));
}

/** Štítky pro admin (select) - vždy obsahuje standardní štítky včetně Ostatní */
function mergeAdminTagOptions(distinctTags = []) {
  return withoutRemovedTags(
    Array.from(new Set([...CATEGORY_NAV_TAGS, ...distinctTags].filter(Boolean)))
  );
}

module.exports = {
  MAIN_NAV_ITEMS,
  CATEGORY_NAV_TAGS,
  NAV_TAG_MAP,
  buildTagHref,
  getTagsForNav,
  resolveTagOptions,
  getMainNav,
  mergeAdminTagOptions,
};

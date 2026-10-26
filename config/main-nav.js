const { listRubrics } = require('./rubrics');

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

const TYPE_CATEGORIES = ['Zápasy', 'Analýzy', 'Rozhovory'];

const TYPE_SUBCATS = [
  { id: 'zapasy', slug: 'zapasy', label: 'Zápasy', category: 'Zápasy' },
  { id: 'analyzy', slug: 'analyzy', label: 'Analýzy', category: 'Analýzy' },
  { id: 'rozhovory', slug: 'rozhovory', label: 'Rozhovory', category: 'Rozhovory' },
];

const REGION_PARENTS = [
  {
    id: 'cesky-fotbal',
    slug: 'cesky-fotbal',
    label: 'Český Fotbal',
    href: '/cesky-fotbal',
    categories: ['Český Fotbal', 'Česká Fotbal', 'Česká liga'],
    regionTags: ['Chance Liga', 'Chance Národní liga', 'Reprezentace'],
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Český&nbsp;Fotbal</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Český</span>',
  },
  {
    id: 'zensky-fotbal',
    slug: 'zensky-fotbal',
    label: 'Ženský Fotbal',
    href: '/zensky-fotbal',
    categories: ['Ženský Fotbal'],
    regionTags: ['Fortuna Liga'],
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Ženský&nbsp;Fotbal</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Ženský</span>',
  },
  {
    id: 'svetovy-fotbal',
    slug: 'svetovy-fotbal',
    label: 'Světový Fotbal',
    href: '/svetovy-fotbal',
    categories: ['Světový Fotbal', 'Evropa'],
    regionTags: ['Svět', 'Evropa'],
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Světový&nbsp;Fotbal</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Světový</span>',
  },
];

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

const CATEGORY_TO_PARENT = Object.fromEntries(
  REGION_PARENTS.flatMap((parent) => parent.categories.map((category) => [category, parent]))
);

const TAG_TO_PARENT = {};
for (const parent of REGION_PARENTS) {
  for (const tag of parent.regionTags) {
    if (!TAG_TO_PARENT[tag]) TAG_TO_PARENT[tag] = parent;
  }
}

const TYPE_BY_CATEGORY = Object.fromEntries(TYPE_SUBCATS.map((item) => [item.category, item]));
const TYPE_BY_SLUG = Object.fromEntries(TYPE_SUBCATS.map((item) => [item.slug, item]));
const PARENT_BY_ID = Object.fromEntries(REGION_PARENTS.map((item) => [item.id, item]));

function childrenForParent(parent) {
  return [
    { id: 'all', label: 'Celá kategorie', href: parent.href },
    ...TYPE_SUBCATS.map((sub) => ({
      id: sub.id,
      label: sub.label,
      href: `${parent.href}/${sub.slug}`,
    })),
  ];
}

function zapasyNavItem() {
  return {
    id: 'zapasy',
    label: 'Zápasy',
    href: '/zapasy/live',
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Zápasy</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Zápasy</span>',
  };
}

function rubrikyNavItem() {
  const children = listRubrics().map((rubric) => ({
    id: rubric.slug,
    label: rubric.label,
    href: `/rubriky/${rubric.slug}`,
  }));
  return {
    id: 'rubriky',
    label: 'Rubriky',
    href: '/rubriky',
    labelHtml:
      '<span class="header11__link-text header11__link-text--full">Rubriky</span><span class="header11__link-text header11__link-text--short" aria-hidden="true">Rubriky</span>',
    children,
  };
}

function getMainNavItems() {
  return [
    zapasyNavItem(),
    ...REGION_PARENTS.map((parent) => ({
      id: parent.id,
      label: parent.label,
      labelHtml: parent.labelHtml,
      href: parent.href,
      children: childrenForParent(parent),
    })),
    rubrikyNavItem(),
  ];
}

const RUBRIKY_NAV = rubrikyNavItem();
const MAIN_NAV_ITEMS = getMainNavItems();

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

function getMainNav(activeNav = 'home', activeSubnav = '') {
  const sub = String(activeSubnav || '').trim();
  return getMainNavItems().map((item) => {
    const parentActive = activeNav === item.id;
    return {
      ...item,
      active: parentActive,
      children: (item.children || []).map((child) => ({
        ...child,
        active:
          parentActive &&
          ((sub && child.id === sub) || (!sub && item.id !== 'rubriky' && child.id === 'all')),
      })),
    };
  });
}

function getRegionParent(idOrSlug) {
  const key = String(idOrSlug || '').trim();
  return PARENT_BY_ID[key] || REGION_PARENTS.find((item) => item.slug === key) || null;
}

function getTypeSubcat(slugOrLabel) {
  const key = String(slugOrLabel || '').trim();
  if (!key) return null;
  return TYPE_BY_SLUG[key] || TYPE_BY_CATEGORY[key] || null;
}

function getListingScope(parent, subcat) {
  if (!parent) {
    return { category: [], regionTags: [], typeCategory: '' };
  }
  return {
    category: parent.categories,
    regionTags: parent.regionTags,
    typeCategory: subcat ? subcat.category : '',
  };
}

function resolveArticleSection(article) {
  const rubricSlug = article && article.rubric_slug ? String(article.rubric_slug).trim() : '';
  if (rubricSlug) {
    const rubric = listRubrics().find((item) => item.slug === rubricSlug);
    if (rubric) {
      return {
        parent: {
          id: 'rubriky',
          slug: 'rubriky',
          label: 'Rubriky',
          href: '/rubriky',
        },
        type: null,
        nav: 'rubriky',
        subnav: rubric.slug,
        label: rubric.label,
        href: `/rubriky/${rubric.slug}`,
      };
    }
  }

  const category = article && article.category ? String(article.category).trim() : '';
  const tag = article && article.tag ? String(article.tag).trim() : '';
  const typeFromCategory = TYPE_BY_CATEGORY[category] || null;
  const typeFromTag = TYPE_BY_CATEGORY[tag] || null;
  const parentFromCategory = CATEGORY_TO_PARENT[category] || null;
  const parentFromTag = TAG_TO_PARENT[tag] || null;

  if (parentFromCategory) {
    const type = typeFromTag;
    return {
      parent: parentFromCategory,
      type,
      nav: parentFromCategory.id,
      subnav: type ? type.id : '',
      label: type ? `${parentFromCategory.label} · ${type.label}` : parentFromCategory.label,
      href: type ? `${parentFromCategory.href}/${type.slug}` : parentFromCategory.href,
    };
  }

  if (typeFromCategory && parentFromTag) {
    return {
      parent: parentFromTag,
      type: typeFromCategory,
      nav: parentFromTag.id,
      subnav: typeFromCategory.id,
      label: `${parentFromTag.label} · ${typeFromCategory.label}`,
      href: `${parentFromTag.href}/${typeFromCategory.slug}`,
    };
  }

  if (typeFromCategory) {
    return {
      parent: null,
      type: typeFromCategory,
      nav: 'home',
      subnav: '',
      label: typeFromCategory.label,
      href: null,
    };
  }

  return null;
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
  TYPE_CATEGORIES,
  TYPE_SUBCATS,
  REGION_PARENTS,
  RUBRIKY_NAV,
  buildTagHref,
  getTagsForNav,
  resolveTagOptions,
  getMainNav,
  getRegionParent,
  getTypeSubcat,
  getListingScope,
  resolveArticleSection,
  mergeAdminTagOptions,
};

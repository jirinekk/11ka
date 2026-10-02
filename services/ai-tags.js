const CATEGORIES = [
  'Český Fotbal',
  'Ženský Fotbal',
  'Světový Fotbal',
  'Zápasy',
  'Rozhovory',
  'Analýzy',
];

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const CZECH_CLUB_STEMS = [
  'sparta',
  'sparte',
  'sparty',
  'spartu',
  'slavia',
  'slavie',
  'slavii',
  'slaviu',
  'plzen',
  'plzne',
  'plzni',
  'viktoria',
  'banik',
  'baniku',
  'ostrava',
  'ostravy',
  'ostrave',
  'jablonec',
  'jablonci',
  'liberec',
  'liberci',
  'bohemians',
  'teplice',
  'teplic',
  'slovacko',
  'slovacka',
  'olomouc',
  'olomouce',
  'sigma',
  'hradec',
  'hradce',
  'pardubice',
  'pardubic',
  'zlin',
  'zline',
  'karvina',
  'karvine',
  'boleslav',
  'boleslavi',
  'dukla',
  'dukly',
  'duklu',
  'slovacko',
  'chance liga',
];

const FNL_STEMS = ['narodni liga', 'fnl', 'druhou ligu', 'druhe ligy', '2. liga'];

function hasStem(hay, stems) {
  return stems.some((stem) => hay.includes(stem));
}

function classifyText(parts) {
  const title = String(parts.title || '');
  const perex = String(parts.perex || '');
  const extra = String(parts.extra || '');
  const head = fold(`${title} ${perex}`);
  const hay = fold(`${title} ${perex} ${extra}`);
  return { title, perex, extra, head, hay };
}

function guessCategory(text, hint, parts) {
  if (CATEGORIES.includes(hint)) return hint;
  const { head, hay } = parts || classifyText({ title: text, perex: '', extra: '' });

  if (/zensk|zeny |fortunaligazen|fortuna lyg/.test(hay)) return 'Ženský Fotbal';

  if (/\brozhovor\b|\binterview\b/.test(head)) return 'Rozhovory';
  if (/\banalyza\b/.test(head)) return 'Analýzy';

  if (
    /\b\d+:\d+\b/.test(head) &&
    /(prohral|vyhral|utkani|remiz|polocas|sestava|vysledek|golem|brank)/.test(head) &&
    !/debut|prestup|smlouv|nominac/.test(head)
  ) {
    return 'Zápasy';
  }

  if (
    hasStem(hay, CZECH_CLUB_STEMS) ||
    /reprezentac|nominac|cesk[aeych]+ lig|chance liga|cesky fotbal/.test(hay)
  ) {
    return 'Český Fotbal';
  }

  return 'Světový Fotbal';
}

function guessTag(text, category, parts) {
  const { hay } = parts || classifyText({ title: text, perex: '', extra: '' });
  const repre = /reprezentac|nominac|narodni tym|cesko\b|ceska reprezent/.test(hay);
  const fnl = hasStem(hay, FNL_STEMS);
  const evropa = /liga mistr|evropsk|konferencn|champions league|europa league/.test(hay);
  const svet = /premier|bundeslig|la liga|serie a|ms\b|mistrovstvi|premier league/.test(hay);
  const czechClub = hasStem(hay, CZECH_CLUB_STEMS) || /chance liga/.test(hay);

  if (category === 'Ženský Fotbal') {
    if (repre) return 'Reprezentace';
    return 'Fortuna Liga';
  }
  if (category === 'Český Fotbal') {
    if (repre && !czechClub) return 'Reprezentace';
    if (repre && /nominac|reprezentac/.test(hay)) return 'Reprezentace';
    if (fnl) return 'Chance Národní liga';
    if (czechClub || /chance liga|cesk[aeych]+ lig/.test(hay)) return 'Chance Liga';
    return 'Ostatní';
  }
  if (category === 'Světový Fotbal') {
    if (evropa && !svet) return 'Evropa';
    if (evropa && czechClub) return 'Evropa';
    return 'Svět';
  }
  if (repre) return 'Reprezentace';
  if (evropa) return 'Evropa';
  if (fnl) return 'Chance Národní liga';
  if (czechClub) return 'Chance Liga';
  if (svet) return 'Svět';
  return 'Ostatní';
}

function classifyItem(item) {
  const parts = classifyText({
    title: item.source_title || item.title || '',
    perex: item.source_perex || item.excerpt || '',
    extra: item.source_name || '',
  });
  const category = guessCategory(null, null, parts);
  const tag = guessTag(null, category, parts);
  return { category, tag };
}

module.exports = {
  CATEGORIES,
  fold,
  guessCategory,
  guessTag,
  classifyItem,
};

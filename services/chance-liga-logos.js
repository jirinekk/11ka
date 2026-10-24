const URL_PREFIX = '/images/teams/chance-liga';

const TEAMS = [
  {
    code: 'acs',
    slug: 'sparta',
    name: 'AC Sparta Praha',
    short: 'Sparta',
    file: 'acs.png',
    aliases: ['sparta', 'sparta praha', 'ac sparta', 'ac sparta praha'],
  },
  {
    code: 'sks',
    slug: 'slavia',
    name: 'SK Slavia Praha',
    short: 'Slavia',
    file: 'sks.png',
    aliases: ['slavia', 'slavia praha', 'sk slavia', 'sk slavia praha'],
  },
  {
    code: 'plz',
    slug: 'plzen',
    name: 'FC Viktoria Plzeň',
    short: 'Plzeň',
    file: 'plz.png',
    aliases: ['plzen', 'viktoria plzen', 'viktoria', 'fc viktoria plzen'],
  },
  {
    code: 'fcb',
    slug: 'banik',
    name: 'FC Baník Ostrava',
    short: 'Baník',
    file: 'fcb.png',
    aliases: ['banik', 'ostrava', 'banik ostrava', 'fc banik ostrava'],
  },
  {
    code: 'boh',
    slug: 'bohemians',
    name: 'Bohemians Praha 1905',
    short: 'Bohemians',
    file: 'boh.png',
    aliases: ['bohemians', 'bohemians 1905', 'bohemians praha', 'bohemians praha 1905'],
  },
  {
    code: 'mbl',
    slug: 'boleslav',
    name: 'FK Mladá Boleslav',
    short: 'Boleslav',
    file: 'mbl.png',
    aliases: ['mlada boleslav', 'boleslav', 'fk mb', 'fkmb', 'fk mlada boleslav'],
  },
  {
    code: 'fkj',
    slug: 'jablonec',
    name: 'FK Jablonec',
    short: 'Jablonec',
    file: 'fkj.png',
    aliases: ['jablonec', 'fk jablonec'],
  },
  {
    code: 'lib',
    slug: 'liberec',
    name: 'FC Slovan Liberec',
    short: 'Liberec',
    file: 'lib.png',
    aliases: ['liberec', 'slovan liberec', 'fc slovan liberec'],
  },
  {
    code: 'sig',
    slug: 'sigma',
    name: 'SK Sigma Olomouc',
    short: 'Sigma',
    file: 'sig.png',
    aliases: ['sigma', 'olomouc', 'sigma olomouc', 'sk sigma olomouc'],
  },
  {
    code: 'hkr',
    slug: 'hradec',
    name: 'FC Hradec Králové',
    short: 'Hradec',
    file: 'hkr.png',
    aliases: ['hradec', 'hradec kralove', 'fc hradec kralove'],
  },
  {
    code: 'tep',
    slug: 'teplice',
    name: 'FK Teplice',
    short: 'Teplice',
    file: 'tep.png',
    aliases: ['teplice', 'fk teplice'],
  },
  {
    code: 'fcs',
    slug: 'slovacko',
    name: '1. FC Slovácko',
    short: 'Slovácko',
    file: 'fcs.png',
    aliases: ['slovacko', '1 fc slovacko'],
  },
  {
    code: 'fkp',
    slug: 'pardubice',
    name: 'FK Pardubice',
    short: 'Pardubice',
    file: 'fkp.png',
    aliases: ['pardubice', 'fk pardubice'],
  },
  {
    code: 'fcz',
    slug: 'zlin',
    name: 'FC Zlín',
    short: 'Zlín',
    file: 'fcz.png',
    aliases: ['zlin', 'fc zlin', 'fastav', 'fastav zlin'],
  },
  {
    code: 'zbr',
    slug: 'zbrojovka',
    name: 'FC Zbrojovka Brno',
    short: 'Zbrojovka',
    file: 'zbr.png',
    aliases: ['zbrojovka', 'zbrojovka brno', 'fc zbrojovka brno'],
  },
  {
    code: 'art',
    slug: 'artis',
    name: 'FK Artis Brno',
    short: 'Artis',
    file: 'art.png',
    aliases: ['artis', 'artis brno', 'fk artis', 'fk artis brno', 'sk artis', 'sk artis brno', 'lisen', 'sk lisen'],
  },
];

function foldName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fc|fk|sk|ac|sc|mfk|1|1fc)\b/g, '')
    .replace(/\b(praha|1905)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReserveSide(folded) {
  return /\b(b|c|u1[679]|u21|zeny|women|w)\b/.test(folded);
}

function fileUrl(file) {
  if (!file) return '';
  return `${URL_PREFIX}/${file}`;
}

function matchTeam(name) {
  const folded = foldName(name);
  if (!folded || isReserveSide(folded)) return null;

  let best = null;
  let bestLen = -1;
  for (const team of TEAMS) {
    const aliases = [...team.aliases]
      .map(foldName)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      if (folded === alias || folded.startsWith(`${alias} `) || folded.endsWith(` ${alias}`)) {
        if (alias.length > bestLen) {
          best = team;
          bestLen = alias.length;
        }
      }
    }
  }
  if (best) return best;

  for (const team of TEAMS) {
    const aliases = [...team.aliases].map(foldName).filter(Boolean);
    for (const alias of aliases) {
      if (alias.length < 4) continue;
      if (folded.includes(alias) && alias.length > bestLen) {
        best = team;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

function logoForName(name) {
  const team = matchTeam(name);
  return team ? fileUrl(team.file) : '';
}

function shortLabel(name) {
  const team = matchTeam(name);
  if (team && team.short) return team.short;
  return String(name || '').trim();
}

function withLogos(match) {
  if (!match || typeof match !== 'object') return match;
  const homeClub = matchTeam(match.home);
  const awayClub = matchTeam(match.away);
  const homeLogo = (homeClub ? fileUrl(homeClub.file) : '') || match.homeLogo || '';
  const awayLogo = (awayClub ? fileUrl(awayClub.file) : '') || match.awayLogo || '';
  const home = clubFromTeam(homeClub);
  const away = clubFromTeam(awayClub);
  return {
    ...match,
    homeLogo,
    awayLogo,
    homeLabel: (home && home.short) || shortLabel(match.home),
    awayLabel: (away && away.short) || shortLabel(match.away),
    homeHref: (home && home.href) || '',
    awayHref: (away && away.href) || '',
    homeCode: (home && home.code) || '',
    awayCode: (away && away.code) || '',
  };
}

function clubFromTeam(team) {
  if (!team) return null;
  const logo = fileUrl(team.file);
  if (!logo) return null;
  const slug = team.slug || String(team.code || '').toLowerCase();
  return {
    code: team.code,
    slug,
    href: `/klub/${slug}`,
    name: team.name || team.code.toUpperCase(),
    short: team.short || team.name || team.code.toUpperCase(),
    logo,
  };
}

function listClubs() {
  return TEAMS.map(clubFromTeam).filter(Boolean);
}

function getClub(code) {
  const key = String(code || '').trim().toLowerCase();
  if (!key) return null;
  return clubFromTeam(TEAMS.find((team) => team.code === key));
}

function getClubBySlug(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const byCode = getClub(raw);
  if (byCode) return byCode;
  const bySlug = TEAMS.find((team) => team.slug === raw);
  if (bySlug) return clubFromTeam(bySlug);
  const fromName = matchTeam(raw.replace(/-/g, ' '));
  return clubFromTeam(fromName);
}

function clubsFromCodes(codes) {
  const seen = new Set();
  const out = [];
  for (const raw of codes || []) {
    const club = getClub(raw);
    if (!club || seen.has(club.code)) continue;
    seen.add(club.code);
    out.push(club);
  }
  return out;
}

function isClubCode(code) {
  return !!getClub(code);
}

module.exports = {
  TEAMS,
  foldName,
  matchTeam,
  logoForName,
  shortLabel,
  withLogos,
  listClubs,
  getClub,
  getClubBySlug,
  clubsFromCodes,
  isClubCode,
};

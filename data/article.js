module.exports = {
  breadcrumbs: [
    { label: 'Domů', href: '/' },
    { label: 'Český Fotbal', href: '/cesky-fotbal' },
    { label: 'Článek', href: null },
  ],
  category: 'Český Fotbal',
  headline:
    'Slavia Praha dominuje v derby proti Spartě a upevňuje pozici na vrcholu tabulky',
  lead:
    'V emotivním šlágru kola proměnili domácí převahu ve druhém poločase v rozhodující góly. Fanoušci viděli dramatický závěr a řadu sporných momentů.',
  scoreboard: {
    homeTeam: 'Slavia Praha',
    awayTeam: 'Sparta Praha',
    homeLogo:
      'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=96&q=80',
    awayLogo:
      'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=96&q=80',
    score: '2:1',
  },
  author: {
    name: 'Pavel Novák',
    avatar: '/logo.png',
    date: '15. prosince 2024',
    readTime: '8 min čtení',
  },
  featuredImage:
    'https://images.unsplash.com/photo-1560272564-c83b66b1ad13?w=1200&q=80',
  caption:
    'Slávisté slaví rozhodující trefu v závěru utkání před zaplněným tribunou.',
  sections: [
    {
      heading: 'První poločas: opatrnost a minimum šancí',
      paragraphs: [
        'Úvod zápasu byl ve znamení vzájemného oťukávání. Oba týmy dbaly na defenzivu a do šancí se dostávaly sporadicky. Střed pole byl důkladně obsazený a tempo nepatřilo mezi nejvyšší.',
        'Diváci museli na první větší vzrušení počkat až do závěru poločasu, kdy po standardní situaci zazněla tyč domácí branky.',
      ],
    },
    {
      heading: 'Rozhodující druhý poločas',
      paragraphs: [
        'Po přestávce přišel zásah do sestavy a s ním i vyšší pressing Slavie. Hosté postupně ztráceli přehled ve středu hřiště a začali čelit jedné šanci za druhou.',
        'Když se podařilo proměnit přesilovku po červené kartě, bylo jasné, že Sparta bude muset otevřít hru - a domácí trestali brejkem na konečných 2:1.',
      ],
    },
  ],
  keyMoments: [
    { minute: "23'", text: 'Nebezpečná střela z hranice vápna míří těsně vedle.', tone: 'info' },
    { minute: "41'", text: 'Sparta vstřelila vedoucí branku po rychlém protiútoku.', tone: 'goal' },
    { minute: "67'", text: 'Slavia vyrovnává po rohovém kopu a hlavičce stopera.', tone: 'goal' },
    { minute: "89'", text: 'Rozhodující gól domácích po brejku tři na dva.', tone: 'win' },
  ],
  stats: {
    title: 'Statistiky zápasu',
    items: [
      { value: '58 %', label: 'Držení míče' },
      { value: '14', label: 'Střely' },
      { value: '7', label: 'Rohy' },
    ],
  },
  quote: {
    text:
      'Kluci ukázali charakter. I když jsme prohrávali, nepanikařili jsme a šli si za svým plánem.',
    attribution: '- Trenér Slavie, pozápasový rozhovor',
  },
  authorBio: {
    name: 'Pavel Novák',
    role: 'Sportovní redaktor',
    bio: 'Dlouholetý fotbalový publicista, zaměřuje se na českou ligu a evropské poháry. Držitel ocenění Sportovní novinář roku.',
    avatar: '/logo.png',
  },
  relatedArticles: [
    {
      image:
        'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=600&q=80',
      title: 'Preview: co čekat od odvety na Letné?',
      excerpt:
        'Sestavy, zranění a klíčové duely jeden na jednoho před odvetním kolem.',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=600&q=80',
      title: 'Tabulka po derby: kdo má nejtěžší los?',
      excerpt:
        'Pohled na zbývající program elitní čtyřky Fortuna ligy.',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=600&q=80',
      title: 'Rozbor: jak Slavia buduje pressing',
      excerpt:
        'Krátká taktická analýza pohybu wingerek a zapojení krajních beků.',
      href: '#',
    },
  ],
  comments: [
    {
      user: 'Jana Svobodová',
      avatar:
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&q=80',
      timeAgo: 'před 2 hodinami',
      text:
        'Skvělá atmosféra a zasloužené vítězství. Těším se na odvetu!',
    },
  ],
  sidebarMostRead: [
    {
      image:
        'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=200&q=80',
      title: 'Liga mistrů: večer plný překvapení',
      timeAgo: 'před 3 hodinami',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1560272564-c83b66b1ad13?w=200&q=80',
      title: 'Kdo zaujme na zimním přestupním trhu?',
      timeAgo: 'před 6 hodinami',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=200&q=80',
      title: 'Rozhovor s kapitánem před reprezentací',
      timeAgo: 'před 1 dnem',
      href: '#',
    },
  ],
  tags: ['Slavia', 'Sparta', 'Derby', 'Český Fotbal', 'Fortuna liga', 'Praha'],
};

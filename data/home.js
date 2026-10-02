/** @typedef {{ image: string, title: string, excerpt: string, timeAgo: string, href: string }} HomeCard */

module.exports = {
  hero: {
    image:
      'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1200&q=80',
    title: 'Slavia Praha postoupila do vyřazovací fáze Ligy mistrů',
    excerpt:
      'Sešívaní potvrdili skvělou formu a po výhře nad soupeřem z Itálie slaví historický postup mezi šestnáct nejlepších týmů Evropy.',
    author: 'Pavel Novák',
    timeAgo: 'před 2 hodinami',
    href: '/clanek',
  },
  /** @type {HomeCard[]} */
  mostRead: [
    {
      image:
        'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=600&q=80',
      title: 'Derby pražských „S“: co rozhodlo o výsledku?',
      excerpt:
        'Taktické změny ve druhém poločase a přesné zakončení rozhodly o těsné výhře domácích.',
      timeAgo: 'před 3 hodinami',
      href: '/clanek',
    },
    {
      image:
        'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=600&q=80',
      title: 'Reprezentace se připravuje na kvalifikaci',
      excerpt:
        'Trenérský štáb oznámil širší nominaci před klíčovým dvojzápasem o Euro.',
      timeAgo: 'před 5 hodinami',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=600&q=80',
      title: 'Liga mistrů: preview večerních utkání',
      excerpt:
        'Kdo má největší šanci na postup? Přehled formy, zranění a sestav.',
      timeAgo: 'před 1 dnem',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&q=80',
      title: 'Sparta doma potvrdila roli favorita',
      excerpt:
        'Letenští kontrolovali hru od první minuty a třemi góly si pojistili tři body.',
      timeAgo: 'před 1 dnem',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1508098682722-e99c43a406fe?w=600&q=80',
      title: 'Slavia míří do dalšího evropského kola',
      excerpt:
        'Sešívaní zvládli těžký venkovní duel a udrželi sérii bez porážky.',
      timeAgo: 'před 2 dny',
      href: '#',
    },
    {
      image:
        'https://images.unsplash.com/photo-1459865264687-595d652ade67?w=600&q=80',
      title: 'Chance liga: souboj o evropská místa',
      excerpt:
        'Těsně před koncem sezony se hraje o pohárové příčky i o záchranu.',
      timeAgo: 'před 2 dny',
      href: '#',
    },
  ],
  newsletter: {
    description:
      'Zaregistrujte se a buďte první, kdo bude dostávat novinky o vydání nového článku.',
  },
};


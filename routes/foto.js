const express = require('express');
const multer = require('multer');
const { canAccessFoto, canManageFotoArchive } = require('../lib/roles');
const foto = require('../services/foto');
const fotoS3 = require('../services/foto-s3');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif|heic|heif|tiff)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Nahraj obrázek (JPEG, PNG, WebP).'));
  },
});

function fotoLocals(req, res) {
  res.locals.fotoNav = fotoNavFromPath(req.path);
  res.locals.fotoStats = foto.stats();
  res.locals.adminNav = 'foto';
  res.locals.metaRobots = 'noindex, nofollow';
  res.locals.showSearchLogin = false;
  res.locals.showNav = false;
  res.locals.activeNav = '';
  res.locals.canManageFotoArchive = canManageFotoArchive(req.user);
}

function actorOf(req) {
  const user = req.user || {};
  return {
    actorId: user.id || null,
    actorEmail: user.email || '',
    actorName: user.display_name || user.email || '',
  };
}

function wantsJson(req) {
  const accept = String(req.headers.accept || '');
  const xhr = String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
  return xhr || accept.includes('application/json');
}

function fotoNavFromPath(p) {
  if (p.startsWith('/alba') || p === '/' || p === '') return 'alba';
  if (p.startsWith('/presety')) return 'presety';
  if (p.startsWith('/hledat')) return 'hledat';
  if (p.startsWith('/rozpis')) return 'rozpis';
  if (p.startsWith('/hraci')) return 'hraci';
  if (p.startsWith('/rozhodci')) return 'rozhodci';
  if (p.startsWith('/fotografi')) return 'fotografi';
  if (p.startsWith('/tymy')) return 'tymy';
  if (p.startsWith('/studio')) return 'studio';
  if (p.startsWith('/logy')) return 'logy';
  return 'alba';
}

function render404(req, res) {
  return res.status(404).render('404', {
    title: 'Nenalezeno - 11ka',
    activeNav: 'home',
    showSearchLogin: true,
  });
}

function requireFoto(req, res, next) {
  if (req.path.startsWith('/s/') || req.path.startsWith('/media/')) return next();
  if (canAccessFoto(req.user)) {
    fotoLocals(req, res);
    return next();
  }
  if (!req.user && req.method === 'GET' && !req.path.startsWith('/media')) {
    return res.redirect('/prihlaseni?next=' + encodeURIComponent(req.originalUrl));
  }
  return render404(req, res);
}

router.use(requireFoto);

function render(res, view, extra) {
  return res.render(`foto/${view}`, {
    title: extra.title || 'Foták 11ka',
    ...extra,
  });
}

router.get('/', (req, res) => {
  const tym = String(req.query.tym || '').trim();
  const liga = String(req.query.liga || '').trim();
  const q = String(req.query.q || '').trim();
  const dateFrom = String(req.query.od || '').trim();
  const dateTo = String(req.query.do || '').trim();
  const albums = foto.listAlbums({ tym, liga, q, dateFrom, dateTo });
  render(res, 'alba', {
    title: 'Alba · Foták 11ka',
    albums,
    teams: foto.usedTeams(),
    leagues: foto.usedLeagues(),
    competitions: foto.COMPETITIONS,
    competitionGroups: foto.COMPETITION_GROUPS,
    tym,
    liga,
    q,
    dateFrom,
    dateTo,
    smazano: String(req.query.smazano || '') === '1',
  });
});

router.get('/logy', (req, res) => {
  if (!canManageFotoArchive(req.user)) return render404(req, res);
  const q = String(req.query.q || '').trim();
  const dateFrom = String(req.query.od || '').trim();
  const dateTo = String(req.query.do || '').trim();
  const action = String(req.query.akce || '').trim();
  render(res, 'logy', {
    title: 'Logy · Foták 11ka',
    logs: foto.listLogs({ q, dateFrom, dateTo, action }),
    q,
    dateFrom,
    dateTo,
    action,
  });
});

router.get('/alba', (req, res) => res.redirect('/foto'));

router.get('/alba/:id', async (req, res) => {
  const album = foto.getAlbum(req.params.id);
  if (!album) return render404(req, res);
  const squads = await foto.albumSquads(album);
  render(res, 'album', {
    title: `${album.title} · Foták 11ka`,
    album,
    photosJson: JSON.stringify(foto.listAlbumPhotos(album.id)),
    squadsJson: JSON.stringify(squads),
    canEdit: true,
  });
});

router.get('/hledat', (req, res) => {
  const q = String(req.query.q || '').trim();
  render(res, 'hledat', {
    title: 'Hledat · Foták 11ka',
    q,
    results: q ? foto.searchAll(q) : null,
  });
});

router.get('/hraci', (req, res) => {
  const q = String(req.query.q || '').trim();
  render(res, 'people', {
    title: 'Hráči · Foták 11ka',
    heading: 'Hráči',
    kind: 'hraci',
    q,
    people: foto.listPlayers({ q, role: 'PLAYER' }),
  });
});

router.get('/hraci/:slug', (req, res) => {
  const player = foto.getPlayer(req.params.slug);
  if (!player) return render404(req, res);
  render(res, 'player', {
    title: `${player.name} · Foták 11ka`,
    player,
    photos: foto.playerPhotos(player.id),
  });
});

router.get('/rozhodci', (req, res) => {
  const q = String(req.query.q || '').trim();
  render(res, 'people', {
    title: 'Rozhodčí · Foták 11ka',
    heading: 'Rozhodčí',
    kind: 'rozhodci',
    q,
    people: foto.listPlayers({ q, role: 'REFEREE' }),
  });
});

router.get('/fotografi', (req, res) => {
  render(res, 'fotografi', {
    title: 'Fotografové · Foták 11ka',
    photographers: foto.listPhotographers(),
  });
});

function renderPhotographer(req, res) {
  const person = foto.getPhotographer(req.params.slug);
  if (!person) return render404(req, res);
  return render(res, 'fotograf', {
    title: `${person.name} · Foták 11ka`,
    person,
    albums: foto.listAlbums({}).filter((a) => a.photographer_id === person.id),
  });
}

router.get('/fotografi/:slug', renderPhotographer);
router.get('/fotograf/:slug', renderPhotographer);

router.get('/tymy', (req, res) => {
  const q = String(req.query.q || '').trim();
  const liga = String(req.query.liga || '').trim();
  render(res, 'tymy', {
    title: 'Týmy · Foták 11ka',
    teams: foto.listTeams({ q, liga }),
    q,
    liga,
  });
});

router.get('/tymy/:slug', async (req, res) => {
  const team = foto.getTeam(req.params.slug);
  if (!team) return render404(req, res);
  await foto.syncTeamSquad(team.id, team.name);
  render(res, 'tym', {
    title: `${team.name} · Foták 11ka`,
    team,
    players: foto.listTeamPlayers(team.id, 'PLAYER'),
    staff: foto.listTeamPlayers(team.id, 'STAFF'),
    albums: foto.listAlbums({ tym: team.slug }),
  });
});

router.get('/presety', (req, res) => {
  render(res, 'presety', {
    title: 'Presety · Foták 11ka',
    presets: foto.listPresets(),
  });
});

router.get('/rozpis', (req, res) => {
  const liga = String(req.query.liga || '').trim();
  const q = String(req.query.q || '').trim();
  const fixtures = foto.listFixtures({ liga, q });
  const live = fixtures.filter((f) => f.isLive);
  const today = fixtures.filter((f) => f.isToday);
  const rest = fixtures.filter((f) => !f.isToday);
  const groups = [];
  for (const f of rest) {
    const last = groups[groups.length - 1];
    if (!last || last.date_key !== f.date_key) {
      groups.push({ date_key: f.date_key, date_label: f.date_label, items: [f] });
    } else {
      last.items.push(f);
    }
  }
  render(res, 'rozpis', {
    title: 'Rozpis · Foták 11ka',
    live,
    today,
    groups,
    leagues: foto.fixtureLeagues(),
    liga,
    q,
  });
});

router.get('/studio', (req, res) => res.redirect('/foto/studio/alba/nove'));

function albumFormLocals(extra) {
  return {
    teams: foto.teamsForPicker(),
    competitions: foto.COMPETITIONS,
    competitionGroups: foto.COMPETITION_GROUPS,
    teamLeagues: foto.TEAM_LEAGUES_FOR_COMP,
    ...extra,
  };
}

router.get('/studio/alba/nove', (req, res) => {
  render(res, 'studio-nove', albumFormLocals({
    title: 'Nové album · Foták 11ka',
    error: String(req.query.error || ''),
  }));
});

router.post('/studio/alba/nove', (req, res) => {
  const photographer = foto.ensurePhotographerForUser(req.user);
  const result = foto.createAlbum({
    title: req.body.title,
    matchDate: req.body.matchDate,
    competition: req.body.competition,
    venue: req.body.venue,
    notes: req.body.notes,
    homeScore: req.body.homeScore,
    awayScore: req.body.awayScore,
    homeTeamId: req.body.homeTeamId,
    awayTeamId: req.body.awayTeamId,
    homeTeamName: req.body.homeTeamName,
    awayTeamName: req.body.awayTeamName,
    photographerId: photographer.id,
  });
  if (result.error) return res.redirect('/foto/studio/alba/nove?error=' + result.error);
  foto.logEvent({
    ...actorOf(req),
    action: 'create_album',
    albumId: result.id,
    detail: req.body.title || 'Nové album',
  });
  return res.redirect('/foto/studio/alba/' + result.id);
});

router.get('/studio/alba/:id', async (req, res) => {
  const album = foto.getAlbum(req.params.id);
  if (!album) return render404(req, res);
  const squads = await foto.albumSquads(album);
  render(res, 'studio-album', albumFormLocals({
    title: `Upravit · ${album.title}`,
    album,
    saved: String(req.query.ok || '') === '1',
    error: String(req.query.error || ''),
    photosJson: JSON.stringify(foto.listAlbumPhotos(album.id)),
    squadsJson: JSON.stringify(squads),
  }));
});

router.post('/studio/alba/:id', (req, res) => {
  const album = foto.getAlbum(req.params.id);
  if (!album) return render404(req, res);
  const result = foto.updateAlbum(album.id, {
    title: req.body.title,
    matchDate: req.body.matchDate,
    competition: req.body.competition,
    venue: req.body.venue,
    notes: req.body.notes,
    homeScore: req.body.homeScore,
    awayScore: req.body.awayScore,
    homeTeamId: req.body.homeTeamId,
    awayTeamId: req.body.awayTeamId,
    homeTeamName: req.body.homeTeamName,
    awayTeamName: req.body.awayTeamName,
  });
  if (result.error) {
    return res.redirect('/foto/studio/alba/' + album.id + '?error=' + result.error);
  }
  foto.logEvent({
    ...actorOf(req),
    action: 'update_album',
    albumId: album.id,
    detail: req.body.title || album.title,
  });
  return res.redirect('/foto/studio/alba/' + album.id + '?ok=1');
});

router.post('/studio/alba/:id/smazat', (req, res) => {
  if (!canManageFotoArchive(req.user)) return render404(req, res);
  const album = foto.getAlbum(req.params.id);
  if (!album) return render404(req, res);
  foto.deleteAlbum(album.id);
  foto.logEvent({
    ...actorOf(req),
    action: 'delete_album',
    albumId: album.id,
    detail: album.title,
  });
  return res.redirect('/foto?smazano=1');
});

function jsonUploadError(res, message) {
  return res.status(400).json({
    ok: false,
    uploaded: 0,
    failed: [{ name: 'soubor', error: message }],
    total: 0,
  });
}

router.post('/studio/alba/:id/upload', (req, res, next) => {
  upload.array('photos', 8)(req, res, (err) => {
    if (!err) return next();
    const message = err.message || 'Nahrání se nezdařilo.';
    if (wantsJson(req)) return jsonUploadError(res, message);
    return res.redirect('/foto/studio/alba/' + encodeURIComponent(req.params.id) + '?error=upload');
  });
}, async (req, res) => {
  const album = foto.getAlbum(req.params.id);
  if (!album) return render404(req, res);
  const files = req.files || [];
  const failed = [];
  let uploaded = 0;
  for (const file of files) {
    try {
      const id = await foto.addPhotoFile(album.id, file);
      if (id) uploaded += 1;
      else failed.push({ name: file.originalname || 'foto', error: 'uložení se nezdařilo' });
    } catch (err) {
      console.error('[11ka] foto upload failed:', err && err.message);
      failed.push({ name: file.originalname || 'foto', error: err && err.message ? err.message : 'chyba' });
    }
  }
  foto.logEvent({
    ...actorOf(req),
    action: 'upload',
    albumId: album.id,
    detail: `Nahráno ${uploaded} z ${files.length}${failed.length ? `, selhalo ${failed.length}` : ''}`,
  });
  if (wantsJson(req)) {
    return res.json({ ok: failed.length === 0, uploaded, failed, total: files.length });
  }
  return res.redirect(
    '/foto/studio/alba/' + album.id + `?up=${uploaded}&fail=${failed.length}&total=${files.length}`
  );
});

router.post('/studio/alba/:id/photos/:photoId/smazat', (req, res) => {
  const photo = foto.getPhoto(req.params.photoId);
  foto.deletePhoto(req.params.photoId);
  foto.logEvent({
    ...actorOf(req),
    action: 'delete_photo',
    albumId: req.params.id,
    photoId: req.params.photoId,
    detail: photo && photo.original_name ? photo.original_name : 'fotka',
  });
  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect('/foto/studio/alba/' + req.params.id);
});

router.get('/api/players', (req, res) => {
  res.json({
    players: foto.searchPlayers(req.query.q, {
      homeTeamId: req.query.home || '',
      awayTeamId: req.query.away || '',
    }),
  });
});

router.post('/api/tags', express.json(), (req, res) => {
  const photoId = String(req.body.photoId || '');
  const playerId = String(req.body.playerId || '');
  if (!photoId || !playerId) return res.status(400).json({ ok: false });
  const tag = foto.addTag(photoId, playerId, req.body.x, req.body.y);
  return res.json({ ok: true, tag });
});

router.post('/api/tags/:id/smazat', (req, res) => {
  foto.removeTag(req.params.id);
  res.json({ ok: true });
});

router.get('/s/:token', (req, res) => {
  const share = foto.getShare(req.params.token);
  if (!share) return render404(req, res);
  fotoLocals(req, res);
  render(res, 'share', {
    title: `${share.player_name} · Foták 11ka`,
    share,
    photosJson: JSON.stringify(
      foto.sharePhotos(share.player_id).map((p) => ({
        id: p.id,
        width: p.width,
        height: p.height,
        kind: p.kind,
        originalName: '',
        size: 0,
        thumbSrc: foto.mediaUrl(p.id, 'thumb', `share=${encodeURIComponent(share.token)}`),
        viewSrc: foto.mediaUrl(p.id, 'view', `share=${encodeURIComponent(share.token)}`),
        tags: [],
      }))
    ),
  });
});

router.get('/media/:id', async (req, res) => {
  const photo = foto.getPhoto(req.params.id);
  if (!photo) return res.status(404).send('Nenalezeno');
  const shareToken = String(req.query.share || '');
  const dl = String(req.query.dl || '').trim().toLowerCase();
  const variant = String(req.query.v || (dl ? 'view' : 'thumb'));
  const tokenVariant = variant === 'view' || variant === 'original' || dl ? 'view' : 'thumb';
  const sessionUser = req.user || {
    id: req.session && req.session.userId,
    email: req.session && req.session.email,
    role: req.session && req.session.role,
    roles: req.session && req.session.roles,
  };
  const staff = canAccessFoto(sessionUser);
  const signed = foto.checkMediaToken(photo.id, tokenVariant, req.query.m);
  if (!staff && !signed) {
    if (!shareToken) return res.status(404).end();
    const share = foto.getShare(shareToken);
    if (!share) return res.status(404).end();
  }
  try {
    if (dl) {
      const fmt = dl === '1' || dl === 'true' || dl === 'view' ? 'jpeg' : dl;
      const converted = await foto.convertDownload(photo, fmt);
      if (!converted) return res.status(404).send('Chybí soubor');
      const base = String(photo.original_name || 'fotka').replace(/\.[^.]+$/, '') || 'fotka';
      res.setHeader('Content-Type', converted.contentType);
      res.setHeader('Cache-Control', 'private, max-age=120');
      res.setHeader('Content-Disposition', `attachment; filename="${base}${converted.ext}"`);
      if (staff) {
        foto.logEvent({
          ...actorOf(req),
          action: 'download',
          albumId: photo.album_id,
          photoId: photo.id,
          detail: `${fmt} · ${photo.original_name || photo.id}`,
        });
      }
      return res.send(converted.buf);
    }
    const rel = variant === 'thumb' ? photo.thumb_path : photo.original_path;
    const cached = typeof fotoS3.readDiskCache === 'function' ? fotoS3.readDiskCache(rel) : null;
    if (cached) {
      res.setHeader('Content-Type', cached.contentType || photo.mime_type || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(cached.buf);
    }
    if (fotoS3.isS3Path(rel) && fotoS3.hasS3Store() && typeof fotoS3.presignS3Get === 'function') {
      try {
        const signed = await fotoS3.presignS3Get(rel);
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.redirect(302, signed);
      } catch (err) {
        console.error('[11ka] foto presign failed:', err && err.message);
      }
    }
    const source = await foto.readMediaBytes(photo, variant === 'thumb' ? 'thumb' : 'view');
    if (!source) return res.status(404).send('Chybí soubor');
    res.setHeader('Content-Type', source.contentType || photo.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(source.buf);
  } catch (err) {
    console.error('[11ka] foto media failed:', err && err.message);
    return res.status(500).send('Chyba média');
  }
});

router.get('/avatar/:id', async (req, res) => {
  const user = require('../db')
    .getDb()
    .prepare('SELECT * FROM foto_users WHERE id = ?')
    .get(req.params.id);
  if (!user || !user.avatar) return res.redirect('/user.png');
  if (user.avatar.startsWith('/')) return res.redirect(user.avatar);
  if (user.avatar.startsWith('http') && !user.avatar.includes('blob.vercel-storage.com')) {
    return res.redirect(user.avatar);
  }
  if (fotoS3Like(user.avatar)) {
    try {
      const cached = typeof fotoS3.readDiskCache === 'function' ? fotoS3.readDiskCache(user.avatar) : null;
      if (cached) {
        res.setHeader('Content-Type', cached.contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(cached.buf);
      }
      if (typeof fotoS3.presignS3Get === 'function') {
        const signed = await fotoS3.presignS3Get(user.avatar);
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.redirect(302, signed);
      }
    } catch {
      /* fall through */
    }
  }
  return res.redirect('/user.png');
});

function fotoS3Like(value) {
  return String(value || '').startsWith('s3://');
}

module.exports = router;

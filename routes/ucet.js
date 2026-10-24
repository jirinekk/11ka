const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { requireLogin } = require('../middleware/auth');
const usersService = require('../services/users');
const rubricsService = require('../services/rubrics');
const chanceLigaLogos = require('../services/chance-liga-logos');
const { asStringArray } = require('../lib/safe-path');
const { isStaffUser } = require('../lib/roles');

const router = express.Router();
const uploadRoot = path.join(__dirname, '..', 'public', 'uploads', 'avatars');

function ensureDir() {
  if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDir();
    cb(null, uploadRoot);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    if (/^image\/(heic|heif)$/.test(file.mimetype)) {
      return cb(new Error('Formát HEIC/HEIF bohužel nepodporujeme. Nahrajte prosím JPG, PNG, WebP nebo GIF.'));
    }
    return cb(new Error('Povolené jsou jen obrázky JPG/JPEG, PNG, WebP nebo GIF.'));
  },
});

function ucetViewModel(u) {
  const pending = usersService.hasPendingAuthorBio(u);
  const live = usersService.getPublicAuthorBio(u);
  const draft =
    (pending && u.author_bio_pending) ||
    live ||
    (u.author_bio_pending && String(u.author_bio_pending).trim()) ||
    '';
  const profile = usersService.hydratePublicProfile(u);
  return {
    user: u,
    bioDraft: draft,
    bioLive: live,
    bioPending: pending,
    authorBioMax: usersService.AUTHOR_BIO_MAX,
    publicBioMax: usersService.PUBLIC_BIO_MAX,
    publicBio: u.public_bio || '',
    profileHref: usersService.profilePath(u),
    isStaff: isStaffUser(u),
    chanceLigaClubs: chanceLigaLogos.listClubs(),
    favoriteTeamCode: (profile && profile.favorite_team_code) || '',
    starredCodes: (profile && profile.starredCodes) || [],
    rubricSubscriptions: rubricsService.listSubscriptionsForEmail(u && u.email),
  };
}

router.post('/ucet/rubriky-oznameni', requireLogin, (req, res) => {
  const u = usersService.getById(req.session.userId);
  const slug = String(req.body.slug || '').trim();
  const rubric = rubricsService.getBySlug(slug);
  if (rubric && u && u.email) {
    rubricsService.unsubscribe(rubric.id, u.email);
  }
  return res.redirect('/ucet');
});

router.get('/ucet', requireLogin, (req, res) => {
  const u = usersService.getById(req.session.userId);
  res.render('ucet', {
    title: 'Správa účtu - 11ka',
    ...ucetViewModel(u),
    error: null,
    success: null,
  });
});

router.post('/ucet', requireLogin, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, (req, res) => {
  const u = usersService.getById(req.session.userId);
  const display_name = req.body.display_name;
  const author_bio = req.body.author_bio;
  const public_bio = req.body.public_bio;
  const favorite_team_code = req.body.favorite_team_code;
  const starred_teams = asStringArray(req.body.starred_teams);
  const current = req.body.current_password;
  const newPass = req.body.new_password;
  const newPass2 = req.body.new_password_confirm;

  let error = null;
  if (newPass || newPass2) {
    if (!current || !usersService.verifyPassword(current, usersService.getByEmail(u.email).password_hash)) {
      error = 'Současné heslo není správné.';
    } else if (String(newPass || '').length < 8) {
      error = 'Nové heslo musí mít alespoň 8 znaků.';
    } else if (newPass !== newPass2) {
      error = 'Nová hesla se neshodují.';
    }
  }

  if (error) {
    return res.render('ucet', {
      title: 'Správa účtu - 11ka',
      ...ucetViewModel({ ...u, display_name: display_name || u.display_name, author_bio_pending: author_bio }),
      error,
      success: null,
    });
  }

  if (newPass) {
    usersService.updatePassword(u.id, newPass);
  }

  let avatar_path = u.avatar_path;
  if (req.file) {
    avatar_path = '/uploads/avatars/' + req.file.filename;
    if (u.avatar_path && u.avatar_path.startsWith('/uploads/')) {
      const oldAbs = path.join(__dirname, '..', 'public', u.avatar_path.replace(/^\//, ''));
      try {
        if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
      } catch {
        /* ignore */
      }
    }
  }

  usersService.updateProfile(u.id, {
    display_name: display_name || null,
    avatar_path,
    public_bio,
    favorite_team_code,
  });
  usersService.setStarredTeams(u.id, starred_teams);

  let bioResult = { status: 'unchanged' };
  if (isStaffUser(u)) {
    bioResult = usersService.submitAuthorBio(u.id, author_bio, { autoApprove: false });
  }

  const fresh = usersService.getById(req.session.userId);
  let success = 'Údaje byly uloženy.';
  if (bioResult.status === 'pending') {
    success = 'Údaje uloženy. Text O autorovi čeká na schválení vedením.';
  }

  res.render('ucet', {
    title: 'Správa účtu - 11ka',
    ...ucetViewModel(fresh),
    error: null,
    success,
  });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const u = usersService.getById(req.session.userId);
    return res.status(400).render('ucet', {
      title: 'Správa účtu - 11ka',
      ...ucetViewModel(u),
      error: err.message || 'Chyba nahrávání souboru.',
      success: null,
    });
  }
  if (err) {
    const u = usersService.getById(req.session.userId);
    return res.status(400).render('ucet', {
      title: 'Správa účtu - 11ka',
      ...ucetViewModel(u),
      error: err.message || 'Nahrání souboru se nezdařilo.',
      success: null,
    });
  }
  next();
});

module.exports = router;

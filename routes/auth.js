const express = require('express');
const rateLimit = require('express-rate-limit');
const usersService = require('../services/users');
const { safeNextPath } = require('../lib/safe-path');
const { isStaffUser } = require('../lib/roles');
const authCookie = require('../lib/auth-cookie');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function nextFrom(req) {
  return safeNextPath((req.body && req.body.next) || req.query.next || '');
}

function redirectAfterAuth(req, user) {
  const nextUrl = nextFrom(req);
  if (nextUrl) return nextUrl;
  if (user && usersService.profilePath(user)) return usersService.profilePath(user);
  return '/';
}

function loginLocals(req, extras = {}) {
  return {
    title: extras.title || 'Přihlášení - 11ka',
    error: extras.error || null,
    nextUrl: extras.nextUrl != null ? extras.nextUrl : nextFrom(req),
    showSearchLogin: false,
    showNav: false,
  };
}

function registerLocals(req, extras = {}) {
  return {
    title: extras.title || 'Registrace - 11ka',
    error: extras.error || null,
    nextUrl: extras.nextUrl != null ? extras.nextUrl : nextFrom(req),
    form: extras.form || {},
    showSearchLogin: false,
    showNav: false,
  };
}

function startSession(req, res, user) {
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.roles = user.roles || [user.role];
  req.session.email = user.email;
  authCookie.set(res, user);
}

router.get('/prihlaseni', (req, res) => {
  if (req.session.userId) {
    return res.redirect(nextFrom(req) || '/');
  }
  res.render('prihlaseni', loginLocals(req));
});

router.post('/prihlaseni', loginLimiter, express.urlencoded({ extended: true }), (req, res) => {
  const { email, password } = req.body;
  const user = usersService.getByLogin(email || '');
  if (!user || !usersService.verifyPassword(password || '', user.password_hash)) {
    return res.status(401).render(
      'prihlaseni',
      loginLocals(req, { error: 'Neplatný e-mail nebo heslo.' })
    );
  }
  startSession(req, res, user);
  const dest = nextFrom(req);
  if (dest) return res.redirect(dest);
  if (isStaffUser(user)) return res.redirect('/administrace');
  return res.redirect(usersService.profilePath(user) || '/');
});

router.get('/registrace', (req, res) => {
  if (req.session.userId) {
    return res.redirect(nextFrom(req) || '/ucet');
  }
  res.render('registrace', registerLocals(req));
});

router.post('/registrace', registerLimiter, express.urlencoded({ extended: true }), (req, res) => {
  const { email, password, password_confirm, display_name } = req.body;
  const form = {
    email: String(email || '').trim(),
    display_name: String(display_name || '').trim(),
  };
  const fail = (error) =>
    res.status(400).render('registrace', registerLocals(req, { error, form }));

  if (String(password || '') !== String(password_confirm || '')) {
    return fail('Hesla se neshodují.');
  }

  try {
    const id = usersService.registerReader({
      email,
      password,
      display_name,
    });
    const user = usersService.getById(id);
    startSession(req, res, user);
    return res.redirect(redirectAfterAuth(req, user));
  } catch (e) {
    const code = e && e.message;
    if (code === 'email_taken') return fail('Tento e-mail už je zaregistrovaný.');
    if (code === 'display_name') return fail('Zobrazované jméno musí mít 2–40 znaků.');
    if (code === 'password') return fail('Heslo musí mít alespoň 8 znaků.');
    if (code === 'email') return fail('Zadejte platný e-mail.');
    if (code && String(code).includes('UNIQUE')) return fail('Tento e-mail už je zaregistrovaný.');
    console.error('[11ka] register failed:', e && e.message);
    return fail('Registrace se nezdařila. Zkuste to znovu.');
  }
});

router.post('/odhlaseni', (req, res) => {
  authCookie.clear(res);
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;

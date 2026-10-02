const express = require('express');
const rateLimit = require('express-rate-limit');
const usersService = require('../services/users');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/prihlaseni', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('prihlaseni', {
    title: 'Přihlášení - 11ka',
    error: null,
    nextUrl: req.query.next || '',
    showSearchLogin: false,
    showNav: false,
  });
});

router.post('/prihlaseni', loginLimiter, express.urlencoded({ extended: true }), (req, res) => {
  const { email, password, next: nextUrl } = req.body;
  const user = usersService.getByEmail(email || '');
  if (!user || !usersService.verifyPassword(password || '', user.password_hash)) {
    return res.status(401).render('prihlaseni', {
      title: 'Přihlášení - 11ka',
      error: 'Neplatný e-mail nebo heslo.',
      nextUrl: nextUrl || '',
      showSearchLogin: false,
      showNav: false,
    });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.roles = user.roles || [user.role];
  req.session.email = user.email;
  res.redirect('/');
});

router.post('/odhlaseni', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;

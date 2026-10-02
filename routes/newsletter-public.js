const express = require('express');
const rateLimit = require('express-rate-limit');
const newsletterService = require('../services/newsletter');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/newsletter', limiter, express.urlencoded({ extended: true }), (req, res) => {
  const email = req.body.email;
  let q = 'bad';
  try {
    q = newsletterService.subscribe(email);
  } catch (e) {
    console.error('[11ka] newsletter subscribe:', e);
    q = 'bad';
  }
  res.redirect('/?newsletter=' + encodeURIComponent(q));
});

function parseUnsubscribeEmail(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed.includes(' ')) return trimmed;
  const fixed = trimmed.replace(/ /g, '+');
  if (newsletterService.isValidEmail(newsletterService.normalizeEmail(fixed))) {
    return fixed;
  }
  return trimmed;
}

router.get('/newsletter/odhlasit', (req, res) => {
  const email = parseUnsubscribeEmail(req.query.email);
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  const okToken = newsletterService.verifyUnsubscribeToken(email, token);
  const removed = okToken ? newsletterService.unsubscribe(email) : false;

  const pageTitle = removed ? 'Odhlášení z newsletteru' : 'Odkaz pro odhlášení je neplatný';
  const sections = removed
    ? [
        {
          heading: 'Hotovo',
          paragraphs: [
            'Byli jste odhlášeni z odběru newsletteru 11ka.',
            'Pokud to byl omyl, můžete se kdykoliv znovu přihlásit na hlavní stránce.',
          ],
        },
      ]
    : [
        {
          heading: 'Neplatný odkaz',
          paragraphs: [
            'Odkaz pro odhlášení je neplatný nebo vypršel.',
            'Zkuste kliknout na nejnovější e-mail z newsletteru (obsahuje aktuální odhlašovací odkaz).',
          ],
        },
      ];

  res.render('static', {
    title: pageTitle + ' - 11ka',
    activeNav: 'home',
    showSearchLogin: true,
    pageTitle,
    sections,
    newsletter: { description: '' },
    adMap: {},
  });
});

module.exports = router;

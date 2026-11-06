const express = require('express');
const accreditationNotify = require('../services/accreditation-notify');

const router = express.Router();

function cronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || process.env.SESSION_SECRET || '').trim();
  if (!secret) return false;
  const header = String(req.headers.authorization || '');
  const query = String(req.query.secret || req.query.token || '');
  return header === `Bearer ${secret}` || query === secret;
}

router.get('/accreditation-match-day', async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const result = await accreditationNotify.sendDueMatchDayReminders();
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[11ka] match-day cron:', err && err.message);
    return res.status(500).json({ ok: false, error: err && err.message });
  }
});

module.exports = router;

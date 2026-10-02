const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { fetchOembedHtml, validateOembedUrl } = require('../lib/oembed');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

router.post('/oembed', requireLogin, async (req, res) => {
  const url = req.body && req.body.url;
  const validated = validateOembedUrl(url);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  const result = await fetchOembedHtml(validated.url);
  if (!result.ok) {
    return res.status(422).json({ error: result.error });
  }

  return res.json({
    html: result.html,
    title: result.title,
  });
});

module.exports = router;

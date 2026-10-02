const express = require('express');
const mostReadService = require('../services/most-read');

const router = express.Router();

function parseCategoryParam(value) {
  if (value == null || value === '') return undefined;
  const raw = String(value);
  if (raw.includes('|')) {
    return raw.split('|').map((part) => part.trim()).filter(Boolean);
  }
  return raw.trim() || undefined;
}

router.get('/most-read', (req, res) => {
  const layout = req.query.layout === 'sidebar' ? 'sidebar' : 'grid';
  const scope = req.query.scope != null ? String(req.query.scope).trim() : 'global';
  const category = parseCategoryParam(req.query.category);
  const tag = req.query.tag != null ? String(req.query.tag).trim().slice(0, 60) : '';
  const query = req.query.q != null ? String(req.query.q).trim().slice(0, 80) : '';

  const limitRaw = parseInt(req.query.limit, 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, mostReadService.DISPLAY_LIMIT)
      : mostReadService.DISPLAY_LIMIT;

  const items = mostReadService.getMostReadCards({
    force: true,
    layout,
    scope,
    category,
    tag,
    query,
    limit,
  });
  const signature = mostReadService.getLiveSignature(items);
  const partial =
    layout === 'sidebar' ? 'partials/most-read-sidebar-list' : 'partials/most-read-grid-items';

  res.render(partial, { items }, (err, html) => {
    if (err) {
      return res.status(500).json({ error: 'Nepodařilo se načíst nejčtenější články.' });
    }
    return res.json({ signature, html });
  });
});

module.exports = router;

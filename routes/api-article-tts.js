const express = require('express');
const rateLimit = require('express-rate-limit');
const articleTts = require('../services/article-tts');

const router = express.Router();

const ttsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/article-tts', ttsLimiter, async (req, res) => {
  if (!articleTts.isConfigured()) {
    return res.status(501).json({ ok: false, error: 'Audio komentář teď není dostupný.' });
  }
  const slug = String(req.query.slug || '').trim().slice(0, 180);
  const chunkIndex = Math.max(0, parseInt(String(req.query.chunk || '0'), 10) || 0);
  if (!slug) return res.status(400).json({ ok: false, error: 'Chybí článek.' });

  let prepared;
  try {
    prepared = articleTts.getArticleChunks(slug);
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: err.message });
    if (err && err.code === 'EMPTY') return res.status(422).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Text se nepodařilo připravit.' });
  }

  if (chunkIndex >= prepared.chunks.length) {
    return res.status(400).json({ ok: false, error: 'Neplatná část audio.' });
  }

  try {
    const previousText = chunkIndex > 0 ? prepared.chunks[chunkIndex - 1] : '';
    const nextText = chunkIndex + 1 < prepared.chunks.length ? prepared.chunks[chunkIndex + 1] : '';
    const audio = await articleTts.synthesizeChunk(prepared.chunks[chunkIndex], { previousText, nextText });
    res.setHeader('Content-Type', audio.mime || 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Tts-Chunk', String(chunkIndex));
    res.setHeader('X-Tts-Chunks', String(prepared.chunks.length));
    res.setHeader('X-Tts-Engine', audio.engine || 'neural');
    if (audio.voice) res.setHeader('X-Tts-Voice', String(audio.voice));
    return res.send(audio.buffer);
  } catch (err) {
    const status = err && err.status === 429 ? 429 : 502;
    return res.status(status).json({
      ok: false,
      error: 'Hlas se teď nepodařilo načíst.',
    });
  }
});

module.exports = router;

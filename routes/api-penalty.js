const express = require('express');
const penaltyGameService = require('../services/penalty-game');
const penaltyPlayersService = require('../services/penalty-players');
const penaltyLeaderboardService = require('../services/penalty-leaderboard');

const router = express.Router();

function penaltyInactive(res) {
  return res.status(403).json({ ok: false, error: 'Hra není aktivní.' });
}

function handlePenaltyError(res, e) {
  const message = e && e.message ? e.message : 'Požadavek se nezdařil.';
  const code = e && e.code;
  const status =
    code === 'VALIDATION'
      ? 400
      : code === 'EMAIL_EXISTS'
        ? 409
        : code === 'NOT_FOUND'
          ? 404
          : 500;
  return res.status(status).json({ ok: false, error: message, code: code || null });
}

router.post('/penalty/register', express.json({ limit: '16kb' }), (req, res) => {
  if (!penaltyGameService.getPublicConfig().active) return penaltyInactive(res);
  try {
    const session = penaltyPlayersService.createPlayer({
      display_name: req.body && req.body.display_name,
      email: req.body && req.body.email,
      article_slug: req.body && req.body.article_slug,
      article_title: req.body && req.body.article_title,
    });
    return res.json({ ok: true, ...session });
  } catch (e) {
    return handlePenaltyError(res, e);
  }
});

router.post('/penalty/login', express.json({ limit: '16kb' }), (req, res) => {
  if (!penaltyGameService.getPublicConfig().active) return penaltyInactive(res);
  try {
    const session = penaltyPlayersService.loginPlayer({
      email: req.body && req.body.email,
      article_slug: req.body && req.body.article_slug,
    });
    return res.json({ ok: true, ...session });
  } catch (e) {
    return handlePenaltyError(res, e);
  }
});

router.get('/penalty/session', (req, res) => {
  if (!penaltyGameService.getPublicConfig().active) return penaltyInactive(res);
  try {
    const session = penaltyPlayersService.restorePlayerSession({
      player_id: req.query && req.query.playerId,
      article_slug: req.query && req.query.articleSlug,
    });
    return res.json({ ok: true, ...session });
  } catch (e) {
    return handlePenaltyError(res, e);
  }
});

router.post('/penalty/progress', express.json({ limit: '16kb' }), (req, res) => {
  if (!penaltyGameService.getPublicConfig().active) return penaltyInactive(res);
  try {
    const progress = penaltyPlayersService.saveProgress({
      player_id: req.body && req.body.player_id,
      article_slug: req.body && req.body.article_slug,
      article_title: req.body && req.body.article_title,
      goals: req.body && req.body.goals,
      round: req.body && req.body.round,
      points_per_goal: req.body && req.body.points_per_goal,
      keeper_id: req.body && req.body.keeper_id,
      started: req.body && req.body.started,
      finished: req.body && req.body.finished,
    });
    return res.json({ ok: true, progress });
  } catch (e) {
    return handlePenaltyError(res, e);
  }
});

router.get('/penalty/leaderboard', (req, res) => {
  if (!penaltyGameService.getPublicConfig().active) return penaltyInactive(res);
  const limit = req.query && req.query.limit;
  const entries = penaltyLeaderboardService.listTopGlobal(limit);
  return res.json({ ok: true, entries });
});

router.post('/penalty/score', express.json({ limit: '16kb' }), (req, res) => {
  if (!penaltyGameService.getPublicConfig().active) return penaltyInactive(res);
  try {
    const result = penaltyLeaderboardService.addScore(
      req.body && req.body.player_id,
      req.body && req.body.article_slug,
      req.body && req.body.points
    );
    const entries = penaltyLeaderboardService.listTopGlobal();
    return res.json({
      ok: true,
      totalPoints: result.globalPoints,
      entries,
    });
  } catch (e) {
    return handlePenaltyError(res, e);
  }
});

module.exports = router;

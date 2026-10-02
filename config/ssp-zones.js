/**
 * Seznam SSP - ID reklamních zón.
 * Každý placement na stránce musí mít vlastní zoneId (jinak se zobrazí stejná reklama).
 * Zóny 970×210 vytvořte v https://partner.seznam.cz a doplňte ID níže nebo přes env SSP_HOME_LB_*.
 */
function readZone(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw != null && String(raw).trim() !== '') {
    const parsed = parseInt(String(raw).trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback > 0 ? fallback : null;
}

const HOME_LEADERBOARD_ZONE_DEFAULTS = {
  'cesky-fotbal': 411555,
};

const HOME_LEADERBOARD_ENV_KEYS = {
  'cesky-fotbal': 'SSP_HOME_LB_CESKY',
};

function getHomeLeaderboardZoneId(slug) {
  const envKey = HOME_LEADERBOARD_ENV_KEYS[slug];
  const fallback = HOME_LEADERBOARD_ZONE_DEFAULTS[slug] || 0;
  if (!envKey) return null;

  const fromEnv = readZone(envKey, null);
  if (fromEnv) return fromEnv;
  if (fallback > 0) return fallback;

  // Dokud není vlastní zóna, použij společný leaderboard (stejná reklama).
  return readZone('SSP_HOME_LB_CESKY', 411555);
}

function buildHomeLeaderboardPlacements() {
  const width = 970;
  const height = 210;
  return Object.keys(HOME_LEADERBOARD_ZONE_DEFAULTS)
    .map((slug) => {
      const zoneId = getHomeLeaderboardZoneId(slug);
      if (!zoneId) return null;
      return {
        slug,
        zoneId,
        wrapId: 'home-ssp-wrap-' + slug,
        domId: 'ssp-zone-' + zoneId + '-home-' + slug,
        width,
        height,
      };
    })
    .filter(Boolean);
}

function getHomeLeaderboardPlacementsBySlug() {
  const map = {};
  for (const placement of buildHomeLeaderboardPlacements()) {
    map[placement.slug] = placement;
  }
  return map;
}

module.exports = {
  getHomeLeaderboardZoneId,
  buildHomeLeaderboardPlacements,
  getHomeLeaderboardPlacementsBySlug,
};

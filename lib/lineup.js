function asTrimmed(value, maxLen) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (maxLen && text.length > maxLen) return text.slice(0, maxLen);
  return text;
}

function normalizePlayerNumber(value) {
  if (value == null || value === '') return null;
  const n = parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 99) return null;
  return n;
}

function normalizePlayerEntry(entry) {
  if (typeof entry === 'string') {
    return { name: asTrimmed(entry, 80), number: null };
  }
  if (entry && typeof entry === 'object') {
    return {
      name: asTrimmed(entry.name, 80),
      number: normalizePlayerNumber(entry.number),
    };
  }
  return { name: '', number: null };
}

function serializePlayerEntry(player) {
  const normalized = normalizePlayerEntry(player);
  const out = { name: normalized.name };
  if (normalized.number != null) out.number = normalized.number;
  return out;
}

const { positionLabelsForFormation } = require('../public/js/lineup-positions.js');

function parseFormation(str) {
  const raw = asTrimmed(str, 32);
  if (!raw) return null;
  if (!/^\d+(?:-\d+)*$/.test(raw)) return null;
  const lines = raw.split('-').map((part) => parseInt(part, 10));
  if (!lines.length || lines.some((n) => !Number.isFinite(n) || n < 1 || n > 9)) return null;
  return lines;
}

function playerCountForFormation(lines) {
  if (!Array.isArray(lines) || !lines.length) return 0;
  return 1 + lines.reduce((sum, n) => sum + n, 0);
}

function isValidFormationLines(lines) {
  if (!lines || !lines.length) return false;
  const outfield = lines.reduce((sum, n) => sum + n, 0);
  return outfield === 10;
}

function normalizeTeam(team) {
  if (!team || typeof team !== 'object') return null;
  const label = asTrimmed(team.label, 120);
  const formation = asTrimmed(team.formation, 32);
  const lines = parseFormation(formation);
  if (!lines || !isValidFormationLines(lines)) return null;

  const expected = playerCountForFormation(lines);
  const playersIn = Array.isArray(team.players) ? team.players : [];
  const players = [];
  for (let i = 0; i < expected; i += 1) {
    players.push(normalizePlayerEntry(playersIn[i]));
  }

  if (!label && players.every((p) => !p.name && p.number == null)) return null;

  return {
    label: label || 'Sestava',
    formation,
    lines,
    players,
  };
}

function normalizeLineupInput(raw) {
  if (raw == null || raw === '') return null;

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.enabled === false) return null;

  const teamsIn = Array.isArray(parsed.teams) ? parsed.teams : [];
  const teams = [];
  for (let i = 0; i < teamsIn.length && teams.length < 2; i += 1) {
    const team = normalizeTeam(teamsIn[i]);
    if (team) teams.push(team);
  }

  if (!teams.length) return null;

  return {
    enabled: true,
    teams: teams.map((t) => ({
      label: t.label,
      formation: t.formation,
      players: t.players,
    })),
  };
}

function lineupHasContent(lineup) {
  return !!(lineup && Array.isArray(lineup.teams) && lineup.teams.length);
}

function validateLineupForSave(raw, options = {}) {
  const requireEnabled = options.requireEnabled !== false;
  if (raw == null || raw === '') {
    return requireEnabled ? { ok: false, error: 'Sestava není vyplněná.' } : { ok: true, lineup: null };
  }

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Neplatná data sestavy.' };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Neplatná data sestavy.' };
  }

  if (parsed.enabled === false || !parsed.teams || !parsed.teams.length) {
    return { ok: true, lineup: null };
  }

  if (parsed.enabled === true && (!parsed.teams || !parsed.teams.length)) {
    return { ok: false, error: 'Vyplňte alespoň jeden tým sestavy.' };
  }

  const teamsIn = Array.isArray(parsed.teams) ? parsed.teams.slice(0, 2) : [];
  if (!teamsIn.length) {
    return { ok: false, error: 'Vyplňte alespoň jeden tým sestavy.' };
  }

  for (let i = 0; i < teamsIn.length; i += 1) {
    const team = teamsIn[i] || {};
    const formation = asTrimmed(team.formation, 32);
    const lines = parseFormation(formation);
    if (!lines) {
      return { ok: false, error: `Tým ${i + 1}: zadejte platnou formaci.` };
    }
    if (!isValidFormationLines(lines)) {
      const sum = lines.reduce((a, b) => a + b, 0);
      return {
        ok: false,
        error: `Tým ${i + 1}: formace ${formation} má ${sum} hráčů v poli - musí být 10 (bez brankáře).`,
      };
    }
  }

  const lineup = normalizeLineupInput(parsed);
  if (!lineup) {
    return { ok: false, error: 'Sestavu se nepodařilo zpracovat.' };
  }

  return { ok: true, lineup };
}

function serializeLineup(lineup) {
  if (!lineupHasContent(lineup)) return null;
  return JSON.stringify({
    enabled: true,
    teams: lineup.teams.map((t) => ({
      label: t.label,
      formation: t.formation,
      players: t.players.map(serializePlayerEntry),
    })),
  });
}

function prepareLineupForView(raw) {
  const lineup = normalizeLineupInput(raw);
  if (!lineupHasContent(lineup)) return null;

  return {
    teams: lineup.teams.map((team) => {
      const lines = parseFormation(team.formation) || [];
      const positionLabels = positionLabelsForFormation(lines);
      const rows = [];
      let idx = 0;
      rows.push({
        role: 'Brankář',
        players: [
          {
            name: team.players[idx].name || '',
            number: team.players[idx].number,
            position: positionLabels[idx] || 'Brankář',
            index: idx,
          },
        ],
      });
      idx += 1;
      for (let li = 0; li < lines.length; li += 1) {
        const count = lines[li];
        const rowPlayers = [];
        for (let pi = 0; pi < count; pi += 1) {
          rowPlayers.push({
            name: team.players[idx].name || '',
            number: team.players[idx].number,
            position: positionLabels[idx] || '',
            index: idx,
          });
          idx += 1;
        }
        rows.push({
          role: '',
          players: rowPlayers,
        });
      }
      return {
        label: team.label,
        formation: team.formation,
        rows,
      };
    }),
  };
}

function parseLineupStored(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

module.exports = {
  parseFormation,
  playerCountForFormation,
  isValidFormationLines,
  normalizeLineupInput,
  lineupHasContent,
  validateLineupForSave,
  serializeLineup,
  prepareLineupForView,
  parseLineupStored,
};

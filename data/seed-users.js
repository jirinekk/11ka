const fs = require('fs');
const path = require('path');

const SEED_USERS_PATH = path.join(__dirname, 'seed-users.json');

let cachedUsers = null;

function loadSeedUsers() {
  if (cachedUsers) return cachedUsers;
  try {
    if (!fs.existsSync(SEED_USERS_PATH)) {
      cachedUsers = [];
      return cachedUsers;
    }
    const raw = JSON.parse(fs.readFileSync(SEED_USERS_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.users) ? raw.users : [];
    cachedUsers = list.filter((item) => item && item.email && item.display_name);
    return cachedUsers;
  } catch (e) {
    console.error('[11ka] seed-users.json unreadable:', e && e.message);
    cachedUsers = [];
    return cachedUsers;
  }
}

function seedStaffEmails() {
  return loadSeedUsers()
    .map((item) => String(item.email || '').trim().toLowerCase())
    .filter(Boolean);
}

module.exports = {
  SEED_USERS_PATH,
  loadSeedUsers,
  seedStaffEmails,
};

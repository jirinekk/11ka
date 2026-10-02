/**
 * Vytvoří uživatele v SQLite (stejně jako administrace).
 *
 * Usage:
 *   node scripts/create-user.js <email> <password> <role[,role...]> [display_name]
 *
 * role: majitel | vedeni | sefredaktor | redaktor | spravce_akreditace
 * Více rolí oddělte čárkou, např. redaktor,spravce_akreditace
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const usersService = require('../services/users');
const { ROLES, normalizeRoles } = require('../lib/roles');

const [, , email, password, rolesArg, ...displayParts] = process.argv;
const display_name = displayParts.length ? displayParts.join(' ') : null;

if (!email || !password || !rolesArg) {
  console.error('Usage: node scripts/create-user.js <email> <password> <role[,role...]> [display_name]');
  console.error('Roles:', ROLES.join(', '));
  process.exit(1);
}

const roles = normalizeRoles(String(rolesArg).split(','));
if (!roles.length) {
  console.error('Neplatná role. Povolené:', ROLES.join(', '));
  process.exit(1);
}

if (usersService.getByEmail(email)) {
  console.error('Uživatel s tímto e-mailem už existuje:', email);
  process.exit(1);
}

const id = usersService.createUser({ email, password, roles, display_name });
console.log('Vytvořen uživatel id=%d email=%s roles=%s', id, email.trim().toLowerCase(), roles.join(','));
if (display_name) console.log('Jméno:', display_name);

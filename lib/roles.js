const STAFF_ROLES = ['majitel', 'vedeni', 'sefredaktor', 'redaktor', 'fotograf', 'spravce_akreditace'];
const EDITORIAL_ROLES = ['majitel', 'vedeni', 'sefredaktor', 'redaktor'];
const FOTO_ROLES = ['majitel', 'vedeni', 'sefredaktor', 'redaktor', 'fotograf'];
const ROLES = [...STAFF_ROLES, 'ctenar'];

const ROLE_LABELS = {
  majitel: 'Majitel',
  vedeni: 'Vedení',
  sefredaktor: 'Šéfredaktor',
  redaktor: 'Redaktor',
  fotograf: 'Fotograf',
  spravce_akreditace: 'Správce Akreditace',
  ctenar: 'Čtenář',
};

/** Priority for primary/display role (highest first). */
const ROLE_PRIORITY = ['majitel', 'vedeni', 'sefredaktor', 'redaktor', 'fotograf', 'spravce_akreditace', 'ctenar'];

function isValidRole(role) {
  return ROLES.includes(role);
}

function normalizeRoles(input) {
  const raw = Array.isArray(input) ? input : input != null && input !== '' ? [input] : [];
  const unique = [];
  for (const item of raw) {
    const role = String(item || '').trim();
    if (!isValidRole(role) || unique.includes(role)) continue;
    unique.push(role);
  }
  return ROLE_PRIORITY.filter((r) => unique.includes(r));
}

function primaryRole(roles) {
  const list = normalizeRoles(roles);
  return list[0] || null;
}

function parseRoles(rolesRaw, fallbackRole) {
  if (Array.isArray(rolesRaw)) {
    const normalized = normalizeRoles(rolesRaw);
    if (normalized.length) return normalized;
  } else if (typeof rolesRaw === 'string' && rolesRaw.trim()) {
    try {
      const parsed = JSON.parse(rolesRaw);
      if (Array.isArray(parsed)) {
        const normalized = normalizeRoles(parsed);
        if (normalized.length) return normalized;
      }
    } catch {
      /* fall through */
    }
    if (rolesRaw.includes(',')) {
      const normalized = normalizeRoles(rolesRaw.split(','));
      if (normalized.length) return normalized;
    }
    if (isValidRole(rolesRaw.trim())) return [rolesRaw.trim()];
  }
  if (fallbackRole && isValidRole(fallbackRole)) return [fallbackRole];
  return [];
}

function serializeRoles(roles) {
  return JSON.stringify(normalizeRoles(roles));
}

function userRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length) return normalizeRoles(user.roles);
  return parseRoles(user.roles, user.role);
}

function hasRole(user, role) {
  const roles = userRoles(user);
  if (role === 'vedeni' && roles.includes('majitel')) return true;
  return roles.includes(role);
}

function hasAnyRole(user, ...allowed) {
  if (!allowed.length) return false;
  const flat = allowed.flat();
  return flat.some((role) => hasRole(user, role));
}

function isStaffUser(user) {
  return hasAnyRole(user, ...STAFF_ROLES);
}

function isAkreditaceOnly(user) {
  const roles = userRoles(user);
  return roles.length === 1 && roles[0] === 'spravce_akreditace';
}

function isFotografOnly(user) {
  const roles = userRoles(user);
  return roles.length === 1 && roles[0] === 'fotograf';
}

function isEditorialStaff(user) {
  return hasAnyRole(user, ...EDITORIAL_ROLES);
}

function canAccessFoto(user) {
  return hasAnyRole(user, ...FOTO_ROLES);
}

/** Redaktor without publish rights (not vedení / šéfredaktor). */
function isRedaktorWorkflow(user) {
  return hasRole(user, 'redaktor') && !hasAnyRole(user, 'vedeni', 'sefredaktor');
}

function formatRoles(user) {
  return userRoles(user)
    .map((r) => ROLE_LABELS[r] || r)
    .join(', ');
}

function rolesFromBody(body) {
  if (!body) return [];
  return normalizeRoles(body.roles);
}

function reservedOwnerEmails() {
  return ['admin@11ka.local', 'jgalba@11ka.cz', 'jbrabec@11ka.cz', process.env.ADMIN_EMAIL]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
}

function isReservedOwnerEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  return Boolean(key) && reservedOwnerEmails().includes(key);
}

function reservedStaffEmails() {
  let fromSeed = [];
  try {
    fromSeed = require('../data/seed-users').seedStaffEmails();
  } catch {
    fromSeed = [];
  }
  return [...new Set([...reservedOwnerEmails(), ...fromSeed])];
}

function isReservedStaffEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  return Boolean(key) && reservedStaffEmails().includes(key);
}

module.exports = {
  ROLES,
  STAFF_ROLES,
  EDITORIAL_ROLES,
  FOTO_ROLES,
  ROLE_LABELS,
  ROLE_PRIORITY,
  isValidRole,
  normalizeRoles,
  primaryRole,
  parseRoles,
  serializeRoles,
  userRoles,
  hasRole,
  hasAnyRole,
  isStaffUser,
  isAkreditaceOnly,
  isFotografOnly,
  isEditorialStaff,
  canAccessFoto,
  isRedaktorWorkflow,
  formatRoles,
  rolesFromBody,
  reservedOwnerEmails,
  isReservedOwnerEmail,
  reservedStaffEmails,
  isReservedStaffEmail,
};

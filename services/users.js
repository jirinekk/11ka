const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getDb } = require('../db');
const { uniqueSlug } = require('../lib/slug');
const chanceLigaLogos = require('./chance-liga-logos');
const { loadSeedUsers } = require('../data/seed-users');
const {
  normalizeRoles,
  primaryRole,
  parseRoles,
  serializeRoles,
  hasAnyRole,
  isEditorialStaff,
  isReservedStaffEmail,
  STAFF_ROLES: ALL_STAFF_ROLES,
  EDITORIAL_ROLES,
} = require('../lib/roles');

const AUTHOR_BIO_MAX = 1500;
const PUBLIC_BIO_MAX = 500;

const USER_PUBLIC_COLUMNS_BASE =
  'id, email, role, display_name, avatar_path, author_bio, author_bio_pending, slug, public_bio, favorite_team_code, created_at, updated_at';

let _hasRolesColumn = null;
let _hasAccPrefillColumn = null;

function hasRolesColumn() {
  if (_hasRolesColumn != null) return _hasRolesColumn;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(users)`).all();
    _hasRolesColumn = cols.some((c) => c && c.name === 'roles');
  } catch {
    _hasRolesColumn = false;
  }
  return _hasRolesColumn;
}

function hasAccPrefillColumn() {
  if (_hasAccPrefillColumn != null) return _hasAccPrefillColumn;
  try {
    const cols = getDb().prepare(`PRAGMA table_info(users)`).all();
    _hasAccPrefillColumn = cols.some((c) => c && c.name === 'acc_prefill');
  } catch {
    _hasAccPrefillColumn = false;
  }
  return _hasAccPrefillColumn;
}

function userSelectColumns(includePassword = false) {
  const rolesPart = hasRolesColumn() ? 'roles, ' : '';
  const accPart = hasAccPrefillColumn() ? 'acc_prefill, ' : '';
  const profilePart = `slug, public_bio, favorite_team_code, ${accPart}`;
  if (includePassword) {
    return `id, email, password_hash, role, ${rolesPart}display_name, avatar_path, author_bio, author_bio_pending, ${profilePart}created_at, updated_at`;
  }
  return `id, email, role, ${rolesPart}display_name, avatar_path, author_bio, author_bio_pending, ${profilePart}created_at, updated_at`;
}

const EMPTY_ACC_PREFILL = {
  enabled: false,
  name: '',
  email: '',
  phone: '',
  accreditation_type: 'photo',
};

function parseAccPrefill(raw) {
  let data = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== 'object') {
    return { ...EMPTY_ACC_PREFILL };
  }
  const type = String(data.accreditation_type || data.type || '').trim();
  return {
    enabled: Boolean(data.enabled),
    name: String(data.name || '').trim(),
    email: String(data.email || '').trim().toLowerCase(),
    phone: String(data.phone || '').trim(),
    accreditation_type: type === 'pisi' ? 'pisi' : 'photo',
  };
}

function accPrefillForUser(user) {
  const parsed = parseAccPrefill(user && user.acc_prefill);
  return {
    ...parsed,
    name: parsed.name || String((user && user.display_name) || '').trim(),
    email: parsed.email || String((user && user.email) || '').trim().toLowerCase(),
  };
}

function accPrefillFormValues(user) {
  const saved = accPrefillForUser(user);
  if (!saved.enabled) return {};
  return {
    name: saved.name,
    email: saved.email,
    phone: saved.phone,
    accreditation_type: saved.accreditation_type === 'pisi' ? 'pisi' : 'photo',
  };
}

function normalizeAccPrefillPayload(input, user) {
  const raw = input && typeof input === 'object' ? input : {};
  const enabled = Boolean(
    raw.enabled === true || raw.enabled === 1 || raw.enabled === '1' || raw.enabled === 'on'
  );
  const name = String(raw.name != null ? raw.name : '').trim();
  let email = String(raw.email != null ? raw.email : '')
    .trim()
    .toLowerCase();
  const phone = String(raw.phone != null ? raw.phone : '').trim();
  const type = String(raw.accreditation_type != null ? raw.accreditation_type : raw.type || '').trim();
  if (!email && user && user.email) email = String(user.email).trim().toLowerCase();
  return {
    enabled,
    name: name || String((user && user.display_name) || '').trim(),
    email,
    phone,
    accreditation_type: type === 'pisi' ? 'pisi' : 'photo',
  };
}

function updateAccPrefill(userId, payload) {
  if (!hasAccPrefillColumn()) return getById(userId);
  const user = getById(userId);
  if (!user) return null;
  const next = normalizeAccPrefillPayload(payload, user);
  getDb()
    .prepare(`UPDATE users SET acc_prefill = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(next), userId);
  return getById(userId);
}

function enrichUser(row) {
  if (!row) return null;
  const roles = parseRoles(row.roles, row.role);
  const role = primaryRole(roles) || row.role;
  return {
    ...row,
    role,
    roles,
  };
}

function normalizeAuthorBio(text) {
  if (text == null) return null;
  const cleaned = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > AUTHOR_BIO_MAX ? cleaned.slice(0, AUTHOR_BIO_MAX) : cleaned;
}

function normalizePublicBio(text) {
  if (text == null) return null;
  const cleaned = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > PUBLIC_BIO_MAX ? cleaned.slice(0, PUBLIC_BIO_MAX) : cleaned;
}

function slugExists(slug, excludeId) {
  const row = getDb()
    .prepare(`SELECT id FROM users WHERE slug = ? COLLATE NOCASE`)
    .get(String(slug || '').trim());
  if (!row) return false;
  if (excludeId != null && row.id === excludeId) return false;
  return true;
}

function makeUserSlug(base, excludeId) {
  return uniqueSlug(base || 'uzivatel', (candidate) => slugExists(candidate, excludeId));
}

function profilePath(user) {
  if (!user) return null;
  if (user.slug) return `/uzivatel/${encodeURIComponent(user.slug)}`;
  if (user.id) return `/uzivatel/${encodeURIComponent(String(user.id))}`;
  return null;
}

function getPublicAuthorBio(user) {
  if (!user) return null;
  return normalizeAuthorBio(user.author_bio);
}

function hasPendingAuthorBio(user) {
  if (!user || !user.author_bio_pending) return false;
  const pending = normalizeAuthorBio(user.author_bio_pending);
  const live = normalizeAuthorBio(user.author_bio);
  return pending && pending !== live;
}

function getById(id) {
  return enrichUser(
    getDb()
      .prepare(`SELECT ${userSelectColumns(false)} FROM users WHERE id = ?`)
      .get(id)
  );
}

function getByEmail(email) {
  const key = String(email || '').trim();
  if (!key) return null;
  return enrichUser(
    getDb()
      .prepare(
        `SELECT ${userSelectColumns(true)} FROM users WHERE email = ? COLLATE NOCASE`
      )
      .get(key)
  );
}

const LOGIN_ALIAS_GROUPS = [['admin@11ka.local', 'jgalba@11ka.cz', 'jgalba', 'jiri-galba']];

function getByLogin(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();

  const direct = getByEmail(key);
  if (direct) return direct;

  for (const group of LOGIN_ALIAS_GROUPS) {
    if (!group.includes(key)) continue;
    for (const candidate of group) {
      const user = getByEmail(candidate) || getBySlug(candidate);
      if (user) return getByEmail(user.email) || user;
    }
  }

  const bySlug = getBySlug(key);
  if (bySlug) return getByEmail(bySlug.email) || bySlug;

  if (!key.includes('@')) {
    const matches = listAll().filter((user) => {
      const local = String(user.email || '').split('@')[0].toLowerCase();
      return local === key;
    });
    if (matches.length === 1) return getByEmail(matches[0].email) || matches[0];
  }

  return null;
}

function getBySlug(slug) {
  const key = String(slug || '').trim();
  if (!key) return null;
  return enrichUser(
    getDb()
      .prepare(`SELECT ${userSelectColumns(false)} FROM users WHERE slug = ? COLLATE NOCASE`)
      .get(key)
  );
}

function listAll() {
  return getDb()
    .prepare(
      `SELECT id, email, role, ${hasRolesColumn() ? 'roles, ' : ''}display_name, avatar_path, author_bio, author_bio_pending, slug, public_bio, favorite_team_code, created_at FROM users ORDER BY email COLLATE NOCASE`
    )
    .all()
    .map(enrichUser);
}

function listRecentPublic(limit = 24) {
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(48, Number(limit))) : 24;
  return getDb()
    .prepare(
      `SELECT id, display_name, slug, avatar_path, public_bio, favorite_team_code, created_at
       FROM users
       WHERE slug IS NOT NULL AND TRIM(slug) != '' AND IFNULL(TRIM(display_name), '') != ''
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(lim)
    .map((row) => ({
      ...row,
      href: profilePath(row),
      favoriteTeam: chanceLigaLogos.getClub(row.favorite_team_code),
    }));
}

function listWithPendingBios() {
  return listAll().filter((u) => hasPendingAuthorBio(u));
}

const STAFF_ROLES = EDITORIAL_ROLES;

function listAuthorBiosForAdmin() {
  return listAll()
    .filter((u) => hasAnyRole(u, ...STAFF_ROLES))
    .map((u) => {
      const live = getPublicAuthorBio(u);
      const pending = hasPendingAuthorBio(u)
        ? normalizeAuthorBio(u.author_bio_pending)
        : null;
      let status = 'empty';
      if (pending) status = 'pending';
      else if (live) status = 'approved';
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        roles: u.roles,
        display_name: u.display_name,
        bioLive: live,
        bioPending: pending,
        status,
      };
    })
    .sort((a, b) => {
      const order = { pending: 0, approved: 1, empty: 2 };
      const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      if (d !== 0) return d;
      const na = (a.display_name || a.email || '').toLowerCase();
      const nb = (b.display_name || b.email || '').toLowerCase();
      return na.localeCompare(nb, 'cs');
    });
}

function clearAuthorBio(userId) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE users SET author_bio = NULL, author_bio_pending = NULL, updated_at = ? WHERE id = ?`
    )
    .run(now, userId);
}

function listPublicStaff() {
  return getDb()
    .prepare(
      `SELECT id, email, role, ${hasRolesColumn() ? 'roles, ' : ''}display_name, avatar_path, author_bio
       FROM users
       WHERE role IN ('majitel', 'vedeni', 'sefredaktor', 'redaktor')
         AND role != 'fotograf'
       ORDER BY
         CASE role
           WHEN 'sefredaktor' THEN 1
           WHEN 'redaktor' THEN 2
           WHEN 'vedeni' THEN 3
           ELSE 4
         END,
         COALESCE(display_name, '') COLLATE NOCASE,
         id ASC`
    )
    .all()
    .map(enrichUser)
    .filter((u) => isEditorialStaff(u));
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function resolveRolesInput({ roles, role }) {
  if (roles != null) {
    const normalized = normalizeRoles(roles);
    if (normalized.length) return normalized;
  }
  if (role) {
    const normalized = normalizeRoles([role]);
    if (normalized.length) return normalized;
  }
  return [];
}

function createUser({ email, password, role, roles, display_name }) {
  const normalized = resolveRolesInput({ roles, role });
  if (!normalized.length) {
    throw new Error('Neplatná role');
  }
  const primary = primaryRole(normalized);
  const hash = bcrypt.hashSync(password, 12);
  const now = new Date().toISOString();
  const withRoles = hasRolesColumn();
  const name = display_name ? String(display_name).trim() : null;
  const emailNorm = email.trim().toLowerCase();
  const slug = makeUserSlug(name || emailNorm.split('@')[0] || 'uzivatel');
  const info = getDb()
    .prepare(
      withRoles
        ? `INSERT INTO users (email, password_hash, role, roles, display_name, slug, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        : `INSERT INTO users (email, password_hash, role, display_name, slug, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ...(withRoles
        ? [emailNorm, hash, primary, serializeRoles(normalized), name, slug, now, now]
        : [emailNorm, hash, primary, name, slug, now, now])
    );
  return info.lastInsertRowid;
}

function registerReader({ email, password, display_name }) {
  const name = String(display_name || '').trim();
  if (name.length < 2 || name.length > 40) {
    throw new Error('display_name');
  }
  if (String(password || '').length < 8) {
    throw new Error('password');
  }
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    throw new Error('email');
  }
  if (isReservedStaffEmail(emailNorm) || getByEmail(emailNorm)) {
    throw new Error('email_taken');
  }
  return createUser({
    email: emailNorm,
    password,
    role: 'ctenar',
    roles: ['ctenar'],
    display_name: name,
  });
}

function updatePassword(userId, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 12);
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .run(hash, now, userId);
}

function updateProfile(userId, { display_name, avatar_path, public_bio, favorite_team_code }) {
  const now = new Date().toISOString();
  const sets = ['updated_at = ?'];
  const vals = [now];
  if (display_name !== undefined) {
    sets.unshift('display_name = ?');
    vals.unshift(display_name || null);
  }
  if (avatar_path != null) {
    sets.splice(-1, 0, 'avatar_path = ?');
    vals.splice(-1, 0, avatar_path);
  }
  if (public_bio !== undefined) {
    sets.splice(-1, 0, 'public_bio = ?');
    vals.splice(-1, 0, normalizePublicBio(public_bio));
  }
  if (favorite_team_code !== undefined) {
    const favorite = chanceLigaLogos.isClubCode(favorite_team_code)
      ? String(favorite_team_code).trim().toLowerCase()
      : null;
    sets.splice(-1, 0, 'favorite_team_code = ?');
    vals.splice(-1, 0, favorite);
  }
  vals.push(userId);
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function listStarredTeamCodes(userId) {
  return getDb()
    .prepare(`SELECT team_code FROM user_team_stars WHERE user_id = ? ORDER BY team_code`)
    .all(userId)
    .map((row) => row.team_code);
}

function setStarredTeams(userId, codes) {
  const unique = [];
  const seen = new Set();
  for (const raw of codes || []) {
    const code = String(raw || '').trim().toLowerCase();
    if (!chanceLigaLogos.isClubCode(code) || seen.has(code)) continue;
    seen.add(code);
    unique.push(code);
  }
  const now = new Date().toISOString();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM user_team_stars WHERE user_id = ?`).run(userId);
    const insert = db.prepare(
      `INSERT INTO user_team_stars (user_id, team_code, created_at) VALUES (?, ?, ?)`
    );
    for (const code of unique) insert.run(userId, code, now);
  });
  tx();
  return unique;
}

function hydratePublicProfile(user) {
  if (!user) return null;
  const starredCodes = listStarredTeamCodes(user.id);
  return {
    id: user.id,
    slug: user.slug,
    href: profilePath(user),
    display_name: user.display_name,
    avatar_path: user.avatar_path,
    public_bio: normalizePublicBio(user.public_bio),
    created_at: user.created_at,
    isStaff: hasAnyRole(user, ...ALL_STAFF_ROLES),
    favoriteTeam: chanceLigaLogos.getClub(user.favorite_team_code),
    starredTeams: chanceLigaLogos.clubsFromCodes(starredCodes),
    starredCodes,
    favorite_team_code: user.favorite_team_code || '',
  };
}

function updateUserAdmin(id, { email, role, roles, display_name, password, author_bio }) {
  const now = new Date().toISOString();
  const bio = author_bio !== undefined ? normalizeAuthorBio(author_bio) : undefined;
  const normalized = resolveRolesInput({ roles, role });
  if (!normalized.length) {
    throw new Error('Neplatná role');
  }
  const primary = primaryRole(normalized);
  const rolesJson = serializeRoles(normalized);
  const withRoles = hasRolesColumn();
  const emailNorm = email.trim().toLowerCase();
  const name = display_name || null;

  if (password && String(password).length > 0) {
    const hash = bcrypt.hashSync(password, 12);
    if (bio !== undefined) {
      getDb()
        .prepare(
          withRoles
            ? `UPDATE users SET email = ?, role = ?, roles = ?, display_name = ?, password_hash = ?, author_bio = ?, author_bio_pending = NULL, updated_at = ? WHERE id = ?`
            : `UPDATE users SET email = ?, role = ?, display_name = ?, password_hash = ?, author_bio = ?, author_bio_pending = NULL, updated_at = ? WHERE id = ?`
        )
        .run(
          ...(withRoles
            ? [emailNorm, primary, rolesJson, name, hash, bio, now, id]
            : [emailNorm, primary, name, hash, bio, now, id])
        );
    } else {
      getDb()
        .prepare(
          withRoles
            ? `UPDATE users SET email = ?, role = ?, roles = ?, display_name = ?, password_hash = ?, updated_at = ? WHERE id = ?`
            : `UPDATE users SET email = ?, role = ?, display_name = ?, password_hash = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          ...(withRoles
            ? [emailNorm, primary, rolesJson, name, hash, now, id]
            : [emailNorm, primary, name, hash, now, id])
        );
    }
  } else if (bio !== undefined) {
    getDb()
      .prepare(
        withRoles
          ? `UPDATE users SET email = ?, role = ?, roles = ?, display_name = ?, author_bio = ?, author_bio_pending = NULL, updated_at = ? WHERE id = ?`
          : `UPDATE users SET email = ?, role = ?, display_name = ?, author_bio = ?, author_bio_pending = NULL, updated_at = ? WHERE id = ?`
      )
      .run(
        ...(withRoles
          ? [emailNorm, primary, rolesJson, name, bio, now, id]
          : [emailNorm, primary, name, bio, now, id])
      );
  } else {
    getDb()
      .prepare(
        withRoles
          ? `UPDATE users SET email = ?, role = ?, roles = ?, display_name = ?, updated_at = ? WHERE id = ?`
          : `UPDATE users SET email = ?, role = ?, display_name = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        ...(withRoles
          ? [emailNorm, primary, rolesJson, name, now, id]
          : [emailNorm, primary, name, now, id])
      );
  }
}

function submitAuthorBio(userId, text, { autoApprove = false } = {}) {
  const bio = normalizeAuthorBio(text);
  const now = new Date().toISOString();
  if (!bio) {
    getDb()
      .prepare(`UPDATE users SET author_bio_pending = NULL, updated_at = ? WHERE id = ?`)
      .run(now, userId);
    return { status: 'cleared' };
  }
  if (autoApprove) {
    getDb()
      .prepare(
        `UPDATE users SET author_bio = ?, author_bio_pending = NULL, updated_at = ? WHERE id = ?`
      )
      .run(bio, now, userId);
    return { status: 'approved' };
  }
  const current = getById(userId);
  if (normalizeAuthorBio(current && current.author_bio) === bio) {
    getDb()
      .prepare(`UPDATE users SET author_bio_pending = NULL, updated_at = ? WHERE id = ?`)
      .run(now, userId);
    return { status: 'unchanged' };
  }
  getDb()
    .prepare(`UPDATE users SET author_bio_pending = ?, updated_at = ? WHERE id = ?`)
    .run(bio, now, userId);
  return { status: 'pending' };
}

function approveAuthorBio(userId, text) {
  const bio = normalizeAuthorBio(text);
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE users SET author_bio = ?, author_bio_pending = NULL, updated_at = ? WHERE id = ?`)
    .run(bio, now, userId);
}

function rejectAuthorBio(userId) {
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE users SET author_bio_pending = NULL, updated_at = ? WHERE id = ?`)
    .run(now, userId);
}

function countArticlesByUser(id) {
  const r = getDb().prepare(`SELECT COUNT(*) AS c FROM articles WHERE author_id = ?`).get(id);
  return r.c;
}

function deleteUser(id) {
  getDb().prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

function randomUnusableHash() {
  return bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
}

function resolveSeedPasswordHash(item) {
  if (item && item.needs_password) return randomUnusableHash();
  if (item && isBcryptHash(item.password_hash)) return item.password_hash;
  return randomUnusableHash();
}

function seedRolesFromItem(item) {
  const normalized = resolveRolesInput({ roles: item && item.roles, role: item && item.role });
  return normalized.length ? normalized : ['redaktor'];
}

function applySeedPublicProfile(user, item, { keepMajitel = false } = {}) {
  const now = new Date().toISOString();
  const name = String((item && item.display_name) || user.display_name || '').trim() || null;
  const requestedSlug = String((item && item.slug) || '').trim();
  const slug = requestedSlug && !slugExists(requestedSlug, user.id)
    ? requestedSlug
    : makeUserSlug(requestedSlug || name || user.email, user.id);
  let roles = seedRolesFromItem(item);
  if (keepMajitel) {
    roles = normalizeRoles(['majitel', 'vedeni', ...roles]);
  }
  const primary = primaryRole(roles) || user.role;
  const bio = item && item.author_bio !== undefined ? normalizeAuthorBio(item.author_bio) : user.author_bio;
  const publicBio =
    item && item.public_bio !== undefined ? normalizePublicBio(item.public_bio) : user.public_bio;
  const withRoles = hasRolesColumn();
  if (withRoles) {
    getDb()
      .prepare(
        `UPDATE users SET display_name = ?, slug = ?, role = ?, roles = ?, author_bio = ?, public_bio = ?, updated_at = ? WHERE id = ?`
      )
      .run(name, slug, primary, serializeRoles(roles), bio, publicBio, now, user.id);
  } else {
    getDb()
      .prepare(
        `UPDATE users SET display_name = ?, slug = ?, role = ?, author_bio = ?, public_bio = ?, updated_at = ? WHERE id = ?`
      )
      .run(name, slug, primary, bio, publicBio, now, user.id);
  }
}

function storedSeedEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  if (key === 'admin@11ka.local') return 'jgalba@11ka.cz';
  return key;
}

function insertSeedStaffUser(item) {
  const email = storedSeedEmail(item.email);
  const name = String(item.display_name || '').trim() || null;
  const roles = seedRolesFromItem(item);
  const primary = primaryRole(roles) || 'redaktor';
  const hash = resolveSeedPasswordHash(item);
  const now = new Date().toISOString();
  const createdAt = item.created_at || now;
  const requestedSlug = String(item.slug || '').trim();
  const slug = requestedSlug && !slugExists(requestedSlug)
    ? requestedSlug
    : makeUserSlug(requestedSlug || name || email.split('@')[0] || 'uzivatel');
  const bio = item.author_bio != null ? normalizeAuthorBio(item.author_bio) : null;
  const publicBio = item.public_bio != null ? normalizePublicBio(item.public_bio) : null;
  const withRoles = hasRolesColumn();
  if (withRoles) {
    getDb()
      .prepare(
        `INSERT INTO users (
           email, password_hash, role, roles, display_name, slug, author_bio, public_bio, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(email, hash, primary, serializeRoles(roles), name, slug, bio, publicBio, createdAt, now);
  } else {
    getDb()
      .prepare(
        `INSERT INTO users (
           email, password_hash, role, display_name, slug, author_bio, public_bio, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(email, hash, primary, name, slug, bio, publicBio, createdAt, now);
  }
}

function seedStaffUsers() {
  const items = loadSeedUsers();
  if (!items.length) return;

  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const galbaAliases = new Set(['admin@11ka.local', 'jgalba@11ka.cz']);
  let inserted = 0;

  for (const item of items) {
    const email = String(item.email || '').trim().toLowerCase();
    if (!email) continue;

    const aliasHit = galbaAliases.has(email)
      ? [...galbaAliases].map((candidate) => getByEmail(candidate)).find(Boolean)
      : null;
    const existing = aliasHit || getByEmail(email);
    if (existing) {
      const existingName = String(existing.display_name || '').trim();
      if (!existingName || existingName === 'Administrátor') {
        applySeedPublicProfile(existing, item, {
          keepMajitel: existing.role === 'majitel' || adminEmail === email || galbaAliases.has(email),
        });
      }
      continue;
    }

    try {
      insertSeedStaffUser(item);
      inserted += 1;
    } catch (e) {
      console.error('[11ka] staff seed skip:', email, e && e.message);
    }
  }

  if (inserted > 0) {
    console.log(`[11ka] Seeded ${inserted} staff account(s) from data/seed-users.json`);
  }
}

module.exports = {
  AUTHOR_BIO_MAX,
  PUBLIC_BIO_MAX,
  getById,
  getByEmail,
  getByLogin,
  getBySlug,
  listAll,
  listRecentPublic,
  listWithPendingBios,
  listAuthorBiosForAdmin,
  listPublicStaff,
  verifyPassword,
  createUser,
  registerReader,
  updatePassword,
  updateProfile,
  updateUserAdmin,
  submitAuthorBio,
  approveAuthorBio,
  rejectAuthorBio,
  clearAuthorBio,
  normalizeAuthorBio,
  normalizePublicBio,
  getPublicAuthorBio,
  hasPendingAuthorBio,
  listStarredTeamCodes,
  setStarredTeams,
  hydratePublicProfile,
  profilePath,
  countArticlesByUser,
  deleteUser,
  seedStaffUsers,
  parseAccPrefill,
  accPrefillForUser,
  accPrefillFormValues,
  updateAccPrefill,
  resetRolesColumnCache() {
    _hasRolesColumn = null;
    _hasAccPrefillColumn = null;
  },
};

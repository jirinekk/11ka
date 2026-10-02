const bcrypt = require('bcrypt');
const { getDb } = require('../db');
const {
  normalizeRoles,
  primaryRole,
  parseRoles,
  serializeRoles,
  hasAnyRole,
} = require('../lib/roles');

const AUTHOR_BIO_MAX = 1500;

const USER_PUBLIC_COLUMNS_BASE =
  'id, email, role, display_name, avatar_path, author_bio, author_bio_pending, created_at, updated_at';

let _hasRolesColumn = null;

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

function userSelectColumns(includePassword = false) {
  const rolesPart = hasRolesColumn() ? 'roles, ' : '';
  if (includePassword) {
    return `id, email, password_hash, role, ${rolesPart}display_name, avatar_path, author_bio, author_bio_pending, created_at, updated_at`;
  }
  return `id, email, role, ${rolesPart}display_name, avatar_path, author_bio, author_bio_pending, created_at, updated_at`;
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
  return enrichUser(
    getDb()
      .prepare(
        `SELECT ${userSelectColumns(true)} FROM users WHERE email = ? COLLATE NOCASE`
      )
      .get(email.trim())
  );
}

function listAll() {
  return getDb()
    .prepare(
      `SELECT id, email, role, ${hasRolesColumn() ? 'roles, ' : ''}display_name, avatar_path, author_bio, author_bio_pending, created_at FROM users ORDER BY email COLLATE NOCASE`
    )
    .all()
    .map(enrichUser);
}

function listWithPendingBios() {
  return listAll().filter((u) => hasPendingAuthorBio(u));
}

const STAFF_ROLES = ['majitel', 'vedeni', 'sefredaktor', 'redaktor'];

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
    .filter((u) => hasAnyRole(u, ...STAFF_ROLES));
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
  const info = getDb()
    .prepare(
      withRoles
        ? `INSERT INTO users (email, password_hash, role, roles, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        : `INSERT INTO users (email, password_hash, role, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      ...(withRoles
        ? [
            email.trim().toLowerCase(),
            hash,
            primary,
            serializeRoles(normalized),
            display_name || null,
            now,
            now,
          ]
        : [
            email.trim().toLowerCase(),
            hash,
            primary,
            display_name || null,
            now,
            now,
          ])
    );
  return info.lastInsertRowid;
}

function updatePassword(userId, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 12);
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .run(hash, now, userId);
}

function updateProfile(userId, { display_name, avatar_path }) {
  const now = new Date().toISOString();
  if (avatar_path != null) {
    getDb()
      .prepare(
        `UPDATE users SET display_name = ?, avatar_path = ?, updated_at = ? WHERE id = ?`
      )
      .run(display_name || null, avatar_path, now, userId);
  } else {
    getDb()
      .prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`)
      .run(display_name || null, now, userId);
  }
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

module.exports = {
  AUTHOR_BIO_MAX,
  getById,
  getByEmail,
  listAll,
  listWithPendingBios,
  listAuthorBiosForAdmin,
  listPublicStaff,
  verifyPassword,
  createUser,
  updatePassword,
  updateProfile,
  updateUserAdmin,
  submitAuthorBio,
  approveAuthorBio,
  rejectAuthorBio,
  clearAuthorBio,
  normalizeAuthorBio,
  getPublicAuthorBio,
  hasPendingAuthorBio,
  countArticlesByUser,
  deleteUser,
  resetRolesColumnCache() {
    _hasRolesColumn = null;
  },
};

const {
  ROLES,
  STAFF_ROLES,
  ROLE_LABELS,
  hasRole,
  hasAnyRole,
  isStaffUser,
  isAkreditaceOnly,
  isFotografOnly,
  isRedaktorWorkflow,
  userRoles,
  primaryRole,
  parseRoles,
} = require('../lib/roles');
const { canAccessAiDrafts } = require('../config/ai-drafts');
const authCookie = require('../lib/auth-cookie');

function sessionUserFallback(req) {
  if (!req.session || !req.session.userId) return null;
  const role = req.session.role || null;
  const roles =
    Array.isArray(req.session.roles) && req.session.roles.length
      ? req.session.roles
      : role
        ? [role]
        : [];
  if (!role && !roles.length) return null;
  return {
    id: req.session.userId,
    email: req.session.email || null,
    role: role || primaryRole(roles),
    roles,
    display_name: req.session.displayName || null,
    avatar_path: null,
  };
}

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    if (req.method === 'GET') {
      return res.redirect('/prihlaseni?next=' + encodeURIComponent(req.originalUrl));
    }
    return res.status(401).send('Vyžadováno přihlášení');
  }
  next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.session.userId) {
      return res.status(403).send('Přístup odepřen');
    }
    const user = req.user || sessionUserFallback(req);
    if (!user) {
      return res.status(403).send('Přístup odepřen');
    }
    // Keep handlers that read req.user working even if attachUser failed.
    if (!req.user) req.user = user;

    if (hasAnyRole(user, ...allowed)) {
      return next();
    }
    if (req.session.role && allowed.includes(req.session.role)) {
      return next();
    }
    return res.status(403).send('Nemáte oprávnění');
  };
}

function requireAiDraftAccess(req, res, next) {
  if (!req.session.userId) {
    return res.status(403).send('Přístup odepřen');
  }
  const user = req.user || sessionUserFallback(req);
  if (!user) {
    return res.status(403).send('Přístup odepřen');
  }
  if (!req.user) req.user = user;
  if (!canAccessAiDrafts(user)) {
    return res.status(403).send('Nemáte oprávnění');
  }
  next();
}

function canEditArticle(sessionUser, article) {
  if (!sessionUser || !article) return false;
  if (hasAnyRole(sessionUser, 'vedeni', 'sefredaktor')) return true;
  if (isRedaktorWorkflow(sessionUser)) return article.author_id === sessionUser.id && article.status === 'draft';
  return false;
}

function canDeleteArticle(sessionUser, article) {
  if (!sessionUser || !article) return false;
  if (hasAnyRole(sessionUser, 'vedeni', 'sefredaktor')) return true;
  if (isRedaktorWorkflow(sessionUser)) return article.author_id === sessionUser.id && article.status === 'draft';
  return false;
}

function canPublish(sessionUser) {
  return hasAnyRole(sessionUser, 'vedeni', 'sefredaktor');
}

function canManageUsers(sessionUser) {
  return hasRole(sessionUser, 'vedeni');
}

function canManageAds(sessionUser) {
  return hasRole(sessionUser, 'vedeni');
}

function canViewStats(sessionUser) {
  return hasRole(sessionUser, 'vedeni');
}

function attachUser(usersService) {
  return (req, res, next) => {
    req.user = null;
    if (!req.session.userId) return next();

    let u = null;
    try {
      u = usersService.getById(req.session.userId);
      if (!u && req.session.email) {
        u = usersService.getByEmail(req.session.email);
        if (u) req.session.userId = u.id;
      }
    } catch (err) {
      console.error('[11ka] attachUser getById failed:', err && err.message);
      req.user = sessionUserFallback(req);
      return next();
    }

    if (!u) {
      authCookie.clear(res);
      req.session.destroy(() => {});
      return next();
    }

    const roles = userRoles(u);
    const role = primaryRole(roles) || u.role;
    req.session.role = role;
    req.session.roles = roles;
    req.session.email = u.email;
    req.user = {
      id: u.id,
      email: u.email,
      role,
      roles,
      display_name: u.display_name,
      avatar_path: u.avatar_path,
      slug: u.slug || null,
    };
    authCookie.set(res, req.user);
    next();
  };
}

module.exports = {
  ROLES,
  STAFF_ROLES,
  ROLE_LABELS,
  requireLogin,
  requireRole,
  requireAiDraftAccess,
  canEditArticle,
  canDeleteArticle,
  canPublish,
  canManageUsers,
  canManageAds,
  canViewStats,
  attachUser,
  hasRole,
  hasAnyRole,
  isStaffUser,
  isAkreditaceOnly,
  isFotografOnly,
  isRedaktorWorkflow,
  userRoles,
  parseRoles,
  canAccessAiDrafts,
};

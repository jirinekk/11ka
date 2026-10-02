const { hasRole } = require('../lib/roles');

const AI_DRAFT_ALLOWED_EMAILS = ['admin@11ka.local', 'jbrabec@11ka.cz', 'jgalba@11ka.cz'];

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function canAccessAiDrafts(user) {
  if (!user) return false;
  if (hasRole(user, 'majitel')) return true;
  return AI_DRAFT_ALLOWED_EMAILS.includes(normalizeEmail(user.email));
}

module.exports = {
  AI_DRAFT_ALLOWED_EMAILS,
  canAccessAiDrafts,
};

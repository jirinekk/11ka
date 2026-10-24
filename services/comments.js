const { getDb } = require('../db');
const usersService = require('./users');

const COMMENT_MAX = 2000;

function sanitizeCommentBody(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, COMMENT_MAX);
}

function listForArticle(articleId, limit = 80) {
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 80;
  return getDb()
    .prepare(
      `SELECT
         c.id,
         c.article_id,
         c.user_id,
         c.author_name,
         c.body,
         c.created_at,
         u.slug AS author_slug,
         u.display_name AS author_display,
         u.avatar_path AS author_avatar
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.article_id = ?
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT ?`
    )
    .all(articleId, lim)
    .map((row) => {
      const name = row.author_display || row.author_name;
      const href = row.author_slug
        ? `/uzivatel/${encodeURIComponent(row.author_slug)}`
        : row.user_id
          ? usersService.profilePath({ id: row.user_id, slug: row.author_slug })
          : null;
      return {
        ...row,
        author_name: name,
        author_href: href,
        author_avatar: row.author_avatar || null,
      };
    });
}

function createComment({ article_id, user, body }) {
  if (!article_id || !user || !user.id) {
    throw new Error('invalid_comment');
  }
  const text = sanitizeCommentBody(body);
  if (!text) {
    throw new Error('invalid_comment');
  }
  const name = String(user.display_name || user.email || 'Čtenář').trim().slice(0, 80);
  if (!name) {
    throw new Error('invalid_comment');
  }
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO comments (article_id, user_id, author_name, body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(article_id, user.id, name, text, now);
  return info.lastInsertRowid;
}

module.exports = {
  COMMENT_MAX,
  listForArticle,
  createComment,
  sanitizeCommentBody,
};

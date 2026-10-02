const { getDb } = require('../db');

function listForArticle(articleId, limit = 50) {
  return getDb()
    .prepare(
      `SELECT id, article_id, author_name, body, created_at
       FROM comments
       WHERE article_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(articleId, limit);
}

function createComment({ article_id, author_name, body }) {
  const name = String(author_name || '').trim();
  const text = String(body || '').trim();
  if (!article_id || !name || !text) {
    throw new Error('invalid_comment');
  }
  if (name.length > 80 || text.length > 2000) {
    throw new Error('comment_too_long');
  }
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO comments (article_id, author_name, body, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(article_id, name, text, now);
  return info.lastInsertRowid;
}

module.exports = {
  listForArticle,
  createComment,
};


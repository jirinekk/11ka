/**
 * Nahradí „firtcore“ (libovolná velikost písmen) za „11ka“ v textových sloupcích DB.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb } = require('../db');

const RE = /firtcore/gi;

function replaceFields(row, keys) {
  const out = { ...row };
  let changed = false;
  for (const k of keys) {
    const v = out[k];
    if (typeof v === 'string') {
      const nv = v.replace(RE, '11ka');
      if (nv !== v) {
        out[k] = nv;
        changed = true;
      }
    }
  }
  return changed ? out : null;
}

const db = getDb();
let total = 0;

const articleRows = db.prepare('SELECT id, title, excerpt, body_html FROM articles').all();
const updArticle = db.prepare(
  'UPDATE articles SET title = ?, excerpt = ?, body_html = ? WHERE id = ?'
);
for (const row of articleRows) {
  const n = replaceFields(row, ['title', 'excerpt', 'body_html']);
  if (n) {
    updArticle.run(n.title, n.excerpt, n.body_html, n.id);
    total++;
  }
}

try {
  const now = new Date().toISOString();
  const adRows = db.prepare('SELECT id, label, content_html, link_url FROM ads').all();
  const updAd = db.prepare(
    'UPDATE ads SET label = ?, content_html = ?, link_url = ?, updated_at = ? WHERE id = ?'
  );
  for (const row of adRows) {
    const n = replaceFields(row, ['label', 'content_html', 'link_url']);
    if (n) {
      updAd.run(n.label, n.content_html, n.link_url, now, n.id);
      total++;
    }
  }
} catch (_) {
  // ads table missing
}

const userRows = db.prepare('SELECT id, email, display_name FROM users').all();
const updUser = db.prepare(
  'UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE id = ?'
);
const nowU = new Date().toISOString();
for (const row of userRows) {
  const n = replaceFields(row, ['email', 'display_name']);
  if (n) {
    try {
      updUser.run(n.email, n.display_name, nowU, n.id);
      total++;
    } catch (e) {
      console.warn('Přeskočen uživatel', row.id, e.message);
    }
  }
}

console.log(total ? `Upraveno záznamů: ${total}` : 'V DB žádný výskyt „firtcore“.');

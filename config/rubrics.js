function service() {
  return require('../services/rubrics');
}

function listRubrics() {
  try {
    return service().listRubrics();
  } catch (e) {
    console.error('[11ka] listRubrics:', e && e.message);
    return [];
  }
}

function getRubric(slug) {
  try {
    return service().getBySlug(slug);
  } catch (e) {
    console.error('[11ka] getRubric:', e && e.message);
    return null;
  }
}

function isRubricSlug(slug) {
  return !!getRubric(slug);
}

module.exports = {
  listRubrics,
  getRubric,
  isRubricSlug,
};

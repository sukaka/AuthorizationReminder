const toDeleteId = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
};

const normalizeCategoryDeleteIds = (ids) => {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.map((item) => toDeleteId(item)).filter((item) => item > 0)));
};

const getCategoryDeleteGuard = ({ category = null, linkedCount = 0, childCount = 0 } = {}) => {
  if (!category) {
    return { ok: false, status: 404, error: '分类不存在' };
  }
  if (Number(linkedCount || 0) > 0) {
    return { ok: false, status: 409, error: '该分类下有FAQ，无法删除' };
  }
  if (Number(childCount || 0) > 0) {
    return { ok: false, status: 409, error: '该分类下有子分类，无法删除' };
  }
  return { ok: true, category };
};

const summarizeCategoryBatchDeleteResults = (results = []) => {
  const rows = Array.isArray(results) ? results : [];
  const deletedIds = rows.filter((item) => item?.ok).map((item) => Number(item.id));
  const failures = rows
    .filter((item) => !item?.ok)
    .map((item) => ({
      id: Number(item?.id || 0),
      error: String(item?.error || '删除失败').trim() || '删除失败',
    }));

  return {
    ok: true,
    total: rows.length,
    success_count: deletedIds.length,
    failure_count: failures.length,
    deleted_ids: deletedIds,
    failures,
  };
};

const collectCategoryForceDeletePlan = (rows = [], rootId) => {
  const targetId = toDeleteId(rootId);
  const items = Array.isArray(rows) ? rows : [];
  if (targetId <= 0) {
    return {
      category_ids: [],
      delete_order: [],
    };
  }

  const byParentId = new Map();
  const allIds = new Set();
  for (const item of items) {
    const id = toDeleteId(item?.id);
    if (id <= 0) continue;
    allIds.add(id);
    const parentId = toDeleteId(item?.parent_id);
    if (!byParentId.has(parentId)) byParentId.set(parentId, []);
    byParentId.get(parentId).push(id);
  }

  if (!allIds.has(targetId)) {
    return {
      category_ids: [],
      delete_order: [],
    };
  }

  const categoryIds = [];
  const deleteOrder = [];
  const visited = new Set();
  const walk = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    categoryIds.push(id);
    const children = byParentId.get(id) || [];
    for (const childId of children) {
      walk(childId);
    }
    deleteOrder.push(id);
  };

  walk(targetId);

  return {
    category_ids: categoryIds,
    delete_order: deleteOrder,
  };
};

const summarizeCategoryForceDeleteResults = ({ deletedCategoryIds = [], recycledArticleIds = [] } = {}) => {
  const categoryIds = normalizeCategoryDeleteIds(deletedCategoryIds);
  const articleIds = normalizeCategoryDeleteIds(recycledArticleIds);
  return {
    ok: true,
    deleted_category_count: categoryIds.length,
    deleted_category_ids: categoryIds,
    recycled_article_count: articleIds.length,
    recycled_article_ids: articleIds,
  };
};

module.exports = {
  collectCategoryForceDeletePlan,
  getCategoryDeleteGuard,
  normalizeCategoryDeleteIds,
  summarizeCategoryBatchDeleteResults,
  summarizeCategoryForceDeleteResults,
};

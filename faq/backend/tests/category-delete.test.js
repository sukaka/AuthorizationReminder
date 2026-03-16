const {
  collectCategoryForceDeletePlan,
  getCategoryDeleteGuard,
  normalizeCategoryDeleteIds,
  orderCategoryBatchDeleteIds,
  summarizeCategoryBatchDeleteResults,
  summarizeCategoryForceDeleteResults,
} = require('../src/category-delete');

describe('faq category delete helpers', () => {
  it('blocks delete when the category has linked faq articles', () => {
    expect(getCategoryDeleteGuard({
      category: { id: 11, name: '知识库' },
      linkedCount: 2,
      childCount: 0,
    })).toEqual({
      ok: false,
      status: 409,
      error: '该分类下有FAQ，无法删除',
    });
  });

  it('blocks delete when the category has child categories', () => {
    expect(getCategoryDeleteGuard({
      category: { id: 12, name: '父分类' },
      linkedCount: 0,
      childCount: 1,
    })).toEqual({
      ok: false,
      status: 409,
      error: '该分类下有子分类，无法删除',
    });
  });

  it('allows delete when the category has no blockers', () => {
    expect(getCategoryDeleteGuard({
      category: { id: 13, name: '空分类' },
      linkedCount: 0,
      childCount: 0,
    })).toEqual({
      ok: true,
      category: { id: 13, name: '空分类' },
    });
  });

  it('normalizes batch delete ids by trimming invalid values and de-duplicating', () => {
    expect(normalizeCategoryDeleteIds([3, '3', ' 8 ', 0, -1, 'bad', 12, 12])).toEqual([3, 8, 12]);
  });

  it('summarizes partial batch delete results', () => {
    expect(summarizeCategoryBatchDeleteResults([
      { id: 21, ok: true },
      { id: 22, ok: false, error: '该分类下有FAQ，无法删除' },
      { id: 23, ok: false, error: '该分类下有子分类，无法删除' },
    ])).toEqual({
      ok: true,
      total: 3,
      success_count: 1,
      failure_count: 2,
      deleted_ids: [21],
      failures: [
        { id: 22, error: '该分类下有FAQ，无法删除' },
        { id: 23, error: '该分类下有子分类，无法删除' },
      ],
    });
  });

  it('orders selected categories so descendants delete before selected parents', () => {
    expect(orderCategoryBatchDeleteIds([
      { id: 10, parent_id: null },
      { id: 11, parent_id: 10 },
      { id: 12, parent_id: 11 },
      { id: 13, parent_id: null },
    ], [10, 13, 11, 12])).toEqual([12, 11, 10, 13]);
  });

  it('collects category subtree ids and delete order for force delete', () => {
    expect(collectCategoryForceDeletePlan([
      { id: 10, parent_id: null },
      { id: 11, parent_id: 10 },
      { id: 12, parent_id: 11 },
      { id: 13, parent_id: 10 },
      { id: 99, parent_id: null },
    ], 10)).toEqual({
      category_ids: [10, 11, 12, 13],
      delete_order: [12, 11, 13, 10],
    });
  });

  it('summarizes force delete results', () => {
    expect(summarizeCategoryForceDeleteResults({
      deletedCategoryIds: [12, 11, 10],
      recycledArticleIds: [101, 102],
    })).toEqual({
      ok: true,
      deleted_category_count: 3,
      deleted_category_ids: [12, 11, 10],
      recycled_article_count: 2,
      recycled_article_ids: [101, 102],
    });
  });
});

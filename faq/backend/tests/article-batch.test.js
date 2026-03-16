const {
  getArticleBatchActionGuard,
} = require('../src/article-batch');

describe('faq article batch helpers', () => {
  it('blocks delete when recycled articles are mixed into normal batch operations', () => {
    expect(getArticleBatchActionGuard({
      action: 'delete',
      rows: [
        { id: 1, is_deleted: 0 },
        { id: 2, is_deleted: 1 },
      ],
    })).toEqual({
      ok: false,
      status: 409,
      error: '回收站文章请先恢复后再执行该操作',
    });
  });

  it('allows purge only when all selected articles are in recycle bin', () => {
    expect(getArticleBatchActionGuard({
      action: 'purge',
      rows: [
        { id: 3, is_deleted: 1 },
        { id: 4, is_deleted: 1 },
      ],
    })).toEqual({
      ok: true,
    });
  });

  it('blocks purge when active articles are included', () => {
    expect(getArticleBatchActionGuard({
      action: 'purge',
      rows: [
        { id: 5, is_deleted: 1 },
        { id: 6, is_deleted: 0 },
      ],
    })).toEqual({
      ok: false,
      status: 409,
      error: '仅回收站文章可执行彻底删除',
    });
  });

  it('blocks restore when active articles are included', () => {
    expect(getArticleBatchActionGuard({
      action: 'restore',
      rows: [
        { id: 7, is_deleted: 0 },
      ],
    })).toEqual({
      ok: false,
      status: 409,
      error: '仅回收站文章可执行恢复',
    });
  });
});

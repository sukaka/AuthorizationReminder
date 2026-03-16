const normalizeBatchAction = (value) => String(value || '').trim().toLowerCase();

const isDeletedRow = (row) => Number(row?.is_deleted || 0) === 1;

const getArticleBatchActionGuard = ({ action, rows = [] } = {}) => {
  const normalizedAction = normalizeBatchAction(action);
  const list = Array.isArray(rows) ? rows : [];
  const deletedRows = list.filter((item) => isDeletedRow(item));

  if (deletedRows.length && !['restore', 'purge'].includes(normalizedAction)) {
    return {
      ok: false,
      status: 409,
      error: '回收站文章请先恢复后再执行该操作',
    };
  }

  if (normalizedAction === 'restore') {
    const invalid = list.filter((item) => !isDeletedRow(item));
    if (invalid.length) {
      return {
        ok: false,
        status: 409,
        error: '仅回收站文章可执行恢复',
      };
    }
  }

  if (normalizedAction === 'purge') {
    const invalid = list.filter((item) => !isDeletedRow(item));
    if (invalid.length) {
      return {
        ok: false,
        status: 409,
        error: '仅回收站文章可执行彻底删除',
      };
    }
  }

  return { ok: true };
};

module.exports = {
  getArticleBatchActionGuard,
};

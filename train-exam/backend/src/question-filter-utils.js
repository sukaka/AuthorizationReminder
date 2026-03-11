const trimText = (value) => String(value || '').trim();

const normalizeFilterValue = (value, { lower = false, ignoreAll = false } = {}) => {
  const text = trimText(value);
  if (!text) return '';
  const normalized = lower ? text.toLowerCase() : text;
  if (ignoreAll && normalized === 'all') return '';
  return normalized;
};

const buildQuestionFilterWhere = (filters = {}) => {
  const keyword = trimText(filters?.keyword);
  const status = normalizeFilterValue(filters?.status, { lower: true, ignoreAll: true });
  const questionType = normalizeFilterValue(filters?.question_type, { lower: true, ignoreAll: true });
  const sourceType = normalizeFilterValue(filters?.source_type ?? filters?.source, { lower: true, ignoreAll: true });
  const questionCategory = normalizeFilterValue(filters?.question_category ?? filters?.category, { ignoreAll: true });

  const where = [];
  const params = [];

  if (keyword) {
    where.push('stem LIKE ?');
    params.push(`%${keyword}%`);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (questionType) {
    where.push('question_type = ?');
    params.push(questionType);
  }
  if (sourceType) {
    where.push('source_type = ?');
    params.push(sourceType);
  }
  if (questionCategory) {
    where.push('question_category = ?');
    params.push(questionCategory);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
};

module.exports = {
  buildQuestionFilterWhere,
};

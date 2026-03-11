const { buildQuestionFilterWhere } = require('../src/question-filter-utils');

describe('question filter utils', () => {
  it('returns empty where clause for empty filters', () => {
    expect(buildQuestionFilterWhere({})).toEqual({
      whereSql: '',
      params: [],
    });
  });

  it('builds stable query parts for keyword, status, source and category', () => {
    expect(buildQuestionFilterWhere({
      keyword: ' 安全 ',
      status: 'draft',
      source_type: 'import',
      question_category: '十二条令',
    })).toEqual({
      whereSql: 'WHERE stem LIKE ? AND status = ? AND source_type = ? AND question_category = ?',
      params: ['%安全%', 'draft', 'import', '十二条令'],
    });
  });

  it('ignores all-like values and trims aliases', () => {
    expect(buildQuestionFilterWhere({
      keyword: '',
      status: 'all',
      source_type: ' all ',
      question_category: ' all ',
      question_type: ' single_choice ',
    })).toEqual({
      whereSql: 'WHERE question_type = ?',
      params: ['single_choice'],
    });
  });

  it('accepts frontend source and category aliases', () => {
    expect(buildQuestionFilterWhere({
      source: 'import',
      category: 'Excel导入',
    })).toEqual({
      whereSql: 'WHERE source_type = ? AND question_category = ?',
      params: ['import', 'Excel导入'],
    });
  });
});

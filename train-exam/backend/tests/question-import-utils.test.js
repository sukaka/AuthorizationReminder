const {
  buildQuestionImportTemplateRows,
  normalizeJudgementAnswer,
  resolveImportQuestionStatus,
} = require('../src/question-import-utils');

describe('question import utils', () => {
  it('normalizes chinese judgement answers', () => {
    expect(normalizeJudgementAnswer('正确')).toBe('true');
    expect(normalizeJudgementAnswer('错误')).toBe('false');
    expect(normalizeJudgementAnswer('是')).toBe('true');
    expect(normalizeJudgementAnswer('否')).toBe('false');
  });

  it('publishes imported questions only when requested by reviewer', () => {
    expect(resolveImportQuestionStatus({ publishAfterImport: true, canReview: true })).toBe('published');
    expect(resolveImportQuestionStatus({ publishAfterImport: true, canReview: false })).toBe('draft');
    expect(resolveImportQuestionStatus({ publishAfterImport: false, canReview: true })).toBe('draft');
  });

  it('includes a judgement example row in the import template', () => {
    const rows = buildQuestionImportTemplateRows();
    const judgementExample = rows.find((row, index) => index > 0 && String(row?.[2] || '').includes('判断'));
    expect(judgementExample).toBeTruthy();
    expect(String(judgementExample[9] || '')).toBeTruthy();
  });
});

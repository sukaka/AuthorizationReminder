const { normalizePaperRuleCategories } = require('../src/paper-rule-utils');

describe('paper rule utils', () => {
  it('normalizes empty category input', () => {
    expect(normalizePaperRuleCategories()).toEqual([]);
    expect(normalizePaperRuleCategories([])).toEqual([]);
    expect(normalizePaperRuleCategories('')).toEqual([]);
  });

  it('supports a single selected category', () => {
    expect(normalizePaperRuleCategories(['网络安全'])).toEqual(['网络安全']);
    expect(normalizePaperRuleCategories('网络安全')).toEqual(['网络安全']);
  });

  it('supports multiple selected categories with trim and dedupe', () => {
    expect(normalizePaperRuleCategories([' 网络安全 ', '账号安全', '网络安全', '', '  ']))
      .toEqual(['网络安全', '账号安全']);
    expect(normalizePaperRuleCategories(' 网络安全, 账号安全 ,网络安全 '))
      .toEqual(['网络安全', '账号安全']);
  });
});

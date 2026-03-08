const { buildDeviationAndResponseTables } = require('../src/deviation-response');

describe('deviation and response table generator', () => {
  it('marks mandatory non-satisfied rows as high risk and manual review required', () => {
    const result = buildDeviationAndResponseTables({
      bidCategory: 'PRODUCT',
      finalJson: {
        technical_deviation_table: [
          {
            item_no: '3.2.1',
            param_name: '双机热备',
            tender_requirement: '支持双机热备',
            bid_response: '不满足',
            deviation: '负偏离',
            is_mandatory: '是',
            negative_deviation_invalid: '是',
          },
        ],
      },
    });

    expect(result.deviation_tables.technical).toHaveLength(1);
    expect(result.deviation_tables.technical[0].satisfy_status).toBe('NOT_SATISFIED');
    expect(result.deviation_tables.technical[0].risk_level).toBe('HIGH');
    expect(result.deviation_tables.technical[0].manual_review_required).toBe(true);
  });

  it('outputs response table rows with evidence source and review flag', () => {
    const result = buildDeviationAndResponseTables({
      bidCategory: 'SERVICE',
      finalJson: {
        business_performance_rules: {
          other_business_rules: ['需提供原厂授权书并盖章'],
        },
      },
    });

    expect(result.response_tables.business).toHaveLength(1);
    expect(result.response_tables.business[0].evidence_source).toContain('授权');
    expect(result.response_tables.business[0].deviation).toBe('无偏离');
    expect(typeof result.response_tables.business[0].manual_review_required).toBe('boolean');
  });
});

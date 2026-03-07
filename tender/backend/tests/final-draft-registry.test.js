const {
  buildRequirementRows,
  buildEvidenceRows,
  buildDraftSectionRows,
} = require('../src/final-draft-registry');

describe('final draft registry mappers', () => {
  it('maps scoring, invalid bid, business, technical and format requirements into normalized rows', () => {
    const rows = buildRequirementRows({
      jobId: 11,
      bidCategory: 'SERVICE',
      finalJson: {
        business_performance_rules: {
          payment_terms: '付款方式按季度结算',
          liability_for_breach_of_contract: '违约需承担赔偿责任',
          other_business_rules: ['需要原厂授权书'],
        },
        invalid_bid_full_clauses: {
          qualification_invalid_clauses: ['未提供营业执照复印件作无效投标处理'],
        },
        service_procurement_detail: {
          service_implementation_requirements: ['实施过程必须驻场服务'],
          after_sales_requirements: ['提供 7*24 售后支持'],
        },
      },
      scoringItems: [
        {
          title: '项目经理经验',
          section_key: 'SCORING_STANDARD',
          section_title: '评标办法',
          evidence: '同类项目经验',
          suggestion: '补强案例',
        },
      ],
      stage1RiskClauses: [
        {
          clause_type: 'QUALIFICATION_INVALID',
          clause_content: '未提供营业执照复印件作无效投标处理',
          risk_level: '高',
          source_reference: {
            chapter: '投标人须知',
            page_number: '12',
            line_number: '233',
            excerpt: '未提供营业执照复印件作无效投标处理',
          },
        },
      ],
      tableSummaries: [
        {
          section_key: 'TECH_PARAM_TABLE',
          summary: '技术参数表：响应时间不大于 30 分钟',
        },
      ],
    });

    expect(rows.some((row) => row.requirement_type === 'SCORING')).toBe(true);
    expect(rows.some((row) => row.requirement_type === 'INVALID_BID')).toBe(true);
    expect(rows.some((row) => row.requirement_type === 'BUSINESS')).toBe(true);
    expect(rows.some((row) => row.requirement_type === 'TECH_PARAM')).toBe(true);
    expect(rows.every((row) => row.job_id === 11)).toBe(true);
    expect(rows.every((row) => row.requirement_code)).toBe(true);
  });

  it('maps library snapshot into auditable evidence rows', () => {
    const rows = buildEvidenceRows({
      bidId: 21,
      librarySnapshot: {
        company: {
          company_name: '聚信科技',
          uscc: '91310000123456789X',
        },
        qualifications: [
          { id: 3, title: '高新技术企业证书', certificate_no: 'GX-001' },
        ],
        finance: [
          { id: 4, info_name: '2025年度审计报告', info_type: '审计报告' },
        ],
        performance: [
          { id: 5, project_name: '某市政务云项目', party_a_name: '某市数据局' },
        ],
        personnel_list: [
          { id: 6, name: '张三', position: '项目经理', qualification_cert: '一级建造师' },
        ],
        personnel: {
          legal: { name: '李四', position: '法人' },
          agent: { name: '王五', position: '授权代表' },
        },
      },
    });

    expect(rows.some((row) => row.evidence_type === 'COMPANY')).toBe(true);
    expect(rows.some((row) => row.evidence_type === 'QUALIFICATION')).toBe(true);
    expect(rows.some((row) => row.evidence_type === 'FINANCE')).toBe(true);
    expect(rows.some((row) => row.evidence_type === 'PERFORMANCE')).toBe(true);
    expect(rows.some((row) => row.evidence_type === 'PERSONNEL')).toBe(true);
    expect(rows.every((row) => row.bid_id === 21)).toBe(true);
  });

  it('maps generated chapters into paragraph-level draft section rows', () => {
    const rows = buildDraftSectionRows({
      bidId: 31,
      versionId: 41,
      chapters: [
        {
          title: '评标方法与评标标准',
          content: [
            '第一段：项目经理经验得满分',
            '第二段：需提供至少 3 个同类案例',
          ],
        },
      ],
      sectionLinks: {
        '评标方法与评标标准': {
          requirement_ids: ['REQ-SCORING-0001'],
          evidence_ids: ['EVI-PERFORMANCE-0001'],
          score_item_ids: ['REQ-SCORING-0001'],
          template_slot: 'TECHNICAL_VOLUME_CONTENT',
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].bid_id).toBe(31);
    expect(rows[0].version_id).toBe(41);
    expect(rows[0].section_title).toBe('评标方法与评标标准');
    expect(rows[0].paragraph_no).toBe(1);
    expect(rows[0].template_slot).toBe('TECHNICAL_VOLUME_CONTENT');
    expect(rows[0].requirement_ids_json).toContain('REQ-SCORING-0001');
  });
});

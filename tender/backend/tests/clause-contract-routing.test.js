const {
  buildClauseRegistryV2,
  buildSectionLinksFromClauseRegistry,
  executeClauseRoutes,
} = require('../src/final-draft-registry');

describe('clause contract and routing', () => {
  it('builds clause contract with route metadata from requirement rows', () => {
    const clauses = buildClauseRegistryV2({
      requirements: [
        {
          id: 1,
          job_id: 101,
          bid_category: 'SERVICE',
          requirement_code: 'REQ-SCORING-0001',
          requirement_type: 'SCORING',
          title: '实施方案完整性',
          requirement_text: '根据项目理解、实施步骤、进度安排、风险控制综合评分',
          section_key: 'SCORING_STANDARD',
          section_title: '评标方法与评标标准',
          risk_level: 'HIGH',
          source_json: JSON.stringify({ clause_type: 'IMPLEMENT_PLAN_SCORE' }),
        },
        {
          id: 2,
          job_id: 101,
          bid_category: 'SERVICE',
          requirement_code: 'REQ-TECH_PARAM-0002',
          requirement_type: 'TECH_PARAM',
          title: 'SLA响应时效',
          requirement_text: '关键故障2小时到场',
          section_key: 'PROCUREMENT_REQUIREMENT',
          section_title: '采购需求',
          risk_level: 'MEDIUM',
        },
      ],
    });

    expect(clauses).toHaveLength(2);
    expect(clauses[0].clause_id).toBe('REQ-SCORING-0001');
    expect(clauses[0].response_mode).toBe('AI_DRAFT');
    expect(clauses[0].route.target_module).toBe('SCORE_OPTIMIZER');
    expect(clauses[0].scoring_related).toBe(true);
    expect(clauses[1].response_mode).toBe('PARAM_COMPARE');
    expect(clauses[1].route.target_module).toBe('DEVIATION_GENERATOR');
  });

  it('exposes clause subtype and refines routing defaults for authorization and demo variants', () => {
    const clauses = buildClauseRegistryV2({
      requirements: [
        {
          id: 3,
          requirement_code: 'REQ-QUAL-0003',
          requirement_type: 'QUALIFICATION',
          title: '原厂授权',
          requirement_text: '须提供原厂授权书',
          source_json: JSON.stringify({
            clause_subtype: 'MANUFACTURER_AUTHORIZATION',
          }),
        },
        {
          id: 4,
          requirement_code: 'REQ-TECH-0004',
          requirement_type: 'TECH_PARAM',
          title: '现场演示',
          requirement_text: '投标人须现场演示核心功能',
          source_json: JSON.stringify({
            clause_subtype: 'DEMO_REQUIRED',
          }),
        },
      ],
    });

    expect(clauses[0].clause_subtype).toBe('MANUFACTURER_AUTHORIZATION');
    expect(clauses[0].response_mode).toBe('EVIDENCE_BINDING');
    expect(clauses[0].route.target_module).toBe('EVIDENCE_MATCHER');
    expect(clauses[1].clause_subtype).toBe('DEMO_REQUIRED');
    expect(clauses[1].response_mode).toBe('MANUAL_ONLY');
    expect(clauses[1].route.target_module).toBe('RISK_CHECKER');
  });

  it('maps clause contracts into chapter-level section links for draft section registry', () => {
    const sectionLinks = buildSectionLinksFromClauseRegistry({
      clauses: [
        {
          clause_id: 'REQ-SCORING-0001',
          requirement_type: 'SCORING',
          chapter_title: '评标方法与评标标准',
          response_mode: 'AI_DRAFT',
          scoring_related: true,
        },
        {
          clause_id: 'REQ-TECH_PARAM-0002',
          requirement_type: 'TECH_PARAM',
          chapter_title: '采购需求',
          response_mode: 'PARAM_COMPARE',
          scoring_related: false,
        },
      ],
      chapters: [
        { title: '评标方法与评标标准', content: ['A'] },
        { title: '采购需求', content: ['B'] },
      ],
    });

    expect(Array.isArray(sectionLinks['评标方法与评标标准'].requirement_ids)).toBe(true);
    expect(sectionLinks['评标方法与评标标准'].requirement_ids).toContain('REQ-SCORING-0001');
    expect(sectionLinks['评标方法与评标标准'].score_item_ids).toContain('REQ-SCORING-0001');
    expect(sectionLinks['采购需求'].requirement_ids).toContain('REQ-TECH_PARAM-0002');
  });

  it('executes response_mode routing and injects auditable lines into matched chapters', () => {
    const result = executeClauseRoutes({
      clauses: [
        {
          clause_id: 'REQ-BUSINESS-0001',
          requirement_type: 'BUSINESS',
          chapter_title: '商务响应',
          response_mode: 'EXACT_QUOTE',
          source_text: '投标人须提供原厂授权书',
        },
        {
          clause_id: 'REQ-TECH_PARAM-0002',
          requirement_type: 'TECH_PARAM',
          chapter_title: '技术偏离表',
          response_mode: 'PARAM_COMPARE',
          source_text: '关键故障2小时到场',
        },
        {
          clause_id: 'REQ-QUALIFICATION-0003',
          requirement_type: 'QUALIFICATION',
          chapter_title: '资格审查资料',
          response_mode: 'EVIDENCE_BINDING',
          source_text: '提供近三年同类案例不少于3个',
        },
      ],
      chapters: [
        { title: '商务响应', content: ['原有内容A'] },
        { title: '技术偏离表', content: ['原有内容B'] },
        { title: '资格审查资料', content: ['原有内容C'] },
      ],
    });

    expect(result.applied_changes).toBeGreaterThanOrEqual(3);
    expect(result.response_mode_counts.EXACT_QUOTE).toBe(1);
    expect(result.response_mode_counts.PARAM_COMPARE).toBe(1);
    expect(result.response_mode_counts.EVIDENCE_BINDING).toBe(1);
    expect(result.chapters[0].content.some((line) => line.includes('【原文引用】投标人须提供原厂授权书'))).toBe(true);
    expect(result.chapters[1].content.some((line) => line.includes('【参数比对项】关键故障2小时到场'))).toBe(true);
    expect(result.chapters[2].content.some((line) => line.includes('【材料绑定项】提供近三年同类案例不少于3个'))).toBe(true);
  });
});

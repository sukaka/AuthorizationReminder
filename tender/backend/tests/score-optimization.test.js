const {
  buildScoreCoverageMatrix,
  pickOptimizationCandidates,
  normalizeOptimizationResponse,
  applyOptimizationToSections,
  buildWinningStrategyProfiles,
  pickWinningStrategyProfile,
  applyWinningStrategyToSuggestions,
} = require('../src/score-optimization');

describe('score optimization', () => {
  it('marks uncovered high-score item as optimization-needed', () => {
    const rows = buildScoreCoverageMatrix({
      requirements: [
        { id: 9, requirement_type: 'SCORING', title: '项目团队实力', full_score: 8, requirement_code: 'REQ-SCORING-0009' },
      ],
      sections: [],
      evidences: [],
    });

    expect(rows[0].coverage_status).toBe('NONE');
    expect(rows[0].optimization_needed_flag).toBe(1);
  });

  it('marks scoring item with section but no evidence as weak', () => {
    const rows = buildScoreCoverageMatrix({
      requirements: [
        { id: 10, requirement_type: 'SCORING', title: '项目经理经验', full_score: 6, requirement_code: 'REQ-SCORING-0010' },
      ],
      sections: [
        {
          section_title: '评标方法与评标标准',
          requirement_ids_json: JSON.stringify(['REQ-SCORING-0010']),
          evidence_ids_json: JSON.stringify([]),
          paragraph_text: '我方项目经理具备丰富经验。',
        },
      ],
      evidences: [],
    });

    expect(rows[0].coverage_status).toBe('WEAK');
    expect(rows[0].optimization_needed_flag).toBe(1);
  });

  it('picks only optimization-needed candidates', () => {
    const rows = pickOptimizationCandidates([
      { score_item_id: 'REQ-SCORING-0001', coverage_status: 'NONE', optimization_needed_flag: 1 },
      { score_item_id: 'REQ-SCORING-0002', coverage_status: 'STRONG', optimization_needed_flag: 0 },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].score_item_id).toBe('REQ-SCORING-0001');
  });

  it('normalizes optimization response items', () => {
    const result = normalizeOptimizationResponse({
      items: [
        {
          score_item_id: 'REQ-SCORING-0003',
          suggestion_title: '补强项目团队',
          suggestion_text: '补充团队履历与案例。',
          evidence_ids: ['EVI-PERFORMANCE-0001'],
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].suggestion_title).toBe('补强项目团队');
    expect(result.items[0].evidence_ids).toContain('EVI-PERFORMANCE-0001');
  });

  it('applies optimization suggestions into existing draft sections with before/after audit records', () => {
    const result = applyOptimizationToSections({
      sections: [
        {
          section_title: '评标方法与评标标准',
          paragraph_no: 1,
          paragraph_text: '项目经理具备经验。',
          requirement_ids_json: JSON.stringify(['REQ-SCORING-0003']),
          evidence_ids_json: JSON.stringify([]),
        },
      ],
      items: [
        {
          score_item_id: 'REQ-SCORING-0003',
          suggestion_title: '补强项目经理经验',
          suggestion_text: '补充同类项目履历、证书、角色职责和履约结果。',
          evidence_ids: ['EVI-PERFORMANCE-0001', 'EVI-PERSONNEL-0002'],
        },
      ],
    });

    expect(result.applied_count).toBe(1);
    expect(result.sections[0].paragraph_text.includes('补强项目经理经验')).toBe(true);
    expect(result.sections[0].evidence_ids_json).toContain('EVI-PERFORMANCE-0001');
    expect(result.applied_records[0].before_text).toContain('项目经理具备经验');
    expect(result.applied_records[0].after_text).toContain('补充同类项目履历');
    expect(result.applied_records[0].status).toBe('APPLIED');
  });

  it('creates dedicated score section when no section can be matched', () => {
    const result = applyOptimizationToSections({
      sections: [],
      items: [
        {
          score_item_id: 'REQ-SCORING-0099',
          suggestion_title: '新增专项评分响应',
          suggestion_text: '围绕评分细则新增专项章节并绑定证据。',
          evidence_ids: ['EVI-QUALIFICATION-0001'],
        },
      ],
    });

    expect(result.applied_count).toBe(1);
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].section_title).toBe('评分专项响应');
    expect(result.sections[0].paragraph_text).toContain('新增专项评分响应');
    expect(result.sections[0].requirement_ids_json).toContain('REQ-SCORING-0099');
  });

  it('builds winning strategy profiles from won kb projects and picks exact matching profile', () => {
    const profiles = buildWinningStrategyProfiles({
      kbProjects: [
        { id: 1, project_type: 'SERVICE', industry_type: '医疗', result_status: 'WON' },
        { id: 2, project_type: 'SERVICE', industry_type: '医疗', result_status: 'WON' },
        { id: 3, project_type: 'PRODUCT', industry_type: '教育', result_status: 'WON' },
      ],
      kbScoreItems: [
        {
          id: 11,
          kb_project_id: 1,
          item_name: '售后服务方案',
          full_score: 8,
          recommended_response_points: JSON.stringify(['7×24小时响应', '2小时到场', '本地服务团队']),
          priority_level: 'HIGH',
        },
        {
          id: 12,
          kb_project_id: 2,
          item_name: '售后服务方案',
          full_score: 6,
          recommended_response_points: JSON.stringify(['原厂协同', '本地服务团队']),
          priority_level: 'HIGH',
        },
      ],
      kbSectionAssets: [
        {
          id: 21,
          kb_project_id: 1,
          section_name: '售后服务方案',
          applicable_scene: 'SCORE_OPTIMIZE',
          source_score_item_id: 11,
        },
        {
          id: 22,
          kb_project_id: 2,
          section_name: '服务承诺',
          applicable_scene: 'SCORE_OPTIMIZE',
          source_score_item_id: 12,
        },
      ],
    });

    const profile = pickWinningStrategyProfile({
      profiles,
      projectType: 'SERVICE',
      industryType: '医疗',
    });

    expect(Array.isArray(profiles)).toBe(true);
    expect(profile.profile_key).toBe('SERVICE|医疗');
    expect(profile.won_project_count).toBe(2);
    expect(profile.source_project_ids).toEqual([1, 2]);
    expect(profile.item_profiles[0].learned_points).toContain('7×24小时响应');
    expect(profile.item_profiles[0].learned_sections).toContain('售后服务方案');
  });

  it('applies learned winning strategy directives into optimization suggestions with audit trace', () => {
    const result = applyWinningStrategyToSuggestions({
      items: [
        {
          score_item_id: 'REQ-SCORING-0101',
          suggestion_title: '补强售后服务方案',
          suggestion_text: '补充售后保障能力与服务机制。',
          evidence_ids: [],
          source: 'RULE',
        },
      ],
      profile: {
        profile_key: 'SERVICE|医疗',
        item_profiles: [
          {
            item_name: '售后服务方案',
            learned_points: ['7×24小时响应', '2小时到场', '本地服务团队'],
            learned_sections: ['售后服务方案', '服务承诺'],
            source_project_ids: [1, 2],
            source_score_item_ids: [11, 12],
          },
        ],
      },
    });

    expect(result.matched_count).toBe(1);
    expect(result.items[0].suggestion_text).toContain('历史中标策略');
    expect(result.items[0].suggestion_text).toContain('7×24小时响应');
    expect(result.items[0].strategy_profile_key).toBe('SERVICE|医疗');
    expect(result.items[0].strategy_hit_points).toContain('2小时到场');
    expect(result.items[0].strategy_source_project_ids).toEqual([1, 2]);
  });
});

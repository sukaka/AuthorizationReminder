const {
  buildScoreCoverageMatrix,
  pickOptimizationCandidates,
  normalizeOptimizationResponse,
  applyOptimizationToSections,
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
});

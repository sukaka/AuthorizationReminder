const {
  runStructuredChecks,
  buildCheckSummary,
  runDocxChecks,
  mergeCheckResults,
} = require('../src/final-draft-checks');

describe('final draft structured checks', () => {
  it('emits fatal missing requirement when no section covers a qualification requirement', () => {
    const result = runStructuredChecks({
      requirements: [
        {
          id: 1,
          requirement_type: 'QUALIFICATION',
          title: '营业执照',
          requirement_text: '需提供营业执照复印件',
          requirement_code: 'REQ-QUALIFICATION-0001',
        },
      ],
      sections: [],
      evidences: [],
      paragraphs: [],
    });

    expect(result.summary.fatal_count).toBe(1);
    expect(result.issues[0].type).toBe('missing_requirement');
    expect(result.issues[0].severity).toBe('FATAL');
  });

  it('emits missing evidence and score gap for uncovered scoring requirement', () => {
    const result = runStructuredChecks({
      requirements: [
        {
          id: 2,
          requirement_type: 'SCORING',
          title: '项目经理经验',
          requirement_text: '项目经理具备同类项目经验得满分',
          requirement_code: 'REQ-SCORING-0001',
          full_score: 8,
        },
      ],
      sections: [
        {
          section_title: '评标方法与评标标准',
          paragraph_text: '我方项目经理经验丰富。',
          requirement_ids_json: JSON.stringify(['REQ-SCORING-0001']),
          evidence_ids_json: JSON.stringify([]),
        },
      ],
      evidences: [],
      paragraphs: [],
    });

    expect(result.issues.some((issue) => issue.type === 'missing_evidence')).toBe(true);
    expect(result.issues.some((issue) => issue.type === 'score_gap')).toBe(true);
    expect(result.summary.warn_count).toBeGreaterThanOrEqual(2);
  });

  it('emits placeholder risk when generated paragraphs still contain template markers', () => {
    const result = runStructuredChecks({
      requirements: [],
      sections: [],
      evidences: [],
      paragraphs: ['封面', '{{PROJECT_NAME}}', '技术方案'],
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('placeholder_risk');
    expect(result.issues[0].severity).toBe('WARN');
  });

  it('emits exact quote warning when clause requires exact quote but draft text does not contain original text', () => {
    const result = runStructuredChecks({
      requirements: [
        {
          id: 3,
          requirement_type: 'BUSINESS',
          title: '原厂授权要求',
          requirement_text: '必须提供原厂授权书',
          requirement_code: 'REQ-BUSINESS-0003',
          source_json: JSON.stringify({
            clause_contract_v2: {
              need_exact_quote: true,
              source_text: '必须提供原厂授权书',
              response_mode: 'EXACT_QUOTE',
            },
          }),
        },
      ],
      sections: [
        {
          section_title: '商务响应',
          paragraph_text: '我方承诺提供必要授权材料。',
          requirement_ids_json: JSON.stringify(['REQ-BUSINESS-0003']),
          evidence_ids_json: JSON.stringify([]),
        },
      ],
      evidences: [],
      paragraphs: [],
    });

    expect(result.issues.some((issue) => issue.type === 'exact_quote_missing')).toBe(true);
  });

  it('emits parameter compare warning when tech clause requires compare style response but draft lacks compare tokens', () => {
    const result = runStructuredChecks({
      requirements: [
        {
          id: 4,
          requirement_type: 'TECH_PARAM',
          title: '双机热备',
          requirement_text: '支持双机热备',
          requirement_code: 'REQ-TECH_PARAM-0004',
          source_json: JSON.stringify({
            clause_contract_v2: {
              need_parameter_compare: true,
              response_mode: 'PARAM_COMPARE',
            },
          }),
        },
      ],
      sections: [
        {
          section_title: '技术方案',
          paragraph_text: '我方方案覆盖本项目全部技术要求。',
          requirement_ids_json: JSON.stringify(['REQ-TECH_PARAM-0004']),
          evidence_ids_json: JSON.stringify([]),
        },
      ],
      evidences: [],
      paragraphs: [],
    });

    expect(result.issues.some((issue) => issue.type === 'parameter_compare_missing')).toBe(true);
  });

  it('emits consistency and stale-content risks when project key fields conflict with expected context', () => {
    const result = runStructuredChecks({
      requirements: [],
      sections: [
        {
          section_title: '封面',
          paragraph_text: '项目名称：旧项目A\n项目编号：OLD-001\n联系人：张三 13800138000',
          requirement_ids_json: '[]',
          evidence_ids_json: '[]',
        },
        {
          section_title: '投标人须知',
          paragraph_text: '项目名称：新项目B\n项目编号：NEW-002\n联系人：李四 13900139000',
          requirement_ids_json: '[]',
          evidence_ids_json: '[]',
        },
      ],
      evidences: [],
      paragraphs: ['上一项目内容未替换', '待完善项目'],
      context: {
        expected_project_name: '新项目B',
        expected_project_no: 'NEW-002',
        as_of_date: '2026-03-07',
      },
    });

    expect(result.issues.some((issue) => issue.type === 'consistency_conflict')).toBe(true);
    expect(result.issues.some((issue) => issue.type === 'stale_content_risk')).toBe(true);
  });

  it('emits satisfied-without-evidence and expired-evidence risks', () => {
    const result = runStructuredChecks({
      requirements: [
        {
          id: 5,
          requirement_type: 'TECH_PARAM',
          title: '双机热备',
          requirement_text: '支持双机热备',
          requirement_code: 'REQ-TECH_PARAM-0005',
        },
      ],
      sections: [
        {
          section_title: '技术响应',
          paragraph_text: '我方完全满足双机热备要求。',
          requirement_ids_json: JSON.stringify(['REQ-TECH_PARAM-0005']),
          evidence_ids_json: JSON.stringify([]),
        },
      ],
      evidences: [
        {
          evidence_code: 'EVI-QUALIFICATION-0001',
          evidence_type: 'QUALIFICATION',
          title: '高新技术企业证书',
          evidence_text: '有效期至2025-12-31',
          source_json: JSON.stringify({
            valid_to: '2025-12-31',
          }),
        },
      ],
      paragraphs: [],
      context: {
        as_of_date: '2026-03-07',
      },
    });

    expect(result.issues.some((issue) => issue.type === 'satisfied_without_evidence')).toBe(true);
    expect(result.issues.some((issue) => issue.type === 'expired_evidence')).toBe(true);
  });

  it('emits performance-out-of-range risk when requirement asks for recent cases but evidence date is too old', () => {
    const result = runStructuredChecks({
      requirements: [
        {
          id: 6,
          requirement_type: 'QUALIFICATION',
          title: '类似业绩',
          requirement_text: '近三年类似项目业绩不少于3个',
          requirement_code: 'REQ-QUALIFICATION-0006',
        },
      ],
      sections: [
        {
          section_title: '类似业绩',
          paragraph_text: '已提供相关案例。',
          requirement_ids_json: JSON.stringify(['REQ-QUALIFICATION-0006']),
          evidence_ids_json: JSON.stringify(['EVI-PERFORMANCE-0001']),
        },
      ],
      evidences: [
        {
          evidence_code: 'EVI-PERFORMANCE-0001',
          evidence_type: 'PERFORMANCE',
          title: '某旧项目',
          evidence_text: '签约日期：2020-05-01',
          source_json: JSON.stringify({
            sign_date: '2020-05-01',
          }),
        },
      ],
      paragraphs: [],
      context: {
        as_of_date: '2026-03-07',
      },
    });

    expect(result.issues.some((issue) => issue.type === 'performance_out_of_range')).toBe(true);
  });

  it('summarizes issue counts by severity', () => {
    const summary = buildCheckSummary([
      { severity: 'FATAL' },
      { severity: 'WARN' },
      { severity: 'WARN' },
    ]);

    expect(summary.fatal_count).toBe(1);
    expect(summary.warn_count).toBe(2);
    expect(summary.issue_count).toBe(3);
  });

  it('detects docx placeholder and section order risks', () => {
    const result = runDocxChecks({
      paragraphs: [
        '封面',
        '{{PROJECT_NAME}}',
        '第三章 商务条款响应',
        '第二章 技术偏离表',
      ],
    });

    expect(result.issues.some((issue) => issue.type === 'placeholder_risk')).toBe(true);
    expect(result.issues.some((issue) => issue.type === 'section_order_risk')).toBe(true);
  });

  it('detects missing toc and signature slots from docx paragraphs', () => {
    const result = runDocxChecks({
      paragraphs: [
        '封面',
        '第一章 项目理解',
        '第二章 技术方案',
      ],
    });

    expect(result.issues.some((issue) => issue.type === 'toc_missing')).toBe(true);
    expect(result.issues.some((issue) => issue.type === 'signature_slot_missing')).toBe(true);
  });

  it('merges structured and docx issues into one summary', () => {
    const result = mergeCheckResults(
      {
        issues: [{ type: 'missing_requirement', severity: 'FATAL' }],
        summary: { issue_count: 1, fatal_count: 1, warn_count: 0, pass: false },
      },
      {
        issues: [{ type: 'toc_missing', severity: 'WARN' }],
      }
    );

    expect(result.issues).toHaveLength(2);
    expect(result.summary.fatal_count).toBe(1);
    expect(result.summary.warn_count).toBe(1);
  });
});

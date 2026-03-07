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

import { describe, expect, it } from 'vitest';

import validationRuleLibrary from '../src/validation-rule-library.js';

const {
  buildValidationRuleSeed,
  normalizeValidationRuleRow,
  decorateIssuesWithRules,
  buildRuleExecutionSummary,
} = validationRuleLibrary;

describe('validation rule library helpers', () => {
  it('builds at least 100 normalized base validation rules', () => {
    const rules = buildValidationRuleSeed();

    expect(rules.length).toBeGreaterThanOrEqual(100);
    expect(new Set(rules.map((item) => item.rule_name)).size).toBe(rules.length);
    expect(rules.every((item) => item.active_flag === 1)).toBe(true);
  });

  it('normalizes rule rows into stable issue-type aware metadata', () => {
    const row = normalizeValidationRuleRow({
      id: 17,
      rule_name: 'DV-DRAFT-001 占位符未替换',
      rule_type: 'draft_consistency',
      trigger_condition: 'issue_type=placeholder_risk',
      check_logic: '扫描文档占位符。',
      severity: 'medium',
      suggested_action: '替换后重新校验',
      active_flag: '1',
      tags_json: JSON.stringify({
        issue_type: 'placeholder_risk',
        execution_module: 'final_draft_checks',
      }),
    });

    expect(row.rule_type).toBe('DRAFT_CONSISTENCY');
    expect(row.severity).toBe('MEDIUM');
    expect(row.active_flag).toBe(1);
    expect(row.tags.issue_type).toBe('placeholder_risk');
    expect(row.tags.execution_module).toBe('final_draft_checks');
  });

  it('decorates runtime issues with matched rule metadata by issue type', () => {
    const rules = [
      normalizeValidationRuleRow({
        id: 1,
        rule_name: 'DV-DRAFT-001 占位符未替换',
        rule_type: 'DRAFT_CONSISTENCY',
        trigger_condition: 'issue_type=placeholder_risk',
        check_logic: '扫描文档占位符。',
        severity: 'MEDIUM',
        active_flag: 1,
        tags_json: JSON.stringify({ issue_type: 'placeholder_risk' }),
      }),
      normalizeValidationRuleRow({
        id: 2,
        rule_name: 'DV-TABLE-003 表格状态冲突',
        rule_type: 'DEVIATION_RESPONSE',
        trigger_condition: 'issue_type=artifact_table_conflict',
        check_logic: '检查偏离表与应答表状态冲突。',
        severity: 'HIGH',
        active_flag: 1,
        tags_json: JSON.stringify({ issue_type: 'artifact_table_conflict' }),
      }),
    ];

    const issues = decorateIssuesWithRules({
      issues: [
        { type: 'placeholder_risk', title: '检测到模板占位符' },
        { type: 'artifact_table_conflict', title: '偏离表与应答表冲突' },
      ],
      rules,
    });

    expect(issues[0].matched_rules).toHaveLength(1);
    expect(issues[0].matched_rules[0].rule_name).toContain('占位符未替换');
    expect(issues[1].matched_rules).toHaveLength(1);
    expect(issues[1].matched_rules[0].severity).toBe('HIGH');
  });

  it('builds execution summary with active, matched, and unmapped counts', () => {
    const rules = [
      normalizeValidationRuleRow({
        id: 1,
        rule_name: 'DV-DRAFT-001 占位符未替换',
        rule_type: 'DRAFT_CONSISTENCY',
        trigger_condition: 'issue_type=placeholder_risk',
        check_logic: '扫描文档占位符。',
        severity: 'MEDIUM',
        active_flag: 1,
        tags_json: JSON.stringify({ issue_type: 'placeholder_risk' }),
      }),
      normalizeValidationRuleRow({
        id: 2,
        rule_name: 'DV-TABLE-003 表格状态冲突',
        rule_type: 'DEVIATION_RESPONSE',
        trigger_condition: 'issue_type=artifact_table_conflict',
        check_logic: '检查偏离表与应答表状态冲突。',
        severity: 'HIGH',
        active_flag: 1,
        tags_json: JSON.stringify({ issue_type: 'artifact_table_conflict' }),
      }),
    ];

    const decoratedIssues = decorateIssuesWithRules({
      issues: [
        { type: 'placeholder_risk', title: '检测到模板占位符' },
        { type: 'unknown_issue_type', title: '未知问题' },
      ],
      rules,
    });
    const summary = buildRuleExecutionSummary({
      rules,
      issues: decoratedIssues,
    });

    expect(summary.active_rule_count).toBe(2);
    expect(summary.matched_rule_count).toBe(1);
    expect(summary.triggered_issue_count).toBe(1);
    expect(summary.unmapped_issue_types).toEqual(['unknown_issue_type']);
  });
});

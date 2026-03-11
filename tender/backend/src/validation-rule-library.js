const normalizeText = (value) => String(value ?? '').trim();

const normalizeStatus = (value) => normalizeText(value).toUpperCase();

const parseJsonObject = (value) => {
  if (!value) return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const toFlag = (value, fallback = 1) => {
  if (value === 0 || value === 1) return Number(value);
  const text = normalizeText(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return 1;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return 0;
  return fallback;
};

const uniqueList = (values = []) => {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    const text = normalizeText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
};

const normalizeSeverity = (value) => {
  const severity = normalizeStatus(value);
  if (['FATAL', 'HIGH', 'MEDIUM', 'LOW', 'WARN'].includes(severity)) return severity;
  return 'MEDIUM';
};

const inferIssueTypeFromRule = (row = {}) => {
  const tags = parseJsonObject(row.tags_json ?? row.tags);
  const tagged = normalizeText(tags.issue_type);
  if (tagged) return tagged;
  const trigger = normalizeText(row.trigger_condition);
  const matched = trigger.match(/issue_type\s*=\s*([a-z0-9_:-]+)/i);
  return normalizeText(matched?.[1]);
};

const normalizeValidationRuleRow = (row = {}) => {
  const tags = parseJsonObject(row.tags_json ?? row.tags);
  const issueType = inferIssueTypeFromRule({ ...row, tags_json: tags });
  const nextTags = {
    ...tags,
    issue_type: issueType || normalizeText(tags.issue_type),
  };
  return {
    id: Number(row.id || 0) || 0,
    rule_name: normalizeText(row.rule_name),
    rule_type: normalizeStatus(row.rule_type),
    trigger_condition: normalizeText(row.trigger_condition),
    check_logic: normalizeText(row.check_logic),
    severity: normalizeSeverity(row.severity),
    suggested_action: normalizeText(row.suggested_action),
    active_flag: toFlag(row.active_flag, 1),
    tags: nextTags,
    created_at: row.created_at || null,
    updated_at: row.updated_at || row.created_at || null,
  };
};

const RULE_FAMILIES = [
  {
    code: 'QF',
    rule_type: 'QUALIFICATION_VALIDITY',
    title: '资质有效性',
    issue_types: ['expired_evidence', 'missing_evidence', 'performance_out_of_range', 'missing_requirement', 'consistency_conflict', 'satisfied_without_evidence'],
    variants: [
      {
        suffix: '基础核验',
        severity: 'HIGH',
        suggested_action: '补齐有效资质或重新绑定正确证据。',
      },
      {
        suffix: '时间窗口核验',
        severity: 'HIGH',
        suggested_action: '核对证照或业绩日期，并补充时间满足的材料。',
      },
      {
        suffix: '主体一致性核验',
        severity: 'MEDIUM',
        suggested_action: '统一投标主体、项目名称和证据主体信息。',
      },
      {
        suffix: '人工复核兜底',
        severity: 'MEDIUM',
        suggested_action: '提交业务人员进行资质与证据复核。',
      },
    ],
    family_tag: 'qualification',
  },
  {
    code: 'AT',
    rule_type: 'ATTACHMENT_COMPLETENESS',
    title: '附件完整性',
    issue_types: ['missing_requirement', 'missing_evidence', 'signature_slot_missing', 'signature_slot_incomplete', 'toc_missing', 'placeholder_risk'],
    variants: [
      {
        suffix: '必传附件核验',
        severity: 'HIGH',
        suggested_action: '补齐附件后重新执行成稿校验。',
      },
      {
        suffix: '签署格式核验',
        severity: 'HIGH',
        suggested_action: '补齐签字、盖章、日期与附件页。',
      },
      {
        suffix: '目录关联核验',
        severity: 'MEDIUM',
        suggested_action: '补齐目录与附件索引，确保引用可追溯。',
      },
      {
        suffix: '模板残留核验',
        severity: 'MEDIUM',
        suggested_action: '清理模板占位符和示例附件内容。',
      },
    ],
    family_tag: 'attachment',
  },
  {
    code: 'DV',
    rule_type: 'DEVIATION_RESPONSE',
    title: '偏离与应答',
    issue_types: ['parameter_compare_missing', 'artifact_table_conflict', 'section_artifact_conflict', 'satisfied_without_evidence', 'exact_quote_missing', 'score_gap'],
    variants: [
      {
        suffix: '参数映射核验',
        severity: 'HIGH',
        suggested_action: '补齐参数键、满足判定依据和证据来源。',
      },
      {
        suffix: '跨表一致性核验',
        severity: 'HIGH',
        suggested_action: '统一偏离表、应答表和正文中的满足状态。',
      },
      {
        suffix: '评分支撑核验',
        severity: 'MEDIUM',
        suggested_action: '补齐评分点对应的证据和明确表述。',
      },
      {
        suffix: '人工复核兜底',
        severity: 'MEDIUM',
        suggested_action: '提交技术/商务负责人复核关键响应项。',
      },
    ],
    family_tag: 'deviation',
  },
  {
    code: 'DC',
    rule_type: 'DRAFT_CONSISTENCY',
    title: '正文一致性',
    issue_types: ['consistency_conflict', 'stale_content_risk', 'placeholder_risk', 'section_order_risk', 'missing_requirement', 'missing_evidence'],
    variants: [
      {
        suffix: '主数据一致性核验',
        severity: 'HIGH',
        suggested_action: '对齐项目主数据与正文内容后重检。',
      },
      {
        suffix: '模板复用核验',
        severity: 'MEDIUM',
        suggested_action: '清理旧项目残留与未替换字段。',
      },
      {
        suffix: '章节结构核验',
        severity: 'MEDIUM',
        suggested_action: '调整章节顺序并补齐缺失章节。',
      },
      {
        suffix: '证据闭环核验',
        severity: 'MEDIUM',
        suggested_action: '为正文承诺补齐证据闭环。',
      },
    ],
    family_tag: 'draft',
  },
  {
    code: 'EX',
    rule_type: 'EXPORT_READINESS',
    title: '导出与提交准备',
    issue_types: ['toc_missing', 'signature_slot_missing', 'signature_slot_incomplete', 'section_order_risk', 'placeholder_risk', 'missing_evidence'],
    variants: [
      {
        suffix: '导出前核验',
        severity: 'HIGH',
        suggested_action: '在导出前补齐格式与签署信息。',
      },
      {
        suffix: '投递版式核验',
        severity: 'MEDIUM',
        suggested_action: '复核目录、章节序号和签章页位置。',
      },
      {
        suffix: '附件引用核验',
        severity: 'MEDIUM',
        suggested_action: '补齐引用证据并确认导出包完整性。',
      },
      {
        suffix: '终审兜底',
        severity: 'MEDIUM',
        suggested_action: '导出前执行人工终审确认。',
      },
    ],
    family_tag: 'export',
  },
];

const buildValidationRuleSeed = () => {
  const rows = [];
  for (const family of RULE_FAMILIES) {
    for (let issueIndex = 0; issueIndex < family.issue_types.length; issueIndex += 1) {
      const issueType = family.issue_types[issueIndex];
      for (let variantIndex = 0; variantIndex < family.variants.length; variantIndex += 1) {
        const variant = family.variants[variantIndex];
        const sequence = rows.length + 1;
        const code = `${family.code}-${String(sequence).padStart(3, '0')}`;
        rows.push(normalizeValidationRuleRow({
          rule_name: `${code} ${family.title}${variant.suffix}`,
          rule_type: family.rule_type,
          trigger_condition: `issue_type=${issueType}`,
          check_logic: `当校验结果出现 ${issueType} 时，按 ${family.title} 规则执行 ${variant.suffix}。`,
          severity: variant.severity,
          suggested_action: variant.suggested_action,
          active_flag: 1,
          tags: {
            issue_type: issueType,
            execution_module: 'final_draft_checks',
            scenario_key: `${family.family_tag}_${issueType}_${variantIndex + 1}`,
            source_family: family.family_tag,
          },
        }));
      }
    }
  }
  return rows;
};

const buildMissingValidationRules = ({ existingRules = [], seedRules = buildValidationRuleSeed() } = {}) => {
  const existingNames = new Set(
    (Array.isArray(existingRules) ? existingRules : [])
      .map((item) => normalizeText(item?.rule_name))
      .filter(Boolean)
  );
  return seedRules.filter((item) => !existingNames.has(normalizeText(item.rule_name)));
};

const pickMatchedRuleSummary = (rule) => ({
  id: Number(rule?.id || 0) || 0,
  rule_name: normalizeText(rule?.rule_name),
  rule_type: normalizeStatus(rule?.rule_type),
  severity: normalizeSeverity(rule?.severity),
  suggested_action: normalizeText(rule?.suggested_action),
});

const buildIssueTypeRuleIndex = (rules = []) => {
  const map = new Map();
  for (const item of Array.isArray(rules) ? rules : []) {
    const rule = normalizeValidationRuleRow(item);
    if (rule.active_flag !== 1) continue;
    const issueType = normalizeText(rule.tags.issue_type);
    if (!issueType) continue;
    if (!map.has(issueType)) map.set(issueType, []);
    map.get(issueType).push(rule);
  }
  return map;
};

const decorateIssuesWithRules = ({ issues = [], rules = [] } = {}) => {
  const index = buildIssueTypeRuleIndex(rules);
  return (Array.isArray(issues) ? issues : []).map((issue) => {
    const issueType = normalizeText(issue?.type || issue?.issue_type);
    const matched = (index.get(issueType) || []).map((item) => pickMatchedRuleSummary(item));
    return {
      ...issue,
      matched_rules: matched,
    };
  });
};

const buildRuleExecutionSummary = ({ rules = [], issues = [] } = {}) => {
  const normalizedRules = (Array.isArray(rules) ? rules : []).map((item) => normalizeValidationRuleRow(item));
  const decoratedIssues = Array.isArray(issues) ? issues : [];
  const matchedIds = new Set();
  const unmappedIssueTypes = [];
  let triggeredIssueCount = 0;

  for (const issue of decoratedIssues) {
    const matched = Array.isArray(issue?.matched_rules) ? issue.matched_rules : [];
    if (matched.length > 0) {
      triggeredIssueCount += 1;
      matched.forEach((item) => {
        const id = Number(item?.id || 0) || 0;
        if (id > 0) matchedIds.add(id);
      });
    } else {
      const type = normalizeText(issue?.type || issue?.issue_type);
      if (type) unmappedIssueTypes.push(type);
    }
  }

  return {
    active_rule_count: normalizedRules.filter((item) => item.active_flag === 1).length,
    matched_rule_count: matchedIds.size,
    triggered_issue_count: triggeredIssueCount,
    unmapped_issue_types: uniqueList(unmappedIssueTypes),
  };
};

module.exports = {
  buildValidationRuleSeed,
  normalizeValidationRuleRow,
  buildMissingValidationRules,
  buildIssueTypeRuleIndex,
  decorateIssuesWithRules,
  buildRuleExecutionSummary,
};

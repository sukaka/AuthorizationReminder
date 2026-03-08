const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  const text = trimText(value);
  return text ? [text] : [];
};

const parseJsonObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = trimText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  const text = trimText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseBoolean = (value, fallback = false) => {
  if (value === true || value === false) return value;
  const text = trimText(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', '是'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', '否'].includes(text)) return false;
  return fallback;
};

const normalizeRequirements = (requirements = []) =>
  toArray(requirements)
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const sourceRaw = parseJsonObject(item.source_json);
      const contract = sourceRaw?.clause_contract_v2 && typeof sourceRaw.clause_contract_v2 === 'object'
        ? sourceRaw.clause_contract_v2
        : sourceRaw;
      return {
        id: Number(item.id || 0) || null,
        requirement_type: trimText(item.requirement_type).toUpperCase(),
        title: trimText(item.title),
        requirement_text: trimText(item.requirement_text),
        requirement_code: trimText(item.requirement_code),
        full_score: Number(item.full_score || 0) || 0,
        source_text: trimText(contract.source_text || contract.clause_content),
        response_mode: trimText(contract.response_mode).toUpperCase(),
        need_exact_quote: parseBoolean(contract.need_exact_quote, false),
        need_parameter_compare: parseBoolean(contract.need_parameter_compare, false),
      };
    });

const normalizeSections = (sections = []) =>
  toArray(sections)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      section_title: trimText(item.section_title),
      paragraph_text: trimText(item.paragraph_text || item.content_text),
      requirement_ids: parseJsonArray(item.requirement_ids_json),
      evidence_ids: parseJsonArray(item.evidence_ids_json),
    }));

const normalizeEvidences = (evidences = []) =>
  toArray(evidences)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      evidence_code: trimText(item.evidence_code),
      evidence_type: trimText(item.evidence_type).toUpperCase(),
      title: trimText(item.title),
      evidence_text: trimText(item.evidence_text),
      source_json: parseJsonObject(item.source_json),
    }));

const normalizeParagraphs = (paragraphs = []) =>
  toArray(paragraphs)
    .map((item) => trimText(item))
    .filter(Boolean);

const normalizeTextToken = (value) =>
  trimText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:（）()【】\[\]、，,。.!?？;；]/g, '');

const parseDateLike = (value) => {
  const text = trimText(value);
  if (!text) return null;
  const matched = text.match(/(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/);
  if (!matched) return null;
  const yyyy = Number(matched[1]);
  const mm = Number(matched[2]);
  const dd = Number(matched[3]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const parseAsOfDate = (context = {}) => {
  const candidate = parseDateLike(context.as_of_date);
  if (candidate) return candidate;
  return new Date();
};

const collectTextLines = ({ sections = [], paragraphs = [] }) => {
  const lines = [];
  for (const section of toArray(sections)) {
    const text = `${trimText(section?.section_title)}\n${trimText(section?.paragraph_text)}`;
    for (const line of text.split(/\n+/)) {
      const normalized = trimText(line);
      if (normalized) lines.push(normalized);
    }
  }
  for (const paragraph of toArray(paragraphs)) {
    for (const line of trimText(paragraph).split(/\n+/)) {
      const normalized = trimText(line);
      if (normalized) lines.push(normalized);
    }
  }
  return lines;
};

const extractLabeledValues = (lines = [], labels = []) => {
  const results = [];
  for (const line of toArray(lines)) {
    for (const label of toArray(labels)) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matched = line.match(new RegExp(`${escaped}\\s*[：:]\\s*([^；;，,\\n]+)`));
      if (!matched || !matched[1]) continue;
      const value = trimText(matched[1]);
      if (value) results.push(value);
    }
  }
  return Array.from(new Set(results));
};

const buildConsistencyIssues = ({ lines = [], context = {} }) => {
  const issues = [];
  const fields = [
    {
      field: 'project_name',
      labels: ['项目名称', '项目全称', '项目名'],
      expected: trimText(context.expected_project_name),
      title: '项目名称',
    },
    {
      field: 'project_no',
      labels: ['项目编号', '招标编号', '采购编号', '项目编码'],
      expected: trimText(context.expected_project_no),
      title: '项目编号',
    },
    {
      field: 'duration',
      labels: ['工期', '服务期限', '交付周期', '实施周期'],
      expected: trimText(context.expected_duration),
      title: '工期/周期',
    },
    {
      field: 'contact',
      labels: ['联系人', '项目联系人', '商务联系人'],
      expected: trimText(context.expected_contact),
      title: '联系人',
    },
  ];

  for (const field of fields) {
    const values = extractLabeledValues(lines, field.labels);
    const normalizedValues = Array.from(new Set(values.map((item) => normalizeTextToken(item)).filter(Boolean)));
    if (normalizedValues.length > 1) {
      issues.push(buildIssue({
        type: 'consistency_conflict',
        severity: 'WARN',
        title: `${field.title}前后不一致`,
        message: `${field.title}出现多个版本：${values.join(' | ')}`,
      }));
    }
    if (field.expected && values.length) {
      const expectedToken = normalizeTextToken(field.expected);
      const matched = values.some((value) => {
        const token = normalizeTextToken(value);
        if (!token || !expectedToken) return false;
        return token.includes(expectedToken) || expectedToken.includes(token);
      });
      if (!matched) {
        issues.push(buildIssue({
          type: 'consistency_conflict',
          severity: 'WARN',
          title: `${field.title}与项目主数据不一致`,
          message: `${field.title}主数据=${field.expected}，文档中检测到=${values.join(' | ')}`,
        }));
      }
    }
  }

  const brandValues = extractLabeledValues(lines, ['品牌']);
  if (brandValues.length > 1) {
    issues.push(buildIssue({
      type: 'consistency_conflict',
      severity: 'WARN',
      title: '品牌信息前后不一致',
      message: `检测到多个品牌值：${brandValues.join(' | ')}`,
    }));
  }
  const modelValues = extractLabeledValues(lines, ['型号']);
  if (modelValues.length > 1) {
    issues.push(buildIssue({
      type: 'consistency_conflict',
      severity: 'WARN',
      title: '型号信息前后不一致',
      message: `检测到多个型号值：${modelValues.join(' | ')}`,
    }));
  }

  return issues;
};

const hasSatisfiedToken = (value) => /满足|完全响应|无偏离|符合要求/.test(trimText(value));

const extractRecentYearWindow = (text) => {
  const matched = trimText(text).match(/近\s*([一二三四五六七八九十\d]+)\s*年/);
  if (!matched || !matched[1]) return 0;
  const raw = trimText(matched[1]);
  if (/^\d+$/.test(raw)) return Number(raw);
  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return Number(map[raw] || 0);
};

const extractEvidenceDate = (evidence) => {
  const source = evidence?.source_json && typeof evidence.source_json === 'object' ? evidence.source_json : {};
  const candidates = [
    source.valid_to,
    source.expire_date,
    source.expiry_date,
    source.expired_at,
    source.certificate_valid_to,
    source.id_valid_to,
    source.sign_date,
    source.contract_date,
    source.project_date,
    source.acceptance_date,
    source.completion_date,
    source.performance_date,
    evidence?.evidence_text,
  ];
  for (const candidate of candidates) {
    const parsed = parseDateLike(candidate);
    if (parsed) return parsed;
  }
  return null;
};

const requirementNeedsEvidence = (requirement) =>
  new Set(['QUALIFICATION', 'SCORING', 'BUSINESS', 'TECH_PARAM', 'INVALID_BID']).has(requirement.requirement_type);

const requirementCoveredBySection = (requirement, section) => {
  if (!requirement || !section) return false;
  if (requirement.requirement_code && section.requirement_ids.includes(requirement.requirement_code)) return true;
  const haystack = `${section.section_title}\n${section.paragraph_text}`.toLowerCase();
  const title = requirement.title.toLowerCase();
  const text = requirement.requirement_text.toLowerCase();
  if (title && haystack.includes(title)) return true;
  if (text && haystack.includes(text)) return true;
  return false;
};

const evidenceMatchesRequirement = (requirement, evidence) => {
  if (!requirement || !evidence) return false;
  const haystack = `${evidence.title}\n${evidence.evidence_text}`.toLowerCase();
  const title = requirement.title.toLowerCase();
  const text = requirement.requirement_text.toLowerCase();
  if (title && haystack.includes(title)) return true;
  if (text && haystack.includes(text)) return true;
  return false;
};

const hasParameterCompareTokens = (value) => {
  const text = trimText(value);
  if (!text) return false;
  return /满足|不满足|偏离|响应|参数|对比|compare/i.test(text);
};

const buildIssue = ({
  type,
  severity,
  title,
  message,
  requirement = null,
  section = null,
  paragraph = '',
}) => ({
  type: trimText(type),
  severity: trimText(severity).toUpperCase() || 'WARN',
  title: trimText(title),
  message: trimText(message),
  requirement_code: trimText(requirement?.requirement_code),
  requirement_title: trimText(requirement?.title),
  requirement_type: trimText(requirement?.requirement_type),
  section_title: trimText(section?.section_title),
  paragraph_text: trimText(paragraph || section?.paragraph_text),
});

const buildCheckSummary = (issues = []) => {
  const rows = toArray(issues);
  const fatalCount = rows.filter((item) => trimText(item?.severity).toUpperCase() === 'FATAL').length;
  const warnCount = rows.filter((item) => trimText(item?.severity).toUpperCase() === 'WARN').length;
  return {
    issue_count: rows.length,
    fatal_count: fatalCount,
    warn_count: warnCount,
    pass: fatalCount === 0,
  };
};

const toChineseSectionNumber = (value) => {
  const text = trimText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const digits = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (text === '十') return 10;
  if (text.startsWith('十')) return 10 + (digits[text.slice(1)] || 0);
  if (text.endsWith('十')) return (digits[text[0]] || 0) * 10;
  if (text.includes('十')) {
    const [left, right] = text.split('十');
    return (digits[left] || 0) * 10 + (digits[right] || 0);
  }
  return digits[text] ?? null;
};

const parseSectionHeading = (paragraph) => {
  const text = trimText(paragraph);
  const matched = text.match(/^第([一二三四五六七八九十\d]+)章[\s\u3000]*(.+)$/);
  if (!matched) return null;
  return {
    order: toChineseSectionNumber(matched[1]),
    title: trimText(matched[2]),
    raw: text,
  };
};

const runStructuredChecks = ({
  requirements = [],
  sections = [],
  evidences = [],
  paragraphs = [],
  context = {},
}) => {
  const normalizedRequirements = normalizeRequirements(requirements);
  const normalizedSections = normalizeSections(sections);
  const normalizedEvidences = normalizeEvidences(evidences);
  const normalizedParagraphs = normalizeParagraphs(paragraphs);
  const textLines = collectTextLines({ sections: normalizedSections, paragraphs: normalizedParagraphs });
  const issues = [];

  for (const requirement of normalizedRequirements) {
    const coveredSections = normalizedSections.filter((section) => requirementCoveredBySection(requirement, section));
    if (coveredSections.length === 0) {
      issues.push(buildIssue({
        type: 'missing_requirement',
        severity: 'FATAL',
        title: `缺少要求覆盖：${requirement.title || requirement.requirement_code || '未命名要求'}`,
        message: '当前初稿未找到与该要求对应的章节或段落。',
        requirement,
      }));
      continue;
    }

    if (requirementNeedsEvidence(requirement)) {
      const sectionEvidenceIds = coveredSections.flatMap((section) => section.evidence_ids).filter(Boolean);
      const matchedEvidences = normalizedEvidences.filter((evidence) => evidenceMatchesRequirement(requirement, evidence));
      if (sectionEvidenceIds.length === 0 && matchedEvidences.length === 0) {
        issues.push(buildIssue({
          type: 'missing_evidence',
          severity: 'WARN',
          title: `缺少证据绑定：${requirement.title || requirement.requirement_code || '未命名要求'}`,
          message: '已找到对应章节，但尚未绑定证明材料或证据快照。',
          requirement,
          section: coveredSections[0],
        }));
      }

      const explicitSatisfied = coveredSections.some((section) => hasSatisfiedToken(section.paragraph_text));
      if (explicitSatisfied && sectionEvidenceIds.length === 0 && matchedEvidences.length === 0) {
        issues.push(buildIssue({
          type: 'satisfied_without_evidence',
          severity: 'WARN',
          title: `存在“满足”表述但缺少证据：${requirement.title || requirement.requirement_code || '未命名要求'}`,
          message: '章节出现“满足/无偏离”等承诺表达，但未绑定任何证据材料。',
          requirement,
          section: coveredSections[0],
        }));
      }
    }

    if (requirement.requirement_type === 'SCORING' && Number(requirement.full_score || 0) > 0) {
      const sectionEvidenceIds = coveredSections.flatMap((section) => section.evidence_ids).filter(Boolean);
      if (sectionEvidenceIds.length === 0) {
        issues.push(buildIssue({
          type: 'score_gap',
          severity: 'WARN',
          title: `评分覆盖偏弱：${requirement.title || requirement.requirement_code || '未命名评分项'}`,
          message: '评分项已有章节覆盖，但缺少可审计证据，当前得分支撑偏弱。',
          requirement,
          section: coveredSections[0],
        }));
      }
    }

    if (requirement.need_exact_quote && requirement.source_text) {
      const expected = requirement.source_text.toLowerCase();
      const hasQuoted = coveredSections.some((section) =>
        `${section.section_title}\n${section.paragraph_text}`.toLowerCase().includes(expected)
      );
      if (!hasQuoted) {
        issues.push(buildIssue({
          type: 'exact_quote_missing',
          severity: 'WARN',
          title: `未按原文引用：${requirement.title || requirement.requirement_code || '未命名条款'}`,
          message: '该条款要求按原文引用，但当前章节未检测到对应原文内容。',
          requirement,
          section: coveredSections[0],
        }));
      }
    }

    if (requirement.need_parameter_compare || requirement.response_mode === 'PARAM_COMPARE') {
      const hasCompare = coveredSections.some((section) =>
        hasParameterCompareTokens(`${section.section_title}\n${section.paragraph_text}`)
      );
      if (!hasCompare) {
        issues.push(buildIssue({
          type: 'parameter_compare_missing',
          severity: 'WARN',
          title: `缺少参数对比表达：${requirement.title || requirement.requirement_code || '未命名参数项'}`,
          message: '该条款要求参数比对式响应，但当前章节未检测到“满足/偏离/响应”等比对表达。',
          requirement,
          section: coveredSections[0],
        }));
      }
    }
  }

  for (const paragraph of normalizedParagraphs) {
    if (!/\{\{[^}]+\}\}/.test(paragraph)) continue;
    issues.push(buildIssue({
      type: 'placeholder_risk',
      severity: 'WARN',
      title: '检测到模板占位符',
      message: '成稿中仍保留模板占位符，请在提交前完成替换。',
      paragraph,
    }));
  }

  const staleTokens = ['待完善项目', '待完善客户', '上一项目', '某项目', '示例项目', '模板示例', 'XXX项目'];
  const staleHit = textLines.find((line) => staleTokens.some((token) => line.includes(token)));
  if (staleHit) {
    issues.push(buildIssue({
      type: 'stale_content_risk',
      severity: 'WARN',
      title: '检测到疑似复用未替换内容',
      message: `检测到疑似模板残留文本：${staleHit.slice(0, 120)}`,
      paragraph: staleHit,
    }));
  }

  issues.push(...buildConsistencyIssues({ lines: textLines, context }));

  const asOfDate = parseAsOfDate(context);
  const asOfMs = asOfDate.getTime();
  for (const evidence of normalizedEvidences) {
    if (!['QUALIFICATION', 'ATTACHMENT'].includes(trimText(evidence.evidence_type).toUpperCase())) continue;
    const validTo = extractEvidenceDate(evidence);
    if (!validTo) continue;
    if (validTo.getTime() < asOfMs) {
      issues.push(buildIssue({
        type: 'expired_evidence',
        severity: 'WARN',
        title: `证据可能已过期：${evidence.title || evidence.evidence_code || '未命名证据'}`,
        message: `检测到证据有效期早于校验时间（${validTo.toISOString().slice(0, 10)} < ${asOfDate.toISOString().slice(0, 10)}）。`,
      }));
    }
  }

  for (const requirement of normalizedRequirements) {
    const years = extractRecentYearWindow(requirement.requirement_text || requirement.title);
    if (years <= 0) continue;
    const requirementKey = trimText(requirement.requirement_code);
    const linkedEvidenceIds = normalizedSections
      .filter((section) => requirementCoveredBySection(requirement, section))
      .flatMap((section) => section.evidence_ids)
      .map((item) => trimText(item))
      .filter(Boolean);
    const linkedSet = new Set(linkedEvidenceIds);
    const matchedPerformanceEvidences = normalizedEvidences.filter((evidence) => {
      if (trimText(evidence.evidence_type).toUpperCase() !== 'PERFORMANCE') return false;
      if (linkedSet.size > 0) return linkedSet.has(trimText(evidence.evidence_code));
      if (!requirementKey) return evidenceMatchesRequirement(requirement, evidence);
      return evidenceMatchesRequirement(requirement, evidence);
    });
    if (!matchedPerformanceEvidences.length) continue;

    const cutoff = new Date(asOfDate);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    const outdated = matchedPerformanceEvidences.find((evidence) => {
      const date = extractEvidenceDate(evidence);
      if (!date) return false;
      return date.getTime() < cutoff.getTime();
    });
    if (outdated) {
      issues.push(buildIssue({
        type: 'performance_out_of_range',
        severity: 'WARN',
        title: `业绩时间范围不满足：${requirement.title || requirement.requirement_code || '未命名要求'}`,
        message: `条款要求近${years}年，检测到业绩证据时间早于${cutoff.toISOString().slice(0, 10)}。`,
        requirement,
      }));
    }
  }

  return {
    issues,
    summary: buildCheckSummary(issues),
  };
};

const runDocxChecks = ({ paragraphs = [] }) => {
  const normalizedParagraphs = normalizeParagraphs(paragraphs);
  const issues = [];

  for (const paragraph of normalizedParagraphs) {
    if (/\{\{[^}]+\}\}/.test(paragraph)) {
      issues.push(buildIssue({
        type: 'placeholder_risk',
        severity: 'WARN',
        title: '检测到模板占位符',
        message: 'Word 成稿中仍保留模板占位符，请在提交前完成替换。',
        paragraph,
      }));
    }
  }

  const headings = normalizedParagraphs
    .map(parseSectionHeading)
    .filter(Boolean);
  for (let i = 1; i < headings.length; i += 1) {
    const prev = headings[i - 1];
    const current = headings[i];
    if (Number.isFinite(prev.order) && Number.isFinite(current.order) && current.order < prev.order) {
      issues.push(buildIssue({
        type: 'section_order_risk',
        severity: 'WARN',
        title: '章节顺序异常',
        message: `检测到章节顺序倒退：${current.raw} 出现在 ${prev.raw} 之后。`,
        paragraph: current.raw,
      }));
      break;
    }
  }

  const hasToc = normalizedParagraphs.some((paragraph) => /目\s*录|目录/.test(paragraph));
  if (!hasToc) {
    issues.push(buildIssue({
      type: 'toc_missing',
      severity: 'WARN',
      title: '缺少目录',
      message: '当前成稿未检测到目录章节，请确认是否已生成目录。',
    }));
  }

  const hasSignatureSlot = normalizedParagraphs.some((paragraph) => /法定代表人|授权代表|签字|签章|盖章/.test(paragraph));
  if (!hasSignatureSlot) {
    issues.push(buildIssue({
      type: 'signature_slot_missing',
      severity: 'WARN',
      title: '缺少签署位',
      message: '当前成稿未检测到法定代表人/授权代表签字盖章位置。',
    }));
  }

  return {
    issues,
    summary: buildCheckSummary(issues),
  };
};

const mergeCheckResults = (...results) => {
  const issues = results.flatMap((result) => toArray(result?.issues));
  return {
    issues,
    summary: buildCheckSummary(issues),
  };
};

module.exports = {
  runStructuredChecks,
  buildCheckSummary,
  runDocxChecks,
  mergeCheckResults,
};

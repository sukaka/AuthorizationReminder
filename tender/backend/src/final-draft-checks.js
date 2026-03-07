const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  const text = trimText(value);
  return text ? [text] : [];
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

const normalizeRequirements = (requirements = []) =>
  toArray(requirements)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: Number(item.id || 0) || null,
      requirement_type: trimText(item.requirement_type).toUpperCase(),
      title: trimText(item.title),
      requirement_text: trimText(item.requirement_text),
      requirement_code: trimText(item.requirement_code),
      full_score: Number(item.full_score || 0) || 0,
    }));

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
    }));

const normalizeParagraphs = (paragraphs = []) =>
  toArray(paragraphs)
    .map((item) => trimText(item))
    .filter(Boolean);

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
}) => {
  const normalizedRequirements = normalizeRequirements(requirements);
  const normalizedSections = normalizeSections(sections);
  const normalizedEvidences = normalizeEvidences(evidences);
  const normalizedParagraphs = normalizeParagraphs(paragraphs);
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

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
      requirement_code: trimText(item.requirement_code),
      full_score: Number(item.full_score || 0) || 0,
      requirement_text: trimText(item.requirement_text),
    }))
    .filter((item) => item.requirement_type === 'SCORING');

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
      title: trimText(item.title),
      evidence_text: trimText(item.evidence_text),
    }));

const sectionCoversRequirement = (requirement, section) => {
  if (!requirement || !section) return false;
  if (requirement.requirement_code && section.requirement_ids.includes(requirement.requirement_code)) return true;
  const haystack = `${section.section_title}\n${section.paragraph_text}`.toLowerCase();
  const title = requirement.title.toLowerCase();
  const text = requirement.requirement_text.toLowerCase();
  return (!!title && haystack.includes(title)) || (!!text && haystack.includes(text));
};

const buildScoreCoverageMatrix = ({
  requirements = [],
  sections = [],
  evidences = [],
}) => {
  const normalizedRequirements = normalizeRequirements(requirements);
  const normalizedSections = normalizeSections(sections);
  const normalizedEvidences = normalizeEvidences(evidences);

  return normalizedRequirements.map((requirement) => {
    const matchedSections = normalizedSections.filter((section) => sectionCoversRequirement(requirement, section));
    const boundEvidenceIds = Array.from(new Set(matchedSections.flatMap((section) => section.evidence_ids).filter(Boolean)));
    const matchedEvidenceRows = boundEvidenceIds.length
      ? normalizedEvidences.filter((evidence) => boundEvidenceIds.includes(evidence.evidence_code))
      : [];

    let coverageStatus = 'STRONG';
    let optimizationNeeded = 0;
    let optimizationReason = '';
    if (!matchedSections.length) {
      coverageStatus = 'NONE';
      optimizationNeeded = 1;
      optimizationReason = '评分项尚未在初稿中形成对应章节覆盖。';
    } else if (!matchedEvidenceRows.length) {
      coverageStatus = 'WEAK';
      optimizationNeeded = 1;
      optimizationReason = '评分项已有文本覆盖，但缺少可审计证据支撑。';
    }

    return {
      score_item_id: requirement.requirement_code || `REQ-SCORING-${requirement.id || 'UNKNOWN'}`,
      requirement_id: requirement.id,
      requirement_code: requirement.requirement_code,
      title: requirement.title,
      full_score: requirement.full_score,
      coverage_status: coverageStatus,
      optimization_needed_flag: optimizationNeeded,
      optimization_reason: optimizationReason,
      target_section_title: matchedSections[0]?.section_title || '',
      bound_evidence_ids_json: JSON.stringify(boundEvidenceIds),
    };
  });
};

const pickOptimizationCandidates = (rows = []) =>
  toArray(rows).filter((item) => Number(item?.optimization_needed_flag || 0) === 1);

const normalizeOptimizationResponse = (payload = {}) => {
  const sourceItems = Array.isArray(payload?.items) ? payload.items : [];
  return {
    items: sourceItems
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        score_item_id: trimText(item.score_item_id),
        suggestion_title: trimText(item.suggestion_title),
        suggestion_text: trimText(item.suggestion_text),
        evidence_ids: toArray(item.evidence_ids).map((evidenceId) => trimText(evidenceId)).filter(Boolean),
      })),
  };
};

const buildScoreOptimizationPrompt = ({ candidates = [] }) => {
  const rows = pickOptimizationCandidates(candidates);
  const lines = rows.map((item, index) =>
    `${index + 1}. ${trimText(item.title) || trimText(item.score_item_id)}｜分值=${Number(item.full_score || 0)}｜覆盖=${trimText(item.coverage_status)}｜原因=${trimText(item.optimization_reason)}`
  );
  return [
    '请针对以下评分项给出结构化补强建议，仅输出 JSON：',
    '{"items":[{"score_item_id":"","suggestion_title":"","suggestion_text":"","evidence_ids":[]}]}',
    ...lines,
  ].join('\n');
};

module.exports = {
  buildScoreCoverageMatrix,
  pickOptimizationCandidates,
  normalizeOptimizationResponse,
  buildScoreOptimizationPrompt,
};

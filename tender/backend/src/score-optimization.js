const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  const text = trimText(value);
  return text ? [text] : [];
};

const toJson = (value) => JSON.stringify(value ?? null);

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

const normalizeProjectType = (value) => trimText(value).toUpperCase();

const normalizeIndustryType = (value) => trimText(value);

const normalizeWonProjects = (projects = []) =>
  toArray(projects)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: Number(item.id || 0) || 0,
      project_type: normalizeProjectType(item.project_type),
      industry_type: normalizeIndustryType(item.industry_type),
      result_status: trimText(item.result_status).toUpperCase(),
    }))
    .filter((item) => item.id > 0 && item.result_status === 'WON');

const normalizeKbScoreItems = (items = []) =>
  toArray(items)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: Number(item.id || 0) || 0,
      kb_project_id: Number(item.kb_project_id || 0) || 0,
      item_name: trimText(item.item_name),
      full_score: Number(item.full_score || 0) || 0,
      priority_level: trimText(item.priority_level).toUpperCase() || 'LOW',
      recommended_response_points: parseJsonArray(item.recommended_response_points),
    }))
    .filter((item) => item.id > 0 && item.kb_project_id > 0 && item.item_name);

const normalizeKbSectionAssets = (items = []) =>
  toArray(items)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: Number(item.id || 0) || 0,
      kb_project_id: Number(item.kb_project_id || 0) || 0,
      section_name: trimText(item.section_name),
      applicable_scene: trimText(item.applicable_scene).toUpperCase(),
      source_score_item_id: Number(item.source_score_item_id || 0) || 0,
    }))
    .filter((item) => item.id > 0 && item.kb_project_id > 0 && item.section_name);

const uniqueTexts = (values = []) => {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = trimText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
};

const normalizeMatchToken = (value) =>
  trimText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:（）()【】\[\]、，,。.!?？;；\-_/]/g, '');

const matchTextByContainment = (left, right) => {
  const a = normalizeMatchToken(left);
  const b = normalizeMatchToken(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
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
        source: trimText(item.source).toUpperCase() || 'RULE',
        strategy_profile_key: trimText(item.strategy_profile_key),
        strategy_hit_points: uniqueTexts(item.strategy_hit_points),
        strategy_section_patterns: uniqueTexts(item.strategy_section_patterns),
        strategy_source_project_ids: toArray(item.strategy_source_project_ids)
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
        strategy_source_score_item_ids: toArray(item.strategy_source_score_item_ids)
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      })),
  };
};

const normalizeDraftSections = (sections = []) =>
  toArray(sections)
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      section_title: trimText(item.section_title) || '评分专项响应',
      paragraph_no: Number(item.paragraph_no || index + 1) || (index + 1),
      paragraph_text: trimText(item.paragraph_text || item.content_text),
      template_slot: trimText(item.template_slot),
      requirement_ids_json: toJson(parseJsonArray(item.requirement_ids_json)),
      evidence_ids_json: toJson(parseJsonArray(item.evidence_ids_json)),
      score_item_ids_json: toJson(parseJsonArray(item.score_item_ids_json)),
    }));

const appendUnique = (list = [], value) => {
  const token = trimText(value);
  if (!token) return list;
  const exists = toArray(list).some((item) => trimText(item) === token);
  if (exists) return list;
  return [...toArray(list), token];
};

const findTargetSectionIndex = ({ sections = [], scoreItemId = '', suggestionText = '' }) => {
  const token = trimText(scoreItemId);
  if (!token) return -1;
  const text = trimText(suggestionText).toLowerCase();
  let matched = sections.findIndex((section) => parseJsonArray(section.requirement_ids_json).includes(token));
  if (matched >= 0) return matched;
  matched = sections.findIndex((section) => parseJsonArray(section.score_item_ids_json).includes(token));
  if (matched >= 0) return matched;
  if (text) {
    matched = sections.findIndex((section) =>
      trimText(section.section_title).includes('评标')
      || trimText(section.section_title).includes('评分')
      || trimText(section.paragraph_text).toLowerCase().includes(text.slice(0, 12))
    );
  }
  return matched;
};

const applyOptimizationToSections = ({ sections = [], items = [] }) => {
  const normalizedSections = normalizeDraftSections(sections);
  const normalizedItems = normalizeOptimizationResponse({ items }).items;
  const appliedRecords = [];

  for (const item of normalizedItems) {
    const scoreItemId = trimText(item.score_item_id);
    const suggestionTitle = trimText(item.suggestion_title) || `补强${scoreItemId || '评分项'}`;
    const suggestionText = trimText(item.suggestion_text);
    if (!suggestionText) continue;

    let targetIndex = findTargetSectionIndex({
      sections: normalizedSections,
      scoreItemId,
      suggestionText,
    });
    if (targetIndex < 0) {
      normalizedSections.push({
        section_title: '评分专项响应',
        paragraph_no: normalizedSections.length + 1,
        paragraph_text: '',
        template_slot: '',
        requirement_ids_json: '[]',
        evidence_ids_json: '[]',
        score_item_ids_json: '[]',
      });
      targetIndex = normalizedSections.length - 1;
    }

    const section = normalizedSections[targetIndex];
    const beforeText = trimText(section.paragraph_text);
    const appendBlock = `【评分补强】${suggestionTitle}\n${suggestionText}`;
    const afterText = beforeText ? `${beforeText}\n${appendBlock}` : appendBlock;

    const requirementIds = appendUnique(parseJsonArray(section.requirement_ids_json), scoreItemId);
    const scoreItemIds = appendUnique(parseJsonArray(section.score_item_ids_json), scoreItemId);
    let evidenceIds = parseJsonArray(section.evidence_ids_json);
    for (const evidenceId of toArray(item.evidence_ids)) {
      evidenceIds = appendUnique(evidenceIds, evidenceId);
    }

    section.paragraph_text = afterText;
    section.requirement_ids_json = toJson(requirementIds);
    section.score_item_ids_json = toJson(scoreItemIds);
    section.evidence_ids_json = toJson(evidenceIds);

    appliedRecords.push({
      score_item_id: scoreItemId,
      suggestion_title: suggestionTitle,
      suggestion_text: suggestionText,
      section_title: trimText(section.section_title),
      evidence_ids: toArray(item.evidence_ids).map((id) => trimText(id)).filter(Boolean),
      before_text: beforeText,
      after_text: afterText,
      source: trimText(item.source).toUpperCase() || 'RULE',
      strategy_profile_key: trimText(item.strategy_profile_key),
      strategy_hit_points: uniqueTexts(item.strategy_hit_points),
      strategy_section_patterns: uniqueTexts(item.strategy_section_patterns),
      strategy_source_project_ids: toArray(item.strategy_source_project_ids)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
      strategy_source_score_item_ids: toArray(item.strategy_source_score_item_ids)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
      status: 'APPLIED',
    });
  }

  return {
    sections: normalizedSections,
    applied_count: appliedRecords.length,
    applied_records: appliedRecords,
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

const buildWinningStrategyProfiles = ({
  kbProjects = [],
  kbScoreItems = [],
  kbSectionAssets = [],
} = {}) => {
  const wonProjects = normalizeWonProjects(kbProjects);
  const scoreItems = normalizeKbScoreItems(kbScoreItems);
  const sectionAssets = normalizeKbSectionAssets(kbSectionAssets);
  const projectMap = new Map(wonProjects.map((item) => [item.id, item]));
  const groups = new Map();

  const ensureGroup = (projectType, industryType) => {
    const key = `${projectType || 'ALL'}|${industryType || 'ALL'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        profile_key: key,
        project_type: projectType || 'ALL',
        industry_type: industryType || 'ALL',
        source_project_ids: [],
        item_map: new Map(),
      });
    }
    return groups.get(key);
  };

  for (const project of wonProjects) {
    const exactGroup = ensureGroup(project.project_type || 'ALL', project.industry_type || 'ALL');
    const typeGroup = ensureGroup(project.project_type || 'ALL', 'ALL');
    const globalGroup = ensureGroup('ALL', 'ALL');
    for (const group of [exactGroup, typeGroup, globalGroup]) {
      if (!group.source_project_ids.includes(project.id)) group.source_project_ids.push(project.id);
    }
  }

  for (const item of scoreItems) {
    const project = projectMap.get(item.kb_project_id);
    if (!project) continue;
    const relatedSections = sectionAssets
      .filter((section) => section.kb_project_id === item.kb_project_id)
      .filter((section) =>
        Number(section.source_score_item_id || 0) === item.id
        || matchTextByContainment(section.section_name, item.item_name)
      );
    const targetGroups = [
      groups.get(`${project.project_type || 'ALL'}|${project.industry_type || 'ALL'}`),
      groups.get(`${project.project_type || 'ALL'}|ALL`),
      groups.get('ALL|ALL'),
    ].filter(Boolean);

    for (const group of targetGroups) {
      const strategyKey = normalizeMatchToken(item.item_name) || item.item_name;
      if (!group.item_map.has(strategyKey)) {
        group.item_map.set(strategyKey, {
          item_name: item.item_name,
          learned_points: [],
          learned_sections: [],
          source_project_ids: [],
          source_score_item_ids: [],
          total_score: 0,
          priority_level: item.priority_level || 'LOW',
        });
      }
      const record = group.item_map.get(strategyKey);
      record.learned_points = uniqueTexts([
        ...record.learned_points,
        ...item.recommended_response_points,
      ]).slice(0, 8);
      record.learned_sections = uniqueTexts([
        ...record.learned_sections,
        ...relatedSections.map((section) => section.section_name),
      ]).slice(0, 6);
      if (!record.source_project_ids.includes(item.kb_project_id)) record.source_project_ids.push(item.kb_project_id);
      if (!record.source_score_item_ids.includes(item.id)) record.source_score_item_ids.push(item.id);
      record.total_score += Number(item.full_score || 0) || 0;
      if (item.priority_level === 'HIGH') record.priority_level = 'HIGH';
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      profile_key: group.profile_key,
      project_type: group.project_type,
      industry_type: group.industry_type,
      won_project_count: group.source_project_ids.length,
      source_project_ids: group.source_project_ids.sort((a, b) => a - b),
      item_profiles: Array.from(group.item_map.values())
        .sort((a, b) => b.total_score - a.total_score || b.source_project_ids.length - a.source_project_ids.length)
        .map((item) => ({
          ...item,
          learned_points: uniqueTexts(item.learned_points).slice(0, 5),
          learned_sections: uniqueTexts(item.learned_sections).slice(0, 4),
          source_project_ids: item.source_project_ids.sort((a, b) => a - b),
          source_score_item_ids: item.source_score_item_ids.sort((a, b) => a - b),
        })),
    }))
    .filter((item) => item.won_project_count > 0 && item.item_profiles.length > 0)
    .sort((a, b) => b.won_project_count - a.won_project_count || b.item_profiles.length - a.item_profiles.length);
};

const pickWinningStrategyProfile = ({
  profiles = [],
  projectType = '',
  industryType = '',
} = {}) => {
  const normalizedProjectType = normalizeProjectType(projectType) || 'ALL';
  const normalizedIndustryType = normalizeIndustryType(industryType) || 'ALL';
  const rows = Array.isArray(profiles) ? profiles : [];
  return rows.find((item) => item.profile_key === `${normalizedProjectType}|${normalizedIndustryType}`)
    || rows.find((item) => item.profile_key === `${normalizedProjectType}|ALL`)
    || rows.find((item) => item.profile_key === 'ALL|ALL')
    || null;
};

const applyWinningStrategyToSuggestions = ({
  items = [],
  profile = null,
} = {}) => {
  const normalizedItems = normalizeOptimizationResponse({ items }).items;
  if (!profile || !Array.isArray(profile.item_profiles) || !profile.item_profiles.length) {
    return {
      items: normalizedItems,
      matched_count: 0,
      profile: null,
    };
  }

  let matchedCount = 0;
  const nextItems = normalizedItems.map((item) => {
    const matchedProfile = profile.item_profiles.find((strategy) =>
      matchTextByContainment(item.suggestion_title, strategy.item_name)
      || matchTextByContainment(item.suggestion_text, strategy.item_name)
    );
    if (!matchedProfile) return item;
    matchedCount += 1;
    const learnedPoints = uniqueTexts(matchedProfile.learned_points).slice(0, 3);
    const learnedSections = uniqueTexts(matchedProfile.learned_sections).slice(0, 2);
    const learnedDirective = [
      learnedPoints.length ? `优先体现${learnedPoints.join('、')}` : '',
      learnedSections.length ? `建议落位章节：${learnedSections.join('、')}` : '',
    ].filter(Boolean).join('；');

    return {
      ...item,
      suggestion_text: `${trimText(item.suggestion_text)}\n历史中标策略：${learnedDirective || '优先补齐高分响应点与证据闭环。'}`.trim(),
      strategy_profile_key: trimText(profile.profile_key),
      strategy_hit_points: learnedPoints,
      strategy_section_patterns: learnedSections,
      strategy_source_project_ids: matchedProfile.source_project_ids,
      strategy_source_score_item_ids: matchedProfile.source_score_item_ids,
    };
  });

  return {
    items: nextItems,
    matched_count: matchedCount,
    profile: matchedCount > 0 ? {
      profile_key: trimText(profile.profile_key),
      won_project_count: Number(profile.won_project_count || 0),
      source_project_ids: toArray(profile.source_project_ids)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    } : null,
  };
};

module.exports = {
  buildScoreCoverageMatrix,
  pickOptimizationCandidates,
  normalizeOptimizationResponse,
  buildScoreOptimizationPrompt,
  applyOptimizationToSections,
  buildWinningStrategyProfiles,
  pickWinningStrategyProfile,
  applyWinningStrategyToSuggestions,
};

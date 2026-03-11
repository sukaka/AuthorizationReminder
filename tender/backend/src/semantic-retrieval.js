const normalizeText = (value) => String(value ?? '').trim();

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const clamp01 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
};

const clamp = (value, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
};

const unique = (items = []) => Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));
const FEEDBACK_MATCH_STATUS = new Set(['CONFIRMED', 'REPLACED', 'IGNORED']);

const tokenize = (value) => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return [];
  const chunks = [];
  const regex = /[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/gi;
  let match = regex.exec(text);
  while (match) {
    const token = match[0];
    chunks.push(token);
    if (/^[\u4e00-\u9fa5]+$/u.test(token) && token.length > 2) {
      for (let i = 0; i < token.length - 1; i += 1) {
        chunks.push(token.slice(i, i + 2));
      }
    }
    match = regex.exec(text);
  }
  return unique(chunks);
};

const buildBigrams = (value) => {
  const compact = normalizeText(value).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '').toLowerCase();
  if (compact.length < 2) return [];
  const list = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    list.push(compact.slice(i, i + 2));
  }
  return unique(list);
};

const overlapScore = (left = [], right = []) => {
  const a = unique(left);
  const b = unique(right);
  if (!a.length || !b.length) return 0;
  const bSet = new Set(b);
  const hitCount = a.filter((item) => bSet.has(item)).length;
  return clamp01(hitCount / Math.max(a.length, b.length));
};

const normalizeTags = (value) => unique(parseJsonArray(value).map((item) => normalizeText(item)));

const toQualityScore = (value, fallback = 0.7) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return clamp01(fallback);
  if (num > 1) return clamp01(num / 100);
  return clamp01(num);
};

const toFreshnessScore = (value) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) return numeric;
  const ts = new Date(String(value || '')).getTime();
  if (!Number.isFinite(ts)) return 0.5;
  const days = (Date.now() - ts) / (24 * 60 * 60 * 1000);
  if (days <= 30) return 1;
  if (days <= 90) return 0.85;
  if (days <= 180) return 0.7;
  if (days <= 365) return 0.55;
  return 0.4;
};

const inferAssetChunkType = (assetType, text = '') => {
  const normalized = normalizeText(assetType).toUpperCase();
  const source = normalizeText(text);
  if (normalized === 'QUALIFICATION' || normalized === 'BUSINESS_LICENSE' || /资质|证书|授权|许可/u.test(source)) return 'QUALIFICATION';
  if (normalized === 'CONTRACT' || /案例|业绩|合同/u.test(source)) return 'CASE_SUMMARY';
  if (/项目经理|工程师|人员|团队/u.test(source)) return 'PERSONNEL_PROFILE';
  if (/参数|规格|性能|型号/u.test(source)) return 'PRODUCT_SPEC';
  return 'GENERIC_ASSET';
};

const buildProjectAssetChunks = (projectAssets = []) =>
  (Array.isArray(projectAssets) ? projectAssets : [])
    .map((asset) => {
      const title = normalizeText(asset?.original_file_name);
      const chunkText = normalizeText(asset?.ocr_text);
      const tags = normalizeTags(asset?.tags_json);
      const chunkType = inferAssetChunkType(asset?.asset_type, `${title} ${chunkText}`);
      if (!title && !chunkText) return null;
      return {
        chunk_id: `asset:${Number(asset?.id || 0)}`,
        asset_id: Number(asset?.id || 0) || null,
        asset_type: normalizeText(asset?.asset_type).toUpperCase() || 'OTHER',
        source_table: 'tender_assets',
        source_id: Number(asset?.id || 0) || 0,
        chunk_type: chunkType,
        title,
        chunk_text: chunkText || title,
        tags,
        quality_score: 0.85,
        freshness_score: toFreshnessScore(asset?.updated_at || asset?.created_at),
        review_required: ['QUALIFICATION', 'CASE_SUMMARY', 'PERSONNEL_PROFILE'].includes(chunkType),
      };
    })
    .filter(Boolean);

const buildKnowledgeBaseChunks = ({
  kbChunks = [],
  kbSectionAssets = [],
  kbProjectCases = [],
  kbProductSpecs = [],
  kbQualifications = [],
  kbPersonnelAssets = [],
} = {}) => {
  const normalizedKbChunks = (Array.isArray(kbChunks) ? kbChunks : []).map((row) => ({
    chunk_id: `kb_chunk:${Number(row?.id || 0)}`,
    asset_id: null,
    asset_type: normalizeText(row?.asset_type).toUpperCase() || 'KB_CHUNK',
    source_table: 'kb_asset_chunks',
    source_id: Number(row?.id || 0) || 0,
    chunk_type: normalizeText(row?.chunk_type).toUpperCase() || 'SECTION_FRAGMENT',
    title: normalizeText(row?.section_name || row?.sub_section_name || row?.asset_type || '知识库片段'),
    chunk_text: normalizeText(row?.chunk_text),
    tags: normalizeTags(row?.tags_json),
    quality_score: toQualityScore(row?.quality_score, 0.8),
    freshness_score: toFreshnessScore(row?.updated_at || row?.created_at),
    review_required: ['QUALIFICATION', 'CASE_SUMMARY', 'PERSONNEL_PROFILE'].includes(normalizeText(row?.chunk_type).toUpperCase()),
  })).filter((item) => item.chunk_text);

  const sectionChunks = (Array.isArray(kbSectionAssets) ? kbSectionAssets : []).map((row) => ({
    chunk_id: `kb_section:${Number(row?.id || 0)}`,
    asset_id: null,
    asset_type: 'SECTION_ASSET',
    source_table: 'kb_section_assets',
    source_id: Number(row?.id || 0) || 0,
    chunk_type: 'SECTION_FRAGMENT',
    title: normalizeText([row?.section_name, row?.sub_section_name].filter(Boolean).join(' / ')),
    chunk_text: normalizeText(row?.content),
    tags: normalizeTags(row?.tags_json),
    quality_score: toQualityScore(row?.quality_score, 0.85),
    freshness_score: toFreshnessScore(row?.updated_at || row?.created_at),
    review_required: false,
  })).filter((item) => item.chunk_text);

  const caseChunks = (Array.isArray(kbProjectCases) ? kbProjectCases : []).map((row) => ({
    chunk_id: `kb_case:${Number(row?.id || 0)}`,
    asset_id: null,
    asset_type: 'PROJECT_CASE',
    source_table: 'kb_project_cases',
    source_id: Number(row?.id || 0) || 0,
    chunk_type: 'CASE_SUMMARY',
    title: normalizeText(row?.case_name),
    chunk_text: normalizeText([row?.summary, row?.core_products].filter(Boolean).join(' ')),
    tags: unique([
      ...normalizeTags(row?.tags_json),
      normalizeText(row?.industry_type),
      normalizeText(row?.project_type),
    ]),
    quality_score: toQualityScore(row?.quality_score, 0.8),
    freshness_score: toFreshnessScore(row?.updated_at || row?.created_at || row?.sign_date),
    review_required: true,
  })).filter((item) => item.title || item.chunk_text);

  const specChunks = (Array.isArray(kbProductSpecs) ? kbProductSpecs : []).map((row) => ({
    chunk_id: `kb_spec:${Number(row?.id || 0)}`,
    asset_id: null,
    asset_type: 'PRODUCT_SPEC',
    source_table: 'kb_product_specs',
    source_id: Number(row?.id || 0) || 0,
    chunk_type: 'PRODUCT_SPEC',
    title: normalizeText([row?.product_name, row?.brand, row?.model].filter(Boolean).join(' ')),
    chunk_text: normalizeText([row?.spec_key, row?.spec_value].filter(Boolean).join('：')),
    tags: unique([...normalizeTags(row?.tags_json), normalizeText(row?.category)]),
    quality_score: toQualityScore(row?.quality_score, 0.82),
    freshness_score: toFreshnessScore(row?.updated_at || row?.created_at),
    review_required: false,
  })).filter((item) => item.title || item.chunk_text);

  const qualificationChunks = (Array.isArray(kbQualifications) ? kbQualifications : []).map((row) => ({
    chunk_id: `kb_qualification:${Number(row?.id || 0)}`,
    asset_id: null,
    asset_type: 'COMPANY_QUALIFICATION',
    source_table: 'kb_company_qualifications',
    source_id: Number(row?.id || 0) || 0,
    chunk_type: 'QUALIFICATION',
    title: normalizeText(row?.qualification_name),
    chunk_text: normalizeText([row?.qualification_type, row?.issuer, row?.keywords].filter(Boolean).join(' ')),
    tags: normalizeTags(row?.tags_json),
    quality_score: toQualityScore(row?.quality_score, 0.8),
    freshness_score: toFreshnessScore(row?.updated_at || row?.created_at || row?.valid_to),
    review_required: true,
  })).filter((item) => item.title || item.chunk_text);

  const personnelChunks = (Array.isArray(kbPersonnelAssets) ? kbPersonnelAssets : []).map((row) => ({
    chunk_id: `kb_personnel:${Number(row?.id || 0)}`,
    asset_id: null,
    asset_type: 'PERSONNEL_ASSET',
    source_table: 'kb_personnel_assets',
    source_id: Number(row?.id || 0) || 0,
    chunk_type: 'PERSONNEL_PROFILE',
    title: normalizeText(row?.name),
    chunk_text: normalizeText([row?.role_type, row?.certificates, row?.resume_text].filter(Boolean).join(' ')),
    tags: normalizeTags(row?.tags_json),
    quality_score: toQualityScore(row?.quality_score, 0.78),
    freshness_score: toFreshnessScore(row?.updated_at || row?.created_at),
    review_required: true,
  })).filter((item) => item.title || item.chunk_text);

  return [
    ...normalizedKbChunks,
    ...sectionChunks,
    ...caseChunks,
    ...specChunks,
    ...qualificationChunks,
    ...personnelChunks,
  ];
};

const buildSemanticRetrievalChunks = (input = {}) => [
  ...buildProjectAssetChunks(input.projectAssets),
  ...buildKnowledgeBaseChunks(input),
];

const createEmptyFeedbackSummary = () => ({
  positive_count: 0,
  negative_count: 0,
  confirmed_count: 0,
  replaced_count: 0,
  ignored_count: 0,
  last_feedback_status: '',
});

const toFeedbackTimestamp = (value) => {
  const ts = new Date(String(value || '')).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const bumpFeedbackAccumulator = (target, status, updatedAt = '') => {
  if (!target || !FEEDBACK_MATCH_STATUS.has(status)) return;
  if (status === 'CONFIRMED') {
    target.confirmed_count += 1;
    target.positive_count += 1;
  } else if (status === 'REPLACED') {
    target.replaced_count += 1;
    target.positive_count += 1;
  } else if (status === 'IGNORED') {
    target.ignored_count += 1;
    target.negative_count += 1;
  }

  const incomingTs = toFeedbackTimestamp(updatedAt);
  if (incomingTs >= target.last_feedback_ts) {
    target.last_feedback_ts = incomingTs;
    target.last_feedback_status = status;
  }
};

const finalizeFeedbackAccumulator = (target) => {
  if (!target) {
    return {
      feedback_score: 0,
      feedback_summary: createEmptyFeedbackSummary(),
    };
  }
  const feedbackScore = clamp(
    (target.confirmed_count * 0.12)
    + (target.replaced_count * 0.06)
    - (target.ignored_count * 0.14),
    -0.2,
    0.2
  );
  return {
    feedback_score: Number(feedbackScore.toFixed(4)),
    feedback_summary: {
      positive_count: target.positive_count,
      negative_count: target.negative_count,
      confirmed_count: target.confirmed_count,
      replaced_count: target.replaced_count,
      ignored_count: target.ignored_count,
      last_feedback_status: target.last_feedback_status || '',
    },
  };
};

const buildSemanticFeedbackIndex = (matches = []) => {
  const byChunkId = {};
  const byAssetId = {};

  for (const row of Array.isArray(matches) ? matches : []) {
    const payload = parseJsonObject(row?.payload_json || row?.payload);
    const status = normalizeText(row?.match_status || payload?.feedback_status).toUpperCase();
    if (!FEEDBACK_MATCH_STATUS.has(status)) continue;
    const updatedAt = normalizeText(payload?.feedback_updated_at || row?.updated_at || row?.created_at);
    const chunkId = normalizeText(payload?.chunk_id);
    const assetId = Number(row?.asset_id || payload?.asset_id || 0);

    if (chunkId) {
      if (!byChunkId[chunkId]) {
        byChunkId[chunkId] = {
          ...createEmptyFeedbackSummary(),
          last_feedback_ts: 0,
        };
      }
      bumpFeedbackAccumulator(byChunkId[chunkId], status, updatedAt);
    }

    if (Number.isFinite(assetId) && assetId > 0) {
      if (!byAssetId[assetId]) {
        byAssetId[assetId] = {
          ...createEmptyFeedbackSummary(),
          last_feedback_ts: 0,
        };
      }
      bumpFeedbackAccumulator(byAssetId[assetId], status, updatedAt);
    }
  }

  Object.keys(byChunkId).forEach((key) => {
    byChunkId[key] = finalizeFeedbackAccumulator(byChunkId[key]).feedback_summary;
  });
  Object.keys(byAssetId).forEach((key) => {
    byAssetId[key] = finalizeFeedbackAccumulator(byAssetId[key]).feedback_summary;
  });

  return {
    byChunkId,
    byAssetId,
  };
};

const resolveChunkFeedback = ({ chunk, feedbackIndex }) => {
  const chunkId = normalizeText(chunk?.chunk_id);
  const assetId = Number(chunk?.asset_id || 0);
  const chunkSummary = chunkId ? feedbackIndex?.byChunkId?.[chunkId] : null;
  const assetSummary = Number.isFinite(assetId) && assetId > 0 ? feedbackIndex?.byAssetId?.[assetId] : null;
  const feedbackSummary = chunkSummary || assetSummary || createEmptyFeedbackSummary();
  const feedbackScore = clamp(
    (Number(feedbackSummary.confirmed_count || 0) * 0.12)
    + (Number(feedbackSummary.replaced_count || 0) * 0.06)
    - (Number(feedbackSummary.ignored_count || 0) * 0.14),
    -0.2,
    0.2
  );
  return {
    feedback_score: Number(feedbackScore.toFixed(4)),
    feedback_summary: {
      ...createEmptyFeedbackSummary(),
      ...feedbackSummary,
    },
  };
};

const filterChunksForClause = ({ clause, chunks = [] }) => {
  const type = normalizeText(clause?.clause_type).toUpperCase() || 'GENERAL';
  const allow = {
    QUALIFICATION: new Set(['QUALIFICATION', 'PERSONNEL_PROFILE', 'GENERIC_ASSET']),
    TECHNICAL: new Set(['PRODUCT_SPEC', 'SECTION_FRAGMENT', 'GENERIC_ASSET']),
    SCORING: new Set(['SECTION_FRAGMENT', 'CASE_SUMMARY', 'PERSONNEL_PROFILE', 'QUALIFICATION']),
    GENERAL: new Set(['SECTION_FRAGMENT', 'CASE_SUMMARY', 'PRODUCT_SPEC', 'PERSONNEL_PROFILE', 'QUALIFICATION', 'GENERIC_ASSET']),
  }[type] || new Set(['SECTION_FRAGMENT', 'CASE_SUMMARY', 'PRODUCT_SPEC', 'PERSONNEL_PROFILE', 'QUALIFICATION', 'GENERIC_ASSET']);

  return (Array.isArray(chunks) ? chunks : []).filter((item) => allow.has(normalizeText(item?.chunk_type).toUpperCase()));
};

const computeRuleScore = ({ clause, chunk }) => {
  const clauseType = normalizeText(clause?.clause_type).toUpperCase() || 'GENERAL';
  const chunkType = normalizeText(chunk?.chunk_type).toUpperCase();
  if (clauseType === 'QUALIFICATION') {
    if (chunkType === 'QUALIFICATION') return 0.95;
    if (chunkType === 'PERSONNEL_PROFILE') return 0.55;
    return 0.18;
  }
  if (clauseType === 'TECHNICAL') {
    if (chunkType === 'PRODUCT_SPEC') return 0.95;
    if (chunkType === 'SECTION_FRAGMENT') return 0.6;
    return 0.2;
  }
  if (clauseType === 'SCORING') {
    if (chunkType === 'SECTION_FRAGMENT') return 0.85;
    if (chunkType === 'CASE_SUMMARY') return 0.72;
    if (chunkType === 'PERSONNEL_PROFILE') return 0.6;
    if (chunkType === 'QUALIFICATION') return 0.42;
    return 0.15;
  }
  return 0.35;
};

const computeSemanticScore = ({ clauseText, chunkText, title = '', tags = [] }) => {
  const queryTokens = tokenize(clauseText);
  const chunkTokens = tokenize([title, chunkText, ...(Array.isArray(tags) ? tags : [])].join(' '));
  const tokenScore = overlapScore(queryTokens, chunkTokens);
  const bigramScore = overlapScore(buildBigrams(clauseText), buildBigrams(`${title} ${chunkText}`));
  const titleScore = overlapScore(queryTokens, tokenize(title));
  return clamp01((tokenScore * 0.45) + (bigramScore * 0.35) + (titleScore * 0.2));
};

const buildManualReview = ({ clause, chunk, ruleScore, semanticScore }) => {
  const reasons = [];
  const chunkType = normalizeText(chunk?.chunk_type).toUpperCase();
  if (chunkType === 'QUALIFICATION') reasons.push('资质/授权类证据必须人工复核');
  if (chunkType === 'CASE_SUMMARY') reasons.push('案例类证据建议人工确认真实性和时效性');
  if (chunkType === 'PERSONNEL_PROFILE') reasons.push('人员类证据需人工确认可用性');
  if (Number(clause?.mandatory_flag || 0) > 0) reasons.push('必答条款推荐结果需人工确认');
  if (Number(clause?.scoring_flag || 0) > 0) reasons.push('评分条款推荐结果建议人工确认');
  if (semanticScore >= 0.25 && ruleScore < 0.25) reasons.push('语义召回主导的结果需人工复核');
  return unique(reasons);
};

const decideMatchSource = ({ ruleScore, semanticScore }) => {
  if (ruleScore >= 0.35 && semanticScore >= 0.1) return 'HYBRID';
  if (ruleScore >= 0.8 && semanticScore >= 0.03) return 'HYBRID';
  if (semanticScore > ruleScore) return 'SEMANTIC';
  return 'RULE';
};

const rankSemanticAssetRecommendations = ({ clause, chunks = [], limit = 3, feedbackIndex = null }) => {
  const clauseText = normalizeText([clause?.clause_title, clause?.clause_text].filter(Boolean).join(' '));
  if (!clauseText) return [];
  const filtered = filterChunksForClause({ clause, chunks });
  const ranked = filtered.map((chunk) => {
    const ruleScore = computeRuleScore({ clause, chunk });
    const semanticScore = computeSemanticScore({
      clauseText,
      chunkText: chunk.chunk_text,
      title: chunk.title,
      tags: chunk.tags,
    });
    const tagBoost = overlapScore(tokenize(clauseText), tokenize((chunk.tags || []).join(' '))) * 0.05;
    const feedbackMeta = resolveChunkFeedback({ chunk, feedbackIndex });
    const feedbackScore = Number(feedbackMeta.feedback_score || 0);
    const rerankScore = clamp01(
      (semanticScore * 0.55)
      + (ruleScore * 0.25)
      + (toQualityScore(chunk.quality_score, 0.7) * 0.1)
      + (toFreshnessScore(chunk.freshness_score) * 0.05)
      + tagBoost
      + feedbackScore
    );
    const manualReviewReasons = buildManualReview({
      clause,
      chunk,
      ruleScore,
      semanticScore,
    });
    return {
      ...chunk,
      confidence: Number(rerankScore.toFixed(4)),
      rule_score: Number(ruleScore.toFixed(4)),
      semantic_score: Number(semanticScore.toFixed(4)),
      rerank_score: Number(rerankScore.toFixed(4)),
      feedback_score: Number(feedbackScore.toFixed(4)),
      feedback_summary: feedbackMeta.feedback_summary,
      match_source: decideMatchSource({ ruleScore, semanticScore }),
      need_manual_review: manualReviewReasons.length > 0,
      manual_review_reasons: manualReviewReasons,
      reason_text: `规则分 ${ruleScore.toFixed(2)} / 语义分 ${semanticScore.toFixed(2)} / 反馈分 ${feedbackScore.toFixed(2)} / 重排分 ${rerankScore.toFixed(2)}`,
      chunk_preview: normalizeText(chunk.chunk_text).slice(0, 120),
    };
  }).filter((item) => item.semantic_score >= 0.08 || item.rerank_score >= 0.3);

  return ranked
    .sort((a, b) => Number(b.rerank_score || 0) - Number(a.rerank_score || 0))
    .slice(0, Math.max(1, Number(limit || 3)));
};

module.exports = {
  buildSemanticRetrievalChunks,
  buildSemanticFeedbackIndex,
  rankSemanticAssetRecommendations,
};

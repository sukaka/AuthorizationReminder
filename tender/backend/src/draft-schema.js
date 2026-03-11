const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toLines = (value) => {
  if (Array.isArray(value)) return value.map((item) => trimText(item)).filter(Boolean);
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => trimText(item))
    .filter(Boolean);
};

const normalizeBidCategory = (value) => {
  const text = trimText(value).toUpperCase();
  return text === 'PRODUCT' ? 'PRODUCT' : 'SERVICE';
};

const normalizeMatchToken = (value) =>
  trimText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:（）()【】\[\]、，,。.!?？;；\-_/]/g, '');

const matchTitleByAliases = (title, aliases = []) => {
  const source = normalizeMatchToken(title);
  if (!source) return false;
  return (Array.isArray(aliases) ? aliases : []).some((alias) => {
    const token = normalizeMatchToken(alias);
    if (!token) return false;
    return source.includes(token) || token.includes(source);
  });
};

const SERVICE_SCHEMA = [
  { key: 'COVER', title: '封面', required: true, aliases: ['封面'] },
  { key: 'TOC', title: '目录', required: true, aliases: ['目录', '章节目录'] },
  { key: 'INVITATION', title: '投标邀请', required: true, aliases: ['投标邀请'] },
  { key: 'BIDDER_INSTRUCTION', title: '投标人须知', required: true, aliases: ['投标人须知', '须知'] },
  { key: 'PROCUREMENT_REQUIREMENT', title: '采购需求', required: true, aliases: ['采购需求', '项目需求', '服务需求'] },
  { key: 'SCORING_STANDARD', title: '评标方法与评标标准', required: true, aliases: ['评标方法与评标标准', '评标方法与评分响应', '评分响应'] },
  { key: 'SERVICE_SCHEME', title: '服务方案框架', required: true, aliases: ['服务方案框架', '服务方案', '实施方案'] },
  { key: 'DEVIATION_TABLE', title: '偏离表', required: true, aliases: ['偏离表', '技术偏离表', '商务偏离表'] },
  { key: 'CONTRACT_TERMS', title: '合同主要条款及格式', required: true, aliases: ['合同主要条款及格式', '合同条款', '合同格式'] },
  { key: 'BID_DOC_FORMAT', title: '投标文件格式', required: true, aliases: ['投标文件格式', '附件资料', '格式附件'] },
];

const PRODUCT_SCHEMA = [
  { key: 'COVER', title: '封面', required: true, aliases: ['封面'] },
  { key: 'TOC', title: '目录', required: true, aliases: ['目录', '章节目录'] },
  { key: 'INVITATION', title: '投标邀请', required: true, aliases: ['投标邀请'] },
  { key: 'BIDDER_INSTRUCTION', title: '投标人须知', required: true, aliases: ['投标人须知', '须知'] },
  { key: 'TECH_REQUIREMENT', title: '采购需求与技术参数', required: true, aliases: ['采购需求与技术参数', '采购需求', '技术参数响应'] },
  { key: 'SCORING_RESPONSE', title: '评标方法与评分响应', required: true, aliases: ['评标方法与评分响应', '评标方法与评标标准', '评分响应'] },
  { key: 'DEVIATION_TABLE', title: '偏离表', required: true, aliases: ['偏离表', '技术偏离表', '商务偏离表'] },
  { key: 'CONTRACT_TERMS', title: '合同主要条款及格式', required: true, aliases: ['合同主要条款及格式', '合同条款', '合同格式'] },
  { key: 'BID_DOC_FORMAT', title: '投标文件格式', required: true, aliases: ['投标文件格式', '附件资料', '格式附件'] },
];

const buildDraftChapterSchema = ({ bidCategory = 'SERVICE' } = {}) =>
  normalizeBidCategory(bidCategory) === 'PRODUCT' ? PRODUCT_SCHEMA : SERVICE_SCHEMA;

const normalizeChapters = (chapters = []) =>
  (Array.isArray(chapters) ? chapters : [])
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      key: trimText(item.key),
      title: trimText(item.title) || `章节${index + 1}`,
      content: toLines(item.content || ''),
    }));

const clampScore = (value) => {
  const score = Number(value || 0);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
};

const scoreToGrade = (score) => {
  const value = clampScore(score);
  if (value >= 90) return 'A';
  if (value >= 78) return 'B';
  if (value >= 60) return 'C';
  return 'D';
};

const normalizeDraftChaptersToSchema = ({
  bidCategory = 'SERVICE',
  baselineChapters = [],
  aiChapters = [],
} = {}) => {
  const schema = buildDraftChapterSchema({ bidCategory });
  const baseline = normalizeChapters(baselineChapters);
  const ai = normalizeChapters(aiChapters);
  const usedAiIndexes = new Set();
  const usedBaselineIndexes = new Set();
  const normalized = [];
  const missingRequiredKeys = [];
  const usedAiKeys = [];
  const fallbackKeys = [];

  for (const schemaItem of schema) {
    const aiIndex = ai.findIndex((item, index) => !usedAiIndexes.has(index) && matchTitleByAliases(item.title, schemaItem.aliases));
    const baselineIndex = baseline.findIndex((item, index) => !usedBaselineIndexes.has(index) && matchTitleByAliases(item.title, schemaItem.aliases));
    const sourceChapter = aiIndex >= 0 ? ai[aiIndex] : (baselineIndex >= 0 ? baseline[baselineIndex] : null);

    if (aiIndex >= 0) {
      usedAiIndexes.add(aiIndex);
      usedAiKeys.push(schemaItem.key);
    } else if (baselineIndex >= 0) {
      usedBaselineIndexes.add(baselineIndex);
      fallbackKeys.push(schemaItem.key);
    }

    if (!sourceChapter) {
      if (schemaItem.required) missingRequiredKeys.push(schemaItem.key);
      continue;
    }

    normalized.push({
      key: schemaItem.key,
      title: schemaItem.title,
      content: sourceChapter.content,
      schema_required: schemaItem.required,
    });
  }

  const extraAiChapters = ai
    .filter((_item, index) => !usedAiIndexes.has(index))
    .map((item, index) => ({
      key: `EXTRA_AI_${index + 1}`,
      title: item.title,
      content: item.content,
      schema_required: false,
    }));

  return {
    chapters: [...normalized, ...extraAiChapters],
    validation: {
      bid_category: normalizeBidCategory(bidCategory),
      required_keys: schema.filter((item) => item.required).map((item) => item.key),
      missing_required_keys: missingRequiredKeys,
      used_ai_keys: usedAiKeys,
      fallback_keys: fallbackKeys,
      used_ai_count: usedAiKeys.length,
      fallback_count: fallbackKeys.length,
      extra_ai_count: extraAiChapters.length,
      valid: missingRequiredKeys.length === 0,
    },
  };
};

const buildDraftChapterQualitySummary = ({
  bidCategory = 'SERVICE',
  chapters = [],
  validation = {},
} = {}) => {
  const schema = buildDraftChapterSchema({ bidCategory });
  const schemaMap = new Map(schema.map((item) => [item.key, item]));
  const normalizedChapters = normalizeChapters(chapters);
  const requiredKeys = Array.isArray(validation?.required_keys)
    ? validation.required_keys.map((item) => trimText(item)).filter(Boolean)
    : schema.filter((item) => item.required).map((item) => item.key);
  const usedAiKeys = new Set(
    (Array.isArray(validation?.used_ai_keys) ? validation.used_ai_keys : [])
      .map((item) => trimText(item))
      .filter(Boolean)
  );
  const fallbackKeys = new Set(
    (Array.isArray(validation?.fallback_keys) ? validation.fallback_keys : [])
      .map((item) => trimText(item))
      .filter(Boolean)
  );
  const missingRequiredKeys = new Set(
    (Array.isArray(validation?.missing_required_keys) ? validation.missing_required_keys : [])
      .map((item) => trimText(item))
      .filter(Boolean)
  );

  const chapterScores = normalizedChapters.map((chapter, index) => {
    const chapterKey = trimText(chapter.key) || `UNKEYED_${index + 1}`;
    const schemaItem = schemaMap.get(chapterKey) || null;
    const required = schemaItem ? !!schemaItem.required : requiredKeys.includes(chapterKey);
    const source = chapterKey.startsWith('EXTRA_AI_')
      ? 'EXTRA_AI'
      : (usedAiKeys.has(chapterKey) ? 'AI' : (fallbackKeys.has(chapterKey) ? 'FALLBACK' : 'RULE'));
    const lineCount = chapter.content.length;
    const charCount = chapter.content.reduce((sum, item) => sum + trimText(item).length, 0);
    const warnings = [];

    let score = required ? 82 : 74;
    if (source === 'AI') score += 10;
    else if (source === 'FALLBACK') score -= 10;
    else if (source === 'EXTRA_AI') score += 4;

    if (charCount <= 0) {
      score = required ? 0 : 42;
      warnings.push(required ? '章节缺少正文内容' : '附加章节内容为空');
    } else {
      if (lineCount < 2) {
        score -= 12;
        warnings.push('章节行数偏少');
      } else if (lineCount >= 5) {
        score += 3;
      }

      if (charCount < 30) {
        score -= 24;
        warnings.push('章节字数偏短');
      } else if (charCount < 80) {
        score -= 10;
        warnings.push('章节内容较薄');
      } else if (charCount >= 180) {
        score += 4;
      }
    }

    if (required && source === 'FALLBACK') warnings.push('依赖规则骨架兜底');
    if (source === 'EXTRA_AI') warnings.push('附加 AI 章节，请人工确认是否保留');

    const finalScore = clampScore(score);
    return {
      chapter_key: chapterKey,
      chapter_title: trimText(chapter.title) || chapterKey,
      required,
      source,
      score: finalScore,
      grade: scoreToGrade(finalScore),
      line_count: lineCount,
      char_count: charCount,
      warnings,
      needs_attention: required
        ? finalScore < 78 || source === 'FALLBACK'
        : finalScore < 60,
    };
  });

  for (const missingKey of missingRequiredKeys) {
    const schemaItem = schemaMap.get(missingKey);
    chapterScores.push({
      chapter_key: missingKey,
      chapter_title: trimText(schemaItem?.title) || missingKey,
      required: true,
      source: 'MISSING',
      score: 0,
      grade: 'D',
      line_count: 0,
      char_count: 0,
      warnings: ['缺少必需章节'],
      needs_attention: true,
    });
  }

  const weighted = chapterScores.reduce((acc, item) => {
    const weight = item.required ? 1.2 : 0.7;
    acc.score += Number(item.score || 0) * weight;
    acc.weight += weight;
    return acc;
  }, { score: 0, weight: 0 });
  const overallScore = weighted.weight > 0 ? clampScore(weighted.score / weighted.weight) : 0;
  const highRiskCount = chapterScores.filter((item) => item.grade === 'D' || item.source === 'MISSING').length;
  const fallbackRequiredCount = chapterScores.filter((item) => item.required && item.source === 'FALLBACK').length;
  const attentionCount = chapterScores.filter((item) => item.needs_attention).length;
  const summaryLines = [];

  if (missingRequiredKeys.size > 0) {
    summaryLines.push(`缺失必需章节 ${missingRequiredKeys.size} 项`);
  }
  if (fallbackRequiredCount > 0) {
    summaryLines.push(`必需章节中有 ${fallbackRequiredCount} 项仍依赖规则骨架兜底`);
  }
  if (attentionCount > 0) {
    summaryLines.push(`共有 ${attentionCount} 个章节建议人工重点复核`);
  }
  if (!summaryLines.length) {
    summaryLines.push('章节骨架完整，内容质量可进入人工精修阶段。');
  }

  return {
    bid_category: normalizeBidCategory(bidCategory),
    overall_score: overallScore,
    grade: scoreToGrade(overallScore),
    required_chapter_count: requiredKeys.length,
    missing_required_count: missingRequiredKeys.size,
    fallback_required_count: fallbackRequiredCount,
    high_risk_count: highRiskCount,
    attention_count: attentionCount,
    chapter_scores: chapterScores,
    summary_lines: summaryLines,
  };
};

module.exports = {
  buildDraftChapterSchema,
  buildDraftChapterQualitySummary,
  normalizeDraftChaptersToSchema,
};

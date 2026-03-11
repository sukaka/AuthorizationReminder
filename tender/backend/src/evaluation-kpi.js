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

const toRatio = (current, expected) => {
  const denominator = Number(expected || 0);
  if (denominator <= 0) return 1;
  const numerator = Math.max(0, Number(current || 0));
  return Math.max(0, Math.min(1, numerator / denominator));
};

const average = (values = []) => {
  const list = (Array.isArray(values) ? values : []).filter((item) => Number.isFinite(Number(item)));
  if (!list.length) return 0;
  return list.reduce((sum, item) => sum + Number(item), 0) / list.length;
};

const toScore = (value) => Number(average([value]).toFixed(3));

const getResultStatus = ({ score = 0, needManualReview = false }) => {
  if (score < 0.5) return 'FAILED';
  if (needManualReview || score < 0.8) return 'WARNING';
  return 'PASS';
};

const toKpiKey = (evalType) => {
  const key = normalizeStatus(evalType);
  if (key === 'CLAUSE_RECOGNITION') return 'clause_recognition';
  if (key === 'SCORE_COVERAGE') return 'score_coverage';
  if (key === 'MATERIAL_MATCHING') return 'material_matching';
  if (key === 'RISK_RECALL') return 'risk_recall';
  if (key === 'EXPORT_COMPLETENESS') return 'export_completeness';
  return key.toLowerCase();
};

const evaluateClauseRecognition = ({ expected, actual }) => {
  const expectedTypes = uniqueList(expected.clause_types);
  const actualTypes = uniqueList(actual.clause_types);
  const typeHits = expectedTypes.filter((item) => actualTypes.includes(item));
  const misses = expectedTypes.filter((item) => !actualTypes.includes(item));
  const metrics = {
    coverage_ratio: toRatio(actual.clause_count, expected.clause_count),
    mandatory_hit_ratio: toRatio(actual.mandatory_count, expected.mandatory_count),
    scoring_hit_ratio: toRatio(actual.scoring_count, expected.scoring_count),
    clause_type_hit_ratio: toRatio(typeHits.length, expectedTypes.length),
  };
  const score = Number((
    metrics.coverage_ratio * 0.45
    + metrics.mandatory_hit_ratio * 0.2
    + metrics.scoring_hit_ratio * 0.15
    + metrics.clause_type_hit_ratio * 0.2
  ).toFixed(3));

  return {
    score,
    metrics,
    misses,
    high_risk_misses: [],
    need_manual_review: false,
  };
};

const evaluateScoreCoverage = ({ expected, actual }) => {
  const expectedItems = uniqueList(expected.score_item_names);
  const actualItems = uniqueList(actual.score_item_names);
  const expectedPoints = uniqueList(expected.recommended_points);
  const actualPoints = uniqueList(actual.recommended_points);
  const missingItems = expectedItems.filter((item) => !actualItems.includes(item));
  const missingPoints = expectedPoints.filter((item) => !actualPoints.includes(item));
  const metrics = {
    score_item_coverage_ratio: toRatio(expectedItems.length - missingItems.length, expectedItems.length),
    response_point_coverage_ratio: toRatio(expectedPoints.length - missingPoints.length, expectedPoints.length),
  };
  return {
    score: Number(average([
      metrics.score_item_coverage_ratio,
      metrics.response_point_coverage_ratio,
    ]).toFixed(3)),
    metrics,
    misses: [...missingItems, ...missingPoints],
    high_risk_misses: [],
    need_manual_review: false,
  };
};

const evaluateMaterialMatching = ({ expected, actual }) => {
  const requiredAssetIds = uniqueList(expected.required_asset_ids);
  const matchedAssetIds = uniqueList(actual.matched_asset_ids);
  const misses = requiredAssetIds.filter((item) => !matchedAssetIds.includes(item));
  const manualReviewRatio = toRatio(actual.need_manual_review_count, actual.total_match_count);
  const metrics = {
    match_hit_ratio: toRatio(requiredAssetIds.length - misses.length, requiredAssetIds.length),
    manual_review_ratio: manualReviewRatio,
  };
  return {
    score: Number(average([
      metrics.match_hit_ratio,
      1 - metrics.manual_review_ratio,
    ]).toFixed(3)),
    metrics,
    misses,
    high_risk_misses: [],
    need_manual_review: manualReviewRatio > 0.3,
  };
};

const evaluateRiskRecall = ({ expected, actual }) => {
  const expectedCodes = uniqueList(expected.risk_codes);
  const actualCodes = uniqueList(actual.risk_codes);
  const highRiskExpected = uniqueList(expected.high_risk_codes);
  const misses = expectedCodes.filter((item) => !actualCodes.includes(item));
  const highRiskMisses = highRiskExpected.filter((item) => !actualCodes.includes(item));
  const metrics = {
    risk_recall_ratio: toRatio(expectedCodes.length - misses.length, expectedCodes.length),
    high_risk_recall_ratio: toRatio(highRiskExpected.length - highRiskMisses.length, highRiskExpected.length),
  };
  return {
    score: Number(metrics.risk_recall_ratio.toFixed(3)),
    metrics,
    misses,
    high_risk_misses: highRiskMisses,
    need_manual_review: highRiskMisses.length > 0,
  };
};

const evaluateExportCompleteness = ({ expected, actual }) => {
  const requiredDeliverables = uniqueList(expected.required_deliverables);
  const actualDeliverables = uniqueList(actual.deliverables);
  const misses = requiredDeliverables.filter((item) => !actualDeliverables.includes(item));
  const successRatio = normalizeStatus(actual.latest_export_status) === 'SUCCESS' ? 1 : 0;
  const metrics = {
    deliverable_coverage_ratio: toRatio(requiredDeliverables.length - misses.length, requiredDeliverables.length),
    latest_export_success_ratio: successRatio,
  };
  return {
    score: Number(average([
      metrics.deliverable_coverage_ratio,
      metrics.latest_export_success_ratio,
    ]).toFixed(2)),
    metrics,
    misses,
    high_risk_misses: [],
    need_manual_review: misses.length > 0 || successRatio === 0,
  };
};

const evaluateDatasetResult = ({ dataset = {}, actual = {} }) => {
  const evalType = normalizeStatus(dataset.eval_type);
  const expected = parseJsonObject(dataset.expected_payload);
  const actualPayload = parseJsonObject(actual);

  let base;
  if (evalType === 'CLAUSE_RECOGNITION') {
    base = evaluateClauseRecognition({ expected, actual: actualPayload });
  } else if (evalType === 'SCORE_COVERAGE') {
    base = evaluateScoreCoverage({ expected, actual: actualPayload });
  } else if (evalType === 'MATERIAL_MATCHING') {
    base = evaluateMaterialMatching({ expected, actual: actualPayload });
  } else if (evalType === 'RISK_RECALL') {
    base = evaluateRiskRecall({ expected, actual: actualPayload });
  } else if (evalType === 'EXPORT_COMPLETENESS') {
    base = evaluateExportCompleteness({ expected, actual: actualPayload });
  } else {
    base = {
      score: 0,
      metrics: {},
      misses: [],
      high_risk_misses: [],
      need_manual_review: true,
    };
  }

  return {
    eval_type: evalType,
    score: Number(base.score.toFixed(3)),
    status: getResultStatus({
      score: base.score,
      needManualReview: Boolean(base.need_manual_review),
    }),
    metrics: base.metrics,
    expected,
    actual: actualPayload,
    misses: uniqueList(base.misses),
    high_risk_misses: uniqueList(base.high_risk_misses),
    need_manual_review: Boolean(base.need_manual_review),
  };
};

const buildRunSummary = (items = []) => {
  const rows = Array.isArray(items) ? items : [];
  const summary = {
    overall_score: Number(average(rows.map((item) => Number(item?.score || 0))).toFixed(3)),
    dataset_count: rows.length,
    pass_count: 0,
    warning_count: 0,
    fail_count: 0,
    kpis: {},
  };

  const grouped = new Map();
  for (const item of rows) {
    const status = getResultStatus({
      score: Number(item?.score || 0),
      needManualReview: Boolean(item?.need_manual_review),
    });
    if (status === 'PASS') summary.pass_count += 1;
    else if (status === 'WARNING') summary.warning_count += 1;
    else summary.fail_count += 1;

    const key = toKpiKey(item?.eval_type);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      ...item,
      status,
    });
  }

  for (const [key, groupItems] of grouped.entries()) {
    const score = Number(average(groupItems.map((item) => Number(item?.score || 0))).toFixed(3));
    const statuses = groupItems.map((item) => normalizeStatus(item.status));
    const status = statuses.includes('FAILED')
      ? 'FAILED'
      : (statuses.includes('WARNING') ? 'WARNING' : 'PASS');
    summary.kpis[key] = {
      score,
      status,
      dataset_count: groupItems.length,
      manual_review_count: groupItems.filter((item) => item.need_manual_review).length,
    };
  }

  return summary;
};

const buildBaselineDelta = ({ currentSummary = {}, baselineSummary = {} }) => {
  const currentKpis = currentSummary?.kpis && typeof currentSummary.kpis === 'object' ? currentSummary.kpis : {};
  const baselineKpis = baselineSummary?.kpis && typeof baselineSummary.kpis === 'object' ? baselineSummary.kpis : {};
  const keys = uniqueList([
    ...Object.keys(currentKpis),
    ...Object.keys(baselineKpis),
  ]);

  const kpis = {};
  for (const key of keys) {
    const currentScore = Number(currentKpis[key]?.score || 0);
    const baselineScore = Number(baselineKpis[key]?.score || 0);
    const delta = Number((currentScore - baselineScore).toFixed(3));
    kpis[key] = {
      current_score: currentScore,
      baseline_score: baselineScore,
      delta,
      trend: delta > 0 ? 'UP' : (delta < 0 ? 'DOWN' : 'FLAT'),
    };
  }

  return {
    overall_score_delta: Number((Number(currentSummary?.overall_score || 0) - Number(baselineSummary?.overall_score || 0)).toFixed(3)),
    kpis,
  };
};

module.exports = {
  evaluateDatasetResult,
  buildRunSummary,
  buildBaselineDelta,
};

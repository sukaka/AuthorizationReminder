const normalizeText = (value) => String(value ?? '').trim();

const parseJson = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(fallback) && Array.isArray(value)) return value;
  if (!Array.isArray(fallback) && fallback && typeof fallback === 'object' && value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    if (fallback && typeof fallback === 'object') return parsed && typeof parsed === 'object' ? parsed : fallback;
    return parsed;
  } catch {
    return fallback;
  }
};

const normalizeStatus = (value) => normalizeText(value).toUpperCase();

const isReviewPendingStatus = (value) => normalizeStatus(value).endsWith('_REVIEW_PENDING');

const toRiskLabel = (value) => {
  const key = normalizeStatus(value);
  if (key === 'HIGH') return '高';
  if (key === 'MEDIUM') return '中';
  return '低';
};

const sanitizeExportRecordRow = (row) => ({
  id: Number(row?.id || 0) || 0,
  bid_id: Number(row?.bid_id || 0) || 0,
  version_id: Number(row?.version_id || 0) || null,
  draft_id: Number(row?.draft_id || 0) || null,
  export_type: normalizeStatus(row?.export_type) || 'DOCX',
  status: normalizeStatus(row?.status) || 'SUCCESS',
  file_name: normalizeText(row?.file_name),
  mime_type: normalizeText(row?.mime_type),
  file_size: Number(row?.file_size || 0) || 0,
  storage_path: normalizeText(row?.storage_path),
  error_message: normalizeText(row?.error_message),
  payload: parseJson(row?.payload_json ?? row?.payload, {}),
  result: parseJson(row?.result_json ?? row?.result, {}),
  created_by_id: Number(row?.created_by_id || 0) || null,
  created_by_name: normalizeText(row?.created_by_name),
  created_at: row?.created_at || null,
  updated_at: row?.updated_at || row?.created_at || null,
});

const buildRiskProjectRow = ({ bid = {}, latestParseJob = null, latestDraftCheckRun = null, latestExportRecord = null } = {}) => {
  const status = normalizeStatus(bid?.status) || 'DRAFT';
  const parseStatus = normalizeStatus(latestParseJob?.status);
  const exportRecord = latestExportRecord ? sanitizeExportRecordRow(latestExportRecord) : null;
  const checkSummary = parseJson(latestDraftCheckRun?.summary_json ?? latestDraftCheckRun?.summary, {});
  const fatalCount = Number(checkSummary?.fatal_count || 0) || 0;
  const warnCount = Number(checkSummary?.warn_count || 0) || 0;
  const sources = [];

  if (status === 'MATERIALS_PENDING') sources.push('待补资料');
  if (isReviewPendingStatus(status)) sources.push('审核待处理');
  if (parseStatus === 'FAILED') sources.push('解析失败');
  else if (normalizeText(latestParseJob?.warning_text)) sources.push('解析预警');
  if (fatalCount > 0 || warnCount > 0) sources.push('成稿校验');
  if (exportRecord?.status === 'FAILED') sources.push('导出失败');

  let riskLevel = 'LOW';
  if (
    status === 'MATERIALS_PENDING'
    || parseStatus === 'FAILED'
    || fatalCount > 0
    || exportRecord?.status === 'FAILED'
  ) {
    riskLevel = 'HIGH';
  } else if (isReviewPendingStatus(status) || warnCount > 0 || normalizeText(latestParseJob?.warning_text)) {
    riskLevel = 'MEDIUM';
  }

  let recommendedAction = '继续推进项目';
  if (status === 'MATERIALS_PENDING' && fatalCount > 0) {
    recommendedAction = '补齐资料并先处理致命校验问题';
  } else if (exportRecord?.status === 'FAILED') {
    recommendedAction = '重试导出并检查源文件与转换环境';
  } else if (fatalCount > 0) {
    recommendedAction = '优先处理致命校验问题';
  } else if (status === 'MATERIALS_PENDING') {
    recommendedAction = '补齐资料后再推进生成与审核';
  } else if (parseStatus === 'FAILED') {
    recommendedAction = '重试解析并检查上传文件';
  } else if (isReviewPendingStatus(status)) {
    recommendedAction = '安排处理人推进审核流转';
  } else if (warnCount > 0 || normalizeText(latestParseJob?.warning_text)) {
    recommendedAction = '人工复核解析与成稿告警';
  }

  return {
    bid_id: Number(bid?.id || 0) || 0,
    bid_no: normalizeText(bid?.bid_no),
    title: normalizeText(bid?.title),
    project_name: normalizeText(bid?.project_name),
    status,
    risk_level: riskLevel,
    risk_label: toRiskLabel(riskLevel),
    risk_sources: sources,
    risk_count: sources.length,
    fatal_count: fatalCount,
    warn_count: warnCount,
    latest_parse_status: parseStatus,
    latest_parse_at: latestParseJob?.updated_at || latestParseJob?.created_at || null,
    latest_check_at: latestDraftCheckRun?.created_at || null,
    latest_export_status: exportRecord?.status || '',
    latest_export_at: exportRecord?.created_at || null,
    recommended_action: recommendedAction,
    updated_at: bid?.updated_at || bid?.created_at || null,
  };
};

const buildRiskCenterOverview = (projectRows = []) => {
  const rows = Array.isArray(projectRows) ? projectRows : [];
  return {
    total_projects: rows.length,
    high_risk_projects: rows.filter((item) => normalizeStatus(item?.risk_level) === 'HIGH').length,
    medium_risk_projects: rows.filter((item) => normalizeStatus(item?.risk_level) === 'MEDIUM').length,
    materials_pending_projects: rows.filter((item) => normalizeStatus(item?.status) === 'MATERIALS_PENDING').length,
    review_pending_projects: rows.filter((item) => isReviewPendingStatus(item?.status)).length,
    export_failed_records: rows.filter((item) => normalizeStatus(item?.latest_export_status) === 'FAILED').length,
  };
};

const buildExportCenterOverview = ({ projectRows = [], exportRecords = [], now = Date.now() } = {}) => {
  const rows = Array.isArray(projectRows) ? projectRows : [];
  const records = (Array.isArray(exportRecords) ? exportRecords : []).map((item) => sanitizeExportRecordRow(item));
  const currentTime = new Date(now);
  const currentMs = Number.isNaN(currentTime.getTime()) ? Date.now() : currentTime.getTime();
  const recentThreshold = currentMs - (7 * 24 * 60 * 60 * 1000);
  const recentRecords = records.filter((item) => {
    const ts = new Date(String(item.created_at || '')).getTime();
    return Number.isFinite(ts) && ts >= recentThreshold;
  });

  return {
    total_projects: rows.length,
    ready_projects: rows.filter((item) => normalizeStatus(item?.status) === 'EXPORT_READY').length,
    exported_projects: rows.filter((item) => ['EXPORTED', 'ARCHIVED'].includes(normalizeStatus(item?.status))).length,
    recent_success_records: recentRecords.filter((item) => item.status === 'SUCCESS').length,
    recent_failed_records: recentRecords.filter((item) => item.status === 'FAILED').length,
  };
};

const buildTemplateReferenceConflictMessage = ({ entityLabel = '模板资源', entityCode = '', bundles = [] } = {}) => {
  const rows = Array.isArray(bundles) ? bundles : [];
  const code = normalizeText(entityCode);
  if (rows.length > 3) {
    return `${entityLabel} ${code} 已被 ${rows.length} 个模板包引用，请先解除关联后再删除`;
  }
  const names = rows
    .map((item) => normalizeText(item?.name) || normalizeText(item?.bundle_code))
    .filter(Boolean);
  const summary = names.join('、') || '关联模板包';
  return `${entityLabel} ${code} 已被模板包引用：${summary}`;
};

module.exports = {
  buildRiskProjectRow,
  buildRiskCenterOverview,
  sanitizeExportRecordRow,
  buildExportCenterOverview,
  buildTemplateReferenceConflictMessage,
};

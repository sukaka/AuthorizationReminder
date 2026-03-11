const normalizeText = (value) => String(value ?? '').trim()

const normalizeStatus = (value, fallback = '') => normalizeText(value).toUpperCase() || fallback

const toCount = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const parseMaybeJson = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

const normalizeRun = (item = {}) => ({
  ...item,
  id: Number(item?.id || 0) || 0,
  run_scope: normalizeStatus(item?.run_scope, 'ADHOC'),
  status: normalizeStatus(item?.status, 'SUCCESS'),
  dataset_count: toCount(item?.dataset_count),
  summary: item?.summary && typeof item.summary === 'object' ? item.summary : {},
  baseline_summary: item?.baseline_summary && typeof item.baseline_summary === 'object' ? item.baseline_summary : {},
})

const normalizeItem = (item = {}) => ({
  ...item,
  id: Number(item?.id || 0) || 0,
  eval_type: normalizeStatus(item?.eval_type),
  status: normalizeStatus(item?.status, 'PASS'),
  score: Number(item?.score || 0) || 0,
  result: item?.result && typeof item.result === 'object' ? item.result : {},
  delta: item?.delta && typeof item.delta === 'object' ? item.delta : {},
})

export const createEvaluationCenterState = () => ({
  loading: false,
  error: '',
  overview: {
    dataset_count: 0,
    baseline_dataset_count: 0,
    run_count: 0,
    latest_run: null,
    latest_baseline_run: null,
  },
  datasetCountsByType: [],
  recentRuns: [],
  datasets: [],
  runs: [],
  selectedRun: null,
  datasetForm: {
    bid_id: '',
    dataset_name: '',
    eval_type: 'CLAUSE_RECOGNITION',
    baseline_flag: true,
    notes: '',
    expected_payload_text: '',
  },
  runForm: {
    run_label: '',
    run_scope: 'BASELINE',
    dataset_ids: [],
  },
  savingDataset: false,
  runningEvaluation: false,
})

export const buildEvaluationOverviewData = (payload = {}) => ({
  overview: {
    ...createEvaluationCenterState().overview,
    ...(payload?.overview && typeof payload.overview === 'object'
      ? {
        ...payload.overview,
        dataset_count: toCount(payload.overview.dataset_count),
        baseline_dataset_count: toCount(payload.overview.baseline_dataset_count),
        run_count: toCount(payload.overview.run_count),
        latest_run: payload.overview.latest_run ? normalizeRun(payload.overview.latest_run) : null,
        latest_baseline_run: payload.overview.latest_baseline_run ? normalizeRun(payload.overview.latest_baseline_run) : null,
      }
      : {}),
  },
  datasetCountsByType: (Array.isArray(payload?.dataset_counts_by_type) ? payload.dataset_counts_by_type : []).map((item) => ({
    eval_type: normalizeStatus(item?.eval_type),
    count: toCount(item?.count),
  })),
  recentRuns: (Array.isArray(payload?.recent_runs) ? payload.recent_runs : []).map((item) => normalizeRun(item)),
})

export const buildEvaluationDatasetPayload = (form = {}) => {
  const expectedPayload = parseMaybeJson(form?.expected_payload_text, null)
  const payload = {
    bid_id: Number(form?.bid_id || 0) || 0,
    dataset_name: normalizeText(form?.dataset_name),
    eval_type: normalizeStatus(form?.eval_type),
    baseline_flag: !!form?.baseline_flag,
    notes: normalizeText(form?.notes),
  }
  if (expectedPayload && typeof expectedPayload === 'object' && !Array.isArray(expectedPayload)) {
    payload.expected_payload = expectedPayload
  }
  return payload
}

export const buildEvaluationRunDetailData = (payload = {}) => ({
  run: payload?.run ? normalizeRun(payload.run) : null,
  items: (Array.isArray(payload?.items) ? payload.items : []).map((item) => normalizeItem(item)),
})

export default {
  createEvaluationCenterState,
  buildEvaluationOverviewData,
  buildEvaluationDatasetPayload,
  buildEvaluationRunDetailData,
}

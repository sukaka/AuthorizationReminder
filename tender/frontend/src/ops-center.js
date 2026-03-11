const normalizeText = (value) => String(value ?? '').trim()

const normalizeStatus = (value, fallback = '') => normalizeText(value).toUpperCase() || fallback

const normalizeListIds = (items = []) => Array.from(
  new Set(
    items
      .map((item) => Number(item?.id || item))
      .filter((item) => Number.isFinite(item) && item > 0)
  )
)

const normalizeRiskItem = (item = {}) => ({
  ...item,
  bid_id: Number(item?.bid_id || 0) || 0,
  title: normalizeText(item?.title),
  project_name: normalizeText(item?.project_name),
  status: normalizeStatus(item?.status, 'DRAFT'),
  risk_level: normalizeStatus(item?.risk_level, 'LOW'),
  risk_sources: Array.isArray(item?.risk_sources) ? item.risk_sources.map((entry) => normalizeText(entry)).filter(Boolean) : [],
  recommended_action: normalizeText(item?.recommended_action),
})

const normalizeExportRecord = (item = {}) => ({
  ...item,
  id: Number(item?.id || 0) || 0,
  bid_id: Number(item?.bid_id || 0) || 0,
  export_type: normalizeStatus(item?.export_type, 'DOCX'),
  status: normalizeStatus(item?.status, 'SUCCESS'),
  file_name: normalizeText(item?.file_name),
  created_at: item?.created_at || '',
})

const sortRecordsDesc = (records = []) => [...records].sort(
  (a, b) => new Date(String(b?.created_at || '')).getTime() - new Date(String(a?.created_at || '')).getTime()
)

export const createRiskCenterState = () => ({
  loading: false,
  error: '',
  filters: {
    keyword: '',
    level: '',
    status: '',
  },
  overview: {
    total_projects: 0,
    high_risk_projects: 0,
    medium_risk_projects: 0,
    materials_pending_projects: 0,
    review_pending_projects: 0,
    export_failed_records: 0,
  },
  items: [],
})

export const createTemplateCenterState = () => ({
  loading: false,
  error: '',
  fields: [],
  snippets: [],
  bundles: [],
  fieldForm: {
    field_code: '',
    field_name: '',
    data_type: 'text',
    default_value: '',
    required_flag: false,
  },
  snippetForm: {
    snippet_code: '',
    title: '',
    category: '',
    tags_text: '',
    content: '',
  },
  bundleForm: {
    bundle_code: '',
    name: '',
    bid_type: 'SERVICE',
    description: '',
    field_ids: [],
    snippet_ids: [],
  },
})

export const createExportCenterState = () => ({
  loading: false,
  error: '',
  filters: {
    keyword: '',
    status: '',
  },
  overview: {
    total_projects: 0,
    ready_projects: 0,
    exported_projects: 0,
    recent_success_records: 0,
    recent_failed_records: 0,
  },
  items: [],
  recent_records: [],
})

export const buildRiskCenterData = (payload = {}) => {
  const overview = payload?.overview && typeof payload.overview === 'object'
    ? payload.overview
    : createRiskCenterState().overview
  const items = Array.isArray(payload?.items) ? payload.items.map((item) => normalizeRiskItem(item)) : []

  return {
    overview: {
      ...createRiskCenterState().overview,
      ...overview,
    },
    items,
  }
}

export const buildTemplateBundlePayload = (form = {}) => {
  const fieldIds = Array.isArray(form?.field_ids) ? form.field_ids : []
  const snippetIds = Array.isArray(form?.snippet_ids) ? form.snippet_ids : []
  const items = []
  let sortOrder = 1

  fieldIds.forEach((item) => {
    const refId = Number(item)
    if (!Number.isFinite(refId) || refId <= 0) return
    items.push({
      item_type: 'FIELD',
      ref_id: refId,
      bind_key: '',
      sort_order: sortOrder,
    })
    sortOrder += 1
  })

  snippetIds.forEach((item) => {
    const refId = Number(item)
    if (!Number.isFinite(refId) || refId <= 0) return
    items.push({
      item_type: 'SNIPPET',
      ref_id: refId,
      bind_key: '',
      sort_order: sortOrder,
    })
    sortOrder += 1
  })

  return {
    bundle_code: normalizeStatus(form?.bundle_code),
    name: normalizeText(form?.name),
    bid_type: normalizeStatus(form?.bid_type, 'SERVICE'),
    description: normalizeText(form?.description),
    items,
  }
}

export const toggleListSelection = (selectedIds = [], targetId) => {
  const nextId = Number(targetId)
  if (!Number.isFinite(nextId) || nextId <= 0) return normalizeListIds(selectedIds)
  const normalized = normalizeListIds(selectedIds)
  return normalized.includes(nextId)
    ? normalized.filter((item) => item !== nextId)
    : [...normalized, nextId]
}

export const toggleAllListSelection = (selectedIds = [], items = []) => {
  const availableIds = normalizeListIds(items)
  if (!availableIds.length) return []
  const normalizedSelected = normalizeListIds(selectedIds)
  const allSelected = availableIds.every((item) => normalizedSelected.includes(item))
  return allSelected ? [] : availableIds
}

export const buildBulkDeleteFeedback = ({ successCount = 0, failed = [], successMessage = '批量删除完成', failureMessage = '批量删除失败' } = {}) => {
  const failures = Array.isArray(failed) ? failed.filter(Boolean) : []
  if (!failures.length) {
    return {
      type: 'success',
      message: `${successMessage}，共 ${Math.max(0, Number(successCount) || 0)} 条`,
    }
  }
  const detail = failures[0]?.message || failureMessage
  const normalizedSuccessCount = Math.max(0, Number(successCount) || 0)
  if (normalizedSuccessCount > 0) {
    return {
      type: 'error',
      message: `已删除 ${normalizedSuccessCount} 条，失败 ${failures.length} 条：${detail}`,
    }
  }
  return {
    type: 'error',
    message: `${failureMessage}：${detail}`,
  }
}

export const buildExportCenterData = (payload = {}) => {
  const overview = payload?.overview && typeof payload.overview === 'object'
    ? payload.overview
    : createExportCenterState().overview
  const items = Array.isArray(payload?.items)
    ? payload.items.map((item) => ({
      ...item,
      bid_id: Number(item?.bid_id || 0) || 0,
      title: normalizeText(item?.title),
      project_name: normalizeText(item?.project_name),
      status: normalizeStatus(item?.status, 'DRAFT'),
      latest_export_record: item?.latest_export_record ? normalizeExportRecord(item.latest_export_record) : null,
    }))
    : []
  const recentRecords = sortRecordsDesc(
    (Array.isArray(payload?.recent_records) ? payload.recent_records : []).map((item) => normalizeExportRecord(item))
  )

  return {
    overview: {
      ...createExportCenterState().overview,
      ...overview,
    },
    items,
    recent_records: recentRecords,
  }
}

export default {
  createRiskCenterState,
  createTemplateCenterState,
  createExportCenterState,
  buildRiskCenterData,
  buildTemplateBundlePayload,
  toggleListSelection,
  toggleAllListSelection,
  buildBulkDeleteFeedback,
  buildExportCenterData,
}

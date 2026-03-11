const normalizeText = (value) => String(value ?? '').trim()

const normalizeUpper = (value, fallback = '') => normalizeText(value).toUpperCase() || fallback

const normalizeNumber = (value, fallback = 0) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

const normalizeTagList = (value) => {
  const raw = Array.isArray(value)
    ? value
    : (
      typeof value === 'string'
        ? value.split(/[,\n]/u)
        : []
    )
  const seen = new Set()
  const result = []
  raw.forEach((item) => {
    const text = normalizeText(item)
    if (!text || seen.has(text)) return
    seen.add(text)
    result.push(text)
  })
  return result
}

export const createKbIngestState = () => ({
  loading: false,
  refreshing: false,
  error: '',
  linkedProject: null,
  ingestJobs: [],
  stats: {
    ingestable_clauses: 0,
    ingestable_score_items: 0,
    ingestable_sections: 0,
    ingestable_tables: 0,
    ingestable_attachments: 0,
    estimated_chunk_count: 0,
    clause_count: 0,
    score_item_count: 0,
    section_asset_count: 0,
    chunk_count: 0,
    attachment_chunk_count: 0,
  },
  form: {
    project_name: '',
    project_no: '',
    purchaser: '',
    project_type: '',
    industry_type: '',
    region: '',
    result_status: 'IN_PROGRESS',
    bid_amount: '',
    tags_text: '',
    remarks: '',
  },
  ingesting: false,
})

export const buildKbIngestWorkspaceData = (payload = {}) => {
  const base = createKbIngestState()
  const defaults = payload?.defaults && typeof payload.defaults === 'object' ? payload.defaults : {}
  const tags = normalizeTagList(defaults?.tags)
  const jobs = Array.isArray(payload?.ingest_jobs) ? payload.ingest_jobs : []
  const stats = payload?.stats && typeof payload.stats === 'object' ? payload.stats : {}

  return {
    ...base,
    linkedProject: payload?.linked_project || null,
    ingestJobs: jobs.map((item) => ({
      ...item,
      id: Number(item?.id || 0) || 0,
      status: normalizeUpper(item?.status, 'PENDING'),
    })),
    stats: {
      ...base.stats,
      ...Object.fromEntries(
        Object.entries(stats).map(([key, value]) => [key, normalizeNumber(value, 0)])
      ),
    },
    form: {
      project_name: normalizeText(defaults?.project_name),
      project_no: normalizeText(defaults?.project_no),
      purchaser: normalizeText(defaults?.purchaser),
      project_type: normalizeUpper(defaults?.project_type),
      industry_type: normalizeText(defaults?.industry_type),
      region: normalizeText(defaults?.region),
      result_status: normalizeUpper(defaults?.result_status, 'IN_PROGRESS'),
      bid_amount: normalizeText(defaults?.bid_amount),
      tags_text: tags.join(', '),
      remarks: normalizeText(defaults?.remarks),
    },
  }
}

export const buildKbIngestPayload = (form = {}) => {
  const payload = {
    project_name: normalizeText(form?.project_name),
    project_type: normalizeUpper(form?.project_type),
    industry_type: normalizeText(form?.industry_type),
    region: normalizeText(form?.region),
    result_status: normalizeUpper(form?.result_status, 'IN_PROGRESS'),
    remarks: normalizeText(form?.remarks),
  }

  const bidAmountText = normalizeText(form?.bid_amount)
  if (bidAmountText) payload.bid_amount = normalizeNumber(bidAmountText, null)

  const tags = normalizeTagList(form?.tags_text)
  if (tags.length) payload.tags = tags

  if (!payload.project_name) delete payload.project_name
  if (!payload.project_type) delete payload.project_type
  if (!payload.industry_type) delete payload.industry_type
  if (!payload.region) delete payload.region
  if (!payload.remarks) delete payload.remarks
  if (!Number.isFinite(payload.bid_amount)) delete payload.bid_amount

  return payload
}

export default {
  createKbIngestState,
  buildKbIngestWorkspaceData,
  buildKbIngestPayload,
}

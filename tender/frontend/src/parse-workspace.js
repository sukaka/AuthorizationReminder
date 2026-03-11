export const parseFileRoleOptions = [
  { value: 'MAIN', label: '招标文件' },
  { value: 'CLARIFICATION', label: '澄清文件' },
  { value: 'ATTACHMENT', label: '附件' },
  { value: 'SUPPLEMENT', label: '补充资料' },
]

export const parseScopeOptions = [
  { value: 'FULL', label: '全量解析' },
  { value: 'SCORING', label: '仅评分项' },
  { value: 'PARAMETERS', label: '仅参数表' },
  { value: 'QUALIFICATION', label: '仅资格项' },
]

const normalizeText = (value) => String(value ?? '').trim()

export const resolveParseWorkspaceGenerateDefaults = ({ bidCategory, models = [], docTemplates = [] } = {}) => {
  const normalizedBidCategory = normalizeText(bidCategory).toUpperCase()
  const enabledModels = (Array.isArray(models) ? models : [])
    .filter((item) => Number(item?.is_enabled || 0) === 1)
  const activeTemplates = (Array.isArray(docTemplates) ? docTemplates : [])
    .filter((item) => normalizeText(item?.status).toUpperCase() === 'ACTIVE')
  const defaultModel = enabledModels.find((item) => Number(item?.is_default || 0) === 1) || enabledModels[0] || null
  const defaultTemplate = activeTemplates.find((item) => Number(item?.is_default || 0) === 1) || activeTemplates[0] || null

  return {
    bid_category: normalizedBidCategory === 'PRODUCT' ? 'PRODUCT' : 'SERVICE',
    model_id: defaultModel?.id ? String(defaultModel.id) : '',
    doc_template_id: defaultTemplate?.id ? String(defaultTemplate.id) : '',
  }
}

const normalizeParseFile = (item = {}) => ({
  ...item,
  id: Number(item?.id || 0) || 0,
  root_file_id: Number(item?.root_file_id || item?.id || 0) || 0,
  parent_file_id: Number(item?.parent_file_id || 0) || null,
  file_role: normalizeText(item?.file_role).toUpperCase() || 'SUPPLEMENT',
  file_kind: normalizeText(item?.file_kind).toUpperCase() || 'UPLOAD',
  status: normalizeText(item?.status).toUpperCase() || 'UPLOADED',
  source_ext: normalizeText(item?.source_ext).toLowerCase(),
  display_name: normalizeText(item?.display_name || item?.original_file_name || item?.relative_path),
  relative_path: normalizeText(item?.relative_path),
  sheet_manifest: Array.isArray(item?.sheet_manifest) ? item.sheet_manifest : [],
  selected_sheet_names: Array.isArray(item?.selected_sheet_names) ? item.selected_sheet_names : [],
})

export const buildParseFileTree = (files = []) => {
  const normalized = (Array.isArray(files) ? files : []).map((item) => normalizeParseFile(item))
  const rootMap = new Map()
  normalized.forEach((item) => {
    const rootId = Number(item.root_file_id || item.id || 0)
    if (!rootMap.has(rootId)) {
      rootMap.set(rootId, { root: null, children: [] })
    }
    const group = rootMap.get(rootId)
    if (item.id === rootId || item.file_kind === 'UPLOAD') {
      group.root = item
    } else {
      group.children.push(item)
    }
  })

  return Array.from(rootMap.values())
    .map((group) => ({
      root: group.root || group.children[0] || null,
      children: [...group.children].sort((a, b) => Number(a.id || 0) - Number(b.id || 0)),
    }))
    .filter((group) => group.root)
    .sort((a, b) => Number(a.root.id || 0) - Number(b.root.id || 0))
}

export const flattenParseFileTree = (groups = []) => {
  const rows = []
  ;(Array.isArray(groups) ? groups : []).forEach((group) => {
    if (group?.root) rows.push(group.root)
    if (Array.isArray(group?.children)) rows.push(...group.children)
  })
  return rows
}

export const buildSheetSelectionDrafts = (files = []) => {
  const drafts = {}
  ;(Array.isArray(files) ? files : []).forEach((item) => {
    const file = normalizeParseFile(item)
    if (!['.xls', '.xlsx'].includes(file.source_ext)) return
    const manifestNames = file.sheet_manifest
      .map((sheet) => normalizeText(sheet?.name || sheet))
      .filter(Boolean)
    const selectedNames = file.selected_sheet_names
      .map((sheet) => normalizeText(sheet))
      .filter(Boolean)
    drafts[file.id] = selectedNames.length ? selectedNames : manifestNames
  })
  return drafts
}

export const buildClauseBulkPayload = (clauses = []) => ({
  items: (Array.isArray(clauses) ? clauses : []).map((item) => ({
    id: Number(item?.id || 0) || 0,
    clause_type: normalizeText(item?.clause_type).toUpperCase() || 'GENERAL',
    response_mode: normalizeText(item?.response_mode).toUpperCase() || 'TEXT',
    mandatory_flag: !!item?.mandatory_flag,
    scoring_flag: !!item?.scoring_flag,
    score_value: item?.score_value === '' || item?.score_value === null || item?.score_value === undefined
      ? null
      : Number(item.score_value),
  })),
})

export const buildMatchBulkPayload = (matches = []) => ({
  items: (Array.isArray(matches) ? matches : [])
    .map((item) => ({
      id: Number(item?.id || 0) || undefined,
      clause_id: Number(item?.clause_id || 0) || undefined,
      asset_id: Number(item?.asset_id || 0) || null,
      match_status: normalizeText(item?.match_status || item?.status).toUpperCase() || 'RECOMMENDED',
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0,
      reason_text: normalizeText(item?.reason_text),
      payload: item?.payload && typeof item.payload === 'object' ? item.payload : {},
    }))
    .filter((item) => item.id || item.asset_id || item.reason_text || item.match_status !== 'RECOMMENDED'),
})

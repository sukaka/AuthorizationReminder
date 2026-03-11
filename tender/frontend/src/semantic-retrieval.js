const normalizeText = (value) => String(value ?? '').trim()

const parseObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const matchSourceLabelMap = {
  RULE: '规则匹配',
  SEMANTIC: '语义召回',
  HYBRID: '混合召回',
}

const sourceLabelMap = {
  tender_assets: '项目资产',
  kb_asset_chunks: '知识库切块',
  kb_section_assets: '知识库章节',
  kb_project_cases: '知识库案例',
  kb_product_specs: '知识库参数',
  kb_company_qualifications: '知识库资质',
  kb_personnel_assets: '知识库人员',
}

export const normalizeSemanticMatchMeta = (item = {}) => {
  const payload = parseObject(item?.payload)
  const matchSource = normalizeText(item?.match_source).toUpperCase() || 'RULE'
  const sourceTable = normalizeText(payload?.source_table)
  return {
    match_source: matchSource,
    match_source_label: matchSourceLabelMap[matchSource] || matchSourceLabelMap.RULE,
    semantic_score: toNumber(payload?.semantic_score),
    rule_score: toNumber(payload?.rule_score),
    rerank_score: toNumber(payload?.rerank_score),
    need_manual_review: !!payload?.need_manual_review,
    manual_review_reasons: Array.isArray(payload?.manual_review_reasons) ? payload.manual_review_reasons.filter(Boolean) : [],
    chunk_preview: normalizeText(payload?.chunk_preview),
    source_table: sourceTable,
    source_label: sourceLabelMap[sourceTable] || '项目资产',
    chunk_title: normalizeText(payload?.title),
  }
}

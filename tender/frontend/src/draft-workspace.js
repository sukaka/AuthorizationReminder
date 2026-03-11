const normalizeText = (value) => String(value ?? '').trim()

const normalizeStringArray = (value) => {
  const items = Array.isArray(value) ? value : []
  return items
    .map((item) => normalizeText(item))
    .filter(Boolean)
}

const normalizeDraftSection = (item = {}, index = 0) => ({
  id: Number(item?.id || 0) || 0,
  section_title: normalizeText(item?.section_title) || '文档正文',
  paragraph_no: Number(item?.paragraph_no || index + 1) || index + 1,
  paragraph_text: normalizeText(item?.paragraph_text),
  requirement_ids: normalizeStringArray(item?.requirement_ids),
  evidence_ids: normalizeStringArray(item?.evidence_ids),
  score_item_ids: normalizeStringArray(item?.score_item_ids),
})

const normalizeDraftArtifactRow = (item = {}, index = 0) => {
  const artifactType = normalizeText(item?.artifact_type || item?.artifactType).toUpperCase()
  const base = {
    row_no: Number(item?.row_no || index + 1) || index + 1,
    parameter_key: normalizeText(item?.parameter_key),
    tender_requirement: normalizeText(item?.tender_requirement),
    satisfy_status: normalizeText(item?.satisfy_status),
    satisfy_basis: normalizeText(item?.satisfy_basis),
    evidence_source: normalizeText(item?.evidence_source),
    risk_level: normalizeText(item?.risk_level),
    risk_grade: normalizeText(item?.risk_grade || item?.risk_level),
    manual_review_required: Boolean(item?.manual_review_required),
  }
  if (
    artifactType === 'RESPONSE_TABLE'
    || (
      !Object.prototype.hasOwnProperty.call(item, 'bidder_response')
      && !Object.prototype.hasOwnProperty.call(item, 'deviation_note')
      && Object.prototype.hasOwnProperty.call(item, 'response_text')
    )
  ) {
    return {
      ...base,
      response_text: normalizeText(item?.response_text),
    }
  }
  return {
    ...base,
    bidder_response: normalizeText(item?.bidder_response),
    deviation_note: normalizeText(item?.deviation_note) || '无偏离',
  }
}

const normalizeDraftArtifactGroup = (rows = []) => (Array.isArray(rows) ? rows : [])
  .map((item, index) => normalizeDraftArtifactRow(item, index))
  .filter((item) => item.tender_requirement || item.bidder_response || item.response_text || item.evidence_source)

const normalizeOptimizationRecord = (item = {}) => ({
  id: Number(item?.id || 0) || 0,
  score_item_id: normalizeText(item?.score_item_id),
  suggestion_title: normalizeText(item?.suggestion_title),
  suggestion_text: normalizeText(item?.suggestion_text),
  source: normalizeText(item?.source).toUpperCase() || 'RULE',
  status: normalizeText(item?.status).toUpperCase() || 'PROPOSED',
  target_section_title: normalizeText(item?.target_section_title),
  strategy_profile_key: normalizeText(item?.strategy_profile_key),
  evidence_ids: normalizeStringArray(item?.evidence_ids),
  audit_trace: item?.audit_trace && typeof item.audit_trace === 'object'
    ? {
        strategy_hit_points: normalizeStringArray(item.audit_trace.strategy_hit_points),
        strategy_section_patterns: normalizeStringArray(item.audit_trace.strategy_section_patterns),
        strategy_source_project_ids: (Array.isArray(item.audit_trace.strategy_source_project_ids) ? item.audit_trace.strategy_source_project_ids : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      }
    : {
        strategy_hit_points: [],
        strategy_section_patterns: [],
        strategy_source_project_ids: [],
      },
})

export const createBidDraftWorkspaceState = () => ({
  loading: false,
  refreshing: false,
  error: '',
  bid: null,
  version: null,
  draft: null,
  source_job_id: null,
  sections: [],
  artifacts: {
    deviation_tables: {
      technical: [],
      business: [],
    },
    response_tables: {
      technical: [],
      business: [],
    },
  },
  latestCheckRun: null,
  latestCheckIssues: [],
  checkSummary: {
    issue_count: 0,
    fatal_count: 0,
    warn_count: 0,
  },
  scoreCoverageMatrix: [],
  scoreOptimizationRecords: [],
  autosaves: [],
  requirementRegistry: [],
  evidenceRegistry: [],
  clauseRegistryV2: [],
  pendingOptimizationCount: 0,
  appliedOptimizationCount: 0,
  savingSections: false,
  savingArtifacts: false,
  checking: false,
  optimizing: false,
  autosaving: false,
  rollingBackId: null,
})

export const buildBidDraftWorkspaceData = (payload = {}) => {
  const base = createBidDraftWorkspaceState()
  const sections = (Array.isArray(payload?.sections) ? payload.sections : [])
    .map((item, index) => normalizeDraftSection(item, index))
    .sort((a, b) => Number(a.paragraph_no || 0) - Number(b.paragraph_no || 0))

  const deviationTables = payload?.artifacts?.deviation_tables && typeof payload.artifacts.deviation_tables === 'object'
    ? payload.artifacts.deviation_tables
    : {}
  const responseTables = payload?.artifacts?.response_tables && typeof payload.artifacts.response_tables === 'object'
    ? payload.artifacts.response_tables
    : {}
  const scoreCoverageMatrix = Array.isArray(payload?.score_coverage_matrix) ? payload.score_coverage_matrix : []
  const scoreOptimizationRecords = (Array.isArray(payload?.score_optimization_records) ? payload.score_optimization_records : [])
    .map((item) => normalizeOptimizationRecord(item))
  const checkSummary = payload?.latest_check_run?.summary && typeof payload.latest_check_run.summary === 'object'
    ? payload.latest_check_run.summary
    : base.checkSummary

  return {
    ...base,
    bid: payload?.bid || null,
    version: payload?.version || null,
    draft: payload?.draft || null,
    source_job_id: Number(payload?.source_job_id || 0) || null,
    sections,
    artifacts: {
      deviation_tables: {
        technical: normalizeDraftArtifactGroup(deviationTables?.technical),
        business: normalizeDraftArtifactGroup(deviationTables?.business),
      },
      response_tables: {
        technical: normalizeDraftArtifactGroup(responseTables?.technical),
        business: normalizeDraftArtifactGroup(responseTables?.business),
      },
    },
    latestCheckRun: payload?.latest_check_run || null,
    latestCheckIssues: Array.isArray(payload?.latest_check_issues) ? payload.latest_check_issues : [],
    checkSummary: {
      issue_count: Number(checkSummary?.issue_count || 0),
      fatal_count: Number(checkSummary?.fatal_count || 0),
      warn_count: Number(checkSummary?.warn_count || 0),
    },
    scoreCoverageMatrix,
    scoreOptimizationRecords,
    autosaves: Array.isArray(payload?.autosaves) ? payload.autosaves : [],
    requirementRegistry: Array.isArray(payload?.requirement_registry) ? payload.requirement_registry : [],
    evidenceRegistry: Array.isArray(payload?.evidence_registry) ? payload.evidence_registry : [],
    clauseRegistryV2: Array.isArray(payload?.clause_registry_v2) ? payload.clause_registry_v2 : [],
    pendingOptimizationCount: scoreCoverageMatrix.filter((item) => Number(item?.optimization_needed_flag || 0) > 0).length,
    appliedOptimizationCount: scoreOptimizationRecords.filter((item) => String(item?.status || '').toUpperCase() === 'APPLIED').length,
  }
}

export const buildDraftSectionSavePayload = (sections = []) => ({
  sections: (Array.isArray(sections) ? sections : []).map((item, index) => {
    const normalized = normalizeDraftSection(item, index)
    return {
      id: normalized.id || undefined,
      section_title: normalized.section_title,
      paragraph_no: normalized.paragraph_no,
      paragraph_text: normalized.paragraph_text,
      requirement_ids: normalized.requirement_ids,
      evidence_ids: normalized.evidence_ids,
      score_item_ids: normalized.score_item_ids,
    }
  }),
})

export const buildDraftArtifactSavePayload = (artifacts = {}) => ({
  artifacts: {
    deviation_tables: {
      technical: normalizeDraftArtifactGroup(artifacts?.deviation_tables?.technical),
      business: normalizeDraftArtifactGroup(artifacts?.deviation_tables?.business),
    },
    response_tables: {
      technical: normalizeDraftArtifactGroup(artifacts?.response_tables?.technical),
      business: normalizeDraftArtifactGroup(artifacts?.response_tables?.business),
    },
  },
})

export default {
  createBidDraftWorkspaceState,
  buildBidDraftWorkspaceData,
  buildDraftSectionSavePayload,
  buildDraftArtifactSavePayload,
}

import test from 'node:test'
import assert from 'node:assert/strict'

import draftWorkspace from './draft-workspace.js'

const {
  createBidDraftWorkspaceState,
  buildBidDraftWorkspaceData,
  buildDraftSectionSavePayload,
  buildDraftArtifactSavePayload,
} = draftWorkspace

test('createBidDraftWorkspaceState returns stable empty editable state', () => {
  const state = createBidDraftWorkspaceState()

  assert.equal(state.loading, false)
  assert.equal(state.error, '')
  assert.deepEqual(state.sections, [])
  assert.deepEqual(state.artifacts.deviation_tables.technical, [])
  assert.deepEqual(state.artifacts.response_tables.business, [])
  assert.deepEqual(state.autosaves, [])
})

test('buildBidDraftWorkspaceData normalizes sections, artifacts, checks, and optimization records', () => {
  const data = buildBidDraftWorkspaceData({
    sections: [
      {
        id: 1,
        section_title: '售后服务方案',
        paragraph_no: 2,
        paragraph_text: '提供本地化运维和 7x24 响应。',
        requirement_ids: ['REQ-1'],
        evidence_ids: ['EVI-1'],
        score_item_ids: ['SCORE-1'],
      },
    ],
    artifacts: {
      deviation_tables: {
        technical: [{
          row_no: 1,
          tender_requirement: '双机热备',
          parameter_key: 'PARAM_3_2_1_双机热备',
          bidder_response: '满足',
          deviation_note: '无偏离',
          satisfy_status: '',
          satisfy_basis: '依据投标响应“满足”和偏离说明“无偏离”判定为满足。',
          evidence_source: '产品参数表',
          risk_level: '',
          risk_grade: 'LOW',
          manual_review_required: false,
        }],
        business: [],
      },
      response_tables: {
        technical: [],
        business: [{
          row_no: 1,
          tender_requirement: '提供授权',
          parameter_key: 'PARAM_BUS_1_提供授权',
          response_text: '已提供授权函',
          satisfy_status: '',
          satisfy_basis: '依据响应文本判定为满足。',
          evidence_source: '附件1',
          risk_level: '',
          risk_grade: 'LOW',
          manual_review_required: false,
        }],
      },
    },
    latest_check_run: {
      id: 7,
      summary: {
        issue_count: 3,
        fatal_count: 1,
        warn_count: 2,
      },
    },
    latest_check_issues: [{ id: 11, severity: 'FATAL', title: '缺少资质' }],
    score_coverage_matrix: [{ id: 31, coverage_status: 'PARTIAL', title: '售后服务方案', optimization_needed_flag: 1 }],
    score_optimization_records: [{
      id: 41,
      status: 'APPLIED',
      source: 'RULE_LEARNED',
      suggestion_title: '补强本地服务网点',
      strategy_profile_key: 'SERVICE|医疗',
      audit_trace: {
        strategy_hit_points: ['7×24小时响应', '本地服务团队'],
        strategy_section_patterns: ['售后服务方案'],
        strategy_source_project_ids: [101, 102],
      },
    }],
    autosaves: [{ id: 51, source: 'MANUAL' }],
  })

  assert.equal(data.sections.length, 1)
  assert.equal(data.artifacts.deviation_tables.technical.length, 1)
  assert.equal(data.artifacts.deviation_tables.technical[0].parameter_key, 'PARAM_3_2_1_双机热备')
  assert.equal(data.artifacts.response_tables.business[0].risk_grade, 'LOW')
  assert.equal(data.checkSummary.issue_count, 3)
  assert.equal(data.checkSummary.fatal_count, 1)
  assert.equal(data.pendingOptimizationCount, 1)
  assert.equal(data.appliedOptimizationCount, 1)
  assert.equal(data.scoreOptimizationRecords[0].strategy_profile_key, 'SERVICE|医疗')
  assert.equal(data.scoreOptimizationRecords[0].audit_trace.strategy_hit_points[0], '7×24小时响应')
  assert.equal(data.scoreOptimizationRecords[0].audit_trace.strategy_source_project_ids.length, 2)
  assert.equal(data.autosaves.length, 1)
})

test('buildDraftSectionSavePayload and buildDraftArtifactSavePayload keep editable structure stable', () => {
  const sectionPayload = buildDraftSectionSavePayload([
    {
      id: 1,
      section_title: '评分专项响应',
      paragraph_no: 1,
      paragraph_text: '补充本地服务与到场时效承诺。',
      requirement_ids: ['REQ-9'],
      evidence_ids: ['EVI-9'],
      score_item_ids: ['SCORE-9'],
    },
  ])

  const artifactPayload = buildDraftArtifactSavePayload({
    deviation_tables: {
      technical: [{
        row_no: 1,
        tender_requirement: '双机热备',
        parameter_key: 'PARAM_3_2_1_双机热备',
        bidder_response: '满足',
        deviation_note: '无偏离',
        satisfy_basis: '依据投标响应“满足”和偏离说明“无偏离”判定为满足。',
        evidence_source: '产品参数表',
        risk_grade: 'LOW',
      }],
      business: [],
    },
    response_tables: {
      technical: [],
      business: [{
        row_no: 1,
        tender_requirement: '提供授权',
        parameter_key: 'PARAM_BUS_1_提供授权',
        response_text: '已提供授权函',
        satisfy_basis: '依据响应文本判定为满足。',
        evidence_source: '附件1',
        risk_grade: 'LOW',
      }],
    },
  })

  assert.deepEqual(sectionPayload, {
    sections: [
      {
        id: 1,
        section_title: '评分专项响应',
        paragraph_no: 1,
        paragraph_text: '补充本地服务与到场时效承诺。',
        requirement_ids: ['REQ-9'],
        evidence_ids: ['EVI-9'],
        score_item_ids: ['SCORE-9'],
      },
    ],
  })

  assert.deepEqual(artifactPayload, {
    artifacts: {
      deviation_tables: {
        technical: [{
          row_no: 1,
          tender_requirement: '双机热备',
          parameter_key: 'PARAM_3_2_1_双机热备',
          bidder_response: '满足',
          deviation_note: '无偏离',
          satisfy_status: '',
          satisfy_basis: '依据投标响应“满足”和偏离说明“无偏离”判定为满足。',
          evidence_source: '产品参数表',
          risk_level: '',
          risk_grade: 'LOW',
          manual_review_required: false,
        }],
        business: [],
      },
      response_tables: {
        technical: [],
        business: [{
          row_no: 1,
          tender_requirement: '提供授权',
          parameter_key: 'PARAM_BUS_1_提供授权',
          response_text: '已提供授权函',
          satisfy_status: '',
          satisfy_basis: '依据响应文本判定为满足。',
          evidence_source: '附件1',
          risk_level: '',
          risk_grade: 'LOW',
          manual_review_required: false,
        }],
      },
    },
  })
})

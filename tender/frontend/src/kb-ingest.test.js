import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createKbIngestState,
  buildKbIngestWorkspaceData,
  buildKbIngestPayload,
} from './kb-ingest.js'

test('createKbIngestState returns stable defaults for project workspace usage', () => {
  const state = createKbIngestState()

  assert.equal(state.loading, false)
  assert.equal(state.error, '')
  assert.equal(state.form.project_type, '')
  assert.equal(state.form.result_status, 'IN_PROGRESS')
  assert.equal(state.form.tags_text, '')
  assert.deepEqual(state.stats, {
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
  })
})

test('buildKbIngestWorkspaceData normalizes defaults, stats, and ingest jobs from api payload', () => {
  const data = buildKbIngestWorkspaceData({
    linked_project: {
      id: 7,
      project_name: '政务云安全运营项目',
      tags_json: '["政务","service"]',
    },
    ingest_jobs: [
      {
        id: 3,
        status: 'success',
        output_summary: {
          clause_count: 8,
          chunk_count: 21,
        },
      },
    ],
    stats: {
      ingestable_clauses: '8',
      estimated_chunk_count: '21',
      clause_count: '6',
    },
    defaults: {
      project_name: '政务云安全运营项目',
      project_type: 'service',
      industry_type: '政务',
      region: '华东',
      result_status: 'won',
      bid_amount: '2800000',
      tags: ['政务', 'service'],
      remarks: '历史优质项目',
    },
  })

  assert.equal(data.linkedProject.id, 7)
  assert.equal(data.form.project_name, '政务云安全运营项目')
  assert.equal(data.form.project_type, 'SERVICE')
  assert.equal(data.form.result_status, 'WON')
  assert.equal(data.form.bid_amount, '2800000')
  assert.equal(data.form.tags_text, '政务, service')
  assert.equal(data.stats.ingestable_clauses, 8)
  assert.equal(data.stats.estimated_chunk_count, 21)
  assert.equal(data.stats.clause_count, 6)
  assert.equal(data.ingestJobs[0].status, 'SUCCESS')
})

test('buildKbIngestPayload trims fields and converts tag text into normalized array', () => {
  const payload = buildKbIngestPayload({
    project_name: ' 政务云安全运营项目 ',
    project_type: 'service',
    industry_type: ' 政务 ',
    region: ' 华东 ',
    result_status: 'won',
    bid_amount: '2800000',
    tags_text: '政务, service\ncloud-sec, 政务 ',
    remarks: ' 重点项目 ',
  })

  assert.deepEqual(payload, {
    project_name: '政务云安全运营项目',
    project_type: 'SERVICE',
    industry_type: '政务',
    region: '华东',
    result_status: 'WON',
    bid_amount: 2800000,
    tags: ['政务', 'service', 'cloud-sec'],
    remarks: '重点项目',
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'

import opsCenter from './ops-center.js'

const {
  createRiskCenterState,
  createTemplateCenterState,
  createExportCenterState,
  buildRiskCenterData,
  buildTemplateBundlePayload,
  buildExportCenterData,
  toggleListSelection,
  toggleAllListSelection,
  buildBulkDeleteFeedback,
} = opsCenter

test('createRiskCenterState returns stable empty filters and lists', () => {
  const state = createRiskCenterState()

  assert.equal(state.loading, false)
  assert.equal(state.filters.keyword, '')
  assert.equal(state.filters.level, '')
  assert.deepEqual(state.items, [])
  assert.equal(state.overview.high_risk_projects, 0)
})

test('buildRiskCenterData normalizes overview and items', () => {
  const data = buildRiskCenterData({
    overview: {
      total_projects: 3,
      high_risk_projects: 1,
      medium_risk_projects: 1,
    },
    items: [
      {
        bid_id: 11,
        title: '网络安全服务标书',
        project_name: '政务云安全运营项目',
        risk_level: 'high',
        risk_sources: ['待补资料', '成稿校验'],
      },
    ],
  })

  assert.equal(data.overview.total_projects, 3)
  assert.equal(data.overview.high_risk_projects, 1)
  assert.equal(data.items[0].risk_level, 'HIGH')
  assert.deepEqual(data.items[0].risk_sources, ['待补资料', '成稿校验'])
})

test('buildTemplateBundlePayload keeps only valid field and snippet refs', () => {
  const payload = buildTemplateBundlePayload({
    bundle_code: 'service_std',
    name: '服务类标准模板包',
    bid_type: 'SERVICE',
    description: '适用于服务类项目',
    field_ids: ['12', '0', '15'],
    snippet_ids: ['31', '', '32'],
  })

  assert.deepEqual(payload, {
    bundle_code: 'SERVICE_STD',
    name: '服务类标准模板包',
    bid_type: 'SERVICE',
    description: '适用于服务类项目',
    items: [
      { item_type: 'FIELD', ref_id: 12, bind_key: '', sort_order: 1 },
      { item_type: 'FIELD', ref_id: 15, bind_key: '', sort_order: 2 },
      { item_type: 'SNIPPET', ref_id: 31, bind_key: '', sort_order: 3 },
      { item_type: 'SNIPPET', ref_id: 32, bind_key: '', sort_order: 4 },
    ],
  })
})

test('buildExportCenterData sorts recent records and normalizes statuses', () => {
  const data = buildExportCenterData({
    overview: {
      ready_projects: 2,
      exported_projects: 1,
      recent_success_records: 3,
      recent_failed_records: 1,
    },
    items: [
      {
        bid_id: 7,
        title: '售后服务标书',
        status: 'export_ready',
        latest_export_record: {
          id: 91,
          export_type: 'pdf',
          status: 'success',
          created_at: '2026-03-08 10:00:00',
        },
      },
    ],
    recent_records: [
      { id: 1, export_type: 'docx', status: 'success', created_at: '2026-03-08 09:00:00' },
      { id: 2, export_type: 'package', status: 'failed', created_at: '2026-03-08 11:00:00' },
    ],
  })

  assert.equal(data.overview.ready_projects, 2)
  assert.equal(data.items[0].status, 'EXPORT_READY')
  assert.equal(data.items[0].latest_export_record.export_type, 'PDF')
  assert.equal(data.recent_records[0].id, 2)
  assert.equal(data.recent_records[0].status, 'FAILED')
})

test('createTemplateCenterState and createExportCenterState expose default forms', () => {
  const templateState = createTemplateCenterState()
  const exportState = createExportCenterState()

  assert.equal(templateState.bundleForm.bundle_code, '')
  assert.deepEqual(templateState.fields, [])
  assert.equal(exportState.filters.status, '')
  assert.deepEqual(exportState.recent_records, [])
})

test('toggleAllListSelection selects valid ids and clears when all are already selected', () => {
  const rows = [
    { id: '11' },
    { id: 12 },
    { id: 0 },
    { foo: 99 },
    { id: '12' },
  ]

  assert.deepEqual(toggleListSelection([], '11'), [11])
  assert.deepEqual(toggleListSelection([11, 12], '11'), [12])
  assert.deepEqual(toggleAllListSelection([], rows), [11, 12])
  assert.deepEqual(toggleAllListSelection([11, 12], rows), [])
})

test('buildBulkDeleteFeedback reports success and partial failures consistently', () => {
  assert.deepEqual(
    buildBulkDeleteFeedback({
      successCount: 3,
      failed: [],
      successMessage: '批量删除完成',
    }),
    { type: 'success', message: '批量删除完成，共 3 条' }
  )

  assert.deepEqual(
    buildBulkDeleteFeedback({
      successCount: 2,
      failed: [{ message: '字段已被模板包引用' }],
      successMessage: '批量删除完成',
      failureMessage: '批量删除失败',
    }),
    { type: 'error', message: '已删除 2 条，失败 1 条：字段已被模板包引用' }
  )
})

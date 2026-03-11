import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createEvaluationCenterState,
  buildEvaluationOverviewData,
  buildEvaluationDatasetPayload,
  buildEvaluationRunDetailData,
} from './evaluation-kpi.js'

test('createEvaluationCenterState returns stable defaults for evaluation center', () => {
  const state = createEvaluationCenterState()

  assert.equal(state.loading, false)
  assert.equal(state.error, '')
  assert.equal(state.datasetForm.eval_type, 'CLAUSE_RECOGNITION')
  assert.equal(state.datasetForm.baseline_flag, true)
  assert.equal(state.runForm.run_scope, 'BASELINE')
  assert.deepEqual(state.overview, {
    dataset_count: 0,
    baseline_dataset_count: 0,
    run_count: 0,
    latest_run: null,
    latest_baseline_run: null,
  })
})

test('buildEvaluationOverviewData normalizes counts, datasets, and recent runs', () => {
  const data = buildEvaluationOverviewData({
    overview: {
      dataset_count: '4',
      baseline_dataset_count: '3',
      run_count: '2',
      latest_run: {
        id: 9,
        run_scope: 'warning',
      },
    },
    dataset_counts_by_type: [
      { eval_type: 'clause_recognition', count: '2' },
      { eval_type: 'score_coverage', count: '1' },
    ],
    recent_runs: [
      {
        id: 9,
        run_scope: 'baseline',
        status: 'warning',
        summary: {
          overall_score: 0.82,
        },
      },
    ],
  })

  assert.equal(data.overview.dataset_count, 4)
  assert.equal(data.overview.baseline_dataset_count, 3)
  assert.equal(data.overview.run_count, 2)
  assert.equal(data.overview.latest_run.run_scope, 'WARNING')
  assert.equal(data.datasetCountsByType[0].eval_type, 'CLAUSE_RECOGNITION')
  assert.equal(data.datasetCountsByType[0].count, 2)
  assert.equal(data.recentRuns[0].run_scope, 'BASELINE')
  assert.equal(data.recentRuns[0].status, 'WARNING')
})

test('buildEvaluationDatasetPayload trims fields and parses expected payload json', () => {
  const payload = buildEvaluationDatasetPayload({
    bid_id: '18',
    dataset_name: ' 服务项目评测 ',
    eval_type: 'score_coverage',
    baseline_flag: false,
    notes: ' 重点关注评分覆盖 ',
    expected_payload_text: '{"score_item_names":["售后服务方案"],"recommended_points":["本地驻场"]}',
  })

  assert.deepEqual(payload, {
    bid_id: 18,
    dataset_name: '服务项目评测',
    eval_type: 'SCORE_COVERAGE',
    baseline_flag: false,
    notes: '重点关注评分覆盖',
    expected_payload: {
      score_item_names: ['售后服务方案'],
      recommended_points: ['本地驻场'],
    },
  })
})

test('buildEvaluationRunDetailData normalizes run and item detail payloads', () => {
  const data = buildEvaluationRunDetailData({
    run: {
      id: 7,
      run_scope: 'baseline',
      status: 'success',
      summary: {
        overall_score: 0.91,
      },
      baseline_summary: {
        overall_score_delta: 0.08,
      },
    },
    items: [
      {
        id: 11,
        eval_type: 'clause_recognition',
        status: 'pass',
        score: '0.93',
        result: {
          misses: ['SCORING'],
        },
      },
    ],
  })

  assert.equal(data.run.id, 7)
  assert.equal(data.run.run_scope, 'BASELINE')
  assert.equal(data.run.status, 'SUCCESS')
  assert.equal(data.items[0].eval_type, 'CLAUSE_RECOGNITION')
  assert.equal(data.items[0].status, 'PASS')
  assert.equal(data.items[0].score, 0.93)
  assert.deepEqual(data.items[0].result.misses, ['SCORING'])
})

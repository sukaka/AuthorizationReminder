import { describe, expect, it } from 'vitest';

import evaluationKpi from '../src/evaluation-kpi.js';

const {
  evaluateDatasetResult,
  buildRunSummary,
  buildBaselineDelta,
} = evaluationKpi;

describe('evaluation kpi helpers', () => {
  it('calculates clause recognition coverage from expected and actual clause facts', () => {
    const result = evaluateDatasetResult({
      dataset: {
        eval_type: 'CLAUSE_RECOGNITION',
        expected_payload: {
          clause_count: 10,
          mandatory_count: 3,
          scoring_count: 4,
          clause_types: ['QUALIFICATION', 'TECHNICAL', 'SERVICE', 'SCORING'],
        },
      },
      actual: {
        clause_count: 9,
        mandatory_count: 3,
        scoring_count: 2,
        clause_types: ['QUALIFICATION', 'TECHNICAL', 'SERVICE'],
      },
    });

    expect(result.eval_type).toBe('CLAUSE_RECOGNITION');
    expect(result.score).toBeCloseTo(0.83, 2);
    expect(result.metrics.coverage_ratio).toBeCloseTo(0.9, 3);
    expect(result.metrics.mandatory_hit_ratio).toBe(1);
    expect(result.metrics.scoring_hit_ratio).toBeCloseTo(0.5, 3);
    expect(result.misses).toContain('SCORING');
    expect(result.need_manual_review).toBe(false);
  });

  it('calculates score coverage and missing response points', () => {
    const result = evaluateDatasetResult({
      dataset: {
        eval_type: 'SCORE_COVERAGE',
        expected_payload: {
          score_item_names: ['售后服务方案', '项目团队'],
          recommended_points: ['7x24响应', '本地驻场', '项目经理经验'],
        },
      },
      actual: {
        score_item_names: ['售后服务方案'],
        recommended_points: ['7x24响应', '项目经理经验'],
      },
    });

    expect(result.score).toBeCloseTo(0.58, 2);
    expect(result.metrics.score_item_coverage_ratio).toBeCloseTo(0.5, 3);
    expect(result.metrics.response_point_coverage_ratio).toBeCloseTo(2 / 3, 3);
    expect(result.misses).toEqual(expect.arrayContaining(['项目团队', '本地驻场']));
  });

  it('calculates material matching hit ratio and manual review pressure', () => {
    const result = evaluateDatasetResult({
      dataset: {
        eval_type: 'MATERIAL_MATCHING',
        expected_payload: {
          required_asset_ids: ['A-001', 'A-002', 'A-003'],
        },
      },
      actual: {
        matched_asset_ids: ['A-001', 'A-003'],
        need_manual_review_count: 2,
        total_match_count: 4,
      },
    });

    expect(result.score).toBeCloseTo(0.58, 2);
    expect(result.metrics.match_hit_ratio).toBeCloseTo(2 / 3, 3);
    expect(result.metrics.manual_review_ratio).toBeCloseTo(0.5, 3);
    expect(result.misses).toEqual(['A-002']);
    expect(result.need_manual_review).toBe(true);
  });

  it('calculates risk recall and highlights high-risk misses', () => {
    const result = evaluateDatasetResult({
      dataset: {
        eval_type: 'RISK_RECALL',
        expected_payload: {
          risk_codes: ['SIGNATURE_SEAL_MISSING', 'PRICE_OVER_BUDGET', 'SERVICE_SLA_MISSING'],
          high_risk_codes: ['PRICE_OVER_BUDGET', 'SIGNATURE_SEAL_MISSING'],
        },
      },
      actual: {
        risk_codes: ['SIGNATURE_SEAL_MISSING'],
      },
    });

    expect(result.score).toBeCloseTo(0.33, 2);
    expect(result.metrics.risk_recall_ratio).toBeCloseTo(1 / 3, 3);
    expect(result.high_risk_misses).toEqual(['PRICE_OVER_BUDGET']);
    expect(result.need_manual_review).toBe(true);
  });

  it('calculates export completeness from required deliverables and latest export status', () => {
    const result = evaluateDatasetResult({
      dataset: {
        eval_type: 'EXPORT_COMPLETENESS',
        expected_payload: {
          required_deliverables: ['封面', '技术方案', '商务应答表', '报价表'],
        },
      },
      actual: {
        deliverables: ['封面', '技术方案', '报价表'],
        latest_export_status: 'FAILED',
      },
    });

    expect(result.score).toBeCloseTo(0.38, 2);
    expect(result.metrics.deliverable_coverage_ratio).toBeCloseTo(0.75, 3);
    expect(result.metrics.latest_export_success_ratio).toBe(0);
    expect(result.misses).toEqual(['商务应答表']);
    expect(result.need_manual_review).toBe(true);
  });

  it('aggregates run summary and baseline delta across KPI types', () => {
    const items = [
      {
        eval_type: 'CLAUSE_RECOGNITION',
        score: 0.92,
        need_manual_review: false,
      },
      {
        eval_type: 'SCORE_COVERAGE',
        score: 0.82,
        need_manual_review: false,
      },
      {
        eval_type: 'MATERIAL_MATCHING',
        score: 0.7,
        need_manual_review: true,
      },
      {
        eval_type: 'RISK_RECALL',
        score: 0.88,
        need_manual_review: false,
      },
      {
        eval_type: 'EXPORT_COMPLETENESS',
        score: 0.65,
        need_manual_review: true,
      },
    ];

    const summary = buildRunSummary(items);
    expect(summary.dataset_count).toBe(5);
    expect(summary.pass_count).toBe(3);
    expect(summary.warning_count).toBe(2);
    expect(summary.fail_count).toBe(0);
    expect(summary.overall_score).toBeCloseTo(0.794, 3);
    expect(summary.kpis.clause_recognition.score).toBe(0.92);
    expect(summary.kpis.export_completeness.status).toBe('WARNING');

    const delta = buildBaselineDelta({
      currentSummary: summary,
      baselineSummary: {
        overall_score: 0.74,
        kpis: {
          clause_recognition: { score: 0.9 },
          score_coverage: { score: 0.78 },
          material_matching: { score: 0.66 },
          risk_recall: { score: 0.91 },
          export_completeness: { score: 0.7 },
        },
      },
    });

    expect(delta.overall_score_delta).toBeCloseTo(0.054, 3);
    expect(delta.kpis.clause_recognition.delta).toBeCloseTo(0.02, 3);
    expect(delta.kpis.risk_recall.delta).toBeCloseTo(-0.03, 3);
    expect(delta.kpis.export_completeness.trend).toBe('DOWN');
  });
});

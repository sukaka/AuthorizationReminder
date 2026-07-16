import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { OpsDashboardPage } from '../src/pages/admin/OpsDashboardPage';
import { server } from './setup';

function mockOpsApis() {
  const checkpoint = vi.fn(() =>
    HttpResponse.json({
      total: 12,
      recovered: 12,
      failed: 0,
      recovery_rate: 1,
      target: 0.99,
      passed: true,
    }),
  );
  server.use(
    http.get('/api/ai/ops/snapshot', () =>
      HttpResponse.json({
        runs_total: 3,
        runs_succeeded: 2,
        runs_failed: 1,
        runs_running: 0,
        artifacts_total: 1,
        faqs_published: 1,
        faqs_draft: 0,
        learning_candidates_draft: 0,
        learning_candidates_published: 0,
        success_rate: 0.67,
        tool_invocations_in_progress: 0,
        tool_invocations_reconciliation_required: 0,
        direct_actions_reconciliation_required: 0,
        slo_audit: {
          overall: 'pass_with_gaps',
          fail_count: 0,
          gap_count: 2,
          metrics: {},
          notes: ['checkpoint/approval recovery metrics require staging evidence'],
          checks: [
            {
              id: 'checkpoint_recovery_rate',
              name: '检查点恢复率（需演练样本）',
              status: 'not_observed',
              actual: null,
              threshold: '>=0.999',
              detail: '需要 staging/混沌演练结果文件',
            },
          ],
        },
        notes: [],
        run_reconciliation_overall: 'pass',
        run_reconciliation_scanned_runs: 3,
        run_reconciliation_issue_count: 0,
        run_reconciliation_issue_counts: {},
      }),
    ),
    http.get('/api/ai/ops/run-reconciliation', () =>
      HttpResponse.json({
        overall: 'pass',
        scanned_runs: 3,
        issue_count: 0,
        issue_counts: {},
        issues: [],
        limit: 200,
      }),
    ),
    http.get('/api/ai/ops/feature-flags', () =>
      HttpResponse.json({ rollout_percent: 20, learning_auto_publish: false }),
    ),
    http.get('/api/ai/learning-candidates', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/ops/ga-report', () =>
      HttpResponse.json({
        overall: 'partial',
        summary: { passed: 5, failed: 0, unknown: 4, total: 9, sample_limit: 100 },
        items: [
          {
            key: 'checkpoint_recovery_rate',
            name: 'checkpoint 恢复成功率',
            target: '≥ 99%',
            value: 1,
            unit: 'ratio',
            status: 'pass',
            detail: 'ok',
          },
        ],
        notes: [],
      }),
    ),
    http.get('/api/ai/ops/cost-summary', () =>
      HttpResponse.json({ total_calls: 0, total_cost_micros: 0, by_agent: [] }),
    ),
    http.get('/api/ai/agent-hub/market', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/ops/readiness', () =>
      HttpResponse.json({
        overall: 'ready',
        elapsed_ms: 10,
        fail_count: 0,
        warn_count: 0,
        pass_count: 5,
        recommendation: 'ok',
        checks: [{ id: 'database', name: '数据库', status: 'pass' }],
      }),
    ),
    http.get('/api/ai/ops/security-audit', () =>
      HttpResponse.json({
        overall: 'pass',
        fail_count: 0,
        warn_count: 0,
        pass_count: 3,
        recommendation: 'ok',
        checks: [{ id: 'x', category: 'privilege', name: '示例', status: 'pass' }],
      }),
    ),
    http.get('/api/ai/agent-hub/health', () =>
      HttpResponse.json({
        items: [{ agent_id: 'local.echo', ok: true, status: 'ok', circuit_state: 'closed' }],
        total: 1,
        healthy: 1,
        overall: 'ok',
      }),
    ),
    http.post(/\/api\/ai\/ops\/checkpoint-suite/, checkpoint),
    http.post('/api/ai/learning-eval/ga-suite', () =>
      HttpResponse.json({ ga_rates: { citation_accuracy: 0.96, no_evidence_refusal_rate: 0.99 } }),
    ),
  );
  return { checkpoint };
}

it('runs checkpoint recovery suite from ops dashboard', async () => {
  const { checkpoint } = mockOpsApis();
  render(<OpsDashboardPage />);

  expect(await screen.findByRole('heading', { name: '6.0 运营看板' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Run / Step / Event 对账' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Agent Loop SLO 审计' })).toBeInTheDocument();
  expect(await screen.findByText(/有未观测项/)).toBeInTheDocument();
  expect(await screen.findByText(/实际 — \/ 阈值 >=0.999/)).toBeInTheDocument();
  expect(
    await screen.findByText('checkpoint/approval recovery metrics require staging evidence'),
  ).toBeInTheDocument();
  expect(await screen.findAllByText('连续观测快照：', { exact: false })).not.toHaveLength(0);
  const btn = await screen.findByRole('button', { name: 'Checkpoint 恢复套件' });
  await userEvent.click(btn);

  await waitFor(() => expect(checkpoint).toHaveBeenCalled());
  const checkpointStatus = await screen.findByText(/最近 checkpoint 套件/i);
  expect(checkpointStatus).toHaveTextContent('12/12');
  expect(checkpointStatus).toHaveTextContent(/rate\s*1/i);
});

it('allows an administrator to inspect and control one run by id', async () => {
  mockOpsApis();
  const pause = vi.fn();
  const resume = vi.fn();
  const rollback = vi.fn();
  let run = {
    run_id: 'run-ops-001',
    status: 'running',
    stage: 'executing',
    progress: 60,
    attempt: 1,
    state_version: 2,
  };
  const detail = () => ({
    run,
    steps: [{ sequence: 1, step_type: 'retrieve', status: 'succeeded' }],
    events: [{ sequence: 1, event_type: 'run_started' }],
    result: {},
    reconciliation: {
      overall: 'pass',
      scanned_runs: 1,
      issue_count: 0,
      issue_counts: {},
      issues: [],
      limit: 1,
    },
  });
  server.use(
    http.get('/api/ai/ops/runs/run-ops-001', () => HttpResponse.json(detail())),
    http.post('/api/ai/ops/runs/run-ops-001/pause', () => {
      pause();
      run = { ...run, status: 'paused', state_version: 3 };
      return HttpResponse.json({ run, snapshot: {}, side_effects_reversed: false });
    }),
    http.post('/api/ai/ops/runs/run-ops-001/resume', () => {
      resume();
      run = { ...run, status: 'running', state_version: 4 };
      return HttpResponse.json({ run, snapshot: run, side_effects_reversed: false });
    }),
    http.post('/api/ai/ops/runs/run-ops-001/rollback', () => {
      rollback();
      run = { ...run, status: 'paused', progress: 45, state_version: 5 };
      return HttpResponse.json({
        run,
        snapshot: {},
        checkpoint: { source: 'step', resume_source: 'ops_rollback', progress: 45 },
        side_effects_reversed: false,
      });
    }),
  );

  render(<OpsDashboardPage />);
  const control = await screen.findByRole('region', { name: '按 Run ID 控制' });
  await userEvent.type(within(control).getByRole('textbox', { name: 'Run ID' }), 'run-ops-001');
  await userEvent.click(within(control).getByRole('button', { name: '查询任务' }));

  expect(await within(control).findByText(/状态：running/)).toBeInTheDocument();
  expect(within(control).getByText(/范围对账：通过/)).toBeInTheDocument();
  expect(within(control).getByText(/Step 1 · retrieve · succeeded/)).toBeInTheDocument();

  await userEvent.click(within(control).getByRole('button', { name: '暂停任务' }));
  await waitFor(() => expect(pause).toHaveBeenCalledOnce());
  expect(await within(control).findByText(/状态：paused/)).toBeInTheDocument();

  await userEvent.click(within(control).getByRole('button', { name: '恢复任务' }));
  await waitFor(() => expect(resume).toHaveBeenCalledOnce());
  expect(await within(control).findByText(/状态：running/)).toBeInTheDocument();

  await userEvent.click(within(control).getByRole('button', { name: '回滚到安全检查点' }));
  await waitFor(() => expect(rollback).toHaveBeenCalledOnce());
  expect(await within(control).findByText(/状态：paused/)).toBeInTheDocument();
  expect(within(control).getByText(/不会撤销已发生的外部副作用/)).toBeInTheDocument();
});

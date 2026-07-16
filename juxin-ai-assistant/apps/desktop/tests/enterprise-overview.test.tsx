import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it } from 'vitest';

import App from '../src/App';
import { EnterpriseOverviewPage } from '../src/pages/EnterpriseOverviewPage';
import { server } from './setup';

const overview = {
  scope: {
    user_id: 'u-employee',
    role: 'employee',
    department: '交付部',
    managed_departments: ['交付部'],
    project_count: 2,
    project_uuids: ['project-a', 'project-b'],
    policy_version: 'enterprise-scope-v1',
    scope_fingerprint: 'fingerprint',
  },
  metrics: { projects: 2, tasks: 7, deliverables: 3, open_issues: 1, artifacts: 5 },
  metric_snapshots: [
    {
      metric_code: 'overdue_task_rate',
      definition_version: '1.0.0',
      scope: { type: 'project_membership', user_id: 'u-employee', project_uuids: ['project-a', 'project-b'] },
      scope_fingerprint: 'fingerprint',
      policy_version: 'enterprise-scope-v1',
      period_start: '2026-07-16T08:00:00Z',
      period_end: '2026-07-16T08:00:00Z',
      data_cutoff_at: '2026-07-16T08:00:00Z',
      data_version: 'live:ai_project_tasks/v1',
      numerator: 1,
      denominator: 4,
      value: 0.25,
      freshness: 'fresh',
      data_completeness: 1,
      suppressed: false,
      exclusions: ['done'],
      evidence_refs: ['project-a'],
    },
  ],
  project_health: [
    {
      project_uuid: 'project-a',
      project_name: '重点客户交付项目',
      score: 68,
      status: 'data_incomplete',
      confidence: 0.72,
      rule_version: 'project-health/1.0.0',
      as_of: '2026-07-16T08:00:00Z',
      dimensions: [
        { code: 'task_progress', label: '计划与任务进度', weight: 20, score: 75, data_completeness: 1, status: 'available', evidence_refs: ['project-a'] },
      ],
      deductions: [
        { code: 'OVERDUE_TASK', points: 25, reason: '有 1 个任务超过截止时间且未完成', evidence_refs: ['project-a'] },
      ],
    },
  ],
  freshness: { as_of: '2026-07-16T08:00:00Z', mode: 'live_query', is_stale: false },
  data_quality: {
    status: 'partial',
    gaps: ['organization_master_data', 'customer_master_data'],
    explanation: '当前总览仅使用现有项目工作表。',
  },
};

const operationSummary = {
  scope: overview.scope,
  as_of: '2026-07-16T08:00:00Z',
  contracts: { total: 2, confirmed: 1, pending_confirmation: 1 },
  services: { total: 3, confirmed: 2, pending_confirmation: 1, occurrences: 2, completed_occurrences: 1, overdue_occurrences: 0, missing_occurrences: 1 },
  tasks: { total: 7, open: 4, overdue: 1 },
  deliverables: { total: 3, approved: 2, pending: 1 },
  issues: { total: 1, open: 1, open_high_or_critical: 0, overdue_remediations: 0 },
  automation: { total: 4, succeeded: 3, failed: 1, active: 0, success_rate: 0.75, scope_mode: 'caller_owned_runs_until_project_scope_migration' },
  attention_items: [
    { type: 'overdue_task', severity: 'high', title: '交付任务即将超期', summary: '任务已超过截止时间且尚未完成。', project_uuid: 'project-a', project_name: '重点客户交付项目', evidence_refs: ['task-1', 'project-a'], status: 'open' },
  ],
};

const emptyNotifications = { items: [], total: 0, unread_count: 0 };

it('renders the scoped enterprise overview and refreshes it', async () => {
  let requests = 0;
  server.use(http.get('/api/ai/intelligence/overview', () => {
    requests += 1;
    return HttpResponse.json(overview);
  }), http.get('/api/ai/intelligence/insights', () => HttpResponse.json({ items: [] })), http.get('/api/ai/intelligence/operation-summary', () => HttpResponse.json(operationSummary)), http.get('/api/ai/intelligence/notifications', () => HttpResponse.json(emptyNotifications)));

  render(<EnterpriseOverviewPage />);

  expect(await screen.findByRole('heading', { name: '企业智能中枢' })).toBeInTheDocument();
  expect(screen.getByText(/已按成员关系过滤/)).toBeInTheDocument();
  expect(screen.getByText('当前总览仅使用现有项目工作表。')).toBeInTheDocument();
  expect(screen.getByText('超期任务率')).toBeInTheDocument();
  expect(screen.getByText('25.0%')).toBeInTheDocument();
  expect(screen.getByText('重点客户交付项目')).toBeInTheDocument();
  expect(screen.getByText('数据不完整')).toBeInTheDocument();
  expect(screen.getByText(/有 1 个任务超过截止时间且未完成/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '运营执行情况' })).toBeInTheDocument();
  expect(screen.getByText('1 项需处理')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '刷新总览' }));
  expect(requests).toBe(2);
});

it('runs a scoped management query from a whitelisted preset and renders evidence', async () => {
  let queryRequests = 0;
  let exportRequests = 0;
  server.use(
    http.get('/api/ai/intelligence/overview', () => HttpResponse.json(overview)),
    http.get('/api/ai/intelligence/insights', () => HttpResponse.json({ items: [] })),
    http.get('/api/ai/intelligence/operation-summary', () => HttpResponse.json({ ...operationSummary, attention_items: [] })),
    http.get('/api/ai/intelligence/notifications', () => HttpResponse.json(emptyNotifications)),
    http.post('/api/ai/intelligence/management/query', async ({ request }) => {
      queryRequests += 1;
      expect(await request.json()).toMatchObject({
        intent: 'compare_project_health',
        metrics: ['project_health_score'],
        group_by: ['project'],
        filters: [],
      });
      return HttpResponse.json({
        plan: {
          intent: 'compare_project_health',
          scope: { project_uuids: ['project-a'], department_ids: [] },
          period: { start: '2026-06-16', end: '2026-07-16' },
          metrics: ['project_health_score'],
          filters: [],
          group_by: ['project'],
          limit: 20,
          policy_version: 'enterprise-scope-v1',
          scope_fingerprint: 'fingerprint',
        },
        rows: [{
          group: { project_uuid: 'project-a', project_name: '重点客户交付项目' },
          metrics: { project_health_score: 68 },
          status: 'data_incomplete',
          confidence: 0.72,
          evidence_refs: ['project-a'],
        }],
        generated_at: '2026-07-16T08:00:00Z',
        evidence_refs: ['project-a'],
      });
    }),
    http.post('/api/ai/intelligence/management/export', async ({ request }) => {
      exportRequests += 1;
      expect(await request.json()).toMatchObject({
        intent: 'compare_project_health',
        metrics: ['project_health_score'],
        group_by: ['project'],
      });
      return new HttpResponse('\ufeffproject_name\r\n重点客户交付项目\r\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': "attachment; filename*=UTF-8''juxin-enterprise-query.csv",
        },
      });
    }),
  );

  render(<EnterpriseOverviewPage />);

  expect(await screen.findByRole('heading', { name: '管理问答' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /项目健康度对比/ }));
  expect(queryRequests).toBe(1);
  expect(await screen.findByText('查询结果')).toBeInTheDocument();
  expect(screen.getByText('项目健康分')).toBeInTheDocument();
  expect(screen.getAllByText('68')).toHaveLength(2);
  expect(screen.getByText(/范围指纹 fingerprint/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '导出当前结果' }));
  expect(exportRequests).toBe(1);
  expect(await screen.findByText(/已导出：/)).toBeInTheDocument();
});

it('shows the employee entry from the main navigation', async () => {
  server.use(
    http.get('/api/ai/session', () => HttpResponse.json({
      user: { id: 'u-employee', username: '员工用户', role: 'employee' },
      scope: { department: '交付部', managedDepartments: [] },
      apps: ['ai-assistant'],
      local_binding_token: 'signed-binding-token',
    })),
    http.get('/api/ai/home', () => HttpResponse.json({
      favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [],
    })),
    http.get('/api/ai/intelligence/overview', () => HttpResponse.json(overview)),
    http.get('/api/ai/intelligence/insights', () => HttpResponse.json({ items: [] })),
    http.get('/api/ai/intelligence/operation-summary', () => HttpResponse.json({ ...operationSummary, attention_items: [] })),
    http.get('/api/ai/intelligence/notifications', () => HttpResponse.json(emptyNotifications)),
  );

  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '企业智能中枢' }));
  expect(await screen.findByText('实时查询')).toBeInTheDocument();
});

it('keeps insight review human-gated and removes acknowledged items from attention', async () => {
  let reviewRequests = 0;
  const insight = {
    uuid: 'insight-1',
    insight_type: 'overdue_task',
    title: '交付任务即将超期',
    summary: '有一个任务需要负责人确认。',
    project_id: 1,
    status: 'open',
    severity: 'high',
    confidence: 0.9,
    scope_fingerprint: 'fingerprint',
    policy_version: 'enterprise-scope-v1',
    data_cutoff_at: '2026-07-16T08:00:00Z',
    data_version: 'project-task-v1',
    impact_scope: { project_uuid: 'project-a' },
    evidence_fingerprint: 'evidence',
    evidence_refs: ['task-1'],
    acknowledged_by: '',
    acknowledged_at: null,
    resolved_at: null,
    row_version: 1,
  };
  server.use(
    http.get('/api/ai/intelligence/overview', () => HttpResponse.json(overview)),
    http.get('/api/ai/intelligence/insights', () => HttpResponse.json({ items: [insight] })),
    http.get('/api/ai/intelligence/operation-summary', () => HttpResponse.json({ ...operationSummary, attention_items: [] })),
    http.get('/api/ai/intelligence/notifications', () => HttpResponse.json(emptyNotifications)),
    http.post('/api/ai/intelligence/insights/insight-1/acknowledge', async ({ request }) => {
      reviewRequests += 1;
      expect(await request.json()).toEqual({ feedback: '已由企业智能中枢人工确认' });
      return HttpResponse.json({ ...insight, status: 'acknowledged', row_version: 2 });
    }),
  );

  render(<EnterpriseOverviewPage />);

  expect(await screen.findByText('交付任务即将超期')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认关注' }));
  expect(reviewRequests).toBe(1);
  expect(await screen.findByText('暂无开放洞察')).toBeInTheDocument();
});

it('shows an enterprise notification and marks it read idempotently', async () => {
  let readRequests = 0;
  const notification = {
    notification_uuid: 'notification-1',
    insight_uuid: 'insight-1',
    insight_type: 'overdue_task',
    title: '交付任务即将超期',
    summary: '任务需要负责人确认。',
    severity: 'high',
    project_uuid: 'project-a',
    task_uuid: 'task-a',
    status: 'sent',
    delivery_status: 'sent',
    attempts: 1,
    unread: true,
    created_at: '2026-07-16T08:01:00Z',
    sent_at: '2026-07-16T08:01:00Z',
    read_at: null,
    data_cutoff_at: '2026-07-16T08:00:00Z',
    data_version: 'project-task-v1',
    last_error: null,
  };
  server.use(
    http.get('/api/ai/intelligence/overview', () => HttpResponse.json(overview)),
    http.get('/api/ai/intelligence/insights', () => HttpResponse.json({ items: [] })),
    http.get('/api/ai/intelligence/operation-summary', () => HttpResponse.json({ ...operationSummary, attention_items: [] })),
    http.get('/api/ai/intelligence/notifications', () => HttpResponse.json({ items: [notification], total: 1, unread_count: 1 })),
    http.post('/api/ai/intelligence/notifications/notification-1/read', ({ request }) => {
      readRequests += 1;
      expect(request.headers.get('Idempotency-Key')).toContain('enterprise-notification-read:');
      return HttpResponse.json({ ...notification, unread: false, read_at: '2026-07-16T08:02:00Z', replayed: false });
    }),
  );

  render(<EnterpriseOverviewPage />);

  expect(await screen.findByRole('heading', { name: '通知收件箱' })).toBeInTheDocument();
  expect(screen.getByText('1 条未读')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '标记已读' }));
  expect(readRequests).toBe(1);
  expect(await screen.findByText('已读')).toBeInTheDocument();
});

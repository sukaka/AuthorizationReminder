import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it } from 'vitest';

import { EnterpriseManagementPage } from '../src/pages/EnterpriseManagementPage';
import { server } from './setup';

const organization = {
  id: 7,
  uuid: 'org-7',
  external_id: 'org-7',
  name: '交付组织',
  status: 'active',
  project_count: 3,
};

const schedule = {
  schedule_uuid: 'schedule-1',
  organization_id: 7,
  owner_user_id: 'admin-1',
  workflow_id: '__enterprise_insight_scan__',
  name: '每日洞察扫描',
  cron_expression: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  enabled: true,
  next_fire_at: '2026-07-17T01:00:00Z',
  misfire_policy: 'fire_once',
  catch_up: false,
  idempotency_prefix: 'enterprise-insight',
  source_version: 'project-task-v1',
  policy_version: 'enterprise-scope-v1',
  scope_fingerprint: 'frozen-scope',
};

it('loads an organization-scoped management workspace and creates a scan plan', async () => {
  let createRequests = 0;
  server.use(
    http.get('/api/ai/intelligence/organizations', () => HttpResponse.json({ items: [organization] })),
    http.get('/api/ai/intelligence/organizations/7/insights/schedules', () => HttpResponse.json({ items: [] })),
    http.get('/api/ai/intelligence/organizations/7/capability-evaluations', () => HttpResponse.json({ items: [] })),
    http.get('/api/ai/intelligence/organizations/7/optimization-proposals', () => HttpResponse.json({ items: [] })),
    http.get('/api/ai/intelligence/audit-logs', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/intelligence/organizations/7/insights/schedules', async ({ request }) => {
      createRequests += 1;
      expect(request.headers.get('Idempotency-Key')).toMatch(/^insight-schedule:/);
      expect(await request.json()).toMatchObject({ cron_expression: '0 9 * * *', timezone: 'Asia/Shanghai' });
      return HttpResponse.json(schedule, { status: 201 });
    }),
  );

  render(<EnterpriseManagementPage />);

  expect(await screen.findByRole('heading', { name: '企业智能管理' })).toBeInTheDocument();
  expect(screen.getByText('交付组织 · 3 个项目')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '创建扫描计划' }));
  expect(createRequests).toBe(1);
  expect(await screen.findByText('洞察扫描计划已创建，执行范围已冻结。')).toBeInTheDocument();
  expect(screen.getByText('每日洞察扫描')).toBeInTheDocument();
});

import { expect, test, type Page } from '@playwright/test';

type RoleSession = {
  role: string;
  username: string;
  managedDepartments?: string[];
};

async function mockGovernanceApi(page: Page, session: RoleSession) {
  let configurationSaveCount = 0;
  await page.route('**/api/ai/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/ai/session') {
      return route.fulfill({ json: {
        user: { id: `e2e-${session.role}`, username: session.username, role: session.role },
        scope: {
          department: session.managedDepartments?.[0] || '销售部',
          managedDepartments: session.managedDepartments || [],
        },
        apps: ['ai-assistant'],
        local_binding_token: 'e2e-local-binding-token',
      } });
    }
    if (path === '/api/ai/home') {
      return route.fulfill({ json: { favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [] } });
    }
    if (session.role === 'employee' && path.startsWith('/api/ai/admin/')) {
      return route.fulfill({ status: 403, json: { detail: '仅管理员可执行' } });
    }
    if (path === '/api/ai/admin/tasks') {
      return route.fulfill({ json: { items: [{
        uuid: 'task-governance', code: 'sales-summary', name: '销售总结', status: 'ACTIVE',
        assistant_uuid: 'assistant-sales', fields: [],
        prompt_binding: { prompt_external_id: 88, version_policy: 'PINNED', pinned_version: 3, status: 'ACTIVE' },
      }], total: 1 } });
    }
    if (path === '/api/ai/capabilities') {
      return route.fulfill({ json: { items: [{
        task_uuid: 'task-governance', task_code: 'sales-summary', task_name: '销售总结',
        assistant_name: '销售助手', task_status: 'ACTIVE', input_fields: [],
        output_format: 'Markdown', document_type: '工作总结',
        prompt_binding_status: 'configured', knowledge_link_count: 0,
      }] } });
    }
    if (path === '/api/ai/admin/tasks/task-governance/configuration') {
      configurationSaveCount += 1;
      return route.fulfill({ json: {
        uuid: 'task-governance', code: 'sales-summary', name: '销售总结', status: 'ACTIVE',
        assistant_uuid: 'assistant-sales', fields: [],
        prompt_binding: { prompt_external_id: 88, version_policy: 'PINNED', pinned_version: 3, status: 'ACTIVE' },
      } });
    }
    if (path === '/api/ai/department-stats') {
      return route.fulfill({ json: { total: 26, completion_rate: 0.92, failure_rate: 0.08, departments: ['销售部'] } });
    }
    if (path === '/api/ai/admin/audit-logs') {
      return route.fulfill({ json: { items: [{
        id: 'audit-1', sso_user_id: 'admin-1', username_snapshot: '治理管理员', action: 'task.update', entity_type: 'task',
        entity_uuid: 'task-governance', metadata_json: {}, result: 'SUCCESS', created_at: '2026-06-20T10:00:00+08:00',
      }], total: 1 } });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${request.method()} ${path}` } });
  });
  return { configurationSaveCount: () => configurationSaveCount };
}

test('admin navigates governance and saves task configuration atomically', async ({ page }) => {
  const requests = await mockGovernanceApi(page, { role: 'admin', username: '治理管理员' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await page.getByRole('button', { name: '治理中心' }).click();
  await expect(page.getByRole('heading', { name: '任务管理' })).toBeVisible();
  await page.getByRole('button', { name: '刷新任务' }).click();
  await page.getByRole('button', { name: /销售总结/ }).click();
  await expect(page.getByLabel('内容模板 ID')).toHaveValue('88');
  await page.getByRole('button', { name: '保存并验证' }).click();
  await expect(page.getByText('任务、字段和内容模板绑定已保存。')).toBeVisible();
  expect(requests.configurationSaveCount()).toBe(1);
  await expect(page.getByText('服务端模型配置')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增用户' })).toHaveCount(0);
  for (const name of ['知识库', '建议审核', '全局统计', '审计日志', '系统设置', '管理入口']) {
    await page.getByRole('button', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: '任务管理' }).click();
  await page.getByRole('button', { name: '刷新任务' }).click();
  await page.getByRole('button', { name: /销售总结/ }).click();
  await page.screenshot({ path: 'output/playwright/governance-admin-wide.png', fullPage: true });

  await page.setViewportSize({ width: 720, height: 960 });
  await expect(page.getByRole('navigation', { name: '治理导航' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/governance-admin-narrow.png', fullPage: true });
  await page.getByRole('button', { name: '返回聊天' }).click();
  await expect(page.getByRole('heading', { name: /告诉我你想完成什么工作/ })).toBeVisible();
});

test('managed employee does not inherit administrator navigation', async ({ page }) => {
  await mockGovernanceApi(page, { role: 'employee', username: '销售负责人', managedDepartments: ['销售部'] });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '治理中心' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '部门数据' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交建议' })).toHaveCount(0);
});

test('auditor uses the separate audit system instead of AI governance', async ({ page }) => {
  await mockGovernanceApi(page, { role: 'auditor', username: '审计员' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '审计日志' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '治理中心' })).toHaveCount(0);
});

test('ordinary employee has no governance or department entry', async ({ page }) => {
  await mockGovernanceApi(page, { role: 'employee', username: '普通员工' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /告诉我你想完成什么工作/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '治理中心' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '部门数据' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '审计日志' })).toHaveCount(0);
  const directStatus = await page.evaluate(async () => (
    await fetch('/api/ai/admin/settings', { credentials: 'include' })
  ).status);
  expect(directStatus).toBe(403);
});

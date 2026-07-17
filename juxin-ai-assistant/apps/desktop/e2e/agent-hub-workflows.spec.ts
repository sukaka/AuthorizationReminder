import { expect, test, type Page } from '@playwright/test';

async function mockSessionAndHub(page: Page) {
  await page.route('**/api/ai/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/ai/session') {
      return route.fulfill({
        json: {
          user: { id: 'e2e-admin', username: 'E2E管理员', role: 'admin' },
          scope: { department: '研发部', managedDepartments: ['研发部'] },
          apps: ['ai-assistant'],
          local_binding_token: 'e2e-local-binding-token',
        },
      });
    }
    if (path === '/api/ai/home') {
      return route.fulfill({
        json: { favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [] },
      });
    }
    if (path === '/api/ai/projects') {
      return route.fulfill({ json: [] });
    }
    if (path === '/api/ai/catalog') {
      return route.fulfill({ json: { assistants: [] } });
    }
    if (path === '/api/ai/agent-hub/agents') {
      return route.fulfill({
        json: [
          {
            agent_id: 'local.echo',
            name: '本地回声 Agent',
            description: '本地试调',
            version: '0.1.0',
            capabilities: ['echo'],
            endpoint: '',
            status: 'available',
          },
          {
            agent_id: 'kimi.chat',
            name: 'Kimi 长文分析',
            description: '外部分析',
            version: '1.0.0',
            capabilities: ['long_document'],
            endpoint: 'https://api.moonshot.cn/v1/chat/completions',
            status: 'available',
          },
        ],
      });
    }
    if (path === '/api/ai/agent-hub/market') {
      return route.fulfill({
        json: {
          items: [
            { agent_id: 'local.echo', name: '本地回声 Agent', status: 'installed', cost_per_call_micros: 0 },
            { agent_id: 'kimi.chat', name: 'Kimi', status: 'installed', cost_per_call_micros: 2000 },
          ],
          total: 2,
        },
      });
    }
    if (path === '/api/ai/agent-hub/health') {
      return route.fulfill({
        json: {
          items: [
            { agent_id: 'local.echo', ok: true, status: 'ok', circuit_state: 'closed' },
            { agent_id: 'kimi.chat', ok: true, status: 'ok', circuit_state: 'closed', dry_run: true },
          ],
          total: 2,
          healthy: 2,
          overall: 'ok',
        },
      });
    }
    if (method === 'POST' && path.startsWith('/api/ai/agent-hub/agents/') && path.endsWith('/invoke')) {
      const id = path.split('/')[5];
      return route.fulfill({
        json: { agent_id: id, output: id === 'kimi.chat' ? '[kimi-dry-run] ok' : `[echo] e2e` },
      });
    }
    if (path === '/api/ai/workflows') {
      return route.fulfill({
        json: {
          items: [
            {
              id: 'serial_summary_echo',
              name: '串行：摘要→回声',
              description: 'demo',
              step_count: 2,
              custom: false,
            },
          ],
          total: 1,
        },
      });
    }
    if (path === '/api/ai/workflows/serial_summary_echo') {
      return route.fulfill({
        json: {
          id: 'serial_summary_echo',
          name: '串行：摘要→回声',
          steps: [
            { id: 'summary', type: 'invoke', params: { agent_id: 'local.summary' } },
            { id: 'echo', type: 'invoke', params: { agent_id: 'local.echo' } },
          ],
        },
      });
    }
    if (method === 'POST' && path === '/api/ai/workflows/serial_summary_echo/run') {
      return route.fulfill({
        json: {
          status: 'succeeded',
          steps: [
            { id: 'summary', type: 'invoke', status: 'succeeded', latency_ms: 3 },
            { id: 'echo', type: 'invoke', status: 'succeeded', latency_ms: 2 },
          ],
          agent_run_id: 'e2e-run-wf-1',
        },
      });
    }
    if (path === '/api/ai/runs') {
      return route.fulfill({
        json: {
          items: [
            {
              run_id: 'e2e-run-wf-1',
              title: '工作流任务',
              run_type: 'workflow',
              status: 'succeeded',
              stage: 'completed',
              progress: 100,
            },
          ],
          total: 1,
        },
      });
    }
    if (path.startsWith('/api/ai/runs/')) {
      return route.fulfill({
        json: {
          run: {
            run_id: 'e2e-run-wf-1',
            title: '工作流任务',
            status: 'succeeded',
            stage: 'completed',
            progress: 100,
          },
          steps: [],
          events: [],
        },
      });
    }

    // Soft-fallback for unrelated pages so navigation does not explode
    if (method === 'GET') {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${method} ${path}` } });
  });
}

test('admin opens Agent market and invokes echo', async ({ page }) => {
  await mockSessionAndHub(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 能力' }).click();
  await page.getByRole('button', { name: 'Agent 市场' }).click();
  await expect(page.getByRole('heading', { name: 'Agent 市场' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本地回声 Agent' })).toBeVisible();
  await page.getByRole('button', { name: /本地回声 Agent/ }).click();
  await page.getByRole('button', { name: '试调调用' }).click();
  await expect(page.getByText('调用成功 · local.echo')).toBeVisible();
});

test('user runs serial workflow and can jump to task center', async ({ page }) => {
  await mockSessionAndHub(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 能力' }).click();
  await page.getByRole('button', { name: '工作流' }).click();
  await expect(page.getByRole('heading', { name: '工作流' })).toBeVisible();
  await page.getByRole('button', { name: /串行：摘要/ }).click();
  await page.getByRole('button', { name: '运行工作流' }).click();
  await expect(page.getByText(/运行状态：成功/)).toBeVisible();
  await page.getByRole('button', { name: '在任务中心打开' }).click();
  await expect(page.getByRole('heading', { name: '任务中心' })).toBeVisible();
});

import { expect, test, type Page, type Route } from '@playwright/test';

const assistantNames = [
  '通用助手',
  '销售助手',
  '产品交付助手',
  '商务投标助手',
  '行政人力助手',
  '技术与安全服务助手',
  '文档生成助手',
  '培训考试助手',
];

const task = {
  uuid: 'task-sales-quote',
  code: 'quote-explanation',
  name: '报价说明生成',
  description: '把报价背景整理成可交付说明',
  output_format: 'Markdown',
  safety_notice: '生成内容必须人工复核',
  fields: [{
    field_key: 'background',
    label: '背景信息',
    field_type: 'TEXTAREA',
    required: true,
    placeholder: '填写客户背景',
    example: '',
    options: [],
    validation: {},
  }],
};

const catalog = {
  assistants: assistantNames.map((name, index) => ({
    uuid: `assistant-${index}`,
    code: `assistant-${index}`,
    name,
    description: `${name}业务任务`,
    icon: 'sparkles',
    tasks: index === 1
      ? [task]
      : [{ ...task, uuid: `task-${index}`, code: `task-${index}`, name: `${name}任务` }],
  })),
};

type E2eState = {
  generationUuid: string;
  output: string;
  deleted: boolean;
  feedback: string[];
  requestBodies: string[];
};

async function installTauriBridge(page: Page) {
  await page.addInitScript(({ draft }) => {
    const callbacks = new Map<number, (message: unknown) => void>();
    const eventCallbacks = new Map<string, number>();
    const deviceStore = new Map<string, string>([
      ['draft:u-e2e:task-sales-quote', JSON.stringify({
        values: { background: draft },
        expiresAt: Date.now() + 60_000,
      })],
    ]);
    let callbackId = 1;
    let generationCount = 0;
    const modelProcessSecret = 'e2e-model-process-secret';

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        transformCallback(callback: (message: unknown) => void) {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args: Record<string, any> = {}) {
          if (command === 'model_profile_list') {
            return [{
              id: 'profile-e2e', displayName: 'E2E 本地模型',
              baseUrl: 'http://127.0.0.1:19001/v1', modelId: 'e2e-model',
              temperature: 0.3, timeoutSeconds: 60, isDefault: true, hasApiKey: true,
            }];
          }
          if (command === 'device_store_get') return deviceStore.get(args.key) ?? null;
          if (command === 'device_store_set') {
            deviceStore.set(args.key, args.value);
            return null;
          }
          if (command === 'device_store_delete') {
            deviceStore.delete(args.key);
            return null;
          }
          if (command === 'plugin:event|listen') {
            eventCallbacks.set(args.event, args.handler);
            return callbackId++;
          }
          if (command === 'plugin:event|unlisten') return null;
          if (command === 'model_generate') {
            (window as any).__E2E_MODEL_PROCESS_INPUT__ = {
              ...args,
              apiKey: modelProcessSecret,
            };
            generationCount += 1;
            const output = generationCount === 1
              ? '# 报价说明\n已根据客户背景生成。'
              : '# 报价说明（新版）\n已重新生成。';
            const handlerId = eventCallbacks.get(`model://delta/${args.requestId}`);
            const callback = handlerId ? callbacks.get(handlerId) : undefined;
            callback?.({
              event: `model://delta/${args.requestId}`,
              id: handlerId,
              payload: { requestId: args.requestId, delta: output.slice(0, 8) },
            });
            await new Promise((resolve) => setTimeout(resolve, 25));
            callback?.({
              event: `model://delta/${args.requestId}`,
              id: handlerId,
              payload: { requestId: args.requestId, delta: output.slice(8) },
            });
            return { output, latencyMs: 25, usage: { output_tokens: 18 } };
          }
          if (command === 'model_cancel') return null;
          throw new Error(`Unexpected Tauri command: ${command}`);
        },
      },
    });
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
      configurable: true,
      value: {
        unregisterListener(event: string) {
          eventCallbacks.delete(event);
        },
      },
    });
  }, { draft: '联系 13800138000，准备标准报价' });
}

async function mockApi(page: Page, state: E2eState) {
  await page.route('**/api/ai/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.postData() || '';
    if (body) state.requestBodies.push(body);

    if (path === '/api/ai/session') {
      return route.fulfill({ json: {
        user: { id: 'u-e2e', username: '端到端员工', role: 'employee' },
        scope: { department: '销售部', managedDepartments: [] },
        apps: ['ai-assistant'],
      } });
    }
    if (path === '/api/ai/home') {
      return route.fulfill({ json: {
        favorites: [], recent_tasks: [], recent_generations: [],
        safety_reminders: ['生成内容必须人工复核'],
      } });
    }
    if (path === '/api/ai/catalog') {
      const query = url.searchParams.get('query');
      return route.fulfill({ json: query ? { assistants: [catalog.assistants[1]] } : catalog });
    }
    if (path.startsWith('/api/ai/favorites/')) {
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/ai/generations/prepare') {
      const payload = JSON.parse(body);
      if (!payload.sensitive_confirmation_digest) {
        return route.fulfill({ status: 409, json: { detail: {
          code: 'SENSITIVE_CONFIRMATION_REQUIRED',
          message: '检测到敏感信息',
          confirmation_digest: 'a'.repeat(64),
          findings: [{ code: 'PHONE', field: 'background', preview: '***' }],
        } } });
      }
      return route.fulfill({ status: 201, json: {
        generation_uuid: 'gen-e2e-1', completion_token: 'complete-e2e-1',
        messages: [{ role: 'user', content: '已脱敏的报价背景' }],
        temperature: 0.3, safety_notice: '生成内容必须人工复核',
      } });
    }
    if (path === '/api/ai/generations/gen-e2e-1/regenerate') {
      return route.fulfill({ status: 201, json: {
        generation_uuid: 'gen-e2e-2', completion_token: 'complete-e2e-2',
        parent_generation_uuid: 'gen-e2e-1',
        messages: [{ role: 'user', content: '重新生成报价说明' }],
        temperature: 0.3, safety_notice: '生成内容必须人工复核',
      } });
    }
    if (/\/api\/ai\/generations\/gen-e2e-[12]\/complete$/.test(path)) {
      const payload = JSON.parse(body);
      state.generationUuid = path.includes('gen-e2e-2') ? 'gen-e2e-2' : 'gen-e2e-1';
      state.output = payload.output;
      return route.fulfill({ json: { generation_uuid: state.generationUuid, status: 'COMPLETED' } });
    }
    if (/\/api\/ai\/generations\/gen-e2e-[12]\/feedback$/.test(path)) {
      state.feedback.push(JSON.parse(body).feedback_type);
      return route.fulfill({ status: 201, json: {
        uuid: 'feedback-e2e', generation_uuid: state.generationUuid, feedback_type: state.feedback.at(-1),
      } });
    }
    if (path === '/api/ai/generations' && request.method() === 'GET') {
      return route.fulfill({ json: { items: state.deleted || !state.generationUuid ? [] : [{
        uuid: state.generationUuid, task_uuid: task.uuid, task_name: task.name,
        assistant_code: 'sales', assistant_name: '销售助手', status: 'COMPLETED',
        model_display_name: 'E2E 本地模型', model_id: 'e2e-model', prompt_version: 1,
        latency_ms: 25, usage: {}, created_at: '2026-06-20T08:00:00Z', finished_at: '2026-06-20T08:00:01Z',
      }], total: state.deleted ? 0 : 1 } });
    }
    if (path === `/api/ai/generations/${state.generationUuid}` && request.method() === 'GET') {
      return route.fulfill({ json: {
        uuid: state.generationUuid, task_uuid: task.uuid, task_name: task.name,
        assistant_code: 'sales', assistant_name: '销售助手', status: 'COMPLETED',
        model_display_name: 'E2E 本地模型', model_id: 'e2e-model', prompt_version: 1,
        latency_ms: 25, usage: {}, created_at: '2026-06-20T08:00:00Z', finished_at: '2026-06-20T08:00:01Z',
        input: { background: '密文解密后的输入' }, output: state.output, knowledge_refs: [],
      } });
    }
    if (path === `/api/ai/generations/${state.generationUuid}` && request.method() === 'DELETE') {
      state.deleted = true;
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${request.method()} ${path}` } });
  });
}

test('employee completes the full local-model workflow without leaking its API key', async ({ page, context }) => {
  const state: E2eState = {
    generationUuid: '', output: '', deleted: false, feedback: [], requestBodies: [],
  };
  const networkPayloads: string[] = [];
  page.on('request', (request) => networkPayloads.push(`${request.url()}\n${request.postData() || ''}`));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installTauriBridge(page);
  await mockApi(page, state);

  await page.goto('/');
  await expect(page.getByText('上午好，端到端员工')).toBeVisible();
  await page.getByRole('button', { name: '浅色' }).click();
  await page.screenshot({ path: 'output/playwright/home-light.png', fullPage: true });
  await page.getByRole('button', { name: '深色' }).click();
  await page.screenshot({ path: 'output/playwright/home-dark.png', fullPage: true });

  await page.getByRole('button', { name: '全部助手', exact: true }).click();
  for (const name of assistantNames) await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByLabel('搜索助手或任务').fill('报价');
  await expect(page.getByText('报价说明生成')).toBeVisible();
  await expect(page.getByText('培训考试助手')).toHaveCount(0);
  await page.getByRole('button', { name: '收藏 报价说明生成' }).click();
  await expect(page.getByRole('button', { name: '取消收藏 报价说明生成' })).toBeVisible();
  await page.getByRole('button', { name: /报价说明生成/ }).first().click();

  await expect(page.getByLabel('背景信息')).toHaveValue('联系 13800138000，准备标准报价');
  await page.getByRole('button', { name: '浅色' }).click();
  await page.screenshot({ path: 'output/playwright/task-light.png', fullPage: true });
  await page.getByRole('button', { name: '深色' }).click();
  await page.screenshot({ path: 'output/playwright/task-dark.png', fullPage: true });
  await page.getByRole('button', { name: '开始生成' }).click();
  const warningDialog = page.getByRole('dialog', { name: '检测到敏感信息' });
  await expect(warningDialog).toBeVisible();
  await expect(warningDialog.getByText('13800138000')).toHaveCount(0);
  await expect(warningDialog.getByText(/\*\*\*/)).toBeVisible();
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expect(page.getByText('# 报价说明\n已根据客户背景生成。')).toBeVisible();
  await expect(page.getByText('结果已同步')).toBeVisible();
  await page.getByText('有帮助', { exact: true }).click();
  await page.getByRole('button', { name: '提交反馈' }).click();
  await expect.poll(() => state.feedback).toEqual(['USEFUL']);
  await page.getByRole('button', { name: '重新生成' }).click();
  await expect(page.getByText('# 报价说明（新版）\n已重新生成。')).toBeVisible();

  await page.getByRole('button', { name: '历史记录' }).click();
  await expect(page.getByRole('button', { name: /报价说明生成/ })).toBeVisible();
  await page.getByRole('button', { name: '浅色' }).click();
  await page.screenshot({ path: 'output/playwright/history-light.png', fullPage: true });
  await page.getByRole('button', { name: '深色' }).click();
  await page.screenshot({ path: 'output/playwright/history-dark.png', fullPage: true });
  await page.getByRole('button', { name: /报价说明生成/ }).click();
  await expect(page.getByText('# 报价说明（新版）\n已重新生成。')).toBeVisible();
  await page.getByRole('button', { name: '复制全文' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('新版');
  await page.getByRole('button', { name: '删除记录' }).click();
  await expect(page.getByText('# 报价说明（新版）\n已重新生成。')).toHaveCount(0);

  expect(await page.evaluate(() => (window as any).__E2E_MODEL_PROCESS_INPUT__.apiKey)).toBe('e2e-model-process-secret');
  expect(networkPayloads.join('\n')).not.toContain('e2e-model-process-secret');
  expect(state.requestBodies.join('\n')).not.toContain('e2e-model-process-secret');
});

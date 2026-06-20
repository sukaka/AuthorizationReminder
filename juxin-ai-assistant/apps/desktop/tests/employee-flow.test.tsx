import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import App from '../src/App';
import { TaskRunPage, type TaskDefinition } from '../src/pages/TaskRunPage';
import { server } from './setup';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

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

const catalog = {
  assistants: assistantNames.map((name, index) => ({
    uuid: `assistant-${index}`,
    code: `assistant-${index}`,
    name,
    description: `${name}描述`,
    icon: 'sparkles',
    tasks: [
      {
        uuid: `task-${index}`,
        code: `task-${index}`,
        name: index === 1 ? '报价说明生成' : `${name}任务`,
        description: '任务描述',
        output_format: 'Markdown',
        safety_notice: '需人工复核',
        fields: [
          {
            field_key: 'background',
            label: '背景信息',
            field_type: 'TEXTAREA',
            required: true,
            options: [],
            validation: {},
          },
        ],
      },
    ],
  })),
};

beforeEach(() => {
  invokeMock.mockReset();
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
});

it('shows all assistants regardless of the signed-in department and supports task search', async () => {
  const favoriteRequest = vi.fn();
  server.use(
    http.get('/api/ai/session', () =>
      HttpResponse.json({
        user: { id: 'u-sales', username: '销售员工', role: 'employee' },
        scope: { department: '销售部', managedDepartments: [] },
        apps: ['ai-assistant'],
      }),
    ),
    http.get('/api/ai/home', () =>
      HttpResponse.json({
        favorites: [],
        recent_tasks: [],
        recent_generations: [],
        safety_reminders: ['生成内容必须人工复核'],
      }),
    ),
    http.get('/api/ai/catalog', ({ request }) => {
      const query = new URL(request.url).searchParams.get('query');
      if (query === '报价') {
        return HttpResponse.json({
          assistants: [catalog.assistants[1]],
        });
      }
      return HttpResponse.json(catalog);
    }),
    http.put('/api/ai/favorites/task-1', () => {
      favoriteRequest();
      return new HttpResponse(null, { status: 204 });
    }),
  );

  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '全部助手' }));

  for (const name of assistantNames) {
    expect(await screen.findByText(name)).toBeInTheDocument();
  }

  await userEvent.type(screen.getByLabelText('搜索助手或任务'), '报价');
  expect(await screen.findByText('报价说明生成')).toBeInTheDocument();
  expect(screen.queryByText('培训考试助手')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '收藏 报价说明生成' }));
  await waitFor(() => expect(favoriteRequest).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: '取消收藏 报价说明生成' })).toBeInTheDocument();
});

it('requires explicit confirmation for the current sensitive digest', async () => {
  const prepareBodies: unknown[] = [];
  const task: TaskDefinition = {
    uuid: 'task-sensitive',
    code: 'sensitive-task',
    name: '敏感任务',
    description: '测试敏感确认',
    output_format: 'Markdown',
    safety_notice: '需人工复核',
    fields: [
      {
        field_key: 'background',
        label: '背景信息',
        field_type: 'TEXTAREA',
        required: true,
        options: [],
        validation: {},
      },
    ],
  };
  server.use(
    http.post('/api/ai/generations/prepare', async ({ request }) => {
      const body = await request.json();
      prepareBodies.push(body);
      if (!(body as { sensitive_confirmation_digest?: string }).sensitive_confirmation_digest) {
        return HttpResponse.json(
          {
            detail: {
              code: 'SENSITIVE_CONFIRMATION_REQUIRED',
              message: '检测到敏感信息',
              confirmation_digest: 'a'.repeat(64),
              findings: [
                { code: 'PHONE', field: 'background', preview: '***' },
              ],
            },
          },
          { status: 409 },
        );
      }
      return HttpResponse.json(
        {
          generation_uuid: 'gen-sensitive',
          completion_token: 'complete-sensitive',
          messages: [{ role: 'user', content: '已确认' }],
          temperature: 0.3,
          safety_notice: '需人工复核',
        },
        { status: 201 },
      );
    }),
    http.post('/api/ai/generations/gen-sensitive/complete', () =>
      HttpResponse.json({
        generation_uuid: 'gen-sensitive',
        status: 'COMPLETED',
      }),
    ),
  );
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.resolve([
        {
          id: 'profile-1',
          displayName: '公司模型',
          baseUrl: 'https://model.example/v1',
          modelId: 'model',
          temperature: 0.3,
          timeoutSeconds: 60,
          isDefault: true,
          hasApiKey: true,
        },
      ]);
    }
    if (command === 'device_store_get') return Promise.resolve(null);
    if (command === 'device_store_set') return Promise.resolve();
    if (command === 'model_generate') {
      return Promise.resolve({
        output: '生成结果',
        latencyMs: 10,
        usage: {},
      });
    }
    return Promise.resolve();
  });

  render(<TaskRunPage task={task} userId="u-1" />);
  await userEvent.type(screen.getByLabelText('背景信息'), '联系 13800138000');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(
    await screen.findByRole('dialog', { name: '检测到敏感信息' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('13800138000')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认并继续' }));

  expect(await screen.findByText('生成结果')).toBeInTheDocument();
  expect(prepareBodies).toHaveLength(2);
  expect(prepareBodies[1]).toEqual(
    expect.objectContaining({
      sensitive_confirmation_digest: 'a'.repeat(64),
    }),
  );
});

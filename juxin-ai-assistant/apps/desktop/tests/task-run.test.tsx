import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import { TaskRunPage, type TaskDefinition } from '../src/pages/TaskRunPage';
import { server } from './setup';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const workSummaryTask: TaskDefinition = {
  uuid: 'task-1',
  name: '工作总结',
  description: '把零散工作整理成结构清晰、可直接发送的总结。',
  safety_notice: '需人工复核',
  fields: [
    {
      field_key: 'work_content',
      label: '工作内容',
      field_type: 'TEXTAREA',
      required: true,
      placeholder: '写下本期完成的工作',
    },
    {
      field_key: 'audience',
      label: '阅读对象',
      field_type: 'SELECT',
      required: false,
      options: ['直属领导', '项目组'],
    },
  ],
};

beforeEach(() => {
  invokeMock.mockReset();
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
});

it('prepares provider-neutral messages, invokes Tauri and completes history', async () => {
  const completeRequest = vi.fn();
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json(
        {
          generation_uuid: 'gen-1',
          completion_token: 'complete-1',
          messages: [{ role: 'user', content: '总结本周工作' }],
          temperature: 0.3,
          safety_notice: '需人工复核',
        },
        { status: 201 },
      ),
    ),
    http.post('/api/ai/generations/gen-1/complete', async ({ request }) => {
      completeRequest(await request.json());
      return HttpResponse.json({ generation_uuid: 'gen-1', status: 'COMPLETED' });
    }),
  );
  invokeMock
    .mockResolvedValueOnce([
      {
        id: 'profile-1',
        displayName: '公司模型',
        baseUrl: 'https://model.example/v1/',
        modelId: 'example-model',
        temperature: 0.3,
        timeoutSeconds: 60,
        isDefault: true,
        hasApiKey: true,
      },
    ])
    .mockResolvedValueOnce({
      output: '# 本周总结',
      latencyMs: 120,
      usage: { input_tokens: 12, output_tokens: 24 },
    });

  render(<TaskRunPage task={workSummaryTask} />);

  await userEvent.type(screen.getByLabelText('工作内容'), '完成统一登录接入');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByText('# 本周总结')).toBeInTheDocument();
  expect(invokeMock).toHaveBeenCalledWith(
    'model_generate',
    expect.objectContaining({
      profileId: 'profile-1',
      requestId: expect.any(String),
      messages: [{ role: 'user', content: '总结本周工作' }],
    }),
  );
  await waitFor(() =>
    expect(completeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        completion_token: 'complete-1',
        output: '# 本周总结',
        model_display_name: '公司模型',
        model_id: 'example-model',
        latency_ms: 120,
      }),
    ),
  );
});

it('keeps API keys out of the browser-only experience', () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: undefined,
  });

  render(<TaskRunPage task={workSummaryTask} />);

  expect(screen.getByText('生成能力仅在聚信 AI 助手桌面客户端中可用')).toBeInTheDocument();
  expect(screen.queryByLabelText(/API Key/i)).not.toBeInTheDocument();
});

it('cancels the active local request with its request id', async () => {
  let resolveGeneration: ((value: unknown) => void) | undefined;
  const pendingGeneration = new Promise((resolve) => {
    resolveGeneration = resolve;
  });
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json(
        {
          generation_uuid: 'gen-cancel',
          completion_token: 'complete-cancel',
          messages: [{ role: 'user', content: '待取消' }],
          temperature: 0.3,
          safety_notice: '需人工复核',
        },
        { status: 201 },
      ),
    ),
  );
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.resolve([
        {
          id: 'profile-1',
          displayName: '公司模型',
          baseUrl: 'https://model.example/v1/',
          modelId: 'example-model',
          temperature: 0.3,
          timeoutSeconds: 60,
          isDefault: true,
          hasApiKey: true,
        },
      ]);
    }
    if (command === 'model_generate') return pendingGeneration;
    if (command === 'model_cancel') {
      resolveGeneration?.({ output: '', latencyMs: 0, usage: {} });
      return Promise.resolve();
    }
    return Promise.reject(new Error(`unexpected command: ${command}`));
  });

  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '需要中止的生成');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));
  await userEvent.click(await screen.findByRole('button', { name: '停止生成' }));

  const generateCall = invokeMock.mock.calls.find(([command]) => command === 'model_generate');
  const cancelCall = invokeMock.mock.calls.find(([command]) => command === 'model_cancel');
  expect(cancelCall?.[1].requestId).toBe(generateCall?.[1].requestId);
});

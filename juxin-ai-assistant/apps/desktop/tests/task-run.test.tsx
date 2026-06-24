import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import { TaskRunPage, type TaskDefinition } from '../src/pages/TaskRunPage';
import type { ModelGenerateResult } from '../src/types/tauri';
import { server } from './setup';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const workSummaryTask: TaskDefinition = {
  uuid: 'task-1',
  code: 'work-summary',
  name: '工作总结',
  description: '把零散工作整理成结构清晰、可直接发送的总结。',
  output_format: 'Markdown',
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
  invokeMock.mockResolvedValue([]);
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => undefined);
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
});

it('renders a top task summary and two-column work area', () => {
  const { container } = render(<TaskRunPage task={workSummaryTask} />);
  expect(container.querySelector('.task-summary')).toBeInTheDocument();
  expect(container.querySelector('.task-workspace')).toBeInTheDocument();
  expect(container.querySelector('.task-workspace > .task-form')).toBeInTheDocument();
  expect(container.querySelector('.task-workspace > .result-panel')).toBeInTheDocument();
});

it('renders model delta events before the local request completes', async () => {
  let deltaHandler: ((event: { payload: { delta: string } }) => void) | undefined;
  let finishGeneration: ((value: ModelGenerateResult) => void) | undefined;
  const pending = new Promise<ModelGenerateResult>((resolve) => {
    finishGeneration = resolve;
  });
  listenMock.mockImplementation((_event: string, handler: typeof deltaHandler) => {
    deltaHandler = handler;
    return Promise.resolve(() => undefined);
  });
  server.use(
    http.post('/api/ai/generations/prepare', () => HttpResponse.json({
      generation_uuid: 'gen-stream', completion_token: 'complete-stream',
      messages: [{ role: 'user', content: '流式生成' }], temperature: 0.3, safety_notice: '需人工复核',
    }, { status: 201 })),
    http.post('/api/ai/generations/gen-stream/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-stream', status: 'COMPLETED' })),
  );
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') return Promise.resolve([{
      id: 'profile-1', displayName: '公司模型', baseUrl: 'https://model.example/v1/',
      modelId: 'model-1', temperature: 0.3, timeoutSeconds: 60, isDefault: true, hasApiKey: true,
    }]);
    if (command === 'model_generate') return pending;
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '测试流式');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));
  await waitFor(() => expect(deltaHandler).toBeDefined());
  deltaHandler?.({ payload: { delta: '第一段' } });

  expect(await screen.findByText('第一段')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();
  finishGeneration?.({ output: '第一段第二段', latencyMs: 10, usage: {} });
  expect(await screen.findByText('第一段第二段')).toBeInTheDocument();
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

it('downloads Word only after the result is synchronized', async () => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:word-export'),
  });
  const revoke = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revoke,
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
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
    http.post('/api/ai/generations/gen-1/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-1', status: 'COMPLETED' }),
    ),
    http.get('/api/ai/generations/gen-1/export.docx', () =>
      new HttpResponse(new Blob(['docx']), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''work.docx",
        },
      })),
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

  try {
    render(<TaskRunPage task={workSummaryTask} />);

    await userEvent.type(screen.getByLabelText('工作内容'), '完成统一登录接入');
    await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(await screen.findByRole('button', { name: '导出 Word' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '导出 Word' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(revoke).not.toHaveBeenCalled();
    await waitFor(
      () => expect(revoke).toHaveBeenCalledWith('blob:word-export'),
      { timeout: 1500 },
    );
  } finally {
    click.mockRestore();
  }
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

it('shows sensitive findings with task field labels and hides empty fields', async () => {
  const sensitiveTask: TaskDefinition = {
    ...workSummaryTask,
    fields: [
      {
        field_key: 'blank_slot_05',
        label: '登录账号密码',
        field_type: 'TEXT',
        required: false,
        placeholder: '如需模型处理再填写',
      },
      {
        field_key: 'blank_slot_06',
        label: '备用账号密码',
        field_type: 'TEXT',
        required: false,
        placeholder: '可留空',
      },
    ],
  };
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json({
        detail: {
          code: 'SENSITIVE_CONFIRMATION_REQUIRED',
          confirmation_digest: 'digest-sensitive',
          findings: [
            { code: 'ACCOUNT_PASSWORD', field: 'blank_slot_05', preview: '***' },
            { code: 'ACCOUNT_PASSWORD', field: 'blank_slot_06', preview: '***' },
          ],
        },
      }, { status: 409 }),
    ),
  );
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.resolve([{
        id: 'profile-1',
        displayName: '公司模型',
        baseUrl: 'https://model.example/v1/',
        modelId: 'model-1',
        temperature: 0.3,
        timeoutSeconds: 60,
        isDefault: true,
        hasApiKey: true,
      }]);
    }
    return Promise.resolve();
  });

  render(<TaskRunPage task={sensitiveTask} />);
  await userEvent.type(screen.getByLabelText('登录账号密码'), 'admin/password: secret');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  const dialog = await screen.findByRole('dialog', { name: '检测到敏感信息' });
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByText('登录账号密码')).toBeInTheDocument();
  expect(within(dialog).queryByText('blank_slot_05')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('blank_slot_06')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('备用账号密码')).not.toBeInTheDocument();
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

it('restores and saves a user-scoped encrypted device draft', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') return Promise.resolve([]);
    if (command === 'local_draft_load') {
      return Promise.resolve({
        task_id: 'task-1',
        content: JSON.stringify({ work_content: '设备草稿' }),
        saved_at: Math.floor(Date.now() / 1000),
      });
    }
    if (command === 'local_draft_save') return Promise.resolve();
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} userId="u-draft" />);

  expect(await screen.findByDisplayValue('设备草稿')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('工作内容'), '继续');
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
    'local_draft_save',
    expect.objectContaining({ userId: 'u-draft', taskId: 'task-1' }),
  ));
});

it('keeps a completed local result in the encrypted pending queue when sync fails', async () => {
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json({
        generation_uuid: 'gen-offline',
        completion_token: 'complete-offline',
        messages: [{ role: 'user', content: '生成' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
      }, { status: 201 }),
    ),
    http.post('/api/ai/generations/gen-offline/complete', () =>
      HttpResponse.json({ detail: 'offline' }, { status: 503 }),
    ),
  );
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.resolve([{
        id: 'profile-1',
        displayName: '公司模型',
        baseUrl: 'https://model.example/v1/',
        modelId: 'model-1',
        temperature: 0.3,
        timeoutSeconds: 60,
        isDefault: true,
        hasApiKey: true,
      }]);
    }
    if (command === 'model_generate') {
      return Promise.resolve({ output: '离线结果', latencyMs: 20, usage: {} });
    }
    if (command === 'local_draft_load') return Promise.resolve(null);
    if (command === 'local_queue_push') return Promise.resolve();
    if (command === 'local_draft_delete') return Promise.resolve();
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} userId="u-1" />);
  await userEvent.type(screen.getByLabelText('工作内容'), '离线生成');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByText('结果已保存在本机，恢复连接后自动同步')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '导出 Word' })).toBeDisabled();
  expect(invokeMock).toHaveBeenCalledWith(
    'local_queue_push',
    expect.objectContaining({ userId: 'u-1', resultId: 'gen-offline' }),
  );
});

it('submits result feedback and regenerates through the local model boundary', async () => {
  const feedbackRequest = vi.fn();
  const regenerateRequest = vi.fn();
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json({
        generation_uuid: 'gen-first',
        completion_token: 'complete-first',
        messages: [{ role: 'user', content: '第一次' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
      }, { status: 201 }),
    ),
    http.post('/api/ai/generations/gen-first/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-first', status: 'COMPLETED' })),
    http.post('/api/ai/generations/gen-first/feedback', async ({ request }) => {
      feedbackRequest(await request.json());
      return HttpResponse.json({ uuid: 'feedback-1', generation_uuid: 'gen-first', feedback_type: 'USEFUL' }, { status: 201 });
    }),
    http.post('/api/ai/generations/gen-first/regenerate', () => {
      regenerateRequest();
      return HttpResponse.json({
        generation_uuid: 'gen-second',
        completion_token: 'complete-second',
        parent_generation_uuid: 'gen-first',
        messages: [{ role: 'user', content: '第二次' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
      }, { status: 201 });
    }),
    http.post('/api/ai/generations/gen-second/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-second', status: 'COMPLETED' })),
  );
  let generateCount = 0;
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') return Promise.resolve([{
      id: 'profile-1', displayName: '公司模型', baseUrl: 'https://model.example/v1/',
      modelId: 'model-1', temperature: 0.3, timeoutSeconds: 60, isDefault: true, hasApiKey: true,
    }]);
    if (command === 'model_generate') {
      generateCount += 1;
      return Promise.resolve({ output: generateCount === 1 ? '初版结果' : '新版结果', latencyMs: 10, usage: {} });
    }
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '生成内容');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));
  expect(await screen.findByText('初版结果')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('radio', { name: '有帮助' }));
  await userEvent.click(screen.getByRole('button', { name: '提交反馈' }));
  await waitFor(() => expect(feedbackRequest).toHaveBeenCalledWith({ feedback_type: 'USEFUL' }));

  await userEvent.click(screen.getByRole('button', { name: '重新生成' }));
  expect(await screen.findByText('新版结果')).toBeInTheDocument();
  expect(regenerateRequest).toHaveBeenCalledTimes(1);
  expect(generateCount).toBe(2);
});

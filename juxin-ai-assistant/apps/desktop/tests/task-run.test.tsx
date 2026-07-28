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
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
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
  expect(screen.queryByText('为什么会访问钥匙串？')).not.toBeInTheDocument();
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
      context_usage: { characters: 1236, estimated_tokens: 309, estimator: 'rough_chars_div_4' },
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
  expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();
  finishGeneration?.({
    output: '第一段第二段',
    latencyMs: 10,
    usage: { input_tokens: 12, output_tokens: 24 },
  });
  expect(await screen.findByText('第一段第二段')).toBeInTheDocument();
  expect(await screen.findByText('本次生成约 36 tokens')).toBeInTheDocument();
});

it('warns when the local model reports that output was truncated', async () => {
  server.use(
    http.post('/api/ai/generations/prepare', () => HttpResponse.json({
      generation_uuid: 'gen-truncated',
      completion_token: 'complete-truncated',
      messages: [{ role: 'user', content: '生成长文档' }],
      temperature: 0.3,
      safety_notice: '需人工复核',
    }, { status: 201 })),
    http.post('/api/ai/generations/gen-truncated/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-truncated', status: 'COMPLETED' })),
  );
  invokeMock
    .mockResolvedValueOnce([{
      id: 'profile-1',
      displayName: '公司模型',
      baseUrl: 'https://model.example/v1/',
      modelId: 'example-model',
      temperature: 0.3,
      timeoutSeconds: 60,
      isDefault: true,
      hasApiKey: true,
    }])
    .mockResolvedValueOnce({
      output: '十、测试注意事项\\n1. 授权与',
      latencyMs: 120,
      usage: { output_tokens: 1024 },
      finishReason: 'length',
    });

  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '生成完整测试文档');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByText(/模型达到输出长度上限/)).toBeInTheDocument();
});

it('prepares provider-neutral messages, invokes Tauri and completes history', async () => {
  const completeRequest = vi.fn();
  const seenAuthorization: string[] = [];
  window.history.replaceState({}, '', '/?sso_token=desktop-sso-token');
  server.use(
    http.post('/api/ai/generations/prepare', ({ request }) => {
      seenAuthorization.push(request.headers.get('authorization') ?? '');
      return HttpResponse.json(
        {
          generation_uuid: 'gen-1',
          completion_token: 'complete-1',
          messages: [{ role: 'user', content: '总结本周工作' }],
          temperature: 0.3,
          safety_notice: '需人工复核',
          context_usage: {
            characters: 1236,
            estimated_tokens: 309,
            estimator: 'rough_chars_div_4',
          },
          knowledge_refs: [
            {
              uuid: 'knowledge-risk',
              title: '接口梳理白皮书',
              matched_keywords: ['接口', '风险'],
              score: 2,
              priority: 5,
              clipped: false,
            },
          ],
        },
        { status: 201 },
      );
    }),
    http.post('/api/ai/generations/gen-1/complete', async ({ request }) => {
      seenAuthorization.push(request.headers.get('authorization') ?? '');
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

  expect(await screen.findByText('本周总结')).toBeInTheDocument();
  expect(screen.queryByText('上下文约 309 tokens')).not.toBeInTheDocument();
  expect(screen.getByText('本次生成约 36 tokens')).toBeInTheDocument();
  expect(screen.getByText('引用来源')).toBeInTheDocument();
  expect(screen.getByText('接口梳理白皮书')).toBeInTheDocument();
  expect(screen.queryByText('# 本周总结')).not.toBeInTheDocument();
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
  expect(seenAuthorization).toEqual([
    'Bearer desktop-sso-token',
    'Bearer desktop-sso-token',
  ]);
});

it('runs quality check and revises weak generation output before saving', async () => {
  const completeRequest = vi.fn();
  server.use(
    http.post('/api/ai/generations/prepare', () => HttpResponse.json(
      {
        generation_uuid: 'gen-revise',
        completion_token: 'complete-revise',
        messages: [{ role: 'user', content: '生成投标材料' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
        context_usage: {
          characters: 100,
          estimated_tokens: 25,
          estimator: 'rough_chars_div_4',
        },
        knowledge_refs: [],
        loop_trace: [{ state: 'QUALITY_CHECK', action: 'revise_answer' }],
      },
      { status: 201 },
    )),
    http.post('/api/ai/agent-loop/quality-check', async ({ request }) => {
      const body = await request.json() as { answer: string };
      if (body.answer === '通用材料') {
        return HttpResponse.json({
          passed: false,
          issues: ['聚信得仁业务场景', '网络安全公司内部员工'],
          retry_allowed: true,
          revision_messages: [
            { role: 'user', content: '生成投标材料' },
            { role: 'assistant', content: '通用材料' },
            { role: 'user', content: '请修正输出' },
          ],
        });
      }
      return HttpResponse.json({
        passed: true,
        issues: [],
        retry_allowed: false,
        revision_messages: [],
      });
    }),
    http.post('/api/ai/audit/local-model-events', () => new HttpResponse(null, { status: 204 })),
    http.post('/api/ai/generations/gen-revise/complete', async ({ request }) => {
      completeRequest(await request.json());
      return HttpResponse.json({ generation_uuid: 'gen-revise', status: 'COMPLETED' });
    }),
  );
  invokeMock
    .mockResolvedValueOnce([{
      id: 'profile-1',
      displayName: '公司模型',
      baseUrl: 'https://model.example/v1/',
      modelId: 'example-model',
      temperature: 0.3,
      timeoutSeconds: 60,
      isDefault: true,
      hasApiKey: true,
    }])
    .mockResolvedValueOnce({ output: '通用材料', latencyMs: 10, usage: { output_tokens: 3 } })
    .mockResolvedValueOnce({
      output: '聚信得仁投标材料：围绕标书、响应文件和风险提示组织。',
      latencyMs: 12,
      usage: { output_tokens: 20 },
    });

  render(<TaskRunPage task={workSummaryTask} />);

  await userEvent.type(screen.getByLabelText('工作内容'), '生成投标材料');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByText(/聚信得仁投标材料/)).toBeInTheDocument();
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
    'model_generate',
    expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: '通用材料' }),
        expect.objectContaining({ role: 'user', content: '请修正输出' }),
      ]),
    }),
  ));
  await waitFor(() => expect(completeRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      output: '聚信得仁投标材料：围绕标书、响应文件和风险提示组织。',
    }),
  ));
});

it('uploads reference material and includes attachment ids in prepare request', async () => {
  const prepareRequest = vi.fn();
  const formDataAppend = vi.spyOn(FormData.prototype, 'append');
  server.use(
    http.post('/api/ai/attachments', () => HttpResponse.json({
      attachment_uuid: 'att-1',
      file_name: '项目清单.xlsx',
      file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      file_size: 12,
      status: 'READY',
      extracted_characters: 6,
    }, { status: 201 })),
    http.post('/api/ai/generations/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        generation_uuid: 'gen-attachment',
        completion_token: 'complete-attachment',
        messages: [{ role: 'user', content: '生成会议纪要' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
        context_usage: { characters: 10, estimated_tokens: 3, estimator: 'rough_chars_div_4' },
      }, { status: 201 });
    }),
    http.post('/api/ai/generations/gen-attachment/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-attachment', status: 'COMPLETED' })),
  );
  invokeMock
    .mockResolvedValueOnce([{
      id: 'profile-1',
      displayName: '公司模型',
      baseUrl: 'https://model.example/v1/',
      modelId: 'example-model',
      temperature: 0.3,
      timeoutSeconds: 60,
      isDefault: true,
      hasApiKey: true,
    }])
    .mockResolvedValueOnce({ output: '会议纪要', latencyMs: 10, usage: {} });

  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '生成会议纪要');
  expect(screen.getByText('支持 pdf、docx、xlsx、pptx、txt、md。文件内容会作为参考材料参与生成。')).toBeInTheDocument();
  const file = new File(['xlsx'], '项目清单.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await userEvent.upload(screen.getByLabelText('上传参考材料'), file);
  expect(formDataAppend).toHaveBeenCalledWith('task_uuid', 'task-1');
  expect(formDataAppend).toHaveBeenCalledWith(
    'file',
    expect.objectContaining({ name: '项目清单.xlsx' }),
  );
  formDataAppend.mockRestore();
  expect(await screen.findByText('项目清单.xlsx')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  await waitFor(() => expect(prepareRequest).toHaveBeenCalled());
  expect(prepareRequest).toHaveBeenCalledWith(expect.objectContaining({
    attachment_uuids: ['att-1'],
  }));
});

it('blocks generation while reference material is still uploading', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.post('/api/ai/attachments', async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 150);
      });
      return HttpResponse.json({
        attachment_uuid: 'att-pending',
        file_name: 'meeting.txt',
        file_type: 'text/plain',
        file_size: 12,
        status: 'READY',
        extracted_characters: 6,
      }, { status: 201 });
    }),
    http.post('/api/ai/generations/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        generation_uuid: 'gen-should-not-start',
        completion_token: 'complete-should-not-start',
        messages: [{ role: 'user', content: '不应开始' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
      }, { status: 201 });
    }),
  );
  invokeMock.mockResolvedValueOnce([{
    id: 'profile-1',
    displayName: '公司模型',
    baseUrl: 'https://model.example/v1/',
    modelId: 'example-model',
    temperature: 0.3,
    timeoutSeconds: 60,
    isDefault: true,
    hasApiKey: true,
  }]);

  render(<TaskRunPage task={workSummaryTask} />);
  await userEvent.type(screen.getByLabelText('工作内容'), '生成会议纪要');
  const file = new File(['会议内容'], 'meeting.txt', { type: 'text/plain' });
  await userEvent.upload(screen.getByLabelText('上传参考材料'), file);

  const startButton = screen.getByRole('button', { name: '开始生成' });
  await userEvent.click(startButton);

  expect(startButton).toBeDisabled();
  expect(screen.getByText('参考材料仍在上传，请稍后生成')).toBeInTheDocument();
  await new Promise((resolve) => {
    window.setTimeout(resolve, 20);
  });
  expect(prepareRequest).not.toHaveBeenCalled();
});

it('emits body-free local model lifecycle audit events', async () => {
  const auditRequest = vi.fn();
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json(
        {
          generation_uuid: 'gen-audit',
          completion_token: 'complete-audit',
          messages: [{ role: 'user', content: '总结本周工作' }],
          temperature: 0.3,
          safety_notice: '需人工复核',
        },
        { status: 201 },
      ),
    ),
    http.post('/api/ai/audit/local-model-events', async ({ request }) => {
      auditRequest(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/ai/generations/gen-audit/complete', () =>
      HttpResponse.json({ generation_uuid: 'gen-audit', status: 'COMPLETED' })),
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
    if (command === 'model_generate') {
      return Promise.resolve({
        output: '本周总结',
        latencyMs: 120,
        usage: { input_tokens: 12, output_tokens: 24 },
      });
    }
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} />);

  await userEvent.type(screen.getByLabelText('工作内容'), '完成统一登录接入');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  await waitFor(() =>
    expect(auditRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        generation_uuid: 'gen-audit',
        event: 'MODEL_COMPLETED',
        model_id: 'example-model',
        provider: 'local-desktop',
        latency_ms: 120,
      }),
    ),
  );
  expect(auditRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      generation_uuid: 'gen-audit',
      event: 'MODEL_STARTED',
      model_id: 'example-model',
      provider: 'local-desktop',
    }),
  );
  expect(JSON.stringify(auditRequest.mock.calls)).not.toContain('总结本周工作');
  expect(JSON.stringify(auditRequest.mock.calls)).not.toContain('本周总结');
});

it('writes back a failed pending generation when the local model fails', async () => {
  const failRequest = vi.fn();
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json(
        {
          generation_uuid: 'gen-failed',
          completion_token: 'complete-failed',
          messages: [{ role: 'user', content: '总结本周工作' }],
          temperature: 0.3,
          safety_notice: '需人工复核',
        },
        { status: 201 },
      ),
    ),
    http.post('/api/ai/generations/gen-failed/fail', async ({ request }) => {
      failRequest(await request.json());
      return HttpResponse.json({ generation_uuid: 'gen-failed', status: 'FAILED' });
    }),
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
    if (command === 'model_generate') {
      return Promise.reject(new Error('MODEL_AUTH_FAILED — 请检查 API Key 是否正确'));
    }
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} />);

  await userEvent.type(screen.getByLabelText('工作内容'), '完成统一登录接入');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  await waitFor(() =>
    expect(failRequest).toHaveBeenCalledWith({
      completion_token: 'complete-failed',
      error_code: 'MODEL_AUTH_FAILED',
      error_message: 'MODEL_AUTH_FAILED — 请检查 API Key 是否正确',
    }),
  );
});

it('saves Word through the desktop shell after the result is synchronized', async () => {
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
      new HttpResponse(new Uint8Array([100, 111, 99, 120]), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''work.docx",
        },
      })),
  );
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
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
    if (command === 'model_generate') {
      return Promise.resolve({
      output: '# 本周总结',
      latencyMs: 120,
      usage: { input_tokens: 12, output_tokens: 24 },
      });
    }
    if (command === 'generation_word_save') {
      expect(payload).toEqual({
        fileName: 'work.docx',
        bytes: [100, 111, 99, 120],
      });
      return Promise.resolve('/Users/test/Downloads/work.docx');
    }
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} />);

  await userEvent.type(screen.getByLabelText('工作内容'), '完成统一登录接入');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByRole('button', { name: '导出 Word' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '导出 Word' }));

  await waitFor(() =>
    expect(invokeMock).toHaveBeenCalledWith('generation_word_save', {
      fileName: 'work.docx',
      bytes: [100, 111, 99, 120],
    }),
  );
  expect(await screen.findByText('Word 已保存到：/Users/test/Downloads/work.docx')).toBeInTheDocument();
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

it('sends sensitive-looking task content without a confirmation dialog', async () => {
  const prepareBodies: unknown[] = [];
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
    http.post('/api/ai/generations/prepare', async ({ request }) => {
      const body = await request.json();
      prepareBodies.push(body);
      return HttpResponse.json({
        generation_uuid: 'gen-sensitive-auto',
        completion_token: 'complete-sensitive-auto',
        messages: [{ role: 'user', content: '已自动确认' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
      }, { status: 201 });
    }),
    http.post('/api/ai/generations/gen-sensitive-auto/complete', () =>
      HttpResponse.json({
        generation_uuid: 'gen-sensitive-auto',
        status: 'COMPLETED',
      }),
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
      return Promise.resolve({
        output: '生成结果',
        latencyMs: 10,
        usage: {},
      });
    }
    return Promise.resolve();
  });

  render(<TaskRunPage task={sensitiveTask} />);
  await userEvent.type(screen.getByLabelText('登录账号密码'), 'admin/password: secret');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByText('生成结果')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '检测到敏感信息' })).not.toBeInTheDocument();
  expect(prepareBodies).toHaveLength(1);
  expect(prepareBodies[0]).not.toHaveProperty('sensitive_confirmation_digest');
});

it('cancels the active local request with its request id', async () => {
  let resolveGeneration: ((value: unknown) => void) | undefined;
  const auditEvents: string[] = [];
  const completeRequest = vi.fn();
  const failRequest = vi.fn();
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
    http.post('/api/ai/audit/local-model-events', async ({ request }) => {
      const body = await request.json() as { event?: string };
      auditEvents.push(String(body.event || ''));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/ai/generations/gen-cancel/complete', () => {
      completeRequest();
      return HttpResponse.json({ generation_uuid: 'gen-cancel', status: 'COMPLETED' });
    }),
    http.post('/api/ai/generations/gen-cancel/fail', () => {
      failRequest();
      return HttpResponse.json({ generation_uuid: 'gen-cancel', status: 'FAILED' });
    }),
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
  expect(await screen.findByText('已停止生成')).toBeInTheDocument();
  await waitFor(() => expect(auditEvents).toContain('MODEL_CANCELLED'));
  expect(auditEvents).not.toContain('MODEL_COMPLETED');
  expect(completeRequest).not.toHaveBeenCalled();
  expect(failRequest).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '开始生成' })).toBeEnabled();
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

it('forces pending-result sync before exporting Word', async () => {
  let completeAttempts = 0;
  let queuedPayload = '';
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
    http.post('/api/ai/generations/gen-offline/complete', () => {
      completeAttempts += 1;
      return completeAttempts === 1
        ? HttpResponse.json({ detail: 'offline' }, { status: 503 })
        : HttpResponse.json({ generation_uuid: 'gen-offline', status: 'COMPLETED' });
    }),
    http.get('/api/ai/generations/gen-offline/export.docx', () =>
      new HttpResponse(new Uint8Array([100, 111, 99, 120]), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''offline.docx",
        },
      }),
    ),
  );
  invokeMock.mockImplementation((command: string, payload?: Record<string, unknown>) => {
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
    if (command === 'local_queue_push') {
      queuedPayload = String(payload?.payload || '');
      return Promise.resolve();
    }
    if (command === 'local_queue_list') {
      return Promise.resolve([{
        id: 'gen-offline',
        payload: queuedPayload,
        status: 'pending',
        created_at: 1,
      }]);
    }
    if (command === 'local_queue_remove') return Promise.resolve();
    if (command === 'local_draft_delete') return Promise.resolve();
    if (command === 'generation_word_save') return Promise.resolve('/Users/test/Downloads/offline.docx');
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} userId="u-1" />);
  await userEvent.type(screen.getByLabelText('工作内容'), '离线生成');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByText('结果已保存在本机，恢复连接后自动同步')).toBeInTheDocument();
  const exportButton = screen.getByRole('button', { name: '导出 Word' });
  expect(exportButton).toBeEnabled();
  await userEvent.click(exportButton);
  expect(await screen.findByText('Word 已保存到：/Users/test/Downloads/offline.docx')).toBeInTheDocument();
  expect(completeAttempts).toBe(2);
  expect(invokeMock).toHaveBeenCalledWith(
    'local_queue_push',
    expect.objectContaining({ userId: 'u-1', resultId: 'gen-offline' }),
  );
  expect(invokeMock).toHaveBeenCalledWith('local_queue_remove', {
    userId: 'u-1',
    resultId: 'gen-offline',
  });
});

it('blocks Word export when the forced pending-result sync still fails', async () => {
  let completeAttempts = 0;
  let exportAttempts = 0;
  let queuedPayload = '';
  server.use(
    http.post('/api/ai/generations/prepare', () =>
      HttpResponse.json({
        generation_uuid: 'gen-still-offline',
        completion_token: 'complete-still-offline',
        messages: [{ role: 'user', content: '生成' }],
        temperature: 0.3,
        safety_notice: '需人工复核',
      }, { status: 201 }),
    ),
    http.post('/api/ai/generations/gen-still-offline/complete', () => {
      completeAttempts += 1;
      return HttpResponse.json({ detail: 'offline' }, { status: 503 });
    }),
    http.get('/api/ai/generations/gen-still-offline/export.docx', () => {
      exportAttempts += 1;
      return new HttpResponse(new Uint8Array([100, 111, 99, 120]));
    }),
  );
  invokeMock.mockImplementation((command: string, payload?: Record<string, unknown>) => {
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
    if (command === 'local_queue_push') {
      queuedPayload = String(payload?.payload || '');
      return Promise.resolve();
    }
    if (command === 'local_queue_list') {
      return Promise.resolve([{
        id: 'gen-still-offline',
        payload: queuedPayload,
        status: 'pending',
        created_at: 1,
      }]);
    }
    if (command === 'local_queue_update') return Promise.resolve();
    if (command === 'local_draft_delete') return Promise.resolve();
    return Promise.resolve();
  });

  render(<TaskRunPage task={workSummaryTask} userId="u-1" />);
  await userEvent.type(screen.getByLabelText('工作内容'), '持续离线生成');
  await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

  expect(await screen.findByText('结果已保存在本机，恢复连接后自动同步')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '导出 Word' }));

  expect(await screen.findByText('结果同步失败，请检查网络后重试导出 Word')).toBeInTheDocument();
  expect(completeAttempts).toBe(2);
  expect(exportAttempts).toBe(0);
  expect(invokeMock).not.toHaveBeenCalledWith('generation_word_save', expect.anything());
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

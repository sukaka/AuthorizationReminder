import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import { ChatPage, detectMemorySuggestion } from '../src/pages/ChatPage';
import { server } from './setup';

const { invokeMock, generateLocalModelMock, cancelModelGenerationMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  generateLocalModelMock: vi.fn(),
  cancelModelGenerationMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('../src/local/modelStream', () => ({
  cancelModelGeneration: cancelModelGenerationMock,
  generateLocalModel: generateLocalModelMock,
  listModelProfiles: () => invokeMock('model_profile_list'),
}));

beforeEach(() => {
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({
      items: [{
        category_id: 'category-personal',
        name: '个人素材',
        parent_category_id: '',
        parent_name: '',
        scope: 'personal',
        sort_order: 10,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:00Z',
      }],
      total: 1,
    })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({
      items: [{
        document_type_id: 'document-type-other',
        name: '其他',
        sort_order: 10,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:00Z',
      }],
      total: 1,
    })),
  );
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.resolve([
        {
          id: 'profile-1',
          displayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          modelId: 'deepseek-chat',
          temperature: 0.3,
          timeoutSeconds: 60,
          isDefault: true,
          hasApiKey: true,
        },
      ]);
    }
    return Promise.resolve(undefined);
  });
  generateLocalModelMock.mockReset();
  cancelModelGenerationMock.mockReset();
  cancelModelGenerationMock.mockResolvedValue(undefined);
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
});

it('detects explicit memory trigger phrases without saving sensitive content', () => {
  expect(detectMemorySuggestion('以后都这样，导出 Word 成功只显示 Toast')?.memoryType).toBe('user_preference');
  expect(detectMemorySuggestion('不对，应该只显示引用文件名')?.priority).toBe('high');
  expect(detectMemorySuggestion('记住我的 API Key 是 sk-test')).toBeNull();
});

it('sends a normal chat message, streams output, and completes it', async () => {
  const completeRequest = vi.fn();
  const streamedDeltas: string[] = [];
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-1',
      user_message_uuid: 'user-message-1',
      assistant_message_uuid: 'assistant-message-1',
      completion_token: 'complete-chat',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '帮我总结今天工作' },
      ],
      citations: [],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-1/complete', async ({ request }) => {
      completeRequest(await request.json());
      return HttpResponse.json({
        message_uuid: 'assistant-message-1',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockImplementation(async (_input, onDelta) => {
    streamedDeltas.push('第一段');
    onDelta('第一段');
    return {
      output: '第一段第二段',
      latencyMs: 12,
      usage: { output_tokens: 8 },
    };
  });

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '帮我总结今天工作');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('第一段第二段')).toBeInTheDocument();
  expect(streamedDeltas).toEqual(['第一段']);
  await waitFor(() => expect(completeRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      completion_token: 'complete-chat',
      answer: '第一段第二段',
      model_display_name: 'DeepSeek',
      model_id: 'deepseek-chat',
    }),
  ));
});

it('retries a failed task from the progress recovery action', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      const attempt = prepareRequest.mock.calls.length;
      return HttpResponse.json({
        session_uuid: 'session-retry',
        user_message_uuid: `user-message-retry-${attempt}`,
        assistant_message_uuid: `assistant-message-retry-${attempt}`,
        completion_token: `complete-retry-${attempt}`,
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手' },
          { role: 'user', content: '帮我整理失败恢复测试' },
        ],
        citations: [],
        task_state: {
          task_state_id: 'task-state-retry',
          conversation_id: 'session-retry',
          stage: 'generating',
          status: 'active',
          label: '正在生成内容',
          goal: '帮我整理失败恢复测试',
          selected_sources: [],
          tool_calls: [],
          verification_status: 'prepared',
          next_action: '正在调用模型生成内容',
          retry_allowed: false,
          failure_reason: '',
          stage_history: [
            { stage: 'analyzing', label: '正在理解你的需求' },
            { stage: 'generating', label: '正在生成内容' },
          ],
        },
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/assistant-message-retry-2/complete', () => HttpResponse.json({
      message_uuid: 'assistant-message-retry-2',
      status: 'COMPLETED',
    })),
  );
  generateLocalModelMock
    .mockRejectedValueOnce(new Error('模型响应超时'))
    .mockResolvedValueOnce({
      output: '失败后已重新生成。',
      latencyMs: 18,
      usage: { output_tokens: 8 },
    });

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '帮我整理失败恢复测试');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  const progress = await screen.findByRole('status', { name: '任务进度' });
  expect(progress).toHaveTextContent('生成遇到问题');
  await userEvent.click(screen.getByRole('button', { name: '可重试' }));

  expect(await screen.findByText('失败后已重新生成。')).toBeInTheDocument();
  expect(prepareRequest).toHaveBeenCalledTimes(2);
  expect(prepareRequest.mock.calls[1][0]).toEqual(expect.objectContaining({
    question: '帮我整理失败恢复测试',
    session_uuid: 'session-retry',
  }));
});

it('uses server-side model generation in web runtime without local model profiles', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: undefined,
  });
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.reject(new Error('Tauri unavailable'));
    }
    return Promise.resolve(undefined);
  });
  const generateRequest = vi.fn();
  const encoder = new TextEncoder();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/model-profiles', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-web-model',
      user_message_uuid: 'user-message-web-model',
      assistant_message_uuid: 'assistant-message-web-model',
      completion_token: 'complete-web-model',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '帮我总结 Web 端模型配置' },
      ],
      citations: [],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-web-model/generate/stream', async ({ request }) => {
      generateRequest(await request.json());
      return new HttpResponse(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'delta', delta: 'Web 端已使用服务端模型生成。' })}\n`));
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: 'complete',
            message_uuid: 'assistant-message-web-model',
            status: 'COMPLETED',
            answer: 'Web 端已使用服务端模型生成。',
            model_display_name: '服务端模型',
            model_id: 'deepseek-chat',
            usage: { prompt_tokens: 2971, completion_tokens: 202, total_tokens: 3173 },
            latency_ms: 23,
          })}\n`));
          controller.close();
        },
      }), {
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }),
  );

  render(<ChatPage />);
  expect(await screen.findByText('当前设置：服务端模型')).toBeInTheDocument();
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '帮我总结 Web 端模型配置');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('Web 端已使用服务端模型生成。')).toBeInTheDocument();
  const metrics = screen.getByRole('region', { name: '生成指标' });
  expect(within(metrics).getByText('总 token')).toBeInTheDocument();
  expect(within(metrics).getByText('3,173')).toBeInTheDocument();
  expect(within(metrics).queryByText('输入 token')).not.toBeInTheDocument();
  expect(within(metrics).queryByText('输出 token')).not.toBeInTheDocument();
  expect(generateLocalModelMock).not.toHaveBeenCalled();
  expect(generateRequest).toHaveBeenCalledWith(expect.objectContaining({
    completion_token: 'complete-web-model',
    messages: expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '帮我总结 Web 端模型配置' }),
    ]),
    temperature: 0.3,
  }));
});

it('streams server-side model output in web runtime before the request completes', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: undefined,
  });
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') {
      return Promise.reject(new Error('Tauri unavailable'));
    }
    return Promise.resolve(undefined);
  });
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const streamRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/model-profiles', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-web-stream',
      user_message_uuid: 'user-message-web-stream',
      assistant_message_uuid: 'assistant-message-web-stream',
      completion_token: 'complete-web-stream',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '流式说两段' },
      ],
      citations: [],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-web-stream/generate/stream', async ({ request }) => {
      streamRequest(await request.json());
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'delta', delta: '第一段' })}\n`));
        },
      });
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }),
  );

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '流式说两段');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('第一段')).toBeInTheDocument();
  expect(streamRequest).toHaveBeenCalledWith(expect.objectContaining({
    completion_token: 'complete-web-stream',
  }));
  expect(screen.queryByText('第一段第二段')).not.toBeInTheDocument();

  streamController?.enqueue(encoder.encode(`${JSON.stringify({ type: 'delta', delta: '第二段' })}\n`));
  streamController?.enqueue(encoder.encode(`${JSON.stringify({
    type: 'complete',
    message_uuid: 'assistant-message-web-stream',
    status: 'COMPLETED',
    answer: '第一段第二段',
    model_display_name: '服务端模型',
    model_id: 'deepseek-chat',
    usage: { total_tokens: 9 },
    latency_ms: 18,
  })}\n`));
  streamController?.close();

  expect(await screen.findByText('第一段第二段')).toBeInTheDocument();
});

it('shows the default personal model label in web runtime', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: undefined,
  });
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/model-profiles', () => HttpResponse.json({
      items: [{
        uuid: 'web-profile-1',
        display_name: '我的 DeepSeek',
        base_url: 'https://api.deepseek.com',
        model_id: 'deepseek-chat',
        temperature: 0.3,
        max_output_tokens: 8192,
        timeout_seconds: 300,
        is_default: true,
        has_api_key: true,
        status: 'ACTIVE',
        created_at: '2026-07-07T10:00:00',
        updated_at: '2026-07-07T10:00:00',
      }],
      total: 1,
    })),
  );

  render(<ChatPage />);

  expect(await screen.findByText('当前设置：我的 DeepSeek')).toBeInTheDocument();
});

it('keeps streamed draft visible and explains model timeouts during long document generation', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-long-doc',
      user_message_uuid: 'user-message-long-doc',
      assistant_message_uuid: 'assistant-message-long-doc',
      completion_token: 'complete-long-doc',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '生成一份很长的实施方案' },
      ],
      citations: [],
    }, { status: 201 })),
  );
  generateLocalModelMock.mockImplementation(async (_input, onDelta) => {
    onDelta('已生成的前半部分内容');
    throw new Error('MODEL_TIMEOUT');
  });

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '生成一份很长的实施方案');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('已生成的前半部分内容')).toBeInTheDocument();
  expect(await screen.findByText(/长文档生成时间较长/)).toBeInTheDocument();
  expect(screen.queryByText('内容生成失败，请稍后重试')).not.toBeInTheDocument();
});

it('shows user-facing task progress while chat is generating', async () => {
  const modelResolver: {
    current?: (value: { output: string; latencyMs: number; usage: { output_tokens: number } }) => void;
  } = {};
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-progress',
      user_message_uuid: 'user-message-progress',
      assistant_message_uuid: 'assistant-message-progress',
      completion_token: 'complete-progress',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '写一份方案' },
      ],
      citations: [],
      task_state: {
        task_state_id: 'task-state-progress',
        conversation_id: 'session-progress',
        stage: 'completed',
        label: '生成完成',
        goal: '写一份方案',
        selected_sources: [],
        tool_calls: [],
        verification_status: 'prepared',
        next_action: '等待模型生成回答',
        stage_history: [
          { stage: 'analyzing', label: '正在识别任务', next_action: '正在识别任务' },
          { stage: 'building_context', label: '正在整理依据', next_action: '正在整理依据' },
          { stage: 'completed', label: '生成完成', next_action: '等待模型生成回答' },
        ],
      },
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-progress/complete', () => HttpResponse.json({
      message_uuid: 'assistant-message-progress',
      status: 'COMPLETED',
    })),
  );
  generateLocalModelMock.mockImplementation(() => new Promise((resolve) => {
    modelResolver.current = resolve;
  }));

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '写一份方案');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect((await screen.findAllByText('正在生成回答')).length).toBeGreaterThan(0);
  expect(screen.getByText('正在识别任务')).toBeInTheDocument();
  expect(screen.queryByText('TaskState')).not.toBeInTheDocument();
  expect(modelResolver.current).toBeDefined();
  modelResolver.current?.({
    output: '方案内容',
    latencyMs: 12,
    usage: { output_tokens: 8 },
  });
  expect(await screen.findByText('生成完成')).toBeInTheDocument();
});

it('asks before saving explicit user memory and then stores it', async () => {
  const memoryRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-memory',
      user_message_uuid: 'user-message-memory',
      assistant_message_uuid: 'assistant-message-memory',
      completion_token: 'complete-memory',
      completed: true,
      answer: '已了解。',
      messages: [],
      citations: [],
    }, { status: 201 })),
    http.post('/api/learning/memories', async ({ request }) => {
      memoryRequest(await request.json());
      return HttpResponse.json({
        uuid: 'memory-1',
        memory_type: 'user_preference',
        title: '用户偏好',
        content: '以后都这样，Word 导出成功只显示 Toast',
        source: 'manual',
        priority: 'medium',
        tags: ['偏好'],
        status: 'active',
        created_at: '2026-07-04T08:00:00Z',
        updated_at: '2026-07-04T08:00:00Z',
      }, { status: 201 });
    }),
  );

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '以后都这样，Word 导出成功只显示 Toast');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('是否保存为长期记忆？')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(memoryRequest).toHaveBeenCalledWith(expect.objectContaining({
    memory_type: 'user_preference',
    content: '以后都这样，Word 导出成功只显示 Toast',
  })));
  expect(await screen.findByText('已保存为长期记忆，后续回答会优先参考')).toBeInTheDocument();
});

it('submits useful chat answer feedback to the learning loop', async () => {
  const feedbackRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-feedback',
      user_message_uuid: 'user-message-feedback',
      assistant_message_uuid: 'assistant-message-feedback',
      completion_token: 'complete-feedback',
      completed: true,
      answer: '这是一条有用回答。',
      messages: [],
      citations: [],
    }, { status: 201 })),
    http.post('/api/learning/feedback', async ({ request }) => {
      feedbackRequest(await request.json());
      return HttpResponse.json({
        uuid: 'feedback-1',
        conversation_id: 'session-feedback',
        message_id: 'assistant-message-feedback',
        feedback_type: 'useful',
        comment: '',
        saved_as: '',
        created_at: '2026-07-04T08:00:00Z',
      }, { status: 201 });
    }),
  );

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '你能做什么');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('这是一条有用回答。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '有用' }));
  await waitFor(() => expect(feedbackRequest).toHaveBeenCalledWith(expect.objectContaining({
    conversation_id: 'session-feedback',
    message_id: 'assistant-message-feedback',
    feedback_type: 'useful',
  })));
  expect(await screen.findByText('已记录：这条回答有用')).toBeInTheDocument();
});

it('logs saved_as feedback when an answer is saved as experience', async () => {
  const experienceRequest = vi.fn();
  const feedbackRequest = vi.fn();
  const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('商务投标');
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-save-experience',
      user_message_uuid: 'user-message-save-experience',
      assistant_message_uuid: 'assistant-message-save-experience',
      completion_token: 'complete-save-experience',
      completed: true,
      answer: '投标响应先列评分点。',
      messages: [],
      citations: [],
    }, { status: 201 })),
    http.post('/api/learning/experiences', async ({ request }) => {
      experienceRequest(await request.json());
      return HttpResponse.json({
        uuid: 'experience-1',
        task_type: '商务投标',
        title: '怎么写投标响应',
        question: '怎么写投标响应',
        answer: '投标响应先列评分点。',
        summary: '投标响应先列评分点。',
        tags: ['商务投标'],
        status: 'active',
        created_at: '2026-07-04T08:00:00Z',
        updated_at: '2026-07-04T08:00:00Z',
      }, { status: 201 });
    }),
    http.post('/api/learning/feedback', async ({ request }) => {
      feedbackRequest(await request.json());
      return HttpResponse.json({
        uuid: 'feedback-save-experience',
        conversation_id: 'session-save-experience',
        message_id: 'assistant-message-save-experience',
        feedback_type: 'save_experience',
        comment: '',
        saved_as: 'experience',
        created_at: '2026-07-04T08:00:00Z',
      }, { status: 201 });
    }),
  );

  try {
    render(<ChatPage />);
    await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '怎么写投标响应');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('投标响应先列评分点。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存为经验' }));
    await waitFor(() => expect(experienceRequest).toHaveBeenCalled());
    await waitFor(() => expect(feedbackRequest).toHaveBeenCalledWith(expect.objectContaining({
      conversation_id: 'session-save-experience',
      message_id: 'assistant-message-save-experience',
      feedback_type: 'save_experience',
      saved_as: 'experience',
    })));
    expect(await screen.findByText('已保存为经验，后续类似问题会自动参考')).toBeInTheDocument();
  } finally {
    promptSpy.mockRestore();
  }
});

it('shows only cited files mentioned in the final answer', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-citation-filter',
      user_message_uuid: 'user-message-citation-filter',
      assistant_message_uuid: 'assistant-message-citation-filter',
      completion_token: 'complete-citation-filter',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '安全服务包含什么' },
      ],
      citations: [
        {
          source_type: 'official_knowledge',
          file_uuid: 'file-used',
          file_name: '安全白皮书.txt',
          chunk_id: 'chunk-used',
          section_title: '安全服务',
          chunk_index: 0,
          score: 9,
        },
        {
          source_type: 'official_knowledge',
          file_uuid: 'file-unused',
          file_name: '销售手册.txt',
          chunk_id: 'chunk-unused',
          section_title: '安全服务',
          chunk_index: 0,
          score: 8,
        },
      ],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-citation-filter/complete', () => HttpResponse.json({
      message_uuid: 'assistant-message-citation-filter',
      status: 'COMPLETED',
    })),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '根据《安全白皮书》，安全服务包含应急响应和运维巡检。',
    latencyMs: 12,
    usage: { output_tokens: 8 },
  });

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '安全服务包含什么');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText(/安全服务包含应急响应和运维巡检/)).toBeInTheDocument();
  const inlineSource = screen.getByLabelText('来源：安全白皮书.txt');
  expect(inlineSource).toHaveClass('chat-inline-source');
  expect(inlineSource).toHaveTextContent('公司知识库');
  const citationSummary = screen.getByText('来源');
  const citationDetails = citationSummary.closest('details');
  expect(citationDetails).not.toHaveAttribute('open');
  expect(screen.queryByText('安全白皮书.txt')).not.toBeInTheDocument();
  await userEvent.click(citationSummary);
  const citationList = screen.getByRole('list', { name: '引用来源' });
  expect(within(citationList).getByRole('button', { name: '打开来源：安全白皮书.txt' })).toHaveTextContent('公司知识库');
  expect(within(citationList).queryByText('安全白皮书.txt')).not.toBeInTheDocument();
  expect(within(citationList).queryByRole('button', { name: '打开来源：销售手册.txt' })).not.toBeInTheDocument();
});

it('keeps citations when the answer omits a leading file sequence number', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-numbered-source',
      user_message_uuid: 'user-message-numbered-source',
      assistant_message_uuid: 'assistant-message-numbered-source',
      completion_token: 'complete-numbered-source',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '列出招标参数里的标题' },
      ],
      citations: [
        {
          source_type: 'session_attachment',
          file_uuid: 'file-numbered',
          file_name: '3-聚信等保合规云管平台-招标参数V1.1.docx',
          chunk_id: 'chunk-numbered',
          section_title: '硬件参数',
          chunk_index: 0,
          score: 9,
        },
        {
          source_type: 'official_knowledge',
          file_uuid: 'file-unused',
          file_name: '等保合规云平台 管理员手册v3.1.docx',
          chunk_id: 'chunk-unused',
          section_title: '系统登录',
          chunk_index: 0,
          score: 8,
        },
      ],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-numbered-source/complete', () => HttpResponse.json({
      message_uuid: 'assistant-message-numbered-source',
      status: 'COMPLETED',
    })),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '根据《聚信等保合规云管平台-招标参数V1.1.docx》，当前资料能确认“硬件参数”。',
    latencyMs: 12,
    usage: { output_tokens: 8 },
  });

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '列出招标参数里的标题');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText(/当前资料能确认/)).toBeInTheDocument();
  const citationSummary = screen.getByText('来源');
  await userEvent.click(citationSummary);
  const citationList = screen.getByRole('list', { name: '引用来源' });
  expect(within(citationList).getByRole('button', { name: '打开来源：3-聚信等保合规云管平台-招标参数V1.1.docx' })).toHaveTextContent('当前附件');
  expect(within(citationList).queryByText('3-聚信等保合规云管平台-招标参数V1.1.docx')).not.toBeInTheDocument();
  expect(within(citationList).queryByRole('button', { name: '打开来源：等保合规云平台 管理员手册v3.1.docx' })).not.toBeInTheDocument();
});

it('does not show citations until the assistant answer is fully completed', async () => {
  let resolveModel: ((value: { output: string; latencyMs: number; usage: { output_tokens: number } }) => void) | undefined;
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-citation-stream',
      user_message_uuid: 'user-message-citation-stream',
      assistant_message_uuid: 'assistant-message-citation-stream',
      completion_token: 'complete-citation-stream',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '安全服务包含什么' },
      ],
      citations: [{
        source_type: 'official_knowledge',
        file_uuid: 'file-stream',
        file_name: '安全白皮书.txt',
        chunk_id: 'chunk-stream',
        section_title: '安全服务',
        chunk_index: 0,
        score: 9,
      }],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-citation-stream/complete', () => HttpResponse.json({
      message_uuid: 'assistant-message-citation-stream',
      status: 'COMPLETED',
    })),
  );
  generateLocalModelMock.mockImplementation(async (_input, onDelta) => {
    onDelta('根据《安全白皮书.txt》');
    return new Promise((resolve) => {
      resolveModel = resolve;
    });
  });

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '安全服务包含什么');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('根据')).toBeInTheDocument();
  const streamingInlineSource = screen.getByLabelText('来源：安全白皮书.txt');
  expect(streamingInlineSource).toHaveClass('chat-inline-source');
  expect(streamingInlineSource).toHaveTextContent('来源');
  expect(screen.queryByRole('list', { name: '引用来源' })).not.toBeInTheDocument();

  resolveModel?.({
    output: '根据《安全白皮书.txt》，安全服务包含应急响应和运维巡检。',
    latencyMs: 12,
    usage: { output_tokens: 8 },
  });

  expect(await screen.findByLabelText('查看 1 个引用来源')).toBeInTheDocument();
});

it('captures a web URL and shows a confirmation card before saving', async () => {
  const prepareRequest = vi.fn();
  const confirmRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({}, { status: 500 });
    }),
    http.post('/api/web/captures/preview', () => HttpResponse.json({
      capture_id: 'capture-1',
      title: 'WDSP 白皮书',
      site_name: '聚信官网',
      url: 'https://example.com/wdsp',
      final_url: 'https://example.com/wdsp',
      fetched_at: '2026-07-03T06:00:00Z',
      published_at: '2026-07-01',
      word_count: 1280,
      summary: '介绍 WEB 动态安全管理平台能力。',
      suggested_category: '产品资料',
      suggested_document_type: '产品白皮书',
      validity: '已完成安全校验，仅提取正文文本',
      scope: '确认前仅本次预览，不会写入正式知识库',
    }, { status: 201 })),
    http.post('/api/web/captures/capture-1/confirm', async ({ request }) => {
      confirmRequest(await request.json());
      return HttpResponse.json({
        capture_id: 'capture-1',
        status: 'saved',
        save_target: 'personal_reference',
        knowledge_file_uuid: 'file-web-1',
        message: '网页内容已保存到我的资料',
      });
    }),
  );

  render(<ChatPage />);
  await userEvent.type(
    await screen.findByLabelText('告诉我你想完成什么工作'),
    '抓取这个网页内容 https://example.com/wdsp',
  );
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('已抓取网页内容，请确认是否保存')).toBeInTheDocument();
  expect(screen.getByText('WDSP 白皮书')).toBeInTheDocument();
  expect(screen.getByText('聚信官网')).toBeInTheDocument();
  expect(screen.getByText('产品资料')).toBeInTheDocument();
  expect(screen.getByText('产品白皮书')).toBeInTheDocument();
  expect(prepareRequest).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: '保存到我的资料' }));
  await waitFor(() => expect(confirmRequest).toHaveBeenCalledWith(expect.objectContaining({
    save_target: 'personal_reference',
    category: '产品资料',
    document_type: '产品白皮书',
  })));
  expect(await screen.findByText('网页内容已保存到我的资料')).toBeInTheDocument();
});

it('shows web capture failure without blocking later normal chat', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/web/captures/preview', () => HttpResponse.json({
      detail: '不允许采集本机或内网地址',
    }, { status: 422 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-after-web-fail',
        user_message_uuid: 'user-after-web-fail',
        assistant_message_uuid: 'assistant-after-web-fail',
        completion_token: 'complete-after-web-fail',
        completed: true,
        answer: '可以继续普通聊天。',
        messages: [],
        citations: [],
      }, { status: 201 });
    }),
  );

  render(<ChatPage />);
  const input = await screen.findByLabelText('告诉我你想完成什么工作');
  await userEvent.type(input, '抓取 http://127.0.0.1:8000');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('不允许采集本机或内网地址')).toBeInTheDocument();
  await userEvent.type(input, '你好');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('可以继续普通聊天。')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(expect.objectContaining({
    question: '你好',
  })));
});

it('renders a Codex-like composer and sends with Enter', async () => {
  const completeRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-composer',
      user_message_uuid: 'user-message-composer',
      assistant_message_uuid: 'assistant-message-composer',
      completion_token: 'complete-composer',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '写一份会议纪要' },
      ],
      citations: [],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-composer/complete', async ({ request }) => {
      completeRequest(await request.json());
      return HttpResponse.json({
        message_uuid: 'assistant-message-composer',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '会议纪要已生成',
    latencyMs: 10,
    usage: { output_tokens: 6 },
  });

  render(<ChatPage />);

  expect(await screen.findByRole('region', { name: '私人工作助理工作区' })).toBeInTheDocument();
  const composer = screen.getByRole('form', { name: '工作输入区' });
  expect(composer).toBeInTheDocument();
  expect(within(composer).queryByText('告诉我你想完成什么工作', { selector: 'label' })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('告诉我你想完成什么工作...')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '助手模式' })).toHaveValue('normal');
  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '写一份会议纪要{enter}');

  expect(await screen.findByText('会议纪要已生成')).toBeInTheDocument();
  await waitFor(() => expect(completeRequest).toHaveBeenCalled());
});

it('does not send with Enter while an IME composition is active', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-ime',
        user_message_uuid: 'user-message-ime',
        assistant_message_uuid: 'assistant-message-ime',
        completion_token: 'complete-ime',
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手' },
          { role: 'user', content: 'ni' },
        ],
        citations: [],
      }, { status: 201 });
    }),
  );

  render(<ChatPage />);
  const input = await screen.findByLabelText('告诉我你想完成什么工作');
  await userEvent.type(input, 'ni');
  fireEvent.keyDown(input, {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    keyCode: 229,
  });

  expect(prepareRequest).not.toHaveBeenCalled();
  expect(input).toHaveValue('ni');
  expect(screen.queryByText('正在生成…')).not.toBeInTheDocument();
});

it('turns the send button into a compact stop button while generating and cancels by click', async () => {
  const completeRequest = vi.fn();
  let resolveGeneration: ((value: { output: string; latencyMs: number; usage: { output_tokens: number } }) => void) | undefined;
  const pendingGeneration = new Promise<{ output: string; latencyMs: number; usage: { output_tokens: number } }>((resolve) => {
    resolveGeneration = resolve;
  });
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-stop-click',
      user_message_uuid: 'user-message-stop-click',
      assistant_message_uuid: 'assistant-message-stop-click',
      completion_token: 'complete-stop-click',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '写一份长报告' },
      ],
      citations: [],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-stop-click/complete', async ({ request }) => {
      completeRequest(await request.json());
      return HttpResponse.json({ message_uuid: 'assistant-message-stop-click', status: 'COMPLETED' });
    }),
  );
  generateLocalModelMock.mockReturnValue(pendingGeneration);

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '写一份长报告');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  const stopButton = await screen.findByRole('button', { name: '停止生成' });
  expect(stopButton).toHaveClass('is-stopping-ready');
  await waitFor(() => expect(generateLocalModelMock).toHaveBeenCalled());
  await userEvent.click(stopButton);

  const requestId = generateLocalModelMock.mock.calls[0][0].requestId;
  expect(cancelModelGenerationMock).toHaveBeenCalledWith(requestId);
  resolveGeneration?.({ output: '不应保存的内容', latencyMs: 100, usage: { output_tokens: 3 } });
  await waitFor(() => expect(completeRequest).not.toHaveBeenCalled());
});

it('cancels the active generation when Escape is pressed', async () => {
  const pendingGeneration = new Promise<{ output: string; latencyMs: number; usage: { output_tokens: number } }>(() => {});
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-stop-escape',
      user_message_uuid: 'user-message-stop-escape',
      assistant_message_uuid: 'assistant-message-stop-escape',
      completion_token: 'complete-stop-escape',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '继续生成' },
      ],
      citations: [],
    }, { status: 201 })),
  );
  generateLocalModelMock.mockReturnValue(pendingGeneration);

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '继续生成');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByRole('button', { name: '停止生成' });
  await waitFor(() => expect(generateLocalModelMock).toHaveBeenCalled());
  await userEvent.keyboard('{Escape}');

  const requestId = generateLocalModelMock.mock.calls[0][0].requestId;
  expect(cancelModelGenerationMock).toHaveBeenCalledWith(requestId);
});

it('shows static prompt examples and keeps new chat out of the history pane', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<ChatPage />);

  expect(await screen.findByRole('heading', { name: '告诉我你想完成什么工作' })).toBeInTheDocument();
  expect(screen.getByText('我是你的私人工作助理，可以帮你写、查、整理、生成和导出工作成果。')).toBeInTheDocument();
  const historyPane = screen.getByLabelText('历史任务');
  expect(within(historyPane).queryByRole('button', { name: '开启新任务' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('示例提示')).toHaveTextContent('写一份项目方案');
  expect(screen.queryByRole('button', { name: '写一份项目方案' })).not.toBeInTheDocument();
});

it('requests chat history without browser cache so 304 responses do not break loading', async () => {
  const requestCaches: string[] = [];
  server.use(
    http.get('/api/conversations', ({ request }) => {
      requestCaches.push(request.cache);
      return HttpResponse.json({ items: [], total: 0 });
    }),
  );

  render(<ChatPage />);

  await screen.findByRole('heading', { name: '告诉我你想完成什么工作' });
  expect(requestCaches).toContain('no-store');
});

it('limits Word export choices to current content or Juxin formatted Word', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<ChatPage />);

  const exportSelect = await screen.findByRole('combobox', { name: '导出方式' });
  expect(within(exportSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
    '仅导出本次生成内容',
    '导出聚信格式 Word',
  ]);
});

it('offers Juxin role modes and sends the selected mode to prepare API', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-business',
        user_message_uuid: 'user-message-business',
        assistant_message_uuid: 'assistant-message-business',
        completion_token: 'complete-business',
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '商务助手：投标、标书、响应文件' },
          { role: 'user', content: '帮我写投标响应' },
        ],
        citations: [],
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/assistant-message-business/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-business',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '商务响应建议',
    latencyMs: 10,
    usage: { output_tokens: 6 },
  });

  render(<ChatPage />);

  const modeSelect = await screen.findByRole('combobox', { name: '助手模式' });
  const modeOptions = within(modeSelect).getAllByRole('option');
  expect(modeOptions).toHaveLength(12);
  expect(modeOptions.map((option) => option.textContent)).toEqual([
    '普通助手',
    '销售助手',
    '商务助手',
    '行政人力助手',
    '售前助手',
    '交付助手',
    '软测助手',
    '渗透测试助手',
    '安全运维助手',
    '风险评估助手',
    '应急响应助手',
    '查公司知识',
  ]);
  await userEvent.selectOptions(modeSelect, 'hr_admin');
  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '帮我写投标响应');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('商务响应建议')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'hr_admin' }),
  ));
});

it('lets users choose whether chat should reference personal materials and session attachments', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-reference-scope',
        user_message_uuid: 'user-message-reference-scope',
        assistant_message_uuid: 'assistant-message-reference-scope',
        completion_token: 'complete-reference-scope',
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手，已带入个人参考资料和当前附件。' },
          { role: 'user', content: '根据我的资料生成会议纪要' },
        ],
        citations: [],
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/assistant-message-reference-scope/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-reference-scope',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '已结合我的资料生成会议纪要。',
    latencyMs: 10,
    usage: { output_tokens: 8 },
  });

  render(<ChatPage />);

  await userEvent.selectOptions(
    await screen.findByRole('combobox', { name: '参考资料' }),
    'personal_and_session',
  );
  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '根据我的资料生成会议纪要');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('已结合我的资料生成会议纪要。')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      include_personal_references: true,
      include_session_attachments: true,
    }),
  ));
});

it('offers composer shortcuts for knowledge base personal materials and session attachments', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-composer-reference-shortcuts',
        user_message_uuid: 'user-message-composer-reference-shortcuts',
        assistant_message_uuid: 'assistant-message-composer-reference-shortcuts',
        completion_token: 'complete-composer-reference-shortcuts',
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手，已带入个人资料。' },
          { role: 'user', content: '参考我的资料写纪要' },
        ],
        citations: [],
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/assistant-message-composer-reference-shortcuts/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-composer-reference-shortcuts',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '已参考我的资料生成纪要。',
    latencyMs: 10,
    usage: { output_tokens: 8 },
  });

  render(<ChatPage />);

  const composer = await screen.findByRole('form', { name: '工作输入区' });
  const modeSelect = screen.getByRole('combobox', { name: '助手模式' });
  const referenceSelect = screen.getByRole('combobox', { name: '参考资料' });
  expect(within(composer).getByRole('button', { name: '查公司知识' })).toBeInTheDocument();
  expect(within(composer).getByRole('button', { name: '我的资料' })).toBeInTheDocument();
  expect(within(composer).getByRole('button', { name: '当前附件' })).toBeInTheDocument();

  await userEvent.click(within(composer).getByRole('button', { name: '查公司知识' }));
  expect(modeSelect).toHaveValue('knowledge');
  expect(referenceSelect).toHaveValue('official_only');

  await userEvent.click(within(composer).getByRole('button', { name: '我的资料' }));
  expect(referenceSelect).toHaveValue('with_personal');

  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '参考我的资料写纪要');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('已参考我的资料生成纪要。')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'knowledge',
      include_personal_references: true,
      include_session_attachments: false,
    }),
  ));
});

it('lets users select uploaded personal files directly from the chat composer', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [
        {
          file_uuid: 'file-selected-requirement',
          file_name: '广东能源需求书.pdf',
          file_type: 'application/pdf',
          file_size: 2048,
          visibility: 'PRIVATE',
          status: 'READY',
          chunk_count: 8,
          source_type: 'user_upload',
          usage_type: 'personal_reference',
          review_status: 'draft',
          rag_enabled: false,
          reference_enabled: true,
          rag_scope: 'personal',
          permission_scope: 'private',
          category: '个人素材',
          document_type: '需求书',
          tags: [],
          parse_status: 'parsed',
          index_status: 'indexed',
          created_at: '2026-06-26T01:00:00Z',
        },
        {
          file_uuid: 'file-unready-draft',
          file_name: '未解析资料.docx',
          file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size: 1024,
          visibility: 'PRIVATE',
          status: 'PROCESSING',
          chunk_count: 0,
          source_type: 'user_upload',
          usage_type: 'personal_reference',
          review_status: 'draft',
          rag_enabled: false,
          reference_enabled: true,
          rag_scope: 'personal',
          permission_scope: 'private',
          category: '个人素材',
          document_type: '其他',
          tags: [],
          parse_status: 'pending',
          index_status: 'pending',
          created_at: '2026-06-26T01:00:00Z',
        },
      ],
      total: 2,
    })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-selected-reference',
        user_message_uuid: 'user-message-selected-reference',
        assistant_message_uuid: 'assistant-message-selected-reference',
        completion_token: 'complete-selected-reference',
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手，已带入指定个人资料。' },
          { role: 'user', content: '根据我选择的需求书写响应文件' },
        ],
        citations: [],
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/assistant-message-selected-reference/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-selected-reference',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '已根据所选需求书生成响应文件。',
    latencyMs: 10,
    usage: { output_tokens: 8 },
  });

  render(<ChatPage />);

  const composer = await screen.findByRole('form', { name: '工作输入区' });
  await userEvent.click(within(composer).getByRole('button', { name: '引用资料' }));
  const picker = await screen.findByRole('region', { name: '选择引用资料' });
  expect(within(picker).getByText('广东能源需求书.pdf')).toBeInTheDocument();
  expect(within(picker).queryByText('未解析资料.docx')).not.toBeInTheDocument();

  await userEvent.click(within(picker).getByRole('checkbox', { name: '广东能源需求书.pdf' }));
  expect(within(composer).getByText('引用：广东能源需求书.pdf')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '根据我选择的需求书写响应文件');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('已根据所选需求书生成响应文件。')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'knowledge',
      personal_reference_file_ids: ['file-selected-requirement'],
      include_personal_references: true,
      include_session_attachments: false,
    }),
  ));
});

it('shows uploaded session attachments as a compact attachment bar', async () => {
  let prepareCount = 0;
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      prepareCount += 1;
      return HttpResponse.json({
        session_uuid: 'session-attachment-bar',
        user_message_uuid: `user-message-attachment-bar-${prepareCount}`,
        assistant_message_uuid: `assistant-message-attachment-bar-${prepareCount}`,
        completion_token: `complete-attachment-bar-${prepareCount}`,
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手。' },
          { role: 'user', content: prepareCount === 1 ? '开启任务' : '参考附件整理' },
        ],
        citations: [],
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/:messageId/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-attachment-bar',
        status: 'COMPLETED',
      });
    }),
    http.post('/api/knowledge/files/upload', () => {
      return HttpResponse.json({
        file_uuid: 'file-current-attachment',
        file_name: 'WEB动态安全管理平台白皮书v3.1.docx',
        file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        file_size: 128,
        visibility: 'PRIVATE',
        status: 'READY',
        chunk_count: 3,
        source_type: 'session_attachment',
        usage_type: 'session_attachment',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'session',
        permission_scope: 'private',
        category: '当前附件',
        document_type: '临时附件',
        tags: [],
        parse_status: 'parsed',
        index_status: 'indexed',
        created_at: '2026-06-26T01:00:00Z',
      }, { status: 201 });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '任务已开启。',
    latencyMs: 10,
    usage: { output_tokens: 4 },
  });

  render(<ChatPage />);

  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '开启任务');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByText('任务已开启。')).toBeInTheDocument();

  await userEvent.upload(
    screen.getByLabelText('上传资料'),
    new File(['白皮书内容'], 'WEB动态安全管理平台白皮书v3.1.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: '上传资料' });
  await userEvent.click(within(dialog).getByRole('radio', { name: '仅用于当前任务' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '开始上传' }));

  const attachmentBar = await screen.findByRole('region', { name: '当前附件' });
  expect(attachmentBar).toHaveClass('chat-attachment-bar');
  expect(within(attachmentBar).getByText('DOCX')).toBeInTheDocument();
  expect(within(attachmentBar).getByText('WEB动态安全管理平台白皮书v3.1.docx')).toBeInTheDocument();
  expect(within(attachmentBar).getByText('当前附件')).toBeInTheDocument();
  expect(within(attachmentBar).getByRole('button', {
    name: '移除附件：WEB动态安全管理平台白皮书v3.1.docx',
  })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '当前参考资料' })).not.toBeInTheDocument();
  expect(screen.queryByText('这些资料只作为本次任务的参考资料，不会进入公司知识库。')).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '参考附件整理');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  await waitFor(() => expect(prepareRequest).toHaveBeenLastCalledWith(
    expect.objectContaining({
      question: '参考附件整理',
      include_session_attachments: true,
      attachment_file_ids: ['file-current-attachment'],
    }),
  ));
});

it('allows uploading PDF files and explains text extraction limits', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<ChatPage />);
  await userEvent.upload(
    await screen.findByLabelText('上传资料'),
    new File(['%PDF-1.4'], '产品白皮书.pdf', { type: 'application/pdf' }),
    { applyAccept: false },
  );

  const dialog = await screen.findByRole('dialog', { name: '上传资料' });
  expect(within(dialog).getByText('PDF 会按页面提取可复制文本，扫描件需要先转成可复制文本。')).toBeInTheDocument();
  expect(within(dialog).queryByText(/暂不支持 PDF/)).not.toBeInTheDocument();
});

it('exports an assistant reply to Word from the chat message actions', async () => {
  const exportRequest = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-export',
      user_message_uuid: 'user-message-export',
      assistant_message_uuid: 'assistant-message-export',
      completion_token: 'complete-export',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '你是聚信 AI 助手' },
        { role: 'user', content: '输出交付方案' },
      ],
      citations: [],
    }, { status: 201 })),
    http.post('/api/ai/chat/messages/assistant-message-export/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-export',
        status: 'COMPLETED',
      });
    }),
    http.post('/api/export/word', async ({ request }) => {
      exportRequest(await request.json());
      return HttpResponse.json({
        file_name: '聊天回答.docx',
        download_url: '/api/export/download/file-export',
      }, { status: 201 });
    }),
    http.get('/api/export/download/file-export', () => new HttpResponse(
      new Uint8Array([100, 111, 99, 120]).buffer,
      {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''chat.docx",
        },
      },
    )),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '聚信交付方案内容',
    latencyMs: 10,
    usage: { output_tokens: 6 },
  });
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    if (command === 'model_profile_list') {
      return Promise.resolve([
        {
          id: 'profile-1',
          displayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          modelId: 'deepseek-chat',
          temperature: 0.3,
          timeoutSeconds: 60,
          isDefault: true,
          hasApiKey: true,
        },
      ]);
    }
    if (command === 'generation_word_save') {
      expect(payload).toEqual({
        fileName: 'chat.docx',
        bytes: [100, 111, 99, 120],
      });
      return Promise.resolve('/Users/test/Downloads/chat.docx');
    }
    return Promise.resolve(undefined);
  });

  render(<ChatPage />);
  await userEvent.type(await screen.findByLabelText('告诉我你想完成什么工作'), '输出交付方案');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByText('聚信交付方案内容')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '导出 Word' }));

  await waitFor(() => expect(exportRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      conversation_id: 'session-export',
      message_id: 'assistant-message-export',
      export_type: 'single_answer',
      template: 'juxin_standard',
    }),
  ));
  const exportDialog = await screen.findByRole('dialog', { name: 'Word 已导出成功' });
  expect(within(exportDialog).getByText('文件已保存到下载目录。')).toBeInTheDocument();
  expect(within(exportDialog).getByRole('button', { name: '打开文件' })).toBeInTheDocument();
  await userEvent.click(within(exportDialog).getByRole('button', { name: '复制路径' }));
  expect(writeText).toHaveBeenCalledWith('/Users/test/Downloads/chat.docx');
  expect(await within(exportDialog).findByText('路径已复制')).toBeInTheDocument();
  const historyPane = screen.getByLabelText('历史任务');
  expect(within(historyPane).queryByText(/Word 已保存到/)).not.toBeInTheDocument();
  expect(within(historyPane).queryByText('/Users/test/Downloads/chat.docx')).not.toBeInTheDocument();
  await userEvent.click(within(exportDialog).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Word 已导出成功' })).not.toBeInTheDocument());
});

it('runs quality check and revises a weak loop answer before completing chat', async () => {
  const completeRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-revise',
      user_message_uuid: 'user-message-revise',
      assistant_message_uuid: 'assistant-message-revise',
      completion_token: 'complete-revise',
      completed: false,
      answer: '',
      messages: [
        { role: 'system', content: '商务助手：投标、标书、响应文件' },
        { role: 'user', content: '帮我写投标响应' },
      ],
      citations: [],
      loop_trace: [{ state: 'QUALITY_CHECK', action: 'revise_answer' }],
    }, { status: 201 })),
    http.post('/api/ai/agent-loop/quality-check', async ({ request }) => {
      const body = await request.json() as { answer: string };
      if (body.answer === '通用回答') {
        return HttpResponse.json({
          passed: false,
          issues: ['聚信得仁业务场景', '当前角色'],
          retry_allowed: true,
          revision_messages: [
            { role: 'system', content: '商务助手：投标、标书、响应文件' },
            { role: 'user', content: '帮我写投标响应' },
            { role: 'assistant', content: '通用回答' },
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
    http.post('/api/ai/chat/messages/assistant-message-revise/complete', async ({ request }) => {
      completeRequest(await request.json());
      return HttpResponse.json({
        message_uuid: 'assistant-message-revise',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock
    .mockResolvedValueOnce({ output: '通用回答', latencyMs: 10, usage: { output_tokens: 3 } })
    .mockResolvedValueOnce({
      output: '聚信得仁商务投标响应建议：围绕标书、响应文件和偏离表整理。',
      latencyMs: 12,
      usage: { output_tokens: 16 },
    });

  render(<ChatPage />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '助手模式' }), 'business');
  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '帮我写投标响应');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText(/聚信得仁商务投标响应建议/)).toBeInTheDocument();
  await waitFor(() => expect(generateLocalModelMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(completeRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      answer: '聚信得仁商务投标响应建议：围绕标书、响应文件和偏离表整理。',
    }),
  ));
});

it('shows fixed no-evidence answer in knowledge mode without calling model', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', () => HttpResponse.json({
      session_uuid: 'session-knowledge',
      user_message_uuid: 'user-message-knowledge',
      assistant_message_uuid: 'assistant-message-knowledge',
      completion_token: '',
      completed: true,
      answer: '当前知识库未找到明确依据',
      messages: [],
      citations: [],
    }, { status: 201 })),
  );

  render(<ChatPage />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '助手模式' }), 'knowledge');
  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '不存在的客户报价');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('当前知识库未找到明确依据')).toBeInTheDocument();
  expect(generateLocalModelMock).not.toHaveBeenCalled();
});

it('allows knowledge no-evidence answer before model configuration is completed', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'model_profile_list') return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-knowledge-no-model',
        user_message_uuid: 'user-message-knowledge-no-model',
        assistant_message_uuid: 'assistant-message-knowledge-no-model',
        completion_token: '',
        completed: true,
        answer: '当前正式知识库中未找到明确依据',
        messages: [],
        citations: [],
      }, { status: 201 });
    }),
  );

  render(<ChatPage />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '助手模式' }), 'knowledge');
  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '不存在的资料编号');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('当前正式知识库中未找到明确依据')).toBeInTheDocument();
  expect(screen.queryByText('请先配置个人模型')).not.toBeInTheDocument();
  expect(generateLocalModelMock).not.toHaveBeenCalled();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'knowledge' }),
  ));
});

it('loads messages when selecting a historical chat session', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({
      items: [{
        session_uuid: 'session-history',
        title: '会议纪要',
        mode: 'KNOWLEDGE',
        status: 'ACTIVE',
        created_at: '2026-06-26T01:00:00Z',
        updated_at: '2026-06-26T01:01:00Z',
      }],
      total: 1,
    })),
    http.get('/api/ai/chat/sessions/session-history', () => HttpResponse.json({
      session_uuid: 'session-history',
      title: '会议纪要',
      mode: 'KNOWLEDGE',
      status: 'ACTIVE',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
      task_state: {
        task_state_id: 'task-state-history',
        conversation_id: 'session-history',
        stage: 'completed',
        status: 'completed',
        label: '已完成',
        goal: '总结会议',
        selected_sources: [{ type: 'official_knowledge', count: 1 }],
        tool_calls: [{ tool_name: 'search_knowledge_base', status: 'success', summary: 'chunks=1' }],
        verification_status: 'passed',
        next_action: '可以复制、导出或继续追问',
        retry_allowed: false,
        stage_history: [
          { stage: 'analyzing', label: '正在理解你的需求', next_action: '正在理解你的需求' },
          { stage: 'retrieving', label: '正在查找资料', next_action: '正在查找资料' },
          { stage: 'quality_check', label: '正在复核结果', next_action: '正在复核结果' },
          { stage: 'completed', label: '已完成', next_action: '可以复制、导出或继续追问' },
        ],
      },
      messages: [
        {
          message_uuid: 'm-user',
          role: 'user',
          content: '总结会议',
          status: 'COMPLETED',
          citations: [],
          created_at: '2026-06-26T01:00:00Z',
        },
        {
          message_uuid: 'm-assistant',
          role: 'assistant',
          content: '根据《会议记录》，会议决定下周验收。',
          status: 'COMPLETED',
          citations: [{
            source_type: 'knowledge_file',
            file_uuid: 'file-1',
            file_name: '会议记录.txt',
            chunk_id: 'chunk-1',
            section_title: '正文',
            chunk_index: 0,
            score: 8,
          }],
          created_at: '2026-06-26T01:00:01Z',
        },
      ],
    })),
  );

  render(<ChatPage />);
  await userEvent.click(await screen.findByRole('button', { name: '会议纪要' }));

  expect(await screen.findByText('总结会议')).toBeInTheDocument();
  expect(screen.getByText(/会议决定下周验收/)).toBeInTheDocument();
  expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('已完成');
  expect(screen.getByRole('list', { name: '任务阶段' })).toHaveTextContent('正在复核结果');
  const inlineSource = screen.getByLabelText('来源：会议记录.txt');
  expect(inlineSource).toHaveClass('chat-inline-source');
  expect(inlineSource).toHaveTextContent('知识来源');
  expect(within(screen.getByRole('list', { name: '引用来源' })).getByRole('button', { name: '打开来源：会议记录.txt' })).toHaveTextContent('知识来源');
});

it('shows cited file names once without exposing chunk details', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({
      items: [{
        session_uuid: 'session-source-labels',
        title: '来源标签',
        mode: 'knowledge',
        status: 'active',
        created_at: '2026-06-26T01:00:00Z',
        updated_at: '2026-06-26T01:01:00Z',
      }],
      total: 1,
    })),
    http.get('/api/ai/chat/sessions/session-source-labels', () => HttpResponse.json({
      session_uuid: 'session-source-labels',
      title: '来源标签',
      mode: 'knowledge',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
      messages: [{
        message_uuid: 'm-assistant-source-labels',
        role: 'assistant',
        content: '根据《聚信产品白皮书.pdf》《我的会议记录.docx》《客户访谈记录.pdf》整理完成。',
        status: 'COMPLETED',
        citations: [
          {
            source_type: 'official_knowledge',
            file_uuid: 'official-file',
            file_name: '聚信产品白皮书.pdf',
            chunk_id: 'official-secret-chunk',
            page_number: 12,
            page_or_sheet: '产品参数',
            section_title: '部署方式',
            chunk_type: 'sheet_rows',
            chunk_index: 0,
            score: 9,
          },
          {
            source_type: 'official_knowledge',
            file_uuid: 'official-file',
            file_name: '聚信产品白皮书.pdf',
            chunk_id: 'official-another-secret-chunk',
            page_or_sheet: '产品参数',
            section_title: '',
            chunk_type: 'sheet_rows',
            chunk_index: 1,
            score: 8,
          },
          {
            source_type: 'personal_reference',
            file_uuid: 'personal-file',
            file_name: '我的会议记录.docx',
            chunk_id: 'personal-secret-chunk',
            page_or_sheet: '会议纪要',
            section_title: '会议讨论内容',
            chunk_type: 'text',
            chunk_index: 0,
            score: 8,
          },
          {
            source_type: 'session_attachment',
            file_uuid: 'session-file',
            file_name: '客户访谈记录.pdf',
            chunk_id: 'session-secret-chunk',
            page_number: 3,
            page_or_sheet: '访谈记录',
            section_title: '客户诉求',
            chunk_type: 'text',
            chunk_index: 0,
            score: 7,
          },
        ],
        created_at: '2026-06-26T01:00:01Z',
      }],
    })),
  );

  render(<ChatPage />);
  await userEvent.click(await screen.findByRole('button', { name: '来源标签' }));

  expect(await screen.findByText('来源')).toBeInTheDocument();
  const citationList = screen.getByRole('list', { name: '引用来源' });
  expect(within(citationList).getByRole('button', { name: '打开来源：聚信产品白皮书.pdf' })).toHaveTextContent('公司知识库');
  expect(within(citationList).getByRole('button', { name: '打开来源：我的会议记录.docx' })).toHaveTextContent('我的资料');
  expect(within(citationList).getByRole('button', { name: '打开来源：客户访谈记录.pdf' })).toHaveTextContent('当前附件');
  expect(within(citationList).queryByText('聚信产品白皮书.pdf')).not.toBeInTheDocument();
  expect(within(citationList).queryByText('我的会议记录.docx')).not.toBeInTheDocument();
  expect(within(citationList).queryByText('客户访谈记录.pdf')).not.toBeInTheDocument();
  expect(within(citationList).getByText('产品参数 · 部署方式 · 第 12 页')).toBeInTheDocument();
  expect(within(citationList).getByText('会议纪要 · 会议讨论内容')).toBeInTheDocument();
  expect(within(citationList).getByText('访谈记录 · 客户诉求 · 第 3 页')).toBeInTheDocument();
  expect(within(citationList).getByText('公司知识库')).toBeInTheDocument();
  expect(within(citationList).getByText('我的资料')).toBeInTheDocument();
  expect(within(citationList).getByText('当前附件')).toBeInTheDocument();
  expect(within(citationList).queryByText(/未识别章节|正式知识来源/)).not.toBeInTheDocument();
  expect(within(citationList).queryByText(/secret-chunk/)).not.toBeInTheDocument();
});

it('renders cited files as compact source pills instead of long filenames', async () => {
  const longFileName = '2026-07-等保合规云管平台-Web应用防火墙-API安全网关-客户演示与投标参数确认版-v8.12.31-final-final.docx';
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({
      items: [{
        session_uuid: 'session-compact-sources',
        title: '紧凑来源',
        mode: 'knowledge',
        status: 'active',
        created_at: '2026-06-26T01:00:00Z',
        updated_at: '2026-06-26T01:01:00Z',
      }],
      total: 1,
    })),
    http.get('/api/ai/chat/sessions/session-compact-sources', () => HttpResponse.json({
      session_uuid: 'session-compact-sources',
      title: '紧凑来源',
      mode: 'knowledge',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
      messages: [{
        message_uuid: 'm-assistant-compact-sources',
        role: 'assistant',
        content: `根据《${longFileName}》整理完成。`,
        status: 'COMPLETED',
        citations: [{
          source_type: 'session_attachment',
          file_uuid: 'long-session-file',
          file_name: longFileName,
          chunk_id: 'long-file-chunk',
          page_number: 8,
          page_or_sheet: '产品参数',
          section_title: '安全能力',
          chunk_type: 'text',
          chunk_index: 0,
          score: 8,
        }],
        created_at: '2026-06-26T01:00:01Z',
      }],
    })),
  );

  render(<ChatPage />);
  await userEvent.click(await screen.findByRole('button', { name: '紧凑来源' }));

  expect(await screen.findByText('来源')).toBeInTheDocument();
  const inlineSources = document.querySelectorAll('.chat-inline-source');
  expect(inlineSources).toHaveLength(1);
  expect(inlineSources[0]).toHaveTextContent('当前附件');
  expect(inlineSources[0]).toHaveAttribute('aria-label', `来源：${longFileName}`);
  expect(inlineSources[0]).toHaveAttribute('title', longFileName);
  expect(screen.queryAllByText((_content, element) => (
    element?.textContent?.includes(longFileName) ?? false
  ))).toHaveLength(0);
  expect(screen.queryByText('引用文件 1 个')).not.toBeInTheDocument();
  const citationDetails = screen.getByText('来源').closest('details');
  expect(citationDetails).not.toHaveAttribute('open');
  await userEvent.click(screen.getByText('来源'));
  const citationList = screen.getByRole('list', { name: '引用来源' });
  expect(within(citationList).queryByText(longFileName)).not.toBeInTheDocument();
  expect(within(citationList).getByRole('button', { name: `打开来源：${longFileName}` })).toHaveTextContent('当前附件');
  expect(within(citationList).getByText('产品参数 · 安全能力 · 第 8 页')).toBeInTheDocument();
});

it('renders markdown source attribution lines as source capsules without document names', async () => {
  const sourceFileName = '等保合规云管平台 技术白皮书v3.1(1).docx';
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({
      items: [{
        session_uuid: 'session-source-attribution-lines',
        title: '来源行',
        mode: 'knowledge',
        status: 'active',
        created_at: '2026-06-26T01:00:00Z',
        updated_at: '2026-06-26T01:01:00Z',
      }],
      total: 1,
    })),
    http.get('/api/ai/chat/sessions/session-source-attribution-lines', () => HttpResponse.json({
      session_uuid: 'session-source-attribution-lines',
      title: '来源行',
      mode: 'knowledge',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
      messages: [{
        message_uuid: 'm-assistant-source-attribution-lines',
        role: 'assistant',
        content: [
          '一、部署方式',
          '平台通过在云平台上创建云服务器。',
          '>',
          `> —— 《${sourceFileName}》 “产品架构及部署 / 部署方式”`,
          '二、部署速度',
          '部署过程非常快。',
          '>',
          `> —— 《${sourceFileName}》 “产品架构及部署 / 部署方式”`,
        ].join('\n'),
        status: 'COMPLETED',
        citations: [],
        created_at: '2026-06-26T01:00:01Z',
      }],
    })),
  );

  render(<ChatPage />);
  await userEvent.click(await screen.findByRole('button', { name: '来源行' }));

  expect(await screen.findByText('一、部署方式')).toBeInTheDocument();
  expect(screen.getByText('二、部署速度')).toBeInTheDocument();
  const sourceAttributions = document.querySelectorAll('.chat-source-attribution');
  expect(sourceAttributions).toHaveLength(2);
  const sourcePills = document.querySelectorAll('.chat-source-attribution .chat-inline-source');
  expect(sourcePills).toHaveLength(2);
  expect(sourcePills[0]).toHaveTextContent('来源');
  expect(sourcePills[0]).toHaveAttribute('aria-label', `来源：${sourceFileName}`);
  expect(sourcePills[0]).toHaveAttribute('title', sourceFileName);
  expect(screen.getAllByText('产品架构及部署 / 部署方式')).toHaveLength(2);
  expect(screen.queryByText(sourceFileName)).not.toBeInTheDocument();
  expect(screen.queryByText(/——/)).not.toBeInTheDocument();
});

it('opens a source preview focused on the cited chunk', async () => {
  const previewRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({
      items: [{
        session_uuid: 'session-preview',
        title: '来源预览',
        mode: 'knowledge',
        status: 'active',
        created_at: '2026-06-26T01:00:00Z',
        updated_at: '2026-06-26T01:01:00Z',
      }],
      total: 1,
    })),
    http.get('/api/ai/chat/sessions/session-preview', () => HttpResponse.json({
      session_uuid: 'session-preview',
      title: '来源预览',
      mode: 'knowledge',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
      messages: [
        {
          message_uuid: 'm-assistant-preview',
          role: 'assistant',
          content: '根据《交付手册.docx》，验收时需要提交测试报告。',
          status: 'COMPLETED',
          citations: [{
            source_type: 'official_knowledge',
            file_uuid: 'file-preview',
            file_name: '交付手册.docx',
            chunk_id: 'chunk-target',
            page_number: 6,
            section_title: '验收交付物',
            chunk_index: 2,
            score: 0.91,
          }],
          created_at: '2026-06-26T01:00:01Z',
        },
      ],
    })),
    http.get('/api/knowledge/files/file-preview/preview', ({ request }) => {
      const url = new URL(request.url);
      previewRequest({
        chunkId: url.searchParams.get('chunk_id'),
        topK: url.searchParams.get('top_k'),
      });
      return HttpResponse.json({
        file_uuid: 'file-preview',
        file_name: '交付手册.docx',
        source_kind: 'official_knowledge',
        total_chunks: 1,
        notice: '正式知识库来源。',
        chunks: [{
          chunk_id: 'chunk-target',
          chunk_index: 2,
          page_number: 6,
          page_or_sheet: '第 6 页',
          section_title: '',
          chunk_type: 'text',
          text: '验收交付物包括测试报告、部署记录和培训签到表。',
        }],
      });
    }),
  );

  render(<ChatPage />);
  await userEvent.click(await screen.findByRole('button', { name: '来源预览' }));
  await userEvent.click(await screen.findByRole('button', { name: /交付手册\.docx/ }));

  await waitFor(() => expect(previewRequest).toHaveBeenCalledWith({
    chunkId: 'chunk-target',
    topK: '1',
  }));
  expect(await screen.findByRole('region', { name: '来源预览' })).toBeInTheDocument();
  expect(screen.getByText('第 6 页')).toBeInTheDocument();
  expect(screen.getByText('验收交付物包括测试报告、部署记录和培训签到表。')).toBeInTheDocument();
  expect(screen.queryByText('未识别章节')).not.toBeInTheDocument();
  expect(screen.queryByText(/file_path|stored_file_name|storage/)).not.toBeInTheDocument();
});

it('shows upload purpose choices and submits a personal file for admin review', async () => {
  const uploadRequest = vi.fn();
  const appendedFields = new Map<string, string>();
  const originalAppend = FormData.prototype.append;
  const appendSpy = vi.spyOn(FormData.prototype, 'append').mockImplementation(function append(
    this: FormData,
    name: string,
    value: string | Blob,
  ) {
    if (typeof value === 'string') {
      appendedFields.set(name, value);
    } else if (value instanceof File) {
      appendedFields.set('file_name', value.name);
    }
    return (originalAppend as (this: FormData, name: string, value: string | Blob) => void)
      .call(this, name, value);
  });
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/files/upload', () => {
      uploadRequest();
      return HttpResponse.json({
        file_uuid: 'file-uploaded',
        file_name: 'meeting.txt',
        file_type: 'text/plain',
        file_size: 6,
        visibility: 'PRIVATE',
        status: 'READY',
        chunk_count: 1,
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'pending',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '个人素材',
        document_type: '其他',
        tags: [],
        parse_status: 'parsed',
        index_status: 'indexed',
        created_at: '2026-06-26T01:00:00Z',
      }, { status: 201 });
    }),
  );

  render(<ChatPage />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '助手模式' }), 'knowledge');
  await userEvent.upload(
    await screen.findByLabelText('上传资料'),
    new File(['会议文字内容'], 'meeting.txt', { type: 'text/plain' }),
  );

  expect(await screen.findByRole('dialog', { name: '上传资料' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '仅用于当前任务' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '保存到我的资料' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '提交管理员审核' })).toBeInTheDocument();
  expect(screen.queryByText('加入公司查公司知识')).not.toBeInTheDocument();
  expect(screen.queryByText('启用公司级 RAG')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('radio', { name: '提交管理员审核' }));
  await userEvent.click(screen.getByRole('button', { name: '开始上传' }));

  await waitFor(() => expect(uploadRequest).toHaveBeenCalled());
  expect(Object.fromEntries(appendedFields)).toEqual(expect.objectContaining({
    file_name: 'meeting.txt',
    usage_type: 'personal_reference',
    review_status: 'pending',
    rag_enabled: 'false',
    reference_enabled: 'true',
    rag_scope: 'personal',
    permission_scope: 'private',
  }));
  expect(await screen.findByText('资料已提交管理员审核：meeting.txt')).toBeInTheDocument();
  appendSpy.mockRestore();
});

it('does not enable personal references automatically after saving uploaded material', async () => {
  const uploadRequest = vi.fn();
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/files/upload', async () => {
      uploadRequest();
      return HttpResponse.json({
        file_uuid: 'file-personal-uploaded',
        file_name: '会议记录.txt',
        file_type: 'text/plain',
        file_size: 8,
        visibility: 'PRIVATE',
        status: 'READY',
        chunk_count: 1,
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '个人素材',
        document_type: '临时附件',
        tags: [],
        parse_status: 'parsed',
        index_status: 'indexed',
        created_at: '2026-06-26T01:00:00Z',
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-personal-upload',
        user_message_uuid: 'user-message-personal-upload',
        assistant_message_uuid: 'assistant-message-personal-upload',
        completion_token: 'complete-personal-upload',
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手。' },
          { role: 'user', content: '写一份会议纪要' },
        ],
        citations: [],
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/assistant-message-personal-upload/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-personal-upload',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '已生成会议纪要。',
    latencyMs: 10,
    usage: { output_tokens: 8 },
  });

  render(<ChatPage />);
  await userEvent.upload(
    await screen.findByLabelText('上传资料'),
    new File(['会议文字内容'], '会议记录.txt', { type: 'text/plain' }),
  );

  expect(await screen.findByRole('dialog', { name: '上传资料' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '开始上传' }));

  await waitFor(() => expect(uploadRequest).toHaveBeenCalled());
  expect(await screen.findByText('资料已保存到我的资料：会议记录.txt；需要参考时可在“参考资料”中选择“我的资料”。')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '助手模式' })).toHaveValue('normal');
  expect(screen.getByRole('combobox', { name: '参考资料' })).toHaveValue('official_only');

  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '写一份会议纪要');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('已生成会议纪要。')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'normal',
    include_personal_references: false,
    include_session_attachments: false,
  })));
});

it('shows upload failures inside the upload dialog', async () => {
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/files/upload', () => HttpResponse.json({
      detail: '资料上传失败：文件超过 100MB 上传限制，请压缩或拆分后再上传。',
    }, { status: 413 })),
  );

  render(<ChatPage />);
  await userEvent.upload(
    await screen.findByLabelText('上传资料'),
    new File(['large content'], '大文件.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );

  const dialog = await screen.findByRole('dialog', { name: '上传资料' });
  await userEvent.click(within(dialog).getByRole('button', { name: '开始上传' }));

  expect(await within(dialog).findByText('资料上传失败：文件超过 100MB 上传限制，请压缩或拆分后再上传。')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '开始上传' })).toBeEnabled();
});

it('does not show saved personal materials as current references before sending', async () => {
  const prepareRequest = vi.fn();
  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/files/upload', async () => {
      return HttpResponse.json({
        file_uuid: 'file-personal-toggle',
        file_name: '项目背景.txt',
        file_type: 'text/plain',
        file_size: 10,
        visibility: 'PRIVATE',
        status: 'READY',
        chunk_count: 1,
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '个人素材',
        document_type: '临时附件',
        tags: [],
        parse_status: 'parsed',
        index_status: 'indexed',
        created_at: '2026-06-26T01:00:00Z',
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/prepare', async ({ request }) => {
      prepareRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'session-personal-toggle',
        user_message_uuid: 'user-message-personal-toggle',
        assistant_message_uuid: 'assistant-message-personal-toggle',
        completion_token: 'complete-personal-toggle',
        completed: false,
        answer: '',
        messages: [
          { role: 'system', content: '你是聚信 AI 助手。' },
          { role: 'user', content: '写一段说明' },
        ],
        citations: [],
      }, { status: 201 });
    }),
    http.post('/api/ai/chat/messages/assistant-message-personal-toggle/complete', () => {
      return HttpResponse.json({
        message_uuid: 'assistant-message-personal-toggle',
        status: 'COMPLETED',
      });
    }),
  );
  generateLocalModelMock.mockResolvedValue({
    output: '说明已生成。',
    latencyMs: 10,
    usage: { output_tokens: 6 },
  });

  render(<ChatPage />);
  await userEvent.upload(
    await screen.findByLabelText('上传资料'),
    new File(['项目背景内容'], '项目背景.txt', { type: 'text/plain' }),
  );
  await userEvent.click(await screen.findByRole('button', { name: '开始上传' }));

  expect(screen.getByRole('combobox', { name: '参考资料' })).toHaveValue('official_only');
  expect(screen.queryByRole('region', { name: '当前参考资料' })).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '写一段说明');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('说明已生成。')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(expect.objectContaining({
    include_personal_references: false,
    include_session_attachments: false,
  })));
});

it('manages chat sessions across active, archive, and trash lists', async () => {
  const archiveRequest = vi.fn();
  const restoreRequest = vi.fn();
  const hardDeleteRequest = vi.fn();
  const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('trash hard delete should not depend on browser confirm');
  });
  let resolveHardDelete: (() => void) | undefined;
  let activeItems = [{
    session_uuid: 'session-active',
    title: '主动会话',
    mode: 'normal',
    status: 'active',
    created_at: '2026-06-26T01:00:00Z',
    updated_at: '2026-06-26T01:01:00Z',
  }];
  let archivedItems = [{
    session_uuid: 'session-archived',
    title: '归档任务',
    mode: 'business',
    status: 'archived',
    created_at: '2026-06-26T01:00:00Z',
    updated_at: '2026-06-26T01:01:00Z',
  }];
  let trashItems = [{
    session_uuid: 'session-trash',
    title: '删除会话',
    mode: 'normal',
    status: 'deleted',
    created_at: '2026-06-26T01:00:00Z',
    updated_at: '2026-06-26T01:01:00Z',
  }];

  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: activeItems, total: activeItems.length })),
    http.get('/api/conversations/archived', () => HttpResponse.json({ items: archivedItems, total: archivedItems.length })),
    http.get('/api/conversations/trash', () => HttpResponse.json({ items: trashItems, total: trashItems.length })),
    http.post('/api/conversations/session-active/archive', () => {
      archiveRequest();
      archivedItems = archivedItems.concat({ ...activeItems[0], status: 'archived' });
      activeItems = [];
      return HttpResponse.json({ session_uuid: 'session-active', status: 'archived' });
    }),
    http.post('/api/conversations/session-archived/restore', () => {
      restoreRequest();
      activeItems = activeItems.concat({ ...archivedItems[0], status: 'active' });
      archivedItems = [];
      return HttpResponse.json({ session_uuid: 'session-archived', status: 'active' });
    }),
    http.delete('/api/conversations/session-trash/hard-delete', () => new Promise<Response>((resolve) => {
      hardDeleteRequest();
      resolveHardDelete = () => {
        trashItems = [];
        resolve(new HttpResponse(null, { status: 204 }));
      };
    })),
  );

  render(<ChatPage />);
  expect(await screen.findByRole('button', { name: '主动会话' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '归档：主动会话' }));
  await waitFor(() => expect(archiveRequest).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('button', { name: '主动会话' })).not.toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: '归档任务' }));
  await userEvent.click(await screen.findByRole('button', { name: '恢复：归档任务' }));
  await waitFor(() => expect(restoreRequest).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: '回收站' }));
  expect(await screen.findByRole('button', { name: '删除会话' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '彻底删除：删除会话' }));
  const historyPane = screen.getByLabelText('历史任务');
  const composer = screen.getByRole('form', { name: '工作输入区' });
  expect(await within(historyPane).findByText('正在彻底删除任务…')).toBeInTheDocument();
  expect(within(composer).queryByText('正在彻底删除任务…')).not.toBeInTheDocument();
  await waitFor(() => expect(hardDeleteRequest).toHaveBeenCalled());
  resolveHardDelete?.();
  await waitFor(() => expect(screen.queryByRole('button', { name: '删除会话' })).not.toBeInTheDocument());
  expect(within(historyPane).getByText('任务已彻底删除')).toBeInTheDocument();
  expect(within(composer).queryByText('任务已彻底删除')).not.toBeInTheDocument();
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

it('confirms bulk archive and bulk delete operations', async () => {
  const bulkArchiveRequest = vi.fn();
  const bulkDeleteRequest = vi.fn();
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  let activeItems = [
    {
      session_uuid: 'session-a',
      title: '批量会话 A',
      mode: 'normal',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
    },
    {
      session_uuid: 'session-b',
      title: '批量会话 B',
      mode: 'normal',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
    },
  ];

  server.use(
    http.get('/api/conversations', () => HttpResponse.json({ items: activeItems, total: activeItems.length })),
    http.post('/api/conversations/bulk-archive', async ({ request }) => {
      bulkArchiveRequest(await request.json());
      activeItems = [];
      return HttpResponse.json({ affected: 2 });
    }),
    http.post('/api/conversations/bulk-delete', async ({ request }) => {
      bulkDeleteRequest(await request.json());
      activeItems = [];
      return HttpResponse.json({ affected: 2 });
    }),
  );

  render(<ChatPage />);
  await userEvent.click(await screen.findByLabelText('选择任务：批量会话 A'));
  await userEvent.click(await screen.findByLabelText('选择任务：批量会话 B'));
  await userEvent.click(screen.getByRole('button', { name: '批量归档' }));

  await waitFor(() => expect(bulkArchiveRequest).toHaveBeenCalledWith({
    conversation_ids: ['session-a', 'session-b'],
  }));
  expect(confirmSpy).toHaveBeenCalled();

  activeItems = [
    {
      session_uuid: 'session-a',
      title: '批量会话 A',
      mode: 'normal',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
    },
    {
      session_uuid: 'session-b',
      title: '批量会话 B',
      mode: 'normal',
      status: 'active',
      created_at: '2026-06-26T01:00:00Z',
      updated_at: '2026-06-26T01:01:00Z',
    },
  ];
  await userEvent.click(screen.getByRole('button', { name: '正常历史' }));
  await userEvent.click(await screen.findByLabelText('选择任务：批量会话 A'));
  await userEvent.click(await screen.findByLabelText('选择任务：批量会话 B'));
  await userEvent.click(screen.getByRole('button', { name: '批量删除' }));

  await waitFor(() => expect(bulkDeleteRequest).toHaveBeenCalledWith({
    conversation_ids: ['session-a', 'session-b'],
  }));
  confirmSpy.mockRestore();
});

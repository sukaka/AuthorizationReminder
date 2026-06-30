import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import { ChatPage } from '../src/pages/ChatPage';
import { server } from './setup';

const { invokeMock, generateLocalModelMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  generateLocalModelMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('../src/local/modelStream', () => ({
  generateLocalModel: generateLocalModelMock,
}));

beforeEach(() => {
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
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
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
  expect(screen.getByRole('form', { name: '工作输入区' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '助手模式' })).toHaveValue('normal');
  await userEvent.type(screen.getByLabelText('告诉我你想完成什么工作'), '写一份会议纪要{enter}');

  expect(await screen.findByText('会议纪要已生成')).toBeInTheDocument();
  await waitFor(() => expect(completeRequest).toHaveBeenCalled());
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
  expect(screen.getByLabelText('示例提示')).toHaveTextContent('写一份安全运维服务方案');
  expect(screen.queryByRole('button', { name: '写一份安全运维服务方案' })).not.toBeInTheDocument();
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
          { role: 'system', content: '你是聚信 AI 助手，已带入个人参考资料和当前会话附件。' },
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
    await screen.findByRole('combobox', { name: '引用资料' }),
    'personal_and_session',
  );
  await userEvent.type(screen.getByLabelText('告诉小聚你要完成什么'), '根据我的资料生成会议纪要');
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

  const composer = await screen.findByRole('form', { name: '对话输入区' });
  const modeSelect = screen.getByRole('combobox', { name: '聊天模式' });
  const referenceSelect = screen.getByRole('combobox', { name: '引用资料' });
  expect(within(composer).getByRole('button', { name: '知识库' })).toBeInTheDocument();
  expect(within(composer).getByRole('button', { name: '我的资料' })).toBeInTheDocument();
  expect(within(composer).getByRole('button', { name: '当前附件' })).toBeInTheDocument();

  await userEvent.click(within(composer).getByRole('button', { name: '知识库' }));
  expect(modeSelect).toHaveValue('knowledge');
  expect(referenceSelect).toHaveValue('official_only');

  await userEvent.click(within(composer).getByRole('button', { name: '我的资料' }));
  expect(referenceSelect).toHaveValue('with_personal');

  await userEvent.type(screen.getByLabelText('告诉小聚你要完成什么'), '参考我的资料写纪要');
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

it('exports an assistant reply to Word from the chat message actions', async () => {
  const exportRequest = vi.fn();
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
  await userEvent.type(await screen.findByLabelText('告诉小聚你要完成什么'), '输出交付方案');
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
  expect(await screen.findByText('Word 已保存到：/Users/test/Downloads/chat.docx')).toBeInTheDocument();
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
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '聊天模式' }), 'business');
  await userEvent.type(screen.getByLabelText('告诉小聚你要完成什么'), '帮我写投标响应');
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
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '聊天模式' }), 'knowledge');
  await userEvent.type(screen.getByLabelText('告诉小聚你要完成什么'), '不存在的客户报价');
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
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '聊天模式' }), 'knowledge');
  await userEvent.type(screen.getByLabelText('告诉小聚你要完成什么'), '不存在的资料编号');
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
          content: '会议决定下周验收。',
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
  expect(screen.getByText('会议决定下周验收。')).toBeInTheDocument();
  expect(screen.getByText(/会议记录\.txt/)).toBeInTheDocument();
});

it('labels official, personal, and session attachment citations with user-facing source boundaries', async () => {
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
        content: '根据资料整理完成。',
        status: 'COMPLETED',
        citations: [
          {
            source_type: 'official_knowledge',
            file_uuid: 'official-file',
            file_name: '聚信产品白皮书.pdf',
            chunk_id: 'official-secret-chunk',
            page_number: 12,
            section_title: '部署方式',
            chunk_index: 0,
            score: 9,
          },
          {
            source_type: 'personal_reference',
            file_uuid: 'personal-file',
            file_name: '我的会议记录.docx',
            chunk_id: 'personal-secret-chunk',
            section_title: '会议讨论内容',
            chunk_index: 0,
            score: 8,
          },
          {
            source_type: 'session_attachment',
            file_uuid: 'session-file',
            file_name: '客户访谈记录.pdf',
            chunk_id: 'session-secret-chunk',
            page_number: 3,
            section_title: '客户诉求',
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

  expect(await screen.findByText('聚信产品白皮书.pdf / 公司知识库 / 正式知识来源 / 第 12 页，部署方式')).toBeInTheDocument();
  expect(screen.getByText('我的会议记录.docx / 我的上传文件，仅用于本次内容生成 / 会议讨论内容')).toBeInTheDocument();
  expect(screen.getByText('客户访谈记录.pdf / 当前会话附件 / 第 3 页，客户诉求')).toBeInTheDocument();
  expect(screen.queryByText(/secret-chunk/)).not.toBeInTheDocument();
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
          content: '根据正式知识库资料，验收时需要提交测试报告。',
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
          section_title: '验收交付物',
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
  expect(screen.getByText('验收交付物包括测试报告、部署记录和培训签到表。')).toBeInTheDocument();
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
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: '聊天模式' }), 'knowledge');
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['会议文字内容'], 'meeting.txt', { type: 'text/plain' }),
  );

  expect(await screen.findByRole('dialog', { name: '上传资料' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '仅用于当前会话' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '保存到我的资料' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '提交管理员审核' })).toBeInTheDocument();
  expect(screen.queryByText('加入公司知识库')).not.toBeInTheDocument();
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

it('enables personal reference scope after saving an uploaded material', async () => {
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
          { role: 'system', content: '你是聚信 AI 助手，已带入个人参考资料。' },
          { role: 'user', content: '参考刚上传的会议记录生成纪要' },
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
    output: '已参考个人资料生成会议纪要。',
    latencyMs: 10,
    usage: { output_tokens: 8 },
  });

  render(<ChatPage />);
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['会议文字内容'], '会议记录.txt', { type: 'text/plain' }),
  );

  expect(await screen.findByRole('dialog', { name: '上传资料' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '开始上传' }));

  await waitFor(() => expect(uploadRequest).toHaveBeenCalled());
  expect(await screen.findByText('资料已保存到我的资料：会议记录.txt；当前对话已启用“我的资料”引用。')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '聊天模式' })).toHaveValue('knowledge');
  expect(screen.getByRole('combobox', { name: '引用资料' })).toHaveValue('with_personal');

  await userEvent.type(screen.getByLabelText('告诉小聚你要完成什么'), '参考刚上传的会议记录生成纪要');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('已参考个人资料生成会议纪要。')).toBeInTheDocument();
  await waitFor(() => expect(prepareRequest).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'knowledge',
    include_personal_references: true,
    include_session_attachments: false,
  })));
});

it('lets users see and turn off uploaded personal materials before sending', async () => {
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
    await screen.findByLabelText('上传知识文件'),
    new File(['项目背景内容'], '项目背景.txt', { type: 'text/plain' }),
  );
  await userEvent.click(await screen.findByRole('button', { name: '开始上传' }));

  const referenceRegion = await screen.findByRole('region', { name: '当前可引用资料' });
  expect(within(referenceRegion).getByText('项目背景.txt')).toBeInTheDocument();
  expect(within(referenceRegion).getByText('我的资料')).toBeInTheDocument();

  await userEvent.click(within(referenceRegion).getByRole('button', { name: '关闭引用：项目背景.txt' }));
  expect(screen.getByRole('combobox', { name: '引用资料' })).toHaveValue('official_only');
  expect(screen.queryByRole('region', { name: '当前可引用资料' })).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('告诉小聚你要完成什么'), '写一段说明');
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
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
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
    title: '归档会话',
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
    http.delete('/api/conversations/session-trash/hard-delete', () => {
      hardDeleteRequest();
      trashItems = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );

  render(<ChatPage />);
  expect(await screen.findByRole('button', { name: '主动会话' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '归档：主动会话' }));
  await waitFor(() => expect(archiveRequest).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('button', { name: '主动会话' })).not.toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: '归档会话' }));
  await userEvent.click(await screen.findByRole('button', { name: '恢复：归档会话' }));
  await waitFor(() => expect(restoreRequest).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: '回收站' }));
  expect(await screen.findByRole('button', { name: '删除会话' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '彻底删除：删除会话' }));
  await waitFor(() => expect(hardDeleteRequest).toHaveBeenCalled());
  expect(confirmSpy).toHaveBeenCalled();
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
  await userEvent.click(await screen.findByLabelText('选择会话：批量会话 A'));
  await userEvent.click(await screen.findByLabelText('选择会话：批量会话 B'));
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
  await userEvent.click(await screen.findByLabelText('选择会话：批量会话 A'));
  await userEvent.click(await screen.findByLabelText('选择会话：批量会话 B'));
  await userEvent.click(screen.getByRole('button', { name: '批量删除' }));

  await waitFor(() => expect(bulkDeleteRequest).toHaveBeenCalledWith({
    conversation_ids: ['session-a', 'session-b'],
  }));
  confirmSpy.mockRestore();
});

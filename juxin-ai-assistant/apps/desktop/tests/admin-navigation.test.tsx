import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import App from '../src/App';
import { AdminLinksPage } from '../src/pages/admin/AdminLinksPage';
import { server } from './setup';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === 'update_status') {
      return Promise.resolve({ kind: 'idle', enabled: true });
    }
    if (command === 'generation_word_save') {
      return Promise.resolve('/tmp/knowledge-export.docx');
    }
    return Promise.resolve(undefined);
  });
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
});

async function findMainNavButton(name: string) {
  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  const directButton = within(mainNav).queryByRole('button', { name });
  if (directButton) return directButton;

  const sectionByItem: Record<string, string> = {
    '我的任务': '任务与交付',
    '专业任务': '任务与交付',
    '成果中心': '任务与交付',
    '工作成果': '任务与交付',
    '助手模式': 'AI 能力',
    '工作流': 'AI 能力',
    '能力中心': 'AI 能力',
    'Agent 市场': 'AI 能力',
    '我的资料': '知识与学习',
    '学习中心': '知识与学习',
    '企业智能中枢': '企业洞察',
    '部门数据': '企业洞察',
  };
  const sectionName = sectionByItem[name];
  if (!sectionName) throw new Error(`Unknown workspace navigation item: ${name}`);

  await userEvent.click(within(mainNav).getByRole('button', { name: sectionName }));
  const sectionNav = await screen.findByRole('navigation', { name: `${sectionName}导航` });
  return within(sectionNav).getByRole('button', { name });
}

function session(role: string, managedDepartments: string[] = []) {
  const knowledgeCategories = [
    '公司制度',
    '产品资料',
    '项目交付',
    '销售商务',
    '行政人力',
    '安全运维',
    '模板范本',
    '会议纪要',
    '个人素材',
    '其他',
  ].map((name, index) => ({
    category_id: `category-${index}`,
    name,
    parent_category_id: '',
    parent_name: '',
    scope: 'company',
    sort_order: index * 10,
    status: 'ACTIVE',
    file_count: 0,
    created_at: '2026-06-20T08:00:00Z',
    updated_at: '2026-06-20T08:00:00Z',
  }));
  const knowledgeDocumentTypes = [
    '产品白皮书',
    '解决方案',
    '投标模板',
    '交付说明',
    '测试报告',
    '安全服务报告',
    '会议记录',
    '提示词手册',
    '其他',
  ].map((name, index) => ({
    document_type_id: `document-type-${index}`,
    name,
    sort_order: index * 10,
    status: 'ACTIVE',
    file_count: 0,
    created_at: '2026-06-20T08:00:00Z',
    updated_at: '2026-06-20T08:00:00Z',
  }));
  server.use(
    http.get('/api/ai/session', () => HttpResponse.json({
      user: { id: `u-${role}`, username: `${role}用户`, role },
      scope: { department: managedDepartments[0] || null, managedDepartments },
      apps: ['ai-assistant'],
      local_binding_token: 'signed-binding-token',
    })),
    http.get('/api/ai/home', () => HttpResponse.json({
      favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [],
    })),
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/conversations/archived', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/conversations/trash', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/model-profiles', () => HttpResponse.json({ items: [] })),
    http.get('/api/knowledge/categories', () => HttpResponse.json({
      items: knowledgeCategories,
      total: knowledgeCategories.length,
    })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({
      items: knowledgeDocumentTypes,
      total: knowledgeDocumentTypes.length,
    })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
  );
}

it('groups the admin sidebar into work domains and contextual tabs', async () => {
  session('admin');
  render(<App />);

  await screen.findByRole('region', { name: '私人工作助理工作区' });

  const mainNav = screen.getByRole('navigation', { name: '主导航' });
  expect(within(mainNav).getAllByRole('button')).toHaveLength(6);
  for (const name of ['对话', '项目', '任务与交付', 'AI 能力', '知识与学习', '企业洞察']) {
    expect(within(mainNav).getByRole('button', { name })).toBeInTheDocument();
  }

  const utilityNav = screen.getByRole('navigation', { name: '管理与设置' });
  for (const name of ['管理中心', '设置', '帮助与反馈']) {
    expect(within(utilityNav).getByRole('button', { name })).toBeInTheDocument();
  }
  expect(screen.queryByRole('button', { name: '4.0 编辑 Demo' })).not.toBeInTheDocument();

  await userEvent.click(within(mainNav).getByRole('button', { name: '知识与学习' }));
  const knowledgeNav = await screen.findByRole('navigation', { name: '知识与学习导航' });
  expect(within(knowledgeNav).getByRole('button', { name: '我的资料' })).toHaveAttribute('aria-current', 'page');
  expect(within(knowledgeNav).getByRole('button', { name: '学习中心' })).toBeInTheDocument();
});

it('shows AI governance pages to admin without user or server model forms', async () => {
  session('admin');
  render(<App />);

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  expect(within(mainNav).getByRole('button', { name: '企业洞察' })).toBeInTheDocument();
  const utilityNav = screen.getByRole('navigation', { name: '管理与设置' });
  expect(within(utilityNav).getByRole('button', { name: '帮助与反馈' })).toBeInTheDocument();
  await userEvent.click(within(utilityNav).getByRole('button', { name: '管理中心' }));
  expect(screen.getByRole('button', { name: '任务管理' })).toBeInTheDocument();
  const governanceNav = screen.getByRole('navigation', { name: '治理导航' });
  expect(within(governanceNav).getByRole('button', { name: '助手模式' })).toBeInTheDocument();
  expect(within(governanceNav).getByRole('button', { name: '知识库' })).toBeInTheDocument();
  const settingsButton = within(governanceNav).getByRole('button', { name: '系统设置' });
  expect(settingsButton).toBeInTheDocument();
  await userEvent.click(settingsButton);
  expect(screen.getByText('向量模型')).toBeInTheDocument();
  expect(screen.getByLabelText('向量模型名称')).toBeInTheDocument();
  expect(screen.getByText('已固定为本机 Qwen3-Embedding-4B 服务，不允许在页面修改。')).toBeInTheDocument();
  expect(screen.getByLabelText('向量模型名称')).toHaveAttribute('readonly');
  expect(screen.queryByText('服务端模型配置')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增用户' })).not.toBeInTheDocument();
});

it('hides admin-only entries from sysadmin users', async () => {
  session('sysadmin');
  render(<App />);

  expect(await screen.findByRole('region', { name: '私人工作助理工作区' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '工作台' })).not.toBeInTheDocument();
  const mainNav = screen.getByRole('navigation', { name: '主导航' });
  expect(within(mainNav).getByRole('button', { name: 'AI 能力' })).toBeInTheDocument();
  expect(within(mainNav).getByRole('button', { name: '任务与交付' })).toBeInTheDocument();
  expect(within(mainNav).getByRole('button', { name: '知识与学习' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '部门数据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交建议' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审计日志' })).not.toBeInTheDocument();
});

it('hides department data and suggestions from non-admin department managers', async () => {
  session('employee', ['销售部']);
  render(<App />);

  expect(await screen.findByRole('region', { name: '私人工作助理工作区' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '工作台' })).not.toBeInTheDocument();
  const mainNav = screen.getByRole('navigation', { name: '主导航' });
  expect(within(mainNav).getByRole('button', { name: 'AI 能力' })).toBeInTheDocument();
  expect(within(mainNav).getByRole('button', { name: '任务与交付' })).toBeInTheDocument();
  expect(within(mainNav).getByRole('button', { name: '知识与学习' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '部门数据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交建议' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
});

it('keeps governance and manager entries hidden from ordinary employees', async () => {
  session('employee');
  render(<App />);

  expect(await screen.findByRole('region', { name: '私人工作助理工作区' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '部门数据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交建议' })).not.toBeInTheDocument();
});

it('opens a role-scoped knowledge workspace for ordinary employees', async () => {
  session('employee');
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));

  expect(screen.getByRole('heading', { name: '我的资料' })).toBeInTheDocument();
  expect(screen.getAllByText('我的资料').length).toBeGreaterThan(0);
  expect(screen.getByRole('tab', { name: '资料库' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('分类目录')).toBeInTheDocument();
  expect(screen.getByText('资料概览')).toBeInTheDocument();
  expect(screen.getAllByText('上传资料').length).toBeGreaterThan(0);
  expect(screen.queryByText('知识库审核')).not.toBeInTheDocument();
  expect(screen.queryByText('待审核文档')).not.toBeInTheDocument();
});

it('searches accessible official knowledge from the knowledge page', async () => {
  const searchRequest = vi.fn();
  const previewRequest = vi.fn();
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/search', async ({ request }) => {
      searchRequest(await request.json());
      return HttpResponse.json({
        total: 1,
        sources: [{
          source_kind: 'official_knowledge',
          file_id: 'file-official-1',
          file_name: 'Web动态安全管理平台白皮书.txt',
          page_number: 3,
          section_title: '部署方式',
          chunk_id: 'chunk-search-secret',
          score: 93,
          snippet: 'Web动态安全管理平台支持本地化部署，并可结合客户网络环境实施。',
        }],
      });
    }),
    http.get('/api/knowledge/files/file-official-1/preview', ({ request }) => {
      const url = new URL(request.url);
      previewRequest({
        chunk_id: url.searchParams.get('chunk_id'),
        top_k: url.searchParams.get('top_k'),
      });
      return HttpResponse.json({
        file_uuid: 'file-official-1',
        file_name: 'Web动态安全管理平台白皮书.txt',
        source_kind: 'official_knowledge',
        notice: '正式资料。',
        total_chunks: 1,
        chunks: [{
          chunk_id: 'chunk-search-secret',
          chunk_index: 0,
          page_number: 3,
          section_title: '部署方式',
          text: 'Web动态安全管理平台支持本地化部署。',
        }],
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.type(await screen.findByLabelText('关键词或问题'), '部署方式');
  await userEvent.click(screen.getByRole('button', { name: '查找资料' }));

  await waitFor(() => expect(searchRequest).toHaveBeenCalledWith({
    question: '部署方式',
    mode: 'knowledge',
    top_k: 8,
    include_sources: true,
  }));
  const results = await screen.findByRole('region', { name: '资料查找结果' });
  expect(results).toHaveTextContent('正式资料');
  expect(results).toHaveTextContent('Web动态安全管理平台白皮书.txt');
  expect(results).toHaveTextContent('第 3 页');
  expect(results).toHaveTextContent('部署方式');
  expect(results).toHaveTextContent('本地化部署');
  expect(results).not.toHaveTextContent('chunk-search-secret');

  await userEvent.click(within(results).getByRole('button', { name: '打开来源 Web动态安全管理平台白皮书.txt' }));

  expect(previewRequest).toHaveBeenCalledWith({
    chunk_id: 'chunk-search-secret',
    top_k: '1',
  });
  expect(await screen.findByRole('region', { name: '文档预览' })).toHaveTextContent('Web动态安全管理平台支持本地化部署。');
});

it('searches personal reference material separately from official knowledge', async () => {
  const personalSearchRequest = vi.fn();
  const previewRequest = vi.fn();
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/personal-reference/search', async ({ request }) => {
      personalSearchRequest(await request.json());
      return HttpResponse.json({
        total: 1,
        notice: '该内容参考用户个人上传资料生成，仅供当前用户使用。',
        sources: [{
          source_kind: 'personal_reference',
          file_id: 'file-personal-search',
          file_name: '我的会议记录.txt',
          page_number: null,
          section_title: '会议安排',
          chunk_id: 'chunk-personal-secret',
          chunk_index: 0,
          score: 88,
          snippet: '会议记录说明下周需要完成客户培训和验收材料确认。',
        }],
      });
    }),
    http.get('/api/knowledge/files/file-personal-search/preview', ({ request }) => {
      const url = new URL(request.url);
      previewRequest({
        chunk_id: url.searchParams.get('chunk_id'),
        top_k: url.searchParams.get('top_k'),
      });
      return HttpResponse.json({
        file_uuid: 'file-personal-search',
        file_name: '我的会议记录.txt',
        source_kind: 'personal_reference',
        notice: '个人参考资料，仅你本人可见。',
        total_chunks: 1,
        chunks: [{
          chunk_id: 'chunk-personal-secret',
          chunk_index: 0,
          page_number: null,
          section_title: '会议安排',
          text: '会议记录说明下周需要完成客户培训和验收材料确认。',
        }],
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(await screen.findByRole('radio', { name: '我的资料' }));
  await userEvent.type(screen.getByLabelText('关键词或问题'), '会议培训');
  await userEvent.click(screen.getByRole('button', { name: '查找资料' }));

  await waitFor(() => expect(personalSearchRequest).toHaveBeenCalledWith({
    question: '会议培训',
    top_k: 8,
  }));
  const results = await screen.findByRole('region', { name: '资料查找结果' });
  expect(results).toHaveTextContent('我的资料');
  expect(results).toHaveTextContent('我的会议记录.txt');
  expect(results).toHaveTextContent('会议安排');
  expect(results).toHaveTextContent('客户培训和验收材料确认');
  expect(results).not.toHaveTextContent('chunk-personal-secret');
  expect(screen.getByText('该内容参考用户个人上传资料生成，仅供当前用户使用。')).toBeInTheDocument();

  await userEvent.click(within(results).getByRole('button', { name: '打开来源 我的会议记录.txt' }));

  expect(previewRequest).toHaveBeenCalledWith({
    chunk_id: 'chunk-personal-secret',
    top_k: '1',
  });
  expect(await screen.findByRole('region', { name: '文档预览' })).toHaveTextContent('客户培训和验收材料确认');
});

it('lets ordinary employees upload personal reference files from the knowledge page', async () => {
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
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/files/upload', () => {
      uploadRequest();
      return HttpResponse.json({
        file_uuid: 'file-personal-uploaded',
        knowledge_base_id: '',
        file_name: '个人模板.txt',
        file_type: 'text/plain',
        file_size: 12,
        visibility: 'PRIVATE',
        status: 'READY',
        chunk_count: 1,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '个人素材',
        document_type: '个人模板',
        tags: ['模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }, { status: 201 });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(screen.getByRole('tab', { name: '上传资料' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['个人模板内容'], '个人模板.txt', { type: 'text/plain' }),
  );
  await userEvent.click(screen.getByRole('radio', { name: '保存到我的资料' }));
  await userEvent.selectOptions(screen.getByLabelText('资料分类'), '个人素材');
  await userEvent.selectOptions(screen.getByLabelText('文档类型'), '其他');
  await userEvent.click(screen.getByRole('button', { name: '开始上传' }));

  expect(uploadRequest).toHaveBeenCalledTimes(1);
  expect(Object.fromEntries(appendedFields)).toEqual(expect.objectContaining({
    file_name: '个人模板.txt',
    usage_type: 'personal_reference',
    review_status: 'draft',
    rag_enabled: 'false',
    reference_enabled: 'true',
    rag_scope: 'personal',
    permission_scope: 'private',
    category: '个人素材',
    document_type: '其他',
    tags: '',
  }));
  const personalCard = await screen.findByRole('listitem', { name: /个人模板\.txt/ });
  expect(personalCard).toHaveTextContent('我的资料');
  expect(personalCard).toHaveTextContent('用户上传');
  expect(personalCard).not.toHaveTextContent('personal_reference');
  expect(await screen.findByText('已上传 1 个资料。')).toBeInTheDocument();
  appendSpy.mockRestore();
});

it('explains upload support and rejects unsupported document types on the knowledge page', async () => {
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(screen.getByRole('tab', { name: '上传资料' }));
  const uploadInput = await screen.findByLabelText('上传知识文件');

  await userEvent.upload(
    uploadInput,
    new File(['%PDF-1.4'], '扫描白皮书.pdf', { type: 'application/pdf' }),
    { applyAccept: false },
  );

  expect(await screen.findByText('已选择：扫描白皮书.pdf')).toBeInTheDocument();
  expect(screen.getByText('PDF 会按页面提取可复制文本，扫描件需要先转成可复制文本。')).toBeInTheDocument();

  await userEvent.upload(
    uploadInput,
    new File(['a,b\n1,2'], '客户清单.csv', { type: 'text/csv' }),
    { applyAccept: false },
  );

  expect(await screen.findByText('已选择：客户清单.csv')).toBeInTheDocument();
  expect(screen.getByText('当前版本暂不支持该文件类型，请上传 pdf、docx、xlsx、pptx、txt、md、png、jpg、jpeg 或 webp 文件。')).toBeInTheDocument();

  await userEvent.upload(
    uploadInput,
    new File(['xlsx'], '产品参数.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );

  expect(await screen.findByText('已选择：产品参数.xlsx')).toBeInTheDocument();
  expect(screen.getByText(/Excel 会按 Sheet、表头和行记录解析/)).toBeInTheDocument();

  await userEvent.upload(
    uploadInput,
    new File(['pptx'], '售前介绍.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
  );

  expect(await screen.findByText('已选择：售前介绍.pptx')).toBeInTheDocument();
  expect(screen.getByText(/PPT 会按幻灯片标题、正文和备注解析/)).toBeInTheDocument();
});

it('loads knowledge file metadata with lifecycle states for ordinary employees', async () => {
  const listFiles = vi.fn();
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => {
      listFiles();
      return HttpResponse.json({
        items: [{
          file_uuid: 'file-personal-1',
          knowledge_base_id: '',
          file_name: '会议纪要模板.docx',
          file_type: 'docx',
          file_size: 4096,
          visibility: 'private',
          status: 'READY',
          chunk_count: 3,
          created_at: '2026-06-28T09:00:00Z',
          source_type: 'user_upload',
          usage_type: 'personal_reference',
          review_status: 'draft',
          rag_enabled: false,
          reference_enabled: true,
          rag_scope: 'personal',
          permission_scope: 'private',
          category: '会议纪要',
          document_type: '个人模板',
          tags: ['会议', '模板'],
          parse_status: 'parsed',
          index_status: 'indexed',
        }],
        total: 1,
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));

  expect(await screen.findByText('会议纪要模板.docx')).toBeInTheDocument();
  expect(listFiles).toHaveBeenCalledTimes(1);
  const fileCard = screen.getByRole('listitem', { name: /会议纪要模板\.docx/ });
  expect(fileCard).toHaveTextContent('我的资料');
  expect(fileCard).toHaveTextContent('用户上传');
  expect(fileCard).not.toHaveTextContent('personal_reference');
  expect(fileCard).not.toHaveTextContent('user_upload');
  expect(fileCard).toHaveTextContent('会议纪要');
  expect(fileCard).toHaveTextContent('个人模板');
      expect(fileCard).toHaveTextContent('已整理 3 个段落');
  expect(fileCard).toHaveTextContent('可作为参考资料');
  expect(fileCard).toHaveTextContent('已就绪');
  expect(screen.queryByText('file-personal-1')).not.toBeInTheDocument();
});

it('lets administrators upload official knowledge files from the knowledge page', async () => {
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
  session('admin');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({
      items: [
        {
          base_id: 'kb-company',
          name: '公司知识库',
          description: '公司级正式资料',
          scope: 'company',
          owner_user_id: '',
          department_id: '',
          project_id: '',
          created_by: 'u-admin',
          created_at: '2026-06-28T09:00:00Z',
          updated_at: '2026-06-28T09:00:00Z',
        },
        {
          base_id: 'kb-delivery',
          name: '交付知识库',
          description: '交付资料',
          scope: 'department',
          owner_user_id: '',
          department_id: 'delivery',
          project_id: '',
          created_by: 'u-admin',
          created_at: '2026-06-28T09:00:00Z',
          updated_at: '2026-06-28T09:00:00Z',
        },
      ],
      total: 2,
    })),
    http.post('/api/knowledge/files/upload', () => {
      uploadRequest();
      return HttpResponse.json({
        file_uuid: 'file-official-uploaded',
        knowledge_base_id: 'kb-company',
        file_name: '产品白皮书.txt',
        file_type: 'text/plain',
        file_size: 20,
        visibility: 'PUBLIC',
        status: 'READY',
        chunk_count: 2,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品白皮书',
        tags: ['白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }, { status: 201 });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(screen.getByRole('tab', { name: '上传资料' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['正式产品白皮书'], '产品白皮书.txt', { type: 'text/plain' }),
  );
  expect(screen.getByRole('radio', { name: '保存为正式资料' })).toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: '保存到我的资料' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('所属资料库'), 'kb-company');
  await userEvent.selectOptions(screen.getByLabelText('资料分类'), '产品资料');
  await userEvent.selectOptions(screen.getByLabelText('文档类型'), '产品白皮书');
    await userEvent.click(screen.getByRole('button', { name: '开始上传' }));

  expect(uploadRequest).toHaveBeenCalledTimes(1);
  expect(Object.fromEntries(appendedFields)).toEqual(expect.objectContaining({
    file_name: '产品白皮书.txt',
    knowledge_base_id: 'kb-company',
    usage_type: 'official_knowledge',
    review_status: 'official',
    rag_enabled: 'true',
    reference_enabled: 'true',
    rag_scope: 'company',
    permission_scope: 'company',
    category: '产品资料',
    document_type: '产品白皮书',
    tags: '',
  }));
  const uploadedCard = await screen.findByRole('listitem', { name: /产品白皮书\.txt/ });
  expect(uploadedCard).toHaveTextContent('正式资料');
  expect(uploadedCard).toHaveTextContent('管理员上传');
  expect(uploadedCard).not.toHaveTextContent('official_knowledge');
  expect(uploadedCard).toHaveTextContent('可查找');
  expect(await screen.findByText('已上传 1 个正式资料。')).toBeInTheDocument();
  appendSpy.mockRestore();
});

it('lets administrators create a knowledge base before uploading official files', async () => {
  const createBaseRequest = vi.fn();
  session('admin');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/bases', async ({ request }) => {
      createBaseRequest(await request.json());
      return HttpResponse.json({
        base_id: 'kb-new-company',
        name: '公司默认资料库',
        description: '公司正式资料',
        scope: 'company',
        owner_user_id: '',
        department_id: '',
        project_id: '',
        created_by: 'u-admin',
        created_at: '2026-07-01T09:00:00Z',
        updated_at: '2026-07-01T09:00:00Z',
      }, { status: 201 });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(screen.getByRole('tab', { name: '上传资料' }));
  expect(await screen.findByText('暂无可选资料库，请先创建资料库。')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '新建资料库' }));
  await userEvent.clear(screen.getByLabelText('资料库名称'));
  await userEvent.type(screen.getByLabelText('资料库名称'), '公司默认资料库');
  await userEvent.clear(screen.getByLabelText('资料库说明'));
  await userEvent.type(screen.getByLabelText('资料库说明'), '公司正式资料');
  await userEvent.click(screen.getByRole('button', { name: '创建资料库' }));

  await waitFor(() => expect(createBaseRequest).toHaveBeenCalledWith({
    name: '公司默认资料库',
    description: '公司正式资料',
    scope: 'company',
    department_id: '',
    project_id: '',
  }));
  expect(await screen.findByRole('option', { name: '公司默认资料库（公司）' })).toBeInTheDocument();
  expect(screen.getByLabelText('所属资料库')).toHaveValue('kb-new-company');
  expect(screen.getByText('已创建资料库：公司默认资料库')).toBeInTheDocument();
});

it('explains when knowledge upload is rejected by the proxy body size limit', async () => {
  session('admin');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({
      items: [{
        base_id: 'kb-company',
        name: '公司知识库',
        description: '公司级正式资料',
        scope: 'company',
        owner_user_id: '',
        department_id: '',
        project_id: '',
        created_by: 'u-admin',
        created_at: '2026-06-28T09:00:00Z',
        updated_at: '2026-06-28T09:00:00Z',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/upload', () => HttpResponse.text('Request Entity Too Large', { status: 413 })),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(screen.getByRole('tab', { name: '上传资料' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['large file'], '大文件.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    { applyAccept: false },
  );
  await userEvent.click(screen.getByRole('button', { name: '开始上传' }));

  expect(await screen.findByText(/资料上传失败：文件超过 100MB 上传限制，请压缩或拆分后再上传。/)).toBeInTheDocument();
});

it('supports preview download and delete actions for visible knowledge files', async () => {
  const previewRequest = vi.fn();
  const deleteRequest = vi.fn();
  const renameRequest = vi.fn();
  const renamePrompt = vi.spyOn(window, 'prompt').mockReturnValue('项目会议纪要.docx');
  const openDownload = vi.spyOn(window, 'open').mockReturnValue(null);
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-personal-1',
        knowledge_base_id: '',
        file_name: '会议纪要模板.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '个人模板',
        tags: ['会议', '模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.get('/api/knowledge/files/file-personal-1/preview', () => {
      previewRequest();
      return HttpResponse.json({
        file_uuid: 'file-personal-1',
        file_name: '会议纪要模板.docx',
        source_kind: 'personal_reference',
        notice: '个人参考资料，仅你本人可见。',
        total_chunks: 1,
        chunks: [{
          chunk_id: 'chunk-1',
          chunk_index: 0,
          page_number: 2,
          section_title: '会议结论',
          text: '会议决定下周完成验收材料整理。',
        }],
      });
    }),
    http.patch('/api/knowledge/files/file-personal-1', async ({ request }) => {
      renameRequest(await request.json());
      return HttpResponse.json({
        file_uuid: 'file-personal-1',
        knowledge_base_id: '',
        file_name: '项目会议纪要.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '个人模板',
        tags: ['会议', '模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
    http.delete('/api/knowledge/files/file-personal-1', () => {
      deleteRequest();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /会议纪要模板\.docx/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '预览 会议纪要模板.docx' }));
  expect(previewRequest).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('region', { name: '文档预览' })).toHaveTextContent('会议决定下周完成验收材料整理。');
  expect(screen.getByRole('region', { name: '文档预览' })).toHaveTextContent('个人参考资料，仅你本人可见。');
  expect(screen.queryByText('/storage/knowledge/original')).not.toBeInTheDocument();

  await userEvent.click(within(fileCard).getByRole('button', { name: '更多操作 会议纪要模板.docx' }));
  const moreMenu = within(fileCard).getByRole('menu', { name: '会议纪要模板.docx 更多操作' });
  await userEvent.click(within(moreMenu).getByRole('menuitem', { name: '下载 会议纪要模板.docx' }));
  expect(openDownload).toHaveBeenCalledWith('/api/knowledge/files/file-personal-1/download', '_blank', 'noopener,noreferrer');

  await userEvent.click(within(fileCard).getByRole('button', { name: '更多操作 会议纪要模板.docx' }));
  const renameMenu = within(fileCard).getByRole('menu', { name: '会议纪要模板.docx 更多操作' });
  await userEvent.click(within(renameMenu).getByRole('menuitem', { name: '重命名 会议纪要模板.docx' }));
  expect(renameRequest).toHaveBeenCalledWith({ file_name: '项目会议纪要.docx' });
  expect(await screen.findByText('已重命名为：项目会议纪要.docx')).toBeInTheDocument();

  const renamedCard = await screen.findByRole('listitem', { name: /项目会议纪要\.docx/ });
  await userEvent.click(within(renamedCard).getByRole('button', { name: '更多操作 项目会议纪要.docx' }));
  const deleteMenu = within(renamedCard).getByRole('menu', { name: '项目会议纪要.docx 更多操作' });
  await userEvent.click(within(deleteMenu).getByRole('menuitem', { name: '删除 项目会议纪要.docx' }));
  expect(deleteRequest).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('会议纪要模板.docx')).not.toBeInTheDocument();

  openDownload.mockRestore();
  renamePrompt.mockRestore();
});

it('summarizes a visible knowledge file with source labels', async () => {
  const summaryRequest = vi.fn();
  const previewRequest = vi.fn();
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-personal-1',
        knowledge_base_id: '',
        file_name: '会议纪要模板.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '个人模板',
        tags: ['会议', '模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-personal-1/summary', async ({ request }) => {
      summaryRequest(await request.json());
      return HttpResponse.json({
        answer: '会议核心结论：客户希望下周完成培训，并确认验收材料清单。',
        notice: '该内容参考用户个人上传资料生成，仅供当前用户使用。',
        messages: [{ role: 'user', content: '请总结这个文档' }],
        sources: [{
          source_kind: 'personal_reference',
          file_id: 'file-personal-1',
          file_name: '会议纪要模板.docx',
          page_number: 2,
          section_title: '会议结论',
          chunk_id: 'chunk-secret-1',
          score: 91,
          snippet: '客户希望下周完成培训，并确认验收材料清单。',
        }],
      });
    }),
    http.get('/api/knowledge/files/file-personal-1/preview', ({ request }) => {
      const url = new URL(request.url);
      previewRequest({
        chunk_id: url.searchParams.get('chunk_id'),
        top_k: url.searchParams.get('top_k'),
      });
      return HttpResponse.json({
        file_uuid: 'file-personal-1',
        file_name: '会议纪要模板.docx',
        source_kind: 'personal_reference',
        notice: '个人参考资料，仅你本人可见。',
        total_chunks: 1,
        chunks: [{
          chunk_id: 'chunk-secret-1',
          chunk_index: 0,
          page_number: 2,
          section_title: '会议结论',
          text: '客户希望下周完成培训，并确认验收材料清单。',
        }],
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /会议纪要模板\.docx/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '总结 会议纪要模板.docx' }));

  expect(summaryRequest).toHaveBeenCalledWith({
    mode: 'normal',
    top_k: 6,
    include_sources: true,
  });
  const summary = await screen.findByRole('region', { name: '文档总结' });
  expect(summary).toHaveTextContent('会议核心结论：客户希望下周完成培训');
  expect(summary).toHaveTextContent('该内容参考用户个人上传资料生成，仅供当前用户使用。');
  expect(summary).toHaveTextContent('我的资料');
  expect(summary).toHaveTextContent('会议纪要模板.docx');
  expect(summary).toHaveTextContent('第 2 页');
  expect(summary).toHaveTextContent('会议结论');
  expect(summary).not.toHaveTextContent('chunk-secret-1');

  await userEvent.click(within(summary).getByRole('button', { name: '打开来源 会议纪要模板.docx' }));

  expect(previewRequest).toHaveBeenCalledWith({
    chunk_id: 'chunk-secret-1',
    top_k: '1',
  });
  expect(await screen.findByRole('region', { name: '文档预览' })).toHaveTextContent('客户希望下周完成培训');
  expect(screen.queryByText('chunk-secret-1')).not.toBeInTheDocument();
});

it('generates editable content from a visible knowledge file with personal source labels', async () => {
  const generateRequest = vi.fn();
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-personal-1',
        knowledge_base_id: '',
        file_name: '会议纪要模板.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '个人模板',
        tags: ['会议', '模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-personal-1/ask', async ({ request }) => {
      generateRequest(await request.json());
      return HttpResponse.json({
        answer: '根据会议纪要模板生成的工作草稿：一、会议背景；二、会议结论；三、下一步计划。',
        notice: '该内容参考用户个人上传资料生成，仅供当前用户使用。',
        messages: [{ role: 'user', content: '请根据这个文档生成一份可编辑的工作草稿。' }],
        sources: [{
          source_kind: 'personal_reference',
          file_id: 'file-personal-1',
          file_name: '会议纪要模板.docx',
          page_number: 2,
          section_title: '模板结构',
          chunk_id: 'chunk-generate-secret',
          score: 88,
          snippet: '模板包含会议背景、会议结论和下一步计划。',
        }],
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /会议纪要模板\.docx/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '根据此资料生成 会议纪要模板.docx' }));

  expect(generateRequest).toHaveBeenCalledWith({
    question: '请根据这个文档生成一份可直接编辑的工作草稿，保留核心依据、结构化输出，并在末尾标明参考来源。',
    mode: 'normal',
    top_k: 6,
    include_sources: true,
  });
  const result = await screen.findByRole('region', { name: '文档生成结果' });
  expect(result).toHaveTextContent('根据会议纪要模板生成的工作草稿');
  expect(result).toHaveTextContent('该内容参考用户个人上传资料生成，仅供当前用户使用。');
  expect(result).toHaveTextContent('我的资料');
  expect(result).toHaveTextContent('模板结构');
  expect(result).not.toHaveTextContent('chunk-generate-secret');
});

it('asks a custom question about a visible knowledge file', async () => {
  const askRequest = vi.fn();
  const exportRequest = vi.fn();
  const saveChatRequest = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:knowledge-export'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-personal-1',
        knowledge_base_id: '',
        file_name: '会议纪要模板.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '个人模板',
        tags: ['会议', '模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-personal-1/ask', async ({ request }) => {
      askRequest(await request.json());
      return HttpResponse.json({
        answer: '文档回答：验收材料需要包含会议结论、责任人和下一步计划。',
        notice: '该内容参考用户个人上传资料生成，仅供当前用户使用。',
        messages: [{ role: 'user', content: '验收材料需要包含什么？' }],
        sources: [{
          source_kind: 'personal_reference',
          file_id: 'file-personal-1',
          file_name: '会议纪要模板.docx',
          page_number: 2,
          section_title: '验收材料',
          chunk_id: 'chunk-ask-secret',
          score: 90,
          snippet: '验收材料包含会议结论、责任人和下一步计划。',
        }],
      });
    }),
    http.post('/api/export/word/content', async ({ request }) => {
      exportRequest(await request.json());
      return HttpResponse.json({
        file_name: '资料提问结果.docx',
        download_url: '/api/export/download/knowledge-export',
      }, { status: 201 });
    }),
    http.get('/api/export/download/knowledge-export', () => new HttpResponse(
      new Uint8Array([100, 111, 99, 120]).buffer,
      {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''knowledge.docx",
        },
      },
    )),
    http.post('/api/ai/chat/knowledge-result', async ({ request }) => {
      saveChatRequest(await request.json());
      return HttpResponse.json({
        session_uuid: 'knowledge-session-1',
        user_message_uuid: 'knowledge-user-message-1',
        assistant_message_uuid: 'knowledge-assistant-message-1',
      }, { status: 201 });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /会议纪要模板\.docx/ });

  await userEvent.type(
    within(fileCard).getByLabelText('问题 会议纪要模板.docx'),
    '验收材料需要包含什么？',
  );
  await userEvent.click(within(fileCard).getByRole('button', { name: '问这个文档 会议纪要模板.docx' }));

  expect(askRequest).toHaveBeenCalledWith({
    question: '验收材料需要包含什么？',
    mode: 'normal',
    top_k: 6,
    include_sources: true,
  });
  const result = await screen.findByRole('region', { name: '资料提问结果' });
  expect(result).toHaveTextContent('文档回答：验收材料需要包含会议结论');
  expect(result).toHaveTextContent('我的资料');
  expect(result).toHaveTextContent('验收材料');
  expect(result).not.toHaveTextContent('chunk-ask-secret');

  await userEvent.click(within(result).getByRole('button', { name: '导出 Word' }));

  await waitFor(() => expect(exportRequest).toHaveBeenCalledWith({
    title: '会议纪要模板.docx-资料提问结果',
    content: '文档回答：验收材料需要包含会议结论、责任人和下一步计划。',
    template: 'juxin_standard',
    sources: [{
      source_kind: 'personal_reference',
      file_id: 'file-personal-1',
      file_name: '会议纪要模板.docx',
      page_number: 2,
      section_title: '验收材料',
      chunk_id: 'chunk-ask-secret',
      score: 90,
      snippet: '验收材料包含会议结论、责任人和下一步计划。',
    }],
  }));
  expect(await screen.findByText('Word 已保存到：/tmp/knowledge-export.docx')).toBeInTheDocument();

  await userEvent.click(within(result).getByRole('button', { name: '保存到历史任务' }));

  await waitFor(() => expect(saveChatRequest).toHaveBeenCalledWith({
    question: '验收材料需要包含什么？',
    answer: '文档回答：验收材料需要包含会议结论、责任人和下一步计划。',
    mode: 'normal',
    sources: [{
      source_kind: 'personal_reference',
      file_id: 'file-personal-1',
      file_name: '会议纪要模板.docx',
      page_number: 2,
      section_title: '验收材料',
      chunk_id: 'chunk-ask-secret',
      score: 90,
      snippet: '验收材料包含会议结论、责任人和下一步计划。',
    }],
  }));
  expect(await screen.findByText('已保存到历史任务。')).toBeInTheDocument();
  anchorClick.mockRestore();
});

it('submits a personal knowledge file for administrator review', async () => {
  const submitReview = vi.fn();
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-personal-1',
        knowledge_base_id: '',
        file_name: '会议纪要模板.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'draft',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '个人模板',
        tags: ['会议', '模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-personal-1/submit-review', async ({ request }) => {
      submitReview(await request.json());
      return HttpResponse.json({
        file_uuid: 'file-personal-1',
        knowledge_base_id: '',
        file_name: '会议纪要模板.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'private',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'pending',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '个人模板',
        tags: ['会议', '模板'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /会议纪要模板\.docx/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '更多操作 会议纪要模板.docx' }));
  await userEvent.click(within(fileCard).getByRole('menuitem', { name: '提交审核 会议纪要模板.docx' }));

  expect(submitReview).toHaveBeenCalledWith({ comment: '用户从桌面端提交管理员审核' });
  expect(fileCard).toHaveTextContent('待审核');
  expect(within(fileCard).queryByRole('menuitem', { name: '提交审核 会议纪要模板.docx' })).not.toBeInTheDocument();
});

it('lets administrators enable and disable RAG for official knowledge files', async () => {
  const enableRag = vi.fn();
  const disableRag = vi.fn();
  session('admin');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-official-1',
        knowledge_base_id: 'kb-company',
        file_name: '产品白皮书.pdf',
        file_type: 'pdf',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 8,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品白皮书',
        tags: ['产品', '白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-official-1/enable-rag', () => {
      enableRag();
      return HttpResponse.json({
        file_uuid: 'file-official-1',
        knowledge_base_id: 'kb-company',
        file_name: '产品白皮书.pdf',
        file_type: 'pdf',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 8,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品白皮书',
        tags: ['产品', '白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
    http.post('/api/knowledge/files/file-official-1/disable-rag', () => {
      disableRag();
      return HttpResponse.json({
        file_uuid: 'file-official-1',
        knowledge_base_id: 'kb-company',
        file_name: '产品白皮书.pdf',
        file_type: 'pdf',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 8,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品白皮书',
        tags: ['产品', '白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /产品白皮书\.pdf/ });

  expect(fileCard).toHaveTextContent('已整理 8 个段落');
  await userEvent.click(within(fileCard).getByRole('button', { name: '更多操作 产品白皮书.pdf' }));
  await userEvent.click(within(fileCard).getByRole('menuitem', { name: '启用资料查找 产品白皮书.pdf' }));
  expect(enableRag).toHaveBeenCalledTimes(1);
  expect(fileCard).toHaveTextContent('可查找');
  expect(within(fileCard).queryByRole('menuitem', { name: '启用资料查找 产品白皮书.pdf' })).not.toBeInTheDocument();

  await userEvent.click(within(fileCard).getByRole('button', { name: '更多操作 产品白皮书.pdf' }));
  await userEvent.click(within(fileCard).getByRole('menuitem', { name: '停用资料查找 产品白皮书.pdf' }));
  expect(disableRag).toHaveBeenCalledTimes(1);
  expect(fileCard).toHaveTextContent('已整理 8 个段落');
});

it('shows secondary knowledge categories in the left rail and filters by them', async () => {
  session('admin');
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({
      items: [
        {
          category_id: 'category-product',
          name: '产品资料',
          parent_category_id: '',
          parent_name: '',
          scope: 'company',
          sort_order: 10,
          status: 'ACTIVE',
          file_count: 0,
          created_at: '2026-06-20T08:00:00Z',
          updated_at: '2026-06-20T08:00:00Z',
        },
        {
          category_id: 'category-wdsp',
          name: 'wdsp',
          parent_category_id: 'category-product',
          parent_name: '产品资料',
          scope: 'company',
          sort_order: 20,
          status: 'ACTIVE',
          file_count: 1,
          created_at: '2026-06-20T08:00:00Z',
          updated_at: '2026-06-20T08:00:00Z',
        },
      ],
      total: 2,
    })),
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-wdsp',
        knowledge_base_id: 'kb-company',
        file_name: 'WEB动态安全管理平台白皮书v3.1.docx',
        file_type: 'docx',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 6,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: 'wdsp',
        document_type: '产品白皮书',
        tags: ['产品', '白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const categoryRail = await screen.findByLabelText('分类目录');
  const parentCategory = within(categoryRail).getByRole('button', { name: '产品资料1' });
  const nestedCategory = within(categoryRail).getByRole('button', { name: 'wdsp1' });

  expect(parentCategory).not.toHaveClass('is-child');

  await userEvent.click(parentCategory);
  const secondaryFilters = await screen.findByLabelText('产品资料 二级分类筛选');
  expect(within(secondaryFilters).getByRole('button', { name: '全部' })).toHaveAttribute('aria-current', 'true');
  expect(within(secondaryFilters).queryByRole('button', { name: 'wdsp' })).not.toBeInTheDocument();
  expect(await screen.findByRole('listitem', { name: /WEB动态安全管理平台白皮书v3\.1\.docx/ })).toBeInTheDocument();

  await userEvent.click(nestedCategory);
  expect(nestedCategory).toHaveAttribute('aria-current', 'true');
  expect(within(secondaryFilters).getByRole('button', { name: 'wdsp' })).toHaveAttribute('aria-current', 'true');

  await userEvent.click(within(secondaryFilters).getByRole('button', { name: '更多分类' }));
  const morePanel = await screen.findByRole('dialog', { name: '更多二级分类' });
  const childCategory = within(morePanel).getByRole('button', { name: 'wdsp' });
  await userEvent.click(childCategory);
  expect(within(secondaryFilters).getByRole('button', { name: 'wdsp' })).toHaveAttribute('aria-current', 'true');
  expect(await screen.findByRole('listitem', { name: /WEB动态安全管理平台白皮书v3\.1\.docx/ })).toBeInTheDocument();
});

it('opens a searchable secondary category panel when one parent has many children', async () => {
  session('admin');
  const childCategories = Array.from({ length: 9 }, (_, index) => ({
    category_id: `category-product-child-${index}`,
    name: `产品子类${index + 1}`,
    parent_category_id: 'category-product',
    parent_name: '产品资料',
    scope: 'company',
    sort_order: 20 + index,
    status: 'ACTIVE',
    file_count: 0,
    created_at: '2026-06-20T08:00:00Z',
    updated_at: '2026-06-20T08:00:00Z',
  }));
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({
      items: [
        {
          category_id: 'category-product',
          name: '产品资料',
          parent_category_id: '',
          parent_name: '',
          scope: 'company',
          sort_order: 10,
          status: 'ACTIVE',
          file_count: 0,
          created_at: '2026-06-20T08:00:00Z',
          updated_at: '2026-06-20T08:00:00Z',
        },
        ...childCategories,
      ],
      total: childCategories.length + 1,
    })),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const categoryRail = await screen.findByLabelText('分类目录');
  await userEvent.click(within(categoryRail).getByRole('button', { name: '产品资料' }));

  const secondaryFilters = await screen.findByLabelText('产品资料 二级分类筛选');
  expect(within(secondaryFilters).queryByRole('button', { name: '产品子类1' })).not.toBeInTheDocument();
  expect(within(secondaryFilters).queryByRole('button', { name: '产品子类9' })).not.toBeInTheDocument();

  await userEvent.click(within(secondaryFilters).getByRole('button', { name: '更多分类' }));
  const morePanel = await screen.findByRole('dialog', { name: '更多二级分类' });
  await userEvent.type(within(morePanel).getByLabelText('搜索二级分类'), '9');
  await userEvent.click(within(morePanel).getByRole('button', { name: '产品子类9' }));
  expect(within(secondaryFilters).getByRole('button', { name: '产品子类9' })).toHaveAttribute('aria-current', 'true');
});

it('lets administrators reparse official knowledge files', async () => {
  const reparseFile = vi.fn();
  session('admin');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-official-reparse',
        knowledge_base_id: 'kb-company',
        file_name: '交付手册.docx',
        file_type: 'docx',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 6,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品交付',
        document_type: '安装部署手册',
        tags: ['交付', '部署'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-official-reparse/reparse', () => {
      reparseFile();
      return HttpResponse.json({
        file_uuid: 'file-official-reparse',
        knowledge_base_id: 'kb-company',
        file_name: '交付手册.docx',
        file_type: 'docx',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 9,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品交付',
        document_type: '安装部署手册',
        tags: ['交付', '部署'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /交付手册\.docx/ });

  expect(fileCard).toHaveTextContent('已整理 6 个段落');
  await userEvent.click(within(fileCard).getByRole('button', { name: '更多操作 交付手册.docx' }));
  await userEvent.click(within(fileCard).getByRole('menuitem', { name: '重新处理 交付手册.docx' }));
  expect(reparseFile).toHaveBeenCalledTimes(1);
  expect(fileCard).toHaveTextContent('已整理 9 个段落');
});

it('lets administrators edit official knowledge category and document type', async () => {
  const updateMetadata = vi.fn();
  session('admin');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-official-metadata',
        knowledge_base_id: 'kb-company',
        file_name: '产品白皮书.pdf',
        file_type: 'pdf',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 8,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品白皮书',
        tags: ['产品', '白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.patch('/api/knowledge/files/file-official-metadata', async ({ request }) => {
      updateMetadata(await request.json());
      return HttpResponse.json({
        file_uuid: 'file-official-metadata',
        knowledge_base_id: 'kb-company',
        file_name: 'WDSP 产品白皮书.pdf',
        file_type: 'pdf',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 8,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '安全运维',
        document_type: '解决方案',
        tags: [],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const fileCard = await screen.findByRole('listitem', { name: /产品白皮书\.pdf/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '更多操作 产品白皮书.pdf' }));
  await userEvent.click(within(fileCard).getByRole('menuitem', { name: '编辑资料分类 产品白皮书.pdf' }));
  await userEvent.clear(within(fileCard).getByLabelText('文件名称'));
  await userEvent.type(within(fileCard).getByLabelText('文件名称'), 'WDSP 产品白皮书.pdf');
  await userEvent.selectOptions(within(fileCard).getByLabelText('资料分类'), '安全运维');
  await userEvent.selectOptions(within(fileCard).getByLabelText('文档类型'), '解决方案');
  await userEvent.click(within(fileCard).getByRole('button', { name: '保存元数据 产品白皮书.pdf' }));

  expect(updateMetadata).toHaveBeenCalledWith({
    file_name: 'WDSP 产品白皮书.pdf',
    category: '安全运维',
    document_type: '解决方案',
    tags: [],
    external_public: false,
    external_download_allowed: false,
  });
  expect(fileCard).toHaveTextContent('WDSP 产品白皮书.pdf');
  expect(fileCard).toHaveTextContent('安全运维 · 解决方案 · 正式资料');
});

it('lets administrators archive files and manage the knowledge trash', async () => {
  const archiveFile = vi.fn();
  const listTrash = vi.fn();
  const restoreFile = vi.fn();
  const hardDeleteFile = vi.fn();
  session('admin');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-official-archive',
        knowledge_base_id: 'kb-company',
        file_name: '产品白皮书.pdf',
        file_type: 'pdf',
        file_size: 8192,
        visibility: 'company',
        status: 'READY',
        chunk_count: 8,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品白皮书',
        tags: ['产品', '白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-official-archive/archive', () => {
      archiveFile();
      return HttpResponse.json({
        file_uuid: 'file-official-archive',
        knowledge_base_id: 'kb-company',
        file_name: '产品白皮书.pdf',
        file_type: 'pdf',
        file_size: 8192,
        visibility: 'company',
        status: 'ARCHIVED',
        chunk_count: 8,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品白皮书',
        tags: ['产品', '白皮书'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
    http.get('/api/knowledge/files/trash', () => {
      listTrash();
      return HttpResponse.json({
        items: [
          {
            file_uuid: 'file-trash-restore',
            knowledge_base_id: 'kb-company',
            file_name: '已删除资料.docx',
            file_type: 'docx',
            file_size: 4096,
            visibility: 'company',
            status: 'DELETED',
            chunk_count: 3,
            created_at: '2026-06-28T09:00:00Z',
            source_type: 'admin_upload',
            usage_type: 'official_knowledge',
            review_status: 'official',
            rag_enabled: false,
            reference_enabled: true,
            rag_scope: 'company',
            permission_scope: 'company',
            category: '安全运维',
            document_type: '解决方案',
            tags: ['方案'],
            parse_status: 'parsed',
            index_status: 'indexed',
          },
          {
            file_uuid: 'file-trash-hard-delete',
            knowledge_base_id: 'kb-company',
            file_name: '待彻底删除.pdf',
            file_type: 'pdf',
            file_size: 1024,
            visibility: 'company',
            status: 'DELETED',
            chunk_count: 1,
            created_at: '2026-06-28T09:05:00Z',
            source_type: 'admin_upload',
            usage_type: 'official_knowledge',
            review_status: 'official',
            rag_enabled: false,
            reference_enabled: true,
            rag_scope: 'company',
            permission_scope: 'company',
            category: '其他',
            document_type: '其他',
            tags: [],
            parse_status: 'parsed',
            index_status: 'indexed',
          },
        ],
        total: 2,
      });
    }),
    http.post('/api/knowledge/files/file-trash-restore/restore', () => {
      restoreFile();
      return HttpResponse.json({
        file_uuid: 'file-trash-restore',
        knowledge_base_id: 'kb-company',
        file_name: '已删除资料.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'company',
        status: 'READY',
        chunk_count: 3,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '安全运维',
        document_type: '解决方案',
        tags: ['方案'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
    http.delete('/api/knowledge/files/file-trash-hard-delete/hard-delete', ({ request }) => {
      hardDeleteFile(new URL(request.url).searchParams.get('confirm'));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const activeCard = await screen.findByRole('listitem', { name: /产品白皮书\.pdf/ });

  await userEvent.click(within(activeCard).getByRole('button', { name: '更多操作 产品白皮书.pdf' }));
  await userEvent.click(within(activeCard).getByRole('menuitem', { name: '归档 产品白皮书.pdf' }));
  expect(archiveFile).toHaveBeenCalledTimes(1);
  expect(activeCard).toHaveTextContent('已保存');
  expect(activeCard).toHaveTextContent('已整理 8 个段落');

  await userEvent.click(screen.getByRole('button', { name: '查看回收站' }));
  expect(listTrash).toHaveBeenCalledTimes(1);
  const restoreCard = await screen.findByRole('listitem', { name: /已删除资料\.docx/ });
  const hardDeleteCard = await screen.findByRole('listitem', { name: /待彻底删除\.pdf/ });
  expect(restoreCard).toHaveTextContent('已保存');

  await userEvent.click(within(restoreCard).getByRole('button', { name: '恢复 已删除资料.docx' }));
  expect(restoreFile).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('已删除资料.docx')).not.toBeInTheDocument();

  await userEvent.click(within(hardDeleteCard).getByRole('button', { name: '彻底删除 待彻底删除.pdf' }));
  expect(hardDeleteFile).toHaveBeenCalledWith('true');
  expect(screen.queryByText('待彻底删除.pdf')).not.toBeInTheDocument();
});

it('lets administrators approve and reject pending knowledge review files', async () => {
  const approveReview = vi.fn();
  const rejectReview = vi.fn();
  session('admin');
  server.use(
    http.get('/api/knowledge/bases', () => HttpResponse.json({
      items: [
        {
          base_id: 'kb-company',
          name: '公司正式知识库',
          description: '正式知识来源',
          scope: 'company',
          owner_user_id: '',
          department_id: '',
          project_id: '',
          created_by: 'admin',
          created_at: '2026-06-20T08:00:00Z',
          updated_at: '2026-06-20T08:00:00Z',
        },
      ],
      total: 1,
    })),
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [
        {
          file_uuid: 'file-pending-approve',
          knowledge_base_id: 'kb-company',
          file_name: '待审核方案.docx',
          file_type: 'docx',
          file_size: 4096,
          visibility: 'private',
          status: 'READY',
          chunk_count: 4,
          created_at: '2026-06-28T09:00:00Z',
          source_type: 'user_upload',
          usage_type: 'personal_reference',
          review_status: 'pending',
          rag_enabled: false,
          reference_enabled: true,
          rag_scope: 'personal',
          permission_scope: 'private',
          category: '安全运维',
          document_type: '解决方案',
          tags: [],
          parse_status: 'parsed',
          index_status: 'indexed',
        },
        {
          file_uuid: 'file-pending-reject',
          knowledge_base_id: 'kb-company',
          file_name: '待审核记录.docx',
          file_type: 'docx',
          file_size: 2048,
          visibility: 'private',
          status: 'READY',
          chunk_count: 2,
          created_at: '2026-06-28T09:05:00Z',
          source_type: 'user_upload',
          usage_type: 'personal_reference',
          review_status: 'pending',
          rag_enabled: false,
          reference_enabled: true,
          rag_scope: 'personal',
          permission_scope: 'private',
          category: '会议纪要',
          document_type: '会议纪要',
          tags: ['会议'],
          parse_status: 'parsed',
          index_status: 'indexed',
        },
      ],
      total: 2,
    })),
    http.post('/api/knowledge/files/file-pending-approve/approve', async ({ request }) => {
      approveReview(await request.json());
      return HttpResponse.json({
        file_uuid: 'file-pending-approve',
        knowledge_base_id: 'kb-company',
        file_name: '待审核方案.docx',
        file_type: 'docx',
        file_size: 4096,
        visibility: 'company',
        status: 'READY',
        chunk_count: 4,
        created_at: '2026-06-28T09:00:00Z',
        source_type: 'user_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '安全运维',
        document_type: '解决方案',
        tags: [],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
    http.post('/api/knowledge/files/file-pending-reject/reject', async ({ request }) => {
      rejectReview(await request.json());
      return HttpResponse.json({
        file_uuid: 'file-pending-reject',
        knowledge_base_id: 'kb-company',
        file_name: '待审核记录.docx',
        file_type: 'docx',
        file_size: 2048,
        visibility: 'private',
        status: 'READY',
        chunk_count: 2,
        created_at: '2026-06-28T09:05:00Z',
        source_type: 'user_upload',
        usage_type: 'personal_reference',
        review_status: 'rejected',
        rag_enabled: false,
        reference_enabled: true,
        rag_scope: 'personal',
        permission_scope: 'private',
        category: '会议纪要',
        document_type: '会议纪要',
        tags: ['会议'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  const approveCard = await screen.findByRole('listitem', { name: /待审核方案\.docx/ });
  const rejectCard = await screen.findByRole('listitem', { name: /待审核记录\.docx/ });

  await userEvent.click(within(approveCard).getByRole('button', { name: '审核通过 待审核方案.docx' }));
  expect(approveReview).not.toHaveBeenCalled();
  const approveDialog = await screen.findByRole('dialog', { name: '审核通过 待审核方案.docx' });
  await userEvent.selectOptions(within(approveDialog).getByLabelText('所属知识库'), 'kb-company');
  await userEvent.selectOptions(within(approveDialog).getByLabelText('资料分类'), '产品资料');
  await userEvent.selectOptions(within(approveDialog).getByLabelText('文档类型'), '产品白皮书');
  await userEvent.clear(within(approveDialog).getByLabelText('审核备注'));
  await userEvent.type(within(approveDialog).getByLabelText('审核备注'), '分类后通过');
  await userEvent.click(within(approveDialog).getByRole('button', { name: '确认通过' }));
  expect(approveReview).toHaveBeenCalledWith({
    knowledge_base_id: 'kb-company',
    comment: '分类后通过',
    permission_scope: 'company',
    rag_scope: 'company',
    category: '产品资料',
    document_type: '产品白皮书',
    tags: [],
  });
  expect(approveCard).toHaveTextContent('正式资料');
  expect(approveCard).not.toHaveTextContent('official_knowledge');
  expect(approveCard).toHaveTextContent('可查找');
  expect(approveCard).toHaveTextContent('可查找');
  expect(within(approveCard).queryByRole('button', { name: '审核通过 待审核方案.docx' })).not.toBeInTheDocument();

  await userEvent.click(within(rejectCard).getByRole('button', { name: '审核驳回 待审核记录.docx' }));
  expect(rejectReview).toHaveBeenCalledWith({ comment: '管理员从桌面端审核驳回' });
  expect(rejectCard).toHaveTextContent('已驳回');
  expect(rejectCard).toHaveTextContent('已整理 2 个段落');
  expect(within(rejectCard).queryByRole('button', { name: '审核驳回 待审核记录.docx' })).not.toBeInTheDocument();
});

it('opens the administrator knowledge workspace from the sidebar', async () => {
  session('admin');
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));

  expect(screen.getByRole('heading', { name: '我的资料' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '资料库' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '上传资料' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '字典管理' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '审核与回收站' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '字典管理' }));
  expect(screen.getByRole('tab', { name: '资料分类' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: '文档类型' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: '资料分类字典表' })).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: '文档类型字典表' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '文档类型' }));
  expect(screen.getByRole('table', { name: '文档类型字典表' })).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: '资料分类字典表' })).not.toBeInTheDocument();
});

it('lets administrators manage knowledge document types in a drawer and use them in upload forms', async () => {
  const createDocumentType = vi.fn();
  const updateDocumentType = vi.fn();
  const deleteDocumentType = vi.fn();
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  session('admin');
  server.use(
    http.get('/api/knowledge/document-types', () => HttpResponse.json({
      items: [{
        document_type_id: 'document-type-whitepaper',
        name: '产品白皮书',
        sort_order: 10,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:00Z',
      }, {
        document_type_id: 'document-type-solution',
        name: '解决方案',
        sort_order: 20,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:00Z',
      }],
      total: 2,
    })),
    http.post('/api/knowledge/document-types', async ({ request }) => {
      createDocumentType(await request.json());
      return HttpResponse.json({
        document_type_id: 'document-type-acceptance',
        name: '验收报告',
        sort_order: 30,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:00Z',
      }, { status: 201 });
    }),
    http.patch('/api/knowledge/document-types/document-type-acceptance', async ({ request }) => {
      updateDocumentType(await request.json());
      return HttpResponse.json({
        document_type_id: 'document-type-acceptance',
        name: '验收材料',
        sort_order: 35,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:00Z',
      });
    }),
    http.delete('/api/knowledge/document-types/document-type-acceptance', () => {
      deleteDocumentType();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(screen.getByRole('tab', { name: '字典管理' }));
  await userEvent.click(screen.getByRole('tab', { name: '文档类型' }));

  await userEvent.click(await screen.findByRole('button', { name: '新建文档类型' }));
  const createDrawer = await screen.findByRole('dialog', { name: '新建文档类型' });
  await userEvent.type(within(createDrawer).getByLabelText('文档类型名称'), '验收报告');
  await userEvent.click(within(createDrawer).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(createDocumentType).toHaveBeenCalledWith(expect.objectContaining({
    name: '验收报告',
    status: 'ACTIVE',
  })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建文档类型' })).not.toBeInTheDocument());
  const createdRow = within(await screen.findByRole('table', { name: '文档类型字典表' })).getByRole('row', { name: /验收报告/ });

  await userEvent.click(within(createdRow).getByRole('button', { name: '编辑 验收报告' }));
  const editDrawer = await screen.findByRole('dialog', { name: '编辑文档类型' });
  await userEvent.clear(within(editDrawer).getByLabelText('文档类型名称'));
  await userEvent.type(within(editDrawer).getByLabelText('文档类型名称'), '验收材料');
  await userEvent.click(within(editDrawer).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(updateDocumentType).toHaveBeenCalledWith(expect.objectContaining({
    name: '验收材料',
  })));

  const updatedRow = within(await screen.findByRole('table', { name: '文档类型字典表' })).getByRole('row', { name: /验收材料/ });
  await userEvent.click(within(updatedRow).getByRole('button', { name: '更多 验收材料' }));
  await userEvent.click(within(updatedRow).getByRole('menuitem', { name: '删除 验收材料' }));
  await waitFor(() => expect(deleteDocumentType).toHaveBeenCalledTimes(1));
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('验收材料'));
  expect(within(screen.getByRole('table', { name: '文档类型字典表' })).queryByRole('row', { name: /验收材料/ })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: '上传资料' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['正式材料'], '验收报告.txt', { type: 'text/plain' }),
  );
  expect(screen.getByLabelText('文档类型')).toHaveTextContent('产品白皮书');
  expect(screen.getByLabelText('文档类型')).toHaveTextContent('解决方案');
  confirmSpy.mockRestore();
});

it('shows administrator knowledge areas as tabs', async () => {
  session('admin');
  server.use(
    http.get('/api/knowledge/bases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));

  const uploadTab = await screen.findByRole('tab', { name: '上传资料' });
  expect(screen.getByRole('tab', { name: '资料库' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: '审核与回收站' })).toBeInTheDocument();

  await userEvent.click(uploadTab);
  expect(screen.getByRole('heading', { name: '资料上传入口' })).toBeInTheDocument();
});

it('shows primary and secondary categories separately in the upload form', async () => {
  session('admin');
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({
      items: [{
        category_id: 'category-product',
        name: '产品资料',
        parent_category_id: '',
        parent_name: '',
        scope: 'company',
        sort_order: 10,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-07-11T08:00:00Z',
        updated_at: '2026-07-11T08:00:00Z',
      }, {
        category_id: 'category-cloud',
        name: '云管平台',
        parent_category_id: 'category-product',
        parent_name: '产品资料',
        scope: 'company',
        sort_order: 20,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-07-11T08:00:00Z',
        updated_at: '2026-07-11T08:00:00Z',
      }, {
        category_id: 'category-wdsp',
        name: 'WDSP',
        parent_category_id: 'category-product',
        parent_name: '产品资料',
        scope: 'company',
        sort_order: 30,
        status: 'ACTIVE',
        file_count: 0,
        created_at: '2026-07-11T08:00:00Z',
        updated_at: '2026-07-11T08:00:00Z',
      }],
      total: 3,
    })),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(screen.getByRole('tab', { name: '上传资料' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['产品资料'], '产品说明.txt', { type: 'text/plain' }),
  );

  expect(screen.getByLabelText('资料分类')).toHaveValue('产品资料');
  expect(screen.getByLabelText('二级分类')).toHaveTextContent('云管平台');
  expect(screen.getByLabelText('二级分类')).toHaveTextContent('WDSP');
  await userEvent.selectOptions(screen.getByLabelText('二级分类'), '云管平台');
  expect(screen.getByRole('status', { name: '资料归档位置' })).toHaveTextContent('产品资料 / 云管平台');
});

it('warns and asks for confirmation before uploading a duplicate file name', async () => {
  session('admin');
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        file_uuid: 'existing-manual',
        knowledge_base_id: 'kb-company',
        file_name: '管理员手册.docx',
        file_type: 'docx',
        file_size: 1024,
        visibility: 'company',
        status: 'READY',
        chunk_count: 10,
        created_at: '2026-07-12T08:00:00Z',
        source_type: 'admin_upload',
        usage_type: 'official_knowledge',
        review_status: 'official',
        rag_enabled: true,
        reference_enabled: true,
        rag_scope: 'company',
        permission_scope: 'company',
        category: '产品资料',
        document_type: '产品手册',
        tags: [],
        parse_status: 'parsed',
        index_status: 'indexed',
      }],
      total: 1,
    })),
  );
  render(<App />);

  await userEvent.click(await findMainNavButton('我的资料'));
  await userEvent.click(await screen.findByRole('tab', { name: '上传资料' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['manual'], '管理员手册.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  );

  expect(screen.getByText('检测到同名资料：管理员手册.docx。上传前需要再次确认。')).toBeInTheDocument();
  expect(screen.getByText('资料库已存在同名文件，上传时将再次确认')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '开始上传' }));
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('资料库已存在以下同名文件'));
  expect(screen.getByText('已取消上传，请修改文件名或移除同名文件后再试。')).toBeInTheDocument();
});

it('links user and prompt management to existing centers', () => {
  render(<AdminLinksPage urls={{
    adminCenter: 'http://localhost:5180/admin-center',
    promptCenter: 'http://localhost:18088',
  }} />);

  expect(screen.getByRole('link', { name: '打开统一用户管理' }))
    .toHaveAttribute('href', 'http://localhost:5180/admin-center');
  expect(screen.getByRole('link', { name: '打开内容模板管理中心' }))
    .toHaveAttribute('href', 'http://localhost:18088');
});

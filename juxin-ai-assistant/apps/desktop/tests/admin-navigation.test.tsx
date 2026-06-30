import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import App from '../src/App';
import { AdminLinksPage } from '../src/pages/admin/AdminLinksPage';
import { server } from './setup';

function session(role: string, managedDepartments: string[] = []) {
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
  );
}

it('shows AI governance pages to admin without user or server model forms', async () => {
  session('admin');
  render(<App />);

  expect(await screen.findByRole('button', { name: '部门数据' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交建议' })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: '治理中心' }));
  expect(screen.getByRole('button', { name: '任务管理' })).toBeInTheDocument();
  const governanceNav = screen.getByRole('navigation', { name: '治理导航' });
  expect(within(governanceNav).getByRole('button', { name: '知识库' })).toBeInTheDocument();
  expect(within(governanceNav).getByRole('button', { name: '系统设置' })).toBeInTheDocument();
  expect(screen.queryByText('服务端模型配置')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增用户' })).not.toBeInTheDocument();
});

it('hides admin-only entries from sysadmin users', async () => {
  session('sysadmin');
  render(<App />);

  expect(await screen.findByRole('button', { name: '工作台' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '助手模式' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '工作成果' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '我的资料' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '部门数据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交建议' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审计日志' })).not.toBeInTheDocument();
});

it('hides department data and suggestions from non-admin department managers', async () => {
  session('employee', ['销售部']);
  render(<App />);

  expect(await screen.findByRole('button', { name: '工作台' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '助手模式' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '工作成果' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '我的资料' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '部门数据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交建议' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
});

it('keeps governance and manager entries hidden from ordinary employees', async () => {
  session('employee');
  render(<App />);

  expect(await screen.findByText('上午好，employee用户')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '治理中心' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '部门数据' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交建议' })).not.toBeInTheDocument();
});

it('opens a role-scoped knowledge workspace for ordinary employees', async () => {
  session('employee');
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '我的资料' }));

  expect(screen.getByRole('heading', { name: '我的资料' })).toBeInTheDocument();
  expect(screen.getByText('我的资料')).toBeInTheDocument();
  expect(screen.getByText('当前附件')).toBeInTheDocument();
  expect(screen.getByText('提交审核记录')).toBeInTheDocument();
  expect(screen.getByText('公司知识库')).toBeInTheDocument();
  expect(screen.getByText('查资料')).toBeInTheDocument();
  expect(screen.getByText('上传资料')).toBeInTheDocument();
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
        notice: '正式知识来源。',
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
  await userEvent.type(await screen.findByLabelText('搜索知识库内容'), '部署方式');
  await userEvent.click(screen.getByRole('button', { name: '搜索知识库' }));

  await waitFor(() => expect(searchRequest).toHaveBeenCalledWith({
    question: '部署方式',
    mode: 'knowledge',
    top_k: 8,
    include_sources: true,
  }));
  const results = await screen.findByRole('region', { name: '知识库搜索结果' });
  expect(results).toHaveTextContent('正式知识来源');
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
  await userEvent.click(await screen.findByRole('radio', { name: '我的资料' }));
  await userEvent.type(screen.getByLabelText('搜索知识库内容'), '会议培训');
  await userEvent.click(screen.getByRole('button', { name: '搜索知识库' }));

  await waitFor(() => expect(personalSearchRequest).toHaveBeenCalledWith({
    question: '会议培训',
    top_k: 8,
  }));
  const results = await screen.findByRole('region', { name: '知识库搜索结果' });
  expect(results).toHaveTextContent('我的上传文件，仅用于本次内容生成');
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['个人模板内容'], '个人模板.txt', { type: 'text/plain' }),
  );
  await userEvent.click(screen.getByRole('radio', { name: '保存到我的资料' }));
  await userEvent.clear(screen.getByLabelText('分类'));
  await userEvent.type(screen.getByLabelText('分类'), '个人素材');
  await userEvent.clear(screen.getByLabelText('文档类型'));
  await userEvent.type(screen.getByLabelText('文档类型'), '个人模板');
  await userEvent.clear(screen.getByLabelText('标签'));
  await userEvent.type(screen.getByLabelText('标签'), '模板');
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
    document_type: '个人模板',
    tags: '模板',
  }));
  const personalCard = await screen.findByRole('listitem', { name: /个人模板\.txt/ });
  expect(personalCard).toHaveTextContent('我的上传文件，仅用于本次内容生成');
  expect(personalCard).toHaveTextContent('用户上传');
  expect(personalCard).not.toHaveTextContent('personal_reference');
  expect(await screen.findByText('资料已上传：个人模板.txt')).toBeInTheDocument();
  appendSpy.mockRestore();
});

it('explains parsing quality when selecting pdf and table files on the knowledge page', async () => {
  session('employee');
  server.use(
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
  );
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
  const uploadInput = await screen.findByLabelText('上传知识文件');

  await userEvent.upload(
    uploadInput,
    new File(['%PDF-1.4'], '扫描白皮书.pdf', { type: 'application/pdf' }),
  );

  expect(await screen.findByText('已选择：扫描白皮书.pdf')).toBeInTheDocument();
  expect(screen.getByText(/PDF 会尝试提取可复制文本/)).toBeInTheDocument();
  expect(screen.getByText(/扫描件或图片型 PDF 需要先 OCR/)).toBeInTheDocument();

  await userEvent.upload(
    uploadInput,
    new File(['a,b\n1,2'], '客户清单.csv', { type: 'text/csv' }),
  );

  expect(await screen.findByText('已选择：客户清单.csv')).toBeInTheDocument();
  expect(screen.getByText(/表格文件会按行解析/)).toBeInTheDocument();
  expect(screen.getByText(/尽量保留单元格关系/)).toBeInTheDocument();
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));

  expect(await screen.findByText('会议纪要模板.docx')).toBeInTheDocument();
  expect(listFiles).toHaveBeenCalledTimes(1);
  const fileCard = screen.getByRole('listitem', { name: /会议纪要模板\.docx/ });
  expect(fileCard).toHaveTextContent('我的上传文件，仅用于本次内容生成');
  expect(fileCard).toHaveTextContent('用户上传');
  expect(fileCard).not.toHaveTextContent('personal_reference');
  expect(fileCard).not.toHaveTextContent('user_upload');
  expect(fileCard).toHaveTextContent('会议纪要');
  expect(fileCard).toHaveTextContent('个人模板');
  expect(fileCard).toHaveTextContent('parsed');
  expect(fileCard).toHaveTextContent('indexed');
  expect(fileCard).toHaveTextContent('RAG：关闭');
  expect(fileCard).toHaveTextContent('参考：开启');
  expect(fileCard).toHaveTextContent('审核：draft');
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

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  await userEvent.click(within(mainNav).getByRole('button', { name: '知识库' }));
  await userEvent.upload(
    await screen.findByLabelText('上传知识文件'),
    new File(['正式产品白皮书'], '产品白皮书.txt', { type: 'text/plain' }),
  );
  expect(screen.getByRole('radio', { name: '加入公司知识库' })).toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: '保存到我的资料' })).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('所属知识库 ID'));
  await userEvent.type(screen.getByLabelText('所属知识库 ID'), 'kb-company');
  await userEvent.clear(screen.getByLabelText('分类'));
  await userEvent.type(screen.getByLabelText('分类'), '产品资料');
  await userEvent.clear(screen.getByLabelText('文档类型'));
  await userEvent.type(screen.getByLabelText('文档类型'), '产品白皮书');
  await userEvent.clear(screen.getByLabelText('标签'));
  await userEvent.type(screen.getByLabelText('标签'), '白皮书');
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
    tags: '白皮书',
  }));
  const uploadedCard = await screen.findByRole('listitem', { name: /产品白皮书\.txt/ });
  expect(uploadedCard).toHaveTextContent('公司知识库 / 正式知识来源');
  expect(uploadedCard).toHaveTextContent('管理员上传');
  expect(uploadedCard).not.toHaveTextContent('official_knowledge');
  expect(uploadedCard).toHaveTextContent('RAG：开启');
  expect(await screen.findByText('正式知识已上传：产品白皮书.txt')).toBeInTheDocument();
  appendSpy.mockRestore();
});

it('supports preview download and delete actions for visible knowledge files', async () => {
  const previewRequest = vi.fn();
  const deleteRequest = vi.fn();
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
    http.delete('/api/knowledge/files/file-personal-1', () => {
      deleteRequest();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
  const fileCard = await screen.findByRole('listitem', { name: /会议纪要模板\.docx/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '预览 会议纪要模板.docx' }));
  expect(previewRequest).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('region', { name: '文档预览' })).toHaveTextContent('会议决定下周完成验收材料整理。');
  expect(screen.getByRole('region', { name: '文档预览' })).toHaveTextContent('个人参考资料，仅你本人可见。');
  expect(screen.queryByText('/storage/knowledge/original')).not.toBeInTheDocument();

  await userEvent.click(within(fileCard).getByRole('button', { name: '下载 会议纪要模板.docx' }));
  expect(openDownload).toHaveBeenCalledWith('/api/knowledge/files/file-personal-1/download', '_blank', 'noopener,noreferrer');

  await userEvent.click(within(fileCard).getByRole('button', { name: '删除 会议纪要模板.docx' }));
  expect(deleteRequest).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('会议纪要模板.docx')).not.toBeInTheDocument();

  openDownload.mockRestore();
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
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
  expect(summary).toHaveTextContent('我的上传文件，仅用于本次内容生成');
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
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
  expect(result).toHaveTextContent('我的上传文件，仅用于本次内容生成');
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
        file_name: '文档问答结果.docx',
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
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
  const result = await screen.findByRole('region', { name: '文档问答结果' });
  expect(result).toHaveTextContent('文档回答：验收材料需要包含会议结论');
  expect(result).toHaveTextContent('我的上传文件，仅用于本次内容生成');
  expect(result).toHaveTextContent('验收材料');
  expect(result).not.toHaveTextContent('chunk-ask-secret');

  await userEvent.click(within(result).getByRole('button', { name: '导出 Word' }));

  await waitFor(() => expect(exportRequest).toHaveBeenCalledWith({
    title: '会议纪要模板.docx-文档问答结果',
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
  expect(await screen.findByText('Word 已开始下载。')).toBeInTheDocument();

  await userEvent.click(within(result).getByRole('button', { name: '保存到聊天记录' }));

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
  expect(await screen.findByText('已保存到聊天记录。')).toBeInTheDocument();
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

  await userEvent.click(await screen.findByRole('button', { name: '知识库' }));
  const fileCard = await screen.findByRole('listitem', { name: /会议纪要模板\.docx/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '提交审核 会议纪要模板.docx' }));

  expect(submitReview).toHaveBeenCalledWith({ comment: '用户从桌面端提交管理员审核' });
  expect(fileCard).toHaveTextContent('审核：pending');
  expect(fileCard).toHaveTextContent('已提交管理员审核');
  expect(within(fileCard).queryByRole('button', { name: '提交审核 会议纪要模板.docx' })).not.toBeInTheDocument();
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

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  await userEvent.click(within(mainNav).getByRole('button', { name: '知识库' }));
  const fileCard = await screen.findByRole('listitem', { name: /产品白皮书\.pdf/ });

  expect(fileCard).toHaveTextContent('RAG：关闭');
  await userEvent.click(within(fileCard).getByRole('button', { name: '启用 RAG 产品白皮书.pdf' }));
  expect(enableRag).toHaveBeenCalledTimes(1);
  expect(fileCard).toHaveTextContent('RAG：开启');
  expect(within(fileCard).queryByRole('button', { name: '启用 RAG 产品白皮书.pdf' })).not.toBeInTheDocument();

  await userEvent.click(within(fileCard).getByRole('button', { name: '禁用 RAG 产品白皮书.pdf' }));
  expect(disableRag).toHaveBeenCalledTimes(1);
  expect(fileCard).toHaveTextContent('RAG：关闭');
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

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  await userEvent.click(within(mainNav).getByRole('button', { name: '知识库' }));
  const fileCard = await screen.findByRole('listitem', { name: /交付手册\.docx/ });

  expect(fileCard).toHaveTextContent('Chunks：6');
  await userEvent.click(within(fileCard).getByRole('button', { name: '重新解析 交付手册.docx' }));
  expect(reparseFile).toHaveBeenCalledTimes(1);
  expect(fileCard).toHaveTextContent('Chunks：9');
});

it('lets administrators edit official knowledge category document type and tags', async () => {
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
        category: '售前资料',
        document_type: '服务方案',
        tags: ['方案', '售前'],
        parse_status: 'parsed',
        index_status: 'indexed',
      });
    }),
  );
  render(<App />);

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  await userEvent.click(within(mainNav).getByRole('button', { name: '知识库' }));
  const fileCard = await screen.findByRole('listitem', { name: /产品白皮书\.pdf/ });

  await userEvent.click(within(fileCard).getByRole('button', { name: '编辑分类标签 产品白皮书.pdf' }));
  await userEvent.clear(within(fileCard).getByLabelText('分类'));
  await userEvent.type(within(fileCard).getByLabelText('分类'), '售前资料');
  await userEvent.clear(within(fileCard).getByLabelText('文档类型'));
  await userEvent.type(within(fileCard).getByLabelText('文档类型'), '服务方案');
  await userEvent.clear(within(fileCard).getByLabelText('标签'));
  await userEvent.type(within(fileCard).getByLabelText('标签'), '方案, 售前');
  await userEvent.click(within(fileCard).getByRole('button', { name: '保存元数据 产品白皮书.pdf' }));

  expect(updateMetadata).toHaveBeenCalledWith({
    category: '售前资料',
    document_type: '服务方案',
    tags: ['方案', '售前'],
  });
  expect(fileCard).toHaveTextContent('售前资料 · 服务方案 · pdf');
  expect(fileCard).toHaveTextContent('标签：方案、售前');
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
            category: '售前资料',
            document_type: '服务方案',
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
        category: '售前资料',
        document_type: '服务方案',
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

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  await userEvent.click(within(mainNav).getByRole('button', { name: '知识库' }));
  const activeCard = await screen.findByRole('listitem', { name: /产品白皮书\.pdf/ });

  await userEvent.click(within(activeCard).getByRole('button', { name: '归档 产品白皮书.pdf' }));
  expect(archiveFile).toHaveBeenCalledTimes(1);
  expect(activeCard).toHaveTextContent('状态：ARCHIVED');
  expect(activeCard).toHaveTextContent('RAG：关闭');

  await userEvent.click(screen.getByRole('button', { name: '查看回收站' }));
  expect(listTrash).toHaveBeenCalledTimes(1);
  const restoreCard = await screen.findByRole('listitem', { name: /已删除资料\.docx/ });
  const hardDeleteCard = await screen.findByRole('listitem', { name: /待彻底删除\.pdf/ });
  expect(restoreCard).toHaveTextContent('状态：DELETED');

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
          category: '售前资料',
          document_type: '服务方案',
          tags: ['方案', '售前'],
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
        category: '售前资料',
        document_type: '服务方案',
        tags: ['方案', '售前'],
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

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  await userEvent.click(within(mainNav).getByRole('button', { name: '知识库' }));
  const approveCard = await screen.findByRole('listitem', { name: /待审核方案\.docx/ });
  const rejectCard = await screen.findByRole('listitem', { name: /待审核记录\.docx/ });

  await userEvent.click(within(approveCard).getByRole('button', { name: '审核通过 待审核方案.docx' }));
  expect(approveReview).toHaveBeenCalledWith({
    knowledge_base_id: 'kb-company',
    comment: '管理员从桌面端审核通过',
    permission_scope: 'company',
    rag_scope: 'company',
    category: '售前资料',
    document_type: '服务方案',
    tags: ['方案', '售前'],
  });
  expect(approveCard).toHaveTextContent('公司知识库 / 正式知识来源');
  expect(approveCard).not.toHaveTextContent('official_knowledge');
  expect(approveCard).toHaveTextContent('审核：official');
  expect(approveCard).toHaveTextContent('RAG：开启');
  expect(within(approveCard).queryByRole('button', { name: '审核通过 待审核方案.docx' })).not.toBeInTheDocument();

  await userEvent.click(within(rejectCard).getByRole('button', { name: '审核驳回 待审核记录.docx' }));
  expect(rejectReview).toHaveBeenCalledWith({ comment: '管理员从桌面端审核驳回' });
  expect(rejectCard).toHaveTextContent('审核：rejected');
  expect(rejectCard).toHaveTextContent('RAG：关闭');
  expect(within(rejectCard).queryByRole('button', { name: '审核驳回 待审核记录.docx' })).not.toBeInTheDocument();
});

it('opens the administrator knowledge workspace from the sidebar', async () => {
  session('admin');
  render(<App />);

  const mainNav = await screen.findByRole('navigation', { name: '主导航' });
  await userEvent.click(within(mainNav).getByRole('button', { name: '知识库' }));

  expect(screen.getByRole('heading', { name: '知识库' })).toBeInTheDocument();
  expect(screen.getByText('知识库审核')).toBeInTheDocument();
  expect(screen.getByText('公司知识库')).toBeInTheDocument();
  expect(screen.getByText('部门知识库')).toBeInTheDocument();
  expect(screen.getByText('项目知识库')).toBeInTheDocument();
  expect(screen.getByText('待审核文档')).toBeInTheDocument();
  expect(screen.getByText('分类和标签管理')).toBeInTheDocument();
});

it('links user and prompt management to existing centers', () => {
  render(<AdminLinksPage urls={{
    adminCenter: 'http://localhost:5180/admin-center',
    promptCenter: 'http://localhost:18088',
  }} />);

  expect(screen.getByRole('link', { name: '打开统一用户管理' }))
    .toHaveAttribute('href', 'http://localhost:5180/admin-center');
  expect(screen.getByRole('link', { name: '打开提示词管理中心' }))
    .toHaveAttribute('href', 'http://localhost:18088');
});

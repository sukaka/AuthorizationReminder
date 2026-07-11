import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { KnowledgePage } from '../src/pages/KnowledgePage';
import { server } from './setup';

const adminSession = {
  user: { id: 'admin-1', username: '管理员', role: 'admin' },
  scope: { department: '管理部', managedDepartments: ['管理部'] },
  apps: ['ai-assistant'],
  local_binding_token: 'binding-token',
};

const baseFile = {
  file_type: 'application/pdf',
  file_size: 1024,
  visibility: 'private',
  created_at: '2026-07-05T01:00:00Z',
  source_type: 'admin_upload',
  usage_type: 'official_knowledge',
  review_status: 'official',
  reference_enabled: true,
  rag_scope: 'company',
  permission_scope: 'company',
  category: '产品资料',
  document_type: '产品白皮书',
  tags: [],
};

it('applies AI classification from the file actions menu', async () => {
  const classifyRequest = vi.fn();
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/reviews/pending', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/reviews/history', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        ...baseFile,
        file_uuid: 'file-classify',
        file_name: '零信任交付方案.pdf',
        category: '其他',
        document_type: '其他',
        status: 'READY',
        parse_status: 'parsed',
        index_status: 'indexed',
        chunk_count: 6,
        rag_enabled: true,
      }],
      total: 1,
    })),
    http.post('/api/knowledge/files/file-classify/classify', async ({ request }) => {
      classifyRequest(await request.json());
      return HttpResponse.json({
        file_uuid: 'file-classify',
        category: '项目交付',
        document_type: '解决方案',
        tags: ['零信任', '交付'],
        applied: true,
      });
    }),
  );

  render(<KnowledgePage session={adminSession} />);

  const card = await screen.findByRole('listitem', { name: '零信任交付方案.pdf' });
  await userEvent.click(within(card).getByRole('button', { name: '更多操作 零信任交付方案.pdf' }));
  await userEvent.click(within(card).getByRole('menuitem', { name: '自动分类 零信任交付方案.pdf' }));

  await waitFor(() => expect(classifyRequest).toHaveBeenCalledWith({ apply: true }));
  expect(await within(card).findByText('项目交付 · 解决方案 · 正式资料')).toBeInTheDocument();
  expect(screen.getByText('已自动分类“零信任交付方案.pdf”：项目交付 · 解决方案')).toBeInTheDocument();
});

it('opens file preview in a paginated document window', async () => {
  const previewRequest = vi.fn();
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/reviews/pending', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/reviews/history', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [{
        ...baseFile,
        file_uuid: 'file-long-preview',
        file_name: '长文档.docx',
        file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        status: 'READY',
        parse_status: 'parsed',
        index_status: 'indexed',
        chunk_count: 1015,
        rag_enabled: true,
      }],
      total: 1,
    })),
    http.get('/api/knowledge/files/file-long-preview/preview', ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('page_size') || '20');
      previewRequest({
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('page_size'),
      });
      const start = (page - 1) * pageSize;
      return HttpResponse.json({
        file_uuid: 'file-long-preview',
        file_name: '长文档.docx',
        source_kind: 'official_knowledge',
        chunks: Array.from({ length: pageSize }, (_, index) => ({
          chunk_id: `chunk-${start + index}`,
          chunk_index: start + index,
          page_number: null,
          section_title: `段落 ${start + index + 1}`,
          page_or_sheet: '',
          chunk_type: 'text',
          text: `第 ${start + index + 1} 段内容`,
        })),
        total_chunks: 1015,
        page,
        page_size: pageSize,
        total_pages: Math.ceil(1015 / pageSize),
        notice: '本次内容仅依据所选正式知识库文档生成；来源需显示文件名、章节或页码。',
      });
    }),
  );

  render(<KnowledgePage session={adminSession} />);

  await userEvent.click(await screen.findByRole('button', { name: '预览 长文档.docx' }));
  const dialog = await screen.findByRole('dialog', { name: '资料内容' });
  expect(within(dialog).getByText('长文档.docx')).toBeInTheDocument();
  expect(within(dialog).getByText('当前第 1 / 51 页 · 共 1015 个段落')).toBeInTheDocument();
  expect(within(dialog).getByText('第 1 段内容')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: '下一页' }));

  await waitFor(() => expect(previewRequest).toHaveBeenLastCalledWith({
    page: '2',
    pageSize: '20',
  }));
  expect(await within(dialog).findByText('当前第 2 / 51 页 · 共 1015 个段落')).toBeInTheDocument();
  expect(within(dialog).getByText('第 21 段内容')).toBeInTheDocument();
});

it('shows a knowledge governance board and filters risky files without duplicate review labels', async () => {
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({
      items: [{
        category_id: 'cat-1',
        name: '产品资料',
        parent_category_id: '',
        parent_name: '',
        scope: 'company',
        sort_order: 10,
        status: 'ACTIVE',
        file_count: 4,
        created_at: '2026-07-05T01:00:00Z',
        updated_at: '2026-07-05T01:00:00Z',
      }],
      total: 1,
    })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({
      items: [{
        document_type_id: 'doc-1',
        name: '产品白皮书',
        sort_order: 10,
        status: 'ACTIVE',
        file_count: 4,
        created_at: '2026-07-05T01:00:00Z',
        updated_at: '2026-07-05T01:00:00Z',
      }],
      total: 1,
    })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({
      items: [{
        base_id: 'base-1',
        name: '公司资料库',
        description: '',
        scope: 'company',
        owner_user_id: '',
        department_id: '',
        project_id: '',
        created_by: 'admin-1',
        created_at: '2026-07-05T01:00:00Z',
        updated_at: '2026-07-05T01:00:00Z',
      }],
      total: 1,
    })),
    http.get('/api/knowledge/files', () => HttpResponse.json({
      items: [
        { ...baseFile, file_uuid: 'file-ready', file_name: '产品白皮书.pdf', status: 'READY', parse_status: 'ready', index_status: 'ready', chunk_count: 8, rag_enabled: true },
        { ...baseFile, file_uuid: 'file-failed', file_name: '解析失败.pdf', status: 'FAILED', parse_status: 'failed', index_status: 'failed', chunk_count: 0, rag_enabled: false },
        { ...baseFile, file_uuid: 'file-pending', file_name: '待审核方案.pdf', status: 'READY', review_status: 'pending', parse_status: 'ready', index_status: 'ready', chunk_count: 3, rag_enabled: false },
        { ...baseFile, file_uuid: 'file-rag-off', file_name: '未启用检索.pdf', status: 'READY', parse_status: 'ready', index_status: 'ready', chunk_count: 5, rag_enabled: false },
      ],
      total: 4,
    })),
    http.get('/api/knowledge/reviews/pending', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/reviews/history', () => HttpResponse.json({
      items: [{
        file_uuid: 'file-pending',
        file_name: '待审核方案.pdf',
        user_id: 'u-1',
        reviewer_id: 'admin-1',
        action: 'APPROVE',
        old_status: 'pending',
        new_status: 'official',
        comment: '资料有效',
        created_at: '2026-07-05T01:10:00Z',
      }],
      total: 1,
    })),
  );

  render(<KnowledgePage session={adminSession} />);

  expect(await screen.findByText('资料治理看板')).toBeInTheDocument();
  expect(screen.getByText('解析失败')).toBeInTheDocument();
  expect(screen.getByText('未入检索')).toBeInTheDocument();
  expect(screen.getAllByText('待审核').length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: '只看解析失败 1' }));
  expect(screen.getByText('解析失败.pdf')).toBeInTheDocument();
  expect(screen.queryByText('产品白皮书.pdf')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '只看待审核 1' }));
  await userEvent.click(screen.getByRole('button', { name: /审核通过 待审核方案\.pdf/ }));
  const permissionLabels = screen.getAllByText('权限范围');
  expect(permissionLabels).toHaveLength(1);

  await userEvent.click(screen.getByRole('tab', { name: '审核与回收站' }));
  expect(await screen.findByText('审核历史')).toBeInTheDocument();
  expect(screen.getAllByText('待审核方案.pdf').length).toBeGreaterThan(0);
  expect(screen.getByText('APPROVE · pending → official')).toBeInTheDocument();
});

it('generates an editable draft from personal reference search results', async () => {
  const generateRequest = vi.fn();
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/personal-reference/search', () => HttpResponse.json({
      total: 1,
      notice: '找到 1 条我的资料。',
      sources: [{
        source_kind: 'personal_reference',
        file_id: 'file-personal',
        file_name: '客户会议记录.md',
        chunk_id: 'chunk-1',
        page_number: null,
        section_title: '需求',
        chunk_index: 0,
        score: 80,
        snippet: '客户需要下周提交实施计划。',
      }],
    })),
    http.post('/api/personal-reference/generate', async ({ request }) => {
      generateRequest(await request.json());
      return HttpResponse.json({
        answer: '',
        messages: [{ role: 'user', content: '根据我的会议记录生成实施计划' }],
        notice: '已根据我的资料准备生成上下文。',
        sources: [{
          source_kind: 'personal_reference',
          file_id: 'file-personal',
          file_name: '客户会议记录.md',
          chunk_id: 'chunk-1',
          page_number: null,
          section_title: '需求',
          chunk_index: 0,
          score: 80,
          snippet: '客户需要下周提交实施计划。',
        }],
      }, { status: 201 });
    }),
  );

  render(<KnowledgePage session={{ ...adminSession, user: { ...adminSession.user, role: 'employee' } }} />);

  await userEvent.click(await screen.findByRole('radio', { name: '我的资料' }));
  await userEvent.type(screen.getByRole('textbox', { name: '关键词或问题' }), '根据我的会议记录生成实施计划');
  await userEvent.click(screen.getByRole('button', { name: '查找资料' }));
  await userEvent.click(await screen.findByRole('button', { name: '用我的资料生成 客户会议记录.md' }));

  expect(generateRequest).toHaveBeenCalledWith({
    question: '根据我的会议记录生成实施计划',
    mode: 'normal',
    top_k: 8,
    file_ids: ['file-personal'],
  });
  expect(await screen.findByText('我的资料生成草稿')).toBeInTheDocument();
  expect(screen.getAllByText('已根据我的资料准备生成上下文。').length).toBeGreaterThan(0);
});

it('answers from official knowledge after search without exposing raw knowledge bodies', async () => {
  const askRequest = vi.fn();
  server.use(
    http.get('/api/knowledge/categories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/bases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/files', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/search', () => HttpResponse.json({
      total: 1,
      sources: [{
        source_kind: 'official_knowledge',
        file_id: 'file-official',
        file_name: '实施规范.docx',
        chunk_id: 'chunk-1',
        page_number: 2,
        section_title: '验收',
        chunk_index: 0,
        score: 82,
        snippet: '验收材料需要包含部署记录。',
      }],
    })),
    http.post('/api/knowledge/ask', async ({ request }) => {
      askRequest(await request.json());
      return HttpResponse.json({
        answer: '验收材料应包含部署记录、配置清单和双方确认记录。',
        messages: [],
        notice: '已基于正式知识库回答。',
        sources: [{
          source_kind: 'official_knowledge',
          file_id: 'file-official',
          file_name: '实施规范.docx',
          chunk_id: 'chunk-1',
          page_number: 2,
          section_title: '验收',
          chunk_index: 0,
          score: 82,
          snippet: '验收材料需要包含部署记录。',
        }],
      });
    }),
  );

  render(<KnowledgePage session={adminSession} />);

  await userEvent.type(await screen.findByRole('textbox', { name: '关键词或问题' }), '验收材料需要什么');
  await userEvent.click(screen.getByRole('button', { name: '查找资料' }));
  await userEvent.click(await screen.findByRole('button', { name: '用正式资料回答' }));

  expect(askRequest).toHaveBeenCalledWith({
    question: '验收材料需要什么',
    mode: 'knowledge',
    top_k: 8,
    include_sources: true,
  });
  expect(await screen.findByText('正式资料回答')).toBeInTheDocument();
  expect(screen.getByText('验收材料应包含部署记录、配置清单和双方确认记录。')).toBeInTheDocument();
  expect(screen.queryByText(/raw knowledge body|private-output/i)).not.toBeInTheDocument();
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import App from '../src/App';
import { SkillsPage } from '../src/pages/SkillsPage';
import { SkillsAdminPage } from '../src/pages/admin/SkillsAdminPage';
import { server } from './setup';

const skill = {
  id: 'risk-assessment-review',
  name: '风险评估过程文档审查',
  description: '对用户上传的风险评估过程文档进行不符合项审查。',
  category: 'risk_assessment',
  version: '1.0.0',
  status: 'published',
  scope: 'company',
  owner: 'security-team',
  requires_attachment: true,
  allowed_tools: ['file_parser', 'knowledge_retrieval', 'document_generator', 'personal_memory'],
  input_types: ['docx', 'pdf', 'xlsx'],
  output_types: ['markdown', 'docx'],
  permissions: {
    allow_web: false,
    allow_company_knowledge: true,
    allow_personal_memory: true,
    allow_write_company_kb: false,
  },
  review: {
    required_for_publish: true,
    reviewer_role: 'admin',
  },
  tags: ['风险评估', 'CCRC', '文档审查'],
};

it('shows published skills as a user-facing capability center and runs a skill', async () => {
  const uploadRequest = vi.fn();
  const runRequest = vi.fn();
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
    http.get('/api/skills', () => HttpResponse.json({ items: [skill], total: 1 })),
    http.get('/api/skills/mine', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/skills/runs', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/knowledge/files/upload', () => {
      uploadRequest();
      return HttpResponse.json({
        file_uuid: 'skill-input-file-1',
        file_name: '风险评估.docx',
        file_type: 'docx',
        file_size: 12,
        visibility: 'PRIVATE',
        status: 'READY',
        chunk_count: 1,
        created_at: '2026-07-26T00:00:00',
        usage_type: 'skill_input',
      }, { status: 201 });
    }),
    http.post('/api/skills/risk-assessment-review/run', async ({ request }) => {
      runRequest(await request.json());
      return HttpResponse.json({
        run_id: 'run-1',
        skill_id: 'risk-assessment-review',
        skill_version: '1.0.0',
        status: 'completed',
        tools_used: ['personal_memory'],
        result: { summary: '已完成风险评估过程文档审查：输出不符合项、证据缺口、修改建议。' },
        artifacts: [{
          artifact_id: 'run-1-1',
          artifact_type: 'markdown',
          kind: 'markdown',
          title: '风险评估过程文档审查',
          status: 'ready',
          version: 1,
          format: 'markdown',
          mime_type: 'text/markdown',
          download_ref: '',
          downloadable: false,
          editable: true,
          content: '不符合项',
        }],
      });
    }),
  );

  render(<SkillsPage />);

  expect(await screen.findByRole('heading', { name: '能力中心' })).toBeInTheDocument();
  expect(screen.getByText('风险评估过程文档审查')).toBeInTheDocument();
  expect(screen.getByText('需要材料：docx、pdf、xlsx')).toBeInTheDocument();
  expect(screen.getByText('输出格式')).toBeInTheDocument();
  expect(screen.getByText('markdown、docx')).toBeInTheDocument();
  expect(screen.queryByText(/ToolRegistry|embedding|namespace|RAG/)).not.toBeInTheDocument();

  await userEvent.upload(
    screen.getByLabelText('上传风险评估过程文档审查材料'),
    new File(['test content'], '风险评估.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: '开始使用 风险评估过程文档审查' }));
  await waitFor(() => expect(uploadRequest).toHaveBeenCalled());
  expect(Object.fromEntries(appendedFields)).toMatchObject({
    file_name: '风险评估.docx',
    usage_type: 'skill_input',
    rag_scope: 'none',
    reference_enabled: 'false',
  });
  await waitFor(() => expect(runRequest).toHaveBeenCalledWith({
    task_id: 'skill-risk-assessment-review',
    input: {
      question: '请执行风险评估过程文档审查',
      attachments: [{
        file_uuid: 'skill-input-file-1',
        name: '风险评估.docx',
        file_type: 'docx',
        file_size: 12,
      }],
    },
  }));
  expect(await screen.findByText(/已完成风险评估过程文档审查/)).toBeInTheDocument();
  expect(screen.getByText('MARKDOWN · 可编辑')).toBeInTheDocument();
  appendSpy.mockRestore();
});

it('requires users to choose a real attachment before running an attachment skill', async () => {
  const runRequest = vi.fn();
  server.use(
    http.get('/api/skills', () => HttpResponse.json({ items: [skill], total: 1 })),
    http.get('/api/skills/mine', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/skills/runs', () => HttpResponse.json({ items: [], total: 0 })),
    http.post('/api/skills/risk-assessment-review/run', () => {
      runRequest();
      return HttpResponse.json({});
    }),
  );

  render(<SkillsPage />);

  await screen.findByRole('heading', { name: '能力中心' });
  await userEvent.click(screen.getByRole('button', { name: '开始使用 风险评估过程文档审查' }));

  expect(await screen.findByRole('status')).toHaveTextContent(
    '请先为“风险评估过程文档审查”选择处理材料。',
  );
  expect(runRequest).not.toHaveBeenCalled();
});

it('shows admin skill governance with ids, versions, tools and review actions', async () => {
  const publish = vi.fn();
  const review = vi.fn();
  server.use(
    http.get('/api/admin/skills', () => HttpResponse.json({
      items: [{ ...skill, status: 'draft' }],
      total: 1,
    })),
    http.post('/api/admin/skills/risk-assessment-review/review', async ({ request }) => {
      review(await request.json());
      return HttpResponse.json({
        skill_id: 'risk-assessment-review',
        version: '1.0.0',
        submitter_id: 'security-team',
        reviewer_id: 'admin',
        status: 'approved',
        comment: '通过',
        reviewed_at: '2026-07-05T00:00:00',
      });
    }),
    http.post('/api/admin/skills/risk-assessment-review/publish', () => {
      publish();
      return HttpResponse.json({ ...skill, status: 'published' });
    }),
  );

  render(<SkillsAdminPage />);

  expect(await screen.findByRole('heading', { name: '能力治理' })).toBeInTheDocument();
  const card = screen.getByRole('article', { name: 'risk-assessment-review' });
  expect(within(card).getByText('1.0.0 · draft')).toBeInTheDocument();
  expect(within(card).getByText('file_parser、knowledge_retrieval、document_generator、personal_memory')).toBeInTheDocument();
  expect(within(card).getByText('联网：关闭 · 公司知识：开启 · 写公司知识库：关闭')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '审核通过 risk-assessment-review' }));
  await waitFor(() => expect(review).toHaveBeenCalledWith({ status: 'approved', comment: '通过' }));
  await userEvent.click(screen.getByRole('button', { name: '发布 risk-assessment-review' }));
  await waitFor(() => expect(publish).toHaveBeenCalled());
});

it('adds the capability center to the main navigation for administrators', async () => {
  server.use(
    http.get('/api/ai/session', () => HttpResponse.json({
      user: { id: 'u-admin', username: '管理员用户', role: 'admin' },
      scope: { department: '交付部', managedDepartments: [] },
      apps: ['ai-assistant'],
      local_binding_token: 'signed-binding-token',
    })),
    http.get('/api/ai/home', () => HttpResponse.json({
      favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [],
    })),
    http.get('/api/skills', () => HttpResponse.json({ items: [skill], total: 1 })),
    http.get('/api/skills/mine', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/skills/runs', () => HttpResponse.json({ items: [], total: 0 })),
  );

  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: 'AI 能力' }));
  await userEvent.click(await screen.findByRole('button', { name: '能力中心' }));
  expect(await screen.findByRole('heading', { name: '能力中心' })).toBeInTheDocument();
});

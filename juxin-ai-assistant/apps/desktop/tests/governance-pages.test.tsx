import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { KnowledgeAdminPage } from '../src/pages/admin/KnowledgeAdminPage';
import { SettingsPage } from '../src/pages/admin/SettingsPage';
import { StatsPage } from '../src/pages/admin/StatsPage';
import { SuggestionsPage } from '../src/pages/admin/SuggestionsPage';
import { TaskAdminPage } from '../src/pages/admin/TaskAdminPage';
import { server } from './setup';

it('clears controlled knowledge plaintext after encrypted save', async () => {
  server.use(
    http.post('/api/ai/admin/knowledge', () => HttpResponse.json({
      uuid: 'k-1', title: '公司介绍', category: 'COMPANY', status: 'ACTIVE', tags: [], priority: 0,
    }, { status: 201 })),
    http.get('/api/ai/admin/knowledge', () => HttpResponse.json({ items: [], total: 0 })),
  );
  render(<KnowledgeAdminPage />);
  await userEvent.type(screen.getByRole('textbox', { name: '标题' }), '公司介绍');
  await userEvent.type(screen.getByRole('textbox', { name: '正文' }), '仅用于加密写入的正文');
  await userEvent.click(screen.getByRole('button', { name: '加密保存' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '正文' })).toHaveValue(''));
});

it('renders settings from a fixed whitelist without arbitrary secret fields', () => {
  render(<SettingsPage />);
  expect(screen.getByRole('textbox', { name: '全局安全提示' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/api key|token|secret|password/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /新增设置/ })).not.toBeInTheDocument();
});

it('limits manager suggestion department selector to managed departments', () => {
  render(<SuggestionsPage departments={['销售部', '交付部']} />);
  const selector = screen.getByRole('combobox', { name: '负责部门' });
  expect(selector).toHaveTextContent('销售部');
  expect(selector).toHaveTextContent('交付部');
  expect(selector).not.toHaveTextContent('商务投标部');
});

it('loads department stats from the metadata-only endpoint', async () => {
  const requestSpy = vi.fn();
  server.use(http.get('/api/ai/department-stats', ({ request }) => {
    requestSpy(request.url);
    return HttpResponse.json({ total: 12, completion_rate: 0.75, failure_rate: 0.25 });
  }));
  render(<StatsPage manager />);
  await userEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  expect(await screen.findByText('12')).toBeInTheDocument();
  expect(requestSpy).toHaveBeenCalledWith(expect.not.stringMatching(/input|output|content/i));
});

it('saves task, fields, and published Prompt binding in one atomic request', async () => {
  const configurationSpy = vi.fn();
  const legacyRequestSpy = vi.fn();
  const task = {
    uuid: 'task-1', assistant_uuid: 'assistant-1', code: 'sales-summary', name: '销售总结',
    status: 'ACTIVE', fields: [],
    prompt_binding: { prompt_external_id: 88, version_policy: 'PINNED', pinned_version: 3, status: 'ACTIVE' },
  };
  server.use(
    http.get('/api/ai/admin/tasks', () => HttpResponse.json({ items: [task], total: 1 })),
    http.get('/api/ai/capabilities', () => HttpResponse.json({ items: [] })),
    http.put('/api/ai/admin/tasks/task-1/configuration', async ({ request }) => {
      configurationSpy(await request.json());
      return HttpResponse.json(task);
    }),
    http.put('/api/ai/admin/tasks/task-1', () => {
      legacyRequestSpy();
      return HttpResponse.json(task);
    }),
    http.put('/api/ai/admin/tasks/task-1/fields', () => {
      legacyRequestSpy();
      return HttpResponse.json(task);
    }),
    http.put('/api/ai/admin/tasks/task-1/prompt-binding', () => {
      legacyRequestSpy();
      return HttpResponse.json(task);
    }),
  );
  render(<TaskAdminPage />);
  await userEvent.click(screen.getByRole('button', { name: '刷新任务' }));
  await userEvent.click(await screen.findByRole('button', { name: /销售总结/ }));
  await userEvent.click(screen.getByRole('button', { name: '保存并验证' }));
  await waitFor(() => expect(configurationSpy).toHaveBeenCalledWith({
    task: { status: 'ACTIVE' },
    fields: [],
    prompt_binding: {
      prompt_external_id: 88,
      version_policy: 'PINNED',
      pinned_version: 3,
      status: 'ACTIVE',
    },
  }));
  expect(legacyRequestSpy).not.toHaveBeenCalled();
});

it('shows task capability health without exposing prompt or knowledge bodies', async () => {
  server.use(
    http.get('/api/ai/admin/tasks', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/capabilities', () => HttpResponse.json({
      items: [{
        task_uuid: 'task-1',
        task_code: 'work-summary',
        task_name: '工作总结',
        assistant_name: '内部同事',
        task_status: 'ACTIVE',
        input_fields: [{ field_key: 'content', label: '工作内容', field_type: 'TEXTAREA', required: true }],
        output_format: '正式文档',
        document_type: 'FORMAL_DOCUMENT',
        prompt_binding_status: 'configured',
        knowledge_link_count: 2,
      }],
    })),
  );

  render(<TaskAdminPage />);
  await userEvent.click(screen.getByRole('button', { name: '刷新任务' }));

  expect(await screen.findByText('能力健康')).toBeInTheDocument();
  expect(screen.getByText('工作总结')).toBeInTheDocument();
  expect(screen.getByText('内容模板已配置')).toBeInTheDocument();
  expect(screen.getByText('字段 1 个 · 知识 2 条 · ACTIVE')).toBeInTheDocument();
  expect(screen.queryByText(/prompt body|knowledge body/i)).not.toBeInTheDocument();
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { LearningPage } from '../src/pages/LearningPage';
import { server } from './setup';

it('shows persisted answer feedback in the learning center', async () => {
  server.use(
    http.get('/api/learning/memories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/experiences', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/failure-cases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/feedback', () => HttpResponse.json({
      items: [{
        uuid: 'fb-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        feedback_type: 'save_experience',
        comment: '这个回答后续复用',
        saved_as: 'experience',
        created_at: '2026-07-05T08:00:00Z',
      }],
      total: 1,
    })),
  );

  render(<LearningPage />);

  await userEvent.click(await screen.findByRole('button', { name: '改进记录' }));

  expect(screen.getByText('这个回答后续复用')).toBeInTheDocument();
  expect(screen.getByText('保存为经验')).toBeInTheDocument();
  expect(screen.getByText('已沉淀为经验')).toBeInTheDocument();
  expect(screen.getByText(/conv-1/)).toBeInTheDocument();
});

it('lets users edit saved long-term memories', async () => {
  const updateMemory = vi.fn();
  let memory = {
    uuid: 'mem-1',
    memory_type: 'correction',
    title: '旧标题',
    content: '旧内容',
    source: 'assistant',
    priority: 'high',
    tags: ['导出'],
    status: 'active',
    created_at: '2026-07-05T08:00:00Z',
    updated_at: '2026-07-05T08:00:00Z',
  };
  server.use(
    http.get('/api/learning/memories', () => HttpResponse.json({
      items: [memory],
      total: 1,
    })),
    http.get('/api/learning/experiences', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/failure-cases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/feedback', () => HttpResponse.json({ items: [], total: 0 })),
    http.patch('/api/learning/memories/mem-1', async ({ request }) => {
      updateMemory(await request.json());
      memory = {
        ...memory,
        title: '新的标题',
        content: '新的记忆内容',
        updated_at: '2026-07-05T08:01:00Z',
      };
      return HttpResponse.json(memory);
    }),
  );

  render(<LearningPage />);

  await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
  const titleDialog = await screen.findByRole('dialog', { name: '记忆标题' });
  const titleField = within(titleDialog).getByRole('textbox', { name: '记忆标题' });
  await userEvent.clear(titleField);
  await userEvent.type(titleField, '新的标题');
  await userEvent.click(within(titleDialog).getByRole('button', { name: '保存' }));

  const contentDialog = await screen.findByRole('dialog', { name: '记忆内容' });
  const contentField = within(contentDialog).getByRole('textbox', { name: '记忆内容' });
  await userEvent.clear(contentField);
  await userEvent.type(contentField, '新的记忆内容');
  await userEvent.click(within(contentDialog).getByRole('button', { name: '保存' }));

  expect(updateMemory).toHaveBeenCalledWith({ title: '新的标题', content: '新的记忆内容' });
  expect(await screen.findByText('新的标题')).toBeInTheDocument();
  expect(screen.getByText('新的记忆内容')).toBeInTheDocument();
});

it('lets admins approve submitted company templates', async () => {
  const approveTemplate = vi.fn();
  let pendingTemplates = [{
    uuid: 'tpl-1',
    template_name: '投标响应模板',
    task_type: '商务投标',
    template_content: '一、评分点\n二、响应说明',
    variables: {},
    scope: 'company',
    review_status: 'pending',
    status: 'active',
    created_at: '2026-07-05T08:00:00Z',
    updated_at: '2026-07-05T08:00:00Z',
  }];
  server.use(
    http.get('/api/learning/memories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/experiences', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/failure-cases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/feedback', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates/review', () => HttpResponse.json({
      items: pendingTemplates,
      total: pendingTemplates.length,
    })),
    http.post('/api/learning/templates/tpl-1/approve', () => {
      approveTemplate();
      const approved = { ...pendingTemplates[0], review_status: 'official' };
      pendingTemplates = [];
      return HttpResponse.json(approved);
    }),
  );

  render(<LearningPage isAdmin />);

  await userEvent.click(await screen.findByRole('button', { name: '模板审核' }));
  expect(await screen.findByText('投标响应模板')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '通过' }));

  expect(approveTemplate).toHaveBeenCalled();
  expect(await screen.findByText('暂无待审核公司模板。')).toBeInTheDocument();
});

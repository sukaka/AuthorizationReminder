import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { FeedbackPanel } from '../src/components/FeedbackPanel';
import { HistoryPage } from '../src/pages/HistoryPage';
import { HomePage } from '../src/pages/HomePage';
import { server } from './setup';

const historyItem = {
  uuid: 'gen-1',
  task_uuid: 'task-1',
  task_name: '工作总结',
  assistant_code: 'general',
  assistant_name: '通用助手',
  status: 'COMPLETED',
  model_display_name: '公司模型',
  model_id: 'model-1',
  prompt_version: 3,
  latency_ms: 120,
  usage: {},
  created_at: '2026-06-20T08:00:00Z',
  finished_at: '2026-06-20T08:00:01Z',
};

it('renders user-scoped home metadata and removes a favorite optimistically', async () => {
  const removeFavorite = vi.fn();
  server.use(
    http.get('/api/ai/home', () => HttpResponse.json({
      favorites: [{
        task_uuid: 'task-1',
        task_code: 'work-summary',
        task_name: '工作总结',
        description: '整理进展',
        assistant_code: 'general',
        assistant_name: '通用助手',
      }],
      recent_tasks: [],
      recent_generations: [],
      safety_reminders: ['生成内容必须人工复核'],
    })),
    http.delete('/api/ai/favorites/task-1', () => {
      removeFavorite();
      return new HttpResponse(null, { status: 204 });
    }),
  );

  render(<HomePage session={{
    user: { id: 'u-1', username: '张磊', role: 'employee' },
    scope: { department: '技术部', managedDepartments: [] },
    apps: ['ai-assistant'],
    local_binding_token: 'signed-binding-token',
  }} onOpenTask={vi.fn()} onShowAssistants={vi.fn()} />);

  expect(await screen.findByText('上午好，张磊')).toBeInTheDocument();
  expect(screen.getByText('工作总结')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '取消收藏 工作总结' }));
  await waitFor(() => expect(removeFavorite).toHaveBeenCalled());
  expect(screen.queryByText('工作总结')).not.toBeInTheDocument();
});

it('loads encrypted history detail only after selection and supports delete', async () => {
  const detailRequest = vi.fn();
  const deleteRequest = vi.fn();
  server.use(
    http.get('/api/ai/generations', () => HttpResponse.json({ items: [historyItem], total: 1 })),
    http.get('/api/ai/generations/gen-1', () => {
      detailRequest();
      return HttpResponse.json({
        ...historyItem,
        input: { work: '本周工作' },
        output: '# 完成情况',
        knowledge_refs: [],
      });
    }),
    http.delete('/api/ai/generations/gen-1', () => {
      deleteRequest();
      return new HttpResponse(null, { status: 204 });
    }),
  );

  render(<HistoryPage />);

  expect(await screen.findByText('工作总结')).toBeInTheDocument();
  expect(detailRequest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /工作总结/ }));
  expect(await screen.findByText('# 完成情况')).toBeInTheDocument();
  expect(detailRequest).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: '删除记录' }));
  await waitFor(() => expect(deleteRequest).toHaveBeenCalled());
  expect(screen.queryByText('# 完成情况')).not.toBeInTheDocument();
});

it('offers seven feedback types and requires text only for other feedback', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<FeedbackPanel generationUuid="gen-1" onSubmit={submit} />);

  expect(screen.getAllByRole('radio')).toHaveLength(7);
  expect(screen.queryByLabelText('补充说明')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: '其他' }));
  expect(screen.getByLabelText('补充说明')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交反馈' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('补充说明'), '需要更多上下文');
  await userEvent.click(screen.getByRole('button', { name: '提交反馈' }));
  expect(submit).toHaveBeenCalledWith('OTHER', '需要更多上下文');
});

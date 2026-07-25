import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import {
  BackgroundTaskNotifier,
  type BackgroundTaskActivity,
} from '../src/components/BackgroundTaskNotifier';
import { server } from './setup';

const runningTask = {
  task_id: 'long-report',
  task_type: 'chat_generation',
  title: '客户合规解决方案 PPT',
  conversation_id: 'session-completed',
  message_uuid: 'assistant-completed',
  status: 'running' as const,
  stage: 'generating',
  progress: 60,
  attempt: 1,
  draft: '正在生成第 6 页…',
  error_code: '',
  error_message: '',
  retry_allowed: false,
  cancel_allowed: true,
  created_at: '2026-07-10T04:00:00Z',
  updated_at: '2026-07-10T04:01:00Z',
};

it('notifies globally when a background task completes and opens its conversation', async () => {
  let requestCount = 0;
  const activityChanges: BackgroundTaskActivity[] = [];
  const openConversation = vi.fn();
  server.use(
    http.get('/api/ai/long-tasks', () => {
      requestCount += 1;
      return HttpResponse.json({
        items: [{
          ...runningTask,
          status: requestCount === 1 ? 'running' : 'completed',
          stage: requestCount === 1 ? 'generating' : 'completed',
          progress: requestCount === 1 ? 60 : 100,
          cancel_allowed: requestCount === 1,
        }],
        total: 1,
      });
    }),
  );

  render(
    <BackgroundTaskNotifier
      enabled
      onActivityChange={(activity) => activityChanges.push(activity)}
      onOpenConversation={openConversation}
      onOpenTasks={vi.fn()}
      taskCenterOpen={false}
    />,
  );

  await waitFor(() => expect(activityChanges).toContainEqual({
    activeCount: 1,
    attentionCount: 0,
    unreadCount: 0,
  }));
  window.dispatchEvent(new Event('focus'));

  const notice = await screen.findByRole('status', { name: '后台任务完成' });
  expect(notice).toHaveTextContent('客户合规解决方案 PPT');
  await userEvent.click(within(notice).getByRole('button', { name: '查看结果' }));

  expect(openConversation).toHaveBeenCalledWith('session-completed');
  expect(screen.queryByRole('status', { name: '后台任务完成' })).not.toBeInTheDocument();
  await waitFor(() => expect(activityChanges.at(-1)?.unreadCount).toBe(0));
});

it('routes failed background tasks to the task center', async () => {
  let requestCount = 0;
  const openTasks = vi.fn();
  server.use(
    http.get('/api/ai/long-tasks', () => {
      requestCount += 1;
      return HttpResponse.json({
        items: [{
          ...runningTask,
          status: requestCount === 1 ? 'running' : 'failed',
          error_code: requestCount === 1 ? '' : 'MODEL_FAILED',
          error_message: requestCount === 1 ? '' : '服务暂时不可用',
          retry_allowed: requestCount > 1,
          cancel_allowed: requestCount === 1,
        }],
        total: 1,
      });
    }),
  );

  render(
    <BackgroundTaskNotifier
      enabled
      onOpenConversation={vi.fn()}
      onOpenTasks={openTasks}
      taskCenterOpen={false}
    />,
  );

  await waitFor(() => expect(requestCount).toBe(1));
  window.dispatchEvent(new Event('focus'));

  const notice = await screen.findByRole('status', { name: '后台任务需要处理' });
  expect(notice).toHaveTextContent('客户合规解决方案 PPT');
  await userEvent.click(within(notice).getByRole('button', { name: '查看任务' }));

  expect(openTasks).toHaveBeenCalledOnce();
});

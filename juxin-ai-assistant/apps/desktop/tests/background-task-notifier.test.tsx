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

const completedNotification = {
  notification_uuid: 'notification-completed',
  task_id: 'long-report',
  title: '客户合规解决方案 PPT',
  conversation_id: 'session-completed',
  message_uuid: 'assistant-completed',
  task_status: 'completed' as const,
  attempt: 1,
  unread: true,
  replayed: false,
  created_at: '2026-07-10T04:02:00Z',
  read_at: null,
};

it('restores a durable completion notification and opens its conversation', async () => {
  const activityChanges: BackgroundTaskActivity[] = [];
  const openConversation = vi.fn();
  const markRead = vi.fn();
  server.use(
    http.get('/api/ai/long-tasks', () => {
      return HttpResponse.json({
        items: [{
          ...runningTask,
          status: 'completed',
          stage: 'completed',
          progress: 100,
          cancel_allowed: false,
        }],
        total: 1,
      });
    }),
    http.get('/api/ai/long-tasks/notifications', () => HttpResponse.json({
      items: [completedNotification],
      total: 1,
      unread_count: 1,
    })),
    http.post('/api/ai/long-tasks/notifications/:notificationId/read', ({ params }) => {
      markRead(params.notificationId);
      return HttpResponse.json({
        ...completedNotification,
        unread: false,
        read_at: '2026-07-10T04:03:00Z',
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
    activeCount: 0,
    attentionCount: 0,
    unreadCount: 1,
  }));

  const notice = await screen.findByRole('status', { name: '后台任务完成' });
  expect(notice).toHaveTextContent('客户合规解决方案 PPT');
  await userEvent.click(within(notice).getByRole('button', { name: '查看结果' }));

  expect(openConversation).toHaveBeenCalledWith('session-completed');
  expect(markRead).toHaveBeenCalledWith('notification-completed');
  expect(screen.queryByRole('status', { name: '后台任务完成' })).not.toBeInTheDocument();
  await waitFor(() => expect(activityChanges.at(-1)?.unreadCount).toBe(0));
});

it('routes a durable failed-task notification to the task center', async () => {
  const openTasks = vi.fn();
  server.use(
    http.get('/api/ai/long-tasks', () => {
      return HttpResponse.json({
        items: [{
          ...runningTask,
          status: 'failed',
          error_code: 'MODEL_FAILED',
          error_message: '服务暂时不可用',
          retry_allowed: true,
          cancel_allowed: false,
        }],
        total: 1,
      });
    }),
    http.get('/api/ai/long-tasks/notifications', () => HttpResponse.json({
      items: [{
        ...completedNotification,
        notification_uuid: 'notification-failed',
        task_status: 'failed',
      }],
      total: 1,
      unread_count: 1,
    })),
    http.post('/api/ai/long-tasks/notifications/:notificationId/read', () =>
      HttpResponse.json({
        ...completedNotification,
        notification_uuid: 'notification-failed',
        task_status: 'failed',
        unread: false,
        read_at: '2026-07-10T04:03:00Z',
      })),
  );

  render(
    <BackgroundTaskNotifier
      enabled
      onOpenConversation={vi.fn()}
      onOpenTasks={openTasks}
      taskCenterOpen={false}
    />,
  );

  const notice = await screen.findByRole('status', { name: '后台任务需要处理' });
  expect(notice).toHaveTextContent('客户合规解决方案 PPT');
  await userEvent.click(within(notice).getByRole('button', { name: '查看任务' }));

  expect(openTasks).toHaveBeenCalledOnce();
});

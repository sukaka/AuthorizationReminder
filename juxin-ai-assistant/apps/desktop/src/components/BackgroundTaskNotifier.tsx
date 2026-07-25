import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listLongTaskNotifications,
  listLongTasks,
  markLongTaskNotificationRead,
  type LongTaskNotificationPayload,
  type LongTaskPayload,
} from '../api/chat';

export type BackgroundTaskActivity = {
  activeCount: number;
  attentionCount: number;
  unreadCount: number;
};

type BackgroundTaskNotice = {
  kind: 'completed' | 'attention';
  notification: LongTaskNotificationPayload;
};

type BackgroundTaskNotifierProps = {
  enabled: boolean;
  taskCenterOpen: boolean;
  onActivityChange?: (activity: BackgroundTaskActivity) => void;
  onOpenConversation: (conversationId: string) => void;
  onOpenTasks: () => void;
};

const activeStatuses = new Set<LongTaskPayload['status']>(['queued', 'running', 'retrying']);
const attentionStatuses = new Set<LongTaskPayload['status']>(['waiting_user', 'failed']);

export function BackgroundTaskNotifier({
  enabled,
  taskCenterOpen,
  onActivityChange,
  onOpenConversation,
  onOpenTasks,
}: BackgroundTaskNotifierProps) {
  const [notice, setNotice] = useState<BackgroundTaskNotice | null>(null);
  const [activity, setActivity] = useState<BackgroundTaskActivity>({
    activeCount: 0,
    attentionCount: 0,
    unreadCount: 0,
  });
  const dismissedNotificationIdsRef = useRef(new Set<string>());
  const refreshInFlightRef = useRef(false);
  const activityCallbackRef = useRef(onActivityChange);

  useEffect(() => {
    activityCallbackRef.current = onActivityChange;
  }, [onActivityChange]);

  useEffect(() => {
    activityCallbackRef.current?.(activity);
  }, [activity]);

  const dismissNotice = useCallback((target: BackgroundTaskNotice | null = notice) => {
    if (!target) return;
    dismissedNotificationIdsRef.current.add(target.notification.notification_uuid);
    setNotice(null);
    setActivity((current) => (
      current.unreadCount
        ? { ...current, unreadCount: Math.max(0, current.unreadCount - 1) }
        : current
    ));
    markLongTaskNotificationRead(target.notification.notification_uuid).catch(() => undefined);
  }, [notice]);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const [taskPayload, notificationPayload] = await Promise.all([
        listLongTasks(),
        listLongTaskNotifications({ unreadOnly: true }),
      ]);
      const visibleNotifications = notificationPayload.items.filter(
        (item) => !dismissedNotificationIdsRef.current.has(item.notification_uuid),
      );
      const nextNotification = visibleNotifications[0] ?? null;
      setActivity({
        activeCount: taskPayload.items.filter((task) => activeStatuses.has(task.status)).length,
        attentionCount: taskPayload.items.filter((task) => attentionStatuses.has(task.status)).length,
        unreadCount: Math.max(
          0,
          notificationPayload.unread_count
            - notificationPayload.items.filter((item) => (
              dismissedNotificationIdsRef.current.has(item.notification_uuid)
            )).length,
        ),
      });
      setNotice(nextNotification ? {
        kind: nextNotification.task_status === 'completed' ? 'completed' : 'attention',
        notification: nextNotification,
      } : null);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      dismissedNotificationIdsRef.current.clear();
      setNotice(null);
      setActivity({ activeCount: 0, attentionCount: 0, unreadCount: 0 });
      return undefined;
    }

    let active = true;
    const safeRefresh = () => {
      if (!active || document.visibilityState === 'hidden') return;
      refresh().catch(() => undefined);
    };
    safeRefresh();
    const timer = window.setInterval(safeRefresh, 3000);
    window.addEventListener('focus', safeRefresh);
    document.addEventListener('visibilitychange', safeRefresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', safeRefresh);
      document.removeEventListener('visibilitychange', safeRefresh);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (taskCenterOpen) dismissNotice();
  }, [dismissNotice, taskCenterOpen]);

  if (!notice) return null;

  const completed = notice.kind === 'completed';
  return (
    <section
      aria-label={completed ? '后台任务完成' : '后台任务需要处理'}
      aria-live="polite"
      className={`background-task-notice is-${notice.kind}`}
      role="status"
    >
      <div>
        <strong>{completed ? '后台任务已完成' : '后台任务需要处理'}</strong>
        <span title={notice.notification.title}>{notice.notification.title}</span>
      </div>
      <button
        onClick={() => {
          dismissNotice();
          if (completed && notice.notification.conversation_id) {
            onOpenConversation(notice.notification.conversation_id);
          } else {
            onOpenTasks();
          }
        }}
        type="button"
      >
        {completed ? '查看结果' : '查看任务'}
      </button>
      <button
        aria-label="关闭任务提醒"
        className="background-task-notice-close"
        onClick={() => dismissNotice()}
        type="button"
      >
        ×
      </button>
    </section>
  );
}

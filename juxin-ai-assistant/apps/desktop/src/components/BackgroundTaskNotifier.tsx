import { useCallback, useEffect, useRef, useState } from 'react';

import { listLongTasks, type LongTaskPayload } from '../api/chat';

export type BackgroundTaskActivity = {
  activeCount: number;
  attentionCount: number;
  unreadCount: number;
};

type BackgroundTaskNotice = {
  kind: 'completed' | 'attention';
  task: LongTaskPayload;
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
  const initializedRef = useRef(false);
  const statusByTaskRef = useRef(new Map<string, LongTaskPayload['status']>());
  const activityCallbackRef = useRef(onActivityChange);

  useEffect(() => {
    activityCallbackRef.current = onActivityChange;
  }, [onActivityChange]);

  useEffect(() => {
    activityCallbackRef.current?.(activity);
  }, [activity]);

  const dismissNotice = useCallback(() => {
    setNotice(null);
    setActivity((current) => (
      current.unreadCount ? { ...current, unreadCount: 0 } : current
    ));
  }, []);

  const refresh = useCallback(async () => {
    const payload = await listLongTasks();
    const previousStatuses = statusByTaskRef.current;
    let nextNotice: BackgroundTaskNotice | null = null;

    if (initializedRef.current) {
      const changedTask = payload.items.find((task) => {
        const previousStatus = previousStatuses.get(task.task_id);
        if (!previousStatus || previousStatus === task.status) return false;
        return task.status === 'completed' || attentionStatuses.has(task.status);
      });
      if (changedTask) {
        nextNotice = {
          kind: changedTask.status === 'completed' ? 'completed' : 'attention',
          task: changedTask,
        };
      }
    }

    statusByTaskRef.current = new Map(
      payload.items.map((task) => [task.task_id, task.status] as const),
    );
    initializedRef.current = true;
    setActivity((current) => ({
      activeCount: payload.items.filter((task) => activeStatuses.has(task.status)).length,
      attentionCount: payload.items.filter((task) => attentionStatuses.has(task.status)).length,
      unreadCount: nextNotice ? 1 : current.unreadCount,
    }));
    if (nextNotice) setNotice(nextNotice);
  }, []);

  useEffect(() => {
    if (!enabled) {
      initializedRef.current = false;
      statusByTaskRef.current.clear();
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
    const timer = window.setInterval(safeRefresh, 5000);
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
        <span title={notice.task.title}>{notice.task.title}</span>
      </div>
      <button
        onClick={() => {
          dismissNotice();
          if (completed && notice.task.conversation_id) {
            onOpenConversation(notice.task.conversation_id);
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
        onClick={dismissNotice}
        type="button"
      >
        ×
      </button>
    </section>
  );
}

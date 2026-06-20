import { useEffect, useState } from 'react';

import {
  ApiError,
  getAuthPortalUrl,
  getSession,
  type SessionPayload,
  type TaskPayload,
} from './api/client';
import { ModelProfilesPage } from './pages/ModelProfilesPage';
import { AssistantsPage } from './pages/AssistantsPage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { TaskRunPage, type TaskDefinition } from './pages/TaskRunPage';
import { syncPendingResults } from './local/syncQueue';

type ViewState =
  | { kind: 'checking' }
  | { kind: 'ready'; session: SessionPayload }
  | { kind: 'forbidden' }
  | { kind: 'error' };

function Workspace({ session }: { session: SessionPayload }) {
  const [page, setPage] = useState<'home' | 'assistants' | 'history' | 'task' | 'models'>('home');
  const [task, setTask] = useState<TaskDefinition | null>(null);
  const [taskError, setTaskError] = useState('');

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    const sync = () => {
      syncPendingResults().catch(() => undefined);
    };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, []);

  const openTask = (nextTask: TaskPayload) => {
    setTask(nextTask);
    setTaskError('');
    setPage('task');
  };

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="聚信 AI 助手">
          <span>聚</span>
          <strong>聚信 AI 助手</strong>
        </div>
        <nav aria-label="主导航">
          <button className={page === 'home' ? 'is-current' : ''} onClick={() => setPage('home')} type="button">工作台</button>
          <button className={page === 'assistants' ? 'is-current' : ''} onClick={() => setPage('assistants')} type="button">全部助手</button>
          <button className={page === 'history' ? 'is-current' : ''} onClick={() => setPage('history')} type="button">历史记录</button>
          <button className={page === 'models' ? 'is-current' : ''} onClick={() => setPage('models')} type="button">个人模型</button>
        </nav>
        <div className="sidebar-foot">
          <span className="presence-dot" />
          <div>
            <strong>{session.user.username}</strong>
            <small>{session.scope.department || '聚信员工'}</small>
          </div>
        </div>
      </aside>

      <main className="workspace" id="workspace">
        {page === 'models' ? (
          <ModelProfilesPage />
        ) : page === 'assistants' ? (
          <AssistantsPage onOpenTask={openTask} />
        ) : page === 'history' ? (
          <HistoryPage />
        ) : page === 'task' ? (
          <>
            <button className="back-button" onClick={() => setPage('home')} type="button">‹ 返回工作台</button>
            {task
              ? <TaskRunPage task={task} userId={String(session.user.id)} />
              : <section className="desktop-required"><p>{taskError || '正在加载任务…'}</p></section>}
          </>
        ) : (
          <HomePage
            onOpenTask={openTask}
            onShowAssistants={() => setPage('assistants')}
            session={session}
          />
        )}
      </main>
    </div>
  );
}

function StatusView({ kind }: { kind: 'checking' | 'forbidden' | 'error' }) {
  if (kind === 'checking') {
    return (
      <main className="status-view">
        <span className="status-orb" />
        <p>正在检查统一登录…</p>
      </main>
    );
  }

  const forbidden = kind === 'forbidden';
  return (
    <main className="status-view">
      <span className="status-symbol">{forbidden ? '!' : '↻'}</span>
      <h1>{forbidden ? '暂时无法进入工作台' : '服务暂时不可用'}</h1>
      <p>
        {forbidden
          ? '你的统一账号尚未获得聚信 AI 助手访问权限。'
          : '无法连接聚信 AI 助手服务，请稍后再试。'}
      </p>
      <a href={getAuthPortalUrl()}>
        返回统一门户
      </a>
    </main>
  );
}

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (active) setState({ kind: 'ready', session });
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof ApiError && error.status === 401)) return;
        setState({
          kind: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return state.kind === 'ready'
    ? <Workspace session={state.session} />
    : <StatusView kind={state.kind} />;
}

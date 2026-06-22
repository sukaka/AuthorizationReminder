import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

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
import { logoutLocalUser, syncPendingResults } from './local/syncQueue';
import { AuditPage } from './pages/admin/AuditPage';
import { GovernanceCenter } from './pages/admin/GovernanceCenter';
import { StatsPage } from './pages/admin/StatsPage';
import { SuggestionsPage } from './pages/admin/SuggestionsPage';
import { LauncherPage } from './launcher/LauncherPage';
import { WorkspaceUpdateControl } from './launcher/WorkspaceUpdateControl';
import {
  desktopBridge,
  type DesktopBridge,
} from './remote/desktopBridge';

type WorkspacePage =
  | 'home'
  | 'assistants'
  | 'history'
  | 'task'
  | 'models'
  | 'governance'
  | 'department-stats'
  | 'suggestions'
  | 'audit';

type ViewState =
  | { kind: 'checking' }
  | { kind: 'ready'; session: SessionPayload }
  | { kind: 'forbidden' }
  | { kind: 'error' };

function Workspace({ session }: { session: SessionPayload }) {
  const [page, setPage] = useState<WorkspacePage>('home');
  const [task, setTask] = useState<TaskDefinition | null>(null);
  const [taskError, setTaskError] = useState('');
  const role = session.user.role.trim().toLowerCase();
  const isAdmin = role === 'admin' || role === 'sysadmin';
  const canAudit = role === 'admin' || role === 'auditor';
  const isManager = session.scope.managedDepartments.length > 0;

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    const sync = () => {
      syncPendingResults(String(session.user.id)).catch(() => undefined);
    };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [session.user.id]);

  const openTask = (nextTask: TaskPayload) => {
    setTask(nextTask);
    setTaskError('');
    setPage('task');
  };

  const logout = async () => {
    try {
      await fetch('/api/ai/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error: unknown) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (window.__TAURI_INTERNALS__) {
      try {
        await logoutLocalUser(String(session.user.id));
      } catch {
        window.location.assign(getAuthPortalUrl());
      }
    } else {
      window.location.assign(getAuthPortalUrl());
    }
  };

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="聚信 AI 助手">
          <span>聚</span>
          <strong>聚信 AI 助手</strong>
        </div>
        <nav aria-label="主导航">
          <button aria-current={page === 'home' ? 'page' : undefined} className={page === 'home' ? 'is-current' : ''} onClick={() => setPage('home')} type="button">工作台</button>
          <button aria-current={page === 'assistants' ? 'page' : undefined} className={page === 'assistants' ? 'is-current' : ''} onClick={() => setPage('assistants')} type="button">全部助手</button>
          <button aria-current={page === 'history' ? 'page' : undefined} className={page === 'history' ? 'is-current' : ''} onClick={() => setPage('history')} type="button">历史记录</button>
          <button aria-current={page === 'models' ? 'page' : undefined} className={page === 'models' ? 'is-current' : ''} onClick={() => setPage('models')} type="button">个人模型</button>
          {isManager ? (
            <>
              <button aria-current={page === 'department-stats' ? 'page' : undefined} className={page === 'department-stats' ? 'is-current' : ''} onClick={() => setPage('department-stats')} type="button">部门数据</button>
              <button aria-current={page === 'suggestions' ? 'page' : undefined} className={page === 'suggestions' ? 'is-current' : ''} onClick={() => setPage('suggestions')} type="button">提交建议</button>
            </>
          ) : null}
          {isAdmin ? <button aria-current={page === 'governance' ? 'page' : undefined} className={page === 'governance' ? 'is-current' : ''} onClick={() => setPage('governance')} type="button">治理中心</button> : null}
          {!isAdmin && canAudit ? <button aria-current={page === 'audit' ? 'page' : undefined} className={page === 'audit' ? 'is-current' : ''} onClick={() => setPage('audit')} type="button">审计日志</button> : null}
        </nav>
        <div className="sidebar-foot">
          <WorkspaceUpdateControl />
          <span className="presence-dot" />
          <div>
            <strong>{session.user.username}</strong>
            <small>{session.scope.department || '聚信员工'}</small>
          </div>
          <button aria-label="退出登录" className="logout-button" onClick={() => void logout()} type="button">退出</button>
        </div>
      </aside>

      <main className="workspace" id="workspace">
        {page === 'models' ? (
          <ModelProfilesPage />
        ) : page === 'governance' ? (
          <GovernanceCenter session={session} />
        ) : page === 'department-stats' ? (
          <StatsPage manager />
        ) : page === 'suggestions' ? (
          <SuggestionsPage departments={session.scope.managedDepartments} />
        ) : page === 'audit' ? (
          <AuditPage />
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
      {window.__TAURI_INTERNALS__ ? (
        <button
          type="button"
          onClick={() => {
            void invoke('workspace_close').catch(() => {
              window.location.assign(getAuthPortalUrl());
            });
          }}
        >
          返回启动页
        </button>
      ) : null}
    </main>
  );
}

type AppProps = {
  readonly bridge?: DesktopBridge;
};

export default function App({ bridge = desktopBridge }: AppProps) {
  if (bridge.isLocalLauncherContext()) {
    return <LauncherPage bridge={bridge} />;
  }

  return <RemoteWorkspace />;
}

function RemoteWorkspace() {
  const [state, setState] = useState<ViewState>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    getSession()
      .then(async (session) => {
        if (window.__TAURI_INTERNALS__) {
          await invoke('local_session_bind', {
            token: session.local_binding_token,
          });
          await invoke('workspace_ready');
        }
        if (active) setState({ kind: 'ready', session });
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof ApiError && error.status === 401)) return;
        const kind =
          error instanceof ApiError && error.status === 403
            ? 'forbidden'
            : 'error';
        if (window.__TAURI_INTERNALS__) {
          void invoke('workspace_status', {
            status: kind === 'forbidden' ? 'forbidden' : 'network-error',
          }).catch(() => {
            window.location.assign(getAuthPortalUrl());
          });
        }
        setState({ kind });
      });
    return () => {
      active = false;
    };
  }, []);

  return state.kind === 'ready'
    ? <Workspace session={state.session} />
    : <StatusView kind={state.kind} />;
}

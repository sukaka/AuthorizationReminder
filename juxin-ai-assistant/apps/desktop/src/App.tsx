import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import juxinAiLogo from './assets/juxin-ai-logo.png';
import {
  ApiError,
  clearSsoCallbackParams,
  getAuthPortalUrl,
  getSession,
  type SessionPayload,
  type TaskPayload,
} from './api/client';
import { ModelProfilesPage } from './pages/ModelProfilesPage';
import { AssistantsPage } from './pages/AssistantsPage';
import { ChatPage } from './pages/ChatPage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { KnowledgePage } from './pages/KnowledgePage';
import { LearningPage } from './pages/LearningPage';
import { SkillsPage } from './pages/SkillsPage';
import { TaskRunPage, type TaskDefinition } from './pages/TaskRunPage';
import { logoutLocalUser, syncPendingResults } from './local/syncQueue';
import { GovernanceCenter } from './pages/admin/GovernanceCenter';
import { StatsPage } from './pages/admin/StatsPage';
import { SuggestionsPage } from './pages/admin/SuggestionsPage';
import { LauncherPage } from './launcher/LauncherPage';
import { WorkspaceUpdateControl } from './launcher/WorkspaceUpdateControl';
import { getRuntimeCapabilities } from './runtime/capabilities';
import {
  desktopBridge,
  type DesktopBridge,
} from './remote/desktopBridge';

type WorkspacePage =
  | 'home'
  | 'assistants'
  | 'chat'
  | 'history'
  | 'knowledge'
  | 'skills'
  | 'learning'
  | 'task'
  | 'models'
  | 'governance'
  | 'department-stats'
  | 'suggestions';

type SidebarMode = 'expanded' | 'collapsed' | 'immersive';

type ViewState =
  | { kind: 'checking' }
  | { kind: 'ready'; session: SessionPayload }
  | { kind: 'forbidden' }
  | { kind: 'error' };

function Workspace({ session }: { session: SessionPayload }) {
  const capabilities = getRuntimeCapabilities();
  const [page, setPage] = useState<WorkspacePage>('home');
  const [task, setTask] = useState<TaskDefinition | null>(null);
  const [taskError, setTaskError] = useState('');
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('expanded');
  const [sidebarTouched, setSidebarTouched] = useState(false);
  const role = session.user.role.trim().toLowerCase();
  const isAdmin = role === 'admin';
  const immersive = sidebarMode === 'immersive';
  const pageTitle = page === 'home'
    ? '工作台'
    : page === 'assistants'
      ? '助手模式'
      : page === 'chat'
        ? '私人工作助理'
          : page === 'history'
            ? '工作成果'
            : page === 'knowledge'
              ? '我的资料'
              : page === 'skills'
                ? '能力中心'
                : page === 'learning'
                  ? '学习中心'
                  : page === 'models'
                    ? '设置'
                    : page === 'department-stats'
                      ? '部门数据'
                      : page === 'suggestions'
                        ? '提交建议'
                        : page === 'governance'
                          ? '治理中心'
                          : '任务处理';

  useEffect(() => {
    if (sidebarTouched) return;
    setSidebarMode(page === 'chat' || page === 'task' ? 'collapsed' : 'expanded');
  }, [page, sidebarTouched]);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    const sync = () => {
      syncPendingResults(String(session.user.id), Date.now(), { force: true }).catch(() => undefined);
    };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [session.user.id]);

  useEffect(() => {
    if (!isAdmin && (
      page === 'department-stats'
      || page === 'suggestions'
      || page === 'governance'
    )) {
      setPage('home');
    }
  }, [isAdmin, page]);

  useEffect(() => {
    if (!capabilities.canUseLocalKeychain && page === 'models') {
      setPage('home');
    }
  }, [capabilities.canUseLocalKeychain, page]);

  const openTask = (nextTask: TaskPayload) => {
    setTask(nextTask);
    setTaskError('');
    setPage('task');
  };

  const chooseSidebarMode = (mode: SidebarMode) => {
    setSidebarTouched(true);
    setSidebarMode(mode);
  };

  const toggleSidebarMode = () => {
    chooseSidebarMode(sidebarMode === 'expanded' ? 'collapsed' : 'expanded');
  };

  const logout = async () => {
    const authLogoutUrl = getAuthPortalUrl({ logout: true });
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
        // Continue to the unified logout even if local cleanup has already been cleared.
      }
    }
    window.location.assign(authLogoutUrl);
  };

  return (
    <div className={`app-frame sidebar-${sidebarMode}`}>
      <aside className="sidebar">
        <div className="brand-mark" aria-label="聚信 AI 助手 · 私人工作助理">
          <img alt="" aria-hidden="true" src={juxinAiLogo} />
          <strong className="brand-label">聚信 AI 助手 · 私人工作助理</strong>
        </div>
        <nav aria-label="主导航">
          <button aria-current={page === 'home' ? 'page' : undefined} className={page === 'home' ? 'is-current' : ''} onClick={() => setPage('home')} type="button"><span className="nav-icon" aria-hidden="true">⌂</span><span className="nav-label">工作台</span></button>
          <button aria-current={page === 'assistants' ? 'page' : undefined} className={page === 'assistants' ? 'is-current' : ''} onClick={() => setPage('assistants')} type="button"><span className="nav-icon" aria-hidden="true">✦</span><span className="nav-label">助手模式</span></button>
          <button aria-current={page === 'history' ? 'page' : undefined} className={page === 'history' ? 'is-current' : ''} onClick={() => setPage('history')} type="button"><span className="nav-icon" aria-hidden="true">↺</span><span className="nav-label">工作成果</span></button>
          <button aria-current={page === 'skills' ? 'page' : undefined} className={page === 'skills' ? 'is-current' : ''} onClick={() => setPage('skills')} type="button"><span className="nav-icon" aria-hidden="true">◈</span><span className="nav-label">能力中心</span></button>
          <button aria-current={page === 'knowledge' ? 'page' : undefined} className={page === 'knowledge' ? 'is-current' : ''} onClick={() => setPage('knowledge')} type="button"><span className="nav-icon" aria-hidden="true">⌘</span><span className="nav-label">我的资料</span></button>
          <button aria-current={page === 'learning' ? 'page' : undefined} className={page === 'learning' ? 'is-current' : ''} onClick={() => setPage('learning')} type="button"><span className="nav-icon" aria-hidden="true">✧</span><span className="nav-label">学习中心</span></button>
          {capabilities.canUseLocalKeychain ? (
            <button aria-current={page === 'models' ? 'page' : undefined} className={page === 'models' ? 'is-current' : ''} onClick={() => setPage('models')} type="button"><span className="nav-icon" aria-hidden="true">◇</span><span className="nav-label">设置</span></button>
          ) : null}
          {isAdmin ? (
            <>
              <button aria-current={page === 'department-stats' ? 'page' : undefined} className={page === 'department-stats' ? 'is-current' : ''} onClick={() => setPage('department-stats')} type="button"><span className="nav-icon" aria-hidden="true">▦</span><span className="nav-label">部门数据</span></button>
              <button aria-current={page === 'suggestions' ? 'page' : undefined} className={page === 'suggestions' ? 'is-current' : ''} onClick={() => setPage('suggestions')} type="button"><span className="nav-icon" aria-hidden="true">✎</span><span className="nav-label">提交建议</span></button>
              <button aria-current={page === 'governance' ? 'page' : undefined} className={page === 'governance' ? 'is-current' : ''} onClick={() => setPage('governance')} type="button"><span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-label">治理中心</span></button>
            </>
          ) : null}
        </nav>
        <div className="sidebar-foot">
          {capabilities.canUseAutoUpdater ? <WorkspaceUpdateControl /> : null}
          <span className="presence-dot" />
          <div>
            <strong>{session.user.username}</strong>
            <small>{session.scope.department || '聚信员工'}</small>
          </div>
          <button aria-label="退出登录" className="logout-button" onClick={() => void logout()} type="button">退出</button>
        </div>
      </aside>

      <main className="workspace-shell" id="workspace">
        <header className="workspace-topbar">
          <div className="workspace-titlebar">
            {page !== 'home' ? (
              <button className="workspace-back-button" onClick={() => setPage('home')} type="button">‹ 返回工作台</button>
            ) : null}
            <strong>{pageTitle}</strong>
            <button
              aria-label={sidebarMode === 'expanded' ? '收起侧边栏' : '展开侧边栏'}
              className="workspace-title-toggle"
              onClick={toggleSidebarMode}
              title={sidebarMode === 'expanded' ? '收起侧边栏' : '展开侧边栏'}
              type="button"
            >
              {sidebarMode === 'expanded' ? '‹' : '›'}
            </button>
          </div>
          <div className="workspace-sidebar-state" aria-label="侧边栏显示方式">
            <button className={sidebarMode === 'expanded' ? 'is-active' : ''} onClick={() => chooseSidebarMode('expanded')} type="button">展开</button>
            <button className={sidebarMode === 'collapsed' ? 'is-active' : ''} onClick={() => chooseSidebarMode('collapsed')} type="button">收起</button>
            <button className={immersive ? 'is-active' : ''} onClick={() => chooseSidebarMode('immersive')} type="button">沉浸</button>
          </div>
        </header>
        <div className="workspace">
        {page === 'models' && capabilities.canUseLocalKeychain ? (
          <ModelProfilesPage />
        ) : page === 'governance' && isAdmin ? (
          <GovernanceCenter session={session} />
        ) : page === 'department-stats' && isAdmin ? (
          <StatsPage manager />
        ) : page === 'suggestions' && isAdmin ? (
          <SuggestionsPage departments={session.scope.managedDepartments} />
        ) : page === 'assistants' ? (
          <AssistantsPage onOpenTask={openTask} />
        ) : page === 'chat' ? (
          <ChatPage />
        ) : page === 'knowledge' ? (
          <KnowledgePage session={session} />
        ) : page === 'skills' ? (
          <SkillsPage />
        ) : page === 'learning' ? (
          <LearningPage isAdmin={isAdmin} />
        ) : page === 'history' ? (
          <HistoryPage />
        ) : page === 'task' ? (
          <>
            {task
              ? <TaskRunPage task={task} userId={String(session.user.id)} />
              : <section className="desktop-required"><p>{taskError || '正在加载任务…'}</p></section>}
          </>
        ) : (
          <HomePage
            onOpenTask={openTask}
            onOpenChat={() => setPage('chat')}
            onShowAssistants={() => setPage('assistants')}
            session={session}
          />
        )}
        </div>
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
        clearSsoCallbackParams();
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

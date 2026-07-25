import { useEffect, useRef, useState } from 'react';

import juxinAiLogo from './assets/juxin-ai-logo.png';
import {
  ApiError,
  apiFetch,
  clearDesktopSsoToken,
  clearSsoCallbackParams,
  getAuthPortalUrl,
  getSession,
  type SessionPayload,
  type TaskPayload,
} from './api/client';
import { ModelProfilesPage } from './pages/ModelProfilesPage';
import { AssistantsPage } from './pages/AssistantsPage';
import { ChatPage } from './pages/ChatPage';
import { ChatRunPrototypePage } from './pages/ChatRunPrototypePage';
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage';
import { EnterpriseOverviewPage } from './pages/EnterpriseOverviewPage';
import { EnterpriseManagementPage } from './pages/EnterpriseManagementPage';
import { ProfessionalDeliverablesPage } from './pages/ProfessionalDeliverablesPage';
import { ProfessionalTasksPage } from './pages/ProfessionalTasksPage';
import { HistoryPage } from './pages/HistoryPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { LearningPage } from './pages/LearningPage';
import { SkillsPage } from './pages/SkillsPage';
import { TasksPage } from './pages/TasksPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { AgentHubPage } from './pages/AgentHubPage';
import { TaskRunPage, type TaskDefinition } from './pages/TaskRunPage';
import { logoutLocalUser, syncPendingResults } from './local/syncQueue';
import { AuditPage } from './pages/admin/AuditPage';
import { GovernanceCenter } from './pages/admin/GovernanceCenter';
import { StatsPage } from './pages/admin/StatsPage';
import { SuggestionsPage } from './pages/admin/SuggestionsPage';
import { LauncherPage } from './launcher/LauncherPage';
import { WorkspaceUpdateControl } from './launcher/WorkspaceUpdateControl';
import { getRuntimeCapabilities } from './runtime/capabilities';
import { isPlatformAdminRole } from './auth/roles';
import {
  desktopBridge,
  type DesktopBridge,
} from './remote/desktopBridge';
import {
  buildWorkspaceSearch,
  readWorkspaceLocation,
  type NavigableWorkspacePage,
} from './navigation/workspaceLocation';
import {
  BackgroundTaskNotifier,
  type BackgroundTaskActivity,
} from './components/BackgroundTaskNotifier';

type WorkspacePage =
  | NavigableWorkspacePage
  | 'chat-prototype'
  | 'task';

type SidebarMode = 'expanded' | 'collapsed' | 'immersive';

type WorkspaceTab = {
  label: string;
  page: WorkspacePage;
};

const taskDeliveryPages: WorkspacePage[] = [
  'tasks',
  'professional-tasks',
  'professional-deliverables',
  'history',
];
const aiCapabilityPages: WorkspacePage[] = ['assistants', 'workflows', 'skills', 'agent-hub'];
const knowledgeLearningPages: WorkspacePage[] = ['knowledge', 'learning'];
const enterpriseInsightPages: WorkspacePage[] = ['enterprise-overview', 'department-stats'];
const managementPages: WorkspacePage[] = ['governance', 'enterprise-management', 'audit'];

type ViewState =
  | { kind: 'checking' }
  | { kind: 'ready'; session: SessionPayload }
  | { kind: 'forbidden' }
  | { kind: 'error' };

const currentSystemKey = 'ai-assistant';
const systemLabels: Record<string, string> = {
  'ai-assistant': '聚信 AI 助手',
  'reminder': '授权到期提醒系统',
  'delivery': '交付系统',
  'cmdb': 'CMDB 系统',
  'inventory': '库存管理系统',
  'device-flow': '设备流转系统',
  'faq': '文档管理系统',
  'tender': '标书协同制作系统',
  'train-exam': '培训考试系统',
  'prompt-center': '提示词管理中心',
  'sca': '软件成分分析平台',
  'big-screen': '统一大屏展示中心',
  'data-platform': '数据平台',
  'learning-center': '学习中心',
  'admin-center': '管理后台',
  'audit-center': '审计中心',
};

function systemLabel(systemKey: string): string {
  return systemLabels[systemKey] || systemKey;
}

function Workspace({ session }: { session: SessionPayload }) {
  const capabilities = getRuntimeCapabilities();
  const initialLocationRef = useRef(readWorkspaceLocation(window.location.search));
  const [page, setPage] = useState<WorkspacePage>(initialLocationRef.current.page);
  const [task, setTask] = useState<TaskDefinition | null>(null);
  const [taskError, setTaskError] = useState('');
  const [focusSessionUuid, setFocusSessionUuid] = useState(initialLocationRef.current.sessionUuid);
  const [focusProjectUuid, setFocusProjectUuid] = useState(initialLocationRef.current.projectUuid);
  const [focusRunId, setFocusRunId] = useState(initialLocationRef.current.runId);
  const [focusArtifactId, setFocusArtifactId] = useState(initialLocationRef.current.artifactId);
  const [focusWorkflowId, setFocusWorkflowId] = useState(initialLocationRef.current.workflowId);
  const [focusProfessionalDeliverableId, setFocusProfessionalDeliverableId] = useState(
    initialLocationRef.current.deliverableId,
  );
  const [focusProfessionalVersionId, setFocusProfessionalVersionId] = useState(
    initialLocationRef.current.versionId,
  );
  const [historyTab, setHistoryTab] = useState<'work' | 'agent'>(initialLocationRef.current.historyTab);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('expanded');
  const [sidebarTouched, setSidebarTouched] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [backgroundTaskActivity, setBackgroundTaskActivity] = useState<BackgroundTaskActivity>({
    activeCount: 0,
    attentionCount: 0,
    unreadCount: 0,
  });
  const role = session.user.role.trim().toLowerCase();
  const isAdmin = isPlatformAdminRole(role);
  const isDepartmentManager = session.scope.managedDepartments.length > 0;
  const canViewDepartmentStats = isAdmin || isDepartmentManager;
  const canSubmitSuggestion = isAdmin || isDepartmentManager;
  const canReadAudit = isAdmin || role === 'auditor';
  const canManageEnterprise = isAdmin;
  const canViewEnterprise = !new Set(['external', 'external_customer', 'customer', 'visitor', 'guest']).has(role);
  const isWebRuntime = !window.__TAURI_INTERNALS__;
  const immersive = sidebarMode === 'immersive';
  const isTaskDeliveryPage = taskDeliveryPages.includes(page);
  const isAiCapabilityPage = aiCapabilityPages.includes(page);
  const isKnowledgeLearningPage = knowledgeLearningPages.includes(page);
  const isEnterpriseInsightPage = enterpriseInsightPages.includes(page);
  const isManagementPage = managementPages.includes(page);
  const taskIndicatorCount = backgroundTaskActivity.unreadCount
    || backgroundTaskActivity.attentionCount
    || backgroundTaskActivity.activeCount;
  const taskIndicatorKind = backgroundTaskActivity.unreadCount
    ? 'completed'
    : backgroundTaskActivity.attentionCount
      ? 'attention'
      : 'active';
  const taskNavigationTitle = backgroundTaskActivity.unreadCount
    ? `任务与交付 · ${backgroundTaskActivity.unreadCount} 个任务已完成`
    : backgroundTaskActivity.attentionCount
      ? `任务与交付 · ${backgroundTaskActivity.attentionCount} 个任务需要处理`
      : backgroundTaskActivity.activeCount
        ? `任务与交付 · ${backgroundTaskActivity.activeCount} 个任务处理中`
        : '任务与交付';
  const pageTitle = page === 'assistants'
      ? '助手模式'
      : page === 'chat' || page === 'chat-prototype'
        ? '私人工作助理'
          : page === 'project-workspace'
            ? '项目工作空间'
          : page === 'enterprise-overview'
            ? '企业智能中枢'
          : page === 'enterprise-management'
            ? '企业智能管理'
          : page === 'professional-tasks'
            ? '专业任务'
          : page === 'professional-deliverables'
            ? '成果中心'
          : page === 'history'
            ? '工作成果'
            : page === 'tasks'
              ? '我的任务'
            : page === 'knowledge'
              ? '我的资料'
              : page === 'skills'
                ? '能力中心'
                : page === 'workflows'
                  ? '工作流'
                : page === 'agent-hub'
                  ? 'Agent 市场'
                : page === 'learning'
                  ? '学习中心'
                  : page === 'models'
                    ? '设置'
                    : page === 'department-stats'
                      ? '部门数据'
                      : page === 'suggestions'
                        ? '帮助与反馈'
                        : page === 'governance'
                          ? '治理中心'
                          : page === 'audit'
                            ? '审计日志'
                          : '任务处理';

  const taskDeliveryTabs: WorkspaceTab[] = [
    { page: 'tasks', label: '我的任务' },
    { page: 'professional-tasks', label: '专业任务' },
    { page: 'professional-deliverables', label: '成果中心' },
    { page: 'history', label: '工作成果' },
  ];
  const aiCapabilityTabs: WorkspaceTab[] = [
    { page: 'assistants', label: '助手模式' },
    { page: 'workflows', label: '工作流' },
    { page: 'skills', label: '能力中心' },
    { page: 'agent-hub', label: 'Agent 市场' },
  ];
  const knowledgeLearningTabs: WorkspaceTab[] = [
    { page: 'knowledge', label: '我的资料' },
    { page: 'learning', label: '学习中心' },
  ];
  const enterpriseInsightTabs: WorkspaceTab[] = [
    { page: 'enterprise-overview', label: '企业智能中枢' },
    ...(canViewDepartmentStats ? [{ page: 'department-stats' as const, label: '部门数据' }] : []),
  ];
  const managementTabs: WorkspaceTab[] = [
    ...(isAdmin ? [{ page: 'governance' as const, label: '治理中心' }] : []),
    ...(canManageEnterprise ? [{ page: 'enterprise-management' as const, label: '企业智能管理' }] : []),
    ...(!isAdmin && canReadAudit ? [{ page: 'audit' as const, label: '审计日志' }] : []),
  ];
  const sectionNavigation = isTaskDeliveryPage
    ? { label: '任务与交付', tabs: taskDeliveryTabs }
    : isAiCapabilityPage
      ? { label: 'AI 能力', tabs: aiCapabilityTabs }
      : isKnowledgeLearningPage
        ? { label: '知识与学习', tabs: knowledgeLearningTabs }
        : isEnterpriseInsightPage
          ? { label: '企业洞察', tabs: enterpriseInsightTabs }
          : isManagementPage
            ? { label: '管理中心', tabs: managementTabs }
            : null;

  useEffect(() => {
    if (sidebarTouched) return;
    setSidebarMode(page === 'chat' || page === 'chat-prototype' || page === 'task' ? 'collapsed' : 'expanded');
  }, [page, sidebarTouched]);

  useEffect(() => {
    const restore = () => {
      const location = readWorkspaceLocation(window.location.search);
      setPage(location.page);
      setFocusSessionUuid(location.sessionUuid);
      setFocusProjectUuid(location.projectUuid);
      setFocusRunId(location.runId);
      setFocusArtifactId(location.artifactId);
      setFocusWorkflowId(location.workflowId);
      setFocusProfessionalDeliverableId(location.deliverableId);
      setFocusProfessionalVersionId(location.versionId);
      setHistoryTab(location.historyTab);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (page === 'task' || page === 'chat-prototype') return;
    const search = buildWorkspaceSearch({
      page,
      sessionUuid: focusSessionUuid,
      projectUuid: focusProjectUuid,
      runId: focusRunId,
      artifactId: focusArtifactId,
      workflowId: focusWorkflowId,
      deliverableId: focusProfessionalDeliverableId,
      versionId: focusProfessionalVersionId,
      historyTab,
    });
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;
    window.history.pushState({}, '', nextUrl);
  }, [
    focusArtifactId,
    focusProfessionalDeliverableId,
    focusProfessionalVersionId,
    focusProjectUuid,
    focusRunId,
    focusSessionUuid,
    focusWorkflowId,
    historyTab,
    page,
  ]);

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
    if (
      (page === 'department-stats' && !canViewDepartmentStats)
      || (page === 'suggestions' && !canSubmitSuggestion)
      || (page === 'governance' && !isAdmin)
      || (page === 'audit' && !canReadAudit)
    ) {
      setPage('chat');
    }
    if (!canManageEnterprise && page === 'enterprise-management') {
      setPage('chat');
    }
  }, [
    canManageEnterprise,
    canReadAudit,
    canSubmitSuggestion,
    canViewDepartmentStats,
    isAdmin,
    page,
  ]);

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
      await apiFetch('/api/ai/logout', {
        method: 'POST',
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
    clearDesktopSsoToken();
    window.location.assign(authLogoutUrl);
  };

  const availableSystems = Array.from(new Set([
    currentSystemKey,
    ...session.apps.map((app) => app.trim()).filter(Boolean),
  ]));

  return (
    <div className={`app-frame sidebar-${sidebarMode}`}>
      <aside className="sidebar">
        <div className="brand-mark" aria-label="聚信 AI 助手 · 私人工作助理">
          <img alt="" aria-hidden="true" src={juxinAiLogo} />
          <strong className="brand-label">聚信 AI 助手 · 私人工作助理</strong>
        </div>
        <nav aria-label="主导航" className="sidebar-main-nav">
          <button aria-label="对话" title="对话" aria-current={page === 'chat' ? 'page' : undefined} className={page === 'chat' ? 'is-current' : ''} onClick={() => setPage('chat')} type="button"><span className="nav-icon" aria-hidden="true">●</span><span className="nav-label">对话</span></button>
          <button aria-label="项目" title="项目" aria-current={page === 'project-workspace' ? 'page' : undefined} className={page === 'project-workspace' ? 'is-current' : ''} onClick={() => setPage('project-workspace')} type="button"><span className="nav-icon" aria-hidden="true">⌂</span><span className="nav-label">项目</span></button>
          <button aria-label="任务与交付" title={taskNavigationTitle} aria-current={isTaskDeliveryPage ? 'page' : undefined} className={isTaskDeliveryPage ? 'is-current' : ''} onClick={() => setPage('tasks')} type="button">
            <span className="nav-icon" aria-hidden="true">◆</span>
            <span className="nav-label">任务与交付</span>
            {taskIndicatorCount ? (
              <span aria-hidden="true" className={`nav-task-badge is-${taskIndicatorKind}`}>
                {taskIndicatorKind === 'attention' ? '!' : Math.min(taskIndicatorCount, 99)}
              </span>
            ) : null}
          </button>
          <button aria-label="AI 能力" title="AI 能力" aria-current={isAiCapabilityPage ? 'page' : undefined} className={isAiCapabilityPage ? 'is-current' : ''} onClick={() => setPage('assistants')} type="button"><span className="nav-icon" aria-hidden="true">✦</span><span className="nav-label">AI 能力</span></button>
          <button aria-label="知识与学习" title="知识与学习" aria-current={isKnowledgeLearningPage ? 'page' : undefined} className={isKnowledgeLearningPage ? 'is-current' : ''} onClick={() => setPage('knowledge')} type="button"><span className="nav-icon" aria-hidden="true">⌘</span><span className="nav-label">知识与学习</span></button>
          {canViewEnterprise ? <button aria-label="企业洞察" title="企业洞察" aria-current={isEnterpriseInsightPage ? 'page' : undefined} className={isEnterpriseInsightPage ? 'is-current' : ''} onClick={() => setPage('enterprise-overview')} type="button"><span className="nav-icon" aria-hidden="true">◉</span><span className="nav-label">企业洞察</span></button> : null}
        </nav>
        <nav aria-label="管理与设置" className="sidebar-utility-nav">
          {canManageEnterprise ? <button aria-label="管理中心" title="管理中心" aria-current={isManagementPage ? 'page' : undefined} className={isManagementPage ? 'is-current' : ''} onClick={() => setPage(isAdmin ? 'governance' : 'enterprise-management')} type="button"><span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-label">管理中心</span></button> : null}
          {!isAdmin && canReadAudit ? <button aria-label="审计日志" title="审计日志" aria-current={page === 'audit' ? 'page' : undefined} className={page === 'audit' ? 'is-current' : ''} onClick={() => setPage('audit')} type="button"><span className="nav-icon" aria-hidden="true">▤</span><span className="nav-label">审计日志</span></button> : null}
          <button aria-label="设置" title="设置" aria-current={page === 'models' ? 'page' : undefined} className={page === 'models' ? 'is-current' : ''} onClick={() => setPage('models')} type="button"><span className="nav-icon" aria-hidden="true">◇</span><span className="nav-label">设置</span></button>
          {canSubmitSuggestion ? <button aria-label="帮助与反馈" title="帮助与反馈" aria-current={page === 'suggestions' ? 'page' : undefined} className={page === 'suggestions' ? 'is-current' : ''} onClick={() => setPage('suggestions')} type="button"><span className="nav-icon" aria-hidden="true">?</span><span className="nav-label">帮助与反馈</span></button> : null}
        </nav>
        <div className="sidebar-foot">
          {capabilities.canUseAutoUpdater ? <WorkspaceUpdateControl /> : null}
          <span className="presence-dot" />
          <div>
            <strong>{session.user.username}</strong>
            <small>{session.scope.department || '聚信员工'}</small>
          </div>
          {isWebRuntime ? (
            <div className="system-switcher">
              <button
                aria-expanded={systemMenuOpen}
                aria-haspopup="menu"
                aria-label="切换系统"
                className="system-switch-button"
                onClick={() => setSystemMenuOpen((open) => !open)}
                type="button"
              >
                切换
              </button>
              {systemMenuOpen ? (
                <div aria-label="可访问系统" className="system-switch-menu" role="menu">
                  {availableSystems.length ? availableSystems.map((systemKey) => {
                    const current = systemKey === currentSystemKey;
                    const label = `${systemLabel(systemKey)}${current ? '（当前）' : ''}`;
                    return current ? (
                      <span aria-disabled="true" className="is-current" key={systemKey} role="menuitem">
                        {label}
                      </span>
                    ) : (
                      <a href={getAuthPortalUrl({ system: systemKey })} key={systemKey} role="menuitem">
                        {label}
                      </a>
                    );
                  }) : (
                    <span aria-disabled="true" role="menuitem">暂无其他可访问系统</span>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <button aria-label="退出登录" className="logout-button" onClick={() => void logout()} type="button">退出</button>
        </div>
      </aside>

      <main className="workspace-shell" id="workspace">
        <header className="workspace-topbar">
          <div className="workspace-titlebar">
            {page !== 'chat' ? (
              <button aria-label="返回对话" className="workspace-back-button" onClick={() => setPage('chat')} type="button">‹ 返回对话</button>
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
          {sectionNavigation && sectionNavigation.tabs.length > 1 ? (
            <nav aria-label={`${sectionNavigation.label}导航`} className="workspace-section-tabs">
              {sectionNavigation.tabs.map((tab) => (
                <button
                  aria-current={page === tab.page ? 'page' : undefined}
                  className={page === tab.page ? 'is-current' : ''}
                  key={tab.page}
                  onClick={() => setPage(tab.page)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          ) : null}
        {page === 'chat-prototype' ? (
          <ChatRunPrototypePage onBack={() => setPage('chat')} />
        ) : page === 'models' ? (
          <ModelProfilesPage />
        ) : page === 'project-workspace' ? (
          <ProjectWorkspacePage />
        ) : page === 'enterprise-overview' && canViewEnterprise ? (
          <EnterpriseOverviewPage />
        ) : page === 'enterprise-management' && canManageEnterprise ? (
          <EnterpriseManagementPage />
        ) : page === 'professional-tasks' ? (
          <ProfessionalTasksPage
            onOpenDeliverable={(deliverableId) => {
              setFocusProfessionalDeliverableId(deliverableId);
              setFocusProfessionalVersionId('');
              setPage('professional-deliverables');
            }}
          />
        ) : page === 'professional-deliverables' ? (
          <ProfessionalDeliverablesPage
            initialDeliverableId={focusProfessionalDeliverableId}
            initialVersionId={focusProfessionalVersionId}
            onLocationChange={({ deliverableId, versionId }) => {
              setFocusProfessionalDeliverableId(deliverableId);
              setFocusProfessionalVersionId(versionId);
            }}
          />
        ) : page === 'governance' && isAdmin ? (
          <GovernanceCenter session={session} />
        ) : page === 'audit' && canReadAudit ? (
          <AuditPage />
        ) : page === 'department-stats' && canViewDepartmentStats ? (
          <StatsPage manager />
        ) : page === 'suggestions' && canSubmitSuggestion ? (
          <SuggestionsPage departments={session.scope.managedDepartments} />
        ) : page === 'assistants' ? (
          <AssistantsPage onOpenTask={openTask} />
        ) : page === 'knowledge' ? (
          <KnowledgePage session={session} />
        ) : page === 'skills' ? (
          <SkillsPage />
        ) : page === 'workflows' ? (
          <WorkflowsPage
            initialWorkflowId={focusWorkflowId}
            onOpenTaskCenter={(runId) => {
              if (runId) setFocusRunId(runId);
              setPage('tasks');
            }}
          />
        ) : page === 'agent-hub' ? (
          <AgentHubPage isAdmin={isAdmin} />
        ) : page === 'learning' ? (
          <LearningPage isAdmin={isAdmin} />
        ) : page === 'history' ? (
          <HistoryPage
            initialTab={historyTab}
            focusAgentArtifactId={focusArtifactId}
            onOpenTask={(runId) => {
              setFocusRunId(runId);
              setPage('tasks');
            }}
          />
        ) : page === 'tasks' ? (
          <TasksPage
            initialRunId={focusRunId}
            onOpenChat={(conversationId) => {
              setFocusSessionUuid(conversationId || '');
              setPage('chat');
            }}
            onOpenArtifact={(artifactId) => {
              setFocusArtifactId(artifactId);
              setHistoryTab('agent');
              setPage('history');
            }}
            onOpenWorkflow={(workflowId) => {
              setFocusWorkflowId(workflowId);
              setPage('workflows');
            }}
          />
        ) : page === 'task' ? (
          <>
            {task
              ? <TaskRunPage task={task} userId={String(session.user.id)} />
              : <section className="desktop-required"><p>{taskError || '正在加载任务…'}</p></section>}
          </>
        ) : (
          <ChatPage
            initialProjectUuid={focusProjectUuid}
            initialSessionUuid={focusSessionUuid}
            onLocationChange={({ projectUuid, sessionUuid }) => {
              setFocusProjectUuid(projectUuid);
              setFocusSessionUuid(sessionUuid);
            }}
            onOpenTaskCenter={(runId) => {
              if (runId) setFocusRunId(runId);
              setPage('tasks');
            }}
            onOpenWorkArtifacts={() => {
              setHistoryTab('work');
              setPage('history');
            }}
          />
        )}
        </div>
      </main>
      <BackgroundTaskNotifier
        enabled={isWebRuntime}
        onActivityChange={setBackgroundTaskActivity}
        onOpenConversation={(conversationId) => {
          setFocusSessionUuid(conversationId);
          setPage('chat');
        }}
        onOpenTasks={() => setPage('tasks')}
        taskCenterOpen={page === 'tasks'}
      />
    </div>
  );
}

function StatusView({
  kind,
  bridge,
}: {
  kind: 'checking' | 'forbidden' | 'error';
  bridge: DesktopBridge;
}) {
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
      <h1>{forbidden ? '暂时无法进入 AI 助手' : '服务暂时不可用'}</h1>
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
            void bridge.closeWorkspace().catch(() => {
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

  const prototype = new URLSearchParams(window.location.search).get('prototype');
  if (prototype === 'chat') {
    return <ChatRunPrototypePage />;
  }

  return <RemoteWorkspace bridge={bridge} />;
}

function RemoteWorkspace({ bridge }: { bridge: DesktopBridge }) {
  const [state, setState] = useState<ViewState>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    getSession()
      .then(async (session) => {
        if (window.__TAURI_INTERNALS__) {
          await bridge.bindLocalSession(session.local_binding_token);
          await bridge.markWorkspaceReady();
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
          void bridge.reportWorkspaceStatus(
            kind === 'forbidden' ? 'forbidden' : 'network-error',
          ).catch(() => {
            window.location.assign(getAuthPortalUrl());
          });
        }
        setState({ kind });
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  return state.kind === 'ready'
    ? <Workspace session={state.session} />
    : <StatusView bridge={bridge} kind={state.kind} />;
}

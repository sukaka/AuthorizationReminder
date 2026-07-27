import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import {
  createProject,
  createProjectTask,
  getProject,
  listProjectActivities,
  listProjectDeliverables,
  listProjectIssues,
  listProjectTasks,
  listProjects,
  type ProjectActivityPayload,
  type ProjectDeliverablePayload,
  type ProjectDetailPayload,
  type ProjectIssuePayload,
  type ProjectPayload,
  type ProjectTaskPayload,
  updateProjectTaskStatus,
} from '../api/projects';
import { ProjectWorkspaceExtendedPanel, type ProjectWorkspaceExtendedTab } from '../components/ProjectWorkspaceExtendedPanel';

type ProjectTab = 'overview' | 'tasks' | 'deliverables' | 'issues' | 'activity' | ProjectWorkspaceExtendedTab;

const extendedTabs: ProjectWorkspaceExtendedTab[] = ['chat', 'initialization', 'knowledge', 'memory', 'members'];

function isExtendedTab(tab: ProjectTab): tab is ProjectWorkspaceExtendedTab {
  return extendedTabs.includes(tab as ProjectWorkspaceExtendedTab);
}

const tabLabels: Array<{ id: ProjectTab; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'tasks', label: '任务' },
  { id: 'deliverables', label: '交付物' },
  { id: 'issues', label: '问题' },
  { id: 'activity', label: '动态' },
  { id: 'chat', label: '项目对话' },
  { id: 'initialization', label: '项目初始化' },
  { id: 'knowledge', label: '资料与知识' },
  { id: 'memory', label: '项目记忆' },
  { id: 'members', label: '成员权限' },
];

const statusLabels: Record<string, string> = {
  active: '进行中',
  archived: '已归档',
  todo: '待处理',
  in_progress: '处理中',
  blocked: '已阻塞',
  done: '已完成',
  cancelled: '已取消',
  draft: '草稿',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已驳回',
  open: '待处理',
  resolved: '已解决',
  closed: '已关闭',
};

const priorityLabels: Record<string, string> = {
  low: '低优先级',
  normal: '普通',
  high: '高优先级',
  urgent: '紧急',
};

const severityLabels: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重',
};

const memberRoleLabels: Record<string, string> = {
  project_lead: '项目负责人',
  project_admin: '项目管理员',
  member: '成员',
  reviewer: '审核人',
  read_only: '只读成员',
  external_customer: '外部客户',
};

function statusLabel(value: string): string {
  return statusLabels[value] || value;
}

function severityLabel(value: string): string {
  return severityLabels[value] || value;
}

function memberRoleLabel(value: string): string {
  return memberRoleLabels[value] || value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function nextTaskStatus(status: string): { value: string; label: string } {
  if (status === 'todo') return { value: 'in_progress', label: '开始处理' };
  if (status === 'done') return { value: 'todo', label: '重新打开' };
  return { value: 'done', label: '标记完成' };
}

export function ProjectWorkspacePage() {
  const [projects, setProjects] = useState<ProjectPayload[]>([]);
  const [selectedProjectUuid, setSelectedProjectUuid] = useState('');
  const [project, setProject] = useState<ProjectDetailPayload | null>(null);
  const [tasks, setTasks] = useState<ProjectTaskPayload[]>([]);
  const [deliverables, setDeliverables] = useState<ProjectDeliverablePayload[]>([]);
  const [issues, setIssues] = useState<ProjectIssuePayload[]>([]);
  const [activities, setActivities] = useState<ProjectActivityPayload[]>([]);
  const [tab, setTab] = useState<ProjectTab>('overview');
  const [loading, setLoading] = useState(true);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [error, setError] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState('normal');
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectSubmitting, setProjectSubmitting] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setSelectedProjectUuid((current) => (
        current && nextProjects.some((item) => item.project_uuid === current)
          ? current
          : nextProjects[0]?.project_uuid || ''
      ));
    } catch {
      setError('项目列表暂时无法加载，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadProjectResources = useCallback(async (projectUuid: string) => {
    setResourceLoading(true);
    setError('');
    try {
      const [nextProject, nextTasks, nextDeliverables, nextIssues, nextActivities] = await Promise.all([
        getProject(projectUuid),
        listProjectTasks(projectUuid),
        listProjectDeliverables(projectUuid),
        listProjectIssues(projectUuid),
        listProjectActivities(projectUuid),
      ]);
      setProject(nextProject);
      setTasks(nextTasks);
      setDeliverables(nextDeliverables);
      setIssues(nextIssues);
      setActivities(nextActivities);
    } catch {
      setProject(null);
      setTasks([]);
      setDeliverables([]);
      setIssues([]);
      setActivities([]);
      setError('项目工作区暂时无法加载，请稍后重试。');
    } finally {
      setResourceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectUuid) void loadProjectResources(selectedProjectUuid);
    else setProject(null);
  }, [loadProjectResources, selectedProjectUuid]);

  const counts = useMemo(() => ({
    tasks: tasks.length,
    deliverables: deliverables.length,
    issues: issues.filter((item) => !['resolved', 'closed'].includes(item.status)).length,
    members: project?.members.length || 0,
  }), [deliverables.length, issues, project?.members.length, tasks.length]);

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectName.trim()) return;
    setProjectSubmitting(true);
    setError('');
    try {
      const created = await createProject({ name: projectName.trim(), description: projectDescription.trim() });
      setProjects((current) => [created, ...current]);
      setSelectedProjectUuid(created.project_uuid);
      setProjectName('');
      setProjectDescription('');
    } catch {
      setError('项目创建失败，请检查名称后重试。');
    } finally {
      setProjectSubmitting(false);
    }
  };

  const handleCreateTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProjectUuid || !taskTitle.trim()) return;
    setTaskSubmitting(true);
    setError('');
    try {
      const created = await createProjectTask(selectedProjectUuid, {
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        priority: taskPriority,
      });
      setTasks((current) => [created, ...current]);
      setTaskTitle('');
      setTaskDescription('');
      setTaskPriority('normal');
      setTab('tasks');
    } catch {
      setError('任务创建失败，请稍后重试。');
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleTaskStatus = async (task: ProjectTaskPayload) => {
    if (!selectedProjectUuid) return;
    const next = nextTaskStatus(task.status);
    try {
      const updated = await updateProjectTaskStatus(selectedProjectUuid, task.task_uuid, next.value);
      setTasks((current) => current.map((item) => item.task_uuid === updated.task_uuid ? updated : item));
    } catch {
      setError('任务状态更新失败，请稍后重试。');
    }
  };

  const renderTasks = () => (
    <div className="project-resource-stack">
      {tasks.length ? tasks.map((taskItem) => {
        const action = nextTaskStatus(taskItem.status);
        return (
          <article className="project-resource-row" key={taskItem.task_uuid}>
            <div className="project-resource-main">
              <div className="project-resource-heading">
                <strong>{taskItem.title}</strong>
                <span className={`project-status project-status-${taskItem.status}`}>{statusLabel(taskItem.status)}</span>
              </div>
              {taskItem.description ? <p>{taskItem.description}</p> : null}
              <small>{priorityLabels[taskItem.priority] || taskItem.priority} · 更新于 {formatDate(taskItem.updated_at)}</small>
            </div>
            <button aria-label={`${action.label} ${taskItem.title}`} className="project-secondary-button" onClick={() => void handleTaskStatus(taskItem)} type="button">
              {action.label}
            </button>
          </article>
        );
      }) : <p className="project-empty-state">还没有项目任务。先把下一步行动记下来。</p>}
    </div>
  );

  const renderDeliverables = () => (
    <div className="project-resource-stack">
      {deliverables.length ? deliverables.map((item) => (
        <article className="project-resource-row" key={item.deliverable_uuid}>
          <div className="project-resource-main">
            <div className="project-resource-heading">
              <strong>{item.title}</strong>
              <span className={`project-status project-status-${item.status}`}>{statusLabel(item.status)}</span>
            </div>
            <p>{item.content_summary || '暂无内容摘要'}</p>
            <small>{item.file_name || item.deliverable_type} · v{item.version}</small>
          </div>
        </article>
      )) : <p className="project-empty-state">项目还没有交付物。</p>}
    </div>
  );

  const renderIssues = () => (
    <div className="project-resource-stack">
      {issues.length ? issues.map((item) => (
        <article className="project-resource-row" key={item.issue_uuid}>
          <div className="project-resource-main">
            <div className="project-resource-heading">
              <strong>{item.title}</strong>
              <span className={`project-status project-status-${item.severity}`}>{severityLabel(item.severity)}</span>
            </div>
            <p>{item.description || '暂无问题描述'}</p>
            <small>{statusLabel(item.status)} · 创建于 {formatDate(item.created_at)}</small>
          </div>
        </article>
      )) : <p className="project-empty-state">当前没有待跟进问题。</p>}
    </div>
  );

  const renderActivity = () => (
    <div className="project-resource-stack">
      {activities.length ? activities.map((item) => (
        <article className="project-activity-row" key={item.activity_uuid}>
          <span className="project-activity-dot" aria-hidden="true" />
          <div>
            <strong>{item.summary}</strong>
            <small>{item.actor_user_id} · {formatDate(item.created_at)}</small>
          </div>
        </article>
      )) : <p className="project-empty-state">项目动态会显示在这里。</p>}
    </div>
  );

  if (loading) {
    return <section aria-busy="true" className="project-workspace-page"><p className="project-loading-state">正在加载项目工作空间…</p></section>;
  }

  return (
    <section aria-labelledby="project-workspace-title" className="project-workspace-page">
      <header className="project-workspace-header">
        <div>
          <span className="project-workspace-kicker">PROJECT WORKSPACE · 2.0</span>
          <h1 id="project-workspace-title">项目工作空间</h1>
          <p>把项目背景、任务、交付物和协作动态放在同一个可持续工作的上下文里。</p>
        </div>
        <form aria-label="创建项目" className="project-create-form" onSubmit={(event) => void handleCreateProject(event)}>
          <label>
            <span>新项目名称</span>
            <input aria-label="新项目名称" onChange={(event) => setProjectName(event.target.value)} placeholder="例如：星河交付项目" value={projectName} />
          </label>
          <div className="project-create-form-row">
            <input aria-label="项目描述" onChange={(event) => setProjectDescription(event.target.value)} placeholder="一句话说明项目目标" value={projectDescription} />
            <button className="project-primary-button" disabled={projectSubmitting || !projectName.trim()} type="submit">{projectSubmitting ? '创建中…' : '创建项目'}</button>
          </div>
        </form>
      </header>

      {error ? <p aria-live="polite" className="project-error-banner">{error}</p> : null}

      {!projects.length ? (
        <div className="project-no-projects">
          <span className="project-empty-mark" aria-hidden="true">＋</span>
          <h2>先创建一个项目工作区</h2>
          <p>项目成立后，聊天、任务、资料和交付记录可以围绕同一个目标持续累积。</p>
        </div>
      ) : (
        <div className="project-workspace-layout">
          <aside aria-label="项目列表" className="project-project-rail">
            <div className="project-rail-heading">
              <span>我的项目</span>
              <span>{projects.length}</span>
            </div>
            <div className="project-project-list">
              {projects.map((item) => (
                <button className={`project-project-card ${selectedProjectUuid === item.project_uuid ? 'is-selected' : ''}`} key={item.project_uuid} onClick={() => setSelectedProjectUuid(item.project_uuid)} type="button">
                  <span className="project-project-avatar">{item.name.slice(0, 1)}</span>
                  <span className="project-project-copy">
                    <strong>{item.name}</strong>
                    <small>{statusLabel(item.status)} · {formatDate(item.updated_at)}</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="project-workspace-content">
            {project ? (
              <>
                <header className="project-project-header">
                  <div>
                    <span className="project-workspace-kicker">当前项目</span>
                    <h2>{project.name}</h2>
                    <p>{project.description || '还没有项目描述，先从一次项目对话开始。'}</p>
                  </div>
                  <span className={`project-status project-status-${project.status}`}>{statusLabel(project.status)}</span>
                </header>

                <div className="project-stat-strip" aria-label="项目摘要">
                  <div><strong>{counts.tasks}</strong><span>任务</span></div>
                  <div><strong>{counts.deliverables}</strong><span>交付物</span></div>
                  <div><strong>{counts.issues}</strong><span>待跟进问题</span></div>
                  <div><strong>{counts.members}</strong><span>项目成员</span></div>
                </div>

                <nav aria-label="项目资源视图" className="project-workspace-tabs">
                  {tabLabels.map((item) => (
                    <button aria-selected={tab === item.id} className={tab === item.id ? 'is-selected' : ''} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">{item.label}</button>
                  ))}
                </nav>

                <div aria-live="polite" className="project-resource-panel">
                  {resourceLoading ? <p className="project-loading-state">正在同步项目资源…</p> : null}
                  {!resourceLoading && tab === 'overview' ? (
                    <div className="project-overview-grid">
                      <section className="project-overview-card">
                        <span className="project-card-kicker">下一步行动</span>
                        <h3>下一步行动</h3>
                        {tasks.slice(0, 3).map((item) => <p key={item.task_uuid}><span className={`project-status project-status-${item.status}`}>{statusLabel(item.status)}</span>{item.title}</p>)}
                        {!tasks.length ? <p className="project-empty-inline">暂无任务</p> : null}
                      </section>
                      <section className="project-overview-card">
                        <span className="project-card-kicker">项目成员</span>
                        <h3>协作成员</h3>
                        {project.members.slice(0, 4).map((member) => <p key={member.member_uuid}><span className="project-member-dot" />{member.username || `账号 ${member.user_id}`}<small>{memberRoleLabel(member.role)}</small></p>)}
                        {!project.members.length ? <p className="project-empty-inline">暂无成员</p> : null}
                      </section>
                    </div>
                  ) : null}
                  {!resourceLoading && tab === 'tasks' ? renderTasks() : null}
                  {!resourceLoading && tab === 'deliverables' ? renderDeliverables() : null}
                  {!resourceLoading && tab === 'issues' ? renderIssues() : null}
                  {!resourceLoading && tab === 'activity' ? renderActivity() : null}
                  {!resourceLoading && isExtendedTab(tab) ? (
                    <ProjectWorkspaceExtendedPanel key={selectedProjectUuid} activeTab={tab} projectUuid={selectedProjectUuid} />
                  ) : null}
                </div>

                <form aria-label="创建项目任务" className="project-create-task" onSubmit={(event) => void handleCreateTask(event)}>
                  <div>
                    <span className="project-card-kicker">QUICK CAPTURE</span>
                    <strong>记下一项项目行动</strong>
                  </div>
                  <input aria-label="任务标题" onChange={(event) => setTaskTitle(event.target.value)} placeholder="任务标题" value={taskTitle} />
                  <select aria-label="任务优先级" onChange={(event) => setTaskPriority(event.target.value)} value={taskPriority}>
                    <option value="low">低优先级</option>
                    <option value="normal">普通</option>
                    <option value="high">高优先级</option>
                    <option value="urgent">紧急</option>
                  </select>
                  <button className="project-primary-button" disabled={taskSubmitting || !taskTitle.trim()} type="submit">{taskSubmitting ? '保存中…' : '添加任务'}</button>
                  <textarea aria-label="任务描述" onChange={(event) => setTaskDescription(event.target.value)} placeholder="补充说明（可选）" value={taskDescription} />
                </form>
              </>
            ) : <p className="project-loading-state">正在打开项目…</p>}
          </div>
        </div>
      )}
    </section>
  );
}

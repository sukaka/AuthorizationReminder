export const WORKSPACE_PAGES = [
  'assistants',
  'chat',
  'project-workspace',
  'enterprise-overview',
  'enterprise-management',
  'professional-tasks',
  'professional-deliverables',
  'history',
  'tasks',
  'knowledge',
  'skills',
  'workflows',
  'agent-hub',
  'learning',
  'models',
  'governance',
  'audit',
  'department-stats',
  'suggestions',
] as const;

export type NavigableWorkspacePage = typeof WORKSPACE_PAGES[number];
export type HistoryLocationTab = 'work' | 'agent';

export type WorkspaceLocation = {
  page: NavigableWorkspacePage;
  sessionUuid: string;
  projectUuid: string;
  runId: string;
  artifactId: string;
  workflowId: string;
  deliverableId: string;
  versionId: string;
  historyTab: HistoryLocationTab;
};

const PAGE_SET = new Set<string>(WORKSPACE_PAGES);
const MAX_ID_LENGTH = 128;

function readId(params: URLSearchParams, key: string): string {
  return (params.get(key) || '').trim().slice(0, MAX_ID_LENGTH);
}

export function readWorkspaceLocation(search: string): WorkspaceLocation {
  const params = new URLSearchParams(search);
  const requestedPage = params.get('page') || '';
  const sessionUuid = readId(params, 'session');
  const projectUuid = readId(params, 'project');
  const runId = readId(params, 'run');
  const artifactId = readId(params, 'artifact');
  const workflowId = readId(params, 'workflow');
  const deliverableId = readId(params, 'deliverable');
  const versionId = readId(params, 'version');
  const requestedTab = params.get('tab');
  const historyTab: HistoryLocationTab = requestedTab === 'agent' || artifactId ? 'agent' : 'work';

  let page: NavigableWorkspacePage = PAGE_SET.has(requestedPage)
    ? requestedPage as NavigableWorkspacePage
    : 'chat';
  if (!requestedPage) {
    if (runId) page = 'tasks';
    else if (artifactId) page = 'history';
    else if (workflowId) page = 'workflows';
    else if (deliverableId) page = 'professional-deliverables';
  }

  return {
    page,
    sessionUuid,
    projectUuid,
    runId,
    artifactId,
    workflowId,
    deliverableId,
    versionId,
    historyTab,
  };
}

export function buildWorkspaceSearch(location: WorkspaceLocation): string {
  const params = new URLSearchParams();
  if (location.page !== 'chat') params.set('page', location.page);

  if (location.page === 'chat') {
    if (location.sessionUuid) params.set('session', location.sessionUuid);
    if (location.projectUuid) params.set('project', location.projectUuid);
  } else if (location.page === 'tasks' && location.runId) {
    params.set('run', location.runId);
  } else if (location.page === 'history') {
    if (location.historyTab === 'agent') params.set('tab', 'agent');
    if (location.artifactId) params.set('artifact', location.artifactId);
  } else if (location.page === 'workflows' && location.workflowId) {
    params.set('workflow', location.workflowId);
  } else if (location.page === 'professional-deliverables' && location.deliverableId) {
    params.set('deliverable', location.deliverableId);
    if (location.versionId) params.set('version', location.versionId);
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

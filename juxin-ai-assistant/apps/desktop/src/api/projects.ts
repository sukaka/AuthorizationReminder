import { ApiError, apiFetch, getAuthPortalUrl } from './client';

export type ProjectPayload = {
  project_uuid: string;
  name: string;
  description: string;
  status: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
};

export type ProjectMemberPayload = {
  member_uuid: string;
  user_id: string;
  role: string;
  status: string;
  invited_by: string;
  created_at: string;
};

export type ProjectDetailPayload = ProjectPayload & {
  members: ProjectMemberPayload[];
};

export type ProjectTaskPayload = {
  task_uuid: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_user_id: string;
  due_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ProjectDeliverablePayload = {
  deliverable_uuid: string;
  task_uuid: string;
  title: string;
  deliverable_type: string;
  status: string;
  content_summary: string;
  file_name: string;
  version: number;
  submitted_by: string;
  approved_by: string;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ProjectIssuePayload = {
  issue_uuid: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  assignee_user_id: string;
  resolution: string;
  created_by: string;
  resolved_by: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectActivityPayload = {
  activity_uuid: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_uuid: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

async function readJson<T>(response: Response, errorCode = 'PROJECTS_FAILED'): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) throw new ApiError(response.status, errorCode, payload);
  return payload as T;
}

export async function listProjects(): Promise<ProjectPayload[]> {
  return readJson(await apiFetch('/api/ai/projects', { cache: 'no-store' }), 'PROJECTS_LIST_FAILED');
}

export async function createProject(payload: { name: string; description: string }): Promise<ProjectPayload> {
  return readJson(await apiFetch('/api/ai/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }), 'PROJECT_CREATE_FAILED');
}

export async function getProject(projectUuid: string): Promise<ProjectDetailPayload> {
  return readJson(await apiFetch(`/api/ai/projects/${projectUuid}`, { cache: 'no-store' }), 'PROJECT_DETAIL_FAILED');
}

export async function listProjectTasks(projectUuid: string): Promise<ProjectTaskPayload[]> {
  return readJson(await apiFetch(`/api/ai/projects/${projectUuid}/tasks`, { cache: 'no-store' }), 'PROJECT_TASKS_FAILED');
}

export async function createProjectTask(
  projectUuid: string,
  payload: {
    title: string;
    description: string;
    priority: string;
    assignee_user_id?: string;
    due_at?: string | null;
  },
): Promise<ProjectTaskPayload> {
  return readJson(await apiFetch(`/api/ai/projects/${projectUuid}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }), 'PROJECT_TASK_CREATE_FAILED');
}

export async function updateProjectTaskStatus(
  projectUuid: string,
  taskUuid: string,
  status: string,
): Promise<ProjectTaskPayload> {
  return readJson(await apiFetch(`/api/ai/projects/${projectUuid}/tasks/${taskUuid}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }), 'PROJECT_TASK_STATUS_FAILED');
}

export async function listProjectDeliverables(projectUuid: string): Promise<ProjectDeliverablePayload[]> {
  return readJson(await apiFetch(`/api/ai/projects/${projectUuid}/deliverables`, { cache: 'no-store' }), 'PROJECT_DELIVERABLES_FAILED');
}

export async function listProjectIssues(projectUuid: string): Promise<ProjectIssuePayload[]> {
  return readJson(await apiFetch(`/api/ai/projects/${projectUuid}/issues`, { cache: 'no-store' }), 'PROJECT_ISSUES_FAILED');
}

export async function listProjectActivities(projectUuid: string): Promise<ProjectActivityPayload[]> {
  return readJson(await apiFetch(`/api/ai/projects/${projectUuid}/activities`, { cache: 'no-store' }), 'PROJECT_ACTIVITIES_FAILED');
}

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

export type ProjectInitializationPayload = {
  project_uuid: string;
  initialization_complete: boolean;
  counts: Record<string, number>;
};

export type ProjectContractPayload = {
  contract_uuid: string;
  name: string;
  contract_no: string;
  customer_name: string;
  source_file_uuid: string | null;
  extraction_status: string;
  extracted_payload: Record<string, unknown>;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectServiceScopePayload = {
  scope_uuid: string;
  contract_uuid: string | null;
  name: string;
  category: string;
  description: string;
  frequency: string;
  deliverable: string;
  acceptance_criteria: string;
  status: string;
  confirmation_status: string;
  current_version: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectScopeVersionPayload = {
  version_uuid: string;
  scope_uuid: string;
  version: number;
  snapshot_json: Record<string, unknown>;
  change_summary: string;
  created_by: string;
  created_at: string;
};

export type ProjectSystemPayload = {
  system_uuid: string;
  name: string;
  system_type: string;
  department: string;
  owner: string;
  deployment: string;
  criticality: string;
  internet_exposed: boolean;
  in_scope: boolean;
  status: string;
  confirmation_status: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type ProjectAssetPayload = {
  asset_uuid: string;
  business_system_uuid: string | null;
  name: string;
  asset_type: string;
  identifier: string;
  network_location: string;
  purpose: string;
  owner: string;
  operating_system: string;
  vendor_model: string;
  criticality: string;
  in_scope: boolean;
  status: string;
  confirmation_status: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type ProjectTargetGroupPayload = {
  group_uuid: string;
  name: string;
  group_type: string;
  description: string;
  selection_rule: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProjectServiceTargetPayload = {
  target_uuid: string;
  scope_uuid: string | null;
  target_group_uuid: string | null;
  target_type: string;
  target_value: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProjectExecutionRulePayload = {
  rule_uuid: string;
  scope_uuid: string | null;
  target_group_uuid: string | null;
  frequency: string;
  first_execution_date: string | null;
  execution_day: string;
  time_window: string;
  responsible_user_id: string;
  collaborator_user_ids: string[];
  customer_contact: string;
  material_due_rule: string;
  template_name: string;
  skill_name: string;
  deliverable_type: string;
  due_rule: string;
  reviewer_user_id: string;
  acceptance_criteria: string;
  allow_ai_execution: boolean;
  needs_approval: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProjectMemoryPayload = {
  memory_uuid: string;
  memory_type: string;
  title: string;
  content: string;
  priority: number;
  tags: string[];
  status: string;
  source: string;
  confirmation_status: string;
  created_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectFilePayload = {
  file_uuid: string;
  project_file_uuid: string;
  file_name: string;
  file_type: string;
  category: string;
  summary: string;
  status: string;
  linked_by: string;
  created_at: string;
};

export type ProjectArtifactPayload = {
  artifact_uuid: string;
  project_artifact_uuid: string;
  title: string;
  artifact_type: string;
  content_summary: string;
  file_name: string;
  status: string;
  linked_by: string;
  created_at: string;
};

export type ProjectSessionMovePayload = {
  session_uuid: string;
  project_uuid: string;
  kept_personal_copy: boolean;
  moved_attachment_count: number;
  moved_artifact_count: number;
  extracted_memory_count: number;
};

export type PersonalArtifactCopyPayload = {
  artifact_id: number;
  artifact_uuid: string;
  sanitized: boolean;
};

function projectPath(projectUuid: string, suffix: string): string {
  return `/api/ai/projects/${encodeURIComponent(projectUuid)}${suffix}`;
}

async function postJson<T>(path: string, payload: unknown, errorCode: string): Promise<T> {
  return readJson(await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }), errorCode);
}

async function deleteJson(path: string, errorCode: string): Promise<void> {
  const response = await apiFetch(path, { method: 'DELETE' });
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  if (!response.ok) throw new ApiError(response.status, errorCode);
}

export async function listProjectMembers(projectUuid: string): Promise<ProjectMemberPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/members'), { cache: 'no-store' }), 'PROJECT_MEMBERS_FAILED');
}

export async function addProjectMember(
  projectUuid: string,
  payload: { user_id: string; role: string },
): Promise<ProjectMemberPayload> {
  return postJson(projectPath(projectUuid, '/members'), payload, 'PROJECT_MEMBER_ADD_FAILED');
}

export async function updateProjectMember(
  projectUuid: string,
  memberUuid: string,
  role: string,
): Promise<ProjectMemberPayload> {
  return readJson(await apiFetch(projectPath(projectUuid, `/members/${encodeURIComponent(memberUuid)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  }), 'PROJECT_MEMBER_UPDATE_FAILED');
}

export async function removeProjectMember(projectUuid: string, memberUuid: string): Promise<void> {
  return deleteJson(projectPath(projectUuid, `/members/${encodeURIComponent(memberUuid)}`), 'PROJECT_MEMBER_REMOVE_FAILED');
}

export async function getProjectInitialization(projectUuid: string): Promise<ProjectInitializationPayload> {
  return readJson(await apiFetch(projectPath(projectUuid, '/initialization'), { cache: 'no-store' }), 'PROJECT_INITIALIZATION_FAILED');
}

export async function listProjectContracts(projectUuid: string): Promise<ProjectContractPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/contracts'), { cache: 'no-store' }), 'PROJECT_CONTRACTS_FAILED');
}

export async function createProjectContract(
  projectUuid: string,
  payload: { name: string; contract_no?: string; customer_name?: string; source_file_uuid?: string | null; extracted_payload?: Record<string, unknown> },
): Promise<ProjectContractPayload> {
  return postJson(projectPath(projectUuid, '/contracts'), payload, 'PROJECT_CONTRACT_CREATE_FAILED');
}

export async function confirmProjectContract(projectUuid: string, contractUuid: string): Promise<ProjectContractPayload> {
  return postJson(projectPath(projectUuid, `/contracts/${encodeURIComponent(contractUuid)}/confirm`), { change_summary: '' }, 'PROJECT_CONTRACT_CONFIRM_FAILED');
}

export async function listProjectServiceScopes(projectUuid: string): Promise<ProjectServiceScopePayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/service-scopes'), { cache: 'no-store' }), 'PROJECT_SERVICE_SCOPES_FAILED');
}

export async function createProjectServiceScope(
  projectUuid: string,
  payload: { name: string; category?: string; description?: string; frequency?: string; deliverable?: string; acceptance_criteria?: string; contract_uuid?: string | null },
): Promise<ProjectServiceScopePayload> {
  return postJson(projectPath(projectUuid, '/service-scopes'), payload, 'PROJECT_SERVICE_SCOPE_CREATE_FAILED');
}

export async function confirmProjectServiceScope(projectUuid: string, scopeUuid: string): Promise<ProjectServiceScopePayload> {
  return postJson(projectPath(projectUuid, `/service-scopes/${encodeURIComponent(scopeUuid)}/confirm`), { change_summary: '' }, 'PROJECT_SERVICE_SCOPE_CONFIRM_FAILED');
}

export async function createProjectScopeVersion(
  projectUuid: string,
  scopeUuid: string,
  payload: { change_summary?: string; snapshot_json?: Record<string, unknown> },
): Promise<ProjectScopeVersionPayload> {
  return postJson(projectPath(projectUuid, `/service-scopes/${encodeURIComponent(scopeUuid)}/versions`), payload, 'PROJECT_SERVICE_SCOPE_VERSION_CREATE_FAILED');
}

export async function listProjectSystems(projectUuid: string): Promise<ProjectSystemPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/systems'), { cache: 'no-store' }), 'PROJECT_SYSTEMS_FAILED');
}

export async function createProjectSystem(projectUuid: string, payload: { name: string; system_type?: string; owner?: string; department?: string }): Promise<ProjectSystemPayload> {
  return postJson(projectPath(projectUuid, '/systems'), payload, 'PROJECT_SYSTEM_CREATE_FAILED');
}

export async function listProjectAssets(projectUuid: string): Promise<ProjectAssetPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/assets'), { cache: 'no-store' }), 'PROJECT_ASSETS_FAILED');
}

export async function createProjectAsset(projectUuid: string, payload: { name: string; asset_type?: string; identifier?: string; business_system_uuid?: string | null }): Promise<ProjectAssetPayload> {
  return postJson(projectPath(projectUuid, '/assets'), payload, 'PROJECT_ASSET_CREATE_FAILED');
}

export async function listProjectTargetGroups(projectUuid: string): Promise<ProjectTargetGroupPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/target-groups'), { cache: 'no-store' }), 'PROJECT_TARGET_GROUPS_FAILED');
}

export async function createProjectTargetGroup(projectUuid: string, payload: { name: string; group_type?: string; description?: string }): Promise<ProjectTargetGroupPayload> {
  return postJson(projectPath(projectUuid, '/target-groups'), payload, 'PROJECT_TARGET_GROUP_CREATE_FAILED');
}

export async function listProjectServiceTargets(projectUuid: string): Promise<ProjectServiceTargetPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/service-targets'), { cache: 'no-store' }), 'PROJECT_SERVICE_TARGETS_FAILED');
}

export async function createProjectServiceTarget(projectUuid: string, payload: { target_type: string; target_value?: string; scope_uuid?: string | null; target_group_uuid?: string | null }): Promise<ProjectServiceTargetPayload> {
  return postJson(projectPath(projectUuid, '/service-targets'), payload, 'PROJECT_SERVICE_TARGET_CREATE_FAILED');
}

export async function listProjectExecutionRules(projectUuid: string): Promise<ProjectExecutionRulePayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/execution-rules'), { cache: 'no-store' }), 'PROJECT_EXECUTION_RULES_FAILED');
}

export async function createProjectExecutionRule(projectUuid: string, payload: { frequency?: string; deliverable_type?: string; needs_approval?: boolean; scope_uuid?: string | null; target_group_uuid?: string | null }): Promise<ProjectExecutionRulePayload> {
  return postJson(projectPath(projectUuid, '/execution-rules'), payload, 'PROJECT_EXECUTION_RULE_CREATE_FAILED');
}

export async function listProjectMemories(projectUuid: string): Promise<ProjectMemoryPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/memories'), { cache: 'no-store' }), 'PROJECT_MEMORIES_FAILED');
}

export async function createProjectMemory(projectUuid: string, payload: { memory_type: string; title: string; content: string; priority?: number; tags?: string[]; source?: 'human' | 'ai_suggestion' | 'conversation_migration' }): Promise<ProjectMemoryPayload> {
  return postJson(projectPath(projectUuid, '/memories'), payload, 'PROJECT_MEMORY_CREATE_FAILED');
}

export async function confirmProjectMemory(projectUuid: string, memoryUuid: string): Promise<ProjectMemoryPayload> {
  return postJson(projectPath(projectUuid, `/memories/${encodeURIComponent(memoryUuid)}/confirm`), { change_summary: '' }, 'PROJECT_MEMORY_CONFIRM_FAILED');
}

export async function listProjectFiles(projectUuid: string): Promise<ProjectFilePayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/files'), { cache: 'no-store' }), 'PROJECT_FILES_FAILED');
}

export async function linkProjectFile(projectUuid: string, fileUuid: string): Promise<ProjectFilePayload> {
  return postJson(projectPath(projectUuid, `/files/${encodeURIComponent(fileUuid)}`), {}, 'PROJECT_FILE_LINK_FAILED');
}

export async function listProjectArtifacts(projectUuid: string): Promise<ProjectArtifactPayload[]> {
  return readJson(await apiFetch(projectPath(projectUuid, '/artifacts'), { cache: 'no-store' }), 'PROJECT_ARTIFACTS_FAILED');
}

export async function linkProjectArtifact(projectUuid: string, artifactUuid: string): Promise<ProjectArtifactPayload> {
  return postJson(projectPath(projectUuid, `/artifacts/${encodeURIComponent(artifactUuid)}`), {}, 'PROJECT_ARTIFACT_LINK_FAILED');
}

export async function moveProjectSession(
  projectUuid: string,
  sessionUuid: string,
  payload: {
    move_attachments?: boolean;
    move_artifacts?: boolean;
    extract_project_memory?: boolean;
    keep_personal_copy?: boolean;
    memory_drafts?: Array<{ memory_type: string; title: string; content: string; priority?: number; tags?: string[] }>;
  },
): Promise<ProjectSessionMovePayload> {
  return postJson(projectPath(projectUuid, `/sessions/${encodeURIComponent(sessionUuid)}/move`), payload, 'PROJECT_SESSION_MOVE_FAILED');
}

export async function copyProjectArtifactToPersonal(
  projectUuid: string,
  artifactUuid: string,
  payload: { sanitized_title: string; sanitized_content_summary: string },
): Promise<PersonalArtifactCopyPayload> {
  return postJson(projectPath(projectUuid, `/artifacts/${encodeURIComponent(artifactUuid)}/copy-to-personal`), payload, 'PROJECT_ARTIFACT_COPY_FAILED');
}

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

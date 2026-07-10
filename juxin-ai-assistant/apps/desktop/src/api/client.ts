import { isDesktopRuntime } from '../runtime/capabilities';
import { downloadBlobFromResponse, saveWordBytesToDesktop } from '../runtime/downloads';

export type SessionPayload = {
  user: {
    id: string | number;
    username: string;
    role: string;
  };
  scope: {
    department: string | null;
    managedDepartments: string[];
  };
  apps: string[];
  local_binding_token: string;
};

export type TaskFieldPayload = {
  field_key: string;
  label: string;
  field_type:
    | 'TEXT'
    | 'TEXTAREA'
    | 'SELECT'
    | 'MULTISELECT'
    | 'DATE'
    | 'NUMBER'
    | 'SWITCH'
    | 'FILE_RESERVED';
  required: boolean;
  placeholder?: string;
  example?: string;
  options: string[];
  validation: Record<string, unknown>;
};

export type TaskPayload = {
  uuid: string;
  code: string;
  name: string;
  description: string;
  output_format: string;
  safety_notice: string;
  fields: TaskFieldPayload[];
};

export type AssistantPayload = {
  uuid: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  tasks: TaskPayload[];
};

export type CatalogPayload = {
  assistants: AssistantPayload[];
};

export type TaskCardPayload = {
  task_uuid: string;
  task_code: string;
  task_name: string;
  description: string;
  assistant_code: string;
  assistant_name: string;
  last_used_at?: string | null;
};

export type HistoryItemPayload = {
  uuid: string;
  task_uuid: string;
  task_name: string;
  assistant_code: string;
  assistant_name: string;
  status: string;
  model_display_name: string;
  model_id: string;
  prompt_version: number;
  latency_ms?: number | null;
  usage: Record<string, unknown>;
  created_at: string;
  finished_at?: string | null;
};

export type HistoryDetailPayload = HistoryItemPayload & {
  parent_generation_uuid?: string | null;
  input: Record<string, unknown>;
  output?: string | null;
  knowledge_refs: Array<Record<string, unknown>>;
};

export type WorkArtifactSourcePayload = {
  source_type: string;
  file_name: string;
  page_number?: number | null;
  section_title?: string;
};

export type WorkArtifactItemPayload = {
  artifact_uuid: string;
  conversation_id: string;
  message_id: string;
  title: string;
  artifact_type: string;
  source_scope: string;
  source_summary: WorkArtifactSourcePayload[];
  content_summary: string;
  file_name: string;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type WorkArtifactVersionPayload = {
  version_uuid: string;
  version: number;
  source: string;
  source_ref: string;
  file_name: string;
  source_summary: WorkArtifactSourcePayload[];
  content_summary: string;
  created_at: string;
};

export type WorkArtifactDetailPayload = WorkArtifactItemPayload & {
  content?: string | null;
  download_url?: string | null;
  versions: WorkArtifactVersionPayload[];
};

export type HomePayload = {
  favorites: TaskCardPayload[];
  recent_tasks: TaskCardPayload[];
  recent_generations: HistoryItemPayload[];
  safety_reminders: string[];
};

export type SkillPayload = {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  status: string;
  scope: string;
  owner: string;
  requires_attachment: boolean;
  allowed_tools: string[];
  input_types: string[];
  output_types: string[];
  permissions: {
    allow_web: boolean;
    allow_company_knowledge: boolean;
    allow_personal_memory: boolean;
    allow_write_company_kb: boolean;
  };
  review: {
    required_for_publish: boolean;
    reviewer_role: string;
  };
  tags: string[];
};

export type SkillRunPayload = {
  run_id: string;
  skill_id: string;
  skill_version: string;
  status: string;
  tools_used: string[];
  result: Record<string, unknown>;
  artifacts: Array<{ kind: string; title: string; content: string }>;
};

export type LearningMemoryPayload = {
  uuid: string;
  memory_type: string;
  title: string;
  content: string;
  source: string;
  priority: 'high' | 'medium' | 'low' | string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
};

export type LearningExperiencePayload = {
  uuid: string;
  task_type: string;
  title: string;
  question: string;
  answer: string;
  summary: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
};

export type LearningTemplatePayload = {
  uuid: string;
  template_name: string;
  task_type: string;
  template_content: string;
  variables: Record<string, unknown>;
  scope: string;
  review_status: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type LearningFailureCasePayload = {
  uuid: string;
  task_type: string;
  wrong_answer: string;
  correction: string;
  prevention_rule: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
};

export type LearningFeedbackPayload = {
  uuid: string;
  conversation_id: string;
  message_id: string;
  feedback_type: 'useful' | 'not_useful' | 'needs_revision' | 'save_experience' | 'save_template' | 'record_error' | string;
  comment: string;
  saved_as: string;
  created_at: string;
};

export type AttachmentPayload = {
  attachment_uuid: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: string;
  extracted_characters: number;
};

export type IntentCandidatePayload = {
  task_uuid: string;
  task_code: string;
  task_name: string;
  assistant_name: string;
  score: number;
  reasons: string[];
};

export type IntentSkillCandidatePayload = {
  skill_id: string;
  skill_name: string;
  description: string;
  score: number;
  reasons: string[];
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message);
  }
}

const DESKTOP_SSO_TOKEN_KEY = 'juxin_ai_assistant_sso_token';
const DESKTOP_SSO_CALLBACK_PARAMS = ['sso_token', 'portal_session'];

export function clearSsoCallbackParams(): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    DESKTOP_SSO_CALLBACK_PARAMS.forEach((param) => {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    });
    if (changed) {
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // Ignore malformed runtime URLs.
  }
}

function readDesktopSsoToken(): string {
  if (!isDesktopRuntime()) return '';
  try {
    const url = new URL(window.location.href);
    const handoffToken = String(url.searchParams.get('sso_token') || '').trim();
    if (handoffToken) {
      sessionStorage.setItem(DESKTOP_SSO_TOKEN_KEY, handoffToken);
      clearSsoCallbackParams();
      return handoffToken;
    }
    return String(sessionStorage.getItem(DESKTOP_SSO_TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}

function apiHeaders(headers?: HeadersInit): HeadersInit | undefined {
  const token = readDesktopSsoToken();
  if (!token) return headers;
  const next = new Headers(headers);
  if (token && !next.has('Authorization')) {
    next.set('Authorization', `Bearer ${token}`);
  }
  return next;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? 'include',
    headers: apiHeaders(init.headers),
  });
}

async function readJson<T>(response: Response, code: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) {
    throw new ApiError(response.status, code, payload);
  }
  return payload as T;
}

type AuthPortalUrlOptions = {
  logout?: boolean;
  system?: string;
};

function formatAuthPortalUrl(url: URL, options: AuthPortalUrlOptions): string {
  if (options.system) {
    url.searchParams.set('system', options.system);
  }
  if (options.logout) {
    url.searchParams.set('logout', '1');
  }
  return url.toString();
}

export function getAuthPortalUrl(options: AuthPortalUrlOptions = {}): string {
  if (
    isDesktopRuntime() &&
    typeof window.__JUXIN_DESKTOP_AUTH_PORTAL__ === 'string'
  ) {
    try {
      const portal = new URL(window.__JUXIN_DESKTOP_AUTH_PORTAL__);
      const isLoopback =
        portal.hostname === 'localhost' ||
        portal.hostname === '127.0.0.1' ||
        portal.hostname === '[::1]';
      const isSafeScheme =
        portal.protocol === 'https:' ||
        (import.meta.env.DEV && portal.protocol === 'http:' && isLoopback);
      if (
        isSafeScheme &&
        !portal.username &&
        !portal.password &&
        !portal.hash
      ) {
        return formatAuthPortalUrl(portal, options);
      }
    } catch {
      // Fall back to the build-time portal below.
    }
  }
  const authUrl = import.meta.env.VITE_AUTH_PUBLIC_URL || (
    isDesktopRuntime() ? 'http://localhost:5180' : window.location.origin
  );
  const portal = new URL(`${authUrl.replace(/\/$/, '')}/portal`);
  portal.searchParams.set('system', options.system || 'ai-assistant');
  return formatAuthPortalUrl(portal, options);
}

export async function getSession(): Promise<SessionPayload> {
  const response = await apiFetch('/api/ai/session');
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  return readJson<SessionPayload>(response, `SESSION_${response.status}`);
}

export async function getCatalog(query = ''): Promise<CatalogPayload> {
  const search = query ? `?query=${encodeURIComponent(query)}` : '';
  return readJson<CatalogPayload>(
    await apiFetch(`/api/ai/catalog${search}`),
    'CATALOG_FAILED',
  );
}

export async function getHome(): Promise<HomePayload> {
  return readJson<HomePayload>(
    await apiFetch('/api/ai/home'),
    'HOME_FAILED',
  );
}

export async function listSkills(): Promise<{ items: SkillPayload[]; total: number }> {
  return readJson(
    await apiFetch('/api/skills', { cache: 'no-store' }),
    'SKILLS_FAILED',
  );
}

export async function listSkillRuns(): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  return readJson(
    await apiFetch('/api/skills/runs', { cache: 'no-store' }),
    'SKILL_RUNS_FAILED',
  );
}

export async function runSkill(
  skillId: string,
  payload: { task_id?: string; input: Record<string, unknown> },
): Promise<SkillRunPayload> {
  return readJson(
    await apiFetch(`/api/skills/${encodeURIComponent(skillId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'SKILL_RUN_FAILED',
  );
}

export async function listLearningMemories(status = 'active'): Promise<{ items: LearningMemoryPayload[]; total: number }> {
  return readJson(
    await apiFetch(`/api/learning/memories?status=${encodeURIComponent(status)}`, { cache: 'no-store' }),
    'LEARNING_MEMORIES_FAILED',
  );
}

export async function createLearningMemory(payload: {
  memory_type: string;
  title: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
}): Promise<LearningMemoryPayload> {
  return readJson(
    await apiFetch('/api/learning/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_MEMORY_CREATE_FAILED',
  );
}

export async function updateLearningMemory(
  memoryId: string,
  payload: Partial<Pick<LearningMemoryPayload, 'memory_type' | 'title' | 'content' | 'priority' | 'status'>> & { tags?: string[] },
): Promise<LearningMemoryPayload> {
  return readJson(
    await apiFetch(`/api/learning/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_MEMORY_UPDATE_FAILED',
  );
}

export async function deleteLearningMemory(memoryId: string): Promise<LearningMemoryPayload> {
  return readJson(
    await apiFetch(`/api/learning/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' }),
    'LEARNING_MEMORY_DELETE_FAILED',
  );
}

export async function listLearningExperiences(): Promise<{ items: LearningExperiencePayload[]; total: number }> {
  return readJson(
    await apiFetch('/api/learning/experiences', { cache: 'no-store' }),
    'LEARNING_EXPERIENCES_FAILED',
  );
}

export async function createLearningExperience(payload: {
  task_type: string;
  title: string;
  question: string;
  answer: string;
  summary: string;
  tags: string[];
}): Promise<LearningExperiencePayload> {
  return readJson(
    await apiFetch('/api/learning/experiences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_EXPERIENCE_CREATE_FAILED',
  );
}

export async function updateLearningExperience(
  experienceId: string,
  payload: Partial<Pick<LearningExperiencePayload, 'task_type' | 'title' | 'question' | 'answer' | 'summary' | 'status'>> & { tags?: string[] },
): Promise<LearningExperiencePayload> {
  return readJson(
    await apiFetch(`/api/learning/experiences/${encodeURIComponent(experienceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_EXPERIENCE_UPDATE_FAILED',
  );
}

export async function deleteLearningExperience(experienceId: string): Promise<LearningExperiencePayload> {
  return readJson(
    await apiFetch(`/api/learning/experiences/${encodeURIComponent(experienceId)}`, { method: 'DELETE' }),
    'LEARNING_EXPERIENCE_DELETE_FAILED',
  );
}

export async function listLearningTemplates(): Promise<{ items: LearningTemplatePayload[]; total: number }> {
  return readJson(
    await apiFetch('/api/learning/templates', { cache: 'no-store' }),
    'LEARNING_TEMPLATES_FAILED',
  );
}

export async function listLearningTemplateReviews(status = 'pending'): Promise<{ items: LearningTemplatePayload[]; total: number }> {
  return readJson(
    await apiFetch(`/api/learning/templates/review?status=${encodeURIComponent(status)}`, { cache: 'no-store' }),
    'LEARNING_TEMPLATE_REVIEWS_FAILED',
  );
}

export async function createLearningTemplate(payload: {
  template_name: string;
  task_type: string;
  template_content: string;
  variables: Record<string, unknown>;
  scope: 'personal' | 'company';
}): Promise<LearningTemplatePayload> {
  return readJson(
    await apiFetch('/api/learning/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_TEMPLATE_CREATE_FAILED',
  );
}

export async function updateLearningTemplate(
  templateId: string,
  payload: Partial<Pick<LearningTemplatePayload, 'template_name' | 'task_type' | 'template_content' | 'scope' | 'review_status' | 'status'>> & { variables?: Record<string, unknown> },
): Promise<LearningTemplatePayload> {
  return readJson(
    await apiFetch(`/api/learning/templates/${encodeURIComponent(templateId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_TEMPLATE_UPDATE_FAILED',
  );
}

export async function submitLearningTemplateReview(templateId: string): Promise<LearningTemplatePayload> {
  return readJson(
    await apiFetch(`/api/learning/templates/${encodeURIComponent(templateId)}/submit-review`, { method: 'POST' }),
    'LEARNING_TEMPLATE_SUBMIT_FAILED',
  );
}

export async function approveLearningTemplateReview(templateId: string): Promise<LearningTemplatePayload> {
  return readJson(
    await apiFetch(`/api/learning/templates/${encodeURIComponent(templateId)}/approve`, { method: 'POST' }),
    'LEARNING_TEMPLATE_APPROVE_FAILED',
  );
}

export async function rejectLearningTemplateReview(templateId: string): Promise<LearningTemplatePayload> {
  return readJson(
    await apiFetch(`/api/learning/templates/${encodeURIComponent(templateId)}/reject`, { method: 'POST' }),
    'LEARNING_TEMPLATE_REJECT_FAILED',
  );
}

export async function deleteLearningTemplate(templateId: string): Promise<LearningTemplatePayload> {
  return readJson(
    await apiFetch(`/api/learning/templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' }),
    'LEARNING_TEMPLATE_DELETE_FAILED',
  );
}

export async function listLearningFailureCases(): Promise<{ items: LearningFailureCasePayload[]; total: number }> {
  return readJson(
    await apiFetch('/api/learning/failure-cases', { cache: 'no-store' }),
    'LEARNING_FAILURE_CASES_FAILED',
  );
}

export async function createLearningFailureCase(payload: {
  task_type: string;
  wrong_answer: string;
  correction: string;
  prevention_rule: string;
  tags: string[];
}): Promise<LearningFailureCasePayload> {
  return readJson(
    await apiFetch('/api/learning/failure-cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_FAILURE_CASE_CREATE_FAILED',
  );
}

export async function updateLearningFailureCase(
  failureCaseId: string,
  payload: Partial<Pick<LearningFailureCasePayload, 'task_type' | 'wrong_answer' | 'correction' | 'prevention_rule' | 'status'>> & { tags?: string[] },
): Promise<LearningFailureCasePayload> {
  return readJson(
    await apiFetch(`/api/learning/failure-cases/${encodeURIComponent(failureCaseId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_FAILURE_CASE_UPDATE_FAILED',
  );
}

export async function deleteLearningFailureCase(failureCaseId: string): Promise<LearningFailureCasePayload> {
  return readJson(
    await apiFetch(`/api/learning/failure-cases/${encodeURIComponent(failureCaseId)}`, { method: 'DELETE' }),
    'LEARNING_FAILURE_CASE_DELETE_FAILED',
  );
}

export async function createLearningFeedback(payload: {
  conversation_id: string;
  message_id: string;
  feedback_type: 'useful' | 'not_useful' | 'needs_revision' | 'save_experience' | 'save_template' | 'record_error';
  comment?: string;
  saved_as?: '' | 'experience' | 'template' | 'failure_case' | 'memory';
}): Promise<LearningFeedbackPayload> {
  return readJson(
    await apiFetch('/api/learning/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'LEARNING_FEEDBACK_CREATE_FAILED',
  );
}

export async function listLearningFeedback(limit = 50): Promise<{ items: LearningFeedbackPayload[]; total: number }> {
  return readJson(
    await apiFetch(`/api/learning/feedback?limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store' }),
    'LEARNING_FEEDBACK_FAILED',
  );
}

export async function getTask(taskCode: string): Promise<TaskPayload> {
  return readJson<TaskPayload>(
    await apiFetch(`/api/ai/tasks/${encodeURIComponent(taskCode)}`),
    'TASK_FAILED',
  );
}

export async function routeIntent(query: string): Promise<{
  candidates: IntentCandidatePayload[];
  skill_candidates?: IntentSkillCandidatePayload[];
}> {
  return readJson(
    await apiFetch('/api/ai/intent/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }),
    'INTENT_ROUTE_FAILED',
  );
}

function normalizeAttachmentPayload(payload: unknown): AttachmentPayload {
  const value = payload as Partial<AttachmentPayload> & {
    uuid?: string;
    name?: string;
    type?: string;
    size?: number;
  };
  return {
    attachment_uuid: String(value.attachment_uuid ?? value.uuid ?? ''),
    file_name: String(value.file_name ?? value.name ?? ''),
    file_type: String(value.file_type ?? value.type ?? ''),
    file_size: Number(value.file_size ?? value.size ?? 0),
    status: String(value.status ?? ''),
    extracted_characters: Number(value.extracted_characters ?? 0),
  };
}

export async function uploadTaskAttachment(
  taskUuid: string,
  file: File,
): Promise<AttachmentPayload> {
  const form = new FormData();
  form.append('task_uuid', taskUuid);
  form.append('file', file);
  return normalizeAttachmentPayload(await readJson(
    await apiFetch('/api/ai/attachments', {
      method: 'POST',
      body: form,
    }),
    'ATTACHMENT_UPLOAD_FAILED',
  ));
}

export async function reportGenerationFailure(
  generationUuid: string,
  payload: {
    completionToken: string;
    errorCode: string;
    errorMessage?: string;
  },
): Promise<void> {
  await readJson(
    await apiFetch(`/api/ai/generations/${encodeURIComponent(generationUuid)}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completion_token: payload.completionToken,
        error_code: payload.errorCode,
        ...(payload.errorMessage ? { error_message: payload.errorMessage } : {}),
      }),
    }),
    'GENERATION_FAIL_WRITEBACK_FAILED',
  );
}

export type LocalModelAuditEvent =
  | 'MODEL_STARTED'
  | 'MODEL_COMPLETED'
  | 'MODEL_CANCELLED'
  | 'MODEL_FAILED'
  | 'MODEL_SYNC_PENDING';

export async function reportLocalModelAuditEvent(payload: {
  generationUuid: string;
  event: LocalModelAuditEvent;
  modelId?: string;
  provider?: string;
  latencyMs?: number;
  errorCode?: string;
}): Promise<void> {
  const response = await apiFetch('/api/ai/audit/local-model-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generation_uuid: payload.generationUuid,
      event: payload.event,
      ...(payload.modelId ? { model_id: payload.modelId } : {}),
      ...(payload.provider ? { provider: payload.provider } : {}),
      ...(payload.latencyMs != null ? { latency_ms: payload.latencyMs } : {}),
      ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
    }),
  });
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'LOCAL_MODEL_AUDIT_FAILED');
  }
}

export async function putFavorite(taskUuid: string): Promise<void> {
  const response = await apiFetch(
    `/api/ai/favorites/${encodeURIComponent(taskUuid)}`,
    { method: 'PUT' },
  );
  if (!response.ok) throw new ApiError(response.status, 'FAVORITE_FAILED');
}

export async function deleteFavorite(taskUuid: string): Promise<void> {
  const response = await apiFetch(
    `/api/ai/favorites/${encodeURIComponent(taskUuid)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new ApiError(response.status, 'FAVORITE_DELETE_FAILED');
}

export type HistoryFilters = {
  status?: string;
  createdFrom?: string;
  createdTo?: string;
};

export async function getHistory(filters: HistoryFilters = {}): Promise<{
  items: HistoryItemPayload[];
  total: number;
}> {
  const search = new URLSearchParams({ page_size: '100' });
  if (filters.status) search.set('status', filters.status);
  if (filters.createdFrom) search.set('created_from', filters.createdFrom);
  if (filters.createdTo) search.set('created_to', filters.createdTo);
  return readJson(
    await apiFetch(`/api/ai/generations?${search.toString()}`),
    'HISTORY_FAILED',
  );
}

export async function deleteHistory(generationUuid: string): Promise<void> {
  const response = await apiFetch(
    `/api/ai/generations/${encodeURIComponent(generationUuid)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new ApiError(response.status, 'HISTORY_DELETE_FAILED');
}

export async function getWorkArtifacts(): Promise<{
  items: WorkArtifactItemPayload[];
  total: number;
  page: number;
  page_size: number;
}> {
  return readJson(
    await apiFetch('/api/ai/work-artifacts?page_size=100'),
    'WORK_ARTIFACTS_FAILED',
  );
}

export async function getWorkArtifactDetail(
  artifactUuid: string,
): Promise<WorkArtifactDetailPayload> {
  return readJson(
    await apiFetch(`/api/ai/work-artifacts/${encodeURIComponent(artifactUuid)}`),
    'WORK_ARTIFACT_DETAIL_FAILED',
  );
}

export async function deleteWorkArtifact(artifactUuid: string): Promise<void> {
  const response = await apiFetch(
    `/api/ai/work-artifacts/${encodeURIComponent(artifactUuid)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new ApiError(response.status, 'WORK_ARTIFACT_DELETE_FAILED');
}

export async function saveChatMessageWorkArtifact(payload: {
  conversationId: string;
  messageId: string;
  title: string;
}): Promise<WorkArtifactItemPayload> {
  return readJson(
    await apiFetch('/api/ai/work-artifacts/chat-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: payload.conversationId,
        message_id: payload.messageId,
        title: payload.title,
      }),
    }),
    'WORK_ARTIFACT_SAVE_FAILED',
  );
}

export async function downloadWorkArtifactWord(downloadUrl: string): Promise<WordDownloadResult> {
  const response = await apiFetch(downloadUrl);
  if (!response.ok) throw new ApiError(response.status, 'WORD_EXPORT_FAILED');
  if (isDesktopRuntime()) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileName = readAttachmentFileName(response.headers) || '聚信得仁文档.docx';
    const path = await saveWordBytesToDesktop(fileName, bytes);
    return { kind: 'desktop', path };
  }
  await downloadBlobFromResponse(response, '聚信得仁文档.docx');
  return { kind: 'browser' };
}

function trimHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

function readAttachmentFileName(headers: Headers): string {
  const disposition = headers.get('Content-Disposition');
  if (!disposition) return '';
  const parts = disposition.split(';').map((part) => part.trim());
  const encodedFileName = parts.find((part) =>
    part.toLowerCase().startsWith('filename*='));
  if (encodedFileName) {
    const value = trimHeaderValue(encodedFileName.slice(encodedFileName.indexOf('=') + 1));
    const encoded = value.includes("''") ? value.slice(value.indexOf("''") + 2) : value;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const fileName = parts.find((part) =>
    part.toLowerCase().startsWith('filename='));
  return fileName
    ? trimHeaderValue(fileName.slice(fileName.indexOf('=') + 1))
    : '';
}

export type WordDownloadResult =
  | { kind: 'desktop'; path: string }
  | { kind: 'browser' };

export async function downloadGenerationWord(generationUuid: string): Promise<WordDownloadResult> {
  const response = await apiFetch(
    `/api/ai/generations/${encodeURIComponent(generationUuid)}/export.docx`,
  );
  if (!response.ok) throw new ApiError(response.status, 'WORD_EXPORT_FAILED');
  if (isDesktopRuntime()) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileName = readAttachmentFileName(response.headers) || '聚信得仁文档.docx';
    const path = await saveWordBytesToDesktop(fileName, bytes);
    return { kind: 'desktop', path };
  }
  await downloadBlobFromResponse(response, '聚信得仁文档.docx');
  return { kind: 'browser' };
}

export type FeedbackType =
  | 'USEFUL'
  | 'INACCURATE'
  | 'WRONG_FORMAT'
  | 'TOO_VAGUE'
  | 'NEEDS_EXPERTISE'
  | 'NOT_CLIENT_READY'
  | 'OTHER';

export async function submitFeedback(
  generationUuid: string,
  feedbackType: FeedbackType,
  content?: string,
): Promise<void> {
  await readJson(
    await apiFetch(
      `/api/ai/generations/${encodeURIComponent(generationUuid)}/feedback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback_type: feedbackType,
          ...(content?.trim() ? { content: content.trim() } : {}),
        }),
      },
    ),
    'FEEDBACK_FAILED',
  );
}

export async function getHistoryDetail(
  generationUuid: string,
): Promise<HistoryDetailPayload> {
  return readJson(
    await apiFetch(`/api/ai/generations/${encodeURIComponent(generationUuid)}`),
    'HISTORY_DETAIL_FAILED',
  );
}

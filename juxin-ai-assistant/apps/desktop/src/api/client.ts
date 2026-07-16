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

export type WorkArtifactSourcePayload = {
  source_type: string;
  file_name: string;
  file_uuid?: string;
  chunk_id?: string;
  page_number?: number | null;
  section_title?: string;
  chunk_index?: number | null;
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
    public readonly code: string,
    public readonly payload?: unknown,
  ) {
    super(code);
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
  // Browser sessions must stay on the origin the user actually opened. A
  // build-time public URL can point at an internal LAN address in deployments
  // reached through a public host, which would break logout and re-login.
  const authUrl = isDesktopRuntime()
    ? (import.meta.env.VITE_AUTH_PUBLIC_URL || 'http://localhost:5180')
    : window.location.origin;
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

export async function getWorkArtifacts(filters: {
  artifactType?: string;
  createdFrom?: string;
  createdTo?: string;
} = {}): Promise<{
  items: WorkArtifactItemPayload[];
  total: number;
  page: number;
  page_size: number;
}> {
  const query = new URLSearchParams({ page_size: '100' });
  if (filters.artifactType) query.set('artifact_type', filters.artifactType);
  if (filters.createdFrom) query.set('created_from', filters.createdFrom);
  if (filters.createdTo) query.set('created_to', filters.createdTo);
  return readJson(
    await apiFetch(`/api/ai/work-artifacts?${query.toString()}`),
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

/** 6.0 任务中心（Run）。 */
export type AgentRunPayload = {
  run_id: string;
  title?: string;
  run_type?: string;
  status: string;
  stage: string;
  progress: number;
  citations?: Array<Record<string, unknown>>;
  artifact?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AgentRunDetailPayload = {
  run: AgentRunPayload;
  steps: Array<{
    step_id: string;
    run_id: string;
    sequence: number;
    step_type: string;
    status: string;
    role: string;
    summary: string;
  }>;
  events: Array<{
    event_id: string;
    run_id: string;
    sequence: number;
    event_type: string;
    stage?: string | null;
    label: string;
    progress?: number | null;
    content: string;
    source?: Record<string, unknown> | null;
    artifact_id?: string;
    quality?: Record<string, unknown> | null;
  }>;
  result: Record<string, unknown>;
};

export async function listAgentRuns(filters: {
  status?: string;
  limit?: number;
} = {}): Promise<{ items: AgentRunPayload[]; total: number }> {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.limit) query.set('limit', String(filters.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return readJson(await apiFetch(`/api/ai/runs${suffix}`, { cache: 'no-store' }), 'AGENT_RUNS_FAILED');
}

export async function getAgentRunDetail(runId: string): Promise<AgentRunDetailPayload> {
  return readJson(
    await apiFetch(`/api/ai/runs/${encodeURIComponent(runId)}`, { cache: 'no-store' }),
    'AGENT_RUN_DETAIL_FAILED',
  );
}

export async function createAgentRun(payload: {
  input_text: string;
  title?: string;
  run_type?: string;
}): Promise<{ run: AgentRunPayload; snapshot: Record<string, unknown> }> {
  return readJson(
    await apiFetch('/api/ai/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_text: payload.input_text,
        title: payload.title || 'AI 任务',
        run_type: payload.run_type || 'chat',
      }),
    }),
    'AGENT_RUN_CREATE_FAILED',
  );
}

export async function cancelAgentRun(runId: string): Promise<AgentRunPayload> {
  return readJson(
    await apiFetch(`/api/ai/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),
    'AGENT_RUN_CANCEL_FAILED',
  );
}

export async function postAgentRunFeedback(
  runId: string,
  payload: { feedback_type: string; comment?: string },
): Promise<void> {
  const response = await apiFetch(`/api/ai/runs/${encodeURIComponent(runId)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feedback_type: payload.feedback_type,
      comment: payload.comment || '',
    }),
  });
  if (!response.ok) throw new ApiError(response.status, 'AGENT_RUN_FEEDBACK_FAILED');
}

/** 6.0 Agent artifact deliverable (Run 成果中心). */
export type AgentArtifactPayload = {
  artifact_id: string;
  run_id: string;
  artifact_type: string;
  title: string;
  status: string;
  version: number;
  content_markdown: string;
  quality?: Record<string, unknown> | null;
};

export async function listAgentArtifacts(): Promise<{ items: AgentArtifactPayload[]; total: number }> {
  return readJson(await apiFetch('/api/ai/artifacts', { cache: 'no-store' }), 'AGENT_ARTIFACTS_FAILED');
}

export async function getAgentArtifact(artifactId: string): Promise<AgentArtifactPayload> {
  return readJson(
    await apiFetch(`/api/ai/artifacts/${encodeURIComponent(artifactId)}`, { cache: 'no-store' }),
    'AGENT_ARTIFACT_FAILED',
  );
}

export type AgentArtifactVersionPayload = {
  version: number;
  change_summary: string;
  created_by: string;
  content_preview: string;
  is_active: boolean;
};

export async function listAgentArtifactVersions(
  artifactId: string,
): Promise<{
  artifact_id: string;
  active_version: number;
  items: AgentArtifactVersionPayload[];
  total: number;
}> {
  return readJson(
    await apiFetch(`/api/ai/artifacts/${encodeURIComponent(artifactId)}/versions`, {
      cache: 'no-store',
    }),
    'AGENT_ARTIFACT_VERSIONS_FAILED',
  );
}

export type AgentArtifactExportFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'md';

export async function downloadAgentArtifact(
  artifactId: string,
  fmt: AgentArtifactExportFormat = 'docx',
): Promise<WordDownloadResult> {
  const response = await apiFetch(
    `/api/ai/artifacts/${encodeURIComponent(artifactId)}/export/${encodeURIComponent(fmt)}`,
  );
  if (!response.ok) throw new ApiError(response.status, 'ARTIFACT_EXPORT_FAILED');
  const fallback = `成果.${fmt}`;
  if (isDesktopRuntime()) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileName = readAttachmentFileName(response.headers) || fallback;
    const path = await saveWordBytesToDesktop(fileName, bytes);
    return { kind: 'desktop', path };
  }
  await downloadBlobFromResponse(response, fallback);
  return { kind: 'browser' };
}

export type OpsSloCheckPayload = {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'not_observed' | string;
  actual: number | string | null;
  threshold: number | string | null;
  detail?: string;
};

export type OpsSloAuditPayload = {
  overall: 'pass' | 'fail' | 'pass_with_gaps' | 'unavailable' | string;
  checks: OpsSloCheckPayload[];
  metrics: Record<string, number | string | null>;
  fail_count: number;
  gap_count: number;
  notes: string[];
};

export type OpsSnapshotPayload = {
  runs_total: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_running: number;
  artifacts_total: number;
  faqs_published: number;
  faqs_draft: number;
  learning_candidates_draft: number;
  learning_candidates_published: number;
  success_rate: number;
  tool_invocations_in_progress: number;
  tool_invocations_reconciliation_required: number;
  direct_actions_reconciliation_required: number;
  slo_audit: OpsSloAuditPayload;
  notes: string[];
  run_reconciliation_overall: 'pass' | 'fail' | 'unavailable';
  run_reconciliation_scanned_runs: number;
  run_reconciliation_issue_count: number;
  run_reconciliation_issue_counts: Record<string, number>;
};

export async function getOpsSnapshot(): Promise<OpsSnapshotPayload> {
  return readJson(await apiFetch('/api/ai/ops/snapshot', { cache: 'no-store' }), 'OPS_SNAPSHOT_FAILED');
}

export type RunReconciliationIssuePayload = {
  run_id: string;
  code: string;
  entity: 'run' | 'step' | 'event' | string;
  detail: string;
};

export type RunReconciliationPayload = {
  overall: 'pass' | 'fail' | string;
  scanned_runs: number;
  issue_count: number;
  issue_counts: Record<string, number>;
  issues: RunReconciliationIssuePayload[];
  limit: number;
};

export type OpsRunPayload = {
  run_id: string;
  title: string;
  run_type: string;
  status: string;
  stage: string;
  progress: number;
  artifact?: Record<string, unknown> | null;
  citations?: Array<Record<string, unknown>>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type OpsRunStepPayload = {
  step_id: string;
  run_id: string;
  sequence: number;
  step_type: string;
  status: string;
  role: string;
  summary: string;
};

export type OpsRunEventPayload = {
  event_id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  stage?: string | null;
  label: string;
  progress?: number | null;
};

export type OpsRunDetailPayload = {
  run: OpsRunPayload;
  steps: OpsRunStepPayload[];
  events: OpsRunEventPayload[];
  result: Record<string, unknown>;
  reconciliation: RunReconciliationPayload;
};

export type OpsRunAction = 'pause' | 'resume' | 'rollback';

export type OpsRunActionPayload = {
  run: OpsRunPayload;
  snapshot: Record<string, unknown>;
  checkpoint?: Record<string, unknown> | null;
  side_effects_reversed: boolean;
};

export async function getOpsRunDetail(runId: string): Promise<OpsRunDetailPayload> {
  return readJson(
    await apiFetch(`/api/ai/ops/runs/${encodeURIComponent(runId)}`, { cache: 'no-store' }),
    'OPS_RUN_DETAIL_FAILED',
  );
}

export async function controlOpsRun(
  runId: string,
  action: OpsRunAction,
): Promise<OpsRunActionPayload> {
  return readJson(
    await apiFetch(`/api/ai/ops/runs/${encodeURIComponent(runId)}/${action}`, {
      method: 'POST',
    }),
    `OPS_RUN_${action.toUpperCase()}_FAILED`,
  );
}

export async function getOpsRunReconciliation(
  limit = 200,
): Promise<RunReconciliationPayload> {
  return readJson(
    await apiFetch(`/api/ai/ops/run-reconciliation?limit=${encodeURIComponent(String(limit))}`, {
      cache: 'no-store',
    }),
    'OPS_RUN_RECONCILIATION_FAILED',
  );
}

export type GaMetricItem = {
  key: string;
  name: string;
  target: string;
  value: number | null;
  unit: string;
  status: 'pass' | 'fail' | 'unknown' | string;
  detail: string;
};

export type GaReportPayload = {
  overall: 'ready' | 'partial' | 'blocked' | 'not_ready' | string;
  summary: {
    passed: number;
    failed: number;
    unknown: number;
    total: number;
    sample_limit: number;
  };
  items: GaMetricItem[];
  measured: Record<string, unknown>;
  notes: string[];
  thresholds_source?: string;
};

export async function getOpsGaReport(): Promise<GaReportPayload> {
  return readJson(
    await apiFetch('/api/ai/ops/ga-report', { cache: 'no-store' }),
    'OPS_GA_REPORT_FAILED',
  );
}

export async function runGaOfflineSuite(): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch('/api/ai/learning-eval/ga-suite', { method: 'POST' }),
    'GA_OFFLINE_SUITE_FAILED',
  );
}

export type CheckpointSuitePayload = {
  total: number;
  recovered: number;
  failed: number;
  recovery_rate: number;
  target: number;
  passed: boolean;
  failures?: Array<Record<string, unknown>>;
  owner_user_id?: string;
};

export async function runCheckpointSuite(cases = 12): Promise<CheckpointSuitePayload> {
  return readJson(
    await apiFetch(`/api/ai/ops/checkpoint-suite?cases=${Math.max(1, Math.min(cases, 100))}`, {
      method: 'POST',
    }),
    'OPS_CHECKPOINT_SUITE_FAILED',
  );
}

export type DataEgressDecision = {
  allowed: boolean;
  level: number;
  level_label: string;
  destination: string;
  requires_confirmation: boolean;
  redaction_applied: boolean;
  reasons: string[];
  findings: string[];
  redacted_text: string;
  policy: string;
};

export async function evaluateDataEgress(payload: {
  text: string;
  destination?: string;
  confirmed?: boolean;
  declared_level?: number | null;
  agent_id?: string;
  persist?: boolean;
}): Promise<DataEgressDecision & { audit_id?: string }> {
  return readJson(
    await apiFetch('/api/ai/data-egress/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.text,
        destination: payload.destination || 'external_agent',
        confirmed: payload.confirmed || false,
        declared_level: payload.declared_level ?? null,
        agent_id: payload.agent_id || '',
        persist: payload.persist !== false,
      }),
    }),
    'DATA_EGRESS_FAILED',
  );
}

export type CostSummaryPayload = {
  calls_total: number;
  calls_succeeded: number;
  calls_blocked: number;
  success_rate: number | null;
  total_cost_micros: number;
  avg_latency_ms: number;
  by_agent: Array<{
    agent_id: string;
    calls: number;
    cost_micros: number;
    avg_latency_ms: number;
  }>;
  egress_audits_total: number;
  egress_denied: number;
};

export async function getOpsCostSummary(): Promise<CostSummaryPayload> {
  return readJson(
    await apiFetch('/api/ai/ops/cost-summary', { cache: 'no-store' }),
    'OPS_COST_SUMMARY_FAILED',
  );
}

export type ReadinessPayload = {
  overall: string;
  elapsed_ms: number;
  fail_count: number;
  warn_count: number;
  pass_count: number;
  recommendation: string;
  checks: Array<{
    id: string;
    name: string;
    status: string;
    detail?: string;
    latency_ms?: number;
  }>;
};

export async function getOpsReadiness(): Promise<ReadinessPayload> {
  return readJson(
    await apiFetch('/api/ai/ops/readiness', { cache: 'no-store' }),
    'OPS_READINESS_FAILED',
  );
}

export type SecurityAuditPayload = {
  overall: string;
  fail_count: number;
  warn_count: number;
  pass_count: number;
  recommendation: string;
  checks: Array<{
    id: string;
    category: string;
    name: string;
    status: string;
    detail?: string;
  }>;
};

export async function getOpsSecurityAudit(): Promise<SecurityAuditPayload> {
  return readJson(
    await apiFetch('/api/ai/ops/security-audit', { cache: 'no-store' }),
    'OPS_SECURITY_AUDIT_FAILED',
  );
}

export async function getAgentHubHealth(agentId?: string): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
  healthy: number;
  overall: string;
}> {
  const q = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
  return readJson(
    await apiFetch(`/api/ai/agent-hub/health${q}`, { cache: 'no-store' }),
    'AGENT_HUB_HEALTH_FAILED',
  );
}

export async function listAgentMarket(): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
}> {
  return readJson(
    await apiFetch('/api/ai/agent-hub/market', { cache: 'no-store' }),
    'AGENT_MARKET_FAILED',
  );
}

export type HubAgentPayload = {
  agent_id: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  endpoint: string;
  status: string;
};

export async function listHubAgents(): Promise<HubAgentPayload[]> {
  return readJson(
    await apiFetch('/api/ai/agent-hub/agents', { cache: 'no-store' }),
    'AGENT_HUB_LIST_FAILED',
  );
}

export async function invokeHubAgent(
  agentId: string,
  payload: {
    input_text: string;
    context?: Record<string, unknown>;
    egress_confirmed?: boolean;
    run_id?: string;
  },
): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch(`/api/ai/agent-hub/agents/${encodeURIComponent(agentId)}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_text: payload.input_text,
        context: payload.context || {},
        egress_confirmed: Boolean(payload.egress_confirmed),
        run_id: payload.run_id || '',
      }),
    }),
    'AGENT_HUB_INVOKE_FAILED',
  );
}

export async function setAgentMarketStatus(
  agentId: string,
  status: 'installed' | 'authorized' | 'disabled',
): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch(`/api/ai/agent-hub/market/${encodeURIComponent(agentId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
    'AGENT_MARKET_STATUS_FAILED',
  );
}

export async function routeAgent(payload: {
  input_text: string;
  preferred_agent_id?: string;
  required_capabilities?: string[];
  allow_external?: boolean;
}): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch('/api/ai/workflows/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_text: payload.input_text,
        preferred_agent_id: payload.preferred_agent_id || '',
        required_capabilities: payload.required_capabilities || [],
        allow_external: payload.allow_external !== false,
      }),
    }),
    'AGENT_ROUTE_FAILED',
  );
}

export async function listWorkflows(): Promise<{
  items: Array<{
    id: string;
    name: string;
    description: string;
    step_count: number;
    custom?: boolean;
  }>;
  total: number;
}> {
  return readJson(await apiFetch('/api/ai/workflows', { cache: 'no-store' }), 'WORKFLOWS_LIST_FAILED');
}

export async function getWorkflowDefinition(workflowId: string): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch(`/api/ai/workflows/${encodeURIComponent(workflowId)}`, { cache: 'no-store' }),
    'WORKFLOW_GET_FAILED',
  );
}

export async function saveCustomWorkflow(payload: {
  id: string;
  name: string;
  description?: string;
  steps: Array<{ id: string; type: string; params?: Record<string, unknown> }>;
}): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch('/api/ai/workflows/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'WORKFLOW_SAVE_FAILED',
  );
}

export type WorkflowValidationIssue = {
  code: string;
  message: string;
  path?: string;
  severity?: 'error' | 'warning' | string;
};

export type WorkflowValidationResult = {
  valid: boolean;
  errors: WorkflowValidationIssue[];
  warnings: WorkflowValidationIssue[];
  preview?: {
    node_count?: number;
    max_depth?: number;
    requires_approval?: boolean;
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  };
};

export async function validateWorkflow(payload: {
  id?: string;
  name?: string;
  description?: string;
  steps: Array<{ id: string; type: string; params?: Record<string, unknown> }>;
}): Promise<WorkflowValidationResult> {
  return readJson(
    await apiFetch('/api/ai/workflows/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'WORKFLOW_VALIDATE_FAILED',
  );
}

export async function validateSavedWorkflow(workflowId: string): Promise<WorkflowValidationResult> {
  return readJson(
    await apiFetch(`/api/ai/workflows/custom/${encodeURIComponent(workflowId)}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
    'WORKFLOW_VALIDATE_FAILED',
  );
}

export async function publishCustomWorkflow(workflowId: string): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch(`/api/ai/workflows/custom/${encodeURIComponent(workflowId)}/publish`, {
      method: 'POST',
    }),
    'WORKFLOW_PUBLISH_FAILED',
  );
}

export async function deleteCustomWorkflow(workflowId: string): Promise<void> {
  const response = await apiFetch(`/api/ai/workflows/custom/${encodeURIComponent(workflowId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new ApiError(response.status, 'WORKFLOW_DELETE_FAILED');
}

export async function runWorkflow(
  workflowId: string,
  payload: { input_text: string; preferred_agent_id?: string; egress_confirmed?: boolean },
): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch(`/api/ai/workflows/${encodeURIComponent(workflowId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_text: payload.input_text,
        preferred_agent_id: payload.preferred_agent_id || '',
        egress_confirmed: payload.egress_confirmed || false,
      }),
    }),
    'WORKFLOW_RUN_FAILED',
  );
}

export async function getOpsFeatureFlags(): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch('/api/ai/ops/feature-flags', { cache: 'no-store' }),
    'OPS_FLAGS_FAILED',
  );
}

export async function updateOpsFeatureFlags(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return readJson(
    await apiFetch('/api/ai/ops/feature-flags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'FEATURE_FLAGS_UPDATE_FAILED',
  );
}

export type LearningCandidatePayload = {
  candidate_id: string;
  owner_user_id: string;
  source_run_id: string;
  candidate_type: string;
  title: string;
  status: string;
  payload?: Record<string, unknown> | null;
};

export async function listLearningCandidates(): Promise<{
  items: LearningCandidatePayload[];
  total: number;
}> {
  return readJson(
    await apiFetch('/api/ai/learning-candidates', { cache: 'no-store' }),
    'LEARNING_CANDIDATES_FAILED',
  );
}

export async function transitionLearningCandidate(
  candidateId: string,
  status: string,
): Promise<LearningCandidatePayload> {
  return readJson(
    await apiFetch(`/api/ai/learning-candidates/${encodeURIComponent(candidateId)}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
    'LEARNING_CANDIDATE_TRANSITION_FAILED',
  );
}

export async function listDocumentTemplates(): Promise<{ items: Array<{ code: string; name: string }> }> {
  return readJson(
    await apiFetch('/api/ai/document-templates', { cache: 'no-store' }),
    'DOCUMENT_TEMPLATES_FAILED',
  );
}

export type RoleAssistantPayload = {
  code: string;
  name: string;
  description: string;
  templates: string[];
  modes: string[];
};

export async function listRoleAssistants(): Promise<{
  items: RoleAssistantPayload[];
  templates: Array<{ code: string; name: string }>;
  catalog_assistants: number;
}> {
  return readJson(
    await apiFetch('/api/ai/role-assistants', { cache: 'no-store' }),
    'ROLE_ASSISTANTS_FAILED',
  );
}

export type RoleGenerateResult = {
  role_code: string;
  template_code: string;
  template_name: string;
  title: string;
  content_markdown: string;
  artifact_id: string;
};

export async function generateRoleDocument(
  roleCode: string,
  payload: {
    template_code?: string;
    title?: string;
    topic?: string;
    notes?: string;
    create_artifact?: boolean;
    polish_with_model?: boolean;
  },
): Promise<RoleGenerateResult & { polished?: boolean; polish_mode?: string }> {
  return readJson(
    await apiFetch(`/api/ai/role-assistants/${encodeURIComponent(roleCode)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_code: payload.template_code || '',
        title: payload.title || '',
        topic: payload.topic || '',
        notes: payload.notes || '',
        create_artifact: payload.create_artifact !== false,
        polish_with_model: payload.polish_with_model,
      }),
    }),
    'ROLE_GENERATE_FAILED',
  );
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

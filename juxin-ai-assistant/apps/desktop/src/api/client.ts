import { invoke } from '@tauri-apps/api/core';

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

export type HomePayload = {
  favorites: TaskCardPayload[];
  recent_tasks: TaskCardPayload[];
  recent_generations: HistoryItemPayload[];
  safety_reminders: string[];
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
  if (!window.__TAURI_INTERNALS__) return '';
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
};

function formatAuthPortalUrl(url: URL, options: AuthPortalUrlOptions): string {
  if (options.logout) {
    url.searchParams.set('logout', '1');
  }
  return url.toString();
}

export function getAuthPortalUrl(options: AuthPortalUrlOptions = {}): string {
  if (
    window.__TAURI_INTERNALS__ &&
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
  const authUrl = import.meta.env.VITE_AUTH_PUBLIC_URL || 'http://localhost:5180';
  const portal = new URL(`${authUrl.replace(/\/$/, '')}/portal`);
  portal.searchParams.set('system', 'ai-assistant');
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

export async function getTask(taskCode: string): Promise<TaskPayload> {
  return readJson<TaskPayload>(
    await apiFetch(`/api/ai/tasks/${encodeURIComponent(taskCode)}`),
    'TASK_FAILED',
  );
}

export async function routeIntent(query: string): Promise<{
  candidates: IntentCandidatePayload[];
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
  const bytes = new Uint8Array(await response.arrayBuffer());
  const fileName = readAttachmentFileName(response.headers) || '聚信得仁文档.docx';
  if (window.__TAURI_INTERNALS__) {
    const path = await invoke<string>('generation_word_save', {
      fileName,
      bytes: Array.from(bytes),
    });
    return { kind: 'desktop', path };
  }
  const blob = new Blob([bytes], {
    type: response.headers.get('Content-Type') || 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

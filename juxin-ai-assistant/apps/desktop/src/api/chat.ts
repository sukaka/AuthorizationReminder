import { ApiError, apiFetch, getAuthPortalUrl, isSafeSameOriginUrl } from './client';
import type { LoopTraceStep } from './agentLoop';
import { downloadBlobFromResponse, saveWordBytesToDesktop } from '../runtime/downloads';
import { isDesktopRuntime } from '../runtime/capabilities';

export type ChatMode =
  | 'normal'
  | 'sales'
  | 'business'
  | 'hr_admin'
  | 'presales'
  | 'delivery'
  | 'software_test'
  | 'pentest'
  | 'security_ops'
  | 'risk_assessment'
  | 'incident_response'
  | 'knowledge';

export type ChatModeSelection = ChatMode | 'auto';

export type ChatCitation = {
  source_type: string;
  file_uuid?: string;
  file_name?: string;
  chunk_id?: string;
  page_number?: number | null;
  section_title?: string;
  page_or_sheet?: string;
  chunk_type?: string;
  chunk_index?: number | null;
  score?: number;
  asset_url?: string;
  media_type?: string;
};

export type ChatGeneratedFile = {
  artifact_id: string;
  file_name: string;
  format: 'docx' | 'xlsx' | 'pptx' | 'md' | 'html';
  media_type: string;
  download_url: string;
};

export type ChatMessagePayload = {
  message_uuid: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  citations: ChatCitation[];
  generated_files?: ChatGeneratedFile[];
  created_at: string;
};

export type ChatSessionPayload = {
  session_uuid: string;
  title: string;
  mode: string;
  status: string;
  workspace_type: 'personal' | 'project';
  project_uuid?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatSessionListKind = 'active' | 'archived' | 'trash';

export type KnowledgeFilePayload = {
  file_uuid: string;
  knowledge_base_id?: string;
  file_name: string;
  file_type: string;
  file_size: number;
  visibility: string;
  status: string;
  chunk_count: number;
  created_at: string;
  updated_at?: string | null;
  content_sha256?: string;
  version?: number;
  is_current_version?: boolean;
  source_type?: string;
  usage_type?: 'session_attachment' | 'personal_reference' | 'official_knowledge' | 'skill_input';
  review_status?: string;
  rag_enabled?: boolean;
  reference_enabled?: boolean;
  rag_scope?: string;
  permission_scope?: string;
  category?: string;
  document_type?: string;
  tags?: string[];
  parse_status?: string;
  index_status?: string;
  external_public?: boolean;
  external_download_allowed?: boolean;
};

export type KnowledgeFileVersionPayload = {
  file_uuid: string;
  file_name: string;
  version: number;
  is_current_version: boolean;
  review_status: string;
  status: string;
  rag_enabled: boolean;
  summary: string;
  created_at: string;
  updated_at: string;
  parent_file_id: number | null;
  replaced_by_file_id: number | null;
};

export type KnowledgeFileVersionTimelinePayload = {
  file_uuid: string;
  items: KnowledgeFileVersionPayload[];
  effective_uuid: string | null;
  total: number;
};

export type KnowledgeBasePayload = {
  base_id: string;
  name: string;
  description: string;
  scope: string;
  owner_user_id: string;
  department_id: string;
  project_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeCategoryPayload = {
  category_id: string;
  name: string;
  parent_category_id: string;
  parent_name: string;
  scope: 'company' | 'department' | 'project' | 'personal';
  sort_order: number;
  status: 'ACTIVE' | 'DISABLED';
  file_count: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeCategoryListPayload = {
  items: KnowledgeCategoryPayload[];
  total: number;
};

export type KnowledgeCategoryCreatePayload = {
  name: string;
  parent_category_id?: string;
  scope?: 'company' | 'department' | 'project' | 'personal';
  sort_order?: number;
  status?: 'ACTIVE' | 'DISABLED';
};

export type KnowledgeCategoryUpdatePayload = Partial<KnowledgeCategoryCreatePayload>;

export type KnowledgeDocumentTypePayload = {
  document_type_id: string;
  name: string;
  sort_order: number;
  status: 'ACTIVE' | 'DISABLED';
  file_count: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeDocumentTypeListPayload = {
  items: KnowledgeDocumentTypePayload[];
  total: number;
};

export type KnowledgeDocumentTypeCreatePayload = {
  name: string;
  sort_order?: number;
  status?: 'ACTIVE' | 'DISABLED';
};

export type KnowledgeDocumentTypeUpdatePayload = Partial<KnowledgeDocumentTypeCreatePayload>;

export type KnowledgeBaseCreatePayload = {
  name: string;
  description?: string;
  scope: 'personal' | 'company' | 'department' | 'project' | 'customer';
  department_id?: string;
  project_id?: string;
};

export type KnowledgeBaseListPayload = {
  items: KnowledgeBasePayload[];
  total: number;
};

export type KnowledgeFilePreviewChunkPayload = {
  chunk_id: string;
  chunk_index: number;
  page_number?: number | null;
  section_title: string;
  page_or_sheet?: string;
  chunk_type?: string;
  text: string;
};

export type KnowledgeFilePreviewPayload = {
  file_uuid: string;
  file_name: string;
  source_kind: string;
  asset_url?: string;
  media_type?: string;
  chunks: KnowledgeFilePreviewChunkPayload[];
  total_chunks: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
  notice: string;
};

export type KnowledgeFileListPayload = {
  items: KnowledgeFilePayload[];
  total: number;
};

export type KnowledgeFileSourcePayload = {
  source_kind: string;
  file_id: string;
  file_name: string;
  page_number?: number | null;
  section_title?: string;
  chunk_id?: string;
  score?: number;
  snippet?: string;
};

export type KnowledgeFileActionPayload = {
  answer: string;
  messages: Array<{ role: string; content: string }>;
  sources: KnowledgeFileSourcePayload[];
  notice: string;
};

export type KnowledgeSearchPayload = {
  sources: KnowledgeFileSourcePayload[];
  total: number;
};

export type PersonalReferenceSearchPayload = KnowledgeSearchPayload & {
  notice: string;
};

export type KnowledgeReviewLogPayload = {
  file_uuid: string;
  file_name: string;
  user_id: string;
  reviewer_id: string;
  action: string;
  old_status: string;
  new_status: string;
  comment: string;
  created_at: string;
};

export type KnowledgeReviewHistoryPayload = {
  items: KnowledgeReviewLogPayload[];
  total: number;
};

export type ChatTaskStatePayload = {
  task_state_id: string;
  conversation_id: string;
  /** Unified Run linked to this chat task; absent on legacy sessions. */
  run_id?: string;
  stage: string;
  status: string;
  label: string;
  goal: string;
  selected_sources: Array<Record<string, unknown>>;
  tool_calls: Array<Record<string, unknown>>;
  verification_status: string;
  next_action: string;
  retry_allowed: boolean;
  failure_reason: string;
  stage_history: Array<Record<string, unknown> & { stage?: string; label?: string; next_action?: string }>;
};

export type ChatSessionDetailPayload = ChatSessionPayload & {
  messages: ChatMessagePayload[];
  task_state?: ChatTaskStatePayload;
};

export type ChatResearchPlan = {
  objective: string;
  questions: string[];
  source_scope: string;
  citation_policy: string;
  uncertainty_policy: string;
};

export type ChatPreparePayload = {
  session_uuid: string;
  user_message_uuid: string;
  assistant_message_uuid: string;
  completion_token: string;
  completed: boolean;
  answer: string;
  messages: Array<{ role: string; content: string }>;
  citations: ChatCitation[];
  generated_files?: ChatGeneratedFile[];
  loop_trace?: LoopTraceStep[];
  task_state?: ChatTaskStatePayload;
  /** 统一任务底座 Run ID，用于跳转任务中心。 */
  run_id?: string;
  requested_mode?: ChatModeSelection;
  effective_mode?: ChatMode;
  routing_reason?: string;
  routing_confidence?: number;
  execution_mode?: 'foreground' | 'background';
  execution_reason?: string;
  research_plan?: ChatResearchPlan | null;
};

export type ChatGeneratePayload = {
  message_uuid: string;
  status: string;
  answer: string;
  model_display_name: string;
  model_id: string;
  usage: Record<string, unknown>;
  latency_ms?: number | null;
  citations?: ChatCitation[];
  generated_files?: ChatGeneratedFile[];
};

export type ChatMessageStatusPayload = {
  message_uuid: string;
  status: string;
  citations?: ChatCitation[];
  generated_files?: ChatGeneratedFile[];
};

export type LongTaskPayload = {
  task_id: string;
  task_type: string;
  title: string;
  conversation_id: string;
  message_uuid: string;
  status: 'queued' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled' | 'retrying';
  stage: string;
  progress: number;
  attempt: number;
  draft: string;
  error_code: string;
  error_message: string;
  next_action?: string;
  retry_allowed: boolean;
  cancel_allowed: boolean;
  created_at: string;
  updated_at: string;
};

export type LongTaskNotificationPayload = {
  notification_uuid: string;
  task_id: string;
  title: string;
  conversation_id: string;
  message_uuid: string;
  task_status: 'completed' | 'failed' | 'waiting_user';
  attempt: number;
  unread: boolean;
  replayed: boolean;
  created_at: string;
  read_at?: string | null;
};

type ChatGenerateStreamEvent =
  | { type: 'delta'; delta: string }
  | ({ type: 'complete' } & ChatGeneratePayload)
  | { type: 'error'; detail?: string };

export type ServerModelStatusPayload = {
  configured: boolean;
  model_display_name: string;
  model_id: string;
  message: string;
};

export type UserModelProfilePayload = {
  uuid: string;
  display_name: string;
  base_url: string;
  model_id: string;
  temperature: number;
  max_output_tokens: number;
  timeout_seconds: number;
  is_default: boolean;
  has_api_key: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export type UserModelProfileListPayload = {
  items: UserModelProfilePayload[];
  total: number;
};

export type UserModelProfileSavePayload = {
  profileUuid?: string;
  displayName: string;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutSeconds?: number;
  isDefault?: boolean;
};

export type ChatExportType =
  | 'single_answer'
  | 'selected_messages'
  | 'full_conversation'
  | 'formal_document';

export type ChatWordDownloadResult =
  | { kind: 'desktop'; path: string }
  | { kind: 'browser' };

export type ChatKnowledgeResultPayload = {
  session_uuid: string;
  user_message_uuid: string;
  assistant_message_uuid: string;
};

export type WebCapturePreviewPayload = {
  capture_id: string;
  title: string;
  site_name: string;
  url: string;
  final_url: string;
  fetched_at: string;
  published_at?: string;
  word_count: number;
  summary: string;
  suggested_category: string;
  suggested_document_type: string;
  validity: string;
  scope: string;
};

export type WebCaptureConfirmPayload = {
  capture_id: string;
  status: string;
  save_target: string;
  knowledge_file_uuid?: string;
  message: string;
};

async function readJson<T>(response: Response, code: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) throw new ApiError(response.status, code, payload);
  return payload as T;
}

function projectQuery(projectUuid?: string): string {
  return projectUuid ? `?project_uuid=${encodeURIComponent(projectUuid)}` : '';
}

function paginatedProjectQuery(
  projectUuid?: string,
  options: { page?: number; pageSize?: number; query?: string } = {},
): string {
  const params = new URLSearchParams();
  if (projectUuid) params.set('project_uuid', projectUuid);
  if (options.query?.trim()) params.set('query', options.query.trim());
  params.set('page', String(options.page ?? 1));
  params.set('page_size', String(options.pageSize ?? 40));
  return `?${params.toString()}`;
}

export async function getChatSessionsByKind(
  kind: ChatSessionListKind,
  projectUuid?: string,
  options: { page?: number; pageSize?: number; query?: string } = {},
): Promise<{
  items: ChatSessionPayload[];
  total: number;
  page: number;
  page_size: number;
}> {
  const path = kind === 'active'
    ? '/api/conversations'
    : kind === 'archived'
      ? '/api/conversations/archived'
      : '/api/conversations/trash';
  return readJson(
    await apiFetch(`${path}${paginatedProjectQuery(projectUuid, options)}`, { cache: 'no-store' }),
    'CHAT_SESSIONS_FAILED',
  );
}

export async function createChatSession(projectUuid?: string): Promise<ChatSessionPayload> {
  return readJson(
    await apiFetch(`/api/conversations${projectQuery(projectUuid)}`, { method: 'POST' }),
    'CHAT_SESSION_CREATE_FAILED',
  );
}

export async function archiveChatSession(sessionUuid: string, projectUuid?: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/archive${projectQuery(projectUuid)}`, {
      method: 'POST',
    }),
    'CHAT_SESSION_ARCHIVE_FAILED',
  );
}

export async function renameChatSession(sessionUuid: string, title: string, projectUuid?: string): Promise<ChatSessionPayload> {
  return readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/rename${projectQuery(projectUuid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ title }),
    }),
    'CHAT_SESSION_RENAME_FAILED',
  );
}

export async function restoreChatSession(sessionUuid: string, projectUuid?: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/restore${projectQuery(projectUuid)}`, {
      method: 'POST',
    }),
    'CHAT_SESSION_RESTORE_FAILED',
  );
}

export async function deleteChatSession(sessionUuid: string, projectUuid?: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/delete${projectQuery(projectUuid)}`, {
      method: 'POST',
    }),
    'CHAT_SESSION_DELETE_FAILED',
  );
}

export async function hardDeleteChatSession(sessionUuid: string, projectUuid?: string): Promise<void> {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/hard-delete${projectQuery(projectUuid)}`, {
    method: 'DELETE',
  });
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  if (!response.ok) throw new ApiError(response.status, 'CHAT_SESSION_HARD_DELETE_FAILED');
}

export async function bulkArchiveChatSessions(sessionUuids: string[], projectUuid?: string): Promise<number> {
  const payload = await readJson<{ affected: number }>(
    await apiFetch(`/api/conversations/bulk-archive${projectQuery(projectUuid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ conversation_ids: sessionUuids }),
    }),
    'CHAT_SESSION_BULK_ARCHIVE_FAILED',
  );
  return payload.affected;
}

export async function bulkDeleteChatSessions(sessionUuids: string[], projectUuid?: string): Promise<number> {
  const payload = await readJson<{ affected: number }>(
    await apiFetch(`/api/conversations/bulk-delete${projectQuery(projectUuid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_ids: sessionUuids }),
    }),
    'CHAT_SESSION_BULK_DELETE_FAILED',
  );
  return payload.affected;
}

export async function getChatSession(sessionUuid: string, projectUuid?: string): Promise<ChatSessionDetailPayload> {
  return readJson(
    await apiFetch(`/api/ai/chat/sessions/${encodeURIComponent(sessionUuid)}${projectQuery(projectUuid)}`),
    'CHAT_SESSION_FAILED',
  );
}

export async function prepareChat(payload: {
  sessionUuid?: string;
  question: string;
  mode: ChatModeSelection;
  topK?: number;
  attachmentFileIds?: string[];
  personalReferenceFileIds?: string[];
  includePersonalReferences?: boolean;
  includeSessionAttachments?: boolean;
  projectUuid?: string;
}): Promise<ChatPreparePayload> {
  return readJson(
    await apiFetch('/api/ai/chat/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(payload.sessionUuid ? { session_uuid: payload.sessionUuid } : {}),
        question: payload.question,
        mode: payload.mode,
        top_k: payload.topK ?? 8,
        attachment_file_ids: payload.attachmentFileIds ?? [],
        personal_reference_file_ids: payload.personalReferenceFileIds ?? [],
        include_personal_references: payload.includePersonalReferences ?? false,
        include_session_attachments: payload.includeSessionAttachments ?? false,
        ...(payload.projectUuid ? { project_uuid: payload.projectUuid } : {}),
      }),
    }),
    'CHAT_PREPARE_FAILED',
  );
}

export async function listLongTasks(
  options: { page?: number; pageSize?: number } = {},
): Promise<{ items: LongTaskPayload[]; total: number; page: number; page_size: number }> {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    page_size: String(options.pageSize ?? 50),
  });
  return readJson(
    await apiFetch(`/api/ai/long-tasks?${params.toString()}`, { cache: 'no-store' }),
    'LONG_TASKS_FAILED',
  );
}

export async function listLongTaskNotifications(
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<{
  items: LongTaskNotificationPayload[];
  total: number;
  unread_count: number;
}> {
  const params = new URLSearchParams({
    unread_only: String(options.unreadOnly ?? true),
    limit: String(options.limit ?? 20),
  });
  return readJson(
    await apiFetch(`/api/ai/long-tasks/notifications?${params.toString()}`, {
      cache: 'no-store',
    }),
    'LONG_TASK_NOTIFICATIONS_FAILED',
  );
}

export async function markLongTaskNotificationRead(
  notificationId: string,
): Promise<LongTaskNotificationPayload> {
  return readJson(
    await apiFetch(
      `/api/ai/long-tasks/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'POST' },
    ),
    'LONG_TASK_NOTIFICATION_READ_FAILED',
  );
}

export async function createLongChatTask(payload: {
  conversationId: string;
  messageUuid: string;
  completionToken: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  title: string;
}): Promise<LongTaskPayload> {
  return readJson(
    await apiFetch('/api/ai/long-tasks/chat-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: payload.conversationId,
        message_uuid: payload.messageUuid,
        completion_token: payload.completionToken,
        messages: payload.messages,
        temperature: payload.temperature,
        title: payload.title,
      }),
    }),
    'LONG_TASK_CREATE_FAILED',
  );
}

export async function cancelLongTask(taskId: string): Promise<LongTaskPayload> {
  return readJson(
    await apiFetch(`/api/ai/long-tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),
    'LONG_TASK_CANCEL_FAILED',
  );
}

export async function retryLongTask(taskId: string): Promise<LongTaskPayload> {
  return readJson(
    await apiFetch(`/api/ai/long-tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' }),
    'LONG_TASK_RETRY_FAILED',
  );
}

export async function previewWebCapture(payload: {
  url: string;
  conversationId?: string;
  idempotencyKey?: string;
}): Promise<WebCapturePreviewPayload> {
  return readJson(
    await apiFetch('/api/web/captures/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.idempotencyKey ?? crypto.randomUUID(),
      },
      body: JSON.stringify({
        url: payload.url,
        conversation_id: payload.conversationId ?? '',
      }),
    }),
    'WEB_CAPTURE_PREVIEW_FAILED',
  );
}

export async function confirmWebCapture(
  captureId: string,
  payload: {
    saveTarget: 'temporary' | 'personal_reference' | 'official_knowledge_candidate' | 'cancel';
    category?: string;
    documentType?: string;
    tags?: string[];
    conversationId?: string;
    idempotencyKey?: string;
  },
): Promise<WebCaptureConfirmPayload> {
  return readJson(
    await apiFetch(`/api/web/captures/${encodeURIComponent(captureId)}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.idempotencyKey ?? crypto.randomUUID(),
      },
      body: JSON.stringify({
        save_target: payload.saveTarget,
        category: payload.category ?? '',
        document_type: payload.documentType ?? '',
        tags: payload.tags ?? [],
        conversation_id: payload.conversationId ?? '',
      }),
    }),
    'WEB_CAPTURE_CONFIRM_FAILED',
  );
}

export async function completeChatMessage(
  messageUuid: string,
  payload: {
    completionToken: string;
    answer: string;
    modelDisplayName: string;
    modelId: string;
    usage?: Record<string, unknown>;
    latencyMs?: number;
  },
): Promise<ChatMessageStatusPayload> {
  return readJson(
    await apiFetch(`/api/ai/chat/messages/${encodeURIComponent(messageUuid)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completion_token: payload.completionToken,
        answer: payload.answer,
        model_display_name: payload.modelDisplayName,
        model_id: payload.modelId,
        usage: payload.usage ?? {},
        latency_ms: payload.latencyMs ?? null,
      }),
    }),
    'CHAT_COMPLETE_FAILED',
  );
}

export async function failChatMessage(
  messageUuid: string,
  payload: {
    completionToken: string;
    errorCode: string;
    errorMessage?: string;
  },
): Promise<ChatMessageStatusPayload> {
  return readJson(
    await apiFetch(`/api/ai/chat/messages/${encodeURIComponent(messageUuid)}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completion_token: payload.completionToken,
        error_code: payload.errorCode,
        error_message: payload.errorMessage ?? null,
      }),
    }),
    'CHAT_FAIL_FAILED',
  );
}

export async function generateChatMessage(
  messageUuid: string,
  payload: {
    completionToken: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
  },
): Promise<ChatGeneratePayload> {
  return readJson(
    await apiFetch(`/api/ai/chat/messages/${encodeURIComponent(messageUuid)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completion_token: payload.completionToken,
        messages: payload.messages,
        temperature: payload.temperature ?? 0.3,
      }),
    }),
    'CHAT_GENERATE_FAILED',
  );
}

function parseChatGenerateStreamLine(line: string): ChatGenerateStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const payload = JSON.parse(trimmed) as ChatGenerateStreamEvent;
  if (payload.type === 'delta' || payload.type === 'complete' || payload.type === 'error') {
    return payload;
  }
  return null;
}

export async function streamChatMessage(
  messageUuid: string,
  payload: {
    completionToken: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    signal?: AbortSignal;
  },
  onDelta: (delta: string) => void,
): Promise<ChatGeneratePayload> {
  const response = await apiFetch(`/api/ai/chat/messages/${encodeURIComponent(messageUuid)}/generate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      completion_token: payload.completionToken,
      messages: payload.messages,
      temperature: payload.temperature ?? 0.3,
    }),
    signal: payload.signal,
  });
  if (response.status === 401) {
    const errorPayload = await response.json().catch(() => null);
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', errorPayload);
  }
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new ApiError(response.status, 'CHAT_GENERATE_FAILED', errorPayload);
  }
  if (!response.body) {
    throw new ApiError(502, 'CHAT_GENERATE_STREAM_UNAVAILABLE', null);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let completePayload: ChatGeneratePayload | null = null;

  const handleLine = (line: string) => {
    const event = parseChatGenerateStreamLine(line);
    if (!event) return;
    if (event.type === 'delta') {
      onDelta(event.delta);
      return;
    }
    if (event.type === 'error') {
      throw new ApiError(502, 'CHAT_GENERATE_FAILED', event);
    }
    completePayload = {
      message_uuid: event.message_uuid,
      status: event.status,
      answer: event.answer,
      model_display_name: event.model_display_name,
      model_id: event.model_id,
      usage: event.usage,
      latency_ms: event.latency_ms,
      citations: event.citations,
      generated_files: event.generated_files,
    };
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      handleLine(line);
    }
  }
  buffer += decoder.decode();
  handleLine(buffer);

  if (!completePayload) {
    throw new ApiError(502, 'CHAT_GENERATE_STREAM_INCOMPLETE', null);
  }
  return completePayload;
}

export async function getServerModelStatus(): Promise<ServerModelStatusPayload> {
  return readJson(
    await apiFetch('/api/ai/chat/model/status', { cache: 'no-store' }),
    'SERVER_MODEL_STATUS_FAILED',
  );
}

export async function listUserModelProfiles(): Promise<UserModelProfileListPayload> {
  return readJson(
    await apiFetch('/api/ai/model-profiles', { cache: 'no-store' }),
    'USER_MODEL_PROFILES_FAILED',
  );
}

export async function saveUserModelProfile(
  payload: UserModelProfileSavePayload,
): Promise<UserModelProfilePayload> {
  const path = payload.profileUuid
    ? `/api/ai/model-profiles/${encodeURIComponent(payload.profileUuid)}`
    : '/api/ai/model-profiles';
  return readJson(
    await apiFetch(path, {
      method: payload.profileUuid ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: payload.displayName,
        base_url: payload.baseUrl,
        model_id: payload.modelId,
        api_key: payload.apiKey || undefined,
        temperature: payload.temperature ?? 0.3,
        max_output_tokens: payload.maxOutputTokens ?? 8192,
        timeout_seconds: payload.timeoutSeconds ?? 300,
        is_default: payload.isDefault ?? false,
      }),
    }),
    'USER_MODEL_PROFILE_SAVE_FAILED',
  );
}

export async function setDefaultUserModelProfile(profileUuid: string): Promise<UserModelProfilePayload> {
  return readJson(
    await apiFetch(`/api/ai/model-profiles/${encodeURIComponent(profileUuid)}/default`, {
      method: 'POST',
    }),
    'USER_MODEL_PROFILE_DEFAULT_FAILED',
  );
}

export async function deleteUserModelProfile(profileUuid: string): Promise<void> {
  const response = await apiFetch(`/api/ai/model-profiles/${encodeURIComponent(profileUuid)}`, {
    method: 'DELETE',
  });
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', null);
  }
  if (!response.ok) throw new ApiError(response.status, 'USER_MODEL_PROFILE_DELETE_FAILED', null);
}

export type UploadKnowledgeFileOptions = {
  knowledgeBaseId?: string;
  usageType?: 'session_attachment' | 'personal_reference' | 'official_knowledge' | 'skill_input';
  reviewStatus?: 'draft' | 'pending' | 'official';
  ragEnabled?: boolean;
  referenceEnabled?: boolean;
  ragScope?: 'none' | 'session' | 'personal' | 'company' | 'department' | 'project';
  permissionScope?: 'private' | 'company' | 'department' | 'project' | 'admin';
  conversationId?: string;
  category?: string;
  documentType?: string;
  tags?: string[];
};

export async function uploadKnowledgeFile(
  file: File,
  options: UploadKnowledgeFileOptions = {},
): Promise<KnowledgeFilePayload> {
  const usageType = options.usageType ?? 'personal_reference';
  const reviewStatus = options.reviewStatus ?? 'draft';
  const form = new FormData();
  form.append('file', file);
  if (options.knowledgeBaseId) form.append('knowledge_base_id', options.knowledgeBaseId);
  form.append('usage_type', usageType);
  form.append('review_status', reviewStatus);
  form.append('rag_enabled', String(options.ragEnabled ?? false));
  form.append('reference_enabled', String(options.referenceEnabled ?? true));
  form.append(
    'rag_scope',
    options.ragScope
      ?? (usageType === 'session_attachment' ? 'session' : usageType === 'skill_input' ? 'none' : 'personal'),
  );
  form.append('permission_scope', options.permissionScope ?? 'private');
  form.append(
    'category',
    options.category
      ?? (usageType === 'session_attachment' ? '当前附件' : usageType === 'skill_input' ? 'Skill 输入' : '个人素材'),
  );
  form.append('document_type', options.documentType ?? '其他');
  form.append('tags', options.tags?.join(',') ?? '');
  if (options.conversationId) form.append('conversation_id', options.conversationId);
  return readJson(
    await apiFetch('/api/knowledge/files/upload', {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
    'KNOWLEDGE_FILE_UPLOAD_FAILED',
  );
}

export async function listKnowledgeFiles(): Promise<KnowledgeFileListPayload> {
  return readJson(
    await apiFetch('/api/knowledge/files', { cache: 'no-store' }),
    'KNOWLEDGE_FILES_FAILED',
  );
}

export type KnowledgeFileClassificationPayload = {
  file_uuid: string;
  category: string;
  document_type: string;
  tags: string[];
  applied: boolean;
};

export async function classifyKnowledgeFile(
  fileUuid: string,
  apply = true,
): Promise<KnowledgeFileClassificationPayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply }),
    }),
    'KNOWLEDGE_FILE_CLASSIFY_FAILED',
  );
}

export async function listKnowledgeBases(): Promise<KnowledgeBaseListPayload> {
  return readJson(
    await apiFetch('/api/knowledge/bases', { cache: 'no-store' }),
    'KNOWLEDGE_BASES_FAILED',
  );
}

export async function createKnowledgeBase(
  payload: KnowledgeBaseCreatePayload,
): Promise<KnowledgeBasePayload> {
  return readJson(
    await apiFetch('/api/knowledge/bases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'KNOWLEDGE_BASE_CREATE_FAILED',
  );
}

export async function listKnowledgeCategories(
  includeDisabled = false,
): Promise<KnowledgeCategoryListPayload> {
  const query = includeDisabled ? '?include_disabled=true' : '';
  return readJson(
    await apiFetch(`/api/knowledge/categories${query}`, { cache: 'no-store' }),
    'KNOWLEDGE_CATEGORIES_FAILED',
  );
}

export async function createKnowledgeCategory(
  payload: KnowledgeCategoryCreatePayload,
): Promise<KnowledgeCategoryPayload> {
  return readJson(
    await apiFetch('/api/knowledge/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'KNOWLEDGE_CATEGORY_CREATE_FAILED',
  );
}

export async function updateKnowledgeCategory(
  categoryId: string,
  payload: KnowledgeCategoryUpdatePayload,
): Promise<KnowledgeCategoryPayload> {
  return readJson(
    await apiFetch(`/api/knowledge/categories/${encodeURIComponent(categoryId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'KNOWLEDGE_CATEGORY_UPDATE_FAILED',
  );
}

export async function deleteKnowledgeCategory(categoryId: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/knowledge/categories/${encodeURIComponent(categoryId)}`, {
      method: 'DELETE',
    }),
    'KNOWLEDGE_CATEGORY_DELETE_FAILED',
  );
}

export async function listKnowledgeDocumentTypes(
  includeDisabled = false,
): Promise<KnowledgeDocumentTypeListPayload> {
  const query = includeDisabled ? '?include_disabled=true' : '';
  return readJson(
    await apiFetch(`/api/knowledge/document-types${query}`, { cache: 'no-store' }),
    'KNOWLEDGE_DOCUMENT_TYPES_FAILED',
  );
}

export async function createKnowledgeDocumentType(
  payload: KnowledgeDocumentTypeCreatePayload,
): Promise<KnowledgeDocumentTypePayload> {
  return readJson(
    await apiFetch('/api/knowledge/document-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'KNOWLEDGE_DOCUMENT_TYPE_CREATE_FAILED',
  );
}

export async function updateKnowledgeDocumentType(
  documentTypeId: string,
  payload: KnowledgeDocumentTypeUpdatePayload,
): Promise<KnowledgeDocumentTypePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/document-types/${encodeURIComponent(documentTypeId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'KNOWLEDGE_DOCUMENT_TYPE_UPDATE_FAILED',
  );
}

export async function deleteKnowledgeDocumentType(documentTypeId: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/knowledge/document-types/${encodeURIComponent(documentTypeId)}`, {
      method: 'DELETE',
    }),
    'KNOWLEDGE_DOCUMENT_TYPE_DELETE_FAILED',
  );
}

export async function listKnowledgeFileTrash(): Promise<KnowledgeFileListPayload> {
  return readJson(
    await apiFetch('/api/knowledge/files/trash', { cache: 'no-store' }),
    'KNOWLEDGE_FILE_TRASH_FAILED',
  );
}

export async function previewKnowledgeFile(
  fileUuid: string,
  options: { chunkId?: string; topK?: number; page?: number; pageSize?: number } = {},
): Promise<KnowledgeFilePreviewPayload> {
  const query = new URLSearchParams();
  if (options.chunkId) query.set('chunk_id', options.chunkId);
  if (options.topK) query.set('top_k', String(options.topK));
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('page_size', String(options.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/preview${suffix}`),
    'KNOWLEDGE_FILE_PREVIEW_FAILED',
  );
}

export async function summarizeKnowledgeFile(
  fileUuid: string,
  options: { mode?: ChatMode; topK?: number; includeSources?: boolean } = {},
): Promise<KnowledgeFileActionPayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: options.mode ?? 'normal',
        top_k: options.topK ?? 6,
        include_sources: options.includeSources ?? true,
      }),
    }),
    'KNOWLEDGE_FILE_SUMMARY_FAILED',
  );
}

export async function askKnowledgeFile(
  fileUuid: string,
  question: string,
  options: { mode?: ChatMode; topK?: number; includeSources?: boolean } = {},
): Promise<KnowledgeFileActionPayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        mode: options.mode ?? 'normal',
        top_k: options.topK ?? 6,
        include_sources: options.includeSources ?? true,
      }),
    }),
    'KNOWLEDGE_FILE_ASK_FAILED',
  );
}

export async function searchKnowledge(
  question: string,
  options: { mode?: ChatMode; topK?: number; includeSources?: boolean } = {},
): Promise<KnowledgeSearchPayload> {
  return readJson(
    await apiFetch('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        mode: options.mode ?? 'knowledge',
        top_k: options.topK ?? 8,
        include_sources: options.includeSources ?? true,
      }),
    }),
    'KNOWLEDGE_SEARCH_FAILED',
  );
}

export async function askKnowledge(
  question: string,
  options: { mode?: ChatMode; topK?: number; includeSources?: boolean } = {},
): Promise<KnowledgeFileActionPayload> {
  return readJson(
    await apiFetch('/api/knowledge/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        mode: options.mode ?? 'knowledge',
        top_k: options.topK ?? 8,
        include_sources: options.includeSources ?? true,
      }),
    }),
    'KNOWLEDGE_ASK_FAILED',
  );
}

export async function searchPersonalReference(
  question: string,
  options: { conversationId?: string; fileIds?: string[]; topK?: number } = {},
): Promise<PersonalReferenceSearchPayload> {
  return readJson(
    await apiFetch('/api/personal-reference/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        top_k: options.topK ?? 8,
        ...(options.conversationId ? { conversation_id: options.conversationId } : {}),
        ...(options.fileIds?.length ? { file_ids: options.fileIds } : {}),
      }),
    }),
    'PERSONAL_REFERENCE_SEARCH_FAILED',
  );
}

export async function generatePersonalReference(
  question: string,
  options: { conversationId?: string; fileIds?: string[]; mode?: ChatMode; topK?: number } = {},
): Promise<KnowledgeFileActionPayload> {
  return readJson(
    await apiFetch('/api/personal-reference/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        mode: options.mode ?? 'normal',
        top_k: options.topK ?? 8,
        ...(options.conversationId ? { conversation_id: options.conversationId } : {}),
        ...(options.fileIds?.length ? { file_ids: options.fileIds } : {}),
      }),
    }),
    'PERSONAL_REFERENCE_GENERATE_FAILED',
  );
}

export async function listPendingKnowledgeReviews(): Promise<KnowledgeFileListPayload> {
  return readJson(
    await apiFetch('/api/knowledge/reviews/pending', { cache: 'no-store' }),
    'KNOWLEDGE_REVIEW_PENDING_FAILED',
  );
}

export async function listKnowledgeReviewHistory(): Promise<KnowledgeReviewHistoryPayload> {
  return readJson(
    await apiFetch('/api/knowledge/reviews/history', { cache: 'no-store' }),
    'KNOWLEDGE_REVIEW_HISTORY_FAILED',
  );
}

export async function enableKnowledgeFileRag(fileUuid: string): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/enable-rag`, {
      method: 'POST',
    }),
    'KNOWLEDGE_FILE_ENABLE_RAG_FAILED',
  );
}

export async function disableKnowledgeFileRag(fileUuid: string): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/disable-rag`, {
      method: 'POST',
    }),
    'KNOWLEDGE_FILE_DISABLE_RAG_FAILED',
  );
}

export async function reparseKnowledgeFile(fileUuid: string): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/reparse`, {
      method: 'POST',
    }),
    'KNOWLEDGE_FILE_REPARSE_FAILED',
  );
}

export async function archiveKnowledgeFile(fileUuid: string): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/archive`, {
      method: 'POST',
    }),
    'KNOWLEDGE_FILE_ARCHIVE_FAILED',
  );
}

export type KnowledgeFileMetadataUpdatePayload = {
  fileName?: string;
  category?: string;
  documentType?: string;
  tags?: string[];
  externalPublic?: boolean;
  externalDownloadAllowed?: boolean;
};

export async function updateKnowledgeFileMetadata(
  fileUuid: string,
  payload: KnowledgeFileMetadataUpdatePayload,
): Promise<KnowledgeFilePayload> {
  const body: Record<string, unknown> = {};
  if (payload.fileName !== undefined) {
    body.file_name = payload.fileName;
  }
  if (payload.category !== undefined) {
    body.category = payload.category;
  }
  if (payload.documentType !== undefined) {
    body.document_type = payload.documentType;
  }
  if (payload.tags !== undefined) {
    body.tags = payload.tags;
  }
  if (payload.externalPublic !== undefined) {
    body.external_public = payload.externalPublic;
  }
  if (payload.externalDownloadAllowed !== undefined) {
    body.external_download_allowed = payload.externalDownloadAllowed;
  }
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'KNOWLEDGE_FILE_UPDATE_METADATA_FAILED',
  );
}

export async function restoreKnowledgeFile(fileUuid: string): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/restore`, {
      method: 'POST',
    }),
    'KNOWLEDGE_FILE_RESTORE_FAILED',
  );
}

export function knowledgeFileDownloadUrl(fileUuid: string): string {
  return `/api/knowledge/files/${encodeURIComponent(fileUuid)}/download`;
}

export async function deleteKnowledgeFile(fileUuid: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}`, {
      method: 'DELETE',
    }),
    'KNOWLEDGE_FILE_DELETE_FAILED',
  );
}

export async function listKnowledgeFileVersions(
  fileUuid: string,
): Promise<KnowledgeFileVersionTimelinePayload> {
  return readJson(
    await apiFetch(`/api/ai/knowledge/files/${encodeURIComponent(fileUuid)}/versions`),
    'KNOWLEDGE_FILE_VERSION_LIST_FAILED',
  );
}

export async function activateKnowledgeFileVersion(
  fileUuid: string,
): Promise<KnowledgeFileVersionTimelinePayload> {
  return readJson(
    await apiFetch(`/api/ai/knowledge/files/${encodeURIComponent(fileUuid)}/versions/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: '' }),
    }),
    'KNOWLEDGE_FILE_VERSION_ACTIVATE_FAILED',
  );
}

export async function hardDeleteKnowledgeFile(fileUuid: string): Promise<void> {
  const response = await apiFetch(
    `/api/knowledge/files/${encodeURIComponent(fileUuid)}/hard-delete?confirm=true`,
    { method: 'DELETE' },
  );
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  if (!response.ok) throw new ApiError(response.status, 'KNOWLEDGE_FILE_HARD_DELETE_FAILED');
}

export async function submitKnowledgeFileForReview(
  fileUuid: string,
  comment = '',
): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/submit-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    }),
    'KNOWLEDGE_FILE_SUBMIT_REVIEW_FAILED',
  );
}

export type KnowledgeReviewDecisionPayload = {
  knowledgeBaseId: string;
  comment?: string;
  permissionScope?: 'company' | 'department' | 'project' | 'admin';
  ragScope?: 'company' | 'department' | 'project';
  category?: string;
  documentType?: string;
  tags?: string[];
};

export async function approveKnowledgeFileReview(
  fileUuid: string,
  payload: KnowledgeReviewDecisionPayload,
): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledge_base_id: payload.knowledgeBaseId,
        comment: payload.comment ?? '',
        permission_scope: payload.permissionScope ?? 'company',
        rag_scope: payload.ragScope ?? 'company',
        category: payload.category ?? '',
        document_type: payload.documentType ?? '',
        tags: payload.tags ?? [],
      }),
    }),
    'KNOWLEDGE_FILE_APPROVE_REVIEW_FAILED',
  );
}

export async function rejectKnowledgeFileReview(
  fileUuid: string,
  comment = '',
): Promise<KnowledgeFilePayload> {
  return readJson(
    await apiFetch(`/api/knowledge/files/${encodeURIComponent(fileUuid)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    }),
    'KNOWLEDGE_FILE_REJECT_REVIEW_FAILED',
  );
}

export async function exportChatWord(payload: {
  conversationId: string;
  messageId?: string;
  selectedMessageIds?: string[];
  exportType: ChatExportType;
  formattedContent?: string;
}): Promise<ChatWordDownloadResult> {
  const meta = await readJson<{ file_name: string; download_url: string }>(
    await apiFetch('/api/export/word', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        conversation_id: payload.conversationId,
        ...(payload.messageId ? { message_id: payload.messageId } : {}),
        selected_message_ids: payload.selectedMessageIds ?? [],
        export_type: payload.exportType,
        template: 'juxin_standard',
        format_before_export: payload.exportType === 'formal_document',
        ...(payload.formattedContent ? { formatted_content: payload.formattedContent } : {}),
      }),
    }),
    'CHAT_WORD_EXPORT_FAILED',
  );
  return downloadWordExport(meta);
}

export async function exportKnowledgeContentWord(payload: {
  title: string;
  content: string;
  sources: KnowledgeFileSourcePayload[];
}): Promise<ChatWordDownloadResult> {
  const meta = await readJson<{ file_name: string; download_url: string }>(
    await apiFetch('/api/export/word/content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        title: payload.title,
        content: payload.content,
        template: 'juxin_standard',
        sources: payload.sources,
      }),
    }),
    'KNOWLEDGE_WORD_EXPORT_FAILED',
  );
  return downloadWordExport(meta);
}

export async function saveKnowledgeResultToChat(payload: {
  question: string;
  answer: string;
  mode?: ChatMode;
  sources: KnowledgeFileSourcePayload[];
}): Promise<ChatKnowledgeResultPayload> {
  return readJson(
    await apiFetch('/api/ai/chat/knowledge-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: payload.question,
        answer: payload.answer,
        mode: payload.mode ?? 'normal',
        sources: payload.sources,
      }),
    }),
    'KNOWLEDGE_RESULT_SAVE_CHAT_FAILED',
  );
}

async function downloadWordExport(meta: {
  file_name: string;
  download_url: string;
}): Promise<ChatWordDownloadResult> {
  if (!isSafeSameOriginUrl(meta.download_url)) {
    throw new ApiError(400, 'CHAT_WORD_DOWNLOAD_UNSAFE_URL');
  }
  const response = await apiFetch(meta.download_url);
  if (!response.ok) throw new ApiError(response.status, 'CHAT_WORD_DOWNLOAD_FAILED');
  if (isDesktopRuntime()) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileName = readAttachmentFileName(response.headers) || meta.file_name || '聚信得仁文档.docx';
    const path = await saveWordBytesToDesktop(fileName, bytes);
    return { kind: 'desktop', path };
  }
  await downloadBlobFromResponse(response, meta.file_name || '聚信得仁文档.docx');
  return { kind: 'browser' };
}

function readAttachmentFileName(headers: Headers): string {
  const value = headers.get('Content-Disposition') || '';
  const encoded = value
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("filename*="));
  if (encoded) {
    const raw = encoded.slice(encoded.indexOf("''") + 2);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  const fileName = value
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('filename='));
  return fileName ? fileName.slice(fileName.indexOf('=') + 1).replace(/^"|"$/g, '') : '';
}

import { invoke } from '@tauri-apps/api/core';

import { ApiError, apiFetch, getAuthPortalUrl } from './client';
import type { LoopTraceStep } from './agentLoop';

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
};

export type ChatMessagePayload = {
  message_uuid: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  citations: ChatCitation[];
  created_at: string;
};

export type ChatSessionPayload = {
  session_uuid: string;
  title: string;
  mode: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ChatSessionListKind = 'active' | 'archived' | 'trash';

export type ChatSessionDetailPayload = ChatSessionPayload & {
  messages: ChatMessagePayload[];
};

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
  source_type?: string;
  usage_type?: 'session_attachment' | 'personal_reference' | 'official_knowledge';
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
  chunks: KnowledgeFilePreviewChunkPayload[];
  total_chunks: number;
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

export type ChatPreparePayload = {
  session_uuid: string;
  user_message_uuid: string;
  assistant_message_uuid: string;
  completion_token: string;
  completed: boolean;
  answer: string;
  messages: Array<{ role: string; content: string }>;
  citations: ChatCitation[];
  loop_trace?: LoopTraceStep[];
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

export async function getChatSessions(): Promise<{
  items: ChatSessionPayload[];
  total: number;
}> {
  return readJson(
    await apiFetch('/api/conversations', { cache: 'no-store' }),
    'CHAT_SESSIONS_FAILED',
  );
}

export async function getChatSessionsByKind(kind: ChatSessionListKind): Promise<{
  items: ChatSessionPayload[];
  total: number;
}> {
  const path = kind === 'active'
    ? '/api/conversations'
    : kind === 'archived'
      ? '/api/conversations/archived'
      : '/api/conversations/trash';
  return readJson(await apiFetch(path, { cache: 'no-store' }), 'CHAT_SESSIONS_FAILED');
}

export async function archiveChatSession(sessionUuid: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/archive`, {
      method: 'POST',
    }),
    'CHAT_SESSION_ARCHIVE_FAILED',
  );
}

export async function renameChatSession(sessionUuid: string, title: string): Promise<ChatSessionPayload> {
  return readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
    'CHAT_SESSION_RENAME_FAILED',
  );
}

export async function restoreChatSession(sessionUuid: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/restore`, {
      method: 'POST',
    }),
    'CHAT_SESSION_RESTORE_FAILED',
  );
}

export async function deleteChatSession(sessionUuid: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/delete`, {
      method: 'POST',
    }),
    'CHAT_SESSION_DELETE_FAILED',
  );
}

export async function hardDeleteChatSession(sessionUuid: string): Promise<void> {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(sessionUuid)}/hard-delete`, {
    method: 'DELETE',
  });
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  if (!response.ok) throw new ApiError(response.status, 'CHAT_SESSION_HARD_DELETE_FAILED');
}

export async function bulkArchiveChatSessions(sessionUuids: string[]): Promise<number> {
  const payload = await readJson<{ affected: number }>(
    await apiFetch('/api/conversations/bulk-archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_ids: sessionUuids }),
    }),
    'CHAT_SESSION_BULK_ARCHIVE_FAILED',
  );
  return payload.affected;
}

export async function bulkDeleteChatSessions(sessionUuids: string[]): Promise<number> {
  const payload = await readJson<{ affected: number }>(
    await apiFetch('/api/conversations/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_ids: sessionUuids }),
    }),
    'CHAT_SESSION_BULK_DELETE_FAILED',
  );
  return payload.affected;
}

export async function getChatSession(sessionUuid: string): Promise<ChatSessionDetailPayload> {
  return readJson(
    await apiFetch(`/api/ai/chat/sessions/${encodeURIComponent(sessionUuid)}`),
    'CHAT_SESSION_FAILED',
  );
}

export async function prepareChat(payload: {
  sessionUuid?: string;
  question: string;
  mode: ChatMode;
  topK?: number;
  includePersonalReferences?: boolean;
  includeSessionAttachments?: boolean;
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
        include_personal_references: payload.includePersonalReferences ?? false,
        include_session_attachments: payload.includeSessionAttachments ?? false,
      }),
    }),
    'CHAT_PREPARE_FAILED',
  );
}

export async function previewWebCapture(payload: {
  url: string;
  conversationId?: string;
}): Promise<WebCapturePreviewPayload> {
  return readJson(
    await apiFetch('/api/web/captures/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  },
): Promise<WebCaptureConfirmPayload> {
  return readJson(
    await apiFetch(`/api/web/captures/${encodeURIComponent(captureId)}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
): Promise<void> {
  await readJson(
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

export type UploadKnowledgeFileOptions = {
  knowledgeBaseId?: string;
  usageType?: 'session_attachment' | 'personal_reference' | 'official_knowledge';
  reviewStatus?: 'draft' | 'pending' | 'official';
  ragEnabled?: boolean;
  referenceEnabled?: boolean;
  ragScope?: 'session' | 'personal' | 'company' | 'department' | 'project';
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
  form.append('rag_scope', options.ragScope ?? (usageType === 'session_attachment' ? 'session' : 'personal'));
  form.append('permission_scope', options.permissionScope ?? 'private');
  form.append('category', options.category ?? (usageType === 'session_attachment' ? '当前附件' : '个人素材'));
  form.append('document_type', options.documentType ?? '其他');
  form.append('tags', options.tags?.join(',') ?? '');
  if (options.conversationId) form.append('conversation_id', options.conversationId);
  return readJson(
    await apiFetch('/api/knowledge/files/upload', {
      method: 'POST',
      body: form,
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
  options: { chunkId?: string; topK?: number } = {},
): Promise<KnowledgeFilePreviewPayload> {
  const query = new URLSearchParams();
  if (options.chunkId) query.set('chunk_id', options.chunkId);
  if (options.topK) query.set('top_k', String(options.topK));
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
};

export async function updateKnowledgeFileMetadata(
  fileUuid: string,
  payload: KnowledgeFileMetadataUpdatePayload,
): Promise<KnowledgeFilePayload> {
  const body: Record<string, unknown> = {
    category: payload.category ?? '',
    document_type: payload.documentType ?? '',
    tags: payload.tags ?? [],
  };
  if (payload.fileName !== undefined) {
    body.file_name = payload.fileName;
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
  const response = await apiFetch(meta.download_url);
  if (!response.ok) throw new ApiError(response.status, 'CHAT_WORD_DOWNLOAD_FAILED');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const fileName = readAttachmentFileName(response.headers) || meta.file_name || '聚信得仁文档.docx';
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

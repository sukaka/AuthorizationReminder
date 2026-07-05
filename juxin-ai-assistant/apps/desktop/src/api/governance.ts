import { ApiError } from './client';

export type GovernanceList<T> = { items: T[]; total: number };

export type AdminTask = {
  uuid: string;
  assistant_uuid: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  prompt_binding?: {
    prompt_external_id: number;
    version_policy: 'PUBLISHED' | 'PINNED';
    pinned_version?: number | null;
    status: 'ACTIVE' | 'DISABLED';
  } | null;
  fields?: AdminTaskField[];
};

export type AdminTaskField = {
  field_key: string;
  label: string;
  field_type: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
  validation?: Record<string, unknown>;
};

export type TaskCapability = {
  task_uuid: string;
  task_code: string;
  task_name: string;
  assistant_name: string;
  task_status: string;
  input_fields: AdminTaskField[];
  output_format: string;
  document_type: string;
  prompt_binding_status: 'configured' | 'missing' | 'stale';
  knowledge_link_count: number;
};

export type TaskConfigurationInput = {
  task: { status: AdminTask['status'] };
  fields: AdminTaskField[];
  prompt_binding: {
    prompt_external_id: number;
    version_policy: 'PUBLISHED' | 'PINNED';
    pinned_version?: number;
    status: 'ACTIVE' | 'DISABLED';
  };
};

export type KnowledgeItem = {
  uuid: string;
  title: string;
  category: string;
  status: string;
  tags: string[];
  keywords: string[];
  task_uuids: string[];
  priority: number;
};

export type Suggestion = {
  uuid: string;
  department_code: string;
  suggestion_type: 'COMMON_TASK_CHANGE' | 'PROMPT_CHANGE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  task_uuid?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  content?: string;
  review_comment?: string | null;
};

export type StatsPayload = {
  total: number;
  completion_rate?: number;
  failure_rate?: number;
  departments?: string[];
  by_department?: Record<string, number>;
  task_ranking?: Array<{ name: string; count: number }>;
  daily_trend?: Array<{ date: string; count: number }>;
  feedback_distribution?: Record<string, number>;
  tool_call_total?: number;
  tool_call_success?: number;
  tool_call_success_rate?: number;
  tool_call_average_latency_ms?: number;
  knowledge_search_total?: number;
  knowledge_search_hit?: number;
  knowledge_search_hit_rate?: number;
  assistant_answer_total?: number;
  assistant_answer_with_sources?: number;
  citation_coverage_rate?: number;
  answer_without_source_rate?: number;
  word_export_total?: number;
  document_format_check_total?: number;
  document_format_check_passed?: number;
  document_format_pass_rate?: number;
  tool_error_distribution?: Record<string, number>;
  user_negative_feedback_total?: number;
};

export type AuditItem = {
  id: string | number;
  sso_user_id: string;
  username_snapshot: string;
  action: string;
  entity_type: string;
  entity_uuid?: string | null;
  result: string;
  metadata_json?: Record<string, unknown>;
  created_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...init.headers }
      : init?.headers,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, 'GOVERNANCE_REQUEST_FAILED', payload);
  return payload as T;
}

export const governanceApi = {
  tasks: () => request<GovernanceList<AdminTask>>('/api/ai/admin/tasks'),
  capabilities: () => request<{ items: TaskCapability[] }>('/api/ai/capabilities'),
  createTask: (payload: Record<string, unknown>) => request<AdminTask>(
    '/api/ai/admin/tasks', { method: 'POST', body: JSON.stringify(payload) },
  ),
  saveTask: (uuid: string, payload: Record<string, unknown>) => request<AdminTask>(
    `/api/ai/admin/tasks/${encodeURIComponent(uuid)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  ),
  saveTaskConfiguration: (uuid: string, payload: TaskConfigurationInput) => request<AdminTask>(
    `/api/ai/admin/tasks/${encodeURIComponent(uuid)}/configuration`,
    { method: 'PUT', body: JSON.stringify(payload) },
  ),
  replaceTaskFields: (uuid: string, fields: AdminTaskField[]) => request<AdminTask>(
    `/api/ai/admin/tasks/${encodeURIComponent(uuid)}/fields`,
    { method: 'PUT', body: JSON.stringify({ fields }) },
  ),
  bindTaskPrompt: (
    uuid: string,
    payload: { prompt_external_id: number; version_policy: 'PUBLISHED' | 'PINNED'; pinned_version?: number; status: 'ACTIVE' | 'DISABLED' },
  ) => request<AdminTask>(
    `/api/ai/admin/tasks/${encodeURIComponent(uuid)}/prompt-binding`,
    { method: 'PUT', body: JSON.stringify(payload) },
  ),
  deleteTask: (uuid: string) => request<void>(
    `/api/ai/admin/tasks/${encodeURIComponent(uuid)}`, { method: 'DELETE' },
  ),
  knowledge: () => request<GovernanceList<KnowledgeItem>>('/api/ai/admin/knowledge'),
  createKnowledge: (payload: Record<string, unknown>) => request<KnowledgeItem>(
    '/api/ai/admin/knowledge',
    { method: 'POST', body: JSON.stringify(payload) },
  ),
  updateKnowledge: (uuid: string, payload: Record<string, unknown>) => request<KnowledgeItem>(
    `/api/ai/admin/knowledge/${encodeURIComponent(uuid)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  ),
  disableKnowledge: (uuid: string) => request<void>(
    `/api/ai/admin/knowledge/${encodeURIComponent(uuid)}`, { method: 'DELETE' },
  ),
  suggestions: () => request<GovernanceList<Suggestion>>('/api/ai/admin/suggestions'),
  submitSuggestion: (payload: Record<string, unknown>) => request<Suggestion>(
    '/api/ai/suggestions',
    { method: 'POST', body: JSON.stringify(payload) },
  ),
  reviewSuggestion: (uuid: string, decision: 'APPROVE' | 'REJECT') => request<Suggestion>(
    `/api/ai/admin/suggestions/${encodeURIComponent(uuid)}/review`,
    { method: 'POST', body: JSON.stringify({ decision }) },
  ),
  settings: () => request<Record<string, unknown>>('/api/ai/admin/settings'),
  saveSettings: (payload: Record<string, unknown>) => request<Record<string, unknown>>(
    '/api/ai/admin/settings',
    { method: 'PUT', body: JSON.stringify(payload) },
  ),
  stats: (manager: boolean) => request<StatsPayload>(
    manager ? '/api/ai/department-stats' : '/api/ai/admin/stats',
  ),
  audit: (query = '') => request<GovernanceList<AuditItem>>(
    `/api/ai/admin/audit-logs${query ? `?${query}` : ''}`,
  ),
};

// Desktop Update Publishing

export type DesktopUpdateRelease = {
  uuid: string;
  agent_version: string;
  channel: 'lan-test' | 'production';
  status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
  release_notes: string;
  created_by: string;
  created_at: string;
  published_at: string | null;
  withdrawn_at: string | null;
  artifacts: DesktopUpdateArtifact[];
};

export type DesktopUpdateArtifact = {
  target: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
};

export const desktopUpdateApi = {
  list: (channel?: string) => {
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : '';
    return request<DesktopUpdateRelease[]>(`/api/ai/admin/desktop-updates${qs}`);
  },
  create: (payload: { agent_version: string; channel: string; release_notes: string }) =>
    request<DesktopUpdateRelease>('/api/ai/admin/desktop-updates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  upload: (releaseUuid: string, file: File, target: string, sha256: string, signature: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('target', target);
    form.append('sha256', sha256);
    form.append('signature', signature);
    return request<DesktopUpdateArtifact>(
      `/api/ai/admin/desktop-updates/${encodeURIComponent(releaseUuid)}/artifacts`,
      { method: 'POST', body: form },
    );
  },
  publish: (releaseUuid: string) =>
    request<DesktopUpdateRelease>(
      `/api/ai/admin/desktop-updates/${encodeURIComponent(releaseUuid)}/publish`,
      { method: 'POST' },
    ),
  withdraw: (releaseUuid: string) =>
    request<DesktopUpdateRelease>(
      `/api/ai/admin/desktop-updates/${encodeURIComponent(releaseUuid)}/withdraw`,
      { method: 'POST' },
    ),
};

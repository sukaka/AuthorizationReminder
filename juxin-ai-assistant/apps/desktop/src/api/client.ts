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
  usage: Record<string, number>;
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response, code: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, code, payload);
  }
  return payload as T;
}

export function getAuthPortalUrl(): string {
  const authUrl = import.meta.env.VITE_AUTH_PUBLIC_URL || 'http://localhost:5180';
  return `${authUrl.replace(/\/$/, '')}/portal?system=ai-assistant`;
}

export async function getSession(): Promise<SessionPayload> {
  const response = await fetch('/api/ai/session', { credentials: 'include' });
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  return readJson<SessionPayload>(response, `SESSION_${response.status}`);
}

export async function getCatalog(query = ''): Promise<CatalogPayload> {
  const search = query ? `?query=${encodeURIComponent(query)}` : '';
  return readJson<CatalogPayload>(
    await fetch(`/api/ai/catalog${search}`, { credentials: 'include' }),
    'CATALOG_FAILED',
  );
}

export async function getHome(): Promise<HomePayload> {
  return readJson<HomePayload>(
    await fetch('/api/ai/home', { credentials: 'include' }),
    'HOME_FAILED',
  );
}

export async function getTask(taskCode: string): Promise<TaskPayload> {
  return readJson<TaskPayload>(
    await fetch(`/api/ai/tasks/${encodeURIComponent(taskCode)}`, {
      credentials: 'include',
    }),
    'TASK_FAILED',
  );
}

export async function putFavorite(taskUuid: string): Promise<void> {
  const response = await fetch(
    `/api/ai/favorites/${encodeURIComponent(taskUuid)}`,
    { method: 'PUT', credentials: 'include' },
  );
  if (!response.ok) throw new ApiError(response.status, 'FAVORITE_FAILED');
}

export async function deleteFavorite(taskUuid: string): Promise<void> {
  const response = await fetch(
    `/api/ai/favorites/${encodeURIComponent(taskUuid)}`,
    { method: 'DELETE', credentials: 'include' },
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
    await fetch(`/api/ai/generations?${search.toString()}`, {
      credentials: 'include',
    }),
    'HISTORY_FAILED',
  );
}

export async function deleteHistory(generationUuid: string): Promise<void> {
  const response = await fetch(
    `/api/ai/generations/${encodeURIComponent(generationUuid)}`,
    { method: 'DELETE', credentials: 'include' },
  );
  if (!response.ok) throw new ApiError(response.status, 'HISTORY_DELETE_FAILED');
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
    await fetch(
      `/api/ai/generations/${encodeURIComponent(generationUuid)}/feedback`,
      {
        method: 'POST',
        credentials: 'include',
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
    await fetch(`/api/ai/generations/${encodeURIComponent(generationUuid)}`, {
      credentials: 'include',
    }),
    'HISTORY_DETAIL_FAILED',
  );
}

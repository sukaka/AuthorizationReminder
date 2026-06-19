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
};

export type TaskPayload = {
  uuid: string;
  code: string;
  name: string;
  description: string;
  output_format: string;
  safety_notice: string;
  fields: Array<{
    field_key: string;
    label: string;
    field_type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'MULTISELECT' | 'DATE' | 'NUMBER' | 'SWITCH';
    required: boolean;
    placeholder?: string;
    options?: string[];
  }>;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
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

  if (!response.ok) {
    throw new ApiError(response.status, `SESSION_${response.status}`);
  }

  return response.json() as Promise<SessionPayload>;
}

export async function getTask(taskCode: string): Promise<TaskPayload> {
  const response = await fetch(`/api/ai/tasks/${encodeURIComponent(taskCode)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(response.status, `TASK_${response.status}`);
  }
  return response.json() as Promise<TaskPayload>;
}

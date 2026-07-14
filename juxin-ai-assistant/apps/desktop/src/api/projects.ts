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

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) throw new ApiError(response.status, 'PROJECTS_FAILED', payload);
  return payload as T;
}

export async function listProjects(): Promise<ProjectPayload[]> {
  return readJson(await apiFetch('/api/ai/projects', { cache: 'no-store' }));
}

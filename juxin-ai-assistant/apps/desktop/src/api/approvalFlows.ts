import { ApiError, apiFetch, getAuthPortalUrl } from './client';

export type ProfessionalApprovalStep = {
  step_key: string;
  name: string;
  roles: string[];
  required_approvals: number;
};

export type ProfessionalApprovalFlowVersion = {
  version_uuid: string;
  version: number;
  content_hash: string;
  steps: ProfessionalApprovalStep[];
  min_approvals: number;
  allow_author_approve: boolean;
  reminder_config: Record<string, unknown>;
  return_target: string;
  status: string;
  published_at: string | null;
};

export type ProfessionalApprovalFlow = {
  flow_uuid: string;
  flow_key: string;
  name: string;
  scope_policy: 'personal' | 'project' | 'both';
  deliverable_types: string[];
  status: string;
  current_version: ProfessionalApprovalFlowVersion;
};

export type ProfessionalApprovalFlowList = {
  request_id: string;
  items: ProfessionalApprovalFlow[];
  total: number;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'PROFESSIONAL_APPROVAL_FLOWS_LIST_FAILED', payload);
  }
  return payload as T;
}

export async function listProfessionalApprovalFlows(input: {
  scopeType: 'personal' | 'project';
  deliverableType?: string;
  projectUuid?: string;
}): Promise<ProfessionalApprovalFlowList> {
  const query = new URLSearchParams({ scope_type: input.scopeType });
  if (input.deliverableType) query.set('deliverable_type', input.deliverableType);
  if (input.projectUuid) query.set('project_uuid', input.projectUuid);
  return readJson(
    await apiFetch(`/api/ai/approval-flows?${query.toString()}`, { cache: 'no-store' }),
  );
}

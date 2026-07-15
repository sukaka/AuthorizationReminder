import { ApiError, apiFetch, getAuthPortalUrl } from './client';

export type ProfessionalSkillVersionSummary = {
  version_uuid: string;
  version: number;
  content_hash: string;
  status: string;
  default_template_version_uuid: string | null;
  published_at: string | null;
};

export type ProfessionalSkillSummary = {
  skill_uuid: string;
  skill_key: string;
  name: string;
  category: string;
  description: string;
  scope_policy: string;
  status: string;
  current_version: ProfessionalSkillVersionSummary;
};

export type ProfessionalSkillVersionDetail = ProfessionalSkillSummary
  & ProfessionalSkillVersionSummary
  & {
    request_id: string;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    plan_definition: Record<string, unknown>;
    prompt_bundle_present: boolean;
    allowed_resource_types: string[];
    allowed_tool_ids: string[];
    required_fact_policy: Record<string, unknown>;
    quality_rule_set_version_ids: string[];
    review_checklist: string[];
    created_by: string;
    created_at: string;
  };

export type ProfessionalSkillList = {
  request_id: string;
  items: ProfessionalSkillSummary[];
  total: number;
};

export type ProfessionalSkillCandidate = {
  skill_uuid: string;
  skill_key: string;
  name: string;
  version_uuid: string;
  version: number;
  content_hash: string;
  default_template_version_uuid: string | null;
  score: number;
  reasons: string[];
  source: string;
  selected: boolean;
};

export type ProfessionalSkillSelection = {
  request_id: string;
  selection_uuid: string;
  selection_source: string;
  selected: ProfessionalSkillCandidate | null;
  candidates: ProfessionalSkillCandidate[];
  confirmation_required: boolean;
  replayed: boolean;
};

export type ProfessionalSkillSelectInput = {
  objective: string;
  deliverable_type: string;
  scope_type: 'personal' | 'project';
  project_uuid?: string;
  input_fields?: Record<string, unknown>;
  explicit_skill_version_uuid?: string;
  task_bound_skill_version_uuid?: string;
  model_suggested_skill_version_uuids?: string[];
  user_confirmed?: boolean;
};

async function readJson<T>(response: Response, errorCode: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) throw new ApiError(response.status, errorCode, payload);
  return payload as T;
}

function queryString(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export function newIdempotencyKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function listProfessionalSkills(input: {
  scopeType: 'personal' | 'project';
  deliverableType?: string;
  projectUuid?: string;
}): Promise<ProfessionalSkillList> {
  const query = queryString({
    scope_type: input.scopeType,
    deliverable_type: input.deliverableType,
    project_uuid: input.projectUuid,
  });
  return readJson(
    await apiFetch(`/api/ai/skills${query}`, { cache: 'no-store' }),
    'PROFESSIONAL_SKILLS_LIST_FAILED',
  );
}

export async function getProfessionalSkillVersion(
  skillUuid: string,
  versionUuid: string,
): Promise<ProfessionalSkillVersionDetail> {
  return readJson(
    await apiFetch(
      `/api/ai/skills/${encodeURIComponent(skillUuid)}/versions/${encodeURIComponent(versionUuid)}`,
      { cache: 'no-store' },
    ),
    'PROFESSIONAL_SKILL_VERSION_FAILED',
  );
}

export async function selectProfessionalSkill(
  input: ProfessionalSkillSelectInput,
  idempotencyKey = newIdempotencyKey('professional-skill-select'),
): Promise<ProfessionalSkillSelection> {
  return readJson(
    await apiFetch('/api/ai/skills/select', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(input),
    }),
    'PROFESSIONAL_SKILL_SELECT_FAILED',
  );
}

import { ApiError, apiFetch, getAuthPortalUrl } from './client';

export type ProfessionalTemplateVersionSummary = {
  version_uuid: string;
  version: number;
  content_hash: string;
  status: string;
  published_at: string | null;
};

export type ProfessionalTemplateSummary = {
  template_uuid: string;
  template_key: string;
  name: string;
  purpose: string;
  deliverable_types: string[];
  scope_type: string;
  status: string;
  current_version: ProfessionalTemplateVersionSummary;
};

export type ProfessionalTemplateVersionDetail = ProfessionalTemplateSummary
  & ProfessionalTemplateVersionSummary
  & {
    request_id: string;
    input_schema: Record<string, unknown>;
    structure_dsl: Record<string, unknown>;
    dynamic_tables: Array<Record<string, unknown>>;
    conditional_sections: Array<Record<string, unknown>>;
    style_theme: Record<string, unknown>;
    word_render_config: Record<string, unknown>;
    compatible_skill_version_uuids: string[];
    created_by: string;
    created_at: string;
  };

export type ProfessionalTemplateList = {
  request_id: string;
  items: ProfessionalTemplateSummary[];
  total: number;
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

export async function listProfessionalTemplates(input: {
  scopeType: 'personal' | 'project';
  deliverableType?: string;
  projectUuid?: string;
}): Promise<ProfessionalTemplateList> {
  const query = queryString({
    scope_type: input.scopeType,
    deliverable_type: input.deliverableType,
    project_uuid: input.projectUuid,
  });
  return readJson(
    await apiFetch(`/api/ai/templates${query}`, { cache: 'no-store' }),
    'PROFESSIONAL_TEMPLATES_LIST_FAILED',
  );
}

export async function getProfessionalTemplateVersion(
  templateUuid: string,
  versionUuid: string,
): Promise<ProfessionalTemplateVersionDetail> {
  return readJson(
    await apiFetch(
      `/api/ai/templates/${encodeURIComponent(templateUuid)}/versions/${encodeURIComponent(versionUuid)}`,
      { cache: 'no-store' },
    ),
    'PROFESSIONAL_TEMPLATE_VERSION_FAILED',
  );
}

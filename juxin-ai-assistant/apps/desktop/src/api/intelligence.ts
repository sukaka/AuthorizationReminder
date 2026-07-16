import { ApiError, apiFetch, getAuthPortalUrl } from './client';
import { downloadBlobFromResponse } from '../runtime/downloads';

export type EnterpriseMetricSnapshot = {
  metric_code: string;
  definition_version: string;
  scope: {
    type: string;
    user_id: string;
    project_uuids: string[];
  };
  scope_fingerprint: string;
  policy_version: string;
  period_start: string;
  period_end: string;
  data_cutoff_at: string;
  data_version: string;
  numerator: number;
  denominator: number | null;
  value: number | null;
  freshness: string;
  data_completeness: number;
  suppressed: boolean;
  exclusions: string[];
  evidence_refs: string[];
  reason?: string | null;
};

export type EnterpriseHealthDimension = {
  code: string;
  label: string;
  weight: number;
  score: number | null;
  data_completeness: number;
  status: string;
  evidence_refs: string[];
};

export type EnterpriseHealthDeduction = {
  code: string;
  points: number;
  reason: string;
  evidence_refs: string[];
};

export type EnterpriseProjectHealth = {
  project_uuid: string;
  project_name: string;
  score: number | null;
  status: string;
  confidence: number;
  rule_version: string;
  as_of: string;
  dimensions: EnterpriseHealthDimension[];
  deductions: EnterpriseHealthDeduction[];
};

export type EnterpriseOverviewPayload = {
  scope: {
    user_id: string;
    role: string;
    department: string | null;
    managed_departments: string[];
    project_count: number;
    project_uuids: string[];
    policy_version: string;
    scope_fingerprint: string;
  };
  metrics: {
    projects: number;
    tasks: number;
    deliverables: number;
    open_issues: number;
    artifacts: number;
  };
  metric_snapshots: EnterpriseMetricSnapshot[];
  project_health: EnterpriseProjectHealth[];
  freshness: {
    as_of: string;
    mode: string;
    is_stale: boolean;
  };
  data_quality: {
    status: string;
    gaps: string[];
    explanation: string;
  };
};

export type EnterpriseInsight = {
  uuid: string;
  insight_type: string;
  title: string;
  summary: string;
  project_id: number | null;
  status: string;
  severity: string;
  confidence: number;
  scope_fingerprint: string;
  policy_version: string;
  data_cutoff_at: string;
  data_version: string;
  impact_scope: Record<string, unknown>;
  evidence_fingerprint: string;
  evidence_refs: string[];
  acknowledged_by: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  row_version: number;
};

export type EnterpriseInsightListPayload = {
  items: EnterpriseInsight[];
};

export type EnterpriseNotification = {
  notification_uuid: string;
  insight_uuid: string;
  insight_type: string;
  title: string;
  summary: string;
  severity: string;
  project_uuid: string;
  task_uuid: string;
  status: string;
  delivery_status: string;
  attempts: number;
  unread: boolean;
  created_at: string | null;
  sent_at: string | null;
  read_at: string | null;
  data_cutoff_at: string;
  data_version: string;
  last_error: string | null;
};

export type EnterpriseNotificationListPayload = {
  items: EnterpriseNotification[];
  total: number;
  unread_count: number;
};

export type EnterpriseOperationSection = {
  total: number;
  confirmed?: number | null;
  pending_confirmation?: number | null;
  occurrences?: number | null;
  completed_occurrences?: number | null;
  overdue_occurrences?: number | null;
  missing_occurrences?: number | null;
  open?: number | null;
  overdue?: number | null;
  approved?: number | null;
  pending?: number | null;
  open_high_or_critical?: number | null;
  overdue_remediations?: number | null;
};

export type EnterpriseAttentionItem = {
  type: string;
  severity: string;
  title: string;
  summary: string;
  project_uuid: string;
  project_name: string;
  evidence_refs: string[];
  status: string;
};

export type EnterpriseOperationSummaryPayload = {
  scope: EnterpriseOverviewPayload['scope'];
  as_of: string;
  contracts: EnterpriseOperationSection;
  services: EnterpriseOperationSection;
  tasks: EnterpriseOperationSection;
  deliverables: EnterpriseOperationSection;
  issues: EnterpriseOperationSection;
  automation: {
    total: number;
    succeeded: number;
    failed: number;
    active: number;
    success_rate: number | null;
    scope_mode: string;
  };
  attention_items: EnterpriseAttentionItem[];
};

export type EnterpriseQueryPlan = {
  intent: string;
  scope: {
    project_uuids: string[];
    department_ids: number[];
  };
  period: {
    start: string;
    end: string;
  };
  metrics: string[];
  filters: Array<{ field: string; op: string; value: string | string[] }>;
  group_by: string[];
  limit: number;
  policy_version: string;
  scope_fingerprint: string;
};

export type EnterpriseQueryRequest = {
  intent: 'metric_summary' | 'compare_project_health';
  scope: {
    project_uuids: string[];
    department_ids: number[];
  };
  period: {
    start: string;
    end: string;
  };
  metrics: string[];
  filters: Array<{ field: string; op: 'eq' | 'in'; value: string | string[] }>;
  group_by: string[];
  limit: number;
};

export type EnterpriseQueryResult = {
  plan: EnterpriseQueryPlan;
  rows: Array<{
    group?: Record<string, unknown>;
    metrics?: Record<string, number | null>;
    status?: string;
    confidence?: number;
    evidence_refs: string[];
  }>;
  generated_at: string;
  evidence_refs: string[];
};

export type EnterpriseOrganization = {
  id: number;
  uuid: string;
  external_id: string;
  name: string;
  status: string;
  project_count: number;
};

export type EnterpriseSchedule = {
  schedule_uuid: string;
  organization_id: number;
  owner_user_id: string;
  workflow_id: string;
  name: string;
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  next_fire_at: string | null;
  misfire_policy: string;
  catch_up: boolean;
  idempotency_prefix: string;
  source_version: string;
  policy_version: string;
  scope_fingerprint: string;
};

export type EnterpriseCapabilityEvaluation = {
  uuid: string;
  organization_id: number;
  capability_type: string;
  capability_key: string;
  capability_version: string;
  period_start: string;
  period_end: string;
  data_cutoff_at: string;
  source_version: string;
  definition_version: string;
  scope_fingerprint: string;
  policy_version: string;
  idempotency_key: string;
  request_hash: string;
  sample_size: number;
  success_count: number;
  success_rate: number | null;
  quality_pass_count: number;
  quality_sample_size: number;
  quality_pass_rate: number | null;
  human_modified_count: number;
  human_modification_rate: number | null;
  total_cost_micros: number;
  total_latency_ms: number;
  average_latency_ms: number | null;
  confidence_label: string;
  status: string;
  evidence_refs: string[];
  row_version: number;
};

export type EnterpriseOptimizationProposal = {
  uuid: string;
  organization_id: number;
  evaluation_uuid: string;
  capability_type: string;
  capability_key: string;
  current_version: string;
  title: string;
  rationale: string;
  proposed_change: Record<string, unknown>;
  risk_level: string;
  status: string;
  scope_fingerprint: string;
  policy_version: string;
  idempotency_key: string;
  request_hash: string;
  proposed_by: string;
  reviewed_by: string;
  reviewed_at: string | null;
  published_at: string | null;
  rolled_back_at: string | null;
  row_version: number;
};

export type EnterpriseAuditLog = {
  id: number;
  sso_user_id: string;
  username_snapshot: string;
  action: string;
  entity_type: string;
  entity_uuid: string;
  result: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

function idempotencyKey(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${randomUuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT', payload);
  }
  if (!response.ok) throw new ApiError(response.status, 'INTELLIGENCE_OVERVIEW_FAILED', payload);
  return payload as T;
}

export async function getEnterpriseOverview(): Promise<EnterpriseOverviewPayload> {
  return readJson(await apiFetch('/api/ai/intelligence/overview', { cache: 'no-store' }));
}

export async function getEnterpriseInsights(limit = 20): Promise<EnterpriseInsightListPayload> {
  return readJson(await apiFetch(`/api/ai/intelligence/insights?status=open&limit=${limit}`, { cache: 'no-store' }));
}

export async function getEnterpriseNotifications(
  unreadOnly = false,
  limit = 20,
): Promise<EnterpriseNotificationListPayload> {
  return readJson(await apiFetch(
    `/api/ai/intelligence/notifications?unread_only=${unreadOnly}&limit=${limit}`,
    { cache: 'no-store' },
  ));
}

export async function markEnterpriseNotificationRead(
  notificationUuid: string,
): Promise<EnterpriseNotification & { replayed: boolean }> {
  return readJson(await apiFetch(
    `/api/ai/intelligence/notifications/${encodeURIComponent(notificationUuid)}/read`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey('enterprise-notification-read') },
    },
  ));
}

export async function getEnterpriseOperationSummary(): Promise<EnterpriseOperationSummaryPayload> {
  return readJson(await apiFetch('/api/ai/intelligence/operation-summary?attention_limit=20', { cache: 'no-store' }));
}

export async function runEnterpriseManagementQuery(body: EnterpriseQueryRequest): Promise<EnterpriseQueryResult> {
  return readJson(await apiFetch('/api/ai/intelligence/management/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

export async function exportEnterpriseManagementQuery(body: EnterpriseQueryRequest): Promise<string> {
  const response = await apiFetch('/api/ai/intelligence/management/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.assign(getAuthPortalUrl());
    throw new ApiError(401, 'AUTH_REDIRECT');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, 'INTELLIGENCE_EXPORT_FAILED', payload);
  }
  return downloadBlobFromResponse(response, '聚信企业管理问答.csv');
}

export async function getEnterpriseOrganizations(): Promise<{ items: EnterpriseOrganization[] }> {
  return readJson(await apiFetch('/api/ai/intelligence/organizations', { cache: 'no-store' }));
}

export async function getEnterpriseAuditLogs(limit = 20): Promise<{ items: EnterpriseAuditLog[]; total: number }> {
  return readJson(await apiFetch(`/api/ai/intelligence/audit-logs?limit=${limit}`, { cache: 'no-store' }));
}

export async function getEnterpriseInsightSchedules(organizationId: number): Promise<{ items: EnterpriseSchedule[] }> {
  return readJson(await apiFetch(`/api/ai/intelligence/organizations/${organizationId}/insights/schedules`, { cache: 'no-store' }));
}

export async function createEnterpriseInsightSchedule(
  organizationId: number,
  body: {
    name: string;
    cron_expression: string;
    timezone: string;
    next_fire_at?: string | null;
    misfire_policy: string;
    catch_up: boolean;
    source_version: string;
    idempotency_prefix: string;
  },
): Promise<EnterpriseSchedule> {
  return readJson(await apiFetch(`/api/ai/intelligence/organizations/${organizationId}/insights/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('insight-schedule') },
    body: JSON.stringify(body),
  }));
}

export async function getEnterpriseCapabilityEvaluations(organizationId: number): Promise<{ items: EnterpriseCapabilityEvaluation[] }> {
  return readJson(await apiFetch(`/api/ai/intelligence/organizations/${organizationId}/capability-evaluations`, { cache: 'no-store' }));
}

export async function createEnterpriseCapabilityEvaluation(
  organizationId: number,
  body: Record<string, unknown>,
): Promise<EnterpriseCapabilityEvaluation> {
  return readJson(await apiFetch(`/api/ai/intelligence/organizations/${organizationId}/capability-evaluations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('capability-evaluation') },
    body: JSON.stringify(body),
  }));
}

export async function getEnterpriseOptimizationProposals(organizationId: number): Promise<{ items: EnterpriseOptimizationProposal[] }> {
  return readJson(await apiFetch(`/api/ai/intelligence/organizations/${organizationId}/optimization-proposals`, { cache: 'no-store' }));
}

export async function createEnterpriseOptimizationProposal(
  organizationId: number,
  body: { evaluation_uuid: string; title: string; rationale: string; proposed_change: Record<string, unknown>; risk_level: string },
): Promise<EnterpriseOptimizationProposal> {
  return readJson(await apiFetch(`/api/ai/intelligence/organizations/${organizationId}/optimization-proposals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('optimization-proposal') },
    body: JSON.stringify(body),
  }));
}

export async function transitionEnterpriseOptimizationProposal(
  organizationId: number,
  proposalUuid: string,
  action: string,
  comment = '',
): Promise<{ proposal: EnterpriseOptimizationProposal; action: string; from_status: string; to_status: string; replayed: boolean }> {
  return readJson(await apiFetch(`/api/ai/intelligence/organizations/${organizationId}/optimization-proposals/${encodeURIComponent(proposalUuid)}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('optimization-transition') },
    body: JSON.stringify({ action, comment }),
  }));
}

async function reviewEnterpriseInsight(
  insightUuid: string,
  action: 'acknowledge' | 'dismiss',
  feedback = '',
): Promise<EnterpriseInsight> {
  return readJson(
    await apiFetch(`/api/ai/intelligence/insights/${encodeURIComponent(insightUuid)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    }),
  );
}

export function acknowledgeEnterpriseInsight(insightUuid: string, feedback = ''): Promise<EnterpriseInsight> {
  return reviewEnterpriseInsight(insightUuid, 'acknowledge', feedback);
}

export function dismissEnterpriseInsight(insightUuid: string, feedback = ''): Promise<EnterpriseInsight> {
  return reviewEnterpriseInsight(insightUuid, 'dismiss', feedback);
}

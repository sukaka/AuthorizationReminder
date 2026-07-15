import { ApiError, apiFetch, getAuthPortalUrl } from './client';
import { downloadBlobFromResponse } from '../runtime/downloads';
import { newIdempotencyKey } from './skills';

export type DeliverableBlock = {
  block_id: string;
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type DeliverableContent = {
  schema_version: string;
  blocks: DeliverableBlock[];
  [key: string]: unknown;
};

export type DeliverableVersion = {
  version_uuid: string;
  version_no: number;
  parent_version_uuid: string | null;
  skill_version_uuid: string;
  template_version_uuid: string;
  title_snapshot: string;
  summary_snapshot: string;
  change_summary: string;
  creation_reason: string;
  content: DeliverableContent;
  content_hash: string;
  created_at: string;
};

export type DeliverableSummary = {
  deliverable_uuid: string;
  title: string;
  deliverable_type: string;
  scope_type: string;
  formality: string;
  project_uuid: string | null;
  owner_user_id?: string;
  lifecycle_status: string;
  row_version: number;
  content_summary: string;
  allowed_actions?: string[];
  created_at?: string;
  updated_at: string;
};

export type DeliverableDetail = DeliverableSummary & {
  request_id: string;
  owner_user_id: string;
  allowed_actions: string[];
  current_version: DeliverableVersion;
  source_change_notice?: {
    message: string;
    affected_evidence_count: number;
    historical_snapshot_preserved: boolean;
  } | null;
  created_at: string;
};

export type DeliverableExperienceCandidate = {
  candidate_uuid: string;
  candidate_type: 'structure' | 'rule' | 'template';
  status: 'pending_review' | 'approved' | 'rejected';
  source_scope_type: 'personal' | 'project';
  source_project_uuid: string | null;
  version_uuid: string;
  content_hash: string;
  deidentified_summary: string;
  submitted_by: string;
  created_at: string;
};

export type DeliverableExperienceCandidateMutation = {
  request_id: string;
  deliverable_uuid: string;
  candidate: DeliverableExperienceCandidate;
};

export type DeliverableEvidenceRefresh = {
  request_id: string;
  deliverable_uuid: string;
  lifecycle_status: string;
  row_version: number;
  invalidated_evidence_uuids: string[];
  source_change_notice: DeliverableDetail['source_change_notice'];
};

export type DeliverableVersionHistoryItem = {
  version_uuid: string;
  version_no: number;
  parent_version_uuid?: string | null;
  skill_version_uuid?: string;
  template_version_uuid?: string;
  title_snapshot?: string;
  summary_snapshot?: string;
  change_summary: string;
  creation_reason: string;
  content_hash: string;
  created_by?: string;
  created_at: string;
  is_current?: boolean;
  is_approved?: boolean;
  is_delivered?: boolean;
};

export type DeliverableList = {
  request_id: string;
  items: DeliverableSummary[];
  total: number;
  page: number;
  page_size: number;
};

export type DeliverableVersionHistory = {
  request_id: string;
  deliverable_uuid: string;
  items: DeliverableVersionHistoryItem[];
  total: number;
  page: number;
  page_size: number;
};

export type DeliverableVersionDetail = {
  request_id: string;
  deliverable_uuid: string;
  version: DeliverableVersion;
};

export type DeliverableFieldChange = {
  path: string;
  change_type: 'added' | 'removed' | 'modified';
  before: unknown | null;
  after: unknown | null;
};

export type DeliverableBlockChange = {
  block_id: string;
  block_type: string;
  change_type: 'added' | 'removed' | 'modified';
  before: DeliverableBlock | null;
  after: DeliverableBlock | null;
  field_changes: DeliverableFieldChange[];
};

export type DeliverableVersionDiff = {
  request_id: string;
  deliverable_uuid: string;
  from_version_uuid: string;
  from_version_no: number;
  to_version_uuid: string;
  to_version_no: number;
  summary: {
    added_blocks: number;
    removed_blocks: number;
    modified_blocks: number;
    unchanged_blocks: number;
  };
  changes: DeliverableBlockChange[];
};

export type DeliverableClaimType = 'fact' | 'analysis' | 'inference' | 'suggestion';
export type DeliverableFactStatus =
  | 'pending_confirmation'
  | 'supported'
  | 'confirmed'
  | 'inference'
  | 'unsupported'
  | 'conflicted'
  | 'stale'
  | 'rejected';

export type DeliverableFact = {
  fact_uuid: string;
  deliverable_uuid: string;
  version_uuid: string;
  content_hash: string;
  block_id: string;
  char_start: number | null;
  char_end: number | null;
  claim_type: DeliverableClaimType;
  claim_text: string;
  claim_hash: string;
  critical: boolean;
  status: DeliverableFactStatus;
  source_required: boolean;
  human_confirmation_required: boolean;
  rationale: string;
  confirmed_by: string;
  confirmed_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
};

export type DeliverableFactList = {
  request_id: string;
  deliverable_uuid: string;
  version_uuid: string;
  content_hash: string;
  items: DeliverableFact[];
  total: number;
};

export type DeliverableFactMutation = {
  request_id: string;
  fact: DeliverableFact;
};

export type DeliverableEvidenceLocation = {
  file_name: string;
  page_number: number | null;
  sheet_name: string;
  cell_range: string;
  section_title: string;
  paragraph_index: number | null;
  chunk_id: string;
};

export type DeliverableEvidenceSearchItem = {
  source_type: string;
  source_uuid: string;
  source_version: string;
  source_content_hash: string;
  quote: string;
  location: DeliverableEvidenceLocation;
};

export type DeliverableEvidenceSearch = {
  request_id: string;
  deliverable_uuid: string;
  version_uuid: string;
  items: DeliverableEvidenceSearchItem[];
  total: number;
};

export type DeliverableEvidence = DeliverableEvidenceSearchItem & {
  evidence_uuid: string;
  deliverable_uuid: string;
  version_uuid: string;
  project_uuid: string | null;
  quote_hash: string;
  captured_by: string;
  captured_at: string;
  permission_snapshot_hash: string;
  status: 'active' | 'stale' | 'revoked' | 'inaccessible';
  stale_reason: string;
  revoked_reason: string;
  row_version: number;
};

export type DeliverableEvidenceLink = {
  link_uuid: string;
  fact_uuid: string;
  evidence_uuid: string;
  relation: 'supports' | 'contradicts' | 'context' | 'derived_from';
  derived_expression: string;
  input_fact_uuids: string[];
  rounding_rule: string;
  status: string;
  linked_by: string;
  created_at: string;
};

export type DeliverableFactEvidenceMutation = {
  request_id: string;
  fact: DeliverableFact;
  evidence: DeliverableEvidence;
  link: DeliverableEvidenceLink;
};

export type ReviewIssue = {
  issue_uuid: string;
  review_uuid: string;
  rule_version_uuid: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | 'blocker';
  blocking: boolean;
  block_id: string;
  char_start: number | null;
  char_end: number | null;
  message: string;
  evidence_ids: string[];
  suggested_fix: string;
  status: 'open' | 'accepted_risk' | 'resolved' | 'wont_fix';
  handled_by: string;
  handling_reason: string;
  handled_at: string | null;
  created_at: string;
};

export type DeliverableReview = {
  review_uuid: string;
  version_uuid: string;
  version_no: number;
  content_hash: string;
  status: 'passed' | 'failed';
  gates_passed: boolean;
  total_score: number;
  rule_version_uuids: string[];
  category_results: Array<{
    category: string;
    status: 'passed' | 'failed';
    rule_count: number;
    issue_count: number;
    blocking_issue_count: number;
    duration_ms: number;
  }>;
  issues: ReviewIssue[];
  initiated_by: string;
  completed_at: string | null;
  created_at: string;
};

export type DeliverableReviewList = {
  request_id: string;
  items: DeliverableReview[];
  total: number;
  page: number;
  page_size: number;
};

export type DeliverableReviewMutation = {
  request_id: string;
  deliverable_uuid: string;
  lifecycle_status: string;
  row_version: number;
  review: DeliverableReview;
};

export type ReviewIssueMutation = {
  request_id: string;
  deliverable_uuid: string;
  issue: ReviewIssue;
};

export type DeliverableCommentReply = {
  reply_uuid: string;
  content: string;
  author_user_id: string;
  created_at: string;
};

export type DeliverableComment = {
  comment_uuid: string;
  version_uuid: string;
  block_id: string;
  char_start: number | null;
  char_end: number | null;
  content: string;
  status: string;
  author_user_id: string;
  resolved_by: string;
  resolved_at: string | null;
  resolution_reason: string;
  allowed_actions: string[];
  replies: DeliverableCommentReply[];
  created_at: string;
};

export type DeliverableCommentList = {
  request_id: string;
  deliverable_uuid?: string;
  items: DeliverableComment[];
  total: number;
};

export type DeliverableCommentMutation = {
  request_id: string;
  deliverable_uuid: string;
  comment: DeliverableComment;
};

export type DeliverableApprovalEvent = {
  event_uuid: string;
  event_type: string;
  version_uuid: string;
  approval_flow_version_uuid: string | null;
  content_hash: string;
  actor_user_id: string;
  comment_uuids: string[];
  row_version_before: number;
  row_version_after: number;
  created_at: string;
};

export type DeliverableApprovalMutation = {
  request_id: string;
  deliverable_uuid: string;
  lifecycle_status: string;
  row_version: number;
  event: DeliverableApprovalEvent;
};

export type DeliverableDeliveryRecord = {
  delivery_uuid: string;
  version_uuid: string;
  export_uuid: string;
  content_hash: string;
  delivered_by: string;
  recipient_description: string;
  note: string;
  delivered_at: string;
};

export type DeliverableDeliveryMutation = {
  request_id: string;
  deliverable_uuid: string;
  lifecycle_status: string;
  row_version: number;
  delivery: DeliverableDeliveryRecord;
};

export type ExactDeliverableVersionTarget = {
  row_version: number;
  version_uuid: string;
  content_hash: string;
};

export type DeliverableFactPatch = {
  row_version: number;
  claim_type?: DeliverableClaimType;
  claim_text?: string;
  status?: 'pending_confirmation' | 'confirmed' | 'inference' | 'rejected';
  critical?: boolean;
  rationale?: string;
};

export type DeliverableEvidenceAttach = {
  relation: 'supports' | 'contradicts' | 'context' | 'derived_from';
  source_type: 'knowledge_chunk';
  source_uuid: string;
  derived_expression?: string;
  input_fact_uuids?: string[];
  rounding_rule?: string;
};

export type ProfessionalPendingModelRequest = {
  step_uuid: string;
  request_hash: string;
  one_time_token: string | null;
  model_profile_uuid: string;
  system_prompt: string;
  instructions: string[];
  inputs: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  context: Record<string, unknown>;
};

export type ProfessionalRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_input'
  | 'waiting_for_model'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ProfessionalRun = {
  run_uuid: string;
  deliverable_uuid: string;
  status: ProfessionalRunStatus;
  phase: string;
  source_version_uuid: string;
  skill_version_uuid: string;
  template_version_uuid: string;
  context_hash: string;
  missing_fields: string[];
  pending_model_request: ProfessionalPendingModelRequest | null;
  created_version: DeliverableVersion | null;
  replayed: boolean;
};

export type AgentRunSummary = {
  run_id: string;
  title: string;
  run_type: string;
  status:
    | 'created'
    | 'queued'
    | 'running'
    | 'waiting_confirmation'
    | 'paused'
    | 'retrying'
    | 'succeeded'
    | 'completed'
    | 'failed'
    | 'cancelled';
  stage:
    | 'accepted'
    | 'routing'
    | 'retrieving'
    | 'planning'
    | 'executing'
    | 'reviewing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  progress: number;
  artifact: unknown | null;
  citations: unknown[];
  created_at: string | null;
  updated_at: string | null;
};

export type AgentRunStep = {
  step_id: string;
  run_id: string;
  sequence: number;
  step_type: string;
  status: string;
  role: string;
  summary: string;
};

export type ProfessionalRunEvent = {
  event_id: string;
  run_id: string;
  sequence: number;
  event_type: 'stage' | 'delta' | 'source' | 'review' | 'completed' | 'failed' | 'cancelled';
  stage: AgentRunSummary['stage'] | null;
  label: string;
  progress: number | null;
  content: string;
  source: unknown | null;
  artifact_id: string;
  quality: unknown | null;
};

export type ProfessionalRunStage = {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  duration_ms: number;
  summary: string;
  recover_action: 'supply_input' | 'resume' | 'open_deliverable' | null;
};

export type ProfessionalRunProjection = {
  run_uuid: string;
  deliverable_uuid: string;
  status: ProfessionalRunStatus;
  phase: string;
  source_version_uuid: string;
  skill_version_uuid: string;
  template_version_uuid: string;
  context_hash: string;
  missing_fields: string[];
  pending_model_request: ProfessionalPendingModelRequest | null;
  created_version_uuid: string | null;
  allowed_actions: string[];
  stages: ProfessionalRunStage[];
};

export type ProfessionalRunDetail = {
  run: AgentRunSummary;
  steps: AgentRunStep[];
  events: ProfessionalRunEvent[];
  result: Record<string, unknown>;
  professional: ProfessionalRunProjection | null;
};

export type ProfessionalRunStreamOptions = {
  after?: number;
  signal?: AbortSignal;
  maxReconnects?: number;
  reconnectDelayMs?: number;
  onEvent?: (event: ProfessionalRunEvent) => void | Promise<void>;
};

export type DeliverableExport = {
  request_id: string;
  deliverable_uuid: string;
  export_uuid: string;
  version_uuid: string;
  version_no: number;
  content_hash: string;
  export_format: string;
  status: string;
  watermarked: boolean;
  file_name: string;
  file_hash: string;
  file_size: number;
  renderer_version: string;
  download_url: string;
  created_by: string;
  created_at: string;
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

function jsonRequest(method: string, body?: unknown, idempotencyKey?: string): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function queryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export async function listProfessionalDeliverables(input: {
  projectUuid?: string;
  lifecycleStatus?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<DeliverableList> {
  const query = queryString({
    project_uuid: input.projectUuid,
    lifecycle_status: input.lifecycleStatus,
    page: input.page,
    page_size: input.pageSize ?? 50,
  });
  return readJson(
    await apiFetch(`/api/ai/deliverables${query}`, { cache: 'no-store' }),
    'PROFESSIONAL_DELIVERABLES_LIST_FAILED',
  );
}

export async function getProfessionalDeliverable(deliverableUuid: string): Promise<DeliverableDetail> {
  return readJson(
    await apiFetch(`/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}`, { cache: 'no-store' }),
    'PROFESSIONAL_DELIVERABLE_FAILED',
  );
}

export async function updateProfessionalDeliverableMetadata(
  deliverableUuid: string,
  input: { row_version: number; title: string },
  idempotencyKey = newIdempotencyKey('professional-deliverable-metadata'),
): Promise<DeliverableDetail> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}`,
      jsonRequest('PATCH', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_METADATA_UPDATE_FAILED',
  );
}

export async function refreshProfessionalDeliverableEvidence(
  deliverableUuid: string,
  idempotencyKey = newIdempotencyKey('professional-evidence-refresh'),
): Promise<DeliverableEvidenceRefresh> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/evidence/refresh`,
      jsonRequest('POST', undefined, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_EVIDENCE_REFRESH_FAILED',
  );
}

export async function createProfessionalDeliverable(input: {
  title: string;
  deliverable_type: string;
  scope_type: 'personal' | 'project';
  formality: 'working' | 'formal';
  project_uuid?: string;
  skill_version_uuid: string;
  template_version_uuid: string;
  content: DeliverableContent;
  content_summary?: string;
  creation_reason?: string;
}, idempotencyKey = newIdempotencyKey('professional-deliverable-create')): Promise<DeliverableDetail> {
  return readJson(
    await apiFetch('/api/ai/deliverables', jsonRequest('POST', input, idempotencyKey)),
    'PROFESSIONAL_DELIVERABLE_CREATE_FAILED',
  );
}

export async function createProfessionalDeliverableVersion(
  deliverableUuid: string,
  input: {
    row_version: number;
    parent_version_uuid?: string;
    content: DeliverableContent;
    content_summary?: string;
    change_summary: string;
    creation_reason?: string;
  },
  idempotencyKey = newIdempotencyKey('professional-deliverable-version'),
): Promise<{ request_id: string; deliverable_uuid: string; version: DeliverableVersion }> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/versions`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_VERSION_CREATE_FAILED',
  );
}

export async function listProfessionalDeliverableVersions(
  deliverableUuid: string,
): Promise<DeliverableVersionHistory> {
  return readJson(
    await apiFetch(`/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/versions`, { cache: 'no-store' }),
    'PROFESSIONAL_DELIVERABLE_VERSIONS_FAILED',
  );
}

export async function getProfessionalDeliverableVersion(
  deliverableUuid: string,
  versionUuid: string,
): Promise<DeliverableVersionDetail> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/versions/${encodeURIComponent(versionUuid)}`,
      { cache: 'no-store' },
    ),
    'PROFESSIONAL_DELIVERABLE_VERSION_FAILED',
  );
}

export async function getProfessionalDeliverableDiff(
  deliverableUuid: string,
  fromVersionUuid: string,
  toVersionUuid: string,
): Promise<DeliverableVersionDiff> {
  const query = queryString({ from: fromVersionUuid, to: toVersionUuid });
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/diff${query}`,
      { cache: 'no-store' },
    ),
    'PROFESSIONAL_DELIVERABLE_DIFF_FAILED',
  );
}

export async function getProfessionalDeliverableFacts(
  deliverableUuid: string,
  versionUuid: string,
): Promise<DeliverableFactList> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/versions/${encodeURIComponent(versionUuid)}/facts`,
      { cache: 'no-store' },
    ),
    'PROFESSIONAL_DELIVERABLE_FACTS_FAILED',
  );
}

export async function extractProfessionalDeliverableFacts(
  deliverableUuid: string,
  versionUuid: string,
  input: { content_hash: string },
  idempotencyKey = newIdempotencyKey('professional-facts-extract'),
): Promise<DeliverableFactList> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/versions/${encodeURIComponent(versionUuid)}/facts/extract`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_FACTS_EXTRACT_FAILED',
  );
}

export async function updateProfessionalDeliverableFact(
  factUuid: string,
  input: DeliverableFactPatch,
  idempotencyKey = newIdempotencyKey('professional-fact-update'),
): Promise<DeliverableFactMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/facts/${encodeURIComponent(factUuid)}`,
      jsonRequest('PATCH', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_FACT_UPDATE_FAILED',
  );
}

export async function searchProfessionalDeliverableEvidence(input: {
  deliverableUuid: string;
  versionUuid: string;
  query: string;
  limit?: number;
}): Promise<DeliverableEvidenceSearch> {
  const query = queryString({
    deliverable_uuid: input.deliverableUuid,
    version_uuid: input.versionUuid,
    q: input.query,
    limit: input.limit ?? 20,
  });
  return readJson(
    await apiFetch(`/api/ai/evidence/search${query}`, { cache: 'no-store' }),
    'PROFESSIONAL_DELIVERABLE_EVIDENCE_SEARCH_FAILED',
  );
}

export async function attachProfessionalDeliverableEvidence(
  factUuid: string,
  input: DeliverableEvidenceAttach,
  idempotencyKey = newIdempotencyKey('professional-evidence-attach'),
): Promise<DeliverableFactEvidenceMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/facts/${encodeURIComponent(factUuid)}/evidence`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_EVIDENCE_ATTACH_FAILED',
  );
}

export async function previewProfessionalDeliverableEvidence(
  evidenceUuid: string,
): Promise<{ request_id: string; evidence: DeliverableEvidence }> {
  return readJson(
    await apiFetch(`/api/ai/evidence/${encodeURIComponent(evidenceUuid)}/preview`, { cache: 'no-store' }),
    'PROFESSIONAL_DELIVERABLE_EVIDENCE_PREVIEW_FAILED',
  );
}

export async function revokeProfessionalDeliverableEvidence(
  evidenceUuid: string,
  input: { reason: string },
  idempotencyKey = newIdempotencyKey('professional-evidence-revoke'),
): Promise<{
  request_id: string;
  deliverable_uuid: string;
  lifecycle_status: string;
  row_version: number;
  evidence: DeliverableEvidence;
}> {
  return readJson(
    await apiFetch(
      `/api/ai/evidence/${encodeURIComponent(evidenceUuid)}/revoke`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_EVIDENCE_REVOKE_FAILED',
  );
}

export async function listProfessionalDeliverableReviews(
  deliverableUuid: string,
): Promise<DeliverableReviewList> {
  return readJson(
    await apiFetch(`/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/reviews`, { cache: 'no-store' }),
    'PROFESSIONAL_DELIVERABLE_REVIEWS_FAILED',
  );
}

export async function startProfessionalDeliverableReview(
  deliverableUuid: string,
  input: ExactDeliverableVersionTarget,
  idempotencyKey = newIdempotencyKey('professional-review-start'),
): Promise<DeliverableReviewMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/reviews`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_REVIEW_START_FAILED',
  );
}

export async function updateProfessionalReviewIssue(
  issueUuid: string,
  input: { status: 'resolved' | 'accepted_risk' | 'wont_fix'; reason: string },
): Promise<ReviewIssueMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/review-issues/${encodeURIComponent(issueUuid)}`,
      jsonRequest('PATCH', input),
    ),
    'PROFESSIONAL_DELIVERABLE_REVIEW_ISSUE_UPDATE_FAILED',
  );
}

export async function listProfessionalDeliverableComments(
  deliverableUuid: string,
): Promise<DeliverableCommentList> {
  return readJson(
    await apiFetch(`/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/comments`, { cache: 'no-store' }),
    'PROFESSIONAL_DELIVERABLE_COMMENTS_FAILED',
  );
}

export async function createProfessionalDeliverableComment(
  deliverableUuid: string,
  input: {
    version_uuid: string;
    block_id: string;
    char_start?: number;
    char_end?: number;
    content: string;
  },
  idempotencyKey = newIdempotencyKey('professional-comment-create'),
): Promise<DeliverableCommentMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/comments`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_COMMENT_CREATE_FAILED',
  );
}

export async function replyProfessionalDeliverableComment(
  commentUuid: string,
  input: { content: string },
  idempotencyKey = newIdempotencyKey('professional-comment-reply'),
): Promise<DeliverableCommentMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/comments/${encodeURIComponent(commentUuid)}/replies`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_COMMENT_REPLY_FAILED',
  );
}

export async function resolveProfessionalDeliverableComment(
  commentUuid: string,
  input: { reason: string },
  idempotencyKey = newIdempotencyKey('professional-comment-resolve'),
): Promise<DeliverableCommentMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/comments/${encodeURIComponent(commentUuid)}/resolve`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_COMMENT_RESOLVE_FAILED',
  );
}

export async function submitProfessionalDeliverable(
  deliverableUuid: string,
  input: ExactDeliverableVersionTarget & { approval_flow_version_uuid: string },
  idempotencyKey = newIdempotencyKey('professional-deliverable-submit'),
): Promise<DeliverableApprovalMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/submit`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_SUBMIT_FAILED',
  );
}

export async function approveProfessionalDeliverable(
  deliverableUuid: string,
  input: ExactDeliverableVersionTarget,
  idempotencyKey = newIdempotencyKey('professional-deliverable-approve'),
): Promise<DeliverableApprovalMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/approve`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_APPROVE_FAILED',
  );
}

export async function requestProfessionalDeliverableChanges(
  deliverableUuid: string,
  input: ExactDeliverableVersionTarget & { reason: string; comment_uuids: string[] },
  idempotencyKey = newIdempotencyKey('professional-deliverable-request-changes'),
): Promise<DeliverableApprovalMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/request-changes`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_REQUEST_CHANGES_FAILED',
  );
}

export async function deliverProfessionalDeliverable(
  deliverableUuid: string,
  input: ExactDeliverableVersionTarget & {
    export_uuid: string;
    recipient_description: string;
    note?: string;
  },
  idempotencyKey = newIdempotencyKey('professional-deliverable-deliver'),
): Promise<DeliverableDeliveryMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/deliver`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_DELIVER_FAILED',
  );
}

export async function archiveProfessionalDeliverable(
  deliverableUuid: string,
  input: ExactDeliverableVersionTarget & { delivery_uuid: string },
  idempotencyKey = newIdempotencyKey('professional-deliverable-archive'),
): Promise<DeliverableApprovalMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/archive`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_DELIVERABLE_ARCHIVE_FAILED',
  );
}

export async function submitProfessionalExperienceCandidate(
  deliverableUuid: string,
  input: ExactDeliverableVersionTarget & {
    candidate_type: 'structure' | 'rule' | 'template';
    deidentified_summary: string;
  },
  idempotencyKey = newIdempotencyKey('professional-experience-candidate'),
): Promise<DeliverableExperienceCandidateMutation> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/experience-candidates`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_EXPERIENCE_CANDIDATE_SUBMIT_FAILED',
  );
}

export async function startProfessionalRun(
  deliverableUuid: string,
  input: {
    row_version: number;
    source_version_uuid: string;
    inputs: Record<string, unknown>;
    resource_refs: Array<{ resource_type: 'knowledge_file'; resource_uuid: string }>;
    model_profile_uuid: string;
    max_steps?: number;
    max_model_calls?: number;
  },
  idempotencyKey = newIdempotencyKey('professional-run-start'),
): Promise<ProfessionalRun> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/runs`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_RUN_START_FAILED',
  );
}

export async function submitProfessionalModelResult(
  runUuid: string,
  stepUuid: string,
  input: {
    one_time_token: string;
    request_hash: string;
    content: DeliverableContent;
    content_hash: string;
    summary: string;
    model_metadata?: Record<string, unknown>;
  },
  idempotencyKey = newIdempotencyKey('professional-run-model-result'),
): Promise<ProfessionalRun> {
  return readJson(
    await apiFetch(
      `/api/ai/runs/${encodeURIComponent(runUuid)}/steps/${encodeURIComponent(stepUuid)}/model-result`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_RUN_MODEL_RESULT_FAILED',
  );
}

export async function getProfessionalRunDetail(runUuid: string): Promise<ProfessionalRunDetail> {
  return readJson(
    await apiFetch(`/api/ai/runs/${encodeURIComponent(runUuid)}`, { cache: 'no-store' }),
    'PROFESSIONAL_RUN_DETAIL_FAILED',
  );
}

export async function supplyProfessionalRunInput(
  runUuid: string,
  inputs: Record<string, unknown>,
  idempotencyKey = newIdempotencyKey('professional-run-input'),
): Promise<ProfessionalRun> {
  return readJson(
    await apiFetch(
      `/api/ai/runs/${encodeURIComponent(runUuid)}/input`,
      jsonRequest('POST', { inputs }, idempotencyKey),
    ),
    'PROFESSIONAL_RUN_INPUT_FAILED',
  );
}

export async function resumeProfessionalRun(
  runUuid: string,
  idempotencyKey = newIdempotencyKey('professional-run-resume'),
): Promise<ProfessionalRun> {
  return readJson(
    await apiFetch(
      `/api/ai/runs/${encodeURIComponent(runUuid)}/resume`,
      jsonRequest('POST', undefined, idempotencyKey),
    ),
    'PROFESSIONAL_RUN_RESUME_FAILED',
  );
}

export async function cancelProfessionalRun(runUuid: string): Promise<AgentRunSummary> {
  return readJson(
    await apiFetch(`/api/ai/runs/${encodeURIComponent(runUuid)}/cancel`, { method: 'POST' }),
    'PROFESSIONAL_RUN_CANCEL_FAILED',
  );
}

const TERMINAL_PROFESSIONAL_EVENT_TYPES = new Set<ProfessionalRunEvent['event_type']>([
  'completed',
  'failed',
  'cancelled',
]);

async function waitForReconnect(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeoutId = window.setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeoutId);
      resolve();
    }, { once: true });
  });
}

async function consumeProfessionalEventBlock(
  block: string,
  onEvent?: ProfessionalRunStreamOptions['onEvent'],
): Promise<ProfessionalRunEvent | null> {
  const payload = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!payload) return null;
  const event = JSON.parse(payload) as ProfessionalRunEvent;
  await onEvent?.(event);
  return event;
}

export async function streamProfessionalRunEvents(
  runUuid: string,
  options: ProfessionalRunStreamOptions = {},
): Promise<number> {
  let cursor = Math.max(0, options.after ?? 0);
  let reconnects = 0;
  const maxReconnects = Math.max(0, options.maxReconnects ?? 3);
  const reconnectDelayMs = Math.max(0, options.reconnectDelayMs ?? 500);

  while (!options.signal?.aborted) {
    let streamEndedNormally = false;
    try {
      const response = await apiFetch(
        `/api/ai/runs/${encodeURIComponent(runUuid)}/events?after=${cursor}`,
        {
          cache: 'no-store',
          headers: { Accept: 'text/event-stream' },
          signal: options.signal,
        },
      );
      if (!response.ok) {
        await readJson<never>(response, 'PROFESSIONAL_RUN_EVENTS_FAILED');
      }
      if (!response.body) {
        throw new ApiError(response.status, 'PROFESSIONAL_RUN_EVENTS_UNAVAILABLE');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminal = false;

      const drain = async (flush = false): Promise<void> => {
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = await consumeProfessionalEventBlock(block, options.onEvent);
          if (event) {
            cursor = Math.max(cursor, event.sequence);
            terminal = terminal || TERMINAL_PROFESSIONAL_EVENT_TYPES.has(event.event_type);
          }
          boundary = buffer.indexOf('\n\n');
        }
        if (flush && buffer.trim()) {
          const event = await consumeProfessionalEventBlock(buffer, options.onEvent);
          buffer = '';
          if (event) {
            cursor = Math.max(cursor, event.sequence);
            terminal = terminal || TERMINAL_PROFESSIONAL_EVENT_TYPES.has(event.event_type);
          }
        }
      };

      while (!terminal && !options.signal?.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        await drain();
      }
      buffer += decoder.decode();
      await drain(true);
      reader.releaseLock();

      if (terminal || options.signal?.aborted) return cursor;
      streamEndedNormally = true;
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return cursor;
      }
      if (reconnects >= maxReconnects) throw error;
    }

    if (reconnects >= maxReconnects) {
      if (streamEndedNormally) return cursor;
      break;
    }
    reconnects += 1;
    await waitForReconnect(reconnectDelayMs, options.signal);
  }

  return cursor;
}

export async function createProfessionalExport(
  deliverableUuid: string,
  versionUuid: string,
  input: { row_version: number; content_hash: string; export_format: 'docx' },
  idempotencyKey = newIdempotencyKey('professional-export-create'),
): Promise<DeliverableExport> {
  return readJson(
    await apiFetch(
      `/api/ai/deliverables/${encodeURIComponent(deliverableUuid)}/versions/${encodeURIComponent(versionUuid)}/exports`,
      jsonRequest('POST', input, idempotencyKey),
    ),
    'PROFESSIONAL_EXPORT_CREATE_FAILED',
  );
}

export async function downloadProfessionalExport(exportRecord: DeliverableExport): Promise<void> {
  const response = await apiFetch(exportRecord.download_url, { cache: 'no-store' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, 'PROFESSIONAL_EXPORT_DOWNLOAD_FAILED', payload);
  }
  await downloadBlobFromResponse(response, exportRecord.file_name);
}

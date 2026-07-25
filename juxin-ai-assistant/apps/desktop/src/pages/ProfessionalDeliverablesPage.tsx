import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listProfessionalApprovalFlows, type ProfessionalApprovalFlow } from '../api/approvalFlows';
import { ApiError, isSafeSameOriginUrl } from '../api/client';
import {
  approveProfessionalDeliverable,
  acquireProfessionalDeliverableLease,
  archiveProfessionalDeliverable,
  attachProfessionalDeliverableEvidence,
  createProfessionalDeliverableComment,
  createProfessionalDeliverableVersion,
  commitProfessionalDeliverableDraft,
  createProfessionalExport,
  deliverProfessionalDeliverable,
  downloadProfessionalExport,
  extractProfessionalDeliverableFacts,
  getProfessionalDeliverable,
  getProfessionalDeliverableDraft,
  heartbeatProfessionalDeliverableLease,
  importProfessionalDeliverableDocx,
  getProfessionalDeliverableDiff,
  getProfessionalDeliverableFacts,
  listProfessionalDeliverableComments,
  listProfessionalDeliverableReviews,
  listProfessionalDeliverables,
  listProfessionalDeliverableVersions,
  previewProfessionalDeliverableMedia,
  replyProfessionalDeliverableComment,
  requestProfessionalDeliverableChanges,
  refreshProfessionalDeliverableEvidence,
  releaseProfessionalDeliverableLease,
  resolveProfessionalDeliverableComment,
  saveProfessionalDeliverableDraft,
  searchProfessionalDeliverableEvidence,
  startProfessionalDeliverableReview,
  submitProfessionalDeliverable,
  submitProfessionalExperienceCandidate,
  updateProfessionalDeliverableFact,
  updateProfessionalDeliverableMetadata,
  updateProfessionalReviewIssue,
  type DeliverableApprovalMutation,
  type DeliverableBlock,
  type DeliverableComment,
  type DeliverableContent,
  type DeliverableDeliveryMutation,
  type DeliverableDetail,
  type DeliverableDocxImport,
  type DeliverableDraft,
  type DeliverableEvidenceSearchItem,
  type DeliverableExperienceCandidate,
  type DeliverableExport,
  type DeliverableFact,
  type DeliverableLease,
  type DeliverableReview,
  type DeliverableSummary,
  type DeliverableVersionDiff,
  type DeliverableVersionHistoryItem,
  type ReviewIssue,
  uploadProfessionalDeliverableMedia,
} from '../api/deliverables';
import { DocumentBlockEditor } from '../components/DocumentBlockEditor';
import {
  blocksToPlainText,
  appendMedia,
  editableBlocks,
  removeDocumentBlock,
  replaceEditableText,
  toEditorDocument,
} from '../components/documentBlockAdapter';

import './professional-delivery.css';

type ProfessionalDeliverablesPageProps = {
  initialDeliverableId?: string;
  initialVersionId?: string;
  onLocationChange?: (location: { deliverableId: string; versionId: string }) => void;
};

type RightPanel = 'facts' | 'review' | 'comments' | 'versions' | 'activity';
type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'conflict' | 'error';
type LeaseState = 'idle' | 'acquiring' | 'owned' | 'blocked' | 'expired';

type MediaPreviewState = {
  blockId: string;
  alt: string;
  sourceUrl: string;
};

type MediaUploadState = {
  status: 'idle' | 'uploading' | 'error';
  fileName: string;
  file: File | null;
  error: string;
};

export type BlockDeleteImpact = {
  facts: number;
  issues: number;
  comments: number;
};

type PendingBlockDeletion = {
  block: DeliverableBlock;
  impact: BlockDeleteImpact;
};

export function getBlockDeleteImpact(
  blockId: string,
  facts: DeliverableFact[],
  reviews: DeliverableReview[],
  comments: DeliverableComment[],
): BlockDeleteImpact {
  return {
    facts: facts.filter((fact) => fact.block_id === blockId).length,
    issues: reviews.reduce((total, review) => total + review.issues.filter((issue) => issue.block_id === blockId).length, 0),
    comments: comments.filter((comment) => comment.block_id === blockId).length,
  };
}

type OfficeImportReport = NonNullable<DeliverableDocxImport['import_report']>;
type OfficeExportReport = NonNullable<DeliverableExport['export_report']>;

function officeReportStatusLabel(status: string): string {
  if (status === 'supported') return '已完整识别';
  if (status === 'degraded') return '存在降级内容';
  if (status === 'rejected') return '包含拒绝内容';
  return status;
}

function officeReportItemLabel(item: Record<string, unknown>): string {
  const code = typeof item.code === 'string' ? item.code : 'unknown_feature';
  const message = typeof item.message === 'string' ? item.message : '需要人工确认';
  return `${code}：${message}`;
}

function OfficeReportPanel({
  label,
  report,
}: {
  label: string;
  report: OfficeImportReport | OfficeExportReport;
}) {
  const degraded = report.degraded_features ?? [];
  const rejected = report.rejected_features ?? [];
  return (
    <details className="professional-office-report">
      <summary>{label}：{officeReportStatusLabel(report.status)}</summary>
      <div className="professional-office-report-body">
        <span>已支持 {report.supported_features.length} 项</span>
        {degraded.length ? (
          <div>
            <strong>降级</strong>
            <ul>{degraded.map((item, index) => <li key={`degraded-${index}`}>{officeReportItemLabel(item)}</li>)}</ul>
          </div>
        ) : null}
        {rejected.length ? (
          <div>
            <strong>拒绝</strong>
            <ul>{rejected.map((item, index) => <li key={`rejected-${index}`}>{officeReportItemLabel(item)}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

const statusLabels: Record<string, string> = {
  draft: '草稿',
  quality_review: '质量审阅中',
  pending_approval: '待审批',
  changes_requested: '待修改',
  approved: '已批准',
  delivered: '已交付',
  archived: '已归档',
};

const factStatusLabels: Record<DeliverableFact['status'], string> = {
  pending_confirmation: '待人工确认',
  supported: '有证据支持',
  confirmed: '已确认',
  inference: '推断',
  unsupported: '缺少证据',
  conflicted: '证据冲突',
  stale: '证据已失效',
  rejected: '已否定',
};

const issueStatusLabels: Record<ReviewIssue['status'], string> = {
  open: '待处理',
  accepted_risk: '已接受风险',
  resolved: '已解决',
  wont_fix: '不处理',
};

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback;
  const payload = error.payload as { detail?: string | { message?: string } } | undefined;
  if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail;
  if (payload?.detail && typeof payload.detail === 'object' && payload.detail.message) {
    return payload.detail.message;
  }
  return fallback;
}

function leaseConflictDetails(error: unknown): { ownerUserId: string | null; expiresAt: string | null } {
  if (!(error instanceof ApiError)) return { ownerUserId: null, expiresAt: null };
  const payload = error.payload as {
    detail?: string | {
      message?: string;
      owner_user_id?: string;
      expires_at?: string;
      details?: { owner_user_id?: string; expires_at?: string };
    };
  } | undefined;
  const detail = payload?.detail && typeof payload.detail === 'object' ? payload.detail : undefined;
  const details = detail?.details ?? detail;
  return {
    ownerUserId: typeof details?.owner_user_id === 'string' ? details.owner_user_id : null,
    expiresAt: typeof details?.expires_at === 'string' ? details.expires_at : null,
  };
}

function updateVersionList(
  versions: DeliverableVersionHistoryItem[],
  version: DeliverableDetail['current_version'],
): DeliverableVersionHistoryItem[] {
  return [{
    version_uuid: version.version_uuid,
    version_no: version.version_no,
    parent_version_uuid: version.parent_version_uuid,
    skill_version_uuid: version.skill_version_uuid,
    template_version_uuid: version.template_version_uuid,
    title_snapshot: version.title_snapshot,
    summary_snapshot: version.summary_snapshot,
    change_summary: version.change_summary,
    creation_reason: version.creation_reason,
    content_hash: version.content_hash,
    created_at: version.created_at,
    is_current: true,
  }, ...versions.map((item) => ({ ...item, is_current: false }))];
}

function formatEvidenceLocation(item: DeliverableEvidenceSearchItem): string {
  const { location } = item;
  return [
    location.file_name,
    location.page_number === null ? '' : `第 ${location.page_number} 页`,
    location.sheet_name ? `工作表 ${location.sheet_name}` : '',
    location.cell_range,
    location.section_title,
    location.paragraph_index === null ? '' : `第 ${location.paragraph_index} 段`,
  ].filter(Boolean).join(' · ');
}

function formatTextLocation(location: { block_id: string; char_start: number | null; char_end: number | null }): string {
  const range = location.char_start === null || location.char_end === null
    ? ''
    : ` · 字符 ${location.char_start}–${location.char_end}`;
  return `区块 ${location.block_id}${range}`;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '空';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function ProfessionalDeliverablesPage({
  initialDeliverableId,
  initialVersionId,
  onLocationChange,
}: ProfessionalDeliverablesPageProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const restoredVersionRef = useRef('');
  const [deliverables, setDeliverables] = useState<DeliverableSummary[]>([]);
  const [selectedId, setSelectedId] = useState(initialDeliverableId ?? '');
  const [detail, setDetail] = useState<DeliverableDetail | null>(null);
  const [editorContent, setEditorContent] = useState<DeliverableContent | null>(null);
  const [editorText, setEditorText] = useState('');
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [fencingToken, setFencingToken] = useState<number | null>(null);
  const [leaseState, setLeaseState] = useState<LeaseState>('idle');
  const [leaseExpiresAt, setLeaseExpiresAt] = useState<string | null>(null);
  const [leaseOwnerUserId, setLeaseOwnerUserId] = useState<string | null>(null);
  const leaseRef = useRef<{ deliverableUuid: string; fencingToken: number } | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [autosaveRetry, setAutosaveRetry] = useState(0);
  const autosaveSignatureRef = useRef('');
  const [versions, setVersions] = useState<DeliverableVersionHistoryItem[]>([]);
  const [facts, setFacts] = useState<DeliverableFact[]>([]);
  const [reviews, setReviews] = useState<DeliverableReview[]>([]);
  const [comments, setComments] = useState<DeliverableComment[]>([]);
  const [approvalFlows, setApprovalFlows] = useState<ProfessionalApprovalFlow[]>([]);
  const [selectedFlowVersionUuid, setSelectedFlowVersionUuid] = useState('');
  const [evidenceResults, setEvidenceResults] = useState<Record<string, DeliverableEvidenceSearchItem[]>>({});
  const [versionDiff, setVersionDiff] = useState<DeliverableVersionDiff | null>(null);
  const [selectedCommentIds, setSelectedCommentIds] = useState<string[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBlockId, setCommentBlockId] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [resolutionReasons, setResolutionReasons] = useState<Record<string, string>>({});
  const [issueReasons, setIssueReasons] = useState<Record<string, string>>({});
  const [rightPanel, setRightPanel] = useState<RightPanel>('facts');
  const [statusFilter, setStatusFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaUploadState, setMediaUploadState] = useState<MediaUploadState>({
    status: 'idle',
    fileName: '',
    file: null,
    error: '',
  });
  const [mediaDropActive, setMediaDropActive] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [revisionMode, setRevisionMode] = useState(false);
  const [exportRecord, setExportRecord] = useState<DeliverableExport | null>(null);
  const [importReport, setImportReport] = useState<OfficeImportReport | null>(null);
  const [exportReport, setExportReport] = useState<OfficeExportReport | null>(null);
  const [deliveryRecord, setDeliveryRecord] = useState<DeliverableDeliveryMutation['delivery'] | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [experienceType, setExperienceType] = useState<'structure' | 'rule' | 'template'>('structure');
  const [experienceSummary, setExperienceSummary] = useState('');
  const [experienceCandidate, setExperienceCandidate] = useState<DeliverableExperienceCandidate | null>(null);
  const [recipient, setRecipient] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState | null>(null);
  const [locatedBlockId, setLocatedBlockId] = useState<string | null>(null);
  const [pendingBlockDeletion, setPendingBlockDeletion] = useState<PendingBlockDeletion | null>(null);

  useEffect(() => {
    if (initialDeliverableId) setSelectedId(initialDeliverableId);
  }, [initialDeliverableId]);

  useEffect(() => () => {
    if (mediaPreview?.sourceUrl.startsWith('blob:')) URL.revokeObjectURL(mediaPreview.sourceUrl);
  }, [mediaPreview]);

  const applyLease = (lease: DeliverableLease) => {
    setFencingToken(lease.fencing_token);
    setLeaseState('owned');
    setLeaseExpiresAt(lease.expires_at);
    setLeaseOwnerUserId(lease.owner_user_id);
    leaseRef.current = {
      deliverableUuid: lease.deliverable_uuid,
      fencingToken: lease.fencing_token,
    };
  };

  const clearLease = (nextState: LeaseState = 'idle') => {
    leaseRef.current = null;
    setFencingToken(null);
    setLeaseState(nextState);
    setLeaseExpiresAt(null);
    setLeaseOwnerUserId(null);
  };

  const acquireEditorLease = async (
    targetDetail: DeliverableDetail,
    targetDraft: DeliverableDraft | null = null,
  ): Promise<boolean> => {
    setLeaseState('acquiring');
    setError('');
    try {
      const lease = await acquireProfessionalDeliverableLease(targetDetail.deliverable_uuid, {
        row_version: targetDraft?.row_version ?? targetDetail.row_version,
        base_version_uuid: targetDraft?.base_version_uuid ?? targetDetail.current_version.version_uuid,
      });
      applyLease(lease);
      return true;
    } catch (nextError: unknown) {
      const conflict = leaseConflictDetails(nextError);
      clearLease(nextError instanceof ApiError && nextError.status === 409 ? 'blocked' : 'expired');
      if (conflict.ownerUserId) {
        setLeaseOwnerUserId(conflict.ownerUserId);
        setLeaseExpiresAt(conflict.expiresAt);
        setError(`成果正在被 ${conflict.ownerUserId} 编辑，当前已切换为只读。${conflict.expiresAt ? `预计 ${new Date(conflict.expiresAt).toLocaleTimeString('zh-CN')} 后可重试。` : ''}`);
      } else {
        setError(readableError(nextError, '暂时无法获取编辑权，当前已切换为只读。'));
      }
      return false;
    }
  };

  useEffect(() => {
    return () => {
      const previousLease = leaseRef.current;
      if (!previousLease) return;
      leaseRef.current = null;
      void releaseProfessionalDeliverableLease(previousLease.deliverableUuid, previousLease.fencingToken).catch(() => undefined);
    };
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listProfessionalDeliverables({ pageSize: 50 })
      .then((payload) => {
        if (!active) return;
        setDeliverables(payload.items);
        setSelectedId((current) => current || payload.items[0]?.deliverable_uuid || '');
      })
      .catch((nextError: unknown) => {
        if (active) setError(readableError(nextError, '成果列表加载失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setEditorContent(null);
      setDraftRevision(null);
      clearLease();
      setAutosaveState('idle');
      setAutosaveRetry(0);
      autosaveSignatureRef.current = '';
      return;
    }
    let active = true;
    setError('');
    setMessage('');
    setVersionDiff(null);
    setEvidenceResults({});
    setRevisionMode(false);
    setExportRecord(null);
    setDeliveryRecord(null);
    setExperienceCandidate(null);
    setMediaPreview(null);
    setDraftRevision(null);
    clearLease();
    setAutosaveState('idle');
    setAutosaveRetry(0);
    autosaveSignatureRef.current = '';
    refreshProfessionalDeliverableEvidence(selectedId)
      .then(() => getProfessionalDeliverable(selectedId))
      .then(async (nextDetail) => {
        if (!active) return;
        setDetail(nextDetail);
        setTitleDraft(nextDetail.title);
        let draft: DeliverableDraft | null = null;
        try {
          draft = await getProfessionalDeliverableDraft(selectedId);
        } catch {
          // Older deployments do not expose the draft endpoint yet; use the
          // immutable version endpoint until the migration is complete.
        }
        if (!active) return;
        const nextContent = toEditorDocument(draft?.content ?? nextDetail.current_version.content);
        setEditorContent(nextContent);
        setEditorText(blocksToPlainText(nextContent));
        autosaveSignatureRef.current = JSON.stringify({
          rowVersion: nextDetail.row_version,
          baseVersion: nextDetail.current_version.version_uuid,
          content: nextContent,
        });
        setDraftRevision(draft?.draft_revision ?? null);
        setAutosaveState(draft && draft.draft_revision > 0 ? 'saved' : 'idle');
        setCommentBlockId(editableBlocks(nextContent)[0]?.block_id ?? 'document');
        if (nextDetail.allowed_actions.includes('edit')) {
          await acquireEditorLease(nextDetail, draft);
          if (!active) return;
        }
        const [versionResult, factResult, reviewResult, commentResult] = await Promise.allSettled([
          listProfessionalDeliverableVersions(selectedId),
          getProfessionalDeliverableFacts(selectedId, nextDetail.current_version.version_uuid),
          listProfessionalDeliverableReviews(selectedId),
          listProfessionalDeliverableComments(selectedId),
        ]);
        if (!active) return;
        setVersions(versionResult.status === 'fulfilled' ? versionResult.value.items : []);
        setFacts(factResult.status === 'fulfilled' ? factResult.value.items : []);
        setReviews(reviewResult.status === 'fulfilled' ? reviewResult.value.items : []);
        setComments(commentResult.status === 'fulfilled' ? commentResult.value.items : []);
        setSelectedCommentIds([]);
      })
      .catch((nextError: unknown) => {
        if (active) setError(readableError(nextError, '成果详情加载失败'));
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!detail?.allowed_actions.includes('submit')) {
      setApprovalFlows([]);
      setSelectedFlowVersionUuid('');
      return;
    }
    let active = true;
    const scopeType = detail.scope_type === 'project' ? 'project' : 'personal';
    listProfessionalApprovalFlows({
      scopeType,
      deliverableType: detail.deliverable_type,
      projectUuid: detail.project_uuid ?? undefined,
    })
      .then((payload) => {
        if (!active) return;
        setApprovalFlows(payload.items);
        setSelectedFlowVersionUuid(payload.items[0]?.current_version.version_uuid ?? '');
      })
      .catch((nextError: unknown) => {
        if (active) setError(readableError(nextError, '审批流加载失败'));
      });
    return () => {
      active = false;
    };
  }, [detail?.allowed_actions, detail?.deliverable_type, detail?.project_uuid, detail?.scope_type]);

  const deliverableTypes = useMemo(() => Array.from(new Set(
    deliverables.map((item) => item.deliverable_type).filter(Boolean),
  )), [deliverables]);

  const filteredDeliverables = useMemo(() => deliverables.filter((item) => {
    const matchesStatus = !statusFilter || item.lifecycle_status === statusFilter;
    const matchesScope = !scopeFilter || item.scope_type === scopeFilter;
    const matchesType = !typeFilter || item.deliverable_type === typeFilter;
    const actionable = item.allowed_actions?.some((action) => (
      ['submit', 'approve', 'request_changes', 'deliver', 'archive'].includes(action)
    )) ?? false;
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query
      || item.title.toLocaleLowerCase().includes(query)
      || item.content_summary.toLocaleLowerCase().includes(query);
    return matchesStatus && matchesScope && matchesType && (!pendingOnly || actionable) && matchesSearch;
  }), [deliverables, pendingOnly, scopeFilter, search, statusFilter, typeFilter]);

  const dirty = detail && editorContent
    ? JSON.stringify(editorContent) !== JSON.stringify(toEditorDocument(detail.current_version.content))
    : false;
  const hasAction = (action: string) => detail?.allowed_actions.includes(action) ?? false;
  const canEdit = leaseState === 'owned' && (hasAction('edit') || revisionMode);
  const canAcquireLease = hasAction('edit') || hasAction('create_revision') || revisionMode;
  const currentFlow = approvalFlows.find((flow) => (
    flow.current_version.version_uuid === selectedFlowVersionUuid
  )) ?? approvalFlows[0] ?? null;

  const autosaveLabel = autosaveState === 'pending'
    ? '等待自动保存'
    : autosaveState === 'saving'
      ? '正在保存草稿…'
      : autosaveState === 'saved'
        ? '草稿已自动保存'
        : autosaveState === 'conflict'
          ? '草稿冲突，需刷新'
          : autosaveState === 'error'
            ? '自动保存失败'
              : dirty
              ? '存在未保存修改'
              : `内容哈希 ${detail?.current_version.content_hash.slice(0, 10) ?? ''}…`;

  const leaseLabel = leaseState === 'owned'
    ? '已获得编辑权'
    : leaseState === 'acquiring'
      ? '正在获取编辑权…'
      : leaseState === 'blocked'
        ? '他人编辑中，只读'
        : leaseState === 'expired'
          ? '编辑权已失效，只读'
          : '只读模式';

  useEffect(() => {
    if (!detail || fencingToken === null || leaseState !== 'owned' || !canEdit) return undefined;
    let active = true;
    const timer = window.setInterval(() => {
      void heartbeatProfessionalDeliverableLease(detail.deliverable_uuid, fencingToken)
        .then((lease) => {
          if (!active) return;
          setLeaseExpiresAt(lease.expires_at);
        })
        .catch((nextError: unknown) => {
          if (!active) return;
          clearLease('expired');
          setAutosaveState('conflict');
          setError(nextError instanceof ApiError && nextError.status === 409
            ? '编辑权已失效，当前已切换为只读。请重新获取编辑权后再保存。'
            : readableError(nextError, '编辑权续期失败，当前已切换为只读。'));
        });
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canEdit, detail, fencingToken, leaseState]);

  useEffect(() => {
    if (!detail || !editorContent || draftRevision === null || !dirty || !canEdit) return undefined;
    const signature = JSON.stringify({
      rowVersion: detail.row_version,
      baseVersion: detail.current_version.version_uuid,
      content: editorContent,
    });
    if (autosaveSignatureRef.current === signature) return undefined;
    setAutosaveState('pending');
    const timer = window.setTimeout(() => {
      setAutosaveState('saving');
      void saveProfessionalDeliverableDraft(detail.deliverable_uuid, {
        row_version: detail.row_version,
        base_version_uuid: detail.current_version.version_uuid,
        draft_revision: draftRevision,
        content: editorContent,
        content_summary: blocksToPlainText(editorContent).slice(0, 4000),
        fencing_token: fencingToken ?? undefined,
      })
        .then((savedDraft) => {
          autosaveSignatureRef.current = signature;
          setDraftRevision(savedDraft.draft_revision);
          setAutosaveState('saved');
        })
        .catch((nextError: unknown) => {
          if (nextError instanceof ApiError && nextError.status === 409) {
            setAutosaveState('conflict');
            setError('草稿保存冲突，请刷新后恢复最新内容。');
            return;
          }
          setAutosaveState('error');
          setError(readableError(nextError, '草稿自动保存失败，可重试。'));
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [autosaveRetry, canEdit, detail, draftRevision, dirty, editorContent, fencingToken]);

  const exactTarget = () => {
    if (!detail) throw new Error('尚未选择成果');
    return {
      row_version: detail.row_version,
      version_uuid: detail.current_version.version_uuid,
      content_hash: detail.current_version.content_hash,
    };
  };

  const importDocx = async (file: File) => {
    if (!detail || !canEdit || importingDocx) return;
    setImportingDocx(true);
    setError('');
    setMessage('');
    try {
      const payload = await importProfessionalDeliverableDocx(detail.deliverable_uuid, file);
      const nextContent = toEditorDocument(payload.content);
      setEditorContent(nextContent);
      setEditorText(blocksToPlainText(nextContent));
      setImportReport(payload.import_report ?? {
        status: payload.warnings.length ? 'degraded' : 'supported',
        supported_features: [],
        degraded_features: payload.warnings.map((warning) => ({ code: warning, message: warning })),
        rejected_features: [],
      });
      setExportReport(null);
      autosaveSignatureRef.current = '';
      setMessage(payload.warnings.length
        ? `已导入 ${payload.source_file_name}，媒体处理有 ${payload.warnings.length} 项警告，请检查。`
        : `已导入 ${payload.source_file_name}，内容已回填编辑器。`);
    } catch (nextError: unknown) {
      setError(readableError(nextError, 'DOCX 导入失败'));
    } finally {
      setImportingDocx(false);
    }
  };

  const uploadMedia = async (file: File) => {
    if (!detail || !canEdit || uploadingMedia) return;
    if (!file.type.startsWith('image/')) {
      setError('只能上传图片文件。');
      return;
    }
    setUploadingMedia(true);
    setMediaUploadState({ status: 'uploading', fileName: file.name, file, error: '' });
    setError('');
    setMessage('');
    try {
      const asset = await uploadProfessionalDeliverableMedia(detail.deliverable_uuid, file);
      const nextContent = appendMedia(editorContent ?? detail.current_version.content, {
        asset_id: asset.asset_uuid,
        url: asset.download_url,
        alt: asset.original_file_name,
        mime_type: asset.media_type,
        size_bytes: asset.size_bytes,
      });
      setEditorContent(nextContent);
      setEditorText(blocksToPlainText(nextContent));
      autosaveSignatureRef.current = '';
      setMediaUploadState({ status: 'idle', fileName: file.name, file: null, error: '' });
      setMessage(`${asset.replayed ? '已恢复' : '已上传'} ${asset.original_file_name}，已插入正文。`);
    } catch (nextError: unknown) {
      const nextMessage = readableError(nextError, '图片上传失败');
      setMediaUploadState((current) => ({ ...current, status: 'error', error: nextMessage }));
      setError(nextMessage);
    } finally {
      setUploadingMedia(false);
    }
  };

  const retryMediaUpload = () => {
    if (mediaUploadState.file) void uploadMedia(mediaUploadState.file);
  };

  const mediaAssetId = (block: { [key: string]: unknown }): string => {
    const value = block.asset_id ?? block.asset_uuid;
    return typeof value === 'string' ? value : '';
  };

  const previewMedia = async (block: { [key: string]: unknown; block_id: string }) => {
    if (!detail) return;
    const assetUuid = mediaAssetId(block);
    const fallbackUrl = typeof block.url === 'string' ? block.url : '';
    setBusyAction(`preview-media:${block.block_id}`);
    setError('');
    try {
      const response = assetUuid
        ? await previewProfessionalDeliverableMedia(detail.deliverable_uuid, assetUuid)
        : null;
      const blob = response ? await response.blob() : null;
      const objectUrl = blob && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(blob)
        : fallbackUrl;
      if (!objectUrl) throw new Error('图片暂无可预览内容');
      if (!objectUrl.startsWith('blob:') && !isSafeSameOriginUrl(objectUrl)) {
        throw new Error('图片链接不安全，无法预览');
      }
      setMediaPreview({
        blockId: block.block_id,
        alt: String(block.alt ?? block.url ?? '图片'),
        sourceUrl: objectUrl,
      });
    } catch (nextError: unknown) {
      setError(readableError(nextError, '图片预览失败'));
    } finally {
      setBusyAction('');
    }
  };

  const deleteBlock = async (block: DeliverableBlock) => {
    if (!detail || (editorContent ?? detail.current_version.content).blocks.length <= 1) return;
    setBusyAction(`delete-block:${block.block_id}`);
    setError('');
    try {
      const nextContent = removeDocumentBlock(
        editorContent ?? detail.current_version.content,
        block.block_id,
      );
      setEditorContent(nextContent);
      setEditorText(blocksToPlainText(nextContent));
      autosaveSignatureRef.current = '';
      setMediaPreview((current) => current?.blockId === block.block_id ? null : current);
      setPendingBlockDeletion(null);
      // Keep media assets while immutable versions may still reference them.
      // The server-side orphan cleanup job removes unreferenced assets after
      // the retention window; deleting here would break historical exports.
      setMessage(`区块「${block.block_id}」已从当前草稿移除，影响将在保存后写入新版本。`);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '区块删除失败'));
    } finally {
      setBusyAction('');
    }
  };

  const requestDeleteBlock = (block: DeliverableBlock) => {
    if (!detail || !canEdit) return;
    const impact = getBlockDeleteImpact(block.block_id, facts, reviews, comments);
    if (impact.facts + impact.issues + impact.comments > 0) {
      setPendingBlockDeletion({ block, impact });
      return;
    }
    void deleteBlock(block);
  };

  const updateListLifecycle = (lifecycleStatus: string, rowVersion: number) => {
    if (!detail) return;
    setDeliverables((current) => current.map((item) => item.deliverable_uuid === detail.deliverable_uuid
      ? { ...item, lifecycle_status: lifecycleStatus, row_version: rowVersion, updated_at: new Date().toISOString() }
      : item));
  };

  const applyApprovalMutation = (payload: DeliverableApprovalMutation) => {
    setDetail((current) => current ? {
      ...current,
      lifecycle_status: payload.lifecycle_status,
      row_version: payload.row_version,
      allowed_actions: current.allowed_actions.filter((action) => (
        !['submit', 'approve', 'request_changes'].includes(action)
      )),
      updated_at: payload.event.created_at,
    } : current);
    updateListLifecycle(payload.lifecycle_status, payload.row_version);
  };

  const refreshAuthoritativeDetail = async (minimumRowVersion = 0) => {
    if (!detail) return;
    try {
      const refreshed = await getProfessionalDeliverable(detail.deliverable_uuid);
      if (refreshed.row_version < minimumRowVersion) return;
      let refreshedDraft: DeliverableDraft | null = null;
      try {
        // Re-read the mutable draft as well: the server rebases it when the
        // immutable base version changes, so clearing it locally would leave
        // the editor in a non-autosaving mode after a conflict.
        refreshedDraft = await getProfessionalDeliverableDraft(refreshed.deliverable_uuid);
      } catch {
        // Keep the immutable version as a safe fallback for older deployments.
      }
      setDetail(refreshed);
      setTitleDraft(refreshed.title);
      const refreshedContent = toEditorDocument(refreshedDraft?.content ?? refreshed.current_version.content);
      setEditorContent(refreshedContent);
      setEditorText(blocksToPlainText(refreshedContent));
      setDraftRevision(refreshedDraft?.draft_revision ?? null);
      clearLease();
      setAutosaveState(refreshedDraft && refreshedDraft.draft_revision > 0 ? 'saved' : 'idle');
      setAutosaveRetry(0);
      autosaveSignatureRef.current = JSON.stringify({
        rowVersion: refreshed.row_version,
        baseVersion: refreshed.current_version.version_uuid,
        content: refreshedContent,
      });
      if (refreshed.allowed_actions.includes('edit')) {
        await acquireEditorLease(refreshed, refreshedDraft);
      }
      setDeliverables((current) => current.map((item) => item.deliverable_uuid === refreshed.deliverable_uuid
        ? { ...item, ...refreshed }
        : item));
    } catch (nextError: unknown) {
      setError(readableError(nextError, '刷新成果失败'));
    }
  };

  const enterRevisionMode = async () => {
    if (!detail || !canAcquireLease || leaseState === 'acquiring') return;
    const acquired = leaseState === 'owned' || await acquireEditorLease(detail);
    if (acquired) setRevisionMode(true);
  };

  const saveVersion = async () => {
    if (!detail || !dirty || saving) return;
    if (!canEdit || fencingToken === null) {
      setError('当前没有有效编辑权，内容已保持只读。请先重新获取编辑权。');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const nextContent = editorContent ?? replaceEditableText(editorText, detail.current_version.content);
      const changeSummary = revisionMode ? '基于已定稿版本修订' : '人工修订';
      let payload;
      if (draftRevision !== null) {
        const savedDraft = await saveProfessionalDeliverableDraft(detail.deliverable_uuid, {
          row_version: detail.row_version,
          base_version_uuid: detail.current_version.version_uuid,
          draft_revision: draftRevision,
          content: nextContent,
          content_summary: blocksToPlainText(nextContent).slice(0, 4000),
          fencing_token: fencingToken ?? undefined,
        });
        payload = await commitProfessionalDeliverableDraft(detail.deliverable_uuid, {
          row_version: detail.row_version,
          base_version_uuid: detail.current_version.version_uuid,
          draft_revision: savedDraft.draft_revision,
          change_summary: changeSummary,
          creation_reason: revisionMode ? 'revision' : 'manual_edit',
          fencing_token: fencingToken ?? undefined,
        });
      } else {
        payload = await createProfessionalDeliverableVersion(detail.deliverable_uuid, {
          row_version: detail.row_version,
          parent_version_uuid: detail.current_version.version_uuid,
          content: nextContent,
          content_summary: editorText.slice(0, 4000),
          change_summary: changeSummary,
          creation_reason: revisionMode ? 'revision' : 'manual_edit',
        });
      }
      const updatedDetail: DeliverableDetail = {
        ...detail,
        row_version: detail.row_version + 1,
        lifecycle_status: 'draft',
        content_summary: payload.version.summary_snapshot,
        current_version: payload.version,
        updated_at: payload.version.created_at,
      };
      setDetail(updatedDetail);
      const savedContent = toEditorDocument(payload.version.content);
      setEditorContent(savedContent);
      setEditorText(blocksToPlainText(savedContent));
      setDraftRevision(draftRevision === null ? null : 0);
      const savedLease = leaseRef.current;
      clearLease();
      if (savedLease) {
        void releaseProfessionalDeliverableLease(savedLease.deliverableUuid, savedLease.fencingToken).catch(() => undefined);
      }
      setAutosaveState('saved');
      autosaveSignatureRef.current = '';
      setVersions((current) => updateVersionList(current, payload.version));
      setFacts([]);
      setReviews([]);
      setVersionDiff(null);
      setRevisionMode(false);
      setDeliverables((current) => current.map((item) => item.deliverable_uuid === detail.deliverable_uuid
        ? {
          ...item,
          row_version: updatedDetail.row_version,
          lifecycle_status: updatedDetail.lifecycle_status,
          content_summary: updatedDetail.content_summary,
          updated_at: updatedDetail.updated_at,
        }
        : item));
      setMessage(`已保存为版本 V${payload.version.version_no}`);
    } catch (nextError: unknown) {
      if (nextError instanceof ApiError && nextError.status === 409) {
        setError('成果已被他人更新，请刷新后再保存。');
      } else {
        setError(readableError(nextError, '保存新版本失败'));
      }
    } finally {
      setSaving(false);
    }
  };

  const saveMetadata = async () => {
    const nextTitle = titleDraft.trim();
    if (!detail || !nextTitle || nextTitle === detail.title) return;
    setBusyAction('metadata');
    setError('');
    setMessage('');
    try {
      const refreshed = await updateProfessionalDeliverableMetadata(detail.deliverable_uuid, {
        row_version: detail.row_version,
        title: nextTitle,
      });
      setDetail(refreshed);
      setTitleDraft(refreshed.title);
      setDeliverables((current) => current.map((item) => item.deliverable_uuid === refreshed.deliverable_uuid
        ? { ...item, ...refreshed }
        : item));
      setMessage('成果标题已更新，历史版本标题快照保持不变');
    } catch (nextError: unknown) {
      if (nextError instanceof ApiError && nextError.status === 409) {
        setError('成果已被他人更新，请刷新后再修改标题。');
      } else {
        setError(readableError(nextError, '更新成果标题失败'));
      }
    } finally {
      setBusyAction('');
    }
  };

  const exportCurrentVersion = async (): Promise<DeliverableExport | null> => {
    if (!detail || exporting) return null;
    setExporting(true);
    setError('');
    setMessage('');
    try {
      const record = await createProfessionalExport(
        detail.deliverable_uuid,
        detail.current_version.version_uuid,
        {
          row_version: detail.row_version,
          content_hash: detail.current_version.content_hash,
          export_format: 'docx',
        },
      );
      setExportRecord(record);
      setExportReport(record.export_report ?? null);
      await downloadProfessionalExport(record);
      setMessage(`已导出 ${record.file_name}`);
      return record;
    } catch (nextError: unknown) {
      setError(readableError(nextError, 'Word 导出失败'));
      return null;
    } finally {
      setExporting(false);
    }
  };

  const locateBlock = (blockId: string, charStart: number | null, charEnd: number | null) => {
    if (!detail) return;
    const blocks = editableBlocks(editorContent ?? detail.current_version.content);
    let offset = 0;
    for (const block of blocks) {
      const blockText = String(block.text ?? '').trim();
      if (block.block_id === blockId) {
        const start = Math.min(blockText.length, Math.max(0, charStart ?? 0));
        const end = Math.min(blockText.length, Math.max(start, charEnd ?? start));
        if (editorRef.current) {
          editorRef.current.focus();
          editorRef.current.setSelectionRange(offset + start, offset + end);
        }
        const target = Array.from(editorSurfaceRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])
          .find((element) => element.dataset.blockId === blockId);
        if (target) {
          if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.focus();
          setLocatedBlockId(blockId);
          window.setTimeout(() => setLocatedBlockId((current) => current === blockId ? null : current), 1600);
        }
        return;
      }
      offset += blockText.length + 2;
    }
    editorRef.current?.focus();
  };

  const confirmFact = async (fact: DeliverableFact) => {
    setBusyAction(`fact:${fact.fact_uuid}`);
    setError('');
    try {
      const payload = await updateProfessionalDeliverableFact(fact.fact_uuid, {
        row_version: fact.row_version,
        status: 'confirmed',
        rationale: '人工核验确认',
      });
      setFacts((current) => current.map((item) => (
        item.fact_uuid === fact.fact_uuid ? payload.fact : item
      )));
      setMessage('事实已确认');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '确认事实失败'));
    } finally {
      setBusyAction('');
    }
  };

  const findEvidence = async (fact: DeliverableFact) => {
    if (!detail) return;
    setBusyAction(`evidence:${fact.fact_uuid}`);
    setError('');
    try {
      const payload = await searchProfessionalDeliverableEvidence({
        deliverableUuid: detail.deliverable_uuid,
        versionUuid: detail.current_version.version_uuid,
        query: fact.claim_text,
      });
      setEvidenceResults((current) => ({ ...current, [fact.fact_uuid]: payload.items }));
    } catch (nextError: unknown) {
      setError(readableError(nextError, '证据检索失败'));
    } finally {
      setBusyAction('');
    }
  };

  const attachEvidence = async (fact: DeliverableFact, evidence: DeliverableEvidenceSearchItem) => {
    setBusyAction(`attach:${fact.fact_uuid}:${evidence.source_uuid}`);
    setError('');
    try {
      const payload = await attachProfessionalDeliverableEvidence(fact.fact_uuid, {
        relation: 'supports',
        source_type: 'knowledge_chunk',
        source_uuid: evidence.source_uuid,
      });
      setFacts((current) => current.map((item) => (
        item.fact_uuid === fact.fact_uuid ? payload.fact : item
      )));
      setMessage('已关联证据并保存来源快照');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '关联证据失败'));
    } finally {
      setBusyAction('');
    }
  };

  const extractFacts = async () => {
    if (!detail) return;
    setBusyAction('extract-facts');
    setError('');
    try {
      const payload = await extractProfessionalDeliverableFacts(
        detail.deliverable_uuid,
        detail.current_version.version_uuid,
        { content_hash: detail.current_version.content_hash },
      );
      setFacts(payload.items);
      setMessage(`已识别 ${payload.total} 条事实与判断`);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '事实提取失败'));
    } finally {
      setBusyAction('');
    }
  };

  const startReview = async () => {
    if (!detail) return;
    setBusyAction('review');
    setError('');
    try {
      const payload = await startProfessionalDeliverableReview(detail.deliverable_uuid, exactTarget());
      setReviews((current) => [payload.review, ...current]);
      setDetail((current) => current ? {
        ...current,
        lifecycle_status: payload.lifecycle_status,
        row_version: payload.row_version,
      } : current);
      updateListLifecycle(payload.lifecycle_status, payload.row_version);
      setRightPanel('review');
      setMessage(payload.review.gates_passed ? '质量审阅通过' : '质量审阅完成，请处理阻断项');
      void refreshAuthoritativeDetail(payload.row_version);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '质量审阅失败'));
    } finally {
      setBusyAction('');
    }
  };

  const handleReviewIssue = async (issue: ReviewIssue, status: 'resolved' | 'accepted_risk') => {
    const reason = issueReasons[issue.issue_uuid]?.trim();
    if (!reason) {
      setError('请填写问题处理说明。');
      return;
    }
    setBusyAction(`issue:${issue.issue_uuid}`);
    try {
      const payload = await updateProfessionalReviewIssue(issue.issue_uuid, { status, reason });
      setReviews((current) => current.map((review) => ({
        ...review,
        issues: review.issues.map((item) => item.issue_uuid === issue.issue_uuid ? payload.issue : item),
      })));
      setMessage(status === 'resolved' ? '问题已标记解决' : '风险接受已记录');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '更新审阅问题失败'));
    } finally {
      setBusyAction('');
    }
  };

  const createComment = async () => {
    if (!detail || !commentDraft.trim()) return;
    setBusyAction('comment');
    setError('');
    try {
      const payload = await createProfessionalDeliverableComment(detail.deliverable_uuid, {
        version_uuid: detail.current_version.version_uuid,
        block_id: commentBlockId || 'document',
        content: commentDraft.trim(),
      });
      setComments((current) => [payload.comment, ...current]);
      setCommentDraft('');
      setMessage('评论已发布');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '发布评论失败'));
    } finally {
      setBusyAction('');
    }
  };

  const replyToComment = async (comment: DeliverableComment) => {
    const content = replyDrafts[comment.comment_uuid]?.trim();
    if (!content) return;
    setBusyAction(`reply:${comment.comment_uuid}`);
    try {
      const payload = await replyProfessionalDeliverableComment(comment.comment_uuid, { content });
      setComments((current) => current.map((item) => (
        item.comment_uuid === comment.comment_uuid ? payload.comment : item
      )));
      setReplyDrafts((current) => ({ ...current, [comment.comment_uuid]: '' }));
      setMessage('回复已发布');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '回复评论失败'));
    } finally {
      setBusyAction('');
    }
  };

  const resolveComment = async (comment: DeliverableComment) => {
    const reason = resolutionReasons[comment.comment_uuid]?.trim();
    if (!reason) {
      setError('请填写评论解决说明。');
      return;
    }
    setBusyAction(`resolve:${comment.comment_uuid}`);
    try {
      const payload = await resolveProfessionalDeliverableComment(comment.comment_uuid, { reason });
      setComments((current) => current.map((item) => (
        item.comment_uuid === comment.comment_uuid ? payload.comment : item
      )));
      setMessage('评论已解决');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '解决评论失败'));
    } finally {
      setBusyAction('');
    }
  };

  const compareVersion = useCallback(async (version: DeliverableVersionHistoryItem) => {
    if (!detail) return;
    setBusyAction(`diff:${version.version_uuid}`);
    setError('');
    try {
      const payload = await getProfessionalDeliverableDiff(
        detail.deliverable_uuid,
        version.version_uuid,
        detail.current_version.version_uuid,
      );
      setVersionDiff(payload);
      onLocationChange?.({
        deliverableId: detail.deliverable_uuid,
        versionId: version.version_uuid,
      });
    } catch (nextError: unknown) {
      setError(readableError(nextError, '版本比较失败'));
    } finally {
      setBusyAction('');
    }
  }, [detail, onLocationChange]);

  useEffect(() => {
    const requestedVersionId = initialVersionId?.trim();
    if (!detail || !requestedVersionId || !versions.length) return;
    const restoreKey = `${detail.deliverable_uuid}:${requestedVersionId}`;
    if (restoredVersionRef.current === restoreKey) return;
    restoredVersionRef.current = restoreKey;
    const requestedVersion = versions.find((version) => version.version_uuid === requestedVersionId);
    if (!requestedVersion) {
      onLocationChange?.({ deliverableId: detail.deliverable_uuid, versionId: '' });
      return;
    }
    setRightPanel('versions');
    if (requestedVersion.is_current || requestedVersion.version_uuid === detail.current_version.version_uuid) {
      setVersionDiff(null);
      return;
    }
    void compareVersion(requestedVersion);
  }, [compareVersion, detail, initialVersionId, onLocationChange, versions]);

  const submitForApproval = async () => {
    if (!detail || !selectedFlowVersionUuid) {
      setError('当前成果没有可用的已发布审批流。');
      return;
    }
    setBusyAction('submit');
    setError('');
    try {
      const payload = await submitProfessionalDeliverable(detail.deliverable_uuid, {
        ...exactTarget(),
        approval_flow_version_uuid: selectedFlowVersionUuid,
      });
      applyApprovalMutation(payload);
      setMessage('已提交审批');
      void refreshAuthoritativeDetail(payload.row_version);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '提交审批失败'));
    } finally {
      setBusyAction('');
    }
  };

  const approveCurrentVersion = async () => {
    if (!detail) return;
    setBusyAction('approve');
    setError('');
    try {
      const payload = await approveProfessionalDeliverable(detail.deliverable_uuid, exactTarget());
      applyApprovalMutation(payload);
      setMessage('当前版本已批准');
      void refreshAuthoritativeDetail(payload.row_version);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '批准成果失败'));
    } finally {
      setBusyAction('');
    }
  };

  const requestChanges = async () => {
    if (!detail) return;
    if (!changeReason.trim() || selectedCommentIds.length === 0) {
      setError('退回修改必须填写原因并至少关联一条评论。');
      return;
    }
    setBusyAction('request-changes');
    setError('');
    try {
      const payload = await requestProfessionalDeliverableChanges(detail.deliverable_uuid, {
        ...exactTarget(),
        reason: changeReason.trim(),
        comment_uuids: selectedCommentIds,
      });
      applyApprovalMutation(payload);
      setMessage('已退回修改');
      void refreshAuthoritativeDetail(payload.row_version);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '退回修改失败'));
    } finally {
      setBusyAction('');
    }
  };

  const deliverCurrentVersion = async () => {
    if (!detail || !exportRecord || !recipient.trim()) {
      setError('交付前请先导出当前版本，并填写接收方。');
      return;
    }
    setBusyAction('deliver');
    setError('');
    try {
      const payload = await deliverProfessionalDeliverable(detail.deliverable_uuid, {
        ...exactTarget(),
        export_uuid: exportRecord.export_uuid,
        recipient_description: recipient.trim(),
        note: deliveryNote.trim(),
      });
      setDeliveryRecord(payload.delivery);
      setDetail((current) => current ? {
        ...current,
        lifecycle_status: payload.lifecycle_status,
        row_version: payload.row_version,
        allowed_actions: current.allowed_actions.filter((action) => action !== 'deliver'),
      } : current);
      updateListLifecycle(payload.lifecycle_status, payload.row_version);
      setMessage('成果已交付并锁定交付版本');
      void refreshAuthoritativeDetail(payload.row_version);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '交付成果失败'));
    } finally {
      setBusyAction('');
    }
  };

  const submitExperienceCandidate = async () => {
    if (!detail || !experienceSummary.trim()) return;
    setBusyAction('experience-candidate');
    setError('');
    setMessage('');
    try {
      const payload = await submitProfessionalExperienceCandidate(detail.deliverable_uuid, {
        ...exactTarget(),
        candidate_type: experienceType,
        deidentified_summary: experienceSummary.trim(),
      });
      setExperienceCandidate(payload.candidate);
      setExperienceSummary('');
      setMessage('脱敏经验候选已提交，等待人工审核');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '提交经验候选失败'));
    } finally {
      setBusyAction('');
    }
  };

  const archiveDelivery = async () => {
    if (!detail || !deliveryRecord) {
      setError('未找到本次交付记录，刷新后请从交付记录进入归档。');
      return;
    }
    setBusyAction('archive');
    setError('');
    try {
      const payload = await archiveProfessionalDeliverable(detail.deliverable_uuid, {
        ...exactTarget(),
        delivery_uuid: deliveryRecord.delivery_uuid,
      });
      applyApprovalMutation(payload);
      setMessage('成果已归档');
      void refreshAuthoritativeDetail(payload.row_version);
    } catch (nextError: unknown) {
      setError(readableError(nextError, '归档成果失败'));
    } finally {
      setBusyAction('');
    }
  };

  if (loading && !deliverables.length) {
    return <div className="professional-page"><div className="professional-empty-state">正在加载成果中心…</div></div>;
  }

  return (
    <div className="professional-page professional-deliverables-page">
      <header className="professional-workbench-header">
        <div>
          <span className="professional-eyebrow">DELIVERABLE WORKBENCH</span>
          <h1>{detail?.title ?? '成果中心'}</h1>
          <div className="professional-workbench-meta">
            {detail ? (
              <>
                <span data-status={detail.lifecycle_status}>{statusLabels[detail.lifecycle_status] ?? detail.lifecycle_status}</span>
                <span>V{detail.current_version.version_no}</span>
                <span>{detail.scope_type === 'project' ? '项目成果' : '个人成果'}</span>
                <span>{detail.formality === 'formal' ? '正式成果' : '工作稿'}</span>
                <span title={detail.current_version.skill_version_uuid}>Skill {detail.current_version.skill_version_uuid}</span>
                <span title={detail.current_version.template_version_uuid}>模板 {detail.current_version.template_version_uuid}</span>
                {detail.lifecycle_status === 'approved' ? <strong>批准版本已锁定</strong> : null}
                {detail.lifecycle_status === 'delivered' ? <strong>交付版本已锁定</strong> : null}
              </>
            ) : <span>选择一项成果开始审阅</span>}
          </div>
        </div>
        <div className="professional-header-actions">
          {canEdit ? (
            <button className="professional-primary-button" disabled={!dirty || saving} onClick={() => void saveVersion()} type="button">
              {saving ? '保存中…' : '保存为新版本'}
            </button>
          ) : null}
          {hasAction('create_revision') && !revisionMode ? (
            <button className="professional-secondary-button" disabled={leaseState === 'acquiring'} onClick={() => void enterRevisionMode()} type="button">
              {leaseState === 'acquiring' ? '获取编辑权…' : '创建修订版本'}
            </button>
          ) : null}
          {hasAction('review') ? (
            <button className="professional-secondary-button" disabled={busyAction === 'review'} onClick={() => void startReview()} type="button">
              {busyAction === 'review' ? '审阅中…' : '运行质量审阅'}
            </button>
          ) : null}
          {hasAction('export') ? (
            <button className="professional-secondary-button" disabled={exporting} onClick={() => void exportCurrentVersion()} type="button">
              {exporting ? '导出中…' : '导出 Word'}
            </button>
          ) : null}
          {hasAction('submit') ? (
            <button className="professional-primary-button" disabled={!selectedFlowVersionUuid || busyAction === 'submit'} onClick={() => void submitForApproval()} type="button">
              提交审批
            </button>
          ) : null}
          {hasAction('approve') ? (
            <button className="professional-primary-button" disabled={busyAction === 'approve'} onClick={() => void approveCurrentVersion()} type="button">
              批准当前版本
            </button>
          ) : null}
          <button className="professional-quiet-button" onClick={() => void refreshAuthoritativeDetail()} type="button">刷新</button>
        </div>
      </header>

      {hasAction('submit') && currentFlow ? (
        <div className="professional-approval-strip">
          <label>
            <span>审批流</span>
            <select aria-label="审批流" onChange={(event) => setSelectedFlowVersionUuid(event.target.value)} value={selectedFlowVersionUuid}>
              {approvalFlows.map((flow) => (
                <option key={flow.current_version.version_uuid} value={flow.current_version.version_uuid}>
                  {flow.name} V{flow.current_version.version}
                </option>
              ))}
            </select>
          </label>
          <strong>审批流：{currentFlow.name} V{currentFlow.current_version.version}</strong>
          <span>{currentFlow.current_version.allow_author_approve ? '允许作者参与审批' : '作者不可自批'} · 至少 {currentFlow.current_version.min_approvals} 人批准</span>
        </div>
      ) : null}

      {error ? <div className="professional-alert is-error" role="alert">{error}</div> : null}
      {message ? <div className="professional-alert is-success" role="status">{message}</div> : null}
      {importReport ? <OfficeReportPanel label="DOCX 导入报告" report={importReport} /> : null}
      {exportReport ? <OfficeReportPanel label="Word 导出报告" report={exportReport} /> : null}

      <div className="professional-delivery-layout">
        <aside className="professional-deliverable-list-panel">
          <div className="professional-list-heading">
            <div>
              <span>全部成果</span>
              <strong>{filteredDeliverables.length}/{deliverables.length}</strong>
            </div>
            <input aria-label="搜索成果" onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题或摘要" type="search" value={search} />
            <div className="professional-compact-filters">
              <select aria-label="成果范围" onChange={(event) => setScopeFilter(event.target.value)} value={scopeFilter}>
                <option value="">全部范围</option>
                <option value="personal">个人</option>
                <option value="project">项目</option>
              </select>
              <select aria-label="成果状态" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="">全部状态</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <select aria-label="成果类型" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
              <option value="">全部类型</option>
              {deliverableTypes.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <label className="professional-toggle-filter">
              <input checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} type="checkbox" />
              <span>只看待我处理</span>
            </label>
          </div>
          <div className="professional-deliverable-list">
            {filteredDeliverables.length ? filteredDeliverables.map((item) => (
              <button
                className={item.deliverable_uuid === selectedId ? 'is-current' : ''}
                key={item.deliverable_uuid}
                onClick={() => {
                  restoredVersionRef.current = '';
                  setSelectedId(item.deliverable_uuid);
                  onLocationChange?.({ deliverableId: item.deliverable_uuid, versionId: '' });
                }}
                type="button"
              >
                <span data-status={item.lifecycle_status}>{statusLabels[item.lifecycle_status] ?? item.lifecycle_status}</span>
                <strong>{item.title}</strong>
                <small>{item.content_summary || '暂无摘要'}</small>
                <time>{new Date(item.updated_at).toLocaleString('zh-CN')}</time>
              </button>
            )) : <p className="professional-empty">没有符合条件的成果。</p>}
          </div>
        </aside>

        <section className="professional-editor-panel">
          {detail ? (
            <>
              <div className="professional-editor-toolbar">
                <div>
                  <span>结构化正文</span>
                  <strong className={`professional-lease-indicator is-${leaseState}`} data-lease-state={leaseState}>{leaseLabel}</strong>
                  <strong aria-live="polite" data-autosave-state={autosaveState}>{autosaveLabel}</strong>
                  {autosaveState === 'error' ? (
                    <button
                      className="professional-quiet-button"
                      onClick={() => {
                        setError('');
                        setAutosaveRetry((value) => value + 1);
                      }}
                      type="button"
                    >立即重试</button>
                  ) : null}
                  {autosaveState === 'conflict' ? (
                    <button
                      className="professional-quiet-button"
                      onClick={() => void refreshAuthoritativeDetail(detail.row_version)}
                      type="button"
                    >刷新恢复</button>
                  ) : null}
                </div>
                {canEdit ? (
                  <div
                    aria-label="导入与图片上传区"
                    className={`professional-editor-import${mediaDropActive ? ' is-drop-active' : ''}`}
                    onDragEnter={(event) => {
                      if (event.dataTransfer.types.includes('Files')) setMediaDropActive(true);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMediaDropActive(false);
                    }}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes('Files')) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(event) => {
                      const file = event.dataTransfer.files?.[0];
                      setMediaDropActive(false);
                      if (!file || !file.type.startsWith('image/')) return;
                      event.preventDefault();
                      void uploadMedia(file);
                    }}
                    role="group"
                  >
                    <input
                      ref={docxInputRef}
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      aria-label="选择 DOCX 文件"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void importDocx(file);
                      }}
                      type="file"
                    />
                    <button
                      disabled={importingDocx}
                      onClick={() => docxInputRef.current?.click()}
                      type="button"
                    >
                      {importingDocx ? '导入中…' : '导入 DOCX'}
                    </button>
                    <input
                      ref={mediaInputRef}
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      aria-label="选择图片"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void uploadMedia(file);
                      }}
                      type="file"
                    />
                    <button
                      disabled={uploadingMedia}
                      onClick={() => mediaInputRef.current?.click()}
                      type="button"
                    >
                      {uploadingMedia ? '上传中…' : '上传图片'}
                    </button>
                    {mediaUploadState.status === 'error' && mediaUploadState.file ? (
                      <button
                        aria-label="重试图片上传"
                        className="professional-quiet-button"
                        onClick={retryMediaUpload}
                        type="button"
                      >重试</button>
                    ) : null}
                    <small
                      aria-busy={mediaUploadState.status === 'uploading'}
                      aria-live="polite"
                      className={`professional-editor-import-status${mediaUploadState.status === 'error' ? ' is-error' : ''}`}
                    >
                      {mediaUploadState.status === 'uploading'
                        ? `正在处理 ${mediaUploadState.fileName}…`
                        : mediaUploadState.status === 'error'
                          ? `${mediaUploadState.fileName} 上传失败，可重试`
                          : '支持将图片直接拖入'}
                    </small>
                  </div>
                ) : null}
                <span>{revisionMode ? '修订模式' : detail.current_version.change_summary}</span>
              </div>
              {detail.current_version.content.blocks.some((block) => block.type === 'heading') ? (
                <nav className="professional-section-nav" aria-label="正文目录">
                  {detail.current_version.content.blocks.filter((block) => block.type === 'heading').map((block) => (
                    <button key={block.block_id} onClick={() => locateBlock(block.block_id, 0, 0)} type="button">{String(block.text ?? block.block_id)}</button>
                  ))}
                </nav>
              ) : null}
              {leaseState !== 'owned' ? (
                <div className="professional-editor-lock-notice" role="status">
                  <strong>{leaseLabel}</strong>
                  {leaseState === 'blocked' && leaseOwnerUserId ? <span>当前编辑者：{leaseOwnerUserId}{leaseExpiresAt ? ` · 预计 ${new Date(leaseExpiresAt).toLocaleTimeString('zh-CN')} 释放` : ''}</span> : null}
                  {leaseState === 'expired' ? <span>编辑权已失效，重新获取后才能继续输入或保存。</span> : null}
                  {canAcquireLease && leaseState !== 'acquiring' ? (
                    <button className="professional-quiet-button" onClick={() => void acquireEditorLease(detail)} type="button">重新获取编辑权</button>
                  ) : null}
                </div>
              ) : null}
              <DocumentBlockEditor
                content={editorContent ?? detail.current_version.content}
                containerRef={editorSurfaceRef}
                disabled={!canEdit}
                onRequestDeleteBlock={requestDeleteBlock}
                onChange={(nextContent) => {
                  setEditorContent(nextContent);
                  setEditorText(blocksToPlainText(nextContent));
                  setAutosaveState('pending');
                }}
                onPreviewMedia={(block) => void previewMedia(block)}
                textareaRef={editorRef}
                locatedBlockId={locatedBlockId}
              />
              {pendingBlockDeletion ? (
                <div
                  aria-label="删除区块影响确认"
                  className="professional-block-delete-warning"
                  role="alertdialog"
                >
                  <div>
                    <strong>删除区块前确认</strong>
                    <p>
                      区块「{pendingBlockDeletion.block.block_id}」已绑定
                      {pendingBlockDeletion.impact.facts} 条事实、
                      {pendingBlockDeletion.impact.issues} 个审阅问题和
                      {pendingBlockDeletion.impact.comments} 条评论。删除只会修改当前草稿，相关锚点会在新版本中失效。
                    </p>
                  </div>
                  <div className="professional-block-delete-warning-actions">
                    <button
                      className="professional-quiet-button is-danger"
                      disabled={busyAction === `delete-block:${pendingBlockDeletion.block.block_id}`}
                      onClick={() => void deleteBlock(pendingBlockDeletion.block)}
                      type="button"
                    >继续删除</button>
                    <button
                      className="professional-quiet-button"
                      onClick={() => setPendingBlockDeletion(null)}
                      type="button"
                    >取消</button>
                  </div>
                </div>
              ) : null}
              {mediaPreview ? (
                <div aria-label="图片预览" className="professional-media-preview" role="dialog">
                  <div className="professional-media-preview-card">
                    <div className="professional-media-preview-heading">
                      <strong>{mediaPreview.alt}</strong>
                      <button
                        aria-label="关闭图片预览"
                        className="professional-quiet-button"
                        onClick={() => setMediaPreview(null)}
                        type="button"
                      >
                        关闭
                      </button>
                    </div>
                    {mediaPreview.sourceUrl.startsWith('blob:') || isSafeSameOriginUrl(mediaPreview.sourceUrl) ? (
                      <img alt={mediaPreview.alt} src={mediaPreview.sourceUrl} />
                    ) : (
                      <p className="professional-muted-text">图片链接不安全，无法预览。</p>
                    )}
                  </div>
                </div>
              ) : null}
              <footer className="professional-editor-footer">
                <span>{editorText.length.toLocaleString('zh-CN')} 字符</span>
                <span>每次保存都会创建不可变版本，不会覆盖历史内容。</span>
              </footer>
            </>
          ) : <div className="professional-empty-state">请选择左侧成果。</div>}
        </section>

        <aside className="professional-inspector-panel">
          <div className="professional-inspector-tabs" role="tablist" aria-label="成果检查器">
            {([
              ['facts', '事实与证据'],
              ['review', '质量审阅'],
              ['comments', '评论'],
              ['versions', '版本'],
              ['activity', '动态'],
            ] as Array<[RightPanel, string]>).map(([key, label]) => (
              <button
                aria-selected={rightPanel === key}
                className={rightPanel === key ? 'is-current' : ''}
                key={key}
                onClick={() => setRightPanel(key)}
                role="tab"
                type="button"
              >{label}</button>
            ))}
          </div>
          <div className="professional-inspector-content" role="tabpanel">
            {rightPanel === 'facts' ? (
              <>
                {hasAction('manage_facts') ? (
                  <button className="professional-quiet-button professional-panel-action" disabled={busyAction === 'extract-facts'} onClick={() => void extractFacts()} type="button">
                    重新提取事实
                  </button>
                ) : null}
                {facts.length ? facts.map((fact) => (
                  <article className="professional-inspector-card professional-fact-card" key={fact.fact_uuid}>
                    <div className="professional-card-heading">
                      <span className="professional-state-label" data-status={fact.status}>{factStatusLabels[fact.status]}</span>
                      {fact.critical ? <em>关键事实</em> : null}
                    </div>
                    <strong>{fact.claim_text}</strong>
                    <p>{fact.claim_type === 'inference' ? '分析推断' : '事实陈述'} · {formatTextLocation(fact)}</p>
                    {fact.rationale ? <p>说明：{fact.rationale}</p> : null}
                    {hasAction('manage_facts') ? (
                      <div className="professional-card-actions">
                        {fact.status === 'pending_confirmation' ? (
                          <button className="professional-quiet-button" disabled={busyAction === `fact:${fact.fact_uuid}`} onClick={() => void confirmFact(fact)} type="button">确认事实</button>
                        ) : null}
                        <button className="professional-quiet-button" disabled={busyAction === `evidence:${fact.fact_uuid}`} onClick={() => void findEvidence(fact)} type="button">查找证据</button>
                      </div>
                    ) : null}
                    {(evidenceResults[fact.fact_uuid] ?? []).map((evidence) => (
                      <div className="professional-evidence-result" key={`${evidence.source_type}:${evidence.source_uuid}`}>
                        <strong>{formatEvidenceLocation(evidence)}</strong>
                        <p>{evidence.quote}</p>
                        <button className="professional-quiet-button" disabled={busyAction === `attach:${fact.fact_uuid}:${evidence.source_uuid}`} onClick={() => void attachEvidence(fact, evidence)} type="button">关联为证据</button>
                      </div>
                    ))}
                  </article>
                )) : <p className="professional-empty">当前版本暂无已提取事实。</p>}
              </>
            ) : null}
            {rightPanel === 'review' ? (
              reviews.length ? reviews.map((review) => (
                <article className="professional-review-card" key={review.review_uuid}>
                  <div className="professional-review-score">
                    <span data-status={review.status}>{review.gates_passed ? '质量门禁通过' : '质量门禁未通过'}</span>
                    <strong>{review.total_score}<small>/100</small></strong>
                  </div>
                  <div className="professional-review-categories">
                    {review.category_results.map((category) => (
                      <span data-status={category.status} key={category.category}>{category.category} · {category.issue_count}</span>
                    ))}
                  </div>
                  {review.issues.map((issue) => (
                    <section className="professional-review-issue" key={issue.issue_uuid}>
                      <div className="professional-card-heading">
                        <span data-status={issue.status}>{issueStatusLabels[issue.status]}</span>
                        <em>{issue.blocking ? '阻断项' : issue.severity}</em>
                      </div>
                      <strong>{issue.message}</strong>
                      <p>{formatTextLocation(issue)}</p>
                      {issue.suggested_fix ? <p>建议：{issue.suggested_fix}</p> : null}
                      <button className="professional-quiet-button" onClick={() => locateBlock(issue.block_id, issue.char_start, issue.char_end)} type="button">定位正文</button>
                      {hasAction('resolve_review_issue') && issue.status === 'open' ? (
                        <div className="professional-inline-form">
                          <label>
                            <span>处理说明</span>
                            <input aria-label={`问题处理说明：${issue.message}`} onChange={(event) => setIssueReasons((current) => ({ ...current, [issue.issue_uuid]: event.target.value }))} value={issueReasons[issue.issue_uuid] ?? ''} />
                          </label>
                          <div className="professional-card-actions">
                            <button className="professional-quiet-button" onClick={() => void handleReviewIssue(issue, 'resolved')} type="button">标记解决</button>
                            {!issue.blocking ? <button className="professional-quiet-button" onClick={() => void handleReviewIssue(issue, 'accepted_risk')} type="button">接受风险</button> : null}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  ))}
                </article>
              )) : <p className="professional-empty">当前版本尚未执行质量审阅。</p>
            ) : null}
            {rightPanel === 'comments' ? (
              <>
                {hasAction('comment') && detail ? (
                  <div className="professional-inline-form professional-comment-composer">
                    <label>
                      <span>评论区块</span>
                      <select aria-label="评论区块" onChange={(event) => setCommentBlockId(event.target.value)} value={commentBlockId}>
                        {detail.current_version.content.blocks.map((block) => <option key={block.block_id} value={block.block_id}>{String(block.text ?? block.block_id).slice(0, 30)}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>新增评论</span>
                      <textarea aria-label="新增评论" onChange={(event) => setCommentDraft(event.target.value)} value={commentDraft} />
                    </label>
                    <button className="professional-quiet-button" disabled={!commentDraft.trim() || busyAction === 'comment'} onClick={() => void createComment()} type="button">发布评论</button>
                  </div>
                ) : null}
                {comments.length ? comments.map((comment) => (
                  <article className="professional-inspector-card professional-comment-card" key={comment.comment_uuid}>
                    <div className="professional-card-heading">
                      <span data-status={comment.status}>{comment.status === 'resolved' ? '已解决' : '待处理'}</span>
                      <em>{comment.author_user_id}</em>
                    </div>
                    <strong>{comment.content}</strong>
                    <p>{formatTextLocation(comment)}</p>
                    {hasAction('request_changes') && comment.status !== 'resolved' ? (
                      <label className="professional-comment-selector">
                        <input
                          aria-label={`关联评论：${comment.content}`}
                          checked={selectedCommentIds.includes(comment.comment_uuid)}
                          onChange={(event) => setSelectedCommentIds((current) => event.target.checked
                            ? [...current, comment.comment_uuid]
                            : current.filter((value) => value !== comment.comment_uuid))}
                          type="checkbox"
                        />
                        <span>退回时关联此评论</span>
                      </label>
                    ) : null}
                    {comment.replies.map((reply) => <p className="professional-comment-reply" key={reply.reply_uuid}><strong>{reply.author_user_id}</strong>{reply.content}</p>)}
                    {hasAction('reply_comment') && comment.status !== 'resolved' ? (
                      <div className="professional-inline-form">
                        <label>
                          <span>回复</span>
                          <input aria-label={`回复评论：${comment.content}`} onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.comment_uuid]: event.target.value }))} value={replyDrafts[comment.comment_uuid] ?? ''} />
                        </label>
                        <button className="professional-quiet-button" onClick={() => void replyToComment(comment)} type="button">回复</button>
                      </div>
                    ) : null}
                    {comment.allowed_actions?.includes('resolve_comment') && comment.status !== 'resolved' ? (
                      <div className="professional-inline-form">
                        <label>
                          <span>解决说明</span>
                          <input aria-label={`评论解决说明：${comment.content}`} onChange={(event) => setResolutionReasons((current) => ({ ...current, [comment.comment_uuid]: event.target.value }))} value={resolutionReasons[comment.comment_uuid] ?? ''} />
                        </label>
                        <button className="professional-quiet-button" onClick={() => void resolveComment(comment)} type="button">解决评论</button>
                      </div>
                    ) : null}
                  </article>
                )) : <p className="professional-empty">当前版本暂无评论。</p>}
                {hasAction('request_changes') ? (
                  <div className="professional-decision-form">
                    <label>
                      <span>退回原因</span>
                      <textarea aria-label="退回原因" onChange={(event) => setChangeReason(event.target.value)} value={changeReason} />
                    </label>
                    <small>必须填写原因，并关联至少一条针对当前版本的评论。</small>
                    <button className="professional-secondary-button" disabled={!changeReason.trim() || selectedCommentIds.length === 0 || busyAction === 'request-changes'} onClick={() => void requestChanges()} type="button">退回修改</button>
                  </div>
                ) : null}
              </>
            ) : null}
            {rightPanel === 'versions' ? (
              <>
                {versions.length ? versions.map((version) => (
                  <article className="professional-version-row" key={version.version_uuid}>
                    <span>V{version.version_no}</span>
                    <div>
                      <strong>{version.change_summary}</strong>
                      <small>{new Date(version.created_at).toLocaleString('zh-CN')}</small>
                      {!version.is_current && detail ? (
                        <button className="professional-version-link" disabled={busyAction === `diff:${version.version_uuid}`} onClick={() => void compareVersion(version)} type="button">比较 V{version.version_no} 与当前版本</button>
                      ) : null}
                    </div>
                    {version.is_current || version.version_uuid === detail?.current_version.version_uuid ? <em>当前</em> : null}
                  </article>
                )) : <p className="professional-empty">暂无版本记录。</p>}
                {versionDiff ? (
                  <section className="professional-diff-panel">
                    <h3>V{versionDiff.from_version_no} → V{versionDiff.to_version_no}</h3>
                    <div className="professional-diff-summary">
                      <span>新增 {versionDiff.summary.added_blocks} 个区块</span>
                      <span>删除 {versionDiff.summary.removed_blocks} 个区块</span>
                      <span>修改 {versionDiff.summary.modified_blocks} 个区块</span>
                    </div>
                    {versionDiff.changes.map((change) => (
                      <article key={`${change.block_id}:${change.change_type}`}>
                        <strong>{change.block_id} · {change.change_type}</strong>
                        {change.field_changes.map((field) => <p key={field.path}>{field.path}：{displayValue(field.before)} → {displayValue(field.after)}</p>)}
                      </article>
                    ))}
                  </section>
                ) : null}
              </>
            ) : null}
            {rightPanel === 'activity' ? (
              <>
                {detail?.source_change_notice ? (
                  <div className="professional-alert" role="status">
                    <strong>{detail.source_change_notice.message}</strong>
                    <p>
                      {detail.source_change_notice.affected_evidence_count} 条证据来源已失效；
                      {detail.source_change_notice.historical_snapshot_preserved
                        ? '已交付版本正文和交付记录保持不变。'
                        : '当前版本已退回重新审阅。'}
                    </p>
                  </div>
                ) : null}
                <div className="professional-activity-list">
                  <p><span>当前状态</span><strong>{detail ? statusLabels[detail.lifecycle_status] ?? detail.lifecycle_status : '—'}</strong></p>
                  <p><span>最近更新</span><strong>{detail ? new Date(detail.updated_at).toLocaleString('zh-CN') : '—'}</strong></p>
                  <p><span>Skill 版本</span><strong>{detail?.current_version.skill_version_uuid ?? '—'}</strong></p>
                  <p><span>模板版本</span><strong>{detail?.current_version.template_version_uuid ?? '—'}</strong></p>
                  <p><span>版本原则</span><strong>只增不改</strong></p>
                </div>
                {hasAction('update_metadata') ? (
                  <div className="professional-decision-form">
                    <strong>成果元数据</strong>
                    <label>
                      <span>成果标题</span>
                      <input aria-label="成果标题" onChange={(event) => setTitleDraft(event.target.value)} value={titleDraft} />
                    </label>
                    <small>只更新成果标题；历史版本中的标题快照不会改变。</small>
                    <button className="professional-secondary-button" disabled={!titleDraft.trim() || titleDraft.trim() === detail?.title || busyAction === 'metadata'} onClick={() => void saveMetadata()} type="button">保存标题</button>
                  </div>
                ) : null}
                {hasAction('submit_experience') ? (
                  <div className="professional-decision-form">
                    <strong>沉淀为经验候选</strong>
                    <label>
                      <span>经验类型</span>
                      <select aria-label="经验类型" onChange={(event) => setExperienceType(event.target.value as typeof experienceType)} value={experienceType}>
                        <option value="structure">结构</option>
                        <option value="rule">规则</option>
                        <option value="template">模板</option>
                      </select>
                    </label>
                    <label>
                      <span>脱敏经验摘要</span>
                      <textarea aria-label="脱敏经验摘要" onChange={(event) => setExperienceSummary(event.target.value)} value={experienceSummary} />
                    </label>
                    <small>仅提交脱敏候选，需人工审核；不会自动跨项目复用正文、客户数据或证据。</small>
                    <button className="professional-primary-button" disabled={!experienceSummary.trim() || busyAction === 'experience-candidate'} onClick={() => void submitExperienceCandidate()} type="button">提交经验候选</button>
                    {experienceCandidate ? <p>候选 {experienceCandidate.candidate_uuid} · 待人工审核</p> : null}
                  </div>
                ) : null}
                {hasAction('deliver') ? (
                  <div className="professional-decision-form">
                    <strong>正式交付</strong>
                    <p>{exportRecord ? `已锁定导出：${exportRecord.file_name}` : '请先导出当前已批准版本。'}</p>
                    <label><span>接收方</span><input aria-label="交付接收方" onChange={(event) => setRecipient(event.target.value)} value={recipient} /></label>
                    <label><span>交付说明</span><textarea aria-label="交付说明" onChange={(event) => setDeliveryNote(event.target.value)} value={deliveryNote} /></label>
                    <button className="professional-primary-button" disabled={!exportRecord || !recipient.trim() || busyAction === 'deliver'} onClick={() => void deliverCurrentVersion()} type="button">确认交付</button>
                  </div>
                ) : null}
                {hasAction('archive') ? (
                  <button className="professional-secondary-button professional-panel-action" disabled={!deliveryRecord || busyAction === 'archive'} onClick={() => void archiveDelivery()} type="button">归档交付成果</button>
                ) : null}
              </>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

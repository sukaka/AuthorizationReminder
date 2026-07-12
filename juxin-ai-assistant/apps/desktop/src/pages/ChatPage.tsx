import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';

import {
  archiveChatSession,
  bulkArchiveChatSessions,
  bulkDeleteChatSessions,
  cancelLongTask,
  completeChatMessage,
  confirmWebCapture,
  createLongChatTask,
  deleteChatSession,
  exportChatWord,
  getChatSession,
  getChatSessionsByKind,
  hardDeleteChatSession,
  listKnowledgeFiles,
  listKnowledgeCategories,
  listKnowledgeDocumentTypes,
  listLongTasks,
  listUserModelProfiles,
  prepareChat,
  previewWebCapture,
  previewKnowledgeFile,
  renameChatSession,
  retryLongTask,
  restoreChatSession,
  streamChatMessage,
  type ChatCitation,
  type ChatExportType,
  type ChatMode,
  type ChatSessionListKind,
  type ChatSessionPayload,
  type ChatTaskStatePayload,
  type KnowledgeCategoryPayload,
  type KnowledgeDocumentTypePayload,
  type KnowledgeFilePayload,
  type KnowledgeFilePreviewPayload,
  type LongTaskPayload,
  type WebCapturePreviewPayload,
  uploadKnowledgeFile,
} from '../api/chat';
import {
  checkLoopQuality,
  shouldRunLoopQualityCheck,
  type AgentLoopMessage,
} from '../api/agentLoop';
import {
  ApiError,
  createLearningExperience,
  createLearningFailureCase,
  createLearningFeedback,
  createLearningMemory,
  createLearningTemplate,
  saveChatMessageWorkArtifact,
} from '../api/client';
import { TaskProgressTimeline } from '../components/TaskProgressTimeline';
import {
  SensitiveWarningDialog,
  type SensitiveFinding,
} from '../components/SensitiveWarningDialog';
import { cancelModelGeneration, generateLocalModel, listModelProfiles } from '../local/modelStream';
import { isDesktopRuntime } from '../runtime/capabilities';
import { openLocalWordFile } from '../runtime/downloads';
import type { ModelProfile } from '../types/tauri';

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitation[];
  isComplete?: boolean;
};

type GeneratedModelResult = Awaited<ReturnType<typeof generateLocalModel>>;

const longTaskStatusLabels: Record<LongTaskPayload['status'], string> = {
  queued: '等待处理',
  running: '正在处理',
  waiting_user: '等待补充资料',
  completed: '已完成',
  failed: '处理失败',
  cancelled: '已取消',
  retrying: '正在重新处理',
};

type SourcePreviewState =
  | { status: 'idle' }
  | { status: 'loading'; citation: ChatCitation }
  | { status: 'ready'; citation: ChatCitation; preview: KnowledgeFilePreviewPayload }
  | { status: 'error'; citation: ChatCitation; message: string };

function isReferencedPreviewChunk(
  citation: ChatCitation,
  chunk: KnowledgeFilePreviewPayload['chunks'][number],
  index: number,
): boolean {
  if (citation.chunk_id) return citation.chunk_id === chunk.chunk_id;
  if (citation.chunk_index !== null && citation.chunk_index !== undefined) return citation.chunk_index === chunk.chunk_index;
  if (citation.page_number !== null && citation.page_number !== undefined) return citation.page_number === chunk.page_number;
  if (citation.section_title) return citation.section_title === chunk.section_title;
  return index === 0;
}

type WordExportNotice =
  | { kind: 'success'; path?: string; fileName?: string; copyStatus?: string; openStatus?: string }
  | { kind: 'error' };

type WebCaptureState =
  | { status: 'idle' }
  | { status: 'previewing'; url: string }
  | { status: 'ready'; preview: WebCapturePreviewPayload; actionStatus?: string }
  | { status: 'saving'; preview: WebCapturePreviewPayload; action: 'temporary' | 'personal_reference' | 'official_knowledge_candidate' | 'cancel' }
  | { status: 'error'; url: string; message: string };

type UploadPurpose = 'session_attachment' | 'personal_reference' | 'submit_review';
type ReferenceScope = 'official_only' | 'with_personal' | 'with_session' | 'personal_and_session';
type EnabledReferenceFile = {
  fileUuid: string;
  fileName: string;
  sourceKind: 'personal_reference' | 'session_attachment';
};
type ReferenceFilePickerStatus = 'idle' | 'loading' | 'ready' | 'error';

type TaskProgressView = ChatTaskStatePayload & {
  label: string;
  next_action: string;
};

type GenerationStatus = 'idle' | 'running' | 'stopping';

type ActiveGeneration = {
  abortController?: AbortController;
  localRequestId?: string;
  sessionUuid: string;
  stopped: boolean;
};

type GenerationMetrics = {
  latencyMs?: number | null;
  usage?: Record<string, unknown> | null;
};

type MemorySuggestion = {
  memoryType: string;
  title: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
};

const modeLabels: Record<ChatMode, string> = {
  normal: '普通助手',
  sales: '销售助手',
  business: '商务助手',
  hr_admin: '行政人力助手',
  presales: '售前助手',
  delivery: '交付助手',
  software_test: '软测助手',
  pentest: '渗透测试助手',
  security_ops: '安全运维助手',
  risk_assessment: '风险评估助手',
  incident_response: '应急响应助手',
  knowledge: '查公司知识',
};

const wordExportTypes = ['single_answer', 'formal_document'] as const satisfies readonly ChatExportType[];
const supportedKnowledgeAccept = '.pdf,.txt,.md,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation';
const unsupportedKnowledgeTypeMessage = '当前版本暂不支持该文件类型，请上传 pdf、docx、xlsx、pptx、txt 或 md 文件。';
const pdfUploadHint = 'PDF 会按页面提取可复制文本，扫描件需要先转成可复制文本。';
const fallbackUploadCategories = ['个人素材', '会议纪要', '项目交付', '销售商务', '安全运维', '模板范本', '其他'];
const fallbackUploadDocumentTypes = ['会议纪要', '解决方案', '投标模板', '管理员手册', '培训材料', '验收报告', '检查记录', '其他'];

const exportTypeLabels: Record<(typeof wordExportTypes)[number], string> = {
  single_answer: '仅导出本次生成内容',
  formal_document: '导出聚信格式 Word',
};

const webUrlPattern = /https?:\/\/[^\s<>'"，。；;、）)】]+/i;

const fallbackTaskProgress: TaskProgressView = {
  task_state_id: '',
  conversation_id: '',
  stage: '',
  status: '',
  label: '',
  goal: '',
  selected_sources: [],
  tool_calls: [],
  verification_status: '',
  next_action: '',
  retry_allowed: false,
  failure_reason: '',
  stage_history: [],
};

function extractFirstWebUrl(value: string): string {
  return webUrlPattern.exec(value)?.[0] || '';
}

function taskProgressWithStage(
  progress: ChatTaskStatePayload | undefined,
  stage: string,
  label: string,
  nextAction: string,
): TaskProgressView {
  const base = progress || fallbackTaskProgress;
  const stageHistory = base.stage_history?.length
    ? base.stage_history
    : [];
  const hasStage = stageHistory.some((item) => item.stage === stage);
  return {
    ...base,
    stage,
    label,
    next_action: nextAction,
    stage_history: hasStage
      ? stageHistory
      : stageHistory.concat({ stage, label, next_action: nextAction }),
  };
}

const sensitiveMemoryPattern = /(密码|口令|验证码|api\s*key|apikey|token|secret|密钥|身份证|银行卡)/i;

export function detectMemorySuggestion(value: string): MemorySuggestion | null {
  const content = value.trim();
  if (!content || sensitiveMemoryPattern.test(content)) return null;
  if (/不要再这样|不要再这么|禁用表达|以后不要/.test(content)) {
    return {
      memoryType: 'forbidden_style',
      title: '禁用表达或错误做法',
      content,
      priority: 'high',
      tags: ['禁用表达', '用户纠正'],
    };
  }
  if (/不对[，,。；;\s]*应该|应该是|正确的是/.test(content)) {
    return {
      memoryType: 'correction',
      title: '用户纠错',
      content,
      priority: 'high',
      tags: ['纠错', '高优先级'],
    };
  }
  if (/保存为模板/.test(content)) {
    return {
      memoryType: 'template',
      title: '模板沉淀规则',
      content,
      priority: 'medium',
      tags: ['模板'],
    };
  }
  if (/保存为经验/.test(content)) {
    return {
      memoryType: 'experience',
      title: '经验沉淀规则',
      content,
      priority: 'medium',
      tags: ['经验'],
    };
  }
  if (/以后都这样|记住|下次按照这个|这个是对的/.test(content)) {
    return {
      memoryType: 'user_preference',
      title: '用户偏好',
      content,
      priority: 'medium',
      tags: ['偏好'],
    };
  }
  return null;
}

function uploadFileHint(file: File | null): string {
  if (!file) return '';
  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex + 1).trim().toLowerCase() : '';
  if (extension === 'pdf') return pdfUploadHint;
  if (extension === 'csv' || extension === 'doc' || extension === 'xls') {
    return unsupportedKnowledgeTypeMessage;
  }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return '图片会保存到资料库，并自动参与后续检索和图片引用。';
  if (extension === 'xlsx') return 'Excel 会按 Sheet、表头和行记录解析。';
  if (extension === 'pptx') return 'PPT 会按幻灯片标题、正文和备注解析。';
  return '当前支持 pdf、docx、xlsx、pptx、txt、md、png、jpg、jpeg、webp。';
}

function uploadFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
      ? String((error.payload as { detail?: unknown }).detail || '').trim()
      : '';
    if (detail) return detail;
  }
  return '资料上传失败，请稍后重试';
}

const sessionListLabels: Record<ChatSessionListKind, string> = {
  active: '正常历史',
  archived: '归档任务',
  trash: '回收站',
};

const referenceScopeLabels: Record<ReferenceScope, string> = {
  official_only: '只查公司知识',
  with_personal: '公司知识库 + 我的资料',
  with_session: '公司知识库 + 当前附件',
  personal_and_session: '公司知识库 + 我的资料和当前附件',
};

const formalDocumentPrompt = `你是聚信得仁内部文档助手。
请将以下聊天内容整理为正式 Word 文档内容。
要求：
1. 使用正式书面语。
2. 保留原始核心内容。
3. 删除聊天口吻。
4. 不要编造原文没有的信息。
5. 按正式文档结构组织，包括标题、背景、内容、实施步骤、交付成果、注意事项等。
6. 适合导出为 Word。
7. 如果内容涉及网络安全、等保、交付、安全运维、风险评估、应急响应，要使用聚信得仁公司内部文档风格。`;

function normalizeMode(value: string): ChatMode {
  const normalized = value.toLowerCase();
  return normalized in modeLabels ? normalized as ChatMode : 'normal';
}

function normalizeSessionStatus(value: string): 'active' | 'archived' | 'deleted' {
  const normalized = value.toLowerCase();
  if (normalized === 'archived' || normalized === 'deleted') return normalized;
  return 'active';
}

type CitationFileReference = {
  key: string;
  label: string;
  citation: ChatCitation;
  locations: string[];
  sourceLabel: string;
  sourceClassName: string;
};

type RenderableSourceReference = Pick<CitationFileReference, 'label' | 'locations' | 'sourceLabel' | 'sourceClassName'>;

type SourceAttributionLine = {
  fileName: string;
  location: string;
};

function citationFileName(citation: ChatCitation): string {
  return citation.file_name?.trim() || '知识来源';
}

function citationFileKey(citation: ChatCitation): string {
  return citation.file_uuid || citation.file_name || citation.chunk_id || citationFileName(citation);
}

function citationSourceLabel(sourceType?: string): string {
  switch (sourceType) {
    case 'official_knowledge':
      return '公司知识库';
    case 'official_knowledge_candidate':
      return '待审核资料';
    case 'personal_reference':
      return '我的资料';
    case 'session_attachment':
    case 'current_attachment':
      return '当前附件';
    case 'current_web_capture':
      return '网页采集';
    case 'web_search_context':
      return '联网搜索';
    default:
      return '知识来源';
  }
}

function citationSourceClassName(sourceType?: string): string {
  switch (sourceType) {
    case 'official_knowledge':
      return 'official';
    case 'official_knowledge_candidate':
      return 'candidate';
    case 'personal_reference':
      return 'personal';
    case 'session_attachment':
    case 'current_attachment':
      return 'attachment';
    case 'current_web_capture':
      return 'web-capture';
    case 'web_search_context':
      return 'web-search';
    default:
      return 'generic';
  }
}

function citationLocationLabel(citation: ChatCitation): string {
  const pageLabel = citation.page_number ? `第 ${citation.page_number} 页` : '';
  const pageOrSheet = citation.page_or_sheet?.trim() || '';
  return [
    pageOrSheet,
    citation.section_title?.trim() || '',
    pageOrSheet === pageLabel ? '' : pageLabel,
  ].filter(Boolean).join(' · ');
}

function citationFileReferences(citations: ChatCitation[]): CitationFileReference[] {
  const referenceByKey = new Map<string, CitationFileReference>();
  const references: CitationFileReference[] = [];
  citations.forEach((citation, index) => {
    const key = citationFileKey(citation);
    const location = citationLocationLabel(citation);
    const reference = referenceByKey.get(key);
    if (reference) {
      if (location && !reference.locations.includes(location)) {
        reference.locations.push(location);
      }
      return;
    }
    const nextReference = {
      key: `${key}-${index}`,
      label: citationFileName(citation),
      citation,
      locations: location ? [location] : [],
      sourceLabel: citationSourceLabel(citation.source_type),
      sourceClassName: citationSourceClassName(citation.source_type),
    };
    referenceByKey.set(key, nextReference);
    references.push(nextReference);
  });
  return references;
}

function normalizeCitationMatchText(value?: string | null): string {
  return (value || '').toLowerCase().replace(/\s+/g, '');
}

function stripKnownFileExtension(value: string): string {
  const extensions = ['.docx', '.xlsx', '.pptx', '.pdf', '.txt', '.md', '.doc', '.xls', '.ppt'];
  const extension = extensions.find((item) => value.endsWith(item));
  return extension ? value.slice(0, -extension.length) : value;
}

function hasKnownFileExtension(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ['.docx', '.xlsx', '.pptx', '.pdf', '.txt', '.md', '.doc', '.xls', '.ppt']
    .some((extension) => normalized.endsWith(extension));
}

function citationMatchCandidates(value?: string | null): string[] {
  const normalized = normalizeCitationMatchText(value);
  if (!normalized) return [];
  const candidates = [normalized];
  const stem = stripKnownFileExtension(normalized);
  if (stem !== normalized) candidates.push(stem);
  const withoutSequence = stripLeadingFileSequence(normalized);
  if (withoutSequence !== normalized) {
    candidates.push(withoutSequence);
    const withoutSequenceStem = stripKnownFileExtension(withoutSequence);
    if (withoutSequenceStem !== withoutSequence) candidates.push(withoutSequenceStem);
  }
  return Array.from(new Set(candidates)).filter((candidate) => candidate.length >= 4);
}

function stripLeadingFileSequence(value: string): string {
  return value.replace(/^\d+[-_、.．]+/, '');
}

function filterCitationsByAnswer(citations: ChatCitation[], answer: string): ChatCitation[] {
  const normalizedAnswer = normalizeCitationMatchText(answer);
  if (!normalizedAnswer) return [];
  return citations.filter((citation) => {
    if (citation.media_type?.startsWith('image/') && citation.asset_url) return true;
    if (citation.source_type === 'web_search_context') return true;
    return [
      ...citationMatchCandidates(citation.file_name),
      ...citationMatchCandidates(citation.section_title),
    ].some((candidate) => normalizedAnswer.includes(candidate));
  });
}

function inlineCitationReference(
  label: string,
  citationReferences: CitationFileReference[],
): CitationFileReference | null {
  const labelCandidates = citationMatchCandidates(label);
  if (!labelCandidates.length) return null;
  return citationReferences.find((reference) => {
    const referenceCandidates = citationMatchCandidates(reference.label);
    return referenceCandidates.some((referenceCandidate) => (
      labelCandidates.some((labelCandidate) => (
        labelCandidate === referenceCandidate
        || labelCandidate.includes(referenceCandidate)
        || referenceCandidate.includes(labelCandidate)
      ))
    ));
  }) || null;
}

function fallbackSourceReference(label: string, location = ''): RenderableSourceReference | null {
  if (!hasKnownFileExtension(label)) return null;
  return {
    label,
    locations: location ? [location] : [],
    sourceLabel: '来源',
    sourceClassName: 'generic',
  };
}

function parseSourceAttributionLine(line: string): SourceAttributionLine | null {
  const withoutQuoteMarker = line.trim().replace(/^>\s*/, '').trim();
  const match = /^[—\-–－]+\s*《([^《》]+)》\s*(?:[“"]([^”"]+)[”"])?\s*$/.exec(withoutQuoteMarker);
  if (!match) return null;
  return {
    fileName: match[1].trim(),
    location: match[2]?.trim() || '',
  };
}

function renderInlineSourceReference(reference: RenderableSourceReference, key: string): ReactNode {
  return (
    <span
      aria-label={`来源：${reference.label}`}
      className="chat-inline-source"
      key={key}
      title={reference.label}
    >
      <span className={`chat-citation-source ${reference.sourceClassName}`} aria-hidden="true">
        {reference.sourceLabel.slice(0, 1)}
      </span>
      <span>{reference.sourceLabel}</span>
      {reference.locations.length > 1 ? (
        <span className="chat-citation-count">+{reference.locations.length}</span>
      ) : null}
    </span>
  );
}

function renderSourceAttributionLine(
  attribution: SourceAttributionLine,
  citationReferences: CitationFileReference[],
  key: string,
): ReactNode {
  const reference = inlineCitationReference(attribution.fileName, citationReferences)
    || fallbackSourceReference(attribution.fileName, attribution.location);
  if (!reference) {
    return <p key={key}>{renderInlineMarkdown(`—— 《${attribution.fileName}》 ${attribution.location}`, citationReferences, key)}</p>;
  }
  return (
    <p className="chat-source-attribution" key={key}>
      {renderInlineSourceReference(reference, `${key}-source`)}
      {attribution.location ? (
        <span className="chat-source-attribution-location">{attribution.location}</span>
      ) : null}
    </p>
  );
}

function renderInlineSourceReferences(
  text: string,
  citationReferences: CitationFileReference[],
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /《([^《》]+)》/g;
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const reference = inlineCitationReference(match[1], citationReferences)
      || fallbackSourceReference(match[1]);
    nodes.push(reference
      ? renderInlineSourceReference(reference, `${keyPrefix}-source-${match.index}`)
      : match[0]);
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.length ? nodes : [text];
}

function chunkReferenceTitle(chunk: KnowledgeFilePreviewPayload['chunks'][number]): string {
  const pageLabel = chunk.page_number ? `第 ${chunk.page_number} 页` : '';
  const pageOrSheet = chunk.page_or_sheet?.trim() || '';
  const location = [
    pageOrSheet,
    chunk.section_title?.trim() || '',
    pageOrSheet === pageLabel ? '' : pageLabel,
  ].filter(Boolean);
  return location.length ? location.join(' · ') : '引用片段';
}

function modelErrorMessage(raw: string): string {
  if (raw.includes('MODEL_TIMEOUT')) {
    return '长文档生成时间较长，当前模型连接已超时；已保留已生成内容。可以重新发送“从这里继续”，或在设置里把生成超时时间调高后重试。';
  }
  if (raw.includes('MODEL_OUTPUT_TRUNCATED')) {
    return '模型连续达到输出长度上限，已保留已生成内容；请提高最大输出长度或缩短输入后重试。';
  }
  return '';
}

function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    const payload = error.payload as { detail?: unknown } | undefined;
    if (typeof payload?.detail === 'string') return modelErrorMessage(payload.detail) || payload.detail;
    return modelErrorMessage(error.message);
  }
  if (error instanceof Error) return modelErrorMessage(error.message);
  if (typeof error === 'string') return modelErrorMessage(error);
  return '';
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function usageNumber(usage: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!usage) return null;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatLatency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function formatTokenCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString()
    : '—';
}

function referenceScopeIncludes(scope: ReferenceScope, sourceKind: EnabledReferenceFile['sourceKind']): boolean {
  if (sourceKind === 'personal_reference') {
    return scope === 'with_personal' || scope === 'personal_and_session';
  }
  return scope === 'with_session' || scope === 'personal_and_session';
}

function attachmentFileTypeLabel(fileName: string): string {
  const extension = fileName.split('.').pop()?.trim().toUpperCase() || 'FILE';
  if (['DOCX', 'PDF', 'XLSX', 'PPTX', 'TXT', 'MD'].includes(extension)) return extension;
  return extension.slice(0, 5);
}

function isReadyPersonalReference(file: KnowledgeFilePayload): boolean {
  return file.usage_type === 'personal_reference'
    && file.reference_enabled !== false
    && file.status === 'READY'
    && (file.parse_status ?? 'parsed') === 'parsed'
    && (file.index_status ?? 'indexed') === 'indexed';
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop()?.trim() || 'Word 文档';
}

function artifactTitleFromMessage(content: string): string {
  return content
    .replace(/[#*_>`~-]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 80) || '聊天回答';
}

function safeSessionDisplayTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '未命名任务';
  if (
    /^Word\s*(已保存到|已导出|导出失败)/i.test(trimmed) ||
    /^\/Users\//.test(trimmed) ||
    /^[A-Za-z]:\\/.test(trimmed)
  ) {
    return '未命名任务';
  }
  return trimmed;
}

function disableReferenceKind(
  scope: ReferenceScope,
  sourceKind: EnabledReferenceFile['sourceKind'],
): ReferenceScope {
  if (sourceKind === 'personal_reference') {
    return scope === 'personal_and_session'
      ? 'with_session'
      : scope === 'with_personal'
        ? 'official_only'
        : scope;
  }
  return scope === 'personal_and_session'
    ? 'with_personal'
    : scope === 'with_session'
      ? 'official_only'
      : scope;
}

function renderInlineMarkdown(
  text: string,
  citationReferences: CitationFileReference[] = [],
  keyPrefix = 'inline',
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > lastIndex) {
      nodes.push(...renderInlineSourceReferences(
        text.slice(lastIndex, match.index),
        citationReferences,
        `${keyPrefix}-text-${lastIndex}`,
      ));
    }
    nodes.push(
      <strong key={`${keyPrefix}-bold-${match.index}`}>
        {renderInlineSourceReferences(match[1], citationReferences, `${keyPrefix}-bold-${match.index}`)}
      </strong>,
    );
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) {
    nodes.push(...renderInlineSourceReferences(
      text.slice(lastIndex),
      citationReferences,
      `${keyPrefix}-text-${lastIndex}`,
    ));
  }
  return nodes.length ? nodes : [text];
}

function renderChatContent(
  content: string,
  citationReferences: CitationFileReference[] = [],
): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (!listType || !listItems.length) return;
    const renderedItems = listItems.map((item, itemIndex) => (
      <li key={`${listType}-${blocks.length}-${itemIndex}`}>
        {renderInlineMarkdown(item, citationReferences, `${listType}-${blocks.length}-${itemIndex}`)}
      </li>
    ));
    blocks.push(listType === 'ol'
      ? <ol key={`ol-${blocks.length}`}>{renderedItems}</ol>
      : <ul key={`ul-${blocks.length}`}>{renderedItems}</ul>);
    listType = null;
    listItems = [];
  };

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '>') {
      flushList();
      return;
    }

    const sourceAttribution = parseSourceAttributionLine(trimmed);
    if (sourceAttribution) {
      flushList();
      blocks.push(renderSourceAttributionLine(
        sourceAttribution,
        citationReferences,
        `source-attribution-${blocks.length}`,
      ));
      return;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const headingContent = renderInlineMarkdown(heading[2], citationReferences, `h-${blocks.length}`);
      if (heading[1].length === 1) blocks.push(<h1 key={`h1-${blocks.length}`}>{headingContent}</h1>);
      else if (heading[1].length === 2) blocks.push(<h2 key={`h2-${blocks.length}`}>{headingContent}</h2>);
      else blocks.push(<h3 key={`h3-${blocks.length}`}>{headingContent}</h3>);
      return;
    }

    const ordered = /^\d+[.)、]\s+(.+)$/.exec(trimmed);
    if (ordered) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(ordered[1]);
      return;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(unordered[1]);
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`}>
        {renderInlineMarkdown(trimmed, citationReferences, `p-${blocks.length}`)}
      </p>,
    );
  });

  flushList();
  return blocks.length ? blocks : [<p key="empty">正在生成…</p>];
}

export function ChatPage() {
  const [sessions, setSessions] = useState<ChatSessionPayload[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [mode, setMode] = useState<ChatMode>('normal');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [activeSessionUuid, setActiveSessionUuid] = useState('');
  const [activeSessionStatus, setActiveSessionStatus] = useState<'active' | 'archived' | 'deleted' | ''>('');
  const [sessionListKind, setSessionListKind] = useState<ChatSessionListKind>('active');
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [uploadPurpose, setUploadPurpose] = useState<UploadPurpose>('personal_reference');
  const [uploadCategory, setUploadCategory] = useState('个人素材');
  const [uploadDocumentType, setUploadDocumentType] = useState('其他');
  const [knowledgeCategories, setKnowledgeCategories] = useState<KnowledgeCategoryPayload[]>([]);
  const [knowledgeDocumentTypes, setKnowledgeDocumentTypes] = useState<KnowledgeDocumentTypePayload[]>([]);
  const [referenceScope, setReferenceScope] = useState<ReferenceScope>('personal_and_session');
  const [enabledReferenceFiles, setEnabledReferenceFiles] = useState<EnabledReferenceFile[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referencePickerStatus, setReferencePickerStatus] = useState<ReferenceFilePickerStatus>('idle');
  const [personalReferenceFiles, setPersonalReferenceFiles] = useState<KnowledgeFilePayload[]>([]);
  const [selectedPersonalReferenceIds, setSelectedPersonalReferenceIds] = useState<string[]>([]);
  const [exportType, setExportType] = useState<ChatExportType>('single_answer');
  const [exportNotice, setExportNotice] = useState<WordExportNotice | null>(null);
  const [exportingWord, setExportingWord] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewState>({ status: 'idle' });
  const [webCapture, setWebCapture] = useState<WebCaptureState>({ status: 'idle' });
  const [memorySuggestion, setMemorySuggestion] = useState<MemorySuggestion | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressView | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [generationMetrics, setGenerationMetrics] = useState<GenerationMetrics | null>(null);
  const [webModelLabel, setWebModelLabel] = useState('服务端模型');
  const [backgroundMode, setBackgroundMode] = useState(false);
  const [longTasks, setLongTasks] = useState<LongTaskPayload[]>([]);
  const [sensitiveConfirmation, setSensitiveConfirmation] = useState<{
    question: string;
    digest: string;
    findings: SensitiveFinding[];
  } | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const sourceHighlightRef = useRef<HTMLElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const activeGenerationsRef = useRef<Map<string, ActiveGeneration>>(new Map());
  const activeGenerationKeyRef = useRef('');
  const activeSessionUuidRef = useRef('');

  useEffect(() => {
    activeSessionUuidRef.current = activeSessionUuid;
  }, [activeSessionUuid]);

  const refreshSessions = async (kind: ChatSessionListKind = sessionListKind) => {
    const payload = await getChatSessionsByKind(kind);
    setSessions(payload.items);
    const visibleIds = new Set(payload.items.map((item) => item.session_uuid));
    setSelectedSessionIds((current) => current.filter((id) => visibleIds.has(id)));
  };

  const shouldUseServerModel = !isDesktopRuntime();

  const refreshLongTasks = async () => {
    const payload = await listLongTasks();
    setLongTasks(payload.items);
  };

  const replaceLongTask = (task: LongTaskPayload) => {
    setLongTasks((current) => [
      task,
      ...current.filter((item) => item.task_id !== task.task_id),
    ]);
  };

  const cancelBackgroundTask = async (taskId: string) => {
    try {
      replaceLongTask(await cancelLongTask(taskId));
    } catch {
      setStatus('取消任务失败，请稍后重试');
    }
  };

  const retryBackgroundTask = async (taskId: string) => {
    try {
      replaceLongTask(await retryLongTask(taskId));
    } catch {
      setStatus('重新处理失败，请稍后重试');
    }
  };

  const stopActiveGeneration = async () => {
    const activeGeneration = activeGenerationsRef.current.get(activeGenerationKeyRef.current);
    if (!activeGeneration || generationStatus !== 'running') return;
    activeGeneration.stopped = true;
    setGenerationStatus('stopping');
    setStatus('正在停止生成…');
    activeGeneration.abortController?.abort();
    if (activeGeneration.localRequestId) {
      try {
        await cancelModelGeneration(activeGeneration.localRequestId);
      } catch {
        // 停止是用户主动操作，底层模型已结束时无需再打扰用户。
      }
    }
  };

  useEffect(() => {
    setSelectedSessionIds([]);
    refreshSessions(sessionListKind)
      .catch(() => setStatus('聊天历史加载失败'));
    if (shouldUseServerModel) {
      listUserModelProfiles()
        .then((payload) => {
          const activeWebProfile = payload.items.find((profile) => profile.is_default && profile.has_api_key)
            ?? payload.items.find((profile) => profile.has_api_key);
          setWebModelLabel(activeWebProfile?.display_name || '服务端模型');
        })
        .catch(() => setWebModelLabel('服务端模型'));
    } else {
      listModelProfiles()
        .then((payload) => setProfiles(Array.isArray(payload) ? payload : []))
        .catch(() => setProfiles([]));
    }
  }, [sessionListKind, shouldUseServerModel]);

  useEffect(() => {
    if (!shouldUseServerModel) return undefined;
    let active = true;
    listLongTasks()
      .then((payload) => {
        if (active) setLongTasks(payload.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [shouldUseServerModel]);

  useEffect(() => {
    if (!shouldUseServerModel || !longTasks.some((task) => task.cancel_allowed)) return undefined;
    const timer = window.setInterval(() => {
      refreshLongTasks().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [longTasks, shouldUseServerModel]);

  useEffect(() => {
    let active = true;
    listKnowledgeCategories(false)
      .then((payload) => {
        if (!active) return;
        const activeCategories = payload.items.filter((category) => category.status === 'ACTIVE');
        setKnowledgeCategories(activeCategories);
        setUploadCategory((current) => (
          current && activeCategories.some((category) => category.name === current)
            ? current
            : activeCategories[0]?.name || '个人素材'
        ));
      })
      .catch(() => {
        if (!active) return;
        setKnowledgeCategories([]);
      });
    listKnowledgeDocumentTypes(false)
      .then((payload) => {
        if (!active) return;
        const activeDocumentTypes = payload.items.filter((documentType) => documentType.status === 'ACTIVE');
        setKnowledgeDocumentTypes(activeDocumentTypes);
        setUploadDocumentType((current) => (
          current && activeDocumentTypes.some((documentType) => documentType.name === current)
            ? current
            : activeDocumentTypes[0]?.name || '其他'
        ));
      })
      .catch(() => {
        if (!active) return;
        setKnowledgeDocumentTypes([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (generationStatus !== 'running') return undefined;
    const handleEscapeStop = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void stopActiveGeneration();
    };
    window.addEventListener('keydown', handleEscapeStop);
    return () => window.removeEventListener('keydown', handleEscapeStop);
  }, [generationStatus]);

  useEffect(() => {
    if (sourcePreview.status === 'idle') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSourcePreview({ status: 'idle' });
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [sourcePreview.status]);

  useEffect(() => {
    if (sourcePreview.status !== 'ready') return;
    window.requestAnimationFrame(() => sourceHighlightRef.current?.scrollIntoView({ block: 'center' }));
  }, [sourcePreview]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.isDefault && profile.hasApiKey)
      ?? profiles.find((profile) => profile.hasApiKey),
    [profiles],
  );
  const currentModelLabel = shouldUseServerModel ? webModelLabel : (activeProfile?.displayName || '未配置');
  const generationActive = generationStatus === 'running' || generationStatus === 'stopping';
  const generationMetricRows = useMemo(() => {
    if (!generationMetrics) return [];
    const inputTokens = usageNumber(generationMetrics.usage, ['prompt_tokens', 'input_tokens']);
    const outputTokens = usageNumber(generationMetrics.usage, ['completion_tokens', 'output_tokens']);
    const totalTokens = usageNumber(generationMetrics.usage, ['total_tokens']);
    return [
      { label: '完成耗时', value: formatLatency(generationMetrics.latencyMs) },
      { label: '总 token', value: formatTokenCount(totalTokens ?? (
        inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
      )) },
    ];
  }, [generationMetrics]);
  const sessionAttachmentFiles = useMemo(
    () => enabledReferenceFiles.filter((file) => file.sourceKind === 'session_attachment'),
    [enabledReferenceFiles],
  );
  const selectedPersonalReferenceFiles = useMemo(
    () => selectedPersonalReferenceIds
      .map((fileId) => personalReferenceFiles.find((file) => file.file_uuid === fileId))
      .filter((file): file is KnowledgeFilePayload => Boolean(file)),
    [personalReferenceFiles, selectedPersonalReferenceIds],
  );
  const uploadCategoryOptions = useMemo(() => {
    const names = knowledgeCategories.map((category) => category.name);
    return Array.from(new Set([uploadCategory, ...names, ...fallbackUploadCategories].filter(Boolean)));
  }, [knowledgeCategories, uploadCategory]);
  const uploadDocumentTypeOptions = useMemo(() => {
    const names = knowledgeDocumentTypes.map((documentType) => documentType.name);
    return Array.from(new Set([uploadDocumentType, ...names, ...fallbackUploadDocumentTypes].filter(Boolean)));
  }, [knowledgeDocumentTypes, uploadDocumentType]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    const messageList = messageListRef.current;
    if (!messageList) return;
    if (typeof messageList.scrollTo === 'function') {
      messageList.scrollTo({ top: messageList.scrollHeight, behavior: 'smooth' });
    } else {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages, status]);

  const handleMessageScroll = () => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    const distanceToBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom < 96;
  };

  const loadSession = async (sessionUuid: string) => {
    activeSessionUuidRef.current = sessionUuid;
    activeGenerationKeyRef.current = sessionUuid;
    const activeGeneration = activeGenerationsRef.current.get(sessionUuid);
    setGenerationStatus(activeGeneration ? (activeGeneration.stopped ? 'stopping' : 'running') : 'idle');
    setStatus('正在加载历史任务…');
    try {
      const detail = await getChatSession(sessionUuid);
      if (activeSessionUuidRef.current !== sessionUuid) return;
      setActiveSessionUuid(detail.session_uuid);
      setActiveSessionStatus(normalizeSessionStatus(detail.status));
      setMode(normalizeMode(detail.mode));
      setSourcePreview({ status: 'idle' });
      setWebCapture({ status: 'idle' });
      setEnabledReferenceFiles([]);
      setSelectedPersonalReferenceIds([]);
      setTaskProgress(detail.task_state?.task_state_id ? detail.task_state : null);
      shouldStickToBottomRef.current = true;
      setMessages(detail.messages.map((message) => ({
        id: message.message_uuid,
        role: message.role,
        content: message.content,
        citations: message.citations,
        isComplete: true,
      })));
      setStatus('');
    } catch {
      if (activeSessionUuidRef.current === sessionUuid) {
        setStatus('历史任务加载失败');
      }
    }
  };

  const uploadKnowledge = async () => {
    if (!pendingUploadFiles.length || uploading) return;
    if (uploadPurpose === 'session_attachment' && !activeSessionUuid) {
      setUploadStatus('请先开启一个任务，再上传当前附件');
      return;
    }
    setUploading(true);
    setUploadStatus(`正在上传 ${pendingUploadFiles.length} 个资料，最多同时处理 3 个…`);
    try {
      const options = {
        usageType: uploadPurpose === 'session_attachment' ? 'session_attachment' : 'personal_reference',
        reviewStatus: uploadPurpose === 'submit_review' ? 'pending' : 'draft',
        conversationId: uploadPurpose === 'session_attachment' ? activeSessionUuid : undefined,
        category: uploadPurpose === 'session_attachment' ? '当前附件' : uploadCategory,
        documentType: uploadDocumentType,
        tags: [] as string[],
      } as const;
      const queue = [...pendingUploadFiles];
      const uploaded: KnowledgeFilePayload[] = [];
      const failed: Array<{ file: File; error: unknown }> = [];
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          const nextFile = queue.shift();
          if (!nextFile) return;
          try {
            uploaded.push(await uploadKnowledgeFile(nextFile, options));
          } catch (error) {
            failed.push({ file: nextFile, error });
          }
        }
      }));
      setPendingUploadFiles(failed.map((item) => item.file));
      if (uploadPurpose === 'submit_review') {
        setUploadStatus(`已提交管理员审核 ${uploaded.length} 个${failed.length ? `，失败 ${failed.length} 个` : ''}。`);
      } else if (uploadPurpose === 'session_attachment') {
        setEnabledReferenceFiles((current) => current
          .filter((file) => !uploaded.some((item) => item.file_uuid === file.fileUuid))
          .concat(uploaded.map((item) => ({
            fileUuid: item.file_uuid,
            fileName: item.file_name,
            sourceKind: 'session_attachment' as const,
          }))));
        setMode('knowledge');
        setReferenceScope((current) => (
          current === 'with_personal' || current === 'personal_and_session'
            ? 'personal_and_session'
            : 'with_session'
        ));
        setUploadStatus(failed.length ? `已上传 ${uploaded.length} 个，失败 ${failed.length} 个。${uploadFailureMessage(failed[0].error)}` : '');
      } else {
        const readyUploads = uploaded.filter(isReadyPersonalReference);
        setPersonalReferenceFiles((current) => (
          readyUploads.length
            ? current.filter((file) => !readyUploads.some((item) => item.file_uuid === file.file_uuid)).concat(readyUploads)
            : current
        ));
        if (readyUploads.length) {
          setSelectedPersonalReferenceIds((current) => (
            current.concat(readyUploads.map((item) => item.file_uuid).filter((id) => !current.includes(id)))
          ));
          setMode('knowledge');
          setReferenceScope((current) => (
            current === 'with_session' || current === 'personal_and_session'
              ? 'personal_and_session'
              : 'with_personal'
          ));
          setUploadStatus(`已保存 ${uploaded.length} 个资料，将自动参与后续检索${failed.length ? `；失败 ${failed.length} 个` : ''}。`);
        } else {
          setUploadStatus(`已保存 ${uploaded.length} 个资料；处理完成后会自动参与检索${failed.length ? `，失败 ${failed.length} 个` : ''}。`);
        }
      }
    } catch (error) {
      setUploadStatus(uploadFailureMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = Array.from(event.clipboardData.files || []);
    if (!pastedFiles.length) return;

    event.preventDefault();
    setPendingUploadFiles(pastedFiles);
    setUploadPurpose('personal_reference');
    setUploadStatus(`已从剪贴板识别 ${pastedFiles.length} 个文件，确认后可同时上传。`);
  };

  const loadPersonalReferenceFiles = async () => {
    setReferencePickerStatus('loading');
    try {
      const payload = await listKnowledgeFiles();
      const usableFiles = payload.items.filter(isReadyPersonalReference);
      setPersonalReferenceFiles(usableFiles);
      setSelectedPersonalReferenceIds((current) => {
        const usableIds = new Set(usableFiles.map((file) => file.file_uuid));
        return current.filter((fileId) => usableIds.has(fileId));
      });
      setReferencePickerStatus('ready');
    } catch {
      setReferencePickerStatus('error');
    }
  };

  const toggleReferencePicker = () => {
    const nextOpen = !referencePickerOpen;
    setReferencePickerOpen(nextOpen);
    if (nextOpen && referencePickerStatus === 'idle') {
      void loadPersonalReferenceFiles();
    }
  };

  const togglePersonalReferenceFile = (fileId: string) => {
    setMode('knowledge');
    setSelectedPersonalReferenceIds((current) => (
      current.includes(fileId)
        ? current.filter((item) => item !== fileId)
        : current.concat(fileId)
    ));
    setReferenceScope((current) => (
      current === 'with_session' || current === 'personal_and_session'
        ? 'personal_and_session'
        : 'with_personal'
    ));
  };

  const changeReferenceScope = (nextScope: ReferenceScope) => {
    setReferenceScope(nextScope);
    if (nextScope === 'official_only' || nextScope === 'with_session') {
      setSelectedPersonalReferenceIds([]);
    }
  };

  const removeSelectedPersonalReferenceFile = (fileId: string) => {
    setSelectedPersonalReferenceIds((current) => {
      const next = current.filter((item) => item !== fileId);
      if (!next.length) {
        setReferenceScope((scope) => disableReferenceKind(scope, 'personal_reference'));
      }
      return next;
    });
  };

  const removeEnabledReferenceFile = (file: EnabledReferenceFile) => {
    setEnabledReferenceFiles((current) => current.filter((item) => item.fileUuid !== file.fileUuid));
    setReferenceScope((current) => disableReferenceKind(current, file.sourceKind));
  };

  const previewUrlCapture = async (trimmed: string, url: string) => {
    shouldStickToBottomRef.current = true;
    setStatus('正在抓取网页内容...');
    setQuestion('');
    setMessages((current) => current.concat({
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      citations: [],
      isComplete: true,
    }));
    setWebCapture({ status: 'previewing', url });
    try {
      const preview = await previewWebCapture({
        url,
        conversationId: activeSessionUuid || undefined,
      });
      setWebCapture({ status: 'ready', preview });
      setStatus('');
    } catch (error) {
      const detail = apiErrorDetail(error);
      setWebCapture({
        status: 'error',
        url,
        message: detail || '网页抓取失败，请检查链接或稍后重试。',
      });
      setStatus('');
    }
  };

  const confirmCurrentWebCapture = async (
    saveTarget: 'temporary' | 'personal_reference' | 'official_knowledge_candidate' | 'cancel',
  ) => {
    if (webCapture.status !== 'ready') return;
    if (saveTarget === 'temporary' && !activeSessionUuid) {
      setWebCapture({
        ...webCapture,
        actionStatus: '仅本次使用需要先开启一个任务。可以先保存到我的资料，或在已有任务中使用。',
      });
      return;
    }
    setWebCapture({ status: 'saving', preview: webCapture.preview, action: saveTarget });
    try {
      const result = await confirmWebCapture(webCapture.preview.capture_id, {
        saveTarget,
        category: webCapture.preview.suggested_category,
        documentType: webCapture.preview.suggested_document_type,
        conversationId: activeSessionUuid || undefined,
      });
      if (saveTarget === 'cancel') {
        setWebCapture({ status: 'idle' });
        setStatus('已取消网页采集');
        return;
      }
      if (saveTarget === 'temporary' && result.knowledge_file_uuid) {
        setEnabledReferenceFiles((current) => current
          .filter((file) => file.fileUuid !== result.knowledge_file_uuid)
          .concat({
            fileUuid: result.knowledge_file_uuid || '',
            fileName: webCapture.preview.title || '网页采集资料',
            sourceKind: 'session_attachment',
          }));
        setMode('knowledge');
        setReferenceScope((current) => (
          current === 'with_personal' || current === 'personal_and_session'
            ? 'personal_and_session'
            : 'with_session'
        ));
      }
      if (saveTarget === 'personal_reference') {
        setReferenceScope((current) => (
          current === 'with_session' || current === 'personal_and_session'
            ? 'personal_and_session'
            : 'with_personal'
        ));
      }
      setWebCapture({
        status: 'ready',
        preview: webCapture.preview,
        actionStatus: result.message,
      });
      setStatus('');
    } catch (error) {
      const detail = apiErrorDetail(error);
      setWebCapture({
        status: 'ready',
        preview: webCapture.preview,
        actionStatus: detail || '网页采集保存失败，请稍后重试。',
      });
      setStatus('');
    }
  };

  const markGenerationStopped = (assistantMessageId: string) => {
    setStatus('已停止生成');
    setTaskProgress((current) => current
      ? taskProgressWithStage(current, 'stopped', '已停止生成', '可以修改问题后重新发送')
      : current);
    if (!assistantMessageId) return;
    setMessages((current) => current.map((message) =>
      message.id === assistantMessageId
        ? {
            ...message,
            content: message.content || '已停止生成',
            isComplete: true,
          }
        : message,
    ));
  };

  const send = async (questionOverride?: string, confirmationDigest?: string) => {
    if (generationStatus === 'running') {
      await stopActiveGeneration();
      return;
    }
    if (generationStatus === 'stopping') return;
    const trimmed = (questionOverride ?? question).trim();
    if (!trimmed) return;
    if (activeSessionStatus === 'archived') {
      setStatus('当前任务已归档，请先恢复后继续');
      return;
    }
    if (activeSessionStatus === 'deleted') {
      setStatus('当前任务已删除，请从回收站恢复后继续');
      return;
    }
    const firstUrl = extractFirstWebUrl(trimmed);
    if (firstUrl) {
      await previewUrlCapture(trimmed, firstUrl);
      return;
    }
    if (!shouldUseServerModel && !activeProfile && mode !== 'knowledge') {
      setStatus('请先完成模型设置');
      return;
    }
    shouldStickToBottomRef.current = true;
    setStatus(mode === 'knowledge' ? '检索中…' : '生成中…');
    setGenerationStatus('running');
    setGenerationMetrics(null);
    setQuestion('');
    setMemorySuggestion(detectMemorySuggestion(trimmed));
    const originSessionUuid = activeSessionUuidRef.current;
    let requestSessionUuid = originSessionUuid;
    const requestIsVisible = () => activeSessionUuidRef.current === requestSessionUuid;
    const updateRequestMessages = (updater: (current: UiMessage[]) => UiMessage[]) => {
      if (requestIsVisible()) setMessages(updater);
    };
    const localUserMessageId = `local-user-${Date.now()}`;
    let generationKey = originSessionUuid || `pending:${localUserMessageId}`;
    const generation: ActiveGeneration = {
      sessionUuid: originSessionUuid,
      stopped: false,
    };
    activeGenerationsRef.current.set(generationKey, generation);
    activeGenerationKeyRef.current = generationKey;
    updateRequestMessages((current) => current.concat({
      id: localUserMessageId,
      role: 'user',
      content: trimmed,
      citations: [],
      isComplete: true,
    }));
    let assistantId = '';
    try {
      const prepared = await prepareChat({
        sessionUuid: originSessionUuid || undefined,
        question: trimmed,
        mode,
        attachmentFileIds: sessionAttachmentFiles.map((file) => file.fileUuid),
        personalReferenceFileIds: [],
        includePersonalReferences: true,
        includeSessionAttachments: true,
        sensitiveConfirmationDigest: confirmationDigest,
      });
      requestSessionUuid = prepared.session_uuid;
      if (generationKey !== prepared.session_uuid) {
        const generationWasActive = activeGenerationKeyRef.current === generationKey;
        if (activeGenerationsRef.current.get(generationKey) === generation) {
          activeGenerationsRef.current.delete(generationKey);
        }
        generationKey = prepared.session_uuid;
        generation.sessionUuid = prepared.session_uuid;
        activeGenerationsRef.current.set(generationKey, generation);
        if (generationWasActive) activeGenerationKeyRef.current = generationKey;
      }
      if (!originSessionUuid && activeSessionUuidRef.current === '') {
        activeSessionUuidRef.current = prepared.session_uuid;
        setActiveSessionUuid(prepared.session_uuid);
      }
      if (requestIsVisible()) {
        setTaskProgress(prepared.task_state ? taskProgressWithStage(
          prepared.task_state,
          prepared.completed ? 'completed' : 'generating',
          prepared.completed ? '生成完成' : '正在生成回答',
          prepared.completed ? '生成已完成' : '正在调用模型生成回答',
        ) : null);
        setActiveSessionStatus('active');
      }
      if (prepared.completed) {
        updateRequestMessages((current) => current.concat({
          id: prepared.assistant_message_uuid,
          role: 'assistant',
          content: prepared.answer,
          citations: filterCitationsByAnswer(prepared.citations, prepared.answer),
          isComplete: true,
        }));
        if (requestIsVisible()) setStatus('');
        return;
      }
      if (!shouldUseServerModel && !activeProfile) {
        setStatus('请先完成模型设置');
        return;
      }
      assistantId = prepared.assistant_message_uuid;
      updateRequestMessages((current) => current.concat({
        id: assistantId,
        role: 'assistant',
        content: '',
        citations: [],
        isComplete: false,
      }));
      if (shouldUseServerModel && backgroundMode) {
        const queued = await createLongChatTask({
          conversationId: prepared.session_uuid,
          messageUuid: assistantId,
          completionToken: prepared.completion_token,
          messages: prepared.messages,
          temperature: activeProfile?.temperature ?? 0.3,
          title: trimmed.slice(0, 80),
        });
        replaceLongTask(queued);
        updateRequestMessages((current) => current.map((message) =>
          message.id === assistantId
            ? { ...message, content: '任务已在后台处理，可继续其他工作。', isComplete: true }
            : message,
        ));
        setStatus('已加入后台处理');
        return;
      }
      if (shouldUseServerModel) {
        const abortController = new AbortController();
        generation.abortController = abortController;
        const generated = await streamChatMessage(assistantId, {
          completionToken: prepared.completion_token,
          messages: prepared.messages,
          temperature: activeProfile?.temperature ?? 0.3,
          signal: abortController.signal,
        }, (delta) => {
          updateRequestMessages((current) => current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content + delta }
              : message,
          ));
        });
        if (generation.stopped) {
          if (requestIsVisible()) markGenerationStopped(assistantId);
          return;
        }
        if (requestIsVisible()) {
          setGenerationMetrics({
            latencyMs: generated.latency_ms,
            usage: generated.usage,
          });
          setTaskProgress((current) => current
            ? taskProgressWithStage(current, 'completed', '生成完成', '可以复制、保存、导出或继续追问')
            : current);
        }
        updateRequestMessages((current) => current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: generated.answer,
                citations: generated.citations ?? filterCitationsByAnswer(prepared.citations, generated.answer),
                isComplete: true,
              }
            : message,
        ));
        refreshSessions(sessionListKind).catch(() => undefined);
        if (requestIsVisible()) setStatus('');
        return;
      }
      if (!activeProfile) {
        setStatus('请先完成模型设置');
        return;
      }
      const initialRequestId = `chat-${assistantId}`;
      generation.localRequestId = initialRequestId;
      let result: GeneratedModelResult = await generateLocalModel({
        profileId: activeProfile.id,
        messages: prepared.messages,
        temperature: activeProfile.temperature,
        requestId: initialRequestId,
      }, (delta) => {
        updateRequestMessages((current) => current.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + delta }
            : message,
        ));
      });
      if (generation.stopped) {
        if (requestIsVisible()) markGenerationStopped(assistantId);
        return;
      }
      updateRequestMessages((current) => current.map((message) =>
          message.id === assistantId
              ? {
                  ...message,
                  content: result.output,
                  citations: [],
                  isComplete: false,
                }
              : message,
      ));
      if (shouldRunLoopQualityCheck(prepared.loop_trace)) {
        for (let retryCount = 0; retryCount < 2; retryCount += 1) {
          const check = await checkLoopQuality({
            mode,
            answer: result.output,
            usedKnowledge: prepared.citations.length > 0,
            retryCount,
            messages: prepared.messages as AgentLoopMessage[],
          }).catch(() => null);
          if (!check || check.passed || !check.retry_allowed || !check.revision_messages.length) {
            break;
          }
          if (generation.stopped) {
            if (requestIsVisible()) markGenerationStopped(assistantId);
            return;
          }
          if (requestIsVisible()) {
            setStatus('正在自检并修正…');
            setTaskProgress((current) => current
              ? taskProgressWithStage(current, 'quality_check', '正在复核结果', '正在自检并修正')
              : current);
          }
          const revisionRequestId = `chat-${assistantId}-revise-${retryCount + 1}`;
          generation.localRequestId = revisionRequestId;
          result = await generateLocalModel({
            profileId: activeProfile.id,
            messages: check.revision_messages,
            temperature: activeProfile.temperature,
            requestId: revisionRequestId,
          }, (delta) => {
            updateRequestMessages((current) => current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + delta }
                : message,
            ));
          });
          if (generation.stopped) {
            if (requestIsVisible()) markGenerationStopped(assistantId);
            return;
          }
          updateRequestMessages((current) => current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: result.output,
                  citations: [],
                  isComplete: false,
                }
              : message,
          ));
        }
      }
      if (requestIsVisible()) {
        setGenerationMetrics({
          latencyMs: result.latencyMs,
          usage: result.usage,
        });
      }
      const completed = await completeChatMessage(assistantId, {
        completionToken: prepared.completion_token,
        answer: result.output,
        modelDisplayName: activeProfile.displayName,
        modelId: activeProfile.modelId,
        usage: result.usage,
        latencyMs: result.latencyMs,
      });
      if (requestIsVisible()) {
        setTaskProgress((current) => current
          ? taskProgressWithStage(current, 'completed', '生成完成', '可以复制、保存、导出或继续追问')
          : current);
      }
      updateRequestMessages((current) => current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: result.output,
              citations: completed.citations ?? filterCitationsByAnswer(prepared.citations, result.output),
              isComplete: true,
            }
          : message,
      ));
      refreshSessions(sessionListKind).catch(() => undefined);
      if (requestIsVisible()) setStatus('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const payload = error.payload as {
          detail?: {
            code?: string;
            confirmation_digest?: string;
            findings?: SensitiveFinding[];
          };
        } | null;
        if (
          payload?.detail?.code === 'SENSITIVE_CONFIRMATION_REQUIRED'
          && payload.detail.confirmation_digest
        ) {
          setMessages((current) => current.filter(
            (message) => message.id !== localUserMessageId,
          ));
          setQuestion(trimmed);
          setSensitiveConfirmation({
            question: trimmed,
            digest: payload.detail.confirmation_digest,
            findings: (payload.detail.findings || []).map((finding) => ({
              ...finding,
              field: '工作内容',
            })),
          });
          setStatus('');
          setTaskProgress(null);
          return;
        }
      }
      if (generation.stopped || isAbortLikeError(error)) {
        if (requestIsVisible()) markGenerationStopped(assistantId);
        return;
      }
      if (requestIsVisible()) {
        const detail = apiErrorDetail(error);
        if (detail.includes('已归档')) setActiveSessionStatus('archived');
        if (detail.includes('已删除')) setActiveSessionStatus('deleted');
        setStatus(detail || '内容生成失败，请稍后重试');
        setTaskProgress((current) => current
          ? taskProgressWithStage(current, 'failed', '生成遇到问题', detail || '请稍后重试或调整问题')
          : current);
      }
    } finally {
      if (activeGenerationsRef.current.get(generationKey) === generation) {
        activeGenerationsRef.current.delete(generationKey);
      }
      if (requestIsVisible()) {
        activeGenerationKeyRef.current = requestSessionUuid;
        setGenerationStatus('idle');
      }
    }
  };

  const saveSuggestedMemory = async () => {
    if (!memorySuggestion) return;
    try {
      await createLearningMemory({
        memory_type: memorySuggestion.memoryType,
        title: memorySuggestion.title,
        content: memorySuggestion.content,
        priority: memorySuggestion.priority,
        tags: memorySuggestion.tags,
      });
      setMemorySuggestion(null);
      setStatus('已保存为长期记忆，后续回答会优先参考');
    } catch {
      setStatus('记忆保存失败，请稍后重试');
    }
  };

  const formatForFormalDocument = async (source: string) => {
    if (!activeProfile) {
      setStatus('请先完成模型设置');
      return '';
    }
    setStatus('正在整理为正式文档…');
    const result = await generateLocalModel({
      profileId: activeProfile.id,
      messages: [
        { role: 'system', content: formalDocumentPrompt },
        { role: 'user', content: source },
      ],
      temperature: activeProfile.temperature,
      requestId: `chat-export-${Date.now()}`,
    }, () => {});
    return result.output;
  };

  const showWordExportSuccess = (path?: string) => {
    setStatus('');
    setExportNotice({
      kind: 'success',
      path,
      fileName: path ? fileNameFromPath(path) : undefined,
    });
  };

  const showWordExportFailure = () => {
    setStatus('');
    setExportNotice({ kind: 'error' });
  };

  const copyExportPath = async () => {
    if (!exportNotice || exportNotice.kind !== 'success' || !exportNotice.path) return;
    try {
      await navigator.clipboard.writeText(exportNotice.path);
      setExportNotice({ ...exportNotice, copyStatus: '路径已复制', openStatus: '' });
    } catch {
      setExportNotice({ ...exportNotice, copyStatus: '路径复制失败，请手动复制', openStatus: '' });
    }
  };

  const openExportFile = async () => {
    if (!exportNotice || exportNotice.kind !== 'success' || !exportNotice.path) return;
    try {
      const result = await openLocalWordFile(exportNotice.path);
      setExportNotice({
        ...exportNotice,
        openStatus: result === 'opened' ? '正在打开文件…' : '当前环境不支持直接打开文件',
        copyStatus: '',
      });
    } catch {
      setExportNotice({ ...exportNotice, openStatus: '当前环境不支持直接打开文件', copyStatus: '' });
    }
  };

  const exportMessageWord = async (message: UiMessage) => {
    if (!activeSessionUuid) {
      setStatus('请先完成一次任务后再导出 Word');
      return;
    }
    try {
      setExportingWord(true);
      const formattedContent = exportType === 'formal_document'
        ? await formatForFormalDocument(message.content)
        : undefined;
      if (exportType === 'formal_document' && !formattedContent) return;
      const result = await exportChatWord({
        conversationId: activeSessionUuid,
        messageId: message.id,
        exportType,
        formattedContent,
      });
      showWordExportSuccess(result.kind === 'desktop' ? result.path : undefined);
    } catch {
      showWordExportFailure();
    } finally {
      setExportingWord(false);
    }
  };

  const exportLatestAnswerWord = async () => {
    if (!activeSessionUuid) {
      setStatus('请先选择或完成一个任务后再导出 Word');
      return;
    }
    const latestAssistantMessage = [...messages].reverse().find((message) =>
      message.role === 'assistant' && message.content.trim());
    if (!latestAssistantMessage) {
      setStatus('当前没有可导出的生成内容');
      return;
    }
    try {
      setExportingWord(true);
      const formattedContent = exportType === 'formal_document'
        ? await formatForFormalDocument(latestAssistantMessage.content)
        : undefined;
      if (exportType === 'formal_document' && !formattedContent) return;
      const result = await exportChatWord({
        conversationId: activeSessionUuid,
        messageId: latestAssistantMessage.id,
        exportType,
        formattedContent,
      });
      showWordExportSuccess(result.kind === 'desktop' ? result.path : undefined);
    } catch {
      showWordExportFailure();
    } finally {
      setExportingWord(false);
    }
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setStatus('已复制到剪贴板');
    } catch {
      setStatus('复制失败，请手动选择文本复制');
    }
  };

  const saveMessageAsWorkArtifact = async (message: UiMessage) => {
    if (!activeSessionUuid) {
      setStatus('请先完成一次任务后再保存成果');
      return;
    }
    try {
      await saveChatMessageWorkArtifact({
        conversationId: activeSessionUuid,
        messageId: message.id,
        title: artifactTitleFromMessage(message.content),
      });
      setStatus('已保存到工作成果');
    } catch {
      setStatus('工作成果保存失败，请稍后重试');
    }
  };

  const previousUserQuestion = (messageId: string): string => {
    const index = messages.findIndex((item) => item.id === messageId);
    if (index <= 0) return '';
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor].role === 'user' && messages[cursor].content.trim()) {
        return messages[cursor].content.trim();
      }
    }
    return '';
  };

  const logLearningFeedback = async (payload: Parameters<typeof createLearningFeedback>[0]) => {
    try {
      await createLearningFeedback(payload);
      return true;
    } catch {
      return false;
    }
  };

  const saveMessageAsExperience = async (message: UiMessage) => {
    const question = previousUserQuestion(message.id);
    const taskType = window.prompt('适用场景是什么？例如：商务投标、交付验收、会议纪要', modeLabels[mode])?.trim();
    if (!taskType) return;
    try {
      await createLearningExperience({
        task_type: taskType,
        title: question ? question.slice(0, 80) : '优秀回答经验',
        question: question || '未记录原始问题',
        answer: message.content,
        summary: message.content.replace(/\s+/g, ' ').slice(0, 300),
        tags: [taskType],
      });
      const feedbackLogged = await logLearningFeedback({
        conversation_id: activeSessionUuid,
        message_id: message.id,
        feedback_type: 'save_experience',
        saved_as: 'experience',
      });
      setStatus(feedbackLogged
        ? '已保存为经验，后续类似问题会自动参考'
        : '已保存为经验，但反馈记录暂未写入');
    } catch {
      setStatus('保存经验失败，请稍后重试');
    }
  };

  const saveMessageAsTemplate = async (message: UiMessage) => {
    const templateName = window.prompt('模板名称是什么？', `${modeLabels[mode]}模板`)?.trim();
    if (!templateName) return;
    try {
      await createLearningTemplate({
        template_name: templateName,
        task_type: modeLabels[mode],
        template_content: message.content,
        variables: {},
        scope: 'personal',
      });
      const feedbackLogged = await logLearningFeedback({
        conversation_id: activeSessionUuid,
        message_id: message.id,
        feedback_type: 'save_template',
        saved_as: 'template',
      });
      setStatus(feedbackLogged ? '已保存为个人模板' : '已保存为个人模板，但反馈记录暂未写入');
    } catch {
      setStatus('保存模板失败，请稍后重试');
    }
  };

  const recordMessageAsFailure = async (message: UiMessage) => {
    const correction = window.prompt('正确做法是什么？请写下修正方式。')?.trim();
    if (!correction) return;
    const preventionRule = window.prompt('以后如何避免再犯？', '遇到类似问题时先检查这条修正规则。')?.trim() || correction;
    try {
      await createLearningFailureCase({
        task_type: modeLabels[mode],
        wrong_answer: message.content,
        correction,
        prevention_rule: preventionRule,
        tags: [modeLabels[mode], '用户纠错'],
      });
      const feedbackLogged = await logLearningFeedback({
        conversation_id: activeSessionUuid,
        message_id: message.id,
        feedback_type: 'record_error',
        comment: correction,
        saved_as: 'failure_case',
      });
      setStatus(feedbackLogged
        ? '已记录为错误修正，后续类似问题会优先避坑'
        : '已记录为错误修正，但反馈记录暂未写入');
    } catch {
      setStatus('记录错误失败，请稍后重试');
    }
  };

  const submitMessageFeedback = async (
    message: UiMessage,
    feedbackType: 'useful' | 'not_useful' | 'needs_revision',
  ) => {
    const comment = feedbackType === 'needs_revision'
      ? window.prompt('哪里需要修改？')?.trim()
      : '';
    if (feedbackType === 'needs_revision' && !comment) return;
    try {
      await createLearningFeedback({
        conversation_id: activeSessionUuid,
        message_id: message.id,
        feedback_type: feedbackType,
        comment,
      });
      setStatus(feedbackType === 'useful'
        ? '已记录：这条回答有用'
        : feedbackType === 'not_useful'
          ? '已记录：这条回答没用'
          : '已记录修改意见');
    } catch {
      setStatus('反馈提交失败，请稍后重试');
    }
  };

  const openSourcePreview = async (citation: ChatCitation) => {
    if (!citation.file_uuid) {
      setStatus('该来源缺少文件标识，暂时无法预览');
      return;
    }
    setSourcePreview({ status: 'loading', citation });
    try {
      const preview = await previewKnowledgeFile(citation.file_uuid, {
        chunkId: citation.chunk_id,
        topK: citation.chunk_id ? 1 : 5,
      });
      setSourcePreview({ status: 'ready', citation, preview });
    } catch {
      setSourcePreview({ status: 'error', citation, message: '来源预览加载失败，请稍后重试' });
    }
  };

  const regenerateMessage = (messageId: string) => {
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    const source = messages
      .slice(0, messageIndex)
      .reverse()
      .find((message) => message.role === 'user');
    if (!source) {
      setStatus('未找到可重新生成的原始问题');
      return;
    }
    void send(source.content);
  };

  const retryLatestTask = () => {
    const source = [...messages].reverse().find((message) => message.role === 'user');
    if (!source) {
      setStatus('未找到可重试的原始问题');
      return;
    }
    void send(source.content);
  };

  const startNewSession = () => {
    activeSessionUuidRef.current = '';
    activeGenerationKeyRef.current = '';
    setGenerationStatus('idle');
    setActiveSessionUuid('');
    setActiveSessionStatus('');
    setSessionListKind('active');
    setSelectedSessionIds([]);
    setMessages([]);
    setSourcePreview({ status: 'idle' });
    setWebCapture({ status: 'idle' });
    setPendingUploadFiles([]);
    setEnabledReferenceFiles([]);
    setTaskProgress(null);
    setStatus('');
  };

  const runSessionAction = async (
    action: () => Promise<void>,
    successMessage: string,
    nextKind = sessionListKind,
    affectedSessionUuid?: string,
    affectedStatus?: 'archived' | 'deleted' | 'active',
  ) => {
    try {
      await action();
      if (affectedSessionUuid && affectedSessionUuid === activeSessionUuid && affectedStatus) {
        setActiveSessionStatus(affectedStatus);
      }
      setStatus(successMessage);
      await refreshSessions(nextKind);
    } catch {
      setStatus('历史任务操作失败，请稍后重试');
    }
  };

  const archiveSession = (session: ChatSessionPayload) => runSessionAction(
    () => archiveChatSession(session.session_uuid),
    '任务已归档',
    sessionListKind,
    session.session_uuid,
    'archived',
  );

  const renameSession = async (session: ChatSessionPayload) => {
    const nextTitle = window.prompt('重命名任务', session.title)?.trim();
    if (!nextTitle) return;
    await runSessionAction(
      () => renameChatSession(session.session_uuid, nextTitle).then(() => undefined),
      '任务已重命名',
      sessionListKind,
    );
  };

  const restoreSession = (session: ChatSessionPayload) => runSessionAction(
    () => restoreChatSession(session.session_uuid),
    '任务已恢复',
    sessionListKind,
    session.session_uuid,
    'active',
  );

  const softDeleteSession = (session: ChatSessionPayload) => runSessionAction(
    () => deleteChatSession(session.session_uuid),
    '任务已移入回收站',
    sessionListKind,
    session.session_uuid,
    'deleted',
  );

  const hardDeleteSession = async (session: ChatSessionPayload) => {
    try {
      setStatus('正在彻底删除任务…');
      await hardDeleteChatSession(session.session_uuid);
      setSessions((current) => current.filter((item) => item.session_uuid !== session.session_uuid));
      setSelectedSessionIds((current) => current.filter((sessionUuid) => sessionUuid !== session.session_uuid));
      setStatus('任务已彻底删除');
      if (session.session_uuid === activeSessionUuid) {
        setActiveSessionUuid('');
        setActiveSessionStatus('');
        setMessages([]);
        setEnabledReferenceFiles([]);
      }
      await refreshSessions('trash');
    } catch {
      setStatus('历史任务操作失败，请稍后重试');
    }
  };

  const exportSessionWord = async (session: ChatSessionPayload) => {
    try {
      setExportingWord(true);
      const result = await exportChatWord({
        conversationId: session.session_uuid,
        exportType: 'full_conversation',
      });
      showWordExportSuccess(result.kind === 'desktop' ? result.path : undefined);
    } catch {
      showWordExportFailure();
    } finally {
      setExportingWord(false);
    }
  };

  const toggleSessionSelection = (sessionUuid: string, checked: boolean) => {
    setSelectedSessionIds((current) => {
      if (checked) return current.includes(sessionUuid) ? current : current.concat(sessionUuid);
      return current.filter((id) => id !== sessionUuid);
    });
  };

  const bulkArchiveSessions = async () => {
    if (!selectedSessionIds.length) return;
    if (!window.confirm(`确认归档选中的 ${selectedSessionIds.length} 个任务？`)) return;
    const ids = selectedSessionIds;
    try {
      const affected = await bulkArchiveChatSessions(ids);
      if (activeSessionUuid && ids.includes(activeSessionUuid)) {
        setActiveSessionStatus('archived');
      }
      setSelectedSessionIds([]);
      setStatus(`已批量归档 ${affected} 个任务`);
      await refreshSessions(sessionListKind);
    } catch {
      setStatus('批量归档失败，请稍后重试');
    }
  };

  const bulkDeleteSessions = async () => {
    if (!selectedSessionIds.length) return;
    if (!window.confirm(`确认删除选中的 ${selectedSessionIds.length} 个任务？删除后可在回收站恢复。`)) return;
    const ids = selectedSessionIds;
    try {
      const affected = await bulkDeleteChatSessions(ids);
      if (activeSessionUuid && ids.includes(activeSessionUuid)) {
        setActiveSessionStatus('deleted');
      }
      setSelectedSessionIds([]);
      setStatus(`已批量删除 ${affected} 个任务`);
      await refreshSessions(sessionListKind);
    } catch {
      setStatus('批量删除失败，请稍后重试');
    }
  };

  const composerDisabledReason = activeSessionStatus === 'archived'
    ? '当前任务已归档，请先恢复后继续。'
    : activeSessionStatus === 'deleted'
      ? '当前任务已删除，请从回收站恢复后继续。'
      : '';
  const sidebarStatus = composerDisabledReason || status;
  const selectedSessionSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds]);

  const handleComposerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process' || event.keyCode === 229) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send();
  };

  return (
    <section
      aria-label="私人工作助理工作区"
      className={`chat-page${messages.length ? ' has-chat-content' : ''}`}
    >
      <div className="chat-shell">
        <aside className="chat-sessions" aria-label="历史任务">
          <div className="chat-sessions-heading">
            <strong>历史任务</strong>
            <button className="chat-new-button" onClick={startNewSession} type="button">开启新任务</button>
          </div>
          <div className="chat-session-tabs" aria-label="任务分类">
            {(Object.keys(sessionListLabels) as ChatSessionListKind[]).map((kind) => (
              <button
                className={sessionListKind === kind ? 'is-active' : ''}
                key={kind}
                onClick={() => {
                  if (sessionListKind === kind) {
                    void refreshSessions(kind);
                    return;
                  }
                  setSessionListKind(kind);
                }}
                type="button"
              >
                {sessionListLabels[kind]}
              </button>
            ))}
          </div>
          {sessionListKind !== 'trash' ? (
            <div className="chat-session-bulk-actions" aria-label="批量任务操作">
              <span>已选 {selectedSessionIds.length}</span>
              {sessionListKind === 'active' ? (
                <button
                  disabled={!selectedSessionIds.length}
                  onClick={() => void bulkArchiveSessions()}
                  type="button"
                >
                  批量归档
                </button>
              ) : null}
              <button
                disabled={!selectedSessionIds.length}
                onClick={() => void bulkDeleteSessions()}
                type="button"
              >
                批量删除
              </button>
            </div>
          ) : null}
          {sessions.map((session) => {
            const sessionTitle = safeSessionDisplayTitle(session.title);
            return (
              <div
                className={activeSessionUuid === session.session_uuid ? 'is-active' : ''}
                key={session.session_uuid}
                data-session-status={normalizeSessionStatus(session.status)}
              >
                {normalizeSessionStatus(session.status) !== 'deleted' ? (
                  <label className="chat-session-select">
                    <input
                      aria-label={`选择任务：${sessionTitle}`}
                      checked={selectedSessionSet.has(session.session_uuid)}
                      onChange={(event) => toggleSessionSelection(session.session_uuid, event.target.checked)}
                      type="checkbox"
                    />
                    <span>选择</span>
                  </label>
                ) : null}
                <button
                  aria-label={sessionTitle}
                  type="button"
                  onClick={() => {
                    if (normalizeSessionStatus(session.status) === 'deleted') {
                      setStatus('已删除任务需要先恢复后查看');
                      return;
                    }
                    void loadSession(session.session_uuid);
                  }}
                >
                  <span className="chat-session-title">{sessionTitle}</span>
                  <small>{modeLabels[normalizeMode(session.mode)]}</small>
                </button>
                <div className="chat-session-actions">
                  {normalizeSessionStatus(session.status) === 'active' ? (
                    <>
                      <button
                        aria-label={`重命名：${sessionTitle}`}
                        onClick={() => void renameSession(session)}
                        type="button"
                      >
                        重命名
                      </button>
                      <button
                        aria-label={`归档：${sessionTitle}`}
                        onClick={() => void archiveSession(session)}
                        type="button"
                      >
                        归档
                      </button>
                      <button
                        aria-label={`删除：${sessionTitle}`}
                        onClick={() => void softDeleteSession(session)}
                        type="button"
                      >
                        删除
                      </button>
                      <button
                        aria-label={`导出 Word：${sessionTitle}`}
                        disabled={exportingWord}
                        onClick={() => void exportSessionWord(session)}
                        type="button"
                      >
                        导出 Word
                      </button>
                    </>
                  ) : null}
                  {normalizeSessionStatus(session.status) === 'archived' ? (
                    <>
                      <button
                        aria-label={`恢复：${sessionTitle}`}
                        onClick={() => void restoreSession(session)}
                        type="button"
                      >
                        恢复
                      </button>
                      <button
                        aria-label={`删除：${sessionTitle}`}
                        onClick={() => void softDeleteSession(session)}
                        type="button"
                      >
                        删除
                      </button>
                      <button
                        aria-label={`导出 Word：${sessionTitle}`}
                        disabled={exportingWord}
                        onClick={() => void exportSessionWord(session)}
                        type="button"
                      >
                        导出 Word
                      </button>
                    </>
                  ) : null}
                  {normalizeSessionStatus(session.status) === 'deleted' ? (
                    <>
                      <button
                        aria-label={`恢复：${sessionTitle}`}
                        onClick={() => void restoreSession(session)}
                        type="button"
                      >
                        恢复
                      </button>
                      <button
                        aria-label={`彻底删除：${sessionTitle}`}
                        onClick={() => void hardDeleteSession(session)}
                        type="button"
                      >
                        彻底删除
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
          {sidebarStatus ? (
            <p className="chat-sidebar-status" role="status">{sidebarStatus}</p>
          ) : null}
        </aside>

        <div className="chat-stage">
          <div className="chat-topbar">
            <div className="chat-top-actions">
              <label className="chat-mode-select">
                <span>助手模式</span>
                <select
                  aria-label="助手模式"
                  onChange={(event) => setMode(normalizeMode(event.target.value))}
                  value={mode}
                >
                  {(Object.keys(modeLabels) as ChatMode[]).map((item) => (
                    <option key={item} value={item}>
                      {modeLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="chat-mode-select">
                <span>导出工作成果</span>
                <select
                  aria-label="导出方式"
                  onChange={(event) => setExportType(event.target.value as ChatExportType)}
                  value={exportType}
                >
                  {wordExportTypes.map((item) => (
                    <option key={item} value={item}>
                      {exportTypeLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="chat-export-button"
                disabled={!activeSessionUuid || !messages.length || exportingWord}
                onClick={() => void exportLatestAnswerWord()}
                type="button"
              >
                {exportingWord ? '导出中…' : '导出工作成果'}
              </button>
            </div>
          </div>

          <header className="chat-hero">
            <h2>告诉我你想完成什么工作</h2>
            <p>我是你的私人工作助理，可以帮你写、查、整理、生成和导出工作成果。</p>
          </header>

          {taskProgress || generationMetricRows.length ? (
            <aside className="chat-progress-rail" aria-label="任务进度">
              {taskProgress ? (
                <TaskProgressTimeline
                  stage={taskProgress.stage}
                  label={taskProgress.label}
                  nextAction={taskProgress.next_action}
                  stageHistory={taskProgress.stage_history}
                  selectedSources={taskProgress.selected_sources}
                  toolCalls={taskProgress.tool_calls}
                  onRetry={retryLatestTask}
                />
              ) : null}
              {generationMetricRows.length ? (
                <section className="chat-generation-metrics" aria-label="生成指标">
                  <strong>生成指标</strong>
                  {generationMetricRows.map((item) => (
                    <span key={item.label}>
                      <em>{item.label}</em>
                      <b>{item.value}</b>
                    </span>
                  ))}
                </section>
              ) : null}
            </aside>
          ) : null}

          <div className="chat-content-grid">
            <div
              className="chat-messages"
              aria-live="polite"
              onScroll={handleMessageScroll}
              ref={messageListRef}
            >
              {!messages.length ? (
                <div className="chat-empty-state">
                  <p>例如：</p>
                  <div className="chat-quick-prompts" aria-label="示例提示">
                    {[
                      '写一份项目方案',
                      '整理会议纪要',
                      '查询公司知识库',
                      '参考我的资料生成内容',
                      '导出 Word 文档',
                    ].map((prompt) => (
                      <span key={prompt}>
                        {prompt}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {messages.map((message) => {
                const messageCitations = message.role === 'assistant' && message.isComplete !== false
                  ? message.citations
                  : [];
                const citationReferences = citationFileReferences(messageCitations);
                return (
                  <article className={`chat-message ${message.role}`} key={message.id}>
                    <div className="chat-avatar" aria-hidden="true">
                      {message.role === 'user' ? '我' : '聚'}
                    </div>
                    <div className="chat-bubble">
                      <strong>{message.role === 'user' ? '我' : '聚信 AI 助手'}</strong>
                      <div className="chat-message-content">
                        {message.role === 'assistant'
                          ? renderChatContent(message.content, citationReferences)
                          : <p>{message.content || '正在生成…'}</p>}
                      </div>
                      {citationReferences.some((reference) => reference.citation.media_type?.startsWith('image/') && reference.citation.asset_url) ? (
                        <div className="chat-image-attachments" aria-label="回答图片">
                          {citationReferences
                            .filter((reference) => reference.citation.media_type?.startsWith('image/') && reference.citation.asset_url)
                            .map((reference) => (
                              <a href={reference.citation.asset_url} key={reference.key} target="_blank" rel="noreferrer">
                                <img alt={reference.label || '资料库图片'} src={reference.citation.asset_url} />
                                <span>{reference.label || '资料库图片'}</span>
                              </a>
                            ))}
                        </div>
                      ) : null}
                      {message.content.startsWith('已找到文件') && citationReferences.some((reference) => (
                        reference.citation.asset_url && !reference.citation.media_type?.startsWith('image/')
                      )) ? (
                        <div className="chat-file-deliveries" aria-label="可下载文件">
                          {citationReferences
                            .filter((reference) => reference.citation.asset_url && !reference.citation.media_type?.startsWith('image/'))
                            .map((reference) => (
                              <a download href={reference.citation.asset_url} key={reference.key}>
                                <span className="chat-file-delivery-icon" aria-hidden="true">↓</span>
                                <span>
                                  <strong>{reference.label}</strong>
                                  <small>点击下载</small>
                                </span>
                              </a>
                            ))}
                        </div>
                      ) : null}
                      {citationReferences.length ? (
                        <details className="chat-citations">
                          <summary aria-label={`查看 ${citationReferences.length} 个引用来源`}>
                            <span className="chat-source-summary-icon" aria-hidden="true">↗</span>
                            <span>来源</span>
                            <span className="chat-source-summary-count">{citationReferences.length}</span>
                          </summary>
                          <ul aria-label="引用来源">
                            {citationReferences.map((reference) => (
                              <li key={reference.key}>
                                {reference.citation.file_uuid ? (
                                  <button
                                    className="chat-citation-button"
                                    aria-label={`打开来源：${reference.label}`}
                                    onClick={() => void openSourcePreview(reference.citation)}
                                    title={reference.label}
                                    type="button"
                                  >
                                    <span className={`chat-citation-source ${reference.sourceClassName}`} aria-hidden="true">
                                      {reference.sourceLabel.slice(0, 1)}
                                    </span>
                                    <span>{reference.sourceLabel}</span>
                                    {reference.locations.length > 1 ? (
                                      <span className="chat-citation-count">+{reference.locations.length}</span>
                                    ) : null}
                                  </button>
                                ) : (
                                  <span className="chat-citation-static-source" aria-label={`来源：${reference.label}`} title={reference.label}>
                                    <span className={`chat-citation-source ${reference.sourceClassName}`} aria-hidden="true">
                                      {reference.sourceLabel.slice(0, 1)}
                                    </span>
                                    <span>{reference.sourceLabel}</span>
                                    {reference.locations.length > 1 ? (
                                      <span className="chat-citation-count">+{reference.locations.length}</span>
                                    ) : null}
                                  </span>
                                )}
                                {reference.locations.length ? (
                                  <ul aria-label={`${reference.sourceLabel} 引用位置`} className="chat-citation-locations">
                                    {reference.locations.map((location) => (
                                      <li key={location}>{location}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {message.role === 'assistant' && message.content ? (
                        <div className="chat-message-actions">
                          <button onClick={() => void submitMessageFeedback(message, 'useful')} type="button">
                            有用
                          </button>
                          <button onClick={() => void submitMessageFeedback(message, 'not_useful')} type="button">
                            没用
                          </button>
                          <button onClick={() => void submitMessageFeedback(message, 'needs_revision')} type="button">
                            需要修改
                          </button>
                          <button onClick={() => void copyMessage(message.content)} type="button">
                            复制
                          </button>
                          <button onClick={() => regenerateMessage(message.id)} type="button">
                            重新生成
                          </button>
                          <button disabled={exportingWord} onClick={() => void exportMessageWord(message)} type="button">
                            {exportingWord ? '导出中…' : '导出 Word'}
                          </button>
                          <button onClick={() => void saveMessageAsWorkArtifact(message)} type="button">
                            保存成果
                          </button>
                          <button onClick={() => void saveMessageAsExperience(message)} type="button">
                            保存为经验
                          </button>
                          <button onClick={() => void saveMessageAsTemplate(message)} type="button">
                            保存为模板
                          </button>
                          <button onClick={() => void recordMessageAsFailure(message)} type="button">
                            记录为错误
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {webCapture.status === 'previewing' ? (
                <article className="chat-message assistant">
                  <div className="chat-avatar" aria-hidden="true">聚</div>
                  <div className="chat-bubble">
                    <strong>聚信 AI 助手</strong>
                    <p>正在抓取网页内容...</p>
                    <p className="chat-web-capture-url">{webCapture.url}</p>
                  </div>
                </article>
              ) : null}
              {webCapture.status === 'error' ? (
                <article className="chat-message assistant">
                  <div className="chat-avatar" aria-hidden="true">聚</div>
                  <div className="chat-bubble">
                    <strong>聚信 AI 助手</strong>
                    <p role="status">{webCapture.message}</p>
                    <p className="chat-web-capture-url">{webCapture.url}</p>
                  </div>
                </article>
              ) : null}
              {(webCapture.status === 'ready' || webCapture.status === 'saving') ? (
                <article className="chat-message assistant">
                  <div className="chat-avatar" aria-hidden="true">聚</div>
                  <div className="chat-bubble chat-web-capture-card">
                    <strong>已抓取网页内容，请确认是否保存</strong>
                    <dl>
                      <div>
                        <dt>网页标题</dt>
                        <dd>{webCapture.preview.title}</dd>
                      </div>
                      <div>
                        <dt>来源网站</dt>
                        <dd>{webCapture.preview.site_name || '待确认'}</dd>
                      </div>
                      <div>
                        <dt>URL</dt>
                        <dd className="chat-web-capture-url">{webCapture.preview.final_url || webCapture.preview.url}</dd>
                      </div>
                      <div>
                        <dt>抓取时间</dt>
                        <dd>{new Date(webCapture.preview.fetched_at).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>发布时间</dt>
                        <dd>{webCapture.preview.published_at || '待确认'}</dd>
                      </div>
                      <div>
                        <dt>字数</dt>
                        <dd>{webCapture.preview.word_count}</dd>
                      </div>
                      <div>
                        <dt>建议资料分类</dt>
                        <dd>{webCapture.preview.suggested_category}</dd>
                      </div>
                      <div>
                        <dt>建议文档类型</dt>
                        <dd>{webCapture.preview.suggested_document_type}</dd>
                      </div>
                      <div>
                        <dt>有效期建议</dt>
                        <dd>{webCapture.preview.validity}</dd>
                      </div>
                      <div>
                        <dt>入库范围</dt>
                        <dd>{webCapture.preview.scope}</dd>
                      </div>
                    </dl>
                    <section className="chat-web-capture-summary" aria-label="网页摘要">
                      <span>内容摘要</span>
                      <p>{webCapture.preview.summary || '暂无'}</p>
                    </section>
                    {'actionStatus' in webCapture && webCapture.actionStatus ? (
                      <p className="chat-web-capture-status" role="status">{webCapture.actionStatus}</p>
                    ) : null}
                    <div className="chat-message-actions">
                      <button
                        disabled={webCapture.status === 'saving' || !activeSessionUuid}
                        onClick={() => void confirmCurrentWebCapture('temporary')}
                        title={!activeSessionUuid ? '仅本次使用需要先开启一个任务' : undefined}
                        type="button"
                      >
                        仅本次使用
                      </button>
                      <button
                        disabled={webCapture.status === 'saving'}
                        onClick={() => void confirmCurrentWebCapture('personal_reference')}
                        type="button"
                      >
                        保存到我的资料
                      </button>
                      <button
                        disabled={webCapture.status === 'saving'}
                        onClick={() => void confirmCurrentWebCapture('official_knowledge_candidate')}
                        type="button"
                      >
                        提交公司知识库审核
                      </button>
                      <button
                        disabled={webCapture.status === 'saving'}
                        onClick={() => void confirmCurrentWebCapture('cancel')}
                        type="button"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </article>
              ) : null}
            </div>

            {sourcePreview.status !== 'idle' ? (
              <div
                className="chat-source-preview-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setSourcePreview({ status: 'idle' });
                }}
              >
              <aside aria-label="来源预览" aria-modal="true" className="chat-source-preview" role="dialog">
                <div className="chat-source-preview-header">
                  <div>
                    <span className="chat-source-preview-icon" aria-hidden="true">⌘</span>
                    <div><strong>来源预览</strong><small>引用位置已高亮，可滚动查看原始资料</small></div>
                  </div>
                  <button aria-label="关闭来源预览" autoFocus onClick={() => setSourcePreview({ status: 'idle' })} type="button">
                    ×
                  </button>
                </div>
                {sourcePreview.status === 'loading' ? (
                  <div className="chat-source-preview-state"><span className="button-spinner" />正在打开来源片段…</div>
                ) : null}
                {sourcePreview.status === 'error' ? (
                  <p className="chat-source-preview-state" role="status">{sourcePreview.message}</p>
                ) : null}
                {sourcePreview.status === 'ready' ? (
                  <div className="chat-source-preview-body">
                    <div className="chat-source-preview-document">
                      <span>来源文件</span>
                      <h3>{sourcePreview.preview.file_name}</h3>
                      <p>{sourcePreview.preview.notice}</p>
                    </div>
                    {sourcePreview.preview.chunks.map((chunk, index) => {
                      const referenced = isReferencedPreviewChunk(sourcePreview.citation, chunk, index);
                      return (
                        <article
                          key={chunk.chunk_id}
                          className={`chat-source-preview-chunk${referenced ? ' is-referenced' : ''}`}
                          ref={referenced ? sourceHighlightRef : undefined}
                        >
                          <strong>{chunkReferenceTitle(chunk)}</strong>
                          {referenced ? <span className="chat-source-highlight-label">本次引用</span> : null}
                          <p>{referenced ? <mark>{chunk.text}</mark> : chunk.text}</p>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </aside>
              </div>
            ) : null}
          </div>

          <div className="chat-composer-wrap">
            <form aria-label="工作输入区" className="chat-composer" onSubmit={handleComposerSubmit}>
              <textarea
                aria-label="告诉我你想完成什么工作"
                disabled={Boolean(composerDisabledReason)}
                id="chat-composer-input"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                onPaste={handleComposerPaste}
                placeholder="告诉我你想完成什么工作..."
                value={question}
              />
              {sessionAttachmentFiles.length ? (
                <section aria-label="当前附件" className="chat-attachment-bar">
                  {sessionAttachmentFiles.length === 1 ? (
                    <div className="chat-attachment-row">
                      <span className="chat-attachment-type">
                        {attachmentFileTypeLabel(sessionAttachmentFiles[0].fileName)}
                      </span>
                      <span className="chat-attachment-name" title={sessionAttachmentFiles[0].fileName}>
                        {sessionAttachmentFiles[0].fileName}
                      </span>
                      <span className="chat-attachment-status">当前附件</span>
                      <button
                        aria-label={`移除附件：${sessionAttachmentFiles[0].fileName}`}
                        className="chat-attachment-remove"
                        onClick={() => removeEnabledReferenceFile(sessionAttachmentFiles[0])}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <details className="chat-attachment-stack">
                      <summary className="chat-attachment-row">
                        <span className="chat-attachment-type">
                          {attachmentFileTypeLabel(sessionAttachmentFiles[0].fileName)}
                        </span>
                        <span className="chat-attachment-name" title={sessionAttachmentFiles[0].fileName}>
                          {sessionAttachmentFiles[0].fileName}
                        </span>
                        <span className="chat-attachment-status">共 {sessionAttachmentFiles.length} 个附件</span>
                      </summary>
                      <div className="chat-attachment-list">
                        {sessionAttachmentFiles.slice(0, 3).map((file) => (
                          <div className="chat-attachment-row" key={file.fileUuid}>
                            <span className="chat-attachment-type">{attachmentFileTypeLabel(file.fileName)}</span>
                            <span className="chat-attachment-name" title={file.fileName}>{file.fileName}</span>
                            <span className="chat-attachment-status">当前附件</span>
                            <button
                              aria-label={`移除附件：${file.fileName}`}
                              className="chat-attachment-remove"
                              onClick={() => removeEnabledReferenceFile(file)}
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {sessionAttachmentFiles.length > 3 ? (
                          <span className="chat-attachment-more">查看更多</span>
                        ) : null}
                      </div>
                    </details>
                  )}
                </section>
              ) : null}
              <div className="chat-composer-toolbar">
                <label className="chat-file-trigger">
                  <span>＋ 上传资料</span>
                  <input
                    aria-label="上传资料"
                    accept={supportedKnowledgeAccept}
                    multiple
                    onChange={(event) => {
                      const selectedFiles = Array.from(event.target.files || []);
                      if (!selectedFiles.length) return;
                      setPendingUploadFiles(selectedFiles);
                      setUploadPurpose('personal_reference');
                      setUploadStatus('');
                      event.target.value = '';
                    }}
                    type="file"
                  />
                </label>
                <span className="chat-model-pill">当前设置：{currentModelLabel}</span>
                {shouldUseServerModel ? (
                  <label className="chat-background-toggle">
                    <input
                      aria-label="后台处理"
                      checked={backgroundMode}
                      onChange={(event) => setBackgroundMode(event.target.checked)}
                      type="checkbox"
                    />
                    <span>后台处理</span>
                  </label>
                ) : null}
                <button
                  aria-label={generationActive ? '停止生成' : '发送'}
                  className={`chat-send-button${generationActive ? ' is-stop-button is-stopping-ready' : ''}`}
                  disabled={generationStatus === 'stopping' || (!generationActive && (!question.trim() || Boolean(composerDisabledReason)))}
                  onClick={generationActive ? () => void stopActiveGeneration() : undefined}
                  type={generationActive ? 'button' : 'submit'}
                >
                  <span aria-hidden="true">{generationActive ? '' : '↑'}</span>
                </button>
              </div>
              {memorySuggestion ? (
                <section className="chat-memory-suggestion" aria-label="长期记忆建议">
                  <div>
                    <strong>是否保存为长期记忆？</strong>
                    <p>{memorySuggestion.content}</p>
                  </div>
                  <button onClick={() => void saveSuggestedMemory()} type="button">保存</button>
                  <button onClick={() => setMemorySuggestion(null)} type="button">不保存</button>
                </section>
              ) : null}
              {uploadStatus ? <p className="chat-composer-hint" role="status">{uploadStatus}</p> : null}
            </form>
          </div>
          {exportNotice ? (
            <div className="chat-export-dialog-backdrop">
              <section
                aria-label={exportNotice.kind === 'success' ? 'Word 已导出成功' : 'Word 导出失败'}
                aria-modal="true"
                className="chat-export-dialog"
                role="dialog"
              >
                <div aria-hidden="true" className={exportNotice.kind === 'success' ? 'chat-export-icon success' : 'chat-export-icon error'}>
                  {exportNotice.kind === 'success' ? '✓' : '!'}
                </div>
                <h2>{exportNotice.kind === 'success' ? 'Word 已导出成功' : 'Word 导出失败'}</h2>
                <p>{exportNotice.kind === 'success' ? '文件已保存到下载目录。' : '请稍后重试。'}</p>
                {exportNotice.kind === 'success' && exportNotice.fileName ? (
                  <p className="chat-export-file-name" title={exportNotice.fileName}>
                    {exportNotice.fileName}
                  </p>
                ) : null}
                {exportNotice.kind === 'success' && (exportNotice.copyStatus || exportNotice.openStatus) ? (
                  <p className="chat-export-feedback" role="status">
                    {exportNotice.copyStatus || exportNotice.openStatus}
                  </p>
                ) : null}
                <div className="chat-export-dialog-actions">
                  {exportNotice.kind === 'success' && exportNotice.path ? (
                    <>
                      <button onClick={() => void openExportFile()} type="button">
                        打开文件
                      </button>
                      <button onClick={() => void copyExportPath()} type="button">
                        复制路径
                      </button>
                    </>
                  ) : null}
                  <button
                    className={exportNotice.kind === 'success' ? 'primary' : ''}
                    onClick={() => setExportNotice(null)}
                    type="button"
                  >
                    关闭
                  </button>
                </div>
              </section>
            </div>
          ) : null}
          {pendingUploadFiles.length ? (
            <div aria-label="上传资料" className="chat-upload-dialog" role="dialog">
              <div className="chat-upload-dialog-card">
                <strong>上传资料</strong>
                <p>已选择 {pendingUploadFiles.length} 个文件：</p>
                {pendingUploadFiles.map((file) => (
                  <p key={`${file.name}-${file.size}-${file.lastModified}`} role="note">{file.name}：{uploadFileHint(file)}</p>
                ))}
                <p>
                  你上传的个人资料仅供你本人使用，不会进入公司知识库。
                  提交管理员审核通过后，才可能成为正式知识来源。
                </p>
                <fieldset>
                  <legend>上传用途</legend>
                  <label>
                    <input
                      disabled={uploading}
                      checked={uploadPurpose === 'session_attachment'}
                      name="upload-purpose"
                      onChange={() => setUploadPurpose('session_attachment')}
                      type="radio"
                    />
                    仅用于当前任务
                  </label>
                  <label>
                    <input
                      disabled={uploading}
                      checked={uploadPurpose === 'personal_reference'}
                      name="upload-purpose"
                      onChange={() => setUploadPurpose('personal_reference')}
                      type="radio"
                    />
                    保存到我的资料
                  </label>
                  <label>
                    <input
                      disabled={uploading}
                      checked={uploadPurpose === 'submit_review'}
                      name="upload-purpose"
                      onChange={() => setUploadPurpose('submit_review')}
                      type="radio"
                    />
                    提交管理员审核
                  </label>
                </fieldset>
                <div className="chat-upload-meta-grid">
                  <label>
                    资料分类
                    <select
                      aria-label="资料分类"
                      disabled={uploading || uploadPurpose === 'session_attachment'}
                      onChange={(event) => setUploadCategory(event.target.value)}
                      value={uploadPurpose === 'session_attachment' ? '当前附件' : uploadCategory}
                    >
                      {uploadPurpose === 'session_attachment' ? (
                        <option value="当前附件">当前附件</option>
                      ) : uploadCategoryOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    文档类型
                    <select
                      aria-label="文档类型"
                      disabled={uploading}
                      onChange={(event) => setUploadDocumentType(event.target.value)}
                      value={uploadDocumentType}
                    >
                      {uploadDocumentTypeOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {uploadStatus ? (
                  <p className="chat-upload-dialog-status" role="status">{uploadStatus}</p>
                ) : null}
                <div className="chat-message-actions">
                  <button disabled={uploading} onClick={() => setPendingUploadFiles([])} type="button">
                    取消
                  </button>
                  <button disabled={uploading} onClick={() => void uploadKnowledge()} type="button">
                    {uploading ? (
                      <><span aria-hidden="true" className="upload-parsing-spinner" />正在解析中</>
                    ) : `开始上传（${pendingUploadFiles.length}）`}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {sensitiveConfirmation ? (
            <SensitiveWarningDialog
              findings={sensitiveConfirmation.findings}
              onCancel={() => setSensitiveConfirmation(null)}
              onConfirm={() => {
                const pending = sensitiveConfirmation;
                setSensitiveConfirmation(null);
                void send(pending.question, pending.digest);
              }}
            />
          ) : null}
          {longTasks.length ? (
            <aside aria-label="后台任务" className="chat-long-task-tray" role="region">
              <div className="chat-long-task-head">
                <strong>后台任务</strong>
                <span>{longTasks.filter((task) => task.cancel_allowed).length} 个处理中</span>
              </div>
              <div className="chat-long-task-list">
                {longTasks.slice(0, 3).map((task) => (
                  <article className="chat-long-task-item" key={task.task_id}>
                    <div className="chat-long-task-title">
                      <strong title={task.title}>{task.title}</strong>
                      <span>{longTaskStatusLabels[task.status]}</span>
                    </div>
                    <progress aria-label={`${task.title}进度`} max={100} value={task.progress} />
                    {task.error_message ? <p className="chat-long-task-error">{task.error_message}</p> : null}
                    {task.draft ? <p className="chat-long-task-draft">{task.draft}</p> : null}
                    <div className="chat-long-task-actions">
                      {task.draft ? (
                        <button
                          onClick={() => void navigator.clipboard?.writeText(task.draft)}
                          type="button"
                        >
                          复制草稿
                        </button>
                      ) : null}
                      {task.retry_allowed ? (
                        <button onClick={() => void retryBackgroundTask(task.task_id)} type="button">重试</button>
                      ) : null}
                      {task.cancel_allowed ? (
                        <button onClick={() => void cancelBackgroundTask(task.task_id)} type="button">取消</button>
                      ) : null}
                      {task.status === 'completed' ? (
                        <button onClick={() => void loadSession(task.conversation_id)} type="button">查看结果</button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </section>
  );
}

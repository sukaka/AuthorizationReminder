import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';

import {
  archiveChatSession,
  bulkArchiveChatSessions,
  bulkDeleteChatSessions,
  completeChatMessage,
  confirmWebCapture,
  deleteChatSession,
  exportChatWord,
  getChatSession,
  getChatSessionsByKind,
  hardDeleteChatSession,
  listKnowledgeCategories,
  listKnowledgeDocumentTypes,
  prepareChat,
  previewWebCapture,
  previewKnowledgeFile,
  renameChatSession,
  restoreChatSession,
  type ChatCitation,
  type ChatExportType,
  type ChatMode,
  type ChatSessionListKind,
  type ChatSessionPayload,
  type KnowledgeCategoryPayload,
  type KnowledgeDocumentTypePayload,
  type KnowledgeFilePreviewPayload,
  type WebCapturePreviewPayload,
  uploadKnowledgeFile,
} from '../api/chat';
import {
  checkLoopQuality,
  shouldRunLoopQualityCheck,
  type AgentLoopMessage,
} from '../api/agentLoop';
import { ApiError } from '../api/client';
import { generateLocalModel } from '../local/modelStream';
import type { ModelProfile } from '../types/tauri';

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitation[];
  isComplete?: boolean;
};

type GeneratedModelResult = Awaited<ReturnType<typeof generateLocalModel>>;

type SourcePreviewState =
  | { status: 'idle' }
  | { status: 'loading'; citation: ChatCitation }
  | { status: 'ready'; citation: ChatCitation; preview: KnowledgeFilePreviewPayload }
  | { status: 'error'; citation: ChatCitation; message: string };

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
const supportedKnowledgeAccept = '.pdf,.txt,.md,.docx,.xlsx,.pptx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation';
const unsupportedKnowledgeTypeMessage = '当前版本暂不支持该文件类型，请上传 pdf、docx、xlsx、pptx、txt 或 md 文件。';
const pdfUploadHint = 'PDF 会按页面提取可复制文本，扫描件需要先转成可复制文本。';
const fallbackUploadCategories = ['个人素材', '会议纪要', '项目交付', '销售商务', '安全运维', '模板范本', '其他'];
const fallbackUploadDocumentTypes = ['会议纪要', '解决方案', '投标模板', '管理员手册', '培训材料', '验收报告', '检查记录', '其他'];

const exportTypeLabels: Record<(typeof wordExportTypes)[number], string> = {
  single_answer: '仅导出本次生成内容',
  formal_document: '导出聚信格式 Word',
};

const webUrlPattern = /https?:\/\/[^\s<>'"，。；;、）)】]+/i;

function extractFirstWebUrl(value: string): string {
  return webUrlPattern.exec(value)?.[0] || '';
}

function uploadFileHint(file: File | null): string {
  if (!file) return '';
  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex + 1).trim().toLowerCase() : '';
  if (extension === 'pdf') return pdfUploadHint;
  if (extension === 'csv' || extension === 'doc' || extension === 'xls' || ['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    return unsupportedKnowledgeTypeMessage;
  }
  if (extension === 'xlsx') return 'Excel 会按 Sheet、表头和行记录解析。';
  if (extension === 'pptx') return 'PPT 会按幻灯片标题、正文和备注解析。';
  return '当前支持 pdf、docx、xlsx、pptx、txt、md；扫描件需要先转成可复制文本。';
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
    if (citation.source_type === 'web_search_context') return true;
    return citationMatchCandidates(citation.file_name).some((candidate) => normalizedAnswer.includes(candidate));
  });
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

function apiErrorDetail(error: unknown): string {
  if (!(error instanceof ApiError)) return '';
  const payload = error.payload as { detail?: unknown } | undefined;
  return typeof payload?.detail === 'string' ? payload.detail : '';
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

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop()?.trim() || 'Word 文档';
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

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.length ? nodes : [text];
}

function renderChatContent(content: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (!listType || !listItems.length) return;
    const renderedItems = listItems.map((item, itemIndex) => (
      <li key={`${listType}-${blocks.length}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
    ));
    blocks.push(listType === 'ol'
      ? <ol key={`ol-${blocks.length}`}>{renderedItems}</ol>
      : <ul key={`ul-${blocks.length}`}>{renderedItems}</ul>);
    listType = null;
    listItems = [];
  };

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const headingContent = renderInlineMarkdown(heading[2]);
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
    blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(trimmed)}</p>);
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
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadPurpose, setUploadPurpose] = useState<UploadPurpose>('personal_reference');
  const [uploadCategory, setUploadCategory] = useState('个人素材');
  const [uploadDocumentType, setUploadDocumentType] = useState('其他');
  const [knowledgeCategories, setKnowledgeCategories] = useState<KnowledgeCategoryPayload[]>([]);
  const [knowledgeDocumentTypes, setKnowledgeDocumentTypes] = useState<KnowledgeDocumentTypePayload[]>([]);
  const [referenceScope, setReferenceScope] = useState<ReferenceScope>('official_only');
  const [enabledReferenceFiles, setEnabledReferenceFiles] = useState<EnabledReferenceFile[]>([]);
  const [exportType, setExportType] = useState<ChatExportType>('single_answer');
  const [exportNotice, setExportNotice] = useState<WordExportNotice | null>(null);
  const [exportingWord, setExportingWord] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewState>({ status: 'idle' });
  const [webCapture, setWebCapture] = useState<WebCaptureState>({ status: 'idle' });
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const refreshSessions = async (kind: ChatSessionListKind = sessionListKind) => {
    const payload = await getChatSessionsByKind(kind);
    setSessions(payload.items);
    const visibleIds = new Set(payload.items.map((item) => item.session_uuid));
    setSelectedSessionIds((current) => current.filter((id) => visibleIds.has(id)));
  };

  useEffect(() => {
    setSelectedSessionIds([]);
    refreshSessions(sessionListKind)
      .catch(() => setStatus('聊天历史加载失败'));
    invoke<ModelProfile[]>('model_profile_list')
      .then((payload) => setProfiles(Array.isArray(payload) ? payload : []))
      .catch(() => setProfiles([]));
  }, [sessionListKind]);

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

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.isDefault && profile.hasApiKey)
      ?? profiles.find((profile) => profile.hasApiKey),
    [profiles],
  );
  const sessionAttachmentFiles = useMemo(
    () => enabledReferenceFiles.filter((file) => file.sourceKind === 'session_attachment'),
    [enabledReferenceFiles],
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
    setStatus('正在加载历史任务…');
    try {
      const detail = await getChatSession(sessionUuid);
      setActiveSessionUuid(detail.session_uuid);
      setActiveSessionStatus(normalizeSessionStatus(detail.status));
      setMode(normalizeMode(detail.mode));
      setSourcePreview({ status: 'idle' });
      setWebCapture({ status: 'idle' });
      setEnabledReferenceFiles([]);
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
      setStatus('历史任务加载失败');
    }
  };

  const uploadKnowledge = async () => {
    if (!pendingUploadFile || uploading) return;
    if (uploadPurpose === 'session_attachment' && !activeSessionUuid) {
      setUploadStatus('请先开启一个任务，再上传当前附件');
      return;
    }
    setUploading(true);
    setUploadStatus('正在上传资料…');
    try {
      const uploaded = await uploadKnowledgeFile(pendingUploadFile, {
        usageType: uploadPurpose === 'session_attachment' ? 'session_attachment' : 'personal_reference',
        reviewStatus: uploadPurpose === 'submit_review' ? 'pending' : 'draft',
        conversationId: uploadPurpose === 'session_attachment' ? activeSessionUuid : undefined,
        category: uploadPurpose === 'session_attachment' ? '当前附件' : uploadCategory,
        documentType: uploadDocumentType,
        tags: [],
      });
      setPendingUploadFile(null);
      if (uploadPurpose === 'submit_review') {
        setUploadStatus(`资料已提交管理员审核：${uploaded.file_name}`);
      } else if (uploadPurpose === 'session_attachment') {
        setEnabledReferenceFiles((current) => current
          .filter((file) => file.fileUuid !== uploaded.file_uuid)
          .concat({
            fileUuid: uploaded.file_uuid,
            fileName: uploaded.file_name,
            sourceKind: 'session_attachment',
          }));
        setMode('knowledge');
        setReferenceScope((current) => (
          current === 'with_personal' || current === 'personal_and_session'
            ? 'personal_and_session'
            : 'with_session'
        ));
        setUploadStatus('');
      } else {
        setUploadStatus(`资料已保存到我的资料：${uploaded.file_name}；需要参考时可在“参考资料”中选择“我的资料”。`);
      }
    } catch (error) {
      setUploadStatus(uploadFailureMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const enableOfficialKnowledgeScope = () => {
    setMode('knowledge');
    setReferenceScope('official_only');
  };

  const togglePersonalReferenceScope = () => {
    setMode('knowledge');
    setReferenceScope((current) => {
      if (current === 'with_personal') return 'official_only';
      if (current === 'with_session') return 'personal_and_session';
      if (current === 'personal_and_session') return 'with_session';
      return 'with_personal';
    });
  };

  const removeEnabledReferenceFile = (file: EnabledReferenceFile) => {
    setEnabledReferenceFiles((current) => current.filter((item) => item.fileUuid !== file.fileUuid));
    setReferenceScope((current) => disableReferenceKind(current, file.sourceKind));
  };

  const toggleSessionAttachmentScope = () => {
    if (!sessionAttachmentFiles.length) {
      setUploadStatus('请先上传附件后再使用当前附件作为参考。');
      return;
    }
    setMode('knowledge');
    setReferenceScope((current) => {
      if (current === 'with_session') return 'official_only';
      if (current === 'with_personal') return 'personal_and_session';
      if (current === 'personal_and_session') return 'with_personal';
      return 'with_session';
    });
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

  const send = async (questionOverride?: string) => {
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
    if (!activeProfile && mode !== 'knowledge') {
      setStatus('请先完成模型设置');
      return;
    }
    shouldStickToBottomRef.current = true;
    setStatus(mode === 'knowledge' ? '检索中…' : '生成中…');
    setQuestion('');
      setMessages((current) => current.concat({
        id: `local-user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        citations: [],
        isComplete: true,
      }));
    try {
      const prepared = await prepareChat({
        sessionUuid: activeSessionUuid || undefined,
        question: trimmed,
        mode,
        attachmentFileIds: sessionAttachmentFiles.map((file) => file.fileUuid),
        includePersonalReferences: referenceScope === 'with_personal' || referenceScope === 'personal_and_session',
        includeSessionAttachments: referenceScope === 'with_session' || referenceScope === 'personal_and_session',
      });
      setActiveSessionUuid(prepared.session_uuid);
      setActiveSessionStatus('active');
      if (prepared.completed) {
        setMessages((current) => current.concat({
          id: prepared.assistant_message_uuid,
          role: 'assistant',
          content: prepared.answer,
          citations: filterCitationsByAnswer(prepared.citations, prepared.answer),
          isComplete: true,
        }));
        setStatus('');
        return;
      }
      if (!activeProfile) {
        setStatus('请先完成模型设置');
        return;
      }
      const assistantId = prepared.assistant_message_uuid;
      setMessages((current) => current.concat({
        id: assistantId,
        role: 'assistant',
        content: '',
        citations: [],
        isComplete: false,
      }));
      let result: GeneratedModelResult = await generateLocalModel({
        profileId: activeProfile.id,
        messages: prepared.messages,
        temperature: activeProfile.temperature,
        requestId: `chat-${assistantId}`,
      }, (delta) => {
        setMessages((current) => current.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + delta }
            : message,
        ));
      });
      setMessages((current) => current.map((message) =>
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
          setStatus('正在自检并修正…');
          result = await generateLocalModel({
            profileId: activeProfile.id,
            messages: check.revision_messages,
            temperature: activeProfile.temperature,
            requestId: `chat-${assistantId}-revise-${retryCount + 1}`,
          }, (delta) => {
            setMessages((current) => current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + delta }
                : message,
            ));
          });
          setMessages((current) => current.map((message) =>
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
      await completeChatMessage(assistantId, {
        completionToken: prepared.completion_token,
        answer: result.output,
        modelDisplayName: activeProfile.displayName,
        modelId: activeProfile.modelId,
        usage: result.usage,
        latencyMs: result.latencyMs,
      });
      setMessages((current) => current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: result.output,
              citations: filterCitationsByAnswer(prepared.citations, result.output),
              isComplete: true,
            }
          : message,
      ));
      refreshSessions(sessionListKind).catch(() => undefined);
      setStatus('');
    } catch (error) {
      const detail = apiErrorDetail(error);
      if (detail.includes('已归档')) setActiveSessionStatus('archived');
      if (detail.includes('已删除')) setActiveSessionStatus('deleted');
      setStatus(detail || '内容生成失败，请稍后重试');
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
      await invoke('generation_word_open', { path: exportNotice.path });
      setExportNotice({ ...exportNotice, openStatus: '正在打开文件…', copyStatus: '' });
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

  const startNewSession = () => {
    setActiveSessionUuid('');
    setActiveSessionStatus('');
    setSessionListKind('active');
    setSelectedSessionIds([]);
    setMessages([]);
    setSourcePreview({ status: 'idle' });
    setWebCapture({ status: 'idle' });
    setPendingUploadFile(null);
    setEnabledReferenceFiles([]);
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
          <strong>历史任务</strong>
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
              <label className="chat-mode-select">
                <span>参考资料</span>
                <select
                  aria-label="参考资料"
                  onChange={(event) => setReferenceScope(event.target.value as ReferenceScope)}
                  value={referenceScope}
                >
                  {Object.entries(referenceScopeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
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
              <button className="chat-new-button" onClick={startNewSession} type="button">
                开启新任务
              </button>
            </div>
          </div>

          <header className="chat-hero">
            <h2>告诉我你想完成什么工作</h2>
            <p>我是你的私人工作助理，可以帮你写、查、整理、生成和导出工作成果。</p>
          </header>

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
                  ? filterCitationsByAnswer(message.citations, message.content)
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
                          ? renderChatContent(message.content)
                          : <p>{message.content || '正在生成…'}</p>}
                      </div>
                      {citationReferences.length ? (
                        <details className="chat-citations">
                          <summary>引用文件 {citationReferences.length} 个</summary>
                          <ul aria-label="引用文件">
                            {citationReferences.map((reference) => (
                              <li key={reference.key}>
                                <span className={`chat-citation-source ${reference.sourceClassName}`}>
                                  {reference.sourceLabel}
                                </span>
                                {reference.citation.file_uuid ? (
                                  <button
                                    className="chat-citation-button"
                                    onClick={() => void openSourcePreview(reference.citation)}
                                    type="button"
                                  >
                                    {reference.label}
                                  </button>
                                ) : (
                                  <span>{reference.label}</span>
                                )}
                                {reference.locations.length ? (
                                  <ul aria-label={`${reference.label} 引用位置`} className="chat-citation-locations">
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
                          <button onClick={() => void copyMessage(message.content)} type="button">
                            复制
                          </button>
                          <button onClick={() => regenerateMessage(message.id)} type="button">
                            重新生成
                          </button>
                          <button disabled={exportingWord} onClick={() => void exportMessageWord(message)} type="button">
                            {exportingWord ? '导出中…' : '导出 Word'}
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
              <aside aria-label="来源预览" className="chat-source-preview" role="region">
                <div className="chat-source-preview-header">
                  <strong>来源预览</strong>
                  <button onClick={() => setSourcePreview({ status: 'idle' })} type="button">
                    关闭
                  </button>
                </div>
                {sourcePreview.status === 'loading' ? (
                  <p>正在打开来源片段…</p>
                ) : null}
                {sourcePreview.status === 'error' ? (
                  <p role="status">{sourcePreview.message}</p>
                ) : null}
                {sourcePreview.status === 'ready' ? (
                  <div className="chat-source-preview-body">
                    <h3>{sourcePreview.preview.file_name}</h3>
                    <p>{sourcePreview.preview.notice}</p>
                    {sourcePreview.preview.chunks.map((chunk) => (
                      <article key={chunk.chunk_id} className="chat-source-preview-chunk">
                        <strong>
                          {chunkReferenceTitle(chunk)}
                        </strong>
                        <p>{chunk.text}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </aside>
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
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setPendingUploadFile(file);
                      setUploadPurpose('personal_reference');
                      setUploadStatus('');
                      event.target.value = '';
                    }}
                    type="file"
                  />
                </label>
                <button
                  aria-pressed={mode === 'knowledge' && referenceScope === 'official_only'}
                  className="chat-reference-chip"
                  onClick={enableOfficialKnowledgeScope}
                  type="button"
                >
                  查公司知识
                </button>
                <button
                  aria-pressed={referenceScope === 'with_personal' || referenceScope === 'personal_and_session'}
                  className="chat-reference-chip"
                  onClick={togglePersonalReferenceScope}
                  type="button"
                >
                  我的资料
                </button>
                <button
                  aria-pressed={referenceScope === 'with_session' || referenceScope === 'personal_and_session'}
                  className="chat-reference-chip"
                  disabled={!sessionAttachmentFiles.length}
                  onClick={toggleSessionAttachmentScope}
                  type="button"
                >
                  当前附件
                </button>
                <span className="chat-mode-pill">{modeLabels[mode]}</span>
                <span className="chat-model-pill">当前设置：{activeProfile?.displayName || '未配置'}</span>
                <button
                  aria-label="发送"
                  className="chat-send-button"
                  disabled={!question.trim() || Boolean(composerDisabledReason)}
                  type="submit"
                >
                  ↑
                </button>
              </div>
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
          {pendingUploadFile ? (
            <div aria-label="上传资料" className="chat-upload-dialog" role="dialog">
              <div className="chat-upload-dialog-card">
                <strong>上传资料</strong>
                <p>文件：{pendingUploadFile.name}</p>
                <p role="note">{uploadFileHint(pendingUploadFile)}</p>
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
                  <button disabled={uploading} onClick={() => setPendingUploadFile(null)} type="button">
                    取消
                  </button>
                  <button disabled={uploading} onClick={() => void uploadKnowledge()} type="button">
                    {uploading ? '上传中…' : '开始上传'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';

import {
  archiveChatSession,
  bulkArchiveChatSessions,
  bulkDeleteChatSessions,
  completeChatMessage,
  deleteChatSession,
  exportChatWord,
  getChatSession,
  getChatSessionsByKind,
  hardDeleteChatSession,
  prepareChat,
  previewKnowledgeFile,
  renameChatSession,
  restoreChatSession,
  type ChatCitation,
  type ChatExportType,
  type ChatMode,
  type ChatSessionListKind,
  type ChatSessionPayload,
  type KnowledgeFilePreviewPayload,
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
};

type GeneratedModelResult = Awaited<ReturnType<typeof generateLocalModel>>;

type SourcePreviewState =
  | { status: 'idle' }
  | { status: 'loading'; citation: ChatCitation }
  | { status: 'ready'; citation: ChatCitation; preview: KnowledgeFilePreviewPayload }
  | { status: 'error'; citation: ChatCitation; message: string };

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

const exportTypeLabels: Record<(typeof wordExportTypes)[number], string> = {
  single_answer: '仅导出本次生成内容',
  formal_document: '导出聚信格式 Word',
};

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

const enabledReferenceLabels: Record<EnabledReferenceFile['sourceKind'], string> = {
  personal_reference: '我的资料',
  session_attachment: '当前附件',
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

function citationLabel(citation: ChatCitation): string {
  const locationParts = [
    citation.page_number ? `第 ${citation.page_number} 页` : '',
    citation.section_title || '',
  ].filter(Boolean);
  const location = locationParts.length ? locationParts.join('，') : '未识别章节';
  const sourceKind = citation.source_type === 'official_knowledge' || citation.source_type === 'knowledge_file'
    ? '来源：公司知识库 / 正式知识来源'
    : citation.source_type === 'personal_reference'
      ? '参考资料：我的上传文件，仅用于本次内容生成'
      : citation.source_type === 'session_attachment'
        ? '参考资料：当前附件'
        : '知识来源';
  return `${citation.file_name || '知识来源'} / ${sourceKind} / ${location}`;
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
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadPurpose, setUploadPurpose] = useState<UploadPurpose>('personal_reference');
  const [referenceScope, setReferenceScope] = useState<ReferenceScope>('official_only');
  const [enabledReferenceFiles, setEnabledReferenceFiles] = useState<EnabledReferenceFile[]>([]);
  const [exportType, setExportType] = useState<ChatExportType>('single_answer');
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewState>({ status: 'idle' });
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

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.isDefault && profile.hasApiKey)
      ?? profiles.find((profile) => profile.hasApiKey),
    [profiles],
  );
  const visibleReferenceFiles = useMemo(
    () => enabledReferenceFiles.filter((file) => referenceScopeIncludes(referenceScope, file.sourceKind)),
    [enabledReferenceFiles, referenceScope],
  );

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
      setEnabledReferenceFiles([]);
      shouldStickToBottomRef.current = true;
      setMessages(detail.messages.map((message) => ({
        id: message.message_uuid,
        role: message.role,
        content: message.content,
        citations: message.citations,
      })));
      setStatus('');
    } catch {
      setStatus('历史任务加载失败');
    }
  };

  const uploadKnowledge = async () => {
    if (!pendingUploadFile) return;
    if (uploadPurpose === 'session_attachment' && !activeSessionUuid) {
      setUploadStatus('请先开启一个任务，再上传当前附件');
      return;
    }
    setUploadStatus('正在上传资料…');
    try {
      const uploaded = await uploadKnowledgeFile(pendingUploadFile, {
        usageType: uploadPurpose === 'session_attachment' ? 'session_attachment' : 'personal_reference',
        reviewStatus: uploadPurpose === 'submit_review' ? 'pending' : 'draft',
        conversationId: uploadPurpose === 'session_attachment' ? activeSessionUuid : undefined,
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
        setUploadStatus(`当前附件已上传：${uploaded.file_name}；本次任务已启用“当前附件”参考。`);
      } else {
        setEnabledReferenceFiles((current) => current
          .filter((file) => file.fileUuid !== uploaded.file_uuid)
          .concat({
            fileUuid: uploaded.file_uuid,
            fileName: uploaded.file_name,
            sourceKind: 'personal_reference',
          }));
        setMode('knowledge');
        setReferenceScope((current) => (
          current === 'with_session' || current === 'personal_and_session'
            ? 'personal_and_session'
            : 'with_personal'
        ));
        setUploadStatus(`资料已保存到我的资料：${uploaded.file_name}；本次任务已启用“我的资料”参考。`);
      }
    } catch {
      setUploadStatus('资料上传失败，请稍后重试');
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
    setMode('knowledge');
    setReferenceScope((current) => {
      if (current === 'with_session') return 'official_only';
      if (current === 'with_personal') return 'personal_and_session';
      if (current === 'personal_and_session') return 'with_personal';
      return 'with_session';
    });
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
    if (!activeProfile && mode !== 'knowledge') {
      setStatus('请先配置个人模型');
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
    }));
    try {
      const prepared = await prepareChat({
        sessionUuid: activeSessionUuid || undefined,
        question: trimmed,
        mode,
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
          citations: prepared.citations,
        }));
        setStatus('');
        return;
      }
      if (!activeProfile) {
        setStatus('请先配置个人模型');
        return;
      }
      const assistantId = prepared.assistant_message_uuid;
      setMessages((current) => current.concat({
        id: assistantId,
        role: 'assistant',
        content: '',
        citations: prepared.citations,
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
            ? { ...message, content: result.output }
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
              ? { ...message, content: result.output }
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
      setStatus('请先配置个人模型');
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

  const exportMessageWord = async (message: UiMessage) => {
    if (!activeSessionUuid) {
      setStatus('请先完成一次任务后再导出 Word');
      return;
    }
    try {
      setStatus('正在导出 Word…');
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
      setStatus(result.kind === 'desktop' ? `Word 已保存到：${result.path}` : 'Word 已开始下载');
    } catch {
      setStatus('Word 导出失败，请稍后重试');
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
      setStatus('正在导出 Word…');
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
      setStatus(result.kind === 'desktop' ? `Word 已保存到：${result.path}` : 'Word 已开始下载');
    } catch {
      setStatus('Word 导出失败，请稍后重试');
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
    if (!window.confirm(`彻底删除“${session.title}”？此操作不可恢复。`)) return;
    await runSessionAction(
      () => hardDeleteChatSession(session.session_uuid),
      '任务已彻底删除',
      sessionListKind,
      session.session_uuid,
      'deleted',
    );
    if (session.session_uuid === activeSessionUuid) {
      setActiveSessionUuid('');
      setActiveSessionStatus('');
      setMessages([]);
      setEnabledReferenceFiles([]);
    }
  };

  const exportSessionWord = async (session: ChatSessionPayload) => {
    try {
      setStatus('正在导出 Word…');
      const result = await exportChatWord({
        conversationId: session.session_uuid,
        exportType: 'full_conversation',
      });
      setStatus(result.kind === 'desktop' ? `Word 已保存到：${result.path}` : 'Word 已开始下载');
    } catch {
      setStatus('Word 导出失败，请稍后重试');
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
  const selectedSessionSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds]);

  const handleComposerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
          {sessions.map((session) => (
            <div
              className={activeSessionUuid === session.session_uuid ? 'is-active' : ''}
              key={session.session_uuid}
              data-session-status={normalizeSessionStatus(session.status)}
            >
              {normalizeSessionStatus(session.status) !== 'deleted' ? (
                <label className="chat-session-select">
                  <input
                    aria-label={`选择任务：${session.title}`}
                    checked={selectedSessionSet.has(session.session_uuid)}
                    onChange={(event) => toggleSessionSelection(session.session_uuid, event.target.checked)}
                    type="checkbox"
                  />
                  <span>选择</span>
                </label>
              ) : null}
              <button
                aria-label={session.title}
                type="button"
                onClick={() => {
                  if (normalizeSessionStatus(session.status) === 'deleted') {
                    setStatus('已删除任务需要先恢复后查看');
                    return;
                  }
                  void loadSession(session.session_uuid);
                }}
              >
                {session.title}
                <small>{modeLabels[normalizeMode(session.mode)]}</small>
              </button>
              <div className="chat-session-actions">
                {normalizeSessionStatus(session.status) === 'active' ? (
                  <>
                    <button
                      aria-label={`重命名：${session.title}`}
                      onClick={() => void renameSession(session)}
                      type="button"
                    >
                      重命名
                    </button>
                    <button
                      aria-label={`归档：${session.title}`}
                      onClick={() => void archiveSession(session)}
                      type="button"
                    >
                      归档
                    </button>
                    <button
                      aria-label={`删除：${session.title}`}
                      onClick={() => void softDeleteSession(session)}
                      type="button"
                    >
                      删除
                    </button>
                    <button
                      aria-label={`导出 Word：${session.title}`}
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
                      aria-label={`恢复：${session.title}`}
                      onClick={() => void restoreSession(session)}
                      type="button"
                    >
                      恢复
                    </button>
                    <button
                      aria-label={`删除：${session.title}`}
                      onClick={() => void softDeleteSession(session)}
                      type="button"
                    >
                      删除
                    </button>
                    <button
                      aria-label={`导出 Word：${session.title}`}
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
                      aria-label={`恢复：${session.title}`}
                      onClick={() => void restoreSession(session)}
                      type="button"
                    >
                      恢复
                    </button>
                    <button
                      aria-label={`彻底删除：${session.title}`}
                      onClick={() => void hardDeleteSession(session)}
                      type="button"
                    >
                      彻底删除
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
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
                disabled={!activeSessionUuid || !messages.length}
                onClick={() => void exportLatestAnswerWord()}
                type="button"
              >
                导出工作成果
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
                      '整理项目复盘成果',
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
              {messages.map((message) => (
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
                    {message.citations.length ? (
                      <details className="chat-citations" open>
                        <summary>参考来源 {message.citations.length} 条</summary>
                        <ul aria-label="参考来源">
                          {message.citations.map((citation, citationIndex) => (
                            <li key={`${citation.chunk_id}-${citation.file_name}-${citationIndex}`}>
                              {citation.file_uuid ? (
                                <button
                                  className="chat-citation-button"
                                  onClick={() => void openSourcePreview(citation)}
                                  type="button"
                                >
                                  {citationLabel(citation)}
                                </button>
                              ) : (
                                <span>{citationLabel(citation)}</span>
                              )}
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
                        <button onClick={() => void exportMessageWord(message)} type="button">
                          导出 Word
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
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
                          {chunk.section_title || '未识别章节'}
                          {chunk.page_number ? ` · 第 ${chunk.page_number} 页` : ''}
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
            <form aria-label="对话输入区" className="chat-composer" onSubmit={handleComposerSubmit}>
              <textarea
                aria-label="告诉小聚你要完成什么"
                disabled={Boolean(composerDisabledReason)}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="告诉小聚你要完成什么…"
                value={question}
              />
              <div className="chat-composer-toolbar">
                <label className="chat-file-trigger">
                  <span>＋ 上传附件</span>
                  <input
                    aria-label="上传知识文件"
                    accept=".txt,.md,.docx,.pdf,.xlsx,.csv,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setPendingUploadFile(file);
                      setUploadPurpose('personal_reference');
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
                  知识库
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
                  onClick={toggleSessionAttachmentScope}
                  type="button"
                >
                  当前附件
                </button>
                <span className="chat-mode-pill">{modeLabels[mode]}</span>
                <span className="chat-model-pill">模型：{activeProfile?.displayName || '未配置'}</span>
                <button
                  aria-label="发送"
                  className="chat-send-button"
                  disabled={!question.trim() || Boolean(composerDisabledReason)}
                  type="submit"
                >
                  ↑
                </button>
              </div>
              {mode === 'knowledge' ? (
                <p className="chat-composer-hint">
                  知识库问答默认只检索正式知识库；选择“我的资料”或“当前附件”后，会作为非正式参考资料加入本次上下文。
                </p>
              ) : null}
              {visibleReferenceFiles.length ? (
                <section aria-label="当前可引用资料" className="chat-reference-files">
                  <strong>当前可引用资料</strong>
                  <ul>
                    {visibleReferenceFiles.map((file) => (
                      <li key={file.fileUuid}>
                        <span>{file.fileName}</span>
                        <span>{enabledReferenceLabels[file.sourceKind]}</span>
                        <button
                          aria-label={`关闭引用：${file.fileName}`}
                          onClick={() => removeEnabledReferenceFile(file)}
                          type="button"
                        >
                          关闭引用
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p>这些资料只作为本次对话的非正式参考，不会进入公司正式知识库。</p>
                </section>
              ) : null}
              {composerDisabledReason ? <p className="chat-status" role="status">{composerDisabledReason}</p> : null}
              {uploadStatus ? <p className="chat-composer-hint" role="status">{uploadStatus}</p> : null}
              {status ? <p className="chat-status" role="status">{status}</p> : null}
            </form>
          </div>
          {pendingUploadFile ? (
            <div aria-label="上传资料" className="chat-upload-dialog" role="dialog">
              <div className="chat-upload-dialog-card">
                <strong>上传资料</strong>
                <p>文件：{pendingUploadFile.name}</p>
                <p>
                  你上传的个人资料仅供你本人使用，不会进入公司正式知识库。
                  提交管理员审核通过后，才可能成为正式知识库资料。
                </p>
                <fieldset>
                  <legend>上传用途</legend>
                  <label>
                    <input
                      checked={uploadPurpose === 'session_attachment'}
                      name="upload-purpose"
                      onChange={() => setUploadPurpose('session_attachment')}
                      type="radio"
                    />
                    仅用于当前会话
                  </label>
                  <label>
                    <input
                      checked={uploadPurpose === 'personal_reference'}
                      name="upload-purpose"
                      onChange={() => setUploadPurpose('personal_reference')}
                      type="radio"
                    />
                    保存到我的资料
                  </label>
                  <label>
                    <input
                      checked={uploadPurpose === 'submit_review'}
                      name="upload-purpose"
                      onChange={() => setUploadPurpose('submit_review')}
                      type="radio"
                    />
                    提交管理员审核
                  </label>
                </fieldset>
                <div className="chat-message-actions">
                  <button onClick={() => setPendingUploadFile(null)} type="button">
                    取消
                  </button>
                  <button onClick={() => void uploadKnowledge()} type="button">
                    开始上传
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

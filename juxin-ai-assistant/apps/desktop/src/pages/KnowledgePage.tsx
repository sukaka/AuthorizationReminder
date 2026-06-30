import { useEffect, useState } from 'react';

import type { SessionPayload } from '../api/client';
import {
  archiveKnowledgeFile,
  askKnowledgeFile,
  approveKnowledgeFileReview,
  deleteKnowledgeFile,
  disableKnowledgeFileRag,
  enableKnowledgeFileRag,
  exportKnowledgeContentWord,
  hardDeleteKnowledgeFile,
  knowledgeFileDownloadUrl,
  listKnowledgeFileTrash,
  listKnowledgeFiles,
  previewKnowledgeFile,
  rejectKnowledgeFileReview,
  reparseKnowledgeFile,
  restoreKnowledgeFile,
  saveKnowledgeResultToChat,
  searchKnowledge,
  searchPersonalReference,
  summarizeKnowledgeFile,
  submitKnowledgeFileForReview,
  type KnowledgeFileActionPayload,
  type KnowledgeFilePayload,
  type KnowledgeFilePreviewPayload,
  type KnowledgeFileSourcePayload,
  updateKnowledgeFileMetadata,
  uploadKnowledgeFile,
} from '../api/chat';

type KnowledgePageProps = {
  readonly session: SessionPayload;
};

type KnowledgeListMode = 'active' | 'trash';
type KnowledgeSearchScope = 'official' | 'personal';
type KnowledgeUploadPurpose =
  | 'session_attachment'
  | 'personal_reference'
  | 'submit_review'
  | 'official_knowledge';

const generateFromFilePrompt = '请根据这个文档生成一份可直接编辑的工作草稿，保留核心依据、结构化输出，并在末尾标明参考来源。';

const employeeSections = [
  {
    title: '我的资料',
    description: '仅你本人可见的个人参考资料，用于生成文案、方案、纪要和报告草稿。',
  },
  {
    title: '当前附件',
    description: '只在当前会话中使用的临时附件，不进入公司正式知识库。',
  },
  {
    title: '提交审核记录',
    description: '查看你提交给管理员审核的资料状态和处理意见。',
  },
  {
    title: '正式知识库',
    description: '按权限只读查看管理员维护或审核通过的正式资料。',
  },
  {
    title: '文档搜索',
    description: '搜索你有权限访问的正式知识库和个人资料。',
  },
  {
    title: '上传资料',
    description: '上传当前会话附件、保存到我的资料，或提交管理员审核。',
  },
];

const adminSections = [
  {
    title: '正式知识库',
    description: '维护可作为正式 RAG 依据的公司、部门和项目资料。',
  },
  {
    title: '知识库审核',
    description: '审核普通用户提交的资料，决定是否转为正式知识。',
  },
  {
    title: '公司知识库',
    description: '管理公司级产品、方案、手册、模板和交付规范。',
  },
  {
    title: '部门知识库',
    description: '维护商务、售前、交付、安全运维等部门资料。',
  },
  {
    title: '项目知识库',
    description: '管理客户项目范围内可授权检索的资料。',
  },
  {
    title: '文档列表',
    description: '查看文件名、分类、标签、解析、索引、RAG 和审核状态。',
  },
  {
    title: '待审核文档',
    description: '处理用户提交审核的资料，支持通过、驳回和权限设置。',
  },
  {
    title: '回收站',
    description: '恢复已删除文档，彻底删除前必须二次确认。',
  },
  {
    title: '文档上传',
    description: '上传正式资料并设置分类、文档类型、标签、权限和 RAG 范围。',
  },
  {
    title: '分类和标签管理',
    description: '维护知识库分类、文档类型和标签，提升检索命中率。',
  },
];

function canSubmitKnowledgeFileForReview(file: KnowledgeFilePayload, isAdmin: boolean): boolean {
  return !isAdmin
    && file.usage_type === 'personal_reference'
    && !['pending', 'approved', 'official'].includes(file.review_status || 'draft');
}

function canManageKnowledgeFileRag(file: KnowledgeFilePayload, isAdmin: boolean): boolean {
  return isAdmin && file.usage_type === 'official_knowledge';
}

function canReparseKnowledgeFile(file: KnowledgeFilePayload, isAdmin: boolean): boolean {
  return isAdmin && file.usage_type === 'official_knowledge' && file.status === 'READY';
}

function canArchiveKnowledgeFile(file: KnowledgeFilePayload, isAdmin: boolean): boolean {
  return isAdmin && file.usage_type === 'official_knowledge' && file.status === 'READY';
}

function canReviewKnowledgeFile(file: KnowledgeFilePayload, isAdmin: boolean): boolean {
  return isAdmin && file.review_status === 'pending';
}

function canEditKnowledgeFileMetadata(file: KnowledgeFilePayload, isAdmin: boolean): boolean {
  return isAdmin && file.usage_type === 'official_knowledge';
}

function sourceKindLabel(sourceKind: string): string {
  if (sourceKind === 'official_knowledge') return '公司知识库 / 正式知识来源';
  if (sourceKind === 'session_attachment') return '当前会话附件';
  if (sourceKind === 'personal_reference') return '我的上传文件，仅用于本次内容生成';
  return sourceKind || '未知来源';
}

function sourceTypeLabel(sourceType: string): string {
  if (sourceType === 'admin_upload') return '管理员上传';
  if (sourceType === 'user_upload') return '用户上传';
  if (sourceType === 'review_approved') return '审核通过';
  return sourceType || '未知上传来源';
}

function sourceLocation(source: KnowledgeFileSourcePayload): string {
  return [
    source.page_number ? `第 ${source.page_number} 页` : '',
    source.section_title || '',
  ].filter(Boolean).join(' · ');
}

function fileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).trim().toLowerCase() : '';
}

function parseQualityHint(file: File | null): string {
  if (!file) return '';
  const extension = fileExtension(file.name);
  if (extension === 'pdf') {
    return 'PDF 会尝试提取可复制文本；扫描件或图片型 PDF 需要先 OCR，否则解析效果可能较差。';
  }
  if (extension === 'xlsx' || extension === 'csv') {
    return '表格文件会按行解析，尽量保留单元格关系；复杂合并单元格建议先整理后上传。';
  }
  if (extension === 'docx') {
    return 'Word 文档会提取正文和表格内容，复杂页眉页脚或图片文字可能无法完整识别。';
  }
  if (extension === 'txt' || extension === 'md') {
    return '文本文件会按 UTF-8 文本解析，适合作为稳定的个人资料或正式知识来源。';
  }
  return '当前支持 txt、md、docx、pdf、xlsx、csv；解析失败不会影响系统运行。';
}

export function KnowledgePage({ session }: KnowledgePageProps) {
  const role = session.user.role.trim().toLowerCase();
  const isAdmin = role === 'admin';
  const sections = isAdmin ? adminSections : employeeSections;
  const [files, setFiles] = useState<KnowledgeFilePayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<KnowledgeFilePreviewPayload | null>(null);
  const [fileAction, setFileAction] = useState<{
    fileName: string;
    question: string;
    title: string;
    payload: KnowledgeFileActionPayload;
  } | null>(null);
  const [actionNotice, setActionNotice] = useState('');
  const [listMode, setListMode] = useState<KnowledgeListMode>('active');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadPurpose, setUploadPurpose] = useState<KnowledgeUploadPurpose>(
    isAdmin ? 'official_knowledge' : 'personal_reference',
  );
  const [uploadCategory, setUploadCategory] = useState(isAdmin ? '产品资料' : '个人素材');
  const [uploadDocumentType, setUploadDocumentType] = useState(isAdmin ? '产品白皮书' : '个人模板');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadKnowledgeBaseId, setUploadKnowledgeBaseId] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<KnowledgeSearchScope>('official');
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeFileSourcePayload[]>([]);
  const [metadataEdit, setMetadataEdit] = useState<{
    fileUuid: string;
    category: string;
    documentType: string;
    tags: string;
  } | null>(null);
  const [fileQuestions, setFileQuestions] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice('');
    setActionNotice('');
    setPreview(null);
    setFileAction(null);
    const request = listMode === 'trash' ? listKnowledgeFileTrash : listKnowledgeFiles;
    request()
      .then((payload) => {
        if (!active) return;
        setFiles(payload.items);
      })
      .catch(() => {
        if (!active) return;
        setNotice('知识库文档暂时不可用，请稍后重试。');
        setFiles([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listMode]);

  const openPreview = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    setFileAction(null);
    try {
      setPreview(await previewKnowledgeFile(file.file_uuid, { topK: 3 }));
    } catch {
      setActionNotice('暂时无法预览该文档，请稍后重试。');
    }
  };

  const openSourcePreview = async (source: KnowledgeFileSourcePayload) => {
    if (!source.file_id) return;
    setActionNotice('');
    try {
      setPreview(await previewKnowledgeFile(source.file_id, {
        chunkId: source.chunk_id,
        topK: source.chunk_id ? 1 : 3,
      }));
    } catch {
      setActionNotice('暂时无法打开该来源片段，请稍后重试。');
    }
  };

  const summarizeFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    setPreview(null);
    try {
      const payload = await summarizeKnowledgeFile(file.file_uuid);
      setFileAction({
        fileName: file.file_name,
        question: '请总结这个文档',
        title: '文档总结',
        payload,
      });
    } catch {
      setActionNotice('暂时无法总结该文档，请稍后重试。');
    }
  };

  const generateFromFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    setPreview(null);
    try {
      const payload = await askKnowledgeFile(file.file_uuid, generateFromFilePrompt);
      setFileAction({
        fileName: file.file_name,
        question: generateFromFilePrompt,
        title: '文档生成结果',
        payload,
      });
    } catch {
      setActionNotice('暂时无法根据该文档生成内容，请稍后重试。');
    }
  };

  const askFile = async (file: KnowledgeFilePayload) => {
    const question = (fileQuestions[file.file_uuid] || '').trim();
    setActionNotice('');
    if (!question) {
      setActionNotice('请先填写要询问这个文档的问题。');
      return;
    }
    setPreview(null);
    try {
      const payload = await askKnowledgeFile(file.file_uuid, question);
      setFileAction({
        fileName: file.file_name,
        question,
        title: '文档问答结果',
        payload,
      });
    } catch {
      setActionNotice('暂时无法询问该文档，请稍后重试。');
    }
  };

  const exportFileActionWord = async () => {
    if (!fileAction) return;
    const content = fileAction.payload.answer
      || '已准备文档总结上下文，等待模型服务返回正式总结。';
    setActionNotice('正在导出 Word…');
    try {
      const result = await exportKnowledgeContentWord({
        title: `${fileAction.fileName}-${fileAction.title}`,
        content,
        sources: fileAction.payload.sources,
      });
      setActionNotice(result.kind === 'desktop'
        ? `Word 已保存到：${result.path}`
        : 'Word 已开始下载。');
    } catch {
      setActionNotice('Word 导出失败，请稍后重试。');
    }
  };

  const saveFileActionToChat = async () => {
    if (!fileAction) return;
    const answer = fileAction.payload.answer
      || '已准备文档总结上下文，等待模型服务返回正式总结。';
    setActionNotice('正在保存到聊天记录…');
    try {
      await saveKnowledgeResultToChat({
        question: fileAction.question,
        answer,
        mode: 'normal',
        sources: fileAction.payload.sources,
      });
      setActionNotice('已保存到聊天记录。');
    } catch {
      setActionNotice('暂时无法保存到聊天记录，请稍后重试。');
    }
  };

  const downloadFile = (file: KnowledgeFilePayload) => {
    window.open(knowledgeFileDownloadUrl(file.file_uuid), '_blank', 'noopener,noreferrer');
  };

  const deleteFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      await deleteKnowledgeFile(file.file_uuid);
      setFiles((current) => current.filter((item) => item.file_uuid !== file.file_uuid));
      if (preview?.file_uuid === file.file_uuid) setPreview(null);
      if (fileAction?.fileName === file.file_name) setFileAction(null);
    } catch {
      setActionNotice('暂时无法删除该文档，请稍后重试。');
    }
  };

  const archiveFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = await archiveKnowledgeFile(file.file_uuid);
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setActionNotice('已归档该文档，并关闭正式 RAG。');
    } catch {
      setActionNotice('暂时无法归档该文档，请稍后重试。');
    }
  };

  const restoreFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = await restoreKnowledgeFile(file.file_uuid);
      setFiles((current) => (
        listMode === 'trash'
          ? current.filter((item) => item.file_uuid !== file.file_uuid)
          : current.map((item) => (item.file_uuid === file.file_uuid ? updated : item))
      ));
      setActionNotice('已恢复该文档。');
    } catch {
      setActionNotice('暂时无法恢复该文档，请稍后重试。');
    }
  };

  const hardDeleteFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      await hardDeleteKnowledgeFile(file.file_uuid);
      setFiles((current) => current.filter((item) => item.file_uuid !== file.file_uuid));
      if (preview?.file_uuid === file.file_uuid) setPreview(null);
      if (fileAction?.fileName === file.file_name) setFileAction(null);
      setActionNotice('已彻底删除该文档。');
    } catch {
      setActionNotice('暂时无法彻底删除该文档，请稍后重试。');
    }
  };

  const uploadFile = async () => {
    if (!pendingUploadFile) return;
    if (uploadPurpose === 'session_attachment') {
      setUploadStatus('当前会话附件请在聊天窗口上传。');
      return;
    }
    const tags = uploadTags
      .split(/[，,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    setUploadStatus('正在上传资料…');
    try {
      const isOfficial = uploadPurpose === 'official_knowledge';
      const uploaded = await uploadKnowledgeFile(pendingUploadFile, {
        knowledgeBaseId: isOfficial ? uploadKnowledgeBaseId.trim() : undefined,
        usageType: isOfficial ? 'official_knowledge' : 'personal_reference',
        reviewStatus: isOfficial ? 'official' : uploadPurpose === 'submit_review' ? 'pending' : 'draft',
        ragEnabled: isOfficial,
        referenceEnabled: true,
        ragScope: isOfficial ? 'company' : 'personal',
        permissionScope: isOfficial ? 'company' : 'private',
        category: uploadCategory,
        documentType: uploadDocumentType,
        tags,
      });
      setFiles((current) => [uploaded].concat(current));
      setPendingUploadFile(null);
      setUploadStatus(isOfficial
        ? `正式知识已上传：${uploaded.file_name}`
        : `资料已上传：${uploaded.file_name}`);
    } catch {
      setUploadStatus('资料上传失败，请稍后重试。');
    }
  };

  const searchKnowledgeContent = async () => {
    const question = searchQuery.trim();
    setSearchNotice('');
    if (!question) {
      setSearchResults([]);
      setSearchNotice('请输入要搜索的内容。');
      return;
    }
    setSearching(true);
    setPreview(null);
    setFileAction(null);
    try {
      const payload = searchScope === 'official'
        ? await searchKnowledge(question, {
          mode: 'knowledge',
          topK: 8,
          includeSources: true,
        })
        : await searchPersonalReference(question, { topK: 8 });
      setSearchResults(payload.sources);
      if (searchScope === 'official') {
        setSearchNotice(payload.sources.length
          ? `找到 ${payload.total} 条正式知识来源。`
          : '当前正式知识库中未找到匹配内容。');
      } else {
        const personalNotice = 'notice' in payload && typeof payload.notice === 'string'
          ? payload.notice
          : `找到 ${payload.total} 条个人参考资料。`;
        setSearchNotice(payload.sources.length
          ? personalNotice
          : '你的个人参考资料中未找到匹配内容。');
      }
    } catch {
      setSearchResults([]);
      setSearchNotice(searchScope === 'official'
        ? '知识库搜索暂时不可用，请稍后重试。'
        : '个人资料搜索暂时不可用，请稍后重试。');
    } finally {
      setSearching(false);
    }
  };

  const submitReview = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = await submitKnowledgeFileForReview(
        file.file_uuid,
        '用户从桌面端提交管理员审核',
      );
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setActionNotice('已提交管理员审核。');
    } catch {
      setActionNotice('暂时无法提交审核，请稍后重试。');
    }
  };

  const toggleRag = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = file.rag_enabled
        ? await disableKnowledgeFileRag(file.file_uuid)
        : await enableKnowledgeFileRag(file.file_uuid);
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setActionNotice(updated.rag_enabled ? '已启用正式 RAG。' : '已禁用正式 RAG。');
    } catch {
      setActionNotice('暂时无法调整该文档的 RAG 状态，请稍后重试。');
    }
  };

  const approveReview = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = await approveKnowledgeFileReview(file.file_uuid, {
        knowledgeBaseId: file.knowledge_base_id || 'company',
        comment: '管理员从桌面端审核通过',
        permissionScope: 'company',
        ragScope: 'company',
        category: file.category || '',
        documentType: file.document_type || '',
        tags: file.tags ?? [],
      });
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setActionNotice('已审核通过并转为正式知识。');
    } catch {
      setActionNotice('暂时无法审核通过该文档，请稍后重试。');
    }
  };

  const startMetadataEdit = (file: KnowledgeFilePayload) => {
    setMetadataEdit({
      fileUuid: file.file_uuid,
      category: file.category || '',
      documentType: file.document_type || '',
      tags: file.tags?.join(', ') || '',
    });
    setActionNotice('');
  };

  const saveMetadata = async (file: KnowledgeFilePayload) => {
    if (!metadataEdit || metadataEdit.fileUuid !== file.file_uuid) return;
    setActionNotice('');
    try {
      const tags = metadataEdit.tags
        .split(/[，,]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const updated = await updateKnowledgeFileMetadata(file.file_uuid, {
        category: metadataEdit.category,
        documentType: metadataEdit.documentType,
        tags,
      });
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setMetadataEdit(null);
      setActionNotice('已更新分类、文档类型和标签。');
    } catch {
      setActionNotice('暂时无法更新该文档元数据，请稍后重试。');
    }
  };

  const reparseFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = await reparseKnowledgeFile(file.file_uuid);
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setActionNotice('已重新解析并更新切片。');
    } catch {
      setActionNotice('暂时无法重新解析该文档，请稍后重试。');
    }
  };

  const rejectReview = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = await rejectKnowledgeFileReview(
        file.file_uuid,
        '管理员从桌面端审核驳回',
      );
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setActionNotice('已驳回该资料。');
    } catch {
      setActionNotice('暂时无法驳回该文档，请稍后重试。');
    }
  };

  return (
    <section className="section-block" aria-labelledby="knowledge-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{isAdmin ? '管理员知识库' : '个人与正式资料'}</span>
          <h1 id="knowledge-heading">知识库</h1>
          <p>
            {isAdmin
              ? '维护正式知识、审核用户资料，并控制 RAG 权限与生命周期。'
              : '区分当前附件、我的资料和正式知识库，避免个人资料污染公司正式依据。'}
          </p>
        </div>
      </div>
      <div className="assistant-grid">
        {sections.map((section) => (
          <article className="assistant-card" key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.description}</p>
          </article>
        ))}
      </div>
      <section className="section-block" aria-labelledby="knowledge-search-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">正式检索</span>
            <h2 id="knowledge-search-heading">搜索知识资料</h2>
            <p>只检索你有权限访问的正式知识来源；个人资料不会混入公司级 RAG。</p>
          </div>
        </div>
        <article className="history-card">
          <fieldset>
            <legend>搜索范围</legend>
            <label>
              <input
                aria-label="正式知识库"
                checked={searchScope === 'official'}
                name="knowledge-search-scope"
                onChange={() => {
                  setSearchScope('official');
                  setSearchResults([]);
                  setSearchNotice('');
                }}
                type="radio"
              />
              正式知识来源
            </label>
            <label>
              <input
                aria-label="我的资料"
                checked={searchScope === 'personal'}
                name="knowledge-search-scope"
                onChange={() => {
                  setSearchScope('personal');
                  setSearchResults([]);
                  setSearchNotice('');
                }}
                type="radio"
              />
              我的资料搜索
            </label>
          </fieldset>
          <label>
            搜索知识库内容
            <input
              aria-label="搜索知识库内容"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void searchKnowledgeContent();
              }}
              placeholder={searchScope === 'official'
                ? '例如：部署方式、验收材料、应急响应流程'
                : '例如：我的会议记录、客户培训、个人模板'}
              value={searchQuery}
            />
          </label>
          <div className="history-actions">
            <button
              disabled={searching}
              onClick={() => void searchKnowledgeContent()}
              type="button"
            >
              {searching ? '搜索中…' : '搜索知识库'}
            </button>
          </div>
          {searchNotice ? <p role="status">{searchNotice}</p> : null}
        </article>
        {searchResults.length ? (
          <section className="section-block" role="region" aria-label="知识库搜索结果">
            <div className="history-list" role="list" aria-label="知识库搜索结果列表">
              {searchResults.map((source) => (
                <article
                  className="history-card"
                  key={`${source.file_id}-${source.chunk_id || source.section_title || source.file_name}`}
                  role="listitem"
                >
                  <h3>{sourceKindLabel(source.source_kind)}</h3>
                  <p>
                    <button
                      aria-label={`打开来源 ${source.file_name}`}
                      className="chat-citation-button"
                      onClick={() => void openSourcePreview(source)}
                      type="button"
                    >
                      {source.file_name}
                    </button>
                  </p>
                  {sourceLocation(source) ? <p>{sourceLocation(source)}</p> : null}
                  {source.snippet ? <p>{source.snippet}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
      <section className="section-block" aria-labelledby="knowledge-upload-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">资料上传</span>
            <h2 id="knowledge-upload-heading">资料上传入口</h2>
            <p>
              {isAdmin
                ? '管理员可上传正式知识库文档，并启用公司级 RAG。'
                : '你上传的个人资料仅供本人使用；审核通过后才可能进入正式知识库。'}
            </p>
          </div>
        </div>
        <article className="history-card">
          <label>
            上传知识文件
            <input
              accept=".txt,.md,.docx,.pdf,.xlsx,.csv,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setPendingUploadFile(file);
                setUploadPurpose(isAdmin ? 'official_knowledge' : 'personal_reference');
                setUploadStatus('');
                event.target.value = '';
              }}
              type="file"
            />
          </label>
          {pendingUploadFile ? (
            <div className="history-list">
              <p>已选择：{pendingUploadFile.name}</p>
              <p role="note">{parseQualityHint(pendingUploadFile)}</p>
              <fieldset>
                <legend>上传用途</legend>
                {isAdmin ? (
                  <>
                    <label>
                      <input
                        checked={uploadPurpose === 'official_knowledge'}
                        name="knowledge-upload-purpose"
                        onChange={() => setUploadPurpose('official_knowledge')}
                        type="radio"
                      />
                      加入公司知识库
                    </label>
                    <label>
                      <input
                        checked={false}
                        name="knowledge-upload-purpose-disabled"
                        readOnly
                        type="radio"
                      />
                      加入部门知识库（预留）
                    </label>
                    <label>
                      <input
                        checked={false}
                        name="knowledge-upload-purpose-disabled"
                        readOnly
                        type="radio"
                      />
                      加入项目知识库（预留）
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      <input
                        checked={uploadPurpose === 'session_attachment'}
                        name="knowledge-upload-purpose"
                        onChange={() => setUploadPurpose('session_attachment')}
                        type="radio"
                      />
                      仅用于当前会话
                    </label>
                    <label>
                      <input
                        checked={uploadPurpose === 'personal_reference'}
                        name="knowledge-upload-purpose"
                        onChange={() => setUploadPurpose('personal_reference')}
                        type="radio"
                      />
                      保存到我的资料
                    </label>
                    <label>
                      <input
                        checked={uploadPurpose === 'submit_review'}
                        name="knowledge-upload-purpose"
                        onChange={() => setUploadPurpose('submit_review')}
                        type="radio"
                      />
                      提交管理员审核
                    </label>
                  </>
                )}
              </fieldset>
              {isAdmin ? (
                <label>
                  所属知识库 ID
                  <input
                    aria-label="所属知识库 ID"
                    onChange={(event) => setUploadKnowledgeBaseId(event.target.value)}
                    placeholder="例如：公司知识库 ID"
                    value={uploadKnowledgeBaseId}
                  />
                </label>
              ) : null}
              <label>
                分类
                <input
                  aria-label="分类"
                  onChange={(event) => setUploadCategory(event.target.value)}
                  value={uploadCategory}
                />
              </label>
              <label>
                文档类型
                <input
                  aria-label="文档类型"
                  onChange={(event) => setUploadDocumentType(event.target.value)}
                  value={uploadDocumentType}
                />
              </label>
              <label>
                标签
                <input
                  aria-label="标签"
                  onChange={(event) => setUploadTags(event.target.value)}
                  placeholder="多个标签用逗号分隔"
                  value={uploadTags}
                />
              </label>
              <div className="history-actions">
                <button onClick={() => setPendingUploadFile(null)} type="button">
                  取消
                </button>
                <button onClick={() => void uploadFile()} type="button">
                  开始上传
                </button>
              </div>
            </div>
          ) : null}
          {uploadStatus ? <p role="status">{uploadStatus}</p> : null}
        </article>
      </section>
      <section className="section-block" aria-labelledby="knowledge-files-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">文档状态</span>
            <h2 id="knowledge-files-heading">
              {listMode === 'trash' ? '回收站' : '文档列表'}
            </h2>
            <p>只展示元数据和状态，不暴露服务器路径或内部文件 ID。</p>
          </div>
          {isAdmin ? (
            <button
              onClick={() => setListMode((current) => (current === 'trash' ? 'active' : 'trash'))}
              type="button"
            >
              {listMode === 'trash' ? '查看文档列表' : '查看回收站'}
            </button>
          ) : null}
        </div>
        {loading ? <p className="empty-hint">正在加载知识库文档…</p> : null}
        {notice ? <p className="form-error">{notice}</p> : null}
        {!loading && !notice && files.length === 0 ? (
          <p className="empty-hint">暂无可查看的知识库文档。</p>
        ) : null}
        {files.length > 0 ? (
          <div className="history-list" role="list" aria-label="知识库文档列表">
            {files.map((file) => {
              const isTrashMode = listMode === 'trash';
              const canSubmitReview = canSubmitKnowledgeFileForReview(file, isAdmin);
              const canManageRag = canManageKnowledgeFileRag(file, isAdmin);
              const canReparse = canReparseKnowledgeFile(file, isAdmin);
              const canArchive = canArchiveKnowledgeFile(file, isAdmin);
              const canReview = canReviewKnowledgeFile(file, isAdmin);
              const canEditMetadata = canEditKnowledgeFileMetadata(file, isAdmin);
              const isEditingMetadata = metadataEdit?.fileUuid === file.file_uuid;
              return (
                <article
                  aria-label={file.file_name}
                  className="history-card"
                  key={file.file_uuid}
                  role="listitem"
                >
                  <div>
                    <h3>{file.file_name}</h3>
                    <p>
                      {file.category || '未分类'} · {file.document_type || '其他'} · {file.file_type}
                    </p>
                    {file.tags?.length ? (
                      <p>标签：{file.tags.join('、')}</p>
                    ) : null}
                  </div>
                  {isEditingMetadata ? (
                    <div className="history-list" aria-label={`${file.file_name} 元数据编辑`}>
                      <label>
                        分类
                        <input
                          aria-label="分类"
                          onChange={(event) => setMetadataEdit((current) => current
                            ? { ...current, category: event.target.value }
                            : current)}
                          value={metadataEdit.category}
                        />
                      </label>
                      <label>
                        文档类型
                        <input
                          aria-label="文档类型"
                          onChange={(event) => setMetadataEdit((current) => current
                            ? { ...current, documentType: event.target.value }
                            : current)}
                          value={metadataEdit.documentType}
                        />
                      </label>
                      <label>
                        标签
                        <input
                          aria-label="标签"
                          onChange={(event) => setMetadataEdit((current) => current
                            ? { ...current, tags: event.target.value }
                            : current)}
                          value={metadataEdit.tags}
                        />
                      </label>
                      <div className="history-actions">
                        <button
                          aria-label={`保存元数据 ${file.file_name}`}
                          onClick={() => void saveMetadata(file)}
                          type="button"
                        >
                          保存元数据
                        </button>
                        <button onClick={() => setMetadataEdit(null)} type="button">
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="history-meta">
                    <span>{sourceKindLabel(file.usage_type || 'personal_reference')}</span>
                    <span>{sourceTypeLabel(file.source_type || 'user_upload')}</span>
                    <span>状态：{file.status}</span>
                    <span>{file.parse_status || file.status}</span>
                    <span>{file.index_status || file.status}</span>
                    <span>审核：{file.review_status || 'draft'}</span>
                    <span>RAG：{file.rag_enabled ? '开启' : '关闭'}</span>
                    <span>参考：{file.reference_enabled === false ? '关闭' : '开启'}</span>
                    <span>Chunks：{file.chunk_count}</span>
                    {file.review_status === 'pending' ? <span>已提交管理员审核</span> : null}
                  </div>
                  <div className="history-actions" aria-label={`${file.file_name} 操作`}>
                    {isTrashMode ? (
                      <>
                        <button
                          aria-label={`恢复 ${file.file_name}`}
                          onClick={() => void restoreFile(file)}
                          type="button"
                        >
                          恢复
                        </button>
                        <button
                          aria-label={`彻底删除 ${file.file_name}`}
                          onClick={() => void hardDeleteFile(file)}
                          type="button"
                        >
                          彻底删除
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          aria-label={`预览 ${file.file_name}`}
                          onClick={() => void openPreview(file)}
                          type="button"
                        >
                          预览
                        </button>
                        <button
                          aria-label={`总结 ${file.file_name}`}
                          onClick={() => void summarizeFile(file)}
                          type="button"
                        >
                          总结
                        </button>
                        <button
                          aria-label={`根据此资料生成 ${file.file_name}`}
                          onClick={() => void generateFromFile(file)}
                          type="button"
                        >
                          根据此资料生成
                        </button>
                        <button
                          aria-label={`下载 ${file.file_name}`}
                          onClick={() => downloadFile(file)}
                          type="button"
                        >
                          下载
                        </button>
                        <button
                          aria-label={`删除 ${file.file_name}`}
                          onClick={() => void deleteFile(file)}
                          type="button"
                        >
                          删除
                        </button>
                      </>
                    )}
                    {!isTrashMode && canSubmitReview ? (
                      <button
                        aria-label={`提交审核 ${file.file_name}`}
                        onClick={() => void submitReview(file)}
                        type="button"
                      >
                        提交审核
                      </button>
                    ) : null}
                    {!isTrashMode && canManageRag ? (
                      <button
                        aria-label={`${file.rag_enabled ? '禁用' : '启用'} RAG ${file.file_name}`}
                        onClick={() => void toggleRag(file)}
                        type="button"
                      >
                        {file.rag_enabled ? '禁用 RAG' : '启用 RAG'}
                      </button>
                    ) : null}
                    {!isTrashMode && canEditMetadata ? (
                      <button
                        aria-label={`编辑分类标签 ${file.file_name}`}
                        onClick={() => startMetadataEdit(file)}
                        type="button"
                      >
                        编辑分类标签
                      </button>
                    ) : null}
                    {!isTrashMode && canReparse ? (
                      <button
                        aria-label={`重新解析 ${file.file_name}`}
                        onClick={() => void reparseFile(file)}
                        type="button"
                      >
                        重新解析
                      </button>
                    ) : null}
                    {!isTrashMode && canArchive ? (
                      <button
                        aria-label={`归档 ${file.file_name}`}
                        onClick={() => void archiveFile(file)}
                        type="button"
                      >
                        归档
                      </button>
                    ) : null}
                    {!isTrashMode && canReview ? (
                      <>
                        <button
                          aria-label={`审核通过 ${file.file_name}`}
                          onClick={() => void approveReview(file)}
                          type="button"
                        >
                          审核通过
                        </button>
                        <button
                          aria-label={`审核驳回 ${file.file_name}`}
                          onClick={() => void rejectReview(file)}
                          type="button"
                        >
                          审核驳回
                        </button>
                      </>
                    ) : null}
                  </div>
                  {!isTrashMode ? (
                    <div className="history-actions" aria-label={`${file.file_name} 问答`}>
                      <label>
                        问这个文档
                        <input
                          aria-label={`问题 ${file.file_name}`}
                          onChange={(event) => setFileQuestions((current) => ({
                            ...current,
                            [file.file_uuid]: event.target.value,
                          }))}
                          placeholder="例如：这个文档里验收材料需要包含什么？"
                          value={fileQuestions[file.file_uuid] || ''}
                        />
                      </label>
                      <button
                        aria-label={`问这个文档 ${file.file_name}`}
                        onClick={() => void askFile(file)}
                        type="button"
                      >
                        问这个文档
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
        {actionNotice ? <p className="form-error">{actionNotice}</p> : null}
        {fileAction ? (
          <section className="section-block" role="region" aria-label={fileAction.title}>
            <div className="section-heading">
              <div>
                <span className="eyebrow">{fileAction.fileName}</span>
                <h3>{fileAction.title}</h3>
                <p>{fileAction.payload.notice}</p>
              </div>
            </div>
            <article className="history-card">
              <p>
                {fileAction.payload.answer
                  || '已准备文档总结上下文，等待模型服务返回正式总结。'}
              </p>
              <div className="history-actions">
                <button onClick={() => void saveFileActionToChat()} type="button">
                  保存到聊天记录
                </button>
                <button onClick={() => void exportFileActionWord()} type="button">
                  导出 Word
                </button>
              </div>
            </article>
            {fileAction.payload.sources.length ? (
              <div className="history-list" role="list" aria-label={`${fileAction.title}来源`}>
                {fileAction.payload.sources.map((source) => (
                  <article
                    className="history-card"
                    key={`${source.file_id}-${source.section_title || source.file_name}`}
                    role="listitem"
                  >
                    <h4>{sourceKindLabel(source.source_kind)}</h4>
                    {source.file_id ? (
                      <p>
                        <button
                          aria-label={`打开来源 ${source.file_name}`}
                          className="chat-citation-button"
                          onClick={() => void openSourcePreview(source)}
                          type="button"
                        >
                          {source.file_name}
                        </button>
                      </p>
                    ) : (
                      <p>{source.file_name}</p>
                    )}
                    {sourceLocation(source) ? <p>{sourceLocation(source)}</p> : null}
                    {source.snippet ? <p>{source.snippet}</p> : null}
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {preview ? (
          <section className="section-block" role="region" aria-label="文档预览">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{preview.source_kind}</span>
                <h3>{preview.file_name}</h3>
                <p>{preview.notice}</p>
              </div>
            </div>
            {preview.chunks.map((chunk) => (
              <article className="history-card" key={`${preview.file_uuid}-${chunk.chunk_id}`}>
                <h4>{chunk.section_title || `片段 ${chunk.chunk_index + 1}`}</h4>
                <p>
                  {chunk.page_number ? `第 ${chunk.page_number} 页 · ` : ''}
                  片段 {chunk.chunk_index + 1}
                </p>
                <p>{chunk.text}</p>
              </article>
            ))}
          </section>
        ) : null}
      </section>
    </section>
  );
}

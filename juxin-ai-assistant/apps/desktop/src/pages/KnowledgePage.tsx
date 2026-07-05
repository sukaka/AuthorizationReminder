import { useEffect, useState } from 'react';

import { ApiError, type SessionPayload } from '../api/client';
import {
  archiveKnowledgeFile,
  askKnowledge,
  askKnowledgeFile,
  approveKnowledgeFileReview,
  createKnowledgeDocumentType,
  createKnowledgeCategory,
  createKnowledgeBase,
  deleteKnowledgeDocumentType,
  deleteKnowledgeCategory,
  deleteKnowledgeFile,
  disableKnowledgeFileRag,
  enableKnowledgeFileRag,
  exportKnowledgeContentWord,
  generatePersonalReference,
  hardDeleteKnowledgeFile,
  knowledgeFileDownloadUrl,
  listKnowledgeCategories,
  listKnowledgeDocumentTypes,
  listKnowledgeBases,
  listKnowledgeFileTrash,
  listKnowledgeFiles,
  listKnowledgeReviewHistory,
  listPendingKnowledgeReviews,
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
  type KnowledgeBasePayload,
  type KnowledgeCategoryPayload,
  type KnowledgeDocumentTypePayload,
  type KnowledgeFilePayload,
  type KnowledgeFilePreviewPayload,
  type KnowledgeFileSourcePayload,
  type KnowledgeReviewLogPayload,
  updateKnowledgeCategory,
  updateKnowledgeDocumentType,
  updateKnowledgeFileMetadata,
  uploadKnowledgeFile,
} from '../api/chat';

type KnowledgePageProps = {
  readonly session: SessionPayload;
};

type KnowledgeListMode = 'active' | 'trash';
type KnowledgeTab = 'library' | 'upload' | 'categories' | 'review';
type KnowledgeDictionaryTab = 'categories' | 'documentTypes';
type KnowledgeDictionaryDrawerMode =
  | 'createCategory'
  | 'editCategory'
  | 'createDocumentType'
  | 'editDocumentType';
type KnowledgeRiskFilter = 'all' | 'parseFailed' | 'notIndexed' | 'pendingReview' | 'ragDisabled';
type KnowledgeSearchScope = 'official' | 'personal';
type KnowledgeBaseScope = 'company' | 'department' | 'project';
type KnowledgeUploadPurpose =
  | 'session_attachment'
  | 'personal_reference'
  | 'submit_review'
  | 'official_knowledge';
type KnowledgeReviewApprovalDraft = {
  fileUuid: string;
  fileName: string;
  knowledgeBaseId: string;
  category: string;
  documentType: string;
  permissionScope: 'company' | 'department' | 'project' | 'admin';
  ragScope: 'company' | 'department' | 'project';
  comment: string;
  tags: string;
};
const generateFromFilePrompt = '请根据这个文档生成一份可直接编辑的工作草稿，保留核心依据、结构化输出，并在末尾标明参考来源。';

const fallbackKnowledgeCategoryOptions = ['公司制度', '产品资料', '项目交付', '销售商务', '行政人力', '安全运维', '模板范本', '会议纪要', '个人素材', '其他'];
const fallbackKnowledgeDocumentTypeOptions = ['产品白皮书', '解决方案', '投标模板', '交付说明', '测试报告', '安全服务报告', '会议记录', '提示词手册', '其他'];
const supportedKnowledgeAccept = '.pdf,.txt,.md,.docx,.xlsx,.pptx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation';
const unsupportedKnowledgeTypeMessage = '当前版本暂不支持该文件类型，请上传 pdf、docx、xlsx、pptx、txt 或 md 文件。';
const pdfUploadHint = 'PDF 会按页面提取可复制文本，扫描件需要先转成可复制文本。';

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
  if (sourceKind === 'official_knowledge') return '来源：正式资料';
  if (sourceKind === 'session_attachment') return '参考资料：当前附件';
  if (sourceKind === 'personal_reference') return '参考资料：我的资料';
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

function fileTypeLabel(file: KnowledgeFilePayload): string {
  const extension = fileExtension(file.file_name).toUpperCase();
  if (extension) return extension;
  if (file.file_type.includes('wordprocessingml')) return 'DOCX';
  if (file.file_type.includes('spreadsheetml')) return 'XLSX';
  if (file.file_type.includes('presentationml')) return 'PPTX';
  if (file.file_type.includes('markdown')) return 'MD';
  if (file.file_type.includes('text')) return 'TXT';
  return '文件';
}

function fileStatusLabel(file: KnowledgeFilePayload): string {
  if (file.review_status === 'pending') return '待审核';
  if (file.review_status === 'rejected') return '已驳回';
  if (file.status === 'READY') return '已就绪';
  if (file.status === 'PARSING' || file.parse_status === 'parsing') return '处理中';
  if (file.status === 'FAILED' || file.parse_status === 'failed') return '处理失败';
  return '已保存';
}

function knowledgeFileParseFailed(file: KnowledgeFilePayload): boolean {
  return file.status === 'FAILED' || file.parse_status === 'failed';
}

function knowledgeFileNotIndexed(file: KnowledgeFilePayload): boolean {
  return file.usage_type === 'official_knowledge'
    && !knowledgeFileParseFailed(file)
    && file.index_status !== 'ready';
}

function knowledgeFileRagDisabled(file: KnowledgeFilePayload): boolean {
  return file.usage_type === 'official_knowledge'
    && file.status === 'READY'
    && file.rag_enabled !== true;
}

function knowledgeFileMatchesRiskFilter(file: KnowledgeFilePayload, filter: KnowledgeRiskFilter): boolean {
  if (filter === 'parseFailed') return knowledgeFileParseFailed(file);
  if (filter === 'notIndexed') return knowledgeFileNotIndexed(file);
  if (filter === 'pendingReview') return file.review_status === 'pending';
  if (filter === 'ragDisabled') return knowledgeFileRagDisabled(file);
  return true;
}

function fileUsageLabel(file: KnowledgeFilePayload): string {
  if (file.usage_type === 'official_knowledge') return '正式资料';
  if (file.usage_type === 'session_attachment') return '当前附件';
  return '我的资料';
}

function fileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).trim().toLowerCase() : '';
}

function parseQualityHint(file: File | null): string {
  if (!file) return '';
  const extension = fileExtension(file.name);
  if (extension === 'pdf') return pdfUploadHint;
  if (extension === 'csv' || extension === 'doc' || extension === 'xls' || ['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    return unsupportedKnowledgeTypeMessage;
  }
  if (extension === 'xlsx') {
    return 'Excel 会按 Sheet、表头和行记录解析，适合上传产品参数、清单和客户资料。';
  }
  if (extension === 'pptx') {
    return 'PPT 会按幻灯片标题、正文和备注解析，适合上传方案介绍和培训材料。';
  }
  if (extension === 'docx') {
    return 'Word 文档会提取标题、正文和表格内容，表格会尽量转换为标准 Markdown 表格。';
  }
  if (extension === 'txt' || extension === 'md') {
    return '文本和 Markdown 会按标题、段落、列表切分，适合作为稳定资料来源。';
  }
  return '当前支持 pdf、docx、xlsx、pptx、txt、md；暂不支持图片、扫描件和旧 Office 格式。';
}

function uploadFailureMessage(error: unknown): string {
  const status = error instanceof ApiError
    ? error.status
    : typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  if (status === 413) {
    return '资料上传失败：文件超过 100MB 上传限制，请压缩或拆分后再上传。';
  }
  const payload = error instanceof ApiError
    ? error.payload
    : typeof error === 'object' && error !== null && 'payload' in error
      ? (error as { payload?: unknown }).payload
      : null;
  if (payload) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload
      ? String((payload as { detail?: unknown }).detail || '').trim()
      : '';
    if (detail) return `资料上传失败：${detail}`;
  }
  return '资料上传失败，请稍后重试。';
}

type KnowledgeCategoryDirectoryItem = KnowledgeCategoryPayload & {
  level: number;
};

function sortKnowledgeCategories(categories: KnowledgeCategoryPayload[]): KnowledgeCategoryPayload[] {
  return [...categories].sort((first, second) => (
    first.sort_order - second.sort_order || first.name.localeCompare(second.name, 'zh-Hans-CN')
  ));
}

function sortKnowledgeDocumentTypes(documentTypes: KnowledgeDocumentTypePayload[]): KnowledgeDocumentTypePayload[] {
  return [...documentTypes].sort((first, second) => (
    first.sort_order - second.sort_order || first.name.localeCompare(second.name, 'zh-Hans-CN')
  ));
}

function buildKnowledgeCategoryDirectory(
  categories: KnowledgeCategoryPayload[],
  options: { activeOnly?: boolean } = {},
): KnowledgeCategoryDirectoryItem[] {
  const sourceCategories = options.activeOnly === false
    ? categories
    : categories.filter((category) => category.status === 'ACTIVE');
  const sortedCategories = sortKnowledgeCategories(sourceCategories);
  const categoryIds = new Set(sortedCategories.map((category) => category.category_id));
  const childrenByParent = new Map<string, KnowledgeCategoryPayload[]>();
  sortedCategories.forEach((category) => {
    if (!category.parent_category_id || !categoryIds.has(category.parent_category_id)) return;
    const children = childrenByParent.get(category.parent_category_id) || [];
    children.push(category);
    childrenByParent.set(category.parent_category_id, children);
  });
  childrenByParent.forEach((children, parentId) => {
    childrenByParent.set(parentId, sortKnowledgeCategories(children));
  });

  const directory: KnowledgeCategoryDirectoryItem[] = [];
  const visited = new Set<string>();
  const appendCategory = (category: KnowledgeCategoryPayload, level: number) => {
    if (visited.has(category.category_id)) return;
    visited.add(category.category_id);
    directory.push({ ...category, level });
    (childrenByParent.get(category.category_id) || []).forEach((child) => appendCategory(child, level + 1));
  };

  sortedCategories
    .filter((category) => !category.parent_category_id || !categoryIds.has(category.parent_category_id))
    .forEach((category) => appendCategory(category, 0));
  sortedCategories.forEach((category) => appendCategory(category, 0));
  return directory;
}

function categoryScopeLabel(scope: KnowledgeCategoryPayload['scope']): string {
  if (scope === 'company') return '公司级';
  if (scope === 'department') return '部门级';
  if (scope === 'project') return '项目级';
  return '个人';
}

function dictionaryStatusLabel(status: 'ACTIVE' | 'DISABLED'): string {
  return status === 'ACTIVE' ? '启用' : '停用';
}

function dictionaryDateLabel(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN');
}

function categorySelectionNames(selectedCategoryName: string, categories: KnowledgeCategoryPayload[]): string[] {
  if (!categories.length || selectedCategoryName === '全部资料') return [selectedCategoryName];
  const activeCategories = categories.filter((category) => category.status === 'ACTIVE');
  const selectedCategory = activeCategories.find((category) => category.name === selectedCategoryName);
  if (!selectedCategory) return [selectedCategoryName];
  const childrenByParent = new Map<string, KnowledgeCategoryPayload[]>();
  activeCategories.forEach((category) => {
    if (!category.parent_category_id) return;
    const children = childrenByParent.get(category.parent_category_id) || [];
    children.push(category);
    childrenByParent.set(category.parent_category_id, children);
  });
  const names = new Set<string>();
  const collect = (category: KnowledgeCategoryPayload) => {
    if (names.has(category.name)) return;
    names.add(category.name);
    (childrenByParent.get(category.category_id) || []).forEach(collect);
  };
  collect(selectedCategory);
  return [...names];
}

export function KnowledgePage({ session }: KnowledgePageProps) {
  const role = session.user.role.trim().toLowerCase();
  const isAdmin = role === 'admin';
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
  const [riskFilter, setRiskFilter] = useState<KnowledgeRiskFilter>('all');
  const [activeKnowledgeTab, setActiveKnowledgeTab] = useState<KnowledgeTab>('library');
  const [activeDictionaryTab, setActiveDictionaryTab] = useState<KnowledgeDictionaryTab>('categories');
  const [dictionaryDrawerMode, setDictionaryDrawerMode] = useState<KnowledgeDictionaryDrawerMode | null>(null);
  const [openDictionaryMenuKey, setOpenDictionaryMenuKey] = useState('');
  const [selectedCategoryName, setSelectedCategoryName] = useState('全部资料');
  const [selectedSecondaryCategoryName, setSelectedSecondaryCategoryName] = useState('全部');
  const [isSecondaryCategoryPanelOpen, setIsSecondaryCategoryPanelOpen] = useState(false);
  const [secondaryCategorySearch, setSecondaryCategorySearch] = useState('');
  const [openFileMenuUuid, setOpenFileMenuUuid] = useState('');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBasePayload[]>([]);
  const [knowledgeBaseNotice, setKnowledgeBaseNotice] = useState('');
  const [uploadPurpose, setUploadPurpose] = useState<KnowledgeUploadPurpose>(
    isAdmin ? 'official_knowledge' : 'personal_reference',
  );
  const [uploadCategory, setUploadCategory] = useState(isAdmin ? '产品资料' : '个人素材');
  const [uploadDocumentType, setUploadDocumentType] = useState(isAdmin ? '产品白皮书' : '个人模板');
  const [knowledgeCategories, setKnowledgeCategories] = useState<KnowledgeCategoryPayload[]>([]);
  const [categoryNotice, setCategoryNotice] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParentId, setNewCategoryParentId] = useState('');
  const [newCategoryScope, setNewCategoryScope] = useState<KnowledgeBaseScope>('company');
  const [newCategorySortOrder, setNewCategorySortOrder] = useState(10);
  const [newCategoryStatus, setNewCategoryStatus] = useState<'ACTIVE' | 'DISABLED'>('ACTIVE');
  const [editingCategory, setEditingCategory] = useState<{
    categoryId: string;
    name: string;
    parentCategoryId: string;
    scope: KnowledgeBaseScope;
    sortOrder: number;
    status: 'ACTIVE' | 'DISABLED';
  } | null>(null);
  const [knowledgeDocumentTypes, setKnowledgeDocumentTypes] = useState<KnowledgeDocumentTypePayload[]>([]);
  const [documentTypeNotice, setDocumentTypeNotice] = useState('');
  const [newDocumentTypeName, setNewDocumentTypeName] = useState('');
  const [newDocumentTypeSortOrder, setNewDocumentTypeSortOrder] = useState(10);
  const [newDocumentTypeStatus, setNewDocumentTypeStatus] = useState<'ACTIVE' | 'DISABLED'>('ACTIVE');
  const [editingDocumentType, setEditingDocumentType] = useState<{
    documentTypeId: string;
    name: string;
    sortOrder: number;
    status: 'ACTIVE' | 'DISABLED';
  } | null>(null);
  const [uploadKnowledgeBaseId, setUploadKnowledgeBaseId] = useState('');
  const [isCreatingKnowledgeBase, setIsCreatingKnowledgeBase] = useState(false);
  const [knowledgeBaseCreating, setKnowledgeBaseCreating] = useState(false);
  const [newKnowledgeBaseName, setNewKnowledgeBaseName] = useState('公司默认资料库');
  const [newKnowledgeBaseDescription, setNewKnowledgeBaseDescription] = useState('');
  const [newKnowledgeBaseScope, setNewKnowledgeBaseScope] = useState<KnowledgeBaseScope>('company');
  const [uploadStatus, setUploadStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<KnowledgeSearchScope>('official');
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeFileSourcePayload[]>([]);
  const [reviewHistory, setReviewHistory] = useState<KnowledgeReviewLogPayload[]>([]);
  const [reviewNotice, setReviewNotice] = useState('');
  const [metadataEdit, setMetadataEdit] = useState<{
    fileUuid: string;
    fileName: string;
    category: string;
    documentType: string;
  } | null>(null);
  const [reviewApproval, setReviewApproval] = useState<KnowledgeReviewApprovalDraft | null>(null);

  const [fileQuestions, setFileQuestions] = useState<Record<string, string>>({});
  const categoryDirectoryItems = buildKnowledgeCategoryDirectory(knowledgeCategories);
  const categoryManagementRows = buildKnowledgeCategoryDirectory(knowledgeCategories, { activeOnly: false });
  const primaryCategoryDirectory = categoryDirectoryItems.length
    ? categoryDirectoryItems.filter((category) => category.level === 0)
    : fallbackKnowledgeCategoryOptions.map((name, index) => ({
      category_id: `fallback-${index}`,
      name,
      parent_category_id: '',
      parent_name: '',
      scope: 'company' as const,
      sort_order: index,
      status: 'ACTIVE' as const,
      file_count: 0,
      created_at: '',
      updated_at: '',
      level: 0,
    }));
  const selectedPrimaryCategory = primaryCategoryDirectory.find((category) => category.name === selectedCategoryName) || null;
  const secondaryCategoryOptions = selectedPrimaryCategory
    ? categoryDirectoryItems.filter((category) => category.parent_category_id === selectedPrimaryCategory.category_id)
    : [];
  const selectedSecondaryCategory = secondaryCategoryOptions.find((category) => category.name === selectedSecondaryCategoryName) || null;
  const searchedSecondaryCategoryOptions = secondaryCategoryOptions.filter((category) => (
    category.name.toLowerCase().includes(secondaryCategorySearch.trim().toLowerCase())
  ));
  const categoryOptions = (
    categoryDirectoryItems.length
      ? categoryDirectoryItems.map((category) => category.name)
      : fallbackKnowledgeCategoryOptions
  );
  const selectableCategoryOptions = categoryOptions.includes(uploadCategory)
    ? categoryOptions
    : [uploadCategory, ...categoryOptions].filter(Boolean);
  const activeDocumentTypeNames = knowledgeDocumentTypes
    .filter((documentType) => documentType.status === 'ACTIVE')
    .map((documentType) => documentType.name);
  const documentTypeOptions = activeDocumentTypeNames.length
    ? activeDocumentTypeNames
    : fallbackKnowledgeDocumentTypeOptions;
  const uploadDocumentTypeOptions = documentTypeOptions.includes(uploadDocumentType)
    ? documentTypeOptions
    : [uploadDocumentType, ...documentTypeOptions].filter(Boolean);
  const documentTypeSelectOptions = (currentValue: string) => (
    documentTypeOptions.includes(currentValue)
      ? documentTypeOptions
      : [currentValue, ...documentTypeOptions].filter(Boolean)
  );
  const categorySelectOptions = (currentValue: string) => (
    categoryOptions.includes(currentValue)
      ? categoryOptions
      : [currentValue, ...categoryOptions].filter(Boolean)
  );
  const knowledgeBaseSelectOptions = (currentValue: string) => {
    const formalBases = knowledgeBases
      .filter((base) => base.scope !== 'personal')
      .map((base) => ({ id: base.base_id, name: base.name }));
    if (currentValue && !formalBases.some((base) => base.id === currentValue)) {
      return [{ id: currentValue, name: `当前资料库（${currentValue}）` }, ...formalBases];
    }
    return formalBases;
  };
  const selectedCategoryNames = selectedSecondaryCategoryName !== '全部'
    ? [selectedSecondaryCategoryName]
    : categorySelectionNames(selectedCategoryName, knowledgeCategories);
  const categoryFilteredFiles = selectedCategoryName === '全部资料'
    ? files
    : files.filter((file) => selectedCategoryNames.includes(file.category || '未分类'));
  const displayedFiles = categoryFilteredFiles.filter((file) => knowledgeFileMatchesRiskFilter(file, riskFilter));
  const categoryDirectory = primaryCategoryDirectory;
  const filesAvailableForQuestion = files.filter((file) => (
    file.rag_enabled || file.reference_enabled !== false
  )).length;
  const pendingReviewFiles = files.filter((file) => file.review_status === 'pending').length;
  const parseFailedFiles = files.filter(knowledgeFileParseFailed).length;
  const notIndexedFiles = files.filter(knowledgeFileNotIndexed).length;
  const ragDisabledFiles = files.filter(knowledgeFileRagDisabled).length;
  const dictionaryDrawerTitle = dictionaryDrawerMode === 'createCategory'
    ? '新建分类'
    : dictionaryDrawerMode === 'editCategory'
      ? '编辑分类'
      : dictionaryDrawerMode === 'createDocumentType'
        ? '新建文档类型'
        : dictionaryDrawerMode === 'editDocumentType'
          ? '编辑文档类型'
          : '';
  const openKnowledgeTab = (tab: KnowledgeTab) => {
    setActiveKnowledgeTab(tab);
    setOpenDictionaryMenuKey('');
    setRiskFilter('all');
    if (tab !== 'review' && listMode === 'trash') {
      setListMode('active');
    }
  };
  const selectPrimaryCategory = (categoryName: string) => {
    setSelectedCategoryName(categoryName);
    setSelectedSecondaryCategoryName('全部');
    setIsSecondaryCategoryPanelOpen(false);
    setSecondaryCategorySearch('');
  };
  const selectSecondaryCategory = (categoryName: string) => {
    setSelectedSecondaryCategoryName(categoryName);
    setIsSecondaryCategoryPanelOpen(false);
    setSecondaryCategorySearch('');
  };
  const toggleFileMenu = (fileUuid: string) => {
    setOpenFileMenuUuid((current) => (current === fileUuid ? '' : fileUuid));
  };
  const closeFileMenu = () => {
    setOpenFileMenuUuid('');
  };

  const openCreateCategoryDrawer = () => {
    setNewCategoryName('');
    setNewCategoryParentId('');
    setNewCategoryScope('company');
    setNewCategorySortOrder(knowledgeCategories.length * 10 + 10);
    setNewCategoryStatus('ACTIVE');
    setEditingCategory(null);
    setCategoryNotice('');
    setDictionaryDrawerMode('createCategory');
  };

  const openEditCategoryDrawer = (category: KnowledgeCategoryPayload) => {
    setEditingCategory({
      categoryId: category.category_id,
      name: category.name,
      parentCategoryId: category.parent_category_id,
      scope: category.scope === 'personal' ? 'company' : category.scope,
      sortOrder: category.sort_order,
      status: category.status,
    });
    setCategoryNotice('');
    setDictionaryDrawerMode('editCategory');
  };

  const openCreateDocumentTypeDrawer = () => {
    setNewDocumentTypeName('');
    setNewDocumentTypeSortOrder(knowledgeDocumentTypes.length * 10 + 10);
    setNewDocumentTypeStatus('ACTIVE');
    setEditingDocumentType(null);
    setDocumentTypeNotice('');
    setDictionaryDrawerMode('createDocumentType');
  };

  const openEditDocumentTypeDrawer = (documentType: KnowledgeDocumentTypePayload) => {
    setEditingDocumentType({
      documentTypeId: documentType.document_type_id,
      name: documentType.name,
      sortOrder: documentType.sort_order,
      status: documentType.status,
    });
    setDocumentTypeNotice('');
    setDictionaryDrawerMode('editDocumentType');
  };

  const closeDictionaryDrawer = () => {
    setDictionaryDrawerMode(null);
    setEditingCategory(null);
    setEditingDocumentType(null);
  };

  const createBase = async () => {
    const name = newKnowledgeBaseName.trim();
    if (!name) {
      setKnowledgeBaseNotice('请先填写资料库名称。');
      return;
    }
    setKnowledgeBaseCreating(true);
    setKnowledgeBaseNotice('正在创建资料库…');
    try {
      const created = await createKnowledgeBase({
        name,
        description: newKnowledgeBaseDescription.trim(),
        scope: newKnowledgeBaseScope,
        department_id: '',
        project_id: '',
      });
      setKnowledgeBases((current) => [
        created,
        ...current.filter((base) => base.base_id !== created.base_id),
      ]);
      setUploadKnowledgeBaseId(created.base_id);
      setKnowledgeBaseNotice(`已创建资料库：${created.name}`);
      setIsCreatingKnowledgeBase(false);
    } catch {
      setKnowledgeBaseNotice('暂时无法创建资料库，请稍后重试。');
    } finally {
      setKnowledgeBaseCreating(false);
    }
  };

  useEffect(() => {
    let active = true;
    setCategoryNotice('');
    listKnowledgeCategories(isAdmin)
      .then((payload) => {
        if (!active) return;
        setKnowledgeCategories(payload.items);
        const activeNames = payload.items
          .filter((category) => category.status === 'ACTIVE')
          .map((category) => category.name);
        setUploadCategory((current) => (
          current && activeNames.includes(current)
            ? current
            : activeNames[0] || (isAdmin ? '产品资料' : '个人素材')
        ));
      })
      .catch(() => {
        if (!active) return;
        setKnowledgeCategories([]);
        setCategoryNotice('资料分类暂时不可用，已使用默认分类。');
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    let active = true;
    setDocumentTypeNotice('');
    listKnowledgeDocumentTypes(isAdmin)
      .then((payload) => {
        if (!active) return;
        const sortedItems = sortKnowledgeDocumentTypes(payload.items);
        setKnowledgeDocumentTypes(sortedItems);
        const activeNames = sortedItems
          .filter((documentType) => documentType.status === 'ACTIVE')
          .map((documentType) => documentType.name);
        setUploadDocumentType((current) => (
          current && activeNames.includes(current)
            ? current
            : activeNames[0] || (isAdmin ? '产品白皮书' : '个人模板')
        ));
      })
      .catch(() => {
        if (!active) return;
        setKnowledgeDocumentTypes([]);
        setDocumentTypeNotice('文档类型暂时不可用，已使用默认类型。');
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    listKnowledgeBases()
      .then((payload) => {
        if (!active) return;
        setKnowledgeBases(payload.items);
        setKnowledgeBaseNotice(payload.items.length ? '' : '暂无可选资料库，请先创建资料库。');
        setUploadKnowledgeBaseId((current) => current || payload.items[0]?.base_id || '');
      })
      .catch(() => {
        if (!active) return;
        setKnowledgeBases([]);
        setKnowledgeBaseNotice('资料库列表暂时不可用，请稍后重试。');
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

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
        setRiskFilter('all');
      })
      .catch(() => {
        if (!active) return;
        setNotice('资料暂时不可用，请稍后重试。');
        setFiles([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listMode]);

  useEffect(() => {
    if (!isAdmin || activeKnowledgeTab !== 'review') return;
    let active = true;
    setReviewNotice('');
    Promise.all([
      listPendingKnowledgeReviews(),
      listKnowledgeReviewHistory(),
    ])
      .then(([pending, history]) => {
        if (!active) return;
        setReviewNotice(pending.total ? `当前有 ${pending.total} 条资料待审核。` : '暂无待审核资料。');
        setReviewHistory(history.items);
      })
      .catch(() => {
        if (!active) return;
        setReviewNotice('审核记录暂时不可用，请稍后重试。');
        setReviewHistory([]);
      });
    return () => {
      active = false;
    };
  }, [activeKnowledgeTab, isAdmin]);

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
      setActionNotice('暂时无法打开该来源段落，请稍后重试。');
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
        title: '资料提问结果',
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
    setActionNotice('正在保存到历史任务…');
    try {
      await saveKnowledgeResultToChat({
        question: fileAction.question,
        answer,
        mode: 'normal',
        sources: fileAction.payload.sources,
      });
      setActionNotice('已保存到历史任务。');
    } catch {
      setActionNotice('暂时无法保存到历史任务，请稍后重试。');
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
      setActionNotice('已归档该文档，并关闭资料查找。');
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
      setUploadStatus('当前附件请在任务输入框上传。');
      return;
    }
    setUploadStatus('正在上传资料…');
    try {
      const isOfficial = uploadPurpose === 'official_knowledge';
      if (isOfficial && !uploadKnowledgeBaseId.trim()) {
        setUploadStatus('请先选择所属资料库。');
        return;
      }
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
        tags: [],
      });
      setFiles((current) => [uploaded].concat(current));
      setPendingUploadFile(null);
      setSelectedCategoryName('全部资料');
      setActiveKnowledgeTab('library');
      setUploadStatus(isOfficial
        ? `正式资料已上传：${uploaded.file_name}`
        : `资料已上传：${uploaded.file_name}`);
    } catch (error) {
      setUploadStatus(uploadFailureMessage(error));
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
          ? `找到 ${payload.total} 条正式资料。`
          : '正式资料中未找到匹配内容。');
      } else {
        const personalNotice = 'notice' in payload && typeof payload.notice === 'string'
          ? payload.notice
          : `找到 ${payload.total} 条我的资料。`;
        setSearchNotice(payload.sources.length
          ? personalNotice
          : '我的资料中未找到匹配内容。');
      }
    } catch {
      setSearchResults([]);
      setSearchNotice(searchScope === 'official'
        ? '正式资料查找暂时不可用，请稍后重试。'
        : '个人资料搜索暂时不可用，请稍后重试。');
    } finally {
      setSearching(false);
    }
  };

  const answerFromOfficialKnowledge = async () => {
    const question = searchQuery.trim();
    if (!question) {
      setSearchNotice('请先输入要回答的问题。');
      return;
    }
    setActionNotice('');
    setFileAction(null);
    try {
      const payload = await askKnowledge(question, {
        mode: 'knowledge',
        topK: 8,
        includeSources: true,
      });
      setFileAction({
        fileName: '正式知识库',
        question,
        title: '正式资料回答',
        payload,
      });
      setSearchNotice(payload.notice);
    } catch {
      setSearchNotice('暂时无法根据正式资料回答，请稍后重试。');
    }
  };

  const generateFromPersonalReference = async (source: KnowledgeFileSourcePayload) => {
    const question = searchQuery.trim();
    if (!question) {
      setSearchNotice('请先输入要生成的内容。');
      return;
    }
    setActionNotice('');
    setFileAction(null);
    try {
      const payload = await generatePersonalReference(question, {
        fileIds: source.file_id ? [source.file_id] : [],
        mode: 'normal',
        topK: 8,
      });
      setFileAction({
        fileName: source.file_name,
        question,
        title: '我的资料生成草稿',
        payload,
      });
      setSearchNotice(payload.notice);
    } catch {
      setSearchNotice('暂时无法根据我的资料生成，请稍后重试。');
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
      setActionNotice(updated.rag_enabled ? '已启用资料查找。' : '已停用资料查找。');
    } catch {
      setActionNotice('暂时无法调整该资料的查找状态，请稍后重试。');
    }
  };

  const openApproveReview = (file: KnowledgeFilePayload) => {
    const defaultKnowledgeBaseId = file.knowledge_base_id
      || knowledgeBases.find((base) => base.scope !== 'personal')?.base_id
      || '';
    setReviewApproval({
      fileUuid: file.file_uuid,
      fileName: file.file_name,
      knowledgeBaseId: defaultKnowledgeBaseId,
      category: file.category || categoryOptions[0] || '其他',
      documentType: file.document_type || documentTypeOptions[0] || '其他',
      permissionScope: 'company',
      ragScope: 'company',
      comment: '管理员从桌面端审核通过',
      tags: (file.tags ?? []).join(', '),
    });
    setActionNotice('');
  };

  const approveReview = async () => {
    if (!reviewApproval) return;
    if (!reviewApproval.knowledgeBaseId.trim()) {
      setActionNotice('请先选择正式知识库。');
      return;
    }
    const tags = reviewApproval.tags
      .split(/[，,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      const updated = await approveKnowledgeFileReview(reviewApproval.fileUuid, {
        knowledgeBaseId: reviewApproval.knowledgeBaseId,
        comment: reviewApproval.comment.trim() || '管理员从桌面端审核通过',
        permissionScope: reviewApproval.permissionScope,
        ragScope: reviewApproval.ragScope,
        category: reviewApproval.category,
        documentType: reviewApproval.documentType,
        tags,
      });
      setFiles((current) => current.map((item) => (
        item.file_uuid === reviewApproval.fileUuid ? updated : item
      )));
      setReviewApproval(null);
      setActionNotice('已审核通过并转为正式资料。');
    } catch {
      setActionNotice('暂时无法审核通过该文档，请稍后重试。');
    }
  };

  const startMetadataEdit = (file: KnowledgeFilePayload) => {
    setMetadataEdit({
      fileUuid: file.file_uuid,
      fileName: file.file_name,
      category: file.category || '',
      documentType: file.document_type || '',
    });
    setActionNotice('');
  };

  const saveMetadata = async (file: KnowledgeFilePayload) => {
    if (!metadataEdit || metadataEdit.fileUuid !== file.file_uuid) return;
    setActionNotice('');
    try {
      const updated = await updateKnowledgeFileMetadata(file.file_uuid, {
        fileName: metadataEdit.fileName.trim() || file.file_name,
        category: metadataEdit.category,
        documentType: metadataEdit.documentType,
        tags: [],
      });
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setMetadataEdit(null);
      setActionNotice('已更新资料信息。');
    } catch {
      setActionNotice('暂时无法更新该文档元数据，请稍后重试。');
    }
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      setCategoryNotice('请先填写分类名称。');
      return;
    }
    setCategoryNotice('正在创建分类…');
    try {
      const created = await createKnowledgeCategory({
        name,
        parent_category_id: newCategoryParentId,
        scope: newCategoryScope,
        sort_order: newCategorySortOrder,
        status: newCategoryStatus,
      });
      setKnowledgeCategories((current) => [created, ...current]);
      setNewCategoryName('');
      setNewCategoryParentId('');
      setNewCategoryStatus('ACTIVE');
      setDictionaryDrawerMode(null);
      setCategoryNotice(`已创建资料分类：${created.name}`);
    } catch (error) {
      const detail = error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
        ? String((error.payload as { detail?: unknown }).detail || '').trim()
        : '';
      setCategoryNotice(detail || '暂时无法创建分类，请稍后重试。');
    }
  };

  const saveCategory = async () => {
    if (!editingCategory) return;
    const name = editingCategory.name.trim();
    if (!name) {
      setCategoryNotice('分类名称不能为空。');
      return;
    }
    setCategoryNotice('正在保存分类…');
    try {
      const updated = await updateKnowledgeCategory(editingCategory.categoryId, {
        name,
        parent_category_id: editingCategory.parentCategoryId,
        scope: editingCategory.scope,
        sort_order: editingCategory.sortOrder,
        status: editingCategory.status,
      });
      setKnowledgeCategories((current) => current.map((category) => (
        category.category_id === updated.category_id ? updated : category
      )));
      setEditingCategory(null);
      setDictionaryDrawerMode(null);
      setCategoryNotice(`已更新资料分类：${updated.name}`);
    } catch (error) {
      const detail = error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
        ? String((error.payload as { detail?: unknown }).detail || '').trim()
        : '';
      setCategoryNotice(detail || '暂时无法保存分类，请稍后重试。');
    }
  };

  const removeCategory = async (category: KnowledgeCategoryPayload) => {
    if (!window.confirm(`确定删除资料分类“${category.name}”吗？删除后不可恢复。`)) return;
    setCategoryNotice('');
    try {
      await deleteKnowledgeCategory(category.category_id);
      setKnowledgeCategories((current) => current.filter((item) => item.category_id !== category.category_id));
      setCategoryNotice(`已删除资料分类：${category.name}`);
    } catch (error) {
      const detail = error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
        ? String((error.payload as { detail?: unknown }).detail || '').trim()
        : '';
      setCategoryNotice(detail || '暂时无法删除分类，请先确认分类下没有资料。');
    }
  };

  const toggleCategoryStatus = async (category: KnowledgeCategoryPayload) => {
    const nextStatus = category.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setCategoryNotice('正在更新分类状态…');
    try {
      const updated = await updateKnowledgeCategory(category.category_id, {
        status: nextStatus,
      });
      setKnowledgeCategories((current) => current.map((item) => (
        item.category_id === updated.category_id ? updated : item
      )));
      setCategoryNotice(`已${nextStatus === 'ACTIVE' ? '启用' : '停用'}资料分类：${updated.name}`);
    } catch {
      setCategoryNotice('暂时无法更新分类状态，请稍后重试。');
    }
  };

  const createDocumentType = async () => {
    const name = newDocumentTypeName.trim();
    if (!name) {
      setDocumentTypeNotice('请先填写文档类型名称。');
      return;
    }
    setDocumentTypeNotice('正在创建文档类型…');
    try {
      const created = await createKnowledgeDocumentType({
        name,
        sort_order: newDocumentTypeSortOrder,
        status: newDocumentTypeStatus,
      });
      setKnowledgeDocumentTypes((current) => sortKnowledgeDocumentTypes([created, ...current]));
      setNewDocumentTypeName('');
      setNewDocumentTypeStatus('ACTIVE');
      setDictionaryDrawerMode(null);
      setDocumentTypeNotice(`已创建文档类型：${created.name}`);
    } catch (error) {
      const detail = error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
        ? String((error.payload as { detail?: unknown }).detail || '').trim()
        : '';
      setDocumentTypeNotice(detail || '暂时无法创建文档类型，请稍后重试。');
    }
  };

  const saveDocumentType = async () => {
    if (!editingDocumentType) return;
    const name = editingDocumentType.name.trim();
    if (!name) {
      setDocumentTypeNotice('文档类型名称不能为空。');
      return;
    }
    setDocumentTypeNotice('正在保存文档类型…');
    try {
      const updated = await updateKnowledgeDocumentType(editingDocumentType.documentTypeId, {
        name,
        sort_order: editingDocumentType.sortOrder,
        status: editingDocumentType.status,
      });
      setKnowledgeDocumentTypes((current) => sortKnowledgeDocumentTypes(current.map((documentType) => (
        documentType.document_type_id === updated.document_type_id ? updated : documentType
      ))));
      setEditingDocumentType(null);
      setDictionaryDrawerMode(null);
      setDocumentTypeNotice(`已更新文档类型：${updated.name}`);
    } catch (error) {
      const detail = error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
        ? String((error.payload as { detail?: unknown }).detail || '').trim()
        : '';
      setDocumentTypeNotice(detail || '暂时无法保存文档类型，请稍后重试。');
    }
  };

  const removeDocumentType = async (documentType: KnowledgeDocumentTypePayload) => {
    if (!window.confirm(`确定删除文档类型“${documentType.name}”吗？删除后不可恢复。`)) return;
    setDocumentTypeNotice('');
    try {
      await deleteKnowledgeDocumentType(documentType.document_type_id);
      setKnowledgeDocumentTypes((current) => current.filter((item) => item.document_type_id !== documentType.document_type_id));
      setDocumentTypeNotice(`已删除文档类型：${documentType.name}`);
    } catch (error) {
      const detail = error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
        ? String((error.payload as { detail?: unknown }).detail || '').trim()
        : '';
      setDocumentTypeNotice(detail || '暂时无法删除文档类型，请先确认类型下没有资料。');
    }
  };

  const toggleDocumentTypeStatus = async (documentType: KnowledgeDocumentTypePayload) => {
    const nextStatus = documentType.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setDocumentTypeNotice('正在更新文档类型状态…');
    try {
      const updated = await updateKnowledgeDocumentType(documentType.document_type_id, {
        status: nextStatus,
      });
      setKnowledgeDocumentTypes((current) => sortKnowledgeDocumentTypes(current.map((item) => (
        item.document_type_id === updated.document_type_id ? updated : item
      ))));
      setDocumentTypeNotice(`已${nextStatus === 'ACTIVE' ? '启用' : '停用'}文档类型：${updated.name}`);
    } catch {
      setDocumentTypeNotice('暂时无法更新文档类型状态，请稍后重试。');
    }
  };

  const reparseFile = async (file: KnowledgeFilePayload) => {
    setActionNotice('');
    try {
      const updated = await reparseKnowledgeFile(file.file_uuid);
      setFiles((current) => current.map((item) => (
        item.file_uuid === file.file_uuid ? updated : item
      )));
      setActionNotice('已重新处理并更新资料内容。');
    } catch {
      setActionNotice('暂时无法重新处理该文档，请稍后重试。');
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
    <section className="knowledge-page section-block" aria-labelledby="knowledge-heading">
      <div className="knowledge-page-hero">
        <div>
          <span className="eyebrow">{isAdmin ? '资料管理' : '个人资料'}</span>
          <h1 id="knowledge-heading">我的资料</h1>
          <p>
            {isAdmin
              ? '统一管理正式资料、员工提交资料和分类目录，让资料可查、可用、可维护。'
              : '管理你的参考资料，上传后可用于写材料、查资料和生成工作成果。'}
          </p>
        </div>
        <button
          className="knowledge-primary-action"
          onClick={() => openKnowledgeTab('upload')}
          type="button"
        >
          上传资料
        </button>
      </div>
      <div className="knowledge-tabs" role="tablist" aria-label="我的资料功能">
        <button
          aria-selected={activeKnowledgeTab === 'library'}
          className={activeKnowledgeTab === 'library' ? 'is-active' : ''}
          onClick={() => openKnowledgeTab('library')}
          role="tab"
          type="button"
        >
          资料库
        </button>
        <button
          aria-selected={activeKnowledgeTab === 'upload'}
          className={activeKnowledgeTab === 'upload' ? 'is-active' : ''}
          onClick={() => openKnowledgeTab('upload')}
          role="tab"
          type="button"
        >
          上传资料
        </button>
        {isAdmin ? (
          <>
            <button
              aria-selected={activeKnowledgeTab === 'categories'}
              className={activeKnowledgeTab === 'categories' ? 'is-active' : ''}
              onClick={() => openKnowledgeTab('categories')}
              role="tab"
              type="button"
            >
              字典管理
            </button>
            <button
              aria-selected={activeKnowledgeTab === 'review'}
              className={activeKnowledgeTab === 'review' ? 'is-active' : ''}
              onClick={() => openKnowledgeTab('review')}
              role="tab"
              type="button"
            >
              审核与回收站
            </button>
          </>
        ) : null}
      </div>
      {uploadStatus ? <p className="knowledge-global-status" role="status">{uploadStatus}</p> : null}
      {isAdmin && activeKnowledgeTab === 'categories' ? (
        <section className="section-block knowledge-dictionary-page" aria-labelledby="knowledge-dictionary-heading">
          <div className="section-heading knowledge-dictionary-heading">
            <div>
              <span className="eyebrow">字典管理</span>
              <h2 id="knowledge-dictionary-heading" tabIndex={-1}>字典管理</h2>
              <p>统一维护资料分类和文档类型，让上传、筛选、审核和知识库检索使用同一套标准字典。</p>
            </div>
          </div>
          <div className="knowledge-dictionary-tabs" role="tablist" aria-label="字典类型">
            <button
              aria-selected={activeDictionaryTab === 'categories'}
              className={activeDictionaryTab === 'categories' ? 'is-active' : ''}
              onClick={() => setActiveDictionaryTab('categories')}
              role="tab"
              type="button"
            >
              资料分类
            </button>
            <button
              aria-selected={activeDictionaryTab === 'documentTypes'}
              className={activeDictionaryTab === 'documentTypes' ? 'is-active' : ''}
              onClick={() => setActiveDictionaryTab('documentTypes')}
              role="tab"
              type="button"
            >
              文档类型
            </button>
          </div>
          {activeDictionaryTab === 'categories' ? (
            <section className="dictionary-panel" aria-labelledby="knowledge-category-heading">
              <div className="dictionary-panel-header">
                <div>
                  <h3 id="knowledge-category-heading">资料分类</h3>
                  <p>用于维护资料所属业务目录，影响资料库左侧分类和上传资料时的分类选择。</p>
                </div>
                <button
                  className="dictionary-button dictionary-button-primary"
                  onClick={openCreateCategoryDrawer}
                  type="button"
                >
                  新建分类
                </button>
              </div>
              {categoryNotice ? <p className="dictionary-notice" role="status">{categoryNotice}</p> : null}
              <div className="dictionary-table-card">
                <div className="dictionary-table-wrap">
                  <table className="dictionary-table" aria-label="资料分类字典表">
                    <thead>
                      <tr>
                        <th>分类名称</th>
                        <th>上级分类</th>
                        <th>层级</th>
                        <th>使用范围</th>
                        <th>状态</th>
                        <th>资料数量</th>
                        <th>排序</th>
                        <th className="dictionary-table-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryManagementRows.length ? categoryManagementRows.map((category) => (
                        <tr key={category.category_id}>
                          <td>
                            <span className="dictionary-tree-name" style={{ paddingLeft: category.level * 20 }}>
                              {category.level > 0 ? <span className="dictionary-tree-prefix">└─</span> : null}
                              {category.name}
                            </span>
                          </td>
                          <td>{category.parent_name || '无'}</td>
                          <td>{category.level + 1} 级</td>
                          <td>{categoryScopeLabel(category.scope)}</td>
                          <td>
                            <span className={`dictionary-status-badge ${category.status === 'ACTIVE' ? 'is-active' : 'is-disabled'}`}>
                              {dictionaryStatusLabel(category.status)}
                            </span>
                          </td>
                          <td>
                            <span className={`dictionary-count-badge ${category.file_count > 0 ? 'is-hot' : 'is-empty'}`}>
                              {category.file_count}
                            </span>
                          </td>
                          <td>{category.sort_order}</td>
                          <td className="dictionary-table-actions">
                            <div className="dictionary-row-actions">
                              <button
                                aria-label={`编辑 ${category.name}`}
                                className="dictionary-link-button"
                                onClick={() => openEditCategoryDrawer(category)}
                                type="button"
                              >
                                编辑
                              </button>
                              <div className="dictionary-more-menu">
                                <button
                                  aria-label={`更多 ${category.name}`}
                                  aria-expanded={openDictionaryMenuKey === `category-${category.category_id}`}
                                  className="dictionary-more-trigger"
                                  onClick={() => setOpenDictionaryMenuKey((current) => (
                                    current === `category-${category.category_id}` ? '' : `category-${category.category_id}`
                                  ))}
                                  type="button"
                                >
                                  更多
                                </button>
                                {openDictionaryMenuKey === `category-${category.category_id}` ? (
                                  <div role="menu">
                                    <button
                                      role="menuitem"
                                      type="button"
                                      onClick={() => {
                                        setOpenDictionaryMenuKey('');
                                        void toggleCategoryStatus(category);
                                      }}
                                    >
                                      {category.status === 'ACTIVE' ? '停用' : '启用'} {category.name}
                                    </button>
                                    <button
                                      className="dictionary-menu-danger"
                                      role="menuitem"
                                      type="button"
                                      onClick={() => {
                                        setOpenDictionaryMenuKey('');
                                        void removeCategory(category);
                                      }}
                                    >
                                      删除 {category.name}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={8}>
                            <p className="empty-hint">暂无资料分类，请先新建分类。</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : (
            <section className="dictionary-panel" aria-labelledby="knowledge-document-type-heading">
              <div className="dictionary-panel-header">
                <div>
                  <h3 id="knowledge-document-type-heading">文档类型</h3>
                  <p>用于维护资料的内容类型，上传、审核和编辑资料时可选择，便于筛选和生成内容。</p>
                </div>
                <button
                  className="dictionary-button dictionary-button-primary"
                  onClick={openCreateDocumentTypeDrawer}
                  type="button"
                >
                  新建文档类型
                </button>
              </div>
              {documentTypeNotice ? <p className="dictionary-notice" role="status">{documentTypeNotice}</p> : null}
              <div className="dictionary-table-card">
                <div className="dictionary-table-wrap">
                  <table className="dictionary-table" aria-label="文档类型字典表">
                    <thead>
                      <tr>
                        <th>类型名称</th>
                        <th>状态</th>
                        <th>资料数量</th>
                        <th>排序</th>
                        <th>创建时间</th>
                        <th className="dictionary-table-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {knowledgeDocumentTypes.length ? knowledgeDocumentTypes.map((documentType) => (
                        <tr key={documentType.document_type_id}>
                          <td>{documentType.name}</td>
                          <td>
                            <span className={`dictionary-status-badge ${documentType.status === 'ACTIVE' ? 'is-active' : 'is-disabled'}`}>
                              {dictionaryStatusLabel(documentType.status)}
                            </span>
                          </td>
                          <td>
                            <span className={`dictionary-count-badge ${documentType.file_count > 0 ? 'is-hot' : 'is-empty'}`}>
                              {documentType.file_count}
                            </span>
                          </td>
                          <td>{documentType.sort_order}</td>
                          <td>{dictionaryDateLabel(documentType.created_at)}</td>
                          <td className="dictionary-table-actions">
                            <div className="dictionary-row-actions">
                              <button
                                aria-label={`编辑 ${documentType.name}`}
                                className="dictionary-link-button"
                                onClick={() => openEditDocumentTypeDrawer(documentType)}
                                type="button"
                              >
                                编辑
                              </button>
                              <div className="dictionary-more-menu">
                                <button
                                  aria-label={`更多 ${documentType.name}`}
                                  aria-expanded={openDictionaryMenuKey === `documentType-${documentType.document_type_id}`}
                                  className="dictionary-more-trigger"
                                  onClick={() => setOpenDictionaryMenuKey((current) => (
                                    current === `documentType-${documentType.document_type_id}` ? '' : `documentType-${documentType.document_type_id}`
                                  ))}
                                  type="button"
                                >
                                  更多
                                </button>
                                {openDictionaryMenuKey === `documentType-${documentType.document_type_id}` ? (
                                  <div role="menu">
                                    <button
                                      role="menuitem"
                                      type="button"
                                      onClick={() => {
                                        setOpenDictionaryMenuKey('');
                                        void toggleDocumentTypeStatus(documentType);
                                      }}
                                    >
                                      {documentType.status === 'ACTIVE' ? '停用' : '启用'} {documentType.name}
                                    </button>
                                    <button
                                      className="dictionary-menu-danger"
                                      role="menuitem"
                                      type="button"
                                      onClick={() => {
                                        setOpenDictionaryMenuKey('');
                                        void removeDocumentType(documentType);
                                      }}
                                    >
                                      删除 {documentType.name}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={6}>
                            <p className="empty-hint">暂无文档类型，请先新建文档类型。</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
          {dictionaryDrawerMode ? (
            <div className="dictionary-drawer-layer">
              <button
                aria-label="关闭字典抽屉"
                className="dictionary-drawer-backdrop"
                onClick={closeDictionaryDrawer}
                type="button"
              />
              <aside className="dictionary-drawer" role="dialog" aria-modal="true" aria-label={dictionaryDrawerTitle}>
                <header>
                  <div>
                    <span className="eyebrow">字典配置</span>
                    <h3>{dictionaryDrawerTitle}</h3>
                  </div>
                  <button aria-label="关闭" onClick={closeDictionaryDrawer} type="button">×</button>
                </header>
                {dictionaryDrawerMode === 'createCategory' || dictionaryDrawerMode === 'editCategory' ? (
                  <div className="dictionary-drawer-form">
                    <label>
                      分类名称
                      <input
                        aria-label="分类名称"
                        onChange={(event) => {
                          if (dictionaryDrawerMode === 'createCategory') {
                            setNewCategoryName(event.target.value);
                          } else {
                            setEditingCategory((current) => current ? { ...current, name: event.target.value } : current);
                          }
                        }}
                        placeholder="例如：安全运维"
                        value={dictionaryDrawerMode === 'createCategory' ? newCategoryName : editingCategory?.name || ''}
                      />
                    </label>
                    <label>
                      上级分类
                      <select
                        aria-label="上级分类"
                        onChange={(event) => {
                          if (dictionaryDrawerMode === 'createCategory') {
                            setNewCategoryParentId(event.target.value);
                          } else {
                            setEditingCategory((current) => current ? { ...current, parentCategoryId: event.target.value } : current);
                          }
                        }}
                        value={dictionaryDrawerMode === 'createCategory' ? newCategoryParentId : editingCategory?.parentCategoryId || ''}
                      >
                        <option value="">无上级分类</option>
                        {knowledgeCategories
                          .filter((category) => category.category_id !== editingCategory?.categoryId)
                          .map((category) => (
                            <option key={category.category_id} value={category.category_id}>
                              {category.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      使用范围
                      <select
                        aria-label="使用范围"
                        onChange={(event) => {
                          const scope = event.target.value as KnowledgeBaseScope;
                          if (dictionaryDrawerMode === 'createCategory') {
                            setNewCategoryScope(scope);
                          } else {
                            setEditingCategory((current) => current ? { ...current, scope } : current);
                          }
                        }}
                        value={dictionaryDrawerMode === 'createCategory' ? newCategoryScope : editingCategory?.scope || 'company'}
                      >
                        <option value="company">公司级</option>
                        <option value="department">部门级</option>
                        <option value="project">项目级</option>
                      </select>
                    </label>
                    <label>
                      排序
                      <input
                        aria-label="排序"
                        min={0}
                        onChange={(event) => {
                          const sortOrder = Number(event.target.value) || 0;
                          if (dictionaryDrawerMode === 'createCategory') {
                            setNewCategorySortOrder(sortOrder);
                          } else {
                            setEditingCategory((current) => current ? { ...current, sortOrder } : current);
                          }
                        }}
                        type="number"
                        value={dictionaryDrawerMode === 'createCategory' ? newCategorySortOrder : editingCategory?.sortOrder || 0}
                      />
                    </label>
                    <label>
                      状态
                      <select
                        aria-label="状态"
                        onChange={(event) => {
                          const status = event.target.value as 'ACTIVE' | 'DISABLED';
                          if (dictionaryDrawerMode === 'createCategory') {
                            setNewCategoryStatus(status);
                          } else {
                            setEditingCategory((current) => current ? { ...current, status } : current);
                          }
                        }}
                        value={dictionaryDrawerMode === 'createCategory' ? newCategoryStatus : editingCategory?.status || 'ACTIVE'}
                      >
                        <option value="ACTIVE">启用</option>
                        <option value="DISABLED">停用</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="dictionary-drawer-form">
                    <label>
                      文档类型名称
                      <input
                        aria-label="文档类型名称"
                        onChange={(event) => {
                          if (dictionaryDrawerMode === 'createDocumentType') {
                            setNewDocumentTypeName(event.target.value);
                          } else {
                            setEditingDocumentType((current) => current ? { ...current, name: event.target.value } : current);
                          }
                        }}
                        placeholder="例如：验收报告"
                        value={dictionaryDrawerMode === 'createDocumentType' ? newDocumentTypeName : editingDocumentType?.name || ''}
                      />
                    </label>
                    <label>
                      排序
                      <input
                        aria-label="排序"
                        min={0}
                        onChange={(event) => {
                          const sortOrder = Number(event.target.value) || 0;
                          if (dictionaryDrawerMode === 'createDocumentType') {
                            setNewDocumentTypeSortOrder(sortOrder);
                          } else {
                            setEditingDocumentType((current) => current ? { ...current, sortOrder } : current);
                          }
                        }}
                        type="number"
                        value={dictionaryDrawerMode === 'createDocumentType' ? newDocumentTypeSortOrder : editingDocumentType?.sortOrder || 0}
                      />
                    </label>
                    <label>
                      状态
                      <select
                        aria-label="状态"
                        onChange={(event) => {
                          const status = event.target.value as 'ACTIVE' | 'DISABLED';
                          if (dictionaryDrawerMode === 'createDocumentType') {
                            setNewDocumentTypeStatus(status);
                          } else {
                            setEditingDocumentType((current) => current ? { ...current, status } : current);
                          }
                        }}
                        value={dictionaryDrawerMode === 'createDocumentType' ? newDocumentTypeStatus : editingDocumentType?.status || 'ACTIVE'}
                      >
                        <option value="ACTIVE">启用</option>
                        <option value="DISABLED">停用</option>
                      </select>
                    </label>
                  </div>
                )}
                <footer>
                  <button
                    className="dictionary-button dictionary-button-secondary"
                    onClick={closeDictionaryDrawer}
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    className="dictionary-button dictionary-button-primary"
                    onClick={() => {
                      if (dictionaryDrawerMode === 'createCategory') void createCategory();
                      if (dictionaryDrawerMode === 'editCategory') void saveCategory();
                      if (dictionaryDrawerMode === 'createDocumentType') void createDocumentType();
                      if (dictionaryDrawerMode === 'editDocumentType') void saveDocumentType();
                    }}
                    type="button"
                  >
                    保存
                  </button>
                </footer>
              </aside>
            </div>
          ) : null}
        </section>
      ) : null}
      {activeKnowledgeTab === 'library' ? (
      <section className="section-block knowledge-search-card" aria-labelledby="knowledge-search-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">资料查找</span>
            <h2 id="knowledge-search-heading" tabIndex={-1}>查找资料内容</h2>
            <p>在正式资料或我的资料里查找相关内容，找到后可直接预览来源段落。</p>
          </div>
        </div>
        <article className="history-card knowledge-search-form">
          <fieldset className="knowledge-segmented-control">
            <legend>查找范围</legend>
            <label className={searchScope === 'official' ? 'is-selected' : ''}>
              <input
                aria-label="正式资料"
                checked={searchScope === 'official'}
                name="knowledge-search-scope"
                onChange={() => {
                  setSearchScope('official');
                  setSearchResults([]);
                  setSearchNotice('');
                }}
                type="radio"
              />
              正式资料
            </label>
            <label className={searchScope === 'personal' ? 'is-selected' : ''}>
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
              我的资料
            </label>
          </fieldset>
          <label className="knowledge-search-input">
            关键词或问题
            <input
              aria-label="关键词或问题"
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
              {searching ? '查找中…' : '查找资料'}
            </button>
          </div>
          {searchNotice ? <p role="status">{searchNotice}</p> : null}
        </article>
        {searchResults.length ? (
          <section className="section-block knowledge-search-results" role="region" aria-label="资料查找结果">
            {searchScope === 'official' ? (
              <div className="history-actions">
                <button
                  className="knowledge-button knowledge-button-primary"
                  onClick={() => void answerFromOfficialKnowledge()}
                  type="button"
                >
                  用正式资料回答
                </button>
              </div>
            ) : null}
            <div className="history-list" role="list" aria-label="资料查找结果列表">
              {searchResults.map((source) => (
                <article
                  className="history-card"
                  key={`${source.file_id}-${source.chunk_id || source.section_title || source.file_name}`}
                  role="listitem"
                >
                  <span className="knowledge-source-badge">{sourceKindLabel(source.source_kind)}</span>
                  <h3>
                    <button
                      aria-label={`打开来源 ${source.file_name}`}
                      className="chat-citation-button"
                      onClick={() => void openSourcePreview(source)}
                      type="button"
                    >
                      {source.file_name}
                    </button>
                  </h3>
                  {sourceLocation(source) ? <p>{sourceLocation(source)}</p> : null}
                  {source.snippet ? <p>{source.snippet}</p> : null}
                  {searchScope === 'personal' ? (
                    <div className="history-actions">
                      <button
                        aria-label={`用我的资料生成 ${source.file_name}`}
                        className="knowledge-button knowledge-button-primary"
                        onClick={() => void generateFromPersonalReference(source)}
                        type="button"
                      >
                        用我的资料生成
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
      ) : null}
      {activeKnowledgeTab === 'upload' ? (
      <section className="section-block knowledge-upload-panel" aria-labelledby="knowledge-upload-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">资料上传</span>
            <h2 id="knowledge-upload-heading" tabIndex={-1}>资料上传入口</h2>
            <p>
              {isAdmin
                ? '管理员可上传正式资料，设置分类、类型和使用范围。'
                : '你上传的资料默认只归你本人使用，需要共享时再提交管理员审核。'}
            </p>
          </div>
        </div>
        <article className="history-card">
          <label>
            上传资料
            <input
              aria-label="上传知识文件"
              accept={supportedKnowledgeAccept}
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
          {isAdmin ? (
            <div className="knowledge-base-manager">
              <div className="knowledge-base-picker">
                <label>
                  所属资料库
                  <select
                    aria-label="所属资料库"
                    onChange={(event) => setUploadKnowledgeBaseId(event.target.value)}
                    value={uploadKnowledgeBaseId}
                  >
                    <option value="">请选择资料库</option>
                    {knowledgeBases.map((base) => (
                      <option key={base.base_id} value={base.base_id}>
                        {base.name}{base.scope === 'company' ? '（公司）' : base.scope === 'department' ? '（部门）' : base.scope === 'project' ? '（项目）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setIsCreatingKnowledgeBase((current) => !current)}>
                  {isCreatingKnowledgeBase ? '收起新建' : '新建资料库'}
                </button>
              </div>
              {isCreatingKnowledgeBase ? (
                <div className="knowledge-base-create">
                  <label>
                    资料库名称
                    <input
                      aria-label="资料库名称"
                      onChange={(event) => setNewKnowledgeBaseName(event.target.value)}
                      placeholder="例如：公司默认资料库"
                      value={newKnowledgeBaseName}
                    />
                  </label>
                  <label>
                    资料库说明
                    <input
                      aria-label="资料库说明"
                      onChange={(event) => setNewKnowledgeBaseDescription(event.target.value)}
                      placeholder="例如：公司正式资料来源"
                      value={newKnowledgeBaseDescription}
                    />
                  </label>
                  <label>
                    资料库范围
                    <select
                      aria-label="资料库范围"
                      onChange={(event) => setNewKnowledgeBaseScope(event.target.value as KnowledgeBaseScope)}
                      value={newKnowledgeBaseScope}
                    >
                      <option value="company">公司资料库</option>
                      <option value="department">部门资料库</option>
                      <option value="project">项目资料库</option>
                    </select>
                  </label>
                  <div className="history-actions">
                    <button
                      disabled={knowledgeBaseCreating}
                      onClick={createBase}
                      type="button"
                    >
                      {knowledgeBaseCreating ? '创建中…' : '创建资料库'}
                    </button>
                    <button
                      disabled={knowledgeBaseCreating}
                      onClick={() => setIsCreatingKnowledgeBase(false)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
              {knowledgeBaseNotice ? <p role="status">{knowledgeBaseNotice}</p> : null}
            </div>
          ) : null}
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
                      保存为正式资料
                    </label>
                    <label>
                      <input
                        checked={false}
                        name="knowledge-upload-purpose-disabled"
                        readOnly
                        type="radio"
                      />
                      保存为部门资料（预留）
                    </label>
                    <label>
                      <input
                        checked={false}
                        name="knowledge-upload-purpose-disabled"
                        readOnly
                        type="radio"
                      />
                      保存为项目资料（预留）
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
                      仅用于当前任务
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
              <label>
                资料分类
                <select
                  aria-label="资料分类"
                  onChange={(event) => setUploadCategory(event.target.value)}
                  value={uploadCategory}
                >
                  {selectableCategoryOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                文档类型
                <select
                  aria-label="文档类型"
                  onChange={(event) => setUploadDocumentType(event.target.value)}
                  value={uploadDocumentType}
                >
                  {uploadDocumentTypeOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
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
        </article>
      </section>
      ) : null}
      {activeKnowledgeTab === 'library' || activeKnowledgeTab === 'review' ? (
      <section className="section-block knowledge-files-panel" aria-labelledby="knowledge-files-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">文档状态</span>
            <h2 id="knowledge-files-heading" tabIndex={-1}>
              {listMode === 'trash' ? '回收站' : '文档列表'}
            </h2>
            <p>
              {activeKnowledgeTab === 'review'
                ? '集中处理待审核资料和已删除资料。'
                : '按分类查看资料，常用操作保留在每条资料右侧。'}
            </p>
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
        <div className="knowledge-library-grid">
          <aside className="knowledge-category-rail" aria-label="分类目录">
            <div>
              <span className="eyebrow">分类目录</span>
              <h3>资料分类</h3>
            </div>
            <div className="knowledge-category-list" role="list">
              <button
                aria-current={selectedCategoryName === '全部资料' ? 'true' : undefined}
                className={selectedCategoryName === '全部资料' ? 'is-active' : ''}
                onClick={() => selectPrimaryCategory('全部资料')}
                type="button"
              >
                <span>全部资料</span>
                {files.length > 0 ? <strong>{files.length}</strong> : null}
              </button>
              {categoryDirectory.map((category) => {
                const categoryNames = categorySelectionNames(category.name, knowledgeCategories);
                const categoryCount = files.filter((file) => categoryNames.includes(file.category || '未分类')).length;
                return (
                  <button
                    aria-current={selectedCategoryName === category.name ? 'true' : undefined}
                    className={selectedCategoryName === category.name ? 'is-active' : ''}
                    key={category.category_id}
                    onClick={() => selectPrimaryCategory(category.name)}
                    type="button"
                  >
                    <span>{category.name}</span>
                    {categoryCount > 0 ? <strong>{categoryCount}</strong> : null}
                  </button>
                );
              })}
            </div>
          </aside>
          <div className="knowledge-document-area">
            {isAdmin ? (
              <section className="knowledge-governance-board" aria-label="资料治理看板">
                <div>
                  <span className="eyebrow">治理状态</span>
                  <h3>资料治理看板</h3>
                  <p>优先处理解析失败、未入检索、待审核和正式资料未启用检索的问题。</p>
                </div>
                <div className="knowledge-governance-actions">
                  <button
                    aria-pressed={riskFilter === 'all'}
                    className={riskFilter === 'all' ? 'is-active' : ''}
                    onClick={() => setRiskFilter('all')}
                    type="button"
                  >
                    全部资料 {files.length}
                  </button>
                  <button
                    aria-pressed={riskFilter === 'parseFailed'}
                    className={riskFilter === 'parseFailed' ? 'is-active' : ''}
                    onClick={() => setRiskFilter('parseFailed')}
                    type="button"
                  >
                    只看解析失败 {parseFailedFiles}
                  </button>
                  <button
                    aria-pressed={riskFilter === 'notIndexed'}
                    className={riskFilter === 'notIndexed' ? 'is-active' : ''}
                    onClick={() => setRiskFilter('notIndexed')}
                    type="button"
                  >
                    只看未入检索 {notIndexedFiles}
                  </button>
                  <button
                    aria-pressed={riskFilter === 'pendingReview'}
                    className={riskFilter === 'pendingReview' ? 'is-active' : ''}
                    onClick={() => setRiskFilter('pendingReview')}
                    type="button"
                  >
                    只看待审核 {pendingReviewFiles}
                  </button>
                  <button
                    aria-pressed={riskFilter === 'ragDisabled'}
                    className={riskFilter === 'ragDisabled' ? 'is-active' : ''}
                    onClick={() => setRiskFilter('ragDisabled')}
                    type="button"
                  >
                    只看未启用检索 {ragDisabledFiles}
                  </button>
                </div>
                <dl>
                  <div><dt>解析失败</dt><dd>{parseFailedFiles}</dd></div>
                  <div><dt>未入检索</dt><dd>{notIndexedFiles}</dd></div>
                  <div><dt>待审核</dt><dd>{pendingReviewFiles}</dd></div>
                  <div><dt>检索未启用</dt><dd>{ragDisabledFiles}</dd></div>
                </dl>
              </section>
            ) : null}
            {selectedCategoryName !== '全部资料' ? (
              <section className="knowledge-secondary-filter" aria-label={`${selectedCategoryName} 二级分类筛选`}>
                <div className="knowledge-secondary-filter-heading">
                  <span>当前分类</span>
                  <strong>{selectedCategoryName}</strong>
                </div>
                <div className="knowledge-secondary-chip-row">
                  <button
                    aria-current={selectedSecondaryCategoryName === '全部' ? 'true' : undefined}
                    className={selectedSecondaryCategoryName === '全部' ? 'is-active' : ''}
                    onClick={() => selectSecondaryCategory('全部')}
                    type="button"
                  >
                    全部
                  </button>
                  {selectedSecondaryCategory ? (
                    <button
                      aria-current="true"
                      className="is-active"
                      onClick={() => selectSecondaryCategory(selectedSecondaryCategory.name)}
                      type="button"
                    >
                      {selectedSecondaryCategory.name}
                    </button>
                  ) : null}
                  {secondaryCategoryOptions.length ? (
                    <div className="knowledge-secondary-more">
                      <button
                        aria-expanded={isSecondaryCategoryPanelOpen}
                        onClick={() => setIsSecondaryCategoryPanelOpen((current) => !current)}
                        type="button"
                      >
                        更多分类
                      </button>
                    </div>
                  ) : null}
                </div>
                {isSecondaryCategoryPanelOpen ? (
                  <div className="knowledge-secondary-panel" role="dialog" aria-label="更多二级分类">
                    <label>
                      搜索分类
                      <input
                        aria-label="搜索二级分类"
                        onChange={(event) => setSecondaryCategorySearch(event.target.value)}
                        placeholder="输入分类名称"
                        value={secondaryCategorySearch}
                      />
                    </label>
                    <div className="knowledge-secondary-panel-list">
                      {searchedSecondaryCategoryOptions.length ? searchedSecondaryCategoryOptions.map((category) => (
                        <button
                          aria-current={selectedSecondaryCategoryName === category.name ? 'true' : undefined}
                          className={selectedSecondaryCategoryName === category.name ? 'is-active' : ''}
                          key={category.category_id}
                          onClick={() => selectSecondaryCategory(category.name)}
                          type="button"
                        >
                          {category.name}
                        </button>
                      )) : <span>没有找到匹配分类</span>}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
            {loading ? <p className="empty-hint">正在加载资料…</p> : null}
            {notice ? <p className="form-error">{notice}</p> : null}
            {!loading && !notice && displayedFiles.length === 0 ? (
              <p className="empty-hint">暂无可查看的资料。</p>
            ) : null}
        {displayedFiles.length > 0 ? (
          <div className="history-list" role="list" aria-label="资料列表">
            {displayedFiles.map((file) => {
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
                  className="history-card knowledge-file-card"
                  key={file.file_uuid}
                  role="listitem"
                >
                  <div className="knowledge-file-main">
                    <div className="knowledge-file-icon" aria-hidden="true">
                      {fileTypeLabel(file)}
                    </div>
                    <div>
                      <h3>{file.file_name}</h3>
                      <p>
                        {[file.category || '未分类', file.document_type || '其他', fileUsageLabel(file)].join(' · ')}
                      </p>
                    </div>
                  </div>
                  {isEditingMetadata ? (
                    <div className="knowledge-edit-panel" aria-label={`${file.file_name} 资料信息编辑`}>
                      <label>
                        文件名称
                        <input
                          aria-label="文件名称"
                          onChange={(event) => setMetadataEdit((current) => current
                            ? { ...current, fileName: event.target.value }
                            : current)}
                          value={metadataEdit.fileName}
                        />
                      </label>
                      <label>
                        资料分类
                        <select
                          aria-label="资料分类"
                          onChange={(event) => setMetadataEdit((current) => current
                            ? { ...current, category: event.target.value }
                            : current)}
                          value={metadataEdit.category}
                        >
                          {selectableCategoryOptions.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        文档类型
                        <select
                          aria-label="文档类型"
                          onChange={(event) => setMetadataEdit((current) => current
                            ? { ...current, documentType: event.target.value }
                            : current)}
                          value={metadataEdit.documentType}
                        >
                          {documentTypeSelectOptions(metadataEdit.documentType).map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <div className="history-actions">
                        <button
                          aria-label={`保存元数据 ${file.file_name}`}
                          onClick={() => void saveMetadata(file)}
                          type="button"
                        >
                          保存
                        </button>
                        <button onClick={() => setMetadataEdit(null)} type="button">
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="knowledge-file-meta">
                    <span>{fileStatusLabel(file)}</span>
                    <span>{sourceTypeLabel(file.source_type || 'user_upload')}</span>
                    <span>{file.reference_enabled === false ? '暂不参与生成' : '可作为参考资料'}</span>
                    <span>已整理 {file.chunk_count} 个段落</span>
                    {file.rag_enabled ? <span>可查找</span> : null}
                  </div>
                  <div className="history-actions knowledge-file-actions" aria-label={`${file.file_name} 操作`}>
                    {isTrashMode ? (
                      <>
                        <button
                          aria-label={`恢复 ${file.file_name}`}
                          className="knowledge-button knowledge-button-secondary"
                          onClick={() => void restoreFile(file)}
                          type="button"
                        >
                          恢复
                        </button>
                        <button
                          aria-label={`彻底删除 ${file.file_name}`}
                          className="knowledge-button knowledge-button-danger"
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
                          className="knowledge-button knowledge-button-secondary"
                          onClick={() => void openPreview(file)}
                          type="button"
                        >
                          预览
                        </button>
                        <button
                          aria-label={`总结 ${file.file_name}`}
                          className="knowledge-button knowledge-button-secondary"
                          onClick={() => void summarizeFile(file)}
                          type="button"
                        >
                          总结
                        </button>
                        <button
                          aria-label={`根据此资料生成 ${file.file_name}`}
                          className="knowledge-button knowledge-button-primary"
                          onClick={() => void generateFromFile(file)}
                          type="button"
                        >
                          根据此资料生成
                        </button>
                        <div className="knowledge-file-more">
                          <button
                            aria-expanded={openFileMenuUuid === file.file_uuid}
                            aria-label={`更多操作 ${file.file_name}`}
                            className="knowledge-button knowledge-button-secondary"
                            onClick={() => toggleFileMenu(file.file_uuid)}
                            type="button"
                          >
                            更多
                          </button>
                          {openFileMenuUuid === file.file_uuid ? (
                            <div className="knowledge-file-more-menu" role="menu" aria-label={`${file.file_name} 更多操作`}>
                              <button
                                aria-label={`下载 ${file.file_name}`}
                                className="knowledge-menu-item"
                                onClick={() => {
                                  closeFileMenu();
                                  downloadFile(file);
                                }}
                                role="menuitem"
                                type="button"
                              >
                                下载
                              </button>
                              {canEditMetadata ? (
                                <button
                                  aria-label={`编辑资料分类 ${file.file_name}`}
                                  className="knowledge-menu-item"
                                  onClick={() => {
                                    closeFileMenu();
                                    startMetadataEdit(file);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  编辑资料分类
                                </button>
                              ) : null}
                              {canReparse ? (
                                <button
                                  aria-label={`重新处理 ${file.file_name}`}
                                  className="knowledge-menu-item"
                                  onClick={() => {
                                    closeFileMenu();
                                    void reparseFile(file);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  重新处理
                                </button>
                              ) : null}
                              {canArchive ? (
                                <button
                                  aria-label={`归档 ${file.file_name}`}
                                  className="knowledge-menu-item knowledge-menu-item-muted"
                                  onClick={() => {
                                    closeFileMenu();
                                    void archiveFile(file);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  归档
                                </button>
                              ) : null}
                              {canSubmitReview ? (
                                <button
                                  aria-label={`提交审核 ${file.file_name}`}
                                  className="knowledge-menu-item"
                                  onClick={() => {
                                    closeFileMenu();
                                    void submitReview(file);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  提交审核
                                </button>
                              ) : null}
                              {canManageRag ? (
                                <button
                                  aria-label={`${file.rag_enabled ? '停用' : '启用'}资料查找 ${file.file_name}`}
                                  className={`knowledge-menu-item${file.rag_enabled ? ' knowledge-menu-item-danger' : ''}`}
                                  onClick={() => {
                                    closeFileMenu();
                                    void toggleRag(file);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  {file.rag_enabled ? '停用资料查找' : '启用资料查找'}
                                </button>
                              ) : null}
                              <button
                                aria-label={`删除 ${file.file_name}`}
                                className="knowledge-menu-item knowledge-menu-item-danger"
                                onClick={() => {
                                  closeFileMenu();
                                  void deleteFile(file);
                                }}
                                role="menuitem"
                                type="button"
                              >
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </>
                    )}
                    {!isTrashMode && canReview ? (
                      <>
                        <button
                          aria-label={`审核通过 ${file.file_name}`}
                          className="knowledge-button knowledge-button-primary"
                          onClick={() => openApproveReview(file)}
                          type="button"
                        >
                          审核通过
                        </button>
                        <button
                          aria-label={`审核驳回 ${file.file_name}`}
                          className="knowledge-button knowledge-button-danger"
                          onClick={() => void rejectReview(file)}
                          type="button"
                        >
                          审核驳回
                        </button>
                      </>
                    ) : null}
                  </div>
                  {!isTrashMode ? (
                    <div className="history-actions knowledge-file-question-actions" aria-label={`${file.file_name} 资料提问`}>
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
                        className="knowledge-button knowledge-button-primary"
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
          </div>
          <aside className="knowledge-summary-card" aria-label="资料概览">
            <span className="eyebrow">资料概览</span>
            <h3>当前资料</h3>
            <dl>
              <div>
                <dt>资料总数</dt>
                <dd>{files.length}</dd>
              </div>
              <div>
                <dt>可查找资料</dt>
                <dd>{filesAvailableForQuestion}</dd>
              </div>
              <div>
                <dt>待审核</dt>
                <dd>{pendingReviewFiles}</dd>
              </div>
            </dl>
          </aside>
        </div>
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
                  保存到历史任务
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
        {activeKnowledgeTab === 'review' && isAdmin ? (
          <section className="section-block knowledge-review-history" aria-label="审核历史">
            <div className="section-heading">
              <div>
                <span className="eyebrow">审核留痕</span>
                <h3>审核历史</h3>
                <p>{reviewNotice || '展示管理员审核动作、状态变化和备注。'}</p>
              </div>
            </div>
            {reviewHistory.length ? (
              <div className="history-list" role="list" aria-label="审核历史列表">
                {reviewHistory.map((item) => (
                  <article className="history-card" key={`${item.file_uuid}-${item.created_at}`} role="listitem">
                    <h4>{item.file_name}</h4>
                    <p>{item.action} · {item.old_status} → {item.new_status}</p>
                    {item.comment ? <p>{item.comment}</p> : null}
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {reviewApproval ? (
          <div className="dialog-backdrop">
            <section
              aria-label={`审核通过 ${reviewApproval.fileName}`}
              aria-modal="true"
              className="warning-dialog knowledge-review-dialog"
              role="dialog"
            >
              <div className="warning-symbol" aria-hidden="true">✓</div>
              <h2>审核通过</h2>
              <p>
                请先确认正式知识库、资料分类和文档类型。通过后该资料会转为公司正式知识来源，
                并参与知识库问答引用。
              </p>
              <div className="dictionary-drawer-form">
                <label>
                  所属知识库
                  <select
                    aria-label="所属知识库"
                    onChange={(event) => setReviewApproval((current) => current
                      ? { ...current, knowledgeBaseId: event.target.value }
                      : current)}
                    value={reviewApproval.knowledgeBaseId}
                  >
                    {knowledgeBaseSelectOptions(reviewApproval.knowledgeBaseId).map((base) => (
                      <option key={base.id} value={base.id}>{base.name}</option>
                    ))}
                  </select>
                </label>
                {!knowledgeBaseSelectOptions(reviewApproval.knowledgeBaseId).length ? (
                  <p role="note">暂无可选正式知识库，请先在知识库页面创建。</p>
                ) : null}
                <label>
                  资料分类
                  <select
                    aria-label="资料分类"
                    onChange={(event) => setReviewApproval((current) => current
                      ? { ...current, category: event.target.value }
                      : current)}
                    value={reviewApproval.category}
                  >
                    {categorySelectOptions(reviewApproval.category).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  文档类型
                  <select
                    aria-label="文档类型"
                    onChange={(event) => setReviewApproval((current) => current
                      ? { ...current, documentType: event.target.value }
                      : current)}
                    value={reviewApproval.documentType}
                  >
                    {documentTypeSelectOptions(reviewApproval.documentType).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  权限范围
                  <select
                    aria-label="权限范围"
                    onChange={(event) => setReviewApproval((current) => current
                      ? {
                        ...current,
                        permissionScope: event.target.value as KnowledgeReviewApprovalDraft['permissionScope'],
                        ragScope: event.target.value === 'admin'
                          ? 'company'
                          : event.target.value as KnowledgeReviewApprovalDraft['ragScope'],
                      }
                      : current)}
                    value={reviewApproval.permissionScope}
                  >
                    <option value="company">公司可见</option>
                    <option value="department">部门可见</option>
                    <option value="project">项目可见</option>
                    <option value="admin">仅管理员</option>
                  </select>
                </label>
                <label>
                  审核备注
                  <textarea
                    aria-label="审核备注"
                    onChange={(event) => setReviewApproval((current) => current
                      ? { ...current, comment: event.target.value }
                      : current)}
                    rows={3}
                    value={reviewApproval.comment}
                  />
                </label>
              </div>
              <div className="dialog-actions">
                <button onClick={() => setReviewApproval(null)} type="button">
                  取消
                </button>
                <button
                  className="knowledge-button knowledge-button-primary"
                  disabled={!reviewApproval.knowledgeBaseId.trim()}
                  onClick={() => void approveReview()}
                  type="button"
                >
                  确认通过
                </button>
              </div>
            </section>
          </div>
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
                <h4>{chunk.section_title || `段落 ${chunk.chunk_index + 1}`}</h4>
                <p>
                  {chunk.page_number ? `第 ${chunk.page_number} 页 · ` : ''}
                  段落 {chunk.chunk_index + 1}
                </p>
                <p>{chunk.text}</p>
              </article>
            ))}
          </section>
        ) : null}
      </section>
      ) : null}
    </section>
  );
}

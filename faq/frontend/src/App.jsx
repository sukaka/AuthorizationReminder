import { useEffect, useMemo, useRef, useState } from 'react'
import { logoutFromSso } from './portal-auth.js'

const API_BASE = import.meta.env.VITE_API_BASE || ''

const parseMaybeJson = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return { data: null, json: false, raw: '' }
  try {
    return { data: JSON.parse(raw), json: true, raw }
  } catch {
    return { data: null, json: false, raw }
  }
}

const buildHttpError = ({ res, parsed }) => {
  if (parsed.json && parsed.data?.error) {
    return parsed.data.error
  }
  if (parsed.raw) {
    if (parsed.raw.startsWith('<')) {
      return `接口返回非JSON(${res.status})`
    }
    return parsed.raw
  }
  return `请求失败(${res.status})`
}

const buildApi = () => ({
  get: async (path) => {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
    })
    const text = await res.text()
    const parsed = parseMaybeJson(text)
    if (!res.ok) {
      const err = new Error(buildHttpError({ res, parsed }))
      err.status = res.status
      throw err
    }
    return parsed.data
  },
  post: async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    })
    const text = await res.text()
    const parsed = parseMaybeJson(text)
    if (!res.ok) {
      const err = new Error(buildHttpError({ res, parsed }))
      err.status = res.status
      throw err
    }
    return parsed.data
  },
  postForm: async (path, formData) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    const text = await res.text()
    const parsed = parseMaybeJson(text)
    if (!res.ok) {
      const err = new Error(buildHttpError({ res, parsed }))
      err.status = res.status
      throw err
    }
    return parsed.data
  },
  put: async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    })
    const text = await res.text()
    const parsed = parseMaybeJson(text)
    if (!res.ok) {
      const err = new Error(buildHttpError({ res, parsed }))
      err.status = res.status
      throw err
    }
    return parsed.data
  },
  del: async (path) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    const text = await res.text()
    const parsed = parseMaybeJson(text)
    if (!res.ok) {
      const err = new Error(buildHttpError({ res, parsed }))
      err.status = res.status
      throw err
    }
    return parsed.data
  },
})

const getPortalBaseUrl = () => {
  const configured = String(import.meta.env.VITE_SSO_PORTAL_URL || '').trim()
  if (configured) {
    const portalUrl = new URL(configured, window.location.origin)
    if (window.location.protocol === 'https:' && portalUrl.port === '5180') {
      portalUrl.protocol = 'https:'
      portalUrl.hostname = window.location.hostname
      portalUrl.port = ''
    }
    return portalUrl.origin
  }
  const { protocol, hostname } = window.location
  return protocol === 'https:' ? `${protocol}//${hostname}` : `${protocol}//${hostname}:5180`
}

const buildPortalEntryUrl = (system) => {
  const base = getPortalBaseUrl()
  return `${base}/portal?system=${encodeURIComponent(system)}`
}

const buildPortalSwitchUrl = (system) => {
  const base = getPortalBaseUrl()
  const params = new URLSearchParams()
  if (system) params.set('system', system)
  params.set('mode', 'switch')
  return `${base}/portal?${params.toString()}`
}

const ROLE_LABEL_MAP = {
  admin: '管理员',
  sysadmin: '系统管理员',
  auditor: '审计管理员',
  editor: '编辑员',
  reviewer: '审核员',
  viewer: '普通用户',
}

const ARTICLE_STATUS_LABEL_MAP = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

const REVIEW_STATUS_LABEL_MAP = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
}

const ACCESS_REQUEST_STATUS_LABEL_MAP = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
  revoked: '已撤销',
  expired: '已过期',
}

const OUTBOX_STATUS_LABEL_MAP = {
  pending: '待发送',
  delivering: '发送中',
  delivered: '已送达',
  failed: '发送失败',
}

const VERSION_SOURCE_LABEL_MAP = {
  upload: '文件上传',
  online_edit: '在线编辑',
  restore: '版本回滚',
}

const FILE_EXT_LABEL_MAP = {
  pdf: 'PDF文档',
  doc: 'Word文档',
  docx: 'Word文档',
  html: '网页文档',
}

const LIBRARY_SCOPE_LABEL_MAP = {
  global: '全局库',
  department: '部门库',
}

const OUTBOX_EVENT_LABEL_MAP = {
  FAQ_PUBLISH_REQUEST_CREATED: '创建发布审批单',
  FAQ_PUBLISHED: '文章发布完成',
  FAQ_EDITOR_PUBLISHED: '在线编辑发布完成',
  FAQ_RECYCLED: '文章移入回收站',
  FAQ_RESTORED: '文章从回收站恢复',
  FAQ_RECYCLE_PURGED: '回收站清理',
}

const AUDIT_ACTION_LABEL_MAP = {
  ARTICLE_CREATE: '创建文章',
  ARTICLE_UPDATE: '更新文章',
  ARTICLE_STATUS: '文章状态变更',
  ARTICLE_PIN: '文章置顶操作',
  ARTICLE_BATCH: '批量操作文章',
  ARTICLE_RECYCLE: '文章移入回收站',
  ARTICLE_RESTORE: '文章恢复',
  ARTICLE_PURGE: '文章清理',
  VERSION_UPLOAD: '上传版本',
  VERSION_RESTORE: '回滚版本',
  PUBLISH_REQUEST_CREATE: '提交发布审批',
  PUBLISH_REQUEST_APPROVE: '审批通过发布',
  PUBLISH_REQUEST_REJECT: '审批拒绝发布',
  ARTICLE_PUBLISH: '直接发布文章',
  EDITOR_SESSION_CREATE: '创建在线编辑会话',
  EDITOR_SESSION_RELEASE: '释放在线编辑会话',
  EDITOR_PUBLISH: '在线编辑发布',
  EDITOR_DISCARD: '放弃在线编辑草稿',
  EDITOR_SECTION_LOCK: '锁定编辑分段',
  EDITOR_SECTION_RELEASE: '释放编辑分段',
  FEEDBACK_SUBMIT: '提交反馈',
  FAVORITE_ADD: '收藏文章',
  FAVORITE_REMOVE: '取消收藏',
  SMART_PIN_APPLY: '应用智能置顶',
  CATEGORY_CREATE: '创建分类',
  CATEGORY_UPDATE: '更新分类',
  CATEGORY_DELETE: '删除分类',
  TEMPLATE_CREATE: '创建模板',
  TEMPLATE_UPDATE: '更新模板',
  TEMPLATE_DELETE: '删除模板',
  SNIPPET_CREATE: '创建片段',
  SNIPPET_UPDATE: '更新片段',
  SNIPPET_DELETE: '删除片段',
  SNIPPET_USE: '使用片段',
}

const translateByMap = (value, map, fallback = '-') => {
  const key = String(value || '').trim().toLowerCase()
  if (!key) return fallback
  return map[key] || fallback
}

const translateByUpperMap = (value, map, fallback = '其他') => {
  const key = String(value || '').trim().toUpperCase()
  if (!key) return '-'
  return map[key] || fallback
}

const roleLabel = (role) => {
  return translateByMap(role, ROLE_LABEL_MAP, '未知角色')
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

const parseTagsText = (value) => String(value || '').split(/[，,、]/).map((item) => item.trim()).filter(Boolean)

const normalizeList = (payload) => {
  if (Array.isArray(payload)) return { items: payload, total: payload.length, page: 1, limit: payload.length || 20 }
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    total: Number(payload?.total || 0),
    page: Number(payload?.page || 1),
    limit: Number(payload?.limit || 20),
  }
}

const statusText = (value) => {
  return translateByMap(value, ARTICLE_STATUS_LABEL_MAP, '未知状态')
}

const reviewStatusText = (value) => translateByMap(value, REVIEW_STATUS_LABEL_MAP, '未知状态')
const accessRequestStatusText = (value) => translateByMap(value, ACCESS_REQUEST_STATUS_LABEL_MAP, '未知状态')
const outboxStatusText = (value) => translateByMap(value, OUTBOX_STATUS_LABEL_MAP, '未知状态')
const outboxEventText = (value) => translateByUpperMap(value, OUTBOX_EVENT_LABEL_MAP, '其他事件')
const auditActionText = (value) => translateByUpperMap(value, AUDIT_ACTION_LABEL_MAP, '其他操作')
const versionSourceText = (value) => translateByMap(value, VERSION_SOURCE_LABEL_MAP, '其他来源')
const fileExtText = (value) => translateByMap(value, FILE_EXT_LABEL_MAP, '其他文档')
const libraryScopeText = (value) => translateByMap(value, LIBRARY_SCOPE_LABEL_MAP, '部门库')

const formatRemaining = (seconds) => {
  const safe = Math.max(0, Number(seconds || 0))
  const min = Math.floor(safe / 60)
  const sec = safe % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const FEEDBACK_REASON_OPTIONS = [
  { value: 'no_match', label: '问题不匹配' },
  { value: 'unclear_steps', label: '步骤不清晰' },
  { value: 'outdated', label: '内容已过期' },
  { value: 'permission_issue', label: '权限或环境受限' },
  { value: 'missing_context', label: '缺少前置条件' },
  { value: 'other', label: '其他' },
]

const ACCESS_DURATION_OPTIONS = [
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
  { value: 'long_term', label: '长期' },
]

const DETAIL_PREF_STORAGE_KEY = 'faq_detail_modal_pref_v2'

const readDetailModalPref = () => {
  if (typeof window === 'undefined') return { x: 0, y: 0, width: 1380 }
  try {
    const raw = window.localStorage.getItem(DETAIL_PREF_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const x = Number(parsed?.x || 0)
    const y = Number(parsed?.y || 0)
    const widthRaw = Number(parsed?.width || 1380)
    const width = Math.max(1240, Math.min(1820, Number.isFinite(widthRaw) ? widthRaw : 1380))
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      width,
    }
  } catch {
    return { x: 0, y: 0, width: 1380 }
  }
}

const saveDetailModalPref = (pref) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DETAIL_PREF_STORAGE_KEY, JSON.stringify({
      x: Number(pref?.x || 0),
      y: Number(pref?.y || 0),
      width: Math.max(1240, Math.min(1820, Number(pref?.width || 1380))),
    }))
  } catch {
    // ignore localStorage errors
  }
}

const splitHighlightSegments = (text, keyword) => {
  const rawText = String(text || '')
  const key = String(keyword || '').trim()
  if (!key) return [{ text: rawText, hit: false }]
  const lower = rawText.toLowerCase()
  const lowerKey = key.toLowerCase()
  if (!lower.includes(lowerKey)) return [{ text: rawText, hit: false }]

  const parts = []
  let start = 0
  while (start < rawText.length) {
    const index = lower.indexOf(lowerKey, start)
    if (index < 0) {
      parts.push({ text: rawText.slice(start), hit: false })
      break
    }
    if (index > start) {
      parts.push({ text: rawText.slice(start, index), hit: false })
    }
    parts.push({ text: rawText.slice(index, index + lowerKey.length), hit: true })
    start = index + lowerKey.length
  }
  return parts
}

function App() {
  const api = useMemo(() => buildApi(), [])

  const [booting, setBooting] = useState(true)
  const [authRedirecting, setAuthRedirecting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [activeMenu, setActiveMenu] = useState('articles')

  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState({ items: [], total: 0, page: 1, limit: 20 })
  const [searchSuggestions, setSearchSuggestions] = useState([])
  const [articlesLoading, setArticlesLoading] = useState(false)
  const [stats, setStats] = useState({
    article_total: 0,
    recycle_total: 0,
    published_total: 0,
    draft_total: 0,
    archived_total: 0,
    views_total: 0,
    favorites_total: 0,
    today_views: 0,
    feedback_total: 0,
    feedback_solved_total: 0,
    publish_pending_total: 0,
  })
  const [logs, setLogs] = useState({ items: [], total: 0, page: 1, limit: 20 })
  const [outboxEvents, setOutboxEvents] = useState([])
  const [trendStats, setTrendStats] = useState([])
  const [topStats, setTopStats] = useState([])
  const [categoryForm, setCategoryForm] = useState({
    id: null,
    name: '',
    parent_id: '',
    library_scope: 'department',
    department_code: '',
    sort_order: '0',
    is_active: true,
  })
  const [categorySubmitting, setCategorySubmitting] = useState(false)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState([])
  const [categoryDeleting, setCategoryDeleting] = useState(false)

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [libraryFilter, setLibraryFilter] = useState('all')
  const [categoryScopeFilter, setCategoryScopeFilter] = useState('all')
  const [categoryDepartmentFilter, setCategoryDepartmentFilter] = useState('')
  const [recycleMode, setRecycleMode] = useState(false)
  const [rowDensity, setRowDensity] = useState('comfortable')
  const [articleComposerOpen, setArticleComposerOpen] = useState(false)

  const [articleForm, setArticleForm] = useState({
    title: '',
    summary: '',
    tagsText: '',
    category_id: '',
    library_scope: 'department',
    department_code: '',
  })
  const [uploadingArticleId, setUploadingArticleId] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [batchAction, setBatchAction] = useState('archive')
  const [batchCategoryId, setBatchCategoryId] = useState('')
  const [batchRetentionDays, setBatchRetentionDays] = useState('30')
  const [batchLoading, setBatchLoading] = useState(false)
  const [favorites, setFavorites] = useState([])
  const [recentItems, setRecentItems] = useState([])
  const [contentHealth, setContentHealth] = useState(null)
  const [pinRecommendations, setPinRecommendations] = useState({ loading: false, generated_at: null, candidates: [] })
  const [accessRequests, setAccessRequests] = useState({ mine: [], incoming: [] })
  const [accessRequestsLoading, setAccessRequestsLoading] = useState(false)

  const [selectedArticle, setSelectedArticle] = useState(null)
  const [versions, setVersions] = useState([])
  const [previewVersion, setPreviewVersion] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, article: null, loading: false, retention_days: 30 })
  const [editArticleDialog, setEditArticleDialog] = useState({
    open: false,
    submitting: false,
    articleId: null,
    title: '',
    summary: '',
    category_id: '',
    library_scope: 'department',
    department_code: '',
  })
  const [detailModalOffset, setDetailModalOffset] = useState(() => {
    const pref = readDetailModalPref()
    return { x: pref.x, y: pref.y }
  })
  const [detailModalWidth, setDetailModalWidth] = useState(() => readDetailModalPref().width)
  const [draggingDetailModal, setDraggingDetailModal] = useState(false)
  const [previewFullscreen, setPreviewFullscreen] = useState(false)
  const [compareState, setCompareState] = useState({
    leftVersionId: '',
    rightVersionId: '',
    loading: false,
    result: null,
  })
  const [publishDialog, setPublishDialog] = useState({
    open: false,
    loading: false,
    submitting: false,
    targetVersionId: '',
    note: '',
    mode: 'direct',
    checks: [],
    lock: null,
  })
  const [feedbackState, setFeedbackState] = useState({
    loading: false,
    solved: '',
    reason_code: '',
    reason_text: '',
    summary: null,
  })
  const [publishRequests, setPublishRequests] = useState({ items: [], total: 0, page: 1, limit: 20, loading: false, status: 'pending' })

  const [editorVisible, setEditorVisible] = useState(false)
  const [editorPayload, setEditorPayload] = useState(null)
  const [editorContainerId, setEditorContainerId] = useState('doc-editor-container')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorScriptReady, setEditorScriptReady] = useState(false)
  const [editorScriptError, setEditorScriptError] = useState('')
  const [editorStatus, setEditorStatus] = useState(null)
  const [editorCollabMode, setEditorCollabMode] = useState('single')
  const [editorSections, setEditorSections] = useState([])
  const [editorSectionKey, setEditorSectionKey] = useState('')
  const [editorSectionLoading, setEditorSectionLoading] = useState(false)
  const [editorOnline, setEditorOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const docEditorRef = useRef(null)
  const detailModalRef = useRef(null)
  const detailDragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 })
  const previewStageRef = useRef(null)

  const roleKey = String(user?.role || '').toLowerCase()
  const isAdmin = roleKey === 'admin'
  const isAuditor = roleKey === 'auditor' || !!user?.permissions?.can_view_audit
  const isWriter = !!user?.permissions?.can_write_faq || isAdmin || roleKey === 'editor'
  const isReviewer = !!user?.permissions?.can_review_publish || isAdmin || roleKey === 'reviewer'
  const currentDepartment = user?.scope?.department || null
  const currentDepartmentCode = String(currentDepartment?.code || '').trim().toUpperCase()
  const managedDepartments = Array.isArray(user?.scope?.managedDepartments) ? user.scope.managedDepartments : []
  const managedDepartmentCodes = useMemo(
    () => Array.from(new Set(managedDepartments.map((item) => String(item?.code || '').trim().toUpperCase()).filter(Boolean))),
    [managedDepartments]
  )
  const canManageDepartmentDocs = managedDepartmentCodes.length > 0
  const canManageGlobalLibrary = !!user?.permissions?.can_manage_global_library || isAdmin
  const canManageArticles = isWriter || canManageDepartmentDocs
  const canManageCategories = isWriter || canManageDepartmentDocs || canManageGlobalLibrary
  const canReviewAccessRequests = isAdmin || canManageDepartmentDocs
  const isFaqBasicUser = roleKey === 'viewer' && !isWriter && !isReviewer && !isAuditor && !canManageDepartmentDocs

  const departmentNameMap = useMemo(() => {
    const pairs = []
    if (currentDepartmentCode) {
      pairs.push([currentDepartmentCode, String(currentDepartment?.name || currentDepartmentCode)])
    }
    managedDepartments.forEach((item) => {
      const code = String(item?.code || '').trim().toUpperCase()
      if (code) pairs.push([code, String(item?.name || code)])
    })
    categories.forEach((item) => {
      const code = String(item?.department_code || '').trim().toUpperCase()
      if (code) pairs.push([code, code])
    })
    articles.items.forEach((item) => {
      const code = String(item?.department_code || '').trim().toUpperCase()
      if (code) pairs.push([code, code])
    })
    return new Map(pairs)
  }, [articles.items, categories, currentDepartment, currentDepartmentCode, managedDepartments])

  const departmentOptions = useMemo(() => {
    const options = []
    const pushOption = (code, name) => {
      const normalized = String(code || '').trim().toUpperCase()
      if (!normalized || options.some((item) => item.code === normalized)) return
      options.push({ code: normalized, name: String(name || normalized) })
    }
    if (currentDepartmentCode) {
      pushOption(currentDepartmentCode, currentDepartment?.name || currentDepartmentCode)
    }
    managedDepartments.forEach((item) => pushOption(item?.code, item?.name))
    categories.forEach((item) => pushOption(item?.department_code, departmentNameMap.get(String(item?.department_code || '').trim().toUpperCase())))
    articles.items.forEach((item) => pushOption(item?.department_code, departmentNameMap.get(String(item?.department_code || '').trim().toUpperCase())))
    return options
  }, [articles.items, categories, currentDepartment, currentDepartmentCode, departmentNameMap, managedDepartments])

  const favoriteIdSet = useMemo(
    () => new Set((favorites || []).map((item) => Number(item.article_id)).filter((id) => Number.isFinite(id) && id > 0)),
    [favorites]
  )

  const latestAccessRequestByArticleId = useMemo(() => {
    const map = new Map()
    ;(Array.isArray(accessRequests.mine) ? accessRequests.mine : []).forEach((item) => {
      const articleId = Number(item?.article_id || 0)
      if (!articleId) return
      if (!map.has(articleId) || Number(map.get(articleId)?.id || 0) < Number(item?.id || 0)) {
        map.set(articleId, item)
      }
    })
    return map
  }, [accessRequests.mine])

  const filteredCategories = useMemo(() => {
    return categories.filter((item) => {
      const scope = String(item?.library_scope || 'department').trim().toLowerCase() || 'department'
      const departmentCode = String(item?.department_code || '').trim().toUpperCase()
      if (categoryScopeFilter === 'global') return scope === 'global'
      if (categoryScopeFilter === 'department') {
        if (scope !== 'department') return false
        if (!categoryDepartmentFilter) return true
        return departmentCode === String(categoryDepartmentFilter || '').trim().toUpperCase()
      }
      return true
    })
  }, [categories, categoryDepartmentFilter, categoryScopeFilter])
  const allCategoryIds = useMemo(
    () => filteredCategories.map((item) => Number(item?.id || 0)).filter((id) => Number.isFinite(id) && id > 0),
    [filteredCategories]
  )
  const allCategoriesSelected = allCategoryIds.length > 0 && selectedCategoryIds.length === allCategoryIds.length

  const articleFormCategories = useMemo(() => {
    const scope = String(articleForm.library_scope || 'department').trim().toLowerCase() || 'department'
    const departmentCode = String(articleForm.department_code || '').trim().toUpperCase()
    return categories.filter((item) => {
      const itemScope = String(item?.library_scope || 'department').trim().toLowerCase() || 'department'
      const itemDepartmentCode = String(item?.department_code || '').trim().toUpperCase()
      if (itemScope !== scope) return false
      if (scope === 'department') return itemDepartmentCode === departmentCode
      return true
    })
  }, [articleForm.department_code, articleForm.library_scope, categories])

  const editArticleCategories = useMemo(() => {
    const scope = String(editArticleDialog.library_scope || 'department').trim().toLowerCase() || 'department'
    const departmentCode = String(editArticleDialog.department_code || '').trim().toUpperCase()
    return categories.filter((item) => {
      const itemScope = String(item?.library_scope || 'department').trim().toLowerCase() || 'department'
      const itemDepartmentCode = String(item?.department_code || '').trim().toUpperCase()
      if (itemScope !== scope) return false
      if (scope === 'department') return itemDepartmentCode === departmentCode
      return true
    })
  }, [categories, editArticleDialog.department_code, editArticleDialog.library_scope])

  const resetFeedback = () => {
    setMessage('')
    setError('')
  }

  const departmentLabel = (departmentCode) => {
    const code = String(departmentCode || '').trim().toUpperCase()
    if (!code) return '全公司'
    return departmentNameMap.get(code) || code
  }

  const canManageArticleItem = (article) => {
    const scope = String(article?.library_scope || 'department').trim().toLowerCase() || 'department'
    const departmentCode = String(article?.department_code || '').trim().toUpperCase()
    if (scope === 'global') return canManageGlobalLibrary
    if (!departmentCode) return false
    return isAdmin || managedDepartmentCodes.includes(departmentCode) || (isWriter && currentDepartmentCode === departmentCode)
  }

  const loadEditorScript = async () => {
    if (window.DocsAPI?.DocEditor) {
      setEditorScriptReady(true)
      setEditorScriptError('')
      return true
    }

    return new Promise((resolve) => {
      const src = '/doc-editor/web-apps/apps/api/documents/api.js'
      const existed = document.querySelector(`script[src="${src}"]`)
      if (existed) {
        existed.addEventListener('load', () => {
          setEditorScriptReady(true)
          setEditorScriptError('')
          resolve(true)
        })
        existed.addEventListener('error', () => {
          setEditorScriptReady(false)
          setEditorScriptError('OnlyOffice 编辑服务不可用，已降级为预览+下载。')
          resolve(false)
        })
        return
      }

      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onload = () => {
        setEditorScriptReady(true)
        setEditorScriptError('')
        resolve(true)
      }
      script.onerror = () => {
        setEditorScriptReady(false)
        setEditorScriptError('OnlyOffice 编辑服务不可用，已降级为预览+下载。')
        resolve(false)
      }
      document.body.appendChild(script)
    })
  }

  const fetchBootstrap = async () => {
    setBooting(true)
    setAuthRedirecting(false)
    setRecycleMode(false)
    setSelectedIds([])
    resetFeedback()
    setEditorScriptError('')
    let redirectedToLogin = false
    try {
      const me = await api.get('/api/auth/me')
      setUser(me)
      const meRole = String(me?.role || '').toLowerCase()
      const meCanWrite = meRole === 'admin' || meRole === 'editor' || !!me?.permissions?.can_write_faq
      const meCanAudit = meRole === 'auditor' || !!me?.permissions?.can_view_audit
      const meCanManageDocs = meCanWrite || Array.isArray(me?.scope?.managedDepartments) && me.scope.managedDepartments.length > 0
      const meDepartmentCode = String(me?.scope?.department?.code || '').trim().toUpperCase()

      const [categoryData, articleData, overview, favoriteData, recentData, accessRequestData] = await Promise.all([
        api.get('/api/faq/categories'),
        api.get('/api/faq/articles?page=1&limit=20'),
        api.get('/api/faq/stats/overview'),
        api.get('/api/faq/favorites'),
        api.get('/api/faq/recent?limit=8'),
        api.get('/api/faq/access-requests').catch(() => ({ mine: [], incoming: [] })),
      ])
      const [healthData, pinData, trendData, topData, outboxData] = await Promise.all([
        api.get('/api/faq/stats/content-health').catch(() => null),
        meCanWrite ? api.get('/api/faq/pin/recommendations').catch(() => ({ generated_at: null, candidates: [] })) : Promise.resolve(null),
        api.get('/api/faq/stats/trend?days=14').catch(() => []),
        api.get('/api/faq/stats/top?limit=10').catch(() => []),
        meCanAudit ? api.get('/api/faq/events/outbox?limit=50').catch(() => []) : Promise.resolve([]),
      ])

      setCategories(Array.isArray(categoryData) ? categoryData : [])
      setArticles(normalizeList(articleData))
      setSearchSuggestions(Array.isArray(articleData?.suggestions) ? articleData.suggestions : [])
      setStats(overview || {})
      setFavorites(Array.isArray(favoriteData) ? favoriteData : [])
      setRecentItems(Array.isArray(recentData) ? recentData : [])
      setAccessRequests({
        mine: Array.isArray(accessRequestData?.mine) ? accessRequestData.mine : [],
        incoming: Array.isArray(accessRequestData?.incoming) ? accessRequestData.incoming : [],
      })
      setContentHealth(healthData || null)
      setPinRecommendations({
        loading: false,
        generated_at: pinData?.generated_at || null,
        candidates: Array.isArray(pinData?.candidates) ? pinData.candidates : [],
      })
      setTrendStats(Array.isArray(trendData) ? trendData : [])
      setTopStats(Array.isArray(topData) ? topData : [])
      setOutboxEvents(Array.isArray(outboxData) ? outboxData : [])
      setArticleForm((prev) => ({
        ...prev,
        library_scope: meRole === 'admin' ? prev.library_scope : 'department',
        department_code: prev.department_code || meDepartmentCode,
      }))
      setEditArticleDialog((prev) => ({
        ...prev,
        library_scope: prev.library_scope || 'department',
        department_code: prev.department_code || meDepartmentCode,
      }))
      setCategoryForm((prev) => ({
        ...prev,
        library_scope: meRole === 'admin' ? prev.library_scope : 'department',
        department_code: prev.department_code || meDepartmentCode,
      }))
      setCategoryDepartmentFilter((prev) => prev || meDepartmentCode)
      if (meCanManageDocs) {
        await loadEditorScript()
      } else {
        setEditorScriptReady(false)
      }
    } catch (err) {
      if (Number(err?.status) === 401 || String(err?.message || '').includes('未登录')) {
        redirectedToLogin = true
        setAuthRedirecting(true)
        window.location.replace(buildPortalEntryUrl('faq'))
        return
      }
      setError(err.message || '初始化失败')
    } finally {
      if (!redirectedToLogin) {
        setBooting(false)
      }
    }
  }

  const fetchArticles = async (page = 1, options = {}) => {
    const mode = options?.recycle === true ? true : options?.recycle === false ? false : recycleMode
    if (!options?.silent) setArticlesLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (keyword.trim()) params.set('keyword', keyword.trim())
    if (statusFilter) params.set('status', statusFilter)
    if (categoryFilter) params.set('category_id', categoryFilter)
    if (libraryFilter !== 'all') params.set('library_scope', libraryFilter)
    if (mode) params.set('recycle', '1')

    try {
      const data = await api.get(`/api/faq/articles?${params.toString()}`)
      setArticles(normalizeList(data))
      setSearchSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : [])
      if (options?.clearSelection !== false) setSelectedIds([])
    } finally {
      if (!options?.silent) setArticlesLoading(false)
    }
  }

  const fetchAccessRequests = async () => {
    setAccessRequestsLoading(true)
    try {
      const data = await api.get('/api/faq/access-requests')
      setAccessRequests({
        mine: Array.isArray(data?.mine) ? data.mine : [],
        incoming: Array.isArray(data?.incoming) ? data.incoming : [],
      })
    } catch (err) {
      setError(err.message || '读取跨部门申请失败')
    } finally {
      setAccessRequestsLoading(false)
    }
  }

  const refreshContentHealth = async () => {
    try {
      const data = await api.get('/api/faq/stats/content-health')
      setContentHealth(data || null)
    } catch (err) {
      setError(err.message || '读取内容健康度失败')
    }
  }

  const refreshPinRecommendations = async () => {
    if (!isWriter) return
    setPinRecommendations((prev) => ({ ...prev, loading: true }))
    try {
      const data = await api.get('/api/faq/pin/recommendations')
      setPinRecommendations({
        loading: false,
        generated_at: data?.generated_at || null,
        candidates: Array.isArray(data?.candidates) ? data.candidates : [],
      })
    } catch (err) {
      setPinRecommendations((prev) => ({ ...prev, loading: false }))
      setError(err.message || '读取智能置顶建议失败')
    }
  }

  const onApplySmartPin = async () => {
    if (!isAdmin || pinRecommendations.loading) return
    resetFeedback()
    setPinRecommendations((prev) => ({ ...prev, loading: true }))
    try {
      const payload = await api.post('/api/faq/pin/recommendations/apply', {})
      setMessage(`智能置顶已应用：${payload?.applied || 0} 篇`)
      await fetchArticles(articles.page || 1, { clearSelection: false })
      await refreshPinRecommendations()
    } catch (err) {
      setPinRecommendations((prev) => ({ ...prev, loading: false }))
      setError(err.message || '应用智能置顶失败')
    }
  }

  const onResetFilters = () => {
    setKeyword('')
    setStatusFilter('')
    setCategoryFilter('')
    setLibraryFilter('all')
    setSearchSuggestions([])
    fetchArticles(1, { clearSelection: true, recycle: recycleMode })
  }

  const onApplySuggestion = (suggestion) => {
    if (!suggestion) return
    const title = String(suggestion.title || '').trim()
    if (title) {
      setKeyword(title)
      setTimeout(() => {
        fetchArticles(1)
      }, 0)
    }
  }

  const resetCategoryForm = () => {
    setCategoryForm({
      id: null,
      name: '',
      parent_id: '',
      library_scope: isAdmin ? 'global' : 'department',
      department_code: currentDepartmentCode,
      sort_order: '0',
      is_active: true,
    })
  }

  const refreshCategories = async () => {
    const refreshed = await api.get('/api/faq/categories')
    const rows = Array.isArray(refreshed) ? refreshed : []
    const validIds = new Set(rows.map((item) => Number(item?.id || 0)).filter((id) => Number.isFinite(id) && id > 0))
    setCategories(rows)
    setSelectedCategoryIds((prev) => prev.filter((id) => validIds.has(Number(id))))
    if (Number(categoryForm.id || 0) > 0 && !validIds.has(Number(categoryForm.id))) {
      resetCategoryForm()
    }
    return rows
  }

  const buildCategoryBatchMessage = (result, nameMap) => {
    const successCount = Number(result?.success_count || 0)
    const failureCount = Number(result?.failure_count || 0)
    if (failureCount <= 0) return `已删除 ${successCount} 个分类`

    const detail = (Array.isArray(result?.failures) ? result.failures : [])
      .slice(0, 3)
      .map((item) => {
        const id = Number(item?.id || 0)
        const label = nameMap.get(id) || `ID:${id}`
        return `${label}：${String(item?.error || '删除失败').trim() || '删除失败'}`
      })
      .join('；')
    return `删除完成：成功 ${successCount} 个，失败 ${failureCount} 个${detail ? `。${detail}` : ''}`
  }

  const buildCategoryForceDeleteMessage = (result, fallbackName) => {
    const deletedCount = Number(result?.deleted_category_count || 0)
    const recycledCount = Number(result?.recycled_article_count || 0)
    if (deletedCount <= 0) return `分类「${fallbackName}」已强制删除`
    if (recycledCount <= 0) return `已强制删除 ${deletedCount} 个分类，未发现需回收的文档`
    return `已强制删除 ${deletedCount} 个分类，${recycledCount} 篇文档已移入回收站`
  }

  const onToggleCategorySelection = (categoryId) => {
    const id = Number(categoryId || 0)
    if (id <= 0) return
    setSelectedCategoryIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ))
  }

  const onToggleAllCategories = () => {
    if (!allCategoryIds.length) return
    setSelectedCategoryIds(allCategoriesSelected ? [] : allCategoryIds)
  }

  const onDeleteCategory = async (item) => {
    const id = Number(item?.id || 0)
    if (!canManageCategories || categoryDeleting || id <= 0) return
    const name = String(item?.name || '').trim() || `ID:${id}`
    const ok = window.confirm(`确定删除分类「${name}」吗？`)
    if (!ok) return

    resetFeedback()
    setCategoryDeleting(true)
    try {
      await api.delete(`/api/faq/categories/${id}`)
      await refreshCategories()
      setMessage(`分类「${name}」已删除`)
    } catch (err) {
      setError(err.message || '分类删除失败')
    } finally {
      setCategoryDeleting(false)
    }
  }

  const onForceDeleteCategory = async (item) => {
    const id = Number(item?.id || 0)
    if (!isAdmin || categoryDeleting || id <= 0) return
    const name = String(item?.name || '').trim() || `ID:${id}`
    const ok = window.confirm(
      `确定强制删除分类「${name}」吗？\n\n这会递归删除所有子分类，并将关联文档移入回收站。\n已删除文档恢复后会变成未分类。`
    )
    if (!ok) return

    resetFeedback()
    setCategoryDeleting(true)
    try {
      const result = await api.post(`/api/faq/categories/${id}/force-delete`)
      await refreshCategories()
      setMessage(buildCategoryForceDeleteMessage(result, name))
    } catch (err) {
      setError(err.message || '强制删除分类失败')
    } finally {
      setCategoryDeleting(false)
    }
  }

  const onBatchDeleteCategories = async () => {
    if (!canManageCategories || categoryDeleting || !selectedCategoryIds.length) return
    const nameMap = new Map(categories.map((item) => [Number(item.id || 0), String(item.name || '').trim() || `ID:${item.id}`]))
    const ok = window.confirm(`确定批量删除已选中的 ${selectedCategoryIds.length} 个分类吗？`)
    if (!ok) return

    resetFeedback()
    setCategoryDeleting(true)
    try {
      const result = await api.post('/api/faq/categories/batch-delete', { ids: selectedCategoryIds })
      await refreshCategories()
      setMessage(buildCategoryBatchMessage(result, nameMap))
    } catch (err) {
      setError(err.message || '批量删除分类失败')
    } finally {
      setCategoryDeleting(false)
    }
  }

  const onEditCategory = (item) => {
    if (!canManageCategories || !item) return
    resetFeedback()
    setCategoryForm({
      id: Number(item.id) || null,
      name: String(item.name || ''),
      parent_id: item.parent_id ? String(item.parent_id) : '',
      library_scope: String(item.library_scope || 'department').trim().toLowerCase() || 'department',
      department_code: String(item.department_code || '').trim().toUpperCase(),
      sort_order: String(Number(item.sort_order || 0)),
      is_active: Number(item.is_active || 0) === 1,
    })
  }

  const onSubmitCategory = async (event) => {
    event.preventDefault()
    if (!canManageCategories || categorySubmitting) return
    resetFeedback()

    const name = String(categoryForm.name || '').trim()
    if (!name) {
      setError('分类名称不能为空')
      return
    }

    const parentIdNum = Number(categoryForm.parent_id || 0)
    const currentId = Number(categoryForm.id || 0)
    if (currentId > 0 && parentIdNum > 0 && parentIdNum === currentId) {
      setError('父级分类不能选择自己')
      return
    }

    const payload = {
      name,
      parent_id: parentIdNum > 0 ? parentIdNum : null,
      library_scope: categoryForm.library_scope === 'global' ? 'global' : 'department',
      department_code: categoryForm.library_scope === 'global' ? null : (String(categoryForm.department_code || '').trim().toUpperCase() || null),
      sort_order: Number.isFinite(Number(categoryForm.sort_order)) ? Number(categoryForm.sort_order) : 0,
      is_active: categoryForm.is_active ? 1 : 0,
    }
    if (payload.library_scope === 'department' && !payload.department_code) {
      setError('部门库分类必须选择归属部门')
      return
    }

    setCategorySubmitting(true)
    try {
      if (currentId > 0) {
        await api.put(`/api/faq/categories/${currentId}`, payload)
        setMessage('分类已更新')
      } else {
        await api.post('/api/faq/categories', payload)
        setMessage('分类已创建')
      }
      await refreshCategories()
      resetCategoryForm()
    } catch (err) {
      setError(err.message || '分类保存失败')
    } finally {
      setCategorySubmitting(false)
    }
  }

  const fetchLogs = async () => {
    try {
      const data = await api.get('/api/faq/logs?page=1&limit=20')
      setLogs(normalizeList(data))
    } catch (err) {
      setError(err.message || '读取审计日志失败')
    }
  }

  const fetchOutboxEvents = async () => {
    if (!isAuditor) return
    try {
      const data = await api.get('/api/faq/events/outbox?limit=50')
      setOutboxEvents(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || '读取事件出站队列失败')
    }
  }

  const refreshTrendStats = async () => {
    try {
      const data = await api.get('/api/faq/stats/trend?days=14')
      setTrendStats(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || '读取访问趋势失败')
    }
  }

  const refreshTopStats = async () => {
    try {
      const data = await api.get('/api/faq/stats/top?limit=10')
      setTopStats(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || '读取热门文档失败')
    }
  }

  const onPurgeRecycle = async () => {
    if (!isAdmin) return
    resetFeedback()
    try {
      const data = await api.post('/api/faq/recycle/purge', {})
      setMessage(`回收站清理完成：${Number(data?.purged || 0)} 篇`)
      const overview = await api.get('/api/faq/stats/overview')
      setStats(overview || {})
      if (recycleMode) await fetchArticles(articles.page || 1, { clearSelection: true, recycle: true })
      await refreshContentHealth()
    } catch (err) {
      setError(err.message || '执行回收站清理失败')
    }
  }

  const onReindexSearchText = async () => {
    if (!isAdmin) return
    resetFeedback()
    try {
      const data = await api.post('/api/faq/reindex/search-text', { limit: 500 })
      setMessage(`搜索重建完成：扫描 ${Number(data?.scanned || 0)}，更新 ${Number(data?.updated || 0)}`)
    } catch (err) {
      setError(err.message || '执行搜索重建失败')
    }
  }

  const fetchPublishRequests = async (status = 'pending', page = 1) => {
    setPublishRequests((prev) => ({ ...prev, loading: true, status }))
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '20')
      if (status) params.set('status', status)
      const data = await api.get(`/api/faq/publish-requests?${params.toString()}`)
      const normalized = normalizeList(data)
      setPublishRequests({
        ...normalized,
        status,
        loading: false,
      })
    } catch (err) {
      setPublishRequests((prev) => ({ ...prev, loading: false }))
      setError(err.message || '读取发布审批失败')
    }
  }

  const openArticle = async (id) => {
    resetFeedback()
    try {
      const [detail, versionRows] = await Promise.all([
        api.get(`/api/faq/articles/${id}`),
        api.get(`/api/faq/articles/${id}/versions`),
      ])
      const versionList = Array.isArray(versionRows) ? versionRows : []
      const activePreview = detail?.published_version || detail?.current_version || (versionList[0] || null)
      setSelectedArticle(detail)
      setVersions(versionList)
      setPreviewVersion(activePreview)
      setCompareState({
        leftVersionId: versionList[1]?.id ? String(versionList[1].id) : '',
        rightVersionId: versionList[0]?.id ? String(versionList[0].id) : '',
        loading: false,
        result: null,
      })
      const myFeedback = detail?.feedback_summary?.my_feedback || null
      setFeedbackState({
        loading: false,
        solved: myFeedback ? (myFeedback.solved ? 'yes' : 'no') : '',
        reason_code: myFeedback?.reason_code || '',
        reason_text: myFeedback?.reason_text || '',
        summary: detail?.feedback_summary || null,
      })
      setPublishDialog({
        open: false,
        loading: false,
        submitting: false,
        targetVersionId: activePreview?.id ? String(activePreview.id) : '',
        note: '',
        mode: isReviewer ? 'direct' : 'review',
        checks: [],
        lock: null,
      })
      await api.post(`/api/faq/articles/${id}/view`, {})
      try {
        const recentData = await api.get('/api/faq/recent?limit=8')
        setRecentItems(Array.isArray(recentData) ? recentData : [])
      } catch {
        // ignore recent refresh error
      }
    } catch (err) {
      setError(err.message || '读取文章失败')
    }
  }

  const onCreateArticle = async (e) => {
    e.preventDefault()
    if (!canManageArticles) return
    resetFeedback()

    try {
      const payload = {
        title: articleForm.title,
        summary: articleForm.summary,
        tags: parseTagsText(articleForm.tagsText),
        category_id: articleForm.category_id || undefined,
        library_scope: articleForm.library_scope,
        department_code: articleForm.library_scope === 'department' ? (articleForm.department_code || undefined) : undefined,
      }
      const created = await api.post('/api/faq/articles', {
        ...payload,
      })
      setArticleForm({
        title: '',
        summary: '',
        tagsText: '',
        category_id: '',
        library_scope: isAdmin ? articleForm.library_scope : 'department',
        department_code: articleForm.department_code || currentDepartmentCode,
      })
      setArticleComposerOpen(false)
      setMessage(`已创建文档：${created.title}`)
      await fetchArticles(1)
      await openArticle(created.id)
    } catch (err) {
      setError(err.message || '创建失败')
    }
  }

  const onUploadVersion = async (articleId, file) => {
    if (!selectedArticleManageable) return
    if (!file) return
    resetFeedback()

    try {
      setUploadingArticleId(articleId)
      const formData = new FormData()
      formData.append('file', file)
      const version = await api.postForm(`/api/faq/articles/${articleId}/upload`, formData)
      setMessage(`版本上传成功：v${version.version_no}`)
      await fetchArticles(articles.page || 1)
      await openArticle(articleId)
    } catch (err) {
      setError(err.message || '上传失败')
    } finally {
      setUploadingArticleId(null)
    }
  }

  const onOpenPublishDialog = async () => {
    if (!selectedArticle?.id || !selectedArticleManageable) return
    resetFeedback()
    const targetVersionId = Number(previewVersion?.id || selectedArticle?.current_version?.id || 0)
    setPublishDialog((prev) => ({
      ...prev,
      open: true,
      loading: true,
      targetVersionId: targetVersionId > 0 ? String(targetVersionId) : '',
      mode: isReviewer ? 'direct' : 'review',
      checks: [],
      lock: null,
    }))

    try {
      const payload = await api.post(`/api/faq/articles/${selectedArticle.id}/publish/check`, {
        version_id: targetVersionId > 0 ? targetVersionId : undefined,
      })
      setPublishDialog((prev) => ({
        ...prev,
        open: true,
        loading: false,
        checks: Array.isArray(payload?.checks) ? payload.checks : [],
        lock: payload?.active_lock || null,
        mode: payload?.requires_review ? 'review' : prev.mode,
      }))
    } catch (err) {
      setPublishDialog((prev) => ({ ...prev, loading: false }))
      setError(err.message || '发布校验失败')
    }
  }

  const onClosePublishDialog = () => {
    if (publishDialog.submitting) return
    setPublishDialog((prev) => ({ ...prev, open: false, loading: false, submitting: false }))
  }

  const onRefreshPublishCheck = async () => {
    if (!selectedArticle?.id) return
    setPublishDialog((prev) => ({ ...prev, loading: true }))
    try {
      const payload = await api.post(`/api/faq/articles/${selectedArticle.id}/publish/check`, {
        version_id: Number(publishDialog.targetVersionId || 0) || undefined,
      })
      setPublishDialog((prev) => ({
        ...prev,
        loading: false,
        checks: Array.isArray(payload?.checks) ? payload.checks : [],
        lock: payload?.active_lock || null,
      }))
    } catch (err) {
      setPublishDialog((prev) => ({ ...prev, loading: false }))
      setError(err.message || '发布校验失败')
    }
  }

  const onSubmitPublish = async () => {
    if (!selectedArticle?.id || publishDialog.submitting) return
    resetFeedback()
    const note = String(publishDialog.note || '').trim()
    if (!note) {
      setError('请填写发布说明')
      return
    }

    const targetVersionId = Number(publishDialog.targetVersionId || selectedArticle?.current_version?.id || 0)
    setPublishDialog((prev) => ({ ...prev, submitting: true }))
    try {
      const payload = await api.post(`/api/faq/articles/${selectedArticle.id}/publish`, {
        version_id: targetVersionId > 0 ? targetVersionId : undefined,
        publish_note: note,
        mode: publishDialog.mode,
      })
      if (payload?.mode === 'review') {
        setMessage('已提交发布审批，等待审核处理')
      } else {
        setMessage('文章已发布')
      }
      setPublishDialog((prev) => ({ ...prev, submitting: false, open: false }))
      await fetchArticles(articles.page || 1)
      await openArticle(selectedArticle.id)
      const overview = await api.get('/api/faq/stats/overview')
      setStats(overview || {})
      if (isReviewer && activeMenu === 'approvals') {
        await fetchPublishRequests(publishRequests.status || 'pending', publishRequests.page || 1)
      }
    } catch (err) {
      setPublishDialog((prev) => ({ ...prev, submitting: false }))
      setError(err.message || '发布失败')
    }
  }

  const onReviewPublishRequest = async (requestId, action) => {
    if (!isReviewer) return
    resetFeedback()
    const comment = window.prompt(action === 'approve' ? '审批备注（可选）' : '拒绝原因（可选）', '') || ''
    try {
      await api.post(`/api/faq/publish-requests/${requestId}/review`, {
        action,
        comment,
      })
      setMessage(action === 'approve' ? '审批通过并已发布' : '审批已拒绝')
      await fetchPublishRequests(publishRequests.status || 'pending', publishRequests.page || 1)
      await fetchArticles(articles.page || 1, { silent: true })
      const overview = await api.get('/api/faq/stats/overview')
      setStats(overview || {})
      if (selectedArticle?.id) await openArticle(selectedArticle.id)
    } catch (err) {
      setError(err.message || '审批失败')
    }
  }

  const onRequestArticleAccess = async (article) => {
    const articleId = Number(article?.id || 0)
    if (articleId <= 0) return
    resetFeedback()
    const reason = window.prompt('填写申请原因（可选）', '') || ''
    try {
      await api.post(`/api/faq/articles/${articleId}/access-requests`, {
        reason: String(reason || '').trim(),
      })
      setMessage(`已提交《${article?.title || `#${articleId}`}》查看申请`)
      await fetchAccessRequests()
      await fetchArticles(articles.page || 1, { clearSelection: false, silent: true })
    } catch (err) {
      setError(err.message || '提交查看申请失败')
    }
  }

  const onReviewAccessRequest = async (requestRow, status) => {
    const requestId = Number(requestRow?.id || 0)
    if (!requestId) return
    resetFeedback()
    const reviewComment = window.prompt(status === 'approved' ? '审批备注（可选）' : '拒绝原因（可选）', '') || ''
    let durationCode = '7d'
    if (status === 'approved') {
      const picked = window.prompt('授权时效：输入 7、30 或 long', '30') || '30'
      durationCode = picked === '30' ? '30d' : (String(picked).toLowerCase() === 'long' ? 'long_term' : '7d')
    }
    try {
      await api.post(`/api/faq/access-requests/${requestId}/review`, {
        status,
        review_comment: String(reviewComment || '').trim(),
        duration_code: durationCode,
      })
      setMessage(status === 'approved' ? '跨部门查看申请已通过' : '跨部门查看申请已拒绝')
      await fetchAccessRequests()
      await fetchArticles(articles.page || 1, { clearSelection: false, silent: true })
    } catch (err) {
      setError(err.message || '处理申请失败')
    }
  }

  const onCompareVersions = async () => {
    if (!selectedArticle?.id || compareState.loading) return
    const left = Number(compareState.leftVersionId || 0)
    const right = Number(compareState.rightVersionId || 0)
    if (!left || !right || left === right) {
      setError('请选择两个不同版本进行对比')
      return
    }
    resetFeedback()
    setCompareState((prev) => ({ ...prev, loading: true }))
    try {
      const payload = await api.get(`/api/faq/articles/${selectedArticle.id}/versions/compare?left_version_id=${left}&right_version_id=${right}`)
      setCompareState((prev) => ({ ...prev, loading: false, result: payload }))
    } catch (err) {
      setCompareState((prev) => ({ ...prev, loading: false }))
      setError(err.message || '版本对比失败')
    }
  }

  const onSubmitFeedback = async () => {
    if (!selectedArticle?.id || feedbackState.loading) return
    const solved = feedbackState.solved
    if (solved !== 'yes' && solved !== 'no') {
      setError('请先选择是否解决问题')
      return
    }
    if (solved === 'no' && !feedbackState.reason_code && !String(feedbackState.reason_text || '').trim()) {
      setError('未解决时请至少填写一个原因')
      return
    }
    resetFeedback()
    setFeedbackState((prev) => ({ ...prev, loading: true }))
    try {
      await api.post(`/api/faq/articles/${selectedArticle.id}/feedback`, {
        solved: solved === 'yes',
        reason_code: solved === 'no' ? feedbackState.reason_code || 'other' : null,
        reason_text: solved === 'no' ? String(feedbackState.reason_text || '').trim() : '',
        version_id: Number(previewVersion?.id || selectedArticle?.published_version?.id || selectedArticle?.current_version?.id || 0) || undefined,
      })
      const summary = await api.get(`/api/faq/articles/${selectedArticle.id}/feedback/summary`)
      setFeedbackState((prev) => ({
        ...prev,
        loading: false,
        summary,
        solved: summary?.my_feedback ? (summary.my_feedback.solved ? 'yes' : 'no') : prev.solved,
        reason_code: summary?.my_feedback?.reason_code || prev.reason_code,
        reason_text: summary?.my_feedback?.reason_text || prev.reason_text,
      }))
      setMessage('反馈已提交，感谢你的反馈')
    } catch (err) {
      setFeedbackState((prev) => ({ ...prev, loading: false }))
      setError(err.message || '提交反馈失败')
    }
  }

  const onArchiveStatus = async (articleId) => {
    if (!isAdmin) return
    resetFeedback()
    try {
      await api.put(`/api/faq/articles/${articleId}/status`, { status: 'archived' })
      setMessage('文章已归档')
      await fetchArticles(articles.page || 1)
      await openArticle(articleId)
    } catch (err) {
      setError(err.message || '归档失败')
    }
  }

  const onTogglePin = async (articleId, pinned) => {
    if (!isAdmin) return
    resetFeedback()
    try {
      await api.put(`/api/faq/articles/${articleId}/pin`, { is_pinned: !pinned })
      setMessage(!pinned ? '已置顶' : '已取消置顶')
      await fetchArticles(articles.page || 1)
      if (selectedArticle?.id === articleId) await openArticle(articleId)
    } catch (err) {
      setError(err.message || '置顶操作失败')
    }
  }

  const onToggleFavorite = async (articleId) => {
    const id = Number(articleId)
    if (!Number.isFinite(id) || id <= 0) return
    const alreadyFavorited = favoriteIdSet.has(id)
    resetFeedback()
    try {
      if (alreadyFavorited) {
        await api.del(`/api/faq/articles/${id}/favorite`)
      } else {
        await api.post(`/api/faq/articles/${id}/favorite`, {})
      }
      const favoriteData = await api.get('/api/faq/favorites')
      setFavorites(Array.isArray(favoriteData) ? favoriteData : [])
      if (selectedArticle?.id === id) {
        setSelectedArticle((prev) => (prev ? { ...prev } : prev))
      }
      setMessage(alreadyFavorited ? '已取消收藏' : '已加入收藏')
    } catch (err) {
      setError(err.message || '收藏操作失败')
    }
  }

  const onOpenEditArticle = (article) => {
    if (!canManageArticleItem(article) || !article?.id) return
    resetFeedback()
    setEditArticleDialog({
      open: true,
      submitting: false,
      articleId: Number(article.id) || null,
      title: String(article.title || ''),
      summary: String(article.summary || ''),
      category_id: Number(article.category_id || 0) > 0 ? String(article.category_id) : '',
      library_scope: String(article.library_scope || 'department').trim().toLowerCase() || 'department',
      department_code: String(article.department_code || currentDepartmentCode || '').trim().toUpperCase(),
    })
  }

  const onCloseEditArticleDialog = () => {
    if (editArticleDialog.submitting) return
    setEditArticleDialog({
      open: false,
      submitting: false,
      articleId: null,
      title: '',
      summary: '',
      category_id: '',
      library_scope: 'department',
      department_code: currentDepartmentCode,
    })
  }

  const onSubmitEditArticle = async (event) => {
    event.preventDefault()
    if (!canManageArticles || editArticleDialog.submitting) return
    const articleId = Number(editArticleDialog.articleId || 0)
    if (!Number.isFinite(articleId) || articleId <= 0) return

    const title = String(editArticleDialog.title || '').trim()
    if (!title) {
      setError('标题不能为空')
      return
    }

    const summary = String(editArticleDialog.summary || '').trim()
    const categoryId = Number(editArticleDialog.category_id || 0)
    resetFeedback()
    setEditArticleDialog((prev) => ({ ...prev, submitting: true }))
    try {
      await api.put(`/api/faq/articles/${articleId}`, {
        title,
        summary: summary || null,
        category_id: Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null,
        library_scope: editArticleDialog.library_scope,
        department_code: editArticleDialog.library_scope === 'department' ? (editArticleDialog.department_code || null) : null,
      })
      setMessage('文档基础信息已更新')
      setEditArticleDialog({
        open: false,
        submitting: false,
        articleId: null,
        title: '',
        summary: '',
        category_id: '',
        library_scope: 'department',
        department_code: currentDepartmentCode,
      })
      await fetchArticles(articles.page || 1, { clearSelection: false })
      if (selectedArticle?.id === articleId) await openArticle(articleId)
    } catch (err) {
      setEditArticleDialog((prev) => ({ ...prev, submitting: false }))
      setError(err.message || '文档信息更新失败')
    }
  }

  const onRequestDeleteArticle = (article) => {
    if (!isAdmin || !article?.id) return
    resetFeedback()
    setDeleteConfirm({ open: true, article, loading: false, retention_days: 30 })
  }

  const onCancelDeleteArticle = () => {
    if (deleteConfirm.loading) return
    setDeleteConfirm({ open: false, article: null, loading: false, retention_days: 30 })
  }

  const onConfirmDeleteArticle = async () => {
    if (!isAdmin || !deleteConfirm.article?.id || deleteConfirm.loading) return
    resetFeedback()
    setDeleteConfirm((prev) => ({ ...prev, loading: true }))

    const target = deleteConfirm.article
    const retentionDays = Number(deleteConfirm.retention_days || 30) === 7 ? 7 : 30
    try {
      await api.del(`/api/faq/articles/${target.id}?retention_days=${retentionDays}`)
      if (selectedArticle?.id === target.id) onCloseDetailModal()
      await fetchArticles(articles.page || 1)
      const overview = await api.get('/api/faq/stats/overview')
      setStats(overview || {})
      setDeleteConfirm({ open: false, article: null, loading: false, retention_days: 30 })
      setMessage(`已移入回收站：${target.title}（${retentionDays}天后自动清理）`)
    } catch (err) {
      setDeleteConfirm((prev) => ({ ...prev, loading: false }))
      setError(err.message || '删除失败')
    }
  }

  const onToggleSelectAll = () => {
    if (!articles.items.length) return
    const visibleIds = articles.items.map((item) => Number(item.id))
    const allSelected = visibleIds.every((id) => selectedIds.includes(id))
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])))
  }

  const onToggleSelectOne = (articleId) => {
    const id = Number(articleId)
    if (!Number.isFinite(id) || id <= 0) return
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const onRestoreArticle = async (articleId) => {
    if (!isAdmin) return
    resetFeedback()
    try {
      await api.post(`/api/faq/articles/${articleId}/restore`, {})
      setMessage('文章已从回收站恢复')
      await fetchArticles(articles.page || 1)
      const overview = await api.get('/api/faq/stats/overview')
      setStats(overview || {})
    } catch (err) {
      setError(err.message || '恢复失败')
    }
  }

  const onPurgeArticle = async (article) => {
    const articleId = Number(article?.id || 0)
    if (!isAdmin || articleId <= 0) return
    const title = String(article?.title || '').trim() || `ID:${articleId}`
    const ok = window.confirm(`确定彻底删除回收站文章「${title}」吗？\n\n彻底删除后将无法恢复。`)
    if (!ok) return

    resetFeedback()
    try {
      await api.post('/api/faq/articles/batch', {
        action: 'purge',
        article_ids: [articleId],
      })
      if (selectedArticle?.id === articleId) onCloseDetailModal()
      setSelectedIds((prev) => prev.filter((id) => id !== articleId))
      setMessage(`已彻底删除：${title}`)
      await fetchArticles(articles.page || 1)
      const overview = await api.get('/api/faq/stats/overview')
      setStats(overview || {})
    } catch (err) {
      setError(err.message || '彻底删除失败')
    }
  }

  const onApplyBatchAction = async () => {
    if (!isAdmin || !selectedIds.length || batchLoading) return
    resetFeedback()

    const action = batchAction
    if (action === 'delete') {
      const ok = window.confirm('批量删除后将进入回收站，是否继续？')
      if (!ok) return
    }
    if (action === 'restore') {
      const ok = window.confirm('确认恢复选中的回收站文章？')
      if (!ok) return
    }
    if (action === 'purge') {
      const ok = window.confirm('确认彻底删除选中的回收站文章吗？\n\n彻底删除后将无法恢复。')
      if (!ok) return
    }

    setBatchLoading(true)
    try {
      const payload = {
        action,
        article_ids: selectedIds,
      }
      if (action === 'category') {
        payload.category_id = batchCategoryId || null
      }
      if (action === 'delete') {
        payload.retention_days = Number(batchRetentionDays || 30) === 7 ? 7 : 30
      }

      const result = await api.post('/api/faq/articles/batch', payload)
      setMessage(action === 'purge'
        ? `已彻底删除 ${result?.total || selectedIds.length} 条`
        : `批量操作完成：${result?.total || selectedIds.length} 条`)
      setSelectedIds([])
      await fetchArticles(articles.page || 1)
      const overview = await api.get('/api/faq/stats/overview')
      setStats(overview || {})
    } catch (err) {
      setError(err.message || '批量操作失败')
    } finally {
      setBatchLoading(false)
    }
  }

  const onRestoreVersion = async (articleId, versionId) => {
    if (!isAdmin) return
    resetFeedback()
    try {
      await api.post(`/api/faq/articles/${articleId}/versions/${versionId}/restore`, {})
      setMessage('版本已回滚并生成新版本')
      await fetchArticles(articles.page || 1)
      await openArticle(articleId)
    } catch (err) {
      setError(err.message || '回滚失败')
    }
  }

  const destroyDocEditor = () => {
    if (docEditorRef.current && typeof docEditorRef.current.destroyEditor === 'function') {
      docEditorRef.current.destroyEditor()
    }
    docEditorRef.current = null
  }

  const refreshEditorStatus = async (articleId) => {
    if (!Number.isFinite(Number(articleId)) || Number(articleId) <= 0) return null
    const payload = await api.get(`/api/faq/articles/${articleId}/editor/status`)
    setEditorStatus(payload?.lock || null)
    setEditorCollabMode(payload?.collab_mode === 'section' ? 'section' : 'single')
    setEditorSections(Array.isArray(payload?.sections) ? payload.sections : [])
    if (payload?.collab_mode === 'section') {
      setEditorSectionKey((prev) => {
        if (prev && Array.isArray(payload?.sections) && payload.sections.some((item) => item?.key === prev)) return prev
        const firstAvailable = (payload?.sections || []).find((item) => String(item?.status || '').toLowerCase() !== 'active')
        return firstAvailable?.key || payload?.sections?.[0]?.key || ''
      })
    } else {
      setEditorSectionKey('')
    }
    return payload?.lock || null
  }

  const refreshEditorSections = async (articleId) => {
    if (!Number.isFinite(Number(articleId)) || Number(articleId) <= 0) return
    const payload = await api.get(`/api/faq/articles/${articleId}/editor/sections`)
    setEditorCollabMode(payload?.collab_mode === 'section' ? 'section' : 'single')
    setEditorSections(Array.isArray(payload?.sections) ? payload.sections : [])
  }

  const onLockEditorSection = async () => {
    if (!selectedArticleManageable || !selectedArticle?.id || !editorSectionKey || editorSectionLoading) return
    resetFeedback()
    setEditorSectionLoading(true)
    try {
      const payload = await api.post(`/api/faq/articles/${selectedArticle.id}/editor/sections/lock`, {
        section_key: editorSectionKey,
      })
      setEditorSections(Array.isArray(payload?.sections) ? payload.sections : [])
      await refreshEditorStatus(selectedArticle.id)
      setMessage('分段已锁定')
    } catch (err) {
      setError(err.message || '锁定分段失败')
    } finally {
      setEditorSectionLoading(false)
    }
  }

  const onReleaseEditorSection = async () => {
    if (!selectedArticleManageable || !selectedArticle?.id || !editorSectionKey || editorSectionLoading) return
    resetFeedback()
    setEditorSectionLoading(true)
    try {
      const payload = await api.post(`/api/faq/articles/${selectedArticle.id}/editor/sections/release`, {
        section_key: editorSectionKey,
      })
      setEditorSections(Array.isArray(payload?.sections) ? payload.sections : [])
      await refreshEditorStatus(selectedArticle.id)
      setMessage('分段已释放')
    } catch (err) {
      setError(err.message || '释放分段失败')
    } finally {
      setEditorSectionLoading(false)
    }
  }

  const onOpenEditor = async () => {
    if (!selectedArticleManageable || !selectedArticle?.id) return
    const sourceExt = String(selectedArticle?.current_version?.source_ext || '').trim().toLowerCase()
    if (!selectedArticle?.current_version?.id) {
      setError('当前文章没有可编辑版本，请先上传 DOC/DOCX 文件')
      return
    }
    if (sourceExt === 'pdf') {
      setError('当前版本为 PDF，不支持在线编辑，请先上传 DOC/DOCX 版本')
      return
    }
    if (sourceExt && !['doc', 'docx'].includes(sourceExt)) {
      setError(`当前版本类型 ${sourceExt.toUpperCase()} 不支持在线编辑`)
      return
    }
    resetFeedback()
    setEditorLoading(true)
    setEditorContainerId(`doc-editor-container-${Date.now()}`)

    try {
      const loaded = await loadEditorScript()
      if (!loaded || !window.DocsAPI?.DocEditor) {
        setEditorVisible(false)
        setEditorPayload(null)
        setError('OnlyOffice 编辑服务不可用，请稍后重试')
        return
      }

      const payload = await api.post(`/api/faq/articles/${selectedArticle.id}/editor/session`, {})
      setEditorPayload(payload)
      setEditorStatus(payload?.session ? {
        owner_id: Number(payload.session.lock_owner_id) || null,
        owner_name: payload.session.lock_owner_name || user?.username || '-',
        expires_at: payload.session.expires_at || null,
        remaining_seconds: null,
        last_saved_at: payload.session.last_saved_at || null,
        status: payload.session.status || 'active',
      } : null)
      setEditorCollabMode(payload?.collab_mode === 'section' ? 'section' : 'single')
      setEditorSections(Array.isArray(payload?.sections) ? payload.sections : [])
      setEditorSectionKey(payload?.sections?.[0]?.key || '')
      setEditorVisible(true)
      await refreshEditorStatus(selectedArticle.id)
    } catch (err) {
      setError(err.message || '创建编辑会话失败')
    } finally {
      setEditorLoading(false)
    }
  }

  const onCloseEditor = async () => {
    destroyDocEditor()
    setEditorVisible(false)
    setEditorPayload(null)
    setEditorStatus(null)
    setEditorSections([])
    setEditorSectionKey('')
    setEditorSectionLoading(false)
    setEditorCollabMode('single')
    if (selectedArticle?.id && selectedArticleManageable) {
      try {
        await api.post(`/api/faq/articles/${selectedArticle.id}/editor/release`, {})
      } catch {
        // ignore release error
      }
    }
  }

  const onPublishEditorDraft = async () => {
    if (!selectedArticleManageable || !selectedArticle?.id) return
    resetFeedback()

    try {
      await api.post(`/api/faq/articles/${selectedArticle.id}/editor/publish`, {})
      setMessage('在线编辑内容已发布')
      destroyDocEditor()
      setEditorVisible(false)
      setEditorPayload(null)
      setEditorStatus(null)
      await fetchArticles(articles.page || 1)
      await openArticle(selectedArticle.id)
    } catch (err) {
      setError(err.message || '发布草稿失败')
    }
  }

  const onDiscardEditorDraft = async () => {
    if (!selectedArticleManageable || !selectedArticle?.id) return
    resetFeedback()

    try {
      await api.post(`/api/faq/articles/${selectedArticle.id}/editor/discard`, {})
      setMessage('草稿已放弃')
      destroyDocEditor()
      setEditorVisible(false)
      setEditorPayload(null)
      setEditorStatus(null)
      await openArticle(selectedArticle.id)
    } catch (err) {
      setError(err.message || '放弃草稿失败')
    }
  }

  const onDetailDragStart = (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target.closest('button, a, input, select, textarea, label')) return

    detailDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: detailModalOffset.x,
      originY: detailModalOffset.y,
    }
    setDraggingDetailModal(true)
    event.preventDefault()
  }

  const onTogglePreviewFullscreen = async () => {
    if (!previewVersion) return
    const stage = previewStageRef.current
    if (!stage) return

    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen()
        return
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      }

      if (typeof stage.requestFullscreen === 'function') {
        await stage.requestFullscreen()
        return
      }
    } catch {
      // ignore fullscreen API failure, fallback to new tab
    }

    window.open(`/api/faq/versions/${previewVersion.id}/preview`, '_blank', 'noopener,noreferrer')
  }

  const onCloseDetailModal = () => {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {})
    }
    detailDragRef.current.active = false
    setDraggingDetailModal(false)
    setDetailModalOffset({ x: 0, y: 0 })
    setPreviewFullscreen(false)
    setSelectedArticle(null)
    setVersions([])
    setPreviewVersion(null)
    setCompareState({
      leftVersionId: '',
      rightVersionId: '',
      loading: false,
      result: null,
    })
    setPublishDialog({
      open: false,
      loading: false,
      submitting: false,
      targetVersionId: '',
      note: '',
      mode: 'direct',
      checks: [],
      lock: null,
    })
    setFeedbackState({
      loading: false,
      solved: '',
      reason_code: '',
      reason_text: '',
      summary: null,
    })
  }

  const totalPages = Math.max(1, Math.ceil(Number(articles.total || 0) / Math.max(1, Number(articles.limit || 20))))
  const articleRowStart = (Math.max(1, Number(articles.page || 1)) - 1) * Math.max(1, Number(articles.limit || 20))
  const allVisibleSelected = articles.items.length > 0 && articles.items.every((item) => selectedIds.includes(Number(item.id)))
  const effectiveBatchAction = batchAction
  const selectedArticleFavorited = selectedArticle ? favoriteIdSet.has(Number(selectedArticle.id)) : false
  const selectedArticleManageable = selectedArticle ? canManageArticleItem(selectedArticle) : false
  const currentVersionExt = String(selectedArticle?.current_version?.source_ext || '').trim().toLowerCase()
  const editorDisabledReason = !selectedArticle?.current_version?.id
    ? '请先上传 DOC/DOCX 版本后再在线编辑'
    : currentVersionExt === 'pdf'
      ? '当前版本为 PDF，不支持在线编辑'
      : currentVersionExt && !['doc', 'docx'].includes(currentVersionExt)
        ? `当前版本类型 ${currentVersionExt.toUpperCase()} 不支持在线编辑`
        : ''
  const trendMax = Math.max(1, ...trendStats.map((item) => Number(item?.views || 0)))

  useEffect(() => {
    if (!selectedArticle) return
    setDetailModalOffset({ x: 0, y: 0 })
    setDraggingDetailModal(false)
  }, [selectedArticle?.id])

  useEffect(() => {
    const onMouseMove = (event) => {
      const drag = detailDragRef.current
      if (!drag.active) return

      const modalRect = detailModalRef.current?.getBoundingClientRect()
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY

      const baseX = drag.originX + dx
      const baseY = drag.originY + dy

      const maxX = modalRect ? Math.max(40, (window.innerWidth - modalRect.width) / 2 + 40) : Math.max(80, window.innerWidth * 0.45)
      const maxY = modalRect ? Math.max(40, (window.innerHeight - modalRect.height) / 2 + 40) : Math.max(80, window.innerHeight * 0.45)

      setDetailModalOffset({
        x: Math.min(maxX, Math.max(-maxX, baseX)),
        y: Math.min(maxY, Math.max(-maxY, baseY)),
      })
    }

    const onMouseUp = () => {
      if (!detailDragRef.current.active) return
      detailDragRef.current.active = false
      setDraggingDetailModal(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setPreviewFullscreen(document.fullscreenElement === previewStageRef.current)
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  useEffect(() => {
    const onOnline = () => setEditorOnline(true)
    const onOffline = () => setEditorOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (booting) return
    if (recycleMode) {
      setBatchAction('restore')
    } else {
      setBatchAction('archive')
    }
    fetchArticles(1, { recycle: recycleMode })
  }, [recycleMode])

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => articles.items.some((item) => Number(item.id) === Number(id))))
  }, [articles.items])

  useEffect(() => {
    if (!editorVisible || !selectedArticle?.id || !selectedArticleManageable) return
    let timer = null
    let stopped = false
    const run = async () => {
      if (stopped) return
      try {
        await refreshEditorStatus(selectedArticle.id)
      } catch {
        // keep editor usable even when status polling fails
      }
    }
    run()
    timer = window.setInterval(run, 10000)
    return () => {
      stopped = true
      if (timer) window.clearInterval(timer)
    }
  }, [editorVisible, selectedArticle?.id, selectedArticleManageable])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (editArticleDialog.open) {
          onCloseEditArticleDialog()
          return
        }
        if (deleteConfirm.open) {
          onCancelDeleteArticle()
          return
        }
        if (publishDialog.open) {
          onClosePublishDialog()
          return
        }
        if (editorVisible) {
          onCloseEditor()
          return
        }
        if (selectedArticle) {
          onCloseDetailModal()
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
        if (!editorVisible || !selectedArticle?.id) return
        event.preventDefault()
        refreshEditorStatus(selectedArticle.id)
          .then((lock) => {
            setMessage(lock?.last_saved_at ? `已保存到草稿：${formatDateTime(lock.last_saved_at)}` : '当前为自动保存模式，已触发保存状态刷新')
          })
          .catch(() => {
            setMessage('当前为自动保存模式，请稍后查看最近保存时间')
          })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editArticleDialog.open, editArticleDialog.submitting, deleteConfirm.open, deleteConfirm.loading, publishDialog.open, publishDialog.submitting, editorVisible, selectedArticle?.id, selectedArticle])

  useEffect(() => {
    fetchBootstrap()
  }, [])

  useEffect(() => {
    if (!isFaqBasicUser) return
    if (activeMenu !== 'articles') {
      setActiveMenu('articles')
    }
    if (recycleMode) {
      setRecycleMode(false)
    }
  }, [isFaqBasicUser, activeMenu, recycleMode])

  useEffect(() => {
    if (activeMenu === 'categories' && !canManageCategories) {
      setActiveMenu('articles')
    }
    if (activeMenu === 'access-requests' && !canReviewAccessRequests) {
      setActiveMenu('articles')
    }
  }, [activeMenu, canManageCategories, canReviewAccessRequests])

  useEffect(() => {
    if (!isReviewer || activeMenu !== 'approvals') return
    fetchPublishRequests(publishRequests.status || 'pending', 1)
  }, [activeMenu, isReviewer])

  useEffect(() => {
    if (!canReviewAccessRequests || activeMenu !== 'access-requests') return
    fetchAccessRequests()
  }, [activeMenu, canReviewAccessRequests])

  useEffect(() => {
    if (!editorVisible || !editorPayload?.editor || !window.DocsAPI?.DocEditor) return

    const timer = setTimeout(() => {
      destroyDocEditor()
      try {
        const rawConfig = editorPayload.editor.config || {}
        const baseEvents = rawConfig.events || {}
        docEditorRef.current = new window.DocsAPI.DocEditor(editorContainerId, {
          ...rawConfig,
          events: {
            ...baseEvents,
            onError: (event) => {
              if (typeof baseEvents.onError === 'function') baseEvents.onError(event)
              const code = event?.data?.errorCode
              const desc = event?.data?.errorDescription || '文档加载失败'
              setError(`OnlyOffice 错误${code ? `(${code})` : ''}：${desc}`)
            },
          },
          token: editorPayload.editor.token,
          width: '100%',
          height: '100%',
        })
      } catch {
        setEditorScriptError('OnlyOffice 编辑器初始化失败，已降级为预览+下载。')
      }
    }, 80)

    return () => {
      clearTimeout(timer)
    }
  }, [editorVisible, editorPayload, editorContainerId])

  const handleLogout = async () => {
    await logoutFromSso({ apiBase: API_BASE })
    window.location.href = buildPortalEntryUrl('faq')
  }

  if (authRedirecting) {
    return <div className="app-loading">正在跳转登录页...</div>
  }

  if (booting) {
    return <div className="app-loading">文档管理系统初始化中...</div>
  }

  if (!user) {
    return <div className="app-loading">{error || '未登录，正在跳转...'}</div>
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong><span className="brand-red">聚信</span><span className="brand-blue">文档管理系统</span></strong>
        </div>
        <div className="user-pill">{user?.username || '-'} · {roleLabel(user?.role)}</div>

        <div className="menu">
          {isFaqBasicUser ? (
            <button className={activeMenu === 'articles' ? 'active' : ''} onClick={() => setActiveMenu('articles')}>文档管理</button>
          ) : (
            <>
              <button className={activeMenu === 'dashboard' ? 'active' : ''} onClick={() => setActiveMenu('dashboard')}>仪表盘</button>
              <button className={activeMenu === 'articles' ? 'active' : ''} onClick={() => setActiveMenu('articles')}>文档管理</button>
              {canManageCategories ? (
                <button className={activeMenu === 'categories' ? 'active' : ''} onClick={() => setActiveMenu('categories')}>分类管理</button>
              ) : null}
              {isReviewer ? (
                <button className={activeMenu === 'approvals' ? 'active' : ''} onClick={() => { setActiveMenu('approvals'); fetchPublishRequests('pending', 1) }}>
                  发布审批
                </button>
              ) : null}
              {canReviewAccessRequests ? (
                <button className={activeMenu === 'access-requests' ? 'active' : ''} onClick={() => { setActiveMenu('access-requests'); fetchAccessRequests() }}>
                  待审批
                </button>
              ) : null}
              {isAuditor ? (
                <button className={activeMenu === 'logs' ? 'active' : ''} onClick={() => { setActiveMenu('logs'); fetchLogs(); fetchOutboxEvents() }}>
                  审计日志
                </button>
              ) : null}
            </>
          )}
        </div>

        <div className="sidebar-actions">
          <button className="ghost" onClick={() => window.location.href = buildPortalSwitchUrl('faq')}>切换系统</button>
          <button className="ghost" onClick={handleLogout}>退出系统</button>
        </div>
      </aside>

      <main className="content">
        <section className="hero">
          <div>
            <h1>文档知识库</h1>
            <p className="sub">支持全局库与部门库双层管理，跨部门默认仅可见题头，需申请后查看正文。</p>
          </div>
          <div className="hero-actions">
            <button className="ghost" onClick={() => fetchBootstrap()}>刷新</button>
          </div>
        </section>

        {message ? <div className="toast success">{message}</div> : null}
        {error ? <div className="toast error">{error}</div> : null}
        {canManageArticles && editorScriptError ? <div className="toast warning">{editorScriptError}</div> : null}

        {activeMenu === 'dashboard' && !isFaqBasicUser && (
          <>
            <section className="panel">
              <div className="panel-header"><h2>数据概览</h2></div>
              <div className="panel-body metric-grid">
                <div className="metric"><label>文档总数</label><strong>{stats.article_total || 0}</strong></div>
                <div className="metric"><label>已发布</label><strong>{stats.published_total || 0}</strong></div>
                <div className="metric"><label>草稿</label><strong>{stats.draft_total || 0}</strong></div>
                <div className="metric"><label>总阅读</label><strong>{stats.views_total || 0}</strong></div>
                <div className="metric"><label>今日阅读</label><strong>{stats.today_views || 0}</strong></div>
                <div className="metric"><label>收藏总数</label><strong>{stats.favorites_total || 0}</strong></div>
                <div className="metric"><label>归档数</label><strong>{stats.archived_total || 0}</strong></div>
                <div className="metric"><label>回收站</label><strong>{stats.recycle_total || 0}</strong></div>
                <div className="metric"><label>反馈总数</label><strong>{stats.feedback_total || 0}</strong></div>
                <div className="metric"><label>已解决反馈</label><strong>{stats.feedback_solved_total || 0}</strong></div>
                <div className="metric"><label>待审批发布</label><strong>{stats.publish_pending_total || 0}</strong></div>
                <div className="metric"><label>编辑服务</label><strong>{editorScriptReady ? '可用' : '降级'}</strong></div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>访问趋势与热门文档</h2>
                <div className="row-actions">
                  <button className="ghost" onClick={refreshTrendStats}>刷新趋势</button>
                  <button className="ghost" onClick={refreshTopStats}>刷新热门</button>
                </div>
              </div>
              <div className="panel-body dashboard-grid">
                <div className="trend-list">
                  {trendStats.map((item) => {
                    const views = Number(item?.views || 0)
                    return (
                      <div key={`trend-${item.day}`} className="trend-item">
                        <span>{item.day}</span>
                        <div className="trend-bar-wrap">
                          <div className="trend-bar" style={{ width: `${Math.max(4, Math.round((views / trendMax) * 100))}%` }} />
                        </div>
                        <strong>{views}</strong>
                      </div>
                    )
                  })}
                  {!trendStats.length ? <div className="empty">暂无趋势数据</div> : null}
                </div>
                <div className="top-list">
                  {topStats.map((item) => (
                    <div key={`top-${item.article_id}`} className="top-item">
                      <button className="link" onClick={() => openArticle(item.article_id)}>{item.title || `#${item.article_id}`}</button>
                      <span>{Number(item.views || 0)} 次</span>
                    </div>
                  ))}
                  {!topStats.length ? <div className="empty">暂无热门数据</div> : null}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>内容健康</h2>
                <button className="ghost" onClick={refreshContentHealth}>刷新</button>
              </div>
              <div className="panel-body">
                {contentHealth?.summary ? (
                  <div className="health-summary">
                    <span>过期内容 {contentHealth.summary.stale_count || 0}</span>
                    <span>低解决率 {contentHealth.summary.low_solve_count || 0}</span>
                    <span>低访问内容 {contentHealth.summary.zero_view_count || 0}</span>
                    <span>待清理回收站 {contentHealth.summary.recycle_soon_count || 0}</span>
                  </div>
                ) : null}
                <div className="dashboard-grid">
                  <div className="mini-list">
                    <h4>过期内容（Top5）</h4>
                    {(contentHealth?.stale_articles || []).slice(0, 5).map((item) => (
                      <div key={`stale-${item.id}`} className="mini-row">
                        <button className="link" onClick={() => openArticle(item.id)}>{item.title}</button>
                        <span>{formatDateTime(item.updated_at)}</span>
                      </div>
                    ))}
                    {!contentHealth?.stale_articles?.length ? <div className="empty">暂无</div> : null}
                  </div>
                  <div className="mini-list">
                    <h4>低解决率（Top5）</h4>
                    {(contentHealth?.low_solve_articles || []).slice(0, 5).map((item) => (
                      <div key={`solve-${item.id}`} className="mini-row">
                        <button className="link" onClick={() => openArticle(item.id)}>{item.title}</button>
                        <span>{Math.round(Number(item.solved_rate || 0) * 100)}%</span>
                      </div>
                    ))}
                    {!contentHealth?.low_solve_articles?.length ? <div className="empty">暂无</div> : null}
                  </div>
                </div>
              </div>
            </section>

            {isWriter ? (
              <section className="panel">
                <div className="panel-header">
                  <h2>智能置顶建议</h2>
                  <div className="row-actions">
                    <button className="ghost" onClick={refreshPinRecommendations} disabled={pinRecommendations.loading}>刷新建议</button>
                    {isAdmin ? <button className="primary" onClick={onApplySmartPin} disabled={pinRecommendations.loading}>应用建议</button> : null}
                  </div>
                </div>
                <div className="panel-body">
                  <div className="muted">生成时间：{pinRecommendations.generated_at ? formatDateTime(pinRecommendations.generated_at) : '-'}</div>
                  <div className="table">
                    <div className="table-row header smart-pin-row">
                      <span>文章</span>
                      <span>评分</span>
                      <span>近7天访问</span>
                      <span>未解决反馈</span>
                      <span>建议理由</span>
                    </div>
                    {(pinRecommendations.candidates || []).map((item) => (
                      <div className="table-row smart-pin-row" key={`pin-${item.article_id}`}>
                        <button className="link" onClick={() => openArticle(item.article_id)}>{item.title || `#${item.article_id}`}</button>
                        <span>{Number(item.score || 0).toFixed(2)}</span>
                        <span>{item.views_7d || 0}</span>
                        <span>{item.unsolved_feedback || 0}</span>
                        <span>{item.reason || '-'}</span>
                      </div>
                    ))}
                    {!pinRecommendations.candidates?.length ? <div className="empty">暂无智能置顶建议</div> : null}
                  </div>
                </div>
              </section>
            ) : null}

            {isAdmin ? (
              <section className="panel">
                <div className="panel-header"><h2>维护工具</h2></div>
                <div className="panel-body row-actions">
                  <button className="ghost" onClick={onReindexSearchText}>重建正文搜索索引</button>
                  <button className="ghost" onClick={onPurgeRecycle}>立即清理过期回收站</button>
                </div>
              </section>
            ) : null}
          </>
        )}

        {activeMenu === 'categories' && canManageCategories && (
          <section className="panel">
            <div className="panel-header">
              <h2>分类管理</h2>
              <div className="row-actions">
                <select value={categoryScopeFilter} onChange={(e) => setCategoryScopeFilter(e.target.value)}>
                  <option value="all">全部分类</option>
                  <option value="global">全局库分类</option>
                  <option value="department">部门库分类</option>
                </select>
                {categoryScopeFilter === 'department' ? (
                  <select value={categoryDepartmentFilter} onChange={(e) => setCategoryDepartmentFilter(e.target.value)}>
                    <option value="">全部部门</option>
                    {departmentOptions.map((item) => <option key={`category-department-${item.code}`} value={item.code}>{item.name}</option>)}
                  </select>
                ) : null}
              </div>
            </div>
            <div className="panel-body">
              {canManageCategories ? (
                <form className="category-form" onSubmit={onSubmitCategory}>
                  <input
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="分类名称"
                    required
                  />
                  <select
                    value={categoryForm.library_scope}
                    onChange={(e) => setCategoryForm((prev) => ({
                      ...prev,
                      library_scope: e.target.value,
                      department_code: e.target.value === 'global' ? '' : (prev.department_code || currentDepartmentCode),
                      parent_id: '',
                    }))}
                  >
                    {canManageGlobalLibrary ? <option value="global">全局库</option> : null}
                    <option value="department">部门库</option>
                  </select>
                  {categoryForm.library_scope === 'department' ? (
                    <select
                      value={categoryForm.department_code}
                      onChange={(e) => setCategoryForm((prev) => ({ ...prev, department_code: e.target.value, parent_id: '' }))}
                    >
                      <option value="">选择部门</option>
                      {departmentOptions.map((item) => <option key={`category-form-${item.code}`} value={item.code}>{item.name}</option>)}
                    </select>
                  ) : null}
                  <select
                    value={categoryForm.parent_id}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, parent_id: e.target.value }))}
                  >
                    <option value="">无父级</option>
                    {categories
                      .filter((item) => Number(item.id) !== Number(categoryForm.id || 0))
                      .filter((item) => String(item.library_scope || 'department').trim().toLowerCase() === categoryForm.library_scope)
                      .filter((item) => categoryForm.library_scope === 'global' || String(item.department_code || '').trim().toUpperCase() === String(categoryForm.department_code || '').trim().toUpperCase())
                      .map((item) => <option key={`category-parent-${item.id}`} value={item.id}>{item.name}</option>)}
                  </select>
                  <input
                    type="number"
                    value={categoryForm.sort_order}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                    placeholder="排序"
                  />
                  <select
                    value={categoryForm.is_active ? '1' : '0'}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, is_active: e.target.value === '1' }))}
                  >
                    <option value="1">启用</option>
                    <option value="0">停用</option>
                  </select>
                  <button className="primary" type="submit" disabled={categorySubmitting}>
                    {categorySubmitting ? '提交中...' : (categoryForm.id ? '保存分类' : '新增分类')}
                  </button>
                  {categoryForm.id ? (
                    <button className="ghost" type="button" onClick={resetCategoryForm} disabled={categorySubmitting}>
                      取消编辑
                    </button>
                  ) : null}
                </form>
              ) : null}

              {canManageCategories ? (
                <div className="batch-bar category-batch-bar">
                  <span className="muted">已选 {selectedCategoryIds.length} 项</span>
                  <button className="ghost" type="button" onClick={onBatchDeleteCategories} disabled={!selectedCategoryIds.length || categoryDeleting}>
                    {categoryDeleting ? '删除中...' : '批量删除'}
                  </button>
                  <button className="ghost" type="button" onClick={() => setSelectedCategoryIds([])} disabled={!selectedCategoryIds.length || categoryDeleting}>
                    清空选择
                  </button>
                  <span className="muted">删除时会自动拦截仍有关联 FAQ 或子分类的分类</span>
                </div>
              ) : null}

              <div className="table">
                <div className={`table-row header ${canManageCategories ? 'category-table-row-selectable' : ''}`}>
                  {canManageCategories ? (
                    <span className="check-col">
                      <input
                        type="checkbox"
                        checked={allCategoriesSelected}
                        onChange={onToggleAllCategories}
                        disabled={!allCategoryIds.length || categoryDeleting}
                        aria-label="全选分类"
                      />
                    </span>
                  ) : null}
                  <span>名称</span>
                  <span>文库</span>
                  <span>部门</span>
                  <span>父级</span>
                  <span>排序</span>
                  <span>状态</span>
                  <span>更新时间</span>
                  {canManageCategories ? <span>操作</span> : null}
                </div>
                {filteredCategories.map((item) => (
                  <div className={`table-row ${canManageCategories ? 'category-table-row-selectable' : ''}`} key={item.id}>
                    {canManageCategories ? (
                      <span className="check-col">
                        <input
                          type="checkbox"
                          checked={selectedCategoryIds.includes(Number(item.id))}
                          onChange={() => onToggleCategorySelection(item.id)}
                          disabled={categoryDeleting}
                          aria-label={`选择分类${item.name}`}
                        />
                      </span>
                    ) : null}
                    <span>{item.name}</span>
                    <span><span className={`status-chip status-library-${String(item.library_scope || 'department').toLowerCase()}`}>{libraryScopeText(item.library_scope)}</span></span>
                    <span>{String(item.library_scope || 'department').toLowerCase() === 'global' ? '全公司' : departmentLabel(item.department_code)}</span>
                    <span>{item.parent_id ? (categories.find((c) => Number(c.id) === Number(item.parent_id))?.name || item.parent_id) : '-'}</span>
                    <span>{item.sort_order}</span>
                    <span>{item.is_active ? '启用' : '停用'}</span>
                    <span>{formatDateTime(item.updated_at)}</span>
                    {canManageCategories ? (
                      <span className="row-actions">
                        <button className="link" onClick={() => onEditCategory(item)} disabled={categoryDeleting}>编辑</button>
                        <button className="link danger" onClick={() => onDeleteCategory(item)} disabled={categoryDeleting}>删除</button>
                        {isAdmin ? (
                          <button className="link danger" onClick={() => onForceDeleteCategory(item)} disabled={categoryDeleting}>强制删除</button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                ))}
                {!filteredCategories.length ? <div className="empty">当前筛选下暂无分类</div> : null}
              </div>
            </div>
          </section>
        )}

        {activeMenu === 'logs' && isAuditor && (
          <section className="panel">
            <div className="panel-header">
              <h2>审计日志</h2>
              <div className="row-actions">
                <button className="ghost" onClick={fetchLogs}>刷新日志</button>
                <button className="ghost" onClick={fetchOutboxEvents}>刷新出站事件</button>
              </div>
            </div>
            <div className="panel-body">
              <div className="table">
                <div className="table-row header">
                  <span>时间</span>
                  <span>动作</span>
                  <span>说明</span>
                  <span>操作人</span>
                  <span>IP</span>
                </div>
                {logs.items.map((item) => (
                  <div className="table-row" key={item.id}>
                    <span>{formatDateTime(item.created_at)}</span>
                    <span>{auditActionText(item.action)}</span>
                    <span>{item.message || '-'}</span>
                    <span>{item.operator_name || '-'}</span>
                    <span>{item.request_ip || '-'}</span>
                  </div>
                ))}
                {!logs.items.length ? <div className="empty">暂无日志</div> : null}
              </div>
              <div className="table outbox-table">
                <div className="table-row header">
                  <span>ID</span>
                  <span>事件</span>
                  <span>状态</span>
                  <span>重试次数</span>
                  <span>最近错误</span>
                  <span>更新时间</span>
                </div>
                {outboxEvents.map((item) => (
                  <div className="table-row" key={`outbox-${item.id}`}>
                    <span>{item.id}</span>
                    <span>{outboxEventText(item.event_type)}</span>
                    <span>{outboxStatusText(item.delivery_status)}</span>
                    <span>{Number(item.delivery_attempts || 0)}</span>
                    <span>{item.last_error || '-'}</span>
                    <span>{formatDateTime(item.updated_at)}</span>
                  </div>
                ))}
                {!outboxEvents.length ? <div className="empty">暂无出站事件</div> : null}
              </div>
            </div>
          </section>
        )}

        {activeMenu === 'access-requests' && canReviewAccessRequests && (
          <section className="panel">
            <div className="panel-header">
              <h2>待审批</h2>
              <div className="row-actions">
                <button className="ghost" onClick={fetchAccessRequests} disabled={accessRequestsLoading}>
                  {accessRequestsLoading ? '刷新中...' : '刷新'}
                </button>
              </div>
            </div>
            <div className="panel-body request-queue-grid">
              <div className="request-queue-card">
                <div className="section-head">
                  <h3>部门待审批</h3>
                  <span>{Array.isArray(accessRequests.incoming) ? accessRequests.incoming.length : 0} 条</span>
                </div>
                <div className="table">
                  <div className="table-row header access-request-row">
                    <span>文档</span>
                    <span>申请人</span>
                    <span>来源部门</span>
                    <span>状态</span>
                    <span>操作</span>
                  </div>
                  {(accessRequests.incoming || []).map((item) => (
                    <div className="table-row access-request-row" key={`incoming-${item.id}`}>
                      <span className="title-cell">{item.article_title || `#${item.article_id}`}</span>
                      <span>{item.requester_name || '-'}</span>
                      <span>{departmentLabel(item.requester_department_code)}</span>
                      <span><span className={`status-chip status-${String(item.status || '').toLowerCase()}`}>{accessRequestStatusText(item.status)}</span></span>
                      <span className="row-actions">
                        {String(item.status || '').toLowerCase() === 'pending' ? (
                          <>
                            <button className="link" onClick={() => onReviewAccessRequest(item, 'approved')}>通过</button>
                            <button className="link danger" onClick={() => onReviewAccessRequest(item, 'rejected')}>拒绝</button>
                          </>
                        ) : (
                          <span className="muted">已处理</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {!accessRequests.incoming?.length ? <div className="empty">当前没有跨部门待审批申请</div> : null}
                </div>
              </div>

              <div className="request-queue-card">
                <div className="section-head">
                  <h3>我的申请</h3>
                  <span>{Array.isArray(accessRequests.mine) ? accessRequests.mine.length : 0} 条</span>
                </div>
                <div className="table">
                  <div className="table-row header access-request-row">
                    <span>文档</span>
                    <span>目标部门</span>
                    <span>状态</span>
                    <span>申请时间</span>
                  </div>
                  {(accessRequests.mine || []).map((item) => (
                    <div className="table-row access-request-row" key={`mine-${item.id}`}>
                      <span className="title-cell">{item.article_title || `#${item.article_id}`}</span>
                      <span>{departmentLabel(item.target_department_code)}</span>
                      <span><span className={`status-chip status-${String(item.status || '').toLowerCase()}`}>{accessRequestStatusText(item.status)}</span></span>
                      <span>{formatDateTime(item.created_at)}</span>
                    </div>
                  ))}
                  {!accessRequests.mine?.length ? <div className="empty">你还没有跨部门查看申请</div> : null}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeMenu === 'approvals' && isReviewer && (
          <section className="panel">
            <div className="panel-header">
              <h2>发布审批</h2>
              <div className="row-actions">
                <select value={publishRequests.status || 'pending'} onChange={(e) => fetchPublishRequests(e.target.value, 1)}>
                  <option value="pending">待审批</option>
                  <option value="approved">已通过</option>
                  <option value="rejected">已拒绝</option>
                  <option value="cancelled">已取消</option>
                </select>
                <button className="ghost" onClick={() => fetchPublishRequests(publishRequests.status || 'pending', publishRequests.page || 1)}>
                  刷新
                </button>
              </div>
            </div>
            <div className="panel-body">
              <div className="table">
                <div className="table-row header approval-table-row">
                  <span>文章</span>
                  <span>版本</span>
                  <span>申请人</span>
                  <span>状态</span>
                  <span>发布时间说明</span>
                  <span>时间</span>
                  <span>操作</span>
                </div>
                {publishRequests.loading ? (
                  <div className="empty">加载审批列表中...</div>
                ) : (
                  <>
                    {publishRequests.items.map((item) => (
                      <div className="table-row approval-table-row" key={item.id}>
                        <span className="title-cell">{item.article_title || `#${item.article_id}`}</span>
                        <span>{item.version_no ? `v${item.version_no}` : '-'}</span>
                        <span>{item.requester_name || '-'}</span>
                        <span><span className={`status-chip status-${String(item.status || '').toLowerCase()}`}>{reviewStatusText(item.status)}</span></span>
                        <span>{item.publish_note || '-'}</span>
                        <span>{formatDateTime(item.created_at)}</span>
                        <span className="row-actions">
                          <button className="link" onClick={() => openArticle(item.article_id)}>查看</button>
                          {String(item.status) === 'pending' ? (
                            <>
                              <button className="link" onClick={() => onReviewPublishRequest(item.id, 'approve')}>通过</button>
                              <button className="link danger" onClick={() => onReviewPublishRequest(item.id, 'reject')}>拒绝</button>
                            </>
                          ) : null}
                        </span>
                      </div>
                    ))}
                    {!publishRequests.items.length ? <div className="empty">当前筛选下暂无审批单</div> : null}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {activeMenu === 'articles' && (
          <section className="article-layout">
            <section className="panel article-list-panel">
              <div className="panel-header">
                <h2>{recycleMode ? '回收站' : '文档列表'}</h2>
                <div className="row-actions">
                  {!isFaqBasicUser ? (
                    <>
                      <button className="ghost" onClick={() => setRowDensity((prev) => (prev === 'comfortable' ? 'compact' : 'comfortable'))}>
                        {rowDensity === 'comfortable' ? '紧凑模式' : '舒适模式'}
                      </button>
                      <button
                        className={recycleMode ? 'primary' : 'ghost'}
                        onClick={() => {
                          setRecycleMode((prev) => !prev)
                        }}
                      >
                        {recycleMode ? '返回文档列表' : '回收站'}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="panel-body">
                {!isFaqBasicUser ? (
                  <div className="workspace-strip">
                    <section className="workspace-card workspace-card-primary" aria-label="继续处理">
                      <div className="section-heading">
                        <div>
                          <h3>继续处理</h3>
                          <p>把最近打开和常用文档收在一个工作区里，回来就能继续，不需要重新扫整页。</p>
                        </div>
                      </div>
                      <div className="workspace-grid">
                        <div className="workspace-column">
                          <h4>最近访问</h4>
                          <div className="workspace-list">
                            {recentItems.slice(0, 5).map((item) => (
                              <button key={item.id} className="workspace-link" onClick={() => openArticle(item.id)}>{item.title}</button>
                            ))}
                            {!recentItems.length ? <span className="muted">暂无最近访问</span> : null}
                          </div>
                        </div>
                        <div className="workspace-column">
                          <h4>我的收藏</h4>
                          <div className="workspace-list">
                            {favorites.slice(0, 5).map((item) => (
                              <button key={item.article_id} className="workspace-link" onClick={() => openArticle(item.article_id)}>{item.title}</button>
                            ))}
                            {!favorites.length ? <span className="muted">暂无收藏</span> : null}
                          </div>
                        </div>
                      </div>
                    </section>
                    <section className="workspace-card workspace-card-secondary" aria-label="待处理提醒">
                      <div className="section-heading">
                        <div>
                          <h3>待处理提醒</h3>
                          <p>跨部门申请集中放在这里，只保留需要你判断和跟进的事项。</p>
                        </div>
                      </div>
                      <div className="workspace-list">
                        {(accessRequests.mine || []).slice(0, 4).map((item) => (
                          <div key={`request-quick-${item.id}`} className="quick-request">
                            <strong>{item.article_title || `#${item.article_id}`}</strong>
                            <span>{accessRequestStatusText(item.status)}</span>
                          </div>
                        ))}
                        {!accessRequests.mine?.length ? <span className="muted">暂无跨部门申请</span> : null}
                      </div>
                    </section>
                  </div>
                ) : null}

                <section className="tool-card filter-card" aria-label="筛选文档">
                  <div className="section-heading">
                    <div>
                      <h3>筛选文档</h3>
                      <p>先收窄范围，再进入结果列表处理，避免浏览和管理动作同时抢注意力。</p>
                    </div>
                  </div>
                  <div className="filters" role="search" aria-label="筛选文档">
                    <label className="field-group field-wide">
                      <span>关键词搜索</span>
                      <input
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="标题、摘要、标签或正文"
                        aria-label="关键词搜索"
                      />
                    </label>
                    <label className="field-group">
                      <span>文库范围</span>
                      <select value={libraryFilter} onChange={(e) => setLibraryFilter(e.target.value)} aria-label="文库范围">
                        <option value="all">全部文库</option>
                        <option value="global">全局库</option>
                        <option value="department">部门库</option>
                        <option value="restricted">跨部门受限</option>
                      </select>
                    </label>
                    <label className="field-group">
                      <span>文档状态</span>
                      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="文档状态">
                        <option value="">全部状态</option>
                        <option value="draft">草稿</option>
                        <option value="published">已发布</option>
                        <option value="archived">已归档</option>
                      </select>
                    </label>
                    <label className="field-group">
                      <span>文档分类</span>
                      <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="文档分类">
                        <option value="">全部分类</option>
                        {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                    <div className="filters-actions">
                      <button className="ghost" type="button" onClick={() => fetchArticles(1)}>应用筛选</button>
                    </div>
                  </div>
                </section>
                {searchSuggestions.length ? (
                  <div className="suggestion-bar">
                    <span className="muted">你可能在找：</span>
                    {searchSuggestions.map((item) => (
                      <button key={`sug-${item.article_id}`} className="ghost" onClick={() => onApplySuggestion(item)}>
                        {item.title}
                      </button>
                    ))}
                    <button className="link" onClick={onResetFilters}>重置筛选</button>
                  </div>
                ) : null}

                {canManageArticles && !recycleMode && (
                  <section className="tool-card composer-card" aria-label="新建文档">
                    <div className="section-heading">
                      <div>
                        <h3>新建文档</h3>
                        <p>默认收起，让浏览保持为主任务；只有准备创建时再展开输入项。</p>
                      </div>
                      <button
                        className={articleComposerOpen ? 'ghost' : 'primary'}
                        type="button"
                        aria-expanded={articleComposerOpen}
                        aria-controls="article-composer"
                        onClick={() => setArticleComposerOpen((prev) => !prev)}
                      >
                        {articleComposerOpen ? '收起新建文档' : '展开新建文档'}
                      </button>
                    </div>
                    {articleComposerOpen ? (
                      <form id="article-composer" className="article-create" onSubmit={onCreateArticle}>
                        <label className="field-group">
                          <span>文档标题</span>
                          <input
                            value={articleForm.title}
                            onChange={(e) => setArticleForm({ ...articleForm, title: e.target.value })}
                            placeholder="例如：部门知识库使用规范"
                            required
                            aria-label="文档标题"
                          />
                        </label>
                        <label className="field-group">
                          <span>摘要</span>
                          <input
                            value={articleForm.summary}
                            onChange={(e) => setArticleForm({ ...articleForm, summary: e.target.value })}
                            placeholder="用一句话说明文档用途"
                            aria-label="摘要"
                          />
                        </label>
                        <label className="field-group">
                          <span>标签</span>
                          <input
                            value={articleForm.tagsText}
                            onChange={(e) => setArticleForm({ ...articleForm, tagsText: e.target.value })}
                            placeholder="多个标签用逗号分隔"
                            aria-label="标签"
                          />
                        </label>
                        <label className="field-group">
                          <span>文库范围</span>
                          <select
                            value={articleForm.library_scope}
                            onChange={(e) => setArticleForm((prev) => ({
                              ...prev,
                              library_scope: e.target.value,
                              category_id: '',
                              department_code: e.target.value === 'global' ? '' : (prev.department_code || currentDepartmentCode),
                            }))}
                            aria-label="新建文档文库范围"
                          >
                            {canManageGlobalLibrary ? <option value="global">全局库</option> : null}
                            <option value="department">部门库</option>
                          </select>
                        </label>
                        {articleForm.library_scope === 'department' ? (
                          <label className="field-group">
                            <span>所属部门</span>
                            <select
                              value={articleForm.department_code}
                              onChange={(e) => setArticleForm((prev) => ({ ...prev, department_code: e.target.value, category_id: '' }))}
                              aria-label="所属部门"
                            >
                              <option value="">选择部门</option>
                              {departmentOptions.map((item) => <option key={`article-form-dept-${item.code}`} value={item.code}>{item.name}</option>)}
                            </select>
                          </label>
                        ) : null}
                        <label className="field-group">
                          <span>文档分类</span>
                          <select
                            value={articleForm.category_id}
                            onChange={(e) => setArticleForm({ ...articleForm, category_id: e.target.value })}
                            aria-label="新建文档分类"
                          >
                            <option value="">无分类</option>
                            {articleFormCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </label>
                        <div className="article-create-actions">
                          <button className="primary" type="submit">新增文档</button>
                        </div>
                      </form>
                    ) : null}
                  </section>
                )}
                <section className="results-overview" aria-label="文档结果">
                  <div>
                    <h3>{recycleMode ? '回收内容' : '检索结果'}</h3>
                    <p>{recycleMode ? '集中恢复或清理已删除文档。' : '结果区只保留当前筛选命中的文档，浏览和处理都在这里完成。'}</p>
                  </div>
                  <div className="results-overview-stat">
                    <strong>{articles.total || 0}</strong>
                    <span>{recycleMode ? '条待处理记录' : '条结果'}</span>
                  </div>
                </section>
                {isAdmin ? (
                  <div className="batch-bar">
                    <label className="checkbox-inline">
                      <input type="checkbox" checked={allVisibleSelected} onChange={onToggleSelectAll} />
                      <span>本页全选</span>
                    </label>
                    <span className="muted">已选 {selectedIds.length} 项</span>
                    <select value={batchAction} onChange={(e) => setBatchAction(e.target.value)}>
                      {recycleMode ? (
                        <>
                          <option value="restore">批量恢复</option>
                          <option value="purge">批量彻底删除</option>
                        </>
                      ) : (
                        <>
                          <option value="archive">批量归档</option>
                          <option value="publish">批量发布</option>
                          <option value="category">批量调整分类</option>
                          <option value="delete">批量删除</option>
                        </>
                      )}
                    </select>
                    {!recycleMode && batchAction === 'category' ? (
                      <select value={batchCategoryId} onChange={(e) => setBatchCategoryId(e.target.value)}>
                        <option value="">无分类</option>
                        {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    ) : null}
                    {!recycleMode && batchAction === 'delete' ? (
                      <select value={batchRetentionDays} onChange={(e) => setBatchRetentionDays(e.target.value)}>
                        <option value="30">30天后清理</option>
                        <option value="7">7天后清理</option>
                      </select>
                    ) : null}
                    <button className="primary" disabled={!selectedIds.length || batchLoading} onClick={onApplyBatchAction}>
                      {batchLoading ? '处理中...' : `执行${
                        effectiveBatchAction === 'restore'
                          ? '恢复'
                          : effectiveBatchAction === 'purge'
                            ? '彻底删除'
                            : '批量操作'
                      }`}
                    </button>
                  </div>
                ) : null}

                <div className={`table article-table ${rowDensity === 'compact' ? 'density-compact' : ''} ${isAdmin ? 'with-checkbox' : ''}`}>
                  <div className="table-row header">
                    {isAdmin ? <span className="check-col" /> : null}
                    <span className="seq-col">序号</span>
                    <span>标题</span>
                    <span>文库</span>
                    <span>部门</span>
                    <span>状态</span>
                    <span>分类</span>
                    <span>{recycleMode ? '删除时间' : '更新时间'}</span>
                    <span>操作</span>
                  </div>
                  {articlesLoading ? (
                    <>
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <div className="table-row skeleton-row" key={`skeleton-${idx}`}>
                          {isAdmin ? <span className="skeleton-cell check-col" /> : null}
                          <span className="skeleton-cell seq-col" />
                          <span className="skeleton-cell" />
                          <span className="skeleton-cell" />
                          <span className="skeleton-cell" />
                          <span className="skeleton-cell" />
                          <span className="skeleton-cell" />
                          <span className="skeleton-cell" />
                          <span className="skeleton-cell" />
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      {articles.items.map((item, rowIndex) => (
                        <div className="table-row" key={item.id}>
                          {isAdmin ? (
                            <span className="check-col table-cell table-cell-check">
                              <span className="cell-label">选择</span>
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(Number(item.id))}
                                onChange={() => onToggleSelectOne(item.id)}
                                aria-label={`选择文档${item.title}`}
                              />
                            </span>
                          ) : null}
                          <span className="seq-col table-cell">
                            <span className="cell-label">序号</span>
                            <span className="cell-value">{articleRowStart + rowIndex + 1}</span>
                          </span>
                          <span className="table-cell title-cell">
                            <span className="cell-label">标题</span>
                            <span className="cell-value">
                              <strong>{item.title}</strong>
                              {item.visibility === 'restricted' ? <span className="row-note">跨部门受限，仅可见题头</span> : null}
                            </span>
                          </span>
                          <span className="table-cell">
                            <span className="cell-label">文库</span>
                            <span className="cell-value">
                              <span className={`status-chip status-library-${String(item.library_scope || 'department').toLowerCase()}`}>{libraryScopeText(item.library_scope)}</span>
                            </span>
                          </span>
                          <span className="table-cell">
                            <span className="cell-label">部门</span>
                            <span className="cell-value">{String(item.library_scope || 'department').toLowerCase() === 'global' ? '全公司' : departmentLabel(item.department_code)}</span>
                          </span>
                          <span className="table-cell">
                            <span className="cell-label">状态</span>
                            <span className="cell-value">
                              <span className={`status-chip status-${String(item.status || 'draft').toLowerCase()}`}>{statusText(item.status)}</span>
                            </span>
                          </span>
                          <span className="table-cell">
                            <span className="cell-label">分类</span>
                            <span className="cell-value">{item.category_name || '-'}</span>
                          </span>
                          <span className="table-cell">
                            <span className="cell-label">{recycleMode ? '删除时间' : '更新时间'}</span>
                            <span className="cell-value">{formatDateTime(recycleMode ? item.deleted_at : item.updated_at)}</span>
                          </span>
                          <span className="table-cell action-cell">
                            <span className="cell-label">操作</span>
                            <span className="cell-value row-actions">
                              {!recycleMode && item.visibility !== 'restricted' ? <button className="link" onClick={() => openArticle(item.id)}>查看</button> : null}
                              {!recycleMode && item.visibility === 'restricted' ? (
                                <button
                                  className="link"
                                  onClick={() => onRequestArticleAccess(item)}
                                  disabled={String(latestAccessRequestByArticleId.get(Number(item.id))?.status || '').toLowerCase() === 'pending'}
                                >
                                  {String(latestAccessRequestByArticleId.get(Number(item.id))?.status || '').toLowerCase() === 'pending' ? '待审批' : '申请查看'}
                                </button>
                              ) : null}
                              {!isFaqBasicUser && !recycleMode && item.visibility !== 'restricted' ? (
                                <button className="link" onClick={() => onToggleFavorite(item.id)}>
                                  {favoriteIdSet.has(Number(item.id)) ? '取消收藏' : '收藏'}
                                </button>
                              ) : null}
                              {canManageArticleItem(item) && !recycleMode ? (
                                <button className="link" onClick={() => onOpenEditArticle(item)}>编辑</button>
                              ) : null}
                              {isAdmin && !recycleMode ? (
                                <>
                                  <button className="link" onClick={() => onTogglePin(item.id, item.is_pinned)}>{item.is_pinned ? '取消置顶' : '置顶'}</button>
                                  <button className="link danger" onClick={() => onRequestDeleteArticle(item)}>删除</button>
                                </>
                              ) : null}
                              {isAdmin && recycleMode ? (
                                <>
                                  <button className="link" onClick={() => onRestoreArticle(item.id)}>恢复</button>
                                  <button className="link danger" onClick={() => onPurgeArticle(item)}>彻底删除</button>
                                </>
                              ) : null}
                            </span>
                          </span>
                        </div>
                      ))}
                      {!articles.items.length ? (
                        <div className="empty">
                          <p>{recycleMode ? '回收站为空，可切换回文档列表继续管理。' : '暂无文档数据，先创建一篇或上传一个文档版本。'}</p>
                          {!recycleMode && canManageArticles ? (
                            <button className="primary" type="button" onClick={() => setArticleComposerOpen(true)}>新建第一篇文档</button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="pagination-bar">
                  <span className="muted">共 {articles.total || 0} 条 · 第 {articles.page || 1}/{totalPages} 页</span>
                  <div className="row-actions">
                    <button className="ghost" disabled={(articles.page || 1) <= 1 || articlesLoading} onClick={() => fetchArticles((articles.page || 1) - 1)}>
                      上一页
                    </button>
                    <button className="ghost" disabled={(articles.page || 1) >= totalPages || articlesLoading} onClick={() => fetchArticles((articles.page || 1) + 1)}>
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </section>
        )}
      </main>

      {selectedArticle && (
        <div className="detail-modal-mask" onClick={onCloseDetailModal}>
          <section
            ref={detailModalRef}
            className={`detail-modal panel ${draggingDetailModal ? 'dragging' : ''}`}
            style={{ transform: `translate(${detailModalOffset.x}px, ${detailModalOffset.y}px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`detail-modal-top ${draggingDetailModal ? 'dragging' : ''}`} onMouseDown={onDetailDragStart}>
              <div className="detail-modal-intro">
                <p className="detail-kicker">文档详情与预览</p>
                <h2>{selectedArticle.title}</h2>
                <div className="detail-meta-row">
                  <span className={`status-chip status-${String(selectedArticle.status || 'draft').toLowerCase()}`}>{statusText(selectedArticle.status)}</span>
                  <span className="meta-dot" />
                  <span className={`status-chip status-library-${String(selectedArticle.library_scope || 'department').toLowerCase()}`}>{libraryScopeText(selectedArticle.library_scope)}</span>
                  <span className="meta-dot" />
                  <span>{String(selectedArticle.library_scope || 'department').toLowerCase() === 'global' ? '全公司' : departmentLabel(selectedArticle.department_code)}</span>
                  <span className="meta-dot" />
                  <span>{selectedArticle.category_name || '无分类'}</span>
                  <span className="meta-dot" />
                  <span>更新时间 {formatDateTime(selectedArticle.updated_at)}</span>
                </div>
                <p className="detail-summary">{selectedArticle.summary || '暂无摘要描述'}</p>
              </div>

              <div className="detail-top-actions">
                <div className="badge-soft">当前版本：{previewVersion ? `v${previewVersion.version_no}` : '未选择'}</div>
                <button className="ghost" onClick={onCloseDetailModal}>关闭</button>
              </div>
            </div>
            <div className="panel-body detail-modal-body">
              <div className="detail-actions-bar">
                <div className="detail-actions-main">
                  {selectedArticleManageable ? (
                    <button className="ghost" onClick={() => onOpenEditArticle(selectedArticle)}>编辑信息</button>
                  ) : null}
                  {selectedArticleManageable ? (
                    <label className="ghost upload-btn">
                      {uploadingArticleId === selectedArticle.id ? '上传中...' : '上传文件'}
                      <input
                        type="file"
                        disabled={uploadingArticleId === selectedArticle.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          onUploadVersion(selectedArticle.id, file)
                        }}
                      />
                    </label>
                  ) : null}
                  {!isFaqBasicUser ? (
                    <button className="ghost" onClick={() => onToggleFavorite(selectedArticle.id)}>
                      {selectedArticleFavorited ? '取消收藏' : '收藏'}
                    </button>
                  ) : null}

                  {previewVersion ? (
                    <a className="ghost" href={`/api/faq/versions/${previewVersion.id}/download`} target="_blank" rel="noreferrer">下载当前版本文件</a>
                  ) : null}
                </div>

                <div className="detail-actions-ops">
                  {selectedArticleManageable ? <button className="ghost" onClick={onOpenPublishDialog}>{isReviewer ? '发布' : '提审发布'}</button> : null}
                  {isAdmin ? <button className="ghost" onClick={() => onArchiveStatus(selectedArticle.id)}>归档</button> : null}
                  {selectedArticleManageable ? (
                    <>
                      <button
                        className="primary"
                        onClick={onOpenEditor}
                        disabled={editorLoading || Boolean(editorDisabledReason)}
                        title={editorDisabledReason || '在线编辑 Word 文档'}
                      >
                        {editorLoading ? '准备编辑器...' : '在线编辑Word'}
                      </button>
                      {editorDisabledReason ? <span className="muted">{editorDisabledReason}</span> : null}
                    </>
                  ) : null}
                </div>
              </div>

              <div className="detail-main-grid">
                <section className="version-panel">
                  <div className="section-head">
                    <h3>版本时间线</h3>
                    <span>{versions.length} 个版本</span>
                  </div>
                  <div className="compare-toolbar">
                    <select
                      value={compareState.leftVersionId}
                      onChange={(e) => setCompareState((prev) => ({ ...prev, leftVersionId: e.target.value }))}
                    >
                      <option value="">选择左侧版本</option>
                      {versions.map((v) => <option key={`left-${v.id}`} value={v.id}>{`v${v.version_no}`}</option>)}
                    </select>
                    <select
                      value={compareState.rightVersionId}
                      onChange={(e) => setCompareState((prev) => ({ ...prev, rightVersionId: e.target.value }))}
                    >
                      <option value="">选择右侧版本</option>
                      {versions.map((v) => <option key={`right-${v.id}`} value={v.id}>{`v${v.version_no}`}</option>)}
                    </select>
                    <button className="ghost" onClick={onCompareVersions} disabled={compareState.loading}>
                      {compareState.loading ? '对比中...' : '版本对比'}
                    </button>
                  </div>
                  <div className="version-scroll">
                    {versions.map((v) => (
                      <article key={v.id} className={`version-item ${previewVersion?.id === v.id ? 'active' : ''}`}>
                        <div className="version-line-dot" />
                        <div className="version-content">
                          <div className="version-head">
                            <strong>v{v.version_no}</strong>
                            <span className="version-source">{versionSourceText(v.source_type)} / {fileExtText(v.source_ext)}</span>
                          </div>
                          <span className="version-time">{formatDateTime(v.created_at)}</span>
                          <div className="row-actions">
                            <button className="link" onClick={() => setPreviewVersion(v)}>查看预览</button>
                            <button className="link" onClick={() => setCompareState((prev) => ({ ...prev, leftVersionId: String(v.id) }))}>设为左侧</button>
                            <button className="link" onClick={() => setCompareState((prev) => ({ ...prev, rightVersionId: String(v.id) }))}>设为右侧</button>
                            {isAdmin ? <button className="link" onClick={() => onRestoreVersion(selectedArticle.id, v.id)}>回滚</button> : null}
                          </div>
                        </div>
                      </article>
                    ))}
                    {!versions.length ? <div className="empty">暂无版本</div> : null}
                  </div>
                </section>

                <section className="preview-panel">
                  <div className="section-head">
                    <h3>在线预览</h3>
                    <div className="section-head-actions">
                      <span>{previewVersion ? `v${previewVersion.version_no}` : '未选择版本'}</span>
                      {previewVersion ? (
                        <button className="ghost section-head-btn" onClick={onTogglePreviewFullscreen}>
                          {previewFullscreen ? '退出全屏' : '全屏预览'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div ref={previewStageRef} className={`preview-stage ${previewFullscreen ? 'is-fullscreen' : ''}`}>
                    {previewVersion ? (
                      <iframe className="preview-frame" title="FAQ预览" src={`/api/faq/versions/${previewVersion.id}/preview`} />
                    ) : (
                      <div className="empty">请选择左侧版本进行预览</div>
                    )}
                  </div>

                  <div className="compare-result-block">
                    <div className="section-subhead">
                      <h4>版本差异</h4>
                      <span className="muted">{compareState.result?.summary ? `变更比 ${Math.round((compareState.result.summary.change_ratio || 0) * 100)}%` : '尚未执行对比'}</span>
                    </div>
                    {compareState.result?.comparable === false ? (
                      <div className="empty">{compareState.result.reason || '当前版本暂不支持文本差异对比'}</div>
                    ) : null}
                    {compareState.result?.summary ? (
                      <div className="diff-summary">
                        <span>新增块 {compareState.result.summary.add_blocks || 0}</span>
                        <span>删除块 {compareState.result.summary.remove_blocks || 0}</span>
                        <span>相同块 {compareState.result.summary.equal_blocks || 0}</span>
                        {compareState.result.diff_truncated ? <span className="muted">已截断展示</span> : null}
                      </div>
                    ) : null}
                    {Array.isArray(compareState.result?.entries) && compareState.result.entries.length ? (
                      <div className="diff-list">
                        {compareState.result.entries.map((item, idx) => (
                          <pre key={`diff-${idx}`} className={`diff-item diff-${item.type}`}>{item.text}</pre>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="feedback-block">
                    <div className="section-subhead">
                      <h4>反馈闭环</h4>
                      <span className="muted">
                        解决率 {Math.round((Number(feedbackState.summary?.solved_rate || 0)) * 100)}%
                        · 共 {feedbackState.summary?.total || 0} 条反馈
                      </span>
                    </div>
                    <div className="feedback-actions">
                      <button
                        className={`ghost ${feedbackState.solved === 'yes' ? 'is-selected' : ''}`}
                        onClick={() => setFeedbackState((prev) => ({ ...prev, solved: 'yes' }))}
                        disabled={feedbackState.loading}
                      >
                        已解决
                      </button>
                      <button
                        className={`ghost ${feedbackState.solved === 'no' ? 'is-selected' : ''}`}
                        onClick={() => setFeedbackState((prev) => ({ ...prev, solved: 'no' }))}
                        disabled={feedbackState.loading}
                      >
                        未解决
                      </button>
                      <button className="primary" onClick={onSubmitFeedback} disabled={feedbackState.loading}>
                        {feedbackState.loading ? '提交中...' : '提交反馈'}
                      </button>
                    </div>
                    {feedbackState.solved === 'no' ? (
                      <div className="feedback-form">
                        <select
                          value={feedbackState.reason_code}
                          onChange={(e) => setFeedbackState((prev) => ({ ...prev, reason_code: e.target.value }))}
                          disabled={feedbackState.loading}
                        >
                          <option value="">选择未解决原因</option>
                          {FEEDBACK_REASON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                        <input
                          value={feedbackState.reason_text}
                          onChange={(e) => setFeedbackState((prev) => ({ ...prev, reason_text: e.target.value }))}
                          placeholder="可补充具体场景或期望改进点"
                          disabled={feedbackState.loading}
                        />
                      </div>
                    ) : null}
                    {Array.isArray(feedbackState.summary?.reasons) && feedbackState.summary.reasons.length ? (
                      <div className="feedback-reasons">
                        {feedbackState.summary.reasons.map((item) => (
                          <span key={item.reason_code} className="feedback-reason-tag">{item.reason_label} · {item.total}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      )}

      {publishDialog.open && selectedArticle && (
        <div className="confirm-modal-mask" onClick={onClosePublishDialog}>
          <section className="confirm-modal panel publish-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{isReviewer ? '发布前校验' : '提审前校验'}</h3>
            <p>发布说明会写入版本记录，审批通过后自动发布到当前版本。</p>

            <div className="publish-modal-row">
              <span>目标版本</span>
              <select
                value={publishDialog.targetVersionId}
                onChange={(e) => setPublishDialog((prev) => ({ ...prev, targetVersionId: e.target.value }))}
                disabled={publishDialog.loading || publishDialog.submitting}
              >
                <option value="">请选择</option>
                {versions.map((v) => <option key={`publish-target-${v.id}`} value={v.id}>{`v${v.version_no} (${versionSourceText(v.source_type)})`}</option>)}
              </select>
              <button className="ghost" onClick={onRefreshPublishCheck} disabled={publishDialog.loading || publishDialog.submitting}>
                {publishDialog.loading ? '校验中...' : '重新校验'}
              </button>
            </div>

            <div className="publish-checks">
              {(publishDialog.checks || []).map((item) => (
                <div key={item.key} className={`publish-check-item ${item.ok ? 'ok' : 'bad'}`}>
                  <strong>{item.ok ? '通过' : '失败'}</strong>
                  <span>{item.label}</span>
                  {item.detail ? <em>{item.detail}</em> : null}
                </div>
              ))}
              {!publishDialog.checks.length ? <div className="empty">暂无校验结果</div> : null}
            </div>

            <div className="publish-modal-row stack">
              <span>发布说明</span>
              <textarea
                value={publishDialog.note}
                onChange={(e) => setPublishDialog((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="例如：补充了技术方案章节并修复了部署步骤。"
                disabled={publishDialog.submitting}
                maxLength={500}
              />
            </div>

            <div className="publish-modal-row">
              <span>发布方式</span>
              <select
                value={publishDialog.mode}
                onChange={(e) => setPublishDialog((prev) => ({ ...prev, mode: e.target.value }))}
                disabled={!isReviewer || publishDialog.submitting}
              >
                {isReviewer ? <option value="direct">直接发布</option> : null}
                <option value="review">提交审批后发布</option>
              </select>
            </div>

            {Array.isArray(selectedArticle.publish_requests) && selectedArticle.publish_requests.length ? (
              <div className="publish-history">
                <h4>最近审批记录</h4>
                <div className="publish-history-list">
                  {selectedArticle.publish_requests.slice(0, 4).map((item) => (
                    <div key={`req-${item.id}`} className="publish-history-item">
                      <span>#{item.id} · {reviewStatusText(item.status)}</span>
                      <span>{item.requester_name || '-'}</span>
                      <span>{formatDateTime(item.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="confirm-modal-actions">
              <button className="ghost" onClick={onClosePublishDialog} disabled={publishDialog.submitting}>取消</button>
              <button className="primary" onClick={onSubmitPublish} disabled={publishDialog.submitting || publishDialog.loading}>
                {publishDialog.submitting ? '提交中...' : (publishDialog.mode === 'review' ? '提交审批' : '确认发布')}
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteConfirm.open && (
        <div className="confirm-modal-mask" onClick={onCancelDeleteArticle}>
          <section className="confirm-modal panel" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除文档</h3>
            <p>
              将把「{deleteConfirm.article?.title || '-'}」移入回收站，可在到期前恢复。
            </p>
            <div className="confirm-inline">
              <span>自动清理时间</span>
              <select
                value={String(deleteConfirm.retention_days || 30)}
                onChange={(e) => setDeleteConfirm((prev) => ({ ...prev, retention_days: Number(e.target.value) === 7 ? 7 : 30 }))}
                disabled={deleteConfirm.loading}
              >
                <option value="30">30 天后自动清理</option>
                <option value="7">7 天后自动清理</option>
              </select>
            </div>
            <div className="confirm-modal-actions">
              <button className="ghost" onClick={onCancelDeleteArticle} disabled={deleteConfirm.loading}>取消</button>
              <button className="primary danger-btn" onClick={onConfirmDeleteArticle} disabled={deleteConfirm.loading}>
                {deleteConfirm.loading ? '处理中...' : '确认删除'}
              </button>
            </div>
          </section>
        </div>
      )}

      {editArticleDialog.open && (
        <div className="confirm-modal-mask" onClick={onCloseEditArticleDialog}>
          <section className="confirm-modal panel article-edit-modal" onClick={(e) => e.stopPropagation()}>
            <h3>编辑文档信息</h3>
            <p>支持修改标题、摘要和分类，文档版本内容不会受影响。</p>
            <form className="article-edit-form" onSubmit={onSubmitEditArticle}>
              <label>
                <span>标题</span>
                <input
                  value={editArticleDialog.title}
                  onChange={(e) => setEditArticleDialog((prev) => ({ ...prev, title: e.target.value }))}
                  maxLength={160}
                  required
                  disabled={editArticleDialog.submitting}
                />
              </label>
              <label>
                <span>摘要</span>
                <textarea
                  value={editArticleDialog.summary}
                  onChange={(e) => setEditArticleDialog((prev) => ({ ...prev, summary: e.target.value }))}
                  placeholder="可填写文档场景、适用范围或关键步骤说明"
                  maxLength={1000}
                  disabled={editArticleDialog.submitting}
                />
              </label>
              <label>
                <span>分类</span>
                <select
                  value={editArticleDialog.category_id}
                  onChange={(e) => setEditArticleDialog((prev) => ({ ...prev, category_id: e.target.value }))}
                  disabled={editArticleDialog.submitting}
                >
                  <option value="">无分类</option>
                  {editArticleCategories.map((item) => <option key={`edit-category-${item.id}`} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                <span>文库范围</span>
                <select
                  value={editArticleDialog.library_scope}
                  onChange={(e) => setEditArticleDialog((prev) => ({
                    ...prev,
                    library_scope: e.target.value,
                    department_code: e.target.value === 'global' ? '' : (prev.department_code || currentDepartmentCode),
                    category_id: '',
                  }))}
                  disabled={editArticleDialog.submitting}
                >
                  {canManageGlobalLibrary ? <option value="global">全局库</option> : null}
                  <option value="department">部门库</option>
                </select>
              </label>
              {editArticleDialog.library_scope === 'department' ? (
                <label>
                  <span>归属部门</span>
                  <select
                    value={editArticleDialog.department_code}
                    onChange={(e) => setEditArticleDialog((prev) => ({ ...prev, department_code: e.target.value, category_id: '' }))}
                    disabled={editArticleDialog.submitting}
                  >
                    <option value="">选择部门</option>
                    {departmentOptions.map((item) => <option key={`edit-dept-${item.code}`} value={item.code}>{item.name}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="confirm-modal-actions">
                <button className="ghost" type="button" onClick={onCloseEditArticleDialog} disabled={editArticleDialog.submitting}>
                  取消
                </button>
                <button className="primary" type="submit" disabled={editArticleDialog.submitting}>
                  {editArticleDialog.submitting ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editorVisible && editorPayload && (
        <div className="editor-modal-mask" onClick={onCloseEditor}>
          <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="editor-modal-top">
              <div className="editor-modal-intro">
                <p className="editor-kicker">Word 在线编辑</p>
                <h3>{selectedArticle?.title || '当前文档'}</h3>
                <p>支持自动保存草稿，确认后再发布为新版本。</p>
                <div className="editor-status-bar">
                  <span><strong>锁持有者：</strong>{editorStatus?.owner_name || '-'}</span>
                  <span><strong>剩余时间：</strong>{editorStatus?.remaining_seconds === null || editorStatus?.remaining_seconds === undefined ? '-' : formatRemaining(editorStatus.remaining_seconds)}</span>
                  <span><strong>最近保存：</strong>{editorStatus?.last_saved_at ? formatDateTime(editorStatus.last_saved_at) : '-'}</span>
                  <span className={editorOnline ? 'online-ok' : 'online-bad'}><strong>网络：</strong>{editorOnline ? '在线' : '离线'}</span>
                </div>
                
              </div>
              <div className="editor-header-actions">
                <span className="badge-soft">编辑模式</span>
                <div className="row-actions">
                  <button className="ghost" onClick={onDiscardEditorDraft}>放弃草稿</button>
                  <button className="primary" onClick={onPublishEditorDraft}>发布草稿</button>
                  <button className="ghost" onClick={onCloseEditor}>关闭</button>
                </div>
              </div>
            </div>
            <div className="editor-workbench">
              <div className="editor-frame-shell">
                <div id={editorContainerId} className="doc-editor-container" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

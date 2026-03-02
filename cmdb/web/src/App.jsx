import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

const getPortalBaseUrl = () => {
  const configured = String(import.meta.env.VITE_SSO_PORTAL_URL || '').trim()
  if (configured) return configured.replace(/\/+$/, '')
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:5180`
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

const portalSessionQueryKey = 'portal_session'
const portalSessionStorageKey = 'juxin_portal_session'

const readPortalSessionMarker = () => {
  try {
    return String(sessionStorage.getItem(portalSessionStorageKey) || '').trim()
  } catch {
    return ''
  }
}

const consumePortalSessionMarker = () => {
  try {
    const params = new URLSearchParams(window.location.search)
    const marker = String(params.get(portalSessionQueryKey) || '').trim()
    if (marker) {
      sessionStorage.setItem(portalSessionStorageKey, marker)
      params.delete(portalSessionQueryKey)
      const query = params.toString()
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`
      window.history.replaceState({}, '', nextUrl)
      return marker
    }
  } catch {
    return ''
  }
  return readPortalSessionMarker()
}

const logoutFromSso = async () => {
  try {
    const csrfResp = await fetch('/api/auth/csrf', { credentials: 'include' })
    if (!csrfResp.ok) return false
    let csrfToken = ''
    try {
      const csrfPayload = await csrfResp.json()
      csrfToken = String(csrfPayload?.token || '')
    } catch {
      csrfToken = ''
    }
    if (!csrfToken) return false
    const logoutResp = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    })
    return logoutResp.ok
  } catch {
    return false
  }
}

const navTree = [
  {
    key: 'dashboard',
    icon: '◴',
    label: '仪表盘',
    desc: '查看资产总体状态、变化趋势与最近变更。',
  },
  {
    key: 'asset',
    icon: '▣',
    label: '资产管理',
    children: [
      { key: 'asset-server', label: '服务器', desc: '管理服务器资产信息。' },
      { key: 'asset-database', label: '数据库', desc: '管理数据库资产信息。' },
      { key: 'asset-network', label: '网络设备', desc: '管理网络设备资产信息。' },
      { key: 'asset-middleware', label: '中间件', desc: '管理中间件资产信息。' },
    ],
  },
  {
    key: 'model',
    icon: '◱',
    label: '模型管理',
    desc: '维护模型模板、字段和标准属性。',
  },
  {
    key: 'relation',
    icon: '⛓',
    label: '关系管理',
    children: [
      { key: 'relation-topology', label: '拓扑视图', desc: '查看配置项拓扑关系视图。' },
      { key: 'relation-list', label: '关系列表', desc: '查看并维护配置项关系。' },
    ],
  },
  {
    key: 'discovery',
    icon: '⌕',
    label: '自动发现',
    desc: '配置自动发现任务与同步策略。',
  },
  {
    key: 'change',
    icon: '↺',
    label: '变更管理',
    desc: '管理变更申请、审批、执行与回滚闭环。',
  },
  {
    key: 'report',
    icon: '▤',
    label: '报表分析',
    desc: '查看统计报表与趋势分析。',
  },
]

const auditorNavTree = [
  {
    key: 'audit',
    icon: '☷',
    label: '审计日志',
    desc: '查看 CMDB 审计相关能力。',
  },
]

const assetTabs = [
  { key: 'query', label: '资产查询' },
  { key: 'create', label: '新增资产' },
  { key: 'update', label: '资产更新' },
]

const assetTypeKeyMap = {
  'asset-server': 'host',
  'asset-database': 'database',
  'asset-network': 'environment',
  'asset-middleware': 'middleware',
}

const roleLabelMap = {
  admin: '管理员',
  sysadmin: '系统管理员',
  auditor: '审计管理员',
  viewer: '只读用户',
  sales: '业务用户',
}

const ciTypeOptions = [
  { value: 'application', label: '应用系统' },
  { value: 'host', label: '主机设备' },
  { value: 'database', label: '数据库' },
  { value: 'middleware', label: '中间件' },
  { value: 'environment', label: '运行环境' },
]

const statusOptions = [
  { value: 'active', label: '正常' },
  { value: 'inactive', label: '停用' },
  { value: 'retired', label: '退役' },
]

const sourceOptions = [
  { value: 'manual', label: '人工录入' },
  { value: 'discovery', label: '自动发现' },
  { value: 'cloud', label: '云平台同步' },
  { value: 'import', label: '批量导入' },
]

const ciTypeLabelToKeyMap = Object.fromEntries(ciTypeOptions.map((item) => [item.label, item.value]))
const statusLabelToKeyMap = Object.fromEntries(statusOptions.map((item) => [item.label, item.value]))
const sourceLabelToKeyMap = Object.fromEntries(sourceOptions.map((item) => [item.label, item.value]))

const relationTypeOptions = [
  { value: 'depends_on', label: '依赖于' },
  { value: 'runs_on', label: '运行于' },
  { value: 'connects_to', label: '连接到' },
  { value: 'owned_by', label: '归属于' },
]

const changeRiskOptions = [
  { value: 'low', label: '低风险' },
  { value: 'medium', label: '中风险' },
  { value: 'high', label: '高风险' },
]

const changeStatusOptions = [
  { value: 'pending_approval', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'rejected', label: '已驳回' },
  { value: 'completed', label: '已执行' },
  { value: 'rolled_back', label: '已回滚' },
  { value: 'cancelled', label: '已取消' },
]

const modelFieldDataTypeOptions = [
  { value: 'string', label: '文本(string)' },
  { value: 'number', label: '数字(number)' },
  { value: 'boolean', label: '布尔(boolean)' },
  { value: 'object', label: '对象(object)' },
  { value: 'array', label: '数组(array)' },
]

const methodLabelMap = {
  GET: '查询',
  POST: '新建',
  PATCH: '更新',
  PUT: '覆盖更新',
  DELETE: '删除',
}

const defaultModelTemplates = [
  { id: 'model-host', name: '主机模型', ci_type_key: 'host', icon: '◍', description: '用于 Linux/Windows 主机资产', created_at: '2026-01-10T08:00:00Z' },
  { id: 'model-db', name: '数据库模型', ci_type_key: 'database', icon: '◎', description: '用于 MySQL/PostgreSQL/Oracle 等数据库实例', created_at: '2026-01-10T08:05:00Z' },
  { id: 'model-mw', name: '中间件模型', ci_type_key: 'middleware', icon: '◉', description: '用于消息队列、缓存、注册中心等中间件', created_at: '2026-01-10T08:10:00Z' },
  { id: 'model-env', name: '网络与环境模型', ci_type_key: 'environment', icon: '◌', description: '用于交换机、路由器、防火墙和网络环境资产', created_at: '2026-01-10T08:15:00Z' },
  { id: 'model-app', name: '应用模型', ci_type_key: 'application', icon: '◇', description: '用于业务应用与服务实例', created_at: '2026-01-10T08:20:00Z' },
]

const defaultDiscoveryTasks = [
  {
    id: 'discover-host-daily',
    name: '主机资产巡检发现',
    ci_type_key: 'host',
    owner: 'CMDB平台',
    schedule: '每天 02:00',
    enabled: true,
    batch_size: 2,
    last_run_at: '',
    last_status: '',
    created_at: '2026-02-01T02:00:00Z',
  },
  {
    id: 'discover-db-hourly',
    name: '数据库资产快速发现',
    ci_type_key: 'database',
    owner: 'DBA团队',
    schedule: '每 4 小时',
    enabled: true,
    batch_size: 1,
    last_run_at: '',
    last_status: '',
    created_at: '2026-02-01T02:10:00Z',
  },
]

const emptyDashboard = {
  totals: {
    asset_total: 0,
    monthly_new: 0,
    pending_count: 0,
    anomaly_count: 0,
  },
  type_distribution: [],
  growth_trend: [],
  owner_distribution: [],
  recent_changes: [],
}

const emptyAssetResult = {
  items: [],
  total: 0,
  page: 1,
  page_size: 10,
}

const emptyAuditResult = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
}

const emptyRelationResult = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
}

const emptyTopologyResult = {
  nodes: [],
  edges: [],
  total_nodes: 0,
  total_edges: 0,
}

const emptyChangeResult = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
}

const emptyReportResult = {
  days: 30,
  totals: {
    asset_total: 0,
    active_total: 0,
    discovery_total: 0,
    cloud_total: 0,
    relation_total: 0,
    change_total: 0,
    complexity_index: 0,
  },
  change_frequency_trend: [],
  relation_complexity_trend: [],
}

const emptyModelForm = {
  name: '',
  ci_type_key: 'host',
  icon: '◍',
  description: '',
}

const emptyModelFieldForm = {
  field_key: '',
  field_label: '',
  data_type: 'string',
  required: false,
  default_value_text: '',
}

const emptyDiscoveryTaskForm = {
  name: '',
  ci_type_key: 'host',
  task_mode: 'scan',
  source_type: 'mock',
  endpoint_url: '',
  sync_mode: 'upsert',
  request_method: 'GET',
  owner: '',
  schedule: '每天 02:00',
  batch_size: 1,
}

const emptyChangeForm = {
  title: '',
  target_ci_uid: '',
  risk_level: 'medium',
  planned_start_at: '',
  planned_end_at: '',
  description: '',
}

const extraAttrsHelpText = `主要作用：保存资产的自定义字段，不用改数据库表结构。\n典型例子：{"ip":"10.10.1.5","cpu":"8C","内存":"32GB","机房":"A区-3层"}`

const formatRoleLabel = (role) => {
  const key = String(role || '').toLowerCase()
  return roleLabelMap[key] || '普通用户'
}

const formatOptionLabel = (options, value) => {
  const match = options.find((item) => item.value === value)
  return match ? match.label : String(value || '-')
}

const statusClassName = (status) => {
  const key = String(status || '').toLowerCase()
  if (key === 'active' || status === '正常') return 'status-tag success'
  if (key === 'inactive' || status === '下线') return 'status-tag offline'
  return 'status-tag danger'
}

const formatStatusLabel = (status) => {
  const key = String(status || '').toLowerCase()
  if (key === 'active') return '正常'
  if (key === 'inactive') return '停用'
  if (key === 'retired') return '退役'
  return String(status || '-')
}

const formatChangeStatusLabel = (status) => {
  const key = String(status || '').toLowerCase()
  if (key === 'pending_approval') return '待审批'
  if (key === 'approved') return '已审批'
  if (key === 'rejected') return '已驳回'
  if (key === 'completed') return '已执行'
  if (key === 'rolled_back') return '已回滚'
  if (key === 'cancelled') return '已取消'
  return String(status || '-')
}

const changeStatusClassName = (status) => {
  const key = String(status || '').toLowerCase()
  if (key === 'approved' || key === 'completed') return 'status-tag success'
  if (key === 'pending_approval') return 'status-tag offline'
  return 'status-tag danger'
}

const normalizeApiError = (err) => {
  let msg = err && err.message ? String(err.message) : ''
  try {
    const parsed = JSON.parse(msg)
    if (parsed && parsed.error) msg = String(parsed.error)
  } catch {
    // ignore
  }
  msg = msg.replace(/<[^>]*>/g, '').trim()
  return msg || '请求失败'
}

const formatRelativeTime = (value) => {
  if (!value) return '-'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '-'
  const diffMs = Date.now() - dt.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}天前`
  return dt.toLocaleDateString()
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '-'
  return dt.toLocaleString()
}

const createLocalId = (prefix) => {
  const randomPart = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now()}-${randomPart}`
}

const pad2 = (value) => String(value).padStart(2, '0')

const formatDateKey = (date) => {
  const dt = new Date(date)
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

function App() {
  const [authToken, setAuthToken] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const isAuditOnlyUser = String(currentUser?.role || '').toLowerCase() === 'auditor'
  const visibleNavTree = useMemo(() => (isAuditOnlyUser ? auditorNavTree : navTree), [isAuditOnlyUser])

  const [activeKey, setActiveKey] = useState('dashboard')
  const [expandedMenus, setExpandedMenus] = useState({ asset: true, relation: true })

  const [assetTab, setAssetTab] = useState('query')
  const [assetFilter, setAssetFilter] = useState({ keyword: '', status: '', owner: '' })
  const [assetPage, setAssetPage] = useState(1)
  const [assetPageSize, setAssetPageSize] = useState(10)
  const [assetResult, setAssetResult] = useState(emptyAssetResult)
  const [assetLoading, setAssetLoading] = useState(false)
  const [auditFilter, setAuditFilter] = useState({
    actor: '',
    action: '',
    result: '',
    source_ip: '',
    keyword: '',
    date_from: '',
    date_to: '',
  })
  const [auditPage, setAuditPage] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(20)
  const [auditResult, setAuditResult] = useState(emptyAuditResult)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditLoadedAt, setAuditLoadedAt] = useState('')
  const [relationFilter, setRelationFilter] = useState({
    relation_type: '',
    from_ci_uid: '',
    to_ci_uid: '',
    keyword: '',
  })
  const [relationPage, setRelationPage] = useState(1)
  const [relationPageSize, setRelationPageSize] = useState(20)
  const [relationResult, setRelationResult] = useState(emptyRelationResult)
  const [relationLoading, setRelationLoading] = useState(false)
  const [relationLoadedAt, setRelationLoadedAt] = useState('')
  const [topologyFilter, setTopologyFilter] = useState({
    keyword: '',
    focus_ci_uid: '',
    limit: 300,
  })
  const [topologyData, setTopologyData] = useState(emptyTopologyResult)
  const [topologyLoading, setTopologyLoading] = useState(false)
  const [topologyLoadedAt, setTopologyLoadedAt] = useState('')
  const [pathForm, setPathForm] = useState({
    from_ci_uid: '',
    to_ci_uid: '',
    max_depth: 6,
  })
  const [pathResult, setPathResult] = useState(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [changeFilter, setChangeFilter] = useState({
    status: '',
    risk_level: '',
    keyword: '',
  })
  const [changePage, setChangePage] = useState(1)
  const [changePageSize, setChangePageSize] = useState(20)
  const [changeResult, setChangeResult] = useState(emptyChangeResult)
  const [changeLoading, setChangeLoading] = useState(false)
  const [changeLoadedAt, setChangeLoadedAt] = useState('')
  const [changeDetail, setChangeDetail] = useState(null)
  const [changeDialogOpen, setChangeDialogOpen] = useState(false)
  const [changeForm, setChangeForm] = useState(emptyChangeForm)

  const [lookupUID, setLookupUID] = useState('')
  const [lookupResult, setLookupResult] = useState(null)
  const [lastResponse, setLastResponse] = useState(null)
  const [dashboardData, setDashboardData] = useState(emptyDashboard)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardLoadedAt, setDashboardLoadedAt] = useState('')
  const [modelTemplates, setModelTemplates] = useState(defaultModelTemplates)
  const [modelKeyword, setModelKeyword] = useState('')
  const [modelTypeFilter, setModelTypeFilter] = useState('')
  const [modelSort, setModelSort] = useState('count-desc')
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [modelForm, setModelForm] = useState(emptyModelForm)
  const [modelFieldDialogOpen, setModelFieldDialogOpen] = useState(false)
  const [currentModelForFields, setCurrentModelForFields] = useState(null)
  const [modelFieldRules, setModelFieldRules] = useState([])
  const [modelFieldLoading, setModelFieldLoading] = useState(false)
  const [modelFieldForm, setModelFieldForm] = useState(emptyModelFieldForm)

  const [discoveryTasks, setDiscoveryTasks] = useState(defaultDiscoveryTasks)
  const [discoveryLogs, setDiscoveryLogs] = useState([])
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false)
  const [discoveryTaskForm, setDiscoveryTaskForm] = useState(emptyDiscoveryTaskForm)
  const [discoveryRunning, setDiscoveryRunning] = useState(false)

  const [reportResult, setReportResult] = useState(emptyReportResult)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportLoadedAt, setReportLoadedAt] = useState('')

  const [createForm, setCreateForm] = useState({
    ci_type_key: 'application',
    name: '',
    unique_key: '',
    status: 'active',
    owner: '',
    source: 'manual',
    source_ref: '',
    extra_attrs_text: '{\n  "团队": "平台"\n}',
  })

  const [updateForm, setUpdateForm] = useState({
    ci_uid: '',
    version: 1,
    name: '',
    status: '',
    owner: '',
    source_ref: '',
    extra_attrs_text: '',
  })

  const [relationForm, setRelationForm] = useState({
    from_ci_uid: '',
    to_ci_uid: '',
    relation_type: 'depends_on',
    attributes_text: '{\n  "方向": "出向"\n}',
  })

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: '确认',
    onConfirm: null,
  })
  const [formatDialog, setFormatDialog] = useState({
    open: false,
    title: '',
    mode: 'export',
    onPick: null,
  })

  useEffect(() => {
    let cancelled = false
    const bootstrapAuth = async () => {
      try {
        const marker = consumePortalSessionMarker()
        if (!marker) return
        const resp = await fetch('/api/auth/me', { credentials: 'include' })
        if (!resp.ok) return
        const data = await resp.json()
        if (cancelled) return
        if (data?.id) {
          setAuthToken('cookie')
          setCurrentUser(data)
        }
      } catch (_err) {
        // ignore
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    }
    bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!authReady) return
    if (authToken) return
    const timer = setTimeout(() => {
      window.location.href = buildPortalEntryUrl('cmdb')
    }, logoutPending ? 1000 : 120)
    return () => clearTimeout(timer)
  }, [authReady, authToken, logoutPending])

  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null)
      return
    }
    const controller = new AbortController()
    fetch('/api/auth/me', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(await resp.text())
        return resp.json()
      })
      .then((data) => {
        if (!data?.id) {
          setAuthToken('')
          return
        }
        setCurrentUser(data)
      })
      .catch(() => {
        setAuthToken('')
      })
    return () => controller.abort()
  }, [authToken])

  useEffect(() => {
    const hasActive = visibleNavTree.some((top) => {
      if (top.key === activeKey) return true
      if (!Array.isArray(top.children)) return false
      return top.children.some((child) => child.key === activeKey)
    })
    if (hasActive) return
    const fallbackTop = visibleNavTree[0]
    const fallbackKey = fallbackTop?.children?.[0]?.key || fallbackTop?.key || 'dashboard'
    setActiveKey(fallbackKey)
  }, [visibleNavTree, activeKey])

  const apiHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
    }),
    [],
  )

  const currentAssetTypeKey = useMemo(() => assetTypeKeyMap[activeKey] || '', [activeKey])
  const typeCountMap = useMemo(() => {
    const rows = Array.isArray(dashboardData?.type_distribution) ? dashboardData.type_distribution : []
    return rows.reduce((acc, item) => {
      const key = String(item?.key || '').trim()
      if (!key) return acc
      acc[key] = Number(item?.total || 0)
      return acc
    }, {})
  }, [dashboardData])

  const modelRows = useMemo(() => {
    const keyword = modelKeyword.trim().toLowerCase()
    const rows = modelTemplates
      .map((item) => ({
        ...item,
        instance_count: Number(item.instance_count || typeCountMap[item.ci_type_key] || 0),
      }))
      .filter((item) => {
        if (modelTypeFilter && item.ci_type_key !== modelTypeFilter) return false
        if (!keyword) return true
        const text = `${item.name || ''} ${item.description || ''} ${item.ci_type_key || ''}`.toLowerCase()
        return text.includes(keyword)
      })
      .sort((a, b) => {
        if (modelSort === 'name-asc') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
        if (modelSort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''), 'zh-CN')
        if (modelSort === 'count-asc') return Number(a.instance_count || 0) - Number(b.instance_count || 0)
        return Number(b.instance_count || 0) - Number(a.instance_count || 0)
      })
    return rows
  }, [modelTemplates, typeCountMap, modelKeyword, modelTypeFilter, modelSort])

  const normalizeAssetResult = (payload) => {
    const page = Number(payload?.page || 1)
    const pageSize = Number(payload?.page_size || 10)
    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: Number(payload?.total || 0),
      page: page > 0 ? page : 1,
      page_size: pageSize > 0 ? pageSize : 10,
    }
  }

  const loadAssetList = async (silent = true, pageOverride) => {
    if (!authToken || !activeKey.startsWith('asset-')) return
    setAssetLoading(true)
    try {
      const targetPage = Number(pageOverride || assetPage || 1)
      const params = new URLSearchParams()
      params.set('page', String(targetPage))
      params.set('page_size', String(assetPageSize))
      if (currentAssetTypeKey) params.set('ci_type_key', currentAssetTypeKey)
      if (assetFilter.status) params.set('status', assetFilter.status)
      if (assetFilter.owner) params.set('owner', assetFilter.owner)
      if (assetFilter.keyword) params.set('keyword', assetFilter.keyword.trim())

      const resp = await fetch(`/api/v1/ci?${params.toString()}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '资产列表加载失败')
      }
      const normalized = normalizeAssetResult(payload)
      setAssetResult(normalized)
      if (normalized.page !== assetPage) setAssetPage(normalized.page)
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      setAssetLoading(false)
    }
  }

  const normalizeAuditResult = (payload) => {
    const page = Number(payload?.page || 1)
    const pageSize = Number(payload?.page_size || 20)
    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: Number(payload?.total || 0),
      page: page > 0 ? page : 1,
      page_size: pageSize > 0 ? pageSize : 20,
    }
  }

  const loadAuditLogs = async (silent = true, pageOverride) => {
    if (!authToken || activeKey !== 'audit') return
    setAuditLoading(true)
    try {
      const targetPage = Number(pageOverride || auditPage || 1)
      const params = new URLSearchParams()
      params.set('page', String(targetPage))
      params.set('page_size', String(auditPageSize))
      if (auditFilter.actor.trim()) params.set('actor', auditFilter.actor.trim())
      if (auditFilter.action.trim()) params.set('action', auditFilter.action.trim())
      if (auditFilter.result) params.set('result', auditFilter.result)
      if (auditFilter.source_ip.trim()) params.set('source_ip', auditFilter.source_ip.trim())
      if (auditFilter.keyword.trim()) params.set('keyword', auditFilter.keyword.trim())
      if (auditFilter.date_from) params.set('date_from', auditFilter.date_from)
      if (auditFilter.date_to) params.set('date_to', auditFilter.date_to)

      const resp = await fetch(`/api/v1/audit/logs?${params.toString()}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '审计日志加载失败')
      }
      const normalized = normalizeAuditResult(payload)
      setAuditResult(normalized)
      if (normalized.page !== auditPage) setAuditPage(normalized.page)
      setAuditLoadedAt(new Date().toLocaleString())
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      setAuditLoading(false)
    }
  }

  const normalizeRelationResult = (payload) => {
    const page = Number(payload?.page || 1)
    const pageSize = Number(payload?.page_size || 20)
    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: Number(payload?.total || 0),
      page: page > 0 ? page : 1,
      page_size: pageSize > 0 ? pageSize : 20,
    }
  }

  const loadRelationList = async (silent = true, pageOverride) => {
    if (!authToken || activeKey !== 'relation-list') return
    setRelationLoading(true)
    try {
      const targetPage = Number(pageOverride || relationPage || 1)
      const params = new URLSearchParams()
      params.set('page', String(targetPage))
      params.set('page_size', String(relationPageSize))
      if (relationFilter.relation_type) params.set('relation_type', relationFilter.relation_type)
      if (relationFilter.from_ci_uid.trim()) params.set('from_ci_uid', relationFilter.from_ci_uid.trim())
      if (relationFilter.to_ci_uid.trim()) params.set('to_ci_uid', relationFilter.to_ci_uid.trim())
      if (relationFilter.keyword.trim()) params.set('keyword', relationFilter.keyword.trim())

      const resp = await fetch(`/api/v1/relations?${params.toString()}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '关系列表加载失败')
      }
      const normalized = normalizeRelationResult(payload)
      setRelationResult(normalized)
      if (normalized.page !== relationPage) setRelationPage(normalized.page)
      setRelationLoadedAt(new Date().toLocaleString())
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      setRelationLoading(false)
    }
  }

  const normalizeTopologyResult = (payload) => ({
    nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
    edges: Array.isArray(payload?.edges) ? payload.edges : [],
    total_nodes: Number(payload?.total_nodes || 0),
    total_edges: Number(payload?.total_edges || 0),
  })

  const loadTopologyData = async (silent = true) => {
    if (!authToken || activeKey !== 'relation-topology') return
    setTopologyLoading(true)
    try {
      const params = new URLSearchParams()
      const limit = Math.max(50, Math.min(3000, Number(topologyFilter.limit || 300)))
      params.set('limit', String(limit))
      if (topologyFilter.keyword.trim()) params.set('keyword', topologyFilter.keyword.trim())
      if (topologyFilter.focus_ci_uid.trim()) params.set('focus_ci_uid', topologyFilter.focus_ci_uid.trim())

      const resp = await fetch(`/api/v1/relations/topology?${params.toString()}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '拓扑数据加载失败')
      }
      setTopologyData(normalizeTopologyResult(payload))
      setTopologyLoadedAt(new Date().toLocaleString())
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      setTopologyLoading(false)
    }
  }

  const queryRelationPath = async (event) => {
    if (event?.preventDefault) event.preventDefault()
    if (!pathForm.from_ci_uid.trim() || !pathForm.to_ci_uid.trim()) {
      showError('请输入起点和终点 CI UID')
      return
    }
    setPathLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('from_ci_uid', pathForm.from_ci_uid.trim())
      params.set('to_ci_uid', pathForm.to_ci_uid.trim())
      params.set('max_depth', String(Math.max(1, Math.min(12, Number(pathForm.max_depth || 6)))))

      const resp = await fetch(`/api/v1/relations/path?${params.toString()}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '依赖路径查询失败')
      }
      setPathResult(payload || null)
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setPathLoading(false)
    }
  }

  const normalizeChangeResult = (payload) => {
    const page = Number(payload?.page || 1)
    const pageSize = Number(payload?.page_size || 20)
    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: Number(payload?.total || 0),
      page: page > 0 ? page : 1,
      page_size: pageSize > 0 ? pageSize : 20,
    }
  }

  const loadChangeList = async (silent = true, pageOverride) => {
    if (!authToken || activeKey !== 'change') return
    setChangeLoading(true)
    try {
      const targetPage = Number(pageOverride || changePage || 1)
      const params = new URLSearchParams()
      params.set('page', String(targetPage))
      params.set('page_size', String(changePageSize))
      if (changeFilter.status) params.set('status', changeFilter.status)
      if (changeFilter.risk_level) params.set('risk_level', changeFilter.risk_level)
      if (changeFilter.keyword.trim()) params.set('keyword', changeFilter.keyword.trim())

      const resp = await fetch(`/api/v1/changes?${params.toString()}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '变更单列表加载失败')
      }
      const normalized = normalizeChangeResult(payload)
      setChangeResult(normalized)
      if (normalized.page !== changePage) setChangePage(normalized.page)
      setChangeLoadedAt(new Date().toLocaleString())
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      setChangeLoading(false)
    }
  }

  const loadChangeDetail = async (changeUID, silent = true) => {
    const uid = String(changeUID || '').trim()
    if (!uid || !authToken) return
    try {
      const resp = await fetch(`/api/v1/changes/${encodeURIComponent(uid)}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '变更单详情加载失败')
      }
      setChangeDetail(payload || null)
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    }
  }

  const normalizeDashboardData = (payload) => {
    const totals = payload?.totals || {}
    return {
      totals: {
        asset_total: Number(totals.asset_total || 0),
        monthly_new: Number(totals.monthly_new || 0),
        pending_count: Number(totals.pending_count || 0),
        anomaly_count: Number(totals.anomaly_count || 0),
      },
      type_distribution: Array.isArray(payload?.type_distribution) ? payload.type_distribution : [],
      growth_trend: Array.isArray(payload?.growth_trend) ? payload.growth_trend : [],
      owner_distribution: Array.isArray(payload?.owner_distribution) ? payload.owner_distribution : [],
      recent_changes: Array.isArray(payload?.recent_changes) ? payload.recent_changes : [],
    }
  }

  const loadDashboardOverview = async (silent = true) => {
    if (!authToken) return
    if (!silent) setDashboardLoading(true)
    try {
      const resp = await fetch('/api/v1/dashboard/overview', {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '仪表盘加载失败')
      }
      setDashboardData(normalizeDashboardData(payload))
      setDashboardLoadedAt(new Date().toLocaleString())
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      if (!silent) setDashboardLoading(false)
    }
  }

  const normalizeModelRows = (payload) => {
    const rawItems = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : [])
    return rawItems.map((item) => ({
      id: String(item?.model_uid || item?.id || createLocalId('model')),
      model_uid: String(item?.model_uid || item?.id || ''),
      name: String(item?.name || ''),
      ci_type_key: String(item?.ci_type_key || ''),
      ci_type_name: String(item?.ci_type_name || ''),
      icon: String(item?.icon || '◍'),
      description: String(item?.description || ''),
      instance_count: Number(item?.instance_count || 0),
      created_at: item?.created_at || '',
      updated_at: item?.updated_at || '',
    }))
  }

  const loadModelTemplates = async (silent = true) => {
    if (!authToken) return
    try {
      const resp = await fetch('/api/v1/models', { credentials: 'include' })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) throw new Error(payload?.error || raw || '模型数据加载失败')
      const rows = normalizeModelRows(payload)
      setModelTemplates(rows)
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    }
  }

  const normalizeModelFieldRuleRows = (payload) => {
    const rawItems = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : [])
    return rawItems.map((item) => ({
      id: String(item?.field_uid || item?.id || createLocalId('field')),
      field_uid: String(item?.field_uid || item?.id || ''),
      model_uid: String(item?.model_uid || ''),
      ci_type_key: String(item?.ci_type_key || ''),
      ci_type_name: String(item?.ci_type_name || ''),
      field_key: String(item?.field_key || ''),
      field_label: String(item?.field_label || ''),
      data_type: String(item?.data_type || 'string'),
      required: !!item?.required,
      has_default: !!item?.has_default || Object.prototype.hasOwnProperty.call(item || {}, 'default_value'),
      default_value: item?.default_value,
      created_at: item?.created_at || '',
      updated_at: item?.updated_at || '',
    }))
  }

  const loadModelFieldRules = async (modelUID, silent = true) => {
    const targetModelUID = String(modelUID || '').trim()
    if (!authToken || !targetModelUID) return
    if (!silent) setModelFieldLoading(true)
    try {
      const resp = await fetch(`/api/v1/models/${encodeURIComponent(targetModelUID)}/fields`, { credentials: 'include' })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) throw new Error(payload?.error || raw || '模型字段规则加载失败')
      setModelFieldRules(normalizeModelFieldRuleRows(payload))
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      if (!silent) setModelFieldLoading(false)
    }
  }

  const normalizeDiscoveryTaskRows = (payload) => {
    const rawItems = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : [])
    return rawItems.map((item) => ({
      id: String(item?.task_uid || item?.id || createLocalId('task')),
      task_uid: String(item?.task_uid || item?.id || ''),
      name: String(item?.name || ''),
      ci_type_key: String(item?.ci_type_key || ''),
      ci_type_name: String(item?.ci_type_name || ''),
      task_mode: String(item?.task_mode || 'scan'),
      source_type: String(item?.source_type || 'mock'),
      endpoint_url: String(item?.endpoint_url || ''),
      sync_mode: String(item?.sync_mode || 'upsert'),
      request_method: String(item?.request_method || 'GET'),
      owner: String(item?.owner || ''),
      schedule: String(item?.schedule_text || item?.schedule || ''),
      batch_size: Number(item?.batch_size || 1),
      enabled: !!item?.enabled,
      last_run_at: item?.last_run_at || '',
      last_status: String(item?.last_status || ''),
      created_at: item?.created_at || '',
      updated_at: item?.updated_at || '',
    }))
  }

  const normalizeDiscoveryLogRows = (payload) => {
    const rawItems = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : [])
    return rawItems.map((item) => ({
      id: String(item?.run_uid || item?.id || createLocalId('log')),
      run_uid: String(item?.run_uid || item?.id || ''),
      task_uid: String(item?.task_uid || ''),
      task_name: String(item?.task_name || ''),
      ci_type_key: String(item?.ci_type_key || ''),
      ci_type_name: String(item?.ci_type_name || ''),
      status: String(item?.status || ''),
      success_count: Number(item?.success_count || 0),
      created_count: Number(item?.created_count || 0),
      updated_count: Number(item?.updated_count || 0),
      failed_count: Number(item?.failed_count || 0),
      error_message: String(item?.error_message || ''),
      failures: item?.error_message ? [String(item.error_message)] : [],
      started_at: item?.started_at || '',
      finished_at: item?.finished_at || '',
      created_at: item?.created_at || '',
    }))
  }

  const loadDiscoveryTasks = async (silent = true) => {
    if (!authToken) return
    try {
      const resp = await fetch('/api/v1/discovery/tasks', { credentials: 'include' })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) throw new Error(payload?.error || raw || '发现任务加载失败')
      setDiscoveryTasks(normalizeDiscoveryTaskRows(payload))
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    }
  }

  const loadDiscoveryLogs = async (silent = true) => {
    if (!authToken) return
    try {
      const resp = await fetch('/api/v1/discovery/logs?limit=60', { credentials: 'include' })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) throw new Error(payload?.error || raw || '执行日志加载失败')
      setDiscoveryLogs(normalizeDiscoveryLogRows(payload))
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    }
  }

  const activeMeta = useMemo(() => {
    for (const top of visibleNavTree) {
      if (top.key === activeKey) {
        return {
          top,
          current: { key: top.key, label: top.label, desc: top.desc || '' },
          breadcrumb: `首页 / ${top.label}`,
        }
      }
      if (Array.isArray(top.children)) {
        const child = top.children.find((item) => item.key === activeKey)
        if (child) {
          return {
            top,
            current: { key: child.key, label: child.label, desc: child.desc || top.desc || '' },
            breadcrumb: `首页 / ${top.label} / ${child.label}`,
          }
        }
      }
    }
    const fallbackTop = visibleNavTree[0]
    if (!fallbackTop) {
      return {
        top: { key: 'dashboard', label: '首页', desc: '' },
        current: { key: 'dashboard', label: '首页', desc: '' },
        breadcrumb: '首页',
      }
    }
    return {
      top: fallbackTop,
      current: { key: fallbackTop.key, label: fallbackTop.label, desc: fallbackTop.desc || '' },
      breadcrumb: `首页 / ${fallbackTop.label}`,
    }
  }, [activeKey, visibleNavTree])

  const showMessage = (text) => {
    setMessage(text)
    setError('')
    setTimeout(() => setMessage(''), 2200)
  }

  const showError = (text) => {
    setError(text)
    setMessage('')
    setTimeout(() => setError(''), 2600)
  }

  const openConfirmDialog = ({ title = '确认操作', message = '', confirmLabel = '确认', onConfirm }) => {
    setConfirmDialog({
      open: true,
      title,
      message,
      confirmLabel,
      onConfirm: typeof onConfirm === 'function' ? onConfirm : null,
    })
  }

  const closeConfirmDialog = () => {
    setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }))
  }

  const onConfirmDialogAccept = async () => {
    const callback = confirmDialog.onConfirm
    closeConfirmDialog()
    if (!callback) return
    await callback()
  }

  const chooseFileFormat = (mode) =>
    new Promise((resolve) => {
      const actionLabel = mode === 'import' ? '导入' : '导出'
      setFormatDialog({
        open: true,
        title: `${actionLabel}格式选择`,
        mode,
        onPick: (value) => resolve(value || ''),
      })
    })

  const closeFormatDialog = (value = '') => {
    setFormatDialog((prev) => {
      const picker = prev.onPick
      if (typeof picker === 'function') picker(value)
      return {
        open: false,
        title: '',
        mode: prev.mode,
        onPick: null,
      }
    })
  }

  useEffect(() => {
    if (!authToken) {
      setDashboardData(emptyDashboard)
      setDashboardLoadedAt('')
      setAssetResult(emptyAssetResult)
      setAssetLoading(false)
      setAuditResult(emptyAuditResult)
      setAuditLoading(false)
      setAuditLoadedAt('')
      setRelationResult(emptyRelationResult)
      setRelationLoading(false)
      setRelationLoadedAt('')
      setTopologyData(emptyTopologyResult)
      setTopologyLoading(false)
      setTopologyLoadedAt('')
      setPathResult(null)
      setPathLoading(false)
      setChangeResult(emptyChangeResult)
      setChangeLoading(false)
      setChangeLoadedAt('')
      setChangeDetail(null)
      setReportResult(emptyReportResult)
      setReportLoadedAt('')
      setReportLoading(false)
      return
    }
    if (activeKey === 'dashboard' || activeKey === 'model' || activeKey === 'discovery' || activeKey === 'report') {
      loadDashboardOverview(true)
    }
  }, [authToken, activeKey])

  useEffect(() => {
    if (!activeKey.startsWith('asset-')) return
    const defaultType = assetTypeKeyMap[activeKey]
    if (!defaultType) return
    setCreateForm((prev) => (prev.ci_type_key === defaultType ? prev : { ...prev, ci_type_key: defaultType }))
    setAssetPage(1)
  }, [activeKey])

  useEffect(() => {
    if (!authToken || !activeKey.startsWith('asset-')) return
    loadAssetList(true)
  }, [authToken, activeKey, assetPage, assetPageSize, assetFilter.keyword, assetFilter.status, assetFilter.owner, currentAssetTypeKey])

  useEffect(() => {
    if (!authToken || activeKey !== 'audit') return
    loadAuditLogs(true)
  }, [
    authToken,
    activeKey,
    auditPage,
    auditPageSize,
    auditFilter.actor,
    auditFilter.action,
    auditFilter.result,
    auditFilter.source_ip,
    auditFilter.keyword,
    auditFilter.date_from,
    auditFilter.date_to,
  ])

  useEffect(() => {
    if (!authToken || activeKey !== 'report') return
    loadReport(true)
  }, [authToken, activeKey])

  useEffect(() => {
    if (!authToken || activeKey !== 'relation-list') return
    loadRelationList(true)
  }, [
    authToken,
    activeKey,
    relationPage,
    relationPageSize,
    relationFilter.relation_type,
    relationFilter.from_ci_uid,
    relationFilter.to_ci_uid,
    relationFilter.keyword,
  ])

  useEffect(() => {
    if (!authToken || activeKey !== 'relation-topology') return
    loadTopologyData(true)
  }, [authToken, activeKey, topologyFilter.keyword, topologyFilter.focus_ci_uid, topologyFilter.limit])

  useEffect(() => {
    if (!authToken || activeKey !== 'change') return
    loadChangeList(true)
  }, [
    authToken,
    activeKey,
    changePage,
    changePageSize,
    changeFilter.status,
    changeFilter.risk_level,
    changeFilter.keyword,
  ])

  useEffect(() => {
    if (!authToken || activeKey !== 'model') return
    loadModelTemplates(true)
  }, [authToken, activeKey])

  useEffect(() => {
    if (!authToken || activeKey !== 'discovery') return
    loadDiscoveryTasks(true)
    loadDiscoveryLogs(true)
  }, [authToken, activeKey])

  const request = async (method, path, body) => {
    const resp = await fetch(path, {
      method,
      headers: apiHeaders,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    const raw = await resp.text()
    let parsed = {}
    try {
      parsed = raw ? JSON.parse(raw) : {}
    } catch {
      parsed = { raw }
    }

    const wrapped = {
      请求方式: methodLabelMap[method] || method,
      状态码: resp.status,
      请求结果: resp.ok ? '成功' : '失败',
      接口标识: path,
      返回数据: parsed,
      请求时间: new Date().toLocaleString(),
    }
    setLastResponse(wrapped)
    if (!resp.ok) {
      throw new Error(parsed?.error || raw || `请求失败，状态码 ${resp.status}`)
    }
    return wrapped
  }

  const parseObject = (text, label) => {
    if (!text || !text.trim()) return undefined
    try {
      const obj = JSON.parse(text)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
      throw new Error(`${label} 必须是对象格式`)
    } catch {
      throw new Error(`${label} 解析失败，请检查格式是否正确`)
    }
  }

  const handleLookup = async (event) => {
    event.preventDefault()
    if (!lookupUID.trim()) {
      showError('请输入配置项唯一编号')
      return
    }
    setBusy(true)
    try {
      const res = await request('GET', `/api/v1/ci/${encodeURIComponent(lookupUID.trim())}`)
      setLookupResult(res.返回数据)
      showMessage('查询成功')
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const body = {
        ci_type_key: createForm.ci_type_key,
        name: createForm.name.trim(),
        unique_key: createForm.unique_key.trim(),
        status: createForm.status,
        owner: createForm.owner.trim(),
        source: createForm.source,
        source_ref: createForm.source_ref.trim(),
      }
      const extraAttrs = parseObject(createForm.extra_attrs_text, '扩展属性')
      if (extraAttrs) body.extra_attrs = extraAttrs

      const res = await request('POST', '/api/v1/ci', body)
      if (res.返回数据?.ci_uid) {
        setLookupUID(res.返回数据.ci_uid)
      }
      setAssetTab('query')
      setAssetPage(1)
      await loadAssetList(false, 1)
      showMessage('创建成功')
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const ciUID = updateForm.ci_uid.trim()
      if (!ciUID) throw new Error('配置项唯一编号不能为空')

      const body = { version: Number(updateForm.version) }
      if (updateForm.name.trim()) body.name = updateForm.name.trim()
      if (updateForm.status.trim()) body.status = updateForm.status.trim()
      if (updateForm.owner.trim()) body.owner = updateForm.owner.trim()
      if (updateForm.source_ref.trim()) body.source_ref = updateForm.source_ref.trim()
      if (updateForm.extra_attrs_text.trim()) {
        body.extra_attrs = parseObject(updateForm.extra_attrs_text, '扩展属性')
      }

      await request('PATCH', `/api/v1/ci/${encodeURIComponent(ciUID)}`, body)
      await loadAssetList(false)
      showMessage('更新成功')
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRelation = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const fromUID = relationForm.from_ci_uid.trim()
      if (!fromUID) throw new Error('源配置项唯一编号不能为空')

      const body = {
        to_ci_uid: relationForm.to_ci_uid.trim(),
        relation_type: relationForm.relation_type,
      }
      const attrs = parseObject(relationForm.attributes_text, '关系属性')
      if (attrs) body.attributes = attrs

      await request('POST', `/api/v1/ci/${encodeURIComponent(fromUID)}/relations`, body)
      showMessage('关系保存成功')
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const onSwitchSystem = () => {
    if (!authToken) {
      window.location.href = buildPortalEntryUrl('cmdb')
      return
    }
    window.location.href = buildPortalSwitchUrl('cmdb')
  }

  const onLogout = async () => {
    if (authToken) await logoutFromSso()
    setCurrentUser(null)
    setAuthToken('')
    setLogoutPending(true)
  }

  const toggleTopMenu = (top) => {
    if (!top.children) {
      setActiveKey(top.key)
      return
    }
    setExpandedMenus((prev) => ({ ...prev, [top.key]: !prev[top.key] }))
    const isInTop = top.children.some((item) => item.key === activeKey)
    if (!isInTop && top.children.length) {
      setActiveKey(top.children[0].key)
    }
  }

  const selectSubMenu = (parentKey, subKey) => {
    setExpandedMenus((prev) => ({ ...prev, [parentKey]: true }))
    setActiveKey(subKey)
  }

  const handleAssetEdit = (row) => {
    setUpdateForm({
      ci_uid: row.ci_uid || '',
      version: Number(row.version || 1),
      name: row.name || '',
      status: row.status || '',
      owner: row.owner || '',
      source_ref: row.source_ref || '',
      extra_attrs_text: '',
    })
    setAssetTab('update')
    showMessage(`已载入「${row.name || row.ci_uid}」，请在“资产更新”中保存`)
  }

  const handleAssetDelete = async (row) => {
    const ciUID = String(row.ci_uid || '').trim()
    if (!ciUID) return
    openConfirmDialog({
      title: '删除资产',
      message: `确认删除资产「${row.name || ciUID}」吗？`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        setBusy(true)
        try {
          await request('DELETE', `/api/v1/ci/${encodeURIComponent(ciUID)}`, {
            version: Number(row.version || 0),
          })
          await loadAssetList(false)
          showMessage('删除成功')
        } catch (err) {
          showError(normalizeApiError(err))
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const downloadBlob = (blob, fileName) => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
  }

  const buildExportRows = () => (
    (assetResult.items || []).map((item) => ({
      ci_uid: item.ci_uid || '',
      ci_type_key: item.ci_type_key || '',
      资产类型: formatOptionLabel(ciTypeOptions, item.ci_type_key),
      name: item.name || '',
      unique_key: item.unique_key || '',
      status: item.status || '',
      状态: formatStatusLabel(item.status),
      owner: item.owner || '',
      source: item.source || '',
      来源: formatOptionLabel(sourceOptions, item.source),
      source_ref: item.source_ref || '',
      version: Number(item.version || 0),
      created_at: item.created_at || '',
      updated_at: item.updated_at || '',
    }))
  )

  const exportAssetList = async (format) => {
    const targetFormat = format || (await chooseFileFormat('export'))
    if (!targetFormat) return

    const exportDate = new Date().toISOString().slice(0, 10)
    const fileBase = `cmdb-assets-${exportDate}`
    const rows = buildExportRows()
    const report = {
      导出时间: new Date().toLocaleString(),
      资产类型: currentAssetTypeKey || '全部',
      筛选条件: {
        keyword: assetFilter.keyword || '',
        status: assetFilter.status || '',
        owner: assetFilter.owner || '',
      },
      分页: {
        page: assetResult.page,
        page_size: assetResult.page_size,
        total: assetResult.total,
      },
      items: rows,
    }

    if (targetFormat === 'json') {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
      downloadBlob(blob, `${fileBase}.json`)
      return
    }

    const sheet = XLSX.utils.json_to_sheet(rows)
    if (targetFormat === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(sheet)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, `${fileBase}.csv`)
      return
    }

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, '资产列表')
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    downloadBlob(blob, `${fileBase}.xlsx`)
  }

  const exportAuditListCSV = async () => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '10000')
      if (auditFilter.actor.trim()) params.set('actor', auditFilter.actor.trim())
      if (auditFilter.action.trim()) params.set('action', auditFilter.action.trim())
      if (auditFilter.result) params.set('result', auditFilter.result)
      if (auditFilter.source_ip.trim()) params.set('source_ip', auditFilter.source_ip.trim())
      if (auditFilter.keyword.trim()) params.set('keyword', auditFilter.keyword.trim())
      if (auditFilter.date_from) params.set('date_from', auditFilter.date_from)
      if (auditFilter.date_to) params.set('date_to', auditFilter.date_to)

      const resp = await fetch(`/api/v1/audit/logs/export.csv?${params.toString()}`, {
        credentials: 'include',
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(text || '导出失败')
      }
      const blob = await resp.blob()
      const fileDate = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `cmdb-audit-${fileDate}.csv`)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const resolveImportFileFormat = (fileName) => {
    const lower = String(fileName || '').toLowerCase()
    if (lower.endsWith('.json')) return 'json'
    if (lower.endsWith('.csv')) return 'csv'
    if (lower.endsWith('.xlsx')) return 'xlsx'
    return ''
  }

  const pickFieldValue = (record, keys) => {
    for (const key of keys) {
      if (record && Object.prototype.hasOwnProperty.call(record, key)) {
        return record[key]
      }
    }
    return ''
  }

  const parseExtraAttrs = (raw) => {
    if (!raw) return undefined
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw
    if (typeof raw !== 'string') return undefined
    const text = raw.trim()
    if (!text) return undefined
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      return undefined
    } catch {
      return undefined
    }
  }

  const normalizeImportedRecord = (record) => {
    const typeRaw = String(pickFieldValue(record, ['ci_type_key', '资产类型key', '资产类型', '类型']) || '').trim()
    const statusRaw = String(pickFieldValue(record, ['status', '状态']) || '').trim()
    const sourceRaw = String(pickFieldValue(record, ['source', '来源']) || '').trim()
    const mappedType = ciTypeLabelToKeyMap[typeRaw] || typeRaw
    const mappedStatus = statusLabelToKeyMap[statusRaw] || statusRaw
    const mappedSource = sourceLabelToKeyMap[sourceRaw] || sourceRaw

    const body = {
      ci_type_key: mappedType || currentAssetTypeKey || 'application',
      name: String(pickFieldValue(record, ['name', '名称']) || '').trim(),
      unique_key: String(pickFieldValue(record, ['unique_key', '唯一标识', '唯一键']) || '').trim(),
      status: mappedStatus || 'active',
      owner: String(pickFieldValue(record, ['owner', '归属人', '负责人']) || '').trim(),
      source: mappedSource || 'import',
      source_ref: String(pickFieldValue(record, ['source_ref', '来源引用']) || '').trim(),
    }

    const extraAttrsRaw = pickFieldValue(record, ['extra_attrs', '扩展属性'])
    const extraAttrs = parseExtraAttrs(extraAttrsRaw)
    if (extraAttrs) body.extra_attrs = extraAttrs
    return body
  }

  const parseImportRecords = async (file) => {
    const fileFormat = resolveImportFileFormat(file.name)
    if (!fileFormat) throw new Error('仅支持 json / csv / xlsx 文件')

    if (fileFormat === 'json') {
      const content = await file.text()
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed?.items)) return parsed.items
      throw new Error('JSON 文件格式错误，应为数组或包含 items 字段')
    }

    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) throw new Error('导入文件为空')
    const sheet = workbook.Sheets[sheetName]
    return XLSX.utils.sheet_to_json(sheet, { defval: '' })
  }

  const importAssets = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    input.onchange = async (event) => {
      const file = event.target?.files?.[0]
      if (!file) return

      setBusy(true)
      try {
        const records = await parseImportRecords(file)
        if (!records.length) throw new Error('导入文件为空或格式错误')

        let success = 0
        let failed = 0
        for (const record of records) {
          const body = normalizeImportedRecord(record)
          if (!body.name || !body.unique_key) {
            failed += 1
            continue
          }
          try {
            await request('POST', '/api/v1/ci', body)
            success += 1
          } catch {
            failed += 1
          }
        }

        await loadAssetList(false, 1)
        showMessage(`导入完成：成功 ${success} 条，失败 ${failed} 条`)
      } catch (err) {
        showError(normalizeApiError(err))
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }

  const loadAllAssets = async () => {
    const pageSize = 200
    const all = []
    let page = 1
    let total = Number.POSITIVE_INFINITY
    while (all.length < total && page <= 50) {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('page_size', String(pageSize))
      const resp = await fetch(`/api/v1/ci?${params.toString()}`, {
        credentials: 'include',
      })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) {
        throw new Error(payload?.error || raw || '加载资产数据失败')
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      total = Number(payload?.total || items.length)
      all.push(...items)
      if (!items.length) break
      if (all.length >= total) break
      page += 1
    }
    return all
  }

  const buildReportResultFromAssets = (assets) => {
    const typeMap = new Map()
    const statusMap = new Map()
    const sourceMap = new Map()
    const ownerMap = new Map()
    const trendMap = new Map()
    const now = new Date()
    const days = []
    for (let i = 6; i >= 0; i -= 1) {
      const dateKey = formatDateKey(now.getTime() - i * 24 * 60 * 60 * 1000)
      if (dateKey) {
        days.push(dateKey)
        trendMap.set(dateKey, 0)
      }
    }

    let activeTotal = 0
    let discoveryTotal = 0
    const ownerSet = new Set()

    for (const item of assets) {
      const ciTypeKey = String(item?.ci_type_key || '').trim() || 'unknown'
      const status = String(item?.status || '').trim() || 'unknown'
      const source = String(item?.source || '').trim() || 'unknown'
      const owner = String(item?.owner || '').trim() || '未分配'
      const dateKey = formatDateKey(item?.created_at || item?.updated_at)

      typeMap.set(ciTypeKey, Number(typeMap.get(ciTypeKey) || 0) + 1)
      statusMap.set(status, Number(statusMap.get(status) || 0) + 1)
      sourceMap.set(source, Number(sourceMap.get(source) || 0) + 1)
      ownerMap.set(owner, Number(ownerMap.get(owner) || 0) + 1)
      ownerSet.add(owner)

      if (status === 'active') activeTotal += 1
      if (source === 'discovery') discoveryTotal += 1
      if (dateKey && trendMap.has(dateKey)) {
        trendMap.set(dateKey, Number(trendMap.get(dateKey) || 0) + 1)
      }
    }

    const toSortedRows = (map, labelResolver) => (
      Array.from(map.entries())
        .map(([key, total]) => ({
          key,
          name: labelResolver(key),
          total: Number(total || 0),
        }))
        .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
    )

    return {
      totals: {
        asset_total: assets.length,
        active_total: activeTotal,
        discovery_total: discoveryTotal,
        owner_total: ownerSet.size,
      },
      type_distribution: toSortedRows(typeMap, (key) => formatOptionLabel(ciTypeOptions, key)),
      status_distribution: toSortedRows(statusMap, (key) => formatStatusLabel(key)),
      source_distribution: toSortedRows(sourceMap, (key) => formatOptionLabel(sourceOptions, key)),
      owner_distribution: toSortedRows(ownerMap, (key) => key).slice(0, 10),
      trend_7d: days.map((date) => ({
        date,
        total: Number(trendMap.get(date) || 0),
      })),
    }
  }

  const loadReport = async (silent = true) => {
    if (!authToken) return
    if (!silent) setReportLoading(true)
    try {
      const resp = await fetch('/api/v1/reports/analysis?days=30', { credentials: 'include' })
      const raw = await resp.text()
      let payload = {}
      try {
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        payload = {}
      }
      if (!resp.ok) throw new Error(payload?.error || raw || '报表分析加载失败')
      setReportResult({
        days: Number(payload?.days || 30),
        totals: {
          asset_total: Number(payload?.totals?.asset_total || 0),
          active_total: Number(payload?.totals?.active_total || 0),
          discovery_total: Number(payload?.totals?.discovery_total || 0),
          cloud_total: Number(payload?.totals?.cloud_total || 0),
          relation_total: Number(payload?.totals?.relation_total || 0),
          change_total: Number(payload?.totals?.change_total || 0),
          complexity_index: Number(payload?.totals?.complexity_index || 0),
        },
        change_frequency_trend: Array.isArray(payload?.change_frequency_trend) ? payload.change_frequency_trend : [],
        relation_complexity_trend: Array.isArray(payload?.relation_complexity_trend) ? payload.relation_complexity_trend : [],
      })
      setReportLoadedAt(new Date().toLocaleString())
    } catch (err) {
      if (!silent) showError(normalizeApiError(err))
    } finally {
      if (!silent) setReportLoading(false)
    }
  }

  const exportReportAnalysis = async (format) => {
    const targetFormat = format || (await chooseFileFormat('export'))
    if (!targetFormat) return

    const fileBase = `cmdb-report-${new Date().toISOString().slice(0, 10)}`
    const payload = {
      导出时间: new Date().toLocaleString(),
      报表更新时间: reportLoadedAt || '-',
      统计窗口天数: Number(reportResult.days || 30),
      数据概览: reportResult.totals,
      变更频次趋势: reportResult.change_frequency_trend,
      关系复杂度趋势: reportResult.relation_complexity_trend,
    }

    if (targetFormat === 'json') {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
      downloadBlob(blob, `${fileBase}.json`)
      return
    }

    const rows = []
    rows.push({ 维度: '资产概览', 指标: '资产总数', 数值: Number(reportResult.totals.asset_total || 0) })
    rows.push({ 维度: '资产概览', 指标: '正常资产', 数值: Number(reportResult.totals.active_total || 0) })
    rows.push({ 维度: '资产概览', 指标: '自动发现资产', 数值: Number(reportResult.totals.discovery_total || 0) })
    rows.push({ 维度: '资产概览', 指标: '云同步资产', 数值: Number(reportResult.totals.cloud_total || 0) })
    rows.push({ 维度: '资产概览', 指标: '关系总量', 数值: Number(reportResult.totals.relation_total || 0) })
    rows.push({ 维度: '资产概览', 指标: '变更总量(窗口内)', 数值: Number(reportResult.totals.change_total || 0) })
    rows.push({ 维度: '资产概览', 指标: '当前关系复杂度', 数值: Number(reportResult.totals.complexity_index || 0) })

    for (const item of reportResult.change_frequency_trend || []) {
      rows.push({ 维度: '变更频次趋势', 指标: item.date, 数值: Number(item.total || 0) })
    }
    for (const item of reportResult.relation_complexity_trend || []) {
      rows.push({ 维度: '关系复杂度趋势', 指标: item.date, 数值: Number(item.complexity_index || 0) })
    }

    const sheet = XLSX.utils.json_to_sheet(rows)
    if (targetFormat === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(sheet)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, `${fileBase}.csv`)
      return
    }

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, '报表分析')
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    downloadBlob(blob, `${fileBase}.xlsx`)
  }

  const buildRelationExportRows = () => (
    (relationResult.items || []).map((item) => ({
      from_ci_uid: item.from_ci_uid || '',
      from_ci_name: item.from_ci_name || '',
      from_ci_type_key: item.from_ci_type_key || '',
      from_status: item.from_status || '',
      relation_type: item.relation_type || '',
      to_ci_uid: item.to_ci_uid || '',
      to_ci_name: item.to_ci_name || '',
      to_ci_type_key: item.to_ci_type_key || '',
      to_status: item.to_status || '',
      version: Number(item.version || 0),
      updated_at: item.updated_at || '',
    }))
  )

  const exportRelationList = async (format) => {
    const targetFormat = format || (await chooseFileFormat('export'))
    if (!targetFormat) return

    const fileBase = `cmdb-relations-${new Date().toISOString().slice(0, 10)}`
    const rows = buildRelationExportRows()
    const report = {
      导出时间: new Date().toLocaleString(),
      筛选条件: relationFilter,
      分页: {
        page: relationResult.page,
        page_size: relationResult.page_size,
        total: relationResult.total,
      },
      items: rows,
    }

    if (targetFormat === 'json') {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
      downloadBlob(blob, `${fileBase}.json`)
      return
    }

    const sheet = XLSX.utils.json_to_sheet(rows)
    if (targetFormat === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(sheet)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, `${fileBase}.csv`)
      return
    }

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, '关系数据')
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    downloadBlob(blob, `${fileBase}.xlsx`)
  }

  const openModelFieldDialog = async (model) => {
    const modelUID = String(model?.model_uid || model?.id || '').trim()
    if (!modelUID) return
    setCurrentModelForFields(model)
    setModelFieldForm(emptyModelFieldForm)
    setModelFieldRules([])
    setModelFieldDialogOpen(true)
    await loadModelFieldRules(modelUID, false)
  }

  const closeModelFieldDialog = () => {
    setModelFieldDialogOpen(false)
    setCurrentModelForFields(null)
    setModelFieldRules([])
    setModelFieldForm(emptyModelFieldForm)
    setModelFieldLoading(false)
  }

  const createModelFieldRule = async (event) => {
    event.preventDefault()
    const modelUID = String(currentModelForFields?.model_uid || currentModelForFields?.id || '').trim()
    if (!modelUID) return

    const fieldKey = String(modelFieldForm.field_key || '').trim()
    const fieldLabel = String(modelFieldForm.field_label || '').trim()
    const dataType = String(modelFieldForm.data_type || '').trim()
    if (!fieldKey || !fieldLabel || !dataType) {
      showError('请完整填写字段编码、字段名称和类型')
      return
    }

    const payload = {
      field_key: fieldKey,
      field_label: fieldLabel,
      data_type: dataType,
      required: !!modelFieldForm.required,
    }
    const defaultText = String(modelFieldForm.default_value_text || '').trim()
    if (defaultText) {
      try {
        payload.default_value = JSON.parse(defaultText)
      } catch {
        showError('默认值必须是合法 JSON')
        return
      }
    }

    try {
      await request('POST', `/api/v1/models/${encodeURIComponent(modelUID)}/fields`, payload)
      setModelFieldForm(emptyModelFieldForm)
      await loadModelFieldRules(modelUID, true)
      showMessage('字段规则创建成功')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const deleteModelFieldRule = (field) => {
    const fieldUID = String(field?.field_uid || field?.id || '').trim()
    if (!fieldUID) return
    const modelUID = String(currentModelForFields?.model_uid || currentModelForFields?.id || '').trim()
    openConfirmDialog({
      title: '删除字段规则',
      message: `确认删除字段「${field?.field_label || field?.field_key || '-'}」吗？`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        try {
          await request('DELETE', `/api/v1/models/fields/${encodeURIComponent(fieldUID)}`)
          if (modelUID) {
            await loadModelFieldRules(modelUID, true)
          }
          showMessage('字段规则已删除')
        } catch (err) {
          showError(normalizeApiError(err))
        }
      },
    })
  }

  const openModelCreateDialog = () => {
    setModelForm(emptyModelForm)
    setModelDialogOpen(true)
  }

  const closeModelCreateDialog = () => {
    setModelDialogOpen(false)
    setModelForm(emptyModelForm)
  }

  const createModelTemplate = async (event) => {
    event.preventDefault()
    const name = String(modelForm.name || '').trim()
    const ciType = String(modelForm.ci_type_key || '').trim()
    if (!name) {
      showError('请输入模型名称')
      return
    }
    if (!ciType) {
      showError('请选择模型类型')
      return
    }
    try {
      await request('POST', '/api/v1/models', {
        name,
        ci_type_key: ciType,
        icon: String(modelForm.icon || '').trim() || '◍',
        description: String(modelForm.description || '').trim(),
      })
      closeModelCreateDialog()
      await loadModelTemplates(true)
      await loadDashboardOverview(true)
      showMessage('模型创建成功')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const deleteModelTemplate = (item) => {
    const modelUID = String(item?.model_uid || item?.id || '').trim()
    if (!modelUID) return
    openConfirmDialog({
      title: '删除模型',
      message: `确认删除模型「${item?.name || '-'}」吗？`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        try {
          await request('DELETE', `/api/v1/models/${encodeURIComponent(modelUID)}`)
          await loadModelTemplates(true)
          showMessage('模型已删除')
        } catch (err) {
          showError(normalizeApiError(err))
        }
      },
    })
  }

  const openDiscoveryTaskDialog = () => {
    setDiscoveryTaskForm(emptyDiscoveryTaskForm)
    setDiscoveryDialogOpen(true)
  }

  const closeDiscoveryTaskDialog = () => {
    setDiscoveryDialogOpen(false)
    setDiscoveryTaskForm(emptyDiscoveryTaskForm)
  }

  const createDiscoveryTask = async (event) => {
    event.preventDefault()
    const name = String(discoveryTaskForm.name || '').trim()
    if (!name) {
      showError('请输入任务名称')
      return
    }
    try {
      await request('POST', '/api/v1/discovery/tasks', {
        name,
        ci_type_key: discoveryTaskForm.ci_type_key || 'host',
        task_mode: discoveryTaskForm.task_mode || 'scan',
        source_type: discoveryTaskForm.source_type || 'mock',
        endpoint_url: String(discoveryTaskForm.endpoint_url || '').trim(),
        sync_mode: discoveryTaskForm.sync_mode || 'upsert',
        request_method: discoveryTaskForm.request_method || 'GET',
        owner: String(discoveryTaskForm.owner || '').trim() || 'CMDB平台',
        schedule_text: String(discoveryTaskForm.schedule || '').trim() || '每天 02:00',
        batch_size: Math.max(1, Math.min(50, Number(discoveryTaskForm.batch_size || 1))),
      })
      closeDiscoveryTaskDialog()
      await loadDiscoveryTasks(true)
      showMessage('发现任务创建成功')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const toggleDiscoveryTask = async (task, enabled) => {
    const taskUID = String(task?.task_uid || task?.id || '').trim()
    if (!taskUID) return
    try {
      await request('PATCH', `/api/v1/discovery/tasks/${encodeURIComponent(taskUID)}`, { enabled: !!enabled })
      await loadDiscoveryTasks(true)
      showMessage(enabled ? '任务已启用' : '任务已停用')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const removeDiscoveryTask = (task) => {
    const taskUID = String(task?.task_uid || task?.id || '').trim()
    if (!taskUID) return
    openConfirmDialog({
      title: '删除发现任务',
      message: `确认删除任务「${task?.name || '-'}」吗？`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        try {
          await request('DELETE', `/api/v1/discovery/tasks/${encodeURIComponent(taskUID)}`)
          await loadDiscoveryTasks(true)
          showMessage('任务已删除')
        } catch (err) {
          showError(normalizeApiError(err))
        }
      },
    })
  }

  const runDiscoveryTask = async (task) => {
    if (!task) return
    if (discoveryRunning) return
    const taskUID = String(task?.task_uid || task?.id || '').trim()
    if (!taskUID) return
    setDiscoveryRunning(true)
    try {
      const result = await request('POST', `/api/v1/discovery/tasks/${encodeURIComponent(taskUID)}/run`)
      const payload = result?.返回数据 || {}
      const success = Number(payload.success_count || 0)
      const created = Number(payload.created_count || 0)
      const updated = Number(payload.updated_count || 0)
      const failed = Number(payload.failed_count || 0)
      await loadDiscoveryTasks(true)
      await loadDiscoveryLogs(true)
      await loadDashboardOverview(true)
      if (activeKey === 'report') await loadReport(true)
      showMessage(`任务「${task.name}」执行完成：成功 ${success}（新增 ${created} / 更新 ${updated}），失败 ${failed}`)
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setDiscoveryRunning(false)
    }
  }

  const runAllEnabledDiscoveryTasks = async () => {
    if (discoveryRunning) return
    setDiscoveryRunning(true)
    try {
      const result = await request('POST', '/api/v1/discovery/run-enabled')
      const payload = result?.返回数据 || {}
      const success = Number(payload.success_count || 0)
      const created = Number(payload.created_count || 0)
      const updated = Number(payload.updated_count || 0)
      const failed = Number(payload.failed_count || 0)
      await loadDashboardOverview(true)
      await loadDiscoveryTasks(true)
      await loadDiscoveryLogs(true)
      if (activeKey === 'report') await loadReport(true)
      showMessage(`批量执行完成：成功 ${success}（新增 ${created} / 更新 ${updated}），失败 ${failed}`)
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setDiscoveryRunning(false)
    }
  }

  const openChangeCreateDialog = () => {
    setChangeForm(emptyChangeForm)
    setChangeDialogOpen(true)
  }

  const closeChangeCreateDialog = () => {
    setChangeDialogOpen(false)
    setChangeForm(emptyChangeForm)
  }

  const createChangeRequest = async (event) => {
    event.preventDefault()
    const title = String(changeForm.title || '').trim()
    const targetCIUID = String(changeForm.target_ci_uid || '').trim()
    if (!title || !targetCIUID) {
      showError('请填写变更标题和目标CIUID')
      return
    }

    try {
      await request('POST', '/api/v1/changes', {
        title,
        target_ci_uid: targetCIUID,
        risk_level: changeForm.risk_level || 'medium',
        planned_start_at: String(changeForm.planned_start_at || '').trim(),
        planned_end_at: String(changeForm.planned_end_at || '').trim(),
        description: String(changeForm.description || '').trim(),
      })
      closeChangeCreateDialog()
      setChangePage(1)
      await loadChangeList(false, 1)
      showMessage('变更单创建成功')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const runChangeAction = (row, action) => {
    const uid = String(row?.change_uid || '').trim()
    if (!uid) return

    const actionMeta = {
      approve: { title: '审批通过', label: '审批通过', endpoint: 'approve' },
      reject: { title: '驳回变更', label: '确认驳回', endpoint: 'reject' },
      execute: { title: '执行变更', label: '确认执行', endpoint: 'execute' },
      rollback: { title: '回滚变更', label: '确认回滚', endpoint: 'rollback' },
    }[action]
    if (!actionMeta) return

    openConfirmDialog({
      title: actionMeta.title,
      message: `确认对变更单「${row.title || uid}」执行${actionMeta.title}吗？`,
      confirmLabel: actionMeta.label,
      onConfirm: async () => {
        try {
          await request('POST', `/api/v1/changes/${encodeURIComponent(uid)}/${actionMeta.endpoint}`, {})
          await loadChangeList(false)
          await loadChangeDetail(uid, true)
          showMessage(`${actionMeta.title}成功`)
        } catch (err) {
          showError(normalizeApiError(err))
        }
      },
    })
  }

  const canRunChangeAction = (row, action) => {
    const status = String(row?.status || '')
    if (action === 'approve' || action === 'reject') return status === 'pending_approval'
    if (action === 'execute') return status === 'approved'
    if (action === 'rollback') return status === 'completed'
    return false
  }

  const renderAssetOperationPanel = () => (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>资产维护操作</h2>
          <p>支持接口级查询、新增和更新。</p>
        </div>
      </div>
      <div className="tabs">
        {assetTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={assetTab === tab.key ? 'tab active' : 'tab'}
            onClick={() => setAssetTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {assetTab === 'query' && (
        <form className="form-grid" onSubmit={handleLookup}>
          <label className="full-row">
            配置项唯一编号
            <input value={lookupUID} onChange={(e) => setLookupUID(e.target.value)} placeholder="01JKB2CAVN8F77JQ67HKE7VZN9" />
          </label>
          <div className="form-actions">
            <button disabled={busy} type="submit" className="btn btn-primary">查询资产</button>
          </div>
          {lookupResult ? (
            <div className="result-fields full-row">
              <div><strong>配置项唯一编号：</strong>{lookupResult.ci_uid || '-'}</div>
              <div><strong>资产类型：</strong>{formatOptionLabel(ciTypeOptions, lookupResult.ci_type_key)}</div>
              <div><strong>资产名称：</strong>{lookupResult.name || '-'}</div>
              <div><strong>唯一标识：</strong>{lookupResult.unique_key || '-'}</div>
              <div><strong>状态：</strong>{formatOptionLabel(statusOptions, lookupResult.status)}</div>
              <div><strong>归属人：</strong>{lookupResult.owner || '-'}</div>
            </div>
          ) : <div className="muted full-row">暂无查询结果</div>}
        </form>
      )}

      {assetTab === 'create' && (
        <form className="form-grid" onSubmit={handleCreate}>
          <label>
            资产类型
            <select value={createForm.ci_type_key} onChange={(e) => setCreateForm({ ...createForm, ci_type_key: e.target.value })}>
              {ciTypeOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>资产名称<input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></label>
          <label>唯一标识<input value={createForm.unique_key} onChange={(e) => setCreateForm({ ...createForm, unique_key: e.target.value })} /></label>
          <label>
            状态
            <select value={createForm.status} onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}>
              {statusOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            来源
            <select value={createForm.source} onChange={(e) => setCreateForm({ ...createForm, source: e.target.value })}>
              {sourceOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>归属人<input value={createForm.owner} onChange={(e) => setCreateForm({ ...createForm, owner: e.target.value })} /></label>
          <label className="full-row">来源引用<input value={createForm.source_ref} onChange={(e) => setCreateForm({ ...createForm, source_ref: e.target.value })} /></label>
          <label className="full-row">
            <span className="label-with-help">
              扩展属性（对象格式）
              <span className="help-tip" tabIndex={0} role="button" aria-label="查看扩展属性说明">
                <span className="help-icon">i</span>
                <span className="help-popup">{extraAttrsHelpText}</span>
              </span>
            </span>
            <textarea rows="6" value={createForm.extra_attrs_text} onChange={(e) => setCreateForm({ ...createForm, extra_attrs_text: e.target.value })} />
          </label>
          <div className="form-actions"><button disabled={busy} type="submit" className="btn btn-primary">创建资产</button></div>
        </form>
      )}

      {assetTab === 'update' && (
        <form className="form-grid" onSubmit={handleUpdate}>
          <label className="full-row">配置项唯一编号<input value={updateForm.ci_uid} onChange={(e) => setUpdateForm({ ...updateForm, ci_uid: e.target.value })} /></label>
          <label>版本号<input type="number" min="1" value={updateForm.version} onChange={(e) => setUpdateForm({ ...updateForm, version: e.target.value })} /></label>
          <label>资产名称<input value={updateForm.name} onChange={(e) => setUpdateForm({ ...updateForm, name: e.target.value })} /></label>
          <label>
            状态
            <select value={updateForm.status} onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}>
              <option value="">(不修改)</option>
              {statusOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>归属人<input value={updateForm.owner} onChange={(e) => setUpdateForm({ ...updateForm, owner: e.target.value })} /></label>
          <label className="full-row">来源引用<input value={updateForm.source_ref} onChange={(e) => setUpdateForm({ ...updateForm, source_ref: e.target.value })} /></label>
          <label className="full-row">
            <span className="label-with-help">
              扩展属性（对象格式，留空不更新）
              <span className="help-tip" tabIndex={0} role="button" aria-label="查看扩展属性说明">
                <span className="help-icon">i</span>
                <span className="help-popup">{extraAttrsHelpText}</span>
              </span>
            </span>
            <textarea rows="6" value={updateForm.extra_attrs_text} onChange={(e) => setUpdateForm({ ...updateForm, extra_attrs_text: e.target.value })} />
          </label>
          <div className="form-actions"><button disabled={busy} type="submit" className="btn btn-primary">保存更新</button></div>
        </form>
      )}
    </section>
  )

  const renderAssetPage = () => {
    const rows = assetResult.items || []
    const total = Number(assetResult.total || 0)
    const totalPages = Math.max(1, Math.ceil(total / assetPageSize))
    const ownerOptions = Array.from(new Set(rows.map((item) => String(item.owner || '').trim()).filter(Boolean)))

    return (
      <>
        <section className="panel compact">
          <div className="toolbar-row">
            <div className="toolbar-left">
              <strong>筛选：</strong>
              <input
                value={assetFilter.keyword}
                onChange={(e) => {
                  setAssetFilter({ ...assetFilter, keyword: e.target.value })
                  setAssetPage(1)
                }}
                placeholder="名称 / 唯一标识 / CI编号"
              />
              <select
                value={assetFilter.status}
                onChange={(e) => {
                  setAssetFilter({ ...assetFilter, status: e.target.value })
                  setAssetPage(1)
                }}
              >
                <option value="">全部状态</option>
                {statusOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select
                value={assetFilter.owner}
                onChange={(e) => {
                  setAssetFilter({ ...assetFilter, owner: e.target.value })
                  setAssetPage(1)
                }}
              >
                <option value="">全部归属人</option>
                {ownerOptions.map((owner) => (
                  <option key={owner} value={owner}>{owner}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  setAssetFilter({ keyword: '', status: '', owner: '' })
                  setAssetPage(1)
                }}
              >
                重置
              </button>
            </div>
          </div>
        </section>

        <section className="panel compact">
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>唯一标识</th>
                  <th>状态</th>
                  <th>归属人</th>
                  <th>来源</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">{assetLoading ? '资产加载中...' : '暂无资产数据'}</td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.ci_uid}>
                    <td>{row.name}</td>
                    <td>{row.unique_key}</td>
                    <td><span className={statusClassName(row.status)}>{formatStatusLabel(row.status)}</span></td>
                    <td>{row.owner || '-'}</td>
                    <td>{formatOptionLabel(sourceOptions, row.source)}</td>
                    <td>{formatRelativeTime(row.updated_at)}</td>
                    <td>
                      <button type="button" className="link-btn" onClick={() => handleAssetEdit(row)}>编辑</button>
                      {' / '}
                      <button type="button" className="link-btn" onClick={() => handleAssetDelete(row)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer table-footer-actions">
            <span>共 {total} 条，当前第 {assetPage} / {totalPages} 页</span>
            <div className="pager">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={assetLoading || assetPage <= 1}
                onClick={() => setAssetPage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={assetLoading || assetPage >= totalPages}
                onClick={() => setAssetPage((prev) => Math.min(totalPages, prev + 1))}
              >
                下一页
              </button>
              <select
                value={assetPageSize}
                onChange={(e) => {
                  const nextSize = Number(e.target.value) || 10
                  setAssetPageSize(nextSize)
                  setAssetPage(1)
                }}
              >
                <option value={10}>10 条/页</option>
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
              </select>
            </div>
          </div>
        </section>

        {renderAssetOperationPanel()}
      </>
    )
  }

  const renderDashboard = () => {
    const totals = dashboardData.totals || emptyDashboard.totals
    const typeDistribution = dashboardData.type_distribution || []
    const growthTrend = dashboardData.growth_trend || []
    const ownerDistribution = dashboardData.owner_distribution || []
    const recentChanges = dashboardData.recent_changes || []

    const maxType = Math.max(1, ...typeDistribution.map((item) => Number(item.total || 0)))
    const maxGrowth = Math.max(1, ...growthTrend.map((item) => Number(item.total || 0)))
    const maxOwner = Math.max(1, ...ownerDistribution.map((item) => Number(item.total || 0)))

    return (
      <>
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-title">资产总数</div>
            <div className="stat-main">{totals.asset_total.toLocaleString()}</div>
            <div className="stat-sub">当前有效配置项</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">本月新增</div>
            <div className="stat-main green">{totals.monthly_new.toLocaleString()}</div>
            <div className="stat-sub">本月新增配置项</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">待处理事件</div>
            <div className="stat-main orange">{totals.pending_count.toLocaleString()}</div>
            <div className="stat-sub">待发布或重试队列</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">异常资产</div>
            <div className="stat-main red">{totals.anomaly_count.toLocaleString()}</div>
            <div className="stat-sub">非启用状态配置项</div>
          </div>
        </section>

        <section className="panel-grid-2">
          <section className="panel chart-panel">
            <div className="panel-header">
              <h2>资产类型分布</h2>
              <span className="panel-tip">{dashboardLoading ? '加载中...' : `更新于 ${dashboardLoadedAt || '-'}`}</span>
            </div>
            {typeDistribution.length === 0 ? (
              <div className="placeholder">暂无类型统计数据</div>
            ) : (
              <div className="metric-bars">
                {typeDistribution.map((item) => (
                  <div className="metric-row" key={item.key || item.name}>
                    <div className="metric-label">{item.name}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.max(8, Math.round((Number(item.total || 0) / maxType) * 100))}%` }}
                      />
                    </div>
                    <div className="metric-value">{Number(item.total || 0).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel chart-panel">
            <div className="panel-header"><h2>资产增长趋势（近7天）</h2></div>
            {growthTrend.length === 0 ? (
              <div className="placeholder">暂无趋势数据</div>
            ) : (
              <div className="metric-bars">
                {growthTrend.map((item) => (
                  <div className="metric-row" key={item.date}>
                    <div className="metric-label">{item.date.slice(5)}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill soft"
                        style={{ width: `${Math.max(8, Math.round((Number(item.total || 0) / maxGrowth) * 100))}%` }}
                      />
                    </div>
                    <div className="metric-value">{Number(item.total || 0).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="panel-grid-2">
          <section className="panel chart-panel">
            <div className="panel-header"><h2>归属人资产统计</h2></div>
            {ownerDistribution.length === 0 ? (
              <div className="placeholder">暂无归属人统计数据</div>
            ) : (
              <div className="metric-bars">
                {ownerDistribution.map((item) => (
                  <div className="metric-row" key={item.name}>
                    <div className="metric-label">{item.name}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill green"
                        style={{ width: `${Math.max(8, Math.round((Number(item.total || 0) / maxOwner) * 100))}%` }}
                      />
                    </div>
                    <div className="metric-value">{Number(item.total || 0).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header"><h2>最近变更记录</h2></div>
            {recentChanges.length === 0 ? (
              <div className="placeholder">暂无变更记录</div>
            ) : (
              <div className="change-list">
                {recentChanges.map((item, idx) => (
                  <div key={`${item.ci_uid || idx}-${item.occurred_at || idx}`}>
                    <span>{item.operation} {item.ci_name ? `· ${item.ci_name}` : ''}</span>
                    <span>{formatRelativeTime(item.occurred_at)} {item.operator_name || '系统'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      </>
    )
  }

  const renderModelPage = () => (
    <>
      <section className="panel compact">
        <div className="toolbar-row">
          <div className="toolbar-left wide">
            <input
              className="search-input"
              value={modelKeyword}
              onChange={(e) => setModelKeyword(e.target.value)}
              placeholder="搜索模型名称 / 描述..."
            />
            <select value={modelTypeFilter} onChange={(e) => setModelTypeFilter(e.target.value)}>
              <option value="">全部类型</option>
              {ciTypeOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <select value={modelSort} onChange={(e) => setModelSort(e.target.value)}>
              <option value="count-desc">按实例数（高到低）</option>
              <option value="count-asc">按实例数（低到高）</option>
              <option value="name-asc">按名称（升序）</option>
              <option value="name-desc">按名称（降序）</option>
            </select>
          </div>
          <div className="toolbar-right">
            <button type="button" className="btn btn-primary" onClick={openModelCreateDialog}>新建模型</button>
          </div>
        </div>
      </section>
      {modelRows.length === 0 ? (
        <section className="panel">
          <div className="placeholder">暂无模型，请点击“新建模型”创建。</div>
        </section>
      ) : (
        <section className="model-grid">
          {modelRows.map((item) => (
            <div key={item.id} className="model-card">
              <div className="model-card-head">
                <div className="model-icon">{item.icon || '◍'}</div>
                <span className="status-tag success">{item.ci_type_name || formatOptionLabel(ciTypeOptions, item.ci_type_key)}</span>
              </div>
              <div className="model-name">{item.name}</div>
              <div className="model-count">{Number(item.instance_count || 0).toLocaleString()} 实例</div>
              <div className="model-desc">{item.description || '暂无描述'}</div>
              <div className="model-meta">创建于 {formatDateTime(item.created_at)}</div>
              <div className="row-actions">
                <button type="button" className="link-btn" onClick={() => openModelFieldDialog(item)}>字段规则</button>
                <button type="button" className="link-btn" onClick={() => deleteModelTemplate(item)}>删除模型</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  )

  const renderRelationTopology = () => {
    const nodes = Array.isArray(topologyData?.nodes) ? topologyData.nodes : []
    const edges = Array.isArray(topologyData?.edges) ? topologyData.edges : []
    const previewNodes = nodes.slice(0, 20)

    return (
      <>
        <section className="panel compact">
          <div className="toolbar-row">
            <div className="toolbar-left wide">
              <input
                value={topologyFilter.keyword}
                onChange={(e) => setTopologyFilter((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="关键字（CI名称/CIUID）"
              />
              <input
                value={topologyFilter.focus_ci_uid}
                onChange={(e) => setTopologyFilter((prev) => ({ ...prev, focus_ci_uid: e.target.value }))}
                placeholder="聚焦 CIUID（可选）"
              />
              <select
                value={topologyFilter.limit}
                onChange={(e) => setTopologyFilter((prev) => ({ ...prev, limit: Number(e.target.value) || 300 }))}
              >
                <option value={100}>100 条边</option>
                <option value={300}>300 条边</option>
                <option value={800}>800 条边</option>
                <option value={1500}>1500 条边</option>
              </select>
              <button type="button" className="btn btn-outline-secondary" onClick={() => loadTopologyData(false)}>刷新拓扑</button>
            </div>
          </div>
        </section>

        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-title">拓扑节点数</div>
            <div className="stat-main">{Number(topologyData.total_nodes || 0).toLocaleString()}</div>
            <div className="stat-sub">当前筛选范围内节点</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">拓扑边数</div>
            <div className="stat-main green">{Number(topologyData.total_edges || 0).toLocaleString()}</div>
            <div className="stat-sub">关系链路条数</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">加载状态</div>
            <div className="stat-main orange">{topologyLoading ? '加载中' : '已完成'}</div>
            <div className="stat-sub">更新时间：{topologyLoadedAt || '-'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">路径查询</div>
            <div className="stat-main red">{pathLoading ? '查询中' : (pathResult?.found ? '已命中' : '待查询')}</div>
            <div className="stat-sub">支持最短路径（BFS）</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>拓扑节点预览</h2>
              <p>展示当前关系网络中的节点（预览前 20 个）。</p>
            </div>
          </div>
          {previewNodes.length === 0 ? (
            <div className="placeholder">{topologyLoading ? '拓扑加载中...' : '暂无拓扑节点'}</div>
          ) : (
            <div className="topology-pill-list">
              {previewNodes.map((node) => (
                <div key={node.ci_uid} className="topology-pill">
                  <strong>{node.name || node.ci_uid}</strong>
                  <span>{node.ci_type_key} · {node.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel compact">
          <div className="panel-header">
            <div>
              <h2>拓扑边列表</h2>
              <p>从源配置项到目标配置项的关系链路。</p>
            </div>
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>源配置项</th>
                  <th>关系类型</th>
                  <th>目标配置项</th>
                  <th>版本</th>
                </tr>
              </thead>
              <tbody>
                {edges.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">{topologyLoading ? '拓扑关系加载中...' : '暂无拓扑关系'}</td>
                  </tr>
                ) : edges.map((edge, idx) => (
                  <tr key={`${edge.from_ci_uid}-${edge.to_ci_uid}-${idx}`}>
                    <td>{edge.from_ci_uid}</td>
                    <td>{formatOptionLabel(relationTypeOptions, edge.relation_type)}</td>
                    <td>{edge.to_ci_uid}</td>
                    <td>{Number(edge.version || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>依赖路径查询</h2>
              <p>查询两个配置项之间的最短依赖路径。</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={queryRelationPath}>
            <label>
              起点 CIUID
              <input value={pathForm.from_ci_uid} onChange={(e) => setPathForm((prev) => ({ ...prev, from_ci_uid: e.target.value }))} />
            </label>
            <label>
              终点 CIUID
              <input value={pathForm.to_ci_uid} onChange={(e) => setPathForm((prev) => ({ ...prev, to_ci_uid: e.target.value }))} />
            </label>
            <label>
              最大深度
              <input
                type="number"
                min="1"
                max="12"
                value={pathForm.max_depth}
                onChange={(e) => setPathForm((prev) => ({ ...prev, max_depth: e.target.value }))}
              />
            </label>
            <div className="form-actions">
              <button disabled={pathLoading} type="submit" className="btn btn-primary">{pathLoading ? '查询中...' : '查询路径'}</button>
            </div>
          </form>
          {pathResult ? (
            <div className="result-fields" style={{ marginTop: 12 }}>
              {pathResult.found ? (
                (pathResult.hops || []).length === 0 ? (
                  <div>起点与终点相同，无需跳转。</div>
                ) : (pathResult.hops || []).map((hop, idx) => (
                  <div key={`${hop.from_ci_uid}-${hop.to_ci_uid}-${idx}`}>
                    <strong>第 {idx + 1} 跳：</strong>{hop.from_ci_name || hop.from_ci_uid} ({hop.from_ci_uid}) → {formatOptionLabel(relationTypeOptions, hop.relation_type)} → {hop.to_ci_name || hop.to_ci_uid} ({hop.to_ci_uid})
                  </div>
                ))
              ) : (
                <div>{pathResult.message || '未找到路径'}</div>
              )}
            </div>
          ) : null}
        </section>
      </>
    )
  }

  const renderRelationList = () => {
    const rows = relationResult.items || []
    const total = Number(relationResult.total || 0)
    const totalPages = Math.max(1, Math.ceil(total / relationPageSize))

    return (
      <>
        <section className="panel compact">
          <div className="toolbar-row">
            <div className="toolbar-left wide">
              <input
                value={relationFilter.keyword}
                onChange={(e) => {
                  setRelationFilter((prev) => ({ ...prev, keyword: e.target.value }))
                  setRelationPage(1)
                }}
                placeholder="关键字（源/目标名称或CIUID）"
              />
              <select
                value={relationFilter.relation_type}
                onChange={(e) => {
                  setRelationFilter((prev) => ({ ...prev, relation_type: e.target.value }))
                  setRelationPage(1)
                }}
              >
                <option value="">全部关系类型</option>
                {relationTypeOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <input
                value={relationFilter.from_ci_uid}
                onChange={(e) => {
                  setRelationFilter((prev) => ({ ...prev, from_ci_uid: e.target.value }))
                  setRelationPage(1)
                }}
                placeholder="源CIUID（可选）"
              />
              <input
                value={relationFilter.to_ci_uid}
                onChange={(e) => {
                  setRelationFilter((prev) => ({ ...prev, to_ci_uid: e.target.value }))
                  setRelationPage(1)
                }}
                placeholder="目标CIUID（可选）"
              />
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  setRelationFilter({
                    relation_type: '',
                    from_ci_uid: '',
                    to_ci_uid: '',
                    keyword: '',
                  })
                  setRelationPage(1)
                }}
              >
                重置
              </button>
            </div>
          </div>
        </section>

        <section className="panel compact">
          <div className="panel-header">
            <div>
              <h2>关系列表</h2>
              <p>当前关系数据支持按源/目标/类型筛选。</p>
            </div>
            <span className="panel-tip">{relationLoading ? '加载中...' : `更新于 ${relationLoadedAt || '-'}`}</span>
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>源配置项</th>
                  <th>源状态</th>
                  <th>关系类型</th>
                  <th>目标配置项</th>
                  <th>目标状态</th>
                  <th>版本</th>
                  <th>最近更新</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">{relationLoading ? '关系列表加载中...' : '暂无关系数据'}</td>
                  </tr>
                ) : rows.map((row, idx) => (
                  <tr key={`${row.from_ci_uid}-${row.to_ci_uid}-${row.version}-${idx}`}>
                    <td title={row.from_ci_uid}>{row.from_ci_name || row.from_ci_uid}</td>
                    <td><span className={statusClassName(row.from_status)}>{formatStatusLabel(row.from_status)}</span></td>
                    <td>{formatOptionLabel(relationTypeOptions, row.relation_type)}</td>
                    <td title={row.to_ci_uid}>{row.to_ci_name || row.to_ci_uid}</td>
                    <td><span className={statusClassName(row.to_status)}>{formatStatusLabel(row.to_status)}</span></td>
                    <td>{Number(row.version || 0)}</td>
                    <td>{formatDateTime(row.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer table-footer-actions">
            <span>共 {total} 条，当前第 {relationPage} / {totalPages} 页</span>
            <div className="pager">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={relationLoading || relationPage <= 1}
                onClick={() => setRelationPage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={relationLoading || relationPage >= totalPages}
                onClick={() => setRelationPage((prev) => Math.min(totalPages, prev + 1))}
              >
                下一页
              </button>
              <select
                value={relationPageSize}
                onChange={(e) => {
                  setRelationPageSize(Number(e.target.value) || 20)
                  setRelationPage(1)
                }}
              >
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
                <option value={100}>100 条/页</option>
              </select>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>关系维护</h2>
              <p>维护配置项之间的依赖、运行、连接与归属关系。</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={handleRelation}>
            <label>源配置项唯一编号<input value={relationForm.from_ci_uid} onChange={(e) => setRelationForm({ ...relationForm, from_ci_uid: e.target.value })} /></label>
            <label>目标配置项唯一编号<input value={relationForm.to_ci_uid} onChange={(e) => setRelationForm({ ...relationForm, to_ci_uid: e.target.value })} /></label>
            <label>
              关系类型
              <select value={relationForm.relation_type} onChange={(e) => setRelationForm({ ...relationForm, relation_type: e.target.value })}>
                {relationTypeOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="full-row">关系属性（对象格式）<textarea rows="6" value={relationForm.attributes_text} onChange={(e) => setRelationForm({ ...relationForm, attributes_text: e.target.value })} /></label>
            <div className="form-actions"><button disabled={busy} type="submit" className="btn btn-primary">保存关系</button></div>
          </form>
        </section>
      </>
    )
  }

  const renderDiscovery = () => {
    const enabledCount = discoveryTasks.filter((item) => !!item.enabled).length
    const successLogs = discoveryLogs.filter((item) => item.status === 'success').length
    const successRate = discoveryLogs.length ? Math.round((successLogs / discoveryLogs.length) * 100) : 0
    return (
      <>
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-title">发现任务总数</div>
            <div className="stat-main">{discoveryTasks.length}</div>
            <div className="stat-sub">当前已配置任务</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">启用任务</div>
            <div className="stat-main green">{enabledCount}</div>
            <div className="stat-sub">可参与批量执行</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">执行日志</div>
            <div className="stat-main orange">{discoveryLogs.length}</div>
            <div className="stat-sub">保留最近 60 条</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">成功率</div>
            <div className="stat-main red">{successRate}%</div>
            <div className="stat-sub">按任务执行结果统计</div>
          </div>
        </section>

        <section className="panel compact">
          <div className="toolbar-row">
            <div className="toolbar-left">
              <strong>任务管理：</strong>
              <span className="muted">支持创建任务、启停、立即执行并落库到资产表。</span>
            </div>
            <div className="toolbar-right">
              <button type="button" className="btn btn-outline-secondary" disabled={discoveryRunning} onClick={runAllEnabledDiscoveryTasks}>
                {discoveryRunning ? '执行中...' : '立即执行全部启用任务'}
              </button>
              <button type="button" className="btn btn-primary" onClick={openDiscoveryTaskDialog}>新建任务</button>
            </div>
          </div>
        </section>

        <section className="panel compact">
          <div className="panel-header">
            <div>
              <h2>发现任务列表</h2>
              <p>任务执行后将按模型类型生成配置项，来源标记为自动发现。</p>
            </div>
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>任务名称</th>
                  <th>资产类型</th>
                  <th>任务模式</th>
                  <th>数据源</th>
                  <th>同步策略</th>
                  <th>负责人</th>
                  <th>调度策略</th>
                  <th>批次</th>
                  <th>最近执行</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {discoveryTasks.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="muted">暂无发现任务</td>
                  </tr>
                ) : discoveryTasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.name}</td>
                    <td>{formatOptionLabel(ciTypeOptions, task.ci_type_key)}</td>
                    <td>{task.task_mode === 'cloud' ? '云同步' : '扫描发现'}</td>
                    <td title={task.endpoint_url || ''}>
                      {task.source_type === 'http' ? 'HTTP API' : 'Mock'}
                      {task.endpoint_url ? '（已配置）' : ''}
                    </td>
                    <td>{task.sync_mode === 'create_only' ? '仅新增' : '增量同步'}</td>
                    <td>{task.owner || '-'}</td>
                    <td>{task.schedule || '-'}</td>
                    <td>{Number(task.batch_size || 0)}</td>
                    <td>{task.last_run_at ? formatDateTime(task.last_run_at) : '-'}</td>
                    <td>
                      <span className={task.enabled ? 'status-tag success' : 'status-tag offline'}>
                        {task.enabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="link-btn" disabled={discoveryRunning} onClick={() => runDiscoveryTask(task)}>立即执行</button>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => toggleDiscoveryTask(task, !task.enabled)}
                        >
                          {task.enabled ? '停用' : '启用'}
                        </button>
                        <button type="button" className="link-btn" onClick={() => removeDiscoveryTask(task)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel compact">
          <div className="panel-header">
            <div>
              <h2>执行日志</h2>
              <p>记录每次任务执行的成功与失败明细。</p>
            </div>
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>执行时间</th>
                  <th>任务名称</th>
                  <th>资产类型</th>
                  <th>结果</th>
                  <th>成功</th>
                  <th>新增</th>
                  <th>更新</th>
                  <th>失败</th>
                  <th>失败原因</th>
                </tr>
              </thead>
              <tbody>
                {discoveryLogs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted">暂无执行日志</td>
                  </tr>
                ) : discoveryLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.finished_at || log.started_at)}</td>
                    <td>{log.task_name}</td>
                    <td>{formatOptionLabel(ciTypeOptions, log.ci_type_key)}</td>
                    <td>
                      <span className={log.status === 'success' ? 'status-tag success' : log.status === 'partial' ? 'status-tag offline' : 'status-tag danger'}>
                        {log.status === 'success' ? '成功' : log.status === 'partial' ? '部分成功' : '失败'}
                      </span>
                    </td>
                    <td>{Number(log.success_count || 0)}</td>
                    <td>{Number(log.created_count || 0)}</td>
                    <td>{Number(log.updated_count || 0)}</td>
                    <td>{Number(log.failed_count || 0)}</td>
                    <td title={(log.failures || []).join('；')}>{(log.failures || [])[0] || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderChange = () => {
    const rows = changeResult.items || []
    const total = Number(changeResult.total || 0)
    const totalPages = Math.max(1, Math.ceil(total / changePageSize))
    const pendingCount = rows.filter((item) => item.status === 'pending_approval').length
    const approvedCount = rows.filter((item) => item.status === 'approved').length
    const completedCount = rows.filter((item) => item.status === 'completed').length

    return (
      <>
        <section className="panel compact">
          <div className="toolbar-row">
            <div className="toolbar-left wide">
              <select
                value={changeFilter.status}
                onChange={(e) => {
                  setChangeFilter((prev) => ({ ...prev, status: e.target.value }))
                  setChangePage(1)
                }}
              >
                <option value="">全部状态</option>
                {changeStatusOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select
                value={changeFilter.risk_level}
                onChange={(e) => {
                  setChangeFilter((prev) => ({ ...prev, risk_level: e.target.value }))
                  setChangePage(1)
                }}
              >
                <option value="">全部风险</option>
                {changeRiskOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <input
                value={changeFilter.keyword}
                onChange={(e) => {
                  setChangeFilter((prev) => ({ ...prev, keyword: e.target.value }))
                  setChangePage(1)
                }}
                placeholder="关键字（变更单号/标题/目标CI）"
              />
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  setChangeFilter({
                    status: '',
                    risk_level: '',
                    keyword: '',
                  })
                  setChangePage(1)
                }}
              >
                重置
              </button>
            </div>
          </div>
        </section>

        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-title">当前筛选总数</div>
            <div className="stat-main">{total.toLocaleString()}</div>
            <div className="stat-sub">更新时间：{changeLoadedAt || '-'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">待审批（当前页）</div>
            <div className="stat-main orange">{pendingCount.toLocaleString()}</div>
            <div className="stat-sub">可执行审批操作</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">已审批（当前页）</div>
            <div className="stat-main green">{approvedCount.toLocaleString()}</div>
            <div className="stat-sub">可进入执行阶段</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">已执行（当前页）</div>
            <div className="stat-main red">{completedCount.toLocaleString()}</div>
            <div className="stat-sub">支持回滚闭环</div>
          </div>
        </section>

        <section className="panel compact">
          <div className="panel-header">
            <div>
              <h2>变更单列表</h2>
              <p>支持新建、审批、执行、回滚全流程操作。</p>
            </div>
          </div>
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>变更单号</th>
                  <th>标题</th>
                  <th>目标CI</th>
                  <th>风险</th>
                  <th>状态</th>
                  <th>计划窗口</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">{changeLoading ? '变更单加载中...' : '暂无变更单'}</td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.change_uid}>
                    <td>{row.change_uid}</td>
                    <td title={row.description || ''}>{row.title || '-'}</td>
                    <td title={row.target_ci_uid}>{row.target_ci_name || row.target_ci_uid || '-'}</td>
                    <td>{formatOptionLabel(changeRiskOptions, row.risk_level)}</td>
                    <td><span className={changeStatusClassName(row.status)}>{formatChangeStatusLabel(row.status)}</span></td>
                    <td>{row.planned_start_at ? formatDateTime(row.planned_start_at) : '-'} ~ {row.planned_end_at ? formatDateTime(row.planned_end_at) : '-'}</td>
                    <td>{formatDateTime(row.updated_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="link-btn" onClick={() => loadChangeDetail(row.change_uid, false)}>查看</button>
                        <button type="button" className="link-btn" disabled={!canRunChangeAction(row, 'approve')} onClick={() => runChangeAction(row, 'approve')}>审批通过</button>
                        <button type="button" className="link-btn" disabled={!canRunChangeAction(row, 'reject')} onClick={() => runChangeAction(row, 'reject')}>驳回</button>
                        <button type="button" className="link-btn" disabled={!canRunChangeAction(row, 'execute')} onClick={() => runChangeAction(row, 'execute')}>执行</button>
                        <button type="button" className="link-btn" disabled={!canRunChangeAction(row, 'rollback')} onClick={() => runChangeAction(row, 'rollback')}>回滚</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer table-footer-actions">
            <span>共 {total} 条，当前第 {changePage} / {totalPages} 页</span>
            <div className="pager">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={changeLoading || changePage <= 1}
                onClick={() => setChangePage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={changeLoading || changePage >= totalPages}
                onClick={() => setChangePage((prev) => Math.min(totalPages, prev + 1))}
              >
                下一页
              </button>
              <select
                value={changePageSize}
                onChange={(e) => {
                  setChangePageSize(Number(e.target.value) || 20)
                  setChangePage(1)
                }}
              >
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
                <option value={100}>100 条/页</option>
              </select>
            </div>
          </div>
        </section>

        <section className="panel compact">
          <div className="panel-header">
            <div>
              <h2>变更单详情</h2>
              <p>查看当前选中变更单的流转记录。</p>
            </div>
          </div>
          {!changeDetail ? (
            <div className="placeholder">请选择一条变更单查看详情</div>
          ) : (
            <>
              <div className="result-fields">
                <div><strong>变更单号：</strong>{changeDetail.change_uid || '-'}</div>
                <div><strong>标题：</strong>{changeDetail.title || '-'}</div>
                <div><strong>目标CI：</strong>{changeDetail.target_ci_name || changeDetail.target_ci_uid || '-'}</div>
                <div><strong>风险等级：</strong>{formatOptionLabel(changeRiskOptions, changeDetail.risk_level)}</div>
                <div><strong>当前状态：</strong>{formatChangeStatusLabel(changeDetail.status)}</div>
                <div><strong>申请人：</strong>{changeDetail.requested_by_name || changeDetail.requested_by_sub || '-'}</div>
                <div><strong>计划开始：</strong>{formatDateTime(changeDetail.planned_start_at)}</div>
                <div><strong>计划结束：</strong>{formatDateTime(changeDetail.planned_end_at)}</div>
                <div><strong>描述：</strong>{changeDetail.description || '-'}</div>
              </div>
              <div className="table-shell" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>动作</th>
                      <th>状态流转</th>
                      <th>操作人</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(changeDetail.steps || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">暂无流转日志</td>
                      </tr>
                    ) : (changeDetail.steps || []).map((step) => (
                      <tr key={step.id || `${step.action}-${step.created_at}`}>
                        <td>{formatDateTime(step.created_at)}</td>
                        <td>{step.action || '-'}</td>
                        <td>{step.from_status ? `${formatChangeStatusLabel(step.from_status)} -> ` : ''}{formatChangeStatusLabel(step.to_status)}</td>
                        <td>{step.operator_name || step.operator_sub || '-'}</td>
                        <td>{step.comment_text || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </>
    )
  }

  const renderReport = () => {
    const totals = reportResult.totals || emptyReportResult.totals
    const days = Number(reportResult.days || 30)
    const changeTrend = reportResult.change_frequency_trend || []
    const complexityTrend = reportResult.relation_complexity_trend || []
    const maxChange = Math.max(1, ...changeTrend.map((item) => Number(item.total || 0)))
    const maxComplexity = Math.max(0.000001, ...complexityTrend.map((item) => Number(item.complexity_index || 0)))

    return (
      <>
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-title">资产总数</div>
            <div className="stat-main">{Number(totals.asset_total || 0).toLocaleString()}</div>
            <div className="stat-sub">来自 CI 主数据</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">{days}天变更总量</div>
            <div className="stat-main green">{Number(totals.change_total || 0).toLocaleString()}</div>
            <div className="stat-sub">来源于变更单创建量</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">关系总量</div>
            <div className="stat-main orange">{Number(totals.relation_total || 0).toLocaleString()}</div>
            <div className="stat-sub">当前生效关系边数</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">当前关系复杂度</div>
            <div className="stat-main red">{Number(totals.complexity_index || 0).toFixed(3)}</div>
            <div className="stat-sub">关系数 / 资产数</div>
          </div>
        </section>

        <section className="panel-grid-2">
          <section className="panel chart-panel">
            <div className="panel-header">
              <h2>变更频次趋势（{days}天）</h2>
              <span className="panel-tip">{reportLoading ? '加载中...' : `更新于 ${reportLoadedAt || '-'}`}</span>
            </div>
            {changeTrend.length === 0 ? (
              <div className="placeholder">暂无变更频次数据</div>
            ) : (
              <div className="metric-bars">
                {changeTrend.map((item) => (
                  <div className="metric-row" key={item.date}>
                    <div className="metric-label">{item.date}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${Math.max(8, Math.round((Number(item.total || 0) / maxChange) * 100))}%` }} />
                    </div>
                    <div className="metric-value">{Number(item.total || 0).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel chart-panel">
            <div className="panel-header"><h2>关系复杂度趋势（{days}天）</h2></div>
            {complexityTrend.length === 0 ? (
              <div className="placeholder">暂无复杂度趋势数据</div>
            ) : (
              <div className="metric-bars">
                {complexityTrend.map((item) => (
                  <div className="metric-row" key={item.date}>
                    <div className="metric-label">{item.date}</div>
                    <div className="bar-track">
                      <div className="bar-fill soft" style={{ width: `${Math.max(8, Math.round((Number(item.complexity_index || 0) / maxComplexity) * 100))}%` }} />
                    </div>
                    <div className="metric-value">{Number(item.complexity_index || 0).toFixed(3)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="panel">
          <div className="panel-header"><h2>资产来源概览</h2></div>
          <div className="result-fields">
            <div><strong>正常资产：</strong>{Number(totals.active_total || 0).toLocaleString()}</div>
            <div><strong>自动发现资产：</strong>{Number(totals.discovery_total || 0).toLocaleString()}</div>
            <div><strong>云同步资产：</strong>{Number(totals.cloud_total || 0).toLocaleString()}</div>
          </div>
        </section>
      </>
    )
  }

  const renderAudit = () => (
    <>
      <section className="panel compact">
        <div className="toolbar-row">
          <div className="toolbar-left wide">
            <input
              value={auditFilter.actor}
              onChange={(e) => {
                setAuditFilter({ ...auditFilter, actor: e.target.value })
                setAuditPage(1)
              }}
              placeholder="操作人"
            />
            <input
              value={auditFilter.action}
              onChange={(e) => {
                setAuditFilter({ ...auditFilter, action: e.target.value })
                setAuditPage(1)
              }}
              placeholder="动作（如 ci.update）"
            />
            <select
              value={auditFilter.result}
              onChange={(e) => {
                setAuditFilter({ ...auditFilter, result: e.target.value })
                setAuditPage(1)
              }}
            >
              <option value="">全部结果</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
            <input
              value={auditFilter.source_ip}
              onChange={(e) => {
                setAuditFilter({ ...auditFilter, source_ip: e.target.value })
                setAuditPage(1)
              }}
              placeholder="来源IP"
            />
            <input
              value={auditFilter.keyword}
              onChange={(e) => {
                setAuditFilter({ ...auditFilter, keyword: e.target.value })
                setAuditPage(1)
              }}
              placeholder="关键字（请求ID/资源/路径）"
            />
            <input
              type="date"
              value={auditFilter.date_from}
              onChange={(e) => {
                setAuditFilter({ ...auditFilter, date_from: e.target.value })
                setAuditPage(1)
              }}
            />
            <input
              type="date"
              value={auditFilter.date_to}
              onChange={(e) => {
                setAuditFilter({ ...auditFilter, date_to: e.target.value })
                setAuditPage(1)
              }}
            />
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => {
                setAuditFilter({
                  actor: '',
                  action: '',
                  result: '',
                  source_ip: '',
                  keyword: '',
                  date_from: '',
                  date_to: '',
                })
                setAuditPage(1)
              }}
            >
              重置
            </button>
          </div>
        </div>
      </section>

      <section className="panel compact">
        <div className="panel-header">
          <div>
            <h2>审计日志</h2>
            <p>记录 CMDB 核心操作，支持来源IP追踪与导出。</p>
          </div>
          <span className="panel-tip">{auditLoading ? '加载中...' : `更新于 ${auditLoadedAt || '-'}`}</span>
        </div>

        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>动作</th>
                <th>资源</th>
                <th>方法</th>
                <th>状态</th>
                <th>来源IP</th>
                <th>请求ID</th>
              </tr>
            </thead>
            <tbody>
              {auditResult.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">{auditLoading ? '审计日志加载中...' : '暂无审计日志'}</td>
                </tr>
              ) : (
                auditResult.items.map((row) => (
                  <tr key={`${row.id}-${row.request_id}`}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.actor_name || row.actor_sub || '-'}</td>
                    <td>{row.action || '-'}</td>
                    <td>{row.resource_uid ? `${row.resource_type} / ${row.resource_uid}` : row.resource_type || '-'}</td>
                    <td>{row.http_method || '-'}</td>
                    <td>
                      <span className={String(row.result || '').toLowerCase() === 'success' ? 'status-tag success' : 'status-tag danger'}>
                        {String(row.result || '').toLowerCase() === 'success' ? '成功' : '失败'}
                      </span>
                    </td>
                    <td>{row.source_ip || '-'}</td>
                    <td title={row.request_id || ''}>{row.request_id || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer table-footer-actions">
          <span>共 {Number(auditResult.total || 0)} 条，当前第 {auditPage} / {Math.max(1, Math.ceil(Math.max(Number(auditResult.total || 0), 0) / auditPageSize))} 页</span>
          <div className="pager">
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={auditLoading || auditPage <= 1}
              onClick={() => setAuditPage((prev) => Math.max(1, prev - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={auditLoading || auditPage >= Math.max(1, Math.ceil(Math.max(Number(auditResult.total || 0), 0) / auditPageSize))}
              onClick={() => setAuditPage((prev) => prev + 1)}
            >
              下一页
            </button>
            <select
              value={auditPageSize}
              onChange={(e) => {
                setAuditPageSize(Number(e.target.value) || 20)
                setAuditPage(1)
              }}
            >
              <option value={20}>20 条/页</option>
              <option value={50}>50 条/页</option>
              <option value={100}>100 条/页</option>
            </select>
          </div>
        </div>
      </section>
    </>
  )

  const renderMainContent = () => {
    if (activeKey === 'audit') return renderAudit()
    if (activeKey === 'dashboard') return renderDashboard()
    if (activeKey.startsWith('asset-')) return renderAssetPage()
    if (activeKey === 'model') return renderModelPage()
    if (activeKey === 'relation-topology') return renderRelationTopology()
    if (activeKey === 'relation-list') return renderRelationList()
    if (activeKey === 'discovery') return renderDiscovery()
    if (activeKey === 'change') return renderChange()
    return renderReport()
  }

  const pageActions = {
    audit: ['刷新', '导出CSV'],
    dashboard: ['刷新', '导出报表'],
    'asset-server': ['刷新', '新增', '导入', '导出'],
    'asset-database': ['刷新', '新增', '导入', '导出'],
    'asset-network': ['刷新', '新增', '导入', '导出'],
    'asset-middleware': ['刷新', '新增', '导入', '导出'],
    model: ['新建模型'],
    'relation-topology': ['刷新', '刷新拓扑'],
    'relation-list': ['刷新', '导出关系'],
    discovery: ['新建任务', '立即执行'],
    change: ['刷新', '新建变更'],
    report: ['刷新', '导出报表'],
  }

  const exportDashboardReport = () => {
    const report = {
      导出时间: new Date().toLocaleString(),
      仪表盘数据: dashboardData,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `cmdb-dashboard-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
  }

  const onPageAction = (action) => {
    if (action === '刷新') {
      if (activeKey === 'dashboard') {
        loadDashboardOverview(false)
      } else if (activeKey === 'audit') {
        loadAuditLogs(false)
      } else if (activeKey.startsWith('asset-')) {
        loadAssetList(false)
      } else if (activeKey === 'model') {
        loadModelTemplates(false)
      } else if (activeKey === 'relation-list') {
        loadRelationList(false)
      } else if (activeKey === 'relation-topology') {
        loadTopologyData(false)
      } else if (activeKey === 'discovery') {
        loadDiscoveryTasks(false)
        loadDiscoveryLogs(false)
      } else if (activeKey === 'change') {
        loadChangeList(false)
      } else if (activeKey === 'report') {
        loadReport(false)
      }
      return
    }
    if (action === '刷新拓扑') {
      loadTopologyData(false)
      return
    }
    if (action === '导出CSV') {
      if (activeKey === 'audit') {
        exportAuditListCSV()
        return
      }
    }
    if (action === '导出报表') {
      if (activeKey === 'report') {
        exportReportAnalysis()
        return
      }
      exportDashboardReport()
      return
    }
    if (action === '新增') {
      setAssetTab('create')
      return
    }
    if (action === '导入') {
      importAssets()
      return
    }
    if (action === '导出' || action === '导出关系') {
      if (activeKey.startsWith('asset-')) {
        exportAssetList()
        return
      }
      if (activeKey === 'relation-list') {
        exportRelationList()
        return
      }
    }
    if (action === '新建模型') {
      openModelCreateDialog()
      return
    }
    if (action === '新建任务') {
      openDiscoveryTaskDialog()
      return
    }
    if (action === '新建变更') {
      openChangeCreateDialog()
      return
    }
    if (action === '立即执行') {
      runAllEnabledDiscoveryTasks()
      return
    }
    showMessage(`操作「${action}」建设中，预计 2026-04-15 前交付`)
  }

  if (!authToken) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1 className="brand-title"><span className="brand-red">聚信</span><span className="brand-blue">配置管理数据库系统</span></h1>
            <p className="sub">正在跳转到统一登录页，请稍候。</p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              window.location.href = buildPortalEntryUrl('cmdb')
            }}
          >
            前往统一登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-wrap">
          <strong>CMDB 系统</strong>
        </div>

        <nav className="nav-tree">
          {visibleNavTree.map((top) => {
            const hasChildren = Array.isArray(top.children) && top.children.length > 0
            const topActive = top.key === activeKey || (hasChildren && top.children.some((item) => item.key === activeKey))
            const expanded = !!expandedMenus[top.key]

            return (
              <div key={top.key} className="nav-block">
                <button
                  type="button"
                  className={topActive ? 'nav-item active' : 'nav-item'}
                  onClick={() => toggleTopMenu(top)}
                >
                  <span className="nav-icon">{top.icon}</span>
                  <span className="nav-label">{top.label}</span>
                  {hasChildren && <span className={expanded ? 'nav-arrow open' : 'nav-arrow'}>⌄</span>}
                </button>

                {hasChildren && expanded && (
                  <div className="sub-menu">
                    {top.children.map((sub) => (
                      <button
                        key={sub.key}
                        type="button"
                        className={activeKey === sub.key ? 'sub-item active' : 'sub-item'}
                        onClick={() => selectSubMenu(top.key, sub.key)}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        <div className="sidebar-actions">
          <div className="user-pill">{currentUser?.username || '当前用户'} · {formatRoleLabel(currentUser?.role)}</div>
          <button type="button" className="btn btn-ghost" onClick={onSwitchSystem}>切换系统</button>
          <button type="button" className="btn btn-ghost" onClick={onLogout}>退出登录</button>
        </div>
      </aside>

      <main className="content">
        <div className="content-inner">
          <section className="breadcrumbs">{activeMeta.breadcrumb}</section>

          <section className="page-title">
            <div>
              <h1>{activeMeta.current.label}</h1>
              <p>{activeMeta.current.desc}</p>
            </div>
            <div className="title-actions">
              {(pageActions[activeMeta.current.key] || []).map((action) => (
                <button
                  key={action}
                  type="button"
                  className={action === '新增' || action === '新建模型' || action === '新建任务' || action === '新建变更' ? 'btn btn-primary' : 'btn btn-outline-secondary'}
                  onClick={() => onPageAction(action)}
                >
                  {action}
                </button>
              ))}
            </div>
          </section>

          {renderMainContent()}

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>最近响应</h2>
                <p>便于排查接口返回和权限问题。</p>
              </div>
            </div>
            {lastResponse ? (
              <div className="response-summary">
                <div>请求方式：{lastResponse.请求方式}</div>
                <div>状态码：{lastResponse.状态码}</div>
                <div>请求结果：{lastResponse.请求结果}</div>
                <div>请求时间：{lastResponse.请求时间}</div>
              </div>
            ) : (
              <div className="muted">暂无请求记录</div>
            )}
          </section>
        </div>

        {confirmDialog.open && (
          <div className="dialog-backdrop" onClick={closeConfirmDialog}>
            <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
              <div className="dialog-title">{confirmDialog.title || '确认操作'}</div>
              <div className="dialog-body">{confirmDialog.message || '确认执行该操作？'}</div>
              <div className="dialog-actions">
                <button type="button" className="btn btn-outline-secondary" onClick={closeConfirmDialog}>取消</button>
                <button type="button" className="btn btn-primary" onClick={onConfirmDialogAccept}>
                  {confirmDialog.confirmLabel || '确认'}
                </button>
              </div>
            </div>
          </div>
        )}

        {formatDialog.open && (
          <div className="dialog-backdrop" onClick={() => closeFormatDialog('')}>
            <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
              <div className="dialog-title">{formatDialog.title || '格式选择'}</div>
              <div className="dialog-body">请选择{formatDialog.mode === 'import' ? '导入' : '导出'}格式。</div>
              <div className="format-actions">
                <button type="button" className="btn btn-outline-secondary" onClick={() => closeFormatDialog('json')}>JSON</button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => closeFormatDialog('csv')}>CSV</button>
                <button type="button" className="btn btn-primary" onClick={() => closeFormatDialog('xlsx')}>XLSX</button>
              </div>
              <div className="dialog-actions">
                <button type="button" className="btn btn-outline-secondary" onClick={() => closeFormatDialog('')}>取消</button>
              </div>
            </div>
          </div>
        )}

        {modelDialogOpen && (
          <div className="dialog-backdrop" onClick={closeModelCreateDialog}>
            <div className="dialog-card dialog-card-wide" onClick={(event) => event.stopPropagation()}>
              <div className="dialog-title">新建模型</div>
              <form className="form-grid" onSubmit={createModelTemplate}>
                <label>
                  模型名称
                  <input value={modelForm.name} onChange={(e) => setModelForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="例如：Redis实例模型" />
                </label>
                <label>
                  模型类型
                  <select value={modelForm.ci_type_key} onChange={(e) => setModelForm((prev) => ({ ...prev, ci_type_key: e.target.value }))}>
                    {ciTypeOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  图标
                  <input value={modelForm.icon} onChange={(e) => setModelForm((prev) => ({ ...prev, icon: e.target.value }))} placeholder="◍" maxLength={2} />
                </label>
                <label className="full-row">
                  描述
                  <textarea rows="4" value={modelForm.description} onChange={(e) => setModelForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="描述模型用途、命名规范和关键字段" />
                </label>
                <div className="dialog-actions full-row">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeModelCreateDialog}>取消</button>
                  <button type="submit" className="btn btn-primary">创建模型</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modelFieldDialogOpen && (
          <div className="dialog-backdrop" onClick={closeModelFieldDialog}>
            <div className="dialog-card dialog-card-xl" onClick={(event) => event.stopPropagation()}>
              <div className="dialog-title">字段规则管理 · {currentModelForFields?.name || '-'}</div>
              <div className="dialog-body">字段规则将应用到该模型对应资产类型的新增/更新校验。</div>
              <form className="form-grid" onSubmit={createModelFieldRule}>
                <label>
                  字段编码
                  <input
                    value={modelFieldForm.field_key}
                    onChange={(e) => setModelFieldForm((prev) => ({ ...prev, field_key: e.target.value }))}
                    placeholder="例如：ip / engine / version"
                  />
                </label>
                <label>
                  字段名称
                  <input
                    value={modelFieldForm.field_label}
                    onChange={(e) => setModelFieldForm((prev) => ({ ...prev, field_label: e.target.value }))}
                    placeholder="例如：IP地址"
                  />
                </label>
                <label>
                  数据类型
                  <select
                    value={modelFieldForm.data_type}
                    onChange={(e) => setModelFieldForm((prev) => ({ ...prev, data_type: e.target.value }))}
                  >
                    {modelFieldDataTypeOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="full-row">
                  默认值（JSON，留空则无默认值）
                  <textarea
                    rows="3"
                    value={modelFieldForm.default_value_text}
                    onChange={(e) => setModelFieldForm((prev) => ({ ...prev, default_value_text: e.target.value }))}
                    placeholder={'例如：\n"4C"\n3306\ntrue\n{"zone":"A"}\n["prod","blue"]'}
                  />
                </label>
                <label className="full-row field-inline">
                  <span>是否必填</span>
                  <input
                    type="checkbox"
                    checked={!!modelFieldForm.required}
                    onChange={(e) => setModelFieldForm((prev) => ({ ...prev, required: e.target.checked }))}
                  />
                </label>
                <div className="dialog-actions full-row">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeModelFieldDialog}>关闭</button>
                  <button type="submit" className="btn btn-primary">新增字段规则</button>
                </div>
              </form>

              <div className="table-shell" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>字段编码</th>
                      <th>字段名称</th>
                      <th>类型</th>
                      <th>必填</th>
                      <th>默认值</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelFieldRules.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="muted">{modelFieldLoading ? '字段规则加载中...' : '暂无字段规则'}</td>
                      </tr>
                    ) : modelFieldRules.map((field) => (
                      <tr key={field.field_uid || field.id}>
                        <td>{field.field_key}</td>
                        <td>{field.field_label}</td>
                        <td>{field.data_type}</td>
                        <td>{field.required ? '是' : '否'}</td>
                        <td>
                          {field.has_default
                            ? <code>{JSON.stringify(field.default_value)}</code>
                            : '-'}
                        </td>
                        <td>
                          <button type="button" className="link-btn" onClick={() => deleteModelFieldRule(field)}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {discoveryDialogOpen && (
          <div className="dialog-backdrop" onClick={closeDiscoveryTaskDialog}>
            <div className="dialog-card dialog-card-wide" onClick={(event) => event.stopPropagation()}>
              <div className="dialog-title">新建自动发现任务</div>
              <form className="form-grid" onSubmit={createDiscoveryTask}>
                <label>
                  任务名称
                  <input value={discoveryTaskForm.name} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="例如：交换机日巡检发现" />
                </label>
                <label>
                  资产类型
                  <select value={discoveryTaskForm.ci_type_key} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, ci_type_key: e.target.value }))}>
                    {ciTypeOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  任务模式
                  <select value={discoveryTaskForm.task_mode} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, task_mode: e.target.value }))}>
                    <option value="scan">扫描发现</option>
                    <option value="cloud">云资源同步</option>
                  </select>
                </label>
                <label>
                  数据源
                  <select value={discoveryTaskForm.source_type} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, source_type: e.target.value }))}>
                    <option value="mock">Mock（内置模拟）</option>
                    <option value="http">HTTP API</option>
                  </select>
                </label>
                {discoveryTaskForm.source_type === 'http' && (
                  <label className="full-row">
                    接入地址（HTTP/HTTPS）
                    <input
                      value={discoveryTaskForm.endpoint_url}
                      onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, endpoint_url: e.target.value }))}
                      placeholder="例如：https://scanner.example.com/api/v1/assets"
                    />
                  </label>
                )}
                <label>
                  同步策略
                  <select value={discoveryTaskForm.sync_mode} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, sync_mode: e.target.value }))}>
                    <option value="upsert">增量同步（新增+更新）</option>
                    <option value="create_only">仅新增</option>
                  </select>
                </label>
                <label>
                  请求方式
                  <select value={discoveryTaskForm.request_method} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, request_method: e.target.value }))}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </label>
                <label>
                  负责人
                  <input value={discoveryTaskForm.owner} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, owner: e.target.value }))} placeholder="例如：运维一组" />
                </label>
                <label>
                  调度策略
                  <input value={discoveryTaskForm.schedule} onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, schedule: e.target.value }))} placeholder="例如：每天 02:00 / 每 4 小时" />
                </label>
                <label>
                  每次批量处理条数（1-50）
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={discoveryTaskForm.batch_size}
                    onChange={(e) => setDiscoveryTaskForm((prev) => ({ ...prev, batch_size: e.target.value }))}
                  />
                </label>
                <div className="dialog-actions full-row">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeDiscoveryTaskDialog}>取消</button>
                  <button type="submit" className="btn btn-primary">创建任务</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {changeDialogOpen && (
          <div className="dialog-backdrop" onClick={closeChangeCreateDialog}>
            <div className="dialog-card dialog-card-wide" onClick={(event) => event.stopPropagation()}>
              <div className="dialog-title">新建变更单</div>
              <form className="form-grid" onSubmit={createChangeRequest}>
                <label>
                  变更标题
                  <input value={changeForm.title} onChange={(e) => setChangeForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="例如：升级订单服务JDK版本" />
                </label>
                <label>
                  目标 CIUID
                  <input value={changeForm.target_ci_uid} onChange={(e) => setChangeForm((prev) => ({ ...prev, target_ci_uid: e.target.value }))} placeholder="例如：01J..." />
                </label>
                <label>
                  风险等级
                  <select value={changeForm.risk_level} onChange={(e) => setChangeForm((prev) => ({ ...prev, risk_level: e.target.value }))}>
                    {changeRiskOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  计划开始时间
                  <input type="datetime-local" value={changeForm.planned_start_at} onChange={(e) => setChangeForm((prev) => ({ ...prev, planned_start_at: e.target.value }))} />
                </label>
                <label>
                  计划结束时间
                  <input type="datetime-local" value={changeForm.planned_end_at} onChange={(e) => setChangeForm((prev) => ({ ...prev, planned_end_at: e.target.value }))} />
                </label>
                <label className="full-row">
                  变更说明
                  <textarea rows="4" value={changeForm.description} onChange={(e) => setChangeForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="填写变更背景、实施方案和回退预案" />
                </label>
                <div className="dialog-actions full-row">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeChangeCreateDialog}>取消</button>
                  <button type="submit" className="btn btn-primary">创建变更单</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {message && <div className="toast success">{message}</div>}
        {error && <div className="toast error">{error}</div>}
      </main>
    </div>
  )
}

export default App

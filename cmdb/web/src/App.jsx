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
    key: 'report',
    icon: '▤',
    label: '报表分析',
    desc: '查看统计报表与趋势分析。',
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

const methodLabelMap = {
  GET: '查询',
  POST: '新建',
  PATCH: '更新',
  PUT: '覆盖更新',
  DELETE: '删除',
}

const modelCards = [
  { name: '物理机', count: 128 },
  { name: '虚拟机', count: 256 },
  { name: '容器', count: 64 },
  { name: '数据库', count: 32 },
  { name: '交换机', count: 48 },
  { name: '路由器', count: 24 },
  { name: '防火墙', count: 16 },
  { name: '负载均衡', count: 12 },
]

const relationRows = [
  { from: '应用A', type: '依赖于', to: '数据库B', updated: '2分钟前' },
  { from: '应用C', type: '运行于', to: '主机D', updated: '18分钟前' },
  { from: '服务E', type: '连接到', to: '中间件F', updated: '35分钟前' },
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

function App() {
  const [authToken, setAuthToken] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)

  const [activeKey, setActiveKey] = useState('dashboard')
  const [expandedMenus, setExpandedMenus] = useState({ asset: true, relation: true })

  const [assetTab, setAssetTab] = useState('query')
  const [assetFilter, setAssetFilter] = useState({ keyword: '', status: '', owner: '' })
  const [assetPage, setAssetPage] = useState(1)
  const [assetPageSize, setAssetPageSize] = useState(10)
  const [assetResult, setAssetResult] = useState(emptyAssetResult)
  const [assetLoading, setAssetLoading] = useState(false)

  const [lookupUID, setLookupUID] = useState('')
  const [lookupResult, setLookupResult] = useState(null)
  const [lastResponse, setLastResponse] = useState(null)
  const [dashboardData, setDashboardData] = useState(emptyDashboard)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardLoadedAt, setDashboardLoadedAt] = useState('')

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

  useEffect(() => {
    let cancelled = false
    const bootstrapAuth = async () => {
      try {
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

  const apiHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
    }),
    [],
  )

  const currentAssetTypeKey = useMemo(() => assetTypeKeyMap[activeKey] || '', [activeKey])

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

  const activeMeta = useMemo(() => {
    for (const top of navTree) {
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
    return {
      top: navTree[0],
      current: { key: navTree[0].key, label: navTree[0].label, desc: navTree[0].desc || '' },
      breadcrumb: `首页 / ${navTree[0].label}`,
    }
  }, [activeKey])

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

  useEffect(() => {
    if (!authToken) {
      setDashboardData(emptyDashboard)
      setDashboardLoadedAt('')
      setAssetResult(emptyAssetResult)
      setAssetLoading(false)
      return
    }
    if (activeKey === 'dashboard') {
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
    try {
      if (authToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        })
      }
    } catch {
      // ignore
    }
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
    const ok = window.confirm(`确认删除资产「${row.name || ciUID}」吗？`)
    if (!ok) return

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

  const chooseFileFormat = (mode) => {
    const defaultValue = mode === 'import' ? 'json' : 'xlsx'
    const picked = String(window.prompt(`请选择${mode === 'import' ? '导入' : '导出'}格式：json / csv / xlsx`, defaultValue) || '')
      .trim()
      .toLowerCase()
    if (!picked) return ''
    if (picked === 'json' || picked === 'csv' || picked === 'xlsx') return picked
    showError('仅支持 json / csv / xlsx')
    return ''
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

  const exportAssetList = (format) => {
    const targetFormat = format || chooseFileFormat('export')
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
            <input className="search-input" placeholder="搜索模型..." />
            <button type="button" className="btn btn-outline-secondary">筛选</button>
            <button type="button" className="btn btn-outline-secondary">排序</button>
          </div>
          <div className="toolbar-right">
            <button type="button" className="btn btn-primary">新建模型</button>
          </div>
        </div>
      </section>
      <section className="model-grid">
        {modelCards.map((item) => (
          <div key={item.name} className="model-card">
            <div className="model-icon">◍</div>
            <div className="model-name">{item.name}</div>
            <div className="model-count">{item.count} 实例</div>
          </div>
        ))}
      </section>
    </>
  )

  const renderRelationTopology = () => (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>拓扑视图</h2>
          <p>展示资产之间的依赖链路与连接关系。</p>
        </div>
      </div>
      <div className="topology-canvas">
        <div className="node">应用</div>
        <div className="edge" />
        <div className="node">中间件</div>
        <div className="edge" />
        <div className="node">数据库</div>
      </div>
    </section>
  )

  const renderRelationList = () => (
    <>
      <section className="panel compact">
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>源配置项</th>
                <th>关系类型</th>
                <th>目标配置项</th>
                <th>最近更新</th>
              </tr>
            </thead>
            <tbody>
              {relationRows.map((row) => (
                <tr key={`${row.from}-${row.to}`}>
                  <td>{row.from}</td>
                  <td>{row.type}</td>
                  <td>{row.to}</td>
                  <td>{row.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

  const renderDiscovery = () => (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>自动发现</h2>
          <p>接入扫描任务、云资源同步、发现结果入库。</p>
        </div>
      </div>
      <div className="hint-card">当前页面已按新布局接入，后续可继续对接自动发现任务接口和执行日志。</div>
    </section>
  )

  const renderReport = () => (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>报表分析</h2>
          <p>资产总量、变更频次、关系复杂度趋势。</p>
        </div>
      </div>
      <div className="hint-card">当前页面已按新布局接入，后续可对接图表组件与报表导出功能。</div>
    </section>
  )

  const renderMainContent = () => {
    if (activeKey === 'dashboard') return renderDashboard()
    if (activeKey.startsWith('asset-')) return renderAssetPage()
    if (activeKey === 'model') return renderModelPage()
    if (activeKey === 'relation-topology') return renderRelationTopology()
    if (activeKey === 'relation-list') return renderRelationList()
    if (activeKey === 'discovery') return renderDiscovery()
    return renderReport()
  }

  const pageActions = {
    dashboard: ['刷新', '导出报表'],
    'asset-server': ['刷新', '新增', '导入', '导出'],
    'asset-database': ['刷新', '新增', '导入', '导出'],
    'asset-network': ['刷新', '新增', '导入', '导出'],
    'asset-middleware': ['刷新', '新增', '导入', '导出'],
    model: ['新建模型'],
    'relation-topology': ['刷新拓扑'],
    'relation-list': ['导出关系'],
    discovery: ['新建任务', '立即执行'],
    report: ['导出报表'],
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
      } else if (activeKey.startsWith('asset-')) {
        loadAssetList(false)
      }
      return
    }
    if (action === '导出报表') {
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
    }
    showMessage(`操作「${action}」功能待接入`)
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
          {navTree.map((top) => {
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
                  className={action === '新增' || action === '新建模型' ? 'btn btn-primary' : 'btn btn-outline-secondary'}
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

        {message && <div className="toast success">{message}</div>}
        {error && <div className="toast error">{error}</div>}
      </main>
    </div>
  )
}

export default App

import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

const menuItems = [
  { key: 'dashboard', label: '系统总览' },
  { key: 'insights', label: '库存仪表盘' },
  { key: 'products', label: '商品管理' },
  { key: 'storage', label: '商品存放位置' },
  { key: 'usage', label: '商品使用位置' },
  { key: 'stockIn', label: '入库管理' },
  { key: 'stockOut', label: '出库管理' },
  { key: 'shipping', label: '发货管理' },
  { key: 'stocktake', label: '盘点管理' },
  { key: 'traceability', label: '批次与序列号' },
  { key: 'balances', label: '库存台账' },
  { key: 'ledger', label: '流水明细' },
  { key: 'operationLogs', label: '审计日志' },
]

const dashboardPeriodOptions = [7, 30, 90]
const showcasePalette = ['#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444']
const gridPageSizes = [20, 50, 100]
const showcaseRhythmOptions = [
  { key: 'slow', label: '慢节奏', intervalMs: 12000, motionScale: 1.35 },
  { key: 'normal', label: '标准', intervalMs: 9000, motionScale: 1 },
  { key: 'fast', label: '快节奏', intervalMs: 6000, motionScale: 0.78 },
]
const showcaseSlideCount = 3
const shippingTrackAutoRefreshIntervalMs = Math.max(
  5000,
  Number(import.meta.env.VITE_SHIPPING_TRACK_AUTO_REFRESH_INTERVAL_MS || 30000)
)

const emptyInsights = {
  days: 30,
  updatedAt: '',
  summary: {
    productCount: 0,
    storageLocationCount: 0,
    usageLocationCount: 0,
    balanceRecordCount: 0,
    inventoryTotalQty: 0,
    lowStockCount: 0,
  },
  metrics: {
    inQty: 0,
    outQty: 0,
    adjustQty: 0,
    netQty: 0,
    orderCount: 0,
  },
  trend: [],
  categoryDist: [],
  storageTop: [],
  usageTop: [],
  storageHeatmap: [],
  warningForecast: {
    baseLowStockCount: 0,
    predict7: 0,
    predict30: 0,
    dailyWarningDelta: 0,
    avgNet7: 0,
    avgNet30: 0,
    weightedDailyNet: 0,
    confidence: 0,
    direction: 'flat',
    points: [],
  },
  lowStockTop: [],
}

const defaultProductForm = {
  sku: '',
  name: '',
  category: '',
  unit: '件',
  safety_stock: 0,
}

const defaultStorageForm = {
  code: '',
  name: '',
  warehouse: '',
  area: '',
  shelf: '',
  slot: '',
  description: '',
}

const defaultUsageForm = {
  code: '',
  name: '',
  type: '部门',
  description: '',
}

const emptyStockInItem = () => ({
  product_id: '',
  storage_location_id: '',
  quantity: '',
  unit_cost: '',
  batch_no: '',
  serial_nos: '',
})

const toInputText = (value) => {
  if (value === undefined || value === null) return ''
  return String(value)
}

const buildStockInOrderForm = (order) => {
  const items = Array.isArray(order?.items)
    ? order.items.map((item) => ({
        product_id: toInputText(item.product_id),
        storage_location_id: toInputText(item.storage_location_id),
        quantity: toInputText(item.quantity),
        unit_cost: toInputText(item.unit_cost),
        batch_no: toInputText(item.batch_no),
        serial_nos: toInputText(item.serial_no),
      }))
    : []

  return {
    supplier: toInputText(order?.supplier),
    remark: toInputText(order?.remark),
    items: items.length ? items : [emptyStockInItem()],
  }
}

const emptyStockOutItem = () => ({
  product_id: '',
  storage_location_id: '',
  quantity: '',
  batch_no: '',
  serial_nos: '',
})

const emptyStocktakeItem = () => ({
  product_id: '',
  storage_location_id: '',
  counted_qty: '',
})

const emptyShippingItem = () => ({
  carrier: '',
  tracking_no: '',
  shipped_at: '',
  status: 'PENDING',
  remark: '',
})

const emptyShippingEditForm = {
  carrier: '',
  tracking_no: '',
  receiver_name: '',
  receiver_phone: '',
  receiver_address: '',
  shipped_at: '',
  status: 'PENDING',
  remark: '',
}

const parseApiDate = (value) => {
  if (!value) return '-'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const toDateTimeLocalInput = (value) => {
  if (!value) return ''
  const raw = String(value).replace(' ', 'T')
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return raw.length >= 16 ? raw.slice(0, 16) : ''
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

const buildShippingEditForm = (row) => ({
  carrier: toInputText(row?.carrier),
  tracking_no: toInputText(row?.tracking_no),
  receiver_name: toInputText(row?.receiver_name),
  receiver_phone: toInputText(row?.receiver_phone),
  receiver_address: toInputText(row?.receiver_address),
  shipped_at: toDateTimeLocalInput(row?.shipped_at),
  status: toInputText(row?.status || 'PENDING') || 'PENDING',
  remark: toInputText(row?.remark),
})

const escapeHtml = (value) =>
  String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const formatNum = (value) => {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}

const toNumber = (value) => {
  const num = Number(value || 0)
  return Number.isFinite(num) ? num : 0
}

const formatSignedNum = (value) => {
  const num = toNumber(value)
  if (num > 0) return `+${formatNum(num)}`
  if (num < 0) return `-${formatNum(Math.abs(num))}`
  return '0'
}

const formatDayLabel = (value) => {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}/${date.getDate()}`
}

const roleLabelMap = {
  admin: '管理员',
  sysadmin: '系统管理员',
  auditor: '审计员',
}

const changeTypeLabelMap = {
  IN: '入库',
  OUT: '出库',
  ADJUST: '调整',
}

const refTypeLabelMap = {
  STOCK_IN: '入库单',
  STOCK_OUT: '出库单',
  STOCKTAKE: '盘点单',
  STOCK_IN_EDIT: '入库单编辑',
}

const stocktakeStatusLabelMap = {
  POSTED: '已过账',
}

const shippingStatusLabelMap = {
  PENDING: '待发货',
  SHIPPED: '已发货',
  IN_TRANSIT: '运输中',
  SIGNED: '已签收',
  EXCEPTION: '异常',
}
const serialStatusLabelMap = {
  IN_STOCK: '在库',
  OUT_STOCK: '已出库',
}

const auditActionLabelMap = {
  PRODUCT_CREATE: '新建商品',
  PRODUCT_UPDATE: '更新商品',
  PRODUCT_DELETE: '删除商品',
  STORAGE_LOCATION_CREATE: '新建存放位置',
  STORAGE_LOCATION_UPDATE: '更新存放位置',
  STORAGE_LOCATION_DELETE: '删除存放位置',
  USAGE_LOCATION_CREATE: '新建使用位置',
  USAGE_LOCATION_UPDATE: '更新使用位置',
  USAGE_LOCATION_DELETE: '删除使用位置',
  STOCK_IN_CREATE: '创建入库单',
  STOCK_IN_UPDATE: '编辑入库单',
  STOCK_OUT_CREATE: '创建出库单',
  STOCKTAKE_CREATE: '创建盘点单',
  SHIPPING_CREATE: '创建发货单',
  SHIPPING_UPDATE: '更新发货单',
}

const auditEntityLabelMap = {
  product: '商品',
  storage_location: '存放位置',
  usage_location: '使用位置',
  stock_in_order: '入库单',
  stock_out_order: '出库单',
  stocktake_order: '盘点单',
  shipping_order: '发货单',
}

const formatRoleLabel = (value) => {
  const key = String(value || '').toLowerCase()
  return roleLabelMap[key] || '未知角色'
}

const formatChangeTypeLabel = (value) => {
  const key = String(value || '').toUpperCase()
  return changeTypeLabelMap[key] || '其他'
}

const formatRefTypeLabel = (refType, refId) => {
  const key = String(refType || '').toUpperCase()
  const label = refTypeLabelMap[key] || '其他来源'
  const id = String(refId === undefined || refId === null ? '' : refId).trim()
  return id ? `${label} #${id}` : label
}

const formatStocktakeStatusLabel = (status) => {
  const key = String(status || '').toUpperCase()
  return stocktakeStatusLabelMap[key] || '未知状态'
}

const formatShippingStatusLabel = (status) => {
  const key = String(status || '').toUpperCase()
  return shippingStatusLabelMap[key] || '未知状态'
}
const formatSerialStatusLabel = (status) => {
  const key = String(status || '').toUpperCase()
  return serialStatusLabelMap[key] || '未知状态'
}

const shippingStatusClassName = (status) => {
  const key = String(status || '').toLowerCase()
  if (key === 'in_transit') return 'in-transit'
  return key || 'pending'
}

const formatAuditActionLabel = (action) => {
  const key = String(action || '').toUpperCase()
  return auditActionLabelMap[key] || '其他动作'
}

const formatAuditEntityLabel = (entity) => {
  const key = String(entity || '').toLowerCase()
  return auditEntityLabelMap[key] || '其他实体'
}

const formatAuditPayload = (value) => {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch (_err) {
      return String(value)
    }
  }
  const raw = String(value)
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch (_err) {
    return raw
  }
}

const parseDownloadFilename = (contentDisposition) => {
  const text = String(contentDisposition || '')
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i)
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1])
    } catch (_err) {
      return utfMatch[1]
    }
  }
  const basicMatch = text.match(/filename="?([^";]+)"?/i)
  return basicMatch?.[1] || ''
}

const buildLinePoints = (values, width, height, maxValue, padding = 14) => {
  if (!Array.isArray(values) || values.length === 0) return ''
  const safeMax = Math.max(toNumber(maxValue), 1)
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2
  return values
    .map((raw, index) => {
      const value = Math.max(0, toNumber(raw))
      const ratio = values.length === 1 ? 0 : index / (values.length - 1)
      const x = padding + chartWidth * ratio
      const y = padding + chartHeight - (value / safeMax) * chartHeight
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

const buildAreaPath = (values, width, height, maxValue, padding = 14) => {
  if (!Array.isArray(values) || values.length === 0) return ''
  const safeMax = Math.max(toNumber(maxValue), 1)
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2
  const baseY = (padding + chartHeight).toFixed(2)
  const points = values.map((raw, index) => {
    const value = Math.max(0, toNumber(raw))
    const ratio = values.length === 1 ? 0 : index / (values.length - 1)
    const x = padding + chartWidth * ratio
    const y = padding + chartHeight - (value / safeMax) * chartHeight
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  if (points.length === 0) return ''
  const firstX = points[0].split(',')[0]
  const lastX = points[points.length - 1].split(',')[0]
  return `M ${firstX} ${baseY} L ${points.join(' L ')} L ${lastX} ${baseY} Z`
}

const buildDonutGradient = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return 'conic-gradient(#e2e8f0 0% 100%)'
  const total = rows.reduce((sum, row) => sum + toNumber(row.total_qty), 0)
  if (total <= 0) return 'conic-gradient(#e2e8f0 0% 100%)'
  let start = 0
  const segments = rows.map((row, index) => {
    const percentage = (toNumber(row.total_qty) / total) * 100
    const end = Math.min(100, start + percentage)
    const color = showcasePalette[index % showcasePalette.length]
    const segment = `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
    start = end
    return segment
  })
  if (start < 100) {
    segments.push(`#e2e8f0 ${start.toFixed(2)}% 100%`)
  }
  return `conic-gradient(${segments.join(', ')})`
}

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

function App() {
  const [token, setToken] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState(null)
  const [logoutPending, setLogoutPending] = useState(false)
  const [activeMenu, setActiveMenu] = useState('dashboard')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [summary, setSummary] = useState({
    productCount: 0,
    storageLocationCount: 0,
    usageLocationCount: 0,
    balanceRecordCount: 0,
    inventoryTotalQty: 0,
    lowStockCount: 0,
  })
  const [insightsDays, setInsightsDays] = useState(30)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insights, setInsights] = useState({ ...emptyInsights })
  const [showcaseMode, setShowcaseMode] = useState(false)
  const [showcaseAutoPlay, setShowcaseAutoPlay] = useState(false)
  const [showcaseRhythm, setShowcaseRhythm] = useState('normal')
  const [showcaseSlide, setShowcaseSlide] = useState(0)
  const [showcaseFullscreen, setShowcaseFullscreen] = useState(false)
  const insightsStageRef = useRef(null)

  const [products, setProducts] = useState([])
  const [storageLocations, setStorageLocations] = useState([])
  const [usageLocations, setUsageLocations] = useState([])

  const [balances, setBalances] = useState([])
  const [lowStockRows, setLowStockRows] = useState([])
  const [ledgerRows, setLedgerRows] = useState([])
  const [batchRows, setBatchRows] = useState([])
  const [serialRows, setSerialRows] = useState([])

  const [stockInOrders, setStockInOrders] = useState([])
  const [stockOutOrders, setStockOutOrders] = useState([])
  const [stocktakeOrders, setStocktakeOrders] = useState([])
  const [shippingOrders, setShippingOrders] = useState([])

  const [productForm, setProductForm] = useState({ ...defaultProductForm })
  const [storageForm, setStorageForm] = useState({ ...defaultStorageForm })
  const [usageForm, setUsageForm] = useState({ ...defaultUsageForm })

  const [stockInForm, setStockInForm] = useState({
    supplier: '',
    remark: '',
    items: [emptyStockInItem()],
  })
  const [stockInEditOpen, setStockInEditOpen] = useState(false)
  const [stockInEditLoading, setStockInEditLoading] = useState(false)
  const [stockInEditSaving, setStockInEditSaving] = useState(false)
  const [stockInEditOrderId, setStockInEditOrderId] = useState(0)
  const [stockInEditOrderNo, setStockInEditOrderNo] = useState('')
  const [stockInEditForm, setStockInEditForm] = useState({
    supplier: '',
    remark: '',
    items: [emptyStockInItem()],
  })
  const [stockInEditPosition, setStockInEditPosition] = useState({ x: 0, y: 0 })
  const [stockInEditDragging, setStockInEditDragging] = useState(false)
  const stockInEditDialogRef = useRef(null)
  const stockInEditDragRef = useRef(null)

  const [stockOutForm, setStockOutForm] = useState({
    usage_location_id: '',
    purpose: '',
    remark: '',
    items: [emptyStockOutItem()],
  })

  const [stocktakeForm, setStocktakeForm] = useState({
    remark: '',
    items: [emptyStocktakeItem()],
  })

  const [shippingForm, setShippingForm] = useState({
    stock_out_order_id: '',
    receiver_name: '',
    receiver_phone: '',
    receiver_address: '',
    items: [emptyShippingItem()],
  })
  const [shippingEditOpen, setShippingEditOpen] = useState(false)
  const [shippingEditLoading, setShippingEditLoading] = useState(false)
  const [shippingEditSaving, setShippingEditSaving] = useState(false)
  const [shippingEditOrderId, setShippingEditOrderId] = useState(0)
  const [shippingEditOrderNo, setShippingEditOrderNo] = useState('')
  const [shippingEditForm, setShippingEditForm] = useState({ ...emptyShippingEditForm })
  const [shippingEditPosition, setShippingEditPosition] = useState({ x: 0, y: 0 })
  const [shippingEditDragging, setShippingEditDragging] = useState(false)
  const shippingEditDialogRef = useRef(null)
  const shippingEditDragRef = useRef(null)
  const [shippingTrackOpen, setShippingTrackOpen] = useState(false)
  const [shippingTrackLoading, setShippingTrackLoading] = useState(false)
  const [shippingTrackOrder, setShippingTrackOrder] = useState(null)
  const [shippingTrackEvents, setShippingTrackEvents] = useState([])
  const [shippingTrackAutoRefresh, setShippingTrackAutoRefresh] = useState(true)
  const [shippingTrackLiveMeta, setShippingTrackLiveMeta] = useState({
    enabled: false,
    fetched: 0,
    inserted: 0,
    error: '',
  })
  const shippingTrackRefreshingRef = useRef(false)
  const [shippingDetailOpen, setShippingDetailOpen] = useState(false)
  const [shippingDetailLoading, setShippingDetailLoading] = useState(false)
  const [shippingDetailOrder, setShippingDetailOrder] = useState(null)
  const [shippingDetailPosition, setShippingDetailPosition] = useState({ x: 0, y: 0 })
  const [shippingDetailDragging, setShippingDetailDragging] = useState(false)
  const shippingDetailDialogRef = useRef(null)
  const shippingDetailDragRef = useRef(null)
  const [shippingFilter, setShippingFilter] = useState({
    keyword: '',
    status: '',
    stock_out_order_id: '',
  })
  const [shippingPage, setShippingPage] = useState(1)
  const [shippingLimit, setShippingLimit] = useState(50)
  const [shippingTotal, setShippingTotal] = useState(0)

  const [balanceKeywordInput, setBalanceKeywordInput] = useState('')
  const [balanceKeyword, setBalanceKeyword] = useState('')
  const [balanceLowOnly, setBalanceLowOnly] = useState(false)
  const [balancePage, setBalancePage] = useState(1)
  const [balanceLimit, setBalanceLimit] = useState(50)
  const [balanceTotal, setBalanceTotal] = useState(0)

  const [ledgerFilter, setLedgerFilter] = useState({
    product_id: '',
    storage_location_id: '',
    change_type: '',
    batch_no: '',
    serial_no: '',
    from: '',
    to: '',
  })
  const [traceFilter, setTraceFilter] = useState({
    keyword: '',
    product_id: '',
    status: '',
    batch_no: '',
    serial_no: '',
  })
  const [ledgerPage, setLedgerPage] = useState(1)
  const [ledgerLimit, setLedgerLimit] = useState(50)
  const [ledgerTotal, setLedgerTotal] = useState(0)
  const [operationLogs, setOperationLogs] = useState([])
  const [operationLogFilter, setOperationLogFilter] = useState({
    username: '',
    action: '',
    entity: '',
    keyword: '',
    from: '',
    to: '',
  })
  const [operationLogPage, setOperationLogPage] = useState(1)
  const [operationLogLimit, setOperationLogLimit] = useState(50)
  const [operationLogTotal, setOperationLogTotal] = useState(0)

  const currentTitle = useMemo(() => {
    return menuItems.find((item) => item.key === activeMenu)?.label || '库存管理'
  }, [activeMenu])
  const showcaseRhythmConfig = useMemo(() => {
    return showcaseRhythmOptions.find((item) => item.key === showcaseRhythm) || showcaseRhythmOptions[1]
  }, [showcaseRhythm])

  const canEditMaster = user?.role === 'admin' || user?.role === 'sysadmin'
  const canOperateInventory = user?.role === 'admin' || user?.role === 'sysadmin'
  const canViewAudit = user?.role === 'admin' || user?.role === 'sysadmin' || user?.role === 'auditor'
  const productStockMap = useMemo(() => {
    const map = new Map()
    products.forEach((item) => {
      map.set(String(item.id), {
        safetyStock: toNumber(item.safety_stock),
        currentStock: toNumber(item.total_qty),
      })
    })
    return map
  }, [products])
  const visibleMenuItems = useMemo(() => {
    return menuItems.filter((item) => item.key !== 'operationLogs' || canViewAudit)
  }, [canViewAudit])

  const clearTips = () => {
    setErrorMsg('')
    setSuccessMsg('')
  }

  const showError = (msg) => {
    setErrorMsg(msg || '操作失败')
    setSuccessMsg('')
  }

  const showSuccess = (msg) => {
    setSuccessMsg(msg || '操作成功')
    setErrorMsg('')
  }

  const apiRequest = async (path, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    let payload = null
    try {
      payload = await response.json()
    } catch (_err) {
      payload = null
    }

    if (!response.ok) {
      const errText = payload?.error || `请求失败 (${response.status})`
      if (response.status === 401) {
        setToken('')
        setUser(null)
      }
      throw new Error(errText)
    }

    if (options.withMeta) {
      return {
        data: payload,
        meta: {
          totalCount: Number(response.headers.get('x-total-count') || 0),
          page: Number(response.headers.get('x-page') || 0),
          limit: Number(response.headers.get('x-limit') || 0),
        },
      }
    }

    return payload
  }

  const refreshSummary = async () => {
    const data = await apiRequest('/api/dashboard/summary')
    setSummary(data || {})
  }

  const refreshDashboardInsights = async (days = insightsDays) => {
    const day = dashboardPeriodOptions.includes(Number(days)) ? Number(days) : 30
    const data = await apiRequest(`/api/dashboard/insights?days=${day}`)
    setInsights({
      ...emptyInsights,
      ...(data || {}),
      days: Number(data?.days || day),
      summary: {
        ...emptyInsights.summary,
        ...(data?.summary || {}),
      },
      metrics: {
        ...emptyInsights.metrics,
        ...(data?.metrics || {}),
      },
      trend: Array.isArray(data?.trend) ? data.trend : [],
      categoryDist: Array.isArray(data?.categoryDist) ? data.categoryDist : [],
      storageTop: Array.isArray(data?.storageTop) ? data.storageTop : [],
      usageTop: Array.isArray(data?.usageTop) ? data.usageTop : [],
      storageHeatmap: Array.isArray(data?.storageHeatmap) ? data.storageHeatmap : [],
      warningForecast: {
        ...emptyInsights.warningForecast,
        ...(data?.warningForecast || {}),
        points: Array.isArray(data?.warningForecast?.points) ? data.warningForecast.points : [],
      },
      lowStockTop: Array.isArray(data?.lowStockTop) ? data.lowStockTop : [],
    })
  }

  const refreshProducts = async () => {
    const data = await apiRequest('/api/products?include_inactive=1')
    setProducts(Array.isArray(data) ? data : [])
  }

  const refreshStorage = async () => {
    const data = await apiRequest('/api/storage-locations?include_inactive=1')
    setStorageLocations(Array.isArray(data) ? data : [])
  }

  const refreshUsage = async () => {
    const data = await apiRequest('/api/usage-locations?include_inactive=1')
    setUsageLocations(Array.isArray(data) ? data : [])
  }

  const refreshBalances = async () => {
    const params = new URLSearchParams()
    if (balanceKeyword) params.set('keyword', balanceKeyword)
    if (balanceLowOnly) params.set('low_stock', '1')
    params.set('page', String(balancePage))
    params.set('limit', String(balanceLimit))
    const result = await apiRequest(`/api/inventory/balances?${params.toString()}`, { withMeta: true })
    const data = result?.data
    setBalances(Array.isArray(data) ? data : [])
    setBalanceTotal(Number(result?.meta?.totalCount || 0))
  }

  const refreshLowStock = async () => {
    const data = await apiRequest('/api/inventory/low-stock')
    setLowStockRows(Array.isArray(data) ? data : [])
  }

  const buildOperationLogQueryParams = (withPaging = true) => {
    const params = new URLSearchParams()
    if (operationLogFilter.username) params.set('username', operationLogFilter.username)
    if (operationLogFilter.action) params.set('action', operationLogFilter.action)
    if (operationLogFilter.entity) params.set('entity', operationLogFilter.entity)
    if (operationLogFilter.keyword) params.set('keyword', operationLogFilter.keyword)
    if (operationLogFilter.from) params.set('from', operationLogFilter.from)
    if (operationLogFilter.to) params.set('to', operationLogFilter.to)
    if (withPaging) {
      params.set('page', String(operationLogPage))
      params.set('limit', String(operationLogLimit))
    }
    return params
  }

  const refreshLedger = async () => {
    const params = new URLSearchParams()
    if (ledgerFilter.product_id) params.set('product_id', ledgerFilter.product_id)
    if (ledgerFilter.storage_location_id) params.set('storage_location_id', ledgerFilter.storage_location_id)
    if (ledgerFilter.change_type) params.set('change_type', ledgerFilter.change_type)
    if (ledgerFilter.batch_no) params.set('batch_no', ledgerFilter.batch_no)
    if (ledgerFilter.serial_no) params.set('serial_no', ledgerFilter.serial_no)
    if (ledgerFilter.from) params.set('from', ledgerFilter.from)
    if (ledgerFilter.to) params.set('to', ledgerFilter.to)
    params.set('page', String(ledgerPage))
    params.set('limit', String(ledgerLimit))
    const result = await apiRequest(`/api/inventory/ledger?${params.toString()}`, { withMeta: true })
    const data = result?.data
    setLedgerRows(Array.isArray(data) ? data : [])
    setLedgerTotal(Number(result?.meta?.totalCount || 0))
  }

  const refreshTraceability = async () => {
    const batchParams = new URLSearchParams()
    const serialParams = new URLSearchParams()
    if (traceFilter.keyword) {
      batchParams.set('keyword', traceFilter.keyword)
      serialParams.set('keyword', traceFilter.keyword)
    }
    if (traceFilter.product_id) {
      batchParams.set('product_id', traceFilter.product_id)
      serialParams.set('product_id', traceFilter.product_id)
    }
    if (traceFilter.batch_no) {
      batchParams.set('batch_no', traceFilter.batch_no)
      serialParams.set('batch_no', traceFilter.batch_no)
    }
    if (traceFilter.serial_no) {
      serialParams.set('serial_no', traceFilter.serial_no)
    }
    if (traceFilter.status) {
      serialParams.set('status', traceFilter.status)
    }
    batchParams.set('limit', '200')
    serialParams.set('limit', '200')
    const [batchResult, serialResult] = await Promise.all([
      apiRequest(`/api/inventory/batch-balances?${batchParams.toString()}`, { withMeta: true }),
      apiRequest(`/api/inventory/serial-numbers?${serialParams.toString()}`, { withMeta: true }),
    ])
    setBatchRows(Array.isArray(batchResult?.data) ? batchResult.data : [])
    setSerialRows(Array.isArray(serialResult?.data) ? serialResult.data : [])
  }

  const refreshOperationLogs = async () => {
    const params = buildOperationLogQueryParams(true)
    const result = await apiRequest(`/api/operation-logs?${params.toString()}`, { withMeta: true })
    const data = result?.data
    setOperationLogs(Array.isArray(data) ? data : [])
    setOperationLogTotal(Number(result?.meta?.totalCount || 0))
  }

  const onExportOperationLogs = async () => {
    if (!canViewAudit) return showError('当前角色无权限导出审计日志')

    try {
      setBusy(true)
      const params = buildOperationLogQueryParams(false)
      params.set('max_rows', '10000')
      const response = await fetch(`${API_BASE}/api/operation-logs/export.csv?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        let message = `导出失败 (${response.status})`
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch (_err) {
          // ignore
        }
        if (response.status === 401) {
          setToken('')
          setUser(null)
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition')
      const fileName = parseDownloadFilename(disposition) || `inventory-operation-logs-${Date.now()}.csv`
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(objectUrl)
      showSuccess('审计日志导出成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const refreshOrderLists = async () => {
    const [ins, outs, takes] = await Promise.all([
      apiRequest('/api/inventory/stock-in-orders?limit=80'),
      apiRequest('/api/inventory/stock-out-orders?limit=80'),
      apiRequest('/api/inventory/stocktake-orders?limit=80'),
    ])
    setStockInOrders(Array.isArray(ins) ? ins : [])
    setStockOutOrders(Array.isArray(outs) ? outs : [])
    setStocktakeOrders(Array.isArray(takes) ? takes : [])
  }

  const refreshShippingOrders = async () => {
    const params = new URLSearchParams()
    if (shippingFilter.keyword) params.set('keyword', shippingFilter.keyword)
    if (shippingFilter.status) params.set('status', shippingFilter.status)
    if (shippingFilter.stock_out_order_id) params.set('stock_out_order_id', shippingFilter.stock_out_order_id)
    params.set('page', String(shippingPage))
    params.set('limit', String(shippingLimit))
    const result = await apiRequest(`/api/inventory/shipping-orders?${params.toString()}`, { withMeta: true })
    const data = result?.data
    setShippingOrders(Array.isArray(data) ? data : [])
    setShippingTotal(Number(result?.meta?.totalCount || 0))
  }

  const refreshAll = async () => {
    setLoading(true)
    try {
      const tasks = [
        refreshSummary(),
        refreshDashboardInsights(insightsDays),
        refreshProducts(),
        refreshStorage(),
        refreshUsage(),
        refreshBalances(),
        refreshLowStock(),
        refreshLedger(),
        refreshTraceability(),
        refreshOrderLists(),
        refreshShippingOrders(),
      ]
      if (canViewAudit) {
        tasks.push(refreshOperationLogs())
      }
      await Promise.all(tasks)
      clearTips()
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const refreshInsightsPanel = async (days = insightsDays) => {
    setInsightsLoading(true)
    try {
      await refreshDashboardInsights(days)
    } finally {
      setInsightsLoading(false)
    }
  }

  const refreshCurrentUser = async () => {
    const data = await apiRequest('/api/auth/me')
    setUser(data || null)
    return data
  }

  useEffect(() => {
    let cancelled = false
    const bootstrapAuth = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
        if (!response.ok) return
        const data = await response.json()
        if (cancelled) return
        if (data?.id) {
          setToken('cookie')
          setUser(data)
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
    if (token) return
    const timer = setTimeout(() => {
      window.location.href = buildPortalEntryUrl('inventory')
    }, logoutPending ? 900 : 120)
    return () => clearTimeout(timer)
  }, [authReady, token, logoutPending])

  useEffect(() => {
    if (!token || !logoutPending) return
    setLogoutPending(false)
  }, [token, logoutPending])

  useEffect(() => {
    if (!token) return
    refreshCurrentUser()
      .then(() => refreshAll())
      .catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    const timer = setTimeout(() => {
      setBalanceKeyword((balanceKeywordInput || '').trim())
    }, 260)
    return () => clearTimeout(timer)
  }, [balanceKeywordInput])

  useEffect(() => {
    if (!token) return
    refreshBalances().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceKeyword, balanceLowOnly, balancePage, balanceLimit])

  useEffect(() => {
    if (!token) return
    refreshLedger().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerFilter, ledgerPage, ledgerLimit])

  useEffect(() => {
    if (!token) return
    refreshTraceability().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, traceFilter])

  useEffect(() => {
    if (!token) return
    refreshShippingOrders().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingFilter, shippingPage, shippingLimit])

  useEffect(() => {
    if (!token || !canViewAudit) return
    refreshOperationLogs().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canViewAudit, operationLogFilter, operationLogPage, operationLogLimit])

  useEffect(() => {
    if (!token) return
    if (activeMenu !== 'insights') return
    refreshInsightsPanel(insightsDays)
      .catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeMenu, insightsDays])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(Math.max(balanceTotal, 0) / balanceLimit))
    if (balancePage > maxPage) setBalancePage(maxPage)
  }, [balanceTotal, balanceLimit, balancePage])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(Math.max(ledgerTotal, 0) / ledgerLimit))
    if (ledgerPage > maxPage) setLedgerPage(maxPage)
  }, [ledgerTotal, ledgerLimit, ledgerPage])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(Math.max(shippingTotal, 0) / shippingLimit))
    if (shippingPage > maxPage) setShippingPage(maxPage)
  }, [shippingTotal, shippingLimit, shippingPage])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(Math.max(operationLogTotal, 0) / operationLogLimit))
    if (operationLogPage > maxPage) setOperationLogPage(maxPage)
  }, [operationLogTotal, operationLogLimit, operationLogPage])

  useEffect(() => {
    if (visibleMenuItems.some((item) => item.key === activeMenu)) return
    setActiveMenu('dashboard')
  }, [visibleMenuItems, activeMenu])

  useEffect(() => {
    const onFullscreenChange = () => {
      setShowcaseFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (activeMenu !== 'insights' || !showcaseMode || !showcaseAutoPlay) return
    const timer = setInterval(() => {
      setShowcaseSlide((prev) => (prev + 1) % showcaseSlideCount)
    }, showcaseRhythmConfig.intervalMs)
    return () => clearInterval(timer)
  }, [activeMenu, showcaseMode, showcaseAutoPlay, showcaseRhythmConfig.intervalMs])

  useEffect(() => {
    if (activeMenu === 'insights') return
    setShowcaseAutoPlay(false)
    setShowcaseSlide(0)
  }, [activeMenu])

  useEffect(() => {
    if (!stockInEditOpen) return
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (stockInEditSaving) return
      setStockInEditOpen(false)
      setStockInEditDragging(false)
      stockInEditDragRef.current = null
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [stockInEditOpen, stockInEditSaving])

  useEffect(() => {
    if (!stockInEditDragging) return

    const onPointerMove = (event) => {
      const drag = stockInEditDragRef.current
      if (!drag) return
      if (Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const rawX = drag.originX + deltaX
      const rawY = drag.originY + deltaY
      const limitX = Math.max(0, (window.innerWidth - drag.width) / 2 - 20)
      const limitY = Math.max(0, (window.innerHeight - drag.height) / 2 - 20)

      setStockInEditPosition({
        x: Math.max(-limitX, Math.min(limitX, rawX)),
        y: Math.max(-limitY, Math.min(limitY, rawY)),
      })
    }

    const onPointerUp = (event) => {
      const drag = stockInEditDragRef.current
      if (drag && Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return
      setStockInEditDragging(false)
      stockInEditDragRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [stockInEditDragging])

  useEffect(() => {
    if (!shippingEditOpen) return
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (shippingEditSaving) return
      setShippingEditOpen(false)
      setShippingEditDragging(false)
      shippingEditDragRef.current = null
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shippingEditOpen, shippingEditSaving])

  useEffect(() => {
    if (!shippingEditDragging) return

    const onPointerMove = (event) => {
      const drag = shippingEditDragRef.current
      if (!drag) return
      if (Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const rawX = drag.originX + deltaX
      const rawY = drag.originY + deltaY
      const limitX = Math.max(0, (window.innerWidth - drag.width) / 2 - 20)
      const limitY = Math.max(0, (window.innerHeight - drag.height) / 2 - 20)

      setShippingEditPosition({
        x: Math.max(-limitX, Math.min(limitX, rawX)),
        y: Math.max(-limitY, Math.min(limitY, rawY)),
      })
    }

    const onPointerUp = (event) => {
      const drag = shippingEditDragRef.current
      if (drag && Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return
      setShippingEditDragging(false)
      shippingEditDragRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [shippingEditDragging])

  useEffect(() => {
    if (!shippingTrackOpen) return
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setShippingTrackOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shippingTrackOpen])

  useEffect(() => {
    if (shippingTrackOpen) return
    shippingTrackRefreshingRef.current = false
  }, [shippingTrackOpen])

  useEffect(() => {
    if (!shippingTrackOpen || !shippingTrackAutoRefresh) return
    const shippingOrderId = Number(shippingTrackOrder?.id || 0)
    if (!shippingOrderId) return

    const timer = setInterval(() => {
      const useLive = Boolean(shippingTrackLiveMeta.enabled)
      onRefreshShippingTrack(useLive)
    }, shippingTrackAutoRefreshIntervalMs)

    return () => clearInterval(timer)
  }, [shippingTrackOpen, shippingTrackAutoRefresh, shippingTrackOrder?.id, shippingTrackLiveMeta.enabled])

  useEffect(() => {
    if (!shippingDetailOpen) return
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setShippingDetailOpen(false)
      setShippingDetailDragging(false)
      shippingDetailDragRef.current = null
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shippingDetailOpen])

  useEffect(() => {
    if (!shippingDetailDragging) return

    const onPointerMove = (event) => {
      const drag = shippingDetailDragRef.current
      if (!drag) return
      if (Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const rawX = drag.originX + deltaX
      const rawY = drag.originY + deltaY
      const limitX = Math.max(0, (window.innerWidth - drag.width) / 2 - 20)
      const limitY = Math.max(0, (window.innerHeight - drag.height) / 2 - 20)

      setShippingDetailPosition({
        x: Math.max(-limitX, Math.min(limitX, rawX)),
        y: Math.max(-limitY, Math.min(limitY, rawY)),
      })
    }

    const onPointerUp = (event) => {
      const drag = shippingDetailDragRef.current
      if (drag && Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return
      setShippingDetailDragging(false)
      shippingDetailDragRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [shippingDetailDragging])

  const toggleShowcaseFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      const host = insightsStageRef.current || document.documentElement
      if (!host?.requestFullscreen) {
        showError('当前浏览器不支持全屏模式')
        return
      }
      await host.requestFullscreen()
    } catch (_err) {
      showError('切换全屏失败，请检查浏览器权限')
    }
  }

  const stepShowcaseSlide = (direction) => {
    const delta = direction >= 0 ? 1 : -1
    setShowcaseSlide((prev) => {
      const next = prev + delta
      if (next < 0) return showcaseSlideCount - 1
      if (next >= showcaseSlideCount) return 0
      return next
    })
  }

  const onLogout = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
    setLogoutPending(true)
    setToken('')
    setUser(null)
    setProducts([])
    setStorageLocations([])
    setUsageLocations([])
    setBalances([])
    setLedgerRows([])
    setStockInOrders([])
    setStockOutOrders([])
    setStocktakeOrders([])
    setShippingOrders([])
    setLowStockRows([])
    setBalanceKeywordInput('')
    setBalanceKeyword('')
    setBalanceLowOnly(false)
    setBalancePage(1)
    setBalanceLimit(50)
    setBalanceTotal(0)
    setLedgerPage(1)
    setLedgerLimit(50)
    setLedgerTotal(0)
    setOperationLogs([])
    setOperationLogFilter({
      username: '',
      action: '',
      entity: '',
      keyword: '',
      from: '',
      to: '',
    })
    setOperationLogPage(1)
    setOperationLogLimit(50)
    setOperationLogTotal(0)
    setInsights({ ...emptyInsights })
    setInsightsLoading(false)
    setInsightsDays(30)
    setShowcaseMode(false)
    setShowcaseAutoPlay(false)
    setShowcaseRhythm('normal')
    setShowcaseSlide(0)
    setShowcaseFullscreen(false)
    setStockInEditOpen(false)
    setStockInEditLoading(false)
    setStockInEditSaving(false)
    setStockInEditOrderId(0)
    setStockInEditOrderNo('')
    setStockInEditForm({
      supplier: '',
      remark: '',
      items: [emptyStockInItem()],
    })
    setStockInEditPosition({ x: 0, y: 0 })
    setStockInEditDragging(false)
    stockInEditDragRef.current = null
    setShippingForm({
      stock_out_order_id: '',
      receiver_name: '',
      receiver_phone: '',
      receiver_address: '',
      items: [emptyShippingItem()],
    })
    setShippingFilter({
      keyword: '',
      status: '',
      stock_out_order_id: '',
    })
    setShippingPage(1)
    setShippingLimit(50)
    setShippingTotal(0)
    setShippingEditOpen(false)
    setShippingEditLoading(false)
    setShippingEditSaving(false)
    setShippingEditOrderId(0)
    setShippingEditOrderNo('')
    setShippingEditForm({ ...emptyShippingEditForm })
    setShippingEditPosition({ x: 0, y: 0 })
    setShippingEditDragging(false)
    shippingEditDragRef.current = null
    setShippingTrackOpen(false)
    setShippingTrackLoading(false)
    setShippingTrackOrder(null)
    setShippingTrackEvents([])
    setShippingTrackAutoRefresh(true)
    setShippingTrackLiveMeta({
      enabled: false,
      fetched: 0,
      inserted: 0,
      error: '',
    })
    shippingTrackRefreshingRef.current = false
    setShippingDetailOpen(false)
    setShippingDetailLoading(false)
    setShippingDetailOrder(null)
    setShippingDetailPosition({ x: 0, y: 0 })
    setShippingDetailDragging(false)
    shippingDetailDragRef.current = null
    clearTips()
  }

  const withBusy = async (fn, successMsgText) => {
    try {
      setBusy(true)
      await fn()
      if (successMsgText) showSuccess(successMsgText)
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onCreateProduct = async (event) => {
    event.preventDefault()
    if (!canEditMaster) return showError('当前角色无权限维护商品主数据')
    await withBusy(async () => {
      await apiRequest('/api/products', {
        method: 'POST',
        body: {
          ...productForm,
          safety_stock: Number(productForm.safety_stock || 0),
        },
      })
      setProductForm({ ...defaultProductForm })
      await Promise.all([refreshProducts(), refreshSummary(), refreshBalances(), refreshLowStock()])
    }, '商品已创建')
  }

  const onToggleProduct = async (item) => {
    if (!canEditMaster) return showError('当前角色无权限维护商品主数据')
    await withBusy(async () => {
      await apiRequest(`/api/products/${item.id}`, {
        method: 'PUT',
        body: {
          ...item,
          is_active: Number(item.is_active) === 1 ? 0 : 1,
        },
      })
      await Promise.all([refreshProducts(), refreshSummary(), refreshBalances(), refreshLowStock()])
    }, '商品状态已更新')
  }

  const onDeleteProduct = async (item) => {
    if (!canEditMaster) return showError('当前角色无权限维护商品主数据')
    if (!confirm(`确认删除商品【${item.name}】吗？`)) return
    await withBusy(async () => {
      await apiRequest(`/api/products/${item.id}`, { method: 'DELETE' })
      await Promise.all([refreshProducts(), refreshSummary(), refreshBalances(), refreshLowStock()])
    }, '商品已删除')
  }

  const onCreateStorage = async (event) => {
    event.preventDefault()
    if (!canEditMaster) return showError('当前角色无权限维护存放位置')
    await withBusy(async () => {
      await apiRequest('/api/storage-locations', {
        method: 'POST',
        body: storageForm,
      })
      setStorageForm({ ...defaultStorageForm })
      await Promise.all([refreshStorage(), refreshSummary(), refreshBalances(), refreshLedger()])
    }, '存放位置已创建')
  }

  const onToggleStorage = async (item) => {
    if (!canEditMaster) return showError('当前角色无权限维护存放位置')
    await withBusy(async () => {
      await apiRequest(`/api/storage-locations/${item.id}`, {
        method: 'PUT',
        body: {
          ...item,
          is_active: Number(item.is_active) === 1 ? 0 : 1,
        },
      })
      await Promise.all([refreshStorage(), refreshSummary(), refreshBalances(), refreshLedger()])
    }, '存放位置状态已更新')
  }

  const onDeleteStorage = async (item) => {
    if (!canEditMaster) return showError('当前角色无权限维护存放位置')
    if (!confirm(`确认删除存放位置【${item.code}】吗？`)) return
    await withBusy(async () => {
      await apiRequest(`/api/storage-locations/${item.id}`, { method: 'DELETE' })
      await Promise.all([refreshStorage(), refreshSummary(), refreshBalances(), refreshLedger()])
    }, '存放位置已删除')
  }

  const onCreateUsage = async (event) => {
    event.preventDefault()
    if (!canEditMaster) return showError('当前角色无权限维护使用位置')
    await withBusy(async () => {
      await apiRequest('/api/usage-locations', {
        method: 'POST',
        body: usageForm,
      })
      setUsageForm({ ...defaultUsageForm })
      await Promise.all([refreshUsage(), refreshSummary(), refreshLedger()])
    }, '使用位置已创建')
  }

  const onToggleUsage = async (item) => {
    if (!canEditMaster) return showError('当前角色无权限维护使用位置')
    await withBusy(async () => {
      await apiRequest(`/api/usage-locations/${item.id}`, {
        method: 'PUT',
        body: {
          ...item,
          is_active: Number(item.is_active) === 1 ? 0 : 1,
        },
      })
      await Promise.all([refreshUsage(), refreshSummary(), refreshLedger()])
    }, '使用位置状态已更新')
  }

  const onDeleteUsage = async (item) => {
    if (!canEditMaster) return showError('当前角色无权限维护使用位置')
    if (!confirm(`确认删除使用位置【${item.code}】吗？`)) return
    await withBusy(async () => {
      await apiRequest(`/api/usage-locations/${item.id}`, { method: 'DELETE' })
      await Promise.all([refreshUsage(), refreshSummary(), refreshLedger()])
    }, '使用位置已删除')
  }

  const updateStockInItem = (index, key, value) => {
    setStockInForm((prev) => {
      const items = [...prev.items]
      items[index] = { ...items[index], [key]: value }
      return { ...prev, items }
    })
  }

  const updateStockInEditItem = (index, key, value) => {
    setStockInEditForm((prev) => {
      const items = [...prev.items]
      items[index] = { ...items[index], [key]: value }
      return { ...prev, items }
    })
  }

  const closeStockInEditModal = () => {
    if (stockInEditSaving) return
    setStockInEditOpen(false)
    setStockInEditDragging(false)
    stockInEditDragRef.current = null
  }

  const onStartStockInEditDrag = (event) => {
    if (event.button !== 0) return
    if (!stockInEditDialogRef.current) return
    event.preventDefault()
    const rect = stockInEditDialogRef.current.getBoundingClientRect()
    stockInEditDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: stockInEditPosition.x,
      originY: stockInEditPosition.y,
      width: rect.width,
      height: rect.height,
    }
    setStockInEditDragging(true)
  }

  const onOpenStockInEdit = async (row) => {
    if (!canOperateInventory) return showError('当前角色无权限编辑入库单')
    const orderId = Number(row?.id || 0)
    if (!orderId) return showError('入库单ID无效')
    setStockInEditOpen(true)
    setStockInEditLoading(true)
    setStockInEditSaving(false)
    setStockInEditDragging(false)
    stockInEditDragRef.current = null
    setStockInEditPosition({ x: 0, y: 0 })
    setStockInEditOrderId(orderId)
    setStockInEditOrderNo(row?.order_no || '')
    setStockInEditForm({
      supplier: '',
      remark: '',
      items: [emptyStockInItem()],
    })

    try {
      const data = await apiRequest(`/api/inventory/stock-in-orders/${orderId}`)
      setStockInEditOrderId(Number(data?.id || orderId))
      setStockInEditOrderNo(data?.order_no || row?.order_no || '')
      setStockInEditForm(buildStockInOrderForm(data))
    } catch (err) {
      setStockInEditOpen(false)
      showError(err.message)
    } finally {
      setStockInEditLoading(false)
    }
  }

  const updateStockOutItem = (index, key, value) => {
    setStockOutForm((prev) => {
      const items = [...prev.items]
      items[index] = { ...items[index], [key]: value }
      return { ...prev, items }
    })
  }

  const updateStocktakeItem = (index, key, value) => {
    setStocktakeForm((prev) => {
      const items = [...prev.items]
      items[index] = { ...items[index], [key]: value }
      return { ...prev, items }
    })
  }
  const updateLedgerFilter = (key, value) => {
    setLedgerPage(1)
    setLedgerFilter((prev) => ({ ...prev, [key]: value }))
  }
  const updateTraceFilter = (key, value) => {
    setTraceFilter((prev) => ({ ...prev, [key]: value }))
  }
  const updateOperationLogFilter = (key, value) => {
    setOperationLogPage(1)
    setOperationLogFilter((prev) => ({ ...prev, [key]: value }))
  }

  const onCreateStockIn = async (event) => {
    event.preventDefault()
    if (!canOperateInventory) return showError('当前角色无权限执行库存入库')
    await withBusy(async () => {
      await apiRequest('/api/inventory/stock-in', {
        method: 'POST',
        body: {
          supplier: stockInForm.supplier,
          remark: stockInForm.remark,
          items: stockInForm.items,
        },
      })
      setStockInForm({ supplier: '', remark: '', items: [emptyStockInItem()] })
      await Promise.all([
        refreshOrderLists(),
        refreshBalances(),
        refreshSummary(),
        refreshLedger(),
        refreshLowStock(),
        refreshProducts(),
      ])
    }, '入库成功')
  }

  const onSubmitStockInEdit = async (event) => {
    event.preventDefault()
    if (!canOperateInventory) return showError('当前角色无权限编辑入库单')
    if (!stockInEditOrderId) return showError('请选择入库单')

    try {
      setStockInEditSaving(true)
      await apiRequest(`/api/inventory/stock-in-orders/${stockInEditOrderId}`, {
        method: 'PUT',
        body: {
          supplier: stockInEditForm.supplier,
          remark: stockInEditForm.remark,
          items: stockInEditForm.items,
        },
      })
      await Promise.all([
        refreshOrderLists(),
        refreshBalances(),
        refreshSummary(),
        refreshLedger(),
        refreshLowStock(),
        refreshProducts(),
        refreshDashboardInsights(insightsDays),
      ])
      setStockInEditOpen(false)
      setStockInEditDragging(false)
      stockInEditDragRef.current = null
      showSuccess('入库单已更新')
    } catch (err) {
      showError(err.message)
    } finally {
      setStockInEditSaving(false)
    }
  }

  const onCreateStockOut = async (event) => {
    event.preventDefault()
    if (!canOperateInventory) return showError('当前角色无权限执行库存出库')
    await withBusy(async () => {
      await apiRequest('/api/inventory/stock-out', {
        method: 'POST',
        body: {
          usage_location_id: stockOutForm.usage_location_id,
          purpose: stockOutForm.purpose,
          remark: stockOutForm.remark,
          items: stockOutForm.items,
        },
      })
      setStockOutForm({ usage_location_id: '', purpose: '', remark: '', items: [emptyStockOutItem()] })
      await Promise.all([
        refreshOrderLists(),
        refreshBalances(),
        refreshSummary(),
        refreshLedger(),
        refreshLowStock(),
        refreshProducts(),
      ])
    }, '出库成功')
  }

  const onCreateStocktake = async (event) => {
    event.preventDefault()
    if (!canOperateInventory) return showError('当前角色无权限执行库存盘点')
    await withBusy(async () => {
      await apiRequest('/api/inventory/stocktake', {
        method: 'POST',
        body: {
          remark: stocktakeForm.remark,
          items: stocktakeForm.items,
        },
      })
      setStocktakeForm({ remark: '', items: [emptyStocktakeItem()] })
      await Promise.all([
        refreshOrderLists(),
        refreshBalances(),
        refreshSummary(),
        refreshLedger(),
        refreshLowStock(),
        refreshProducts(),
      ])
    }, '盘点调整已完成')
  }

  const updateShippingItem = (index, key, value) => {
    setShippingForm((prev) => {
      const items = [...prev.items]
      items[index] = { ...items[index], [key]: value }
      return { ...prev, items }
    })
  }

  const updateShippingFilter = (key, value) => {
    setShippingPage(1)
    setShippingFilter((prev) => ({ ...prev, [key]: value }))
  }

  const goShipFromStockOut = (row) => {
    const stockOutOrderId = String(row?.id || '')
    setActiveMenu('shipping')
    setShippingForm((prev) => ({
      ...prev,
      stock_out_order_id: stockOutOrderId,
      receiver_name: '',
      receiver_phone: '',
      receiver_address: '',
      items: [emptyShippingItem()],
    }))
    setShippingFilter((prev) => ({
      ...prev,
      stock_out_order_id: stockOutOrderId,
    }))
    setShippingPage(1)
  }

  const onCreateShippingBatch = async (event) => {
    event.preventDefault()
    if (!canOperateInventory) return showError('当前角色无权限执行发货操作')
    await withBusy(async () => {
      await apiRequest('/api/inventory/shipping-orders/batch', {
        method: 'POST',
        body: {
          stock_out_order_id: Number(shippingForm.stock_out_order_id || 0),
          receiver_name: shippingForm.receiver_name,
          receiver_phone: shippingForm.receiver_phone,
          receiver_address: shippingForm.receiver_address,
          shipments: shippingForm.items,
        },
      })
      setShippingForm({
        stock_out_order_id: shippingForm.stock_out_order_id,
        receiver_name: '',
        receiver_phone: '',
        receiver_address: '',
        items: [emptyShippingItem()],
      })
      await Promise.all([refreshShippingOrders(), refreshOrderLists()])
    }, '发货单已创建')
  }

  const updateShippingOrderById = async (shippingOrderId, payload, successText) => {
    const idNum = Number(shippingOrderId || 0)
    if (!canOperateInventory) return showError('当前角色无权限更新发货状态')
    if (!idNum) return showError('发货单ID无效')

    await withBusy(async () => {
      await apiRequest(`/api/inventory/shipping-orders/${idNum}`, {
        method: 'PUT',
        body: payload,
      })
      await Promise.all([refreshShippingOrders(), refreshOrderLists()])
      if (shippingDetailOpen && Number(shippingDetailOrder?.id || 0) === idNum) {
        const detail = await apiRequest(`/api/inventory/shipping-orders/${idNum}`)
        setShippingDetailOrder(detail || null)
      }
    }, successText)
  }

  const onUpdateShippingStatus = async (row, nextStatus) => {
    await updateShippingOrderById(row?.id, { status: nextStatus }, '发货状态已更新')
  }

  const onMarkShippingAbnormal = async (row) => {
    const reason = window.prompt('请输入异常说明（可选）', row?.remark || '')
    if (reason === null) return
    await updateShippingOrderById(
      row?.id,
      {
        status: 'EXCEPTION',
        remark: reason || '',
      },
      '发货状态已更新为异常'
    )
  }

  const closeShippingEditModal = () => {
    if (shippingEditSaving) return
    setShippingEditOpen(false)
    setShippingEditDragging(false)
    shippingEditDragRef.current = null
  }

  const onStartShippingEditDrag = (event) => {
    if (event.button !== 0) return
    if (!shippingEditDialogRef.current) return
    event.preventDefault()
    const rect = shippingEditDialogRef.current.getBoundingClientRect()
    shippingEditDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: shippingEditPosition.x,
      originY: shippingEditPosition.y,
      width: rect.width,
      height: rect.height,
    }
    setShippingEditDragging(true)
  }

  const closeShippingDetailModal = () => {
    setShippingDetailOpen(false)
    setShippingDetailDragging(false)
    shippingDetailDragRef.current = null
  }

  const onStartShippingDetailDrag = (event) => {
    if (event.button !== 0) return
    if (!shippingDetailDialogRef.current) return
    event.preventDefault()
    const rect = shippingDetailDialogRef.current.getBoundingClientRect()
    shippingDetailDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: shippingDetailPosition.x,
      originY: shippingDetailPosition.y,
      width: rect.width,
      height: rect.height,
    }
    setShippingDetailDragging(true)
  }

  const onOpenShippingDetail = async (row) => {
    const shippingOrderId = Number(row?.id || 0)
    if (!shippingOrderId) return showError('发货单ID无效')

    setShippingDetailOpen(true)
    setShippingDetailLoading(true)
    setShippingDetailOrder(null)
    setShippingDetailDragging(false)
    shippingDetailDragRef.current = null
    setShippingDetailPosition({ x: 0, y: 0 })

    try {
      const detail = await apiRequest(`/api/inventory/shipping-orders/${shippingOrderId}`)
      setShippingDetailOrder(detail || null)
    } catch (err) {
      setShippingDetailOpen(false)
      showError(err.message)
    } finally {
      setShippingDetailLoading(false)
    }
  }

  const onOpenShippingEdit = async (row) => {
    if (!canOperateInventory) return showError('当前角色无权限编辑发货单')
    const shippingOrderId = Number(row?.id || 0)
    if (!shippingOrderId) return showError('发货单ID无效')

    setShippingEditOpen(true)
    setShippingEditLoading(true)
    setShippingEditSaving(false)
    setShippingEditDragging(false)
    shippingEditDragRef.current = null
    setShippingEditPosition({ x: 0, y: 0 })
    setShippingEditOrderId(shippingOrderId)
    setShippingEditOrderNo(row?.shipment_no || '')
    setShippingEditForm({ ...emptyShippingEditForm })

    try {
      const detail = await apiRequest(`/api/inventory/shipping-orders/${shippingOrderId}`)
      setShippingEditOrderId(Number(detail?.id || shippingOrderId))
      setShippingEditOrderNo(detail?.shipment_no || row?.shipment_no || '')
      setShippingEditForm(buildShippingEditForm(detail))
    } catch (err) {
      setShippingEditOpen(false)
      showError(err.message)
    } finally {
      setShippingEditLoading(false)
    }
  }

  const onSubmitShippingEdit = async (event) => {
    event.preventDefault()
    if (!canOperateInventory) return showError('当前角色无权限编辑发货单')
    if (!shippingEditOrderId) return showError('请选择发货单')

    try {
      setShippingEditSaving(true)
      await apiRequest(`/api/inventory/shipping-orders/${shippingEditOrderId}`, {
        method: 'PUT',
        body: {
          carrier: shippingEditForm.carrier,
          tracking_no: shippingEditForm.tracking_no,
          receiver_name: shippingEditForm.receiver_name,
          receiver_phone: shippingEditForm.receiver_phone,
          receiver_address: shippingEditForm.receiver_address,
          shipped_at: shippingEditForm.shipped_at || null,
          status: shippingEditForm.status,
          remark: shippingEditForm.remark,
        },
      })
      await Promise.all([refreshShippingOrders(), refreshOrderLists()])
      if (shippingDetailOpen && Number(shippingDetailOrder?.id || 0) === Number(shippingEditOrderId)) {
        const detail = await apiRequest(`/api/inventory/shipping-orders/${shippingEditOrderId}`)
        setShippingDetailOrder(detail || null)
      }
      setShippingEditOpen(false)
      setShippingEditDragging(false)
      shippingEditDragRef.current = null
      showSuccess('发货单已更新')
    } catch (err) {
      showError(err.message)
    } finally {
      setShippingEditSaving(false)
    }
  }

  const loadShippingTracking = async (shippingOrderId, live = false) => {
    const suffix = live ? '?live=1' : ''
    const data = await apiRequest(`/api/inventory/shipping-orders/${shippingOrderId}/tracking${suffix}`)
    setShippingTrackOrder(data?.order || null)
    setShippingTrackEvents(Array.isArray(data?.events) ? data.events : [])
    setShippingTrackLiveMeta({
      enabled: Boolean(data?.live_sync?.enabled),
      fetched: Number(data?.live_sync?.fetched || 0),
      inserted: Number(data?.live_sync?.inserted || 0),
      error: toInputText(data?.live_sync?.error),
    })
  }

  const onOpenShippingTrack = async (row, live = false) => {
    const shippingOrderId = Number(row?.id || 0)
    if (!shippingOrderId) return showError('发货单ID无效')
    setShippingTrackOpen(true)
    setShippingTrackLoading(true)
    shippingTrackRefreshingRef.current = true
    setShippingTrackAutoRefresh(true)
    setShippingTrackOrder(null)
    setShippingTrackEvents([])
    setShippingTrackLiveMeta({
      enabled: false,
      fetched: 0,
      inserted: 0,
      error: '',
    })

    try {
      await loadShippingTracking(shippingOrderId, live)
    } catch (err) {
      setShippingTrackOpen(false)
      showError(err.message)
    } finally {
      setShippingTrackLoading(false)
      shippingTrackRefreshingRef.current = false
    }
  }

  const onRefreshShippingTrack = async (live = false) => {
    const shippingOrderId = Number(shippingTrackOrder?.id || 0)
    if (!shippingOrderId) return
    if (shippingTrackRefreshingRef.current) return
    try {
      shippingTrackRefreshingRef.current = true
      setShippingTrackLoading(true)
      await loadShippingTracking(shippingOrderId, live)
    } catch (err) {
      showError(err.message)
    } finally {
      setShippingTrackLoading(false)
      shippingTrackRefreshingRef.current = false
    }
  }

  const onPrintShipping = async (row) => {
    const shippingOrderId = Number(row?.id || 0)
    if (!shippingOrderId) return showError('发货单ID无效')
    try {
      setBusy(true)
      const [detail, tracking] = await Promise.all([
        apiRequest(`/api/inventory/shipping-orders/${shippingOrderId}`),
        apiRequest(`/api/inventory/shipping-orders/${shippingOrderId}/tracking`),
      ])
      const order = detail || {}
      const items = Array.isArray(detail?.stock_out_items) ? detail.stock_out_items : []
      const events = Array.isArray(tracking?.events) ? tracking.events : []
      const printWindow = window.open('', '_blank', 'width=980,height=760')
      if (!printWindow) {
        throw new Error('浏览器拦截了打印窗口，请允许弹窗后重试')
      }

      const itemRows = items
        .map(
          (item, index) => `<tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(item.sku || '-')}</td>
            <td>${escapeHtml(item.product_name || '-')}</td>
            <td>${escapeHtml(item.storage_location_code || '-')}</td>
            <td>${escapeHtml(item.storage_location_name || '-')}</td>
            <td>${escapeHtml(formatNum(item.quantity || 0))}</td>
            <td>${escapeHtml(item.unit || '件')}</td>
            <td>${escapeHtml(item.batch_no || '-')}</td>
            <td>${escapeHtml(item.serial_no || '-')}</td>
          </tr>`
        )
        .join('')

      const trackRows = events
        .map(
          (eventItem, index) => `<tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(parseApiDate(eventItem.event_time))}</td>
            <td>${escapeHtml(formatShippingStatusLabel(eventItem.status || order.status))}</td>
            <td>${escapeHtml(eventItem.location || '-')}</td>
            <td>${escapeHtml(eventItem.description || '-')}</td>
            <td>${escapeHtml(eventItem.source || '-')}</td>
          </tr>`
        )
        .join('')

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>发货单打印 ${escapeHtml(order.shipment_no || '')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif; margin: 18px; color: #0f172a; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 18px 0 8px; font-size: 16px; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px; font-size: 13px; margin-top: 10px; }
    .meta-item { background: #f8fafc; border: 1px solid #d9e2ec; border-radius: 8px; padding: 8px 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th, td { border: 1px solid #d9e2ec; padding: 7px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; }
    .footer { margin-top: 24px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; font-size: 13px; }
    .sign { border-top: 1px solid #94a3b8; padding-top: 6px; min-height: 28px; }
  </style>
</head>
<body>
  <h1>聚信库存系统 发货清单</h1>
  <div>打印时间：${escapeHtml(parseApiDate(new Date().toISOString()))}</div>
  <div class="meta">
    <div class="meta-item">发货单号：${escapeHtml(order.shipment_no || '-')}</div>
    <div class="meta-item">关联出库单：${escapeHtml(order.stock_out_order_no || '-')}</div>
    <div class="meta-item">物流公司：${escapeHtml(order.carrier || '-')}</div>
    <div class="meta-item">快递单号：${escapeHtml(order.tracking_no || '-')}</div>
    <div class="meta-item">发货状态：${escapeHtml(formatShippingStatusLabel(order.status))}</div>
    <div class="meta-item">发货时间：${escapeHtml(parseApiDate(order.shipped_at))}</div>
    <div class="meta-item">收货人：${escapeHtml(order.receiver_name || '-')}</div>
    <div class="meta-item">联系电话：${escapeHtml(order.receiver_phone || '-')}</div>
    <div class="meta-item" style="grid-column: 1 / span 2;">收货地址：${escapeHtml(order.receiver_address || '-')}</div>
    <div class="meta-item" style="grid-column: 1 / span 2;">备注：${escapeHtml(order.remark || '-')}</div>
  </div>

  <h2>发货商品明细</h2>
  <table>
    <thead>
      <tr><th>#</th><th>SKU</th><th>商品</th><th>库位编码</th><th>库位名称</th><th>数量</th><th>单位</th><th>批次号</th><th>序列号</th></tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="9">暂无明细</td></tr>'}
    </tbody>
  </table>

  <h2>物流轨迹</h2>
  <table>
    <thead>
      <tr><th>#</th><th>时间</th><th>状态</th><th>位置</th><th>节点信息</th><th>来源</th></tr>
    </thead>
    <tbody>
      ${trackRows || '<tr><td colspan="6">暂无轨迹数据</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <div><div class="sign">仓库签字：</div></div>
    <div><div class="sign">物流签字：</div></div>
    <div><div class="sign">收货签字：</div></div>
  </div>
</body>
</html>`

      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
      setTimeout(() => {
        printWindow.focus()
        printWindow.print()
      }, 200)
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const renderDashboard = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>库存总览</h2>
              <p>库存、位置与预警的一站式视图</p>
            </div>
            <div className="toolbar">
              <button className="btn" onClick={refreshAll} disabled={busy || loading} type="button">
                刷新数据
              </button>
            </div>
          </div>
          <div className="stats-grid">
            <article className="stat-card">
              <div className="label">商品数</div>
              <div className="value">{formatNum(summary.productCount)}</div>
            </article>
            <article className="stat-card">
              <div className="label">存放位置</div>
              <div className="value">{formatNum(summary.storageLocationCount)}</div>
            </article>
            <article className="stat-card">
              <div className="label">使用位置</div>
              <div className="value">{formatNum(summary.usageLocationCount)}</div>
            </article>
            <article className="stat-card">
              <div className="label">库存记录数</div>
              <div className="value">{formatNum(summary.balanceRecordCount)}</div>
            </article>
            <article className="stat-card">
              <div className="label">库存总量</div>
              <div className="value">{formatNum(summary.inventoryTotalQty)}</div>
            </article>
            <article className="stat-card">
              <div className="label">低库存预警</div>
              <div className="value">{formatNum(summary.lowStockCount)}</div>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>低库存预警</h2>
              <p>按缺口优先级排序，建议优先处理缺口最大的商品</p>
            </div>
            <div className="toolbar">
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => {
                  setBalanceLowOnly(true)
                  setActiveMenu('balances')
                }}
              >
                打开低库存台账
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>商品编码</th>
                  <th>商品</th>
                  <th>安全库存</th>
                  <th>当前库存</th>
                  <th>缺口数量</th>
                </tr>
              </thead>
              <tbody>
                {lowStockRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>暂无低库存项</td>
                  </tr>
                ) : (
                  lowStockRows.map((row) => {
                    const gapQty = Math.max(0, toNumber(row.safety_stock) - toNumber(row.total_qty))
                    return (
                      <tr key={row.product_id}>
                        <td>{row.sku}</td>
                        <td>{row.product_name}</td>
                        <td>{formatNum(row.safety_stock)}</td>
                        <td>{formatNum(row.total_qty)}</td>
                        <td>{formatNum(gapQty)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderInsights = () => {
    const insightSummary = insights.summary || emptyInsights.summary
    const metrics = insights.metrics || emptyInsights.metrics
    const trendRows = Array.isArray(insights.trend) ? insights.trend : []
    const categoryRows = Array.isArray(insights.categoryDist) ? insights.categoryDist : []
    const storageRows = Array.isArray(insights.storageTop) ? insights.storageTop : []
    const usageRows = Array.isArray(insights.usageTop) ? insights.usageTop : []
    const heatmapRows = Array.isArray(insights.storageHeatmap) ? insights.storageHeatmap : []
    const warningForecast = insights.warningForecast || emptyInsights.warningForecast
    const lowRiskRows = Array.isArray(insights.lowStockTop) ? insights.lowStockTop : []

    const trendChartWidth = 860
    const chartHeight = 260
    const inSeries = trendRows.map((row) => toNumber(row.in_qty))
    const outSeries = trendRows.map((row) => toNumber(row.out_qty))
    const adjustSeries = trendRows.map((row) => toNumber(row.adjust_qty))
    const trendMax = Math.max(1, ...inSeries, ...outSeries, ...adjustSeries)
    const inLine = buildLinePoints(inSeries, trendChartWidth, chartHeight, trendMax)
    const outLine = buildLinePoints(outSeries, trendChartWidth, chartHeight, trendMax)
    const adjustLine = buildLinePoints(adjustSeries, trendChartWidth, chartHeight, trendMax)
    const inArea = buildAreaPath(inSeries, trendChartWidth, chartHeight, trendMax)
    const outArea = buildAreaPath(outSeries, trendChartWidth, chartHeight, trendMax)
    const adjustArea = buildAreaPath(adjustSeries, trendChartWidth, chartHeight, trendMax)
    const donutBackground = buildDonutGradient(categoryRows)

    const maxStorageQty = Math.max(1, ...storageRows.map((row) => toNumber(row.total_qty)))
    const maxUsageQty = Math.max(1, ...usageRows.map((row) => toNumber(row.total_out_qty)))
    const displayDays = dashboardPeriodOptions.includes(Number(insightsDays)) ? insightsDays : 30
    const netValue = toNumber(metrics.netQty)

    const forecastRows = Array.isArray(warningForecast.points)
      ? [...warningForecast.points].sort((a, b) => toNumber(a.day_offset) - toNumber(b.day_offset))
      : []
    const forecastSeries = forecastRows.length
      ? forecastRows
      : [
          { day_offset: 0, low_stock_count: toNumber(warningForecast.baseLowStockCount) },
          { day_offset: 7, low_stock_count: toNumber(warningForecast.predict7) },
          { day_offset: 30, low_stock_count: toNumber(warningForecast.predict30) },
        ]
    const forecastChartWidth = 780
    const forecastValues = forecastSeries.map((row) => toNumber(row.low_stock_count))
    const forecastMax = Math.max(
      1,
      ...forecastValues,
      toNumber(warningForecast.baseLowStockCount),
      toNumber(warningForecast.predict7),
      toNumber(warningForecast.predict30)
    )
    const forecastLine = buildLinePoints(forecastValues, forecastChartWidth, chartHeight, forecastMax)
    const forecastArea = buildAreaPath(forecastValues, forecastChartWidth, chartHeight, forecastMax)
    const forecastDirectionText =
      warningForecast.direction === 'worse'
        ? '预警风险上升'
        : warningForecast.direction === 'improve'
          ? '预警风险下降'
          : '预警趋势平稳'

    const heatmapToneStyle = (score) => {
      const normalized = Math.min(1, Math.max(0, toNumber(score)))
      const coolAlpha = (0.28 - normalized * 0.16).toFixed(3)
      const warmAlpha = (0.12 + normalized * 0.52).toFixed(3)
      return {
        background: `linear-gradient(145deg, rgba(14,165,233,${coolAlpha}), rgba(239,68,68,${warmAlpha}))`,
      }
    }

    const trendPanel = (
      <article className="panel showcase-chart-card trend-card">
        <div className="panel-header">
          <div>
            <h2>出入库趋势</h2>
            <p>按天追踪入库 / 出库 / 调整动态</p>
          </div>
        </div>

        {trendRows.length === 0 ? (
          <div className="empty">暂无趋势数据</div>
        ) : (
          <>
            <div className="trend-chart-wrap">
              <svg className="trend-chart" viewBox={`0 0 ${trendChartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="trendInArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(37,99,235,0.45)" />
                    <stop offset="100%" stopColor="rgba(37,99,235,0)" />
                  </linearGradient>
                  <linearGradient id="trendOutArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(244,63,94,0.32)" />
                    <stop offset="100%" stopColor="rgba(244,63,94,0)" />
                  </linearGradient>
                  <linearGradient id="trendAdjustArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(20,184,166,0.3)" />
                    <stop offset="100%" stopColor="rgba(20,184,166,0)" />
                  </linearGradient>
                </defs>
                <path d={inArea} fill="url(#trendInArea)" />
                <path d={outArea} fill="url(#trendOutArea)" />
                <path d={adjustArea} fill="url(#trendAdjustArea)" />
                <polyline points={inLine} fill="none" stroke="#2563eb" strokeWidth="2.8" />
                <polyline points={outLine} fill="none" stroke="#f43f5e" strokeWidth="2.6" />
                <polyline points={adjustLine} fill="none" stroke="#0f766e" strokeWidth="2.4" />
              </svg>
            </div>
            <div className="trend-legend">
              <span className="legend-item in">入库</span>
              <span className="legend-item out">出库</span>
              <span className="legend-item adjust">调整</span>
              <span className="legend-item">峰值 {formatNum(trendMax)}</span>
            </div>
            <div className="trend-axis">
              <span>{formatDayLabel(trendRows[0]?.date)}</span>
              <span>{formatDayLabel(trendRows[trendRows.length - 1]?.date)}</span>
            </div>
          </>
        )}
      </article>
    )

    const donutPanel = (
      <article className="panel showcase-chart-card donut-card">
        <div className="panel-header">
          <div>
            <h2>分类库存占比</h2>
            <p>当前库存结构一眼可见</p>
          </div>
        </div>
        {categoryRows.length === 0 ? (
          <div className="empty">暂无分类库存数据</div>
        ) : (
          <div className="donut-layout">
            <div className="donut-ring" style={{ background: donutBackground }}>
              <div className="donut-hole">
                <span>库存总量</span>
                <strong>{formatNum(insightSummary.inventoryTotalQty)}</strong>
              </div>
            </div>
            <div className="donut-list">
              {categoryRows.map((row, index) => (
                <div key={`${row.category}-${index}`} className="donut-row">
                  <span className="dot" style={{ background: showcasePalette[index % showcasePalette.length] }} />
                  <span className="name">{row.category}</span>
                  <span className="qty">{formatNum(row.total_qty)}</span>
                  <span className="ratio">{toNumber(row.share).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </article>
    )

    const storageRankPanel = (
      <article className="panel showcase-chart-card rank-card">
        <div className="panel-header">
          <div>
            <h2>存放位置库存前10</h2>
            <p>识别核心仓位与库存集中区</p>
          </div>
        </div>
        {storageRows.length === 0 ? (
          <div className="empty">暂无位置库存数据</div>
        ) : (
          <div className="rank-list">
            {storageRows.map((row, index) => (
              <div key={`${row.storage_location_id}-${row.code}-${index}`} className="rank-row">
                <div className="rank-row-head">
                  <span className="rank-label">
                    {index + 1}. {row.code} / {row.name}
                  </span>
                  <strong>{formatNum(row.total_qty)}</strong>
                </div>
                <div className="rank-bar">
                  <span style={{ width: `${Math.max(6, (toNumber(row.total_qty) / maxStorageQty) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    )

    const usageRankPanel = (
      <article className="panel showcase-chart-card rank-card usage-card">
        <div className="panel-header">
          <div>
            <h2>使用位置领用前10</h2>
            <p>输出端热点位置与领用强度</p>
          </div>
        </div>
        {usageRows.length === 0 ? (
          <div className="empty">暂无领用数据</div>
        ) : (
          <div className="rank-list">
            {usageRows.map((row, index) => (
              <div key={`${row.usage_location_id}-${row.code}-${index}`} className="rank-row">
                <div className="rank-row-head">
                  <span className="rank-label">
                    {index + 1}. {row.code} / {row.name}
                  </span>
                  <strong>{formatNum(row.total_out_qty)}</strong>
                </div>
                <div className="rank-bar usage">
                  <span style={{ width: `${Math.max(6, (toNumber(row.total_out_qty) / maxUsageQty) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    )

    const forecastPanel = (
      <article className="panel showcase-chart-card forecast-card">
        <div className="panel-header">
          <div>
            <h2>告警趋势预测（7/30天）</h2>
            <p>基于近30天净流入/净流出趋势估算低库存风险</p>
          </div>
          <div className="small">置信度 {Math.round(toNumber(warningForecast.confidence) * 100)}%</div>
        </div>
        <div className="forecast-metrics">
          <div className="forecast-metric">
            <span>当前低库存</span>
            <strong>{formatNum(warningForecast.baseLowStockCount)}</strong>
          </div>
          <div className="forecast-metric">
            <span>7天预测</span>
            <strong>{formatNum(warningForecast.predict7)}</strong>
          </div>
          <div className="forecast-metric">
            <span>30天预测</span>
            <strong>{formatNum(warningForecast.predict30)}</strong>
          </div>
          <div className="forecast-metric">
            <span>变化方向</span>
            <strong>{forecastDirectionText}</strong>
          </div>
        </div>
        {forecastSeries.length === 0 ? (
          <div className="empty">暂无预测数据</div>
        ) : (
          <>
            <div className="trend-chart-wrap forecast-chart-wrap">
              <svg className="trend-chart" viewBox={`0 0 ${forecastChartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="forecastArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(245,158,11,0.35)" />
                    <stop offset="100%" stopColor="rgba(245,158,11,0)" />
                  </linearGradient>
                </defs>
                <path d={forecastArea} fill="url(#forecastArea)" />
                <polyline points={forecastLine} fill="none" stroke="#f59e0b" strokeWidth="2.8" />
              </svg>
            </div>
            <div className="trend-axis">
              <span>今天</span>
              <span>+7天: {formatNum(warningForecast.predict7)}</span>
              <span>+30天: {formatNum(warningForecast.predict30)}</span>
            </div>
          </>
        )}
      </article>
    )

    const heatmapPanel = (
      <article className="panel showcase-chart-card heatmap-card">
        <div className="panel-header">
          <div>
            <h2>库位热力图</h2>
            <p>综合低库存风险与库存密度，快速定位高风险库位</p>
          </div>
        </div>
        {heatmapRows.length === 0 ? (
          <div className="empty">暂无库位热力数据</div>
        ) : (
          <div className="heatmap-grid">
            {heatmapRows.map((row) => (
              <article key={`heat-${row.storage_location_id}`} className="heatmap-cell" style={heatmapToneStyle(row.heat_score)}>
                <div className="heatmap-row">
                  <strong>{row.code}</strong>
                  <span>{Math.round(toNumber(row.heat_score) * 100)}%</span>
                </div>
                <div className="heatmap-name">{row.name}</div>
                <div className="heatmap-meta">
                  <span>{row.warehouse}</span>
                  <span>{row.area}</span>
                </div>
                <div className="heatmap-stats">
                  <span>库存 {formatNum(row.total_qty)}</span>
                  <span>低库存商品 {formatNum(row.low_product_count)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>
    )

    const riskPanel = (
      <section className="panel showcase-risk-card">
        <div className="panel-header">
          <div>
            <h2>低库存风险榜</h2>
            <p>按缺口量排序，便于补货决策</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>商品编码</th>
                <th>商品</th>
                <th>当前库存</th>
                <th>安全库存</th>
                <th>缺口量</th>
              </tr>
            </thead>
            <tbody>
              {lowRiskRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>暂无风险数据</td>
                </tr>
              ) : (
                lowRiskRows.map((row) => (
                  <tr key={`risk-${row.product_id}`}>
                    <td>{row.sku}</td>
                    <td>{row.product_name}</td>
                    <td>{formatNum(row.total_qty)}</td>
                    <td>{formatNum(row.safety_stock)}</td>
                    <td>{formatNum(row.gap_qty)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    )

    const slideshow = [
      {
        key: 'slide-1',
        title: '动态趋势',
        tip: '入/出库动销与30天风险预测',
        content: (
          <section className="showcase-grid showcase-grid-balanced">
            {trendPanel}
            {forecastPanel}
          </section>
        ),
      },
      {
        key: 'slide-2',
        title: '结构分布',
        tip: '库存结构、存放位置与领用热点',
        content: (
          <section className="showcase-grid">
            {donutPanel}
            {storageRankPanel}
            {usageRankPanel}
          </section>
        ),
      },
      {
        key: 'slide-3',
        title: '风险定位',
        tip: '库位热力图 + 低库存风险榜',
        content: (
          <>
            {heatmapPanel}
            {riskPanel}
          </>
        ),
      },
    ]

    return (
      <section
        ref={insightsStageRef}
        className={`showcase-stage ${showcaseMode ? 'showcase-mode-on' : ''} ${showcaseFullscreen ? 'is-fullscreen' : ''}`}
        style={{ '--showcase-rhythm': `${showcaseRhythmConfig.motionScale}` }}
      >
        <section className="panel showcase-hero">
          <div className="showcase-orb orb-a" />
          <div className="showcase-orb orb-b" />
          <div>
            <div className="small">领导驾驶舱 {showcaseMode ? `/ 幻灯片 ${showcaseSlide + 1}/${showcaseSlideCount}` : ''}</div>
            <h2>库存运营大屏仪表盘</h2>
            <p>聚焦趋势、分布与风险，适合直接投屏汇报。</p>
            <div className="showcase-meta">更新于：{insights.updatedAt ? parseApiDate(insights.updatedAt) : '-'}</div>
          </div>
          <div className="toolbar showcase-actions">
            <div className="period-switch">
              {dashboardPeriodOptions.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`btn period-btn ${displayDays === day ? 'active' : ''}`}
                  onClick={() => setInsightsDays(day)}
                >
                  {day}天
                </button>
              ))}
            </div>
            <select value={showcaseRhythm} onChange={(e) => setShowcaseRhythm(e.target.value)} style={{ width: 112 }}>
              {showcaseRhythmOptions.map((item) => (
                <option value={item.key} key={`rhythm-${item.key}`}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              className={`btn ${showcaseMode ? 'btn-warning' : 'btn-primary'}`}
              type="button"
              onClick={() => {
                setShowcaseMode((prev) => !prev)
                if (showcaseMode) {
                  setShowcaseAutoPlay(false)
                  setShowcaseSlide(0)
                }
              }}
            >
              {showcaseMode ? '退出大屏模式' : '开启大屏模式'}
            </button>
            {showcaseMode ? (
              <>
                <button className="btn" type="button" onClick={() => setShowcaseAutoPlay((prev) => !prev)}>
                  {showcaseAutoPlay ? '暂停轮播' : '自动轮播'}
                </button>
                <button className="btn" type="button" onClick={() => stepShowcaseSlide(-1)}>
                  上一页
                </button>
                <button className="btn" type="button" onClick={() => stepShowcaseSlide(1)}>
                  下一页
                </button>
                <button className="btn" type="button" onClick={toggleShowcaseFullscreen}>
                  {showcaseFullscreen ? '退出全屏' : '全屏展示'}
                </button>
              </>
            ) : null}
            <button
              className="btn btn-primary"
              type="button"
              disabled={insightsLoading}
              onClick={() => refreshInsightsPanel(displayDays).catch((err) => showError(err.message))}
            >
              {insightsLoading ? '刷新中...' : '刷新仪表盘'}
            </button>
          </div>
        </section>

        <section className="showcase-kpi-grid">
          <article className="showcase-kpi">
            <div className="kpi-label">近{displayDays}天入库量</div>
            <div className="kpi-value">{formatNum(metrics.inQty)}</div>
            <div className="kpi-sub">入库</div>
          </article>
          <article className="showcase-kpi">
            <div className="kpi-label">近{displayDays}天出库量</div>
            <div className="kpi-value">{formatNum(metrics.outQty)}</div>
            <div className="kpi-sub">出库</div>
          </article>
          <article className="showcase-kpi">
            <div className="kpi-label">近{displayDays}天调整量</div>
            <div className="kpi-value">{formatNum(metrics.adjustQty)}</div>
            <div className="kpi-sub">调整</div>
          </article>
          <article className={`showcase-kpi ${netValue >= 0 ? 'positive' : 'negative'}`}>
            <div className="kpi-label">库存净变化</div>
            <div className="kpi-value">{formatSignedNum(netValue)}</div>
            <div className="kpi-sub">净值</div>
          </article>
          <article className="showcase-kpi">
            <div className="kpi-label">低库存商品</div>
            <div className="kpi-value">{formatNum(insightSummary.lowStockCount)}</div>
            <div className="kpi-sub">风险</div>
          </article>
          <article className="showcase-kpi">
            <div className="kpi-label">近{displayDays}天单据数</div>
            <div className="kpi-value">{formatNum(metrics.orderCount)}</div>
            <div className="kpi-sub">单据</div>
          </article>
        </section>

        {showcaseMode ? (
          <>
            <section className="showcase-carousel">
              {slideshow.map((slide, index) => (
                <article key={slide.key} className={`showcase-slide-panel ${index === showcaseSlide ? 'active' : ''}`}>
                  <div className="showcase-slide-head">
                    <strong>
                      {index + 1}. {slide.title}
                    </strong>
                    <span>{slide.tip}</span>
                  </div>
                  {slide.content}
                </article>
              ))}
            </section>
            <section className="showcase-indicators">
              {slideshow.map((slide, index) => (
                <button type="button" key={`dot-${slide.key}`} className={index === showcaseSlide ? 'active' : ''} onClick={() => setShowcaseSlide(index)}>
                  {index + 1}
                </button>
              ))}
            </section>
          </>
        ) : (
          <>
            <section className="showcase-grid">
              {trendPanel}
              {donutPanel}
              {storageRankPanel}
              {usageRankPanel}
            </section>
            <section className="showcase-grid showcase-grid-balanced">
              {heatmapPanel}
              {forecastPanel}
            </section>
            {riskPanel}
          </>
        )}
      </section>
    )
  }

  const renderProducts = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>新建商品</h2>
              <p>设置商品编码、安全库存与单位</p>
            </div>
          </div>
          {!canEditMaster ? <div className="inline-msg error">当前角色仅可查看商品，不能执行新增/修改/删除。</div> : null}
          <form onSubmit={onCreateProduct} className="form-grid">
            <div className="field">
              <label>商品编码</label>
              <input
                value={productForm.sku}
                onChange={(e) => setProductForm((prev) => ({ ...prev, sku: e.target.value }))}
                placeholder="例如：P-10001"
              />
            </div>
            <div className="field">
              <label>商品名称</label>
              <input
                value={productForm.name}
                onChange={(e) => setProductForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例如：24口交换机"
              />
            </div>
            <div className="field">
              <label>分类</label>
              <input
                value={productForm.category}
                onChange={(e) => setProductForm((prev) => ({ ...prev, category: e.target.value }))}
                placeholder="网络设备"
              />
            </div>
            <div className="field">
              <label>单位</label>
              <input
                value={productForm.unit}
                onChange={(e) => setProductForm((prev) => ({ ...prev, unit: e.target.value }))}
                placeholder="件"
              />
            </div>
            <div className="field">
              <label>安全库存</label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={productForm.safety_stock}
                onChange={(e) => setProductForm((prev) => ({ ...prev, safety_stock: e.target.value }))}
              />
            </div>
            <div className="field" style={{ alignSelf: 'end' }}>
              <button className="btn btn-primary" type="submit" disabled={busy || !canEditMaster}>
                保存商品
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>商品列表</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>商品编码</th>
                  <th>商品</th>
                  <th>分类</th>
                  <th>单位</th>
                  <th>预警</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.sku}</td>
                    <td>{item.name}</td>
                    <td>{item.category || '-'}</td>
                    <td>{item.unit}</td>
                    <td>
                      {Number(item.is_low_stock) === 1 ? (
                        <span className="tag low">低库存</span>
                      ) : (
                        <span className="tag ok">正常</span>
                      )}
                    </td>
                    <td>{Number(item.is_active) === 1 ? '启用' : '停用'}</td>
                    <td>
                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => onToggleProduct(item)}
                          disabled={busy || !canEditMaster}
                        >
                          {Number(item.is_active) === 1 ? '停用' : '启用'}
                        </button>
                        {canEditMaster ? (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => onDeleteProduct(item)}
                            disabled={busy}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={8}>暂无商品数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderStorage = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>新增存放位置</h2>
              <p>仓库/库区/货架/库位四层信息</p>
            </div>
          </div>
          {!canEditMaster ? <div className="inline-msg error">当前角色仅可查看存放位置，不能执行新增/修改/删除。</div> : null}
          <form onSubmit={onCreateStorage} className="form-grid">
            <div className="field">
              <label>编码</label>
              <input
                value={storageForm.code}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="MAIN-A-01"
              />
            </div>
            <div className="field">
              <label>名称</label>
              <input
                value={storageForm.name}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="主仓A01"
              />
            </div>
            <div className="field">
              <label>仓库</label>
              <input
                value={storageForm.warehouse}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, warehouse: e.target.value }))}
                placeholder="主仓"
              />
            </div>
            <div className="field">
              <label>库区</label>
              <input
                value={storageForm.area}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, area: e.target.value }))}
                placeholder="A区"
              />
            </div>
            <div className="field">
              <label>货架</label>
              <input
                value={storageForm.shelf}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, shelf: e.target.value }))}
                placeholder="A货架"
              />
            </div>
            <div className="field">
              <label>库位</label>
              <input
                value={storageForm.slot}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, slot: e.target.value }))}
                placeholder="01位"
              />
            </div>
            <div className="field">
              <label>描述</label>
              <input
                value={storageForm.description}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="可选"
              />
            </div>
            <div className="field" style={{ alignSelf: 'end' }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !canEditMaster}>
                保存位置
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>存放位置列表</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>编码</th>
                  <th>名称</th>
                  <th>仓库</th>
                  <th>库区</th>
                  <th>货架</th>
                  <th>库位</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {storageLocations.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.code}</td>
                    <td>{item.name}</td>
                    <td>{item.warehouse || '-'}</td>
                    <td>{item.area || '-'}</td>
                    <td>{item.shelf || '-'}</td>
                    <td>{item.slot || '-'}</td>
                    <td>{Number(item.is_active) === 1 ? '启用' : '停用'}</td>
                    <td>
                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => onToggleStorage(item)}
                          disabled={busy || !canEditMaster}
                        >
                          {Number(item.is_active) === 1 ? '停用' : '启用'}
                        </button>
                        {canEditMaster ? (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => onDeleteStorage(item)}
                            disabled={busy}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {storageLocations.length === 0 ? (
                  <tr>
                    <td colSpan={9}>暂无存放位置数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderUsage = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>新增使用位置</h2>
              <p>例如部门、项目、门店、班组</p>
            </div>
          </div>
          {!canEditMaster ? <div className="inline-msg error">当前角色仅可查看使用位置，不能执行新增/修改/删除。</div> : null}
          <form onSubmit={onCreateUsage} className="form-grid">
            <div className="field">
              <label>编码</label>
              <input
                value={usageForm.code}
                onChange={(e) => setUsageForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="IT-OPS"
              />
            </div>
            <div className="field">
              <label>名称</label>
              <input
                value={usageForm.name}
                onChange={(e) => setUsageForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="运维部"
              />
            </div>
            <div className="field">
              <label>类型</label>
              <input
                value={usageForm.type}
                onChange={(e) => setUsageForm((prev) => ({ ...prev, type: e.target.value }))}
                placeholder="部门"
              />
            </div>
            <div className="field">
              <label>描述</label>
              <input
                value={usageForm.description}
                onChange={(e) => setUsageForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="可选"
              />
            </div>
            <div className="field" style={{ alignSelf: 'end' }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !canEditMaster}>
                保存位置
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>使用位置列表</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>编码</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>描述</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {usageLocations.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.code}</td>
                    <td>{item.name}</td>
                    <td>{item.type || '-'}</td>
                    <td>{item.description || '-'}</td>
                    <td>{Number(item.is_active) === 1 ? '启用' : '停用'}</td>
                    <td>
                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => onToggleUsage(item)}
                          disabled={busy || !canEditMaster}
                        >
                          {Number(item.is_active) === 1 ? '停用' : '启用'}
                        </button>
                        {canEditMaster ? (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => onDeleteUsage(item)}
                            disabled={busy}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {usageLocations.length === 0 ? (
                  <tr>
                    <td colSpan={7}>暂无使用位置数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderStockIn = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>入库登记</h2>
              <p>指定商品与存放位置，系统自动增加库存</p>
            </div>
          </div>
          {!canOperateInventory ? <div className="inline-msg error">当前角色仅可查看入库记录，不能提交入库。</div> : null}
          <form onSubmit={onCreateStockIn}>
            <div className="grid-3">
              <div className="field">
                <label>供应商</label>
                <input
                  value={stockInForm.supplier}
                  onChange={(e) => setStockInForm((prev) => ({ ...prev, supplier: e.target.value }))}
                  placeholder="可选"
                />
              </div>
              <div className="field">
                <label>备注</label>
                <input
                  value={stockInForm.remark}
                  onChange={(e) => setStockInForm((prev) => ({ ...prev, remark: e.target.value }))}
                  placeholder="例如：采购补货"
                />
              </div>
              <div className="field" style={{ alignSelf: 'end' }}>
                <div className="toolbar">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setStockInForm((prev) => ({
                        ...prev,
                        items: [...prev.items, emptyStockInItem()],
                      }))
                    }
                    disabled={!canOperateInventory}
                  >
                    新增明细行
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busy || !canOperateInventory}>
                    提交入库
                  </button>
                </div>
              </div>
            </div>

            <div className="line-items" style={{ marginTop: 12 }}>
              {stockInForm.items.map((item, index) => {
                const stockSnapshot = productStockMap.get(String(item.product_id)) || {
                  safetyStock: 0,
                  currentStock: 0,
                }

                return (
                  <div className="line-item-row" key={`stock-in-${index}`}>
                    <div className="field">
                      <label>商品</label>
                      <select
                        value={item.product_id}
                        onChange={(e) => updateStockInItem(index, 'product_id', e.target.value)}
                      >
                        <option value="">请选择商品</option>
                        {products
                          .filter((p) => Number(p.is_active) === 1)
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.sku} / {p.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="field">
                      <label>存放位置</label>
                      <select
                        value={item.storage_location_id}
                        onChange={(e) => updateStockInItem(index, 'storage_location_id', e.target.value)}
                      >
                        <option value="">请选择位置</option>
                        {storageLocations
                          .filter((s) => Number(s.is_active) === 1)
                          .map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.code} / {s.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="field">
                      <label>安全库存</label>
                      <input value={formatNum(stockSnapshot.safetyStock)} readOnly tabIndex={-1} />
                    </div>

                    <div className="field">
                      <label>当前库存</label>
                      <input value={formatNum(stockSnapshot.currentStock)} readOnly tabIndex={-1} />
                    </div>

                    <div className="field">
                      <label>数量</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.quantity}
                        onChange={(e) => updateStockInItem(index, 'quantity', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label>批次号</label>
                      <input
                        value={item.batch_no}
                        onChange={(e) => updateStockInItem(index, 'batch_no', e.target.value)}
                        placeholder="可选，例如：BATCH-202602"
                      />
                    </div>

                    <div className="field">
                      <label>序列号(SN)</label>
                      <textarea
                        className="serial-input"
                        value={item.serial_nos}
                        onChange={(e) => updateStockInItem(index, 'serial_nos', e.target.value)}
                        placeholder="可选，多个SN用逗号或换行分隔"
                      />
                    </div>

                    <div className="field">
                      <label>成本价</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.unit_cost}
                        onChange={(e) => updateStockInItem(index, 'unit_cost', e.target.value)}
                      />
                    </div>

                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() =>
                        setStockInForm((prev) => ({
                          ...prev,
                          items: prev.items.filter((_, idx) => idx !== index),
                        }))
                      }
                      disabled={stockInForm.items.length === 1 || !canOperateInventory}
                    >
                      删除
                    </button>
                  </div>
                )
              })}
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>最近入库单</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>单号</th>
                  <th>供应商</th>
                  <th>总数量</th>
                  <th>明细行</th>
                  <th>创建人</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {stockInOrders.map((row) => (
                  <tr key={row.id}>
                    <td>{row.order_no}</td>
                    <td>{row.supplier || '-'}</td>
                    <td>{formatNum(row.total_qty)}</td>
                    <td>{row.item_count}</td>
                    <td>{row.creator_name || '-'}</td>
                    <td>{parseApiDate(row.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={!canOperateInventory}
                        onClick={() => onOpenStockInEdit(row)}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {stockInOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7}>暂无入库记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderStockOut = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>出库登记</h2>
              <p>指定存放位置和使用位置，系统自动扣减库存</p>
            </div>
          </div>
          {!canOperateInventory ? <div className="inline-msg error">当前角色仅可查看出库记录，不能提交出库。</div> : null}
          <form onSubmit={onCreateStockOut}>
            <div className="grid-3">
              <div className="field">
                <label>使用位置</label>
                <select
                  value={stockOutForm.usage_location_id}
                  onChange={(e) => setStockOutForm((prev) => ({ ...prev, usage_location_id: e.target.value }))}
                >
                  <option value="">请选择使用位置</option>
                  {usageLocations
                    .filter((u) => Number(u.is_active) === 1)
                    .map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.code} / {u.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>用途</label>
                <input
                  value={stockOutForm.purpose}
                  onChange={(e) => setStockOutForm((prev) => ({ ...prev, purpose: e.target.value }))}
                  placeholder="例如：项目部署领用"
                />
              </div>
              <div className="field">
                <label>备注</label>
                <input
                  value={stockOutForm.remark}
                  onChange={(e) => setStockOutForm((prev) => ({ ...prev, remark: e.target.value }))}
                  placeholder="可选"
                />
              </div>
            </div>

            <div className="toolbar" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setStockOutForm((prev) => ({
                    ...prev,
                    items: [...prev.items, emptyStockOutItem()],
                  }))
                }
                disabled={!canOperateInventory}
              >
                新增明细行
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !canOperateInventory}>
                提交出库
              </button>
            </div>

            <div className="line-items" style={{ marginTop: 12 }}>
              {stockOutForm.items.map((item, index) => {
                const stockSnapshot = productStockMap.get(String(item.product_id)) || {
                  safetyStock: 0,
                  currentStock: 0,
                }

                return (
                  <div className="line-item-row simple" key={`stock-out-${index}`}>
                    <div className="field">
                      <label>商品</label>
                      <select
                        value={item.product_id}
                        onChange={(e) => updateStockOutItem(index, 'product_id', e.target.value)}
                      >
                        <option value="">请选择商品</option>
                        {products
                          .filter((p) => Number(p.is_active) === 1)
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.sku} / {p.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="field">
                      <label>存放位置</label>
                      <select
                        value={item.storage_location_id}
                        onChange={(e) => updateStockOutItem(index, 'storage_location_id', e.target.value)}
                      >
                        <option value="">请选择位置</option>
                        {storageLocations
                          .filter((s) => Number(s.is_active) === 1)
                          .map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.code} / {s.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="field">
                      <label>安全库存</label>
                      <input value={formatNum(stockSnapshot.safetyStock)} readOnly tabIndex={-1} />
                    </div>

                    <div className="field">
                      <label>当前库存</label>
                      <input value={formatNum(stockSnapshot.currentStock)} readOnly tabIndex={-1} />
                    </div>

                    <div className="field">
                      <label>数量</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.quantity}
                        onChange={(e) => updateStockOutItem(index, 'quantity', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label>批次号</label>
                      <input
                        value={item.batch_no}
                        onChange={(e) => updateStockOutItem(index, 'batch_no', e.target.value)}
                        placeholder="可选，按批次出库"
                      />
                    </div>

                    <div className="field">
                      <label>序列号(SN)</label>
                      <textarea
                        className="serial-input"
                        value={item.serial_nos}
                        onChange={(e) => updateStockOutItem(index, 'serial_nos', e.target.value)}
                        placeholder="可选，多个SN用逗号或换行分隔"
                      />
                    </div>

                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() =>
                        setStockOutForm((prev) => ({
                          ...prev,
                          items: prev.items.filter((_, idx) => idx !== index),
                        }))
                      }
                      disabled={stockOutForm.items.length === 1 || !canOperateInventory}
                    >
                      删除
                    </button>
                  </div>
                )
              })}
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>最近出库单</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>单号</th>
                  <th>使用位置</th>
                  <th>用途</th>
                  <th>总数量</th>
                  <th>明细行</th>
                  <th>发货状态</th>
                  <th>快递单号</th>
                  <th>创建人</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {stockOutOrders.map((row) => (
                  <tr key={row.id}>
                    <td>{row.order_no}</td>
                    <td>
                      {row.usage_location_code} / {row.usage_location_name}
                    </td>
                    <td>{row.purpose || '-'}</td>
                    <td>{formatNum(row.total_qty)}</td>
                    <td>{row.item_count}</td>
                    <td>
                      <span className={`ship-chip ${shippingStatusClassName(row.shipping_status)}`}>
                        {formatShippingStatusLabel(row.shipping_status)}
                      </span>
                    </td>
                    <td>{row.shipping_tracking_nos || '-'}</td>
                    <td>{row.creator_name || '-'}</td>
                    <td>{parseApiDate(row.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => goShipFromStockOut(row)}
                        disabled={!canOperateInventory}
                      >
                        去发货
                      </button>
                    </td>
                  </tr>
                ))}
                {stockOutOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10}>暂无出库记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderShipping = () => {
    const shippingTotalPages = Math.max(1, Math.ceil(Math.max(shippingTotal, 0) / shippingLimit))
    const shippingFrom = shippingTotal === 0 ? 0 : (shippingPage - 1) * shippingLimit + 1
    const shippingTo = Math.min(shippingPage * shippingLimit, shippingTotal)
    return (
      <div className="shipping-content-wrap">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>发货登记</h2>
              <p>关联出库单后可拆分为多个物流单号，支持履约跟踪</p>
            </div>
          </div>
          {!canOperateInventory ? <div className="inline-msg error">当前角色仅可查看发货记录，不能提交发货。</div> : null}
          <form className="shipping-create-form" onSubmit={onCreateShippingBatch}>
            <div className="grid-3 shipping-create-grid">
              <div className="field">
                <label>关联出库单</label>
                <select
                  value={shippingForm.stock_out_order_id}
                  onChange={(e) => setShippingForm((prev) => ({ ...prev, stock_out_order_id: e.target.value }))}
                >
                  <option value="">请选择出库单</option>
                  {stockOutOrders.map((row) => (
                    <option value={row.id} key={`ship-out-${row.id}`}>
                      {row.order_no} / {row.usage_location_name || '-'} / 数量 {formatNum(row.total_qty)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>收货人</label>
                <input
                  value={shippingForm.receiver_name}
                  onChange={(e) => setShippingForm((prev) => ({ ...prev, receiver_name: e.target.value }))}
                  placeholder="例如：张三"
                />
              </div>
              <div className="field">
                <label>联系电话</label>
                <input
                  value={shippingForm.receiver_phone}
                  onChange={(e) => setShippingForm((prev) => ({ ...prev, receiver_phone: e.target.value }))}
                  placeholder="例如：13800000000"
                />
              </div>
            </div>

            <div className="field shipping-address-field">
              <label>收货地址</label>
              <input
                value={shippingForm.receiver_address}
                onChange={(e) => setShippingForm((prev) => ({ ...prev, receiver_address: e.target.value }))}
                placeholder="例如：上海市浦东新区..."
              />
            </div>

            <div className="toolbar shipping-create-toolbar">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setShippingForm((prev) => ({
                    ...prev,
                    items: [...prev.items, emptyShippingItem()],
                  }))
                }
                disabled={!canOperateInventory}
              >
                新增发货行
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !canOperateInventory}>
                提交发货
              </button>
            </div>

            <div className="line-items shipping-line-items">
              {shippingForm.items.map((item, index) => (
                <div className="line-item-row shipping shipping-line-row" key={`shipping-item-${index}`}>
                  <div className="field">
                    <label>物流公司</label>
                    <input
                      value={item.carrier}
                      onChange={(e) => updateShippingItem(index, 'carrier', e.target.value)}
                      placeholder="例如：顺丰"
                    />
                  </div>
                  <div className="field">
                    <label>快递单号</label>
                    <input
                      value={item.tracking_no}
                      onChange={(e) => updateShippingItem(index, 'tracking_no', e.target.value)}
                      placeholder="必填"
                    />
                  </div>
                  <div className="field">
                    <label>发货时间</label>
                    <input
                      type="datetime-local"
                      value={item.shipped_at}
                      onChange={(e) => updateShippingItem(index, 'shipped_at', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>状态</label>
                    <select value={item.status} onChange={(e) => updateShippingItem(index, 'status', e.target.value)}>
                      <option value="PENDING">待发货</option>
                      <option value="SHIPPED">已发货</option>
                      <option value="IN_TRANSIT">运输中</option>
                      <option value="SIGNED">已签收</option>
                      <option value="EXCEPTION">异常</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>备注</label>
                    <input
                      value={item.remark}
                      onChange={(e) => updateShippingItem(index, 'remark', e.target.value)}
                      placeholder="可选"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger shipping-line-remove"
                    onClick={() =>
                      setShippingForm((prev) => ({
                        ...prev,
                        items: prev.items.filter((_, idx) => idx !== index),
                      }))
                    }
                    disabled={shippingForm.items.length === 1 || !canOperateInventory}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>发货记录</h2>
              <p>保留关键列展示，更多字段与明细请在详情中查看</p>
            </div>
            <div className="toolbar shipping-record-toolbar">
              <select
                className="shipping-limit-select"
                value={shippingLimit}
                onChange={(e) => {
                  setShippingLimit(Number(e.target.value || 50))
                  setShippingPage(1)
                }}
              >
                {gridPageSizes.map((size) => (
                  <option key={`shipping-limit-${size}`} value={size}>
                    每页 {size}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={refreshShippingOrders}>
                刷新
              </button>
            </div>
          </div>

          <div className="form-grid shipping-filter-grid">
            <div className="field">
              <label>关键字</label>
              <input
                value={shippingFilter.keyword}
                onChange={(e) => updateShippingFilter('keyword', e.target.value)}
                placeholder="发货单号 / 快递单号 / 出库单号"
              />
            </div>
            <div className="field">
              <label>状态</label>
              <select value={shippingFilter.status} onChange={(e) => updateShippingFilter('status', e.target.value)}>
                <option value="">全部状态</option>
                <option value="PENDING">待发货</option>
                <option value="SHIPPED">已发货</option>
                <option value="IN_TRANSIT">运输中</option>
                <option value="SIGNED">已签收</option>
                <option value="EXCEPTION">异常</option>
              </select>
            </div>
            <div className="field">
              <label>出库单</label>
              <select
                value={shippingFilter.stock_out_order_id}
                onChange={(e) => updateShippingFilter('stock_out_order_id', e.target.value)}
              >
                <option value="">全部出库单</option>
                {stockOutOrders.map((row) => (
                  <option value={row.id} key={`filter-out-${row.id}`}>
                    {row.order_no}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="table-wrap shipping-table-wrap">
            <table className="table shipping-table">
              <thead>
                <tr>
                  <th>发货单号</th>
                  <th>关联出库单</th>
                  <th>物流公司</th>
                  <th>快递单号</th>
                  <th>状态</th>
                  <th>发货时间</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {shippingOrders.map((row) => (
                  <tr key={`shipping-order-${row.id}`}>
                    <td>{row.shipment_no}</td>
                    <td>{row.stock_out_order_no || '-'}</td>
                    <td>{row.carrier || '-'}</td>
                    <td>{row.tracking_no}</td>
                    <td>
                      <span className={`ship-chip ${shippingStatusClassName(row.status)}`}>
                        {formatShippingStatusLabel(row.status)}
                      </span>
                    </td>
                    <td>{parseApiDate(row.shipped_at)}</td>
                    <td>{parseApiDate(row.updated_at)}</td>
                    <td className="shipping-action-cell">
                      <div className="shipping-action-row">
                        <button type="button" className="btn" onClick={() => onOpenShippingDetail(row)}>
                          详情
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {shippingOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8}>暂无发货记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="toolbar shipping-pagination">
            <div className="small">
              共 {formatNum(shippingTotal)} 条，当前显示 {formatNum(shippingFrom)} - {formatNum(shippingTo)}
            </div>
            <div className="toolbar shipping-page-controls">
              <button
                type="button"
                className="btn"
                disabled={shippingPage <= 1}
                onClick={() => setShippingPage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </button>
              <span className="small">
                第 {shippingPage} / {shippingTotalPages} 页
              </span>
              <button
                type="button"
                className="btn"
                disabled={shippingPage >= shippingTotalPages}
                onClick={() => setShippingPage((prev) => Math.min(shippingTotalPages, prev + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  const renderStocktake = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>盘点调整</h2>
              <p>录入实盘数量后自动生成差异并写入流水</p>
            </div>
          </div>
          {!canOperateInventory ? <div className="inline-msg error">当前角色仅可查看盘点记录，不能提交盘点。</div> : null}
          <form onSubmit={onCreateStocktake}>
            <div className="grid-2">
              <div className="field">
                <label>盘点备注</label>
                <input
                  value={stocktakeForm.remark}
                  onChange={(e) => setStocktakeForm((prev) => ({ ...prev, remark: e.target.value }))}
                  placeholder="例如：月度盘点"
                />
              </div>
              <div className="field" style={{ alignSelf: 'end' }}>
                <div className="toolbar">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setStocktakeForm((prev) => ({
                        ...prev,
                        items: [...prev.items, emptyStocktakeItem()],
                      }))
                    }
                    disabled={!canOperateInventory}
                  >
                    新增明细行
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busy || !canOperateInventory}>
                    提交盘点
                  </button>
                </div>
              </div>
            </div>

            <div className="line-items" style={{ marginTop: 12 }}>
              {stocktakeForm.items.map((item, index) => (
                <div className="line-item-row simple" key={`stocktake-${index}`}>
                  <div className="field">
                    <label>商品</label>
                    <select
                      value={item.product_id}
                      onChange={(e) => updateStocktakeItem(index, 'product_id', e.target.value)}
                    >
                      <option value="">请选择商品</option>
                      {products
                        .filter((p) => Number(p.is_active) === 1)
                        .map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.sku} / {p.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="field">
                    <label>存放位置</label>
                    <select
                      value={item.storage_location_id}
                      onChange={(e) => updateStocktakeItem(index, 'storage_location_id', e.target.value)}
                    >
                      <option value="">请选择位置</option>
                      {storageLocations
                        .filter((s) => Number(s.is_active) === 1)
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.code} / {s.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="field">
                    <label>实盘数量</label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={item.counted_qty}
                      onChange={(e) => updateStocktakeItem(index, 'counted_qty', e.target.value)}
                    />
                  </div>

                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() =>
                      setStocktakeForm((prev) => ({
                        ...prev,
                        items: prev.items.filter((_, idx) => idx !== index),
                      }))
                    }
                    disabled={stocktakeForm.items.length === 1 || !canOperateInventory}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>最近盘点单</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>单号</th>
                  <th>状态</th>
                  <th>明细行</th>
                  <th>总差异</th>
                  <th>创建人</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {stocktakeOrders.map((row) => (
                  <tr key={row.id}>
                    <td>{row.order_no}</td>
                    <td>{formatStocktakeStatusLabel(row.status)}</td>
                    <td>{row.item_count}</td>
                    <td>{formatNum(row.total_diff_qty)}</td>
                    <td>{row.creator_name || '-'}</td>
                    <td>{parseApiDate(row.created_at)}</td>
                  </tr>
                ))}
                {stocktakeOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6}>暂无盘点记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderTraceability = () => {
    return (
      <>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>批次与序列号追溯</h2>
              <p>支持按批次和SN回溯入库、出库与当前在库状态</p>
            </div>
            <div className="toolbar">
              <button type="button" className="btn" onClick={refreshTraceability}>
                刷新
              </button>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>关键字</label>
              <input
                value={traceFilter.keyword}
                onChange={(e) => updateTraceFilter('keyword', e.target.value)}
                placeholder="商品/SKU/位置/批次/SN"
              />
            </div>
            <div className="field">
              <label>商品</label>
              <select
                value={traceFilter.product_id}
                onChange={(e) => updateTraceFilter('product_id', e.target.value)}
              >
                <option value="">全部商品</option>
                {products.map((p) => (
                  <option value={p.id} key={`trace-product-${p.id}`}>
                    {p.sku} / {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>序列号状态</label>
              <select value={traceFilter.status} onChange={(e) => updateTraceFilter('status', e.target.value)}>
                <option value="">全部状态</option>
                <option value="IN_STOCK">在库</option>
                <option value="OUT_STOCK">已出库</option>
              </select>
            </div>
            <div className="field">
              <label>批次号</label>
              <input
                value={traceFilter.batch_no}
                onChange={(e) => updateTraceFilter('batch_no', e.target.value)}
                placeholder="精确匹配批次号"
              />
            </div>
            <div className="field">
              <label>序列号(SN)</label>
              <input
                value={traceFilter.serial_no}
                onChange={(e) => updateTraceFilter('serial_no', e.target.value)}
                placeholder="精确匹配SN"
              />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>批次台账</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>批次号</th>
                  <th>商品</th>
                  <th>存放位置</th>
                  <th>累计入库</th>
                  <th>累计出库</th>
                  <th>当前结余</th>
                  <th>最后更新</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.map((row) => (
                  <tr key={`batch-${row.id}`}>
                    <td>{row.batch_no}</td>
                    <td>
                      {row.sku} / {row.product_name}
                    </td>
                    <td>
                      {row.storage_location_code} / {row.storage_location_name}
                    </td>
                    <td>{formatNum(row.qty_in)}</td>
                    <td>{formatNum(row.qty_out)}</td>
                    <td>{formatNum(row.qty_balance)}</td>
                    <td>{parseApiDate(row.updated_at)}</td>
                  </tr>
                ))}
                {batchRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>暂无批次数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>序列号台账</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>序列号(SN)</th>
                  <th>商品</th>
                  <th>批次号</th>
                  <th>状态</th>
                  <th>当前存放位置</th>
                  <th>入库单</th>
                  <th>出库单</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {serialRows.map((row) => (
                  <tr key={`serial-${row.id}`}>
                    <td>{row.serial_no}</td>
                    <td>
                      {row.sku} / {row.product_name}
                    </td>
                    <td>{row.batch_no || '-'}</td>
                    <td>{formatSerialStatusLabel(row.status)}</td>
                    <td>
                      {row.storage_location_code
                        ? `${row.storage_location_code} / ${row.storage_location_name}`
                        : '-'}
                    </td>
                    <td>{row.stock_in_order_no || '-'}</td>
                    <td>{row.stock_out_order_no || '-'}</td>
                    <td>{parseApiDate(row.updated_at)}</td>
                  </tr>
                ))}
                {serialRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>暂无序列号数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  const renderBalances = () => {
    const balanceTotalPages = Math.max(1, Math.ceil(Math.max(balanceTotal, 0) / balanceLimit))
    const balanceFrom = balanceTotal === 0 ? 0 : (balancePage - 1) * balanceLimit + 1
    const balanceTo = Math.min(balancePage * balanceLimit, balanceTotal)

    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>库存台账</h2>
            <p>按商品 + 存放位置查看实时库存</p>
          </div>
          <div className="toolbar">
            <input
              style={{ width: 260 }}
              value={balanceKeywordInput}
              onChange={(e) => {
                setBalanceKeywordInput(e.target.value)
                if (balancePage !== 1) setBalancePage(1)
              }}
              placeholder="搜索 SKU/商品/位置"
            />
            <button
              type="button"
              className={`btn ${balanceLowOnly ? 'btn-warning' : ''}`}
              onClick={() => {
                setBalanceLowOnly((prev) => !prev)
                if (balancePage !== 1) setBalancePage(1)
              }}
            >
              {balanceLowOnly ? '仅低库存：开' : '仅低库存：关'}
            </button>
            <select
              value={balanceLimit}
              onChange={(e) => {
                setBalanceLimit(Number(e.target.value || 50))
                setBalancePage(1)
              }}
              style={{ width: 120 }}
            >
              {gridPageSizes.map((size) => (
                <option key={`balance-limit-${size}`} value={size}>
                  每页 {size}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={refreshBalances}>
              刷新
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>商品编码</th>
                <th>商品</th>
                <th>位置编码</th>
                <th>位置名称</th>
                <th>位置库存</th>
                <th>总库存</th>
                <th>安全库存</th>
                <th>预警</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row, index) => (
                <tr key={`${row.product_id}-${row.storage_location_id || 'none'}-${index}`}>
                  <td>{row.sku}</td>
                  <td>{row.product_name}</td>
                  <td>{row.storage_location_code || '-'}</td>
                  <td>{row.storage_location_name || '-'}</td>
                  <td>{formatNum(row.location_qty)}</td>
                  <td>{formatNum(row.total_qty)}</td>
                  <td>{formatNum(row.safety_stock)}</td>
                  <td>
                    {Number(row.is_low_stock) === 1 ? (
                      <span className="tag low">低库存</span>
                    ) : (
                      <span className="tag ok">正常</span>
                    )}
                  </td>
                  <td>{parseApiDate(row.updated_at)}</td>
                </tr>
              ))}
              {balances.length === 0 ? (
                <tr>
                  <td colSpan={9}>暂无库存数据</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <div className="small">
            共 {formatNum(balanceTotal)} 条，当前显示 {formatNum(balanceFrom)} - {formatNum(balanceTo)}
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              disabled={balancePage <= 1}
              onClick={() => setBalancePage((prev) => Math.max(1, prev - 1))}
            >
              上一页
            </button>
            <span className="small">
              第 {balancePage} / {balanceTotalPages} 页
            </span>
            <button
              type="button"
              className="btn"
              disabled={balancePage >= balanceTotalPages}
              onClick={() => setBalancePage((prev) => Math.min(balanceTotalPages, prev + 1))}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
    )
  }

  const renderLedger = () => {
    const ledgerTotalPages = Math.max(1, Math.ceil(Math.max(ledgerTotal, 0) / ledgerLimit))
    const ledgerFrom = ledgerTotal === 0 ? 0 : (ledgerPage - 1) * ledgerLimit + 1
    const ledgerTo = Math.min(ledgerPage * ledgerLimit, ledgerTotal)

    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>流水明细</h2>
            <p>记录入库 / 出库 / 调整全量变更</p>
          </div>
          <div className="toolbar">
            <select
              value={ledgerLimit}
              onChange={(e) => {
                setLedgerLimit(Number(e.target.value || 50))
                setLedgerPage(1)
              }}
              style={{ width: 120 }}
            >
              {gridPageSizes.map((size) => (
                <option key={`ledger-limit-${size}`} value={size}>
                  每页 {size}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={refreshLedger}>
              刷新
            </button>
          </div>
        </div>

        <div className="ledger-filter-grid">
          <div className="field">
            <label>商品</label>
            <select
              value={ledgerFilter.product_id}
              onChange={(e) => updateLedgerFilter('product_id', e.target.value)}
            >
              <option value="">全部商品</option>
              {products.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.sku} / {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>存放位置</label>
            <select
              value={ledgerFilter.storage_location_id}
              onChange={(e) => updateLedgerFilter('storage_location_id', e.target.value)}
            >
              <option value="">全部位置</option>
              {storageLocations.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.code} / {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>变更类型</label>
            <select
              value={ledgerFilter.change_type}
              onChange={(e) => updateLedgerFilter('change_type', e.target.value)}
            >
              <option value="">全部</option>
              <option value="IN">入库</option>
              <option value="OUT">出库</option>
              <option value="ADJUST">调整</option>
            </select>
          </div>
          <div className="field">
            <label>批次号</label>
            <input
              value={ledgerFilter.batch_no}
              onChange={(e) => updateLedgerFilter('batch_no', e.target.value)}
              placeholder="输入批次号"
            />
          </div>
          <div className="field">
            <label>序列号(SN)</label>
            <input
              value={ledgerFilter.serial_no}
              onChange={(e) => updateLedgerFilter('serial_no', e.target.value)}
              placeholder="输入SN"
            />
          </div>
          <div className="field">
            <label>开始日期</label>
            <input
              type="date"
              value={ledgerFilter.from}
              onChange={(e) => updateLedgerFilter('from', e.target.value)}
            />
          </div>
          <div className="field">
            <label>结束日期</label>
            <input
              type="date"
              value={ledgerFilter.to}
              onChange={(e) => updateLedgerFilter('to', e.target.value)}
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table ledger-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>商品</th>
                <th>存放位置</th>
                <th>使用位置</th>
                <th>变动</th>
                <th>变动前</th>
                <th>变动后</th>
                <th>批次号</th>
                <th>序列号</th>
                <th>来源</th>
                <th>操作人</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row) => (
                <tr key={row.id}>
                  <td>{parseApiDate(row.occurred_at)}</td>
                  <td>
                    <span className={`type-chip ${String(row.change_type || '').toLowerCase()}`}>
                      {formatChangeTypeLabel(row.change_type)}
                    </span>
                  </td>
                  <td>
                    {row.sku} / {row.product_name}
                  </td>
                  <td>
                    {row.storage_location_code} / {row.storage_location_name}
                  </td>
                  <td>
                    {row.usage_location_code
                      ? `${row.usage_location_code} / ${row.usage_location_name}`
                      : '-'}
                  </td>
                  <td>{formatNum(row.qty_change)}</td>
                  <td>{formatNum(row.qty_before)}</td>
                  <td>{formatNum(row.qty_after)}</td>
                  <td>{row.batch_no || '-'}</td>
                  <td>{row.serial_no || '-'}</td>
                  <td>
                    {formatRefTypeLabel(row.ref_type, row.ref_id)}
                  </td>
                  <td>{row.operator_name || '-'}</td>
                  <td>{row.note || '-'}</td>
                </tr>
              ))}
              {ledgerRows.length === 0 ? (
                <tr>
                  <td colSpan={13}>暂无流水数据</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <div className="small">
            共 {formatNum(ledgerTotal)} 条，当前显示 {formatNum(ledgerFrom)} - {formatNum(ledgerTo)}
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              disabled={ledgerPage <= 1}
              onClick={() => setLedgerPage((prev) => Math.max(1, prev - 1))}
            >
              上一页
            </button>
            <span className="small">
              第 {ledgerPage} / {ledgerTotalPages} 页
            </span>
            <button
              type="button"
              className="btn"
              disabled={ledgerPage >= ledgerTotalPages}
              onClick={() => setLedgerPage((prev) => Math.min(ledgerTotalPages, prev + 1))}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
    )
  }

  const renderOperationLogs = () => {
    if (!canViewAudit) {
      return (
        <section className="panel">
          <div className="inline-msg error">当前角色无权限查看审计日志。</div>
        </section>
      )
    }

    const actionOptions = [
      'PRODUCT_CREATE',
      'PRODUCT_UPDATE',
      'PRODUCT_DELETE',
      'STORAGE_LOCATION_CREATE',
      'STORAGE_LOCATION_UPDATE',
      'STORAGE_LOCATION_DELETE',
      'USAGE_LOCATION_CREATE',
      'USAGE_LOCATION_UPDATE',
      'USAGE_LOCATION_DELETE',
      'STOCK_IN_CREATE',
      'STOCK_IN_UPDATE',
      'STOCK_OUT_CREATE',
      'STOCKTAKE_CREATE',
      'SHIPPING_CREATE',
      'SHIPPING_UPDATE',
    ]
    const entityOptions = [
      'product',
      'storage_location',
      'usage_location',
      'stock_in_order',
      'stock_out_order',
      'stocktake_order',
      'shipping_order',
    ]
    const totalPages = Math.max(1, Math.ceil(Math.max(operationLogTotal, 0) / operationLogLimit))
    const rowFrom = operationLogTotal === 0 ? 0 : (operationLogPage - 1) * operationLogLimit + 1
    const rowTo = Math.min(operationLogPage * operationLogLimit, operationLogTotal)

    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>审计日志</h2>
            <p>记录库存系统关键写操作，支持审计员角色查看</p>
          </div>
          <div className="toolbar">
            <select
              value={operationLogLimit}
              onChange={(e) => {
                setOperationLogLimit(Number(e.target.value || 50))
                setOperationLogPage(1)
              }}
              style={{ width: 120 }}
            >
              {gridPageSizes.map((size) => (
                <option key={`op-log-limit-${size}`} value={size}>
                  每页 {size}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={refreshOperationLogs}>
              刷新
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onExportOperationLogs}
              disabled={busy || operationLogTotal <= 0}
            >
              导出表格
            </button>
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: 10 }}>
          <div className="field">
            <label>操作人</label>
            <input
              value={operationLogFilter.username}
              onChange={(e) => updateOperationLogFilter('username', e.target.value)}
              placeholder="用户名模糊匹配"
            />
          </div>
          <div className="field">
            <label>动作</label>
            <select
              value={operationLogFilter.action}
              onChange={(e) => updateOperationLogFilter('action', e.target.value)}
            >
              <option value="">全部动作</option>
              {actionOptions.map((item) => (
                <option value={item} key={`action-${item}`}>
                  {formatAuditActionLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>实体</label>
            <select
              value={operationLogFilter.entity}
              onChange={(e) => updateOperationLogFilter('entity', e.target.value)}
            >
              <option value="">全部实体</option>
              {entityOptions.map((item) => (
                <option value={item} key={`entity-${item}`}>
                  {formatAuditEntityLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>关键字</label>
            <input
              value={operationLogFilter.keyword}
              onChange={(e) => updateOperationLogFilter('keyword', e.target.value)}
              placeholder="描述/实体ID/变更内容"
            />
          </div>
          <div className="field">
            <label>开始日期</label>
            <input
              type="date"
              value={operationLogFilter.from}
              onChange={(e) => updateOperationLogFilter('from', e.target.value)}
            />
          </div>
          <div className="field">
            <label>结束日期</label>
            <input
              type="date"
              value={operationLogFilter.to}
              onChange={(e) => updateOperationLogFilter('to', e.target.value)}
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>角色</th>
                <th>动作</th>
                <th>实体</th>
                <th>实体编号</th>
                <th>描述</th>
                <th>变更内容</th>
                <th>来源IP</th>
              </tr>
            </thead>
            <tbody>
              {operationLogs.map((row) => {
                const beforeText = formatAuditPayload(row.before_data)
                const afterText = formatAuditPayload(row.after_data)
                return (
                  <tr key={row.id}>
                    <td>{parseApiDate(row.created_at)}</td>
                    <td>{row.username || '-'}</td>
                    <td>{formatRoleLabel(row.user_role)}</td>
                    <td>{formatAuditActionLabel(row.action)}</td>
                    <td>{formatAuditEntityLabel(row.entity)}</td>
                    <td>{row.entity_id || '-'}</td>
                    <td>{row.message || '-'}</td>
                    <td>
                      {beforeText || afterText ? (
                        <details className="json-cell">
                          <summary>查看</summary>
                          {beforeText ? <pre>变更前:\n{beforeText}</pre> : null}
                          {afterText ? <pre>变更后:\n{afterText}</pre> : null}
                        </details>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{row.request_ip || '-'}</td>
                  </tr>
                )
              })}
              {operationLogs.length === 0 ? (
                <tr>
                  <td colSpan={9}>暂无审计日志</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="toolbar" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <div className="small">
            共 {formatNum(operationLogTotal)} 条，当前显示 {formatNum(rowFrom)} - {formatNum(rowTo)}
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              disabled={operationLogPage <= 1}
              onClick={() => setOperationLogPage((prev) => Math.max(1, prev - 1))}
            >
              上一页
            </button>
            <span className="small">
              第 {operationLogPage} / {totalPages} 页
            </span>
            <button
              type="button"
              className="btn"
              disabled={operationLogPage >= totalPages}
              onClick={() => setOperationLogPage((prev) => Math.min(totalPages, prev + 1))}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
    )
  }

  const renderContent = () => {
    if (activeMenu === 'dashboard') return renderDashboard()
    if (activeMenu === 'insights') return renderInsights()
    if (activeMenu === 'products') return renderProducts()
    if (activeMenu === 'storage') return renderStorage()
    if (activeMenu === 'usage') return renderUsage()
    if (activeMenu === 'stockIn') return renderStockIn()
    if (activeMenu === 'stockOut') return renderStockOut()
    if (activeMenu === 'shipping') return renderShipping()
    if (activeMenu === 'stocktake') return renderStocktake()
    if (activeMenu === 'traceability') return renderTraceability()
    if (activeMenu === 'balances') return renderBalances()
    if (activeMenu === 'ledger') return renderLedger()
    if (activeMenu === 'operationLogs') return renderOperationLogs()
    return null
  }

  if (!token || !user) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <h2>库存管理系统</h2>
          <p>账号由聚信统一登录系统托管，当前正在跳转或等待登录。</p>

          {errorMsg ? <div className="inline-msg error">{errorMsg}</div> : null}
          {successMsg ? <div className="inline-msg success">{successMsg}</div> : null}

          <div className="login-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                window.location.href = buildPortalEntryUrl('inventory')
              }}
            >
              前往统一登录
            </button>
          </div>

          <div className="footer-note">统一登录后将自动返回库存系统。</div>
        </section>
      </main>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>
            <span className="brand-red">聚信</span>
            <span className="brand-blue">库存系统</span>
          </strong>
          <div className="user-pill">
            {user.username} / {formatRoleLabel(user.role)}
          </div>
        </div>

        <nav className="menu">
          {visibleMenuItems.map((item) => (
            <button
              type="button"
              key={item.key}
              className={activeMenu === item.key ? 'active' : ''}
              onClick={() => setActiveMenu(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-actions">
          <button className="btn" type="button" onClick={refreshAll} disabled={busy || loading}>
            刷新全部
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              window.location.href = buildPortalSwitchUrl('inventory')
            }}
          >
            切换系统
          </button>
          <button className="btn btn-danger" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <div className="small">库存管理平台</div>
            <h1>{currentTitle}</h1>
            <p>商品存放位置 + 使用位置 + 出入库 + 盘点 + 预警一体化</p>
          </div>
        </header>

        {loading ? <div className="inline-msg success">数据加载中...</div> : null}
        {errorMsg ? <div className="inline-msg error">{errorMsg}</div> : null}
        {successMsg ? <div className="inline-msg success">{successMsg}</div> : null}

        {renderContent()}
      </main>

      {stockInEditOpen ? (
        <div
          className="floating-modal-mask"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeStockInEditModal()
            }
          }}
        >
          <section
            className={`floating-modal ${stockInEditDragging ? 'dragging' : ''}`}
            ref={stockInEditDialogRef}
            style={{
              transform: `translate(calc(-50% + ${stockInEditPosition.x}px), calc(-50% + ${stockInEditPosition.y}px))`,
            }}
          >
            <header className="floating-modal-header" onPointerDown={onStartStockInEditDrag}>
              <div>
                <h3>编辑入库单</h3>
                <div className="small">
                  单号：{stockInEditOrderNo || '-'} | 拖动标题栏可移动
                </div>
              </div>
              <button type="button" className="btn" onClick={closeStockInEditModal} disabled={stockInEditSaving}>
                关闭
              </button>
            </header>

            <div className="floating-modal-body">
              {stockInEditLoading ? (
                <div className="inline-msg success">正在加载入库单详情...</div>
              ) : (
                <form onSubmit={onSubmitStockInEdit}>
                  <div className="inline-msg success">提示：含批次/SN的历史入库单暂不支持编辑，请作废后重新入库。</div>
                  <div className="grid-3">
                    <div className="field">
                      <label>供应商</label>
                      <input
                        value={stockInEditForm.supplier}
                        onChange={(e) => setStockInEditForm((prev) => ({ ...prev, supplier: e.target.value }))}
                        placeholder="可选"
                      />
                    </div>
                    <div className="field">
                      <label>备注</label>
                      <input
                        value={stockInEditForm.remark}
                        onChange={(e) => setStockInEditForm((prev) => ({ ...prev, remark: e.target.value }))}
                        placeholder="例如：采购补货"
                      />
                    </div>
                    <div className="field" style={{ alignSelf: 'end' }}>
                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setStockInEditForm((prev) => ({
                              ...prev,
                              items: [...prev.items, emptyStockInItem()],
                            }))
                          }
                          disabled={stockInEditSaving}
                        >
                          新增明细行
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={stockInEditSaving}>
                          {stockInEditSaving ? '保存中...' : '保存修改'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="line-items" style={{ marginTop: 12 }}>
                    {stockInEditForm.items.map((item, index) => {
                      const stockSnapshot = productStockMap.get(String(item.product_id)) || {
                        safetyStock: 0,
                        currentStock: 0,
                      }

                      return (
                        <div className="line-item-row" key={`stock-in-edit-${index}`}>
                          <div className="field">
                            <label>商品</label>
                            <select
                              value={item.product_id}
                              onChange={(e) => updateStockInEditItem(index, 'product_id', e.target.value)}
                            >
                              <option value="">请选择商品</option>
                              {products
                                .filter((p) => Number(p.is_active) === 1 || String(p.id) === String(item.product_id))
                                .map((p) => (
                                  <option value={p.id} key={p.id}>
                                    {p.sku} / {p.name}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div className="field">
                            <label>存放位置</label>
                            <select
                              value={item.storage_location_id}
                              onChange={(e) => updateStockInEditItem(index, 'storage_location_id', e.target.value)}
                            >
                              <option value="">请选择位置</option>
                              {storageLocations
                                .filter((s) => Number(s.is_active) === 1 || String(s.id) === String(item.storage_location_id))
                                .map((s) => (
                                  <option value={s.id} key={s.id}>
                                    {s.code} / {s.name}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div className="field">
                            <label>安全库存</label>
                            <input value={formatNum(stockSnapshot.safetyStock)} readOnly tabIndex={-1} />
                          </div>

                          <div className="field">
                            <label>当前库存</label>
                            <input value={formatNum(stockSnapshot.currentStock)} readOnly tabIndex={-1} />
                          </div>

                          <div className="field">
                            <label>数量</label>
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={item.quantity}
                              onChange={(e) => updateStockInEditItem(index, 'quantity', e.target.value)}
                            />
                          </div>

                          <div className="field">
                            <label>批次号</label>
                            <input
                              value={item.batch_no}
                              onChange={(e) => updateStockInEditItem(index, 'batch_no', e.target.value)}
                              placeholder="可选"
                            />
                          </div>

                          <div className="field">
                            <label>序列号(SN)</label>
                            <textarea
                              className="serial-input"
                              value={item.serial_nos}
                              onChange={(e) => updateStockInEditItem(index, 'serial_nos', e.target.value)}
                              placeholder="可选，多个SN用逗号或换行分隔"
                            />
                          </div>

                          <div className="field">
                            <label>成本价</label>
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={item.unit_cost}
                              onChange={(e) => updateStockInEditItem(index, 'unit_cost', e.target.value)}
                            />
                          </div>

                          <button
                            className="btn btn-danger"
                            type="button"
                            onClick={() =>
                              setStockInEditForm((prev) => ({
                                ...prev,
                                items: prev.items.filter((_, idx) => idx !== index),
                              }))
                            }
                            disabled={stockInEditForm.items.length === 1 || stockInEditSaving}
                          >
                            删除
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {shippingEditOpen ? (
        <div
          className="floating-modal-mask"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeShippingEditModal()
            }
          }}
        >
          <section
            className={`floating-modal shipping-edit-modal ${shippingEditDragging ? 'dragging' : ''}`}
            ref={shippingEditDialogRef}
            style={{
              transform: `translate(calc(-50% + ${shippingEditPosition.x}px), calc(-50% + ${shippingEditPosition.y}px))`,
            }}
          >
            <header className="floating-modal-header" onPointerDown={onStartShippingEditDrag}>
              <div>
                <h3>编辑发货单</h3>
                <div className="small">
                  发货单号：{shippingEditOrderNo || '-'} | 拖动标题栏可移动
                </div>
              </div>
              <button type="button" className="btn" onClick={closeShippingEditModal} disabled={shippingEditSaving}>
                关闭
              </button>
            </header>

            <div className="floating-modal-body">
              {shippingEditLoading ? (
                <div className="inline-msg success">正在加载发货单详情...</div>
              ) : (
                <form onSubmit={onSubmitShippingEdit}>
                  <div className="grid-3">
                    <div className="field">
                      <label>物流公司</label>
                      <input
                        value={shippingEditForm.carrier}
                        onChange={(e) => setShippingEditForm((prev) => ({ ...prev, carrier: e.target.value }))}
                        placeholder="例如：顺丰"
                      />
                    </div>
                    <div className="field">
                      <label>快递单号</label>
                      <input
                        value={shippingEditForm.tracking_no}
                        onChange={(e) => setShippingEditForm((prev) => ({ ...prev, tracking_no: e.target.value }))}
                        placeholder="必填"
                      />
                    </div>
                    <div className="field">
                      <label>发货状态</label>
                      <select
                        value={shippingEditForm.status}
                        onChange={(e) => setShippingEditForm((prev) => ({ ...prev, status: e.target.value }))}
                      >
                        <option value="PENDING">待发货</option>
                        <option value="SHIPPED">已发货</option>
                        <option value="IN_TRANSIT">运输中</option>
                        <option value="SIGNED">已签收</option>
                        <option value="EXCEPTION">异常</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid-3" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label>收货人</label>
                      <input
                        value={shippingEditForm.receiver_name}
                        onChange={(e) => setShippingEditForm((prev) => ({ ...prev, receiver_name: e.target.value }))}
                        placeholder="例如：张三"
                      />
                    </div>
                    <div className="field">
                      <label>联系电话</label>
                      <input
                        value={shippingEditForm.receiver_phone}
                        onChange={(e) => setShippingEditForm((prev) => ({ ...prev, receiver_phone: e.target.value }))}
                        placeholder="例如：13800000000"
                      />
                    </div>
                    <div className="field">
                      <label>发货时间</label>
                      <input
                        type="datetime-local"
                        value={shippingEditForm.shipped_at}
                        onChange={(e) => setShippingEditForm((prev) => ({ ...prev, shipped_at: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="field" style={{ marginTop: 10 }}>
                    <label>收货地址</label>
                    <input
                      value={shippingEditForm.receiver_address}
                      onChange={(e) => setShippingEditForm((prev) => ({ ...prev, receiver_address: e.target.value }))}
                      placeholder="例如：上海市浦东新区..."
                    />
                  </div>

                  <div className="field" style={{ marginTop: 10 }}>
                    <label>备注</label>
                    <textarea
                      value={shippingEditForm.remark}
                      onChange={(e) => setShippingEditForm((prev) => ({ ...prev, remark: e.target.value }))}
                      placeholder="可选"
                    />
                  </div>

                  <div className="toolbar" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setShippingEditOpen(false)
                        onOpenShippingTrack(
                          {
                            id: shippingEditOrderId,
                            shipment_no: shippingEditOrderNo,
                          },
                          false
                        )
                      }}
                    >
                      查看轨迹
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={shippingEditSaving}>
                      {shippingEditSaving ? '保存中...' : '保存修改'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {shippingDetailOpen ? (
        <div
          className="floating-modal-mask"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeShippingDetailModal()
            }
          }}
        >
          <section
            className={`floating-modal shipping-detail-modal ${shippingDetailDragging ? 'dragging' : ''}`}
            ref={shippingDetailDialogRef}
            style={{
              transform: `translate(calc(-50% + ${shippingDetailPosition.x}px), calc(-50% + ${shippingDetailPosition.y}px))`,
            }}
          >
            <header className="floating-modal-header" onPointerDown={onStartShippingDetailDrag}>
              <div>
                <h3>发货详情</h3>
                <div className="small">发货单号：{shippingDetailOrder?.shipment_no || '-'} | 拖动标题栏可移动</div>
              </div>
              <button type="button" className="btn" onClick={closeShippingDetailModal}>
                关闭
              </button>
            </header>

            <div className="floating-modal-body">
              {shippingDetailLoading ? (
                <div className="inline-msg success">正在加载发货详情...</div>
              ) : shippingDetailOrder ? (
                <>
                  <div className="grid-3 shipping-detail-grid">
                    <div className="field">
                      <label>关联出库单</label>
                      <input value={shippingDetailOrder.stock_out_order_no || '-'} readOnly tabIndex={-1} />
                    </div>
                    <div className="field">
                      <label>物流公司</label>
                      <input value={shippingDetailOrder.carrier || '-'} readOnly tabIndex={-1} />
                    </div>
                    <div className="field">
                      <label>快递单号</label>
                      <input value={shippingDetailOrder.tracking_no || '-'} readOnly tabIndex={-1} />
                    </div>
                    <div className="field">
                      <label>发货状态</label>
                      <div>
                        <span className={`ship-chip ${shippingStatusClassName(shippingDetailOrder.status)}`}>
                          {formatShippingStatusLabel(shippingDetailOrder.status)}
                        </span>
                      </div>
                    </div>
                    <div className="field">
                      <label>发货时间</label>
                      <input value={parseApiDate(shippingDetailOrder.shipped_at)} readOnly tabIndex={-1} />
                    </div>
                    <div className="field">
                      <label>更新时间</label>
                      <input value={parseApiDate(shippingDetailOrder.updated_at)} readOnly tabIndex={-1} />
                    </div>
                    <div className="field">
                      <label>收货人</label>
                      <input value={shippingDetailOrder.receiver_name || '-'} readOnly tabIndex={-1} />
                    </div>
                    <div className="field">
                      <label>联系电话</label>
                      <input value={shippingDetailOrder.receiver_phone || '-'} readOnly tabIndex={-1} />
                    </div>
                    <div className="field">
                      <label>创建时间</label>
                      <input value={parseApiDate(shippingDetailOrder.created_at)} readOnly tabIndex={-1} />
                    </div>
                  </div>

                  <div className="field shipping-detail-address">
                    <label>收货地址</label>
                    <textarea value={shippingDetailOrder.receiver_address || '-'} readOnly tabIndex={-1} />
                  </div>

                  <div className="field shipping-detail-remark">
                    <label>备注</label>
                    <textarea value={shippingDetailOrder.remark || '-'} readOnly tabIndex={-1} />
                  </div>

                  <div className="toolbar shipping-detail-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={async () => {
                        const shippingOrderId = Number(shippingDetailOrder?.id || 0)
                        if (!shippingOrderId) return
                        try {
                          setShippingDetailLoading(true)
                          const detail = await apiRequest(`/api/inventory/shipping-orders/${shippingOrderId}`)
                          setShippingDetailOrder(detail || null)
                        } catch (err) {
                          showError(err.message)
                        } finally {
                          setShippingDetailLoading(false)
                        }
                      }}
                    >
                      刷新详情
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        closeShippingDetailModal()
                        onOpenShippingTrack(shippingDetailOrder, false)
                      }}
                    >
                      查看轨迹
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        closeShippingDetailModal()
                        onPrintShipping(shippingDetailOrder)
                      }}
                    >
                      打印面单
                    </button>
                    {canOperateInventory ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          closeShippingDetailModal()
                          onOpenShippingEdit(shippingDetailOrder)
                        }}
                      >
                        编辑发货
                      </button>
                    ) : null}
                    {canOperateInventory && String(shippingDetailOrder.status).toUpperCase() === 'PENDING' ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onUpdateShippingStatus(shippingDetailOrder, 'SHIPPED')}
                      >
                        标记发货
                      </button>
                    ) : null}
                    {canOperateInventory && String(shippingDetailOrder.status).toUpperCase() === 'SHIPPED' ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onUpdateShippingStatus(shippingDetailOrder, 'IN_TRANSIT')}
                      >
                        标记运输中
                      </button>
                    ) : null}
                    {canOperateInventory &&
                    (String(shippingDetailOrder.status).toUpperCase() === 'SHIPPED' ||
                      String(shippingDetailOrder.status).toUpperCase() === 'IN_TRANSIT') ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => onUpdateShippingStatus(shippingDetailOrder, 'SIGNED')}
                      >
                        标记签收
                      </button>
                    ) : null}
                    {canOperateInventory &&
                    String(shippingDetailOrder.status).toUpperCase() !== 'SIGNED' &&
                    String(shippingDetailOrder.status).toUpperCase() !== 'EXCEPTION' ? (
                      <button type="button" className="btn btn-warning" onClick={() => onMarkShippingAbnormal(shippingDetailOrder)}>
                        标记异常
                      </button>
                    ) : null}
                  </div>

                  <div className="table-wrap shipping-detail-items">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>商品</th>
                          <th>存放位置</th>
                          <th>数量</th>
                          <th>单位</th>
                          <th>批次号</th>
                          <th>序列号</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(shippingDetailOrder.stock_out_items) ? shippingDetailOrder.stock_out_items : []).map((item) => (
                          <tr key={`shipping-detail-item-${item.id}`}>
                            <td>{item.sku || '-'}</td>
                            <td>{item.product_name || '-'}</td>
                            <td>
                              {item.storage_location_code || '-'} / {item.storage_location_name || '-'}
                            </td>
                            <td>{formatNum(item.quantity)}</td>
                            <td>{item.unit || '-'}</td>
                            <td>{item.batch_no || '-'}</td>
                            <td>{item.serial_no || '-'}</td>
                          </tr>
                        ))}
                        {(Array.isArray(shippingDetailOrder.stock_out_items) ? shippingDetailOrder.stock_out_items : []).length === 0 ? (
                          <tr>
                            <td colSpan={7}>暂无出库明细</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="inline-msg error">未找到发货单详情</div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {shippingTrackOpen ? (
        <div
          className="floating-modal-mask"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShippingTrackOpen(false)
            }
          }}
        >
          <section className="floating-modal shipping-track-modal">
            <header className="floating-modal-header">
              <div>
                <h3>物流轨迹</h3>
                <div className="small">
                  发货单号：{shippingTrackOrder?.shipment_no || '-'} / 快递单号：{shippingTrackOrder?.tracking_no || '-'}
                </div>
              </div>
              <div className="toolbar">
                <button type="button" className="btn" onClick={() => onRefreshShippingTrack(false)} disabled={shippingTrackLoading}>
                  刷新本地
                </button>
                <button type="button" className="btn" onClick={() => onRefreshShippingTrack(true)} disabled={shippingTrackLoading}>
                  拉取物流接口
                </button>
                <button
                  type="button"
                  className={`btn ${shippingTrackAutoRefresh ? 'btn-primary' : ''}`}
                  onClick={() => setShippingTrackAutoRefresh((prev) => !prev)}
                >
                  自动刷新：{shippingTrackAutoRefresh ? '开' : '关'}
                </button>
                <button type="button" className="btn" onClick={() => setShippingTrackOpen(false)}>
                  关闭
                </button>
              </div>
            </header>

            <div className="floating-modal-body">
              <div className="small" style={{ marginBottom: 8 }}>
                自动刷新频率：{Math.round(shippingTrackAutoRefreshIntervalMs / 1000)} 秒
              </div>
              {shippingTrackLoading ? <div className="inline-msg success">正在加载轨迹...</div> : null}

              {shippingTrackLiveMeta.enabled ? (
                <div className={`inline-msg ${shippingTrackLiveMeta.error ? 'error' : 'success'}`}>
                  拉取结果：新增 {formatNum(shippingTrackLiveMeta.inserted)} 条，返回 {formatNum(shippingTrackLiveMeta.fetched)} 条
                  {shippingTrackLiveMeta.error ? `，错误：${shippingTrackLiveMeta.error}` : ''}
                </div>
              ) : (
                <div className="inline-msg success">未配置第三方物流接口，当前显示库存系统内轨迹</div>
              )}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>状态</th>
                      <th>位置</th>
                      <th>节点信息</th>
                      <th>来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shippingTrackEvents.map((item) => (
                      <tr key={`track-${item.id}`}>
                        <td>{parseApiDate(item.event_time)}</td>
                        <td>
                          <span className={`ship-chip ${shippingStatusClassName(item.status || shippingTrackOrder?.status)}`}>
                            {formatShippingStatusLabel(item.status || shippingTrackOrder?.status)}
                          </span>
                        </td>
                        <td>{item.location || '-'}</td>
                        <td>{item.description || '-'}</td>
                        <td>{item.source || '-'}</td>
                      </tr>
                    ))}
                    {shippingTrackEvents.length === 0 ? (
                      <tr>
                        <td colSpan={5}>暂无轨迹数据</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App

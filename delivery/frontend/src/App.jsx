import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

const stageLabelMap = {
  INIT: '立项准备',
  ASSESS: '评估分析',
  IMPLEMENT: '实施部署',
  TUNE: '联调优化',
  TRIAL: '试运行',
  ACCEPT: '验收确认',
  HANDOVER: '运维移交',
  CLOSED: '归档关闭',
}

const timelineActionLabelMap = {
  CREATE: '创建项目',
  ASSESS: '执行评估',
  IMPLEMENT: '执行实施',
  TUNE: '执行联调',
  TRIAL: '执行试运行',
  ACCEPT: '执行验收',
  HANDOVER: '执行移交',
  CLOSE: '执行归档',
  REWORK: '退回重做',
}

const nextActionByStage = {
  INIT: 'assess',
  ASSESS: 'implement',
  IMPLEMENT: 'tune',
  TUNE: 'trial',
  TRIAL: 'accept',
  ACCEPT: 'handover',
  HANDOVER: 'close',
}

const actionLabelMap = {
  assess: '执行评估',
  implement: '执行实施',
  tune: '执行联调',
  trial: '执行试运行',
  accept: '执行验收',
  handover: '执行移交',
  close: '执行归档',
}

const actionAllowedRoles = {
  assess: ['admin', 'editor', 'reviewer', 'user', 'sales'],
  implement: ['admin', 'editor', 'reviewer', 'user', 'sales'],
  tune: ['admin', 'editor', 'reviewer', 'user', 'sales'],
  trial: ['admin', 'editor', 'reviewer', 'user', 'sales'],
  accept: ['admin', 'editor', 'reviewer', 'user', 'sales'],
  handover: ['admin', 'editor'],
  close: ['admin'],
}

const stageSequence = Object.keys(stageLabelMap)

const payloadLabelMap = {
  cpu_match: '实施参数校验',
  memory_match: '接入连通性',
  disk_match: '权限配置校验',
  nic_match: '策略下发校验',
  serial_match: '资产标识校验',
  hardware_note: '实施参数备注',
  os_name: '平台名称',
  os_version: '平台版本',
  install_mode: '部署方式',
  install_result: '联调结果',
  install_note: '联调备注',
  boot_test: '告警链路测试',
  network_test: '策略联动测试',
  stress_test: '业务压测验证',
  test_result: '试运行结论',
  burnin_hours: '试运行时长(小时)',
  test_note: '试运行备注',
  approve_result: '验收结论',
  approve_note: '验收备注',
  reviewer_comment: '验收意见',
  package_check: '移交文档完整',
  accessory_check: '培训交接完成',
  box_no: '移交编号',
  pack_note: '移交备注',
  carrier: '归档责任人',
  shipped_note: '归档备注',
  receive_note: '评估备注',
  current_stage: '当前阶段',
  status: '状态',
  stage_action: '阶段动作',
  stage_record_id: '阶段记录ID',
  stage_payload: '阶段参数',
  stage_code: '阶段编码',
  stage_label: '阶段名称',
  from_stage: '起始阶段',
  to_stage: '目标阶段',
  reason: '原因',
  source: '来源',
  deleted: '已删除',
  job_no: '交付单号',
  project_code: '项目编码',
  product_type: '产品类型',
  customer_name: '客户名称',
  sales_order_no: '销售订单号',
  inbound_tracking_no: '交付单号',
  outbound_tracking_no: '验收单号',
  threshold_hours: 'SLA阈值(小时)',
  overdue_hours: '超时小时',
  remind_interval_minutes: '提醒间隔(分钟)',
  enabled: '是否启用',
  file_name: '文件名',
  file_size: '文件大小',
  attachment_id: '附件ID',
  operator_name: '操作人',
  operator_role: '操作角色',
  created_at: '创建时间',
  updated_at: '更新时间',
}

const initialAdvanceForm = {
  remark: '',
  inbound_tracking_no: '',
  outbound_tracking_no: '',
  receive_note: '',
  cpu_match: 'PASS',
  memory_match: 'PASS',
  disk_match: 'PASS',
  nic_match: 'PASS',
  serial_match: 'PASS',
  hardware_note: '',
  os_name: '',
  os_version: '',
  install_mode: '',
  install_result: 'PASS',
  install_note: '',
  boot_test: 'PASS',
  network_test: 'PASS',
  stress_test: 'PASS',
  test_result: 'PASS',
  burnin_hours: '',
  test_note: '',
  approve_result: 'PASS',
  approve_note: '',
  reviewer_comment: '',
  package_check: 'PASS',
  accessory_check: 'PASS',
  box_no: '',
  pack_note: '',
  carrier: '',
  shipped_note: '',
}

const parseApiDate = (value) => {
  if (!value) return '-'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const stageText = (value) => {
  const key = String(value || '').toUpperCase()
  return stageLabelMap[key] || value || '-'
}

const timelineActionText = (value) => {
  const key = String(value || '').toUpperCase()
  return timelineActionLabelMap[key] || value || '-'
}

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
    const csrfResp = await fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' })
    if (!csrfResp.ok) return false
    let csrfToken = ''
    try {
      const csrfPayload = await csrfResp.json()
      csrfToken = String(csrfPayload?.token || '')
    } catch {
      csrfToken = ''
    }
    if (!csrfToken) return false
    const logoutResp = await fetch(`${API_BASE}/api/auth/logout`, {
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

const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

const normalizeRole = (role) => String(role || '').toLowerCase()

const roleCanDoAction = (role, action) => {
  const allowed = actionAllowedRoles[action] || []
  return allowed.includes(normalizeRole(role))
}

const formatStagePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return []
  return Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${payloadLabelMap[k] || k}: ${v}`)
}

const buildStagePayloadByAction = (action, form) => {
  if (action === 'assess') {
    return { receive_note: form.receive_note }
  }
  if (action === 'implement') {
    return {
      cpu_match: form.cpu_match,
      memory_match: form.memory_match,
      disk_match: form.disk_match,
      nic_match: form.nic_match,
      serial_match: form.serial_match,
      hardware_note: form.hardware_note,
    }
  }
  if (action === 'tune') {
    return {
      os_name: form.os_name,
      os_version: form.os_version,
      install_mode: form.install_mode,
      install_result: form.install_result,
      install_note: form.install_note,
    }
  }
  if (action === 'trial') {
    return {
      boot_test: form.boot_test,
      network_test: form.network_test,
      stress_test: form.stress_test,
      test_result: form.test_result,
      burnin_hours: form.burnin_hours,
      test_note: form.test_note,
    }
  }
  if (action === 'accept') {
    return {
      approve_result: form.approve_result,
      approve_note: form.approve_note,
      reviewer_comment: form.reviewer_comment,
    }
  }
  if (action === 'handover') {
    return {
      package_check: form.package_check,
      accessory_check: form.accessory_check,
      box_no: form.box_no,
      pack_note: form.pack_note,
    }
  }
  if (action === 'close') {
    return {
      carrier: form.carrier,
      shipped_note: form.shipped_note,
    }
  }
  return null
}

const trimText = (value) => String(value || '').trim()

const ensureFailNote = (result, note, remark, label) => {
  if (result === 'FAIL' && !trimText(note) && !trimText(remark)) {
    return `${label}为不通过时，必须填写说明（备注或说明字段）`
  }
  return ''
}

const validateAdvanceForm = (action, form) => {
  const remark = trimText(form.remark)
  if (!action) return ''

  if (action === 'implement') {
    const hasFail = [form.cpu_match, form.memory_match, form.disk_match, form.nic_match, form.serial_match].includes('FAIL')
    if (hasFail) return ensureFailNote('FAIL', form.hardware_note, remark, '实施参数项')
    return ''
  }

  if (action === 'tune') {
    if (!trimText(form.os_name)) return '平台名称不能为空'
    if (!trimText(form.os_version)) return '平台版本不能为空'
    return ensureFailNote(form.install_result, form.install_note, remark, '联调结果')
  }

  if (action === 'trial') {
    if (trimText(form.burnin_hours)) {
      const burnin = Number(form.burnin_hours)
      if (!Number.isFinite(burnin) || burnin < 0 || burnin > 9999) return '试运行时长必须是 0-9999 的数字'
    }
    return ensureFailNote(form.test_result, form.test_note, remark, '试运行结论')
  }

  if (action === 'accept') {
    return ensureFailNote(form.approve_result, `${trimText(form.approve_note)}${trimText(form.reviewer_comment)}`, remark, '验收结论')
  }

  if (action === 'handover') {
    if (!trimText(form.box_no)) return '移交编号不能为空'
    const hasFail = form.package_check === 'FAIL' || form.accessory_check === 'FAIL'
    if (hasFail) return ensureFailNote('FAIL', form.pack_note, remark, '移交检查')
    return ''
  }

  if (action === 'close') {
    if (!trimText(form.carrier)) return '归档责任人不能为空'
    if (!trimText(form.outbound_tracking_no)) return '验收单号不能为空'
    return ''
  }

  return ''
}

const tryParseAuditData = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return value
  const text = String(value).trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_err) {
    return text
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const isEqualForSummary = (a, b) => {
  if (a === b) return true
  if ((typeof a !== 'object' || a === null) || (typeof b !== 'object' || b === null)) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch (_err) {
    return false
  }
}

const formatAuditValueBrief = (value) => {
  if (value === null || value === undefined || value === '') return '空'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '无效数字'
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim()
    if (!text) return '空'
    return text.length > 24 ? `${text.slice(0, 24)}...` : text
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '空数组'
    const primitive = value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
    if (primitive) {
      const joined = value.map((item) => formatAuditValueBrief(item)).join('、')
      return joined.length > 30 ? `${joined.slice(0, 30)}...` : joined
    }
    return `数组(${value.length}项)`
  }
  if (isPlainObject(value)) {
    const size = Object.keys(value).length
    return size > 0 ? `对象(${size}个字段)` : '空对象'
  }
  return String(value)
}

const auditFieldTokenLabelMap = {
  id: 'ID',
  job: '交付单',
  ticket: '工单',
  project: '项目',
  user: '用户',
  username: '用户名',
  role: '角色',
  status: '状态',
  stage: '阶段',
  action: '动作',
  type: '类型',
  name: '名称',
  code: '编码',
  sn: 'SN',
  device: '设备',
  customer: '客户',
  product: '产品',
  location: '位置',
  order: '单',
  inbound: '来件',
  outbound: '发货',
  tracking: '单号',
  carrier: '责任人',
  remark: '备注',
  reason: '原因',
  created: '创建',
  updated: '更新',
  deleted: '删除',
  count: '数量',
  payload: '参数',
  record: '记录',
  attachment: '附件',
  file: '文件',
  size: '大小',
  enabled: '启用',
  threshold: '阈值',
  overdue: '超时',
  hours: '小时',
  minutes: '分钟',
  source: '来源',
  ip: '来源IP',
  request: '请求',
}

const formatFieldLabelByToken = (fieldKey) => {
  const text = String(fieldKey || '').trim()
  if (!text) return '-'
  if (/[\u4e00-\u9fa5]/.test(text)) return text
  const normalized = text.replace(/[\s.-]+/g, '_').toLowerCase()
  if (payloadLabelMap[normalized]) return payloadLabelMap[normalized]
  if (normalized.startsWith('is_')) {
    const rest = normalized.slice(3)
    const restLabel = rest.split('_').map((token) => auditFieldTokenLabelMap[token] || token).join('')
    return restLabel ? `是否${restLabel}` : text
  }
  if (normalized.endsWith('_id')) {
    const rest = normalized.slice(0, -3)
    const restLabel = rest.split('_').map((token) => auditFieldTokenLabelMap[token] || token).join('')
    return restLabel ? `${restLabel}ID` : text
  }
  if (normalized.endsWith('_at')) {
    const rest = normalized.slice(0, -3)
    const restLabel = rest.split('_').map((token) => auditFieldTokenLabelMap[token] || token).join('')
    return restLabel ? `${restLabel}时间` : text
  }
  const tokens = normalized.split('_').filter(Boolean)
  if (!tokens.length) return text
  return tokens.map((token) => auditFieldTokenLabelMap[token] || token).join('')
}

const fieldLabel = (key) => {
  const normalized = String(key || '').trim()
  if (!normalized) return '-'
  return payloadLabelMap[normalized] || formatFieldLabelByToken(normalized)
}

const buildAuditChangeSummary = (beforeData, afterData) => {
  const before = tryParseAuditData(beforeData)
  const after = tryParseAuditData(afterData)
  if (before === null && after === null) return '无变更'

  if (!isPlainObject(before) || !isPlainObject(after)) {
    if (before === null) return `新增：${formatAuditValueBrief(after)}`
    if (after === null) return `删除：${formatAuditValueBrief(before)}`
    if (isEqualForSummary(before, after)) return '无字段变化'
    return `由“${formatAuditValueBrief(before)}”变更为“${formatAuditValueBrief(after)}”`
  }

  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  const changes = []
  for (const key of keys) {
    const hasBefore = Object.prototype.hasOwnProperty.call(before, key)
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key)
    const label = fieldLabel(key)
    if (!hasBefore && hasAfter) {
      changes.push(`新增「${label}」：${formatAuditValueBrief(after[key])}`)
      continue
    }
    if (hasBefore && !hasAfter) {
      changes.push(`移除「${label}」`)
      continue
    }
    if (!isEqualForSummary(before[key], after[key])) {
      changes.push(`「${label}」由“${formatAuditValueBrief(before[key])}”改为“${formatAuditValueBrief(after[key])}”`)
    }
  }
  if (!changes.length) return '无字段变化'
  const preview = changes.slice(0, 3).join('；')
  return changes.length > 3 ? `${preview}；等${changes.length}项变更` : preview
}

const batchPayloadTemplateMap = {
  assess: { receive_note: '批量评估' },
  'implement': {
    cpu_match: 'PASS',
    memory_match: 'PASS',
    disk_match: 'PASS',
    nic_match: 'PASS',
    serial_match: 'PASS',
    hardware_note: '',
  },
  'tune': { os_name: 'JXOS', os_version: '1.0.0', install_result: 'PASS', install_note: '' },
  trial: { boot_test: 'PASS', network_test: 'PASS', stress_test: 'PASS', test_result: 'PASS', test_note: '' },
  accept: { approve_result: 'PASS', approve_note: '批量验收通过' },
  handover: { package_check: 'PASS', accessory_check: 'PASS', box_no: 'BOX-BATCH-001', pack_note: '' },
  close: { carrier: 'SF', shipped_note: '批量归档' },
}

const cloneBatchPayloadTemplate = (action) => ({ ...(batchPayloadTemplateMap[action] || {}) })

const parseBatchJobIdsText = (value) => {
  const text = String(value || '').trim()
  if (!text) return []
  return Array.from(
    new Set(
      text
        .split(/[\s,，]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  )
}

function App() {
  const [token, setToken] = useState('')
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [activeMenu, setActiveMenu] = useState('jobs')

  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [filters, setFilters] = useState({ keyword: '', stage: '' })

  const [selectedJobId, setSelectedJobId] = useState(0)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailModalPosition, setDetailModalPosition] = useState({ x: 0, y: 0 })
  const [detailModalDragging, setDetailModalDragging] = useState(false)
  const detailModalRef = useRef(null)
  const detailModalDragRef = useRef(null)

  const [createForm, setCreateForm] = useState({
    project_code: '',
    title: '',
    product_type: '',
    customer_name: '',
    sales_order_no: '',
    inbound_tracking_no: '',
    remark: '',
  })

  const [advanceForm, setAdvanceForm] = useState({ ...initialAdvanceForm })

  const [reworkForm, setReworkForm] = useState({
    target_stage: 'ASSESS',
    reason: '',
    remark: '',
  })

  const [attachmentForm, setAttachmentForm] = useState({
    stage_code: '',
    remark: '',
    file: null,
  })
  const [commentForm, setCommentForm] = useState({ content: '' })
  const [scheduleForm, setScheduleForm] = useState({
    assignee_name: '',
    assignee_role: '',
    start_at: '',
    end_at: '',
    remark: '',
  })

  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardOverdueDays, setDashboardOverdueDays] = useState(3)
  const [dashboardFilter, setDashboardFilter] = useState({ stage: '', customer: '' })

  const [auditFilter, setAuditFilter] = useState({ from: '', to: '', action: '', keyword: '', username: '' })
  const [auditLogs, setAuditLogs] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLimit] = useState(20)
  const [auditLoading, setAuditLoading] = useState(false)

  const [slaData, setSlaData] = useState(null)
  const [slaLoading, setSlaLoading] = useState(false)
  const [slaRuleForm, setSlaRuleForm] = useState([])
  const [slaRunResult, setSlaRunResult] = useState(null)
  const [slaReminderPage, setSlaReminderPage] = useState(1)
  const [slaReminderTotal, setSlaReminderTotal] = useState(0)
  const [slaReminderLimit] = useState(10)

  const [batchImportFile, setBatchImportFile] = useState(null)
  const [batchImportResult, setBatchImportResult] = useState(null)
  const [batchExportFilter, setBatchExportFilter] = useState({ keyword: '', customer: '', stage: '' })
  const [batchStageForm, setBatchStageForm] = useState({
    action: 'assess',
    job_ids_text: '',
    remark: '',
    inbound_tracking_no: '',
    outbound_tracking_no: '',
    stage_payload_json: JSON.stringify(batchPayloadTemplateMap.assess, null, 2),
  })
  const [batchStagePayloadForm, setBatchStagePayloadForm] = useState(cloneBatchPayloadTemplate('assess'))
  const [batchStageAdvancedMode, setBatchStageAdvancedMode] = useState(false)
  const [batchStageResult, setBatchStageResult] = useState(null)

  const [auditVerifyForm, setAuditVerifyForm] = useState({ from_id: '', to_id: '', limit: 5000 })
  const [auditVerifyResult, setAuditVerifyResult] = useState(null)
  const [auditVerifyLoading, setAuditVerifyLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: '确认',
    onConfirm: null,
  })

  const businessWriterRoles = ['admin', 'editor', 'reviewer', 'user', 'sales']
  const canWrite = businessWriterRoles.includes(normalizeRole(user?.role))
  const canUpload = businessWriterRoles.includes(normalizeRole(user?.role))
  const canRework = ['admin', 'editor'].includes(normalizeRole(user?.role))
  const canDeleteAttachment = ['admin', 'editor'].includes(normalizeRole(user?.role))
  const isAuditOnlyUser = normalizeRole(user?.role) === 'auditor'
  const canReadAuditLogs = isAuditOnlyUser
  const sidebarMenuItems = useMemo(() => {
    if (isAuditOnlyUser) {
      return [
        { key: 'audit', label: '审计日志' },
        { key: 'audit-verify', label: '审计验签' },
      ]
    }
    const items = [
      { key: 'dashboard', label: '看板总览' },
      { key: 'create', label: '新建交付单' },
      { key: 'jobs', label: '交付单列表' },
      { key: 'sla', label: 'SLA催办' },
      { key: 'batch', label: '批量管理' },
    ]
    if (canReadAuditLogs) {
      items.push({ key: 'audit', label: '审计日志' })
      items.push({ key: 'audit-verify', label: '审计验签' })
    }
    return items
  }, [isAuditOnlyUser, canReadAuditLogs])
  const detailMatchesSelection = Number(detail?.id || 0) === Number(selectedJobId || 0)

  const stageOptions = useMemo(
    () => [
      { value: '', label: '全部阶段' },
      ...Object.entries(stageLabelMap).map(([value, label]) => ({ value, label })),
    ],
    [],
  )

  const batchActionOptions = useMemo(
    () => Object.entries(actionLabelMap).map(([value, label]) => ({ value, label })),
    [],
  )

  const nextAction = detail ? nextActionByStage[String(detail.current_stage || '').toUpperCase()] : ''
  const nextStageCode = nextAction ? String(({
    assess: 'ASSESS',
    'implement': 'IMPLEMENT',
    'tune': 'TUNE',
    trial: 'TRIAL',
    accept: 'ACCEPT',
    handover: 'HANDOVER',
    close: 'CLOSED',
  }[nextAction] || '')).toUpperCase() : ''
  const canRunNextAction = roleCanDoAction(user?.role, nextAction)
  const responsibilityRows = useMemo(() => {
    if (!detail) return []
    return [
      { stage: 'ASSESS', by: detail.received_by_name, role: detail.received_by_role, at: detail.received_at },
      { stage: 'IMPLEMENT', by: detail.hardware_checked_by_name, role: detail.hardware_checked_by_role, at: detail.hardware_checked_at },
      { stage: 'TUNE', by: detail.os_installed_by_name, role: detail.os_installed_by_role, at: detail.os_installed_at },
      { stage: 'TRIAL', by: detail.tested_by_name, role: detail.tested_by_role, at: detail.tested_at },
      { stage: 'ACCEPT', by: detail.approved_by_name, role: detail.approved_by_role, at: detail.approved_at },
      { stage: 'HANDOVER', by: detail.packed_by_name, role: detail.packed_by_role, at: detail.packed_at },
      { stage: 'CLOSED', by: detail.shipped_by_name, role: detail.shipped_by_role, at: detail.shipped_at },
    ]
  }, [detail])

  const reworkTargetOptions = useMemo(() => {
    if (!detail) return []
    const current = String(detail.current_stage || '').toUpperCase()
    const currentIndex = stageSequence.indexOf(current)
    if (currentIndex <= 0) return []
    return stageSequence.slice(0, currentIndex).map((stage) => ({ value: stage, label: stageLabelMap[stage] || stage }))
  }, [detail])

  const summary = useMemo(() => {
    const byStage = jobs.reduce((acc, item) => {
      const key = String(item.current_stage || '').toUpperCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return {
      total,
      pending: (byStage.INIT || 0) + (byStage.ASSESS || 0) + (byStage.IMPLEMENT || 0),
      testing: (byStage.TUNE || 0) + (byStage.TRIAL || 0) + (byStage.ACCEPT || 0),
      shipped: byStage.CLOSED || 0,
    }
  }, [jobs, total])

  const dashboardStageMap = useMemo(() => {
    const map = {}
    const rows = Array.isArray(dashboard?.stage_counts) ? dashboard.stage_counts : []
    rows.forEach((item) => {
      const key = String(item?.stage || '').toUpperCase()
      if (!key) return
      map[key] = Number(item?.total || 0)
    })
    return map
  }, [dashboard])

  const heroSummary = useMemo(() => {
    if (!dashboard) {
      return {
        total: summary.total,
        processing: summary.pending + summary.testing,
        shipped: summary.shipped,
      }
    }

    return {
      total: Number(dashboard?.totals?.total_jobs || 0),
      processing: Number(dashboard?.totals?.open_jobs || 0),
      shipped: Number(dashboardStageMap.CLOSED || 0),
    }
  }, [dashboard, summary, dashboardStageMap])

  const showError = (msg) => {
    setErrorMsg(msg || '操作失败')
    setSuccessMsg('')
  }

  const showSuccess = (msg) => {
    setSuccessMsg(msg || '操作成功')
    setErrorMsg('')
  }

  const clearTips = () => {
    setErrorMsg('')
    setSuccessMsg('')
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

  const isPassFailValue = (value) => {
    const normalized = String(value || '').toUpperCase()
    return normalized === 'PASS' || normalized === 'FAIL'
  }

  const updateBatchStagePayloadField = (key, value) => {
    setBatchStagePayloadForm((prev) => {
      const next = { ...prev, [key]: value }
      setBatchStageForm((current) => ({
        ...current,
        stage_payload_json: JSON.stringify(next, null, 2),
      }))
      return next
    })
  }

  const toggleBatchStageAdvancedMode = () => {
    if (batchStageAdvancedMode) {
      const text = trimText(batchStageForm.stage_payload_json)
      if (!text) {
        setBatchStagePayloadForm({})
      } else {
        try {
          const parsed = JSON.parse(text)
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            return showError('阶段 payload 必须是 JSON 对象')
          }
          setBatchStagePayloadForm(parsed)
        } catch (_err) {
          return showError('阶段 payload 不是合法 JSON')
        }
      }
    } else {
      setBatchStageForm((prev) => ({
        ...prev,
        stage_payload_json: JSON.stringify(batchStagePayloadForm, null, 2),
      }))
    }
    setBatchStageAdvancedMode((prev) => !prev)
  }

  const onLogout = async () => {
    await logoutFromSso()
    setToken('')
    setUser(null)
    window.location.href = buildPortalEntryUrl('delivery')
  }

  const apiRequest = async (path, options = {}) => {
    const isFormData = Boolean(options.formData)
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
      body: isFormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    })

    if (options.expectBlob) {
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`)
      }
      return response.blob()
    }

    let payload = null
    try {
      payload = await response.json()
    } catch (_err) {
      payload = null
    }

    if (!response.ok) {
      if (response.status === 401) {
        setToken('')
        setUser(null)
      }
      throw new Error(payload?.error || `请求失败 (${response.status})`)
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

  const refreshJobs = async () => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', String(limit))
    if (filters.keyword) params.set('keyword', filters.keyword)
    if (filters.stage) params.set('stage', filters.stage)

    const result = await apiRequest(`/api/delivery/orders?${params.toString()}`, { withMeta: true })
    const rows = Array.isArray(result?.data) ? result.data : []
    setJobs(rows)
    setTotal(Number(result?.meta?.totalCount || 0))

    if (!selectedJobId && rows.length > 0) {
      setSelectedJobId(Number(rows[0].id || 0))
    }

    return rows
  }

  const refreshDetail = async (id = selectedJobId) => {
    const targetId = Number(id || 0)
    if (!targetId) {
      setDetail(null)
      setDetailLoading(false)
      return
    }
    setDetailLoading(true)
    try {
      const data = await apiRequest(`/api/delivery/orders/${targetId}`)
      setDetail(data)
      setAttachmentForm((prev) => ({
        ...prev,
        stage_code: String(data?.current_stage || '').toUpperCase() || prev.stage_code,
      }))
    } finally {
      setDetailLoading(false)
    }
  }

  const buildDashboardParams = (overrides = {}) => {
    const safeOverdueDays = Math.min(30, Math.max(1, Number(overrides.overdueDays ?? dashboardOverdueDays ?? 3)))
    const stage = String(overrides.stage ?? dashboardFilter.stage ?? '').toUpperCase()
    const customer = String(overrides.customer ?? dashboardFilter.customer ?? '').trim()
    const params = new URLSearchParams()
    params.set('overdue_days', String(safeOverdueDays))
    if (stage) params.set('stage', stage)
    if (customer) params.set('customer', customer)
    return params
  }

  const refreshDashboard = async (overrides = {}) => {
    setDashboardLoading(true)
    try {
      const params = buildDashboardParams(overrides)
      const data = await apiRequest(`/api/delivery/dashboard/summary?${params.toString()}`)
      setDashboard(data)
    } finally {
      setDashboardLoading(false)
    }
  }

  const refreshAuditLogs = async () => {
    setAuditLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(auditPage))
      params.set('limit', String(auditLimit))
      if (auditFilter.from) params.set('from', auditFilter.from)
      if (auditFilter.to) params.set('to', auditFilter.to)
      if (auditFilter.action) params.set('action', auditFilter.action)
      if (auditFilter.username) params.set('username', auditFilter.username)
      if (auditFilter.keyword) params.set('keyword', auditFilter.keyword)
      const result = await apiRequest(`/api/delivery/audit/logs?${params.toString()}`, { withMeta: true })
      const rows = Array.isArray(result?.data) ? result.data : []
      setAuditLogs(rows)
      setAuditTotal(Number(result?.meta?.totalCount || 0))
    } finally {
      setAuditLoading(false)
    }
  }

  const refreshSlaSummary = async (overrides = {}) => {
    setSlaLoading(true)
    try {
      const targetPageRaw = Number(overrides.page ?? slaReminderPage)
      const targetPage = Number.isInteger(targetPageRaw) && targetPageRaw > 0 ? targetPageRaw : 1
      const params = new URLSearchParams()
      params.set('page', String(targetPage))
      params.set('limit', String(slaReminderLimit))
      const data = await apiRequest(`/api/delivery/sla/summary?${params.toString()}`)
      setSlaData(data)
      setSlaReminderTotal(Number(data?.reminder_paging?.total || 0))
      setSlaReminderPage(Number(data?.reminder_paging?.page || targetPage))
      const rules = Array.isArray(data?.rules) ? data.rules : []
      setSlaRuleForm(
        rules.map((item) => ({
          stage_code: item.stage_code,
          stage_label: item.stage_label || stageText(item.stage_code),
          threshold_hours: Number(item.threshold_hours || 0),
          remind_interval_minutes: Number(item.remind_interval_minutes || 0),
          enabled: Boolean(item.enabled),
        })),
      )
    } finally {
      setSlaLoading(false)
    }
  }

  const onDeleteSlaReminder = async (item) => {
    const reminderId = Number(item?.id || 0)
    if (!reminderId) return showError('催办记录ID无效')
    if (!canWrite) return showError('当前角色无权限删除催办记录')
    openConfirmDialog({
      title: '删除催办记录',
      message: `确认删除催办记录 #${reminderId}？删除后不可恢复。`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        try {
          setBusy(true)
          await apiRequest(`/api/delivery/sla/reminders/${reminderId}`, { method: 'DELETE' })
          showSuccess('催办记录删除成功')
          await refreshSlaSummary({ page: slaReminderPage })
        } catch (err) {
          showError(err.message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const onClearSlaReminders = async () => {
    if (!canWrite) return showError('当前角色无权限删除催办记录')
    openConfirmDialog({
      title: '一键清空催办记录',
      message: '确认清空全部催办记录？该操作不可恢复。',
      confirmLabel: '确认清空',
      onConfirm: async () => {
        try {
          setBusy(true)
          const result = await apiRequest('/api/delivery/sla/reminders', { method: 'DELETE' })
          showSuccess(`已删除 ${Number(result?.deleted || 0)} 条催办记录`)
          setSlaReminderPage(1)
          await refreshSlaSummary({ page: 1 })
        } catch (err) {
          showError(err.message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const onSaveSlaRules = async () => {
    if (!canWrite) return showError('当前角色无权限修改 SLA 规则')
    try {
      setBusy(true)
      const rules = slaRuleForm.map((item) => ({
        stage_code: item.stage_code,
        threshold_hours: Number(item.threshold_hours || 0),
        remind_interval_minutes: Number(item.remind_interval_minutes || 0),
        enabled: Boolean(item.enabled),
      }))
      await apiRequest('/api/delivery/sla/rules', {
        method: 'PUT',
        body: { rules },
      })
      showSuccess('SLA 规则已保存')
      await refreshSlaSummary()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onRunSlaNow = async () => {
    if (!canWrite) return showError('当前角色无权限执行催办')
    try {
      setBusy(true)
      const result = await apiRequest('/api/delivery/sla/run', {
        method: 'POST',
        body: { max_scan: 300 },
      })
      setSlaRunResult(result)
      showSuccess(`本次催办执行完成，触发 ${Number(result?.triggered || 0)} 条`)
      await refreshSlaSummary()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchDownloadTemplate = async () => {
    try {
      setBusy(true)
      const response = await fetch(`${API_BASE}/api/delivery/templates/orders-import.xlsx`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        let message = `下载失败 (${response.status})`
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch (_err) {
          // ignore
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, 'delivery-import-template.xlsx')
      showSuccess('模板下载成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchExportJobs = async () => {
    try {
      setBusy(true)
      const params = new URLSearchParams()
      if (batchExportFilter.keyword) params.set('keyword', batchExportFilter.keyword)
      if (batchExportFilter.customer) params.set('customer', batchExportFilter.customer)
      if (batchExportFilter.stage) params.set('stage', batchExportFilter.stage)
      const response = await fetch(`${API_BASE}/api/delivery/reports/orders.xlsx?${params.toString()}`, {
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
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, `delivery-jobs-${Date.now()}.xlsx`)
      showSuccess('批量导出成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchImportJobs = async () => {
    if (!canWrite) return showError('当前角色无权限导入')
    if (!batchImportFile) return showError('请先选择导入文件')
    try {
      setBusy(true)
      const formData = new FormData()
      formData.append('file', batchImportFile)
      const result = await apiRequest('/api/delivery/import/orders.xlsx', {
        method: 'POST',
        formData: true,
        body: formData,
      })
      setBatchImportResult(result)
      showSuccess(`导入完成：成功 ${Number(result?.success_count || 0)} 条，失败 ${Number(result?.failure_count || 0)} 条`)
      await Promise.all([refreshJobs(), refreshDashboard()])
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchAdvanceStage = async () => {
    const jobIds = parseBatchJobIdsText(batchStageForm.job_ids_text)
    if (jobIds.length === 0) return showError('请填写至少1个交付单 ID')

    let stagePayload = null
    if (batchStageAdvancedMode) {
      const payloadText = String(batchStageForm.stage_payload_json || '').trim()
      if (payloadText) {
        try {
          stagePayload = JSON.parse(payloadText)
          if (!stagePayload || Array.isArray(stagePayload) || typeof stagePayload !== 'object') {
            return showError('阶段 payload 必须是 JSON 对象')
          }
        } catch (_err) {
          return showError('阶段 payload 不是合法 JSON')
        }
      }
    } else {
      const normalized = Object.entries(batchStagePayloadForm).reduce((acc, [key, value]) => {
        if (value === null || value === undefined) return acc
        const text = String(value).trim()
        if (!text) return acc
        acc[key] = text
        return acc
      }, {})
      stagePayload = Object.keys(normalized).length ? normalized : null
    }

    try {
      setBusy(true)
      const result = await apiRequest('/api/delivery/orders/batch/phase', {
        method: 'POST',
        body: {
          action: batchStageForm.action,
          job_ids: jobIds,
          remark: batchStageForm.remark,
          inbound_tracking_no: batchStageForm.inbound_tracking_no,
          outbound_tracking_no: batchStageForm.outbound_tracking_no,
          stage_payload: stagePayload,
        },
      })
      setBatchStageResult(result)
      showSuccess(`批量推进完成：成功 ${Number(result?.success_count || 0)} 条，失败 ${Number(result?.failure_count || 0)} 条`)
      await Promise.all([refreshJobs(), refreshDashboard()])
      if (selectedJobId) await refreshDetail(selectedJobId)
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onVerifyAuditChain = async () => {
    try {
      setAuditVerifyLoading(true)
      const params = new URLSearchParams()
      if (trimText(auditVerifyForm.from_id)) params.set('from_id', String(Number(auditVerifyForm.from_id)))
      if (trimText(auditVerifyForm.to_id)) params.set('to_id', String(Number(auditVerifyForm.to_id)))
      if (trimText(auditVerifyForm.limit)) params.set('limit', String(Number(auditVerifyForm.limit)))
      const result = await apiRequest(`/api/delivery/audit/verify?${params.toString()}`)
      setAuditVerifyResult(result)
      if (result?.passed) showSuccess('审计链校验通过')
      else showError(`审计链校验发现 ${Number(result?.issue_count || 0)} 个问题`)
    } catch (err) {
      showError(err.message)
    } finally {
      setAuditVerifyLoading(false)
    }
  }

  const refreshAll = async () => {
    setLoading(true)
    try {
      if (isAuditOnlyUser) {
        await refreshAuditLogs()
        clearTips()
        return
      }
      const [rows] = await Promise.all([refreshJobs(), refreshDashboard()])
      const fallbackId = Number(selectedJobId || (rows[0] && rows[0].id) || 0)
      await refreshDetail(fallbackId)
      clearTips()
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const onCreateJob = async (e) => {
    e.preventDefault()
    try {
      setBusy(true)
      const created = await apiRequest('/api/delivery/orders', {
        method: 'POST',
        body: createForm,
      })
      showSuccess('交付单创建成功')
      setCreateForm({ project_code: '', title: '', product_type: '', customer_name: '', sales_order_no: '', inbound_tracking_no: '', remark: '' })
      setSelectedJobId(Number(created?.id || 0))
      await Promise.all([refreshJobs(), refreshDashboard()])
      await refreshDetail(Number(created?.id || 0))
      setActiveMenu('jobs')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onAdvanceStage = async () => {
    if (!detail || !nextAction) return
    if (!canRunNextAction) return showError('当前角色无权执行该阶段动作')
    const validationError = validateAdvanceForm(nextAction, advanceForm)
    if (validationError) return showError(validationError)

    try {
      setBusy(true)
      const payload = {
        remark: advanceForm.remark,
        stage_payload: buildStagePayloadByAction(nextAction, advanceForm),
      }
      if (nextAction === 'assess') payload.inbound_tracking_no = advanceForm.inbound_tracking_no
      if (nextAction === 'close') payload.outbound_tracking_no = advanceForm.outbound_tracking_no

      await apiRequest(`/api/delivery/orders/${detail.id}/phases/${nextAction}`, {
        method: 'POST',
        body: payload,
      })
      showSuccess('阶段推进成功')
      setAdvanceForm((prev) => ({ ...prev, remark: '', inbound_tracking_no: '', outbound_tracking_no: '' }))
      await Promise.all([refreshJobs(), refreshDashboard()])
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onRework = async () => {
    if (!detail) return
    if (!canRework) return showError('当前角色无权执行退回')

    try {
      setBusy(true)
      await apiRequest(`/api/delivery/orders/${detail.id}/rework`, {
        method: 'POST',
        body: reworkForm,
      })
      showSuccess('已退回到指定阶段')
      setReworkForm((prev) => ({ ...prev, reason: '', remark: '' }))
      await Promise.all([refreshJobs(), refreshDashboard()])
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onUploadAttachment = async () => {
    if (!detail) return
    if (!canUpload) return showError('当前角色无权上传附件')
    if (!attachmentForm.file) return showError('请选择要上传的文件')

    try {
      setBusy(true)
      const formData = new FormData()
      formData.append('file', attachmentForm.file)
      if (attachmentForm.stage_code) formData.append('stage_code', attachmentForm.stage_code)
      if (attachmentForm.remark) formData.append('remark', attachmentForm.remark)

      await apiRequest(`/api/delivery/orders/${detail.id}/attachments`, {
        method: 'POST',
        formData: true,
        body: formData,
      })

      showSuccess('附件上传成功')
      setAttachmentForm((prev) => ({ ...prev, remark: '', file: null }))
      await refreshDashboard()
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onDownloadAttachment = async (item) => {
    try {
      const blob = await apiRequest(`/api/delivery/attachments/${item.id}/download`, { expectBlob: true })
      downloadBlob(blob, item.file_name || `attachment-${item.id}`)
    } catch (err) {
      showError(err.message)
    }
  }

  const onDeleteAttachment = async (item) => {
    if (!detail) return
    if (!canDeleteAttachment) return showError('当前角色无权删除附件')
    openConfirmDialog({
      title: '删除附件',
      message: `确认删除附件“${item.file_name}”？删除后不可恢复。`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        try {
          setBusy(true)
          await apiRequest(`/api/delivery/attachments/${item.id}`, { method: 'DELETE' })
          showSuccess('附件删除成功')
          await refreshDashboard()
          await refreshDetail()
        } catch (err) {
          showError(err.message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const onCreateComment = async () => {
    if (!detail) return
    const content = trimText(commentForm.content)
    if (!content) return showError('请输入评论内容')
    try {
      setBusy(true)
      await apiRequest(`/api/delivery/orders/${detail.id}/comments`, {
        method: 'POST',
        body: { content },
      })
      showSuccess('评论已添加')
      setCommentForm({ content: '' })
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onCreateSchedule = async () => {
    if (!detail) return
    if (!trimText(scheduleForm.start_at) || !trimText(scheduleForm.end_at)) {
      return showError('请填写完整的开始和结束时间')
    }
    try {
      setBusy(true)
      await apiRequest(`/api/delivery/orders/${detail.id}/schedules`, {
        method: 'POST',
        body: scheduleForm,
      })
      showSuccess('排期已添加')
      setScheduleForm({ assignee_name: '', assignee_role: '', start_at: '', end_at: '', remark: '' })
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onToggleDeliverable = async (item, done) => {
    if (!detail) return
    try {
      setBusy(true)
      await apiRequest(`/api/delivery/orders/${detail.id}/deliverables/${item.id}`, {
        method: 'PUT',
        body: { done },
      })
      showSuccess(done ? '交付物已标记完成' : '交付物已重置为未完成')
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onExportAudit = async () => {
    try {
      setBusy(true)
      const params = new URLSearchParams()
      if (auditFilter.from) params.set('from', auditFilter.from)
      if (auditFilter.to) params.set('to', auditFilter.to)
      if (auditFilter.action) params.set('action', auditFilter.action)
      if (auditFilter.username) params.set('username', auditFilter.username)
      if (auditFilter.keyword) params.set('keyword', auditFilter.keyword)
      const response = await fetch(`${API_BASE}/api/delivery/reports/audit.csv?${params.toString()}`, {
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
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, `delivery-audit-${Date.now()}.csv`)
      showSuccess('审计报表导出成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onExportDashboard = async () => {
    try {
      setBusy(true)
      const params = buildDashboardParams()
      const response = await fetch(`${API_BASE}/api/delivery/reports/dashboard.csv?${params.toString()}`, {
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
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, `delivery-dashboard-${Date.now()}.csv`)
      showSuccess('看板明细导出成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const closeDetailModal = () => {
    setDetailModalOpen(false)
    setDetailModalDragging(false)
    detailModalDragRef.current = null
  }

  const onStartDetailModalDrag = (event) => {
    if (event.button !== 0) return
    if (!detailModalRef.current) return
    event.preventDefault()
    const rect = detailModalRef.current.getBoundingClientRect()
    detailModalDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: detailModalPosition.x,
      originY: detailModalPosition.y,
      width: rect.width,
      height: rect.height,
    }
    setDetailModalDragging(true)
  }

  const onOpenJobDetail = async (jobId) => {
    const targetId = Number(jobId || 0)
    if (!targetId) {
      showError('该记录未关联交付单')
      return
    }
    setDetailModalOpen(true)
    setDetailModalPosition({ x: 0, y: 0 })
    setDetailModalDragging(false)
    detailModalDragRef.current = null
    setSelectedJobId(targetId)
    try {
      setActiveMenu('jobs')
      await refreshDetail(targetId)
    } catch (err) {
      showError(err.message)
    }
  }

  const renderStageFields = () => {
    if (!nextAction) return null

    const passFailSelect = (key, label) => (
      <div className="field" key={key}>
        <label>{label}</label>
        <select value={advanceForm[key]} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, [key]: e.target.value }))}>
          <option value="PASS">通过</option>
          <option value="FAIL">不通过</option>
        </select>
      </div>
    )

    if (nextAction === 'assess') {
      return (
        <>
          <div className="field">
            <label>来源单号（可补录）</label>
            <input
              value={advanceForm.inbound_tracking_no}
              onChange={(e) => setAdvanceForm((prev) => ({ ...prev, inbound_tracking_no: e.target.value }))}
              placeholder="来源单号"
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>评估备注</label>
            <textarea value={advanceForm.receive_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, receive_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'implement') {
      return (
        <>
          {passFailSelect('cpu_match', '实施参数校验')}
          {passFailSelect('memory_match', '接入连通性')}
          {passFailSelect('disk_match', '权限配置校验')}
          {passFailSelect('nic_match', '策略下发校验')}
          {passFailSelect('serial_match', '资产标识校验')}
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>实施参数备注</label>
            <textarea value={advanceForm.hardware_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, hardware_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'tune') {
      return (
        <>
          <div className="field">
            <label>平台名称</label>
            <input value={advanceForm.os_name} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, os_name: e.target.value }))} />
          </div>
          <div className="field">
            <label>平台版本</label>
            <input value={advanceForm.os_version} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, os_version: e.target.value }))} />
          </div>
          <div className="field">
            <label>部署方式</label>
            <input value={advanceForm.install_mode} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, install_mode: e.target.value }))} placeholder="云端/本地/混合" />
          </div>
          {passFailSelect('install_result', '联调结果')}
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>联调备注</label>
            <textarea value={advanceForm.install_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, install_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'trial') {
      return (
        <>
          {passFailSelect('boot_test', '告警链路测试')}
          {passFailSelect('network_test', '策略联动测试')}
          {passFailSelect('stress_test', '业务压测验证')}
          {passFailSelect('test_result', '试运行结论')}
          <div className="field">
            <label>试运行时长(小时)</label>
            <input value={advanceForm.burnin_hours} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, burnin_hours: e.target.value }))} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>试运行备注</label>
            <textarea value={advanceForm.test_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, test_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'accept') {
      return (
        <>
          {passFailSelect('approve_result', '验收结论')}
          <div className="field">
            <label>验收备注</label>
            <input value={advanceForm.approve_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, approve_note: e.target.value }))} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>验收意见</label>
            <textarea value={advanceForm.reviewer_comment} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, reviewer_comment: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'handover') {
      return (
        <>
          {passFailSelect('package_check', '移交文档完整')}
          {passFailSelect('accessory_check', '培训交接完成')}
          <div className="field">
            <label>移交编号</label>
            <input value={advanceForm.box_no} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, box_no: e.target.value }))} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>移交备注</label>
            <textarea value={advanceForm.pack_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, pack_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'close') {
      return (
        <>
          <div className="field">
            <label>归档责任人（必填）</label>
            <input value={advanceForm.carrier} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, carrier: e.target.value }))} />
          </div>
          <div className="field">
            <label>验收单号（必填）</label>
            <input
              value={advanceForm.outbound_tracking_no}
              onChange={(e) => setAdvanceForm((prev) => ({ ...prev, outbound_tracking_no: e.target.value }))}
              placeholder="验收单号"
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>归档备注</label>
            <textarea value={advanceForm.shipped_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, shipped_note: e.target.value }))} />
          </div>
        </>
      )
    }

    return null
  }

  useEffect(() => {
    let cancelled = false
    const bootstrapAuth = async () => {
      try {
        const marker = consumePortalSessionMarker()
        if (!marker) return
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
      }
    }
    bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!token || !user) return
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, isAuditOnlyUser])

  useEffect(() => {
    if (!token) return
    if (isAuditOnlyUser) return
    refreshJobs().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters, token, isAuditOnlyUser])

  useEffect(() => {
    if (!token) return
    if (isAuditOnlyUser) return
    if (!selectedJobId) return
    refreshDetail().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, token, isAuditOnlyUser])

  useEffect(() => {
    if (!detailModalOpen) return
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setDetailModalOpen(false)
      setDetailModalDragging(false)
      detailModalDragRef.current = null
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [detailModalOpen])

  useEffect(() => {
    if (activeMenu === 'jobs') return
    setDetailModalOpen(false)
    setDetailModalDragging(false)
    detailModalDragRef.current = null
  }, [activeMenu])

  useEffect(() => {
    if (!detailModalDragging) return

    const onPointerMove = (event) => {
      const drag = detailModalDragRef.current
      if (!drag) return
      if (Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const rawX = drag.originX + deltaX
      const rawY = drag.originY + deltaY
      const limitX = Math.max(0, (window.innerWidth - drag.width) / 2 - 20)
      const limitY = Math.max(0, (window.innerHeight - drag.height) / 2 - 20)

      setDetailModalPosition({
        x: Math.max(-limitX, Math.min(limitX, rawX)),
        y: Math.max(-limitY, Math.min(limitY, rawY)),
      })
    }

    const onPointerUp = (event) => {
      const drag = detailModalDragRef.current
      if (drag && Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return
      setDetailModalDragging(false)
      detailModalDragRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [detailModalDragging])

  useEffect(() => {
    if (!token) return
    if (activeMenu !== 'dashboard') return
    refreshDashboard().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeMenu, dashboardOverdueDays])

  useEffect(() => {
    if (!token) return
    if (!canReadAuditLogs) return
    if (activeMenu !== 'audit') return
    refreshAuditLogs().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canReadAuditLogs, activeMenu, auditPage, auditFilter])

  useEffect(() => {
    if (canReadAuditLogs) return
    if (activeMenu !== 'audit' && activeMenu !== 'audit-verify') return
    setActiveMenu('jobs')
  }, [canReadAuditLogs, activeMenu])

  useEffect(() => {
    if (!isAuditOnlyUser) return
    if (activeMenu === 'audit' || activeMenu === 'audit-verify') return
    setActiveMenu('audit')
  }, [isAuditOnlyUser, activeMenu])

  useEffect(() => {
    if (!token) return
    if (activeMenu !== 'sla') return
    refreshSlaSummary({ page: slaReminderPage }).catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeMenu, slaReminderPage])

  useEffect(() => {
    const action = batchStageForm.action
    const template = cloneBatchPayloadTemplate(action)
    if (!template) return
    setBatchStagePayloadForm(template)
    setBatchStageForm((prev) => {
      if (prev.action !== action) return prev
      return {
        ...prev,
        stage_payload_json: JSON.stringify(template, null, 2),
      }
    })
    setBatchStageAdvancedMode(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchStageForm.action])

  useEffect(() => {
    if (!detail) return
    if (!nextStageCode) return
    setAttachmentForm((prev) => ({ ...prev, stage_code: nextStageCode }))
  }, [detail, nextStageCode])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / limit))
    if (page > totalPages) setPage(totalPages)
  }, [total, page, limit])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(Math.max(auditTotal, 0) / auditLimit))
    if (auditPage > totalPages) setAuditPage(totalPages)
  }, [auditTotal, auditPage, auditLimit])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(Math.max(slaReminderTotal, 0) / slaReminderLimit))
    if (slaReminderPage > totalPages) setSlaReminderPage(totalPages)
  }, [slaReminderTotal, slaReminderPage, slaReminderLimit])

  if (!token || !user) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <h1>
            <span className="brand-red">聚信</span>
            <span className="brand-blue">交付系统</span>
          </h1>
          <p className="sub">使用统一登录进入系统。</p>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={() => (window.location.href = buildPortalEntryUrl('delivery'))}>
              前往统一登录
            </button>
            <button className="btn" onClick={() => (window.location.href = buildPortalSwitchUrl('delivery'))}>
              切换其他系统
            </button>
          </div>
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
            <span className="brand-blue">交付系统</span>
          </strong>
          <div className="user-pill">{user.username} · {user.role}</div>
        </div>

        <div className="menu">
          {sidebarMenuItems.map((item) => (
            <button
              key={item.key}
              className={activeMenu === item.key ? 'active' : ''}
              onClick={() => setActiveMenu(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="sidebar-actions">
          <button className="ghost" onClick={() => (window.location.href = buildPortalSwitchUrl('delivery'))}>切换系统</button>
          <button className="ghost logout" onClick={onLogout}>退出登录</button>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <div className="muted">SEC IMPL V1</div>
            <h1>交付全流程工作台</h1>
            <div className="sub">从受理、实施到验收与移交，统一追踪交付单、项目协同、证据留存与审计链。</div>
          </div>
          <div className="toolbar">
            <div className="status-card">
              <div className="muted">当前列表总数</div>
              <strong>{heroSummary.total}</strong>
            </div>
            <div className="status-card">
              <div className="muted">处理中</div>
              <strong>{heroSummary.processing}</strong>
            </div>
            <div className="status-card">
              <div className="muted">已归档</div>
              <strong>{heroSummary.shipped}</strong>
            </div>
          </div>
        </header>

        {errorMsg ? <div className="msg error">{errorMsg}</div> : null}
        {successMsg ? <div className="msg success">{successMsg}</div> : null}

        {activeMenu === 'dashboard' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>看板总览</strong>
              <div className="toolbar">
                <label className="muted">超时阈值(天)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={dashboardOverdueDays}
                  onChange={(e) => setDashboardOverdueDays(Math.min(30, Math.max(1, Number(e.target.value || 1))))}
                  style={{ width: 88 }}
                />
                <select
                  value={dashboardFilter.stage}
                  onChange={(e) => setDashboardFilter((prev) => ({ ...prev, stage: e.target.value }))}
                >
                  {stageOptions.map((item) => (
                    <option key={`dashboard-${item.value || 'all'}`} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <input
                  value={dashboardFilter.customer}
                  onChange={(e) => setDashboardFilter((prev) => ({ ...prev, customer: e.target.value }))}
                  placeholder="客户名筛选"
                />
                <button className="btn" onClick={() => refreshDashboard()} disabled={dashboardLoading}>
                  {dashboardLoading ? '查询中...' : '查询'}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setDashboardFilter({ stage: '', customer: '' })
                    refreshDashboard({ stage: '', customer: '' }).catch((err) => showError(err.message))
                  }}
                  disabled={dashboardLoading}
                >
                  重置筛选
                </button>
                <button className="btn btn-primary" onClick={onExportDashboard} disabled={busy}>导出明细 CSV</button>
              </div>
            </div>
            <div className="panel-body">
              {!dashboard ? (
                <div className="muted">暂无看板数据</div>
              ) : (
                <>
                  <div className="stats-grid">
                    <div className="stat-tile">
                      <div className="muted">交付单总数</div>
                      <strong>{Number(dashboard?.totals?.total_jobs || 0)}</strong>
                    </div>
                    <div className="stat-tile">
                      <div className="muted">处理中</div>
                      <strong>{Number(dashboard?.totals?.open_jobs || 0)}</strong>
                    </div>
                    <div className="stat-tile">
                      <div className="muted">已完成</div>
                      <strong>{Number(dashboard?.totals?.completed_jobs || 0)}</strong>
                    </div>
                    <div className="stat-tile">
                      <div className="muted">今日归档</div>
                      <strong>{Number(dashboard?.totals?.closed_today || dashboard?.totals?.shipped_today || 0)}</strong>
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 14 }}>
                    <strong>阶段分布</strong>
                    <div className="stage-count-grid" style={{ marginTop: 8 }}>
                      {stageSequence.map((stage) => (
                        <div className="stage-count-card" key={stage}>
                          <div className="muted">{stageText(stage)}</div>
                          <strong>{Number(dashboardStageMap[stage] || 0)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 14 }}>
                    <strong>超时交付单（{Number(dashboard?.overdue_days || 0)} 天未更新）</strong>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>交付单号</th>
                            <th>项目编码</th>
                            <th>客户</th>
                            <th>当前阶段</th>
                            <th>超时天数</th>
                            <th>最后更新时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(dashboard?.overdue_jobs) ? dashboard.overdue_jobs : []).map((item) => (
                            <tr key={`overdue-${item.id}`}>
                              <td>
                                <button
                                  type="button"
                                  className="text-link"
                                  onClick={() => onOpenJobDetail(item.id)}
                                  disabled={busy}
                                >
                                  {item.job_no || `#${item.id}`}
                                </button>
                              </td>
                              <td>{item.project_code}</td>
                              <td>{item.customer_name || '-'}</td>
                              <td>{stageText(item.current_stage)}</td>
                              <td>{Number(item.overdue_days || 0)}</td>
                              <td>{parseApiDate(item.updated_at)}</td>
                            </tr>
                          ))}
                          {(Array.isArray(dashboard?.overdue_jobs) ? dashboard.overdue_jobs : []).length === 0 ? (
                            <tr><td colSpan={6} className="muted">暂无超时交付单</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {canReadAuditLogs ? (
                    <div className="panel-subsection" style={{ marginTop: 14 }}>
                      <strong>最近操作日志</strong>
                      <div className="table-wrap" style={{ marginTop: 8 }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>时间</th>
                              <th>操作人</th>
                              <th>动作</th>
                              <th>交付单号</th>
                              <th>说明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(Array.isArray(dashboard?.recent_logs) ? dashboard.recent_logs : []).map((item) => (
                              <tr key={`recent-log-${item.id}`}>
                                <td>{parseApiDate(item.created_at)}</td>
                                <td>{item.username || '-'}</td>
                                <td>{item.action || '-'}</td>
                                <td>
                                  {item.job_id ? (
                                    <button
                                      type="button"
                                      className="text-link"
                                      onClick={() => onOpenJobDetail(item.job_id)}
                                      disabled={busy}
                                    >
                                      {item.job_no || `#${item.job_id}`}
                                    </button>
                                  ) : (
                                    item.job_no || '-'
                                  )}
                                </td>
                                <td>{item.message || '-'}</td>
                              </tr>
                            ))}
                            {(Array.isArray(dashboard?.recent_logs) ? dashboard.recent_logs : []).length === 0 ? (
                              <tr><td colSpan={5} className="muted">暂无日志</td></tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        ) : null}

        {activeMenu === 'sla' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>SLA 催办</strong>
              <div className="toolbar">
                <button className="btn" onClick={() => refreshSlaSummary()} disabled={slaLoading}>
                  {slaLoading ? '加载中...' : '刷新'}
                </button>
                <button className="btn" onClick={onRunSlaNow} disabled={busy || !canWrite}>立即执行催办</button>
                <button className="btn btn-primary" onClick={onSaveSlaRules} disabled={busy || !canWrite}>保存规则</button>
              </div>
            </div>
            <div className="panel-body">
              {!slaData ? (
                <div className="muted">暂无 SLA 数据</div>
              ) : (
                <>
                  {slaRunResult ? (
                    <div className="msg success">
                      本次催办：扫描 {Number(slaRunResult.checked || 0)} 条，触发 {Number(slaRunResult.triggered || 0)} 条，间隔内跳过 {Number(slaRunResult.skipped_interval || 0)} 条。
                    </div>
                  ) : null}

                  <div className="panel-subsection">
                    <strong>阶段 SLA 规则</strong>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>阶段</th>
                            <th>超时阈值(小时)</th>
                            <th>提醒间隔(分钟)</th>
                            <th>启用</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slaRuleForm.map((row, idx) => (
                            <tr key={`sla-rule-${row.stage_code}`}>
                              <td>{row.stage_label || stageText(row.stage_code)}</td>
                              <td>
                                <input
                                  type="number"
                                  min={1}
                                  max={720}
                                  value={row.threshold_hours}
                                  onChange={(e) =>
                                    setSlaRuleForm((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? { ...item, threshold_hours: Math.max(1, Math.min(720, Number(e.target.value || 1))) }
                                          : item,
                                      ),
                                    )
                                  }
                                  style={{ width: 120 }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={10}
                                  max={1440}
                                  value={row.remind_interval_minutes}
                                  onChange={(e) =>
                                    setSlaRuleForm((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? {
                                            ...item,
                                            remind_interval_minutes: Math.max(10, Math.min(1440, Number(e.target.value || 10))),
                                          }
                                          : item,
                                      ),
                                    )
                                  }
                                  style={{ width: 120 }}
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.enabled)}
                                  onChange={(e) =>
                                    setSlaRuleForm((prev) =>
                                      prev.map((item, i) => (i === idx ? { ...item, enabled: e.target.checked } : item)),
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                          {slaRuleForm.length === 0 ? <tr><td colSpan={4} className="muted">暂无规则</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 12 }}>
                    <strong>超时交付单</strong>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>交付单号</th>
                            <th>项目编码</th>
                            <th>客户</th>
                            <th>当前阶段</th>
                            <th>超时小时</th>
                            <th>阈值小时</th>
                            <th>最后更新时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(slaData?.overdue_jobs) ? slaData.overdue_jobs : []).map((item) => (
                            <tr key={`sla-overdue-${item.id}`}>
                              <td>
                                <button type="button" className="text-link" onClick={() => onOpenJobDetail(item.id)} disabled={busy}>
                                  {item.job_no || `#${item.id}`}
                                </button>
                              </td>
                              <td>{item.project_code || '-'}</td>
                              <td>{item.customer_name || '-'}</td>
                              <td>{stageText(item.current_stage)}</td>
                              <td>{Number(item.overdue_hours || 0)}</td>
                              <td>{Number(item.threshold_hours || 0)}</td>
                              <td>{parseApiDate(item.updated_at)}</td>
                            </tr>
                          ))}
                          {(Array.isArray(slaData?.overdue_jobs) ? slaData.overdue_jobs : []).length === 0 ? (
                            <tr><td colSpan={7} className="muted">暂无超时数据</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 12 }}>
                    <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                      <strong>最近催办记录</strong>
                      {canWrite ? (
                        <button className="btn btn-danger" onClick={onClearSlaReminders} disabled={busy || slaLoading || slaReminderTotal <= 0}>
                          一键删除
                        </button>
                      ) : null}
                    </div>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>交付单号</th>
                            <th>阶段</th>
                            <th>超时/阈值(小时)</th>
                            <th>说明</th>
                            {canWrite ? <th>操作</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(slaData?.recent_reminders) ? slaData.recent_reminders : []).map((item) => (
                            <tr key={`sla-remind-${item.id}`}>
                              <td>{parseApiDate(item.created_at)}</td>
                              <td>
                                <button type="button" className="text-link" onClick={() => onOpenJobDetail(item.job_id)} disabled={busy}>
                                  {item.job_no || `#${item.job_id}`}
                                </button>
                              </td>
                              <td>{stageText(item.stage_code)}</td>
                              <td>{Number(item.overdue_hours || 0)} / {Number(item.threshold_hours || 0)}</td>
                              <td>{item.message || '-'}</td>
                              {canWrite ? (
                                <td>
                                  <button className="btn btn-danger" onClick={() => onDeleteSlaReminder(item)} disabled={busy || slaLoading}>
                                    删除
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                          {(Array.isArray(slaData?.recent_reminders) ? slaData.recent_reminders : []).length === 0 ? (
                            <tr><td colSpan={canWrite ? 6 : 5} className="muted">暂无催办记录</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <span className="muted">共 {slaReminderTotal} 条</span>
                      <button className="btn" disabled={slaReminderPage <= 1 || slaLoading} onClick={() => setSlaReminderPage((p) => Math.max(1, p - 1))}>上一页</button>
                      <span className="muted">第 {slaReminderPage} 页</span>
                      <button className="btn" disabled={slaLoading || slaReminderPage * slaReminderLimit >= slaReminderTotal} onClick={() => setSlaReminderPage((p) => p + 1)}>下一页</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}

        {activeMenu === 'batch' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>批量管理（Excel）</strong>
            </div>
            <div className="panel-body">
              <div className="panel-subsection">
                <strong>批量导入</strong>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0] ? e.target.files[0] : null
                      setBatchImportFile(file)
                    }}
                  />
                  <button className="btn" onClick={onBatchDownloadTemplate} disabled={busy}>下载导入模板</button>
                  <button className="btn btn-primary" onClick={onBatchImportJobs} disabled={busy || !canWrite}>执行导入</button>
                </div>
                {!canWrite ? <div className="muted" style={{ marginTop: 6 }}>当前角色无导入权限</div> : null}
                {batchImportResult ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    导入结果：总计 {Number(batchImportResult.total_rows || 0)}，成功 {Number(batchImportResult.success_count || 0)}，失败 {Number(batchImportResult.failure_count || 0)}
                  </div>
                ) : null}
              </div>

              <div className="panel-subsection" style={{ marginTop: 12 }}>
                <strong>批量导出</strong>
                <div className="grid" style={{ marginTop: 8 }}>
                  <div className="field">
                    <label>关键词</label>
                    <input
                      value={batchExportFilter.keyword}
                      onChange={(e) => setBatchExportFilter((prev) => ({ ...prev, keyword: e.target.value }))}
                      placeholder="单号/项目编码/产品类型/客户"
                    />
                  </div>
                  <div className="field">
                    <label>客户</label>
                    <input
                      value={batchExportFilter.customer}
                      onChange={(e) => setBatchExportFilter((prev) => ({ ...prev, customer: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>阶段</label>
                    <select
                      value={batchExportFilter.stage}
                      onChange={(e) => setBatchExportFilter((prev) => ({ ...prev, stage: e.target.value }))}
                    >
                      {stageOptions.map((item) => (
                        <option key={`batch-export-${item.value || 'all'}`} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" onClick={onBatchExportJobs} disabled={busy}>导出交付单 Excel</button>
                </div>
              </div>

              <div className="panel-subsection" style={{ marginTop: 12 }}>
                <strong>批量阶段推进</strong>
                <div className="grid" style={{ marginTop: 8 }}>
                  <div className="field">
                    <label>动作</label>
                    <select
                      value={batchStageForm.action}
                      onChange={(e) =>
                        setBatchStageForm((prev) => ({
                          ...prev,
                          action: e.target.value,
                        }))
                      }
                    >
                      {batchActionOptions.map((item) => (
                        <option key={`batch-action-${item.value}`} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>统一备注</label>
                    <input
                      value={batchStageForm.remark}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, remark: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>来源单号（评估用）</label>
                    <input
                      value={batchStageForm.inbound_tracking_no}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, inbound_tracking_no: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>验收单号（归档用）</label>
                    <input
                      value={batchStageForm.outbound_tracking_no}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, outbound_tracking_no: e.target.value }))}
                    />
                  </div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label>交付单 ID 列表（逗号/空格/换行分隔）</label>
                    <textarea
                      value={batchStageForm.job_ids_text}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, job_ids_text: e.target.value }))}
                      placeholder="例如：101,102,103"
                    />
                  </div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                      <label>阶段参数</label>
                      <button className="btn" type="button" onClick={toggleBatchStageAdvancedMode}>
                        {batchStageAdvancedMode ? '切换可视化模式' : '切换高级 JSON 模式'}
                      </button>
                    </div>
                    {!batchStageAdvancedMode ? (
                      <div className="grid" style={{ marginTop: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        {Object.entries(batchStagePayloadForm).map(([key, value]) => (
                          <div className="field" key={`batch-payload-${key}`}>
                            <label>{payloadLabelMap[key] || key}</label>
                            {isPassFailValue(value) ? (
                              <select
                                value={String(value || 'PASS').toUpperCase()}
                                onChange={(e) => updateBatchStagePayloadField(key, String(e.target.value || '').toUpperCase())}
                              >
                                <option value="PASS">PASS</option>
                                <option value="FAIL">FAIL</option>
                              </select>
                            ) : (
                              <input
                                value={value === undefined || value === null ? '' : String(value)}
                                onChange={(e) => updateBatchStagePayloadField(key, e.target.value)}
                              />
                            )}
                          </div>
                        ))}
                        {Object.keys(batchStagePayloadForm).length === 0 ? (
                          <div className="muted">当前动作无需阶段参数</div>
                        ) : null}
                      </div>
                    ) : (
                      <textarea
                        className="mono"
                        value={batchStageForm.stage_payload_json}
                        onChange={(e) => setBatchStageForm((prev) => ({ ...prev, stage_payload_json: e.target.value }))}
                        style={{ minHeight: 130, marginTop: 8 }}
                      />
                    )}
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" onClick={onBatchAdvanceStage} disabled={busy}>执行批量推进</button>
                </div>
                {batchStageResult ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    执行结果：总计 {Number(batchStageResult.total || 0)}，成功 {Number(batchStageResult.success_count || 0)}，失败 {Number(batchStageResult.failure_count || 0)}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {activeMenu === 'create' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>新建交付单</strong>
            </div>
            <div className="panel-body">
              <form className="grid" onSubmit={onCreateJob}>
                <div className="field">
                  <label>项目编码 *</label>
                  <input
                    value={createForm.project_code}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, project_code: e.target.value }))}
                    placeholder="如：PRJ-001"
                    required
                  />
                </div>
                <div className="field">
                  <label>交付标题</label>
                  <input
                    value={createForm.title}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="如：WAF 首次上线交付"
                  />
                </div>
                <div className="field">
                  <label>产品类型</label>
                  <input
                    value={createForm.product_type}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, product_type: e.target.value }))}
                    placeholder="如：WAF / 漏扫 / 数据库审计"
                  />
                </div>
                <div className="field">
                  <label>客户名称 *</label>
                  <input
                    value={createForm.customer_name}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                    placeholder="客户公司"
                    required
                  />
                </div>
                <div className="field">
                  <label>销售订单号</label>
                  <input
                    value={createForm.sales_order_no}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, sales_order_no: e.target.value }))}
                    placeholder="可选"
                  />
                </div>
                <div className="field">
                  <label>来源单号</label>
                  <input
                    value={createForm.inbound_tracking_no}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, inbound_tracking_no: e.target.value }))}
                    placeholder="可选"
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>备注</label>
                  <textarea value={createForm.remark} onChange={(e) => setCreateForm((prev) => ({ ...prev, remark: e.target.value }))} />
                </div>
                <div className="toolbar" style={{ gridColumn: '1 / -1' }}>
                  <button className="btn btn-primary" type="submit" disabled={!canWrite || busy}>
                    {busy ? '提交中...' : '创建交付单'}
                  </button>
                  {!canWrite ? <span className="muted">当前角色无写权限</span> : null}
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {activeMenu === 'jobs' ? (
          <>
            <section className="panel">
              <div className="panel-header">
                <strong>交付单列表</strong>
                <div className="toolbar">
                  <input
                    value={filters.keyword}
                    onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
                    placeholder="搜索单号/项目编码/产品类型/客户"
                  />
                  <select value={filters.stage} onChange={(e) => setFilters((prev) => ({ ...prev, stage: e.target.value }))}>
                    {stageOptions.map((item) => (
                      <option key={item.value || 'all'} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={() => refreshJobs()} disabled={loading}>刷新</button>
                </div>
              </div>
              <div className="panel-body">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>交付单号</th>
                        <th>项目编码</th>
                        <th>产品类型</th>
                        <th>客户</th>
                        <th>来源单号</th>
                        <th>验收单号</th>
                        <th>当前阶段</th>
                        <th>更新时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((row) => (
                        <tr key={row.id}>
                          <td>{row.job_no}</td>
                          <td>{row.project_code}</td>
                          <td>{row.product_type || '-'}</td>
                          <td>{row.customer_name || '-'}</td>
                          <td>{row.inbound_tracking_no || '-'}</td>
                          <td>{row.outbound_tracking_no || '-'}</td>
                          <td><span className="stage-chip">{stageText(row.current_stage)}</span></td>
                          <td>{parseApiDate(row.updated_at)}</td>
                          <td>
                            <button
                              className="btn"
                              onClick={() => onOpenJobDetail(row.id)}
                              disabled={busy || (detailModalOpen && Number(selectedJobId || 0) === Number(row.id || 0))}
                            >
                              详情
                            </button>
                          </td>
                        </tr>
                      ))}
                      {jobs.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="muted">暂无数据</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="toolbar" style={{ marginTop: 12 }}>
                  <span className="muted">共 {total} 条</span>
                  <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
                  <span className="muted">第 {page} 页</span>
                  <button className="btn" disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)}>下一页</button>
                </div>
              </div>
            </section>

            {detailModalOpen ? (
              <div
                className="floating-modal-mask"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) closeDetailModal()
                }}
              >
                <section
                  className={`floating-modal delivery-detail-modal ${detailModalDragging ? 'dragging' : ''}`}
                  ref={detailModalRef}
                  style={{
                    transform: `translate(calc(-50% + ${detailModalPosition.x}px), calc(-50% + ${detailModalPosition.y}px))`,
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <header className="floating-modal-header" onPointerDown={onStartDetailModalDrag}>
                    <div>
                      <h3>交付详情</h3>
                      <div className="muted">交付单号：{detailMatchesSelection ? detail?.job_no || '-' : '-'} | 拖动标题栏可移动</div>
                    </div>
                    <button type="button" className="btn" onClick={closeDetailModal}>关闭</button>
                  </header>

                  <div className="floating-modal-body">
                    {!selectedJobId ? (
                      <div className="muted">请先从列表选择一条交付单</div>
                    ) : detailLoading || !detailMatchesSelection ? (
                      <div className="muted">正在加载交付详情...</div>
                    ) : !detail ? (
                      <div className="muted">未找到交付详情</div>
                    ) : (
                      <>
                        <div className="grid">
                          <div className="field"><label>交付单号</label><input value={detail.job_no || '-'} readOnly /></div>
                          <div className="field"><label>项目编码</label><input value={detail.project_code || '-'} readOnly /></div>
                          <div className="field"><label>交付标题</label><input value={detail.title || '-'} readOnly /></div>
                          <div className="field"><label>产品类型</label><input value={detail.product_type || '-'} readOnly /></div>
                          <div className="field"><label>客户</label><input value={detail.customer_name || '-'} readOnly /></div>
                          <div className="field"><label>流程状态</label><input value={detail.workflow_status || '-'} readOnly /></div>
                          <div className="field"><label>执行阶段</label><input value={stageText(detail.execution_phase || detail.current_stage)} readOnly /></div>
                          <div className="field"><label>当前阶段</label><input value={stageText(detail.current_stage)} readOnly /></div>
                          <div className="field"><label>来源单号</label><input value={detail.inbound_tracking_no || '-'} readOnly /></div>
                          <div className="field"><label>验收单号</label><input value={detail.outbound_tracking_no || '-'} readOnly /></div>
                          <div className="field"><label>评估时间</label><input value={parseApiDate(detail.received_at)} readOnly /></div>
                          <div className="field"><label>归档时间</label><input value={parseApiDate(detail.shipped_at)} readOnly /></div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>关键节点责任人</strong>
                          <div className="table-wrap" style={{ marginTop: 8 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>阶段</th>
                                  <th>执行人</th>
                                  <th>角色</th>
                                  <th>执行时间</th>
                                </tr>
                              </thead>
                              <tbody>
                                {responsibilityRows.map((item) => (
                                  <tr key={`resp-${item.stage}`}>
                                    <td>{stageText(item.stage)}</td>
                                    <td>{item.by || '-'}</td>
                                    <td>{item.role || '-'}</td>
                                    <td>{parseApiDate(item.at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>阶段执行表单</strong>
                          <div className="grid" style={{ marginTop: 8 }}>
                            <div className="field" style={{ gridColumn: '1 / -1' }}>
                              <label>阶段备注</label>
                              <textarea
                                value={advanceForm.remark}
                                onChange={(e) => setAdvanceForm((prev) => ({ ...prev, remark: e.target.value }))}
                                placeholder="阶段备注"
                              />
                            </div>
                            {renderStageFields()}
                          </div>
                          <div className="toolbar" style={{ marginTop: 10 }}>
                            <button className="btn btn-primary" onClick={onAdvanceStage} disabled={!nextAction || busy || !canRunNextAction}>
                              {nextAction ? actionLabelMap[nextAction] : '流程已完成'}
                            </button>
                            {nextAction && !canRunNextAction ? <span className="muted">当前角色无权限执行该阶段</span> : null}
                          </div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>退回重做</strong>
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            <select
                              value={reworkForm.target_stage}
                              onChange={(e) => setReworkForm((prev) => ({ ...prev, target_stage: e.target.value }))}
                            >
                              {reworkTargetOptions.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            <input
                              value={reworkForm.reason}
                              onChange={(e) => setReworkForm((prev) => ({ ...prev, reason: e.target.value }))}
                              placeholder="退回原因（必填）"
                            />
                            <button className="btn btn-warning" onClick={onRework} disabled={reworkTargetOptions.length === 0 || busy || !canRework}>
                              退回重做
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>附件上传与留证</strong>
                          <div className="grid" style={{ marginTop: 8 }}>
                            <div className="field">
                              <label>所属阶段</label>
                              <select
                                value={attachmentForm.stage_code}
                                onChange={(e) => setAttachmentForm((prev) => ({ ...prev, stage_code: e.target.value }))}
                              >
                                {Object.entries(stageLabelMap).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="field">
                              <label>附件文件</label>
                              <input
                                type="file"
                                onChange={(e) => {
                                  const file = e.target.files && e.target.files[0] ? e.target.files[0] : null
                                  setAttachmentForm((prev) => ({ ...prev, file }))
                                }}
                              />
                            </div>
                            <div className="field" style={{ gridColumn: '1 / -1' }}>
                              <label>附件备注</label>
                              <textarea value={attachmentForm.remark} onChange={(e) => setAttachmentForm((prev) => ({ ...prev, remark: e.target.value }))} />
                            </div>
                          </div>
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            <button className="btn btn-primary" onClick={onUploadAttachment} disabled={busy || !canUpload}>上传附件</button>
                            {!canUpload ? <span className="muted">当前角色无上传权限</span> : null}
                            {(nextStageCode === 'IMPLEMENT' || nextStageCode === 'TUNE' || nextStageCode === 'TRIAL' || nextStageCode === 'ACCEPT') ? (
                              <span className="muted">提示：推进到“{stageText(nextStageCode)}”前，需先上传该阶段至少1个附件。</span>
                            ) : null}
                          </div>

                          <div className="table-wrap" style={{ marginTop: 10 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>文件名</th>
                                  <th>阶段</th>
                                  <th>大小</th>
                                  <th>上传人</th>
                                  <th>上传时间</th>
                                  <th>备注</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(detail.attachments) ? detail.attachments : []).map((item) => (
                                  <tr key={item.id}>
                                    <td>{item.file_name}</td>
                                    <td>{stageText(item.stage_code)}</td>
                                    <td>{Math.round(Number(item.file_size || 0) / 1024)} KB</td>
                                    <td>{item.uploaded_by_name || '-'}</td>
                                    <td>{parseApiDate(item.uploaded_at)}</td>
                                    <td>{item.remark || '-'}</td>
                                    <td>
                                      <div className="toolbar">
                                        <button className="btn" onClick={() => onDownloadAttachment(item)}>下载</button>
                                        {canDeleteAttachment ? (
                                          <button className="btn btn-danger" onClick={() => onDeleteAttachment(item)} disabled={busy}>删除</button>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {(Array.isArray(detail.attachments) ? detail.attachments : []).length === 0 ? (
                                  <tr><td colSpan={7} className="muted">暂无附件</td></tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>项目协同</strong>
                          <div className="grid" style={{ marginTop: 8 }}>
                            <div className="field"><label>项目编码</label><input value={detail.project_code || '-'} readOnly /></div>
                            <div className="field"><label>项目ID</label><input value={detail.project_id || '-'} readOnly /></div>
                            <div className="field"><label>来源系统</label><input value={detail.source_system || '-'} readOnly /></div>
                            <div className="field"><label>历史映射</label><input value={`工单=${detail.legacy_ticket_id || '-'} / 实施记录=${detail.legacy_sec_impl_id || '-'}`} readOnly /></div>
                          </div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>交付物清单</strong>
                          <div className="table-wrap" style={{ marginTop: 10 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>阶段</th>
                                  <th>交付物</th>
                                  <th>状态</th>
                                  <th>完成人</th>
                                  <th>完成时间</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(detail.deliverables) ? detail.deliverables : []).map((item) => (
                                  <tr key={`deliverable-${item.id}`}>
                                    <td>{stageText(item.stage_code)}</td>
                                    <td>{item.name}</td>
                                    <td>{item.done_flag ? '已完成' : '待完成'}</td>
                                    <td>{item.done_by_name || '-'}</td>
                                    <td>{parseApiDate(item.done_at)}</td>
                                    <td>
                                      <div className="toolbar">
                                        {item.done_flag ? (
                                          <button className="btn" onClick={() => onToggleDeliverable(item, false)} disabled={busy || !canWrite}>重置</button>
                                        ) : (
                                          <button className="btn btn-primary" onClick={() => onToggleDeliverable(item, true)} disabled={busy || !canWrite}>标记完成</button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {(Array.isArray(detail.deliverables) ? detail.deliverables : []).length === 0 ? (
                                  <tr><td colSpan={6} className="muted">当前产品未配置交付物模板</td></tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>评论协作</strong>
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            <textarea
                              style={{ flex: 1, minHeight: 86 }}
                              value={commentForm.content}
                              onChange={(e) => setCommentForm({ content: e.target.value })}
                              placeholder="补充交付说明、审批意见或风险提示"
                            />
                            <button className="btn btn-primary" onClick={onCreateComment} disabled={busy || !canWrite}>添加评论</button>
                          </div>
                          <div className="table-wrap" style={{ marginTop: 10 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>评论内容</th>
                                  <th>提交人</th>
                                  <th>角色</th>
                                  <th>时间</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(detail.comments) ? detail.comments : []).map((item) => (
                                  <tr key={`comment-${item.id}`}>
                                    <td>{item.content}</td>
                                    <td>{item.created_by_name || '-'}</td>
                                    <td>{item.created_by_role || '-'}</td>
                                    <td>{parseApiDate(item.created_at)}</td>
                                  </tr>
                                ))}
                                {(Array.isArray(detail.comments) ? detail.comments : []).length === 0 ? (
                                  <tr><td colSpan={4} className="muted">暂无评论</td></tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>排期协同</strong>
                          <div className="grid" style={{ marginTop: 8 }}>
                            <div className="field">
                              <label>责任人</label>
                              <input value={scheduleForm.assignee_name} onChange={(e) => setScheduleForm((prev) => ({ ...prev, assignee_name: e.target.value }))} placeholder="姓名" />
                            </div>
                            <div className="field">
                              <label>角色</label>
                              <input value={scheduleForm.assignee_role} onChange={(e) => setScheduleForm((prev) => ({ ...prev, assignee_role: e.target.value }))} placeholder="实施/审核/项目经理" />
                            </div>
                            <div className="field">
                              <label>开始时间</label>
                              <input type="datetime-local" value={scheduleForm.start_at} onChange={(e) => setScheduleForm((prev) => ({ ...prev, start_at: e.target.value }))} />
                            </div>
                            <div className="field">
                              <label>结束时间</label>
                              <input type="datetime-local" value={scheduleForm.end_at} onChange={(e) => setScheduleForm((prev) => ({ ...prev, end_at: e.target.value }))} />
                            </div>
                            <div className="field" style={{ gridColumn: '1 / -1' }}>
                              <label>排期备注</label>
                              <textarea value={scheduleForm.remark} onChange={(e) => setScheduleForm((prev) => ({ ...prev, remark: e.target.value }))} />
                            </div>
                          </div>
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            <button className="btn btn-primary" onClick={onCreateSchedule} disabled={busy || !canWrite}>添加排期</button>
                          </div>
                          <div className="table-wrap" style={{ marginTop: 10 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>责任人</th>
                                  <th>角色</th>
                                  <th>开始</th>
                                  <th>结束</th>
                                  <th>备注</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(detail.schedules) ? detail.schedules : []).map((item) => (
                                  <tr key={`schedule-${item.id}`}>
                                    <td>{item.assignee_name || '-'}</td>
                                    <td>{item.assignee_role || '-'}</td>
                                    <td>{parseApiDate(item.start_at)}</td>
                                    <td>{parseApiDate(item.end_at)}</td>
                                    <td>{item.remark || '-'}</td>
                                  </tr>
                                ))}
                                {(Array.isArray(detail.schedules) ? detail.schedules : []).length === 0 ? (
                                  <tr><td colSpan={5} className="muted">暂无排期</td></tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div style={{ marginTop: 14 }}>
                          <strong>流程与阶段时间轴</strong>
                          <div className="timeline" style={{ marginTop: 8 }}>
                            {(Array.isArray(detail.workflow_events) ? detail.workflow_events : []).map((item) => (
                              <div className="timeline-item" key={`workflow-${item.id}`}>
                                <div>
                                  <strong>{item.action || '-'}</strong>
                                  {item.from_phase || item.to_phase ? ` · ${stageText(item.from_phase || '-')} → ${stageText(item.to_phase || '-')}` : ''}
                                </div>
                                <div className="muted">
                                  操作人：{item.operator_name || '-'} ({item.operator_role || '-'}) · {parseApiDate(item.created_at)}
                                </div>
                                {item.comment_text ? <div className="muted">说明：{item.comment_text}</div> : null}
                              </div>
                            ))}
                            {(Array.isArray(detail.stage_records) ? detail.stage_records : []).map((item) => (
                              <div className="timeline-item" key={item.id}>
                                <div>
                                  <strong>{timelineActionText(item.action)}</strong> · {stageText(item.from_stage)} → {stageText(item.to_stage)}
                                </div>
                                <div className="muted">
                                  执行人：{item.operator_name || '-'} ({item.operator_role || '-'}) · {parseApiDate(item.operated_at)}
                                </div>
                                {item.remark ? <div className="muted">备注：{item.remark}</div> : null}
                                {item.rework_reason ? <div className="muted">退回原因：{item.rework_reason}</div> : null}
                                {formatStagePayload(item.stage_payload).map((line, idx) => (
                                  <div className="muted" key={`${item.id}-payload-${idx}`}>- {line}</div>
                                ))}
                              </div>
                            ))}
                            {(Array.isArray(detail.stage_records) ? detail.stage_records : []).length === 0 ? (
                              <div className="muted">暂无阶段记录</div>
                            ) : null}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </>
        ) : null}

        {canReadAuditLogs && activeMenu === 'audit' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>审计日志</strong>
            </div>
            <div className="panel-body">
              <div className="grid">
                <div className="field">
                  <label>开始日期</label>
                  <input
                    type="date"
                    value={auditFilter.from}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, from: e.target.value }))
                    }}
                  />
                </div>
                <div className="field">
                  <label>结束日期</label>
                  <input
                    type="date"
                    value={auditFilter.to}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, to: e.target.value }))
                    }}
                  />
                </div>
                <div className="field">
                  <label>动作</label>
                  <input
                    value={auditFilter.action}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, action: e.target.value.toUpperCase() }))
                    }}
                    placeholder="如 STAGE_TEST"
                  />
                </div>
                <div className="field">
                  <label>操作人</label>
                  <input
                    value={auditFilter.username}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, username: e.target.value }))
                    }}
                    placeholder="用户名"
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>关键词</label>
                  <input
                    value={auditFilter.keyword}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, keyword: e.target.value }))
                    }}
                    placeholder="支持交付单号/项目编码/客户/动作/说明"
                  />
                </div>
              </div>

              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => refreshAuditLogs()} disabled={auditLoading}>
                  {auditLoading ? '加载中...' : '查询'}
                </button>
                <button className="btn btn-primary" onClick={onExportAudit} disabled={busy}>导出 CSV</button>
              </div>

              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作人</th>
                      <th>角色</th>
                      <th>动作</th>
                      <th>交付单号</th>
                      <th>项目编码</th>
                      <th>说明</th>
                      <th>来源IP</th>
                      <th>变更摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((row) => (
                      <tr key={`audit-${row.id}`}>
                        <td>{parseApiDate(row.created_at)}</td>
                        <td>{row.username || '-'}</td>
                        <td>{row.user_role || '-'}</td>
                        <td>{row.action || '-'}</td>
                        <td>
                          {row.job_id ? (
                            <button
                              type="button"
                              className="text-link"
                              onClick={() => onOpenJobDetail(row.job_id)}
                              disabled={busy}
                            >
                              {row.job_no || `#${row.job_id}`}
                            </button>
                          ) : (
                            row.job_no || '-'
                          )}
                        </td>
                        <td>{row.project_code || '-'}</td>
                        <td>{row.message || '-'}</td>
                        <td>{row.request_ip || '-'}</td>
                        <td>{buildAuditChangeSummary(row.before_data, row.after_data)}</td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 ? (
                      <tr><td colSpan={9} className="muted">暂无日志</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="toolbar" style={{ marginTop: 10 }}>
                <span className="muted">共 {auditTotal} 条</span>
                <button className="btn" disabled={auditPage <= 1} onClick={() => setAuditPage((p) => Math.max(1, p - 1))}>上一页</button>
                <span className="muted">第 {auditPage} 页</span>
                <button className="btn" disabled={auditPage * auditLimit >= auditTotal} onClick={() => setAuditPage((p) => p + 1)}>下一页</button>
              </div>
            </div>
          </section>
        ) : null}

        {canReadAuditLogs && activeMenu === 'audit-verify' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>审计验签</strong>
            </div>
            <div className="panel-body">
              <div className="grid">
                <div className="field">
                  <label>起始日志ID（可选）</label>
                  <input
                    type="number"
                    min={1}
                    value={auditVerifyForm.from_id}
                    onChange={(e) => setAuditVerifyForm((prev) => ({ ...prev, from_id: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>结束日志ID（可选）</label>
                  <input
                    type="number"
                    min={1}
                    value={auditVerifyForm.to_id}
                    onChange={(e) => setAuditVerifyForm((prev) => ({ ...prev, to_id: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>校验条数上限</label>
                  <input
                    type="number"
                    min={1}
                    max={20000}
                    value={auditVerifyForm.limit}
                    onChange={(e) => setAuditVerifyForm((prev) => ({ ...prev, limit: e.target.value }))}
                  />
                </div>
              </div>

              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn btn-primary" onClick={onVerifyAuditChain} disabled={auditVerifyLoading || busy}>
                  {auditVerifyLoading ? '验签中...' : '执行验签'}
                </button>
              </div>

              {!auditVerifyResult ? (
                <div className="muted" style={{ marginTop: 10 }}>尚未执行验签</div>
              ) : (
                <>
                  <div className={`msg ${auditVerifyResult.passed ? 'success' : 'error'}`} style={{ marginTop: 10 }}>
                    校验时间：{parseApiDate(auditVerifyResult.verified_at)}，
                    校验 {Number(auditVerifyResult.total_checked || 0)} 条，
                    问题 {Number(auditVerifyResult.issue_count || 0)} 条。
                  </div>

                  <div className="table-wrap" style={{ marginTop: 10 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>日志ID</th>
                          <th>问题类型</th>
                          <th>期望值</th>
                          <th>实际值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(auditVerifyResult.issues) ? auditVerifyResult.issues : []).map((item, idx) => (
                          <tr key={`audit-issue-${idx}-${item.id}`}>
                            <td>{item.id}</td>
                            <td>{item.issue}</td>
                            <td className="mono">{item.expected_hash || item.expected_prev_hash || '-'}</td>
                            <td className="mono">{item.actual_hash || item.actual_prev_hash || '-'}</td>
                          </tr>
                        ))}
                        {(Array.isArray(auditVerifyResult.issues) ? auditVerifyResult.issues : []).length === 0 ? (
                          <tr><td colSpan={4} className="muted">未发现审计链问题</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}
      </main>

      {confirmDialog.open ? (
        <div className="dialog-backdrop" onClick={closeConfirmDialog}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-title">{confirmDialog.title || '确认操作'}</div>
            <div className="dialog-body">{confirmDialog.message || '确认执行该操作？'}</div>
            <div className="dialog-actions">
              <button className="btn" type="button" onClick={closeConfirmDialog}>取消</button>
              <button className="btn btn-primary" type="button" onClick={onConfirmDialogAccept}>
                {confirmDialog.confirmLabel || '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App

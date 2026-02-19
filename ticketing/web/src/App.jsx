import { useEffect, useMemo, useState, useRef } from 'react'
import * as echarts from 'echarts'
import './App.css'

const buildApi = () => ({
  get: async (path) => {
    const res = await fetch(path, {
      credentials: 'include',
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  post: async (path, body) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  postForm: async (path, formData) => {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  put: async (path, body) => {
    const res = await fetch(path, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  del: async (path) => {
    const res = await fetch(path, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
})

const PAGE_SIZE = 10

const paginate = (list, page) => {
  const total = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const current = Math.min(Math.max(page, 1), total)
  const start = (current - 1) * PAGE_SIZE
  return {
    current,
    total,
    items: list.slice(start, start + PAGE_SIZE),
  }
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`
}

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'OPEN', label: '新建' },
  { value: 'ACCEPTED', label: '受理' },
  { value: 'IN_PROGRESS', label: '处理中' },
  { value: 'WAIT_VERIFY', label: '待验证' },
  { value: 'RESOLVED', label: '完成' },
  { value: 'CLOSED', label: '已关闭' },
]
const statusTransitionMap = {
  OPEN: ['ACCEPTED'],
  ACCEPTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['WAIT_VERIFY'],
  WAIT_VERIFY: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: ['OPEN'],
}

const getStatusLabel = (value) => {
  const match = statusOptions.find((option) => option.value === value)
  return match ? match.label : value || '-'
}

const priorities = ['P1', 'P2', 'P3']
const severityOptions = [
  { value: '', label: '全部严重级别' },
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'CRITICAL', label: '紧急' },
]
const slaStatusOptions = [
  { value: '', label: '全部SLA状态' },
  { value: 'PENDING', label: '进行中' },
  { value: 'NEAR_DUE', label: '即将超时' },
  { value: 'BREACHED', label: '已超时' },
  { value: 'ON_TIME', label: '按时完成' },
]
const severityLabelMap = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  CRITICAL: '紧急',
}
const slaLabelMap = {
  PENDING: '进行中',
  NEAR_DUE: '即将超时',
  BREACHED: '已超时',
  ON_TIME: '按时完成',
}
const ticketEventLabelMap = {
  CREATED: '创建工单',
  UPDATED: '更新工单',
  ASSIGNEE_CHANGED: '协作人变更',
  WATCHER_CHANGED: '观察者变更',
  SCHEDULE_CREATED: '新增排期',
  STAGE_STATUS_CHANGED: '阶段状态变更',
  STAGES_REGENERATED: '按模板重建阶段',
  DELIVERABLE_UPDATED: '交付物更新',
  COMMENT_ADDED: '新增评论',
  APPROVAL_APPROVED: '审批通过',
  APPROVAL_REJECTED: '审批驳回',
  OWNER_ASSIGNED: '负责人指派',
  ATTACHMENT_UPLOADED: '上传附件',
  ATTACHMENT_DELETED: '删除附件',
}

const parseJsonSafe = (value, fallback) => {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const formatFileSize = (size) => {
  const bytes = Number(size || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const normalizePermissionMember = (row) => {
  const userId = Number(row?.user_id)
  return {
    user_id: Number.isFinite(userId) ? userId : 0,
    username: String(row?.username || row?.created_name || row?.name || `用户#${row?.user_id || '-'}`),
    can_view: row?.can_view === true || Number(row?.can_view) === 1,
    can_edit: row?.can_edit === true || Number(row?.can_edit) === 1,
    can_assign: row?.can_assign === true || Number(row?.can_assign) === 1,
    can_close: row?.can_close === true || Number(row?.can_close) === 1,
  }
}

const buildPermissionDiffFromMembers = (beforeRows, afterRows) => {
  const before = (Array.isArray(beforeRows) ? beforeRows : []).map(normalizePermissionMember)
  const after = (Array.isArray(afterRows) ? afterRows : []).map(normalizePermissionMember)
  const beforeMap = new Map(before.map((item) => [item.user_id, item]))
  const afterMap = new Map(after.map((item) => [item.user_id, item]))
  const added = []
  const removed = []
  const changed = []
  const flagKeys = ['can_view', 'can_edit', 'can_assign', 'can_close']

  for (const item of after) {
    const prev = beforeMap.get(item.user_id)
    if (!prev) {
      added.push(item)
      continue
    }
    const changes = []
    flagKeys.forEach((key) => {
      if (prev[key] !== item[key]) {
        changes.push({ key, before: prev[key], after: item[key] })
      }
    })
    if (changes.length) {
      changed.push({ user_id: item.user_id, username: item.username, changes })
    }
  }

  for (const item of before) {
    if (!afterMap.has(item.user_id)) {
      removed.push(item)
    }
  }

  return { added, removed, changed }
}

const permissionKeyToLabel = (key) => {
  if (key === 'can_view') return '可见'
  if (key === 'can_edit') return '可编辑'
  if (key === 'can_assign') return '可分派'
  if (key === 'can_close') return '可关闭'
  return key
}
const emptyTicketForm = {
  title: '',
  description: '',
  priority: 'P2',
  status: 'OPEN',
  owner_id: '',
  project_id: '',
  department_code: '',
  service_code: '',
  severity: 'MEDIUM',
  customer_name: '',
  requester_name: '',
  requester_phone: '',
  requester_email: '',
  sla_response_minutes: 30,
  sla_resolve_minutes: 480,
}
const emptyStageRow = {
  name: '',
  duration_days: 1,
  deliverables: '',
  roles: '',
}
const builtInTemplates = [
  {
    code: 'VULN_SCAN',
    name: '漏洞扫描',
    description: '资产确认、扫描验证、报告交付',
    stages: [
      { name: '需求确认与资产收集', duration_days: 1, deliverables: ['资产清单'], roles: ['项目经理'] },
      { name: '扫描与验证', duration_days: 2, deliverables: ['漏洞清单'], roles: ['安全工程师'] },
      { name: '报告与建议', duration_days: 1, deliverables: ['扫描报告'], roles: ['安全工程师', '项目经理'] },
    ],
  },
  {
    code: 'PENTEST',
    name: '渗透测试',
    description: '授权确认、测试执行、复测与汇报',
    stages: [
      { name: '授权与范围确认', duration_days: 1, deliverables: ['授权书'], roles: ['项目经理'] },
      { name: '渗透测试执行', duration_days: 4, deliverables: ['漏洞证据'], roles: ['渗透测试工程师'] },
      { name: '复测与报告', duration_days: 2, deliverables: ['渗透测试报告'], roles: ['渗透测试工程师'] },
    ],
  },
]

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

const getSeverityLabel = (value) => severityLabelMap[value] || value || '-'
const getSlaLabel = (value) => slaLabelMap[value] || value || '-'
const getTicketEventLabel = (value) => ticketEventLabelMap[value] || value || '事件'
const getApprovalStatusLabel = (value) => {
  const map = {
    NOT_REQUIRED: '无需审批',
    PENDING: '待审批',
    APPROVED: '已通过',
    REJECTED: '已驳回',
  }
  return map[String(value || '').toUpperCase()] || value || '-'
}

export default function App() {
  const [authToken, setAuthToken] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)

  const [tickets, setTickets] = useState([])
  const [ticketSearch, setTicketSearch] = useState('')
  const [ticketStatus, setTicketStatus] = useState('')
  const [ticketProjectFilter, setTicketProjectFilter] = useState('')
  const [ticketOwnerFilter, setTicketOwnerFilter] = useState('')
  const [ticketCreatedFrom, setTicketCreatedFrom] = useState('')
  const [ticketCreatedTo, setTicketCreatedTo] = useState('')
  const [ticketTagsFilter, setTicketTagsFilter] = useState('')
  const [ticketDepartmentFilter, setTicketDepartmentFilter] = useState('')
  const [ticketServiceFilter, setTicketServiceFilter] = useState('')
  const [ticketSeverityFilter, setTicketSeverityFilter] = useState('')
  const [ticketSlaFilter, setTicketSlaFilter] = useState('')
  const [ticketPage, setTicketPage] = useState(1)
  const [ticketForm, setTicketForm] = useState({ ...emptyTicketForm })
  const [editingId, setEditingId] = useState(null)
  const [projects, setProjects] = useState([])
  const [departments, setDepartments] = useState([])
  const [services, setServices] = useState([])
  const [dashboardStats, setDashboardStats] = useState([])
  const [slaGroups, setSlaGroups] = useState({ near_due: [], breached: [] })
  const [reportSummary, setReportSummary] = useState(null)
  const [projectForm, setProjectForm] = useState({ name: '', description: '' })
  const [editingProjectId, setEditingProjectId] = useState(null)
  const [ganttProjectId, setGanttProjectId] = useState('')
  const [ganttData, setGanttData] = useState(null)
  const [templates, setTemplates] = useState([])
  const [templateForm, setTemplateForm] = useState({
    code: '',
    name: '',
    description: '',
  })
  const [templateStages, setTemplateStages] = useState([
    { ...emptyStageRow },
  ])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [selectedBuiltInTemplate, setSelectedBuiltInTemplate] = useState('')
  const [ticketStages, setTicketStages] = useState([])
  const [ticketEvents, setTicketEvents] = useState([])
  const [activeTicket, setActiveTicket] = useState(null)
  const [activeMenu, setActiveMenu] = useState('tickets')
  const [users, setUsers] = useState([])
  const [permissionProjectId, setPermissionProjectId] = useState('')
  const [projectPermissions, setProjectPermissions] = useState([])
  const [permissionUserId, setPermissionUserId] = useState('')
  const [permissionLogs, setPermissionLogs] = useState([])
  const [permissionLogOperator, setPermissionLogOperator] = useState('')
  const [permissionLogFrom, setPermissionLogFrom] = useState('')
  const [permissionLogTo, setPermissionLogTo] = useState('')
  const [permissionLogEventType, setPermissionLogEventType] = useState('')
  const [expandedPermissionLogs, setExpandedPermissionLogs] = useState({})
  const [ticketAssignees, setTicketAssignees] = useState([])
  const [selectedAssignees, setSelectedAssignees] = useState([])
  const [ticketWatchers, setTicketWatchers] = useState([])
  const [selectedWatchers, setSelectedWatchers] = useState([])
  const [ticketComments, setTicketComments] = useState([])
  const [ticketAttachments, setTicketAttachments] = useState([])
  const [attachmentUploading, setAttachmentUploading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [approvalComment, setApprovalComment] = useState('')
  const [notifications, setNotifications] = useState([])
  const [notificationUnreadOnly, setNotificationUnreadOnly] = useState(false)
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [eventOperatorFilter, setEventOperatorFilter] = useState('')
  const [eventFromFilter, setEventFromFilter] = useState('')
  const [eventToFilter, setEventToFilter] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [calendarDays, setCalendarDays] = useState([])
  const [calendarDetail, setCalendarDetail] = useState({ open: false, day: null, items: [] })
  const ganttRef = useRef(null)
  const ganttChart = useRef(null)
  const ticketEditorRef = useRef(null)
  const ticketEditorDrag = useRef({ dragging: false, offsetX: 0, offsetY: 0 })
  const [ticketEditorPos, setTicketEditorPos] = useState({ x: 96, y: 56 })

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const bootstrapAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
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
      window.location.href = buildPortalEntryUrl('ticketing')
    }, logoutPending ? 1000 : 120)
    return () => clearTimeout(timer)
  }, [authReady, authToken, logoutPending])

  useEffect(() => {
    if (!authToken || !logoutPending) return
    setLogoutPending(false)
  }, [authToken, logoutPending])

  const api = useMemo(() => buildApi(), [])

  const showMessage = (text) => {
    setMessage(text)
    setError('')
    setTimeout(() => setMessage(''), 2500)
  }

  const showError = (text) => {
    setError(text)
    setMessage('')
    setTimeout(() => setError(''), 3000)
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

  const resetTicketEditorPosition = () => {
    const viewportWidth = window.innerWidth || 1366
    const modalWidth = Math.min(viewportWidth - 24, 1260)
    setTicketEditorPos({
      x: Math.max(12, Math.round((viewportWidth - modalWidth) / 2)),
      y: Math.max(20, Math.round((window.innerHeight || 900) * 0.06)),
    })
  }

  const onTicketEditorDragStart = (event) => {
    if (!editingId || event.button !== 0) return
    const rect = ticketEditorRef.current?.getBoundingClientRect()
    const baseX = Number.isFinite(rect?.left) ? rect.left : ticketEditorPos.x
    const baseY = Number.isFinite(rect?.top) ? rect.top : ticketEditorPos.y
    ticketEditorDrag.current = {
      dragging: true,
      offsetX: event.clientX - baseX,
      offsetY: event.clientY - baseY,
    }
    document.body.style.userSelect = 'none'
  }

  const refreshCurrentUser = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/auth/me')
      setCurrentUser(data)
    } catch {
      setAuthToken('')
      setCurrentUser(null)
    }
  }

  const refreshTickets = async () => {
    if (!authToken) return
    try {
      const params = new URLSearchParams()
      if (ticketStatus) params.set('status', ticketStatus)
      if (ticketSearch) params.set('search', ticketSearch)
      if (ticketProjectFilter) params.set('project_id', ticketProjectFilter)
      if (ticketOwnerFilter) params.set('owner_id', ticketOwnerFilter)
      if (ticketCreatedFrom) params.set('created_from', ticketCreatedFrom)
      if (ticketCreatedTo) params.set('created_to', ticketCreatedTo)
      if (ticketTagsFilter) params.set('tags', ticketTagsFilter)
      if (ticketDepartmentFilter) params.set('department_code', ticketDepartmentFilter)
      if (ticketServiceFilter) params.set('service_code', ticketServiceFilter)
      if (ticketSeverityFilter) params.set('severity', ticketSeverityFilter)
      if (ticketSlaFilter) params.set('sla_status', ticketSlaFilter)
      const data = await api.get(`/api/tickets?${params.toString()}`)
      setTickets(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshProjects = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/projects')
      setProjects(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshDepartments = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/departments')
      setDepartments(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshServices = async (departmentCode = '') => {
    if (!authToken) return
    try {
      const qs = departmentCode ? `?department_code=${encodeURIComponent(departmentCode)}` : ''
      const data = await api.get(`/api/service-catalog${qs}`)
      setServices(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshDashboardStats = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/dashboard/department')
      setDashboardStats(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshSlaGroups = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/dashboard/sla-groups')
      setSlaGroups({
        near_due: Array.isArray(data?.near_due) ? data.near_due : [],
        breached: Array.isArray(data?.breached) ? data.breached : [],
      })
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshNotifications = async (unreadOnly = notificationUnreadOnly) => {
    if (!authToken) return
    try {
      const params = new URLSearchParams()
      if (unreadOnly) params.set('unread_only', '1')
      const data = await api.get(`/api/notifications${params.toString() ? `?${params.toString()}` : ''}`)
      setNotifications(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshReportSummary = async () => {
    if (!authToken) return
    try {
      const params = new URLSearchParams()
      if (ticketStatus) params.set('status', ticketStatus)
      if (ticketProjectFilter) params.set('project_id', ticketProjectFilter)
      if (ticketOwnerFilter) params.set('owner_id', ticketOwnerFilter)
      if (ticketCreatedFrom) params.set('from', ticketCreatedFrom)
      if (ticketCreatedTo) params.set('to', ticketCreatedTo)
      if (ticketTagsFilter) params.set('tags', ticketTagsFilter)
      if (ticketDepartmentFilter) params.set('department_code', ticketDepartmentFilter)
      if (ticketServiceFilter) params.set('service_code', ticketServiceFilter)
      const data = await api.get(`/api/reports/summary?${params.toString()}`)
      setReportSummary(data || null)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshTemplates = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/templates')
      setTemplates(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onCreateTemplate = async (e) => {
    e.preventDefault()
    try {
      if (!templateForm.code || !templateForm.name) {
        return showError('模板编码和模板名称不能为空')
      }
      const stages = templateStages
        .map((row) => ({
          name: String(row.name || '').trim(),
          duration_days: Number(row.duration_days || 0),
          deliverables: String(row.deliverables || '')
            .split('，')
            .join(',')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          roles: String(row.roles || '')
            .split('，')
            .join(',')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        }))
        .filter((row) => row.name)
      if (!stages.length) return showError('请至少填写一个阶段')
      if (stages.some((row) => row.duration_days <= 0)) return showError('阶段工期必须大于0')
      await api.post('/api/templates/import', {
        templates: [
          {
            code: templateForm.code,
            name: templateForm.name,
            description: templateForm.description,
            stages,
          },
        ],
      })
      showMessage('模板已创建')
      setTemplateForm({
        code: '',
        name: '',
        description: '',
      })
      setTemplateStages([{ ...emptyStageRow }])
      refreshTemplates()
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onImportTemplates = async () => {
    try {
      const chosen =
        selectedBuiltInTemplate === 'ALL'
          ? builtInTemplates
          : builtInTemplates.filter((item) => item.code === selectedBuiltInTemplate)
      if (!chosen.length) return showError('请先选择内置模板')
      await api.post('/api/templates/import', { templates: chosen })
      showMessage(chosen.length > 1 ? '已导入全部内置模板' : `已导入模板：${chosen[0].name}`)
      refreshTemplates()
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const updateTemplateStageRow = (index, key, value) => {
    setTemplateStages((prev) => prev.map((row, idx) => (idx === index ? { ...row, [key]: value } : row)))
  }

  const addTemplateStageRow = () => {
    setTemplateStages((prev) => [...prev, { ...emptyStageRow }])
  }

  const removeTemplateStageRow = (index) => {
    setTemplateStages((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)))
  }

  const refreshTicketStages = async (ticketId) => {
    if (!authToken || !ticketId) return
    try {
      const data = await api.get(`/api/tickets/${ticketId}/stages`)
      setTicketStages(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshTicketEvents = async (ticketId, filters = {}) => {
    if (!authToken || !ticketId) return
    try {
      const params = new URLSearchParams()
      if (filters.event_type) params.set('event_type', filters.event_type)
      if (filters.operator) params.set('operator', filters.operator)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      const query = params.toString()
      const data = await api.get(`/api/tickets/${ticketId}/events${query ? `?${query}` : ''}`)
      setTicketEvents(Array.isArray(data) ? data : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const refreshUsers = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/users')
      setUsers(Array.isArray(data) ? data : [])
    } catch {
      // 非管理员可能无权限，忽略
    }
  }

  const refreshProjectPermissions = async (projectId = permissionProjectId) => {
    if (!authToken || !projectId) {
      setProjectPermissions([])
      return
    }
    try {
      const data = await api.get(`/api/projects/${projectId}/permissions`)
      setProjectPermissions(Array.isArray(data?.members) ? data.members : [])
    } catch (err) {
      showError(normalizeApiError(err))
      setProjectPermissions([])
    }
  }

  const refreshProjectPermissionLogs = async (projectId = permissionProjectId) => {
    if (!authToken || !projectId) {
      setPermissionLogs([])
      setExpandedPermissionLogs({})
      return
    }
    try {
      const params = new URLSearchParams()
      if (permissionLogEventType) params.set('event_type', permissionLogEventType)
      if (permissionLogOperator) params.set('operator', permissionLogOperator)
      if (permissionLogFrom) params.set('from', permissionLogFrom)
      if (permissionLogTo) params.set('to', permissionLogTo)
      const query = params.toString()
      const data = await api.get(
        `/api/projects/${projectId}/permissions/logs${query ? `?${query}` : ''}`,
      )
      setPermissionLogs(Array.isArray(data) ? data : [])
      setExpandedPermissionLogs({})
    } catch (err) {
      showError(normalizeApiError(err))
      setPermissionLogs([])
      setExpandedPermissionLogs({})
    }
  }

  const refreshTicketAssignees = async (ticketId) => {
    if (!authToken || !ticketId) return
    try {
      const data = await api.get(`/api/tickets/${ticketId}/assignees`)
      setTicketAssignees(Array.isArray(data) ? data : [])
      setSelectedAssignees(Array.isArray(data) ? data.map((u) => String(u.id)) : [])
    } catch {
      // ignore
    }
  }

  const refreshTicketWatchers = async (ticketId) => {
    if (!authToken || !ticketId) return
    try {
      const data = await api.get(`/api/tickets/${ticketId}/watchers`)
      setTicketWatchers(Array.isArray(data) ? data : [])
      setSelectedWatchers(Array.isArray(data) ? data.map((u) => String(u.id)) : [])
    } catch {
      // ignore
    }
  }

  const refreshTicketComments = async (ticketId) => {
    if (!authToken || !ticketId) return
    try {
      const data = await api.get(`/api/tickets/${ticketId}/comments`)
      setTicketComments(Array.isArray(data) ? data : [])
    } catch {
      // ignore
    }
  }

  const refreshTicketAttachments = async (ticketId) => {
    if (!authToken || !ticketId) return
    try {
      const data = await api.get(`/api/tickets/${ticketId}/attachments`)
      setTicketAttachments(Array.isArray(data) ? data : [])
    } catch {
      setTicketAttachments([])
    }
  }

  const loadActiveTicketEvents = (ticketId) =>
    refreshTicketEvents(ticketId, {
      event_type: eventTypeFilter,
      operator: eventOperatorFilter,
      from: eventFromFilter,
      to: eventToFilter,
    })

  const loadCalendarMonth = async () => {
    if (!authToken) return
    try {
      const year = calendarMonth.getFullYear()
      const month = calendarMonth.getMonth() + 1
      const data = await api.get(`/api/calendar/month?year=${year}&month=${month}`)
      setCalendarDays(Array.isArray(data.days) ? data.days : [])
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  useEffect(() => {
    refreshCurrentUser()
  }, [authToken])

  useEffect(() => {
    refreshTickets()
  }, [
    authToken,
    ticketSearch,
    ticketStatus,
    ticketProjectFilter,
    ticketOwnerFilter,
    ticketCreatedFrom,
    ticketCreatedTo,
    ticketTagsFilter,
    ticketDepartmentFilter,
    ticketServiceFilter,
    ticketSeverityFilter,
    ticketSlaFilter,
  ])

  useEffect(() => {
    refreshProjects()
  }, [authToken])

  useEffect(() => {
    refreshDepartments()
    refreshServices()
    refreshDashboardStats()
    refreshSlaGroups()
  }, [authToken])

  useEffect(() => {
    refreshSlaGroups()
  }, [authToken, ticketProjectFilter, ticketDepartmentFilter, ticketServiceFilter, ticketOwnerFilter, ticketStatus])

  useEffect(() => {
    refreshNotifications(notificationUnreadOnly)
  }, [authToken, notificationUnreadOnly])

  useEffect(() => {
    refreshTemplates()
  }, [authToken])

  useEffect(() => {
    refreshReportSummary()
  }, [
    authToken,
    ticketStatus,
    ticketProjectFilter,
    ticketOwnerFilter,
    ticketCreatedFrom,
    ticketCreatedTo,
    ticketTagsFilter,
    ticketDepartmentFilter,
    ticketServiceFilter,
  ])

  useEffect(() => {
    refreshUsers()
  }, [authToken])

  useEffect(() => {
    if (activeMenu !== 'permissions') return
    refreshProjectPermissions(permissionProjectId)
  }, [authToken, activeMenu, permissionProjectId])

  useEffect(() => {
    if (activeMenu !== 'permissions') return
    refreshProjectPermissionLogs(permissionProjectId)
  }, [
    authToken,
    activeMenu,
    permissionProjectId,
    permissionLogEventType,
    permissionLogOperator,
    permissionLogFrom,
    permissionLogTo,
  ])

  useEffect(() => {
    if (activeMenu !== 'calendar') return
    loadCalendarMonth()
  }, [authToken, activeMenu, calendarMonth])

  useEffect(() => {
    if (!activeTicket) return
    const latest = tickets.find((item) => item.id === activeTicket.id)
    if (latest) setActiveTicket(latest)
  }, [tickets, activeTicket])

  useEffect(() => {
    if (activeMenu === 'permissions' && currentUser?.role !== 'admin') {
      setActiveMenu('tickets')
    }
  }, [activeMenu, currentUser])

  useEffect(() => {
    if (!editingId) return
    loadActiveTicketEvents(editingId)
  }, [editingId, eventTypeFilter, eventOperatorFilter, eventFromFilter, eventToFilter])

  useEffect(() => {
    if (!editingId) return
    resetTicketEditorPosition()
  }, [editingId])

  useEffect(() => {
    const onMouseMove = (event) => {
      if (!ticketEditorDrag.current.dragging) return
      const modal = ticketEditorRef.current
      const width = modal?.offsetWidth || 980
      const height = modal?.offsetHeight || 680
      const nextX = event.clientX - ticketEditorDrag.current.offsetX
      const nextY = event.clientY - ticketEditorDrag.current.offsetY
      const minX = 8
      const minY = 8
      const maxX = Math.max(minX, (window.innerWidth || 1366) - width - 8)
      const maxY = Math.max(minY, (window.innerHeight || 900) - height - 8)
      setTicketEditorPos({
        x: Math.max(minX, Math.min(nextX, maxX)),
        y: Math.max(minY, Math.min(nextY, maxY)),
      })
    }
    const onMouseUp = () => {
      if (!ticketEditorDrag.current.dragging) return
      ticketEditorDrag.current.dragging = false
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = ''
    }
  }, [])

  const onLogout = () => {
    setLogoutPending(true)
    setAuthToken('')
    setCurrentUser(null)
  }

  const onSwitchSystem = () => {
    if (!authToken) {
      window.location.href = buildPortalEntryUrl('ticketing')
      return
    }
    window.location.href = buildPortalSwitchUrl('ticketing')
  }

  const onTicketSubmit = async (e) => {
    e.preventDefault()
    try {
      if (!ticketForm.title) return showError('标题不能为空')
      if (editingId) {
        const updated = await api.put(`/api/tickets/${editingId}`, ticketForm)
        setActiveTicket(updated || null)
        showMessage('工单已更新')
      } else {
        await api.post('/api/tickets', ticketForm)
        showMessage('工单已创建')
      }
      setTicketForm({ ...emptyTicketForm })
      setEditingId(null)
      setActiveTicket(null)
      setTicketStages([])
      setTicketEvents([])
      setTicketAttachments([])
      refreshTickets()
      refreshDashboardStats()
      refreshSlaGroups()
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onEditTicket = (ticket) => {
    setActiveTicket(ticket)
    setEditingId(ticket.id)
    setTicketForm({
      title: ticket.title || '',
      description: ticket.description || '',
      priority: ticket.priority || 'P2',
      status: ticket.status || 'OPEN',
      owner_id: ticket.owner_id || '',
      project_id: ticket.project_id || '',
      department_code: ticket.department_code || '',
      service_code: ticket.service_code || '',
      severity: ticket.severity || 'MEDIUM',
      customer_name: ticket.customer_name || '',
      requester_name: ticket.requester_name || '',
      requester_phone: ticket.requester_phone || '',
      requester_email: ticket.requester_email || '',
      sla_response_minutes: ticket.sla_response_minutes || 30,
      sla_resolve_minutes: ticket.sla_resolve_minutes || 480,
    })
    refreshTicketStages(ticket.id)
    refreshTicketAssignees(ticket.id)
    refreshTicketWatchers(ticket.id)
    refreshTicketComments(ticket.id)
    refreshTicketAttachments(ticket.id)
    loadActiveTicketEvents(ticket.id)
    setApprovalComment(ticket.approval_comment || '')
  }

  const onDeleteTicket = async (ticket) => {
    if (!confirm(`确认删除工单「${ticket.title}」？`)) return
    try {
      await api.del(`/api/tickets/${ticket.id}`)
      showMessage('工单已删除')
      refreshTickets()
      refreshDashboardStats()
      refreshSlaGroups()
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onResetForm = () => {
    setEditingId(null)
    setActiveTicket(null)
    setTicketForm({ ...emptyTicketForm })
    setTicketStages([])
    setTicketEvents([])
    setSelectedTemplateId('')
    setTicketAssignees([])
    setSelectedAssignees([])
    setTicketWatchers([])
    setSelectedWatchers([])
    setTicketComments([])
    setTicketAttachments([])
    setNewComment('')
    setApprovalComment('')
  }

  const onSaveAssignees = async () => {
    if (!editingId) return showError('请先选择工单')
    try {
      const result = await api.put(`/api/tickets/${editingId}/assignees`, {
        user_ids: selectedAssignees,
      })
      setTicketAssignees(result || [])
      showMessage('已更新指派人员')
      loadActiveTicketEvents(editingId)
      refreshNotifications(notificationUnreadOnly)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onSaveWatchers = async () => {
    if (!editingId) return showError('请先选择工单')
    try {
      const result = await api.put(`/api/tickets/${editingId}/watchers`, {
        user_ids: selectedWatchers,
      })
      setTicketWatchers(result || [])
      showMessage('已更新观察者')
      loadActiveTicketEvents(editingId)
      refreshNotifications(notificationUnreadOnly)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onAddComment = async () => {
    if (!editingId) return showError('请先选择工单')
    if (!newComment.trim()) return showError('评论内容不能为空')
    try {
      await api.post(`/api/tickets/${editingId}/comments`, { content: newComment })
      setNewComment('')
      showMessage('评论已发布')
      refreshTicketComments(editingId)
      loadActiveTicketEvents(editingId)
      refreshNotifications(notificationUnreadOnly)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onUploadAttachment = async (file) => {
    if (!editingId) return showError('请先选择工单')
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      return showError('附件大小不能超过10MB')
    }
    try {
      setAttachmentUploading(true)
      const formData = new FormData()
      formData.append('attachment', file)
      await api.postForm(`/api/tickets/${editingId}/attachments`, formData)
      showMessage('附件上传成功')
      refreshTicketAttachments(editingId)
      loadActiveTicketEvents(editingId)
    } catch (err) {
      showError(normalizeApiError(err))
    } finally {
      setAttachmentUploading(false)
    }
  }

  const onViewAttachment = async (attachment) => {
    if (!editingId || !attachment?.id) return
    try {
      const res = await fetch(`/api/tickets/${editingId}/attachments/${attachment.id}/content`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const filename = attachment.filename || `attachment-${attachment.id}`
      const mimeType = String(attachment.mime_type || '').toLowerCase()
      const previewable = mimeType.startsWith('image/') || mimeType === 'application/pdf' || mimeType.startsWith('text/')
      if (previewable) {
        const win = window.open(url, '_blank', 'noopener,noreferrer')
        if (!win) {
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onDeleteAttachment = async (attachment) => {
    if (!editingId || !attachment?.id) return
    if (!window.confirm(`确认删除附件「${attachment.filename || attachment.id}」？`)) return
    try {
      await api.del(`/api/tickets/${editingId}/attachments/${attachment.id}`)
      showMessage('附件已删除')
      refreshTicketAttachments(editingId)
      loadActiveTicketEvents(editingId)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onApproveTicket = async (decision) => {
    if (!editingId) return showError('请先选择工单')
    if (!activeTicket || Number(activeTicket.approval_required) !== 1) {
      return showError('当前工单无需审批')
    }
    try {
      const updated = await api.post(`/api/tickets/${editingId}/approval`, {
        decision,
        comment: approvalComment,
      })
      setActiveTicket(updated || null)
      setTicketForm((prev) => ({ ...prev, status: updated?.status || prev.status }))
      setApprovalComment('')
      showMessage(decision === 'APPROVE' ? '审批已通过' : '审批已驳回')
      refreshTickets()
      refreshSlaGroups()
      loadActiveTicketEvents(editingId)
      refreshNotifications(notificationUnreadOnly)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onMarkNotificationRead = async (id) => {
    try {
      await api.put(`/api/notifications/${id}/read`, {})
      refreshNotifications(notificationUnreadOnly)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onMarkAllNotificationsRead = async () => {
    try {
      await api.put('/api/notifications/read-all', {})
      refreshNotifications(notificationUnreadOnly)
      showMessage('已全部标记为已读')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onExportEventsCsv = async () => {
    if (!editingId) return showError('请先选择工单')
    try {
      const params = new URLSearchParams()
      if (eventTypeFilter) params.set('event_type', eventTypeFilter)
      if (eventOperatorFilter) params.set('operator', eventOperatorFilter)
      if (eventFromFilter) params.set('from', eventFromFilter)
      if (eventToFilter) params.set('to', eventToFilter)
      const res = await fetch(
        `/api/tickets/${editingId}/events/export${params.toString() ? `?${params.toString()}` : ''}`,
        {
          credentials: 'include',
        }
      )
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ticket-${editingId}-events.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showMessage('审计CSV已导出')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const getCalendarCells = () => {
    const year = calendarMonth.getFullYear()
    const month = calendarMonth.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
    const dayMap = new Map(calendarDays.map((item) => [item.day, item]))
    const cells = []
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null)
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(dayMap.get(day) || { day, items: [] })
    }
    return cells
  }

  const openCalendarDetail = (dayInfo) => {
    setCalendarDetail({ open: true, day: dayInfo.day, items: dayInfo.items || [] })
  }

  const onOpenTicketFromCalendar = async (ticketId) => {
    if (!ticketId) return
    try {
      const ticket = await api.get(`/api/tickets/${ticketId}`)
      setCalendarDetail({ open: false, day: null, items: [] })
      setActiveMenu('tickets')
      onEditTicket(ticket)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onStageStatusChange = async (stageId, status) => {
    if (!editingId) return
    try {
      await api.put(`/api/tickets/${editingId}/stages/${stageId}`, { status })
      refreshTicketStages(editingId)
      showMessage('阶段状态已更新')
      refreshTickets()
      loadActiveTicketEvents(editingId)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onDeliverableToggle = async (deliverableId, done) => {
    if (!editingId) return
    try {
      await api.put(`/api/tickets/${editingId}/deliverables/${deliverableId}`, { done })
      showMessage(done ? '交付物已标记完成' : '交付物已重置')
      refreshTicketStages(editingId)
      loadActiveTicketEvents(editingId)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onGenerateStages = async () => {
    if (!editingId) return showError('请先选择工单')
    if (!selectedTemplateId) return showError('请选择模板')
    if (!confirm('将用模板阶段覆盖当前工单阶段，确认继续？')) return
    try {
      const result = await api.post(`/api/tickets/${editingId}/stages/from-template`, {
        template_id: selectedTemplateId,
        mode: 'replace',
      })
      setTicketStages(result.stages || [])
      showMessage('已生成工单阶段')
      refreshTickets()
      loadActiveTicketEvents(editingId)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onProjectSubmit = async (e) => {
    e.preventDefault()
    try {
      if (!projectForm.name) return showError('项目名称不能为空')
      if (editingProjectId) {
        await api.put(`/api/projects/${editingProjectId}`, projectForm)
        showMessage('项目已更新')
      } else {
        await api.post('/api/projects', projectForm)
        showMessage('项目已创建')
      }
      setProjectForm({ name: '', description: '' })
      setEditingProjectId(null)
      refreshProjects()
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onEditProject = (project) => {
    setEditingProjectId(project.id)
    setProjectForm({ name: project.name || '', description: project.description || '' })
  }

  const onDeleteProject = async (project) => {
    if (!confirm(`确认删除项目「${project.name}」？`)) return
    try {
      await api.del(`/api/projects/${project.id}`)
      showMessage('项目已删除')
      refreshProjects()
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onResetProject = () => {
    setEditingProjectId(null)
    setProjectForm({ name: '', description: '' })
  }

  const onAddProjectPermissionMember = () => {
    const uid = Number(permissionUserId)
    if (!Number.isFinite(uid) || uid <= 0) return showError('请先选择成员')
    const exists = projectPermissions.some((item) => Number(item.user_id) === uid)
    if (exists) return showError('该成员已存在')
    const user = users.find((u) => Number(u.id) === uid)
    setProjectPermissions((prev) => [
      ...prev,
      {
        user_id: uid,
        username: user?.username || `用户#${uid}`,
        role: user?.role || '-',
        can_view: true,
        can_edit: false,
        can_assign: false,
        can_close: false,
      },
    ])
    setPermissionUserId('')
  }

  const onPermissionFlagChange = (userId, key, checked) => {
    setProjectPermissions((prev) =>
      prev.map((item) => {
        if (Number(item.user_id) !== Number(userId)) return item
        const next = { ...item, [key]: checked }
        if (key === 'can_close' && checked) {
          next.can_assign = true
          next.can_edit = true
          next.can_view = true
        }
        if (key === 'can_assign' && checked) {
          next.can_edit = true
          next.can_view = true
        }
        if (key === 'can_edit' && checked) {
          next.can_view = true
        }
        if (key === 'can_view' && !checked) {
          next.can_edit = false
          next.can_assign = false
          next.can_close = false
        }
        if (key === 'can_edit' && !checked) {
          next.can_assign = false
          next.can_close = false
        }
        if (key === 'can_assign' && !checked) {
          next.can_close = false
        }
        return next
      }),
    )
  }

  const onRemoveProjectPermissionMember = (userId) => {
    setProjectPermissions((prev) => prev.filter((item) => Number(item.user_id) !== Number(userId)))
  }

  const onSaveProjectPermissions = async () => {
    if (!permissionProjectId) return showError('请先选择项目')
    try {
      await api.put(`/api/projects/${permissionProjectId}/permissions`, {
        members: projectPermissions.map((item) => ({
          user_id: item.user_id,
          can_view: !!item.can_view,
          can_edit: !!item.can_edit,
          can_assign: !!item.can_assign,
          can_close: !!item.can_close,
        })),
      })
      showMessage('项目权限已保存')
      refreshProjectPermissions(permissionProjectId)
      refreshProjectPermissionLogs(permissionProjectId)
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onExportProjectPermissionLogs = async () => {
    if (!permissionProjectId) return showError('请先选择项目')
    try {
      const params = new URLSearchParams()
      if (permissionLogEventType) params.set('event_type', permissionLogEventType)
      if (permissionLogOperator) params.set('operator', permissionLogOperator)
      if (permissionLogFrom) params.set('from', permissionLogFrom)
      if (permissionLogTo) params.set('to', permissionLogTo)
      const res = await fetch(
        `/api/projects/${permissionProjectId}/permissions/logs/export${params.toString() ? `?${params.toString()}` : ''}`,
        {
          credentials: 'include',
        },
      )
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `project-${permissionProjectId}-permission-logs.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showMessage('权限审计CSV已导出')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const togglePermissionLogExpand = (logId) => {
    setExpandedPermissionLogs((prev) => ({
      ...prev,
      [logId]: !prev[logId],
    }))
  }

  const renderPermissionLogDetail = (log) => {
    const beforeRaw = parseJsonSafe(log.before_json, [])
    const afterRaw = parseJsonSafe(log.after_json, null)
    let diff = null
    if (afterRaw && !Array.isArray(afterRaw) && typeof afterRaw === 'object' && afterRaw.diff) {
      diff = {
        added: Array.isArray(afterRaw.diff.added) ? afterRaw.diff.added : [],
        removed: Array.isArray(afterRaw.diff.removed) ? afterRaw.diff.removed : [],
        changed: Array.isArray(afterRaw.diff.changed) ? afterRaw.diff.changed : [],
      }
    } else {
      diff = buildPermissionDiffFromMembers(beforeRaw, Array.isArray(afterRaw) ? afterRaw : [])
    }
    const hasDiff = (diff.added?.length || 0) + (diff.removed?.length || 0) + (diff.changed?.length || 0) > 0
    if (!hasDiff) {
      return <div className="muted">该条日志没有可展示的权限差异明细。</div>
    }
    return (
      <div className="permission-diff-grid">
        <div className="permission-diff-card">
          <div className="permission-diff-title">新增成员</div>
          {(diff.added || []).length === 0 ? (
            <div className="muted">无</div>
          ) : (
            (diff.added || []).map((item) => (
              <div key={`add-${log.id}-${item.user_id}`}>
                {item.username}
              </div>
            ))
          )}
        </div>
        <div className="permission-diff-card">
          <div className="permission-diff-title">移除成员</div>
          {(diff.removed || []).length === 0 ? (
            <div className="muted">无</div>
          ) : (
            (diff.removed || []).map((item) => (
              <div key={`remove-${log.id}-${item.user_id}`}>
                {item.username}
              </div>
            ))
          )}
        </div>
        <div className="permission-diff-card full">
          <div className="permission-diff-title">权限变化</div>
          {(diff.changed || []).length === 0 ? (
            <div className="muted">无</div>
          ) : (
            (diff.changed || []).map((item) => (
              <div key={`changed-${log.id}-${item.user_id}`}>
                {item.username}：
                {(item.changes || [])
                  .map((c) => `${permissionKeyToLabel(c.key)} ${c.before ? '是' : '否'} → ${c.after ? '是' : '否'}`)
                  .join('，')}
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  const loadGantt = async () => {
    if (!ganttProjectId) return showError('请选择项目')
    try {
      const data = await api.get(`/api/projects/${ganttProjectId}/gantt`)
      setGanttData(data)
      showMessage('已加载甘特数据')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  useEffect(() => {
    if (!ganttData || !ganttRef.current) return
    if (!ganttChart.current) {
      ganttChart.current = echarts.init(ganttRef.current)
    }
    const categories = ganttData.tasks.map((task) => task.name)
    const seriesData = ganttData.tasks.map((task, index) => {
      const start = new Date(task.start).getTime()
      const end = new Date(task.end).getTime()
      return {
        value: [index, start, end, task.name],
        name: task.name,
        itemStyle: {
          color: task.custom_class === 'ticket' ? '#2563eb' : '#22c55e',
          borderColor: task.custom_class === 'ticket' ? '#1d4ed8' : '#16a34a',
          borderWidth: 1,
        },
      }
    })
    const option = {
      tooltip: {
        formatter: (params) => {
          const start = new Date(params.value[1])
          const end = new Date(params.value[2])
          return `${params.name}<br/>${start.toLocaleString()} - ${end.toLocaleString()}`
        },
      },
      legend: {
        top: 8,
        left: 0,
        data: ['工单', '排期'],
      },
      grid: { left: 180, right: 30, top: 40, bottom: 30 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#cbd5f5' } },
        axisLabel: { color: '#475569' },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: { interval: 0, color: '#334155' },
      },
      series: [
        {
          type: 'custom',
          name: '工单',
          renderItem: (params, api) => {
            const categoryIndex = api.value(0)
            const start = api.coord([api.value(1), categoryIndex])
            const end = api.coord([api.value(2), categoryIndex])
            const height = api.size([0, 1])[1] * 0.6
            return {
              type: 'rect',
              shape: echarts.graphic.clipRectByRect(
                {
                  x: start[0],
                  y: start[1] - height / 2,
                  width: end[0] - start[0],
                  height,
                },
                {
                  x: params.coordSys.x,
                  y: params.coordSys.y,
                  width: params.coordSys.width,
                  height: params.coordSys.height,
                }
              ),
              style: api.style(),
            }
          },
          encode: {
            x: [1, 2],
            y: 0,
          },
          data: seriesData,
        },
      ],
    }
    ganttChart.current.setOption(option)
    const handleResize = () => ganttChart.current && ganttChart.current.resize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [ganttData])

  const pageData = paginate(tickets, ticketPage)
  const statusSelectOptions = useMemo(() => {
    const base = statusOptions.filter((option) => option.value)
    if (!editingId) return base.filter((option) => option.value === 'OPEN')
    if (!activeTicket?.status) return base
    const current = String(activeTicket.status || '').toUpperCase()
    const allowed = new Set([current, ...(statusTransitionMap[current] || [])])
    return base.filter((option) => allowed.has(option.value))
  }, [editingId, activeTicket])
  const serviceFilterOptions = ticketDepartmentFilter
    ? services.filter((item) => item.department_code === ticketDepartmentFilter)
    : services
  const serviceFormOptions = ticketForm.department_code
    ? services.filter((item) => item.department_code === ticketForm.department_code)
    : services
  const projectNameMap = new Map(projects.map((item) => [String(item.id), item.name]))
  const departmentNameMap = new Map(departments.map((item) => [item.code, item.name]))
  const serviceNameMap = new Map(services.map((item) => [item.code, item.name]))

  if (!authToken) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1 className="brand-title"><span className="brand-red">聚信</span><span className="brand-blue">工单管理系统</span></h1>
            <p className="sub">正在跳转到统一登录页，请稍候。</p>
          </div>
          <button
            type="button"
            className="primary btn btn-primary"
            onClick={() => {
              window.location.href = buildPortalEntryUrl('ticketing')
            }}
          >
            前往统一登录
          </button>
        </div>
      </div>
    )
  }

  const menuItems = [
    { key: 'tickets', label: '工单管理', desc: '创建、分配与跟踪工单处理进度。' },
    { key: 'projects', label: '项目管理', desc: '管理项目并关联工单。' },
    ...(currentUser?.role === 'admin'
      ? [{ key: 'permissions', label: '项目权限', desc: '配置项目成员的可见/编辑/分派/关闭权限。' }]
      : []),
    { key: 'templates', label: '模板管理', desc: '配置工单模板并快速生成阶段。' },
    { key: 'notifications', label: '通知中心', desc: '查看协作通知、评论@与审批提醒。' },
    { key: 'gantt', label: '甘特图', desc: '查看项目排期甘特图。' },
    { key: 'calendar', label: '工单日历', desc: '按月查看每天的工程师排期。' },
  ]
  const activeMenuMeta = menuItems.find((item) => item.key === activeMenu) || menuItems[0]
  const calendarMonthLabel = `${calendarMonth.getFullYear()}年${calendarMonth.getMonth() + 1}月`
  const calendarCells = getCalendarCells()
  const canManageAttachments = currentUser?.role !== 'auditor' && currentUser?.role !== 'sysadmin'

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>聚信工单管理系统</strong>
        </div>
        <div className="user-pill">{currentUser?.username || '当前用户'}</div>
        <div className="menu">
          {menuItems.map((item) => (
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
          <button className="ghost btn btn-outline-secondary" onClick={onSwitchSystem}>切换系统</button>
          <button className="ghost btn btn-outline-secondary logout" onClick={onLogout}>退出登录</button>
        </div>
      </aside>
      <main className="content">
        <section className="page-title">
          <div>
            <h1>{activeMenuMeta.label}</h1>
            <p>{activeMenuMeta.desc}</p>
          </div>
        </section>

        {activeMenu === 'tickets' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>部门看板</h2>
              <p>按部门查看总工单、在途、已关闭与超时数。</p>
            </div>
          </div>
          <div className="kpi-grid">
            {dashboardStats.length === 0 ? (
              <div className="muted">暂无看板数据</div>
            ) : (
              dashboardStats.map((item) => (
                <div key={item.code} className="kpi-card">
                  <div className="kpi-title">{item.name}</div>
                  <div className="kpi-main">{Number(item.total_count || 0)}</div>
                  <div className="kpi-meta">
                    <span>在途 {Number(item.open_count || 0)}</span>
                    <span>关闭 {Number(item.closed_count || 0)}</span>
                    <span>即将超时 {Number(item.near_due_count || 0)}</span>
                    <span className="danger">超时 {Number(item.breached_count || 0)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
        )}

        {activeMenu === 'tickets' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>SLA 看板</h2>
              <p>按“即将超时/已超时”分组，优先处理高风险工单。</p>
            </div>
            <div className="panel-actions">
              <button type="button" className="ghost btn btn-outline-secondary" onClick={refreshSlaGroups}>
                刷新看板
              </button>
            </div>
          </div>
          <div className="sla-grid">
            <div className="sla-group-card near">
              <h3>即将超时（24小时内）</h3>
              <div className="table compact-table">
                <div className="table-row head">
                  <span>工单</span>
                  <span>负责人</span>
                  <span>状态</span>
                  <span>解决时限</span>
                </div>
                {(slaGroups.near_due || []).length === 0 ? (
                  <div className="table-row">
                    <span className="muted">暂无即将超时工单</span>
                  </div>
                ) : (
                  (slaGroups.near_due || []).slice(0, 12).map((ticket) => (
                    <div key={`near-${ticket.id}`} className="table-row">
                      <span>{ticket.title}</span>
                      <span>{ticket.owner_name || '-'}</span>
                      <span>{getStatusLabel(ticket.status)}</span>
                      <span>{formatDateTime(ticket.resolve_deadline)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="sla-group-card breached">
              <h3>已超时</h3>
              <div className="table compact-table">
                <div className="table-row head">
                  <span>工单</span>
                  <span>负责人</span>
                  <span>状态</span>
                  <span>解决时限</span>
                </div>
                {(slaGroups.breached || []).length === 0 ? (
                  <div className="table-row">
                    <span className="muted">暂无超时工单</span>
                  </div>
                ) : (
                  (slaGroups.breached || []).slice(0, 12).map((ticket) => (
                    <div key={`breached-${ticket.id}`} className="table-row">
                      <span>{ticket.title}</span>
                      <span>{ticket.owner_name || '-'}</span>
                      <span>{getStatusLabel(ticket.status)}</span>
                      <span>{formatDateTime(ticket.resolve_deadline)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
        )}

        {activeMenu === 'tickets' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>统计报表</h2>
              <p>吞吐、平均解决时长、按人负载、SLA达成率。</p>
            </div>
            <div className="panel-actions">
              <button type="button" className="ghost btn btn-outline-secondary" onClick={refreshReportSummary}>
                刷新报表
              </button>
            </div>
          </div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-title">工单吞吐</div>
              <div className="kpi-main">{Number(reportSummary?.throughput?.created || 0)}</div>
              <div className="kpi-meta">
                <span>创建 {Number(reportSummary?.throughput?.created || 0)}</span>
                <span>关闭 {Number(reportSummary?.throughput?.closed || 0)}</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title">平均解决时长</div>
              <div className="kpi-main">{Number(reportSummary?.avg_resolve_hours || 0)}h</div>
              <div className="kpi-meta">
                <span>按已完成工单计算</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title">SLA达成率</div>
              <div className="kpi-main">{Number(reportSummary?.sla?.rate || 0)}%</div>
              <div className="kpi-meta">
                <span>按时 {Number(reportSummary?.sla?.on_time_count || 0)}</span>
                <span>总计 {Number(reportSummary?.sla?.total_count || 0)}</span>
              </div>
            </div>
          </div>
          <div className="table compact-table">
            <div className="table-row head">
              <span>负责人</span>
              <span>在途工单</span>
            </div>
            {(reportSummary?.load_by_owner || []).length === 0 ? (
              <div className="table-row">
                <span className="muted">暂无负载数据</span>
              </div>
            ) : (
              (reportSummary?.load_by_owner || []).map((item) => (
                <div key={`load-${item.owner_id}`} className="table-row">
                  <span>{item.owner_name || '-'}</span>
                  <span>{Number(item.open_count || 0)}</span>
                </div>
              ))
            )}
          </div>
        </section>
        )}

        {activeMenu === 'tickets' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>筛选</h2>
              <p>按状态或关键词快速定位工单。</p>
            </div>
          </div>
          <div className="filter-row">
            <input
              placeholder="搜索标题/描述/客户/请求人"
              value={ticketSearch}
              onChange={(e) => {
                setTicketSearch(e.target.value)
                setTicketPage(1)
              }}
            />
            <select
              value={ticketProjectFilter}
              onChange={(e) => {
                setTicketProjectFilter(e.target.value)
                setTicketPage(1)
              }}
            >
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
                ))}
            </select>
            <select
              value={ticketOwnerFilter}
              onChange={(e) => {
                setTicketOwnerFilter(e.target.value)
                setTicketPage(1)
              }}
            >
              <option value="">全部负责人</option>
              {users.map((user) => (
                <option key={`owner-filter-${user.id}`} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
            <select
              value={ticketDepartmentFilter}
              onChange={(e) => {
                setTicketDepartmentFilter(e.target.value)
                setTicketServiceFilter('')
                setTicketPage(1)
              }}
            >
              <option value="">全部部门</option>
              {departments.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={ticketServiceFilter}
              onChange={(e) => {
                setTicketServiceFilter(e.target.value)
                setTicketPage(1)
              }}
            >
              <option value="">全部服务</option>
              {serviceFilterOptions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={ticketSeverityFilter}
              onChange={(e) => {
                setTicketSeverityFilter(e.target.value)
                setTicketPage(1)
              }}
            >
              {severityOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={ticketSlaFilter}
              onChange={(e) => {
                setTicketSlaFilter(e.target.value)
                setTicketPage(1)
              }}
            >
              {slaStatusOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={ticketStatus}
              onChange={(e) => {
                setTicketStatus(e.target.value)
                setTicketPage(1)
              }}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={ticketCreatedFrom}
              onChange={(e) => {
                setTicketCreatedFrom(e.target.value)
                setTicketPage(1)
              }}
              title="创建开始日期"
            />
            <input
              type="date"
              value={ticketCreatedTo}
              onChange={(e) => {
                setTicketCreatedTo(e.target.value)
                setTicketPage(1)
              }}
              title="创建结束日期"
            />
            <input
              placeholder="标签（逗号分隔）"
              value={ticketTagsFilter}
              onChange={(e) => {
                setTicketTagsFilter(e.target.value)
                setTicketPage(1)
              }}
            />
            <button
              type="button"
              className="ghost btn btn-outline-secondary"
              onClick={() => {
                setTicketSearch('')
                setTicketStatus('')
                setTicketProjectFilter('')
                setTicketOwnerFilter('')
                setTicketCreatedFrom('')
                setTicketCreatedTo('')
                setTicketTagsFilter('')
                setTicketDepartmentFilter('')
                setTicketServiceFilter('')
                setTicketSeverityFilter('')
                setTicketSlaFilter('')
                setTicketPage(1)
              }}
            >
              清空筛选
            </button>
          </div>
        </section>
        )}

        {activeMenu === 'tickets' && editingId && (
          <div className="ticket-editor-mask" onClick={onResetForm} />
        )}

        {activeMenu === 'tickets' && (
        <section
          ref={ticketEditorRef}
          className={`panel ${editingId ? 'ticket-editor-modal' : ''}`}
          style={editingId ? { left: `${ticketEditorPos.x}px`, top: `${ticketEditorPos.y}px` } : undefined}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div
            className={`panel-header ${editingId ? 'ticket-editor-header' : ''}`}
            onMouseDown={editingId ? onTicketEditorDragStart : undefined}
          >
            <div>
              <h2>{editingId ? '编辑工单' : '新建工单'}</h2>
              <p>{editingId ? '可拖动弹窗，修改后保存。' : '填写基本信息后提交。'}</p>
            </div>
            {editingId && (
              <div className="ticket-editor-tools" onMouseDown={(event) => event.stopPropagation()}>
                <span className="muted">按住标题栏可拖动</span>
                <button type="button" className="ghost btn btn-outline-secondary" onClick={onResetForm}>
                  关闭
                </button>
              </div>
            )}
          </div>
          <form className="form-grid inline-actions" onSubmit={onTicketSubmit}>
            <label>
              标题
              <input
                placeholder="请输入工单标题"
                value={ticketForm.title}
                onChange={(e) => setTicketForm({ ...ticketForm, title: e.target.value })}
              />
            </label>
            <label>
              主负责人
              <select
                value={ticketForm.owner_id || ''}
                onChange={(e) => setTicketForm({ ...ticketForm, owner_id: e.target.value })}
              >
                <option value="">默认当前登录人</option>
                {users.map((user) => (
                  <option key={`owner-${user.id}`} value={user.id}>
                    {user.username} ({user.role})
                  </option>
                ))}
              </select>
            </label>
            <label>
              部门
              <select
                value={ticketForm.department_code || ''}
                onChange={(e) =>
                  setTicketForm({
                    ...ticketForm,
                    department_code: e.target.value,
                    service_code: '',
                  })
                }
              >
                <option value="">请选择部门</option>
                {departments.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              服务目录
              <select
                value={ticketForm.service_code || ''}
                onChange={(e) => {
                  const service = services.find((item) => item.code === e.target.value)
                  setTicketForm({
                    ...ticketForm,
                    service_code: e.target.value,
                    department_code: service?.department_code || ticketForm.department_code,
                    priority: service?.default_priority || ticketForm.priority,
                    sla_response_minutes: service?.default_response_minutes || ticketForm.sla_response_minutes,
                    sla_resolve_minutes: service?.default_resolve_minutes || ticketForm.sla_resolve_minutes,
                  })
                }}
              >
                <option value="">请选择服务</option>
                {serviceFormOptions.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              项目
              <select
                value={ticketForm.project_id || ''}
                onChange={(e) => setTicketForm({ ...ticketForm, project_id: e.target.value })}
              >
                <option value="">未关联</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              优先级
              <select
                value={ticketForm.priority}
                onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
              >
                {priorities.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              严重级别
              <select
                value={ticketForm.severity || 'MEDIUM'}
                onChange={(e) => setTicketForm({ ...ticketForm, severity: e.target.value })}
              >
                {severityOptions.filter((option) => option.value).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select
                value={ticketForm.status}
                onChange={(e) => setTicketForm({ ...ticketForm, status: e.target.value })}
              >
                {statusSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              响应SLA(分钟)
              <input
                type="number"
                min="1"
                value={ticketForm.sla_response_minutes}
                onChange={(e) => setTicketForm({ ...ticketForm, sla_response_minutes: e.target.value })}
              />
            </label>
            <label>
              解决SLA(分钟)
              <input
                type="number"
                min="1"
                value={ticketForm.sla_resolve_minutes}
                onChange={(e) => setTicketForm({ ...ticketForm, sla_resolve_minutes: e.target.value })}
              />
            </label>
            <label>
              客户名称
              <input
                placeholder="例如：张家口某单位"
                value={ticketForm.customer_name || ''}
                onChange={(e) => setTicketForm({ ...ticketForm, customer_name: e.target.value })}
              />
            </label>
            <label>
              请求人
              <input
                placeholder="联系人姓名"
                value={ticketForm.requester_name || ''}
                onChange={(e) => setTicketForm({ ...ticketForm, requester_name: e.target.value })}
              />
            </label>
            <label>
              请求人电话
              <input
                placeholder="手机号"
                value={ticketForm.requester_phone || ''}
                onChange={(e) => setTicketForm({ ...ticketForm, requester_phone: e.target.value })}
              />
            </label>
            <label>
              请求人邮箱
              <input
                placeholder="邮箱"
                value={ticketForm.requester_email || ''}
                onChange={(e) => setTicketForm({ ...ticketForm, requester_email: e.target.value })}
              />
            </label>
            <label className="full-row">
              描述
              <textarea
                rows={3}
                placeholder="描述问题或需求"
                value={ticketForm.description}
                onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="primary btn btn-primary">
                {editingId ? '保存修改' : '创建工单'}
              </button>
              {editingId && (
                <button type="button" className="ghost btn btn-outline-secondary" onClick={onResetForm}>
                  取消编辑
                </button>
              )}
            </div>
          </form>
          <div className="form-grid inline-actions">
            <label>
              工单模板
              <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                <option value="">请选择模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="primary btn btn-primary" onClick={onGenerateStages}>
                从模板生成阶段
              </button>
            </div>
          </div>
          <div className="form-grid inline-actions">
            <label>
              协作人（多选）
              <select
                multiple
                value={selectedAssignees}
                onChange={(e) =>
                  setSelectedAssignees(Array.from(e.target.selectedOptions).map((item) => item.value))
                }
                style={{ minHeight: 120 }}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username} ({user.role})
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="primary btn btn-primary" onClick={onSaveAssignees}>
                保存指派
              </button>
            </div>
          </div>
          <div className="form-grid inline-actions">
            <label>
              观察者（多选）
              <select
                multiple
                value={selectedWatchers}
                onChange={(e) =>
                  setSelectedWatchers(Array.from(e.target.selectedOptions).map((item) => item.value))
                }
                style={{ minHeight: 120 }}
              >
                {users.map((user) => (
                  <option key={`watcher-${user.id}`} value={user.id}>
                    {user.username} ({user.role})
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="primary btn btn-primary" onClick={onSaveWatchers}>
                保存观察者
              </button>
            </div>
          </div>
          {editingId && activeTicket && Number(activeTicket.approval_required) === 1 && (
            <div className="approval-block">
              <div className="approval-head">
                <strong>高风险工单审批</strong>
                <span className={`approval-badge status-${String(activeTicket.approval_status || '').toLowerCase()}`}>
                  {getApprovalStatusLabel(activeTicket.approval_status)}
                </span>
              </div>
              <div className="approval-meta">
                <span>审批人：{activeTicket.approval_by ? `用户#${activeTicket.approval_by}` : '-'}</span>
                <span>审批时间：{formatDateTime(activeTicket.approval_at)}</span>
              </div>
              <label className="full-row">
                审批意见
                <input
                  value={approvalComment}
                  onChange={(e) => setApprovalComment(e.target.value)}
                  placeholder="请输入审批意见（选填）"
                />
              </label>
              <div className="form-actions">
                <button type="button" className="primary btn btn-primary" onClick={() => onApproveTicket('APPROVE')}>
                  审批通过
                </button>
                <button type="button" className="ghost btn btn-outline-danger" onClick={() => onApproveTicket('REJECT')}>
                  审批驳回
                </button>
              </div>
            </div>
          )}
          {ticketStages.length > 0 && (
            <div className="table">
              <div className="table-row head">
                <span>阶段</span>
                <span>预计工期(天)</span>
                <span>交付物进度</span>
                <span>交付物清单</span>
                <span>状态</span>
              </div>
              {ticketStages.map((stage) => (
                <div key={stage.id} className="table-row">
                  <span>{stage.name}</span>
                  <span>{stage.duration_days}</span>
                  <span>
                    {stage.deliverable_done || 0}/{stage.deliverable_total || 0}
                    <div className="muted">{stage.deliverable_progress || 0}%</div>
                  </span>
                  <span>
                    {(stage.deliverables || []).length === 0 ? (
                      <span className="muted">无</span>
                    ) : (
                      <div className="deliverable-list">
                        {(stage.deliverables || []).map((item) => (
                          <label key={item.id} className="deliverable-item">
                            <input
                              type="checkbox"
                              checked={Number(item.done_flag) === 1}
                              onChange={(e) => onDeliverableToggle(item.id, e.target.checked)}
                            />
                            <span>{item.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </span>
                  <span>
                    <select
                      className={`stage-status ${String(stage.status || '').toLowerCase()}`}
                      value={stage.status}
                      onChange={(e) => onStageStatusChange(stage.id, e.target.value)}
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="DONE">DONE</option>
                    </select>
                  </span>
                </div>
              ))}
            </div>
          )}
          {editingId && activeTicket && (
            <>
              <div className="attachment-box">
                <div className="attachment-header">
                  <h3>附件</h3>
                  {canManageAttachments && (
                    <label className="upload-btn ghost btn btn-outline-secondary">
                      {attachmentUploading ? '上传中...' : '上传附件'}
                      <input
                        type="file"
                        disabled={attachmentUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          onUploadAttachment(file)
                        }}
                      />
                    </label>
                  )}
                </div>
                <div className="table compact-table attachment-table">
                  <div className="table-row head">
                    <span>文件名</span>
                    <span>大小</span>
                    <span>上传人</span>
                    <span>上传时间</span>
                    <span>操作</span>
                  </div>
                  {ticketAttachments.length === 0 ? (
                    <div className="table-row">
                      <span className="muted">暂无附件</span>
                    </div>
                  ) : (
                    ticketAttachments.map((attachment) => (
                      <div key={`attachment-${attachment.id}`} className="table-row">
                        <span>{attachment.filename}</span>
                        <span>{formatFileSize(attachment.size_bytes)}</span>
                        <span>{attachment.created_name || '-'}</span>
                        <span>{formatDateTime(attachment.created_at)}</span>
                        <span className="actions">
                          <button
                            type="button"
                            className="ghost btn btn-outline-secondary"
                            onClick={() => onViewAttachment(attachment)}
                          >
                            查看附件
                          </button>
                          {canManageAttachments && (
                            <button
                              type="button"
                              className="btn btn-outline-danger"
                              onClick={() => onDeleteAttachment(attachment)}
                            >
                              删除附件
                            </button>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="comment-box">
                <h3>评论</h3>
                <p className="muted">支持 @用户名，系统会记录被@人员。</p>
                <textarea
                  rows={3}
                  placeholder="输入评论内容，例如：@张雷 请确认复测时间"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                />
                <div className="form-actions">
                  <button type="button" className="primary btn btn-primary" onClick={onAddComment}>
                    发表评论
                  </button>
                </div>
                <div className="table compact-table">
                  <div className="table-row head">
                    <span>时间</span>
                    <span>评论内容</span>
                    <span>评论人</span>
                  </div>
                  {ticketComments.length === 0 ? (
                    <div className="table-row">
                      <span className="muted">暂无评论</span>
                    </div>
                  ) : (
                    ticketComments.map((comment) => (
                      <div key={`comment-${comment.id}`} className="table-row">
                        <span>{formatDateTime(comment.created_at)}</span>
                        <span>
                          {comment.content}
                          {(comment.mentions || []).length > 0 && (
                            <div className="muted">
                              @通知：{comment.mentions.map((item) => item.username).join('，')}
                            </div>
                          )}
                        </span>
                        <span>{comment.created_name || '-'}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="filter-row">
                <input
                  placeholder="事件类型（如 UPDATED）"
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                />
                <input
                  placeholder="操作人"
                  value={eventOperatorFilter}
                  onChange={(e) => setEventOperatorFilter(e.target.value)}
                />
                <input type="date" value={eventFromFilter} onChange={(e) => setEventFromFilter(e.target.value)} />
                <input type="date" value={eventToFilter} onChange={(e) => setEventToFilter(e.target.value)} />
                <button type="button" className="ghost btn btn-outline-secondary" onClick={onExportEventsCsv}>
                  导出审计CSV
                </button>
              </div>
              <div className="table compact-table">
                <div className="table-row head">
                  <span>时间</span>
                  <span>事件</span>
                  <span>操作人</span>
                </div>
                {ticketEvents.length === 0 ? (
                  <div className="table-row">
                    <span className="muted">暂无操作事件</span>
                  </div>
                ) : (
                  ticketEvents.map((event) => (
                    <div key={event.id} className="table-row">
                      <span>{formatDateTime(event.created_at)}</span>
                      <span>
                        {event.event_desc}
                        <div className="muted">{getTicketEventLabel(event.event_type)}</div>
                      </span>
                      <span>{event.operator_name || '-'}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
        )}

        {activeMenu === 'projects' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>项目管理</h2>
              <p>创建项目用于甘特图归档。</p>
            </div>
          </div>
          <form className="form-grid inline-actions" onSubmit={onProjectSubmit}>
            <label>
              项目名称
              <input
                placeholder="请输入项目名称"
                value={projectForm.name}
                onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
              />
            </label>
            <label>
              项目描述
              <input
                placeholder="选填"
                value={projectForm.description}
                onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="primary btn btn-primary">
                {editingProjectId ? '保存项目' : '新增项目'}
              </button>
              {editingProjectId && (
                <button type="button" className="ghost btn btn-outline-secondary" onClick={onResetProject}>
                  取消编辑
                </button>
              )}
            </div>
          </form>
          <div className="table">
            <div className="table-row head">
              <span>项目名称</span>
              <span>描述</span>
              <span>创建时间</span>
              <span>操作</span>
            </div>
            {projects.length === 0 ? (
              <div className="table-row">
                <span className="muted">暂无项目</span>
              </div>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="table-row">
                  <span>{project.name}</span>
                  <span>{project.description || '-'}</span>
                  <span>{formatDateTime(project.created_at)}</span>
                  <span className="actions">
                    <button className="btn btn-outline-secondary" onClick={() => onEditProject(project)}>
                      编辑
                    </button>
                    <button className="btn btn-outline-danger" onClick={() => onDeleteProject(project)}>
                      删除
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
        )}

        {activeMenu === 'permissions' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>项目级权限矩阵</h2>
              <p>按项目配置成员权限：可见、可编辑、可分派、可关闭。</p>
            </div>
          </div>
          <div className="form-grid inline-actions">
            <label>
              选择项目
              <select
                value={permissionProjectId}
                onChange={(e) => {
                  setPermissionProjectId(e.target.value)
                  setProjectPermissions([])
                  setPermissionLogs([])
                }}
              >
                <option value="">请选择项目</option>
                {projects.map((project) => (
                  <option key={`perm-project-${project.id}`} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              添加成员
              <select
                value={permissionUserId}
                onChange={(e) => setPermissionUserId(e.target.value)}
              >
                <option value="">请选择用户</option>
                {users.map((user) => (
                  <option key={`perm-user-${user.id}`} value={user.id}>
                    {user.username} ({user.role})
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="ghost btn btn-outline-secondary" onClick={onAddProjectPermissionMember}>
                添加成员
              </button>
              <button type="button" className="primary btn btn-primary" onClick={onSaveProjectPermissions}>
                保存权限
              </button>
            </div>
          </div>
          <div className="table permissions-table">
            <div className="table-row head">
              <span>成员</span>
              <span>角色</span>
              <span>可见</span>
              <span>可编辑</span>
              <span>可分派</span>
              <span>可关闭</span>
              <span>操作</span>
            </div>
            {projectPermissions.length === 0 ? (
              <div className="table-row">
                <span className="muted">当前项目暂无权限成员</span>
              </div>
            ) : (
              projectPermissions.map((member) => (
                <div key={`perm-row-${member.user_id}`} className="table-row">
                  <span>{member.username}</span>
                  <span>{member.role || '-'}</span>
                  <span>
                    <input
                      type="checkbox"
                      checked={!!member.can_view}
                      onChange={(e) => onPermissionFlagChange(member.user_id, 'can_view', e.target.checked)}
                    />
                  </span>
                  <span>
                    <input
                      type="checkbox"
                      checked={!!member.can_edit}
                      onChange={(e) => onPermissionFlagChange(member.user_id, 'can_edit', e.target.checked)}
                    />
                  </span>
                  <span>
                    <input
                      type="checkbox"
                      checked={!!member.can_assign}
                      onChange={(e) => onPermissionFlagChange(member.user_id, 'can_assign', e.target.checked)}
                    />
                  </span>
                  <span>
                    <input
                      type="checkbox"
                      checked={!!member.can_close}
                      onChange={(e) => onPermissionFlagChange(member.user_id, 'can_close', e.target.checked)}
                    />
                  </span>
                  <span className="actions">
                    <button
                      type="button"
                      className="btn btn-outline-danger"
                      onClick={() => onRemoveProjectPermissionMember(member.user_id)}
                    >
                      移除
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="panel-header" style={{ marginTop: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>权限变更审计</h3>
              <p>支持按操作人和时间筛选，并导出CSV。</p>
            </div>
          </div>
          <div className="filter-row">
              <input
                placeholder="事件类型（默认 权限更新）"
                value={permissionLogEventType}
                onChange={(e) => setPermissionLogEventType(e.target.value)}
              />
            <input
              placeholder="操作人"
              value={permissionLogOperator}
              onChange={(e) => setPermissionLogOperator(e.target.value)}
            />
            <input
              type="date"
              value={permissionLogFrom}
              onChange={(e) => setPermissionLogFrom(e.target.value)}
            />
            <input
              type="date"
              value={permissionLogTo}
              onChange={(e) => setPermissionLogTo(e.target.value)}
            />
            <button
              type="button"
              className="ghost btn btn-outline-secondary"
              onClick={() => refreshProjectPermissionLogs(permissionProjectId)}
            >
              刷新日志
            </button>
            <button
              type="button"
              className="primary btn btn-primary"
              onClick={onExportProjectPermissionLogs}
            >
              导出权限审计CSV
            </button>
          </div>
          <div className="table compact-table permission-log-table">
            <div className="table-row head">
              <span>时间</span>
              <span>内容</span>
              <span>类型</span>
              <span>操作人</span>
              <span>明细</span>
            </div>
            {permissionLogs.length === 0 ? (
              <div className="table-row">
                <span className="muted">暂无权限变更日志</span>
              </div>
            ) : (
              permissionLogs.map((log) => (
                <div key={`permission-log-wrap-${log.id}`} className="permission-log-wrap">
                  <div className="table-row">
                    <span>{formatDateTime(log.created_at)}</span>
                    <span>{log.event_desc || '-'}</span>
                    <span>{log.event_type || '-'}</span>
                    <span>{log.operator_name || '-'}</span>
                    <span className="actions">
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={() => togglePermissionLogExpand(log.id)}
                      >
                        {expandedPermissionLogs[log.id] ? '收起' : '展开'}
                      </button>
                    </span>
                  </div>
                  {expandedPermissionLogs[log.id] && (
                    <div className="table-row detail">
                      <span>{renderPermissionLogDetail(log)}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
        )}

        {activeMenu === 'templates' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>模板管理</h2>
              <p>支持页面新建模板与一键导入内置模板。</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={onCreateTemplate}>
            <label>
              模板编码
              <input
                placeholder="例如 VULN_SCAN"
                value={templateForm.code}
                onChange={(e) => setTemplateForm({ ...templateForm, code: e.target.value })}
              />
            </label>
            <label>
              模板名称
              <input
                placeholder="例如 漏洞扫描"
                value={templateForm.name}
                onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              />
            </label>
            <label className="full-row">
              模板描述
              <input
                placeholder="选填"
                value={templateForm.description}
                onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              />
            </label>
            <label className="full-row">
              阶段配置
              <div className="mini-table">
                {templateStages.map((row, index) => (
                  <div className="mini-row" key={`stage-row-${index}`}>
                    <input
                      placeholder="阶段名称"
                      value={row.name}
                      onChange={(e) => updateTemplateStageRow(index, 'name', e.target.value)}
                    />
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      placeholder="工期(天)"
                      value={row.duration_days}
                      onChange={(e) => updateTemplateStageRow(index, 'duration_days', e.target.value)}
                    />
                    <input
                      placeholder="交付物(逗号分隔)"
                      value={row.deliverables}
                      onChange={(e) => updateTemplateStageRow(index, 'deliverables', e.target.value)}
                    />
                    <input
                      placeholder="角色(逗号分隔)"
                      value={row.roles}
                      onChange={(e) => updateTemplateStageRow(index, 'roles', e.target.value)}
                    />
                    <button
                      type="button"
                      className="ghost btn btn-outline-secondary"
                      onClick={() => removeTemplateStageRow(index)}
                    >
                      删除阶段
                    </button>
                  </div>
                ))}
                <div className="form-actions">
                  <button type="button" className="ghost btn btn-outline-secondary" onClick={addTemplateStageRow}>
                    新增阶段
                  </button>
                </div>
              </div>
            </label>
            <div className="form-actions">
              <button type="submit" className="primary btn btn-primary">
                新建模板
              </button>
            </div>
          </form>
          <div className="form-grid">
            <label>
              内置模板
              <select
                value={selectedBuiltInTemplate}
                onChange={(e) => setSelectedBuiltInTemplate(e.target.value)}
              >
                <option value="">请选择</option>
                <option value="ALL">全部模板</option>
                {builtInTemplates.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="primary btn btn-primary" onClick={onImportTemplates}>
                导入所选模板
              </button>
            </div>
          </div>
          <div className="table tickets-table">
            <div className="table-row head">
              <span>编码</span>
              <span>名称</span>
              <span>描述</span>
              <span>创建时间</span>
            </div>
            {templates.length === 0 ? (
              <div className="table-row">
                <span className="muted">暂无模板</span>
              </div>
            ) : (
              templates.map((template) => (
                <div key={template.id} className="table-row">
                  <span>{template.code}</span>
                  <span>{template.name}</span>
                  <span>{template.description || '-'}</span>
                  <span>{formatDateTime(template.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
        )}

        {activeMenu === 'notifications' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>通知中心</h2>
              <p>覆盖协作人/观察者变更、评论@、审批结果等提醒。</p>
            </div>
            <div className="panel-actions">
              <button type="button" className="ghost btn btn-outline-secondary" onClick={() => refreshNotifications(notificationUnreadOnly)}>
                刷新
              </button>
              <button type="button" className="ghost btn btn-outline-secondary" onClick={onMarkAllNotificationsRead}>
                全部已读
              </button>
            </div>
          </div>
          <div className="filter-row">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={notificationUnreadOnly}
                onChange={(e) => setNotificationUnreadOnly(e.target.checked)}
              />
              仅看未读
            </label>
          </div>
          <div className="table compact-table">
            <div className="table-row head">
              <span>时间</span>
              <span>标题</span>
              <span>内容</span>
              <span>工单</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {notifications.length === 0 ? (
              <div className="table-row">
                <span className="muted">暂无通知</span>
              </div>
            ) : (
              notifications.map((item) => (
                <div key={`notification-${item.id}`} className={`table-row ${Number(item.is_read) === 1 ? '' : 'notification-unread'}`}>
                  <span>{formatDateTime(item.created_at)}</span>
                  <span>{item.title || '-'}</span>
                  <span>{item.content || '-'}</span>
                  <span>{item.ticket_title || `#${item.ticket_id}`}</span>
                  <span>{Number(item.is_read) === 1 ? '已读' : '未读'}</span>
                  <span className="actions">
                    {Number(item.is_read) === 0 && (
                      <button className="btn btn-outline-secondary" onClick={() => onMarkNotificationRead(item.id)}>
                        标记已读
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
        )}

        {activeMenu === 'tickets' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>工单列表</h2>
              <p>默认每页 10 条。</p>
            </div>
          </div>
          <div className="table">
            <div className="table-row head">
              <span>标题</span>
              <span>主负责人</span>
              <span>部门</span>
              <span>服务目录</span>
              <span>项目</span>
              <span>优先级</span>
              <span>严重级别</span>
              <span>SLA状态</span>
              <span>审批</span>
              <span>状态</span>
              <span>创建时间</span>
              <span>更新时间</span>
              <span>操作</span>
            </div>
            {pageData.items.length === 0 ? (
              <div className="table-row">
                <span className="muted">暂无工单</span>
              </div>
            ) : (
              pageData.items.map((ticket) => (
                <div key={ticket.id} className="table-row">
                  <span>
                    {ticket.title}
                    {ticket.description ? (
                      <div className="muted">{ticket.description}</div>
                    ) : null}
                  </span>
                  <span>{ticket.owner_name || '-'}</span>
                  <span>{departmentNameMap.get(ticket.department_code) || '-'}</span>
                  <span>{serviceNameMap.get(ticket.service_code) || '-'}</span>
                  <span>
                    {projectNameMap.get(String(ticket.project_id)) || '-'}
                  </span>
                  <span>{ticket.priority}</span>
                  <span>{getSeverityLabel(ticket.severity)}</span>
                  <span>
                    <span className={`sla-pill ${String(ticket.sla_status || '').toLowerCase()}`}>
                      {getSlaLabel(ticket.sla_status)}
                    </span>
                  </span>
                  <span>{getApprovalStatusLabel(ticket.approval_status)}</span>
                  <span>{getStatusLabel(ticket.status)}</span>
                  <span>{formatDateTime(ticket.created_at)}</span>
                  <span>{formatDateTime(ticket.updated_at)}</span>
                  <span className="actions">
                    <button className="btn btn-outline-secondary" onClick={() => onEditTicket(ticket)}>
                      编辑/详情
                    </button>
                    {currentUser?.role === 'admin' && (
                      <button className="btn btn-outline-danger" onClick={() => onDeleteTicket(ticket)}>
                        删除
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="pagination">
            <button
              className="btn btn-outline-secondary"
              onClick={() => setTicketPage((p) => Math.max(1, p - 1))}
              disabled={pageData.current === 1}
            >
              上一页
            </button>
            <span>
              第 {pageData.current}/{pageData.total} 页
            </span>
            <button
              className="btn btn-outline-secondary"
              onClick={() => setTicketPage((p) => Math.min(pageData.total, p + 1))}
              disabled={pageData.current === pageData.total}
            >
              下一页
            </button>
          </div>
        </section>
        )}

        {activeMenu === 'tickets' && activeTicket && !editingId && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>工单详情</h2>
                <p>{activeTicket.title}</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                状态
                <input value={getStatusLabel(activeTicket.status)} readOnly />
              </label>
              <label>
                优先级
                <input value={activeTicket.priority} readOnly />
              </label>
              <label>
                主负责人
                <input value={activeTicket.owner_name || '-'} readOnly />
              </label>
              <label>
                严重级别
                <input value={getSeverityLabel(activeTicket.severity)} readOnly />
              </label>
              <label>
                SLA状态
                <input value={getSlaLabel(activeTicket.sla_status)} readOnly />
              </label>
              <label>
                审批状态
                <input value={getApprovalStatusLabel(activeTicket.approval_status)} readOnly />
              </label>
              <label>
                部门
                <input value={departmentNameMap.get(activeTicket.department_code) || '-'} readOnly />
              </label>
              <label>
                服务目录
                <input value={serviceNameMap.get(activeTicket.service_code) || '-'} readOnly />
              </label>
              <label>
                客户名称
                <input value={activeTicket.customer_name || '-'} readOnly />
              </label>
              <label>
                请求人
                <input value={activeTicket.requester_name || '-'} readOnly />
              </label>
              <label>
                请求人电话
                <input value={activeTicket.requester_phone || '-'} readOnly />
              </label>
              <label>
                请求人邮箱
                <input value={activeTicket.requester_email || '-'} readOnly />
              </label>
              <label>
                响应截止
                <input value={formatDateTime(activeTicket.response_deadline) || '-'} readOnly />
              </label>
              <label>
                解决截止
                <input value={formatDateTime(activeTicket.resolve_deadline) || '-'} readOnly />
              </label>
              <label>
                创建时间
                <input value={formatDateTime(activeTicket.created_at)} readOnly />
              </label>
              <label>
                更新时间
                <input value={formatDateTime(activeTicket.updated_at)} readOnly />
              </label>
              <label className="full-row">
                指派人员
                <input
                  value={
                    ticketAssignees.length
                      ? ticketAssignees.map((item) => item.username).join('，')
                      : '未指派'
                  }
                  readOnly
                />
              </label>
              <label className="full-row">
                观察者
                <input
                  value={
                    ticketWatchers.length
                      ? ticketWatchers.map((item) => item.username).join('，')
                      : '无'
                  }
                  readOnly
                />
              </label>
              <label className="full-row">
                描述
                <textarea rows={3} value={activeTicket.description || ''} readOnly />
              </label>
            </div>
            <div className="attachment-box">
              <div className="attachment-header">
                <h3>附件</h3>
                {canManageAttachments && (
                  <label className="upload-btn ghost btn btn-outline-secondary">
                    {attachmentUploading ? '上传中...' : '上传附件'}
                    <input
                      type="file"
                      disabled={attachmentUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        onUploadAttachment(file)
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="table compact-table attachment-table">
                <div className="table-row head">
                  <span>文件名</span>
                  <span>大小</span>
                  <span>上传人</span>
                  <span>上传时间</span>
                  <span>操作</span>
                </div>
                {ticketAttachments.length === 0 ? (
                  <div className="table-row">
                    <span className="muted">暂无附件</span>
                  </div>
                ) : (
                  ticketAttachments.map((attachment) => (
                    <div key={`attachment-${attachment.id}`} className="table-row">
                      <span>{attachment.filename}</span>
                      <span>{formatFileSize(attachment.size_bytes)}</span>
                      <span>{attachment.created_name || '-'}</span>
                      <span>{formatDateTime(attachment.created_at)}</span>
                      <span className="actions">
                        <button
                          type="button"
                          className="ghost btn btn-outline-secondary"
                          onClick={() => onViewAttachment(attachment)}
                        >
                          查看附件
                        </button>
                        {canManageAttachments && (
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            onClick={() => onDeleteAttachment(attachment)}
                          >
                            删除附件
                          </button>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            {ticketStages.length > 0 && (
              <div className="table">
                <div className="table-row head">
                  <span>阶段</span>
                  <span>预计工期(天)</span>
                  <span>交付物进度</span>
                  <span>交付物</span>
                  <span>状态</span>
                </div>
                {ticketStages.map((stage) => (
                  <div key={stage.id} className="table-row">
                    <span>{stage.name}</span>
                    <span>{stage.duration_days}</span>
                    <span>
                      {stage.deliverable_done || 0}/{stage.deliverable_total || 0}
                      <div className="muted">{stage.deliverable_progress || 0}%</div>
                    </span>
                    <span>
                      {(stage.deliverables || []).length === 0 ? (
                        <span className="muted">无</span>
                      ) : (
                        <div className="deliverable-list readonly">
                          {(stage.deliverables || []).map((item) => (
                            <span
                              key={`detail-${item.id}`}
                              className={`deliverable-tag ${Number(item.done_flag) === 1 ? 'done' : ''}`}
                            >
                              {Number(item.done_flag) === 1 ? '✓ ' : ''}
                              {item.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </span>
                    <span>
                      <span className={`status-pill ${String(stage.status || '').toLowerCase()}`}>
                        {stage.status}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="comment-box">
              <h3>评论</h3>
              <p className="muted">支持 @用户名，系统会记录被@人员。</p>
              <textarea
                rows={3}
                placeholder="输入评论内容，例如：@张雷 请确认复测时间"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              />
              <div className="form-actions">
                <button type="button" className="primary btn btn-primary" onClick={onAddComment}>
                  发表评论
                </button>
              </div>
              <div className="table compact-table">
                <div className="table-row head">
                  <span>时间</span>
                  <span>评论内容</span>
                  <span>评论人</span>
                </div>
                {ticketComments.length === 0 ? (
                  <div className="table-row">
                    <span className="muted">暂无评论</span>
                  </div>
                ) : (
                  ticketComments.map((comment) => (
                    <div key={`comment-${comment.id}`} className="table-row">
                      <span>{formatDateTime(comment.created_at)}</span>
                      <span>
                        {comment.content}
                        {(comment.mentions || []).length > 0 && (
                          <div className="muted">
                            @通知：{comment.mentions.map((item) => item.username).join('，')}
                          </div>
                        )}
                      </span>
                      <span>{comment.created_name || '-'}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="filter-row">
              <input
                placeholder="事件类型（如 UPDATED）"
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
              />
              <input
                placeholder="操作人"
                value={eventOperatorFilter}
                onChange={(e) => setEventOperatorFilter(e.target.value)}
              />
              <input type="date" value={eventFromFilter} onChange={(e) => setEventFromFilter(e.target.value)} />
              <input type="date" value={eventToFilter} onChange={(e) => setEventToFilter(e.target.value)} />
              <button type="button" className="ghost btn btn-outline-secondary" onClick={onExportEventsCsv}>
                导出审计CSV
              </button>
            </div>
            <div className="table compact-table">
              <div className="table-row head">
                <span>时间</span>
                <span>事件</span>
                <span>操作人</span>
              </div>
              {ticketEvents.length === 0 ? (
                <div className="table-row">
                  <span className="muted">暂无操作事件</span>
                </div>
              ) : (
                ticketEvents.map((event) => (
                  <div key={event.id} className="table-row">
                    <span>{formatDateTime(event.created_at)}</span>
                    <span>
                      {event.event_desc}
                      <div className="muted">{getTicketEventLabel(event.event_type)}</div>
                    </span>
                    <span>{event.operator_name || '-'}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeMenu === 'gantt' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>甘特图数据</h2>
              <p>选择项目后加载任务与排期数据（可供前端图表使用）。</p>
            </div>
          </div>
          <div className="filter-row">
            <select value={ganttProjectId} onChange={(e) => setGanttProjectId(e.target.value)}>
              <option value="">请选择项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button type="button" className="primary btn btn-primary" onClick={loadGantt}>
              加载数据
            </button>
          </div>
          {ganttData && (
            <div className="mini-table">
              <div style={{ height: 360, width: '100%' }} ref={ganttRef} />
            </div>
          )}
        </section>
        )}

        {activeMenu === 'calendar' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>工单日历</h2>
                <p>点击日期查看当天工程师排期详情。</p>
              </div>
              <div className="panel-actions">
                <button
                  type="button"
                  className="ghost btn btn-outline-secondary"
                  onClick={() =>
                    setCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                    )
                  }
                >
                  上月
                </button>
                <strong>{calendarMonthLabel}</strong>
                <button
                  type="button"
                  className="ghost btn btn-outline-secondary"
                  onClick={() =>
                    setCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                    )
                  }
                >
                  下月
                </button>
              </div>
            </div>
            <div className="calendar-week-header">
              <span>周一</span>
              <span>周二</span>
              <span>周三</span>
              <span>周四</span>
              <span>周五</span>
              <span>周六</span>
              <span>周日</span>
            </div>
            <div className="calendar-grid">
              {calendarCells.map((cell, idx) =>
                cell ? (
                  <button
                    key={`day-${cell.day}`}
                    type="button"
                    className="calendar-day"
                    onClick={() => openCalendarDetail(cell)}
                  >
                    <div className="calendar-day-number">{cell.day}</div>
                    <div className="calendar-day-users">
                      {Array.from(new Set((cell.items || []).map((item) => item.engineer_name)))
                        .slice(0, 3)
                        .map((name) => (
                          <span key={`${cell.day}-${name}`} className="calendar-chip">
                            {name}
                          </span>
                        ))}
                      {(cell.items || []).length === 0 && <span className="muted">无安排</span>}
                    </div>
                  </button>
                ) : (
                  <div key={`empty-${idx}`} className="calendar-empty" />
                )
              )}
            </div>
          </section>
        )}
      </main>
      {calendarDetail.open && (
        <div className="modal-backdrop" onClick={() => setCalendarDetail({ open: false, day: null, items: [] })}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{calendarMonthLabel} {calendarDetail.day}日排期</div>
            <div className="modal-body">
              {calendarDetail.items.length === 0 ? (
                <div className="muted">当天无安排</div>
              ) : (
                calendarDetail.items.map((item) => (
                  <div key={`detail-${item.schedule_id}`} className="calendar-detail-row">
                    <span>{item.engineer_name}</span>
                    <span>{item.ticket_title}</span>
                    <span>{item.start_at} - {item.end_at}</span>
                    <button
                      type="button"
                      className="ghost btn btn-outline-secondary"
                      onClick={() => onOpenTicketFromCalendar(item.ticket_id)}
                    >
                      打开工单
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost btn btn-outline-secondary"
                onClick={() => setCalendarDetail({ open: false, day: null, items: [] })}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {message && <div className="toast success">{message}</div>}
      {error && <div className="toast error">{error}</div>}
    </div>
  )
}

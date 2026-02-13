import { useEffect, useMemo, useState, useRef } from 'react'
import * as echarts from 'echarts'
import './App.css'

const buildApi = (getToken, getCsrfToken) => ({
  get: async (path) => {
    const res = await fetch(path, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  post: async (path, body) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  put: async (path, body) => {
    const res = await fetch(path, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  del: async (path) => {
    const res = await fetch(path, {
      method: 'DELETE',
      headers: {
        ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
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
  { value: 'IN_PROGRESS', label: '处理中' },
  { value: 'RESOLVED', label: '已解决' },
  { value: 'CLOSED', label: '已关闭' },
]

const getStatusLabel = (value) => {
  const match = statusOptions.find((option) => option.value === value)
  return match ? match.label : value || '-'
}

const priorities = ['P1', 'P2', 'P3']
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

export default function App() {
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem('authToken') || '')
  const [, setCsrfToken] = useState('')
  const csrfTokenRef = useRef('')
  const setCsrf = (token) => {
    csrfTokenRef.current = token || ''
    setCsrfToken(token || '')
  }
  const [currentUser, setCurrentUser] = useState(null)
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [captchaState, setCaptchaState] = useState({ enabled: false, token: '', svg: '' })
  const [captchaInput, setCaptchaInput] = useState('')
  const [mfaState, setMfaState] = useState({ required: false, token: '', methods: [], method: '', code: '' })

  const [tickets, setTickets] = useState([])
  const [ticketSearch, setTicketSearch] = useState('')
  const [ticketStatus, setTicketStatus] = useState('')
  const [ticketProjectFilter, setTicketProjectFilter] = useState('')
  const [ticketPage, setTicketPage] = useState(1)
  const [ticketForm, setTicketForm] = useState({ title: '', description: '', priority: 'P2', status: 'OPEN', project_id: '' })
  const [editingId, setEditingId] = useState(null)
  const [projects, setProjects] = useState([])
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
  const [activeTicket, setActiveTicket] = useState(null)
  const [activeMenu, setActiveMenu] = useState('tickets')
  const [users, setUsers] = useState([])
  const [ticketAssignees, setTicketAssignees] = useState([])
  const [selectedAssignees, setSelectedAssignees] = useState([])
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [calendarDays, setCalendarDays] = useState([])
  const [calendarDetail, setCalendarDetail] = useState({ open: false, day: null, items: [] })
  const ganttRef = useRef(null)
  const ganttChart = useRef(null)

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ssoToken = params.get('sso_token')
    if (!ssoToken) return
    sessionStorage.setItem('authToken', ssoToken)
    setAuthToken(ssoToken)
    params.delete('sso_token')
    const query = params.toString()
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`
    window.history.replaceState({}, '', nextUrl)
  }, [])

  useEffect(() => {
    if (authToken) return
    const timer = setTimeout(() => {
      window.location.href = buildPortalEntryUrl('ticketing')
    }, 120)
    return () => clearTimeout(timer)
  }, [authToken])

  const api = useMemo(() => buildApi(() => authToken, () => csrfTokenRef.current), [authToken])

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

  const normalizeLoginError = (err) => {
    let msg = err && err.message ? String(err.message) : ''
    try {
      const parsed = JSON.parse(msg)
      if (parsed && parsed.error) msg = String(parsed.error)
    } catch {
      // ignore
    }
    msg = msg.replace(/<[^>]*>/g, '').trim()
    if (!msg) msg = '登录失败'
    if (msg.includes('账号或密码错误') || msg.includes('账号密码错误')) return '账号密码错误'
    if (msg.includes('Not allowed by CORS')) return 'CORS错误：域名未在CORS_ORIGINS中配置'
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return 'CORS错误：域名未在CORS_ORIGINS中配置'
    }
    if (msg.includes('Internal Server Error')) return '服务器内部错误，请查看后端日志'
    if (msg.includes('CSRF token invalid')) return '安全校验失败，请刷新后重试'
    if (msg.includes('Forbidden')) return '无权限'
    return msg
  }

  const refreshCaptcha = async () => {
    try {
      const data = await api.get('/api/auth/captcha')
      setCaptchaState(data?.enabled ? data : { enabled: false, token: '', svg: '' })
      setCaptchaInput('')
    } catch {
      setCaptchaState({ enabled: false, token: '', svg: '' })
      setCaptchaInput('')
    }
  }

  const refreshCsrf = async () => {
    try {
      const res = await fetch('/api/auth/csrf')
      if (!res.ok) throw new Error('csrf')
      const data = await res.json()
      const token = data.token || ''
      setCsrf(token)
      return token
    } catch {
      setCsrf('')
      return ''
    }
  }

  const refreshCurrentUser = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/auth/me')
      setCurrentUser(data)
    } catch {
      sessionStorage.removeItem('authToken')
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

  const refreshUsers = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/users')
      setUsers(Array.isArray(data) ? data : [])
    } catch {
      // 非管理员可能无权限，忽略
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

  useEffect(() => {
    refreshCaptcha()
  }, [])

  useEffect(() => {
    refreshCurrentUser()
  }, [authToken])

  useEffect(() => {
    refreshTickets()
  }, [authToken, ticketSearch, ticketStatus, ticketProjectFilter])

  useEffect(() => {
    refreshProjects()
  }, [authToken])

  useEffect(() => {
    refreshTemplates()
  }, [authToken])

  useEffect(() => {
    refreshUsers()
  }, [authToken])

  useEffect(() => {
    if (activeMenu !== 'calendar') return
    loadCalendarMonth()
  }, [authToken, activeMenu, calendarMonth])

  const onLogin = async (e) => {
    e.preventDefault()
    try {
      if (!csrfTokenRef.current) await refreshCsrf()
      const result = await api.post('/api/auth/login', {
        ...loginForm,
        captchaToken: captchaState.token,
        captcha: captchaInput,
      })
      if (result.mfaRequired) {
        setMfaState({
          required: true,
          token: result.mfaToken,
          methods: result.methods || [],
          method: (result.methods || [])[0] || '',
          code: '',
        })
        setLoginError('')
        return
      }
      sessionStorage.setItem('authToken', result.token)
      setAuthToken(result.token)
      setCurrentUser(result.user)
      setLoginError('')
      setLoginForm({ username: '', password: '' })
      setMfaState({ required: false, token: '', methods: [], method: '', code: '' })
    } catch (err) {
      setLoginError(normalizeLoginError(err))
      refreshCaptcha()
      refreshCsrf()
    }
  }

  const onMfaSend = async () => {
    if (!mfaState.token || !mfaState.method) return
    try {
      await api.post('/api/auth/mfa/send', { mfaToken: mfaState.token, method: mfaState.method })
      showMessage('验证码已发送')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onMfaVerify = async (e) => {
    e.preventDefault()
    try {
      const result = await api.post('/api/auth/mfa/verify', {
        mfaToken: mfaState.token,
        method: mfaState.method,
        code: mfaState.code,
      })
      sessionStorage.setItem('authToken', result.token)
      setAuthToken(result.token)
      setCurrentUser(result.user)
      setLoginError('')
      setLoginForm({ username: '', password: '' })
      setMfaState({ required: false, token: '', methods: [], method: '', code: '' })
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onLogout = () => {
    sessionStorage.removeItem('authToken')
    setAuthToken('')
    setCurrentUser(null)
    window.location.href = buildPortalEntryUrl('ticketing')
  }

  const onTicketSubmit = async (e) => {
    e.preventDefault()
    try {
      if (!ticketForm.title) return showError('标题不能为空')
      if (editingId) {
        await api.put(`/api/tickets/${editingId}`, ticketForm)
        showMessage('工单已更新')
      } else {
        await api.post('/api/tickets', ticketForm)
        showMessage('工单已创建')
      }
      setTicketForm({ title: '', description: '', priority: 'P2', status: 'OPEN', project_id: '' })
      setEditingId(null)
      refreshTickets()
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
      project_id: ticket.project_id || '',
    })
    refreshTicketStages(ticket.id)
    refreshTicketAssignees(ticket.id)
  }

  const onDeleteTicket = async (ticket) => {
    if (!confirm(`确认删除工单「${ticket.title}」？`)) return
    try {
      await api.del(`/api/tickets/${ticket.id}`)
      showMessage('工单已删除')
      refreshTickets()
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

  const onResetForm = () => {
    setEditingId(null)
    setActiveTicket(null)
    setTicketForm({ title: '', description: '', priority: 'P2', status: 'OPEN', project_id: '' })
    setTicketStages([])
    setSelectedTemplateId('')
    setTicketAssignees([])
    setSelectedAssignees([])
  }

  const onSaveAssignees = async () => {
    if (!editingId) return showError('请先选择工单')
    try {
      const result = await api.put(`/api/tickets/${editingId}/assignees`, {
        user_ids: selectedAssignees,
      })
      setTicketAssignees(result || [])
      showMessage('已更新指派人员')
    } catch (err) {
      showError(normalizeApiError(err))
    }
  }

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

  const onStageStatusChange = async (stageId, status) => {
    if (!editingId) return
    try {
      const updated = await api.put(`/api/tickets/${editingId}/stages/${stageId}`, { status })
      setTicketStages((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      )
      showMessage('阶段状态已更新')
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
    { key: 'templates', label: '模板管理', desc: '配置工单模板并快速生成阶段。' },
    { key: 'gantt', label: '甘特图', desc: '查看项目排期甘特图。' },
    { key: 'calendar', label: '工单日历', desc: '按月查看每天的工程师排期。' },
  ]
  const activeMenuMeta = menuItems.find((item) => item.key === activeMenu) || menuItems[0]
  const calendarMonthLabel = `${calendarMonth.getFullYear()}年${calendarMonth.getMonth() + 1}月`
  const calendarCells = getCalendarCells()

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
        <div className="menu">
          <button className="ghost btn btn-outline-secondary" onClick={onLogout}>退出登录</button>
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
              <h2>筛选</h2>
              <p>按状态或关键词快速定位工单。</p>
            </div>
          </div>
          <div className="filter-row">
            <input
              placeholder="搜索标题或描述"
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
            <button
              type="button"
              className="ghost btn btn-outline-secondary"
              onClick={() => {
                setTicketSearch('')
                setTicketStatus('')
                setTicketPage(1)
              }}
            >
              清空筛选
            </button>
          </div>
        </section>
        )}

        {activeMenu === 'tickets' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{editingId ? '编辑工单' : '新建工单'}</h2>
              <p>填写基本信息后提交。</p>
            </div>
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
              状态
              <select
                value={ticketForm.status}
                onChange={(e) => setTicketForm({ ...ticketForm, status: e.target.value })}
              >
                {statusOptions.filter((option) => option.value).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
              指派工程师（多选）
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
          {ticketStages.length > 0 && (
            <div className="table">
              <div className="table-row head">
                <span>阶段</span>
                <span>预计工期(天)</span>
                <span>状态</span>
              </div>
              {ticketStages.map((stage) => (
                <div key={stage.id} className="table-row">
                  <span>{stage.name}</span>
                  <span>{stage.duration_days}</span>
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
          <div className="table">
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
              <span>项目</span>
              <span>优先级</span>
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
                  <span>
                    {projects.find((project) => String(project.id) === String(ticket.project_id))?.name || '-'}
                  </span>
                  <span>{ticket.priority}</span>
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

        {activeMenu === 'tickets' && activeTicket && (
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
                描述
                <textarea rows={3} value={activeTicket.description || ''} readOnly />
              </label>
            </div>
            {ticketStages.length > 0 && (
              <div className="table">
                <div className="table-row head">
                  <span>阶段</span>
                  <span>预计工期(天)</span>
                  <span>状态</span>
                </div>
                {ticketStages.map((stage) => (
                  <div key={stage.id} className="table-row">
                    <span>{stage.name}</span>
                    <span>{stage.duration_days}</span>
                    <span>
                      <span className={`status-pill ${String(stage.status || '').toLowerCase()}`}>
                        {stage.status}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                  <div key={`detail-${item.schedule_id}`} className="mini-row">
                    <span>{item.engineer_name}</span>
                    <span>{item.ticket_title}</span>
                    <span>{item.start_at} - {item.end_at}</span>
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

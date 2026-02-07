import { useEffect, useMemo, useState, useRef } from 'react'
import QRCode from 'qrcode'
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

const tabs = [
  { key: 'dashboard', label: '仪表盘' },
  { key: 'customers', label: '客户管理' },
  { key: 'contacts', label: '联系人管理' },
  { key: 'licenses', label: '授权管理' },
  { key: 'send', label: '发送' },
  { key: 'reminders', label: '提醒记录' },
  { key: 'imports', label: '导入记录' },
  { key: 'ops', label: '操作日志' },
  { key: 'account', label: '账号安全' },
  { key: 'config', label: '发送配置' },
  { key: 'security', label: '安全配置' },
  { key: 'users', label: '用户管理' },
]

const emptyCustomer = { id: null, name: '', juxin_sales: '', channel_sales: '' }
const emptyContact = {
  id: null,
  customer_id: '',
  name: '',
  phone: '',
  email: '',
  wecom_id: '',
  is_active: 1,
}
const emptyLicense = {
  id: null,
  customer_id: '',
  name: '',
  start_date: '',
  end_date: '',
  status: 'ACTIVE',
  note: '',
  reminder_days: '',
}

function App() {
  const [dashboard, setDashboard] = useState({
    expiring: 0,
    todayDue: 0,
    totalReminders: 0,
    successRate: 0,
    channelBreakdown: { email: { total: 0, success: 0 }, sms: { total: 0, success: 0 }, wecom: { total: 0, success: 0 } },
    trend: [],
    failureBreakdown: [],
    expiryBuckets: [],
    salesTop: [],
    customerRisk: [],
  })
  const [dashboardFilters, setDashboardFilters] = useState({
    customer_id: '',
    sales: '',
    channel: '',
  })
  const [dashboardView, setDashboardView] = useState(localStorage.getItem('dashboardView') || 'A')
  const [authToken, setAuthToken] = useState(localStorage.getItem('authToken') || '')
  const [currentUser, setCurrentUser] = useState(null)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [customers, setCustomers] = useState([])
  const [customerPage, setCustomerPage] = useState(1)
  const [contacts, setContacts] = useState([])
  const [contactPage, setContactPage] = useState(1)
  const [licenses, setLicenses] = useState([])
  const [licensePage, setLicensePage] = useState(1)
  const [customerForm, setCustomerForm] = useState(emptyCustomer)
  const [contactForm, setContactForm] = useState(emptyContact)
  const [licenseForm, setLicenseForm] = useState(emptyLicense)
  const [customerSearch, setCustomerSearch] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [contactCustomerFilter, setContactCustomerFilter] = useState('')
  const [contactStatusFilter, setContactStatusFilter] = useState('')
  const [licenseSearch, setLicenseSearch] = useState('')
  const [licenseCustomerFilter, setLicenseCustomerFilter] = useState('')
  const [licenseStatusFilter, setLicenseStatusFilter] = useState('')
  const [licenseQuickFilter, setLicenseQuickFilter] = useState('')
  const [licenseExpiringDays, setLicenseExpiringDays] = useState('30')
  const [reminderLogs, setReminderLogs] = useState([])
  const [reminderPage, setReminderPage] = useState(1)
  const [operationLogs, setOperationLogs] = useState([])
  const [opsPage, setOpsPage] = useState(1)
  const [expandedOpsLogId, setExpandedOpsLogId] = useState(null)
  const [opsFilters, setOpsFilters] = useState({
    username: '',
    action: '',
    entity: '',
    date_from: '',
    date_to: '',
  })
  const [importJobs, setImportJobs] = useState([])
  const [importJobsPage, setImportJobsPage] = useState(1)
  const [importJobFilters, setImportJobFilters] = useState({
    type: '',
    status: '',
    username: '',
    date_from: '',
    date_to: '',
  })
  const [expandedImportJob, setExpandedImportJob] = useState(null)
  const [sendPlans, setSendPlans] = useState([])
  const [sendPlanPage, setSendPlanPage] = useState(1)
  const [sendPlanForm, setSendPlanForm] = useState({
    id: null,
    name: '',
    license_id: '',
    contact_ids: [],
    days: '60,30,20',
    channels: ['email'],
    enabled: true,
    start_date: '',
    end_date: '',
  })
  const [planContactSearch, setPlanContactSearch] = useState('')
  const [planCustomerFilter, setPlanCustomerFilter] = useState('')
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false)
  const contactDropdownRef = useRef(null)
  const [reminderFilters, setReminderFilters] = useState({
    customer_id: '',
    status: '',
    days_left: '',
    date_from: '',
    date_to: '',
    is_test: '',
    error_code: '',
  })
  const [users, setUsers] = useState([])
  const [usersPage, setUsersPage] = useState(1)
  const [userForm, setUserForm] = useState({
    id: null,
    username: '',
    password: '',
    role: 'viewer',
    email: '',
    phone: '',
    wecom_id: '',
  })
  const [configForm, setConfigForm] = useState({
    email: { host: '', port: '', user: '', pass: '', from: '', secure: '' },
    sms: {
      accessKeyId: '',
      accessKeySecret: '',
      signName: '',
      templateCode: '',
      templateParamKey: 'content',
      templateParams: '{\"content\":\"{message}\"}',
      endpoint: 'https://dysmsapi.aliyuncs.com',
      apiVersion: '2017-05-25',
    },
    wecom: { corpId: '', agentId: '', secret: '', webhook: '' },
    reminder: {
      subject: '授权到期提醒',
      message: '【{customer_name}】的{license_name}将于{end_date}到期，剩余{days_left}天。',
      locked: false,
    },
    reminderSchedule: { days: '60,30,20', hour: 9, minute: 0, channels: ['email'], graceDays: 0 },
    retry: { maxRetries: 2, intervalMs: 2000 },
    rateLimit: { maxPerRun: 200 },
    security: {
      login: { maxAttempts: 5, windowMinutes: 15, lockMinutes: 15 },
      mfa: { codeTtlSeconds: 300 },
      adminMfaMethods: [],
    },
  })
  const [testEmail, setTestEmail] = useState('')
  const [testEmailSubject, setTestEmailSubject] = useState('测试邮件')
  const [testEmailMessage, setTestEmailMessage] = useState('这是一封测试邮件。')
  const [testSms, setTestSms] = useState('')
  const [testSmsMessage, setTestSmsMessage] = useState('这是一条测试短信。')
  const [testWecom, setTestWecom] = useState('')
  const [testWecomMessage, setTestWecomMessage] = useState('这是一条测试企业微信消息。')
  const [testWecomWebhook, setTestWecomWebhook] = useState('')
  const [testEmailStatus, setTestEmailStatus] = useState({ type: '', text: '' })
  const [testSmsStatus, setTestSmsStatus] = useState({ type: '', text: '' })
  const [testWecomStatus, setTestWecomStatus] = useState({ type: '', text: '' })
  const [modalInfo, setModalInfo] = useState(null)
  const [configDirty, setConfigDirty] = useState(false)
  const [testTemplate, setTestTemplate] = useState({
    customer_name: '',
    license_name: '',
    end_date: '',
    days_left: '',
    contact_name: '',
  })
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
  })
  const [totpSetupInfo, setTotpSetupInfo] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpQr, setTotpQr] = useState('')
  const [myMfaSettings, setMyMfaSettings] = useState({
    enabled: false,
    methods: [],
    totp_enabled: false,
    has_email: false,
    has_phone: false,
    has_wecom: false,
  })
  const [customerImportResult, setCustomerImportResult] = useState(null)
  const [contactImportResult, setContactImportResult] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [csrfToken, setCsrfToken] = useState('')
  const [passwordFeedback, setPasswordFeedback] = useState({ type: '', text: '' })
  const api = useMemo(() => buildApi(() => authToken, () => csrfToken), [authToken, csrfToken])
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [mfaState, setMfaState] = useState({
    required: false,
    token: '',
    methods: [],
    method: '',
    code: '',
  })
  const [captchaState, setCaptchaState] = useState({ enabled: false, token: '', svg: '' })
  const [captchaInput, setCaptchaInput] = useState('')

  const rolePermissions = useMemo(
    () => ({
      admin: {
        canWrite: true,
        canDelete: true,
        canConfig: true,
        canSend: true,
        canManageUsers: true,
      },
      sales: {
        canWrite: true,
        canDelete: false,
        canConfig: false,
        canSend: true,
        canManageUsers: false,
      },
      viewer: {
        canWrite: false,
        canDelete: false,
        canConfig: false,
        canSend: false,
        canManageUsers: false,
      },
    }),
    []
  )
  const permissions = rolePermissions[currentUser?.role || 'viewer']

  const visibleTabs = tabs.filter((tab) => {
    if (tab.key === 'config') return permissions.canConfig
    if (tab.key === 'security') return permissions.canConfig
    if (tab.key === 'users') return permissions.canManageUsers
    if (tab.key === 'send' || tab.key === 'reminders') return permissions.canSend
    if (tab.key === 'imports') return permissions.canWrite
    if (tab.key === 'ops') return permissions.canManageUsers
    return true
  })

  useEffect(() => {
    if (!visibleTabs.find((tab) => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'customers')
    }
  }, [visibleTabs, activeTab])

  useEffect(() => {
    if (!totpSetupInfo?.otpauth) {
      setTotpQr('')
      return
    }
    QRCode.toDataURL(totpSetupInfo.otpauth, { margin: 1, width: 180 })
      .then((url) => setTotpQr(url))
      .catch(() => setTotpQr(''))
  }, [totpSetupInfo])

  useEffect(() => {
    refreshCsrf()
  }, [])

  const customerMap = useMemo(() => {
    const map = new Map()
    customers.forEach((c) => map.set(String(c.id), c))
    return map
  }, [customers])

  const salesOptions = useMemo(() => {
    const set = new Set()
    customers.forEach((c) => {
      if (c.juxin_sales) set.add(String(c.juxin_sales))
      if (c.channel_sales) set.add(String(c.channel_sales))
    })
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [customers])

  const contactMap = useMemo(() => {
    const map = new Map()
    contacts.forEach((c) => map.set(String(c.id), c))
    return map
  }, [contacts])

  const planContactsView = useMemo(() => {
    const keyword = planContactSearch.trim().toLowerCase()
    return contacts.filter((c) => {
      if (planCustomerFilter && String(c.customer_id) !== String(planCustomerFilter)) {
        return false
      }
      if (!keyword) return true
      return (
        String(c.name || '').toLowerCase().includes(keyword) ||
        String(c.phone || '').toLowerCase().includes(keyword) ||
        String(c.email || '').toLowerCase().includes(keyword) ||
        String(c.customer_name || '').toLowerCase().includes(keyword)
      )
    })
  }, [contacts, planContactSearch, planCustomerFilter])

  const pagedCustomers = useMemo(() => paginate(customers, customerPage), [customers, customerPage])
  const pagedContacts = useMemo(() => paginate(contacts, contactPage), [contacts, contactPage])
  const pagedLicenses = useMemo(() => paginate(licenses, licensePage), [licenses, licensePage])
  const pagedSendPlans = useMemo(() => paginate(sendPlans, sendPlanPage), [sendPlans, sendPlanPage])
  const pagedReminderLogs = useMemo(() => paginate(reminderLogs, reminderPage), [reminderLogs, reminderPage])
  const pagedOperationLogs = useMemo(() => paginate(operationLogs, opsPage), [operationLogs, opsPage])
  const pagedUsers = useMemo(() => paginate(users, usersPage), [users, usersPage])
  const pagedImportJobs = useMemo(() => paginate(importJobs, importJobsPage), [importJobs, importJobsPage])

  const refreshCustomers = async () => {
    const params = new URLSearchParams()
    if (customerSearch) params.append('search', customerSearch)
    const data = await api.get(`/api/customers?${params.toString()}`)
    setCustomers(data)
  }

  const refreshContacts = async () => {
    const params = new URLSearchParams()
    if (contactSearch) params.append('search', contactSearch)
    if (contactCustomerFilter) params.append('customer_id', contactCustomerFilter)
    if (contactStatusFilter) params.append('is_active', contactStatusFilter)
    const data = await api.get(`/api/contacts?${params.toString()}`)
    setContacts(data)
  }


  const refreshLicenses = async () => {
    const params = new URLSearchParams()
    if (licenseSearch) params.append('search', licenseSearch)
    if (licenseCustomerFilter) params.append('customer_id', licenseCustomerFilter)
    if (licenseStatusFilter) params.append('status', licenseStatusFilter)
    if (licenseQuickFilter) params.append('quick', licenseQuickFilter)
    if (licenseQuickFilter === 'expiring') params.append('days', licenseExpiringDays)
    const data = await api.get(`/api/licenses?${params.toString()}`)
    setLicenses(data)
  }

  const refreshReminderLogs = async () => {
    const params = new URLSearchParams()
    Object.entries(reminderFilters).forEach(([key, value]) => {
      if (value) params.append(key, value)
    })
    const data = await api.get(`/api/reminder-logs?${params.toString()}`)
    setReminderLogs(data)
  }

  const refreshOperationLogs = async () => {
    if (!permissions.canManageUsers) return
    const params = new URLSearchParams()
    Object.entries(opsFilters).forEach(([key, value]) => {
      if (value) params.append(key, value)
    })
    const data = await api.get(`/api/operation-logs?${params.toString()}`)
    setOperationLogs(data)
  }

  const refreshDashboard = async () => {
    const params = new URLSearchParams()
    Object.entries(dashboardFilters).forEach(([key, value]) => {
      if (value) params.append(key, value)
    })
    const data = await api.get(`/api/dashboard?${params.toString()}`)
    setDashboard({
      expiring: Number(data.expiring || 0),
      todayDue: Number(data.todayDue || 0),
      totalReminders: Number(data.totalReminders || 0),
      successRate: Number(data.successRate || 0),
      channelBreakdown:
        data.channelBreakdown || { email: { total: 0, success: 0 }, sms: { total: 0, success: 0 }, wecom: { total: 0, success: 0 } },
      trend: Array.isArray(data.trend) ? data.trend : [],
      failureBreakdown: Array.isArray(data.failureBreakdown) ? data.failureBreakdown : [],
      expiryBuckets: Array.isArray(data.expiryBuckets) ? data.expiryBuckets : [],
      salesTop: Array.isArray(data.salesTop) ? data.salesTop : [],
      customerRisk: Array.isArray(data.customerRisk) ? data.customerRisk : [],
    })
  }

  const refreshImportJobs = async () => {
    if (!permissions.canWrite) return
    const params = new URLSearchParams()
    Object.entries(importJobFilters).forEach(([key, value]) => {
      if (value) params.append(key, value)
    })
    const data = await api.get(`/api/import-jobs?${params.toString()}`)
    setImportJobs(data)
  }

  const exportOperationLogs = async () => {
    if (!permissions.canManageUsers) return
    const params = new URLSearchParams()
    Object.entries(opsFilters).forEach(([key, value]) => {
      if (value) params.append(key, value)
    })
    try {
      const res = await fetch(`/api/operation-logs/export?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      })
      if (!res.ok) throw new Error('导出失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `operation_logs_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      showError('操作日志导出失败')
    }
  }

  const toggleImportJob = async (job) => {
    if (!job) return
    if (expandedImportJob?.id === job.id) {
      setExpandedImportJob(null)
      return
    }
    try {
      const detail = await api.get(`/api/import-jobs/${job.id}`)
      setExpandedImportJob(detail)
    } catch (err) {
      showError('获取导入详情失败')
    }
  }

  const refreshSendPlans = async () => {
    const data = await api.get('/api/send-plans')
    setSendPlans(data)
  }

  const refreshUsers = async () => {
    if (!permissions.canManageUsers) return
    const data = await api.get('/api/users')
    setUsers(data)
  }

  const refreshConfigs = async () => {
    const data = await api.get('/api/send-configs')
    const smsConfig = data.sms || {}
    setConfigForm((prev) => ({
      email: data.email || prev.email,
      sms: { ...prev.sms, ...smsConfig },
      wecom: data.wecom || prev.wecom,
      reminder: data.reminder || prev.reminder,
      reminderSchedule: data.reminderSchedule || prev.reminderSchedule,
      retry: data.retry || prev.retry,
      rateLimit: data.rateLimit || prev.rateLimit,
      security: data.security || prev.security,
    }))
    setConfigDirty(false)
  }


  useEffect(() => {
    if (!authToken) return
    refreshCustomers()
    refreshContacts()
    refreshLicenses()
    refreshReminderLogs()
    refreshSendPlans()
    refreshImportJobs()
    refreshConfigs()
    refreshUsers()
    refreshDashboard()
    refreshOperationLogs()
  }, [authToken])

  useEffect(() => {
    if (!authToken) return
    refreshReminderLogs()
  }, [reminderFilters, authToken])

  useEffect(() => {
    if (!authToken) return
    if (activeTab !== 'dashboard') return
    refreshDashboard()
  }, [dashboardFilters, authToken, activeTab])

  useEffect(() => {
    try {
      localStorage.setItem('dashboardView', dashboardView)
    } catch (err) {
      // ignore
    }
  }, [dashboardView])

  useEffect(() => {
    if (!authToken) return
    if (!permissions.canWrite) return
    refreshImportJobs()
  }, [importJobFilters, authToken, permissions.canWrite])

  useEffect(() => {
    if (!authToken) return
    if (!permissions.canManageUsers) return
    refreshOperationLogs()
  }, [opsFilters, authToken, permissions.canManageUsers])

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      refreshUsers()
    }
  }, [currentUser])


  useEffect(() => {
    if (!authToken) return
    refreshCustomers()
  }, [customerSearch, authToken])

  useEffect(() => {
    if (!authToken) return
    refreshContacts()
  }, [contactSearch, contactCustomerFilter, contactStatusFilter, authToken])

  useEffect(() => {
    if (!authToken) return
    refreshLicenses()
  }, [licenseSearch, licenseCustomerFilter, licenseStatusFilter, licenseQuickFilter, licenseExpiringDays, authToken])

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
    } catch (e) {
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
    } catch (e) {
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
    } catch (err) {
      setCaptchaState({ enabled: false, token: '', svg: '' })
      setCaptchaInput('')
    }
  }

  const refreshMyMfaSettings = async () => {
    if (!authToken) return
    try {
      const data = await api.get('/api/auth/mfa/settings')
      setMyMfaSettings({
        enabled: !!data.enabled,
        methods: Array.isArray(data.methods) ? data.methods : [],
        totp_enabled: !!data.totp_enabled,
        has_email: !!data.has_email,
        has_phone: !!data.has_phone,
        has_wecom: !!data.has_wecom,
      })
    } catch (err) {
      // ignore
    }
  }

  const refreshCsrf = async () => {
    try {
      const res = await fetch('/api/auth/csrf')
      if (!res.ok) throw new Error('csrf')
      const data = await res.json()
      const token = data.token || ''
      setCsrfToken(token)
      return token
    } catch (err) {
      setCsrfToken('')
      return ''
    }
  }

  const onLogin = async (e) => {
    e.preventDefault()
    try {
      if (!csrfToken) {
        await refreshCsrf()
      }
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
      localStorage.setItem('authToken', result.token)
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
      showError(err.message || '验证码发送失败')
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
      localStorage.setItem('authToken', result.token)
      setAuthToken(result.token)
      setCurrentUser(result.user)
      setMfaState({ required: false, token: '', methods: [], method: '', code: '' })
      setLoginForm({ username: '', password: '' })
      setLoginError('')
    } catch (err) {
      setLoginError(normalizeLoginError(err))
    }
  }

  const onLogout = async () => {
    try {
      await api.post('/api/auth/logout')
    } catch (err) {
      // ignore
    }
    localStorage.removeItem('authToken')
    setAuthToken('')
    setCurrentUser(null)
    setActiveTab('dashboard')
  }

  const onSaveCustomer = async (e) => {
    e.preventDefault()
    try {
      if (customerForm.id) {
        await api.put(`/api/customers/${customerForm.id}`, customerForm)
        showMessage('客户已更新')
      } else {
        await api.post('/api/customers', customerForm)
        showMessage('客户已创建')
      }
      setCustomerForm(emptyCustomer)
      refreshCustomers()
    } catch (err) {
      showError('客户保存失败')
    }
  }

  const onEditCustomer = (customer) => {
    setCustomerForm({
      id: customer.id,
      name: customer.name,
      juxin_sales: customer.juxin_sales || '',
      channel_sales: customer.channel_sales || '',
    })
  }

  const onDeleteCustomer = async (id) => {
    if (!window.confirm('确认删除该客户？')) return
    try {
      await api.del(`/api/customers/${id}`)
      showMessage('客户已删除')
      refreshCustomers()
    } catch (err) {
      showError('该客户下有联系人，无法删除')
    }
  }

  const onSaveContact = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        ...contactForm,
        is_active: contactForm.is_active ? 1 : 0,
      }
      if (contactForm.id) {
        await api.put(`/api/contacts/${contactForm.id}`, payload)
        showMessage('联系人已更新')
      } else {
        await api.post('/api/contacts', payload)
        showMessage('联系人已创建')
      }
      setContactForm(emptyContact)
      refreshContacts()
    } catch (err) {
      showError('联系人保存失败')
    }
  }

  const onEditContact = (contact) => {
    setContactForm({
      id: contact.id,
      customer_id: String(contact.customer_id),
      name: contact.name,
      phone: contact.phone || '',
      email: contact.email || '',
      wecom_id: contact.wecom_id || '',
      is_active: contact.is_active !== 0,
    })
  }

  const onDeleteContact = async (id) => {
    if (!window.confirm('确认删除该联系人？')) return
    try {
      await api.del(`/api/contacts/${id}`)
      showMessage('联系人已删除')
      refreshContacts()
    } catch (err) {
      showError('联系人删除失败')
    }
  }

  const onSaveLicense = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        ...licenseForm,
        reminder_days: licenseForm.reminder_days || '',
      }
      if (licenseForm.id) {
        await api.put(`/api/licenses/${licenseForm.id}`, payload)
        showMessage('授权已更新')
      } else {
        await api.post('/api/licenses', payload)
        showMessage('授权已创建')
      }
      setLicenseForm(emptyLicense)
      refreshLicenses()
    } catch (err) {
      showError('授权保存失败')
    }
  }

  const onEditLicense = (license) => {
    setLicenseForm({
      id: license.id,
      customer_id: String(license.customer_id),
      name: license.name,
      start_date: license.start_date || '',
      end_date: license.end_date || '',
      status: license.status || 'ACTIVE',
      note: license.note || '',
      reminder_days: license.reminder_days || '',
    })
  }

  const onDeleteLicense = async (id) => {
    if (!window.confirm('确认删除该授权？')) return
    try {
      await api.del(`/api/licenses/${id}`)
      showMessage('授权已删除')
      refreshLicenses()
    } catch (err) {
      showError('授权删除失败')
    }
  }


  const onAutocompleteSelect = (value) => {
    const match = customers.find((c) => c.name === value)
    if (match) {
      setContactForm((prev) => ({ ...prev, customer_id: String(match.id) }))
    }
  }


  const onSaveConfig = async (e) => {
    e.preventDefault()
    try {
      await api.post('/api/send-configs', {
        ...configForm,
      })
      showMessage('配置已保存')
      setConfigDirty(false)
    } catch (err) {
      showError('配置保存失败')
    }
  }

  const onSaveSecurity = async (e) => {
    e.preventDefault()
    try {
      await api.post('/api/send-configs', {
        security: configForm.security,
      })
      showMessage('安全配置已保存')
    } catch (err) {
      showError('安全配置保存失败')
    }
  }

  const onTestEmail = (e) => {
    e.preventDefault()
    setTestEmailStatus({ type: '', text: '' })
    if (!testEmail) {
      setTestEmailStatus({ type: 'error', text: '请输入测试邮箱' })
      setModalInfo({ title: '测试邮件失败', message: '请输入测试邮箱' })
      return showError('请输入测试邮箱')
    }
    if (configDirty) {
      const msg = '配置已修改但未保存，请先点击“保存配置”'
      setTestEmailStatus({ type: 'error', text: msg })
      setModalInfo({ title: '测试邮件失败', message: msg })
      return showError(msg)
    }
    const subject = testEmailSubject
      .replace(/\{customer_name\}/g, testTemplate.customer_name || '')
      .replace(/\{license_name\}/g, testTemplate.license_name || '')
      .replace(/\{end_date\}/g, testTemplate.end_date || '')
      .replace(/\{days_left\}/g, testTemplate.days_left || '')
      .replace(/\{contact_name\}/g, testTemplate.contact_name || '')
    const message = testEmailMessage
      .replace(/\{customer_name\}/g, testTemplate.customer_name || '')
      .replace(/\{license_name\}/g, testTemplate.license_name || '')
      .replace(/\{end_date\}/g, testTemplate.end_date || '')
      .replace(/\{days_left\}/g, testTemplate.days_left || '')
      .replace(/\{contact_name\}/g, testTemplate.contact_name || '')
    api
      .post('/api/test/email', {
        email: testEmail,
        subject,
        message,
      })
      .then(() => {
        setTestEmailStatus({ type: 'success', text: '测试邮件发送成功' })
        showMessage('测试邮件已发送')
        setModalInfo({ title: '测试邮件成功', message: '测试邮件发送成功' })
      })
      .catch((err) => {
        const msg = normalizeApiError(err) || '测试邮件发送失败'
        setTestEmailStatus({ type: 'error', text: msg })
        setModalInfo({ title: '测试邮件失败', message: msg })
        showError(msg)
      })
  }

  const onTestSms = (e) => {
    e.preventDefault()
    setTestSmsStatus({ type: '', text: '' })
    if (!testSms) {
      setTestSmsStatus({ type: 'error', text: '请输入测试手机号' })
      setModalInfo({ title: '测试短信失败', message: '请输入测试手机号' })
      return showError('请输入测试手机号')
    }
    if (configDirty) {
      const msg = '配置已修改但未保存，请先点击“保存配置”'
      setTestSmsStatus({ type: 'error', text: msg })
      setModalInfo({ title: '测试短信失败', message: msg })
      return showError(msg)
    }
    const message = testSmsMessage
      .replace(/\{customer_name\}/g, testTemplate.customer_name || '')
      .replace(/\{license_name\}/g, testTemplate.license_name || '')
      .replace(/\{end_date\}/g, testTemplate.end_date || '')
      .replace(/\{days_left\}/g, testTemplate.days_left || '')
      .replace(/\{contact_name\}/g, testTemplate.contact_name || '')
    api
      .post('/api/test/sms', { phone: testSms, message })
      .then(() => {
        setTestSmsStatus({ type: 'success', text: '测试短信发送成功' })
        showMessage('测试短信已发送')
        setModalInfo({ title: '测试短信成功', message: '测试短信发送成功' })
      })
      .catch((err) => {
        const msg = normalizeApiError(err) || '测试短信发送失败'
        setTestSmsStatus({ type: 'error', text: msg })
        setModalInfo({ title: '测试短信失败', message: msg })
        showError(msg)
      })
  }

  const onTestWecom = (e) => {
    e.preventDefault()
    setTestWecomStatus({ type: '', text: '' })
    if (!testWecom) {
      setTestWecomStatus({ type: 'error', text: '请输入测试用户' })
      setModalInfo({ title: '测试企业微信失败', message: '请输入测试用户' })
      return showError('请输入测试用户')
    }
    if (configDirty) {
      const msg = '配置已修改但未保存，请先点击“保存配置”'
      setTestWecomStatus({ type: 'error', text: msg })
      setModalInfo({ title: '测试企业微信失败', message: msg })
      return showError(msg)
    }
    const message = testWecomMessage
      .replace(/\{customer_name\}/g, testTemplate.customer_name || '')
      .replace(/\{license_name\}/g, testTemplate.license_name || '')
      .replace(/\{end_date\}/g, testTemplate.end_date || '')
      .replace(/\{days_left\}/g, testTemplate.days_left || '')
      .replace(/\{contact_name\}/g, testTemplate.contact_name || '')
    api
      .post('/api/test/wecom', {
        userId: testWecom,
        webhook: testWecomWebhook,
        message,
      })
      .then(() => {
        setTestWecomStatus({ type: 'success', text: '测试企业微信发送成功' })
        showMessage('测试企业微信已发送')
        setModalInfo({ title: '测试企业微信成功', message: '测试企业微信发送成功' })
      })
      .catch((err) => {
        const msg = normalizeApiError(err) || '测试企业微信发送失败'
        setTestWecomStatus({ type: 'error', text: msg })
        setModalInfo({ title: '测试企业微信失败', message: msg })
        showError(msg)
      })
  }

  const onSaveUser = async (e) => {
    e.preventDefault()
    try {
      if (userForm.id) {
        await api.put(`/api/users/${userForm.id}`, {
          password: userForm.password || undefined,
          role: userForm.role,
          email: userForm.email,
          phone: userForm.phone,
          wecom_id: userForm.wecom_id,
        })
        showMessage('用户已更新')
      } else {
        await api.post('/api/users', userForm)
        showMessage('用户已创建')
      }
      setUserForm({ id: null, username: '', password: '', role: 'viewer', email: '', phone: '', wecom_id: '' })
      refreshUsers()
    } catch (err) {
      showError('用户保存失败')
    }
  }

  const onTotpSetup = async () => {
    try {
      const info = await api.post('/api/auth/totp/setup', {})
      setTotpSetupInfo(info)
      setTotpCode('')
      showMessage('已生成谷歌认证密钥')
    } catch (err) {
      showError(err.message || '生成失败')
    }
  }

  const onTotpEnable = async () => {
    if (!totpCode) return showError('请输入谷歌认证验证码')
    try {
      await api.post('/api/auth/totp/enable', { code: totpCode })
      setTotpSetupInfo(null)
      setTotpCode('')
      showMessage('谷歌认证已启用')
      refreshUsers()
      refreshMyMfaSettings()
    } catch (err) {
      showError(err.message || '启用失败')
    }
  }

  const onSaveMyMfaSettings = async (e) => {
    e.preventDefault()
    try {
      await api.post('/api/auth/mfa/settings', {
        enabled: myMfaSettings.enabled,
        methods: myMfaSettings.methods,
      })
      showMessage('二次验证设置已保存')
      refreshMyMfaSettings()
    } catch (err) {
      showError(err.message || '二次验证设置保存失败')
    }
  }

  const onResendReminder = async (id) => {
    if (!window.confirm('确认重发该提醒？')) return
    try {
      await api.post(`/api/reminder-logs/${id}/resend`, {})
      showMessage('已重新发送')
      refreshReminderLogs()
    } catch (err) {
      showError('重新发送失败')
    }
  }

  const onSaveSendPlan = async (e) => {
    e.preventDefault()
    try {
      if (sendPlanForm.id) {
        await api.put(`/api/send-plans/${sendPlanForm.id}`, {
          ...sendPlanForm,
          enabled: sendPlanForm.enabled ? 1 : 0,
        })
        showMessage('发送计划已更新')
      } else {
        await api.post('/api/send-plans', {
          ...sendPlanForm,
          enabled: sendPlanForm.enabled ? 1 : 0,
        })
        showMessage('发送计划已创建')
      }
      setSendPlanForm({
        id: null,
        name: '',
        license_id: '',
        contact_ids: [],
        days: '60,30,20',
        channels: ['email'],
        enabled: true,
        start_date: '',
        end_date: '',
      })
      refreshSendPlans()
    } catch (err) {
      showError('发送计划保存失败')
    }
  }

  const onDeleteSendPlan = async (id) => {
    if (!window.confirm('确认删除该发送计划？')) return
    try {
      await api.del(`/api/send-plans/${id}`)
      showMessage('发送计划已删除')
      refreshSendPlans()
    } catch (err) {
      showError('发送计划删除失败')
    }
  }

  const onEditSendPlan = (plan) => {
    setSendPlanForm({
      id: plan.id,
      name: plan.name,
      license_id: String(plan.license_id),
      contact_ids: plan.contact_ids || [],
      days: plan.days,
      channels: plan.channels || [],
      enabled: plan.enabled !== 0,
      start_date: plan.start_date || '',
      end_date: plan.end_date || '',
    })
  }

  const onTogglePlanEnabled = async (plan) => {
    try {
      await api.put(`/api/send-plans/${plan.id}`, {
        ...plan,
        enabled: plan.enabled ? 0 : 1,
      })
      refreshSendPlans()
    } catch (err) {
      showError('切换状态失败')
    }
  }

  const onEditUser = (user) => {
    setUserForm({
      id: user.id,
      username: user.username,
      password: '',
      role: user.role,
      email: user.email || '',
      phone: user.phone || '',
      wecom_id: user.wecom_id || '',
    })
  }

  const onDeleteUser = async (id) => {
    if (!window.confirm('确认删除该用户？')) return
    try {
      await api.del(`/api/users/${id}`)
      showMessage('用户已删除')
      refreshUsers()
    } catch (err) {
      showError('用户删除失败')
    }
  }

  const onChangePassword = async (e) => {
    e.preventDefault()
    setPasswordFeedback({ type: '', text: '' })
    try {
      await api.post('/api/auth/change-password', passwordForm)
      showMessage('密码已修改')
      setPasswordFeedback({ type: 'success', text: '密码修改成功' })
      setPasswordForm({ currentPassword: '', newPassword: '' })
    } catch (err) {
      showError('密码修改失败')
      setPasswordFeedback({ type: 'error', text: '密码修改失败' })
    }
  }

  const onResetUserPassword = async (id) => {
    const newPassword = window.prompt('请输入新密码')
    if (!newPassword) return
    try {
      await api.post(`/api/users/${id}/reset-password`, { newPassword })
      showMessage('密码已重置')
    } catch (err) {
      showError('密码重置失败')
    }
  }

  const onImportCustomers = async (file) => {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/import/customers', {
        method: 'POST',
        headers: {
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '导入失败')
      setCustomerImportResult(data)
      if (data.errors?.length) {
        showError(`客户导入有 ${data.errors.length} 条错误`)
      }
      showMessage('客户导入完成')
      refreshCustomers()
    } catch (err) {
      showError(err.message || '客户导入失败')
    }
  }

  const onImportContacts = async (file) => {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/import/contacts', {
        method: 'POST',
        headers: {
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '导入失败')
      setContactImportResult(data)
      if (data.errors?.length) {
        showError(`联系人导入有 ${data.errors.length} 条错误`)
      }
      showMessage('联系人导入完成')
      refreshContacts()
    } catch (err) {
      showError(err.message || '联系人导入失败')
    }
  }

  useEffect(() => {
    if (!authToken) return
    api
      .get('/api/auth/me')
      .then((user) => setCurrentUser(user))
      .catch(() => {
        setAuthToken('')
        localStorage.removeItem('authToken')
      })
  }, [authToken])

  useEffect(() => {
    refreshMyMfaSettings()
  }, [authToken])

  useEffect(() => {
    if (authToken) return
    if (mfaState.required) return
    refreshCaptcha()
  }, [authToken, mfaState.required])

  useEffect(() => {
    const onClick = (event) => {
      if (!contactDropdownRef.current) return
      if (!contactDropdownRef.current.contains(event.target)) {
        setContactDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => { if (customerPage > pagedCustomers.total) setCustomerPage(pagedCustomers.total) }, [pagedCustomers.total])
  useEffect(() => { if (contactPage > pagedContacts.total) setContactPage(pagedContacts.total) }, [pagedContacts.total])
  useEffect(() => { if (licensePage > pagedLicenses.total) setLicensePage(pagedLicenses.total) }, [pagedLicenses.total])
  useEffect(() => { if (sendPlanPage > pagedSendPlans.total) setSendPlanPage(pagedSendPlans.total) }, [pagedSendPlans.total])
  useEffect(() => { if (reminderPage > pagedReminderLogs.total) setReminderPage(pagedReminderLogs.total) }, [pagedReminderLogs.total])
  useEffect(() => { if (opsPage > pagedOperationLogs.total) setOpsPage(pagedOperationLogs.total) }, [pagedOperationLogs.total])
  useEffect(() => { if (usersPage > pagedUsers.total) setUsersPage(pagedUsers.total) }, [pagedUsers.total])
  useEffect(() => { if (importJobsPage > pagedImportJobs.total) setImportJobsPage(pagedImportJobs.total) }, [pagedImportJobs.total])

  const calcDaysLeft = (endDate) => {
    if (!endDate) return '-'
    const end = new Date(endDate)
    const now = new Date()
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return Number.isNaN(diff) ? '-' : diff
  }

  const channelLabel = (key) => {
    if (key === 'email') return '邮件'
    if (key === 'sms') return '短信'
    if (key === 'wecom') return '企业微信'
    return key || '-'
  }

  const failureLabel = (code) => {
    if (code === 'CONFIG_MISSING') return '配置缺失'
    if (code === 'INVALID_CONTACT') return '号码/账号无效'
    if (code === 'REJECTED') return '服务拒绝'
    if (code === 'RATE_LIMIT') return '限流/频控'
    if (code === 'UNKNOWN') return '其它'
    return code || '其它'
  }

  const isAdmin = currentUser?.role === 'admin'

  const licenseStats = useMemo(() => {
    const withDays = licenses
      .map((l) => {
        const days = calcDaysLeft(l.end_date)
        return Number.isFinite(days) ? days : null
      })
      .filter((v) => v !== null)
    const overdue = withDays.filter((d) => d < 0).length
    const active = withDays.filter((d) => d >= 0).length
    const due30 = withDays.filter((d) => d >= 0 && d <= 30).length
    const due7 = withDays.filter((d) => d >= 0 && d <= 7).length
    return { overdue, active, due30, due7 }
  }, [licenses])

  const radarData = useMemo(() => {
    const activeTotal = Math.max(1, licenseStats.active)
    const allTotal = Math.max(1, licenseStats.active + licenseStats.overdue)
    const exp30Rate = Math.round((licenseStats.due30 / activeTotal) * 100)
    const exp7Rate = Math.round((licenseStats.due7 / activeTotal) * 100)
    const overdueRate = Math.round((licenseStats.overdue / allTotal) * 100)
    const density = Math.min(100, Math.round((dashboard.totalReminders / activeTotal) * 20))
    const metrics = [
      { label: '成功率', value: Math.min(100, Math.max(0, Number(dashboard.successRate || 0))) },
      { label: '30天到期', value: Math.min(100, exp30Rate) },
      { label: '7天到期', value: Math.min(100, exp7Rate) },
      { label: '逾期占比', value: Math.min(100, overdueRate) },
      { label: '触达密度', value: density },
    ]
    const count = metrics.length
    const cx = 120
    const cy = 120
    const radius = 90
    const points = metrics
      .map((m, idx) => {
        const angle = (Math.PI * 2 * idx) / count - Math.PI / 2
        const r = (Math.min(100, m.value) / 100) * radius
        const x = cx + r * Math.cos(angle)
        const y = cy + r * Math.sin(angle)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
    return { metrics, points, cx, cy, radius }
  }, [licenseStats, dashboard.successRate, dashboard.totalReminders])

  const heatCells = useMemo(() => {
    const trend = Array.isArray(dashboard.trend) ? dashboard.trend : []
    const map = new Map(trend.map((d) => [String(d.day || ''), Number(d.total || 0)]))
    const cells = []
    const now = new Date()
    for (let i = 34; i >= 0; i -= 1) {
      const date = new Date(now)
      date.setDate(now.getDate() - i)
      const key = date.toISOString().slice(0, 10)
      const total = map.get(key) || 0
      cells.push({ date: key, total })
    }
    const max = Math.max(1, ...cells.map((c) => c.total))
    return cells.map((c) => {
      const ratio = c.total / max
      const level = ratio <= 0 ? 0 : Math.min(4, Math.ceil(ratio * 4))
      return { ...c, level }
    })
  }, [dashboard.trend])

  const maskPhone = (value) => {
    if (!value) return '-'
    const s = String(value)
    if (s.length <= 4) return s
    if (s.length <= 7) return `${s.slice(0, 1)}***${s.slice(-1)}`
    return `${s.slice(0, 3)}****${s.slice(-4)}`
  }

  const maskEmail = (value) => {
    if (!value) return '-'
    const s = String(value)
    const at = s.indexOf('@')
    if (at === -1) return `${s.slice(0, 1)}***`
    const local = s.slice(0, at)
    const domain = s.slice(at + 1)
    if (!local) return `***@${domain}`
    if (local.length === 1) return `${local}***@${domain}`
    if (local.length === 2) return `${local[0]}***@${domain}`
    return `${local[0]}***${local.slice(-1)}@${domain}`
  }

  const maskWecom = (value) => {
    if (!value) return '-'
    const s = String(value)
    if (s.length <= 3) return '*'.repeat(s.length)
    if (s.length <= 5) return `${s[0]}***${s.slice(-1)}`
    return `${s.slice(0, 2)}***${s.slice(-2)}`
  }

  const actionLabel = (action) => {
    const map = {
      LOGIN: '登录',
      LOGOUT: '登出',
      LOGIN_FAILED: '登录失败',
      LOGIN_LOCKED: '登录锁定',
      LOGIN_MFA_REQUIRED: '需要二次验证',
      MFA_SEND: '发送验证码',
      MFA_SEND_FAILED: '验证码发送失败',
      MFA_VERIFY_OK: '验证码校验成功',
      MFA_VERIFY_FAILED: '验证码校验失败',
      TOTP_ENABLED: '开启谷歌认证',
      CREATE: '新增',
      UPDATE: '更新',
      DELETE: '删除',
      IMPORT: '导入',
      CHANGE_PASSWORD: '修改密码',
      RESET_PASSWORD: '重置密码',
    }
    return map[action] || action || '-'
  }

  const entityLabel = (entity) => {
    const map = {
      auth: '认证/登录',
      user: '用户',
      customer: '客户',
      contact: '联系人',
      license: '授权',
      send_plan: '发送计划',
      send_configs: '发送配置',
    }
    return map[entity] || entity || '-'
  }

  const prettyJson = (value) => {
    if (!value) return ''
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)
    } catch (err) {
      return String(value)
    }
  }

  const dashboardLicenseView = useMemo(() => {
    const filtered = licenses.filter((l) => {
      if (dashboardFilters.customer_id && String(l.customer_id) !== String(dashboardFilters.customer_id)) {
        return false
      }
      if (dashboardFilters.sales) {
        const customer = customerMap.get(String(l.customer_id))
        if (!customer) return false
        return customer.juxin_sales === dashboardFilters.sales || customer.channel_sales === dashboardFilters.sales
      }
      return true
    })
    const withDays = filtered
      .map((l) => {
        const daysLeftRaw = calcDaysLeft(l.end_date)
        const daysLeft = typeof daysLeftRaw === 'number' ? daysLeftRaw : Number(daysLeftRaw)
        return { ...l, days_left: daysLeft }
      })
      .filter((l) => Number.isFinite(l.days_left))
      .sort((a, b) => a.days_left - b.days_left)

    const upcoming = withDays.filter((l) => l.days_left >= 0 && l.days_left <= 30).slice(0, 10)
    const expired = withDays
      .filter((l) => l.days_left < 0 && l.days_left >= -30)
      .slice(0, 10)

    return { upcoming, expired }
  }, [licenses, dashboardFilters, customerMap])

  const donutStyle = useMemo(() => {
    const cb = dashboard.channelBreakdown || {}
    const items = [
      { key: 'email', color: '#3b82f6', total: Number(cb.email?.total || 0) },
      { key: 'wecom', color: '#10b981', total: Number(cb.wecom?.total || 0) },
      { key: 'sms', color: '#f59e0b', total: Number(cb.sms?.total || 0) },
    ].filter((x) => x.total > 0)
    const total = items.reduce((acc, x) => acc + x.total, 0)
    if (total <= 0) {
      return { background: 'conic-gradient(from 220deg, rgba(148,163,184,0.35), rgba(148,163,184,0.1))' }
    }
    let acc = 0
    const parts = items.map((x) => {
      const start = (acc / total) * 360
      acc += x.total
      const end = (acc / total) * 360
      return `${x.color} ${start}deg ${end}deg`
    })
    return { background: `conic-gradient(from 220deg, ${parts.join(', ')})` }
  }, [dashboard.channelBreakdown])

  const sparkline = useMemo(() => {
    const series = Array.isArray(dashboard.trend) ? dashboard.trend : []
    if (!series.length) return { points: '', max: 0 }
    const rates = series.map((d) => {
      const total = Number(d.total || 0)
      const success = Number(d.success || 0)
      if (total <= 0) return 0
      return Math.round((success / total) * 100)
    })
    const max = Math.max(1, ...rates)
    const w = 320
    const h = 90
    const pad = 8
    const step = series.length <= 1 ? 0 : (w - pad * 2) / (series.length - 1)
    const pts = rates
      .map((v, idx) => {
        const x = pad + idx * step
        const y = h - pad - (v / max) * (h - pad * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
    return { points: pts, max }
  }, [dashboard.trend])

  if (!authToken) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div>
            <h1 className="brand-title"><span className="brand-red">聚信</span><span className="brand-blue">授权到期提醒系统</span></h1>
            <h1>欢迎登录</h1>
            <p className="sub">请使用管理员账号进入系统。</p>
          </div>
          {!mfaState.required ? (
            <form className="login-form" onSubmit={onLogin}>
              <label className="form-label">
                账号
                <input
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                  placeholder="admin"
                  required
                  className="form-control"
                />
              </label>
              <label className="form-label">
                密码
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  placeholder="123456"
                  required
                  className="form-control"
                />
              </label>
              {captchaState.enabled && (
                <div className="captcha-row">
                  <label className="form-label">
                    验证码
                    <input
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value)}
                      placeholder="请输入验证码"
                      required
                      className="form-control"
                    />
                  </label>
                  <div className="captcha-box">
                    {captchaState.svg && (
                      <img
                        className="captcha-img"
                        alt="captcha"
                        src={`data:image/svg+xml;utf8,${encodeURIComponent(captchaState.svg)}`}
                        onClick={refreshCaptcha}
                      />
                    )}
                    <button type="button" className="ghost btn btn-outline-secondary" onClick={refreshCaptcha}>
                      刷新
                    </button>
                  </div>
                </div>
              )}
              <button type="submit" className="primary btn btn-primary">
                登录
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={onMfaVerify}>
              <div className="muted">管理员二次验证已开启，请完成验证。</div>
              <label className="form-label">
                验证方式
                <select
                  className="form-select"
                  value={mfaState.method}
                  onChange={(e) => setMfaState({ ...mfaState, method: e.target.value })}
                >
                  {mfaState.methods.map((m) => (
                    <option key={m} value={m}>
                      {m === 'email' ? '邮箱' : m === 'sms' ? '短信' : m === 'wecom' ? '企业微信' : '谷歌认证'}
                    </option>
                  ))}
                </select>
              </label>
              {mfaState.method !== 'totp' && (
                <button type="button" className="ghost btn btn-outline-secondary" onClick={onMfaSend}>
                  发送验证码
                </button>
              )}
              <label className="form-label">
                验证码
                <input
                  value={mfaState.code}
                  onChange={(e) => setMfaState({ ...mfaState, code: e.target.value })}
                  placeholder="6位验证码"
                  required
                  className="form-control"
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary btn btn-primary">
                  验证并登录
                </button>
                <button
                  type="button"
                  className="ghost btn btn-outline-secondary"
                  onClick={() => setMfaState({ required: false, token: '', methods: [], method: '', code: '' })}
                >
                  返回
                </button>
              </div>
            </form>
          )}
        </div>
        {loginError && (
          <div className="modal-backdrop" onClick={() => setLoginError('')}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">登录提示</div>
              <div className="modal-body">{loginError}</div>
              <div className="modal-actions">
                <button className="primary btn btn-primary" type="button" onClick={() => setLoginError('')}>
                  知道了
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">授权到期提醒</p>
          <strong>管理中心</strong>
          {currentUser && (
            <div className="user-pill">
              {currentUser.username} · {currentUser.role}
            </div>
          )}
        </div>
        <nav className="menu">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? 'active' : ''}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <button className="ghost logout" onClick={onLogout}>
          退出登录
        </button>
      </aside>

      <div className="content">
        <header className="hero">
          <div>
            <h1 className="brand-title"><span className="brand-red">聚信</span><span className="brand-blue">授权到期提醒系统</span></h1>
            <h3 className="hero-title">统一管理客户、联系人与发送配置</h3>
            <p className="sub">
              覆盖客户与联系人信息维护，支持邮件、企业微信、短信多渠道提醒。
            </p>
          </div>
          <div className="status">
            <div className="status-card">
              <span>客户数量</span>
              <strong>{customers.length}</strong>
            </div>
            <div className="status-card">
              <span>联系人数量</span>
              <strong>{contacts.length}</strong>
            </div>
          </div>
        </header>

        {message && <div className="toast success">{message}</div>}
        {error && <div className="toast error">{error}</div>}
        {modalInfo && (
          <div className="modal-backdrop" onClick={() => setModalInfo(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">{modalInfo.title}</div>
              <div className="modal-body">{modalInfo.message}</div>
              <div className="modal-actions">
                <button className="primary btn btn-primary" type="button" onClick={() => setModalInfo(null)}>
                  知道了
                </button>
              </div>
            </div>
          </div>
        )}

        <main>
        {activeTab === 'dashboard' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>仪表盘</h2>
                <p>系统概览和统计信息</p>
              </div>
              <div className="panel-actions">
                <select
                  className="form-select dashboard-view-select"
                  value={dashboardView}
                  onChange={(e) => setDashboardView(e.target.value)}
                  title="选择仪表盘方案"
                >
                  <option value="A">方案A：总览</option>
                  <option value="B">方案B：预警</option>
                  <option value="C">方案C：运营</option>
                  <option value="D">方案D：销售</option>
                  <option value="E">方案E：赛博总控</option>
                </select>
                <button className="ghost btn btn-outline-secondary" onClick={refreshDashboard}>
                  刷新
                </button>
              </div>
            </div>
            <div className="filter-row">
              <select
                className="form-select"
                value={dashboardFilters.customer_id}
                onChange={(e) => setDashboardFilters({ ...dashboardFilters, customer_id: e.target.value })}
              >
                <option value="">全部客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                value={dashboardFilters.sales}
                onChange={(e) => setDashboardFilters({ ...dashboardFilters, sales: e.target.value })}
              >
                <option value="">全部销售</option>
                {salesOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                value={dashboardFilters.channel}
                onChange={(e) => setDashboardFilters({ ...dashboardFilters, channel: e.target.value })}
              >
                <option value="">全部渠道</option>
                <option value="email">邮件</option>
                <option value="wecom">企业微信</option>
                <option value="sms">短信</option>
              </select>
              <button
                className="ghost btn btn-outline-secondary"
                onClick={() => setDashboardFilters({ customer_id: '', sales: '', channel: '' })}
              >
                清空筛选
              </button>
            </div>
            <div className="stats-grid">
              <div className="stats-card">
                <div className="stats-value">{dashboard.expiring}</div>
                <div className="stats-label">即将到期</div>
              </div>
              <div className="stats-card">
                <div className="stats-value">{dashboard.todayDue}</div>
                <div className="stats-label">今日到期</div>
              </div>
              <div className="stats-card">
                <div className="stats-value">{dashboard.totalReminders}</div>
                <div className="stats-label">总提醒数</div>
              </div>
              <div className="stats-card">
                <div className="stats-value">{dashboard.successRate}%</div>
                <div className="stats-label">成功率</div>
              </div>
            </div>
            <div className="dash-layout">
              {dashboardView === 'A' && (
                <>
                  <div className="dash-grid">
                    <div className="chart-card tone-dash-a">
                      <div className="chart-title">发送渠道分布（近30天）</div>
                      <div className="donut-wrap">
                        <div className="donut" style={donutStyle}>
                          <div className="donut-hole">
                            <div className="donut-number">{dashboard.totalReminders}</div>
                            <div className="muted">提醒次数</div>
                          </div>
                        </div>
                        <div className="donut-legend">
                          {['email', 'wecom', 'sms'].map((k) => {
                            const total = Number(dashboard.channelBreakdown?.[k]?.total || 0)
                            const success = Number(dashboard.channelBreakdown?.[k]?.success || 0)
                            return (
                              <div key={k} className="legend-row">
                                <span className={`dot dot-${k}`} />
                                <span className="legend-name">{channelLabel(k)}</span>
                                <span className="legend-val">
                                  {total} / 成功 {success}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="chart-card tone-dash-b">
                      <div className="chart-title">成功率趋势（近30天）</div>
                      <div className="sparkline-wrap">
                        {sparkline.points ? (
                          <svg viewBox="0 0 320 90" className="sparkline" aria-label="success trend">
                            <polyline points={sparkline.points} fill="none" stroke="url(#grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            <defs>
                              <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0" stopColor="#3b82f6" />
                                <stop offset="1" stopColor="#10b981" />
                              </linearGradient>
                            </defs>
                          </svg>
                        ) : (
                          <div className="muted">暂无趋势数据</div>
                        )}
                        <div className="sparkline-meta">
                          <div className="big">{dashboard.successRate}%</div>
                          <div className="muted">当前成功率</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="upcoming-list">
                    <div className="upcoming-header">即将到期授权（30天内）</div>
                    <div className="upcoming-table">
                      <div className="upcoming-row head">
                        <span>客户</span>
                        <span>授权</span>
                        <span>到期日期</span>
                        <span>剩余天数</span>
                      </div>
                      {dashboardLicenseView.upcoming.map((l) => (
                        <div className="upcoming-row" key={l.id}>
                          <span>{l.customer_name}</span>
                          <span>{l.name}</span>
                          <span>{l.end_date}</span>
                          <span>{l.days_left}</span>
                        </div>
                      ))}
                      {dashboardLicenseView.upcoming.length === 0 && <div className="upcoming-empty">暂无即将到期授权</div>}
                    </div>
                  </div>
                </>
              )}

              {dashboardView === 'B' && (
                <>
                  <div className="dash-grid">
                    <div className="chart-card tone-dash-c">
                      <div className="chart-title">到期分布（按剩余天数）</div>
                      <div className="bar-list">
                        {(dashboard.expiryBuckets || []).map((b) => (
                          <div key={b.key} className="bar-row">
                            <div className="bar-label">{b.label}</div>
                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{
                                  width: `${Math.round(
                                    (Number(b.count || 0) / Math.max(1, ...(dashboard.expiryBuckets || []).map((x) => Number(x.count || 0)))) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <div className="bar-val">{Number(b.count || 0)}</div>
                          </div>
                        ))}
                        {(dashboard.expiryBuckets || []).length === 0 && <div className="muted">暂无分布数据</div>}
                      </div>
                    </div>
                    <div className="chart-card tone-dash-b">
                      <div className="chart-title">失败原因（近30天）</div>
                      <div className="bar-list">
                        {(dashboard.failureBreakdown || []).slice(0, 8).map((f) => (
                          <div key={f.code} className="bar-row">
                            <div className="bar-label">{failureLabel(f.code)}</div>
                            <div className="bar-track">
                              <div
                                className="bar-fill danger"
                                style={{
                                  width: `${Math.round(
                                    (Number(f.count || 0) / Math.max(1, ...(dashboard.failureBreakdown || []).map((x) => Number(x.count || 0)))) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <div className="bar-val">{Number(f.count || 0)}</div>
                          </div>
                        ))}
                        {(dashboard.failureBreakdown || []).length === 0 && <div className="muted">暂无失败数据</div>}
                      </div>
                    </div>
                  </div>
                  <div className="dash-grid">
                    <div className="upcoming-list">
                      <div className="upcoming-header">即将到期授权（30天内）</div>
                      <div className="upcoming-table">
                        <div className="upcoming-row head">
                          <span>客户</span>
                          <span>授权</span>
                          <span>到期日期</span>
                          <span>剩余天数</span>
                        </div>
                        {dashboardLicenseView.upcoming.map((l) => (
                          <div className="upcoming-row" key={l.id}>
                            <span>{l.customer_name}</span>
                            <span>{l.name}</span>
                            <span>{l.end_date}</span>
                            <span>{l.days_left}</span>
                          </div>
                        ))}
                        {dashboardLicenseView.upcoming.length === 0 && <div className="upcoming-empty">暂无即将到期授权</div>}
                      </div>
                    </div>
                    <div className="upcoming-list">
                      <div className="upcoming-header">已过期授权（近30天）</div>
                      <div className="upcoming-table">
                        <div className="upcoming-row head">
                          <span>客户</span>
                          <span>授权</span>
                          <span>到期日期</span>
                          <span>过期天数</span>
                        </div>
                        {dashboardLicenseView.expired.map((l) => (
                          <div className="upcoming-row" key={l.id}>
                            <span>{l.customer_name}</span>
                            <span>{l.name}</span>
                            <span>{l.end_date}</span>
                            <span>{Math.abs(l.days_left)}</span>
                          </div>
                        ))}
                        {dashboardLicenseView.expired.length === 0 && <div className="upcoming-empty">暂无已过期授权</div>}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {dashboardView === 'C' && (
                <>
                  <div className="dash-grid">
                    <div className="chart-card tone-dash-a">
                      <div className="chart-title">渠道效果（近30天）</div>
                      <div className="bar-list">
                        {['email', 'wecom', 'sms'].map((k) => {
                          const total = Number(dashboard.channelBreakdown?.[k]?.total || 0)
                          const success = Number(dashboard.channelBreakdown?.[k]?.success || 0)
                          const rate = total <= 0 ? 0 : Math.round((success / total) * 100)
                          return (
                            <div key={k} className="bar-row">
                              <div className="bar-label">{channelLabel(k)}</div>
                              <div className="bar-track">
                                <div className={`bar-fill ch-${k}`} style={{ width: `${rate}%` }} />
                              </div>
                              <div className="bar-val">{rate}%</div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="muted">提示：可在顶部筛选“发送渠道”只查看某一种渠道的发送效果。</div>
                    </div>
                    <div className="chart-card tone-dash-b">
                      <div className="chart-title">失败原因 Top</div>
                      <div className="mini-table">
                        {(dashboard.failureBreakdown || []).slice(0, 10).map((f) => (
                          <div key={f.code} className="mini-row">
                            <span>{failureLabel(f.code)}</span>
                            <span className="mini-right">{Number(f.count || 0)}</span>
                          </div>
                        ))}
                        {(dashboard.failureBreakdown || []).length === 0 && <div className="muted">暂无失败数据</div>}
                      </div>
                      <div className="muted">建议：优先处理“配置缺失/号码无效”，能最快提升成功率。</div>
                    </div>
                  </div>
                  <div className="upcoming-list">
                    <div className="upcoming-header">即将到期授权（30天内）</div>
                    <div className="upcoming-table">
                      <div className="upcoming-row head">
                        <span>客户</span>
                        <span>授权</span>
                        <span>到期日期</span>
                        <span>剩余天数</span>
                      </div>
                      {dashboardLicenseView.upcoming.map((l) => (
                        <div className="upcoming-row" key={l.id}>
                          <span>{l.customer_name}</span>
                          <span>{l.name}</span>
                          <span>{l.end_date}</span>
                          <span>{l.days_left}</span>
                        </div>
                      ))}
                      {dashboardLicenseView.upcoming.length === 0 && <div className="upcoming-empty">暂无即将到期授权</div>}
                    </div>
                  </div>
                </>
              )}

              {dashboardView === 'D' && (
                <>
                  <div className="dash-grid">
                    <div className="chart-card tone-dash-c">
                      <div className="chart-title">销售风险榜（30天内到期授权数）</div>
                      <div className="bar-list">
                        {(dashboard.salesTop || []).slice(0, 8).map((s) => (
                          <div key={s.name} className="bar-row">
                            <div className="bar-label">{s.name}</div>
                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{
                                  width: `${Math.round(
                                    (Number(s.count || 0) / Math.max(1, ...(dashboard.salesTop || []).map((x) => Number(x.count || 0)))) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <div className="bar-val">{Number(s.count || 0)}</div>
                          </div>
                        ))}
                        {(dashboard.salesTop || []).length === 0 && <div className="muted">暂无销售榜数据</div>}
                      </div>
                    </div>
                    <div className="chart-card tone-dash-b">
                      <div className="chart-title">客户风险榜（30天内到期授权数）</div>
                      <div className="bar-list">
                        {(dashboard.customerRisk || []).slice(0, 10).map((c) => (
                          <div key={c.name} className="bar-row">
                            <div className="bar-label">{c.name}</div>
                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{
                                  width: `${Math.round(
                                    (Number(c.count || 0) / Math.max(1, ...(dashboard.customerRisk || []).map((x) => Number(x.count || 0)))) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <div className="bar-val">{Number(c.count || 0)}</div>
                          </div>
                        ))}
                        {(dashboard.customerRisk || []).length === 0 && <div className="muted">暂无客户榜数据</div>}
                      </div>
                    </div>
                  </div>
                  <div className="upcoming-list">
                    <div className="upcoming-header">即将到期授权（30天内）</div>
                    <div className="upcoming-table">
                      <div className="upcoming-row head">
                        <span>客户</span>
                        <span>授权</span>
                        <span>到期日期</span>
                        <span>剩余天数</span>
                      </div>
                      {dashboardLicenseView.upcoming.map((l) => (
                        <div className="upcoming-row" key={l.id}>
                          <span>{l.customer_name}</span>
                          <span>{l.name}</span>
                          <span>{l.end_date}</span>
                          <span>{l.days_left}</span>
                        </div>
                      ))}
                      {dashboardLicenseView.upcoming.length === 0 && <div className="upcoming-empty">暂无即将到期授权</div>}
                    </div>
                  </div>
                </>
              )}
              {dashboardView === 'E' && (
                <div className="dash-view dash-view-e">
                  <div className="dash-grid">
                    <div className="chart-card cyber-card">
                      <div className="chart-title">发送渠道环形</div>
                      <div className="donut-wrap cyber-donut-wrap">
                        <div className="donut cyber-donut" style={donutStyle}>
                          <div className="donut-hole">
                            <div className="donut-number">{dashboard.totalReminders}</div>
                            <div className="muted">近30天</div>
                          </div>
                        </div>
                        <div className="donut-legend">
                          {['email', 'wecom', 'sms'].map((k) => {
                            const total = Number(dashboard.channelBreakdown?.[k]?.total || 0)
                            const success = Number(dashboard.channelBreakdown?.[k]?.success || 0)
                            return (
                              <div key={k} className="legend-row">
                                <span className={`dot dot-${k}`} />
                                <span className="legend-name">{channelLabel(k)}</span>
                                <span className="legend-val">
                                  {total} / 成功 {success}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="chart-card cyber-card">
                      <div className="chart-title">稳定性雷达</div>
                      <div className="radar-wrap">
                        <svg viewBox="0 0 240 240" className="radar">
                          <circle cx={radarData.cx} cy={radarData.cy} r={radarData.radius} fill="none" stroke="rgba(148,163,184,0.25)" />
                          <circle cx={radarData.cx} cy={radarData.cy} r={radarData.radius * 0.66} fill="none" stroke="rgba(148,163,184,0.18)" />
                          <circle cx={radarData.cx} cy={radarData.cy} r={radarData.radius * 0.33} fill="none" stroke="rgba(148,163,184,0.12)" />
                          <polygon points={radarData.points} fill="rgba(56,189,248,0.2)" stroke="rgba(34,211,238,0.9)" strokeWidth="2" />
                        </svg>
                        <div className="radar-legend">
                          {radarData.metrics.map((m) => (
                            <div key={m.label} className="radar-item">
                              <span>{m.label}</span>
                              <span className="radar-value">{m.value}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="muted">指标来自当前筛选范围的数据估算。</div>
                    </div>
                  </div>
                  <div className="chart-card cyber-card">
                    <div className="chart-title">发送热力日历（35天）</div>
                    <div className="heat-grid">
                      {heatCells.map((c) => (
                        <div
                          key={c.date}
                          className={`heat-cell heat-${c.level}`}
                          title={`${c.date} 发送 ${c.total}`}
                        />
                      ))}
                    </div>
                    <div className="heat-legend">
                      <span className="muted">低</span>
                      <span className="heat-dot heat-1" />
                      <span className="heat-dot heat-2" />
                      <span className="heat-dot heat-3" />
                      <span className="heat-dot heat-4" />
                      <span className="muted">高</span>
                    </div>
                  </div>
                  <div className="upcoming-list cyber-list">
                    <div className="upcoming-header">即将到期授权（30天内）</div>
                    <div className="upcoming-table">
                      <div className="upcoming-row head">
                        <span>客户</span>
                        <span>授权</span>
                        <span>到期日期</span>
                        <span>剩余天数</span>
                      </div>
                      {dashboardLicenseView.upcoming.map((l) => (
                        <div className="upcoming-row" key={l.id}>
                          <span>{l.customer_name}</span>
                          <span>{l.name}</span>
                          <span>{l.end_date}</span>
                          <span>{l.days_left}</span>
                        </div>
                      ))}
                      {dashboardLicenseView.upcoming.length === 0 && <div className="upcoming-empty">暂无即将到期授权</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            
          </section>
        )}
        {activeTab === 'customers' && (
          <section className="panel">
            <div className="panel-header">
              <h2>客户管理</h2>
              <p>配置客户名称、聚信销售、渠道销售信息。</p>
            </div>
            <div className="import-row">
              <label className="import-btn">
                批量导入（CSV/XLSX）
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => onImportCustomers(e.target.files?.[0])}
                />
              </label>
              {customerImportResult && (
                <span className="muted">
                  导入：{customerImportResult.created} 成功 / {customerImportResult.skipped} 跳过
                </span>
              )}
            </div>
            {customerImportResult?.errors?.length > 0 && (
              <div className="import-errors">
                <div className="import-errors-title">导入错误明细</div>
                {customerImportResult.errors.slice(0, 10).map((err, idx) => (
                  <div key={idx} className="import-errors-item">
                    行 {err.row}：{err.reason}
                  </div>
                ))}
                {customerImportResult.errors.length > 10 && (
                  <div className="muted">仅展示前 10 条错误</div>
                )}
              </div>
            )}
            <div className="filter-row">
              <input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="搜索客户名称"
                className="form-control"
              />
            </div>
            {permissions.canWrite && (
              <form className="form-grid inline-actions" onSubmit={onSaveCustomer}>
              <label className="form-label">
                客户名称
                <input
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  placeholder="例如：杭州云栖科技"
                  required
                  className="form-control"
                />
              </label>
              <label className="form-label">
                聚信销售
                <input
                  value={customerForm.juxin_sales}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, juxin_sales: e.target.value })
                  }
                  placeholder="销售人员"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                渠道销售
                <input
                  value={customerForm.channel_sales}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, channel_sales: e.target.value })
                  }
                  placeholder="渠道人员"
                  className="form-control"
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary btn btn-primary">
                  {customerForm.id ? '更新客户' : '新增客户'}
                </button>
                <button
                  type="button"
                  className="ghost btn btn-outline-secondary"
                  onClick={() => setCustomerForm(emptyCustomer)}
                >
                  清空
                </button>
              </div>
            </form>
            )}

            <div className="table">
              <div className="table-row head">
                <span>客户名称</span>
                <span>聚信销售</span>
                <span>渠道销售</span>
                <span>操作</span>
              </div>
              {pagedCustomers.items.map((c) => (
                <div className="table-row" key={c.id}>
                  <span>{c.name}</span>
                  <span>{c.juxin_sales || '-'}</span>
                  <span>{c.channel_sales || '-'}</span>
                  <span className="actions">
                    {permissions.canWrite && (
                      <button onClick={() => onEditCustomer(c)}>编辑</button>
                    )}
                    {permissions.canDelete && (
                      <button className="danger btn btn-outline-danger btn-sm" onClick={() => onDeleteCustomer(c.id)}>
                        删除
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
              <div className="pagination">
                <button className="ghost btn btn-outline-secondary" disabled={pagedCustomers.current === 1} onClick={() => setCustomerPage(pagedCustomers.current - 1)}>上一页</button>
                <span>第 {pagedCustomers.current} / {pagedCustomers.total} 页</span>
                <button className="ghost btn btn-outline-secondary" disabled={pagedCustomers.current === pagedCustomers.total} onClick={() => setCustomerPage(pagedCustomers.current + 1)}>下一页</button>
              </div>

          </section>
        )}

        {activeTab === 'contacts' && (
          <section className="panel">
            <div className="panel-header">
              <h2>联系人管理</h2>
              <p>配置联系人及对应客户信息，支持下拉选择与联想。</p>
            </div>
            <div className="import-row">
              <label className="import-btn">
                批量导入（CSV/XLSX）
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => onImportContacts(e.target.files?.[0])}
                />
              </label>
              {contactImportResult && (
                <span className="muted">
                  导入：{contactImportResult.created} 成功 / {contactImportResult.skipped} 跳过
                </span>
              )}
            </div>
            {contactImportResult?.errors?.length > 0 && (
              <div className="import-errors">
                <div className="import-errors-title">导入错误明细</div>
                {contactImportResult.errors.slice(0, 10).map((err, idx) => (
                  <div key={idx} className="import-errors-item">
                    行 {err.row}：{err.reason}
                  </div>
                ))}
                {contactImportResult.errors.length > 10 && (
                  <div className="muted">仅展示前 10 条错误</div>
                )}
              </div>
            )}
            <div className="filter-row">
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="搜索联系人/电话/邮箱"
                className="form-control"
              />
              <select
                className="form-select"
                value={contactCustomerFilter}
                onChange={(e) => setContactCustomerFilter(e.target.value)}
              >
                <option value="">全部客户</option>
                {pagedCustomers.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                value={contactStatusFilter}
                onChange={(e) => setContactStatusFilter(e.target.value)}
              >
                <option value="">全部状态</option>
                <option value="1">启用</option>
                <option value="0">禁用</option>
              </select>
            </div>
            {permissions.canWrite && (
              <form className="form-grid" onSubmit={onSaveContact}>
              <label className="form-label">
                联系人
                <input
                  value={contactForm.name}
                  onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  placeholder="联系人姓名"
                  required
                  className="form-control"
                />
              </label>
              <label className="form-label">
                客户名称（下拉/联想）
                <input
                  list="customer-suggestions"
                  placeholder="请选择或输入客户名称"
                  value={customerMap.get(String(contactForm.customer_id))?.name || ''}
                  onChange={(e) => {
                    const value = e.target.value
                    const match = customers.find((c) => c.name === value)
                    setContactForm({
                      ...contactForm,
                      customer_id: match ? String(match.id) : '',
                    })
                  }}
                  required
                  className="form-control"
                />
                <datalist id="customer-suggestions">
                  {pagedCustomers.items.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </label>
              <label className="form-label">
                客户电话
                <input
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  placeholder="手机号或座机"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                客户邮箱
                <input
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  placeholder="邮箱地址"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                企业微信号
                <input
                  value={contactForm.wecom_id}
                  onChange={(e) => setContactForm({ ...contactForm, wecom_id: e.target.value })}
                  placeholder="企业微信UserID"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                联系人状态
                <select
                  className="form-select"
                  value={contactForm.is_active ? '1' : '0'}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, is_active: e.target.value === '1' })
                  }
                >
                  <option value="1">启用</option>
                  <option value="0">禁用</option>
                </select>
              </label>
              <div className="form-actions">
                <button type="submit" className="primary btn btn-primary">
                  {contactForm.id ? '更新联系人' : '新增联系人'}
                </button>
                <button
                  type="button"
                  className="ghost btn btn-outline-secondary"
                  onClick={() => setContactForm(emptyContact)}
                >
                  清空
                </button>
              </div>
            </form>
            )}

            <div className="table contacts-table">
              <div className="table-row head">
                <span>联系人</span>
                <span>客户名称</span>
                <span>电话</span>
                <span>邮箱</span>
                <span>企业微信</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {pagedContacts.items.map((c) => (
                <div className="table-row" key={c.id}>
                  <span>{c.name}</span>
                  <span>{c.customer_name}</span>
                  <span>{isAdmin ? (c.phone || '-') : maskPhone(c.phone)}</span>
                  <span>{isAdmin ? (c.email || '-') : maskEmail(c.email)}</span>
                  <span>{isAdmin ? (c.wecom_id || '-') : maskWecom(c.wecom_id)}</span>
                  <span>{c.is_active === 0 ? '禁用' : '启用'}</span>
                  <span className="actions">
                    {permissions.canWrite && (
                      <button onClick={() => onEditContact(c)}>编辑</button>
                    )}
                    {permissions.canDelete && (
                      <button className="danger btn btn-outline-danger btn-sm" onClick={() => onDeleteContact(c.id)}>
                        删除
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
              <div className="pagination">
                <button className="ghost btn btn-outline-secondary" disabled={pagedContacts.current === 1} onClick={() => setContactPage(pagedContacts.current - 1)}>上一页</button>
                <span>第 {pagedContacts.current} / {pagedContacts.total} 页</span>
                <button className="ghost btn btn-outline-secondary" disabled={pagedContacts.current === pagedContacts.total} onClick={() => setContactPage(pagedContacts.current + 1)}>下一页</button>
              </div>

          </section>
        )}

        {activeTab === 'licenses' && (
          <section className="panel">
            <div className="panel-header">
              <h2>授权管理</h2>
              <p>维护授权到期信息，支持提醒与筛选。</p>
            </div>
            <div className="filter-row">
              <input
                value={licenseSearch}
                onChange={(e) => setLicenseSearch(e.target.value)}
                placeholder="搜索授权名称/客户"
                className="form-control"
              />
              <select
                className="form-select"
                value={licenseQuickFilter}
                onChange={(e) => setLicenseQuickFilter(e.target.value)}
              >
                <option value="">全部</option>
                <option value="expiring">即将到期</option>
                <option value="expired">已过期</option>
              </select>
              {licenseQuickFilter === 'expiring' && (
                <input
                  value={licenseExpiringDays}
                  onChange={(e) => setLicenseExpiringDays(e.target.value)}
                  placeholder="到期天数"
                  className="form-control"
                />
              )}
              <select
                className="form-select"
                value={licenseCustomerFilter}
                onChange={(e) => setLicenseCustomerFilter(e.target.value)}
              >
                <option value="">全部客户</option>
                {pagedCustomers.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                value={licenseStatusFilter}
                onChange={(e) => setLicenseStatusFilter(e.target.value)}
              >
                <option value="">全部状态</option>
                <option value="ACTIVE">有效</option>
                <option value="EXPIRED">已过期</option>
              </select>
            </div>
            {permissions.canWrite && (
              <form className="form-grid" onSubmit={onSaveLicense}>
              <label className="form-label">
                授权名称
                <input
                  value={licenseForm.name}
                  onChange={(e) => setLicenseForm({ ...licenseForm, name: e.target.value })}
                  placeholder="例如：数据接口服务"
                  required
                  className="form-control"
                />
              </label>
              <label className="form-label">
                客户名称
                <select
                  className="form-select"
                  value={licenseForm.customer_id}
                  onChange={(e) =>
                    setLicenseForm({ ...licenseForm, customer_id: e.target.value })
                  }
                  required
                >
                  <option value="">请选择客户</option>
                  {pagedCustomers.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                开始日期
                <input
                  type="date"
                  value={licenseForm.start_date}
                  onChange={(e) =>
                    setLicenseForm({ ...licenseForm, start_date: e.target.value })
                  }
                  className="form-control"
                />
              </label>
              <label className="form-label">
                到期日期
                <input
                  type="date"
                  value={licenseForm.end_date}
                  onChange={(e) =>
                    setLicenseForm({ ...licenseForm, end_date: e.target.value })
                  }
                  required
                  className="form-control"
                />
              </label>
              <label className="form-label">
                状态
                <select
                  className="form-select"
                  value={licenseForm.status}
                  onChange={(e) => setLicenseForm({ ...licenseForm, status: e.target.value })}
                >
                  <option value="ACTIVE">有效</option>
                  <option value="EXPIRED">已过期</option>
                </select>
              </label>
              <label className="form-label">
                备注
                <input
                  value={licenseForm.note}
                  onChange={(e) => setLicenseForm({ ...licenseForm, note: e.target.value })}
                  placeholder="可选说明"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                提醒天数（逗号分隔）
                <input
                  value={licenseForm.reminder_days}
                  onChange={(e) =>
                    setLicenseForm({ ...licenseForm, reminder_days: e.target.value })
                  }
                  placeholder="留空使用全局配置"
                  className="form-control"
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary btn btn-primary">
                  {licenseForm.id ? '更新授权' : '新增授权'}
                </button>
                <button
                  type="button"
                  className="ghost btn btn-outline-secondary"
                  onClick={() => setLicenseForm(emptyLicense)}
                >
                  清空
                </button>
              </div>
            </form>
            )}

            <div className="table license-table">
              <div className="table-row head">
                <span>授权名称</span>
                <span>客户</span>
                <span>开始日期</span>
                <span>到期日期</span>
                <span>剩余天数</span>
                <span>提醒天数</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {pagedLicenses.items.map((l) => (
                <div className="table-row" key={l.id}>
                  <span>{l.name}</span>
                  <span>{l.customer_name}</span>
                  <span>{l.start_date || '-'}</span>
                  <span>{l.end_date}</span>
                  <span>{calcDaysLeft(l.end_date)}</span>
                  <span>{l.reminder_days || '-'}</span>
                  <span>{l.status === 'ACTIVE' ? '有效' : '已过期'}</span>
                  <span className="actions">
                    {permissions.canWrite && (
                      <button onClick={() => onEditLicense(l)}>编辑</button>
                    )}
                    {permissions.canDelete && (
                      <button className="danger btn btn-outline-danger btn-sm" onClick={() => onDeleteLicense(l.id)}>
                        删除
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
              <div className="pagination">
                <button className="ghost btn btn-outline-secondary" disabled={pagedLicenses.current === 1} onClick={() => setLicensePage(pagedLicenses.current - 1)}>上一页</button>
                <span>第 {pagedLicenses.current} / {pagedLicenses.total} 页</span>
                <button className="ghost btn btn-outline-secondary" disabled={pagedLicenses.current === pagedLicenses.total} onClick={() => setLicensePage(pagedLicenses.current + 1)}>下一页</button>
              </div>

          </section>
        )}

        {activeTab === 'send' && (
          <section className="panel">
            <div className="panel-header">
              <h2>发送页面</h2>
              <p>创建自动提醒计划或手动发送。</p>
            </div>
            <div className="panel-block">
              <h3>自动提醒计划</h3>
              <form className="form-grid" onSubmit={onSaveSendPlan}>
                <label className="form-label">
                  计划名称
                  <input
                    value={sendPlanForm.name}
                    onChange={(e) =>
                      setSendPlanForm({ ...sendPlanForm, name: e.target.value })
                    }
                    placeholder="例如：主服务到期提醒"
                    required
                    className="form-control"
                  />
                </label>
                <label className="form-label">
                  计划状态
                  <select
                    className="form-select"
                    value={sendPlanForm.enabled ? '1' : '0'}
                    onChange={(e) =>
                      setSendPlanForm({ ...sendPlanForm, enabled: e.target.value === '1' })
                    }
                  >
                    <option value="1">启用</option>
                    <option value="0">停用</option>
                  </select>
                </label>
                <label className="form-label">
                  授权
                  <select
                    className="form-select"
                    value={sendPlanForm.license_id}
                    onChange={(e) =>
                      setSendPlanForm({ ...sendPlanForm, license_id: e.target.value })
                    }
                    required
                  >
                    <option value="">请选择授权</option>
                    {pagedLicenses.items.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.customer_name} / {l.name} / {l.end_date}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  提醒天数（逗号分隔）
                  <input
                    value={sendPlanForm.days}
                    onChange={(e) =>
                      setSendPlanForm({ ...sendPlanForm, days: e.target.value })
                    }
                    placeholder="60,30,20"
                    required
                    className="form-control"
                  />
                </label>
                <label className="form-label">
                  生效日期
                  <input
                    type="date"
                    value={sendPlanForm.start_date}
                    onChange={(e) =>
                      setSendPlanForm({ ...sendPlanForm, start_date: e.target.value })
                    }
                    className="form-control"
                  />
                </label>
                <label className="form-label">
                  失效日期
                  <input
                    type="date"
                    value={sendPlanForm.end_date}
                    onChange={(e) =>
                      setSendPlanForm({ ...sendPlanForm, end_date: e.target.value })
                    }
                    className="form-control"
                  />
                </label>
                <label className="form-label">
                  发送渠道
                  <div className="channel-row">
                    {['email', 'wecom', 'sms'].map((channel) => (
                      <label key={channel}>
                        <input
                          type="checkbox"
                          checked={sendPlanForm.channels.includes(channel)}
                          onChange={(e) => {
                            const channels = sendPlanForm.channels
                            setSendPlanForm({
                              ...sendPlanForm,
                              channels: e.target.checked
                                ? [...channels, channel]
                                : channels.filter((c) => c !== channel),
                            })
                          }}
                        />
                        {channel === 'email' ? '邮件' : channel === 'wecom' ? '企业微信' : '短信'}
                      </label>
                    ))}
                  </div>
                </label>
                <label className="form-label full-row">
                  联系人选择
                  <div className="filter-row contact-select-row">
                    <input
                      value={planContactSearch}
                      onChange={(e) => setPlanContactSearch(e.target.value)}
                      placeholder="搜索联系人/客户"
                      className="form-control"
                    />
                    <select
                      className="form-select"
                      value={planCustomerFilter}
                      onChange={(e) => setPlanCustomerFilter(e.target.value)}
                    >
                      <option value="">全部客户</option>
                      {pagedCustomers.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ghost btn btn-outline-secondary"
                      onClick={() =>
                        setSendPlanForm({
                          ...sendPlanForm,
                          contact_ids: planContactsView.map((c) => c.id),
                        })
                      }
                    >
                      全选当前筛选
                    </button>
                    <button
                      type="button"
                      className="ghost btn btn-outline-secondary"
                      onClick={() =>
                        setSendPlanForm({
                          ...sendPlanForm,
                          contact_ids: [],
                        })
                      }
                    >
                      清空选择
                    </button>
                  </div>
                  <div className="multi-select" ref={contactDropdownRef}>
                    <button
                      type="button"
                      className="multi-select-trigger"
                      onClick={() => setContactDropdownOpen((v) => !v)}
                    >
                      {sendPlanForm.contact_ids.length === 0
                        ? '请选择联系人'
                        : planContactsView
                            .filter((c) => sendPlanForm.contact_ids.includes(c.id))
                            .map((c) => `${c.customer_name} / ${c.name}`)
                            .join('，')}
                    </button>
                    {contactDropdownOpen && (
                      <div className="multi-select-menu">
                        {planContactsView.map((c) => {
                          const selected = sendPlanForm.contact_ids.includes(c.id)
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className={`multi-select-item ${selected ? 'selected' : ''}`}
                              onClick={() => {
                                const ids = selected
                                  ? sendPlanForm.contact_ids.filter((id) => id !== c.id)
                                  : [...sendPlanForm.contact_ids, c.id]
                                setSendPlanForm({
                                  ...sendPlanForm,
                                  contact_ids: ids,
                                })
                              }}
                            >
                              <span>{c.customer_name} / {c.name}</span>
                              <span className="check">✓</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary btn btn-primary">
                    {sendPlanForm.id ? '更新计划' : '创建计划'}
                  </button>
                  {sendPlanForm.id && (
                    <button
                      type="button"
                      className="ghost btn btn-outline-secondary"
                      onClick={() =>
                        setSendPlanForm({
                          id: null,
                          name: '',
                          license_id: '',
                          contact_ids: [],
                          days: '60,30,20',
                          channels: ['email'],
                          enabled: true,
                          start_date: '',
                          end_date: '',
                        })
                      }
                    >
                      取消编辑
                    </button>
                  )}
                </div>
              </form>
              <div className="table send-table">
                <div className="table-row head">
                  <span>计划名称</span>
                  <span>授权</span>
                  <span>发送渠道</span>
                  <span>提醒天数</span>
                  <span>联系人姓名</span>
                  <span>生效/失效</span>
                  <span>状态</span>
                  <span>操作</span>
                </div>
                {pagedSendPlans.items.map((plan) => (
                  <div className="table-row" key={plan.id}>
                    <span>{plan.name}</span>
                    <span>{plan.license_name}</span>
                    <span>{plan.channels.map((c) => (c === 'email' ? '邮件' : c === 'sms' ? '短信' : '企业微信')).join('，')}</span>
                    <span>{plan.days}</span>
                    <span>
                      {plan.contact_ids.length === 0
                        ? '-'
                        : plan.contact_ids
                            .map((id) => contactMap.get(String(id))?.name || String(id))
                            .join('，')}
                    </span>
                    <span>
                      {(plan.start_date || '长期')} / {(plan.end_date || '长期')}
                    </span>
                    <span>{plan.enabled ? '启用' : '停用'}</span>
                    <span className="actions">
                      <button onClick={() => onEditSendPlan(plan)}>编辑</button>
                      <button onClick={() => onTogglePlanEnabled(plan)}>
                        {plan.enabled ? '停用' : '启用'}
                      </button>
                      <button className="danger btn btn-outline-danger btn-sm" onClick={() => onDeleteSendPlan(plan.id)}>
                        删除
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="pagination">
                <button className="ghost btn btn-outline-secondary" disabled={pagedSendPlans.current === 1} onClick={() => setSendPlanPage(pagedSendPlans.current - 1)}>上一页</button>
                <span>第 {pagedSendPlans.current} / {pagedSendPlans.total} 页</span>
                <button className="ghost btn btn-outline-secondary" disabled={pagedSendPlans.current === pagedSendPlans.total} onClick={() => setSendPlanPage(pagedSendPlans.current + 1)}>下一页</button>
              </div>

            </div>
          </section>
        )}

        {activeTab === 'reminders' && (
          <section className="panel">
            <div className="panel-header">
              <h2>提醒记录</h2>
              <p>展示系统自动到期提醒的执行情况。</p>
            </div>
            <div className="filter-row">
              <select
                className="form-select"
                value={reminderFilters.customer_id}
                onChange={(e) =>
                  setReminderFilters({ ...reminderFilters, customer_id: e.target.value })
                }
              >
                <option value="">全部客户</option>
                {pagedCustomers.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                value={reminderFilters.status}
                onChange={(e) =>
                  setReminderFilters({ ...reminderFilters, status: e.target.value })
                }
              >
                <option value="">全部状态</option>
                <option value="SENT">成功</option>
                <option value="FAILED">失败</option>
              </select>
              <select
                className="form-select"
                value={reminderFilters.is_test}
                onChange={(e) =>
                  setReminderFilters({ ...reminderFilters, is_test: e.target.value })
                }
              >
                <option value="">全部类型</option>
                <option value="0">正式</option>
                <option value="1">测试</option>
              </select>
              <select
                className="form-select"
                value={reminderFilters.error_code || ''}
                onChange={(e) =>
                  setReminderFilters({ ...reminderFilters, error_code: e.target.value })
                }
              >
                <option value="">全部错误类型</option>
                <option value="CONFIG_MISSING">配置缺失</option>
                <option value="INVALID_CONTACT">号码无效</option>
                <option value="REJECTED">服务拒绝</option>
                <option value="RATE_LIMIT">限流</option>
                <option value="UNKNOWN">其他</option>
              </select>
              <input
                value={reminderFilters.days_left}
                onChange={(e) =>
                  setReminderFilters({ ...reminderFilters, days_left: e.target.value })
                }
                placeholder="剩余天数"
                className="form-control"
              />
              <input
                type="date"
                value={reminderFilters.date_from}
                onChange={(e) =>
                  setReminderFilters({ ...reminderFilters, date_from: e.target.value })
                }
                className="form-control"
              />
              <input
                type="date"
                value={reminderFilters.date_to}
                onChange={(e) =>
                  setReminderFilters({ ...reminderFilters, date_to: e.target.value })
                }
                className="form-control"
              />
              <button className="ghost btn btn-outline-secondary" onClick={refreshReminderLogs}>
                刷新
              </button>
            </div>
            <div className="table">
              <div className="table-row head">
                <span>联系人</span>
                <span>客户</span>
                <span>授权</span>
                <span>发送渠道</span>
                <span>剩余天数</span>
                <span>状态</span>
                <span>类型</span>
                <span>错误类型</span>
                <span>错误</span>
                <span>操作</span>
                <span>时间</span>
              </div>
              {pagedReminderLogs.items.map((log) => (
                <div className="table-row" key={log.id}>
                  <span>{log.contact_name}</span>
                  <span>{log.customer_name}</span>
                  <span>{log.license_name}</span>
                  <span>{log.channel}</span>
                  <span>{log.days_left}</span>
                  <span>{log.status}</span>
                  <span>{log.is_test ? '测试' : '正式'}</span>
                  <span>{log.error_code || '-'}</span>
                  <span>{log.error || '-'}</span>
                  <span className="actions">
                    <button onClick={() => onResendReminder(log.id)}>重发</button>
                  </span>
                  <span>{log.sent_at}</span>
                </div>
              ))}
            </div>
              <div className="pagination">
                <button className="ghost btn btn-outline-secondary" disabled={pagedReminderLogs.current === 1} onClick={() => setReminderPage(pagedReminderLogs.current - 1)}>上一页</button>
                <span>第 {pagedReminderLogs.current} / {pagedReminderLogs.total} 页</span>
                <button className="ghost btn btn-outline-secondary" disabled={pagedReminderLogs.current === pagedReminderLogs.total} onClick={() => setReminderPage(pagedReminderLogs.current + 1)}>下一页</button>
              </div>

          </section>
        )}

        {activeTab === 'imports' && (
          <section className="panel">
            <div className="panel-header">
              <h2>导入记录中心</h2>
              <p>查看历史导入结果与错误复盘。</p>
              <button className="ghost btn btn-outline-secondary" onClick={refreshImportJobs}>
                刷新
              </button>
            </div>
            <div className="filter-row">
              <select
                className="form-select"
                value={importJobFilters.type}
                onChange={(e) => setImportJobFilters({ ...importJobFilters, type: e.target.value })}
              >
                <option value="">全部类型</option>
                <option value="customers">客户导入</option>
                <option value="contacts">联系人导入</option>
              </select>
              <select
                className="form-select"
                value={importJobFilters.status}
                onChange={(e) => setImportJobFilters({ ...importJobFilters, status: e.target.value })}
              >
                <option value="">全部状态</option>
                <option value="DONE">完成</option>
                <option value="FAILED">失败</option>
              </select>
              <input
                value={importJobFilters.username}
                onChange={(e) => setImportJobFilters({ ...importJobFilters, username: e.target.value })}
                placeholder="用户"
                className="form-control"
              />
              <input
                type="date"
                value={importJobFilters.date_from}
                onChange={(e) => setImportJobFilters({ ...importJobFilters, date_from: e.target.value })}
                className="form-control"
              />
              <input
                type="date"
                value={importJobFilters.date_to}
                onChange={(e) => setImportJobFilters({ ...importJobFilters, date_to: e.target.value })}
                className="form-control"
              />
              <button
                className="ghost btn btn-outline-secondary"
                onClick={() =>
                  setImportJobFilters({ type: '', status: '', username: '', date_from: '', date_to: '' })
                }
              >
                清空筛选
              </button>
            </div>
            <div className="table">
              <div className="table-row head">
                <span>时间</span>
                <span>类型</span>
                <span>文件</span>
                <span>结果</span>
                <span>错误</span>
                <span>用户</span>
                <span>操作</span>
              </div>
              {pagedImportJobs.items.map((job) => (
                <div className="table-row" key={job.id}>
                  <span>{job.created_at}</span>
                  <span>{job.type === 'customers' ? '客户' : '联系人'}</span>
                  <span>{job.filename || '-'}</span>
                  <span>
                    {job.status} · 成功 {job.created} / 跳过 {job.skipped} / 总计 {job.total}
                  </span>
                  <span>{job.error_count || 0}</span>
                  <span>{job.username}</span>
                  <span className="actions">
                    {(job.error_count > 0 || job.error_message) && (
                      <button onClick={() => toggleImportJob(job)}>
                        {expandedImportJob?.id === job.id ? '收起' : '查看'}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="pagination">
              <button
                className="ghost btn btn-outline-secondary"
                disabled={pagedImportJobs.current === 1}
                onClick={() => setImportJobsPage(pagedImportJobs.current - 1)}
              >
                上一页
              </button>
              <span>
                第 {pagedImportJobs.current} / {pagedImportJobs.total} 页
              </span>
              <button
                className="ghost btn btn-outline-secondary"
                disabled={pagedImportJobs.current === pagedImportJobs.total}
                onClick={() => setImportJobsPage(pagedImportJobs.current + 1)}
              >
                下一页
              </button>
            </div>
            {expandedImportJob && (
              <div className="import-errors">
                <div className="import-errors-title">
                  导入详情（ID {expandedImportJob.id}）
                </div>
                {expandedImportJob.error_message && (
                  <div className="import-errors-item">错误：{expandedImportJob.error_message}</div>
                )}
                {Array.isArray(expandedImportJob.errors) && expandedImportJob.errors.length > 0 ? (
                  <>
                    {expandedImportJob.errors.slice(0, 20).map((err, idx) => (
                      <div key={idx} className="import-errors-item">
                        行 {err.row}：{err.reason}
                      </div>
                    ))}
                    {expandedImportJob.errors.length > 20 && (
                      <div className="muted">仅展示前 20 条错误</div>
                    )}
                  </>
                ) : (
                  <div className="muted">无错误明细</div>
                )}
              </div>
            )}
          </section>
        )}

        {activeTab === 'ops' && (
          <section className="panel">
            <div className="panel-header">
              <h2>操作日志</h2>
              <p>记录登录/登出及管理员关键操作。</p>
              <div className="panel-actions">
                <button className="ghost btn btn-outline-secondary" onClick={exportOperationLogs}>
                  导出CSV
                </button>
                <button className="ghost btn btn-outline-secondary" onClick={refreshOperationLogs}>
                  刷新
                </button>
              </div>
            </div>
            <div className="filter-row">
              <input
                value={opsFilters.username}
                onChange={(e) => setOpsFilters({ ...opsFilters, username: e.target.value })}
                placeholder="用户"
                className="form-control"
              />
              <select
                className="form-select"
                value={opsFilters.action}
                onChange={(e) => setOpsFilters({ ...opsFilters, action: e.target.value })}
              >
                <option value="">全部动作</option>
                <option value="LOGIN">登录</option>
                <option value="LOGOUT">登出</option>
                <option value="LOGIN_FAILED">登录失败</option>
                <option value="LOGIN_LOCKED">登录锁定</option>
                <option value="LOGIN_MFA_REQUIRED">需要二次验证</option>
                <option value="MFA_SEND">发送验证码</option>
                <option value="MFA_SEND_FAILED">验证码发送失败</option>
                <option value="MFA_VERIFY_OK">验证码校验成功</option>
                <option value="MFA_VERIFY_FAILED">验证码校验失败</option>
                <option value="TOTP_ENABLED">开启谷歌认证</option>
                <option value="CREATE">新增</option>
                <option value="UPDATE">更新</option>
                <option value="DELETE">删除</option>
                <option value="IMPORT">导入</option>
                <option value="CHANGE_PASSWORD">修改密码</option>
                <option value="RESET_PASSWORD">重置密码</option>
              </select>
              <input
                value={opsFilters.entity}
                onChange={(e) => setOpsFilters({ ...opsFilters, entity: e.target.value })}
                placeholder="对象（如 客户/授权/发送计划）"
                className="form-control"
              />
              <input
                type="date"
                value={opsFilters.date_from}
                onChange={(e) => setOpsFilters({ ...opsFilters, date_from: e.target.value })}
                className="form-control"
              />
              <input
                type="date"
                value={opsFilters.date_to}
                onChange={(e) => setOpsFilters({ ...opsFilters, date_to: e.target.value })}
                className="form-control"
              />
              <button
                className="ghost btn btn-outline-secondary"
                onClick={() => setOpsFilters({ username: '', action: '', entity: '', date_from: '', date_to: '' })}
              >
                清空筛选
              </button>
            </div>
            <div className="table ops-table">
              <div className="table-row head">
                <span>用户</span>
                <span>动作</span>
                <span>对象</span>
                <span>对象ID</span>
                <span>时间</span>
                <span>详情</span>
              </div>
              {pagedOperationLogs.items.map((log) => (
                <div key={log.id}>
                  <div className="table-row">
                    <span>{log.username}</span>
                    <span>{actionLabel(log.action)}</span>
                    <span>{entityLabel(log.entity)}</span>
                    <span>{log.entity_id}</span>
                    <span>{log.created_at}</span>
                    <span className="actions">
                      <button
                        className="ghost btn btn-outline-secondary"
                        onClick={() =>
                          setExpandedOpsLogId(expandedOpsLogId === log.id ? null : log.id)
                        }
                      >
                        {expandedOpsLogId === log.id ? '收起' : '详情'}
                      </button>
                    </span>
                  </div>
                  {expandedOpsLogId === log.id && (
                    <div className="table-row ops-detail">
                      <div className="ops-detail-grid">
                        <div className="ops-detail-card">
                          <div className="ops-detail-title">变更前</div>
                          <pre className="ops-detail-pre">
                            {prettyJson(log.before_data) || '无'}
                          </pre>
                        </div>
                        <div className="ops-detail-card">
                          <div className="ops-detail-title">变更后</div>
                          <pre className="ops-detail-pre">
                            {prettyJson(log.after_data) || '无'}
                          </pre>
                        </div>
                        <div className="ops-detail-card">
                          <div className="ops-detail-title">说明</div>
                          <div className="ops-detail-text">
                            {entityLabel(log.entity)} / {actionLabel(log.action)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
              <div className="pagination">
                <button className="ghost btn btn-outline-secondary" disabled={pagedOperationLogs.current === 1} onClick={() => setOpsPage(pagedOperationLogs.current - 1)}>上一页</button>
                <span>第 {pagedOperationLogs.current} / {pagedOperationLogs.total} 页</span>
                <button className="ghost btn btn-outline-secondary" disabled={pagedOperationLogs.current === pagedOperationLogs.total} onClick={() => setOpsPage(pagedOperationLogs.current + 1)}>下一页</button>
              </div>

          </section>
        )}

        {activeTab === 'account' && (
          <section className="panel">
            <div className="panel-header">
              <h2>账号安全</h2>
              <p>配置当前账号的二次验证与谷歌认证。</p>
            </div>
            <div className="panel-block account-tone-totp">
              <h3>谷歌认证（当前账号）</h3>
              <div className="filter-row">
                <button className="ghost btn btn-outline-secondary" type="button" onClick={onTotpSetup}>
                  生成密钥
                </button>
                {totpSetupInfo && (
                  <button className="primary btn btn-primary" type="button" onClick={onTotpEnable}>
                    启用
                  </button>
                )}
              </div>
              {totpSetupInfo && (
                <div className="import-errors">
                  <div className="import-errors-title">密钥（手动添加到谷歌认证）</div>
                  {totpQr && (
                    <div className="totp-qr">
                      <img src={totpQr} alt="谷歌认证二维码" />
                      <div className="muted">建议扫码导入，避免手动录入。</div>
                    </div>
                  )}
                  <div className="import-errors-item">Secret：{totpSetupInfo.secret}</div>
                  <div className="import-errors-item">otpauth：{totpSetupInfo.otpauth}</div>
                  <label className="form-label">
                    输入6位验证码
                    <input
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      placeholder="例如：123456"
                      className="form-control"
                    />
                  </label>
                  <div className="muted">
                    提示：先在谷歌认证App里添加账号，再输入当前显示的6位验证码完成启用。
                  </div>
                </div>
              )}
            </div>

            <form className="form-grid account-tone-password" onSubmit={onChangePassword}>
              <label className="form-label">
                当前密码
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => {
                    setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                    setPasswordFeedback({ type: '', text: '' })
                  }}
                  required
                  className="form-control"
                />
              </label>
              <label className="form-label">
                新密码
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => {
                    setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                    setPasswordFeedback({ type: '', text: '' })
                  }}
                  required
                  className="form-control"
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary btn btn-primary">
                  修改密码
                </button>
              </div>
              {passwordFeedback.text && (
                <div className={`toast ${passwordFeedback.type} form-feedback full-row`}>
                  {passwordFeedback.text}
                </div>
              )}
            </form>

            <form className="form-grid account-tone-mfa" onSubmit={onSaveMyMfaSettings}>
              <label className="inline-check form-label">
                开启二次验证
                <input
                  type="checkbox"
                  checked={myMfaSettings.enabled}
                  onChange={(e) =>
                    setMyMfaSettings({ ...myMfaSettings, enabled: e.target.checked })
                  }
                />
              </label>
              <div className="form-label full-row">
                验证方式（可多选）
                <div className="channel-row mfa-pill-row">
                  {[
                    { key: 'email', label: '邮箱', ok: myMfaSettings.has_email },
                    { key: 'sms', label: '短信', ok: myMfaSettings.has_phone },
                    { key: 'wecom', label: '企业微信', ok: myMfaSettings.has_wecom },
                    { key: 'totp', label: '谷歌认证', ok: myMfaSettings.totp_enabled },
                  ].map((m) => {
                    const selected = myMfaSettings.methods.includes(m.key)
                    const disabled = !m.ok
                    return (
                      <label key={m.key} className={`mfa-pill ${selected ? 'active' : ''} ${disabled ? 'disabled' : ''}`}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={selected}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...myMfaSettings.methods, m.key]))
                              : myMfaSettings.methods.filter((x) => x !== m.key)
                            setMyMfaSettings({ ...myMfaSettings, methods: next })
                          }}
                        />
                        {m.label}
                        {!m.ok ? '（未配置）' : ''}
                      </label>
                    )
                  })}
                </div>
                <div className="muted">如需启用邮箱/短信/企业微信，请在“用户管理”补充对应信息。</div>
              </div>
              <div className="form-actions">
                <button type="submit" className="primary btn btn-primary">
                  保存二次验证
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === 'users' && (
          <section className="panel">
            <div className="panel-header">
              <h2>用户管理</h2>
              <p>管理系统账号与权限，仅管理员可见。</p>
            </div>
            <form className="form-grid" onSubmit={onSaveUser}>
              <label className="form-label">
                账号
                <input
                  value={userForm.username}
                  onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                  placeholder="用户名"
                  required={!userForm.id}
                  disabled={!!userForm.id}
                  className="form-control"
                />
              </label>
              <label className="form-label">
                邮箱（用于二次验证）
                <input
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  placeholder="例如：xxx@company.com"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                手机号（用于二次验证）
                <input
                  value={userForm.phone}
                  onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                  placeholder="例如：13800000000"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                企业微信UserID（用于二次验证）
                <input
                  value={userForm.wecom_id}
                  onChange={(e) => setUserForm({ ...userForm, wecom_id: e.target.value })}
                  placeholder="例如：zhangsan"
                  className="form-control"
                />
              </label>
              <label className="form-label">
                密码
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder={userForm.id ? '留空则不修改' : '初始密码'}
                  required={!userForm.id}
                  className="form-control"
                />
              </label>
              <label className="form-label">
                角色
                <select
                  className="form-select"
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                >
                  <option value="admin">管理员</option>
                  <option value="sales">销售</option>
                  <option value="viewer">只读</option>
                </select>
              </label>
              <div className="form-actions">
                <button type="submit" className="primary btn btn-primary">
                  {userForm.id ? '更新用户' : '新增用户'}
                </button>
                <button
                  type="button"
                  className="ghost btn btn-outline-secondary"
                  onClick={() =>
                    setUserForm({ id: null, username: '', password: '', role: 'viewer', email: '', phone: '', wecom_id: '' })
                  }
                >
                  清空
                </button>
              </div>
            </form>

            <div className="table">
              <div className="table-row head">
                <span>账号</span>
                <span>角色</span>
                <span>二次验证</span>
                <span>创建时间</span>
                <span>操作</span>
              </div>
              {pagedUsers.items.map((u) => (
                <div className="table-row" key={u.id}>
                  <span>{u.username}</span>
                  <span>{u.role}</span>
                  <span>
                    {(u.email ? '邮箱 ' : '')}
                    {(u.phone ? '短信 ' : '')}
                    {(u.wecom_id ? '企业微信 ' : '')}
                    {u.totp_enabled ? '谷歌认证' : ''}
                    {(!u.email && !u.phone && !u.wecom_id && !u.totp_enabled) ? '-' : ''}
                  </span>
                  <span>{u.created_at}</span>
                  <span className="actions">
                    <button onClick={() => onEditUser(u)}>编辑</button>
                    <button onClick={() => onResetUserPassword(u.id)}>重置密码</button>
                    <button className="danger btn btn-outline-danger btn-sm" onClick={() => onDeleteUser(u.id)}>
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </div>
              <div className="pagination">
                <button className="ghost btn btn-outline-secondary" disabled={pagedUsers.current === 1} onClick={() => setUsersPage(pagedUsers.current - 1)}>上一页</button>
                <span>第 {pagedUsers.current} / {pagedUsers.total} 页</span>
                <button className="ghost btn btn-outline-secondary" disabled={pagedUsers.current === pagedUsers.total} onClick={() => setUsersPage(pagedUsers.current + 1)}>下一页</button>
              </div>

          </section>
        )}

        {activeTab === 'config' && (
          <section className="panel">
            <div className="config-page-title">
              <h2>发送渠道配置</h2>
              <p>配置系统通知与发送渠道。</p>
            </div>
            <form className="config-stack" onSubmit={onSaveConfig}>
              <div className="config-card card-split tone-email">
                <div className="config-card-header">邮箱配置</div>
                <div className="config-card-body">
                  <label className="form-label">
                    SMTP服务器地址
                    <input
                      value={configForm.email.host}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          email: { ...configForm.email, host: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    SMTP端口
                    <input
                      value={configForm.email.port}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          email: { ...configForm.email, port: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    发件人邮箱
                    <input
                      value={configForm.email.from}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          email: { ...configForm.email, from: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    用户名
                    <input
                      value={configForm.email.user}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          email: { ...configForm.email, user: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    密码
                    <input
                      type="password"
                      value={configForm.email.pass}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          email: { ...configForm.email, pass: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="inline-check form-label">
                    启用SSL/TLS
                    <input
                      type="checkbox"
                      checked={String(configForm.email.secure) === 'true'}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          email: { ...configForm.email, secure: e.target.checked },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                    />
                  </label>
                  <label className="form-label">
                    测试主题
                    <input
                      value={testEmailSubject}
                      onChange={(e) => setTestEmailSubject(e.target.value)}
                      placeholder="测试邮件主题"
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    测试内容
                    <input
                      value={testEmailMessage}
                      onChange={(e) => setTestEmailMessage(e.target.value)}
                      placeholder="测试邮件内容"
                      className="form-control"
                    />
                  </label>
                  <div className="template-vars full-row">
                    <div className="template-vars-title">模板变量（可选）</div>
                    <div className="template-vars-grid">
                      <label className="form-label">
                        客户名称
                        <input
                          value={testTemplate.customer_name}
                          onChange={(e) =>
                            setTestTemplate({ ...testTemplate, customer_name: e.target.value })
                          }
                          className="form-control"
                        />
                      </label>
                      <label className="form-label">
                        授权名称
                        <input
                          value={testTemplate.license_name}
                          onChange={(e) =>
                            setTestTemplate({ ...testTemplate, license_name: e.target.value })
                          }
                          className="form-control"
                        />
                      </label>
                      <label className="form-label">
                        到期日期
                        <input
                          value={testTemplate.end_date}
                          onChange={(e) =>
                            setTestTemplate({ ...testTemplate, end_date: e.target.value })
                          }
                          className="form-control"
                        />
                      </label>
                      <label className="form-label">
                        剩余天数
                        <input
                          value={testTemplate.days_left}
                          onChange={(e) =>
                            setTestTemplate({ ...testTemplate, days_left: e.target.value })
                          }
                          className="form-control"
                        />
                      </label>
                      <label className="form-label">
                        联系人
                        <input
                          value={testTemplate.contact_name}
                          onChange={(e) =>
                            setTestTemplate({ ...testTemplate, contact_name: e.target.value })
                          }
                          className="form-control"
                        />
                      </label>
                    </div>
                    <p className="muted">
                      可用变量：{`{customer_name} {license_name} {end_date} {days_left} {contact_name}`}
                    </p>
                  </div>
                    <label className="full-row form-label">
                      测试邮箱
                      <input
                        value={testEmail}
                        onChange={(e) => {
                          setTestEmail(e.target.value)
                          setTestEmailStatus({ type: '', text: '' })
                          setModalInfo(null)
                        }}
                      placeholder="请输入测试邮箱地址"
                      className="form-control"
                    />
                  </label>
                  <button className="primary btn btn-primary" type="button" onClick={onTestEmail}>
                    测试邮箱
                  </button>
                  {testEmailStatus.text && (
                    <div className={`toast ${testEmailStatus.type} form-feedback full-row`}>
                      {testEmailStatus.text}
                    </div>
                  )}
                </div>
              </div>

              <div className="config-card card-split tone-sms">
                <div className="config-card-header">阿里云短信配置</div>
                <div className="config-card-body">
                  <label className="form-label">
                    AccessKey ID
                    <input
                      value={configForm.sms.accessKeyId}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          sms: { ...configForm.sms, accessKeyId: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    AccessKey Secret
                    <input
                      type="password"
                      value={configForm.sms.accessKeySecret}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          sms: { ...configForm.sms, accessKeySecret: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    短信签名
                    <input
                      value={configForm.sms.signName}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          sms: { ...configForm.sms, signName: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    模板CODE
                    <input
                      value={configForm.sms.templateCode}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          sms: { ...configForm.sms, templateCode: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    测试内容
                    <input
                      value={testSmsMessage}
                      onChange={(e) => setTestSmsMessage(e.target.value)}
                      placeholder="测试短信内容"
                      className="form-control"
                    />
                  </label>
                  <label className="full-row form-label">
                    测试手机号
                    <input
                      value={testSms}
                      onChange={(e) => {
                        setTestSms(e.target.value)
                        setTestSmsStatus({ type: '', text: '' })
                        setModalInfo(null)
                      }}
                      placeholder="请输入测试手机号"
                      className="form-control"
                    />
                  </label>
                  <button className="primary btn btn-primary" type="button" onClick={onTestSms}>
                    测试短信
                  </button>
                  {testSmsStatus.text && (
                    <div className={`toast ${testSmsStatus.type} form-feedback full-row`}>
                      {testSmsStatus.text}
                    </div>
                  )}
                </div>
              </div>

              <div className="config-card card-split tone-wecom">
                <div className="config-card-header">企业微信配置</div>
                <div className="config-card-body">
                  <label className="form-label">
                    企业ID
                    <input
                      value={configForm.wecom.corpId}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          wecom: { ...configForm.wecom, corpId: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    应用Secret
                    <input
                      type="password"
                      value={configForm.wecom.secret}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          wecom: { ...configForm.wecom, secret: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    应用AgentId
                    <input
                      value={configForm.wecom.agentId}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          wecom: { ...configForm.wecom, agentId: e.target.value },
                        })
                      }
                      onInput={() => setConfigDirty(true)}
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    测试内容
                    <input
                      value={testWecomMessage}
                      onChange={(e) => setTestWecomMessage(e.target.value)}
                      placeholder="测试企业微信内容"
                      className="form-control"
                    />
                  </label>
                  <label className="full-row form-label">
                    测试用户
                    <input
                      value={testWecom}
                      onChange={(e) => {
                        setTestWecom(e.target.value)
                        setTestWecomStatus({ type: '', text: '' })
                        setModalInfo(null)
                      }}
                      placeholder="请输入测试用户ID或手机号"
                      className="form-control"
                    />
                  </label>
                  <label className="full-row form-label">
                    测试Webhook（可选）
                    <input
                      value={testWecomWebhook}
                      onChange={(e) => {
                        setTestWecomWebhook(e.target.value)
                        setTestWecomStatus({ type: '', text: '' })
                        setModalInfo(null)
                      }}
                      placeholder="若填写则优先走Webhook"
                      className="form-control"
                    />
                  </label>
                  <button className="primary btn btn-primary" type="button" onClick={onTestWecom}>
                    测试企业微信
                  </button>
                  {testWecomStatus.text && (
                    <div className={`toast ${testWecomStatus.type} form-feedback full-row`}>
                      {testWecomStatus.text}
                    </div>
                  )}
                </div>
              </div>

              <div className="config-actions">
                <button type="submit" className="primary btn btn-primary">
                  保存配置
                </button>
              </div>
              <div className="config-card card-split tone-control">
                <div className="config-card-header">发送控制</div>
                <div className="config-card-body">
                  <label className="form-label">
                    失败重试次数
                    <input
                      type="number"
                      min="0"
                      value={configForm.retry?.maxRetries || 0}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          retry: { ...(configForm.retry || {}), maxRetries: e.target.value },
                        })
                      }
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    重试间隔(毫秒)
                    <input
                      type="number"
                      min="0"
                      value={configForm.retry?.intervalMs || 2000}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          retry: { ...(configForm.retry || {}), intervalMs: e.target.value },
                        })
                      }
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    每次任务最大条数
                    <input
                      type="number"
                      min="1"
                      value={configForm.rateLimit?.maxPerRun || 200}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          rateLimit: { ...(configForm.rateLimit || {}), maxPerRun: e.target.value },
                        })
                      }
                      className="form-control"
                    />
                  </label>
                </div>
              </div>
              <div className="config-card card-split tone-template">
                <div className="config-card-header">提醒模板（可锁定）</div>
                <div className="config-card-body">
                  <label className="form-label">
                    主题
                    <input
                      value={configForm.reminder.subject}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          reminder: { ...configForm.reminder, subject: e.target.value },
                        })
                      }
                      disabled={configForm.reminder.locked}
                      className="form-control"
                    />
                  </label>
                  <label className="full-row form-label">
                    内容
                    <input
                      value={configForm.reminder.message}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          reminder: { ...configForm.reminder, message: e.target.value },
                        })
                      }
                      disabled={configForm.reminder.locked}
                      className="form-control"
                    />
                  </label>
                  <label className="inline-check full-row form-label">
                    锁定模板（防止误改）
                    <input
                      type="checkbox"
                      checked={!!configForm.reminder.locked}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          reminder: { ...configForm.reminder, locked: e.target.checked },
                        })
                      }
                    />
                  </label>
                  <p className="muted full-row">
                    变量：{`{customer_name} {license_name} {end_date} {days_left} {contact_name}`}
                  </p>
                </div>
              </div>
            </form>
          </section>
        )}

        {activeTab === 'security' && (
          <section className="panel">
            <div className="config-page-title">
              <h2>安全配置</h2>
              <p>配置登录失败限制与管理员二次验证。</p>
            </div>
            <form className="config-stack" onSubmit={onSaveSecurity}>
              <div className="config-card card-split tone-sec-login">
                <div className="config-card-header">登录失败限制</div>
                <div className="config-card-body">
                  <label className="form-label">
                    登录最大失败次数
                    <input
                      type="number"
                      min="1"
                      value={configForm.security?.login?.maxAttempts ?? 5}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          security: {
                            ...(configForm.security || {}),
                            login: {
                              ...(configForm.security?.login || {}),
                              maxAttempts: Number(e.target.value || 0),
                            },
                          },
                        })
                      }
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    统计窗口(分钟)
                    <input
                      type="number"
                      min="1"
                      value={configForm.security?.login?.windowMinutes ?? 15}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          security: {
                            ...(configForm.security || {}),
                            login: {
                              ...(configForm.security?.login || {}),
                              windowMinutes: Number(e.target.value || 0),
                            },
                          },
                        })
                      }
                      className="form-control"
                    />
                  </label>
                  <label className="form-label">
                    锁定时长(分钟)
                    <input
                      type="number"
                      min="1"
                      value={configForm.security?.login?.lockMinutes ?? 15}
                      onChange={(e) =>
                        setConfigForm({
                          ...configForm,
                          security: {
                            ...(configForm.security || {}),
                            login: {
                              ...(configForm.security?.login || {}),
                              lockMinutes: Number(e.target.value || 0),
                            },
                          },
                        })
                      }
                      className="form-control"
                    />
                  </label>
                </div>
              </div>

              <div className="config-card card-split tone-sec-captcha">
                <div className="config-card-header">登录验证码</div>
                <div className="config-card-body">
                  <div className="config-inline-row full-row">
                    <label className="form-label">
                      验证码有效期(秒)
                      <input
                        type="number"
                        min="60"
                        value={configForm.security?.captcha?.ttlSeconds ?? 300}
                        onChange={(e) =>
                          setConfigForm({
                            ...configForm,
                            security: {
                              ...(configForm.security || {}),
                              captcha: {
                                ...(configForm.security?.captcha || {}),
                                ttlSeconds: Number(e.target.value || 0),
                              },
                            },
                          })
                        }
                        className="form-control"
                      />
                    </label>
                    <label className="inline-check form-label">
                      启用登录验证码
                      <input
                        type="checkbox"
                        checked={configForm.security?.captcha?.enabled !== false}
                        onChange={(e) =>
                          setConfigForm({
                            ...configForm,
                            security: {
                              ...(configForm.security || {}),
                              captcha: { ...(configForm.security?.captcha || {}), enabled: e.target.checked },
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="config-card card-split tone-sec-mfa">
                <div className="config-card-header">管理员二次验证</div>
                <div className="config-card-body">
                  <div className="config-inline-row full-row align-top">
                    <label className="form-label">
                      MFA验证码有效期(秒)
                      <input
                        type="number"
                        min="60"
                        value={configForm.security?.mfa?.codeTtlSeconds ?? 300}
                        onChange={(e) =>
                          setConfigForm({
                            ...configForm,
                            security: {
                              ...(configForm.security || {}),
                              mfa: {
                                ...(configForm.security?.mfa || {}),
                                codeTtlSeconds: Number(e.target.value || 0),
                              },
                            },
                          })
                        }
                        className="form-control"
                      />
                    </label>
                    <label className="form-label">
                      验证方式（可多选）
                      <div className="channel-row mfa-channel-row">
                        {[
                          { key: 'email', label: '邮箱' },
                          { key: 'sms', label: '短信' },
                          { key: 'wecom', label: '企业微信' },
                          { key: 'totp', label: '谷歌认证' },
                        ].map((m) => {
                          const selected = (configForm.security?.adminMfaMethods || []).includes(m.key)
                          return (
                            <label key={m.key}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? Array.from(new Set([...(configForm.security?.adminMfaMethods || []), m.key]))
                                    : (configForm.security?.adminMfaMethods || []).filter((x) => x !== m.key)
                                  setConfigForm({
                                    ...configForm,
                                    security: { ...(configForm.security || {}), adminMfaMethods: next },
                                  })
                                }}
                              />
                              {m.label}
                            </label>
                          )
                        })}
                      </div>
                    </label>
                  </div>
                  <p className="muted full-row">
                    开启后，管理员登录需完成二次验证；请先在“用户管理”配置管理员的邮箱/手机号/企业微信或启用谷歌认证。
                  </p>
                </div>
              </div>

              <div className="config-actions">
                <button type="submit" className="primary btn btn-primary">
                  保存安全配置
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
      </div>
    </div>
  )
}

export default App

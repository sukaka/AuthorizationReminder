import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = String(import.meta.env.VITE_API_BASE || '').trim()

const parseMaybeJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const buildHttpError = ({ res, parsed, text }) => {
  const bodyMsg = parsed?.error || parsed?.message
  if (bodyMsg) return bodyMsg
  if (text) return text.slice(0, 300)
  return `HTTP ${res.status}`
}

const buildApi = () => ({
  request: async (method, path, body, headers = {}) => {
    const opts = {
      method,
      credentials: 'include',
      headers,
    }
    if (body !== undefined) {
      if (body instanceof FormData) {
        opts.body = body
      } else {
        opts.headers = { 'Content-Type': 'application/json', ...headers }
        opts.body = JSON.stringify(body)
      }
    }
    const res = await fetch(`${API_BASE}${path}`, opts)
    const text = await res.text()
    const parsed = parseMaybeJson(text)
    if (!res.ok) throw new Error(buildHttpError({ res, parsed, text }))
    return parsed ?? text
  },
  get(path) {
    return this.request('GET', path)
  },
  post(path, body, headers) {
    return this.request('POST', path, body, headers)
  },
  put(path, body, headers) {
    return this.request('PUT', path, body, headers)
  },
  del(path) {
    return this.request('DELETE', path)
  },
})

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

const buildPortalLoginUrl = (system) => {
  const base = getPortalBaseUrl()
  const params = new URLSearchParams()
  if (system) params.set('system', system)
  return `${base}/portal?${params.toString()}`
}

const buildPortalSwitchUrl = (system) => {
  const base = getPortalBaseUrl()
  const params = new URLSearchParams()
  if (system) params.set('system', system)
  params.set('mode', 'switch')
  return `${base}/portal?${params.toString()}`
}

const roleLabel = (role) => {
  const key = String(role || '').toLowerCase()
  if (key === 'admin') return '业务管理员'
  if (key === 'editor') return '标书编辑'
  if (key === 'sysadmin') return '系统管理员'
  if (key === 'auditor') return '审计管理员'
  return key || '-'
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const d = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('zh-CN', { hour12: false })
}

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

const normalizeDateToInput = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (text.includes('长期')) return ''
  const match = text.match(/((?:19|20)\d{2})[年./-]?((?:0?[1-9])|(?:1[0-2]))[月./-]?((?:0?[1-9])|(?:[12]\d)|(?:3[01]))/)
  if (!match) return ''
  const year = String(Number(match[1])).padStart(4, '0')
  const month = String(Number(match[2])).padStart(2, '0')
  const day = String(Number(match[3])).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const normalizeIdNo = (value) => String(value ?? '').replace(/[^0-9xX]/g, '').toUpperCase()

const deriveBirthDateFromIdNo = (idNo) => {
  const clean = normalizeIdNo(idNo)
  if (!/^[1-9]\d{16}[0-9X]$/.test(clean)) return ''
  return `${clean.slice(6, 10)}-${clean.slice(10, 12)}-${clean.slice(12, 14)}`
}

const deriveGenderFromIdNo = (idNo) => {
  const clean = normalizeIdNo(idNo)
  if (!/^[1-9]\d{16}[0-9X]$/.test(clean)) return ''
  return Number(clean[16]) % 2 === 0 ? '女' : '男'
}

const buildImagePreviewUrl = (file) => {
  if (!file) return ''
  const mime = String(file.type || '').toLowerCase()
  if (!mime.startsWith('image/')) return ''
  return URL.createObjectURL(file)
}

const safeRevokeUrl = (url) => {
  const text = String(url || '').trim()
  if (!text) return
  try {
    URL.revokeObjectURL(text)
  } catch {
    // ignore
  }
}

const mainTabs = [
  { key: 'dashboard', label: '仪表盘' },
  { key: 'bids', label: '标书管理' },
  { key: 'editor', label: '在线编辑' },
  { key: 'ai', label: 'AI助手' },
  { key: 'audit', label: '审计日志' },
  { key: 'config', label: '系统配置' },
  { key: 'models', label: '模型管理' },
]

const ownLibraryTabs = [
  { key: 'library-company', label: '公司信息' },
  { key: 'library-qualification', label: '资质管理' },
  { key: 'library-finance', label: '财务信息' },
  { key: 'library-performance', label: '业绩管理' },
  { key: 'library-personnel', label: '人员管理' },
]

const bidStatusOptions = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'IN_REVIEW', label: '评审中' },
  { value: 'FINALIZED', label: '定稿' },
  { value: 'SUBMITTED', label: '已提交' },
  { value: 'ARCHIVED', label: '已归档' },
]

const bidStatusLabelMap = bidStatusOptions.reduce((acc, cur) => {
  acc[cur.value] = cur.label
  return acc
}, {})

const assetTypeLabelMap = {
  QUALIFICATION: '资质证书',
  BUSINESS_LICENSE: '营业执照',
  ID_CARD: '身份证',
  EDUCATION_CERT: '毕业证',
  CONTRACT: '合同',
  BIDDING_NOTICE: '招标文件',
  OTHER: '其他',
}

const ocrStatusLabelMap = {
  AUTO_EXTRACTED: '自动提取',
  CONFIRMED: '已确认',
  FAILED: '识别失败',
}

const bidStatusLabel = (value) => bidStatusLabelMap[String(value || '').toUpperCase()] || value || '-'
const assetTypeLabel = (value) => assetTypeLabelMap[String(value || '').toUpperCase()] || value || '-'
const ocrStatusLabel = (value) => ocrStatusLabelMap[String(value || '').toUpperCase()] || value || '-'
const versionSourceLabel = (value) => {
  const key = String(value || '').toLowerCase()
  if (key === 'upload') return '上传'
  if (key === 'snapshot') return '快照'
  if (key === 'fill') return '模板填充'
  return value || '-'
}

function App() {
  const api = useMemo(() => buildApi(), [])

  const [booting, setBooting] = useState(true)
  const [user, setUser] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [stats, setStats] = useState({ bids: 0, drafts: 0, assets: 0, enabled_models: 0 })
  const [activeTab, setActiveTab] = useState('dashboard')
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(true)

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [bids, setBids] = useState([])
  const [bidForm, setBidForm] = useState({ title: '', customer_name: '', project_name: '', summary: '' })
  const [fillBundleByBid, setFillBundleByBid] = useState({})
  const [autoBidFileInputKey, setAutoBidFileInputKey] = useState(0)
  const [autoBidForm, setAutoBidForm] = useState({
    bundle_id: '',
    title: '',
    customer_name: '',
    project_name: '',
    summary: '',
    file: null,
  })

  const [versions, setVersions] = useState([])
  const [selectedBid, setSelectedBid] = useState(null)

  const [bundles, setBundles] = useState([])

  const [assets, setAssets] = useState([])
  const [assetUploadForm, setAssetUploadForm] = useState({ asset_type: 'QUALIFICATION', file: null })

  const [companyForm, setCompanyForm] = useState({
    company_name: '',
    uscc: '',
    registered_capital: '',
    company_nature: '',
    established_date: '',
    business_term: '',
    contact_phone: '',
    company_email: '',
    company_address: '',
    postal_code: '',
    registration_authority: '',
    business_scope: '',
  })
  const [companyLicenseUpload, setCompanyLicenseUpload] = useState({ file: null, preview_url: '', file_name: '' })
  const [companyLicenseInputKey, setCompanyLicenseInputKey] = useState(0)
  const [companyLicenseUploadBusy, setCompanyLicenseUploadBusy] = useState(false)
  const [companyLicenseOcr, setCompanyLicenseOcr] = useState({
    asset_id: null,
    file_name: '',
    status: '',
    fields_json: null,
    ocr_error: '',
  })
  const [financeForm, setFinanceForm] = useState({
    account_name: '',
    bank_account: '',
    bank_name: '',
    bank_address: '',
    bank_branch_no: '',
    bank_phone: '',
  })
  const [performanceForm, setPerformanceForm] = useState({
    brand_capability: '',
    personnel_capability: '',
    related_image_file: null,
  })
  const [personnelForm, setPersonnelForm] = useState({
    legal_name: '',
    legal_id_no: '',
    legal_gender: '',
    legal_birth_date: '',
    legal_id_valid_from: '',
    legal_id_valid_to: '',
    legal_id_long_term: false,
    legal_position: '',
    legal_id_front_file: null,
    legal_id_back_file: null,
    agent_name: '',
    agent_id_no: '',
    agent_gender: '',
    agent_birth_date: '',
    agent_id_valid_from: '',
    agent_id_valid_to: '',
    agent_id_long_term: false,
    agent_position: '',
    agent_id_front_file: null,
    agent_id_back_file: null,
  })
  const [idCardRecognizing, setIdCardRecognizing] = useState({ legal: false, agent: false })
  const [idCardPreview, setIdCardPreview] = useState({
    legal_front: '',
    legal_back: '',
    agent_front: '',
    agent_back: '',
  })
  const [idCardOcrFields, setIdCardOcrFields] = useState({
    legal_front: null,
    legal_back: null,
    agent_front: null,
    agent_back: null,
  })
  const [idCardAssetIds, setIdCardAssetIds] = useState({
    legal_front: null,
    legal_back: null,
    agent_front: null,
    agent_back: null,
  })

  const [models, setModels] = useState([])
  const [modelForm, setModelForm] = useState({
    name: '',
    model_key: '',
    provider_type: 'custom',
    base_url: '',
    model_name: '',
    api_key: '',
    timeout_ms: 20000,
    max_tokens: 4096,
    temperature_default: 0.3,
  })

  const [aiForm, setAiForm] = useState({
    task: 'ocr-structured',
    model_id: '',
    input_text: '',
    ocr_text: '',
    style: '正式、专业、简洁',
  })
  const [aiResult, setAiResult] = useState(null)

  const [auditLogs, setAuditLogs] = useState([])
  const [auditFilter, setAuditFilter] = useState({ username: '', action: '', entity: '' })

  const [configs, setConfigs] = useState({
    audit_retention_days: 365,
    ocr_enabled: true,
    ocr_access_key_id: '',
    ocr_access_key_secret: '',
    ocr_endpoint: 'ocr.cn-beijing.aliyuncs.com',
    ocr_api_version: '2021-07-07',
    ocr_timeout_ms: 15000,
  })

  const [editorVisible, setEditorVisible] = useState(false)
  const [editorPayload, setEditorPayload] = useState(null)
  const [editorContainerId, setEditorContainerId] = useState('tender-doc-editor')
  const [editorScriptError, setEditorScriptError] = useState('')
  const docEditorRef = useRef(null)

  const resetFeedback = () => {
    setMessage('')
    setError('')
  }

  const showError = (msg) => {
    setMessage('')
    setError(msg || '操作失败')
  }

  const showMessage = (msg) => {
    setError('')
    setMessage(msg || '操作成功')
  }

  const setCompanyLicenseFile = (file) => {
    setCompanyLicenseUpload((prev) => {
      safeRevokeUrl(prev.preview_url)
      return {
        file,
        preview_url: buildImagePreviewUrl(file),
        file_name: file?.name || '',
      }
    })
  }

  const setIdCardFilePreview = (key, file) => {
    setIdCardPreview((prev) => {
      safeRevokeUrl(prev[key])
      return {
        ...prev,
        [key]: buildImagePreviewUrl(file),
      }
    })
  }

  const clearCompanyLicenseLocal = () => {
    setCompanyLicenseUpload((prev) => {
      safeRevokeUrl(prev.preview_url)
      return { file: null, preview_url: '', file_name: '' }
    })
    setCompanyLicenseOcr({ asset_id: null, file_name: '', status: '', fields_json: null, ocr_error: '' })
    setCompanyLicenseInputKey((prev) => prev + 1)
  }

  const getIdCardFileField = (roleKey, sideKey) => {
    if (roleKey === 'agent') return sideKey === 'front' ? 'agent_id_front_file' : 'agent_id_back_file'
    return sideKey === 'front' ? 'legal_id_front_file' : 'legal_id_back_file'
  }

  const clearIdCardLocal = (roleKey, sideKey) => {
    const cacheKey = `${roleKey}_${sideKey}`
    const fileField = getIdCardFileField(roleKey, sideKey)
    setIdCardFilePreview(cacheKey, null)
    setIdCardOcrFields((prev) => ({ ...prev, [cacheKey]: null }))
    setIdCardAssetIds((prev) => ({ ...prev, [cacheKey]: null }))
    setPersonnelForm((prev) => ({ ...prev, [fileField]: null }))
  }

  const loadEditorScript = async () => {
    if (window.DocsAPI?.DocEditor) {
      setEditorScriptError('')
      return true
    }

    const src = '/doc-editor/web-apps/apps/api/documents/api.js'
    const loadOnce = () =>
      new Promise((resolve) => {
        const existed = document.querySelector(`script[src="${src}"]`)
        if (existed) existed.remove()

        const script = document.createElement('script')
        script.src = src
        script.async = true

        const timer = setTimeout(() => {
          script.onerror = null
          script.onload = null
          script.remove()
          resolve(false)
        }, 8000)

        script.onload = () => {
          clearTimeout(timer)
          resolve(!!window.DocsAPI?.DocEditor)
        }

        script.onerror = () => {
          clearTimeout(timer)
          script.remove()
          resolve(false)
        }

        document.body.appendChild(script)
      })

    const firstTry = await loadOnce()
    if (firstTry) {
      setEditorScriptError('')
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
    const secondTry = await loadOnce()
    if (secondTry) {
      setEditorScriptError('')
      return true
    }

    setEditorScriptError('OnlyOffice 编辑服务不可用，请稍后重试。')
    return false
  }

  const destroyEditor = () => {
    if (docEditorRef.current && typeof docEditorRef.current.destroyEditor === 'function') {
      docEditorRef.current.destroyEditor()
    }
    docEditorRef.current = null
  }

  const fetchBootstrap = async () => {
    const resp = await api.get('/api/tender/bootstrap')
    setPermissions(resp.permissions || {})
    setStats(resp.stats || {})
  }

  const fetchBids = async () => {
    const resp = await api.get('/api/tender/bids?limit=200')
    setBids(Array.isArray(resp.items) ? resp.items : [])
  }

  const fetchVersions = async (bidId) => {
    if (!bidId) return
    const rows = await api.get(`/api/tender/bids/${bidId}/versions`)
    setVersions(Array.isArray(rows) ? rows : [])
  }

  const fetchBundles = async () => {
    const bundleRows = await api.get('/api/tender/templates/bundles')
    setBundles(Array.isArray(bundleRows) ? bundleRows : [])
  }

  const fetchAssets = async () => {
    const rows = await api.get('/api/tender/assets')
    setAssets(Array.isArray(rows) ? rows : [])
  }

  const fetchModels = async () => {
    const rows = await api.get('/api/tender/ai/models')
    setModels(Array.isArray(rows) ? rows : [])
  }

  const fetchAuditLogs = async () => {
    const params = new URLSearchParams()
    if (auditFilter.username) params.set('username', auditFilter.username)
    if (auditFilter.action) params.set('action', auditFilter.action)
    if (auditFilter.entity) params.set('entity', auditFilter.entity)
    params.set('limit', '300')
    const rows = await api.get(`/api/tender/audit/logs?${params.toString()}`)
    setAuditLogs(Array.isArray(rows) ? rows : [])
  }

  const fetchConfigs = async () => {
    const rows = await api.get('/api/tender/config')
    setConfigs((prev) => ({ ...prev, ...(rows || {}) }))
  }

  const redirectToLogin = () => {
    window.location.replace(buildPortalLoginUrl('tender'))
  }

  const bootstrapAuth = async () => {
    let redirected = false
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) {
        redirected = true
        redirectToLogin()
        return
      }
      const data = await res.json()
      setUser(data)
      await fetchBootstrap()
      await Promise.allSettled([fetchBids(), fetchBundles(), fetchAssets(), fetchModels()])
    } catch {
      redirected = true
      redirectToLogin()
      return
    } finally {
      if (!redirected) setBooting(false)
    }
  }

  useEffect(() => {
    bootstrapAuth().catch(() => {
      redirectToLogin()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    safeRevokeUrl(companyLicenseUpload.preview_url)
    Object.values(idCardPreview).forEach((url) => safeRevokeUrl(url))
  }, [companyLicenseUpload.preview_url, idCardPreview])

  useEffect(() => {
    if (!editorVisible || !editorPayload?.editor || !window.DocsAPI?.DocEditor) return
    const timer = setTimeout(() => {
      destroyEditor()
      try {
        docEditorRef.current = new window.DocsAPI.DocEditor(editorContainerId, {
          ...editorPayload.editor.config,
          token: editorPayload.editor.token,
          width: '100%',
          height: '100%',
        })
      } catch {
        setEditorScriptError('OnlyOffice 编辑器初始化失败')
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [editorVisible, editorPayload, editorContainerId])

  const canRead = !!permissions.can_read
  const canWrite = !!permissions.can_write
  const canConfigManage = !!permissions.can_config_manage
  const canAudit = !!permissions.can_audit_read
  const canAiUse = !!permissions.can_ai_use
  const canAiManage = !!permissions.can_ai_manage
  const activeBundles = useMemo(
    () => bundles.filter((item) => String(item.status || '').toUpperCase() === 'ACTIVE'),
    [bundles]
  )

  useEffect(() => {
    if (!bids.length || !activeBundles.length) return
    setFillBundleByBid((prev) => {
      const allowed = new Set(activeBundles.map((item) => String(item.id)))
      const fallback = String(activeBundles[0].id)
      const next = {}
      for (const bid of bids) {
        const key = String(bid.id)
        const current = String(prev[key] || '')
        next[key] = current && allowed.has(current) ? current : fallback
      }
      const nextKeys = Object.keys(next)
      const prevKeys = Object.keys(prev)
      if (nextKeys.length !== prevKeys.length) return next
      for (const key of nextKeys) {
        if (next[key] !== prev[key]) return next
      }
      return prev
    })
  }, [bids, activeBundles])

  useEffect(() => {
    if (!activeBundles.length) return
    setAutoBidForm((prev) => {
      const hasSelected = prev.bundle_id && activeBundles.some((item) => String(item.id) === String(prev.bundle_id))
      if (hasSelected) return prev
      return { ...prev, bundle_id: String(activeBundles[0].id) }
    })
  }, [activeBundles])

  const visibleMainTabs = mainTabs.filter((tab) => {
    if (tab.key === 'bids' || tab.key === 'editor') return canRead
    if (tab.key === 'ai') return canAiUse || canAiManage
    if (tab.key === 'audit') return canAudit
    if (tab.key === 'config') return canConfigManage
    if (tab.key === 'models') return canAiManage
    return true
  })
  const visibleOwnLibraryTabs = canRead ? ownLibraryTabs : []

  const onCreateBid = async () => {
    resetFeedback()
    try {
      const row = await api.post('/api/tender/bids', bidForm)
      setBidForm({ title: '', customer_name: '', project_name: '', summary: '' })
      setBids((prev) => [row, ...prev])
      showMessage('标书创建成功')
      fetchBootstrap().catch(() => {})
    } catch (err) {
      showError(err.message)
    }
  }

  const onChangeBidStatus = async (bid, status) => {
    resetFeedback()
    try {
      await api.post(`/api/tender/bids/${bid.id}/status`, { status })
      await fetchBids()
      showMessage(`状态已更新为${bidStatusLabel(status)}`)
    } catch (err) {
      showError(err.message)
    }
  }

  const onUploadVersion = async (bidId, file) => {
    resetFeedback()
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post(`/api/tender/bids/${bidId}/versions/upload`, form)
      showMessage('版本上传成功')
      await fetchBids()
      await fetchVersions(bidId)
    } catch (err) {
      showError(err.message)
    }
  }

  const onOpenEditor = async (bid) => {
    resetFeedback()
    try {
      const loaded = await loadEditorScript()
      if (!loaded || !window.DocsAPI?.DocEditor) {
        showError('OnlyOffice 不可用')
        return
      }
      const payload = await api.post(`/api/tender/bids/${bid.id}/editor/session`, {})
      setEditorContainerId(`tender-doc-editor-${Date.now()}`)
      setEditorPayload(payload)
      setEditorVisible(true)
      setSelectedBid(bid)
      showMessage('协同会话已创建')
    } catch (err) {
      showError(err.message)
    }
  }

  const onApplyTemplate = async (bid) => {
    resetFeedback()
    try {
      const selectedValue = fillBundleByBid[String(bid.id)]
      const bundleId = Number(selectedValue)
      if (!bundleId) throw new Error('请先选择模板包')
      const bundle = activeBundles.find((item) => Number(item.id) === bundleId)
      if (!bundle) throw new Error('所选模板包不可用，请重新选择')

      await api.post(`/api/tender/bids/${bid.id}/fill`, { bundle_id: bundleId })
      await fetchBids()
      if (Number(selectedBid?.id) === Number(bid.id)) {
        await fetchVersions(bid.id)
      }
      showMessage(`已套用模板包：${bundle.name || bundle.bundle_code}`)
    } catch (err) {
      showError(err.message)
    }
  }

  const onAutoGenerateBid = async () => {
    resetFeedback()
    try {
      if (!autoBidForm.file) throw new Error('请先上传招标文件')
      const bundleId = Number(autoBidForm.bundle_id)
      if (!bundleId) throw new Error('请先选择模板包')

      const form = new FormData()
      form.append('file', autoBidForm.file)
      form.append('bundle_id', String(bundleId))
      if (autoBidForm.title.trim()) form.append('title', autoBidForm.title.trim())
      if (autoBidForm.customer_name.trim()) form.append('customer_name', autoBidForm.customer_name.trim())
      if (autoBidForm.project_name.trim()) form.append('project_name', autoBidForm.project_name.trim())
      if (autoBidForm.summary.trim()) form.append('summary', autoBidForm.summary.trim())

      const result = await api.post('/api/tender/bids/auto-generate', form)
      const createdBid = result?.bid || null

      setAutoBidForm((prev) => ({
        ...prev,
        title: '',
        customer_name: '',
        project_name: '',
        summary: '',
        file: null,
      }))
      setAutoBidFileInputKey((prev) => prev + 1)

      await fetchBids()
      if (createdBid?.id) {
        setSelectedBid(createdBid)
        await fetchVersions(createdBid.id)
      }
      showMessage('已根据招标文件自动生成投标文件')
      fetchBootstrap().catch(() => {})
      fetchAssets().catch(() => {})
    } catch (err) {
      showError(err.message)
    }
  }

  const onCloseEditor = async () => {
    destroyEditor()
    setEditorVisible(false)
    const bid = selectedBid
    setEditorPayload(null)
    if (bid?.id) {
      try {
        await api.post(`/api/tender/bids/${bid.id}/editor/release`, {})
      } catch {
        // ignore
      }
    }
  }

  const onUploadAsset = async () => {
    resetFeedback()
    try {
      if (!assetUploadForm.file) throw new Error('请选择文件')
      const form = new FormData()
      form.append('asset_type', assetUploadForm.asset_type)
      form.append('file', assetUploadForm.file)
      await api.post('/api/tender/assets/upload', form)
      setAssetUploadForm({ asset_type: 'QUALIFICATION', file: null })
      await fetchAssets()
      showMessage('证照上传成功')
      fetchBootstrap().catch(() => {})
    } catch (err) {
      showError(err.message)
    }
  }

  const onConfirmOcr = async (asset) => {
    resetFeedback()
    try {
      await api.post(`/api/tender/assets/${asset.id}/confirm`, {
        doc_type: asset.doc_type,
        fields_json: asset.fields_json || {},
        confidence: asset.confidence || 80,
      })
      await fetchAssets()
      showMessage('OCR结果已确认')
    } catch (err) {
      showError(err.message)
    }
  }

  const applyIdCardFieldsToForm = (role, fields) => {
    const name = firstNonEmpty(fields?.name, fields?.subject)
    const idNo = normalizeIdNo(firstNonEmpty(fields?.id_no, fields?.certificate_no))
    const gender = firstNonEmpty(fields?.gender) || deriveGenderFromIdNo(idNo)
    const birthDate = normalizeDateToInput(firstNonEmpty(fields?.birth_date)) || deriveBirthDateFromIdNo(idNo)
    const validFrom = normalizeDateToInput(firstNonEmpty(fields?.valid_from))
    const validToRaw = firstNonEmpty(fields?.valid_to)
    const validTo = normalizeDateToInput(validToRaw)
    const validLongTerm = Number(fields?.valid_long_term || 0) > 0 || String(validToRaw).includes('长期')

    if (role === 'agent') {
      setPersonnelForm((prev) => ({
        ...prev,
        agent_name: name || prev.agent_name,
        agent_id_no: idNo || prev.agent_id_no,
        agent_gender: gender || prev.agent_gender,
        agent_birth_date: birthDate || prev.agent_birth_date,
        agent_id_valid_from: validFrom || prev.agent_id_valid_from,
        agent_id_valid_to: validLongTerm ? '' : (validTo || prev.agent_id_valid_to),
        agent_id_long_term: validLongTerm || prev.agent_id_long_term,
      }))
      return
    }

    setPersonnelForm((prev) => ({
      ...prev,
      legal_name: name || prev.legal_name,
      legal_id_no: idNo || prev.legal_id_no,
      legal_gender: gender || prev.legal_gender,
      legal_birth_date: birthDate || prev.legal_birth_date,
      legal_id_valid_from: validFrom || prev.legal_id_valid_from,
      legal_id_valid_to: validLongTerm ? '' : (validTo || prev.legal_id_valid_to),
      legal_id_long_term: validLongTerm || prev.legal_id_long_term,
    }))
  }

  const onUploadIdCardAndAutofill = async (role, side, file) => {
    if (!file) return
    const roleKey = role === 'agent' ? 'agent' : 'legal'
    const roleName = roleKey === 'agent' ? '授权委托人' : '法定代表人'
    const sideKey = side === 'back' ? 'back' : 'front'
    const sideName = sideKey === 'back' ? '反面' : '正面'
    const cacheKey = `${roleKey}_${sideKey}`
    resetFeedback()
    setIdCardRecognizing((prev) => ({ ...prev, [roleKey]: true }))
    setIdCardOcrFields((prev) => ({ ...prev, [cacheKey]: null }))
    setIdCardAssetIds((prev) => ({ ...prev, [cacheKey]: null }))
    try {
      const form = new FormData()
      form.append('asset_type', 'ID_CARD')
      form.append('file', file)
      const result = await api.post('/api/tender/assets/upload', form)
      const fields = result?.ocr_result?.fields_json || {}
      const assetId = Number(result?.asset?.id || 0)
      const ocrStatus = String(result?.ocr_result?.status || '').toUpperCase()
      if (assetId > 0) {
        setIdCardAssetIds((prev) => ({ ...prev, [cacheKey]: assetId }))
      }
      if (ocrStatus !== 'FAILED') {
        setIdCardOcrFields((prev) => ({ ...prev, [cacheKey]: fields }))
      }
      applyIdCardFieldsToForm(roleKey, fields)
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      if (ocrStatus === 'FAILED') {
        const reason = result?.ocr_result?.ocr_error || '未识别到可用字段'
        showError(`${roleName}身份证${sideName}已上传，但OCR识别失败：${reason}`)
      } else {
        showMessage(`${roleName}身份证${sideName}已识别并自动填充`)
      }
    } catch (err) {
      showError(err.message)
    } finally {
      setIdCardRecognizing((prev) => ({ ...prev, [roleKey]: false }))
    }
  }

  const onSmartFillPersonnelByRole = (role) => {
    const roleKey = role === 'agent' ? 'agent' : 'legal'
    const roleLabelText = roleKey === 'agent' ? '授权委托人' : '法定代表人'
    const front = idCardOcrFields[`${roleKey}_front`] || {}
    const back = idCardOcrFields[`${roleKey}_back`] || {}
    const merged = {
      name: firstNonEmpty(front.name, back.name, front.subject, back.subject),
      subject: firstNonEmpty(front.subject, back.subject),
      id_no: firstNonEmpty(front.id_no, back.id_no, front.certificate_no, back.certificate_no),
      certificate_no: firstNonEmpty(front.certificate_no, back.certificate_no),
      gender: firstNonEmpty(front.gender, back.gender),
      birth_date: firstNonEmpty(front.birth_date, back.birth_date),
      valid_from: firstNonEmpty(front.valid_from, back.valid_from),
      valid_to: firstNonEmpty(front.valid_to, back.valid_to),
      valid_long_term: Number(front.valid_long_term || 0) > 0 || Number(back.valid_long_term || 0) > 0 ? 1 : 0,
    }
    const hasAnyField = Object.values(merged).some((value) => {
      if (value === null || value === undefined) return false
      return String(value).trim() !== ''
    })
    if (!hasAnyField) {
      showError(`请先上传${roleLabelText}身份证正反面并识别后，再执行智能填充`)
      return
    }
    applyIdCardFieldsToForm(roleKey, merged)
    showMessage(`已根据${roleLabelText}身份证识别结果填充信息`)
  }

  const onCreateCustomModel = async () => {
    resetFeedback()
    try {
      await api.post('/api/tender/ai/models', modelForm)
      setModelForm({
        name: '',
        model_key: '',
        provider_type: 'custom',
        base_url: '',
        model_name: '',
        api_key: '',
        timeout_ms: 20000,
        max_tokens: 4096,
        temperature_default: 0.3,
      })
      await fetchModels()
      showMessage('自定义模型已新增')
      fetchBootstrap().catch(() => {})
    } catch (err) {
      showError(err.message)
    }
  }

  const onSetDefaultModel = async (id) => {
    resetFeedback()
    try {
      await api.post(`/api/tender/ai/models/${id}/default`, {})
      await fetchModels()
      showMessage('默认模型已更新')
    } catch (err) {
      showError(err.message)
    }
  }

  const onRunAiTask = async () => {
    resetFeedback()
    setAiResult(null)
    try {
      const model_id = aiForm.model_id ? Number(aiForm.model_id) : undefined
      let result
      if (aiForm.task === 'ocr-structured') {
        result = await api.post('/api/tender/ai/tasks/ocr-structured', {
          model_id,
          ocr_text: aiForm.ocr_text,
        })
      } else if (aiForm.task === 'rewrite') {
        result = await api.post('/api/tender/ai/tasks/rewrite', {
          model_id,
          input_text: aiForm.input_text,
          style: aiForm.style,
        })
      } else {
        result = await api.post('/api/tender/ai/tasks/proofread', {
          model_id,
          input_text: aiForm.input_text,
        })
      }
      setAiResult(result)
      showMessage('AI任务执行成功')
    } catch (err) {
      showError(err.message)
    }
  }

  const onUpdateConfig = async () => {
    resetFeedback()
    try {
      const updated = await api.post('/api/tender/config', {
        audit_retention_days: Number(configs.audit_retention_days || 365),
        ocr_enabled: !!configs.ocr_enabled,
        ocr_access_key_id: String(configs.ocr_access_key_id || '').trim(),
        ocr_access_key_secret: String(configs.ocr_access_key_secret || '').trim(),
        ocr_endpoint: String(configs.ocr_endpoint || '').trim(),
        ocr_api_version: String(configs.ocr_api_version || '').trim(),
        ocr_timeout_ms: Number(configs.ocr_timeout_ms || 15000),
      })
      setConfigs(updated || configs)
      showMessage('系统配置已更新')
    } catch (err) {
      showError(err.message)
    }
  }

  const normalizeUscc = (value) => String(value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()

  const buildBusinessTerm = (fields) => {
    const raw = firstNonEmpty(fields?.business_term)
    if (raw) return raw
    const validFrom = normalizeDateToInput(firstNonEmpty(fields?.valid_from))
    const validToRaw = firstNonEmpty(fields?.valid_to)
    const validTo = normalizeDateToInput(validToRaw)
    if (!validFrom && !validToRaw) return ''
    return `${validFrom || ''}${validToRaw ? ` 至 ${validTo || validToRaw}` : ''}`.trim()
  }

  const applyCompanyFieldsFromOcr = (fields) => {
    const companyName = firstNonEmpty(fields?.company_name, fields?.subject, fields?.name)
    const uscc = normalizeUscc(firstNonEmpty(fields?.uscc, fields?.certificate_no))
    const establishedDate = normalizeDateToInput(firstNonEmpty(fields?.established_date))
    const businessTerm = buildBusinessTerm(fields)
    setCompanyForm((prev) => ({
      ...prev,
      company_name: companyName || prev.company_name,
      uscc: uscc || prev.uscc,
      registered_capital: firstNonEmpty(fields?.registered_capital) || prev.registered_capital,
      company_nature: firstNonEmpty(fields?.company_nature) || prev.company_nature,
      established_date: establishedDate || prev.established_date,
      business_term: businessTerm || prev.business_term,
      company_address: firstNonEmpty(fields?.company_address, fields?.address) || prev.company_address,
      registration_authority: firstNonEmpty(fields?.issuer) || prev.registration_authority,
      business_scope: firstNonEmpty(fields?.business_scope) || prev.business_scope,
    }))
  }

  const onUploadBusinessLicense = async () => {
    resetFeedback()
    try {
      if (!companyLicenseUpload.file) throw new Error('请先选择营业执照文件')
      setCompanyLicenseUploadBusy(true)
      const form = new FormData()
      form.append('asset_type', 'BUSINESS_LICENSE')
      form.append('file', companyLicenseUpload.file)
      const result = await api.post('/api/tender/assets/upload', form)
      setCompanyLicenseOcr({
        asset_id: result?.asset?.id || null,
        file_name: result?.asset?.original_file_name || companyLicenseUpload.file.name,
        status: String(result?.ocr_result?.status || '').toUpperCase(),
        fields_json: result?.ocr_result?.fields_json || null,
        ocr_error: result?.ocr_result?.ocr_error || '',
      })
      setCompanyLicenseUpload((prev) => ({ ...prev, file: null }))
      setCompanyLicenseInputKey((prev) => prev + 1)
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      if (String(result?.ocr_result?.status || '').toUpperCase() === 'FAILED') {
        throw new Error(result?.ocr_result?.ocr_error || '营业执照识别失败')
      }
      showMessage('营业执照上传成功，可点击“智能填充公司信息”回填字段')
    } catch (err) {
      showError(err.message)
    } finally {
      setCompanyLicenseUploadBusy(false)
    }
  }

  const onDeleteBusinessLicense = async () => {
    resetFeedback()
    try {
      const assetId = Number(companyLicenseOcr?.asset_id || 0)
      if (assetId > 0) {
        await api.del(`/api/tender/assets/${assetId}`)
        await fetchAssets()
        fetchBootstrap().catch(() => {})
      }
      clearCompanyLicenseLocal()
      showMessage('营业执照已删除')
    } catch (err) {
      showError(err.message)
    }
  }

  const onDeleteIdCardFile = async (role, side) => {
    const roleKey = role === 'agent' ? 'agent' : 'legal'
    const roleLabelText = roleKey === 'agent' ? '授权委托人' : '法定代表人'
    const sideKey = side === 'back' ? 'back' : 'front'
    const sideLabel = sideKey === 'back' ? '反面' : '正面'
    const cacheKey = `${roleKey}_${sideKey}`
    resetFeedback()
    try {
      const assetId = Number(idCardAssetIds[cacheKey] || 0)
      if (assetId > 0) {
        await api.del(`/api/tender/assets/${assetId}`)
        await fetchAssets()
        fetchBootstrap().catch(() => {})
      }
      clearIdCardLocal(roleKey, sideKey)
      showMessage(`${roleLabelText}身份证${sideLabel}已删除`)
    } catch (err) {
      showError(err.message)
    }
  }

  const onSmartFillCompany = () => {
    resetFeedback()
    const fields = companyLicenseOcr?.fields_json || null
    if (!fields || String(companyLicenseOcr?.status || '').toUpperCase() === 'FAILED') {
      showError('请先上传并识别营业执照，再执行智能填充公司信息')
      return
    }
    applyCompanyFieldsFromOcr(fields)
    showMessage('已根据营业执照识别结果填充公司信息')
  }

  const onSmartGeneratePerformance = () => {
    setPerformanceForm((prev) => ({
      ...prev,
      brand_capability:
        prev.brand_capability ||
        '公司具备完整的交付体系、质量管理体系与售后服务体系，可覆盖项目实施全周期。',
      personnel_capability:
        prev.personnel_capability ||
        '项目团队由项目经理、技术负责人、实施工程师与售后支持组成，具备同类项目经验。',
    }))
    showMessage('已生成业绩补充信息示例')
  }

  if (booting) {
    return <div className="app-loading">标书协同制作系统初始化中...</div>
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong><span className="brand-red">聚信</span><span className="brand-blue">标书协同制作系统</span></strong>
        </div>
        <div className="user-pill">{user?.username || '-'} · {roleLabel(user?.role)}</div>

        <div className="menu">
          {visibleMainTabs.map((item) => (
            <button
              key={item.key}
              className={activeTab === item.key ? 'active' : ''}
              onClick={() => {
                setActiveTab(item.key)
                if (item.key === 'audit') fetchAuditLogs().catch((err) => showError(err.message))
                if (item.key === 'config' && canConfigManage) fetchConfigs().catch((err) => showError(err.message))
              }}
            >
              {item.label}
            </button>
          ))}
          {visibleOwnLibraryTabs.length ? (
            <div className="menu-group">
              <button
                className={`group-toggle ${activeTab.startsWith('library-') ? 'active' : ''}`}
                onClick={() => setLibraryMenuOpen((prev) => !prev)}
              >
                自有库
              </button>
              {libraryMenuOpen ? (
                <div className="submenu">
                  {visibleOwnLibraryTabs.map((item) => (
                    <button
                      key={item.key}
                      className={activeTab === item.key ? 'active' : ''}
                      onClick={() => {
                        setActiveTab(item.key)
                        if (item.key === 'library-qualification') fetchAssets().catch((err) => showError(err.message))
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="sidebar-actions">
          <button className="ghost" onClick={() => (window.location.href = buildPortalSwitchUrl('tender'))}>切换系统</button>
          <button className="ghost" onClick={() => (window.location.href = buildPortalEntryUrl('tender'))}>返回门户</button>
        </div>
      </aside>

      <main className="content">
        <section className="hero">
          <div>
            <h1>标书协同制作系统</h1>
            <p className="sub">支持多人在线编辑、模板一键填充、自有库管理、AI改写校对与全量审计。</p>
          </div>
          <div className="hero-actions">
            <button className="ghost" onClick={() => Promise.allSettled([fetchBootstrap(), fetchBids(), fetchBundles(), fetchAssets(), fetchModels()])}>刷新</button>
          </div>
        </section>

        {message ? <div className="toast success">{message}</div> : null}
        {error ? <div className="toast error">{error}</div> : null}
        {editorScriptError ? <div className="toast warning">{editorScriptError}</div> : null}

        {activeTab === 'dashboard' && (
          <section className="panel">
            <div className="panel-header"><h2>数据概览</h2></div>
            <div className="panel-body metric-grid">
              <div className="metric"><label>标书总数</label><strong>{stats.bids || 0}</strong></div>
              <div className="metric"><label>草稿数量</label><strong>{stats.drafts || 0}</strong></div>
              <div className="metric"><label>证照数量</label><strong>{stats.assets || 0}</strong></div>
              <div className="metric"><label>启用模型</label><strong>{stats.enabled_models || 0}</strong></div>
            </div>
          </section>
        )}

        {activeTab === 'bids' && (
          <section className="panel">
            <div className="panel-header"><h2>标书管理</h2></div>
            <div className="panel-body">
              {canWrite && (
                <div className="article-create" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 120px' }}>
                  <input value={bidForm.title} placeholder="标书标题" onChange={(e) => setBidForm((p) => ({ ...p, title: e.target.value }))} />
                  <input value={bidForm.customer_name} placeholder="客户名称" onChange={(e) => setBidForm((p) => ({ ...p, customer_name: e.target.value }))} />
                  <input value={bidForm.project_name} placeholder="项目名称" onChange={(e) => setBidForm((p) => ({ ...p, project_name: e.target.value }))} />
                  <input value={bidForm.summary} placeholder="摘要(可选)" onChange={(e) => setBidForm((p) => ({ ...p, summary: e.target.value }))} />
                  <button className="primary" onClick={onCreateBid}>新建</button>
                </div>
              )}

              {canWrite ? (
                <>
                  <div className="muted" style={{ margin: '4px 0 8px' }}>
                    上传招标文件后自动新建标书，并按模板包生成一份投标文件初稿。
                  </div>
                  <div className="article-create" style={{ gridTemplateColumns: '1fr 1.4fr 1fr 1fr 1fr 140px' }}>
                    <select
                      value={autoBidForm.bundle_id}
                      onChange={(e) => setAutoBidForm((p) => ({ ...p, bundle_id: e.target.value }))}
                      disabled={!activeBundles.length}
                    >
                      {!activeBundles.length ? (
                        <option value="">暂无可用模板包</option>
                      ) : (
                        activeBundles.map((bundle) => (
                          <option key={bundle.id} value={bundle.id}>
                            {bundle.name}（{bundle.bundle_code}）
                          </option>
                        ))
                      )}
                    </select>
                    <input
                      key={autoBidFileInputKey}
                      type="file"
                      accept=".doc,.docx,.pdf"
                      onChange={(e) => setAutoBidForm((p) => ({ ...p, file: e.target.files?.[0] || null }))}
                    />
                    <input
                      value={autoBidForm.title}
                      placeholder="生成标题(可选)"
                      onChange={(e) => setAutoBidForm((p) => ({ ...p, title: e.target.value }))}
                    />
                    <input
                      value={autoBidForm.customer_name}
                      placeholder="客户名称(可选)"
                      onChange={(e) => setAutoBidForm((p) => ({ ...p, customer_name: e.target.value }))}
                    />
                    <input
                      value={autoBidForm.project_name}
                      placeholder="项目名称(可选)"
                      onChange={(e) => setAutoBidForm((p) => ({ ...p, project_name: e.target.value }))}
                    />
                    <button className="primary" onClick={onAutoGenerateBid} disabled={!activeBundles.length}>
                      上传并生成
                    </button>
                  </div>
                </>
              ) : null}

              <div className="table">
                <div className="table-row header" style={{ gridTemplateColumns: '1fr 1fr 1fr 0.8fr 1fr 2.8fr' }}>
                  <span>编号/标题</span>
                  <span>客户</span>
                  <span>项目</span>
                  <span>状态</span>
                  <span>更新时间</span>
                  <span>操作</span>
                </div>
                {bids.map((item) => (
                  <div className="table-row" key={item.id} style={{ gridTemplateColumns: '1fr 1fr 1fr 0.8fr 1fr 2.8fr' }}>
                    <span><strong>{item.bid_no}</strong><br />{item.title}</span>
                    <span>{item.customer_name}</span>
                    <span>{item.project_name}</span>
                    <span>{bidStatusLabel(item.status)}</span>
                    <span>{formatDateTime(item.updated_at)}</span>
                    <span className="row-actions">
                      <button className="ghost" onClick={() => { setSelectedBid(item); fetchVersions(item.id).catch((err) => showError(err.message)) }}>版本</button>
                      {canWrite ? (
                        <>
                          <label className="ghost upload-btn">
                            上传版本
                            <input
                              type="file"
                              accept=".doc,.docx,.pdf"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) onUploadVersion(item.id, f)
                                e.target.value = ''
                              }}
                            />
                          </label>
                          <button className="ghost" onClick={() => onOpenEditor(item)}>协同编辑</button>
                          <select
                            value={fillBundleByBid[String(item.id)] || ''}
                            onChange={(e) => setFillBundleByBid((prev) => ({ ...prev, [String(item.id)]: e.target.value }))}
                            disabled={!activeBundles.length}
                          >
                            {!activeBundles.length ? (
                              <option value="">暂无可用模板包</option>
                            ) : (
                              activeBundles.map((bundle) => (
                                <option key={bundle.id} value={bundle.id}>
                                  {bundle.name}（{bundle.bundle_code}）
                                </option>
                              ))
                            )}
                          </select>
                          <button className="ghost" onClick={() => onApplyTemplate(item)} disabled={!activeBundles.length}>
                            套用模板
                          </button>
                          <select value={item.status} onChange={(e) => onChangeBidStatus(item, e.target.value)}>
                            {bidStatusOptions.map((status) => (
                              <option key={status.value} value={status.value}>{status.label}</option>
                            ))}
                          </select>
                        </>
                      ) : null}
                    </span>
                  </div>
                ))}
                {!bids.length ? <div className="empty">暂无标书</div> : null}
              </div>

              {selectedBid && (
                <div style={{ marginTop: 14 }}>
                  <h3>版本历史 - {selectedBid.title}</h3>
                  <div className="table">
                    <div className="table-row header" style={{ gridTemplateColumns: '0.5fr 0.8fr 1fr 1fr' }}>
                      <span>版本</span>
                      <span>类型</span>
                      <span>文件</span>
                      <span>时间</span>
                    </div>
                    {versions.map((v) => (
                      <div className="table-row" key={v.id} style={{ gridTemplateColumns: '0.5fr 0.8fr 1fr 1fr' }}>
                        <span>v{v.version_no}</span>
                        <span>{versionSourceLabel(v.source_type)}</span>
                        <span>{v.file_name}</span>
                        <span>{formatDateTime(v.created_at)}</span>
                      </div>
                    ))}
                    {!versions.length ? <div className="empty">暂无版本</div> : null}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'editor' && (
          <section className="panel">
            <div className="panel-header"><h2>在线编辑</h2></div>
            <div className="panel-body">
              <div className="table">
                <div className="table-row header" style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr' }}>
                  <span>标书</span>
                  <span>状态</span>
                  <span>操作</span>
                </div>
                {bids.map((item) => (
                  <div className="table-row" key={item.id} style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr' }}>
                    <span>{item.bid_no} / {item.title}</span>
                    <span>{bidStatusLabel(item.status)}</span>
                    <span className="row-actions">
                      {canWrite ? <button className="primary" onClick={() => onOpenEditor(item)}>打开协同</button> : <span className="muted">只读</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'library-company' && (
          <section className="panel">
            <div className="panel-header"><h2>公司信息</h2></div>
            <div className="panel-body">
              <div className="panel" style={{ marginBottom: 12 }}>
                <div className="panel-header">
                  <h2>公司基础信息</h2>
                  <button className="ghost" onClick={onSmartFillCompany}>智能填充公司信息</button>
                </div>
                <div className="panel-body">
                  <div className="license-upload-layout">
                    <div className="upload-preview-tile">
                      <strong>营业执照预览</strong>
                      <div className="upload-preview-frame">
                        {companyLicenseUpload.preview_url ? (
                          <img src={companyLicenseUpload.preview_url} alt="营业执照预览" />
                        ) : (
                          <div className="upload-preview-placeholder">未选择图片</div>
                        )}
                      </div>
                      <small className="muted">{companyLicenseUpload.file_name || '仅图片可预览，PDF不显示缩略图'}</small>
                    </div>
                    <div className="license-upload-actions">
                      <label className="ghost upload-inline-btn">
                        选择营业执照
                        <input
                          key={companyLicenseInputKey}
                          type="file"
                          accept=".jpg,.jpeg,.png,.pdf"
                          onChange={(e) => setCompanyLicenseFile(e.target.files?.[0] || null)}
                        />
                      </label>
                      <button className="primary" onClick={onUploadBusinessLicense} disabled={companyLicenseUploadBusy}>
                        {companyLicenseUploadBusy ? '上传中' : '上传营业执照'}
                      </button>
                      <button
                        className="ghost"
                        onClick={onDeleteBusinessLicense}
                        disabled={
                          !companyLicenseOcr.asset_id &&
                          !companyLicenseUpload.preview_url &&
                          !companyLicenseUpload.file &&
                          !companyLicenseUpload.file_name
                        }
                      >
                        删除营业执照
                      </button>
                      <span className="muted">
                        {companyLicenseOcr.file_name
                          ? `已上传：${companyLicenseOcr.file_name}（${ocrStatusLabel(companyLicenseOcr.status)}）`
                          : '请先上传营业执照，再点击智能填充'}
                      </span>
                    </div>
                  </div>
                  <div className="library-grid columns-3">
                    <label><span>公司名称</span><input value={companyForm.company_name} onChange={(e) => setCompanyForm((p) => ({ ...p, company_name: e.target.value }))} /></label>
                    <label><span>统一社会信用代码</span><input value={companyForm.uscc} onChange={(e) => setCompanyForm((p) => ({ ...p, uscc: e.target.value }))} /></label>
                    <label><span>注册资金（万元）</span><input value={companyForm.registered_capital} onChange={(e) => setCompanyForm((p) => ({ ...p, registered_capital: e.target.value }))} /></label>
                    <label><span>公司性质</span><input value={companyForm.company_nature} onChange={(e) => setCompanyForm((p) => ({ ...p, company_nature: e.target.value }))} /></label>
                    <label><span>成立日期</span><input type="date" value={companyForm.established_date} onChange={(e) => setCompanyForm((p) => ({ ...p, established_date: e.target.value }))} /></label>
                    <label><span>经营期限</span><input value={companyForm.business_term} onChange={(e) => setCompanyForm((p) => ({ ...p, business_term: e.target.value }))} /></label>
                    <label><span>联系电话</span><input value={companyForm.contact_phone} onChange={(e) => setCompanyForm((p) => ({ ...p, contact_phone: e.target.value }))} /></label>
                    <label><span>公司邮箱</span><input value={companyForm.company_email} onChange={(e) => setCompanyForm((p) => ({ ...p, company_email: e.target.value }))} /></label>
                    <label><span>邮政编码</span><input value={companyForm.postal_code} onChange={(e) => setCompanyForm((p) => ({ ...p, postal_code: e.target.value }))} /></label>
                    <label className="span-3"><span>公司地址</span><input value={companyForm.company_address} onChange={(e) => setCompanyForm((p) => ({ ...p, company_address: e.target.value }))} /></label>
                    <label><span>登记机关</span><input value={companyForm.registration_authority} onChange={(e) => setCompanyForm((p) => ({ ...p, registration_authority: e.target.value }))} /></label>
                    <label className="span-2"><span>经营范围</span><input value={companyForm.business_scope} onChange={(e) => setCompanyForm((p) => ({ ...p, business_scope: e.target.value }))} /></label>
                  </div>
                </div>
              </div>

              <div className="panel" style={{ marginTop: 12, marginBottom: 12 }}>
                <div className="panel-header">
                  <h2>法人信息</h2>
                  <button className="ghost" onClick={() => onSmartFillPersonnelByRole('legal')}>智能填充法人信息</button>
                </div>
                <div className="panel-body">
                  <div className="library-grid columns-3">
                    <label><span>法定代表人</span><input value={personnelForm.legal_name} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_name: e.target.value }))} /></label>
                    <label><span>身份证号</span><input value={personnelForm.legal_id_no} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_id_no: e.target.value }))} /></label>
                    <label><span>性别</span><select value={personnelForm.legal_gender} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_gender: e.target.value }))}><option value="">请选择</option><option value="男">男</option><option value="女">女</option></select></label>
                    <label><span>出生日期</span><input type="date" value={personnelForm.legal_birth_date} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_birth_date: e.target.value }))} /></label>
                    <label><span>身份证有效期起</span><input type="date" value={personnelForm.legal_id_valid_from} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_id_valid_from: e.target.value }))} /></label>
                    <label><span>身份证有效期止</span><input type="date" value={personnelForm.legal_id_valid_to} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_id_valid_to: e.target.value }))} /></label>
                    <label><span>职位</span><input value={personnelForm.legal_position} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_position: e.target.value }))} /></label>
                    <label className="field-inline"><span>长期有效</span><input type="checkbox" checked={personnelForm.legal_id_long_term} onChange={(e) => setPersonnelForm((p) => ({ ...p, legal_id_long_term: e.target.checked }))} /></label>
                    <div className="span-3">
                      <span>身份证照片（正反面）</span>
                      <div className="idcard-upload-grid">
                        <div className="upload-preview-tile">
                          <strong>正面</strong>
                          <div className="upload-preview-frame">
                            {idCardPreview.legal_front ? (
                              <img src={idCardPreview.legal_front} alt="法定代表人身份证正面" />
                            ) : (
                              <div className="upload-preview-placeholder">点击上传正面</div>
                            )}
                          </div>
                          <label className="ghost upload-inline-btn">
                            选择正面
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png"
                              disabled={idCardRecognizing.legal}
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null
                                setPersonnelForm((p) => ({ ...p, legal_id_front_file: file }))
                                setIdCardFilePreview('legal_front', file)
                                if (file) onUploadIdCardAndAutofill('legal', 'front', file)
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => onDeleteIdCardFile('legal', 'front')}
                            disabled={!idCardAssetIds.legal_front && !idCardPreview.legal_front}
                          >
                            删除正面
                          </button>
                          <small className="muted">{personnelForm.legal_id_front_file?.name || '未选择文件'}</small>
                        </div>

                        <div className="upload-preview-tile">
                          <strong>反面</strong>
                          <div className="upload-preview-frame">
                            {idCardPreview.legal_back ? (
                              <img src={idCardPreview.legal_back} alt="法定代表人身份证反面" />
                            ) : (
                              <div className="upload-preview-placeholder">点击上传反面</div>
                            )}
                          </div>
                          <label className="ghost upload-inline-btn">
                            选择反面
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png"
                              disabled={idCardRecognizing.legal}
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null
                                setPersonnelForm((p) => ({ ...p, legal_id_back_file: file }))
                                setIdCardFilePreview('legal_back', file)
                                if (file) onUploadIdCardAndAutofill('legal', 'back', file)
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => onDeleteIdCardFile('legal', 'back')}
                            disabled={!idCardAssetIds.legal_back && !idCardPreview.legal_back}
                          >
                            删除反面
                          </button>
                          <small className="muted">{personnelForm.legal_id_back_file?.name || '未选择文件'}</small>
                        </div>
                      </div>
                      {idCardRecognizing.legal ? <small className="muted">识别中...</small> : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>授权委托人信息</h2>
                  <button className="ghost" onClick={() => onSmartFillPersonnelByRole('agent')}>智能填充委托人信息</button>
                </div>
                <div className="panel-body">
                  <div className="library-grid columns-3">
                    <label><span>授权委托人</span><input value={personnelForm.agent_name} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_name: e.target.value }))} /></label>
                    <label><span>身份证号</span><input value={personnelForm.agent_id_no} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_id_no: e.target.value }))} /></label>
                    <label><span>性别</span><select value={personnelForm.agent_gender} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_gender: e.target.value }))}><option value="">请选择</option><option value="男">男</option><option value="女">女</option></select></label>
                    <label><span>出生日期</span><input type="date" value={personnelForm.agent_birth_date} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_birth_date: e.target.value }))} /></label>
                    <label><span>身份证有效期起</span><input type="date" value={personnelForm.agent_id_valid_from} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_id_valid_from: e.target.value }))} /></label>
                    <label><span>身份证有效期止</span><input type="date" value={personnelForm.agent_id_valid_to} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_id_valid_to: e.target.value }))} /></label>
                    <label><span>职位</span><input value={personnelForm.agent_position} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_position: e.target.value }))} /></label>
                    <label className="field-inline"><span>长期有效</span><input type="checkbox" checked={personnelForm.agent_id_long_term} onChange={(e) => setPersonnelForm((p) => ({ ...p, agent_id_long_term: e.target.checked }))} /></label>
                    <div className="span-3">
                      <span>身份证照片（正反面）</span>
                      <div className="idcard-upload-grid">
                        <div className="upload-preview-tile">
                          <strong>正面</strong>
                          <div className="upload-preview-frame">
                            {idCardPreview.agent_front ? (
                              <img src={idCardPreview.agent_front} alt="授权委托人身份证正面" />
                            ) : (
                              <div className="upload-preview-placeholder">点击上传正面</div>
                            )}
                          </div>
                          <label className="ghost upload-inline-btn">
                            选择正面
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png"
                              disabled={idCardRecognizing.agent}
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null
                                setPersonnelForm((p) => ({ ...p, agent_id_front_file: file }))
                                setIdCardFilePreview('agent_front', file)
                                if (file) onUploadIdCardAndAutofill('agent', 'front', file)
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => onDeleteIdCardFile('agent', 'front')}
                            disabled={!idCardAssetIds.agent_front && !idCardPreview.agent_front}
                          >
                            删除正面
                          </button>
                          <small className="muted">{personnelForm.agent_id_front_file?.name || '未选择文件'}</small>
                        </div>

                        <div className="upload-preview-tile">
                          <strong>反面</strong>
                          <div className="upload-preview-frame">
                            {idCardPreview.agent_back ? (
                              <img src={idCardPreview.agent_back} alt="授权委托人身份证反面" />
                            ) : (
                              <div className="upload-preview-placeholder">点击上传反面</div>
                            )}
                          </div>
                          <label className="ghost upload-inline-btn">
                            选择反面
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png"
                              disabled={idCardRecognizing.agent}
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null
                                setPersonnelForm((p) => ({ ...p, agent_id_back_file: file }))
                                setIdCardFilePreview('agent_back', file)
                                if (file) onUploadIdCardAndAutofill('agent', 'back', file)
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => onDeleteIdCardFile('agent', 'back')}
                            disabled={!idCardAssetIds.agent_back && !idCardPreview.agent_back}
                          >
                            删除反面
                          </button>
                          <small className="muted">{personnelForm.agent_id_back_file?.name || '未选择文件'}</small>
                        </div>
                      </div>
                      {idCardRecognizing.agent ? <small className="muted">识别中...</small> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'library-qualification' && (
          <section className="panel">
            <div className="panel-header"><h2>资质管理</h2></div>
            <div className="panel-body">
              {canWrite ? (
                <div className="article-create" style={{ gridTemplateColumns: '0.8fr 1fr 120px' }}>
                  <select value={assetUploadForm.asset_type} onChange={(e) => setAssetUploadForm((p) => ({ ...p, asset_type: e.target.value }))}>
                    <option value="QUALIFICATION">资质证书</option>
                    <option value="BUSINESS_LICENSE">营业执照</option>
                    <option value="ID_CARD">身份证</option>
                    <option value="EDUCATION_CERT">毕业证</option>
                    <option value="CONTRACT">合同</option>
                    <option value="BIDDING_NOTICE">招标文件</option>
                    <option value="OTHER">其他</option>
                  </select>
                  <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setAssetUploadForm((p) => ({ ...p, file: e.target.files?.[0] || null }))} />
                  <button className="primary" onClick={onUploadAsset}>上传</button>
                </div>
              ) : null}

              <div className="table">
                <div className="table-row header" style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr 1fr 1.4fr' }}>
                  <span>文件</span>
                  <span>类型</span>
                  <span>OCR状态</span>
                  <span>上传时间</span>
                  <span>操作</span>
                </div>
                {assets.map((item) => (
                  <div className="table-row" key={item.id} style={{ gridTemplateColumns: '1fr 0.8fr 0.8fr 1fr 1.4fr' }}>
                    <span>{item.original_file_name}</span>
                    <span>{assetTypeLabel(item.asset_type)}</span>
                    <span>{ocrStatusLabel(item.ocr_status)}</span>
                    <span>{formatDateTime(item.created_at)}</span>
                    <span className="row-actions">
                      <a className="ghost" href={`${API_BASE}/api/tender/assets/${item.id}/preview`} target="_blank" rel="noreferrer">预览</a>
                      <a className="ghost" href={`${API_BASE}/api/tender/assets/${item.id}/download`} target="_blank" rel="noreferrer">下载</a>
                      {canWrite ? <button className="ghost" onClick={() => onConfirmOcr(item)}>确认OCR</button> : null}
                    </span>
                  </div>
                ))}
                {!assets.length ? <div className="empty">暂无资质文件</div> : null}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'library-finance' && (
          <section className="panel">
            <div className="panel-header"><h2>财务信息</h2></div>
            <div className="panel-body">
              <div className="library-grid columns-3">
                <label><span>开户名称</span><input value={financeForm.account_name} onChange={(e) => setFinanceForm((p) => ({ ...p, account_name: e.target.value }))} /></label>
                <label><span>银行账号</span><input value={financeForm.bank_account} onChange={(e) => setFinanceForm((p) => ({ ...p, bank_account: e.target.value }))} /></label>
                <label><span>开户银行</span><input value={financeForm.bank_name} onChange={(e) => setFinanceForm((p) => ({ ...p, bank_name: e.target.value }))} /></label>
                <label><span>银行地址</span><input value={financeForm.bank_address} onChange={(e) => setFinanceForm((p) => ({ ...p, bank_address: e.target.value }))} /></label>
                <label><span>银行行号</span><input value={financeForm.bank_branch_no} onChange={(e) => setFinanceForm((p) => ({ ...p, bank_branch_no: e.target.value }))} /></label>
                <label><span>银行电话</span><input value={financeForm.bank_phone} onChange={(e) => setFinanceForm((p) => ({ ...p, bank_phone: e.target.value }))} /></label>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'library-performance' && (
          <section className="panel">
            <div className="panel-header"><h2>业绩管理</h2></div>
            <div className="panel-body">
              <div className="library-actions">
                <button className="ghost" onClick={onSmartGeneratePerformance}>智能生成</button>
              </div>
              <div className="library-grid columns-2">
                <label><span>品牌资源能力</span><textarea value={performanceForm.brand_capability} onChange={(e) => setPerformanceForm((p) => ({ ...p, brand_capability: e.target.value }))} /></label>
                <label><span>人员技术能力</span><textarea value={performanceForm.personnel_capability} onChange={(e) => setPerformanceForm((p) => ({ ...p, personnel_capability: e.target.value }))} /></label>
                <label>
                  <span>相关图片</span>
                  <input type="file" accept=".jpg,.jpeg,.png" onChange={(e) => setPerformanceForm((p) => ({ ...p, related_image_file: e.target.files?.[0] || null }))} />
                </label>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'library-personnel' && (
          <section className="panel">
            <div className="panel-header"><h2>人员管理</h2></div>
            <div className="panel-body">
              <div className="empty">法人信息与授权委托人信息已迁移到「公司信息」。</div>
            </div>
          </section>
        )}

        {activeTab === 'ai' && (
          <section className="panel">
            <div className="panel-header"><h2>AI助手</h2></div>
            <div className="panel-body">
              <div className="filters" style={{ gridTemplateColumns: '160px 220px 1fr 120px' }}>
                <select value={aiForm.task} onChange={(e) => setAiForm((p) => ({ ...p, task: e.target.value }))}>
                  <option value="ocr-structured">OCR结构化</option>
                  <option value="rewrite">段落改写</option>
                  <option value="proofread">合规校对</option>
                </select>
                <select value={aiForm.model_id} onChange={(e) => setAiForm((p) => ({ ...p, model_id: e.target.value }))}>
                  <option value="">默认模型</option>
                  {models.filter((m) => m.is_enabled).map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.model_key})</option>
                  ))}
                </select>
                {aiForm.task === 'ocr-structured' ? (
                  <input value={aiForm.ocr_text} onChange={(e) => setAiForm((p) => ({ ...p, ocr_text: e.target.value }))} placeholder="粘贴OCR原文" />
                ) : (
                  <input value={aiForm.input_text} onChange={(e) => setAiForm((p) => ({ ...p, input_text: e.target.value }))} placeholder="输入或粘贴标书文本" />
                )}
                <button className="primary" onClick={onRunAiTask}>执行</button>
              </div>

              {aiForm.task === 'rewrite' ? (
                <div style={{ marginBottom: 10 }}>
                  <input value={aiForm.style} onChange={(e) => setAiForm((p) => ({ ...p, style: e.target.value }))} placeholder="改写风格" />
                </div>
              ) : null}

              <div className="panel" style={{ marginTop: 8 }}>
                <div className="panel-header"><h2>AI结果</h2></div>
                <div className="panel-body">
                  {!aiResult ? <div className="muted">暂无结果</div> : (
                    <>
                      <div className="muted">模型：{aiResult.model?.name || '-'}，耗时：{aiResult.latency_ms || 0}ms，Tokens：{aiResult.usage?.total_tokens || 0}</div>
                      <pre style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{aiResult.content}</pre>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'audit' && (
          <section className="panel">
            <div className="panel-header"><h2>审计日志</h2></div>
            <div className="panel-body">
              <div className="filters" style={{ gridTemplateColumns: '1fr 1fr 1fr 120px 120px' }}>
                <input value={auditFilter.username} placeholder="用户名" onChange={(e) => setAuditFilter((p) => ({ ...p, username: e.target.value }))} />
                <input value={auditFilter.action} placeholder="动作" onChange={(e) => setAuditFilter((p) => ({ ...p, action: e.target.value }))} />
                <input value={auditFilter.entity} placeholder="对象" onChange={(e) => setAuditFilter((p) => ({ ...p, entity: e.target.value }))} />
                <button className="primary" onClick={fetchAuditLogs}>查询</button>
                <a className="ghost" href={`${API_BASE}/api/tender/audit/logs/export`} target="_blank" rel="noreferrer">导出CSV</a>
              </div>

              <div className="table">
                <div className="table-row header" style={{ gridTemplateColumns: '1fr 0.7fr 0.7fr 1fr 0.8fr' }}>
                  <span>时间</span>
                  <span>用户</span>
                  <span>动作</span>
                  <span>对象</span>
                  <span>说明</span>
                </div>
                {auditLogs.map((item) => (
                  <div className="table-row" key={item.id} style={{ gridTemplateColumns: '1fr 0.7fr 0.7fr 1fr 0.8fr' }}>
                    <span>{formatDateTime(item.created_at)}</span>
                    <span>{item.username}</span>
                    <span>{item.action}</span>
                    <span>{item.entity}#{item.entity_id || 0}</span>
                    <span>{item.message || '-'}</span>
                  </div>
                ))}
                {!auditLogs.length ? <div className="empty">暂无审计日志</div> : null}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'config' && canConfigManage && (
          <section className="panel">
            <div className="panel-header"><h2>系统配置</h2></div>
            <div className="panel-body">
              <h3 style={{ margin: '0 0 8px' }}>审计配置</h3>
              <div className="article-create" style={{ gridTemplateColumns: '260px 160px', marginBottom: 10 }}>
                <input
                  value={configs.audit_retention_days || 365}
                  onChange={(e) => setConfigs((p) => ({ ...p, audit_retention_days: e.target.value }))}
                  placeholder="审计留存天数"
                />
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center' }}>默认 365 天，不得低于 30 天。</span>
              </div>

              <h3 style={{ margin: '8px 0' }}>OCR配置（阿里云）</h3>
              <div className="article-create" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <select
                  value={configs.ocr_enabled ? '1' : '0'}
                  onChange={(e) => setConfigs((p) => ({ ...p, ocr_enabled: e.target.value === '1' }))}
                >
                  <option value="1">启用OCR</option>
                  <option value="0">停用OCR</option>
                </select>
                <input
                  value={configs.ocr_access_key_id || ''}
                  onChange={(e) => setConfigs((p) => ({ ...p, ocr_access_key_id: e.target.value }))}
                  placeholder="AccessKey ID"
                />
                <input
                  type="password"
                  value={configs.ocr_access_key_secret || ''}
                  onChange={(e) => setConfigs((p) => ({ ...p, ocr_access_key_secret: e.target.value }))}
                  placeholder="AccessKey Secret（已配置显示******）"
                />
                <input
                  value={configs.ocr_endpoint || ''}
                  onChange={(e) => setConfigs((p) => ({ ...p, ocr_endpoint: e.target.value }))}
                  placeholder="OCR Endpoint"
                />
                <input
                  value={configs.ocr_api_version || ''}
                  onChange={(e) => setConfigs((p) => ({ ...p, ocr_api_version: e.target.value }))}
                  placeholder="OCR API Version"
                />
                <input
                  value={configs.ocr_timeout_ms || 15000}
                  onChange={(e) => setConfigs((p) => ({ ...p, ocr_timeout_ms: e.target.value }))}
                  placeholder="OCR超时(ms)"
                />
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                密钥不会明文回显。留空保存会清空数据库密钥；输入 `******` 表示保持不变。
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="primary" onClick={onUpdateConfig}>保存配置</button>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'models' && canAiManage && (
          <section className="panel">
            <div className="panel-header"><h2>模型管理</h2></div>
            <div className="panel-body">
              <div className="article-create" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr 100px' }}>
                <input placeholder="显示名" value={modelForm.name} onChange={(e) => setModelForm((p) => ({ ...p, name: e.target.value }))} />
                <input placeholder="model_key" value={modelForm.model_key} onChange={(e) => setModelForm((p) => ({ ...p, model_key: e.target.value }))} />
                <input placeholder="base_url" value={modelForm.base_url} onChange={(e) => setModelForm((p) => ({ ...p, base_url: e.target.value }))} />
                <input placeholder="model_name" value={modelForm.model_name} onChange={(e) => setModelForm((p) => ({ ...p, model_name: e.target.value }))} />
                <input placeholder="api_key" value={modelForm.api_key} onChange={(e) => setModelForm((p) => ({ ...p, api_key: e.target.value }))} />
                <input placeholder="max_tokens" value={modelForm.max_tokens} onChange={(e) => setModelForm((p) => ({ ...p, max_tokens: e.target.value }))} />
                <button className="primary" onClick={onCreateCustomModel}>新增</button>
              </div>

              <div className="table" style={{ marginTop: 12 }}>
                <div className="table-row header" style={{ gridTemplateColumns: '1fr 0.8fr 1fr 0.6fr 0.8fr 0.8fr' }}>
                  <span>名称</span>
                  <span>key</span>
                  <span>model</span>
                  <span>默认</span>
                  <span>启用</span>
                  <span>操作</span>
                </div>
                {models.map((item) => (
                  <div className="table-row" key={item.id} style={{ gridTemplateColumns: '1fr 0.8fr 1fr 0.6fr 0.8fr 0.8fr' }}>
                    <span>{item.name}</span>
                    <span>{item.model_key}</span>
                    <span>{item.model_name}</span>
                    <span>{item.is_default ? '是' : '否'}</span>
                    <span>{item.is_enabled ? '是' : '否'}</span>
                    <span className="row-actions">
                      {!item.is_default ? <button className="ghost" onClick={() => onSetDefaultModel(item.id)}>设为默认</button> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {editorVisible && editorPayload?.editor ? (
        <div className="editor-modal-mask" onClick={onCloseEditor}>
          <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="editor-modal-top">
              <div className="editor-modal-intro">
                <p className="editor-kicker">OnlyOffice 协同编辑</p>
                <h3>{selectedBid?.title || '在线编辑'}</h3>
              </div>
              <div className="editor-header-actions">
                <button className="ghost" onClick={onCloseEditor}>关闭</button>
              </div>
            </div>
            <div className="editor-workbench">
              <div className="editor-frame-shell">
                <div id={editorContainerId} className="doc-editor-container" />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App

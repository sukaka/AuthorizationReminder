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

const stripHtml = (text) => String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

const isHtmlResponseText = (text) => /<\s*html[\s>]/i.test(String(text || '')) || /<\s*body[\s>]/i.test(String(text || ''))

const buildHttpError = ({ res, parsed, text }) => {
  const bodyMsg = parsed?.error || parsed?.message
  if (bodyMsg) return bodyMsg
  if (isHtmlResponseText(text)) {
    if (res.status === 504) return '分析请求超时（网关 504），请稍后重试；如频繁出现请联系管理员检查模型服务响应时长。'
    if (res.status === 502) return '网关异常（502），请检查后端服务与模型连接状态。'
    return `请求失败（HTTP ${res.status}），服务返回了非结构化错误页面。`
  }
  const plainText = stripHtml(text)
  if (plainText) return plainText.slice(0, 300)
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

const parseDateLike = (value) => {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const date = new Date(text.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return null
  return date
}

const toDateKey = (date) => {
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toPercent = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(100, Math.round(num)))
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

const calculateAgeFromBirthDate = (value) => {
  const text = normalizeDateToInput(value)
  if (!text) return '-'
  const birth = new Date(`${text}T00:00:00`)
  if (Number.isNaN(birth.getTime())) return '-'
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDelta = now.getMonth() - birth.getMonth()
  const dayDelta = now.getDate() - birth.getDate()
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) age -= 1
  return age >= 0 ? String(age) : '-'
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

const toMeaningfulText = (value) => {
  const text = String(value ?? '').trim()
  if (!text || text === '未明确') return ''
  return text
}

const toMeaningfulList = (value) => {
  if (Array.isArray(value)) return value.map((item) => toMeaningfulText(item)).filter(Boolean)
  const text = toMeaningfulText(value)
  return text ? [text] : []
}

const inferQualificationMaterial = (text) => {
  const source = String(text || '')
  if (source.includes('信用') || source.includes('失信')) return '信用中国、中国政府采购网查询截图'
  if (source.includes('财务') || source.includes('审计')) return '财务报表或审计报告'
  if (source.includes('业绩') || source.includes('合同')) return '合同关键页、验收证明'
  if (source.includes('资质') || source.includes('许可') || source.includes('证书')) return '资质证书或许可证扫描件'
  if (source.includes('社保') || source.includes('人员')) return '人员证书、社保或劳动合同'
  if (source.includes('授权') || source.includes('制造商')) return '授权书原件或盖章扫描件'
  return '按招标文件要求提供对应证明材料'
}

const mainTabs = [
  { key: 'dashboard', label: '仪表盘' },
  { key: 'bids', label: '标书管理' },
  { key: 'bid-generate', label: '标书生成' },
  { key: 'editor', label: '在线编辑' },
  { key: 'ai', label: 'AI助手' },
  { key: 'audit', label: '审计日志' },
  { key: 'config', label: '系统配置' },
]

const ownLibraryTabs = [
  { key: 'library-company', label: '公司信息' },
  { key: 'library-samples', label: '样本库管理' },
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

const bidCategoryOptions = [
  { value: 'SERVICE', label: '服务类' },
  { value: 'PRODUCT', label: '产品类' },
]

const bidCategoryLabelMap = bidCategoryOptions.reduce((acc, cur) => {
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

const qualificationNameOptions = [
  '建筑业企业资质证书',
  '安全生产许可证',
  '质量管理体系认证证书',
  '环境管理体系认证证书',
  '职业健康安全管理体系认证证书',
  '高新技术企业证书',
]

const qualificationLevelOptions = [
  '一级',
  '二级',
  '三级',
  '甲级',
  '乙级',
  '丙级',
  'A',
  'B',
  'C',
]

const financeInfoTypeOptions = [
  '财务报表',
  '审计报告',
  '纳税证明',
  '银行资信证明',
  '完税凭证',
  '银行流水',
  '其他',
]

const performanceProjectTypeOptions = [
  '信息化建设',
  '系统集成',
  '软件开发',
  '运维服务',
  '咨询服务',
  '其他',
]

const performancePartyTypeOptions = [
  '政府单位',
  '事业单位',
  '国有企业',
  '民营企业',
  '外资企业',
  '其他',
]

const personnelEducationOptions = [
  '博士',
  '硕士',
  '本科',
  '大专',
  '中专',
  '高中',
  '其他',
]

const personnelPositionOptions = [
  '项目经理',
  '技术负责人',
  '实施工程师',
  '商务经理',
  '法务专员',
  '其他',
]

const personnelStatusOptions = ['在职', '离职', '外聘']

const PERFORMANCE_STORAGE_KEY = 'tender.performance.entries.v1'
const PERSONNEL_STORAGE_KEY = 'tender.personnel.entries.v1'

const loadPerformanceEntries = () => {
  try {
    const raw = localStorage.getItem(PERFORMANCE_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const id = Number(item?.id || 0)
        if (!Number.isFinite(id) || id <= 0) return null
        return {
          id,
          project_name: firstNonEmpty(item.project_name),
          project_no: firstNonEmpty(item.project_no),
          project_type: firstNonEmpty(item.project_type),
          package_no: firstNonEmpty(item.package_no),
          party_a_name: firstNonEmpty(item.party_a_name),
          party_a_type: firstNonEmpty(item.party_a_type),
          project_amount: firstNonEmpty(item.project_amount),
          project_leader: firstNonEmpty(item.project_leader),
          contact_phone: firstNonEmpty(item.contact_phone),
          contract_valid_from: normalizeDateToInput(firstNonEmpty(item.contract_valid_from)),
          contract_valid_to: normalizeDateToInput(firstNonEmpty(item.contract_valid_to)),
          project_content: firstNonEmpty(item.project_content),
          remark: firstNonEmpty(item.remark),
          created_at: firstNonEmpty(item.created_at) || new Date().toISOString(),
          updated_at: firstNonEmpty(item.updated_at) || new Date().toISOString(),
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.id) - Number(a.id))
  } catch {
    return []
  }
}

const savePerformanceEntries = (rows) => {
  try {
    localStorage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(Array.isArray(rows) ? rows : []))
  } catch {
    // ignore
  }
}

const createStaffAttachment = () => ({
  assetId: null,
  file: null,
  fileName: '',
  previewUrl: '',
  mimeType: '',
  ocrFields: null,
  ocrStatus: '',
  ocrError: '',
})

const staffAttachmentKeys = ['id_card', 'education_cert', 'contract', 'driver_license', 'social_security']

const buildAssetPreviewUrl = (assetId, mimeType) => {
  const id = Number(assetId || 0)
  if (!id) return ''
  return String(mimeType || '').toLowerCase().startsWith('image/')
    ? `${API_BASE}/api/tender/assets/${id}/preview`
    : ''
}

const normalizeStaffAttachment = (item) => {
  const base = createStaffAttachment()
  const assetId = Number(item?.asset_id || item?.assetId || 0)
  const mimeType = firstNonEmpty(item?.mime_type, item?.mimeType)
  const previewUrl = firstNonEmpty(item?.preview_url, item?.previewUrl) || buildAssetPreviewUrl(assetId, mimeType)
  return {
    ...base,
    assetId: Number.isFinite(assetId) && assetId > 0 ? assetId : null,
    fileName: firstNonEmpty(item?.file_name, item?.fileName),
    previewUrl,
    mimeType,
    ocrFields: item?.ocr_fields || item?.ocrFields || null,
    ocrStatus: firstNonEmpty(item?.ocr_status, item?.ocrStatus),
    ocrError: firstNonEmpty(item?.ocr_error, item?.ocrError),
  }
}

const createStaffDialog = () => ({
  open: false,
  itemId: null,
  name: '',
  gender: '',
  birth_date: '',
  id_no: '',
  id_valid_from: '',
  id_valid_to: '',
  id_long_term: false,
  education: '',
  major: '',
  job_title: '',
  position: '',
  contact_phone: '',
  status: '在职',
  start_work_date: '',
  qualification_cert: '',
  id_card: createStaffAttachment(),
  education_cert: createStaffAttachment(),
  contract: createStaffAttachment(),
  driver_license: createStaffAttachment(),
  social_security: createStaffAttachment(),
})

const loadPersonnelEntries = () => {
  try {
    const raw = localStorage.getItem(PERSONNEL_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const id = Number(item?.id || 0)
        if (!Number.isFinite(id) || id <= 0) return null
        const attachments = item?.attachments || {}
        return {
          id,
          name: firstNonEmpty(item?.name),
          gender: firstNonEmpty(item?.gender),
          birth_date: normalizeDateToInput(firstNonEmpty(item?.birth_date)),
          id_no: normalizeIdNo(firstNonEmpty(item?.id_no)),
          id_valid_from: normalizeDateToInput(firstNonEmpty(item?.id_valid_from)),
          id_valid_to: normalizeDateToInput(firstNonEmpty(item?.id_valid_to)),
          id_long_term: Number(item?.id_long_term || 0) > 0,
          education: firstNonEmpty(item?.education),
          major: firstNonEmpty(item?.major),
          job_title: firstNonEmpty(item?.job_title),
          position: firstNonEmpty(item?.position),
          contact_phone: firstNonEmpty(item?.contact_phone),
          status: firstNonEmpty(item?.status, '在职'),
          start_work_date: normalizeDateToInput(firstNonEmpty(item?.start_work_date)),
          qualification_cert: firstNonEmpty(item?.qualification_cert),
          attachments: {
            id_card: normalizeStaffAttachment(attachments.id_card),
            education_cert: normalizeStaffAttachment(attachments.education_cert),
            contract: normalizeStaffAttachment(attachments.contract),
            driver_license: normalizeStaffAttachment(attachments.driver_license),
            social_security: normalizeStaffAttachment(attachments.social_security),
          },
          created_at: firstNonEmpty(item?.created_at) || new Date().toISOString(),
          updated_at: firstNonEmpty(item?.updated_at) || new Date().toISOString(),
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.id) - Number(a.id))
  } catch {
    return []
  }
}

const savePersonnelEntries = (rows) => {
  try {
    const normalized = (Array.isArray(rows) ? rows : []).map((item) => {
      const attachments = item?.attachments || {}
      return {
        ...item,
        attachments: {
          id_card: {
            asset_id: attachments.id_card?.assetId || null,
            file_name: firstNonEmpty(attachments.id_card?.fileName),
            mime_type: firstNonEmpty(attachments.id_card?.mimeType),
            preview_url: firstNonEmpty(attachments.id_card?.previewUrl),
            ocr_fields: attachments.id_card?.ocrFields || null,
            ocr_status: firstNonEmpty(attachments.id_card?.ocrStatus),
            ocr_error: firstNonEmpty(attachments.id_card?.ocrError),
          },
          education_cert: {
            asset_id: attachments.education_cert?.assetId || null,
            file_name: firstNonEmpty(attachments.education_cert?.fileName),
            mime_type: firstNonEmpty(attachments.education_cert?.mimeType),
            preview_url: firstNonEmpty(attachments.education_cert?.previewUrl),
          },
          contract: {
            asset_id: attachments.contract?.assetId || null,
            file_name: firstNonEmpty(attachments.contract?.fileName),
            mime_type: firstNonEmpty(attachments.contract?.mimeType),
            preview_url: firstNonEmpty(attachments.contract?.previewUrl),
          },
          driver_license: {
            asset_id: attachments.driver_license?.assetId || null,
            file_name: firstNonEmpty(attachments.driver_license?.fileName),
            mime_type: firstNonEmpty(attachments.driver_license?.mimeType),
            preview_url: firstNonEmpty(attachments.driver_license?.previewUrl),
          },
          social_security: {
            asset_id: attachments.social_security?.assetId || null,
            file_name: firstNonEmpty(attachments.social_security?.fileName),
            mime_type: firstNonEmpty(attachments.social_security?.mimeType),
            preview_url: firstNonEmpty(attachments.social_security?.previewUrl),
          },
        },
      }
    })
    localStorage.setItem(PERSONNEL_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // ignore
  }
}

const bidStatusLabel = (value) => bidStatusLabelMap[String(value || '').toUpperCase()] || value || '-'
const bidCategoryLabel = (value) => bidCategoryLabelMap[String(value || '').toUpperCase()] || '未选择'
const generateJobStatusLabel = (value) => {
  const key = String(value || '').toUpperCase()
  if (key === 'ANALYZING') return '分析中'
  if (key === 'ANALYZED') return '已分析'
  if (key === 'GENERATING') return '生成中'
  if (key === 'GENERATED') return '已生成'
  if (key === 'FAILED') return '失败'
  return value || '-'
}
const generateJobStatusToneClass = (value) => {
  const key = String(value || '').toUpperCase()
  if (key === 'GENERATED') return 'tone-success'
  if (key === 'ANALYZING' || key === 'GENERATING') return 'tone-running'
  if (key === 'ANALYZED') return 'tone-ready'
  if (key === 'FAILED') return 'tone-failed'
  return 'tone-waiting'
}
const sampleParseStatusLabel = (value) => {
  const key = String(value || '').toUpperCase()
  if (key === 'SUCCESS') return '解析成功'
  if (key === 'FAILED') return '解析失败'
  if (key === 'PENDING') return '待解析'
  return '解析中'
}
const sampleParseStatusToneClass = (value) => {
  const key = String(value || '').toUpperCase()
  if (key === 'SUCCESS') return 'tone-success'
  if (key === 'FAILED') return 'tone-failed'
  if (key === 'PENDING') return 'tone-waiting'
  return 'tone-running'
}
const generateJobProgress = (value, fallback = 0) => {
  const key = String(value || '').toUpperCase()
  if (key === 'ANALYZING') return 35
  if (key === 'ANALYZED') return 65
  if (key === 'GENERATING') return 88
  if (key === 'GENERATED') return 100
  if (key === 'FAILED') return 100
  const parsed = Number(fallback)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(100, Math.max(0, Math.floor(parsed)))
}
const bidStatusToneClass = (value) => {
  const key = String(value || '').toUpperCase()
  if (key === 'DRAFT') return 'tone-draft'
  if (key === 'IN_REVIEW') return 'tone-review'
  if (key === 'FINALIZED') return 'tone-finalized'
  if (key === 'SUBMITTED') return 'tone-submitted'
  if (key === 'ARCHIVED') return 'tone-archived'
  return 'tone-draft'
}
const assetTypeLabel = (value) => assetTypeLabelMap[String(value || '').toUpperCase()] || value || '-'
const ocrStatusLabel = (value) => ocrStatusLabelMap[String(value || '').toUpperCase()] || value || '-'
const versionSourceLabel = (value) => {
  const key = String(value || '').toLowerCase()
  if (key === 'upload') return '上传'
  if (key === 'snapshot') return '快照'
  if (key === 'fill') return '模板填充'
  if (key === 'auto_generate') return '自动生成'
  return value || '-'
}

const bidStatusProgress = (value) => {
  const key = String(value || '').toUpperCase()
  if (key === 'DRAFT') return 28
  if (key === 'IN_REVIEW') return 55
  if (key === 'FINALIZED') return 78
  if (key === 'SUBMITTED') return 100
  if (key === 'ARCHIVED') return 100
  return 0
}

const editorEventActionLabel = (value) => {
  const key = String(value || '').toUpperCase()
  if (key === 'EDITOR_JOIN') return '加入协同'
  if (key === 'EDITOR_SAVE') return '保存草稿'
  if (key === 'EDITOR_FORCE_SAVE') return '强制保存'
  if (key === 'EDITOR_LEAVE') return '退出协同'
  return value || '-'
}

const createQualificationDialog = () => ({
  open: false,
  assetId: null,
  file: null,
  fileName: '',
  localPreviewUrl: '',
  remotePreviewUrl: '',
  nameMode: 'select',
  name: '',
  customName: '',
  certificateNo: '',
  level: '',
  validLongTerm: false,
  validFrom: '',
  validTo: '',
  smartFilled: false,
})

const createFinanceDialog = () => ({
  open: false,
  assetId: null,
  file: null,
  fileName: '',
  localPreviewUrl: '',
  remotePreviewUrl: '',
  infoType: '',
  infoName: '',
  infoDate: '',
})

const createPerformanceDialog = () => ({
  open: false,
  itemId: null,
  project_name: '',
  project_no: '',
  project_type: '',
  package_no: '第一包',
  party_a_name: '',
  party_a_type: '',
  project_amount: '',
  project_leader: '',
  contact_phone: '',
  contract_valid_from: '',
  contract_valid_to: '',
  project_content: '',
  remark: '',
})

const createBidGenerateUploadForm = () => ({
  bidding_file: null,
  bid_category: '',
  doc_template_id: '',
})

const createGenerateInstructionForm = () => ({
  project_name: '',
  project_code: '',
  package_no: '',
  budget: '',
  buyer_name: '',
  agency_name: '',
  project_domain: '',
  project_overview: '',
})

const createAiModelForm = () => ({
  name: '',
  model_key: '',
  provider_type: 'custom',
  base_url: '',
  model_name: '',
  api_key: '',
  timeout_ms: 20000,
  max_tokens: 4096,
  temperature_default: 0.3,
  is_enabled: true,
  extra_headers_text: '',
})

const buildAiModelFormFromRow = (row = {}) => {
  const headers = row?.extra_headers_json && typeof row.extra_headers_json === 'object'
    ? row.extra_headers_json
    : {}
  const headersText = Object.keys(headers).length ? JSON.stringify(headers, null, 2) : ''
  return {
    name: firstNonEmpty(row?.name),
    model_key: firstNonEmpty(row?.model_key),
    provider_type: firstNonEmpty(row?.provider_type, 'custom'),
    base_url: firstNonEmpty(row?.base_url),
    model_name: firstNonEmpty(row?.model_name),
    api_key: '',
    timeout_ms: Number(row?.timeout_ms || 20000),
    max_tokens: Number(row?.max_tokens || 4096),
    temperature_default: Number.isFinite(Number(row?.temperature_default)) ? Number(row.temperature_default) : 0.3,
    is_enabled: Number(row?.is_enabled || 0) === 1,
    extra_headers_text: headersText,
  }
}

const normalizeAiModelPayload = (form = {}, { requireApiKey = false } = {}) => {
  const name = String(form?.name || '').trim()
  const model_key = String(form?.model_key || '').trim().toLowerCase()
  const provider_type = String(form?.provider_type || 'custom').trim().toLowerCase() || 'custom'
  const base_url = String(form?.base_url || '').trim()
  const model_name = String(form?.model_name || '').trim()
  const api_key = String(form?.api_key || '').trim()
  const timeout_ms = Math.max(3000, Number(form?.timeout_ms || 20000))
  const max_tokens = Math.max(256, Number(form?.max_tokens || 4096))
  const temperature_default = Number.isFinite(Number(form?.temperature_default)) ? Number(form.temperature_default) : 0.3
  const is_enabled = !!form?.is_enabled

  if (!name) throw new Error('显示名不能为空')
  if (!model_key) throw new Error('model_key不能为空')
  if (!base_url) throw new Error('base_url不能为空')
  if (!model_name) throw new Error('model_name不能为空')
  if (requireApiKey && !api_key) throw new Error('api_key不能为空')

  let extra_headers_json = {}
  const extraHeadersText = String(form?.extra_headers_text || '').trim()
  if (extraHeadersText) {
    const parsed = parseMaybeJson(extraHeadersText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('额外请求头必须是JSON对象')
    }
    extra_headers_json = parsed
  }

  const payload = {
    name,
    model_key,
    provider_type,
    base_url,
    model_name,
    timeout_ms,
    max_tokens,
    temperature_default,
    is_enabled,
    extra_headers_json,
  }
  if (api_key) payload.api_key = api_key
  return payload
}

const generateInstructionFieldOrder = [
  'project_name',
  'project_code',
  'package_no',
  'budget',
  'buyer_name',
  'agency_name',
  'project_domain',
  'project_overview',
]

const instructionFieldLabelGroups = {
  project_name: ['项目名称', '项目全称', '采购项目名称', '项目名称（全称）'],
  project_code: ['项目编号', '招标编号', '采购编号', '项目招标编号', '采购项目编号'],
  budget: ['预算金额', '项目预算', '采购预算', '最高投标限价', '最高限价', '预算'],
  buyer_name: ['采购人', '招标人', '招标单位'],
  agency_name: ['招标代理机构', '采购代理机构', '代理机构', '代理单位'],
  project_domain: ['项目所属领域', '所属领域'],
  project_overview: ['项目概况', '项目简介', '项目说明'],
}

const instructionStopLabels = Array.from(new Set([
  ...Object.values(instructionFieldLabelGroups).flat(),
  '采购方式',
  '实施周期',
  '服务期限',
  '合同履行期限',
  '质保期',
  '投标有效期',
  '投标单位资格要求',
  '投标人资格要求',
  '招标内容',
  '开标时间',
  '日期',
  '目录',
  '技术要求',
  '商务要求',
  '项目要求',
  '投标文件格式',
]))

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const trimByFirstPattern = (text, patterns = []) => {
  let end = text.length
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const idx = Number(match.index)
    if (Number.isFinite(idx) && idx > 0) end = Math.min(end, idx)
  }
  return text.slice(0, end).trim()
}

const cleanupSingleLineValue = (value, maxLen = 240) => {
  let text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  text = text.replace(/^[:：\-—\s]+/, '').trim()
  text = trimByFirstPattern(text, [
    /\s*\d{1,2}\.\d{1,2}\s*[\u4e00-\u9fa5A-Za-z]/u,
    /\s+[一二三四五六七八九十百千万]+、/u,
    /\s*日\s*期\s*[：:]/u,
    /\s*目\s*录/u,
    /\s*(?:项目编号|招标编号|采购方式|项目概况|招标人|采购人|招标单位|代理单位|招标代理机构|代理机构|实施周期|质保期|服务期限|日期|目录|技术要求|商务要求|资格审查|评标办法|评标标准|投标文件格式)\s*[：:]/u,
    /\s*第[一二三四五六七八九十百千万0-9]+\s*章/u,
  ])
  const invalidTokens = ['投标人须知', '资格要求', '符合性', '废标', '评分表', '第', '章']
  if (text.length <= 1) return ''
  if (text.length > maxLen) text = text.slice(0, maxLen)
  if (/^第[一二三四五六七八九十百千万0-9]+章/u.test(text)) return ''
  if (invalidTokens.some((token) => text === token)) return ''
  return text
}

const cleanupParagraphValue = (value, maxLen = 1200) => {
  let text = String(value || '')
    .replace(/\u3000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) return ''
  text = trimByFirstPattern(text, [
    /\s+\d{1,2}\.\d{1,2}\s*(?:实施周期|质保期|最高投标限价|最高限价|采购方式|投标单位资格要求|投标人资格要求|招标内容)\s*[：:]/u,
    /\n\s*\d{1,2}\.\d{1,2}\s*(?:实施周期|质保期|最高投标限价|最高限价|采购方式|投标单位资格要求|投标人资格要求|招标内容)\s*[：:]/u,
  ])
  if (text.length > maxLen) text = text.slice(0, maxLen)
  return text.trim()
}

const extractLabeledValue = (text, labels, maxLen = 240, options = {}) => {
  const source = String(text || '')
  if (!source) return ''
  const stopLabels = Array.isArray(options.stopLabels) ? options.stopLabels : []
  const stopExpr = stopLabels.map((item) => escapeRegex(item)).filter(Boolean).join('|')
  const captureMax = Math.min(Math.max(Number(maxLen) || 240, 40), 2000)
  const stopByNumberedItem = String.raw`(?:\s+(?:\d{1,2}\.\d{1,2}|\d{1,2}[、.]|[一二三四五六七八九十百千万]+、)\s*[\u4e00-\u9fa5A-Za-z])`
  const stopByLabel = stopExpr ? String.raw`(?:\s*(?:${stopExpr})\s*[：:])` : ''
  const lookahead = [String.raw`\r?\n`, stopByNumberedItem, stopByLabel, String.raw`$`].filter(Boolean).join('|')
  for (const label of labels) {
    const escaped = escapeRegex(label)
    const regex = new RegExp(`${escaped}\\s*[：:]\\s*([\\s\\S]{1,${captureMax}}?)(?=${lookahead})`, 'iu')
    const match = source.match(regex)
    if (!match) continue
    const cleaned = cleanupSingleLineValue(match[1], maxLen)
    if (cleaned) return cleaned
  }
  return ''
}

const pickFirstRegex = (text, patterns, formatter) => {
  const source = String(text || '')
  if (!source) return ''
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (!match) continue
    const value = typeof formatter === 'function' ? formatter(match) : firstNonEmpty(match[1], match[0])
    const normalized = String(value || '').trim()
    if (normalized) return normalized
  }
  return ''
}

const extractLabeledValueFromSources = (sources, labels, maxLen = 240, options = {}) => {
  const sourceList = Array.isArray(sources) ? sources : [sources]
  for (const source of sourceList) {
    const value = extractLabeledValue(source, labels, maxLen, options)
    if (value) return value
  }
  return ''
}

const pickFirstRegexFromSources = (sources, patterns, formatter) => {
  const sourceList = Array.isArray(sources) ? sources : [sources]
  for (const source of sourceList) {
    const value = pickFirstRegex(source, patterns, formatter)
    if (value) return value
  }
  return ''
}

const normalizePackageNo = (value) => {
  const text = cleanupSingleLineValue(value, 60)
    .replace(/^(?:包号|标包|包件|标段)[：:\s]*/u, '')
    .trim()
  if (!text) return ''
  if (/不划分(?:标段|包)|不分(?:标段|包)/u.test(text)) return '不划分标段'
  if (/(资格|须知|评标|目录|公告|项目说明|采购方式)/u.test(text)) return ''
  if (/^第?\s*[一二三四五六七八九十百千万0-9]+\s*(?:包|标段)$/u.test(text)) {
    return text.replace(/\s+/g, '')
  }
  if (/(?:包|标段)/u.test(text) && text.length <= 16) return text
  return ''
}

const sanitizeAgencyName = (value) => {
  let text = cleanupSingleLineValue(value, 320)
    .replace(/^(?:招标代理机构|采购代理机构|代理机构|代理单位)\s*[：:]\s*/u, '')
    .replace(/^(?:系指|是指|即)\s*/u, '')
    .trim()
  if (!text) return ''

  text = trimByFirstPattern(text, [
    /\s*(?:日\s*期|目\s*录)\s*[：:]?/u,
    /\s*第[一二三四五六七八九十百千万0-9]+\s*章/u,
    /\s*(?:投标人须知|评标办法|资格要求|项目说明|项目概况)\b/u,
  ]).trim()
  text = text.replace(/[，,;；。:：]+$/u, '').trim()

  const orgMatch = text.match(
    /[\u4e00-\u9fa5A-Za-z0-9（）()·\-.]{2,80}?(?:有限责任公司|股份有限公司|集团有限公司|有限公司|集团|采购中心|中心|事务所|研究院|学院|大学|医院|委员会|公司)/u
  )
  if (orgMatch?.[0]) text = orgMatch[0].trim()

  if (!text || /(日\s*期|目\s*录|第[一二三四五六七八九十百千万0-9]+\s*章)/u.test(text)) return ''
  return text
}

const sanitizeProjectName = (value) => {
  let text = cleanupSingleLineValue(value, 320)
  if (!text) return ''
  text = text
    .replace(/(?:\s*招标文件.*$)/u, '')
    .replace(/(?:\s*投标文件.*$)/u, '')
    .replace(/[_-]?定稿.*$/u, '')
    .replace(/[（(]\d+[）)]$/u, '')
    .trim()
  text = text.replace(/[，,;；。:：]+$/u, '').trim()
  if (!text) return ''
  return text
}

const normalizeProjectCode = (value) => {
  let text = cleanupSingleLineValue(value, 180)
  if (!text) return ''
  text = text
    .replace(/[—–－]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^[：:]+/, '')
    .replace(/[，,;；。:：]+$/u, '')
    .trim()
  const pure = text.match(/[A-Za-z0-9][A-Za-z0-9\-_/]{2,120}/u)
  if (pure?.[0]) return pure[0]
  return text
}

const sanitizeProjectOverview = (value, maxLen = 900) => {
  let text = cleanupParagraphValue(value, Math.max(maxLen, 600))
  if (!text) return ''
  text = trimByFirstPattern(text, [
    /\n\s*(?:技术要求|商务要求|资格审查|评分标准|评标标准|评标办法|报价要求|参数要求)\s*[：:]?/u,
    /\s+(?:技术要求|商务要求|资格审查|评分标准|评标标准|评标办法|报价要求|参数要求)\s*[：:]/u,
    /\n\s*(?:二[、.]|2[、.]|2\.\d+)\s*(?:技术|项目要求|采购需求)/u,
    /\n\s*(?:三[、.]|3[、.]|3\.\d+)\s*(?:商务|评标)/u,
  ]).trim()
  if (!text) return ''
  if (/^(?:技术要求|商务要求|资格审查|评分标准|评标办法)/u.test(text)) return ''
  if (text.length > maxLen) text = text.slice(0, maxLen).trim()
  return text
}

const sanitizeOrganizationName = (value) => {
  let text = cleanupSingleLineValue(value, 320)
    .replace(/^(?:采购人|招标人|招标单位|采购单位|代理单位)\s*[：:]\s*/u, '')
    .replace(/^(?:系指|是指|即)\s*/u, '')
    .trim()
  if (!text) return ''
  text = trimByFirstPattern(text, [
    /\s*(?:日\s*期|目\s*录)\s*[：:]?/u,
    /\s*第[一二三四五六七八九十百千万0-9]+\s*章/u,
    /\s*(?:投标人须知|评标办法|资格要求|项目说明|项目概况)\b/u,
  ]).trim()
  text = text.replace(/[，,;；。:：]+$/u, '').trim()
  const orgMatch = text.match(
    /[\u4e00-\u9fa5A-Za-z0-9（）()·\-.]{2,80}?(?:有限责任公司|股份有限公司|集团有限公司|有限公司|集团|采购中心|中心|事务所|研究院|学院|大学|医院|委员会|公司)/u
  )
  if (orgMatch?.[0]) text = orgMatch[0].trim()
  return text
}

const hasInstructionNoise = (value) => {
  const text = String(value || '')
  if (!text) return true
  return /(?:目\s*录|日\s*期|目录|日期|第[一二三四五六七八九十百千万0-9]+\s*章|投标人须知|资格要求|符合性审查|评标办法|采购方式|项目概况|招标文件|投标文件格式)/u.test(text)
}

const pickCleanerSingleLine = (candidates, maxLen = 240) => {
  const cleanedList = (Array.isArray(candidates) ? candidates : [])
    .map((item) => cleanupSingleLineValue(item, maxLen))
    .filter(Boolean)
  if (!cleanedList.length) return ''
  const preferred = cleanedList.find((item) => !hasInstructionNoise(item))
  if (preferred) return preferred
  return cleanedList.sort((a, b) => a.length - b.length)[0]
}

const pickProjectNameFromFileName = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]?定稿.*$/u, '')
    .replace(/[（(]\d+[）)]$/u, '')
    .trim()
  if (!compact) return ''
  if (!compact.includes('项目')) return ''
  if (/(招标文件|投标文件|评分表|目录)/u.test(compact)) return ''
  return cleanupSingleLineValue(compact, 240)
}

const buildGenerateInstructionFormFromAnalysis = (analysis) => {
  const finalJson = analysis?.final_json && typeof analysis.final_json === 'object' ? analysis.final_json : {}
  const projectCore = finalJson?.project_core_info && typeof finalJson.project_core_info === 'object'
    ? finalJson.project_core_info
    : {}
  const sectionSummaries = Array.isArray(analysis?.section_summaries) ? analysis.section_summaries : []
  const summaryByKey = (key) =>
    toMeaningfulText(
      sectionSummaries.find((item) => String(item?.section_key || '').toUpperCase() === String(key).toUpperCase())?.summary
    )

  const sourcePreview = toMeaningfulText(analysis?.source_text_preview)
  const bidDocFormatSummary = summaryByKey('BID_DOC_FORMAT')
  const instructionSummary = summaryByKey('BIDDER_INSTRUCTION')
  const instructionTableSummary = summaryByKey('BIDDER_INSTRUCTION_TABLE')
  const procurementSummary = summaryByKey('PROCUREMENT_REQUIREMENT')
  const invitationSummary = summaryByKey('INVITATION')
  const mergeText = [
    sourcePreview,
    bidDocFormatSummary,
    instructionSummary,
    instructionTableSummary,
    procurementSummary,
    invitationSummary,
  ].filter(Boolean).join('\n')
  const coreSourceList = [
    invitationSummary,
    instructionTableSummary,
    instructionSummary,
    bidDocFormatSummary,
    sourcePreview,
  ].filter(Boolean)
  const overviewSourceList = [
    invitationSummary,
    instructionSummary,
    instructionTableSummary,
    sourcePreview,
  ].filter(Boolean)
  const sourceFileName = String(analysis?.job?.source_file_name || '').trim()

  const projectNameByLabel = extractLabeledValueFromSources(
    coreSourceList,
    instructionFieldLabelGroups.project_name,
    280,
    { stopLabels: instructionStopLabels }
  )
  const projectNameByRegex = cleanupSingleLineValue(
    pickFirstRegexFromSources(
      coreSourceList,
      [/(?:项目名称|项目全称|采购项目名称)\s*[：:]\s*([^\n\r]{2,240})/u],
      (match) => match[1]
    ),
    280
  )
  const projectCodeByLabel = extractLabeledValueFromSources(
    coreSourceList,
    instructionFieldLabelGroups.project_code,
    160,
    { stopLabels: instructionStopLabels }
  )
  const projectCodeByRegex = cleanupSingleLineValue(
    pickFirstRegexFromSources(
      coreSourceList,
      [/(?:项目编号|招标编号|采购编号)\s*[：:]\s*([A-Za-z0-9\-_/—–－]{3,120})/u],
      (match) => match[1]
    ),
    160
  )
  const budgetByLabel = extractLabeledValueFromSources(
    coreSourceList,
    instructionFieldLabelGroups.budget,
    120,
    { stopLabels: instructionStopLabels }
  )
  const buyerByLabel = extractLabeledValueFromSources(
    coreSourceList,
    instructionFieldLabelGroups.buyer_name,
    280,
    { stopLabels: instructionStopLabels }
  )
  const agencyByLabel = extractLabeledValueFromSources(
    coreSourceList,
    instructionFieldLabelGroups.agency_name,
    280,
    { stopLabels: instructionStopLabels }
  )
  const buyerByRegex = cleanupSingleLineValue(
    pickFirstRegexFromSources(
      coreSourceList,
      [/(?:采购人|招标人|招标单位)\s*[：:]\s*([^\n\r]{2,280})/u],
      (match) => match[1]
    ),
    280
  )
  const agencyByRegex = cleanupSingleLineValue(
    pickFirstRegexFromSources(
      coreSourceList,
      [/(?:招标代理机构|采购代理机构|代理机构|代理单位)\s*[：:]\s*([^\n\r]{2,280})/u],
      (match) => match[1]
    ),
    280
  )
  const projectOverviewByLabel = sanitizeProjectOverview(
    extractLabeledValueFromSources(
      overviewSourceList,
      instructionFieldLabelGroups.project_overview,
      1500,
      { stopLabels: instructionStopLabels }
    )
  )
  const projectOverviewByRegex = sanitizeProjectOverview(
    pickFirstRegexFromSources(
      overviewSourceList,
      [
        /(?:项目概况|项目简介|项目说明)\s*[：:]\s*([\s\S]{8,1600}?)(?=(?:\n|(?:\d{1,2}\.\d{1,2}|\d{1,2}[、.]|[一二三四五六七八九十百千万]+、)\s*(?:实施周期|服务期限|质保期|预算金额|最高投标限价|采购方式|投标单位资格要求|投标人资格要求|招标内容|项目要求)\s*[：:]|$))/u,
        /(?:1\.\d+\s*)?(?:项目概况|项目简介|项目说明)\s*[：:]\s*([\s\S]{8,1200}?)(?=(?:\n|(?:\d{1,2}\.\d{1,2}|\d{1,2}[、.]|[一二三四五六七八九十百千万]+、)\s*(?:实施周期|服务期限|质保期|预算金额|最高投标限价|采购方式|投标单位资格要求|投标人资格要求|招标内容|项目要求|技术要求|商务要求)\s*[：:]|$))/u,
      ],
      (match) => match[1]
    ),
    900
  )

  const packageNo = normalizePackageNo(firstNonEmpty(
    toMeaningfulText(projectCore.package_no),
    pickFirstRegex(mergeText, [
      /((?:第\s*[一二三四五六七八九十百千万0-9]+\s*(?:包|标段)))/u,
      /(?:包号|标包|包件|标段)[：:\s]*([^，。；;、\n\r]{1,24})/u,
      /(?:不划分标段|不分包)/u,
    ]),
  ))

  const projectDomain = firstNonEmpty(
    toMeaningfulText(projectCore.project_domain),
    extractLabeledValueFromSources(coreSourceList, instructionFieldLabelGroups.project_domain, 120, { stopLabels: instructionStopLabels }),
    toMeaningfulText(projectCore.service_category),
    toMeaningfulText(projectCore.goods_category),
  )

  const projectOverview = sanitizeProjectOverview(firstNonEmpty(
    toMeaningfulText(projectCore.project_overview),
    projectOverviewByLabel,
    projectOverviewByRegex,
  ), 900)
  const buyerNameCandidate = pickCleanerSingleLine([
    buyerByLabel,
    buyerByRegex,
    toMeaningfulText(projectCore.buyer_full_name),
  ], 300)
  const agencyNameCandidate = pickCleanerSingleLine([
    agencyByLabel,
    agencyByRegex,
    toMeaningfulText(projectCore.agency_full_name),
  ], 300)

  return {
    project_name: sanitizeProjectName(pickCleanerSingleLine([
      toMeaningfulText(projectCore.project_full_name),
      toMeaningfulText(projectCore.project_name),
      projectNameByLabel,
      projectNameByRegex,
      pickProjectNameFromFileName(sourceFileName),
    ], 300)),
    project_code: normalizeProjectCode(pickCleanerSingleLine([
      toMeaningfulText(projectCore.project_code),
      projectCodeByLabel,
      projectCodeByRegex,
    ], 160)),
    package_no: packageNo,
    budget: pickCleanerSingleLine([
      toMeaningfulText(projectCore.project_budget),
      toMeaningfulText(projectCore.max_bid_price),
      budgetByLabel,
    ], 120),
    buyer_name: sanitizeOrganizationName(buyerNameCandidate),
    agency_name: sanitizeAgencyName(agencyNameCandidate),
    project_domain: cleanupSingleLineValue(projectDomain, 120),
    project_overview: projectOverview,
  }
}

const formatElapsedDuration = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0)
  const rounded = Math.floor(safeSeconds)
  const min = Math.floor(rounded / 60)
  const sec = rounded % 60
  if (min <= 0) return `${sec} 秒`
  return `${min} 分 ${String(sec).padStart(2, '0')} 秒`
}

const buildGenerateAnalyzeRuntimeMeta = (elapsedSeconds, expectedMaxSeconds) => {
  const sec = Math.max(0, Number(elapsedSeconds) || 0)
  if (sec < 10) {
    return {
      stage: '正在上传并校验招标文件',
      detail: '已接收文件，正在创建分析任务。',
      progress: 16,
      isSlow: false,
    }
  }
  if (sec < 28) {
    return {
      stage: '正在解析章节与表格',
      detail: '系统正在拆分章节并提取正文、表格信息。',
      progress: 38,
      isSlow: false,
    }
  }
  if (sec < 60) {
    return {
      stage: '正在提取得分项与风险项',
      detail: '模型正在识别关键条款、评分项与废标风险。',
      progress: 66,
      isSlow: false,
    }
  }
  if (sec < expectedMaxSeconds) {
    return {
      stage: '正在汇总分析结果',
      detail: '正在整合结构化结果并生成核对数据。',
      progress: 86,
      isSlow: false,
    }
  }
  return {
    stage: '分析耗时较长，仍在执行',
    detail: '模型响应偏慢，任务未中断，请继续等待。',
    progress: 95,
    isSlow: true,
  }
}

const createGenerateWizardState = () => ({
  open: false,
  step: 1,
  model_id: '',
  upload: createBidGenerateUploadForm(),
  analysisBusy: false,
  createBusy: false,
  analysis: null,
  selected_sample_ids: [],
  instruction_form: createGenerateInstructionForm(),
  create_form: {
    title: '',
    customer_name: '',
    project_name: '',
    summary: '',
  },
})

const createDraftCheckState = () => ({
  busy: false,
  run_id: 0,
  source_job_id: 0,
  summary: null,
  issues: [],
  severity_filter: 'ALL',
})

const createScoreOptimizeState = () => ({
  busy: false,
  source_job_id: 0,
  matrix: [],
  items: [],
  prompt_preview: '',
})

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
  const [bidSelectedIds, setBidSelectedIds] = useState([])
  const [editorSelectedIds, setEditorSelectedIds] = useState([])
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
  const [generateJobs, setGenerateJobs] = useState([])
  const [generateSearch, setGenerateSearch] = useState('')
  const [generateSelectedIds, setGenerateSelectedIds] = useState([])
  const [generatePage, setGeneratePage] = useState(1)
  const [generatePageSize, setGeneratePageSize] = useState(10)
  const [generateGotoPage, setGenerateGotoPage] = useState('1')
  const [generateWizard, setGenerateWizard] = useState(() => createGenerateWizardState())
  const [generateQualificationTab, setGenerateQualificationTab] = useState('qualification')
  const [generateUploadInputSeed, setGenerateUploadInputSeed] = useState(0)
  const [generateSourcePreviewEditor, setGenerateSourcePreviewEditor] = useState(null)
  const [generateAnalyzeRuntime, setGenerateAnalyzeRuntime] = useState({
    startedAt: 0,
    elapsedSeconds: 0,
  })
  const [generateInstructionTouched, setGenerateInstructionTouched] = useState({})
  const [generateInstructionStream, setGenerateInstructionStream] = useState({
    running: false,
    progress: 0,
    total: generateInstructionFieldOrder.length,
    current_field: '',
  })
  const [sampleSearch, setSampleSearch] = useState('')
  const [sampleRows, setSampleRows] = useState([])
  const [sampleSelectedIds, setSampleSelectedIds] = useState([])
  const [samplePage, setSamplePage] = useState(1)
  const [samplePageSize, setSamplePageSize] = useState(10)
  const [sampleGotoPage, setSampleGotoPage] = useState('1')
  const [sampleUploadBusy, setSampleUploadBusy] = useState(false)
  const [sampleUploadInputSeed, setSampleUploadInputSeed] = useState(0)

  const [versions, setVersions] = useState([])
  const [selectedBid, setSelectedBid] = useState(null)
  const [compareState, setCompareState] = useState({
    leftVersionId: '',
    rightVersionId: '',
    loading: false,
    result: null,
  })
  const [editorEvents, setEditorEvents] = useState([])
  const [editorEventsLoading, setEditorEventsLoading] = useState(false)
  const [draftCheckState, setDraftCheckState] = useState(() => createDraftCheckState())
  const [scoreOptimizeState, setScoreOptimizeState] = useState(() => createScoreOptimizeState())

  const [bundles, setBundles] = useState([])

  const [assets, setAssets] = useState([])
  const [qualificationSearch, setQualificationSearch] = useState('')
  const [qualificationSelectedIds, setQualificationSelectedIds] = useState([])
  const [qualificationDialog, setQualificationDialog] = useState(() => createQualificationDialog())
  const [qualificationSaving, setQualificationSaving] = useState(false)
  const [qualificationSmartFilling, setQualificationSmartFilling] = useState(false)
  const [qualificationFileInputKey, setQualificationFileInputKey] = useState(0)
  const [qualificationPage, setQualificationPage] = useState(1)
  const [qualificationPageSize, setQualificationPageSize] = useState(10)
  const [qualificationGotoPage, setQualificationGotoPage] = useState('1')

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
  const [financeSearch, setFinanceSearch] = useState('')
  const [financeSelectedIds, setFinanceSelectedIds] = useState([])
  const [financeDialog, setFinanceDialog] = useState(() => createFinanceDialog())
  const [financeSaving, setFinanceSaving] = useState(false)
  const [financeFileInputKey, setFinanceFileInputKey] = useState(0)
  const [financePage, setFinancePage] = useState(1)
  const [financePageSize, setFinancePageSize] = useState(10)
  const [financeGotoPage, setFinanceGotoPage] = useState('1')
  const [performanceSearch, setPerformanceSearch] = useState('')
  const [performanceSelectedIds, setPerformanceSelectedIds] = useState([])
  const [performanceDialog, setPerformanceDialog] = useState(() => createPerformanceDialog())
  const [performanceSaving, setPerformanceSaving] = useState(false)
  const [performanceEntries, setPerformanceEntries] = useState(() => loadPerformanceEntries())
  const [performancePage, setPerformancePage] = useState(1)
  const [performancePageSize, setPerformancePageSize] = useState(8)
  const [performanceGotoPage, setPerformanceGotoPage] = useState('1')
  const [staffSearch, setStaffSearch] = useState('')
  const [staffSelectedIds, setStaffSelectedIds] = useState([])
  const [staffDialog, setStaffDialog] = useState(() => createStaffDialog())
  const [staffSaving, setStaffSaving] = useState(false)
  const [staffSmartFilling, setStaffSmartFilling] = useState(false)
  const [staffEntries, setStaffEntries] = useState(() => loadPersonnelEntries())
  const [staffPage, setStaffPage] = useState(1)
  const [staffPageSize, setStaffPageSize] = useState(10)
  const [staffGotoPage, setStaffGotoPage] = useState('1')
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
  const [docTemplates, setDocTemplates] = useState([])
  const [docTemplateUploadFile, setDocTemplateUploadFile] = useState(null)
  const [docTemplateUploadName, setDocTemplateUploadName] = useState('')
  const [docTemplateSetDefault, setDocTemplateSetDefault] = useState(true)
  const [docTemplateUploadBusy, setDocTemplateUploadBusy] = useState(false)
  const [docTemplateInputKey, setDocTemplateInputKey] = useState(0)
  const [modelForm, setModelForm] = useState(() => createAiModelForm())
  const [modelCreateTesting, setModelCreateTesting] = useState(false)
  const [modelCreateSaving, setModelCreateSaving] = useState(false)
  const [modelCreateTestFeedback, setModelCreateTestFeedback] = useState({ type: '', text: '' })
  const [modelRowTesting, setModelRowTesting] = useState({})
  const [modelRowTestFeedback, setModelRowTestFeedback] = useState({})
  const [modelEditDialog, setModelEditDialog] = useState({
    open: false,
    targetId: null,
    form: createAiModelForm(),
  })
  const [modelEditTesting, setModelEditTesting] = useState(false)
  const [modelEditSaving, setModelEditSaving] = useState(false)
  const [modelEditTestFeedback, setModelEditTestFeedback] = useState({ type: '', text: '' })

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
  const [generateSourceEditorContainerId] = useState('tender-generate-source-doc-editor')
  const [editorScriptError, setEditorScriptError] = useState('')
  const [docsApiReady, setDocsApiReady] = useState(() => (typeof window !== 'undefined' && !!window.DocsAPI?.DocEditor))
  const docEditorRef = useRef(null)
  const generateSourceEditorRef = useRef(null)
  const staffDialogRef = useRef(staffDialog)
  const generateInstructionStreamTimerRef = useRef(null)
  const generateInstructionStreamRunIdRef = useRef(0)
  const generateInstructionTouchedRef = useRef({})

  const stopInstructionAutofillStream = () => {
    generateInstructionStreamRunIdRef.current += 1
    if (generateInstructionStreamTimerRef.current) {
      clearTimeout(generateInstructionStreamTimerRef.current)
      generateInstructionStreamTimerRef.current = null
    }
    setGenerateInstructionStream((prev) => ({
      ...prev,
      running: false,
      current_field: '',
    }))
  }

  const startInstructionAutofillStream = (targetForm, { overwrite = false } = {}) => {
    stopInstructionAutofillStream()
    const source = {
      ...createGenerateInstructionForm(),
      ...(targetForm && typeof targetForm === 'object' ? targetForm : {}),
    }
    const queue = generateInstructionFieldOrder.filter((field) => String(source[field] || '').trim())
    if (!queue.length) {
      setGenerateInstructionStream({
        running: false,
        progress: 0,
        total: generateInstructionFieldOrder.length,
        current_field: '',
      })
      return
    }

    const runId = generateInstructionStreamRunIdRef.current + 1
    generateInstructionStreamRunIdRef.current = runId
    let cursor = 0
    setGenerateInstructionStream({
      running: true,
      progress: 0,
      total: generateInstructionFieldOrder.length,
      current_field: '',
    })

    const tick = () => {
      if (generateInstructionStreamRunIdRef.current !== runId) return
      if (cursor >= queue.length) {
        setGenerateInstructionStream({
          running: false,
          progress: queue.length,
          total: generateInstructionFieldOrder.length,
          current_field: '',
        })
        return
      }

      const field = queue[cursor]
      const nextValue = String(source[field] || '').trim()
      cursor += 1

      setGenerateWizard((prev) => {
        const current = {
          ...createGenerateInstructionForm(),
          ...(prev.instruction_form && typeof prev.instruction_form === 'object' ? prev.instruction_form : {}),
        }
        const touched = generateInstructionTouchedRef.current || {}
        if (!overwrite && touched[field]) return prev
        current[field] = nextValue
        return {
          ...prev,
          instruction_form: current,
        }
      })

      setGenerateInstructionStream({
        running: true,
        progress: cursor,
        total: generateInstructionFieldOrder.length,
        current_field: field,
      })

      const delay = field === 'project_overview' ? 220 : 110
      generateInstructionStreamTimerRef.current = setTimeout(tick, delay)
    }

    tick()
  }

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

  const revokeStaffDialogPreviewUrls = (dialog) => {
    staffAttachmentKeys.forEach((key) => {
      safeRevokeUrl(dialog?.[key]?.previewUrl)
    })
  }

  const closeQualificationDialog = () => {
    setQualificationDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return createQualificationDialog()
    })
    setQualificationSaving(false)
    setQualificationSmartFilling(false)
    setQualificationFileInputKey((prev) => prev + 1)
  }

  const openCreateQualificationDialog = () => {
    resetFeedback()
    setQualificationDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return { ...createQualificationDialog(), open: true }
    })
    setQualificationFileInputKey((prev) => prev + 1)
  }

  const toQualificationFormFromAsset = (asset) => {
    const fields = asset?.fields_json || {}
    const resolvedName = firstNonEmpty(fields.title, fields.name, fields.qualification_name)
    const validFrom = normalizeDateToInput(firstNonEmpty(fields.valid_from))
    const validToRaw = firstNonEmpty(fields.valid_to)
    const validTo = normalizeDateToInput(validToRaw)
    const validLongTerm = Number(fields.valid_long_term || 0) > 0 || String(validToRaw || '').includes('长期')
    const level = firstNonEmpty(fields.level, fields.rating, fields.grade)
    const knownName = qualificationNameOptions.includes(resolvedName)

    return {
      ...createQualificationDialog(),
      open: true,
      assetId: Number(asset?.id) || null,
      fileName: firstNonEmpty(asset?.original_file_name),
      remotePreviewUrl: String(asset?.mime_type || '').startsWith('image/')
        ? `${API_BASE}/api/tender/assets/${asset.id}/preview`
        : '',
      nameMode: knownName ? 'select' : 'custom',
      name: knownName ? resolvedName : '',
      customName: knownName ? '' : resolvedName,
      certificateNo: firstNonEmpty(fields.certificate_no, fields.number, fields.no),
      level,
      validLongTerm,
      validFrom,
      validTo: validLongTerm ? '' : validTo,
      smartFilled: true,
    }
  }

  const openEditQualificationDialog = (asset) => {
    resetFeedback()
    setQualificationDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return toQualificationFormFromAsset(asset)
    })
    setQualificationFileInputKey((prev) => prev + 1)
  }

  const onPickQualificationFile = (file) => {
    setQualificationDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return {
        ...prev,
        file: file || null,
        fileName: file?.name || '',
        localPreviewUrl: buildImagePreviewUrl(file),
        remotePreviewUrl: '',
        assetId: null,
        smartFilled: false,
      }
    })
  }

  const loadEditorScript = async () => {
    if (window.DocsAPI?.DocEditor) {
      setDocsApiReady(true)
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
      setDocsApiReady(true)
      setEditorScriptError('')
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
    const secondTry = await loadOnce()
    if (secondTry) {
      setDocsApiReady(true)
      setEditorScriptError('')
      return true
    }

    setDocsApiReady(false)
    setEditorScriptError('OnlyOffice 编辑服务不可用，请稍后重试。')
    return false
  }

  const destroyEditor = () => {
    if (docEditorRef.current && typeof docEditorRef.current.destroyEditor === 'function') {
      docEditorRef.current.destroyEditor()
    }
    docEditorRef.current = null
  }

  const destroyGenerateSourceEditor = () => {
    if (generateSourceEditorRef.current && typeof generateSourceEditorRef.current.destroyEditor === 'function') {
      generateSourceEditorRef.current.destroyEditor()
    }
    generateSourceEditorRef.current = null
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

  const fetchVersions = async (bidId, options = {}) => {
    if (!bidId) {
      setVersions([])
      setCompareState({
        leftVersionId: '',
        rightVersionId: '',
        loading: false,
        result: null,
      })
      return []
    }
    const rows = await api.get(`/api/tender/bids/${bidId}/versions`)
    const list = Array.isArray(rows) ? rows : []
    setVersions(list)
    if (options.syncCompare !== false) {
      setCompareState({
        leftVersionId: list[1]?.id ? String(list[1].id) : '',
        rightVersionId: list[0]?.id ? String(list[0].id) : '',
        loading: false,
        result: null,
      })
    }
    return list
  }

  const fetchEditorEvents = async (bidId, options = {}) => {
    if (!bidId) {
      setEditorEvents([])
      return []
    }
    if (!options.silent) setEditorEventsLoading(true)
    try {
      const data = await api.get(`/api/tender/bids/${bidId}/editor/events?limit=80`)
      const items = Array.isArray(data?.items) ? data.items : []
      setEditorEvents(items)
      return items
    } catch (err) {
      if (!options.silent) showError(err.message || '读取编辑轨迹失败')
      return []
    } finally {
      if (!options.silent) setEditorEventsLoading(false)
    }
  }

  const openBidVersionPanel = async (bid) => {
    if (!bid?.id) return
    resetFeedback()
    setSelectedBid(bid)
    try {
      await Promise.all([fetchVersions(bid.id), fetchEditorEvents(bid.id)])
    } catch (err) {
      showError(err.message)
    }
  }

  const fetchBundles = async () => {
    const bundleRows = await api.get('/api/tender/templates/bundles')
    setBundles(Array.isArray(bundleRows) ? bundleRows : [])
  }

  const fetchAssets = async () => {
    const rows = await api.get('/api/tender/assets')
    setAssets(Array.isArray(rows) ? rows : [])
  }

  const fetchGenerateJobs = async () => {
    const rows = await api.get('/api/tender/bids/generate/jobs?limit=300')
    setGenerateJobs(Array.isArray(rows?.items) ? rows.items : [])
  }

  const fetchSamples = async () => {
    const rows = await api.get('/api/tender/samples?limit=500')
    setSampleRows(Array.isArray(rows?.items) ? rows.items : [])
  }

  const fetchModels = async () => {
    const rows = await api.get('/api/tender/ai/models')
    setModels(Array.isArray(rows) ? rows : [])
  }

  const fetchDocTemplates = async () => {
    const rows = await api.get('/api/tender/doc-templates')
    setDocTemplates(Array.isArray(rows) ? rows : [])
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
      await Promise.allSettled([fetchBids(), fetchBundles(), fetchAssets(), fetchModels(), fetchDocTemplates(), fetchGenerateJobs(), fetchSamples()])
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
    safeRevokeUrl(qualificationDialog.localPreviewUrl)
    safeRevokeUrl(financeDialog.localPreviewUrl)
    Object.values(idCardPreview).forEach((url) => safeRevokeUrl(url))
  }, [companyLicenseUpload.preview_url, qualificationDialog.localPreviewUrl, financeDialog.localPreviewUrl, idCardPreview])

  useEffect(() => {
    let canceled = false

    const loadGeneratePreviewSession = async () => {
      const jobId = Number(generateWizard.analysis?.job?.id || 0)
      const sourceExt = String(generateWizard.analysis?.job?.source_ext || '').toLowerCase()
      const fileName = String(
        generateWizard.analysis?.job?.source_file_name
        || generateWizard.upload?.bidding_file?.name
        || ''
      ).toLowerCase()
      const isWordSource = sourceExt === '.doc' || sourceExt === '.docx' || /\.docx?$/i.test(fileName)
      if (generateWizard.step !== 2 || jobId <= 0 || !isWordSource) {
        if (!canceled) setGenerateSourcePreviewEditor(null)
        return
      }
      try {
        const payload = await api.get(`/api/tender/bids/generate/jobs/${jobId}/source/editor/session`)
        if (!canceled) setGenerateSourcePreviewEditor(payload?.editor || null)
      } catch (err) {
        if (!canceled) {
          setGenerateSourcePreviewEditor(null)
          showError(err.message || 'OnlyOffice 预览会话创建失败')
        }
      }
    }

    loadGeneratePreviewSession().catch(() => {})
    return () => {
      canceled = true
    }
  }, [
    api,
    generateWizard.step,
    generateWizard.analysis?.job?.id,
    generateWizard.analysis?.job?.source_ext,
    generateWizard.analysis?.job?.source_file_name,
    generateWizard.upload?.bidding_file,
  ])

  useEffect(() => {
    staffDialogRef.current = staffDialog
  }, [staffDialog])

  useEffect(() => () => {
    revokeStaffDialogPreviewUrls(staffDialogRef.current)
  }, [])

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
          events: {
            ...(editorPayload?.editor?.config?.events || {}),
            onAppReady: () => setEditorScriptError(''),
            onError: (event) => {
              const code = event?.data?.errorCode || event?.data?.errorDescription || event?.errorCode || ''
              setEditorScriptError(`OnlyOffice 编辑器异常${code ? `（${code}）` : ''}`)
            },
          },
        })
      } catch {
        setEditorScriptError('OnlyOffice 编辑器初始化失败')
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [editorVisible, editorPayload, editorContainerId])

  useEffect(() => {
    if (generateWizard.step !== 2 || !generateSourcePreviewEditor?.config) return
    if (window.DocsAPI?.DocEditor) {
      if (!docsApiReady) setDocsApiReady(true)
      return
    }
    loadEditorScript().catch(() => {})
  }, [docsApiReady, generateWizard.step, generateSourcePreviewEditor])

  useEffect(() => {
    if (generateWizard.step !== 2 || !generateSourcePreviewEditor?.config || !docsApiReady || !window.DocsAPI?.DocEditor) {
      destroyGenerateSourceEditor()
      return undefined
    }
    const timer = setTimeout(() => {
      destroyGenerateSourceEditor()
      try {
        generateSourceEditorRef.current = new window.DocsAPI.DocEditor(generateSourceEditorContainerId, {
          ...generateSourcePreviewEditor.config,
          token: generateSourcePreviewEditor.token,
          width: '100%',
          height: '100%',
          events: {
            ...(generateSourcePreviewEditor?.config?.events || {}),
            onAppReady: () => setEditorScriptError(''),
            onError: (event) => {
              const code = event?.data?.errorCode || event?.data?.errorDescription || event?.errorCode || ''
              setEditorScriptError(`OnlyOffice 预览异常${code ? `（${code}）` : ''}`)
            },
          },
        })
      } catch {
        setEditorScriptError('OnlyOffice 预览初始化失败')
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [docsApiReady, generateWizard.step, generateSourcePreviewEditor, generateSourceEditorContainerId])

  useEffect(() => () => {
    destroyGenerateSourceEditor()
  }, [])

  useEffect(() => () => {
    stopInstructionAutofillStream()
  }, [])

  useEffect(() => {
    if (generateWizard.step !== 2 && generateInstructionStream.running) {
      stopInstructionAutofillStream()
    }
  }, [generateWizard.step, generateInstructionStream.running])

  useEffect(() => {
    if (generateWizard.step !== 2) return
    const touched = generateInstructionTouchedRef.current || {}
    if (touched.agency_name) return
    const current = String(generateWizard.instruction_form?.agency_name || '').trim()
    if (!current) return
    const cleaned = sanitizeAgencyName(current)
    if (!cleaned || cleaned === current) return
    setGenerateWizard((prev) => {
      const nextCurrent = String(prev.instruction_form?.agency_name || '').trim()
      if (!nextCurrent) return prev
      const nextCleaned = sanitizeAgencyName(nextCurrent)
      if (!nextCleaned || nextCleaned === nextCurrent) return prev
      return {
        ...prev,
        instruction_form: {
          ...createGenerateInstructionForm(),
          ...(prev.instruction_form && typeof prev.instruction_form === 'object' ? prev.instruction_form : {}),
          agency_name: nextCleaned,
        },
      }
    })
  }, [generateWizard.step, generateWizard.instruction_form?.agency_name])

  useEffect(() => {
    if (!generateWizard.analysisBusy) {
      setGenerateAnalyzeRuntime({ startedAt: 0, elapsedSeconds: 0 })
      return undefined
    }
    const startedAt = Date.now()
    setGenerateAnalyzeRuntime({ startedAt, elapsedSeconds: 0 })
    const timer = setInterval(() => {
      setGenerateAnalyzeRuntime((prev) => ({
        ...prev,
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      }))
    }, 1000)
    return () => clearInterval(timer)
  }, [generateWizard.analysisBusy])

  useEffect(() => {
    const bidIdSet = new Set(
      bids
        .map((item) => Number(item?.id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
    setBidSelectedIds((prev) => {
      const next = prev.filter((id) => bidIdSet.has(Number(id)))
      return next.length === prev.length ? prev : next
    })
    setEditorSelectedIds((prev) => {
      const next = prev.filter((id) => bidIdSet.has(Number(id)))
      return next.length === prev.length ? prev : next
    })
  }, [bids])

  useEffect(() => {
    setDraftCheckState(createDraftCheckState())
    setScoreOptimizeState(createScoreOptimizeState())
  }, [selectedBid?.id])

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
  const bidSummary = useMemo(() => {
    const summary = { total: bids.length, draft: 0, review: 0, submitted: 0, finalized: 0, archived: 0 }
    for (const item of bids) {
      const status = String(item?.status || '').toUpperCase()
      if (status === 'DRAFT') summary.draft += 1
      else if (status === 'IN_REVIEW') summary.review += 1
      else if (status === 'SUBMITTED') summary.submitted += 1
      else if (status === 'FINALIZED') summary.finalized += 1
      else if (status === 'ARCHIVED') summary.archived += 1
    }
    return summary
  }, [bids])
  const dashboardKpiCards = useMemo(() => {
    const total = bidSummary.total
    const submittedTotal = bidSummary.submitted + bidSummary.archived
    const submitRate = total > 0 ? toPercent((submittedTotal / total) * 100) : 0
    const runningJobs = generateJobs.filter((item) => {
      const key = String(item?.status || '').toUpperCase()
      return key === 'ANALYZING' || key === 'GENERATING'
    }).length
    return [
      {
        key: 'total',
        label: '标书总量',
        value: total,
        hint: '当前在库标书',
        tone: 'tone-blue',
      },
      {
        key: 'submit-rate',
        label: '提交完成率',
        value: `${submitRate}%`,
        hint: `已提交 ${submittedTotal} / ${total || 0}`,
        tone: 'tone-cyan',
      },
      {
        key: 'running',
        label: '在途任务',
        value: runningJobs,
        hint: '分析中或生成中',
        tone: 'tone-amber',
      },
      {
        key: 'model',
        label: '可用模型',
        value: stats.enabled_models || 0,
        hint: `总模型 ${models.length}`,
        tone: 'tone-indigo',
      },
    ]
  }, [bidSummary, generateJobs, models.length, stats.enabled_models])
  const dashboardStatusRows = useMemo(() => {
    const total = Math.max(1, bidSummary.total)
    const source = [
      { key: 'DRAFT', label: '草稿', value: bidSummary.draft, color: '#3b82f6' },
      { key: 'IN_REVIEW', label: '评审中', value: bidSummary.review, color: '#14b8a6' },
      { key: 'FINALIZED', label: '定稿', value: bidSummary.finalized, color: '#8b5cf6' },
      { key: 'SUBMITTED', label: '已提交', value: bidSummary.submitted, color: '#22c55e' },
      { key: 'ARCHIVED', label: '已归档', value: bidSummary.archived, color: '#64748b' },
    ]
    return source.map((item) => ({
      ...item,
      percent: toPercent((item.value / total) * 100),
    }))
  }, [bidSummary])
  const dashboardDonutStyle = useMemo(() => {
    const total = bidSummary.total
    if (total <= 0) {
      return {
        background: 'conic-gradient(#cbd5e1 0deg 360deg)',
      }
    }
    let cursor = 0
    const slices = dashboardStatusRows
      .filter((item) => item.value > 0)
      .map((item) => {
        const size = (item.value / total) * 360
        const start = cursor
        const end = cursor + size
        cursor = end
        return `${item.color} ${start}deg ${end}deg`
      })
    if (cursor < 360) slices.push(`#e2e8f0 ${cursor}deg 360deg`)
    return {
      background: `conic-gradient(${slices.join(', ')})`,
    }
  }, [dashboardStatusRows, bidSummary.total])
  const dashboardTrendRows = useMemo(() => {
    const days = []
    const dayMap = new Map()
    const now = new Date()
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(now)
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - offset)
      const key = toDateKey(date)
      const row = {
        key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        bids: 0,
        jobs: 0,
        samples: 0,
      }
      days.push(row)
      dayMap.set(key, row)
    }

    for (const item of bids) {
      const date = parseDateLike(item?.updated_at || item?.created_at)
      const key = toDateKey(date)
      if (dayMap.has(key)) dayMap.get(key).bids += 1
    }
    for (const item of generateJobs) {
      const date = parseDateLike(item?.updated_at || item?.created_at)
      const key = toDateKey(date)
      if (dayMap.has(key)) dayMap.get(key).jobs += 1
    }
    for (const item of sampleRows) {
      const date = parseDateLike(item?.updated_at || item?.created_at)
      const key = toDateKey(date)
      if (dayMap.has(key)) dayMap.get(key).samples += 1
    }

    const maxValue = Math.max(
      1,
      ...days.map((item) => item.bids + item.jobs + item.samples)
    )
    return days.map((item) => {
      const total = item.bids + item.jobs + item.samples
      return {
        ...item,
        total,
        bidsHeight: toPercent((item.bids / maxValue) * 100),
        jobsHeight: toPercent((item.jobs / maxValue) * 100),
        samplesHeight: toPercent((item.samples / maxValue) * 100),
      }
    })
  }, [bids, generateJobs, sampleRows])
  const dashboardHealthRows = useMemo(() => {
    const ocrTotal = assets.filter((item) => String(item?.ocr_status || '').trim()).length
    const ocrSuccess = assets.filter((item) => {
      const key = String(item?.ocr_status || '').toUpperCase()
      return key === 'AUTO_EXTRACTED' || key === 'CONFIRMED'
    }).length
    const sampleTotal = sampleRows.length
    const sampleSuccess = sampleRows.filter((item) => String(item?.parse_status || '').toUpperCase() === 'SUCCESS').length
    const generatedCount = generateJobs.filter((item) => String(item?.status || '').toUpperCase() === 'GENERATED').length
    const failedCount = generateJobs.filter((item) => String(item?.status || '').toUpperCase() === 'FAILED').length
    const generateDoneBase = generatedCount + failedCount
    const modelEnabled = Number(stats.enabled_models) || 0
    return [
      {
        key: 'ocr',
        label: '证照识别成功率',
        value: ocrTotal > 0 ? toPercent((ocrSuccess / ocrTotal) * 100) : 0,
      },
      {
        key: 'sample',
        label: '样本解析成功率',
        value: sampleTotal > 0 ? toPercent((sampleSuccess / sampleTotal) * 100) : 0,
      },
      {
        key: 'generate',
        label: '任务生成成功率',
        value: generateDoneBase > 0 ? toPercent((generatedCount / generateDoneBase) * 100) : 0,
      },
      {
        key: 'model',
        label: '模型可用率',
        value: models.length > 0 ? toPercent((modelEnabled / models.length) * 100) : 0,
      },
    ]
  }, [assets, sampleRows, generateJobs, stats.enabled_models, models.length])
  const dashboardRiskRows = useMemo(() => {
    const rows = []
    const failedGenerate = generateJobs.filter((item) => String(item?.status || '').toUpperCase() === 'FAILED').length
    const failedSample = sampleRows.filter((item) => String(item?.parse_status || '').toUpperCase() === 'FAILED').length
    const failedOcr = assets.filter((item) => String(item?.ocr_status || '').toUpperCase() === 'FAILED').length
    if (failedGenerate > 0) {
      rows.push({
        level: '高',
        title: '生成任务失败',
        detail: `${failedGenerate} 个任务失败，建议优先检查模型配置和提示词。`,
      })
    }
    if (failedSample > 0) {
      rows.push({
        level: '中',
        title: '样本解析失败',
        detail: `${failedSample} 个样本解析失败，建议重传或检查文档格式。`,
      })
    }
    if (failedOcr > 0) {
      rows.push({
        level: '中',
        title: 'OCR 识别失败',
        detail: `${failedOcr} 份证照识别失败，建议改用高清图或手工确认。`,
      })
    }
    if (rows.length === 0) {
      rows.push({
        level: '低',
        title: '当前未发现高风险',
        detail: '关键任务运行正常，可继续推进投标生成。',
      })
    }
    return rows
  }, [generateJobs, sampleRows, assets])
  const dashboardFunnelRows = useMemo(() => {
    const steps = [
      { key: 'created', label: '创建标书', value: bidSummary.total },
      { key: 'editing', label: '进入协同', value: bidSummary.review + bidSummary.finalized + bidSummary.submitted + bidSummary.archived },
      { key: 'finalized', label: '完成定稿', value: bidSummary.finalized + bidSummary.submitted + bidSummary.archived },
      { key: 'submitted', label: '正式提交', value: bidSummary.submitted + bidSummary.archived },
    ]
    const base = Math.max(1, steps[0].value)
    return steps.map((item) => ({
      ...item,
      width: Math.max(16, toPercent((item.value / base) * 100)),
    }))
  }, [bidSummary])
  const bidSelectedIdSet = useMemo(
    () => new Set(bidSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [bidSelectedIds]
  )
  const bidAllSelected = bids.length > 0 && bids.every((item) => bidSelectedIdSet.has(Number(item.id)))
  const editorSelectedIdSet = useMemo(
    () => new Set(editorSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [editorSelectedIds]
  )
  const editorAllSelected = bids.length > 0 && bids.every((item) => editorSelectedIdSet.has(Number(item.id)))
  const generateRows = useMemo(() => {
    const keyword = String(generateSearch || '').trim().toLowerCase()
    const rows = generateJobs.map((item) => {
      const progress = generateJobProgress(item.status, item.progress)
      return {
        ...item,
        file_name: firstNonEmpty(item.source_file_name, item.title, '未命名招标文件'),
        progress,
      }
    })
    if (!keyword) return rows
    return rows.filter((item) => {
      const text = [item.file_name, item.status, item.model_name, item.warning_text]
        .join(' ')
        .toLowerCase()
      return text.includes(keyword)
    })
  }, [generateJobs, generateSearch])
  const generateSummary = useMemo(() => {
    const summary = { total: generateRows.length, generated: 0, running: 0, failed: 0 }
    for (const item of generateRows) {
      const status = String(item?.status || '').toUpperCase()
      if (status === 'GENERATED') summary.generated += 1
      else if (status === 'ANALYZING' || status === 'GENERATING') summary.running += 1
      else if (status === 'FAILED') summary.failed += 1
    }
    return summary
  }, [generateRows])
  const generateSelectedIdSet = useMemo(
    () => new Set(generateSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [generateSelectedIds]
  )
  const generateAllSelected = generateRows.length > 0
    && generateRows.every((item) => generateSelectedIdSet.has(Number(item.id)))
  const generateTotal = generateRows.length
  const generateTotalPages = Math.max(1, Math.ceil(generateTotal / Math.max(1, Number(generatePageSize) || 8)))
  const normalizedGeneratePage = Math.min(Math.max(1, Number(generatePage) || 1), generateTotalPages)
  const generatePagedRows = useMemo(() => {
    const size = Math.max(1, Number(generatePageSize) || 8)
    const start = (normalizedGeneratePage - 1) * size
    return generateRows.slice(start, start + size)
  }, [generateRows, normalizedGeneratePage, generatePageSize])
  const sampleFilteredRows = useMemo(() => {
    const keyword = String(sampleSearch || '').trim().toLowerCase()
    if (!keyword) return sampleRows
    return sampleRows.filter((item) => {
      const text = [
        item.sample_no,
        item.title,
        item.original_file_name,
        item.parse_status,
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(keyword)
    })
  }, [sampleRows, sampleSearch])
  const sampleSummary = useMemo(() => {
    const summary = { total: sampleFilteredRows.length, success: 0, pending: 0, failed: 0 }
    for (const item of sampleFilteredRows) {
      const key = String(item?.parse_status || '').toUpperCase()
      if (key === 'SUCCESS') summary.success += 1
      else if (key === 'FAILED') summary.failed += 1
      else summary.pending += 1
    }
    return summary
  }, [sampleFilteredRows])
  const sampleSelectedIdSet = useMemo(
    () => new Set(sampleSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [sampleSelectedIds]
  )
  const sampleAllSelected = sampleFilteredRows.length > 0
    && sampleFilteredRows.every((item) => sampleSelectedIdSet.has(Number(item.id)))
  const sampleTotal = sampleFilteredRows.length
  const sampleTotalPages = Math.max(1, Math.ceil(sampleTotal / Math.max(1, Number(samplePageSize) || 10)))
  const normalizedSamplePage = Math.min(Math.max(1, Number(samplePage) || 1), sampleTotalPages)
  const samplePagedRows = useMemo(() => {
    const size = Math.max(1, Number(samplePageSize) || 10)
    const start = (normalizedSamplePage - 1) * size
    return sampleFilteredRows.slice(start, start + size)
  }, [sampleFilteredRows, normalizedSamplePage, samplePageSize])
  const qualificationAssets = useMemo(
    () => assets.filter((item) => String(item.asset_type || '').toUpperCase() === 'QUALIFICATION'),
    [assets]
  )
  const qualificationRows = useMemo(() => {
    const keyword = String(qualificationSearch || '').trim().toLowerCase()
    const rows = qualificationAssets.map((item) => {
      const fields = item?.fields_json || {}
      const certName = firstNonEmpty(fields.title, fields.name, fields.qualification_name, '-')
      const certNo = firstNonEmpty(fields.certificate_no, fields.number, fields.no, '-')
      const certLevel = firstNonEmpty(fields.level, fields.rating, fields.grade, '-')
      const validFrom = normalizeDateToInput(firstNonEmpty(fields.valid_from))
      const validToRaw = firstNonEmpty(fields.valid_to)
      const validTo = normalizeDateToInput(validToRaw)
      const validLongTerm = Number(fields.valid_long_term || 0) > 0 || String(validToRaw || '').includes('长期')
      const validText = validLongTerm
        ? `${validFrom ? `${validFrom} 起` : ''}长期有效`
        : `${validFrom || '-'} 至 ${validTo || '-'}`

      return {
        ...item,
        certName,
        certNo,
        certLevel,
        validText,
      }
    })
    if (!keyword) return rows
    return rows.filter((item) => {
      const text = [
        item.original_file_name,
        item.certName,
        item.certNo,
        item.certLevel,
      ].join(' ').toLowerCase()
      return text.includes(keyword)
    })
  }, [qualificationAssets, qualificationSearch])
  const qualificationSelectedIdSet = useMemo(
    () => new Set(qualificationSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [qualificationSelectedIds]
  )
  const qualificationAllSelected = qualificationRows.length > 0
    && qualificationRows.every((item) => qualificationSelectedIdSet.has(Number(item.id)))
  const qualificationTotal = qualificationRows.length
  const qualificationTotalPages = Math.max(1, Math.ceil(qualificationTotal / Math.max(1, Number(qualificationPageSize) || 10)))
  const normalizedQualificationPage = Math.min(Math.max(1, Number(qualificationPage) || 1), qualificationTotalPages)
  const qualificationPagedRows = useMemo(() => {
    const size = Math.max(1, Number(qualificationPageSize) || 10)
    const start = (normalizedQualificationPage - 1) * size
    return qualificationRows.slice(start, start + size)
  }, [qualificationRows, normalizedQualificationPage, qualificationPageSize])
  const financeAssets = useMemo(
    () =>
      assets.filter((item) => {
        const fields = item?.fields_json || {}
        const docType = String(item?.doc_type || fields?.doc_type || '').toUpperCase()
        const section = String(fields?.library_section || '').toLowerCase()
        return docType === 'FINANCE_INFO' || section === 'finance'
      }),
    [assets]
  )
  const financeRows = useMemo(() => {
    const keyword = String(financeSearch || '').trim().toLowerCase()
    const rows = financeAssets.map((item) => {
      const fields = item?.fields_json || {}
      const infoName = firstNonEmpty(fields.info_name, fields.title, item.original_file_name, '-')
      const infoType = firstNonEmpty(fields.info_type, fields.finance_type, '未分类')
      const infoDate = normalizeDateToInput(firstNonEmpty(fields.info_date, fields.date))
      return {
        ...item,
        infoName,
        infoType,
        infoDate: infoDate || '-',
      }
    })
    if (!keyword) return rows
    return rows.filter((item) => {
      const text = [
        item.original_file_name,
        item.infoName,
        item.infoType,
        item.infoDate,
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(keyword)
    })
  }, [financeAssets, financeSearch])
  const financeSelectedIdSet = useMemo(
    () => new Set(financeSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [financeSelectedIds]
  )
  const financeAllSelected = financeRows.length > 0
    && financeRows.every((item) => financeSelectedIdSet.has(Number(item.id)))
  const financeTotal = financeRows.length
  const financeTotalPages = Math.max(1, Math.ceil(financeTotal / Math.max(1, Number(financePageSize) || 10)))
  const normalizedFinancePage = Math.min(Math.max(1, Number(financePage) || 1), financeTotalPages)
  const financePagedRows = useMemo(() => {
    const size = Math.max(1, Number(financePageSize) || 10)
    const start = (normalizedFinancePage - 1) * size
    return financeRows.slice(start, start + size)
  }, [financeRows, normalizedFinancePage, financePageSize])
  const performanceRows = useMemo(() => {
    const keyword = String(performanceSearch || '').trim().toLowerCase()
    if (!keyword) return performanceEntries
    return performanceEntries.filter((item) => {
      const text = [
        item.project_name,
        item.project_no,
        item.project_type,
        item.party_a_name,
        item.party_a_type,
        item.project_amount,
        item.project_leader,
        item.contact_phone,
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(keyword)
    })
  }, [performanceEntries, performanceSearch])
  const performanceSelectedIdSet = useMemo(
    () => new Set(performanceSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [performanceSelectedIds]
  )
  const performanceAllSelected = performanceRows.length > 0
    && performanceRows.every((item) => performanceSelectedIdSet.has(Number(item.id)))
  const performanceTotal = performanceRows.length
  const performanceTotalPages = Math.max(1, Math.ceil(performanceTotal / Math.max(1, Number(performancePageSize) || 8)))
  const normalizedPerformancePage = Math.min(Math.max(1, Number(performancePage) || 1), performanceTotalPages)
  const performancePagedRows = useMemo(() => {
    const size = Math.max(1, Number(performancePageSize) || 8)
    const start = (normalizedPerformancePage - 1) * size
    return performanceRows.slice(start, start + size)
  }, [performanceRows, normalizedPerformancePage, performancePageSize])
  const staffRows = useMemo(() => {
    const keyword = String(staffSearch || '').trim().toLowerCase()
    const rows = staffEntries.map((item) => {
      const age = calculateAgeFromBirthDate(item.birth_date)
      const certificateText = firstNonEmpty(
        item.qualification_cert,
        item.attachments?.education_cert?.fileName,
        item.attachments?.driver_license?.fileName,
        '-'
      )
      return {
        ...item,
        age,
        certificateText,
      }
    })
    if (!keyword) return rows
    return rows.filter((item) => {
      const text = [
        item.name,
        item.gender,
        item.age,
        item.education,
        item.position,
        item.major,
        item.certificateText,
        item.id_no,
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(keyword)
    })
  }, [staffEntries, staffSearch])
  const staffSelectedIdSet = useMemo(
    () => new Set(staffSelectedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    [staffSelectedIds]
  )
  const staffAllSelected = staffRows.length > 0 && staffRows.every((item) => staffSelectedIdSet.has(Number(item.id)))
  const staffTotal = staffRows.length
  const staffTotalPages = Math.max(1, Math.ceil(staffTotal / Math.max(1, Number(staffPageSize) || 10)))
  const normalizedStaffPage = Math.min(Math.max(1, Number(staffPage) || 1), staffTotalPages)
  const staffPagedRows = useMemo(() => {
    const size = Math.max(1, Number(staffPageSize) || 10)
    const start = (normalizedStaffPage - 1) * size
    return staffRows.slice(start, start + size)
  }, [staffRows, normalizedStaffPage, staffPageSize])

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

  useEffect(() => {
    setQualificationSelectedIds((prev) => prev.filter((id) => qualificationRows.some((item) => Number(item.id) === Number(id))))
  }, [qualificationRows])

  useEffect(() => {
    setFinanceSelectedIds((prev) => prev.filter((id) => financeRows.some((item) => Number(item.id) === Number(id))))
  }, [financeRows])

  useEffect(() => {
    setGenerateSelectedIds((prev) => prev.filter((id) => generateRows.some((item) => Number(item.id) === Number(id))))
  }, [generateRows])

  useEffect(() => {
    if (qualificationPage !== normalizedQualificationPage) setQualificationPage(normalizedQualificationPage)
    setQualificationGotoPage(String(normalizedQualificationPage))
  }, [qualificationPage, normalizedQualificationPage])

  useEffect(() => {
    if (financePage !== normalizedFinancePage) setFinancePage(normalizedFinancePage)
    setFinanceGotoPage(String(normalizedFinancePage))
  }, [financePage, normalizedFinancePage])

  useEffect(() => {
    if (generatePage !== normalizedGeneratePage) setGeneratePage(normalizedGeneratePage)
    setGenerateGotoPage(String(normalizedGeneratePage))
  }, [generatePage, normalizedGeneratePage])

  useEffect(() => {
    setSampleSelectedIds((prev) => prev.filter((id) => sampleFilteredRows.some((item) => Number(item.id) === Number(id))))
  }, [sampleFilteredRows])

  useEffect(() => {
    if (samplePage !== normalizedSamplePage) setSamplePage(normalizedSamplePage)
    setSampleGotoPage(String(normalizedSamplePage))
  }, [samplePage, normalizedSamplePage])

  useEffect(() => {
    setPerformanceSelectedIds((prev) => prev.filter((id) => performanceRows.some((item) => Number(item.id) === Number(id))))
  }, [performanceRows])

  useEffect(() => {
    if (performancePage !== normalizedPerformancePage) setPerformancePage(normalizedPerformancePage)
    setPerformanceGotoPage(String(normalizedPerformancePage))
  }, [performancePage, normalizedPerformancePage])

  useEffect(() => {
    savePerformanceEntries(performanceEntries)
  }, [performanceEntries])

  useEffect(() => {
    setStaffSelectedIds((prev) => prev.filter((id) => staffRows.some((item) => Number(item.id) === Number(id))))
  }, [staffRows])

  useEffect(() => {
    if (staffPage !== normalizedStaffPage) setStaffPage(normalizedStaffPage)
    setStaffGotoPage(String(normalizedStaffPage))
  }, [staffPage, normalizedStaffPage])

  useEffect(() => {
    savePersonnelEntries(staffEntries)
  }, [staffEntries])

  const visibleMainTabs = mainTabs.filter((tab) => {
    if (tab.key === 'bids' || tab.key === 'editor') return canRead
    if (tab.key === 'bid-generate') return canWrite
    if (tab.key === 'ai') return canAiUse || canAiManage
    if (tab.key === 'audit') return canAudit
    if (tab.key === 'config') return canConfigManage
    return true
  })
  const visibleOwnLibraryTabs = canRead ? ownLibraryTabs : []
  const staffAttachmentMeta = [
    { key: 'id_card', label: '身份证', required: true, accept: '.jpg,.jpeg,.png,.pdf' },
    { key: 'education_cert', label: '毕业证', required: false, accept: '.jpg,.jpeg,.png,.pdf' },
    { key: 'contract', label: '合同', required: false, accept: '.jpg,.jpeg,.png,.pdf' },
    { key: 'driver_license', label: '驾驶证', required: false, accept: '.jpg,.jpeg,.png,.pdf' },
    { key: 'social_security', label: '社保', required: false, accept: '.jpg,.jpeg,.png,.pdf' },
  ]

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
      if (Number(selectedBid?.id) === Number(bidId)) {
        await Promise.all([fetchVersions(bidId), fetchEditorEvents(bidId, { silent: true })])
      }
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
      fetchEditorEvents(bid.id, { silent: true }).catch(() => {})
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
        await Promise.all([fetchVersions(createdBid.id), fetchEditorEvents(createdBid.id)])
      }
      showMessage('已根据招标文件自动生成投标文件')
      fetchBootstrap().catch(() => {})
      fetchAssets().catch(() => {})
    } catch (err) {
      showError(err.message)
    }
  }

  const resetSelectedBidPanel = () => {
    setSelectedBid(null)
    setVersions([])
    setEditorEvents([])
    setCompareState({
      leftVersionId: '',
      rightVersionId: '',
      loading: false,
      result: null,
    })
  }

  const deleteBidWithRetry = async (id, maxRetries = 2) => {
    let attempt = 0
    while (true) {
      try {
        await api.del(`/api/tender/bids/${id}`)
        return
      } catch (err) {
        if (!isDbDeadlockError(err) || attempt >= maxRetries) throw err
        await sleepMs(120 * (attempt + 1))
        attempt += 1
      }
    }
  }

  const onToggleBidSelectAll = (checked) => {
    if (!checked) {
      setBidSelectedIds([])
      return
    }
    setBidSelectedIds(bids.map((item) => Number(item.id)).filter((id) => Number.isFinite(id) && id > 0))
  }

  const onToggleBidSelect = (id, checked) => {
    const targetId = Number(id)
    if (!Number.isFinite(targetId) || targetId <= 0) return
    setBidSelectedIds((prev) => {
      const next = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) next.add(targetId)
      else next.delete(targetId)
      return Array.from(next)
    })
  }

  const onToggleEditorSelectAll = (checked) => {
    if (!checked) {
      setEditorSelectedIds([])
      return
    }
    setEditorSelectedIds(bids.map((item) => Number(item.id)).filter((id) => Number.isFinite(id) && id > 0))
  }

  const onToggleEditorSelect = (id, checked) => {
    const targetId = Number(id)
    if (!Number.isFinite(targetId) || targetId <= 0) return
    setEditorSelectedIds((prev) => {
      const next = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) next.add(targetId)
      else next.delete(targetId)
      return Array.from(next)
    })
  }

  const onDeleteBid = async (id) => {
    const targetId = Number(id)
    if (!Number.isFinite(targetId) || targetId <= 0) return
    if (!window.confirm('确认删除该标书吗？删除后版本和草稿将一并清理。')) return
    resetFeedback()
    try {
      await deleteBidWithRetry(targetId, 2)
      await fetchBids()
      setBidSelectedIds((prev) => prev.filter((item) => Number(item) !== targetId))
      setEditorSelectedIds((prev) => prev.filter((item) => Number(item) !== targetId))
      if (Number(selectedBid?.id) === targetId) {
        if (editorVisible) {
          await onCloseEditor()
        }
        resetSelectedBidPanel()
      }
      showMessage('标书已删除')
      fetchBootstrap().catch(() => {})
    } catch (err) {
      showError(err.message || '删除标书失败')
    }
  }

  const onBatchDeleteBids = async (mode = 'bids') => {
    const sourceIds = mode === 'editor' ? editorSelectedIdSet : bidSelectedIdSet
    const ids = Array.from(sourceIds)
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
    if (!ids.length) {
      showError('请先勾选要删除的标书')
      return
    }
    if (!window.confirm(`确认删除已选 ${ids.length} 份标书吗？删除后版本和草稿将一并清理。`)) return
    resetFeedback()
    try {
      const failed = []
      let successCount = 0
      for (let i = 0; i < ids.length; i += 1) {
        const currentId = ids[i]
        try {
          await deleteBidWithRetry(currentId, 2)
          successCount += 1
        } catch (err) {
          failed.push({ id: currentId, message: err?.message || '删除失败' })
        }
      }
      await fetchBids()
      const failedIdSet = new Set(failed.map((item) => Number(item.id)))
      const successIdSet = new Set(ids.filter((id) => !failedIdSet.has(Number(id))))
      if (mode === 'editor') setEditorSelectedIds(ids.filter((id) => failedIdSet.has(Number(id))))
      else setBidSelectedIds(ids.filter((id) => failedIdSet.has(Number(id))))
      setBidSelectedIds((prev) => prev.filter((id) => !successIdSet.has(Number(id))))
      setEditorSelectedIds((prev) => prev.filter((id) => !successIdSet.has(Number(id))))

      if (selectedBid?.id && successIdSet.has(Number(selectedBid.id))) {
        if (editorVisible) {
          await onCloseEditor()
        }
        resetSelectedBidPanel()
      }
      fetchBootstrap().catch(() => {})

      if (!failed.length) {
        showMessage('批量删除标书成功')
        return
      }
      showError(`已删除 ${successCount} 条，失败 ${failed.length} 条：${failed[0]?.message || '删除失败'}`)
    } catch (err) {
      showError(err.message || '批量删除标书失败')
    }
  }

  const onToggleGenerateSelectAll = (checked) => {
    if (!checked) {
      setGenerateSelectedIds([])
      return
    }
    setGenerateSelectedIds(generateRows.map((item) => Number(item.id)).filter((id) => Number.isFinite(id) && id > 0))
  }

  const onToggleGenerateSelect = (id, checked) => {
    const targetId = Number(id)
    if (!Number.isFinite(targetId) || targetId <= 0) return
    setGenerateSelectedIds((prev) => {
      const next = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) next.add(targetId)
      else next.delete(targetId)
      return Array.from(next)
    })
  }

  const onChangeGeneratePageSize = (value) => {
    const parsed = Number(value)
    const nextSize = Number.isFinite(parsed) ? Math.min(200, Math.max(1, parsed)) : 10
    setGeneratePageSize(nextSize)
    setGeneratePage(1)
  }

  const onJumpGeneratePage = () => {
    const parsed = Number(generateGotoPage)
    if (!Number.isFinite(parsed)) {
      setGenerateGotoPage(String(normalizedGeneratePage))
      return
    }
    const target = Math.min(generateTotalPages, Math.max(1, Math.floor(parsed)))
    setGeneratePage(target)
    setGenerateGotoPage(String(target))
  }

  const resetGenerateWizard = () => {
    stopInstructionAutofillStream()
    setGenerateWizard(createGenerateWizardState())
    setGenerateUploadInputSeed((prev) => prev + 1)
    setGenerateInstructionTouched({})
    generateInstructionTouchedRef.current = {}
  }

  const onOpenGenerateWizard = () => {
    resetFeedback()
    const defaultModel = models.find((item) => Number(item.is_default) === 1 && Number(item.is_enabled) === 1)
      || models.find((item) => Number(item.is_enabled) === 1)
    const defaultTemplate = docTemplates.find((item) => Number(item.is_default) === 1 && String(item.status || '').toUpperCase() === 'ACTIVE')
      || docTemplates.find((item) => String(item.status || '').toUpperCase() === 'ACTIVE')
    setGenerateWizard({
      ...createGenerateWizardState(),
      open: true,
      model_id: defaultModel?.id ? String(defaultModel.id) : '',
      upload: {
        ...createBidGenerateUploadForm(),
        doc_template_id: defaultTemplate?.id ? String(defaultTemplate.id) : '',
      },
    })
    setGenerateQualificationTab('qualification')
    setGenerateUploadInputSeed((prev) => prev + 1)
  }

  const onBackToGenerateList = () => {
    resetGenerateWizard()
  }

  const onPickGenerateFile = (key, file) => {
    setGenerateWizard((prev) => ({ ...prev, upload: { ...prev.upload, [key]: file || null } }))
  }

  const onChangeGenerateInstructionField = (field, value) => {
    setGenerateInstructionTouched((prev) => ({ ...prev, [field]: true }))
    generateInstructionTouchedRef.current = { ...generateInstructionTouchedRef.current, [field]: true }
    setGenerateWizard((prev) => ({
      ...prev,
      instruction_form: {
        ...createGenerateInstructionForm(),
        ...(prev.instruction_form && typeof prev.instruction_form === 'object' ? prev.instruction_form : {}),
        [field]: value,
      },
    }))
  }

  const onStartGenerateAnalysis = async () => {
    resetFeedback()
    try {
      if (!generateWizard.upload.bidding_file) throw new Error('请先上传招标文件')
      if (!generateWizard.upload.bid_category) throw new Error('请选择招标类型（服务类/产品类）')
      if (!generateWizard.upload.doc_template_id) throw new Error('请选择投标模板')
      setGenerateWizard((prev) => ({ ...prev, analysisBusy: true }))
      const form = new FormData()
      form.append('file', generateWizard.upload.bidding_file)
      form.append('bid_category', String(generateWizard.upload.bid_category))
      if (generateWizard.model_id) form.append('model_id', String(generateWizard.model_id))

      const titleSeed = String(generateWizard.upload.bidding_file?.name || '').replace(/\.[^/.]+$/, '').trim()
      const customerSeed = companyForm.company_name || ''
      const projectSeed = titleSeed || ''

      const result = await api.post('/api/tender/bids/generate/analyze', form)
      const matchIds = Array.isArray(result?.matches)
        ? result.matches.map((item) => Number(item.sample_id)).filter((id) => Number.isFinite(id) && id > 0)
        : []
      const instructionForm = buildGenerateInstructionFormFromAnalysis(result)
      setGenerateInstructionTouched({})
      generateInstructionTouchedRef.current = {}

      setGenerateWizard((prev) => ({
        ...prev,
        analysisBusy: false,
        step: 2,
        analysis: result,
        selected_sample_ids: matchIds,
        instruction_form: createGenerateInstructionForm(),
        create_form: {
          title: `${titleSeed || '自动生成'}投标文件`,
          customer_name: customerSeed,
          project_name: firstNonEmpty(instructionForm.project_name, projectSeed),
          summary: `由招标文件分析自动生成，来源：${generateWizard.upload.bidding_file?.name || '-'}`,
        },
      }))
      startInstructionAutofillStream(instructionForm, { overwrite: true })
      setGenerateQualificationTab('qualification')

      await Promise.allSettled([fetchGenerateJobs(), fetchBootstrap(), fetchSamples()])
      showMessage('分析完成，请先核对得分项与风险项后再生成初稿')
    } catch (err) {
      showError(err.message)
    } finally {
      setGenerateWizard((prev) => ({ ...prev, analysisBusy: false }))
    }
  }

  const buildLibrarySnapshot = () => {
    const qualificationPayload = qualificationRows.map((item) => ({
      id: item.id,
      title: item.certName,
      certificate_no: item.certNo,
      level: item.certLevel,
      valid_text: item.validText,
      original_file_name: item.original_file_name,
    }))
    const financePayload = financeRows.map((item) => ({
      id: item.id,
      info_name: item.infoName,
      info_type: item.infoType,
      info_date: item.infoDate,
      original_file_name: item.original_file_name,
    }))
    const performancePayload = performanceEntries.map((item) => ({ ...item }))
    const personnelPayload = staffEntries.map((item) => ({ ...item }))
    const legal = {
      name: personnelForm.legal_name,
      id_no: personnelForm.legal_id_no,
      gender: personnelForm.legal_gender,
      birth_date: personnelForm.legal_birth_date,
      id_valid_from: personnelForm.legal_id_valid_from,
      id_valid_to: personnelForm.legal_id_valid_to,
      id_long_term: !!personnelForm.legal_id_long_term,
      position: personnelForm.legal_position,
    }
    const agent = {
      name: personnelForm.agent_name,
      id_no: personnelForm.agent_id_no,
      gender: personnelForm.agent_gender,
      birth_date: personnelForm.agent_birth_date,
      id_valid_from: personnelForm.agent_id_valid_from,
      id_valid_to: personnelForm.agent_id_valid_to,
      id_long_term: !!personnelForm.agent_id_long_term,
      position: personnelForm.agent_position,
    }
    return {
      company: { ...companyForm },
      personnel: { legal, agent },
      qualifications: qualificationPayload,
      finance: financePayload,
      performance: performancePayload,
      personnel_list: personnelPayload,
    }
  }

  const onConfirmGenerateDraft = async () => {
    resetFeedback()
    try {
      if (wizardScoreTableBlocked) throw new Error(wizardScoreTableBlockedMessage)
      const jobId = Number(generateWizard.analysis?.job?.id || 0)
      if (!jobId) throw new Error('缺少分析任务，请先完成分析')
      setGenerateWizard((prev) => ({ ...prev, createBusy: true }))

      const payload = {
        model_id: generateWizard.model_id ? Number(generateWizard.model_id) : undefined,
        doc_template_id: generateWizard.upload.doc_template_id ? Number(generateWizard.upload.doc_template_id) : undefined,
        sample_ids: generateWizard.selected_sample_ids,
        instruction_form: generateWizard.instruction_form,
        title: generateWizard.create_form.title,
        customer_name: generateWizard.create_form.customer_name,
        project_name: generateWizard.create_form.project_name,
        summary: generateWizard.create_form.summary,
        library_snapshot: buildLibrarySnapshot(),
      }
      const result = await api.post(`/api/tender/bids/generate/jobs/${jobId}/create`, payload)
      const createdBid = result?.bid || null

      await Promise.allSettled([fetchGenerateJobs(), fetchBids(), fetchVersions(createdBid?.id), fetchBootstrap()])
      if (createdBid?.id) {
        setSelectedBid(createdBid)
        await Promise.allSettled([fetchVersions(createdBid.id), fetchEditorEvents(createdBid.id)])
        setActiveTab('bids')
      }
      resetGenerateWizard()
      showMessage('投标初稿已生成，可在标书管理/在线编辑继续完善')
    } catch (err) {
      showError(err.message || '生成初稿失败')
    } finally {
      setGenerateWizard((prev) => ({ ...prev, createBusy: false }))
    }
  }

  const onOpenGenerateBid = async (item) => {
    resetFeedback()
    try {
      const bidId = Number(item?.created_bid_id || 0)
      if (bidId > 0) {
        const bid = bids.find((row) => Number(row.id) === bidId)
        if (bid) {
          setActiveTab('bids')
          openBidVersionPanel(bid).catch(() => {})
          return
        }
        const detailBid = await api.get(`/api/tender/bids/${bidId}`)
        if (detailBid?.id) {
          setActiveTab('bids')
          openBidVersionPanel(detailBid).catch(() => {})
          return
        }
      }

      const detail = await api.get(`/api/tender/bids/generate/jobs/${item.id}`)
      const selectedSampleIds = Array.isArray(detail?.matches)
        ? detail.matches.map((match) => Number(match.sample_id)).filter((id) => Number.isFinite(id) && id > 0)
        : []
      const titleSeed = String(detail?.job?.source_file_name || '').replace(/\.[^/.]+$/, '').trim()
      const instructionForm = buildGenerateInstructionFormFromAnalysis(detail)
      setGenerateInstructionTouched({})
      generateInstructionTouchedRef.current = {}
      setGenerateWizard((prev) => ({
        ...prev,
        open: true,
        step: detail?.job?.created_bid_id ? 3 : 2,
        model_id: detail?.job?.model_id ? String(detail.job.model_id) : prev.model_id,
        upload: {
          ...createBidGenerateUploadForm(),
          bid_category: String(detail?.job?.bid_category || prev?.upload?.bid_category || '').toUpperCase(),
        },
        analysis: detail,
        selected_sample_ids: selectedSampleIds,
        instruction_form: createGenerateInstructionForm(),
        create_form: {
          title: `${titleSeed || '自动生成'}投标文件`,
          customer_name: companyForm.company_name || '',
          project_name: firstNonEmpty(instructionForm.project_name, titleSeed),
          summary: `由招标文件分析自动生成，来源：${detail?.job?.source_file_name || '-'}`,
        },
      }))
      startInstructionAutofillStream(instructionForm, { overwrite: true })
    } catch (err) {
      showError(err.message || '读取生成任务详情失败')
    }
  }

  const onBackGenerateToStep2 = () => {
    setGenerateWizard((prev) => ({ ...prev, step: 2 }))
  }

  const onGoGenerateStep3 = () => {
    if (wizardScoreTableBlocked) {
      showError(wizardScoreTableBlockedMessage)
      return
    }
    if (!wizardCanCreateDraft) {
      showError('请先完成分析后再生成')
      return
    }
    setGenerateWizard((prev) => ({ ...prev, step: 3 }))
  }

  const onBackGenerateToStep1 = () => {
    setGenerateWizard((prev) => ({ ...prev, step: 1 }))
  }

  const isDbDeadlockError = (err) => {
    const text = String(err?.message || '').toLowerCase()
    return text.includes('deadlock found when trying to get lock') || text.includes('er_lock_deadlock')
  }

  const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const deleteGenerateJobWithRetry = async (id, maxRetries = 2) => {
    let attempt = 0
    while (true) {
      try {
        await api.del(`/api/tender/bids/generate/jobs/${id}`)
        return
      } catch (err) {
        if (!isDbDeadlockError(err) || attempt >= maxRetries) throw err
        await sleepMs(120 * (attempt + 1))
        attempt += 1
      }
    }
  }

  const onBatchDeleteGenerateRows = async () => {
    const ids = Array.from(generateSelectedIdSet)
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
    if (!ids.length) {
      showError('请先勾选要删除的分析任务')
      return
    }
    if (!window.confirm(`确认删除已选 ${ids.length} 个分析任务吗？`)) return
    resetFeedback()
    try {
      const failed = []
      let successCount = 0
      for (let i = 0; i < ids.length; i += 1) {
        const currentId = ids[i]
        try {
          await deleteGenerateJobWithRetry(currentId, 2)
          successCount += 1
        } catch (err) {
          failed.push({ id: currentId, message: err?.message || '删除失败' })
        }
      }
      await fetchGenerateJobs()
      if (!failed.length) {
        setGenerateSelectedIds([])
        showMessage('批量删除成功')
        return
      }
      const failedIdSet = new Set(failed.map((item) => Number(item.id)))
      setGenerateSelectedIds(ids.filter((id) => failedIdSet.has(Number(id))))
      showError(`已删除 ${successCount} 条，失败 ${failed.length} 条：${failed[0]?.message || '删除失败'}`)
    } catch (err) {
      showError(err.message || '批量删除失败')
    }
  }

  const onDeleteGenerateRow = async (id) => {
    const target = Number(id)
    if (!Number.isFinite(target) || target <= 0) return
    if (!window.confirm('确认删除该分析任务吗？')) return
    resetFeedback()
    try {
      await deleteGenerateJobWithRetry(target, 2)
      await fetchGenerateJobs()
      setGenerateSelectedIds((prev) => prev.filter((item) => Number(item) !== target))
      showMessage('分析任务已删除')
    } catch (err) {
      showError(err.message || '删除失败')
    }
  }

  const onToggleWizardSample = (sampleId, checked) => {
    const target = Number(sampleId)
    if (!Number.isFinite(target) || target <= 0) return
    setGenerateWizard((prev) => {
      const next = new Set(
        (Array.isArray(prev.selected_sample_ids) ? prev.selected_sample_ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
      if (checked) next.add(target)
      else next.delete(target)
      return { ...prev, selected_sample_ids: Array.from(next) }
    })
  }

  const onToggleSampleSelect = (id, checked) => {
    const target = Number(id)
    if (!target) return
    setSampleSelectedIds((prev) => {
      const set = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) set.add(target)
      else set.delete(target)
      return Array.from(set)
    })
  }

  const onToggleSampleSelectAll = (checked) => {
    if (!checked) {
      setSampleSelectedIds([])
      return
    }
    setSampleSelectedIds(sampleFilteredRows.map((item) => Number(item.id)))
  }

  const onChangeSamplePageSize = (value) => {
    const parsed = Number(value)
    const next = Number.isFinite(parsed) ? Math.min(200, Math.max(1, parsed)) : 10
    setSamplePageSize(next)
    setSamplePage(1)
  }

  const onJumpSamplePage = () => {
    const parsed = Number(sampleGotoPage)
    if (!Number.isFinite(parsed)) {
      setSampleGotoPage(String(normalizedSamplePage))
      return
    }
    const target = Math.min(sampleTotalPages, Math.max(1, Math.floor(parsed)))
    setSamplePage(target)
    setSampleGotoPage(String(target))
  }

  const onUploadSampleFile = async (file) => {
    if (!file) return
    resetFeedback()
    setSampleUploadBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post('/api/tender/samples/upload', form)
      await Promise.allSettled([fetchSamples(), fetchBootstrap()])
      setSampleUploadInputSeed((prev) => prev + 1)
      showMessage('历史样本上传完成')
    } catch (err) {
      showError(err.message || '样本上传失败')
    } finally {
      setSampleUploadBusy(false)
    }
  }

  const onDeleteSample = async (id) => {
    if (!Number(id)) return
    if (!window.confirm('确认删除该历史样本吗？')) return
    resetFeedback()
    try {
      await deleteSampleWithRetry(Number(id), 2)
      await fetchSamples()
      setSampleSelectedIds((prev) => prev.filter((item) => Number(item) !== Number(id)))
      showMessage('样本已删除')
    } catch (err) {
      showError(err.message || '删除样本失败')
    }
  }

  const deleteSampleWithRetry = async (id, maxRetries = 2) => {
    let attempt = 0
    while (true) {
      try {
        await api.del(`/api/tender/samples/${id}`)
        return
      } catch (err) {
        if (!isDbDeadlockError(err) || attempt >= maxRetries) throw err
        await sleepMs(120 * (attempt + 1))
        attempt += 1
      }
    }
  }

  const onBatchDeleteSamples = async () => {
    if (!sampleSelectedIds.length) {
      showError('请先勾选要删除的样本')
      return
    }
    if (!window.confirm(`确认删除已选 ${sampleSelectedIds.length} 个样本吗？`)) return
    resetFeedback()
    try {
      const ids = sampleSelectedIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
      const failed = []
      let successCount = 0
      for (let i = 0; i < ids.length; i += 1) {
        const currentId = ids[i]
        try {
          await deleteSampleWithRetry(currentId, 2)
          successCount += 1
        } catch (err) {
          failed.push({ id: currentId, message: err?.message || '删除失败' })
        }
      }
      await fetchSamples()
      if (!failed.length) {
        setSampleSelectedIds([])
        showMessage('批量删除完成')
        return
      }
      const failedIdSet = new Set(failed.map((item) => Number(item.id)))
      setSampleSelectedIds(ids.filter((id) => failedIdSet.has(Number(id))))
      showError(`已删除 ${successCount} 条，失败 ${failed.length} 条：${failed[0]?.message || '删除失败'}`)
    } catch (err) {
      showError(err.message || '批量删除失败')
    }
  }

  const onCompareVersions = async () => {
    if (!selectedBid?.id || compareState.loading) return
    const left = Number(compareState.leftVersionId || 0)
    const right = Number(compareState.rightVersionId || 0)
    if (!left || !right || left === right) {
      showError('请选择两个不同版本进行对比')
      return
    }
    resetFeedback()
    setCompareState((prev) => ({ ...prev, loading: true }))
    try {
      const payload = await api.get(
        `/api/tender/bids/${selectedBid.id}/versions/compare?left_version_id=${left}&right_version_id=${right}`
      )
      setCompareState((prev) => ({ ...prev, loading: false, result: payload }))
    } catch (err) {
      setCompareState((prev) => ({ ...prev, loading: false }))
      showError(err.message || '版本对比失败')
    }
  }

  const onRunDraftCheck = async () => {
    const bidId = Number(selectedBid?.id || 0)
    if (!bidId || draftCheckState.busy) return
    resetFeedback()
    setDraftCheckState((prev) => ({ ...prev, busy: true }))
    try {
      const payload = await api.post(`/api/tender/bids/${bidId}/check`, {})
      const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : null
      const issues = Array.isArray(payload?.issues) ? payload.issues : []
      setDraftCheckState((prev) => ({
        ...prev,
        busy: false,
        run_id: Number(payload?.run_id || 0),
        source_job_id: Number(payload?.source_job_id || 0),
        summary,
        issues,
      }))
      const fatal = Number(summary?.fatal_count || 0)
      const warn = Number(summary?.warn_count || 0)
      showMessage(`成稿校验完成：致命问题 ${fatal} 条，告警 ${warn} 条`)
    } catch (err) {
      setDraftCheckState((prev) => ({ ...prev, busy: false }))
      showError(err.message || '成稿校验失败')
    }
  }

  const onRunScoreOptimize = async () => {
    const bidId = Number(selectedBid?.id || 0)
    if (!bidId || scoreOptimizeState.busy) return
    resetFeedback()
    setScoreOptimizeState((prev) => ({ ...prev, busy: true }))
    try {
      const payload = await api.post(`/api/tender/bids/${bidId}/score-optimize`, {})
      const matrix = Array.isArray(payload?.matrix) ? payload.matrix : []
      const items = Array.isArray(payload?.items) ? payload.items : []
      setScoreOptimizeState((prev) => ({
        ...prev,
        busy: false,
        source_job_id: Number(payload?.source_job_id || 0),
        matrix,
        items,
        prompt_preview: String(payload?.prompt_preview || ''),
      }))
      showMessage(`评分优化完成：生成 ${items.length} 条补强建议`)
    } catch (err) {
      setScoreOptimizeState((prev) => ({ ...prev, busy: false }))
      showError(err.message || '评分优化失败')
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
      } finally {
        fetchEditorEvents(bid.id, { silent: true }).catch(() => {})
      }
    }
  }

  const uploadQualificationAsset = async (options = {}) => {
    const current = options.dialog || qualificationDialog
    if (current.assetId) {
      const currentAsset = qualificationAssets.find((item) => Number(item.id) === Number(current.assetId))
      return { assetId: Number(current.assetId), fields: currentAsset?.fields_json || {} }
    }
    if (!current.file) throw new Error('请先上传资质证书文件')

    const form = new FormData()
    form.append('asset_type', 'QUALIFICATION')
    form.append('file', current.file)
    const result = await api.post('/api/tender/assets/upload', form)
    const assetId = Number(result?.asset?.id || 0)
    if (!assetId) throw new Error('上传成功但未返回文件ID')
    const fields = result?.ocr_result?.fields_json || {}

    setQualificationDialog((prev) => ({
      ...prev,
      assetId,
      fileName: firstNonEmpty(result?.asset?.original_file_name, prev.fileName),
      smartFilled: prev.smartFilled,
    }))
    return { assetId, fields, result }
  }

  const applyQualificationFieldsToDialog = (fields) => {
    const rawName = firstNonEmpty(fields?.title, fields?.name, fields?.qualification_name)
    const knownName = qualificationNameOptions.includes(rawName)
    const certificateNo = firstNonEmpty(fields?.certificate_no, fields?.number, fields?.no)
    const level = firstNonEmpty(fields?.level, fields?.rating, fields?.grade)
    const validFrom = normalizeDateToInput(firstNonEmpty(fields?.valid_from))
    const validToRaw = firstNonEmpty(fields?.valid_to)
    const validTo = normalizeDateToInput(validToRaw)
    const validLongTerm = Number(fields?.valid_long_term || 0) > 0 || String(validToRaw || '').includes('长期')

    setQualificationDialog((prev) => ({
      ...prev,
      nameMode: rawName ? (knownName ? 'select' : 'custom') : prev.nameMode,
      name: rawName && knownName ? rawName : prev.name,
      customName: rawName && !knownName ? rawName : prev.customName,
      certificateNo: certificateNo || prev.certificateNo,
      level: level || prev.level,
      validFrom: validFrom || prev.validFrom,
      validTo: validLongTerm ? '' : (validTo || prev.validTo),
      validLongTerm: validLongTerm || prev.validLongTerm,
      smartFilled: true,
    }))
  }

  const onSmartFillQualification = async () => {
    resetFeedback()
    setQualificationSmartFilling(true)
    try {
      const uploaded = await uploadQualificationAsset()
      applyQualificationFieldsToDialog(uploaded.fields || {})
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      showMessage('已识别并智能填充资质信息')
    } catch (err) {
      showError(err.message || '智能填充失败')
    } finally {
      setQualificationSmartFilling(false)
    }
  }

  const onSaveQualification = async () => {
    resetFeedback()
    setQualificationSaving(true)
    try {
      const certName = qualificationDialog.nameMode === 'custom'
        ? String(qualificationDialog.customName || '').trim()
        : String(qualificationDialog.name || '').trim()
      const certNo = String(qualificationDialog.certificateNo || '').trim()
      const certLevel = String(qualificationDialog.level || '').trim()
      const validFrom = String(qualificationDialog.validFrom || '').trim()
      const validTo = String(qualificationDialog.validTo || '').trim()
      if (!certName) throw new Error('请填写证书名称')
      if (!certNo) throw new Error('请填写证书编号')
      if (!certLevel) throw new Error('请选择证书评级')
      if (!validFrom) throw new Error('请填写生效日期')
      if (!qualificationDialog.validLongTerm && !validTo) throw new Error('请填写失效日期')
      if (!qualificationDialog.validLongTerm && validTo < validFrom) throw new Error('失效日期不能早于生效日期')

      const uploaded = await uploadQualificationAsset()
      const asset = qualificationAssets.find((item) => Number(item.id) === Number(uploaded.assetId))
      const existingFields = asset?.fields_json || uploaded.fields || {}
      const nextFields = {
        ...existingFields,
        doc_type: 'QUALIFICATION',
        title: certName,
        certificate_no: certNo,
        level: certLevel,
        valid_from: validFrom,
        valid_to: qualificationDialog.validLongTerm ? '长期' : validTo,
        valid_long_term: qualificationDialog.validLongTerm ? 1 : 0,
      }

      await api.post(`/api/tender/assets/${uploaded.assetId}/confirm`, {
        doc_type: 'QUALIFICATION',
        fields_json: nextFields,
        confidence: asset?.confidence || 95,
      })

      await fetchAssets()
      fetchBootstrap().catch(() => {})
      showMessage('资质保存成功')
      closeQualificationDialog()
    } catch (err) {
      showError(err.message || '资质保存失败')
    } finally {
      setQualificationSaving(false)
    }
  }

  const onDeleteQualification = async (assetId) => {
    if (!Number(assetId)) return
    if (!window.confirm('确认删除该资质文件吗？')) return
    resetFeedback()
    try {
      await api.del(`/api/tender/assets/${assetId}`)
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      showMessage('资质已删除')
      setQualificationSelectedIds((prev) => prev.filter((id) => Number(id) !== Number(assetId)))
    } catch (err) {
      showError(err.message || '删除失败')
    }
  }

  const onBatchDeleteQualifications = async () => {
    if (!qualificationSelectedIds.length) {
      showError('请先勾选要删除的资质')
      return
    }
    if (!window.confirm(`确认删除已选 ${qualificationSelectedIds.length} 条资质吗？`)) return
    resetFeedback()
    try {
      await Promise.all(qualificationSelectedIds.map((id) => api.del(`/api/tender/assets/${id}`)))
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      setQualificationSelectedIds([])
      showMessage('批量删除成功')
    } catch (err) {
      showError(err.message || '批量删除失败')
    }
  }

  const onToggleQualificationSelect = (id, checked) => {
    const target = Number(id)
    if (!target) return
    setQualificationSelectedIds((prev) => {
      const set = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) set.add(target)
      else set.delete(target)
      return Array.from(set)
    })
  }

  const onToggleQualificationSelectAll = (checked) => {
    if (!checked) {
      setQualificationSelectedIds([])
      return
    }
    setQualificationSelectedIds(qualificationRows.map((item) => Number(item.id)))
  }

  const onChangeQualificationPageSize = (nextSize) => {
    const parsed = Math.max(1, Number(nextSize) || 10)
    setQualificationPageSize(parsed)
    setQualificationPage(1)
  }

  const onJumpQualificationPage = () => {
    const page = Number(qualificationGotoPage || 1)
    if (!Number.isFinite(page) || page <= 0) {
      setQualificationGotoPage(String(normalizedQualificationPage))
      return
    }
    setQualificationPage(Math.min(Math.max(1, page), qualificationTotalPages))
  }

  const closeFinanceDialog = () => {
    setFinanceDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return createFinanceDialog()
    })
    setFinanceSaving(false)
    setFinanceFileInputKey((prev) => prev + 1)
  }

  const openCreateFinanceDialog = () => {
    resetFeedback()
    setFinanceDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return { ...createFinanceDialog(), open: true }
    })
    setFinanceFileInputKey((prev) => prev + 1)
  }

  const toFinanceDialogFromAsset = (asset) => {
    const fields = asset?.fields_json || {}
    return {
      ...createFinanceDialog(),
      open: true,
      assetId: Number(asset?.id) || null,
      fileName: firstNonEmpty(asset?.original_file_name),
      remotePreviewUrl: String(asset?.mime_type || '').startsWith('image/')
        ? `${API_BASE}/api/tender/assets/${asset.id}/preview`
        : '',
      infoType: firstNonEmpty(fields.info_type, fields.finance_type),
      infoName: firstNonEmpty(fields.info_name, fields.title),
      infoDate: normalizeDateToInput(firstNonEmpty(fields.info_date, fields.date)),
    }
  }

  const openEditFinanceDialog = (asset) => {
    resetFeedback()
    setFinanceDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return toFinanceDialogFromAsset(asset)
    })
    setFinanceFileInputKey((prev) => prev + 1)
  }

  const onPickFinanceFile = (file) => {
    setFinanceDialog((prev) => {
      safeRevokeUrl(prev.localPreviewUrl)
      return {
        ...prev,
        file: file || null,
        fileName: file?.name || '',
        localPreviewUrl: buildImagePreviewUrl(file),
        remotePreviewUrl: '',
        assetId: null,
      }
    })
  }

  const uploadFinanceAsset = async (options = {}) => {
    const current = options.dialog || financeDialog
    if (current.assetId) {
      const currentAsset = financeAssets.find((item) => Number(item.id) === Number(current.assetId))
      return { assetId: Number(current.assetId), fields: currentAsset?.fields_json || {} }
    }
    if (!current.file) throw new Error('请先上传信息照片')

    const form = new FormData()
    form.append('asset_type', 'OTHER')
    form.append('file', current.file)
    const result = await api.post('/api/tender/assets/upload', form)
    const assetId = Number(result?.asset?.id || 0)
    if (!assetId) throw new Error('上传成功但未返回文件ID')
    const fields = result?.ocr_result?.fields_json || {}

    setFinanceDialog((prev) => ({
      ...prev,
      assetId,
      fileName: firstNonEmpty(result?.asset?.original_file_name, prev.fileName),
    }))
    return { assetId, fields, result }
  }

  const onSaveFinance = async () => {
    resetFeedback()
    setFinanceSaving(true)
    try {
      const infoType = String(financeDialog.infoType || '').trim()
      const infoName = String(financeDialog.infoName || '').trim()
      const infoDate = String(financeDialog.infoDate || '').trim()
      if (!infoType) throw new Error('请选择信息类型')
      if (!infoDate) throw new Error('请选择信息时间')
      if (!infoName) throw new Error('请填写信息名称')

      const uploaded = await uploadFinanceAsset()
      const asset = financeAssets.find((item) => Number(item.id) === Number(uploaded.assetId))
      const existingFields = asset?.fields_json || uploaded.fields || {}
      const nextFields = {
        ...existingFields,
        doc_type: 'FINANCE_INFO',
        library_section: 'finance',
        info_type: infoType,
        info_name: infoName,
        info_date: infoDate,
      }

      await api.post(`/api/tender/assets/${uploaded.assetId}/confirm`, {
        doc_type: 'FINANCE_INFO',
        fields_json: nextFields,
        confidence: asset?.confidence || 95,
      })

      await fetchAssets()
      fetchBootstrap().catch(() => {})
      showMessage('财务信息保存成功')
      closeFinanceDialog()
    } catch (err) {
      showError(err.message || '财务信息保存失败')
    } finally {
      setFinanceSaving(false)
    }
  }

  const onDeleteFinance = async (assetId) => {
    if (!Number(assetId)) return
    if (!window.confirm('确认删除该财务信息吗？')) return
    resetFeedback()
    try {
      await api.del(`/api/tender/assets/${assetId}`)
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      setFinanceSelectedIds((prev) => prev.filter((id) => Number(id) !== Number(assetId)))
      showMessage('财务信息已删除')
    } catch (err) {
      showError(err.message || '删除失败')
    }
  }

  const onBatchDeleteFinance = async () => {
    if (!financeSelectedIds.length) {
      showError('请先勾选要删除的财务信息')
      return
    }
    if (!window.confirm(`确认删除已选 ${financeSelectedIds.length} 条财务信息吗？`)) return
    resetFeedback()
    try {
      await Promise.all(financeSelectedIds.map((id) => api.del(`/api/tender/assets/${id}`)))
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      setFinanceSelectedIds([])
      showMessage('批量删除成功')
    } catch (err) {
      showError(err.message || '批量删除失败')
    }
  }

  const onToggleFinanceSelect = (id, checked) => {
    const target = Number(id)
    if (!target) return
    setFinanceSelectedIds((prev) => {
      const set = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) set.add(target)
      else set.delete(target)
      return Array.from(set)
    })
  }

  const onToggleFinanceSelectAll = (checked) => {
    if (!checked) {
      setFinanceSelectedIds([])
      return
    }
    setFinanceSelectedIds(financeRows.map((item) => Number(item.id)))
  }

  const onChangeFinancePageSize = (nextSize) => {
    const parsed = Math.max(1, Number(nextSize) || 10)
    setFinancePageSize(parsed)
    setFinancePage(1)
  }

  const onJumpFinancePage = () => {
    const page = Number(financeGotoPage || 1)
    if (!Number.isFinite(page) || page <= 0) {
      setFinanceGotoPage(String(normalizedFinancePage))
      return
    }
    setFinancePage(Math.min(Math.max(1, page), financeTotalPages))
  }

  const closePerformanceDialog = () => {
    setPerformanceDialog(() => createPerformanceDialog())
    setPerformanceSaving(false)
  }

  const openCreatePerformanceDialog = () => {
    resetFeedback()
    setPerformanceDialog(() => ({ ...createPerformanceDialog(), open: true }))
  }

  const openEditPerformanceDialog = (item) => {
    resetFeedback()
    setPerformanceDialog({
      ...createPerformanceDialog(),
      open: true,
      itemId: Number(item?.id) || null,
      project_name: firstNonEmpty(item?.project_name),
      project_no: firstNonEmpty(item?.project_no),
      project_type: firstNonEmpty(item?.project_type),
      package_no: firstNonEmpty(item?.package_no, '第一包'),
      party_a_name: firstNonEmpty(item?.party_a_name),
      party_a_type: firstNonEmpty(item?.party_a_type),
      project_amount: firstNonEmpty(item?.project_amount),
      project_leader: firstNonEmpty(item?.project_leader),
      contact_phone: firstNonEmpty(item?.contact_phone),
      contract_valid_from: normalizeDateToInput(firstNonEmpty(item?.contract_valid_from)),
      contract_valid_to: normalizeDateToInput(firstNonEmpty(item?.contract_valid_to)),
      project_content: firstNonEmpty(item?.project_content),
      remark: firstNonEmpty(item?.remark),
    })
  }

  const onSavePerformance = async () => {
    resetFeedback()
    setPerformanceSaving(true)
    try {
      const projectName = String(performanceDialog.project_name || '').trim()
      const projectType = String(performanceDialog.project_type || '').trim()
      const partyAName = String(performanceDialog.party_a_name || '').trim()
      const partyAType = String(performanceDialog.party_a_type || '').trim()
      const projectAmount = String(performanceDialog.project_amount || '').trim()
      const validFrom = String(performanceDialog.contract_valid_from || '').trim()
      const validTo = String(performanceDialog.contract_valid_to || '').trim()
      const projectContent = String(performanceDialog.project_content || '').trim()
      if (!projectName) throw new Error('请填写项目名称')
      if (!projectType) throw new Error('请选择项目类型')
      if (!partyAName) throw new Error('请填写甲方名称')
      if (!partyAType) throw new Error('请选择甲方类型')
      if (!projectAmount) throw new Error('请填写项目金额')
      if (!validFrom || !validTo) throw new Error('请填写合同有效期')
      if (validTo < validFrom) throw new Error('合同失效日期不能早于生效日期')
      if (!projectContent) throw new Error('请填写项目内容')

      const nowIso = new Date().toISOString()
      const payload = {
        id: performanceDialog.itemId || Date.now(),
        project_name: projectName,
        project_no: String(performanceDialog.project_no || '').trim(),
        project_type: projectType,
        package_no: String(performanceDialog.package_no || '').trim() || '第一包',
        party_a_name: partyAName,
        party_a_type: partyAType,
        project_amount: projectAmount,
        project_leader: String(performanceDialog.project_leader || '').trim(),
        contact_phone: String(performanceDialog.contact_phone || '').trim(),
        contract_valid_from: validFrom,
        contract_valid_to: validTo,
        project_content: projectContent,
        remark: String(performanceDialog.remark || '').trim(),
        created_at: nowIso,
        updated_at: nowIso,
      }

      setPerformanceEntries((prev) => {
        const exists = prev.some((item) => Number(item.id) === Number(payload.id))
        if (!exists) return [payload, ...prev]
        return prev.map((item) =>
          Number(item.id) === Number(payload.id)
            ? { ...item, ...payload, created_at: item.created_at || payload.created_at, updated_at: nowIso }
            : item
        )
      })

      showMessage('业绩信息保存成功')
      closePerformanceDialog()
    } catch (err) {
      showError(err.message || '业绩信息保存失败')
    } finally {
      setPerformanceSaving(false)
    }
  }

  const onDeletePerformance = (id) => {
    const targetId = Number(id)
    if (!targetId) return
    if (!window.confirm('确认删除该业绩信息吗？')) return
    resetFeedback()
    setPerformanceEntries((prev) => prev.filter((item) => Number(item.id) !== targetId))
    setPerformanceSelectedIds((prev) => prev.filter((item) => Number(item) !== targetId))
    showMessage('业绩信息已删除')
  }

  const onBatchDeletePerformance = () => {
    if (!performanceSelectedIds.length) {
      showError('请先勾选要删除的业绩信息')
      return
    }
    if (!window.confirm(`确认删除已选 ${performanceSelectedIds.length} 条业绩信息吗？`)) return
    const selectedSet = new Set(performanceSelectedIds.map((id) => Number(id)))
    resetFeedback()
    setPerformanceEntries((prev) => prev.filter((item) => !selectedSet.has(Number(item.id))))
    setPerformanceSelectedIds([])
    showMessage('批量删除成功')
  }

  const onTogglePerformanceSelect = (id, checked) => {
    const target = Number(id)
    if (!target) return
    setPerformanceSelectedIds((prev) => {
      const set = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) set.add(target)
      else set.delete(target)
      return Array.from(set)
    })
  }

  const onTogglePerformanceSelectAll = (checked) => {
    if (!checked) {
      setPerformanceSelectedIds([])
      return
    }
    setPerformanceSelectedIds(performanceRows.map((item) => Number(item.id)))
  }

  const onChangePerformancePageSize = (nextSize) => {
    const parsed = Math.max(1, Number(nextSize) || 8)
    setPerformancePageSize(parsed)
    setPerformancePage(1)
  }

  const onJumpPerformancePage = () => {
    const page = Number(performanceGotoPage || 1)
    if (!Number.isFinite(page) || page <= 0) {
      setPerformanceGotoPage(String(normalizedPerformancePage))
      return
    }
    setPerformancePage(Math.min(Math.max(1, page), performanceTotalPages))
  }

  const closeStaffDialog = () => {
    setStaffDialog((prev) => {
      revokeStaffDialogPreviewUrls(prev)
      return createStaffDialog()
    })
    setStaffSaving(false)
    setStaffSmartFilling(false)
  }

  const openCreateStaffDialog = () => {
    resetFeedback()
    setStaffDialog((prev) => {
      revokeStaffDialogPreviewUrls(prev)
      return { ...createStaffDialog(), open: true }
    })
  }

  const openEditStaffDialog = (item) => {
    resetFeedback()
    setStaffDialog((prev) => {
      revokeStaffDialogPreviewUrls(prev)
      const attachments = item?.attachments || {}
      return {
        ...createStaffDialog(),
        open: true,
        itemId: Number(item?.id) || null,
        name: firstNonEmpty(item?.name),
        gender: firstNonEmpty(item?.gender),
        birth_date: normalizeDateToInput(firstNonEmpty(item?.birth_date)),
        id_no: normalizeIdNo(firstNonEmpty(item?.id_no)),
        id_valid_from: normalizeDateToInput(firstNonEmpty(item?.id_valid_from)),
        id_valid_to: normalizeDateToInput(firstNonEmpty(item?.id_valid_to)),
        id_long_term: Number(item?.id_long_term || 0) > 0,
        education: firstNonEmpty(item?.education),
        major: firstNonEmpty(item?.major),
        job_title: firstNonEmpty(item?.job_title),
        position: firstNonEmpty(item?.position),
        contact_phone: firstNonEmpty(item?.contact_phone),
        status: firstNonEmpty(item?.status, '在职'),
        start_work_date: normalizeDateToInput(firstNonEmpty(item?.start_work_date)),
        qualification_cert: firstNonEmpty(item?.qualification_cert),
        id_card: normalizeStaffAttachment(attachments.id_card),
        education_cert: normalizeStaffAttachment(attachments.education_cert),
        contract: normalizeStaffAttachment(attachments.contract),
        driver_license: normalizeStaffAttachment(attachments.driver_license),
        social_security: normalizeStaffAttachment(attachments.social_security),
      }
    })
  }

  const onPickStaffAttachment = (key, file) => {
    if (!staffAttachmentKeys.includes(key)) return
    setStaffDialog((prev) => {
      const current = prev[key] || createStaffAttachment()
      safeRevokeUrl(current.previewUrl)
      return {
        ...prev,
        [key]: {
          ...createStaffAttachment(),
          file: file || null,
          fileName: file?.name || '',
          previewUrl: buildImagePreviewUrl(file),
          mimeType: String(file?.type || '').toLowerCase(),
        },
      }
    })
  }

  const onDeleteStaffAttachment = async (key) => {
    if (!staffAttachmentKeys.includes(key)) return
    const target = staffDialog[key] || createStaffAttachment()
    if (!target.file && !target.assetId && !target.previewUrl) return
    resetFeedback()
    try {
      const assetId = Number(target.assetId || 0)
      if (assetId > 0) {
        await api.del(`/api/tender/assets/${assetId}`)
        await fetchAssets()
        fetchBootstrap().catch(() => {})
      }
      setStaffDialog((prev) => {
        const current = prev[key] || createStaffAttachment()
        safeRevokeUrl(current.previewUrl)
        return {
          ...prev,
          [key]: createStaffAttachment(),
        }
      })
      showMessage('文件已删除')
    } catch (err) {
      showError(err.message || '删除文件失败')
    }
  }

  const resolveStaffAssetType = (key) => {
    if (key === 'id_card') return 'ID_CARD'
    if (key === 'education_cert') return 'EDUCATION_CERT'
    if (key === 'contract') return 'CONTRACT'
    return 'OTHER'
  }

  const uploadStaffAttachment = async (key, options = {}) => {
    if (!staffAttachmentKeys.includes(key)) return createStaffAttachment()
    const currentDialog = options.dialog || staffDialog
    const current = currentDialog[key] || createStaffAttachment()
    const hasRemote = Number(current.assetId || 0) > 0 && !current.file
    if (hasRemote) return current
    if (!current.file) return current

    const form = new FormData()
    form.append('asset_type', resolveStaffAssetType(key))
    form.append('file', current.file)
    const result = await api.post('/api/tender/assets/upload', form)
    const assetId = Number(result?.asset?.id || 0)
    if (!assetId) throw new Error('上传成功但未返回文件ID')
    const mimeType = firstNonEmpty(result?.asset?.mime_type, current.mimeType).toLowerCase()
    const nextAttachment = {
      ...current,
      file: null,
      assetId,
      fileName: firstNonEmpty(result?.asset?.original_file_name, current.fileName),
      mimeType,
      previewUrl: current.previewUrl || buildAssetPreviewUrl(assetId, mimeType),
      ocrFields: result?.ocr_result?.fields_json || current.ocrFields,
      ocrStatus: firstNonEmpty(result?.ocr_result?.status).toUpperCase(),
      ocrError: firstNonEmpty(result?.ocr_result?.ocr_error),
    }
    setStaffDialog((prev) => ({ ...prev, [key]: nextAttachment }))
    return nextAttachment
  }

  const applyStaffIdCardFieldsToDialog = (fields) => {
    const name = firstNonEmpty(fields?.name, fields?.subject)
    const idNo = normalizeIdNo(firstNonEmpty(fields?.id_no, fields?.certificate_no))
    const gender = firstNonEmpty(fields?.gender) || deriveGenderFromIdNo(idNo)
    const birthDate = normalizeDateToInput(firstNonEmpty(fields?.birth_date)) || deriveBirthDateFromIdNo(idNo)
    const validFrom = normalizeDateToInput(firstNonEmpty(fields?.valid_from))
    const validToRaw = firstNonEmpty(fields?.valid_to)
    const validTo = normalizeDateToInput(validToRaw)
    const validLongTerm = Number(fields?.valid_long_term || 0) > 0 || String(validToRaw).includes('长期')

    setStaffDialog((prev) => ({
      ...prev,
      name: name || prev.name,
      id_no: idNo || prev.id_no,
      gender: gender || prev.gender,
      birth_date: birthDate || prev.birth_date,
      id_valid_from: validFrom || prev.id_valid_from,
      id_valid_to: validLongTerm ? '' : (validTo || prev.id_valid_to),
      id_long_term: validLongTerm || prev.id_long_term,
    }))
  }

  const onSmartFillStaff = async () => {
    resetFeedback()
    setStaffSmartFilling(true)
    try {
      const current = staffDialog.id_card || createStaffAttachment()
      if (!current.file && !current.assetId) throw new Error('请先上传身份证，再执行智能填充')
      const uploaded = await uploadStaffAttachment('id_card')
      const fields = uploaded.ocrFields || {}
      const hasAnyField = Object.values(fields).some((value) => String(value ?? '').trim() !== '')
      if (!hasAnyField) {
        const reason = uploaded.ocrError || '未识别到可用字段'
        throw new Error(`身份证识别失败：${reason}`)
      }
      applyStaffIdCardFieldsToDialog(fields)
      await fetchAssets()
      fetchBootstrap().catch(() => {})
      showMessage('已根据身份证识别结果填充人员信息')
    } catch (err) {
      showError(err.message || '智能填充失败')
    } finally {
      setStaffSmartFilling(false)
    }
  }

  const onSaveStaff = async () => {
    resetFeedback()
    setStaffSaving(true)
    try {
      const name = String(staffDialog.name || '').trim()
      const gender = String(staffDialog.gender || '').trim()
      const birthDate = String(staffDialog.birth_date || '').trim()
      const idNo = normalizeIdNo(staffDialog.id_no)
      const idValidFrom = String(staffDialog.id_valid_from || '').trim()
      const idValidTo = String(staffDialog.id_valid_to || '').trim()
      if (!name) throw new Error('请填写姓名')
      if (!gender) throw new Error('请选择性别')
      if (!birthDate) throw new Error('请选择生日')
      if (!idNo) throw new Error('请填写身份证号')
      if (!idValidFrom) throw new Error('请选择身份证有效期开始日期')
      if (!staffDialog.id_long_term && !idValidTo) throw new Error('请选择身份证有效期结束日期')
      if (!staffDialog.id_long_term && idValidTo < idValidFrom) throw new Error('身份证结束日期不能早于开始日期')

      const uploadedAttachments = {}
      for (const key of staffAttachmentKeys) {
        const uploaded = await uploadStaffAttachment(key)
        uploadedAttachments[key] = uploaded
      }

      if (!uploadedAttachments.id_card?.assetId) {
        throw new Error('请上传身份证文件')
      }

      const nowIso = new Date().toISOString()
      const payload = {
        id: staffDialog.itemId || Date.now(),
        name,
        gender,
        birth_date: birthDate,
        id_no: idNo,
        id_valid_from: idValidFrom,
        id_valid_to: staffDialog.id_long_term ? '' : idValidTo,
        id_long_term: staffDialog.id_long_term ? 1 : 0,
        education: String(staffDialog.education || '').trim(),
        major: String(staffDialog.major || '').trim(),
        job_title: String(staffDialog.job_title || '').trim(),
        position: String(staffDialog.position || '').trim(),
        contact_phone: String(staffDialog.contact_phone || '').trim(),
        status: String(staffDialog.status || '').trim() || '在职',
        start_work_date: String(staffDialog.start_work_date || '').trim(),
        qualification_cert: String(staffDialog.qualification_cert || '').trim(),
        attachments: {
          id_card: uploadedAttachments.id_card,
          education_cert: uploadedAttachments.education_cert,
          contract: uploadedAttachments.contract,
          driver_license: uploadedAttachments.driver_license,
          social_security: uploadedAttachments.social_security,
        },
        created_at: nowIso,
        updated_at: nowIso,
      }

      setStaffEntries((prev) => {
        const exists = prev.some((item) => Number(item.id) === Number(payload.id))
        if (!exists) return [payload, ...prev]
        return prev.map((item) =>
          Number(item.id) === Number(payload.id)
            ? { ...item, ...payload, created_at: item.created_at || payload.created_at, updated_at: nowIso }
            : item
        )
      })

      await fetchAssets()
      fetchBootstrap().catch(() => {})
      showMessage('人员信息保存成功')
      closeStaffDialog()
    } catch (err) {
      showError(err.message || '人员信息保存失败')
    } finally {
      setStaffSaving(false)
    }
  }

  const onDeleteStaff = async (id) => {
    const targetId = Number(id)
    if (!targetId) return
    if (!window.confirm('确认删除该人员信息吗？')) return
    resetFeedback()
    const target = staffEntries.find((item) => Number(item.id) === targetId)
    try {
      const attachments = target?.attachments || {}
      const assetIds = staffAttachmentKeys
        .map((key) => Number(attachments[key]?.assetId || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
      if (assetIds.length) {
        await Promise.allSettled(assetIds.map((assetId) => api.del(`/api/tender/assets/${assetId}`)))
      }
      setStaffEntries((prev) => prev.filter((item) => Number(item.id) !== targetId))
      setStaffSelectedIds((prev) => prev.filter((item) => Number(item) !== targetId))
      fetchAssets().catch(() => {})
      fetchBootstrap().catch(() => {})
      showMessage('人员信息已删除')
    } catch (err) {
      showError(err.message || '删除失败')
    }
  }

  const onBatchDeleteStaff = async () => {
    if (!staffSelectedIds.length) {
      showError('请先勾选要删除的人员信息')
      return
    }
    if (!window.confirm(`确认删除已选 ${staffSelectedIds.length} 条人员信息吗？`)) return
    resetFeedback()
    try {
      const selectedSet = new Set(staffSelectedIds.map((id) => Number(id)))
      const deletingEntries = staffEntries.filter((item) => selectedSet.has(Number(item.id)))
      const assetIds = deletingEntries.flatMap((item) =>
        staffAttachmentKeys
          .map((key) => Number(item?.attachments?.[key]?.assetId || 0))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
      if (assetIds.length) {
        await Promise.allSettled(assetIds.map((assetId) => api.del(`/api/tender/assets/${assetId}`)))
      }
      setStaffEntries((prev) => prev.filter((item) => !selectedSet.has(Number(item.id))))
      setStaffSelectedIds([])
      fetchAssets().catch(() => {})
      fetchBootstrap().catch(() => {})
      showMessage('批量删除成功')
    } catch (err) {
      showError(err.message || '批量删除失败')
    }
  }

  const onToggleStaffSelect = (id, checked) => {
    const target = Number(id)
    if (!target) return
    setStaffSelectedIds((prev) => {
      const set = new Set(prev.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))
      if (checked) set.add(target)
      else set.delete(target)
      return Array.from(set)
    })
  }

  const onToggleStaffSelectAll = (checked) => {
    if (!checked) {
      setStaffSelectedIds([])
      return
    }
    setStaffSelectedIds(staffRows.map((item) => Number(item.id)))
  }

  const onChangeStaffPageSize = (nextSize) => {
    const parsed = Math.max(1, Number(nextSize) || 10)
    setStaffPageSize(parsed)
    setStaffPage(1)
  }

  const onJumpStaffPage = () => {
    const page = Number(staffGotoPage || 1)
    if (!Number.isFinite(page) || page <= 0) {
      setStaffGotoPage(String(normalizedStaffPage))
      return
    }
    setStaffPage(Math.min(Math.max(1, page), staffTotalPages))
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

  const onTestCreateModel = async () => {
    resetFeedback()
    setModelCreateTestFeedback({ type: '', text: '' })
    try {
      const payload = normalizeAiModelPayload(modelForm, { requireApiKey: true })
      setModelCreateTesting(true)
      const result = await api.post('/api/tender/ai/models/test', payload)
      const text = `模型连接测试通过（耗时 ${Number(result?.latency_ms || 0)}ms）`
      setModelCreateTestFeedback({ type: 'success', text })
      showMessage(text)
    } catch (err) {
      const text = `模型连接测试失败：${err.message || '未知错误'}`
      setModelCreateTestFeedback({ type: 'error', text })
      showError(err.message)
    } finally {
      setModelCreateTesting(false)
    }
  }

  const onCreateCustomModel = async () => {
    resetFeedback()
    try {
      const payload = normalizeAiModelPayload(modelForm, { requireApiKey: true })
      setModelCreateSaving(true)
      await api.post('/api/tender/ai/models', payload)
      setModelForm(createAiModelForm())
      await fetchModels()
      showMessage('自定义模型已新增')
      fetchBootstrap().catch(() => {})
    } catch (err) {
      showError(err.message)
    } finally {
      setModelCreateSaving(false)
    }
  }

  const onTestSavedModel = async (id) => {
    const modelId = Number(id || 0)
    if (!modelId) return
    resetFeedback()
    setModelRowTesting((prev) => ({ ...prev, [modelId]: true }))
    setModelRowTestFeedback((prev) => ({ ...prev, [modelId]: { type: '', text: '' } }))
    try {
      const result = await api.post(`/api/tender/ai/models/${modelId}/test`, {})
      const text = `模型连接测试通过（耗时 ${Number(result?.latency_ms || 0)}ms）`
      setModelRowTestFeedback((prev) => ({ ...prev, [modelId]: { type: 'success', text } }))
      showMessage(text)
    } catch (err) {
      const text = `模型连接测试失败：${err.message || '未知错误'}`
      setModelRowTestFeedback((prev) => ({ ...prev, [modelId]: { type: 'error', text } }))
      showError(err.message)
    } finally {
      setModelRowTesting((prev) => ({ ...prev, [modelId]: false }))
    }
  }

  const openModelEditDialog = (item) => {
    setModelEditTestFeedback({ type: '', text: '' })
    setModelEditDialog({
      open: true,
      targetId: Number(item?.id || 0),
      form: buildAiModelFormFromRow(item),
    })
  }

  const closeModelEditDialog = () => {
    setModelEditDialog({
      open: false,
      targetId: null,
      form: createAiModelForm(),
    })
    setModelEditTestFeedback({ type: '', text: '' })
    setModelEditTesting(false)
    setModelEditSaving(false)
  }

  const onTestEditModel = async () => {
    const modelId = Number(modelEditDialog.targetId || 0)
    if (!modelId) return
    resetFeedback()
    setModelEditTestFeedback({ type: '', text: '' })
    try {
      const payload = normalizeAiModelPayload(modelEditDialog.form, { requireApiKey: false })
      setModelEditTesting(true)
      const result = await api.post(`/api/tender/ai/models/${modelId}/test`, payload)
      const text = `编辑配置测试通过（耗时 ${Number(result?.latency_ms || 0)}ms）`
      setModelEditTestFeedback({ type: 'success', text })
      showMessage(text)
    } catch (err) {
      const text = `编辑配置测试失败：${err.message || '未知错误'}`
      setModelEditTestFeedback({ type: 'error', text })
      showError(err.message)
    } finally {
      setModelEditTesting(false)
    }
  }

  const onSaveEditModel = async () => {
    const modelId = Number(modelEditDialog.targetId || 0)
    if (!modelId) return
    resetFeedback()
    try {
      const payload = normalizeAiModelPayload(modelEditDialog.form, { requireApiKey: false })
      setModelEditSaving(true)
      await api.put(`/api/tender/ai/models/${modelId}`, payload)
      await fetchModels()
      showMessage('模型配置已更新')
      closeModelEditDialog()
      fetchBootstrap().catch(() => {})
    } catch (err) {
      showError(err.message)
    } finally {
      setModelEditSaving(false)
    }
  }

  const onDeleteModel = async (id) => {
    const modelId = Number(id || 0)
    if (!modelId) return
    resetFeedback()
    try {
      if (!window.confirm('确认删除该模型吗？')) return
      await api.del(`/api/tender/ai/models/${modelId}`)
      await fetchModels()
      showMessage('模型已删除')
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

  const onUploadDocTemplate = async () => {
    resetFeedback()
    try {
      if (!docTemplateUploadFile) throw new Error('请先选择模板文件（docx）')
      setDocTemplateUploadBusy(true)
      const form = new FormData()
      form.append('file', docTemplateUploadFile)
      form.append('template_name', docTemplateUploadName || docTemplateUploadFile.name.replace(/\.[^.]+$/, ''))
      form.append('is_default', docTemplateSetDefault ? '1' : '0')
      await api.post('/api/tender/doc-templates/upload', form)
      setDocTemplateUploadFile(null)
      setDocTemplateUploadName('')
      setDocTemplateSetDefault(false)
      setDocTemplateInputKey((prev) => prev + 1)
      await fetchDocTemplates()
      showMessage('投标模板上传成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setDocTemplateUploadBusy(false)
    }
  }

  const onSetDefaultDocTemplate = async (id) => {
    resetFeedback()
    try {
      await api.put(`/api/tender/doc-templates/${id}`, { is_default: true, status: 'ACTIVE' })
      await fetchDocTemplates()
      showMessage('默认投标模板已更新')
    } catch (err) {
      showError(err.message)
    }
  }

  const onDeleteDocTemplate = async (id) => {
    resetFeedback()
    try {
      if (!window.confirm('确认删除该投标模板吗？')) return
      await api.del(`/api/tender/doc-templates/${id}`)
      await fetchDocTemplates()
      showMessage('投标模板已删除')
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

  const wizardScoringItems = Array.isArray(generateWizard.analysis?.scoring_items)
    ? generateWizard.analysis.scoring_items
    : []
  const wizardRiskItems = Array.isArray(generateWizard.analysis?.risk_items)
    ? generateWizard.analysis.risk_items
    : []
  const wizardSectionSummaries = Array.isArray(generateWizard.analysis?.section_summaries)
    ? generateWizard.analysis.section_summaries
    : []
  const wizardTableSummaries = Array.isArray(generateWizard.analysis?.table_summaries)
    ? generateWizard.analysis.table_summaries
    : []
  const wizardMatches = Array.isArray(generateWizard.analysis?.matches)
    ? generateWizard.analysis.matches
    : []
  const wizardGeneratedArtifacts = generateWizard.analysis?.generated_artifacts && typeof generateWizard.analysis.generated_artifacts === 'object'
    ? generateWizard.analysis.generated_artifacts
    : {}
  const wizardScoreTableExtract = generateWizard.analysis?.stage_outputs?.score_table_extract
    && typeof generateWizard.analysis.stage_outputs.score_table_extract === 'object'
    ? generateWizard.analysis.stage_outputs.score_table_extract
    : {}
  const wizardHasScoreTable = wizardTableSummaries.some((item) => (
    String(item?.section_key || '').toUpperCase() === 'SCORE_TABLE'
    || String(item?.table_type || '').toUpperCase() === 'SCORE_TABLE'
  ))
  const wizardScoreTableMergedCount = Number(wizardScoreTableExtract?.merged_count || 0)
  const wizardScoreTableBlocked = wizardHasScoreTable && wizardScoreTableMergedCount <= 0
  const wizardScoreTableBlockedMessage = '检测到评分表但未逐条提取到评分项，请先修正解析结果后再生成投标初稿'
  const wizardRiskChecklist = Array.isArray(wizardGeneratedArtifacts.bid_risk_list)
    ? wizardGeneratedArtifacts.bid_risk_list
    : []
  const wizardScoreStrategy = wizardGeneratedArtifacts.score_strategy && typeof wizardGeneratedArtifacts.score_strategy === 'object'
    ? wizardGeneratedArtifacts.score_strategy
    : {}
  const wizardAutoToc = Array.isArray(wizardGeneratedArtifacts.auto_toc)
    ? wizardGeneratedArtifacts.auto_toc
    : []
  const wizardServiceOutline = Array.isArray(wizardGeneratedArtifacts.service_scheme_outline)
    ? wizardGeneratedArtifacts.service_scheme_outline
    : []
  const wizardTechDeviationRows = Array.isArray(wizardGeneratedArtifacts?.deviation_tables?.technical)
    ? wizardGeneratedArtifacts.deviation_tables.technical
    : []
  const wizardBizDeviationRows = Array.isArray(wizardGeneratedArtifacts?.deviation_tables?.business)
    ? wizardGeneratedArtifacts.deviation_tables.business
    : []
  const wizardSelectedSampleSet = new Set(
    (Array.isArray(generateWizard.selected_sample_ids) ? generateWizard.selected_sample_ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )
  const wizardHasAnalyzeResult = !!generateWizard.analysis?.job?.id
  const wizardCanCreateDraft = wizardHasAnalyzeResult && generateWizard.step >= 2 && !wizardScoreTableBlocked
  const wizardBidCategoryKey = String(
    generateWizard.analysis?.job?.bid_category || generateWizard.upload?.bid_category || ''
  ).toUpperCase()
  const wizardBidCategoryText = bidCategoryLabel(
    generateWizard.analysis?.job?.bid_category || generateWizard.upload?.bid_category
  )
  const wizardAnalyzeExpectedSeconds = (() => {
    const fileSizeBytes = Number(generateWizard.upload?.bidding_file?.size || 0)
    const fileSizeMb = fileSizeBytes > 0 ? fileSizeBytes / (1024 * 1024) : 0
    const base = 55
    const growth = Math.min(90, Math.round(fileSizeMb * 8))
    return base + growth
  })()
  const wizardAnalyzeRuntimeMeta = buildGenerateAnalyzeRuntimeMeta(
    generateAnalyzeRuntime.elapsedSeconds,
    wizardAnalyzeExpectedSeconds,
  )
  const wizardAnalyzeExpectedText = `通常需要 40~${wizardAnalyzeExpectedSeconds} 秒，长文档可能更久`
  const wizardAnalyzeElapsedText = formatElapsedDuration(generateAnalyzeRuntime.elapsedSeconds)
  const wizardFinalJson = generateWizard.analysis?.final_json && typeof generateWizard.analysis.final_json === 'object'
    ? generateWizard.analysis.final_json
    : {}
  const wizardInstructionForm = {
    ...createGenerateInstructionForm(),
    ...(generateWizard.instruction_form && typeof generateWizard.instruction_form === 'object'
      ? generateWizard.instruction_form
      : {}),
  }
  const wizardInstructionFilledCount = Object.values(wizardInstructionForm)
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .length
  const wizardBusinessRequirements = (() => {
    const rules = wizardFinalJson.business_performance_rules && typeof wizardFinalJson.business_performance_rules === 'object'
      ? wizardFinalJson.business_performance_rules
      : {}
    const bidRules = wizardFinalJson.bid_document_production_rules && typeof wizardFinalJson.bid_document_production_rules === 'object'
      ? wizardFinalJson.bid_document_production_rules
      : {}
    const rows = []
    const push = (label, value) => {
      toMeaningfulList(value).forEach((content) => rows.push({ label, content }))
    }
    push('付款方式要求', rules.payment_terms)
    push('履约保证要求', rules.performance_bond_rules)
    push('知识产权与保密', rules.intellectual_property_rules)
    push('违约责任与扣款', rules.liability_for_breach_of_contract)
    push('续约规则', rules.renewal_rules)
    push('其他商务条款', rules.other_business_rules)
    push('报价填写规则', bidRules.quotation_sheet_rules)
    push('签章要求', bidRules.signature_seal_rules)
    push('密封要求', bidRules.sealing_rules)
    return rows
  })()
  const wizardTechnicalRequirements = (() => {
    const rows = []
    const push = (label, value) => {
      toMeaningfulList(value).forEach((content) => rows.push({ label, content }))
    }
    const bidCategory = wizardBidCategoryKey === 'PRODUCT' ? 'PRODUCT' : 'SERVICE'
    if (bidCategory === 'PRODUCT') {
      const detail = wizardFinalJson.goods_procurement_detail && typeof wizardFinalJson.goods_procurement_detail === 'object'
        ? wizardFinalJson.goods_procurement_detail
        : {}
      push('交付周期', detail.delivery_period)
      push('交付地点', detail.delivery_place)
      const pushParamRows = (label, list = []) => {
        list.forEach((item, idx) => {
          const name = firstNonEmpty(toMeaningfulText(item?.param_name), `参数${idx + 1}`)
          const requirement = toMeaningfulText(item?.param_requirement)
          if (!requirement) return
          const mandatory = toMeaningfulText(item?.is_mandatory)
          const invalid = toMeaningfulText(item?.negative_deviation_invalid)
          const suffix = [mandatory ? `实质性：${mandatory}` : '', invalid ? `负偏离废标：${invalid}` : '']
            .filter(Boolean)
            .join('；')
          rows.push({
            label: `${label} · ${name}`,
            content: suffix ? `${requirement}（${suffix}）` : requirement,
          })
        })
      }
      pushParamRows('核心参数', Array.isArray(detail.core_mandatory_parameters) ? detail.core_mandatory_parameters : [])
      pushParamRows('一般参数', Array.isArray(detail.general_parameters) ? detail.general_parameters : [])
      push('实施要求', detail.implementation_requirements)
      push('验收要求', detail.acceptance_requirements)
      push('售后要求', detail.after_sales_requirements)
      push('认证要求', detail.certification_requirements)
    } else {
      const detail = wizardFinalJson.service_procurement_detail && typeof wizardFinalJson.service_procurement_detail === 'object'
        ? wizardFinalJson.service_procurement_detail
        : {}
      push('服务期限', detail.service_period)
      push('服务地点', detail.service_place)
      push('驻场要求', detail.resident_requirement)
      const serviceList = Array.isArray(detail.service_content_list) ? detail.service_content_list : []
      serviceList.forEach((item, idx) => {
        const name = firstNonEmpty(toMeaningfulText(item?.service_item_name), `服务项${idx + 1}`)
        const scope = toMeaningfulText(item?.service_scope)
        const delivery = toMeaningfulText(item?.delivery_content)
        if (scope) rows.push({ label: `${name} · 服务范围`, content: scope })
        if (delivery) rows.push({ label: `${name} · 交付内容`, content: delivery })
      })
      const slaList = Array.isArray(detail.core_sla_indicators) ? detail.core_sla_indicators : []
      slaList.forEach((item, idx) => {
        const name = firstNonEmpty(toMeaningfulText(item?.indicator_name), `SLA指标${idx + 1}`)
        const requirement = toMeaningfulText(item?.indicator_requirement)
        if (!requirement) return
        const mandatory = toMeaningfulText(item?.is_mandatory)
        const invalid = toMeaningfulText(item?.negative_deviation_invalid)
        const suffix = [mandatory ? `实质性：${mandatory}` : '', invalid ? `负偏离废标：${invalid}` : '']
          .filter(Boolean)
          .join('；')
        rows.push({
          label: `${name}`,
          content: suffix ? `${requirement}（${suffix}）` : requirement,
        })
      })
      push('实施流程要求', detail.service_implementation_requirements)
      push('质量保障要求', detail.quality_assurance_requirements)
      push('应急响应要求', detail.emergency_response_requirements)
      push('培训要求', detail.training_requirements)
      push('其他服务要求', detail.other_service_requirements)
    }
    return rows
  })()
  const wizardQualificationSections = (() => {
    const qualification = wizardFinalJson.bidder_qualification_requirements && typeof wizardFinalJson.bidder_qualification_requirements === 'object'
      ? wizardFinalJson.bidder_qualification_requirements
      : {}
    const invalid = wizardFinalJson.invalid_bid_full_clauses && typeof wizardFinalJson.invalid_bid_full_clauses === 'object'
      ? wizardFinalJson.invalid_bid_full_clauses
      : {}
    const qualificationRows = []
    const pushQualification = (label, list) => {
      toMeaningfulList(list).forEach((text) => {
        qualificationRows.push({
          label,
          requirement: text,
          material: inferQualificationMaterial(text),
        })
      })
    }
    pushQualification('主体资格', qualification.main_body_qualification)
    pushQualification('行业准入', qualification.industry_access_qualification)
    pushQualification('体系认证', qualification.system_certification_requirements)
    pushQualification('财务要求', qualification.financial_requirements)
    pushQualification('业绩要求', qualification.performance_requirements)
    pushQualification('信用要求', qualification.credit_requirements)
    pushQualification('其他资格', qualification.other_qualification)

    const complianceRows = toMeaningfulList(invalid.compliance_invalid_clauses).map((text) => ({
      label: '符合性条款',
      requirement: text,
      material: '逐条响应并在偏离表中明确“无负偏离”',
    }))

    const invalidRows = []
    const invalidMapping = [
      ['qualification_invalid_clauses', '资格性废标'],
      ['compliance_invalid_clauses', '符合性废标'],
      ['personnel_invalid_clauses', '人员废标'],
      ['service_scheme_invalid_clauses', '技术/方案废标'],
      ['sla_invalid_clauses', 'SLA废标'],
      ['business_invalid_clauses', '商务废标'],
      ['quotation_invalid_clauses', '报价废标'],
      ['signature_seal_invalid_clauses', '签章密封废标'],
      ['other_invalid_clauses', '其他废标'],
    ]
    invalidMapping.forEach(([key, label]) => {
      toMeaningfulList(invalid[key]).forEach((text) => {
        invalidRows.push({
          label,
          requirement: text,
          material: '高风险条款，需一一对照并提供原件/盖章证明',
        })
      })
    })
    return {
      qualification: qualificationRows,
      compliance: complianceRows,
      invalid: invalidRows,
    }
  })()
  const wizardQualificationCards = [
    { key: 'qualification', title: '资格性审查', rows: wizardQualificationSections.qualification },
    { key: 'compliance', title: '符合性审查', rows: wizardQualificationSections.compliance },
    { key: 'invalid', title: '废标项', rows: wizardQualificationSections.invalid },
  ]
  const wizardCurrentQualificationTab = wizardQualificationCards.some((item) => item.key === generateQualificationTab)
    ? generateQualificationTab
    : 'qualification'
  const wizardActiveQualificationCard = wizardQualificationCards.find((item) => item.key === wizardCurrentQualificationTab)
    || wizardQualificationCards[0]
  const wizardActiveQualificationRows = Array.isArray(wizardActiveQualificationCard?.rows)
    ? wizardActiveQualificationCard.rows
    : []
  const wizardSourceTextPreview = toMeaningfulText(generateWizard.analysis?.source_text_preview)
    || wizardSectionSummaries
      .map((item) => {
        const title = firstNonEmpty(item?.section_title, item?.section_key, '未命名章节')
        const summary = toMeaningfulText(item?.summary)
        if (!summary) return ''
        return `${title}\n${summary}`
      })
      .filter(Boolean)
      .join('\n\n')
  const wizardPreviewMode = (() => {
    if (!generateSourcePreviewEditor?.config) return 'text'
    return 'doc'
  })()
  const draftCheckSummary = draftCheckState.summary && typeof draftCheckState.summary === 'object'
    ? draftCheckState.summary
    : { issue_count: 0, fatal_count: 0, warn_count: 0, pass: true }
  const draftCheckIssues = Array.isArray(draftCheckState.issues)
    ? draftCheckState.issues
    : []
  const draftCheckFilter = String(draftCheckState.severity_filter || 'ALL').toUpperCase()
  const filteredDraftCheckIssues = draftCheckFilter === 'ALL'
    ? draftCheckIssues
    : draftCheckIssues.filter((item) => String(item?.severity || '').toUpperCase() === draftCheckFilter)
  const scoreOptimizeMatrix = Array.isArray(scoreOptimizeState.matrix)
    ? scoreOptimizeState.matrix
    : []
  const scoreOptimizeItems = Array.isArray(scoreOptimizeState.items)
    ? scoreOptimizeState.items
    : []
  const scoreOptimizeNeedCount = scoreOptimizeMatrix.filter((item) => Number(item?.optimization_needed_flag || 0) === 1).length
  const scoreOptimizeNoneCount = scoreOptimizeMatrix.filter((item) => String(item?.coverage_status || '').toUpperCase() === 'NONE').length
  const scoreOptimizeWeakCount = scoreOptimizeMatrix.filter((item) => String(item?.coverage_status || '').toUpperCase() === 'WEAK').length

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
                if (item.key === 'config' && canConfigManage) {
                  fetchConfigs().catch((err) => showError(err.message))
                  if (canAiManage) fetchModels().catch((err) => showError(err.message))
                }
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
                        if (
                          item.key === 'library-qualification'
                          || item.key === 'library-finance'
                          || item.key === 'library-personnel'
                          || item.key === 'library-samples'
                        ) {
                          fetchAssets().catch((err) => showError(err.message))
                        }
                        if (item.key === 'library-samples') fetchSamples().catch((err) => showError(err.message))
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
            <button
              className="ghost"
              onClick={() => Promise.allSettled([fetchBootstrap(), fetchBids(), fetchBundles(), fetchAssets(), fetchModels(), fetchGenerateJobs(), fetchSamples()])}
            >
              刷新
            </button>
          </div>
        </section>

        {message ? <div className="toast success">{message}</div> : null}
        {error ? <div className="toast error">{error}</div> : null}
        {editorScriptError ? <div className="toast warning">{editorScriptError}</div> : null}

        {activeTab === 'dashboard' && (
          <section className="panel dashboard-panel">
            <div className="panel-header">
              <h2>作战仪表盘</h2>
              <span className="muted">实时汇总标书、样本、模型与生成任务态势</span>
            </div>
            <div className="panel-body dashboard-body">
              <div className="dashboard-kpi-grid">
                {dashboardKpiCards.map((card) => (
                  <article className={`dashboard-kpi-card ${card.tone}`} key={card.key}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                    <em>{card.hint}</em>
                  </article>
                ))}
              </div>

              <div className="dashboard-main-grid">
                <article className="dashboard-card trend-card">
                  <div className="dashboard-card-head">
                    <h3>近 7 日任务趋势</h3>
                    <p>标书更新 / 生成任务 / 样本变更</p>
                  </div>
                  <div className="dashboard-trend-chart">
                    {dashboardTrendRows.map((row) => (
                      <div className="dashboard-trend-col" key={row.key}>
                        <div className="dashboard-trend-stack">
                          <span className="segment bids" style={{ height: `${row.bidsHeight}%` }} />
                          <span className="segment jobs" style={{ height: `${row.jobsHeight}%` }} />
                          <span className="segment samples" style={{ height: `${row.samplesHeight}%` }} />
                        </div>
                        <strong>{row.total}</strong>
                        <label>{row.label}</label>
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-trend-legend">
                    <span><i className="dot bids" />标书</span>
                    <span><i className="dot jobs" />生成任务</span>
                    <span><i className="dot samples" />样本</span>
                  </div>
                </article>

                <article className="dashboard-card donut-card">
                  <div className="dashboard-card-head">
                    <h3>标书状态占比</h3>
                    <p>从草稿到归档全流程分布</p>
                  </div>
                  <div className="dashboard-donut-wrap">
                    <div className="dashboard-donut" style={dashboardDonutStyle}>
                      <div className="dashboard-donut-center">
                        <span>总数</span>
                        <strong>{bidSummary.total}</strong>
                      </div>
                    </div>
                    <div className="dashboard-donut-legend">
                      {dashboardStatusRows.map((item) => (
                        <div key={item.key}>
                          <span className="swatch" style={{ background: item.color }} />
                          <label>{item.label}</label>
                          <strong>{item.value}</strong>
                          <em>{item.percent}%</em>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>

                <article className="dashboard-card funnel-card">
                  <div className="dashboard-card-head">
                    <h3>流程转化漏斗</h3>
                    <p>观察从创建到提交的转化效率</p>
                  </div>
                  <div className="dashboard-funnel">
                    {dashboardFunnelRows.map((item) => (
                      <div className="dashboard-funnel-row" key={item.key}>
                        <label>{item.label}</label>
                        <div className="dashboard-funnel-track">
                          <span style={{ width: `${item.width}%` }}>
                            <strong>{item.value}</strong>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="dashboard-card health-card">
                  <div className="dashboard-card-head">
                    <h3>自动化健康度</h3>
                    <p>识别、解析、生成、模型可用率</p>
                  </div>
                  <div className="dashboard-health-list">
                    {dashboardHealthRows.map((item) => (
                      <div className="dashboard-health-row" key={item.key}>
                        <label>{item.label}</label>
                        <div className="dashboard-health-track">
                          <span style={{ width: `${item.value}%` }} />
                        </div>
                        <strong>{item.value}%</strong>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <article className="dashboard-card risk-card">
                <div className="dashboard-card-head">
                  <h3>风险预警清单</h3>
                  <p>高风险优先处理，保证投标链路稳定</p>
                </div>
                <div className="dashboard-risk-list">
                  {dashboardRiskRows.map((item, idx) => (
                    <div className="dashboard-risk-item" key={`${item.level}-${idx}`}>
                      <span className={`risk-level level-${item.level}`}>{item.level}</span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>
        )}

        {activeTab === 'bids' && (
          <section className="panel bid-panel">
            <div className="panel-header"><h2>标书管理</h2></div>
            <div className="panel-body">
              <div className="bid-board">
                <div className="bid-overview-strip">
                  <div className="bid-overview-main">
                    <p className="bid-overview-kicker">标书作战看板</p>
                    <h3>从创建到协同编辑的一站式工作流</h3>
                    <p>在这里统一完成新建、上传生成、模板套用、状态流转和版本追踪。</p>
                  </div>
                  <div className="bid-overview-metrics">
                    <div className="bid-overview-metric">
                      <span>总数</span>
                      <strong>{bidSummary.total}</strong>
                    </div>
                    <div className="bid-overview-metric">
                      <span>草稿</span>
                      <strong>{bidSummary.draft}</strong>
                    </div>
                    <div className="bid-overview-metric">
                      <span>评审中</span>
                      <strong>{bidSummary.review}</strong>
                    </div>
                    <div className="bid-overview-metric">
                      <span>已提交</span>
                      <strong>{bidSummary.submitted}</strong>
                    </div>
                  </div>
                </div>

                {canWrite && (
                  <div className="bid-create-zone">
                    <div className="bid-form-card">
                      <div className="bid-form-head">
                        <h3>快速新建</h3>
                        <p>手动录入基础信息，创建标书工作区。</p>
                      </div>
                      <div className="article-create bid-create-grid">
                        <input value={bidForm.title} placeholder="标书标题" onChange={(e) => setBidForm((p) => ({ ...p, title: e.target.value }))} />
                        <input value={bidForm.customer_name} placeholder="客户名称" onChange={(e) => setBidForm((p) => ({ ...p, customer_name: e.target.value }))} />
                        <input value={bidForm.project_name} placeholder="项目名称" onChange={(e) => setBidForm((p) => ({ ...p, project_name: e.target.value }))} />
                        <input value={bidForm.summary} placeholder="摘要(可选)" onChange={(e) => setBidForm((p) => ({ ...p, summary: e.target.value }))} />
                        <button className="primary" onClick={onCreateBid}>新建标书</button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bid-list-head">
                  <div className="bid-list-head-main">
                    <h3>标书列表</h3>
                    <span className="muted">共 {bids.length} 份标书</span>
                  </div>
                  {canWrite ? (
                    <div className="bid-list-head-actions">
                      <label className="bid-select-all">
                        <input
                          type="checkbox"
                          checked={bidAllSelected}
                          onChange={(e) => onToggleBidSelectAll(e.target.checked)}
                          disabled={!bids.length}
                        />
                        <span>全选</span>
                      </label>
                      <button
                        className="ghost"
                        onClick={() => onBatchDeleteBids('bids')}
                        disabled={!bidSelectedIds.length}
                      >
                        批量删除
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="bid-list">
                  {bids.map((item) => (
                    <article className="bid-item" key={item.id}>
                      <div className="bid-item-main">
                        <div className="bid-item-main-left">
                          {canWrite ? (
                            <label className="bid-item-check">
                              <input
                                type="checkbox"
                                checked={bidSelectedIdSet.has(Number(item.id))}
                                onChange={(e) => onToggleBidSelect(item.id, e.target.checked)}
                              />
                            </label>
                          ) : null}
                          <div className="bid-item-title">
                            <strong>{item.bid_no}</strong>
                            <p>{item.title}</p>
                          </div>
                        </div>
                        <div className={`status-pill ${bidStatusToneClass(item.status)}`}>
                          {bidStatusLabel(item.status)}
                        </div>
                      </div>

                      <div className="bid-item-meta">
                        <span className="meta-pill">客户：{item.customer_name || '未填写'}</span>
                        <span className="meta-pill">项目：{item.project_name || '未填写'}</span>
                        <span className="meta-pill">更新时间：{formatDateTime(item.updated_at)}</span>
                      </div>
                      {item.summary ? <p className="bid-item-summary">摘要：{item.summary}</p> : null}

                      <div className="bid-item-actions">
                        <div className="bid-action-group">
                          <button className="ghost" onClick={() => { openBidVersionPanel(item).catch(() => {}) }}>查看版本</button>
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
                              <button className="ghost" onClick={() => onDeleteBid(item.id)}>删除</button>
                            </>
                          ) : null}
                        </div>
                        {canWrite ? (
                          <div className="bid-action-group">
                            <select
                              className="bid-template-select"
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
                            <select className="bid-status-select" value={item.status} onChange={(e) => onChangeBidStatus(item, e.target.value)}>
                              {bidStatusOptions.map((status) => (
                                <option key={status.value} value={status.value}>{status.label}</option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))}
                  {!bids.length ? <div className="empty">暂无标书</div> : null}
                </div>

                {selectedBid && (
                  <div className="bid-version-panel">
                    <div className="bid-version-headline">
                      <h3>版本历史 - {selectedBid.title}</h3>
                      <span className="muted">{versions.length} 个版本</span>
                    </div>

                    <div className="compare-toolbar">
                      <select
                        value={compareState.leftVersionId}
                        onChange={(e) => setCompareState((prev) => ({ ...prev, leftVersionId: e.target.value }))}
                      >
                        <option value="">选择左侧版本</option>
                        {versions.map((v) => (
                          <option key={`left-${v.id}`} value={v.id}>
                            {`v${v.version_no} · ${versionSourceLabel(v.source_type)}`}
                          </option>
                        ))}
                      </select>
                      <select
                        value={compareState.rightVersionId}
                        onChange={(e) => setCompareState((prev) => ({ ...prev, rightVersionId: e.target.value }))}
                      >
                        <option value="">选择右侧版本</option>
                        {versions.map((v) => (
                          <option key={`right-${v.id}`} value={v.id}>
                            {`v${v.version_no} · ${versionSourceLabel(v.source_type)}`}
                          </option>
                        ))}
                      </select>
                      <button className="ghost" onClick={onCompareVersions} disabled={compareState.loading}>
                        {compareState.loading ? '对比中...' : '版本对比'}
                      </button>
                      <button
                        className="ghost"
                        onClick={() => fetchEditorEvents(selectedBid.id)}
                        disabled={editorEventsLoading}
                      >
                        {editorEventsLoading ? '刷新中...' : '刷新编辑轨迹'}
                      </button>
                    </div>

                    <div className="draft-quality-panel">
                      <div className="section-subhead">
                        <h4>成稿级校验与评分优化</h4>
                        <span className="muted">基于当前标书最新版本执行</span>
                      </div>
                      <div className="draft-quality-toolbar">
                        <button className="ghost" onClick={onRunDraftCheck} disabled={draftCheckState.busy}>
                          {draftCheckState.busy ? '校验中...' : '执行成稿校验'}
                        </button>
                        <button className="ghost" onClick={onRunScoreOptimize} disabled={scoreOptimizeState.busy}>
                          {scoreOptimizeState.busy ? '优化中...' : '执行评分优化'}
                        </button>
                        {draftCheckState.run_id ? <span className="muted">校验 Run #{draftCheckState.run_id}</span> : null}
                        {scoreOptimizeState.source_job_id ? <span className="muted">来源任务 #{scoreOptimizeState.source_job_id}</span> : null}
                      </div>
                      <div className="draft-quality-grid">
                        <article className="draft-quality-card">
                          <div className="section-subhead">
                            <h4>校验结果</h4>
                            <span className={`draft-quality-pass ${draftCheckSummary.pass ? 'ok' : 'risk'}`}>
                              {draftCheckSummary.pass ? '可提交' : '建议先修复'}
                            </span>
                          </div>
                          <div className="draft-quality-metrics">
                            <span>问题总数 {Number(draftCheckSummary.issue_count || 0)}</span>
                            <span>致命 {Number(draftCheckSummary.fatal_count || 0)}</span>
                            <span>告警 {Number(draftCheckSummary.warn_count || 0)}</span>
                          </div>
                          <div className="draft-quality-filter">
                            <button
                              type="button"
                              className={draftCheckFilter === 'ALL' ? 'active' : ''}
                              onClick={() => setDraftCheckState((prev) => ({ ...prev, severity_filter: 'ALL' }))}
                            >
                              全部
                            </button>
                            <button
                              type="button"
                              className={draftCheckFilter === 'FATAL' ? 'active' : ''}
                              onClick={() => setDraftCheckState((prev) => ({ ...prev, severity_filter: 'FATAL' }))}
                            >
                              致命
                            </button>
                            <button
                              type="button"
                              className={draftCheckFilter === 'WARN' ? 'active' : ''}
                              onClick={() => setDraftCheckState((prev) => ({ ...prev, severity_filter: 'WARN' }))}
                            >
                              告警
                            </button>
                          </div>
                          <div className="draft-quality-list">
                            {filteredDraftCheckIssues.map((item, idx) => (
                              <div className="draft-quality-item" key={`check-issue-${idx}`}>
                                <div className="draft-quality-item-head">
                                  <span className={`severity-badge ${String(item?.severity || '').toUpperCase() === 'FATAL' ? 'fatal' : 'warn'}`}>
                                    {String(item?.severity || 'WARN').toUpperCase()}
                                  </span>
                                  <strong>{item?.title || `问题${idx + 1}`}</strong>
                                </div>
                                <p>{item?.message || '-'}</p>
                                {item?.section_title ? <small>章节：{item.section_title}</small> : null}
                                {item?.requirement_code ? <small>要求编码：{item.requirement_code}</small> : null}
                              </div>
                            ))}
                            {!filteredDraftCheckIssues.length ? <div className="empty">暂无校验问题</div> : null}
                          </div>
                        </article>

                        <article className="draft-quality-card">
                          <div className="section-subhead">
                            <h4>评分补强建议</h4>
                            <span className="muted">待补强 {scoreOptimizeNeedCount} 项</span>
                          </div>
                          <div className="draft-quality-metrics">
                            <span>评分项 {scoreOptimizeMatrix.length}</span>
                            <span>未覆盖 {scoreOptimizeNoneCount}</span>
                            <span>弱覆盖 {scoreOptimizeWeakCount}</span>
                          </div>
                          <div className="draft-quality-list">
                            {scoreOptimizeItems.map((item, idx) => (
                              <div className="draft-quality-item" key={`score-opt-${idx}`}>
                                <div className="draft-quality-item-head">
                                  <span className="severity-badge score">SUGGEST</span>
                                  <strong>{item?.suggestion_title || item?.score_item_id || `建议${idx + 1}`}</strong>
                                </div>
                                <p>{item?.suggestion_text || '-'}</p>
                                {Array.isArray(item?.evidence_ids) && item.evidence_ids.length ? (
                                  <small>建议证据：{item.evidence_ids.join('、')}</small>
                                ) : null}
                              </div>
                            ))}
                            {!scoreOptimizeItems.length ? <div className="empty">暂无评分补强建议</div> : null}
                          </div>
                        </article>
                      </div>
                    </div>

                    <div className="bid-version-grid">
                      <div className="table">
                        <div className="table-row header bid-version-row">
                          <span>版本</span>
                          <span>类型</span>
                          <span>文件</span>
                          <span>时间</span>
                          <span>操作</span>
                        </div>
                        {versions.map((v) => (
                          <div className="table-row bid-version-row" key={v.id}>
                            <span>v{v.version_no}</span>
                            <span>{versionSourceLabel(v.source_type)}</span>
                            <span>{v.file_name}</span>
                            <span>{formatDateTime(v.created_at)}</span>
                            <span className="row-actions">
                              <button className="link" onClick={() => setCompareState((prev) => ({ ...prev, leftVersionId: String(v.id) }))}>设为左侧</button>
                              <button className="link" onClick={() => setCompareState((prev) => ({ ...prev, rightVersionId: String(v.id) }))}>设为右侧</button>
                            </span>
                          </div>
                        ))}
                        {!versions.length ? <div className="empty">暂无版本</div> : null}
                      </div>

                      <div className="compare-result-block">
                        <div className="section-subhead">
                          <h4>版本差异</h4>
                          <span className="muted">
                            {compareState.result?.summary
                              ? `变更比 ${Math.round((compareState.result.summary.change_ratio || 0) * 100)}%`
                              : '尚未执行对比'}
                          </span>
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
                              <pre key={`bid-diff-${idx}`} className={`diff-item diff-${item.type}`}>{item.text}</pre>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="editor-events-block">
                      <div className="section-subhead">
                        <h4>编辑轨迹</h4>
                        <span className="muted">记录协同加入、保存、离开</span>
                      </div>
                      {editorEventsLoading ? <div className="empty">加载中...</div> : null}
                      {!editorEventsLoading && editorEvents.length ? (
                        <div className="event-list">
                          {editorEvents.map((item) => (
                            <div className="event-item" key={`editor-event-${item.id}`}>
                              <div className="event-main">
                                <strong>{item.username || '-'}</strong>
                                <span>{editorEventActionLabel(item.action)}</span>
                                {item.onlyoffice_status ? <span className="meta-pill">回调状态 {item.onlyoffice_status}</span> : null}
                                {item.file_size ? <span className="meta-pill">保存大小 {Math.max(1, Math.round(Number(item.file_size || 0) / 1024))}KB</span> : null}
                              </div>
                              <div className="event-meta">
                                {formatDateTime(item.created_at)} · 来源IP {item.request_ip || '-'}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {!editorEventsLoading && !editorEvents.length ? <div className="empty">暂无编辑轨迹</div> : null}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'bid-generate' && (
          <section className="panel">
            <div className="panel-header"><h2>标书生成</h2></div>
            <div className="panel-body">
              {!generateWizard.open ? (
                <div className="generate-page">
                  <div className="generate-title-row">
                    <h3>生成列表</h3>
                  </div>

                  <div className="generate-overview-grid">
                    <article className="generate-overview-card">
                      <span>任务总数</span>
                      <strong>{generateSummary.total}</strong>
                    </article>
                    <article className="generate-overview-card">
                      <span>已生成</span>
                      <strong>{generateSummary.generated}</strong>
                    </article>
                    <article className="generate-overview-card">
                      <span>进行中</span>
                      <strong>{generateSummary.running}</strong>
                    </article>
                    <article className="generate-overview-card">
                      <span>失败</span>
                      <strong>{generateSummary.failed}</strong>
                    </article>
                  </div>

                  <div className="generate-toolbar">
                    <div className="generate-toolbar-left">
                      {canWrite ? <button className="ghost generate-btn" onClick={onOpenGenerateWizard}>上传</button> : null}
                      {canWrite ? (
                        <button
                          className="ghost generate-btn"
                          onClick={onBatchDeleteGenerateRows}
                          disabled={!generateSelectedIds.length}
                        >
                          批量删除
                        </button>
                      ) : null}
                      <span className="generate-selected-text">
                        已选择 {generateSelectedIds.length} 项
                      </span>
                    </div>

                    <label className="generate-search-wrap">
                      <span className="generate-search-icon" aria-hidden="true" />
                      <input
                        className="generate-search"
                        value={generateSearch}
                        onChange={(e) => setGenerateSearch(e.target.value)}
                        placeholder="搜索文件名 / 状态 / 模型..."
                      />
                    </label>
                  </div>

                  <div className="generate-table-wrap">
                    <div className="generate-list-head">
                      <label className="generate-select-all">
                        <input
                          type="checkbox"
                          checked={generateAllSelected}
                          onChange={(e) => onToggleGenerateSelectAll(e.target.checked)}
                          disabled={!generateRows.length}
                        />
                        <span>全选当前筛选结果</span>
                      </label>
                      <span className="muted">按创建时间倒序显示</span>
                    </div>

                    <div className="generate-list">
                      {generatePagedRows.map((item) => (
                        <article className="generate-item-card" key={item.id}>
                          <div className="generate-item-main">
                            <label className="generate-item-check">
                              <input
                                type="checkbox"
                                checked={generateSelectedIdSet.has(Number(item.id))}
                                onChange={(e) => onToggleGenerateSelect(item.id, e.target.checked)}
                              />
                            </label>
                            <div className="generate-item-content">
                              <div className="generate-item-top">
                                <strong className="generate-item-title" title={item.file_name}>{item.file_name}</strong>
                                <span className={`generate-status-pill ${generateJobStatusToneClass(item.status)}`}>
                                  {generateJobStatusLabel(item.status)}
                                </span>
                              </div>
                              <div className="generate-item-meta">
                                <span>创建时间 {formatDateTime(item.created_at)}</span>
                                <span>进度 {item.progress}%</span>
                                {item.model_name ? <span>模型 {item.model_name}</span> : null}
                              </div>
                              <div className="generate-progress-cell">
                                <div className="generate-progress-track">
                                  <span className="generate-progress-fill" style={{ width: `${item.progress}%` }} />
                                </div>
                                <em>{item.progress}%</em>
                              </div>
                            </div>
                          </div>
                          <div className="generate-item-actions">
                            <button className="primary" onClick={() => onOpenGenerateBid(item)}>查看</button>
                            {canWrite ? (
                              <button className="ghost danger" onClick={() => onDeleteGenerateRow(item.id)}>删除</button>
                            ) : null}
                          </div>
                        </article>
                      ))}
                      {!generateRows.length ? <div className="empty generate-empty">暂无数据</div> : null}
                    </div>
                  </div>

                  <div className="list-pagination">
                    <span>共 {generateTotal} 条</span>
                    <div className="list-page-nav">
                      <button className="ghost" onClick={() => setGeneratePage(1)} disabled={normalizedGeneratePage <= 1}>«</button>
                      <button className="ghost" onClick={() => setGeneratePage((prev) => Math.max(1, prev - 1))} disabled={normalizedGeneratePage <= 1}>‹</button>
                      <span className="list-page-current">{normalizedGeneratePage}</span>
                      <button className="ghost" onClick={() => setGeneratePage((prev) => Math.min(generateTotalPages, prev + 1))} disabled={normalizedGeneratePage >= generateTotalPages}>›</button>
                      <button className="ghost" onClick={() => setGeneratePage(generateTotalPages)} disabled={normalizedGeneratePage >= generateTotalPages}>»</button>
                    </div>
                    <div className="list-page-size">
                      <span>每页</span>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={generatePageSize}
                        onChange={(e) => onChangeGeneratePageSize(e.target.value)}
                      />
                      <span>条</span>
                    </div>
                    <div className="list-page-go">
                      <span>前往</span>
                      <input
                        type="number"
                        min={1}
                        max={generateTotalPages}
                        value={generateGotoPage}
                        onChange={(e) => setGenerateGotoPage(e.target.value)}
                        onBlur={onJumpGeneratePage}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onJumpGeneratePage()
                        }}
                      />
                      <span>页</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="generate-wizard">
                  <div className="generate-stepbar">
                    <button type="button" className="generate-back-btn" onClick={onBackToGenerateList}>‹</button>
                    <div className="generate-steps">
                      <div className={`generate-step ${generateWizard.step >= 1 ? 'active' : ''}`}>
                        <span className="generate-step-index">1</span>
                        <span>分析</span>
                      </div>
                      <div className="generate-step-divider" />
                      <div className={`generate-step ${generateWizard.step >= 2 ? 'active' : ''}`}>
                        <span className="generate-step-index">2</span>
                        <span>核对</span>
                      </div>
                      <div className="generate-step-divider" />
                      <div className={`generate-step ${generateWizard.step >= 3 ? 'active' : ''}`}>
                        <span className="generate-step-index">3</span>
                        <span>生成</span>
                      </div>
                    </div>
                  </div>

                  {generateWizard.step === 1 ? (
                    <div className="generate-step-panel">
                      <div className="generate-upload-list">
                        <div className="generate-upload-item">
                          <div className="generate-upload-title"><i>*</i>上传招标文件 <span className="generate-help">!</span></div>
                          <div className="generate-upload-row">
                            <label className="ghost generate-upload-btn">
                              选择文件
                              <input
                                key={`${generateUploadInputSeed}-bidding`}
                                type="file"
                                accept=".doc,.docx"
                                onChange={(e) => onPickGenerateFile('bidding_file', e.target.files?.[0] || null)}
                              />
                            </label>
                            <small className="muted">{generateWizard.upload.bidding_file?.name || '未选择文件'}</small>
                          </div>
                        </div>
                        <div className="generate-upload-item">
                          <div className="generate-upload-title"><i>*</i>选择招标类型</div>
                          <div className="generate-upload-row">
                            <select
                              className="generate-model-select"
                              value={generateWizard.upload.bid_category || ''}
                              onChange={(e) =>
                                setGenerateWizard((prev) => ({
                                  ...prev,
                                  upload: { ...prev.upload, bid_category: e.target.value },
                                }))
                              }
                            >
                              <option value="">请选择招标类型</option>
                              {bidCategoryOptions.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            <small className="muted">用于匹配同类型历史样本并提升分析准确度</small>
                          </div>
                        </div>
                        <div className="generate-upload-item">
                          <div className="generate-upload-title">选择模型</div>
                          <div className="generate-upload-row">
                            <select
                              className="generate-model-select"
                              value={generateWizard.model_id || ''}
                              onChange={(e) => setGenerateWizard((prev) => ({ ...prev, model_id: e.target.value }))}
                            >
                              <option value="">请选择模型</option>
                              {models
                                .filter((item) => Number(item.is_enabled) === 1)
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name}
                                  </option>
                                ))}
                            </select>
                            <small className="muted">
                              支持分析“得分项/丢分项”，并匹配历史样本 Top3
                            </small>
                          </div>
                        </div>
                        <div className="generate-upload-item">
                          <div className="generate-upload-title"><i>*</i>投标模板</div>
                          <div className="generate-upload-row">
                            <select
                              className="generate-model-select"
                              value={generateWizard.upload.doc_template_id || ''}
                              onChange={(e) =>
                                setGenerateWizard((prev) => ({
                                  ...prev,
                                  upload: { ...prev.upload, doc_template_id: e.target.value },
                                }))
                              }
                            >
                              <option value="">请选择投标模板</option>
                              {docTemplates
                                .filter((item) => String(item.status || '').toUpperCase() === 'ACTIVE')
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.template_name}{item.is_default ? '（默认）' : ''}
                                  </option>
                                ))}
                            </select>
                            <small className="muted">
                              生成初稿时按所选模板套版；可在系统配置上传多套模板
                            </small>
                          </div>
                        </div>
                      </div>
                      <div className="generate-wizard-foot">
                        <button
                          type="button"
                          className="primary generate-start-btn"
                          onClick={onStartGenerateAnalysis}
                          disabled={generateWizard.analysisBusy || !generateWizard.upload.bid_category || !generateWizard.upload.doc_template_id}
                        >
                          {generateWizard.analysisBusy ? '分析中...' : '开始分析'}
                        </button>
                      </div>
                      {generateWizard.analysisBusy ? (
                        <div className={`generate-analysis-runtime${wizardAnalyzeRuntimeMeta.isSlow ? ' is-slow' : ''}`} role="status">
                          <div className="generate-analysis-runtime-head">
                            <strong>{wizardAnalyzeRuntimeMeta.stage}</strong>
                            <span>已等待 {wizardAnalyzeElapsedText}</span>
                          </div>
                          <p>{wizardAnalyzeRuntimeMeta.detail}</p>
                          <div className="generate-analysis-runtime-bar">
                            <span style={{ width: `${wizardAnalyzeRuntimeMeta.progress}%` }} />
                          </div>
                          <small>{wizardAnalyzeExpectedText}，请勿关闭页面。</small>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {generateWizard.step === 2 ? (
                    <div className="generate-step-panel">
                      <div className="generate-step-hint">
                        招标类型：{wizardBidCategoryText}
                        {' '}｜ 识别章节：{wizardSectionSummaries.length} 段
                        {' '}｜ 识别表格：{wizardTableSummaries.length} 张
                        {' '}｜ 评分项提取：{Number(wizardScoreTableExtract.merged_count || 0)} 条
                      </div>
                      {wizardScoreTableBlocked ? (
                        <div className="generate-warning-list">
                          <span>{wizardScoreTableBlockedMessage}</span>
                        </div>
                      ) : null}
                      <div className="generate-verify-split">
                        <div className="generate-verify-left">
                          <article className="generate-summary-card">
                            <div className="generate-check-head">
                              <h4>投标人须知（核心信息）</h4>
                              <span>
                                {generateInstructionStream.running
                                  ? `自动填充中 ${Math.min(generateInstructionStream.progress, generateInstructionStream.total)}/${generateInstructionStream.total}`
                                  : `已填 ${wizardInstructionFilledCount}/${generateInstructionFieldOrder.length} 项`}
                              </span>
                            </div>
                            <div className="generate-instruction-form">
                              <label>
                                <span>项目名称</span>
                                <input
                                  value={wizardInstructionForm.project_name}
                                  onChange={(e) => onChangeGenerateInstructionField('project_name', e.target.value)}
                                />
                              </label>
                              <label>
                                <span>项目编号</span>
                                <input
                                  value={wizardInstructionForm.project_code}
                                  onChange={(e) => onChangeGenerateInstructionField('project_code', e.target.value)}
                                />
                              </label>
                              <label>
                                <span>包号</span>
                                <input
                                  value={wizardInstructionForm.package_no}
                                  onChange={(e) => onChangeGenerateInstructionField('package_no', e.target.value)}
                                />
                              </label>
                              <label>
                                <span>预算</span>
                                <input
                                  value={wizardInstructionForm.budget}
                                  onChange={(e) => onChangeGenerateInstructionField('budget', e.target.value)}
                                />
                              </label>
                              <label>
                                <span>招标人</span>
                                <input
                                  value={wizardInstructionForm.buyer_name}
                                  onChange={(e) => onChangeGenerateInstructionField('buyer_name', e.target.value)}
                                />
                              </label>
                              <label>
                                <span>招标代理机构</span>
                                <input
                                  value={wizardInstructionForm.agency_name}
                                  onChange={(e) => onChangeGenerateInstructionField('agency_name', e.target.value)}
                                />
                              </label>
                              <label className="generate-instruction-wide">
                                <span>项目所属领域</span>
                                <input
                                  value={wizardInstructionForm.project_domain}
                                  onChange={(e) => onChangeGenerateInstructionField('project_domain', e.target.value)}
                                />
                              </label>
                              <label className="generate-instruction-wide">
                                <span>项目概况</span>
                                <textarea
                                  value={wizardInstructionForm.project_overview}
                                  onChange={(e) => onChangeGenerateInstructionField('project_overview', e.target.value)}
                                />
                              </label>
                            </div>
                          </article>

                          <article className="generate-summary-card generate-domain-card">
                            <div className="generate-check-head">
                              <h4>商务要求</h4>
                              <span>{wizardBusinessRequirements.length} 条</span>
                            </div>
                            <div className="generate-domain-panel">
                              {wizardBusinessRequirements.map((item, idx) => (
                                <div className="generate-domain-row" key={`biz-${idx}`}>
                                  <span className="generate-domain-index">{idx + 1}</span>
                                  <div className="generate-domain-body">
                                    <strong>{item.label}：</strong>
                                    <p>{item.content}</p>
                                  </div>
                                </div>
                              ))}
                              {!wizardBusinessRequirements.length ? <div className="empty">暂无商务要求</div> : null}
                            </div>
                            <p className="generate-domain-tip">*请根据AI分析结果手动调整</p>
                          </article>

                          <article className="generate-summary-card generate-domain-card">
                            <div className="generate-check-head">
                              <h4>技术要求</h4>
                              <span>{wizardTechnicalRequirements.length} 条</span>
                            </div>
                            <div className="generate-domain-panel">
                              {wizardTechnicalRequirements.map((item, idx) => (
                                <div className="generate-domain-row" key={`tech-${idx}`}>
                                  <span className="generate-domain-index">{idx + 1}</span>
                                  <div className="generate-domain-body">
                                    <strong>{item.label}：</strong>
                                    <p>{item.content}</p>
                                  </div>
                                </div>
                              ))}
                              {!wizardTechnicalRequirements.length ? <div className="empty">暂无技术要求</div> : null}
                            </div>
                            <p className="generate-domain-tip">*请根据AI分析结果手动调整</p>
                          </article>

                          <article className="generate-summary-card generate-domain-card">
                            <div className="generate-check-head">
                              <h4>资格审查</h4>
                              <span>
                                资格性 {wizardQualificationSections.qualification.length} / 符合性 {wizardQualificationSections.compliance.length} / 废标项 {wizardQualificationSections.invalid.length}
                              </span>
                            </div>
                            <div className="generate-qualification-tabs">
                              {wizardQualificationCards.map((card) => (
                                <button
                                  key={card.key}
                                  type="button"
                                  className={wizardCurrentQualificationTab === card.key ? 'active' : ''}
                                  onClick={() => setGenerateQualificationTab(card.key)}
                                >
                                  {card.title}
                                </button>
                              ))}
                            </div>
                            <div className="generate-qualification-table">
                              <div className="generate-qualification-row head">
                                <span>序号</span>
                                <span>资格要求</span>
                                <span>需提供的资料</span>
                              </div>
                              {wizardActiveQualificationRows.map((row, idx) => (
                                <div className="generate-qualification-row" key={`${wizardCurrentQualificationTab}-${idx}`}>
                                  <span>{idx + 1}</span>
                                  <span>{row.requirement}</span>
                                  <span>{row.material}</span>
                                </div>
                              ))}
                              {!wizardActiveQualificationRows.length ? (
                                <div className="empty">暂无{wizardActiveQualificationCard?.title || '资格审查'}条目</div>
                              ) : null}
                            </div>
                          </article>

                          <div className="generate-check-grid">
                            <article className="generate-check-card">
                              <div className="generate-check-head">
                                <h4>得分项</h4>
                                <span>{wizardScoringItems.length} 条</span>
                              </div>
                              <div className="generate-check-list">
                                {wizardScoringItems.map((item, idx) => (
                                  <div className="generate-check-item score" key={`score-${idx}`}>
                                    <strong>{item.title || `得分项${idx + 1}`}</strong>
                                    <p>章节：{item.section_title || item.section_key || '-'}</p>
                                    {item.evidence_text || item.evidence ? <p>证据：{item.evidence_text || item.evidence}</p> : null}
                                    {item.suggestion_text || item.suggestion ? <p>建议：{item.suggestion_text || item.suggestion}</p> : null}
                                  </div>
                                ))}
                                {!wizardScoringItems.length ? <div className="empty">暂无得分项</div> : null}
                              </div>
                            </article>

                            <article className="generate-check-card">
                              <div className="generate-check-head">
                                <h4>丢分项</h4>
                                <span>{wizardRiskItems.length} 条</span>
                              </div>
                              <div className="generate-check-list">
                                {wizardRiskItems.map((item, idx) => (
                                  <div className="generate-check-item risk" key={`risk-${idx}`}>
                                    <strong>{item.title || `风险项${idx + 1}`}</strong>
                                    <p>章节：{item.section_title || item.section_key || '-'}</p>
                                    {item.risk_level ? <p>等级：{String(item.risk_level).toUpperCase()}</p> : null}
                                    {item.evidence_text || item.evidence ? <p>触发：{item.evidence_text || item.evidence}</p> : null}
                                    {item.suggestion_text || item.suggestion ? <p>规避：{item.suggestion_text || item.suggestion}</p> : null}
                                  </div>
                                ))}
                                {!wizardRiskItems.length ? <div className="empty">暂无丢分项</div> : null}
                              </div>
                            </article>
                          </div>

                          <div className="generate-artifact-grid">
                            <article className="generate-summary-card">
                              <div className="generate-check-head">
                                <h4>投标风险分析</h4>
                                <span>{wizardRiskChecklist.length} 条</span>
                              </div>
                              <div className="generate-check-list">
                                {wizardRiskChecklist.map((item, idx) => (
                                  <div className="generate-check-item risk" key={`risk-check-${idx}`}>
                                    <strong>{item.risk_title || `风险条款${idx + 1}`}</strong>
                                    <p>风险等级：{item.risk_level || '高风险'}</p>
                                    <p>来源章节：{item.source_chapter || '-'}</p>
                                  </div>
                                ))}
                                {!wizardRiskChecklist.length ? <div className="empty">暂无废标风险清单</div> : null}
                              </div>
                            </article>

                            <article className="generate-summary-card">
                              <div className="generate-check-head">
                                <h4>评分策略分析</h4>
                                <span>理论最高得分</span>
                              </div>
                              <div className="generate-score-metrics">
                                <div><label>价格分</label><strong>{wizardScoreStrategy.price_score || '未明确'}</strong></div>
                                <div><label>技术分</label><strong>{wizardScoreStrategy.technical_score || '未明确'}</strong></div>
                                <div><label>商务分</label><strong>{wizardScoreStrategy.business_score || '未明确'}</strong></div>
                                <div><label>理论总分</label><strong>{wizardScoreStrategy.total_theoretical_score || '未明确'}</strong></div>
                              </div>
                              {wizardScoreStrategy.note ? <p className="generate-score-note">{wizardScoreStrategy.note}</p> : null}
                            </article>

                            <article className="generate-summary-card">
                              <div className="generate-check-head">
                                <h4>自动生成投标目录</h4>
                                <span>{wizardAutoToc.length} 章</span>
                              </div>
                              <div className="generate-outline-list">
                                {wizardAutoToc.map((item, idx) => (
                                  <p key={`toc-${idx}`}>{item}</p>
                                ))}
                                {!wizardAutoToc.length ? <div className="empty">暂无目录建议</div> : null}
                              </div>
                            </article>

                            <article className="generate-summary-card">
                              <div className="generate-check-head">
                                <h4>服务方案框架</h4>
                                <span>{wizardServiceOutline.length} 段</span>
                              </div>
                              <div className="generate-outline-list">
                                {wizardServiceOutline.map((item, idx) => (
                                  <p key={`outline-${idx}`}>{idx + 1}. {item}</p>
                                ))}
                                {!wizardServiceOutline.length ? <div className="empty">暂无框架建议</div> : null}
                              </div>
                            </article>
                          </div>

                          <article className="generate-summary-card">
                            <div className="generate-check-head">
                              <h4>自动偏离表</h4>
                              <span>技术 + 商务</span>
                            </div>
                            <div className="generate-deviation-grid">
                              <div className="generate-deviation-block">
                                <strong>技术偏离表（招标要求 | 投标响应 | 偏离说明）</strong>
                                <div className="generate-outline-list">
                                  {wizardTechDeviationRows.slice(0, 10).map((item, idx) => (
                                    <p key={`dev-tech-${idx}`}>
                                      {idx + 1}. {item.tender_requirement || '-'} | {item.bidder_response || '-'} | {item.deviation_note || '无偏离'}
                                    </p>
                                  ))}
                                  {!wizardTechDeviationRows.length ? <p>暂无技术偏离条目</p> : null}
                                </div>
                              </div>
                              <div className="generate-deviation-block">
                                <strong>商务偏离表（招标要求 | 投标响应 | 偏离说明）</strong>
                                <div className="generate-outline-list">
                                  {wizardBizDeviationRows.slice(0, 10).map((item, idx) => (
                                    <p key={`dev-biz-${idx}`}>
                                      {idx + 1}. {item.tender_requirement || '-'} | {item.bidder_response || '-'} | {item.deviation_note || '无偏离'}
                                    </p>
                                  ))}
                                  {!wizardBizDeviationRows.length ? <p>暂无商务偏离条目</p> : null}
                                </div>
                              </div>
                            </div>
                          </article>

                          <article className="generate-summary-card">
                            <div className="generate-check-head">
                              <h4>六章节摘要</h4>
                              <span>{wizardSectionSummaries.length} 段</span>
                            </div>
                            <div className="generate-summary-grid">
                              {wizardSectionSummaries.map((item) => (
                                <div className="generate-summary-item" key={`section-${item.section_key || item.section_title}`}>
                                  <strong>{item.section_title || item.section_key || '-'}</strong>
                                  <p>{item.summary || '无摘要'}</p>
                                </div>
                              ))}
                              {!wizardSectionSummaries.length ? <div className="empty">暂无章节摘要</div> : null}
                            </div>
                          </article>

                          <article className="generate-summary-card">
                            <div className="generate-check-head">
                              <h4>表格识别</h4>
                              <span>{wizardTableSummaries.length} 张</span>
                            </div>
                            <div className="generate-summary-grid">
                              {wizardTableSummaries.map((item, idx) => (
                                <div className="generate-summary-item" key={`table-${item.table_index || idx + 1}`}>
                                  <strong>表格{item.table_index || idx + 1} · {item.section_title || item.section_key || '未明确'}</strong>
                                  <p>类型：{item.table_type || 'GENERAL_TABLE'}，行列：{item.row_count || 0} x {item.column_count || 0}</p>
                                  <p>{item.summary || '无摘要'}</p>
                                </div>
                              ))}
                              {!wizardTableSummaries.length ? <div className="empty">暂无结构化表格</div> : null}
                            </div>
                          </article>

                          <article className="generate-match-card">
                            <div className="generate-check-head">
                              <h4>匹配样本 Top3</h4>
                              <span>已选 {wizardSelectedSampleSet.size} 条</span>
                            </div>
                            <div className="generate-match-list">
                              {wizardMatches.map((item) => (
                                <label className="generate-match-item" key={`match-${item.sample_id || item.id}`}>
                                  <input
                                    type="checkbox"
                                    checked={wizardSelectedSampleSet.has(Number(item.sample_id))}
                                    onChange={(e) => onToggleWizardSample(item.sample_id, e.target.checked)}
                                  />
                                  <div>
                                    <strong>{item.title || item.sample_title || item.sample_no || `样本${item.sample_id}`}</strong>
                                    <p>匹配分：{Number(item.score || 0).toFixed(1)} · 理由：{item.reason_text || item.reason || '-'}</p>
                                  </div>
                                </label>
                              ))}
                              {!wizardMatches.length ? <div className="empty">暂无匹配样本，系统将仅基于自有库生成</div> : null}
                            </div>
                            {generateWizard.analysis?.warnings?.length ? (
                              <div className="generate-warning-list">
                                {generateWizard.analysis.warnings.map((item, idx) => (
                                  <span key={`warn-${idx}`}>{item}</span>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        </div>

                        <aside className="generate-verify-right">
                          <article className="generate-source-card">
                            <div className="generate-check-head">
                              <h4>招标文件</h4>
                              <span>{wizardPreviewMode === 'text' ? '文本核对' : 'DOC 预览'}</span>
                            </div>
                            <div className="generate-source-stage">
                              {wizardPreviewMode === 'doc' ? (
                                docsApiReady ? (
                                  <div id={generateSourceEditorContainerId} className="generate-source-frame" />
                                ) : (
                                  <div className="generate-source-loading">文档预览加载中...</div>
                                )
                              ) : (
                                <pre className="generate-source-text">
                                  {wizardSourceTextPreview || '当前文件暂无可视化预览，已展示文本摘要用于核对。'}
                                </pre>
                              )}
                            </div>
                            <p className="muted">
                              当前文件：{firstNonEmpty(generateWizard.upload?.bidding_file?.name, generateWizard.analysis?.job?.source_file_name, '未命名文件')}
                            </p>
                          </article>
                        </aside>
                      </div>

                      <div className="generate-wizard-foot">
                        <button type="button" className="ghost" onClick={() => setGenerateWizard((prev) => ({ ...prev, step: 1 }))}>
                          返回分析
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => setGenerateWizard((prev) => ({ ...prev, step: 3 }))}
                          disabled={!wizardCanCreateDraft}
                        >
                          去生成初稿
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {generateWizard.step === 3 ? (
                    <div className="generate-step-panel">
                      <article className="generate-create-card">
                        <div className="generate-check-head">
                          <h4>确认生成参数</h4>
                          <span>将复用自有库 + 样本 + AI</span>
                        </div>
                        <div className="library-grid columns-2">
                          <label>
                            <span>标书标题</span>
                            <input
                              value={generateWizard.create_form.title}
                              onChange={(e) =>
                                setGenerateWizard((prev) => ({
                                  ...prev,
                                  create_form: { ...prev.create_form, title: e.target.value },
                                }))
                              }
                            />
                          </label>
                          <label>
                            <span>客户名称</span>
                            <input
                              value={generateWizard.create_form.customer_name}
                              onChange={(e) =>
                                setGenerateWizard((prev) => ({
                                  ...prev,
                                  create_form: { ...prev.create_form, customer_name: e.target.value },
                                }))
                              }
                            />
                          </label>
                          <label>
                            <span>项目名称</span>
                            <input
                              value={generateWizard.create_form.project_name}
                              onChange={(e) =>
                                setGenerateWizard((prev) => ({
                                  ...prev,
                                  create_form: { ...prev.create_form, project_name: e.target.value },
                                }))
                              }
                            />
                          </label>
                          <label>
                            <span>摘要</span>
                            <input
                              value={generateWizard.create_form.summary}
                              onChange={(e) =>
                                setGenerateWizard((prev) => ({
                                  ...prev,
                                  create_form: { ...prev.create_form, summary: e.target.value },
                                }))
                              }
                            />
                          </label>
                        </div>
                        <div className="generate-create-meta">
                          <span>分析任务：#{generateWizard.analysis?.job?.id || '-'}</span>
                          <span>招标类型：{wizardBidCategoryText}</span>
                          <span>已选样本：{wizardSelectedSampleSet.size} 个</span>
                          <span>当前模型：{models.find((item) => String(item.id) === String(generateWizard.model_id))?.name || '-'}</span>
                        </div>
                        <div className="generate-wizard-foot">
                          <button type="button" className="ghost" onClick={() => setGenerateWizard((prev) => ({ ...prev, step: 2 }))}>
                            返回核对
                          </button>
                          <button
                            type="button"
                            className="primary"
                            onClick={onConfirmGenerateDraft}
                            disabled={generateWizard.createBusy || wizardScoreTableBlocked}
                          >
                            {generateWizard.createBusy ? '生成中...' : '生成投标初稿'}
                          </button>
                        </div>
                      </article>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'library-samples' && (
          <section className="panel">
            <div className="panel-header"><h2>样本库管理</h2></div>
            <div className="panel-body">
              <div className="samples-page">
                <div className="samples-overview-grid">
                  <article className="samples-overview-card">
                    <span>样本总数</span>
                    <strong>{sampleSummary.total}</strong>
                  </article>
                  <article className="samples-overview-card">
                    <span>解析成功</span>
                    <strong>{sampleSummary.success}</strong>
                  </article>
                  <article className="samples-overview-card">
                    <span>待解析/处理中</span>
                    <strong>{sampleSummary.pending}</strong>
                  </article>
                  <article className="samples-overview-card">
                    <span>解析失败</span>
                    <strong>{sampleSummary.failed}</strong>
                  </article>
                </div>

                <div className="samples-toolbar">
                  <div className="samples-toolbar-left">
                    {canWrite ? (
                      <label className="ghost samples-btn">
                        上传样本
                        <input
                          key={`sample-upload-${sampleUploadInputSeed}`}
                          type="file"
                          accept=".doc,.docx,.pdf"
                          disabled={sampleUploadBusy}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) onUploadSampleFile(file)
                          }}
                        />
                      </label>
                    ) : null}
                    {canWrite ? (
                      <button
                        className="ghost samples-btn"
                        onClick={onBatchDeleteSamples}
                        disabled={!sampleSelectedIds.length}
                      >
                        批量删除
                      </button>
                    ) : null}
                    <span className="samples-selected-text">已选择 {sampleSelectedIds.length} 项</span>
                  </div>

                  <label className="samples-search-wrap">
                    <span className="samples-search-icon" aria-hidden="true" />
                    <input
                      className="samples-search"
                      value={sampleSearch}
                      onChange={(e) => setSampleSearch(e.target.value)}
                      placeholder="搜索样本编号 / 标题 / 文件名 / 状态"
                    />
                  </label>
                </div>

                <div className="samples-table-wrap">
                  <div className="samples-list-head">
                    <label className="samples-select-all">
                      <input
                        type="checkbox"
                        checked={sampleAllSelected}
                        onChange={(e) => onToggleSampleSelectAll(e.target.checked)}
                        disabled={!sampleFilteredRows.length}
                      />
                      <span>全选当前筛选结果</span>
                    </label>
                    <span className="muted">按更新时间倒序显示</span>
                  </div>

                  <div className="samples-list">
                    {samplePagedRows.map((item) => (
                      <article className="samples-item-card" key={item.id}>
                        <div className="samples-item-main">
                          <label className="samples-item-check">
                            <input
                              type="checkbox"
                              checked={sampleSelectedIdSet.has(Number(item.id))}
                              onChange={(e) => onToggleSampleSelect(item.id, e.target.checked)}
                            />
                          </label>
                          <div className="samples-item-content">
                            <div className="samples-item-top">
                              <strong className="samples-item-title" title={item.original_file_name || item.title || item.sample_no || '-'}>
                                {firstNonEmpty(item.original_file_name, item.title, item.sample_no, '-')}
                              </strong>
                              <span className={`samples-status-pill ${sampleParseStatusToneClass(item.parse_status)}`}>
                                {sampleParseStatusLabel(item.parse_status)}
                              </span>
                            </div>
                            <div className="samples-item-meta">
                              <span>编号 {item.sample_no || '-'}</span>
                              <span>标题 {item.title || '-'}</span>
                              <span>类型 {bidCategoryLabel(item.bid_category)}</span>
                              <span>更新时间 {formatDateTime(item.updated_at || item.created_at)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="samples-item-actions">
                          {canWrite ? <button className="ghost danger" onClick={() => onDeleteSample(item.id)}>删除</button> : null}
                        </div>
                      </article>
                    ))}
                    {!sampleFilteredRows.length ? <div className="empty samples-empty">暂无样本</div> : null}
                  </div>
                </div>

                <div className="list-pagination">
                  <span>共 {sampleTotal} 条</span>
                  <div className="list-page-nav">
                    <button className="ghost" onClick={() => setSamplePage(1)} disabled={normalizedSamplePage <= 1}>«</button>
                    <button className="ghost" onClick={() => setSamplePage((prev) => Math.max(1, prev - 1))} disabled={normalizedSamplePage <= 1}>‹</button>
                    <span className="list-page-current">{normalizedSamplePage}</span>
                    <button className="ghost" onClick={() => setSamplePage((prev) => Math.min(sampleTotalPages, prev + 1))} disabled={normalizedSamplePage >= sampleTotalPages}>›</button>
                    <button className="ghost" onClick={() => setSamplePage(sampleTotalPages)} disabled={normalizedSamplePage >= sampleTotalPages}>»</button>
                  </div>
                  <div className="list-page-size">
                    <span>每页</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={samplePageSize}
                      onChange={(e) => onChangeSamplePageSize(e.target.value)}
                    />
                    <span>条</span>
                  </div>
                  <div className="list-page-go">
                    <span>前往</span>
                    <input
                      type="number"
                      min={1}
                      max={sampleTotalPages}
                      value={sampleGotoPage}
                      onChange={(e) => setSampleGotoPage(e.target.value)}
                      onBlur={onJumpSamplePage}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onJumpSamplePage()
                      }}
                    />
                    <span>页</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'editor' && (
          <section className="panel">
            <div className="panel-header"><h2>在线编辑</h2></div>
            <div className="panel-body">
              {canWrite ? (
                <div className="editor-list-actions">
                  <label className="editor-select-all">
                    <input
                      type="checkbox"
                      checked={editorAllSelected}
                      onChange={(e) => onToggleEditorSelectAll(e.target.checked)}
                      disabled={!bids.length}
                    />
                    <span>全选</span>
                  </label>
                  <button
                    className="ghost"
                    onClick={() => onBatchDeleteBids('editor')}
                    disabled={!editorSelectedIds.length}
                  >
                    批量删除
                  </button>
                </div>
              ) : null}
              <div className="table">
                <div
                  className="table-row header"
                  style={{ gridTemplateColumns: canWrite ? '70px 1fr 0.8fr 1fr' : '1fr 0.8fr 0.8fr' }}
                >
                  {canWrite ? <span>选择</span> : null}
                  <span>标书</span>
                  <span>状态</span>
                  <span>操作</span>
                </div>
                {bids.map((item) => (
                  <div
                    className="table-row"
                    key={item.id}
                    style={{ gridTemplateColumns: canWrite ? '70px 1fr 0.8fr 1fr' : '1fr 0.8fr 0.8fr' }}
                  >
                    {canWrite ? (
                      <span>
                        <input
                          type="checkbox"
                          checked={editorSelectedIdSet.has(Number(item.id))}
                          onChange={(e) => onToggleEditorSelect(item.id, e.target.checked)}
                        />
                      </span>
                    ) : null}
                    <span>{item.bid_no} / {item.title}</span>
                    <span>{bidStatusLabel(item.status)}</span>
                    <span className="row-actions">
                      {canWrite ? (
                        <>
                          <button className="primary" onClick={() => onOpenEditor(item)}>打开协同</button>
                          <button className="ghost" onClick={() => onDeleteBid(item.id)}>删除</button>
                        </>
                      ) : <span className="muted">只读</span>}
                    </span>
                  </div>
                ))}
                {!bids.length ? <div className="empty">暂无标书</div> : null}
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
              <div className="qualification-toolbar">
                <div className="qualification-toolbar-left">
                  {canWrite ? (
                    <>
                      <button className="ghost qualification-btn" onClick={openCreateQualificationDialog}>新增</button>
                      <button
                        className="ghost qualification-btn"
                        onClick={onBatchDeleteQualifications}
                        disabled={!qualificationSelectedIds.length}
                      >
                        批量删除
                      </button>
                    </>
                  ) : null}
                </div>
                <label className="qualification-search-wrap">
                  <span className="qualification-search-icon" aria-hidden="true" />
                  <input
                    className="qualification-search"
                    value={qualificationSearch}
                    onChange={(e) => setQualificationSearch(e.target.value)}
                    placeholder="搜索文件、证书名称、证书编号"
                  />
                </label>
              </div>

              <div className="qualification-table-wrap">
                <div className="table">
                  <div className="table-row header qualification-row">
                    <span>
                      <input
                        type="checkbox"
                        checked={qualificationAllSelected}
                        onChange={(e) => onToggleQualificationSelectAll(e.target.checked)}
                        disabled={!qualificationRows.length}
                      />
                    </span>
                    <span>证书名称</span>
                    <span>证书编号</span>
                    <span>证书评级</span>
                    <span>证书有效期</span>
                    <span>操作</span>
                  </div>
                  {qualificationPagedRows.map((item) => (
                    <div className="table-row qualification-row" key={item.id}>
                      <span>
                        <input
                          type="checkbox"
                          checked={qualificationSelectedIdSet.has(Number(item.id))}
                          onChange={(e) => onToggleQualificationSelect(item.id, e.target.checked)}
                        />
                      </span>
                      <span>{item.certName}</span>
                      <span>{item.certNo}</span>
                      <span>{item.certLevel}</span>
                      <span>{item.validText}</span>
                      <span className="row-actions">
                        <a className="ghost" href={`${API_BASE}/api/tender/assets/${item.id}/preview`} target="_blank" rel="noreferrer">预览</a>
                        <a className="ghost" href={`${API_BASE}/api/tender/assets/${item.id}/download`} target="_blank" rel="noreferrer">下载</a>
                        {canWrite ? <button className="ghost" onClick={() => openEditQualificationDialog(item)}>编辑</button> : null}
                        {canWrite ? <button className="ghost" onClick={() => onDeleteQualification(item.id)}>删除</button> : null}
                      </span>
                    </div>
                  ))}
                  {!qualificationRows.length ? <div className="empty">暂无资质文件</div> : null}
                </div>
              </div>

              <div className="list-pagination">
                <span>共 {qualificationTotal} 条</span>
                <div className="list-page-nav">
                  <button className="ghost" onClick={() => setQualificationPage(1)} disabled={normalizedQualificationPage <= 1}>«</button>
                  <button className="ghost" onClick={() => setQualificationPage((prev) => Math.max(1, prev - 1))} disabled={normalizedQualificationPage <= 1}>‹</button>
                  <span className="list-page-current">{normalizedQualificationPage}</span>
                  <button className="ghost" onClick={() => setQualificationPage((prev) => Math.min(qualificationTotalPages, prev + 1))} disabled={normalizedQualificationPage >= qualificationTotalPages}>›</button>
                  <button className="ghost" onClick={() => setQualificationPage(qualificationTotalPages)} disabled={normalizedQualificationPage >= qualificationTotalPages}>»</button>
                </div>
                <div className="list-page-size">
                  <span>每页</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={qualificationPageSize}
                    onChange={(e) => onChangeQualificationPageSize(e.target.value)}
                  />
                  <span>条</span>
                </div>
                <div className="list-page-go">
                  <span>前往</span>
                  <input
                    type="number"
                    min={1}
                    max={qualificationTotalPages}
                    value={qualificationGotoPage}
                    onChange={(e) => setQualificationGotoPage(e.target.value)}
                    onBlur={onJumpQualificationPage}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onJumpQualificationPage()
                    }}
                  />
                  <span>页</span>
                </div>
              </div>

              {qualificationDialog.open ? (
                <div className="qualification-modal-mask" onClick={closeQualificationDialog}>
                  <section className="qualification-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="qualification-modal-head">
                      <h3>{qualificationDialog.assetId ? '编辑资质' : '新增资质'}</h3>
                      <button className="qualification-close" onClick={closeQualificationDialog}>×</button>
                    </div>

                    <div className="qualification-modal-body">
                      <div className="qualification-upload-area">
                        <div className="qualification-upload-tile">
                          <div className="qualification-upload-preview">
                            {qualificationDialog.localPreviewUrl ? (
                              <img src={qualificationDialog.localPreviewUrl} alt="资质证书预览" />
                            ) : qualificationDialog.remotePreviewUrl ? (
                              <img src={qualificationDialog.remotePreviewUrl} alt="资质证书预览" />
                            ) : (
                              <div className="qualification-upload-placeholder">
                                <span className="qualification-upload-plus">+</span>
                                <strong>点击上传</strong>
                                <span>仅支持 jpg/png/pdf，且不超过30MB</span>
                              </div>
                            )}
                          </div>
                          <label className="ghost qualification-upload-btn">
                            选择文件
                            <input
                              key={qualificationFileInputKey}
                              type="file"
                              accept=".jpg,.jpeg,.png,.pdf"
                              onChange={(e) => onPickQualificationFile(e.target.files?.[0] || null)}
                            />
                          </label>
                          <small className="muted">{qualificationDialog.fileName || '未选择文件'}</small>
                        </div>
                        <button className="ghost qualification-smart-btn" onClick={onSmartFillQualification} disabled={qualificationSmartFilling}>
                          {qualificationSmartFilling ? '识别中...' : '智能填充'}
                        </button>
                      </div>

                      <div className="qualification-form-grid">
                        <label>
                          <span><i>*</i>名称</span>
                          <div className="qualification-name-row">
                            {qualificationDialog.nameMode === 'custom' ? (
                              <input
                                value={qualificationDialog.customName}
                                placeholder="请输入证书名称"
                                onChange={(e) => setQualificationDialog((prev) => ({ ...prev, customName: e.target.value }))}
                              />
                            ) : (
                              <select
                                value={qualificationDialog.name}
                                onChange={(e) => setQualificationDialog((prev) => ({ ...prev, name: e.target.value }))}
                              >
                                <option value="">请选择证书名称</option>
                                {qualificationNameOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                              </select>
                            )}
                            <button
                              type="button"
                              className="ghost qualification-name-toggle"
                              onClick={() => setQualificationDialog((prev) => ({
                                ...prev,
                                nameMode: prev.nameMode === 'custom' ? 'select' : 'custom',
                              }))}
                            >
                              {qualificationDialog.nameMode === 'custom' ? '使用下拉' : '自定义'}
                            </button>
                          </div>
                        </label>

                        <div className="qualification-field">
                          <span><i>*</i>是否长期</span>
                          <div className="qualification-radio-row">
                            <div className="qualification-radio-option">
                              <input
                                type="radio"
                                name="qualification-validity"
                                checked={!qualificationDialog.validLongTerm}
                                onChange={() => setQualificationDialog((prev) => ({ ...prev, validLongTerm: false }))}
                              />
                              <span>有期限</span>
                            </div>
                            <div className="qualification-radio-option">
                              <input
                                type="radio"
                                name="qualification-validity"
                                checked={qualificationDialog.validLongTerm}
                                onChange={() => setQualificationDialog((prev) => ({ ...prev, validLongTerm: true, validTo: '' }))}
                              />
                              <span>长期</span>
                            </div>
                          </div>
                        </div>

                        <label>
                          <span><i>*</i>编号</span>
                          <input
                            value={qualificationDialog.certificateNo}
                            placeholder="请输入证书编号"
                            onChange={(e) => setQualificationDialog((prev) => ({ ...prev, certificateNo: e.target.value }))}
                          />
                        </label>

                        <label>
                          <span><i>*</i>有效期</span>
                          <div className="qualification-date-row">
                            <input
                              type="date"
                              value={qualificationDialog.validFrom}
                              onChange={(e) => setQualificationDialog((prev) => ({ ...prev, validFrom: e.target.value }))}
                            />
                            <input
                              type="date"
                              value={qualificationDialog.validTo}
                              disabled={qualificationDialog.validLongTerm}
                              onChange={(e) => setQualificationDialog((prev) => ({ ...prev, validTo: e.target.value }))}
                            />
                          </div>
                        </label>

                        <label>
                          <span><i>*</i>评级</span>
                          <select
                            value={qualificationDialog.level}
                            onChange={(e) => setQualificationDialog((prev) => ({ ...prev, level: e.target.value }))}
                          >
                            <option value="">请选择</option>
                            {qualificationLevelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="qualification-modal-foot">
                      <button className="primary qualification-save-btn" onClick={onSaveQualification} disabled={qualificationSaving}>
                        {qualificationSaving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {activeTab === 'library-finance' && (
          <section className="panel">
            <div className="panel-header"><h2>财务信息</h2></div>
            <div className="panel-body">
              <div className="finance-toolbar">
                <div className="finance-toolbar-left">
                  {canWrite ? (
                    <>
                      <button className="ghost finance-btn" onClick={openCreateFinanceDialog}>新增</button>
                      <button className="ghost finance-btn" onClick={onBatchDeleteFinance} disabled={!financeSelectedIds.length}>批量删除</button>
                    </>
                  ) : null}
                </div>
                <div className="finance-toolbar-right">
                  <button className="ghost finance-btn finance-analysis-btn" onClick={() => showMessage('近三年财务分析列表功能开发中')}>
                    近三年财务分析列表
                  </button>
                  <label className="finance-search-wrap">
                    <span className="finance-search-icon" aria-hidden="true" />
                    <input
                      className="finance-search"
                      value={financeSearch}
                      onChange={(e) => setFinanceSearch(e.target.value)}
                      placeholder="搜索文件..."
                    />
                  </label>
                </div>
              </div>

              <div className="finance-table-wrap">
                <div className="table">
                  <div className="table-row header finance-row">
                    <span>
                      <input
                        type="checkbox"
                        checked={financeAllSelected}
                        onChange={(e) => onToggleFinanceSelectAll(e.target.checked)}
                        disabled={!financeRows.length}
                      />
                    </span>
                    <span>信息名称</span>
                    <span className="finance-sort-head">信息类型 <em>⌄</em></span>
                    <span>信息时间</span>
                    <span>操作</span>
                  </div>
                  {financePagedRows.map((item) => (
                    <div className="table-row finance-row" key={item.id}>
                      <span>
                        <input
                          type="checkbox"
                          checked={financeSelectedIdSet.has(Number(item.id))}
                          onChange={(e) => onToggleFinanceSelect(item.id, e.target.checked)}
                        />
                      </span>
                      <span>{item.infoName}</span>
                      <span>{item.infoType}</span>
                      <span>{item.infoDate}</span>
                      <span className="row-actions">
                        <a className="ghost" href={`${API_BASE}/api/tender/assets/${item.id}/preview`} target="_blank" rel="noreferrer">预览</a>
                        <a className="ghost" href={`${API_BASE}/api/tender/assets/${item.id}/download`} target="_blank" rel="noreferrer">下载</a>
                        {canWrite ? <button className="ghost" onClick={() => openEditFinanceDialog(item)}>编辑</button> : null}
                        {canWrite ? <button className="ghost" onClick={() => onDeleteFinance(item.id)}>删除</button> : null}
                      </span>
                    </div>
                  ))}
                  {!financeRows.length ? <div className="empty finance-empty">暂无数据</div> : null}
                </div>
              </div>

              <div className="list-pagination">
                <span>共 {financeTotal} 条</span>
                <div className="list-page-nav">
                  <button className="ghost" onClick={() => setFinancePage(1)} disabled={normalizedFinancePage <= 1}>«</button>
                  <button className="ghost" onClick={() => setFinancePage((prev) => Math.max(1, prev - 1))} disabled={normalizedFinancePage <= 1}>‹</button>
                  <span className="list-page-current">{normalizedFinancePage}</span>
                  <button className="ghost" onClick={() => setFinancePage((prev) => Math.min(financeTotalPages, prev + 1))} disabled={normalizedFinancePage >= financeTotalPages}>›</button>
                  <button className="ghost" onClick={() => setFinancePage(financeTotalPages)} disabled={normalizedFinancePage >= financeTotalPages}>»</button>
                </div>
                <div className="list-page-size">
                  <span>每页</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={financePageSize}
                    onChange={(e) => onChangeFinancePageSize(e.target.value)}
                  />
                  <span>条</span>
                </div>
                <div className="list-page-go">
                  <span>前往</span>
                  <input
                    type="number"
                    min={1}
                    max={financeTotalPages}
                    value={financeGotoPage}
                    onChange={(e) => setFinanceGotoPage(e.target.value)}
                    onBlur={onJumpFinancePage}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onJumpFinancePage()
                    }}
                  />
                  <span>页</span>
                </div>
              </div>

              {financeDialog.open ? (
                <div className="finance-modal-mask" onClick={closeFinanceDialog}>
                  <section className="finance-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="finance-modal-head">
                      <h3>{financeDialog.assetId ? '编辑财务信息' : '新增财务信息'}</h3>
                      <button className="finance-close" onClick={closeFinanceDialog}>×</button>
                    </div>

                    <div className="finance-modal-body">
                      <div className="finance-form-grid">
                        <label>
                          <span><i>*</i>信息类型</span>
                          <select
                            value={financeDialog.infoType}
                            onChange={(e) => setFinanceDialog((prev) => ({ ...prev, infoType: e.target.value }))}
                          >
                            <option value="">请选择信息类型</option>
                            {financeInfoTypeOptions.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span><i>*</i>信息时间</span>
                          <input
                            type="date"
                            value={financeDialog.infoDate}
                            onChange={(e) => setFinanceDialog((prev) => ({ ...prev, infoDate: e.target.value }))}
                          />
                        </label>
                        <label className="finance-span-all">
                          <span><i>*</i>信息名称</span>
                          <input
                            value={financeDialog.infoName}
                            placeholder="请输入信息名称"
                            onChange={(e) => setFinanceDialog((prev) => ({ ...prev, infoName: e.target.value }))}
                          />
                        </label>
                        <div className="finance-span-all finance-upload-field">
                          <span><i>*</i>信息照片</span>
                          <div className="finance-upload-tile">
                            <div className="finance-upload-preview">
                              {financeDialog.localPreviewUrl ? (
                                <img src={financeDialog.localPreviewUrl} alt="财务信息预览" />
                              ) : financeDialog.remotePreviewUrl ? (
                                <img src={financeDialog.remotePreviewUrl} alt="财务信息预览" />
                              ) : (
                                <div className="finance-upload-placeholder">
                                  <span className="finance-upload-plus">+</span>
                                  <strong>点击上传</strong>
                                  <span>仅支持 jpg/png/pdf 文件，且不超过30MB</span>
                                </div>
                              )}
                            </div>
                            <label className="ghost finance-upload-btn">
                              选择文件
                              <input
                                key={financeFileInputKey}
                                type="file"
                                accept=".jpg,.jpeg,.png,.pdf"
                                onChange={(e) => onPickFinanceFile(e.target.files?.[0] || null)}
                              />
                            </label>
                            <small className="muted">{financeDialog.fileName || '未选择文件'}</small>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="finance-modal-foot">
                      <button className="primary finance-save-btn" onClick={onSaveFinance} disabled={financeSaving}>
                        {financeSaving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {activeTab === 'library-performance' && (
          <section className="panel">
            <div className="panel-header"><h2>业绩管理</h2></div>
            <div className="panel-body">
              <div className="performance-toolbar">
                <div className="performance-toolbar-left">
                  {canWrite ? (
                    <>
                      <button className="ghost performance-btn" onClick={openCreatePerformanceDialog}>新增</button>
                      <button className="ghost performance-btn" onClick={onBatchDeletePerformance} disabled={!performanceSelectedIds.length}>
                        批量删除
                      </button>
                    </>
                  ) : null}
                </div>
                <label className="performance-search-wrap">
                  <span className="performance-search-icon" aria-hidden="true" />
                  <input
                    className="performance-search"
                    value={performanceSearch}
                    onChange={(e) => setPerformanceSearch(e.target.value)}
                    placeholder="搜索文件..."
                  />
                </label>
              </div>

              <div className="performance-table-wrap">
                <div className="table">
                  <div className="table-row header performance-row">
                    <span>
                      <input
                        type="checkbox"
                        checked={performanceAllSelected}
                        onChange={(e) => onTogglePerformanceSelectAll(e.target.checked)}
                        disabled={!performanceRows.length}
                      />
                    </span>
                    <span>项目名称</span>
                    <span className="performance-sort-head">项目类型 <em>⌄</em></span>
                    <span>甲方名称</span>
                    <span>项目金额（万元）</span>
                    <span>合同起止时间</span>
                    <span>操作</span>
                  </div>
                  {performancePagedRows.map((item) => (
                    <div className="table-row performance-row" key={item.id}>
                      <span>
                        <input
                          type="checkbox"
                          checked={performanceSelectedIdSet.has(Number(item.id))}
                          onChange={(e) => onTogglePerformanceSelect(item.id, e.target.checked)}
                        />
                      </span>
                      <span>{item.project_name || '-'}</span>
                      <span>{item.project_type || '-'}</span>
                      <span>{item.party_a_name || '-'}</span>
                      <span>{item.project_amount || '-'}</span>
                      <span>{`${item.contract_valid_from || '-'} 至 ${item.contract_valid_to || '-'}`}</span>
                      <span className="row-actions">
                        {canWrite ? <button className="ghost" onClick={() => openEditPerformanceDialog(item)}>编辑</button> : null}
                        {canWrite ? <button className="ghost" onClick={() => onDeletePerformance(item.id)}>删除</button> : null}
                      </span>
                    </div>
                  ))}
                  {!performanceRows.length ? <div className="empty performance-empty">暂无数据</div> : null}
                </div>
              </div>

              <div className="performance-pagination">
                <span>共 {performanceTotal} 条</span>
                <div className="performance-page-nav">
                  <button className="ghost" onClick={() => setPerformancePage(1)} disabled={normalizedPerformancePage <= 1}>«</button>
                  <button className="ghost" onClick={() => setPerformancePage((prev) => Math.max(1, prev - 1))} disabled={normalizedPerformancePage <= 1}>‹</button>
                  <span className="performance-page-current">{normalizedPerformancePage}</span>
                  <button className="ghost" onClick={() => setPerformancePage((prev) => Math.min(performanceTotalPages, prev + 1))} disabled={normalizedPerformancePage >= performanceTotalPages}>›</button>
                  <button className="ghost" onClick={() => setPerformancePage(performanceTotalPages)} disabled={normalizedPerformancePage >= performanceTotalPages}>»</button>
                </div>
                <div className="performance-page-size">
                  <span>每页</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={performancePageSize}
                    onChange={(e) => onChangePerformancePageSize(e.target.value)}
                  />
                  <span>条</span>
                </div>
                <div className="performance-page-go">
                  <span>前往</span>
                  <input
                    type="number"
                    min={1}
                    max={performanceTotalPages}
                    value={performanceGotoPage}
                    onChange={(e) => setPerformanceGotoPage(e.target.value)}
                    onBlur={onJumpPerformancePage}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onJumpPerformancePage()
                    }}
                  />
                  <span>页</span>
                </div>
              </div>

              {performanceDialog.open ? (
                <div className="performance-modal-mask" onClick={closePerformanceDialog}>
                  <section className="performance-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="performance-modal-head">
                      <h3>{performanceDialog.itemId ? '编辑业绩信息' : '新增业绩信息'}</h3>
                      <button className="performance-close" onClick={closePerformanceDialog}>×</button>
                    </div>

                    <div className="performance-modal-body">
                      <div className="performance-form-grid">
                        <label>
                          <span><i>*</i>项目名称</span>
                          <input
                            value={performanceDialog.project_name}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, project_name: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span>项目编号</span>
                          <input
                            value={performanceDialog.project_no}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, project_no: e.target.value }))}
                          />
                        </label>
                        <label className="performance-span-tall">
                          <span><i>*</i>项目内容</span>
                          <textarea
                            value={performanceDialog.project_content}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, project_content: e.target.value }))}
                          />
                        </label>

                        <label>
                          <span><i>*</i>项目类型</span>
                          <select
                            value={performanceDialog.project_type}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, project_type: e.target.value }))}
                          >
                            <option value="">请选择</option>
                            {performanceProjectTypeOptions.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>项目包号</span>
                          <input
                            value={performanceDialog.package_no}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, package_no: e.target.value }))}
                          />
                        </label>

                        <label>
                          <span><i>*</i>甲方名称</span>
                          <input
                            value={performanceDialog.party_a_name}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, party_a_name: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span><i>*</i>甲方类型</span>
                          <select
                            value={performanceDialog.party_a_type}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, party_a_type: e.target.value }))}
                          >
                            <option value="">请选择</option>
                            {performancePartyTypeOptions.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span><i>*</i>项目金额</span>
                          <div className="performance-money-field">
                            <input
                              value={performanceDialog.project_amount}
                              onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, project_amount: e.target.value }))}
                            />
                            <em>万元</em>
                          </div>
                        </label>
                        <label>
                          <span>项目负责人</span>
                          <input
                            value={performanceDialog.project_leader}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, project_leader: e.target.value }))}
                          />
                        </label>

                        <label>
                          <span>甲方联系人</span>
                          <input
                            value={performanceDialog.contact_phone}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, contact_phone: e.target.value }))}
                          />
                        </label>
                        <label className="performance-span-wide">
                          <span>备注</span>
                          <input
                            value={performanceDialog.remark}
                            onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, remark: e.target.value }))}
                          />
                        </label>

                        <label className="performance-span-wide">
                          <span><i>*</i>合同有效期</span>
                          <div className="performance-date-row">
                            <input
                              type="date"
                              value={performanceDialog.contract_valid_from}
                              onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, contract_valid_from: e.target.value }))}
                            />
                            <input
                              type="date"
                              value={performanceDialog.contract_valid_to}
                              onChange={(e) => setPerformanceDialog((prev) => ({ ...prev, contract_valid_to: e.target.value }))}
                            />
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="performance-modal-foot">
                      <button className="primary performance-save-btn" onClick={onSavePerformance} disabled={performanceSaving}>
                        {performanceSaving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {activeTab === 'library-personnel' && (
          <section className="panel">
            <div className="panel-header"><h2>人员管理</h2></div>
            <div className="panel-body">
              <div className="personnel-toolbar">
                <div className="personnel-toolbar-left">
                  {canWrite ? (
                    <>
                      <button className="ghost personnel-btn" onClick={openCreateStaffDialog}>新增</button>
                      <button className="ghost personnel-btn" onClick={onBatchDeleteStaff} disabled={!staffSelectedIds.length}>
                        批量删除
                      </button>
                    </>
                  ) : null}
                </div>
                <label className="personnel-search-wrap">
                  <span className="personnel-search-icon" aria-hidden="true" />
                  <input
                    className="personnel-search"
                    value={staffSearch}
                    onChange={(e) => setStaffSearch(e.target.value)}
                    placeholder="搜索文件..."
                  />
                </label>
              </div>

              <div className="personnel-table-wrap">
                <div className="table">
                  <div className="table-row header personnel-row">
                    <span>
                      <input
                        type="checkbox"
                        checked={staffAllSelected}
                        onChange={(e) => onToggleStaffSelectAll(e.target.checked)}
                        disabled={!staffRows.length}
                      />
                    </span>
                    <span>姓名</span>
                    <span>性别</span>
                    <span>年龄</span>
                    <span>学历</span>
                    <span>职位</span>
                    <span>专业</span>
                    <span>资格证书</span>
                    <span>操作</span>
                  </div>
                  {staffPagedRows.map((item) => (
                    <div className="table-row personnel-row" key={item.id}>
                      <span>
                        <input
                          type="checkbox"
                          checked={staffSelectedIdSet.has(Number(item.id))}
                          onChange={(e) => onToggleStaffSelect(item.id, e.target.checked)}
                        />
                      </span>
                      <span>{item.name || '-'}</span>
                      <span>{item.gender || '-'}</span>
                      <span>{item.age || '-'}</span>
                      <span>{item.education || '-'}</span>
                      <span>{item.position || '-'}</span>
                      <span>{item.major || '-'}</span>
                      <span>{item.certificateText || '-'}</span>
                      <span className="row-actions">
                        {canWrite ? <button className="ghost" onClick={() => openEditStaffDialog(item)}>编辑</button> : null}
                        {canWrite ? <button className="ghost" onClick={() => onDeleteStaff(item.id)}>删除</button> : null}
                      </span>
                    </div>
                  ))}
                  {!staffRows.length ? <div className="empty personnel-empty">暂无数据</div> : null}
                </div>
              </div>

              <div className="list-pagination">
                <span>共 {staffTotal} 条</span>
                <div className="list-page-nav">
                  <button className="ghost" onClick={() => setStaffPage(1)} disabled={normalizedStaffPage <= 1}>«</button>
                  <button className="ghost" onClick={() => setStaffPage((prev) => Math.max(1, prev - 1))} disabled={normalizedStaffPage <= 1}>‹</button>
                  <span className="list-page-current">{normalizedStaffPage}</span>
                  <button className="ghost" onClick={() => setStaffPage((prev) => Math.min(staffTotalPages, prev + 1))} disabled={normalizedStaffPage >= staffTotalPages}>›</button>
                  <button className="ghost" onClick={() => setStaffPage(staffTotalPages)} disabled={normalizedStaffPage >= staffTotalPages}>»</button>
                </div>
                <div className="list-page-size">
                  <span>每页</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={staffPageSize}
                    onChange={(e) => onChangeStaffPageSize(e.target.value)}
                  />
                  <span>条</span>
                </div>
                <div className="list-page-go">
                  <span>前往</span>
                  <input
                    type="number"
                    min={1}
                    max={staffTotalPages}
                    value={staffGotoPage}
                    onChange={(e) => setStaffGotoPage(e.target.value)}
                    onBlur={onJumpStaffPage}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onJumpStaffPage()
                    }}
                  />
                  <span>页</span>
                </div>
              </div>

              {staffDialog.open ? (
                <div className="personnel-modal-mask" onClick={closeStaffDialog}>
                  <section className="personnel-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="personnel-modal-head">
                      <h3>{staffDialog.itemId ? '编辑人员' : '新增人员'}</h3>
                      <button className="personnel-close" onClick={closeStaffDialog}>×</button>
                    </div>

                    <div className="personnel-modal-body">
                      <div className="personnel-upload-grid">
                        {staffAttachmentMeta.map((meta) => {
                          const slot = staffDialog[meta.key] || createStaffAttachment()
                          return (
                            <div className="personnel-upload-item" key={meta.key}>
                              <span>{meta.required ? <i>*</i> : null}{meta.label}</span>
                              <div className="personnel-upload-tile">
                                <div className="personnel-upload-preview">
                                  {slot.previewUrl ? (
                                    <img src={slot.previewUrl} alt={`${meta.label}预览`} />
                                  ) : (
                                    <div className="personnel-upload-placeholder">
                                      <span className="personnel-upload-plus">+</span>
                                      <strong>点击上传</strong>
                                      <span>仅支持jpg/png/pdf文件，且不超过30MB</span>
                                    </div>
                                  )}
                                </div>
                                <div className="personnel-upload-actions">
                                  <label className="ghost personnel-upload-btn">
                                    选择文件
                                    <input
                                      type="file"
                                      accept={meta.accept}
                                      onChange={(e) => onPickStaffAttachment(meta.key, e.target.files?.[0] || null)}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() => onDeleteStaffAttachment(meta.key)}
                                    disabled={!slot.file && !slot.assetId && !slot.previewUrl}
                                  >
                                    删除
                                  </button>
                                </div>
                                <small className="muted">{slot.fileName || slot.file?.name || '未选择文件'}</small>
                              </div>
                            </div>
                          )
                        })}

                        <div className="personnel-smart-cell">
                          <button className="ghost personnel-smart-btn" onClick={onSmartFillStaff} disabled={staffSmartFilling}>
                            {staffSmartFilling ? '识别中...' : '智能填充'}
                          </button>
                        </div>
                      </div>

                      <div className="personnel-form-grid">
                        <label>
                          <span><i>*</i>姓名</span>
                          <input
                            value={staffDialog.name}
                            placeholder="请输入名称"
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, name: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span><i>*</i>性别</span>
                          <select
                            value={staffDialog.gender}
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, gender: e.target.value }))}
                          >
                            <option value="">请选择</option>
                            <option value="男">男</option>
                            <option value="女">女</option>
                          </select>
                        </label>
                        <label>
                          <span><i>*</i>生日</span>
                          <input
                            type="date"
                            value={staffDialog.birth_date}
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, birth_date: e.target.value }))}
                          />
                        </label>

                        <label>
                          <span><i>*</i>身份证号</span>
                          <input
                            value={staffDialog.id_no}
                            placeholder="请输入身份证号"
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, id_no: e.target.value }))}
                          />
                        </label>
                        <div className="personnel-validity-field">
                          <span><i>*</i>是否长期</span>
                          <div className="personnel-validity-options">
                            <label>
                              <input
                                type="radio"
                                name="staff-id-validity"
                                checked={!staffDialog.id_long_term}
                                onChange={() => setStaffDialog((prev) => ({ ...prev, id_long_term: false }))}
                              />
                              有期限
                            </label>
                            <label>
                              <input
                                type="radio"
                                name="staff-id-validity"
                                checked={staffDialog.id_long_term}
                                onChange={() => setStaffDialog((prev) => ({ ...prev, id_long_term: true, id_valid_to: '' }))}
                              />
                              长期
                            </label>
                          </div>
                        </div>
                        <label className="personnel-span-two">
                          <span><i>*</i>身份证有效期</span>
                          <div className="personnel-date-row">
                            <input
                              type="date"
                              value={staffDialog.id_valid_from}
                              onChange={(e) => setStaffDialog((prev) => ({ ...prev, id_valid_from: e.target.value }))}
                            />
                            <input
                              type="date"
                              value={staffDialog.id_valid_to}
                              disabled={staffDialog.id_long_term}
                              onChange={(e) => setStaffDialog((prev) => ({ ...prev, id_valid_to: e.target.value }))}
                            />
                          </div>
                        </label>

                        <label>
                          <span>学历</span>
                          <select
                            value={staffDialog.education}
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, education: e.target.value }))}
                          >
                            <option value="">请选择</option>
                            {personnelEducationOptions.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>专业</span>
                          <input
                            value={staffDialog.major}
                            placeholder="请输入专业"
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, major: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span>职称</span>
                          <input
                            value={staffDialog.job_title}
                            placeholder="请输入职称"
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, job_title: e.target.value }))}
                          />
                        </label>

                        <label>
                          <span>职位</span>
                          <select
                            value={staffDialog.position}
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, position: e.target.value }))}
                          >
                            <option value="">请选择</option>
                            {personnelPositionOptions.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>联系电话</span>
                          <input
                            value={staffDialog.contact_phone}
                            placeholder="请输入联系电话"
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, contact_phone: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span>状态</span>
                          <select
                            value={staffDialog.status}
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, status: e.target.value }))}
                          >
                            {personnelStatusOptions.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>开始工作时间</span>
                          <input
                            type="date"
                            value={staffDialog.start_work_date}
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, start_work_date: e.target.value }))}
                          />
                        </label>
                        <label className="personnel-span-two">
                          <span>资格证书</span>
                          <input
                            value={staffDialog.qualification_cert}
                            placeholder="请输入资格证书名称"
                            onChange={(e) => setStaffDialog((prev) => ({ ...prev, qualification_cert: e.target.value }))}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="personnel-modal-foot">
                      <button className="primary personnel-save-btn" onClick={onSaveStaff} disabled={staffSaving}>
                        {staffSaving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
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
              {canConfigManage ? (
                <>
                  <h3 style={{ margin: '18px 0 8px' }}>投标模板配置</h3>
                  <div className="article-create" style={{ gridTemplateColumns: '1fr 1fr auto auto auto', alignItems: 'center', marginBottom: 10 }}>
                    <input
                      placeholder="模板名称（例如：服务类标准模板）"
                      value={docTemplateUploadName}
                      onChange={(e) => setDocTemplateUploadName(e.target.value)}
                    />
                    <label className="ghost" style={{ minHeight: 42, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      选择模板文件
                      <input
                        key={docTemplateInputKey}
                        type="file"
                        accept=".docx"
                        style={{ display: 'none' }}
                        onChange={(e) => setDocTemplateUploadFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <span className="muted">{docTemplateUploadFile?.name || '未选择文件'}</span>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' }}>
                      <input
                        type="checkbox"
                        checked={docTemplateSetDefault}
                        onChange={(e) => setDocTemplateSetDefault(e.target.checked)}
                      />
                      设为默认
                    </label>
                    <button className="primary" onClick={onUploadDocTemplate} disabled={docTemplateUploadBusy}>
                      {docTemplateUploadBusy ? '上传中...' : '上传模板'}
                    </button>
                  </div>
                  <div className="muted" style={{ marginBottom: 8, lineHeight: 1.75 }}>
                    建议模板中使用占位符（可直接控制样式、章节和映射位置）：
                    <br />
                    基础信息：
                    {' '}
                    <code>{'{{PROJECT_NAME}}'}</code>
                    {' '}
                    <code>{'{{PROJECT_CODE}}'}</code>
                    {' '}
                    <code>{'{{PACKAGE_NO}}'}</code>
                    {' '}
                    <code>{'{{BID_NO}}'}</code>
                    {' '}
                    <code>{'{{PROJECT_TITLE}}'}</code>
                    {' '}
                    <code>{'{{GENERATED_AT}}'}</code>
                    <br />
                    正文骨架：
                    {' '}
                    <code>{'{{COVER_CONTENT}}'}</code>
                    {' '}
                    <code>{'{{TOC_CONTENT}}'}</code>
                    {' '}
                    <code>{'{{BID_CONTENT}}'}</code>
                    {' '}
                    <code>{'{{BUSINESS_VOLUME_CONTENT}}'}</code>
                    {' '}
                    <code>{'{{TECHNICAL_VOLUME_CONTENT}}'}</code>
                    {' '}
                    <code>{'{{QUOTATION_VOLUME_CONTENT}}'}</code>
                    {' '}
                    <code>{'{{APPENDIX_INDEX_CONTENT}}'}</code>
                    <br />
                    自有库映射：
                    {' '}
                    <code>{'{{COMPANY_INFO}}'}</code>
                    {' '}
                    <code>{'{{LEGAL_PERSON_INFO}}'}</code>
                    {' '}
                    <code>{'{{AUTHORIZED_AGENT_INFO}}'}</code>
                    {' '}
                    <code>{'{{QUALIFICATION_INFO}}'}</code>
                    {' '}
                    <code>{'{{PERSONNEL_INFO}}'}</code>
                    {' '}
                    <code>{'{{PERFORMANCE_INFO}}'}</code>
                    {' '}
                    <code>{'{{FINANCE_INFO}}'}</code>
                    <br />
                    说明：模板里放置正文占位符后，系统会按你模板样式生成（字体、标题层级、行距、页眉页脚、分页均由模板控制）。
                  </div>
                  <div className="table" style={{ marginTop: 8 }}>
                    <div className="table-row header" style={{ gridTemplateColumns: '1fr 0.7fr 1fr 0.7fr 0.9fr' }}>
                      <span>模板名称</span>
                      <span>默认</span>
                      <span>原文件</span>
                      <span>状态</span>
                      <span>操作</span>
                    </div>
                    {docTemplates.map((item) => (
                      <div className="table-row" key={item.id} style={{ gridTemplateColumns: '1fr 0.7fr 1fr 0.7fr 0.9fr' }}>
                        <span>{item.template_name}</span>
                        <span>{item.is_default ? '是' : '否'}</span>
                        <span>{item.original_file_name}</span>
                        <span>{String(item.status || '').toUpperCase() === 'ACTIVE' ? '启用' : '停用'}</span>
                        <span className="row-actions">
                          {!item.is_default ? <button className="ghost" onClick={() => onSetDefaultDocTemplate(item.id)}>设为默认</button> : null}
                          <button className="ghost" onClick={() => onDeleteDocTemplate(item.id)}>删除</button>
                        </span>
                      </div>
                    ))}
                    {!docTemplates.length ? <div className="empty">暂无投标模板</div> : null}
                  </div>
                </>
              ) : null}
              {canAiManage ? (
                <>
                  <h3 style={{ margin: '18px 0 8px' }}>模型配置</h3>
                  <div className="article-create model-create-grid">
                    <input placeholder="显示名" value={modelForm.name} onChange={(e) => setModelForm((p) => ({ ...p, name: e.target.value }))} />
                    <input placeholder="model_key" value={modelForm.model_key} onChange={(e) => setModelForm((p) => ({ ...p, model_key: e.target.value }))} />
                    <input placeholder="base_url" value={modelForm.base_url} onChange={(e) => setModelForm((p) => ({ ...p, base_url: e.target.value }))} />
                    <input placeholder="model_name" value={modelForm.model_name} onChange={(e) => setModelForm((p) => ({ ...p, model_name: e.target.value }))} />
                    <input placeholder="api_key" value={modelForm.api_key} onChange={(e) => setModelForm((p) => ({ ...p, api_key: e.target.value }))} />
                    <input placeholder="timeout_ms" value={modelForm.timeout_ms} onChange={(e) => setModelForm((p) => ({ ...p, timeout_ms: e.target.value }))} />
                    <input placeholder="max_tokens" value={modelForm.max_tokens} onChange={(e) => setModelForm((p) => ({ ...p, max_tokens: e.target.value }))} />
                    <input placeholder="temperature" value={modelForm.temperature_default} onChange={(e) => setModelForm((p) => ({ ...p, temperature_default: e.target.value }))} />
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' }}>
                      <input
                        type="checkbox"
                        checked={!!modelForm.is_enabled}
                        onChange={(e) => setModelForm((p) => ({ ...p, is_enabled: e.target.checked }))}
                      />
                      启用
                    </label>
                    <button className="ghost" onClick={onTestCreateModel} disabled={modelCreateTesting || modelCreateSaving}>
                      {modelCreateTesting ? '测试中...' : '测试可用'}
                    </button>
                    <button className="primary" onClick={onCreateCustomModel} disabled={modelCreateSaving || modelCreateTesting}>
                      {modelCreateSaving ? '保存中...' : '新增'}
                    </button>
                    <div
                      className={`model-test-feedback model-create-feedback${modelCreateTestFeedback.type ? ` is-${modelCreateTestFeedback.type}` : ''}`}
                    >
                      {modelCreateTestFeedback.text || '点击“测试可用”可校验当前配置是否可用'}
                    </div>
                  </div>
                  <div className="article-create" style={{ gridTemplateColumns: '1fr', marginTop: -2, marginBottom: 8 }}>
                    <textarea
                      placeholder={'extra_headers(JSON，可选) 例如：{"Authorization":"Bearer xxx"}'}
                      value={modelForm.extra_headers_text}
                      onChange={(e) => setModelForm((p) => ({ ...p, extra_headers_text: e.target.value }))}
                      style={{ minHeight: 72 }}
                    />
                  </div>

                  <div className="table" style={{ marginTop: 12 }}>
                    <div className="table-row header" style={{ gridTemplateColumns: '1fr 0.8fr 1fr 1fr 0.6fr 0.8fr 1.3fr' }}>
                      <span>名称</span>
                      <span>key</span>
                      <span>base_url</span>
                      <span>model</span>
                      <span>默认</span>
                      <span>启用</span>
                      <span>操作</span>
                    </div>
                    {models.map((item) => (
                      <div className="table-row" key={item.id} style={{ gridTemplateColumns: '1fr 0.8fr 1fr 1fr 0.6fr 0.8fr 1.3fr' }}>
                        <span>{item.name}</span>
                        <span>{item.model_key}</span>
                        <span>{item.base_url}</span>
                        <span>{item.model_name}</span>
                        <span>{item.is_default ? '是' : '否'}</span>
                        <span>{item.is_enabled ? '是' : '否'}</span>
                        <span className="row-actions model-row-actions">
                          <button className="ghost" onClick={() => onTestSavedModel(item.id)} disabled={!!modelRowTesting[item.id]}>
                            {modelRowTesting[item.id] ? '测试中...' : '测试'}
                          </button>
                          <button className="ghost" onClick={() => openModelEditDialog(item)}>编辑</button>
                          <button className="ghost" onClick={() => onDeleteModel(item.id)}>删除</button>
                          {!item.is_default ? <button className="ghost" onClick={() => onSetDefaultModel(item.id)}>设为默认</button> : null}
                          {modelRowTestFeedback[item.id]?.text ? (
                            <small
                              className={`model-test-feedback inline${modelRowTestFeedback[item.id]?.type ? ` is-${modelRowTestFeedback[item.id].type}` : ''}`}
                            >
                              {modelRowTestFeedback[item.id].text}
                            </small>
                          ) : null}
                        </span>
                      </div>
                    ))}
                    {!models.length ? <div className="empty">暂无模型</div> : null}
                  </div>
                </>
              ) : null}
            </div>
          </section>
        )}
      </main>

      {modelEditDialog.open ? (
        <div className="model-edit-modal-mask" onClick={closeModelEditDialog}>
          <section className="model-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="model-edit-modal-head">
              <h3>编辑模型配置</h3>
              <button className="model-edit-close" onClick={closeModelEditDialog}>×</button>
            </div>
            <div className="model-edit-modal-body">
              <div className="model-edit-form-grid">
                <label>
                  <span>显示名</span>
                  <input
                    value={modelEditDialog.form.name}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, name: e.target.value } }))}
                  />
                </label>
                <label>
                  <span>model_key（只读）</span>
                  <input value={modelEditDialog.form.model_key} disabled />
                </label>
                <label>
                  <span>provider_type</span>
                  <input
                    value={modelEditDialog.form.provider_type}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, provider_type: e.target.value } }))}
                  />
                </label>
                <label>
                  <span>base_url</span>
                  <input
                    value={modelEditDialog.form.base_url}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, base_url: e.target.value } }))}
                  />
                </label>
                <label>
                  <span>model_name</span>
                  <input
                    value={modelEditDialog.form.model_name}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, model_name: e.target.value } }))}
                  />
                </label>
                <label>
                  <span>api_key（不改可留空）</span>
                  <input
                    type="password"
                    value={modelEditDialog.form.api_key}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, api_key: e.target.value } }))}
                    placeholder="留空表示不变更"
                  />
                </label>
                <label>
                  <span>timeout_ms</span>
                  <input
                    value={modelEditDialog.form.timeout_ms}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, timeout_ms: e.target.value } }))}
                  />
                </label>
                <label>
                  <span>max_tokens</span>
                  <input
                    value={modelEditDialog.form.max_tokens}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, max_tokens: e.target.value } }))}
                  />
                </label>
                <label>
                  <span>temperature</span>
                  <input
                    value={modelEditDialog.form.temperature_default}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, temperature_default: e.target.value } }))}
                  />
                </label>
                <label className="model-edit-enable">
                  <span>启用状态</span>
                  <div>
                    <input
                      type="checkbox"
                      checked={!!modelEditDialog.form.is_enabled}
                      onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, is_enabled: e.target.checked } }))}
                    />
                    <strong>{modelEditDialog.form.is_enabled ? '启用' : '停用'}</strong>
                  </div>
                </label>
                <label className="model-edit-span-all">
                  <span>extra_headers(JSON，可选)</span>
                  <textarea
                    value={modelEditDialog.form.extra_headers_text}
                    onChange={(e) => setModelEditDialog((prev) => ({ ...prev, form: { ...prev.form, extra_headers_text: e.target.value } }))}
                    placeholder='例如：{"Authorization":"Bearer xxx"}'
                  />
                </label>
              </div>
            </div>
            <div className="model-edit-modal-foot">
              <div className={`model-test-feedback model-edit-feedback${modelEditTestFeedback.type ? ` is-${modelEditTestFeedback.type}` : ''}`}>
                {modelEditTestFeedback.text || '建议先测试可用，再保存修改'}
              </div>
              <button className="ghost" onClick={onTestEditModel} disabled={modelEditTesting || modelEditSaving}>
                {modelEditTesting ? '测试中...' : '测试可用'}
              </button>
              <button className="primary" onClick={onSaveEditModel} disabled={modelEditSaving || modelEditTesting}>
                {modelEditSaving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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

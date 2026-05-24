import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDateTime, parseStoredDateTime } from './datetime'
import {
  clearPersistedExamSessionId,
  persistExamSessionId,
  readPersistedExamSessionId,
} from './exam-session-storage'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const UPLOAD_MAX_MB = Math.max(1, Number(import.meta.env.VITE_UPLOAD_MAX_MB || 50))
const DOC_PREVIEW_MIN_SECONDS_DEFAULT = Math.max(15, Number(import.meta.env.VITE_DOC_PREVIEW_MIN_SECONDS || 45))
const CSRF_FAILURE_PATTERN = /csrf/i

let trainExamCsrfToken = ''
let trainExamCsrfPromise = null

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
  if (Number(res?.status || 0) === 413) {
    return '上传文件过大（网关限制），请稍后重试或联系管理员调整上传限制'
  }
  if (parsed.raw) {
    if (parsed.raw.startsWith('<')) {
      return `接口返回非预期数据格式(${res.status})`
    }
    return parsed.raw
  }
  return `请求失败(${res.status})`
}

const isCsrfFailure = (status, message) => Number(status || 0) === 403 && CSRF_FAILURE_PATTERN.test(String(message || ''))

const parseApiResponse = async (res) => {
  const text = await res.text()
  const parsed = parseMaybeJson(text)
  if (!res.ok) {
    const err = new Error(buildHttpError({ res, parsed }))
    err.status = res.status
    throw err
  }
  return parsed.data
}

const readDownloadFilename = (res, fallback) => {
  const contentDisposition = String(res?.headers?.get?.('Content-Disposition') || '').trim()
  const encodedMatch = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].trim())
    } catch {
      return encodedMatch[1].trim()
    }
  }
  const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i)
  if (quotedMatch?.[1]) return quotedMatch[1].trim()
  const plainMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i)
  if (plainMatch?.[1]) return plainMatch[1].trim()
  return fallback
}

const triggerBrowserDownload = (blob, filename) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
}

const downloadTrainExamFile = async ({ path, fallbackFilename }) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
  })
  if (!res.ok) {
    const parsed = parseMaybeJson(await res.text())
    const err = new Error(buildHttpError({ res, parsed }))
    err.status = res.status
    throw err
  }
  const blob = await res.blob()
  triggerBrowserDownload(blob, readDownloadFilename(res, fallbackFilename))
}

const fetchTrainExamCsrfToken = async ({ force = false } = {}) => {
  if (!force && trainExamCsrfToken) return trainExamCsrfToken
  if (!trainExamCsrfPromise || force) {
    trainExamCsrfPromise = (async () => {
      const res = await fetch(`${API_BASE}/api/train-exam/csrf`, {
        credentials: 'include',
      })
      const payload = await parseApiResponse(res)
      const token = String(payload?.token || '')
      if (!token) {
        throw new Error('CSRF token 获取失败')
      }
      trainExamCsrfToken = token
      return token
    })().finally(() => {
      trainExamCsrfPromise = null
    })
  }
  return trainExamCsrfPromise
}

const requestWithOptionalCsrf = async ({
  path,
  method = 'GET',
  body,
  headers = {},
  useCsrf = false,
  retryOnCsrf = true,
}) => {
  const finalHeaders = { ...headers }
  if (useCsrf) {
    finalHeaders['X-CSRF-Token'] = await fetchTrainExamCsrfToken()
  }

  let res
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: finalHeaders,
      body,
    })
    return await parseApiResponse(res)
  } catch (err) {
    if (useCsrf && retryOnCsrf && isCsrfFailure(err?.status, err?.message)) {
      trainExamCsrfToken = ''
      await fetchTrainExamCsrfToken({ force: true })
      return requestWithOptionalCsrf({
        path,
        method,
        body,
        headers,
        useCsrf,
        retryOnCsrf: false,
      })
    }
    throw err
  }
}

const uploadWithProgressAndCsrf = ({ path, formData, options = {}, retryOnCsrf = true }) =>
  new Promise(async (resolve, reject) => {
    let csrfToken = ''
    try {
      csrfToken = await fetchTrainExamCsrfToken()
    } catch {
      reject(new Error('CSRF token 获取失败'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`, true)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-CSRF-Token', csrfToken)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)))
      if (typeof options.onProgress === 'function') {
        options.onProgress(percent)
      }
    }

    xhr.onerror = () => {
      reject(new Error('网络请求失败，请检查网络连接或关闭浏览器翻译/代理插件后重试'))
    }

    xhr.onabort = () => {
      reject(new Error('上传已取消'))
    }

    xhr.onload = async () => {
      const status = Number(xhr.status || 0)
      const text = String(xhr.responseText || '')
      const parsed = parseMaybeJson(text)
      if (status >= 200 && status < 300) {
        resolve(parsed.data)
        return
      }
      const err = new Error(buildHttpError({ res: { status }, parsed }))
      err.status = status
      if (retryOnCsrf && isCsrfFailure(status, err.message)) {
        try {
          trainExamCsrfToken = ''
          await fetchTrainExamCsrfToken({ force: true })
          const retried = await uploadWithProgressAndCsrf({
            path,
            formData,
            options,
            retryOnCsrf: false,
          })
          resolve(retried)
          return
        } catch (retryErr) {
          reject(retryErr)
          return
        }
      }
      reject(err)
    }

    xhr.send(formData)
  })

const uploadFileToSignedUrl = ({ url, method = 'PUT', file, headers = {}, onProgress }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, String(url || ''), true)

    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      xhr.setRequestHeader(key, value)
    })

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)))
      onProgress(percent)
    }

    xhr.onerror = () => {
      reject(new Error('OSS 上传失败，请检查网络或桶 CORS 配置后重试'))
    }

    xhr.onabort = () => {
      reject(new Error('OSS 上传已取消'))
    }

    xhr.onload = () => {
      const status = Number(xhr.status || 0)
      if (status >= 200 && status < 300) {
        resolve({
          etag: String(xhr.getResponseHeader('etag') || xhr.getResponseHeader('ETag') || '').trim(),
        })
        return
      }
      reject(new Error(`OSS 上传失败(${status})`))
    }

    xhr.send(file)
  })

const buildApi = () => ({
  get: async (path) =>
    requestWithOptionalCsrf({
      path,
      method: 'GET',
    }),
  post: async (path, body) =>
    requestWithOptionalCsrf({
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
      useCsrf: true,
    }),
  postForm: async (path, formData) =>
    requestWithOptionalCsrf({
      path,
      method: 'POST',
      body: formData,
      useCsrf: true,
    }),
  postFormWithProgress: (path, formData, options = {}) =>
    uploadWithProgressAndCsrf({ path, formData, options }),
  put: async (path, body) => {
    return requestWithOptionalCsrf({
      path,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
      useCsrf: true,
    })
  },
  del: async (path) =>
    requestWithOptionalCsrf({
      path,
      method: 'DELETE',
      useCsrf: true,
    }),
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

const buildPortalLoginUrl = () => {
  const base = getPortalBaseUrl()
  return `${base}/portal`
}

const buildPortalSwitchUrl = (system) => {
  const base = getPortalBaseUrl()
  const params = new URLSearchParams()
  if (system) params.set('system', system)
  params.set('mode', 'switch')
  return `${base}/portal?${params.toString()}`
}

const normalizeResourceStorageBackend = ({ resourceType, sourceMode, storageBackend }) => {
  const type = String(resourceType || '').trim().toLowerCase()
  const mode = String(sourceMode || '').trim().toLowerCase()
  const backend = String(storageBackend || '').trim().toLowerCase()
  if (mode === 'external') return 'external'
  if (type !== 'video') return 'local'
  return backend === 'oss' ? 'oss' : 'local'
}

const isManagedUploadVideoResource = (resource) => {
  const type = String(resource?.resource_type || '').trim().toLowerCase()
  const mode = String(resource?.source_mode || '').trim().toLowerCase()
  const backend = normalizeResourceStorageBackend({
    resourceType: type,
    sourceMode: mode,
    storageBackend: resource?.storage_backend,
  })
  return type === 'video' && mode === 'upload' && (backend === 'local' || backend === 'oss')
}

const buildDefaultOssSettingsForm = () => ({
  enabled: false,
  region: '',
  bucket: '',
  endpoint: '',
  access_key_id: '',
  access_key_secret: '',
  sts_token: '',
  signed_upload_expires_seconds: 600,
  signed_play_expires_seconds: 300,
  upload_max_file_size_mb: 2048,
})

const normalizeOssSettingsResponse = (payload) => {
  const defaults = buildDefaultOssSettingsForm()
  const readPositiveInt = (value, fallback) => {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) return fallback
    return Math.round(num)
  }
  return {
    form: {
      enabled: !!payload?.enabled,
      region: String(payload?.region || '').trim(),
      bucket: String(payload?.bucket || '').trim(),
      endpoint: String(payload?.endpoint || '').trim(),
      access_key_id: String(payload?.access_key_id || '').trim(),
      access_key_secret: String(payload?.access_key_secret || '').trim(),
      sts_token: String(payload?.sts_token || '').trim(),
      signed_upload_expires_seconds: readPositiveInt(payload?.signed_upload_expires_seconds, defaults.signed_upload_expires_seconds),
      signed_play_expires_seconds: readPositiveInt(payload?.signed_play_expires_seconds, defaults.signed_play_expires_seconds),
      upload_max_file_size_mb: readPositiveInt(payload?.upload_max_file_size_mb, defaults.upload_max_file_size_mb),
    },
    status: {
      configured: !!payload?.configured,
      validation_error: String(payload?.validation_error || '').trim(),
      has_access_key_secret: !!payload?.has_access_key_secret,
      has_sts_token: !!payload?.has_sts_token,
    },
  }
}

const roleLabel = (role) => {
  const key = String(role || '').trim().toLowerCase()
  if (key === 'admin') return '管理员'
  if (key === 'editor') return '编辑'
  if (key === 'reviewer') return '审核员'
  if (key === 'auditor') return '审计管理员'
  if (key === 'viewer') return '普通用户'
  return key || '-'
}

const questionTypeLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'single_choice') return '单选题'
  if (key === 'multiple_choice') return '多选题'
  if (key === 'judgement') return '判断题'
  if (key === 'fill_blank') return '填空题'
  return value || '-'
}

const getPublishedQuestionCategoryCount = (row, questionType) => {
  const key = String(questionType || '').trim().toLowerCase()
  if (key === 'single_choice') return Number(row?.published_single_choice_count || 0)
  if (key === 'multiple_choice') return Number(row?.published_multiple_choice_count || 0)
  if (key === 'judgement') return Number(row?.published_judgement_count || 0)
  if (key === 'fill_blank') return Number(row?.published_fill_blank_count || 0)
  return Number(row?.published_question_count || 0)
}

const difficultyLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'easy') return '简单'
  if (key === 'medium') return '中等'
  if (key === 'hard') return '困难'
  return value || '-'
}

const questionStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'draft') return '草稿'
  if (key === 'published') return '已发布'
  if (key === 'archived') return '已归档'
  return value || '-'
}

const sourceTypeLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'manual') return '手工'
  if (key === 'faq_auto') return 'FAQ自动生成'
  if (key === 'import') return 'Excel导入'
  return value || '-'
}

const paperModeLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'fixed') return '固定试卷'
  if (key === 'random') return '随机抽题'
  return value || '-'
}

const paperStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'draft') return '草稿'
  if (key === 'scheduled') return '待发布'
  if (key === 'published') return '已发布'
  if (key === 'archived') return '已归档'
  return value || '-'
}

const paperStatusClassName = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'scheduled') return 'badge badge-scheduled'
  if (key === 'published') return 'badge badge-published'
  if (key === 'archived') return 'badge badge-archived'
  return 'badge'
}

const getShanghaiDateTimeParts = (value) => {
  const date = value ? parseStoredDateTime(value) : new Date(Date.now() + 60 * 60 * 1000)
  const safeDate = date && !Number.isNaN(date.getTime()) ? date : new Date(Date.now() + 60 * 60 * 1000)
  const text = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(safeDate)
  const [datePart = '', timePart = ''] = text.split(' ')
  return { date: datePart, time: timePart }
}

const buildScheduledPublishAt = ({ date, time }) => {
  const dateText = String(date || '').trim()
  const timeText = String(time || '').trim()
  return dateText && timeText ? `${dateText}T${timeText}` : ''
}

const getPaperPublishTimeText = (p) => formatDateTime(p.scheduled_publish_at || p.published_at)

const normalizePaperExamWindowHours = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return 72
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 72
  return Math.max(1, Math.min(8760, Math.floor(parsed)))
}

const getPaperExamDeadline = (paper) => {
  const publishedAt = parseStoredDateTime(paper?.published_at)
  if (!publishedAt) return null
  return new Date(publishedAt.getTime() + normalizePaperExamWindowHours(paper?.exam_window_hours) * 60 * 60 * 1000)
}

const isPaperExpiredForExam = (paper) => {
  const deadline = getPaperExamDeadline(paper)
  return !!deadline && Date.now() >= deadline.getTime()
}

const getPaperExamDeadlineText = (paper) => {
  const deadline = getPaperExamDeadline(paper)
  return deadline ? formatDateTime(deadline) : '-'
}

const instructorReviewStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'draft') return '草稿'
  if (key === 'scheduled') return '待发布'
  if (key === 'published') return '已发布'
  if (key === 'closed') return '已关闭'
  return value || '-'
}

const getInstructorReviewPublishTimeText = (item) => formatDateTime(item?.scheduled_publish_at || item?.updated_at)

const resourceTypeLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'doc') return '文档'
  if (key === 'video') return '视频'
  if (key === 'link') return '外链'
  return value || '-'
}

const buildVideoErrorMessage = ({ mediaErrorCode, playErrorMessage }) => {
  if (mediaErrorCode === 1) return '播放被中断，请重新点击“开始播放”。'
  if (mediaErrorCode === 2) return '视频加载失败，请检查网络连接后重试。'
  if (mediaErrorCode === 3) return '视频解码失败，可能是文件已损坏或编码不受支持。'
  if (mediaErrorCode === 4) return '浏览器不支持该视频格式，请重新上传标准 MP4/WebM。'
  const text = String(playErrorMessage || '').trim()
  if (text) return `播放失败：${text}`
  return '视频暂不可播放，请确认该资源已上传有效视频文件。'
}

const sourceModeLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'upload') return '上传'
  if (key === 'external') return '外链'
  return value || '-'
}

const importStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'running') return '执行中'
  if (key === 'completed') return '已完成'
  if (key === 'partial_failed') return '部分失败'
  if (key === 'failed') return '失败'
  if (key === 'pending') return '待执行'
  return value || '-'
}

const adviceStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'success') return '成功'
  if (key === 'fallback') return '规则兜底'
  if (key === 'pending') return '处理中'
  if (key === 'failed') return '失败'
  return value || '-'
}

const recertStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'scheduled') return '待复考'
  if (key === 'in_progress') return '复考中'
  if (key === 'completed') return '已完成'
  return value || '-'
}

const certStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'active') return '有效'
  if (key === 'expired') return '已过期'
  if (key === 'revoked') return '已作废'
  return value || '-'
}

const recommendationTypeLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'practice_pack') return '错题专项练习'
  if (key === 'course') return '课程推荐'
  return value || '-'
}

const buildResourceOpenUrl = (resource) => {
  const id = Number(resource?.id || 0)
  const sourceMode = String(resource?.source_mode || '').trim().toLowerCase()
  const resourceType = String(resource?.resource_type || '').trim().toLowerCase()
  if (sourceMode === 'external') {
    const sourceUrl = String(resource?.source_url || '').trim()
    return sourceUrl || ''
  }
  if (!id) return ''
  if (resourceType === 'video') return `/api/train-exam/resources/${id}/stream`
  return `/api/train-exam/resources/${id}/download`
}

const normalizeLearningProgressPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value || 0))))

const isLearningProgressCompleted = (progress) =>
  !!progress?.completed
  || !!progress?.completed_at
  || normalizeLearningProgressPercent(progress?.progress_percent) >= 100

const isLearningVideoSeekLocked = (resource) =>
  !!resource?.force_watch
  && isManagedUploadVideoResource(resource)
  && !isLearningProgressCompleted(resource?.progress)

const formatPlaybackClock = (value) => {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0)))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const formatPlaybackRemainingLabel = (value) => {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0)))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}小时${minutes}分`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}

const resolveLearningFlowState = (item) => {
  const resourceType = String(item?.resource_type || '').trim().toLowerCase()
  const transcodeStatus = String(item?.transcode_status || '').trim().toLowerCase()
  const transcodeProgress = Math.max(0, Math.min(100, Number(item?.transcode_progress || 0)))
  const progressPercent = normalizeLearningProgressPercent(item?.progress?.progress_percent)

  if (resourceType === 'video' && (transcodeStatus === 'queued' || transcodeStatus === 'running')) {
    return {
      key: 'transcoding',
      label: `转码中 ${transcodeProgress}%`,
      description: '视频仍在后台处理中，稍后即可继续学习。',
      progressPercent,
    }
  }

  if (resourceType === 'video' && transcodeStatus === 'failed') {
    return {
      key: 'failed',
      label: '转码失败',
      description: String(item?.transcode_message || '').trim() || '视频处理失败，请联系管理员重新上传。',
      progressPercent,
    }
  }

  if (progressPercent >= 100) {
    return {
      key: 'completed',
      label: '已完成',
      description: '本章已学习完成，可随时回看。',
      progressPercent: 100,
    }
  }

  if (progressPercent > 0) {
    return {
      key: 'active',
      label: '进行中',
      description: '本章已有学习进度，可以继续。',
      progressPercent,
    }
  }

  return {
    key: 'pending',
    label: '待学习',
    description: '尚未开始，建议从这里进入。',
    progressPercent: 0,
  }
}

const buildLearningPrimaryActionLabel = (item, state) => {
  const resourceType = String(item?.resource_type || '').trim().toLowerCase()
  if (resourceType === 'video') {
    if (state?.key === 'completed') return '回看视频'
    return state?.key === 'active' ? '继续观看' : '打开播放器'
  }
  if (resourceType === 'doc') {
    if (state?.key === 'completed') return '再次阅读'
    return state?.key === 'active' ? '继续阅读' : '开始阅读'
  }
  if (resourceType === 'link') return '打开链接'
  return '打开资源'
}

const aiLogStatusLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'success') return '成功'
  if (key === 'failed') return '失败'
  if (key === 'running') return '执行中'
  if (key === 'pending') return '待执行'
  return value || '-'
}

const aiTaskTypeLabel = (value) => {
  const key = String(value || '').trim().toUpperCase()
  if (key === 'FAQ_TO_QUESTIONS') return 'FAQ自动出题'
  if (key === 'EXAM_ADVICE') return '考试建议'
  if (key === 'MODEL_HEALTHCHECK') return '模型可用性测试'
  return value || '-'
}

const auditActionLabel = (value) => {
  const key = String(value || '').trim().toUpperCase()
  const map = {
    COURSE_CREATE: '创建课程',
    COURSE_UPDATE: '更新课程',
    COURSE_DELETE: '删除课程',
    RESOURCE_CREATE: '创建资源',
    RESOURCE_UPDATE: '更新资源',
    RESOURCE_DELETE: '删除资源',
    RESOURCE_UPLOAD: '上传资源文件',
    RESOURCE_PLAYBACK_POLICY_UPDATE: '更新播放策略',
    QUESTION_CREATE: '创建题目',
    QUESTION_UPDATE: '更新题目',
    QUESTION_DELETE: '删除题目',
    QUESTION_REVIEW: '审核题目',
    QUESTION_CATEGORY_CREATE: '创建题目分类',
    QUESTION_CATEGORY_UPDATE: '修改题目分类',
    QUESTION_CATEGORY_DELETE: '删除题目分类',
    PAPER_CREATE: '创建试卷',
    PAPER_UPDATE: '更新试卷',
    PAPER_PUBLISH: '发布试卷',
    PAPER_ARCHIVE: '归档试卷',
    PAPER_DELETE: '删除试卷',
    EXAM_START: '开始考试',
    EXAM_SUBMIT: '提交考试',
    EXAM_TIMEOUT_SUBMIT: '超时交卷',
    CERTIFICATE_GENERATE: '生成证书',
    CERT_TEMPLATE_UPLOAD: '上传证书模板',
    CERT_TEMPLATE_DELETE: '删除证书模板',
    RESULT_AI_ADVICE_GENERATE: '生成考试建议',
    AI_MODEL_TEST: '测试模型可用性',
  }
  return map[key] || value || '-'
}

const auditEntityLabel = (value) => {
  const key = String(value || '').trim().toLowerCase()
  const map = {
    course: '课程',
    course_resource: '课程资源',
    question: '题目',
    question_category: '题目分类',
    paper: '试卷',
    exam_session: '考试会话',
    certificate: '证书',
    certificate_template: '证书模板',
    result_ai_advice: 'AI建议',
    ai_model: '大模型',
    import_job: '导入任务',
    question_generation_job: '自动出题任务',
    user_profile: '用户画像',
  }
  return map[key] || value || '-'
}

const formatDurationText = (seconds) => {
  const total = Math.max(0, Number(seconds || 0))
  if (!total) return '-'
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainSeconds = total % 60
  if (hours > 0) return `${hours}小时${minutes}分${remainSeconds}秒`
  if (minutes > 0) return `${minutes}分${remainSeconds}秒`
  return `${remainSeconds}秒`
}

const formatPercentText = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}%`

const formatRatingText = (value) => {
  const level = String(value || '').trim().toUpperCase()
  return ['A', 'B', 'C', 'D'].includes(level) ? level : 'D'
}

const STUDENT_OVERALL_PAGE_LIMIT = 100

const buildStudentOverallDefault = () => ({
  sourceItems: [],
  loading: false,
  filters: {
    keyword: '',
    department: 'all',
    evaluation: 'all',
    range: '30',
  },
})

const buildStudentEvaluation = (averageScore) => {
  const score = Number(averageScore || 0)
  if (score >= 90) return { label: '优秀', className: 'excellent', detail: '成绩稳定突出，可作为培训标杆。' }
  if (score >= 80) return { label: '良好', className: 'good', detail: '整体掌握较好，建议继续巩固薄弱题型。' }
  if (score >= 60) return { label: '需加强', className: 'warn', detail: '已达到基础要求，建议安排针对性复训。' }
  return { label: '重点跟进', className: 'danger', detail: '平均表现偏低，建议优先跟进学习和复考。' }
}

const getStudentOverallRangeStart = (range) => {
  const key = String(range || '30')
  if (key === 'all') return 0
  const days = Number(key || 30)
  if (!Number.isFinite(days) || days <= 0) return 0
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - days)
  return now.getTime()
}

const isStudentOverallResultInRange = (item, range) => {
  const startTime = getStudentOverallRangeStart(range)
  if (!startTime) return true
  const createdTime = new Date(String(item?.created_at || '').replace(' ', 'T')).getTime()
  if (!Number.isFinite(createdTime)) return false
  return createdTime >= startTime
}

const buildStudentOverallRows = ({ items = [], filters = {} } = {}) => {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  const departmentFilter = String(filters.department || 'all')
  const evaluationFilter = String(filters.evaluation || 'all')
  const groups = new Map()

  ;(Array.isArray(items) ? items : [])
    .filter((item) => isStudentOverallResultInRange(item, filters.range))
    .forEach((item) => {
      const userId = Number(item?.user_id || 0)
      const username = String(item?.username || (userId ? `用户#${userId}` : '未知学员')).trim()
      const key = userId > 0 ? `user-${userId}` : `name-${username}`
      const current = groups.get(key) || {
        key,
        user_id: userId,
        username,
        department: String(item?.user_department || '').trim() || '-',
        position: String(item?.user_position || '').trim() || '-',
        total: 0,
        scoreSum: 0,
        passCount: 0,
        latestExamAt: '',
        attempts: [],
      }
      current.total += 1
      current.scoreSum += Number(item?.score || 0)
      current.passCount += Number(item?.passed || 0) === 1 ? 1 : 0
      current.latestExamAt = current.latestExamAt || item?.created_at || ''
      current.attempts.push({
        id: Number(item?.id || 0),
        paperName: String(item?.paper_name || item?.paper_id || '未命名试卷').trim(),
        score: Number(item?.score || 0),
        totalScore: Number(item?.total_score || 0),
        createdAt: item?.created_at || '',
      })
      groups.set(key, current)
    })

  return Array.from(groups.values())
    .map((item) => {
      const averageScore = item.total > 0 ? Number((item.scoreSum / item.total).toFixed(2)) : 0
      const evaluation = buildStudentEvaluation(averageScore)
      const attempts = item.attempts
        .sort((left, right) => new Date(String(right.createdAt || '').replace(' ', 'T')).getTime() - new Date(String(left.createdAt || '').replace(' ', 'T')).getTime())
      return {
        ...item,
        attempts,
        averageScore,
        latestExamAt: attempts[0]?.createdAt || item.latestExamAt || '',
        evaluation,
      }
    })
    .filter((item) => {
      if (departmentFilter !== 'all' && item.department !== departmentFilter) return false
      if (evaluationFilter !== 'all' && item.evaluation.label !== evaluationFilter) return false
      if (!keyword) return true
      return [item.username, item.department, item.position]
        .some((value) => String(value || '').toLowerCase().includes(keyword))
    })
    .sort((left, right) => right.averageScore - left.averageScore || right.total - left.total || left.username.localeCompare(right.username, 'zh-CN'))
}

const buildStudentOverallSummary = (rows = []) => {
  const items = Array.isArray(rows) ? rows : []
  const totalAttempts = items.reduce((sum, item) => sum + Number(item.total || 0), 0)
  const weightedScoreSum = items.reduce((sum, item) => sum + (Number(item.averageScore || 0) * Number(item.total || 0)), 0)
  const excellentCount = items.filter((item) => item.evaluation?.label === '优秀').length
  return {
    studentCount: items.length,
    totalAttempts,
    averageScore: totalAttempts > 0 ? Number((weightedScoreSum / totalAttempts).toFixed(2)) : 0,
    excellentRate: items.length > 0 ? Number(((excellentCount / items.length) * 100).toFixed(2)) : 0,
  }
}

const buildStudentOverallDepartments = (items = []) => {
  const values = new Set()
  ;(Array.isArray(items) ? items : []).forEach((item) => {
    const department = String(item?.user_department || '').trim()
    if (department) values.add(department)
  })
  return Array.from(values).sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

const buildAdminResultsQueryString = ({ page = 1, limit = 20, filters = {} } = {}) => {
  const params = new URLSearchParams()
  params.set('page', String(Math.max(1, Number(page || 1))))
  params.set('limit', String(Math.max(1, Number(limit || 20))))
  if (String(filters?.keyword || '').trim()) params.set('keyword', String(filters.keyword).trim())
  if (String(filters?.user_id || '').trim()) params.set('user_id', String(filters.user_id).trim())
  if (String(filters?.paper_id || '').trim()) params.set('paper_id', String(filters.paper_id).trim())
  if (String(filters?.passed || 'all').trim() !== 'all') params.set('passed', String(filters.passed).trim())
  if (filters?.final_only) params.set('final_only', 'true')
  if (String(filters?.date_from || '').trim()) params.set('date_from', String(filters.date_from).trim())
  if (String(filters?.date_to || '').trim()) params.set('date_to', String(filters.date_to).trim())
  return params.toString()
}

const buildResultCenterDefaultSummary = () => ({
  total_results: 0,
  pass_count: 0,
  fail_count: 0,
  average_score: 0,
  average_duration_seconds: 0,
  final_result_count: 0,
  pass_rate: 0,
})

const buildAdminResultPaperOverviewDefault = () => ({
  items: [],
})

const buildCandidateRecordDefault = () => ({
  candidate: null,
  items: [],
  summary: {
    total_results: 0,
    final_result_count: 0,
    pass_count: 0,
    average_score: 0,
    latest_exam_at: '',
  },
  overall_evaluation: {
    exam_count: 0,
    course_review_count: 0,
    exam_average_rate: 0,
    course_average_rating: 0,
    course_average_rate: 0,
    overall_score: 0,
    rating_level: 'D',
    evaluation_text: '',
  },
  page: 1,
  limit: 10,
  total: 0,
  total_pages: 1,
})

const buildHistoryResultLabel = ({ result, paperName = '' }) => {
  const rid = Number(result?.id || 0)
  const paperId = Number(result?.paper_id || 0)
  const attemptNo = Number(result?.attempt_no || 0)
  const score = Number(result?.score || 0).toFixed(2)
  const total = Number(result?.total_score || 0).toFixed(2)
  const statusText = Number(result?.passed || 0) === 1 ? '通过' : '未通过'
  const title = String(paperName || `试卷#${paperId}`).trim()
  const timeText = formatDateTime(result?.created_at)
  const attemptText = attemptNo > 0 ? `第${attemptNo}次` : '历史'
  return `#${rid}｜${title}｜${attemptText}｜${score}/${total}｜${statusText}｜${timeText}`
}

const hasAnyAnswer = (answer) => {
  if (!Array.isArray(answer)) return false
  return answer.some((item) => String(item || '').trim().length > 0)
}

const normalizeAnswerItems = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0)
  }
  const text = String(value ?? '').trim()
  return text ? [text] : []
}

const normalizeOptionKey = (value) => String(value ?? '').trim().toUpperCase()

const expandCompactMultipleChoiceItems = (value) => normalizeAnswerItems(value)
  .flatMap((item) => {
    const optionKey = normalizeOptionKey(item)
    if (/^[A-Z]{2,}$/.test(optionKey)) return optionKey.split('')
    return [item]
  })

const normalizeJudgementAnswer = (value) => {
  const raw = String(value ?? '').trim()
  const key = raw.toLowerCase()
  if (['a', 'true', 't', '1', '正确', '对', '是', 'yes', 'y'].includes(key)) return '正确'
  if (['b', 'false', 'f', '0', '错误', '错', '否', 'no', 'n'].includes(key)) return '错误'
  return raw
}

const formatExamAnswerText = ({ questionType, values, options }) => {
  const items = questionType === 'multiple_choice'
    ? expandCompactMultipleChoiceItems(values)
    : normalizeAnswerItems(values)
  if (!items.length) return '未作答'

  if (questionType === 'fill_blank') {
    return items.join('；')
  }

  if (questionType === 'judgement') {
    return items.map((item) => normalizeJudgementAnswer(item)).join('、')
  }

  if (questionType === 'single_choice' || questionType === 'multiple_choice') {
    return items
      .map((item) => {
        const optionKey = normalizeOptionKey(item)
        const option = Array.isArray(options)
          ? options.find((opt) => normalizeOptionKey(opt?.key) === optionKey)
          : null
        if (option) {
          const optionText = String(option?.text ?? '').trim()
          return optionText ? `${optionKey}. ${optionText}` : optionKey
        }
        return item
      })
      .join('、')
  }

  return items.join('、')
}

const parseResultDetailPayload = (result) => {
  if (!result || typeof result !== 'object') return {}
  if (result.detail && typeof result.detail === 'object' && !Array.isArray(result.detail)) {
    return result.detail
  }
  if (result.detail_json && typeof result.detail_json === 'object' && !Array.isArray(result.detail_json)) {
    return result.detail_json
  }
  if (typeof result.detail_json === 'string') {
    const parsed = parseMaybeJson(result.detail_json)
    if (parsed.json && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      return parsed.data
    }
  }
  return {}
}

const buildExamQuestionReview = ({ detail, questionType, options }) => {
  if (!detail || typeof detail !== 'object') return null
  const standardAnswer = detail.standard_answer && typeof detail.standard_answer === 'object'
    ? detail.standard_answer
    : {}
  const standardValues = normalizeAnswerItems(standardAnswer.answer_values)
  const standardAliases = normalizeAnswerItems(standardAnswer.answer_aliases)
  const standardText = String(standardAnswer.answer_text ?? '').trim()

  let normalizedStandardValues = standardValues
  if (!normalizedStandardValues.length && standardText) {
    normalizedStandardValues = [standardText]
  }

  let standardDisplay = formatExamAnswerText({
    questionType,
    values: normalizedStandardValues,
    options,
  })

  if (questionType === 'fill_blank') {
    const merged = Array.from(
      new Set([
        ...normalizedStandardValues,
        ...standardAliases,
      ].map((item) => String(item ?? '').trim()).filter((item) => item.length > 0))
    )
    standardDisplay = merged.length ? merged.join(' / ') : '未配置'
  }

  return {
    userAnswerText: formatExamAnswerText({
      questionType,
      values: detail.user_answer,
      options,
    }),
    standardAnswerText: standardDisplay || '未配置',
    isCorrect: !!detail.is_correct,
    scoreText: `${Number(detail.earned_score || 0).toFixed(2)} / ${Number(detail.points || 0).toFixed(2)}`,
    explanation: String(detail.explanation ?? '').trim(),
  }
}

const defaultQuestionForm = {
  stem: '',
  question_category: '手工创建',
  question_type: 'single_choice',
  difficulty: 'medium',
  points: 2,
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  answer_values: '',
  answer_text: '',
  answer_aliases: '',
  explanation: '',
  tags: '',
}

const createPaperRule = () => ({
  question_type: 'single_choice',
  difficulty: '',
  question_categories: [],
  question_count: 5,
  points_per_question: 2,
  tags: '',
})

const createDefaultPaperForm = () => ({
  name: '',
  paper_mode: 'fixed',
  pass_score: 80,
  duration_minutes: 60,
  max_attempts: 3,
  exam_window_hours: 72,
  fixed_question_ids: '',
  rules: [createPaperRule()],
})

const buildDefaultPlayerModalRect = () => {
  const vw = typeof window !== 'undefined' ? Math.max(360, Number(window.innerWidth || 0)) : 1280
  const vh = typeof window !== 'undefined' ? Math.max(360, Number(window.innerHeight || 0)) : 800
  const width = Math.max(360, Math.min(980, vw - 40))
  const height = Math.max(280, Math.min(680, vh - 80))
  const left = Math.max(12, Math.floor((vw - width) / 2))
  const top = Math.max(12, Math.floor((vh - height) / 2))
  return { left, top, width, height }
}

const clampPlayerModalRect = (rect) => {
  const vw = typeof window !== 'undefined' ? Math.max(360, Number(window.innerWidth || 0)) : 1280
  const vh = typeof window !== 'undefined' ? Math.max(360, Number(window.innerHeight || 0)) : 800
  const margin = 8
  const maxWidth = Math.max(320, vw - margin * 2)
  const maxHeight = Math.max(260, vh - margin * 2)
  const minWidth = Math.min(520, maxWidth)
  const minHeight = Math.min(320, maxHeight)
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(Number(rect?.width || minWidth))))
  const height = Math.max(minHeight, Math.min(maxHeight, Math.round(Number(rect?.height || minHeight))))
  const left = Math.max(margin, Math.min(vw - width - margin, Math.round(Number(rect?.left || margin))))
  const top = Math.max(margin, Math.min(vh - height - margin, Math.round(Number(rect?.top || margin))))
  return { left, top, width, height }
}

const buildDefaultDocPreviewModalRect = () => {
  const vw = typeof window !== 'undefined' ? Math.max(360, Number(window.innerWidth || 0)) : 1280
  const vh = typeof window !== 'undefined' ? Math.max(360, Number(window.innerHeight || 0)) : 800
  const width = Math.max(560, Math.min(1240, vw - 48))
  const height = Math.max(420, Math.min(860, vh - 56))
  const left = Math.max(8, Math.floor((vw - width) / 2))
  const top = Math.max(8, Math.floor((vh - height) / 2))
  return { left, top, width, height }
}

const clampDocPreviewModalRect = (rect) => {
  const vw = typeof window !== 'undefined' ? Math.max(360, Number(window.innerWidth || 0)) : 1280
  const vh = typeof window !== 'undefined' ? Math.max(360, Number(window.innerHeight || 0)) : 800
  const margin = 8
  const maxWidth = Math.max(340, vw - margin * 2)
  const maxHeight = Math.max(280, vh - margin * 2)
  const minWidth = Math.min(680, maxWidth)
  const minHeight = Math.min(420, maxHeight)
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(Number(rect?.width || minWidth))))
  const height = Math.max(minHeight, Math.min(maxHeight, Math.round(Number(rect?.height || minHeight))))
  const left = Math.max(margin, Math.min(vw - width - margin, Math.round(Number(rect?.left || margin))))
  const top = Math.max(margin, Math.min(vh - height - margin, Math.round(Number(rect?.top || margin))))
  return { left, top, width, height }
}

const buildDefaultCourseLearningModalRect = () => {
  const vw = typeof window !== 'undefined' ? Math.max(360, Number(window.innerWidth || 0)) : 1440
  const vh = typeof window !== 'undefined' ? Math.max(360, Number(window.innerHeight || 0)) : 900
  const width = Math.max(860, Math.min(1380, vw - 24))
  const height = Math.max(580, Math.min(920, vh - 24))
  const left = Math.max(8, Math.floor((vw - width) / 2))
  const top = Math.max(8, Math.floor((vh - height) / 2))
  return { left, top, width, height }
}

const clampCourseLearningModalRect = (rect) => {
  const vw = typeof window !== 'undefined' ? Math.max(360, Number(window.innerWidth || 0)) : 1440
  const vh = typeof window !== 'undefined' ? Math.max(360, Number(window.innerHeight || 0)) : 900
  const margin = 8
  const maxWidth = Math.max(520, vw - margin * 2)
  const maxHeight = Math.max(360, vh - margin * 2)
  const minWidth = Math.min(760, maxWidth)
  const minHeight = Math.min(500, maxHeight)
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(Number(rect?.width || minWidth))))
  const height = Math.max(minHeight, Math.min(maxHeight, Math.round(Number(rect?.height || minHeight))))
  const left = Math.max(margin, Math.min(vw - width - margin, Math.round(Number(rect?.left || margin))))
  const top = Math.max(margin, Math.min(vh - height - margin, Math.round(Number(rect?.top || margin))))
  return { left, top, width, height }
}

const COURSE_LEARNING_MODAL_LAYOUT_STORAGE_KEY = 'train-exam.course-learning-modal-layout'

const buildMaximizedCourseLearningModalRect = () => {
  const vw = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1440
  const vh = typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 900
  return {
    left: 8,
    top: 8,
    width: Math.max(520, vw - 16),
    height: Math.max(360, vh - 16),
  }
}

const readCourseLearningModalLayout = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(COURSE_LEARNING_MODAL_LAYOUT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

const buildInitialCourseLearningModalState = () => {
  const stored = readCourseLearningModalLayout()
  if (!stored || typeof stored !== 'object') {
    return {
      ...buildDefaultCourseLearningModalRect(),
      maximized: false,
      restoreRect: null,
    }
  }
  const restoreRect = stored.restoreRect ? clampCourseLearningModalRect(stored.restoreRect) : null
  if (stored.maximized) {
    return {
      ...buildMaximizedCourseLearningModalRect(),
      maximized: true,
      restoreRect: restoreRect || clampCourseLearningModalRect(stored),
    }
  }
  return {
    ...clampCourseLearningModalRect(stored),
    maximized: false,
    restoreRect: null,
  }
}

const persistCourseLearningModalLayout = (state) => {
  if (typeof window === 'undefined' || !state || typeof state !== 'object') return
  try {
    const payload = state.maximized
      ? {
          maximized: true,
          restoreRect: clampCourseLearningModalRect(state.restoreRect || buildDefaultCourseLearningModalRect()),
        }
      : {
          ...clampCourseLearningModalRect(state),
          maximized: false,
          restoreRect: null,
        }
    window.localStorage.setItem(COURSE_LEARNING_MODAL_LAYOUT_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore storage write failures
  }
}

function App() {
  const api = useMemo(() => buildApi(), [])

  const [booting, setBooting] = useState(true)
  const [user, setUser] = useState(null)
  const [activeMenu, setActiveMenu] = useState('dashboard')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [logoutPending, setLogoutPending] = useState(false)

  const [overview, setOverview] = useState({})
  const [passTrend, setPassTrend] = useState([])

  const [courses, setCourses] = useState([])
  const [courseForm, setCourseForm] = useState({ title: '', description: '', duration_minutes: 60 })
  const [resourceForm, setResourceForm] = useState({
    course_id: '',
    name: '',
    resource_type: 'doc',
    source_mode: 'upload',
    storage_backend: 'local',
    source_url: '',
    force_watch: false,
    sort_order: 0,
  })
  const [resourceUpload, setResourceUpload] = useState({
    resource_id: '',
    resource_type: 'doc',
    source_mode: 'upload',
    storage_backend: 'local',
    file: null,
  })
  const [uploadingResource, setUploadingResource] = useState(false)
  const [resourceUploadProgress, setResourceUploadProgress] = useState(0)
  const [resourceUploadNotice, setResourceUploadNotice] = useState('')
  const [transcodeTask, setTranscodeTask] = useState(null)
  const transcodePollTimerRef = useRef(null)
  const learningPathPollTimerRef = useRef(null)
  const learningPathPollBusyRef = useRef(false)
  const [learningCourseId, setLearningCourseId] = useState('')
  const [learningPath, setLearningPath] = useState({
    course: null,
    summary: {
      total_resources: 0,
      completed_resources: 0,
      in_progress_resources: 0,
      not_started_resources: 0,
      completion_rate: 0,
    },
    items: [],
  })
  const [myLearningProgress, setMyLearningProgress] = useState({
    summary: { total_courses: 0, completed_courses: 0, average_completion_rate: 0 },
    items: [],
  })
  const [isCourseLearningModalOpen, setIsCourseLearningModalOpen] = useState(false)
  const [courseLearningPendingId, setCourseLearningPendingId] = useState(0)
  const [courseLearningDragState, setCourseLearningDragState] = useState(null)
  const [courseLearningResizeState, setCourseLearningResizeState] = useState(null)
  const [courseLearningModal, setCourseLearningModal] = useState(() => buildInitialCourseLearningModalState())

  const [generationForm, setGenerationForm] = useState({
    name: '',
    source_category_ids: '',
    source_article_ids: '',
    max_sources: 30,
  })
  const [latestGenerationJob, setLatestGenerationJob] = useState(null)
  const [importFile, setImportFile] = useState(null)
  const [publishImportedQuestions, setPublishImportedQuestions] = useState(true)
  const [latestImportJob, setLatestImportJob] = useState(null)

  const [questions, setQuestions] = useState([])
  const [questionForm, setQuestionForm] = useState(defaultQuestionForm)
  const [questionFilters, setQuestionFilters] = useState({
    keyword: '',
    status: 'all',
    source: 'all',
    category: 'all',
  })
  const [questionPagination, setQuestionPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  })
  const [questionCategories, setQuestionCategories] = useState([])
  const [questionCategoryRows, setQuestionCategoryRows] = useState([])
  const [questionCategoryFormName, setQuestionCategoryFormName] = useState('')
  const [questionCategorySaving, setQuestionCategorySaving] = useState(false)
  const [questionCategoryEditId, setQuestionCategoryEditId] = useState(0)
  const [questionCategoryEditName, setQuestionCategoryEditName] = useState('')
  const [questionCategoryDeletePendingId, setQuestionCategoryDeletePendingId] = useState(0)
  const [questionDeletePendingId, setQuestionDeletePendingId] = useState(0)
  const [questionPublishPendingId, setQuestionPublishPendingId] = useState(0)
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([])
  const [questionBatchDeleting, setQuestionBatchDeleting] = useState(false)
  const [questionBatchPublishing, setQuestionBatchPublishing] = useState(false)

  const [papers, setPapers] = useState([])
  const [paperForm, setPaperForm] = useState(() => createDefaultPaperForm())
  const [paperDeletePendingId, setPaperDeletePendingId] = useState(0)
  const [selectedPaperIds, setSelectedPaperIds] = useState([])
  const [paperBatchDeleting, setPaperBatchDeleting] = useState(false)
  const [paperScheduleDialog, setPaperScheduleDialog] = useState(null)
  const [paperScheduleForm, setPaperScheduleForm] = useState(() => getShanghaiDateTimeParts())
  const [paperScheduleSaving, setPaperScheduleSaving] = useState(false)

  const [currentSession, setCurrentSession] = useState(null)
  const [currentQuestions, setCurrentQuestions] = useState([])
  const [activeQuestionId, setActiveQuestionId] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [currentResult, setCurrentResult] = useState(null)
  const [selectedHistoryResultId, setSelectedHistoryResultId] = useState('')
  const [historyResultLoading, setHistoryResultLoading] = useState(false)
  const [resultAdvice, setResultAdvice] = useState(null)
  const [isAdviceLoading, setIsAdviceLoading] = useState(false)
  const [isSubmittingExam, setIsSubmittingExam] = useState(false)
  const [isAutoSubmitting, setIsAutoSubmitting] = useState(false)
  const [savingQuestionId, setSavingQuestionId] = useState(0)
  const [lastSavedAt, setLastSavedAt] = useState('')

  const [myResults, setMyResults] = useState([])
  const [myResultsExporting, setMyResultsExporting] = useState(false)
  const [myInstructorReviewForms, setMyInstructorReviewForms] = useState([])
  const [adminInstructorReviewForms, setAdminInstructorReviewForms] = useState([])
  const [adminInstructorReviewResponses, setAdminInstructorReviewResponses] = useState({ form: null, items: [], summary: {} })
  const [instructorReviewScheduleDialog, setInstructorReviewScheduleDialog] = useState(null)
  const [instructorReviewScheduleForm, setInstructorReviewScheduleForm] = useState(() => getShanghaiDateTimeParts())
  const [instructorReviewScheduleSaving, setInstructorReviewScheduleSaving] = useState(false)
  const [instructorQuestionnaireForm, setInstructorQuestionnaireForm] = useState({
    title: '',
    instructor_name: '',
    description: '',
    status: 'draft',
  })
  const [instructorReviewResponseForm, setInstructorReviewResponseForm] = useState({
    form_id: '',
    clarity_score: 5,
    interaction_score: 5,
    practical_score: 5,
    time_control_score: 5,
    qa_score: 5,
    feedback: '',
    anonymous: false,
  })
  const [instructorReviewSaving, setInstructorReviewSaving] = useState(false)
  const [myCertificates, setMyCertificates] = useState([])
  const [myRecertJobs, setMyRecertJobs] = useState([])
  const [resultCenterTab, setResultCenterTab] = useState('results')
  const [resultCenterView, setResultCenterView] = useState({ type: 'papers', from: 'papers', resultId: 0, userId: 0, paperId: 0 })
  const [adminResults, setAdminResults] = useState([])
  const [adminResultPaperOverview, setAdminResultPaperOverview] = useState(() => buildAdminResultPaperOverviewDefault())
  const [adminResultsFilters, setAdminResultsFilters] = useState({
    keyword: '',
    user_id: '',
    paper_id: '',
    passed: 'all',
    final_only: false,
    date_from: '',
    date_to: '',
  })
  const [adminResultsPagination, setAdminResultsPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  })
  const [adminResultsSummary, setAdminResultsSummary] = useState(() => buildResultCenterDefaultSummary())
  const [adminResultUsers, setAdminResultUsers] = useState([])
  const [adminResultPapers, setAdminResultPapers] = useState([])
  const [adminResultsLoading, setAdminResultsLoading] = useState(false)
  const [adminResultPapersLoading, setAdminResultPapersLoading] = useState(false)
  const [adminExamTimeoutRecords, setAdminExamTimeoutRecords] = useState({ paper: null, items: [], loading: false })
  const [adminResultsExporting, setAdminResultsExporting] = useState(false)
  const [studentOverall, setStudentOverall] = useState(() => buildStudentOverallDefault())
  const [resultReviewDetail, setResultReviewDetail] = useState(null)
  const [resultReviewCache, setResultReviewCache] = useState({})
  const [resultReviewLoading, setResultReviewLoading] = useState(false)
  const [candidateRecord, setCandidateRecord] = useState(() => buildCandidateRecordDefault())
  const [candidateRecordLoading, setCandidateRecordLoading] = useState(false)
  const [adminResultActionPendingId, setAdminResultActionPendingId] = useState('')
  const [certTemplate, setCertTemplate] = useState({ exists: false })
  const [certTemplateFile, setCertTemplateFile] = useState(null)
  const [certTemplateInputKey, setCertTemplateInputKey] = useState(0)
  const [certTemplateUploading, setCertTemplateUploading] = useState(false)
  const [certTemplateDeleting, setCertTemplateDeleting] = useState(false)
  const [wrongNotebook, setWrongNotebook] = useState({
    items: [],
    summary: {
      wrong_question_total: 0,
      unresolved_total: 0,
      improved_total: 0,
      top_tags: [],
    },
    pagination: { page: 1, limit: 20, total: 0, total_pages: 0 },
  })
  const [selectedWrongQuestionIds, setSelectedWrongQuestionIds] = useState([])
  const [retrainRecommendations, setRetrainRecommendations] = useState([])
  const [retrainSummary, setRetrainSummary] = useState({
    wrong_question_total: 0,
    unresolved_total: 0,
    improved_total: 0,
    top_tags: [],
  })
  const [retrainFilters, setRetrainFilters] = useState({
    question_type: 'all',
    question_category: 'all',
  })
  const [retrainHistoryResultId, setRetrainHistoryResultId] = useState('')
  const [retrainStarting, setRetrainStarting] = useState(false)

  const [auditLogs, setAuditLogs] = useState([])
  const [aiLogs, setAiLogs] = useState([])
  const [aiModels, setAiModels] = useState([])
  const [ossSettingsForm, setOssSettingsForm] = useState(() => buildDefaultOssSettingsForm())
  const [ossSettingsStatus, setOssSettingsStatus] = useState({
    configured: false,
    validation_error: '',
    has_access_key_secret: false,
    has_sts_token: false,
  })
  const [ossSettingsLoading, setOssSettingsLoading] = useState(false)
  const [ossSettingsSaving, setOssSettingsSaving] = useState(false)
  const [modelForm, setModelForm] = useState({
    model_key: '',
    name: '',
    base_url: '',
    model_name: '',
    api_key: '',
    timeout_ms: 20000,
    max_tokens: 2048,
    temperature_default: 0.3,
    is_enabled: true,
    is_default: false,
  })
  const [editingAiModelId, setEditingAiModelId] = useState(0)
  const [aiModelEditVisible, setAiModelEditVisible] = useState(false)
  const [aiModelEditSaving, setAiModelEditSaving] = useState(false)
  const [aiModelDeletePendingId, setAiModelDeletePendingId] = useState(0)
  const [aiModelTestPendingId, setAiModelTestPendingId] = useState(0)
  const [aiModelTestResults, setAiModelTestResults] = useState({})
  const [aiModelDraftTestPending, setAiModelDraftTestPending] = useState(false)
  const [aiModelDraftTestResult, setAiModelDraftTestResult] = useState(null)
  const [aiModelEditForm, setAiModelEditForm] = useState({
    name: '',
    base_url: '',
    model_name: '',
    api_key: '',
    max_tokens: 2048,
    is_enabled: true,
    is_default: false,
  })
  const [orgGroupBy, setOrgGroupBy] = useState('department')
  const [orgBreakdown, setOrgBreakdown] = useState([])
  const [userProfiles, setUserProfiles] = useState([])
  const [profileForm, setProfileForm] = useState({
    user_id: '',
    username: '',
    department: '',
    position_title: '',
  })
  const [selectedLearningResourceId, setSelectedLearningResourceId] = useState(0)
  const [learningPlayerNotice, setLearningPlayerNotice] = useState('')
  const [videoRuntime, setVideoRuntime] = useState({ current: 0, duration: 0, playing: false })
  const [isLearningPlayerOpen, setIsLearningPlayerOpen] = useState(false)
  const [learningPlayerVolume, setLearningPlayerVolume] = useState(80)
  const [learningPlayerDragState, setLearningPlayerDragState] = useState(null)
  const [learningPlayerResizeState, setLearningPlayerResizeState] = useState(null)
  const [learningPlayerModal, setLearningPlayerModal] = useState({
    ...buildDefaultPlayerModalRect(),
    maximized: false,
    restoreRect: null,
  })
  const [isDocPreviewOpen, setIsDocPreviewOpen] = useState(false)
  const [docPreviewLoading, setDocPreviewLoading] = useState(false)
  const [docPreviewPayload, setDocPreviewPayload] = useState(null)
  const [docPreviewNotice, setDocPreviewNotice] = useState('')
  const [docPreviewScriptReady, setDocPreviewScriptReady] = useState(false)
  const [docPreviewScriptError, setDocPreviewScriptError] = useState('')
  const [docPreviewContainerId, setDocPreviewContainerId] = useState('te-doc-preview-container')
  const [docPreviewOpenedAt, setDocPreviewOpenedAt] = useState(0)
  const [docPreviewMinSeconds, setDocPreviewMinSeconds] = useState(DOC_PREVIEW_MIN_SECONDS_DEFAULT)
  const [docPreviewThresholdSeconds, setDocPreviewThresholdSeconds] = useState(DOC_PREVIEW_MIN_SECONDS_DEFAULT)
  const [docPreviewThresholdInput, setDocPreviewThresholdInput] = useState(String(DOC_PREVIEW_MIN_SECONDS_DEFAULT))
  const [docPreviewThresholdRange, setDocPreviewThresholdRange] = useState({ min: 15, max: 600 })
  const [docPreviewThresholdSaving, setDocPreviewThresholdSaving] = useState(false)
  const [docPreviewResource, setDocPreviewResource] = useState(null)
  const [docPreviewDragState, setDocPreviewDragState] = useState(null)
  const [docPreviewResizeState, setDocPreviewResizeState] = useState(null)
  const [docPreviewModal, setDocPreviewModal] = useState({
    ...buildDefaultDocPreviewModalRect(),
    maximized: false,
    restoreRect: null,
  })
  const [editingResourceId, setEditingResourceId] = useState(0)
  const [resourceEditForm, setResourceEditForm] = useState({
    name: '',
    resource_type: 'doc',
    source_mode: 'upload',
    storage_backend: 'local',
    source_url: '',
    force_watch: false,
    sort_order: 0,
  })
  const [resourceEditVisible, setResourceEditVisible] = useState(false)
  const [resourceEditSaving, setResourceEditSaving] = useState(false)
  const [resourceDeletePendingId, setResourceDeletePendingId] = useState(0)
  const [courseDeletePendingId, setCourseDeletePendingId] = useState(0)
  const [courseStatusPendingId, setCourseStatusPendingId] = useState(0)
  const [selectedCourseIds, setSelectedCourseIds] = useState([])
  const [courseBatchDeleting, setCourseBatchDeleting] = useState(false)
  const learningVideoRef = useRef(null)
  const learningVideoTrackerRef = useRef({ lastSyncTs: 0, lastPos: 0, maxPos: 0, blockedToastAt: 0 })
  const docPreviewEditorRef = useRef(null)
  const docPreviewStageRef = useRef(null)

  const role = String(user?.role || '').trim().toLowerCase()
  const isAdminRole = role === 'admin'
  const canWrite = isAdminRole || !!user?.permissions?.train_exam_content_write || role === 'editor'
  const canReview = isAdminRole || !!user?.permissions?.train_exam_question_review || role === 'reviewer'
  const canPublishPaper = isAdminRole || !!user?.permissions?.train_exam_paper_publish || role === 'reviewer'
  const canAudit = !!user?.permissions?.train_exam_audit_read || role === 'auditor'
  const canViewAiConfig = isAdminRole
  const isBasicRole = role === 'viewer' || role === 'user'
  const isBasicUser = isBasicRole && !canWrite && !canReview && !canPublishPaper && !canAudit && !canViewAiConfig
  const canSelectQuestionRows = canWrite || canReview

  const clearFeedback = () => {
    setMessage('')
    setError('')
  }

  const destroyDocPreviewEditor = () => {
    if (docPreviewEditorRef.current && typeof docPreviewEditorRef.current.destroyEditor === 'function') {
      docPreviewEditorRef.current.destroyEditor()
    }
    docPreviewEditorRef.current = null
  }

  const loadDocPreviewScript = async () => {
    if (window.DocsAPI?.DocEditor) {
      setDocPreviewScriptReady(true)
      setDocPreviewScriptError('')
      return true
    }

    return new Promise((resolve) => {
      const src = '/doc-editor/web-apps/apps/api/documents/api.js'
      const existed = document.querySelector(`script[src="${src}"]`)
      if (existed) {
        existed.addEventListener('load', () => {
          setDocPreviewScriptReady(true)
          setDocPreviewScriptError('')
          resolve(true)
        }, { once: true })
        existed.addEventListener('error', () => {
          setDocPreviewScriptReady(false)
          setDocPreviewScriptError('Office在线预览服务不可用，请稍后重试。')
          resolve(false)
        }, { once: true })
        return
      }

      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onload = () => {
        setDocPreviewScriptReady(true)
        setDocPreviewScriptError('')
        resolve(true)
      }
      script.onerror = () => {
        setDocPreviewScriptReady(false)
        setDocPreviewScriptError('Office在线预览服务不可用，请稍后重试。')
        resolve(false)
      }
      document.body.appendChild(script)
    })
  }

  const filteredQuestions = useMemo(() => (Array.isArray(questions) ? questions : []), [questions])
  const paperNameById = useMemo(() => {
    const map = new Map()
    ;(Array.isArray(papers) ? papers : []).forEach((item) => {
      const id = Number(item?.id || 0)
      if (id > 0) map.set(id, String(item?.name || '').trim() || `试卷#${id}`)
    })
    return map
  }, [papers])
  const publishedPapers = useMemo(
    () => (Array.isArray(papers) ? papers : []).filter((item) => String(item?.status || '').toLowerCase() === 'published'),
    [papers]
  )
  const historyResultOptions = useMemo(
    () =>
      (Array.isArray(myResults) ? myResults : []).map((item) => ({
        id: Number(item?.id || 0),
        label: buildHistoryResultLabel({
          result: item,
          paperName: paperNameById.get(Number(item?.paper_id || 0)) || '',
        }),
      })).filter((item) => item.id > 0),
    [myResults, paperNameById]
  )

  const maxTrendTotal = useMemo(() => {
    const max = passTrend.reduce((acc, item) => Math.max(acc, Number(item.total || 0)), 0)
    return max > 0 ? max : 1
  }, [passTrend])

  const examProgress = useMemo(() => {
    const total = currentQuestions.length
    const answered = currentQuestions.filter((item) => hasAnyAnswer(item.user_answer)).length
    return {
      total,
      answered,
      pending: Math.max(0, total - answered),
      percent: total > 0 ? Math.round((answered / total) * 100) : 0,
    }
  }, [currentQuestions])

  const resultDetailByQuestionId = useMemo(() => {
    const payload = parseResultDetailPayload(currentResult)
    const details = Array.isArray(payload?.details) ? payload.details : []
    const byId = new Map()
    details.forEach((item) => {
      const qid = Number(item?.question_id || 0)
      if (qid > 0) byId.set(qid, item)
    })
    return byId
  }, [currentResult])

  const selectedLearningResource = useMemo(
    () => learningPath.items.find((item) => Number(item.id) === Number(selectedLearningResourceId || 0)) || null,
    [learningPath.items, selectedLearningResourceId]
  )
  const learningVideoSeekLocked = useMemo(
    () => isLearningVideoSeekLocked(selectedLearningResource),
    [selectedLearningResource]
  )
  const learningVideoRuntimePercent = useMemo(() => {
    const duration = Math.max(0, Number(videoRuntime.duration || 0))
    if (duration > 0) return normalizeLearningProgressPercent((Number(videoRuntime.current || 0) / duration) * 100)
    return normalizeLearningProgressPercent(selectedLearningResource?.progress?.progress_percent)
  }, [selectedLearningResource, videoRuntime.current, videoRuntime.duration])
  const learningVideoRemainingSeconds = useMemo(
    () => Math.max(0, Number(videoRuntime.duration || 0) - Number(videoRuntime.current || 0)),
    [videoRuntime.current, videoRuntime.duration]
  )
  const learningVideoStatusLabel = useMemo(() => {
    if (learningVideoSeekLocked) return '强制播放（首次需完整观看）'
    if (selectedLearningResource?.force_watch) return '已完成，可自由回看'
    return '自由播放'
  }, [learningVideoSeekLocked, selectedLearningResource])
  const currentLearningCourse = useMemo(() => {
    const cid = Number(learningCourseId || 0)
    if (!cid) return learningPath.course || null
    return courses.find((item) => Number(item.id || 0) === cid) || learningPath.course || null
  }, [courses, learningCourseId, learningPath.course])
  const learningFlowItems = useMemo(() => (
    (Array.isArray(learningPath.items) ? learningPath.items : [])
      .slice()
      .sort((a, b) => (
        Number(a?.chapter_no || 0) - Number(b?.chapter_no || 0)
        || Number(a?.sort_order || 0) - Number(b?.sort_order || 0)
        || Number(a?.id || 0) - Number(b?.id || 0)
      ))
      .map((item) => ({
        ...item,
        uiState: resolveLearningFlowState(item),
      }))
  ), [learningPath.items])
  const spotlightLearningItem = useMemo(() => {
    if (!learningFlowItems.length) return null
    const inProgressItem = learningFlowItems.find((item) => item.uiState.key === 'active')
    if (inProgressItem) return inProgressItem
    const nextPendingItem = learningFlowItems.find((item) => item.uiState.key === 'pending')
    if (nextPendingItem) return nextPendingItem
    const blockedItem = learningFlowItems.find((item) => item.uiState.key === 'transcoding' || item.uiState.key === 'failed')
    if (blockedItem) return blockedItem
    return learningFlowItems[0]
  }, [learningFlowItems])
  const currentLearningCourseTitle = useMemo(
    () => String(currentLearningCourse?.title || learningPath.course?.title || '').trim() || '未命名课程',
    [currentLearningCourse, learningPath.course]
  )
  const hasLearningPathTranscoding = useMemo(
    () =>
      Array.isArray(learningPath.items) &&
      learningPath.items.some((item) => {
        if (String(item?.resource_type || '').toLowerCase() !== 'video') return false
        const status = String(item?.transcode_status || '').toLowerCase()
        return status === 'queued' || status === 'running'
      }),
    [learningPath.items]
  )
  const certTemplatePreviewUrl = useMemo(() => {
    const previewPath = String(certTemplate?.preview_url || '').trim()
    if (!previewPath) return ''
    if (previewPath.startsWith('http://') || previewPath.startsWith('https://')) return previewPath
    return `${API_BASE}${previewPath}`
  }, [certTemplate?.preview_url])

  const personalResultsSummary = useMemo(() => {
    const rows = Array.isArray(myResults) ? myResults : []
    const total = rows.length
    const passCount = rows.filter((item) => Number(item?.passed || 0) === 1).length
    return {
      total,
      passCount,
      failCount: Math.max(0, total - passCount),
    }
  }, [myResults])

  const studentOverallRows = useMemo(
    () => buildStudentOverallRows({ items: studentOverall.sourceItems, filters: studentOverall.filters }),
    [studentOverall.sourceItems, studentOverall.filters]
  )
  const studentOverallSummary = useMemo(
    () => buildStudentOverallSummary(studentOverallRows),
    [studentOverallRows]
  )
  const studentOverallDepartments = useMemo(
    () => buildStudentOverallDepartments(studentOverall.sourceItems),
    [studentOverall.sourceItems]
  )

  const resultReviewTypeStats = useMemo(
    () => (Array.isArray(resultReviewDetail?.report?.by_type) ? resultReviewDetail.report.by_type : []),
    [resultReviewDetail]
  )

  const dashboardTips = useMemo(() => {
    const tips = []
    if (Number(overview.question_draft_total || 0) > 0) {
      tips.push(`当前有 ${overview.question_draft_total} 道草稿题，建议优先审核发布以提升可组卷规模。`)
    }
    if (Number(overview.paper_published_total || 0) === 0) {
      tips.push('当前还没有已发布试卷，建议先发布至少一套固定试卷用于首轮培训验收。')
    }
    if (Number(overview.pass_rate || 0) < 70) {
      tips.push('最终通过率低于 70%，建议补充错题讲解视频并提高复训触达频次。')
    }
    if (!tips.length) {
      tips.push('核心指标稳定，可进入 V2：错题本、岗位画像推荐、证书到期复训。')
    }
    return tips.slice(0, 3)
  }, [overview])

  const aiModelOverview = useMemo(() => {
    const rows = Array.isArray(aiModels) ? aiModels : []
    const total = rows.length
    const enabled = rows.filter((item) => Number(item?.is_enabled || 0) === 1).length
    const defaultModel = rows.find((item) => Number(item?.is_default || 0) === 1) || null
    const providers = Array.from(new Set(rows.map((item) => String(item?.name || '').trim()).filter((item) => item.length > 0)))
    return {
      total,
      enabled,
      disabled: Math.max(0, total - enabled),
      defaultName: defaultModel ? String(defaultModel.name || defaultModel.model_key || `ID-${defaultModel.id}`) : '未设置',
      providers: providers.slice(0, 8),
    }
  }, [aiModels])
  const currentEditingAiModel = useMemo(
    () => (Array.isArray(aiModels) ? aiModels.find((item) => Number(item?.id || 0) === Number(editingAiModelId || 0)) : null) || null,
    [aiModels, editingAiModelId]
  )

  const fetchBootstrap = async () => {
    setBooting(true)
    clearFeedback()
    try {
      const me = await api.get('/api/train-exam/auth/me')
      setUser(me)
      const meRole = String(me?.role || '').trim().toLowerCase()
      const meIsBasicUser = (meRole === 'viewer' || meRole === 'user')
        && !me?.permissions?.train_exam_content_write
        && !me?.permissions?.train_exam_question_review
        && !me?.permissions?.train_exam_paper_publish
        && !me?.permissions?.train_exam_audit_read
      setActiveMenu(meIsBasicUser ? 'courses' : 'dashboard')

      if (meIsBasicUser) {
        const items = await fetchCourses(true)
        await Promise.all([
          fetchDocPreviewSettings(true),
          fetchMyLearningProgress(true),
          fetchPapers(true),
          fetchMyResults(true),
        ])
        const firstId = Number(items?.[0]?.id || 0)
        if (firstId) await fetchLearningPath(firstId, true)
        const restored = await restorePersistedExamSession({ silent: true })
        if (restored) return
        return
      }

      await Promise.all([
        fetchOverview(true),
        fetchCourses(true),
        fetchDocPreviewSettings(true),
        fetchQuestionCategories(true),
        fetchQuestions(true),
        fetchPapers(true),
        fetchMyResults(true),
        fetchCertificateTemplate(true),
      ])
      await restorePersistedExamSession({ silent: true })
    } catch (err) {
      if (Number(err?.status) === 401 || String(err?.message || '').includes('未登录')) {
        window.location.replace(buildPortalEntryUrl('train-exam'))
        return
      }
      setError(err.message || '初始化失败')
    } finally {
      setBooting(false)
    }
  }

  const onSwitchSystem = () => {
    window.location.href = buildPortalSwitchUrl('train-exam')
  }

  const onLogout = async () => {
    if (logoutPending) return
    setLogoutPending(true)
    try {
      const csrfResp = await fetch(`${API_BASE}/api/auth/csrf`, {
        credentials: 'include',
      })
      if (csrfResp.ok) {
        const csrfPayload = await csrfResp.json().catch(() => ({}))
        const csrfToken = String(csrfPayload?.token || '')
        if (csrfToken) {
          await fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'X-CSRF-Token': csrfToken,
            },
          })
        }
      }
    } catch {
      // 忽略异常，仍然跳转到登录页
    }
    window.location.replace(buildPortalLoginUrl())
  }

  const fetchOverview = async (silent = false) => {
    if (!silent) clearFeedback()
    const [statsData, trendData] = await Promise.all([
      api.get('/api/train-exam/stats/overview'),
      api.get('/api/train-exam/stats/pass-trend?days=14'),
    ])
    setOverview(statsData || {})
    setPassTrend(Array.isArray(trendData) ? trendData : [])
  }

  const fetchCourses = async (silent = false) => {
    if (!silent) clearFeedback()
    const pageSize = 200
    let page = 1
    let total = 0
    const all = []
    while (true) {
      const payload = await api.get(`/api/train-exam/courses?page=${page}&limit=${pageSize}`)
      const items = Array.isArray(payload?.items) ? payload.items : []
      total = Math.max(0, Number(payload?.total || 0))
      all.push(...items)
      if (!items.length || all.length >= total) break
      page += 1
    }
    setCourses(all)
    return all
  }

  const fetchDocPreviewSettings = async (silent = true) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/settings')
    const minLimit = Math.max(1, Number(payload?.doc_preview_min_seconds_min || 15))
    const maxLimit = Math.max(minLimit, Number(payload?.doc_preview_min_seconds_max || 600))
    const valueRaw = Number(payload?.doc_preview_min_seconds || DOC_PREVIEW_MIN_SECONDS_DEFAULT)
    const value = Math.max(minLimit, Math.min(maxLimit, Number.isFinite(valueRaw) ? Math.round(valueRaw) : DOC_PREVIEW_MIN_SECONDS_DEFAULT))
    setDocPreviewThresholdRange({ min: minLimit, max: maxLimit })
    setDocPreviewThresholdSeconds(value)
    setDocPreviewThresholdInput(String(value))
    return { min: minLimit, max: maxLimit, value }
  }

  const onSaveDocPreviewThreshold = async () => {
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可配置文档学习阈值')
      return
    }
    if (docPreviewThresholdSaving) return

    const minLimit = Math.max(1, Number(docPreviewThresholdRange?.min || 15))
    const maxLimit = Math.max(minLimit, Number(docPreviewThresholdRange?.max || 600))
    const valueRaw = Number(docPreviewThresholdInput)
    if (!Number.isFinite(valueRaw)) {
      setError(`请输入 ${minLimit}-${maxLimit} 的整数秒`)
      return
    }
    const value = Math.round(valueRaw)
    if (value < minLimit || value > maxLimit) {
      setError(`文档学习阈值必须在 ${minLimit}-${maxLimit} 秒之间`)
      return
    }

    setDocPreviewThresholdSaving(true)
    try {
      const payload = await api.put('/api/train-exam/settings/doc-preview-threshold', {
        min_read_seconds: value,
      })
      const nextMin = Math.max(1, Number(payload?.doc_preview_min_seconds_min || minLimit))
      const nextMax = Math.max(nextMin, Number(payload?.doc_preview_min_seconds_max || maxLimit))
      const nextValueRaw = Number(payload?.doc_preview_min_seconds || value)
      const nextValue = Math.max(nextMin, Math.min(nextMax, Number.isFinite(nextValueRaw) ? Math.round(nextValueRaw) : value))
      setDocPreviewThresholdRange({ min: nextMin, max: nextMax })
      setDocPreviewThresholdSeconds(nextValue)
      setDocPreviewThresholdInput(String(nextValue))
      setMessage(`文档学习阈值已更新为 ${nextValue} 秒`)
    } catch (err) {
      setError(err.message || '保存文档学习阈值失败')
    } finally {
      setDocPreviewThresholdSaving(false)
    }
  }

  const buildQuestionQueryString = ({ page, limit, filters }) => {
    const params = new URLSearchParams()
    params.set('page', String(Math.max(1, Number(page || 1))))
    params.set('limit', String(Math.max(1, Number(limit || 10))))
    const keyword = String(filters?.keyword || '').trim()
    const status = String(filters?.status || 'all').trim().toLowerCase()
    const source = String(filters?.source || 'all').trim().toLowerCase()
    const category = String(filters?.category || 'all').trim()
    if (keyword) params.set('keyword', keyword)
    if (status && status !== 'all') params.set('status', status)
    if (source && source !== 'all') params.set('source_type', source)
    if (category && category !== 'all') params.set('question_category', category)
    return params.toString()
  }

  const fetchQuestions = async (silent = false, options = {}) => {
    if (!silent) clearFeedback()
    const page = Math.max(1, Number(options?.page || questionPagination.page || 1))
    const limit = Math.max(1, Number(options?.limit || questionPagination.limit || 10))
    const filters = options?.filters || questionFilters
    const queryString = buildQuestionQueryString({ page, limit, filters })
    const payload = await api.get(`/api/train-exam/questions?${queryString}`)
    const items = Array.isArray(payload?.items) ? payload.items : []
    const total = Math.max(0, Number(payload?.total || 0))
    const serverLimit = Math.max(1, Number(payload?.limit || limit || 10))
    const serverPage = Math.max(1, Number(payload?.page || page || 1))
    const totalPages = Math.max(1, Number(payload?.total_pages || Math.ceil(total / serverLimit) || 1))
    const categories = Array.isArray(payload?.categories) ? payload.categories : []
    setQuestions(items)
    setQuestionPagination({
      page: serverPage,
      limit: serverLimit,
      total,
      totalPages,
    })
    setQuestionCategories(categories)
    return payload
  }

  const fetchQuestionCategories = async (silent = true) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/question-categories')
    const rows = Array.isArray(payload) ? payload : []
    setQuestionCategoryRows(rows)
    const names = rows
      .map((item) => String(item?.name || '').trim())
      .filter((item) => item.length > 0)
    setQuestionCategories(names)
    return rows
  }

  const fetchPapers = async (silent = false) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/papers')
    const items = Array.isArray(payload) ? payload : []
    setPapers(items)
    const idSet = new Set(items.map((item) => Number(item.id || 0)).filter((id) => id > 0))
    setSelectedPaperIds((prev) => prev.filter((id) => idSet.has(Number(id || 0))))
    return items
  }

  const fetchMyResults = async (silent = false) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/my/results')
    const rows = Array.isArray(payload) ? payload : []
    setMyResults(rows)
    return rows
  }

  const fetchMyInstructorReviewForms = async (silent = false) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/my/instructor-review-forms')
    const rows = Array.isArray(payload?.items) ? payload.items : []
    setMyInstructorReviewForms(rows)
    return rows
  }

  const fetchAdminInstructorReviewForms = async (silent = false) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/admin/instructor-review-forms')
    const rows = Array.isArray(payload?.items) ? payload.items : []
    setAdminInstructorReviewForms(rows)
    return rows
  }

  const fetchAdminInstructorReviewResponses = async (formId, silent = false) => {
    const id = Number(formId || 0)
    if (!id) return null
    if (!silent) clearFeedback()
    const payload = await api.get(`/api/train-exam/admin/instructor-review-forms/${id}/responses`)
    const next = payload && typeof payload === 'object' ? payload : { form: null, items: [], summary: {} }
    setAdminInstructorReviewResponses({
      form: next.form || null,
      items: Array.isArray(next.items) ? next.items : [],
      summary: next.summary && typeof next.summary === 'object' ? next.summary : {},
    })
    return next
  }

  const onSubmitInstructorQuestionnaire = async (e) => {
    e.preventDefault()
    clearFeedback()
    try {
      const created = await api.post('/api/train-exam/admin/instructor-review-forms', instructorQuestionnaireForm)
      setMessage(`讲师评价问卷已创建：${created.title}`)
      setInstructorQuestionnaireForm({ title: '', instructor_name: '', description: '', status: 'draft' })
      await fetchAdminInstructorReviewForms(true)
    } catch (err) {
      setError(err.message || '创建讲师评价问卷失败')
    }
  }

  const onUpdateInstructorQuestionnaireStatus = async (item, status) => {
    const id = Number(item?.id || 0)
    if (!id) return
    clearFeedback()
    try {
      const updated = await api.put(`/api/train-exam/admin/instructor-review-forms/${id}`, {
        title: item.title,
        instructor_name: item.instructor_name,
        description: item.description || '',
        status,
      })
      setMessage(`问卷状态已更新：${updated.title}`)
      await fetchAdminInstructorReviewForms(true)
      if (Number(adminInstructorReviewResponses.form?.id || 0) === id) {
        await fetchAdminInstructorReviewResponses(id, true)
      }
    } catch (err) {
      setError(err.message || '更新问卷状态失败')
    }
  }

  const onOpenInstructorReviewScheduleDialog = (item) => {
    clearFeedback()
    setInstructorReviewScheduleDialog(item)
    setInstructorReviewScheduleForm(getShanghaiDateTimeParts(item?.scheduled_publish_at))
  }

  const onCloseInstructorReviewScheduleDialog = () => {
    if (instructorReviewScheduleSaving) return
    setInstructorReviewScheduleDialog(null)
  }

  const onSubmitInstructorReviewSchedule = async (event) => {
    event.preventDefault()
    if (!instructorReviewScheduleDialog?.id || instructorReviewScheduleSaving) return
    clearFeedback()
    const scheduledAt = buildScheduledPublishAt(instructorReviewScheduleForm)
    if (!scheduledAt) {
      setError('请选择定时发布的日期和时间')
      return
    }
    setInstructorReviewScheduleSaving(true)
    try {
      await api.post(`/api/train-exam/admin/instructor-review-forms/${instructorReviewScheduleDialog.id}/schedule-publish`, {
        scheduled_publish_at: scheduledAt,
      })
      setMessage('讲师评价问卷定时发布设置成功')
      setInstructorReviewScheduleDialog(null)
      await fetchAdminInstructorReviewForms(true)
      if (Number(adminInstructorReviewResponses.form?.id || 0) === Number(instructorReviewScheduleDialog.id || 0)) {
        await fetchAdminInstructorReviewResponses(instructorReviewScheduleDialog.id, true)
      }
    } catch (err) {
      setError(err.message || '设置讲师评价定时发布失败')
    } finally {
      setInstructorReviewScheduleSaving(false)
    }
  }

  const onSubmitInstructorReview = async (e) => {
    e.preventDefault()
    if (instructorReviewSaving) return
    const formId = Number(instructorReviewResponseForm.form_id || 0)
    if (!formId) {
      setError('请选择要评价的讲师问卷')
      return
    }
    setInstructorReviewSaving(true)
    try {
      await api.post(`/api/train-exam/instructor-review-forms/${formId}/response`, instructorReviewResponseForm)
      setMessage('讲师评价已提交')
      setInstructorReviewResponseForm((prev) => ({ ...prev, feedback: '' }))
      await fetchMyInstructorReviewForms(true)
    } catch (err) {
      setError(err.message || '提交讲师评价失败')
    } finally {
      setInstructorReviewSaving(false)
    }
  }

  const fetchAdminResults = async (silent = false, options = {}) => {
    if (!silent) clearFeedback()
    const page = Math.max(1, Number(options?.page || adminResultsPagination.page || 1))
    const limit = Math.max(1, Number(options?.limit || adminResultsPagination.limit || 20))
    const filters = options?.filters || adminResultsFilters
    setAdminResultsLoading(true)
    try {
      const queryString = buildAdminResultsQueryString({ page, limit, filters })
      const payload = await api.get(`/api/train-exam/admin/results?${queryString}`)
      const items = Array.isArray(payload?.items) ? payload.items : []
      const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : buildResultCenterDefaultSummary()
      const filterPayload = payload?.filters && typeof payload.filters === 'object' ? payload.filters : {}
      const total = Math.max(0, Number(payload?.total || 0))
      const serverLimit = Math.max(1, Number(payload?.limit || limit || 20))
      const serverPage = Math.max(1, Number(payload?.page || page || 1))
      const totalPages = Math.max(1, Number(payload?.total_pages || Math.ceil(total / serverLimit) || 1))
      setAdminResults(items)
      setAdminResultsSummary(summary)
      setAdminResultsPagination({
        page: serverPage,
        limit: serverLimit,
        total,
        totalPages,
      })
      setAdminResultUsers(Array.isArray(filterPayload?.users) ? filterPayload.users : [])
      setAdminResultPapers(Array.isArray(filterPayload?.papers) ? filterPayload.papers : [])
      return payload
    } finally {
      setAdminResultsLoading(false)
    }
  }

  const fetchAdminResultPapers = async (silent = false) => {
    if (!silent) clearFeedback()
    setAdminResultPapersLoading(true)
    try {
      const payload = await api.get('/api/train-exam/admin/results/papers')
      const items = Array.isArray(payload?.items) ? payload.items : []
      setAdminResultPaperOverview({ items })
      return items
    } finally {
      setAdminResultPapersLoading(false)
    }
  }

  const fetchAdminExamTimeoutRecords = async (paper = null) => {
    clearFeedback()
    const paperId = Number(paper?.paper_id || paper?.id || 0)
    setAdminExamTimeoutRecords({ paper, items: [], loading: true })
    try {
      const query = paperId > 0 ? `?paper_id=${paperId}` : ''
      const payload = await api.get(`/api/train-exam/admin/exam-timeouts${query}`)
      setAdminExamTimeoutRecords({
        paper,
        items: Array.isArray(payload?.items) ? payload.items : [],
        loading: false,
      })
    } catch (err) {
      setAdminExamTimeoutRecords({ paper, items: [], loading: false })
      setError(err.message || '加载超时用户失败')
    }
  }

  const fetchStudentOverall = async (silent = false) => {
    if (!silent) clearFeedback()
    setStudentOverall((prev) => ({ ...prev, loading: true }))
    try {
      const firstQuery = buildAdminResultsQueryString({
        page: 1,
        limit: STUDENT_OVERALL_PAGE_LIMIT,
        filters: {
          keyword: '',
          user_id: '',
          paper_id: '',
          passed: 'all',
          final_only: false,
          date_from: '',
          date_to: '',
        },
      })
      const firstPayload = await api.get(`/api/train-exam/admin/results?${firstQuery}`)
      const firstItems = Array.isArray(firstPayload?.items) ? firstPayload.items : []
      const totalPages = Math.max(1, Number(firstPayload?.total_pages || 1))
      const pagePayloads = []
      for (let page = 2; page <= totalPages; page += 1) {
        const queryString = buildAdminResultsQueryString({
          page,
          limit: STUDENT_OVERALL_PAGE_LIMIT,
          filters: {
            keyword: '',
            user_id: '',
            paper_id: '',
            passed: 'all',
            final_only: false,
            date_from: '',
            date_to: '',
          },
        })
        pagePayloads.push(api.get(`/api/train-exam/admin/results?${queryString}`))
      }
      const restPayloads = await Promise.all(pagePayloads)
      const restItems = restPayloads.flatMap((payload) => (Array.isArray(payload?.items) ? payload.items : []))
      const sourceItems = [...firstItems, ...restItems]
      setStudentOverall((prev) => ({
        ...prev,
        sourceItems,
        loading: false,
      }))
      return sourceItems
    } catch (err) {
      setStudentOverall((prev) => ({ ...prev, loading: false }))
      throw err
    }
  }

  const updateStudentOverallFilters = (patch) => {
    setStudentOverall((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        ...(patch || {}),
      },
    }))
  }

  const resetStudentOverallFilters = () => {
    setStudentOverall((prev) => ({
      ...prev,
      filters: buildStudentOverallDefault().filters,
    }))
  }

  const onExportStudentOverall = () => {
    const headers = ['学员', '部门', '岗位', '考试次数', '最近考试', '各次分数', '平均分', '总体评价']
    const lines = [headers.join(',')]
    studentOverallRows.forEach((item) => {
      const attemptText = item.attempts
        .map((attempt) => `${attempt.paperName}:${attempt.score.toFixed(2)}/${attempt.totalScore.toFixed(2)}`)
        .join('；')
      const cells = [
        item.username,
        item.department,
        item.position,
        item.total,
        formatDateTime(item.latestExamAt),
        attemptText,
        Number(item.averageScore || 0).toFixed(2),
        item.evaluation?.label || '-',
      ]
      lines.push(cells.map((value) => {
        const text = String(value ?? '')
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
      }).join(','))
    })
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    triggerBrowserDownload(blob, `student-overall-${Date.now()}.csv`)
  }

  const onOpenPaperResults = async (paper) => {
    const paperId = Number(paper?.paper_id || paper?.id || 0)
    if (!paperId) {
      setError('试卷信息无效')
      return
    }
    const nextFilters = {
      ...adminResultsFilters,
      paper_id: String(paperId),
    }
    setAdminResultsFilters(nextFilters)
    setResultCenterView({
      type: 'list',
      from: 'papers',
      resultId: 0,
      userId: 0,
      paperId,
    })
    try {
      await fetchAdminResults(true, { page: 1, filters: nextFilters })
    } catch (err) {
      setError(err.message || '加载试卷成绩失败')
    }
  }

  const onExportAdminResults = async () => {
    if (adminResultsExporting) return
    setAdminResultsExporting(true)
    try {
      const queryString = buildAdminResultsQueryString({
        page: 1,
        limit: adminResultsPagination.limit || 20,
        filters: adminResultsFilters,
      })
      await downloadTrainExamFile({
        path: `/api/train-exam/admin/results/export.csv?${queryString}`,
        fallbackFilename: 'train-exam-results.csv',
      })
      setMessage('考试结果已开始导出')
    } catch (err) {
      setError(err.message || '导出考试结果失败')
    } finally {
      setAdminResultsExporting(false)
    }
  }

  const fetchResultReviewDetail = async (resultId, { silent = false, force = false } = {}) => {
    const rid = Number(resultId || 0)
    if (!rid) return null
    if (!silent) clearFeedback()
    if (!force && resultReviewCache[rid]) {
      const cached = resultReviewCache[rid]
      setResultReviewDetail(cached)
      return cached
    }
    setResultReviewLoading(true)
    try {
      const payload = await api.get(`/api/train-exam/results/${rid}/review-detail`)
      setResultReviewDetail(payload || null)
      setResultReviewCache((prev) => ({ ...prev, [rid]: payload || null }))
      return payload || null
    } finally {
      setResultReviewLoading(false)
    }
  }

  const fetchCandidateRecord = async (userId, { silent = false, page = 1, limit = 10, filters } = {}) => {
    const uid = Number(userId || 0)
    if (!uid) return null
    if (!silent) clearFeedback()
    setCandidateRecordLoading(true)
    try {
      const queryString = buildAdminResultsQueryString({
        page,
        limit,
        filters: {
          ...(filters || adminResultsFilters),
          user_id: String(uid),
        },
      })
      const payload = await api.get(`/api/train-exam/admin/users/${uid}/results?${queryString}`)
      setCandidateRecord(payload && typeof payload === 'object' ? {
        ...buildCandidateRecordDefault(),
        ...payload,
        items: Array.isArray(payload?.items) ? payload.items : [],
      } : buildCandidateRecordDefault())
      return payload
    } finally {
      setCandidateRecordLoading(false)
    }
  }

  const onOpenResultReviewDetail = async (resultId, { from = 'list', userId = 0, silent = false } = {}) => {
    try {
      const payload = await fetchResultReviewDetail(resultId, { silent })
      if (!payload) return
      setResultCenterView({
        type: 'detail',
        from,
        resultId: Number(resultId || 0),
        userId: Number(userId || payload?.summary?.user_id || 0),
      })
      if (!silent) setMessage(`已打开卷面详情：结果 #${Number(resultId || 0)}`)
    } catch (err) {
      setError(err.message || '打开卷面详情失败，请稍后重试')
    }
  }

  const onOpenCandidateRecord = async (userId, { silent = false } = {}) => {
    const uid = Number(userId || 0)
    if (!uid) {
      setError('考生信息无效')
      return
    }
    try {
      await fetchCandidateRecord(uid, {
        silent,
        page: 1,
        limit: candidateRecord.limit || 10,
      })
      setResultCenterView({
        type: 'candidate',
        from: 'list',
        resultId: 0,
        userId: uid,
      })
      if (!silent) setMessage(`已打开考生记录：用户 #${uid}`)
    } catch (err) {
      setError(err.message || '加载考生记录失败')
    }
  }

  const refreshAdminResultViews = async ({ userId = 0 } = {}) => {
    const tasks = [
      fetchAdminResults(true, { page: adminResultsPagination.page, limit: adminResultsPagination.limit }),
      fetchAdminResultPapers(true),
    ]
    if (activeMenu === 'student-overall') {
      tasks.push(fetchStudentOverall(true))
    }
    if (resultCenterView.type === 'candidate' && Number(userId || resultCenterView.userId || 0) > 0) {
      tasks.push(fetchCandidateRecord(Number(userId || resultCenterView.userId), {
        silent: true,
        page: candidateRecord.page || 1,
        limit: candidateRecord.limit || 10,
      }))
    }
    await Promise.all(tasks)
  }

  const onGrantRetakeOpportunity = async (item) => {
    const userId = Number(item?.user_id || 0)
    const paperId = Number(item?.paper_id || 0)
    if (!userId || !paperId) {
      setError('考生或试卷信息无效')
      return
    }
    const username = item?.username || `用户#${userId}`
    const paperName = item?.paper_name || `试卷#${paperId}`
    const confirmed = window.confirm(`确认为“${username}”开放“${paperName}”的补考机会吗？`)
    if (!confirmed) return
    const pendingKey = `grant-${userId}-${paperId}`
    setAdminResultActionPendingId(pendingKey)
    clearFeedback()
    try {
      await api.post(`/api/train-exam/admin/users/${userId}/papers/${paperId}/retake-opportunities`, {
        reason: '管理员手动开放补考',
      })
      setMessage(`已为 ${username} 开放补考机会`)
      await refreshAdminResultViews({ userId })
    } catch (err) {
      setError(err.message || '开放补考机会失败')
    } finally {
      setAdminResultActionPendingId('')
    }
  }

  const onDeleteAdminResult = async (item) => {
    const resultId = Number(item?.id || 0)
    if (!resultId) {
      setError('考试成绩无效')
      return
    }
    const username = item?.username || `用户#${item?.user_id || '-'}`
    const paperName = item?.paper_name || `试卷#${item?.paper_id || '-'}`
    const confirmed = window.confirm(`确认删除“${username}”在“${paperName}”的成绩 #${resultId} 吗？删除后会自动开放一次补考机会。`)
    if (!confirmed) return
    const pendingKey = `delete-${resultId}`
    setAdminResultActionPendingId(pendingKey)
    clearFeedback()
    try {
      await api.del(`/api/train-exam/admin/results/${resultId}`)
      setResultReviewCache((prev) => {
        const next = { ...prev }
        delete next[resultId]
        return next
      })
      if (Number(resultCenterView.resultId || 0) === resultId) {
        setResultCenterView((prev) => ({ ...prev, type: prev.from === 'candidate' ? 'candidate' : 'list', resultId: 0 }))
        setResultReviewDetail(null)
      }
      setMessage(`已删除成绩 #${resultId}，并开放补考机会`)
      await refreshAdminResultViews({ userId: Number(item?.user_id || 0) })
    } catch (err) {
      setError(err.message || '删除考试成绩失败')
    } finally {
      setAdminResultActionPendingId('')
    }
  }

  const onBackToResultCenter = async () => {
    if (resultCenterView.type === 'detail' && resultCenterView.from === 'candidate' && Number(resultCenterView.userId || 0) > 0) {
      setResultCenterView((prev) => ({ ...prev, type: 'candidate', resultId: 0 }))
      return
    }
    if (resultCenterView.type === 'detail' && resultCenterView.from === 'list') {
      setResultCenterView((prev) => ({ ...prev, type: 'list', resultId: 0 }))
      return
    }
    setResultCenterView({ type: 'papers', from: 'papers', resultId: 0, userId: 0, paperId: 0 })
    if (!isBasicUser && !adminResultPaperOverview.items.length) {
      try {
        await fetchAdminResultPapers(true)
      } catch (err) {
        setError(err.message || '加载考试结果失败')
      }
    }
  }

  const onExportMyResults = async () => {
    if (myResultsExporting) return
    setMyResultsExporting(true)
    try {
      await downloadTrainExamFile({
        path: '/api/train-exam/my/results/export.csv',
        fallbackFilename: 'train-exam-my-results.csv',
      })
      setMessage('考试结果已开始导出')
    } catch (err) {
      setError(err.message || '导出考试结果失败')
    } finally {
      setMyResultsExporting(false)
    }
  }

  const fetchLearningPath = async (courseId, silent = false) => {
    const cid = Number(courseId || 0)
    if (!cid) return
    if (!silent) clearFeedback()
    const payload = await api.get(`/api/train-exam/courses/${cid}/learning-path`)
    setLearningCourseId(String(cid))
    const nextItems = Array.isArray(payload?.items) ? payload.items : []
    setLearningPath({
      course: payload?.course || null,
      summary: payload?.summary || {
        total_resources: 0,
        completed_resources: 0,
        in_progress_resources: 0,
        not_started_resources: 0,
        completion_rate: 0,
      },
      items: nextItems,
    })
    const selectedExists = nextItems.some((item) => Number(item.id) === Number(selectedLearningResourceId || 0))
    if (!selectedExists) {
      const videoItems = nextItems
        .filter((item) => String(item.resource_type || '').toLowerCase() === 'video')
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
      const readyVideo = videoItems.find((item) => {
        const status = String(item?.transcode_status || 'none').toLowerCase()
        return status !== 'queued' && status !== 'running'
      })
      setSelectedLearningResourceId(Number((readyVideo || videoItems[0])?.id || 0))
    }
  }

  const fetchMyLearningProgress = async (silent = false) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/my/learning-progress')
    setMyLearningProgress({
      summary: payload?.summary || { total_courses: 0, completed_courses: 0, average_completion_rate: 0 },
      items: Array.isArray(payload?.items) ? payload.items : [],
    })
  }

  const closeCourseLearningModal = () => {
    setCourseLearningDragState(null)
    setCourseLearningResizeState(null)
    setIsCourseLearningModalOpen(false)
  }

  const onOpenCourseLearningModal = async (course) => {
    const cid = Number(course?.id || course || 0)
    if (!cid) {
      setError('课程不存在')
      return
    }
    clearFeedback()
    setCourseLearningPendingId(cid)
    try {
      await Promise.all([
        fetchLearningPath(cid, true),
        fetchMyLearningProgress(true),
      ])
      setIsCourseLearningModalOpen(true)
    } catch (err) {
      setError(err.message || '加载课程学习路径失败')
    } finally {
      setCourseLearningPendingId(0)
    }
  }

  const onCourseLearningHeaderPointerDown = (e) => {
    if (courseLearningModal.maximized) return
    const tagName = String(e.target?.tagName || '').toLowerCase()
    if (['button', 'input', 'select', 'textarea', 'label', 'a'].includes(tagName)) return
    e.preventDefault()
    setCourseLearningDragState({
      startX: Number(e.clientX || 0),
      startY: Number(e.clientY || 0),
      startLeft: Number(courseLearningModal.left || 0),
      startTop: Number(courseLearningModal.top || 0),
    })
  }

  const onCourseLearningResizePointerDown = (e) => {
    if (courseLearningModal.maximized) return
    e.preventDefault()
    setCourseLearningResizeState({
      startX: Number(e.clientX || 0),
      startY: Number(e.clientY || 0),
      startWidth: Number(courseLearningModal.width || 0),
      startHeight: Number(courseLearningModal.height || 0),
    })
  }

  const onToggleCourseLearningMaximize = () => {
    if (!isCourseLearningModalOpen) return
    if (courseLearningModal.maximized) {
      const restore = courseLearningModal.restoreRect || buildDefaultCourseLearningModalRect()
      const rect = clampCourseLearningModalRect(restore)
      setCourseLearningModal({
        ...rect,
        maximized: false,
        restoreRect: null,
      })
      return
    }
    const currentRect = clampCourseLearningModalRect(courseLearningModal)
    const vw = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1440
    const vh = typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 900
    setCourseLearningModal({
      left: 8,
      top: 8,
      width: Math.max(520, vw - 16),
      height: Math.max(360, vh - 16),
      maximized: true,
      restoreRect: currentRect,
    })
  }

  const fetchCertificateCenter = async (silent = false) => {
    if (!silent) clearFeedback()
    const [certs, jobs] = await Promise.all([
      api.get('/api/train-exam/my/certificates'),
      api.get('/api/train-exam/my/recertification'),
    ])
    setMyCertificates(Array.isArray(certs) ? certs : [])
    setMyRecertJobs(Array.isArray(jobs) ? jobs : [])
  }

  const fetchCertificateTemplate = async (silent = false) => {
    if (!silent) clearFeedback()
    const payload = await api.get('/api/train-exam/certificate-template')
    setCertTemplate(payload && typeof payload === 'object' ? payload : { exists: false })
    return payload
  }

  const fetchOrgBreakdown = async (groupBy = orgGroupBy, silent = false) => {
    if (!silent) clearFeedback()
    const key = String(groupBy || 'department')
    const payload = await api.get(`/api/train-exam/stats/org-breakdown?group_by=${encodeURIComponent(key)}&final_only=true`)
    setOrgGroupBy(key)
    setOrgBreakdown(Array.isArray(payload?.items) ? payload.items : [])
  }

  const fetchRetrainCenter = async (silent = false) => {
    if (!silent) clearFeedback()
    const [wrongPayload, recommendPayload] = await Promise.all([
      api.get('/api/train-exam/my/wrong-questions?page=1&limit=100'),
      api.get('/api/train-exam/my/retrain-recommendations?limit=6'),
    ])

    setWrongNotebook({
      items: Array.isArray(wrongPayload?.items) ? wrongPayload.items : [],
      summary: wrongPayload?.summary || {
        wrong_question_total: 0,
        unresolved_total: 0,
        improved_total: 0,
        top_tags: [],
      },
      pagination: wrongPayload?.pagination || { page: 1, limit: 100, total: 0, total_pages: 0 },
    })
    setRetrainRecommendations(Array.isArray(recommendPayload?.recommendations) ? recommendPayload.recommendations : [])
    setRetrainSummary(recommendPayload?.summary || {
      wrong_question_total: 0,
      unresolved_total: 0,
      improved_total: 0,
      top_tags: [],
    })
  }

  const fetchAudit = async () => {
    clearFeedback()
    const [opLogs, aiTaskLogs] = await Promise.all([
      api.get('/api/train-exam/audit/logs?limit=200'),
      api.get('/api/train-exam/ai/logs?limit=200'),
    ])
    setAuditLogs(Array.isArray(opLogs) ? opLogs : [])
    setAiLogs(Array.isArray(aiTaskLogs) ? aiTaskLogs : [])
    if (isAdminRole) {
      const models = await api.get('/api/train-exam/ai/models')
      setAiModels(Array.isArray(models) ? models : [])
    } else {
      setAiModels([])
    }
  }

  const fetchAiModels = async (silent = false) => {
    if (!silent) clearFeedback()
    const rows = await api.get('/api/train-exam/ai/models')
    setAiModels(Array.isArray(rows) ? rows : [])
  }

  const fetchOssSettings = async (silent = false) => {
    if (!silent) clearFeedback()
    if (!isAdminRole) {
      setOssSettingsForm(buildDefaultOssSettingsForm())
      setOssSettingsStatus({
        configured: false,
        validation_error: '',
        has_access_key_secret: false,
        has_sts_token: false,
      })
      return
    }
    setOssSettingsLoading(true)
    try {
      const payload = await api.get('/api/train-exam/settings/oss')
      const normalized = normalizeOssSettingsResponse(payload)
      setOssSettingsForm(normalized.form)
      setOssSettingsStatus(normalized.status)
    } finally {
      setOssSettingsLoading(false)
    }
  }

  const fetchAiConfigCenter = async (silent = false) => {
    if (!silent) clearFeedback()
    await Promise.all([
      fetchAiModels(true),
      fetchOssSettings(true),
    ])
  }

  const fetchUserProfiles = async (silent = false) => {
    if (!silent) clearFeedback()
    const rows = await api.get('/api/train-exam/user-profiles?limit=200')
    setUserProfiles(Array.isArray(rows) ? rows : [])
  }

  const onCreateCourse = async (e) => {
    e.preventDefault()
    clearFeedback()
    try {
      const created = await api.post('/api/train-exam/courses', {
        title: courseForm.title,
        description: courseForm.description,
        duration_minutes: Number(courseForm.duration_minutes || 60),
      })
      setMessage(`课程已创建：${created.title}`)
      setCourseForm({ title: '', description: '', duration_minutes: 60 })
      await fetchCourses(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '创建课程失败')
    }
  }

  const onUpdateCourseStatus = async (item, nextStatus) => {
    if (!canWrite) {
      setError('当前角色无课程状态修改权限。')
      return
    }
    const id = Number(item?.id || 0)
    if (!id) return
    const normalized = String(nextStatus || '').trim().toLowerCase()
    const isPublishing = normalized === 'published'
    const actionLabel = isPublishing ? '发布' : '改回草稿'
    const title = String(item?.title || `课程-${id}`)
    const confirmed = window.confirm(`确认${actionLabel}课程“${title}”吗？`)
    if (!confirmed) return
    clearFeedback()
    setCourseStatusPendingId(id)
    try {
      const updated = await api.put(`/api/train-exam/courses/${id}`, {
        title: item.title,
        description: item.description || '',
        duration_minutes: Number(item.duration_minutes || 60),
        status: nextStatus,
      })
      setMessage(`课程已${actionLabel}：${updated?.title || title}`)
      await fetchCourses(true)
      await fetchOverview(true)
      await fetchMyLearningProgress(true)
      if (Number(learningCourseId || 0) === id) {
        await fetchLearningPath(id, true)
      }
    } catch (err) {
      setError(err.message || '修改课程状态失败')
    } finally {
      setCourseStatusPendingId(0)
    }
  }

  const onCreateResource = async (e) => {
    e.preventDefault()
    clearFeedback()
    setResourceUploadNotice('')
    const courseId = Number(resourceForm.course_id || 0)
    if (!courseId) {
      setError('请先选择课程')
      return
    }
    const courseExists = courses.some((item) => Number(item.id) === courseId)
    if (!courseExists) {
      setError(`课程ID ${courseId} 不存在，请先在下方课程列表确认后再创建资源`)
      return
    }
    try {
      const created = await api.post(`/api/train-exam/courses/${courseId}/resources`, {
        name: resourceForm.name,
        resource_type: resourceForm.resource_type,
        source_mode: resourceForm.source_mode,
        storage_backend: normalizeResourceStorageBackend({
          resourceType: resourceForm.resource_type,
          sourceMode: resourceForm.source_mode,
          storageBackend: resourceForm.storage_backend,
        }),
        source_url: resourceForm.source_url || undefined,
        force_watch: !!resourceForm.force_watch,
        sort_order: Number(resourceForm.sort_order || 0),
      })
      setMessage(`资源已创建：${created.name}`)
      setResourceUpload((prev) => ({
        ...prev,
        resource_id: String(created.id || ''),
        resource_type: String(created?.resource_type || resourceForm.resource_type || 'doc'),
        source_mode: String(created?.source_mode || resourceForm.source_mode || 'upload'),
        storage_backend: normalizeResourceStorageBackend({
          resourceType: created?.resource_type || resourceForm.resource_type,
          sourceMode: created?.source_mode || resourceForm.source_mode,
          storageBackend: created?.storage_backend || resourceForm.storage_backend,
        }),
      }))
      setResourceUploadNotice(
        normalizeResourceStorageBackend({
          resourceType: created?.resource_type,
          sourceMode: created?.source_mode,
          storageBackend: created?.storage_backend,
        }) === 'oss'
          ? '资源已创建，可选择标准 MP4 直传到阿里云 OSS'
          : '资源已创建，可直接选择文件上传'
      )
      setResourceForm({
        course_id: resourceForm.course_id,
        name: '',
        resource_type: 'doc',
        source_mode: 'upload',
        storage_backend: 'local',
        source_url: '',
        force_watch: false,
        sort_order: 0,
      })
      await fetchCourses(true)
    } catch (err) {
      setError(err.message || '创建资源失败')
    }
  }

  const syncStateAfterCourseDelete = async (deletedIds = []) => {
    const deletedSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).map((id) => Number(id || 0)).filter((id) => id > 0))
    const nextCourses = await fetchCourses(true)
    await fetchOverview(true)
    await fetchMyLearningProgress(true)

    const nextIds = new Set((nextCourses || []).map((item) => Number(item.id || 0)).filter((id) => id > 0))
    setSelectedCourseIds((prev) => prev.filter((id) => nextIds.has(Number(id || 0)) && !deletedSet.has(Number(id || 0))))

    const nextFirstCourseId = Number(nextCourses?.[0]?.id || 0)
    if (deletedSet.has(Number(resourceForm.course_id || 0))) {
      setResourceForm((prev) => ({ ...prev, course_id: nextFirstCourseId ? String(nextFirstCourseId) : '' }))
    }

    if (deletedSet.has(Number(learningCourseId || 0))) {
      closeLearningPlayerModal()
      setSelectedLearningResourceId(0)
      if (nextFirstCourseId) {
        await fetchLearningPath(nextFirstCourseId, true)
      } else {
        setLearningCourseId('')
        setLearningPath({
          course: null,
          summary: {
            total_resources: 0,
            completed_resources: 0,
            in_progress_resources: 0,
            not_started_resources: 0,
            completion_rate: 0,
          },
          items: [],
        })
      }
    }
  }

  const onDeleteCourse = async (item) => {
    if (!canWrite) {
      setError('当前角色无课程删除权限。')
      return
    }
    const id = Number(item?.id || 0)
    if (!id) return
    const title = String(item?.title || `课程-${id}`)
    const confirmed = window.confirm(`确认删除课程“${title}”吗？将同步删除课程下全部资源，删除后不可恢复。`)
    if (!confirmed) return
    clearFeedback()
    setCourseDeletePendingId(id)
    try {
      const payload = await api.del(`/api/train-exam/courses/${id}?force=1`)
      const removedResources = Number(payload?.removed_resources || 0)
      setMessage(`课程已删除：${title}（已清理资源 ${removedResources} 项）`)
      await syncStateAfterCourseDelete([id])
    } catch (err) {
      setError(err.message || '删除课程失败')
    } finally {
      setCourseDeletePendingId(0)
    }
  }

  const onDeleteCoursesBatch = async ({ deleteAll = false } = {}) => {
    if (!canWrite) {
      setError('当前角色无课程删除权限。')
      return
    }
    if (courseDeletePendingId || courseStatusPendingId || courseBatchDeleting) return
    const ids = deleteAll
      ? (courses || []).map((item) => Number(item.id || 0)).filter((id) => id > 0)
      : selectedCourseIds.map((id) => Number(id || 0)).filter((id) => id > 0)
    if (!ids.length) {
      setError(deleteAll ? '当前没有可删除的课程' : '请先勾选要删除的课程')
      return
    }
    const label = deleteAll ? `全部 ${ids.length} 门课程` : `选中的 ${ids.length} 门课程`
    const confirmed = window.confirm(`确认删除${label}吗？将同步删除课程下全部资源，删除后不可恢复。`)
    if (!confirmed) return

    clearFeedback()
    setCourseBatchDeleting(true)
    try {
      const payload = await api.post('/api/train-exam/courses/bulk-delete', {
        course_ids: ids,
        force: true,
      })
      const deletedIds = Array.isArray(payload?.deleted_ids) ? payload.deleted_ids.map((id) => Number(id || 0)).filter((id) => id > 0) : []
      const failed = Array.isArray(payload?.failed) ? payload.failed : []
      await syncStateAfterCourseDelete(deletedIds)

      if (failed.length > 0) {
        const summary = failed
          .slice(0, 3)
          .map((item) => `${item.course_id}：${item.error}`)
          .join('；')
        setError(`已删除 ${deletedIds.length} 门，${failed.length} 门失败。${summary}`)
      } else {
        setMessage(`已删除 ${deletedIds.length} 门课程`)
      }
    } catch (err) {
      setError(err.message || '批量删除课程失败')
    } finally {
      setCourseBatchDeleting(false)
    }
  }

  const stopTranscodePolling = () => {
    if (transcodePollTimerRef.current) {
      clearInterval(transcodePollTimerRef.current)
      transcodePollTimerRef.current = null
    }
  }
  const stopLearningPathPolling = () => {
    if (learningPathPollTimerRef.current) {
      clearInterval(learningPathPollTimerRef.current)
      learningPathPollTimerRef.current = null
    }
    learningPathPollBusyRef.current = false
  }

  const pollTranscodeStatus = async (resourceId, { silent = false } = {}) => {
    const rid = Number(resourceId || 0)
    if (!rid) return
    try {
      const payload = await api.get(`/api/train-exam/resources/${rid}/transcode-status`)
      const status = String(payload?.status || 'none').toLowerCase()
      const progress = Math.max(0, Math.min(100, Number(payload?.progress_percent || 0)))
      const messageText = String(payload?.message || '').trim()
      setTranscodeTask({
        resourceId: rid,
        status,
        progressPercent: progress,
        message: messageText,
      })
      if (status === 'queued' || status === 'running') {
        setResourceUploadNotice(`后台转码中：${progress}%（可以关闭当前页面，不影响转码）`)
      }
      setLearningPath((prev) => {
        const items = Array.isArray(prev?.items) ? prev.items : []
        if (!items.length) return prev
        let changed = false
        const nextItems = items.map((item) => {
          if (Number(item?.id || 0) !== rid) return item
          changed = true
          return {
            ...item,
            transcode_status: status,
            transcode_progress: progress,
            transcode_message: messageText || item.transcode_message,
          }
        })
        return changed ? { ...prev, items: nextItems } : prev
      })

      if (status === 'succeeded') {
        stopTranscodePolling()
        setResourceUploadNotice(messageText || '转码完成，可开始播放。')
        setMessage('视频后台转码完成，可开始播放')
        await fetchCourses(true)
        if (learningCourseId) await fetchLearningPath(Number(learningCourseId), true)
        return
      }

      if (status === 'failed') {
        stopTranscodePolling()
        setResourceUploadNotice(messageText || '转码失败，请重新上传视频')
        setError(messageText || '视频转码失败')
        await fetchCourses(true)
        if (learningCourseId) await fetchLearningPath(Number(learningCourseId), true)
        return
      }

      if (status === 'skipped') {
        stopTranscodePolling()
        setResourceUploadNotice(messageText || '转码任务已跳过')
        await fetchCourses(true)
        if (learningCourseId) await fetchLearningPath(Number(learningCourseId), true)
      }
    } catch (err) {
      if (!silent) {
        setResourceUploadNotice(err.message || '获取转码状态失败')
      }
    }
  }

  const startTranscodePolling = (resourceId) => {
    const rid = Number(resourceId || 0)
    if (!rid) return
    stopTranscodePolling()
    pollTranscodeStatus(rid, { silent: true })
    transcodePollTimerRef.current = setInterval(() => {
      pollTranscodeStatus(rid, { silent: true })
    }, 3000)
  }

  const uploadManagedOssResource = async ({ resourceId, file }) => {
    const initPayload = await api.post(`/api/train-exam/resources/${resourceId}/oss-upload-init`, {
      file_name: String(file?.name || ''),
      mime_type: String(file?.type || 'video/mp4').trim() || 'video/mp4',
      file_size: Math.max(0, Number(file?.size || 0)),
    })

    await uploadFileToSignedUrl({
      url: initPayload?.upload_url,
      method: initPayload?.method || 'PUT',
      file,
      headers: initPayload?.headers || {},
      onProgress: (percent) => {
        setResourceUploadProgress(percent)
        setResourceUploadNotice(`上传到阿里云 OSS：${percent}%`)
      },
    })

    return api.post(`/api/train-exam/resources/${resourceId}/oss-upload-complete`, {
      object_key: initPayload?.object_key,
      etag: '',
      file_size: Math.max(0, Number(file?.size || 0)),
      mime_type: String(file?.type || 'video/mp4').trim() || 'video/mp4',
      original_name: String(file?.name || ''),
    })
  }

  const onUploadResource = async (e) => {
    e.preventDefault()
    clearFeedback()
    setResourceUploadNotice('')
    stopTranscodePolling()
    setTranscodeTask(null)
    if (uploadingResource) return
    if (!resourceUpload.resource_id || !resourceUpload.file) {
      setResourceUploadNotice('请先在左侧新建资源，再选择文件上传')
      return
    }
    setUploadingResource(true)
    setResourceUploadProgress(0)
    setResourceUploadNotice('开始上传，请稍候...')
    try {
      const storageBackend = normalizeResourceStorageBackend({
        resourceType: resourceUpload.resource_type,
        sourceMode: resourceUpload.source_mode,
        storageBackend: resourceUpload.storage_backend,
      })
      let payload
      if (storageBackend === 'oss' && String(resourceUpload.resource_type || '').toLowerCase() === 'video') {
        payload = await uploadManagedOssResource({
          resourceId: resourceUpload.resource_id,
          file: resourceUpload.file,
        })
      } else {
        const form = new FormData()
        form.append('file', resourceUpload.file)
        payload = await api.postFormWithProgress(`/api/train-exam/resources/${resourceUpload.resource_id}/upload`, form, {
          onProgress: (percent) => {
            setResourceUploadProgress(percent)
            setResourceUploadNotice(`上传中：${percent}%`)
          },
        })
      }
      setResourceUploadProgress(100)
      const transcodeStatus = String(payload?.transcode_status || '').toLowerCase()
      const transcodeProgress = Math.max(0, Math.min(100, Number(payload?.transcode_progress || 0)))
      const finalStorageBackend = normalizeResourceStorageBackend({
        resourceType: payload?.resource_type || resourceUpload.resource_type,
        sourceMode: payload?.source_mode || resourceUpload.source_mode,
        storageBackend: payload?.storage_backend || resourceUpload.storage_backend,
      })
      const uploadStatus = String(payload?.upload_status || '').trim().toLowerCase()
      if (finalStorageBackend === 'oss') {
        if (uploadStatus === 'ready') {
          setMessage('资源文件已上传至阿里云 OSS，可直接播放')
          setResourceUploadNotice('OSS 上传完成')
        } else {
          setResourceUploadNotice('OSS 上传已发起，请稍后刷新查看状态')
        }
        stopTranscodePolling()
        setTranscodeTask(null)
      } else if (transcodeStatus === 'queued' || transcodeStatus === 'running') {
        setMessage('资源文件上传成功，已进入后台转码')
        setResourceUploadNotice(`文件已上传，后台转码中 ${transcodeProgress}%（可以关闭当前页面，不影响转码）`)
        setTranscodeTask({
          resourceId: Number(payload?.id || resourceUpload.resource_id),
          status: transcodeStatus,
          progressPercent: transcodeProgress,
          message: String(payload?.transcode_message || '文件已上传，后台转码中，可关闭页面稍后查看'),
        })
        startTranscodePolling(Number(payload?.id || resourceUpload.resource_id))
      } else if (transcodeStatus === 'succeeded') {
        setMessage('资源文件上传成功，可直接播放')
        setResourceUploadNotice('上传完成，无需转码')
        stopTranscodePolling()
        setTranscodeTask(null)
      } else if (transcodeStatus === 'failed') {
        const reason = String(payload?.transcode_message || '视频转码失败，请重新上传').trim()
        setResourceUploadNotice(reason)
        setError(reason)
      } else {
        setMessage('资源文件上传成功')
        setResourceUploadNotice('上传完成')
      }
      setResourceUpload({
        resource_id: '',
        resource_type: 'doc',
        source_mode: 'upload',
        storage_backend: 'local',
        file: null,
      })
      await fetchCourses(true)
      if (learningCourseId) await fetchLearningPath(Number(learningCourseId), true)
    } catch (err) {
      setResourceUploadNotice(err.message || '上传失败')
      setError(err.message || '上传资源失败')
    } finally {
      setUploadingResource(false)
      setTimeout(() => setResourceUploadProgress(0), 600)
    }
  }

  const onUpdateLearningProgress = async ({
    resourceId,
    nextPercent,
    markCompleted = false,
    viewedSecondsIncrement = 60,
    lastPositionSeconds,
    silent = false,
    refresh = true,
  }) => {
    if (!resourceId) return
    if (!silent) clearFeedback()
    try {
      await api.post(`/api/train-exam/resources/${resourceId}/progress`, {
        progress_percent: Number(nextPercent || 0),
        viewed_seconds_increment: Math.max(0, Number(markCompleted ? 0 : viewedSecondsIncrement || 0)),
        last_position_seconds: lastPositionSeconds !== undefined ? Math.max(0, Number(lastPositionSeconds || 0)) : undefined,
        mark_completed: markCompleted,
      })
      if (!silent) setMessage(markCompleted ? '章节已标记完成' : '学习进度已更新')
      if (refresh && learningCourseId) {
        await fetchLearningPath(Number(learningCourseId), true)
      }
      if (refresh) await fetchMyLearningProgress(true)
    } catch (err) {
      if (!silent) setError(err.message || '更新学习进度失败')
    }
  }

  const onUpdateResourcePlaybackPolicy = async (resourceId, forceWatch) => {
    clearFeedback()
    try {
      await api.put(`/api/train-exam/resources/${resourceId}/playback-policy`, {
        force_watch: !!forceWatch,
      })
      setMessage(forceWatch ? '已启用强制播放（禁止快进）' : '已关闭强制播放')
      if (learningCourseId) await fetchLearningPath(Number(learningCourseId), true)
    } catch (err) {
      setError(err.message || '更新播放策略失败')
    }
  }

  const closeLearningPlayerModal = () => {
    const player = learningVideoRef.current
    if (player) {
      player.pause()
    }
    setLearningPlayerDragState(null)
    setLearningPlayerResizeState(null)
    setIsLearningPlayerOpen(false)
    setVideoRuntime((prev) => ({ ...prev, playing: false }))
  }

  const onDocPreviewHeaderPointerDown = (e) => {
    if (docPreviewModal.maximized) return
    const tagName = String(e.target?.tagName || '').toLowerCase()
    if (['button', 'input', 'select', 'textarea', 'label', 'a'].includes(tagName)) return
    e.preventDefault()
    setDocPreviewDragState({
      startX: Number(e.clientX || 0),
      startY: Number(e.clientY || 0),
      startLeft: Number(docPreviewModal.left || 0),
      startTop: Number(docPreviewModal.top || 0),
    })
  }

  const onDocPreviewResizePointerDown = (e) => {
    if (docPreviewModal.maximized) return
    e.preventDefault()
    setDocPreviewResizeState({
      startX: Number(e.clientX || 0),
      startY: Number(e.clientY || 0),
      startWidth: Number(docPreviewModal.width || 0),
      startHeight: Number(docPreviewModal.height || 0),
    })
  }

  const onToggleDocPreviewMaximize = () => {
    if (!isDocPreviewOpen) return
    if (docPreviewModal.maximized) {
      const restore = docPreviewModal.restoreRect || buildDefaultDocPreviewModalRect()
      const rect = clampDocPreviewModalRect(restore)
      setDocPreviewModal({
        ...rect,
        maximized: false,
        restoreRect: null,
      })
      return
    }
    const currentRect = clampDocPreviewModalRect(docPreviewModal)
    const vw = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1280
    const vh = typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 800
    setDocPreviewModal({
      left: 8,
      top: 8,
      width: Math.max(340, vw - 16),
      height: Math.max(280, vh - 16),
      maximized: true,
      restoreRect: currentRect,
    })
  }

  const onToggleDocPreviewFullscreen = async () => {
    const stage = docPreviewStageRef.current
    if (!stage) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (stage.requestFullscreen) {
        await stage.requestFullscreen()
      } else {
        setDocPreviewNotice('当前浏览器不支持文档全屏预览。')
      }
    } catch {
      setDocPreviewNotice('进入文档全屏失败，请检查浏览器权限后重试。')
    }
  }

  const onChangeLearningPlayerVolume = (value) => {
    const next = Math.max(0, Math.min(100, Number(value || 0)))
    setLearningPlayerVolume(next)
    const player = learningVideoRef.current
    if (player) {
      player.volume = next / 100
      player.muted = next <= 0
    }
  }

  const onLearningPlayerHeaderPointerDown = (e) => {
    if (learningPlayerModal.maximized) return
    const tagName = String(e.target?.tagName || '').toLowerCase()
    if (['button', 'input', 'select', 'textarea', 'label', 'a'].includes(tagName)) return
    e.preventDefault()
    setLearningPlayerDragState({
      startX: Number(e.clientX || 0),
      startY: Number(e.clientY || 0),
      startLeft: Number(learningPlayerModal.left || 0),
      startTop: Number(learningPlayerModal.top || 0),
    })
  }

  const onLearningPlayerResizePointerDown = (e) => {
    if (learningPlayerModal.maximized) return
    e.preventDefault()
    setLearningPlayerResizeState({
      startX: Number(e.clientX || 0),
      startY: Number(e.clientY || 0),
      startWidth: Number(learningPlayerModal.width || 0),
      startHeight: Number(learningPlayerModal.height || 0),
    })
  }

  const onToggleLearningPlayerMaximize = () => {
    if (!isLearningPlayerOpen) return
    if (learningPlayerModal.maximized) {
      const restore = learningPlayerModal.restoreRect || buildDefaultPlayerModalRect()
      const rect = clampPlayerModalRect(restore)
      setLearningPlayerModal({
        ...rect,
        maximized: false,
        restoreRect: null,
      })
      return
    }
    const currentRect = clampPlayerModalRect(learningPlayerModal)
    const vw = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1280
    const vh = typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 800
    setLearningPlayerModal({
      left: 8,
      top: 8,
      width: Math.max(320, vw - 16),
      height: Math.max(260, vh - 16),
      maximized: true,
      restoreRect: currentRect,
    })
  }

  const onToggleLearningPlayerFullscreen = async () => {
    const player = learningVideoRef.current
    if (!player) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (player.requestFullscreen) {
        await player.requestFullscreen()
      } else {
        setLearningPlayerNotice('当前浏览器不支持全屏播放。')
      }
    } catch {
      setLearningPlayerNotice('进入全屏失败，请检查浏览器权限后重试。')
    }
  }

  const onOpenResourceEditModal = (item) => {
    if (!canWrite) {
      setError('当前角色无资源编辑权限。')
      return
    }
    const id = Number(item?.id || 0)
    if (!id) return
    setEditingResourceId(id)
    setResourceEditForm({
      name: String(item?.name || ''),
      resource_type: String(item?.resource_type || 'doc'),
      source_mode: String(item?.source_mode || 'upload'),
      storage_backend: normalizeResourceStorageBackend({
        resourceType: item?.resource_type,
        sourceMode: item?.source_mode,
        storageBackend: item?.storage_backend,
      }),
      source_url: String(item?.source_url || ''),
      force_watch: !!item?.force_watch,
      sort_order: Number(item?.sort_order || 0),
    })
    setResourceEditVisible(true)
  }

  const closeResourceEditModal = () => {
    if (resourceEditSaving) return
    setResourceEditVisible(false)
    setEditingResourceId(0)
  }

  const onSubmitResourceEdit = async (e) => {
    e.preventDefault()
    if (!editingResourceId) return
    clearFeedback()
    if (!canWrite) {
      setError('当前角色无资源编辑权限。')
      return
    }
    setResourceEditSaving(true)
    try {
      const payload = {
        name: resourceEditForm.name,
        resource_type: resourceEditForm.resource_type,
        source_mode: resourceEditForm.source_mode,
        storage_backend: normalizeResourceStorageBackend({
          resourceType: resourceEditForm.resource_type,
          sourceMode: resourceEditForm.source_mode,
          storageBackend: resourceEditForm.storage_backend,
        }),
        source_url: resourceEditForm.source_mode === 'external' ? resourceEditForm.source_url : '',
        force_watch: resourceEditForm.resource_type === 'video' && resourceEditForm.source_mode === 'upload'
          ? !!resourceEditForm.force_watch
          : false,
        sort_order: Math.max(0, Number(resourceEditForm.sort_order || 0)),
      }
      await api.put(`/api/train-exam/resources/${editingResourceId}`, payload)
      setMessage('资源已更新')
      setResourceEditVisible(false)
      setEditingResourceId(0)

      if (payload.source_mode === 'upload') {
        setResourceUpload((prev) => ({
          ...prev,
          resource_id: String(editingResourceId),
          resource_type: payload.resource_type,
          source_mode: payload.source_mode,
          storage_backend: payload.storage_backend,
        }))
        setResourceUploadNotice(payload.storage_backend === 'oss'
          ? '资源已更新为阿里云 OSS 上传模式，请重新上传标准 MP4 文件。'
          : '资源已更新为上传模式，如需生效请上传最新文件。')
      }

      if (Number(selectedLearningResourceId || 0) === Number(editingResourceId || 0)) {
        const isVideo = String(payload.resource_type || '').toLowerCase() === 'video'
        const isDoc = String(payload.resource_type || '').toLowerCase() === 'doc'
        if (!isVideo) {
          closeLearningPlayerModal()
        }
        if (!isDoc) {
          void closeDocPreviewModal({ recordProgress: false })
        }
      }

      await fetchCourses(true)
      if (learningCourseId) await fetchLearningPath(Number(learningCourseId), true)
      await fetchMyLearningProgress(true)
    } catch (err) {
      setError(err.message || '更新资源失败')
    } finally {
      setResourceEditSaving(false)
    }
  }

  const onDeleteResource = async (item) => {
    if (!canWrite) {
      setError('当前角色无资源删除权限。')
      return
    }
    const id = Number(item?.id || 0)
    if (!id) return
    const name = String(item?.name || `资源-${id}`)
    const confirmed = window.confirm(`确认删除资源“${name}”吗？删除后不可恢复。`)
    if (!confirmed) return
    clearFeedback()
    setResourceDeletePendingId(id)
    try {
      await api.del(`/api/train-exam/resources/${id}`)
      setMessage(`资源已删除：${name}`)
      if (Number(selectedLearningResourceId || 0) === id) {
        closeLearningPlayerModal()
        void closeDocPreviewModal({ recordProgress: false })
        setSelectedLearningResourceId(0)
      }
      if (Number(editingResourceId || 0) === id) {
        setResourceEditVisible(false)
        setEditingResourceId(0)
      }
      if (Number(resourceUpload.resource_id || 0) === id) {
        setResourceUpload((prev) => ({ ...prev, resource_id: '', file: null }))
      }
      await fetchCourses(true)
      if (learningCourseId) await fetchLearningPath(Number(learningCourseId), true)
      await fetchMyLearningProgress(true)
    } catch (err) {
      setError(err.message || '删除资源失败')
    } finally {
      setResourceDeletePendingId(0)
    }
  }

  const playLearningVideo = async (player, resource) => {
    if (!player) return false
    try {
      await player.play()
      return true
    } catch (err) {
      const mediaErrorCode = Number(player.error?.code || 0)
      const resourceId = Number(resource?.id || 0)
      if (resourceId) {
        api.get(`/api/train-exam/resources/${resourceId}/playability`)
          .then((check) => {
            if (check && check.playable === false && check.reason) {
              setLearningPlayerNotice(String(check.reason))
              return
            }
            setLearningPlayerNotice(buildVideoErrorMessage({
              mediaErrorCode,
              playErrorMessage: err?.message,
            }))
          })
          .catch(() => {
            setLearningPlayerNotice(buildVideoErrorMessage({
              mediaErrorCode,
              playErrorMessage: err?.message,
            }))
          })
        return false
      }
      setLearningPlayerNotice(buildVideoErrorMessage({
        mediaErrorCode,
        playErrorMessage: err?.message,
      }))
      return false
    }
  }

  const onToggleLearningVideoPlay = () => {
    const player = learningVideoRef.current
    if (!player) return
    if (player.paused) {
      void playLearningVideo(player, selectedLearningResource)
      return
    }
    player.pause()
  }

  const onReplayLearningVideo = () => {
    const player = learningVideoRef.current
    const resource = selectedLearningResource
    if (!player || !resource) return
    try {
      player.currentTime = 0
    } catch {
      // Ignore seek failure until metadata is ready.
    }
    learningVideoTrackerRef.current = {
      lastSyncTs: 0,
      lastPos: 0,
      maxPos: 0,
      blockedToastAt: 0,
    }
    setVideoRuntime((prev) => ({
      current: 0,
      duration: Math.max(0, Number(player.duration || prev.duration || 0)),
      playing: !player.paused,
    }))
    void playLearningVideo(player, resource)
  }

  const closeDocPreviewModal = async ({ recordProgress = true } = {}) => {
    const openedAt = Number(docPreviewOpenedAt || 0)
    const resourceSnapshot = docPreviewResource
    const minSeconds = Math.max(15, Number(docPreviewMinSeconds || DOC_PREVIEW_MIN_SECONDS_DEFAULT))

    destroyDocPreviewEditor()
    setIsDocPreviewOpen(false)
    setDocPreviewPayload(null)
    setDocPreviewNotice('')
    setDocPreviewOpenedAt(0)
    setDocPreviewResource(null)
    setDocPreviewDragState(null)
    setDocPreviewResizeState(null)

    if (!recordProgress || !resourceSnapshot || openedAt <= 0) return
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - openedAt) / 1000))
    if (elapsedSeconds <= 0) return

    const currentPercent = Math.max(0, Math.min(100, Number(resourceSnapshot?.progress?.progress_percent || 0)))
    const reachedThreshold = elapsedSeconds >= minSeconds
    const nextPercent = reachedThreshold
      ? 100
      : Math.max(currentPercent, Math.min(95, Math.round((elapsedSeconds / minSeconds) * 100)))

    try {
      await onUpdateLearningProgress({
        resourceId: Number(resourceSnapshot.id || 0),
        nextPercent,
        viewedSecondsIncrement: elapsedSeconds,
        markCompleted: reachedThreshold,
        silent: true,
        refresh: true,
      })
      if (reachedThreshold) {
        setMessage(`文档阅读已达 ${minSeconds} 秒，已自动标记完成。`)
      } else {
        setMessage(`已记录文档阅读 ${elapsedSeconds} 秒，当前进度 ${nextPercent}%（满 ${minSeconds} 秒自动完成）。`)
      }
    } catch (err) {
      setError(err.message || '记录文档学习进度失败')
    }
  }

  const onOpenLearningDocPreview = async (item) => {
    const resourceId = Number(item?.id || 0)
    if (!resourceId) return
    if (String(item?.resource_type || '').toLowerCase() !== 'doc') {
      setError('当前资源不是文档，无法打开文档预览。')
      return
    }
    clearFeedback()
    setDocPreviewLoading(true)
    setSelectedLearningResourceId(resourceId)
    closeLearningPlayerModal()
    try {
      const loaded = await loadDocPreviewScript()
      if (!loaded || !window.DocsAPI?.DocEditor) {
        setError('Office 在线预览服务不可用，请稍后重试')
        return
      }
      const payload = await api.get(`/api/train-exam/resources/${resourceId}/doc-preview-config`)
      if (String(payload?.mode || '').toLowerCase() === 'external' && payload?.open_url) {
        window.open(payload.open_url, '_blank', 'noopener,noreferrer')
        setMessage('已打开外链文档')
        return
      }
      if (!payload?.editor?.config || !payload?.editor?.token) {
        setError('文档预览配置不完整，请重试')
        return
      }
      setDocPreviewContainerId(`te-doc-preview-container-${Date.now()}`)
      setDocPreviewPayload(payload)
      const minSecondsFromPayload = Math.max(15, Number(payload?.min_read_seconds || DOC_PREVIEW_MIN_SECONDS_DEFAULT))
      setDocPreviewMinSeconds(minSecondsFromPayload)
      setDocPreviewThresholdSeconds(minSecondsFromPayload)
      setDocPreviewThresholdInput(String(minSecondsFromPayload))
      setDocPreviewResource(item)
      setDocPreviewOpenedAt(Date.now())
      setDocPreviewNotice(`请至少阅读 ${minSecondsFromPayload} 秒，关闭窗口后自动计算完成度。`)
      setDocPreviewModal((prev) => {
        if (prev.maximized) return prev
        const baseRect = Number(prev.width || 0) > 0 ? prev : { ...prev, ...buildDefaultDocPreviewModalRect() }
        const nextRect = clampDocPreviewModalRect(baseRect)
        return { ...prev, ...nextRect }
      })
      setIsDocPreviewOpen(true)
    } catch (err) {
      setError(err.message || '打开文档预览失败')
    } finally {
      setDocPreviewLoading(false)
    }
  }

  const onOpenLearningPlayer = async (item) => {
    const resourceId = Number(item?.id || 0)
    if (!resourceId) return
    if (isDocPreviewOpen) {
      await closeDocPreviewModal({ recordProgress: true })
    }
    setSelectedLearningResourceId(resourceId)
    setLearningPlayerModal((prev) => {
      if (prev.maximized) return prev
      const baseRect = Number(prev.width || 0) > 0 ? prev : { ...prev, ...buildDefaultPlayerModalRect() }
      const nextRect = clampPlayerModalRect(baseRect)
      return { ...prev, ...nextRect }
    })
    setIsLearningPlayerOpen(true)
    try {
      const check = await api.get(`/api/train-exam/resources/${resourceId}/playability`)
      if (check && check.playable === false && check.reason) {
        setLearningPlayerNotice(String(check.reason))
      } else {
        setLearningPlayerNotice('播放器已打开。')
      }
    } catch {
      setLearningPlayerNotice('播放器已打开。')
    }
  }

  const onOpenLearningResource = async (item) => {
    const resourceType = String(item?.resource_type || '').trim().toLowerCase()
    if (resourceType === 'video') {
      await onOpenLearningPlayer(item)
      return
    }
    if (resourceType === 'doc') {
      await onOpenLearningDocPreview(item)
      return
    }
    const targetUrl = buildResourceOpenUrl(item)
    if (!targetUrl) {
      setError('资源链接不可用，请联系管理员检查配置。')
      return
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer')
    setMessage('已打开学习资源。')
  }

  const onLearningVideoLoadedMetadata = (item, e) => {
    const player = e.currentTarget
    player.volume = Math.max(0, Math.min(1, Number(learningPlayerVolume || 0) / 100))
    player.muted = Number(learningPlayerVolume || 0) <= 0
    const lastPosition = Math.max(0, Number(item?.progress?.last_position_seconds || 0))
    const duration = Math.max(0, Number(player.duration || 0))
    if (lastPosition > 0 && duration > 0 && lastPosition < duration - 1) {
      player.currentTime = lastPosition
    }
    learningVideoTrackerRef.current = {
      lastSyncTs: Date.now(),
      lastPos: Math.max(0, Number(player.currentTime || lastPosition || 0)),
      maxPos: Math.max(0, Number(player.currentTime || lastPosition || 0)),
      blockedToastAt: 0,
    }
    setVideoRuntime({
      current: Math.max(0, Number(player.currentTime || 0)),
      duration,
      playing: !player.paused,
    })
  }

  const onLearningVideoPlay = (e) => {
    const player = e.currentTarget
    setVideoRuntime((prev) => ({ ...prev, playing: !player.paused }))
  }

  const onLearningVideoPause = (e) => {
    const player = e.currentTarget
    setVideoRuntime((prev) => ({ ...prev, playing: !player.paused }))
  }

  const onLearningVideoRateChange = (item, e) => {
    if (!isLearningVideoSeekLocked(item)) return
    const player = e.currentTarget
    if (Number(player.playbackRate || 1) !== 1) {
      player.playbackRate = 1
    }
  }

  const onLearningVideoSeeking = (item, e) => {
    if (!isLearningVideoSeekLocked(item)) return
    const player = e.currentTarget
    const tracker = learningVideoTrackerRef.current
    const target = Number(player.currentTime || 0)
    const allowed = Number(tracker.maxPos || 0) + 1
    if (target > allowed) {
      player.currentTime = Number(tracker.maxPos || 0)
      const now = Date.now()
      if (now - Number(tracker.blockedToastAt || 0) > 3000) {
        setError('该视频启用强制播放，不可拖动进度快进。')
        tracker.blockedToastAt = now
      }
    }
  }

  const onLearningVideoTimeUpdate = async (item, e) => {
    const player = e.currentTarget
    const current = Math.max(0, Number(player.currentTime || 0))
    const duration = Math.max(0, Number(player.duration || 0))
    setVideoRuntime({
      current,
      duration,
      playing: !player.paused,
    })

    const tracker = learningVideoTrackerRef.current
    if (current > Number(tracker.maxPos || 0)) {
      tracker.maxPos = current
    }

    const now = Date.now()
    if (now - Number(tracker.lastSyncTs || 0) < 4000) return
    const watchedDelta = Math.max(0, current - Number(tracker.lastPos || 0))
    const nextPercent = duration > 0
      ? Math.max(Number(item?.progress?.progress_percent || 0), Math.min(100, Number(((current / duration) * 100).toFixed(2))))
      : Number(item?.progress?.progress_percent || 0)
    tracker.lastSyncTs = now
    tracker.lastPos = current

    await onUpdateLearningProgress({
      resourceId: item.id,
      nextPercent,
      viewedSecondsIncrement: Math.max(1, Math.round(watchedDelta)),
      lastPositionSeconds: current,
      markCompleted: false,
      silent: true,
      refresh: false,
    })
  }

  const onLearningVideoEnded = async (item, e) => {
    const player = e.currentTarget
    const duration = Math.max(0, Number(player.duration || 0))
    const tracker = learningVideoTrackerRef.current
    const watchedDelta = Math.max(0, duration - Number(tracker.lastPos || 0))
    tracker.lastPos = duration
    tracker.maxPos = duration
    await onUpdateLearningProgress({
      resourceId: item.id,
      nextPercent: 100,
      viewedSecondsIncrement: Math.max(0, Math.round(watchedDelta)),
      lastPositionSeconds: duration,
      markCompleted: true,
      silent: true,
      refresh: true,
    })
    setMessage('视频已完整观看，已记录完成。')
  }

  const onLearningVideoError = async (item, e) => {
    if (String(item?.source_mode || '').toLowerCase() === 'external') {
      setLearningPlayerNotice('外链视频暂时无法打开，请检查视频链接是否有效。')
      return
    }
    const mediaErrorCode = Number(e?.currentTarget?.error?.code || 0)
    try {
      const check = await api.get(`/api/train-exam/resources/${Number(item?.id || 0)}/playability`)
      if (check && check.playable === false && check.reason) {
        setLearningPlayerNotice(String(check.reason))
        return
      }
    } catch {
      // ignore
    }
    setLearningPlayerNotice(buildVideoErrorMessage({ mediaErrorCode }))
  }

  const onCreateGenerationJob = async (e) => {
    e.preventDefault()
    clearFeedback()
    try {
      const payload = await api.post('/api/train-exam/questions/generation/jobs', {
        name: generationForm.name || undefined,
        source_category_ids: generationForm.source_category_ids,
        source_article_ids: generationForm.source_article_ids,
        max_sources: Number(generationForm.max_sources || 30),
      })
      setLatestGenerationJob(payload)
      setMessage(`出题任务已创建：${payload.id}`)
    } catch (err) {
      setError(err.message || '创建出题任务失败')
    }
  }

  const onRunGenerationJob = async () => {
    clearFeedback()
    if (!latestGenerationJob?.id) {
      setError('请先创建出题任务')
      return
    }
    try {
      const payload = await api.post(`/api/train-exam/questions/generation/jobs/${latestGenerationJob.id}/run`, {})
      setLatestGenerationJob(payload)
      setMessage(`任务执行完成，插入题目：${payload?.result?.inserted || 0}`)
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '执行出题任务失败')
    }
  }

  const onPublishGenerationJob = async () => {
    clearFeedback()
    if (!latestGenerationJob?.id) {
      setError('请先创建出题任务')
      return
    }
    try {
      const payload = await api.post(`/api/train-exam/questions/generation/jobs/${latestGenerationJob.id}/publish`, {})
      setLatestGenerationJob(payload)
      setMessage(`任务发布成功，发布题目：${payload?.published_questions || 0}`)
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '发布出题任务失败')
    }
  }

  const onDownloadImportTemplate = () => {
    window.open('/api/train-exam/questions/import/template', '_blank')
  }

  const onImportQuestions = async () => {
    clearFeedback()
    if (!importFile) {
      setError('请先选择Excel文件')
      return
    }
    const maxBytes = UPLOAD_MAX_MB * 1024 * 1024
    if (Number(importFile.size || 0) > maxBytes) {
      setError(`Excel文件超过大小限制（最大 ${UPLOAD_MAX_MB}MB）`)
      return
    }
    try {
      const form = new FormData()
      form.append('file', importFile)
      form.append('publish_after_import', canReview && publishImportedQuestions ? '1' : '0')
      const payload = await api.postForm('/api/train-exam/questions/import/jobs', form)
      const messageParts = [`导入完成：成功 ${payload.success_rows || 0}`, `失败 ${payload.failed_rows || 0}`]
      if (Number(payload.published_rows || 0) > 0) {
        messageParts.push(`已发布 ${payload.published_rows || 0}`)
      }
      if (Number(payload.draft_rows || 0) > 0) {
        messageParts.push(`草稿 ${payload.draft_rows || 0}`)
      }
      setLatestImportJob(payload)
      setMessage(messageParts.join('，'))
      setImportFile(null)
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '导入题目失败')
    }
  }

  const onCreateQuestionCategory = async (e) => {
    e.preventDefault()
    clearFeedback()
    if (!canWrite) {
      setError('当前角色无分类维护权限。')
      return
    }
    const name = String(questionCategoryFormName || '').trim()
    if (!name) {
      setError('请输入分类名称')
      return
    }
    setQuestionCategorySaving(true)
    try {
      await api.post('/api/train-exam/question-categories', { name })
      setMessage(`分类已创建：${name}`)
      setQuestionCategoryFormName('')
      await fetchQuestionCategories(true)
      await fetchQuestions(true, { page: 1, filters: questionFilters })
    } catch (err) {
      setError(err.message || '创建分类失败')
    } finally {
      setQuestionCategorySaving(false)
    }
  }

  const onStartEditQuestionCategory = (row) => {
    const id = Number(row?.id || 0)
    if (!id) return
    setQuestionCategoryEditId(id)
    setQuestionCategoryEditName(String(row?.name || ''))
  }

  const onCancelEditQuestionCategory = () => {
    setQuestionCategoryEditId(0)
    setQuestionCategoryEditName('')
  }

  const onSaveQuestionCategoryEdit = async (id) => {
    const cid = Number(id || 0)
    if (!cid) return
    clearFeedback()
    if (!canWrite) {
      setError('当前角色无分类维护权限。')
      return
    }
    const name = String(questionCategoryEditName || '').trim()
    if (!name) {
      setError('分类名称不能为空')
      return
    }
    setQuestionCategorySaving(true)
    try {
      await api.put(`/api/train-exam/question-categories/${cid}`, { name })
      setMessage('分类已更新')
      onCancelEditQuestionCategory()
      await fetchQuestionCategories(true)
      await fetchQuestions(true, { page: 1, filters: questionFilters })
    } catch (err) {
      setError(err.message || '更新分类失败')
    } finally {
      setQuestionCategorySaving(false)
    }
  }

  const onDeleteQuestionCategory = async (row) => {
    const id = Number(row?.id || 0)
    if (!id) return
    if (!canWrite) {
      setError('当前角色无分类维护权限。')
      return
    }
    const name = String(row?.name || `分类-${id}`)
    const count = Number(row?.question_count || 0)
    const confirmed = window.confirm(`确认删除分类“${name}”吗？该分类下 ${count} 道题会自动归入“未分类”。`)
    if (!confirmed) return
    clearFeedback()
    setQuestionCategoryDeletePendingId(id)
    try {
      const payload = await api.del(`/api/train-exam/question-categories/${id}`)
      const moved = Number(payload?.reassigned_question_count || 0)
      setMessage(`分类已删除，已迁移题目 ${moved} 道到“未分类”`)
      if (questionCategoryEditId === id) onCancelEditQuestionCategory()
      await fetchQuestionCategories(true)
      await fetchQuestions(true, { page: 1, filters: questionFilters })
    } catch (err) {
      setError(err.message || '删除分类失败')
    } finally {
      setQuestionCategoryDeletePendingId(0)
    }
  }

  const parseCsvValues = (text) => {
    const raw = String(text || '').trim()
    if (!raw) return []
    return raw
      .split(/[，,、\n\r;；|]+/)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  }

  const getMultiSelectValues = (target) => Array.from(target?.selectedOptions || [])
    .map((option) => String(option?.value || '').trim())
    .filter(Boolean)

  const addPaperRule = () => {
    setPaperForm((prev) => ({
      ...prev,
      rules: [...(Array.isArray(prev.rules) ? prev.rules : []), createPaperRule()],
    }))
  }

  const updatePaperRule = (index, patch) => {
    setPaperForm((prev) => ({
      ...prev,
      rules: (Array.isArray(prev.rules) ? prev.rules : []).map((rule, ruleIndex) => (
        ruleIndex === index ? { ...rule, ...patch } : rule
      )),
    }))
  }

  const removePaperRule = (index) => {
    setPaperForm((prev) => {
      const currentRules = Array.isArray(prev.rules) ? prev.rules : []
      if (currentRules.length <= 1) {
        return {
          ...prev,
          rules: [createPaperRule()],
        }
      }
      return {
        ...prev,
        rules: currentRules.filter((_, ruleIndex) => ruleIndex !== index),
      }
    })
  }

  const onCreateManualQuestion = async (e) => {
    e.preventDefault()
    clearFeedback()
    try {
      const payload = {
        stem: questionForm.stem,
        question_category: questionForm.question_category || '手工创建',
        question_type: questionForm.question_type,
        difficulty: questionForm.difficulty,
        points: Number(questionForm.points || 2),
        options: [
          { key: 'A', text: questionForm.option_a },
          { key: 'B', text: questionForm.option_b },
          { key: 'C', text: questionForm.option_c },
          { key: 'D', text: questionForm.option_d },
        ].filter((item) => String(item.text || '').trim().length > 0),
        answer: parseCsvValues(questionForm.answer_values),
        answer_text: questionForm.answer_text,
        answer_aliases: parseCsvValues(questionForm.answer_aliases),
        explanation: questionForm.explanation,
        tags: questionForm.tags,
      }
      const created = await api.post('/api/train-exam/questions', payload)
      setMessage(`题目已创建：${created.id}`)
      setQuestionForm(defaultQuestionForm)
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '创建题目失败')
    }
  }

  const onReviewQuestion = async (id, action) => {
    clearFeedback()
    setQuestionPublishPendingId(Number(id || 0))
    try {
      await api.post(`/api/train-exam/questions/${id}/review`, {
        action,
        comment: action === 'approve' ? '通过发布' : '驳回处理',
      })
      setMessage(`题目${action === 'approve' ? '已发布' : '已驳回'}`)
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '审核题目失败')
    } finally {
      setQuestionPublishPendingId(0)
    }
  }

  const onDeleteQuestion = async (item) => {
    if (!canWrite) {
      setError('当前角色无题目删除权限。')
      return
    }
    const id = Number(item?.id || 0)
    if (!id) return
    const stem = String(item?.stem || `题目-${id}`).slice(0, 36)
    const confirmed = window.confirm(`确认删除题目 #${id}（${stem}）吗？删除后不可恢复。`)
    if (!confirmed) return
    clearFeedback()
    setQuestionDeletePendingId(id)
    try {
      await api.del(`/api/train-exam/questions/${id}?force=1`)
      setMessage(`题目已删除：#${id}`)
      setSelectedQuestionIds((prev) => prev.filter((qid) => Number(qid) !== id))
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '删除题目失败')
    } finally {
      setQuestionDeletePendingId(0)
    }
  }

  const fetchAllQuestionIdsByCurrentFilter = async () => {
    const ids = []
    const seen = new Set()
    const limit = 200
    let page = 1
    let total = Infinity
    while (ids.length < total) {
      const queryString = buildQuestionQueryString({
        page,
        limit,
        filters: questionFilters,
      })
      const payload = await api.get(`/api/train-exam/questions?${queryString}`)
      const items = Array.isArray(payload?.items) ? payload.items : []
      total = Math.max(0, Number(payload?.total || 0))
      if (!items.length) break
      items.forEach((item) => {
        const id = Number(item?.id || 0)
        if (id > 0 && !seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      })
      page += 1
      if (page > 500) break
    }
    return ids
  }

  const onDeleteQuestionsBatch = async ({ deleteAll = false } = {}) => {
    if (!canWrite) {
      setError('当前角色无题目删除权限。')
      return
    }
    if (questionDeletePendingId || questionPublishPendingId || questionBatchDeleting || questionBatchPublishing) return
    let ids = deleteAll
      ? []
      : selectedQuestionIds.map((id) => Number(id || 0)).filter((id) => id > 0)

    if (deleteAll) {
      ids = await fetchAllQuestionIdsByCurrentFilter()
    }
    if (!ids.length) {
      setError(deleteAll ? '当前筛选下没有可删除题目' : '请先勾选要删除的题目')
      return
    }
    const label = deleteAll ? `当前筛选的 ${ids.length} 道题目` : `选中的 ${ids.length} 道题目`
    const confirmed = window.confirm(`确认删除${label}吗？删除后不可恢复。`)
    if (!confirmed) return
    clearFeedback()
    setQuestionBatchDeleting(true)
    try {
      const payload = await api.post('/api/train-exam/questions/bulk-delete', {
        question_ids: ids,
        force: true,
      })
      const deletedIds = Array.isArray(payload?.deleted_ids) ? payload.deleted_ids.map((id) => Number(id || 0)).filter((id) => id > 0) : []
      const failed = Array.isArray(payload?.failed) ? payload.failed : []
      setSelectedQuestionIds((prev) => prev.filter((qid) => !deletedIds.includes(Number(qid))))
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)
      if (failed.length > 0) {
        const summary = failed.slice(0, 3).map((item) => `${item.question_id}：${item.error}`).join('；')
        setError(`已删除 ${deletedIds.length} 道，${failed.length} 道失败。${summary}`)
      } else {
        setMessage(`已删除 ${deletedIds.length} 道题目`)
      }
    } catch (err) {
      setError(err.message || '批量删除题目失败')
    } finally {
      setQuestionBatchDeleting(false)
    }
  }

  const onPublishQuestionsBatch = async ({ publishAll = false } = {}) => {
    if (!canReview) {
      setError('当前角色无题目审核发布权限。')
      return
    }
    if (questionDeletePendingId || questionPublishPendingId || questionBatchDeleting || questionBatchPublishing) return

    const ids = selectedQuestionIds.map((id) => Number(id || 0)).filter((id) => id > 0)
    if (!publishAll && !ids.length) {
      setError('请先勾选要发布的题目')
      return
    }

    const confirmed = window.confirm(
      publishAll
        ? '确认发布当前筛选条件下的所有草稿题吗？已发布或已归档题目会自动跳过。'
        : `确认发布选中的 ${ids.length} 道题目吗？仅草稿题会被发布。`
    )
    if (!confirmed) return

    clearFeedback()
    setQuestionBatchPublishing(true)
    try {
      const payload = await api.post('/api/train-exam/questions/bulk-publish', publishAll
        ? { filters: questionFilters }
        : { question_ids: ids })
      const publishedCount = Number(payload?.published_count || 0)
      const skippedCount = Number(payload?.skipped_count || 0)
      const failedCount = Number(payload?.failed_count || 0)
      const failed = Array.isArray(payload?.failed) ? payload.failed : []
      if (!publishAll) {
        const publishedIds = Array.isArray(payload?.published_ids)
          ? payload.published_ids.map((id) => Number(id || 0)).filter((id) => id > 0)
          : []
        setSelectedQuestionIds((prev) => prev.filter((qid) => !publishedIds.includes(Number(qid))))
      } else {
        setSelectedQuestionIds([])
      }
      await fetchQuestionCategories(true)
      await fetchQuestions(true)
      await fetchOverview(true)

      const summary = [`已发布 ${publishedCount} 道`]
      if (skippedCount > 0) summary.push(`跳过 ${skippedCount} 道`)
      if (failedCount > 0) summary.push(`失败 ${failedCount} 道`)
      if (failedCount > 0 && failed.length) {
        const detail = failed.slice(0, 3).map((item) => `${item.question_id}：${item.error}`).join('；')
        setError(`${summary.join('，')}。${detail}`)
      } else {
        setMessage(summary.join('，'))
      }
    } catch (err) {
      setError(err.message || '批量发布题目失败')
    } finally {
      setQuestionBatchPublishing(false)
    }
  }

  const onCreatePaper = async (e) => {
    e.preventDefault()
    clearFeedback()
    try {
      const payload = {
        name: paperForm.name,
        paper_mode: paperForm.paper_mode,
        pass_score: Number(paperForm.pass_score || 80),
        duration_minutes: Number(paperForm.duration_minutes || 60),
        max_attempts: Number(paperForm.max_attempts || 3),
        exam_window_hours: Number(paperForm.exam_window_hours || 72),
        fixed_question_ids: paperForm.fixed_question_ids,
        rules: paperForm.paper_mode === 'random'
          ? (Array.isArray(paperForm.rules) ? paperForm.rules : []).map((rule) => ({
              question_type: rule.question_type,
              difficulty: rule.difficulty,
              question_categories: Array.isArray(rule.question_categories) ? rule.question_categories : [],
              question_count: Number(rule.question_count || 1),
              points_per_question: Number(rule.points_per_question || 1),
              tags: parseCsvValues(rule.tags),
            }))
          : [],
      }
      const created = await api.post('/api/train-exam/papers', payload)
      setMessage(`试卷已创建：${created.id}`)
      setPaperForm(createDefaultPaperForm())
      await fetchPapers(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '创建试卷失败')
    }
  }

  const onPublishPaper = async (id) => {
    clearFeedback()
    try {
      await api.post(`/api/train-exam/papers/${id}/publish`, {})
      setMessage('试卷发布成功')
      await fetchPapers(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '发布试卷失败')
    }
  }

  const onOpenPaperScheduleDialog = (paper) => {
    clearFeedback()
    setPaperScheduleDialog(paper)
    setPaperScheduleForm(getShanghaiDateTimeParts(paper?.scheduled_publish_at))
  }

  const onClosePaperScheduleDialog = () => {
    if (paperScheduleSaving) return
    setPaperScheduleDialog(null)
  }

  const onSubmitPaperSchedule = async (event) => {
    event.preventDefault()
    if (!paperScheduleDialog?.id || paperScheduleSaving) return
    clearFeedback()
    const scheduledAt = buildScheduledPublishAt(paperScheduleForm)
    if (!scheduledAt) {
      setError('请选择定时发布的日期和时间')
      return
    }
    setPaperScheduleSaving(true)
    try {
      await api.post(`/api/train-exam/papers/${paperScheduleDialog.id}/schedule-publish`, {
        scheduled_publish_at: scheduledAt,
      })
      setMessage('试卷定时发布设置成功')
      setPaperScheduleDialog(null)
      await fetchPapers(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '设置定时发布失败')
    } finally {
      setPaperScheduleSaving(false)
    }
  }

  const onUpdatePaperExamWindow = async (paper) => {
    if (!canWrite) return
    const id = Number(paper?.id || 0)
    if (!id) return
    const currentHours = normalizePaperExamWindowHours(paper?.exam_window_hours)
    const input = window.prompt('请输入考试有效期小时数（1-8760）', String(currentHours))
    if (input === null) return
    const nextHours = normalizePaperExamWindowHours(input)
    clearFeedback()
    try {
      await api.put(`/api/train-exam/papers/${id}`, { exam_window_hours: nextHours })
      setMessage(`考试有效期已更新为 ${nextHours} 小时`)
      await fetchPapers(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '更新考试有效期失败')
    }
  }

  const onArchivePaper = async (id) => {
    clearFeedback()
    try {
      await api.post(`/api/train-exam/papers/${id}/archive`, {})
      setMessage('试卷已归档')
      await fetchPapers(true)
      await fetchOverview(true)
    } catch (err) {
      setError(err.message || '归档试卷失败')
    }
  }

  const syncStateAfterPaperDelete = async (deletedIds = []) => {
    const deletedSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).map((id) => Number(id || 0)).filter((id) => id > 0))
    const nextPapers = await fetchPapers(true)
    await fetchOverview(true)
    await fetchMyResults(true)
    await fetchCertificateCenter(true)

    const nextIds = new Set((nextPapers || []).map((item) => Number(item.id || 0)).filter((id) => id > 0))
    setSelectedPaperIds((prev) => prev.filter((id) => nextIds.has(Number(id || 0)) && !deletedSet.has(Number(id || 0))))

    const currentPaperId = Number(currentSession?.paper_id || currentResult?.paper_id || 0)
    if (currentPaperId > 0 && deletedSet.has(currentPaperId)) {
      setCurrentSession(null)
      setCurrentQuestions([])
      setActiveQuestionId(0)
      setRemainingSeconds(0)
      setCurrentResult(null)
      setResultAdvice(null)
      setIsSubmittingExam(false)
      setIsAutoSubmitting(false)
      setSavingQuestionId(0)
      setLastSavedAt('')
      setActiveMenu('papers')
    }
  }

  const onDeletePaper = async (item) => {
    if (!canWrite) {
      setError('当前角色无试卷删除权限。')
      return
    }
    const id = Number(item?.id || 0)
    if (!id) return
    const name = String(item?.name || `试卷-${id}`)
    const confirmed = window.confirm(`确认删除试卷“${name}”吗？会同步清理该试卷下考试记录与证书，删除后不可恢复。`)
    if (!confirmed) return
    clearFeedback()
    setPaperDeletePendingId(id)
    try {
      const payload = await api.del(`/api/train-exam/papers/${id}?force=1`)
      const removedResults = Number(payload?.removed_results || 0)
      setMessage(`试卷已删除：${name}（已清理成绩 ${removedResults} 条）`)
      await syncStateAfterPaperDelete([id])
    } catch (err) {
      setError(err.message || '删除试卷失败')
    } finally {
      setPaperDeletePendingId(0)
    }
  }

  const onDeletePapersBatch = async ({ deleteAll = false } = {}) => {
    if (!canWrite) {
      setError('当前角色无试卷删除权限。')
      return
    }
    if (paperDeletePendingId || paperBatchDeleting) return
    const ids = deleteAll
      ? (papers || []).map((item) => Number(item.id || 0)).filter((id) => id > 0)
      : selectedPaperIds.map((id) => Number(id || 0)).filter((id) => id > 0)
    if (!ids.length) {
      setError(deleteAll ? '当前没有可删除的试卷' : '请先勾选要删除的试卷')
      return
    }
    const label = deleteAll ? `全部 ${ids.length} 套试卷` : `选中的 ${ids.length} 套试卷`
    const confirmed = window.confirm(`确认删除${label}吗？会同步清理相关考试记录与证书，删除后不可恢复。`)
    if (!confirmed) return

    clearFeedback()
    setPaperBatchDeleting(true)
    try {
      const payload = await api.post('/api/train-exam/papers/bulk-delete', {
        paper_ids: ids,
        force: true,
      })
      const deletedIds = Array.isArray(payload?.deleted_ids) ? payload.deleted_ids.map((id) => Number(id || 0)).filter((id) => id > 0) : []
      const failed = Array.isArray(payload?.failed) ? payload.failed : []
      await syncStateAfterPaperDelete(deletedIds)

      if (failed.length > 0) {
        const summary = failed
          .slice(0, 3)
          .map((item) => `${item.paper_id}：${item.error}`)
          .join('；')
        setError(`已删除 ${deletedIds.length} 套，${failed.length} 套失败。${summary}`)
      } else {
        setMessage(`已删除 ${deletedIds.length} 套试卷`)
      }
    } catch (err) {
      setError(err.message || '批量删除试卷失败')
    } finally {
      setPaperBatchDeleting(false)
    }
  }

  const onOpenHistoryResult = async (resultId, { silent = false, skipConfirm = false } = {}) => {
    const rid = Number(resultId || 0)
    if (!rid || historyResultLoading) return
    const hasRunningSession = Number(currentSession?.id || 0) > 0
      && !currentResult
      && String(currentSession?.status || '').toLowerCase() === 'started'
    if (hasRunningSession && !skipConfirm) {
      const confirmed = window.confirm('当前考试仍在进行中，切换查看历史考卷将离开当前答题视图，是否继续？')
      if (!confirmed) return
    }
    if (!silent) clearFeedback()
    setHistoryResultLoading(true)
    try {
      const resultPayload = await api.get(`/api/train-exam/results/${rid}`)
      const sessionId = Number(resultPayload?.session_id || 0)
      const sessionPayload = sessionId > 0 ? await api.get(`/api/train-exam/exam-sessions/${sessionId}`) : null
      const historyQuestions = Array.isArray(sessionPayload?.questions) ? sessionPayload.questions : []
      setCurrentSession(sessionPayload?.session || {
        id: sessionId,
        paper_id: Number(resultPayload?.paper_id || 0),
        status: 'submitted',
        focus_switch_count: 0,
      })
      setCurrentQuestions(historyQuestions)
      setActiveQuestionId(Number(historyQuestions?.[0]?.question_id || 0))
      setRemainingSeconds(Math.max(0, Number(sessionPayload?.remaining_seconds || 0)))
      setCurrentResult(resultPayload || null)
      setSelectedHistoryResultId(String(rid))
      setResultAdvice(resultPayload?.ai_advice || null)
      setIsAdviceLoading(false)
      setIsAutoSubmitting(false)
      setIsSubmittingExam(false)
      setSavingQuestionId(0)
      setLastSavedAt('')
      if (!silent) setMessage(`已切换到历史考卷：成绩 #${rid}`)
      if (activeMenu !== 'exam') setActiveMenu('exam')
    } catch (err) {
      setError(err.message || '加载历史考卷失败')
    } finally {
      setHistoryResultLoading(false)
    }
  }

  const applyExamSessionPayload = (payload, messageText = '') => {
    const nextQuestions = Array.isArray(payload?.questions) ? payload.questions : []
    setCurrentSession(payload?.session || null)
    setCurrentQuestions(nextQuestions)
    setActiveQuestionId(Number(nextQuestions?.[0]?.question_id || 0))
    const duration = Number(payload?.session?.duration_minutes || 60)
    const remaining = Number(payload?.remaining_seconds)
    setRemainingSeconds(Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : Math.max(0, Math.floor(duration * 60)))
    setCurrentResult(null)
    setSelectedHistoryResultId('')
    setResultAdvice(null)
    setIsAdviceLoading(false)
    setIsAutoSubmitting(false)
    setIsSubmittingExam(false)
    setSavingQuestionId(0)
    setLastSavedAt('')
    if (messageText) setMessage(messageText)
    setActiveMenu('exam')
  }

  const restoreExamSessionById = async (sessionId, { silent = false } = {}) => {
    const sid = Number(sessionId || 0)
    if (!sid) {
      if (typeof window !== 'undefined') clearPersistedExamSessionId(window.sessionStorage)
      return null
    }
    if (!silent) clearFeedback()
    try {
      const payload = await api.get(`/api/train-exam/exam-sessions/${sid}`)
      if (String(payload?.session?.status || '').toLowerCase() === 'started') {
        applyExamSessionPayload(payload, silent ? '' : `已恢复考试会话：${sid}`)
        return payload
      }
      if (typeof window !== 'undefined') clearPersistedExamSessionId(window.sessionStorage)
      return payload
    } catch (err) {
      if (typeof window !== 'undefined') clearPersistedExamSessionId(window.sessionStorage)
      if (!silent) setError(err.message || '恢复考试会话失败')
      return null
    }
  }

  const restorePersistedExamSession = async ({ silent = true } = {}) => {
    if (typeof window === 'undefined') return null
    const sessionId = readPersistedExamSessionId(window.sessionStorage)
    if (!sessionId) return null
    return restoreExamSessionById(sessionId, { silent })
  }

  const onStartExam = async (paperId) => {
    clearFeedback()
    try {
      const payload = await api.post(`/api/train-exam/papers/${paperId}/exam/start`, {})
      applyExamSessionPayload(
        payload,
        payload?.resumed ? `已恢复考试，会话ID：${payload?.session?.id}` : `考试已开始，会话ID：${payload?.session?.id}`
      )
    } catch (err) {
      setError(err.message || '开始考试失败')
    }
  }

  const onStartRetrain = async ({ resultId = 0, mode = 'result', questionIds = [], selectAll = false } = {}) => {
    if (retrainStarting) return

    const hasRunningSession = Number(currentSession?.id || 0) > 0
      && !currentResult
      && String(currentSession?.status || '').toLowerCase() === 'started'
    if (hasRunningSession) {
      const confirmed = window.confirm('当前考试仍在进行中，启动复训将离开当前答题视图，是否继续？')
      if (!confirmed) return
    }

    clearFeedback()
    setRetrainStarting(true)
    try {
      let payload = null
      let tip = ''
      if (String(mode || 'result') === 'notebook') {
        const selectedIds = Array.isArray(questionIds) ? questionIds.map((id) => Number(id || 0)).filter((id) => id > 0) : []
        if (!selectAll && !selectedIds.length) {
          setError('请先选择错题本题目')
          return
        }
        payload = await api.post('/api/train-exam/retrain/start', {
          mode: 'notebook',
          select_all: !!selectAll,
          question_ids: selectedIds,
        })
        tip = `${selectAll ? '已按错题本全部题目' : '已按错题本选中题目'}启动复训，会话ID：${payload?.session?.id}`
      } else {
        if (!Number(resultId || retrainHistoryResultId || 0)) {
          setError('请先选择历史考试记录')
          return
        }
        payload = await api.post('/api/train-exam/retrain/start', {
          mode: 'result',
          result_id: Number(resultId || retrainHistoryResultId || 0),
          question_type: retrainFilters.question_type,
          question_category: retrainFilters.question_category,
        })
        tip = `已按历史考试启动复训，会话ID：${payload?.session?.id}`
      }
      applyExamSessionPayload(payload, tip)
      await fetchRetrainCenter(true)
    } catch (err) {
      setError(err.message || '启动错题复训失败')
    } finally {
      setRetrainStarting(false)
    }
  }

  const onStartWrongNotebookRetrain = async ({ selectAll = false } = {}) => {
    const selectedIds = selectAll
      ? (Array.isArray(wrongNotebook?.items) ? wrongNotebook.items : []).map((item) => Number(item?.question_id || 0)).filter((id) => id > 0)
      : selectedWrongQuestionIds.map((id) => Number(id || 0)).filter((id) => id > 0)
    await onStartRetrain({ mode: 'notebook', questionIds: selectedIds, selectAll })
  }

  const onAnswerQuestion = async (questionId, value) => {
    if (!currentSession?.id) return
    setActiveQuestionId(Number(questionId) || 0)
    setCurrentQuestions((prev) =>
      prev.map((item) =>
        Number(item.question_id) === Number(questionId)
          ? { ...item, user_answer: value }
          : item
      )
    )
    setSavingQuestionId(Number(questionId) || 0)

    try {
      await api.post(`/api/train-exam/exam-sessions/${currentSession.id}/answers`, {
        question_id: questionId,
        user_answer: value,
      })
      setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    } catch (err) {
      setError(err.message || '保存答案失败')
    } finally {
      setSavingQuestionId(0)
    }
  }

  const onSubmitExam = async ({ timeoutAuto = false } = {}) => {
    if (!currentSession?.id || currentResult || isSubmittingExam) return
    clearFeedback()
    setIsSubmittingExam(true)
    try {
      const result = await api.post(`/api/train-exam/exam-sessions/${currentSession.id}/submit`, {})
      setCurrentResult(result)
      setSelectedHistoryResultId(String(Number(result?.id || 0) || ''))
      const advice = result?.ai_advice || null
      setResultAdvice(advice)
      if (timeoutAuto) {
        setMessage(`考试超时已自动交卷：得分 ${Number(result.score || 0).toFixed(2)}`)
      } else {
        setMessage(`交卷成功：得分 ${Number(result.score || 0).toFixed(2)}`)
      }
      if (!isBasicUser && !advice && Number(result?.id || 0) > 0) {
        await onGenerateResultAdvice(Number(result.id), { silent: true })
      }
      await fetchMyResults(true)
      if (!isBasicUser) {
        await fetchOverview(true)
      }
    } catch (err) {
      setError(err.message || '交卷失败')
      if (timeoutAuto) {
        setIsAutoSubmitting(false)
      }
    } finally {
      setIsSubmittingExam(false)
    }
  }

  const onConfirmSubmitExam = () => {
    if (!currentSession?.id || currentResult || isSubmittingExam) return
    const confirmed = window.confirm('确认提交试卷？提交后将不能再修改答案。')
    if (!confirmed) return
    onSubmitExam()
  }

  const onFocusSwitch = async () => {
    if (!currentSession?.id) return
    try {
      const payload = await api.post(`/api/train-exam/exam-sessions/${currentSession.id}/focus-switch`, {})
      setCurrentSession((prev) => (prev ? { ...prev, focus_switch_count: Number(payload?.focus_switch_count || 0) } : prev))
    } catch {
      // no-op
    }
  }

  const onJumpToQuestion = (questionId) => {
    const qid = Number(questionId || 0)
    if (!qid) return
    setActiveQuestionId(qid)
    const target = document.getElementById(`exam-question-${qid}`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const onGenerateCertificate = async (resultId) => {
    clearFeedback()
    try {
      const payload = await api.post(`/api/train-exam/results/${resultId}/certificate/generate`, {})
      setMessage(`证书已生成：${payload.certificate_no}`)
      await fetchMyResults(true)
      await fetchCertificateCenter(true)
    } catch (err) {
      setError(err.message || '生成证书失败')
    }
  }

  const onGenerateResultAdvice = async (resultId, { force = false, silent = false } = {}) => {
    const rid = Number(resultId || currentResult?.id || 0)
    if (!rid) return
    if (!silent) clearFeedback()
    setIsAdviceLoading(true)
    try {
      const payload = await api.post(`/api/train-exam/results/${rid}/advice/generate`, { force })
      setResultAdvice(payload || null)
      if (!silent) setMessage('AI学习建议已生成')
      return payload
    } catch (err) {
      if (!silent) setError(err.message || '生成AI学习建议失败')
      return null
    } finally {
      setIsAdviceLoading(false)
    }
  }

  const onDownloadCertificate = (resultId) => {
    window.open(`/api/train-exam/results/${resultId}/certificate/download`, '_blank')
  }

  const onUploadCertificateTemplate = async () => {
    if (!canWrite) {
      setError('当前角色无证书模板管理权限。')
      return
    }
    if (certTemplateUploading) return
    if (!certTemplateFile) {
      setError('请先选择模板图片文件')
      return
    }
    clearFeedback()
    setCertTemplateUploading(true)
    try {
      const form = new FormData()
      form.append('file', certTemplateFile)
      const payload = await api.postForm('/api/train-exam/certificate-template/upload', form)
      setCertTemplate(payload && typeof payload === 'object' ? payload : { exists: false })
      setCertTemplateFile(null)
      setCertTemplateInputKey((prev) => prev + 1)
      setMessage('证书模板已上传，可直接预览并用于新证书生成')
    } catch (err) {
      setError(err.message || '上传证书模板失败')
    } finally {
      setCertTemplateUploading(false)
    }
  }

  const onDeleteCertificateTemplate = async () => {
    if (!canWrite) {
      setError('当前角色无证书模板管理权限。')
      return
    }
    if (certTemplateDeleting) return
    const confirmed = window.confirm('确认删除当前已上传证书模板吗？删除后将恢复默认样式（或环境变量模板）。')
    if (!confirmed) return
    clearFeedback()
    setCertTemplateDeleting(true)
    try {
      const payload = await api.del('/api/train-exam/certificate-template')
      setCertTemplate(payload?.current && typeof payload.current === 'object' ? payload.current : { exists: false })
      setMessage('证书模板已删除')
    } catch (err) {
      setError(err.message || '删除证书模板失败')
    } finally {
      setCertTemplateDeleting(false)
    }
  }

  const onStartRecertJob = async (jobId, paperId) => {
    clearFeedback()
    try {
      await api.post(`/api/train-exam/recertification/jobs/${jobId}/start`, {})
      setMessage('续证任务已启动，正在进入复考。')
      await fetchCertificateCenter(true)
      await onStartExam(Number(paperId))
    } catch (err) {
      setError(err.message || '启动续证任务失败')
    }
  }

  const onSaveUserProfile = async (e) => {
    e.preventDefault()
    clearFeedback()
    try {
      const userId = Number(profileForm.user_id || 0)
      if (!userId || !String(profileForm.username || '').trim()) {
        setError('请输入用户ID和用户名')
        return
      }
      await api.put(`/api/train-exam/user-profiles/${userId}`, {
        username: profileForm.username,
        department: profileForm.department,
        position_title: profileForm.position_title,
      })
      setMessage('用户部门/岗位画像已保存')
      setProfileForm({ user_id: '', username: '', department: '', position_title: '' })
      await fetchUserProfiles(true)
      if (canAudit) await fetchOrgBreakdown(orgGroupBy, true)
    } catch (err) {
      setError(err.message || '保存用户画像失败')
    }
  }

  const onSaveOssSettings = async (e) => {
    e.preventDefault()
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可维护阿里云 OSS 配置')
      return
    }
    if (ossSettingsSaving) return

    setOssSettingsSaving(true)
    try {
      const payload = await api.put('/api/train-exam/settings/oss', {
        enabled: !!ossSettingsForm.enabled,
        region: ossSettingsForm.region,
        bucket: ossSettingsForm.bucket,
        endpoint: ossSettingsForm.endpoint,
        access_key_id: ossSettingsForm.access_key_id,
        access_key_secret: ossSettingsForm.access_key_secret,
        sts_token: ossSettingsForm.sts_token,
        signed_upload_expires_seconds: Number(ossSettingsForm.signed_upload_expires_seconds || 600),
        signed_play_expires_seconds: Number(ossSettingsForm.signed_play_expires_seconds || 300),
        upload_max_file_size_mb: Number(ossSettingsForm.upload_max_file_size_mb || 2048),
      })
      const normalized = normalizeOssSettingsResponse(payload)
      setOssSettingsForm(normalized.form)
      setOssSettingsStatus(normalized.status)
      setMessage(normalized.status.configured ? '阿里云 OSS 配置已保存并生效' : '阿里云 OSS 已保存为关闭状态')
    } catch (err) {
      setError(err.message || '保存阿里云 OSS 配置失败')
    } finally {
      setOssSettingsSaving(false)
    }
  }

  const onCreateAiModel = async (e) => {
    e.preventDefault()
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可维护大模型配置')
      return
    }
    try {
      await api.post('/api/train-exam/ai/models', {
        model_key: modelForm.model_key,
        name: modelForm.name,
        base_url: modelForm.base_url,
        model_name: modelForm.model_name,
        api_key: modelForm.api_key || undefined,
        timeout_ms: Number(modelForm.timeout_ms || 20000),
        max_tokens: Number(modelForm.max_tokens || 2048),
        temperature_default: Number(modelForm.temperature_default || 0.3),
        is_enabled: !!modelForm.is_enabled,
        is_default: !!modelForm.is_default,
      })
      setMessage('大模型已新增')
      setModelForm({
        model_key: '',
        name: '',
        base_url: '',
        model_name: '',
        api_key: '',
        timeout_ms: 20000,
        max_tokens: 2048,
        temperature_default: 0.3,
        is_enabled: true,
        is_default: false,
      })
      setAiModelDraftTestResult(null)
      await fetchAiModels(true)
    } catch (err) {
      setError(err.message || '新增大模型失败')
    }
  }

  const onTestAiModelDraft = async () => {
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可测试模型可用性')
      return
    }
    if (aiModelDraftTestPending) return
    if (!String(modelForm.base_url || '').trim()) {
      setError('请先填写接口地址（Base URL）')
      return
    }
    if (!String(modelForm.model_name || '').trim()) {
      setError('请先填写模型名')
      return
    }
    if (!String(modelForm.api_key || '').trim()) {
      setError('请先填写API Key后再测试')
      return
    }

    setAiModelDraftTestPending(true)
    try {
      const payload = await api.post('/api/train-exam/ai/models/test', {
        model_key: modelForm.model_key || undefined,
        name: modelForm.name || undefined,
        base_url: modelForm.base_url,
        model_name: modelForm.model_name,
        api_key: modelForm.api_key,
        timeout_ms: Number(modelForm.timeout_ms || 20000),
      })
      const testResult = payload && typeof payload === 'object' ? payload : null
      setAiModelDraftTestResult(testResult)
      if (testResult?.available) {
        const latencyText = Number(testResult?.latency_ms || 0) > 0 ? `，耗时 ${Number(testResult.latency_ms)}ms` : ''
        setMessage(`新增配置测试通过${latencyText}`)
      } else {
        setError(testResult?.error_message || '模型不可用，请检查接口地址、模型名和密钥')
      }
    } catch (err) {
      setAiModelDraftTestResult({
        available: false,
        status: 'FAILED',
        latency_ms: 0,
        error_message: err.message || '测试失败',
        checked_at: new Date().toISOString(),
      })
      setError(err.message || '测试模型失败')
    } finally {
      setAiModelDraftTestPending(false)
    }
  }

  const onSetDefaultAiModel = async (id) => {
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可设置默认模型')
      return
    }
    try {
      await api.put(`/api/train-exam/ai/models/${id}`, { is_default: true, is_enabled: true })
      setMessage('默认模型已更新')
      await fetchAiModels(true)
    } catch (err) {
      setError(err.message || '设置默认模型失败')
    }
  }

  const onToggleAiModelEnabled = async (id, nextEnabled) => {
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可启停模型')
      return
    }
    try {
      await api.put(`/api/train-exam/ai/models/${id}`, { is_enabled: !!nextEnabled })
      setMessage('模型状态已更新')
      await fetchAiModels(true)
    } catch (err) {
      setError(err.message || '更新模型状态失败')
    }
  }

  const onTestAiModel = async (model) => {
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可测试模型可用性')
      return
    }
    const id = Number(model?.id || 0)
    if (!id || aiModelTestPendingId) return

    setAiModelTestPendingId(id)
    try {
      const payload = await api.post(`/api/train-exam/ai/models/${id}/test`, {})
      setAiModelTestResults((prev) => ({
        ...prev,
        [id]: payload && typeof payload === 'object' ? payload : null,
      }))
      if (payload?.available) {
        const latencyText = Number(payload?.latency_ms || 0) > 0 ? `，耗时 ${Number(payload.latency_ms)}ms` : ''
        setMessage(`模型可用：${model?.name || model?.model_key}${latencyText}`)
      } else {
        setError(payload?.error_message || '模型不可用，请检查接口地址、模型名和密钥')
      }
    } catch (err) {
      setAiModelTestResults((prev) => ({
        ...prev,
        [id]: {
          available: false,
          status: 'FAILED',
          latency_ms: 0,
          error_message: err.message || '测试失败',
          checked_at: new Date().toISOString(),
        },
      }))
      setError(err.message || '测试模型失败')
    } finally {
      setAiModelTestPendingId(0)
    }
  }

  const closeAiModelEditModal = () => {
    if (aiModelEditSaving) return
    setAiModelEditVisible(false)
    setEditingAiModelId(0)
  }

  const onOpenAiModelEdit = (model) => {
    if (!isAdminRole) {
      setError('仅管理员可维护模型')
      return
    }
    const id = Number(model?.id || 0)
    if (!id) return
    setEditingAiModelId(id)
    setAiModelEditForm({
      name: String(model?.name || ''),
      base_url: String(model?.base_url || ''),
      model_name: String(model?.model_name || ''),
      api_key: '',
      max_tokens: Number(model?.max_tokens || 2048),
      is_enabled: Number(model?.is_enabled || 0) === 1,
      is_default: Number(model?.is_default || 0) === 1,
    })
    setAiModelEditVisible(true)
  }

  const onSubmitAiModelEdit = async (e) => {
    e.preventDefault()
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可维护模型')
      return
    }
    const id = Number(editingAiModelId || 0)
    if (!id) {
      setError('模型ID无效')
      return
    }
    if (!String(aiModelEditForm.name || '').trim()) {
      setError('显示名称不能为空')
      return
    }
    if (!String(aiModelEditForm.base_url || '').trim()) {
      setError('接口地址不能为空')
      return
    }
    if (!String(aiModelEditForm.model_name || '').trim()) {
      setError('模型名不能为空')
      return
    }
    setAiModelEditSaving(true)
    try {
      const payload = {
        name: aiModelEditForm.name,
        base_url: aiModelEditForm.base_url,
        model_name: aiModelEditForm.model_name,
        max_tokens: Number(aiModelEditForm.max_tokens || 2048),
        is_enabled: !!aiModelEditForm.is_enabled,
        is_default: !!aiModelEditForm.is_default,
      }
      if (String(aiModelEditForm.api_key || '').trim()) {
        payload.api_key = aiModelEditForm.api_key
      }
      await api.put(`/api/train-exam/ai/models/${id}`, payload)
      setMessage('模型已更新')
      setAiModelEditVisible(false)
      setEditingAiModelId(0)
      await fetchAiModels(true)
    } catch (err) {
      setError(err.message || '更新模型失败')
    } finally {
      setAiModelEditSaving(false)
    }
  }

  const onDeleteAiModel = async (model) => {
    clearFeedback()
    if (!isAdminRole) {
      setError('仅管理员可删除模型')
      return
    }
    const id = Number(model?.id || 0)
    if (!id || aiModelDeletePendingId) return
    const name = String(model?.name || model?.model_key || `模型-${id}`)
    const confirmed = window.confirm(`确认删除模型“${name}”吗？删除后不可恢复。`)
    if (!confirmed) return
    setAiModelDeletePendingId(id)
    try {
      await api.del(`/api/train-exam/ai/models/${id}`)
      setMessage(`模型已删除：${name}`)
      if (Number(editingAiModelId || 0) === id) {
        setAiModelEditVisible(false)
        setEditingAiModelId(0)
      }
      await fetchAiModels(true)
    } catch (err) {
      setError(err.message || '删除模型失败')
    } finally {
      setAiModelDeletePendingId(0)
    }
  }

  useEffect(() => {
    fetchBootstrap()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (
      Number(currentSession?.id || 0) > 0
      && !currentResult
      && String(currentSession?.status || '').toLowerCase() === 'started'
    ) {
      persistExamSessionId(window.sessionStorage, Number(currentSession.id))
      return
    }
    clearPersistedExamSessionId(window.sessionStorage)
  }, [currentSession?.id, currentSession?.status, currentResult])

  useEffect(() => () => {
    stopTranscodePolling()
    stopLearningPathPolling()
    destroyDocPreviewEditor()
  }, [])

  useEffect(() => {
    if (!isDocPreviewOpen || !docPreviewPayload?.editor || !window.DocsAPI?.DocEditor) return
    const timer = setTimeout(() => {
      destroyDocPreviewEditor()
      try {
        const rawConfig = docPreviewPayload.editor.config || {}
        const baseEvents = rawConfig.events || {}
        docPreviewEditorRef.current = new window.DocsAPI.DocEditor(docPreviewContainerId, {
          ...rawConfig,
          events: {
            ...baseEvents,
            onError: (event) => {
              if (typeof baseEvents.onError === 'function') baseEvents.onError(event)
              const code = event?.data?.errorCode
              const desc = event?.data?.errorDescription || '文档加载失败'
              setDocPreviewNotice(`Office预览错误${code ? `(${code})` : ''}：${desc}`)
            },
          },
          token: docPreviewPayload.editor.token,
          width: '100%',
          height: '100%',
        })
      } catch {
        setDocPreviewNotice('Office预览器初始化失败，请稍后重试。')
      }
    }, 80)
    return () => {
      clearTimeout(timer)
    }
  }, [isDocPreviewOpen, docPreviewPayload, docPreviewContainerId])

  useEffect(() => {
    if (activeMenu !== 'courses') {
      stopLearningPathPolling()
      return undefined
    }
    const cid = Number(learningCourseId || 0)
    if (!cid || !hasLearningPathTranscoding) {
      stopLearningPathPolling()
      return undefined
    }
    stopLearningPathPolling()
    const doPoll = async () => {
      if (learningPathPollBusyRef.current) return
      learningPathPollBusyRef.current = true
      try {
        await fetchLearningPath(cid, true)
      } catch {
        // 静默轮询，避免打断用户当前操作
      } finally {
        learningPathPollBusyRef.current = false
      }
    }
    learningPathPollTimerRef.current = setInterval(doPoll, 3000)
    return () => {
      stopLearningPathPolling()
    }
  }, [activeMenu, learningCourseId, hasLearningPathTranscoding])

  useEffect(() => {
    if (
      !learningPlayerDragState &&
      !learningPlayerResizeState &&
      !docPreviewDragState &&
      !docPreviewResizeState &&
      !courseLearningDragState &&
      !courseLearningResizeState
    ) return undefined
    const onPointerMove = (event) => {
      if (courseLearningDragState && !courseLearningModal.maximized) {
        const dx = Number(event.clientX || 0) - Number(courseLearningDragState.startX || 0)
        const dy = Number(event.clientY || 0) - Number(courseLearningDragState.startY || 0)
        setCourseLearningModal((prev) => {
          const nextRect = clampCourseLearningModalRect({
            ...prev,
            left: Number(courseLearningDragState.startLeft || 0) + dx,
            top: Number(courseLearningDragState.startTop || 0) + dy,
          })
          return { ...prev, ...nextRect }
        })
      }
      if (courseLearningResizeState && !courseLearningModal.maximized) {
        const dx = Number(event.clientX || 0) - Number(courseLearningResizeState.startX || 0)
        const dy = Number(event.clientY || 0) - Number(courseLearningResizeState.startY || 0)
        setCourseLearningModal((prev) => {
          const nextRect = clampCourseLearningModalRect({
            ...prev,
            width: Number(courseLearningResizeState.startWidth || 0) + dx,
            height: Number(courseLearningResizeState.startHeight || 0) + dy,
          })
          return { ...prev, ...nextRect }
        })
      }
      if (learningPlayerDragState && !learningPlayerModal.maximized) {
        const dx = Number(event.clientX || 0) - Number(learningPlayerDragState.startX || 0)
        const dy = Number(event.clientY || 0) - Number(learningPlayerDragState.startY || 0)
        setLearningPlayerModal((prev) => {
          const nextRect = clampPlayerModalRect({
            ...prev,
            left: Number(learningPlayerDragState.startLeft || 0) + dx,
            top: Number(learningPlayerDragState.startTop || 0) + dy,
          })
          return { ...prev, ...nextRect }
        })
      }
      if (learningPlayerResizeState && !learningPlayerModal.maximized) {
        const dx = Number(event.clientX || 0) - Number(learningPlayerResizeState.startX || 0)
        const dy = Number(event.clientY || 0) - Number(learningPlayerResizeState.startY || 0)
        setLearningPlayerModal((prev) => {
          const nextRect = clampPlayerModalRect({
            ...prev,
            width: Number(learningPlayerResizeState.startWidth || 0) + dx,
            height: Number(learningPlayerResizeState.startHeight || 0) + dy,
          })
          return { ...prev, ...nextRect }
        })
      }
      if (docPreviewDragState && !docPreviewModal.maximized) {
        const dx = Number(event.clientX || 0) - Number(docPreviewDragState.startX || 0)
        const dy = Number(event.clientY || 0) - Number(docPreviewDragState.startY || 0)
        setDocPreviewModal((prev) => {
          const nextRect = clampDocPreviewModalRect({
            ...prev,
            left: Number(docPreviewDragState.startLeft || 0) + dx,
            top: Number(docPreviewDragState.startTop || 0) + dy,
          })
          return { ...prev, ...nextRect }
        })
      }
      if (docPreviewResizeState && !docPreviewModal.maximized) {
        const dx = Number(event.clientX || 0) - Number(docPreviewResizeState.startX || 0)
        const dy = Number(event.clientY || 0) - Number(docPreviewResizeState.startY || 0)
        setDocPreviewModal((prev) => {
          const nextRect = clampDocPreviewModalRect({
            ...prev,
            width: Number(docPreviewResizeState.startWidth || 0) + dx,
            height: Number(docPreviewResizeState.startHeight || 0) + dy,
          })
          return { ...prev, ...nextRect }
        })
      }
    }
    const onPointerUp = () => {
      setCourseLearningDragState(null)
      setCourseLearningResizeState(null)
      setLearningPlayerDragState(null)
      setLearningPlayerResizeState(null)
      setDocPreviewDragState(null)
      setDocPreviewResizeState(null)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [
    courseLearningDragState,
    courseLearningResizeState,
    courseLearningModal.maximized,
    learningPlayerDragState,
    learningPlayerResizeState,
    learningPlayerModal.maximized,
    docPreviewDragState,
    docPreviewResizeState,
    docPreviewModal.maximized,
  ])

  useEffect(() => {
    const onWindowResize = () => {
      setCourseLearningModal((prev) => {
        if (prev.maximized) {
          const vw = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1440
          const vh = typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 900
          return {
            ...prev,
            left: 8,
            top: 8,
            width: Math.max(520, vw - 16),
            height: Math.max(360, vh - 16),
          }
        }
        const nextRect = clampCourseLearningModalRect(prev)
        return { ...prev, ...nextRect }
      })
      setLearningPlayerModal((prev) => {
        if (prev.maximized) {
          const vw = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1280
          const vh = typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 800
          return {
            ...prev,
            left: 8,
            top: 8,
            width: Math.max(320, vw - 16),
            height: Math.max(260, vh - 16),
          }
        }
        const nextRect = clampPlayerModalRect(prev)
        return { ...prev, ...nextRect }
      })
      setDocPreviewModal((prev) => {
        if (prev.maximized) {
          const vw = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1280
          const vh = typeof window !== 'undefined' ? Number(window.innerHeight || 0) : 800
          return {
            ...prev,
            left: 8,
            top: 8,
            width: Math.max(340, vw - 16),
            height: Math.max(280, vh - 16),
          }
        }
        const nextRect = clampDocPreviewModalRect(prev)
        return { ...prev, ...nextRect }
      })
    }
    window.addEventListener('resize', onWindowResize)
    return () => {
      window.removeEventListener('resize', onWindowResize)
    }
  }, [])

  useEffect(() => {
    if (courseLearningDragState || courseLearningResizeState) return
    persistCourseLearningModalLayout(courseLearningModal)
  }, [courseLearningModal, courseLearningDragState, courseLearningResizeState])

  useEffect(() => {
    const player = learningVideoRef.current
    if (!player) return
    player.volume = Math.max(0, Math.min(1, Number(learningPlayerVolume || 0) / 100))
    player.muted = Number(learningPlayerVolume || 0) <= 0
  }, [learningPlayerVolume, selectedLearningResourceId, isLearningPlayerOpen])

  useEffect(() => {
    const isVideo = String(selectedLearningResource?.resource_type || '').toLowerCase() === 'video'
    if (!isVideo) {
      setIsLearningPlayerOpen(false)
    }
  }, [selectedLearningResource])

  useEffect(() => {
    if (activeMenu === 'courses') return
    setIsLearningPlayerOpen(false)
    closeCourseLearningModal()
    setResourceEditVisible(false)
    setEditingResourceId(0)
  }, [activeMenu])

  useEffect(() => {
    if (!currentSession?.id || !remainingSeconds || currentResult) return
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [currentSession?.id, remainingSeconds, currentResult])

  useEffect(() => {
    if (!currentSession?.id || currentResult || remainingSeconds > 0 || isAutoSubmitting) return
    setIsAutoSubmitting(true)
    onSubmitExam({ timeoutAuto: true })
  }, [currentSession?.id, currentResult, remainingSeconds, isAutoSubmitting])

  useEffect(() => {
    if (activeMenu !== 'courses') return
    if (!courses.length) return
    const selectedExists = courses.some((item) => Number(item.id) === Number(learningCourseId || 0))
    if (!selectedExists) {
      const firstCourseId = Number(courses[0]?.id || 0)
      if (firstCourseId) {
        setLearningCourseId(String(firstCourseId))
        fetchLearningPath(firstCourseId, true).catch(() => {})
      }
    }
  }, [activeMenu, courses, learningCourseId])

  useEffect(() => {
    if (activeMenu !== 'courses') return
    if (!courses.length) return
    if (Number(resourceForm.course_id || 0)) return
    const firstCourseId = Number(courses[0]?.id || 0)
    if (!firstCourseId) return
    setResourceForm((prev) => ({ ...prev, course_id: String(firstCourseId) }))
  }, [activeMenu, courses, resourceForm.course_id])

  useEffect(() => {
    const exists = new Set((courses || []).map((item) => Number(item.id || 0)).filter((id) => id > 0))
    setSelectedCourseIds((prev) => prev.filter((id) => exists.has(Number(id || 0))))
  }, [courses])

  useEffect(() => {
    const visibleIds = new Set(
      (Array.isArray(wrongNotebook?.items) ? wrongNotebook.items : [])
        .map((item) => Number(item?.question_id || 0))
        .filter((id) => id > 0)
    )
    setSelectedWrongQuestionIds((prev) => prev.filter((id) => visibleIds.has(Number(id || 0))))
  }, [wrongNotebook.items])

  useEffect(() => {
    const names = (Array.isArray(questionCategories) ? questionCategories : [])
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
    if (!names.length) return
    if (!names.includes(String(questionForm.question_category || '').trim())) {
      const fallback = names.includes('手工创建') ? '手工创建' : names[0]
      setQuestionForm((prev) => ({ ...prev, question_category: fallback }))
    }
    if (String(questionFilters.category || 'all') !== 'all' && !names.includes(String(questionFilters.category || '').trim())) {
      setQuestionFilters((prev) => ({ ...prev, category: 'all' }))
    }
    if (String(retrainFilters.question_category || 'all') !== 'all' && !names.includes(String(retrainFilters.question_category || '').trim())) {
      setRetrainFilters((prev) => ({ ...prev, question_category: 'all' }))
    }
  }, [questionCategories, questionFilters.category, retrainFilters.question_category])

  useEffect(() => {
    const ids = new Set((Array.isArray(myResults) ? myResults : []).map((item) => Number(item?.id || 0)).filter((id) => id > 0))
    setSelectedHistoryResultId((prev) => {
      if (prev && ids.has(Number(prev || 0))) return prev
      const first = Number((Array.isArray(myResults) ? myResults[0]?.id : 0) || 0)
      return first > 0 ? String(first) : ''
    })
    setRetrainHistoryResultId((prev) => {
      if (prev && ids.has(Number(prev || 0))) return prev
      const first = Number((Array.isArray(myResults) ? myResults[0]?.id : 0) || 0)
      return first > 0 ? String(first) : ''
    })
  }, [myResults])

  useEffect(() => {
    const aliveIds = new Set((Array.isArray(aiModels) ? aiModels : []).map((item) => Number(item?.id || 0)).filter((id) => id > 0))
    setAiModelTestResults((prev) => {
      const entries = Object.entries(prev || {}).filter(([id]) => aliveIds.has(Number(id || 0)))
      return Object.fromEntries(entries)
    })
  }, [aiModels])

  useEffect(() => {
    const visibleIds = new Set((filteredQuestions || []).map((item) => Number(item.id || 0)).filter((id) => id > 0))
    setSelectedQuestionIds((prev) => prev.filter((id) => visibleIds.has(Number(id || 0))))
  }, [filteredQuestions])

  useEffect(() => {
    const player = learningVideoRef.current
    if (player) player.pause()
    setVideoRuntime({ current: 0, duration: 0, playing: false })
    learningVideoTrackerRef.current = { lastSyncTs: 0, lastPos: 0, maxPos: 0, blockedToastAt: 0 }
  }, [selectedLearningResourceId, learningCourseId])

  const renderCourseLearningModalBody = () => {
    const totalResources = Math.max(0, Number(learningPath.summary?.total_resources || 0))
    const completedResources = Math.max(0, Number(learningPath.summary?.completed_resources || 0))
    const inProgressResources = Math.max(0, Number(learningPath.summary?.in_progress_resources || 0))
    const notStartedResources = Math.max(0, Number(learningPath.summary?.not_started_resources || 0))
    const completionRate = normalizeLearningProgressPercent(learningPath.summary?.completion_rate)
    const courseSummaryText = totalResources <= 0
      ? '当前课程还没有章节资源，稍后可在这里继续学习。'
      : completionRate >= 100
        ? '本课程已全部完成，可以回看任一章节巩固内容。'
        : spotlightLearningItem
          ? `下一步建议继续第 ${spotlightLearningItem.chapter_no} 章，保持学习节奏。`
          : `当前共有 ${totalResources} 个章节，建议按顺序完成。`

    return (
      <>
        <div className="modal-body course-learning-overview">
          <section className="course-learning-hero">
            <div className="course-learning-eyebrow">课程学习空间</div>
            <div className="course-learning-hero-copy">
              <p>{courseSummaryText}</p>
            </div>
            <div className="course-learning-progress-bar">
              <div className="course-learning-progress-main">
                <strong>{completionRate}%</strong>
                <span>{completionRate >= 100 ? '全部章节已完成' : `已完成 ${completedResources} / ${totalResources} 章`}</span>
              </div>
              <div className="course-learning-progress-track" aria-hidden="true">
                <span style={{ width: `${completionRate}%` }} />
              </div>
              <div className="course-learning-progress-meta">
                <span>共 {totalResources} 章</span>
                <span>已完成 {completedResources}</span>
                <span>进行中 {inProgressResources}</span>
                <span>待开始 {notStartedResources}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="modal-body course-learning-flow-wrap">
          {learningFlowItems.length ? (
            <div className="course-learning-flow">
              {learningFlowItems.map((item) => {
                const state = item.uiState
                const resourceType = String(item.resource_type || '').toLowerCase()
                const isSpotlight = Number(item.id || 0) === Number(spotlightLearningItem?.id || 0)
                const latestLearningText = item.progress?.updated_at ? formatDateTime(item.progress.updated_at) : '尚未开始'
                const primaryActionLabel = buildLearningPrimaryActionLabel(item, state)
                const docThresholdText = `阅读文档满 ${docPreviewThresholdSeconds || DOC_PREVIEW_MIN_SECONDS_DEFAULT} 秒后自动完成`
                const canManualAdjust = !(item.force_watch && isManagedUploadVideoResource(item)) && resourceType !== 'doc'
                const primaryActionDisabled = (resourceType === 'doc' && docPreviewLoading)
                  || (resourceType === 'link' && !buildResourceOpenUrl(item))

                return (
                  <article
                    key={`learning-flow-${item.id}`}
                    className={`learning-chapter-card is-${state.key}${isSpotlight ? ' is-spotlight' : ''}`}
                  >
                    <div className="learning-chapter-index">
                      <span className="learning-chapter-order">第 {item.chapter_no} 章</span>
                      <strong>{resourceTypeLabel(item.resource_type)}</strong>
                    </div>

                    <div className="learning-chapter-main">
                      <div className="learning-chapter-head">
                        <div className="learning-chapter-copy">
                          <h3>{item.name}</h3>
                          <p>{state.description}</p>
                        </div>
                        <span className={`learning-flow-badge is-${state.key}`}>{state.label}</span>
                      </div>

                      <div className="learning-chapter-progress-row">
                        <div className="learning-chapter-progress-track" aria-hidden="true">
                          <span style={{ width: `${state.progressPercent}%` }} />
                        </div>
                        <strong>{state.progressPercent}%</strong>
                      </div>

                      <div className="learning-chapter-meta">
                        <span>最近学习 {latestLearningText}</span>
                        {resourceType === 'video' && isManagedUploadVideoResource(item) && item.force_watch ? <span>需完整观看</span> : null}
                        {resourceType === 'doc' ? <span>{docThresholdText}</span> : null}
                        {resourceType === 'link' && String(item.source_mode || '').toLowerCase() === 'external' ? <span>打开后将跳转到外部链接</span> : null}
                      </div>

                      <div className="learning-chapter-actions">
                        <button
                          className={`learning-primary-action is-${state.key}${isSpotlight ? ' is-spotlight' : ''}`}
                          type="button"
                          disabled={primaryActionDisabled}
                          onClick={() => { void onOpenLearningResource(item) }}
                        >
                          {primaryActionDisabled ? '正在打开...' : primaryActionLabel}
                        </button>

                        {!isBasicUser ? (
                          <details className="learning-chapter-admin">
                            <summary aria-label={`展开第 ${item.chapter_no} 章的更多操作`}>更多操作</summary>
                            <div className="row-actions learning-chapter-admin-actions">
                              {canWrite ? (
                                <button className="ghost" type="button" onClick={() => onOpenResourceEditModal(item)}>编辑资源</button>
                              ) : null}
                              {canWrite ? (
                                <button
                                  className="danger"
                                  type="button"
                                  disabled={resourceDeletePendingId === Number(item.id)}
                                  onClick={() => onDeleteResource(item)}
                                >
                                  {resourceDeletePendingId === Number(item.id) ? '删除中...' : '删除资源'}
                                </button>
                              ) : null}
                              {canWrite && isManagedUploadVideoResource(item) ? (
                                <button
                                  className="warn"
                                  type="button"
                                  onClick={() => onUpdateResourcePlaybackPolicy(item.id, !item.force_watch)}
                                >
                                  {item.force_watch ? '取消强制播放' : '启用强制播放'}
                                </button>
                              ) : null}
                              {resourceType === 'doc' ? (
                                <span className="learning-inline-tip">{docThresholdText}</span>
                              ) : canManualAdjust ? (
                                <>
                                  <button
                                    className="ghost"
                                    type="button"
                                    onClick={() => onUpdateLearningProgress({
                                      resourceId: item.id,
                                      nextPercent: Math.min(100, Number(item.progress?.progress_percent || 0) + 10),
                                      markCompleted: false,
                                    })}
                                    title="用于手动补录学习进度，不代表真实播放时长"
                                  >
                                    手动补录+10%
                                  </button>
                                  <button
                                    className="primary"
                                    type="button"
                                    onClick={() => onUpdateLearningProgress({
                                      resourceId: item.id,
                                      nextPercent: 100,
                                      markCompleted: true,
                                    })}
                                  >
                                    标记完成
                                  </button>
                                </>
                              ) : (
                                <span className="learning-inline-tip">强制播放资源，请在播放器中学习</span>
                              )}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="course-learning-empty">
              <strong>当前课程还没有可学习章节</strong>
              <p>先创建文档、视频或外链资源，这里会自动形成连续的学习流。</p>
            </div>
          )}
        </div>

        {isAdminRole ? (
          <div className="modal-body course-learning-admin-shell">
            <details className="course-learning-admin-panel">
              <summary>学习规则与阈值</summary>
              <div className="course-learning-admin-content">
                <span className="learning-inline-tip">当前文档学习阈值：{docPreviewThresholdSeconds} 秒</span>
                <div className="row-actions">
                  <label htmlFor="course-learning-doc-threshold-input">阈值(秒)</label>
                  <input
                    id="course-learning-doc-threshold-input"
                    type="number"
                    min={docPreviewThresholdRange.min}
                    max={docPreviewThresholdRange.max}
                    value={docPreviewThresholdInput}
                    onChange={(e) => setDocPreviewThresholdInput(e.target.value)}
                  />
                  <button
                    className="primary"
                    type="button"
                    disabled={docPreviewThresholdSaving}
                    onClick={onSaveDocPreviewThreshold}
                  >
                    {docPreviewThresholdSaving ? '保存中...' : '保存阈值'}
                  </button>
                </div>
              </div>
            </details>
          </div>
        ) : null}
      </>
    )
  }

  if (booting) {
    return <div className="app-loading">培训考试系统初始化中...</div>
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong><span className="brand-red">聚信</span><span className="brand-blue">培训考试系统</span></strong>
        </div>
        <div className="user-pill">{user?.username} · {roleLabel(user?.role)}</div>

        <div className="menu">
          {isBasicUser ? (
            <>
              <button
                className={activeMenu === 'courses' ? 'active' : ''}
                onClick={async () => {
                  setActiveMenu('courses')
                  const items = await fetchCourses(true)
                  await fetchDocPreviewSettings(true)
                  await fetchMyLearningProgress(true)
                  const firstId = Number(items?.[0]?.id || 0)
                  if (firstId) await fetchLearningPath(Number(learningCourseId || firstId), true)
                }}
              >
                课程列表
              </button>
              <button
                className={activeMenu === 'papers' ? 'active' : ''}
                onClick={async () => {
                  setActiveMenu('papers')
                  try {
                    await fetchPapers(true)
                  } catch (err) {
                    setError(err.message || '加载试卷列表失败')
                  }
                }}
              >
                试卷列表
              </button>
              <button
                className={activeMenu === 'instructor-reviews' ? 'active' : ''}
                onClick={async () => {
                  setActiveMenu('instructor-reviews')
                  try {
                    await fetchCourses(true)
                    await fetchMyInstructorReviewForms(true)
                  } catch (err) {
                    setError(err.message || '加载讲师评价失败')
                  }
                }}
              >
                讲师评价
              </button>
              <button
                className={activeMenu === 'results' ? 'active' : ''}
                onClick={async () => {
                  setActiveMenu('results')
                  setResultCenterTab('results')
                  setResultCenterView({ type: 'papers', from: 'papers', resultId: 0, userId: 0, paperId: 0 })
                  try {
                    await fetchMyResults(true)
                  } catch (err) {
                    setError(err.message || '加载考试结果失败')
                  }
                }}
              >
                考试结果
              </button>
            </>
          ) : (
            <>
              <button className={activeMenu === 'dashboard' ? 'active' : ''} onClick={() => { setActiveMenu('dashboard'); fetchOverview(true); if (canAudit) fetchOrgBreakdown(orgGroupBy, true) }}>仪表盘</button>
              <button className={activeMenu === 'courses' ? 'active' : ''} onClick={async () => { setActiveMenu('courses'); const items = await fetchCourses(true); await fetchDocPreviewSettings(true); await fetchMyLearningProgress(true); const firstId = Number(items?.[0]?.id || 0); if (firstId) await fetchLearningPath(Number(learningCourseId || firstId), true) }}>培训管理</button>
              <button
                className={activeMenu === 'questions' ? 'active' : ''}
                onClick={() => {
                  setActiveMenu('questions')
                  fetchQuestionCategories(true)
                  fetchQuestions(true, { page: 1, filters: questionFilters })
                }}
              >
                题库管理
              </button>
              <button className={activeMenu === 'papers' ? 'active' : ''} onClick={() => { setActiveMenu('papers'); fetchPapers(true) }}>试卷管理</button>
              <button
                className={activeMenu === 'exam' ? 'active' : ''}
                onClick={async () => {
                  setActiveMenu('exam')
                  try {
                    const rows = await fetchMyResults(true)
                    const latestId = Number(rows?.[0]?.id || 0)
                    if (!currentSession?.id && latestId > 0) {
                      await onOpenHistoryResult(latestId, { silent: true, skipConfirm: true })
                    }
                  } catch (err) {
                    setError(err.message || '加载历史考卷失败')
                  }
                }}
              >
                考试中心
              </button>
              <button
                className={activeMenu === 'results' ? 'active' : ''}
                onClick={async () => {
                  setActiveMenu('results')
                  setResultCenterTab('results')
                  setResultCenterView({ type: 'papers', from: 'papers', resultId: 0, userId: 0, paperId: 0 })
                  try {
                    await fetchAdminResultPapers(true)
                  } catch (err) {
                    setError(err.message || '加载考试结果失败')
                  }
                }}
              >
                考试结果
              </button>
              <button
                className={activeMenu === 'instructor-reviews' ? 'active' : ''}
                onClick={async () => {
                  setActiveMenu('instructor-reviews')
                  try {
                    await fetchAdminInstructorReviewForms(true)
                  } catch (err) {
                    setError(err.message || '加载讲师评价失败')
                  }
                }}
              >
                讲师评价
              </button>
              {role === 'admin' ? (
                <button
                  className={activeMenu === 'student-overall' ? 'active' : ''}
                  onClick={async () => {
                    setActiveMenu('student-overall')
                    try {
                      await fetchStudentOverall(true)
                    } catch (err) {
                      setError(err.message || '加载学员总体评价失败')
                    }
                  }}
                >
                  学员总体评价
                </button>
              ) : null}
              <button className={activeMenu === 'retrain' ? 'active' : ''} onClick={() => { setActiveMenu('retrain'); fetchRetrainCenter(true) }}>错题复训</button>
              {canViewAiConfig && (
                <button className={activeMenu === 'ai-models' ? 'active' : ''} onClick={() => { setActiveMenu('ai-models'); fetchAiConfigCenter(true) }}>模型配置</button>
              )}
              {canAudit && (
                <button className={activeMenu === 'audit' ? 'active' : ''} onClick={() => { setActiveMenu('audit'); fetchAudit(); fetchUserProfiles(true) }}>审计日志</button>
              )}
            </>
          )}
        </div>

        <div className="sidebar-actions">
          <button className="ghost" type="button" onClick={onSwitchSystem}>切换系统</button>
          <button className="ghost logout" type="button" onClick={onLogout} disabled={logoutPending}>
            {logoutPending ? '退出中...' : '退出系统'}
          </button>
        </div>
      </aside>

      <main className="content">
        <section className="hero">
          <div>
            <h1>{isBasicUser ? '培训学习与考试' : '培训与考试一体化'}</h1>
            <p className="sub">
              {isBasicUser ? '可查看课程列表与学习路径，支持在线学习文档/视频并参加考试。' : '文档/视频培训、FAQ自动出题、导题、组卷、考试评分、证书生成。'}
            </p>
          </div>
        </section>

        {message ? <div className="message ok">{message}</div> : null}
        {error ? <div className="message err">{error}</div> : null}

        {activeMenu === 'dashboard' && !isBasicUser && (
          <>
            <section className="panel">
              <div className="panel-header"><h2>数据概览</h2></div>
              <div className="panel-body metric-grid">
                <div className="metric"><label>课程总数</label><strong>{overview.course_total || 0}</strong></div>
                <div className="metric"><label>题库总数</label><strong>{overview.question_total || 0}</strong></div>
                <div className="metric"><label>已发布试卷</label><strong>{overview.paper_published_total || 0}</strong></div>
                <div className="metric"><label>最终通过率</label><strong>{overview.pass_rate || 0}%</strong></div>
              </div>
            </section>

            <section className="grid-2">
              <div className="panel">
                <div className="panel-header"><h2>通过率趋势（近14天）</h2></div>
                <div className="panel-body">
                  <div className="trend-list">
                    {passTrend.length ? passTrend.map((item) => (
                      <div className="trend-row" key={item.day}>
                        <div className="trend-day">{item.day}</div>
                        <div className="trend-bar-track">
                          <div
                            className="trend-bar"
                            style={{ width: `${Math.max(8, Math.round((Number(item.total || 0) / maxTrendTotal) * 100))}%` }}
                          />
                        </div>
                        <div className="trend-value">{item.pass_rate}%</div>
                      </div>
                    )) : (
                      <div className="empty-tip">暂无趋势数据</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><h2>运营建议</h2></div>
                <div className="panel-body">
                  <div className="tip-list">
                    {dashboardTips.map((tip, idx) => (
                      <div key={`${idx}-${tip}`} className="tip-item">
                        <span className="tip-index">{idx + 1}</span>
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {canAudit ? (
              <section className="panel">
                <div className="panel-header">
                  <h2>部门/岗位看板</h2>
                  <div className="row-actions">
                    <select value={orgGroupBy} onChange={(e) => fetchOrgBreakdown(e.target.value)}>
                      <option value="department">按部门</option>
                      <option value="position">按岗位</option>
                      <option value="department_position">部门/岗位</option>
                    </select>
                    <button className="ghost" onClick={() => fetchOrgBreakdown(orgGroupBy)}>刷新</button>
                  </div>
                </div>
                <div className="panel-body table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>分组</th>
                        <th>最终成绩数</th>
                        <th>通过率</th>
                        <th>平均分</th>
                        <th>平均重考次数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgBreakdown.length ? orgBreakdown.map((item) => (
                        <tr key={`org-${item.group_key}`}>
                          <td>{item.group_key}</td>
                          <td>{item.result_total}</td>
                          <td>{item.pass_rate}%</td>
                          <td>{item.avg_score}</td>
                          <td>{item.avg_retake_count}</td>
                        </tr>
                      )) : <tr><td colSpan={5}>暂无组织统计数据</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}

        {activeMenu === 'courses' && (
          <>
            {!isBasicUser ? (
              <section className="panel">
                <div className="panel-header"><h2>创建课程</h2></div>
                <div className="panel-body">
                  {canWrite ? (
                    <form onSubmit={onCreateCourse} className="form-grid">
                      <div><label>课程标题</label><input value={courseForm.title} onChange={(e) => setCourseForm((p) => ({ ...p, title: e.target.value }))} /></div>
                      <div><label>时长(分钟)</label><input type="number" value={courseForm.duration_minutes} onChange={(e) => setCourseForm((p) => ({ ...p, duration_minutes: e.target.value }))} /></div>
                      <div className="full"><label>描述</label><textarea value={courseForm.description} onChange={(e) => setCourseForm((p) => ({ ...p, description: e.target.value }))} /></div>
                      <div className="full row-actions"><button className="primary" type="submit">创建课程</button></div>
                    </form>
                  ) : <div>当前角色无课程写权限。</div>}
                </div>
              </section>
            ) : null}

            {!isBasicUser ? (
              <section className="panel resource-panel">
                <div className="panel-header resource-panel-header">
                  <h2>培训资源</h2>
                  <span className="resource-panel-chip">两步完成：先建资源，再上传文件</span>
                </div>
                <div className="panel-body">
                  <div className="resource-workbench">
                    <form onSubmit={onCreateResource} className="resource-card resource-card-create">
                      <div className="resource-card-head">
                        <span className="resource-card-step">步骤 1</span>
                        <h4>新建资源</h4>
                        <p>先登记课程资源，再进行文件上传或外链配置。</p>
                      </div>
                      <div className="form-grid resource-grid">
                      <div>
                        <label>所属课程</label>
                        <select value={resourceForm.course_id} onChange={(e) => setResourceForm((p) => ({ ...p, course_id: e.target.value }))}>
                          <option value="">请选择课程</option>
                          {(courses || []).map((item) => (
                            <option key={`resource-course-${item.id}`} value={item.id}>{item.id} · {item.title}</option>
                          ))}
                        </select>
                      </div>
                      <div><label>资源名</label><input value={resourceForm.name} onChange={(e) => setResourceForm((p) => ({ ...p, name: e.target.value }))} /></div>
                      <div>
                        <label>资源类型</label>
                        <select value={resourceForm.resource_type} onChange={(e) => setResourceForm((p) => {
                          const resourceType = e.target.value
                          return {
                            ...p,
                            resource_type: resourceType,
                            storage_backend: normalizeResourceStorageBackend({
                              resourceType,
                              sourceMode: p.source_mode,
                              storageBackend: p.storage_backend,
                            }),
                            force_watch: resourceType === 'video' ? p.force_watch : false,
                          }
                        })}>
                          <option value="doc">文档</option>
                          <option value="video">视频</option>
                          <option value="link">外链</option>
                        </select>
                      </div>
                      <div>
                        <label>来源模式</label>
                        <select value={resourceForm.source_mode} onChange={(e) => setResourceForm((p) => {
                          const sourceMode = e.target.value
                          return {
                            ...p,
                            source_mode: sourceMode,
                            storage_backend: normalizeResourceStorageBackend({
                              resourceType: p.resource_type,
                              sourceMode,
                              storageBackend: p.storage_backend,
                            }),
                            force_watch: sourceMode === 'upload' ? p.force_watch : false,
                          }
                        })}>
                          <option value="upload">上传</option>
                          <option value="external">外链</option>
                        </select>
                      </div>
                      {resourceForm.resource_type === 'video' && resourceForm.source_mode === 'upload' ? (
                        <div>
                          <label>存储位置</label>
                          <select value={resourceForm.storage_backend} onChange={(e) => setResourceForm((p) => ({
                            ...p,
                            storage_backend: normalizeResourceStorageBackend({
                              resourceType: p.resource_type,
                              sourceMode: p.source_mode,
                              storageBackend: e.target.value,
                            }),
                          }))}>
                            <option value="local">本地</option>
                            <option value="oss">阿里云 OSS</option>
                          </select>
                        </div>
                      ) : null}
                      {resourceForm.resource_type === 'video' && resourceForm.source_mode === 'upload' ? (
                        <div className="row-actions full resource-switch-row">
                          <label>
                            <input
                              type="checkbox"
                              checked={!!resourceForm.force_watch}
                              onChange={(e) => setResourceForm((p) => ({ ...p, force_watch: e.target.checked }))}
                            /> 强制播放（禁止快进）
                          </label>
                        </div>
                      ) : null}
                      <div><label>章节顺序</label><input type="number" value={resourceForm.sort_order} onChange={(e) => setResourceForm((p) => ({ ...p, sort_order: e.target.value }))} /></div>
                      {resourceForm.source_mode === 'external' && (
                        <div className="full"><label>外链URL</label><input value={resourceForm.source_url} onChange={(e) => setResourceForm((p) => ({ ...p, source_url: e.target.value }))} /></div>
                      )}
                      <div className="full row-actions resource-submit-row"><button className="primary" type="submit" disabled={!canWrite}>新建资源</button></div>
                      </div>
                    </form>

                    <form onSubmit={onUploadResource} className="resource-card resource-card-upload">
                      <div className="resource-card-head">
                        <span className="resource-card-step">步骤 2</span>
                        <h4>上传资源文件</h4>
                        <p>本地视频会进入后台转码；OSS 视频会直接上传到阿里云对象存储。</p>
                      </div>
                      <div className="form-grid resource-grid">
                        <div className="full"><label>选择文件</label><input type="file" disabled={uploadingResource} onChange={(e) => setResourceUpload((p) => ({ ...p, file: e.target.files?.[0] || null }))} /></div>
                        <div className="full resource-hint">请先点击左侧“新建资源”，系统会自动关联本次上传。文档与 Excel 导题大小限制为 {UPLOAD_MAX_MB}MB。文档仅支持 pdf/doc/docx/txt/md；本地视频支持 mp4/webm/mov/m4v；阿里云 OSS 受管视频当前仅支持标准 MP4。</div>
                        {resourceUploadNotice ? <div className="full upload-notice">{resourceUploadNotice}</div> : null}
                        {(uploadingResource || resourceUploadProgress > 0) ? (
                          <div className="full upload-progress">
                            <div className="upload-progress-track">
                              <div className="upload-progress-fill" style={{ width: `${resourceUploadProgress}%` }} />
                            </div>
                            <div className="upload-progress-text">上传进度：{resourceUploadProgress}%</div>
                          </div>
                        ) : null}
                        <div className="full row-actions resource-submit-row">
                          <button className="primary" type="submit" disabled={!canWrite || uploadingResource}>
                            {uploadingResource ? `上传中 ${resourceUploadProgress}%` : '上传文件'}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="panel">
              <div className="panel-header">
                <h2>课程列表</h2>
                {canWrite ? (
                  <div className="row-actions">
                    <button
                      className="danger"
                      type="button"
                      disabled={courseBatchDeleting || courseDeletePendingId > 0 || courseStatusPendingId > 0 || selectedCourseIds.length === 0}
                      onClick={() => onDeleteCoursesBatch({ deleteAll: false })}
                    >
                      {courseBatchDeleting ? '删除中...' : `删除选中(${selectedCourseIds.length})`}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={courseBatchDeleting || courseDeletePendingId > 0 || courseStatusPendingId > 0 || courses.length === 0}
                      onClick={() => onDeleteCoursesBatch({ deleteAll: true })}
                    >
                      一键删除全部
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="panel-body table-wrap">
                <table>
                  <thead>
                    <tr>
                      {!isBasicUser ? (
                        <th>
                          <input
                            type="checkbox"
                            disabled={!canWrite || courseBatchDeleting || courseDeletePendingId > 0 || courseStatusPendingId > 0 || courses.length === 0}
                            checked={courses.length > 0 && selectedCourseIds.length === courses.length}
                            onChange={(e) => {
                              const checked = !!e.target.checked
                              setSelectedCourseIds(
                                checked
                                  ? courses.map((item) => Number(item.id || 0)).filter((id) => id > 0)
                                  : []
                              )
                            }}
                          />
                        </th>
                      ) : null}
                      <th>ID</th>
                      <th>标题</th>
                      <th>状态</th>
                      <th>时长</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.length ? courses.map((item) => (
                      <tr key={item.id}>
                        {!isBasicUser ? (
                          <td>
                            <input
                              type="checkbox"
                              disabled={!canWrite || courseBatchDeleting || courseDeletePendingId > 0 || courseStatusPendingId > 0}
                              checked={selectedCourseIds.includes(Number(item.id))}
                              onChange={(e) => {
                                const checked = !!e.target.checked
                                const id = Number(item.id || 0)
                                setSelectedCourseIds((prev) => {
                                  const base = Array.isArray(prev) ? prev : []
                                  if (checked) {
                                    return base.includes(id) ? base : [...base, id]
                                  }
                                  return base.filter((v) => Number(v) !== id)
                                })
                              }}
                            />
                          </td>
                        ) : null}
                        <td>{item.id}</td>
                        <td>{item.title}</td>
                        <td><span className="badge">{questionStatusLabel(item.status)}</span></td>
                        <td>{item.duration_minutes} 分钟</td>
                        <td>{formatDateTime(item.updated_at)}</td>
                        <td>
                          <div className="row-actions">
                            {!isBasicUser && canWrite ? (
                              String(item.status || '').toLowerCase() === 'published' ? (
                                <button
                                  className="ghost"
                                  type="button"
                                  disabled={courseBatchDeleting || courseStatusPendingId === Number(item.id)}
                                  onClick={() => onUpdateCourseStatus(item, 'draft')}
                                >
                                  {courseStatusPendingId === Number(item.id) ? '更新中...' : '改回草稿'}
                                </button>
                              ) : (
                                <button
                                  className="primary"
                                  type="button"
                                  disabled={courseBatchDeleting || courseStatusPendingId === Number(item.id)}
                                  onClick={() => onUpdateCourseStatus(item, 'published')}
                                >
                                  {courseStatusPendingId === Number(item.id) ? '更新中...' : '发布课程'}
                                </button>
                              )
                            ) : null}
                            {!isBasicUser && canWrite ? (
                              <button
                                className="danger"
                                type="button"
                                disabled={courseBatchDeleting || courseStatusPendingId > 0 || courseDeletePendingId === Number(item.id)}
                                onClick={() => onDeleteCourse(item)}
                              >
                                {courseDeletePendingId === Number(item.id) ? '删除中...' : '删除课程'}
                              </button>
                            ) : null}
                            <button
                              className="ghost"
                              type="button"
                              disabled={courseLearningPendingId === Number(item.id)}
                              onClick={() => onOpenCourseLearningModal(item)}
                            >
                              {courseLearningPendingId === Number(item.id) ? '加载中...' : '查看课程'}
                            </button>
                            {!isBasicUser && !canWrite ? <span className="badge">只读</span> : null}
                          </div>
                        </td>
                      </tr>
                    )) : <tr><td colSpan={isBasicUser ? 6 : 7}>暂无课程</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeMenu === 'questions' && !isBasicUser && (
          <>
            <section className="panel">
              <div className="panel-header question-workbench-header">
                <h2>FAQ自动出题与导题</h2>
                <span className="resource-panel-chip">上下流程：先自动出题，再补充Excel导题</span>
              </div>
              <div className="panel-body">
                <div className="question-workbench">
                  <form onSubmit={onCreateGenerationJob} className="question-source-card question-source-faq">
                    <div className="question-source-head">
                      <span className="question-step-chip">步骤 1</span>
                      <h4>FAQ自动出题</h4>
                      <p>按 FAQ 分类或文章扫描，生成草稿题后进行审核发布。</p>
                    </div>
                    <div className="form-grid question-source-grid">
                      <div className="full"><label>任务名</label><input value={generationForm.name} onChange={(e) => setGenerationForm((p) => ({ ...p, name: e.target.value }))} /></div>
                      <div><label>FAQ分类ID(逗号)</label><input value={generationForm.source_category_ids} onChange={(e) => setGenerationForm((p) => ({ ...p, source_category_ids: e.target.value }))} /></div>
                      <div><label>FAQ文章ID(逗号)</label><input value={generationForm.source_article_ids} onChange={(e) => setGenerationForm((p) => ({ ...p, source_article_ids: e.target.value }))} /></div>
                      <div><label>最大扫描数</label><input type="number" value={generationForm.max_sources} onChange={(e) => setGenerationForm((p) => ({ ...p, max_sources: e.target.value }))} /></div>
                      <div className="full row-actions">
                        <button className="primary" type="submit" disabled={!canWrite}>创建任务</button>
                        <button className="ghost" type="button" onClick={onRunGenerationJob} disabled={!canWrite || !latestGenerationJob?.id}>执行任务</button>
                        <button className="warn" type="button" onClick={onPublishGenerationJob} disabled={!canReview || !latestGenerationJob?.id}>审核发布</button>
                      </div>
                      {latestGenerationJob ? (
                        <div className="full question-source-meta">
                          最近任务：#{latestGenerationJob.id} / {importStatusLabel(latestGenerationJob.status)}
                        </div>
                      ) : null}
                    </div>
                  </form>

                  <div className="question-source-card question-source-import">
                    <div className="question-source-head">
                      <span className="question-step-chip">步骤 2</span>
                      <h4>Excel导题</h4>
                      <p>{canReview ? '支持单选、多选、判断题导入，可在导入后直接发布。' : '支持单选、多选、判断题导入，当前账号导入后会进入草稿等待审核发布。'}</p>
                    </div>
                    <div className="row-actions">
                      <button className="ghost" type="button" onClick={onDownloadImportTemplate}>下载模板</button>
                    </div>
                    <div className="question-source-file">
                      <input type="file" accept=".xlsx,.xls" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                    </div>
                    <div className="row-actions">
                      <label>
                        <input
                          type="checkbox"
                          checked={canReview && publishImportedQuestions}
                          onChange={(e) => setPublishImportedQuestions(e.target.checked)}
                          disabled={!canReview}
                        />
                        {' '}导入后直接发布
                      </label>
                      {!canReview ? <span className="badge">当前账号无审核发布权限</span> : null}
                    </div>
                    <div className="row-actions">
                      <button className="primary" type="button" onClick={onImportQuestions} disabled={!canWrite}>导入题库</button>
                    </div>
                    {latestImportJob ? (
                      <div className="question-source-meta">
                        <div>最近导入任务：#{latestImportJob.id} / {importStatusLabel(latestImportJob.status)}</div>
                        <div>成功 {latestImportJob.success_rows || 0}，失败 {latestImportJob.failed_rows || 0}</div>
                        <div>已发布 {latestImportJob.published_rows || 0}，草稿 {latestImportJob.draft_rows || 0}</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>题目分类管理</h2>
                <div className="row-actions">
                  <span className="badge">分类总数 {questionCategoryRows.length}</span>
                  <button className="ghost" type="button" onClick={() => fetchQuestionCategories(false)}>刷新分类</button>
                </div>
              </div>
              <div className="panel-body grid-2">
                <form onSubmit={onCreateQuestionCategory} className="form-grid">
                  <div className="full">
                    <label>新增分类名称</label>
                    <input
                      value={questionCategoryFormName}
                      onChange={(e) => setQuestionCategoryFormName(e.target.value)}
                      placeholder="例如：网络安全基础"
                    />
                  </div>
                  <div className="full row-actions">
                    <button className="primary" type="submit" disabled={!canWrite || questionCategorySaving}>
                      {questionCategorySaving ? '处理中...' : '新增分类'}
                    </button>
                    <span className="sub">支持手动创建、修改、删除。</span>
                  </div>
                </form>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>分类名称</th>
                        <th>题目数</th>
                        <th>类型</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {questionCategoryRows.length ? questionCategoryRows.map((row) => {
                        const isEditing = Number(questionCategoryEditId || 0) === Number(row?.id || 0)
                        return (
                          <tr key={`question-category-row-${row.id}`}>
                            <td>{row.id}</td>
                            <td>
                              {isEditing ? (
                                <input
                                  value={questionCategoryEditName}
                                  onChange={(e) => setQuestionCategoryEditName(e.target.value)}
                                  disabled={questionCategorySaving}
                                />
                              ) : row.name}
                            </td>
                            <td>{Number(row?.question_count || 0)}</td>
                            <td>{Number(row?.is_system || 0) === 1 ? '系统内置' : '自定义'}</td>
                            <td>
                              <div className="row-actions">
                                {!isEditing ? (
                                  <button className="ghost" type="button" onClick={() => onStartEditQuestionCategory(row)}>修改</button>
                                ) : null}
                                {isEditing ? (
                                  <>
                                    <button className="primary" type="button" disabled={questionCategorySaving} onClick={() => onSaveQuestionCategoryEdit(row.id)}>
                                      保存
                                    </button>
                                    <button className="ghost" type="button" disabled={questionCategorySaving} onClick={onCancelEditQuestionCategory}>
                                      取消
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  className="danger"
                                  type="button"
                                  disabled={questionCategoryDeletePendingId === Number(row.id)}
                                  onClick={() => onDeleteQuestionCategory(row)}
                                >
                                  {questionCategoryDeletePendingId === Number(row.id) ? '删除中...' : '删除'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      }) : <tr><td colSpan={5}>暂无分类</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>手工创建题目</h2></div>
              <div className="panel-body">
                <form onSubmit={onCreateManualQuestion} className="form-grid">
                  <div className="full"><label>题干</label><textarea value={questionForm.stem} onChange={(e) => setQuestionForm((p) => ({ ...p, stem: e.target.value }))} /></div>
                  <div>
                    <label>分类</label>
                    <select value={questionForm.question_category} onChange={(e) => setQuestionForm((p) => ({ ...p, question_category: e.target.value }))}>
                      {questionCategories.map((category) => (
                        <option key={`manual-question-category-${category}`} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>题型</label>
                    <select value={questionForm.question_type} onChange={(e) => setQuestionForm((p) => ({ ...p, question_type: e.target.value }))}>
                      <option value="single_choice">单选</option>
                      <option value="multiple_choice">多选</option>
                      <option value="judgement">判断</option>
                      <option value="fill_blank">填空</option>
                    </select>
                  </div>
                  <div>
                    <label>难度</label>
                    <select value={questionForm.difficulty} onChange={(e) => setQuestionForm((p) => ({ ...p, difficulty: e.target.value }))}>
                      <option value="easy">简单</option>
                      <option value="medium">中等</option>
                      <option value="hard">困难</option>
                    </select>
                  </div>
                  <div><label>分值</label><input type="number" value={questionForm.points} onChange={(e) => setQuestionForm((p) => ({ ...p, points: e.target.value }))} /></div>
                  {questionForm.question_type !== 'fill_blank' ? (
                    <>
                      <div><label>选项A</label><input value={questionForm.option_a} onChange={(e) => setQuestionForm((p) => ({ ...p, option_a: e.target.value }))} /></div>
                      <div><label>选项B</label><input value={questionForm.option_b} onChange={(e) => setQuestionForm((p) => ({ ...p, option_b: e.target.value }))} /></div>
                      <div><label>选项C</label><input value={questionForm.option_c} onChange={(e) => setQuestionForm((p) => ({ ...p, option_c: e.target.value }))} /></div>
                      <div><label>选项D</label><input value={questionForm.option_d} onChange={(e) => setQuestionForm((p) => ({ ...p, option_d: e.target.value }))} /></div>
                    </>
                  ) : null}
                  {questionForm.question_type === 'fill_blank' ? (
                    <div className="full"><label>标准答案文本</label><input value={questionForm.answer_text} onChange={(e) => setQuestionForm((p) => ({ ...p, answer_text: e.target.value }))} placeholder="例如：零信任" /></div>
                  ) : (
                    <div className="full"><label>答案值（逗号分隔，如 A 或 A,B）</label><input value={questionForm.answer_values} onChange={(e) => setQuestionForm((p) => ({ ...p, answer_values: e.target.value }))} /></div>
                  )}
                  <div className="full"><label>同义答案（仅填空，逗号分隔）</label><input value={questionForm.answer_aliases} onChange={(e) => setQuestionForm((p) => ({ ...p, answer_aliases: e.target.value }))} /></div>
                  <div className="full"><label>解析</label><textarea value={questionForm.explanation} onChange={(e) => setQuestionForm((p) => ({ ...p, explanation: e.target.value }))} /></div>
                  <div className="full"><label>标签</label><input value={questionForm.tags} onChange={(e) => setQuestionForm((p) => ({ ...p, tags: e.target.value }))} placeholder="逗号分隔" /></div>
                  <div className="full row-actions"><button className="primary" type="submit" disabled={!canWrite}>创建题目</button></div>
                </form>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>题目列表</h2>
                <div className="row-actions">
                  <span className="badge">共 {questionPagination.total} 道</span>
                  <span className="badge">第 {questionPagination.page} / {questionPagination.totalPages} 页</span>
                  {canWrite ? (
                    <>
                      <button
                        className="danger"
                        type="button"
                        disabled={questionBatchDeleting || questionBatchPublishing || questionDeletePendingId > 0 || questionPublishPendingId > 0 || selectedQuestionIds.length === 0}
                        onClick={() => onDeleteQuestionsBatch({ deleteAll: false })}
                      >
                        {questionBatchDeleting ? '删除中...' : `删除选中(${selectedQuestionIds.length})`}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        disabled={questionBatchDeleting || questionBatchPublishing || questionDeletePendingId > 0 || questionPublishPendingId > 0 || questionPagination.total === 0}
                        onClick={() => onDeleteQuestionsBatch({ deleteAll: true })}
                      >
                        一键删除当前筛选
                      </button>
                    </>
                  ) : null}
                  {canReview ? (
                    <>
                      <button
                        className="warn"
                        type="button"
                        disabled={questionBatchPublishing || questionBatchDeleting || questionDeletePendingId > 0 || questionPublishPendingId > 0 || selectedQuestionIds.length === 0}
                        onClick={() => onPublishQuestionsBatch({ publishAll: false })}
                      >
                        {questionBatchPublishing ? '发布中...' : `发布选中(${selectedQuestionIds.length})`}
                      </button>
                      <button
                        className="warn"
                        type="button"
                        disabled={questionBatchPublishing || questionBatchDeleting || questionDeletePendingId > 0 || questionPublishPendingId > 0 || questionPagination.total === 0}
                        onClick={() => onPublishQuestionsBatch({ publishAll: true })}
                      >
                        一键发布当前筛选草稿
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="panel-body">
                <div className="filter-bar">
                  <input
                    placeholder="按题干或ID搜索"
                    value={questionFilters.keyword}
                    onChange={(e) => setQuestionFilters((prev) => ({ ...prev, keyword: e.target.value }))}
                  />
                  <select
                    value={questionFilters.status}
                    onChange={(e) => {
                      const nextFilters = { ...questionFilters, status: e.target.value }
                      setQuestionFilters(nextFilters)
                      fetchQuestions(true, { page: 1, filters: nextFilters })
                    }}
                  >
                    <option value="all">全部状态</option>
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                    <option value="archived">已归档</option>
                  </select>
                  <select
                    value={questionFilters.source}
                    onChange={(e) => {
                      const nextFilters = { ...questionFilters, source: e.target.value }
                      setQuestionFilters(nextFilters)
                      fetchQuestions(true, { page: 1, filters: nextFilters })
                    }}
                  >
                    <option value="all">全部来源</option>
                    <option value="manual">手工创建</option>
                    <option value="faq_auto">FAQ自动生成</option>
                    <option value="import">Excel导入</option>
                  </select>
                  <select
                    value={questionFilters.category}
                    onChange={(e) => {
                      const nextFilters = { ...questionFilters, category: e.target.value }
                      setQuestionFilters(nextFilters)
                      fetchQuestions(true, { page: 1, filters: nextFilters })
                    }}
                  >
                    <option value="all">全部分类</option>
                    {questionCategories.map((category) => (
                      <option key={`question-category-${category}`} value={category}>{category}</option>
                    ))}
                  </select>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => fetchQuestions(true, { page: 1, filters: questionFilters })}
                  >
                    查询
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      const resetFilters = { keyword: '', status: 'all', source: 'all', category: 'all' }
                      setQuestionFilters(resetFilters)
                      fetchQuestions(true, { page: 1, filters: resetFilters })
                    }}
                  >
                    清空筛选
                  </button>
                </div>
              </div>
              <div className="panel-body table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          disabled={!canSelectQuestionRows || questionBatchDeleting || questionBatchPublishing || questionDeletePendingId > 0 || questionPublishPendingId > 0 || filteredQuestions.length === 0}
                          checked={filteredQuestions.length > 0 && selectedQuestionIds.length === filteredQuestions.length}
                          onChange={(e) => {
                            const checked = !!e.target.checked
                            setSelectedQuestionIds(
                              checked
                                ? filteredQuestions.map((item) => Number(item.id || 0)).filter((id) => id > 0)
                                : []
                            )
                          }}
                        />
                      </th>
                      <th>ID</th>
                      <th>分类</th>
                      <th>题干</th>
                      <th>题型</th>
                      <th>状态</th>
                      <th>来源</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuestions.length ? filteredQuestions.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!canSelectQuestionRows || questionBatchDeleting || questionBatchPublishing || questionDeletePendingId > 0 || questionPublishPendingId > 0}
                            checked={selectedQuestionIds.includes(Number(q.id))}
                            onChange={(e) => {
                              const checked = !!e.target.checked
                              const id = Number(q.id || 0)
                              setSelectedQuestionIds((prev) => {
                                const base = Array.isArray(prev) ? prev : []
                                if (checked) return base.includes(id) ? base : [...base, id]
                                return base.filter((item) => Number(item) !== id)
                              })
                            }}
                          />
                        </td>
                        <td>{q.id}</td>
                        <td>{q.question_category || '未分类'}</td>
                        <td>{q.stem}</td>
                        <td>{questionTypeLabel(q.question_type)}</td>
                        <td><span className="badge">{questionStatusLabel(q.status)}</span></td>
                        <td>{sourceTypeLabel(q.source_type)}</td>
                        <td>
                          <div className="row-actions learning-actions">
                            {canReview && q.status === 'draft' ? (
                              <button
                                className="warn"
                                type="button"
                                disabled={questionBatchDeleting || questionBatchPublishing || questionDeletePendingId > 0 || questionPublishPendingId === Number(q.id)}
                                onClick={() => onReviewQuestion(q.id, 'approve')}
                              >
                                {questionPublishPendingId === Number(q.id) ? '发布中...' : '发布'}
                              </button>
                            ) : null}
                            {canReview && q.status === 'draft' ? (
                              <button
                                className="danger"
                                type="button"
                                disabled={questionBatchDeleting || questionBatchPublishing || questionDeletePendingId > 0 || questionPublishPendingId === Number(q.id)}
                                onClick={() => onReviewQuestion(q.id, 'reject')}
                              >
                                驳回
                              </button>
                            ) : null}
                            {canWrite ? (
                              <button
                                className="danger"
                                type="button"
                                disabled={questionBatchDeleting || questionBatchPublishing || questionPublishPendingId > 0 || questionDeletePendingId === Number(q.id)}
                                onClick={() => onDeleteQuestion(q)}
                              >
                                {questionDeletePendingId === Number(q.id) ? '删除中...' : '删除题目'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )) : <tr><td colSpan={8}>暂无匹配题目</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="panel-body">
                <div className="question-pagination">
                  <div className="row-actions">
                    <button
                      className="ghost"
                      type="button"
                      disabled={questionPagination.page <= 1}
                      onClick={() => fetchQuestions(true, { page: questionPagination.page - 1, filters: questionFilters })}
                    >
                      上一页
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      disabled={questionPagination.page >= questionPagination.totalPages}
                      onClick={() => fetchQuestions(true, { page: questionPagination.page + 1, filters: questionFilters })}
                    >
                      下一页
                    </button>
                  </div>
                  <div className="row-actions">
                    <label>每页</label>
                    <select
                      value={questionPagination.limit}
                      onChange={(e) => {
                        const nextLimit = Math.max(1, Number(e.target.value || 10))
                        fetchQuestions(true, { page: 1, limit: nextLimit, filters: questionFilters })
                      }}
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                    <span className="badge">当前页 {filteredQuestions.length} 条</span>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {activeMenu === 'instructor-reviews' && (
          <>
            {isBasicUser ? (
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>讲师评价</h2>
                    <div className="sub">线下培训结束后，选择讲师评价问卷提交反馈。</div>
                  </div>
                  <button className="ghost" type="button" onClick={() => fetchMyInstructorReviewForms(true)}>刷新问卷</button>
                </div>
                <div className="panel-body">
                  <form className="form-grid" onSubmit={onSubmitInstructorReview}>
                    <div>
                      <label>评价问卷</label>
                      <select
                        value={instructorReviewResponseForm.form_id}
                        onChange={(e) => {
                          const formId = e.target.value
                          const selected = myInstructorReviewForms.find((item) => Number(item.id || 0) === Number(formId || 0))
                          setInstructorReviewResponseForm((prev) => ({
                            ...prev,
                            form_id: formId,
                            clarity_score: Number(selected?.clarity_score || 5),
                            interaction_score: Number(selected?.interaction_score || 5),
                            practical_score: Number(selected?.practical_score || 5),
                            time_control_score: Number(selected?.time_control_score || 5),
                            qa_score: Number(selected?.qa_score || 5),
                            feedback: selected?.feedback || '',
                            anonymous: Number(selected?.anonymous || 0) === 1,
                          }))
                        }}
                      >
                        <option value="">请选择讲师评价问卷</option>
                        {myInstructorReviewForms.map((item) => (
                          <option key={`review-form-${item.id}`} value={item.id}>
                            {item.title} - {item.instructor_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {[
                      ['clarity_score', '授课清晰度'],
                      ['interaction_score', '互动氛围'],
                      ['practical_score', '内容实用性'],
                      ['time_control_score', '时间把控'],
                      ['qa_score', '课后答疑'],
                    ].map(([key, label]) => (
                      <div key={`review-score-${key}`}>
                        <label>{label}</label>
                        <select
                          value={instructorReviewResponseForm[key]}
                          onChange={(e) => setInstructorReviewResponseForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                        >
                          {[5, 4, 3, 2, 1].map((score) => (
                            <option key={`${key}-${score}`} value={score}>{score} 分</option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <div className="full">
                      <label>反馈内容</label>
                      <textarea
                        value={instructorReviewResponseForm.feedback}
                        onChange={(e) => setInstructorReviewResponseForm((prev) => ({ ...prev, feedback: e.target.value }))}
                        placeholder="可以写下讲师表达、课堂互动、案例、节奏或答疑建议"
                      />
                    </div>
                    <label className="full results-filter-check">
                      <input
                        type="checkbox"
                        checked={!!instructorReviewResponseForm.anonymous}
                        onChange={(e) => setInstructorReviewResponseForm((prev) => ({ ...prev, anonymous: e.target.checked }))}
                      />
                      <span>匿名提交</span>
                    </label>
                    <div className="full row-actions">
                      <button className="primary" type="submit" disabled={instructorReviewSaving}>
                        {instructorReviewSaving ? '提交中...' : '提交评价'}
                      </button>
                    </div>
                  </form>
                </div>
              </section>
            ) : (
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>创建讲师评价问卷</h2>
                    <div className="sub">用于线下培训课后收集讲师评价。</div>
                  </div>
                </div>
                <div className="panel-body">
                  <form className="form-grid" onSubmit={onSubmitInstructorQuestionnaire}>
                    <div><label>问卷标题</label><input value={instructorQuestionnaireForm.title} onChange={(e) => setInstructorQuestionnaireForm((prev) => ({ ...prev, title: e.target.value }))} /></div>
                    <div><label>讲师姓名</label><input value={instructorQuestionnaireForm.instructor_name} onChange={(e) => setInstructorQuestionnaireForm((prev) => ({ ...prev, instructor_name: e.target.value }))} /></div>
                    <div>
                      <label>状态</label>
                      <select value={instructorQuestionnaireForm.status} onChange={(e) => setInstructorQuestionnaireForm((prev) => ({ ...prev, status: e.target.value }))}>
                        <option value="draft">草稿</option>
                        <option value="published">已发布</option>
                        <option value="closed">已关闭</option>
                      </select>
                    </div>
                    <div className="full"><label>说明</label><textarea value={instructorQuestionnaireForm.description} onChange={(e) => setInstructorQuestionnaireForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="例如：2026 年第一期线下培训课后评价" /></div>
                    <div className="full row-actions">
                      <button className="primary" type="submit">创建问卷</button>
                    </div>
                  </form>
                </div>
              </section>
            )}

            <section className="panel">
              <div className="panel-header">
                <h2>{isBasicUser ? '可评价问卷' : '讲师评价问卷'}</h2>
                {!isBasicUser ? (
                  <button className="ghost" type="button" onClick={() => fetchAdminInstructorReviewForms(true)}>刷新问卷</button>
                ) : null}
              </div>
              <div className="panel-body table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>问卷</th>
                      <th>讲师</th>
                      <th>{isBasicUser ? '我的评价' : '参与人数'}</th>
                      {!isBasicUser ? <th>平均分</th> : null}
                      <th>状态</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isBasicUser ? myInstructorReviewForms : adminInstructorReviewForms).length ? (
                      (isBasicUser ? myInstructorReviewForms : adminInstructorReviewForms).map((item) => (
                        <tr key={`instructor-review-form-${item.id}`}>
                          <td>{item.title}</td>
                          <td>{item.instructor_name || '讲师'}</td>
                          <td>{isBasicUser ? (item.submitted ? `${Number(item.final_score || 0).toFixed(2)} 分 / ${item.rating_label || '-'}` : '未填写') : Number(item.summary?.response_count || 0)}</td>
                          {!isBasicUser ? <td>{Number(item.summary?.average_final_score || 0).toFixed(2)}</td> : null}
                          <td><span className="badge">{instructorReviewStatusLabel(item.status)}</span></td>
                          <td>
                            <div>{getInstructorReviewPublishTimeText(item)}</div>
                            {String(item.status || '').toLowerCase() === 'scheduled' ? <small className="muted-text">计划发布</small> : null}
                          </td>
                          <td>
                            {isBasicUser ? (
                              <button className="ghost" type="button" onClick={() => setInstructorReviewResponseForm({
                                form_id: String(item.id),
                                clarity_score: Number(item.clarity_score || 5),
                                interaction_score: Number(item.interaction_score || 5),
                                practical_score: Number(item.practical_score || 5),
                                time_control_score: Number(item.time_control_score || 5),
                                qa_score: Number(item.qa_score || 5),
                                feedback: item.feedback || '',
                                anonymous: Number(item.anonymous || 0) === 1,
                              })}>
                                {item.submitted ? '修改评价' : '填写评价'}
                              </button>
                            ) : (
                              <div className="row-actions">
                                <button className="ghost" type="button" onClick={() => fetchAdminInstructorReviewResponses(item.id, true)}>查看明细</button>
                                {String(item.status || '').toLowerCase() !== 'published' ? (
                                  <button className="ghost" type="button" onClick={() => onUpdateInstructorQuestionnaireStatus(item, 'published')}>发布</button>
                                ) : null}
                                {!['published', 'closed'].includes(String(item.status || '').toLowerCase()) ? (
                                  <button className="ghost" type="button" onClick={() => onOpenInstructorReviewScheduleDialog(item)}>
                                    {String(item.status || '').toLowerCase() === 'scheduled' ? '调整定时' : '定时发布问卷'}
                                  </button>
                                ) : null}
                                <button className="warn" type="button" onClick={() => onUpdateInstructorQuestionnaireStatus(item, 'closed')}>关闭</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={isBasicUser ? 6 : 7}>暂无讲师评价问卷</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            {!isBasicUser && adminInstructorReviewResponses.form ? (
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>{adminInstructorReviewResponses.form.title} 明细</h2>
                    <div className="sub">讲师：{adminInstructorReviewResponses.form.instructor_name}</div>
                  </div>
                </div>
                <div className="panel-body metric-grid">
                  <div className="metric"><label>参与人数</label><strong>{Number(adminInstructorReviewResponses.summary?.response_count || 0)}</strong></div>
                  <div className="metric"><label>平均分</label><strong>{Number(adminInstructorReviewResponses.summary?.average_final_score || 0).toFixed(2)}</strong></div>
                  <div className="metric"><label>极好</label><strong>{Number(adminInstructorReviewResponses.summary?.rating_distribution?.极好 || 0)}</strong></div>
                  <div className="metric"><label>优秀</label><strong>{Number(adminInstructorReviewResponses.summary?.rating_distribution?.优秀 || 0)}</strong></div>
                </div>
                <div className="panel-body table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>学员</th>
                        <th>最终分</th>
                        <th>清晰度</th>
                        <th>互动</th>
                        <th>实用</th>
                        <th>时间</th>
                        <th>答疑</th>
                        <th>反馈</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminInstructorReviewResponses.items.length ? adminInstructorReviewResponses.items.map((item) => (
                        <tr key={`instructor-response-${item.id}`}>
                          <td>{Number(item.anonymous || 0) === 1 ? '匿名' : item.username}</td>
                          <td>{Number(item.final_score || 0).toFixed(2)} / {item.rating_label || '-'}</td>
                          <td>{Number(item.clarity_score || 0)}</td>
                          <td>{Number(item.interaction_score || 0)}</td>
                          <td>{Number(item.practical_score || 0)}</td>
                          <td>{Number(item.time_control_score || 0)}</td>
                          <td>{Number(item.qa_score || 0)}</td>
                          <td>{item.feedback || '-'}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={8}>暂无评价明细</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}

        {activeMenu === 'papers' && !isBasicUser && (
          <>
            <section className="panel">
              <div className="panel-header"><h2>创建试卷</h2></div>
              <div className="panel-body">
                <form onSubmit={onCreatePaper} className="form-grid">
                  <div><label>试卷名称</label><input value={paperForm.name} onChange={(e) => setPaperForm((p) => ({ ...p, name: e.target.value }))} /></div>
                  <div>
                    <label>组卷方式</label>
                    <select value={paperForm.paper_mode} onChange={(e) => setPaperForm((p) => ({ ...p, paper_mode: e.target.value }))}>
                      <option value="fixed">固定试卷</option>
                      <option value="random">随机抽题</option>
                    </select>
                  </div>
                  <div><label>及格线</label><input type="number" value={paperForm.pass_score} onChange={(e) => setPaperForm((p) => ({ ...p, pass_score: e.target.value }))} /></div>
                  <div><label>考试时长(分钟)</label><input type="number" value={paperForm.duration_minutes} onChange={(e) => setPaperForm((p) => ({ ...p, duration_minutes: e.target.value }))} /></div>
                  <div><label>最大次数</label><input type="number" value={paperForm.max_attempts} onChange={(e) => setPaperForm((p) => ({ ...p, max_attempts: e.target.value }))} /></div>
                  <div><label>考试有效期(小时)</label><input type="number" min="1" max="8760" value={paperForm.exam_window_hours} onChange={(e) => setPaperForm((p) => ({ ...p, exam_window_hours: e.target.value }))} /></div>
                  {paperForm.paper_mode === 'fixed' ? (
                    <div className="full"><label>固定题目ID(逗号)</label><input value={paperForm.fixed_question_ids} onChange={(e) => setPaperForm((p) => ({ ...p, fixed_question_ids: e.target.value }))} /></div>
                  ) : (
                    <>
                      <div className="full row-actions">
                        <span className="badge">抽题规则 {Array.isArray(paperForm.rules) ? paperForm.rules.length : 0} 条</span>
                        <span className="sub">可新增多条规则实现单选、多选、判断题混合出题。</span>
                        <button className="ghost" type="button" onClick={addPaperRule}>新增规则</button>
                      </div>
                      {(Array.isArray(paperForm.rules) ? paperForm.rules : []).map((rule, index) => (
                        <div className="full question-source-meta" key={`paper-rule-${index}`}>
                          <div className="row-actions">
                            <strong>规则 {index + 1}</strong>
                            <button
                              className="danger"
                              type="button"
                              onClick={() => removePaperRule(index)}
                              disabled={(Array.isArray(paperForm.rules) ? paperForm.rules.length : 0) <= 1}
                            >
                              删除规则
                            </button>
                          </div>
                          <div className="form-grid" style={{ marginTop: 10 }}>
                            <div>
                              <label>题型</label>
                              <select value={rule.question_type} onChange={(e) => updatePaperRule(index, { question_type: e.target.value })}>
                                <option value="single_choice">单选题</option>
                                <option value="multiple_choice">多选题</option>
                                <option value="judgement">判断题</option>
                                <option value="fill_blank">填空题</option>
                              </select>
                            </div>
                            <div>
                              <label>难度</label>
                              <select value={rule.difficulty} onChange={(e) => updatePaperRule(index, { difficulty: e.target.value })}>
                                <option value="">不限</option>
                                <option value="easy">简单</option>
                                <option value="medium">中等</option>
                                <option value="hard">困难</option>
                              </select>
                            </div>
                            <div><label>抽题数量</label><input type="number" value={rule.question_count} onChange={(e) => updatePaperRule(index, { question_count: e.target.value })} /></div>
                            <div><label>每题分值</label><input type="number" value={rule.points_per_question} onChange={(e) => updatePaperRule(index, { points_per_question: e.target.value })} /></div>
                            <div className="full">
                              <label>题库分类（可单选或多选）</label>
                              <select
                                multiple
                                size={Math.min(6, Math.max(3, questionCategoryRows.length || 3))}
                                value={Array.isArray(rule.question_categories) ? rule.question_categories : []}
                                onChange={(e) => updatePaperRule(index, { question_categories: getMultiSelectValues(e.target) })}
                                style={{ minHeight: 112 }}
                              >
                                {questionCategoryRows.map((row) => {
                                  const typeCount = getPublishedQuestionCategoryCount(row, rule.question_type)
                                  return (
                                    <option key={`paper-rule-category-${index}-${row.id}`} value={row.name}>
                                      {row.name}（已发布{questionTypeLabel(rule.question_type)} {typeCount}题）
                                    </option>
                                  )
                                })}
                              </select>
                              <div className="sub">按住 Command/Ctrl 可多选；这里只显示当前题型下已发布、可用于组卷的题量。</div>
                            </div>
                            <div className="full"><label>标签筛选（逗号分隔，可空）</label><input value={rule.tags} onChange={(e) => updatePaperRule(index, { tags: e.target.value })} /></div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  <div className="full row-actions"><button className="primary" type="submit" disabled={!canWrite}>创建试卷</button></div>
                </form>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>试卷列表</h2>
                <div className="row-actions">
                  <span className="badge">共 {papers.length} 套</span>
                  {canWrite ? (
                    <>
                      <button
                        className="danger"
                        type="button"
                        disabled={paperBatchDeleting || paperDeletePendingId > 0 || selectedPaperIds.length === 0}
                        onClick={() => onDeletePapersBatch({ deleteAll: false })}
                      >
                        {paperBatchDeleting ? '删除中...' : `删除选中(${selectedPaperIds.length})`}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        disabled={paperBatchDeleting || paperDeletePendingId > 0 || papers.length === 0}
                        onClick={() => onDeletePapersBatch({ deleteAll: true })}
                      >
                        一键删除全部
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="panel-body table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          disabled={!canWrite || paperBatchDeleting || paperDeletePendingId > 0 || papers.length === 0}
                          checked={papers.length > 0 && selectedPaperIds.length === papers.length}
                          onChange={(e) => {
                            const checked = !!e.target.checked
                            setSelectedPaperIds(
                              checked
                                ? papers.map((item) => Number(item.id || 0)).filter((id) => id > 0)
                                : []
                            )
                          }}
                        />
                      </th>
                      <th>ID</th>
                      <th>名称</th>
                      <th>方式</th>
                      <th>状态</th>
                      <th>及格线</th>
                      <th>有效期</th>
                      <th>发布时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {papers.length ? papers.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!canWrite || paperBatchDeleting || paperDeletePendingId > 0}
                            checked={selectedPaperIds.includes(Number(p.id))}
                            onChange={(e) => {
                              const checked = !!e.target.checked
                              const id = Number(p.id || 0)
                              setSelectedPaperIds((prev) => {
                                const base = Array.isArray(prev) ? prev : []
                                if (checked) return base.includes(id) ? base : [...base, id]
                                return base.filter((item) => Number(item) !== id)
                              })
                            }}
                          />
                        </td>
                        <td>{p.id}</td>
                        <td>{p.name}</td>
                        <td>{paperModeLabel(p.paper_mode)}</td>
                        <td><span className={paperStatusClassName(p.status)}>{paperStatusLabel(p.status)}</span></td>
                        <td>{p.pass_score}</td>
                        <td>{normalizePaperExamWindowHours(p.exam_window_hours)} 小时</td>
                        <td>
                          <div>{getPaperPublishTimeText(p)}</div>
                          {String(p.status || '').toLowerCase() === 'scheduled' ? <small className="muted-text">计划发布</small> : null}
                        </td>
                        <td>
                          <div className="row-actions">
                            {canWrite ? (
                              <button
                                className="danger"
                                type="button"
                                disabled={paperBatchDeleting || paperDeletePendingId === Number(p.id)}
                                onClick={() => onDeletePaper(p)}
                              >
                                {paperDeletePendingId === Number(p.id) ? '删除中...' : '删除试卷'}
                              </button>
                            ) : null}
                            {canPublishPaper && p.status !== 'published' ? <button className="warn" type="button" onClick={() => onPublishPaper(p.id)}>立即发布</button> : null}
                            {canPublishPaper && p.status !== 'published' && p.status !== 'archived' ? (
                              <button className="ghost" type="button" onClick={() => onOpenPaperScheduleDialog(p)}>
                                {p.status === 'scheduled' ? '调整定时' : '定时发布'}
                              </button>
                            ) : null}
                            {canWrite ? <button className="ghost" type="button" onClick={() => onUpdatePaperExamWindow(p)}>修改有效期</button> : null}
                            {canPublishPaper && p.status === 'published' ? <button className="danger" onClick={() => onArchivePaper(p.id)}>归档</button> : null}
                            {p.status === 'published' ? <button className="primary" onClick={() => onStartExam(p.id)}>开始考试</button> : null}
                          </div>
                        </td>
                      </tr>
                    )) : <tr><td colSpan={9}>暂无试卷</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeMenu === 'papers' && isBasicUser && (
          <section className="panel">
            <div className="panel-header">
              <h2>试卷列表</h2>
              <div className="row-actions">
                <span className="badge">已发布 {publishedPapers.length} 套</span>
                <button className="ghost" type="button" onClick={() => fetchPapers(true)}>刷新试卷</button>
              </div>
            </div>
            <div className="panel-body table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>名称</th>
                    <th>方式</th>
                    <th>及格线</th>
                    <th>时长(分钟)</th>
                    <th>截止时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {publishedPapers.length ? publishedPapers.map((item) => {
                    const expired = isPaperExpiredForExam(item)
                    return (
                      <tr key={`published-paper-list-${item.id}`}>
                        <td>{item.id}</td>
                        <td>{item.name || '-'}</td>
                        <td>{paperModeLabel(item.paper_mode)}</td>
                        <td>{Number(item.pass_score || 0)}</td>
                        <td>{Number(item.duration_minutes || 0)}</td>
                        <td>{getPaperExamDeadlineText(item)}</td>
                        <td>
                          <button className={expired ? 'ghost' : 'primary'} onClick={() => onStartExam(item.id)} disabled={expired}>
                            {expired ? '超过考试时间' : '开始考试'}
                          </button>
                        </td>
                      </tr>
                    )
                  }) : <tr><td colSpan={7}>暂无可考试卷</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeMenu === 'exam' && (
          <section className="panel">
            <div className="panel-header"><h2>考试中心</h2></div>
            <div className="panel-body">
              {isBasicUser ? (
                <section className="panel">
                  <div className="panel-header">
                    <h3>可考试卷</h3>
                    <div className="row-actions">
                      <span className="badge">已发布 {publishedPapers.length} 套</span>
                      <button className="ghost" type="button" onClick={() => fetchPapers(true)}>刷新试卷</button>
                    </div>
                  </div>
                  <div className="panel-body table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>名称</th>
                          <th>方式</th>
                          <th>及格线</th>
                          <th>时长(分钟)</th>
                          <th>截止时间</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {publishedPapers.length ? publishedPapers.map((item) => {
                          const expired = isPaperExpiredForExam(item)
                          return (
                            <tr key={`published-paper-${item.id}`}>
                              <td>{item.id}</td>
                              <td>{item.name || '-'}</td>
                              <td>{paperModeLabel(item.paper_mode)}</td>
                              <td>{Number(item.pass_score || 0)}</td>
                              <td>{Number(item.duration_minutes || 0)}</td>
                              <td>{getPaperExamDeadlineText(item)}</td>
                              <td>
                                <button className={expired ? 'ghost' : 'primary'} onClick={() => onStartExam(item.id)} disabled={expired}>
                                  {expired ? '超过考试时间' : '开始考试'}
                                </button>
                              </td>
                            </tr>
                          )
                        }) : <tr><td colSpan={7}>暂无可考试卷</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <div className="exam-history-toolbar">
                  <div className="row-actions">
                    <span className="badge">历史考卷</span>
                    <select
                      value={selectedHistoryResultId}
                      onChange={(e) => setSelectedHistoryResultId(e.target.value)}
                      disabled={historyResultLoading || historyResultOptions.length === 0}
                    >
                      {historyResultOptions.length === 0 ? (
                        <option value="">暂无历史记录</option>
                      ) : (
                        historyResultOptions.map((item) => (
                          <option key={`history-result-${item.id}`} value={String(item.id)}>{item.label}</option>
                        ))
                      )}
                    </select>
                    <button
                      className="ghost"
                      type="button"
                      disabled={historyResultLoading || Number(selectedHistoryResultId || 0) <= 0}
                      onClick={() => onOpenHistoryResult(selectedHistoryResultId)}
                    >
                      {historyResultLoading ? '加载中...' : '查看历史考卷'}
                    </button>
                  </div>
                  <div className="row-actions">
                    <button
                      className="ghost"
                      type="button"
                      disabled={historyResultLoading || historyResultOptions.length === 0}
                      onClick={() => {
                        const latestId = Number(historyResultOptions?.[0]?.id || 0)
                        if (latestId > 0) onOpenHistoryResult(latestId)
                      }}
                    >
                      查看最近一次
                    </button>
                  </div>
                </div>
              )}
              {!currentSession ? <div>{isBasicUser ? '请先在上方试卷列表点击“开始考试”。' : '请在“试卷管理”中选择已发布试卷并开始考试，或在上方选择历史考卷进行回顾。'}</div> : (
                <>
                  <div className="exam-toolbar">
                    <div className="row-actions">
                      <span className="badge">会话 #{currentSession.id}</span>
                      <span className="badge">剩余 {Math.floor(remainingSeconds / 60)}分 {remainingSeconds % 60}秒</span>
                      <span className="badge">切屏告警计数：{currentSession.focus_switch_count || 0}</span>
                      <span className="badge">进度 {examProgress.answered}/{examProgress.total}（{examProgress.percent}%）</span>
                      {savingQuestionId ? <span className="badge">正在保存第 {currentQuestions.findIndex((item) => Number(item.question_id) === Number(savingQuestionId)) + 1 || '?'} 题</span> : null}
                      {!savingQuestionId && lastSavedAt ? <span className="badge">自动保存于 {lastSavedAt}</span> : null}
                    </div>
                    <div className="row-actions">
                      {!currentResult ? <button className="warn" onClick={onFocusSwitch}>模拟切屏+1</button> : null}
                      <button className="primary" onClick={onConfirmSubmitExam} disabled={isSubmittingExam || !!currentResult}>
                        {isSubmittingExam ? '提交中...' : '提交试卷'}
                      </button>
                    </div>
                  </div>

                  <div className="question-nav">
                    {currentQuestions.map((q, idx) => {
                      const answered = hasAnyAnswer(q.user_answer)
                      const isActive = Number(activeQuestionId || 0) === Number(q.question_id || 0)
                      const className = `q-nav-btn${isActive ? ' active' : ''}${answered ? ' answered' : ''}`
                      return (
                        <button key={q.question_id} type="button" className={className} onClick={() => onJumpToQuestion(q.question_id)}>
                          {idx + 1}
                        </button>
                      )
                    })}
                  </div>

                  {currentQuestions.map((q, idx) => {
                    const snapshot = q.snapshot || {}
                    const type = String(snapshot.question_type || '')
                    const options = Array.isArray(snapshot.options) ? snapshot.options : []
                    const answered = hasAnyAnswer(q.user_answer)
                    const examBoxClassName = `exam-box${Number(activeQuestionId || 0) === Number(q.question_id || 0) ? ' active' : ''}`
                    const review = currentResult
                      ? buildExamQuestionReview({
                          detail: resultDetailByQuestionId.get(Number(q.question_id || 0)),
                          questionType: type,
                          options,
                        })
                      : null

                    return (
                      <div key={q.question_id} id={`exam-question-${q.question_id}`} className={examBoxClassName}>
                        <div className="row-actions">
                          <strong>{idx + 1}. {snapshot.stem}</strong>
                          <span className="badge">{answered ? '已作答' : '未作答'}</span>
                        </div>
                        <div className="badge" style={{ marginTop: 6 }}>{questionTypeLabel(type)} · {snapshot.points || 0}分</div>

                        {(type === 'single_choice' || type === 'judgement') ? (
                          <div className="exam-options">
                            {options.map((opt) => (
                              <label key={opt.key}>
                                <input
                                  type="radio"
                                  name={`q-${q.question_id}`}
                                  checked={Array.isArray(q.user_answer) ? q.user_answer.includes(opt.key) : false}
                                  disabled={!!currentResult}
                                  onChange={() => onAnswerQuestion(q.question_id, [opt.key])}
                                />
                                <span>{opt.key}. {opt.text}</span>
                              </label>
                            ))}
                          </div>
                        ) : null}

                        {type === 'multiple_choice' ? (
                          <div className="exam-options">
                            {options.map((opt) => {
                              const selected = Array.isArray(q.user_answer) ? q.user_answer : []
                              return (
                                <label key={opt.key}>
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(opt.key)}
                                    disabled={!!currentResult}
                                    onChange={(e) => {
                                      const next = new Set(selected)
                                      if (e.target.checked) next.add(opt.key)
                                      else next.delete(opt.key)
                                      onAnswerQuestion(q.question_id, Array.from(next))
                                    }}
                                  />
                                  <span>{opt.key}. {opt.text}</span>
                                </label>
                              )
                            })}
                          </div>
                        ) : null}

                        {type === 'fill_blank' ? (
                          <div style={{ marginTop: 8 }}>
                            <input
                              placeholder="请输入答案"
                              value={Array.isArray(q.user_answer) ? (q.user_answer[0] || '') : ''}
                              disabled={!!currentResult}
                              onChange={(e) => onAnswerQuestion(q.question_id, [e.target.value])}
                            />
                          </div>
                        ) : null}

                        {review ? (
                          <div className="exam-answer-review">
                            <div className="exam-answer-review-head">
                              <strong>本题回顾</strong>
                              <span className={`status-chip ${review.isCorrect ? 'good' : 'warn'}`}>
                                {review.isCorrect ? '回答正确' : '回答错误'}
                              </span>
                              <span className="badge">本题得分 {review.scoreText}</span>
                            </div>
                            <div className="exam-answer-review-line">
                              <label>你的作答</label>
                              <div>{review.userAnswerText}</div>
                            </div>
                            <div className="exam-answer-review-line">
                              <label>标准答案</label>
                              <div>{review.standardAnswerText}</div>
                            </div>
                            {review.explanation ? (
                              <div className="exam-answer-review-line">
                                <label>解析</label>
                                <div>{review.explanation}</div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}

                  {currentResult ? (
                    <section className="panel" style={{ marginTop: 12 }}>
                      <div className="panel-header"><h2>本次成绩</h2></div>
                      <div className="panel-body">
                        <div className="row-actions">
                          <span className="badge">得分：{Number(currentResult.score || 0).toFixed(2)}</span>
                          <span className="badge">总分：{Number(currentResult.total_score || 0).toFixed(2)}</span>
                          <span className={`rating-chip rating-${formatRatingText(currentResult.rating_level).toLowerCase()}`}>评级 {formatRatingText(currentResult.rating_level)}</span>
                          <span className="badge">{Number(currentResult.passed || 0) === 1 ? '通过' : '未通过'}</span>
                          {!isBasicUser && Number(currentResult.passed || 0) === 1 ? (
                            <button className="primary" onClick={() => onGenerateCertificate(currentResult.id)}>生成证书</button>
                          ) : null}
                          {!isBasicUser ? (
                            <button
                              className="ghost"
                              onClick={() => onGenerateResultAdvice(currentResult.id, { force: true })}
                              disabled={isAdviceLoading}
                            >
                              {isAdviceLoading ? 'AI建议生成中...' : '重生成AI建议'}
                            </button>
                          ) : null}
                        </div>
                        {!isBasicUser ? (
                          <div className="exam-box" style={{ marginTop: 10 }}>
                            <div className="row-actions">
                              <strong>AI学习建议</strong>
                              <span className="badge">{adviceStatusLabel(resultAdvice?.status || 'pending')}</span>
                              <span className="badge">模型：{resultAdvice?.model_name || '-'}</span>
                            </div>
                            <pre style={{ whiteSpace: 'pre-wrap', margin: '10px 0 0', fontFamily: 'inherit' }}>
                              {String(resultAdvice?.advice_text || '建议生成中，若长时间未出现可点击“重生成AI建议”。')}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </section>
        )}

        {activeMenu === 'retrain' && (
          <>
            <section className="panel">
              <div className="panel-header">
                <h2>错题复训总览</h2>
                <button className="ghost" onClick={() => fetchRetrainCenter()}>刷新复训数据</button>
              </div>
              <div className="panel-body metric-grid">
                <div className="metric"><label>错题总数</label><strong>{retrainSummary.wrong_question_total || 0}</strong></div>
                <div className="metric"><label>待复训</label><strong>{retrainSummary.unresolved_total || 0}</strong></div>
                <div className="metric"><label>已改善</label><strong>{retrainSummary.improved_total || 0}</strong></div>
                <div className="metric"><label>建议课程数</label><strong>{retrainRecommendations.filter((item) => item.recommendation_type === 'course').length}</strong></div>
              </div>
              <div className="panel-body">
                <div className="retrain-workbench">
                  <div className="retrain-workbench-head">
                    <div>
                      <strong>历史考试复训工作台</strong>
                      <p>选择一次历史考试成绩后启动复训，可重复多次进行巩固训练。</p>
                    </div>
                    <span className="badge">仅历史考试复训</span>
                  </div>
                  <div className="retrain-filter-bar">
                    <label>历史考试记录</label>
                    <select
                      value={retrainHistoryResultId}
                      onChange={(e) => setRetrainHistoryResultId(e.target.value)}
                      disabled={retrainStarting}
                    >
                      {historyResultOptions.length ? historyResultOptions.map((item) => (
                        <option key={`retrain-history-result-${item.id}`} value={String(item.id)}>{item.label}</option>
                      )) : <option value="">暂无历史记录</option>}
                    </select>
                  </div>
                  <div className="retrain-filter-bar">
                    <label>题型筛选</label>
                    <select
                      value={retrainFilters.question_type}
                      onChange={(e) => setRetrainFilters((prev) => ({ ...prev, question_type: e.target.value }))}
                      disabled={retrainStarting}
                    >
                      <option value="all">全部题型</option>
                      <option value="single_choice">单选题</option>
                      <option value="multiple_choice">多选题</option>
                      <option value="judgement">判断题</option>
                      <option value="fill_blank">填空题</option>
                    </select>
                    <label>分类筛选</label>
                    <select
                      value={retrainFilters.question_category}
                      onChange={(e) => setRetrainFilters((prev) => ({ ...prev, question_category: e.target.value }))}
                      disabled={retrainStarting}
                    >
                      <option value="all">全部分类</option>
                      {questionCategories.map((name) => (
                        <option key={`retrain-category-${name}`} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="retrain-workbench-actions">
                    <button
                      className="primary"
                      onClick={() => onStartRetrain({ resultId: Number(retrainHistoryResultId || 0) })}
                      disabled={!historyResultOptions.length || !Number(retrainHistoryResultId || 0) || retrainStarting}
                    >
                      {retrainStarting ? '复训启动中...' : '开始本次历史复训'}
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => setRetrainFilters({ question_type: 'all', question_category: 'all' })}
                      disabled={retrainStarting}
                    >
                      重置筛选
                    </button>
                  </div>
                </div>
                <div className="retrain-tags">
                  {(Array.isArray(retrainSummary.top_tags) ? retrainSummary.top_tags : []).length ? (
                    retrainSummary.top_tags.map((item) => (
                      <span className="badge" key={`tag-${item.tag}`}>#{item.tag} · {item.count}</span>
                    ))
                  ) : (
                    <span className="empty-tip">暂无标签画像</span>
                  )}
                </div>
              </div>
            </section>

            <section className="grid-2 retrain-recommend-full">
              <div className="panel">
                <div className="panel-header"><h2>复训推荐</h2></div>
                <div className="panel-body">
                  <div className="retrain-grid">
                    {retrainRecommendations.length ? retrainRecommendations.map((item, idx) => (
                      <article className="retrain-card" key={`retrain-${idx}-${item.recommendation_type}`}>
                        <div className="retrain-head">
                          <strong>{item.title || item.course_title || '训练建议'}</strong>
                          <span className="badge">{recommendationTypeLabel(item.recommendation_type)}</span>
                        </div>
                        <div className="sub">{item.reason || '-'}</div>
                        {Array.isArray(item.resource_preview) && item.resource_preview.length ? (
                          <div className="resource-list">
                            {item.resource_preview.map((res) => {
                              const openUrl = buildResourceOpenUrl(res)
                              const text = `${res.name || `资源-${res.id}`} · ${resourceTypeLabel(res.resource_type)}${res.force_watch ? ' · 强制播放' : ''}`
                              if (!openUrl) return <span key={`res-${res.id}`} className="empty-tip">{text} · 暂无可用链接</span>
                              return <a key={`res-${res.id}`} href={openUrl} target="_blank" rel="noreferrer">{text}</a>
                            })}
                          </div>
                        ) : null}
                      </article>
                    )) : (
                      <div className="empty-tip">暂无复训推荐</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>错题本</h2>
                <div className="row-actions">
                  <span className="badge">共 {wrongNotebook.pagination?.total || 0} 道</span>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => onStartWrongNotebookRetrain({ selectAll: false })}
                    disabled={retrainStarting || selectedWrongQuestionIds.length === 0}
                  >
                    {retrainStarting ? '启动中...' : `复训选中(${selectedWrongQuestionIds.length})`}
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => onStartWrongNotebookRetrain({ selectAll: true })}
                    disabled={retrainStarting || !wrongNotebook.items.length}
                  >
                    复训全部
                  </button>
                </div>
              </div>
              <div className="panel-body table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          disabled={retrainStarting || wrongNotebook.items.length === 0}
                          checked={wrongNotebook.items.length > 0 && selectedWrongQuestionIds.length === wrongNotebook.items.length}
                          onChange={(e) => {
                            const checked = !!e.target.checked
                            setSelectedWrongQuestionIds(
                              checked
                                ? wrongNotebook.items.map((item) => Number(item.question_id || 0)).filter((id) => id > 0)
                                : []
                            )
                          }}
                        />
                      </th>
                      <th>ID</th>
                      <th>题干</th>
                      <th>题型</th>
                      <th>错/对</th>
                      <th>状态</th>
                      <th>最近错题时间</th>
                      <th>标签</th>
                      <th>复训动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wrongNotebook.items.length ? wrongNotebook.items.map((item) => (
                      <tr key={`wrong-${item.question_id}`}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={retrainStarting}
                            checked={selectedWrongQuestionIds.includes(Number(item.question_id))}
                            onChange={(e) => {
                              const checked = !!e.target.checked
                              const id = Number(item.question_id || 0)
                              setSelectedWrongQuestionIds((prev) => {
                                const base = Array.isArray(prev) ? prev : []
                                if (checked) return base.includes(id) ? base : [...base, id]
                                return base.filter((v) => Number(v) !== id)
                              })
                            }}
                          />
                        </td>
                        <td>{item.question_id}</td>
                        <td>{item.stem}</td>
                        <td>{questionTypeLabel(item.question_type)}</td>
                        <td>{item.wrong_count} / {item.correct_count}</td>
                        <td>
                          <span className={`status-chip ${item.mastery_status === 'improved' ? 'good' : 'warn'}`}>
                            {item.mastery_status === 'improved' ? '已改善' : '待复训'}
                          </span>
                        </td>
                        <td>{formatDateTime(item.latest_wrong_at)}</td>
                        <td>
                          <div className="row-actions">
                            {(Array.isArray(item.tags) ? item.tags.slice(0, 3) : []).map((tag) => (
                              <span className="badge" key={`wrong-tag-${item.question_id}-${tag}`}>#{tag}</span>
                            ))}
                          </div>
                        </td>
                        <td>{item.suggested_action}</td>
                      </tr>
                    )) : <tr><td colSpan={9}>暂无错题记录</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeMenu === 'results' && (
          <>
            {!isBasicUser ? (
              <section className="panel">
                <div className="panel-header">
                  <h2>{resultCenterTab === 'results' ? '考试结果' : '证书中心'}</h2>
                  <div className="row-actions">
                    <button
                      className={resultCenterTab === 'results' ? 'primary' : 'ghost'}
                      type="button"
                      onClick={async () => {
                        setResultCenterTab('results')
                        setResultCenterView({ type: 'papers', from: 'papers', resultId: 0, userId: 0, paperId: 0 })
                        try {
                          await fetchAdminResultPapers(true)
                        } catch (err) {
                          setError(err.message || '加载考试结果失败')
                        }
                      }}
                    >
                      考试结果
                    </button>
                    <button
                      className={resultCenterTab === 'certificates' ? 'primary' : 'ghost'}
                      type="button"
                      onClick={async () => {
                        setResultCenterTab('certificates')
                        setResultCenterView({ type: 'papers', from: 'papers', resultId: 0, userId: 0, paperId: 0 })
                        try {
                          await Promise.all([fetchCertificateCenter(true), fetchCertificateTemplate(true)])
                        } catch (err) {
                          setError(err.message || '加载证书中心失败')
                        }
                      }}
                    >
                      证书中心
                    </button>
                  </div>
                </div>
                <div className="panel-body results-hub-intro">
                  <div>
                    <strong>{resultCenterTab === 'results' ? '先选试卷，再查看每个人的考试结果。' : '证书模板与续证任务按需加载。'}</strong>
                    <p className="sub">
                      {resultCenterTab === 'results'
                        ? '成绩中心按已发布试卷汇总，进入试卷后仍可按考生、时间和通过状态筛选。'
                        : '证书模板、续证任务和个人证书列表保留在这里，不再和考试结果首屏一起加载。'}
                    </p>
                  </div>
                  {resultCenterTab === 'results' && resultCenterView.type === 'papers' ? (
                    <div className="row-actions">
                      <span className="badge">已发布试卷 {adminResultPaperOverview.items.length} 套</span>
                      <button className="ghost" type="button" onClick={() => fetchAdminResultPapers()} disabled={adminResultPapersLoading}>
                        {adminResultPapersLoading ? '刷新中...' : '刷新试卷'}
                      </button>
                    </div>
                  ) : resultCenterTab === 'results' && resultCenterView.type === 'list' ? (
                    <div className="row-actions">
                      <span className="badge">当前共 {adminResultsPagination.total} 条结果</span>
                      <button className="ghost" type="button" onClick={onBackToResultCenter}>返回试卷列表</button>
                      <button className="ghost" type="button" onClick={onExportAdminResults} disabled={adminResultsLoading || adminResultsExporting}>
                        {adminResultsExporting ? '导出中...' : '导出结果'}
                      </button>
                      <button className="ghost" type="button" onClick={() => fetchAdminResults()} disabled={adminResultsLoading}>
                        {adminResultsLoading ? '刷新中...' : '刷新结果'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {resultCenterView.type === 'detail' ? (
              <>
                <section className="panel results-detail-panel">
                  <div className="panel-header">
                    <div>
                      <h2>卷面详情</h2>
                      <div className="sub">查看本次考试的得分、题型表现和逐题作答明细。</div>
                    </div>
                    <div className="row-actions">
                      <button className="ghost" type="button" onClick={onBackToResultCenter}>
                        {resultCenterView.from === 'candidate' ? '返回考生记录' : '返回结果列表'}
                      </button>
                      {!isBasicUser && Number(resultReviewDetail?.summary?.user_id || 0) > 0 ? (
                        <button className="ghost" type="button" onClick={() => onOpenCandidateRecord(resultReviewDetail.summary.user_id, { silent: true })}>
                          查看考生记录
                        </button>
                      ) : null}
                      <button className="primary" type="button" onClick={() => window.print()} disabled={resultReviewLoading || !resultReviewDetail}>
                        打印报表
                      </button>
                    </div>
                  </div>
                  <div className="panel-body">
                    {resultReviewLoading && !resultReviewDetail ? (
                      <div className="empty-tip">卷面详情加载中...</div>
                    ) : resultReviewDetail ? (
                      <div className="results-detail-shell">
                        <div className="results-detail-hero">
                          <div className="results-detail-overview">
                            <div className="results-detail-title">
                              <strong>{resultReviewDetail?.summary?.paper_name || '未命名试卷'}</strong>
                              <span className={`status-chip ${Number(resultReviewDetail?.summary?.passed || 0) === 1 ? 'good' : 'warn'}`}>
                                {Number(resultReviewDetail?.summary?.passed || 0) === 1 ? '通过' : '未通过'}
                              </span>
                            </div>
                            <div className="row-actions">
                              <span className="badge">结果 #{resultReviewDetail?.summary?.result_id || 0}</span>
                              <span className="badge">考生：{resultReviewDetail?.summary?.username || '-'}</span>
                              <span className={`rating-chip rating-${formatRatingText(resultReviewDetail?.summary?.rating_level).toLowerCase()}`}>评级 {formatRatingText(resultReviewDetail?.summary?.rating_level)}</span>
                              <span className="badge">部门：{resultReviewDetail?.summary?.user_department || '-'}</span>
                              <span className="badge">岗位：{resultReviewDetail?.summary?.user_position || '-'}</span>
                            </div>
                            <div className="row-actions">
                              <span className="badge">考试时间：{formatDateTime(resultReviewDetail?.summary?.created_at)}</span>
                              <span className="badge">用时：{formatDurationText(resultReviewDetail?.summary?.duration_seconds)}</span>
                              <span className="badge">第 {Number(resultReviewDetail?.summary?.attempt_no || 0)} 次考试</span>
                              <span className="badge">{Number(resultReviewDetail?.summary?.is_final || 0) === 1 ? '计入最终成绩' : '非最终成绩'}</span>
                            </div>
                          </div>
                          <div className="results-score-card">
                            <span>得分</span>
                            <strong>{Number(resultReviewDetail?.summary?.score || 0).toFixed(2)}</strong>
                            <div>评级 {formatRatingText(resultReviewDetail?.summary?.rating_level)} / 总分 {Number(resultReviewDetail?.summary?.total_score || 0).toFixed(2)} / 及格线 {Number(resultReviewDetail?.summary?.pass_score || 0).toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="metric-grid results-detail-metrics">
                          <div className="metric">
                            <label>总题数</label>
                            <strong>{Number(resultReviewDetail?.report?.total_questions || 0)}</strong>
                          </div>
                          <div className="metric">
                            <label>正确题数</label>
                            <strong>{Number(resultReviewDetail?.report?.correct_count || 0)}</strong>
                          </div>
                          <div className="metric">
                            <label>错题数</label>
                            <strong>{Number(resultReviewDetail?.report?.wrong_count || 0)}</strong>
                          </div>
                          <div className="metric">
                            <label>正确率</label>
                            <strong>{formatPercentText(resultReviewDetail?.report?.accuracy_rate || 0)}</strong>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-tip">暂无卷面详情</div>
                    )}
                  </div>
                </section>

                {resultReviewDetail ? (
                  <>
                    <section className="panel">
                      <div className="panel-header"><h2>结果报表</h2></div>
                      <div className="panel-body">
                        <div className="results-type-grid">
                          {resultReviewTypeStats.length ? resultReviewTypeStats.map((item) => (
                            <div className="metric" key={`review-type-${item.question_type}`}>
                              <label>{questionTypeLabel(item.question_type)}</label>
                              <strong>{formatPercentText(item.accuracy_rate || 0)}</strong>
                              <div className="sub">正确 {item.correct_count} / {item.total_questions}，得分 {Number(item.earned_score || 0).toFixed(2)} / {Number(item.total_score || 0).toFixed(2)}</div>
                            </div>
                          )) : (
                            <div className="empty-tip">暂无题型报表</div>
                          )}
                        </div>
                      </div>
                    </section>

                    {!isBasicUser && resultReviewDetail?.ai_advice ? (
                      <section className="panel">
                        <div className="panel-header"><h2>AI 学习建议</h2></div>
                        <div className="panel-body">
                          <div className="row-actions">
                            <span className="badge">{adviceStatusLabel(resultReviewDetail?.ai_advice?.status || 'pending')}</span>
                            <span className="badge">模型：{resultReviewDetail?.ai_advice?.model_name || '-'}</span>
                            <span className="badge">更新时间：{formatDateTime(resultReviewDetail?.ai_advice?.updated_at)}</span>
                          </div>
                          <pre className="results-ai-advice">{String(resultReviewDetail?.ai_advice?.advice_text || '暂无 AI 建议')}</pre>
                        </div>
                      </section>
                    ) : null}

                    <section className="panel">
                      <div className="panel-header"><h2>逐题卷面</h2></div>
                      <div className="panel-body results-question-stack">
                        {(Array.isArray(resultReviewDetail?.questions) ? resultReviewDetail.questions : []).map((item, idx) => {
                          const review = buildExamQuestionReview({
                            detail: {
                              standard_answer: item.standard_answer,
                              user_answer: item.user_answer,
                              is_correct: item.is_correct,
                              earned_score: item.earned_score,
                              points: item.points,
                              explanation: item.explanation,
                            },
                            questionType: item.question_type,
                            options: item.options,
                          })
                          return (
                            <div className="exam-box" key={`review-question-${item.question_id}`}>
                              <div className="row-actions">
                                <strong>{idx + 1}. {item.stem || '-'}</strong>
                                <span className="badge">{questionTypeLabel(item.question_type)} · {Number(item.points || 0)}分</span>
                                <span className={`status-chip ${item.is_correct ? 'good' : 'warn'}`}>
                                  {item.is_correct ? '回答正确' : '回答错误'}
                                </span>
                              </div>
                              {review ? (
                                <div className="exam-answer-review">
                                  <div className="exam-answer-review-head">
                                    <strong>作答回顾</strong>
                                    <span className="badge">本题得分 {review.scoreText}</span>
                                  </div>
                                  <div className="exam-answer-review-line">
                                    <label>你的作答</label>
                                    <div>{review.userAnswerText}</div>
                                  </div>
                                  <div className="exam-answer-review-line">
                                    <label>标准答案</label>
                                    <div>{review.standardAnswerText}</div>
                                  </div>
                                  {review.explanation ? (
                                    <div className="exam-answer-review-line">
                                      <label>解析</label>
                                      <div>{review.explanation}</div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  </>
                ) : null}
              </>
            ) : !isBasicUser && resultCenterTab === 'results' && resultCenterView.type === 'papers' ? (
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>试卷成绩总览</h2>
                    <div className="sub">只显示已发布试卷，点进试卷后查看每个人的考试结果。</div>
                  </div>
                  <button className="ghost" type="button" onClick={() => fetchAdminResultPapers()} disabled={adminResultPapersLoading}>
                    {adminResultPapersLoading ? '刷新中...' : '刷新试卷'}
                  </button>
                </div>
                <div className="panel-body table-wrap">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>试卷</th>
                        <th>考试次数</th>
                        <th>参考人数</th>
                        <th>最终成绩数</th>
                        <th>平均分</th>
                        <th>通过率</th>
                        <th>超时用户</th>
                        <th>评级分布</th>
                        <th>最近考试</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminResultPapersLoading && !adminResultPaperOverview.items.length ? (
                        <tr><td colSpan={10}>试卷成绩加载中...</td></tr>
                      ) : adminResultPaperOverview.items.length ? adminResultPaperOverview.items.map((item) => {
                        const distribution = item.rating_distribution || {}
                        return (
                          <tr key={`result-paper-overview-${item.paper_id}`}>
                            <td>
                              <div>{item.paper_name || `试卷#${item.paper_id}`}</div>
                              <div className="sub">ID：{item.paper_id}</div>
                            </td>
                            <td>{Number(item.result_total || 0)}</td>
                            <td>{Number(item.candidate_total || 0)}</td>
                            <td>{Number(item.final_result_count || 0)}</td>
                            <td>{Number(item.average_score || 0).toFixed(2)}</td>
                            <td>{formatPercentText(item.pass_rate || 0)}</td>
                            <td>
                              <button className="ghost" type="button" onClick={() => fetchAdminExamTimeoutRecords(item)}>
                                {Number(item.timeout_count || 0)}
                              </button>
                            </td>
                            <td>
                              <div className="rating-distribution">
                                {['A', 'B', 'C', 'D'].map((level) => (
                                  <span className={`rating-chip rating-${level.toLowerCase()}`} key={`paper-${item.paper_id}-rating-${level}`}>
                                    {level} {Number(distribution[level] || 0)}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>{formatDateTime(item.latest_result_at)}</td>
                            <td>
                              <button className="primary" type="button" onClick={() => onOpenPaperResults(item)}>查看成绩</button>
                            </td>
                          </tr>
                        )
                      }) : (
                        <tr><td colSpan={10}>暂无已发布试卷</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {adminExamTimeoutRecords.paper ? (
                  <div className="panel-body table-wrap">
                    <div className="panel-header inline">
                      <h3>超时用户</h3>
                      <div className="sub">{adminExamTimeoutRecords.paper.paper_name || `试卷#${adminExamTimeoutRecords.paper.paper_id}`}</div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>用户</th>
                          <th>试卷</th>
                          <th>发布时间</th>
                          <th>截止时间</th>
                          <th>记录时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminExamTimeoutRecords.loading ? (
                          <tr><td colSpan={5}>超时用户加载中...</td></tr>
                        ) : adminExamTimeoutRecords.items.length ? adminExamTimeoutRecords.items.map((item) => (
                          <tr key={`exam-timeout-${item.id}`}>
                            <td>{item.username || `用户#${item.user_id}`}</td>
                            <td>{item.paper_name || `试卷#${item.paper_id}`}</td>
                            <td>{formatDateTime(item.paper_published_at)}</td>
                            <td>{formatDateTime(item.deadline_at)}</td>
                            <td>{formatDateTime(item.updated_at || item.created_at)}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={5}>暂无超时用户</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ) : !isBasicUser && resultCenterTab === 'results' && resultCenterView.type === 'candidate' ? (
              <>
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>考生记录</h2>
                      <div className="sub">查看该考生的历史考试结果与卷面详情。</div>
                    </div>
                    <div className="row-actions">
                      <button className="ghost" type="button" onClick={onBackToResultCenter}>返回结果列表</button>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => fetchCandidateRecord(resultCenterView.userId, { page: candidateRecord.page, limit: candidateRecord.limit })}
                        disabled={candidateRecordLoading}
                      >
                        {candidateRecordLoading ? '刷新中...' : '刷新记录'}
                      </button>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="results-detail-hero">
                      <div className="results-detail-overview">
                        <div className="results-detail-title">
                          <strong>{candidateRecord?.candidate?.username || `用户 #${resultCenterView.userId}`}</strong>
                          <span className="badge">用户 #{resultCenterView.userId}</span>
                        </div>
                        <div className="row-actions">
                          <span className="badge">部门：{candidateRecord?.candidate?.department || '-'}</span>
                          <span className="badge">岗位：{candidateRecord?.candidate?.position_title || '-'}</span>
                          <span className="badge">最近考试：{formatDateTime(candidateRecord?.summary?.latest_exam_at)}</span>
                        </div>
                      </div>
                      <div className="results-score-card compact">
                        <span>平均分</span>
                        <strong>{Number(candidateRecord?.summary?.average_score || 0).toFixed(2)}</strong>
                        <div>共 {Number(candidateRecord?.summary?.total_results || 0)} 次考试</div>
                      </div>
                    </div>
                    <div className="metric-grid results-detail-metrics">
                      <div className="metric">
                        <label>总考试数</label>
                        <strong>{Number(candidateRecord?.summary?.total_results || 0)}</strong>
                      </div>
                      <div className="metric">
                        <label>通过次数</label>
                        <strong>{Number(candidateRecord?.summary?.pass_count || 0)}</strong>
                      </div>
                      <div className="metric">
                        <label>最终成绩数</label>
                        <strong>{Number(candidateRecord?.summary?.final_result_count || 0)}</strong>
                      </div>
                      <div className="metric">
                        <label>当前页</label>
                        <strong>{Number(candidateRecord?.page || 1)} / {Number(candidateRecord?.total_pages || 1)}</strong>
                      </div>
                      <div className="metric">
                        <label>综合评分</label>
                        <strong>{Number(candidateRecord?.overall_evaluation?.overall_score || 0).toFixed(2)}</strong>
                      </div>
                      <div className="metric">
                        <label>综合评级</label>
                        <strong>{formatRatingText(candidateRecord?.overall_evaluation?.rating_level)}</strong>
                      </div>
                      <div className="metric">
                        <label>考试均分率</label>
                        <strong>{formatPercentText(candidateRecord?.overall_evaluation?.exam_average_rate)}</strong>
                      </div>
                      <div className="metric">
                        <label>评价依据</label>
                        <strong>{Number(candidateRecord?.overall_evaluation?.exam_count || 0)} 场</strong>
                      </div>
                    </div>
                    {candidateRecord?.overall_evaluation?.evaluation_text ? (
                      <div className="results-ai-advice">
                        <strong>综合评价</strong>
                        <p>{candidateRecord.overall_evaluation.evaluation_text}</p>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-header"><h2>历史考试记录</h2></div>
                  <div className="panel-body table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>结果ID</th>
                          <th>试卷</th>
                          <th>考试时间</th>
                          <th>得分</th>
                          <th>评级</th>
                          <th>用时</th>
                          <th>第几次考试</th>
                          <th>考试结果</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidateRecordLoading && !candidateRecord.items.length ? (
                          <tr><td colSpan={9}>考生记录加载中...</td></tr>
                        ) : candidateRecord.items.length ? candidateRecord.items.map((item) => (
                          <tr key={`candidate-result-${item.id}`}>
                            <td>{item.id}</td>
                            <td>{item.paper_name || item.paper_id}</td>
                            <td>{formatDateTime(item.created_at)}</td>
                            <td>{Number(item.score || 0).toFixed(2)} / {Number(item.total_score || 0).toFixed(2)}</td>
                            <td><span className={`rating-chip rating-${formatRatingText(item.rating_level).toLowerCase()}`}>{formatRatingText(item.rating_level)}</span></td>
                            <td>{formatDurationText(item.duration_seconds)}</td>
                            <td>{item.attempt_no}</td>
                            <td><span className={`status-chip ${Number(item.passed || 0) === 1 ? 'good' : 'warn'}`}>{Number(item.passed || 0) === 1 ? '通过' : '未通过'}</span></td>
                            <td>
                              <div className="row-actions">
                                <button className="ghost" type="button" onClick={() => onOpenResultReviewDetail(item.id, { from: 'candidate', userId: item.user_id })}>查看卷面</button>
                                {isAdminRole && Number(item.paper_id || 0) > 0 ? (
                                  <>
                                    <button
                                      className="ghost"
                                      type="button"
                                      disabled={adminResultActionPendingId === `grant-${Number(item.user_id || 0)}-${Number(item.paper_id || 0)}`}
                                      onClick={() => onGrantRetakeOpportunity(item)}
                                    >
                                      开放补考
                                    </button>
                                    <button
                                      className="danger"
                                      type="button"
                                      disabled={adminResultActionPendingId === `delete-${Number(item.id || 0)}`}
                                      onClick={() => onDeleteAdminResult(item)}
                                    >
                                      删除成绩
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={9}>当前筛选下没有可查看的考试记录</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel-body question-pagination">
                    <div className="row-actions">
                      <span className="badge">共 {candidateRecord.total} 条</span>
                      <span className="badge">第 {candidateRecord.page} / {candidateRecord.total_pages} 页</span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="ghost"
                        type="button"
                        disabled={candidateRecordLoading || Number(candidateRecord.page || 1) <= 1}
                        onClick={() => fetchCandidateRecord(resultCenterView.userId, {
                          page: Math.max(1, Number(candidateRecord.page || 1) - 1),
                          limit: candidateRecord.limit,
                        })}
                      >
                        上一页
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        disabled={candidateRecordLoading || Number(candidateRecord.page || 1) >= Number(candidateRecord.total_pages || 1)}
                        onClick={() => fetchCandidateRecord(resultCenterView.userId, {
                          page: Math.min(Number(candidateRecord.total_pages || 1), Number(candidateRecord.page || 1) + 1),
                          limit: candidateRecord.limit,
                        })}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </section>
              </>
            ) : !isBasicUser && resultCenterTab === 'results' ? (
              <>
                <section className="panel">
                  <div className="panel-header">
                    <h2>筛选条件</h2>
                    <div className="row-actions">
                      <button
                        className="ghost"
                        type="button"
                        onClick={async () => {
                          const nextFilters = {
                            keyword: '',
                            user_id: '',
                            paper_id: '',
                            passed: 'all',
                            final_only: false,
                            date_from: '',
                            date_to: '',
                          }
                          setAdminResultsFilters(nextFilters)
                          await fetchAdminResults(false, { page: 1, filters: nextFilters })
                        }}
                        disabled={adminResultsLoading}
                      >
                        清空筛选
                      </button>
                      <button
                        className="primary"
                        type="button"
                        onClick={() => fetchAdminResults(false, { page: 1 })}
                        disabled={adminResultsLoading}
                      >
                        {adminResultsLoading ? '查询中...' : '应用筛选'}
                      </button>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="results-filter-grid">
                      <div>
                        <label>关键词</label>
                        <input
                          value={adminResultsFilters.keyword}
                          onChange={(e) => setAdminResultsFilters((prev) => ({ ...prev, keyword: e.target.value }))}
                          placeholder="考生、部门、试卷"
                        />
                      </div>
                      <div>
                        <label>考生</label>
                        <select value={adminResultsFilters.user_id} onChange={(e) => setAdminResultsFilters((prev) => ({ ...prev, user_id: e.target.value }))}>
                          <option value="">全部考生</option>
                          {adminResultUsers.map((item) => (
                            <option key={`result-user-${item.user_id}`} value={String(item.user_id)}>
                              {item.username || `用户#${item.user_id}`}{item.user_department ? `｜${item.user_department}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label>试卷</label>
                        <select value={adminResultsFilters.paper_id} onChange={(e) => setAdminResultsFilters((prev) => ({ ...prev, paper_id: e.target.value }))}>
                          <option value="">全部试卷</option>
                          {adminResultPapers.map((item) => (
                            <option key={`result-paper-${item.paper_id}`} value={String(item.paper_id)}>
                              {item.paper_name || `试卷#${item.paper_id}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label>考试结果</label>
                        <select value={adminResultsFilters.passed} onChange={(e) => setAdminResultsFilters((prev) => ({ ...prev, passed: e.target.value }))}>
                          <option value="all">全部</option>
                          <option value="passed">通过</option>
                          <option value="failed">未通过</option>
                        </select>
                      </div>
                      <div>
                        <label>开始日期</label>
                        <input type="date" value={adminResultsFilters.date_from} onChange={(e) => setAdminResultsFilters((prev) => ({ ...prev, date_from: e.target.value }))} />
                      </div>
                      <div>
                        <label>结束日期</label>
                        <input type="date" value={adminResultsFilters.date_to} onChange={(e) => setAdminResultsFilters((prev) => ({ ...prev, date_to: e.target.value }))} />
                      </div>
                      <label className="results-filter-check">
                        <input
                          type="checkbox"
                          checked={!!adminResultsFilters.final_only}
                          onChange={(e) => setAdminResultsFilters((prev) => ({ ...prev, final_only: e.target.checked }))}
                        />
                        <span>只看最终成绩</span>
                      </label>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-header"><h2>当前筛选摘要</h2></div>
                  <div className="panel-body metric-grid">
                    <div className="metric">
                      <label>总考试数</label>
                      <strong>{Number(adminResultsSummary.total_results || 0)}</strong>
                    </div>
                    <div className="metric">
                      <label>通过率</label>
                      <strong>{formatPercentText(adminResultsSummary.pass_rate || 0)}</strong>
                    </div>
                    <div className="metric">
                      <label>平均分</label>
                      <strong>{Number(adminResultsSummary.average_score || 0).toFixed(2)}</strong>
                    </div>
                    <div className="metric">
                      <label>平均用时</label>
                      <strong>{formatDurationText(adminResultsSummary.average_duration_seconds)}</strong>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-header"><h2>考试结果列表</h2></div>
                  <div className="panel-body table-wrap">
                    <table className="results-table">
                      <thead>
                        <tr>
                          <th>结果ID</th>
                          <th>考生</th>
                          <th>试卷</th>
                          <th>考试时间</th>
                          <th>得分</th>
                          <th>评级</th>
                          <th>用时</th>
                          <th>错题数</th>
                          <th>第几次考试</th>
                          <th>是否最终</th>
                          <th>考试结果</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminResultsLoading && !adminResults.length ? (
                          <tr><td colSpan={12}>考试结果加载中...</td></tr>
                        ) : adminResults.length ? adminResults.map((item) => (
                          <tr key={`admin-result-${item.id}`}>
                            <td>{item.id}</td>
                            <td>
                              <div>{item.username || '-'}</div>
                              <div className="sub">{item.user_department || '-'}</div>
                            </td>
                            <td>{item.paper_name || item.paper_id}</td>
                            <td>{formatDateTime(item.created_at)}</td>
                            <td>{Number(item.score || 0).toFixed(2)} / {Number(item.total_score || 0).toFixed(2)}</td>
                            <td><span className={`rating-chip rating-${formatRatingText(item.rating_level).toLowerCase()}`}>{formatRatingText(item.rating_level)}</span></td>
                            <td>{formatDurationText(item.duration_seconds)}</td>
                            <td>{item.wrong_count}</td>
                            <td>{item.attempt_no}</td>
                            <td>{Number(item.is_final || 0) === 1 ? '是' : '否'}</td>
                            <td><span className={`status-chip ${Number(item.passed || 0) === 1 ? 'good' : 'warn'}`}>{Number(item.passed || 0) === 1 ? '通过' : '未通过'}</span></td>
                            <td>
                              <div className="row-actions">
                                <button className="ghost" type="button" onClick={() => onOpenResultReviewDetail(item.id, { from: 'list', userId: item.user_id })}>查看卷面</button>
                                <button className="ghost" type="button" onClick={() => onOpenCandidateRecord(item.user_id, { silent: true })}>查看考生记录</button>
                                {isAdminRole && Number(item.paper_id || 0) > 0 ? (
                                  <>
                                    <button
                                      className="ghost"
                                      type="button"
                                      disabled={adminResultActionPendingId === `grant-${Number(item.user_id || 0)}-${Number(item.paper_id || 0)}`}
                                      onClick={() => onGrantRetakeOpportunity(item)}
                                    >
                                      开放补考
                                    </button>
                                    <button
                                      className="danger"
                                      type="button"
                                      disabled={adminResultActionPendingId === `delete-${Number(item.id || 0)}`}
                                      onClick={() => onDeleteAdminResult(item)}
                                    >
                                      删除成绩
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={12}>当前条件下没有考试结果</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel-body question-pagination">
                    <div className="row-actions">
                      <span className="badge">共 {adminResultsPagination.total} 条</span>
                      <span className="badge">第 {adminResultsPagination.page} / {adminResultsPagination.totalPages} 页</span>
                      <label className="row-actions">
                        <span>每页</span>
                        <select
                          value={adminResultsPagination.limit}
                          onChange={(e) => fetchAdminResults(false, { page: 1, limit: Number(e.target.value || 20) })}
                          disabled={adminResultsLoading}
                        >
                          <option value="20">20</option>
                          <option value="50">50</option>
                          <option value="100">100</option>
                        </select>
                      </label>
                    </div>
                    <div className="row-actions">
                      <button
                        className="ghost"
                        type="button"
                        disabled={adminResultsLoading || adminResultsPagination.page <= 1}
                        onClick={() => fetchAdminResults(false, { page: Math.max(1, adminResultsPagination.page - 1) })}
                      >
                        上一页
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        disabled={adminResultsLoading || adminResultsPagination.page >= adminResultsPagination.totalPages}
                        onClick={() => fetchAdminResults(false, { page: Math.min(adminResultsPagination.totalPages, adminResultsPagination.page + 1) })}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </section>
              </>
            ) : !isBasicUser ? (
              <>
                <section className="panel">
                  <div className="panel-header">
                    <h2>证书模板</h2>
                    <div className="row-actions">
                      <button className="ghost" type="button" onClick={() => fetchCertificateTemplate()} disabled={certTemplateUploading || certTemplateDeleting}>刷新模板</button>
                    </div>
                  </div>
                  <div className="panel-body cert-template-panel">
                    <div className="cert-template-form">
                      <div className="cert-template-meta">
                        <span className="badge">{certTemplate?.exists ? '已配置模板' : '未配置模板'}</span>
                        <span className="badge">来源：{certTemplate?.source === 'uploaded' ? 'Web上传' : certTemplate?.source === 'env' ? '环境变量' : '默认样式'}</span>
                        {certTemplate?.exists ? <span className="badge">文件：{certTemplate.file_name || '-'}</span> : null}
                        {certTemplate?.exists ? <span className="badge">大小：{Math.max(0, Number(certTemplate.size_bytes || 0))} B</span> : null}
                      </div>
                      <div className="sub">支持 png/jpg/jpeg。上传后立即生效，新生成证书会自动套用该模板。</div>
                      <div className="row-actions">
                        <input
                          key={`cert-template-file-${certTemplateInputKey}`}
                          type="file"
                          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                          onChange={(e) => setCertTemplateFile(e.target.files?.[0] || null)}
                          disabled={!canWrite || certTemplateUploading || certTemplateDeleting}
                        />
                        <button
                          className="primary"
                          type="button"
                          onClick={onUploadCertificateTemplate}
                          disabled={!canWrite || certTemplateUploading || certTemplateDeleting || !certTemplateFile}
                        >
                          {certTemplateUploading ? '上传中...' : '上传模板'}
                        </button>
                        <button
                          className="danger"
                          type="button"
                          onClick={onDeleteCertificateTemplate}
                          disabled={!canWrite || certTemplateDeleting || certTemplateUploading || !certTemplate?.can_delete}
                        >
                          {certTemplateDeleting ? '删除中...' : '删除模板'}
                        </button>
                      </div>
                      {!canWrite ? <div className="empty-tip">当前账号仅可预览模板，不能上传或删除。</div> : null}
                    </div>
                    <div className="cert-template-preview-wrap">
                      {certTemplate?.exists && certTemplatePreviewUrl ? (
                        <img className="cert-template-preview" src={certTemplatePreviewUrl} alt="证书模板预览" />
                      ) : (
                        <div className="cert-template-empty">当前未上传模板，将使用系统默认证书背景。</div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="grid-2">
                  <div className="panel">
                    <div className="panel-header"><h2>证书有效期</h2></div>
                    <div className="panel-body table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>证书号</th>
                            <th>试卷</th>
                            <th>状态</th>
                            <th>有效期至</th>
                            <th>剩余天数</th>
                            <th>提醒</th>
                          </tr>
                        </thead>
                        <tbody>
                          {myCertificates.length ? myCertificates.map((c) => (
                            <tr key={`cert-${c.id}`}>
                              <td>{c.certificate_no}</td>
                              <td>{c.paper_name || c.paper_id}</td>
                              <td><span className={`status-chip ${c.status === 'active' ? 'good' : 'warn'}`}>{certStatusLabel(c.status)}</span></td>
                              <td>{formatDateTime(c.valid_until)}</td>
                              <td>{c.days_left}</td>
                              <td>{c.should_remind ? '需复考提醒' : '-'}</td>
                            </tr>
                          )) : <tr><td colSpan={6}>暂无证书</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-header"><h2>续证任务</h2></div>
                    <div className="panel-body table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>试卷</th>
                            <th>到期/计划时间</th>
                            <th>状态</th>
                            <th>触发方式</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {myRecertJobs.length ? myRecertJobs.map((job) => (
                            <tr key={`recert-${job.id}`}>
                              <td>{job.id}</td>
                              <td>{job.paper_name || job.paper_id}</td>
                              <td>{formatDateTime(job.due_at)}</td>
                              <td><span className={`status-chip ${job.status === 'completed' ? 'good' : 'warn'}`}>{recertStatusLabel(job.status)}</span></td>
                              <td>{String(job.trigger_type || '').toLowerCase() === 'auto' ? '自动' : '手动'}</td>
                              <td>
                                <div className="row-actions">
                                  {['scheduled', 'in_progress'].includes(String(job.status || '').toLowerCase()) ? (
                                    <button className="primary" type="button" onClick={() => onStartRecertJob(job.id, job.paper_id)}>去复考</button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )) : <tr><td colSpan={6}>暂无续证任务</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="panel">
                  <div className="panel-header"><h2>考试结果列表</h2></div>
                  <div className="panel-body">
                    <div className="metric-grid">
                      <div className="metric">
                        <label>总考试数</label>
                        <strong>{personalResultsSummary.total}</strong>
                      </div>
                      <div className="metric">
                        <label>通过次数</label>
                        <strong>{personalResultsSummary.passCount}</strong>
                      </div>
                      <div className="metric">
                        <label>未通过次数</label>
                        <strong>{personalResultsSummary.failCount}</strong>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-header">
                    <h2>考试结果列表</h2>
                    <div className="row-actions">
                      <button className="ghost" type="button" onClick={onExportMyResults} disabled={myResultsExporting}>
                        {myResultsExporting ? '导出中...' : '导出结果'}
                      </button>
                    </div>
                  </div>
                  <div className="panel-body table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>结果ID</th>
                          <th>试卷</th>
                          <th>第几次考试</th>
                          <th>得分</th>
                          <th>评级</th>
                          <th>考试结果</th>
                          <th>是否最终</th>
                          <th>考试时间</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myResults.length ? myResults.map((r) => (
                          <tr key={`viewer-result-${r.id}`}>
                            <td>{r.id}</td>
                            <td>{paperNameById.get(Number(r.paper_id || 0)) || r.paper_id}</td>
                            <td>{r.attempt_no}</td>
                            <td>{Number(r.score || 0).toFixed(2)} / {Number(r.total_score || 0).toFixed(2)}</td>
                            <td><span className={`rating-chip rating-${formatRatingText(r.rating_level).toLowerCase()}`}>{formatRatingText(r.rating_level)}</span></td>
                            <td><span className={`status-chip ${Number(r.passed || 0) === 1 ? 'good' : 'warn'}`}>{Number(r.passed || 0) === 1 ? '通过' : '未通过'}</span></td>
                            <td>{Number(r.is_final || 0) === 1 ? '是' : '否'}</td>
                            <td>{formatDateTime(r.created_at)}</td>
                            <td>
                              <div className="row-actions">
                                <button className="ghost" type="button" onClick={() => onOpenResultReviewDetail(r.id, { from: 'personal' })}>查看卷面</button>
                              </div>
                            </td>
                          </tr>
                        )) : <tr><td colSpan={9}>还没有可查看的考试结果</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </>
        )}

        {activeMenu === 'student-overall' && role === 'admin' && (
          <>
            <section className="panel student-overall-panel">
              <div className="panel-header">
                <div>
                  <h2>学员总体评价</h2>
                  <div className="sub">按学员汇总考试次数、每次成绩与平均表现，用于培训复盘。</div>
                </div>
                <div className="row-actions">
                  <span className="badge admin-only-badge">仅管理员可见平均分</span>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => fetchStudentOverall()}
                    disabled={studentOverall.loading}
                  >
                    {studentOverall.loading ? '刷新中...' : '刷新'}
                  </button>
                  <button
                    className="primary"
                    type="button"
                    onClick={onExportStudentOverall}
                    disabled={studentOverall.loading || studentOverallRows.length === 0}
                  >
                    导出CSV
                  </button>
                </div>
              </div>
              <div className="panel-body metric-grid">
                <div className="metric">
                  <label>参考学员</label>
                  <strong>{studentOverallSummary.studentCount}</strong>
                </div>
                <div className="metric">
                  <label>考试总次数</label>
                  <strong>{studentOverallSummary.totalAttempts}</strong>
                </div>
                <div className="metric">
                  <label>平均分</label>
                  <strong>{Number(studentOverallSummary.averageScore || 0).toFixed(2)}</strong>
                </div>
                <div className="metric">
                  <label>优秀率</label>
                  <strong>{formatPercentText(studentOverallSummary.excellentRate)}</strong>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>筛选条件</h2>
                <div className="row-actions">
                  <button className="ghost" type="button" onClick={resetStudentOverallFilters} disabled={studentOverall.loading}>
                    清空筛选
                  </button>
                  <button className="primary" type="button" onClick={() => fetchStudentOverall()} disabled={studentOverall.loading}>
                    {studentOverall.loading ? '查询中...' : '查询'}
                  </button>
                </div>
              </div>
              <div className="panel-body">
                <div className="student-overall-filter-grid">
                  <div>
                    <label>关键词</label>
                    <input
                      value={studentOverall.filters.keyword}
                      onChange={(e) => updateStudentOverallFilters({ keyword: e.target.value })}
                      placeholder="搜索学员/部门"
                    />
                  </div>
                  <div>
                    <label>部门</label>
                    <select
                      value={studentOverall.filters.department}
                      onChange={(e) => updateStudentOverallFilters({ department: e.target.value })}
                    >
                      <option value="all">全部部门</option>
                      {studentOverallDepartments.map((department) => (
                        <option value={department} key={`student-overall-dept-${department}`}>{department}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>总体评价</label>
                    <select
                      value={studentOverall.filters.evaluation}
                      onChange={(e) => updateStudentOverallFilters({ evaluation: e.target.value })}
                    >
                      <option value="all">全部评价</option>
                      <option value="优秀">优秀</option>
                      <option value="良好">良好</option>
                      <option value="需加强">需加强</option>
                      <option value="重点跟进">重点跟进</option>
                    </select>
                  </div>
                  <div>
                    <label>时间范围</label>
                    <select
                      value={studentOverall.filters.range}
                      onChange={(e) => updateStudentOverallFilters({ range: e.target.value })}
                    >
                      <option value="30">近30天</option>
                      <option value="90">近90天</option>
                      <option value="365">近一年</option>
                      <option value="all">全部时间</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>学员评价明细</h2>
                  <div className="sub">展示每名学员的考试次数、各次分数、平均分与总体评价。</div>
                </div>
                <span className="badge">当前 {studentOverallRows.length} 人</span>
              </div>
              <div className="panel-body table-wrap">
                <table className="results-table student-overall-table">
                  <thead>
                    <tr>
                      <th>学员</th>
                      <th>部门/岗位</th>
                      <th>考试次数</th>
                      <th>最近考试</th>
                      <th>各次分数</th>
                      <th>平均分</th>
                      <th>总体评价</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentOverall.loading && !studentOverallRows.length ? (
                      <tr><td colSpan={8}>学员总体评价加载中...</td></tr>
                    ) : studentOverallRows.length ? studentOverallRows.map((item) => (
                      <tr key={`student-overall-${item.key}`}>
                        <td>
                          <div>{item.username}</div>
                          <div className="sub">用户 #{item.user_id || '-'}</div>
                        </td>
                        <td>
                          <div>{item.department}</div>
                          <div className="sub">{item.position}</div>
                        </td>
                        <td>{item.total}</td>
                        <td>{formatDateTime(item.latestExamAt)}</td>
                        <td>
                          <div className="student-score-chips">
                            {item.attempts.map((attempt) => (
                              <span className="score-chip" title={`${attempt.paperName}｜${formatDateTime(attempt.createdAt)}`} key={`student-score-${item.key}-${attempt.id}`}>
                                {attempt.score.toFixed(2)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td><strong className="student-average-score">{Number(item.averageScore || 0).toFixed(2)}</strong></td>
                        <td>
                          <span className={`student-evaluation-chip ${item.evaluation.className}`}>{item.evaluation.label}</span>
                          <div className="sub">{item.evaluation.detail}</div>
                        </td>
                        <td>
                          <button
                            className="ghost"
                            type="button"
                            disabled={!item.user_id}
                            onClick={() => onOpenCandidateRecord(item.user_id, { silent: true })}
                          >
                            查看明细
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8}>暂无符合条件的学员评价数据</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeMenu === 'ai-models' && !isBasicUser && canViewAiConfig && (
          <>
            <section className="panel ai-config-panel">
              <div className="panel-header ai-config-panel-header">
                <h2>大模型配置中心</h2>
                <button className="ghost" type="button" onClick={() => fetchAiConfigCenter()}>
                  刷新配置
                </button>
              </div>
              <div className="panel-body ai-config-overview">
                <div className="metric">
                  <label>模型总数</label>
                  <strong>{aiModelOverview.total}</strong>
                </div>
                <div className="metric">
                  <label>已启用</label>
                  <strong>{aiModelOverview.enabled}</strong>
                </div>
                <div className="metric">
                  <label>已停用</label>
                  <strong>{aiModelOverview.disabled}</strong>
                </div>
                <div className="metric metric-wide">
                  <label>当前默认模型</label>
                  <strong>{aiModelOverview.defaultName}</strong>
                </div>
                <div className="ai-provider-strip">
                  {(aiModelOverview.providers || []).length ? aiModelOverview.providers.map((provider) => (
                    <span key={`provider-${provider}`} className="badge">{provider}</span>
                  )) : <span className="empty-tip">暂无模型提供方</span>}
                </div>
              </div>

              <div className="panel-body ai-config-shell">
                <form onSubmit={onSaveOssSettings} className="ai-config-form-card">
                  <div className="ai-card-title">
                    <h3>阿里云 OSS</h3>
                    <p>用于培训视频直传、签名播放和系统内强制观看。</p>
                  </div>

                  <div className="form-grid ai-form-grid">
                    <div className="full ai-switch-row">
                      <label className="ai-switch">
                        <input
                          type="checkbox"
                          checked={!!ossSettingsForm.enabled}
                          onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                          disabled={ossSettingsLoading || ossSettingsSaving}
                        />
                        启用 OSS 受管视频
                      </label>
                      <span className={`status-chip ${ossSettingsStatus.configured ? 'good' : 'warn'}`}>
                        {!ossSettingsForm.enabled ? '已关闭' : ossSettingsStatus.configured ? '已就绪' : '待补全'}
                      </span>
                    </div>
                    <div><label>Region</label><input value={ossSettingsForm.region} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, region: e.target.value }))} placeholder="oss-cn-hangzhou" disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>Bucket</label><input value={ossSettingsForm.bucket} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, bucket: e.target.value }))} placeholder="train-exam-video" disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>Endpoint（可选）</label><input value={ossSettingsForm.endpoint} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, endpoint: e.target.value }))} placeholder="留空则按 region 走默认 endpoint" disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>AccessKey ID</label><input value={ossSettingsForm.access_key_id} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, access_key_id: e.target.value }))} placeholder="LTAI..." disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>AccessKey Secret</label><input type="password" value={ossSettingsForm.access_key_secret} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, access_key_secret: e.target.value }))} placeholder={ossSettingsStatus.has_access_key_secret ? '保持 ****** 表示沿用，清空表示移除' : '输入新的 AccessKey Secret'} disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>STS Token（可选）</label><input type="password" value={ossSettingsForm.sts_token} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, sts_token: e.target.value }))} placeholder={ossSettingsStatus.has_sts_token ? '保持 ****** 表示沿用，清空表示移除' : '临时凭证场景可填写'} disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>上传签名有效期(秒)</label><input type="number" value={ossSettingsForm.signed_upload_expires_seconds} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, signed_upload_expires_seconds: e.target.value }))} disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>播放签名有效期(秒)</label><input type="number" value={ossSettingsForm.signed_play_expires_seconds} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, signed_play_expires_seconds: e.target.value }))} disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div><label>上传大小上限(MB)</label><input type="number" value={ossSettingsForm.upload_max_file_size_mb} onChange={(e) => setOssSettingsForm((prev) => ({ ...prev, upload_max_file_size_mb: e.target.value }))} disabled={ossSettingsLoading || ossSettingsSaving} /></div>
                    <div className={`full ai-model-test-note ${!ossSettingsForm.enabled || ossSettingsStatus.configured ? 'ok' : 'err'}`}>
                      {ossSettingsForm.enabled
                        ? (ossSettingsStatus.configured
                          ? '当前配置完整，后续培训视频可直接选“阿里云 OSS”进行受管上传。'
                          : `配置尚未完整：${ossSettingsStatus.validation_error || '请补全 Bucket、Region 和凭证信息'}`)
                        : '当前为关闭状态，培训视频仍会按本地上传处理。'}
                    </div>
                    <div className="full row-actions">
                      <button className="ghost" type="button" onClick={() => fetchOssSettings()} disabled={ossSettingsLoading || ossSettingsSaving}>重新读取</button>
                      <button className="primary" type="submit" disabled={!isAdminRole || ossSettingsSaving || ossSettingsLoading}>
                        {ossSettingsSaving ? '保存中...' : '保存 OSS 配置'}
                      </button>
                    </div>
                  </div>
                </form>

                <form onSubmit={onCreateAiModel} className="ai-config-form-card">
                  <div className="ai-card-title">
                    <h3>新增模型</h3>
                    <p>支持 Kimi / ChatGPT / 豆包 / 兼容 OpenAI 协议的自定义模型。</p>
                  </div>

                  <div className="form-grid ai-form-grid">
                    <div><label>模型标识（model_key）</label><input value={modelForm.model_key} onChange={(e) => setModelForm((p) => ({ ...p, model_key: e.target.value }))} placeholder="custom_model" /></div>
                    <div><label>显示名称</label><input value={modelForm.name} onChange={(e) => setModelForm((p) => ({ ...p, name: e.target.value }))} placeholder="自定义模型" /></div>
                    <div><label>接口地址（Base URL）</label><input value={modelForm.base_url} onChange={(e) => setModelForm((p) => ({ ...p, base_url: e.target.value }))} placeholder="https://api.example.com/v1" /></div>
                    <div><label>模型名</label><input value={modelForm.model_name} onChange={(e) => setModelForm((p) => ({ ...p, model_name: e.target.value }))} placeholder="gpt-4o-mini" /></div>
                    <div><label>密钥（API Key）</label><input type="password" value={modelForm.api_key} onChange={(e) => setModelForm((p) => ({ ...p, api_key: e.target.value }))} placeholder="可后续再设置" /></div>
                    <div><label>最大 tokens</label><input type="number" value={modelForm.max_tokens} onChange={(e) => setModelForm((p) => ({ ...p, max_tokens: e.target.value }))} /></div>
                    <div><label>超时(ms)</label><input type="number" value={modelForm.timeout_ms} onChange={(e) => setModelForm((p) => ({ ...p, timeout_ms: e.target.value }))} /></div>
                    <div><label>温度</label><input type="number" step="0.1" value={modelForm.temperature_default} onChange={(e) => setModelForm((p) => ({ ...p, temperature_default: e.target.value }))} /></div>
                    <div className="full ai-switch-row">
                      <label className="ai-switch"><input type="checkbox" checked={!!modelForm.is_enabled} onChange={(e) => setModelForm((p) => ({ ...p, is_enabled: e.target.checked }))} /> 启用模型</label>
                      <label className="ai-switch"><input type="checkbox" checked={!!modelForm.is_default} onChange={(e) => setModelForm((p) => ({ ...p, is_default: e.target.checked }))} /> 新增后设为默认</label>
                    </div>
                    <div className="full row-actions">
                      <button
                        className="ghost"
                        type="button"
                        disabled={!isAdminRole || aiModelDraftTestPending}
                        onClick={onTestAiModelDraft}
                      >
                        {aiModelDraftTestPending ? '测试中...' : '测试配置'}
                      </button>
                      <button className="primary" type="submit" disabled={!isAdminRole}>新增模型</button>
                    </div>
                    {aiModelDraftTestResult ? (
                      <div className={`full ai-model-test-note ai-model-draft-test-note ${
                        Number(aiModelDraftTestResult?.available || 0) === 1 || aiModelDraftTestResult?.available === true ? 'ok' : 'err'
                      }`}>
                        <strong>新增配置测试结果：</strong>
                        {Number(aiModelDraftTestResult?.available || 0) === 1 || aiModelDraftTestResult?.available === true ? ' 可用' : ' 不可用'}
                        {Number(aiModelDraftTestResult?.latency_ms || 0) > 0 ? ` · 耗时 ${Math.max(0, Number(aiModelDraftTestResult.latency_ms || 0))}ms` : ''}
                        {aiModelDraftTestResult?.checked_at ? ` · 时间 ${formatDateTime(aiModelDraftTestResult.checked_at)}` : ''}
                        {aiModelDraftTestResult?.available ? (
                          aiModelDraftTestResult?.reply_preview ? ` · 回复预览：${String(aiModelDraftTestResult.reply_preview).trim()}` : ''
                        ) : (
                          ` · 原因：${String(aiModelDraftTestResult?.error_message || '请检查接口地址、模型名和密钥').trim()}`
                        )}
                      </div>
                    ) : null}
                  </div>
                </form>

                <div className="ai-model-list-card">
                  <div className="ai-card-title">
                    <h3>模型列表</h3>
                    <p>可设置默认、启停，也可直接编辑或删除模型。</p>
                  </div>
                  <div className="ai-model-grid">
                    {aiModels.length ? aiModels.map((model) => {
                      const modelId = Number(model.id || 0)
                      const isDefault = Number(model.is_default || 0) === 1
                      const isEnabled = Number(model.is_enabled || 0) === 1
                      const testResult = aiModelTestResults?.[modelId] || null
                      const tested = !!testResult
                      const available = Number(testResult?.available || 0) === 1 || testResult?.available === true
                      return (
                        <article
                          key={`ai-model-${model.id}`}
                          className={`ai-model-card${isDefault ? ' is-default' : ''}${isEnabled ? ' is-enabled' : ' is-disabled'}`}
                        >
                          <div className="ai-model-card-head">
                            <div className="ai-model-title-wrap">
                              <strong>{model.name}</strong>
                              <div className="sub">{model.model_key} · {model.model_name}</div>
                            </div>
                            <div className="ai-model-tags">
                              <span className={`status-chip ${isEnabled ? 'good' : 'warn'}`}>{isEnabled ? '启用' : '停用'}</span>
                              {isDefault ? <span className="badge">默认</span> : null}
                              {tested ? (
                                <span className={`status-chip ${available ? 'good' : 'warn'}`}>{available ? '可用' : '不可用'}</span>
                              ) : (
                                <span className="badge">未测试</span>
                              )}
                            </div>
                          </div>
                          <div className="ai-model-meta">
                            <span>ID：{model.id}</span>
                            <span>最大tokens：{Number(model.max_tokens || 0)}</span>
                            <span>接口：{model.base_url || '-'}</span>
                            <span>密钥：{model.api_key || '-'}</span>
                            <span>最近测试：{tested ? formatDateTime(testResult?.checked_at) : '-'}</span>
                            <span>耗时：{tested ? `${Math.max(0, Number(testResult?.latency_ms || 0))}ms` : '-'}</span>
                          </div>
                          {tested ? (
                            <div className={`ai-model-test-note ${available ? 'ok' : 'err'}`}>
                              {available
                                ? `测试成功：${String(testResult?.reply_preview || '模型可正常响应').trim() || '模型可正常响应'}`
                                : `测试失败：${String(testResult?.error_message || '请检查接口地址、模型名或密钥').trim()}`}
                            </div>
                          ) : null}
                          <div className="row-actions ai-model-action-row">
                            <button className="ghost" type="button" disabled={!isAdminRole || isDefault} onClick={() => onSetDefaultAiModel(model.id)}>设为默认</button>
                            <button
                              className={isEnabled ? 'warn' : 'primary'}
                              type="button"
                              disabled={!isAdminRole}
                              onClick={() => onToggleAiModelEnabled(model.id, !isEnabled)}
                            >
                              {isEnabled ? '停用模型' : '启用模型'}
                            </button>
                            <button
                              className="ghost"
                              type="button"
                              disabled={!isAdminRole || aiModelTestPendingId === modelId}
                              onClick={() => onTestAiModel(model)}
                            >
                              {aiModelTestPendingId === modelId ? '测试中...' : '测试模型'}
                            </button>
                            <button className="ghost" type="button" disabled={!isAdminRole} onClick={() => onOpenAiModelEdit(model)}>编辑模型</button>
                            <button
                              className="danger"
                              type="button"
                              disabled={!isAdminRole || aiModelDeletePendingId === Number(model.id)}
                              onClick={() => onDeleteAiModel(model)}
                            >
                              {aiModelDeletePendingId === Number(model.id) ? '删除中...' : '删除模型'}
                            </button>
                          </div>
                        </article>
                      )
                    }) : (
                      <div className="ai-empty-state">暂无模型配置，请先在上方新增模型。</div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {activeMenu === 'audit' && !isBasicUser && canAudit && (
          <>
            <section className="panel">
              <div className="panel-header"><h2>部门/岗位画像维护</h2></div>
              <div className="panel-body grid-2">
                <form onSubmit={onSaveUserProfile} className="form-grid">
                  <div><label>用户ID</label><input value={profileForm.user_id} onChange={(e) => setProfileForm((p) => ({ ...p, user_id: e.target.value }))} /></div>
                  <div><label>用户名</label><input value={profileForm.username} onChange={(e) => setProfileForm((p) => ({ ...p, username: e.target.value }))} /></div>
                  <div><label>部门</label><input value={profileForm.department} onChange={(e) => setProfileForm((p) => ({ ...p, department: e.target.value }))} /></div>
                  <div><label>岗位</label><input value={profileForm.position_title} onChange={(e) => setProfileForm((p) => ({ ...p, position_title: e.target.value }))} /></div>
                  <div className="full row-actions">
                    <button className="primary" type="submit" disabled={!canWrite}>保存画像</button>
                    <button className="ghost" type="button" onClick={() => fetchUserProfiles()}>刷新列表</button>
                  </div>
                </form>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>用户ID</th>
                        <th>用户名</th>
                        <th>部门</th>
                        <th>岗位</th>
                        <th>更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userProfiles.length ? userProfiles.map((row) => (
                        <tr key={`profile-${row.id}`}>
                          <td>{row.user_id}</td>
                          <td>{row.username}</td>
                          <td>{row.department || '未分配'}</td>
                          <td>{row.position_title || '未分配'}</td>
                          <td>{formatDateTime(row.updated_at)}</td>
                        </tr>
                      )) : <tr><td colSpan={5}>暂无画像数据</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>操作审计日志</h2></div>
              <div className="panel-body table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>用户</th>
                      <th>动作</th>
                      <th>实体</th>
                      <th>消息</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length ? auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{log.id}</td>
                        <td>{log.username}</td>
                        <td>{auditActionLabel(log.action)}</td>
                        <td>{auditEntityLabel(log.entity)}</td>
                        <td>{log.message}</td>
                        <td>{formatDateTime(log.created_at)}</td>
                      </tr>
                    )) : <tr><td colSpan={6}>暂无审计日志</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h2>AI任务日志</h2></div>
              <div className="panel-body table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>任务类型</th>
                      <th>状态</th>
                      <th>耗时(ms)</th>
                      <th>操作者</th>
                      <th>错误</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiLogs.length ? aiLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{log.id}</td>
                        <td>{aiTaskTypeLabel(log.task_type)}</td>
                        <td>{aiLogStatusLabel(log.status)}</td>
                        <td>{log.latency_ms || 0}</td>
                        <td>{log.operator_name}</td>
                        <td>{log.error_message || '-'}</td>
                        <td>{formatDateTime(log.created_at)}</td>
                      </tr>
                    )) : <tr><td colSpan={7}>暂无AI日志</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {isCourseLearningModalOpen ? (
          <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) closeCourseLearningModal() }}>
            <div
              className={`course-learning-modal ${courseLearningModal.maximized ? 'maximized' : ''}`}
              style={{
                left: `${courseLearningModal.left}px`,
                top: `${courseLearningModal.top}px`,
                width: `${courseLearningModal.width}px`,
                height: `${courseLearningModal.height}px`,
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="course-learning-modal-heading"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="course-learning-modal-header" onPointerDown={onCourseLearningHeaderPointerDown}>
                <div className="course-learning-modal-title">
                  <strong id="course-learning-modal-heading">{currentLearningCourseTitle}</strong>
                  <p>学习路径与章节完成度</p>
                </div>
                <div className="row-actions course-learning-modal-actions">
                  <select
                    aria-label="切换当前课程"
                    value={learningCourseId}
                    onChange={(e) => { void fetchLearningPath(e.target.value, true) }}
                  >
                    {(courses || []).map((item) => (
                      <option key={`learning-course-modal-${item.id}`} value={item.id}>{item.title}</option>
                    ))}
                  </select>
                  <button className="ghost" type="button" onClick={onToggleCourseLearningMaximize}>
                    {courseLearningModal.maximized ? '还原窗口' : '铺满窗口'}
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      if (learningCourseId) void fetchLearningPath(learningCourseId)
                      void fetchMyLearningProgress(true)
                    }}
                  >
                    刷新路径
                  </button>
                  <button className="ghost" type="button" onClick={closeCourseLearningModal}>关闭</button>
                </div>
              </div>
              <div className="course-learning-modal-scroll">
                {renderCourseLearningModalBody()}
              </div>
              {!courseLearningModal.maximized ? (
                <div
                  className="course-learning-modal-resizer"
                  onPointerDown={onCourseLearningResizePointerDown}
                  role="button"
                  tabIndex={0}
                  aria-label="调整课程学习弹窗大小"
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {instructorReviewScheduleDialog ? (
          <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCloseInstructorReviewScheduleDialog() }}>
            <div className="modal-card paper-schedule-modal">
              <div className="modal-header">
                <div>
                  <p className="section-kicker">讲师评价</p>
                  <h3>定时发布问卷</h3>
                </div>
                <button className="ghost" type="button" onClick={onCloseInstructorReviewScheduleDialog} disabled={instructorReviewScheduleSaving}>关闭</button>
              </div>
              <form className="modal-body form-grid" onSubmit={onSubmitInstructorReviewSchedule}>
                <div className="full schedule-paper-name">
                  <label>问卷</label>
                  <input value={instructorReviewScheduleDialog.title || `#${instructorReviewScheduleDialog.id}`} readOnly />
                </div>
                <div>
                  <label>发布日期</label>
                  <input
                    type="date"
                    value={instructorReviewScheduleForm.date}
                    onChange={(e) => setInstructorReviewScheduleForm((prev) => ({ ...prev, date: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label>发布时间</label>
                  <input
                    type="time"
                    value={instructorReviewScheduleForm.time}
                    onChange={(e) => setInstructorReviewScheduleForm((prev) => ({ ...prev, time: e.target.value }))}
                    required
                  />
                </div>
                <div className="full schedule-publish-tip">
                  设置后问卷进入“待发布”状态，到达所选时间后自动发布。未到时间前，普通用户不会看到该讲师评价问卷。
                </div>
                <div className="full row-actions paper-schedule-actions">
                  <button className="ghost" type="button" onClick={onCloseInstructorReviewScheduleDialog} disabled={instructorReviewScheduleSaving}>取消</button>
                  <button className="primary" type="submit" disabled={instructorReviewScheduleSaving}>
                    {instructorReviewScheduleSaving ? '保存中...' : '确认定时发布'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {paperScheduleDialog ? (
          <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClosePaperScheduleDialog() }}>
            <div className="modal-card paper-schedule-modal">
              <div className="modal-header">
                <div>
                  <p className="section-kicker">试卷发布</p>
                  <h3>定时发布试卷</h3>
                </div>
                <button className="ghost" type="button" onClick={onClosePaperScheduleDialog} disabled={paperScheduleSaving}>关闭</button>
              </div>
              <form className="modal-body form-grid" onSubmit={onSubmitPaperSchedule}>
                <div className="full schedule-paper-name">
                  <label>试卷</label>
                  <input value={paperScheduleDialog.name || `#${paperScheduleDialog.id}`} readOnly />
                </div>
                <div>
                  <label>发布日期</label>
                  <input
                    type="date"
                    value={paperScheduleForm.date}
                    onChange={(e) => setPaperScheduleForm((prev) => ({ ...prev, date: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label>发布时间</label>
                  <input
                    type="time"
                    value={paperScheduleForm.time}
                    onChange={(e) => setPaperScheduleForm((prev) => ({ ...prev, time: e.target.value }))}
                    required
                  />
                </div>
                <div className="full schedule-publish-tip">
                  设置后试卷进入“待发布”状态，到达所选时间后自动发布。未到时间前，普通考生不会看到该试卷。
                </div>
                <div className="full row-actions paper-schedule-actions">
                  <button className="ghost" type="button" onClick={onClosePaperScheduleDialog} disabled={paperScheduleSaving}>取消</button>
                  <button className="primary" type="submit" disabled={paperScheduleSaving}>
                    {paperScheduleSaving ? '保存中...' : '确认定时发布'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {aiModelEditVisible ? (
          <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAiModelEditModal() }}>
            <div className="modal-card">
              <div className="modal-header">
                <h3>编辑模型 #{editingAiModelId}</h3>
                <button className="ghost" type="button" onClick={closeAiModelEditModal} disabled={aiModelEditSaving}>关闭</button>
              </div>
              <form className="modal-body form-grid" onSubmit={onSubmitAiModelEdit}>
                <div>
                  <label>模型标识</label>
                  <input value={String(currentEditingAiModel?.model_key || '-')} readOnly />
                </div>
                <div>
                  <label>显示名称</label>
                  <input value={aiModelEditForm.name} onChange={(e) => setAiModelEditForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label>接口地址（Base URL）</label>
                  <input value={aiModelEditForm.base_url} onChange={(e) => setAiModelEditForm((p) => ({ ...p, base_url: e.target.value }))} />
                </div>
                <div>
                  <label>模型名</label>
                  <input value={aiModelEditForm.model_name} onChange={(e) => setAiModelEditForm((p) => ({ ...p, model_name: e.target.value }))} />
                </div>
                <div>
                  <label>最大 tokens</label>
                  <input type="number" value={aiModelEditForm.max_tokens} onChange={(e) => setAiModelEditForm((p) => ({ ...p, max_tokens: e.target.value }))} />
                </div>
                <div>
                  <label>密钥（API Key）</label>
                  <input type="password" value={aiModelEditForm.api_key} onChange={(e) => setAiModelEditForm((p) => ({ ...p, api_key: e.target.value }))} placeholder="留空则保持原值" />
                </div>
                <div className="full row-actions">
                  <label className="ai-switch">
                    <input type="checkbox" checked={!!aiModelEditForm.is_enabled} onChange={(e) => setAiModelEditForm((p) => ({ ...p, is_enabled: e.target.checked }))} />
                    启用模型
                  </label>
                  <label className="ai-switch">
                    <input type="checkbox" checked={!!aiModelEditForm.is_default} onChange={(e) => setAiModelEditForm((p) => ({ ...p, is_default: e.target.checked }))} />
                    设为默认
                  </label>
                </div>
                <div className="full row-actions">
                  <button className="primary" type="submit" disabled={aiModelEditSaving}>
                    {aiModelEditSaving ? '保存中...' : '保存修改'}
                  </button>
                  <button className="ghost" type="button" onClick={closeAiModelEditModal} disabled={aiModelEditSaving}>取消</button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {resourceEditVisible ? (
          <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) closeResourceEditModal() }}>
            <div className="modal-card">
              <div className="modal-header">
                <h3>编辑资源 #{editingResourceId}</h3>
                <button className="ghost" type="button" onClick={closeResourceEditModal} disabled={resourceEditSaving}>关闭</button>
              </div>
              <form className="modal-body form-grid" onSubmit={onSubmitResourceEdit}>
                <div className="full">
                  <label>资源名称</label>
                  <input value={resourceEditForm.name} onChange={(e) => setResourceEditForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label>资源类型</label>
                  <select
                    value={resourceEditForm.resource_type}
                    onChange={(e) => setResourceEditForm((p) => ({
                      ...p,
                      resource_type: e.target.value,
                      storage_backend: normalizeResourceStorageBackend({
                        resourceType: e.target.value,
                        sourceMode: p.source_mode,
                        storageBackend: p.storage_backend,
                      }),
                      force_watch: e.target.value === 'video' ? p.force_watch : false,
                    }))}
                  >
                    <option value="doc">文档</option>
                    <option value="video">视频</option>
                    <option value="link">外链</option>
                  </select>
                </div>
                <div>
                  <label>来源模式</label>
                  <select
                    value={resourceEditForm.source_mode}
                    onChange={(e) => setResourceEditForm((p) => ({
                      ...p,
                      source_mode: e.target.value,
                      storage_backend: normalizeResourceStorageBackend({
                        resourceType: p.resource_type,
                        sourceMode: e.target.value,
                        storageBackend: p.storage_backend,
                      }),
                      force_watch: e.target.value === 'upload' ? p.force_watch : false,
                    }))}
                  >
                    <option value="upload">上传</option>
                    <option value="external">外链</option>
                  </select>
                </div>
                {resourceEditForm.resource_type === 'video' && resourceEditForm.source_mode === 'upload' ? (
                  <div>
                    <label>存储位置</label>
                    <select
                      value={resourceEditForm.storage_backend}
                      onChange={(e) => setResourceEditForm((p) => ({
                        ...p,
                        storage_backend: normalizeResourceStorageBackend({
                          resourceType: p.resource_type,
                          sourceMode: p.source_mode,
                          storageBackend: e.target.value,
                        }),
                      }))}
                    >
                      <option value="local">本地</option>
                      <option value="oss">阿里云 OSS</option>
                    </select>
                  </div>
                ) : null}
                <div>
                  <label>章节顺序</label>
                  <input type="number" value={resourceEditForm.sort_order} onChange={(e) => setResourceEditForm((p) => ({ ...p, sort_order: e.target.value }))} />
                </div>
                <div className="row-actions">
                  {resourceEditForm.resource_type === 'video' && resourceEditForm.source_mode === 'upload' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={!!resourceEditForm.force_watch}
                        onChange={(e) => setResourceEditForm((p) => ({ ...p, force_watch: e.target.checked }))}
                      />
                      {' '}
                      强制播放（禁止快进）
                    </label>
                  ) : (
                    <span className="badge">仅上传视频可配置强制播放</span>
                  )}
                </div>
                {resourceEditForm.source_mode === 'external' ? (
                  <div className="full">
                    <label>外链URL</label>
                    <input value={resourceEditForm.source_url} onChange={(e) => setResourceEditForm((p) => ({ ...p, source_url: e.target.value }))} />
                  </div>
                ) : (
                  <div className="full sub">切换为“上传”后，请在培训资源区域重新上传文件；若选阿里云 OSS，则上传标准 MP4。</div>
                )}
                <div className="full row-actions">
                  <button className="primary" type="submit" disabled={resourceEditSaving}>
                    {resourceEditSaving ? '保存中...' : '保存资源'}
                  </button>
                  <button className="ghost" type="button" onClick={closeResourceEditModal} disabled={resourceEditSaving}>取消</button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {isDocPreviewOpen && docPreviewPayload?.editor ? (
          <div className="doc-preview-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) { void closeDocPreviewModal() } }}>
            <div
              className={`doc-preview-modal ${docPreviewModal.maximized ? 'maximized' : ''}`}
              style={{
                left: `${docPreviewModal.left}px`,
                top: `${docPreviewModal.top}px`,
                width: `${docPreviewModal.width}px`,
                height: `${docPreviewModal.height}px`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="doc-preview-modal-header" onPointerDown={onDocPreviewHeaderPointerDown}>
                <div className="doc-preview-title">
                  <strong>文档在线学习：{docPreviewResource?.name || selectedLearningResource?.name || '-'}</strong>
                  <div className="row-actions">
                    <span className="badge">Office预览服务：{docPreviewScriptReady ? '可用' : '加载中'}</span>
                    <span className="badge">学习阈值：{Math.max(15, Number(docPreviewMinSeconds || DOC_PREVIEW_MIN_SECONDS_DEFAULT))} 秒</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="ghost" type="button" onClick={onToggleDocPreviewFullscreen}>全屏展示</button>
                  <button className="ghost" type="button" onClick={onToggleDocPreviewMaximize}>
                    {docPreviewModal.maximized ? '还原窗口' : '铺满窗口'}
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => window.open(`/api/train-exam/resources/${Number(docPreviewResource?.id || selectedLearningResource?.id || 0)}/download`, '_blank')}
                  >
                    下载文档
                  </button>
                  <button className="danger" type="button" onClick={() => { void closeDocPreviewModal() }}>关闭并记录</button>
                </div>
              </div>
              <div className="doc-preview-modal-body">
                {docPreviewScriptError ? <div className="learning-player-notice">{docPreviewScriptError}</div> : null}
                {docPreviewNotice ? <div className="learning-player-notice">{docPreviewNotice}</div> : null}
                <div className="doc-preview-stage" ref={docPreviewStageRef}>
                  <div id={docPreviewContainerId} className="doc-preview-container" />
                </div>
              </div>
              {!docPreviewModal.maximized ? (
                <div
                  className="doc-preview-modal-resizer"
                  onPointerDown={onDocPreviewResizePointerDown}
                  role="button"
                  tabIndex={0}
                  aria-label="调整文档窗口大小"
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {isLearningPlayerOpen && selectedLearningResource && String(selectedLearningResource.resource_type || '').toLowerCase() === 'video' ? (
          <div className="player-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) closeLearningPlayerModal() }}>
            <div
              className={`player-modal ${learningPlayerModal.maximized ? 'maximized' : ''}`}
              style={{
                left: `${learningPlayerModal.left}px`,
                top: `${learningPlayerModal.top}px`,
                width: `${learningPlayerModal.width}px`,
                height: `${learningPlayerModal.height}px`,
              }}
            >
              <div className="player-modal-header" onPointerDown={onLearningPlayerHeaderPointerDown}>
                <div className="player-modal-title">
                  <strong>视频播放器：{selectedLearningResource.name}</strong>
                  <div className="row-actions">
                    <span className="badge">{learningVideoStatusLabel}</span>
                    {(String(selectedLearningResource.transcode_status || '').toLowerCase() === 'queued' || String(selectedLearningResource.transcode_status || '').toLowerCase() === 'running')
                      ? <span className="badge">后台转码中 {Math.max(0, Math.min(100, Number(selectedLearningResource.transcode_progress || 0)))}%</span>
                      : null}
                    <span className="badge">已看 {learningVideoRuntimePercent}%</span>
                    <span className="badge">{formatPlaybackClock(videoRuntime.current)} / {formatPlaybackClock(videoRuntime.duration)}</span>
                    <span className="badge">剩余 {formatPlaybackRemainingLabel(learningVideoRemainingSeconds)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="ghost" type="button" onClick={onToggleLearningPlayerFullscreen}>全屏展示</button>
                  <button className="ghost" type="button" onClick={onToggleLearningPlayerMaximize}>
                    {learningPlayerModal.maximized ? '还原窗口' : '铺满窗口'}
                  </button>
                  <button className="danger" type="button" onClick={closeLearningPlayerModal}>关闭</button>
                </div>
              </div>
              <div className="player-modal-body">
                {learningPlayerNotice ? <div className="learning-player-notice">{learningPlayerNotice}</div> : null}
                {String(selectedLearningResource.source_mode || '').toLowerCase() === 'external' ? (
                  <a className="ghost" href={selectedLearningResource.source_url || '#'} target="_blank" rel="noreferrer">打开外链视频</a>
                ) : (
                  <div className="player-video-stack">
                    <video
                      key={`learning-video-${selectedLearningResource.id}-${selectedLearningResource.updated_at || ''}`}
                      ref={learningVideoRef}
                      className="learning-video modal-video"
                      src={`/api/train-exam/resources/${selectedLearningResource.id}/stream?v=${encodeURIComponent(String(selectedLearningResource.updated_at || selectedLearningResource.id || ''))}`}
                      preload="metadata"
                      controls={!learningVideoSeekLocked}
                      controlsList={learningVideoSeekLocked ? 'nodownload noplaybackrate noremoteplayback' : 'nodownload noremoteplayback'}
                      disablePictureInPicture
                      onLoadedMetadata={(e) => onLearningVideoLoadedMetadata(selectedLearningResource, e)}
                      onPlay={onLearningVideoPlay}
                      onPause={onLearningVideoPause}
                      onRateChange={(e) => onLearningVideoRateChange(selectedLearningResource, e)}
                      onSeeking={(e) => onLearningVideoSeeking(selectedLearningResource, e)}
                      onTimeUpdate={(e) => { onLearningVideoTimeUpdate(selectedLearningResource, e) }}
                      onEnded={(e) => { onLearningVideoEnded(selectedLearningResource, e) }}
                      onError={(e) => onLearningVideoError(selectedLearningResource, e)}
                    />
                    <div className="player-session-progress" aria-hidden="true">
                      <div className="player-session-progress-track">
                        <span style={{ width: `${learningVideoRuntimePercent}%` }} />
                      </div>
                      <div className="player-session-progress-meta">
                        <span>{formatPlaybackClock(videoRuntime.current)} / {formatPlaybackClock(videoRuntime.duration)}</span>
                        <strong>已看 {learningVideoRuntimePercent}%</strong>
                        <span>剩余 {formatPlaybackRemainingLabel(learningVideoRemainingSeconds)}</span>
                      </div>
                    </div>
                    <div className="row-actions player-volume-bar">
                      <label htmlFor="learning-player-volume">音量</label>
                      <input
                        id="learning-player-volume"
                        type="range"
                        min="0"
                        max="100"
                        value={learningPlayerVolume}
                        onChange={(e) => onChangeLearningPlayerVolume(e.target.value)}
                      />
                      <span className="badge">{learningPlayerVolume}%</span>
                      {String(selectedLearningResource.transcode_status || '').toLowerCase() === 'queued' || String(selectedLearningResource.transcode_status || '').toLowerCase() === 'running' ? (
                        <span className="badge">视频正在后台转码，请稍后开始播放</span>
                      ) : (
                        <div className="player-playback-actions">
                          <button className="ghost player-replay-action" type="button" onClick={onReplayLearningVideo}>
                            重看本章
                          </button>
                          {learningVideoSeekLocked ? (
                            <button className="primary" type="button" onClick={onToggleLearningVideoPlay}>
                              {videoRuntime.playing ? '暂停播放' : '开始播放'}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {!learningPlayerModal.maximized ? (
                <div
                  className="player-modal-resizer"
                  onPointerDown={onLearningPlayerResizePointerDown}
                  role="button"
                  tabIndex={0}
                  aria-label="调整播放器窗口大小"
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

export default App

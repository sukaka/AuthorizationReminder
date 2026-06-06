const viteEnv = import.meta.env || {}
const API_BASE = viteEnv.VITE_API_BASE || ''
const SSO_LOGIN_URL = viteEnv.VITE_SSO_LOGIN_URL || 'http://localhost:5180/portal?system=sca'
const GATEWAY_ERROR_STATUSES = new Set([502, 503, 504])

export const apiUrl = (path) => `${API_BASE}${path}`

const redirectToLogin = () => {
  const target = new URL(SSO_LOGIN_URL, window.location.origin)
  target.searchParams.set('redirect', window.location.href)
  window.location.href = target.toString()
}

const parseMaybeJson = (text) => {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const responsePreview = (text) => String(text || '').slice(0, 300)

const gatewayMessage = (status) => {
  if (status === 504) {
    return 'SCA API 请求超时，可能是后端任务执行过久、代理超时或服务不可用，请检查后端日志和代理配置。'
  }
  return `SCA API 网关或后端不可用(${status})，请检查后端服务状态和代理配置。`
}

const nonJsonResponseMessage = (status) =>
  GATEWAY_ERROR_STATUSES.has(status)
    ? gatewayMessage(status)
    : `服务返回了非 JSON 响应(${status})，可能是前端代理或后端服务异常，请刷新页面或检查 SCA API 服务状态。`

const buildHttpError = ({ url, status, contentType, responseText, data, fallbackMessage }) => {
  const preview = responsePreview(responseText)
  const message = data?.message || data?.detail || data?.error || (GATEWAY_ERROR_STATUSES.has(status)
    ? gatewayMessage(status)
    : fallbackMessage || `请求失败(${status})`)
  const error = new Error(message)
  error.url = url
  error.status = status
  error.statusCode = status
  error.contentType = contentType || ''
  error.responseText = preview
  error.data = data || null
  error.isGatewayError = GATEWAY_ERROR_STATUSES.has(status)
  return error
}

const logApiError = (error) => {
  console.error('[SCA API] request failed', {
    url: error.url || '',
    status: error.status || 0,
    contentType: error.contentType || '',
    responseText: error.responseText || '',
    message: error.message || '',
    gateway: Boolean(error.isGatewayError),
  })
}

export const requestJson = async (path, options = {}) => {
  const url = `${API_BASE}${path}`
  let response
  try {
    response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    })
  } catch (err) {
    const error = buildHttpError({
      url: path,
      status: 0,
      contentType: '',
      responseText: err?.message || '',
      fallbackMessage: '网络请求失败，请检查 SCA API 服务或网络连接。',
    })
    logApiError(error)
    throw error
  }

  if (response.status === 401) {
    redirectToLogin()
    return null
  }

  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const data = isJson ? parseMaybeJson(text) : null
  if (!response.ok) {
    const error = buildHttpError({
      url: path,
      status: response.status,
      contentType,
      responseText: text,
      data,
      fallbackMessage: isJson ? `请求失败(${response.status})` : nonJsonResponseMessage(response.status),
    })
    logApiError(error)
    throw error
  }
  if (text && !data && !isJson) {
    const error = buildHttpError({
      url: path,
      status: response.status,
      contentType,
      responseText: text,
      fallbackMessage: nonJsonResponseMessage(response.status),
    })
    logApiError(error)
    throw error
  }
  return data
}

const sendWithProgress = ({ method, path, body, headers = {}, onProgress }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, `${API_BASE}${path}`, true)
    xhr.withCredentials = true
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        redirectToLogin()
        resolve(null)
        return
      }
      const url = path
      const contentType = xhr.getResponseHeader('content-type') || ''
      const isJson = contentType.includes('application/json')
      const data = parseMaybeJson(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data)
        return
      }
      const error = buildHttpError({
        url,
        status: xhr.status,
        contentType,
        responseText: xhr.responseText,
        data: isJson ? data : null,
        fallbackMessage: isJson ? `请求失败(${xhr.status})` : nonJsonResponseMessage(xhr.status),
      })
      logApiError(error)
      reject(error)
    }
    xhr.onerror = () => {
      const error = buildHttpError({
        url: path,
        status: xhr.status || 0,
        contentType: xhr.getResponseHeader?.('content-type') || '',
        responseText: xhr.responseText || '',
        fallbackMessage: '网络请求失败，请检查 SCA API 服务或网络连接。',
      })
      logApiError(error)
      reject(error)
    }
    xhr.send(body)
  })

const ensureFileSizeAllowed = (file, maxUploadSizeMb) => {
  const limitMb = Number(maxUploadSizeMb || 0)
  if (!file || !Number.isFinite(limitMb) || limitMb <= 0) return
  const limitBytes = limitMb * 1024 * 1024
  if (file.size > limitBytes) {
    throw new Error(`文件超过系统配置的上传大小上限：${limitMb} MB`)
  }
}

export const uploadArchiveWithProgress = ({ file, projectName, scanNote, maxUploadSizeMb, onProgress }) => {
  ensureFileSizeAllowed(file, maxUploadSizeMb)
  const formData = new FormData()
  formData.append('project_name', projectName)
  formData.append('scan_note', scanNote || '')
  formData.append('file', file)
  return sendWithProgress({
    method: 'POST',
    path: '/api/sca/uploads',
    body: formData,
    onProgress,
  })
}

export const resumableUploadWithProgress = async ({ file, projectName, scanNote, maxUploadSizeMb, onProgress }) => {
  ensureFileSizeAllowed(file, maxUploadSizeMb)
  const chunkSize = 512 * 1024
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize))
  const session = await requestJson('/api/sca/uploads/sessions', {
    method: 'POST',
    body: JSON.stringify({
      project_name: projectName,
      scan_note: scanNote || '',
      filename: file.name,
      total_size: file.size,
      total_chunks: totalChunks,
    }),
  })
  if (!session) return null
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize
    const end = Math.min(file.size, start + chunkSize)
    await sendWithProgress({
      method: 'PUT',
      path: `/api/sca/uploads/${session.upload_id}/chunks/${index}`,
      body: file.slice(start, end),
    })
    if (typeof onProgress === 'function') {
      onProgress(Math.round(((index + 1) / totalChunks) * 100))
    }
  }
  return requestJson(`/api/sca/uploads/${session.upload_id}/complete`, { method: 'POST' })
}

export const uploadImageTarWithProgress = ({ file, scanner, onProgress }) => {
  const formData = new FormData()
  formData.append('scanner', scanner || 'trivy')
  formData.append('file', file)
  return sendWithProgress({
    method: 'POST',
    path: '/api/sca/image-scans/tar',
    body: formData,
    onProgress,
  })
}

export { redirectToLogin }

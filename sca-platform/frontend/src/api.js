const API_BASE = import.meta.env.VITE_API_BASE || ''
const SSO_LOGIN_URL = import.meta.env.VITE_SSO_LOGIN_URL || 'http://localhost:5180/portal?system=sca'

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

const nonJsonResponseMessage = (status) =>
  `服务返回了非 JSON 响应(${status})，可能是前端代理或后端服务异常，请刷新页面或检查 SCA API 服务状态。`

export const requestJson = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (response.status === 401) {
    redirectToLogin()
    return null
  }

  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  const data = parseMaybeJson(text)
  if (text && !data && !contentType.includes('application/json')) {
    throw new Error(nonJsonResponseMessage(response.status))
  }
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `请求失败(${response.status})`)
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
      const data = parseMaybeJson(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data)
        return
      }
      reject(new Error(data?.detail || data?.error || `请求失败(${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('网络请求失败'))
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

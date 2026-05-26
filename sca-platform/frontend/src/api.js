const API_BASE = import.meta.env.VITE_API_BASE || ''
const SSO_LOGIN_URL = import.meta.env.VITE_SSO_LOGIN_URL || 'http://localhost:5180/login?system=sca'

const redirectToLogin = () => {
  const target = new URL(SSO_LOGIN_URL, window.location.origin)
  target.searchParams.set('redirect', window.location.href)
  window.location.href = target.toString()
}

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
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `请求失败(${response.status})`)
  }
  return data
}

export { redirectToLogin }

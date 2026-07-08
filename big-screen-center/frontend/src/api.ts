import { navigateToUnifiedLogin } from './preview-data'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const redirectToLoginOnUnauthorized = () => {
  if (typeof window === 'undefined') return
  if (new URLSearchParams(window.location.search).get('mock') === '1') return
  navigateToUnifiedLogin(window.location.href)
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith('/api/big-screen/')) {
    throw new Error('Big-screen API paths must remain same-origin')
  }
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => ({})) as {
    error?: string
  }
  if (!response.ok) {
    if (response.status === 401) redirectToLoginOnUnauthorized()
    throw new ApiError(payload.error || '大屏服务请求失败', response.status)
  }
  return payload as T
}

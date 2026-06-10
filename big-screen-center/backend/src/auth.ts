import { config } from './config.js'
import type { SystemKey } from './contracts.js'

export type ScreenRole = 'viewer' | 'operator' | 'designer' | 'sysadmin'

export const roleCapabilities: Record<ScreenRole, ReadonlySet<string>> = {
  viewer: new Set(['catalog:read', 'screen:play']),
  operator: new Set(['catalog:read', 'screen:play', 'playlist:write']),
  designer: new Set(['catalog:read', 'screen:play', 'playlist:write', 'template:draft', 'template:publish']),
  sysadmin: new Set(['catalog:read', 'screen:play', 'playlist:write', 'template:draft', 'template:publish', 'source:admin']),
}

const sourceSystems: readonly SystemKey[] = ['sca', 'train-exam', 'reminder']

export class AuthError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface AuthRequest {
  headers: Headers | Record<string, string | string[] | undefined>
}

export interface AuthorizedUser {
  id: number
  username: string
  role: string
}

export interface AuthorizationContext {
  user: AuthorizedUser
  apps: string[]
  allowedSystems: SystemKey[]
  screenRole: ScreenRole
  scope: Record<string, unknown>
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

const headerValue = (headers: AuthRequest['headers'], name: string) => {
  if (headers instanceof Headers) return headers.get(name) || ''
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== expected) continue
    return Array.isArray(value) ? value[0] || '' : value || ''
  }
  return ''
}

export const extractBearerToken = (authorization: string | undefined) => {
  const match = String(authorization || '').trim().match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

export const extractCookieToken = (cookieHeader: string | undefined) => {
  for (const item of String(cookieHeader || '').split(';')) {
    const separator = item.indexOf('=')
    if (separator <= 0) continue
    if (item.slice(0, separator).trim() !== config.auth.cookieName) continue
    try {
      return decodeURIComponent(item.slice(separator + 1).trim())
    } catch {
      return ''
    }
  }
  return ''
}

export const mapUnifiedRole = (role: string | undefined): ScreenRole => {
  const normalized = String(role || '').trim().toLowerCase()
  if (normalized in roleCapabilities) return normalized as ScreenRole
  if (normalized === 'admin') return 'sysadmin'
  if (normalized === 'editor') return 'designer'
  if (normalized === 'reviewer') return 'operator'
  return 'viewer'
}

export const hasCapability = (role: string | undefined, capability: string) =>
  roleCapabilities[mapUnifiedRole(role)].has(capability)

const fetchIntrospection = async (token: string, fetchImpl: FetchLike) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.auth.timeoutMs)
  try {
    const response = await fetchImpl(
      `${config.auth.serviceUrl}/api/auth/introspect`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    )
    if (!response.ok) throw new AuthError('登录已过期', 401)
    const text = await response.text()
    if (text.length > 65_536) throw new AuthError('统一登录返回异常', 401)
    try {
      return text ? JSON.parse(text) as Record<string, unknown> : {}
    } catch {
      throw new AuthError('统一登录返回异常', 401)
    }
  } catch (error) {
    if (error instanceof AuthError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AuthError('统一登录服务超时', 503)
    }
    throw new AuthError('统一登录服务不可用', 503)
  } finally {
    clearTimeout(timeout)
  }
}

export const authorizeRequest = async (
  request: AuthRequest,
  fetchImpl: FetchLike = fetch,
): Promise<AuthorizationContext> => {
  const token = extractBearerToken(headerValue(request.headers, 'authorization'))
    || extractCookieToken(headerValue(request.headers, 'cookie'))
  if (!token) throw new AuthError('请先登录', 401)

  const payload = await fetchIntrospection(token, fetchImpl)
  const rawUser = payload.user as Record<string, unknown> | undefined
  const apps = Array.isArray(payload.apps)
    ? payload.apps.filter((item): item is string => typeof item === 'string')
    : []
  const userId = Number(rawUser?.id)
  const username = String(rawUser?.username || '').trim()
  if (!Number.isSafeInteger(userId) || userId <= 0 || !username) {
    throw new AuthError('登录状态无效', 401)
  }
  if (!apps.includes(config.auth.systemKey)) {
    throw new AuthError('无权限访问统一大屏展示中心', 403)
  }

  const role = String(rawUser?.role || '').trim().toLowerCase()
  return {
    user: { id: userId, username, role },
    apps,
    allowedSystems: sourceSystems.filter((systemKey) => apps.includes(systemKey)),
    screenRole: mapUnifiedRole(role),
    scope: payload.scope && typeof payload.scope === 'object'
      ? payload.scope as Record<string, unknown>
      : {},
  }
}

import type { SystemKey } from '../types'

export interface BuildBusinessDetailInput {
  systemKey: SystemKey
  detailPath: string
  currentHref: string
  context: Record<string, unknown>
}

export type BusinessDetailOpener = (
  url: string,
  target: string,
  features: string,
) => unknown

const allowedContextKeys = new Set([
  'metric',
  'dateRange',
  'projectId',
  'category',
])

const configuredOriginKeys: Record<SystemKey, keyof ImportMetaEnv> = {
  sca: 'VITE_SCA_APP_URL',
  'train-exam': 'VITE_TRAIN_EXAM_APP_URL',
  reminder: 'VITE_REMINDER_APP_URL',
}

const localPorts: Record<SystemKey, string> = {
  sca: '18089',
  'train-exam': '18087',
  reminder: '18080',
}

const allowedPaths: Record<SystemKey, ReadonlySet<string>> = {
  sca: new Set(['/']),
  'train-exam': new Set(['/']),
  reminder: new Set(['/']),
}

const isHttpProtocol = (protocol: string) =>
  protocol === 'http:' || protocol === 'https:'

const parseHttpUrl = (value: string) => {
  const url = new URL(value)
  if (!isHttpProtocol(url.protocol)) {
    throw new Error('业务系统地址必须使用 http 或 https')
  }
  return url
}

const configuredOrigin = (systemKey: SystemKey) => {
  const value = import.meta.env[configuredOriginKeys[systemKey]]?.trim()
  if (!value) return null

  try {
    return parseHttpUrl(value).origin
  } catch {
    return null
  }
}

export const resolveBusinessOrigin = (
  systemKey: SystemKey,
  currentHref: string,
) => {
  const configured = configuredOrigin(systemKey)
  if (configured) return configured

  const current = parseHttpUrl(currentHref)
  const hostname = current.hostname.replace(/^\[|\]$/g, '')
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    const local = new URL(current.origin)
    local.port = localPorts[systemKey]
    return local.origin
  }
  return current.origin
}

export const buildBusinessDetailUrl = ({
  systemKey,
  detailPath,
  currentHref,
  context,
}: BuildBusinessDetailInput) => {
  if (!allowedPaths[systemKey].has(detailPath)) {
    throw new Error('业务详情路径不在白名单中')
  }

  const url = new URL(detailPath, resolveBusinessOrigin(systemKey, currentHref))
  for (const [key, value] of Object.entries(context)) {
    if (!allowedContextKeys.has(key)) continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export const openBusinessDetail = (
  input: BuildBusinessDetailInput,
  open?: BusinessDetailOpener,
) => {
  const opener = open ?? (
    typeof window !== 'undefined' && typeof window.open === 'function'
      ? window.open.bind(window)
      : undefined
  )
  if (!opener) return undefined

  return opener(
    buildBusinessDetailUrl(input),
    '_blank',
    'noopener,noreferrer',
  )
}

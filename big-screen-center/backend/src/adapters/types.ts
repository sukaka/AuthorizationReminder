import type {
  DataStatus,
  JsonValue,
  MetricEnvelope,
  SystemKey,
} from '../contracts.js'

export interface AdapterRequestContext {
  cookie?: string
  authorization?: string
  requestId?: string
  cacheScope?: string
}

export interface MetricAdapter {
  systemKey: SystemKey
  getMetric(
    metricKey: string,
    filters: Record<string, JsonValue>,
    context: AdapterRequestContext,
  ): Promise<MetricEnvelope>
}

export interface SourceResult {
  key: string
  data: JsonValue
}

export const createMetricEnvelope = (
  systemKey: SystemKey,
  metricKey: string,
  data: JsonValue,
  options: {
    status?: DataStatus
    unavailableSources?: string[]
    sourceUpdatedAt?: string | null
  } = {},
): MetricEnvelope => ({
  schemaVersion: '1.0',
  systemKey,
  metricKey,
  generatedAt: new Date().toISOString(),
  sourceUpdatedAt: options.sourceUpdatedAt ?? null,
  stale: options.status === 'stale',
  status: options.status || 'ok',
  data,
  unavailableSources: options.unavailableSources || [],
})

const maskEmail = (value: string) => {
  const [local, domain] = value.split('@')
  if (!local || !domain) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}

const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7) return '***'
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

const maskName = (value: string) => {
  const normalized = value.trim()
  return normalized ? `${Array.from(normalized)[0]}**` : ''
}

const sanitizeString = (key: string, value: string) => {
  if (/email/i.test(key)) return maskEmail(value)
  if (/(?:phone|mobile|telephone|tel$)/i.test(key)) return maskPhone(value)
  if (/(?:contact[_-]?name|contact[_-]?person|联系人)/i.test(key)) return maskName(value)
  return value
}

export const sanitizeSensitiveData = (value: unknown, key = ''): JsonValue => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return sanitizeString(key, value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveData(item, key))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeSensitiveData(childValue, childKey),
      ]),
    )
  }
  return String(value)
}

export const collectSourceData = async (
  systemKey: SystemKey,
  metricKey: string,
  sources: Array<{ key: string; load: () => Promise<unknown> }>,
) => {
  const settled = await Promise.allSettled(sources.map(async ({ key, load }) => ({
    key,
    data: sanitizeSensitiveData(await load()),
  })))
  const data: Record<string, JsonValue> = {}
  const unavailableSources: string[] = []

  settled.forEach((result, index) => {
    const sourceKey = sources[index]?.key || `source-${index}`
    if (result.status === 'fulfilled') {
      data[result.value.key] = result.value.data
    } else {
      unavailableSources.push(sourceKey)
    }
  })

  if (unavailableSources.length === sources.length) {
    throw new Error(`${systemKey} metric sources unavailable`)
  }
  return createMetricEnvelope(systemKey, metricKey, data, {
    status: unavailableSources.length ? 'partial' : 'ok',
    unavailableSources,
  })
}

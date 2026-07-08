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

const isRecord = (value: JsonValue): value is Record<string, JsonValue> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const skipMetricKey = (key: string) =>
  /(?:^|_)(?:id|ids|uuid|version|version_no|owner_user_id|published_by)$/i.test(key)

const toMetricKey = (path: string[], used: Set<string>) => {
  const leaf = path[path.length - 1] || 'value'
  const normalizedLeaf = leaf.replace(/[^a-zA-Z0-9_]/g, '_')
  if (!used.has(normalizedLeaf)) return normalizedLeaf
  const normalizedPath = path.join('_').replace(/[^a-zA-Z0-9_]/g, '_') || normalizedLeaf
  if (!used.has(normalizedPath)) return normalizedPath
  let suffix = 2
  while (used.has(`${normalizedPath}_${suffix}`)) suffix += 1
  return `${normalizedPath}_${suffix}`
}

const collectNumericMetrics = (
  value: JsonValue,
  path: string[],
  output: Record<string, JsonValue>,
  used: Set<string>,
) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const key = toMetricKey(path, used)
    if (!skipMetricKey(key)) {
      output[key] = value
      used.add(key)
    }
    return
  }

  if (Array.isArray(value)) {
    const leaf = path[path.length - 1]
    if (leaf && value.length > 0) {
      const countKey = toMetricKey([...path.slice(0, -1), `${leaf}Count`], used)
      output[countKey] = value.length
      used.add(countKey)
    }
    value.slice(0, 8).forEach((item) => collectNumericMetrics(item, path, output, used))
    return
  }

  if (!isRecord(value)) return
  Object.entries(value).forEach(([key, child]) => {
    collectNumericMetrics(child, [...path, key], output, used)
  })
}

const projectScreenMetrics = (sources: Record<string, JsonValue>) => {
  const projected: Record<string, JsonValue> = {}
  const used = new Set<string>()
  Object.values(sources).forEach((value) => collectNumericMetrics(value, [], projected, used))
  return projected
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
  const projectedMetrics = projectScreenMetrics(data)
  return createMetricEnvelope(systemKey, metricKey, { ...projectedMetrics, ...data }, {
    status: unavailableSources.length
      ? 'partial'
      : Object.keys(projectedMetrics).length
        ? 'ok'
        : 'empty',
    unavailableSources,
    sourceUpdatedAt: null,
  })
}

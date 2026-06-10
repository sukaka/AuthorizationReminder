import { createHash } from 'node:crypto'

import {
  createMetricEnvelope,
  type AdapterRequestContext,
  type MetricAdapter,
} from './adapters/types.js'
import { CircuitBreaker } from './circuit-breaker.js'
import type { JsonValue, MetricEnvelope, SystemKey } from './contracts.js'
import type { StoreDatabase } from './store-types.js'

export const metricPolicies = {
  'security-overview': { ttlMs: 30_000, staleMs: 600_000, streamMs: 10_000 },
  'vulnerability-threat': { ttlMs: 60_000, staleMs: 900_000, streamMs: 0 },
  'supply-chain-graph': { ttlMs: 300_000, staleMs: 1_800_000, streamMs: 0 },
  'scan-operations': { ttlMs: 15_000, staleMs: 300_000, streamMs: 10_000 },
  'security-governance': { ttlMs: 300_000, staleMs: 3_600_000, streamMs: 0 },
  'training-overview': { ttlMs: 60_000, staleMs: 900_000, streamMs: 0 },
  'exam-command': { ttlMs: 10_000, staleMs: 120_000, streamMs: 5_000 },
  'organization-capability': { ttlMs: 300_000, staleMs: 1_800_000, streamMs: 0 },
  'training-outcomes': { ttlMs: 300_000, staleMs: 3_600_000, streamMs: 0 },
  'expiry-risk': { ttlMs: 60_000, staleMs: 900_000, streamMs: 0 },
  'delivery-execution': { ttlMs: 15_000, staleMs: 300_000, streamMs: 10_000 },
  'customer-sales': { ttlMs: 300_000, staleMs: 1_800_000, streamMs: 0 },
} as const

export type MetricKey = keyof typeof metricPolicies

export const metricSystems: Record<MetricKey, SystemKey> = {
  'security-overview': 'sca',
  'vulnerability-threat': 'sca',
  'supply-chain-graph': 'sca',
  'scan-operations': 'sca',
  'security-governance': 'sca',
  'training-overview': 'train-exam',
  'exam-command': 'train-exam',
  'organization-capability': 'train-exam',
  'training-outcomes': 'train-exam',
  'expiry-risk': 'reminder',
  'delivery-execution': 'reminder',
  'customer-sales': 'reminder',
}

const stableJson = (value: JsonValue): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key] as JsonValue)}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

export const metricCacheKey = (
  systemKey: SystemKey,
  metricKey: string,
  filters: Record<string, JsonValue>,
  cacheScope = '',
) => {
  const fingerprint = createHash('sha256')
    .update(`${cacheScope}:${stableJson(filters)}`)
    .digest('hex')
  return `${systemKey}:${metricKey}:${fingerprint}`
}

interface CacheEntry {
  envelope: MetricEnvelope
  storedAt: number
}

export class MetricCache {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(private readonly now: () => number = Date.now) {}

  seed(
    key: string,
    envelope: MetricEnvelope,
    options: { ageMs?: number } = {},
  ) {
    this.entries.set(key, {
      envelope: structuredClone(envelope),
      storedAt: this.now() - (options.ageMs || 0),
    })
  }

  set(key: string, envelope: MetricEnvelope) {
    this.entries.set(key, {
      envelope: structuredClone(envelope),
      storedAt: this.now(),
    })
  }

  getFresh(key: string, ttlMs: number) {
    const entry = this.entries.get(key)
    if (!entry || this.now() - entry.storedAt > ttlMs) return null
    return structuredClone(entry.envelope)
  }

  getStale(key: string, staleMs: number) {
    const entry = this.entries.get(key)
    if (!entry || this.now() - entry.storedAt > staleMs) return null
    return structuredClone(entry.envelope)
  }
}

export interface SnapshotStore {
  save(key: string, envelope: MetricEnvelope, staleMs: number): Promise<void>
  load(key: string): Promise<MetricEnvelope | null>
}

interface SnapshotRow {
  envelope_json: string | MetricEnvelope
}

export class MysqlSnapshotStore implements SnapshotStore {
  constructor(private readonly database: StoreDatabase) {}

  async save(key: string, envelope: MetricEnvelope, staleMs: number) {
    const expiresAt = new Date(Date.now() + staleMs)
    await this.database.run(
      `INSERT INTO metric_snapshots
        (cache_key, envelope_json, source_updated_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         envelope_json = VALUES(envelope_json),
         source_updated_at = VALUES(source_updated_at),
         expires_at = VALUES(expires_at),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [key, JSON.stringify(envelope), envelope.sourceUpdatedAt, expiresAt],
    )
  }

  async load(key: string) {
    const row = await this.database.get<SnapshotRow>(
      `SELECT envelope_json
       FROM metric_snapshots
       WHERE cache_key = ? AND expires_at > CURRENT_TIMESTAMP(3)`,
      [key],
    )
    if (!row) return null
    return typeof row.envelope_json === 'string'
      ? JSON.parse(row.envelope_json) as MetricEnvelope
      : row.envelope_json
  }
}

export interface MetricServiceOptions {
  adapters: MetricAdapter[]
  cache: MetricCache
  snapshots?: SnapshotStore
}

export class MetricService {
  private readonly adapters = new Map<SystemKey, MetricAdapter>()
  private readonly breakers = new Map<SystemKey, CircuitBreaker>()
  private readonly inFlight = new Map<string, Promise<MetricEnvelope>>()

  constructor(private readonly options: MetricServiceOptions) {
    for (const adapter of options.adapters) {
      this.adapters.set(adapter.systemKey, adapter)
      this.breakers.set(adapter.systemKey, new CircuitBreaker())
    }
  }

  async getMetric(
    systemKey: SystemKey,
    metricKey: string,
    filters: Record<string, JsonValue>,
    context: AdapterRequestContext,
  ): Promise<MetricEnvelope> {
    const policy = metricPolicies[metricKey as MetricKey]
    if (!policy) {
      throw Object.assign(new Error('不支持的大屏指标'), { statusCode: 400 })
    }
    if (metricSystems[metricKey as MetricKey] !== systemKey) {
      throw Object.assign(new Error('指标与大屏数据源不匹配'), { statusCode: 400 })
    }
    const adapter = this.adapters.get(systemKey)
    if (!adapter) {
      throw Object.assign(new Error('不支持的大屏数据源'), { statusCode: 400 })
    }
    const key = metricCacheKey(systemKey, metricKey, filters, context.cacheScope)
    const fresh = this.options.cache.getFresh(key, policy.ttlMs)
    if (fresh) return fresh
    const running = this.inFlight.get(key)
    if (running) return running

    const request = this.loadMetric(
      key,
      adapter,
      metricKey,
      filters,
      context,
      policy.staleMs,
    ).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, request)
    return request
  }

  private async loadMetric(
    key: string,
    adapter: MetricAdapter,
    metricKey: string,
    filters: Record<string, JsonValue>,
    context: AdapterRequestContext,
    staleMs: number,
  ) {
    try {
      const breaker = this.breakers.get(adapter.systemKey)
      if (!breaker) throw new Error('Circuit breaker is unavailable')
      const envelope = await breaker.execute(() =>
        adapter.getMetric(metricKey, filters, context),
      )
      this.options.cache.set(key, envelope)
      try {
        await this.options.snapshots?.save(key, envelope, staleMs)
      } catch {
        // A durable snapshot is optional while fresh upstream data is available.
      }
      return envelope
    } catch {
      let cached = this.options.cache.getStale(key, staleMs)
      if (!cached && this.options.snapshots) {
        try {
          cached = await this.options.snapshots.load(key)
        } catch {
          cached = null
        }
      }
      if (cached) {
        return {
          ...cached,
          generatedAt: new Date().toISOString(),
          stale: true,
          status: 'stale' as const,
          unavailableSources: Array.from(new Set([
            ...cached.unavailableSources,
            adapter.systemKey,
          ])),
        }
      }
      return createMetricEnvelope(adapter.systemKey, metricKey, {}, {
        status: 'error',
        unavailableSources: [adapter.systemKey],
      })
    }
  }
}

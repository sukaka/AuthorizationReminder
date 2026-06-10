import { config } from '../config.js'
import type { JsonValue } from '../contracts.js'
import { createHttpClient, type HttpClientOptions } from './http-client.js'
import {
  collectSourceData,
  type AdapterRequestContext,
  type MetricAdapter,
} from './types.js'

const metricSources: Record<string, Array<{ key: string; path: string }>> = {
  'expiry-risk': [
    { key: 'dashboard', path: '/api/dashboard' },
  ],
  'delivery-execution': [
    { key: 'dashboard', path: '/api/dashboard' },
  ],
  'customer-sales': [
    { key: 'dashboard', path: '/api/dashboard' },
    { key: 'salesOverview', path: '/api/sales-license-overview' },
  ],
}

export const createReminderAdapter = (
  options: Partial<HttpClientOptions> = {},
): MetricAdapter => {
  const client = createHttpClient({
    baseUrl: options.baseUrl || config.sources.reminderUrl,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  })
  return {
    systemKey: 'reminder',
    async getMetric(
      metricKey: string,
      _filters: Record<string, JsonValue>,
      context: AdapterRequestContext,
    ) {
      const sources = metricSources[metricKey]
      if (!sources) throw new Error('Unsupported reminder metric')
      return collectSourceData(
        'reminder',
        metricKey,
        sources.map((source) => ({
          key: source.key,
          load: () => client.getJson(source.path, context),
        })),
      )
    },
  }
}

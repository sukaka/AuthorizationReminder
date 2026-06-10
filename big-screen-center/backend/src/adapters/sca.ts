import { config } from '../config.js'
import type { JsonValue } from '../contracts.js'
import { createHttpClient, type HttpClientOptions } from './http-client.js'
import {
  collectSourceData,
  type AdapterRequestContext,
  type MetricAdapter,
} from './types.js'

const metricSources: Record<string, Array<{ key: string; path: string }>> = {
  'security-overview': [
    { key: 'overview', path: '/api/sca/overview' },
    { key: 'assets', path: '/api/sca/assets/dashboard' },
    { key: 'dependencyCheck', path: '/api/sca/dependency-check/status' },
    { key: 'devops', path: '/api/sca/devops/dashboard' },
  ],
  'vulnerability-threat': [
    { key: 'assets', path: '/api/sca/assets/dashboard' },
  ],
  'supply-chain-graph': [
    { key: 'overview', path: '/api/sca/overview' },
    { key: 'assets', path: '/api/sca/assets/dashboard' },
  ],
  'scan-operations': [
    { key: 'dependencyCheck', path: '/api/sca/dependency-check/status' },
    { key: 'devops', path: '/api/sca/devops/dashboard' },
  ],
  'security-governance': [
    { key: 'overview', path: '/api/sca/overview' },
    { key: 'assets', path: '/api/sca/assets/dashboard' },
    { key: 'devops', path: '/api/sca/devops/dashboard' },
  ],
}

export const createScaAdapter = (
  options: Partial<HttpClientOptions> = {},
): MetricAdapter => {
  const client = createHttpClient({
    baseUrl: options.baseUrl || config.sources.scaUrl,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  })
  return {
    systemKey: 'sca',
    async getMetric(
      metricKey: string,
      _filters: Record<string, JsonValue>,
      context: AdapterRequestContext,
    ) {
      const sources = metricSources[metricKey]
      if (!sources) throw new Error('Unsupported SCA metric')
      return collectSourceData(
        'sca',
        metricKey,
        sources.map((source) => ({
          key: source.key,
          load: () => client.getJson(source.path, context),
        })),
      )
    },
  }
}

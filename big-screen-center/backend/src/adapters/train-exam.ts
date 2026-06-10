import { config } from '../config.js'
import type { JsonValue } from '../contracts.js'
import { createHttpClient, type HttpClientOptions } from './http-client.js'
import {
  collectSourceData,
  type AdapterRequestContext,
  type MetricAdapter,
} from './types.js'

const metricSources: Record<string, Array<{ key: string; path: string }>> = {
  'training-overview': [
    { key: 'overview', path: '/api/train-exam/stats/overview' },
    { key: 'passTrend', path: '/api/train-exam/stats/pass-trend?days=30' },
  ],
  'exam-command': [
    { key: 'overview', path: '/api/train-exam/stats/overview' },
    { key: 'passTrend', path: '/api/train-exam/stats/pass-trend?days=30' },
  ],
  'organization-capability': [
    { key: 'overview', path: '/api/train-exam/stats/overview' },
    { key: 'organization', path: '/api/train-exam/stats/org-breakdown' },
  ],
  'training-outcomes': [
    { key: 'overview', path: '/api/train-exam/stats/overview' },
    { key: 'passTrend', path: '/api/train-exam/stats/pass-trend?days=30' },
    { key: 'organization', path: '/api/train-exam/stats/org-breakdown' },
  ],
}

export const createTrainExamAdapter = (
  options: Partial<HttpClientOptions> = {},
): MetricAdapter => {
  const client = createHttpClient({
    baseUrl: options.baseUrl || config.sources.trainExamUrl,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  })
  return {
    systemKey: 'train-exam',
    async getMetric(
      metricKey: string,
      _filters: Record<string, JsonValue>,
      context: AdapterRequestContext,
    ) {
      const sources = metricSources[metricKey]
      if (!sources) throw new Error('Unsupported training metric')
      return collectSourceData(
        'train-exam',
        metricKey,
        sources.map((source) => ({
          key: source.key,
          load: () => client.getJson(source.path, context),
        })),
      )
    },
  }
}

import { config } from '../config.js'
import type { JsonValue } from '../contracts.js'
import type { AdapterRequestContext } from './types.js'

export interface HttpClientOptions {
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class UpstreamHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'UpstreamHttpError'
  }
}

const assertRelativeApiPath = (path: string) => {
  if (!path.startsWith('/api/') || path.includes('..') || /^\/\//.test(path)) {
    throw new Error('Adapter path must be an approved relative API path')
  }
}

export const createHttpClient = ({
  baseUrl,
  timeoutMs = config.sources.timeoutMs,
  fetchImpl = fetch,
}: HttpClientOptions) => {
  const origin = new URL(baseUrl)

  return {
    async getJson(path: string, context: AdapterRequestContext = {}): Promise<JsonValue> {
      assertRelativeApiPath(path)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (context.cookie) headers.Cookie = context.cookie
      if (context.authorization) headers.Authorization = context.authorization
      if (context.requestId) headers['X-Request-Id'] = context.requestId

      try {
        const response = await fetchImpl(new URL(path, origin), {
          method: 'GET',
          headers,
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new UpstreamHttpError(`Upstream responded with ${response.status}`, response.status)
        }
        const text = await response.text()
        if (text.length > 2 * 1024 * 1024) {
          throw new UpstreamHttpError('Upstream response is too large', 502)
        }
        return text ? JSON.parse(text) as JsonValue : {}
      } catch (error) {
        if (error instanceof UpstreamHttpError) throw error
        if (error instanceof Error && error.name === 'AbortError') {
          throw new UpstreamHttpError('Upstream request timed out', 504)
        }
        throw new UpstreamHttpError('Upstream request failed', 502)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

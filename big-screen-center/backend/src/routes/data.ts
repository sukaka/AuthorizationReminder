import { randomUUID } from 'node:crypto'

import { Router, type Request, type Response } from 'express'

import {
  authorizeRequest,
  AuthError,
  type AuthorizationContext,
} from '../auth.js'
import {
  metricCacheKey,
  metricPolicies,
  type MetricKey,
  type MetricService,
} from '../cache.js'
import {
  SafeJsonSchema,
  SystemKeySchema,
  type JsonValue,
} from '../contracts.js'
import { StreamHub } from '../stream-hub.js'

type Authorize = (request: Request) => Promise<AuthorizationContext>

export interface DataRouterOptions {
  service: MetricService
  authorize?: Authorize
  streamHub?: StreamHub
}

const requestContext = (request: Request, auth: AuthorizationContext) => ({
  cookie: request.headers.cookie || '',
  authorization: request.headers.authorization || '',
  requestId: String(request.headers['x-request-id'] || randomUUID()),
  cacheScope: JSON.stringify({
    userId: auth.user.id,
    apps: [...auth.apps].sort(),
    scope: auth.scope,
  }),
})

const parseFilters = (request: Request) => {
  const filters: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(request.query)) {
    if (typeof value === 'string') filters[key] = value
    else if (Array.isArray(value)) {
      filters[key] = value.filter((item): item is string => typeof item === 'string')
    }
  }
  return SafeJsonSchema.parse(filters) as Record<string, JsonValue>
}

const sendError = (response: Response, error: unknown) => {
  const statusCode = error instanceof AuthError
    ? error.statusCode
    : Number((error as { statusCode?: number })?.statusCode || 500)
  const message = error instanceof Error ? error.message : '大屏数据请求失败'
  response.status(statusCode).json({ error: message })
}

const requireSourceAccess = (auth: AuthorizationContext, systemKey: string) => {
  const parsed = SystemKeySchema.safeParse(systemKey)
  if (!parsed.success) {
    throw Object.assign(new Error('不支持的大屏数据源'), { statusCode: 400 })
  }
  if (!auth.allowedSystems.includes(parsed.data)) {
    throw Object.assign(new Error('无权限访问该大屏数据源'), { statusCode: 403 })
  }
  return parsed.data
}

export const createDataRouter = ({
  service,
  authorize = authorizeRequest,
  streamHub = new StreamHub(),
}: DataRouterOptions) => {
  const router = Router()

  router.get('/auth/check', async (request, response) => {
    try {
      await authorize(request)
      response.status(204).end()
    } catch (error) {
      sendError(response, error)
    }
  })

  router.get('/data/:systemKey/:metricKey', async (request, response) => {
    try {
      const auth = await authorize(request)
      const systemKey = requireSourceAccess(auth, request.params.systemKey)
      const envelope = await service.getMetric(
        systemKey,
        request.params.metricKey,
        parseFilters(request),
        requestContext(request, auth),
      )
      response.json(envelope)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.get('/stream/:systemKey/:metricKey', async (request, response) => {
    let unsubscribe: (() => void) | null = null
    try {
      const auth = await authorize(request)
      const systemKey = requireSourceAccess(auth, request.params.systemKey)
      const metricKey = request.params.metricKey as MetricKey
      const policy = metricPolicies[metricKey]
      if (!policy || policy.streamMs <= 0) {
        throw Object.assign(new Error('该指标不支持实时推送'), { statusCode: 400 })
      }
      const filters = parseFilters(request)
      const context = requestContext(request, auth)
      const streamKey = metricCacheKey(systemKey, metricKey, filters, context.cacheScope)

      response.status(200)
      response.setHeader('Content-Type', 'text/event-stream')
      response.setHeader('Cache-Control', 'no-cache, no-transform')
      response.setHeader('Connection', 'keep-alive')
      response.flushHeaders()

      unsubscribe = streamHub.subscribe(
        streamKey,
        policy.streamMs,
        () => service.getMetric(systemKey, metricKey, filters, context),
        (envelope) => response.write(`event: metric\ndata: ${JSON.stringify(envelope)}\n\n`),
      )
      request.on('close', () => unsubscribe?.())
    } catch (error) {
      unsubscribe?.()
      if (!response.headersSent) sendError(response, error)
      else response.end()
    }
  })

  return router
}

import cors from 'cors'
import { randomUUID } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'

import type { AuthorizationContext } from './auth.js'
import { createScaAdapter } from './adapters/sca.js'
import { createTrainExamAdapter } from './adapters/train-exam.js'
import { createReminderAdapter } from './adapters/reminder.js'
import {
  MetricCache,
  MetricService,
  type SnapshotStore,
} from './cache.js'
import { config } from './config.js'
import { createDataRouter } from './routes/data.js'
import { createHealthRouter } from './routes/health.js'
import { createPlaylistRouter } from './routes/playlists.js'
import { createResourceRouter } from './routes/resources.js'
import { createTemplateRouter } from './routes/templates.js'
import {
  ResourcePackStore,
  type ResourcePackService,
} from './resource-pack-store.js'
import type { StoreDatabase } from './store-types.js'
import { StreamHub } from './stream-hub.js'
import type { SourceHealthMap } from './routes/health.js'

const serviceName = 'big-screen'
const appVersion = process.env.APP_VERSION || process.env.npm_package_version || 'unknown'
const buildCommit = process.env.BUILD_COMMIT || process.env.GIT_COMMIT || ''
const buildTime = process.env.BUILD_TIME || process.env.BUILT_AT || ''

const observabilityMetrics: {
  service: string
  startedAt: string
  requestTotal: number
  errorTotal: number
  inFlight: number
  durationMsTotal: number
  durationMsMax: number
  statusCounts: Record<string, number>
} = {
  service: serviceName,
  startedAt: new Date().toISOString(),
  requestTotal: 0,
  errorTotal: 0,
  inFlight: 0,
  durationMsTotal: 0,
  durationMsMax: 0,
  statusCounts: {},
}

const normalizeRequestId = (value: unknown) => {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.slice(0, 128).replace(/[^a-zA-Z0-9_.:-]/g, '')
}

const buildMetricsSnapshot = () => ({
  service: serviceName,
  started_at: observabilityMetrics.startedAt,
  uptime_seconds: Math.round(process.uptime()),
  request_total: observabilityMetrics.requestTotal,
  error_total: observabilityMetrics.errorTotal,
  in_flight: observabilityMetrics.inFlight,
  duration_ms_avg: observabilityMetrics.requestTotal
    ? Number((observabilityMetrics.durationMsTotal / observabilityMetrics.requestTotal).toFixed(2))
    : 0,
  duration_ms_max: Number(observabilityMetrics.durationMsMax.toFixed(2)),
  status_counts: observabilityMetrics.statusCounts,
})

const observabilityMiddleware = (request: Request, response: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint()
  const requestId =
    normalizeRequestId(request.get('X-Request-Id') || request.get('X-Correlation-Id')) || randomUUID()
  response.setHeader('X-Request-Id', requestId)
  observabilityMetrics.inFlight += 1

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    const statusCode = Number(response.statusCode || 0)
    observabilityMetrics.inFlight = Math.max(0, observabilityMetrics.inFlight - 1)
    observabilityMetrics.requestTotal += 1
    observabilityMetrics.durationMsTotal += durationMs
    observabilityMetrics.durationMsMax = Math.max(observabilityMetrics.durationMsMax, durationMs)
    observabilityMetrics.statusCounts[String(statusCode)] = (observabilityMetrics.statusCounts[String(statusCode)] || 0) + 1
    if (statusCode >= 500) observabilityMetrics.errorTotal += 1
    console.info(JSON.stringify({
      type: 'http_access',
      service: serviceName,
      request_id: requestId,
      method: request.method,
      path: request.originalUrl?.split('?')[0] || request.path,
      status: statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      remote_ip: request.ip || request.socket.remoteAddress || '',
    }))
  })

  next()
}

export interface CreateAppOptions {
  service?: MetricService
  snapshots?: SnapshotStore
  authorize?: (request: Request) => Promise<AuthorizationContext>
  streamHub?: StreamHub
  database?: StoreDatabase
  getSourceHealth?: () => Promise<SourceHealthMap> | SourceHealthMap
  resourcePacks?: ResourcePackService
}

const createDefaultMetricService = (snapshots?: SnapshotStore) =>
  new MetricService({
    adapters: [
      createScaAdapter(),
      createTrainExamAdapter(),
      createReminderAdapter(),
    ],
    cache: new MetricCache(),
    snapshots,
  })

export const createApp = (options: CreateAppOptions = {}) => {
  const application = express()
  const allowedOrigins = new Set(config.corsOrigins)
  application.disable('x-powered-by')
  application.use(observabilityMiddleware)
  application.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('CORS origin is not allowed'))
    },
  }))
  application.use(express.json({ limit: '64kb' }))

  application.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: serviceName,
    })
  })

  application.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: serviceName,
    })
  })

  application.get('/api/ready', async (_request, response) => {
    if (!options.database) {
      response.json({
        status: 'ok',
        service: serviceName,
        database: 'not-configured',
      })
      return
    }
    try {
      await options.database.query('SELECT 1')
      response.json({
        status: 'ok',
        service: serviceName,
        database: 'ok',
      })
    } catch {
      response.status(503).json({
        status: 'degraded',
        service: serviceName,
        database: 'error',
      })
    }
  })

  application.get('/api/version', (_request, response) => {
    response.json({
      service: serviceName,
      version: appVersion,
    })
  })

  application.get('/api/build', (_request, response) => {
    response.json({
      service: serviceName,
      version: appVersion,
      commit: buildCommit,
      buildTime,
    })
  })

  application.get('/api/metrics', (_request, response) => {
    response.json(buildMetricsSnapshot())
  })

  application.use('/api/big-screen', createDataRouter({
    service: options.service || createDefaultMetricService(options.snapshots),
    authorize: options.authorize,
    streamHub: options.streamHub,
  }))
  if (options.database) {
    application.use('/api/big-screen', createTemplateRouter({
      database: options.database,
      authorize: options.authorize,
    }))
    application.use('/api/big-screen', createPlaylistRouter({
      database: options.database,
      authorize: options.authorize,
    }))
    application.use('/api/big-screen', createHealthRouter({
      database: options.database,
      getSources: options.getSourceHealth,
    }))
    application.use('/api/big-screen', createResourceRouter({
      database: options.database,
      authorize: options.authorize,
      resourcePacks: options.resourcePacks || new ResourcePackStore({
        database: options.database,
        assetsRoot: config.resources.assetsRoot,
        publicKey: config.resources.publicKey,
      }),
    }))
  }

  return application
}

export const app = createApp()

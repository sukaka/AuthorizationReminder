import cors from 'cors'
import express, { type Request } from 'express'

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
      service: 'big-screen-backend',
    })
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

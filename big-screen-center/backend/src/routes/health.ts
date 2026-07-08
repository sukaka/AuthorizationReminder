import { Router } from 'express'

import type { SystemKey } from '../contracts.js'
import type { StoreDatabase } from '../store-types.js'

export interface SourceHealth {
  status: 'ok' | 'partial' | 'stale' | 'empty' | 'error'
  latencyMs: number | null
  lastSuccessAt: string | null
}

export type SourceHealthMap = Record<SystemKey, SourceHealth>

export interface HealthRouterOptions {
  database: StoreDatabase
  getSources?: () => Promise<SourceHealthMap> | SourceHealthMap
}

const defaultSources = (): SourceHealthMap => ({
  sca: { status: 'ok', latencyMs: null, lastSuccessAt: null },
  'train-exam': { status: 'ok', latencyMs: null, lastSuccessAt: null },
  reminder: { status: 'ok', latencyMs: null, lastSuccessAt: null },
})

const failedSources = (): SourceHealthMap => ({
  sca: { status: 'error', latencyMs: null, lastSuccessAt: null },
  'train-exam': { status: 'error', latencyMs: null, lastSuccessAt: null },
  reminder: { status: 'error', latencyMs: null, lastSuccessAt: null },
})

export const createHealthRouter = ({
  database,
  getSources = defaultSources,
}: HealthRouterOptions) => {
  const router = Router()

  router.get('/health', async (_request, response) => {
    let databaseStatus: 'ok' | 'error' = 'ok'
    try {
      await database.query('SELECT 1')
    } catch {
      databaseStatus = 'error'
    }
    let sources: SourceHealthMap
    try {
      sources = await getSources()
    } catch {
      sources = failedSources()
    }
    const hasDegradedSource = Object.values(sources).some(
      (source) => source.status !== 'ok',
    )
    response.status(databaseStatus === 'ok' ? 200 : 503).json({
      status: databaseStatus === 'ok' && !hasDegradedSource ? 'ok' : 'degraded',
      database: databaseStatus,
      sources,
    })
  })

  return router
}

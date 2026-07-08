import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import type { SqlExecutor } from '../src/db.js'
import type { StoreDatabase } from '../src/store-types.js'

const databaseWithQuery = (query: SqlExecutor['query']): StoreDatabase => {
  const executor: SqlExecutor = {
    query,
    async get() {
      return null
    },
    async run() {
      return { insertId: 0, affectedRows: 0 }
    },
  }
  return {
    ...executor,
    async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
      return work(executor)
    },
  }
}

describe('big-screen health route', () => {
  it('reports database and source health', async () => {
    const app = createApp({
      database: databaseWithQuery(async <T>() => [{ healthy: 1 }] as T[]),
      getSourceHealth: async () => ({
        sca: { status: 'ok', latencyMs: 12, lastSuccessAt: '2026-06-11T08:00:00.000Z' },
        'train-exam': { status: 'stale', latencyMs: 48, lastSuccessAt: '2026-06-11T07:59:00.000Z' },
        reminder: { status: 'empty', latencyMs: 8, lastSuccessAt: null },
      }),
    })

    const response = await request(app)
      .get('/api/big-screen/health')
      .expect(200)

    expect(response.body).toMatchObject({
      status: 'degraded',
      database: 'ok',
      sources: {
        sca: { status: 'ok', latencyMs: 12 },
        'train-exam': { status: 'stale', latencyMs: 48 },
        reminder: { status: 'empty', latencyMs: 8 },
      },
    })
  })

  it('returns 503 when the database check fails', async () => {
    const app = createApp({
      database: databaseWithQuery(async <T>() => {
        throw new Error('database unavailable')
        return [] as T[]
      }),
    })

    const response = await request(app)
      .get('/api/big-screen/health')
      .expect(503)

    expect(response.body.status).toBe('degraded')
    expect(response.body.database).toBe('error')
  })
})

import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import type { AuthorizationContext } from '../src/auth.js'
import { createResourceRouter } from '../src/routes/resources.js'
import type { SqlExecutor } from '../src/db.js'
import type { ResourcePackService } from '../src/resource-pack-store.js'
import type { StoreDatabase } from '../src/store-types.js'

const sysadmin: AuthorizationContext = {
  user: { id: 1, username: 'admin', role: 'admin' },
  apps: ['big-screen'],
  allowedSystems: [],
  screenRole: 'sysadmin',
  scope: {},
}

const designer: AuthorizationContext = {
  ...sysadmin,
  screenRole: 'designer',
}

const auditDatabase = () => {
  const actions: string[] = []
  const executor: SqlExecutor = {
    async query() {
      return []
    },
    async get() {
      return null
    },
    async run(sql, params = []) {
      if (sql.includes('INSERT INTO screen_audit_logs')) actions.push(String(params[1]))
      return { insertId: actions.length, affectedRows: 1 }
    },
  }
  const database: StoreDatabase = {
    ...executor,
    async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
      return work(executor)
    },
  }
  return { actions, database }
}

const service = (): ResourcePackService => ({
  upload: vi.fn(async () => ({ id: 1, packKey: 'china-map', version: 2 })),
  enable: vi.fn(async () => ({ packKey: 'china-map', version: 2, enabled: true })),
  rollback: vi.fn(async () => ({ packKey: 'china-map', version: 1, enabled: true })),
})

const appFor = (
  authorize: () => Promise<AuthorizationContext>,
  resourcePacks: ResourcePackService,
  database: StoreDatabase,
) => {
  const app = express()
  app.use(express.json())
  app.use('/api/big-screen', createResourceRouter({
    authorize,
    database,
    resourcePacks,
  }))
  return app
}

describe('resource pack routes', () => {
  it('allows sysadmins to upload, enable, and rollback with audit events', async () => {
    const memory = auditDatabase()
    const resourcePacks = service()
    const app = appFor(async () => sysadmin, resourcePacks, memory.database)

    await request(app)
      .post('/api/big-screen/resources/packs')
      .send({ manifest: { packKey: 'china-map' }, signatureBase64: 'signature' })
      .expect(201)
    await request(app)
      .post('/api/big-screen/resources/packs/china-map/2/enable')
      .expect(200)
    await request(app)
      .post('/api/big-screen/resources/packs/china-map/1/rollback')
      .expect(200)

    expect(memory.actions).toEqual([
      'resource-pack.upload',
      'resource-pack.enable',
      'resource-pack.rollback',
    ])
  })

  it('rejects non-sysadmin resource changes', async () => {
    const memory = auditDatabase()
    const app = appFor(async () => designer, service(), memory.database)

    await request(app)
      .post('/api/big-screen/resources/packs')
      .send({ manifest: {}, signatureBase64: 'signature' })
      .expect(403)
  })
})

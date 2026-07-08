import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import type { AuthorizationContext } from '../src/auth.js'
import type { SqlExecutor } from '../src/db.js'
import type { StoreDatabase } from '../src/store-types.js'

const createTemplateRouteDatabase = () => {
  const drafts = new Map<string, string>()
  const versions: Array<{
    id: number
    templateId: string
    version: number
    configJson: string
    publishedBy: number
  }> = []
  const audits: string[] = []

  const executor: SqlExecutor = {
    async query<T>(sql: string, params: unknown[] = []) {
      if (!sql.includes('FROM screen_versions')) return [] as T[]
      return versions
        .filter((item) => item.templateId === String(params[0]))
        .map((item) => ({
          id: item.id,
          template_id: item.templateId,
          version_no: item.version,
          config_json: item.configJson,
          published_by: item.publishedBy,
        })) as T[]
    },
    async get<T>(sql: string, params: unknown[] = []) {
      if (sql.includes('FROM screen_drafts')) {
        const config = drafts.get(`${params[0]}:${params[1]}`)
        return (config ? { config_json: config } : null) as T | null
      }
      if (sql.includes('MAX(version_no)')) {
        const latest = versions
          .filter((item) => item.templateId === String(params[0]))
          .reduce((max, item) => Math.max(max, item.version), 0)
        return { version_no: latest } as T
      }
      if (sql.includes('FROM screen_versions')) {
        const item = versions.find((candidate) =>
          candidate.templateId === String(params[0])
          && candidate.version === Number(params[1]))
        return (item ? {
          id: item.id,
          template_id: item.templateId,
          version_no: item.version,
          config_json: item.configJson,
          published_by: item.publishedBy,
        } : null) as T | null
      }
      return null
    },
    async run(sql: string, params: unknown[] = []) {
      if (sql.includes('INSERT INTO screen_drafts')) {
        drafts.set(`${params[0]}:${params[1]}`, String(params[2]))
        return { insertId: 1, affectedRows: 1 }
      }
      if (sql.includes('INSERT INTO screen_versions')) {
        const id = versions.length + 1
        versions.push({
          id,
          templateId: String(params[0]),
          version: Number(params[1]),
          configJson: String(params[2]),
          publishedBy: Number(params[3]),
        })
        return { insertId: id, affectedRows: 1 }
      }
      if (sql.includes('INSERT INTO screen_audit_logs')) {
        audits.push(String(params[1]))
        return { insertId: audits.length, affectedRows: 1 }
      }
      return { insertId: 0, affectedRows: 0 }
    },
  }
  const database: StoreDatabase = {
    ...executor,
    async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
      return work(executor)
    },
  }
  return { audits, database, versions }
}

const designer: AuthorizationContext = {
  user: { id: 9, username: 'designer', role: 'designer' },
  apps: ['big-screen', 'sca'],
  allowedSystems: ['sca'],
  screenRole: 'designer',
  scope: {},
}

describe('template routes', () => {
  it('saves, publishes, and republishes rollback versions with audits', async () => {
    const memory = createTemplateRouteDatabase()
    const app = createApp({
      database: memory.database,
      authorize: async () => designer,
    })

    await request(app)
      .put('/api/big-screen/templates/sca-01/draft')
      .send({ config: { effectsProfile: 'medium' } })
      .expect(200)
    await request(app)
      .post('/api/big-screen/templates/sca-01/publish')
      .expect(201)

    await request(app)
      .put('/api/big-screen/templates/sca-01/draft')
      .send({ config: { effectsProfile: 'low' } })
      .expect(200)
    await request(app)
      .post('/api/big-screen/templates/sca-01/publish')
      .expect(201)

    const rollback = await request(app)
      .post('/api/big-screen/templates/sca-01/rollback')
      .send({ version: 1 })
      .expect(201)

    expect(rollback.body.version).toBe(3)
    expect(rollback.body.config).toEqual({ effectsProfile: 'medium' })
    expect(memory.versions).toHaveLength(3)
    expect(memory.audits).toEqual([
      'template.draft.save',
      'template.publish',
      'template.draft.save',
      'template.publish',
      'template.rollback',
    ])
  })
})

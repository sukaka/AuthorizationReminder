import { describe, expect, it, vi } from 'vitest'

import { runMigrations } from '../src/migrations.js'
import type { SqlExecutor } from '../src/db.js'
import type { StoreDatabase } from '../src/store-types.js'
import { TemplateStore } from '../src/template-store.js'

const createMemoryTemplateDatabase = () => {
  const drafts = new Map<string, string>()
  const versions: Array<{
    id: number
    templateId: string
    version: number
    configJson: string
    publishedBy: number
  }> = []

  const executor: SqlExecutor = {
    async query<T>(sql: string, params: unknown[] = []) {
      if (sql.includes('FROM screen_versions')) {
        const templateId = String(params[0])
        return versions
          .filter((item) => item.templateId === templateId)
          .sort((left, right) => right.version - left.version)
          .map((item) => ({
            id: item.id,
            template_id: item.templateId,
            version_no: item.version,
            config_json: item.configJson,
            published_by: item.publishedBy,
          })) as T[]
      }
      return [] as T[]
    },
    async get<T>(sql: string, params: unknown[] = []) {
      if (sql.includes('FROM screen_drafts')) {
        const key = `${params[0]}:${params[1]}`
        const configJson = drafts.get(key)
        return (configJson ? { config_json: configJson } : null) as T | null
      }
      if (sql.includes('MAX(version_no)')) {
        const templateId = String(params[0])
        const latest = versions
          .filter((item) => item.templateId === templateId)
          .reduce((max, item) => Math.max(max, item.version), 0)
        return { version_no: latest } as T
      }
      if (sql.includes('FROM screen_versions') && sql.includes('version_no = ?')) {
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
      return { insertId: 0, affectedRows: 0 }
    },
  }

  const database: StoreDatabase = {
    ...executor,
    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>) {
      return work(executor)
    },
  }

  return {
    drafts,
    versions,
    database,
  }
}

describe('TemplateStore', () => {
  it('publishes immutable versions', async () => {
    const memory = createMemoryTemplateDatabase()
    const store = new TemplateStore(memory.database)
    await store.saveDraft('sca-01', 9, { effectsProfile: 'medium' })

    const first = await store.publish('sca-01', 9)
    const second = await store.publish('sca-01', 9)

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(first.id).not.toBe(second.id)
    expect(memory.versions).toHaveLength(2)
    expect(memory.versions[0]?.configJson).toBe(memory.versions[1]?.configJson)
  })

  it('rejects unsafe executable draft content', async () => {
    const memory = createMemoryTemplateDatabase()
    const store = new TemplateStore(memory.database)

    await expect(
      store.saveDraft('sca-01', 9, { html: '<script>alert(1)</script>' }),
    ).rejects.toThrow(/Forbidden/)
  })

  it('rolls back by publishing a new immutable version', async () => {
    const memory = createMemoryTemplateDatabase()
    const store = new TemplateStore(memory.database)
    await store.saveDraft('sca-01', 9, { effectsProfile: 'medium' })
    await store.publish('sca-01', 9)
    await store.saveDraft('sca-01', 9, { effectsProfile: 'low' })
    await store.publish('sca-01', 9)

    const rollback = await store.rollback('sca-01', 1, 9)
    const versions = await store.listVersions('sca-01')

    expect(rollback.version).toBe(3)
    expect(rollback.config).toEqual({ effectsProfile: 'medium' })
    expect(versions.map((item) => item.version)).toEqual([3, 2, 1])
    expect(memory.versions).toHaveLength(3)
  })
})

describe('database migrations', () => {
  it('creates every big-screen persistence table idempotently', async () => {
    const statements: string[] = []
    const database = {
      run: vi.fn(async (sql: string) => {
        statements.push(sql)
        return { insertId: 0, affectedRows: 0 }
      }),
    }

    await runMigrations(database)

    const sql = statements.join('\n')
    for (const table of [
      'screen_drafts',
      'screen_versions',
      'screen_playlists',
      'screen_audit_logs',
      'metric_snapshots',
      'screen_play_tokens',
      'screen_resource_packs',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })
})

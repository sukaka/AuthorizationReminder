import { describe, expect, it, vi } from 'vitest'

import {
  authorizeRequest,
  hasCapability,
  roleCapabilities,
} from '../src/auth.js'
import type { SqlExecutor } from '../src/db.js'
import { PlayTokenStore } from '../src/play-token-store.js'
import type { StoreDatabase } from '../src/store-types.js'

const fakeRequest = {
  headers: {
    authorization: 'Bearer session-token',
  },
}

const fakeFetchReturning = (payload: unknown, status = 200) => vi.fn(async () =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  }),
)

describe('big-screen authorization', () => {
  it('filters source systems by unified app access', async () => {
    const fetchImpl = fakeFetchReturning({
      user: { id: 7, username: 'viewer', role: 'user' },
      apps: ['big-screen', 'reminder'],
    })

    const result = await authorizeRequest(fakeRequest, fetchImpl)

    expect(result.allowedSystems).toEqual(['reminder'])
    expect(result.screenRole).toBe('viewer')
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/introspect$/),
      expect.objectContaining({
        headers: { Authorization: 'Bearer session-token' },
      }),
    )
  })

  it('requires unified big-screen portal access', async () => {
    const fetchImpl = fakeFetchReturning({
      user: { id: 8, username: 'editor', role: 'editor' },
      apps: ['sca'],
    })

    await expect(authorizeRequest(fakeRequest, fetchImpl)).rejects.toMatchObject({
      message: '无权限访问统一大屏展示中心',
      statusCode: 403,
    })
  })

  it('maps unified roles to explicit big-screen capabilities', () => {
    expect(hasCapability('admin', 'source:admin')).toBe(true)
    expect(hasCapability('editor', 'template:publish')).toBe(true)
    expect(hasCapability('reviewer', 'playlist:write')).toBe(true)
    expect(hasCapability('user', 'template:publish')).toBe(false)
    expect(hasCapability('sysadmin', 'source:admin')).toBe(true)
    expect(hasCapability('designer', 'template:publish')).toBe(true)
    expect([...roleCapabilities.viewer]).toEqual(['catalog:read', 'screen:play'])
  })
})

describe('play tokens', () => {
  it('returns a random token while persisting only its sha256 hash', async () => {
    const inserted: { sql: string; params: unknown[] }[] = []
    const database: StoreDatabase = {
      async run(sql: string, params: unknown[] = []) {
        inserted.push({ sql, params })
        return { insertId: 41, affectedRows: 1 }
      },
      async get<T>() {
        return null as T | null
      },
      async query<T>() {
        return [] as T[]
      },
      async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
        return work(database)
      },
    }
    const store = new PlayTokenStore(database)

    const issued = await store.issue({
      ownerUserId: 7,
      allowedSystems: ['sca', 'reminder'],
      playlistId: 3,
    })

    expect(issued.token.length).toBeGreaterThan(40)
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(inserted[0]?.sql).toContain('screen_play_tokens')
    expect(inserted[0]?.params[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(inserted[0]?.params).not.toContain(issued.token)
  })
})

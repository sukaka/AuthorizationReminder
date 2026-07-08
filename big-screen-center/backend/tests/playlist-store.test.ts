import { describe, expect, it } from 'vitest'

import type { SqlExecutor } from '../src/db.js'
import { PlaylistStore } from '../src/playlist-store.js'
import type { StoreDatabase } from '../src/store-types.js'

const createPlaylistDatabase = () => {
  const publishedVersions = new Map([
    [101, { id: 101, template_id: 'sca-01', version_no: 1 }],
    [202, { id: 202, template_id: 'train-02', version_no: 3 }],
  ])
  const playlists: Array<{ id: number; name: string; itemsJson: string }> = []

  const executor: SqlExecutor = {
    async query<T>() {
      return [] as T[]
    },
    async get<T>(sql: string, params: unknown[] = []) {
      if (!sql.includes('FROM screen_versions')) return null
      return (publishedVersions.get(Number(params[0])) || null) as T | null
    },
    async run(sql: string, params: unknown[] = []) {
      if (!sql.includes('INSERT INTO screen_playlists')) {
        return { insertId: 0, affectedRows: 0 }
      }
      const id = playlists.length + 1
      playlists.push({
        id,
        name: String(params[0]),
        itemsJson: String(params[2]),
      })
      return { insertId: id, affectedRows: 1 }
    },
  }

  const database: StoreDatabase = {
    ...executor,
    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>) {
      return work(executor)
    },
  }

  return {
    playlists,
    database,
  }
}

describe('PlaylistStore', () => {
  it('persists playlists that reference immutable published versions', async () => {
    const memory = createPlaylistDatabase()
    const store = new PlaylistStore(memory.database)

    const playlist = await store.create({
      name: '安全与培训轮播',
      ownerUserId: 7,
      items: [
        {
          templateId: 'sca-01',
          versionId: 101,
          durationSeconds: 30,
          transition: 'fade',
          filters: {},
        },
        {
          templateId: 'train-02',
          versionId: 202,
          durationSeconds: 45,
          transition: 'slide',
          filters: {},
        },
      ],
      schedule: [{
        timezone: 'Asia/Shanghai',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
      }],
    })

    expect(playlist.id).toBe(1)
    expect(JSON.parse(memory.playlists[0]?.itemsJson || '[]')).toHaveLength(2)
  })

  it('rejects playlists that reference missing or mismatched versions', async () => {
    const memory = createPlaylistDatabase()
    const store = new PlaylistStore(memory.database)

    await expect(
      store.create({
        name: '无效轮播',
        ownerUserId: 7,
        items: [{
          templateId: 'remind-01',
          versionId: 999,
          durationSeconds: 30,
          transition: 'fade',
          filters: {},
        }],
      }),
    ).rejects.toThrow('播放列表只能引用已发布版本')

    await expect(
      store.create({
        name: '错配轮播',
        ownerUserId: 7,
        items: [{
          templateId: 'train-01',
          versionId: 101,
          durationSeconds: 30,
          transition: 'fade',
          filters: {},
        }],
      }),
    ).rejects.toThrow('播放列表版本与模板不匹配')
  })

  it('rejects invalid durations and overlapping schedules', async () => {
    const memory = createPlaylistDatabase()
    const store = new PlaylistStore(memory.database)

    await expect(store.create({
      name: '时长错误',
      ownerUserId: 7,
      items: [{
        templateId: 'sca-01',
        versionId: 101,
        durationSeconds: 5,
        transition: 'fade',
        filters: {},
      }],
    })).rejects.toThrow()

    await expect(store.create({
      name: '日程冲突',
      ownerUserId: 7,
      items: [{
        templateId: 'sca-01',
        versionId: 101,
        durationSeconds: 30,
        transition: 'fade',
        filters: {},
      }],
      schedule: [
        {
          timezone: 'Asia/Shanghai',
          daysOfWeek: [1],
          startTime: '09:00',
          endTime: '12:00',
        },
        {
          timezone: 'Asia/Shanghai',
          daysOfWeek: [1],
          startTime: '11:00',
          endTime: '13:00',
        },
      ],
    })).rejects.toThrow('同一播放列表不允许重叠日程')
  })
})

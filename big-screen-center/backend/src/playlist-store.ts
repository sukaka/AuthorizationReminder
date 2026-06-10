import { z } from 'zod'

import { SafeJsonSchema, type JsonValue } from './contracts.js'
import type { StoreDatabase } from './store-types.js'

const PlaylistItemSchema = z.object({
  templateId: z.string().regex(/^(sca|train|remind)-0[1-9]$/),
  version: z.number().int().positive().optional(),
  versionId: z.number().int().positive().optional(),
  durationSeconds: z.number().int().min(10).max(1800),
  transition: z.enum(['fade', 'slide', 'zoom']).default('fade'),
  filters: z.record(z.string(), z.union([
    z.string(),
    z.array(z.string()),
  ])).default({}),
}).refine((item) => item.version || item.versionId, {
  message: '播放项必须指定已发布版本',
})

const TimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const PlaylistScheduleSchema = z.object({
  timezone: z.literal('Asia/Shanghai'),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1),
  startTime: TimeSchema,
  endTime: TimeSchema,
}).refine((schedule) => schedule.startTime < schedule.endTime, {
  message: '播放日程开始时间必须早于结束时间',
})

const CreatePlaylistSchema = z.object({
  name: z.string().trim().min(1).max(80),
  ownerUserId: z.number().int().positive(),
  items: z.array(PlaylistItemSchema).min(1).max(100),
  schedule: z.array(PlaylistScheduleSchema).max(20).default([]),
})

type CreatePlaylistInput = z.input<typeof CreatePlaylistSchema>
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>
export type PlaylistSchedule = z.infer<typeof PlaylistScheduleSchema>

interface VersionRow {
  id: number | string
  template_id: string
  version_no: number | string
}

interface PlaylistRow {
  id: number | string
  name: string
  owner_user_id: number | string
  items_json: string | JsonValue
  schedule_json: string | JsonValue | null
  enabled: number | boolean
}

const parseJson = (value: string | JsonValue | null) => {
  if (value === null) return null
  return SafeJsonSchema.parse(typeof value === 'string' ? JSON.parse(value) : value)
}

const schedulesOverlap = (
  left: PlaylistSchedule,
  right: PlaylistSchedule,
) => left.daysOfWeek.some((day) => right.daysOfWeek.includes(day))
  && left.startTime < right.endTime
  && right.startTime < left.endTime

const assertNoScheduleOverlap = (schedules: PlaylistSchedule[]) => {
  for (let left = 0; left < schedules.length; left += 1) {
    for (let right = left + 1; right < schedules.length; right += 1) {
      if (schedulesOverlap(schedules[left]!, schedules[right]!)) {
        throw new Error('同一播放列表不允许重叠日程')
      }
    }
  }
}

export class PlaylistStore {
  constructor(private readonly database: StoreDatabase) {}

  async create(input: CreatePlaylistInput) {
    const parsed = CreatePlaylistSchema.parse(input)
    assertNoScheduleOverlap(parsed.schedule)
    return this.database.transaction(async (transaction) => {
      const normalizedItems: Array<PlaylistItem & {
        version: number
        versionId: number
      }> = []
      for (const item of parsed.items) {
        const version = item.versionId
          ? await transaction.get<VersionRow>(
              `SELECT id, template_id, version_no
               FROM screen_versions
               WHERE id = ?`,
              [item.versionId],
            )
          : await transaction.get<VersionRow>(
              `SELECT id, template_id, version_no
               FROM screen_versions
               WHERE template_id = ? AND version_no = ?`,
              [item.templateId, item.version],
            )
        if (!version) throw new Error('播放列表只能引用已发布版本')
        if (version.template_id !== item.templateId) {
          throw new Error('播放列表版本与模板不匹配')
        }
        normalizedItems.push({
          ...item,
          version: Number(version.version_no),
          versionId: Number(version.id),
        })
      }

      const schedule = SafeJsonSchema.parse(parsed.schedule) as JsonValue
      const result = await transaction.run(
        `INSERT INTO screen_playlists
          (name, owner_user_id, items_json, schedule_json, enabled)
         VALUES (?, ?, ?, ?, 1)`,
        [
          parsed.name,
          parsed.ownerUserId,
          JSON.stringify(normalizedItems),
          JSON.stringify(schedule),
        ],
      )

      return {
        id: result.insertId,
        name: parsed.name,
        ownerUserId: parsed.ownerUserId,
        items: normalizedItems,
        schedule,
        enabled: true,
      }
    })
  }

  async get(playlistId: number) {
    if (!Number.isInteger(playlistId) || playlistId <= 0) {
      throw new Error('播放列表 ID 无效')
    }
    const row = await this.database.get<PlaylistRow>(
      `SELECT id, name, owner_user_id, items_json, schedule_json, enabled
       FROM screen_playlists
       WHERE id = ?`,
      [playlistId],
    )
    if (!row) throw new Error('播放列表不存在')
    return {
      id: Number(row.id),
      name: row.name,
      ownerUserId: Number(row.owner_user_id),
      items: parseJson(row.items_json),
      schedule: parseJson(row.schedule_json) || [],
      enabled: Boolean(row.enabled),
    }
  }

  async list(ownerUserId: number) {
    const rows = await this.database.query<PlaylistRow>(
      `SELECT id, name, owner_user_id, items_json, schedule_json, enabled
       FROM screen_playlists
       WHERE owner_user_id = ?
       ORDER BY updated_at DESC`,
      [ownerUserId],
    )
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      ownerUserId: Number(row.owner_user_id),
      items: parseJson(row.items_json),
      schedule: parseJson(row.schedule_json) || [],
      enabled: Boolean(row.enabled),
    }))
  }
}

import { z } from 'zod'

import { SafeJsonSchema, type JsonValue } from './contracts.js'
import type { StoreDatabase } from './store-types.js'

const PlaylistItemSchema = z.object({
  templateId: z.string().regex(/^(sca|train|remind)-0[1-9]$/),
  versionId: z.number().int().positive(),
  durationSeconds: z.number().int().min(5).max(3600),
})

const CreatePlaylistSchema = z.object({
  name: z.string().trim().min(1).max(80),
  ownerUserId: z.number().int().positive(),
  items: z.array(PlaylistItemSchema).min(1).max(100),
  schedule: SafeJsonSchema.optional(),
})

type CreatePlaylistInput = z.input<typeof CreatePlaylistSchema>
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>

interface VersionRow {
  id: number | string
  template_id: string
  version_no: number | string
}

export class PlaylistStore {
  constructor(private readonly database: StoreDatabase) {}

  async create(input: CreatePlaylistInput) {
    const parsed = CreatePlaylistSchema.parse(input)
    return this.database.transaction(async (transaction) => {
      for (const item of parsed.items) {
        const version = await transaction.get<VersionRow>(
          `SELECT id, template_id, version_no
           FROM screen_versions
           WHERE id = ?`,
          [item.versionId],
        )
        if (!version) throw new Error('播放列表只能引用已发布版本')
        if (version.template_id !== item.templateId) {
          throw new Error('播放列表版本与模板不匹配')
        }
      }

      const schedule = parsed.schedule === undefined
        ? null
        : SafeJsonSchema.parse(parsed.schedule) as JsonValue
      const result = await transaction.run(
        `INSERT INTO screen_playlists
          (name, owner_user_id, items_json, schedule_json, enabled)
         VALUES (?, ?, ?, ?, 1)`,
        [
          parsed.name,
          parsed.ownerUserId,
          JSON.stringify(parsed.items),
          schedule === null ? null : JSON.stringify(schedule),
        ],
      )

      return {
        id: result.insertId,
        name: parsed.name,
        ownerUserId: parsed.ownerUserId,
        items: parsed.items,
        schedule,
        enabled: true,
      }
    })
  }
}

import { createHash, randomBytes } from 'node:crypto'

import { config } from './config.js'
import { SystemKeySchema, type SystemKey } from './contracts.js'
import type { StoreDatabase } from './store-types.js'

interface PlayTokenRow {
  owner_user_id: number | string
  allowed_systems_json: string | SystemKey[]
  playlist_id: number | string | null
  expires_at: string | Date
}

export interface IssuePlayTokenInput {
  ownerUserId: number
  allowedSystems: SystemKey[]
  playlistId?: number | null
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export class PlayTokenStore {
  constructor(private readonly database: StoreDatabase) {}

  async issue(input: IssuePlayTokenInput) {
    const allowedSystems = SystemKeySchema.array().min(1).parse(
      Array.from(new Set(input.allowedSystems)),
    )
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + config.playTokenTtlMs)
    const result = await this.database.run(
      `INSERT INTO screen_play_tokens
        (token_hash, owner_user_id, allowed_systems_json, playlist_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        hashToken(token),
        input.ownerUserId,
        JSON.stringify(allowedSystems),
        input.playlistId ?? null,
        expiresAt,
      ],
    )
    return { id: result.insertId, token, expiresAt, allowedSystems }
  }

  async validate(token: string) {
    if (!token) return null
    const row = await this.database.get<PlayTokenRow>(
      `SELECT owner_user_id, allowed_systems_json, playlist_id, expires_at
       FROM screen_play_tokens
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)`,
      [hashToken(token)],
    )
    if (!row) return null
    const rawSystems = typeof row.allowed_systems_json === 'string'
      ? JSON.parse(row.allowed_systems_json)
      : row.allowed_systems_json
    return {
      ownerUserId: Number(row.owner_user_id),
      allowedSystems: SystemKeySchema.array().parse(rawSystems),
      playlistId: row.playlist_id === null ? null : Number(row.playlist_id),
      expiresAt: new Date(row.expires_at),
    }
  }

  async revoke(token: string) {
    if (!token) return false
    const result = await this.database.run(
      `UPDATE screen_play_tokens
       SET revoked_at = CURRENT_TIMESTAMP(3)
       WHERE token_hash = ? AND revoked_at IS NULL`,
      [hashToken(token)],
    )
    return result.affectedRows > 0
  }

  async revokeByOwner(ownerUserId: number) {
    const result = await this.database.run(
      `UPDATE screen_play_tokens
       SET revoked_at = CURRENT_TIMESTAMP(3)
       WHERE owner_user_id = ? AND revoked_at IS NULL`,
      [ownerUserId],
    )
    return result.affectedRows
  }
}

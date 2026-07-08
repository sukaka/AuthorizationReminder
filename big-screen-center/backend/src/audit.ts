import { SafeJsonSchema, type JsonValue } from './contracts.js'
import type { PickSqlRunner } from './store-types.js'

export interface AuditEvent {
  actorUserId: number
  action: string
  entityType: string
  entityId: string | number
  detail: JsonValue
}

const safeAuditLabel = (value: string, label: string, maxLength: number) => {
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || !/^[a-zA-Z0-9:._-]+$/.test(normalized)) {
    throw new Error(`${label} is invalid`)
  }
  return normalized
}

export const writeAuditEvent = async (database: PickSqlRunner, event: AuditEvent) => {
  const detail = SafeJsonSchema.parse(event.detail)
  const result = await database.run(
    `INSERT INTO screen_audit_logs
      (actor_user_id, action, entity_type, entity_id, detail_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      event.actorUserId,
      safeAuditLabel(event.action, 'action', 64),
      safeAuditLabel(event.entityType, 'entityType', 32),
      String(event.entityId).slice(0, 64),
      JSON.stringify(detail),
    ],
  )
  return result.insertId
}

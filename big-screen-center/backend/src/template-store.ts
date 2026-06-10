import { screenCatalog } from './catalog.js'
import { SafeJsonSchema, type JsonValue } from './contracts.js'
import type { StoreDatabase } from './store-types.js'

interface DraftRow {
  config_json: string | JsonValue
}

interface LatestVersionRow {
  version_no: number | string
}

export interface PublishedTemplateVersion {
  id: number
  templateId: string
  version: number
  config: JsonValue
  publishedBy: number
}

const knownTemplateIds = new Set(screenCatalog.map((template) => template.id))

const assertTemplateId = (templateId: string) => {
  if (!knownTemplateIds.has(templateId)) throw new Error('未知大屏模板')
}

const parseStoredJson = (value: string | JsonValue) =>
  SafeJsonSchema.parse(typeof value === 'string' ? JSON.parse(value) : value)

export class TemplateStore {
  constructor(private readonly database: StoreDatabase) {}

  async saveDraft(templateId: string, ownerUserId: number, config: JsonValue) {
    assertTemplateId(templateId)
    const safeConfig = SafeJsonSchema.parse(config)
    await this.database.run(
      `INSERT INTO screen_drafts (template_id, owner_user_id, config_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = CURRENT_TIMESTAMP(3)`,
      [templateId, ownerUserId, JSON.stringify(safeConfig)],
    )
    return { templateId, ownerUserId, config: safeConfig }
  }

  async publish(templateId: string, publishedBy: number): Promise<PublishedTemplateVersion> {
    assertTemplateId(templateId)
    return this.database.transaction(async (transaction) => {
      const draft = await transaction.get<DraftRow>(
        `SELECT config_json
         FROM screen_drafts
         WHERE template_id = ? AND owner_user_id = ?
         FOR UPDATE`,
        [templateId, publishedBy],
      )
      if (!draft) throw new Error('请先保存模板草稿')

      const latest = await transaction.get<LatestVersionRow>(
        `SELECT COALESCE(MAX(version_no), 0) AS version_no
         FROM screen_versions
         WHERE template_id = ?
         FOR UPDATE`,
        [templateId],
      )
      const version = Number(latest?.version_no || 0) + 1
      const safeConfig = parseStoredJson(draft.config_json)
      const result = await transaction.run(
        `INSERT INTO screen_versions (template_id, version_no, config_json, published_by)
         VALUES (?, ?, ?, ?)`,
        [templateId, version, JSON.stringify(safeConfig), publishedBy],
      )

      return {
        id: result.insertId,
        templateId,
        version,
        config: safeConfig,
        publishedBy,
      }
    })
  }
}

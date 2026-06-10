import { screenCatalog } from './catalog.js'
import { SafeJsonSchema, type JsonValue } from './contracts.js'
import type { StoreDatabase } from './store-types.js'

interface DraftRow {
  config_json: string | JsonValue
}

interface VersionRow {
  id: number | string
  template_id: string
  version_no: number | string
  config_json: string | JsonValue
  published_by: number | string
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

  async getDraft(templateId: string, ownerUserId: number) {
    assertTemplateId(templateId)
    const draft = await this.database.get<DraftRow>(
      `SELECT config_json
       FROM screen_drafts
       WHERE template_id = ? AND owner_user_id = ?`,
      [templateId, ownerUserId],
    )
    return draft ? parseStoredJson(draft.config_json) : null
  }

  async listVersions(templateId: string): Promise<PublishedTemplateVersion[]> {
    assertTemplateId(templateId)
    const rows = await this.database.query<VersionRow>(
      `SELECT id, template_id, version_no, config_json, published_by
       FROM screen_versions
       WHERE template_id = ?
       ORDER BY version_no DESC`,
      [templateId],
    )
    return rows.map((row) => ({
      id: Number(row.id),
      templateId: row.template_id,
      version: Number(row.version_no),
      config: parseStoredJson(row.config_json),
      publishedBy: Number(row.published_by),
    }))
  }

  async getVersion(templateId: string, version: number) {
    assertTemplateId(templateId)
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error('模板版本号无效')
    }
    const row = await this.database.get<VersionRow>(
      `SELECT id, template_id, version_no, config_json, published_by
       FROM screen_versions
       WHERE template_id = ? AND version_no = ?`,
      [templateId, version],
    )
    if (!row) throw new Error('模板历史版本不存在')
    return {
      id: Number(row.id),
      templateId: row.template_id,
      version: Number(row.version_no),
      config: parseStoredJson(row.config_json),
      publishedBy: Number(row.published_by),
    }
  }

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

  async rollback(
    templateId: string,
    historicalVersion: number,
    publishedBy: number,
  ) {
    const historical = await this.getVersion(templateId, historicalVersion)
    await this.saveDraft(templateId, publishedBy, historical.config)
    return this.publish(templateId, publishedBy)
  }
}

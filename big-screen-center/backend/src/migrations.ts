import type { PickSqlRunner } from './store-types.js'

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS screen_drafts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id VARCHAR(32) NOT NULL,
    owner_user_id BIGINT NOT NULL,
    config_json JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_screen_draft_owner (template_id, owner_user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS screen_versions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id VARCHAR(32) NOT NULL,
    version_no INT NOT NULL,
    config_json JSON NOT NULL,
    published_by BIGINT NOT NULL,
    published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_screen_version (template_id, version_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS screen_playlists (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(80) NOT NULL,
    owner_user_id BIGINT NOT NULL,
    items_json JSON NOT NULL,
    schedule_json JSON NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS screen_audit_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_user_id BIGINT NOT NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    detail_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_screen_audit_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS metric_snapshots (
    cache_key VARCHAR(160) PRIMARY KEY,
    envelope_json JSON NOT NULL,
    source_updated_at DATETIME(3) NULL,
    expires_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS screen_play_tokens (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    token_hash CHAR(64) NOT NULL,
    owner_user_id BIGINT NOT NULL,
    allowed_systems_json JSON NOT NULL,
    playlist_id BIGINT NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_screen_play_token_hash (token_hash),
    KEY idx_screen_play_token_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS screen_resource_packs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    pack_key VARCHAR(64) NOT NULL,
    version_no INT NOT NULL,
    manifest_json JSON NOT NULL,
    sha256 CHAR(64) NOT NULL,
    signature_base64 TEXT NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    uploaded_by BIGINT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_screen_resource_pack_version (pack_key, version_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
] as const

export const runMigrations = async (database: PickSqlRunner) => {
  for (const statement of migrationStatements) {
    await database.run(statement)
  }
}

export { migrationStatements }

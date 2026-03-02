const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'tender_user';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || 'tender_pass';
const DB_NAME = process.env.MYSQL_DATABASE || 'juxin_tender';
const DB_CONN_LIMIT = Number(process.env.DB_CONNECTION_LIMIT || 10);
const DB_RETRIES = Number(process.env.DB_CONNECT_RETRIES || 30);
const DB_RETRY_DELAY = Number(process.env.DB_CONNECT_DELAY_MS || 2000);

let pool;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureSafeIdentifier = (value, name) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value || '')) {
    throw new Error(`${name} contains unsafe characters`);
  }
  return value;
};

const buildPool = ({ database, user, password } = {}) =>
  mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: user || DB_USER,
    password: password !== undefined ? password : DB_PASSWORD,
    database,
    waitForConnections: true,
    connectionLimit: DB_CONN_LIMIT,
    dateStrings: true,
  });

const waitForDb = async (targetPool, label = 'database') => {
  for (let i = 0; i < DB_RETRIES; i += 1) {
    try {
      await targetPool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === DB_RETRIES - 1) throw err;
      console.warn(`[db] waiting for ${label}... (${i + 1}/${DB_RETRIES})`);
      await sleep(DB_RETRY_DELAY);
    }
  }
};

const bootstrapDatabase = async () => {
  const adminUser = process.env.MYSQL_ADMIN_USER || DB_USER;
  const adminPassword = process.env.MYSQL_ADMIN_PASSWORD !== undefined ? process.env.MYSQL_ADMIN_PASSWORD : DB_PASSWORD;

  const safeDbName = ensureSafeIdentifier(DB_NAME, 'MYSQL_DATABASE');
  const safeAppUser = ensureSafeIdentifier(DB_USER, 'MYSQL_USER');

  const adminPool = buildPool({ user: adminUser, password: adminPassword });
  await waitForDb(adminPool, 'mysql admin connection');

  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    if (DB_PASSWORD !== undefined && DB_PASSWORD !== null) {
      await adminPool.query(`CREATE USER IF NOT EXISTS '${safeAppUser}'@'%' IDENTIFIED BY ?`, [String(DB_PASSWORD)]);
      await adminPool.query(`ALTER USER '${safeAppUser}'@'%' IDENTIFIED BY ?`, [String(DB_PASSWORD)]);
    } else {
      await adminPool.query(`CREATE USER IF NOT EXISTS '${safeAppUser}'@'%'`);
    }
    await adminPool.query(`GRANT ALL PRIVILEGES ON \`${safeDbName}\`.* TO '${safeAppUser}'@'%'`);
    await adminPool.query('FLUSH PRIVILEGES');
  } finally {
    await adminPool.end();
  }
};

const query = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows;
};

const get = async (sql, params = []) => {
  const rows = await query(sql, params);
  return rows[0] || null;
};

const run = async (sql, params = []) => {
  const [result] = await pool.execute(sql, params);
  return result;
};

const transaction = async (fn) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tx = {
      query: async (sql, params = []) => {
        const [rows] = await conn.query(sql, params);
        return rows;
      },
      get: async (sql, params = []) => {
        const [rows] = await conn.query(sql, params);
        return rows[0] || null;
      },
      run: async (sql, params = []) => {
        const [result] = await conn.execute(sql, params);
        return result;
      },
    };

    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const createSchema = async () => {
  await run(`CREATE TABLE IF NOT EXISTS tender_bids (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_no VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    summary TEXT NULL,
    current_version_id BIGINT NULL,
    submitted_at DATETIME NULL,
    submitted_by_id BIGINT NULL,
    submitted_by_name VARCHAR(128) NULL,
    archived_at DATETIME NULL,
    archived_by_id BIGINT NULL,
    archived_by_name VARCHAR(128) NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_bids_no (bid_no),
    INDEX idx_tender_bids_status (status, updated_at),
    INDEX idx_tender_bids_customer (customer_name, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    version_no INT NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'snapshot',
    source_ext VARCHAR(16) NOT NULL DEFAULT 'docx',
    storage_path VARCHAR(512) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_versions_bid_no (bid_id, version_no),
    INDEX idx_tender_versions_bid (bid_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_drafts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    base_version_id BIGINT NULL,
    draft_file_path VARCHAR(512) NOT NULL,
    draft_file_name VARCHAR(255) NOT NULL,
    draft_ext VARCHAR(16) NOT NULL DEFAULT 'docx',
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    last_saved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_drafts_bid (bid_id),
    INDEX idx_tender_drafts_updated (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_editor_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_key VARCHAR(64) NOT NULL,
    bid_id BIGINT NOT NULL,
    version_id BIGINT NULL,
    draft_id BIGINT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    callback_token VARCHAR(128) NOT NULL,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME NULL,
    closed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_editor_session_key (session_key),
    INDEX idx_tender_editor_sessions_bid (bid_id, status, updated_at),
    INDEX idx_tender_editor_sessions_user (user_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_template_fields (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    field_code VARCHAR(128) NOT NULL,
    field_name VARCHAR(255) NOT NULL,
    data_type VARCHAR(32) NOT NULL DEFAULT 'text',
    default_value TEXT NULL,
    required_flag TINYINT NOT NULL DEFAULT 0,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_template_fields_code (field_code),
    INDEX idx_tender_template_fields_active (is_active, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_template_snippets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    snippet_code VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(64) NULL,
    tags_json TEXT NULL,
    content LONGTEXT NOT NULL,
    version_no INT NOT NULL DEFAULT 1,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_template_snippets_code (snippet_code),
    INDEX idx_tender_template_snippets_category (category, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_template_bundles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bundle_code VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    bid_type VARCHAR(64) NULL,
    description TEXT NULL,
    version_no INT NOT NULL DEFAULT 1,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_template_bundles_code (bundle_code),
    INDEX idx_tender_template_bundles_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_template_bundle_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bundle_id BIGINT NOT NULL,
    item_type VARCHAR(16) NOT NULL,
    ref_id BIGINT NOT NULL,
    bind_key VARCHAR(128) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_template_bundle_items_bundle (bundle_id, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_field_values (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    field_code VARCHAR(128) NOT NULL,
    field_value LONGTEXT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_bid_field_values (bid_id, field_code),
    INDEX idx_tender_bid_field_values_bid (bid_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_assets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NULL,
    asset_type VARCHAR(32) NOT NULL DEFAULT 'OTHER',
    original_file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NULL,
    storage_path VARCHAR(512) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'UPLOADED',
    uploaded_by_id BIGINT NULL,
    uploaded_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_assets_bid (bid_id, created_at),
    INDEX idx_tender_assets_type (asset_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_asset_ocr_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_id BIGINT NOT NULL,
    doc_type VARCHAR(32) NOT NULL DEFAULT 'OTHER',
    ocr_text LONGTEXT NULL,
    fields_json LONGTEXT NULL,
    confidence DECIMAL(5,2) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'AUTO_EXTRACTED',
    reviewer_id BIGINT NULL,
    reviewer_name VARCHAR(128) NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_asset_ocr_results_asset (asset_id),
    INDEX idx_tender_asset_ocr_results_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_ai_models (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    model_key VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    provider_type VARCHAR(16) NOT NULL DEFAULT 'builtin',
    base_url VARCHAR(512) NULL,
    model_name VARCHAR(255) NULL,
    api_key_enc TEXT NULL,
    extra_headers_json TEXT NULL,
    timeout_ms INT NOT NULL DEFAULT 20000,
    max_tokens INT NOT NULL DEFAULT 4096,
    temperature_default DECIMAL(4,2) NOT NULL DEFAULT 0.30,
    is_enabled TINYINT NOT NULL DEFAULT 1,
    is_default TINYINT NOT NULL DEFAULT 0,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_ai_models_key (model_key),
    INDEX idx_tender_ai_models_enabled (is_enabled, is_default, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_ai_prompts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_type VARCHAR(32) NOT NULL,
    prompt_template LONGTEXT NOT NULL,
    is_active TINYINT NOT NULL DEFAULT 1,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_ai_prompts_task (task_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_ai_task_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_type VARCHAR(32) NOT NULL,
    model_id BIGINT NOT NULL,
    model_name VARCHAR(255) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    latency_ms INT NULL,
    prompt_tokens INT NULL,
    completion_tokens INT NULL,
    total_tokens INT NULL,
    request_hash CHAR(64) NULL,
    response_hash CHAR(64) NULL,
    error_message TEXT NULL,
    operator_id BIGINT NULL,
    operator_name VARCHAR(128) NULL,
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_ai_task_logs_task (task_type, created_at),
    INDEX idx_tender_ai_task_logs_model (model_id, created_at),
    INDEX idx_tender_ai_task_logs_operator (operator_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_system_configs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(128) NOT NULL,
    value LONGTEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_system_configs_key (\`key\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_operation_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NULL,
    username VARCHAR(128) NULL,
    user_role VARCHAR(32) NULL,
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NOT NULL,
    entity_id BIGINT NULL,
    message VARCHAR(255) NULL,
    before_data LONGTEXT NULL,
    after_data LONGTEXT NULL,
    prev_hash CHAR(64) NULL,
    signature CHAR(64) NULL,
    sign_version VARCHAR(16) NOT NULL DEFAULT 'v1',
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_operation_logs_action (action, created_at),
    INDEX idx_tender_operation_logs_entity (entity, entity_id, created_at),
    INDEX idx_tender_operation_logs_user (username, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const modelCountRow = await get('SELECT COUNT(1) AS count FROM tender_ai_models');
  if (Number(modelCountRow?.count || 0) === 0) {
    await run(
      `INSERT INTO tender_ai_models
       (model_key, name, provider_type, base_url, model_name, api_key_enc, is_enabled, is_default, timeout_ms, max_tokens, temperature_default)
       VALUES
       ('aliyun_qwen_3_5', '千问3.5', 'builtin', '', 'qwen3.5', NULL, 1, 0, 20000, 4096, 0.30),
       ('aliyun_kimi_2_5', 'kimi2.5', 'builtin', '', 'kimi-2.5', NULL, 1, 1, 20000, 4096, 0.30),
       ('aliyun_claude', 'claude', 'builtin', '', 'claude', NULL, 1, 0, 20000, 4096, 0.30)`
    );
  }

  const promptCountRow = await get('SELECT COUNT(1) AS count FROM tender_ai_prompts');
  if (Number(promptCountRow?.count || 0) === 0) {
    await run(
      `INSERT INTO tender_ai_prompts (task_type, prompt_template, is_active)
       VALUES
       ('OCR_STRUCTURED', '你是资质与证照信息抽取助手。请将输入文本抽取为JSON，字段：doc_type,title,certificate_no,subject,issuer,valid_from,valid_to,summary,confidence。仅输出JSON。', 1),
       ('REWRITE', '你是中文标书写作助手。请在不改变事实的前提下，润色并增强专业表达。输出：改写正文。', 1),
       ('PROOFREAD', '你是标书合规校对助手。识别错漏与风险，输出JSON数组，每项含：type,level,message,suggestion。仅输出JSON。', 1)`
    );
  }

  const defaultModelRow = await get('SELECT id FROM tender_ai_models WHERE is_default = 1 LIMIT 1');
  if (!defaultModelRow) {
    await run(
      `UPDATE tender_ai_models
       SET is_default = CASE WHEN model_key = 'aliyun_kimi_2_5' THEN 1 ELSE 0 END`
    );
  }
};

const initDb = async () => {
  await bootstrapDatabase();
  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, 'tender database');
  await createSchema();
};

module.exports = {
  initDb,
  query,
  get,
  run,
  transaction,
};

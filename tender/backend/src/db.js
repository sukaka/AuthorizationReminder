const mysql = require('mysql2/promise');
const {
  buildValidationRuleSeed,
  buildMissingValidationRules,
} = require('./validation-rule-library');

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
    source_kb_project_id BIGINT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    review_status VARCHAR(16) NOT NULL DEFAULT 'draft',
    review_stage VARCHAR(32) NULL,
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

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_draft_autosaves (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    draft_id BIGINT NULL,
    version_id BIGINT NULL,
    storage_path VARCHAR(512) NULL,
    file_name VARCHAR(255) NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    source VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    content_hash CHAR(64) NULL,
    note VARCHAR(255) NULL,
    saved_by_id BIGINT NULL,
    saved_by_name VARCHAR(128) NULL,
    saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_draft_autosaves_bid (bid_id, saved_at),
    INDEX idx_tender_bid_draft_autosaves_draft (draft_id, saved_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_export_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    version_id BIGINT NULL,
    draft_id BIGINT NULL,
    export_type VARCHAR(16) NOT NULL DEFAULT 'DOCX',
    status VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    storage_path VARCHAR(512) NULL,
    file_name VARCHAR(255) NULL,
    mime_type VARCHAR(128) NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    payload_json LONGTEXT NULL,
    result_json LONGTEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_export_records_bid (bid_id, created_at),
    INDEX idx_tender_bid_export_records_status (status, export_type, updated_at),
    INDEX idx_tender_bid_export_records_version (version_id, created_at)
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

  await run(`CREATE TABLE IF NOT EXISTS tender_eval_datasets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    dataset_code VARCHAR(64) NOT NULL,
    dataset_name VARCHAR(255) NOT NULL,
    eval_type VARCHAR(32) NOT NULL,
    source_bid_id BIGINT NOT NULL,
    baseline_flag TINYINT NOT NULL DEFAULT 1,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    expected_payload_json LONGTEXT NULL,
    notes TEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_eval_datasets_code (dataset_code),
    INDEX idx_tender_eval_datasets_bid (source_bid_id, eval_type, status, updated_at),
    INDEX idx_tender_eval_datasets_baseline (baseline_flag, status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_eval_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_no VARCHAR(64) NOT NULL,
    run_label VARCHAR(255) NULL,
    run_scope VARCHAR(16) NOT NULL DEFAULT 'ADHOC',
    status VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    dataset_count INT NOT NULL DEFAULT 0,
    summary_json LONGTEXT NULL,
    baseline_summary_json LONGTEXT NULL,
    started_by_id BIGINT NULL,
    started_by_name VARCHAR(128) NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_eval_runs_no (run_no),
    INDEX idx_tender_eval_runs_scope (run_scope, created_at),
    INDEX idx_tender_eval_runs_status (status, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_eval_run_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id BIGINT NOT NULL,
    dataset_id BIGINT NOT NULL,
    eval_type VARCHAR(32) NOT NULL,
    source_bid_id BIGINT NOT NULL,
    score DECIMAL(7,4) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'PASS',
    result_json LONGTEXT NULL,
    delta_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_eval_run_items_run (run_id, id),
    INDEX idx_tender_eval_run_items_dataset (dataset_id, created_at),
    INDEX idx_tender_eval_run_items_bid (source_bid_id, eval_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_samples (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sample_no VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    source_ext VARCHAR(16) NOT NULL DEFAULT '.docx',
    storage_path VARCHAR(512) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NULL,
    parse_status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    parse_error TEXT NULL,
    parsed_text LONGTEXT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    uploaded_by_id BIGINT NULL,
    uploaded_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_bid_samples_no (sample_no),
    INDEX idx_tender_bid_samples_status (status, parse_status, updated_at),
    INDEX idx_tender_bid_samples_title (title, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_sample_sections (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sample_id BIGINT NOT NULL,
    section_key VARCHAR(64) NOT NULL,
    section_title VARCHAR(128) NOT NULL,
    section_text LONGTEXT NULL,
    summary_text TEXT NULL,
    keywords_json TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_bid_sample_sections (sample_id, section_key),
    INDEX idx_tender_bid_sample_sections_sample (sample_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_sample_features (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sample_id BIGINT NOT NULL,
    feature_key VARCHAR(64) NOT NULL,
    feature_value VARCHAR(255) NOT NULL,
    feature_weight DECIMAL(7,4) NOT NULL DEFAULT 1.0000,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_sample_features_sample (sample_id),
    INDEX idx_tender_bid_sample_features_key (feature_key, feature_value)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_generate_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    source_file_name VARCHAR(255) NOT NULL,
    source_storage_path VARCHAR(512) NOT NULL,
    source_ext VARCHAR(16) NOT NULL DEFAULT '.docx',
    source_mime_type VARCHAR(128) NULL,
    source_file_size BIGINT NOT NULL DEFAULT 0,
    model_id BIGINT NULL,
    model_name VARCHAR(255) NULL,
    bid_category VARCHAR(16) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ANALYZING',
    progress INT NOT NULL DEFAULT 0,
    section_summaries_json LONGTEXT NULL,
    analysis_summary_json LONGTEXT NULL,
    warning_text TEXT NULL,
    error_message TEXT NULL,
    created_bid_id BIGINT NULL,
    created_version_id BIGINT NULL,
    created_draft_id BIGINT NULL,
    source_kb_project_ids_json LONGTEXT NULL,
    operator_id BIGINT NULL,
    operator_name VARCHAR(128) NULL,
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_generate_jobs_status (status, updated_at),
    INDEX idx_tender_bid_generate_jobs_operator (operator_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_generate_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    item_type VARCHAR(16) NOT NULL,
    section_key VARCHAR(64) NULL,
    section_title VARCHAR(128) NULL,
    title VARCHAR(255) NOT NULL,
    evidence_text TEXT NULL,
    suggestion_text TEXT NULL,
    risk_level VARCHAR(16) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_generate_items_job (job_id, item_type, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_generate_matches (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    sample_id BIGINT NOT NULL,
    source_kb_case_id BIGINT NULL,
    score DECIMAL(7,4) NOT NULL DEFAULT 0,
    reason_text VARCHAR(512) NULL,
    rank_no INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_bid_generate_matches_rank (job_id, rank_no),
    INDEX idx_tender_bid_generate_matches_job (job_id, score)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_parse_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    parse_scope VARCHAR(32) NOT NULL DEFAULT 'FULL',
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    progress INT NOT NULL DEFAULT 0,
    file_count INT NOT NULL DEFAULT 0,
    merged_fields_json LONGTEXT NULL,
    field_sources_json LONGTEXT NULL,
    summary_json LONGTEXT NULL,
    warning_text TEXT NULL,
    error_message TEXT NULL,
    operator_id BIGINT NULL,
    operator_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_parse_jobs_bid (bid_id, id),
    INDEX idx_tender_bid_parse_jobs_status (status, updated_at),
    INDEX idx_tender_bid_parse_jobs_operator (operator_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_parse_files (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    parse_job_id BIGINT NULL,
    parent_file_id BIGINT NULL,
    root_file_id BIGINT NULL,
    file_role VARCHAR(16) NOT NULL DEFAULT 'SUPPLEMENT',
    file_kind VARCHAR(24) NOT NULL DEFAULT 'UPLOAD',
    status VARCHAR(16) NOT NULL DEFAULT 'UPLOADED',
    source_depth INT NOT NULL DEFAULT 0,
    relative_path VARCHAR(512) NULL,
    original_file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    source_ext VARCHAR(16) NOT NULL,
    source_mime_type VARCHAR(128) NULL,
    storage_path VARCHAR(512) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    sheet_manifest_json LONGTEXT NULL,
    selected_sheets_json LONGTEXT NULL,
    parse_summary_json LONGTEXT NULL,
    uploaded_by_id BIGINT NULL,
    uploaded_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_parse_files_bid (bid_id, id),
    INDEX idx_tender_bid_parse_files_root (root_file_id, parent_file_id, id),
    INDEX idx_tender_bid_parse_files_role (bid_id, file_role, status, updated_at),
    INDEX idx_tender_bid_parse_files_job (parse_job_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_parse_clauses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    parse_job_id BIGINT NOT NULL,
    source_file_id BIGINT NULL,
    clause_code VARCHAR(64) NULL,
    clause_title VARCHAR(255) NULL,
    clause_text LONGTEXT NOT NULL,
    clause_type VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
    response_mode VARCHAR(32) NOT NULL DEFAULT 'TEXT',
    mandatory_flag TINYINT(1) NOT NULL DEFAULT 0,
    scoring_flag TINYINT(1) NOT NULL DEFAULT 0,
    score_value DECIMAL(10,2) NULL,
    source_role VARCHAR(16) NOT NULL DEFAULT 'SUPPLEMENT',
    sort_order INT NOT NULL DEFAULT 0,
    metadata_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_parse_clauses_job (parse_job_id, sort_order, id),
    INDEX idx_tender_bid_parse_clauses_bid (bid_id, clause_type, updated_at),
    INDEX idx_tender_bid_parse_clauses_source (source_file_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_parse_tables (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    parse_job_id BIGINT NOT NULL,
    source_file_id BIGINT NULL,
    table_name VARCHAR(255) NULL,
    source_sheet_name VARCHAR(255) NULL,
    row_count INT NOT NULL DEFAULT 0,
    column_count INT NOT NULL DEFAULT 0,
    summary_text TEXT NULL,
    header_json LONGTEXT NULL,
    rows_json LONGTEXT NULL,
    source_role VARCHAR(16) NOT NULL DEFAULT 'SUPPLEMENT',
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_parse_tables_job (parse_job_id, sort_order, id),
    INDEX idx_tender_bid_parse_tables_bid (bid_id, updated_at),
    INDEX idx_tender_bid_parse_tables_source (source_file_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_parse_matches (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    parse_job_id BIGINT NOT NULL,
    clause_id BIGINT NOT NULL,
    asset_id BIGINT NULL,
    match_status VARCHAR(16) NOT NULL DEFAULT 'RECOMMENDED',
    confidence DECIMAL(8,4) NOT NULL DEFAULT 0,
    reason_text TEXT NULL,
    match_source VARCHAR(16) NOT NULL DEFAULT 'RULE',
    payload_json LONGTEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_parse_matches_job (parse_job_id, clause_id, updated_at),
    INDEX idx_tender_bid_parse_matches_bid (bid_id, match_status, updated_at),
    INDEX idx_tender_bid_parse_matches_asset (asset_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_requirement_registry (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    requirement_code VARCHAR(64) NOT NULL,
    bid_category VARCHAR(16) NULL,
    requirement_type VARCHAR(32) NOT NULL,
    title VARCHAR(255) NULL,
    requirement_text TEXT NULL,
    section_key VARCHAR(64) NULL,
    section_title VARCHAR(128) NULL,
    suggestion_text TEXT NULL,
    risk_level VARCHAR(16) NULL,
    source_json LONGTEXT NULL,
    source_kb_clause_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_requirement_registry_code (job_id, requirement_code),
    INDEX idx_tender_requirement_registry_job (job_id, requirement_type, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_evidence_registry (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    evidence_code VARCHAR(64) NOT NULL,
    evidence_type VARCHAR(32) NOT NULL,
    title VARCHAR(255) NULL,
    evidence_text TEXT NULL,
    library_record_id BIGINT NULL,
    source_table VARCHAR(64) NULL,
    source_kb_id BIGINT NULL,
    source_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_evidence_registry_code (bid_id, evidence_code),
    INDEX idx_tender_evidence_registry_bid (bid_id, evidence_type, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_draft_section_registry (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    version_id BIGINT NOT NULL,
    section_title VARCHAR(255) NULL,
    paragraph_no INT NOT NULL DEFAULT 0,
    paragraph_text LONGTEXT NULL,
    template_slot VARCHAR(128) NULL,
    source_kb_section_asset_id BIGINT NULL,
    requirement_ids_json LONGTEXT NULL,
    evidence_ids_json LONGTEXT NULL,
    score_item_ids_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_draft_section_registry_version (bid_id, version_id, paragraph_no, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_draft_artifact_rows (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    version_id BIGINT NOT NULL,
    artifact_type VARCHAR(32) NOT NULL,
    artifact_group VARCHAR(32) NOT NULL,
    row_no INT NOT NULL DEFAULT 0,
    row_json LONGTEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_draft_artifact_rows_bid (bid_id, version_id, artifact_type, artifact_group, row_no, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_draft_check_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    version_id BIGINT NULL,
    draft_id BIGINT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',
    summary_json LONGTEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_draft_check_runs_bid (bid_id, created_at),
    INDEX idx_tender_draft_check_runs_version (version_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_reviews (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    review_round INT NOT NULL DEFAULT 1,
    review_stage VARCHAR(32) NOT NULL DEFAULT 'COMPILE',
    review_status VARCHAR(16) NOT NULL DEFAULT 'submitted',
    submitted_by_id BIGINT NULL,
    submitted_by_name VARCHAR(128) NULL,
    reviewer_id BIGINT NULL,
    reviewer_name VARCHAR(128) NULL,
    review_comment TEXT NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    handled_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_bid_reviews_bid (bid_id, review_round, review_stage, id),
    INDEX idx_tender_bid_reviews_status (review_status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_bid_members (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    member_user_id BIGINT NULL,
    member_username VARCHAR(128) NOT NULL,
    member_role VARCHAR(32) NOT NULL DEFAULT 'OWNER',
    member_title VARCHAR(64) NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_bid_members_unique (bid_id, member_role, member_username),
    INDEX idx_tender_bid_members_bid (bid_id, member_role, updated_at),
    INDEX idx_tender_bid_members_user (member_user_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_draft_check_issues (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    check_run_id BIGINT NOT NULL,
    bid_id BIGINT NOT NULL,
    issue_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'WARN',
    title VARCHAR(255) NULL,
    message TEXT NULL,
    requirement_code VARCHAR(64) NULL,
    requirement_title VARCHAR(255) NULL,
    section_title VARCHAR(255) NULL,
    paragraph_text TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_draft_check_issues_run (check_run_id, sort_order, id),
    INDEX idx_tender_draft_check_issues_bid (bid_id, severity, issue_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_score_coverage_matrix (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    version_id BIGINT NULL,
    score_item_id VARCHAR(64) NOT NULL,
    source_kb_score_item_id BIGINT NULL,
    requirement_id BIGINT NULL,
    requirement_code VARCHAR(64) NULL,
    title VARCHAR(255) NULL,
    full_score DECIMAL(10,2) NOT NULL DEFAULT 0,
    coverage_status VARCHAR(16) NOT NULL DEFAULT 'NONE',
    optimization_needed_flag TINYINT NOT NULL DEFAULT 0,
    optimization_reason TEXT NULL,
    target_section_title VARCHAR(255) NULL,
    bound_evidence_ids_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_score_coverage_bid (bid_id, version_id, coverage_status, id),
    UNIQUE KEY uk_tender_score_coverage_item (bid_id, version_id, score_item_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_score_optimization_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    version_id BIGINT NULL,
    score_item_id VARCHAR(64) NOT NULL,
    suggestion_title VARCHAR(255) NULL,
    suggestion_text LONGTEXT NULL,
    evidence_ids_json LONGTEXT NULL,
    target_section_title VARCHAR(255) NULL,
    before_text LONGTEXT NULL,
    after_text LONGTEXT NULL,
    applied_flag TINYINT NOT NULL DEFAULT 0,
    applied_at DATETIME NULL,
    source VARCHAR(32) NULL,
    strategy_profile_key VARCHAR(128) NULL,
    audit_trace_json LONGTEXT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED',
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tender_score_opt_records_bid (bid_id, version_id, status, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tender_doc_templates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    template_no VARCHAR(64) NOT NULL,
    template_name VARCHAR(255) NOT NULL,
    kb_template_id BIGINT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    source_ext VARCHAR(16) NOT NULL DEFAULT '.docx',
    storage_path VARCHAR(512) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    is_default TINYINT NOT NULL DEFAULT 0,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tender_doc_templates_no (template_no),
    INDEX idx_tender_doc_templates_status (status, is_default, updated_at)
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

  await run(`CREATE TABLE IF NOT EXISTS kb_projects (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_name VARCHAR(255) NOT NULL,
    project_no VARCHAR(128) NULL,
    purchaser VARCHAR(255) NULL,
    industry_type VARCHAR(64) NULL,
    project_type VARCHAR(64) NULL,
    region VARCHAR(128) NULL,
    publish_date DATETIME NULL,
    bid_deadline DATETIME NULL,
    result_status VARCHAR(32) NULL,
    bid_amount DECIMAL(18,2) NULL,
    source_bid_id BIGINT NULL,
    tags_json LONGTEXT NULL,
    remarks TEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_kb_projects_no (project_no),
    INDEX idx_kb_projects_type (project_type, industry_type, result_status),
    INDEX idx_kb_projects_name (project_name, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_tender_clauses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kb_project_id BIGINT NOT NULL,
    clause_no VARCHAR(64) NULL,
    chapter_name VARCHAR(255) NULL,
    source_text LONGTEXT NOT NULL,
    clause_type VARCHAR(64) NULL,
    is_mandatory TINYINT NOT NULL DEFAULT 0,
    is_scoring_item TINYINT NOT NULL DEFAULT 0,
    score_value DECIMAL(10,2) NULL,
    response_mode VARCHAR(32) NULL,
    risk_level VARCHAR(16) NULL,
    source_page VARCHAR(64) NULL,
    source_position VARCHAR(255) NULL,
    source_file_path VARCHAR(512) NULL,
    tags_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_tender_clauses_project (kb_project_id, clause_type, id),
    INDEX idx_kb_tender_clauses_risk (risk_level, is_mandatory, is_scoring_item)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_score_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kb_project_id BIGINT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    full_score DECIMAL(10,2) NOT NULL DEFAULT 0,
    scoring_rule LONGTEXT NULL,
    recommended_response_points LONGTEXT NULL,
    priority_level VARCHAR(16) NULL,
    source_clause_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_score_items_project (kb_project_id, priority_level, id),
    INDEX idx_kb_score_items_name (item_name, full_score)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_company_qualifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    qualification_name VARCHAR(255) NOT NULL,
    qualification_type VARCHAR(64) NULL,
    issuer VARCHAR(255) NULL,
    valid_from DATETIME NULL,
    valid_to DATETIME NULL,
    file_path VARCHAR(512) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    applicable_industries LONGTEXT NULL,
    keywords LONGTEXT NULL,
    tags_json LONGTEXT NULL,
    reusable_flag TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_company_qualifications_status (status, valid_to, id),
    INDEX idx_kb_company_qualifications_type (qualification_type, qualification_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_product_specs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    brand VARCHAR(128) NULL,
    model VARCHAR(128) NULL,
    category VARCHAR(128) NULL,
    spec_key VARCHAR(255) NOT NULL,
    spec_value LONGTEXT NULL,
    evidence_file VARCHAR(512) NULL,
    version VARCHAR(64) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    tags_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_product_specs_model (product_name, brand, model, status),
    INDEX idx_kb_product_specs_key (spec_key, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_section_assets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kb_project_id BIGINT NULL,
    section_name VARCHAR(255) NOT NULL,
    sub_section_name VARCHAR(255) NULL,
    content LONGTEXT NOT NULL,
    quality_score DECIMAL(5,2) NULL,
    reusable_flag TINYINT NOT NULL DEFAULT 1,
    applicable_scene VARCHAR(128) NULL,
    industry_type VARCHAR(64) NULL,
    project_type VARCHAR(64) NULL,
    tags_json LONGTEXT NULL,
    source_file_path VARCHAR(512) NULL,
    source_clause_id BIGINT NULL,
    source_score_item_id BIGINT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_section_assets_scene (section_name, applicable_scene, reusable_flag),
    INDEX idx_kb_section_assets_project (kb_project_id, industry_type, project_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_project_cases (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    case_name VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NULL,
    industry_type VARCHAR(64) NULL,
    project_type VARCHAR(64) NULL,
    contract_amount DECIMAL(18,2) NULL,
    sign_date DATETIME NULL,
    core_products LONGTEXT NULL,
    summary LONGTEXT NULL,
    evidence_files LONGTEXT NULL,
    reusable_flag TINYINT NOT NULL DEFAULT 1,
    tags_json LONGTEXT NULL,
    source_project_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_project_cases_type (industry_type, project_type, sign_date),
    INDEX idx_kb_project_cases_name (case_name, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_personnel_assets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    role_type VARCHAR(64) NULL,
    certificates LONGTEXT NULL,
    years_of_experience INT NULL,
    resume_text LONGTEXT NULL,
    availability_status VARCHAR(32) NULL,
    file_path VARCHAR(512) NULL,
    tags_json LONGTEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_personnel_assets_role (role_type, availability_status, id),
    INDEX idx_kb_personnel_assets_name (name, years_of_experience)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_document_templates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    template_name VARCHAR(255) NOT NULL,
    project_type VARCHAR(64) NULL,
    document_type VARCHAR(64) NULL,
    version VARCHAR(64) NULL,
    structure_json LONGTEXT NULL,
    word_template_path VARCHAR(512) NULL,
    active_flag TINYINT NOT NULL DEFAULT 1,
    tags_json LONGTEXT NULL,
    source_runtime_template_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_document_templates_type (project_type, document_type, active_flag),
    INDEX idx_kb_document_templates_name (template_name, version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_validation_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    rule_name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(64) NOT NULL,
    trigger_condition LONGTEXT NULL,
    check_logic LONGTEXT NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    suggested_action TEXT NULL,
    active_flag TINYINT NOT NULL DEFAULT 1,
    tags_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_validation_rules_type (rule_type, active_flag, severity),
    INDEX idx_kb_validation_rules_name (rule_name, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_asset_chunks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_type VARCHAR(32) NOT NULL,
    source_table VARCHAR(64) NOT NULL,
    source_id BIGINT NOT NULL,
    kb_project_id BIGINT NULL,
    section_name VARCHAR(255) NULL,
    sub_section_name VARCHAR(255) NULL,
    chunk_type VARCHAR(32) NOT NULL,
    chunk_text LONGTEXT NOT NULL,
    tags_json LONGTEXT NULL,
    embedding_status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    embedding_model VARCHAR(128) NULL,
    embedding_vector_ref VARCHAR(255) NULL,
    quality_score DECIMAL(5,2) NULL,
    reusable_flag TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_asset_chunks_source (source_table, source_id, id),
    INDEX idx_kb_asset_chunks_project (kb_project_id, chunk_type, embedding_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS kb_ingest_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_type VARCHAR(64) NOT NULL,
    source_file VARCHAR(512) NULL,
    source_hash CHAR(64) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    input_payload LONGTEXT NULL,
    output_summary LONGTEXT NULL,
    error_message TEXT NULL,
    operator_id BIGINT NULL,
    operator_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kb_ingest_jobs_status (status, updated_at),
    INDEX idx_kb_ingest_jobs_type (job_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const ensureColumn = async (tableName, columnName, columnDefSql) => {
    const row = await get(
      `SELECT COUNT(1) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    if (Number(row?.count || 0) > 0) return;
    await run(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefSql}`);
  };

  await ensureColumn('tender_bid_generate_jobs', 'bid_category', "VARCHAR(16) NULL AFTER model_name");
  await ensureColumn('tender_bids', 'review_status', "VARCHAR(16) NOT NULL DEFAULT 'draft' AFTER status");
  await ensureColumn('tender_bids', 'review_stage', "VARCHAR(32) NULL AFTER review_status");
  await ensureColumn('tender_bids', 'source_kb_project_id', "BIGINT NULL AFTER project_name");
  await ensureColumn('tender_bid_generate_jobs', 'source_kb_project_ids_json', "LONGTEXT NULL AFTER created_draft_id");
  await ensureColumn('tender_bid_generate_matches', 'source_kb_case_id', "BIGINT NULL AFTER sample_id");
  await ensureColumn('tender_requirement_registry', 'source_kb_clause_id', "BIGINT NULL AFTER source_json");
  await ensureColumn('tender_score_coverage_matrix', 'source_kb_score_item_id', "BIGINT NULL AFTER score_item_id");
  await ensureColumn('tender_evidence_registry', 'source_table', "VARCHAR(64) NULL AFTER library_record_id");
  await ensureColumn('tender_evidence_registry', 'source_kb_id', "BIGINT NULL AFTER source_table");
  await ensureColumn('tender_draft_section_registry', 'source_kb_section_asset_id', "BIGINT NULL AFTER template_slot");
  await ensureColumn('tender_doc_templates', 'kb_template_id', "BIGINT NULL AFTER template_name");
  await ensureColumn('tender_score_optimization_records', 'target_section_title', "VARCHAR(255) NULL AFTER evidence_ids_json");
  await ensureColumn('tender_score_optimization_records', 'before_text', "LONGTEXT NULL AFTER target_section_title");
  await ensureColumn('tender_score_optimization_records', 'after_text', "LONGTEXT NULL AFTER before_text");
  await ensureColumn('tender_score_optimization_records', 'applied_flag', "TINYINT NOT NULL DEFAULT 0 AFTER after_text");
  await ensureColumn('tender_score_optimization_records', 'applied_at', "DATETIME NULL AFTER applied_flag");
  await ensureColumn('tender_score_optimization_records', 'source', "VARCHAR(32) NULL AFTER applied_at");
  await ensureColumn('tender_score_optimization_records', 'strategy_profile_key', "VARCHAR(128) NULL AFTER source");
  await ensureColumn('tender_score_optimization_records', 'audit_trace_json', "LONGTEXT NULL AFTER strategy_profile_key");

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
       ('PROOFREAD', '你是标书合规校对助手。识别错漏与风险，输出JSON数组，每项含：type,level,message,suggestion。仅输出JSON。', 1),
       ('BID_ANALYZE_STAGE1', '角色：你是政府采购招标文件风险审查专家（服务类优先）。任务：仅识别“可能导致投标无效/被否决/废标”的条款证据，逐条输出，不做归纳，不做改写。硬性规则：仅提取原文，逐字一致；一个条件一条；重复条款去重；仅输出JSON。必须检索关键词含同义触发：无效投标、投标无效、废标、否决投标、否决其投标、不予受理、不通过符合性审查、实质性要求、实质性条款、★、▲、*、不满足作无效投标处理、负偏离无效、投标报价超过最高限价、不得、必须、否则按无效处理。clause_type仅允许：QUALIFICATION_INVALID、COMPLIANCE_INVALID、PERSONNEL_INVALID、SERVICE_SCHEME_INVALID、SLA_INVALID、BUSINESS_INVALID、QUOTATION_INVALID、SIGNATURE_SEAL_INVALID、OTHER_INVALID。risk_level仅允许高或中。无结果返回{\"risk_clauses\":[]}。输出结构：{\"risk_clauses\":[{\"evidence_id\":\"RISK-0001\",\"clause_type\":\"\",\"clause_content\":\"\",\"trigger_keyword\":\"\",\"risk_level\":\"高\",\"source_reference\":{\"chapter\":\"\",\"page_number\":\"\"}}]}', 1),
       ('BID_ANALYZE_STAGE2', '角色：你是政府采购结构化解析专家。输入包含招标文件全文、章节摘要、阶段1风险条款。任务：输出完整Final JSON（字段结构固定）。强制章节检查：投标人须知、投标人须知前附表、采购需求、评标办法、合同条款、附件、评分表。规则：仅提取原文明确信息；禁止编造；出现冲突按“废标条款>投标人须知前附表>采购需求>评标办法>合同条款>其他正文”裁决；字符串空值填“未明确”；字符串数组空值填[\"未明确\"]；对象数组无明确条款时可返回空数组。仅输出JSON。', 1),
       ('BID_ANALYZE_STAGE3', '角色：你是政府采购审标专家（服务类项目）。输入包含阶段1结果、阶段2结果和招标文件全文。任务：做遗漏校验，仅检查：废标条款、实质性条款、SLA指标、人员资格要求、评分项、报价规则。判定规则：若原文存在而前两阶段未覆盖则记为遗漏；若阶段2字段为未明确但原文明确也记遗漏；仅引用原文不得改写；同条款按“前30字+章节”去重。item_type仅允许：INVALID_BID_CLAUSE、SUBSTANTIVE_REQUIREMENT、SLA_INDICATOR、PERSONNEL_REQUIREMENT、SCORING_ITEM、QUOTATION_RULE。输出：{\"missing_items\":[{\"item_type\":\"\",\"target_field_path\":\"\",\"missing_content\":\"\",\"source_reference\":{\"chapter\":\"\",\"page_number\":\"\"}}]}；无遗漏返回{\"missing_items\":[]}。', 1),
       ('BID_ANALYZE', '你是招标文件分析助手。根据输入输出JSON，字段：section_summaries(对象，6章节摘要)、scoring_items(数组)、risk_items(数组)、sample_rerank_ids(数组)。每个条目含title、section_key、evidence、suggestion、risk_level(仅风险项)。仅输出JSON。', 1),
       ('BID_COMPOSE_DRAFT', '你是投标文件起草助手。根据输入JSON输出JSON，字段：chapters(数组，元素含title与content)、cover_title、summary。不得输出Markdown，仅输出JSON。', 1)`
    );
  }

  const extraPrompts = [
    {
      task_type: 'BID_ANALYZE_STAGE1',
      prompt_template: '角色：你是政府采购招标文件风险审查专家（服务类优先）。任务：仅识别“可能导致投标无效/被否决/废标”的条款证据，逐条输出，不做归纳，不做改写。硬性规则：仅提取原文，逐字一致；一个条件一条；重复条款去重；仅输出JSON。必须检索关键词含同义触发：无效投标、投标无效、废标、否决投标、否决其投标、不予受理、不通过符合性审查、实质性要求、实质性条款、★、▲、*、不满足作无效投标处理、负偏离无效、投标报价超过最高限价、不得、必须、否则按无效处理。clause_type仅允许：QUALIFICATION_INVALID、COMPLIANCE_INVALID、PERSONNEL_INVALID、SERVICE_SCHEME_INVALID、SLA_INVALID、BUSINESS_INVALID、QUOTATION_INVALID、SIGNATURE_SEAL_INVALID、OTHER_INVALID。risk_level仅允许高或中。无结果返回{\"risk_clauses\":[]}。输出结构：{\"risk_clauses\":[{\"evidence_id\":\"RISK-0001\",\"clause_type\":\"\",\"clause_content\":\"\",\"trigger_keyword\":\"\",\"risk_level\":\"高\",\"source_reference\":{\"chapter\":\"\",\"page_number\":\"\"}}]}',
    },
    {
      task_type: 'BID_ANALYZE_STAGE2',
      prompt_template: '角色：你是政府采购结构化解析专家。输入包含招标文件全文、章节摘要、阶段1风险条款。任务：输出完整Final JSON（字段结构固定）。强制章节检查：投标人须知、投标人须知前附表、采购需求、评标办法、合同条款、附件、评分表。规则：仅提取原文明确信息；禁止编造；出现冲突按“废标条款>投标人须知前附表>采购需求>评标办法>合同条款>其他正文”裁决；字符串空值填“未明确”；字符串数组空值填[\"未明确\"]；对象数组无明确条款时可返回空数组。仅输出JSON。',
    },
    {
      task_type: 'BID_ANALYZE_STAGE3',
      prompt_template: '角色：你是政府采购审标专家（服务类项目）。输入包含阶段1结果、阶段2结果和招标文件全文。任务：做遗漏校验，仅检查：废标条款、实质性条款、SLA指标、人员资格要求、评分项、报价规则。判定规则：若原文存在而前两阶段未覆盖则记为遗漏；若阶段2字段为未明确但原文明确也记遗漏；仅引用原文不得改写；同条款按“前30字+章节”去重。item_type仅允许：INVALID_BID_CLAUSE、SUBSTANTIVE_REQUIREMENT、SLA_INDICATOR、PERSONNEL_REQUIREMENT、SCORING_ITEM、QUOTATION_RULE。输出：{\"missing_items\":[{\"item_type\":\"\",\"target_field_path\":\"\",\"missing_content\":\"\",\"source_reference\":{\"chapter\":\"\",\"page_number\":\"\"}}]}；无遗漏返回{\"missing_items\":[]}。',
    },
    {
      task_type: 'BID_ANALYZE',
      prompt_template: '你是招标文件分析助手。根据输入输出JSON，字段：section_summaries(对象，6章节摘要)、scoring_items(数组)、risk_items(数组)、sample_rerank_ids(数组)。每个条目含title、section_key、evidence、suggestion、risk_level(仅风险项)。仅输出JSON。',
    },
    {
      task_type: 'BID_COMPOSE_DRAFT',
      prompt_template: '你是投标文件起草助手。根据输入JSON输出JSON，字段：chapters(数组，元素含title与content)、cover_title、summary。不得输出Markdown，仅输出JSON。',
    },
  ];
  for (const item of extraPrompts) {
    const exists = await get('SELECT id FROM tender_ai_prompts WHERE task_type = ? LIMIT 1', [item.task_type]);
    if (!exists) {
      await run(
        `INSERT INTO tender_ai_prompts (task_type, prompt_template, is_active)
         VALUES (?, ?, 1)`,
        [item.task_type, item.prompt_template]
      );
    }
  }

  const defaultModelRow = await get('SELECT id FROM tender_ai_models WHERE is_default = 1 LIMIT 1');
  if (!defaultModelRow) {
    await run(
      `UPDATE tender_ai_models
       SET is_default = CASE WHEN model_key = 'aliyun_kimi_2_5' THEN 1 ELSE 0 END`
    );
  }
};

const seedValidationRuleLibrary = async () => {
  const existingRows = await query('SELECT rule_name FROM kb_validation_rules');
  const missingRules = buildMissingValidationRules({
    existingRules: existingRows,
    seedRules: buildValidationRuleSeed(),
  });
  for (const row of missingRules) {
    await run(
      `INSERT INTO kb_validation_rules
        (rule_name, rule_type, trigger_condition, check_logic, severity, suggested_action, active_flag, tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.rule_name,
        row.rule_type,
        row.trigger_condition || null,
        row.check_logic,
        row.severity,
        row.suggested_action || null,
        Number(row.active_flag || 0) === 1 ? 1 : 0,
        JSON.stringify(row.tags || {}),
      ]
    );
  }
};

const initDb = async () => {
  await bootstrapDatabase();
  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, 'tender database');
  await createSchema();
  await seedValidationRuleLibrary();
};

module.exports = {
  initDb,
  query,
  get,
  run,
  transaction,
};

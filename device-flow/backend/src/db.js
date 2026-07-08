const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'juxin';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || '';
const DB_NAME = process.env.MYSQL_DATABASE || 'juxin_device_flow';
const DB_CONN_LIMIT = Number(process.env.DB_CONNECTION_LIMIT || 10);
const DB_RETRIES = Number(process.env.DB_CONNECT_RETRIES || 30);
const DB_RETRY_DELAY = Number(process.env.DB_CONNECT_DELAY_MS || 2000);
const DEFAULT_SLA_RULES = [
  { stage: 'CREATED', thresholdHours: 4, remindIntervalMinutes: 120 },
  { stage: 'RECEIVED', thresholdHours: 8, remindIntervalMinutes: 120 },
  { stage: 'HARDWARE_CHECKED', thresholdHours: 12, remindIntervalMinutes: 120 },
  { stage: 'OS_INSTALLED', thresholdHours: 12, remindIntervalMinutes: 120 },
  { stage: 'TESTED', thresholdHours: 8, remindIntervalMinutes: 120 },
  { stage: 'APPROVED', thresholdHours: 8, remindIntervalMinutes: 120 },
  { stage: 'PACKED', thresholdHours: 6, remindIntervalMinutes: 120 },
];

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
  const adminPassword =
    process.env.MYSQL_ADMIN_PASSWORD !== undefined ? process.env.MYSQL_ADMIN_PASSWORD : DB_PASSWORD;

  const safeDbName = ensureSafeIdentifier(DB_NAME, 'MYSQL_DATABASE');
  const safeAppUser = ensureSafeIdentifier(DB_USER, 'MYSQL_USER');

  const adminPool = buildPool({ user: adminUser, password: adminPassword });
  await waitForDb(adminPool, 'mysql admin connection');

  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
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

const columnExists = async (table, column) => {
  const rows = await query(
    `SELECT COUNT(1) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
};

const addColumnIfMissing = async (table, column, definition) => {
  if (await columnExists(table, column)) return;
  try {
    await run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_FIELDNAME') return;
    throw err;
  }
};

const indexExists = async (table, indexName) => {
  const rows = await query(
    `SELECT COUNT(1) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(rows[0]?.count || 0) > 0;
};

const addIndexIfMissing = async (table, indexName, columnsSql) => {
  if (await indexExists(table, indexName)) return;
  try {
    await run(`CREATE INDEX ${indexName} ON ${table} (${columnsSql})`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_KEYNAME') return;
    throw err;
  }
};

const seedDefaultSlaRules = async () => {
  for (const item of DEFAULT_SLA_RULES) {
    await run(
      `INSERT IGNORE INTO device_sla_rules
       (stage_code, threshold_hours, remind_interval_minutes, enabled)
       VALUES (?, ?, ?, 1)`,
      [item.stage, item.thresholdHours, item.remindIntervalMinutes]
    );
  }
};

const seedDefaultDualSignPolicies = async () => {
  const defaults = [
    { stage: 'TESTED', requiredSigners: 2, enabled: 1 },
    { stage: 'APPROVED', requiredSigners: 2, enabled: 1 },
  ];
  for (const item of defaults) {
    await run(
      `INSERT INTO device_dual_sign_policies
       (stage_code, required_signers, enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         required_signers = VALUES(required_signers),
         enabled = VALUES(enabled)`,
      [item.stage, item.requiredSigners, item.enabled]
    );
  }
};

const seedDefaultRetentionPolicies = async () => {
  await run(
    `INSERT INTO device_retention_policies
     (target_type, hot_days, cold_days, delete_days, enabled)
     VALUES ('ATTACHMENT', 180, 365, 730, 1)
     ON DUPLICATE KEY UPDATE
       hot_days = VALUES(hot_days),
       cold_days = VALUES(cold_days),
       delete_days = VALUES(delete_days),
       enabled = VALUES(enabled)`
  );
};

const seedDefaultSystemSettings = async () => {
  await run(
    `INSERT IGNORE INTO device_system_settings
     (setting_key, setting_value, note)
     VALUES ('attachment_upload_max_file_size_mb', ?, '附件上传大小上限（MB）')`,
    [String(process.env.UPLOAD_MAX_FILE_SIZE_MB || 10)]
  );
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
  await run(`CREATE TABLE IF NOT EXISTS device_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_no VARCHAR(64) NOT NULL UNIQUE,
    device_sn VARCHAR(128) NOT NULL,
    customer_name VARCHAR(255) NOT NULL DEFAULT '',
    sales_order_no VARCHAR(128) NOT NULL DEFAULT '',
    inbound_tracking_no VARCHAR(128) NOT NULL DEFAULT '',
    outbound_tracking_no VARCHAR(128) NOT NULL DEFAULT '',
    device_model VARCHAR(128) NOT NULL DEFAULT '',
    current_stage VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    row_version BIGINT NOT NULL DEFAULT 1,
    received_by_sub VARCHAR(64) NULL,
    received_by_name VARCHAR(128) NULL,
    received_by_role VARCHAR(32) NULL,
    received_at DATETIME NULL,
    hardware_checked_by_sub VARCHAR(64) NULL,
    hardware_checked_by_name VARCHAR(128) NULL,
    hardware_checked_by_role VARCHAR(32) NULL,
    hardware_checked_at DATETIME NULL,
    os_installed_by_sub VARCHAR(64) NULL,
    os_installed_by_name VARCHAR(128) NULL,
    os_installed_by_role VARCHAR(32) NULL,
    os_installed_at DATETIME NULL,
    tested_by_sub VARCHAR(64) NULL,
    tested_by_name VARCHAR(128) NULL,
    tested_by_role VARCHAR(32) NULL,
    tested_at DATETIME NULL,
    approved_by_sub VARCHAR(64) NULL,
    approved_by_name VARCHAR(128) NULL,
    approved_by_role VARCHAR(32) NULL,
    approved_at DATETIME NULL,
    packed_by_sub VARCHAR(64) NULL,
    packed_by_name VARCHAR(128) NULL,
    packed_by_role VARCHAR(32) NULL,
    packed_at DATETIME NULL,
    shipped_by_sub VARCHAR(64) NULL,
    shipped_by_name VARCHAR(128) NULL,
    shipped_by_role VARCHAR(32) NULL,
    shipped_at DATETIME NULL,
    voided_by_sub VARCHAR(64) NULL,
    voided_by_name VARCHAR(128) NULL,
    voided_by_role VARCHAR(32) NULL,
    voided_at DATETIME NULL,
    remark TEXT NULL,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_jobs_stage_created (current_stage, created_at),
    INDEX idx_jobs_device_sn (device_sn),
    INDEX idx_jobs_customer (customer_name),
    INDEX idx_jobs_sales_order (sales_order_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_stage_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    action VARCHAR(32) NOT NULL,
    from_stage VARCHAR(32) NOT NULL,
    to_stage VARCHAR(32) NOT NULL,
    result VARCHAR(16) NOT NULL DEFAULT 'PASS',
    remark TEXT NULL,
    rework_reason TEXT NULL,
    stage_payload LONGTEXT NULL,
    operator_sub VARCHAR(64) NULL,
    operator_name VARCHAR(128) NULL,
    operator_role VARCHAR(32) NULL,
    operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stage_job_operated (job_id, operated_at),
    INDEX idx_stage_to_stage (to_stage),
    CONSTRAINT fk_stage_job FOREIGN KEY (job_id) REFERENCES device_jobs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_operation_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NULL,
    user_sub VARCHAR(64) NULL,
    username VARCHAR(128) NOT NULL DEFAULT '',
    user_role VARCHAR(32) NOT NULL DEFAULT '',
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NULL,
    message VARCHAR(255) NULL,
    before_data LONGTEXT NULL,
    after_data LONGTEXT NULL,
    chain_prev_hash VARCHAR(128) NULL,
    chain_hash VARCHAR(128) NULL,
    chain_version VARCHAR(16) NOT NULL DEFAULT 'v1',
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_op_job_created (job_id, created_at),
    INDEX idx_op_action_created (action, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_attachments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    stage_record_id BIGINT NULL,
    stage_code VARCHAR(32) NOT NULL DEFAULT '',
    file_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    mime_type VARCHAR(128) NOT NULL DEFAULT '',
    file_size BIGINT NOT NULL DEFAULT 0,
    remark VARCHAR(255) NULL,
    uploaded_by_sub VARCHAR(64) NULL,
    uploaded_by_name VARCHAR(128) NULL,
    uploaded_by_role VARCHAR(32) NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_attachment_job_uploaded (job_id, uploaded_at),
    INDEX idx_attachment_stage (stage_code, uploaded_at),
    CONSTRAINT fk_attachment_job FOREIGN KEY (job_id) REFERENCES device_jobs(id) ON DELETE CASCADE,
    CONSTRAINT fk_attachment_stage_record FOREIGN KEY (stage_record_id) REFERENCES device_stage_records(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_sla_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stage_code VARCHAR(32) NOT NULL,
    threshold_hours INT NOT NULL DEFAULT 8,
    remind_interval_minutes INT NOT NULL DEFAULT 120,
    enabled TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sla_stage (stage_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_sla_reminders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    stage_code VARCHAR(32) NOT NULL,
    threshold_hours INT NOT NULL DEFAULT 0,
    overdue_hours INT NOT NULL DEFAULT 0,
    message VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sla_reminder_job_stage_time (job_id, stage_code, created_at),
    INDEX idx_sla_reminder_created (created_at),
    CONSTRAINT fk_sla_reminder_job FOREIGN KEY (job_id) REFERENCES device_jobs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_change_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    request_type VARCHAR(32) NOT NULL,
    request_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    request_reason TEXT NULL,
    request_payload LONGTEXT NULL,
    requested_by_sub VARCHAR(64) NULL,
    requested_by_name VARCHAR(128) NULL,
    requested_by_role VARCHAR(32) NULL,
    requested_by_department VARCHAR(64) NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by_sub VARCHAR(64) NULL,
    approved_by_name VARCHAR(128) NULL,
    approved_by_role VARCHAR(32) NULL,
    approved_by_department VARCHAR(64) NULL,
    approved_at DATETIME NULL,
    approve_comment TEXT NULL,
    rejected_by_sub VARCHAR(64) NULL,
    rejected_by_name VARCHAR(128) NULL,
    rejected_by_role VARCHAR(32) NULL,
    rejected_by_department VARCHAR(64) NULL,
    rejected_at DATETIME NULL,
    rejected_comment TEXT NULL,
    withdrawn_by_sub VARCHAR(64) NULL,
    withdrawn_by_name VARCHAR(128) NULL,
    withdrawn_by_role VARCHAR(32) NULL,
    withdrawn_by_department VARCHAR(64) NULL,
    withdrawn_at DATETIME NULL,
    applied_stage_record_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_change_req_job_status (job_id, request_status, requested_at),
    INDEX idx_change_req_status_time (request_status, requested_at),
    CONSTRAINT fk_change_req_job FOREIGN KEY (job_id) REFERENCES device_jobs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_dual_sign_policies (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stage_code VARCHAR(32) NOT NULL,
    required_signers INT NOT NULL DEFAULT 2,
    enabled TINYINT NOT NULL DEFAULT 1,
    updated_by_sub VARCHAR(64) NULL,
    updated_by_name VARCHAR(128) NULL,
    updated_by_role VARCHAR(32) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_dual_sign_stage (stage_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_dual_sign_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(128) NOT NULL,
    job_id BIGINT NOT NULL,
    action VARCHAR(32) NOT NULL,
    from_stage VARCHAR(32) NOT NULL,
    to_stage VARCHAR(32) NOT NULL,
    stage_payload LONGTEXT NULL,
    remark TEXT NULL,
    request_ip VARCHAR(64) NULL,
    expected_version BIGINT NOT NULL DEFAULT 0,
    first_signer_sub VARCHAR(64) NULL,
    first_signer_name VARCHAR(128) NULL,
    first_signer_role VARCHAR(32) NULL,
    first_signature VARCHAR(256) NULL,
    expected_second_signer_sub VARCHAR(64) NULL,
    expected_second_signer_name VARCHAR(128) NULL,
    expected_second_signer_role VARCHAR(32) NULL,
    second_signer_sub VARCHAR(64) NULL,
    second_signer_name VARCHAR(128) NULL,
    second_signer_role VARCHAR(32) NULL,
    second_signature VARCHAR(256) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_SECOND',
    expires_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_dual_sign_token (token),
    INDEX idx_dual_sign_job_status (job_id, status, created_at),
    INDEX idx_dual_sign_expire (expires_at),
    CONSTRAINT fk_dual_sign_job FOREIGN KEY (job_id) REFERENCES device_jobs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_hardware_templates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    model_code VARCHAR(64) NOT NULL,
    model_name VARCHAR(128) NOT NULL DEFAULT '',
    check_items LONGTEXT NOT NULL,
    enabled TINYINT NOT NULL DEFAULT 1,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_sub VARCHAR(64) NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hw_template_model (model_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_permission_policies (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_sub VARCHAR(64) NOT NULL DEFAULT '',
    user_name VARCHAR(128) NOT NULL DEFAULT '',
    role_code VARCHAR(32) NOT NULL DEFAULT '*',
    department_code VARCHAR(64) NOT NULL DEFAULT '*',
    action_code VARCHAR(64) NOT NULL DEFAULT '*',
    stage_code VARCHAR(32) NOT NULL DEFAULT '*',
    effect VARCHAR(8) NOT NULL DEFAULT 'ALLOW',
    enabled TINYINT NOT NULL DEFAULT 1,
    note VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_permission_policy (role_code, department_code, action_code, stage_code, effect)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_retention_policies (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    target_type VARCHAR(32) NOT NULL,
    hot_days INT NOT NULL DEFAULT 180,
    cold_days INT NOT NULL DEFAULT 365,
    delete_days INT NOT NULL DEFAULT 730,
    enabled TINYINT NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_retention_target (target_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_system_settings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(128) NOT NULL,
    setting_value VARCHAR(1024) NOT NULL DEFAULT '',
    note VARCHAR(255) NULL,
    updated_by_sub VARCHAR(64) NULL,
    updated_by_name VARCHAR(128) NULL,
    updated_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_system_setting_key (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_job_locks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    holder_sub VARCHAR(64) NULL,
    holder_name VARCHAR(128) NULL,
    holder_role VARCHAR(32) NULL,
    acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_job_lock_job (job_id),
    INDEX idx_job_lock_expire (expires_at),
    CONSTRAINT fk_job_lock_job FOREIGN KEY (job_id) REFERENCES device_jobs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_api_clients (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_name VARCHAR(128) NOT NULL,
    api_key_hash VARCHAR(128) NOT NULL,
    enabled TINYINT NOT NULL DEFAULT 1,
    allowed_ips VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_api_client_key (api_key_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_callback_subscriptions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    callback_url VARCHAR(512) NOT NULL,
    secret VARCHAR(128) NOT NULL,
    events VARCHAR(255) NOT NULL DEFAULT 'stage.changed',
    enabled TINYINT NOT NULL DEFAULT 1,
    timeout_ms INT NOT NULL DEFAULT 5000,
    retry_limit INT NOT NULL DEFAULT 5,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_callback_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    job_id BIGINT NULL,
    payload LONGTEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INT NOT NULL DEFAULT 0,
    next_retry_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error VARCHAR(255) NULL,
    last_http_code INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_callback_event_status_time (status, next_retry_at),
    INDEX idx_callback_event_job_created (job_id, created_at),
    CONSTRAINT fk_callback_event_job FOREIGN KEY (job_id) REFERENCES device_jobs(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_callback_deliveries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_id BIGINT NOT NULL,
    callback_id BIGINT NOT NULL,
    attempt_no INT NOT NULL DEFAULT 1,
    request_body LONGTEXT NOT NULL,
    response_code INT NULL,
    response_body LONGTEXT NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    error_message VARCHAR(255) NULL,
    delivered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_callback_delivery_event (event_id, delivered_at),
    INDEX idx_callback_delivery_callback (callback_id, delivered_at),
    CONSTRAINT fk_callback_delivery_event FOREIGN KEY (event_id) REFERENCES device_callback_events(id) ON DELETE CASCADE,
    CONSTRAINT fk_callback_delivery_subscription FOREIGN KEY (callback_id) REFERENCES device_callback_subscriptions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS device_ops_metrics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    method VARCHAR(8) NOT NULL,
    route_path VARCHAR(255) NOT NULL,
    status_code INT NOT NULL DEFAULT 0,
    latency_ms INT NOT NULL DEFAULT 0,
    is_error TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ops_metrics_created (created_at),
    INDEX idx_ops_metrics_route (route_path, created_at),
    INDEX idx_ops_metrics_error (is_error, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await addColumnIfMissing('device_stage_records', 'stage_payload', 'stage_payload LONGTEXT NULL');
  await addColumnIfMissing('device_operation_logs', 'chain_prev_hash', 'chain_prev_hash VARCHAR(128) NULL');
  await addColumnIfMissing('device_operation_logs', 'chain_hash', 'chain_hash VARCHAR(128) NULL');
  await addColumnIfMissing('device_operation_logs', 'chain_version', "chain_version VARCHAR(16) NOT NULL DEFAULT 'v1'");
  await addColumnIfMissing('device_jobs', 'device_model', "device_model VARCHAR(128) NOT NULL DEFAULT ''");
  await addColumnIfMissing('device_jobs', 'row_version', 'row_version BIGINT NOT NULL DEFAULT 1');
  await addColumnIfMissing('device_jobs', 'voided_by_sub', 'voided_by_sub VARCHAR(64) NULL');
  await addColumnIfMissing('device_jobs', 'voided_by_name', 'voided_by_name VARCHAR(128) NULL');
  await addColumnIfMissing('device_jobs', 'voided_by_role', 'voided_by_role VARCHAR(32) NULL');
  await addColumnIfMissing('device_jobs', 'voided_at', 'voided_at DATETIME NULL');
  await addColumnIfMissing('device_attachments', 'storage_tier', "storage_tier VARCHAR(16) NOT NULL DEFAULT 'HOT'");
  await addColumnIfMissing('device_attachments', 'archived_at', 'archived_at DATETIME NULL');
  await addColumnIfMissing('device_attachments', 'archive_path', 'archive_path VARCHAR(512) NULL');
  await addColumnIfMissing('device_attachments', 'purge_after', 'purge_after DATETIME NULL');
  await addColumnIfMissing('device_attachments', 'deleted_at', 'deleted_at DATETIME NULL');
  await addColumnIfMissing('device_dual_sign_sessions', 'expected_version', 'expected_version BIGINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('device_dual_sign_sessions', 'expected_second_signer_sub', 'expected_second_signer_sub VARCHAR(64) NULL');
  await addColumnIfMissing('device_dual_sign_sessions', 'expected_second_signer_name', 'expected_second_signer_name VARCHAR(128) NULL');
  await addColumnIfMissing('device_dual_sign_sessions', 'expected_second_signer_role', 'expected_second_signer_role VARCHAR(32) NULL');
  await addColumnIfMissing('device_permission_policies', 'user_sub', "user_sub VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing('device_permission_policies', 'user_name', "user_name VARCHAR(128) NOT NULL DEFAULT ''");
  await addIndexIfMissing('device_jobs', 'idx_jobs_status_updated', 'status, updated_at');
  await addIndexIfMissing('device_jobs', 'idx_jobs_model_stage', 'device_model, current_stage');
  await addIndexIfMissing('device_jobs', 'idx_jobs_stage_status_updated', 'current_stage, status, updated_at');
  await addIndexIfMissing('device_operation_logs', 'idx_op_created', 'created_at');
  await addIndexIfMissing('device_operation_logs', 'idx_op_user_created', 'username, created_at');
  await addIndexIfMissing('device_operation_logs', 'idx_op_chain_hash', 'chain_hash');
  await addIndexIfMissing('device_attachments', 'idx_attachment_job_stage', 'job_id, stage_code');
  await addIndexIfMissing('device_attachments', 'idx_attachment_tier_uploaded', 'storage_tier, uploaded_at');
  await addIndexIfMissing('device_attachments', 'idx_attachment_purge_after', 'purge_after');
  await addIndexIfMissing('device_sla_reminders', 'idx_sla_reminder_job_stage_time', 'job_id, stage_code, created_at');
  await addIndexIfMissing('device_sla_reminders', 'idx_sla_reminder_created', 'created_at');
  await seedDefaultSlaRules();
  await seedDefaultDualSignPolicies();
  await seedDefaultRetentionPolicies();
  await seedDefaultSystemSettings();
};

const initDb = async () => {
  await bootstrapDatabase();
  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, 'device_flow database');
  await createSchema();
};

module.exports = {
  initDb,
  query,
  get,
  run,
  transaction,
};

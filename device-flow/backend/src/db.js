const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'juxin';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || 'juxinpass';
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
    current_stage VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
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

  await addColumnIfMissing('device_stage_records', 'stage_payload', 'stage_payload LONGTEXT NULL');
  await addColumnIfMissing('device_operation_logs', 'chain_prev_hash', 'chain_prev_hash VARCHAR(128) NULL');
  await addColumnIfMissing('device_operation_logs', 'chain_hash', 'chain_hash VARCHAR(128) NULL');
  await addColumnIfMissing('device_operation_logs', 'chain_version', "chain_version VARCHAR(16) NOT NULL DEFAULT 'v1'");
  await addIndexIfMissing('device_jobs', 'idx_jobs_status_updated', 'status, updated_at');
  await addIndexIfMissing('device_operation_logs', 'idx_op_created', 'created_at');
  await addIndexIfMissing('device_operation_logs', 'idx_op_user_created', 'username, created_at');
  await addIndexIfMissing('device_operation_logs', 'idx_op_chain_hash', 'chain_hash');
  await addIndexIfMissing('device_attachments', 'idx_attachment_job_stage', 'job_id, stage_code');
  await addIndexIfMissing('device_sla_reminders', 'idx_sla_reminder_job_stage_time', 'job_id, stage_code, created_at');
  await addIndexIfMissing('device_sla_reminders', 'idx_sla_reminder_created', 'created_at');
  await seedDefaultSlaRules();
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

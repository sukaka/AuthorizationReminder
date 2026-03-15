const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'delivery_user';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || 'delivery_pass';
const DB_NAME = process.env.MYSQL_DATABASE || 'juxin_delivery';
const DB_CONN_LIMIT = Number(process.env.DB_CONNECTION_LIMIT || 10);
const DB_RETRIES = Number(process.env.DB_CONNECT_RETRIES || 30);
const DB_RETRY_DELAY = Number(process.env.DB_CONNECT_DELAY_MS || 2000);
const DEFAULT_SLA_RULES = [
  { stage: 'INIT', thresholdHours: 4, remindIntervalMinutes: 120 },
  { stage: 'ASSESS', thresholdHours: 8, remindIntervalMinutes: 120 },
  { stage: 'IMPLEMENT', thresholdHours: 12, remindIntervalMinutes: 120 },
  { stage: 'TUNE', thresholdHours: 12, remindIntervalMinutes: 120 },
  { stage: 'TRIAL', thresholdHours: 8, remindIntervalMinutes: 120 },
  { stage: 'ACCEPT', thresholdHours: 8, remindIntervalMinutes: 120 },
  { stage: 'HANDOVER', thresholdHours: 6, remindIntervalMinutes: 120 },
];
const DEFAULT_TEMPLATE_RULES = [
  {
    product_code: 'WAF',
    product_name: 'WAF实施',
    stage_code: 'ASSESS',
    required_deliverables: ['流量评估单'],
  },
  {
    product_code: 'WAF',
    product_name: 'WAF实施',
    stage_code: 'IMPLEMENT',
    required_deliverables: ['部署记录', '接入记录'],
  },
  {
    product_code: 'LOG_AUDIT',
    product_name: '日志审计实施',
    stage_code: 'IMPLEMENT',
    required_deliverables: ['日志源清单', '接入记录'],
  },
  {
    product_code: 'DB_AUDIT',
    product_name: '数据库审计实施',
    stage_code: 'TRIAL',
    required_deliverables: ['验证报告'],
  },
  {
    product_code: 'CLOUD_COMPLIANCE',
    product_name: '等保云管平台实施',
    stage_code: 'ACCEPT',
    required_deliverables: ['验收单', '培训材料'],
  },
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

const addUniqueIndexIfMissing = async (table, indexName, columnsSql) => {
  if (await indexExists(table, indexName)) return;
  try {
    await run(`CREATE UNIQUE INDEX ${indexName} ON ${table} (${columnsSql})`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_KEYNAME') return;
    throw err;
  }
};

const seedDefaultSlaRules = async () => {
  for (const item of DEFAULT_SLA_RULES) {
    await run(
      `INSERT IGNORE INTO delivery_sla_rules
       (stage_code, threshold_hours, remind_interval_minutes, enabled)
       VALUES (?, ?, ?, 1)`,
      [item.stage, item.thresholdHours, item.remindIntervalMinutes]
    );
  }
};

const seedDefaultTemplateRules = async () => {
  for (const item of DEFAULT_TEMPLATE_RULES) {
    await run(
      `INSERT IGNORE INTO delivery_templates
       (product_code, product_name, enabled)
       VALUES (?, ?, 1)`,
      [item.product_code, item.product_name]
    );
    await run(
      `INSERT IGNORE INTO delivery_template_phase_rules
       (product_code, stage_code, required_deliverables_json, enabled)
       VALUES (?, ?, ?, 1)`,
      [item.product_code, item.stage_code, JSON.stringify(item.required_deliverables || [])]
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
  await run(`CREATE TABLE IF NOT EXISTS delivery_projects (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_code VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NULL,
    owner_sub VARCHAR(64) NULL,
    owner_name VARCHAR(128) NULL,
    owner_role VARCHAR(32) NULL,
    legacy_ticket_project_id BIGINT NULL,
    legacy_sec_impl_project_id BIGINT NULL,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_delivery_projects_customer (customer_name),
    INDEX idx_delivery_projects_owner (owner_sub)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_project_members (
    project_id BIGINT NOT NULL,
    user_sub VARCHAR(64) NOT NULL,
    username VARCHAR(128) NOT NULL DEFAULT '',
    user_role VARCHAR(32) NOT NULL DEFAULT '',
    can_view TINYINT NOT NULL DEFAULT 1,
    can_edit TINYINT NOT NULL DEFAULT 0,
    can_assign TINYINT NOT NULL DEFAULT 0,
    can_close TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_sub),
    CONSTRAINT fk_delivery_project_member_project FOREIGN KEY (project_id) REFERENCES delivery_projects(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_no VARCHAR(64) NOT NULL UNIQUE,
    project_code VARCHAR(128) NOT NULL,
    project_id BIGINT NULL,
    title VARCHAR(255) NOT NULL DEFAULT '',
    product_type VARCHAR(64) NOT NULL DEFAULT '',
    customer_name VARCHAR(255) NOT NULL DEFAULT '',
    sales_order_no VARCHAR(128) NOT NULL DEFAULT '',
    inbound_tracking_no VARCHAR(128) NOT NULL DEFAULT '',
    outbound_tracking_no VARCHAR(128) NOT NULL DEFAULT '',
    workflow_status VARCHAR(32) NOT NULL DEFAULT 'INTAKE',
    execution_phase VARCHAR(32) NOT NULL DEFAULT 'INIT',
    current_stage VARCHAR(32) NOT NULL DEFAULT 'INIT',
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    requested_by_sub VARCHAR(64) NULL,
    requested_by_name VARCHAR(128) NULL,
    requested_by_role VARCHAR(32) NULL,
    requested_at DATETIME NULL,
    approved_by_sub VARCHAR(64) NULL,
    approved_by_name VARCHAR(128) NULL,
    approved_by_role VARCHAR(32) NULL,
    approved_at DATETIME NULL,
    assigned_to_sub VARCHAR(64) NULL,
    assigned_to_name VARCHAR(128) NULL,
    assigned_to_role VARCHAR(32) NULL,
    assigned_at DATETIME NULL,
    planned_start_at DATETIME NULL,
    planned_end_at DATETIME NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_ticket_id BIGINT NULL,
    legacy_sec_impl_id BIGINT NULL,
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
    INDEX idx_orders_workflow_phase (workflow_status, execution_phase),
    INDEX idx_orders_project (project_id, created_at),
    INDEX idx_jobs_project_code (project_code),
    INDEX idx_jobs_product_type (product_type),
    INDEX idx_jobs_customer (customer_name),
    INDEX idx_jobs_sales_order (sales_order_no),
    CONSTRAINT fk_delivery_order_project FOREIGN KEY (project_id) REFERENCES delivery_projects(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_workflow_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    action VARCHAR(64) NOT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_event_id BIGINT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NULL,
    from_phase VARCHAR(32) NULL,
    to_phase VARCHAR(32) NULL,
    comment_text TEXT NULL,
    operator_sub VARCHAR(64) NULL,
    operator_name VARCHAR(128) NULL,
    operator_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_delivery_workflow_order_created (order_id, created_at),
    UNIQUE KEY uk_delivery_workflow_legacy (source_system, legacy_event_id),
    CONSTRAINT fk_delivery_workflow_order FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_phase_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    action VARCHAR(32) NOT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_phase_run_id BIGINT NULL,
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
    UNIQUE KEY uk_delivery_phase_run_legacy (source_system, legacy_phase_run_id),
    CONSTRAINT fk_stage_job FOREIGN KEY (job_id) REFERENCES delivery_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_audit_id BIGINT NULL,
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
    INDEX idx_op_action_created (action, created_at),
    UNIQUE KEY uk_delivery_audit_legacy (source_system, legacy_audit_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_evidence_attachments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_attachment_id BIGINT NULL,
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
    UNIQUE KEY uk_delivery_attachment_legacy (source_system, legacy_attachment_id),
    CONSTRAINT fk_attachment_job FOREIGN KEY (job_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_attachment_stage_record FOREIGN KEY (stage_record_id) REFERENCES delivery_phase_runs(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_sla_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stage_code VARCHAR(32) NOT NULL,
    threshold_hours INT NOT NULL DEFAULT 8,
    remind_interval_minutes INT NOT NULL DEFAULT 120,
    enabled TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sla_stage (stage_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_sla_reminders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    stage_code VARCHAR(32) NOT NULL,
    threshold_hours INT NOT NULL DEFAULT 0,
    overdue_hours INT NOT NULL DEFAULT 0,
    message VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sla_reminder_job_stage_time (job_id, stage_code, created_at),
    INDEX idx_sla_reminder_created (created_at),
    CONSTRAINT fk_sla_reminder_job FOREIGN KEY (job_id) REFERENCES delivery_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_templates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_code VARCHAR(64) NOT NULL UNIQUE,
    product_name VARCHAR(128) NOT NULL,
    enabled TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_template_phase_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_code VARCHAR(64) NOT NULL,
    stage_code VARCHAR(32) NOT NULL,
    required_deliverables_json LONGTEXT NULL,
    enabled TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_template_stage (product_code, stage_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_deliverables (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_deliverable_id BIGINT NULL,
    stage_code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    required_flag TINYINT NOT NULL DEFAULT 1,
    done_flag TINYINT NOT NULL DEFAULT 0,
    done_by_sub VARCHAR(64) NULL,
    done_by_name VARCHAR(128) NULL,
    done_by_role VARCHAR(32) NULL,
    done_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_deliverable_job_stage (job_id, stage_code),
    UNIQUE KEY uk_delivery_deliverable_legacy (source_system, legacy_deliverable_id),
    CONSTRAINT fk_deliverable_job FOREIGN KEY (job_id) REFERENCES delivery_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_user_customer_scope (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_sub VARCHAR(64) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_scope_user_customer (user_sub, customer_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_comments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_comment_id BIGINT NULL,
    content TEXT NOT NULL,
    mentions_json LONGTEXT NULL,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_delivery_comments_order_created (order_id, created_at),
    UNIQUE KEY uk_delivery_comment_legacy (source_system, legacy_comment_id),
    CONSTRAINT fk_delivery_comment_order FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_schedules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    source_system VARCHAR(32) NOT NULL DEFAULT 'delivery',
    legacy_schedule_id BIGINT NULL,
    assignee_sub VARCHAR(64) NULL,
    assignee_name VARCHAR(128) NULL,
    assignee_role VARCHAR(32) NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    remark VARCHAR(255) NULL,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_delivery_schedules_order_time (order_id, start_at, end_at),
    UNIQUE KEY uk_delivery_schedule_legacy (source_system, legacy_schedule_id),
    CONSTRAINT fk_delivery_schedule_order FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await addColumnIfMissing('delivery_phase_runs', 'stage_payload', 'stage_payload LONGTEXT NULL');
  await addColumnIfMissing('delivery_workflow_events', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_workflow_events', 'legacy_event_id', 'legacy_event_id BIGINT NULL');
  await addColumnIfMissing('delivery_phase_runs', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_phase_runs', 'legacy_phase_run_id', 'legacy_phase_run_id BIGINT NULL');
  await addColumnIfMissing('delivery_orders', 'project_id', 'project_id BIGINT NULL');
  await addColumnIfMissing('delivery_orders', 'title', "title VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('delivery_orders', 'product_type', "product_type VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing('delivery_orders', 'workflow_status', "workflow_status VARCHAR(32) NOT NULL DEFAULT 'INTAKE'");
  await addColumnIfMissing('delivery_orders', 'execution_phase', "execution_phase VARCHAR(32) NOT NULL DEFAULT 'INIT'");
  await addColumnIfMissing('delivery_orders', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_orders', 'legacy_ticket_id', 'legacy_ticket_id BIGINT NULL');
  await addColumnIfMissing('delivery_orders', 'legacy_sec_impl_id', 'legacy_sec_impl_id BIGINT NULL');
  await addColumnIfMissing('delivery_audit_logs', 'chain_prev_hash', 'chain_prev_hash VARCHAR(128) NULL');
  await addColumnIfMissing('delivery_audit_logs', 'chain_hash', 'chain_hash VARCHAR(128) NULL');
  await addColumnIfMissing('delivery_audit_logs', 'chain_version', "chain_version VARCHAR(16) NOT NULL DEFAULT 'v1'");
  await addColumnIfMissing('delivery_audit_logs', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_audit_logs', 'legacy_audit_id', 'legacy_audit_id BIGINT NULL');
  await addColumnIfMissing('delivery_evidence_attachments', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_evidence_attachments', 'legacy_attachment_id', 'legacy_attachment_id BIGINT NULL');
  await addColumnIfMissing('delivery_deliverables', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_deliverables', 'legacy_deliverable_id', 'legacy_deliverable_id BIGINT NULL');
  await addColumnIfMissing('delivery_comments', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_comments', 'legacy_comment_id', 'legacy_comment_id BIGINT NULL');
  await addColumnIfMissing('delivery_schedules', 'source_system', "source_system VARCHAR(32) NOT NULL DEFAULT 'delivery'");
  await addColumnIfMissing('delivery_schedules', 'legacy_schedule_id', 'legacy_schedule_id BIGINT NULL');
  await addIndexIfMissing('delivery_orders', 'idx_jobs_status_updated', 'status, updated_at');
  await addIndexIfMissing('delivery_orders', 'idx_jobs_product_type', 'product_type');
  await addIndexIfMissing('delivery_orders', 'idx_orders_workflow_phase', 'workflow_status, execution_phase');
  await addIndexIfMissing('delivery_orders', 'idx_orders_project', 'project_id, created_at');
  await addIndexIfMissing('delivery_audit_logs', 'idx_op_created', 'created_at');
  await addIndexIfMissing('delivery_audit_logs', 'idx_op_user_created', 'username, created_at');
  await addIndexIfMissing('delivery_audit_logs', 'idx_op_chain_hash', 'chain_hash');
  await addUniqueIndexIfMissing('delivery_workflow_events', 'uk_delivery_workflow_legacy', 'source_system, legacy_event_id');
  await addUniqueIndexIfMissing('delivery_phase_runs', 'uk_delivery_phase_run_legacy', 'source_system, legacy_phase_run_id');
  await addUniqueIndexIfMissing('delivery_audit_logs', 'uk_delivery_audit_legacy', 'source_system, legacy_audit_id');
  await addIndexIfMissing('delivery_evidence_attachments', 'idx_attachment_job_stage', 'job_id, stage_code');
  await addUniqueIndexIfMissing('delivery_evidence_attachments', 'uk_delivery_attachment_legacy', 'source_system, legacy_attachment_id');
  await addIndexIfMissing('delivery_sla_reminders', 'idx_sla_reminder_job_stage_time', 'job_id, stage_code, created_at');
  await addIndexIfMissing('delivery_sla_reminders', 'idx_sla_reminder_created', 'created_at');
  await addIndexIfMissing('delivery_templates', 'idx_template_enabled', 'enabled');
  await addIndexIfMissing('delivery_template_phase_rules', 'idx_template_stage_enabled', 'stage_code, enabled');
  await addIndexIfMissing('delivery_deliverables', 'idx_deliverable_stage_done', 'stage_code, done_flag');
  await addUniqueIndexIfMissing('delivery_deliverables', 'uk_delivery_deliverable_legacy', 'source_system, legacy_deliverable_id');
  await addIndexIfMissing('delivery_user_customer_scope', 'idx_scope_customer', 'customer_name');
  await addIndexIfMissing('delivery_comments', 'idx_delivery_comments_order_created', 'order_id, created_at');
  await addUniqueIndexIfMissing('delivery_comments', 'uk_delivery_comment_legacy', 'source_system, legacy_comment_id');
  await addIndexIfMissing('delivery_schedules', 'idx_delivery_schedules_order_time', 'order_id, start_at, end_at');
  await addUniqueIndexIfMissing('delivery_schedules', 'uk_delivery_schedule_legacy', 'source_system, legacy_schedule_id');
  await seedDefaultSlaRules();
  await seedDefaultTemplateRules();
};

const initDb = async () => {
  await bootstrapDatabase();
  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, 'delivery database');
  await createSchema();
};

module.exports = {
  initDb,
  query,
  get,
  run,
  transaction,
};

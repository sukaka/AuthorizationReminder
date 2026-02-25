const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'mysql',
  port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'juxin_reminder',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDb = async () => {
  const attempts = Number(process.env.DB_CONNECT_RETRIES || 30);
  const delayMs = Number(process.env.DB_CONNECT_DELAY_MS || 2000);
  for (let i = 0; i < attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(delayMs);
    }
  }
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
    // Multiple services may run the same migration concurrently; treat duplicate column as success.
    if (err && err.code === 'ER_DUP_FIELDNAME') return;
    throw err;
  }
};

const indexExists = async (table, index) => {
  const rows = await query(
    `SELECT COUNT(1) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Number(rows[0]?.count || 0) > 0;
};

const addIndexIfMissing = async (table, index, sql) => {
  if (await indexExists(table, index)) return;
  try {
    await run(sql);
  } catch (err) {
    if (err && err.code === 'ER_DUP_KEYNAME') return;
    throw err;
  }
};

const init = async () => {
  await run(`CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    juxin_sales VARCHAR(255),
    channel_sales VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS contacts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(64),
    email VARCHAR(255),
    wecom_id VARCHAR(255),
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS contact_customers (
    contact_id INT NOT NULL,
    customer_id INT NOT NULL,
    PRIMARY KEY (contact_id, customer_id),
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS licenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    start_date DATE,
    end_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    note TEXT,
    reminder_days TEXT,
    screenshot_url VARCHAR(1024),
    screenshot_valid TINYINT,
    screenshot_ocr_text TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await addColumnIfMissing('licenses', 'screenshot_url', 'screenshot_url VARCHAR(1024)');
  await addColumnIfMissing('licenses', 'screenshot_valid', 'screenshot_valid TINYINT');
  await addColumnIfMissing('licenses', 'screenshot_ocr_text', 'screenshot_ocr_text TEXT');

  await run(`CREATE TABLE IF NOT EXISTS send_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(128) NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS send_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contact_id INT NOT NULL,
    license_id INT,
    channels TEXT NOT NULL,
    status VARCHAR(32) NOT NULL,
    error_code VARCHAR(64),
    subject TEXT,
    message TEXT,
    error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(64) NOT NULL DEFAULT 'admin',
    is_active TINYINT NOT NULL DEFAULT 1,
    email VARCHAR(255),
    phone VARCHAR(64),
    wecom_id VARCHAR(255),
    totp_secret VARCHAR(128),
    totp_enabled TINYINT NOT NULL DEFAULT 0,
    mfa_enabled TINYINT NOT NULL DEFAULT 0,
    mfa_methods TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await addColumnIfMissing('users', 'mfa_enabled', 'mfa_enabled TINYINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('users', 'mfa_methods', 'mfa_methods TEXT');
  await addColumnIfMissing('users', 'app_access', 'app_access TEXT');
  await addColumnIfMissing('users', 'is_active', 'is_active TINYINT NOT NULL DEFAULT 1');

  await run(`CREATE TABLE IF NOT EXISTS reminder_sent (
    id INT AUTO_INCREMENT PRIMARY KEY,
    license_id INT NOT NULL,
    contact_id INT NOT NULL,
    channel VARCHAR(32) NOT NULL,
    days_left INT NOT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_reminder (license_id, contact_id, channel, days_left)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS reminder_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    license_id INT NOT NULL,
    contact_id INT NOT NULL,
    channel VARCHAR(32) NOT NULL,
    days_left INT NOT NULL,
    status VARCHAR(32) NOT NULL,
    error_code VARCHAR(64),
    error TEXT,
    is_test TINYINT NOT NULL DEFAULT 0,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS send_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    license_id INT NOT NULL,
    contact_ids TEXT NOT NULL,
    channels TEXT NOT NULL,
    days TEXT NOT NULL,
    wecom_mode VARCHAR(16) NOT NULL DEFAULT 'webhook',
    enabled TINYINT NOT NULL DEFAULT 1,
    start_date DATE,
    end_date DATE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await addColumnIfMissing('send_plans', 'wecom_mode', "wecom_mode VARCHAR(16) NOT NULL DEFAULT 'webhook'");

  await run(`CREATE TABLE IF NOT EXISTS operation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    username VARCHAR(255) NOT NULL,
    log_system VARCHAR(32) NOT NULL DEFAULT 'reminder',
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NOT NULL,
    entity_id INT NOT NULL,
    before_data TEXT,
    after_data TEXT,
    prev_hash CHAR(64),
    signature CHAR(64),
    sign_version VARCHAR(16) NOT NULL DEFAULT 'v1',
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  if (await columnExists('operation_logs', 'system')) {
    try {
      await run("ALTER TABLE operation_logs CHANGE COLUMN `system` log_system VARCHAR(32) NOT NULL DEFAULT 'reminder'");
    } catch (err) {
      if (!err || err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }
  await addColumnIfMissing('operation_logs', 'log_system', "log_system VARCHAR(32) NOT NULL DEFAULT 'reminder'");
  await addColumnIfMissing('operation_logs', 'prev_hash', 'prev_hash CHAR(64)');
  await addColumnIfMissing('operation_logs', 'signature', 'signature CHAR(64)');
  await addColumnIfMissing('operation_logs', 'sign_version', "sign_version VARCHAR(16) NOT NULL DEFAULT 'v1'");
  await addColumnIfMissing('operation_logs', 'request_ip', 'request_ip VARCHAR(64) NULL');
  await addIndexIfMissing(
    'operation_logs',
    'idx_operation_logs_signature',
    'CREATE INDEX idx_operation_logs_signature ON operation_logs (id, signature)'
  );

  await run(`CREATE TABLE IF NOT EXISTS import_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    username VARCHAR(255) NOT NULL,
    type VARCHAR(64) NOT NULL,
    filename VARCHAR(255),
    status VARCHAR(32) NOT NULL,
    created INT NOT NULL DEFAULT 0,
    skipped INT NOT NULL DEFAULT 0,
    total INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    errors_json TEXT,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    priority VARCHAR(8) NOT NULL DEFAULT 'P2',
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_project_members (
    project_id INT NOT NULL,
    user_id INT NOT NULL,
    can_view TINYINT NOT NULL DEFAULT 1,
    can_edit TINYINT NOT NULL DEFAULT 0,
    can_assign TINYINT NOT NULL DEFAULT 0,
    can_close TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    engineer_id INT NOT NULL,
    ticket_id INT,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    remark VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_engineer_time (engineer_id, start_at, end_at),
    INDEX idx_ticket (ticket_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_template_stages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    duration_days DECIMAL(5,2) NOT NULL,
    stage_order INT NOT NULL,
    FOREIGN KEY (template_id) REFERENCES ticket_templates(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_template_deliverables (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stage_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    FOREIGN KEY (stage_id) REFERENCES ticket_template_stages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_template_roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stage_id INT NOT NULL,
    role_name VARCHAR(64) NOT NULL,
    FOREIGN KEY (stage_id) REFERENCES ticket_template_stages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_stages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    duration_days DECIMAL(5,2) NOT NULL,
    stage_order INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_assignees (
    ticket_id INT NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (ticket_id, user_id),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await run(`CREATE TABLE IF NOT EXISTS ticket_watchers (
    ticket_id INT NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (ticket_id, user_id),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await run(`CREATE TABLE IF NOT EXISTS ticket_comments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    content TEXT NOT NULL,
    mentions_json TEXT,
    created_by INT NOT NULL,
    created_name VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_comments_ticket (ticket_id),
    INDEX idx_ticket_comments_user (created_by),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await run(`CREATE TABLE IF NOT EXISTS ticket_attachments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes INT NOT NULL,
    file_data LONGBLOB NOT NULL,
    created_by INT NULL,
    created_name VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_attachments_ticket (ticket_id, id),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await run(`CREATE TABLE IF NOT EXISTS ticket_notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    ticket_id INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    is_read TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME NULL,
    INDEX idx_ticket_notifications_user (user_id, is_read, created_at),
    INDEX idx_ticket_notifications_ticket (ticket_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumnIfMissing('tickets', 'project_id', 'project_id INT NULL AFTER created_by');
  await addColumnIfMissing('tickets', 'owner_id', 'owner_id INT NULL AFTER created_by');
  await addColumnIfMissing('tickets', 'department_code', 'department_code VARCHAR(32) NULL AFTER project_id');
  await addColumnIfMissing('tickets', 'service_code', 'service_code VARCHAR(64) NULL AFTER department_code');
  await addColumnIfMissing('tickets', 'ticket_type', "ticket_type VARCHAR(32) NOT NULL DEFAULT 'SERVICE' AFTER service_code");
  await addColumnIfMissing('tickets', 'source', "source VARCHAR(32) NOT NULL DEFAULT 'MANUAL' AFTER ticket_type");
  await addColumnIfMissing('tickets', 'customer_name', 'customer_name VARCHAR(255) NULL AFTER source');
  await addColumnIfMissing('tickets', 'requester_name', 'requester_name VARCHAR(64) NULL AFTER customer_name');
  await addColumnIfMissing('tickets', 'requester_phone', 'requester_phone VARCHAR(32) NULL AFTER requester_name');
  await addColumnIfMissing('tickets', 'requester_email', 'requester_email VARCHAR(255) NULL AFTER requester_phone');
  await addColumnIfMissing('tickets', 'severity', "severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM' AFTER priority");
  await addColumnIfMissing('tickets', 'sla_response_minutes', 'sla_response_minutes INT NOT NULL DEFAULT 30 AFTER severity');
  await addColumnIfMissing('tickets', 'sla_resolve_minutes', 'sla_resolve_minutes INT NOT NULL DEFAULT 480 AFTER sla_response_minutes');
  await addColumnIfMissing('tickets', 'response_deadline', 'response_deadline DATETIME NULL AFTER sla_resolve_minutes');
  await addColumnIfMissing('tickets', 'resolve_deadline', 'resolve_deadline DATETIME NULL AFTER response_deadline');
  await addColumnIfMissing('tickets', 'accepted_at', 'accepted_at DATETIME NULL AFTER resolve_deadline');
  await addColumnIfMissing('tickets', 'responded_at', 'responded_at DATETIME NULL AFTER accepted_at');
  await addColumnIfMissing('tickets', 'resolved_at', 'resolved_at DATETIME NULL AFTER responded_at');
  await addColumnIfMissing('tickets', 'closed_at', 'closed_at DATETIME NULL AFTER resolved_at');
  await addColumnIfMissing('tickets', 'parent_ticket_id', 'parent_ticket_id INT NULL AFTER closed_at');
  await addColumnIfMissing('tickets', 'tags_json', 'tags_json TEXT NULL AFTER parent_ticket_id');
  await addColumnIfMissing('tickets', 'current_stage_id', 'current_stage_id INT NULL AFTER tags_json');
  await addColumnIfMissing('tickets', 'reopen_count', 'reopen_count INT NOT NULL DEFAULT 0 AFTER current_stage_id');
  await addColumnIfMissing('tickets', 'approval_required', 'approval_required TINYINT NOT NULL DEFAULT 0 AFTER reopen_count');
  await addColumnIfMissing('tickets', 'approval_status', "approval_status VARCHAR(16) NOT NULL DEFAULT 'NOT_REQUIRED' AFTER approval_required");
  await addColumnIfMissing('tickets', 'approval_by', 'approval_by INT NULL AFTER approval_status');
  await addColumnIfMissing('tickets', 'approval_at', 'approval_at DATETIME NULL AFTER approval_by');
  await addColumnIfMissing('tickets', 'approval_comment', 'approval_comment VARCHAR(255) NULL AFTER approval_at');

  await addIndexIfMissing(
    'tickets',
    'idx_tickets_dept_status',
    'CREATE INDEX idx_tickets_dept_status ON tickets (department_code, status)'
  );
  await addIndexIfMissing(
    'tickets',
    'idx_tickets_service_status',
    'CREATE INDEX idx_tickets_service_status ON tickets (service_code, status)'
  );
  await addIndexIfMissing(
    'tickets',
    'idx_tickets_resolve_deadline',
    'CREATE INDEX idx_tickets_resolve_deadline ON tickets (resolve_deadline, status)'
  );
  await addIndexIfMissing(
    'tickets',
    'idx_tickets_project_status',
    'CREATE INDEX idx_tickets_project_status ON tickets (project_id, status)'
  );
  await addIndexIfMissing(
    'tickets',
    'idx_tickets_parent',
    'CREATE INDEX idx_tickets_parent ON tickets (parent_ticket_id)'
  );
  await addIndexIfMissing(
    'tickets',
    'idx_tickets_owner_status',
    'CREATE INDEX idx_tickets_owner_status ON tickets (owner_id, status)'
  );
  await run('UPDATE tickets SET owner_id = created_by WHERE owner_id IS NULL');
  await run(
    `UPDATE tickets
     SET approval_required = CASE
       WHEN priority = 'P1' OR severity IN ('HIGH', 'CRITICAL') THEN 1
       ELSE 0
     END
     WHERE approval_status IS NULL OR approval_status = '' OR approval_status = 'NOT_REQUIRED'`
  );
  await run(
    `UPDATE tickets
     SET approval_status = CASE
       WHEN approval_required = 1 AND status = 'CLOSED' THEN 'APPROVED'
       WHEN approval_required = 1 THEN 'PENDING'
       ELSE 'NOT_REQUIRED'
     END
     WHERE approval_status IS NULL OR approval_status = ''`
  );

  await run(`CREATE TABLE IF NOT EXISTS departments (
    code VARCHAR(32) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS service_catalog (
    code VARCHAR(64) PRIMARY KEY,
    department_code VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    default_template_code VARCHAR(64),
    default_priority VARCHAR(8) NOT NULL DEFAULT 'P2',
    default_response_minutes INT NOT NULL DEFAULT 30,
    default_resolve_minutes INT NOT NULL DEFAULT 480,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_service_dept (department_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_stage_deliverables (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stage_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    required_flag TINYINT NOT NULL DEFAULT 1,
    done_flag TINYINT NOT NULL DEFAULT 0,
    done_by INT NULL,
    done_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stage_deliverables_stage (stage_id),
    FOREIGN KEY (stage_id) REFERENCES ticket_stages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_sla_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    sla_type VARCHAR(16) NOT NULL,
    deadline_at DATETIME NOT NULL,
    breached_at DATETIME NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sla_deadline (deadline_at, status),
    INDEX idx_sla_ticket (ticket_id, sla_type),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    event_desc VARCHAR(255) NOT NULL,
    before_json TEXT,
    after_json TEXT,
    operator_id INT NULL,
    operator_name VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_events_ticket (ticket_id),
    INDEX idx_ticket_events_type (event_type),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS ticket_project_permission_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    operator_id INT NULL,
    operator_name VARCHAR(255) NULL,
    event_type VARCHAR(64) NOT NULL,
    event_desc VARCHAR(255) NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_permission_logs_project (project_id, id),
    INDEX idx_permission_logs_operator (operator_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(
    `INSERT IGNORE INTO departments (code, name, sort_order) VALUES
     ('SEC_SERVICE', '安全服务部', 10),
     ('SEC_OPERATION', '安全运营部', 20),
     ('TECH', '技术部', 30)`
  );

  await run(
    `INSERT IGNORE INTO service_catalog
      (code, department_code, name, default_template_code, default_priority, default_response_minutes, default_resolve_minutes)
     VALUES
      ('SEC_PENTEST', 'SEC_SERVICE', '渗透测试', 'SEC_PENTEST', 'P1', 30, 1440),
      ('SEC_VULN_SCAN', 'SEC_SERVICE', '漏洞扫描', 'SEC_VULN_SCAN', 'P2', 60, 960),
      ('SEC_BASELINE', 'SEC_SERVICE', '基线检查', 'SEC_BASELINE', 'P2', 60, 960),
      ('SEC_SWTEST_PENTEST', 'SEC_SERVICE', '软件测试项目渗透', 'SEC_SWTEST_PENTEST', 'P1', 30, 1440),
      ('SEC_SWTEST_SCAN', 'SEC_SERVICE', '软件测试项目漏扫', 'SEC_SWTEST_SCAN', 'P2', 60, 960),
      ('OPS_RISK_ASSESS', 'SEC_OPERATION', '风险评估', 'OPS_RISK_ASSESS', 'P2', 120, 1440),
      ('OPS_INCIDENT', 'SEC_OPERATION', '应急响应', 'OPS_INCIDENT', 'P1', 15, 480),
      ('OPS_WDSP_IMPL', 'SEC_OPERATION', 'WDSP实施', 'OPS_WDSP_IMPL', 'P2', 120, 2880),
      ('OPS_SECOPS', 'SEC_OPERATION', '安全运维', 'OPS_SECOPS', 'P2', 120, 2880),
      ('OPS_ADHOC', 'SEC_OPERATION', '临时任务', 'OPS_ADHOC', 'P3', 240, 2880),
      ('TECH_CLOUD_IMPL', 'TECH', '聚信等保云管平台实施', 'TECH_CLOUD_IMPL', 'P2', 120, 2880),
      ('TECH_WAF_IMPL', 'TECH', 'WAF实施', 'TECH_WAF_IMPL', 'P2', 120, 2880),
      ('TECH_LOG_AUDIT_IMPL', 'TECH', '日志审计实施', 'TECH_LOG_AUDIT_IMPL', 'P2', 120, 2880),
      ('TECH_DB_AUDIT_IMPL', 'TECH', '数据库审计实施', 'TECH_DB_AUDIT_IMPL', 'P2', 120, 2880),
      ('TECH_FIREWALL_IMPL', 'TECH', '防火墙实施', 'TECH_FIREWALL_IMPL', 'P2', 120, 2880)`
  );

  await run(`CREATE TABLE IF NOT EXISTS auth_login_attempts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    ip VARCHAR(64) NOT NULL,
    fail_count INT NOT NULL DEFAULT 0,
    first_fail_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_until DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_login_attempt (username, ip)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS auth_mfa_sessions (
    token VARCHAR(128) PRIMARY KEY,
    user_id INT NOT NULL,
    username VARCHAR(255) NOT NULL,
    methods_json TEXT NOT NULL,
    method VARCHAR(32),
    code_hash VARCHAR(255),
    code_expires_at DATETIME,
    attempts INT NOT NULL DEFAULT 0,
    sent_at DATETIME,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS auth_totp_pending (
    user_id INT PRIMARY KEY,
    secret VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS auth_captcha_sessions (
    token VARCHAR(128) PRIMARY KEY,
    code_hash VARCHAR(255) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(
    `INSERT IGNORE INTO contact_customers (contact_id, customer_id)
     SELECT id, customer_id FROM contacts WHERE customer_id IS NOT NULL`
  );
};

const ready = (async () => {
  await waitForDb();
  await init();
})();

module.exports = {
  pool,
  ready,
  query,
  get,
  run,
  transaction,
};

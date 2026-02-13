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
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NOT NULL,
    entity_id INT NOT NULL,
    before_data TEXT,
    after_data TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

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
  await addColumnIfMissing('tickets', 'project_id', 'project_id INT NULL AFTER created_by');

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

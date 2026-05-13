const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'prompt_center_user';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || 'prompt_center_pass';
const DB_NAME = process.env.MYSQL_DATABASE || 'juxin_prompt_center';
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
    await adminPool.query(`CREATE USER IF NOT EXISTS '${safeAppUser}'@'%' IDENTIFIED BY ?`, [String(DB_PASSWORD)]);
    await adminPool.query(`ALTER USER '${safeAppUser}'@'%' IDENTIFIED BY ?`, [String(DB_PASSWORD)]);
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
  await run(`CREATE TABLE IF NOT EXISTS pc_departments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pc_departments_name (name),
    INDEX idx_pc_departments_active_sort (is_active, sort_order, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS pc_categories (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    department_id BIGINT NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pc_categories_dept_name (department_id, name),
    INDEX idx_pc_categories_dept_sort (department_id, is_active, sort_order, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS pc_prompts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    department_id BIGINT NOT NULL,
    category_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary VARCHAR(512) NULL,
    content MEDIUMTEXT NOT NULL,
    tags_json JSON NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    visibility VARCHAR(16) NOT NULL DEFAULT 'department',
    current_version_id BIGINT NULL,
    usage_count BIGINT NOT NULL DEFAULT 0,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    published_at DATETIME NULL,
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pc_prompts_scope (department_id, category_id, status, updated_at),
    INDEX idx_pc_prompts_status (status, updated_at),
    FULLTEXT KEY ft_pc_prompts_text (title, summary, content)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS pc_prompt_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    prompt_id BIGINT NOT NULL,
    version_no INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary VARCHAR(512) NULL,
    content MEDIUMTEXT NOT NULL,
    tags_json JSON NULL,
    change_note VARCHAR(512) NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pc_prompt_versions_no (prompt_id, version_no),
    INDEX idx_pc_prompt_versions_prompt (prompt_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS pc_audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id BIGINT NULL,
    actor_name VARCHAR(128) NULL,
    actor_role VARCHAR(64) NULL,
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NOT NULL,
    entity_id BIGINT NULL,
    detail_json JSON NULL,
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pc_audit_logs_created (created_at),
    INDEX idx_pc_audit_logs_entity (entity, entity_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
};

const seedDefaults = async () => {
  const rows = await query('SELECT COUNT(1) AS total FROM pc_departments');
  if (Number(rows[0]?.total || 0) > 0) return;
  await transaction(async (tx) => {
    const sales = await tx.run(
      'INSERT INTO pc_departments (name, description, sort_order) VALUES (?, ?, ?)',
      ['销售部', '销售话术、客户拜访和商机推进提示词', 10]
    );
    const tech = await tx.run(
      'INSERT INTO pc_departments (name, description, sort_order) VALUES (?, ?, ?)',
      ['技术部', '技术方案、故障排查和知识沉淀提示词', 20]
    );
    await tx.run(
      'INSERT INTO pc_categories (department_id, name, description, sort_order) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
      [
        sales.insertId,
        '客户话术',
        '拜访开场、异议处理、复盘总结',
        10,
        sales.insertId,
        '客户总结',
        '会议纪要、客户画像、下一步动作',
        20,
        tech.insertId,
        '技术方案',
        '方案撰写、排障分析、变更说明',
        10,
      ]
    );
  });
};

const initDb = async () => {
  if (pool) return pool;
  await bootstrapDatabase();
  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, DB_NAME);
  await createSchema();
  await seedDefaults();
  return pool;
};

const closeDb = async () => {
  if (!pool) return;
  await pool.end();
  pool = null;
};

module.exports = {
  createSchema,
  initDb,
  closeDb,
  query,
  get,
  run,
  transaction,
};

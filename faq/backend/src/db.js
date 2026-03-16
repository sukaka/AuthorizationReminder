const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'faq_user';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || 'faq_pass';
const DB_NAME = process.env.MYSQL_DATABASE || 'juxin_faq';
const AUTH_DB_NAME = process.env.AUTH_MYSQL_DATABASE || 'juxin_reminder';
const DB_ADMIN_USER = process.env.MYSQL_ADMIN_USER || DB_USER;
const DB_ADMIN_PASSWORD = process.env.MYSQL_ADMIN_PASSWORD !== undefined ? process.env.MYSQL_ADMIN_PASSWORD : DB_PASSWORD;
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
  const adminUser = DB_ADMIN_USER;
  const adminPassword = DB_ADMIN_PASSWORD;

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

const ensureColumn = async (tableName, columnName, columnDefSql) => {
  const exists = await get(
    `SELECT COUNT(1) AS total
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = ?
       AND column_name = ?`,
    [DB_NAME, tableName, columnName]
  );
  if (Number(exists?.total || 0) > 0) return;
  await run(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefSql}`);
};

const ensureIndex = async (tableName, indexName, indexDefSql) => {
  const exists = await get(
    `SELECT COUNT(1) AS total
     FROM information_schema.statistics
     WHERE table_schema = ?
       AND table_name = ?
       AND index_name = ?`,
    [DB_NAME, tableName, indexName]
  );
  if (Number(exists?.total || 0) > 0) return;
  try {
    await run(`ALTER TABLE \`${tableName}\` ADD ${indexDefSql}`);
  } catch (err) {
    console.warn(`[db] skip index ${tableName}.${indexName}: ${err?.message || err}`);
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
  await run(`CREATE TABLE IF NOT EXISTS faq_categories (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    parent_id BIGINT NULL,
    library_scope VARCHAR(16) NOT NULL DEFAULT 'department',
    department_code VARCHAR(32) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_categories_parent (parent_id),
    INDEX idx_faq_categories_scope (library_scope, department_code, is_active),
    INDEX idx_faq_categories_active (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_articles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    summary TEXT NULL,
    category_id BIGINT NULL,
    library_scope VARCHAR(16) NOT NULL DEFAULT 'department',
    department_code VARCHAR(32) NULL,
    tags_json TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    is_deleted TINYINT NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    deleted_by_id BIGINT NULL,
    deleted_by_name VARCHAR(128) NULL,
    purge_after DATETIME NULL,
    is_pinned TINYINT NOT NULL DEFAULT 0,
    current_version_id BIGINT NULL,
    published_version_id BIGINT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    published_by_id BIGINT NULL,
    published_by_name VARCHAR(128) NULL,
    published_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_articles_category (category_id),
    INDEX idx_faq_articles_scope (library_scope, department_code, status, is_deleted),
    INDEX idx_faq_articles_status (status),
    INDEX idx_faq_articles_deleted (is_deleted, purge_after, updated_at),
    INDEX idx_faq_articles_pinned (is_pinned, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_article_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    version_no INT NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'upload',
    source_ext VARCHAR(16) NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NULL,
    editable_file_path VARCHAR(512) NULL,
    preview_file_path VARCHAR(512) NULL,
    render_type VARCHAR(32) NOT NULL DEFAULT 'pdf_inline',
    render_status VARCHAR(32) NOT NULL DEFAULT 'ready',
    render_error TEXT NULL,
    search_text LONGTEXT NULL,
    is_published_version TINYINT NOT NULL DEFAULT 0,
    parent_version_id BIGINT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_faq_versions_article_no (article_id, version_no),
    INDEX idx_faq_versions_article_created (article_id, created_at),
    INDEX idx_faq_versions_render_status (render_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_article_drafts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    base_version_id BIGINT NULL,
    draft_file_path VARCHAR(512) NOT NULL,
    draft_file_name VARCHAR(255) NOT NULL,
    draft_ext VARCHAR(16) NOT NULL DEFAULT 'docx',
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_faq_drafts_article (article_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_editor_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_key VARCHAR(64) NOT NULL,
    article_id BIGINT NOT NULL,
    version_id BIGINT NULL,
    draft_id BIGINT NULL,
    lock_owner_id BIGINT NOT NULL,
    lock_owner_name VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    expires_at DATETIME NOT NULL,
    released_at DATETIME NULL,
    last_saved_at DATETIME NULL,
    callback_token VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_faq_editor_session_key (session_key),
    INDEX idx_faq_editor_sessions_article_status (article_id, status, expires_at),
    INDEX idx_faq_editor_sessions_owner (lock_owner_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_editor_section_locks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    section_key VARCHAR(64) NOT NULL,
    section_name VARCHAR(128) NULL,
    lock_owner_id BIGINT NOT NULL,
    lock_owner_name VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    expires_at DATETIME NOT NULL,
    released_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_faq_section_lock (article_id, section_key, status),
    INDEX idx_faq_section_locks_article (article_id, status, expires_at),
    INDEX idx_faq_section_locks_owner (lock_owner_id, status, expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_favorites (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_faq_favorites (article_id, user_id),
    INDEX idx_faq_favorites_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_view_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    viewer_id BIGINT NULL,
    viewer_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_faq_view_events_article (article_id, created_at),
    INDEX idx_faq_view_events_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_view_daily (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    day DATE NOT NULL,
    view_count INT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_faq_view_daily (article_id, day),
    INDEX idx_faq_view_daily_day (day)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_operation_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NULL,
    action VARCHAR(64) NOT NULL,
    message VARCHAR(255) NULL,
    before_data LONGTEXT NULL,
    after_data LONGTEXT NULL,
    operator_id BIGINT NULL,
    operator_name VARCHAR(128) NULL,
    operator_role VARCHAR(32) NULL,
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_faq_oplogs_article (article_id, created_at),
    INDEX idx_faq_oplogs_action (action, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_publish_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    target_version_id BIGINT NOT NULL,
    publish_note VARCHAR(500) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    requester_id BIGINT NOT NULL,
    requester_name VARCHAR(128) NOT NULL,
    reviewer_id BIGINT NULL,
    reviewer_name VARCHAR(128) NULL,
    review_comment VARCHAR(500) NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_pubreq_status (status, created_at),
    INDEX idx_faq_pubreq_article (article_id, created_at),
    INDEX idx_faq_pubreq_requester (requester_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_templates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description VARCHAR(255) NULL,
    title_template VARCHAR(255) NULL,
    summary_template TEXT NULL,
    body_template LONGTEXT NULL,
    category_id BIGINT NULL,
    tags_json TEXT NULL,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_templates_active (is_active, updated_at),
    INDEX idx_faq_templates_category (category_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_snippets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    content TEXT NOT NULL,
    tags_json TEXT NULL,
    usage_count INT NOT NULL DEFAULT 0,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_snippets_active (is_active, updated_at),
    INDEX idx_faq_snippets_usage (usage_count, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_event_outbox (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    target_system VARCHAR(32) NOT NULL DEFAULT 'reminder',
    event_type VARCHAR(64) NOT NULL,
    article_id BIGINT NULL,
    payload_json LONGTEXT NULL,
    delivery_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    delivery_attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    delivered_at DATETIME NULL,
    next_retry_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_outbox_status (delivery_status, next_retry_at, created_at),
    INDEX idx_faq_outbox_event (event_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_article_access_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    requester_id BIGINT NOT NULL,
    requester_name VARCHAR(128) NOT NULL,
    requester_department_code VARCHAR(32) NULL,
    target_department_code VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    request_reason VARCHAR(500) NULL,
    review_comment VARCHAR(500) NULL,
    reviewed_by_id BIGINT NULL,
    reviewed_by_name VARCHAR(128) NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_access_req_article (article_id, created_at),
    INDEX idx_faq_access_req_requester (requester_id, status, created_at),
    INDEX idx_faq_access_req_target (target_department_code, status, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_article_access_grants (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    request_id BIGINT NULL,
    grantee_id BIGINT NOT NULL,
    grantee_name VARCHAR(128) NOT NULL,
    target_department_code VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'approved',
    duration_code VARCHAR(16) NOT NULL DEFAULT '7d',
    expires_at DATETIME NULL,
    approved_by_id BIGINT NULL,
    approved_by_name VARCHAR(128) NULL,
    approved_at DATETIME NULL,
    revoked_by_id BIGINT NULL,
    revoked_by_name VARCHAR(128) NULL,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faq_access_grants_article (article_id, grantee_id, status, expires_at),
    INDEX idx_faq_access_grants_request (request_id),
    INDEX idx_faq_access_grants_grantee (grantee_id, status, expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_article_department_backfill_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    reason VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_faq_backfill_article (article_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS faq_article_feedback (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    version_id BIGINT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    solved TINYINT NOT NULL DEFAULT 1,
    reason_code VARCHAR(32) NULL,
    reason_text VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_faq_feedback_article_user (article_id, user_id),
    INDEX idx_faq_feedback_article (article_id, created_at),
    INDEX idx_faq_feedback_solved (solved, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await ensureColumn('faq_articles', 'is_deleted', 'is_deleted TINYINT NOT NULL DEFAULT 0');
  await ensureColumn('faq_articles', 'deleted_at', 'deleted_at DATETIME NULL');
  await ensureColumn('faq_articles', 'deleted_by_id', 'deleted_by_id BIGINT NULL');
  await ensureColumn('faq_articles', 'deleted_by_name', 'deleted_by_name VARCHAR(128) NULL');
  await ensureColumn('faq_articles', 'purge_after', 'purge_after DATETIME NULL');
  await ensureColumn('faq_articles', 'pinned_reason', 'pinned_reason VARCHAR(255) NULL');
  await ensureColumn('faq_articles', 'pin_score', 'pin_score DECIMAL(10,4) NULL');
  await ensureColumn('faq_articles', 'library_scope', "library_scope VARCHAR(16) NOT NULL DEFAULT 'department'");
  await ensureColumn('faq_articles', 'department_code', 'department_code VARCHAR(32) NULL');
  await ensureColumn('faq_categories', 'library_scope', "library_scope VARCHAR(16) NOT NULL DEFAULT 'department'");
  await ensureColumn('faq_categories', 'department_code', 'department_code VARCHAR(32) NULL');
  await ensureColumn('faq_article_versions', 'search_text', 'search_text LONGTEXT NULL');
  await ensureColumn('faq_article_versions', 'publish_note', 'publish_note VARCHAR(500) NULL');
  await ensureIndex(
    'faq_articles',
    'idx_faq_articles_scope',
    'INDEX idx_faq_articles_scope (library_scope, department_code, status, is_deleted)'
  );
  await ensureIndex(
    'faq_categories',
    'idx_faq_categories_scope',
    'INDEX idx_faq_categories_scope (library_scope, department_code, is_active)'
  );
  await ensureIndex(
    'faq_article_versions',
    'ft_faq_versions_search_text',
    'FULLTEXT INDEX `ft_faq_versions_search_text` (`search_text`)'
  );

  const categoryCount = await get('SELECT COUNT(1) AS count FROM faq_categories');
  if (Number(categoryCount?.count || 0) === 0) {
    await run(
      `INSERT INTO faq_categories (name, parent_id, library_scope, department_code, sort_order, is_active, created_by_id, created_by_name)
       VALUES
       ('常见问题', NULL, 'global', NULL, 10, 1, 0, 'system'),
       ('操作指南', NULL, 'global', NULL, 20, 1, 0, 'system'),
       ('故障排查', NULL, 'global', NULL, 30, 1, 0, 'system')`
    );
  }
};

const buildAuthDepartmentMap = async () => {
  const authPool = buildPool({
    database: AUTH_DB_NAME,
    user: DB_ADMIN_USER,
    password: DB_ADMIN_PASSWORD,
  });
  try {
    await waitForDb(authPool, 'auth database');
    const [rows] = await authPool.query(
      `SELECT id, department_code
       FROM users
       WHERE department_code IS NOT NULL
         AND department_code <> ''`
    );
    return new Map(
      rows
        .map((item) => [Number(item.id || 0), String(item.department_code || '').trim().toUpperCase()])
        .filter(([userId, departmentCode]) => userId > 0 && departmentCode)
    );
  } catch (err) {
    console.warn(`[db] skip faq department backfill from auth: ${err?.message || err}`);
    return new Map();
  } finally {
    await authPool.end();
  }
};

const backfillDepartmentLibraries = async () => {
  const userDepartments = await buildAuthDepartmentMap();
  const articleRows = await query(
    `SELECT id, created_by_id, created_by_name, library_scope, department_code
     FROM faq_articles
     WHERE library_scope IS NULL
        OR library_scope = ''
        OR (library_scope = 'department' AND (department_code IS NULL OR department_code = ''))`
  );
  for (const row of articleRows) {
    const articleId = Number(row.id || 0);
    const createdById = Number(row.created_by_id || 0);
    const mappedDepartment = userDepartments.get(createdById) || '';
    if (mappedDepartment) {
      await run(
        `UPDATE faq_articles
         SET library_scope = 'department', department_code = ?
         WHERE id = ?`,
        [mappedDepartment, articleId]
      );
      continue;
    }
    if (createdById === 0 || String(row.created_by_name || '').trim().toLowerCase() === 'system') {
      await run(
        `UPDATE faq_articles
         SET library_scope = 'global', department_code = NULL
         WHERE id = ?`,
        [articleId]
      );
      continue;
    }
    await run(
      `INSERT IGNORE INTO faq_article_department_backfill_queue
        (article_id, created_by_id, created_by_name, reason)
       VALUES (?, ?, ?, ?)`,
      [articleId, createdById || null, row.created_by_name || null, '缺少创建人部门映射']
    );
  }

  const categoryRows = await query(
    `SELECT id, created_by_id, created_by_name, library_scope, department_code
     FROM faq_categories
     WHERE library_scope IS NULL
        OR library_scope = ''
        OR (library_scope = 'department' AND (department_code IS NULL OR department_code = ''))`
  );
  for (const row of categoryRows) {
    const categoryId = Number(row.id || 0);
    const createdById = Number(row.created_by_id || 0);
    const mappedDepartment = userDepartments.get(createdById) || '';
    if (mappedDepartment) {
      await run(
        `UPDATE faq_categories
         SET library_scope = 'department', department_code = ?
         WHERE id = ?`,
        [mappedDepartment, categoryId]
      );
      continue;
    }
    await run(
      `UPDATE faq_categories
       SET library_scope = 'global', department_code = NULL
       WHERE id = ?`,
      [categoryId]
    );
  }
};

const initDb = async () => {
  await bootstrapDatabase();
  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, 'faq database');
  await createSchema();
  await backfillDepartmentLibraries();
};

module.exports = {
  initDb,
  query,
  get,
  run,
  transaction,
};

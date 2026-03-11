const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'train_exam_user';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || 'train_exam_pass';
const DB_NAME = process.env.MYSQL_DATABASE || 'juxin_train_exam';
const DB_CONN_LIMIT = Number(process.env.DB_CONNECTION_LIMIT || 10);
const DB_RETRIES = Number(process.env.DB_CONNECT_RETRIES || 30);
const DB_RETRY_DELAY = Number(process.env.DB_CONNECT_DELAY_MS || 2000);
const DOC_PREVIEW_MIN_SECONDS_DEFAULT = Math.max(15, Math.min(600, Number(process.env.DOC_PREVIEW_MIN_SECONDS || 45)));

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

const hasColumn = async (tableName, columnName) => {
  const row = await get(
    `SELECT COUNT(1) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [DB_NAME, String(tableName), String(columnName)]
  );
  return Number(row?.total || 0) > 0;
};

const addColumnIfMissing = async (tableName, columnName, columnSql) => {
  const exists = await hasColumn(tableName, columnName);
  if (exists) return;
  await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
};

const createSchema = async () => {
  await run(`CREATE TABLE IF NOT EXISTS te_courses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    duration_minutes INT NOT NULL DEFAULT 60,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_courses_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_course_resources (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    resource_type VARCHAR(16) NOT NULL,
    source_mode VARCHAR(16) NOT NULL,
    storage_backend VARCHAR(16) NOT NULL DEFAULT 'local',
    force_watch TINYINT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    storage_path VARCHAR(512) NULL,
    object_key VARCHAR(512) NULL,
    object_etag VARCHAR(128) NULL,
    upload_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    source_url VARCHAR(1024) NULL,
    mime_type VARCHAR(128) NULL,
    file_size BIGINT NULL,
    duration_seconds INT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_course_resources_course (course_id, created_at),
    INDEX idx_te_course_resources_type (resource_type, source_mode)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_resource_progress (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    viewed_seconds INT NOT NULL DEFAULT 0,
    last_position_seconds INT NOT NULL DEFAULT 0,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_resource_progress_user_resource (user_id, resource_id),
    INDEX idx_te_resource_progress_course_user (course_id, user_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_user_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    department VARCHAR(128) NULL,
    position_title VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_user_profiles_user (user_id),
    INDEX idx_te_user_profiles_dept_pos (department, position_title)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_system_settings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(128) NOT NULL,
    setting_value TEXT NOT NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_system_settings_key (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('ALTER TABLE te_system_settings MODIFY COLUMN setting_value TEXT NOT NULL');

  await run(
    `INSERT INTO te_system_settings (setting_key, setting_value, updated_by_name)
     VALUES ('doc_preview_min_seconds', ?, 'system')
     ON DUPLICATE KEY UPDATE
       setting_value = CASE WHEN IFNULL(setting_value, '') = '' THEN VALUES(setting_value) ELSE setting_value END,
       updated_at = NOW()`,
    [String(DOC_PREVIEW_MIN_SECONDS_DEFAULT)]
  );

  await run(`CREATE TABLE IF NOT EXISTS te_course_enrollments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_course_enrollments (course_id, user_id),
    INDEX idx_te_course_enrollments_user (user_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_question_generation_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    payload_json LONGTEXT NULL,
    result_json LONGTEXT NULL,
    error_message TEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    ran_at DATETIME NULL,
    published_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_qgen_jobs_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_question_generation_sources (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    faq_article_id BIGINT NOT NULL,
    faq_version_id BIGINT NULL,
    source_title VARCHAR(255) NULL,
    category_id BIGINT NULL,
    search_text LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_te_qgen_sources_job (job_id, faq_article_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_question_categories (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    is_system TINYINT NOT NULL DEFAULT 0,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_question_categories_name (name),
    INDEX idx_te_question_categories_system (is_system, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_question_bank (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
    generation_job_id BIGINT NULL,
    stem TEXT NOT NULL,
    question_type VARCHAR(32) NOT NULL,
    difficulty VARCHAR(16) NOT NULL DEFAULT 'medium',
    question_category VARCHAR(64) NOT NULL DEFAULT '未分类',
    tags_json TEXT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    explanation TEXT NULL,
    points DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    meta_json LONGTEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    reviewed_by_id BIGINT NULL,
    reviewed_by_name VARCHAR(128) NULL,
    review_comment VARCHAR(500) NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_question_bank_status (status, updated_at),
    INDEX idx_te_question_bank_type (question_type, difficulty),
    INDEX idx_te_question_bank_category (question_category, status),
    INDEX idx_te_question_bank_source (source_type, generation_job_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_question_options (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    question_id BIGINT NOT NULL,
    option_key VARCHAR(8) NOT NULL,
    option_text TEXT NOT NULL,
    is_correct TINYINT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_te_question_options_question (question_id, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_question_answers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    question_id BIGINT NOT NULL,
    answer_text TEXT NULL,
    answer_values_text TEXT NULL,
    answer_aliases_text TEXT NULL,
    answer_json LONGTEXT NULL,
    answer_aliases_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_question_answers_question (question_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_question_review_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    question_id BIGINT NOT NULL,
    action VARCHAR(16) NOT NULL,
    comment VARCHAR(500) NULL,
    operator_id BIGINT NULL,
    operator_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_te_question_review_logs_question (question_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_import_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    file_name VARCHAR(255) NULL,
    storage_path VARCHAR(512) NULL,
    total_rows INT NOT NULL DEFAULT 0,
    success_rows INT NOT NULL DEFAULT 0,
    failed_rows INT NOT NULL DEFAULT 0,
    error_rows_json LONGTEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    finished_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_import_jobs_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_resource_transcode_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    resource_id BIGINT NOT NULL,
    source_path VARCHAR(512) NOT NULL,
    target_path VARCHAR(512) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    progress_percent INT NOT NULL DEFAULT 0,
    source_codec VARCHAR(32) NULL,
    target_codec VARCHAR(32) NULL,
    error_message TEXT NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_resource_transcode_jobs_status (status, updated_at),
    INDEX idx_te_resource_transcode_jobs_resource (resource_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_papers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    paper_mode VARCHAR(16) NOT NULL DEFAULT 'fixed',
    course_id BIGINT NULL,
    pass_score DECIMAL(10,2) NOT NULL DEFAULT 80.00,
    duration_minutes INT NOT NULL DEFAULT 60,
    max_attempts INT NOT NULL DEFAULT 3,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    published_at DATETIME NULL,
    archived_at DATETIME NULL,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_papers_status (status, updated_at),
    INDEX idx_te_papers_mode (paper_mode, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_paper_question_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    paper_id BIGINT NOT NULL,
    question_type VARCHAR(32) NULL,
    difficulty VARCHAR(16) NULL,
    question_categories_json TEXT NULL,
    tags_json TEXT NULL,
    question_count INT NOT NULL DEFAULT 1,
    points_per_question DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_te_paper_question_rules_paper (paper_id, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_paper_questions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    paper_id BIGINT NOT NULL,
    question_id BIGINT NOT NULL,
    question_snapshot_json LONGTEXT NOT NULL,
    points DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_te_paper_questions_paper (paper_id, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_exam_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    paper_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    user_department VARCHAR(128) NULL,
    user_position VARCHAR(128) NULL,
    attempt_no INT NOT NULL DEFAULT 1,
    status VARCHAR(16) NOT NULL DEFAULT 'started',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME NULL,
    submitted_at DATETIME NULL,
    duration_minutes INT NOT NULL DEFAULT 60,
    pass_score DECIMAL(10,2) NOT NULL DEFAULT 80.00,
    max_attempts INT NOT NULL DEFAULT 3,
    focus_switch_count INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_exam_sessions_user_paper (user_id, paper_id, created_at),
    INDEX idx_te_exam_sessions_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_exam_answers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    question_id BIGINT NOT NULL,
    question_snapshot_json LONGTEXT NOT NULL,
    standard_answer_json LONGTEXT NULL,
    user_answer_json LONGTEXT NULL,
    is_correct TINYINT NULL,
    earned_score DECIMAL(10,2) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_exam_answers_session (session_id, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_exam_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    paper_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    user_department VARCHAR(128) NULL,
    user_position VARCHAR(128) NULL,
    attempt_no INT NOT NULL DEFAULT 1,
    score DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_score DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    passed TINYINT NOT NULL DEFAULT 0,
    is_final TINYINT NOT NULL DEFAULT 0,
    detail_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_te_exam_results_user_paper (user_id, paper_id, created_at),
    INDEX idx_te_exam_results_final (is_final, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_certificates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    result_id BIGINT NOT NULL,
    certificate_no VARCHAR(64) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    valid_from DATETIME NULL,
    valid_until DATETIME NULL,
    validity_days INT NOT NULL DEFAULT 365,
    renewal_remind_days INT NOT NULL DEFAULT 30,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id BIGINT NULL,
    created_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_certificates_result (result_id),
    UNIQUE KEY uk_te_certificates_no (certificate_no),
    INDEX idx_te_certificates_validity (status, valid_until)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_recertification_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    certificate_id BIGINT NOT NULL,
    result_id BIGINT NOT NULL,
    paper_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    due_at DATETIME NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    trigger_type VARCHAR(16) NOT NULL DEFAULT 'auto',
    note VARCHAR(255) NULL,
    started_session_id BIGINT NULL,
    completed_result_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_te_recert_user_status (user_id, status, due_at),
    INDEX idx_te_recert_cert_status (certificate_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await addColumnIfMissing('te_course_resources', 'sort_order', 'sort_order INT NOT NULL DEFAULT 0');
  await addColumnIfMissing('te_course_resources', 'force_watch', 'force_watch TINYINT NOT NULL DEFAULT 0');
  await addColumnIfMissing('te_course_resources', 'storage_backend', "storage_backend VARCHAR(16) NOT NULL DEFAULT 'local'");
  await addColumnIfMissing('te_course_resources', 'object_key', 'object_key VARCHAR(512) NULL');
  await addColumnIfMissing('te_course_resources', 'object_etag', 'object_etag VARCHAR(128) NULL');
  await addColumnIfMissing('te_course_resources', 'upload_status', "upload_status VARCHAR(16) NOT NULL DEFAULT 'pending'");
  await addColumnIfMissing('te_course_resources', 'transcode_status', "transcode_status VARCHAR(16) NOT NULL DEFAULT 'none'");
  await addColumnIfMissing('te_course_resources', 'transcode_progress', 'transcode_progress INT NOT NULL DEFAULT 100');
  await addColumnIfMissing('te_course_resources', 'transcode_message', 'transcode_message VARCHAR(255) NULL');
  await addColumnIfMissing('te_course_resources', 'transcode_job_id', 'transcode_job_id BIGINT NULL');
  await addColumnIfMissing('te_question_answers', 'answer_values_text', 'answer_values_text TEXT NULL');
  await addColumnIfMissing('te_question_answers', 'answer_aliases_text', 'answer_aliases_text TEXT NULL');
  await addColumnIfMissing('te_question_bank', 'question_category', "question_category VARCHAR(64) NOT NULL DEFAULT '未分类'");
  await addColumnIfMissing('te_paper_question_rules', 'question_categories_json', 'question_categories_json TEXT NULL');
  await addColumnIfMissing('te_exam_sessions', 'user_department', 'user_department VARCHAR(128) NULL');
  await addColumnIfMissing('te_exam_sessions', 'user_position', 'user_position VARCHAR(128) NULL');
  await addColumnIfMissing('te_exam_results', 'user_department', 'user_department VARCHAR(128) NULL');
  await addColumnIfMissing('te_exam_results', 'user_position', 'user_position VARCHAR(128) NULL');
  await addColumnIfMissing('te_certificates', 'status', "status VARCHAR(16) NOT NULL DEFAULT 'active'");
  await addColumnIfMissing('te_certificates', 'valid_from', 'valid_from DATETIME NULL');
  await addColumnIfMissing('te_certificates', 'valid_until', 'valid_until DATETIME NULL');
  await addColumnIfMissing('te_certificates', 'validity_days', 'validity_days INT NOT NULL DEFAULT 365');
  await addColumnIfMissing('te_certificates', 'renewal_remind_days', 'renewal_remind_days INT NOT NULL DEFAULT 30');
  await addColumnIfMissing('te_certificates', 'updated_at', 'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await run(
    `UPDATE te_course_resources
     SET storage_backend = CASE
       WHEN source_mode = 'external' THEN 'external'
       WHEN IFNULL(storage_backend, '') = '' THEN 'local'
       ELSE storage_backend
     END`
  );

  await run(
    `UPDATE te_course_resources
     SET upload_status = CASE
       WHEN source_mode = 'external' THEN 'ready'
       WHEN IFNULL(object_key, '') <> '' THEN 'ready'
       WHEN IFNULL(storage_path, '') <> '' THEN 'ready'
       WHEN IFNULL(upload_status, '') = '' THEN 'pending'
       ELSE upload_status
     END`
  );

  await run(
    `UPDATE te_course_resources
     SET transcode_status = 'none'
     WHERE IFNULL(transcode_status, '') = ''`
  );

  await run(
    `UPDATE te_question_bank
     SET question_category = CASE
       WHEN source_type = 'faq_auto' THEN 'FAQ自动出题'
       WHEN source_type = 'import' THEN 'Excel导入'
       WHEN source_type = 'manual' THEN '手工创建'
       ELSE '未分类'
     END
     WHERE IFNULL(question_category, '') = '' OR question_category = '未分类'`
  );

  await run(
    `INSERT INTO te_question_categories
      (name, is_system)
     VALUES
      ('未分类', 1),
      ('手工创建', 1),
      ('FAQ自动出题', 1),
      ('Excel导入', 1)
     ON DUPLICATE KEY UPDATE
      is_system = GREATEST(is_system, VALUES(is_system)),
      updated_at = NOW()`
  );

  await run(
    `INSERT INTO te_question_categories (name, is_system)
     SELECT DISTINCT question_category, 0
     FROM te_question_bank
     WHERE IFNULL(question_category, '') <> ''
     ON DUPLICATE KEY UPDATE
      updated_at = NOW()`
  );

  await run(`CREATE TABLE IF NOT EXISTS te_ai_models (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    model_key VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    base_url VARCHAR(512) NULL,
    model_name VARCHAR(255) NULL,
    api_key TEXT NULL,
    timeout_ms INT NOT NULL DEFAULT 20000,
    max_tokens INT NOT NULL DEFAULT 2048,
    temperature_default DECIMAL(4,2) NOT NULL DEFAULT 0.30,
    is_enabled TINYINT NOT NULL DEFAULT 1,
    is_default TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_ai_models_key (model_key),
    INDEX idx_te_ai_models_enabled (is_enabled, is_default)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_ai_prompts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_type VARCHAR(32) NOT NULL,
    prompt_template LONGTEXT NOT NULL,
    is_active TINYINT NOT NULL DEFAULT 1,
    updated_by_id BIGINT NULL,
    updated_by_name VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_ai_prompts_task (task_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_ai_task_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_type VARCHAR(32) NOT NULL,
    model_id BIGINT NULL,
    model_name VARCHAR(255) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    latency_ms INT NULL,
    prompt_tokens INT NULL,
    completion_tokens INT NULL,
    total_tokens INT NULL,
    error_message TEXT NULL,
    operator_id BIGINT NULL,
    operator_name VARCHAR(128) NULL,
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_te_ai_task_logs_task (task_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_result_ai_advices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    result_id BIGINT NOT NULL,
    session_id BIGINT NULL,
    paper_id BIGINT NULL,
    user_id BIGINT NOT NULL,
    username VARCHAR(128) NOT NULL,
    model_id BIGINT NULL,
    model_name VARCHAR(255) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    advice_text LONGTEXT NULL,
    advice_json LONGTEXT NULL,
    source_detail_json LONGTEXT NULL,
    error_message TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_te_result_ai_advices_result (result_id),
    INDEX idx_te_result_ai_advices_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS te_operation_logs (
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
    INDEX idx_te_operation_logs_action (action, created_at),
    INDEX idx_te_operation_logs_entity (entity, entity_id, created_at),
    INDEX idx_te_operation_logs_user (username, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const defaultModels = [
    {
      modelKey: 'kimi_2_5',
      name: 'Kimi 2.5',
      baseUrl: process.env.AI_KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
      modelName: process.env.AI_KIMI_MODEL_NAME || 'moonshot-v1-8k',
      isDefault: 1,
    },
    {
      modelKey: 'chatgpt',
      name: 'ChatGPT',
      baseUrl: process.env.AI_CHATGPT_BASE_URL || 'https://api.openai.com/v1',
      modelName: process.env.AI_CHATGPT_MODEL_NAME || 'gpt-4o-mini',
      isDefault: 0,
    },
    {
      modelKey: 'doubao',
      name: '豆包',
      baseUrl: process.env.AI_DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
      modelName: process.env.AI_DOUBAO_MODEL_NAME || 'doubao-1.5-pro-256k',
      isDefault: 0,
    },
  ];

  for (const item of defaultModels) {
    await run(
      `INSERT INTO te_ai_models
        (model_key, name, base_url, model_name, api_key, timeout_ms, max_tokens, temperature_default, is_enabled, is_default)
       VALUES (?, ?, ?, ?, '', 20000, 2048, 0.30, 1, ?)
       ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        base_url = CASE WHEN IFNULL(base_url, '') = '' THEN VALUES(base_url) ELSE base_url END,
        model_name = CASE WHEN IFNULL(model_name, '') = '' THEN VALUES(model_name) ELSE model_name END,
        updated_at = NOW()`,
      [item.modelKey, item.name, item.baseUrl, item.modelName, item.isDefault]
    );
  }

  const defaultEnabledRow = await get(
    `SELECT id
     FROM te_ai_models
     WHERE is_enabled = 1 AND is_default = 1
     ORDER BY id ASC
     LIMIT 1`
  );
  if (!defaultEnabledRow) {
    const kimiRow = await get('SELECT id FROM te_ai_models WHERE model_key = ? LIMIT 1', ['kimi_2_5']);
    if (kimiRow) {
      await run('UPDATE te_ai_models SET is_default = 0');
      await run('UPDATE te_ai_models SET is_enabled = 1, is_default = 1 WHERE id = ?', [Number(kimiRow.id)]);
    }
  } else {
    const activeDefault = await get('SELECT id, model_key FROM te_ai_models WHERE id = ? LIMIT 1', [Number(defaultEnabledRow.id)]);
    if (String(activeDefault?.model_key || '').trim().toLowerCase() === 'default_openai_compat') {
      const kimiRow = await get('SELECT id FROM te_ai_models WHERE model_key = ? LIMIT 1', ['kimi_2_5']);
      if (kimiRow) {
        await run('UPDATE te_ai_models SET is_default = 0');
        await run('UPDATE te_ai_models SET is_enabled = 1, is_default = 1 WHERE id = ?', [Number(kimiRow.id)]);
      }
    }
  }

  await run(
    `INSERT INTO te_ai_prompts (task_type, prompt_template, is_active)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE task_type = VALUES(task_type)`,
    [
      'FAQ_TO_QUESTIONS',
      '你是企业培训考试出题助手。请把输入FAQ文本转成JSON数组。每项结构：question_type(single_choice|multiple_choice|judgement|fill_blank),stem,options(客观题必填),answer,answer_aliases,difficulty,explanation,tags。只输出JSON。',
    ]
  );

  await run(
    `INSERT INTO te_ai_prompts (task_type, prompt_template, is_active)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE task_type = VALUES(task_type)`,
    [
      'EXAM_ADVICE',
      '你是企业培训考试辅导教练。请根据考试成绩与错题信息，输出简体中文学习建议：1）先给总体评价（1-2句）；2）给3-5条可执行改进建议；3）指出优先复训的知识点；4）给出7天复习计划。请直接输出可读文本，分段清晰，避免空话。',
    ]
  );
};

const initDb = async () => {
  await bootstrapDatabase();
  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, 'train-exam database');
  await createSchema();
};

module.exports = {
  initDb,
  query,
  get,
  run,
  transaction,
};

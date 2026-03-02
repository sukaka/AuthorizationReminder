USE cmdb;
SET NAMES utf8mb4;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'cmdb' AND TABLE_NAME = 'discovery_task' AND COLUMN_NAME = 'task_mode'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE discovery_task ADD COLUMN task_mode ENUM('scan','cloud') NOT NULL DEFAULT 'scan' AFTER ci_type_id",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'cmdb' AND TABLE_NAME = 'discovery_task' AND COLUMN_NAME = 'source_type'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE discovery_task ADD COLUMN source_type ENUM('mock','http') NOT NULL DEFAULT 'mock' AFTER task_mode",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'cmdb' AND TABLE_NAME = 'discovery_task' AND COLUMN_NAME = 'endpoint_url'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE discovery_task ADD COLUMN endpoint_url VARCHAR(255) NULL AFTER source_type",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'cmdb' AND TABLE_NAME = 'discovery_task' AND COLUMN_NAME = 'sync_mode'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE discovery_task ADD COLUMN sync_mode ENUM('create_only','upsert') NOT NULL DEFAULT 'upsert' AFTER endpoint_url",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'cmdb' AND TABLE_NAME = 'discovery_task' AND COLUMN_NAME = 'request_method'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE discovery_task ADD COLUMN request_method ENUM('GET','POST') NOT NULL DEFAULT 'GET' AFTER sync_mode",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'cmdb' AND TABLE_NAME = 'discovery_run_log' AND COLUMN_NAME = 'created_count'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE discovery_run_log ADD COLUMN created_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER success_count",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'cmdb' AND TABLE_NAME = 'discovery_run_log' AND COLUMN_NAME = 'updated_count'
);
SET @sql := IF(@exists = 0,
  "ALTER TABLE discovery_run_log ADD COLUMN updated_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER created_count",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

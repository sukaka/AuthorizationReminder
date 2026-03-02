USE cmdb;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cmdb_model_template (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_uid CHAR(26) NOT NULL,
  name VARCHAR(128) NOT NULL,
  ci_type_id BIGINT UNSIGNED NOT NULL,
  icon VARCHAR(8) NULL,
  description VARCHAR(255) NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  active_flag TINYINT GENERATED ALWAYS AS (CASE WHEN deleted = 0 THEN 1 ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_model_uid (model_uid),
  UNIQUE KEY uk_model_name_active (name, active_flag),
  KEY idx_model_type (ci_type_id),
  CONSTRAINT fk_model_ci_type FOREIGN KEY (ci_type_id) REFERENCES ci_type(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS discovery_task (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_uid CHAR(26) NOT NULL,
  name VARCHAR(128) NOT NULL,
  ci_type_id BIGINT UNSIGNED NOT NULL,
  owner VARCHAR(128) NULL,
  schedule_text VARCHAR(64) NOT NULL DEFAULT '每天 02:00',
  batch_size INT UNSIGNED NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at TIMESTAMP NULL,
  last_status ENUM('success','partial','failed') NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  active_flag TINYINT GENERATED ALWAYS AS (CASE WHEN deleted = 0 THEN 1 ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_discovery_task_uid (task_uid),
  UNIQUE KEY uk_discovery_task_name_active (name, active_flag),
  KEY idx_discovery_type (ci_type_id),
  KEY idx_discovery_enabled (enabled, deleted),
  CONSTRAINT fk_discovery_task_ci_type FOREIGN KEY (ci_type_id) REFERENCES ci_type(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS discovery_run_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_uid CHAR(26) NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  task_uid CHAR(26) NOT NULL,
  task_name VARCHAR(128) NOT NULL,
  ci_type_id BIGINT UNSIGNED NOT NULL,
  status ENUM('success','partial','failed') NOT NULL,
  success_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(255) NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_discovery_run_uid (run_uid),
  KEY idx_discovery_log_task_time (task_id, created_at),
  KEY idx_discovery_log_status_time (status, created_at),
  CONSTRAINT fk_discovery_log_task FOREIGN KEY (task_id) REFERENCES discovery_task(id),
  CONSTRAINT fk_discovery_log_ci_type FOREIGN KEY (ci_type_id) REFERENCES ci_type(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO cmdb_model_template (id, model_uid, name, ci_type_id, icon, description) VALUES
  (1, '01JMMODELHOST0000000000001', '主机模型', 2, '◍', '用于 Linux/Windows 主机资产'),
  (2, '01JMMODELDB000000000000001', '数据库模型', 3, '◎', '用于 MySQL/PostgreSQL/Oracle 等数据库实例'),
  (3, '01JMMODELMW000000000000001', '中间件模型', 4, '◉', '用于消息队列、缓存、注册中心等中间件'),
  (4, '01JMMODELENV00000000000001', '网络与环境模型', 5, '◌', '用于交换机、路由器、防火墙和网络环境资产'),
  (5, '01JMMODELAPP00000000000001', '应用模型', 1, '◇', '用于业务应用与服务实例');

INSERT IGNORE INTO discovery_task (id, task_uid, name, ci_type_id, owner, schedule_text, batch_size, enabled) VALUES
  (1, '01JMDISCOVERHOST0000000001', '主机资产巡检发现', 2, 'CMDB平台', '每天 02:00', 2, 1),
  (2, '01JMDISCOVERDB000000000001', '数据库资产快速发现', 3, 'DBA团队', '每 4 小时', 1, 1);

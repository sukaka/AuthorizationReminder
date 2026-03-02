USE cmdb;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cmdb_model_field_rule (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  field_uid CHAR(26) NOT NULL,
  ci_type_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(64) NOT NULL,
  field_label VARCHAR(128) NOT NULL,
  data_type ENUM('string','number','boolean','object','array') NOT NULL DEFAULT 'string',
  required_flag TINYINT(1) NOT NULL DEFAULT 0,
  default_value_json JSON NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  active_flag TINYINT GENERATED ALWAYS AS (CASE WHEN deleted = 0 THEN 1 ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_model_field_uid (field_uid),
  UNIQUE KEY uk_model_field_type_key_active (ci_type_id, field_key, active_flag),
  KEY idx_model_field_type (ci_type_id),
  CONSTRAINT fk_model_field_ci_type FOREIGN KEY (ci_type_id) REFERENCES ci_type(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO cmdb_model_field_rule (
  id, field_uid, ci_type_id, field_key, field_label, data_type, required_flag, default_value_json
) VALUES
  (1, '01JMFIELDHOSTIP00000000001', 2, 'ip', 'IP地址', 'string', 1, NULL),
  (2, '01JMFIELDHOSTCPU0000000001', 2, 'cpu', 'CPU规格', 'string', 0, '"4C"'),
  (3, '01JMFIELDHOSTMEM0000000001', 2, 'memory', '内存', 'string', 0, '"16GB"'),
  (4, '01JMFIELDDBENGINE000000001', 3, 'engine', '数据库引擎', 'string', 1, NULL),
  (5, '01JMFIELDDBPORT00000000001', 3, 'port', '端口', 'number', 0, '3306');

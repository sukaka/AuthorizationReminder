CREATE DATABASE IF NOT EXISTS cmdb DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cmdb;

CREATE TABLE IF NOT EXISTS ci_type (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type_key VARCHAR(64) NOT NULL,
  type_name VARCHAR(128) NOT NULL,
  description VARCHAR(255) NULL,
  schema_json JSON NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ci_type_key (type_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ci (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ci_uid CHAR(26) NOT NULL,
  ci_type_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  unique_key VARCHAR(191) NOT NULL,
  status ENUM('active','inactive','retired') NOT NULL DEFAULT 'active',
  owner VARCHAR(128) NULL,
  source ENUM('manual','discovery','cloud','import') NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(255) NULL,
  extra_attrs_json JSON NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  active_flag TINYINT GENERATED ALWAYS AS (CASE WHEN deleted = 0 THEN 1 ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ci_uid (ci_uid),
  UNIQUE KEY uk_ci_active_unique (ci_type_id, unique_key, active_flag),
  KEY idx_ci_type_status (ci_type_id, status),
  KEY idx_ci_owner (owner),
  KEY idx_ci_updated_at (updated_at),
  CONSTRAINT fk_ci_type FOREIGN KEY (ci_type_id) REFERENCES ci_type(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ci_relation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_ci_id BIGINT UNSIGNED NOT NULL,
  to_ci_id BIGINT UNSIGNED NOT NULL,
  relation_type ENUM('depends_on','runs_on','connects_to','owned_by') NOT NULL,
  attributes_json JSON NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  active_flag TINYINT GENERATED ALWAYS AS (CASE WHEN deleted = 0 THEN 1 ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ci_relation_active (from_ci_id, to_ci_id, relation_type, active_flag),
  KEY idx_relation_from (from_ci_id),
  KEY idx_relation_to (to_ci_id),
  KEY idx_relation_type (relation_type),
  CONSTRAINT fk_relation_from_ci FOREIGN KEY (from_ci_id) REFERENCES ci(id),
  CONSTRAINT fk_relation_to_ci FOREIGN KEY (to_ci_id) REFERENCES ci(id),
  CONSTRAINT chk_no_self_relation CHECK (from_ci_id <> to_ci_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ci_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ci_id BIGINT UNSIGNED NOT NULL,
  op_type ENUM('create','update','delete','relation_update','reconcile') NOT NULL,
  changed_fields JSON NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  operator_sub VARCHAR(128) NOT NULL,
  operator_name VARCHAR(128) NULL,
  request_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_change_ci_time (ci_id, created_at),
  KEY idx_change_operator_time (operator_sub, created_at),
  CONSTRAINT fk_change_ci FOREIGN KEY (ci_id) REFERENCES ci(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS operation_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(64) NOT NULL,
  actor_sub VARCHAR(128) NOT NULL,
  actor_name VARCHAR(128) NULL,
  actor_roles JSON NULL,
  action VARCHAR(128) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_uid VARCHAR(64) NULL,
  http_method VARCHAR(16) NULL,
  http_path VARCHAR(255) NULL,
  status_code INT NULL,
  result ENUM('success','failed') NOT NULL,
  error_message VARCHAR(255) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor_time (actor_sub, created_at),
  KEY idx_audit_resource (resource_type, resource_uid),
  KEY idx_audit_request (request_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rbac_role (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_key VARCHAR(64) NOT NULL,
  role_name VARCHAR(128) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_key (role_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rbac_permission (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  perm_key VARCHAR(128) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_perm_key (perm_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rbac_role_permission (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES rbac_role(id),
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES rbac_permission(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rbac_group_role (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idp_group VARCHAR(128) NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_group_role (idp_group, role_id),
  CONSTRAINT fk_gr_role FOREIGN KEY (role_id) REFERENCES rbac_role(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outbox_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(32) NOT NULL,
  aggregate_uid VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  headers_json JSON NULL,
  status ENUM('pending','published','failed') NOT NULL DEFAULT 'pending',
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP NULL,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_outbox_event_id (event_id),
  KEY idx_outbox_status_time (status, next_retry_at, created_at),
  KEY idx_outbox_aggregate (aggregate_type, aggregate_uid)
) ENGINE=InnoDB;

INSERT IGNORE INTO rbac_role (id, role_key, role_name, description) VALUES
  (1, 'CMDB_ADMIN', 'CMDB Admin', 'Manage types, CI, relations, import and permissions'),
  (2, 'CMDB_EDITOR', 'CMDB Editor', 'Create and update CI and relations'),
  (3, 'CMDB_VIEWER', 'CMDB Viewer', 'Read-only access'),
  (4, 'CMDB_API_CLIENT', 'CMDB API Client', 'Service-to-service access');

INSERT IGNORE INTO rbac_permission (id, perm_key, description) VALUES
  (1, 'ci:read', 'Read CI'),
  (2, 'ci:write', 'Create and update CI'),
  (3, 'relation:write', 'Create and update relations'),
  (4, 'type:manage', 'Manage CI types'),
  (5, 'audit:read', 'Read audit and change log'),
  (6, 'import:write', 'Run import/reconcile jobs');

INSERT IGNORE INTO rbac_role_permission (role_id, permission_id) VALUES
  (1,1),(1,2),(1,3),(1,4),(1,5),(1,6),
  (2,1),(2,2),(2,3),
  (3,1),
  (4,1);

INSERT IGNORE INTO ci_type (id, type_key, type_name, description) VALUES
  (1, 'application', 'Application', 'Business application/service'),
  (2, 'host', 'Host', 'Compute instance, VM, physical host'),
  (3, 'database', 'Database', 'Database instance'),
  (4, 'middleware', 'Middleware', 'Middleware or runtime component'),
  (5, 'environment', 'Environment', 'Runtime environment such as prod/staging/dev');

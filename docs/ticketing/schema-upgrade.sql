-- 工单系统字段与表结构最小升级（兼容现有 MySQL 结构）
-- 注意：本脚本为一次性迁移脚本，不建议重复执行。

-- 1) tickets 扩展字段（部门化、SLA、客户请求信息、父子工单）
ALTER TABLE tickets ADD COLUMN department_code VARCHAR(32) NULL AFTER project_id;
ALTER TABLE tickets ADD COLUMN service_code VARCHAR(64) NULL AFTER department_code;
ALTER TABLE tickets ADD COLUMN ticket_type VARCHAR(32) NOT NULL DEFAULT 'SERVICE' AFTER service_code;
ALTER TABLE tickets ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'MANUAL' AFTER ticket_type;
ALTER TABLE tickets ADD COLUMN customer_name VARCHAR(255) NULL AFTER source;
ALTER TABLE tickets ADD COLUMN requester_name VARCHAR(64) NULL AFTER customer_name;
ALTER TABLE tickets ADD COLUMN requester_phone VARCHAR(32) NULL AFTER requester_name;
ALTER TABLE tickets ADD COLUMN requester_email VARCHAR(255) NULL AFTER requester_phone;
ALTER TABLE tickets ADD COLUMN severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM' AFTER priority;
ALTER TABLE tickets ADD COLUMN sla_response_minutes INT NOT NULL DEFAULT 30 AFTER severity;
ALTER TABLE tickets ADD COLUMN sla_resolve_minutes INT NOT NULL DEFAULT 480 AFTER sla_response_minutes;
ALTER TABLE tickets ADD COLUMN response_deadline DATETIME NULL AFTER sla_resolve_minutes;
ALTER TABLE tickets ADD COLUMN resolve_deadline DATETIME NULL AFTER response_deadline;
ALTER TABLE tickets ADD COLUMN accepted_at DATETIME NULL AFTER resolve_deadline;
ALTER TABLE tickets ADD COLUMN responded_at DATETIME NULL AFTER accepted_at;
ALTER TABLE tickets ADD COLUMN resolved_at DATETIME NULL AFTER responded_at;
ALTER TABLE tickets ADD COLUMN closed_at DATETIME NULL AFTER resolved_at;
ALTER TABLE tickets ADD COLUMN parent_ticket_id INT NULL AFTER closed_at;
ALTER TABLE tickets ADD COLUMN tags_json TEXT NULL AFTER parent_ticket_id;
ALTER TABLE tickets ADD COLUMN current_stage_id INT NULL AFTER tags_json;
ALTER TABLE tickets ADD COLUMN reopen_count INT NOT NULL DEFAULT 0 AFTER current_stage_id;

CREATE INDEX idx_tickets_dept_status ON tickets (department_code, status);
CREATE INDEX idx_tickets_service_status ON tickets (service_code, status);
CREATE INDEX idx_tickets_resolve_deadline ON tickets (resolve_deadline, status);
CREATE INDEX idx_tickets_project_status ON tickets (project_id, status);
CREATE INDEX idx_tickets_parent ON tickets (parent_ticket_id);

-- 2) 部门与服务目录（用于下拉配置、默认 SLA、默认模板）
CREATE TABLE IF NOT EXISTS departments (
  code VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS service_catalog (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) 工单阶段交付物实例（模板阶段落地后在工单中勾选完成）
CREATE TABLE IF NOT EXISTS ticket_stage_deliverables (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) SLA 轨迹（响应/解决）
CREATE TABLE IF NOT EXISTS ticket_sla_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  sla_type VARCHAR(16) NOT NULL, -- RESPONSE / RESOLVE
  deadline_at DATETIME NOT NULL,
  breached_at DATETIME NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING', -- PENDING / ON_TIME / BREACHED
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sla_deadline (deadline_at, status),
  INDEX idx_sla_ticket (ticket_id, sla_type),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) 工单事件审计（状态、指派、SLA 变化等）
CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  event_type VARCHAR(64) NOT NULL, -- STATUS_CHANGED / ASSIGNEE_CHANGED / SLA_UPDATED ...
  event_desc VARCHAR(255) NOT NULL,
  before_json TEXT,
  after_json TEXT,
  operator_id INT NULL,
  operator_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ticket_events_ticket (ticket_id),
  INDEX idx_ticket_events_type (event_type),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

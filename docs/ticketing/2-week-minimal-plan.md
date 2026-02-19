# 工单系统（按部门）两周最小改造方案

## 1. 可落地模板清单

模板已整理为可直接导入格式，文件如下：

- `/Users/zhanglei/Documents/codex-new/docs/ticketing/template-catalog.json`

导入方式：

```bash
curl -X POST http://localhost:8081/api/templates/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  --data-binary @/Users/zhanglei/Documents/codex-new/docs/ticketing/template-catalog.json
```

覆盖范围：

- 安全服务部：渗透、漏扫、基线、软件测试子项目渗透、软件测试子项目漏扫
- 安全运营部：风险评估、应急响应、WDSP实施、安全运维、临时任务
- 技术部：聚信等保云管、WAF、日志审计、数据库审计、防火墙实施

## 2. 当前系统可直接加的字段与表结构

以下 DDL 基于现有 `tickets / ticket_stages / ticket_templates / schedules` 结构，兼容当前系统，先满足“部门化管理 + SLA + 交付物闭环 + 审计”。

已单独整理为可执行 SQL 文件：

- `/Users/zhanglei/Documents/codex-new/docs/ticketing/schema-upgrade.sql`

```sql
-- 2.1 tickets 扩展字段（业务主线）
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

-- 2.2 部门与服务目录（下拉源 + 默认SLA）
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

-- 2.3 阶段交付物实例（从模板落地到工单）
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

-- 2.4 SLA轨迹
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

-- 2.5 工单事件审计
CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  event_type VARCHAR(64) NOT NULL, -- STATUS_CHANGED/ASSIGNEE_CHANGED/SLA_UPDATED...
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
```

## 3. 两周上线最小改造计划（10个工作日）

### 第 1 周（打通主流程）

1. `D1`：数据库迁移与回滚脚本  
产出：DDL 脚本、回滚脚本、测试库验证记录。

2. `D2`：后端接口扩展  
内容：`/api/tickets` 新增字段收发，列表支持按 `department_code/service_code/severity/SLA状态` 筛选。  
产出：接口文档与 Postman 用例。

3. `D3`：模板导入与“从模板生成交付物”  
内容：基于模板生成 `ticket_stages` 后同步生成 `ticket_stage_deliverables`。  
产出：一键导入模板、工单阶段实例化。

4. `D4`：工单表单升级  
内容：前端新增 `部门、服务目录、客户、请求人、严重级别、SLA` 字段。  
产出：新建/编辑工单页面可保存完整字段。

5. `D5`：SLA 规则初版  
内容：创建工单时计算 `response_deadline/resolve_deadline`，状态变更写 `ticket_sla_logs`。  
产出：超时状态可计算，列表可见“即将超时/已超时”。

### 第 2 周（可运营、可汇报）

1. `D6`：工单详情页增强  
内容：展示阶段进度、交付物勾选、SLA节点时间。  
产出：详情页能看到“阶段完成度 + 交付物完成度”。

2. `D7`：事件审计  
内容：状态变更、指派变更、SLA变更写 `ticket_events`。  
产出：详情页可查看时间线，后台可追责。

3. `D8`：部门看板  
内容：按部门展示 `待处理数、超时数、SLA达成率、本周关闭数`。  
产出：管理层可直接看部门运营数据。

4. `D9`：联调与UAT  
内容：三部门真实模板演练各 3 条工单，验证全流程。  
产出：UAT缺陷清单与修复记录。

5. `D10`：灰度上线  
内容：先开管理员与部门经理，观察 1 天后全员。  
产出：上线记录、回退预案、培训材料。

## 4. 上线验收标准

1. 工单创建必须可选部门与服务目录。  
2. 至少 1 条工单可“一键套模板 -> 自动生成阶段与交付物”。  
3. SLA 超时可自动识别，列表可筛选。  
4. 每条工单至少能追踪到 `创建/指派/状态变更` 事件。  
5. 三个部门都能按模板闭环完成 1 条真实工单。  

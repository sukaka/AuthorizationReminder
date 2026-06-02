CREATE TABLE IF NOT EXISTS analysis_projects (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  repository_url VARCHAR(512) NOT NULL DEFAULT '',
  risk_level VARCHAR(32) NOT NULL DEFAULT 'medium',
  status VARCHAR(32) NOT NULL DEFAULT 'initialized',
  owner VARCHAR(64) NOT NULL DEFAULT 'security',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  scan_note TEXT NOT NULL DEFAULT '',
  owner VARCHAR(64) NOT NULL DEFAULT 'security',
  status VARCHAR(32) NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS components (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_name VARCHAR(160) NOT NULL,
  package_version VARCHAR(80) NOT NULL DEFAULT '',
  normalized_name VARCHAR(200) NOT NULL DEFAULT '',
  package_manager VARCHAR(40) NOT NULL DEFAULT '',
  purl VARCHAR(512) NOT NULL DEFAULT '',
  cpe VARCHAR(512) NOT NULL DEFAULT '',
  group_id VARCHAR(160) NOT NULL DEFAULT '',
  artifact_id VARCHAR(160) NOT NULL DEFAULT '',
  version_normalized VARCHAR(80) NOT NULL DEFAULT '',
  ecosystem VARCHAR(40) NOT NULL DEFAULT 'unknown',
  scope VARCHAR(40) NOT NULL DEFAULT 'runtime',
  dependency_type VARCHAR(40) NOT NULL DEFAULT 'direct',
  source_path VARCHAR(512) NOT NULL DEFAULT '',
  source_file VARCHAR(512) NOT NULL DEFAULT '',
  evidence_level VARCHAR(40) NOT NULL DEFAULT 'manifest',
  evidence_file VARCHAR(512) NOT NULL DEFAULT '',
  evidence_line INTEGER NOT NULL DEFAULT 0,
  evidence_text TEXT NOT NULL DEFAULT '',
  detected_by VARCHAR(80) NOT NULL DEFAULT 'manifest',
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  version_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_reason TEXT NOT NULL DEFAULT '',
  license_name VARCHAR(120) NOT NULL DEFAULT 'unknown',
  vulnerability_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS upload_files (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  upload_id VARCHAR(64) NOT NULL UNIQUE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL DEFAULT '',
  storage_path VARCHAR(1024) NOT NULL DEFAULT '',
  content_type VARCHAR(120) NOT NULL DEFAULT '',
  file_size BIGINT NOT NULL DEFAULT 0,
  received_bytes BIGINT NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'uploading',
  scan_note TEXT NOT NULL DEFAULT '',
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS upload_logs (
  id BIGSERIAL PRIMARY KEY,
  upload_file_id BIGINT NOT NULL REFERENCES upload_files(id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_tasks (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  upload_file_id BIGINT NOT NULL REFERENCES upload_files(id) ON DELETE CASCADE,
  celery_task_id VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS scan_logs (
  id BIGSERIAL PRIMARY KEY,
  scan_task_id BIGINT NOT NULL REFERENCES scan_tasks(id) ON DELETE CASCADE,
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS component_dependencies (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_component_id BIGINT NULL REFERENCES components(id) ON DELETE CASCADE,
  child_component_id BIGINT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  relationship_type VARCHAR(40) NOT NULL DEFAULT 'direct',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vulnerabilities (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_id BIGINT NULL REFERENCES components(id) ON DELETE SET NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'osv',
  advisory_id VARCHAR(160) NOT NULL DEFAULT '',
  cve_id VARCHAR(80) NOT NULL DEFAULT '',
  package_name VARCHAR(160) NOT NULL,
  package_version VARCHAR(80) NOT NULL DEFAULT '',
  ecosystem VARCHAR(40) NOT NULL DEFAULT 'unknown',
  cvss_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  severity VARCHAR(20) NOT NULL DEFAULT 'unknown',
  epss_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  cisa_kev BOOLEAN NOT NULL DEFAULT FALSE,
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  match_status VARCHAR(32) NOT NULL DEFAULT 'affected',
  matched_by VARCHAR(80) NOT NULL DEFAULT '',
  match_reason TEXT NOT NULL DEFAULT '',
  version_range VARCHAR(240) NOT NULL DEFAULT '',
  needs_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  false_positive_possibility VARCHAR(32) NOT NULL DEFAULT 'medium',
  risk_priority VARCHAR(16) NOT NULL DEFAULT 'Review',
  risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  priority_reason TEXT NOT NULL DEFAULT '',
  suggested_deadline VARCHAR(80) NOT NULL DEFAULT '人工确认后排期',
  remediation_type VARCHAR(40) NOT NULL DEFAULT '人工确认',
  business_impact TEXT NOT NULL DEFAULT '',
  reachability_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  reachability_evidence TEXT NOT NULL DEFAULT '',
  entry_points TEXT NOT NULL DEFAULT '',
  related_files TEXT NOT NULL DEFAULT '',
  call_path_summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  fixed_version VARCHAR(160) NOT NULL DEFAULT '',
  published_at_text VARCHAR(80) NOT NULL DEFAULT '',
  has_poc BOOLEAN NOT NULL DEFAULT FALSE,
  exploited_in_wild BOOLEAN NOT NULL DEFAULT FALSE,
  detail_url VARCHAR(512) NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vulnerability_queries (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source VARCHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_exports (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format VARCHAR(12) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(1024) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'generated',
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sbom_documents (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format VARCHAR(24) NOT NULL DEFAULT 'cyclonedx',
  filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(1024) NOT NULL,
  component_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'generated',
  source VARCHAR(40) NOT NULL DEFAULT 'database',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS image_scans (
  id BIGSERIAL PRIMARY KEY,
  image_ref VARCHAR(255) NOT NULL DEFAULT '',
  tar_path VARCHAR(1024) NOT NULL DEFAULT '',
  scanner VARCHAR(40) NOT NULL DEFAULT 'trivy',
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS image_scan_findings (
  id BIGSERIAL PRIMARY KEY,
  image_scan_id BIGINT NOT NULL REFERENCES image_scans(id) ON DELETE CASCADE,
  package_name VARCHAR(160) NOT NULL DEFAULT '',
  package_version VARCHAR(80) NOT NULL DEFAULT '',
  vulnerability_id VARCHAR(80) NOT NULL DEFAULT '',
  severity VARCHAR(20) NOT NULL DEFAULT 'unknown',
  fixed_version VARCHAR(160) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS risk_monitor_runs (
  id BIGSERIAL PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  summary TEXT NOT NULL DEFAULT '',
  checked_projects INTEGER NOT NULL DEFAULT 0,
  updated_components INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS risk_monitor_snapshots (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_id BIGINT NULL REFERENCES components(id) ON DELETE SET NULL,
  component_name VARCHAR(160) NOT NULL,
  current_version VARCHAR(80) NOT NULL DEFAULT '',
  latest_version VARCHAR(80) NOT NULL DEFAULT '',
  latest_source VARCHAR(40) NOT NULL DEFAULT '',
  update_available BOOLEAN NOT NULL DEFAULT FALSE,
  version_delta VARCHAR(20) NOT NULL DEFAULT 'none',
  eol_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  eol_date VARCHAR(40) NOT NULL DEFAULT '',
  vulnerability_count INTEGER NOT NULL DEFAULT 0,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
  recommendation TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_change_records (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_id BIGINT NULL REFERENCES components(id) ON DELETE SET NULL,
  change_type VARCHAR(40) NOT NULL,
  before_value TEXT NOT NULL DEFAULT '',
  after_value TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_alerts (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_id BIGINT NULL REFERENCES components(id) ON DELETE SET NULL,
  level VARCHAR(20) NOT NULL DEFAULT 'medium',
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  notification_channel VARCHAR(40) NOT NULL DEFAULT '',
  email_to VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(120) NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT '',
  updated_by VARCHAR(80) NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_triage_results (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vulnerability_id BIGINT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
  ai_risk_level VARCHAR(20) NOT NULL DEFAULT 'Review',
  noise_reason TEXT NOT NULL DEFAULT '',
  immediate_fix BOOLEAN NOT NULL DEFAULT FALSE,
  suspected_false_positive BOOLEAN NOT NULL DEFAULT FALSE,
  remediation TEXT NOT NULL DEFAULT '',
  fix_deadline VARCHAR(80) NOT NULL DEFAULT '',
  risk_explanation TEXT NOT NULL DEFAULT '',
  priority_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  human_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  exposure_context TEXT NOT NULL DEFAULT '',
  token_prompt INTEGER NOT NULL DEFAULT 0,
  token_completion INTEGER NOT NULL DEFAULT 0,
  token_total INTEGER NOT NULL DEFAULT 0,
  model VARCHAR(80) NOT NULL DEFAULT '',
  ai_schema_version VARCHAR(32) NOT NULL DEFAULT 'ai-triage-v2',
  input_hash VARCHAR(64) NOT NULL DEFAULT '',
  ai_priority VARCHAR(20) NOT NULL DEFAULT 'Review',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_likely_false_positive BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  evidence_summary TEXT NOT NULL DEFAULT '',
  business_impact TEXT NOT NULL DEFAULT '',
  fix_advice TEXT NOT NULL DEFAULT '',
  temporary_mitigation TEXT NOT NULL DEFAULT '',
  need_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
  manual_review_reason TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS remediation_tickets (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vulnerability_id BIGINT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
  ticket_no VARCHAR(64) NOT NULL UNIQUE,
  assignee VARCHAR(80) NOT NULL DEFAULT '',
  priority VARCHAR(20) NOT NULL DEFAULT 'P2',
  status VARCHAR(20) NOT NULL DEFAULT '未处理',
  due_date VARCHAR(32) NOT NULL DEFAULT '',
  fix_version VARCHAR(160) NOT NULL DEFAULT '',
  verification_result VARCHAR(32) NOT NULL DEFAULT '',
  overdue_notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS remediation_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES remediation_tickets(id) ON DELETE CASCADE,
  from_status VARCHAR(20) NOT NULL DEFAULT '',
  to_status VARCHAR(20) NOT NULL DEFAULT '',
  actor VARCHAR(80) NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vulnerability_whitelist (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vulnerability_id BIGINT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  expires_at VARCHAR(32) NOT NULL DEFAULT '',
  created_by VARCHAR(80) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devops_scan_events (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NULL REFERENCES projects(id) ON DELETE SET NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'gitlab',
  pipeline_id VARCHAR(120) NOT NULL DEFAULT '',
  ref VARCHAR(160) NOT NULL DEFAULT '',
  commit_sha VARCHAR(120) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'received',
  decision VARCHAR(32) NOT NULL DEFAULT 'passed',
  block_reason TEXT NOT NULL DEFAULT '',
  report_id BIGINT NULL REFERENCES report_exports(id) ON DELETE SET NULL,
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_jobs (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(40) NOT NULL DEFAULT 'database',
  target VARCHAR(120) NOT NULL DEFAULT 'local',
  status VARCHAR(32) NOT NULL DEFAULT 'planned',
  storage_path VARCHAR(1024) NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_projects_risk_level ON analysis_projects(risk_level);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_upload_files_project_id ON upload_files(project_id);
CREATE INDEX IF NOT EXISTS idx_upload_files_upload_id ON upload_files(upload_id);
CREATE INDEX IF NOT EXISTS idx_scan_tasks_project_id ON scan_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_components_project_id ON components(project_id);
CREATE INDEX IF NOT EXISTS idx_components_ecosystem ON components(ecosystem);
CREATE INDEX IF NOT EXISTS idx_components_normalized_name ON components(normalized_name);
CREATE INDEX IF NOT EXISTS idx_components_purl ON components(purl);
CREATE INDEX IF NOT EXISTS idx_components_vulnerability_status ON components(vulnerability_status);
CREATE INDEX IF NOT EXISTS idx_component_dependencies_project_id ON component_dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_project_id ON vulnerabilities(project_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_component_id ON vulnerabilities(component_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_cve_id ON vulnerabilities(cve_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_match_status ON vulnerabilities(match_status);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_risk_priority ON vulnerabilities(risk_priority);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_reachability_status ON vulnerabilities(reachability_status);
CREATE INDEX IF NOT EXISTS idx_vulnerability_queries_project_id ON vulnerability_queries(project_id);
CREATE INDEX IF NOT EXISTS idx_report_exports_project_id ON report_exports(project_id);
CREATE INDEX IF NOT EXISTS idx_sbom_documents_project_id ON sbom_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_image_scan_findings_scan_id ON image_scan_findings(image_scan_id);
CREATE INDEX IF NOT EXISTS idx_risk_monitor_snapshots_project_id ON risk_monitor_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_risk_monitor_snapshots_component_id ON risk_monitor_snapshots(component_id);
CREATE INDEX IF NOT EXISTS idx_risk_change_records_project_id ON risk_change_records(project_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_project_id ON risk_alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_status ON risk_alerts(status);
CREATE INDEX IF NOT EXISTS idx_ai_triage_results_project_id ON ai_triage_results(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_triage_results_vulnerability_id ON ai_triage_results(vulnerability_id);
CREATE INDEX IF NOT EXISTS idx_ai_triage_results_input_hash ON ai_triage_results(input_hash);
CREATE INDEX IF NOT EXISTS idx_remediation_tickets_project_id ON remediation_tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_remediation_tickets_vulnerability_id ON remediation_tickets(vulnerability_id);
CREATE INDEX IF NOT EXISTS idx_remediation_tickets_status ON remediation_tickets(status);
CREATE INDEX IF NOT EXISTS idx_remediation_events_ticket_id ON remediation_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_vulnerability_whitelist_project_id ON vulnerability_whitelist(project_id);
CREATE INDEX IF NOT EXISTS idx_vulnerability_whitelist_vulnerability_id ON vulnerability_whitelist(vulnerability_id);
CREATE INDEX IF NOT EXISTS idx_devops_scan_events_project_id ON devops_scan_events(project_id);
CREATE INDEX IF NOT EXISTS idx_devops_scan_events_decision ON devops_scan_events(decision);

INSERT INTO analysis_projects (name, repository_url, risk_level, status, owner)
VALUES ('bootstrap-demo', 'https://example.com/juxin/bootstrap-demo.git', 'medium', 'initialized', 'security')
ON CONFLICT (name) DO NOTHING;

INSERT INTO projects (name, scan_note, owner, status)
VALUES ('bootstrap-demo', '初始化示例项目', 'security', 'created')
ON CONFLICT (name) DO NOTHING;

INSERT INTO components (project_id, package_name, package_version, license_name, vulnerability_status, note)
SELECT id, 'fastapi', '0.115.6', 'MIT', 'pending', '第一阶段示例组件'
FROM projects
WHERE name = 'bootstrap-demo'
ON CONFLICT DO NOTHING;

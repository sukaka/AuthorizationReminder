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
  project_id BIGINT NOT NULL REFERENCES analysis_projects(id) ON DELETE CASCADE,
  package_name VARCHAR(160) NOT NULL,
  package_version VARCHAR(80) NOT NULL DEFAULT '',
  ecosystem VARCHAR(40) NOT NULL DEFAULT 'unknown',
  scope VARCHAR(40) NOT NULL DEFAULT 'runtime',
  source_path VARCHAR(512) NOT NULL DEFAULT '',
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

CREATE INDEX IF NOT EXISTS idx_analysis_projects_risk_level ON analysis_projects(risk_level);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_upload_files_project_id ON upload_files(project_id);
CREATE INDEX IF NOT EXISTS idx_upload_files_upload_id ON upload_files(upload_id);
CREATE INDEX IF NOT EXISTS idx_scan_tasks_project_id ON scan_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_components_project_id ON components(project_id);
CREATE INDEX IF NOT EXISTS idx_components_ecosystem ON components(ecosystem);
CREATE INDEX IF NOT EXISTS idx_components_vulnerability_status ON components(vulnerability_status);
CREATE INDEX IF NOT EXISTS idx_component_dependencies_project_id ON component_dependencies(project_id);

INSERT INTO analysis_projects (name, repository_url, risk_level, status, owner)
VALUES ('bootstrap-demo', 'https://example.com/juxin/bootstrap-demo.git', 'medium', 'initialized', 'security')
ON CONFLICT (name) DO NOTHING;

INSERT INTO components (project_id, package_name, package_version, license_name, vulnerability_status, note)
SELECT id, 'fastapi', '0.115.6', 'MIT', 'pending', '第一阶段示例组件'
FROM analysis_projects
WHERE name = 'bootstrap-demo'
ON CONFLICT DO NOTHING;

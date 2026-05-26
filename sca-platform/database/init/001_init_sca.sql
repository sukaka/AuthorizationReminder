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

CREATE TABLE IF NOT EXISTS components (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES analysis_projects(id) ON DELETE CASCADE,
  package_name VARCHAR(160) NOT NULL,
  package_version VARCHAR(80) NOT NULL DEFAULT '',
  license_name VARCHAR(120) NOT NULL DEFAULT 'unknown',
  vulnerability_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_analysis_projects_risk_level ON analysis_projects(risk_level);
CREATE INDEX IF NOT EXISTS idx_components_project_id ON components(project_id);
CREATE INDEX IF NOT EXISTS idx_components_vulnerability_status ON components(vulnerability_status);

INSERT INTO analysis_projects (name, repository_url, risk_level, status, owner)
VALUES ('bootstrap-demo', 'https://example.com/juxin/bootstrap-demo.git', 'medium', 'initialized', 'security')
ON CONFLICT (name) DO NOTHING;

INSERT INTO components (project_id, package_name, package_version, license_name, vulnerability_status, note)
SELECT id, 'fastapi', '0.115.6', 'MIT', 'pending', '第一阶段示例组件'
FROM analysis_projects
WHERE name = 'bootstrap-demo'
ON CONFLICT DO NOTHING;

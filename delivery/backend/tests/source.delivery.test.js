const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'migrate-legacy.js'), 'utf8');

test('delivery backend binds to delivery system key and excludes sysadmin from write roles', () => {
  assert.match(indexSource, /AUTH_SYSTEM_KEY = String\(process\.env\.AUTH_SYSTEM_KEY \|\| 'delivery'\)/);
  assert.match(indexSource, /const BASE_WRITER_ROLES = new Set\(\['admin', 'editor', 'reviewer', 'user', 'sales'\]\)/);
  assert.match(indexSource, /const AUDIT_READER_ROLES = new Set\(\['admin', 'auditor'\]\)/);
  assert.doesNotMatch(indexSource, /BASE_WRITER_ROLES = new Set\(\[[^\]]*'sysadmin'/);
});

test('delivery schema defines unified order, project, workflow, comment and schedule tables', () => {
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS delivery_orders \(/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS delivery_projects \(/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS delivery_project_members \(/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS delivery_workflow_events \(/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS delivery_comments \(/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS delivery_schedules \(/);
});

test('delivery backend exposes unified project, comment and schedule endpoints', () => {
  assert.match(indexSource, /'\/api\/delivery\/projects'/);
  assert.match(indexSource, /'\/api\/delivery\/projects\/:id\/members'/);
  assert.match(indexSource, /'\/api\/delivery\/orders\/:id\/comments'/);
  assert.match(indexSource, /'\/api\/delivery\/orders\/:id\/schedules'/);
  assert.match(indexSource, /'\/api\/delivery\/orders\/:id\/deliverables'/);
  assert.match(indexSource, /'\/api\/delivery\/orders\/:id\/deliverables\/:deliverableId'/);
});

test('delivery backend ships a legacy migration entrypoint', () => {
  const migrationPath = path.join(__dirname, '..', 'src', 'migrate-legacy.js');
  assert.equal(fs.existsSync(migrationPath), true);
});

test('delivery legacy migration covers members, comments, schedules, attachments, phase runs and audit rows', () => {
  assert.match(migrationSource, /delivery_project_members/);
  assert.match(migrationSource, /delivery_comments/);
  assert.match(migrationSource, /delivery_schedules/);
  assert.match(migrationSource, /delivery_evidence_attachments/);
  assert.match(migrationSource, /delivery_phase_runs/);
  assert.match(migrationSource, /delivery_audit_logs/);
  assert.match(migrationSource, /delivery_sla_rules/);
});

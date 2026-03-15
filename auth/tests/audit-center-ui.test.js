const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const auditDisplaySource = fs.readFileSync(path.join(__dirname, '..', 'audit-log-display.js'), 'utf8');

test('audit center uses chinese selects and audit quick presets', () => {
  assert.match(source, /<select id="auditFilterAction" class="form-select">/);
  assert.match(source, /renderSelectOptions\(AUDIT_ACTION_OPTIONS, '全部动作'\)/);
  assert.match(source, /<select id="auditFilterEntity" class="form-select">/);
  assert.match(source, /renderSelectOptions\(AUDIT_ENTITY_OPTIONS, '全部对象'\)/);
  assert.match(auditDisplaySource, /buttonId: 'auditPresetAllBtn'/);
  assert.match(source, /登录与会话/);
  assert.match(source, /用户与权限/);
  assert.match(source, /配置变更/);
});

test('audit center renders command workbench layout', () => {
  assert.match(source, /audit-command-grid/);
  assert.match(source, /audit-command-card/);
  assert.match(source, /audit-focus-card/);
  assert.match(source, /audit-stream-panel/);
  assert.match(source, /audit-stream-table/);
  assert.match(source, /auditResultsSummary/);
  assert.match(source, /auditPrevPageBtn/);
  assert.match(source, /auditNextPageBtn/);
  assert.match(source, /auditPaginationSummary/);
  assert.match(source, /page_size/);
});

test('audit center places pagination controls before the audit table for visibility', () => {
  const paginationIndex = source.indexOf('id="auditPaginationSummary"');
  const tableIndex = source.indexOf('class="data-table audit-data-table audit-stream-table"');

  assert.notEqual(paginationIndex, -1);
  assert.notEqual(tableIndex, -1);
  assert.ok(paginationIndex < tableIndex, 'expected pagination controls to render before the audit table');
});

test('audit log table renders localized action and entity labels', () => {
  assert.match(source, /getAuditActionLabel\(row\.action \|\| '-'\)/);
  assert.match(source, /getAuditEntityLabel\(row\.entity \|\| '-'\)/);
  assert.match(source, /getAuditRequestIpLabel\(row\)/);
  assert.match(source, /<th>事件<\/th>/);
  assert.match(source, /<th>主体<\/th>\s*<th>IP地址<\/th>\s*<th>对象<\/th>/);
  assert.match(source, /audit-subject-cell[\s\S]*requestIpLabel[\s\S]*audit-object-chip/);
});

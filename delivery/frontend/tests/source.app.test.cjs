const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

test('delivery frontend only exposes audit menus to auditors', () => {
  assert.match(source, /const isAuditOnlyUser = normalizeRole\(user\?\.role\) === 'auditor'/);
  assert.match(source, /const canReadAuditLogs = isAuditOnlyUser/);
  assert.doesNotMatch(source, /const canReadAuditLogs = isAuditOnlyUser \|\| normalizeRole\(user\?\.role\) === 'admin'/);
});

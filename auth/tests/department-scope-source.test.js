const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('auth introspect exposes department scope and managed departments', () => {
  assert.match(source, /scope\.department/);
  assert.match(source, /scope\.managedDepartments/);
  assert.match(source, /\/api\/admin-center\/departments/);
});

test('admin center page exposes department management controls', () => {
  assert.match(source, /主归属部门/);
  assert.match(source, /部门文档管理员/);
  assert.match(source, /department_code/);
});

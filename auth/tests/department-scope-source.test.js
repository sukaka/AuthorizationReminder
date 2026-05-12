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

test('auth me route catches department scope failures instead of leaving requests pending', () => {
  const routeStart = source.indexOf("app.get('/api/auth/me'");
  const routeEnd = source.indexOf("app.post('/api/auth/logout'", routeStart);

  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);
  const routeSource = source.slice(routeStart, routeEnd);
  assert.match(routeSource, /try \{/);
  assert.match(routeSource, /sendApiError\(res, err, '获取登录状态失败'\)/);
});

test('admin center page exposes department management controls', () => {
  assert.match(source, /主归属部门/);
  assert.match(source, /部门文档管理员/);
  assert.match(source, /department_code/);
});

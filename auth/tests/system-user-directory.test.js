const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemUserDirectory } = require('../system-user-directory');

test('buildSystemUserDirectory returns every active user for device-flow signer selection', () => {
  const rows = [
    { id: 1, username: 'admin', role: 'admin', is_active: 1, app_access: '["device-flow"]', department_code: 'OPS' },
    { id: 2, username: 'tester', role: 'user', is_active: 1, app_access: '["device-flow"]', department_code: 'QA' },
    { id: 3, username: 'disabled', role: 'admin', is_active: 0, app_access: '["device-flow"]', department_code: 'OPS' },
    { id: 4, username: 'other', role: 'user', is_active: 1, app_access: '["faq"]', department_code: 'OPS' },
  ];

  const result = buildSystemUserDirectory(rows, 'device-flow');

  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.username), ['admin', 'tester', 'other']);
});

test('buildSystemUserDirectory keeps app access filtering for other systems', () => {
  const rows = [
    { id: 1, username: 'faq-user', role: 'user', is_active: 1, app_access: '["faq"]', department_code: 'OPS' },
    { id: 2, username: 'other-user', role: 'user', is_active: 1, app_access: '["delivery"]', department_code: 'QA' },
  ];

  assert.deepEqual(buildSystemUserDirectory(rows, 'faq').map((item) => item.username), ['faq-user']);
});

test('buildSystemUserDirectory keeps sysadmin candidates for device-flow authorization checks', () => {
  const rows = [
    { id: 5, username: 'sysadmin', role: 'sysadmin', is_active: 1, app_access: '["admin-center"]', department_code: 'TECH' },
  ];

  assert.deepEqual(buildSystemUserDirectory(rows, 'device-flow'), [
    { id: 5, username: 'sysadmin', role: 'sysadmin', department_code: 'TECH', app_access: ['admin-center'] },
  ]);
});

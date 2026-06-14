const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const {
  buildCleanupStatements,
  buildTestUsers,
  buildUpsertStatement,
} = require('./rbac-test-users');

test('builds isolated users with the expected roles and application access', () => {
  const users = buildTestUsers('run-123');

  assert.deepEqual(
    users.map((item) => item.role),
    ['admin', 'auditor', 'sysadmin']
  );
  assert.deepEqual(users[0].appAccess, ['device-flow']);
  assert.deepEqual(users[1].appAccess, ['audit-center', 'delivery']);
  assert.deepEqual(users[2].appAccess, ['admin-center']);
  assert.ok(users.every((item) => item.username.startsWith('device_flow_rbac_')));
  assert.ok(users.every((item) => /^990\d{17}$/.test(item.phone)));
  assert.equal(new Set(users.map((item) => item.phone)).size, users.length);
});

test('upsert resets password, MFA and forced-password state', () => {
  const user = buildTestUsers('run-123')[0];
  const statement = buildUpsertStatement(user, 'bcrypt-hash');

  assert.match(statement.sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(statement.sql, /must_change_password = 0/);
  assert.match(statement.sql, /mfa_enabled = 0/);
  assert.match(statement.sql, /totp_enabled = 0/);
  assert.match(statement.sql, /phone = VALUES\(phone\)/);
  assert.equal(statement.params[0], user.username);
  assert.equal(statement.params[1], 'bcrypt-hash');
  assert.equal(statement.params[2], user.role);
  assert.equal(statement.params[3], JSON.stringify(user.appAccess));
  assert.equal(statement.params[4], user.phone);
});

test('cleanup removes sessions and users for only the dedicated usernames', () => {
  const users = buildTestUsers('run-123');
  const statements = buildCleanupStatements(users);

  assert.ok(statements.some((item) => item.sql.includes('DELETE FROM auth_user_sessions')));
  assert.ok(statements.some((item) => item.sql.includes('DELETE FROM auth_login_attempts')));
  assert.ok(statements.some((item) => item.sql.includes('DELETE FROM users')));
  const loginCleanup = statements.find((item) => item.sql.includes('DELETE FROM auth_login_attempts'));
  assert.ok(users.every((item) => loginCleanup.params.includes(item.phone)));
});

test('runs the CLI when the helper is executed through node stdin', () => {
  const result = spawnSync(process.execPath, ['-'], {
    encoding: 'utf8',
    input: fs.readFileSync(require.resolve('./rbac-test-users'), 'utf8'),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: node rbac-test-users\.js/);
});

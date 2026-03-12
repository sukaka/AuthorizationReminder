const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBootstrapStatements,
} = require('../../server/db-bootstrap');

test('buildBootstrapStatements emits database and user bootstrap SQL', () => {
  const statements = buildBootstrapStatements({
    database: 'juxin_reminder',
    user: 'auth_user',
    password: 'auth-password',
  });

  assert.equal(Array.isArray(statements), true);
  assert.equal(statements.length, 5);
  assert.equal(
    statements[0].sql,
    'CREATE DATABASE IF NOT EXISTS `juxin_reminder` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  assert.equal(
    statements[1].sql,
    "CREATE USER IF NOT EXISTS 'auth_user'@'%' IDENTIFIED BY ?"
  );
  assert.deepEqual(statements[1].params, ['auth-password']);
  assert.equal(
    statements[2].sql,
    "ALTER USER 'auth_user'@'%' IDENTIFIED BY ?"
  );
  assert.deepEqual(statements[2].params, ['auth-password']);
  assert.equal(
    statements[3].sql,
    "GRANT ALL PRIVILEGES ON `juxin_reminder`.* TO 'auth_user'@'%'"
  );
  assert.equal(statements[4].sql, 'FLUSH PRIVILEGES');
});

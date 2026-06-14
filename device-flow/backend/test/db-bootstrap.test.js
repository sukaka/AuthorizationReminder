const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBootstrapStatements } = require('../src/db-bootstrap');

test('creates the schema user before granting schema privileges', () => {
  const statements = buildBootstrapStatements({
    database: 'juxin_device_flow',
    user: 'device_flow_user',
    password: 'strong-test-password',
  });

  assert.match(statements[0].sql, /^CREATE DATABASE IF NOT EXISTS/);
  assert.equal(
    statements[1].sql,
    "CREATE USER IF NOT EXISTS 'device_flow_user'@'%' IDENTIFIED BY ?"
  );
  assert.deepEqual(statements[1].params, ['strong-test-password']);
  assert.equal(
    statements[2].sql,
    "ALTER USER 'device_flow_user'@'%' IDENTIFIED BY ?"
  );
  assert.match(statements[3].sql, /^GRANT ALL PRIVILEGES ON `juxin_device_flow`\.\*/);
});

test('rejects unsafe schema identifiers', () => {
  assert.throws(
    () =>
      buildBootstrapStatements({
        database: 'juxin_device_flow; DROP DATABASE mysql',
        user: 'device_flow_user',
        password: 'strong-test-password',
      }),
    /MYSQL_DATABASE contains unsafe characters/
  );
});

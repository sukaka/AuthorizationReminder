const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBootstrapStatements } = require('../src/db-bootstrap');

test('creates the inventory schema user before granting schema privileges', () => {
  const statements = buildBootstrapStatements({
    database: 'juxin_inventory',
    user: 'inventory_user',
    password: 'strong-test-password',
  });

  assert.match(statements[0].sql, /^CREATE DATABASE IF NOT EXISTS/);
  assert.equal(
    statements[1].sql,
    "CREATE USER IF NOT EXISTS 'inventory_user'@'%' IDENTIFIED BY ?"
  );
  assert.deepEqual(statements[1].params, ['strong-test-password']);
  assert.equal(
    statements[2].sql,
    "ALTER USER 'inventory_user'@'%' IDENTIFIED BY ?"
  );
  assert.match(statements[3].sql, /^GRANT ALL PRIVILEGES ON `juxin_inventory`\.\*/);
});

test('rejects unsafe inventory schema identifiers', () => {
  assert.throws(
    () =>
      buildBootstrapStatements({
        database: 'juxin_inventory; DROP DATABASE mysql',
        user: 'inventory_user',
        password: 'strong-test-password',
      }),
    /MYSQL_DATABASE contains unsafe characters/
  );
});

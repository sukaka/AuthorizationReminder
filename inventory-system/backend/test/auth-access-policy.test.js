const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canAccessInventory,
  canAuditorAccessInventoryPath,
} = require('../src/auth-access-policy');

test('allows explicit Inventory application access', () => {
  assert.equal(canAccessInventory({ role: 'admin', apps: ['inventory'] }), true);
});

test('allows audit-center auditors to reach Inventory audit endpoints', () => {
  assert.equal(
    canAccessInventory({ role: 'auditor', apps: ['audit-center', 'delivery'] }),
    true
  );
});

test('does not grant Inventory access to unrelated dedicated roles', () => {
  assert.equal(canAccessInventory({ role: 'sysadmin', apps: ['admin-center'] }), false);
  assert.equal(canAccessInventory({ role: 'auditor', apps: ['delivery'] }), false);
});

test('limits auditors to read-only audit endpoints', () => {
  assert.equal(
    canAuditorAccessInventoryPath({
      role: 'auditor',
      method: 'GET',
      path: '/api/operation-logs',
    }),
    true
  );
  assert.equal(
    canAuditorAccessInventoryPath({
      role: 'auditor',
      method: 'GET',
      path: '/api/operation-logs/export.csv',
    }),
    true
  );
  assert.equal(
    canAuditorAccessInventoryPath({
      role: 'auditor',
      method: 'GET',
      path: '/api/products',
    }),
    false
  );
  assert.equal(
    canAuditorAccessInventoryPath({
      role: 'auditor',
      method: 'POST',
      path: '/api/operation-logs',
    }),
    false
  );
  assert.equal(
    canAuditorAccessInventoryPath({
      role: 'admin',
      method: 'GET',
      path: '/api/products',
    }),
    true
  );
});

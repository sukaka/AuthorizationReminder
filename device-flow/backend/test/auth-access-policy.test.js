const test = require('node:test');
const assert = require('node:assert/strict');

const { canAccessDeviceFlow } = require('../src/auth-access-policy');

test('allows explicit Device Flow application access', () => {
  assert.equal(canAccessDeviceFlow({ role: 'admin', apps: ['device-flow'] }), true);
});

test('allows audit-center auditors to reach the read-only audit allowlist', () => {
  assert.equal(canAccessDeviceFlow({ role: 'auditor', apps: ['audit-center', 'delivery'] }), true);
});

test('does not grant Device Flow access to unrelated dedicated roles', () => {
  assert.equal(canAccessDeviceFlow({ role: 'sysadmin', apps: ['admin-center'] }), false);
  assert.equal(canAccessDeviceFlow({ role: 'auditor', apps: ['delivery'] }), false);
  assert.equal(
    canAccessDeviceFlow({
      role: 'auditor',
      apps: ['audit-center'],
      systemKey: 'another-system',
    }),
    false
  );
});

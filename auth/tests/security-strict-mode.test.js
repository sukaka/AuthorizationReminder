const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveSecurityStrictMode,
} = require('../../server/security-strict-mode');

test('explicit false disables strict mode even in production', () => {
  assert.equal(resolveSecurityStrictMode({
    NODE_ENV: 'production',
    SECURITY_STRICT_MODE: 'false',
  }), false);
});

test('explicit true enables strict mode outside production', () => {
  assert.equal(resolveSecurityStrictMode({
    NODE_ENV: 'development',
    SECURITY_STRICT_MODE: 'true',
  }), true);
});

test('defaults to production strict mode when unset', () => {
  assert.equal(resolveSecurityStrictMode({
    NODE_ENV: 'production',
  }), true);
});

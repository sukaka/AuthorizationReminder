const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEGACY_BUILTIN_PASSWORDS,
  isWeakSecret,
  shouldRotateBuiltinPasswordHash,
} = require('../security-bootstrap');

test('isWeakSecret flags known weak values and short secrets', () => {
  assert.equal(isWeakSecret('123456', 32), true);
  assert.equal(isWeakSecret('dev-secret-change-me', 32), true);
  assert.equal(isWeakSecret('short-secret', 32), true);
  assert.equal(isWeakSecret('4f5f4f1db2d04f3b8d0f2d69841fd740', 32), false);
});

test('shouldRotateBuiltinPasswordHash rotates accounts still using legacy defaults', async () => {
  const compare = async (plain, hash) => hash === `hash:${plain}`;
  const strongConfiguredPassword = '4f5f4f1db2d04f3b8d0f2d69841fd740';

  await assert.doesNotReject(async () => {
    const shouldRotate = await shouldRotateBuiltinPasswordHash({
      passwordHash: 'hash:123456',
      comparePassword: compare,
      configuredPassword: strongConfiguredPassword,
    });
    assert.equal(shouldRotate, true);
  });

  await assert.doesNotReject(async () => {
    const shouldRotate = await shouldRotateBuiltinPasswordHash({
      passwordHash: `hash:${LEGACY_BUILTIN_PASSWORDS[1]}`,
      comparePassword: compare,
      configuredPassword: strongConfiguredPassword,
    });
    assert.equal(shouldRotate, true);
  });
});

test('shouldRotateBuiltinPasswordHash leaves non-legacy passwords unchanged', async () => {
  const compare = async (plain, hash) => hash === `hash:${plain}`;
  const shouldRotate = await shouldRotateBuiltinPasswordHash({
    passwordHash: 'hash:custom-strong-password',
    comparePassword: compare,
    configuredPassword: '4f5f4f1db2d04f3b8d0f2d69841fd740',
  });
  assert.equal(shouldRotate, false);
});


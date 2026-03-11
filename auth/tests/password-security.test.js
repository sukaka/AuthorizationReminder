const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const {
  hashPassword,
  verifyPassword,
  isModernPasswordHash,
} = require('../password-security');

test('modern password hashes distinguish long passwords that only differ after 72 bytes', async () => {
  const base = 'A'.repeat(72);
  const passwordA = `${base}first!`;
  const passwordB = `${base}second!`;

  const hash = await hashPassword(passwordA);

  assert.equal(isModernPasswordHash(hash), true);
  assert.equal((await verifyPassword(passwordA, hash)).ok, true);
  assert.equal((await verifyPassword(passwordB, hash)).ok, false);
});

test('legacy bcrypt hashes require reset when presented password exceeds 72 bytes', async () => {
  const legacyPassword = `${'B'.repeat(72)}legacy!`;
  const legacyHash = bcrypt.hashSync(legacyPassword, 10);

  const result = await verifyPassword(legacyPassword, legacyHash);

  assert.equal(result.ok, false);
  assert.equal(result.requiresPasswordReset, true);
});

test('legacy bcrypt hashes still verify safe-length passwords and request rehash', async () => {
  const password = 'SafeLength#2026';
  const legacyHash = bcrypt.hashSync(password, 10);

  const result = await verifyPassword(password, legacyHash);

  assert.equal(result.ok, true);
  assert.equal(result.needsRehash, true);
  assert.equal(result.requiresPasswordReset, false);
});

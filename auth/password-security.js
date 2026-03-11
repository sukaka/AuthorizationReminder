const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const MODERN_PASSWORD_HASH_PREFIX = 'v2$sha256_bcrypt$';
const LEGACY_BCRYPT_MAX_BYTES = 72;

const normalizePassword = (value) => String(value ?? '');
const getPasswordByteLength = (value) => Buffer.byteLength(normalizePassword(value), 'utf8');

const buildPasswordDigest = (value) =>
  crypto.createHash('sha256').update(Buffer.from(normalizePassword(value), 'utf8')).digest('base64');

const isModernPasswordHash = (value) => String(value || '').startsWith(MODERN_PASSWORD_HASH_PREFIX);

const hashPassword = async (value, saltRounds = 10) => {
  const digest = buildPasswordDigest(value);
  return `${MODERN_PASSWORD_HASH_PREFIX}${bcrypt.hashSync(digest, saltRounds)}`;
};

const verifyPassword = async (value, storedHash) => {
  const password = normalizePassword(value);
  const hash = String(storedHash || '').trim();
  if (!hash) {
    return { ok: false, needsRehash: false, requiresPasswordReset: false };
  }
  if (isModernPasswordHash(hash)) {
    const digest = buildPasswordDigest(password);
    const ok = bcrypt.compareSync(digest, hash.slice(MODERN_PASSWORD_HASH_PREFIX.length));
    return { ok, needsRehash: false, requiresPasswordReset: false };
  }
  if (getPasswordByteLength(password) > LEGACY_BCRYPT_MAX_BYTES) {
    return {
      ok: false,
      needsRehash: false,
      requiresPasswordReset: true,
      reason: 'PASSWORD_RESET_REQUIRED_LEGACY_LENGTH',
    };
  }
  const ok = bcrypt.compareSync(password, hash);
  return { ok, needsRehash: ok, requiresPasswordReset: false };
};

module.exports = {
  LEGACY_BCRYPT_MAX_BYTES,
  MODERN_PASSWORD_HASH_PREFIX,
  getPasswordByteLength,
  hashPassword,
  isModernPasswordHash,
  verifyPassword,
};

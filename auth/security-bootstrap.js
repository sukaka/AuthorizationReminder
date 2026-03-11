const LEGACY_BUILTIN_PASSWORDS = Object.freeze([
  '123456',
  'Dm1vbnqsILIVjUa5sWixBFos60bKdEKC',
]);

const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);

const isWeakSecret = (value, minLength = 16) => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length < minLength) return true;
  return weakSecrets.has(text.toLowerCase());
};

const shouldRotateBuiltinPasswordHash = async ({
  passwordHash,
  comparePassword,
  configuredPassword,
  legacyPasswords = LEGACY_BUILTIN_PASSWORDS,
}) => {
  const hash = String(passwordHash || '').trim();
  if (!hash) return false;
  if (isWeakSecret(configuredPassword, 32)) return false;
  const compare = typeof comparePassword === 'function' ? comparePassword : async () => false;
  for (const plain of legacyPasswords) {
    if (!plain) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await compare(String(plain), hash)) return true;
  }
  return false;
};

module.exports = {
  LEGACY_BUILTIN_PASSWORDS,
  isWeakSecret,
  shouldRotateBuiltinPasswordHash,
};


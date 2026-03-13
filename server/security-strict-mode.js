const parseBooleanEnv = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return null;
};

const resolveSecurityStrictMode = (env = process.env) => {
  const explicit = parseBooleanEnv(env.SECURITY_STRICT_MODE);
  if (explicit !== null) return explicit;
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
};

module.exports = {
  parseBooleanEnv,
  resolveSecurityStrictMode,
};

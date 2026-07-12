const STRICT_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const assertStrictSemVer = (value, label = '版本号') => {
  const normalized = String(value ?? '');
  if (!STRICT_SEMVER_RE.test(normalized)) {
    throw new Error(`${label} 必须是严格三段 SemVer：${value}`);
  }
  return normalized;
};

module.exports = {
  STRICT_SEMVER_RE,
  assertStrictSemVer,
};

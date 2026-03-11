const { readOssConfigFromEnv } = require('./oss-utils');

const SECRET_MASK = '******';

const OSS_SYSTEM_SETTING_KEYS = Object.freeze({
  enabled: 'oss_enabled',
  region: 'oss_region',
  bucket: 'oss_bucket',
  endpoint: 'oss_endpoint',
  accessKeyId: 'oss_access_key_id',
  accessKeySecret: 'oss_access_key_secret',
  stsToken: 'oss_sts_token',
  uploadExpiresSeconds: 'oss_signed_upload_expires_seconds',
  playbackExpiresSeconds: 'oss_signed_play_expires_seconds',
  uploadMaxFileSizeMb: 'oss_upload_max_file_size_mb',
});

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const parseOptionalPositiveInt = (value) => {
  const text = trimText(value);
  if (!text) return undefined;
  const num = Number(text);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.floor(num);
};

const parseOptionalBoolean = (value) => {
  if (value === undefined || value === null) return undefined;
  const text = trimText(value).toLowerCase();
  if (!text) return undefined;
  if (['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'disabled'].includes(text)) return false;
  return undefined;
};

const readStoredManagedOssSettings = (settings = {}) => ({
  enabled: parseOptionalBoolean(settings[OSS_SYSTEM_SETTING_KEYS.enabled]),
  region: settings[OSS_SYSTEM_SETTING_KEYS.region] === undefined ? undefined : trimText(settings[OSS_SYSTEM_SETTING_KEYS.region]),
  bucket: settings[OSS_SYSTEM_SETTING_KEYS.bucket] === undefined ? undefined : trimText(settings[OSS_SYSTEM_SETTING_KEYS.bucket]),
  endpoint: settings[OSS_SYSTEM_SETTING_KEYS.endpoint] === undefined ? undefined : trimText(settings[OSS_SYSTEM_SETTING_KEYS.endpoint]),
  accessKeyId: settings[OSS_SYSTEM_SETTING_KEYS.accessKeyId] === undefined ? undefined : trimText(settings[OSS_SYSTEM_SETTING_KEYS.accessKeyId]),
  accessKeySecret: settings[OSS_SYSTEM_SETTING_KEYS.accessKeySecret] === undefined ? undefined : trimText(settings[OSS_SYSTEM_SETTING_KEYS.accessKeySecret]),
  stsToken: settings[OSS_SYSTEM_SETTING_KEYS.stsToken] === undefined ? undefined : trimText(settings[OSS_SYSTEM_SETTING_KEYS.stsToken]),
  uploadExpiresSeconds: parseOptionalPositiveInt(settings[OSS_SYSTEM_SETTING_KEYS.uploadExpiresSeconds]),
  playbackExpiresSeconds: parseOptionalPositiveInt(settings[OSS_SYSTEM_SETTING_KEYS.playbackExpiresSeconds]),
  uploadMaxFileSizeMb: parseOptionalPositiveInt(settings[OSS_SYSTEM_SETTING_KEYS.uploadMaxFileSizeMb]),
});

const pickString = (preferred, fallback = '') => {
  if (preferred !== undefined && preferred !== null && trimText(preferred) !== '') return trimText(preferred);
  return trimText(fallback);
};

const resolveManagedOssConfig = ({ envConfig, settings } = {}) => {
  const base = envConfig || readOssConfigFromEnv();
  const stored = readStoredManagedOssSettings(settings);
  const uploadMaxFileSizeMb = parsePositiveInt(
    stored.uploadMaxFileSizeMb !== undefined ? stored.uploadMaxFileSizeMb : base.uploadMaxFileSizeMb,
    2048
  );
  return {
    enabled: stored.enabled !== undefined ? stored.enabled : !!base.enabled,
    region: pickString(stored.region, base.region),
    bucket: pickString(stored.bucket, base.bucket),
    endpoint: pickString(stored.endpoint, base.endpoint),
    accessKeyId: pickString(stored.accessKeyId, base.accessKeyId),
    accessKeySecret: pickString(stored.accessKeySecret, base.accessKeySecret),
    stsToken: pickString(stored.stsToken, base.stsToken),
    uploadExpiresSeconds: parsePositiveInt(
      stored.uploadExpiresSeconds !== undefined ? stored.uploadExpiresSeconds : base.uploadExpiresSeconds,
      600
    ),
    playbackExpiresSeconds: parsePositiveInt(
      stored.playbackExpiresSeconds !== undefined ? stored.playbackExpiresSeconds : base.playbackExpiresSeconds,
      300
    ),
    uploadMaxFileSizeMb,
    uploadMaxBytes: uploadMaxFileSizeMb * 1024 * 1024,
  };
};

const buildManagedOssAdminPayload = (config = {}) => ({
  enabled: !!config.enabled,
  region: trimText(config.region),
  bucket: trimText(config.bucket),
  endpoint: trimText(config.endpoint),
  access_key_id: trimText(config.accessKeyId),
  access_key_secret: trimText(config.accessKeySecret) ? SECRET_MASK : '',
  has_access_key_secret: trimText(config.accessKeySecret).length > 0,
  sts_token: trimText(config.stsToken) ? SECRET_MASK : '',
  has_sts_token: trimText(config.stsToken).length > 0,
  signed_upload_expires_seconds: parsePositiveInt(config.uploadExpiresSeconds, 600),
  signed_play_expires_seconds: parsePositiveInt(config.playbackExpiresSeconds, 300),
  upload_max_file_size_mb: parsePositiveInt(config.uploadMaxFileSizeMb, 2048),
});

const normalizeManagedOssSettingsInput = ({ payload = {}, currentSettings = {} } = {}) => {
  const currentStored = readStoredManagedOssSettings(currentSettings);
  const accessKeySecretText = trimText(payload.access_key_secret);
  const stsTokenText = trimText(payload.sts_token);
  return {
    enabled: !!payload.enabled,
    region: trimText(payload.region),
    bucket: trimText(payload.bucket),
    endpoint: trimText(payload.endpoint),
    accessKeyId: trimText(payload.access_key_id),
    accessKeySecret: accessKeySecretText === SECRET_MASK
      ? trimText(currentStored.accessKeySecret)
      : accessKeySecretText,
    stsToken: stsTokenText === SECRET_MASK
      ? trimText(currentStored.stsToken)
      : stsTokenText,
    uploadExpiresSeconds: parsePositiveInt(payload.signed_upload_expires_seconds, 600),
    playbackExpiresSeconds: parsePositiveInt(payload.signed_play_expires_seconds, 300),
    uploadMaxFileSizeMb: parsePositiveInt(payload.upload_max_file_size_mb, 2048),
  };
};

const serializeManagedOssSettings = (config = {}) => ({
  [OSS_SYSTEM_SETTING_KEYS.enabled]: config.enabled ? 'true' : 'false',
  [OSS_SYSTEM_SETTING_KEYS.region]: trimText(config.region),
  [OSS_SYSTEM_SETTING_KEYS.bucket]: trimText(config.bucket),
  [OSS_SYSTEM_SETTING_KEYS.endpoint]: trimText(config.endpoint),
  [OSS_SYSTEM_SETTING_KEYS.accessKeyId]: trimText(config.accessKeyId),
  [OSS_SYSTEM_SETTING_KEYS.accessKeySecret]: trimText(config.accessKeySecret),
  [OSS_SYSTEM_SETTING_KEYS.stsToken]: trimText(config.stsToken),
  [OSS_SYSTEM_SETTING_KEYS.uploadExpiresSeconds]: String(parsePositiveInt(config.uploadExpiresSeconds, 600)),
  [OSS_SYSTEM_SETTING_KEYS.playbackExpiresSeconds]: String(parsePositiveInt(config.playbackExpiresSeconds, 300)),
  [OSS_SYSTEM_SETTING_KEYS.uploadMaxFileSizeMb]: String(parsePositiveInt(config.uploadMaxFileSizeMb, 2048)),
});

const summarizeManagedOssConfig = (config = {}) => ({
  enabled: !!config.enabled,
  region: trimText(config.region),
  bucket: trimText(config.bucket),
  endpoint: trimText(config.endpoint),
  access_key_id: trimText(config.accessKeyId),
  access_key_secret: trimText(config.accessKeySecret) ? SECRET_MASK : '',
  sts_token: trimText(config.stsToken) ? SECRET_MASK : '',
  signed_upload_expires_seconds: parsePositiveInt(config.uploadExpiresSeconds, 600),
  signed_play_expires_seconds: parsePositiveInt(config.playbackExpiresSeconds, 300),
  upload_max_file_size_mb: parsePositiveInt(config.uploadMaxFileSizeMb, 2048),
});

module.exports = {
  OSS_SYSTEM_SETTING_KEYS,
  SECRET_MASK,
  buildManagedOssAdminPayload,
  normalizeManagedOssSettingsInput,
  readStoredManagedOssSettings,
  resolveManagedOssConfig,
  serializeManagedOssSettings,
  summarizeManagedOssConfig,
};

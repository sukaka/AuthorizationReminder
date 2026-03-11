const {
  SECRET_MASK,
  buildManagedOssAdminPayload,
  normalizeManagedOssSettingsInput,
  resolveManagedOssConfig,
  serializeManagedOssSettings,
} = require('../src/oss-settings-utils');

describe('oss settings utils', () => {
  it('merges stored settings over env config', () => {
    const config = resolveManagedOssConfig({
      envConfig: {
        enabled: false,
        region: 'oss-cn-shanghai',
        bucket: 'env-bucket',
        endpoint: '',
        accessKeyId: 'env-ak',
        accessKeySecret: 'env-sk',
        stsToken: '',
        uploadExpiresSeconds: 600,
        playbackExpiresSeconds: 300,
        uploadMaxFileSizeMb: 2048,
      },
      settings: {
        oss_enabled: 'true',
        oss_bucket: 'db-bucket',
        oss_signed_upload_expires_seconds: '900',
        oss_upload_max_file_size_mb: '1024',
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.region).toBe('oss-cn-shanghai');
    expect(config.bucket).toBe('db-bucket');
    expect(config.accessKeyId).toBe('env-ak');
    expect(config.uploadExpiresSeconds).toBe(900);
    expect(config.uploadMaxFileSizeMb).toBe(1024);
    expect(config.uploadMaxBytes).toBe(1024 * 1024 * 1024);
  });

  it('keeps stored secrets when payload submits masked placeholder', () => {
    const normalized = normalizeManagedOssSettingsInput({
      payload: {
        enabled: true,
        region: 'oss-cn-hangzhou',
        bucket: 'video-bucket',
        access_key_id: 'ak',
        access_key_secret: SECRET_MASK,
        sts_token: SECRET_MASK,
        signed_upload_expires_seconds: 600,
        signed_play_expires_seconds: 300,
        upload_max_file_size_mb: 2048,
      },
      currentSettings: {
        oss_access_key_secret: 'saved-secret',
        oss_sts_token: 'saved-token',
      },
    });

    expect(normalized.accessKeySecret).toBe('saved-secret');
    expect(normalized.stsToken).toBe('saved-token');
  });

  it('masks secrets for admin payload and serializes values for storage', () => {
    const payload = buildManagedOssAdminPayload({
      enabled: true,
      region: 'oss-cn-hangzhou',
      bucket: 'train-video',
      endpoint: '',
      accessKeyId: 'LTAIxxxx',
      accessKeySecret: 'secret-value',
      stsToken: 'sts-token',
      uploadExpiresSeconds: 600,
      playbackExpiresSeconds: 300,
      uploadMaxFileSizeMb: 2048,
    });

    expect(payload.access_key_secret).toBe(SECRET_MASK);
    expect(payload.sts_token).toBe(SECRET_MASK);
    expect(payload.has_access_key_secret).toBe(true);
    expect(payload.has_sts_token).toBe(true);

    const stored = serializeManagedOssSettings({
      enabled: true,
      region: 'oss-cn-hangzhou',
      bucket: 'train-video',
      endpoint: '',
      accessKeyId: 'LTAIxxxx',
      accessKeySecret: 'secret-value',
      stsToken: '',
      uploadExpiresSeconds: 600,
      playbackExpiresSeconds: 300,
      uploadMaxFileSizeMb: 2048,
    });

    expect(stored.oss_enabled).toBe('true');
    expect(stored.oss_access_key_secret).toBe('secret-value');
    expect(stored.oss_upload_max_file_size_mb).toBe('2048');
  });
});

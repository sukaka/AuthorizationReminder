const crypto = require('crypto');
const OSS = require('ali-oss');

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const readOssConfigFromEnv = (env = process.env) => ({
  enabled: String(env.OSS_ENABLED || 'false').trim().toLowerCase() === 'true',
  region: trimText(env.OSS_REGION),
  bucket: trimText(env.OSS_BUCKET),
  endpoint: trimText(env.OSS_ENDPOINT),
  accessKeyId: trimText(env.OSS_ACCESS_KEY_ID),
  accessKeySecret: trimText(env.OSS_ACCESS_KEY_SECRET),
  stsToken: trimText(env.OSS_STS_TOKEN),
  uploadExpiresSeconds: parsePositiveInt(env.OSS_SIGNED_UPLOAD_EXPIRES_SECONDS, 600),
  playbackExpiresSeconds: parsePositiveInt(env.OSS_SIGNED_PLAY_EXPIRES_SECONDS, 300),
  uploadMaxFileSizeMb: parsePositiveInt(env.OSS_UPLOAD_MAX_FILE_SIZE_MB, 2048),
});

const validateOssConfig = (config = {}) => {
  const normalized = {
    enabled: !!config.enabled,
    region: trimText(config.region),
    bucket: trimText(config.bucket),
    endpoint: trimText(config.endpoint),
    accessKeyId: trimText(config.accessKeyId),
    accessKeySecret: trimText(config.accessKeySecret),
    stsToken: trimText(config.stsToken),
    uploadExpiresSeconds: parsePositiveInt(config.uploadExpiresSeconds, 600),
    playbackExpiresSeconds: parsePositiveInt(config.playbackExpiresSeconds, 300),
    uploadMaxFileSizeMb: parsePositiveInt(config.uploadMaxFileSizeMb, 2048),
  };
  normalized.uploadMaxBytes = normalized.uploadMaxFileSizeMb * 1024 * 1024;

  if (!normalized.region) throw new Error('OSS_REGION 未配置');
  if (!normalized.bucket) throw new Error('OSS_BUCKET 未配置');
  if (!normalized.accessKeyId) throw new Error('OSS_ACCESS_KEY_ID 未配置');
  if (!normalized.accessKeySecret) throw new Error('OSS_ACCESS_KEY_SECRET 未配置');
  return normalized;
};

const createOssClient = ({ config, OSSClient = OSS } = {}) => {
  const normalized = validateOssConfig(config || readOssConfigFromEnv());
  const client = new OSSClient({
    region: normalized.region,
    bucket: normalized.bucket,
    accessKeyId: normalized.accessKeyId,
    accessKeySecret: normalized.accessKeySecret,
    stsToken: normalized.stsToken || undefined,
    endpoint: normalized.endpoint || undefined,
  });
  return { client, config: normalized };
};

const buildManagedOssObjectKey = ({ courseId, resourceId, ext = '.mp4' } = {}) => {
  const safeCourseId = Math.max(0, Number(courseId || 0));
  const safeResourceId = Math.max(0, Number(resourceId || 0));
  const safeExt = trimText(ext).startsWith('.') ? trimText(ext) : `.${trimText(ext) || 'mp4'}`;
  return `train-exam/course-${safeCourseId}/resource-${safeResourceId}/${crypto.randomUUID()}${safeExt}`;
};

const createManagedOssUploadSignature = async ({
  client,
  objectKey,
  mimeType = 'video/mp4',
  expiresSeconds = 600,
} = {}) => {
  const key = trimText(objectKey);
  if (!key) throw new Error('objectKey 不能为空');
  if (!client || typeof client.signatureUrl !== 'function') throw new Error('OSS client 不可用');
  const contentType = trimText(mimeType) || 'video/mp4';
  const ttl = parsePositiveInt(expiresSeconds, 600);
  const uploadUrl = client.signatureUrl(key, {
    method: 'PUT',
    expires: ttl,
    'Content-Type': contentType,
  });
  return {
    object_key: key,
    upload_url: uploadUrl,
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  };
};

const createManagedOssPlaybackUrl = async ({
  client,
  objectKey,
  expiresSeconds = 300,
} = {}) => {
  const key = trimText(objectKey);
  if (!key) throw new Error('objectKey 不能为空');
  if (!client || typeof client.signatureUrl !== 'function') throw new Error('OSS client 不可用');
  const ttl = parsePositiveInt(expiresSeconds, 300);
  return client.signatureUrl(key, {
    method: 'GET',
    expires: ttl,
  });
};

const headManagedOssObject = async ({ client, objectKey } = {}) => {
  const key = trimText(objectKey);
  if (!key) throw new Error('objectKey 不能为空');
  if (!client || typeof client.head !== 'function') throw new Error('OSS client 不可用');
  const result = await client.head(key);
  const headers = result?.res?.headers || result?.headers || {};
  return {
    objectKey: key,
    etag: trimText(headers.etag || headers.ETag),
    contentLength: Number(headers['content-length'] || headers['Content-Length'] || 0) || 0,
    contentType: trimText(headers['content-type'] || headers['Content-Type']),
    raw: result,
  };
};

module.exports = {
  buildManagedOssObjectKey,
  createManagedOssPlaybackUrl,
  createManagedOssUploadSignature,
  createOssClient,
  headManagedOssObject,
  readOssConfigFromEnv,
  validateOssConfig,
};

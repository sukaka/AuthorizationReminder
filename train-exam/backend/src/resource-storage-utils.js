const STORAGE_BACKEND_ALIASES = Object.freeze({
  local: 'local',
  oss: 'oss',
  external: 'external',
  upload: 'local',
  '阿里云oss': 'oss',
  '阿里云 oss': 'oss',
  本地: 'local',
  外链: 'external',
});

const UPLOAD_STATUS_ALIASES = Object.freeze({
  pending: 'pending',
  uploading: 'uploading',
  ready: 'ready',
  failed: 'failed',
  待上传: 'pending',
  上传中: 'uploading',
  已就绪: 'ready',
  失败: 'failed',
});

const ALLOWED_STORAGE_BACKENDS = new Set(['local', 'oss', 'external']);
const ALLOWED_UPLOAD_STATUSES = new Set(['pending', 'uploading', 'ready', 'failed']);
const MANAGED_VIDEO_STORAGE_BACKENDS = new Set(['local', 'oss']);

const normalizeStorageBackend = (value, { sourceMode, fallback = 'local' } = {}) => {
  const mode = String(sourceMode || '').trim().toLowerCase();
  if (mode === 'external') return 'external';
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  const normalized = STORAGE_BACKEND_ALIASES[key] || STORAGE_BACKEND_ALIASES[raw] || key;
  if (ALLOWED_STORAGE_BACKENDS.has(normalized) && normalized !== 'external') return normalized;
  return fallback === 'oss' ? 'oss' : 'local';
};

const resolveStorageBackend = ({ sourceMode, requested, fallback = 'local' } = {}) =>
  normalizeStorageBackend(requested === undefined ? fallback : requested, { sourceMode, fallback });

const normalizeUploadStatus = (value, fallback = 'pending') => {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  const normalized = UPLOAD_STATUS_ALIASES[key] || UPLOAD_STATUS_ALIASES[raw] || key;
  return ALLOWED_UPLOAD_STATUSES.has(normalized) ? normalized : fallback;
};

const supportsManagedVideoPlayback = ({ resourceType, sourceMode, storageBackend }) => {
  const type = String(resourceType || '').trim().toLowerCase();
  const mode = String(sourceMode || '').trim().toLowerCase();
  const backend = resolveStorageBackend({ sourceMode: mode, requested: storageBackend });
  return type === 'video' && mode === 'upload' && MANAGED_VIDEO_STORAGE_BACKENDS.has(backend);
};

module.exports = {
  ALLOWED_STORAGE_BACKENDS,
  ALLOWED_UPLOAD_STATUSES,
  MANAGED_VIDEO_STORAGE_BACKENDS,
  normalizeStorageBackend,
  normalizeUploadStatus,
  resolveStorageBackend,
  supportsManagedVideoPlayback,
};

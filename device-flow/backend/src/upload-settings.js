const ATTACHMENT_UPLOAD_MAX_MB_MIN = 1;
const ATTACHMENT_UPLOAD_MAX_MB_MAX = 200;
const DEFAULT_ATTACHMENT_UPLOAD_MAX_MB = 10;
const BYTES_PER_MB = 1024 * 1024;

const normalizeAttachmentUploadMaxMb = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error('附件上传大小必须是整数 MB');
  }
  if (parsed < ATTACHMENT_UPLOAD_MAX_MB_MIN || parsed > ATTACHMENT_UPLOAD_MAX_MB_MAX) {
    throw new Error(
      `附件上传大小范围为 ${ATTACHMENT_UPLOAD_MAX_MB_MIN}-${ATTACHMENT_UPLOAD_MAX_MB_MAX}MB`
    );
  }
  return parsed;
};

const getDefaultAttachmentUploadMaxMb = (value = process.env.UPLOAD_MAX_FILE_SIZE_MB) => {
  try {
    return normalizeAttachmentUploadMaxMb(value || DEFAULT_ATTACHMENT_UPLOAD_MAX_MB);
  } catch {
    return DEFAULT_ATTACHMENT_UPLOAD_MAX_MB;
  }
};

const attachmentUploadMbToBytes = (value) => normalizeAttachmentUploadMaxMb(value) * BYTES_PER_MB;

const isAttachmentUploadSizeAllowed = (fileSizeBytes, maxFileSizeMb) => {
  const size = Number(fileSizeBytes);
  if (!Number.isFinite(size) || size < 0) return false;
  return size <= attachmentUploadMbToBytes(maxFileSizeMb);
};

const toAttachmentUploadSettingResponse = (value) => {
  const maxFileSizeMb = normalizeAttachmentUploadMaxMb(value);
  return {
    max_file_size_mb: maxFileSizeMb,
    max_file_size_bytes: maxFileSizeMb * BYTES_PER_MB,
    min_file_size_mb: ATTACHMENT_UPLOAD_MAX_MB_MIN,
    max_allowed_file_size_mb: ATTACHMENT_UPLOAD_MAX_MB_MAX,
  };
};

module.exports = {
  ATTACHMENT_UPLOAD_MAX_MB_MAX,
  ATTACHMENT_UPLOAD_MAX_MB_MIN,
  attachmentUploadMbToBytes,
  getDefaultAttachmentUploadMaxMb,
  isAttachmentUploadSizeAllowed,
  normalizeAttachmentUploadMaxMb,
  toAttachmentUploadSettingResponse,
};

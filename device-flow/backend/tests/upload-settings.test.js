const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ATTACHMENT_UPLOAD_MAX_MB_MAX,
  ATTACHMENT_UPLOAD_MAX_MB_MIN,
  getDefaultAttachmentUploadMaxMb,
  isAttachmentUploadSizeAllowed,
  normalizeAttachmentUploadMaxMb,
  toAttachmentUploadSettingResponse,
} = require('../src/upload-settings');

test('getDefaultAttachmentUploadMaxMb falls back to 10MB for invalid environment values', () => {
  assert.equal(getDefaultAttachmentUploadMaxMb(''), 10);
  assert.equal(getDefaultAttachmentUploadMaxMb('abc'), 10);
  assert.equal(getDefaultAttachmentUploadMaxMb('0'), 10);
});

test('normalizeAttachmentUploadMaxMb accepts integer megabyte values in range', () => {
  assert.equal(normalizeAttachmentUploadMaxMb('25'), 25);
  assert.equal(normalizeAttachmentUploadMaxMb(ATTACHMENT_UPLOAD_MAX_MB_MIN), ATTACHMENT_UPLOAD_MAX_MB_MIN);
  assert.equal(normalizeAttachmentUploadMaxMb(ATTACHMENT_UPLOAD_MAX_MB_MAX), ATTACHMENT_UPLOAD_MAX_MB_MAX);
});

test('normalizeAttachmentUploadMaxMb rejects non-integer and out-of-range values', () => {
  assert.throws(() => normalizeAttachmentUploadMaxMb('1.5'), /必须是整数/);
  assert.throws(() => normalizeAttachmentUploadMaxMb('0'), /范围为 1-200MB/);
  assert.throws(() => normalizeAttachmentUploadMaxMb('201'), /范围为 1-200MB/);
});

test('toAttachmentUploadSettingResponse exposes both MB and byte limits', () => {
  assert.deepEqual(toAttachmentUploadSettingResponse(12), {
    max_file_size_mb: 12,
    max_file_size_bytes: 12 * 1024 * 1024,
    min_file_size_mb: 1,
    max_allowed_file_size_mb: 200,
  });
});

test('isAttachmentUploadSizeAllowed validates file bytes against configured megabytes', () => {
  assert.equal(isAttachmentUploadSizeAllowed(2 * 1024 * 1024, 2), true);
  assert.equal(isAttachmentUploadSizeAllowed(2 * 1024 * 1024 + 1, 2), false);
});

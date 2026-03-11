const {
  normalizeStorageBackend,
  normalizeUploadStatus,
  resolveStorageBackend,
  supportsManagedVideoPlayback,
} = require('../src/resource-storage-utils');

describe('resource storage utils', () => {
  it('allows upload video resources to use oss backend', () => {
    expect(normalizeStorageBackend('oss', { sourceMode: 'upload' })).toBe('oss');
    expect(resolveStorageBackend({ sourceMode: 'upload', requested: 'oss' })).toBe('oss');
  });

  it('forces external resources to external backend', () => {
    expect(normalizeStorageBackend('oss', { sourceMode: 'external' })).toBe('external');
    expect(resolveStorageBackend({ sourceMode: 'external', requested: 'oss' })).toBe('external');
  });

  it('normalizes upload status with safe fallback', () => {
    expect(normalizeUploadStatus('ready')).toBe('ready');
    expect(normalizeUploadStatus('unknown-state')).toBe('pending');
  });

  it('treats upload local and upload oss videos as managed playback resources', () => {
    expect(
      supportsManagedVideoPlayback({
        resourceType: 'video',
        sourceMode: 'upload',
        storageBackend: 'local',
      })
    ).toBe(true);
    expect(
      supportsManagedVideoPlayback({
        resourceType: 'video',
        sourceMode: 'upload',
        storageBackend: 'oss',
      })
    ).toBe(true);
    expect(
      supportsManagedVideoPlayback({
        resourceType: 'video',
        sourceMode: 'external',
        storageBackend: 'external',
      })
    ).toBe(false);
  });
});

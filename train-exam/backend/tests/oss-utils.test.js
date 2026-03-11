const {
  buildManagedOssObjectKey,
  createManagedOssPlaybackUrl,
  createManagedOssUploadSignature,
  validateOssConfig,
} = require('../src/oss-utils');

describe('oss utils', () => {
  it('builds a scoped object key per course and resource', () => {
    const key = buildManagedOssObjectKey({ courseId: 12, resourceId: 34, ext: '.mp4' });
    expect(key).toMatch(/^train-exam\/course-12\/resource-34\/.+\.mp4$/);
  });

  it('rejects incomplete oss configuration', () => {
    expect(() => validateOssConfig({ bucket: '', region: '' })).toThrow(/OSS/);
  });

  it('creates a signed upload descriptor with put method and content-type header', async () => {
    const client = {
      signatureUrl(name, options) {
        expect(name).toBe('train-exam/course-1/resource-2/video.mp4');
        expect(options.method).toBe('PUT');
        expect(options['Content-Type']).toBe('video/mp4');
        return 'https://oss.example.com/upload-signed';
      },
    };

    const payload = await createManagedOssUploadSignature({
      client,
      objectKey: 'train-exam/course-1/resource-2/video.mp4',
      mimeType: 'video/mp4',
      expiresSeconds: 600,
    });

    expect(payload.upload_url).toBe('https://oss.example.com/upload-signed');
    expect(payload.method).toBe('PUT');
    expect(payload.headers['Content-Type']).toBe('video/mp4');
  });

  it('creates a signed playback url with get method', async () => {
    const client = {
      signatureUrl(name, options) {
        expect(name).toBe('train-exam/course-1/resource-2/video.mp4');
        expect(options.method).toBe('GET');
        return 'https://oss.example.com/play-signed';
      },
    };

    const url = await createManagedOssPlaybackUrl({
      client,
      objectKey: 'train-exam/course-1/resource-2/video.mp4',
      expiresSeconds: 300,
    });

    expect(url).toBe('https://oss.example.com/play-signed');
  });
});

const {
  buildManagedOssObjectKey,
  createManagedOssPlaybackUrl,
  createManagedOssUploadSignature,
  createOssClient,
  headManagedOssObject,
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

  it('creates oss client with https transport and network retries by default', () => {
    let capturedOptions = null;
    class FakeOSSClient {
      constructor(options) {
        capturedOptions = options;
      }
    }

    createOssClient({
      OSSClient: FakeOSSClient,
      config: {
        enabled: true,
        region: 'oss-cn-beijing',
        bucket: 'training-media-jx',
        endpoint: 'oss-cn-beijing.aliyuncs.com',
        accessKeyId: 'id',
        accessKeySecret: 'secret',
      },
    });

    expect(capturedOptions.secure).toBe(true);
    expect(capturedOptions.retryMax).toBeGreaterThanOrEqual(2);
    expect(capturedOptions.timeout).toBe('120s');
  });

  it('upgrades explicit http oss endpoint to https', () => {
    let capturedOptions = null;
    class FakeOSSClient {
      constructor(options) {
        capturedOptions = options;
      }
    }

    createOssClient({
      OSSClient: FakeOSSClient,
      config: {
        enabled: true,
        region: 'oss-cn-beijing',
        bucket: 'training-media-jx',
        endpoint: 'http://oss-cn-beijing.aliyuncs.com',
        accessKeyId: 'id',
        accessKeySecret: 'secret',
      },
    });

    expect(capturedOptions.endpoint).toBe('https://oss-cn-beijing.aliyuncs.com');
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

  it('retries transient head failures before validating uploaded object', async () => {
    let attempts = 0;
    const client = {
      async head(name) {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('socket hang up');
          err.status = -1;
          throw err;
        }
        expect(name).toBe('train-exam/course-1/resource-2/video.mp4');
        return {
          res: {
            headers: {
              etag: '"abc"',
              'content-length': '12',
              'content-type': 'video/mp4',
            },
          },
        };
      },
    };

    const result = await headManagedOssObject({
      client,
      objectKey: 'train-exam/course-1/resource-2/video.mp4',
      retryDelayMs: 0,
    });

    expect(attempts).toBe(2);
    expect(result.contentLength).toBe(12);
    expect(result.contentType).toBe('video/mp4');
  });
});

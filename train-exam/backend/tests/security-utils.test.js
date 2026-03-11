const {
  canReadCourse,
  createMemoryRateLimiter,
  isDocPreviewHostAllowed,
  validateAiBaseUrl,
} = require('../src/security-utils');

describe('security utils', () => {
  it('allows elevated roles to read all courses but restricts viewers to published courses', () => {
    expect(canReadCourse({ role: 'admin', courseStatus: 'draft' })).toBe(true);
    expect(canReadCourse({ role: 'editor', courseStatus: 'draft' })).toBe(true);
    expect(canReadCourse({ role: 'viewer', courseStatus: 'published' })).toBe(true);
    expect(canReadCourse({ role: 'viewer', courseStatus: 'draft' })).toBe(false);
  });

  it('rejects unsafe AI base URLs and accepts public https endpoints', () => {
    expect(() => validateAiBaseUrl('http://127.0.0.1:8080')).toThrow(/AI/);
    expect(() => validateAiBaseUrl('http://localhost:11434')).toThrow(/AI/);
    expect(() => validateAiBaseUrl('http://10.0.0.5:8080')).toThrow(/AI/);
    expect(validateAiBaseUrl('https://api.openai.com/v1').toString()).toBe('https://api.openai.com/v1');
  });

  it('allows doc preview requests only when host matches the token-bound host', () => {
    expect(isDocPreviewHostAllowed({ requestHost: 'train-exam-api:5188', tokenHost: 'train-exam-api:5188' })).toBe(true);
    expect(isDocPreviewHostAllowed({ requestHost: 'localhost:5188', tokenHost: 'train-exam-api:5188' })).toBe(false);
    expect(
      isDocPreviewHostAllowed({
        requestHost: 'train-exam-api:5188',
        tokenHost: 'train-exam-api:5188',
        forwardedFor: '127.0.0.1',
      })
    ).toBe(false);
  });

  it('enforces in-memory rate limits by key and window', () => {
    const limiter = createMemoryRateLimiter({ windowMs: 1000, limit: 2 });
    expect(limiter.consume('editor', 1000).allowed).toBe(true);
    expect(limiter.consume('editor', 1001).allowed).toBe(true);
    expect(limiter.consume('editor', 1002).allowed).toBe(false);
    expect(limiter.consume('editor', 2500).allowed).toBe(true);
  });
});

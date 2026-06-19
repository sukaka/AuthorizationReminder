import { createRequire } from 'node:module';
import { describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createRuntimeTokenGuard } = require('../src/runtime-auth');


const invokeGuard = (expected, provided) => {
  const guard = createRuntimeTokenGuard(expected);
  const req = { get: vi.fn().mockReturnValue(provided) };
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  guard(req, res, next);
  return { req, res, next };
};


describe('runtime token guard', () => {
  test('rejects a configured token shorter than 32 bytes', () => {
    const { res, next } = invokeGuard('short-token', 'short-token');

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: '运行时凭据无效' });
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects missing and same-length incorrect tokens', () => {
    const expected = 'r'.repeat(32);
    for (const provided of ['', 'x'.repeat(32)]) {
      const { res, next } = invokeGuard(expected, provided);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('accepts the exact configured token', () => {
    const token = 'r'.repeat(32);
    const { res, next } = invokeGuard(token, token);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

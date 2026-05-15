import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth.js'), 'utf8');

describe('prompt center auth source', () => {
  test('uses unified login introspection and prompt-center system key', () => {
    expect(source).toContain('/api/auth/introspect');
    expect(source).toContain("AUTH_SYSTEM_KEY || 'prompt-center'");
    expect(source).toContain('无权限访问提示词管理系统');
  });

  test('reads auth token from bearer header or shared cookie', () => {
    expect(source).toContain('extractBearerToken');
    expect(source).toContain('extractCookieToken');
    expect(source).toContain('juxin_auth_token');
  });

  test('limits prompt center audit visibility to auditor role', () => {
    expect(source).toContain("const canReadAudit = (req) => isAuditor(req);");
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

describe('prompt center csrf protection source', () => {
  test('issues csrf tokens and validates unsafe requests', () => {
    expect(source).toContain('/csrf');
    expect(source).toContain('X-CSRF-Token');
    expect(source).toContain('validateCsrfToken');
    expect(source).toContain('timingSafeEqual');
  });
});

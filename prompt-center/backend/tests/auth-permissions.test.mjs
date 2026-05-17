import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { canManageTaxonomy } = require('../src/auth');

const reqWithRole = (role) => ({ user: { id: 1, role } });

describe('prompt center role permissions', () => {
  test('allows only admin users to manage departments and categories', () => {
    expect(canManageTaxonomy(reqWithRole('admin'))).toBe(true);
    expect(canManageTaxonomy(reqWithRole('editor'))).toBe(false);
    expect(canManageTaxonomy(reqWithRole('reviewer'))).toBe(false);
    expect(canManageTaxonomy(reqWithRole('auditor'))).toBe(false);
    expect(canManageTaxonomy(reqWithRole('user'))).toBe(false);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { getAuthPortalUrl } from '../src/api/client';

afterEach(() => vi.unstubAllEnvs());

it('uses the same-origin OIDC entrance only for AI login', () => {
  vi.stubEnv('VITE_OIDC_ENABLED', 'true');
  expect(getAuthPortalUrl()).toBe(`${window.location.origin}/api/oidc/ai-assistant/login`);
  expect(getAuthPortalUrl({ system: 'ai-assistant' })).toBe(`${window.location.origin}/api/oidc/ai-assistant/login`);
  expect(new URL(getAuthPortalUrl({ system: 'faq' })).pathname).toBe('/portal');
  expect(new URL(getAuthPortalUrl({ logout: true })).searchParams.get('logout')).toBe('1');
});

it('keeps the original portal when OIDC is not enabled', () => {
  vi.stubEnv('VITE_OIDC_ENABLED', 'false');
  expect(new URL(getAuthPortalUrl()).pathname).toBe('/portal');
});

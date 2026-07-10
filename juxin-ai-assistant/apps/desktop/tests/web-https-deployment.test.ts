import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(__dirname, '..', '..', '..');
const appRoot = resolve(__dirname, '..');

describe('AI assistant HTTPS deployment contract', () => {
  it('injects the public auth origin into the web build', () => {
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8');
    const compose = readFileSync(
      resolve(repositoryRoot, 'docker-compose.ai-assistant-https.yml'),
      'utf8',
    );

    expect(dockerfile).toContain('ARG VITE_AUTH_PUBLIC_URL');
    expect(dockerfile).toContain('ENV VITE_AUTH_PUBLIC_URL=$VITE_AUTH_PUBLIC_URL');
    expect(compose).toContain('VITE_AUTH_PUBLIC_URL: ${AI_ASSISTANT_PUBLIC_URL:?');
  });

  it('forces one HTTPS origin and secure auth cookies', () => {
    const compose = readFileSync(
      resolve(repositoryRoot, 'docker-compose.ai-assistant-https.yml'),
      'utf8',
    );

    expect(compose).toContain('AUTH_PUBLIC_URL: ${AI_ASSISTANT_PUBLIC_URL:?');
    expect(compose).toContain('PUBLIC_URL: ${AI_ASSISTANT_PUBLIC_URL:?');
    expect(compose).toContain('CORS_ORIGINS: ${AI_ASSISTANT_PUBLIC_URL:?');
    expect(compose).toContain('APP_AI_ASSISTANT_URL: ${AI_ASSISTANT_PUBLIC_URL:?');
    expect(compose).toContain('AUTH_COOKIE_SECURE: "true"');
    expect(compose).toContain('AUTH_SECURITY_STRICT_MODE: "true"');
    expect(compose).toContain('target: 443');
    expect(compose).toContain('published: "443"');
  });
});

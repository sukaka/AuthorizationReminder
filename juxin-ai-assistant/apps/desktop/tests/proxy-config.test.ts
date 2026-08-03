import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readThemeCss } from './helpers/themeCss';

const appRoot = resolve(__dirname, '..');

const requiredApiPrefixes = [
  '/api/ai',
  '/api/export',
  '/api/knowledge',
  '/api/personal-reference',
  '/api/conversations',
] as const;

describe('desktop runtime API proxy config', () => {
  it('proxies every API prefix used by the desktop app in Vite development', () => {
    const viteConfig = readFileSync(resolve(appRoot, 'vite.config.ts'), 'utf8');

    requiredApiPrefixes.forEach((prefix) => {
      expect(viteConfig, `missing Vite proxy for ${prefix}`).toContain(`'${prefix}'`);
    });
  });

  it('proxies every API prefix used by the desktop app in the Nginx web container', () => {
    const nginxConfig = readFileSync(resolve(appRoot, 'nginx.conf'), 'utf8');

    requiredApiPrefixes.forEach((prefix) => {
      expect(nginxConfig, `missing Nginx proxy coverage for ${prefix}`).toContain(prefix.replace('/api/', ''));
    });
    expect(nginxConfig).toContain('set $ai_assistant_api_upstream http://ai-assistant-api:5193;');
    expect(nginxConfig).toContain('proxy_pass $ai_assistant_api_upstream;');
  });
});

describe('desktop modal layering', () => {
  it('keeps the chat upload dialog above the fixed theme switcher', () => {
    const css = readThemeCss();
    const uploadDialogRule = css.match(/\.chat-upload-dialog\s*\{(?<body>[^}]+)\}/)?.groups?.body || '';
    const themeSwitcherRule = css.match(/\.theme-switcher\s*\{(?<body>[^}]+)\}/)?.groups?.body || '';
    const uploadZIndex = Number(uploadDialogRule.match(/z-index:\s*(\d+)/)?.[1] || 0);
    const themeZIndex = Number(themeSwitcherRule.match(/z-index:\s*(\d+)/)?.[1] || 0);

    expect(uploadDialogRule).toContain('position: fixed');
    expect(uploadZIndex).toBeGreaterThan(themeZIndex);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'App.jsx'), 'utf8');
const viteConfig = fs.readFileSync(path.join(import.meta.dirname, '..', 'vite.config.js'), 'utf8');

test('prompt center UI contains department, category, version and audit views', () => {
  assert.match(source, /部门/);
  assert.match(source, /分类/);
  assert.match(source, /版本/);
  assert.match(source, /审计/);
});

test('prompt center UI calls prompt-center API namespace', () => {
  assert.match(source, /\/api\/prompt-center/);
  assert.match(source, /\/prompts\/\$\{selectedPrompt\.id\}\/publish/);
});

test('prompt center UI sends csrf token for write requests', () => {
  assert.match(source, /\/csrf/);
  assert.match(source, /X-CSRF-Token/);
});

test('prompt center vite build enables react plugin', () => {
  assert.match(viteConfig, /@vitejs\/plugin-react/);
  assert.match(viteConfig, /plugins:\s*\[react\(\)\]/);
});

test('prompt center redirects unauthenticated users to unified portal', () => {
  assert.match(source, /VITE_SSO_PORTAL_URL/);
  assert.match(source, /params\.set\('system', system\)/);
  assert.match(source, /params\.set\('mode', mode\)/);
  assert.match(source, /buildPortalUrl\(\{ system \}\)/);
  assert.match(source, /buildPortalUrl\(\{ system: 'prompt-center', mode: 'switch' \}\)/);
  assert.match(source, /resp\.status === 401/);
  assert.match(source, /prompt-center/);
});

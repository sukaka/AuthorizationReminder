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

test('prompt center UI supports department managers and creator display', () => {
  assert.match(source, /manager_user_id/);
  assert.match(source, /manager_name/);
  assert.match(source, /managed_department_ids/);
  assert.match(source, /创建人/);
  assert.match(source, /负责人/);
});

test('prompt center UI supports nested prompt library navigation and favorites', () => {
  assert.match(source, /提示词创建/);
  assert.match(source, /提示词列表/);
  assert.match(source, /我的收藏/);
  assert.match(source, /一级分类/);
  assert.match(source, /二级分类/);
  assert.match(source, /三级分类/);
  assert.match(source, /setLibraryMode\('create'\)/);
  assert.match(source, /setLibraryMode\('list'\)/);
  assert.match(source, /setActiveTab\('favorites'\)/);
});

test('prompt center UI exposes row edit archive and favorite actions', () => {
  assert.match(source, /编辑/);
  assert.match(source, /删除/);
  assert.match(source, /收藏/);
  assert.match(source, /\/favorites/);
  assert.match(source, /\/prompts\/\$\{prompt\.id\}\/favorite/);
  assert.match(source, /toggleFavorite/);
});

test('prompt center create page uses the approved single-workbench layout', () => {
  assert.match(source, /create-workspace/);
  assert.match(source, /create-permission-notice/);
  assert.match(source, /category-select-grid/);
  assert.match(source, /prompt-editor-shell/);
  assert.doesNotMatch(source, /工作概览/);
  assert.doesNotMatch(source, /分类路径/);
  assert.doesNotMatch(source, /维护规则/);
});

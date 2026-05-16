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
  assert.doesNotMatch(source, /三级分类/);
  assert.match(source, /setLibraryMode\('create'\)/);
  assert.match(source, /setLibraryMode\('list'\)/);
  assert.match(source, /setActiveTab\('favorites'\)/);
});

test('prompt center create page uses second-level category as the final prompt category', () => {
  assert.doesNotMatch(source, /formLevel3Categories/);
  assert.doesNotMatch(source, /请选择三级分类/);
  assert.match(source, /category_level2: event\.target\.value,\s*category_id: event\.target\.value/s);
});

test('prompt center UI exposes row edit archive and favorite actions', () => {
  assert.match(source, /编辑/);
  assert.match(source, /删除/);
  assert.match(source, /收藏/);
  assert.match(source, /\/favorites/);
  assert.match(source, /\/prompts\/\$\{prompt\.id\}\/favorite/);
  assert.match(source, /toggleFavorite/);
});

test('prompt center create page shows publish state feedback', () => {
  assert.match(source, /状态：/);
  assert.match(source, /selectedPrompt\.status !== 'published'/);
  assert.match(source, /已发布/);
  assert.match(source, /发布/);
});

test('prompt center publish action shows dialog and opens the published prompt in list', () => {
  assert.match(source, /dialog/);
  assert.match(source, /发布成功/);
  assert.match(source, /发布失败/);
  assert.match(source, /openPromptInList/);
  assert.match(source, /setLibraryMode\('list'\)/);
});

test('prompt center version records support content comparison', () => {
  assert.match(source, /comparePromptVersions/);
  assert.match(source, /版本对比/);
  assert.match(source, /对比版本/);
  assert.match(source, /内容变化/);
});

test('prompt center create page uses the approved single-workbench layout', () => {
  assert.match(source, /create-workspace/);
  assert.match(source, /create-permission-notice/);
  assert.match(source, /category-select-grid/);
  assert.match(source, /prompt-editor-shell/);
  assert.match(source, /可以先填写内容，只有所选部门负责人可以保存/);
  assert.doesNotMatch(source, /disabled=\{!permissions\.can_write\}/);
  assert.doesNotMatch(source, /工作概览/);
  assert.doesNotMatch(source, /分类路径/);
  assert.doesNotMatch(source, /维护规则/);
});

test('prompt center list page uses the approved department and category browser layout', () => {
  assert.match(source, /prompt-list-workspace/);
  assert.match(source, /prompt-list-body/);
  assert.match(source, /list-department-panel/);
  assert.match(source, /department-mark/);
  assert.match(source, /prompt-category-tree/);
  assert.match(source, /prompt-table-panel/);
  assert.match(source, /list-favorites-panel/);
  assert.match(source, /先选择部门，再进入分类目录/);
  assert.match(source, /当前用户/);
});

test('prompt center category tree shows prompt counts on every category level', () => {
  assert.match(source, /<em>\{item\.prompt_count \|\| 0\} 条<\/em>/);
  assert.doesNotMatch(source, /depth === 1 && <em>\{item\.prompt_count \|\| 0\} 条<\/em>/);
});

test('prompt center category navigation clears text filters and explains direct category counts', () => {
  assert.match(source, /keyword: '',\s*status: '',\s*department_id: departmentId/s);
  assert.match(source, /keyword: '',\s*status: '',\s*department_id: browseDepartmentId/s);
  assert.match(source, /direct_prompt_count/);
  assert.match(source, /本级/);
  assert.match(source, /分类共/);
});

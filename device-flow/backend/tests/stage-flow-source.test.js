const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendIndex = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
const frontendApp = fs.readFileSync(path.join(__dirname, '../../frontend/src/App.jsx'), 'utf8');

const expectedStages = [
  'CREATED',
  'RECEIVED',
  'HARDWARE_CHECKED',
  'WAREHOUSED_AFTER_HARDWARE',
  'OUTBOUNDED_FOR_INSTALL',
  'OS_INSTALLED',
  'TESTED',
  'APPROVED',
  'PACKED',
  'WAREHOUSED_AFTER_PACK',
  'OUTBOUNDED_FOR_SHIP',
  'SHIPPED',
];

test('backend stage list includes stock and outbound checkpoints in order', () => {
  const stageListMatch = backendIndex.match(/const STAGES = \[([\s\S]*?)\];/);
  assert.ok(stageListMatch, 'backend STAGES declaration should exist');
  const actualStages = Array.from(stageListMatch[1].matchAll(/'([^']+)'/g)).map((match) => match[1]);
  assert.deepEqual(actualStages, expectedStages);
});

test('backend allows skipping optional stock and outbound checkpoint pairs', () => {
  assert.match(backendIndex, /HARDWARE_CHECKED:\s*'OS_INSTALLED'/);
  assert.match(backendIndex, /PACKED:\s*'SHIPPED'/);
  assert.match(backendIndex, /OPTIONAL_STAGE_SKIPS/);
});

test('frontend exposes optional next actions for stock checkpoint stages', () => {
  assert.match(frontendApp, /HARDWARE_CHECKED:\s*\['warehouse-after-hardware',\s*'os-install'\]/);
  assert.match(frontendApp, /PACKED:\s*\['warehouse-after-pack',\s*'ship'\]/);
  assert.match(frontendApp, /setSelectedAdvanceAction/);
});

test('backend exposes permission metadata and effective permissions for the current user', () => {
  assert.match(backendIndex, /\/api\/device-flow\/permissions\/meta/);
  assert.match(backendIndex, /\/api\/device-flow\/permissions\/effective/);
  assert.match(backendIndex, /MENU_PERMISSION_DEFINITIONS/);
  assert.match(backendIndex, /BUTTON_PERMISSION_DEFINITIONS/);
});

test('frontend renders permission settings and uses effective permissions for menus and buttons', () => {
  assert.match(frontendApp, /activeMenu === 'permissions'/);
  assert.match(frontendApp, /refreshPermissionEffective/);
  assert.match(frontendApp, /permissionMenuAllowed/);
  assert.match(frontendApp, /permissionButtonAllowed/);
  assert.match(frontendApp, /onSavePermissionPolicies/);
});

test('frontend labels and flow copy match the required operation flow', () => {
  for (const stage of expectedStages) {
    assert.match(frontendApp, new RegExp(`${stage}:`), `frontend should label ${stage}`);
  }
  assert.match(
    frontendApp,
    /流程：收货 → 硬件检查 → 入库 → 出库 → 系统安装 → 测试 → 审核 → 装箱 → 入库 → 出库 → 发货/
  );
});

test('frontend key responsibility rows use stage records for repeated stages', () => {
  assert.match(frontendApp, /detail\.stage_records/);
  assert.match(frontendApp, /operator_name/);
  assert.match(frontendApp, /WAREHOUSED_AFTER_PACK/);
  assert.match(frontendApp, /OUTBOUNDED_FOR_SHIP/);
});

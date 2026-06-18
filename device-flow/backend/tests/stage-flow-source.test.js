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

test('frontend detail page is organized as a task workbench with guided optional actions', () => {
  assert.match(frontendApp, /详情工作台/);
  assert.match(frontendApp, /detail-workbench/);
  assert.match(frontendApp, /workflow-stepper/);
  assert.match(frontendApp, /推荐动作/);
  assert.match(frontendApp, /可选路径/);
  assert.match(frontendApp, /跳过入库，直接系统安装/);
  assert.match(frontendApp, /跳过入库，直接发货/);
  assert.match(frontendApp, /留证要求/);
});

test('frontend detail workbench separates dense content into tabs', () => {
  assert.match(frontendApp, /detailTabs/);
  assert.match(frontendApp, /activeDetailTab/);
  assert.match(frontendApp, /detail-tabbar/);
  assert.match(frontendApp, /执行推进/);
  assert.match(frontendApp, /附件留证/);
  assert.match(frontendApp, /责任节点/);
  assert.match(frontendApp, /退回处理/);
  assert.match(frontendApp, /流转记录/);
});

test('frontend permission page groups policies by business permission category', () => {
  assert.match(frontendApp, /菜单权限/);
  assert.match(frontendApp, /操作权限/);
  assert.match(frontendApp, /阶段权限/);
  assert.match(frontendApp, /permission-overview-grid/);
  assert.match(frontendApp, /策略明细/);
});

test('permission policies target users and allow selecting multiple permissions at once', () => {
  assert.match(backendIndex, /user_sub/);
  assert.match(backendIndex, /user_name/);
  assert.match(backendIndex, /findMatchedPermissionPolicy = async \(\{ userSub,/);
  assert.match(frontendApp, /selected_action_codes/);
  assert.match(frontendApp, /permissionUserOptions/);
  assert.match(frontendApp, /multiple/);
  assert.match(frontendApp, /选择用户/);
  assert.match(frontendApp, /权限项/);
});

test('audit log entry is auditor-only and rendered with chinese labels', () => {
  assert.match(backendIndex, /const AUDIT_READER_ROLES = new Set\(\['auditor'\]\)/);
  assert.match(frontendApp, /const canReadAuditLogs = isAuditOnlyUser && permissionMenuAllowed\('audit'\)/);
  assert.match(backendIndex, /const canReadOperationLogs = AUDIT_READER_ROLES\.has\(normalizeRole\(req\.user\?\.role\)\)/);
  assert.match(backendIndex, /recent_logs: canReadOperationLogs \? recentRows\.map\(toPublicOperationLog\) : \[\]/);
  assert.match(frontendApp, /\{canReadAuditLogs \? \(\s*<div className="panel-subsection" style=\{\{ marginTop: 14 \}\}>/);
  assert.match(frontendApp, /auditActionLabelMap/);
  assert.match(frontendApp, /auditActionText/);
  assert.match(frontendApp, /auditMessageText/);
  assert.match(frontendApp, /最近审计日志/);
  assert.doesNotMatch(frontendApp, /最近操作日志/);
  assert.match(frontendApp, /roleText/);
  assert.match(frontendApp, /创建流转单/);
  assert.match(frontendApp, /更新权限策略/);
  assert.match(frontendApp, /发起双人复核测试/);
  assert.match(frontendApp, /return `阶段推进 \$\{stageText\(stageAdvanceMatch\[1\]\)\} → \$\{stageText\(stageAdvanceMatch\[2\]\)\}`/);
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

test('device SN is optional before system installation and can be filled during OS install', () => {
  assert.doesNotMatch(backendIndex, /设备SN不能为空/);
  assert.doesNotMatch(backendIndex, /device_sn\/设备SN 不能为空/);
  assert.match(backendIndex, /device_sn: trimText\(payload\.device_sn\)\.toUpperCase\(\)/);
  assert.match(backendIndex, /updateFields\.device_sn = trimText\(stagePayload\.device_sn\)\.toUpperCase\(\)/);
  assert.match(frontendApp, /设备SN（系统安装后补录）/);
  assert.doesNotMatch(frontendApp, /设备SN \*/);
  assert.match(frontendApp, /待安装后补录/);
  assert.match(frontendApp, /placeholder="系统安装完成后填写"/);
});

test('backend scopes jobs to admins, creators, and permanent second signers', () => {
  assert.match(backendIndex, /require\('\.\/job-visibility'\)/);
  assert.match(backendIndex, /const appendJobVisibilityScope =/);
  assert.match(backendIndex, /const requireVisibleJob = asyncHandler/);
  assert.match(backendIndex, /流转单不存在或无权访问', 404/);
  assert.match(
    backendIndex,
    /'\/api\/device-flow\/jobs',\s*asyncHandler\(async \(req, res\) => \{[\s\S]*?appendJobVisibilityScope\(\{ where, params, actor: getActor\(req\), jobAlias: 'j' \}\)/
  );
  assert.match(
    backendIndex,
    /'\/api\/device-flow\/jobs\/:id',\s*requireVisibleJob,\s*asyncHandler/
  );
});

test('second signer selector includes every active user except the current user', () => {
  assert.doesNotMatch(frontendApp, /\.filter\(\(item\) => \['admin', 'sysadmin'\]\.includes\(normalizeRole\(item\?\.role\)\)\)/);
  assert.match(frontendApp, /\.filter\(\(item\) => String\(item\?\.id\) !== String\(currentUserId \|\| ''\)\)/);
  assert.match(frontendApp, /label: `\$\{item\.username\} · \$\{roleText\(item\.role\)\}/);
});

test('frontend key responsibility rows use stage records for repeated stages', () => {
  assert.match(frontendApp, /detail\.stage_records/);
  assert.match(frontendApp, /operator_name/);
  assert.match(frontendApp, /WAREHOUSED_AFTER_PACK/);
  assert.match(frontendApp, /OUTBOUNDED_FOR_SHIP/);
});

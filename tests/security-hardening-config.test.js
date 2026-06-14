const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..');

const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(rootDir, relativePath));

const activeSystemNames = [
  '授权到期提醒',
  '交付系统',
  'CMDB',
  '库存管理',
  '设备流转',
  '文档管理',
  '标书协同',
  '培训考试',
  '提示词管理中心',
  '软件成分分析平台',
  '统一大屏展示中心',
];

test('README and legacy topology use the 11 active-system baseline', () => {
  const readme = read('README.md');
  const topology = read('docs/manuals/system-mysql-topology.md');

  assert.match(readme, /包含以下 11 个现役业务系统/);
  for (const name of activeSystemNames) {
    assert.match(readme, new RegExp(name));
    assert.match(topology, new RegExp(name));
  }

  assert.doesNotMatch(readme, /包含以下 12 个业务域/);
  assert.doesNotMatch(readme, /工单前端|工单后端|聚信实施记录前端|聚信实施记录后端/);
  assert.match(readme, /历史兼容资产/);
  assert.match(topology, /历史兼容资产/);
});

test('production compose does not embed fixed example secrets or weak default credentials', () => {
  const compose = read('docker-compose.yml');

  const forbiddenPatterns = [
    /inventory-shipping-gateway-dev-token/,
    /change_me_[A-Za-z0-9_]+/,
    /_change_me/,
    /dev_password_change_me/,
    /JWT_SECRET:\s*"[a-f0-9]{32,}"/,
    /AUDIT_SIGNING_KEY:\s*"[^"$]+change-me[^"]*"/,
    /CONFIG_SECRET_KEY:\s*"[^"$]+change-me[^"]*"/,
    /\$\{[A-Z0-9_]+:-change_me_[^}]+}/,
    /\$\{DELIVERY_MYSQL_PASSWORD:-[^}]+}/,
    /\$\{BIG_SCREEN_MYSQL_PASSWORD:-\$\{MYSQL_SHARED_APP_PASSWORD}}/,
    /MYSQL_SHARED_APP_PASSWORD/,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(compose, pattern);
  }
});

test('each active business schema has an explicit least-privilege runtime account', () => {
  const compose = read('docker-compose.yml');
  const envExample = read('.env.example');
  const expectedVariables = [
    'REMINDER_MYSQL_PASSWORD',
    'DELIVERY_MYSQL_PASSWORD',
    'INVENTORY_MYSQL_PASSWORD',
    'DEVICE_FLOW_MYSQL_PASSWORD',
    'FAQ_MYSQL_PASSWORD',
    'TENDER_MYSQL_PASSWORD',
    'TRAIN_EXAM_MYSQL_PASSWORD',
    'PROMPT_CENTER_MYSQL_PASSWORD',
    'BIG_SCREEN_MYSQL_PASSWORD',
    'CMDB_MYSQL_PASSWORD',
  ];

  for (const variable of expectedVariables) {
    assert.match(envExample, new RegExp(`^${variable}=change_me_`, 'm'));
    assert.match(compose, new RegExp(`MYSQL_PASSWORD: \\$\\{${variable}\\}`));
  }

  assert.match(compose, /MYSQL_USER: reminder_user/);
  assert.match(compose, /MYSQL_USER: inventory_user/);
  assert.match(compose, /MYSQL_USER: device_flow_user/);
  assert.match(compose, /MYSQL_USER: big_screen_user/);
});

test('active business backends expose unified operational endpoints', () => {
  const serviceEntryFiles = [
    'server/index.js',
    'delivery/backend/src/index.js',
    'inventory-system/backend/src/index.js',
    'device-flow/backend/src/index.js',
    'faq/backend/src/index.js',
    'tender/backend/src/index.js',
    'train-exam/backend/src/index.js',
    'prompt-center/backend/src/index.js',
    'big-screen-center/backend/src/app.ts',
    'sca-platform/backend/app/main.py',
    'cmdb/internal/handler/router.go',
  ];

  for (const relativePath of serviceEntryFiles) {
    const source = read(relativePath);
    for (const route of ['/api/health', '/api/ready', '/api/version', '/api/build']) {
      assert.match(source, new RegExp(route.replace(/\//g, '\\/')), `${relativePath} missing ${route}`);
    }
  }
});

test('high-level design documents OWASP Top 10:2025 controls and hardening backlog', () => {
  const hldPath = 'docs/superpowers/specs/2026-06-13-all-systems-high-level-design.md';
  assert.equal(exists(hldPath), true);

  const hld = read(hldPath);
  const expectedControlIds = [
    'A01:2025',
    'A02:2025',
    'A03:2025',
    'A04:2025',
    'A05:2025',
    'A06:2025',
    'A07:2025',
    'A08:2025',
    'A09:2025',
    'A10:2025',
  ];

  assert.match(hld, /OWASP Top 10:2025/);
  for (const controlId of expectedControlIds) {
    assert.match(hld, new RegExp(controlId));
  }
  for (const phrase of [
    '统一 11 个现役系统口径',
    '清除生产配置中的固定示例密钥和弱默认值',
    '每个业务 Schema 使用独立最小权限账号',
    '统一健康、就绪、版本和构建信息接口',
  ]) {
    assert.match(hld, new RegExp(phrase));
  }
});

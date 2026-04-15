const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN_CENTER_KEY,
  AUDIT_CENTER_KEY,
  canAccessDedicatedCenter,
  defaultAppAccessByRole,
  getDedicatedCenterConfig,
  resolveUserAppAccess,
  resolvePortalRedirectTarget,
} = require('../portal-routing');

test('sysadmin defaults to admin-center access', () => {
  assert.deepEqual(defaultAppAccessByRole('sysadmin'), ['admin-center']);
});

test('auditor defaults to audit-center access', () => {
  assert.deepEqual(defaultAppAccessByRole('auditor'), ['audit-center', 'delivery']);
});

test('admin defaults to delivery instead of ticketing and sec-impl', () => {
  const access = defaultAppAccessByRole('admin');
  assert.ok(access.includes('delivery'));
  assert.equal(access.includes('ticketing'), false);
  assert.equal(access.includes('sec-impl'), false);
});

test('sysadmin without requested system redirects to admin-center', () => {
  const target = resolvePortalRedirectTarget({
    apps: [
      { key: 'admin-center', url: 'http://localhost:5180/admin-center' },
      { key: 'reminder', url: 'http://localhost:18080' },
    ],
    userRole: 'sysadmin',
    requestedSystem: '',
    portalMode: '',
  });

  assert.deepEqual(target, { key: 'admin-center', url: 'http://localhost:5180/admin-center' });
});

test('auditor without requested system redirects to audit-center', () => {
  const target = resolvePortalRedirectTarget({
    apps: [
      { key: 'audit-center', url: 'http://localhost:5180/audit-center' },
      { key: 'reminder', url: 'http://localhost:18080' },
    ],
    userRole: 'auditor',
    requestedSystem: '',
    portalMode: '',
  });

  assert.deepEqual(target, { key: 'audit-center', url: 'http://localhost:5180/audit-center' });
});

test('requested system still wins over privileged default', () => {
  const target = resolvePortalRedirectTarget({
    apps: [
      { key: 'admin-center', url: 'http://localhost:5180/admin-center' },
      { key: 'reminder', url: 'http://localhost:18080' },
    ],
    userRole: 'sysadmin',
    requestedSystem: 'reminder',
    portalMode: '',
  });

  assert.deepEqual(target, { key: 'reminder', url: 'http://localhost:18080' });
});

test('sysadmin can access admin-center only', () => {
  assert.equal(canAccessDedicatedCenter({ role: 'sysadmin', systemKey: ADMIN_CENTER_KEY }), true);
  assert.equal(canAccessDedicatedCenter({ role: 'sysadmin', systemKey: AUDIT_CENTER_KEY }), false);
});

test('auditor can access audit-center only', () => {
  assert.equal(canAccessDedicatedCenter({ role: 'auditor', systemKey: AUDIT_CENTER_KEY }), true);
  assert.equal(canAccessDedicatedCenter({ role: 'auditor', systemKey: ADMIN_CENTER_KEY }), false);
});

test('admin never receives dedicated centers even when legacy app_access contains them', () => {
  const apps = resolveUserAppAccess({ role: ' admin ', app_access: '["reminder","ticketing","sec-impl","admin-center","audit-center"]' });

  assert.ok(apps.includes('reminder'));
  assert.ok(apps.includes('delivery'));
  assert.equal(apps.includes('ticketing'), false);
  assert.equal(apps.includes('sec-impl'), false);
  assert.equal(apps.includes(ADMIN_CENTER_KEY), false);
  assert.equal(apps.includes(AUDIT_CENTER_KEY), false);
});

test('sysadmin and auditor ignore legacy non-dedicated app_access', () => {
  assert.deepEqual(resolveUserAppAccess({ role: 'sysadmin', app_access: '["reminder","admin-center"]' }), [ADMIN_CENTER_KEY]);
  assert.deepEqual(resolveUserAppAccess({ role: 'auditor', app_access: '["faq","audit-center"]' }), [AUDIT_CENTER_KEY, 'delivery']);
});

test('legacy ticketing and sec-impl access folds into delivery once', () => {
  assert.deepEqual(
    resolveUserAppAccess({ role: 'editor', app_access: '["ticketing","sec-impl","faq"]' }),
    ['delivery', 'faq', 'train-exam']
  );
});

test('dedicated center config exposes admin and audit metadata', () => {
  assert.deepEqual(getDedicatedCenterConfig(ADMIN_CENTER_KEY), {
    key: 'admin-center',
    title: '聚信管理后台',
    subtitle: '负责用户管理与安全管理',
    api: {
      usersList: '/api/admin-center/users',
      usersCreate: '/api/admin-center/users',
      usersBatchDelete: '/api/admin-center/users/batch-delete',
      usersExport: '/api/admin-center/users/export.xlsx',
      usersItemBase: '/api/admin-center/users',
      usersImport: '/api/admin-center/users/import',
      usersImportTemplate: '/api/admin-center/users/template.xlsx',
      securityGet: '/api/admin-center/security',
      securitySave: '/api/admin-center/security',
    },
  });
  assert.deepEqual(getDedicatedCenterConfig(AUDIT_CENTER_KEY), {
    key: 'audit-center',
    title: '聚信审计中心',
    subtitle: '负责审计日志、验签与导出',
    api: {
      logsList: '/api/audit-center/logs',
      logsVerify: '/api/audit-center/logs/verify',
      logsExport: '/api/audit-center/logs/export',
    },
  });
});

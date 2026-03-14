const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN_CENTER_KEY,
  AUDIT_CENTER_KEY,
  canAccessDedicatedCenter,
  defaultAppAccessByRole,
  getDedicatedCenterConfig,
  resolvePortalRedirectTarget,
} = require('../portal-routing');

test('sysadmin defaults to admin-center access', () => {
  assert.deepEqual(defaultAppAccessByRole('sysadmin'), ['admin-center']);
});

test('auditor defaults to audit-center access', () => {
  assert.deepEqual(defaultAppAccessByRole('auditor'), ['audit-center']);
});

test('sysadmin without requested system redirects to admin-center', () => {
  const target = resolvePortalRedirectTarget({
    apps: [
      { key: 'admin-center', url: 'http://localhost:5180/admin-center' },
      { key: 'reminder', url: 'http://localhost:8080' },
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
      { key: 'reminder', url: 'http://localhost:8080' },
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
      { key: 'reminder', url: 'http://localhost:8080' },
    ],
    userRole: 'sysadmin',
    requestedSystem: 'reminder',
    portalMode: '',
  });

  assert.deepEqual(target, { key: 'reminder', url: 'http://localhost:8080' });
});

test('sysadmin can access admin-center only', () => {
  assert.equal(canAccessDedicatedCenter({ role: 'sysadmin', systemKey: ADMIN_CENTER_KEY }), true);
  assert.equal(canAccessDedicatedCenter({ role: 'sysadmin', systemKey: AUDIT_CENTER_KEY }), false);
});

test('auditor can access audit-center only', () => {
  assert.equal(canAccessDedicatedCenter({ role: 'auditor', systemKey: AUDIT_CENTER_KEY }), true);
  assert.equal(canAccessDedicatedCenter({ role: 'auditor', systemKey: ADMIN_CENTER_KEY }), false);
});

test('dedicated center config exposes admin and audit metadata', () => {
  assert.deepEqual(getDedicatedCenterConfig(ADMIN_CENTER_KEY), {
    key: 'admin-center',
    title: '聚信管理后台',
    subtitle: '负责用户管理与安全管理',
    api: {
      usersList: '/api/admin-center/users',
      usersCreate: '/api/admin-center/users',
      usersItemBase: '/api/admin-center/users',
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

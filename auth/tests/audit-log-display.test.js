const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditRequestIpLabel,
  getAuditSystemLabel,
  formatAuditLogForDisplay,
} = require('../audit-log-display');

test('audit display helpers localize system, action and entity to chinese', () => {
  assert.equal(getAuditSystemLabel('sso'), '统一登录');
  assert.equal(getAuditSystemLabel('audit-center'), '审计中心');
  assert.equal(getAuditActionLabel('LOGIN'), '登录尝试');
  assert.equal(getAuditActionLabel('LOGIN_SUCCESS'), '登录成功');
  assert.equal(getAuditActionLabel('ENABLE_USER'), '启用用户');
  assert.equal(getAuditEntityLabel('auth'), '认证/登录');
  assert.equal(getAuditEntityLabel('send_configs'), '发送配置');
});

test('formatAuditLogForDisplay returns localized labels for audit rows', () => {
  const formatted = formatAuditLogForDisplay({
    id: 1,
    system: 'sso',
    username: 'auditor',
    action: 'LOGIN_FAILED',
    entity: 'auth',
    created_at: '2026-03-15 09:00:00',
  });

  assert.equal(formatted.systemLabel, '统一登录');
  assert.equal(formatted.actionLabel, '登录失败');
  assert.equal(formatted.entityLabel, '认证/登录');
});

test('audit display helpers distinguish login ip from generic source ip', () => {
  assert.equal(getAuditRequestIpLabel({ action: 'LOGIN_SUCCESS', entity: 'auth' }), '登录IP');
  assert.equal(getAuditRequestIpLabel({ action: 'MFA_VERIFY_FAILED', entity: 'user_mfa' }), '登录IP');
  assert.equal(getAuditRequestIpLabel({ action: 'UPDATE', entity: 'user' }), '来源IP');

  const formatted = formatAuditLogForDisplay({
    id: 2,
    system: 'sso',
    username: 'admin',
    action: 'LOGOUT',
    entity: 'auth',
    request_ip: '192.168.1.8',
    created_at: '2026-03-15 10:00:00',
  });

  assert.equal(formatted.requestIpLabel, '登录IP');
});

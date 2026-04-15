const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImportedUserPasswordEmail,
} = require('../admin-center-user-import-email');

test('buildImportedUserPasswordEmail returns chinese subject and password body', () => {
  const message = buildImportedUserPasswordEmail({
    username: 'zhangsan',
    initialPassword: 'Temp#2026Aa',
    loginUrl: 'http://localhost:5180/login',
  });

  assert.equal(message.subject, '聚信统一登录平台账号已开通');
  assert.match(message.message, /您好，zhangsan：/);
  assert.match(message.message, /初始密码：Temp#2026Aa/);
  assert.match(message.message, /登录入口：http:\/\/localhost:5180\/login/);
  assert.match(message.message, /登录后请尽快修改密码/);
});

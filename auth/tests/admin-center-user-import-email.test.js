const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImportedUserPasswordEmail,
  buildImportedUsersAdminSummaryEmail,
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

test('buildImportedUsersAdminSummaryEmail summarizes all imported credentials for admin', () => {
  const message = buildImportedUsersAdminSummaryEmail({
    loginUrl: 'http://localhost:5180/login',
    rows: [
      { username: 'zhangsan', email: 'zhangsan@example.com', initialPassword: 'Temp#2026Aa' },
      { username: 'lisi', email: 'lisi@example.com', initialPassword: 'Temp#2026Bb' },
    ],
  });

  assert.equal(message.subject, '聚信统一登录平台批量导入账号汇总');
  assert.match(message.message, /本次共导入成功 2 个用户/);
  assert.match(message.message, /1\. 账号：zhangsan/);
  assert.match(message.message, /邮箱：zhangsan@example\.com/);
  assert.match(message.message, /初始密码：Temp#2026Aa/);
  assert.match(message.message, /2\. 账号：lisi/);
  assert.match(message.message, /登录入口：http:\/\/localhost:5180\/login/);
});

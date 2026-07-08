const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeBigScreen } = require('../big-screen-authorization');

const user = (role, appAccess) => ({
  role,
  app_access: appAccess === undefined ? undefined : JSON.stringify(appAccess),
});

test('ordinary users can enter, read the catalog, and play screens', () => {
  for (const action of ['app:enter', 'catalog:read', 'screen:play']) {
    assert.deepEqual(authorizeBigScreen(user('user'), action), { allow: true });
  }
});

test('playlist editing is available to admin, editor, and reviewer roles', () => {
  for (const role of ['admin', 'editor', 'reviewer']) {
    assert.deepEqual(authorizeBigScreen(user(role), 'playlist:write'), { allow: true });
  }
  assert.equal(authorizeBigScreen(user('user'), 'playlist:write').allow, false);
});

test('template drafting and publishing are restricted to admin and editor roles', () => {
  for (const role of ['admin', 'editor']) {
    assert.deepEqual(authorizeBigScreen(user(role), 'template:draft'), { allow: true });
    assert.deepEqual(authorizeBigScreen(user(role), 'template:publish'), { allow: true });
  }
  assert.equal(authorizeBigScreen(user('reviewer'), 'template:publish').allow, false);
});

test('source administration is restricted to administrators', () => {
  assert.deepEqual(authorizeBigScreen(user('admin'), 'source:admin'), { allow: true });
  assert.equal(authorizeBigScreen(user('editor'), 'source:admin').allow, false);
});

test('dedicated center roles without big-screen portal access are denied', () => {
  assert.deepEqual(
    authorizeBigScreen(user('sysadmin', ['big-screen']), 'app:enter'),
    { allow: false, reason: '无权限访问统一大屏展示中心' }
  );
});

test('missing users and unsupported actions are denied with an explicit reason', () => {
  assert.deepEqual(authorizeBigScreen(null, 'app:enter'), { allow: false, reason: '未登录' });
  assert.deepEqual(
    authorizeBigScreen(user('user'), 'unknown'),
    { allow: false, reason: '当前角色无权执行该大屏操作' }
  );
});

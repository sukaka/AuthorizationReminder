const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('auth authorize route delegates unified big-screen actions', () => {
  assert.match(source, /require\(['"]\.\/big-screen-authorization['"]\)/);
  assert.match(source, /system === 'big-screen'/);
  assert.match(source, /result = authorizeBigScreen\(user, action\);/);
});

test('auth apps route exposes the unified big-screen portal entry', () => {
  assert.match(source, /APP_BIG_SCREEN_URL/);
  assert.match(source, /key: 'big-screen', name: '统一大屏展示中心'/);
  assert.match(source, /authorizeBigScreen\(user, 'app:enter'\)/);
});

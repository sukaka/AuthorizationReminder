const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('admin center user list exposes username or phone search controls', () => {
  assert.match(source, /id="adminUsersSearchForm"/);
  assert.match(source, /id="adminUsersSearchInput"[^>]*placeholder="按用户名或手机号搜索"/);
  assert.match(source, /id="adminUsersSearchResetBtn"/);
});

test('admin center user search sends the keyword to the list endpoint', () => {
  assert.match(source, /params\.set\('keyword', keyword\)/);
  assert.match(source, /adminUsersSearchForm'\)\?\.addEventListener\('submit', loadAdminUsers\)/);
  assert.match(source, /adminUsersSearchResetBtn'\)\?\.addEventListener\('click', resetAdminUsersSearch\)/);
  assert.match(
    source,
    /adminCenterUsersService\.listUsers\(\{\s*keyword: req\.query\?\.keyword,?\s*\}\)/
  );
});

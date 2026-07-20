const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('auth authorize route supports SCA system key', () => {
  assert.match(source, /const authorizeSca = \(user, action\) => \{/);
  assert.match(source, /system === 'sca'/);
  assert.match(source, /result = authorizeSca\(user, action\);/);
});

test('auth exposes the dedicated SCA login entry and branded portal', () => {
  assert.match(source, /app\.get\('\/sca-login'/);
  assert.match(source, /new URLSearchParams\(\{ system: 'sca' \}\)/);
  assert.match(source, /九章软件开源组件分析系统/);
  assert.match(source, /isScaPortal \? SCA_SYSTEM_DISPLAY_VERSION : DEDICATED_CENTER_VERSION/);
});

test('auth apps route exposes the 九章 SCA portal entry', () => {
  assert.match(source, /APP_SCA_URL/);
  assert.match(source, /key: 'sca', name: SCA_SYSTEM_DISPLAY_NAME/);
});

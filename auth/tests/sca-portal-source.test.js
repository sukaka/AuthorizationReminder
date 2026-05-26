const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('auth authorize route supports software composition analysis platform key', () => {
  assert.match(source, /const authorizeSca = \(user, action\) => \{/);
  assert.match(source, /system === 'sca'/);
  assert.match(source, /result = authorizeSca\(user, action\);/);
});

test('auth apps route exposes software composition analysis portal entry', () => {
  assert.match(source, /APP_SCA_URL/);
  assert.match(source, /key: 'sca', name: '软件成分分析平台'/);
});

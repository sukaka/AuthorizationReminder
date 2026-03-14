const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('portal login page renders dedicated release version badge', () => {
  assert.match(source, /聚信统一登录平台[\s\S]*DEDICATED_CENTER_VERSION/);
});

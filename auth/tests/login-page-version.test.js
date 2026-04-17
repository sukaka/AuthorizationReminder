const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const { version: packageVersion } = require('../package.json');

test('portal login page renders dedicated release version badge', () => {
  assert.match(source, /聚信统一登录平台[\s\S]*DEDICATED_CENTER_VERSION/);
});

test('dedicated release version comes from auth package version', () => {
  assert.match(source, /const \{ version: AUTH_PACKAGE_VERSION \} = require\('\.\/package\.json'\);/);
  assert.match(source, /const RELEASE_VERSION = AUTH_PACKAGE_VERSION;/);
  assert.match(packageVersion, /^\d+\.\d+\.\d+$/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');

test('license create and update accept customer_name payloads', () => {
  assert.match(source, /resolveLicenseCustomerId/);
  assert.match(source, /customer_name/);
  assert.match(source, /INSERT INTO customers \(name, juxin_sales, channel_sales\)/);
});

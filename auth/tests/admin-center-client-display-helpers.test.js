const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('admin center client script defines display helpers for system labels and summaries', () => {
  assert.match(source, /const systemDisplayOptions = \$\{JSON\.stringify\(SYSTEM_DISPLAY_OPTIONS\)\};/);
  assert.match(source, /function getSystemDisplayLabel\(key\)/);
  assert.match(source, /function getSystemDisplayShortLabel\(key\)/);
  assert.match(source, /function summarizeSystemAccess\(keys, maxVisible = 2\)/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');

test('logged-in users can read their own customer licenses by contact identity', () => {
  assert.match(source, /\/api\/my\/licenses/);
  assert.match(source, /contacts\.phone/);
  assert.match(source, /contacts\.email/);
  assert.match(source, /contacts\.wecom_id/);
  assert.match(source, /DATEDIFF\(licenses\.end_date, CURDATE\(\)\) AS days_left/);
});

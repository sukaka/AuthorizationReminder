const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const auditSource = fs.readFileSync(path.join(__dirname, '..', 'audit-center-logs.js'), 'utf8');

test('auth apps route exposes delivery and no longer lists ticketing or sec-impl', () => {
  assert.match(source, /const deliveryURL = process\.env\.APP_DELIVERY_URL \|\| 'http:\/\/localhost:8084'/);
  assert.match(source, /apps\.push\(\{ key: 'delivery', name: '交付系统', url: deliveryURL, allow: !!deliveryAuth\.allow \}\)/);
  assert.doesNotMatch(source, /apps\.push\(\{ key: 'ticketing'/);
  assert.doesNotMatch(source, /apps\.push\(\{ key: 'sec-impl'/);
});

test('auth authorize route supports delivery system key', () => {
  assert.match(source, /else if \(system === 'delivery'\) \{/);
  assert.match(source, /result = authorizeDelivery\(user, action, resource\);/);
});

test('audit center remote source maps delivery instead of sec-impl', () => {
  assert.match(auditSource, /delivery: Object\.freeze\(\{/);
  assert.match(auditSource, /listPath: '\/api\/delivery\/audit\/logs'/);
  assert.match(auditSource, /verifyPath: '\/api\/delivery\/audit\/verify'/);
});

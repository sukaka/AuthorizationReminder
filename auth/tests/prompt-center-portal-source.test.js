const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const auditSource = fs.readFileSync(path.join(__dirname, '..', 'audit-center-logs.js'), 'utf8');

test('auth authorize route supports prompt-center system key', () => {
  assert.match(source, /const authorizePromptCenter = \(user, action\) => \{/);
  assert.match(source, /system === 'prompt-center'/);
  assert.match(source, /result = authorizePromptCenter\(user, action\);/);
});

test('auth apps route exposes prompt center portal entry', () => {
  assert.match(source, /APP_PROMPT_CENTER_URL/);
  assert.match(source, /key: 'prompt-center', name: '提示词管理中心'/);
});

test('audit center remote source maps prompt center logs', () => {
  assert.match(auditSource, /'prompt-center': Object\.freeze\(\{/);
  assert.match(auditSource, /listPath: '\/api\/prompt-center\/audit\/logs'/);
});

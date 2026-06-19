const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'auth', 'index.js'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

test('unified auth authorize route supports the AI assistant system key', () => {
  assert.match(source, /const authorizeAiAssistant = \(user, action\) => \{/);
  assert.match(source, /system === 'ai-assistant'/);
  assert.match(source, /result = authorizeAiAssistant\(user, action\);/);
});

test('unified portal exposes the AI assistant entry', () => {
  assert.match(source, /APP_AI_ASSISTANT_URL/);
  assert.match(source, /key: 'ai-assistant', name: '聚信 AI 助手'/);
  assert.match(compose, /APP_AI_ASSISTANT_URL: "http:\/\/\$\{PUBLIC_HOST:-localhost\}:18093"/);
});

test('portal integration does not add a standalone AI assistant login route', () => {
  assert.doesNotMatch(source, /app\.(?:get|post)\('\/api\/ai-assistant\/(?:auth\/)?login'/);
  assert.doesNotMatch(compose, /APP_AI_ASSISTANT_LOGIN_URL/);
});

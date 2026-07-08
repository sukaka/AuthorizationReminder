const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'auth', 'index.js'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

test('unified auth authorize route supports the AI assistant system key', () => {
  assert.match(source, /require\('\.\/ai-assistant-authorization'\)/);
  assert.match(source, /system === 'ai-assistant'/);
  assert.match(source, /result = authorizeAiAssistant\(user, action, scope, resource\);/);
  assert.doesNotMatch(source, /const authorizeAiAssistant = \(user, action/);
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

test('AI assistant can force a true unified logout through the portal', () => {
  assert.match(source, /const isPortalLogoutRequest = portalLogoutValues\.has\(/);
  assert.match(source, /if \(isPortalLogoutRequest\) \{\s+clearAuthCookie\(res\);\s+clearCsrfCookie\(res\);/);
  assert.match(source, /function clearPortalSessionMarker\(\) \{/);
  assert.match(source, /sessionStorage\.removeItem\(portalSessionStorageKey\);/);
  assert.match(source, /if \(isPortalLogoutRequest\) \{\s+clearPortalSessionMarker\(\);/);
});

test('portal login prevents duplicate submissions from reusing an already consumed captcha', () => {
  assert.match(source, /let loginSubmitting = false;/);
  assert.match(source, /if \(loginSubmitting\) return;/);
  assert.match(source, /loginSubmitting = true;/);
  assert.match(source, /loginBtn\.textContent = '登录中…';/);
  assert.match(source, /loginSubmitting = false;/);
});

test('portal login surfaces unreachable AI assistant workspace after successful authentication', () => {
  assert.match(source, /function showPortalRedirecting\(appName, appUrl\) \{/);
  assert.match(source, /loginBtn\.textContent = '正在进入…';/);
  assert.match(source, /目标系统暂时不可用或未启动/);
  assert.match(source, /showPortalRedirecting\(preferred\.name, preferred\.url\);/);
  assert.match(source, /showPortalRedirecting\(target\.name, target\.url\);/);
});

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const compose = fs.readFileSync('docker-compose.yml', 'utf8');
const tauriConfig = fs.readFileSync(
  'juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json',
  'utf8',
);
const tauriCapability = fs.readFileSync(
  'juxin-ai-assistant/apps/desktop/src-tauri/capabilities/remote-main.json',
  'utf8',
);
const readme = fs.readFileSync('README.md', 'utf8');
const serverDockerfile = fs.readFileSync(
  'juxin-ai-assistant/server/Dockerfile',
  'utf8',
);

test('compose registers AI assistant against existing platform services', () => {
  assert.match(compose, /^  ai-assistant-db-init:/m);
  assert.match(compose, /^  ai-assistant-api:/m);
  assert.match(compose, /^  web-ai-assistant:/m);
  assert.match(compose, /^  prompt-center-ai-seed:/m);
  assert.match(compose, /MYSQL_DATABASE: juxin_ai_assistant/);
  assert.match(compose, /AUTH_SERVICE_URL: "http:\/\/auth:5180"/);
  assert.match(compose, /PROMPT_CENTER_URL: "http:\/\/prompt-center-api:5189"/);
  assert.match(compose, /PROMPT_CENTER_RUNTIME_TOKEN: \$\{PROMPT_CENTER_RUNTIME_TOKEN\}/);
  assert.match(compose, /seed-ai-assistant-prompts\.js/);
  assert.match(
    compose,
    /python scripts\/seed_catalog\.py --force-config --require-all-published/,
  );
  assert.doesNotMatch(compose, /ai-assistant-sqlite/);
});

test('AI assistant web remains an SSO workspace without child login credentials', () => {
  assert.match(compose, /APP_AI_ASSISTANT_URL:/);
  assert.doesNotMatch(compose, /AI_ASSISTANT_(DEFAULT_)?PASSWORD/);
  assert.doesNotMatch(compose, /AI_ASSISTANT_JWT/);
});

test('desktop opens the deployed local workspace with an exact remote capability', () => {
  assert.match(tauriConfig, /"url": "http:\/\/localhost:18093"/);
  assert.match(tauriCapability, /"urls": \["http:\/\/localhost:18093"\]/);
  assert.doesNotMatch(tauriConfig, /ai-assistant\.invalid/);
  assert.doesNotMatch(tauriCapability, /ai-assistant\.invalid/);
});

test('phase one operations document the strict idempotent seed command', () => {
  assert.match(readme, /AI_SEED_REQUIRE_PUBLISHED/);
  assert.match(readme, /python -m scripts\.seed/);
});

test('AI assistant image packages the complete employee catalog', () => {
  assert.match(serverDockerfile, /COPY catalog \.\/catalog/);
});

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
const envExample = fs.readFileSync('.env.example', 'utf8');
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
  const seedService = compose.split('\n  prompt-center-ai-seed:')[1].split('\n  web-prompt-center:')[0];
  assert.match(seedService, /pull_policy: never/);
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

test('AI assistant migration and runtime receive all required independent secrets', () => {
  const dbInitService = compose
    .split('\n  ai-assistant-db-init:')[1]
    .split('\n  ai-assistant-api:')[0];
  const apiService = compose
    .split('\n  ai-assistant-api:')[1]
    .split('\n  web-ai-assistant:')[0];

  assert.match(dbInitService, /AUDIT_HASH_SALT: \$\{AI_ASSISTANT_AUDIT_HASH_SALT\}/);
  assert.match(apiService, /AUDIT_HASH_SALT: \$\{AI_ASSISTANT_AUDIT_HASH_SALT\}/);
  assert.match(dbInitService, /AI_LOCAL_BINDING_SECRET: \$\{AI_LOCAL_BINDING_SECRET\}/);
  assert.match(apiService, /AI_LOCAL_BINDING_SECRET: \$\{AI_LOCAL_BINDING_SECRET\}/);
  assert.match(envExample, /^AI_LOCAL_BINDING_SECRET=.+$/m);
});

test('desktop keeps local dev separate from the generated exact HTTPS capability', () => {
  assert.match(tauriConfig, /"devUrl": "http:\/\/localhost:18093"/);
  assert.match(tauriConfig, /"url": "index\.html"/);
  assert.match(tauriCapability, /"urls": \["https:\/\/ai-assistant\.invalid\/\*"\]/);
  assert.doesNotMatch(tauriCapability, /http:\/\/localhost/);
  assert.doesNotMatch(tauriCapability, /https:\/\/\*/);
});

test('phase one operations document the strict idempotent seed command', () => {
  assert.match(readme, /AI_SEED_REQUIRE_PUBLISHED/);
  assert.match(readme, /python -m scripts\.seed/);
});

test('AI assistant image packages the complete employee catalog', () => {
  assert.match(serverDockerfile, /COPY server\/catalog \.\/catalog/);
});

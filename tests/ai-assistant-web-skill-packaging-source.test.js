const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const compose = fs.readFileSync('docker-compose.yml', 'utf8');
const serverDockerfile = fs.readFileSync(
  'juxin-ai-assistant/server/Dockerfile',
  'utf8',
);

test('AI assistant api image can package agent harness skills', () => {
  const dbInitService = compose
    .split('\n  ai-assistant-db-init:')[1]
    .split('\n  ai-assistant-api:')[0];
  const apiService = compose
    .split('\n  ai-assistant-api:')[1]
    .split('\n  web-ai-assistant:')[0];

  assert.match(dbInitService, /context: \.\/juxin-ai-assistant/);
  assert.match(dbInitService, /dockerfile: server\/Dockerfile/);
  assert.match(apiService, /context: \.\/juxin-ai-assistant/);
  assert.match(apiService, /dockerfile: server\/Dockerfile/);
  assert.match(serverDockerfile, /COPY agent-harness \.\/agent-harness/);
});

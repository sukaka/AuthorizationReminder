const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const compose = fs.readFileSync('docker-compose.yml', 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');

test('AI assistant API receives server-side model configuration without committing secrets', () => {
  const apiService = compose
    .split('\n  ai-assistant-api:')[1]
    .split('\n  web-ai-assistant:')[0];

  assert.match(apiService, /SERVER_MODEL_BASE_URL: \$\{AI_ASSISTANT_SERVER_MODEL_BASE_URL:-\}/);
  assert.match(apiService, /SERVER_MODEL_API_KEY: \$\{AI_ASSISTANT_SERVER_MODEL_API_KEY:-\}/);
  assert.match(apiService, /SERVER_MODEL_ID: \$\{AI_ASSISTANT_SERVER_MODEL_ID:-\}/);
  assert.match(apiService, /SERVER_MODEL_DISPLAY_NAME: \$\{AI_ASSISTANT_SERVER_MODEL_DISPLAY_NAME:-服务端模型\}/);

  assert.match(envExample, /^AI_ASSISTANT_SERVER_MODEL_BASE_URL=$/m);
  assert.match(envExample, /^AI_ASSISTANT_SERVER_MODEL_API_KEY=$/m);
  assert.match(envExample, /^AI_ASSISTANT_SERVER_MODEL_ID=$/m);
  assert.match(envExample, /^AI_ASSISTANT_SERVER_MODEL_DISPLAY_NAME=服务端模型$/m);
});

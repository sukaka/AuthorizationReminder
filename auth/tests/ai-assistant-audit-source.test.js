const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createAuditCenterLogsService } = require('../audit-center-logs');

const root = path.join(__dirname, '..', '..');
const authSource = fs.readFileSync(path.join(root, 'auth', 'index.js'), 'utf8');
const composeSource = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

const createService = (fetchJson) => createAuditCenterLogsService({
  db: {
    async query() {
      throw new Error('local db should not be used for AI assistant remote logs');
    },
  },
  computeAuditSignature: () => '',
  fetchJson,
  remoteBaseUrls: {
    'ai-assistant': 'http://ai-assistant-api:5193',
  },
});

test('audit center aggregates and normalizes AI assistant logs', async () => {
  const calls = [];
  const service = createService(async (url, options) => {
    calls.push({ url, options });
    return {
      items: [{
        id: 8,
        sso_user_id: 'user-7',
        username_snapshot: '张三',
        action: 'generation.complete',
        entity_type: 'generation',
        entity_uuid: 'generation-8',
        result: 'SUCCESS',
        metadata_json: { generation_uuid: 'generation-8' },
        created_at: '2026-06-20T10:00:00',
      }],
      total: 1,
    };
  });

  const result = await service.listLogs({
    query: {
      system: 'ai-assistant',
      username: '张三',
      action: 'generation.complete',
      entity: 'generation',
      date_from: '2026-06-01',
      date_to: '2026-06-30',
      limit: 800,
    },
    authToken: 'audit-token',
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^http:\/\/ai-assistant-api:5193\/api\/ai\/admin\/audit-logs\?/);
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get('limit'), '500');
  assert.equal(query.get('username'), '张三');
  assert.equal(query.get('action'), 'generation.complete');
  assert.equal(query.get('entity'), 'generation');
  assert.equal(query.get('date_from'), '2026-06-01');
  assert.equal(query.get('date_to'), '2026-06-30');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer audit-token');
  assert.equal(result.matchedTotal, 1);
  assert.deepEqual(result.items[0], {
    id: 8,
    user_id: 'user-7',
    user_sub: 'user-7',
    username: '张三',
    user_role: '',
    system: 'ai-assistant',
    action: 'generation.complete',
    entity: 'generation',
    entity_id: 'generation-8',
    message: '',
    before_data: null,
    after_data: { generation_uuid: 'generation-8', result: 'SUCCESS' },
    prev_hash: null,
    signature: null,
    sign_version: null,
    request_ip: null,
    created_at: '2026-06-20 10:00:00',
  });
});

test('AI assistant audit source failures stay isolated', async () => {
  const service = createService(async () => {
    throw new Error('AI assistant unavailable');
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await service.listLogs({ query: { system: 'ai-assistant' } });
    assert.deepEqual(result.items, []);
    assert.equal(result.matchedTotal, 0);
    assert.equal(result.matchedTotalIsExact, false);
  } finally {
    console.warn = originalWarn;
  }
});

test('auth compose config registers the AI assistant audit source', () => {
  assert.match(authSource, /'ai-assistant': process\.env\.AUDIT_SOURCE_AI_ASSISTANT_URL/);
  assert.match(composeSource, /AUDIT_SOURCE_AI_ASSISTANT_URL: "http:\/\/ai-assistant-api:5193"/);
  const serviceSource = composeSource.split('\n  ai-assistant-api:')[1].split('\n  web-ai-assistant:')[0];
  assert.match(serviceSource, /AUDIT_HASH_SALT: \$\{AI_ASSISTANT_AUDIT_HASH_SALT\}/);
});

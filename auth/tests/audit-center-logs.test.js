const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAuditCenterLogsService,
  serializeLogsAsCsv,
} = require('../audit-center-logs');

test('listLogs queries across systems by default', async () => {
  const calls = [];
  const service = createAuditCenterLogsService({
    db: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return [];
      },
    },
    computeAuditSignature: () => '',
  });

  const result = await service.listLogs({
    query: {
      username: 'alice',
      limit: 50,
    },
  });

  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0].sql, /log_system = \?/);
  assert.match(calls[0].sql, /SELECT COUNT\(\*\) AS total_count/);
  assert.deepEqual(calls[0].params, ['%alice%']);
  assert.deepEqual(calls[1].params, ['%alice%', 50]);
  assert.deepEqual(result, {
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
    matchedTotal: 0,
    matchedTotalIsExact: true,
    totalPages: 0,
    hasMore: false,
    systems: 0,
    queryLimit: 50,
  });
});

test('listLogs merges local and remote audit sources and sorts by time desc', async () => {
  const fetchCalls = [];
  const service = createAuditCenterLogsService({
    db: {
      async query() {
        return [
          {
            id: 101,
            user_id: 1,
            username: 'alice',
            system: 'sso',
            action: 'LOGIN_SUCCESS',
            entity: 'auth',
            entity_id: null,
            request_ip: '127.0.0.1',
            created_at: '2026-03-15 10:00:00',
          },
        ];
      },
    },
    computeAuditSignature: () => '',
    fetchJson: async (url, options) => {
      fetchCalls.push({ url, options });
      return [
        {
          id: 9,
          user_id: 8,
          username: 'bob',
          action: 'STOCK_IN_CREATE',
          entity: 'stock_in_order',
          entity_id: 77,
          request_ip: '10.0.0.8',
          created_at: '2026-03-15 11:00:00',
        },
      ];
    },
    remoteBaseUrls: {
      inventory: 'http://inventory-api:5183',
    },
  });

  const result = await service.listLogs({
    query: { limit: 20 },
    authToken: 'token-123',
  });

  assert.deepEqual(
    result.items.map((row) => ({ system: row.system, id: row.id, username: row.username })),
    [
      { system: 'inventory', id: 9, username: 'bob' },
      { system: 'sso', id: 101, username: 'alice' },
    ]
  );
  assert.equal(result.total, 2);
  assert.equal(result.matchedTotal, 2);
  assert.equal(result.matchedTotalIsExact, true);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 10);
  assert.equal(result.totalPages, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.systems, 2);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /^http:\/\/inventory-api:5183\/api\/operation-logs\?/);
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer token-123');
});

test('listLogs only fetches the requested remote system', async () => {
  let dbCalls = 0;
  const fetchCalls = [];
  const service = createAuditCenterLogsService({
    db: {
      async query() {
        dbCalls += 1;
        return [];
      },
    },
    computeAuditSignature: () => '',
    fetchJson: async (url) => {
      fetchCalls.push(url);
      return [];
    },
    remoteBaseUrls: {
      inventory: 'http://inventory-api:5183',
      faq: 'http://faq-api:5186',
    },
  });

  const result = await service.listLogs({
    query: { system: 'inventory', limit: 30 },
    authToken: 'token-123',
  });

  assert.equal(dbCalls, 0);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /^http:\/\/inventory-api:5183\/api\/operation-logs\?/);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 10);
  assert.equal(result.queryLimit, 30);
});

test('listLogs paginates merged rows with 10 items per page by default', async () => {
  const service = createAuditCenterLogsService({
    db: {
      async query() {
        return Array.from({ length: 25 }, (_item, index) => {
          const id = index + 1;
          return {
            id,
            user_id: id,
            username: `user-${id}`,
            system: 'sso',
            action: 'LOGIN_SUCCESS',
            entity: 'auth',
            entity_id: null,
            request_ip: '127.0.0.1',
            created_at: `2026-03-15 10:00:${String(id).padStart(2, '0')}`,
          };
        });
      },
    },
    computeAuditSignature: () => '',
  });

  const result = await service.listLogs({
    query: { limit: 25, page: 2 },
  });

  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 10);
  assert.equal(result.total, 25);
  assert.equal(result.matchedTotal, 25);
  assert.equal(result.matchedTotalIsExact, true);
  assert.equal(result.totalPages, 3);
  assert.equal(result.hasMore, true);
  assert.equal(result.systems, 1);
  assert.equal(result.queryLimit, 25);
  assert.deepEqual(
    result.items.map((row) => row.id),
    [15, 14, 13, 12, 11, 10, 9, 8, 7, 6]
  );
});

test('listLogs reports lower-bound total when remote source does not expose exact count beyond query limit', async () => {
  const service = createAuditCenterLogsService({
    db: {
      async query() {
        return [];
      },
    },
    computeAuditSignature: () => '',
    fetchJson: async () => Array.from({ length: 5 }, (_item, index) => ({
      id: index + 1,
      username: `remote-${index + 1}`,
      action: 'LOGIN_SUCCESS',
      entity: 'auth',
      request_ip: '10.0.0.1',
      created_at: `2026-03-15 10:00:0${index + 1}`,
    })),
    remoteBaseUrls: {
      inventory: 'http://inventory-api:5183',
    },
  });

  const result = await service.listLogs({
    query: { system: 'inventory', limit: 5 },
    authToken: 'token-123',
  });

  assert.equal(result.total, 5);
  assert.equal(result.matchedTotal, 5);
  assert.equal(result.matchedTotalIsExact, false);
});

test('verifyLogChain validates signature chain', async () => {
  const rows = [
    { id: 1, user_id: 1, username: 'a', action: 'LOGIN', entity: 'auth', entity_id: 0, before_data: '', after_data: '', prev_hash: null, signature: 'sig-1', created_at: '2026-03-14 10:00:00' },
    { id: 2, user_id: 1, username: 'a', action: 'UPDATE', entity: 'user', entity_id: 2, before_data: '', after_data: '', prev_hash: 'sig-1', signature: 'sig-2', created_at: '2026-03-14 10:01:00' },
  ];
  const service = createAuditCenterLogsService({
    db: {
      async query() {
        return rows;
      },
    },
    computeAuditSignature({ id }) {
      return `sig-${id}`;
    },
  });

  const result = await service.verifyLogChain({ limitInput: 100 });

  assert.deepEqual(result, {
    ok: true,
    checked: 2,
    latest_id: 2,
    reason: '',
  });
});

test('verifyLogChain delegates to supported remote systems and blocks cross-system verification', async () => {
  const service = createAuditCenterLogsService({
    db: {
      async query() {
        throw new Error('local db should not be used for remote verify');
      },
    },
    computeAuditSignature: () => '',
    fetchJson: async (url) => {
      assert.match(url, /^http:\/\/device-flow-api:5184\/api\/device-flow\/audit\/verify\?limit=120$/);
      return {
        passed: true,
        total_checked: 12,
        issue_count: 0,
      };
    },
    remoteBaseUrls: {
      'device-flow': 'http://device-flow-api:5184',
    },
  });

  const delegated = await service.verifyLogChain({
    system: 'device-flow',
    limitInput: 120,
    authToken: 'token-123',
  });

  assert.deepEqual(delegated, {
    ok: true,
    checked: 12,
    latest_id: 0,
    reason: '',
  });

  const crossSystem = await service.verifyLogChain({
    limitInput: 120,
    authToken: 'token-123',
  });

  assert.deepEqual(crossSystem, {
    ok: false,
    checked: 0,
    latest_id: 0,
    reason: '跨系统汇总视图暂不支持统一验签，请先筛选单个系统后再校验审计链',
  });
});

test('serializeLogsAsCsv exports localized csv headers and values', () => {
  const csv = serializeLogsAsCsv([
    {
      id: 9,
      system: 'sso',
      username: 'alice',
      action: 'UPDATE',
      entity: 'user',
      entity_id: 3,
      request_ip: '127.0.0.1',
      created_at: '2026-03-14 12:00:00',
      prev_hash: 'sig-8',
      signature: 'sig-9',
      before_data: '{"role":"user"}',
      after_data: '{"role":"sysadmin"}',
    },
  ]);

  assert.match(csv, /^ID,系统,用户,动作,对象,对象ID,IP地址,时间,前一条签名,当前签名,变更前,变更后\n/);
  assert.match(csv, /"统一登录"/);
  assert.match(csv, /"更新"/);
  assert.match(csv, /"用户"/);
  assert.match(csv, /"alice"/);
  assert.match(csv, /"sig-9"/);
  assert.match(csv, /"\{""role"":""sysadmin""\}"/);
});

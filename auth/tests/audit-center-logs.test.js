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

  await service.listLogs({
    query: {
      username: 'alice',
      limit: 50,
    },
  });

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /log_system = \?/);
  assert.deepEqual(calls[0].params, ['%alice%', 50]);
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

test('serializeLogsAsCsv exports quoted csv rows', () => {
  const csv = serializeLogsAsCsv([
    {
      id: 9,
      system: 'auth',
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

  assert.match(csv, /^id,system,username,action,entity,entity_id,request_ip,created_at,prev_hash,signature,before_data,after_data\n/);
  assert.match(csv, /"alice"/);
  assert.match(csv, /"sig-9"/);
  assert.match(csv, /"\{""role"":""sysadmin""\}"/);
});

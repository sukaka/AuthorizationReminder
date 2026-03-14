const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdminCenterSecurityService,
} = require('../admin-center-security');

test('getSecurity returns stored security config only', async () => {
  const service = createAdminCenterSecurityService({
    db: {
      async query(sql) {
        assert.match(sql, /SELECT `key`, value FROM send_configs/);
        return [
          { key: 'security', value: JSON.stringify({ passwordPolicy: { minLength: 14 } }) },
          { key: 'email', value: JSON.stringify({ host: 'smtp.example.com' }) },
        ];
      },
    },
  });

  const security = await service.getSecurity();

  assert.deepEqual(security, { passwordPolicy: { minLength: 14 } });
});

test('saveSecurity upserts security config and writes audit log', async () => {
  const writes = [];
  const operations = [];
  const service = createAdminCenterSecurityService({
    db: {
      async query() {
        return [
          { key: 'security', value: JSON.stringify({ session: { timeoutMinutes: 720 } }) },
          { key: 'email', value: JSON.stringify({ host: 'smtp.example.com' }) },
        ];
      },
      async transaction(callback) {
        const trx = {
          async run(sql, params = []) {
            writes.push({ sql, params });
          },
        };
        await callback(trx);
      },
    },
    logOperation: async (payload) => { operations.push(payload); },
  });

  const result = await service.saveSecurity({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    payload: {
      passwordPolicy: { minLength: 16 },
      roleIpAllowlist: { auditor: ['10.0.0.0/24'] },
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].params[0], 'security');
  assert.match(String(writes[0].params[1]), /minLength/);
  assert.equal(operations[0].action, 'UPDATE');
  assert.equal(operations[0].entity, 'send_configs');
});

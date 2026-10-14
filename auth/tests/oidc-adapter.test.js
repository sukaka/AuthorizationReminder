const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createOidcAdapter } = require('../oidc-adapter');

test('encrypted artifacts authenticate their model and id, including alternate lookups', async () => {
  let row;
  const db = {
    async run(_sql, p) { row = { id: p[1], payload: p[2], consumed: p[7] }; return { affectedRows: 1 }; },
    async get() { return row; },
  };
  const Adapter = createOidcAdapter(db, crypto.randomBytes(32));
  const codes = new Adapter('AuthorizationCode');
  await codes.upsert('one', { grantId: 'grant', uid: 'uid', secret: 'ephemeral-test-value' }, 60);
  assert.ok(!row.payload.includes('ephemeral-test-value'));
  assert.equal((await codes.find('one')).grantId, 'grant');
  assert.equal((await codes.findByUid('uid')).grantId, 'grant');
  row.id = 'two';
  await assert.rejects(codes.find('two'));
});

test('atomic consumption rejects a second concurrent consumer', async () => {
  let consumed = false;
  const db = { async run(sql) {
    assert.match(sql, /consumed IS NULL AND expires_at>\?/);
    if (consumed) return { affectedRows: 0 };
    consumed = true;
    return { affectedRows: 1 };
  } };
  const Adapter = createOidcAdapter(db, crypto.randomBytes(32));
  const results = await Promise.allSettled([new Adapter('AuthorizationCode').consume('one'), new Adapter('AuthorizationCode').consume('one')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.error, 'invalid_grant');
});

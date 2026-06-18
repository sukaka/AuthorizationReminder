const assert = require('node:assert/strict');
const test = require('node:test');

const { buildJobVisibilityScope } = require('../src/job-visibility');

test('admin can read all jobs without a visibility predicate', () => {
  assert.deepEqual(
    buildJobVisibilityScope({ actor: { sub: '1', role: 'ADMIN' }, jobAlias: 'j' }),
    { sql: '', params: [] }
  );
});

test('non-admin users are scoped to jobs they created or were designated to second-sign', () => {
  const scope = buildJobVisibilityScope({ actor: { sub: '5', role: 'user' }, jobAlias: 'job' });

  assert.match(scope.sql, /job\.created_by_sub = \?/);
  assert.match(scope.sql, /visibility_ds\.expected_second_signer_sub = \?/);
  assert.match(scope.sql, /visibility_ds\.second_signer_sub = \?/);
  assert.doesNotMatch(scope.sql, /status/i);
  assert.deepEqual(scope.params, ['5', '5', '5']);
});

test('sysadmin uses the same restricted visibility scope as other non-admin users', () => {
  const scope = buildJobVisibilityScope({ actor: { sub: 8, role: 'sysadmin' } });

  assert.match(scope.sql, /j\.created_by_sub = \?/);
  assert.deepEqual(scope.params, ['8', '8', '8']);
});

test('non-admin visibility requires an authenticated user id', () => {
  assert.throws(
    () => buildJobVisibilityScope({ actor: { sub: '', role: 'user' } }),
    /authenticated user id is required/
  );
});


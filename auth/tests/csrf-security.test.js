const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCsrfTokenValid,
} = require('../csrf-security');

test('isCsrfTokenValid only accepts exact cookie and header matches', () => {
  assert.equal(isCsrfTokenValid({ cookieToken: '', headerToken: '' }), false);
  assert.equal(isCsrfTokenValid({ cookieToken: 'abc', headerToken: '' }), false);
  assert.equal(isCsrfTokenValid({ cookieToken: '', headerToken: 'abc' }), false);
  assert.equal(isCsrfTokenValid({ cookieToken: 'abc', headerToken: 'xyz' }), false);
  assert.equal(isCsrfTokenValid({ cookieToken: 'abc', headerToken: 'abc' }), true);
});

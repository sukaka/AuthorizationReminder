const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHelmetCspDirectives,
} = require('../../server/helmet-csp');

test('auth CSP disables upgrade-insecure-requests for http deployments', () => {
  const directives = buildHelmetCspDirectives({
    withNonce: true,
  });

  assert.equal(directives.upgradeInsecureRequests, null);
  assert.deepEqual(directives.connectSrc, ["'self'"]);
  assert.equal(typeof directives.scriptSrc[1], 'function');
});

test('api CSP disables upgrade-insecure-requests without nonce requirement', () => {
  const directives = buildHelmetCspDirectives();

  assert.equal(directives.upgradeInsecureRequests, null);
  assert.deepEqual(directives.scriptSrc, ["'self'"]);
});

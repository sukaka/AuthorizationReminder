const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isOriginAllowedForRequest,
} = require('../../server/cors-origin');

test('allows configured origins', () => {
  const ok = isOriginAllowedForRequest({
    origin: 'http://localhost:5180',
    headers: { host: 'localhost:5180' },
    allowedOrigins: ['http://localhost:5180'],
  });

  assert.equal(ok, true);
});

test('allows same-host origins across ports for deployed public hosts', () => {
  const ok = isOriginAllowedForRequest({
    origin: 'http://8.141.81.201:18080',
    headers: { host: '8.141.81.201:5179' },
    allowedOrigins: ['http://localhost:18080'],
  });

  assert.equal(ok, true);
});

test('rejects unrelated public origins', () => {
  const ok = isOriginAllowedForRequest({
    origin: 'http://malicious.example.com',
    headers: { host: '8.141.81.201:5179' },
    allowedOrigins: ['http://localhost:18080'],
  });

  assert.equal(ok, false);
});

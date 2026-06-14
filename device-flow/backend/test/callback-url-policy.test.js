const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSafeCallbackUrl,
  isBlockedIpAddress,
  parseAllowedHosts,
} = require('../src/callback-url-policy');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('rejects URL credentials and cloud metadata hosts', async () => {
  await assert.rejects(
    () => assertSafeCallbackUrl('https://user:pass@example.com/hook', { lookup: publicLookup }),
    /不能包含用户名或密码/
  );
  await assert.rejects(
    () => assertSafeCallbackUrl('http://metadata.google.internal/computeMetadata/v1', { lookup: publicLookup }),
    /禁止访问的地址/
  );
});

test('rejects private, loopback, link-local and mapped IPv4 addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.2.3.4',
    '172.16.1.2',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isBlockedIpAddress(address), true, address);
  }
});

test('rejects a hostname when any DNS answer is private', async () => {
  const lookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.8', family: 4 },
  ];

  await assert.rejects(
    () => assertSafeCallbackUrl('https://hooks.example.com/events', { lookup }),
    /禁止访问的地址/
  );
});

test('accepts public addresses and exact allowlisted private hosts', async () => {
  const publicUrl = await assertSafeCallbackUrl('https://hooks.example.com/events', {
    lookup: publicLookup,
  });
  assert.equal(publicUrl.toString(), 'https://hooks.example.com/events');

  const allowedHosts = parseAllowedHosts('internal-hooks.example,10.20.30.40');
  const privateLookup = async () => [{ address: '10.20.30.40', family: 4 }];
  const privateUrl = await assertSafeCallbackUrl('http://internal-hooks.example/callback', {
    allowedHosts,
    lookup: privateLookup,
  });
  assert.equal(privateUrl.hostname, 'internal-hooks.example');
});

test('does not treat subdomains as allowlisted exact hosts', async () => {
  const allowedHosts = parseAllowedHosts('internal.example');
  const privateLookup = async () => [{ address: '10.20.30.40', family: 4 }];

  await assert.rejects(
    () =>
      assertSafeCallbackUrl('http://child.internal.example/callback', {
        allowedHosts,
        lookup: privateLookup,
      }),
    /禁止访问的地址/
  );
});

test('normalizes DNS lookup failures without exposing resolver details', async () => {
  const lookup = async () => {
    const error = new Error('getaddrinfo ENOTFOUND secret.internal');
    error.code = 'ENOTFOUND';
    throw error;
  };

  await assert.rejects(
    () => assertSafeCallbackUrl('https://missing.example/callback', { lookup }),
    /^Error: callback_url 主机无法解析$/
  );
});

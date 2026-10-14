const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readOidcConfig } = require('../oidc-config');

function environment() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = privateKey.export({ format: 'jwk' });
  return {
    OIDC_ENABLED: 'true', OIDC_ISSUER: 'https://login.example.test/oidc',
    OIDC_JWKS_JSON: JSON.stringify({ keys: [{ ...key, kid: 'test', use: 'sig', alg: 'RS256' }] }),
    OIDC_COOKIE_KEYS_JSON: JSON.stringify([crypto.randomBytes(32).toString('base64url')]),
    OIDC_STORAGE_KEY: crypto.randomBytes(32).toString('base64'),
    OIDC_CLIENTS_JSON: JSON.stringify([{ client_id: 'assistant', client_secret: crypto.randomBytes(32).toString('base64url'), system_key: 'ai-assistant', redirect_uris: ['https://assistant.example.test/callback'] }]),
  };
}

test('disabled provider needs no keys', () => assert.equal(readOidcConfig({}).enabled, false));
test('valid confidential client only supports code and PKCE', () => {
  const cfg = readOidcConfig(environment());
  assert.deepEqual(cfg.clients[0].grant_types, ['authorization_code']);
  assert.deepEqual(cfg.clients[0].response_types, ['code']);
  assert.equal(cfg.clients[0].token_endpoint_auth_method, 'client_secret_basic');
});
test('fail closed for insecure or ambiguous configuration', () => {
  for (const change of [
    { OIDC_ISSUER: 'http://login.example.test/oidc' },
    { OIDC_ISSUER: 'https://login.example.test/other' },
    { OIDC_STORAGE_KEY: 'short' }, { OIDC_JWKS_JSON: '{}' },
    { OIDC_COOKIE_KEYS_JSON: '["short"]' },
    { OIDC_CLIENTS_JSON: '[{"client_id":"x","system_key":"ai-assistant","redirect_uris":["https://*.example.test/cb"]}]' },
    { OIDC_ENABLED: 'yes' },
  ]) assert.throws(() => readOidcConfig({ ...environment(), ...change }));
});
test('public clients cannot enable implicit/password grants or external HTTP', () => {
  const env = environment();
  const client = { client_id: 'desktop', system_key: 'ai-assistant', token_endpoint_auth_method: 'none', redirect_uris: ['http://127.0.0.1:54321/callback'] };
  env.OIDC_CLIENTS_JSON = JSON.stringify([client]);
  assert.equal(readOidcConfig(env).clients[0].token_endpoint_auth_method, 'none');
  for (const change of [{ grant_types: ['password'] }, { response_types: ['token'] }, { redirect_uris: ['http://example.test/callback'] }]) {
    assert.throws(() => readOidcConfig({ ...env, OIDC_CLIENTS_JSON: JSON.stringify([{ ...client, ...change }]) }));
  }
});

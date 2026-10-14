const test = require('node:test');
const assert = require('node:assert/strict');
const { readRpConfig, verifyIdToken, createRpService } = require('../oidc-rp');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

const secret = crypto.randomBytes(32).toString('base64url');
const client = { client_id: 'exam', client_secret: secret, token_endpoint_auth_method: 'client_secret_basic', redirect_uris: ['https://exam.example.test/api/oidc/train-exam/callback'] };
const config = { enabled: true, issuer: 'https://login.example.test/oidc', clients: [client], systems: new Map([['exam', 'train-exam']]) };
const env = { OIDC_RP_APPS_JSON: JSON.stringify([{ system: 'train-exam', client_id: 'exam', app_url: 'https://exam.example.test/' }]) };

test('RP config limits migration to two apps and exact registered same-origin callback', () => {
  const apps = readRpConfig(config, env);
  assert.equal(apps.get('train-exam').cookieName, '__Secure-juxin_oidc_train_exam');
  assert.equal(readRpConfig({ enabled: false }, {}).size, 0);
  assert.throws(() => readRpConfig(config, { ...env, OIDC_RP_REQUIRED_SYSTEMS: 'train-exam,ai-assistant' }));
  assert.throws(() => readRpConfig({ enabled: false }, { OIDC_RP_REQUIRED_SYSTEMS: 'train-exam' }));
  assert.equal(readRpConfig(config, { ...env, OIDC_RP_REQUIRED_SYSTEMS: 'train-exam' }).size, 1);
  for (const change of [{ system: 'faq' }, { app_url: 'http://exam.example.test/' }, { client_id: 'wrong' }, { app_url: 'https://evil.example.test/' }, { app_url: 'https://exam.example.test/?token=x' }]) {
    assert.throws(() => readRpConfig(config, { OIDC_RP_APPS_JSON: JSON.stringify([{ system: 'train-exam', client_id: 'exam', app_url: 'https://exam.example.test/', ...change }]) }));
  }
});

test('ID token requires trusted RS256 key, issuer, audience, nonce, subject and expiration', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
  const cfg = { ...config, jwks: { keys: [jwk] } };
  const sign = (extra = {}, options = {}) => jwt.sign({ sub: '7', nonce: 'nonce', ...extra }, privateKey, { algorithm: 'RS256', keyid: 'test', issuer: cfg.issuer, audience: 'exam', expiresIn: 60, ...options });
  assert.equal(verifyIdToken(sign(), cfg, client, 'nonce').sub, '7');
  for (const token of [sign({ nonce: 'wrong' }), sign({}, { audience: 'other' }), sign({}, { issuer: 'https://evil.test/oidc' }), sign({}, { expiresIn: -60 }), sign({ sub: '' })]) {
    assert.throws(() => verifyIdToken(token, cfg, client, 'nonce'));
  }
});

test('RP session lookup never accepts another application or expired session', async () => {
  const rows = new Map();
  class Adapter { async find(id) { return rows.get(id); } async destroy(id) { rows.delete(id); } }
  const service = createRpService({ config, apps: readRpConfig(config, env), Adapter });
  rows.set('rp_handle', { system: 'train-exam', clientId: 'exam', accessToken: 'opaque', expiresAt: Math.floor(Date.now() / 1000) + 300, deadline: Math.floor(Date.now() / 1000) + 600 });
  assert.equal(await service.resolve('rp_handle', 'ai-assistant'), null);
  assert.equal(await service.resolve('rp_handle', 'train-exam'), 'opaque');
  rows.get('rp_handle').deadline = 1;
  assert.equal(await service.resolve('rp_handle', 'train-exam'), null);
});

test('RP renewal forwards the current browser IP to retain portal IP restrictions', async () => {
  let outgoing;
  const rows = new Map();
  class Adapter {
    async find(id) { return rows.get(id); }
    async upsert(id, value) { rows.set(id, value); }
    async destroy(id) { rows.delete(id); }
  }
  const service = createRpService({ config, apps: readRpConfig(config, env), Adapter, fetcher: async (_url, options) => {
    outgoing = options;
    return { ok: true, json: async () => ({ access_token: 'renewed', token_type: 'Bearer', expires_in: 900 }) };
  } });
  rows.set('rp_test', { system: 'train-exam', clientId: 'exam', accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1, deadline: Math.floor(Date.now() / 1000) + 600 });
  assert.equal(await service.resolve('rp_test', 'train-exam', '192.0.2.7'), 'renewed');
  assert.equal(outgoing.headers['X-Forwarded-For'], '192.0.2.7');
});

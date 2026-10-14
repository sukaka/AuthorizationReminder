const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createOidcService } = require('../oidc-service');

test('discovery, PKCE, single-use code, userinfo and source-session revocation', async (t) => {
  const records = new Map();
  class Adapter {
    constructor(name) { this.name = name; }
    key(id) { return `${this.name}:${id}`; }
    async upsert(id, value, ttl) { records.set(this.key(id), { ...value, _expiry: Date.now() + ttl * 1000 }); }
    async find(id) { const value = records.get(this.key(id)); return value?._expiry > Date.now() ? { ...value } : undefined; }
    async findByUid(uid) { return [...records.values()].find((v) => v.uid === uid && v._expiry > Date.now()); }
    async destroy(id) { records.delete(this.key(id)); }
    async consume(id) { const v = records.get(this.key(id)); assert.ok(v && !v.consumed); v.consumed = Math.floor(Date.now() / 1000); }
    async revokeByGrantId(id) { for (const [k, v] of records) if (v.grantId === id) records.delete(k); }
  }
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const client = { client_id: 'desktop', token_endpoint_auth_method: 'none', application_type: 'native', redirect_uris: ['http://127.0.0.1:39999/callback'], grant_types: ['authorization_code'], response_types: ['code'] };
  const web = { client_id: 'web', client_secret: crypto.randomBytes(32).toString('base64url'), token_endpoint_auth_method: 'client_secret_basic', application_type: 'web', redirect_uris: ['https://web.example.test/callback'], grant_types: ['authorization_code'], response_types: ['code'] };
  let active = true;
  const identity = { accountId: '7', sub: '7', sessionId: 'test-session', username: 'tester', role: 'member', apps: ['ai-assistant'], authenticatedAt: Math.floor(Date.now() / 1000) };
  const service = await createOidcService({
    config: { issuer: `${origin}/oidc`, clients: [client, web], systems: new Map([['desktop', 'ai-assistant'], ['web', 'ai-assistant']]), jwks: { keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'test', use: 'sig', alg: 'RS256' }] }, cookieKeys: [crypto.randomBytes(32).toString('base64url')] },
    Adapter, resolveBrowser: async () => active ? identity : null,
    resolveAccount: async (accountId, _req, clientId, sessionId) => {
      assert.equal(accountId, '7');
      assert.ok(['desktop', 'web'].includes(clientId));
      assert.equal(sessionId, identity.sessionId);
      return active ? identity : null;
    },
  });
  app.use('/oidc', service.router);
  const discovery = await (await fetch(`${origin}/oidc/.well-known/openid-configuration`)).json();
  assert.equal(discovery.issuer, `${origin}/oidc`);
  assert.deepEqual(discovery.response_types_supported, ['code']);
  assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
  const jwks = await (await fetch(discovery.jwks_uri)).json();
  assert.ok(jwks.keys[0].n);
  assert.equal(jwks.keys[0].d, undefined);
  const jar = new Map();
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, redirect: 'manual', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...options.headers } });
    for (const item of response.headers.getSetCookie()) { const [pair] = item.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    return response;
  }
  const verifier = crypto.randomBytes(32).toString('base64url');
  async function authorize(extra = {}) {
    const query = new URLSearchParams({ client_id: 'desktop', response_type: 'code', redirect_uri: client.redirect_uris[0], scope: 'openid profile', state: 'test-state', nonce: 'test-nonce', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...extra });
    let response = await request(`${discovery.authorization_endpoint}?${query}`);
    for (let i = 0; i < 8; i++) {
      const location = response.headers.get('location');
      assert.ok(location, `authorization stopped at ${response.status}: ${await response.text()}`);
      const next = new URL(location, origin);
      if (next.origin !== origin) return next;
      response = await request(next.href);
    }
    throw new Error('authorization redirect loop');
  }
  const denied = await authorize({ code_challenge_method: 'plain' });
  assert.equal(denied.searchParams.get('error'), 'invalid_request');
  const noPkce = await authorize({ code_challenge: '', code_challenge_method: '' });
  assert.equal(noPkce.searchParams.get('error'), 'invalid_request');
  const badRedirect = await request(`${discovery.authorization_endpoint}?${new URLSearchParams({ client_id: 'desktop', response_type: 'code', redirect_uri: 'https://unregistered.example.test/callback', scope: 'openid' })}`);
  assert.equal(badRedirect.status, 400);
  assert.equal(badRedirect.headers.get('location'), null, 'unregistered redirect is never followed');
  const callback = await authorize();
  assert.equal(callback.searchParams.get('state'), 'test-state');
  const code = callback.searchParams.get('code');
  assert.ok(code);
  const exchange = (v = verifier, authorizationCode = code) => request(discovery.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'desktop', redirect_uri: client.redirect_uris[0], code: authorizationCode, code_verifier: v }) });
  assert.equal((await exchange('invalid-verifier')).status, 400);
  const tokenResponse = await exchange();
  const tokens = await tokenResponse.json();
  assert.equal(tokenResponse.status, 200, JSON.stringify(tokens));
  const { jwtVerify, createLocalJWKSet } = await import('jose');
  const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), { issuer: discovery.issuer, audience: 'desktop', algorithms: ['RS256'] });
  assert.equal(verified.payload.sub, '7');
  assert.equal(verified.payload.nonce, 'test-nonce');
  const userinfo = () => request(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  assert.equal((await (await userinfo()).json()).sub, '7');
  assert.equal((await exchange()).status, 400, 'code reuse is rejected while the source session is active');
  const nextCallback = await authorize();
  const nextTokens = await (await exchange(verifier, nextCallback.searchParams.get('code'))).json();
  assert.ok(nextTokens.access_token);
  const revocation = await request(discovery.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'desktop', token: nextTokens.access_token, token_type_hint: 'access_token' }) });
  assert.equal(revocation.status, 200);
  assert.equal((await request(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${nextTokens.access_token}` } })).status, 401);
  const thirdCallback = await authorize();
  const thirdTokens = await (await exchange(verifier, thirdCallback.searchParams.get('code'))).json();
  assert.ok(thirdTokens.access_token);
  const webCallback = await authorize({ client_id: web.client_id, redirect_uri: web.redirect_uris[0] });
  const webExchange = (secret) => request(discovery.token_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${web.client_id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: web.redirect_uris[0], code: webCallback.searchParams.get('code'), code_verifier: verifier }),
  });
  assert.equal((await webExchange('incorrect')).status, 401);
  const webResponse = await webExchange(web.client_secret);
  assert.equal(webResponse.status, 200);
  const webTokens = await webResponse.json();
  const webVerified = await jwtVerify(webTokens.id_token, createLocalJWKSet(jwks), { issuer: discovery.issuer, audience: web.client_id, algorithms: ['RS256'] });
  assert.equal(webVerified.payload.sub, '7');
  await request(discovery.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'desktop', token: webTokens.access_token }) });
  assert.equal((await request(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${webTokens.access_token}` } })).status, 200, 'a different client cannot revoke this token');
  active = false;
  assert.equal((await request(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${thirdTokens.access_token}` } })).status, 401);
  const staleSession = await authorize();
  assert.equal(staleSession.searchParams.get('error'), 'login_required');
  active = true;
  identity.apps = [];
  const noApp = await authorize();
  assert.equal(noApp.searchParams.get('error'), 'access_denied');
});

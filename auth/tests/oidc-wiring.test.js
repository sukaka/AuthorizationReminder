const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('business middleware resolves RP handles, rejects legacy JWT in strict mode and isolates apps', async () => {
  const vm = require('node:vm');
  const helpers = source.slice(source.indexOf('const parseBearerToken ='), source.indexOf('const getCookieSameSite ='));
  const middleware = source.slice(source.indexOf('const authMiddleware ='), source.indexOf("app.use('/api', authMiddleware)"));
  const accessToken = { grantId: 'g', clientId: 'ai', accountId: '7', scopes: new Set(['openid']) };
  const context = {
    JWT_SECRET: 'unused', jwt: { verify: () => ({ id: 7, sid: 'portal' }) },
    parseCookieToken: () => '', clearAuthCookie: () => {},
    oidcRpService: { resolve: async (handle, system) => handle === 'rp_valid' && system === 'ai-assistant' ? 'opaque' : null },
    oidcService: {
      provider: { AccessToken: { find: async (token) => token === 'opaque' ? accessToken : null }, Grant: { find: async () => ({ accountId: '7', clientId: 'ai' }) } },
      bindings: { find: async () => ({ userSessionId: 'portal' }) }, config: { systems: new Map([['ai', 'ai-assistant']]) },
    },
    resolveOidcIdentity: async () => ({ sub: '7', sessionId: 'portal', role: 'user', apps: ['ai-assistant'] }),
    db: { get: async () => ({ id: 7, role: 'user', is_active: 1 }), run: async () => {} },
    isSessionRecordValid: () => true, getSecurityConfig: async () => ({}), getRequestIp: () => '127.0.0.1', checkRoleIpAccess: () => ({ allowed: true }),
  };
  const invoke = vm.runInNewContext(`${helpers}\n${middleware}\nauthMiddleware`, context);
  async function check(token, system) {
    let status = 200; let passed = false;
    const req = { path: '/auth/introspect', headers: { authorization: `Bearer ${token}` }, get: () => system };
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    await invoke(req, res, () => { passed = true; });
    return { status, passed, system: req.oidcSystem };
  }
  assert.deepEqual(await check('rp_valid', 'ai-assistant'), { status: 200, passed: true, system: 'ai-assistant' });
  assert.equal((await check('legacy-jwt', 'ai-assistant')).status, 401);
  assert.equal((await check('rp_valid', 'train-exam')).status, 401);
  assert.equal((await check('opaque', 'train-exam')).status, 401);
  assert.equal((await check('legacy-jwt', undefined)).passed, true);
});

test('protocol is mounted before business parsers and enabled only after explicit schema readiness', () => {
  assert.ok(source.indexOf("app.use('/oidc'") < source.indexOf('app.use(express.json'));
  assert.match(source, /if \(!oidcService\) return res.status\(404\)/);
  assert.match(source, /auth_oidc_artifacts LIMIT 0/);
  assert.ok(!source.includes('CREATE TABLE IF NOT EXISTS auth_oidc_artifacts'));
});

test('business token compatibility is limited to the registered application and non-admin paths', () => {
  assert.match(source, /\['\/auth\/introspect', '\/auth\/authorize', '\/auth\/system-users'\]/);
  assert.ok(source.includes("req.body?.system !== system"));
  assert.ok(source.includes("req.query.system !== system"));
  assert.ok(source.includes('grant.clientId !== accessToken.clientId'));
  assert.ok(source.includes('binding.userSessionId'));
});

test('container includes protocol modules on supported Node LTS', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /ARG AUTH_NODE_IMAGE=node:24-bookworm-slim/);
  for (const file of ['oidc-config.js', 'oidc-adapter.js', 'oidc-service.js']) {
    assert.ok(dockerfile.includes(`COPY auth/${file} ./auth/${file}`));
  }
});

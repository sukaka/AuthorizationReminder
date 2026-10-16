const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const social = require('../social-login');

// Execute the actual route registrations without starting auth or loading its database.
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const routesSource = source.slice(
  source.indexOf("app.get('/api/auth/sso/:provider/start'"),
  source.indexOf("app.get('/api/auth/sso/pending'"),
);
const secret = 'route-tests-only-signing-key-over-32-characters';
const config = social.readSocialLoginConfig({
  AUTH_PUBLIC_URL: 'https://login.example.com', AUTH_WECOM_CORP_ID: 'test-corp',
  AUTH_WECOM_AGENT_ID: '100002', AUTH_WECOM_SECRET: 'test-only-secret',
});

function harness({ enabled = true, users = [{ id: 1, username: 'member', role: 'user', is_active: 1 }], ipAllowed = true, mfa = false } = {}) {
  const routes = new Map();
  const calls = { exchanges: [], sessions: 0, cleared: 0, audits: [] };
  const bindings = {
    ...social,
    app: { get: (url, handler) => routes.set(url, handler) },
    JWT_SECRET: secret, SOCIAL_LOGIN_CONFIG: config,
    oidcRpService: enabled ? { apps: new Map([['train-exam', {}]]) } : null,
    normalizeSocialLoginContext: (query) => ({ system: query.system || '', mode: '' }),
    clearSocialLoginMfaCookie: () => {}, clearSocialLoginStateCookie: () => { calls.cleared++; },
    getSocialLoginStateCookieName: () => 'test-state',
    buildSocialLoginStateCookieOptions: () => ({ httpOnly: true, sameSite: 'lax' }),
    readCookieValue: (req) => req.stateCookie,
    getRequestIp: () => '127.0.0.1',
    createSocialLoginError: (code) => new social.SocialLoginError(code),
    normalizeSocialLoginErrorCode: (error) => error.code,
    buildSocialLoginPortalRedirect: ({ context, status, errorCode = '' }) =>
      `/portal?${new URLSearchParams({ system: context.system || '', sso: status, sso_error: errorCode })}`,
    exchangeSocialAuthorizationCode: async (input) => { calls.exchanges.push(input); return { subject: 'member' }; },
    db: { query: async () => users },
    getSecurityConfig: async () => ({}),
    checkRoleIpAccess: () => ({ allowed: ipAllowed }),
    resolveUserMfaStatus: () => ({ setupRequired: false, enabled: mfa, effectiveMethods: ['wecom'], desiredMethods: ['wecom'] }),
    createUserSession: async () => { calls.sessions++; return { token: 'test-session' }; },
    setAuthCookie: () => {},
    logOperation: async (input) => calls.audits.push(input),
  };
  vm.runInNewContext(routesSource, bindings);
  const req = {
    params: { provider: 'wecom' },
    query: { system: 'train-exam', entry: 'workbench' },
    headers: { 'user-agent': 'MicroMessenger wxwork/4.1' },
    get(name) { return this.headers[name.toLowerCase()]; },
  };
  const res = {
    cookies: [], headers: {}, set(key, value) { this.headers[key] = value; },
    cookie(...args) { this.cookies.push(args); },
    redirect(status, url) { this.status = status; this.url = url; },
  };
  return { routes, calls, req, res };
}

test('workbench start issues browser-bound state and silently authorizes members; disabled OIDC fails closed', () => {
  for (const enabled of [true, false]) {
    const { routes, req, res } = harness({ enabled });
    routes.get('/api/auth/sso/:provider/start')(req, res);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    if (!enabled) {
      assert.equal(res.status, 303);
      assert.match(res.url, /sso_error=provider_disabled/);
      assert.equal(res.cookies.length, 0);
      continue;
    }
    assert.equal(res.status, 302);
    const url = new URL(res.url);
    assert.equal(url.origin, 'https://open.weixin.qq.com');
    const context = social.verifySocialLoginState({
      provider: 'wecom', state: url.searchParams.get('state'),
      cookieToken: res.cookies[0][1], signingSecret: secret,
    });
    assert.equal(context.entry, 'workbench');
    assert.equal(context.wecomFlow, 'webview');
    assert.equal(context.system, 'train-exam');
  }
});

test('callback ignores flow query overrides and preserves account, IP and MFA policies', async () => {
  const scenarios = [
    { expected: 'complete', sessions: 1 },
    { enabled: false, expected: 'provider_disabled', exchanges: 0 },
    { users: [], expected: 'identity_not_bound' },
    { users: [{}, {}], expected: 'identity_ambiguous' },
    { users: [{ is_active: 0 }], expected: 'account_disabled' },
    { ipAllowed: false, expected: 'ip_restricted' },
    { mfa: true, expected: 'mfa_unavailable' },
    { tamper: true, expected: 'invalid_state', exchanges: 0 },
  ];
  for (const scenario of scenarios) {
    const { routes, calls, req, res } = harness(scenario);
    const issued = social.createSocialLoginState({
      provider: 'wecom', signingSecret: secret,
      context: { system: 'train-exam', entry: 'workbench', wecomFlow: 'webview' },
    });
    req.stateCookie = issued.cookieToken;
    req.query = { state: scenario.tamper ? 'invalid' : issued.state, code: 'test-code', wecomFlow: 'qr', system: 'ai-assistant' };
    await routes.get('/api/auth/sso/:provider/callback')(req, res);
    assert.match(res.url, new RegExp(scenario.expected));
    assert.equal(calls.sessions, scenario.sessions || 0);
    assert.equal(calls.exchanges.length, scenario.exchanges ?? 1);
    assert.equal(calls.cleared, 1);
    if (calls.exchanges.length) {
      assert.equal(calls.exchanges[0].context.wecomFlow, 'webview');
      assert.equal(calls.exchanges[0].context.system, 'train-exam');
    }
  }
});

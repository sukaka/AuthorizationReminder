const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SocialLoginError,
  buildSocialLoginAuthorizationUrl,
  createSocialLoginState,
  exchangeSocialAuthorizationCode,
  getEnabledSocialLoginProviders,
  readSocialLoginConfig,
  verifySocialLoginState,
} = require('../social-login');

const SIGNING_SECRET = 'test-social-login-signing-secret-with-more-than-32-characters';

const jsonResponse = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  async json() {
    return payload;
  },
});

test('social login providers are enabled only with a safe public origin and complete credentials', () => {
  const config = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'https://login.example.com/portal',
    AUTH_WECOM_CORP_ID: 'ww-corp',
    AUTH_WECOM_AGENT_ID: '1000002',
    AUTH_WECOM_SECRET: 'wecom-secret',
    AUTH_FEISHU_APP_ID: 'cli_app',
    AUTH_FEISHU_APP_SECRET: 'feishu-secret',
  });

  assert.equal(config.publicOrigin, 'https://login.example.com');
  assert.equal(config.providers.wecom.enabled, true);
  assert.equal(config.providers.feishu.enabled, true);
  assert.equal(config.providers.wecom.callbackUrl, 'https://login.example.com/api/auth/sso/wecom/callback');
  assert.equal(config.providers.feishu.callbackUrl, 'https://login.example.com/api/auth/sso/feishu/callback');
  assert.deepEqual(getEnabledSocialLoginProviders(config), [
    { key: 'wecom', label: '企业微信' },
    { key: 'feishu', label: '飞书' },
  ]);

  const incomplete = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'http://login.example.com',
    AUTH_WECOM_CORP_ID: 'ww-corp',
    AUTH_WECOM_AGENT_ID: '1000002',
  });
  assert.equal(incomplete.providers.wecom.enabled, false);
  assert.equal(incomplete.providers.feishu.enabled, false);
});

test('local HTTP origin is allowed for development but non-local HTTP is rejected', () => {
  const local = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'http://localhost:5180',
    AUTH_FEISHU_APP_ID: 'cli_app',
    AUTH_FEISHU_APP_SECRET: 'feishu-secret',
  });
  const remote = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'http://10.0.0.8:5180',
    AUTH_FEISHU_APP_ID: 'cli_app',
    AUTH_FEISHU_APP_SECRET: 'feishu-secret',
  });

  assert.equal(local.providers.feishu.enabled, true);
  assert.equal(remote.providers.feishu.enabled, false);
});

test('authorization URLs contain only provider-required fields and the exact callback URL', () => {
  const config = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'https://login.example.com',
    AUTH_WECOM_CORP_ID: 'ww-corp',
    AUTH_WECOM_AGENT_ID: '1000002',
    AUTH_WECOM_SECRET: 'wecom-secret',
    AUTH_FEISHU_APP_ID: 'cli_app',
    AUTH_FEISHU_APP_SECRET: 'feishu-secret',
  });

  const wecomState = 'state-123-state-123-state';
  const wecom = new URL(buildSocialLoginAuthorizationUrl({ provider: 'wecom', config, state: wecomState }));
  assert.equal(wecom.origin, 'https://open.work.weixin.qq.com');
  assert.equal(wecom.searchParams.get('appid'), 'ww-corp');
  assert.equal(wecom.searchParams.get('agentid'), '1000002');
  assert.equal(wecom.searchParams.get('redirect_uri'), config.providers.wecom.callbackUrl);
  assert.equal(wecom.searchParams.get('state'), wecomState);
  assert.equal(wecom.searchParams.has('secret'), false);

  const feishuState = 'state-456-state-456-state';
  const feishu = new URL(buildSocialLoginAuthorizationUrl({ provider: 'feishu', config, state: feishuState }));
  assert.equal(feishu.origin, 'https://open.feishu.cn');
  assert.equal(feishu.pathname, '/open-apis/authen/v1/index');
  assert.equal(feishu.searchParams.get('app_id'), 'cli_app');
  assert.equal(feishu.searchParams.get('redirect_uri'), config.providers.feishu.callbackUrl);
  assert.equal(feishu.searchParams.get('state'), feishuState);
  assert.equal(feishu.searchParams.has('app_secret'), false);
});

test('authorization endpoints stay pinned to the official provider domains', () => {
  const config = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'https://login.example.com',
    AUTH_WECOM_CORP_ID: 'ww-corp',
    AUTH_WECOM_AGENT_ID: '1000002',
    AUTH_WECOM_SECRET: 'wecom-secret',
    AUTH_FEISHU_APP_ID: 'cli_app',
    AUTH_FEISHU_APP_SECRET: 'feishu-secret',
    AUTH_WECOM_AUTHORIZE_URL: 'https://attacker.example/wecom',
    AUTH_FEISHU_AUTHORIZE_URL: 'https://attacker.example/feishu',
  });

  assert.equal(
    config.providers.wecom.authorizeUrl,
    'https://open.work.weixin.qq.com/wwopen/sso/qrConnect'
  );
  assert.equal(
    config.providers.feishu.authorizeUrl,
    'https://open.feishu.cn/open-apis/authen/v1/index'
  );
});

test('signed OAuth state is one-time-request scoped and rejects provider or nonce mismatches', () => {
  const issued = createSocialLoginState({
    provider: 'wecom',
    signingSecret: SIGNING_SECRET,
    ttlSeconds: 300,
    context: { system: 'train-exam', mode: 'switch' },
  });

  assert.match(issued.state, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(
    verifySocialLoginState({
      provider: 'wecom',
      state: issued.state,
      cookieToken: issued.cookieToken,
      signingSecret: SIGNING_SECRET,
    }),
    { system: 'train-exam', mode: 'switch' }
  );
  assert.throws(
    () => verifySocialLoginState({
      provider: 'feishu',
      state: issued.state,
      cookieToken: issued.cookieToken,
      signingSecret: SIGNING_SECRET,
    }),
    (error) => error instanceof SocialLoginError && error.code === 'invalid_state'
  );
  assert.throws(
    () => verifySocialLoginState({
      provider: 'wecom',
      state: `${issued.state.startsWith('A') ? 'B' : 'A'}${issued.state.slice(1)}`,
      cookieToken: issued.cookieToken,
      signingSecret: SIGNING_SECRET,
    }),
    (error) => error instanceof SocialLoginError && error.code === 'invalid_state'
  );
});

test('WeCom authorization code exchange returns only the stable UserId', async () => {
  const config = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'https://login.example.com',
    AUTH_WECOM_CORP_ID: 'ww-corp',
    AUTH_WECOM_AGENT_ID: '1000002',
    AUTH_WECOM_SECRET: 'wecom-secret',
  });
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/gettoken')) {
      return jsonResponse({ errcode: 0, access_token: 'provider-access-token' });
    }
    return jsonResponse({ errcode: 0, UserId: 'zhangsan', user_ticket: 'must-not-leak' });
  };

  const identity = await exchangeSocialAuthorizationCode({
    provider: 'wecom',
    config,
    code: 'authorization-code',
    fetchImpl,
  });

  assert.deepEqual(identity, { provider: 'wecom', subject: 'zhangsan' });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /corpid=ww-corp/);
  assert.match(requests[1].url, /code=authorization-code/);
});

test('Feishu authorization code exchange uses app token, user token, then stable open_id', async () => {
  const config = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'https://login.example.com',
    AUTH_FEISHU_APP_ID: 'cli_app',
    AUTH_FEISHU_APP_SECRET: 'feishu-secret',
  });
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v3/app_access_token/internal')) {
      return jsonResponse({ code: 0, app_access_token: 'app-access-token' });
    }
    if (String(url).endsWith('/authen/v1/access_token')) {
      return jsonResponse({ code: 0, data: { access_token: 'user-access-token' } });
    }
    return jsonResponse({ code: 0, data: { open_id: 'ou_stable_identity', mobile: '13800000000' } });
  };

  const identity = await exchangeSocialAuthorizationCode({
    provider: 'feishu',
    config,
    code: 'authorization-code',
    fetchImpl,
  });

  assert.deepEqual(identity, { provider: 'feishu', subject: 'ou_stable_identity' });
  assert.equal(requests.length, 3);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer app-access-token');
  assert.equal(requests[2].options.headers.Authorization, 'Bearer user-access-token');
});

test('provider failures expose a generic local error without upstream secrets', async () => {
  const config = readSocialLoginConfig({
    AUTH_PUBLIC_URL: 'https://login.example.com',
    AUTH_WECOM_CORP_ID: 'ww-corp',
    AUTH_WECOM_AGENT_ID: '1000002',
    AUTH_WECOM_SECRET: 'top-secret-value',
  });

  await assert.rejects(
    exchangeSocialAuthorizationCode({
      provider: 'wecom',
      config,
      code: 'authorization-code',
      fetchImpl: async () => jsonResponse({ errcode: 40013, errmsg: 'invalid corpid top-secret-value' }),
    }),
    (error) => (
      error instanceof SocialLoginError
      && error.code === 'provider_unavailable'
      && !error.message.includes('top-secret-value')
    )
  );
});

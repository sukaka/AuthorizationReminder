const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SOCIAL_LOGIN_PROVIDERS = Object.freeze({
  wecom: Object.freeze({
    label: '企业微信',
    authorizeUrl: 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect',
  }),
  feishu: Object.freeze({
    label: '飞书',
    authorizeUrl: 'https://open.feishu.cn/open-apis/authen/v1/index',
  }),
});

class SocialLoginError extends Error {
  constructor(code, message = '第三方登录暂时不可用') {
    super(message);
    this.name = 'SocialLoginError';
    this.code = code;
  }
}

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const isLocalHostname = (hostname) => {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'localhost'
    || value === '127.0.0.1'
    || value === '::1'
    || value.endsWith('.localhost');
};

const normalizeSafeUrl = (raw, { allowLocalHttp = false } = {}) => {
  try {
    const parsed = new URL(String(raw || '').trim());
    if (parsed.protocol === 'https:') return parsed;
    if (allowLocalHttp && parsed.protocol === 'http:' && isLocalHostname(parsed.hostname)) return parsed;
  } catch (_err) {
    // Invalid or unsafe URLs disable the provider below.
  }
  return null;
};

const readSocialLoginConfig = (env = process.env) => {
  const publicUrl = normalizeSafeUrl(env.AUTH_PUBLIC_URL, { allowLocalHttp: true });
  const publicOrigin = publicUrl ? publicUrl.origin : '';
  const stateTtlSeconds = clampNumber(env.AUTH_SOCIAL_LOGIN_STATE_TTL_SECONDS, 300, 60, 600);
  const requestTimeoutMs = clampNumber(env.AUTH_SOCIAL_LOGIN_TIMEOUT_MS, 5000, 1000, 15000);
  const wecomCorpId = String(env.AUTH_WECOM_CORP_ID || '').trim();
  const wecomAgentId = String(env.AUTH_WECOM_AGENT_ID || '').trim();
  const wecomSecret = String(env.AUTH_WECOM_SECRET || '').trim();
  const feishuAppId = String(env.AUTH_FEISHU_APP_ID || '').trim();
  const feishuAppSecret = String(env.AUTH_FEISHU_APP_SECRET || '').trim();

  return {
    publicOrigin,
    stateTtlSeconds,
    requestTimeoutMs,
    providers: {
      wecom: {
        key: 'wecom',
        label: SOCIAL_LOGIN_PROVIDERS.wecom.label,
        enabled: Boolean(publicOrigin && wecomCorpId && wecomAgentId && wecomSecret),
        corpId: wecomCorpId,
        agentId: wecomAgentId,
        secret: wecomSecret,
        authorizeUrl: SOCIAL_LOGIN_PROVIDERS.wecom.authorizeUrl,
        callbackUrl: publicOrigin ? `${publicOrigin}/api/auth/sso/wecom/callback` : '',
      },
      feishu: {
        key: 'feishu',
        label: SOCIAL_LOGIN_PROVIDERS.feishu.label,
        enabled: Boolean(publicOrigin && feishuAppId && feishuAppSecret),
        appId: feishuAppId,
        appSecret: feishuAppSecret,
        authorizeUrl: SOCIAL_LOGIN_PROVIDERS.feishu.authorizeUrl,
        callbackUrl: publicOrigin ? `${publicOrigin}/api/auth/sso/feishu/callback` : '',
      },
    },
  };
};

const getProviderConfig = ({ provider, config }) => {
  const key = String(provider || '').trim().toLowerCase();
  const providerConfig = config?.providers?.[key];
  if (!providerConfig?.enabled) {
    throw new SocialLoginError('provider_disabled', '该扫码登录方式尚未配置');
  }
  return providerConfig;
};

const getEnabledSocialLoginProviders = (config) =>
  Object.keys(SOCIAL_LOGIN_PROVIDERS)
    .map((key) => config?.providers?.[key])
    .filter((provider) => provider?.enabled)
    .map((provider) => ({ key: provider.key, label: provider.label }));

const buildSocialLoginAuthorizationUrl = ({ provider, config, state }) => {
  const providerConfig = getProviderConfig({ provider, config });
  const normalizedState = String(state || '').trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(normalizedState)) {
    throw new SocialLoginError('invalid_state', '登录请求已失效，请重新扫码');
  }
  const url = new URL(providerConfig.authorizeUrl);
  if (providerConfig.key === 'wecom') {
    url.searchParams.set('appid', providerConfig.corpId);
    url.searchParams.set('agentid', providerConfig.agentId);
  } else {
    url.searchParams.set('app_id', providerConfig.appId);
  }
  url.searchParams.set('redirect_uri', providerConfig.callbackUrl);
  url.searchParams.set('state', normalizedState);
  return url.toString();
};

const normalizeStateContext = (context = {}) => {
  const system = /^[a-z0-9-]{1,64}$/.test(String(context.system || '').trim().toLowerCase())
    ? String(context.system).trim().toLowerCase()
    : '';
  const mode = String(context.mode || '').trim().toLowerCase() === 'switch' ? 'switch' : '';
  return { system, mode };
};

const createSocialLoginState = ({
  provider,
  signingSecret,
  ttlSeconds = 300,
  context = {},
} = {}) => {
  const key = String(provider || '').trim().toLowerCase();
  if (!SOCIAL_LOGIN_PROVIDERS[key] || !String(signingSecret || '')) {
    throw new SocialLoginError('invalid_state', '登录请求无法创建');
  }
  const state = crypto.randomBytes(32).toString('base64url');
  const cookieToken = jwt.sign(
    {
      type: 'social_login_state',
      provider: key,
      nonce: state,
      context: normalizeStateContext(context),
    },
    signingSecret,
    {
      algorithm: 'HS256',
      expiresIn: clampNumber(ttlSeconds, 300, 60, 600),
    }
  );
  return { state, cookieToken };
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifySocialLoginState = ({ provider, state, cookieToken, signingSecret } = {}) => {
  try {
    const key = String(provider || '').trim().toLowerCase();
    const normalizedState = String(state || '').trim();
    if (!SOCIAL_LOGIN_PROVIDERS[key] || !normalizedState || !cookieToken) throw new Error('missing state');
    const payload = jwt.verify(cookieToken, signingSecret, { algorithms: ['HS256'] });
    if (payload?.type !== 'social_login_state' || payload?.provider !== key) throw new Error('wrong state scope');
    if (!safeEqual(payload?.nonce, normalizedState)) throw new Error('wrong state nonce');
    return normalizeStateContext(payload?.context);
  } catch (_err) {
    throw new SocialLoginError('invalid_state', '登录请求已失效，请重新扫码');
  }
};

const fetchJson = async ({ fetchImpl, url, options = {}, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response?.ok) throw new Error('upstream status');
    return await response.json();
  } catch (_err) {
    throw new SocialLoginError('provider_unavailable');
  } finally {
    clearTimeout(timer);
  }
};

const assertWecomSuccess = (payload) => {
  if (!payload || Number(payload.errcode || 0) !== 0) {
    throw new SocialLoginError('provider_unavailable');
  }
  return payload;
};

const assertFeishuSuccess = (payload) => {
  if (!payload || Number(payload.code || 0) !== 0) {
    throw new SocialLoginError('provider_unavailable');
  }
  return payload;
};

const exchangeWecomCode = async ({ providerConfig, code, fetchImpl, timeoutMs }) => {
  const tokenUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
  tokenUrl.searchParams.set('corpid', providerConfig.corpId);
  tokenUrl.searchParams.set('corpsecret', providerConfig.secret);
  const tokenPayload = assertWecomSuccess(await fetchJson({
    fetchImpl,
    url: tokenUrl,
    timeoutMs,
  }));
  const accessToken = String(tokenPayload.access_token || '').trim();
  if (!accessToken) throw new SocialLoginError('provider_unavailable');

  const identityUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo');
  identityUrl.searchParams.set('access_token', accessToken);
  identityUrl.searchParams.set('code', code);
  const identityPayload = assertWecomSuccess(await fetchJson({
    fetchImpl,
    url: identityUrl,
    timeoutMs,
  }));
  const subject = String(identityPayload.UserId || identityPayload.userid || '').trim();
  if (!subject || subject.length > 255) throw new SocialLoginError('identity_unavailable', '未获取到企业成员身份');
  return { provider: 'wecom', subject };
};

const exchangeFeishuCode = async ({ providerConfig, code, fetchImpl, timeoutMs }) => {
  const appTokenPayload = assertFeishuSuccess(await fetchJson({
    fetchImpl,
    url: 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
    timeoutMs,
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: providerConfig.appId, app_secret: providerConfig.appSecret }),
    },
  }));
  const appAccessToken = String(appTokenPayload.app_access_token || '').trim();
  if (!appAccessToken) throw new SocialLoginError('provider_unavailable');

  const userTokenPayload = assertFeishuSuccess(await fetchJson({
    fetchImpl,
    url: 'https://open.feishu.cn/open-apis/authen/v1/access_token',
    timeoutMs,
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appAccessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
    },
  }));
  const userAccessToken = String(userTokenPayload.data?.access_token || '').trim();
  if (!userAccessToken) throw new SocialLoginError('provider_unavailable');

  const userPayload = assertFeishuSuccess(await fetchJson({
    fetchImpl,
    url: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
    timeoutMs,
    options: {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    },
  }));
  const subject = String(userPayload.data?.open_id || '').trim();
  if (!subject || subject.length > 255) throw new SocialLoginError('identity_unavailable', '未获取到飞书用户身份');
  return { provider: 'feishu', subject };
};

const exchangeSocialAuthorizationCode = async ({
  provider,
  config,
  code,
  fetchImpl = global.fetch,
} = {}) => {
  const providerConfig = getProviderConfig({ provider, config });
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode || normalizedCode.length > 2048) {
    throw new SocialLoginError('invalid_code', '扫码授权码无效，请重新扫码');
  }
  if (typeof fetchImpl !== 'function') throw new SocialLoginError('provider_unavailable');
  if (providerConfig.key === 'wecom') {
    return exchangeWecomCode({
      providerConfig,
      code: normalizedCode,
      fetchImpl,
      timeoutMs: config.requestTimeoutMs,
    });
  }
  return exchangeFeishuCode({
    providerConfig,
    code: normalizedCode,
    fetchImpl,
    timeoutMs: config.requestTimeoutMs,
  });
};

module.exports = {
  SocialLoginError,
  buildSocialLoginAuthorizationUrl,
  createSocialLoginState,
  exchangeSocialAuthorizationCode,
  getEnabledSocialLoginProviders,
  readSocialLoginConfig,
  verifySocialLoginState,
};

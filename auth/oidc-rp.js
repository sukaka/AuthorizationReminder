const express = require('express');
const jwt = require('jsonwebtoken');
const { randomBytes, createHash, createPublicKey } = require('node:crypto');
const { isIP } = require('node:net');

const supported = new Set(['train-exam', 'ai-assistant']);
const now = () => Math.floor(Date.now() / 1000);
const random = () => randomBytes(32).toString('base64url');
const digest = (value) => createHash('sha256').update(value).digest('base64url');
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

function readRpConfig(config, env = process.env) {
  const apps = new Map();
  const required = (env.OIDC_RP_REQUIRED_SYSTEMS || '').split(',').filter(Boolean);
  if (!config.enabled || !env.OIDC_RP_APPS_JSON) {
    if (required.length) throw new Error('Required OIDC RP applications are not configured');
    return apps;
  }
  const registrations = JSON.parse(env.OIDC_RP_APPS_JSON);
  if (!Array.isArray(registrations)) throw new Error('OIDC_RP_APPS_JSON must be an array');
  for (const entry of registrations) {
    const client = config.clients.find((item) => item.client_id === entry.client_id);
    if (!supported.has(entry.system) || apps.has(entry.system) || !client || config.systems.get(entry.client_id) !== entry.system || client.token_endpoint_auth_method !== 'client_secret_basic') throw new Error('Invalid OIDC RP application');
    const url = new URL(entry.app_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('OIDC RP app_url must be an HTTPS origin');
    const prefix = `/api/oidc/${entry.system}`;
    const redirectUri = `${url.origin}${prefix}/callback`;
    if (!client.redirect_uris.includes(redirectUri)) throw new Error('OIDC RP callback must be registered exactly');
    apps.set(entry.system, { system: entry.system, client, appUrl: url.href, redirectUri, loginUrl: `${url.origin}${prefix}/login`, cookieName: `__Secure-juxin_oidc_${entry.system.replaceAll('-', '_')}` });
  }
  if (required.some((system) => !supported.has(system) || !apps.has(system))) throw new Error('Required OIDC RP applications are not configured');
  return apps;
}

function verifyIdToken(token, config, client, nonce) {
  const decoded = jwt.decode(token, { complete: true });
  const key = config.jwks.keys.find((item) => item.kid === decoded?.header.kid && item.alg === 'RS256');
  if (!key || decoded.header.alg !== 'RS256') throw new Error('Invalid ID token key');
  const publicKey = createPublicKey({ key, format: 'jwk' });
  const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: config.issuer, audience: client.client_id, clockTolerance: 5 });
  if (typeof claims.sub !== 'string' || !claims.sub || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.iat > now() + 5 || (nonce !== undefined && claims.nonce !== nonce) || (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== client.client_id) || (claims.azp && claims.azp !== client.client_id)) throw new Error('Invalid ID token claims');
  return claims;
}

function createRpService({ config, apps, Adapter, fetcher = fetch }) {
  const transactions = new Adapter('JuxinRpTransaction');
  const sessions = new Adapter('JuxinRpSession');
  const router = express.Router();
  const refreshing = new Map();
  async function exchange(app, params, clientIp) {
    const credentials = `${encodeURIComponent(app.client.client_id)}:${encodeURIComponent(app.client.client_secret)}`;
    const response = await fetcher(`${config.issuer}/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(isIP(clientIp || '') ? { 'X-Forwarded-For': clientIp } : {}) }, body: new URLSearchParams(params) });
    if (!response.ok) throw new Error('OIDC token exchange failed');
    const result = await response.json();
    if (typeof result.access_token !== 'string' || result.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error('Invalid token response');
    return result;
  }
  async function resolve(handle, system, clientIp) {
    if (!handle?.startsWith('rp_') || !apps.has(system)) return null;
    const session = await sessions.find(handle);
    const app = apps.get(system);
    if (!session || session.system !== system || session.clientId !== app.client.client_id || session.deadline <= now()) return null;
    if (session.expiresAt > now() + 30) return session.accessToken;
    if (!session.refreshToken) return null;
    if (!refreshing.has(handle)) {
      const work = (async () => {
        try {
          const tokens = await exchange(app, { grant_type: 'refresh_token', refresh_token: session.refreshToken }, clientIp);
          if (tokens.id_token && verifyIdToken(tokens.id_token, config, app.client).sub !== session.sub) throw new Error('Account changed');
          const updated = { ...session, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || session.refreshToken, expiresAt: now() + tokens.expires_in };
          await sessions.upsert(handle, updated, session.deadline - now());
          return updated.accessToken;
        } catch { await sessions.destroy(handle); return null; }
      })();
      refreshing.set(handle, work);
      work.then(() => refreshing.delete(handle), () => refreshing.delete(handle));
    }
    return refreshing.get(handle);
  }
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  router.get('/:system/login', async (req, res) => {
    const app = apps.get(req.params.system);
    if (!app) return res.status(404).json({ error: 'OIDC_RP_NOT_ENABLED' });
    try {
      const state = random(); const verifier = random(); const nonce = random(); const browser = random();
      await transactions.upsert(state, { system: app.system, verifier, nonce, browserHash: digest(browser) }, 600);
      res.cookie(`${app.cookieName}_transaction`, browser, { ...cookieOptions, maxAge: 600000 });
      const authorization = new URL(`${config.issuer}/auth`);
      authorization.search = new URLSearchParams({ client_id: app.client.client_id, redirect_uri: app.redirectUri, response_type: 'code', scope: 'openid profile', state, nonce, code_challenge: digest(verifier), code_challenge_method: 'S256' }).toString();
      return res.redirect(authorization.href);
    } catch { return res.status(503).json({ error: 'OIDC_LOGIN_UNAVAILABLE' }); }
  });
  router.get('/:system/callback', async (req, res) => {
    const app = apps.get(req.params.system);
    if (!app) return res.sendStatus(404);
    try {
      const state = req.query.state;
      if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Invalid state');
      const transaction = await transactions.find(state);
      const browser = req.cookies?.[`${app.cookieName}_transaction`];
      if (!transaction || transaction.consumed || transaction.system !== app.system || typeof browser !== 'string' || digest(browser) !== transaction.browserHash) throw new Error('Invalid transaction');
      await transactions.consume(state);
      res.clearCookie(`${app.cookieName}_transaction`, cookieOptions);
      if (req.query.error || typeof req.query.code !== 'string' || !req.query.code || (req.query.iss && req.query.iss !== config.issuer)) throw new Error('Invalid callback');
      const clientIp = req.get('x-real-ip') || String(req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress;
      const tokens = await exchange(app, { grant_type: 'authorization_code', code: req.query.code, redirect_uri: app.redirectUri, code_verifier: transaction.verifier }, clientIp);
      const claims = verifyIdToken(tokens.id_token, config, app.client, transaction.nonce);
      if (claims.at_hash && claims.at_hash !== createHash('sha256').update(tokens.access_token).digest().subarray(0, 16).toString('base64url')) throw new Error('Invalid access token binding');
      const handle = `rp_${random()}`;
      const previous = req.cookies?.[app.cookieName];
      if (previous?.startsWith('rp_')) await sessions.destroy(previous);
      await sessions.upsert(handle, { system: app.system, clientId: app.client.client_id, sub: claims.sub, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: now() + tokens.expires_in, deadline: now() + 28800 }, 28800);
      res.cookie(app.cookieName, handle, { ...cookieOptions, maxAge: 28800000 });
      return res.redirect(app.appUrl);
    } catch { return res.status(400).json({ error: 'OIDC_CALLBACK_INVALID', message: '登录回调无效，请重新从统一门户进入应用' }); }
  });
  router.post('/:system/logout', async (req, res) => {
    const app = apps.get(req.params.system);
    if (!app) return res.sendStatus(404);
    if (req.get('origin') !== new URL(app.appUrl).origin) return res.sendStatus(403);
    try {
      const handle = req.cookies?.[app.cookieName];
      if (handle?.startsWith('rp_')) await sessions.destroy(handle);
      res.clearCookie(app.cookieName, cookieOptions);
      return res.sendStatus(204);
    } catch { return res.sendStatus(503); }
  });
  return { router, apps, resolve };
}

module.exports = { readRpConfig, verifyIdToken, createRpService };

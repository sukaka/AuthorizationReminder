const express = require('express');

async function createOidcService({ config, Adapter, resolveBrowser, resolveAccount }) {
  const { Provider, errors } = await import('oidc-provider');
  const bindings = new Adapter('JuxinGrantBinding');
  const provider = new Provider(config.issuer, {
    adapter: Adapter,
    clients: config.clients,
    jwks: config.jwks,
    cookies: { keys: config.cookieKeys },
    subjectTypes: ['public'],
    responseTypes: ['code'],
    scopes: ['openid', 'profile'],
    claims: { openid: ['sub'], profile: ['preferred_username', 'role', 'apps'] },
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true, allowedPolicy: (_ctx, client, token) => token.clientId === client.clientId },
      // Global portal logout remains authoritative until a coordinated logout UX is deployed.
      rpInitiatedLogout: { enabled: false },
    },
    ttl: { AccessToken: 900, AuthorizationCode: 60, IdToken: 900, Interaction: 600, Session: 28800, Grant: 28800 },
    interactions: { url: (_ctx, interaction) => `/oidc/interaction/${interaction.uid}` },
    async loadExistingGrant(ctx) {
      const grantId = ctx.oidc.result?.consent?.grantId || ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);
      if (!grantId) return undefined;
      const binding = await bindings.find(grantId);
      const identity = await resolveBrowser(ctx.req);
      if (!binding || !identity || binding.userSessionId !== identity.sessionId) return undefined;
      return provider.Grant.find(grantId);
    },
    async findAccount(ctx, accountId, token) {
      const clientId = ctx.oidc.client?.clientId || token?.clientId;
      let identity;
      if (token?.grantId) {
        const binding = await bindings.find(token.grantId);
        if (!binding || binding.accountId !== accountId) return undefined;
        identity = await resolveAccount(accountId, ctx.req, clientId, binding.userSessionId);
      } else {
        identity = await resolveBrowser(ctx.req);
        if (identity?.accountId !== accountId) {
          // The portal is authoritative; a stale OP session must request login again.
          await ctx.oidc.session.destroy();
          throw new errors.LoginRequired('Portal authentication is required');
        }
      }
      if (!identity || !identity.apps.includes(config.systems.get(clientId))) {
        if (!token) throw new errors.AccessDenied('Application access denied');
        return undefined;
      }
      return {
        accountId,
        async claims() {
          return { sub: identity.sub, preferred_username: identity.username, role: identity.role, apps: identity.apps };
        },
      };
    },
    async renderError(ctx, _out, error) {
      ctx.type = 'application/json';
      ctx.body = { error: error.error || 'server_error' };
    },
  });
  provider.proxy = Boolean(config.trustProxy);
  // The maintained provider intentionally supports S256 only.
  const router = express.Router();
  router.get('/interaction/:uid', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const details = await provider.interactionDetails(req, res);
      if (details.uid !== req.params.uid) return res.sendStatus(400);
      const identity = await resolveBrowser(req);
      const requestedPrompt = String(details.params.prompt || '').split(' ');
      const maxAge = details.params.max_age === undefined ? undefined : Number(details.params.max_age);
      const requiresFreshLogin = requestedPrompt.includes('login') || maxAge === 0;
      const tooOld = identity && details.prompt.name === 'login' && (requiresFreshLogin
        ? identity.authenticatedAt < details.iat
        : maxAge !== undefined && Date.now() / 1000 - identity.authenticatedAt > maxAge);
      if (!identity || tooOld) {
        return res.status(200).type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>聚信统一登录</title><h1>统一登录</h1><p>请在统一门户完成登录、密码更新及二次验证，然后回到此页继续。</p><p><a href="/portal?mode=switch" target="_blank" rel="noopener">打开登录门户</a></p><p><a href="">已完成登录，继续</a></p></html>');
      }
      const clientId = String(details.params.client_id);
      if (!identity.apps.includes(config.systems.get(clientId))) {
        return provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'Application access denied' }, { mergeWithLastSubmission: false });
      }
      if (details.prompt.name === 'login') {
        return provider.interactionFinished(req, res, { login: { accountId: identity.accountId, ts: identity.authenticatedAt } }, { mergeWithLastSubmission: false });
      }
      if (details.prompt.name === 'consent') {
        if (details.session?.accountId !== identity.accountId) {
          return provider.interactionFinished(req, res, { error: 'access_denied' }, { mergeWithLastSubmission: false });
        }
        const grant = details.grantId ? await provider.Grant.find(details.grantId)
          : new provider.Grant({ accountId: identity.accountId, clientId });
        if (!grant) throw new errors.InvalidGrant();
        if (details.prompt.details.missingOIDCScope) grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(' '));
        if (details.prompt.details.missingOIDCClaims) grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
        const grantId = await grant.save();
        await bindings.upsert(grantId, { accountId: identity.accountId, userSessionId: identity.sessionId, grantId }, 28800);
        return provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
      }
      return res.sendStatus(400);
    } catch (err) {
      return res.status(err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500)
        .json({ error: err.error || 'server_error' });
    }
  });
  router.use(provider.callback());
  return { provider, router, bindings };
}

module.exports = { createOidcService };

const { createPrivateKey } = require('node:crypto');

const parse = (value, name) => {
  try { return JSON.parse(value); } catch { throw new Error(`${name} must be valid JSON`); }
};
const fail = (condition, message) => { if (!condition) throw new Error(message); };
const isLoopback = (host) => ['127.0.0.1', '[::1]'].includes(host);

function readOidcConfig(env = process.env) {
  fail(!env.OIDC_ENABLED || ['true', 'false'].includes(env.OIDC_ENABLED), 'OIDC_ENABLED must be true or false');
  if (env.OIDC_ENABLED !== 'true') return { enabled: false };
  const issuer = new URL(env.OIDC_ISSUER);
  const development = env.NODE_ENV !== 'production' && env.OIDC_ALLOW_HTTP_LOOPBACK === 'true';
  fail(issuer.pathname === '/oidc' && !issuer.search && !issuer.hash && !issuer.username && !issuer.password, 'OIDC_ISSUER must end with /oidc without credentials, query or fragment');
  fail(issuer.protocol === 'https:' || (development && issuer.protocol === 'http:' && isLoopback(issuer.hostname)), 'OIDC_ISSUER requires HTTPS');
  const jwks = parse(env.OIDC_JWKS_JSON, 'OIDC_JWKS_JSON');
  fail(Array.isArray(jwks.keys) && jwks.keys.length > 0, 'OIDC private signing keys required');
  const kids = new Set();
  for (const key of jwks.keys) {
    fail(key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' && key.d && key.kid && !kids.has(key.kid), 'OIDC keys must be unique private RS256 signing keys');
    fail(createPrivateKey({ key, format: 'jwk' }).asymmetricKeyDetails.modulusLength >= 2048, 'OIDC signing keys require RSA >= 2048 bits');
    kids.add(key.kid);
  }
  const cookieKeys = parse(env.OIDC_COOKIE_KEYS_JSON, 'OIDC_COOKIE_KEYS_JSON');
  fail(Array.isArray(cookieKeys) && cookieKeys.length && cookieKeys.every((key) => typeof key === 'string' && key.length >= 43), 'OIDC cookie keys require >= 256 bits of random material');
  const storageKey = Buffer.from(env.OIDC_STORAGE_KEY || '', 'base64');
  fail(storageKey.length === 32 && storageKey.toString('base64') === env.OIDC_STORAGE_KEY, 'OIDC_STORAGE_KEY requires a base64 encoded 32-byte key');
  const registrations = parse(env.OIDC_CLIENTS_JSON, 'OIDC_CLIENTS_JSON');
  fail(Array.isArray(registrations) && registrations.length > 0, 'OIDC clients required');
  const systems = new Map();
  const clients = registrations.map((client) => {
    fail(typeof client.client_id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(client.client_id) && !systems.has(client.client_id), 'OIDC client_id must be unique');
    fail(typeof client.system_key === 'string' && /^[a-z0-9-]{1,64}$/.test(client.system_key), 'OIDC client system_key required');
    fail(!client.grant_types || JSON.stringify(client.grant_types) === '["authorization_code"]', 'Only authorization_code is supported');
    fail(!client.response_types || JSON.stringify(client.response_types) === '["code"]', 'Only code response type is supported');
    const method = client.token_endpoint_auth_method || 'client_secret_basic';
    fail(['none', 'client_secret_basic'].includes(method), 'Unsupported client authentication method');
    fail(method === 'none' || (typeof client.client_secret === 'string' && client.client_secret.length >= 43), 'Confidential client requires a strong client secret');
    const validateUris = (uris, required) => {
      fail(Array.isArray(uris) && (!required || uris.length > 0), 'Exact redirect URIs required');
      for (const uri of uris) {
        const url = new URL(uri);
        fail(!uri.includes('*') && !url.username && !url.password && !url.hash, 'Unsafe redirect URI');
        fail(url.protocol === 'https:' || (method === 'none' && url.protocol === 'http:' && isLoopback(url.hostname)), 'Redirect URI requires HTTPS or public-client loopback');
      }
      return uris;
    };
    systems.set(client.client_id, client.system_key);
    return {
      client_id: client.client_id,
      ...(method === 'none' ? {} : { client_secret: client.client_secret }),
      token_endpoint_auth_method: method,
      application_type: method === 'none' ? 'native' : 'web',
      redirect_uris: validateUris(client.redirect_uris, true),
      post_logout_redirect_uris: validateUris(client.post_logout_redirect_uris || [], false),
      grant_types: ['authorization_code'], response_types: ['code'],
    };
  });
  return { enabled: true, issuer: issuer.href, jwks, cookieKeys, storageKey, clients, systems };
}

module.exports = { readOidcConfig };

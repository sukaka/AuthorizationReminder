const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'db.js'), 'utf8');
const dockerfileSource = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
const composeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');
const envExampleSource = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');

test('auth service exposes public start, callback, and pending-MFA routes for both QR providers', () => {
  assert.match(authSource, /req\.path\.startsWith\('\/auth\/sso\/'\)/);
  assert.match(authSource, /app\.get\('\/api\/auth\/sso\/:provider\/start'/);
  assert.match(authSource, /app\.get\('\/api\/auth\/sso\/:provider\/callback'/);
  assert.match(authSource, /app\.get\('\/api\/auth\/sso\/pending'/);
});

test('portal renders enabled WeCom and Feishu scan-login actions', () => {
  assert.match(authSource, /企业微信扫码登录/);
  assert.match(authSource, /飞书扫码登录/);
  assert.match(authSource, /\/api\/auth\/sso\/\$\{provider\.key\}\/start/);
});

test('social callback binds only by stable external identity and rejects duplicate rows', () => {
  assert.match(authSource, /WHERE \$\{identityColumn\} = \? LIMIT 2/);
  assert.match(authSource, /matches\.length !== 1/);
  assert.doesNotMatch(authSource, /SOCIAL_LOGIN[\s\S]{0,1800}WHERE phone = \?/);
  assert.doesNotMatch(authSource, /SOCIAL_LOGIN[\s\S]{0,1800}WHERE email = \?/);
});

test('WeCom SSO never reuses WeCom messaging as its second factor', () => {
  assert.match(authSource, /provider !== 'wecom' \|\| method !== 'wecom'/);
});

test('admin UI can bind both stable external identities on create and update', () => {
  assert.match(authSource, /name="wecom_id"/);
  assert.match(authSource, /name="feishu_open_id"/);
  assert.match(authSource, /id="adminEditWecomId"/);
  assert.match(authSource, /id="adminEditFeishuOpenId"/);
  assert.match(authSource, /wecom_id: String\(formData\.get\('wecom_id'\)/);
  assert.match(authSource, /feishu_open_id: String\(formData\.get\('feishu_open_id'\)/);
});

test('pending MFA credential is signed, HttpOnly, short lived, and omitted from redirects', () => {
  assert.match(authSource, /type: 'social_login_mfa'/);
  assert.match(authSource, /const buildSocialLoginMfaCookieOptions = \(\) => \(\{[\s\S]*?httpOnly: true,[\s\S]*?sameSite: 'lax',[\s\S]*?maxAge: SOCIAL_LOGIN_MFA_TTL_SECONDS \* 1000/);
  assert.match(authSource, /buildSocialLoginPortalRedirect\(\{ context, status: 'mfa' \}\)/);
  assert.doesNotMatch(authSource, /buildSocialLoginPortalRedirect\(\{[^}]*mfaToken/);
});

test('MFA send and verify invalidate pending sessions for disabled users', () => {
  const sendStart = authSource.indexOf("app.post('/api/auth/mfa/send'");
  const verifyStart = authSource.indexOf("app.post('/api/auth/mfa/verify'");
  const settingsStart = authSource.indexOf("app.get('/api/auth/mfa/settings'");
  const sendRoute = authSource.slice(sendStart, verifyStart);
  const verifyRoute = authSource.slice(verifyStart, settingsStart);

  assert.ok(sendStart >= 0 && verifyStart > sendStart && settingsStart > verifyStart);
  assert.match(sendRoute, /!user \|\| Number\(user\.is_active\) !== 1/);
  assert.match(sendRoute, /DELETE FROM auth_mfa_sessions WHERE token = \?/);
  assert.match(verifyRoute, /!user \|\| Number\(user\.is_active\) !== 1/);
  assert.match(verifyRoute, /DELETE FROM auth_mfa_sessions WHERE token = \?/);
});

test('database, image, and compose configuration include the new social-login integration', () => {
  assert.match(dbSource, /feishu_open_id VARCHAR\(255\)/);
  assert.match(dbSource, /idx_users_feishu_open_id/);
  assert.match(dbSource, /idx_users_wecom_id/);
  assert.match(dockerfileSource, /COPY auth\/social-login\.js \.\/auth\/social-login\.js/);
  assert.match(composeSource, /AUTH_WECOM_CORP_ID:/);
  assert.match(composeSource, /AUTH_FEISHU_APP_ID:/);
  assert.equal(envExampleSource.match(/^AUTH_PUBLIC_URL=/gm)?.length, 1);
});

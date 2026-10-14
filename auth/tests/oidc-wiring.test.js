const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

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

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SECRET_MASK,
  createConfigSecretManager,
} = require('../config-secret-helpers');

test('decryptSecrets downgrades unreadable encrypted fields instead of throwing', () => {
  const manager = createConfigSecretManager({
    secretKey: 'current-secret-key',
    serviceName: 'api',
  });

  const configs = {
    email: { pass: 'enc:ZmFrZS1jaXBoZXI=' },
    sms: { accessKeySecret: 'enc:ZmFrZS1jaXBoZXI=' },
  };

  assert.doesNotThrow(() => manager.decryptSecrets(configs));
  assert.equal(configs.email.pass, '');
  assert.equal(configs.sms.accessKeySecret, '');
});

test('maskSecrets replaces configured secret fields with the shared mask', () => {
  const manager = createConfigSecretManager({
    secretKey: 'current-secret-key',
    serviceName: 'api',
  });

  assert.deepEqual(
    manager.maskSecrets({
      email: { host: 'smtp.qq.com', pass: 'secret' },
      wecom: { secret: 'abc' },
    }),
    {
      email: { host: 'smtp.qq.com', pass: SECRET_MASK },
      wecom: { secret: SECRET_MASK },
    }
  );
});

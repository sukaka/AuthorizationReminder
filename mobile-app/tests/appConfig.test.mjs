import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_COOKIE_NAME,
  createMobileAppConfig,
  getSystemByKey,
} from '../src/config/appConfig.js';

test('creates localhost development URLs by default', () => {
  const config = createMobileAppConfig({});

  assert.equal(config.auth.baseUrl, 'http://localhost:5180');
  assert.equal(config.auth.loginUrl, 'http://localhost:5180/api/auth/login');
  assert.equal(config.auth.meUrl, 'http://localhost:5180/api/auth/me');
  assert.equal(config.auth.logoutUrl, 'http://localhost:5180/api/auth/logout');
  assert.equal(AUTH_COOKIE_NAME, 'juxin_auth_token');
});

test('uses EXPO_PUBLIC_APP_HOST for phone-accessible development URLs', () => {
  const config = createMobileAppConfig({ EXPO_PUBLIC_APP_HOST: '192.168.1.20' });

  assert.equal(config.auth.baseUrl, 'http://192.168.1.20:5180');
  assert.deepEqual(
    config.systems.map((system) => [system.key, system.url]),
    [
      ['train-exam', 'http://192.168.1.20:18087'],
      ['inventory', 'http://192.168.1.20:18082'],
      ['device-flow', 'http://192.168.1.20:18083'],
    ]
  );
});

test('uses https protocol when EXPO_PUBLIC_APP_PROTOCOL is https', () => {
  const config = createMobileAppConfig({
    EXPO_PUBLIC_APP_PROTOCOL: 'https',
    EXPO_PUBLIC_APP_HOST: 'app.example.com',
  });

  assert.equal(config.auth.baseUrl, 'https://app.example.com:5180');
  assert.equal(config.systems[0].url, 'https://app.example.com:18087');
});

test('uses PUBLIC_HOST when EXPO_PUBLIC_APP_HOST is not set', () => {
  const config = createMobileAppConfig({ PUBLIC_HOST: '10.8.0.2' });

  assert.equal(config.auth.baseUrl, 'http://10.8.0.2:5180');
});

test('normalizes host whitespace, scheme, and trailing slash', () => {
  const config = createMobileAppConfig({
    EXPO_PUBLIC_APP_PROTOCOL: 'https',
    EXPO_PUBLIC_APP_HOST: ' https://example.com/ ',
  });

  assert.equal(config.auth.baseUrl, 'https://example.com:5180');
});

test('infers https when host includes an https scheme', () => {
  const config = createMobileAppConfig({ EXPO_PUBLIC_APP_HOST: 'https://example.com/' });

  assert.equal(config.auth.baseUrl, 'https://example.com:5180');
});

test('resolves systems by key', () => {
  const config = createMobileAppConfig({ EXPO_PUBLIC_APP_HOST: '10.0.0.8' });

  assert.equal(getSystemByKey(config.systems, 'inventory').name, '库存管理');
  assert.equal(getSystemByKey(config.systems, 'missing'), null);
});

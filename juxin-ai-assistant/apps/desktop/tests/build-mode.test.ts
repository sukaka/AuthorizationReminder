import { describe, expect, it } from 'vitest';

import {
  buildChannelLabelFor,
  parseBuildMode,
  validateServerOrigin,
} from '../src/buildMode';

describe('desktop build mode', () => {
  it.each([
    ['http://localhost:5193', 'lan-test', true],
    ['http://127.8.9.10:5193', 'development', true],
    ['http://10.2.3.4:5193', 'lan-test', true],
    ['http://172.16.0.1:5193', 'lan-test', true],
    ['http://172.31.255.254:5193', 'lan-test', true],
    ['http://192.168.1.20:5193', 'development', true],
    ['http://8.8.8.8:5193', 'lan-test', false],
    ['http://100.64.0.1:5193', 'lan-test', false],
    ['http://169.254.1.1:5193', 'lan-test', false],
    ['http://127.1:5193', 'lan-test', false],
    ['http://2130706433:5193', 'lan-test', false],
    ['http://0x7f000001:5193', 'lan-test', false],
    ['http://intranet.local:5193', 'lan-test', false],
    ['http://10.2.3.4:5193', 'production', false],
  ] as const)('validates %s in %s mode', (raw, mode, valid) => {
    expect(validateServerOrigin(raw, mode).kind === 'valid').toBe(valid);
  });

  it.each(['development', 'lan-test', 'production'] as const)(
    'accepts exact HTTPS origins in %s mode',
    (mode) => {
      expect(validateServerOrigin('https://ai.example.com', mode)).toEqual({
        kind: 'valid',
        origin: 'https://ai.example.com',
      });
    },
  );

  it.each([
    'http://192.168.1.20:5193/path',
    'http://192.168.1.20:5193/%2e',
    'http://192.168.1.20:5193/a/..',
    'http://user@192.168.1.20:5193',
    'http://192.168.1.20:5193?tenant=one',
    'http://192.168.1.20:5193#fragment',
    'http://*.example.com:5193',
  ])('rejects unsafe origin %s', (raw) => {
    expect(validateServerOrigin(raw, 'lan-test').kind).toBe('invalid');
  });

  it('parses modes and exposes stable Chinese channel labels', () => {
    expect(parseBuildMode('development')).toBe('development');
    expect(parseBuildMode('lan-test')).toBe('lan-test');
    expect(parseBuildMode('production')).toBe('production');
    expect(parseBuildMode('preview')).toBe('production');
    expect(buildChannelLabelFor('development')).toBe('开发版');
    expect(buildChannelLabelFor('lan-test')).toBe('内网测试版');
    expect(buildChannelLabelFor('production')).toBe('正式版');
  });
});

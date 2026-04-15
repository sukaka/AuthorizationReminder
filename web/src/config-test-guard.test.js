import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBusinessConfigSnapshot,
  pickBusinessConfigs,
  readConfigTestBlockMessage,
} from './config-test-guard.js'

test('readConfigTestBlockMessage prefers saving message while config save is in flight', () => {
  assert.equal(
    readConfigTestBlockMessage({ configDirty: true, configSaving: true }),
    '配置保存中，请稍候再测试'
  )
})

test('readConfigTestBlockMessage reports unsaved changes when config is dirty', () => {
  assert.equal(
    readConfigTestBlockMessage({ configDirty: true, configSaving: false }),
    '配置已修改但未保存，请先点击“保存配置”'
  )
})

test('readConfigTestBlockMessage allows testing when config is clean and idle', () => {
  assert.equal(readConfigTestBlockMessage({ configDirty: false, configSaving: false }), '')
})

test('pickBusinessConfigs excludes security settings from save snapshot', () => {
  assert.deepEqual(
    pickBusinessConfigs({
      email: { host: 'smtp.qq.com' },
      sms: { signName: '聚信' },
      security: { login: { maxAttempts: 5 } },
    }),
    {
      email: { host: 'smtp.qq.com' },
      sms: { signName: '聚信' },
    }
  )
})

test('buildBusinessConfigSnapshot ignores security changes for testing guard', () => {
  const baseForm = {
    email: { host: 'smtp.qq.com', port: '465' },
    security: { login: { maxAttempts: 5 } },
  }
  const changedSecurity = {
    email: { host: 'smtp.qq.com', port: '465' },
    security: { login: { maxAttempts: 10 } },
  }

  assert.equal(
    buildBusinessConfigSnapshot(baseForm),
    buildBusinessConfigSnapshot(changedSecurity)
  )
})

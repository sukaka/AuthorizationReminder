import test from 'node:test'
import assert from 'node:assert/strict'

import { readConfigTestBlockMessage } from './config-test-guard.js'

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

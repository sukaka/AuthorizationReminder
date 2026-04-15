import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUSINESS_CONFIG_SECTION_FIELDS,
  buildBusinessConfigFormFromApi,
  buildBusinessConfigSnapshot,
  CONFIG_SECRET_MASK,
  describeBusinessConfigDiffs,
  listBusinessConfigDiffPaths,
  maskBusinessSecretFields,
  pickBusinessConfigSection,
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

test('pickBusinessConfigSection returns only fields for requested section', () => {
  assert.deepEqual(
    pickBusinessConfigSection(
      {
        email: { host: 'smtp.qq.com' },
        sms: { signName: '聚信' },
        retry: { maxRetries: 2 },
      },
      'email'
    ),
    {
      email: { host: 'smtp.qq.com' },
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

test('buildBusinessConfigFormFromApi keeps masked email password after save sync', () => {
  assert.deepEqual(
    buildBusinessConfigFormFromApi(
      {
        email: {
          host: 'smtp.qq.com',
          port: '465',
          user: 'sukaka@qq.com',
          pass: CONFIG_SECRET_MASK,
          from: 'sukaka@qq.com',
          secure: true,
        },
      },
      {
        email: {
          host: 'smtp.qq.com',
          port: '465',
          user: 'sukaka@qq.com',
          pass: 'real-secret',
          from: 'sukaka@qq.com',
          secure: true,
        },
        sms: {
          endpoint: 'https://dysmsapi.aliyuncs.com',
        },
      }
    ),
    {
      email: {
        host: 'smtp.qq.com',
        port: '465',
        user: 'sukaka@qq.com',
        pass: CONFIG_SECRET_MASK,
        from: 'sukaka@qq.com',
        secure: true,
      },
      sms: {
        endpoint: 'https://dysmsapi.aliyuncs.com',
      },
      wecom: {},
      ocr: {},
      reminder: {},
      reminderSchedule: {},
      retry: {},
      rateLimit: {},
    }
  )
})

test('listBusinessConfigDiffPaths returns nested changed fields', () => {
  assert.deepEqual(
    listBusinessConfigDiffPaths(
      {
        email: { host: 'smtp.qq.com', port: '465' },
        reminderSchedule: { channels: ['email'] },
      },
      {
        email: { host: 'smtp.exmail.qq.com', port: '465' },
        reminderSchedule: { channels: ['email', 'wecom'] },
      }
    ),
    ['email.host', 'reminderSchedule.channels']
  )
})

test('describeBusinessConfigDiffs summarizes first few changed fields', () => {
  assert.equal(
    describeBusinessConfigDiffs(['email.host', 'email.pass', 'wecom.webhook', 'ocr.enabled']),
    'email.host、email.pass、wecom.webhook 等 4 项'
  )
})

test('maskBusinessSecretFields masks saved secret fields back to shared mask', () => {
  assert.deepEqual(
    maskBusinessSecretFields(
      {
        email: { host: 'smtp.qq.com', pass: 'real-secret' },
        sms: { accessKeySecret: '' },
        wecom: { secret: 'abc123' },
      },
      {
        email: { pass: CONFIG_SECRET_MASK },
        sms: { accessKeySecret: CONFIG_SECRET_MASK },
        wecom: { secret: '' },
      }
    ),
    {
      email: { host: 'smtp.qq.com', pass: CONFIG_SECRET_MASK },
      sms: { accessKeySecret: CONFIG_SECRET_MASK },
      wecom: { secret: CONFIG_SECRET_MASK },
    }
  )
})

test('BUSINESS_CONFIG_SECTION_FIELDS keeps channel sections independent', () => {
  assert.deepEqual(BUSINESS_CONFIG_SECTION_FIELDS.email, ['email'])
  assert.deepEqual(BUSINESS_CONFIG_SECTION_FIELDS.sms, ['sms'])
  assert.deepEqual(BUSINESS_CONFIG_SECTION_FIELDS.ocr, ['ocr'])
  assert.deepEqual(BUSINESS_CONFIG_SECTION_FIELDS.wecom, ['wecom'])
})

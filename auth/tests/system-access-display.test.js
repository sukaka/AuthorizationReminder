const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSystemDisplayLabel,
  summarizeSystemAccess,
} = require('../system-access-display');

test('getSystemDisplayLabel returns Chinese labels for dedicated centers', () => {
  assert.equal(getSystemDisplayLabel('admin-center'), '管理中心');
  assert.equal(getSystemDisplayLabel('audit-center'), '审计中心');
  assert.equal(getSystemDisplayLabel('delivery'), '交付系统');
  assert.equal(getSystemDisplayLabel('prompt-center'), '提示词管理中心');
  assert.equal(getSystemDisplayLabel('sca'), '软件成分分析平台');
  assert.equal(getSystemDisplayLabel('big-screen'), '统一大屏展示中心');
});

test('summarizeSystemAccess keeps first two labels and collapses overflow count', () => {
  assert.deepEqual(
    summarizeSystemAccess([
      'reminder',
      'delivery',
      'cmdb',
      'inventory',
    ]),
    {
      labels: ['提醒系统', '交付系统'],
      overflowCount: 2,
    }
  );
});

test('summarizeSystemAccess keeps all labels when only two systems are granted', () => {
  assert.deepEqual(
    summarizeSystemAccess(['faq', 'prompt-center']),
    {
      labels: ['文档管理系统', '提示词中心'],
      overflowCount: 0,
    }
  );
});

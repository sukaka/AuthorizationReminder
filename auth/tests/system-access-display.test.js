const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSystemDisplayLabel,
  summarizeSystemAccess,
} = require('../system-access-display');

test('getSystemDisplayLabel returns Chinese labels for dedicated centers', () => {
  assert.equal(getSystemDisplayLabel('admin-center'), '管理中心');
  assert.equal(getSystemDisplayLabel('audit-center'), '审计中心');
});

test('summarizeSystemAccess keeps first two labels and collapses overflow count', () => {
  assert.deepEqual(
    summarizeSystemAccess([
      'reminder',
      'ticketing',
      'cmdb',
      'inventory',
    ]),
    {
      labels: ['提醒系统', '工单系统'],
      overflowCount: 2,
    }
  );
});

test('summarizeSystemAccess keeps all labels when only two systems are granted', () => {
  assert.deepEqual(
    summarizeSystemAccess(['faq', 'train-exam']),
    {
      labels: ['FAQ系统', '培训考试系统'],
      overflowCount: 0,
    }
  );
});

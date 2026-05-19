const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSendContent,
  replaceTokens,
} = require('../reminder-content');

test('buildSendContent uses variable default reminder message instead of static fallback', () => {
  const { finalMessage } = buildSendContent({
    subject: null,
    message: null,
    contact: { name: '张三', customer_name: '测试客户' },
    license: { name: '测试授权', end_date: '2026-06-30', days_left: 30 },
    configs: {},
    channel: 'email',
  });

  assert.equal(finalMessage, '【测试客户】的测试授权将于2026-06-30到期，剩余30天。');
});

test('replaceTokens supports single and double brace variables', () => {
  assert.equal(
    replaceTokens('客户：{customer_name}，授权：{{license_name}}', {
      customer_name: '测试客户',
      license_name: '测试授权',
    }),
    '客户：测试客户，授权：测试授权'
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditRequestIpLabel,
  getAuditSystemLabel,
  getAuditDetailSummary,
  getAuditTimeLabel,
  formatAuditLogForDisplay,
} = require('../audit-log-display');

test('audit display helpers localize system, action and entity to chinese', () => {
  assert.equal(getAuditSystemLabel('sso'), '统一登录');
  assert.equal(getAuditSystemLabel('audit-center'), '审计中心');
  assert.equal(getAuditSystemLabel('ai-assistant'), '聚信 AI 助手');
  assert.equal(getAuditActionLabel('LOGIN'), '登录尝试');
  assert.equal(getAuditActionLabel('LOGIN_SUCCESS'), '登录成功');
  assert.equal(getAuditActionLabel('ENABLE_USER'), '启用用户');
  assert.equal(getAuditActionLabel('prompt.create'), '创建提示词');
  assert.equal(getAuditActionLabel('prompt.update'), '修改提示词');
  assert.equal(getAuditActionLabel('prompt.rollback'), '回滚提示词');
  assert.equal(getAuditActionLabel('prompt.archived'), '删除/归档提示词');
  assert.equal(getAuditActionLabel('prompt.favorite'), '收藏提示词');
  assert.equal(getAuditActionLabel('prompt.unfavorite'), '取消收藏提示词');
  assert.equal(getAuditActionLabel('generation.prepare'), '准备生成');
  assert.equal(getAuditActionLabel('generation.complete'), '完成生成');
  assert.equal(getAuditActionLabel('generation.regenerate'), '重新生成');
  assert.equal(getAuditActionLabel('generation.feedback'), '提交生成反馈');
  assert.equal(getAuditActionLabel('generation.delete'), '删除生成记录');
  assert.equal(getAuditActionLabel('task.create'), '创建任务');
  assert.equal(getAuditActionLabel('task.update'), '更新任务');
  assert.equal(getAuditActionLabel('task.delete'), '删除任务');
  assert.equal(getAuditActionLabel('task.fields.replace'), '替换任务字段');
  assert.equal(getAuditActionLabel('task.prompt_binding.update'), '更新任务提示词绑定');
  assert.equal(getAuditActionLabel('knowledge.create'), '新增知识');
  assert.equal(getAuditActionLabel('knowledge.update'), '更新知识');
  assert.equal(getAuditActionLabel('knowledge.disable'), '停用知识');
  assert.equal(getAuditActionLabel('setting.update'), '更新助手设置');
  assert.equal(getAuditActionLabel('suggestion.create'), '提交建议');
  assert.equal(getAuditActionLabel('suggestion.review'), '审核建议');
  assert.equal(getAuditActionLabel('authorization.denied'), '拒绝未授权操作');
  assert.equal(getAuditEntityLabel('auth'), '认证/登录');
  assert.equal(getAuditEntityLabel('send_configs'), '发送配置');
  assert.equal(getAuditEntityLabel('prompt'), '提示词');
  assert.equal(getAuditEntityLabel('department'), '部门');
  assert.equal(getAuditEntityLabel('category'), '分类');
  assert.equal(getAuditEntityLabel('generation'), '生成记录');
  assert.equal(getAuditEntityLabel('task'), '任务');
  assert.equal(getAuditEntityLabel('knowledge'), '知识');
  assert.equal(getAuditEntityLabel('setting'), '助手设置');
  assert.equal(getAuditEntityLabel('suggestion'), '建议');
  assert.equal(getAuditEntityLabel('action'), '权限动作');
});

test('formatAuditLogForDisplay returns localized labels for audit rows', () => {
  const formatted = formatAuditLogForDisplay({
    id: 1,
    system: 'sso',
    username: 'auditor',
    action: 'LOGIN_FAILED',
    entity: 'auth',
    created_at: '2026-03-15 09:00:00',
  });

  assert.equal(formatted.systemLabel, '统一登录');
  assert.equal(formatted.actionLabel, '登录失败');
  assert.equal(formatted.entityLabel, '认证/登录');
});

test('audit display helpers summarize prompt center details and time labels', () => {
  const formatted = formatAuditLogForDisplay({
    id: 3,
    system: 'prompt-center',
    username: 'zhanglei',
    action: 'prompt.update',
    entity: 'prompt',
    entity_id: 8,
    after_data: {
      title: '技术排障提示词',
      department_name: '技术部',
      category_name: '技术方案',
      version_no: 3,
    },
    request_ip: '10.0.0.8',
    created_at: '2026-05-15 10:00:00',
  });

  assert.equal(formatted.detailSummary, '技术排障提示词 / 技术部 / 技术方案 / v3');
  assert.equal(formatted.timeLabel, '操作时间');
  assert.equal(getAuditTimeLabel({ action: 'LOGIN_SUCCESS', entity: 'auth' }), '登录时间');
  assert.equal(getAuditTimeLabel({ action: 'LOGOUT', entity: 'auth' }), '登出时间');
  assert.equal(getAuditDetailSummary({ after_data: { status_label: '成功' } }), '成功');
});

test('audit display helpers distinguish login ip from generic source ip', () => {
  assert.equal(getAuditRequestIpLabel({ action: 'LOGIN_SUCCESS', entity: 'auth' }), '登录IP');
  assert.equal(getAuditRequestIpLabel({ action: 'MFA_VERIFY_FAILED', entity: 'user_mfa' }), '登录IP');
  assert.equal(getAuditRequestIpLabel({ action: 'UPDATE', entity: 'user' }), '来源IP');

  const formatted = formatAuditLogForDisplay({
    id: 2,
    system: 'sso',
    username: 'admin',
    action: 'LOGOUT',
    entity: 'auth',
    request_ip: '192.168.1.8',
    created_at: '2026-03-15 10:00:00',
  });

  assert.equal(formatted.requestIpLabel, '登录IP');
});

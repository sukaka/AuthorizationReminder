const {
  getSystemDisplayShortLabel,
} = require('./system-access-display');

const AUDIT_ACTION_OPTIONS = Object.freeze([
  { value: 'LOGIN', label: '登录尝试', tone: 'session' },
  { value: 'LOGIN_SUCCESS', label: '登录成功', tone: 'session' },
  { value: 'LOGIN_FAILED', label: '登录失败', tone: 'session' },
  { value: 'LOGOUT', label: '登出', tone: 'session' },
  { value: 'LOGIN_LOCKED', label: '登录锁定', tone: 'session' },
  { value: 'LOGIN_BLOCKED', label: '账号被禁用', tone: 'security' },
  { value: 'LOGIN_IP_RESTRICTED', label: 'IP受限', tone: 'security' },
  { value: 'LOGIN_MFA_REQUIRED', label: '需要二次验证', tone: 'security' },
  { value: 'LOGIN_MFA_SETUP_REQUIRED', label: '需要配置二次验证', tone: 'security' },
  { value: 'MFA_SEND', label: '发送验证码', tone: 'session' },
  { value: 'MFA_SEND_FAILED', label: '验证码发送失败', tone: 'security' },
  { value: 'MFA_VERIFY_OK', label: '验证码校验成功', tone: 'session' },
  { value: 'MFA_VERIFY_FAILED', label: '验证码校验失败', tone: 'security' },
  { value: 'TOTP_ENABLED', label: '开启谷歌认证', tone: 'security' },
  { value: 'CHANGE_PASSWORD', label: '修改密码', tone: 'security' },
  { value: 'RESET_PASSWORD', label: '重置密码', tone: 'security' },
  { value: 'ENABLE_USER', label: '启用用户', tone: 'security' },
  { value: 'DISABLE_USER', label: '禁用用户', tone: 'security' },
  { value: 'UNLOCK_USER', label: '解锁用户', tone: 'security' },
  { value: 'CREATE', label: '新增', tone: 'change' },
  { value: 'UPDATE', label: '更新', tone: 'change' },
  { value: 'DELETE', label: '删除', tone: 'change' },
  { value: 'IMPORT', label: '导入', tone: 'change' },
  { value: 'UPLOAD', label: '上传', tone: 'change' },
  { value: 'department.create', label: '新增部门', tone: 'change' },
  { value: 'department.update', label: '修改部门', tone: 'change' },
  { value: 'category.create', label: '新增分类', tone: 'change' },
  { value: 'category.update', label: '修改分类', tone: 'change' },
  { value: 'prompt.create', label: '创建提示词', tone: 'change' },
  { value: 'prompt.update', label: '修改提示词', tone: 'change' },
  { value: 'prompt.published', label: '发布提示词', tone: 'change' },
  { value: 'prompt.archived', label: '删除/归档提示词', tone: 'change' },
  { value: 'prompt.rollback', label: '回滚提示词', tone: 'change' },
  { value: 'prompt.use', label: '复制使用提示词', tone: 'session' },
  { value: 'prompt.favorite', label: '收藏提示词', tone: 'session' },
  { value: 'prompt.unfavorite', label: '取消收藏提示词', tone: 'session' },
  { value: 'generation.prepare', label: '准备生成', tone: 'session' },
  { value: 'generation.complete', label: '完成生成', tone: 'session' },
  { value: 'generation.regenerate', label: '重新生成', tone: 'session' },
  { value: 'generation.feedback', label: '提交生成反馈', tone: 'change' },
  { value: 'generation.delete', label: '删除生成记录', tone: 'change' },
  { value: 'task.create', label: '创建任务', tone: 'change' },
  { value: 'task.update', label: '更新任务', tone: 'change' },
  { value: 'task.delete', label: '删除任务', tone: 'change' },
  { value: 'task.fields.replace', label: '替换任务字段', tone: 'change' },
  { value: 'task.prompt_binding.update', label: '更新任务提示词绑定', tone: 'change' },
  { value: 'knowledge.create', label: '新增知识', tone: 'change' },
  { value: 'knowledge.update', label: '更新知识', tone: 'change' },
  { value: 'knowledge.disable', label: '停用知识', tone: 'change' },
  { value: 'setting.update', label: '更新助手设置', tone: 'change' },
  { value: 'suggestion.create', label: '提交建议', tone: 'change' },
  { value: 'suggestion.review', label: '审核建议', tone: 'change' },
  { value: 'authorization.denied', label: '拒绝未授权操作', tone: 'security' },
]);

const AUDIT_ENTITY_OPTIONS = Object.freeze([
  { value: 'auth', label: '认证/登录' },
  { value: 'user', label: '用户' },
  { value: 'user_mfa', label: '二次验证' },
  { value: 'send_configs', label: '发送配置' },
  { value: 'send_plan', label: '发送计划' },
  { value: 'customer', label: '客户' },
  { value: 'contact', label: '联系人' },
  { value: 'license', label: '授权' },
  { value: 'license_screenshot', label: '授权截图' },
  { value: 'ticket', label: '工单' },
  { value: 'project', label: '项目' },
  { value: 'template', label: '模板' },
  { value: 'schedule', label: '排期' },
  { value: 'permission', label: '权限' },
  { value: 'prompt', label: '提示词' },
  { value: 'department', label: '部门' },
  { value: 'category', label: '分类' },
  { value: 'generation', label: '生成记录' },
  { value: 'task', label: '任务' },
  { value: 'knowledge', label: '知识' },
  { value: 'setting', label: '助手设置' },
  { value: 'suggestion', label: '建议' },
  { value: 'action', label: '权限动作' },
]);

const AUDIT_PRESET_OPTIONS = Object.freeze([
  {
    key: 'all',
    buttonId: 'auditPresetAllBtn',
    label: '全部事件',
    summary: '跨系统查看最近一批审计动态，适合先做全局排查。',
    query: { system: '', action: '', entity: '' },
  },
  {
    key: 'login',
    buttonId: 'auditPresetLoginBtn',
    label: '登录与会话',
    summary: '聚焦登录、登出和会话相关事件，优先识别异常接入与失败重试。',
    query: { system: 'sso', action: '', entity: 'auth' },
  },
  {
    key: 'user',
    buttonId: 'auditPresetUserBtn',
    label: '用户与权限',
    summary: '快速查看用户状态、权限变更和敏感账号操作。',
    query: { system: '', action: '', entity: 'user' },
  },
  {
    key: 'config',
    buttonId: 'auditPresetConfigBtn',
    label: '配置变更',
    summary: '锁定发送配置等关键参数的更新记录，适合复核配置漂移。',
    query: { system: '', action: 'UPDATE', entity: 'send_configs' },
  },
]);

const AUDIT_ACTION_LABELS = Object.freeze(
  AUDIT_ACTION_OPTIONS.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {})
);

const AUDIT_ACTION_TONES = Object.freeze(
  AUDIT_ACTION_OPTIONS.reduce((acc, item) => {
    acc[item.value] = item.tone;
    return acc;
  }, {})
);

const AUDIT_ENTITY_LABELS = Object.freeze(
  AUDIT_ENTITY_OPTIONS.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {})
);

const getAuditSystemLabel = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '-';
  if (normalized === 'sso') return '统一登录';
  if (normalized === 'ai-assistant') return '聚信 AI 助手';
  return getSystemDisplayShortLabel(normalized) || normalized;
};

const getAuditActionLabel = (value) => {
  const normalized = String(value || '').trim();
  return AUDIT_ACTION_LABELS[normalized] || normalized || '-';
};

const getAuditActionTone = (value) => {
  const normalized = String(value || '').trim();
  return AUDIT_ACTION_TONES[normalized] || 'neutral';
};

const getAuditEntityLabel = (value) => {
  const normalized = String(value || '').trim();
  return AUDIT_ENTITY_LABELS[normalized] || normalized || '-';
};

const getAuditRequestIpLabel = (row = {}) => {
  const action = String(row.action || '').trim().toUpperCase();
  const entity = String(row.entity || '').trim().toLowerCase();
  if (
    action === 'LOGOUT'
    || action.startsWith('LOGIN')
    || action.startsWith('MFA_')
    || action.startsWith('TOTP_')
    || entity === 'auth'
    || entity === 'user_mfa'
  ) {
    return '登录IP';
  }
  return '来源IP';
};

const normalizeDetailValue = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_err) {
      return text;
    }
  }
  return value;
};

const getAuditDetailSummary = (row = {}) => {
  const detail = normalizeDetailValue(row.after_data)
    || normalizeDetailValue(row.detail)
    || normalizeDetailValue(row.detail_json)
    || normalizeDetailValue(row.message);
  if (!detail) return '-';
  if (typeof detail === 'string') return detail.slice(0, 180);
  if (typeof detail !== 'object') return String(detail);
  const parts = [
    detail.title,
    detail.name,
    detail.department_name,
    detail.category_name,
    detail.status_label,
    detail.status,
    detail.version_no ? `v${detail.version_no}` : '',
    detail.result,
    detail.message,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (parts.length) return Array.from(new Set(parts)).join(' / ').slice(0, 220);
  return JSON.stringify(detail).slice(0, 220);
};

const getAuditTimeLabel = (row = {}) => {
  const action = String(row.action || '').trim().toUpperCase();
  const entity = String(row.entity || '').trim().toLowerCase();
  if (action === 'LOGOUT') return '登出时间';
  if (action.startsWith('LOGIN') || entity === 'auth') return '登录时间';
  return '操作时间';
};

const formatAuditLogForDisplay = (row = {}) => ({
  ...row,
  systemLabel: getAuditSystemLabel(row.system),
  actionLabel: getAuditActionLabel(row.action),
  entityLabel: getAuditEntityLabel(row.entity),
  actionTone: getAuditActionTone(row.action),
  requestIpLabel: getAuditRequestIpLabel(row),
  detailSummary: getAuditDetailSummary(row),
  timeLabel: getAuditTimeLabel(row),
});

module.exports = {
  AUDIT_ACTION_OPTIONS,
  AUDIT_ENTITY_OPTIONS,
  AUDIT_PRESET_OPTIONS,
  formatAuditLogForDisplay,
  getAuditActionLabel,
  getAuditActionTone,
  getAuditDetailSummary,
  getAuditEntityLabel,
  getAuditRequestIpLabel,
  getAuditSystemLabel,
  getAuditTimeLabel,
};

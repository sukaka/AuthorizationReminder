const { resolveUserAppAccess } = require('./portal-routing');

const allow = () => ({ allow: true });
const deny = (reason) => ({ allow: false, reason });
const normalizeDepartmentKey = (value) => String(value || '').trim().toUpperCase();

const getManagedDepartmentKeys = (managedDepartments) => new Set(
  managedDepartments.flatMap((department) => {
    if (!department || typeof department !== 'object') return [normalizeDepartmentKey(department)];
    return [normalizeDepartmentKey(department.code), normalizeDepartmentKey(department.name)];
  }).filter(Boolean)
);

const authorizeAiAssistant = (user, action, scope = {}, resource = {}) => {
  if (!user) return deny('未登录');
  if (!resolveUserAppAccess(user).includes('ai-assistant')) return deny('无权限访问聚信 AI 助手');

  const role = String(user.role || '').trim().toLowerCase();
  if (action === 'app:enter' || action === 'ai_assistant:use') return allow();
  if (action === 'ai_assistant:department:stats' || action === 'ai_assistant:task:suggest') {
    const managedDepartments = Array.isArray(scope.managedDepartments) ? scope.managedDepartments : [];
    if (!managedDepartments.length) return deny('仅部门负责人可执行该操作');
    const targetDepartment = normalizeDepartmentKey(resource?.department_code);
    if (targetDepartment && !getManagedDepartmentKeys(managedDepartments).has(targetDepartment)) {
      return deny('仅可操作负责部门');
    }
    return allow();
  }
  if (action === 'ai_assistant:admin') {
    return role === 'admin' || role === 'sysadmin'
      ? allow()
      : deny('仅管理员或系统管理员可执行该操作');
  }
  if (action === 'ai_assistant:audit:read') {
    return role === 'admin' || role === 'auditor'
      ? allow()
      : deny('仅管理员或审计员可查看审计日志');
  }
  return deny('不支持的授权动作');
};

module.exports = { authorizeAiAssistant };

const ADMIN_CENTER_KEY = 'admin-center';
const AUDIT_CENTER_KEY = 'audit-center';

const SYSTEM_ACCESS_KEYS = Object.freeze([
  'reminder',
  'ticketing',
  'cmdb',
  'inventory',
  'device-flow',
  'sec-impl',
  'faq',
  'tender',
  'train-exam',
  ADMIN_CENTER_KEY,
  AUDIT_CENTER_KEY,
]);

const defaultAppAccessByRole = (role) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'admin') return [...SYSTEM_ACCESS_KEYS];
  if (normalizedRole === 'sysadmin') return [ADMIN_CENTER_KEY];
  if (normalizedRole === 'auditor') return [AUDIT_CENTER_KEY];
  if (normalizedRole === 'editor') return ['faq', 'tender', 'train-exam'];
  if (normalizedRole === 'reviewer') return ['faq', 'train-exam'];
  return ['reminder', 'train-exam'];
};

const getDefaultPortalSystemKey = (role) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'sysadmin') return ADMIN_CENTER_KEY;
  if (normalizedRole === 'auditor') return AUDIT_CENTER_KEY;
  return '';
};

const canAccessDedicatedCenter = ({ role, systemKey }) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedSystemKey = String(systemKey || '').trim().toLowerCase();
  if (normalizedRole === 'admin') return normalizedSystemKey === ADMIN_CENTER_KEY || normalizedSystemKey === AUDIT_CENTER_KEY;
  if (normalizedRole === 'sysadmin') return normalizedSystemKey === ADMIN_CENTER_KEY;
  if (normalizedRole === 'auditor') return normalizedSystemKey === AUDIT_CENTER_KEY;
  return false;
};

const getDedicatedCenterConfig = (systemKey) => {
  const normalizedSystemKey = String(systemKey || '').trim().toLowerCase();
  if (normalizedSystemKey === ADMIN_CENTER_KEY) {
    return {
      key: ADMIN_CENTER_KEY,
      title: '聚信管理后台',
      subtitle: '负责用户管理与安全管理',
      api: {
        usersList: '/api/admin-center/users',
        usersCreate: '/api/admin-center/users',
        usersItemBase: '/api/admin-center/users',
        securityGet: '/api/admin-center/security',
        securitySave: '/api/admin-center/security',
      },
    };
  }
  if (normalizedSystemKey === AUDIT_CENTER_KEY) {
    return {
      key: AUDIT_CENTER_KEY,
      title: '聚信审计中心',
      subtitle: '负责审计日志、验签与导出',
      api: {
        logsList: '/api/audit-center/logs',
        logsVerify: '/api/audit-center/logs/verify',
        logsExport: '/api/audit-center/logs/export',
      },
    };
  }
  return null;
};

const resolvePortalRedirectTarget = ({ apps, userRole, requestedSystem, portalMode }) => {
  const list = Array.isArray(apps) ? apps : [];
  const requestedKey = String(requestedSystem || '').trim();
  if (requestedKey && portalMode !== 'switch') {
    return list.find((item) => item && item.key === requestedKey) || null;
  }
  if (portalMode === 'switch') return null;
  const preferredKey = getDefaultPortalSystemKey(userRole);
  if (!preferredKey) return null;
  return list.find((item) => item && item.key === preferredKey) || list[0] || null;
};

module.exports = {
  ADMIN_CENTER_KEY,
  AUDIT_CENTER_KEY,
  canAccessDedicatedCenter,
  SYSTEM_ACCESS_KEYS,
  defaultAppAccessByRole,
  getDedicatedCenterConfig,
  getDefaultPortalSystemKey,
  resolvePortalRedirectTarget,
};

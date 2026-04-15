const ADMIN_CENTER_KEY = 'admin-center';
const AUDIT_CENTER_KEY = 'audit-center';
const DELIVERY_KEY = 'delivery';
const LEGACY_SYSTEM_ACCESS_ALIASES = Object.freeze({
  ticketing: DELIVERY_KEY,
  'sec-impl': DELIVERY_KEY,
});

const SYSTEM_ACCESS_KEYS = Object.freeze([
  'reminder',
  DELIVERY_KEY,
  'cmdb',
  'inventory',
  'device-flow',
  'faq',
  'tender',
  'train-exam',
  ADMIN_CENTER_KEY,
  AUDIT_CENTER_KEY,
]);
const BUSINESS_SYSTEM_ACCESS_KEYS = Object.freeze(
  SYSTEM_ACCESS_KEYS.filter((key) => key !== ADMIN_CENTER_KEY && key !== AUDIT_CENTER_KEY)
);

const normalizePortalRole = (role) => String(role || '').trim().toLowerCase();
const normalizeSystemAccessKey = (key) => {
  const normalized = String(key || '').trim().toLowerCase();
  if (!normalized) return '';
  return LEGACY_SYSTEM_ACCESS_ALIASES[normalized] || normalized;
};

const parseAppAccessRaw = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (_err) {
    // fall back to comma-separated values
  }
  return text.split(',').map((item) => item.trim());
};

const defaultAppAccessByRole = (role) => {
  const normalizedRole = normalizePortalRole(role);
  if (normalizedRole === 'admin') return [...BUSINESS_SYSTEM_ACCESS_KEYS];
  if (normalizedRole === 'sysadmin') return [ADMIN_CENTER_KEY];
  if (normalizedRole === 'auditor') return [AUDIT_CENTER_KEY, DELIVERY_KEY];
  if (normalizedRole === 'editor') return ['faq', 'tender', 'train-exam'];
  if (normalizedRole === 'reviewer') return ['faq', 'train-exam'];
  return ['reminder', 'train-exam'];
};

const resolveUserAppAccess = (user) => {
  if (!user) return [];
  const normalizedRole = normalizePortalRole(user.role);
  if (normalizedRole === 'admin' || normalizedRole === 'sysadmin' || normalizedRole === 'auditor') {
    return defaultAppAccessByRole(normalizedRole);
  }
  const parsed = parseAppAccessRaw(user.app_access);
  const source = parsed === null ? defaultAppAccessByRole(normalizedRole) : parsed;
  const normalized = Array.from(
    new Set(
      source
        .map((item) => normalizeSystemAccessKey(item))
        .filter((item) => BUSINESS_SYSTEM_ACCESS_KEYS.includes(item))
    )
  );
  if (!normalized.includes('train-exam') && !['sysadmin', 'auditor'].includes(normalizedRole)) {
    normalized.push('train-exam');
  }
  return normalized;
};

const getDefaultPortalSystemKey = (role) => {
  const normalizedRole = normalizePortalRole(role);
  if (normalizedRole === 'sysadmin') return ADMIN_CENTER_KEY;
  if (normalizedRole === 'auditor') return AUDIT_CENTER_KEY;
  return '';
};

const canAccessDedicatedCenter = ({ role, systemKey }) => {
  const normalizedRole = normalizePortalRole(role);
  const normalizedSystemKey = String(systemKey || '').trim().toLowerCase();
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
        usersExport: '/api/admin-center/users/export.xlsx',
        usersItemBase: '/api/admin-center/users',
        usersImport: '/api/admin-center/users/import',
        usersImportTemplate: '/api/admin-center/users/template.xlsx',
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
  DELIVERY_KEY,
  BUSINESS_SYSTEM_ACCESS_KEYS,
  canAccessDedicatedCenter,
  SYSTEM_ACCESS_KEYS,
  defaultAppAccessByRole,
  getDedicatedCenterConfig,
  getDefaultPortalSystemKey,
  normalizeSystemAccessKey,
  normalizePortalRole,
  parseAppAccessRaw,
  resolveUserAppAccess,
  resolvePortalRedirectTarget,
};

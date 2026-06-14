const normalizeRole = (value) => String(value || '').trim().toLowerCase();

const AUDITOR_INVENTORY_PATHS = new Set([
  '/api/auth/me',
  '/api/operation-logs',
  '/api/operation-logs/export.csv',
]);

const canAccessInventory = ({ role, apps, systemKey = 'inventory' } = {}) => {
  const appList = Array.isArray(apps) ? apps : [];
  if (appList.includes(systemKey)) return true;
  return systemKey === 'inventory' && normalizeRole(role) === 'auditor' && appList.includes('audit-center');
};

const canAuditorAccessInventoryPath = ({ role, method, path } = {}) => {
  if (normalizeRole(role) !== 'auditor') return true;
  if (String(method || '').toUpperCase() === 'OPTIONS') return true;
  return String(method || '').toUpperCase() === 'GET' && AUDITOR_INVENTORY_PATHS.has(String(path || ''));
};

module.exports = {
  canAccessInventory,
  canAuditorAccessInventoryPath,
};

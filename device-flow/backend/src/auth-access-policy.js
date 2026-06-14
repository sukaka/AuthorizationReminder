const normalizeRole = (value) => String(value || '').trim().toLowerCase();

const canAccessDeviceFlow = ({ role, apps, systemKey = 'device-flow' } = {}) => {
  const appList = Array.isArray(apps) ? apps : [];
  if (appList.includes(systemKey)) return true;
  return systemKey === 'device-flow' && normalizeRole(role) === 'auditor' && appList.includes('audit-center');
};

module.exports = {
  canAccessDeviceFlow,
};

const { resolveUserAppAccess } = require('./portal-routing');

const normalizeUserRow = (row) => {
  const id = Number(row?.id || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const username = String(row?.username || '').trim();
  if (!username) return null;
  return {
    id,
    username,
    role: String(row?.role || '').trim().toLowerCase(),
    department_code: String(row?.department_code || '').trim().toUpperCase(),
    app_access: resolveUserAppAccess(row),
  };
};

const canAppearInSystemDirectory = (row, systemKey) => {
  if (Number(row?.is_active || 0) !== 1) return false;
  const normalized = normalizeUserRow(row);
  if (!normalized) return false;
  if (normalized.app_access.includes(systemKey)) return true;
  return systemKey === 'device-flow' && normalized.role === 'sysadmin';
};

const buildSystemUserDirectory = (rows, systemKey) => {
  const system = String(systemKey || '').trim();
  if (!system) return [];
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => canAppearInSystemDirectory(row, system))
    .map(normalizeUserRow)
    .filter(Boolean);
};

module.exports = {
  buildSystemUserDirectory,
};

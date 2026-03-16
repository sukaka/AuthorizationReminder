const BUSINESS_BLOCKED_ROLES = new Set(['sysadmin', 'auditor']);

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const normalizeRole = (role) => trimText(role).toLowerCase();

const normalizeDepartmentCode = (departmentCode) => {
  const value = trimText(departmentCode).toUpperCase();
  return value || '';
};

const normalizeLibraryScope = (libraryScope) => {
  const value = trimText(libraryScope).toLowerCase();
  return value === 'global' ? 'global' : 'department';
};

const parseDate = (value) => {
  const text = trimText(value);
  if (!text) return null;
  const date = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const getUserDepartmentCode = (user) => normalizeDepartmentCode(user?.scope?.department?.code || user?.department_code);

const getManagedDepartmentCodes = (user) =>
  Array.from(
    new Set(
      (Array.isArray(user?.scope?.managedDepartments) ? user.scope.managedDepartments : [])
        .map((item) => normalizeDepartmentCode(item?.code))
        .filter(Boolean)
    )
  );

const isBusinessReader = (user) => {
  const role = normalizeRole(user?.role);
  if (!role) return false;
  return !BUSINESS_BLOCKED_ROLES.has(role);
};

const isAdminUser = (user) => normalizeRole(user?.role) === 'admin';

const hasActiveGrant = (grant) => {
  if (!grant) return false;
  const status = trimText(grant.status).toLowerCase();
  if (status && !['approved', 'active'].includes(status)) return false;
  const expiresAt = parseDate(grant.expires_at);
  if (!expiresAt) return true;
  return expiresAt.getTime() > Date.now();
};

const canManageDepartmentContent = (user, departmentCode) => {
  if (isAdminUser(user)) return true;
  const targetCode = normalizeDepartmentCode(departmentCode);
  if (!targetCode) return false;
  const role = normalizeRole(user?.role);
  const managed = getManagedDepartmentCodes(user);
  if (managed.includes(targetCode)) return true;
  if (getUserDepartmentCode(user) !== targetCode) return false;
  return role === 'editor';
};

const canReviewDepartmentRequest = (user, departmentCode) => {
  if (isAdminUser(user)) return true;
  const targetCode = normalizeDepartmentCode(departmentCode);
  if (!targetCode) return false;
  return getManagedDepartmentCodes(user).includes(targetCode);
};

const resolveArticleAccess = ({ user, article, activeGrant } = {}) => {
  const scope = normalizeLibraryScope(article?.library_scope);
  const departmentCode = normalizeDepartmentCode(article?.department_code);
  if (isAdminUser(user)) {
    return {
      canRead: true,
      canManage: true,
      canRequest: false,
      visibility: 'full',
      library_scope: scope,
      department_code: departmentCode || null,
    };
  }
  if (!isBusinessReader(user)) {
    return {
      canRead: false,
      canManage: false,
      canRequest: false,
      visibility: 'forbidden',
      library_scope: scope,
      department_code: departmentCode || null,
    };
  }
  if (scope === 'global') {
    return {
      canRead: true,
      canManage: false,
      canRequest: false,
      visibility: 'full',
      library_scope: scope,
      department_code: null,
    };
  }

  const userDepartment = getUserDepartmentCode(user);
  if (departmentCode && departmentCode === userDepartment) {
    return {
      canRead: true,
      canManage: canManageDepartmentContent(user, departmentCode),
      canRequest: false,
      visibility: 'full',
      library_scope: scope,
      department_code: departmentCode,
    };
  }
  if (hasActiveGrant(activeGrant)) {
    return {
      canRead: true,
      canManage: false,
      canRequest: false,
      visibility: 'full',
      library_scope: scope,
      department_code: departmentCode,
    };
  }
  return {
    canRead: false,
    canManage: false,
    canRequest: true,
    visibility: 'restricted',
    library_scope: scope,
    department_code: departmentCode,
  };
};

const parseTags = (value) => {
  if (Array.isArray(value)) return value;
  const text = trimText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const sanitizeArticleForList = (article, access) => {
  const base = {
    ...article,
    library_scope: normalizeLibraryScope(article?.library_scope),
    department_code: normalizeDepartmentCode(article?.department_code) || null,
  };
  if (access?.visibility !== 'restricted') {
    return {
      ...base,
      tags: parseTags(article?.tags_json ?? article?.tags),
      visibility: access?.visibility || 'full',
      restricted: false,
      can_request_access: false,
    };
  }
  return {
    ...base,
    summary: '',
    tags_json: '[]',
    tags: [],
    match_snippet: '',
    matched_search_text: '',
    category_name: '',
    current_version_id: null,
    published_version_id: null,
    visibility: 'restricted',
    restricted: true,
    can_request_access: access?.canRequest === true,
  };
};

module.exports = {
  canManageDepartmentContent,
  canReviewDepartmentRequest,
  getManagedDepartmentCodes,
  getUserDepartmentCode,
  hasActiveGrant,
  isAdminUser,
  isBusinessReader,
  normalizeDepartmentCode,
  normalizeLibraryScope,
  resolveArticleAccess,
  sanitizeArticleForList,
};

const normalizeText = (value) => String(value ?? '').trim();

const permissionByRole = {
  admin: new Set([
    'tender:read',
    'tender:write',
    'tender:template:manage',
    'tender:config:manage',
    'tender:ai:use',
    'tender:ai:manage',
  ]),
  editor: new Set(['tender:read', 'tender:write', 'tender:template:manage', 'tender:ai:use']),
  sysadmin: new Set(['tender:read', 'tender:config:manage', 'tender:ai:manage']),
  auditor: new Set(['tender:audit:read']),
};

const dataScopeByRole = {
  admin: 'ALL',
  editor: 'OWNED_OR_ASSIGNED',
  sysadmin: 'ALL',
  auditor: 'AUDIT_ONLY',
};

const accessCatalogByRole = {
  admin: {
    menu_permissions: ['dashboard', 'bids', 'risk-center', 'template-center', 'export-center', 'evaluation-center', 'assets', 'kb', 'ai', 'config'],
    page_permissions: [
      'dashboard.home',
      'bid.list',
      'bid.detail',
      'bid.lifecycle',
      'bid.parse.workspace',
      'bid.draft.workspace',
      'risk.center',
      'template.center',
      'export.center',
      'evaluation.center',
      'asset.list',
      'kb.center',
      'ai.center',
      'config.center',
    ],
    button_permissions: [
      'bid.create',
      'bid.edit',
      'bid.member.assign',
      'bid.status.change',
      'parse.upload',
      'parse.start',
      'parse.match.confirm',
      'draft.save',
      'draft.check',
      'draft.optimize',
      'draft.autosave',
      'draft.rollback',
      'export.run',
      'evaluation.dataset.manage',
      'evaluation.run.start',
      'evaluation.run.view',
      'template.manage',
      'ai.task.run',
      'ai.model.manage',
      'ai.prompt.manage',
      'config.save',
    ],
  },
  editor: {
    menu_permissions: ['dashboard', 'bids', 'risk-center', 'template-center', 'export-center', 'evaluation-center', 'assets', 'kb', 'ai'],
    page_permissions: [
      'dashboard.home',
      'bid.list',
      'bid.detail',
      'bid.lifecycle',
      'bid.parse.workspace',
      'bid.draft.workspace',
      'risk.center',
      'template.center',
      'export.center',
      'evaluation.center',
      'asset.list',
      'kb.center',
      'ai.center',
    ],
    button_permissions: [
      'bid.create',
      'bid.edit',
      'bid.member.assign',
      'bid.status.change',
      'parse.upload',
      'parse.start',
      'parse.match.confirm',
      'draft.save',
      'draft.check',
      'draft.optimize',
      'draft.autosave',
      'draft.rollback',
      'export.run',
      'evaluation.run.view',
      'template.manage',
      'ai.task.run',
    ],
  },
  sysadmin: {
    menu_permissions: ['dashboard', 'kb', 'ai', 'config'],
    page_permissions: ['dashboard.home', 'kb.center', 'ai.center', 'config.center'],
    button_permissions: ['ai.model.manage', 'ai.prompt.manage', 'config.save'],
  },
  auditor: {
    menu_permissions: ['audit'],
    page_permissions: ['audit.logs', 'audit.verify'],
    button_permissions: ['audit.export', 'audit.verify'],
  },
};

const resolveRole = (user) => normalizeText(user?.role).toLowerCase() || 'unknown';

const resolveDataScope = (user) => dataScopeByRole[resolveRole(user)] || 'NONE';

const hasPermission = (user, permission) => {
  const set = permissionByRole[resolveRole(user)] || new Set();
  return set.has(permission);
};

const buildPermissionSummary = (user) => {
  const role = resolveRole(user);
  const access = accessCatalogByRole[role] || {
    menu_permissions: [],
    page_permissions: [],
    button_permissions: [],
  };
  return {
    can_read: hasPermission(user, 'tender:read'),
    can_write: hasPermission(user, 'tender:write'),
    can_template_manage: hasPermission(user, 'tender:template:manage'),
    can_config_manage: hasPermission(user, 'tender:config:manage'),
    can_audit_read: hasPermission(user, 'tender:audit:read'),
    can_ai_use: hasPermission(user, 'tender:ai:use'),
    can_ai_manage: hasPermission(user, 'tender:ai:manage'),
    menu_permissions: [...access.menu_permissions],
    page_permissions: [...access.page_permissions],
    button_permissions: [...access.button_permissions],
  };
};

const buildPermissionMatrix = () =>
  Object.fromEntries(
    Object.entries(permissionByRole).map(([role, permissionSet]) => [
      role,
      {
        permissions: Array.from(permissionSet.values()).sort(),
        data_scope: dataScopeByRole[role] || 'NONE',
        menu_permissions: [...(accessCatalogByRole[role]?.menu_permissions || [])],
        page_permissions: [...(accessCatalogByRole[role]?.page_permissions || [])],
        button_permissions: [...(accessCatalogByRole[role]?.button_permissions || [])],
      },
    ])
  );

const buildGovernancePayload = (user) => {
  const role = resolveRole(user);
  const access = accessCatalogByRole[role] || {
    menu_permissions: [],
    page_permissions: [],
    button_permissions: [],
  };
  const scope = resolveDataScope(user);

  return {
    current_role: role || 'unknown',
    data_scope: {
      mode: scope,
      description: scope === 'OWNED_OR_ASSIGNED'
        ? '仅可查看本人创建或被分派参与的项目'
        : scope === 'AUDIT_ONLY'
          ? '仅可查看审计相关数据'
          : scope === 'ALL'
            ? '可查看全部项目'
            : '无业务数据范围',
    },
    menu_permissions: [...access.menu_permissions],
    page_permissions: [...access.page_permissions],
    button_permissions: [...access.button_permissions],
    permission_matrix: buildPermissionMatrix(),
  };
};

const inferFailureCategory = ({ path = '', errCategory = '', status = 500 } = {}) => {
  const normalizedCategory = normalizeText(errCategory).toUpperCase();
  if (normalizedCategory) return normalizedCategory;
  const pathText = normalizeText(path).toLowerCase();
  if (pathText.includes('/upload')) return 'UPLOAD';
  if (pathText.includes('/parse')) return 'PARSE';
  if (pathText.includes('/analyze')) return 'PARSE';
  if (pathText.includes('/export')) return 'EXPORT';
  if (pathText.includes('/generate')) return 'GENERATE';
  if (pathText.includes('/draft')) return 'GENERATE';
  if (status >= 500) return 'INTERNAL';
  return 'REQUEST';
};

const buildFailurePayload = ({ err, path = '', method = '' } = {}) => {
  const status = Number(err?.statusCode || err?.status || 500);
  const payload = {
    error: normalizeText(err?.message) || '服务器内部错误',
    code: normalizeText(err?.code) || (status >= 500 ? 'TENDER_INTERNAL_ERROR' : 'TENDER_REQUEST_FAILED'),
    category: inferFailureCategory({
      path,
      errCategory: err?.category,
      status,
    }),
    retryable: !!err?.retryable,
    manual_takeover: err?.manual_takeover || null,
  };
  if (err?.details && typeof err.details === 'object') {
    payload.details = err.details;
  }

  const normalizedMethod = normalizeText(method).toUpperCase();
  const normalizedPath = normalizeText(path);

  return {
    status,
    payload,
    should_log: normalizedPath.startsWith('/api/tender'),
    failure_log: {
      action: 'REQUEST_FAIL',
      entity: `${normalizedMethod} ${normalizedPath}`.trim() || 'REQUEST_FAIL',
      message: `${payload.code}: ${payload.error}`.slice(0, 255),
      afterData: {
        method: normalizedMethod || null,
        path: normalizedPath || null,
        status,
        code: payload.code,
        category: payload.category,
        retryable: payload.retryable,
        manual_takeover: payload.manual_takeover,
        details: payload.details || null,
      },
    },
  };
};

module.exports = {
  permissionByRole,
  dataScopeByRole,
  accessCatalogByRole,
  resolveDataScope,
  hasPermission,
  buildPermissionSummary,
  buildPermissionMatrix,
  buildGovernancePayload,
  buildFailurePayload,
};

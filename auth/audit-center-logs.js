const {
  formatAuditLogForDisplay,
} = require('./audit-log-display');

const clampLimit = (value, fallback, min, max) => {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(min, Math.round(limit)));
};

const AUDIT_EXPORT_COLUMNS = Object.freeze([
  { key: 'id', label: 'ID' },
  { key: 'systemLabel', label: '系统' },
  { key: 'username', label: '用户' },
  { key: 'actionLabel', label: '动作' },
  { key: 'entityLabel', label: '对象' },
  { key: 'entity_id', label: '对象ID' },
  { key: 'request_ip', label: 'IP地址' },
  { key: 'created_at', label: '时间' },
  { key: 'prev_hash', label: '前一条签名' },
  { key: 'signature', label: '当前签名' },
  { key: 'before_data', label: '变更前' },
  { key: 'after_data', label: '变更后' },
]);

const CROSS_SYSTEM_VERIFY_REASON = '跨系统汇总视图暂不支持统一验签，请先筛选单个系统后再校验审计链';
const DEFAULT_AUDIT_PAGE_SIZE = 10;
const MAX_AUDIT_PAGE_SIZE = 2000;
const REMOTE_FETCH_TIMEOUT_MS = 5000;

const encodeCsvCell = (value) => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${String(text).replaceAll('"', '""')}"`;
};

const serializeLogsAsCsv = (rows = []) => {
  const list = Array.isArray(rows) ? rows.map((row) => formatAuditLogForDisplay(row)) : [];
  const lines = [AUDIT_EXPORT_COLUMNS.map((column) => column.label).join(',')];
  list.forEach((row) => {
    lines.push(
      AUDIT_EXPORT_COLUMNS
        .map((column) => encodeCsvCell(row?.[column.key]))
        .join(',')
    );
  });
  return lines.join('\n');
};

const normalizeText = (value) => String(value || '').trim();

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
};

const formatDateTime = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const readNumericTotal = (...values) => {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      return Math.round(num);
    }
  }
  return null;
};

const normalizeAuditTimestamp = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;
  const normalized = text.includes(' ') && !text.includes('T')
    ? text.replace(' ', 'T')
    : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return text;
  return formatDateTime(parsed);
};

const parseAuditTime = (value, endOfDay = false) => {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
    const parsed = new Date(`${text}${suffix}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  const normalized = text.includes(' ') && !text.includes('T')
    ? text.replace(' ', 'T')
    : text;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const toDateOnly = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeAuditRow = (system, row = {}) => ({
  id: row.id ?? null,
  user_id: row.user_id ?? row.operator_id ?? row.actor_sub ?? null,
  user_sub: row.user_sub ?? row.actor_sub ?? null,
  username: firstNonEmpty(row.username, row.operator_name, row.actor_name, row.actor_sub, '系统'),
  user_role: firstNonEmpty(row.user_role, row.operator_role),
  system,
  action: normalizeText(row.action) || 'UNKNOWN',
  entity: normalizeText(row.entity || row.resource_type) || 'unknown',
  entity_id: row.entity_id ?? row.article_id ?? row.resource_uid ?? null,
  message: normalizeText(row.message),
  before_data: row.before_data ?? null,
  after_data: row.after_data ?? null,
  prev_hash: row.prev_hash ?? row.chain_prev_hash ?? null,
  signature: row.signature ?? row.chain_hash ?? null,
  sign_version: row.sign_version ?? row.chain_version ?? null,
  request_ip: normalizeText(row.request_ip ?? row.source_ip) || null,
  created_at: normalizeAuditTimestamp(row.created_at),
});

const REMOTE_SOURCE_DEFINITIONS = Object.freeze({
  inventory: Object.freeze({
    key: 'inventory',
    listPath: '/api/operation-logs',
    buildListQuery(query, take) {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('limit', String(take));
      if (query.username) params.set('username', normalizeText(query.username));
      if (query.action) params.set('action', normalizeText(query.action));
      if (query.entity) params.set('entity', normalizeText(query.entity));
      if (query.date_from) params.set('from', toDateOnly(query.date_from));
      if (query.date_to) params.set('to', toDateOnly(query.date_to));
      return params;
    },
    extractRows(data) {
      return Array.isArray(data) ? data : [];
    },
    normalizeRow(row) {
      return normalizeAuditRow('inventory', row);
    },
  }),
  'device-flow': Object.freeze({
    key: 'device-flow',
    listPath: '/api/device-flow/logs',
    verifyPath: '/api/device-flow/audit/verify',
    buildListQuery(query, take) {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('limit', String(take));
      if (query.username) params.set('username', normalizeText(query.username));
      if (query.action) params.set('action', normalizeText(query.action));
      if (query.date_from) params.set('from', toDateOnly(query.date_from));
      if (query.date_to) params.set('to', toDateOnly(query.date_to));
      return params;
    },
    extractRows(data) {
      return Array.isArray(data) ? data : [];
    },
    normalizeRow(row) {
      return normalizeAuditRow('device-flow', row);
    },
  }),
  'sec-impl': Object.freeze({
    key: 'sec-impl',
    listPath: '/api/sec-impl/logs',
    verifyPath: '/api/sec-impl/audit/verify',
    buildListQuery(query, take) {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('limit', String(take));
      if (query.username) params.set('username', normalizeText(query.username));
      if (query.action) params.set('action', normalizeText(query.action));
      if (query.date_from) params.set('from', toDateOnly(query.date_from));
      if (query.date_to) params.set('to', toDateOnly(query.date_to));
      return params;
    },
    extractRows(data) {
      return Array.isArray(data) ? data : [];
    },
    normalizeRow(row) {
      return normalizeAuditRow('sec-impl', row);
    },
  }),
  faq: Object.freeze({
    key: 'faq',
    listPath: '/api/faq/logs',
    buildListQuery(_query, take) {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('limit', String(Math.min(take, 200)));
      return params;
    },
    extractRows(data) {
      return Array.isArray(data?.items) ? data.items : [];
    },
    normalizeRow(row) {
      return normalizeAuditRow('faq', {
        ...row,
        user_id: row.operator_id,
        username: row.operator_name,
        user_role: row.operator_role,
        entity: row.article_id ? 'article' : 'faq',
        entity_id: row.article_id,
      });
    },
  }),
  tender: Object.freeze({
    key: 'tender',
    listPath: '/api/tender/audit/logs',
    verifyPath: '/api/tender/audit/verify',
    buildListQuery(query, take) {
      const params = new URLSearchParams();
      params.set('limit', String(take));
      if (query.username) params.set('username', normalizeText(query.username));
      if (query.action) params.set('action', normalizeText(query.action));
      if (query.entity) params.set('entity', normalizeText(query.entity));
      if (query.date_from) params.set('date_from', normalizeText(query.date_from));
      if (query.date_to) params.set('date_to', normalizeText(query.date_to));
      return params;
    },
    extractRows(data) {
      return Array.isArray(data) ? data : [];
    },
    normalizeRow(row) {
      return normalizeAuditRow('tender', row);
    },
  }),
  'train-exam': Object.freeze({
    key: 'train-exam',
    listPath: '/api/train-exam/audit/logs',
    buildListQuery(query, take) {
      const params = new URLSearchParams();
      params.set('limit', String(take));
      if (query.username) params.set('username', normalizeText(query.username));
      if (query.action) params.set('action', normalizeText(query.action));
      if (query.entity) params.set('entity', normalizeText(query.entity));
      return params;
    },
    extractRows(data) {
      return Array.isArray(data) ? data : [];
    },
    normalizeRow(row) {
      return normalizeAuditRow('train-exam', row);
    },
  }),
  cmdb: Object.freeze({
    key: 'cmdb',
    listPath: '/api/v1/audit/logs',
    buildListQuery(query, take) {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('page_size', String(Math.min(take, 200)));
      if (query.username) params.set('actor', normalizeText(query.username));
      if (query.action) params.set('action', normalizeText(query.action));
      if (query.entity) params.set('resource_type', normalizeText(query.entity));
      if (query.date_from) params.set('date_from', normalizeText(query.date_from));
      if (query.date_to) params.set('date_to', normalizeText(query.date_to));
      return params;
    },
    extractRows(data) {
      return Array.isArray(data?.items) ? data.items : [];
    },
    normalizeRow(row) {
      return normalizeAuditRow('cmdb', {
        id: row.id,
        user_id: row.actor_sub,
        user_sub: row.actor_sub,
        username: row.actor_name || row.actor_sub,
        action: row.action,
        entity: row.resource_type,
        entity_id: row.resource_uid,
        request_ip: row.source_ip,
        created_at: row.created_at,
        message: [normalizeText(row.http_method), normalizeText(row.http_path)].filter(Boolean).join(' '),
        after_data: {
          result: row.result || null,
          status_code: row.status_code ?? null,
          request_id: row.request_id || null,
        },
      });
    },
  }),
});

const buildRemoteHeaders = ({ authToken, cookieHeader } = {}) => {
  const headers = { Accept: 'application/json' };
  if (normalizeText(authToken)) headers.Authorization = `Bearer ${normalizeText(authToken)}`;
  if (normalizeText(cookieHeader)) headers.Cookie = normalizeText(cookieHeader);
  return headers;
};

const defaultFetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || REMOTE_FETCH_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: options.headers || {},
      signal: controller.signal,
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`${response.status} ${bodyText || 'remote audit request failed'}`.trim());
    }
    const rawText = await response.text();
    return rawText ? JSON.parse(rawText) : [];
  } finally {
    clearTimeout(timer);
  }
};

const buildUrl = (baseUrl, path, params) => {
  const origin = normalizeText(baseUrl).replace(/\/+$/, '');
  const pathname = path.startsWith('/') ? path : `/${path}`;
  const queryString = params instanceof URLSearchParams ? params.toString() : '';
  return queryString ? `${origin}${pathname}?${queryString}` : `${origin}${pathname}`;
};

const readRemotePayloadTotal = (data) => readNumericTotal(
  data?.total,
  data?.total_count,
  data?.count,
  data?.pagination?.total,
  data?.page?.total,
  data?.meta?.total,
  data?.meta?.count,
  data?.stats?.total,
);

const parseAuditPage = (value) => clampLimit(value, 1, 1, 100000);

const parseAuditPageSize = (value) => clampLimit(value, DEFAULT_AUDIT_PAGE_SIZE, 1, MAX_AUDIT_PAGE_SIZE);

const filterAuditRows = (rows = [], query = {}) => {
  const username = normalizeText(query.username).toLowerCase();
  const system = normalizeText(query.system);
  const action = normalizeText(query.action);
  const entity = normalizeText(query.entity);
  const fromAt = parseAuditTime(query.date_from, false);
  const toAt = parseAuditTime(query.date_to, true);

  return rows.filter((row) => {
    if (system && normalizeText(row.system) !== system) return false;
    if (username && !normalizeText(row.username).toLowerCase().includes(username)) return false;
    if (action && normalizeText(row.action) !== action) return false;
    if (entity && normalizeText(row.entity) !== entity) return false;
    const rowTime = parseAuditTime(row.created_at, false);
    if (fromAt !== null && (rowTime === null || rowTime < fromAt)) return false;
    if (toAt !== null && (rowTime === null || rowTime > toAt)) return false;
    return true;
  });
};

const sortAuditRows = (rows = []) =>
  [...rows].sort((left, right) => {
    const timeDiff = (parseAuditTime(right.created_at, false) || 0) - (parseAuditTime(left.created_at, false) || 0);
    if (timeDiff !== 0) return timeDiff;
    const rightId = Number(right.id || 0);
    const leftId = Number(left.id || 0);
    if (Number.isFinite(rightId) && Number.isFinite(leftId) && rightId !== leftId) {
      return rightId - leftId;
    }
    return normalizeText(right.system).localeCompare(normalizeText(left.system), 'zh-CN');
  });

const buildLocalLogsWhere = (query = {}) => {
  const { username, system, action, entity, date_from, date_to } = query || {};
  const where = [];
  const params = [];
  if (system) {
    where.push('log_system = ?');
    params.push(normalizeText(system));
  }
  if (username) {
    where.push('username LIKE ?');
    params.push(`%${normalizeText(username)}%`);
  }
  if (action) {
    where.push('action = ?');
    params.push(normalizeText(action));
  }
  if (entity) {
    where.push('entity = ?');
    params.push(normalizeText(entity));
  }
  if (date_from) {
    where.push('created_at >= ?');
    params.push(normalizeText(date_from));
  }
  if (date_to) {
    where.push('created_at <= ?');
    params.push(normalizeText(date_to));
  }
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
};

const queryLocalLogs = async ({ db, query = {}, take }) => {
  const { whereSql, params } = buildLocalLogsWhere(query);
  const [countRows, rows] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS total_count
       FROM operation_logs
       ${whereSql}`,
      params
    ),
    db.query(
      `SELECT
         id, user_id, username, log_system AS \`system\`, action, entity, entity_id,
         before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at
       FROM operation_logs
       ${whereSql}
       ORDER BY id DESC
       LIMIT ?`,
      [...params, take]
    ),
  ]);
  const normalizedRows = Array.isArray(rows) ? rows.map((row) => normalizeAuditRow(row.system, row)) : [];
  const matchedTotal = readNumericTotal(countRows?.[0]?.total_count, countRows?.[0]?.total, normalizedRows.length) ?? normalizedRows.length;
  return {
    rows: normalizedRows,
    matchedTotal,
    matchedTotalIsExact: true,
  };
};

const resolveConfiguredRemoteSources = (remoteBaseUrls = {}, system = '') => {
  const selectedSystem = normalizeText(system);
  if (selectedSystem) {
    const definition = REMOTE_SOURCE_DEFINITIONS[selectedSystem];
    const baseUrl = normalizeText(remoteBaseUrls[selectedSystem]);
    return definition && baseUrl ? [{ ...definition, baseUrl }] : [];
  }

  return Object.entries(REMOTE_SOURCE_DEFINITIONS)
    .map(([key, definition]) => {
      const baseUrl = normalizeText(remoteBaseUrls[key]);
      return baseUrl ? { ...definition, baseUrl } : null;
    })
    .filter(Boolean);
};

const fetchRemoteLogs = async ({
  source,
  query,
  take,
  fetchJson,
  authToken,
  cookieHeader,
}) => {
  const url = buildUrl(source.baseUrl, source.listPath, source.buildListQuery(query, take));
  const data = await fetchJson(url, {
    headers: buildRemoteHeaders({ authToken, cookieHeader }),
    timeoutMs: REMOTE_FETCH_TIMEOUT_MS,
  });
  const rows = source.extractRows(data).map((row) => source.normalizeRow(row));
  const explicitTotal = readRemotePayloadTotal(data);
  return {
    rows,
    matchedTotal: explicitTotal ?? rows.length,
    matchedTotalIsExact: explicitTotal !== null || rows.length < take,
  };
};

const normalizeRemoteVerifyResult = (sourceKey, data = {}) => {
  if (sourceKey === 'device-flow' || sourceKey === 'sec-impl') {
    const issueCount = Number(data.issue_count || 0);
    const firstIssueId = Number(Array.isArray(data.issues) ? data.issues[0]?.id || 0 : 0);
    const result = {
      ok: Boolean(data.passed),
      checked: Number(data.total_checked || 0),
      latest_id: Number(data.range?.to_id || 0),
      reason: data.passed ? '' : (issueCount ? `审计链校验失败，发现 ${issueCount} 处异常` : '审计链校验失败'),
    };
    if (!result.ok && firstIssueId) result.failed_id = firstIssueId;
    return result;
  }
  const normalized = {
    ok: Boolean(data.ok),
    checked: Number(data.checked || 0),
    latest_id: Number(data.latest_id || 0),
    reason: normalizeText(data.reason),
  };
  const failedId = Number(data.failed_id || 0);
  if (!normalized.ok && failedId) normalized.failed_id = failedId;
  return normalized;
};

const fetchRemoteVerifyResult = async ({
  source,
  limit,
  fetchJson,
  authToken,
  cookieHeader,
}) => {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  const url = buildUrl(source.baseUrl, source.verifyPath, params);
  const data = await fetchJson(url, {
    headers: buildRemoteHeaders({ authToken, cookieHeader }),
    timeoutMs: REMOTE_FETCH_TIMEOUT_MS,
  });
  return normalizeRemoteVerifyResult(source.key, data);
};

const createAuditCenterLogsService = ({
  db,
  computeAuditSignature,
  fetchJson = defaultFetchJson,
  remoteBaseUrls = {},
} = {}) => {
  if (!db || typeof db !== 'object') throw new Error('db adapter is required');
  if (typeof computeAuditSignature !== 'function') throw new Error('computeAuditSignature is required');
  if (typeof fetchJson !== 'function') throw new Error('fetchJson is required');

  return {
    async listLogs({ query = {}, authToken = '', cookieHeader = '' } = {}) {
      if (typeof db.query !== 'function') throw new Error('db adapter is missing method(s): query');

      const take = clampLimit(query.limit, 300, 1, 2000);
      const page = parseAuditPage(query.page);
      const pageSize = parseAuditPageSize(query.page_size);
      const selectedSystem = normalizeText(query.system);
      const remoteSources = resolveConfiguredRemoteSources(remoteBaseUrls, selectedSystem);
      const shouldQueryLocal = !selectedSystem || remoteSources.length === 0;
      const jobs = [];

      if (shouldQueryLocal) {
        jobs.push(
          queryLocalLogs({
            db,
            query: selectedSystem && remoteSources.length === 0 ? query : { ...query, system: selectedSystem && !remoteSources.length ? selectedSystem : '' },
            take,
          })
        );
      }

      remoteSources.forEach((source) => {
        jobs.push(
          fetchRemoteLogs({
            source,
            query,
            take,
            fetchJson,
            authToken,
            cookieHeader,
          }).catch((error) => {
            console.warn(`[audit-center] remote source ${source.key} failed: ${error?.message || error}`);
            return {
              rows: [],
              matchedTotal: 0,
              matchedTotalIsExact: false,
            };
          })
        );
      });

      const resultGroups = await Promise.all(jobs);
      const merged = sortAuditRows(filterAuditRows(resultGroups.flatMap((group) => group.rows || []), query)).slice(0, take);
      const total = merged.length;
      const matchedTotal = resultGroups.reduce((sum, group) => sum + readNumericTotal(group?.matchedTotal, 0), 0);
      const matchedTotalIsExact = resultGroups.every((group) => group?.matchedTotalIsExact !== false);
      const totalPages = total ? Math.ceil(total / pageSize) : 0;
      const offset = (page - 1) * pageSize;
      const systems = new Set(merged.map((row) => normalizeText(row.system)).filter(Boolean)).size;

      return {
        items: offset >= total ? [] : merged.slice(offset, offset + pageSize),
        page,
        pageSize,
        total,
        matchedTotal: Math.max(total, matchedTotal),
        matchedTotalIsExact,
        totalPages,
        hasMore: offset + pageSize < total,
        systems,
        queryLimit: take,
      };
    },

    async verifyLogChain({ limitInput, system = '', authToken = '', cookieHeader = '' } = {}) {
      if (typeof db.query !== 'function') throw new Error('db adapter is missing method(s): query');
      const limit = clampLimit(limitInput, 10000, 1, 50000);
      const selectedSystem = normalizeText(system);

      if (selectedSystem) {
        const remoteSource = resolveConfiguredRemoteSources(remoteBaseUrls, selectedSystem)[0] || null;
        if (remoteSource) {
          if (!remoteSource.verifyPath) {
            return {
              ok: false,
              checked: 0,
              latest_id: 0,
              reason: `${selectedSystem} 暂不支持审计链验签`,
            };
          }
          return fetchRemoteVerifyResult({
            source: remoteSource,
            limit,
            fetchJson,
            authToken,
            cookieHeader,
          });
        }
      } else if (Object.keys(remoteBaseUrls || {}).some((key) => normalizeText(remoteBaseUrls[key]))) {
        return {
          ok: false,
          checked: 0,
          latest_id: 0,
          reason: CROSS_SYSTEM_VERIFY_REASON,
        };
      }

      const rows = await db.query(
        `SELECT id, user_id, username, action, entity, entity_id, before_data, after_data, prev_hash, signature, created_at
         FROM operation_logs
         ORDER BY id ASC
         LIMIT ?`,
        [limit]
      );
      let previousSignature = null;
      let checked = 0;
      for (const row of rows) {
        checked += 1;
        if ((row.prev_hash || null) !== (previousSignature || null)) {
          return {
            ok: false,
            checked,
            failed_id: row.id,
            reason: '链路断裂：prev_hash与前一条签名不一致',
          };
        }
        const expected = computeAuditSignature({
          id: row.id,
          prevHash: row.prev_hash,
          userId: row.user_id,
          username: row.username,
          action: row.action,
          entity: row.entity,
          entityId: row.entity_id,
          beforeData: row.before_data,
          afterData: row.after_data,
          createdAt: row.created_at,
        });
        if (expected !== row.signature) {
          return {
            ok: false,
            checked,
            failed_id: row.id,
            reason: '签名不一致：疑似日志被篡改',
          };
        }
        previousSignature = row.signature;
      }
      return {
        ok: true,
        checked,
        latest_id: rows[rows.length - 1]?.id || 0,
        reason: '',
      };
    },
  };
};

module.exports = {
  AUDIT_EXPORT_COLUMNS,
  CROSS_SYSTEM_VERIFY_REASON,
  createAuditCenterLogsService,
  serializeLogsAsCsv,
};

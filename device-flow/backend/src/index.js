require('dotenv').config();

const cors = require('cors');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const { get, initDb, query, transaction } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 5184);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5180';
const AUTH_SYSTEM_KEY = String(process.env.AUTH_SYSTEM_KEY || 'device-flow').trim() || 'device-flow';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUTH_FETCH_TIMEOUT_MS || 5000));
const SECURITY_STRICT_MODE = process.env.SECURITY_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';
const DASHBOARD_OVERDUE_DAYS = Math.max(1, Number(process.env.DASHBOARD_OVERDUE_DAYS || 3));
const SLA_AUTO_RUN_INTERVAL_MS = Math.max(60000, Number(process.env.SLA_AUTO_RUN_INTERVAL_MS || 5 * 60 * 1000));
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || './uploads/device-flow');
const UPLOAD_MAX_FILE_SIZE = Math.max(1024 * 100, Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 10) * 1024 * 1024);
const ARCHIVE_ROOT = path.resolve(process.env.ARCHIVE_ROOT || './uploads/device-flow-archive');
const AUDIT_SIGNING_KEY = String(process.env.AUDIT_SIGNING_KEY || process.env.JWT_SECRET || 'device-flow-audit-signing-key');
const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);
const MAX_BATCH_STAGE_JOB_IDS = Math.max(1, Math.min(500, Number(process.env.MAX_BATCH_STAGE_JOB_IDS || 200)));
const MAX_IMPORT_ROWS = Math.max(1, Math.min(5000, Number(process.env.MAX_IMPORT_ROWS || 500)));
const DUAL_SIGN_TOKEN_TTL_MINUTES = Math.max(5, Number(process.env.DUAL_SIGN_TOKEN_TTL_MINUTES || 60));
const JOB_LOCK_TTL_SECONDS = Math.max(30, Number(process.env.JOB_LOCK_TTL_SECONDS || 300));
const CALLBACK_WORKER_INTERVAL_MS = Math.max(10000, Number(process.env.CALLBACK_WORKER_INTERVAL_MS || 30000));
const CALLBACK_WORKER_BATCH = Math.max(1, Math.min(100, Number(process.env.CALLBACK_WORKER_BATCH || 20)));
const OPS_METRIC_RETENTION_DAYS = Math.max(3, Number(process.env.OPS_METRIC_RETENTION_DAYS || 14));
const TRACK_LINK_BASE_URL = String(process.env.TRACK_LINK_BASE_URL || '').trim();
const UPLOAD_ALLOWED_MIME = new Set(
  String(
    process.env.UPLOAD_ALLOWED_MIME ||
      'image/png,image/jpeg,image/jpg,image/webp,application/pdf,text/plain,application/zip,application/x-zip-compressed'
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const STAGES = ['CREATED', 'RECEIVED', 'HARDWARE_CHECKED', 'OS_INSTALLED', 'TESTED', 'APPROVED', 'PACKED', 'SHIPPED'];
const CHANGE_REQUEST_TYPES = new Set(['WITHDRAW', 'CANCEL', 'CORRECT']);
const CHANGE_REQUEST_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
};
const BASE_WRITER_ROLES = new Set(['admin', 'sysadmin']);
const CHANGE_REVIEW_ROLES = new Set(['admin', 'sysadmin']);
const ATTACHMENT_UPLOADER_ROLES = new Set(['admin', 'sysadmin']);
const ATTACHMENT_DELETER_ROLES = new Set(['admin', 'sysadmin']);
const REWORK_ALLOWED_ROLES = new Set(['admin', 'sysadmin']);
const AUDIT_READER_ROLES = new Set(['auditor']);
const ACTION_TO_STAGE = {
  receive: 'RECEIVED',
  'hardware-check': 'HARDWARE_CHECKED',
  'os-install': 'OS_INSTALLED',
  test: 'TESTED',
  approve: 'APPROVED',
  pack: 'PACKED',
  ship: 'SHIPPED',
};
const ACTION_ALLOWED_ROLES = {
  receive: new Set(['admin', 'sysadmin']),
  'hardware-check': new Set(['admin', 'sysadmin']),
  'os-install': new Set(['admin', 'sysadmin']),
  test: new Set(['admin', 'sysadmin']),
  approve: new Set(['admin', 'sysadmin']),
  pack: new Set(['admin', 'sysadmin']),
  ship: new Set(['admin', 'sysadmin']),
};
const ACTION_PERMISSION_CODE = {
  receive: 'stage.receive',
  'hardware-check': 'stage.hardware-check',
  'os-install': 'stage.os-install',
  test: 'stage.test',
  approve: 'stage.approve',
  pack: 'stage.pack',
  ship: 'stage.ship',
};
const SLA_TRACKED_STAGES = STAGES.filter((stage) => stage !== 'SHIPPED');
const SLA_STAGE_LABEL = {
  CREATED: '已创建',
  RECEIVED: '已收货',
  HARDWARE_CHECKED: '硬件已检查',
  OS_INSTALLED: '系统已安装',
  TESTED: '已测试',
  APPROVED: '已审核',
  PACKED: '已装箱',
  SHIPPED: '已发货',
};

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');
const defaultOrigins = ['http://localhost:8083', 'http://127.0.0.1:8083'].map(normalizeOrigin);
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const requestOrigin = normalizeOrigin(origin);
    const list = allowedOrigins.length ? allowedOrigins : defaultOrigins;
    if (list.includes(requestOrigin)) return cb(null, true);
    const err = new Error('Not allowed by CORS');
    err.statusCode = 403;
    return cb(err);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Limit'],
  maxAge: 86400,
};

app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
}
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const routePath =
      trimText(req.route?.path) ||
      trimText(req.baseUrl && req.path ? `${req.baseUrl}${req.path}` : '') ||
      trimText(req.path) ||
      '/';
    const latency = Math.max(0, Date.now() - startedAt);
    const statusCode = Number(res.statusCode || 0);
    const isError = statusCode >= 500 ? 1 : 0;
    query(
      `INSERT INTO device_ops_metrics
       (method, route_path, status_code, latency_ms, is_error)
       VALUES (?, ?, ?, ?, ?)`,
      [trimText(req.method).toUpperCase(), routePath, statusCode, latency, isError]
    ).catch(() => {
      // ignore metrics write failures
    });
  });
  next();
});

if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}
if (!fs.existsSync(ARCHIVE_ROOT)) {
  fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = /^[a-z0-9.]+$/.test(ext.replace('.', '')) ? ext : '';
      const unique = `${Date.now()}-${crypto.randomUUID()}`;
      cb(null, `${unique}${safeExt}`);
    },
  }),
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').trim().toLowerCase();
    if (!mime || !UPLOAD_ALLOWED_MIME.has(mime)) {
      const err = new Error(`不支持的文件类型: ${mime || 'unknown'}`);
      err.statusCode = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').trim().toLowerCase();
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    const allowed = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
      'application/octet-stream',
    ]);
    const allowedExt = new Set(['.xlsx', '.xls', '.csv']);
    if (!allowed.has(mime) && !allowedExt.has(ext)) {
      const err = new Error(`仅支持 Excel/CSV 文件，当前类型: ${mime || 'unknown'}`);
      err.statusCode = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const trimText = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value).trim());

const isWeakSecret = (value, minLength = 16) => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length < minLength) return true;
  return weakSecrets.has(text.toLowerCase());
};

const validateSecurityBootstrap = () => {
  const problems = [];
  if (isWeakSecret(AUDIT_SIGNING_KEY, 32)) problems.push('AUDIT_SIGNING_KEY 过弱（生产建议至少32位随机值）');
  if (!problems.length) return;
  const text = `[SECURITY][device-flow] ${problems.join('；')}`;
  if (SECURITY_STRICT_MODE) throw new Error(text);
  console.warn(`${text}。当前为非严格模式，仅告警。`);
};

const appError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fetchWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const extractBearerToken = (authorizationHeader) => {
  const header = trimText(authorizationHeader);
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? trimText(match[1]) : '';
};

const extractCookieToken = (cookieHeader) => {
  const raw = trimText(cookieHeader);
  if (!raw) return '';
  const pairs = raw.split(';');
  for (const item of pairs) {
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const key = trimText(item.slice(0, idx));
    if (key !== AUTH_COOKIE_NAME) continue;
    return trimText(decodeURIComponent(item.slice(idx + 1)));
  }
  return '';
};

const introspectToken = async (token) => {
  let resp;
  try {
    resp = await fetchWithTimeout(
      `${AUTH_SERVICE_URL}/api/auth/introspect`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      AUTH_FETCH_TIMEOUT_MS
    );
  } catch (err) {
    if (err?.name === 'AbortError') throw appError('统一登录服务超时', 503);
    throw appError('统一登录服务不可用', 503);
  }

  if (!resp.ok) throw appError('登录已过期', 401);

  let data;
  try {
    const rawText = await resp.text();
    if (rawText.length > 65536) throw new Error('auth payload too large');
    data = rawText ? JSON.parse(rawText) : {};
  } catch (_err) {
    throw appError('统一登录返回异常', 401);
  }

  const user = data?.user;
  const apps = Array.isArray(data?.apps) ? data.apps : [];
  if (!user || user.id === undefined || !user.username) throw appError('登录状态无效', 401);
  if (AUTH_SYSTEM_KEY && !apps.includes(AUTH_SYSTEM_KEY)) throw appError('无权限访问设备流转系统', 403);

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role || 'viewer',
      department: user.department || user.dept || '',
    },
    apps,
  };
};

const normalizeRole = (role) => trimText(role).toLowerCase();

const requireWriter = (req, _res, next) => {
  if (!BASE_WRITER_ROLES.has(normalizeRole(req.user?.role))) return next(appError('无权限执行写操作', 403));
  return next();
};

const requireAttachmentUploader = (req, _res, next) => {
  if (!ATTACHMENT_UPLOADER_ROLES.has(normalizeRole(req.user?.role))) {
    return next(appError('无权限上传附件', 403));
  }
  return next();
};

const requireAttachmentDeleter = (req, _res, next) => {
  if (!ATTACHMENT_DELETER_ROLES.has(normalizeRole(req.user?.role))) {
    return next(appError('无权限删除附件', 403));
  }
  return next();
};

const requireAuditReader = (req, _res, next) => {
  if (!AUDIT_READER_ROLES.has(normalizeRole(req.user?.role))) {
    return next(appError('无权限查看审计验签', 403));
  }
  return next();
};

const authRequired = asyncHandler(async (req, _res, next) => {
  if (req.path === '/api/health') return next();
  if (req.path.startsWith('/api/external/device-flow/')) return next();
  const token = extractBearerToken(req.headers.authorization) || extractCookieToken(req.headers.cookie);
  if (!token) throw appError('未登录', 401);
  if (token.length < 16 || token.length > 4096) throw appError('登录凭证非法', 401);

  const auth = await introspectToken(token);
  req.user = auth.user;
  req.authApps = auth.apps;
  next();
});

const auditorAuditPathAllowList = new Set([
  '/api/health',
  '/api/auth/me',
  '/api/device-flow/logs',
  '/api/device-flow/audit/verify',
  '/api/device-flow/reports/audit.csv',
]);

const restrictAuditorToAudit = (req, _res, next) => {
  if (normalizeRole(req.user?.role) !== 'auditor') return next();
  if (req.method === 'OPTIONS') return next();
  if (req.method === 'GET' && auditorAuditPathAllowList.has(req.path)) return next();
  return next(appError('auditor 仅可访问审计相关接口', 403));
};

const externalApiAuthRequired = asyncHandler(async (req, _res, next) => {
  const apiKey = trimText(req.headers['x-api-key']);
  if (!apiKey) throw appError('缺少 x-api-key', 401);
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const client = await get(
    `SELECT id, client_name, enabled
     FROM device_api_clients
     WHERE api_key_hash = ?
     LIMIT 1`,
    [hash]
  );
  if (!client || Number(client.enabled || 0) !== 1) throw appError('API Key 无效', 401);
  req.externalClient = {
    id: Number(client.id),
    name: client.client_name,
  };
  next();
});

const getActor = (req) => ({
  sub: String(req.user?.id ?? ''),
  name: String(req.user?.username || ''),
  role: String(req.user?.role || ''),
  department: String(req.user?.department || ''),
});

const parsePaging = (rawPage, rawLimit) => {
  const page = Number(rawPage || 1);
  const limit = Number(rawLimit || 20);
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 20;
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
};

const parseDateOnly = (rawValue, fieldName) => {
  const value = trimText(rawValue);
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw appError(`${fieldName} 日期格式非法，应为 YYYY-MM-DD`);
  }
  return value;
};

const parseStageFilter = (rawValue, fieldName = 'stage') => {
  const stage = trimText(rawValue).toUpperCase();
  if (!stage) return '';
  if (!STAGES.includes(stage)) throw appError(`${fieldName} 参数非法`);
  return stage;
};

const buildDashboardJobWhere = ({ stage, customer }) => {
  const where = [];
  const params = [];

  if (stage) {
    where.push('j.current_stage = ?');
    params.push(stage);
  }
  if (customer) {
    where.push('j.customer_name LIKE ?');
    params.push(`%${customer}%`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
};

const appendWhereClause = (whereSql, clause) => (whereSql ? `${whereSql} AND ${clause}` : `WHERE ${clause}`);

const appendDateRangeWhere = ({ from, to, column, where, params }) => {
  if (from) {
    where.push(`${column} >= CONCAT(?, ' 00:00:00')`);
    params.push(from);
  }
  if (to) {
    where.push(`${column} < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)`);
    params.push(to);
  }
};

const escapeCsvCell = (value) => {
  let text = String(value === undefined || value === null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  if (/^[\t ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const stableStringify = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const computeAuditHash = (payload) => {
  const text = [
    String(payload.id || ''),
    String(payload.prevHash || ''),
    String(payload.jobId || ''),
    String(payload.userSub || ''),
    String(payload.username || ''),
    String(payload.userRole || ''),
    String(payload.action || ''),
    String(payload.entity || ''),
    String(payload.entityId || ''),
    String(payload.message || ''),
    stableStringify(payload.beforeData),
    stableStringify(payload.afterData),
    String(payload.requestIp || ''),
    String(payload.createdAt || ''),
  ].join('|');
  return crypto.createHmac('sha256', AUDIT_SIGNING_KEY).update(text).digest('hex');
};

const normalizeSlaRuleInput = (rawRules) => {
  if (!Array.isArray(rawRules)) throw appError('rules 必须是数组');
  if (rawRules.length === 0) throw appError('rules 不能为空');
  if (rawRules.length > SLA_TRACKED_STAGES.length) throw appError(`rules 最多 ${SLA_TRACKED_STAGES.length} 条`);

  const results = [];
  const seen = new Set();

  for (const raw of rawRules) {
    const stageCode = parseStageFilter(raw?.stage_code, 'stage_code');
    if (!SLA_TRACKED_STAGES.includes(stageCode)) {
      throw appError(`stage_code 不支持设置 SLA: ${stageCode}`);
    }
    if (seen.has(stageCode)) throw appError(`stage_code 重复: ${stageCode}`);
    seen.add(stageCode);

    const thresholdHours = Number(raw?.threshold_hours);
    if (!Number.isInteger(thresholdHours) || thresholdHours < 1 || thresholdHours > 720) {
      throw appError(`stage ${stageCode} 的 threshold_hours 必须为 1-720 的整数`);
    }

    const remindIntervalMinutes = Number(raw?.remind_interval_minutes);
    if (!Number.isInteger(remindIntervalMinutes) || remindIntervalMinutes < 10 || remindIntervalMinutes > 1440) {
      throw appError(`stage ${stageCode} 的 remind_interval_minutes 必须为 10-1440 的整数`);
    }

    const enabled = raw?.enabled === undefined ? 1 : raw?.enabled ? 1 : 0;
    results.push({
      stageCode,
      thresholdHours,
      remindIntervalMinutes,
      enabled,
    });
  }

  return results;
};

const parseBatchJobIds = (rawIds) => {
  if (!Array.isArray(rawIds)) throw appError('job_ids 必须是数组');
  if (rawIds.length === 0) throw appError('job_ids 不能为空');
  if (rawIds.length > MAX_BATCH_STAGE_JOB_IDS) {
    throw appError(`单次批量最多支持 ${MAX_BATCH_STAGE_JOB_IDS} 条`);
  }

  const ids = [];
  const seen = new Set();
  for (const raw of rawIds) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw appError(`非法 job_id: ${raw}`);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) throw appError('job_ids 不能为空');
  return ids;
};

const stageIndex = (stage) => STAGES.indexOf(String(stage || '').toUpperCase());

const ensureForwardTransition = (fromStage, toStage) => {
  const fromIndex = stageIndex(fromStage);
  const toIndex = stageIndex(toStage);
  if (fromIndex < 0 || toIndex < 0) throw appError('状态非法');
  if (toIndex !== fromIndex + 1) throw appError(`流程必须按顺序推进：${fromStage} -> ${toStage}`);
};

const ensureReworkTransition = (fromStage, toStage) => {
  const fromIndex = stageIndex(fromStage);
  const toIndex = stageIndex(toStage);
  if (fromIndex < 0 || toIndex < 0) throw appError('状态非法');
  if (toIndex >= fromIndex) throw appError('退回目标必须是当前步骤之前的步骤');
};

const normalizeDepartment = (department) => trimText(department).toUpperCase();

const findMatchedPermissionPolicy = async ({ role, department, actionCode, stageCode }) => {
  const roleCode = trimText(role).toLowerCase();
  const deptCode = normalizeDepartment(department) || '*';
  const action = trimText(actionCode).toLowerCase();
  const stage = trimText(stageCode).toUpperCase() || '*';
  if (!roleCode || !action) return null;

  const rows = await query(
    `SELECT role_code, department_code, action_code, stage_code, effect
     FROM device_permission_policies
     WHERE enabled = 1
       AND role_code IN (?, '*')
       AND department_code IN (?, '*')
       AND action_code IN (?, '*')
       AND stage_code IN (?, '*')
     ORDER BY
       (role_code <> '*') DESC,
       (department_code <> '*') DESC,
       (action_code <> '*') DESC,
       (stage_code <> '*') DESC,
       (effect = 'DENY') DESC,
       id DESC
     LIMIT 1`,
    [roleCode, deptCode, action, stage]
  );
  return rows[0] || null;
};

const ensureActionPermission = async ({ action, actor, stageCode }) => {
  const allowedRoles = ACTION_ALLOWED_ROLES[action];
  if (!allowedRoles) throw appError('不支持的阶段动作');

  const actionCode = ACTION_PERMISSION_CODE[action] || '';
  const policy = await findMatchedPermissionPolicy({
    role: actor?.role,
    department: actor?.department,
    actionCode,
    stageCode,
  });
  if (policy) {
    if (trimText(policy.effect).toUpperCase() === 'DENY') {
      throw appError(`权限策略拒绝该动作: ${action}`, 403);
    }
    return;
  }

  if (!allowedRoles.has(normalizeRole(actor?.role))) {
    throw appError(`当前角色无权限执行动作: ${action}`, 403);
  }
};

const buildJobNo = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `DF${y}${m}${d}${hh}${mm}${ss}${rand}`;
};

const compactObject = (value) => {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'string') {
      const text = trimText(raw);
      if (!text) continue;
      result[key] = text;
      continue;
    }
    result[key] = raw;
  }
  return Object.keys(result).length ? result : null;
};

const normalizeFlag = (value) => {
  const text = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  if (!text) return '';
  if (['PASS', 'YES', 'TRUE', 'Y', '1', 'OK'].includes(text)) return 'PASS';
  if (['FAIL', 'NO', 'FALSE', 'N', '0', 'NG'].includes(text)) return 'FAIL';
  return text;
};

const buildStagePayload = (action, rawPayload) => {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};

  if (action === 'hardware-check') {
    const defaults = {
      cpu_match: normalizeFlag(payload.cpu_match),
      memory_match: normalizeFlag(payload.memory_match),
      disk_match: normalizeFlag(payload.disk_match),
      nic_match: normalizeFlag(payload.nic_match),
      serial_match: normalizeFlag(payload.serial_match),
      hardware_note: trimText(payload.hardware_note),
    };

    for (const [rawKey, rawValue] of Object.entries(payload)) {
      const key = trimText(rawKey);
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(defaults, key)) continue;
      if (key.endsWith('_note') || key.endsWith('_remark')) {
        defaults[key] = trimText(rawValue);
        continue;
      }
      defaults[key] = normalizeFlag(rawValue);
    }
    return compactObject(defaults);
  }

  if (action === 'os-install') {
    return compactObject({
      os_name: trimText(payload.os_name),
      os_version: trimText(payload.os_version),
      install_mode: trimText(payload.install_mode),
      install_result: normalizeFlag(payload.install_result),
      install_note: trimText(payload.install_note),
    });
  }

  if (action === 'test') {
    return compactObject({
      boot_test: normalizeFlag(payload.boot_test),
      network_test: normalizeFlag(payload.network_test),
      stress_test: normalizeFlag(payload.stress_test),
      test_result: normalizeFlag(payload.test_result),
      burnin_hours: trimText(payload.burnin_hours),
      test_note: trimText(payload.test_note),
    });
  }

  if (action === 'approve') {
    return compactObject({
      approve_result: normalizeFlag(payload.approve_result),
      approve_note: trimText(payload.approve_note),
      reviewer_comment: trimText(payload.reviewer_comment),
    });
  }

  if (action === 'pack') {
    return compactObject({
      package_check: normalizeFlag(payload.package_check),
      accessory_check: normalizeFlag(payload.accessory_check),
      box_no: trimText(payload.box_no),
      pack_note: trimText(payload.pack_note),
    });
  }

  if (action === 'ship') {
    return compactObject({
      carrier: trimText(payload.carrier),
      outbound_tracking_no: trimText(payload.outbound_tracking_no),
      shipped_note: trimText(payload.shipped_note),
    });
  }

  if (action === 'receive') {
    return compactObject({
      receive_note: trimText(payload.receive_note),
    });
  }

  return compactObject(payload);
};

const parseJsonSafe = (value) => {
  const raw = trimText(value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
};

const parseExpectedVersion = (req, field = 'expected_version') => {
  const fromBody = Number(req.body?.[field]);
  if (Number.isInteger(fromBody) && fromBody > 0) return fromBody;

  const ifMatch = trimText(req.headers?.['if-match']);
  if (!ifMatch) return 0;
  const clean = ifMatch.replace(/^W\//i, '').replace(/"/g, '');
  const parsed = Number(clean);
  if (!Number.isInteger(parsed) || parsed <= 0) throw appError('If-Match 版本号非法');
  return parsed;
};

const hashElectronicSignature = ({ signature, actorSub, action, jobId, token = '' }) => {
  const raw = [trimText(signature), trimText(actorSub), trimText(action), String(jobId || ''), trimText(token)].join('|');
  return crypto.createHmac('sha256', AUDIT_SIGNING_KEY).update(raw).digest('hex');
};

const toBool = (value) => {
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!text) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
};

const parseScanInput = (rawInput) => {
  const text = trimText(rawInput);
  if (!text) return { raw: '', fields: {}, warnings: [] };

  const fields = {};
  const warnings = [];
  const normalized = text.replace(/\s+/g, '');

  const pairs = normalized.split(/[;|]+/).filter(Boolean);
  for (const piece of pairs) {
    const idx = piece.indexOf(':');
    if (idx > 0) {
      const key = trimText(piece.slice(0, idx)).toUpperCase();
      const value = trimText(piece.slice(idx + 1));
      if (!value) continue;
      if (key === 'SN' || key === 'DEVICE_SN') fields.device_sn = value.toUpperCase();
      else if (key === 'IN' || key === 'INBOUND' || key === 'INBOUND_TRACKING_NO') fields.inbound_tracking_no = value;
      else if (key === 'OUT' || key === 'OUTBOUND' || key === 'OUTBOUND_TRACKING_NO') fields.outbound_tracking_no = value;
      else warnings.push(`未识别扫码键: ${key}`);
      continue;
    }

    if (/^(SF|YT|YD|ZTO|JD|EMS)[A-Z0-9]{6,}$/i.test(piece) || /^[A-Z0-9\-]{8,}$/.test(piece)) {
      if (!fields.inbound_tracking_no && !fields.outbound_tracking_no) fields.inbound_tracking_no = piece;
      else if (!fields.outbound_tracking_no) fields.outbound_tracking_no = piece;
      else warnings.push(`多余快递码: ${piece}`);
      continue;
    }

    if (/^SN[-_A-Z0-9]{4,}$/i.test(piece)) {
      fields.device_sn = piece.toUpperCase();
      continue;
    }

    warnings.push(`无法识别扫码内容: ${piece}`);
  }

  return {
    raw: text,
    fields,
    warnings,
  };
};

const getTrackLink = (job) => {
  if (TRACK_LINK_BASE_URL) return `${TRACK_LINK_BASE_URL.replace(/\/+$/, '')}/jobs/${job.id}`;
  return `https://device-flow.local/jobs/${job.id}`;
};

const parseHardwareTemplateItems = (checkItemsRaw) => {
  const parsed = parseJsonSafe(checkItemsRaw);
  const rows = Array.isArray(parsed) ? parsed : [];
  const items = rows
    .map((item) => ({
      code: trimText(item?.code).toLowerCase(),
      label: trimText(item?.label) || trimText(item?.code),
      required: item?.required === undefined ? true : Boolean(item.required),
    }))
    .filter((item) => item.code && item.label);
  return items;
};

const defaultHardwareTemplateItems = [
  { code: 'cpu_match', label: 'CPU匹配', required: true },
  { code: 'memory_match', label: '内存匹配', required: true },
  { code: 'disk_match', label: '磁盘匹配', required: true },
  { code: 'nic_match', label: '网卡匹配', required: true },
  { code: 'serial_match', label: '序列号匹配', required: true },
];

const getHardwareTemplateByModel = async (modelCode) => {
  const model = trimText(modelCode).toUpperCase();
  if (!model) return null;
  const row = await get(
    `SELECT id, model_code, model_name, check_items, enabled, updated_at
     FROM device_hardware_templates
     WHERE model_code = ?`,
    [model]
  );
  if (!row || Number(row.enabled || 0) !== 1) return null;
  return {
    id: Number(row.id),
    model_code: row.model_code,
    model_name: row.model_name,
    check_items: parseHardwareTemplateItems(row.check_items),
    updated_at: row.updated_at,
  };
};

const getHardwareCheckContextForJobId = async (jobId) => {
  const job = await get('SELECT id, device_model FROM device_jobs WHERE id = ?', [jobId]);
  if (!job) return null;
  const template = await getHardwareTemplateByModel(job.device_model);
  const checkItems = template?.check_items?.length ? template.check_items : defaultHardwareTemplateItems;
  return {
    jobId: Number(job.id),
    deviceModel: trimText(job.device_model).toUpperCase(),
    template,
    checkItems,
  };
};

const getDualSignPolicyForStage = async (stageCode) => {
  const stage = trimText(stageCode).toUpperCase();
  if (!stage) return { enabled: false, requiredSigners: 1 };
  const row = await get(
    `SELECT required_signers, enabled
     FROM device_dual_sign_policies
     WHERE stage_code = ?`,
    [stage]
  );
  if (!row) return { enabled: false, requiredSigners: 1 };
  return {
    enabled: Number(row.enabled || 0) === 1,
    requiredSigners: Math.max(1, Number(row.required_signers || 1)),
  };
};

const assertActiveJobLock = async (tx, jobId, actor) => {
  const lockRow = await tx.get(
    `SELECT holder_sub, holder_name, holder_role, expires_at
     FROM device_job_locks
     WHERE job_id = ? AND expires_at > NOW()
     LIMIT 1`,
    [jobId]
  );
  if (!lockRow) return;
  if (trimText(lockRow.holder_sub) === trimText(actor?.sub)) return;
  throw appError(
    `该流转单正由 ${trimText(lockRow.holder_name) || trimText(lockRow.holder_sub) || '其他用户'} 操作中，请稍后重试`,
    409
  );
};

const parseCorrectionPayload = (rawPayload) => {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const allowed = ['customer_name', 'sales_order_no', 'inbound_tracking_no', 'outbound_tracking_no', 'device_model', 'remark'];
  const out = {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    out[key] = trimText(payload[key]);
  }
  if (Object.keys(out).length === 0) throw appError('更正请求缺少可修改字段');
  return out;
};

const toPublicOperationLog = (item) => ({
  ...item,
  before_data: parseJsonSafe(item.before_data),
  after_data: parseJsonSafe(item.after_data),
});

const toPublicAttachment = (item) => ({
  id: Number(item.id),
  job_id: Number(item.job_id),
  stage_record_id: item.stage_record_id === null || item.stage_record_id === undefined ? null : Number(item.stage_record_id),
  stage_code: item.stage_code,
  file_name: item.file_name,
  mime_type: item.mime_type,
  file_size: Number(item.file_size || 0),
  remark: item.remark || '',
  uploaded_by_name: item.uploaded_by_name || '',
  uploaded_by_role: item.uploaded_by_role || '',
  uploaded_at: item.uploaded_at,
  download_url: `/api/device-flow/attachments/${item.id}/download`,
});

const requirePayloadField = (payload, key, label) => {
  const value = payload && Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : '';
  const text = trimText(value);
  if (!text) throw appError(`${label} 不能为空`);
  return text;
};

const requirePassFailField = (payload, key, label) => {
  const value = requirePayloadField(payload, key, label).toUpperCase();
  if (value !== 'PASS' && value !== 'FAIL') {
    throw appError(`${label} 只能是 PASS 或 FAIL`);
  }
  return value;
};

const ensureFailureHasNote = (resultValue, noteText, remarkText, fieldLabel) => {
  if (resultValue === 'FAIL' && !trimText(noteText) && !trimText(remarkText)) {
    throw appError(`${fieldLabel}为 FAIL 时必须填写说明（阶段备注或对应说明字段）`);
  }
};

const validateStagePayload = (action, stagePayload, remark, context = {}) => {
  const payload = stagePayload && typeof stagePayload === 'object' ? stagePayload : {};

  if (action === 'receive') return;

  if (action === 'hardware-check') {
    const checkItems = Array.isArray(context.checkItems) && context.checkItems.length
      ? context.checkItems
      : defaultHardwareTemplateItems;
    const checks = checkItems
      .filter((item) => item.required !== false)
      .map((item) => requirePassFailField(payload, item.code, item.label));
    if (checks.some((item) => item === 'FAIL')) {
      ensureFailureHasNote('FAIL', payload.hardware_note, remark, '硬件检查项');
    }
    return;
  }

  if (action === 'os-install') {
    requirePayloadField(payload, 'os_name', '系统名称');
    requirePayloadField(payload, 'os_version', '系统版本');
    const result = requirePassFailField(payload, 'install_result', '安装结果');
    ensureFailureHasNote(result, payload.install_note, remark, '安装结果');
    return;
  }

  if (action === 'test') {
    requirePassFailField(payload, 'boot_test', '开机测试');
    requirePassFailField(payload, 'network_test', '网络测试');
    requirePassFailField(payload, 'stress_test', '压力测试');
    const testResult = requirePassFailField(payload, 'test_result', '测试结论');
    const burninHoursText = trimText(payload.burnin_hours);
    if (burninHoursText) {
      const burninHours = Number(burninHoursText);
      if (!Number.isFinite(burninHours) || burninHours < 0 || burninHours > 9999) {
        throw appError('老化时长必须是 0-9999 的数字');
      }
    }
    ensureFailureHasNote(testResult, payload.test_note, remark, '测试结论');
    return;
  }

  if (action === 'approve') {
    const approveResult = requirePassFailField(payload, 'approve_result', '审核结论');
    const approveNote = `${trimText(payload.approve_note)}${trimText(payload.reviewer_comment)}`;
    ensureFailureHasNote(approveResult, approveNote, remark, '审核结论');
    return;
  }

  if (action === 'pack') {
    const packageCheck = requirePassFailField(payload, 'package_check', '包装完整');
    const accessoryCheck = requirePassFailField(payload, 'accessory_check', '配件完整');
    requirePayloadField(payload, 'box_no', '箱号');
    if (packageCheck === 'FAIL' || accessoryCheck === 'FAIL') {
      ensureFailureHasNote('FAIL', payload.pack_note, remark, '装箱检查');
    }
    return;
  }

  if (action === 'ship') {
    requirePayloadField(payload, 'carrier', '物流公司');
  }
};

const writeOperationLogTx = async (tx, payload) => {
  const lockName = 'device_flow_audit_chain_lock';
  let lockAcquired = false;
  try {
    const lockRow = await tx.get('SELECT GET_LOCK(?, 5) AS locked', [lockName]);
    if (Number(lockRow?.locked || 0) !== 1) {
      throw appError('审计日志写入锁获取失败，请稍后重试', 503);
    }
    lockAcquired = true;

    const prevRow = await tx.get(
      `SELECT id, chain_hash
       FROM device_operation_logs
       ORDER BY id DESC
       LIMIT 1 FOR UPDATE`
    );
    const prevHash = trimText(prevRow?.chain_hash);
    const beforeData = payload.beforeData === undefined ? null : payload.beforeData;
    const afterData = payload.afterData === undefined ? null : payload.afterData;

    const result = await tx.run(
      `INSERT INTO device_operation_logs
       (job_id, user_sub, username, user_role, action, entity, entity_id, message, before_data, after_data, chain_prev_hash, chain_hash, chain_version, request_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?)`,
      [
        payload.jobId || null,
        trimText(payload.userSub) || null,
        trimText(payload.username),
        trimText(payload.userRole),
        trimText(payload.action),
        trimText(payload.entity),
        payload.entityId === undefined || payload.entityId === null ? null : String(payload.entityId),
        trimText(payload.message) || null,
        beforeData === null ? null : JSON.stringify(beforeData),
        afterData === null ? null : JSON.stringify(afterData),
        prevHash || null,
        '',
        trimText(payload.requestIp) || null,
      ]
    );

    const insertedId = Number(result.insertId || 0);
    const inserted = await tx.get('SELECT id, created_at FROM device_operation_logs WHERE id = ?', [insertedId]);
    const chainHash = computeAuditHash({
      id: inserted?.id,
      prevHash: prevHash || '',
      jobId: payload.jobId || '',
      userSub: payload.userSub || '',
      username: payload.username || '',
      userRole: payload.userRole || '',
      action: payload.action || '',
      entity: payload.entity || '',
      entityId: payload.entityId === undefined || payload.entityId === null ? '' : String(payload.entityId),
      message: payload.message || '',
      beforeData,
      afterData,
      requestIp: payload.requestIp || '',
      createdAt: inserted?.created_at || '',
    });

    await tx.run('UPDATE device_operation_logs SET chain_hash = ? WHERE id = ?', [chainHash, insertedId]);
    return insertedId;
  } finally {
    if (lockAcquired) {
      try {
        await tx.get('SELECT RELEASE_LOCK(?) AS released', [lockName]);
      } catch (_err) {
        // ignore lock release errors, connection close will release lock.
      }
    }
  }
};

const appendStageRecordTx = async (tx, payload) => {
  const result = await tx.run(
    `INSERT INTO device_stage_records
     (job_id, action, from_stage, to_stage, result, remark, rework_reason, stage_payload, operator_sub, operator_name, operator_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.jobId,
      payload.action,
      payload.fromStage,
      payload.toStage,
      payload.result || 'PASS',
      trimText(payload.remark) || null,
      trimText(payload.reworkReason) || null,
      payload.stagePayload ? JSON.stringify(payload.stagePayload) : null,
      trimText(payload.operatorSub) || null,
      trimText(payload.operatorName) || null,
      trimText(payload.operatorRole) || null,
    ]
  );
  return Number(result.insertId || 0);
};

const advanceStageJob = async ({
  jobId,
  action,
  actor,
  remark,
  stagePayload,
  inboundTrackingNo,
  outboundTrackingNo,
  expectedVersion = 0,
  requestIp,
}) => {
  const toStage = ACTION_TO_STAGE[action];
  if (!toStage) throw appError('不支持的阶段动作');

  return transaction(async (tx) => {
    const current = await tx.get('SELECT * FROM device_jobs WHERE id = ? FOR UPDATE', [jobId]);
    if (!current) throw appError('流转单不存在', 404);
    if (String(current.status || '').toUpperCase() === 'VOIDED') {
      throw appError('该流转单已作废，禁止继续流转', 409);
    }
    if (expectedVersion && Number(current.row_version || 0) !== Number(expectedVersion)) {
      throw appError(`版本冲突：当前版本 ${Number(current.row_version || 0)}，请刷新后重试`, 409);
    }
    await assertActiveJobLock(tx, jobId, actor);

    ensureForwardTransition(current.current_stage, toStage);

    // 关键质检节点必须先留证，防止“先流转后补附件”导致审计证据缺失。
    if (toStage === 'HARDWARE_CHECKED' || toStage === 'TESTED') {
      const attachmentCountRow = await tx.get(
        'SELECT COUNT(*) AS total FROM device_attachments WHERE job_id = ? AND stage_code = ? AND deleted_at IS NULL',
        [jobId, toStage]
      );
      const attachmentCount = Number(attachmentCountRow?.total || 0);
      if (attachmentCount < 1) {
        throw appError(`进入${toStage}前必须至少上传1个该阶段附件留证`);
      }
    }

    const nextInboundTrackingNo = trimText(inboundTrackingNo) || current.inbound_tracking_no || '';
    const nextOutboundTrackingNo = trimText(outboundTrackingNo) || current.outbound_tracking_no || '';
    let status = 'OPEN';

    if (toStage === 'SHIPPED') {
      if (!nextOutboundTrackingNo) throw appError('发货阶段必须填写发货快递单号');
      status = 'COMPLETED';
    }

    const updateFields = {
      current_stage: toStage,
      status,
      inbound_tracking_no: nextInboundTrackingNo,
      outbound_tracking_no: nextOutboundTrackingNo,
      remark: remark || current.remark || '',
    };

    if (toStage === 'RECEIVED') {
      updateFields.received_by_sub = actor.sub;
      updateFields.received_by_name = actor.name;
      updateFields.received_by_role = actor.role;
      updateFields.received_at = 'NOW()';
    } else if (toStage === 'HARDWARE_CHECKED') {
      updateFields.hardware_checked_by_sub = actor.sub;
      updateFields.hardware_checked_by_name = actor.name;
      updateFields.hardware_checked_by_role = actor.role;
      updateFields.hardware_checked_at = 'NOW()';
    } else if (toStage === 'OS_INSTALLED') {
      updateFields.os_installed_by_sub = actor.sub;
      updateFields.os_installed_by_name = actor.name;
      updateFields.os_installed_by_role = actor.role;
      updateFields.os_installed_at = 'NOW()';
    } else if (toStage === 'TESTED') {
      updateFields.tested_by_sub = actor.sub;
      updateFields.tested_by_name = actor.name;
      updateFields.tested_by_role = actor.role;
      updateFields.tested_at = 'NOW()';
    } else if (toStage === 'APPROVED') {
      updateFields.approved_by_sub = actor.sub;
      updateFields.approved_by_name = actor.name;
      updateFields.approved_by_role = actor.role;
      updateFields.approved_at = 'NOW()';
    } else if (toStage === 'PACKED') {
      updateFields.packed_by_sub = actor.sub;
      updateFields.packed_by_name = actor.name;
      updateFields.packed_by_role = actor.role;
      updateFields.packed_at = 'NOW()';
    } else if (toStage === 'SHIPPED') {
      updateFields.shipped_by_sub = actor.sub;
      updateFields.shipped_by_name = actor.name;
      updateFields.shipped_by_role = actor.role;
      updateFields.shipped_at = 'NOW()';
    }

    const assignments = [];
    const params = [];
    for (const [key, value] of Object.entries(updateFields)) {
      if (value === 'NOW()') {
        assignments.push(`${key} = NOW()`);
      } else {
        assignments.push(`${key} = ?`);
        params.push(value);
      }
    }
    assignments.push('row_version = row_version + 1');
    params.push(jobId);

    await tx.run(`UPDATE device_jobs SET ${assignments.join(', ')} WHERE id = ?`, params);

    const stageRecordId = await appendStageRecordTx(tx, {
      jobId,
      action: action.toUpperCase(),
      fromStage: current.current_stage,
      toStage,
      result: 'PASS',
      remark,
      stagePayload,
      operatorSub: actor.sub,
      operatorName: actor.name,
      operatorRole: actor.role,
    });

    const after = await tx.get('SELECT * FROM device_jobs WHERE id = ?', [jobId]);

    await writeOperationLogTx(tx, {
      jobId,
      userSub: actor.sub,
      username: actor.name,
      userRole: actor.role,
      action: `STAGE_${action.toUpperCase()}`,
      entity: 'device_job',
      entityId: jobId,
      message: `阶段推进 ${current.current_stage} -> ${toStage}`,
      beforeData: { current_stage: current.current_stage, status: current.status },
      afterData: {
        current_stage: after.current_stage,
        status: after.status,
        stage_record_id: stageRecordId,
        stage_payload: stagePayload,
      },
      requestIp,
    });

    await enqueueCallbackEventTx(tx, {
      eventType: 'stage.changed',
      jobId,
      payload: {
        job_id: Number(jobId),
        action,
        from_stage: current.current_stage,
        to_stage: toStage,
        actor: {
          sub: actor.sub,
          name: actor.name,
          role: actor.role,
        },
        happened_at: new Date().toISOString(),
      },
    });

    return after;
  });
};

const IMPORT_HEADER_ALIAS = {
  devicesn: 'device_sn',
  sn: 'device_sn',
  '设备sn': 'device_sn',
  '设备序列号': 'device_sn',
  customer: 'customer_name',
  customername: 'customer_name',
  '客户': 'customer_name',
  '客户名称': 'customer_name',
  salesorderno: 'sales_order_no',
  '销售订单号': 'sales_order_no',
  inboundtrackingno: 'inbound_tracking_no',
  inboundno: 'inbound_tracking_no',
  '来件快递单号': 'inbound_tracking_no',
  '来件单号': 'inbound_tracking_no',
  devicemodel: 'device_model',
  model: 'device_model',
  '设备型号': 'device_model',
  '机型': 'device_model',
  remark: 'remark',
  note: 'remark',
  '备注': 'remark',
};

const normalizeHeader = (value) =>
  trimText(value)
    .toLowerCase()
    .replace(/[\s_\-()（）]/g, '');

const mapImportRow = (rawRow) => {
  const output = {
    device_sn: '',
    device_model: '',
    customer_name: '',
    sales_order_no: '',
    inbound_tracking_no: '',
    remark: '',
  };
  for (const [rawKey, rawValue] of Object.entries(rawRow || {})) {
    const mappedKey = IMPORT_HEADER_ALIAS[normalizeHeader(rawKey)];
    if (!mappedKey) continue;
    output[mappedKey] = trimText(rawValue);
  }
  output.device_sn = output.device_sn.toUpperCase();
  return output;
};

const parseImportWorkbookRowsWithErrors = (fileBuffer) => {
  let workbook;
  try {
    workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
  } catch (_err) {
    throw appError('Excel 文件解析失败，请检查文件格式');
  }
  const sheetName = Array.isArray(workbook.SheetNames) && workbook.SheetNames.length > 0 ? workbook.SheetNames[0] : '';
  if (!sheetName) throw appError('Excel 文件缺少工作表');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw appError('Excel 工作表为空');

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!Array.isArray(rows) || rows.length === 0) throw appError('导入文件为空');
  if (rows.length > MAX_IMPORT_ROWS) throw appError(`单次最多导入 ${MAX_IMPORT_ROWS} 行`);

  const mappedRows = [];
  const errors = [];
  rows.forEach((row, idx) => {
    const mapped = mapImportRow(row);
    const lineNo = idx + 2;
    if (!mapped.device_sn && !mapped.customer_name && !mapped.sales_order_no && !mapped.inbound_tracking_no && !mapped.remark) {
      return;
    }
    if (!mapped.device_sn) errors.push(`第 ${lineNo} 行：device_sn/设备SN 不能为空`);
    if (!mapped.customer_name) errors.push(`第 ${lineNo} 行：customer_name/客户名称 不能为空`);
    mappedRows.push({
      ...mapped,
      _line_no: lineNo,
    });
  });

  if (mappedRows.length === 0) throw appError('导入文件未找到有效数据行');
  return {
    rows: mappedRows,
    errors,
  };
};

const parseImportWorkbookRows = (fileBuffer) => {
  const parsed = parseImportWorkbookRowsWithErrors(fileBuffer);
  if (parsed.errors.length > 0) {
    throw appError(`导入校验失败：${parsed.errors.slice(0, 8).join('；')}`);
  }
  return parsed.rows.map((item) => {
    const next = { ...item };
    delete next._line_no;
    return next;
  });
};

const precheckImportRows = async (rows) => {
  const errors = [];
  const warnings = [];
  const duplicateInFile = new Map();
  const snSet = new Set();
  const normalizedRows = rows.map((item) => ({
    ...item,
    device_sn: trimText(item.device_sn).toUpperCase(),
    device_model: trimText(item.device_model).toUpperCase(),
    _line_no: Number(item._line_no || 0),
  }));

  normalizedRows.forEach((row) => {
    if (!row.device_sn) return;
    if (snSet.has(row.device_sn)) {
      duplicateInFile.set(row.device_sn, true);
    } else {
      snSet.add(row.device_sn);
    }
  });

  for (const row of normalizedRows) {
    if (duplicateInFile.has(row.device_sn)) {
      errors.push({ line_no: row._line_no || null, code: 'DUPLICATE_SN_IN_FILE', message: `设备SN重复: ${row.device_sn}` });
    }
  }

  const snList = Array.from(snSet);
  if (snList.length > 0) {
    const placeholders = snList.map(() => '?').join(',');
    const existed = await query(
      `SELECT device_sn, status, job_no, current_stage
       FROM device_jobs
       WHERE device_sn IN (${placeholders})
       ORDER BY id DESC`,
      snList
    );
    const seen = new Set();
    for (const row of existed) {
      const sn = trimText(row.device_sn).toUpperCase();
      if (seen.has(sn)) continue;
      seen.add(sn);
      warnings.push({
        code: 'SN_ALREADY_EXISTS',
        device_sn: sn,
        message: `设备SN已存在历史流转单: ${row.job_no}（${row.current_stage}/${row.status}）`,
      });
    }
  }

  return {
    valid_rows: normalizedRows.length,
    error_count: errors.length,
    warning_count: warnings.length,
    errors,
    warnings,
  };
};

const buildJobsWorkbookBuffer = (rows) => {
  const exportRows = rows.map((item) => ({
    流转单号: item.job_no,
    设备SN: item.device_sn,
    设备型号: item.device_model,
    客户名称: item.customer_name,
    销售订单号: item.sales_order_no,
    来件快递单号: item.inbound_tracking_no,
    发货快递单号: item.outbound_tracking_no,
    当前阶段: item.current_stage,
    状态: item.status,
    更新时间: item.updated_at,
    创建时间: item.created_at,
  }));
  const sheet = XLSX.utils.json_to_sheet(exportRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Jobs');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const buildImportTemplateBuffer = () => {
  const templateRows = [
    {
      设备SN: 'SN-EXAMPLE-001',
      设备型号: 'NSG-2000',
      客户名称: '示例客户A',
      销售订单号: 'SO-20260219-001',
      来件快递单号: 'IN-TRACK-001',
      备注: '首批导入示例',
    },
    {
      设备SN: 'SN-EXAMPLE-002',
      设备型号: 'NSG-3000',
      客户名称: '示例客户B',
      销售订单号: '',
      来件快递单号: '',
      备注: '',
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(templateRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'ImportTemplate');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const createJobWithActor = async ({ actor, jobData, requestIp, source = 'manual' }) => {
  const deviceSn = trimText(jobData?.device_sn).toUpperCase();
  const deviceModel = trimText(jobData?.device_model).toUpperCase();
  const customerName = trimText(jobData?.customer_name);
  const salesOrderNo = trimText(jobData?.sales_order_no);
  const inboundTrackingNo = trimText(jobData?.inbound_tracking_no);
  const remark = trimText(jobData?.remark);

  if (!deviceSn) throw appError('设备SN不能为空');
  if (!customerName) throw appError('客户名称不能为空');

  let createdId = 0;
  for (let i = 0; i < 5; i += 1) {
    const jobNo = buildJobNo();
    try {
      createdId = await transaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO device_jobs
           (job_no, device_sn, device_model, customer_name, sales_order_no, inbound_tracking_no, current_stage, status, remark, created_by_sub, created_by_name, created_by_role)
           VALUES (?, ?, ?, ?, ?, ?, 'CREATED', 'OPEN', ?, ?, ?, ?)`,
          [jobNo, deviceSn, deviceModel, customerName, salesOrderNo, inboundTrackingNo, remark, actor.sub, actor.name, actor.role]
        );
        const jobId = Number(result.insertId || 0);

        await appendStageRecordTx(tx, {
          jobId,
          action: 'CREATE',
          fromStage: 'CREATED',
          toStage: 'CREATED',
          result: 'PASS',
          remark,
          operatorSub: actor.sub,
          operatorName: actor.name,
          operatorRole: actor.role,
        });

        await writeOperationLogTx(tx, {
          jobId,
          userSub: actor.sub,
          username: actor.name,
          userRole: actor.role,
          action: 'CREATE_JOB',
          entity: 'device_job',
          entityId: jobId,
          message: `创建流转单 ${jobNo}`,
          beforeData: null,
          afterData: { job_no: jobNo, device_sn: deviceSn, device_model: deviceModel, current_stage: 'CREATED', source },
          requestIp,
        });

        await enqueueCallbackEventTx(tx, {
          eventType: 'job.created',
          jobId,
          payload: {
            job_id: Number(jobId),
            job_no: jobNo,
            device_sn: deviceSn,
            device_model: deviceModel,
            current_stage: 'CREATED',
            created_by: {
              sub: actor.sub,
              name: actor.name,
              role: actor.role,
            },
          },
        });

        return jobId;
      });
      break;
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY' && i < 4) continue;
      throw err;
    }
  }

  if (!createdId) throw appError('创建流转单失败，请重试', 500);
  const createdRow = await get('SELECT * FROM device_jobs WHERE id = ?', [createdId]);
  return createdRow;
};

const listSlaRules = async () => {
  const rules = await query(
    `SELECT stage_code, threshold_hours, remind_interval_minutes, enabled, updated_at
     FROM device_sla_rules
     ORDER BY id ASC`
  );
  return rules.map((item) => ({
    stage_code: item.stage_code,
    stage_label: SLA_STAGE_LABEL[item.stage_code] || item.stage_code,
    threshold_hours: Number(item.threshold_hours || 0),
    remind_interval_minutes: Number(item.remind_interval_minutes || 0),
    enabled: Number(item.enabled || 0) === 1,
    updated_at: item.updated_at,
  }));
};

const runSlaReminderCheck = async ({ actor, requestIp, maxScan = 300 }) => {
  const scanLimit = Math.max(1, Math.min(Number(maxScan || 300), 1000));
  const candidates = await query(
    `SELECT j.id,
            j.job_no,
            j.customer_name,
            j.current_stage,
            j.status,
            j.updated_at,
            TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) AS overdue_hours,
            r.threshold_hours,
            r.remind_interval_minutes
     FROM device_jobs j
     JOIN device_sla_rules r ON r.stage_code = j.current_stage AND r.enabled = 1
     WHERE j.status <> 'COMPLETED'
       AND TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) >= r.threshold_hours
     ORDER BY j.updated_at ASC
     LIMIT ?`,
    [scanLimit]
  );

  const summary = {
    checked: candidates.length,
    triggered: 0,
    skipped_interval: 0,
    skipped_state: 0,
    reminders: [],
  };

  for (const item of candidates) {
    const detail = await transaction(async (tx) => {
      const job = await tx.get(
        `SELECT id, job_no, customer_name, current_stage, status, updated_at
         FROM device_jobs
         WHERE id = ? FOR UPDATE`,
        [item.id]
      );
      if (!job || String(job.status || '').toUpperCase() === 'COMPLETED') return null;

      const rule = await tx.get(
        `SELECT threshold_hours, remind_interval_minutes, enabled
         FROM device_sla_rules
         WHERE stage_code = ? FOR UPDATE`,
        [job.current_stage]
      );
      if (!rule || Number(rule.enabled || 0) !== 1) return null;

      const overdueRow = await tx.get('SELECT TIMESTAMPDIFF(HOUR, ?, NOW()) AS overdue_hours', [job.updated_at]);
      const overdueHours = Number(overdueRow?.overdue_hours || 0);
      const thresholdHours = Number(rule.threshold_hours || 0);
      if (overdueHours < thresholdHours) return null;

      const lastReminder = await tx.get(
        `SELECT created_at
         FROM device_sla_reminders
         WHERE job_id = ? AND stage_code = ?
         ORDER BY id DESC
         LIMIT 1`,
        [job.id, job.current_stage]
      );
      if (lastReminder?.created_at) {
        const diffRow = await tx.get('SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS diff_minutes', [lastReminder.created_at]);
        const diffMinutes = Number(diffRow?.diff_minutes || 0);
        const minInterval = Number(rule.remind_interval_minutes || 0);
        if (diffMinutes < minInterval) return { skippedInterval: true };
      }

      const message = `SLA催办：流转单 ${job.job_no} 已在阶段 ${SLA_STAGE_LABEL[job.current_stage] || job.current_stage} 超时 ${overdueHours} 小时（阈值 ${thresholdHours} 小时）`;
      const insertRes = await tx.run(
        `INSERT INTO device_sla_reminders
         (job_id, stage_code, threshold_hours, overdue_hours, message)
         VALUES (?, ?, ?, ?, ?)`,
        [job.id, job.current_stage, thresholdHours, overdueHours, message]
      );
      const reminderId = Number(insertRes.insertId || 0);

      await writeOperationLogTx(tx, {
        jobId: job.id,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'SLA_REMINDER',
        entity: 'device_job',
        entityId: job.id,
        message,
        beforeData: null,
        afterData: {
          reminder_id: reminderId,
          stage_code: job.current_stage,
          threshold_hours: thresholdHours,
          overdue_hours: overdueHours,
        },
        requestIp,
      });

      return {
        reminderId,
        jobId: Number(job.id),
        jobNo: job.job_no,
        stageCode: job.current_stage,
        overdueHours,
        thresholdHours,
        message,
      };
    });

    if (!detail) {
      summary.skipped_state += 1;
      continue;
    }
    if (detail.skippedInterval) {
      summary.skipped_interval += 1;
      continue;
    }
    summary.triggered += 1;
    summary.reminders.push(detail);
  }
  return summary;
};

const getSlaSummary = async (minOverdueHours, reminderPaging = { page: 1, limit: 10, offset: 0 }) => {
  const minHours = Number.isInteger(minOverdueHours) && minOverdueHours >= 0 ? minOverdueHours : 0;
  const safeReminderPaging = {
    page: Number.isInteger(reminderPaging.page) && reminderPaging.page > 0 ? reminderPaging.page : 1,
    limit:
      Number.isInteger(reminderPaging.limit) && reminderPaging.limit > 0
        ? Math.min(reminderPaging.limit, 200)
        : 10,
    offset:
      Number.isInteger(reminderPaging.offset) && reminderPaging.offset >= 0 ? reminderPaging.offset : 0,
  };

  const [rules, overdueRows, reminderTotalRow, reminderRows] = await Promise.all([
    listSlaRules(),
    query(
      `SELECT j.id,
              j.job_no,
              j.device_sn,
              j.device_model,
              j.customer_name,
              j.current_stage,
              j.updated_at,
              TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) AS overdue_hours,
              r.threshold_hours
       FROM device_jobs j
       JOIN device_sla_rules r ON r.stage_code = j.current_stage AND r.enabled = 1
       WHERE j.status <> 'COMPLETED'
         AND TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) >= r.threshold_hours
         AND TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) >= ?
       ORDER BY overdue_hours DESC, j.updated_at ASC
      LIMIT 200`,
      [minHours]
    ),
    get('SELECT COUNT(*) AS total FROM device_sla_reminders'),
    query(
      `SELECT r.id,
              r.job_id,
              r.stage_code,
              r.threshold_hours,
              r.overdue_hours,
              r.message,
              r.created_at,
              j.job_no,
              j.device_sn,
              j.customer_name
       FROM device_sla_reminders r
       LEFT JOIN device_jobs j ON j.id = r.job_id
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`,
      [safeReminderPaging.limit, safeReminderPaging.offset]
    ),
  ]);

  const reminderTotal = Number(reminderTotalRow?.total || 0);
  return {
    generated_at: new Date().toISOString(),
    min_overdue_hours: minHours,
    rules,
    overdue_jobs: overdueRows.map((item) => ({
      ...item,
      overdue_hours: Number(item.overdue_hours || 0),
      threshold_hours: Number(item.threshold_hours || 0),
    })),
    recent_reminders: reminderRows.map((item) => ({
      ...item,
      threshold_hours: Number(item.threshold_hours || 0),
      overdue_hours: Number(item.overdue_hours || 0),
    })),
    reminder_paging: {
      page: safeReminderPaging.page,
      limit: safeReminderPaging.limit,
      total: reminderTotal,
    },
  };
};

const verifyAuditChain = async ({ fromId, toId, limit }) => {
  const safeFromId = Number.isInteger(fromId) && fromId > 0 ? fromId : 0;
  const safeToId = Number.isInteger(toId) && toId > 0 ? toId : 0;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20000) : 5000;
  if (safeFromId && safeToId && safeFromId > safeToId) throw appError('from_id 不能大于 to_id');

  const where = [];
  const params = [];
  if (safeFromId) {
    where.push('id >= ?');
    params.push(safeFromId);
  }
  if (safeToId) {
    where.push('id <= ?');
    params.push(safeToId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT id, job_id, user_sub, username, user_role, action, entity, entity_id, message, before_data, after_data, request_ip, created_at, chain_prev_hash, chain_hash
     FROM device_operation_logs
     ${whereSql}
     ORDER BY id ASC
     LIMIT ?`,
    [...params, safeLimit]
  );

  let prevHash = '';
  if (rows.length > 0 && Number(rows[0].id || 0) > 1) {
    const anchor = await get('SELECT chain_hash FROM device_operation_logs WHERE id < ? ORDER BY id DESC LIMIT 1', [rows[0].id]);
    prevHash = trimText(anchor?.chain_hash);
  }

  const issues = [];
  for (const row of rows) {
    const beforeData = parseJsonSafe(row.before_data);
    const afterData = parseJsonSafe(row.after_data);
    const expectedHash = computeAuditHash({
      id: row.id,
      prevHash,
      jobId: row.job_id,
      userSub: row.user_sub,
      username: row.username,
      userRole: row.user_role,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      message: row.message,
      beforeData,
      afterData,
      requestIp: row.request_ip,
      createdAt: row.created_at,
    });

    const rowPrevHash = trimText(row.chain_prev_hash);
    const rowHash = trimText(row.chain_hash);

    if (!rowPrevHash || rowPrevHash !== prevHash) {
      issues.push({
        id: Number(row.id),
        issue: 'PREV_HASH_MISMATCH',
        expected_prev_hash: prevHash || null,
        actual_prev_hash: rowPrevHash || null,
      });
    }
    if (!rowHash) {
      issues.push({
        id: Number(row.id),
        issue: 'MISSING_HASH',
        expected_hash: expectedHash,
        actual_hash: null,
      });
    } else if (rowHash !== expectedHash) {
      issues.push({
        id: Number(row.id),
        issue: 'HASH_MISMATCH',
        expected_hash: expectedHash,
        actual_hash: rowHash,
      });
    }

    prevHash = rowHash || expectedHash;
  }

  return {
    verified_at: new Date().toISOString(),
    range: {
      from_id: safeFromId || null,
      to_id: safeToId || null,
      limit: safeLimit,
    },
    total_checked: rows.length,
    issue_count: issues.length,
    passed: issues.length === 0,
    issues: issues.slice(0, 300),
  };
};

const rebuildAuditChainHashes = async () => {
  const rows = await query(
    `SELECT id, job_id, user_sub, username, user_role, action, entity, entity_id, message, before_data, after_data, request_ip, created_at, chain_prev_hash, chain_hash
     FROM device_operation_logs
     ORDER BY id ASC`
  );
  let prevHash = '';
  let updated = 0;
  for (const row of rows) {
    const expectedHash = computeAuditHash({
      id: row.id,
      prevHash,
      jobId: row.job_id,
      userSub: row.user_sub,
      username: row.username,
      userRole: row.user_role,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      message: row.message,
      beforeData: parseJsonSafe(row.before_data),
      afterData: parseJsonSafe(row.after_data),
      requestIp: row.request_ip,
      createdAt: row.created_at,
    });
    const rowPrevHash = trimText(row.chain_prev_hash);
    const rowHash = trimText(row.chain_hash);
    if (rowPrevHash !== prevHash || rowHash !== expectedHash) {
      await query('UPDATE device_operation_logs SET chain_prev_hash = ?, chain_hash = ?, chain_version = ? WHERE id = ?', [
        prevHash || null,
        expectedHash,
        'v1',
        row.id,
      ]);
      updated += 1;
    }
    prevHash = expectedHash;
  }
  return {
    total: rows.length,
    updated,
  };
};

const ensureAllowedCallbackUrl = (rawUrl) => {
  const value = trimText(rawUrl);
  if (!value) throw appError('callback_url 不能为空');
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_err) {
    throw appError('callback_url 非法');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw appError('callback_url 仅支持 http/https');
  return parsed.toString();
};

const enqueueCallbackEventTx = async (tx, { eventType, jobId = null, payload }) => {
  const safeEventType = trimText(eventType).toLowerCase();
  if (!safeEventType) return 0;
  const result = await tx.run(
    `INSERT INTO device_callback_events
     (event_type, job_id, payload, status, next_retry_at)
     VALUES (?, ?, ?, 'PENDING', NOW())`,
    [safeEventType, jobId || null, JSON.stringify(payload || {})]
  );
  return Number(result.insertId || 0);
};

const buildCallbackSignature = (secret, body) =>
  crypto.createHmac('sha256', String(secret || '')).update(body).digest('hex');

const runCallbackWorkerBatch = async ({ maxEvents = CALLBACK_WORKER_BATCH } = {}) => {
  const limit = Math.max(1, Math.min(Number(maxEvents || CALLBACK_WORKER_BATCH), 100));
  const pending = await query(
    `SELECT id, event_type, job_id, payload, attempt_count
     FROM device_callback_events
     WHERE status = 'PENDING' AND next_retry_at <= NOW()
     ORDER BY id ASC
     LIMIT ?`,
    [limit]
  );
  const summary = {
    scanned: pending.length,
    success: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
  };

  for (const eventRow of pending) {
    const eventId = Number(eventRow.id);
    const payloadObj = parseJsonSafe(eventRow.payload) || {};
    const eventType = trimText(eventRow.event_type).toLowerCase();
    const subscriptions = await query(
      `SELECT id, name, callback_url, secret, timeout_ms, retry_limit
       FROM device_callback_subscriptions
       WHERE enabled = 1
         AND (
           FIND_IN_SET(?, REPLACE(events, ' ', '')) > 0
           OR FIND_IN_SET('*', REPLACE(events, ' ', '')) > 0
         )
       ORDER BY id ASC`,
      [eventType]
    );

    if (subscriptions.length === 0) {
      await query(`UPDATE device_callback_events SET status = 'SUCCESS', updated_at = NOW() WHERE id = ?`, [eventId]);
      summary.skipped += 1;
      continue;
    }

    let allSuccess = true;
    let retryLimit = 3;
    for (const sub of subscriptions) {
      const callbackId = Number(sub.id);
      const timeoutMs = Math.max(1000, Math.min(Number(sub.timeout_ms || 5000), 15000));
      retryLimit = Math.max(retryLimit, Number(sub.retry_limit || 3));
      const bodyText = JSON.stringify({
        event: eventType,
        event_id: eventId,
        emitted_at: new Date().toISOString(),
        payload: payloadObj,
      });
      const signature = buildCallbackSignature(sub.secret, bodyText);
      const startedAt = Date.now();
      let responseCode = 0;
      let responseBody = '';
      let errorMessage = '';
      try {
        const resp = await fetchWithTimeout(
          sub.callback_url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Device-Flow-Event': eventType,
              'X-Device-Flow-Signature': signature,
            },
            body: bodyText,
          },
          timeoutMs
        );
        responseCode = Number(resp.status || 0);
        responseBody = trimText(await resp.text()).slice(0, 2000);
        if (responseCode < 200 || responseCode >= 300) {
          allSuccess = false;
          errorMessage = `HTTP ${responseCode}`;
        }
      } catch (err) {
        allSuccess = false;
        errorMessage = trimText(err?.message) || 'callback request failed';
      }
      const durationMs = Date.now() - startedAt;
      await query(
        `INSERT INTO device_callback_deliveries
         (event_id, callback_id, attempt_no, request_body, response_code, response_body, duration_ms, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          callbackId,
          Number(eventRow.attempt_count || 0) + 1,
          bodyText,
          responseCode || null,
          responseBody || null,
          durationMs,
          errorMessage || null,
        ]
      );
    }

    const nextAttempt = Number(eventRow.attempt_count || 0) + 1;
    if (allSuccess) {
      await query(
        `UPDATE device_callback_events
         SET status = 'SUCCESS', attempt_count = ?, last_error = NULL, last_http_code = 200, updated_at = NOW()
         WHERE id = ?`,
        [nextAttempt, eventId]
      );
      summary.success += 1;
    } else if (nextAttempt >= retryLimit) {
      await query(
        `UPDATE device_callback_events
         SET status = 'GAVE_UP', attempt_count = ?, last_error = 'callback delivery failed', updated_at = NOW()
         WHERE id = ?`,
        [nextAttempt, eventId]
      );
      summary.failed += 1;
    } else {
      await query(
        `UPDATE device_callback_events
         SET status = 'PENDING',
             attempt_count = ?,
             next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
             last_error = 'callback delivery failed',
             updated_at = NOW()
         WHERE id = ?`,
        [nextAttempt, Math.min(1800, 30 * nextAttempt), eventId]
      );
      summary.retried += 1;
    }
  }
  return summary;
};

const getDiskUsage = async (targetPath) => {
  try {
    if (typeof fs.promises.statfs !== 'function') {
      return { path: targetPath, total_bytes: 0, free_bytes: 0, used_percent: 0 };
    }
    const stat = await fs.promises.statfs(targetPath);
    const totalBytes = Number(stat.bsize || 0) * Number(stat.blocks || 0);
    const freeBytes = Number(stat.bsize || 0) * Number(stat.bavail || 0);
    const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 10000) / 100 : 0;
    return {
      path: targetPath,
      total_bytes: totalBytes,
      free_bytes: freeBytes,
      used_percent: usedPercent,
    };
  } catch (_err) {
    return { path: targetPath, total_bytes: 0, free_bytes: 0, used_percent: 0 };
  }
};

const getOpsDashboard = async () => {
  const [summaryRow, slowRows, queueRow, retentionQueueRow, uploadDisk, archiveDisk] = await Promise.all([
    get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors,
              AVG(latency_ms) AS avg_latency_ms,
              MAX(latency_ms) AS max_latency_ms
       FROM device_ops_metrics
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    ),
    query(
      `SELECT route_path, method,
              COUNT(*) AS request_count,
              AVG(latency_ms) AS avg_latency_ms,
              MAX(latency_ms) AS max_latency_ms,
              SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS error_count
       FROM device_ops_metrics
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY route_path, method
       HAVING AVG(latency_ms) >= 300
       ORDER BY avg_latency_ms DESC
       LIMIT 20`
    ),
    get(`SELECT COUNT(*) AS total FROM device_callback_events WHERE status = 'PENDING' AND next_retry_at <= NOW()`),
    get(`SELECT COUNT(*) AS total FROM device_attachments WHERE storage_tier = 'HOT' AND uploaded_at < DATE_SUB(NOW(), INTERVAL 180 DAY)`),
    getDiskUsage(UPLOAD_ROOT),
    getDiskUsage(ARCHIVE_ROOT),
  ]);

  const total = Number(summaryRow?.total || 0);
  const errors = Number(summaryRow?.errors || 0);
  return {
    generated_at: new Date().toISOString(),
    request_24h: {
      total,
      errors,
      failure_rate: total > 0 ? Number((errors / total).toFixed(4)) : 0,
      avg_latency_ms: Number(summaryRow?.avg_latency_ms || 0),
      max_latency_ms: Number(summaryRow?.max_latency_ms || 0),
    },
    slow_endpoints: slowRows.map((item) => ({
      route_path: item.route_path,
      method: item.method,
      request_count: Number(item.request_count || 0),
      avg_latency_ms: Number(item.avg_latency_ms || 0),
      max_latency_ms: Number(item.max_latency_ms || 0),
      error_count: Number(item.error_count || 0),
    })),
    queue_backlog: {
      callback_pending: Number(queueRow?.total || 0),
      attachment_archive_candidate: Number(retentionQueueRow?.total || 0),
    },
    disk_usage: {
      upload_root: uploadDisk,
      archive_root: archiveDisk,
    },
  };
};

const runRetentionForAttachments = async ({ actor, requestIp, dryRun = false } = {}) => {
  const policy = await get(
    `SELECT hot_days, cold_days, delete_days, enabled
     FROM device_retention_policies
     WHERE target_type = 'ATTACHMENT'
     LIMIT 1`
  );
  if (!policy || Number(policy.enabled || 0) !== 1) {
    return { policy_enabled: false, archived: 0, deleted: 0, scanned: 0 };
  }
  const hotDays = Math.max(1, Number(policy.hot_days || 180));
  const deleteDays = Math.max(hotDays + 1, Number(policy.delete_days || 730));

  const candidates = await query(
    `SELECT id, job_id, file_path, stored_name, uploaded_at
     FROM device_attachments
     WHERE deleted_at IS NULL
       AND storage_tier = 'HOT'
       AND uploaded_at < DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY id ASC
     LIMIT 1000`,
    [hotDays]
  );

  let archived = 0;
  for (const row of candidates) {
    const resolved = path.resolve(row.file_path || '');
    const archiveDir = path.join(ARCHIVE_ROOT, new Date().toISOString().slice(0, 7).replace('-', ''));
    const archivePath = path.resolve(path.join(archiveDir, row.stored_name || `${row.id}.bin`));
    if (!dryRun) {
      if (resolved && fs.existsSync(resolved)) {
        fs.mkdirSync(archiveDir, { recursive: true });
        try {
          fs.renameSync(resolved, archivePath);
        } catch (_err) {
          try {
            fs.copyFileSync(resolved, archivePath);
            fs.unlinkSync(resolved);
          } catch {
            continue;
          }
        }
      }
      await query(
        `UPDATE device_attachments
         SET storage_tier = 'COLD',
             archived_at = NOW(),
             archive_path = ?,
             purge_after = DATE_ADD(uploaded_at, INTERVAL ? DAY)
         WHERE id = ?`,
        [archivePath, deleteDays, row.id]
      );
    }
    archived += 1;
  }

  const deleteCandidates = await query(
    `SELECT id, file_path, archive_path
     FROM device_attachments
     WHERE deleted_at IS NULL
       AND purge_after IS NOT NULL
       AND purge_after <= NOW()
     ORDER BY id ASC
     LIMIT 1000`
  );
  let deleted = 0;
  for (const row of deleteCandidates) {
    if (!dryRun) {
      const candidatesPath = [path.resolve(row.file_path || ''), path.resolve(row.archive_path || '')];
      for (const itemPath of candidatesPath) {
        if (!itemPath) continue;
        if (!itemPath.startsWith(UPLOAD_ROOT) && !itemPath.startsWith(ARCHIVE_ROOT)) continue;
        if (!fs.existsSync(itemPath)) continue;
        try {
          fs.unlinkSync(itemPath);
        } catch (_err) {
          // keep going
        }
      }
      await query(
        `UPDATE device_attachments
         SET storage_tier = 'DELETED',
             deleted_at = NOW()
         WHERE id = ?`,
        [row.id]
      );
    }
    deleted += 1;
  }

  if (!dryRun) {
    await transaction(async (tx) => {
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor?.sub || 'system',
        username: actor?.name || 'system',
        userRole: actor?.role || 'system',
        action: 'RETENTION_RUN',
        entity: 'retention',
        entityId: null,
        message: `执行数据保留策略：归档 ${archived}，清理 ${deleted}`,
        beforeData: null,
        afterData: { archived, deleted, scanned: candidates.length + deleteCandidates.length },
        requestIp: requestIp || '127.0.0.1',
      });
    });
  }

  return {
    policy_enabled: true,
    hot_days: hotDays,
    delete_days: deleteDays,
    scanned: candidates.length + deleteCandidates.length,
    archived,
    deleted,
    dry_run: Boolean(dryRun),
  };
};

const buildCycleReport = async ({ fromDate = '', toDate = '' } = {}) => {
  const where = [];
  const params = [];
  if (fromDate) {
    where.push('s.operated_at >= CONCAT(?, " 00:00:00")');
    params.push(fromDate);
  }
  if (toDate) {
    where.push('s.operated_at < DATE_ADD(CONCAT(?, " 00:00:00"), INTERVAL 1 DAY)');
    params.push(toDate);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const stageRows = await query(
    `SELECT s.job_id, s.from_stage, s.to_stage, s.operator_sub, s.operator_name, s.operator_role, s.operated_at,
            j.job_no, j.device_sn, j.customer_name, j.status, j.created_at, j.shipped_at
     FROM device_stage_records s
     JOIN device_jobs j ON j.id = s.job_id
     ${whereSql}
     ORDER BY s.job_id ASC, s.operated_at ASC, s.id ASC
     LIMIT 200000`,
    params
  );

  const byJob = new Map();
  for (const row of stageRows) {
    const jobId = Number(row.job_id);
    if (!byJob.has(jobId)) byJob.set(jobId, []);
    byJob.get(jobId).push(row);
  }

  const stageDurationMap = new Map();
  const userCountMap = new Map();
  const overdueTrendMap = new Map();
  const jobs = [];

  for (const [, rows] of byJob.entries()) {
    if (!rows.length) continue;
    const job = rows[0];
    jobs.push({
      job_id: Number(job.job_id),
      job_no: job.job_no,
      device_sn: job.device_sn,
      customer_name: job.customer_name,
      status: job.status,
      created_at: job.created_at,
      shipped_at: job.shipped_at,
    });

    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const diffMs = new Date(String(curr.operated_at).replace(' ', 'T')).getTime() - new Date(String(prev.operated_at).replace(' ', 'T')).getTime();
      if (!Number.isFinite(diffMs) || diffMs < 0) continue;
      const diffHours = diffMs / 1000 / 3600;
      const stageKey = trimText(curr.to_stage).toUpperCase();
      const bucket = stageDurationMap.get(stageKey) || { totalHours: 0, count: 0, maxHours: 0 };
      bucket.totalHours += diffHours;
      bucket.count += 1;
      bucket.maxHours = Math.max(bucket.maxHours, diffHours);
      stageDurationMap.set(stageKey, bucket);
    }

    rows.forEach((row) => {
      const key = `${trimText(row.operator_sub)}|${trimText(row.operator_name)}|${trimText(row.operator_role)}`;
      if (!trimText(row.operator_sub)) return;
      userCountMap.set(key, (userCountMap.get(key) || 0) + 1);
    });

    const finishedAtText = trimText(job.shipped_at);
    const createdAtText = trimText(job.created_at);
    if (finishedAtText && createdAtText) {
      const hours =
        (new Date(finishedAtText.replace(' ', 'T')).getTime() - new Date(createdAtText.replace(' ', 'T')).getTime()) / 1000 / 3600;
      if (Number.isFinite(hours)) {
        const day = finishedAtText.slice(0, 10);
        const trend = overdueTrendMap.get(day) || { day, total: 0, overdue: 0 };
        trend.total += 1;
        if (hours > 72) trend.overdue += 1;
        overdueTrendMap.set(day, trend);
      }
    }
  }

  const stageDurations = Array.from(stageDurationMap.entries()).map(([stage, item]) => ({
    stage,
    avg_hours: item.count > 0 ? Number((item.totalHours / item.count).toFixed(2)) : 0,
    max_hours: Number(item.maxHours.toFixed(2)),
    samples: Number(item.count),
  }));
  stageDurations.sort((a, b) => b.avg_hours - a.avg_hours);
  const bottleneck = stageDurations[0] || null;

  const userEfficiency = Array.from(userCountMap.entries())
    .map(([key, count]) => {
      const [sub, name, role] = key.split('|');
      return { operator_sub: sub, operator_name: name, operator_role: role, operations: Number(count) };
    })
    .sort((a, b) => b.operations - a.operations)
    .slice(0, 50);

  const overdueTrend = Array.from(overdueTrendMap.values())
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((item) => ({
      day: item.day,
      completed_total: Number(item.total),
      overdue_total: Number(item.overdue),
      overdue_rate: item.total > 0 ? Number((item.overdue / item.total).toFixed(4)) : 0,
    }));

  return {
    generated_at: new Date().toISOString(),
    filters: {
      from: fromDate || '',
      to: toDate || '',
    },
    totals: {
      jobs: jobs.length,
    },
    stage_durations: stageDurations,
    bottleneck_stage: bottleneck,
    user_efficiency: userEfficiency,
    overdue_trend: overdueTrend,
  };
};

app.use(authRequired);
app.use(restrictAuditorToAudit);

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, service: 'device-flow', time: new Date().toISOString() });
  })
);

app.get(
  '/api/auth/me',
  asyncHandler(async (req, res) => {
    res.json({
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      apps: req.authApps,
    });
  })
);

app.post(
  '/api/device-flow/scan/parse',
  asyncHandler(async (req, res) => {
    const parsed = parseScanInput(req.body?.raw || req.body?.scan_input || '');
    res.json(parsed);
  })
);

app.post(
  '/api/device-flow/jobs/:id/scan/apply',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const actor = getActor(req);
    const expectedVersion = parseExpectedVersion(req);
    const parsed = parseScanInput(req.body?.raw || req.body?.scan_input || '');
    const fields = parsed.fields || {};
    if (!fields.device_sn && !fields.inbound_tracking_no && !fields.outbound_tracking_no) {
      throw appError('扫码内容未识别到可写入字段');
    }

    const updated = await transaction(async (tx) => {
      const job = await tx.get('SELECT * FROM device_jobs WHERE id = ? FOR UPDATE', [id]);
      if (!job) throw appError('流转单不存在', 404);
      if (String(job.status || '').toUpperCase() === 'VOIDED') throw appError('流转单已作废，不能扫码写入', 409);
      if (expectedVersion && Number(job.row_version || 0) !== Number(expectedVersion)) {
        throw appError(`版本冲突：当前版本 ${Number(job.row_version || 0)}，请刷新后重试`, 409);
      }
      await assertActiveJobLock(tx, id, actor);

      await tx.run(
        `UPDATE device_jobs
         SET device_sn = COALESCE(NULLIF(?, ''), device_sn),
             inbound_tracking_no = COALESCE(NULLIF(?, ''), inbound_tracking_no),
             outbound_tracking_no = COALESCE(NULLIF(?, ''), outbound_tracking_no),
             row_version = row_version + 1
         WHERE id = ?`,
        [
          trimText(fields.device_sn).toUpperCase(),
          trimText(fields.inbound_tracking_no),
          trimText(fields.outbound_tracking_no),
          id,
        ]
      );
      const after = await tx.get('SELECT * FROM device_jobs WHERE id = ?', [id]);

      await writeOperationLogTx(tx, {
        jobId: id,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'SCAN_APPLY',
        entity: 'device_job',
        entityId: id,
        message: '扫码录入流转单字段',
        beforeData: {
          device_sn: job.device_sn,
          inbound_tracking_no: job.inbound_tracking_no,
          outbound_tracking_no: job.outbound_tracking_no,
          row_version: Number(job.row_version || 0),
        },
        afterData: {
          device_sn: after.device_sn,
          inbound_tracking_no: after.inbound_tracking_no,
          outbound_tracking_no: after.outbound_tracking_no,
          row_version: Number(after.row_version || 0),
        },
        requestIp: req.ip,
      });

      return after;
    });

    res.json({
      parsed,
      job: updated,
    });
  })
);

app.get(
  '/api/device-flow/dashboard/summary',
  asyncHandler(async (req, res) => {
    const overdueDaysRaw = Number(req.query.overdue_days || DASHBOARD_OVERDUE_DAYS);
    const overdueDays =
      Number.isInteger(overdueDaysRaw) && overdueDaysRaw > 0 ? Math.min(overdueDaysRaw, 30) : DASHBOARD_OVERDUE_DAYS;
    const stage = parseStageFilter(req.query.stage, 'stage');
    const customer = trimText(req.query.customer);
    const { whereSql: jobWhereSql, params: jobParams } = buildDashboardJobWhere({ stage, customer });

    const [stageRows, totalRow, openRow, completedRow, createdTodayRow, shippedTodayRow, overdueRows, recentRows] =
      await Promise.all([
        query(`SELECT j.current_stage, COUNT(*) AS total FROM device_jobs j ${jobWhereSql} GROUP BY j.current_stage`, jobParams),
        get(`SELECT COUNT(*) AS total FROM device_jobs j ${jobWhereSql}`, jobParams),
        get(
          `SELECT COUNT(*) AS total FROM device_jobs j ${appendWhereClause(jobWhereSql, "j.status <> 'COMPLETED'")}`,
          jobParams
        ),
        get(
          `SELECT COUNT(*) AS total FROM device_jobs j ${appendWhereClause(jobWhereSql, "j.status = 'COMPLETED'")}`,
          jobParams
        ),
        get(
          `SELECT COUNT(*) AS total FROM device_jobs j ${appendWhereClause(jobWhereSql, 'DATE(j.created_at) = CURDATE()')}`,
          jobParams
        ),
        get(
          `SELECT COUNT(*) AS total FROM device_jobs j ${appendWhereClause(jobWhereSql, 'DATE(j.shipped_at) = CURDATE()')}`,
          jobParams
        ),
        query(
          `SELECT j.id,
                  j.job_no,
                  j.device_sn,
                  j.customer_name,
                  j.current_stage,
                  j.status,
                  j.updated_at,
                  j.created_at,
                  TIMESTAMPDIFF(DAY, j.updated_at, NOW()) AS overdue_days
           FROM device_jobs j
           ${appendWhereClause(
             jobWhereSql,
             "j.status <> 'COMPLETED' AND TIMESTAMPDIFF(DAY, j.updated_at, NOW()) >= ?"
           )}
           ORDER BY j.updated_at ASC
           LIMIT 100`,
          [...jobParams, overdueDays]
        ),
        query(
          `SELECT l.*,
                  j.job_no,
                  j.device_sn,
                  j.customer_name,
                  j.current_stage
           FROM device_operation_logs l
           LEFT JOIN device_jobs j ON j.id = l.job_id
           ${jobWhereSql}
           ORDER BY l.id DESC
           LIMIT 20`,
          jobParams
        ),
      ]);

    const stageCountMap = {};
    STAGES.forEach((stage) => {
      stageCountMap[stage] = 0;
    });
    for (const item of stageRows) {
      const key = String(item.current_stage || '').toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(stageCountMap, key)) continue;
      stageCountMap[key] = Number(item.total || 0);
    }

    res.json({
      generated_at: new Date().toISOString(),
      overdue_days: overdueDays,
      filters: {
        stage: stage || '',
        customer: customer || '',
      },
      totals: {
        total_jobs: Number(totalRow?.total || 0),
        open_jobs: Number(openRow?.total || 0),
        completed_jobs: Number(completedRow?.total || 0),
        created_today: Number(createdTodayRow?.total || 0),
        shipped_today: Number(shippedTodayRow?.total || 0),
      },
      stage_counts: STAGES.map((stage) => ({
        stage,
        total: Number(stageCountMap[stage] || 0),
      })),
      overdue_jobs: overdueRows.map((item) => ({
        ...item,
        overdue_days: Number(item.overdue_days || 0),
      })),
      recent_logs: recentRows.map(toPublicOperationLog),
    });
  })
);

app.get(
  '/api/device-flow/sla/summary',
  asyncHandler(async (req, res) => {
    const minOverdueHoursRaw = Number(req.query.min_overdue_hours || 0);
    const minOverdueHours =
      Number.isInteger(minOverdueHoursRaw) && minOverdueHoursRaw >= 0 ? Math.min(minOverdueHoursRaw, 720) : 0;
    const reminderPaging = parsePaging(req.query.page, req.query.limit || 10);
    const summary = await getSlaSummary(minOverdueHours, reminderPaging);
    res.json(summary);
  })
);

app.put(
  '/api/device-flow/sla/rules',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const parsedRules = normalizeSlaRuleInput(req.body?.rules);
    await transaction(async (tx) => {
      for (const rule of parsedRules) {
        await tx.run(
          `INSERT INTO device_sla_rules
           (stage_code, threshold_hours, remind_interval_minutes, enabled)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             threshold_hours = VALUES(threshold_hours),
             remind_interval_minutes = VALUES(remind_interval_minutes),
             enabled = VALUES(enabled)`,
          [rule.stageCode, rule.thresholdHours, rule.remindIntervalMinutes, rule.enabled]
        );
      }
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UPDATE_SLA_RULES',
        entity: 'sla_rules',
        entityId: null,
        message: `更新 SLA 规则 ${parsedRules.length} 条`,
        beforeData: null,
        afterData: parsedRules,
        requestIp: req.ip,
      });
    });

    const rules = await listSlaRules();
    res.json({
      updated: parsedRules.length,
      rules,
    });
  })
);

app.post(
  '/api/device-flow/sla/run',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const maxScanRaw = Number(req.body?.max_scan || 300);
    const maxScan = Number.isInteger(maxScanRaw) && maxScanRaw > 0 ? Math.min(maxScanRaw, 1000) : 300;
    const result = await runSlaReminderCheck({
      actor,
      requestIp: req.ip,
      maxScan,
    });
    res.json(result);
  })
);

app.delete(
  '/api/device-flow/sla/reminders/:id',
  requireWriter,
  asyncHandler(async (req, res) => {
    const reminderId = Number(req.params.id || 0);
    if (!Number.isInteger(reminderId) || reminderId <= 0) throw appError('id 参数非法');

    const actor = getActor(req);
    const reminder = await get(
      `SELECT id, job_id, stage_code, threshold_hours, overdue_hours, message, created_at
       FROM device_sla_reminders
       WHERE id = ?`,
      [reminderId]
    );
    if (!reminder) throw appError('催办记录不存在', 404);

    await transaction(async (tx) => {
      await tx.run('DELETE FROM device_sla_reminders WHERE id = ?', [reminderId]);
      await writeOperationLogTx(tx, {
        jobId: Number(reminder.job_id || 0) || null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'DELETE_SLA_REMINDER',
        entity: 'sla_reminder',
        entityId: reminderId,
        message: `删除催办记录 #${reminderId}`,
        beforeData: reminder,
        afterData: {
          id: reminderId,
          deleted: true,
        },
        requestIp: req.ip,
      });
    });

    res.json({ deleted: 1, id: reminderId });
  })
);

app.delete(
  '/api/device-flow/sla/reminders',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const totalRow = await get('SELECT COUNT(*) AS total FROM device_sla_reminders');
    const total = Number(totalRow?.total || 0);
    if (total <= 0) return res.json({ deleted: 0 });

    await transaction(async (tx) => {
      await tx.run('DELETE FROM device_sla_reminders');
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'PURGE_SLA_REMINDERS',
        entity: 'sla_reminder',
        entityId: null,
        message: `清空催办记录 ${total} 条`,
        beforeData: {
          total,
        },
        afterData: {
          deleted: total,
          deleted_all: true,
        },
        requestIp: req.ip,
      });
    });

    res.json({ deleted: total });
  })
);

app.get(
  '/api/device-flow/logs',
  requireAuditReader,
  asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query.page, req.query.limit);
    const from = parseDateOnly(req.query.from, 'from');
    const to = parseDateOnly(req.query.to, 'to');
    const action = trimText(req.query.action).toUpperCase();
    const username = trimText(req.query.username);
    const keyword = trimText(req.query.keyword);
    const jobIdRaw = trimText(req.query.job_id);

    if (from && to && from > to) throw appError('from 不能晚于 to');

    let jobId = 0;
    if (jobIdRaw) {
      jobId = Number(jobIdRaw);
      if (!Number.isInteger(jobId) || jobId <= 0) throw appError('job_id 参数非法');
    }

    const where = [];
    const params = [];

    appendDateRangeWhere({
      from,
      to,
      column: 'l.created_at',
      where,
      params,
    });

    if (action) {
      where.push('l.action = ?');
      params.push(action);
    }

    if (username) {
      where.push('l.username LIKE ?');
      params.push(`%${username}%`);
    }

    if (jobId) {
      where.push('l.job_id = ?');
      params.push(jobId);
    }

    if (keyword) {
      where.push(
        '(l.action LIKE ? OR l.message LIKE ? OR j.job_no LIKE ? OR j.device_sn LIKE ? OR j.customer_name LIKE ?)'
      );
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await get(
      `SELECT COUNT(*) AS total
       FROM device_operation_logs l
       LEFT JOIN device_jobs j ON j.id = l.job_id
       ${whereSql}`,
      params
    );
    const rows = await query(
      `SELECT l.*,
              j.job_no,
              j.device_sn,
              j.customer_name,
              j.current_stage
       FROM device_operation_logs l
       LEFT JOIN device_jobs j ON j.id = l.job_id
       ${whereSql}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`,
      [...params, paging.limit, paging.offset]
    );

    res.setHeader('X-Total-Count', String(Number(totalRow?.total || 0)));
    res.setHeader('X-Page', String(paging.page));
    res.setHeader('X-Limit', String(paging.limit));
    res.json(rows.map(toPublicOperationLog));
  })
);

app.get(
  '/api/device-flow/audit/verify',
  requireAuditReader,
  asyncHandler(async (req, res) => {
    const fromIdRaw = Number(req.query.from_id || 0);
    const toIdRaw = Number(req.query.to_id || 0);
    const limitRaw = Number(req.query.limit || 5000);
    const fromId = Number.isInteger(fromIdRaw) && fromIdRaw > 0 ? fromIdRaw : 0;
    const toId = Number.isInteger(toIdRaw) && toIdRaw > 0 ? toIdRaw : 0;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20000) : 5000;

    const result = await verifyAuditChain({ fromId, toId, limit });
    res.json(result);
  })
);

app.post(
  '/api/device-flow/jobs',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const createdRow = await createJobWithActor({
      actor,
      jobData: req.body || {},
      requestIp: req.ip,
      source: 'manual',
    });
    res.status(201).json(createdRow);
  })
);

app.get(
  '/api/device-flow/jobs',
  asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query.page, req.query.limit);
    const keyword = trimText(req.query.keyword);
    const stage = trimText(req.query.stage).toUpperCase();

    const where = [];
    const params = [];
    if (keyword) {
      where.push(
        '(job_no LIKE ? OR device_sn LIKE ? OR customer_name LIKE ? OR sales_order_no LIKE ? OR inbound_tracking_no LIKE ? OR outbound_tracking_no LIKE ?)'
      );
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (stage) {
      if (!STAGES.includes(stage)) throw appError('stage 参数非法');
      where.push('current_stage = ?');
      params.push(stage);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await get(`SELECT COUNT(*) AS total FROM device_jobs ${whereSql}`, params);
    const rows = await query(
      `SELECT * FROM device_jobs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, paging.limit, paging.offset]
    );

    res.setHeader('X-Total-Count', String(Number(totalRow?.total || 0)));
    res.setHeader('X-Page', String(paging.page));
    res.setHeader('X-Limit', String(paging.limit));
    res.json(rows);
  })
);

app.get(
  '/api/device-flow/hardware/templates',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT id, model_code, model_name, check_items, enabled, updated_at
       FROM device_hardware_templates
       ORDER BY model_code ASC
       LIMIT 1000`
    );
    res.json(
      rows.map((item) => ({
        id: Number(item.id),
        model_code: item.model_code,
        model_name: item.model_name,
        enabled: Number(item.enabled || 0) === 1,
        check_items: parseHardwareTemplateItems(item.check_items),
        updated_at: item.updated_at,
      }))
    );
  })
);

app.put(
  '/api/device-flow/hardware/templates',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const items = Array.isArray(req.body?.templates) ? req.body.templates : null;
    if (!items || items.length === 0) throw appError('templates 不能为空');
    if (items.length > 200) throw appError('单次最多更新200个模板');

    await transaction(async (tx) => {
      for (const item of items) {
        const modelCode = trimText(item?.model_code).toUpperCase();
        const modelName = trimText(item?.model_name);
        if (!modelCode) throw appError('model_code 不能为空');
        const checkItemsRaw = Array.isArray(item?.check_items) ? item.check_items : [];
        const checkItems = checkItemsRaw
          .map((check) => ({
            code: trimText(check?.code).toLowerCase(),
            label: trimText(check?.label) || trimText(check?.code),
            required: check?.required === undefined ? true : Boolean(check.required),
          }))
          .filter((check) => check.code && check.label);
        if (checkItems.length === 0) throw appError(`机型 ${modelCode} 缺少 check_items`);
        const enabled = item?.enabled === undefined ? 1 : item?.enabled ? 1 : 0;
        await tx.run(
          `INSERT INTO device_hardware_templates
           (model_code, model_name, check_items, enabled, created_by_sub, created_by_name, updated_by_sub, updated_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             model_name = VALUES(model_name),
             check_items = VALUES(check_items),
             enabled = VALUES(enabled),
             updated_by_sub = VALUES(updated_by_sub),
             updated_by_name = VALUES(updated_by_name)`,
          [modelCode, modelName, JSON.stringify(checkItems), enabled, actor.sub, actor.name, actor.sub, actor.name]
        );
      }

      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UPSERT_HW_TEMPLATES',
        entity: 'device_hardware_templates',
        entityId: null,
        message: `更新硬件模板 ${items.length} 条`,
        beforeData: null,
        afterData: { count: items.length },
        requestIp: req.ip,
      });
    });

    const rows = await query(
      `SELECT id, model_code, model_name, check_items, enabled, updated_at
       FROM device_hardware_templates
       ORDER BY model_code ASC
       LIMIT 1000`
    );
    res.json(
      rows.map((item) => ({
        id: Number(item.id),
        model_code: item.model_code,
        model_name: item.model_name,
        enabled: Number(item.enabled || 0) === 1,
        check_items: parseHardwareTemplateItems(item.check_items),
        updated_at: item.updated_at,
      }))
    );
  })
);

app.get(
  '/api/device-flow/jobs/:id/hardware-baseline',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const ctx = await getHardwareCheckContextForJobId(id);
    if (!ctx) throw appError('流转单不存在', 404);
    const payloadTemplate = {};
    ctx.checkItems.forEach((item) => {
      payloadTemplate[item.code] = 'PASS';
    });
    payloadTemplate.hardware_note = '';
    res.json({
      job_id: id,
      device_model: ctx.deviceModel,
      template: ctx.template
        ? {
            id: ctx.template.id,
            model_code: ctx.template.model_code,
            model_name: ctx.template.model_name,
            updated_at: ctx.template.updated_at,
          }
        : null,
      check_items: ctx.checkItems,
      payload_template: payloadTemplate,
    });
  })
);

app.get(
  '/api/device-flow/permissions/policies',
  requireWriter,
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT id, role_code, department_code, action_code, stage_code, effect, enabled, note, updated_at
       FROM device_permission_policies
       ORDER BY id ASC
       LIMIT 5000`
    );
    res.json(
      rows.map((item) => ({
        id: Number(item.id),
        role_code: item.role_code,
        department_code: item.department_code,
        action_code: item.action_code,
        stage_code: item.stage_code,
        effect: item.effect,
        enabled: Number(item.enabled || 0) === 1,
        note: item.note || '',
        updated_at: item.updated_at,
      }))
    );
  })
);

app.put(
  '/api/device-flow/permissions/policies',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    if (!CHANGE_REVIEW_ROLES.has(normalizeRole(actor.role))) throw appError('仅管理员可修改权限策略', 403);
    const policies = Array.isArray(req.body?.policies) ? req.body.policies : [];
    if (policies.length === 0) throw appError('policies 不能为空');
    if (policies.length > 2000) throw appError('单次最多提交 2000 条');

    await transaction(async (tx) => {
      for (const item of policies) {
        const roleCode = trimText(item?.role_code).toLowerCase() || '*';
        const deptCode = normalizeDepartment(item?.department_code) || '*';
        const actionCode = trimText(item?.action_code).toLowerCase() || '*';
        const stageCode = trimText(item?.stage_code).toUpperCase() || '*';
        const effect = trimText(item?.effect).toUpperCase() || 'ALLOW';
        if (!['ALLOW', 'DENY'].includes(effect)) throw appError('effect 仅支持 ALLOW / DENY');
        const enabled = item?.enabled === undefined ? 1 : item?.enabled ? 1 : 0;
        const note = trimText(item?.note);
        await tx.run(
          `INSERT INTO device_permission_policies
           (role_code, department_code, action_code, stage_code, effect, enabled, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             enabled = VALUES(enabled),
             note = VALUES(note)`,
          [roleCode, deptCode, actionCode, stageCode, effect, enabled, note || null]
        );
      }

      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UPSERT_PERMISSION_POLICIES',
        entity: 'device_permission_policies',
        entityId: null,
        message: `更新权限策略 ${policies.length} 条`,
        beforeData: null,
        afterData: { count: policies.length },
        requestIp: req.ip,
      });
    });

    const rows = await query(
      `SELECT id, role_code, department_code, action_code, stage_code, effect, enabled, note, updated_at
       FROM device_permission_policies
       ORDER BY id ASC
       LIMIT 5000`
    );
    res.json(
      rows.map((item) => ({
        id: Number(item.id),
        role_code: item.role_code,
        department_code: item.department_code,
        action_code: item.action_code,
        stage_code: item.stage_code,
        effect: item.effect,
        enabled: Number(item.enabled || 0) === 1,
        note: item.note || '',
        updated_at: item.updated_at,
      }))
    );
  })
);

app.get(
  '/api/device-flow/dual-sign/policies',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT stage_code, required_signers, enabled, updated_at
       FROM device_dual_sign_policies
       ORDER BY stage_code ASC`
    );
    res.json(
      rows.map((item) => ({
        stage_code: item.stage_code,
        stage_label: SLA_STAGE_LABEL[item.stage_code] || item.stage_code,
        required_signers: Number(item.required_signers || 1),
        enabled: Number(item.enabled || 0) === 1,
        updated_at: item.updated_at,
      }))
    );
  })
);

app.put(
  '/api/device-flow/dual-sign/policies',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    if (!CHANGE_REVIEW_ROLES.has(normalizeRole(actor.role))) throw appError('仅管理员可修改双签策略', 403);
    const rows = Array.isArray(req.body?.policies) ? req.body.policies : [];
    if (rows.length === 0) throw appError('policies 不能为空');
    if (rows.length > STAGES.length) throw appError(`policies 最多 ${STAGES.length} 条`);

    await transaction(async (tx) => {
      for (const item of rows) {
        const stageCode = trimText(item?.stage_code).toUpperCase();
        if (!stageCode || !STAGES.includes(stageCode)) throw appError(`非法 stage_code: ${stageCode}`);
        const requiredSignersRaw = Number(item?.required_signers || 2);
        const requiredSigners = Number.isInteger(requiredSignersRaw) ? Math.max(1, Math.min(requiredSignersRaw, 3)) : 2;
        const enabled = item?.enabled === undefined ? 1 : item?.enabled ? 1 : 0;
        await tx.run(
          `INSERT INTO device_dual_sign_policies
           (stage_code, required_signers, enabled, updated_by_sub, updated_by_name, updated_by_role)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             required_signers = VALUES(required_signers),
             enabled = VALUES(enabled),
             updated_by_sub = VALUES(updated_by_sub),
             updated_by_name = VALUES(updated_by_name),
             updated_by_role = VALUES(updated_by_role)`,
          [stageCode, requiredSigners, enabled, actor.sub, actor.name, actor.role]
        );
      }
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UPDATE_DUAL_SIGN_POLICY',
        entity: 'device_dual_sign_policies',
        entityId: null,
        message: `更新双签策略 ${rows.length} 条`,
        beforeData: null,
        afterData: { count: rows.length },
        requestIp: req.ip,
      });
    });

    const updated = await query(
      `SELECT stage_code, required_signers, enabled, updated_at
       FROM device_dual_sign_policies
       ORDER BY stage_code ASC`
    );
    res.json(
      updated.map((item) => ({
        stage_code: item.stage_code,
        stage_label: SLA_STAGE_LABEL[item.stage_code] || item.stage_code,
        required_signers: Number(item.required_signers || 1),
        enabled: Number(item.enabled || 0) === 1,
        updated_at: item.updated_at,
      }))
    );
  })
);

app.get(
  '/api/device-flow/dual-sign/sessions',
  requireWriter,
  asyncHandler(async (req, res) => {
    const status = trimText(req.query.status).toUpperCase();
    const where = [];
    const params = [];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (!status) {
      where.push("status IN ('PENDING_SECOND', 'PROCESSING', 'EXPIRED', 'COMPLETED')");
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT id, token, job_id, action, from_stage, to_stage,
              first_signer_name, first_signer_role,
              second_signer_name, second_signer_role,
              status, expires_at, completed_at, created_at
       FROM device_dual_sign_sessions
       ${whereSql}
       ORDER BY id DESC
       LIMIT 500`,
      params
    );
    res.json(
      rows.map((item) => ({
        ...item,
        id: Number(item.id),
        job_id: Number(item.job_id),
      }))
    );
  })
);

app.post(
  '/api/device-flow/jobs/batch/stage',
  asyncHandler(async (req, res) => {
    const action = trimText(req.body?.action).toLowerCase();
    const actor = getActor(req);
    const toStage = ACTION_TO_STAGE[action];
    if (!toStage) throw appError('不支持的阶段动作');
    await ensureActionPermission({ action, actor, stageCode: toStage });
    const dualPolicy = await getDualSignPolicyForStage(toStage);
    if (dualPolicy.enabled && dualPolicy.requiredSigners >= 2 && (action === 'test' || action === 'approve')) {
      throw appError('当前阶段开启双人复核，批量推进不支持该动作', 409);
    }

    const scanParsed = parseScanInput(req.body?.scan_input);
    const inboundTrackingNo = trimText(req.body?.inbound_tracking_no) || trimText(scanParsed.fields.inbound_tracking_no);
    const outboundTrackingNo = trimText(req.body?.outbound_tracking_no) || trimText(scanParsed.fields.outbound_tracking_no);
    const remark = trimText(req.body?.remark);
    const stagePayload = buildStagePayload(action, req.body?.stage_payload);
    validateStagePayload(action, stagePayload, remark, {});
    const jobIds = parseBatchJobIds(req.body?.job_ids);

    const results = [];
    const failures = [];
    for (const jobId of jobIds) {
      try {
        const updated = await advanceStageJob({
          jobId,
          action,
          actor,
          remark,
          stagePayload,
          inboundTrackingNo,
          outboundTrackingNo,
          requestIp: req.ip,
        });
        results.push({
          job_id: Number(updated.id),
          job_no: updated.job_no,
          current_stage: updated.current_stage,
          status: updated.status,
        });
      } catch (err) {
        failures.push({
          job_id: jobId,
          error: err?.message || '批量推进失败',
        });
      }
    }

    res.json({
      action,
      total: jobIds.length,
      success_count: results.length,
      failure_count: failures.length,
      successes: results,
      failures,
    });
  })
);

app.post(
  '/api/device-flow/import/jobs.xlsx',
  requireWriter,
  importUpload.single('file'),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const file = req.file;
    if (!file) throw appError('请上传 Excel 文件');
    const dryRun = toBool(req.query?.dry_run) || toBool(req.body?.dry_run);
    const parsedRows = parseImportWorkbookRowsWithErrors(file.buffer);
    const precheck = await precheckImportRows(parsedRows.rows);
    const basicErrors = parsedRows.errors.map((message) => ({ code: 'BASIC_VALIDATION', message }));
    const mergedErrors = [...basicErrors, ...precheck.errors];
    if (dryRun) {
      return res.json({
        dry_run: true,
        total_rows: parsedRows.rows.length,
        precheck: {
          ...precheck,
          errors: mergedErrors,
          error_count: mergedErrors.length,
        },
      });
    }
    if (mergedErrors.length > 0) {
      throw appError(`导入校验失败：${mergedErrors.slice(0, 8).map((item) => item.message).join('；')}`);
    }

    const rows = parsedRows.rows.map((item) => {
      const next = { ...item };
      delete next._line_no;
      return next;
    });
    const successes = [];
    const failures = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      try {
        const created = await createJobWithActor({
          actor,
          jobData: row,
          requestIp: req.ip,
          source: 'batch-import',
        });
        successes.push({
          row_no: i + 2,
          job_id: Number(created.id),
          job_no: created.job_no,
          device_sn: created.device_sn,
        });
      } catch (err) {
        failures.push({
          row_no: i + 2,
          device_sn: row.device_sn,
          error: err?.message || '导入失败',
        });
      }
    }

    res.json({
      total_rows: rows.length,
      success_count: successes.length,
      failure_count: failures.length,
      precheck,
      successes,
      failures,
    });
  })
);

app.get(
  '/api/device-flow/jobs/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const job = await get('SELECT * FROM device_jobs WHERE id = ?', [id]);
    if (!job) throw appError('流转单不存在', 404);

    const [stageRecords, operationLogs, attachments] = await Promise.all([
      query('SELECT * FROM device_stage_records WHERE job_id = ? ORDER BY id DESC', [id]),
      query('SELECT * FROM device_operation_logs WHERE job_id = ? ORDER BY id DESC LIMIT 300', [id]),
      query('SELECT * FROM device_attachments WHERE job_id = ? AND deleted_at IS NULL ORDER BY id DESC', [id]),
    ]);

    res.json({
      ...job,
      stage_records: stageRecords.map((item) => ({
        ...item,
        stage_payload: parseJsonSafe(item.stage_payload),
      })),
      operation_logs: operationLogs.map(toPublicOperationLog),
      attachments: attachments.map(toPublicAttachment),
    });
  })
);

app.get(
  '/api/device-flow/jobs/:id/lock',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const row = await get(
      `SELECT job_id, holder_sub, holder_name, holder_role, acquired_at, expires_at
       FROM device_job_locks
       WHERE job_id = ?
         AND expires_at > NOW()
       LIMIT 1`,
      [id]
    );
    if (!row) return res.json({ locked: false });
    return res.json({
      locked: true,
      job_id: Number(row.job_id),
      holder_sub: row.holder_sub,
      holder_name: row.holder_name,
      holder_role: row.holder_role,
      acquired_at: row.acquired_at,
      expires_at: row.expires_at,
    });
  })
);

app.post(
  '/api/device-flow/jobs/:id/lock',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const holdSecondsRaw = Number(req.body?.hold_seconds || JOB_LOCK_TTL_SECONDS);
    const holdSeconds = Number.isInteger(holdSecondsRaw) ? Math.max(30, Math.min(holdSecondsRaw, 1800)) : JOB_LOCK_TTL_SECONDS;
    const actor = getActor(req);

    const result = await transaction(async (tx) => {
      const job = await tx.get('SELECT id FROM device_jobs WHERE id = ? FOR UPDATE', [id]);
      if (!job) throw appError('流转单不存在', 404);
      const lockRow = await tx.get(
        `SELECT id, holder_sub, holder_name, expires_at
         FROM device_job_locks
         WHERE job_id = ?
         FOR UPDATE`,
        [id]
      );
      if (lockRow && trimText(lockRow.expires_at)) {
        const expired = new Date(String(lockRow.expires_at).replace(' ', 'T')).getTime() <= Date.now();
        if (!expired && trimText(lockRow.holder_sub) !== trimText(actor.sub)) {
          throw appError(`该流转单正在由 ${trimText(lockRow.holder_name) || trimText(lockRow.holder_sub)} 处理`, 409);
        }
      }

      await tx.run(
        `INSERT INTO device_job_locks
         (job_id, holder_sub, holder_name, holder_role, acquired_at, expires_at)
         VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE
           holder_sub = VALUES(holder_sub),
           holder_name = VALUES(holder_name),
           holder_role = VALUES(holder_role),
           acquired_at = NOW(),
           expires_at = VALUES(expires_at)`,
        [id, actor.sub, actor.name, actor.role, holdSeconds]
      );
      const after = await tx.get(
        `SELECT job_id, holder_sub, holder_name, holder_role, acquired_at, expires_at
         FROM device_job_locks
         WHERE job_id = ?`,
        [id]
      );
      await writeOperationLogTx(tx, {
        jobId: id,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'LOCK_JOB',
        entity: 'device_job_lock',
        entityId: id,
        message: `占用流转单 ${id} ${holdSeconds} 秒`,
        beforeData: lockRow
          ? { holder_sub: lockRow.holder_sub, holder_name: lockRow.holder_name, expires_at: lockRow.expires_at }
          : null,
        afterData: { holder_sub: after.holder_sub, holder_name: after.holder_name, expires_at: after.expires_at },
        requestIp: req.ip,
      });
      return after;
    });

    res.json({
      locked: true,
      job_id: Number(result.job_id),
      holder_sub: result.holder_sub,
      holder_name: result.holder_name,
      holder_role: result.holder_role,
      acquired_at: result.acquired_at,
      expires_at: result.expires_at,
    });
  })
);

app.delete(
  '/api/device-flow/jobs/:id/lock',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const actor = getActor(req);
    const force = toBool(req.query?.force) || toBool(req.body?.force);
    await transaction(async (tx) => {
      const lockRow = await tx.get(
        `SELECT id, holder_sub, holder_name, expires_at
         FROM device_job_locks
         WHERE job_id = ?
         FOR UPDATE`,
        [id]
      );
      if (!lockRow) return;
      if (trimText(lockRow.holder_sub) !== trimText(actor.sub) && !force) {
        throw appError('仅占用者本人可释放锁，管理员可使用 force=true 强制释放', 403);
      }
      await tx.run('DELETE FROM device_job_locks WHERE job_id = ?', [id]);
      await writeOperationLogTx(tx, {
        jobId: id,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UNLOCK_JOB',
        entity: 'device_job_lock',
        entityId: id,
        message: force ? `强制释放流转单锁（原占用者：${trimText(lockRow.holder_name) || trimText(lockRow.holder_sub)}）` : '释放流转单锁',
        beforeData: {
          holder_sub: lockRow.holder_sub,
          holder_name: lockRow.holder_name,
          expires_at: lockRow.expires_at,
        },
        afterData: { released: true, force },
        requestIp: req.ip,
      });
    });
    res.json({ job_id: id, unlocked: true });
  })
);

app.get(
  '/api/device-flow/jobs/:id/attachments',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const existed = await get('SELECT id FROM device_jobs WHERE id = ?', [id]);
    if (!existed) throw appError('流转单不存在', 404);

    const rows = await query('SELECT * FROM device_attachments WHERE job_id = ? AND deleted_at IS NULL ORDER BY id DESC', [id]);
    res.json(rows.map(toPublicAttachment));
  })
);

app.get(
  '/api/device-flow/attachments/:id/download',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const row = await get('SELECT * FROM device_attachments WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) throw appError('附件不存在', 404);

    const resolved = path.resolve(row.file_path);
    if (!resolved.startsWith(UPLOAD_ROOT)) throw appError('附件路径非法', 400);
    if (!fs.existsSync(resolved)) throw appError('附件文件不存在', 404);

    res.download(resolved, row.file_name || row.stored_name || `attachment-${id}`);
  })
);

app.delete(
  '/api/device-flow/attachments/:id',
  requireAttachmentDeleter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const actor = getActor(req);
    const deleted = await transaction(async (tx) => {
      const row = await tx.get('SELECT * FROM device_attachments WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id]);
      if (!row) throw appError('附件不存在', 404);

      const stageCode = trimText(row.stage_code).toUpperCase();
      if (stageCode === 'HARDWARE_CHECKED' || stageCode === 'TESTED') {
        const countRow = await tx.get(
          'SELECT COUNT(*) AS total FROM device_attachments WHERE job_id = ? AND stage_code = ? AND deleted_at IS NULL',
          [row.job_id, stageCode]
        );
        if (Number(countRow?.total || 0) <= 1) {
          throw appError('该阶段至少保留1个留证附件，无法删除最后一个附件', 409);
        }
      }

      await tx.run('DELETE FROM device_attachments WHERE id = ?', [id]);

      await writeOperationLogTx(tx, {
        jobId: Number(row.job_id),
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'DELETE_ATTACHMENT',
        entity: 'device_attachment',
        entityId: id,
        message: `删除附件 ${row.file_name}`,
        beforeData: {
          attachment_id: id,
          stage_code: row.stage_code,
          file_name: row.file_name,
          file_size: Number(row.file_size || 0),
        },
        afterData: { deleted: true },
        requestIp: req.ip,
      });

      return row;
    });

    const resolved = path.resolve(deleted.file_path || '');
    if (resolved.startsWith(UPLOAD_ROOT) && fs.existsSync(resolved)) {
      try {
        fs.unlinkSync(resolved);
      } catch (err) {
        console.warn('[device-flow] attachment file delete failed:', err?.message || err);
      }
    }

    res.json({ id, deleted: true });
  })
);

app.post(
  '/api/device-flow/jobs/:id/attachments',
  requireAttachmentUploader,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const jobId = Number(req.params.id || 0);
    if (!Number.isInteger(jobId) || jobId <= 0) throw appError('ID非法');

    const actor = getActor(req);
    const stageCode = trimText(req.body?.stage_code).toUpperCase();
    const stageRecordIdRaw = Number(req.body?.stage_record_id || 0);
    const stageRecordId = Number.isInteger(stageRecordIdRaw) && stageRecordIdRaw > 0 ? stageRecordIdRaw : null;
    const remark = trimText(req.body?.remark);
    const file = req.file;

    if (!file) throw appError('请上传文件');

    const saved = await transaction(async (tx) => {
      const job = await tx.get('SELECT id, current_stage FROM device_jobs WHERE id = ? FOR UPDATE', [jobId]);
      if (!job) throw appError('流转单不存在', 404);

      let stageCodeFinal = stageCode;
      if (stageCodeFinal && !STAGES.includes(stageCodeFinal)) throw appError('stage_code 非法');
      if (!stageCodeFinal) stageCodeFinal = String(job.current_stage || '');

      if (stageRecordId) {
        const stageRecord = await tx.get('SELECT id FROM device_stage_records WHERE id = ? AND job_id = ?', [stageRecordId, jobId]);
        if (!stageRecord) throw appError('阶段记录不存在或不匹配');
      }

      const result = await tx.run(
        `INSERT INTO device_attachments
         (job_id, stage_record_id, stage_code, file_name, stored_name, file_path, mime_type, file_size, remark, uploaded_by_sub, uploaded_by_name, uploaded_by_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          jobId,
          stageRecordId,
          stageCodeFinal,
          trimText(file.originalname) || file.filename,
          file.filename,
          path.resolve(file.path),
          trimText(file.mimetype),
          Number(file.size || 0),
          remark || null,
          actor.sub,
          actor.name,
          actor.role,
        ]
      );

      const attachmentId = Number(result.insertId || 0);
      const row = await tx.get('SELECT * FROM device_attachments WHERE id = ?', [attachmentId]);

      await writeOperationLogTx(tx, {
        jobId,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UPLOAD_ATTACHMENT',
        entity: 'device_attachment',
        entityId: attachmentId,
        message: `上传附件 ${row.file_name}`,
        beforeData: null,
        afterData: {
          attachment_id: attachmentId,
          stage_code: row.stage_code,
          file_name: row.file_name,
          file_size: Number(row.file_size || 0),
        },
        requestIp: req.ip,
      });

      return row;
    });

    res.status(201).json(toPublicAttachment(saved));
  })
);

app.post(
  '/api/device-flow/jobs/:id/stages/:action',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const action = trimText(req.params.action).toLowerCase();
    const toStage = ACTION_TO_STAGE[action];
    if (!toStage) throw appError('不支持的阶段动作');
    const actor = getActor(req);
    await ensureActionPermission({ action, actor, stageCode: toStage });

    const expectedVersion = parseExpectedVersion(req);
    const scanParsed = parseScanInput(req.body?.scan_input);
    const inboundTrackingNo = trimText(req.body?.inbound_tracking_no) || trimText(scanParsed.fields.inbound_tracking_no);
    const outboundTrackingNo = trimText(req.body?.outbound_tracking_no) || trimText(scanParsed.fields.outbound_tracking_no);
    const remark = trimText(req.body?.remark);
    const stagePayload = buildStagePayload(action, req.body?.stage_payload);
    const hardwareCtx = action === 'hardware-check' ? await getHardwareCheckContextForJobId(id) : null;
    validateStagePayload(action, stagePayload, remark, {
      checkItems: hardwareCtx?.checkItems || [],
    });

    const dualPolicy = await getDualSignPolicyForStage(toStage);
    const needDualSign = dualPolicy.enabled && dualPolicy.requiredSigners >= 2 && (action === 'test' || action === 'approve');
    if (needDualSign) {
      const dualSignToken = trimText(req.body?.dual_sign_token);
      const signatureInput = trimText(req.body?.signature);
      if (!signatureInput) throw appError('双人复核阶段必须提供电子签名', 400);

      if (!dualSignToken) {
        const created = await transaction(async (tx) => {
          const current = await tx.get('SELECT id, current_stage, status, row_version FROM device_jobs WHERE id = ? FOR UPDATE', [id]);
          if (!current) throw appError('流转单不存在', 404);
          if (String(current.status || '').toUpperCase() === 'VOIDED') throw appError('流转单已作废，不能发起双签', 409);
          if (expectedVersion && Number(current.row_version || 0) !== Number(expectedVersion)) {
            throw appError(`版本冲突：当前版本 ${Number(current.row_version || 0)}，请刷新后重试`, 409);
          }
          ensureForwardTransition(current.current_stage, toStage);
          await assertActiveJobLock(tx, id, actor);

          const existed = await tx.get(
            `SELECT id
             FROM device_dual_sign_sessions
             WHERE job_id = ? AND action = ? AND status = 'PENDING_SECOND' AND expires_at > NOW()
             ORDER BY id DESC
             LIMIT 1`,
            [id, action.toUpperCase()]
          );
          if (existed) throw appError('已存在待二次复核的会签请求，请直接使用 dual_sign_token 完成复核', 409);

          const token = crypto.randomUUID().replace(/-/g, '');
          const signHash = hashElectronicSignature({
            signature: signatureInput,
            actorSub: actor.sub,
            action,
            jobId: id,
            token,
          });

          const insertRes = await tx.run(
            `INSERT INTO device_dual_sign_sessions
             (token, job_id, action, from_stage, to_stage, stage_payload, remark, request_ip, expected_version,
              first_signer_sub, first_signer_name, first_signer_role, first_signature, status, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SECOND', DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
            [
              token,
              id,
              action.toUpperCase(),
              current.current_stage,
              toStage,
              stagePayload ? JSON.stringify(stagePayload) : null,
              remark || null,
              req.ip,
              Number(current.row_version || 0),
              actor.sub,
              actor.name,
              actor.role,
              signHash,
              DUAL_SIGN_TOKEN_TTL_MINUTES,
            ]
          );

          await writeOperationLogTx(tx, {
            jobId: id,
            userSub: actor.sub,
            username: actor.name,
            userRole: actor.role,
            action: `DUAL_SIGN_${action.toUpperCase()}_INIT`,
            entity: 'dual_sign_session',
            entityId: Number(insertRes.insertId || 0),
            message: `${toStage} 双人复核已发起，待第二人签名`,
            beforeData: null,
            afterData: {
              dual_sign_token: token,
              action,
              to_stage: toStage,
              expires_in_minutes: DUAL_SIGN_TOKEN_TTL_MINUTES,
            },
            requestIp: req.ip,
          });

          return {
            dual_sign_token: token,
            expected_version: Number(current.row_version || 0),
            expires_in_minutes: DUAL_SIGN_TOKEN_TTL_MINUTES,
          };
        });

        return res.status(202).json({
          pending_dual_sign: true,
          message: '已记录首签，请由第二位人员签名后完成阶段推进',
          ...created,
        });
      }

      const sessionData = await transaction(async (tx) => {
        const sessionRow = await tx.get(
          `SELECT *
           FROM device_dual_sign_sessions
           WHERE token = ? AND job_id = ?
           FOR UPDATE`,
          [dualSignToken, id]
        );
        if (!sessionRow) throw appError('dual_sign_token 无效', 404);
        if (String(sessionRow.status || '').toUpperCase() !== 'PENDING_SECOND') throw appError('该会签已结束', 409);
        const expText = trimText(sessionRow.expires_at);
        if (expText && new Date(expText.replace(' ', 'T')).getTime() < Date.now()) {
          await tx.run(`UPDATE device_dual_sign_sessions SET status = 'EXPIRED' WHERE id = ?`, [sessionRow.id]);
          throw appError('会签令牌已过期，请重新发起', 409);
        }
        if (trimText(sessionRow.first_signer_sub) === trimText(actor.sub)) {
          throw appError('双人复核必须由不同人员完成', 409);
        }

        await tx.run(
          `UPDATE device_dual_sign_sessions
           SET status = 'PROCESSING', updated_at = NOW()
           WHERE id = ?`,
          [sessionRow.id]
        );

        return {
          id: Number(sessionRow.id),
          expectedVersion: Number(sessionRow.expected_version || 0),
          remark: trimText(sessionRow.remark),
          stagePayload: parseJsonSafe(sessionRow.stage_payload),
        };
      });

      let updated;
      try {
        updated = await advanceStageJob({
          jobId: id,
          action,
          actor,
          remark: sessionData.remark || remark,
          stagePayload: sessionData.stagePayload || stagePayload,
          inboundTrackingNo,
          outboundTrackingNo,
          expectedVersion: sessionData.expectedVersion,
          requestIp: req.ip,
        });
      } catch (err) {
        await query(
          `UPDATE device_dual_sign_sessions
           SET status = 'PENDING_SECOND', updated_at = NOW()
           WHERE id = ? AND status = 'PROCESSING'`,
          [sessionData.id]
        );
        throw err;
      }

      await transaction(async (tx) => {
        const secondSignHash = hashElectronicSignature({
          signature: signatureInput,
          actorSub: actor.sub,
          action,
          jobId: id,
          token: dualSignToken,
        });

        await tx.run(
          `UPDATE device_dual_sign_sessions
           SET second_signer_sub = ?, second_signer_name = ?, second_signer_role = ?,
               second_signature = ?, status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [actor.sub, actor.name, actor.role, secondSignHash, sessionData.id]
        );

        await writeOperationLogTx(tx, {
          jobId: id,
          userSub: actor.sub,
          username: actor.name,
          userRole: actor.role,
          action: `DUAL_SIGN_${action.toUpperCase()}_COMPLETE`,
          entity: 'dual_sign_session',
          entityId: sessionData.id,
          message: `${toStage} 双人复核完成`,
          beforeData: { status: 'PROCESSING' },
          afterData: { status: 'COMPLETED', dual_sign_token: dualSignToken },
          requestIp: req.ip,
        });
      });

      return res.json({
        ...updated,
        dual_sign_completed: true,
        dual_sign_session_id: sessionData.id,
      });
    }

    const updated = await advanceStageJob({
      jobId: id,
      action,
      actor,
      remark,
      stagePayload,
      inboundTrackingNo,
      outboundTrackingNo,
      expectedVersion,
      requestIp: req.ip,
    });

    res.json(updated);
  })
);

app.post(
  '/api/device-flow/jobs/:id/rework',
  asyncHandler(async (req, res) => {
    if (!REWORK_ALLOWED_ROLES.has(normalizeRole(req.user?.role))) {
      throw appError('当前角色无权限执行退回', 403);
    }

    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const targetStage = trimText(req.body?.target_stage).toUpperCase();
    const reason = trimText(req.body?.reason);
    const remark = trimText(req.body?.remark);
    const expectedVersion = parseExpectedVersion(req);
    if (!targetStage || !STAGES.includes(targetStage)) throw appError('退回目标阶段非法');
    if (!reason) throw appError('退回原因不能为空');

    const actor = getActor(req);

    const updated = await transaction(async (tx) => {
      const current = await tx.get('SELECT * FROM device_jobs WHERE id = ? FOR UPDATE', [id]);
      if (!current) throw appError('流转单不存在', 404);
      if (String(current.status || '').toUpperCase() === 'VOIDED') throw appError('流转单已作废，不能退回', 409);
      if (expectedVersion && Number(current.row_version || 0) !== Number(expectedVersion)) {
        throw appError(`版本冲突：当前版本 ${Number(current.row_version || 0)}，请刷新后重试`, 409);
      }
      await assertActiveJobLock(tx, id, actor);
      ensureReworkTransition(current.current_stage, targetStage);

      await tx.run('UPDATE device_jobs SET current_stage = ?, status = ?, remark = ?, row_version = row_version + 1 WHERE id = ?', [
        targetStage,
        'OPEN',
        remark || current.remark || '',
        id,
      ]);

      const stageRecordId = await appendStageRecordTx(tx, {
        jobId: id,
        action: 'REWORK',
        fromStage: current.current_stage,
        toStage: targetStage,
        result: 'REWORK',
        remark,
        reworkReason: reason,
        operatorSub: actor.sub,
        operatorName: actor.name,
        operatorRole: actor.role,
      });

      const after = await tx.get('SELECT * FROM device_jobs WHERE id = ?', [id]);
      await writeOperationLogTx(tx, {
        jobId: id,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'REWORK',
        entity: 'device_job',
        entityId: id,
        message: `流程退回 ${current.current_stage} -> ${targetStage}`,
        beforeData: { current_stage: current.current_stage, status: current.status },
        afterData: { current_stage: after.current_stage, status: after.status, reason, stage_record_id: stageRecordId },
        requestIp: req.ip,
      });

      await enqueueCallbackEventTx(tx, {
        eventType: 'stage.reworked',
        jobId: id,
        payload: {
          job_id: Number(id),
          from_stage: current.current_stage,
          to_stage: targetStage,
          reason,
          actor: {
            sub: actor.sub,
            name: actor.name,
            role: actor.role,
          },
        },
      });

      return after;
    });

    res.json(updated);
  })
);

app.get(
  '/api/device-flow/jobs/:id/change-requests',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const rows = await query(
      `SELECT *
       FROM device_change_requests
       WHERE job_id = ?
       ORDER BY id DESC
       LIMIT 500`,
      [id]
    );
    res.json(
      rows.map((item) => ({
        ...item,
        request_payload: parseJsonSafe(item.request_payload),
      }))
    );
  })
);

app.post(
  '/api/device-flow/jobs/:id/change-requests',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const actor = getActor(req);
    const requestType = trimText(req.body?.request_type).toUpperCase();
    const requestReason = trimText(req.body?.request_reason);
    if (!CHANGE_REQUEST_TYPES.has(requestType)) throw appError('request_type 非法');
    if (!requestReason) throw appError('request_reason 不能为空');

    let requestPayload = {};
    if (requestType === 'CORRECT') {
      requestPayload = parseCorrectionPayload(req.body?.request_payload);
    } else if (requestType === 'WITHDRAW') {
      const targetStage = trimText(req.body?.request_payload?.target_stage).toUpperCase();
      if (!targetStage || !STAGES.includes(targetStage)) throw appError('WITHDRAW 申请必须提供合法 target_stage');
      requestPayload = {
        target_stage: targetStage,
        remark: trimText(req.body?.request_payload?.remark),
      };
    } else if (requestType === 'CANCEL') {
      requestPayload = {
        remark: trimText(req.body?.request_payload?.remark),
      };
    }

    const result = await transaction(async (tx) => {
      const job = await tx.get('SELECT id, job_no, current_stage, status FROM device_jobs WHERE id = ? FOR UPDATE', [id]);
      if (!job) throw appError('流转单不存在', 404);
      if (String(job.status || '').toUpperCase() === 'VOIDED') throw appError('流转单已作废，不能再发起审批', 409);

      const pending = await tx.get(
        `SELECT id
         FROM device_change_requests
         WHERE job_id = ? AND request_status = 'PENDING'
         ORDER BY id DESC
         LIMIT 1`,
        [id]
      );
      if (pending) throw appError('当前流转单已有待审批变更单，请先处理', 409);

      const insertRes = await tx.run(
        `INSERT INTO device_change_requests
         (job_id, request_type, request_status, request_reason, request_payload,
          requested_by_sub, requested_by_name, requested_by_role, requested_by_department)
         VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
        [id, requestType, requestReason, JSON.stringify(requestPayload || {}), actor.sub, actor.name, actor.role, actor.department]
      );
      const requestId = Number(insertRes.insertId || 0);
      const created = await tx.get('SELECT * FROM device_change_requests WHERE id = ?', [requestId]);

      await writeOperationLogTx(tx, {
        jobId: id,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: `CHANGE_REQUEST_${requestType}`,
        entity: 'device_change_request',
        entityId: requestId,
        message: `发起${requestType}申请`,
        beforeData: null,
        afterData: {
          request_type: requestType,
          request_reason: requestReason,
          request_payload: requestPayload,
          request_status: 'PENDING',
        },
        requestIp: req.ip,
      });

      await enqueueCallbackEventTx(tx, {
        eventType: 'change_request.created',
        jobId: id,
        payload: {
          change_request_id: requestId,
          request_type: requestType,
          request_reason: requestReason,
          request_payload: requestPayload,
          requested_by: {
            sub: actor.sub,
            name: actor.name,
            role: actor.role,
          },
        },
      });

      return created;
    });

    res.status(201).json({
      ...result,
      request_payload: parseJsonSafe(result.request_payload),
    });
  })
);

app.post(
  '/api/device-flow/change-requests/:id/withdraw',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const actor = getActor(req);

    const row = await transaction(async (tx) => {
      const current = await tx.get('SELECT * FROM device_change_requests WHERE id = ? FOR UPDATE', [id]);
      if (!current) throw appError('审批单不存在', 404);
      if (String(current.request_status || '').toUpperCase() !== CHANGE_REQUEST_STATUS.PENDING) {
        throw appError('仅待审批状态可撤回', 409);
      }
      const ownerSub = trimText(current.requested_by_sub);
      if (ownerSub !== trimText(actor.sub) && !CHANGE_REVIEW_ROLES.has(normalizeRole(actor.role))) {
        throw appError('仅申请人或管理员可撤回审批单', 403);
      }
      await tx.run(
        `UPDATE device_change_requests
         SET request_status = 'WITHDRAWN',
             withdrawn_by_sub = ?,
             withdrawn_by_name = ?,
             withdrawn_by_role = ?,
             withdrawn_by_department = ?,
             withdrawn_at = NOW()
         WHERE id = ?`,
        [actor.sub, actor.name, actor.role, actor.department, id]
      );
      const after = await tx.get('SELECT * FROM device_change_requests WHERE id = ?', [id]);
      await writeOperationLogTx(tx, {
        jobId: Number(current.job_id),
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'CHANGE_REQUEST_WITHDRAW',
        entity: 'device_change_request',
        entityId: id,
        message: '撤回变更审批单',
        beforeData: { request_status: current.request_status },
        afterData: { request_status: 'WITHDRAWN' },
        requestIp: req.ip,
      });
      return after;
    });
    res.json({
      ...row,
      request_payload: parseJsonSafe(row.request_payload),
    });
  })
);

app.post(
  '/api/device-flow/change-requests/:id/reject',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const actor = getActor(req);
    const rejectComment = trimText(req.body?.reject_comment);
    if (!CHANGE_REVIEW_ROLES.has(normalizeRole(actor.role))) throw appError('当前角色无权限驳回审批单', 403);

    const row = await transaction(async (tx) => {
      const current = await tx.get('SELECT * FROM device_change_requests WHERE id = ? FOR UPDATE', [id]);
      if (!current) throw appError('审批单不存在', 404);
      if (String(current.request_status || '').toUpperCase() !== CHANGE_REQUEST_STATUS.PENDING) {
        throw appError('仅待审批状态可驳回', 409);
      }

      await tx.run(
        `UPDATE device_change_requests
         SET request_status = 'REJECTED',
             rejected_by_sub = ?,
             rejected_by_name = ?,
             rejected_by_role = ?,
             rejected_by_department = ?,
             rejected_comment = ?,
             rejected_at = NOW()
         WHERE id = ?`,
        [actor.sub, actor.name, actor.role, actor.department, rejectComment || null, id]
      );
      const after = await tx.get('SELECT * FROM device_change_requests WHERE id = ?', [id]);
      await writeOperationLogTx(tx, {
        jobId: Number(current.job_id),
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'CHANGE_REQUEST_REJECT',
        entity: 'device_change_request',
        entityId: id,
        message: '驳回变更审批单',
        beforeData: { request_status: current.request_status },
        afterData: { request_status: 'REJECTED', reject_comment: rejectComment },
        requestIp: req.ip,
      });
      return after;
    });
    res.json({
      ...row,
      request_payload: parseJsonSafe(row.request_payload),
    });
  })
);

app.post(
  '/api/device-flow/change-requests/:id/approve',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const actor = getActor(req);
    const approveComment = trimText(req.body?.approve_comment);
    if (!CHANGE_REVIEW_ROLES.has(normalizeRole(actor.role))) throw appError('当前角色无权限审批', 403);

    const result = await transaction(async (tx) => {
      const requestRow = await tx.get('SELECT * FROM device_change_requests WHERE id = ? FOR UPDATE', [id]);
      if (!requestRow) throw appError('审批单不存在', 404);
      if (String(requestRow.request_status || '').toUpperCase() !== CHANGE_REQUEST_STATUS.PENDING) {
        throw appError('仅待审批状态可通过', 409);
      }
      const jobId = Number(requestRow.job_id || 0);
      const current = await tx.get('SELECT * FROM device_jobs WHERE id = ? FOR UPDATE', [jobId]);
      if (!current) throw appError('流转单不存在', 404);

      const requestType = trimText(requestRow.request_type).toUpperCase();
      const payload = parseJsonSafe(requestRow.request_payload) || {};
      let stageRecordId = null;

      if (requestType === 'CANCEL') {
        await tx.run(
          `UPDATE device_jobs
           SET status = 'VOIDED',
               voided_by_sub = ?,
               voided_by_name = ?,
               voided_by_role = ?,
               voided_at = NOW(),
               remark = ?,
               row_version = row_version + 1
           WHERE id = ?`,
          [actor.sub, actor.name, actor.role, trimText(payload.remark) || current.remark || '', jobId]
        );
        stageRecordId = await appendStageRecordTx(tx, {
          jobId,
          action: 'CANCEL',
          fromStage: current.current_stage,
          toStage: current.current_stage,
          result: 'VOID',
          remark: trimText(payload.remark) || trimText(requestRow.request_reason),
          operatorSub: actor.sub,
          operatorName: actor.name,
          operatorRole: actor.role,
        });
      } else if (requestType === 'WITHDRAW') {
        const targetStage = trimText(payload.target_stage).toUpperCase();
        if (!targetStage || !STAGES.includes(targetStage)) throw appError('WITHDRAW 目标阶段非法');
        ensureReworkTransition(current.current_stage, targetStage);
        await tx.run(
          `UPDATE device_jobs
           SET current_stage = ?, status = 'OPEN', remark = ?, row_version = row_version + 1
           WHERE id = ?`,
          [targetStage, trimText(payload.remark) || current.remark || '', jobId]
        );
        stageRecordId = await appendStageRecordTx(tx, {
          jobId,
          action: 'WITHDRAW_APPROVED',
          fromStage: current.current_stage,
          toStage: targetStage,
          result: 'WITHDRAW',
          remark: trimText(payload.remark) || trimText(requestRow.request_reason),
          operatorSub: actor.sub,
          operatorName: actor.name,
          operatorRole: actor.role,
        });
      } else if (requestType === 'CORRECT') {
        const corrected = parseCorrectionPayload(payload);
        const assignments = [];
        const params = [];
        for (const [key, value] of Object.entries(corrected)) {
          assignments.push(`${key} = ?`);
          params.push(value);
        }
        assignments.push('row_version = row_version + 1');
        params.push(jobId);
        await tx.run(`UPDATE device_jobs SET ${assignments.join(', ')} WHERE id = ?`, params);
      } else {
        throw appError(`不支持的审批类型: ${requestType}`);
      }

      await tx.run(
        `UPDATE device_change_requests
         SET request_status = 'APPROVED',
             approved_by_sub = ?,
             approved_by_name = ?,
             approved_by_role = ?,
             approved_by_department = ?,
             approved_at = NOW(),
             approve_comment = ?,
             applied_stage_record_id = ?
         WHERE id = ?`,
        [actor.sub, actor.name, actor.role, actor.department, approveComment || null, stageRecordId, id]
      );

      const after = await tx.get('SELECT * FROM device_jobs WHERE id = ?', [jobId]);
      const approvedRow = await tx.get('SELECT * FROM device_change_requests WHERE id = ?', [id]);

      await writeOperationLogTx(tx, {
        jobId,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'CHANGE_REQUEST_APPROVE',
        entity: 'device_change_request',
        entityId: id,
        message: `审批通过：${requestType}`,
        beforeData: {
          request_status: requestRow.request_status,
          current_stage: current.current_stage,
          status: current.status,
        },
        afterData: {
          request_status: 'APPROVED',
          current_stage: after.current_stage,
          status: after.status,
          applied_stage_record_id: stageRecordId,
        },
        requestIp: req.ip,
      });

      await enqueueCallbackEventTx(tx, {
        eventType: 'change_request.approved',
        jobId,
        payload: {
          change_request_id: id,
          request_type: requestType,
          approve_comment: approveComment,
          request_payload: payload,
          job: {
            id: Number(after.id),
            status: after.status,
            current_stage: after.current_stage,
            row_version: Number(after.row_version || 0),
          },
        },
      });

      return {
        request: approvedRow,
        job: after,
      };
    });

    res.json({
      request: {
        ...result.request,
        request_payload: parseJsonSafe(result.request.request_payload),
      },
      job: result.job,
    });
  })
);

app.get(
  '/api/device-flow/templates/jobs-import.xlsx',
  asyncHandler(async (_req, res) => {
    const buffer = buildImportTemplateBuffer();
    const filename = 'device-flow-import-template.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

app.get(
  '/api/device-flow/reports/jobs.xlsx',
  asyncHandler(async (req, res) => {
    const keyword = trimText(req.query.keyword);
    const customer = trimText(req.query.customer);
    const stage = parseStageFilter(req.query.stage, 'stage');
    const where = [];
    const params = [];

    if (keyword) {
      where.push(
        '(j.job_no LIKE ? OR j.device_sn LIKE ? OR j.customer_name LIKE ? OR j.sales_order_no LIKE ? OR j.inbound_tracking_no LIKE ? OR j.outbound_tracking_no LIKE ?)'
      );
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (customer) {
      where.push('j.customer_name LIKE ?');
      params.push(`%${customer}%`);
    }
    if (stage) {
      where.push('j.current_stage = ?');
      params.push(stage);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT j.id,
              j.job_no,
              j.device_sn,
              j.device_model,
              j.customer_name,
              j.sales_order_no,
              j.inbound_tracking_no,
              j.outbound_tracking_no,
              j.current_stage,
              j.status,
              j.updated_at,
              j.created_at
       FROM device_jobs j
       ${whereSql}
       ORDER BY j.id DESC
       LIMIT 20000`,
      params
    );

    const buffer = buildJobsWorkbookBuffer(rows);
    const filename = `device-flow-jobs-${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

app.get(
  '/api/device-flow/reports/dashboard.csv',
  asyncHandler(async (req, res) => {
    const overdueDaysRaw = Number(req.query.overdue_days || DASHBOARD_OVERDUE_DAYS);
    const overdueDays =
      Number.isInteger(overdueDaysRaw) && overdueDaysRaw > 0 ? Math.min(overdueDaysRaw, 30) : DASHBOARD_OVERDUE_DAYS;
    const stage = parseStageFilter(req.query.stage, 'stage');
    const customer = trimText(req.query.customer);
    const { whereSql, params } = buildDashboardJobWhere({ stage, customer });

    const rows = await query(
      `SELECT j.id,
              j.job_no,
              j.device_sn,
              j.customer_name,
              j.current_stage,
              j.status,
              j.inbound_tracking_no,
              j.outbound_tracking_no,
              j.created_at,
              j.updated_at,
              j.shipped_at,
              TIMESTAMPDIFF(DAY, j.updated_at, NOW()) AS overdue_days
       FROM device_jobs j
       ${whereSql}
       ORDER BY j.updated_at DESC
       LIMIT 20000`,
      params
    );

    const header = [
      '流转单ID',
      '流转单号',
      '设备SN',
      '设备型号',
      '客户',
      '当前阶段',
      '状态',
      '来件快递单号',
      '发货快递单号',
      '创建时间',
      '最后更新时间',
      '发货时间',
      '超时天数',
      '是否超时',
    ];
    const lines = [header.map(escapeCsvCell).join(',')];
    rows.forEach((row) => {
      const overdue = Number(row.overdue_days || 0);
      lines.push(
        [
          row.id,
          row.job_no,
          row.device_sn,
          row.device_model,
          row.customer_name,
          row.current_stage,
          row.status,
          row.inbound_tracking_no,
          row.outbound_tracking_no,
          row.created_at,
          row.updated_at,
          row.shipped_at,
          overdue,
          overdue >= overdueDays ? '是' : '否',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });

    const filename = `device-flow-dashboard-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${lines.join('\n')}`);
  })
);

app.get(
  '/api/device-flow/reports/audit.csv',
  requireAuditReader,
  asyncHandler(async (req, res) => {
    const from = parseDateOnly(req.query.from, 'from');
    const to = parseDateOnly(req.query.to, 'to');
    const action = trimText(req.query.action).toUpperCase();
    const username = trimText(req.query.username);
    const keyword = trimText(req.query.keyword);
    if (from && to && from > to) throw appError('from 不能晚于 to');

    const where = [];
    const params = [];
    appendDateRangeWhere({
      from,
      to,
      column: 'l.created_at',
      where,
      params,
    });
    if (action) {
      where.push('l.action = ?');
      params.push(action);
    }
    if (username) {
      where.push('l.username LIKE ?');
      params.push(`%${username}%`);
    }
    if (keyword) {
      where.push(
        '(l.action LIKE ? OR l.message LIKE ? OR j.job_no LIKE ? OR j.device_sn LIKE ? OR j.customer_name LIKE ?)'
      );
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT l.id,
              l.created_at,
              l.username,
              l.user_role,
              l.action,
              l.message,
              l.request_ip,
              j.job_no,
              j.device_sn,
              j.customer_name,
              j.current_stage
       FROM device_operation_logs l
       LEFT JOIN device_jobs j ON j.id = l.job_id
       ${whereSql}
       ORDER BY l.id DESC
       LIMIT 10000`,
      params
    );

    const header = ['日志ID', '操作时间', '操作人', '角色', '动作', '说明', '来源IP', '流转单号', '设备SN', '客户', '当前阶段'];
    const lines = [header.map(escapeCsvCell).join(',')];
    rows.forEach((row) => {
      lines.push(
        [
          row.id,
          row.created_at,
          row.username,
          row.user_role,
          row.action,
          row.message,
          row.request_ip,
          row.job_no,
          row.device_sn,
          row.customer_name,
          row.current_stage,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });

    const filename = `device-flow-audit-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${lines.join('\n')}`);
  })
);

app.get(
  '/api/device-flow/reports/cycle',
  requireWriter,
  asyncHandler(async (req, res) => {
    const from = parseDateOnly(req.query.from, 'from');
    const to = parseDateOnly(req.query.to, 'to');
    if (from && to && from > to) throw appError('from 不能晚于 to');
    const report = await buildCycleReport({
      fromDate: from,
      toDate: to,
    });
    res.json(report);
  })
);

app.get(
  '/api/device-flow/ops/dashboard',
  requireWriter,
  asyncHandler(async (_req, res) => {
    const data = await getOpsDashboard();
    res.json(data);
  })
);

app.get(
  '/api/device-flow/retention/policies',
  requireWriter,
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT id, target_type, hot_days, cold_days, delete_days, enabled, updated_at
       FROM device_retention_policies
       ORDER BY id ASC`
    );
    res.json(
      rows.map((item) => ({
        id: Number(item.id),
        target_type: item.target_type,
        hot_days: Number(item.hot_days || 0),
        cold_days: Number(item.cold_days || 0),
        delete_days: Number(item.delete_days || 0),
        enabled: Number(item.enabled || 0) === 1,
        updated_at: item.updated_at,
      }))
    );
  })
);

app.put(
  '/api/device-flow/retention/policies',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    if (!CHANGE_REVIEW_ROLES.has(normalizeRole(actor.role))) throw appError('仅管理员可修改保留策略', 403);
    const rows = Array.isArray(req.body?.policies) ? req.body.policies : [];
    if (rows.length === 0) throw appError('policies 不能为空');
    await transaction(async (tx) => {
      for (const item of rows) {
        const targetType = trimText(item?.target_type).toUpperCase();
        if (!targetType) throw appError('target_type 不能为空');
        const hotDaysRaw = Number(item?.hot_days || 180);
        const coldDaysRaw = Number(item?.cold_days || Math.max(hotDaysRaw, 365));
        const deleteDaysRaw = Number(item?.delete_days || Math.max(coldDaysRaw, 730));
        if (!Number.isInteger(hotDaysRaw) || hotDaysRaw < 1) throw appError('hot_days 必须为正整数');
        if (!Number.isInteger(coldDaysRaw) || coldDaysRaw < hotDaysRaw) throw appError('cold_days 必须大于等于 hot_days');
        if (!Number.isInteger(deleteDaysRaw) || deleteDaysRaw < coldDaysRaw) throw appError('delete_days 必须大于等于 cold_days');
        const enabled = item?.enabled === undefined ? 1 : item?.enabled ? 1 : 0;
        await tx.run(
          `INSERT INTO device_retention_policies
           (target_type, hot_days, cold_days, delete_days, enabled)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             hot_days = VALUES(hot_days),
             cold_days = VALUES(cold_days),
             delete_days = VALUES(delete_days),
             enabled = VALUES(enabled)`,
          [targetType, hotDaysRaw, coldDaysRaw, deleteDaysRaw, enabled]
        );
      }

      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UPDATE_RETENTION_POLICIES',
        entity: 'device_retention_policies',
        entityId: null,
        message: `更新保留策略 ${rows.length} 条`,
        beforeData: null,
        afterData: { count: rows.length },
        requestIp: req.ip,
      });
    });

    const result = await query(
      `SELECT id, target_type, hot_days, cold_days, delete_days, enabled, updated_at
       FROM device_retention_policies
       ORDER BY id ASC`
    );
    res.json(
      result.map((item) => ({
        id: Number(item.id),
        target_type: item.target_type,
        hot_days: Number(item.hot_days || 0),
        cold_days: Number(item.cold_days || 0),
        delete_days: Number(item.delete_days || 0),
        enabled: Number(item.enabled || 0) === 1,
        updated_at: item.updated_at,
      }))
    );
  })
);

app.post(
  '/api/device-flow/retention/run',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const result = await runRetentionForAttachments({
      actor,
      requestIp: req.ip,
      dryRun: toBool(req.body?.dry_run) || toBool(req.query?.dry_run),
    });
    res.json(result);
  })
);

app.get(
  '/api/device-flow/callback/subscriptions',
  requireWriter,
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT id, name, callback_url, events, enabled, timeout_ms, retry_limit, created_at, updated_at
       FROM device_callback_subscriptions
       ORDER BY id DESC
       LIMIT 1000`
    );
    res.json(
      rows.map((item) => ({
        id: Number(item.id),
        name: item.name,
        callback_url: item.callback_url,
        events: String(item.events || '')
          .split(',')
          .map((x) => trimText(x))
          .filter(Boolean),
        enabled: Number(item.enabled || 0) === 1,
        timeout_ms: Number(item.timeout_ms || 0),
        retry_limit: Number(item.retry_limit || 0),
        created_at: item.created_at,
        updated_at: item.updated_at,
      }))
    );
  })
);

app.post(
  '/api/device-flow/callback/subscriptions',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const name = trimText(req.body?.name);
    const callbackUrl = ensureAllowedCallbackUrl(req.body?.callback_url);
    const events = Array.isArray(req.body?.events) ? req.body.events.map((item) => trimText(item).toLowerCase()).filter(Boolean) : [];
    if (!name) throw appError('name 不能为空');
    if (events.length === 0) throw appError('events 不能为空');
    const secretRaw = trimText(req.body?.secret) || crypto.randomUUID().replace(/-/g, '');
    const timeoutMsRaw = Number(req.body?.timeout_ms || 5000);
    const timeoutMs = Number.isInteger(timeoutMsRaw) ? Math.max(1000, Math.min(timeoutMsRaw, 15000)) : 5000;
    const retryLimitRaw = Number(req.body?.retry_limit || 5);
    const retryLimit = Number.isInteger(retryLimitRaw) ? Math.max(1, Math.min(retryLimitRaw, 20)) : 5;
    const enabled = req.body?.enabled === undefined ? 1 : req.body?.enabled ? 1 : 0;

    const result = await transaction(async (tx) => {
      const insertRes = await tx.run(
        `INSERT INTO device_callback_subscriptions
         (name, callback_url, secret, events, enabled, timeout_ms, retry_limit, created_by_sub, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, callbackUrl, secretRaw, events.join(','), enabled, timeoutMs, retryLimit, actor.sub, actor.name]
      );
      const id = Number(insertRes.insertId || 0);
      const row = await tx.get(
        `SELECT id, name, callback_url, events, enabled, timeout_ms, retry_limit, created_at, updated_at
         FROM device_callback_subscriptions
         WHERE id = ?`,
        [id]
      );
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'CREATE_CALLBACK_SUBSCRIPTION',
        entity: 'device_callback_subscription',
        entityId: id,
        message: `创建回调订阅 ${name}`,
        beforeData: null,
        afterData: {
          id,
          name,
          callback_url: callbackUrl,
          events,
          enabled: Boolean(enabled),
        },
        requestIp: req.ip,
      });
      return row;
    });

    res.status(201).json({
      ...result,
      id: Number(result.id),
      events: String(result.events || '')
        .split(',')
        .map((x) => trimText(x))
        .filter(Boolean),
      enabled: Number(result.enabled || 0) === 1,
      timeout_ms: Number(result.timeout_ms || 0),
      retry_limit: Number(result.retry_limit || 0),
      secret: secretRaw,
    });
  })
);

app.put(
  '/api/device-flow/callback/subscriptions/:id',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const actor = getActor(req);
    const row = await transaction(async (tx) => {
      const current = await tx.get('SELECT * FROM device_callback_subscriptions WHERE id = ? FOR UPDATE', [id]);
      if (!current) throw appError('订阅不存在', 404);

      const name = trimText(req.body?.name) || trimText(current.name);
      const callbackUrl = req.body?.callback_url ? ensureAllowedCallbackUrl(req.body.callback_url) : current.callback_url;
      const events = Array.isArray(req.body?.events)
        ? req.body.events.map((item) => trimText(item).toLowerCase()).filter(Boolean)
        : String(current.events || '')
            .split(',')
            .map((item) => trimText(item).toLowerCase())
            .filter(Boolean);
      if (!name) throw appError('name 不能为空');
      if (events.length === 0) throw appError('events 不能为空');
      const enabled = req.body?.enabled === undefined ? Number(current.enabled || 0) : req.body?.enabled ? 1 : 0;
      const timeoutMsRaw = req.body?.timeout_ms === undefined ? Number(current.timeout_ms || 5000) : Number(req.body.timeout_ms);
      const timeoutMs = Number.isInteger(timeoutMsRaw) ? Math.max(1000, Math.min(timeoutMsRaw, 15000)) : 5000;
      const retryLimitRaw = req.body?.retry_limit === undefined ? Number(current.retry_limit || 5) : Number(req.body.retry_limit);
      const retryLimit = Number.isInteger(retryLimitRaw) ? Math.max(1, Math.min(retryLimitRaw, 20)) : 5;
      const secret = trimText(req.body?.secret) || current.secret;

      await tx.run(
        `UPDATE device_callback_subscriptions
         SET name = ?, callback_url = ?, events = ?, enabled = ?, timeout_ms = ?, retry_limit = ?, secret = ?
         WHERE id = ?`,
        [name, callbackUrl, events.join(','), enabled, timeoutMs, retryLimit, secret, id]
      );

      const after = await tx.get(
        `SELECT id, name, callback_url, events, enabled, timeout_ms, retry_limit, created_at, updated_at
         FROM device_callback_subscriptions
         WHERE id = ?`,
        [id]
      );
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'UPDATE_CALLBACK_SUBSCRIPTION',
        entity: 'device_callback_subscription',
        entityId: id,
        message: `更新回调订阅 ${name}`,
        beforeData: {
          name: current.name,
          callback_url: current.callback_url,
          events: current.events,
          enabled: Number(current.enabled || 0) === 1,
        },
        afterData: {
          name,
          callback_url: callbackUrl,
          events,
          enabled: Boolean(enabled),
        },
        requestIp: req.ip,
      });
      return after;
    });

    res.json({
      ...row,
      id: Number(row.id),
      events: String(row.events || '')
        .split(',')
        .map((x) => trimText(x))
        .filter(Boolean),
      enabled: Number(row.enabled || 0) === 1,
      timeout_ms: Number(row.timeout_ms || 0),
      retry_limit: Number(row.retry_limit || 0),
    });
  })
);

app.post(
  '/api/device-flow/callback/run',
  requireWriter,
  asyncHandler(async (req, res) => {
    const maxEventsRaw = Number(req.body?.max_events || CALLBACK_WORKER_BATCH);
    const maxEvents = Number.isInteger(maxEventsRaw) ? Math.max(1, Math.min(maxEventsRaw, 100)) : CALLBACK_WORKER_BATCH;
    const summary = await runCallbackWorkerBatch({ maxEvents });
    res.json(summary);
  })
);

app.post(
  '/api/device-flow/api-clients',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    if (!CHANGE_REVIEW_ROLES.has(normalizeRole(actor.role))) throw appError('仅管理员可创建外部 API 客户端', 403);
    const clientName = trimText(req.body?.client_name);
    if (!clientName) throw appError('client_name 不能为空');
    const apiKey = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const row = await transaction(async (tx) => {
      const insertRes = await tx.run(
        `INSERT INTO device_api_clients
         (client_name, api_key_hash, enabled)
         VALUES (?, ?, 1)`,
        [clientName, hash]
      );
      const id = Number(insertRes.insertId || 0);
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'CREATE_API_CLIENT',
        entity: 'device_api_client',
        entityId: id,
        message: `创建外部API客户端 ${clientName}`,
        beforeData: null,
        afterData: { client_name: clientName, client_id: id },
        requestIp: req.ip,
      });
      return { id, client_name: clientName };
    });
    res.status(201).json({
      ...row,
      api_key: apiKey,
    });
  })
);

app.get(
  '/api/external/device-flow/jobs/:jobNo',
  externalApiAuthRequired,
  asyncHandler(async (req, res) => {
    const jobNo = trimText(req.params.jobNo);
    if (!jobNo) throw appError('jobNo 不能为空');
    const job = await get(
      `SELECT id, job_no, device_sn, device_model, customer_name, sales_order_no,
              inbound_tracking_no, outbound_tracking_no, current_stage, status,
              created_at, updated_at, shipped_at, row_version
       FROM device_jobs
       WHERE job_no = ?`,
      [jobNo]
    );
    if (!job) throw appError('流转单不存在', 404);
    const stageRecords = await query(
      `SELECT id, action, from_stage, to_stage, result, remark, operator_name, operator_role, operated_at
       FROM device_stage_records
       WHERE job_id = ?
       ORDER BY id ASC`,
      [job.id]
    );
    res.json({
      client: req.externalClient,
      job: {
        ...job,
        id: Number(job.id),
        row_version: Number(job.row_version || 0),
      },
      stage_records: stageRecords.map((item) => ({
        ...item,
        id: Number(item.id),
      })),
    });
  })
);

app.get(
  '/api/device-flow/jobs/:id/labels/:type',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const type = trimText(req.params.type).toLowerCase();
    if (!['box', 'device'].includes(type)) throw appError('标签类型仅支持 box/device');
    const job = await get(
      `SELECT id, job_no, device_sn, device_model, customer_name, current_stage, outbound_tracking_no, inbound_tracking_no
       FROM device_jobs
       WHERE id = ?`,
      [id]
    );
    if (!job) throw appError('流转单不存在', 404);
    const trackUrl = getTrackLink(job);
    const qrDataUrl = await QRCode.toDataURL(trackUrl, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });

    if (trimText(req.query.format).toLowerCase() === 'json') {
      return res.json({
        job_id: Number(job.id),
        type,
        track_url: trackUrl,
        qr_data_url: qrDataUrl,
        label: {
          job_no: job.job_no,
          device_sn: job.device_sn,
          device_model: job.device_model,
          customer_name: job.customer_name,
          stage: job.current_stage,
          outbound_tracking_no: job.outbound_tracking_no,
          inbound_tracking_no: job.inbound_tracking_no,
        },
      });
    }

    const title = type === 'box' ? '箱贴' : '设备贴';
    const stageLabel = SLA_STAGE_LABEL[String(job.current_stage || '').toUpperCase()] || String(job.current_stage || '-');
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${title}-${job.job_no}</title>
  <style>
    body { font-family: "PingFang SC", "Microsoft Yahei", sans-serif; padding: 0; margin: 0; background: #f3f5f7; }
    .sheet { width: 90mm; min-height: 60mm; margin: 12px auto; background: #fff; border-radius: 8px; border: 1px solid #d9e1e6; padding: 10mm 8mm; box-sizing: border-box; }
    .title { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #0d3b66; }
    .row { font-size: 12px; margin: 3px 0; color: #17324d; word-break: break-all; }
    .row strong { color: #0a2342; margin-right: 6px; }
    .qr { text-align: center; margin-top: 8px; }
    .qr img { width: 120px; height: 120px; }
    .hint { font-size: 11px; color: #5a6b7d; margin-top: 4px; text-align: center; }
    @media print {
      body { background: #fff; }
      .sheet { margin: 0; border: none; border-radius: 0; width: auto; min-height: auto; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="title">${title}</div>
    <div class="row"><strong>流转单:</strong>${job.job_no}</div>
    <div class="row"><strong>设备SN:</strong>${job.device_sn || '-'}</div>
    <div class="row"><strong>设备型号:</strong>${job.device_model || '-'}</div>
    <div class="row"><strong>客户:</strong>${job.customer_name || '-'}</div>
    <div class="row"><strong>阶段:</strong>${stageLabel}</div>
    <div class="row"><strong>来件单号:</strong>${job.inbound_tracking_no || '-'}</div>
    <div class="row"><strong>发货单号:</strong>${job.outbound_tracking_no || '-'}</div>
    <div class="qr"><img alt="qrcode" src="${qrDataUrl}" /></div>
    <div class="hint">${trackUrl}</div>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  })
);

let slaRunnerTimer = null;
let slaRunnerExecuting = false;
let callbackWorkerTimer = null;
let callbackWorkerExecuting = false;
let maintenanceTimer = null;

const startSlaAutoRunner = () => {
  if (slaRunnerTimer) return;
  slaRunnerTimer = setInterval(async () => {
    if (slaRunnerExecuting) return;
    slaRunnerExecuting = true;
    try {
      const result = await runSlaReminderCheck({
        actor: {
          sub: 'system',
          name: 'system',
          role: 'system',
        },
        requestIp: '127.0.0.1',
        maxScan: 300,
      });
      if (result.triggered > 0) {
        console.log(`[device-flow][sla] triggered ${result.triggered} reminders`);
      }
    } catch (err) {
      console.error('[device-flow][sla] auto runner error', err?.message || err);
    } finally {
      slaRunnerExecuting = false;
    }
  }, SLA_AUTO_RUN_INTERVAL_MS);
};

const startCallbackWorker = () => {
  if (callbackWorkerTimer) return;
  callbackWorkerTimer = setInterval(async () => {
    if (callbackWorkerExecuting) return;
    callbackWorkerExecuting = true;
    try {
      const summary = await runCallbackWorkerBatch({ maxEvents: CALLBACK_WORKER_BATCH });
      if (summary.success > 0 || summary.failed > 0 || summary.retried > 0) {
        console.log(
          `[device-flow][callback] scanned=${summary.scanned} success=${summary.success} failed=${summary.failed} retried=${summary.retried}`
        );
      }
    } catch (err) {
      console.error('[device-flow][callback] worker error', err?.message || err);
    } finally {
      callbackWorkerExecuting = false;
    }
  }, CALLBACK_WORKER_INTERVAL_MS);
};

const runMaintenanceJobs = async () => {
  try {
    await query(
      `DELETE FROM device_ops_metrics
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
       LIMIT 20000`,
      [OPS_METRIC_RETENTION_DAYS]
    );
  } catch (err) {
    console.warn('[device-flow][maintenance] cleanup ops metrics failed', err?.message || err);
  }

  try {
    await runRetentionForAttachments({
      actor: { sub: 'system', name: 'system', role: 'system' },
      requestIp: '127.0.0.1',
      dryRun: false,
    });
  } catch (err) {
    console.warn('[device-flow][maintenance] retention failed', err?.message || err);
  }
};

const startMaintenanceRunner = () => {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(async () => {
    await runMaintenanceJobs();
  }, 60 * 60 * 1000);
};

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `文件过大，最大支持 ${Math.floor(UPLOAD_MAX_FILE_SIZE / 1024 / 1024)}MB` });
    }
    return res.status(400).json({ error: err.message || '文件上传失败' });
  }

  const statusCode = Number(err.statusCode || 500);
  const message = statusCode >= 500 ? '服务器内部错误' : err.message;
  if (statusCode >= 500) {
    console.error('[device-flow]', err);
  }
  return res.status(statusCode).json({ error: message });
});

const start = async () => {
  try {
    validateSecurityBootstrap();
    await initDb();
    const auditRebuild = await rebuildAuditChainHashes();
    if (auditRebuild.updated > 0) {
      console.log(`[device-flow][audit] rebuilt ${auditRebuild.updated}/${auditRebuild.total} chain hashes`);
    }
    startSlaAutoRunner();
    startCallbackWorker();
    startMaintenanceRunner();
    runMaintenanceJobs().catch(() => {
      // ignore bootstrap maintenance errors
    });
    app.listen(PORT, () => {
      console.log(`[device-flow] api started on :${PORT}`);
    });
  } catch (err) {
    console.error('[device-flow] failed to start', err);
    process.exit(1);
  }
};

start();

require('dotenv').config();

const cors = require('cors');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('./cors-origin');
const { get, initDb, query, transaction } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 5185);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5180';
const AUTH_SYSTEM_KEY = String(process.env.AUTH_SYSTEM_KEY || 'sec-impl').trim() || 'sec-impl';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUTH_FETCH_TIMEOUT_MS || 5000));
const SECURITY_STRICT_MODE = process.env.SECURITY_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';
const DASHBOARD_OVERDUE_DAYS = Math.max(1, Number(process.env.DASHBOARD_OVERDUE_DAYS || 3));
const SLA_AUTO_RUN_INTERVAL_MS = Math.max(60000, Number(process.env.SLA_AUTO_RUN_INTERVAL_MS || 5 * 60 * 1000));
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || './uploads/sec-impl');
const UPLOAD_MAX_FILE_SIZE = Math.max(1024 * 100, Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 10) * 1024 * 1024);
const AUDIT_SIGNING_KEY = String(process.env.AUDIT_SIGNING_KEY || process.env.JWT_SECRET || 'sec-impl-audit-signing-key');
const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);
const MAX_BATCH_STAGE_JOB_IDS = Math.max(1, Math.min(500, Number(process.env.MAX_BATCH_STAGE_JOB_IDS || 200)));
const MAX_IMPORT_ROWS = Math.max(1, Math.min(5000, Number(process.env.MAX_IMPORT_ROWS || 500)));
const UPLOAD_ALLOWED_MIME = new Set(
  String(
    process.env.UPLOAD_ALLOWED_MIME ||
      'image/png,image/jpeg,image/jpg,image/webp,application/pdf,text/plain,application/zip,application/x-zip-compressed'
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const STAGES = ['INIT', 'ASSESS', 'IMPLEMENT', 'TUNE', 'TRIAL', 'ACCEPT', 'HANDOVER', 'CLOSED'];
const BASE_WRITER_ROLES = new Set(['admin', 'sysadmin']);
const ATTACHMENT_UPLOADER_ROLES = new Set(['admin', 'sysadmin']);
const ATTACHMENT_DELETER_ROLES = new Set(['admin', 'sysadmin']);
const REWORK_ALLOWED_ROLES = new Set(['admin', 'sysadmin']);
const AUDIT_READER_ROLES = new Set(['auditor']);
const ACTION_TO_STAGE = {
  assess: 'ASSESS',
  implement: 'IMPLEMENT',
  tune: 'TUNE',
  trial: 'TRIAL',
  accept: 'ACCEPT',
  handover: 'HANDOVER',
  close: 'CLOSED',
};
const ACTION_ALLOWED_ROLES = {
  assess: new Set(['admin', 'sysadmin']),
  implement: new Set(['admin', 'sysadmin']),
  tune: new Set(['admin', 'sysadmin']),
  trial: new Set(['admin', 'sysadmin']),
  accept: new Set(['admin', 'sysadmin']),
  handover: new Set(['admin', 'sysadmin']),
  close: new Set(['admin', 'sysadmin']),
};
const SLA_TRACKED_STAGES = STAGES.filter((stage) => stage !== 'CLOSED');
const MANDATORY_EVIDENCE_STAGES = new Set(['IMPLEMENT', 'TUNE', 'TRIAL', 'ACCEPT']);
const SLA_STAGE_LABEL = {
  INIT: '立项准备',
  ASSESS: '评估分析',
  IMPLEMENT: '实施部署',
  TUNE: '联调优化',
  TRIAL: '试运行',
  ACCEPT: '验收确认',
  HANDOVER: '运维移交',
  CLOSED: '归档关闭',
};

const defaultOrigins = ['http://localhost:18084', 'http://127.0.0.1:18084'].map(normalizeOrigin);
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOptions = (req, cb) => {
  const allowed = isOriginAllowedForRequest({
    origin: req.headers.origin,
    headers: req.headers,
    allowedOrigins,
    defaultOrigins,
  });
  if (!allowed) {
    const err = new Error('Not allowed by CORS');
    err.statusCode = 403;
    return cb(err);
  }
  return cb(null, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Limit'],
    maxAge: 86400,
  });
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

if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
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
  const text = `[SECURITY][sec-impl] ${problems.join('；')}`;
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
  if (AUTH_SYSTEM_KEY && !apps.includes(AUTH_SYSTEM_KEY)) throw appError('无权限访问安全产品实施记录系统', 403);

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role || 'viewer',
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
    return next(appError('无权限查看审计日志', 403));
  }
  return next();
};

const authRequired = asyncHandler(async (req, _res, next) => {
  if (req.path === '/api/health') return next();
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
  '/api/sec-impl/logs',
  '/api/sec-impl/audit/verify',
  '/api/sec-impl/reports/audit.csv',
]);

const restrictAuditorToAudit = (req, _res, next) => {
  if (normalizeRole(req.user?.role) !== 'auditor') return next();
  if (req.method === 'OPTIONS') return next();
  if (req.method === 'GET' && auditorAuditPathAllowList.has(req.path)) return next();
  return next(appError('auditor 仅可访问审计相关接口', 403));
};

const getActor = (req) => ({
  sub: String(req.user?.id ?? ''),
  name: String(req.user?.username || ''),
  role: String(req.user?.role || ''),
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

const ensureActionPermission = (action, role) => {
  const allowedRoles = ACTION_ALLOWED_ROLES[action];
  if (!allowedRoles) throw appError('不支持的阶段动作');
  if (!allowedRoles.has(normalizeRole(role))) {
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
  return `SI${y}${m}${d}${hh}${mm}${ss}${rand}`;
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

  if (action === 'implement') {
    return compactObject({
      cpu_match: normalizeFlag(payload.cpu_match),
      memory_match: normalizeFlag(payload.memory_match),
      disk_match: normalizeFlag(payload.disk_match),
      nic_match: normalizeFlag(payload.nic_match),
      serial_match: normalizeFlag(payload.serial_match),
      hardware_note: trimText(payload.hardware_note),
    });
  }

  if (action === 'tune') {
    return compactObject({
      os_name: trimText(payload.os_name),
      os_version: trimText(payload.os_version),
      install_mode: trimText(payload.install_mode),
      install_result: normalizeFlag(payload.install_result),
      install_note: trimText(payload.install_note),
    });
  }

  if (action === 'trial') {
    return compactObject({
      boot_test: normalizeFlag(payload.boot_test),
      network_test: normalizeFlag(payload.network_test),
      stress_test: normalizeFlag(payload.stress_test),
      test_result: normalizeFlag(payload.test_result),
      burnin_hours: trimText(payload.burnin_hours),
      test_note: trimText(payload.test_note),
    });
  }

  if (action === 'accept') {
    return compactObject({
      approve_result: normalizeFlag(payload.approve_result),
      approve_note: trimText(payload.approve_note),
      reviewer_comment: trimText(payload.reviewer_comment),
    });
  }

  if (action === 'handover') {
    return compactObject({
      package_check: normalizeFlag(payload.package_check),
      accessory_check: normalizeFlag(payload.accessory_check),
      box_no: trimText(payload.box_no),
      pack_note: trimText(payload.pack_note),
    });
  }

  if (action === 'close') {
    return compactObject({
      carrier: trimText(payload.carrier),
      shipped_note: trimText(payload.shipped_note),
    });
  }

  if (action === 'assess') {
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
  download_url: `/api/sec-impl/attachments/${item.id}/download`,
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

const validateStagePayload = (action, stagePayload, remark) => {
  const payload = stagePayload && typeof stagePayload === 'object' ? stagePayload : {};

  if (action === 'assess') return;

  if (action === 'implement') {
    const checks = [
      requirePassFailField(payload, 'cpu_match', 'CPU匹配'),
      requirePassFailField(payload, 'memory_match', '内存匹配'),
      requirePassFailField(payload, 'disk_match', '磁盘匹配'),
      requirePassFailField(payload, 'nic_match', '网卡匹配'),
      requirePassFailField(payload, 'serial_match', '序列号匹配'),
    ];
    if (checks.includes('FAIL')) {
      ensureFailureHasNote('FAIL', payload.hardware_note, remark, '实施参数项');
    }
    return;
  }

  if (action === 'tune') {
    requirePayloadField(payload, 'os_name', '系统名称');
    requirePayloadField(payload, 'os_version', '系统版本');
    const result = requirePassFailField(payload, 'install_result', '安装结果');
    ensureFailureHasNote(result, payload.install_note, remark, '安装结果');
    return;
  }

  if (action === 'trial') {
    requirePassFailField(payload, 'boot_test', '开机测试');
    requirePassFailField(payload, 'network_test', '网络测试');
    requirePassFailField(payload, 'stress_test', '压力测试');
    const testResult = requirePassFailField(payload, 'test_result', '测试结论');
    const burninHoursText = trimText(payload.burnin_hours);
    if (burninHoursText) {
      const burninHours = Number(burninHoursText);
      if (!Number.isFinite(burninHours) || burninHours < 0 || burninHours > 9999) {
        throw appError('试运行时长必须是 0-9999 的数字');
      }
    }
    ensureFailureHasNote(testResult, payload.test_note, remark, '测试结论');
    return;
  }

  if (action === 'accept') {
    const approveResult = requirePassFailField(payload, 'approve_result', '验收结论');
    const approveNote = `${trimText(payload.approve_note)}${trimText(payload.reviewer_comment)}`;
    ensureFailureHasNote(approveResult, approveNote, remark, '验收结论');
    return;
  }

  if (action === 'handover') {
    const packageCheck = requirePassFailField(payload, 'package_check', '包装完整');
    const accessoryCheck = requirePassFailField(payload, 'accessory_check', '配件完整');
    requirePayloadField(payload, 'box_no', '移交编号');
    if (packageCheck === 'FAIL' || accessoryCheck === 'FAIL') {
      ensureFailureHasNote('FAIL', payload.pack_note, remark, '移交检查');
    }
    return;
  }

  if (action === 'close') {
    requirePayloadField(payload, 'carrier', '归档责任人');
  }
};

const writeOperationLogTx = async (tx, payload) => {
  const lockName = 'sec_impl_audit_chain_lock';
  let lockAcquired = false;
  try {
    const lockRow = await tx.get('SELECT GET_LOCK(?, 5) AS locked', [lockName]);
    if (Number(lockRow?.locked || 0) !== 1) {
      throw appError('审计日志写入锁获取失败，请稍后重试', 503);
    }
    lockAcquired = true;

    const prevRow = await tx.get(
      `SELECT id, chain_hash
       FROM sec_impl_operation_logs
       ORDER BY id DESC
       LIMIT 1 FOR UPDATE`
    );
    const prevHash = trimText(prevRow?.chain_hash);
    const beforeData = payload.beforeData === undefined ? null : payload.beforeData;
    const afterData = payload.afterData === undefined ? null : payload.afterData;

    const result = await tx.run(
      `INSERT INTO sec_impl_operation_logs
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
    const inserted = await tx.get('SELECT id, created_at FROM sec_impl_operation_logs WHERE id = ?', [insertedId]);
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

    await tx.run('UPDATE sec_impl_operation_logs SET chain_hash = ? WHERE id = ?', [chainHash, insertedId]);
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
    `INSERT INTO sec_impl_stage_records
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
  requestIp,
}) => {
  const toStage = ACTION_TO_STAGE[action];
  if (!toStage) throw appError('不支持的阶段动作');

  return transaction(async (tx) => {
    const current = await tx.get('SELECT * FROM sec_impl_projects WHERE id = ? FOR UPDATE', [jobId]);
    if (!current) throw appError('实施单不存在', 404);

    ensureForwardTransition(current.current_stage, toStage);

    // 关键阶段强制留证，防止先推进后补证据导致审计链不完整。
    if (MANDATORY_EVIDENCE_STAGES.has(toStage)) {
      const attachmentCountRow = await tx.get(
        'SELECT COUNT(*) AS total FROM sec_impl_attachments WHERE job_id = ? AND stage_code = ?',
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

    if (toStage === 'CLOSED') status = 'COMPLETED';

    const updateFields = {
      current_stage: toStage,
      status,
      inbound_tracking_no: nextInboundTrackingNo,
      outbound_tracking_no: nextOutboundTrackingNo,
      remark: remark || current.remark || '',
    };

    if (toStage === 'ASSESS') {
      updateFields.received_by_sub = actor.sub;
      updateFields.received_by_name = actor.name;
      updateFields.received_by_role = actor.role;
      updateFields.received_at = 'NOW()';
    } else if (toStage === 'IMPLEMENT') {
      updateFields.hardware_checked_by_sub = actor.sub;
      updateFields.hardware_checked_by_name = actor.name;
      updateFields.hardware_checked_by_role = actor.role;
      updateFields.hardware_checked_at = 'NOW()';
    } else if (toStage === 'TUNE') {
      updateFields.os_installed_by_sub = actor.sub;
      updateFields.os_installed_by_name = actor.name;
      updateFields.os_installed_by_role = actor.role;
      updateFields.os_installed_at = 'NOW()';
    } else if (toStage === 'TRIAL') {
      updateFields.tested_by_sub = actor.sub;
      updateFields.tested_by_name = actor.name;
      updateFields.tested_by_role = actor.role;
      updateFields.tested_at = 'NOW()';
    } else if (toStage === 'ACCEPT') {
      updateFields.approved_by_sub = actor.sub;
      updateFields.approved_by_name = actor.name;
      updateFields.approved_by_role = actor.role;
      updateFields.approved_at = 'NOW()';
    } else if (toStage === 'HANDOVER') {
      updateFields.packed_by_sub = actor.sub;
      updateFields.packed_by_name = actor.name;
      updateFields.packed_by_role = actor.role;
      updateFields.packed_at = 'NOW()';
    } else if (toStage === 'CLOSED') {
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
    params.push(jobId);

    await tx.run(`UPDATE sec_impl_projects SET ${assignments.join(', ')} WHERE id = ?`, params);

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

    const after = await tx.get('SELECT * FROM sec_impl_projects WHERE id = ?', [jobId]);

    await writeOperationLogTx(tx, {
      jobId,
      userSub: actor.sub,
      username: actor.name,
      userRole: actor.role,
      action: 'STAGE_ADVANCE',
      entity: 'project',
      entityId: jobId,
      message: `阶段推进 ${current.current_stage} -> ${toStage}`,
      beforeData: { current_stage: current.current_stage, status: current.status },
      afterData: {
        stage_action: action,
        current_stage: after.current_stage,
        status: after.status,
        stage_record_id: stageRecordId,
        stage_payload: stagePayload,
      },
      requestIp,
    });

    return after;
  });
};

const IMPORT_HEADER_ALIAS = {
  devicesn: 'project_code',
  sn: 'project_code',
  projectcode: 'project_code',
  code: 'project_code',
  '设备sn': 'project_code',
  '设备序列号': 'project_code',
  '项目编码': 'project_code',
  producttype: 'product_type',
  product: 'product_type',
  '产品类型': 'product_type',
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
  '实施工单号': 'inbound_tracking_no',
  '实施单号': 'inbound_tracking_no',
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
    project_code: '',
    product_type: '',
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
  output.project_code = output.project_code.toUpperCase();
  return output;
};

const parseImportWorkbookRows = (fileBuffer) => {
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
    if (!mapped.project_code && !mapped.customer_name && !mapped.sales_order_no && !mapped.inbound_tracking_no && !mapped.remark) {
      return;
    }
    if (!mapped.project_code) errors.push(`第 ${lineNo} 行：project_code/项目编码 不能为空`);
    if (!mapped.customer_name) errors.push(`第 ${lineNo} 行：customer_name/客户名称 不能为空`);
    mappedRows.push(mapped);
  });

  if (mappedRows.length === 0) throw appError('导入文件未找到有效数据行');
  if (errors.length > 0) throw appError(`导入校验失败：${errors.slice(0, 8).join('；')}`);
  return mappedRows;
};

const buildJobsWorkbookBuffer = (rows) => {
  const exportRows = rows.map((item) => ({
    实施单号: item.job_no,
    项目编码: item.project_code,
    产品类型: item.product_type,
    客户名称: item.customer_name,
    销售订单号: item.sales_order_no,
    实施工单号: item.inbound_tracking_no,
    验收单号: item.outbound_tracking_no,
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
      项目编码: 'PRJ-EXAMPLE-001',
      产品类型: 'WAF',
      客户名称: '示例客户A',
      销售订单号: 'SO-20260219-001',
      实施工单号: 'IN-TRACK-001',
      备注: '首批导入示例',
    },
    {
      项目编码: 'PRJ-EXAMPLE-002',
      产品类型: '数据库审计',
      客户名称: '示例客户B',
      销售订单号: '',
      实施工单号: '',
      备注: '',
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(templateRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'ImportTemplate');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const createJobWithActor = async ({ actor, jobData, requestIp, source = 'manual' }) => {
  const projectCode = trimText(jobData?.project_code).toUpperCase();
  const productType = trimText(jobData?.product_type);
  const customerName = trimText(jobData?.customer_name);
  const salesOrderNo = trimText(jobData?.sales_order_no);
  const inboundTrackingNo = trimText(jobData?.inbound_tracking_no);
  const remark = trimText(jobData?.remark);

  if (!projectCode) throw appError('项目编码不能为空');
  if (!customerName) throw appError('客户名称不能为空');

  let createdId = 0;
  for (let i = 0; i < 5; i += 1) {
    const jobNo = buildJobNo();
    try {
      createdId = await transaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO sec_impl_projects
           (job_no, project_code, product_type, customer_name, sales_order_no, inbound_tracking_no, current_stage, status, remark, created_by_sub, created_by_name, created_by_role)
           VALUES (?, ?, ?, ?, ?, ?, 'INIT', 'OPEN', ?, ?, ?, ?)`,
          [jobNo, projectCode, productType, customerName, salesOrderNo, inboundTrackingNo, remark, actor.sub, actor.name, actor.role]
        );
        const jobId = Number(result.insertId || 0);

        await appendStageRecordTx(tx, {
          jobId,
          action: 'CREATE',
          fromStage: 'INIT',
          toStage: 'INIT',
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
          action: 'PROJECT_CREATE',
          entity: 'project',
          entityId: jobId,
          message: `创建实施单 ${jobNo}`,
          beforeData: null,
          afterData: {
            job_no: jobNo,
            project_code: projectCode,
            product_type: productType || '',
            current_stage: 'INIT',
            source,
          },
          requestIp,
        });

        return jobId;
      });
      break;
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY' && i < 4) continue;
      throw err;
    }
  }

  if (!createdId) throw appError('创建实施单失败，请重试', 500);
  const createdRow = await get('SELECT * FROM sec_impl_projects WHERE id = ?', [createdId]);
  return createdRow;
};

const listSlaRules = async () => {
  const rules = await query(
    `SELECT stage_code, threshold_hours, remind_interval_minutes, enabled, updated_at
     FROM sec_impl_sla_rules
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
     FROM sec_impl_projects j
     JOIN sec_impl_sla_rules r ON r.stage_code = j.current_stage AND r.enabled = 1
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
         FROM sec_impl_projects
         WHERE id = ? FOR UPDATE`,
        [item.id]
      );
      if (!job || String(job.status || '').toUpperCase() === 'COMPLETED') return null;

      const rule = await tx.get(
        `SELECT threshold_hours, remind_interval_minutes, enabled
         FROM sec_impl_sla_rules
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
         FROM sec_impl_sla_reminders
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

      const message = `SLA催办：实施单 ${job.job_no} 已在阶段 ${SLA_STAGE_LABEL[job.current_stage] || job.current_stage} 超时 ${overdueHours} 小时（阈值 ${thresholdHours} 小时）`;
      const insertRes = await tx.run(
        `INSERT INTO sec_impl_sla_reminders
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
        entity: 'project',
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
              j.project_code,
              j.customer_name,
              j.current_stage,
              j.updated_at,
              TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) AS overdue_hours,
              r.threshold_hours
       FROM sec_impl_projects j
       JOIN sec_impl_sla_rules r ON r.stage_code = j.current_stage AND r.enabled = 1
       WHERE j.status <> 'COMPLETED'
         AND TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) >= r.threshold_hours
         AND TIMESTAMPDIFF(HOUR, j.updated_at, NOW()) >= ?
       ORDER BY overdue_hours DESC, j.updated_at ASC
      LIMIT 200`,
      [minHours]
    ),
    get('SELECT COUNT(*) AS total FROM sec_impl_sla_reminders'),
    query(
      `SELECT r.id,
              r.job_id,
              r.stage_code,
              r.threshold_hours,
              r.overdue_hours,
              r.message,
              r.created_at,
              j.job_no,
              j.project_code,
              j.customer_name
       FROM sec_impl_sla_reminders r
       LEFT JOIN sec_impl_projects j ON j.id = r.job_id
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
     FROM sec_impl_operation_logs
     ${whereSql}
     ORDER BY id ASC
     LIMIT ?`,
    [...params, safeLimit]
  );

  let prevHash = '';
  if (rows.length > 0 && Number(rows[0].id || 0) > 1) {
    const anchor = await get('SELECT chain_hash FROM sec_impl_operation_logs WHERE id < ? ORDER BY id DESC LIMIT 1', [rows[0].id]);
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
     FROM sec_impl_operation_logs
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
      await query('UPDATE sec_impl_operation_logs SET chain_prev_hash = ?, chain_hash = ?, chain_version = ? WHERE id = ?', [
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

app.use(authRequired);
app.use(restrictAuditorToAudit);

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, service: 'sec-impl', time: new Date().toISOString() });
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

app.get(
  '/api/sec-impl/dashboard/summary',
  asyncHandler(async (req, res) => {
    const overdueDaysRaw = Number(req.query.overdue_days || DASHBOARD_OVERDUE_DAYS);
    const overdueDays =
      Number.isInteger(overdueDaysRaw) && overdueDaysRaw > 0 ? Math.min(overdueDaysRaw, 30) : DASHBOARD_OVERDUE_DAYS;
    const stage = parseStageFilter(req.query.stage, 'stage');
    const customer = trimText(req.query.customer);
    const canReadAuditLogs = AUDIT_READER_ROLES.has(normalizeRole(req.user?.role));
    const { whereSql: jobWhereSql, params: jobParams } = buildDashboardJobWhere({ stage, customer });

    const [stageRows, totalRow, openRow, completedRow, createdTodayRow, shippedTodayRow, overdueRows, recentRows] =
      await Promise.all([
        query(`SELECT j.current_stage, COUNT(*) AS total FROM sec_impl_projects j ${jobWhereSql} GROUP BY j.current_stage`, jobParams),
        get(`SELECT COUNT(*) AS total FROM sec_impl_projects j ${jobWhereSql}`, jobParams),
        get(
          `SELECT COUNT(*) AS total FROM sec_impl_projects j ${appendWhereClause(jobWhereSql, "j.status <> 'COMPLETED'")}`,
          jobParams
        ),
        get(
          `SELECT COUNT(*) AS total FROM sec_impl_projects j ${appendWhereClause(jobWhereSql, "j.status = 'COMPLETED'")}`,
          jobParams
        ),
        get(
          `SELECT COUNT(*) AS total FROM sec_impl_projects j ${appendWhereClause(jobWhereSql, 'DATE(j.created_at) = CURDATE()')}`,
          jobParams
        ),
        get(
          `SELECT COUNT(*) AS total FROM sec_impl_projects j ${appendWhereClause(jobWhereSql, 'DATE(j.shipped_at) = CURDATE()')}`,
          jobParams
        ),
        query(
          `SELECT j.id,
                  j.job_no,
                  j.project_code,
                  j.customer_name,
                  j.current_stage,
                  j.status,
                  j.updated_at,
                  j.created_at,
                  TIMESTAMPDIFF(DAY, j.updated_at, NOW()) AS overdue_days
           FROM sec_impl_projects j
           ${appendWhereClause(
             jobWhereSql,
             "j.status <> 'COMPLETED' AND TIMESTAMPDIFF(DAY, j.updated_at, NOW()) >= ?"
           )}
           ORDER BY j.updated_at ASC
           LIMIT 100`,
          [...jobParams, overdueDays]
        ),
        canReadAuditLogs
          ? query(
              `SELECT l.*,
                      j.job_no,
                      j.project_code,
                      j.customer_name,
                      j.current_stage
               FROM sec_impl_operation_logs l
               LEFT JOIN sec_impl_projects j ON j.id = l.job_id
               ${jobWhereSql}
               ORDER BY l.id DESC
               LIMIT 20`,
              jobParams
            )
          : Promise.resolve([]),
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
        closed_today: Number(shippedTodayRow?.total || 0),
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
  '/api/sec-impl/sla/summary',
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
  '/api/sec-impl/sla/rules',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const parsedRules = normalizeSlaRuleInput(req.body?.rules);
    await transaction(async (tx) => {
      for (const rule of parsedRules) {
        await tx.run(
          `INSERT INTO sec_impl_sla_rules
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
        action: 'SLA_RULE_UPDATE',
        entity: 'sla_rule',
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
  '/api/sec-impl/sla/run',
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
  '/api/sec-impl/sla/reminders/:id',
  requireWriter,
  asyncHandler(async (req, res) => {
    const reminderId = Number(req.params.id || 0);
    if (!Number.isInteger(reminderId) || reminderId <= 0) throw appError('id 参数非法');

    const actor = getActor(req);
    const reminder = await get(
      `SELECT id, job_id, stage_code, threshold_hours, overdue_hours, message, created_at
       FROM sec_impl_sla_reminders
       WHERE id = ?`,
      [reminderId]
    );
    if (!reminder) throw appError('催办记录不存在', 404);

    await transaction(async (tx) => {
      await tx.run('DELETE FROM sec_impl_sla_reminders WHERE id = ?', [reminderId]);
      await writeOperationLogTx(tx, {
        jobId: Number(reminder.job_id || 0) || null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'SLA_REMINDER_DELETE',
        entity: 'sla_rule',
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
  '/api/sec-impl/sla/reminders',
  requireWriter,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const totalRow = await get('SELECT COUNT(*) AS total FROM sec_impl_sla_reminders');
    const total = Number(totalRow?.total || 0);
    if (total <= 0) return res.json({ deleted: 0 });

    await transaction(async (tx) => {
      await tx.run('DELETE FROM sec_impl_sla_reminders');
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'SLA_REMINDER_PURGE',
        entity: 'sla_rule',
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
  '/api/sec-impl/logs',
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
        '(l.action LIKE ? OR l.message LIKE ? OR j.job_no LIKE ? OR j.project_code LIKE ? OR j.customer_name LIKE ?)'
      );
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await get(
      `SELECT COUNT(*) AS total
       FROM sec_impl_operation_logs l
       LEFT JOIN sec_impl_projects j ON j.id = l.job_id
       ${whereSql}`,
      params
    );
    const rows = await query(
      `SELECT l.*,
              j.job_no,
              j.project_code,
              j.customer_name,
              j.current_stage
       FROM sec_impl_operation_logs l
       LEFT JOIN sec_impl_projects j ON j.id = l.job_id
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
  '/api/sec-impl/audit/verify',
  requireAuditReader,
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const fromIdRaw = Number(req.query.from_id || 0);
    const toIdRaw = Number(req.query.to_id || 0);
    const limitRaw = Number(req.query.limit || 5000);
    const fromId = Number.isInteger(fromIdRaw) && fromIdRaw > 0 ? fromIdRaw : 0;
    const toId = Number.isInteger(toIdRaw) && toIdRaw > 0 ? toIdRaw : 0;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20000) : 5000;

    const result = await verifyAuditChain({ fromId, toId, limit });

    await transaction(async (tx) => {
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'AUDIT_VERIFY',
        entity: 'operation_log',
        entityId: null,
        message: `审计链验签: checked=${Number(result.total_checked || 0)}, issues=${Number(result.issue_count || 0)}`,
        beforeData: {
          from_id: fromId || null,
          to_id: toId || null,
          limit,
        },
        afterData: {
          total_checked: Number(result.total_checked || 0),
          issue_count: Number(result.issue_count || 0),
          passed: Boolean(result.passed),
        },
        requestIp: req.ip,
      });
    });
    res.json(result);
  })
);

app.post(
  '/api/sec-impl/projects',
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
  '/api/sec-impl/projects',
  asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query.page, req.query.limit);
    const keyword = trimText(req.query.keyword);
    const stage = trimText(req.query.stage).toUpperCase();

    const where = [];
    const params = [];
    if (keyword) {
      where.push(
        '(job_no LIKE ? OR project_code LIKE ? OR product_type LIKE ? OR customer_name LIKE ? OR sales_order_no LIKE ? OR inbound_tracking_no LIKE ? OR outbound_tracking_no LIKE ?)'
      );
      params.push(
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`
      );
    }
    if (stage) {
      if (!STAGES.includes(stage)) throw appError('stage 参数非法');
      where.push('current_stage = ?');
      params.push(stage);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await get(`SELECT COUNT(*) AS total FROM sec_impl_projects ${whereSql}`, params);
    const rows = await query(
      `SELECT * FROM sec_impl_projects ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, paging.limit, paging.offset]
    );

    res.setHeader('X-Total-Count', String(Number(totalRow?.total || 0)));
    res.setHeader('X-Page', String(paging.page));
    res.setHeader('X-Limit', String(paging.limit));
    res.json(rows);
  })
);

app.post(
  '/api/sec-impl/projects/batch/stage',
  asyncHandler(async (req, res) => {
    const action = trimText(req.body?.action).toLowerCase();
    if (!ACTION_TO_STAGE[action]) throw appError('不支持的阶段动作');
    ensureActionPermission(action, req.user?.role);

    const actor = getActor(req);
    const remark = trimText(req.body?.remark);
    const stagePayload = buildStagePayload(action, req.body?.stage_payload);
    validateStagePayload(action, stagePayload, remark);
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
          inboundTrackingNo: req.body?.inbound_tracking_no,
          outboundTrackingNo: req.body?.outbound_tracking_no,
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

    await transaction(async (tx) => {
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'BATCH_STAGE',
        entity: 'project',
        entityId: null,
        message: `批量阶段推进 ${action}，成功 ${results.length}/${jobIds.length}`,
        beforeData: {
          action,
          total: jobIds.length,
        },
        afterData: {
          success_count: results.length,
          failure_count: failures.length,
          successes: results.slice(0, 20),
          failures: failures.slice(0, 20),
        },
        requestIp: req.ip,
      });
    });

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
  '/api/sec-impl/import/projects.xlsx',
  requireWriter,
  importUpload.single('file'),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const file = req.file;
    if (!file) throw appError('请上传 Excel 文件');

    const rows = parseImportWorkbookRows(file.buffer);
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
          project_code: created.project_code,
        });
      } catch (err) {
        failures.push({
          row_no: i + 2,
          project_code: row.project_code,
          error: err?.message || '导入失败',
        });
      }
    }

    await transaction(async (tx) => {
      await writeOperationLogTx(tx, {
        jobId: null,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'BATCH_IMPORT',
        entity: 'project',
        entityId: null,
        message: `批量导入实施单: success=${successes.length}, failure=${failures.length}`,
        beforeData: {
          total_rows: rows.length,
        },
        afterData: {
          success_count: successes.length,
          failure_count: failures.length,
          sample_successes: successes.slice(0, 20),
          sample_failures: failures.slice(0, 20),
        },
        requestIp: req.ip,
      });
    });

    res.json({
      total_rows: rows.length,
      success_count: successes.length,
      failure_count: failures.length,
      successes,
      failures,
    });
  })
);

app.get(
  '/api/sec-impl/projects/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');
    const canReadAuditLogs = AUDIT_READER_ROLES.has(normalizeRole(req.user?.role));

    const job = await get('SELECT * FROM sec_impl_projects WHERE id = ?', [id]);
    if (!job) throw appError('实施单不存在', 404);

    const [stageRecords, operationLogs, attachments] = await Promise.all([
      query('SELECT * FROM sec_impl_stage_records WHERE job_id = ? ORDER BY id DESC', [id]),
      canReadAuditLogs
        ? query('SELECT * FROM sec_impl_operation_logs WHERE job_id = ? ORDER BY id DESC LIMIT 300', [id])
        : Promise.resolve([]),
      query('SELECT * FROM sec_impl_attachments WHERE job_id = ? ORDER BY id DESC', [id]),
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
  '/api/sec-impl/projects/:id/attachments',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const existed = await get('SELECT id FROM sec_impl_projects WHERE id = ?', [id]);
    if (!existed) throw appError('实施单不存在', 404);

    const rows = await query('SELECT * FROM sec_impl_attachments WHERE job_id = ? ORDER BY id DESC', [id]);
    res.json(rows.map(toPublicAttachment));
  })
);

app.get(
  '/api/sec-impl/attachments/:id/download',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const row = await get('SELECT * FROM sec_impl_attachments WHERE id = ?', [id]);
    if (!row) throw appError('附件不存在', 404);

    const resolved = path.resolve(row.file_path);
    if (!resolved.startsWith(UPLOAD_ROOT)) throw appError('附件路径非法', 400);
    if (!fs.existsSync(resolved)) throw appError('附件文件不存在', 404);

    res.download(resolved, row.file_name || row.stored_name || `attachment-${id}`);
  })
);

app.delete(
  '/api/sec-impl/attachments/:id',
  requireAttachmentDeleter,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const actor = getActor(req);
    const deleted = await transaction(async (tx) => {
      const row = await tx.get('SELECT * FROM sec_impl_attachments WHERE id = ? FOR UPDATE', [id]);
      if (!row) throw appError('附件不存在', 404);

      const stageCode = trimText(row.stage_code).toUpperCase();
      if (MANDATORY_EVIDENCE_STAGES.has(stageCode)) {
        const countRow = await tx.get(
          'SELECT COUNT(*) AS total FROM sec_impl_attachments WHERE job_id = ? AND stage_code = ?',
          [row.job_id, stageCode]
        );
        if (Number(countRow?.total || 0) <= 1) {
          throw appError('该阶段至少保留1个留证附件，无法删除最后一个附件', 409);
        }
      }

      await tx.run('DELETE FROM sec_impl_attachments WHERE id = ?', [id]);

      await writeOperationLogTx(tx, {
        jobId: Number(row.job_id),
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'ATTACHMENT_DELETE',
        entity: 'attachment',
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
        console.warn('[sec-impl] attachment file delete failed:', err?.message || err);
      }
    }

    res.json({ id, deleted: true });
  })
);

app.post(
  '/api/sec-impl/projects/:id/attachments',
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
      const job = await tx.get('SELECT id, current_stage FROM sec_impl_projects WHERE id = ? FOR UPDATE', [jobId]);
      if (!job) throw appError('实施单不存在', 404);

      let stageCodeFinal = stageCode;
      if (stageCodeFinal && !STAGES.includes(stageCodeFinal)) throw appError('stage_code 非法');
      if (!stageCodeFinal) stageCodeFinal = String(job.current_stage || '');

      if (stageRecordId) {
        const stageRecord = await tx.get('SELECT id FROM sec_impl_stage_records WHERE id = ? AND job_id = ?', [stageRecordId, jobId]);
        if (!stageRecord) throw appError('阶段记录不存在或不匹配');
      }

      const result = await tx.run(
        `INSERT INTO sec_impl_attachments
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
      const row = await tx.get('SELECT * FROM sec_impl_attachments WHERE id = ?', [attachmentId]);

      await writeOperationLogTx(tx, {
        jobId,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'ATTACHMENT_UPLOAD',
        entity: 'attachment',
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
  '/api/sec-impl/projects/:id/stages/:action',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const action = trimText(req.params.action).toLowerCase();
    const toStage = ACTION_TO_STAGE[action];
    if (!toStage) throw appError('不支持的阶段动作');
    ensureActionPermission(action, req.user?.role);

    const actor = getActor(req);
    const remark = trimText(req.body?.remark);
    const stagePayload = buildStagePayload(action, req.body?.stage_payload);
    validateStagePayload(action, stagePayload, remark);

    const updated = await advanceStageJob({
      jobId: id,
      action,
      actor,
      remark,
      stagePayload,
      inboundTrackingNo: req.body?.inbound_tracking_no,
      outboundTrackingNo: req.body?.outbound_tracking_no,
      requestIp: req.ip,
    });

    res.json(updated);
  })
);

app.post(
  '/api/sec-impl/projects/:id/rework',
  asyncHandler(async (req, res) => {
    if (!REWORK_ALLOWED_ROLES.has(normalizeRole(req.user?.role))) {
      throw appError('当前角色无权限执行退回', 403);
    }

    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) throw appError('ID非法');

    const targetStage = trimText(req.body?.target_stage).toUpperCase();
    const reason = trimText(req.body?.reason);
    const remark = trimText(req.body?.remark);
    if (!targetStage || !STAGES.includes(targetStage)) throw appError('退回目标阶段非法');
    if (!reason) throw appError('退回原因不能为空');

    const actor = getActor(req);

    const updated = await transaction(async (tx) => {
      const current = await tx.get('SELECT * FROM sec_impl_projects WHERE id = ? FOR UPDATE', [id]);
      if (!current) throw appError('实施单不存在', 404);
      ensureReworkTransition(current.current_stage, targetStage);

      await tx.run('UPDATE sec_impl_projects SET current_stage = ?, status = ?, remark = ? WHERE id = ?', [
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

      const after = await tx.get('SELECT * FROM sec_impl_projects WHERE id = ?', [id]);
      await writeOperationLogTx(tx, {
        jobId: id,
        userSub: actor.sub,
        username: actor.name,
        userRole: actor.role,
        action: 'STAGE_REWORK',
        entity: 'project',
        entityId: id,
        message: `流程退回 ${current.current_stage} -> ${targetStage}`,
        beforeData: { current_stage: current.current_stage, status: current.status },
        afterData: { current_stage: after.current_stage, status: after.status, reason, stage_record_id: stageRecordId },
        requestIp: req.ip,
      });

      return after;
    });

    res.json(updated);
  })
);

app.get(
  '/api/sec-impl/templates/projects-import.xlsx',
  asyncHandler(async (_req, res) => {
    const buffer = buildImportTemplateBuffer();
    const filename = 'sec-impl-import-template.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

app.get(
  '/api/sec-impl/reports/projects.xlsx',
  asyncHandler(async (req, res) => {
    const keyword = trimText(req.query.keyword);
    const customer = trimText(req.query.customer);
    const stage = parseStageFilter(req.query.stage, 'stage');
    const where = [];
    const params = [];

    if (keyword) {
      where.push(
        '(j.job_no LIKE ? OR j.project_code LIKE ? OR j.product_type LIKE ? OR j.customer_name LIKE ? OR j.sales_order_no LIKE ? OR j.inbound_tracking_no LIKE ? OR j.outbound_tracking_no LIKE ?)'
      );
      params.push(
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`
      );
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
              j.project_code,
              j.product_type,
              j.customer_name,
              j.sales_order_no,
              j.inbound_tracking_no,
              j.outbound_tracking_no,
              j.current_stage,
              j.status,
              j.updated_at,
              j.created_at
       FROM sec_impl_projects j
       ${whereSql}
       ORDER BY j.id DESC
       LIMIT 20000`,
      params
    );

    const buffer = buildJobsWorkbookBuffer(rows);
    const filename = `sec-impl-jobs-${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

app.get(
  '/api/sec-impl/reports/dashboard.csv',
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
              j.project_code,
              j.product_type,
              j.customer_name,
              j.current_stage,
              j.status,
              j.inbound_tracking_no,
              j.outbound_tracking_no,
              j.created_at,
              j.updated_at,
              j.shipped_at,
              TIMESTAMPDIFF(DAY, j.updated_at, NOW()) AS overdue_days
       FROM sec_impl_projects j
       ${whereSql}
       ORDER BY j.updated_at DESC
       LIMIT 20000`,
      params
    );

    const header = [
      '实施单ID',
      '实施单号',
      '项目编码',
      '产品类型',
      '客户',
      '当前阶段',
      '状态',
      '实施工单号',
      '验收单号',
      '创建时间',
      '最后更新时间',
      '归档时间',
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
          row.project_code,
          row.product_type,
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

    const filename = `sec-impl-dashboard-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${lines.join('\n')}`);
  })
);

app.get(
  '/api/sec-impl/reports/audit.csv',
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
        '(l.action LIKE ? OR l.message LIKE ? OR j.job_no LIKE ? OR j.project_code LIKE ? OR j.customer_name LIKE ?)'
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
              j.project_code,
              j.customer_name,
              j.current_stage
       FROM sec_impl_operation_logs l
       LEFT JOIN sec_impl_projects j ON j.id = l.job_id
       ${whereSql}
       ORDER BY l.id DESC
       LIMIT 10000`,
      params
    );

    const header = ['日志ID', '操作时间', '操作人', '角色', '动作', '说明', '来源IP', '实施单号', '项目编码', '客户', '当前阶段'];
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
          row.project_code,
          row.customer_name,
          row.current_stage,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });

    const filename = `sec-impl-audit-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${lines.join('\n')}`);
  })
);

let slaRunnerTimer = null;
let slaRunnerExecuting = false;

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
        console.log(`[sec-impl][sla] triggered ${result.triggered} reminders`);
      }
    } catch (err) {
      console.error('[sec-impl][sla] auto runner error', err?.message || err);
    } finally {
      slaRunnerExecuting = false;
    }
  }, SLA_AUTO_RUN_INTERVAL_MS);
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
    console.error('[sec-impl]', err);
  }
  return res.status(statusCode).json({ error: message });
});

const start = async () => {
  try {
    validateSecurityBootstrap();
    await initDb();
    const auditRebuild = await rebuildAuditChainHashes();
    if (auditRebuild.updated > 0) {
      console.log(`[sec-impl][audit] rebuilt ${auditRebuild.updated}/${auditRebuild.total} chain hashes`);
    }
    startSlaAutoRunner();
    app.listen(PORT, () => {
      console.log(`[sec-impl] api started on :${PORT}`);
    });
  } catch (err) {
    console.error('[sec-impl] failed to start', err);
    process.exit(1);
  }
};

start();

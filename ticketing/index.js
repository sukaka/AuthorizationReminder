const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const db = require('../server/db');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5182;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth:5180';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const AUDIT_SIGNING_KEY = process.env.AUDIT_SIGNING_KEY || process.env.JWT_SECRET || 'dev-secret-change-me';
const AUTH_FETCH_TIMEOUT_MS = Number(process.env.AUTH_FETCH_TIMEOUT_MS || 4000);
const SECURITY_STRICT_MODE = process.env.SECURITY_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';
const TICKET_ATTACHMENT_MAX_BYTES = Number(process.env.TICKET_ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024);
const TICKETING_API_RATE_LIMIT_WINDOW_MS = Number(process.env.TICKETING_API_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const TICKETING_API_RATE_LIMIT_MAX = Number(process.env.TICKETING_API_RATE_LIMIT_MAX || 600);
const TICKETING_UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.TICKETING_UPLOAD_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const TICKETING_UPLOAD_RATE_LIMIT_MAX = Number(process.env.TICKETING_UPLOAD_RATE_LIMIT_MAX || 30);
const TICKETING_LIST_MAX_LIMIT = Number(process.env.TICKETING_LIST_MAX_LIMIT || 500);
const allowedAttachmentMimes = new Set(
  String(
    process.env.TICKET_ATTACHMENT_ALLOWED_MIME ||
      'image/png,image/jpeg,image/jpg,image/webp,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);
const isWeakSecret = (value, minLength = 16) => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length < minLength) return true;
  return weakSecrets.has(text.toLowerCase());
};

const validateSecurityBootstrap = () => {
  const problems = [];
  if (isWeakSecret(JWT_SECRET, 32)) problems.push('JWT_SECRET 过弱');
  if (isWeakSecret(AUDIT_SIGNING_KEY, 32)) problems.push('AUDIT_SIGNING_KEY 过弱');
  if (!problems.length) return;
  const text = `[SECURITY][ticketing] ${problems.join('；')}`;
  if (SECURITY_STRICT_MODE) throw new Error(text);
  console.warn(`${text}。当前为非严格模式，仅告警。`);
};

const extractRequestIp = (req) => {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  return ip || 'unknown';
};

const createIpRateLimiter = ({ name, windowMs, max }) => {
  const buckets = new Map();
  const sweepMs = Math.max(windowMs, 60 * 1000);
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, item] of buckets.entries()) {
      if (item.resetAt <= now) buckets.delete(key);
    }
  }, sweepMs);
  if (typeof timer.unref === 'function') timer.unref();
  return (req, res, next) => {
    const now = Date.now();
    const ip = extractRequestIp(req);
    const key = `${name}:${ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    return next();
  };
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || AUTH_FETCH_TIMEOUT_MS));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const extractAuthToken = (req) => {
  const header = String(req.headers.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match && String(match[1] || '').trim()) return String(match[1]).trim();
  const rawCookie = String(req.headers.cookie || '');
  if (!rawCookie) return '';
  const pairs = rawCookie.split(';');
  for (const item of pairs) {
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const key = item.slice(0, idx).trim();
    if (key !== AUTH_COOKIE_NAME) continue;
    return decodeURIComponent(item.slice(idx + 1).trim());
  }
  return '';
};
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number.isFinite(TICKET_ATTACHMENT_MAX_BYTES) && TICKET_ATTACHMENT_MAX_BYTES > 0
      ? TICKET_ATTACHMENT_MAX_BYTES
      : 10 * 1024 * 1024,
  },
});

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
].map(normalizeOrigin);
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
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
};

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
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
}
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
const ticketingApiRateLimiter = createIpRateLimiter({
  name: 'ticketing-api',
  windowMs: Math.max(1000, TICKETING_API_RATE_LIMIT_WINDOW_MS),
  max: Math.max(1, TICKETING_API_RATE_LIMIT_MAX),
});
const ticketingUploadRateLimiter = createIpRateLimiter({
  name: 'ticketing-upload',
  windowMs: Math.max(1000, TICKETING_UPLOAD_RATE_LIMIT_WINDOW_MS),
  max: Math.max(1, TICKETING_UPLOAD_RATE_LIMIT_MAX),
});

const authMiddleware = (req, res, next) => {
  if (req.path === '/health') return next();
  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  fetchWithTimeout(`${AUTH_SERVICE_URL}/api/auth/introspect`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (resp) => {
      if (!resp.ok) return res.status(401).json({ error: '登录已过期' });
      const data = await resp.json();
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      if (!apps.includes('ticketing')) {
        return res.status(403).json({ error: '无权限访问工单管理系统' });
      }
      req.user = data?.user ? { ...data.user, request_ip: getClientIp(req) } : null;
      req.apps = apps;
      return next();
    })
    .catch(() => res.status(401).json({ error: '登录已过期' }));
};

const authorize = async (req, { action, resource = {} }) => {
  const token = extractAuthToken(req);
  if (!token) return { allow: false, reason: '未登录' };
  try {
    const resp = await fetchWithTimeout(`${AUTH_SERVICE_URL}/api/auth/authorize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system: 'ticketing',
        action,
        resource,
      }),
    });
    if (!resp.ok) return { allow: false, reason: '登录已过期' };
    const data = await resp.json();
    return data || { allow: false, reason: '无权限' };
  } catch (err) {
    return { allow: false, reason: '权限服务不可用' };
  }
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const TICKET_STATUS_OPTIONS = ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'WAIT_VERIFY', 'RESOLVED', 'CLOSED'];
const TICKET_STATUS_TRANSITIONS = {
  OPEN: ['ACCEPTED'],
  ACCEPTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['WAIT_VERIFY'],
  WAIT_VERIFY: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: ['OPEN'],
};
const TICKET_STATUS_LABEL = {
  OPEN: '新建',
  ACCEPTED: '受理',
  IN_PROGRESS: '处理中',
  WAIT_VERIFY: '待验证',
  RESOLVED: '完成',
  CLOSED: '关闭',
};

const isHighRiskTicket = ({ priority, severity }) => {
  const p = String(priority || '').toUpperCase();
  const s = String(severity || '').toUpperCase();
  return p === 'P1' || s === 'HIGH' || s === 'CRITICAL';
};

const normalizeTicketStatus = (value, fallback = 'OPEN') => {
  const next = String(value || '').toUpperCase();
  return TICKET_STATUS_OPTIONS.includes(next) ? next : fallback;
};

const validateTicketStatusTransition = ({ current, next }) => {
  const from = normalizeTicketStatus(current, 'OPEN');
  const to = normalizeTicketStatus(next, from);
  if (from === to) return '';
  const allowed = TICKET_STATUS_TRANSITIONS[from] || [];
  if (allowed.includes(to)) return '';
  return `状态流不允许：${from} -> ${to}`;
};

const toTicketStatusZh = (value) => TICKET_STATUS_LABEL[String(value || '').toUpperCase()] || String(value || '');

const isHalfDayAligned = (date) => {
  if (!date) return false;
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return (hours === 0 || hours === 12) && minutes === 0 && seconds === 0;
};

const validateSchedule = (startAt, endAt) => {
  const start = parseDate(startAt);
  const end = parseDate(endAt);
  if (!start || !end) return '开始时间或结束时间不合法';
  if (!isHalfDayAligned(start) || !isHalfDayAligned(end)) {
    return '排期时间需按 0.5 天对齐（00:00 或 12:00）';
  }
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return '结束时间必须大于开始时间';
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 12 || diffHours % 12 !== 0) {
    return '最小排期为 0.5 天，且必须为 0.5 天的倍数';
  }
  return '';
};

const getProjectPermissionFlags = async (projectId, userId) => {
  const pid = Number(projectId);
  const uid = Number(userId);
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(uid) || uid <= 0) {
    return { can_view: false, can_edit: false, can_assign: false, can_close: false };
  }
  const row = await db.get(
    `SELECT can_view, can_edit, can_assign, can_close
     FROM ticket_project_members
     WHERE project_id = ? AND user_id = ?`,
    [pid, uid]
  );
  return {
    can_view: Number(row?.can_view || 0) === 1,
    can_edit: Number(row?.can_edit || 0) === 1,
    can_assign: Number(row?.can_assign || 0) === 1,
    can_close: Number(row?.can_close || 0) === 1,
  };
};

const buildTicketVisibility = (user, alias = 't') => {
  if (user?.role === 'admin') return { sql: '1=1', params: [] };
  return {
    sql: `(
      ${alias}.created_by = ?
      OR ${alias}.owner_id = ?
      OR EXISTS (SELECT 1 FROM ticket_assignees ta WHERE ta.ticket_id = ${alias}.id AND ta.user_id = ?)
      OR EXISTS (SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id = ${alias}.id AND tw.user_id = ?)
      OR EXISTS (
        SELECT 1
        FROM ticket_project_members tpm
        WHERE tpm.project_id = ${alias}.project_id
          AND tpm.user_id = ?
          AND (tpm.can_view = 1 OR tpm.can_edit = 1 OR tpm.can_assign = 1 OR tpm.can_close = 1)
      )
    )`,
    params: [
      Number(user?.id || 0),
      Number(user?.id || 0),
      Number(user?.id || 0),
      Number(user?.id || 0),
      Number(user?.id || 0),
    ],
  };
};

const getTicketAuthResource = async (ticketId, userId = null) => {
  const id = Number(ticketId);
  if (!Number.isFinite(id)) return { ticket_id: ticketId, ticket_exists: false };
  const ticket = await db.get('SELECT id, created_by, owner_id, project_id FROM tickets WHERE id = ?', [id]);
  let related = false;
  let canView = false;
  let canEdit = false;
  let canAssign = false;
  let canClose = false;
  const uid = Number(userId);
  if (ticket && Number.isFinite(uid) && uid > 0) {
    const isCreator = Number(ticket.created_by) === uid;
    const isOwner = Number(ticket.owner_id) === uid;
    const relation = await db.get(
      `SELECT
         EXISTS(SELECT 1 FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?) AS assignee_hit,
         EXISTS(SELECT 1 FROM ticket_watchers WHERE ticket_id = ? AND user_id = ?) AS watcher_hit`,
      [id, uid, id, uid]
    );
    const isAssignee = Number(relation?.assignee_hit || 0) === 1;
    const isWatcher = Number(relation?.watcher_hit || 0) === 1;
    const projectPerm = await getProjectPermissionFlags(ticket.project_id, uid);

    canView =
      isCreator ||
      isOwner ||
      isAssignee ||
      isWatcher ||
      projectPerm.can_view ||
      projectPerm.can_edit ||
      projectPerm.can_assign ||
      projectPerm.can_close;
    canEdit = isCreator || isOwner || isAssignee || projectPerm.can_edit || projectPerm.can_assign || projectPerm.can_close;
    canAssign = isCreator || isOwner || projectPerm.can_assign || projectPerm.can_close;
    canClose = isCreator || isOwner || projectPerm.can_close;
    related = canView;
  }
  return {
    ticket_id: id,
    ticket_exists: !!ticket,
    ticket_created_by: ticket ? Number(ticket.created_by) : null,
    ticket_owner_id: ticket ? Number(ticket.owner_id || 0) : null,
    ticket_project_id: ticket ? Number(ticket.project_id || 0) : null,
    ticket_can_view: canView,
    ticket_can_edit: canEdit,
    ticket_can_assign: canAssign,
    ticket_can_close: canClose,
    ticket_related: related,
  };
};

const getProjectAuthResource = async (projectId, userId, isAdmin) => {
  const id = Number(projectId);
  if (!Number.isFinite(id)) return { project_id: projectId, project_exists: false, project_has_owned_tickets: false };
  const project = await db.get('SELECT id FROM projects WHERE id = ?', [id]);
  if (!project) return { project_id: id, project_exists: false, project_has_owned_tickets: false };
  if (isAdmin) return { project_id: id, project_exists: true, project_has_owned_tickets: true };
  const uid = Number(userId);
  const count = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM tickets t
     WHERE t.project_id = ?
       AND (
         t.created_by = ?
         OR t.owner_id = ?
         OR EXISTS (SELECT 1 FROM ticket_assignees ta WHERE ta.ticket_id = t.id AND ta.user_id = ?)
         OR EXISTS (SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id = t.id AND tw.user_id = ?)
       )`,
    [id, uid, uid, uid, uid]
  );
  const perm = await getProjectPermissionFlags(id, uid);
  return {
    project_id: id,
    project_exists: true,
    project_has_owned_tickets:
      Number(count?.cnt || 0) > 0 ||
      perm.can_view ||
      perm.can_edit ||
      perm.can_assign ||
      perm.can_close,
    project_can_view: perm.can_view || perm.can_edit || perm.can_assign || perm.can_close,
    project_can_edit: perm.can_edit || perm.can_assign || perm.can_close,
    project_can_assign: perm.can_assign || perm.can_close,
    project_can_close: perm.can_close,
  };
};

const formatDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const stableStringify = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

const computeAuditSignature = ({ id, prevHash, userId, username, action, entity, entityId, beforeData, afterData, createdAt }) => {
  const payload = [
    String(id),
    String(prevHash || ''),
    String(userId || 0),
    String(username || ''),
    String(action || ''),
    String(entity || ''),
    String(entityId || 0),
    String(beforeData || ''),
    String(afterData || ''),
    String(createdAt || ''),
  ].join('|');
  return crypto.createHmac('sha256', AUDIT_SIGNING_KEY).update(payload).digest('hex');
};

const stringifyAuditData = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return stableStringify(value);
  } catch (err) {
    return String(value);
  }
};

const getClientIp = (req) => {
  return String(extractRequestIp(req) || '');
};

const buildAuditRequestMeta = (req) => ({
  系统: '工单管理系统',
  接口: `${req.method} ${req.originalUrl.split('?')[0]}`,
  请求IP: getClientIp(req),
  用户代理: String(req.headers['user-agent'] || ''),
});

const logOperation = async ({ user, action, entity, entityId, beforeData, afterData, system = 'ticketing' }) => {
  const userId = Number(user?.id) || null;
  const username = user?.username || null;
  const logSystem = String(system || 'ticketing').trim() || 'ticketing';
  const sourceIp = String(user?.request_ip || user?.requestIp || '').trim() || null;
  const beforeText = stringifyAuditData(beforeData);
  const afterText = stringifyAuditData(afterData);
  const createdAt = formatDateTime(new Date());
  await db.transaction(async (trx) => {
    const prev = await trx.get('SELECT signature FROM operation_logs ORDER BY id DESC LIMIT 1 FOR UPDATE');
    const prevHash = prev?.signature || '';
    const inserted = await trx.run(
      `INSERT INTO operation_logs
         (user_id, username, log_system, action, entity, entity_id, before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, username, logSystem, action, entity, entityId, beforeText, afterText, prevHash, null, 'v1', sourceIp, createdAt]
    );
    const signature = computeAuditSignature({
      id: inserted.insertId,
      prevHash,
      userId,
      username,
      action,
      entity,
      entityId,
      beforeData: beforeText,
      afterData: afterText,
      createdAt,
    });
    await trx.run('UPDATE operation_logs SET signature = ? WHERE id = ?', [signature, inserted.insertId]);
  });
};

const toTicketActionZh = (type, fallback = '更新') => {
  const map = {
    CREATED: '创建',
    UPDATED: '更新',
    DELETED: '删除',
    APPROVAL_APPROVED: '审批通过',
    APPROVAL_REJECTED: '审批驳回',
    ASSIGNEE_CHANGED: '更新协作人',
    WATCHER_CHANGED: '更新观察者',
    COMMENT_ADDED: '新增评论',
    SCHEDULE_CREATED: '新增排期',
    STAGE_STATUS_CHANGED: '更新阶段状态',
    STAGES_REGENERATED: '从模板生成阶段',
    DELIVERABLE_UPDATED: '更新交付物',
    ATTACHMENT_UPLOADED: '上传附件',
    ATTACHMENT_DELETED: '删除附件',
  };
  return map[String(type || '').toUpperCase()] || fallback;
};

const normalizeDateInput = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;
  return formatDateTime(text);
};

const normalizeText = (value) => String(value === undefined || value === null ? '' : value).trim();
const toNullable = (value) => {
  const text = normalizeText(value);
  return text ? text : null;
};
const toPositiveInt = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};
const plusMinutes = (base, minutes) => {
  const m = toPositiveInt(minutes, 0);
  return new Date(base.getTime() + m * 60 * 1000);
};

const sanitizeFilename = (value) => {
  const base = String(value || '').trim() || 'attachment';
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  const fallback = cleaned || 'attachment';
  let result = '';
  for (const ch of fallback) {
    if (Buffer.byteLength(result + ch, 'utf8') > 240) break;
    result += ch;
  }
  return result || 'attachment';
};

const normalizeMimeType = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'application/octet-stream';
  return text.slice(0, 128);
};

const uploadTicketAttachment = (req, res, next) => {
  attachmentUpload.single('attachment')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = Math.max(1, Math.floor((TICKET_ATTACHMENT_MAX_BYTES || 0) / (1024 * 1024)));
      return res.status(400).json({ error: `附件大小不能超过 ${maxMb}MB` });
    }
    return res.status(400).json({ error: '附件上传失败，请检查文件后重试' });
  });
};

const escapeCsv = (value) => {
  const rawText = String(value === undefined || value === null ? '' : value);
  const ltrim = rawText.replace(/^[\s\r\n\t]+/, '');
  const text = /^[=+\-@]/.test(ltrim) ? `'${rawText}` : rawText;
  return `"${text.replace(/"/g, '""')}"`;
};

const parseMentions = async (content) => {
  const names = new Set();
  const regex = /@([a-zA-Z0-9_\u4e00-\u9fa5\-]+)/g;
  let match = regex.exec(content);
  while (match) {
    names.add(match[1]);
    match = regex.exec(content);
  }
  if (!names.size) return [];
  const rows = await db.query(
    `SELECT id, username
     FROM users
     WHERE username IN (${Array.from(names).map(() => '?').join(',')})`,
    Array.from(names)
  );
  return rows.map((row) => ({ id: Number(row.id), username: row.username }));
};

const notifyUsers = async ({ userIds, ticketId, eventType, title, content }) => {
  const ids = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).map((item) => Number(item)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (!ids.length || !Number.isFinite(Number(ticketId))) return;
  const values = ids.map(() => '(?, ?, ?, ?, ?)').join(',');
  const params = [];
  ids.forEach((userId) => {
    params.push(userId, Number(ticketId), String(eventType || 'NOTICE'), String(title || '通知'), content ? String(content) : null);
  });
  await db.run(
    `INSERT INTO ticket_notifications (user_id, ticket_id, event_type, title, content)
     VALUES ${values}`,
    params
  );
};

const permissionFlagKeys = ['can_view', 'can_edit', 'can_assign', 'can_close'];
const permissionFlagLabels = {
  can_view: '可见',
  can_edit: '可编辑',
  can_assign: '可分派',
  can_close: '可关闭',
};

const toPermissionBool = (value) => value === true || Number(value) === 1;

const normalizePermissionRow = (row) => ({
  user_id: Number(row.user_id),
  username: row.username || `用户#${row.user_id}`,
  role: row.role || null,
  can_view: toPermissionBool(row.can_view),
  can_edit: toPermissionBool(row.can_edit),
  can_assign: toPermissionBool(row.can_assign),
  can_close: toPermissionBool(row.can_close),
});

const permissionFlagsToText = (row) => {
  const labels = permissionFlagKeys
    .filter((key) => row[key])
    .map((key) => permissionFlagLabels[key]);
  return labels.length ? labels.join('/') : '无权限';
};

const toPermissionLogTypeZh = (value) => {
  const text = String(value || '').trim();
  if (!text) return '权限更新';
  if (text === 'PERMISSION_UPDATED' || text === 'UPDATED' || text === '权限更新') return '权限更新';
  return text;
};

const toPermissionLogDescZh = (value) => {
  const text = String(value || '').trim();
  if (!text) return '项目权限更新';
  if (/update project permissions/i.test(text)) return '项目权限更新';
  return text;
};

const buildPermissionDiffSummary = ({ beforeRows, afterRows }) => {
  const beforeList = (beforeRows || []).map(normalizePermissionRow);
  const afterList = (afterRows || []).map(normalizePermissionRow);
  const beforeMap = new Map(beforeList.map((item) => [item.user_id, item]));
  const afterMap = new Map(afterList.map((item) => [item.user_id, item]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const afterItem of afterList) {
    const beforeItem = beforeMap.get(afterItem.user_id);
    if (!beforeItem) {
      added.push(afterItem);
      continue;
    }
    const diffs = [];
    permissionFlagKeys.forEach((key) => {
      if (beforeItem[key] !== afterItem[key]) {
        diffs.push({
          key,
          label: permissionFlagLabels[key],
          before: beforeItem[key],
          after: afterItem[key],
        });
      }
    });
    if (diffs.length) {
      changed.push({
        user_id: afterItem.user_id,
        username: afterItem.username,
        role: afterItem.role,
        changes: diffs,
      });
    }
  }

  for (const beforeItem of beforeList) {
    if (!afterMap.has(beforeItem.user_id)) {
      removed.push(beforeItem);
    }
  }

  const parts = [];
  if (added.length) {
    parts.push(
      `新增成员：${added
        .map((item) => `${item.username}（${permissionFlagsToText(item)}）`)
        .join('、')}`
    );
  }
  if (removed.length) {
    parts.push(`移除成员：${removed.map((item) => item.username).join('、')}`);
  }
  if (changed.length) {
    parts.push(
      `权限调整：${changed
        .map(
          (item) =>
            `${item.username}（${item.changes
              .map((change) => `${change.label}${change.before ? '是' : '否'}→${change.after ? '是' : '否'}`)
              .join('，')}）`
        )
        .join('；')}`
    );
  }

  const summary = parts.length ? parts.join('；') : '项目权限无变化';
  return {
    summary,
    detail: {
      added,
      removed,
      changed,
      before_count: beforeList.length,
      after_count: afterList.length,
    },
  };
};

const calcTicketSlaStatus = (ticket) => {
  const now = Date.now();
  const nearMs = 24 * 60 * 60 * 1000;
  const responseDeadline = parseDate(ticket.response_deadline);
  const resolveDeadline = parseDate(ticket.resolve_deadline);
  const respondedAt = parseDate(ticket.responded_at);
  const resolvedAt = parseDate(ticket.resolved_at);

  const responseBreached =
    responseDeadline && !respondedAt && responseDeadline.getTime() < now;
  const resolveBreached =
    resolveDeadline && !resolvedAt && resolveDeadline.getTime() < now;
  if (responseBreached || resolveBreached) return 'BREACHED';

  const responseNear =
    responseDeadline &&
    !respondedAt &&
    responseDeadline.getTime() >= now &&
    responseDeadline.getTime() <= now + nearMs;
  const resolveNear =
    resolveDeadline &&
    !resolvedAt &&
    resolveDeadline.getTime() >= now &&
    resolveDeadline.getTime() <= now + nearMs;
  if (responseNear || resolveNear) return 'NEAR_DUE';

  const responseOnTime =
    !responseDeadline || !respondedAt || respondedAt.getTime() <= responseDeadline.getTime();
  const resolveOnTime =
    !resolveDeadline || !resolvedAt || resolvedAt.getTime() <= resolveDeadline.getTime();
  if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && responseOnTime && resolveOnTime) {
    return 'ON_TIME';
  }
  return 'PENDING';
};

const decorateTicket = (ticket) => ({
  ...ticket,
  sla_status: calcTicketSlaStatus(ticket),
});

const syncTicketSlaLogs = async (ticketId) => {
  const ticket = await db.get(
    `SELECT id, response_deadline, resolve_deadline, responded_at, resolved_at
     FROM tickets WHERE id = ?`,
    [ticketId]
  );
  if (!ticket) return;

  const now = formatDateTime(new Date());
  const rules = [
    { type: 'RESPONSE', deadline: ticket.response_deadline, actual: ticket.responded_at },
    { type: 'RESOLVE', deadline: ticket.resolve_deadline, actual: ticket.resolved_at },
  ];

  for (const item of rules) {
    if (!item.deadline) continue;
    const deadlineDate = parseDate(item.deadline);
    const actualDate = parseDate(item.actual);
    let status = 'PENDING';
    let breachedAt = null;
    if (actualDate && deadlineDate && actualDate.getTime() <= deadlineDate.getTime()) {
      status = 'ON_TIME';
    } else if (actualDate && deadlineDate && actualDate.getTime() > deadlineDate.getTime()) {
      status = 'BREACHED';
      breachedAt = formatDateTime(actualDate);
    } else if (deadlineDate && deadlineDate.getTime() < Date.now()) {
      status = 'BREACHED';
      breachedAt = now;
    }
    const existing = await db.get(
      'SELECT id FROM ticket_sla_logs WHERE ticket_id = ? AND sla_type = ? ORDER BY id DESC LIMIT 1',
      [ticketId, item.type]
    );
    if (existing) {
      await db.run(
        `UPDATE ticket_sla_logs
         SET deadline_at = ?, breached_at = ?, status = ?, updated_at = NOW()
         WHERE id = ?`,
        [item.deadline, breachedAt, status, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO ticket_sla_logs (ticket_id, sla_type, deadline_at, breached_at, status)
         VALUES (?, ?, ?, ?, ?)`,
        [ticketId, item.type, item.deadline, breachedAt, status]
      );
    }
  }
};

const logTicketEvent = async ({ ticketId, type, desc, before, after, user, req }) => {
  await db.run(
    `INSERT INTO ticket_events
      (ticket_id, event_type, event_desc, before_json, after_json, operator_id, operator_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      ticketId,
      String(type || 'UPDATED'),
      String(desc || ''),
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      user?.id || null,
      user?.username || null,
    ]
  );
  try {
    const action = toTicketActionZh(type, '更新');
    await logOperation({
      user,
      action,
      entity: '工单',
      entityId: Number(ticketId) || null,
      beforeData: {
        工单ID: Number(ticketId) || null,
        事件类型: String(type || 'UPDATED'),
        事件描述: String(desc || ''),
        变更前: before || null,
      },
      afterData: {
        工单ID: Number(ticketId) || null,
        事件类型: String(type || 'UPDATED'),
        事件描述: String(desc || ''),
        变更后: after || null,
        请求信息: req ? buildAuditRequestMeta(req) : null,
      },
    });
  } catch (error) {
    console.error('写入工单审计日志失败', error);
  }
};

const logProjectPermissionEvent = async ({ projectId, type, desc, before, after, user, req }) => {
  await db.run(
    `INSERT INTO ticket_project_permission_logs
      (project_id, operator_id, operator_name, event_type, event_desc, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(projectId),
      user?.id || null,
      user?.username || null,
      String(type || 'UPDATED'),
      String(desc || ''),
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ]
  );
  try {
    await logOperation({
      user,
      action: '更新项目权限',
      entity: '项目权限',
      entityId: Number(projectId) || null,
      beforeData: {
        项目ID: Number(projectId) || null,
        变更前: before || null,
      },
      afterData: {
        项目ID: Number(projectId) || null,
        操作类型: toPermissionLogTypeZh(type),
        操作描述: String(desc || ''),
        变更后: after || null,
        请求信息: req ? buildAuditRequestMeta(req) : null,
      },
    });
  } catch (error) {
    console.error('写入项目权限审计日志失败', error);
  }
};

const loadStageDeliverablesMap = async (stageIds) => {
  if (!stageIds.length) return new Map();
  const rows = await db.query(
    `SELECT id, stage_id, name, required_flag, done_flag, done_by, done_at
     FROM ticket_stage_deliverables
     WHERE stage_id IN (${stageIds.map(() => '?').join(',')})
     ORDER BY id ASC`,
    stageIds
  );
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.stage_id)) map.set(row.stage_id, []);
    map.get(row.stage_id).push(row);
  });
  return map;
};

const enrichStages = async (stages) => {
  const stageIds = stages.map((s) => Number(s.id)).filter((id) => Number.isFinite(id));
  const deliverablesMap = await loadStageDeliverablesMap(stageIds);
  return stages.map((stage) => {
    const deliverables = deliverablesMap.get(stage.id) || [];
    const total = deliverables.length;
    const done = deliverables.filter((item) => Number(item.done_flag) === 1).length;
    return {
      ...stage,
      deliverables,
      deliverable_total: total,
      deliverable_done: done,
      deliverable_progress: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  });
};

const refreshTicketCurrentStage = async (ticketId) => {
  const next = await db.get(
    `SELECT id
     FROM ticket_stages
     WHERE ticket_id = ? AND status <> 'DONE'
     ORDER BY stage_order ASC
     LIMIT 1`,
    [ticketId]
  );
  await db.run('UPDATE tickets SET current_stage_id = ?, updated_at = NOW() WHERE id = ?', [
    next ? next.id : null,
    ticketId,
  ]);
};

app.use('/api', ticketingApiRateLimiter, authMiddleware);

app.get('/api/projects', async (req, res) => {
  const authz = await authorize(req, { action: 'project:list' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });

  let rows = [];
  const readOnly = authz?.constraints?.readOnly === true;
  if (req.user.role === 'admin' || readOnly) {
    rows = await db.query('SELECT * FROM projects ORDER BY id DESC');
  } else {
    rows = await db.query(
      `SELECT DISTINCT p.*
       FROM projects p
       LEFT JOIN ticket_project_members tpm
         ON tpm.project_id = p.id
        AND tpm.user_id = ?
       WHERE
         (tpm.user_id IS NOT NULL AND (tpm.can_view = 1 OR tpm.can_edit = 1 OR tpm.can_assign = 1 OR tpm.can_close = 1))
         OR EXISTS (SELECT 1 FROM tickets t WHERE t.project_id = p.id AND t.created_by = ?)
         OR EXISTS (SELECT 1 FROM tickets t WHERE t.project_id = p.id AND t.owner_id = ?)
         OR EXISTS (
           SELECT 1
           FROM tickets t
           JOIN ticket_assignees ta ON ta.ticket_id = t.id
           WHERE t.project_id = p.id AND ta.user_id = ?
         )
         OR EXISTS (
           SELECT 1
           FROM tickets t
           JOIN ticket_watchers tw ON tw.ticket_id = t.id
           WHERE t.project_id = p.id AND tw.user_id = ?
         )
       ORDER BY p.id DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );
  }
  res.json(rows);
});

app.get('/api/departments', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:catalog' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const rows = await db.query(
    'SELECT code, name FROM departments WHERE is_active = 1 ORDER BY sort_order ASC, code ASC'
  );
  res.json(rows);
});

app.get('/api/service-catalog', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:catalog' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const where = ['is_active = 1'];
  const params = [];
  if (req.query.department_code) {
    where.push('department_code = ?');
    params.push(String(req.query.department_code));
  }
  const rows = await db.query(
    `SELECT code, department_code, name, default_template_code, default_priority, default_response_minutes, default_resolve_minutes
     FROM service_catalog
     WHERE ${where.join(' AND ')}
     ORDER BY department_code ASC, code ASC`,
    params
  );
  res.json(rows);
});

app.get('/api/templates', async (req, res) => {
  const authz = await authorize(req, { action: 'template:list' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const rows = await db.query('SELECT * FROM ticket_templates ORDER BY id DESC');
  res.json(rows);
});

app.get('/api/templates/:id', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'template:read' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const template = await db.get('SELECT * FROM ticket_templates WHERE id = ?', [id]);
  if (!template) return res.status(404).json({ error: '模板不存在' });
  const stages = await db.query(
    'SELECT * FROM ticket_template_stages WHERE template_id = ? ORDER BY stage_order ASC',
    [id]
  );
  for (const stage of stages) {
    stage.deliverables = await db.query(
      'SELECT name FROM ticket_template_deliverables WHERE stage_id = ?',
      [stage.id]
    );
    stage.roles = await db.query(
      'SELECT role_name FROM ticket_template_roles WHERE stage_id = ?',
      [stage.id]
    );
    stage.deliverables = stage.deliverables.map((item) => item.name);
    stage.roles = stage.roles.map((item) => item.role_name);
  }
  res.json({ ...template, stages });
});

app.post('/api/templates/import', async (req, res) => {
  const authz = await authorize(req, { action: 'template:import' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const payload = req.body || {};
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  if (templates.length === 0) return res.status(400).json({ error: '模板为空' });
  const inserted = [];
  const updated = [];
  await db.transaction(async (tx) => {
    for (const template of templates) {
      if (!template || !template.code || !template.name) continue;
      const code = String(template.code).trim();
      const name = String(template.name).trim();
      const description = String(template.description || '');
      const existing = await tx.get('SELECT id FROM ticket_templates WHERE code = ?', [code]);
      let templateId;
      if (existing) {
        templateId = existing.id;
        await tx.run('UPDATE ticket_templates SET name = ?, description = ? WHERE id = ?', [
          name,
          description,
          templateId,
        ]);
        await tx.run(
          `DELETE d FROM ticket_template_deliverables d
           JOIN ticket_template_stages s ON d.stage_id = s.id
           WHERE s.template_id = ?`,
          [templateId]
        );
        await tx.run(
          `DELETE r FROM ticket_template_roles r
           JOIN ticket_template_stages s ON r.stage_id = s.id
           WHERE s.template_id = ?`,
          [templateId]
        );
        await tx.run('DELETE FROM ticket_template_stages WHERE template_id = ?', [templateId]);
        updated.push({ id: templateId, code, name });
      } else {
        const info = await tx.run(
          'INSERT INTO ticket_templates (code, name, description) VALUES (?, ?, ?)',
          [code, name, description]
        );
        templateId = info.insertId;
        inserted.push({ id: templateId, code, name });
      }
      const stages = Array.isArray(template.stages) ? template.stages : [];
      let order = 1;
      for (const stage of stages) {
        if (!stage || !stage.name) continue;
        const stageInfo = await tx.run(
          'INSERT INTO ticket_template_stages (template_id, name, duration_days, stage_order) VALUES (?, ?, ?, ?)',
          [templateId, String(stage.name), Number(stage.duration_days || 0), order]
        );
        const stageId = stageInfo.insertId;
        const deliverables = Array.isArray(stage.deliverables) ? stage.deliverables : [];
        for (const item of deliverables) {
          if (!item) continue;
          await tx.run(
            'INSERT INTO ticket_template_deliverables (stage_id, name) VALUES (?, ?)',
            [stageId, String(item)]
          );
        }
        const roles = Array.isArray(stage.roles) ? stage.roles : [];
        for (const role of roles) {
          if (!role) continue;
          await tx.run(
            'INSERT INTO ticket_template_roles (stage_id, role_name) VALUES (?, ?)',
            [stageId, String(role)]
          );
        }
        order += 1;
      }
    }
  });
  try {
    await logOperation({
      user: req.user,
      action: '导入模板',
      entity: '工单模板',
      entityId: null,
      beforeData: {
        导入模板数量: templates.length,
      },
      afterData: {
        新增模板: inserted,
        更新模板: updated,
        请求信息: buildAuditRequestMeta(req),
      },
    });
  } catch (error) {
    console.error('写入模板导入审计日志失败', error);
  }
  res.json({ ok: true, inserted, updated });
});

app.post('/api/projects', async (req, res) => {
  const authz = await authorize(req, { action: 'project:create' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });
  const info = await db.run(
    'INSERT INTO projects (name, description) VALUES (?, ?)',
    [String(name), String(description || '')]
  );
  const row = await db.get('SELECT * FROM projects WHERE id = ?', [info.insertId]);
  try {
    await logOperation({
      user: req.user,
      action: '创建项目',
      entity: '项目',
      entityId: Number(row?.id) || null,
      beforeData: null,
      afterData: {
        项目数据: row,
        请求信息: buildAuditRequestMeta(req),
      },
    });
  } catch (error) {
    console.error('写入项目创建审计日志失败', error);
  }
  res.json(row);
});

app.put('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:update', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const { name, description } = req.body || {};
  const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  await db.run(
    'UPDATE projects SET name = ?, description = ? WHERE id = ?',
    [name !== undefined ? String(name) : project.name, description !== undefined ? String(description) : project.description, id]
  );
  const row = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  try {
    await logOperation({
      user: req.user,
      action: '更新项目',
      entity: '项目',
      entityId: Number(id),
      beforeData: {
        项目数据: project,
      },
      afterData: {
        项目数据: row,
        请求信息: buildAuditRequestMeta(req),
      },
    });
  } catch (error) {
    console.error('写入项目更新审计日志失败', error);
  }
  res.json(row);
});

app.delete('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:delete', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  await db.run('DELETE FROM projects WHERE id = ?', [id]);
  try {
    await logOperation({
      user: req.user,
      action: '删除项目',
      entity: '项目',
      entityId: Number(id),
      beforeData: {
        项目数据: project,
      },
      afterData: {
        删除结果: '已删除',
        请求信息: buildAuditRequestMeta(req),
      },
    });
  } catch (error) {
    console.error('写入项目删除审计日志失败', error);
  }
  res.json({ ok: true });
});

app.get('/api/projects/:id/permissions', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:permissions:read', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const project = await db.get('SELECT id, name FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const rows = await db.query(
    `SELECT
       p.project_id,
       p.user_id,
       p.can_view,
       p.can_edit,
       p.can_assign,
       p.can_close,
       u.username,
       u.role
     FROM ticket_project_members p
     JOIN users u ON u.id = p.user_id
     WHERE p.project_id = ?
     ORDER BY u.username ASC`,
    [id]
  );
  res.json({
    project,
    members: rows.map((row) => ({
      user_id: Number(row.user_id),
      username: row.username,
      role: row.role,
      can_view: Number(row.can_view) === 1,
      can_edit: Number(row.can_edit) === 1,
      can_assign: Number(row.can_assign) === 1,
      can_close: Number(row.can_close) === 1,
    })),
  });
});

app.put('/api/projects/:id/permissions', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:update', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const project = await db.get('SELECT id, name FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const beforeRows = await db.query(
    `SELECT
       p.user_id,
       p.can_view,
       p.can_edit,
       p.can_assign,
       p.can_close,
       u.username,
       u.role
     FROM ticket_project_members p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.project_id = ?
     ORDER BY p.user_id ASC`,
    [id]
  );

  const input = Array.isArray(req.body?.members) ? req.body.members : [];
  const seen = new Set();
  const members = [];
  for (const item of input) {
    const userId = Number(item?.user_id);
    if (!Number.isFinite(userId) || userId <= 0) continue;
    const key = String(userId);
    if (seen.has(key)) continue;
    seen.add(key);
    const canView = item?.can_view === true || Number(item?.can_view) === 1;
    const canEdit = item?.can_edit === true || Number(item?.can_edit) === 1;
    const canAssign = item?.can_assign === true || Number(item?.can_assign) === 1;
    const canClose = item?.can_close === true || Number(item?.can_close) === 1;
    members.push({
      user_id: userId,
      can_view: canView || canEdit || canAssign || canClose,
      can_edit: canEdit || canAssign || canClose,
      can_assign: canAssign || canClose,
      can_close: canClose,
    });
  }

  const afterRowsForLog = members
    .slice()
    .sort((a, b) => Number(a.user_id) - Number(b.user_id))
    .map((row) => ({
      ...row,
      username: null,
      role: null,
    }));
  const userIdsForLog = afterRowsForLog.map((row) => row.user_id);
  if (userIdsForLog.length) {
    const usersForLog = await db.query(
      `SELECT id, username, role FROM users WHERE id IN (${userIdsForLog.map(() => '?').join(',')})`,
      userIdsForLog
    );
    const userMap = new Map(usersForLog.map((item) => [Number(item.id), item]));
    afterRowsForLog.forEach((row) => {
      const info = userMap.get(Number(row.user_id));
      row.username = info?.username || `用户#${row.user_id}`;
      row.role = info?.role || null;
    });
  }
  const diff = buildPermissionDiffSummary({
    beforeRows,
    afterRows: afterRowsForLog,
  });
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM ticket_project_members WHERE project_id = ?', [id]);
    for (const member of members) {
      await tx.run(
        `INSERT INTO ticket_project_members
          (project_id, user_id, can_view, can_edit, can_assign, can_close)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          Number(id),
          member.user_id,
          member.can_view ? 1 : 0,
          member.can_edit ? 1 : 0,
          member.can_assign ? 1 : 0,
          member.can_close ? 1 : 0,
        ]
      );
    }
  });

  await logProjectPermissionEvent({
    projectId: id,
    type: '权限更新',
    desc: diff.summary.length > 240 ? `${diff.summary.slice(0, 237)}...` : diff.summary,
    before: (beforeRows || []).map(normalizePermissionRow),
    after: {
      members: afterRowsForLog,
      diff: diff.detail,
    },
    user: req.user,
    req,
  });

  res.json({ ok: true, count: members.length });
});

app.get('/api/projects/:id/permissions/logs', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:permissions:read', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const project = await db.get('SELECT id FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const where = ['project_id = ?'];
  const params = [id];
  if (req.query.event_type) {
    const eventType = String(req.query.event_type || '').trim();
    if (eventType === '权限更新' || eventType.toUpperCase() === 'PERMISSION_UPDATED' || eventType.toUpperCase() === 'UPDATED') {
      where.push("(event_type = '权限更新' OR event_type = 'PERMISSION_UPDATED' OR event_type = 'UPDATED')");
    } else {
      where.push('event_type = ?');
      params.push(eventType);
    }
  }
  if (req.query.operator) {
    where.push('operator_name LIKE ?');
    params.push(`%${String(req.query.operator).trim()}%`);
  }
  if (req.query.from) {
    where.push('created_at >= ?');
    params.push(normalizeDateInput(req.query.from));
  }
  if (req.query.to) {
    where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(normalizeDateInput(req.query.to));
  }
  const rows = await db.query(
    `SELECT
       id, project_id, operator_id, operator_name, event_type, event_desc,
       before_json, after_json,
       CASE
         WHEN JSON_VALID(after_json) THEN JSON_UNQUOTE(JSON_EXTRACT(after_json, '$."请求信息"."请求IP"'))
         ELSE NULL
       END AS source_ip,
       created_at
     FROM ticket_project_permission_logs
     WHERE ${where.join(' AND ')}
     ORDER BY id DESC
     LIMIT 500`,
    params
  );
  res.json(
    rows.map((row) => ({
      ...row,
      event_type: toPermissionLogTypeZh(row.event_type),
      event_desc: toPermissionLogDescZh(row.event_desc),
    }))
  );
});

app.get('/api/projects/:id/permissions/logs/export', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:permissions:read', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const project = await db.get('SELECT id, name FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const where = ['project_id = ?'];
  const params = [id];
  if (req.query.event_type) {
    const eventType = String(req.query.event_type || '').trim();
    if (eventType === '权限更新' || eventType.toUpperCase() === 'PERMISSION_UPDATED' || eventType.toUpperCase() === 'UPDATED') {
      where.push("(event_type = '权限更新' OR event_type = 'PERMISSION_UPDATED' OR event_type = 'UPDATED')");
    } else {
      where.push('event_type = ?');
      params.push(eventType);
    }
  }
  if (req.query.operator) {
    where.push('operator_name LIKE ?');
    params.push(`%${String(req.query.operator).trim()}%`);
  }
  if (req.query.from) {
    where.push('created_at >= ?');
    params.push(normalizeDateInput(req.query.from));
  }
  if (req.query.to) {
    where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(normalizeDateInput(req.query.to));
  }
  const rows = await db.query(
    `SELECT
       id, event_type, event_desc, operator_name,
       CASE
         WHEN JSON_VALID(after_json) THEN JSON_UNQUOTE(JSON_EXTRACT(after_json, '$."请求信息"."请求IP"'))
         ELSE NULL
       END AS source_ip,
       created_at
     FROM ticket_project_permission_logs
     WHERE ${where.join(' AND ')}
     ORDER BY id DESC
     LIMIT 5000`,
    params
  );
  const header = ['日志ID', '项目ID', '项目名称', '类型', '内容', '操作人', '来源IP', '时间'];
  const lines = [
    header.map(escapeCsv).join(','),
    ...rows.map((row) =>
      [
        row.id,
        id,
        project.name || '-',
        toPermissionLogTypeZh(row.event_type),
        toPermissionLogDescZh(row.event_desc),
        row.operator_name || '-',
        row.source_ip || '-',
        formatDateTime(row.created_at),
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];
  const filename = `project-${id}-permission-logs-${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join('\n')}`);
});

app.get('/api/tickets', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:list' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const {
    status,
    search,
    department_code: departmentCode,
    service_code: serviceCode,
    severity,
    sla_status: slaStatus,
    owner_id: ownerId,
    created_from: createdFrom,
    created_to: createdTo,
    tags,
    limit,
  } = req.query;
  const where = [];
  const params = [];
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (req.query.project_id) {
    where.push('t.project_id = ?');
    params.push(req.query.project_id);
  }
  if (search) {
    const like = `%${String(search).trim()}%`;
    where.push(
      '(t.title LIKE ? OR t.description LIKE ? OR t.customer_name LIKE ? OR t.requester_name LIKE ? OR t.requester_phone LIKE ? OR t.requester_email LIKE ?)'
    );
    params.push(like, like, like, like, like, like);
  }
  if (departmentCode) {
    where.push('t.department_code = ?');
    params.push(String(departmentCode));
  }
  if (serviceCode) {
    where.push('t.service_code = ?');
    params.push(String(serviceCode));
  }
  if (severity) {
    where.push('t.severity = ?');
    params.push(String(severity));
  }
  if (ownerId) {
    where.push('t.owner_id = ?');
    params.push(Number(ownerId));
  }
  if (createdFrom) {
    where.push('t.created_at >= ?');
    params.push(normalizeDateInput(createdFrom));
  }
  if (createdTo) {
    where.push('t.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(normalizeDateInput(createdTo));
  }
  if (tags) {
    const normalizedTags = String(tags)
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (normalizedTags.length) {
      const tagWhere = normalizedTags.map(() => 't.tags_json LIKE ?').join(' OR ');
      where.push(`(${tagWhere})`);
      normalizedTags.forEach((tag) => params.push(`%${tag}%`));
    }
  }
  if (slaStatus === 'BREACHED') {
    where.push(
      '((t.responded_at IS NULL AND t.response_deadline IS NOT NULL AND t.response_deadline < NOW()) OR (t.resolved_at IS NULL AND t.resolve_deadline IS NOT NULL AND t.resolve_deadline < NOW()))'
    );
  } else if (slaStatus === 'NEAR_DUE') {
    where.push(
      '((t.responded_at IS NULL AND t.response_deadline BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)) OR (t.resolved_at IS NULL AND t.resolve_deadline BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)))'
    );
  } else if (slaStatus === 'ON_TIME') {
    where.push(
      "(t.status IN ('RESOLVED','CLOSED') AND (t.response_deadline IS NULL OR t.responded_at IS NULL OR t.responded_at <= t.response_deadline) AND (t.resolve_deadline IS NULL OR t.resolved_at IS NULL OR t.resolved_at <= t.resolve_deadline))"
    );
  } else if (slaStatus === 'PENDING') {
    where.push(
      "(t.status NOT IN ('RESOLVED','CLOSED') AND ((t.response_deadline IS NULL OR t.responded_at IS NOT NULL OR t.response_deadline >= NOW()) AND (t.resolve_deadline IS NULL OR t.resolved_at IS NOT NULL OR t.resolve_deadline >= NOW())))"
    );
  }
  if (authz.constraints?.ownOnly) {
    const scope = buildTicketVisibility(req.user, 't');
    where.push(scope.sql);
    params.push(...scope.params);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const take = Math.min(Math.max(Number(limit || 200), 1), Math.max(50, TICKETING_LIST_MAX_LIMIT));
  const rows = await db.query(
    `SELECT t.*, owner.username AS owner_name
     FROM tickets t
     LEFT JOIN users owner ON owner.id = t.owner_id
     ${whereSql}
     ORDER BY t.id DESC
     LIMIT ?`,
    [...params, take]
  );
  res.json(rows.map(decorateTicket));
});

app.get('/api/dashboard/department', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:dashboard' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const scope = authz.constraints?.ownOnly ? buildTicketVisibility(req.user, 't') : { sql: '1=1', params: [] };
  const ownFilter = authz.constraints?.ownOnly ? ` AND ${scope.sql}` : '';
  const rows = await db.query(
    `SELECT
        d.code,
        d.name,
        COUNT(t.id) AS total_count,
        SUM(CASE WHEN t.status IN ('OPEN','ACCEPTED','IN_PROGRESS','WAIT_VERIFY') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN t.status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS closed_count,
        SUM(
          CASE WHEN t.status NOT IN ('RESOLVED','CLOSED')
              AND (
                (t.responded_at IS NULL AND t.response_deadline BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR))
                OR
                (t.resolved_at IS NULL AND t.resolve_deadline BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR))
              )
          THEN 1 ELSE 0 END
        ) AS near_due_count,
        SUM(
          CASE WHEN t.resolve_deadline IS NOT NULL
              AND t.resolved_at IS NULL
              AND t.resolve_deadline < NOW()
          THEN 1 ELSE 0 END
        ) AS breached_count
     FROM departments d
     LEFT JOIN tickets t ON t.department_code = d.code${ownFilter}
     WHERE d.is_active = 1
     GROUP BY d.code, d.name
     ORDER BY d.sort_order ASC, d.code ASC`,
    scope.params
  );
  res.json(rows);
});

app.get('/api/dashboard/sla-groups', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:dashboard' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const visibility = authz.constraints?.ownOnly ? buildTicketVisibility(req.user, 't') : { sql: '1=1', params: [] };
  const baseParams = [...visibility.params];
  const selectSql = `SELECT t.*, owner.username AS owner_name
     FROM tickets t
     LEFT JOIN users owner ON owner.id = t.owner_id
     WHERE ${visibility.sql} AND `;
  const nearDueRows = await db.query(
    `${selectSql}
      (
        (t.responded_at IS NULL AND t.response_deadline BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR))
        OR
        (t.resolved_at IS NULL AND t.resolve_deadline BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR))
      )
     ORDER BY COALESCE(t.response_deadline, t.resolve_deadline) ASC
     LIMIT 100`,
    baseParams
  );
  const breachedRows = await db.query(
    `${selectSql}
      (
        (t.responded_at IS NULL AND t.response_deadline IS NOT NULL AND t.response_deadline < NOW())
        OR
        (t.resolved_at IS NULL AND t.resolve_deadline IS NOT NULL AND t.resolve_deadline < NOW())
      )
     ORDER BY COALESCE(t.resolve_deadline, t.response_deadline) ASC
     LIMIT 100`,
    baseParams
  );
  res.json({
    near_due: nearDueRows.map(decorateTicket),
    breached: breachedRows.map(decorateTicket),
  });
});

app.get('/api/reports/summary', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:dashboard' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const where = [];
  const params = [];
  if (req.query.project_id) {
    where.push('t.project_id = ?');
    params.push(Number(req.query.project_id));
  }
  if (req.query.owner_id) {
    where.push('t.owner_id = ?');
    params.push(Number(req.query.owner_id));
  }
  if (req.query.department_code) {
    where.push('t.department_code = ?');
    params.push(String(req.query.department_code));
  }
  if (req.query.service_code) {
    where.push('t.service_code = ?');
    params.push(String(req.query.service_code));
  }
  if (req.query.status) {
    where.push('t.status = ?');
    params.push(String(req.query.status));
  }
  if (req.query.from) {
    where.push('t.created_at >= ?');
    params.push(normalizeDateInput(req.query.from));
  }
  if (req.query.to) {
    where.push('t.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(normalizeDateInput(req.query.to));
  }
  if (req.query.tags) {
    const normalizedTags = String(req.query.tags)
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (normalizedTags.length) {
      where.push(`(${normalizedTags.map(() => 't.tags_json LIKE ?').join(' OR ')})`);
      normalizedTags.forEach((tag) => params.push(`%${tag}%`));
    }
  }
  if (authz.constraints?.ownOnly) {
    const scope = buildTicketVisibility(req.user, 't');
    where.push(scope.sql);
    params.push(...scope.params);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const stat = await db.get(
    `SELECT
       COUNT(*) AS created_count,
       SUM(CASE WHEN t.status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS closed_count,
       AVG(
         CASE WHEN t.status IN ('RESOLVED','CLOSED')
          THEN TIMESTAMPDIFF(MINUTE, t.created_at, COALESCE(t.closed_at, t.resolved_at, t.updated_at))
          ELSE NULL END
       ) AS avg_resolve_minutes,
       SUM(
         CASE WHEN t.status IN ('RESOLVED','CLOSED')
             AND (t.response_deadline IS NULL OR t.responded_at IS NULL OR t.responded_at <= t.response_deadline)
             AND (t.resolve_deadline IS NULL OR t.resolved_at IS NULL OR t.resolved_at <= t.resolve_deadline)
          THEN 1 ELSE 0 END
       ) AS sla_on_time_count,
       SUM(CASE WHEN t.status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS sla_total_count
     FROM tickets t
     ${whereSql}`,
    params
  );
  const loadRows = await db.query(
    `SELECT
       COALESCE(u.username, CONCAT('用户#', t.owner_id)) AS owner_name,
       t.owner_id,
       COUNT(*) AS open_count
     FROM tickets t
     LEFT JOIN users u ON u.id = t.owner_id
     ${whereSql ? `${whereSql} AND` : 'WHERE'} t.status IN ('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'WAIT_VERIFY')
     GROUP BY t.owner_id, owner_name
     ORDER BY open_count DESC
     LIMIT 20`,
    params
  );
  const avgResolveHours = Number(stat?.avg_resolve_minutes || 0) / 60;
  const slaRate = Number(stat?.sla_total_count || 0) > 0
    ? (Number(stat?.sla_on_time_count || 0) / Number(stat?.sla_total_count || 0)) * 100
    : 0;
  res.json({
    throughput: {
      created: Number(stat?.created_count || 0),
      closed: Number(stat?.closed_count || 0),
    },
    avg_resolve_hours: Number.isFinite(avgResolveHours) ? Number(avgResolveHours.toFixed(1)) : 0,
    load_by_owner: loadRows.map((row) => ({
      owner_id: row.owner_id,
      owner_name: row.owner_name,
      open_count: Number(row.open_count || 0),
    })),
    sla: {
      on_time_count: Number(stat?.sla_on_time_count || 0),
      total_count: Number(stat?.sla_total_count || 0),
      rate: Number(slaRate.toFixed(1)),
    },
  });
});

app.get('/api/schedules', async (req, res) => {
  const { engineer_id: engineerId, from, to } = req.query;
  const authz = await authorize(req, {
    action: 'schedule:list',
    resource: { engineer_id: engineerId || req.user.id },
  });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  if (authz.constraints?.ownOnly) {
    const rows = await db.query(
      `SELECT * FROM schedules
       WHERE engineer_id = ?
         AND NOT (? <= start_at OR ? >= end_at)
       ORDER BY start_at ASC`,
      [req.user.id, to || '9999-12-31 23:59:59', from || '1970-01-01 00:00:00']
    );
    return res.json(rows);
  }
  if (!engineerId) return res.status(400).json({ error: '请指定工程师' });
  const rows = await db.query(
    `SELECT * FROM schedules
     WHERE engineer_id = ?
       AND NOT (? <= start_at OR ? >= end_at)
     ORDER BY start_at ASC`,
    [engineerId, to || '9999-12-31 23:59:59', from || '1970-01-01 00:00:00']
  );
  return res.json(rows);
});

app.get('/api/calendar/month', async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year/month 参数不合法' });
  }
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0);
  const monthEnd = new Date(year, month, 1, 0, 0, 0);
  const start = formatDateTime(monthStart);
  const end = formatDateTime(monthEnd);
  const params = [end, start];
  let where = 'WHERE NOT (? <= s.start_at OR ? >= s.end_at)';
  if (req.user.role !== 'admin') {
    where += ' AND s.engineer_id = ?';
    params.push(req.user.id);
  }
  const rows = await db.query(
    `SELECT s.id, s.engineer_id, s.ticket_id, s.start_at, s.end_at, u.username AS engineer_name, t.title AS ticket_title
     FROM schedules s
     LEFT JOIN users u ON u.id = s.engineer_id
     LEFT JOIN tickets t ON t.id = s.ticket_id
     ${where}
     ORDER BY s.start_at ASC`,
    params
  );
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayStart = new Date(year, month - 1, day, 0, 0, 0);
    const dayEnd = new Date(year, month - 1, day + 1, 0, 0, 0);
    const list = rows.filter((row) => {
      const s = new Date(row.start_at).getTime();
      const e = new Date(row.end_at).getTime();
      return s < dayEnd.getTime() && e > dayStart.getTime();
    });
    days.push({
      day,
      items: list.map((row) => ({
        schedule_id: row.id,
        engineer_id: row.engineer_id,
        engineer_name: row.engineer_name || `工程师${row.engineer_id}`,
        ticket_id: row.ticket_id,
        ticket_title: row.ticket_title || '-',
        start_at: formatDateTime(row.start_at),
        end_at: formatDateTime(row.end_at),
      })),
    });
  }
  return res.json({ year, month, days });
});

app.get('/api/projects/:id/gantt', async (req, res) => {
  const { id } = req.params;
  const projectResource = await getProjectAuthResource(id, req.user.id, req.user.role === 'admin');
  const authz = await authorize(req, { action: 'project:gantt', resource: projectResource });
  if (!authz.allow) {
    const code = authz.reason === '项目不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const visibility = req.user.role === 'admin' ? { sql: '1=1', params: [] } : buildTicketVisibility(req.user, 't');
  const tickets = await db.query(
    `SELECT t.*
     FROM tickets t
     WHERE t.project_id = ?
       AND ${visibility.sql}
     ORDER BY t.id DESC`,
    [id, ...visibility.params]
  );
  const ticketIds = tickets.map((t) => t.id);
  const schedules = ticketIds.length
    ? await db.query(
        `SELECT s.*, u.username AS engineer_name
         FROM schedules s
         LEFT JOIN users u ON u.id = s.engineer_id
         WHERE s.ticket_id IN (${ticketIds.map(() => '?').join(',')})
         ORDER BY s.start_at ASC`,
        ticketIds
      )
    : [];

  const tasks = [];
  const resources = [];
  const resourceMap = new Map();

  const scheduleByTicket = new Map();
  schedules.forEach((row) => {
    if (!scheduleByTicket.has(row.ticket_id)) scheduleByTicket.set(row.ticket_id, []);
    scheduleByTicket.get(row.ticket_id).push(row);
    if (!resourceMap.has(row.engineer_id)) {
      const name = row.engineer_name || `工程师${row.engineer_id}`;
      resourceMap.set(row.engineer_id, { id: row.engineer_id, name });
      resources.push({ id: row.engineer_id, name });
    }
  });

  tickets.forEach((ticket) => {
    const list = scheduleByTicket.get(ticket.id) || [];
    let startAt = null;
    let endAt = null;
    if (list.length) {
      startAt = list.reduce((min, item) => (min && min < item.start_at ? min : item.start_at), null);
      endAt = list.reduce((max, item) => (max && max > item.end_at ? max : item.end_at), null);
    } else {
      startAt = ticket.created_at;
      endAt = ticket.created_at;
    }
    tasks.push({
      id: `T-${ticket.id}`,
      name: `工单：${ticket.title}`,
      start: formatDateTime(startAt),
      end: formatDateTime(endAt),
      progress:
        ticket.status === 'CLOSED'
          ? 100
          : ticket.status === 'RESOLVED'
          ? 85
          : ticket.status === 'WAIT_VERIFY'
          ? 70
          : ticket.status === 'IN_PROGRESS'
          ? 50
          : ticket.status === 'ACCEPTED'
          ? 25
          : 10,
      custom_class: 'ticket',
      dependencies: '',
      assignees: list.map((item) => resourceMap.get(item.engineer_id)).filter(Boolean),
    });

    list.forEach((item) => {
      tasks.push({
        id: `S-${item.id}`,
        name: `${resourceMap.get(item.engineer_id)?.name || '工程师'} 排期：${ticket.title}`,
        start: formatDateTime(item.start_at),
        end: formatDateTime(item.end_at),
        progress: 100,
        custom_class: 'schedule',
        dependencies: `T-${ticket.id}`,
        assignees: resourceMap.get(item.engineer_id) ? [resourceMap.get(item.engineer_id)] : [],
      });
    });
  });

  return res.json({
    project_id: Number(id),
    project_name: project.name,
    tasks,
    resources,
  });
});

app.get('/api/users', async (req, res) => {
  const authz = await authorize(req, { action: 'user:list' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const rows = await db.query('SELECT id, username, role FROM users ORDER BY id DESC');
  res.json(rows);
});

app.post('/api/schedules', async (req, res) => {
  const { engineer_id: engineerId, ticket_id: ticketId, start_at: startAt, end_at: endAt, remark } = req.body || {};
  const error = validateSchedule(startAt, endAt);
  if (error) return res.status(400).json({ error });
  const targetEngineer = engineerId ? Number(engineerId) : Number(req.user.id);
  if (!targetEngineer) return res.status(400).json({ error: '工程师不能为空' });
  const ticketResource = ticketId ? await getTicketAuthResource(ticketId, req.user.id) : {};
  const authz = await authorize(req, {
    action: 'schedule:assign',
    resource: { engineer_id: targetEngineer, ...ticketResource },
  });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (ticketId && req.user.role !== 'admin' && ticketResource.ticket_can_assign !== true) {
    return res.status(403).json({ error: '无权为该工单排期' });
  }
  const conflict = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM schedules
     WHERE engineer_id = ?
       AND NOT (? <= start_at OR ? >= end_at)`,
    [targetEngineer, endAt, startAt]
  );
  if (conflict?.cnt > 0) return res.status(409).json({ error: '该工程师在此时间段已有排期' });
  const info = await db.run(
    `INSERT INTO schedules (engineer_id, ticket_id, start_at, end_at, remark)
     VALUES (?, ?, ?, ?, ?)`,
    [targetEngineer, ticketId || null, startAt, endAt, remark || null]
  );
  const row = await db.get('SELECT * FROM schedules WHERE id = ?', [info.insertId]);
  if (ticketId) {
    await logTicketEvent({
      ticketId: Number(ticketId),
      type: 'SCHEDULE_CREATED',
      desc: '新增排期',
      before: null,
      after: row,
      user: req.user,
      req,
    });
  } else {
    try {
      await logOperation({
        user: req.user,
        action: '创建排期',
        entity: '排期',
        entityId: Number(row?.id) || null,
        beforeData: null,
        afterData: {
          排期数据: row,
          请求信息: buildAuditRequestMeta(req),
        },
      });
    } catch (error) {
      console.error('写入排期审计日志失败', error);
    }
  }
  return res.json(row);
});

app.post('/api/tickets', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:create' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const payload = req.body || {};
  const title = normalizeText(payload.title);
  if (!title) return res.status(400).json({ error: '标题不能为空' });

  const serviceCode = toNullable(payload.service_code);
  const service = serviceCode
    ? await db.get(
        `SELECT code, department_code, default_priority, default_response_minutes, default_resolve_minutes
         FROM service_catalog WHERE code = ?`,
        [serviceCode]
      )
    : null;

  const priority = normalizeText(payload.priority || service?.default_priority || 'P2').toUpperCase();
  const severity = normalizeText(payload.severity || 'MEDIUM').toUpperCase();
  const status = 'OPEN';
  const ownerIdRaw = Number(payload.owner_id);
  const ownerId = Number.isFinite(ownerIdRaw) && ownerIdRaw > 0 ? ownerIdRaw : Number(req.user.id);
  const projectIdNum = Number(payload.project_id);
  const projectId = Number.isFinite(projectIdNum) && projectIdNum > 0 ? projectIdNum : null;
  if (req.user.role !== 'admin' && ownerId !== Number(req.user.id)) {
    const perm = await getProjectPermissionFlags(projectId, req.user.id);
    if (!perm.can_assign && !perm.can_close) {
      return res.status(403).json({ error: '无权将新工单分派给其他负责人' });
    }
  }
  const slaResponseMinutes = toPositiveInt(payload.sla_response_minutes, Number(service?.default_response_minutes || 30));
  const slaResolveMinutes = toPositiveInt(payload.sla_resolve_minutes, Number(service?.default_resolve_minutes || 480));
  const approvalRequired = isHighRiskTicket({
    priority: ['P1', 'P2', 'P3'].includes(priority) ? priority : 'P2',
    severity: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity) ? severity : 'MEDIUM',
  });
  const approvalStatus = approvalRequired ? 'PENDING' : 'NOT_REQUIRED';
  if (status === 'CLOSED' && approvalRequired) {
    return res.status(400).json({ error: '高风险工单需审批通过后才可关闭' });
  }
  const now = new Date();
  const nowSql = formatDateTime(now);
  const responseDeadline = formatDateTime(plusMinutes(now, slaResponseMinutes));
  const resolveDeadline = formatDateTime(plusMinutes(now, slaResolveMinutes));

  let acceptedAt = null;
  let respondedAt = null;
  let resolvedAt = null;
  let closedAt = null;
  if (status === 'ACCEPTED') {
    acceptedAt = nowSql;
  } else if (status === 'IN_PROGRESS') {
    acceptedAt = nowSql;
    respondedAt = nowSql;
  } else if (status === 'WAIT_VERIFY') {
    acceptedAt = nowSql;
    respondedAt = nowSql;
  } else if (status === 'RESOLVED') {
    acceptedAt = nowSql;
    respondedAt = nowSql;
    resolvedAt = nowSql;
  } else if (status === 'CLOSED') {
    acceptedAt = nowSql;
    respondedAt = nowSql;
    resolvedAt = nowSql;
    closedAt = nowSql;
  }

  const tags =
    Array.isArray(payload.tags) && payload.tags.length
      ? payload.tags.map((item) => normalizeText(item)).filter(Boolean)
      : [];
  const info = await db.run(
    `INSERT INTO tickets
      (title, description, status, priority, created_by, owner_id, project_id,
       department_code, service_code, ticket_type, source, customer_name,
       requester_name, requester_phone, requester_email, severity,
       sla_response_minutes, sla_resolve_minutes, response_deadline, resolve_deadline,
       accepted_at, responded_at, resolved_at, closed_at, tags_json,
       approval_required, approval_status, approval_by, approval_at, approval_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      String(payload.description || ''),
      status,
      ['P1', 'P2', 'P3'].includes(priority) ? priority : 'P2',
      req.user.id,
      ownerId,
      projectId,
      toNullable(payload.department_code) || service?.department_code || null,
      serviceCode,
      toNullable(payload.ticket_type) || 'SERVICE',
      toNullable(payload.source) || 'MANUAL',
      toNullable(payload.customer_name),
      toNullable(payload.requester_name),
      toNullable(payload.requester_phone),
      toNullable(payload.requester_email),
      ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity) ? severity : 'MEDIUM',
      slaResponseMinutes,
      slaResolveMinutes,
      responseDeadline,
      resolveDeadline,
      acceptedAt,
      respondedAt,
      resolvedAt,
      closedAt,
      tags.length ? JSON.stringify(tags) : null,
      approvalRequired ? 1 : 0,
      approvalStatus,
      null,
      null,
      null,
    ]
  );
  const row = await db.get(
    `SELECT t.*, owner.username AS owner_name
     FROM tickets t
     LEFT JOIN users owner ON owner.id = t.owner_id
     WHERE t.id = ?`,
    [info.insertId]
  );
  await syncTicketSlaLogs(info.insertId);
  await logTicketEvent({
    ticketId: info.insertId,
    type: 'CREATED',
    desc: '创建工单',
    before: null,
    after: row,
    user: req.user,
    req,
  });
  if (Number(ownerId) > 0 && Number(ownerId) !== Number(req.user.id)) {
    await notifyUsers({
      userIds: [ownerId],
      ticketId: info.insertId,
      eventType: 'OWNER_ASSIGNED',
      title: `你被指派为工单负责人：${row?.title || `#${info.insertId}`}`,
      content: `工单「${row?.title || `#${info.insertId}`}」负责人已指派给你。`,
    });
  }
  res.json(decorateTicket(row));
});

app.get('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:read', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const row = await db.get(
    `SELECT t.*, owner.username AS owner_name
     FROM tickets t
     LEFT JOIN users owner ON owner.id = t.owner_id
     WHERE t.id = ?`,
    [id]
  );
  if (!row) return res.status(404).json({ error: '工单不存在' });
  return res.json(decorateTicket(row));
});

app.get('/api/tickets/:id/assignees', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:read', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const rows = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_assignees ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.ticket_id = ?`,
    [id]
  );
  res.json(rows);
});

app.put('/api/tickets/:id/assignees', async (req, res) => {
  const { id } = req.params;
  const { user_ids: userIds } = req.body || {};
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:assign', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (req.user.role !== 'admin' && ticketResource.ticket_can_assign !== true) {
    return res.status(403).json({ error: '无权分派该工单' });
  }
  const before = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_assignees ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.ticket_id = ?`,
    [id]
  );
  const ids = Array.isArray(userIds) ? userIds.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM ticket_assignees WHERE ticket_id = ?', [id]);
    for (const uid of ids) {
      await tx.run('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [id, uid]);
    }
  });
  const rows = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_assignees ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.ticket_id = ?`,
    [id]
  );
  const addedAssignees = rows
    .map((item) => Number(item.id))
    .filter((uid) => !before.some((old) => Number(old.id) === uid) && uid !== Number(req.user.id));
  if (addedAssignees.length) {
    const ticket = await db.get('SELECT id, title FROM tickets WHERE id = ?', [id]);
    await notifyUsers({
      userIds: addedAssignees,
      ticketId: id,
      eventType: 'ASSIGNEE_CHANGED',
      title: `你被加入工单协作：${ticket?.title || `#${id}`}`,
      content: `工单「${ticket?.title || `#${id}`}」新增你为协作人。`,
    });
  }
  await logTicketEvent({
    ticketId: Number(id),
    type: 'ASSIGNEE_CHANGED',
    desc: '更新工单协作人',
    before: { assignees: before },
    after: { assignees: rows },
    user: req.user,
    req,
  });
  res.json(rows);
});

app.get('/api/tickets/:id/watchers', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:read', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const rows = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_watchers tw
     JOIN users u ON u.id = tw.user_id
     WHERE tw.ticket_id = ?`,
    [id]
  );
  res.json(rows);
});

app.put('/api/tickets/:id/watchers', async (req, res) => {
  const { id } = req.params;
  const { user_ids: userIds } = req.body || {};
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:assign', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (req.user.role !== 'admin' && ticketResource.ticket_can_assign !== true) {
    return res.status(403).json({ error: '无权分派该工单' });
  }
  const before = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_watchers tw
     JOIN users u ON u.id = tw.user_id
     WHERE tw.ticket_id = ?`,
    [id]
  );
  const ids = Array.isArray(userIds) ? userIds.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM ticket_watchers WHERE ticket_id = ?', [id]);
    for (const uid of ids) {
      await tx.run('INSERT INTO ticket_watchers (ticket_id, user_id) VALUES (?, ?)', [id, uid]);
    }
  });
  const rows = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_watchers tw
     JOIN users u ON u.id = tw.user_id
     WHERE tw.ticket_id = ?`,
    [id]
  );
  const addedWatchers = rows
    .map((item) => Number(item.id))
    .filter((uid) => !before.some((old) => Number(old.id) === uid) && uid !== Number(req.user.id));
  if (addedWatchers.length) {
    const ticket = await db.get('SELECT id, title FROM tickets WHERE id = ?', [id]);
    await notifyUsers({
      userIds: addedWatchers,
      ticketId: id,
      eventType: 'WATCHER_CHANGED',
      title: `你被加入工单观察：${ticket?.title || `#${id}`}`,
      content: `工单「${ticket?.title || `#${id}`}」新增你为观察者。`,
    });
  }
  await logTicketEvent({
    ticketId: Number(id),
    type: 'WATCHER_CHANGED',
    desc: '更新工单观察者',
    before: { watchers: before },
    after: { watchers: rows },
    user: req.user,
    req,
  });
  res.json(rows);
});

app.get('/api/tickets/:id/comments', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:events', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const rows = await db.query(
    `SELECT id, ticket_id, content, mentions_json, created_by, created_name, created_at
     FROM ticket_comments
     WHERE ticket_id = ?
     ORDER BY id DESC
     LIMIT 200`,
    [id]
  );
  res.json(
    rows.map((row) => ({
      ...row,
      mentions: row.mentions_json ? JSON.parse(row.mentions_json) : [],
    }))
  );
});

app.post('/api/tickets/:id/comments', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:events', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (authz.constraints?.readOnly) {
    return res.status(403).json({ error: '当前账号仅支持审计只读访问' });
  }
  const content = normalizeText(req.body?.content);
  if (!content) return res.status(400).json({ error: '评论内容不能为空' });
  const mentions = await parseMentions(content);
  const info = await db.run(
    `INSERT INTO ticket_comments (ticket_id, content, mentions_json, created_by, created_name)
     VALUES (?, ?, ?, ?, ?)`,
    [
      Number(id),
      content,
      mentions.length ? JSON.stringify(mentions) : null,
      Number(req.user.id),
      req.user.username || null,
    ]
  );
  const comment = await db.get(
    `SELECT id, ticket_id, content, mentions_json, created_by, created_name, created_at
     FROM ticket_comments
     WHERE id = ?`,
    [info.insertId]
  );
  await logTicketEvent({
    ticketId: Number(id),
    type: 'COMMENT_ADDED',
    desc: mentions.length ? `新增评论并@${mentions.map((m) => m.username).join('、')}` : '新增评论',
    before: null,
    after: { comment_id: comment.id },
    user: req.user,
    req,
  });
  if (mentions.length) {
    const ticket = await db.get('SELECT id, title FROM tickets WHERE id = ?', [id]);
    await notifyUsers({
      userIds: mentions.map((item) => item.id).filter((uid) => Number(uid) !== Number(req.user.id)),
      ticketId: id,
      eventType: 'COMMENT_MENTION',
      title: `你在工单中被@：${ticket?.title || `#${id}`}`,
      content: content.length > 200 ? `${content.slice(0, 197)}...` : content,
    });
  }
  res.json({
    ...comment,
    mentions: comment.mentions_json ? JSON.parse(comment.mentions_json) : [],
  });
});

app.get('/api/tickets/:id/attachments', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:read', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const rows = await db.query(
    `SELECT id, ticket_id, filename, mime_type, size_bytes, created_by, created_name, created_at
     FROM ticket_attachments
     WHERE ticket_id = ?
     ORDER BY id DESC`,
    [id]
  );
  return res.json(rows);
});

app.post('/api/tickets/:id/attachments', ticketingUploadRateLimiter, uploadTicketAttachment, async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:update', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: '请选择要上传的附件' });
  }
  const filename = sanitizeFilename(req.file.originalname || 'attachment');
  const mimeType = normalizeMimeType(req.file.mimetype);
  if (!allowedAttachmentMimes.has(mimeType)) {
    return res.status(400).json({ error: `不支持的附件类型：${mimeType}` });
  }
  const sizeBytes = Number(req.file.size || 0);
  if (!sizeBytes || sizeBytes <= 0) {
    return res.status(400).json({ error: '附件内容不能为空' });
  }
  const result = await db.run(
    `INSERT INTO ticket_attachments
      (ticket_id, filename, mime_type, size_bytes, file_data, created_by, created_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(id),
      filename,
      mimeType,
      sizeBytes,
      req.file.buffer,
      Number(req.user.id) || null,
      req.user.username || null,
    ]
  );
  const row = await db.get(
    `SELECT id, ticket_id, filename, mime_type, size_bytes, created_by, created_name, created_at
     FROM ticket_attachments
     WHERE id = ?`,
    [result.insertId]
  );
  await logTicketEvent({
    ticketId: Number(id),
    type: 'ATTACHMENT_UPLOADED',
    desc: '上传工单附件',
    before: null,
    after: {
      attachment_id: Number(row?.id || result.insertId),
      filename,
      size_bytes: sizeBytes,
      mime_type: mimeType,
    },
    user: req.user,
    req,
  });
  return res.json(row);
});

app.get('/api/tickets/:id/attachments/:attachmentId/content', async (req, res) => {
  const { id, attachmentId } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:read', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const row = await db.get(
    `SELECT id, filename, mime_type, size_bytes, file_data
     FROM ticket_attachments
     WHERE id = ? AND ticket_id = ?`,
    [attachmentId, id]
  );
  if (!row) return res.status(404).json({ error: '附件不存在' });
  const fileBuffer = row.file_data;
  if (!fileBuffer || (Buffer.isBuffer(fileBuffer) && fileBuffer.length === 0)) {
    return res.status(404).json({ error: '附件内容不存在' });
  }
  const mimeType = normalizeMimeType(row.mime_type);
  const safeFilename = sanitizeFilename(row.filename);
  const inlineAllowedMime = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'application/pdf',
    'text/plain',
  ]);
  const canInline = inlineAllowedMime.has(mimeType);
  const disposition = canInline ? 'inline' : 'attachment';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
  );
  res.send(fileBuffer);
});

app.delete('/api/tickets/:id/attachments/:attachmentId', async (req, res) => {
  const { id, attachmentId } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:update', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const row = await db.get(
    `SELECT id, filename, mime_type, size_bytes, created_by, created_name, created_at
     FROM ticket_attachments
     WHERE id = ? AND ticket_id = ?`,
    [attachmentId, id]
  );
  if (!row) return res.status(404).json({ error: '附件不存在' });
  await db.run('DELETE FROM ticket_attachments WHERE id = ?', [attachmentId]);
  await logTicketEvent({
    ticketId: Number(id),
    type: 'ATTACHMENT_DELETED',
    desc: '删除工单附件',
    before: {
      attachment_id: Number(row.id),
      filename: row.filename,
      size_bytes: Number(row.size_bytes || 0),
      mime_type: row.mime_type,
    },
    after: null,
    user: req.user,
    req,
  });
  return res.json({ ok: true });
});

app.post('/api/tickets/:id/schedule', async (req, res) => {
  const { id } = req.params;
  const { engineer_id: engineerId, start_at: startAt, end_at: endAt, remark } = req.body || {};
  const error = validateSchedule(startAt, endAt);
  if (error) return res.status(400).json({ error });
  const targetEngineer = engineerId ? Number(engineerId) : Number(req.user.id);
  if (!targetEngineer) return res.status(400).json({ error: '工程师不能为空' });
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, {
    action: 'schedule:assign',
    resource: { engineer_id: targetEngineer, ...ticketResource },
  });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (req.user.role !== 'admin' && ticketResource.ticket_can_assign !== true) {
    return res.status(403).json({ error: '无权为该工单排期' });
  }
  const conflict = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM schedules
     WHERE engineer_id = ?
       AND NOT (? <= start_at OR ? >= end_at)`,
    [targetEngineer, endAt, startAt]
  );
  if (conflict?.cnt > 0) return res.status(409).json({ error: '该工程师在此时间段已有排期' });
  const info = await db.run(
    `INSERT INTO schedules (engineer_id, ticket_id, start_at, end_at, remark)
     VALUES (?, ?, ?, ?, ?)`,
    [targetEngineer, id, startAt, endAt, remark || null]
  );
  const row = await db.get('SELECT * FROM schedules WHERE id = ?', [info.insertId]);
  await logTicketEvent({
    ticketId: Number(id),
    type: 'SCHEDULE_CREATED',
    desc: '新增工单排期',
    before: null,
    after: row,
    user: req.user,
    req,
  });
  return res.json(row);
});

app.get('/api/tickets/:id/stages', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:read', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const rows = await db.query(
    'SELECT * FROM ticket_stages WHERE ticket_id = ? ORDER BY stage_order ASC',
    [id]
  );
  res.json(await enrichStages(rows));
});

app.put('/api/tickets/:id/stages/:stageId', async (req, res) => {
  const { id, stageId } = req.params;
  const { status } = req.body || {};
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:stages', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (req.user.role !== 'admin' && ticketResource.ticket_can_edit !== true) {
    return res.status(403).json({ error: '无权编辑工单阶段' });
  }
  const stage = await db.get('SELECT * FROM ticket_stages WHERE id = ? AND ticket_id = ?', [
    stageId,
    id,
  ]);
  if (!stage) return res.status(404).json({ error: '阶段不存在' });
  const nextStatus = String(status || '').toUpperCase();
  if (!['PENDING', 'IN_PROGRESS', 'DONE'].includes(nextStatus)) {
    return res.status(400).json({ error: '状态不合法' });
  }
  const before = { id: stage.id, status: stage.status };
  await db.run('UPDATE ticket_stages SET status = ? WHERE id = ?', [nextStatus, stageId]);
  await refreshTicketCurrentStage(id);
  const updated = await db.get('SELECT * FROM ticket_stages WHERE id = ?', [stageId]);
  await logTicketEvent({
    ticketId: Number(id),
    type: 'STAGE_STATUS_CHANGED',
    desc: `阶段「${stage.name}」状态更新为 ${nextStatus}`,
    before,
    after: { id: updated.id, status: updated.status },
    user: req.user,
    req,
  });
  res.json(updated);
});

app.post('/api/tickets/:id/stages/from-template', async (req, res) => {
  const { id } = req.params;
  const { template_id: templateId, mode } = req.body || {};
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:generate-stages', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (req.user.role !== 'admin' && ticketResource.ticket_can_edit !== true) {
    return res.status(403).json({ error: '无权生成工单阶段' });
  }
  if (!templateId) return res.status(400).json({ error: '模板不能为空' });
  const template = await db.get('SELECT * FROM ticket_templates WHERE id = ?', [templateId]);
  if (!template) return res.status(404).json({ error: '模板不存在' });
  const stages = await db.query(
    'SELECT * FROM ticket_template_stages WHERE template_id = ? ORDER BY stage_order ASC',
    [templateId]
  );
  if (stages.length === 0) return res.status(400).json({ error: '模板无阶段' });
  const stageIds = stages.map((item) => item.id);
  const deliverableRows = stageIds.length
    ? await db.query(
        `SELECT stage_id, name
         FROM ticket_template_deliverables
         WHERE stage_id IN (${stageIds.map(() => '?').join(',')})`,
        stageIds
      )
    : [];
  const deliverablesByTemplateStage = new Map();
  deliverableRows.forEach((row) => {
    if (!deliverablesByTemplateStage.has(row.stage_id)) deliverablesByTemplateStage.set(row.stage_id, []);
    deliverablesByTemplateStage.get(row.stage_id).push(row.name);
  });
  const beforeCount = await db.get('SELECT COUNT(*) AS cnt FROM ticket_stages WHERE ticket_id = ?', [id]);
  let firstStageId = null;
  await db.transaction(async (tx) => {
    if ((mode || 'replace') === 'replace') {
      await tx.run('DELETE FROM ticket_stages WHERE ticket_id = ?', [id]);
    }
    for (const stage of stages) {
      const inserted = await tx.run(
        'INSERT INTO ticket_stages (ticket_id, name, duration_days, stage_order, status) VALUES (?, ?, ?, ?, ?)',
        [id, stage.name, stage.duration_days, stage.stage_order, 'PENDING']
      );
      if (!firstStageId) firstStageId = inserted.insertId;
      const deliverables = deliverablesByTemplateStage.get(stage.id) || [];
      for (const item of deliverables) {
        await tx.run(
          `INSERT INTO ticket_stage_deliverables
            (stage_id, name, required_flag, done_flag)
           VALUES (?, ?, 1, 0)`,
          [inserted.insertId, String(item)]
        );
      }
    }
    await tx.run('UPDATE tickets SET current_stage_id = ?, updated_at = NOW() WHERE id = ?', [
      firstStageId,
      id,
    ]);
  });
  const rows = await db.query(
    'SELECT * FROM ticket_stages WHERE ticket_id = ? ORDER BY stage_order ASC',
    [id]
  );
  await logTicketEvent({
    ticketId: Number(id),
    type: 'STAGES_REGENERATED',
    desc: `从模板「${template.name}」生成阶段`,
    before: { stage_count: Number(beforeCount?.cnt || 0) },
    after: { stage_count: rows.length, template_id: template.id },
    user: req.user,
    req,
  });
  res.json({ ok: true, stages: await enrichStages(rows) });
});

app.put('/api/tickets/:id/deliverables/:deliverableId', async (req, res) => {
  const { id, deliverableId } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:deliverables', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (req.user.role !== 'admin' && ticketResource.ticket_can_edit !== true) {
    return res.status(403).json({ error: '无权更新交付物' });
  }
  const done = Number(req.body?.done) === 1 || req.body?.done === true;
  const row = await db.get(
    `SELECT d.*, s.ticket_id, s.name AS stage_name
     FROM ticket_stage_deliverables d
     JOIN ticket_stages s ON s.id = d.stage_id
     WHERE d.id = ? AND s.ticket_id = ?`,
    [deliverableId, id]
  );
  if (!row) return res.status(404).json({ error: '交付物不存在' });
  await db.run(
    `UPDATE ticket_stage_deliverables
     SET done_flag = ?, done_by = ?, done_at = ?
     WHERE id = ?`,
    [done ? 1 : 0, done ? req.user.id : null, done ? formatDateTime(new Date()) : null, deliverableId]
  );
  const updated = await db.get('SELECT * FROM ticket_stage_deliverables WHERE id = ?', [deliverableId]);
  await logTicketEvent({
    ticketId: Number(id),
    type: 'DELIVERABLE_UPDATED',
    desc: `交付物「${row.name}」${done ? '已完成' : '重置为未完成'}`,
    before: { id: row.id, done_flag: row.done_flag },
    after: { id: updated.id, done_flag: updated.done_flag },
    user: req.user,
    req,
  });
  res.json(updated);
});

app.get('/api/tickets/:id/events', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:events', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const where = ['ticket_id = ?'];
  const params = [id];
  if (req.query.event_type) {
    where.push('event_type = ?');
    params.push(String(req.query.event_type));
  }
  if (req.query.operator) {
    where.push('operator_name LIKE ?');
    params.push(`%${String(req.query.operator).trim()}%`);
  }
  if (req.query.from) {
    where.push('created_at >= ?');
    params.push(normalizeDateInput(req.query.from));
  }
  if (req.query.to) {
    where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(normalizeDateInput(req.query.to));
  }
  const rows = await db.query(
    `SELECT id, event_type, event_desc, before_json, after_json, operator_id, operator_name,
            CASE
              WHEN JSON_VALID(after_json) THEN JSON_UNQUOTE(JSON_EXTRACT(after_json, '$."请求信息"."请求IP"'))
              ELSE NULL
            END AS source_ip,
            created_at
     FROM ticket_events
     WHERE ${where.join(' AND ')}
     ORDER BY id DESC
     LIMIT 500`,
    params
  );
  res.json(rows);
});

app.get('/api/tickets/:id/events/export', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:events', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const where = ['ticket_id = ?'];
  const params = [id];
  if (req.query.event_type) {
    where.push('event_type = ?');
    params.push(String(req.query.event_type));
  }
  if (req.query.operator) {
    where.push('operator_name LIKE ?');
    params.push(`%${String(req.query.operator).trim()}%`);
  }
  if (req.query.from) {
    where.push('created_at >= ?');
    params.push(normalizeDateInput(req.query.from));
  }
  if (req.query.to) {
    where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(normalizeDateInput(req.query.to));
  }
  const rows = await db.query(
    `SELECT id, event_type, event_desc, operator_name,
            CASE
              WHEN JSON_VALID(after_json) THEN JSON_UNQUOTE(JSON_EXTRACT(after_json, '$."请求信息"."请求IP"'))
              ELSE NULL
            END AS source_ip,
            created_at
     FROM ticket_events
     WHERE ${where.join(' AND ')}
     ORDER BY id DESC
     LIMIT 5000`,
    params
  );
  const header = ['事件ID', '类型', '内容', '操作人', '来源IP', '时间'];
  const lines = [
    header.map(escapeCsv).join(','),
    ...rows.map((row) =>
      [row.id, row.event_type, row.event_desc, row.operator_name || '-', row.source_ip || '-', formatDateTime(row.created_at)]
        .map(escapeCsv)
        .join(',')
    ),
  ];
  const filename = `ticket-${id}-events-${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join('\n')}`);
});

app.get('/api/operation-logs', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:audit' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });

  const page = Math.max(toPositiveInt(req.query.page, 1), 1);
  const pageSize = Math.min(Math.max(toPositiveInt(req.query.page_size, 50), 1), 200);
  const offset = (page - 1) * pageSize;

  const where = ['log_system = ?'];
  const params = ['ticketing'];
  const operator = normalizeText(req.query.operator);
  const action = normalizeText(req.query.action);
  const entity = normalizeText(req.query.entity);
  const from = normalizeText(req.query.from);
  const to = normalizeText(req.query.to);

  if (operator) {
    where.push('username LIKE ?');
    params.push(`%${operator}%`);
  }
  if (action) {
    where.push('action LIKE ?');
    params.push(`%${action}%`);
  }
  if (entity) {
    where.push('entity LIKE ?');
    params.push(`%${entity}%`);
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(normalizeDateInput(from));
  }
  if (to) {
    where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(normalizeDateInput(to));
  }

  const countRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM operation_logs
     WHERE ${where.join(' AND ')}`,
    params
  );
  const rows = await db.query(
    `SELECT id, user_id, username, action, entity, entity_id, before_data, after_data, request_ip, created_at
     FROM operation_logs
     WHERE ${where.join(' AND ')}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({
    items: rows,
    page,
    page_size: pageSize,
    total: Number(countRow?.total || 0),
  });
});

app.put('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [id]);
  const authz = await authorize(req, {
    action: 'ticket:update',
    resource: ticketResource,
  });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (!ticket) return res.status(404).json({ error: '工单不存在' });
  if (req.user.role !== 'admin' && ticketResource.ticket_can_edit !== true) {
    return res.status(403).json({ error: '无权编辑该工单' });
  }
  const payload = req.body || {};
  const serviceCode = payload.service_code !== undefined ? toNullable(payload.service_code) : ticket.service_code;
  const service = serviceCode
    ? await db.get(
        `SELECT code, department_code, default_priority, default_response_minutes, default_resolve_minutes
         FROM service_catalog WHERE code = ?`,
        [serviceCode]
      )
    : null;
  const nextTitle = payload.title !== undefined ? normalizeText(payload.title) || ticket.title : ticket.title;
  const nextDescription = payload.description !== undefined ? String(payload.description || '') : ticket.description;
  const nextPriorityRaw = payload.priority !== undefined ? normalizeText(payload.priority) : ticket.priority;
  const nextPriority = ['P1', 'P2', 'P3'].includes(String(nextPriorityRaw).toUpperCase())
    ? String(nextPriorityRaw).toUpperCase()
    : ticket.priority;
  const nextSeverityRaw = payload.severity !== undefined ? normalizeText(payload.severity) : ticket.severity;
  const nextSeverity = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(nextSeverityRaw).toUpperCase())
    ? String(nextSeverityRaw).toUpperCase()
    : ticket.severity;
  const statusRaw = payload.status !== undefined ? normalizeText(payload.status).toUpperCase() : ticket.status;
  const nextStatus = normalizeTicketStatus(statusRaw, ticket.status || 'OPEN');
  const transitionError = validateTicketStatusTransition({
    current: ticket.status || 'OPEN',
    next: nextStatus,
  });
  if (transitionError) {
    return res.status(400).json({
      error: `${transitionError}。请按流程：新建→受理→处理中→待验证→完成→关闭`,
    });
  }
  if (nextStatus === 'CLOSED' && req.user.role !== 'admin' && ticketResource.ticket_can_close !== true) {
    return res.status(403).json({ error: '无权关闭该工单' });
  }
  const ownerIdRaw = Number(payload.owner_id);
  const nextOwnerId =
    payload.owner_id === undefined
      ? ticket.owner_id
      : Number.isFinite(ownerIdRaw) && ownerIdRaw > 0
      ? ownerIdRaw
      : null;
  if (
    req.user.role !== 'admin' &&
    payload.owner_id !== undefined &&
    Number(nextOwnerId || 0) !== Number(ticket.owner_id || 0) &&
    ticketResource.ticket_can_assign !== true
  ) {
    return res.status(403).json({ error: '无权调整工单负责人' });
  }
  const projectIdNum = Number(payload.project_id);
  const nextProjectId =
    payload.project_id === undefined
      ? ticket.project_id
      : Number.isFinite(projectIdNum) && projectIdNum > 0
      ? projectIdNum
      : null;

  const nextSlaResponseMinutes =
    payload.sla_response_minutes !== undefined
      ? toPositiveInt(payload.sla_response_minutes, ticket.sla_response_minutes || 30)
      : ticket.sla_response_minutes || toPositiveInt(service?.default_response_minutes, 30);
  const nextSlaResolveMinutes =
    payload.sla_resolve_minutes !== undefined
      ? toPositiveInt(payload.sla_resolve_minutes, ticket.sla_resolve_minutes || 480)
      : ticket.sla_resolve_minutes || toPositiveInt(service?.default_resolve_minutes, 480);
  const nextApprovalRequired = isHighRiskTicket({ priority: nextPriority, severity: nextSeverity });
  let nextApprovalStatus = String(ticket.approval_status || '').toUpperCase();
  let nextApprovalBy = ticket.approval_by || null;
  let nextApprovalAt = ticket.approval_at || null;
  let nextApprovalComment = ticket.approval_comment || null;
  if (nextApprovalRequired) {
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(nextApprovalStatus)) {
      nextApprovalStatus = 'PENDING';
    }
    if (nextApprovalStatus === 'NOT_REQUIRED') {
      nextApprovalStatus = 'PENDING';
    }
  } else {
    nextApprovalStatus = 'NOT_REQUIRED';
    nextApprovalBy = null;
    nextApprovalAt = null;
    nextApprovalComment = null;
  }

  const nowSql = formatDateTime(new Date());
  let acceptedAt = ticket.accepted_at;
  let respondedAt = ticket.responded_at;
  let resolvedAt = ticket.resolved_at;
  let closedAt = ticket.closed_at;
  if (ticket.status !== nextStatus) {
    if (nextStatus === 'ACCEPTED') {
      acceptedAt = acceptedAt || nowSql;
      closedAt = null;
    } else if (nextStatus === 'IN_PROGRESS') {
      acceptedAt = acceptedAt || nowSql;
      respondedAt = respondedAt || nowSql;
      closedAt = null;
    } else if (nextStatus === 'WAIT_VERIFY') {
      acceptedAt = acceptedAt || nowSql;
      respondedAt = respondedAt || nowSql;
      closedAt = null;
    } else if (nextStatus === 'RESOLVED') {
      acceptedAt = acceptedAt || nowSql;
      respondedAt = respondedAt || nowSql;
      resolvedAt = resolvedAt || nowSql;
      closedAt = null;
    } else if (nextStatus === 'CLOSED') {
      acceptedAt = acceptedAt || nowSql;
      respondedAt = respondedAt || nowSql;
      resolvedAt = resolvedAt || nowSql;
      closedAt = nowSql;
    } else if (nextStatus === 'OPEN') {
      closedAt = null;
      resolvedAt = null;
      if (nextApprovalRequired) {
        nextApprovalStatus = 'PENDING';
        nextApprovalBy = null;
        nextApprovalAt = null;
        nextApprovalComment = null;
      }
    }
  }
  if (nextStatus === 'WAIT_VERIFY' && nextApprovalRequired && nextApprovalStatus === 'REJECTED') {
    nextApprovalStatus = 'PENDING';
    nextApprovalBy = null;
    nextApprovalAt = null;
    nextApprovalComment = null;
  }
  if (nextStatus === 'CLOSED' && nextApprovalRequired && nextApprovalStatus !== 'APPROVED') {
    return res.status(400).json({ error: '高风险工单需审批通过后才可关闭' });
  }
  const reopenCount =
    ticket.status !== nextStatus &&
    ['RESOLVED', 'CLOSED'].includes(ticket.status) &&
    ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'WAIT_VERIFY'].includes(nextStatus)
      ? Number(ticket.reopen_count || 0) + 1
      : Number(ticket.reopen_count || 0);

  let responseDeadline = ticket.response_deadline;
  let resolveDeadline = ticket.resolve_deadline;
  if (payload.sla_response_minutes !== undefined || !responseDeadline) {
    responseDeadline = formatDateTime(plusMinutes(new Date(ticket.created_at || nowSql), nextSlaResponseMinutes));
  }
  if (payload.sla_resolve_minutes !== undefined || !resolveDeadline) {
    resolveDeadline = formatDateTime(plusMinutes(new Date(ticket.created_at || nowSql), nextSlaResolveMinutes));
  }

  const tags =
    payload.tags !== undefined
      ? Array.isArray(payload.tags)
        ? payload.tags.map((item) => normalizeText(item)).filter(Boolean)
        : []
      : null;
  const nextTagsJson = tags ? (tags.length ? JSON.stringify(tags) : null) : ticket.tags_json;

  await db.run(
    `UPDATE tickets
     SET title = ?, description = ?, status = ?, priority = ?, owner_id = ?, project_id = ?,
         department_code = ?, service_code = ?, ticket_type = ?, source = ?,
         customer_name = ?, requester_name = ?, requester_phone = ?, requester_email = ?,
         severity = ?, sla_response_minutes = ?, sla_resolve_minutes = ?,
         response_deadline = ?, resolve_deadline = ?, accepted_at = ?, responded_at = ?,
         resolved_at = ?, closed_at = ?, tags_json = ?, reopen_count = ?,
         approval_required = ?, approval_status = ?, approval_by = ?, approval_at = ?, approval_comment = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      nextTitle,
      nextDescription,
      nextStatus,
      nextPriority,
      nextOwnerId,
      nextProjectId,
      payload.department_code !== undefined
        ? toNullable(payload.department_code)
        : service?.department_code || ticket.department_code || null,
      serviceCode,
      payload.ticket_type !== undefined ? toNullable(payload.ticket_type) : ticket.ticket_type,
      payload.source !== undefined ? toNullable(payload.source) : ticket.source,
      payload.customer_name !== undefined ? toNullable(payload.customer_name) : ticket.customer_name,
      payload.requester_name !== undefined ? toNullable(payload.requester_name) : ticket.requester_name,
      payload.requester_phone !== undefined ? toNullable(payload.requester_phone) : ticket.requester_phone,
      payload.requester_email !== undefined ? toNullable(payload.requester_email) : ticket.requester_email,
      nextSeverity,
      nextSlaResponseMinutes,
      nextSlaResolveMinutes,
      responseDeadline,
      resolveDeadline,
      acceptedAt,
      respondedAt,
      resolvedAt,
      closedAt,
      nextTagsJson,
      reopenCount,
      nextApprovalRequired ? 1 : 0,
      nextApprovalStatus,
      nextApprovalBy,
      nextApprovalAt,
      nextApprovalComment,
      id,
    ]
  );
  const row = await db.get(
    `SELECT t.*, owner.username AS owner_name
     FROM tickets t
     LEFT JOIN users owner ON owner.id = t.owner_id
     WHERE t.id = ?`,
    [id]
  );
  await syncTicketSlaLogs(id);
  if (
    Number(ticket.owner_id || 0) !== Number(row.owner_id || 0) &&
    Number(row.owner_id || 0) > 0 &&
    Number(row.owner_id || 0) !== Number(req.user.id)
  ) {
    await notifyUsers({
      userIds: [row.owner_id],
      ticketId: id,
      eventType: 'OWNER_ASSIGNED',
      title: `你被指派为工单负责人：${row.title || `#${id}`}`,
      content: `工单「${row.title || `#${id}`}」负责人已更新为你。`,
    });
  }
  await logTicketEvent({
    ticketId: Number(id),
    type: 'UPDATED',
    desc: ticket.status !== row.status ? `工单状态变更为 ${toTicketStatusZh(row.status)}` : '更新工单信息',
    before: ticket,
    after: row,
    user: req.user,
    req,
  });
  res.json(decorateTicket(row));
});

app.post('/api/tickets/:id/approval', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:approval', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [id]);
  if (!ticket) return res.status(404).json({ error: '工单不存在' });
  if (Number(ticket.approval_required || 0) !== 1) {
    return res.status(400).json({ error: '该工单不需要审批' });
  }
  const decisionRaw = String(req.body?.decision || '').toUpperCase();
  const decision = decisionRaw === 'APPROVE' ? 'APPROVED' : decisionRaw === 'REJECT' ? 'REJECTED' : '';
  if (!decision) return res.status(400).json({ error: '审批动作不合法' });
  const comment = normalizeText(req.body?.comment || '');
  const nowSql = formatDateTime(new Date());
  let nextStatus = String(ticket.status || 'OPEN').toUpperCase();
  if (decision === 'REJECTED' && nextStatus === 'RESOLVED') {
    nextStatus = 'WAIT_VERIFY';
  }
  await db.run(
    `UPDATE tickets
     SET approval_status = ?, approval_by = ?, approval_at = ?, approval_comment = ?, status = ?, updated_at = NOW()
     WHERE id = ?`,
    [decision, Number(req.user.id), nowSql, comment || null, nextStatus, id]
  );
  const updated = await db.get(
    `SELECT t.*, owner.username AS owner_name
     FROM tickets t
     LEFT JOIN users owner ON owner.id = t.owner_id
     WHERE t.id = ?`,
    [id]
  );
  const noticeTargets = new Set();
  if (Number(updated?.owner_id || 0) > 0) noticeTargets.add(Number(updated.owner_id));
  if (Number(updated?.created_by || 0) > 0) noticeTargets.add(Number(updated.created_by));
  noticeTargets.delete(Number(req.user.id));
  if (noticeTargets.size) {
    await notifyUsers({
      userIds: Array.from(noticeTargets),
      ticketId: id,
      eventType: decision === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
      title:
        decision === 'APPROVED'
          ? `工单审批通过：${updated?.title || `#${id}`}`
          : `工单审批驳回：${updated?.title || `#${id}`}`,
      content: comment || (decision === 'APPROVED' ? '审批已通过，可进入关闭流程。' : '审批已驳回，请继续处理后再提交。'),
    });
  }
  await syncTicketSlaLogs(id);
  await logTicketEvent({
    ticketId: Number(id),
    type: decision === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
    desc:
      decision === 'APPROVED'
        ? `审批通过${comment ? `：${comment}` : ''}`
        : `审批驳回${comment ? `：${comment}` : ''}`,
    before: {
      approval_status: ticket.approval_status,
      status: ticket.status,
    },
    after: {
      approval_status: decision,
      status: nextStatus,
      approval_by: Number(req.user.id),
      approval_comment: comment || null,
    },
    user: req.user,
    req,
  });
  res.json(decorateTicket(updated));
});

app.delete('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id, req.user.id);
  const authz = await authorize(req, { action: 'ticket:delete', resource: ticketResource });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [id]);
  if (ticket) {
    await logTicketEvent({
      ticketId: Number(id),
      type: 'DELETED',
      desc: '删除工单',
      before: ticket,
      after: null,
      user: req.user,
      req,
    });
  }
  await db.run('DELETE FROM tickets WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.get('/api/notifications', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:notifications', resource: { user_id: req.user.id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const unreadOnly = Number(req.query.unread_only || 0) === 1;
  const where = ['n.user_id = ?'];
  const params = [req.user.id];
  if (unreadOnly) where.push('n.is_read = 0');
  const rows = await db.query(
    `SELECT
       n.id, n.user_id, n.ticket_id, n.event_type, n.title, n.content, n.is_read, n.created_at, n.read_at,
       t.title AS ticket_title
     FROM ticket_notifications n
     LEFT JOIN tickets t ON t.id = n.ticket_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.id DESC
     LIMIT ?`,
    [...params, limit]
  );
  res.json(rows);
});

app.put('/api/notifications/:id/read', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'ticket:notifications', resource: { user_id: req.user.id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const info = await db.run(
    `UPDATE ticket_notifications
     SET is_read = 1, read_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [id, req.user.id]
  );
  if (!info.affectedRows) return res.status(404).json({ error: '通知不存在' });
  res.json({ ok: true });
});

app.put('/api/notifications/read-all', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:notifications', resource: { user_id: req.user.id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  await db.run(
    `UPDATE ticket_notifications
     SET is_read = 1, read_at = NOW()
     WHERE user_id = ? AND is_read = 0`,
    [req.user.id]
  );
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const maxMb = Math.max(1, Math.floor((TICKET_ATTACHMENT_MAX_BYTES || 0) / (1024 * 1024)));
    return res.status(400).json({ error: `附件大小不能超过 ${maxMb}MB` });
  }
  if (err) {
    console.error('Unhandled ticketing API error', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
  return next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const start = async () => {
  validateSecurityBootstrap();
  await db.ready;
  app.listen(PORT, () => {
    console.log(`Ticketing server running at http://localhost:${PORT}`);
  });
};

start().catch((err) => {
  console.error('Ticketing server start failed', err);
  process.exit(1);
});

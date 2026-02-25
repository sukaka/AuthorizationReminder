const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const db = require('../server/db');
const nodemailer = require('nodemailer');
const RPCClient = require('@alicloud/pop-core');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5180;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE === 'true';
const AUTH_COOKIE_SAMESITE = String(process.env.AUTH_COOKIE_SAMESITE || 'lax').trim().toLowerCase() || 'lax';
const CONFIG_SECRET_KEY = process.env.CONFIG_SECRET_KEY || '';
const SECRET_MASK = '******';
const SYSTEM_ACCESS_KEYS = ['reminder', 'ticketing', 'cmdb', 'inventory', 'device-flow', 'sec-impl'];
const BUILTIN_ACCOUNT_DEFAULT_PASSWORD = process.env.BUILTIN_ACCOUNT_DEFAULT_PASSWORD || '123456';
const BUILTIN_ACCOUNTS = [
  { username: 'admin', role: 'admin' },
  { username: 'sysadmin', role: 'sysadmin' },
  { username: 'auditor', role: 'auditor' },
];
const BUILTIN_ACCOUNT_USERNAMES = new Set(BUILTIN_ACCOUNTS.map((item) => item.username));
const AUDIT_SIGNING_KEY = process.env.AUDIT_SIGNING_KEY || JWT_SECRET;

const validatePasswordComplexity = (password) => {
  const value = String(password || '');
  if (value.length < 10) {
    return '密码至少10位，且需包含大写字母、小写字母、数字和特殊字符';
  }
  if (!/[A-Z]/.test(value)) {
    return '密码需包含至少1个大写字母';
  }
  if (!/[a-z]/.test(value)) {
    return '密码需包含至少1个小写字母';
  }
  if (!/\d/.test(value)) {
    return '密码需包含至少1个数字';
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return '密码需包含至少1个特殊字符';
  }
  return '';
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

const parseAppAccessRaw = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    // fallback to comma-separated parsing
  }
  return text.split(',').map((item) => item.trim());
};

const defaultAppAccessByRole = (role) => {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return [...SYSTEM_ACCESS_KEYS];
  if (r === 'sysadmin') return ['reminder', 'sec-impl'];
  if (r === 'auditor') return ['reminder', 'ticketing', 'cmdb', 'inventory', 'device-flow', 'sec-impl'];
  return ['reminder'];
};

const getUserAppAccess = (user) => {
  if (!user) return [];
  if (user.role === 'admin') return [...SYSTEM_ACCESS_KEYS];
  const parsed = parseAppAccessRaw(user.app_access);
  const source = parsed === null ? defaultAppAccessByRole(user.role) : parsed;
  return Array.from(
    new Set(source.map((item) => String(item || '').trim()).filter((item) => SYSTEM_ACCESS_KEYS.includes(item)))
  );
};

const canAccessSystem = (user, systemKey) => getUserAppAccess(user).includes(systemKey);

const deriveKey = (secret) => crypto.createHash('sha256').update(secret).digest();

const encryptValue = (value) => {
  if (value === undefined || value === null) return value;
  const text = String(value);
  if (!text) return text;
  if (!CONFIG_SECRET_KEY) return text;
  const iv = crypto.randomBytes(12);
  const key = deriveKey(CONFIG_SECRET_KEY);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]).toString('base64');
  return `enc:${payload}`;
};

const decryptValue = (value) => {
  if (value === undefined || value === null) return value;
  const text = String(value);
  if (!text.startsWith('enc:')) return text;
  if (!CONFIG_SECRET_KEY) {
    throw new Error('CONFIG_SECRET_KEY 未配置，无法解密');
  }
  const raw = Buffer.from(text.slice(4), 'base64');
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const data = raw.slice(28);
  const key = deriveKey(CONFIG_SECRET_KEY);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
};

const applySecretUpdate = ({ incoming, existing }) => {
  if (incoming === undefined || incoming === null) return existing;
  const text = String(incoming).trim();
  if (!text || text === SECRET_MASK) return existing;
  if (!CONFIG_SECRET_KEY) {
    throw new Error('CONFIG_SECRET_KEY 未配置，无法安全保存密码');
  }
  return encryptValue(text);
};

const ensureEncrypted = (value) => {
  if (value === undefined || value === null) return value;
  const text = String(value);
  if (!text) return text;
  if (!CONFIG_SECRET_KEY) return text;
  if (text.startsWith('enc:')) return text;
  return encryptValue(text);
};

const maskSecrets = (configs) => {
  const cloned = JSON.parse(JSON.stringify(configs || {}));
  if (cloned.email?.pass) cloned.email.pass = SECRET_MASK;
  if (cloned.sms?.accessKeySecret) cloned.sms.accessKeySecret = SECRET_MASK;
  if (cloned.wecom?.secret) cloned.wecom.secret = SECRET_MASK;
  if (cloned.ocr?.accessKeySecret) cloned.ocr.accessKeySecret = SECRET_MASK;
  return cloned;
};

const decryptSecrets = (configs) => {
  if (!configs) return configs;
  if (configs.email?.pass) configs.email.pass = decryptValue(configs.email.pass);
  if (configs.sms?.accessKeySecret) configs.sms.accessKeySecret = decryptValue(configs.sms.accessKeySecret);
  if (configs.wecom?.secret) configs.wecom.secret = decryptValue(configs.wecom.secret);
  if (configs.ocr?.accessKeySecret) configs.ocr.accessKeySecret = decryptValue(configs.ocr.accessKeySecret);
  return configs;
};

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5180',
  'http://127.0.0.1:5180',
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  credentials: true,
  maxAge: 86400,
};

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
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
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const csrfProtection = csurf({
  cookie: {
    key: 'csrf_token',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.CSRF_SECURE === 'true',
  },
});

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/authorize') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return csrfProtection(req, res, next);
});

app.get('/api/auth/csrf', csrfProtection, (req, res) => {
  res.json({ token: req.csrfToken() });
});

const toMysqlDatetime = (date) =>
  date instanceof Date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;

const ensureBuiltinUsers = async () => {
  const hash = bcrypt.hashSync(BUILTIN_ACCOUNT_DEFAULT_PASSWORD, 10);
  for (const account of BUILTIN_ACCOUNTS) {
    const expectedAccess = defaultAppAccessByRole(account.role);
    const row = await db.get('SELECT id, role, app_access, is_active FROM users WHERE username = ?', [account.username]);
    if (!row) {
      await db.run('INSERT INTO users (username, password_hash, role, app_access, is_active) VALUES (?, ?, ?, ?, 1)', [
        account.username,
        hash,
        account.role,
        JSON.stringify(expectedAccess),
      ]);
      continue;
    }
    if (row.role !== account.role) {
      await db.run('UPDATE users SET role = ? WHERE id = ?', [account.role, row.id]);
    }
    const currentAccess = getUserAppAccess({ role: account.role, app_access: row.app_access });
    const expectedSorted = [...expectedAccess].sort().join(',');
    const currentSorted = [...currentAccess].sort().join(',');
    if (!row.app_access || currentSorted !== expectedSorted) {
      await db.run('UPDATE users SET app_access = ? WHERE id = ?', [JSON.stringify(expectedAccess), row.id]);
    }
    if (Number(row.is_active) !== 1) {
      await db.run('UPDATE users SET is_active = 1 WHERE id = ?', [row.id]);
    }
  }
};

const createToken = (user) =>
  jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });

const parseCookieToken = (req) => {
  const tokenFromCookie = String(req.cookies?.[AUTH_COOKIE_NAME] || '').trim();
  if (tokenFromCookie) return tokenFromCookie;
  const cookieHeader = String(req.headers.cookie || '');
  if (!cookieHeader) return '';
  const pairs = cookieHeader.split(';');
  for (const item of pairs) {
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const key = item.slice(0, idx).trim();
    if (key !== AUTH_COOKIE_NAME) continue;
    return decodeURIComponent(item.slice(idx + 1).trim());
  }
  return '';
};

const parseBearerToken = (authorization) => {
  const header = String(authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
};

const getRequestAuthToken = (req) => {
  const bearer = parseBearerToken(req.headers.authorization);
  if (bearer) return bearer;
  return parseCookieToken(req);
};

const getCookieSameSite = () => {
  if (AUTH_COOKIE_SAMESITE === 'none') return 'none';
  if (AUTH_COOKIE_SAMESITE === 'strict') return 'strict';
  return 'lax';
};

const buildAuthCookieOptions = () => ({
  httpOnly: true,
  secure: AUTH_COOKIE_SECURE,
  sameSite: getCookieSameSite(),
  path: '/',
});

const setAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions());
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: AUTH_COOKIE_SECURE,
    sameSite: getCookieSameSite(),
    path: '/',
  });
};

const authMiddleware = async (req, res, next) => {
  if (
    req.path === '/auth/login' ||
    req.path === '/auth/csrf' ||
    req.path === '/auth/captcha' ||
    req.path === '/auth/mfa/send' ||
    req.path === '/auth/mfa/verify' ||
    req.path === '/health'
  ) {
    return next();
  }
  const token = getRequestAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.get('SELECT id, is_active FROM users WHERE id = ?', [payload.id]);
    if (!user || Number(user.is_active) !== 1) {
      return res.status(401).json({ error: '账号已失效，请联系系统管理员' });
    }
    req.user = { ...payload, request_ip: getRequestIp(req) };
    return next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期' });
  }
};

app.use('/api', authMiddleware);

const buildUserScope = async (user) => {
  if (!user) return { isAdmin: false, customerIds: [], contactIds: [], phone: null };
  if (user.role === 'admin') return { isAdmin: true, customerIds: [], contactIds: [], phone: null };
  const dbUser = await db.get('SELECT id, phone FROM users WHERE id = ?', [user.id]);
  const phone = dbUser?.phone || null;
  if (!phone) return { isAdmin: false, customerIds: [], contactIds: [], phone: null };
  const contacts = await db.query(
    `SELECT c.id, cc.customer_id
     FROM contacts c
     JOIN contact_customers cc ON cc.contact_id = c.id
     WHERE c.phone = ?`,
    [phone]
  );
  const customerIds = Array.from(
    new Set(contacts.map((c) => Number(c.customer_id)).filter((id) => Number.isFinite(id)))
  );
  const contactIds = contacts.map((c) => Number(c.id)).filter((id) => Number.isFinite(id));
  return { isAdmin: false, customerIds, contactIds, phone };
};

const deny = (reason = '无权限') => ({ allow: false, reason });
const allow = (extra = {}) => ({ allow: true, ...extra });

const authorizeApiRole = (user, resource) => {
  const roles = Array.isArray(resource?.roles) ? resource.roles : [];
  if (!user || !roles.length) return deny();
  if (roles.includes(user.role)) return allow();
  return deny();
};

const authorizeReminder = (user, action, resource) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'reminder')) return deny('无权限访问授权到期提醒系统');
  if (user.role === 'admin') return allow();
  if (!['sales'].includes(user.role)) return deny('无业务权限');

  const bool = (v) => v === true;
  if (action === 'customer:create' || action === 'import:customers') return deny();
  if (action === 'customer:update' || action === 'customer:delete') {
    return bool(resource?.customer_in_scope) ? allow() : deny();
  }
  if (action === 'contact:create' || action === 'contact:update' || action === 'contact:delete') {
    return bool(resource?.customer_ids_in_scope) ? allow() : deny();
  }
  if (
    action === 'license:create' ||
    action === 'license:update' ||
    action === 'license:delete' ||
    action === 'license:screenshot:create' ||
    action === 'license:screenshot:delete' ||
    action === 'reminder-log:resend'
  ) {
    return bool(resource?.license_in_scope) ? allow() : deny();
  }
  if (
    action === 'send:manual' ||
    action === 'send-plan:create' ||
    action === 'send-plan:update' ||
    action === 'send-plan:delete' ||
    action === 'send-plan:send-now'
  ) {
    if (!bool(resource?.contacts_in_scope)) return deny();
    if (resource?.license_in_scope === undefined) return allow();
    return bool(resource?.license_in_scope) ? allow() : deny();
  }
  if (action === 'import:contacts') {
    return bool(resource?.customer_names_in_scope) ? allow() : deny();
  }
  if (action === 'import-job:read') {
    return bool(resource?.own_job) ? allow() : deny();
  }
  return deny('不支持的授权动作');
};

const authorizeTicketing = (user, action, resource) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'ticketing')) return deny('无权限访问工单管理系统');
  const isAdmin = user.role === 'admin';
  const isReadonlyAuditor = user.role === 'auditor';
  const isReadonlySysadmin = user.role === 'sysadmin';
  if (action === 'app:enter') return allow();
  const userId = Number(user.id);
  if (!Number.isFinite(userId)) return deny('无效用户');

  if (isReadonlyAuditor || isReadonlySysadmin) {
    if (action === 'ticket:audit') {
      return allow({ constraints: { ownOnly: false, readOnly: true } });
    }
    if (action === 'ticket:catalog' || action === 'ticket:dashboard' || action === 'ticket:list') {
      return allow({ constraints: { ownOnly: false, readOnly: true } });
    }
    if (action === 'project:list') {
      return allow({ constraints: { ownOnly: false, readOnly: true } });
    }
    if (action === 'project:permissions:read') {
      return allow({ constraints: { ownOnly: false, readOnly: true } });
    }
    if (action === 'ticket:notifications') {
      return allow({ constraints: { ownOnly: true, readOnly: true } });
    }
    if (action === 'template:list' || action === 'template:read') {
      return allow({ constraints: { readOnly: true } });
    }
    if (action === 'schedule:list') {
      return allow({ constraints: { ownOnly: false, readOnly: true } });
    }
    if (action === 'project:gantt') {
      if (resource?.project_exists === false) return deny('项目不存在');
      return allow({ constraints: { readOnly: true } });
    }
    if (action === 'ticket:read' || action === 'ticket:events') {
      if (resource?.ticket_exists === false) return deny('工单不存在');
      return allow({ constraints: { readOnly: true } });
    }
    return deny('该账号在工单系统仅支持查看');
  }

  if (action === 'ticket:create' || action === 'ticket:list' || action === 'schedule:create') {
    return allow({ constraints: { ownOnly: !isAdmin } });
  }
  if (action === 'ticket:notifications') {
    return allow({ constraints: { ownOnly: true } });
  }
  if (action === 'template:list' || action === 'template:read') {
    return allow();
  }
  if (action === 'template:import') {
    return isAdmin ? allow() : deny();
  }
  if (action === 'project:list') {
    return allow({ constraints: { ownOnly: !isAdmin } });
  }
  if (action === 'ticket:audit') {
    return isAdmin ? allow({ constraints: { ownOnly: false, readOnly: true } }) : deny();
  }
  if (action === 'project:permissions:read') {
    return isAdmin ? allow({ constraints: { ownOnly: false } }) : deny();
  }
  if (action === 'project:create' || action === 'project:update' || action === 'project:delete' || action === 'ticket:delete') {
    return isAdmin ? allow() : deny();
  }
  if (action === 'user:list') {
    return isAdmin ? allow() : deny();
  }
  if (action === 'ticket:assign' || action === 'ticket:assignees') {
    if (resource?.ticket_exists === false) return deny('工单不存在');
    const createdBy = Number(resource?.ticket_created_by);
    if (
      isAdmin ||
      (Number.isFinite(createdBy) && createdBy === userId) ||
      resource?.ticket_can_assign === true
    ) {
      return allow();
    }
    return deny();
  }
  if (action === 'schedule:list') {
    const targetEngineerId = Number(resource?.engineer_id);
    if (isAdmin) return allow({ constraints: { ownOnly: false } });
    if (!Number.isFinite(targetEngineerId) || targetEngineerId === userId) {
      return allow({ constraints: { ownOnly: true } });
    }
    return deny();
  }
  if (action === 'ticket:read' || action === 'ticket:events') {
    if (resource?.ticket_exists === false) return deny('工单不存在');
    const createdBy = Number(resource?.ticket_created_by);
    if (
      isAdmin ||
      (Number.isFinite(createdBy) && createdBy === userId) ||
      resource?.ticket_can_view === true
    ) {
      return allow();
    }
    return deny();
  }
  if (action === 'ticket:approval') {
    if (resource?.ticket_exists === false) return deny('工单不存在');
    const createdBy = Number(resource?.ticket_created_by);
    if (
      isAdmin ||
      (Number.isFinite(createdBy) && createdBy === userId) ||
      resource?.ticket_can_close === true
    ) {
      return allow();
    }
    return deny();
  }
  if (
    action === 'ticket:update' ||
    action === 'ticket:attach-schedule' ||
    action === 'ticket:generate-stages' ||
    action === 'ticket:stages' ||
    action === 'ticket:deliverables'
  ) {
    if (resource?.ticket_exists === false) return deny('工单不存在');
    const createdBy = Number(resource?.ticket_created_by);
    if (
      isAdmin ||
      (Number.isFinite(createdBy) && createdBy === userId) ||
      resource?.ticket_can_edit === true
    ) {
      return allow();
    }
    return deny();
  }
  if (action === 'ticket:catalog' || action === 'ticket:dashboard') {
    return allow({ constraints: { ownOnly: !isAdmin } });
  }
  if (action === 'project:gantt') {
    if (resource?.project_exists === false) return deny('项目不存在');
    if (isAdmin) return allow();
    if (resource?.project_can_view === true || resource?.project_has_owned_tickets === true) return allow();
    return deny();
  }
  if (action === 'schedule:assign') {
    const targetEngineerId = Number(resource?.engineer_id);
    if (!Number.isFinite(targetEngineerId)) return deny('工程师不能为空');
    if (!isAdmin && targetEngineerId !== userId) return deny();
    if (resource?.ticket_id !== undefined && resource?.ticket_id !== null) {
      if (resource?.ticket_exists === false) return deny('工单不存在');
      const createdBy = Number(resource?.ticket_created_by);
      if (
        !isAdmin &&
        (!Number.isFinite(createdBy) || createdBy !== userId) &&
        resource?.ticket_can_assign !== true
      ) {
        return deny();
      }
    }
    return allow();
  }
  return deny('不支持的授权动作');
};

const authorizeCMDB = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'cmdb')) return deny('无权限访问CMDB系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'ci:read') {
    return allow();
  }
  if (action === 'ci:write' || action === 'relation:write') {
    if (role === 'admin' || role === 'sysadmin') return allow();
    return deny('无权限执行CMDB写操作');
  }
  return deny('不支持的授权动作');
};

const authorizeInventory = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'inventory')) return deny('无权限访问库存管理系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'inventory:read') return allow();
  if (action === 'inventory:master:write' || action === 'inventory:txn:write') {
    if (role === 'admin' || role === 'sysadmin') return allow();
    return deny('无权限执行库存写操作');
  }
  return deny('不支持的授权动作');
};

const authorizeDeviceFlow = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'device-flow')) return deny('无权限访问设备流转系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'device_flow:read') return allow();
  if (action === 'device_flow:write') {
    if (role === 'admin' || role === 'sysadmin') return allow();
    return deny('无权限执行设备流转写操作');
  }
  return deny('不支持的授权动作');
};

const authorizeSecImpl = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'sec-impl')) return deny('无权限访问聚信实施记录系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'sec_impl:read') return allow();
  if (action === 'sec_impl:write') {
    if (role === 'admin' || role === 'sysadmin') return allow();
    return deny('无权限执行实施写操作');
  }
  return deny('不支持的授权动作');
};

app.get('/api/auth/introspect', async (req, res) => {
  const user = await db.get('SELECT id, username, role, app_access FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const scope = await buildUserScope(user);
  const apps = getUserAppAccess(user);
  res.json({ user: { id: user.id, username: user.username, role: user.role }, scope, apps });
});

app.post('/api/auth/authorize', async (req, res) => {
  const { system, action, resource } = req.body || {};
  const user = await db.get('SELECT id, username, role, app_access FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const scope = await buildUserScope(user);
  const apps = getUserAppAccess(user);

  let result = deny('不支持的授权系统');
  if (system === 'api') {
    result = authorizeApiRole(user, resource);
  } else if (system === 'reminder') {
    result = authorizeReminder(user, action, resource);
  } else if (system === 'ticketing') {
    result = authorizeTicketing(user, action, resource);
  } else if (system === 'cmdb') {
    result = authorizeCMDB(user, action);
  } else if (system === 'inventory') {
    result = authorizeInventory(user, action);
  } else if (system === 'device-flow') {
    result = authorizeDeviceFlow(user, action);
  } else if (system === 'sec-impl') {
    result = authorizeSecImpl(user, action);
  }
  return res.json({ ...result, user: { id: user.id, username: user.username, role: user.role }, scope, apps });
});

app.get('/api/auth/apps', async (req, res) => {
  const user = await db.get('SELECT id, username, role, app_access FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const reminderUrl = process.env.APP_REMINDER_URL || 'http://localhost:8080';
  const ticketingUrl = process.env.APP_TICKETING_URL || 'http://localhost:8081';
  const cmdbURL = process.env.APP_CMDB_URL || 'http://localhost:8090';
  const inventoryURL = process.env.APP_INVENTORY_URL || 'http://localhost:8082';
  const deviceFlowURL = process.env.APP_DEVICE_FLOW_URL || 'http://localhost:8083';
  const secImplURL = process.env.APP_SEC_IMPL_URL || 'http://localhost:8084';
  const appAccess = getUserAppAccess(user);
  const apps = [];
  if (appAccess.includes('reminder')) {
    apps.push({ key: 'reminder', name: '授权到期提醒系统', url: reminderUrl, allow: true });
  }
  if (appAccess.includes('ticketing')) {
    const ticketAuth = await authorizeTicketing(user, 'app:enter', {});
    apps.push({ key: 'ticketing', name: '工单管理系统', url: ticketingUrl, allow: !!ticketAuth.allow });
  }
  if (appAccess.includes('cmdb')) {
    apps.push({ key: 'cmdb', name: 'CMDB系统', url: cmdbURL, allow: true });
  }
  if (appAccess.includes('inventory')) {
    const inventoryAuth = await authorizeInventory(user, 'app:enter');
    apps.push({ key: 'inventory', name: '库存管理系统', url: inventoryURL, allow: !!inventoryAuth.allow });
  }
  if (appAccess.includes('device-flow')) {
    const deviceFlowAuth = await authorizeDeviceFlow(user, 'app:enter');
    apps.push({ key: 'device-flow', name: '设备流转系统', url: deviceFlowURL, allow: !!deviceFlowAuth.allow });
  }
  if (appAccess.includes('sec-impl')) {
    const secImplAuth = await authorizeSecImpl(user, 'app:enter');
    apps.push({ key: 'sec-impl', name: '聚信实施记录系统', url: secImplURL, allow: !!secImplAuth.allow });
  }
  return res.json({ apps: apps.filter((item) => item.allow) });
});

app.get('/portal', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const nonce = res.locals.cspNonce || '';
  const reminderUrl = process.env.APP_REMINDER_URL || 'http://localhost:8080';
  res.send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>聚信统一登录平台</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#f8fafc 0%,#e0ecff 60%,#ecfdf5 100%);color:#0f172a}
    .wrap{max-width:520px;margin:0 auto;padding:0 16px;min-height:100vh;display:flex;flex-direction:column;justify-content:center}
    .card{background:#fff;border:1px solid rgba(148,163,184,.28);border-radius:16px;padding:20px;box-shadow:0 10px 26px rgba(15,23,42,.08);margin-bottom:16px}
    .title{font-size:28px;font-weight:800;margin:0 0 8px}
    .brand-red{color:#d01c25}
    .brand-blue{color:#2563eb}
    .muted{color:#64748b}
    label{display:flex;flex-direction:column;gap:8px;margin:12px 0}
    input,select,button{border-radius:10px;border:1px solid rgba(148,163,184,.4);padding:0 12px;font-size:14px;height:40px}
    button{cursor:pointer}
    .primary{background:linear-gradient(135deg,#2563eb,#0ea5e9);color:#fff;border:none}
    .row{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:4px;align-items:center;width:100%}
    .captcha-title{display:block;font-size:24px;font-weight:600;line-height:1.2;margin:12px 0 8px}
    .app-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .app-item{border:1px solid rgba(148,163,184,.28);border-radius:12px;padding:12px;background:#f8fafc}
    .error{color:#dc2626;margin-top:10px}
    .hint{color:#64748b;margin-top:8px;font-size:13px}
    .login-actions{margin-top:12px;display:flex;justify-content:center}
    .login-actions .primary{min-width:120px}
    #username{width:448px;max-width:100%;box-sizing:border-box}
    .password-wrap{position:relative;width:448px;max-width:100%;box-sizing:border-box}
    .password-wrap input{width:100%;box-sizing:border-box;padding-right:42px}
    .password-toggle{
      position:absolute;top:50%;right:8px;transform:translateY(-50%);
      width:28px;height:28px;padding:0;border:none;background:transparent;color:#64748b;
      display:inline-flex;align-items:center;justify-content:center;border-radius:6px
    }
    .password-toggle:hover{color:#2563eb;background:rgba(37,99,235,.08)}
    .password-toggle:focus-visible{outline:2px solid rgba(37,99,235,.45);outline-offset:2px}
    .password-toggle svg{width:18px;height:18px;display:block}
    #captchaInput{width:100%;box-sizing:border-box}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card" id="loginCard">
      <h1 class="title"><span class="brand-red">聚信</span><span class="brand-blue">统一登录平台</span></h1>
      <div class="muted">登录后进入系统（管理员可选择，系统/审计管理员自动进入后台）。</div>
      <form id="loginForm">
        <label>账号<input id="username" placeholder="内置管理账号或手机号" /></label>
        <label>密码
          <div class="password-wrap">
            <input id="password" type="password" placeholder="请输入密码" />
            <button id="passwordToggle" class="password-toggle" type="button" aria-label="显示密码" title="显示密码">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path id="passwordToggleSlash" d="M4 20L20 4" style="display:none"></path>
              </svg>
            </button>
          </div>
        </label>
        <div class="captcha-title">验证码</div>
        <div class="row" id="captchaRow">
          <input id="captchaInput" placeholder="请输入验证码" />
          <img id="captchaImg" alt="captcha" style="width:120px;height:40px;object-fit:contain;border:0;border-radius:10px;padding:0;background:transparent;justify-self:end" />
        </div>
        <div class="login-actions"><button id="loginBtn" class="primary" type="submit" disabled>登录</button></div>
      </form>
      <div id="loginError" class="error"></div>
      <div id="captchaHint" class="hint">正在加载验证码...</div>
    </div>
    <div id="appsCard" class="card" style="display:none">
      <h2 style="margin:0 0 12px">选择系统</h2>
      <div id="apps" class="app-grid"></div>
    </div>
  </div>
  <script nonce="${nonce}">
    let csrfToken = '';
    let captchaToken = '';
    const portalParams = new URLSearchParams(window.location.search);
    const portalMode = String(portalParams.get('mode') || '').toLowerCase();
    const autoRedirectWindowMs = 8000;
    const loopbackHostSet = new Set(['localhost', '127.0.0.1']);
    const portalSessionStorageKey = 'juxin_portal_session';
    const portalSessionQueryKey = 'portal_session';
    function getPortalSessionMarker() {
      try {
        return String(sessionStorage.getItem(portalSessionStorageKey) || '').trim();
      } catch (_err) {
        return '';
      }
    }
    function createPortalSessionMarker() {
      try {
        const bytes = new Uint8Array(12);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      } catch (_err) {
        return String(Date.now()) + String(Math.random()).slice(2);
      }
    }
    function ensurePortalSessionMarker() {
      const current = getPortalSessionMarker();
      if (current) return current;
      const marker = createPortalSessionMarker();
      try {
        sessionStorage.setItem(portalSessionStorageKey, marker);
      } catch (_err) {
        return '';
      }
      return marker;
    }
    function appendPortalSession(rawUrl) {
      const appUrl = normalizeAppUrl(rawUrl);
      const marker = getPortalSessionMarker();
      if (!marker) return appUrl;
      try {
        const url = new URL(appUrl, window.location.origin);
        url.searchParams.set(portalSessionQueryKey, marker);
        return url.toString();
      } catch (_err) {
        return appUrl;
      }
    }
    function normalizeAppUrl(rawUrl) {
      try {
        const url = new URL(rawUrl, window.location.origin);
        const currentHost = String(window.location.hostname || '').trim();
        const targetHost = String(url.hostname || '').trim();
        if (
          currentHost &&
          targetHost &&
          currentHost !== targetHost &&
          (loopbackHostSet.has(currentHost) || loopbackHostSet.has(targetHost))
        ) {
          url.protocol = window.location.protocol;
          url.hostname = currentHost;
        }
        return url.toString();
      } catch (_err) {
        return rawUrl;
      }
    }
    function shouldThrottleRequestedRedirect(systemKey) {
      const key = String(systemKey || '').trim();
      if (!key) return false;
      try {
        const storageKey = 'portal_auto_redirect_' + key;
        const now = Date.now();
        const lastTs = Number(sessionStorage.getItem(storageKey) || 0);
        sessionStorage.setItem(storageKey, String(now));
        return Number.isFinite(lastTs) && now - lastTs < autoRedirectWindowMs;
      } catch (_err) {
        return false;
      }
    }
    function stripPortalTokenQuery(){
      const params = new URLSearchParams(window.location.search);
      let changed = false;
      if (params.has('sso_token')) {
        params.delete('sso_token');
        changed = true;
      }
      if (params.has('mode')) {
        params.delete('mode');
        changed = true;
      }
      if (!changed) return;
      const query = params.toString();
      const nextUrl = \`\${window.location.pathname}\${query ? \`?\${query}\` : ''}\${window.location.hash || ''}\`;
      window.history.replaceState({}, '', nextUrl);
    }
    function initPasswordToggle(){
      const passwordInput = document.getElementById('password');
      const toggle = document.getElementById('passwordToggle');
      const slash = document.getElementById('passwordToggleSlash');
      if (!passwordInput || !toggle) return;
      const sync = () => {
        const showing = passwordInput.type === 'text';
        if (slash) slash.style.display = showing ? 'block' : 'none';
        const label = showing ? '隐藏密码' : '显示密码';
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('title', label);
      };
      toggle.addEventListener('click', () => {
        passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
        sync();
        passwordInput.focus();
      });
      sync();
    }
    async function loadCsrf(){
      const r = await fetch('/api/auth/csrf', { credentials: 'include' });
      if (!r.ok) throw new Error('CSRF_INIT_FAILED');
      const d = await r.json();
      csrfToken = d.token || '';
      if (!csrfToken) throw new Error('CSRF_EMPTY');
    }
    async function loadCaptcha(){
      const row = document.getElementById('captchaRow');
      const img = document.getElementById('captchaImg');
      const input = document.getElementById('captchaInput');
      const hint = document.getElementById('captchaHint');
      const loginBtn = document.getElementById('loginBtn');
      if (loginBtn) loginBtn.disabled = true;
      if (hint) hint.textContent = '正在加载验证码...';
      try {
        const r = await fetch('/api/auth/captcha', { credentials: 'include' });
        const d = await r.json();
        if(!d || d.enabled === false){
          captchaToken = '';
          if(row) row.style.display = 'none';
          if(input) input.value = '';
          if(img) img.removeAttribute('src');
          if(hint) hint.textContent = '当前未启用登录验证码。';
          if(loginBtn) loginBtn.disabled = false;
          return;
        }
        captchaToken = d.token || '';
        if(row) row.style.display = 'grid';
        if(img){
          if (d.svg_base64) {
            img.src = 'data:image/svg+xml;base64,' + d.svg_base64;
          } else {
            img.src = d.svg ? ('data:image/svg+xml;utf8,' + encodeURIComponent(d.svg)) : '';
          }
        }
        if(hint) hint.textContent = '看不清可点击验证码刷新。';
        if(loginBtn) loginBtn.disabled = false;
      } catch (e) {
        captchaToken = '';
        if(row) row.style.display = 'none';
        if(input) input.value = '';
        if(img) img.removeAttribute('src');
        if(hint) hint.textContent = '验证码加载失败，请稍后重试。';
        if(loginBtn) loginBtn.disabled = true;
      }
    }
    function setError(msg){ document.getElementById('loginError').textContent = msg || ''; }
    async function login(evt){
      evt.preventDefault();
      setError('');
      await loadCsrf();
      const body = {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        captchaToken,
        captcha: document.getElementById('captchaInput').value,
      };
      const r = await fetch('/api/auth/login', {
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
        body:JSON.stringify(body),
      });
      const text = await r.text();
      let data = {};
      try{ data = JSON.parse(text || '{}'); }catch{}
      if(!r.ok){
        let msg = data.error || '';
        if (!msg) {
          msg = text.includes('invalid csrf token')
            ? '安全校验失败，请刷新后重试'
            : (text.replace(/<[^>]*>/g, '').trim() || '登录失败');
        }
        setError(msg.includes('账号') && msg.includes('密码') ? '账号密码错误' : msg);
        await loadCsrf();
        await loadCaptcha();
        return;
      }
      ensurePortalSessionMarker();
      await loadApps();
    }
    async function loadApps(){
      const r = await fetch('/api/auth/apps',{credentials:'include'});
      const text = await r.text();
      let data = {};
      try { data = JSON.parse(text || '{}'); } catch {}
      if (!r.ok) {
        throw new Error(data.error || '登录状态已失效');
      }
      const list = Array.isArray(data.apps)?data.apps:[];
      const requestedSystem = String(portalParams.get('system') || '').trim();
      const root = document.getElementById('apps');
      root.innerHTML = '';
      if (!list.length) {
        throw new Error('当前账号没有可进入的系统');
      }
      if (requestedSystem && portalMode !== 'switch') {
        const target = list.find((item) => item.key === requestedSystem);
        if (target) {
          if (shouldThrottleRequestedRedirect(requestedSystem)) {
            const loginCard = document.getElementById('loginCard');
            if (loginCard) loginCard.style.display = 'none';
            const msg = document.getElementById('loginError');
            if (msg) msg.textContent = '';
          } else {
            window.location.href = appendPortalSession(target.url);
            return;
          }
        }
      }
      list.forEach(app=>{
        const appUrl = appendPortalSession(app.url);
        const div = document.createElement('div');
        div.className = 'app-item';
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = '进入';
        btn.onclick = ()=>{ window.location.href = appUrl; };
        div.innerHTML = '<div style="font-weight:700;margin-bottom:8px">'+app.name+'</div>';
        div.appendChild(btn);
        root.appendChild(div);
      });
      document.getElementById('appsCard').style.display = 'block';
    }
    async function bootstrap(){
      const loginCard = document.getElementById('loginCard');
      stripPortalTokenQuery();
      if (!getPortalSessionMarker()) {
        if (loginCard) loginCard.style.display = 'block';
        await loadCsrf();
        await loadCaptcha();
        return;
      }
      if (portalMode === 'switch' && loginCard) loginCard.style.display = 'none';
      try {
        await loadApps();
        return;
      } catch (_err) {
        if (loginCard) loginCard.style.display = 'block';
      }
      await loadCsrf();
      await loadCaptcha();
    }
    document.getElementById('loginForm').addEventListener('submit', login);
    document.getElementById('captchaImg').addEventListener('click', loadCaptcha);
    initPasswordToggle();
    bootstrap();
  </script>
</body>
</html>`);
});

const logOperation = async ({ user, action, entity, entityId, beforeData, afterData, requestIp, system = 'sso' }) => {
  try {
    const userId = Number(user?.id || 0);
    const username = String(user?.username || 'system');
    const logSystem = String(system || 'sso').trim() || 'sso';
    const beforeText = beforeData === undefined ? null : stableStringify(beforeData);
    const afterText = afterData === undefined ? null : stableStringify(afterData);
    const sourceIp = String(
      requestIp
      || user?.request_ip
      || user?.requestIp
      || (afterData && typeof afterData === 'object' ? afterData.ip : '')
      || ''
    ).trim() || null;
    const createdAt = toMysqlDatetime(new Date());
    await db.transaction(async (trx) => {
      const prev = await trx.get('SELECT signature FROM operation_logs ORDER BY id DESC LIMIT 1 FOR UPDATE');
      const prevHash = prev?.signature || null;
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
  } catch (err) {
    // ignore logging failures
  }
};

const backfillOperationLogSignatures = async () => {
  const rows = await db.query(
    `SELECT id, user_id, username, action, entity, entity_id, before_data, after_data, prev_hash, signature, created_at
     FROM operation_logs
     ORDER BY id ASC`
  );
  let previousSignature = null;
  for (const row of rows) {
    if (!row.signature) {
      const desiredPrevHash = previousSignature || null;
      const desiredSignature = computeAuditSignature({
        id: row.id,
        prevHash: desiredPrevHash,
        userId: row.user_id,
        username: row.username,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        beforeData: row.before_data,
        afterData: row.after_data,
        createdAt: row.created_at,
      });
      await db.run(
        'UPDATE operation_logs SET prev_hash = ?, signature = ?, sign_version = ? WHERE id = ?',
        [desiredPrevHash, desiredSignature, 'v1', row.id]
      );
      previousSignature = desiredSignature;
    } else {
      previousSignature = row.signature;
    }
  }
};

const backfillOperationLogSystems = async () => {
  await db.run(
    `UPDATE operation_logs
     SET log_system = CASE
       WHEN entity IN ('工单', '项目', '项目权限', '工单模板', '排期')
         OR action IN ('创建项目', '更新项目', '删除项目', '更新项目权限', '导入模板', '创建排期')
         THEN 'ticketing'
       WHEN action IN (
         'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGIN_BLOCKED',
         'LOGIN_MFA_REQUIRED', 'MFA_SEND', 'MFA_SEND_FAILED', 'MFA_VERIFY_OK', 'MFA_VERIFY_FAILED',
         'TOTP_ENABLED'
       )
         THEN 'sso'
       ELSE 'reminder'
     END
     WHERE log_system IS NULL OR log_system = ''`
  );
};

const getRequestIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
};

const isLocked = ({ lockedUntilIso }) => {
  if (!lockedUntilIso) return false;
  const until = new Date(lockedUntilIso).getTime();
  return Number.isFinite(until) && until > Date.now();
};

const getConfigs = async () => {
  const rows = await db.query('SELECT `key`, value FROM send_configs');
  const configs = rows.reduce((acc, row) => {
    try {
      acc[row.key] = JSON.parse(row.value);
    } catch (err) {
      acc[row.key] = {};
    }
    return acc;
  }, {});
  return decryptSecrets(configs);
};

const getSecurityConfig = async () => {
  const configs = await getConfigs();
  const security = configs.security || {};
  const login = security.login || {};
  const mfa = security.mfa || {};
  const captcha = security.captcha || {};
  const maxAttempts = Number(login.maxAttempts ?? 5);
  const windowMinutes = Number(login.windowMinutes ?? 15);
  const lockMinutes = Number(login.lockMinutes ?? 15);
  const codeTtlSeconds = Number(mfa.codeTtlSeconds ?? 300);
  const captchaEnabled = captcha.enabled !== undefined ? !!captcha.enabled : true;
  const captchaTtlSeconds = Number(captcha.ttlSeconds ?? 300);
  return {
    login: {
      maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 5,
      windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : 15,
      lockMinutes: Number.isFinite(lockMinutes) ? lockMinutes : 15,
    },
    mfa: {
      codeTtlSeconds: Number.isFinite(codeTtlSeconds) ? codeTtlSeconds : 300,
    },
    captcha: {
      enabled: captchaEnabled,
      ttlSeconds: Number.isFinite(captchaTtlSeconds) ? captchaTtlSeconds : 300,
    },
  };
};

const checkLoginLock = async ({ username, ip }) => {
  const row = await db.get(
    `SELECT username, ip, fail_count, first_fail_at, locked_until
     FROM auth_login_attempts
     WHERE username = ? AND ip = ?`,
    [username, ip]
  );
  if (!row) return { locked: false };
  if (isLocked({ lockedUntilIso: row.locked_until })) {
    return { locked: true, locked_until: row.locked_until };
  }
  return { locked: false };
};

const recordLoginFailure = async ({ username, ip }) => {
  const security = await getSecurityConfig();
  const { maxAttempts, windowMinutes, lockMinutes } = security.login;
  const row = await db.get(
    `SELECT username, ip, fail_count, first_fail_at, locked_until
     FROM auth_login_attempts
     WHERE username = ? AND ip = ?`,
    [username, ip]
  );
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;

  let failCount = 0;
  let firstFailAt = toMysqlDatetime(new Date(now));
  if (row && row.first_fail_at) {
    const first = new Date(row.first_fail_at).getTime();
    if (Number.isFinite(first) && now - first <= windowMs) {
      failCount = Number(row.fail_count || 0);
      firstFailAt = row.first_fail_at;
    }
  }
  failCount += 1;

  let lockedUntil = null;
  if (failCount >= maxAttempts) {
    lockedUntil = toMysqlDatetime(new Date(now + lockMinutes * 60 * 1000));
  }
  await db.run(
    `INSERT INTO auth_login_attempts (username, ip, fail_count, first_fail_at, locked_until, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       fail_count = VALUES(fail_count),
       first_fail_at = VALUES(first_fail_at),
       locked_until = VALUES(locked_until),
       updated_at = NOW()`,
    [username, ip, failCount, firstFailAt, lockedUntil]
  );
  return { failCount, lockedUntil };
};

const clearLoginFailures = async ({ username, ip }) => {
  await db.run('DELETE FROM auth_login_attempts WHERE username = ? AND ip = ?', [username, ip]);
};

const randomDigits = (len) => {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String(bytes[i] % 10);
  }
  return out;
};

const randomCaptcha = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(4);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
};

const captchaSvg = (text) => {
  const fill = '#0f172a';
  const bg = '#ffffff';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44" viewBox="0 0 120 44">\n  <rect x="0" y="0" width="120" height="44" rx="10" fill="${bg}" stroke="#cbd5e1" />\n  <path d="M10 30 C 25 10, 45 50, 60 22 S 95 10, 110 28" fill="none" stroke="#93c5fd" stroke-width="2" opacity="0.8"/>\n  <path d="M12 18 C 28 40, 45 6, 62 28 S 92 42, 108 16" fill="none" stroke="#86efac" stroke-width="2" opacity="0.7"/>\n  <text x="60" y="29" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif" font-size="20" font-weight="700" fill="${fill}" letter-spacing="3">${text}</text>\n</svg>`;
};

const upsertCaptchaSession = async ({ token, codeHash, expiresAt }) => {
  await db.run(
    `INSERT INTO auth_captcha_sessions (token, code_hash, attempts, expires_at)
     VALUES (?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), attempts = 0, expires_at = VALUES(expires_at)`,
    [token, codeHash, expiresAt]
  );
};

const getCaptchaSession = async (token) => {
  return db.get(
    `SELECT token, code_hash, attempts, expires_at
     FROM auth_captcha_sessions
     WHERE token = ?`,
    [token]
  );
};

const deleteCaptchaSession = async (token) => {
  await db.run('DELETE FROM auth_captcha_sessions WHERE token = ?', [token]);
};

const verifyCaptcha = async ({ token, code }) => {
  const row = await getCaptchaSession(token);
  if (!row) return { ok: false, error: '验证码已过期，请刷新' };
  const exp = new Date(row.expires_at).getTime();
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    await deleteCaptchaSession(token);
    return { ok: false, error: '验证码已过期，请刷新' };
  }
  const attempts = Number(row.attempts || 0);
  if (attempts >= 5) {
    await deleteCaptchaSession(token);
    return { ok: false, error: '验证码错误次数过多，请刷新' };
  }
  const ok = bcrypt.compareSync(String(code || '').trim().toUpperCase(), row.code_hash);
  if (!ok) {
    await db.run('UPDATE auth_captcha_sessions SET attempts = ? WHERE token = ?', [attempts + 1, token]);
    return { ok: false, error: '验证码错误' };
  }
  await deleteCaptchaSession(token);
  return { ok: true };
};

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }
  return output;
};

const base32Decode = (str) => {
  const clean = String(str || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = base32Alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

const hotp = ({ secretBase32, counter, digits = 6 }) => {
  const secret = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(code % mod).padStart(digits, '0');
};

const totpVerify = ({ secretBase32, token, step = 30, window = 1 }) => {
  const t = Math.floor(Date.now() / 1000);
  const counter = Math.floor(t / step);
  const input = String(token || '').trim();
  if (!/^\d{6}$/.test(input)) return false;
  for (let w = -window; w <= window; w++) {
    if (hotp({ secretBase32, counter: counter + w, digits: 6 }) === input) return true;
  }
  return false;
};

const sendEmail = async ({ contact, subject, message, configs }) => {
  const email = configs.email || {};
  if (!email.host || !email.port || !email.user || !email.pass) {
    throw new Error('邮箱配置不完整');
  }
  if (!contact.email) {
    throw new Error('联系人没有邮箱');
  }
  const transporter = nodemailer.createTransport({
    host: email.host,
    port: Number(email.port),
    secure: String(email.secure) === 'true',
    auth: {
      user: email.user,
      pass: email.pass,
    },
  });
  await transporter.sendMail({
    from: email.from || email.user,
    to: contact.email,
    subject: subject || '到期提醒',
    text: message || '',
  });
};

const sendSmsAliyun = async ({ contact, message, subject, license, configs }) => {
  const sms = configs.sms || {};
  if (!sms.accessKeyId || !sms.accessKeySecret || !sms.signName || !sms.templateCode) {
    throw new Error('短信配置不完整');
  }
  if (!contact.phone) {
    throw new Error('联系人没有手机号');
  }
  const client = new RPCClient({
    accessKeyId: sms.accessKeyId,
    accessKeySecret: sms.accessKeySecret,
    endpoint: sms.endpoint || 'https://dysmsapi.aliyuncs.com',
    apiVersion: sms.apiVersion || '2017-05-25',
  });
  const buildTemplateParams = () => {
    try {
      if (sms.templateParams && typeof sms.templateParams === 'string') {
        return JSON.parse(sms.templateParams);
      }
    } catch (err) {
      // ignore
    }
    return { content: message };
  };
  const params = {
    PhoneNumbers: contact.phone,
    SignName: sms.signName,
    TemplateCode: sms.templateCode,
    TemplateParam: JSON.stringify(buildTemplateParams({ sms, contact, message, subject, license })),
  };
  await client.request('SendSms', params, { method: 'POST' });
};

let wecomTokenCache = { token: null, expiresAt: 0 };
const getWecomToken = async ({ corpId, secret }) => {
  const now = Date.now();
  if (wecomTokenCache.token && wecomTokenCache.expiresAt > now + 5000) {
    return wecomTokenCache.token;
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('企业微信获取token失败');
  }
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(`企业微信获取token失败: ${data.errmsg || data.errcode}`);
  }
  wecomTokenCache = { token: data.access_token, expiresAt: now + (data.expires_in || 0) * 1000 };
  return wecomTokenCache.token;
};

const sendWecomApp = async ({ contact, message, configs }) => {
  const wecom = configs.wecom || {};
  if (!wecom.corpId || !wecom.secret || !wecom.agentId) {
    throw new Error('企业微信应用配置不完整');
  }
  if (!contact.wecom_id) {
    throw new Error('联系人没有企业微信UserID');
  }
  const token = await getWecomToken({ corpId: wecom.corpId, secret: wecom.secret });
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
  const payload = {
    touser: contact.wecom_id,
    msgtype: 'text',
    agentid: Number(wecom.agentId),
    text: { content: message },
    safe: 0,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(`企业微信应用发送失败: ${data.errmsg || data.errcode}`);
  }
};

app.get('/api/auth/captcha', async (req, res) => {
  const security = await getSecurityConfig();
  if (!security.captcha.enabled) return res.json({ enabled: false });
  const token = crypto.randomBytes(18).toString('hex');
  const code = randomCaptcha();
  const ttlMs = security.captcha.ttlSeconds * 1000;
  const expiresAt = toMysqlDatetime(new Date(Date.now() + ttlMs));
  const codeHash = bcrypt.hashSync(code, 10);
  await upsertCaptchaSession({ token, codeHash, expiresAt });
  const svg = captchaSvg(code);
  const svgBase64 = Buffer.from(svg).toString('base64');
  res.json({ enabled: true, token, svg, svg_base64: svgBase64 });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, captchaToken, captcha } = req.body || {};
  const rawUsername = String(username || '').trim();
  if (!rawUsername || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  const security = await getSecurityConfig();
  if (security.captcha.enabled) {
    if (!captchaToken || !captcha) {
      return res.status(400).json({ error: '请输入验证码' });
    }
    const cap = await verifyCaptcha({ token: captchaToken, code: captcha });
    if (!cap.ok) {
      return res.status(400).json({ error: cap.error });
    }
  }
  const ip = getRequestIp(req);
  let loginId = rawUsername;
  let user = null;
  const normalizedUsername = rawUsername.toLowerCase();
  if (BUILTIN_ACCOUNT_USERNAMES.has(normalizedUsername)) {
    loginId = normalizedUsername;
    user = await db.get('SELECT * FROM users WHERE username = ?', [normalizedUsername]);
  } else {
    if (!/^\d{6,20}$/.test(rawUsername)) {
      return res.status(400).json({ error: '请使用手机号登录' });
    }
    loginId = rawUsername;
    user = await db.get('SELECT * FROM users WHERE phone = ?', [rawUsername]);
  }
  const lock = await checkLoginLock({ username: loginId, ip });
  if (lock.locked) {
    await logOperation({
      user: { id: 0, username: loginId, role: 'unknown' },
      action: 'LOGIN_LOCKED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: { username: loginId, ip, locked_until: lock.locked_until },
    });
    return res.status(429).json({ error: '登录失败次数过多，请稍后再试' });
  }
  if (!user) {
    const fail = await recordLoginFailure({ username: loginId, ip });
    await logOperation({
      user: { id: 0, username: loginId, role: 'unknown' },
      action: 'LOGIN_FAILED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: { username: loginId, ip, fail_count: fail.failCount, locked_until: fail.lockedUntil },
    });
    return res.status(400).json({ error: '账号或密码错误' });
  }
  if (Number(user.is_active) !== 1) {
    await logOperation({
      user: { id: user.id, username: user.username, role: user.role },
      action: 'LOGIN_BLOCKED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: { reason: 'DISABLED', username: loginId, ip },
    });
    return res.status(403).json({ error: '账号已被禁用，请联系系统管理员' });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    const fail = await recordLoginFailure({ username: loginId, ip });
    await logOperation({
      user: { id: user.id, username: user.username, role: user.role },
      action: 'LOGIN_FAILED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: { username: loginId, ip, fail_count: fail.failCount, locked_until: fail.lockedUntil },
    });
    return res.status(400).json({ error: '账号或密码错误' });
  }
  await clearLoginFailures({ username: loginId, ip });

  if (Number(user.mfa_enabled) === 1) {
    let desiredMethods = [];
    try {
      desiredMethods = JSON.parse(user.mfa_methods || '[]');
    } catch (err) {
      desiredMethods = [];
    }
    const configured = new Set();
    if (user.email) configured.add('email');
    if (user.phone) configured.add('sms');
    if (user.wecom_id) configured.add('wecom');
    if (user.totp_enabled === 1 && user.totp_secret) configured.add('totp');
    const methods = desiredMethods.filter((m) => configured.has(m));
    if (!desiredMethods.length) {
      return res.status(400).json({ error: '请先设置二次验证方式' });
    }
    if (methods.length === 0) {
      return res.status(400).json({
        error: '二次验证已开启，但当前账号未配置任何可用验证方式（请完善邮箱/手机号/企业微信或启用谷歌认证）',
      });
    }
    const mfaToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = toMysqlDatetime(new Date(Date.now() + 10 * 60 * 1000));
    await db.run(
      `INSERT INTO auth_mfa_sessions (token, user_id, username, methods_json, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [mfaToken, user.id, user.username, JSON.stringify(methods), expiresAt]
    );
    await logOperation({
      user,
      action: 'LOGIN_MFA_REQUIRED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: { username: user.username, ip, methods },
    });
    return res.json({
      mfaRequired: true,
      mfaToken,
      methods,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }

  const token = createToken(user);
  setAuthCookie(res, token);
  await logOperation({
    user,
    action: 'LOGIN',
    entity: 'auth',
    entityId: 0,
    requestIp: ip,
    afterData: { username: user.username, role: user.role },
  });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/mfa/send', async (req, res) => {
  const { mfaToken, method } = req.body || {};
  const requestIp = getRequestIp(req);
  if (!mfaToken || !method) return res.status(400).json({ error: '参数缺失' });
  const row = await db.get('SELECT * FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
  if (!row) return res.status(400).json({ error: '验证会话不存在或已过期' });
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.run('DELETE FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
    return res.status(400).json({ error: '验证会话已过期，请重新登录' });
  }
  let methods = [];
  try {
    methods = JSON.parse(row.methods_json || '[]');
  } catch (err) {
    methods = [];
  }
  if (!methods.includes(method)) return res.status(400).json({ error: '不支持的验证方式' });
  if (method === 'totp') return res.status(400).json({ error: '谷歌认证无需发送验证码' });

  if (row.sent_at) {
    const sentAt = new Date(row.sent_at).getTime();
    if (Number.isFinite(sentAt) && Date.now() - sentAt < 30 * 1000) {
      return res.status(429).json({ error: '发送过于频繁，请稍后再试' });
    }
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
  if (!user) return res.status(400).json({ error: '用户不存在' });

  const security = await getSecurityConfig();
  const code = randomDigits(6);
  const ttlMs = security.mfa.codeTtlSeconds * 1000;
  const codeExpiresAt = toMysqlDatetime(new Date(Date.now() + ttlMs));
  const codeHash = bcrypt.hashSync(code, 10);

  const configs = await getConfigs();
  const message = `登录验证码：${code}，${Math.round(ttlMs / 1000)}秒内有效。`;
  try {
    if (method === 'email') {
      await sendEmail({
        contact: { email: user.email, name: user.username },
        subject: '登录验证码',
        message,
        configs,
      });
    }
    if (method === 'sms') {
      await sendSmsAliyun({
        contact: { phone: user.phone, name: user.username },
        subject: '登录验证码',
        message,
        license: null,
        configs,
      });
    }
    if (method === 'wecom') {
      if (!configs.wecom?.corpId || !configs.wecom?.secret || !configs.wecom?.agentId) {
        throw new Error('企业微信应用配置不完整');
      }
      await sendWecomApp({
        contact: { wecom_id: user.wecom_id, name: user.username },
        message,
        configs,
      });
    }
  } catch (err) {
    logOperation({
      user: { id: user.id, username: user.username, role: user.role },
      action: 'MFA_SEND_FAILED',
      entity: 'auth',
      entityId: 0,
      requestIp,
      afterData: { method, error: err.message },
    });
    return res.status(400).json({ error: err.message || '发送失败' });
  }

  await db.run(
    `UPDATE auth_mfa_sessions
     SET method = ?, code_hash = ?, code_expires_at = ?, sent_at = NOW(), attempts = 0
     WHERE token = ?`,
    [method, codeHash, codeExpiresAt, mfaToken]
  );

  await logOperation({
    user: { id: user.id, username: user.username, role: user.role },
    action: 'MFA_SEND',
    entity: 'auth',
    entityId: 0,
    requestIp,
    afterData: { method },
  });
  res.json({ ok: true });
});

app.post('/api/auth/mfa/verify', async (req, res) => {
  const { mfaToken, method, code } = req.body || {};
  const requestIp = getRequestIp(req);
  if (!mfaToken || !method || !code) return res.status(400).json({ error: '参数缺失' });
  const row = await db.get('SELECT * FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
  if (!row) return res.status(400).json({ error: '验证会话不存在或已过期' });
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.run('DELETE FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
    return res.status(400).json({ error: '验证会话已过期，请重新登录' });
  }
  let methods = [];
  try {
    methods = JSON.parse(row.methods_json || '[]');
  } catch (err) {
    methods = [];
  }
  if (!methods.includes(method)) return res.status(400).json({ error: '不支持的验证方式' });

  const user = await db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
  if (!user) return res.status(400).json({ error: '用户不存在' });

  let ok = false;
  if (method === 'totp') {
    if (user.totp_enabled !== 1 || !user.totp_secret) {
      return res.status(400).json({ error: '该账号未启用谷歌认证' });
    }
    ok = totpVerify({ secretBase32: user.totp_secret, token: code, step: 30, window: 1 });
  } else {
    if (row.method !== method) return res.status(400).json({ error: '请先发送验证码' });
    if (!row.code_hash || !row.code_expires_at) return res.status(400).json({ error: '请先发送验证码' });
    const exp = new Date(row.code_expires_at).getTime();
    if (!Number.isFinite(exp) || exp <= Date.now()) return res.status(400).json({ error: '验证码已过期' });
    ok = bcrypt.compareSync(String(code).trim(), row.code_hash);
  }

  if (!ok) {
    const attempts = Number(row.attempts || 0) + 1;
    if (attempts >= 5) {
      await db.run('DELETE FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
    } else {
      await db.run('UPDATE auth_mfa_sessions SET attempts = ? WHERE token = ?', [attempts, mfaToken]);
    }
    await logOperation({
      user,
      action: 'MFA_VERIFY_FAILED',
      entity: 'auth',
      entityId: 0,
      requestIp,
      afterData: { method, attempts },
    });
    return res.status(400).json({ error: '验证码错误' });
  }

  await db.run('DELETE FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
  await logOperation({
    user,
    action: 'MFA_VERIFY_OK',
    entity: 'auth',
    entityId: 0,
    requestIp,
    afterData: { method },
  });
  const token = createToken(user);
  setAuthCookie(res, token);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/totp/setup', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(400).json({ error: '用户不存在' });
  const secret = base32Encode(crypto.randomBytes(20));
  await db.run(
    'INSERT INTO auth_totp_pending (user_id, secret) VALUES (?, ?) ON DUPLICATE KEY UPDATE secret = VALUES(secret), created_at = NOW()',
    [user.id, secret]
  );
  const issuer = encodeURIComponent('Juxin');
  const label = encodeURIComponent(`${user.username}`);
  const otpauth = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
  res.json({ secret, otpauth });
});

app.post('/api/auth/totp/enable', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: '请输入验证码' });
  const pending = await db.get('SELECT * FROM auth_totp_pending WHERE user_id = ?', [req.user.id]);
  if (!pending) return res.status(400).json({ error: '请先获取谷歌认证密钥' });
  const ok = totpVerify({ secretBase32: pending.secret, token: code, step: 30, window: 1 });
  if (!ok) return res.status(400).json({ error: '验证码错误' });
  await db.run('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?', [pending.secret, req.user.id]);
  await db.run('DELETE FROM auth_totp_pending WHERE user_id = ?', [req.user.id]);
  await logOperation({
    user: req.user,
    action: 'TOTP_ENABLED',
    entity: 'user',
    entityId: Number(req.user.id),
  });
  res.json({ ok: true });
});

app.get('/api/auth/mfa/settings', async (req, res) => {
  const user = await db.get(
    'SELECT id, mfa_enabled, mfa_methods, totp_enabled, email, phone, wecom_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(400).json({ error: '用户不存在' });
  let methods = [];
  try {
    methods = JSON.parse(user.mfa_methods || '[]');
  } catch (err) {
    methods = [];
  }
  res.json({
    enabled: Number(user.mfa_enabled) === 1,
    methods,
    totp_enabled: Number(user.totp_enabled) === 1,
    has_email: !!user.email,
    has_phone: !!user.phone,
    has_wecom: !!user.wecom_id,
  });
});

app.post('/api/auth/mfa/settings', async (req, res) => {
  const { enabled, methods } = req.body || {};
  const user = await db.get(
    'SELECT id, mfa_enabled, mfa_methods, totp_enabled, email, phone, wecom_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(400).json({ error: '用户不存在' });
  const allowed = new Set(['email', 'sms', 'wecom', 'totp']);
  const nextMethods = Array.isArray(methods) ? methods.filter((m) => allowed.has(m)) : [];
  const nextEnabled = enabled === true || enabled === 1 || enabled === '1';
  if (nextEnabled && nextMethods.length === 0) {
    return res.status(400).json({ error: '请选择至少一种验证方式' });
  }
  if (nextMethods.includes('email') && !user.email) {
    return res.status(400).json({ error: '邮箱未配置，无法启用邮箱验证' });
  }
  if (nextMethods.includes('sms') && !user.phone) {
    return res.status(400).json({ error: '手机号未配置，无法启用短信验证' });
  }
  if (nextMethods.includes('wecom') && !user.wecom_id) {
    return res.status(400).json({ error: '企业微信未配置，无法启用企业微信验证' });
  }
  if (nextMethods.includes('totp') && Number(user.totp_enabled) !== 1) {
    return res.status(400).json({ error: '谷歌认证未启用，无法选择谷歌认证' });
  }
  await db.run('UPDATE users SET mfa_enabled = ?, mfa_methods = ? WHERE id = ?', [
    nextEnabled ? 1 : 0,
    JSON.stringify(nextMethods),
    req.user.id,
  ]);
  await logOperation({
    user: req.user,
    action: 'UPDATE',
    entity: 'user_mfa',
    entityId: Number(req.user.id),
    afterData: { enabled: nextEnabled, methods: nextMethods },
  });
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await db.get('SELECT id, username, role, app_access FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.json(null);
  res.json({ id: user.id, username: user.username, role: user.role, app_access: getUserAppAccess(user) });
});

app.post('/api/auth/logout', async (req, res) => {
  clearAuthCookie(res);
  await logOperation({
    user: req.user,
    action: 'LOGOUT',
    entity: 'auth',
    entityId: 0,
  });
  res.json({ ok: true });
});

app.post('/api/auth/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '请输入当前密码和新密码' });
  }
  const passwordRuleError = validatePasswordComplexity(newPassword);
  if (passwordRuleError) {
    return res.status(400).json({ error: passwordRuleError });
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(400).json({ error: '用户不存在' });
  const ok = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!ok) return res.status(400).json({ error: '当前密码错误' });
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
  await logOperation({
    user: req.user,
    action: 'CHANGE_PASSWORD',
    entity: 'user',
    entityId: Number(req.user.id),
  });
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: '安全校验失败，请刷新后重试' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS错误：当前域名未被允许' });
  }
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: err.message || '服务器内部错误' });
});

const start = async () => {
  await db.ready;
  await ensureBuiltinUsers();
  await backfillOperationLogSignatures();
  await backfillOperationLogSystems();
  app.listen(PORT, () => {
    console.log(`Auth server running at http://localhost:${PORT}`);
  });
};

start();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const db = require('./db');
const nodemailer = require('nodemailer');
const RPCClient = require('@alicloud/pop-core');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const crypto = require('crypto');
const net = require('net');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('./cors-origin');
const {
  buildHelmetCspDirectives,
} = require('./helmet-csp');
const {
  resolveSecurityStrictMode,
} = require('./security-strict-mode');

const app = express();
const PORT = process.env.PORT || 5179;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const CONFIG_SECRET_KEY = process.env.CONFIG_SECRET_KEY || '';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth:5180';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_FETCH_TIMEOUT_MS = Number(process.env.AUTH_FETCH_TIMEOUT_MS || 4000);
const SECRET_MASK = '******';
const SYSTEM_ACCESS_KEYS = ['reminder', 'ticketing', 'cmdb', 'inventory', 'device-flow', 'sec-impl', 'faq', 'tender', 'train-exam'];
const BUILTIN_ACCOUNT_DEFAULT_PASSWORD = process.env.BUILTIN_ACCOUNT_DEFAULT_PASSWORD || '123456';
const BUILTIN_ACCOUNTS = [
  { username: 'admin', role: 'admin' },
  { username: 'sysadmin', role: 'sysadmin' },
  { username: 'auditor', role: 'auditor' },
  { username: 'editor', role: 'editor' },
];
const BUILTIN_ACCOUNT_USERNAMES = new Set(BUILTIN_ACCOUNTS.map((item) => item.username));
const ALLOWED_USER_ROLES = new Set(['admin', 'editor', 'sysadmin', 'auditor', 'user', 'viewer', 'sales']);
const AUDIT_SIGNING_KEY = process.env.AUDIT_SIGNING_KEY || JWT_SECRET;
const SECURITY_STRICT_MODE = resolveSecurityStrictMode(process.env);
const MAX_IMPORT_RECORDS = Number(process.env.MAX_IMPORT_RECORDS || 5000);
const IMPORT_UPLOAD_MAX_BYTES = Number(process.env.IMPORT_UPLOAD_MAX_BYTES || 3 * 1024 * 1024);
const SCREENSHOT_UPLOAD_MAX_BYTES = Number(process.env.SCREENSHOT_UPLOAD_MAX_BYTES || 5 * 1024 * 1024);
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 30);
const IMPORT_RATE_LIMIT_WINDOW_MS = Number(process.env.IMPORT_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const IMPORT_RATE_LIMIT_MAX = Number(process.env.IMPORT_RATE_LIMIT_MAX || 10);
const UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const UPLOAD_RATE_LIMIT_MAX = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 20);
const ALLOW_XLSX_IMPORT = process.env.ALLOW_XLSX_IMPORT === 'true' && !SECURITY_STRICT_MODE;

const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);
const DEFAULT_PASSWORD_POLICY = Object.freeze({
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
});
const DEFAULT_SESSION_TIMEOUT_MINUTES = 7 * 24 * 60;
const PRIVILEGED_IP_LIMIT_ROLES = new Set(['admin', 'sysadmin', 'auditor']);

const isWeakSecret = (value, minLength = 16) => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length < minLength) return true;
  return weakSecrets.has(text.toLowerCase());
};

const validateSecurityBootstrap = () => {
  const problems = [];
  if (isWeakSecret(JWT_SECRET, 32)) problems.push('JWT_SECRET 过弱（生产建议至少32位随机值）');
  if (isWeakSecret(AUDIT_SIGNING_KEY, 32)) problems.push('AUDIT_SIGNING_KEY 过弱（生产建议至少32位随机值）');
  if (isWeakSecret(CONFIG_SECRET_KEY, 32)) problems.push('CONFIG_SECRET_KEY 过弱（生产建议至少32位随机值）');
  if (String(BUILTIN_ACCOUNT_DEFAULT_PASSWORD || '').trim() === '123456') {
    problems.push('BUILTIN_ACCOUNT_DEFAULT_PASSWORD 仍为默认值');
  }
  if (!problems.length) return;
  const text = `[SECURITY] ${problems.join('；')}`;
  if (SECURITY_STRICT_MODE) {
    throw new Error(text);
  }
  console.warn(`${text}。当前为非严格模式，仅告警。`);
};

const clampNumber = (value, fallback, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
};

const normalizePasswordPolicy = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    minLength: clampNumber(source.minLength, DEFAULT_PASSWORD_POLICY.minLength, 6, 64),
    requireUppercase: source.requireUppercase !== false,
    requireLowercase: source.requireLowercase !== false,
    requireNumber: source.requireNumber !== false,
    requireSpecial: source.requireSpecial !== false,
  };
};

const buildPasswordComplexityHint = (policy) => {
  const requirements = [];
  if (policy.requireUppercase) requirements.push('大写字母');
  if (policy.requireLowercase) requirements.push('小写字母');
  if (policy.requireNumber) requirements.push('数字');
  if (policy.requireSpecial) requirements.push('特殊字符');
  if (!requirements.length) return `密码至少${policy.minLength}位`;
  return `密码至少${policy.minLength}位，且需包含${requirements.join('、')}`;
};

const normalizeClientIp = (raw) => {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (text.includes(',')) {
    text = text.split(',')[0].trim();
  }
  if (text.startsWith('[') && text.includes(']')) {
    text = text.slice(1, text.indexOf(']')).trim();
  }
  const zoneIdx = text.indexOf('%');
  if (zoneIdx > 0) text = text.slice(0, zoneIdx);
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(text)) {
    text = text.replace(/^::ffff:/i, '');
  }
  if (text === '::1') return '127.0.0.1';
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) {
    text = text.replace(/:\d+$/, '');
  }
  return net.isIP(text) ? text.toLowerCase() : '';
};

const expandIpv6 = (ip) => {
  const parts = String(ip || '').split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  const fillCount = 8 - left.length - right.length;
  if (fillCount < 0) return null;
  const all = parts.length === 1 ? left : [...left, ...Array(fillCount).fill('0'), ...right];
  if (all.length !== 8) return null;
  if (!all.every((item) => /^[0-9a-f]{1,4}$/i.test(item))) return null;
  return all;
};

const ipToBigInt = (ip, family) => {
  if (family === 4) {
    return String(ip)
      .split('.')
      .reduce((acc, item) => (acc << 8n) + BigInt(Number(item)), 0n);
  }
  if (family === 6) {
    const items = expandIpv6(ip);
    if (!items) return null;
    return items.reduce((acc, item) => (acc << 16n) + BigInt(parseInt(item, 16)), 0n);
  }
  return null;
};

const normalizeIpRule = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (!text.includes('/')) return normalizeClientIp(text);
  const [baseRaw, prefixRaw] = text.split('/');
  const base = normalizeClientIp(baseRaw);
  if (!base) return '';
  const family = net.isIP(base);
  const maxPrefix = family === 4 ? 32 : 128;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return '';
  return `${base}/${prefix}`;
};

const parseIpAllowlist = (raw) => {
  let items = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) items = [];
    else {
      try {
        const parsed = JSON.parse(text);
        items = Array.isArray(parsed) ? parsed : text.split(/[\n,;]+/);
      } catch (_err) {
        items = text.split(/[\n,;]+/);
      }
    }
  }
  return Array.from(new Set(items.map((item) => normalizeIpRule(item)).filter(Boolean)));
};

const normalizeRoleIpAllowlist = (security) => {
  const source = security && typeof security === 'object' ? security : {};
  const roleSource = source.roleIpAllowlist && typeof source.roleIpAllowlist === 'object'
    ? source.roleIpAllowlist
    : {};
  return {
    admin: parseIpAllowlist(roleSource.admin ?? source.adminIpAllowlist),
    sysadmin: parseIpAllowlist(roleSource.sysadmin ?? source.sysadminIpAllowlist),
    auditor: parseIpAllowlist(roleSource.auditor ?? source.auditorIpAllowlist),
  };
};

const isIpMatchRule = (ip, rule) => {
  if (!ip || !rule) return false;
  if (!rule.includes('/')) return ip === rule;
  const [base, prefixText] = rule.split('/');
  const prefix = Number(prefixText);
  const family = net.isIP(base);
  if (!family || net.isIP(ip) !== family) return false;
  const maxBits = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) return false;
  const ipNum = ipToBigInt(ip, family);
  const baseNum = ipToBigInt(base, family);
  if (ipNum === null || baseNum === null) return false;
  const shift = BigInt(maxBits - prefix);
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << shift;
  return (ipNum & mask) === (baseNum & mask);
};

const checkRoleIpAccess = ({ role, ip, securityConfig }) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!PRIVILEGED_IP_LIMIT_ROLES.has(normalizedRole)) {
    return { enforced: false, allowed: true, allowlist: [] };
  }
  const allowlist = Array.isArray(securityConfig?.roleIpAllowlist?.[normalizedRole])
    ? securityConfig.roleIpAllowlist[normalizedRole]
    : [];
  if (!allowlist.length) {
    return { enforced: false, allowed: true, allowlist: [] };
  }
  const normalizedIp = normalizeClientIp(ip);
  const allowed = !!normalizedIp && allowlist.some((rule) => isIpMatchRule(normalizedIp, rule));
  return { enforced: true, allowed, allowlist, normalizedIp };
};

const extractRequestIp = (req) => {
  const xff = req.headers?.['x-forwarded-for'];
  const xri = req.headers?.['x-real-ip'];
  const candidate =
    (Array.isArray(xff) ? xff[0] : xff) ||
    (Array.isArray(xri) ? xri[0] : xri) ||
    req.ip ||
    req.socket?.remoteAddress ||
    '';
  const normalized = normalizeClientIp(candidate);
  return normalized || 'unknown';
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

const detectImageMimeByMagic = (buffer) => {
  if (!buffer || buffer.length < 12) return '';
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (isPng) return 'image/png';
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (isJpeg) return 'image/jpeg';
  return '';
};

const isBuiltinUsername = (username) => BUILTIN_ACCOUNT_USERNAMES.has(String(username || '').toLowerCase());

const validatePasswordComplexity = (password, policyInput = DEFAULT_PASSWORD_POLICY) => {
  const value = String(password || '');
  const policy = normalizePasswordPolicy(policyInput);
  if (value.length < policy.minLength) return buildPasswordComplexityHint(policy);
  if (policy.requireUppercase && !/[A-Z]/.test(value)) return '密码需包含至少1个大写字母';
  if (policy.requireLowercase && !/[a-z]/.test(value)) return '密码需包含至少1个小写字母';
  if (policy.requireNumber && !/\d/.test(value)) return '密码需包含至少1个数字';
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(value)) return '密码需包含至少1个特殊字符';
  return '';
};

const validateUsernameFormat = (username) => {
  const value = String(username || '').trim();
  if (!value) return '用户名不能为空';
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(value)) {
    return '用户名仅支持2-32位中文、字母、数字、下划线或中划线';
  }
  return '';
};

const validateEmailFormat = (email) => {
  const value = String(email || '').trim();
  if (!value) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '邮箱格式不正确';
  return '';
};

const validatePhoneFormat = (phone) => {
  const value = String(phone || '').trim();
  if (!value) return '';
  if (!/^\d{6,20}$/.test(value)) return '手机号格式不正确（6-20位数字）';
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
    // fall through to comma-separated parsing
  }
  return text.split(',').map((item) => item.trim());
};

const normalizeUserRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'viewer') return 'user';
  return r;
};

const defaultAppAccessByRole = (role = 'user') => {
  const r = normalizeUserRole(role);
  if (r === 'admin') return [...SYSTEM_ACCESS_KEYS];
  if (r === 'editor') return ['faq', 'tender', 'train-exam'];
  if (r === 'sysadmin') return ['reminder', 'sec-impl', 'tender', 'train-exam'];
  if (r === 'auditor') return ['reminder', 'ticketing', 'cmdb', 'inventory', 'device-flow', 'sec-impl', 'faq', 'tender', 'train-exam'];
  return ['reminder'];
};

const normalizeAppAccess = (value, role = 'user') => {
  const normalizedRole = normalizeUserRole(role);
  if (normalizedRole === 'admin') return [...SYSTEM_ACCESS_KEYS];
  const parsed = parseAppAccessRaw(value);
  const source = parsed === null ? defaultAppAccessByRole(normalizedRole) : parsed;
  return Array.from(
    new Set(source.map((item) => String(item || '').trim()).filter((item) => SYSTEM_ACCESS_KEYS.includes(item)))
  );
};

const resolveUserLoginId = (user) => {
  const username = String(user?.username || '').trim().toLowerCase();
  if (BUILTIN_ACCOUNT_USERNAMES.has(username)) return username;
  const phone = String(user?.phone || '').trim();
  if (/^\d{6,20}$/.test(phone)) return phone;
  return '';
};

const formatUserRow = (row) => {
  if (!row) return row;
  return {
    ...row,
    role: normalizeUserRole(row.role),
    app_access: normalizeAppAccess(row.app_access, row.role),
  };
};

const MFA_METHODS = ['email', 'sms', 'wecom', 'totp'];

const parseUserMfaMethods = (raw) => {
  let parsed = [];
  if (Array.isArray(raw)) {
    parsed = raw;
  } else {
    const text = String(raw || '').trim();
    if (!text) return [];
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) parsed = data;
    } catch (_err) {
      parsed = text.split(',').map((item) => item.trim());
    }
  }
  return Array.from(new Set(parsed.map((item) => String(item || '').trim()).filter((item) => MFA_METHODS.includes(item))));
};

const collectUserAvailableMfaMethods = (user) => {
  const available = [];
  if (user?.email) available.push('email');
  if (user?.phone) available.push('sms');
  if (user?.wecom_id) available.push('wecom');
  if (Number(user?.totp_enabled) === 1 && user?.totp_secret) available.push('totp');
  return available;
};

const resolveUserMfaStatus = ({ user, securityConfig }) => {
  const desiredMethods = parseUserMfaMethods(user?.mfa_methods);
  const availableMethods = collectUserAvailableMfaMethods(user);
  const availableSet = new Set(availableMethods);
  const enabled = Number(user?.mfa_enabled) === 1;
  const effectiveMethods = desiredMethods.filter((method) => availableSet.has(method));
  const forceAllUsers = !!securityConfig?.mfa?.forceAllUsers;
  const setupRequired = forceAllUsers && (!enabled || !desiredMethods.length || !effectiveMethods.length);
  return {
    enabled,
    forceAllUsers,
    setupRequired,
    desiredMethods,
    availableMethods,
    effectiveMethods,
  };
};

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

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
].map(normalizeOrigin);
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOptions = (req, cb) => {
  const origin = req.headers.origin;
  const allowed = isOriginAllowedForRequest({
    origin,
    headers: req.headers,
    allowedOrigins,
    defaultOrigins,
  });
  if (!allowed) return cb(new Error('Not allowed by CORS'));
  return cb(null, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true,
    maxAge: 86400,
  });
};

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: buildHelmetCspDirectives(),
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
app.use(cookieParser());
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_UPLOAD_MAX_BYTES },
});
const uploadsDir = path.join(__dirname, 'uploads');
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SCREENSHOT_UPLOAD_MAX_BYTES },
});
const authRateLimiter = createIpRateLimiter({
  name: 'auth',
  windowMs: Math.max(1000, AUTH_RATE_LIMIT_WINDOW_MS),
  max: Math.max(1, AUTH_RATE_LIMIT_MAX),
});
const importRateLimiter = createIpRateLimiter({
  name: 'import',
  windowMs: Math.max(1000, IMPORT_RATE_LIMIT_WINDOW_MS),
  max: Math.max(1, IMPORT_RATE_LIMIT_MAX),
});
const uploadRateLimiter = createIpRateLimiter({
  name: 'upload',
  windowMs: Math.max(1000, UPLOAD_RATE_LIMIT_WINDOW_MS),
  max: Math.max(1, UPLOAD_RATE_LIMIT_MAX),
});

const csrfProtection = csurf({
  cookie: {
    key: 'csrf_token',
    httpOnly: true,
    sameSite: 'strict',
    secure:
      process.env.CSRF_SECURE === 'true' ||
      (SECURITY_STRICT_MODE && process.env.CSRF_SECURE !== 'false'),
  },
});

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return csrfProtection(req, res, next);
});

app.get('/api/auth/csrf', csrfProtection, (req, res) => {
  res.json({ token: req.csrfToken() });
});

const parseImportFile = (file) => {
  const name = (file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls');
  const isCsv = name.endsWith('.csv');
  if (!isExcel && !isCsv) {
    throw new Error('仅支持 CSV 或 Excel 文件');
  }
  if (isExcel) {
    if (!ALLOW_XLSX_IMPORT) {
      throw new Error('安全模式下已禁用Excel导入，请使用CSV导入');
    }
    const allowedExcelMime = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
      '',
    ]);
    if (!allowedExcelMime.has(mime)) {
      throw new Error('Excel 文件类型无效');
    }
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
    if (rows.length > MAX_IMPORT_RECORDS) {
      throw new Error(`单次导入最多 ${MAX_IMPORT_RECORDS} 行`);
    }
    return rows;
  }
  const allowedCsvMime = new Set([
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/octet-stream',
    '',
  ]);
  if (!allowedCsvMime.has(mime)) {
    throw new Error('CSV 文件类型无效');
  }
  const content = file.buffer.toString('utf8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  if (rows.length > MAX_IMPORT_RECORDS) {
    throw new Error(`单次导入最多 ${MAX_IMPORT_RECORDS} 行`);
  }
  return rows;
};

const resolveScreenshotFilePath = (urlValue) => {
  const url = String(urlValue || '').trim();
  if (!url.startsWith('/uploads/')) return null;
  const filename = path.basename(url);
  if (!filename) return null;
  const fullPath = path.join(uploadsDir, filename);
  const normalizedRoot = path.resolve(uploadsDir);
  const normalizedFull = path.resolve(fullPath);
  if (!normalizedFull.startsWith(normalizedRoot)) return null;
  return { filename, fullPath: normalizedFull };
};

const cleanupScreenshotFile = async (urlValue) => {
  const resolved = resolveScreenshotFilePath(urlValue);
  if (!resolved) return;
  try {
    await fs.promises.unlink(resolved.fullPath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[SECURITY] 删除旧截图失败', err.message || err);
    }
  }
};

const toJson = (row) => (row ? { ...row } : null);

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
    const currentAccess = normalizeAppAccess(row.app_access, account.role);
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

const createToken = async (user, securityConfig = null) => {
  const security = securityConfig || await getSecurityConfig();
  const timeoutMinutes = clampNumber(
    security?.session?.timeoutMinutes,
    DEFAULT_SESSION_TIMEOUT_MINUTES,
    5,
    DEFAULT_SESSION_TIMEOUT_MINUTES
  );
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: timeoutMinutes * 60,
  });
};

const extractAuthToken = (req) => {
  const header = String(req.headers.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match && String(match[1] || '').trim()) return String(match[1]).trim();

  const cookieToken = String(req.cookies?.[AUTH_COOKIE_NAME] || '').trim();
  if (cookieToken) return cookieToken;

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

const authMiddleware = (req, res, next) => {
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
  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  fetchWithTimeout(`${AUTH_SERVICE_URL}/api/auth/introspect`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (resp) => {
      if (!resp.ok) {
        if (resp.status === 403) {
          let payload = null;
          try {
            payload = await resp.json();
          } catch (_err) {
            payload = null;
          }
          return res.status(403).json({ error: payload?.error || payload?.reason || '无权限访问当前系统' });
        }
        return res.status(401).json({ error: '登录已过期' });
      }
      const data = await resp.json();
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      if (!apps.includes('reminder')) {
        return res.status(403).json({ error: '无权限访问授权到期提醒系统' });
      }
      req.user = data?.user ? { ...data.user, request_ip: getRequestIp(req) } : null;
      req.scope = data?.scope || null;
      req.apps = apps;
      return next();
    })
    .catch(() => res.status(401).json({ error: '登录已过期' }));
};

const requireRole = (roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  const token = extractAuthToken(req);
  if (!token) return res.status(401).json({ error: '未登录' });
  fetchWithTimeout(`${AUTH_SERVICE_URL}/api/auth/authorize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      system: 'api',
      action: 'role:any',
      resource: { roles },
    }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        if (resp.status === 403) {
          let payload = null;
          try {
            payload = await resp.json();
          } catch (_err) {
            payload = null;
          }
          return res.status(403).json({ error: payload?.reason || payload?.error || '无权限' });
        }
        return res.status(401).json({ error: '登录已过期' });
      }
      const data = await resp.json();
      if (!data?.allow) return res.status(403).json({ error: data?.reason || '无权限' });
      return next();
    })
    .catch(() => res.status(500).json({ error: '权限服务不可用' }));
};

const authorizeReminderAction = async (req, action, resource = {}) => {
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
        system: 'reminder',
        action,
        resource,
      }),
    });
    if (!resp.ok) {
      if (resp.status === 403) {
        const payload = await resp.json().catch(() => null);
        return { allow: false, reason: payload?.reason || payload?.error || '无权限' };
      }
      return { allow: false, reason: '登录已过期' };
    }
    const data = await resp.json();
    return data || { allow: false, reason: '无权限' };
  } catch (err) {
    return { allow: false, reason: '权限服务不可用' };
  }
};

app.use('/api', authMiddleware);

const buildInClause = (values = []) => values.map(() => '?').join(',');

const applyScopeFilter = ({ scope, where, params, column = 'customers.id' }) => {
  if (!scope || scope.isAdmin) return;
  const ids = Array.isArray(scope.customerIds) ? scope.customerIds : [];
  if (!ids.length) {
    where.push('1=0');
    return;
  }
  where.push(`${column} IN (${buildInClause(ids)})`);
  params.push(...ids);
};

// Auth
app.get('/api/auth/captcha', authRateLimiter, async (req, res) => {
  const security = await getSecurityConfig();
  if (!security.captcha.enabled) return res.json({ enabled: false });
  const token = crypto.randomBytes(18).toString('hex');
  const code = randomCaptcha();
  const ttlMs = security.captcha.ttlSeconds * 1000;
  const expiresAt = toMysqlDatetime(new Date(Date.now() + ttlMs));
  const codeHash = bcrypt.hashSync(code, 10);
  await upsertCaptchaSession({ token, codeHash, expiresAt });
  res.json({ enabled: true, token, svg: captchaSvg(code) });
});

app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const { username, password, captchaToken, captcha } = req.body || {};
  const ip = getRequestIp(req);
  const rawUsername = String(username || '').trim();
  let loginId = rawUsername;
  const logLoginFailed = async ({ action = 'LOGIN_FAILED', reason = '', user = null, extra = {} } = {}) => {
    await logOperation({
      user: user || { id: 0, username: loginId || rawUsername || 'unknown', role: 'unknown' },
      action,
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: {
        username: loginId || rawUsername || '',
        ip,
        status: 'failed',
        reason: reason || undefined,
        ...extra,
      },
    });
  };
  if (!rawUsername || !password) {
    await logLoginFailed({ reason: 'MISSING_CREDENTIALS', extra: { username: rawUsername || '' } });
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  const security = await getSecurityConfig();
  if (security.captcha.enabled) {
    if (!captchaToken || !captcha) {
      await logLoginFailed({ reason: 'CAPTCHA_REQUIRED' });
      return res.status(400).json({ error: '请输入验证码' });
    }
    const cap = await verifyCaptcha({ token: captchaToken, code: captcha });
    if (!cap.ok) {
      await logLoginFailed({ reason: 'CAPTCHA_INVALID', extra: { captcha_error: cap.error } });
      return res.status(400).json({ error: cap.error });
    }
  }
  let user = null;
  const normalizedUsername = rawUsername.toLowerCase();
  if (BUILTIN_ACCOUNT_USERNAMES.has(normalizedUsername)) {
    loginId = normalizedUsername;
    user = await db.get('SELECT * FROM users WHERE username = ?', [normalizedUsername]);
  } else {
    if (!/^\d{6,20}$/.test(rawUsername)) {
      await logLoginFailed({ reason: 'INVALID_LOGIN_ID' });
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
      afterData: { username: loginId, ip, status: 'failed', locked_until: lock.locked_until },
    });
    return res.status(429).json({ error: '登录失败次数过多，请稍后再试' });
  }
  if (!user) {
    const fail = await recordLoginFailure({ username: loginId, ip });
    await logLoginFailed({
      reason: 'USER_NOT_FOUND',
      extra: { fail_count: fail.failCount, locked_until: fail.lockedUntil },
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
      afterData: { reason: 'DISABLED', username: loginId, ip, status: 'failed' },
    });
    return res.status(403).json({ error: '账号已被禁用，请联系系统管理员' });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    const fail = await recordLoginFailure({ username: loginId, ip });
    await logLoginFailed({
      user: { id: user.id, username: user.username, role: user.role },
      reason: 'PASSWORD_MISMATCH',
      extra: { fail_count: fail.failCount, locked_until: fail.lockedUntil },
    });
    return res.status(400).json({ error: '账号或密码错误' });
  }
  await clearLoginFailures({ username: loginId, ip });
  const ipCheck = checkRoleIpAccess({
    role: user.role,
    ip,
    securityConfig: security,
  });
  if (!ipCheck.allowed) {
    await logOperation({
      user: { id: user.id, username: user.username, role: user.role },
      action: 'LOGIN_IP_RESTRICTED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: {
        username: user.username,
        role: user.role,
        ip,
        allowlist: ipCheck.allowlist,
        status: 'failed',
      },
    });
    return res.status(403).json({ error: '当前IP不在允许访问范围内，请联系系统管理员', ipRestricted: true });
  }

  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });

  if (mfaStatus.setupRequired) {
    const token = await createToken(user, security);
    await logOperation({
      user,
      action: 'LOGIN_MFA_SETUP_REQUIRED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: {
        username: user.username,
        role: user.role,
        desired_methods: mfaStatus.desiredMethods,
        available_methods: mfaStatus.availableMethods,
      },
    });
    return res.json({
      mfaSetupRequired: true,
      forceAllUsersMfa: true,
      availableMethods: mfaStatus.availableMethods,
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }

  if (mfaStatus.enabled) {
    const methods = mfaStatus.effectiveMethods;
    if (!mfaStatus.desiredMethods.length) {
      await logLoginFailed({
        user,
        reason: 'MFA_METHODS_NOT_CONFIGURED',
        extra: { username: user.username, role: user.role },
      });
      return res.status(400).json({ error: '请先设置二次验证方式' });
    }
    if (methods.length === 0) {
      await logLoginFailed({
        user,
        reason: 'MFA_METHODS_UNAVAILABLE',
        extra: { username: user.username, role: user.role },
      });
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

  const token = await createToken(user, security);
  await logOperation({
    user,
    action: 'LOGIN_SUCCESS',
    entity: 'auth',
    entityId: 0,
    requestIp: ip,
    afterData: { username: user.username, role: user.role, ip, status: 'success' },
  });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/mfa/send', authRateLimiter, async (req, res) => {
  const { mfaToken, method } = req.body || {};
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
  const requestIp = getRequestIp(req);
  const ipCheck = checkRoleIpAccess({
    role: user.role,
    ip: requestIp,
    securityConfig: security,
  });
  if (!ipCheck.allowed) {
    await db.run('DELETE FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
    await logOperation({
      user,
      action: 'LOGIN_IP_RESTRICTED',
      entity: 'auth',
      entityId: 0,
      requestIp,
      afterData: { username: user.username, role: user.role, ip: requestIp, allowlist: ipCheck.allowlist, status: 'failed' },
    });
    return res.status(403).json({ error: '当前IP不在允许访问范围内，请联系系统管理员', ipRestricted: true });
  }

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
      afterData: { method, error: err.message },
    });
    return res.status(400).json({ error: err.message || '发送失败' });
  }

  await db.run(
    `UPDATE auth_mfa_sessions
     SET method = ?, code_hash = ?, code_expires_at = ?, sent_at = NOW(), attempts = 0
     WHERE token = ?`
    ,
    [method, codeHash, codeExpiresAt, mfaToken]
  );

  await logOperation({
    user: { id: user.id, username: user.username, role: user.role },
    action: 'MFA_SEND',
    entity: 'auth',
    entityId: 0,
    afterData: { method },
  });
  res.json({ ok: true });
});

app.post('/api/auth/mfa/verify', authRateLimiter, async (req, res) => {
  const { mfaToken, method, code } = req.body || {};
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
  const security = await getSecurityConfig();
  const requestIp = getRequestIp(req);
  const ipCheck = checkRoleIpAccess({
    role: user.role,
    ip: requestIp,
    securityConfig: security,
  });
  if (!ipCheck.allowed) {
    await db.run('DELETE FROM auth_mfa_sessions WHERE token = ?', [mfaToken]);
    await logOperation({
      user,
      action: 'LOGIN_IP_RESTRICTED',
      entity: 'auth',
      entityId: 0,
      requestIp,
      afterData: { username: user.username, role: user.role, ip: requestIp, allowlist: ipCheck.allowlist, status: 'failed' },
    });
    return res.status(403).json({ error: '当前IP不在允许访问范围内，请联系系统管理员', ipRestricted: true });
  }

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
      afterData: { method, attempts, ip: requestIp, status: 'failed' },
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
  const token = await createToken(user, security);
  await logOperation({
    user,
    action: 'LOGIN_SUCCESS',
    entity: 'auth',
    entityId: 0,
    requestIp,
    afterData: { username: user.username, role: user.role, ip: requestIp, status: 'success', mfa_method: method },
  });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/totp/setup', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(400).json({ error: '用户不存在' });
  const secret = base32Encode(require('crypto').randomBytes(20));
  await db.run(
    'INSERT INTO auth_totp_pending (user_id, secret) VALUES (?, ?) ON DUPLICATE KEY UPDATE secret = VALUES(secret), created_at = NOW()',
    [user.id, secret]
  );
  const issuer = encodeURIComponent('Juxin');
  const label = encodeURIComponent(`${user.username}`);
  const otpauth = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
  res.json({ secret, otpauth });
});

app.post('/api/auth/totp/enable', authRateLimiter, async (req, res) => {
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
    'SELECT id, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(400).json({ error: '用户不存在' });
  const security = await getSecurityConfig();
  const methods = parseUserMfaMethods(user.mfa_methods);
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  res.json({
    enabled: Number(user.mfa_enabled) === 1,
    methods,
    totp_enabled: Number(user.totp_enabled) === 1,
    has_email: !!user.email,
    has_phone: !!user.phone,
    has_wecom: !!user.wecom_id,
    force_all_users_mfa: !!security.mfa.forceAllUsers,
    setup_required: !!mfaStatus.setupRequired,
  });
});

app.post('/api/auth/mfa/settings', async (req, res) => {
  const { enabled, methods } = req.body || {};
  const user = await db.get(
    'SELECT id, mfa_enabled, mfa_methods, totp_enabled, email, phone, wecom_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(400).json({ error: '用户不存在' });
  const security = await getSecurityConfig();
  const allowed = new Set(['email', 'sms', 'wecom', 'totp']);
  const nextMethods = Array.isArray(methods) ? methods.filter((m) => allowed.has(m)) : [];
  const nextEnabled = enabled === true || enabled === 1 || enabled === '1';
  if (security.mfa.forceAllUsers && !nextEnabled) {
    return res.status(400).json({ error: '系统已开启强制二次验证，当前账号不能关闭' });
  }
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
  const user = await db.get(
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.json(null);
  const security = await getSecurityConfig();
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  res.json({
    id: user.id,
    username: user.username,
    role: normalizeUserRole(user.role),
    app_access: normalizeAppAccess(user.app_access, user.role),
    mfa_setup_required: mfaStatus.setupRequired,
    force_all_users_mfa: mfaStatus.forceAllUsers,
  });
});

app.post('/api/auth/logout', async (req, res) => {
  const requestIp = getRequestIp(req);
  await logOperation({
    user: req.user,
    action: 'LOGOUT',
    entity: 'auth',
    entityId: 0,
    requestIp,
    afterData: {
      username: req.user?.username || '',
      role: req.user?.role || '',
      ip: requestIp,
      status: 'success',
    },
  });
  res.json({ ok: true });
});

// Users (admin)
app.get('/api/users', requireRole(['sysadmin']), async (req, res) => {
  const rows = await db.query(
    'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, totp_enabled, created_at FROM users ORDER BY id DESC'
  );
  const users = rows.map(formatUserRow);
  const loginIds = Array.from(new Set(users.map((item) => resolveUserLoginId(item)).filter(Boolean)));
  const lockMap = new Map();
  if (loginIds.length) {
    const lockRows = await db.query(
      `SELECT username, MAX(locked_until) AS locked_until,
              SUM(CASE WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN 1 ELSE 0 END) AS locked_ip_count
       FROM auth_login_attempts
       WHERE username IN (${buildInClause(loginIds)})
       GROUP BY username`,
      loginIds
    );
    lockRows.forEach((row) => {
      lockMap.set(String(row.username || ''), {
        locked_until: row.locked_until || null,
        locked_ip_count: Number(row.locked_ip_count || 0),
      });
    });
  }
  const payload = users.map((item) => {
    const loginId = resolveUserLoginId(item);
    const lockInfo = loginId ? lockMap.get(loginId) : null;
    const locked = !!(
      loginId &&
      lockInfo &&
      Number(lockInfo.locked_ip_count || 0) > 0 &&
      isLocked({ lockedUntilIso: lockInfo.locked_until })
    );
    return {
      ...item,
      login_id: loginId || null,
      lock_status: locked ? 'locked' : 'normal',
      locked_until: locked ? lockInfo.locked_until : null,
      locked_ip_count: locked ? Number(lockInfo.locked_ip_count || 0) : 0,
    };
  });
  res.json(payload);
});

app.post('/api/users', requireRole(['sysadmin']), async (req, res) => {
  const { username, password, role, is_active, email, phone, wecom_id, app_access } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  const usernameRuleError = validateUsernameFormat(username);
  if (usernameRuleError) {
    return res.status(400).json({ error: usernameRuleError });
  }
  const security = await getSecurityConfig();
  const passwordRuleError = validatePasswordComplexity(password, security.passwordPolicy);
  if (passwordRuleError) {
    return res.status(400).json({ error: passwordRuleError });
  }
  const emailRuleError = validateEmailFormat(email);
  if (emailRuleError) {
    return res.status(400).json({ error: emailRuleError });
  }
  const phoneRuleError = validatePhoneFormat(phone);
  if (phoneRuleError) {
    return res.status(400).json({ error: phoneRuleError });
  }
  const nextRole = normalizeUserRole(role || 'user');
  if (!ALLOWED_USER_ROLES.has(nextRole)) {
    return res.status(400).json({ error: '角色不合法' });
  }
  const nextAccess = normalizeAppAccess(app_access, nextRole);
  if (!nextAccess.length) {
    return res.status(400).json({ error: '请至少选择一个可访问系统' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const nextActive = is_active === undefined ? 1 : (Number(is_active) === 1 ? 1 : 0);
  try {
    const info = await db.run(
      'INSERT INTO users (username, password_hash, role, is_active, email, phone, wecom_id, app_access) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username.trim(), hash, nextRole, nextActive, email || null, phone || null, wecom_id || null, JSON.stringify(nextAccess)]
    );
    const row = formatUserRow(await db.get(
      'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, totp_enabled, created_at FROM users WHERE id = ?',
      [info.insertId]
    ));
    await logOperation({
      user: req.user,
      action: 'CREATE',
      entity: 'user',
      entityId: row.id,
      afterData: row,
    });
    res.json(row);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '用户名已存在' });
    }
    return res.status(400).json({ error: err?.sqlMessage || '账号已存在或数据错误' });
  }
});

app.put('/api/users/:id', requireRole(['sysadmin']), async (req, res) => {
  const { id } = req.params;
  const { password, role, is_active, email, phone, wecom_id, app_access } = req.body || {};
  if (
    !password &&
    !role &&
    is_active === undefined &&
    email === undefined &&
    phone === undefined &&
    wecom_id === undefined &&
    app_access === undefined
  ) {
    return res.status(400).json({ error: '没有可更新字段' });
  }
  if (email !== undefined) {
    const emailRuleError = validateEmailFormat(email);
    if (emailRuleError) return res.status(400).json({ error: emailRuleError });
  }
  if (phone !== undefined) {
    const phoneRuleError = validatePhoneFormat(phone);
    if (phoneRuleError) return res.status(400).json({ error: phoneRuleError });
  }
  const before = formatUserRow(await db.get(
    'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, totp_enabled, created_at FROM users WHERE id = ?',
    [id]
  ));
  if (!before) {
    return res.status(404).json({ error: '用户不存在' });
  }
  if (BUILTIN_ACCOUNT_USERNAMES.has(String(before.username || '').toLowerCase()) && role) {
    const fixedRole = BUILTIN_ACCOUNTS.find(
      (item) => item.username === String(before.username || '').toLowerCase()
    )?.role;
    if (fixedRole && String(role).trim().toLowerCase() !== fixedRole) {
      return res.status(400).json({ error: '内置账号角色不可修改' });
    }
  }
  if (password) {
    const security = await getSecurityConfig();
    const passwordRuleError = validatePasswordComplexity(password, security.passwordPolicy);
    if (passwordRuleError) {
      return res.status(400).json({ error: passwordRuleError });
    }
    const hash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  }
  const nextRole = role !== undefined ? normalizeUserRole(role) : normalizeUserRole(before.role);
  if (!ALLOWED_USER_ROLES.has(nextRole)) {
    return res.status(400).json({ error: '角色不合法' });
  }
  if (role) {
    await db.run('UPDATE users SET role = ? WHERE id = ?', [nextRole, id]);
  }
  if (email !== undefined) {
    await db.run('UPDATE users SET email = ? WHERE id = ?', [email || null, id]);
  }
  if (phone !== undefined) {
    await db.run('UPDATE users SET phone = ? WHERE id = ?', [phone || null, id]);
  }
  if (wecom_id !== undefined) {
    await db.run('UPDATE users SET wecom_id = ? WHERE id = ?', [wecom_id || null, id]);
  }
  if (is_active !== undefined) {
    const nextActive = Number(is_active) === 1 ? 1 : 0;
    if (isBuiltinUsername(before.username) && nextActive !== 1) {
      return res.status(400).json({ error: '内置账号不可禁用' });
    }
    if (String(id) === String(req.user.id) && nextActive !== 1) {
      return res.status(400).json({ error: '不能禁用自己' });
    }
    await db.run('UPDATE users SET is_active = ? WHERE id = ?', [nextActive, id]);
  }
  if (role !== undefined || app_access !== undefined) {
    if (isBuiltinUsername(before.username) && app_access !== undefined) {
      return res.status(400).json({ error: '内置账号系统权限不可修改' });
    }
    const nextAccess = normalizeAppAccess(app_access !== undefined ? app_access : before.app_access, nextRole);
    if (!nextAccess.length) {
      return res.status(400).json({ error: '请至少选择一个可访问系统' });
    }
    await db.run('UPDATE users SET app_access = ? WHERE id = ?', [JSON.stringify(nextAccess), id]);
  }
  const row = formatUserRow(await db.get(
    'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, totp_enabled, created_at FROM users WHERE id = ?',
    [id]
  ));
  let actionType = 'UPDATE';
  if (Number(before.is_active) !== Number(row.is_active)) {
    actionType = Number(row.is_active) === 1 ? 'ENABLE_USER' : 'DISABLE_USER';
  }
  await logOperation({
    user: req.user,
    action: actionType,
    entity: 'user',
    entityId: Number(id),
    beforeData: before,
    afterData: row,
  });
  res.json(row);
});

app.post('/api/users/:id/unlock', requireRole(['sysadmin']), async (req, res) => {
  const { id } = req.params;
  const targetUser = await db.get(
    'SELECT id, username, phone FROM users WHERE id = ?',
    [id]
  );
  if (!targetUser) {
    return res.status(404).json({ error: '用户不存在' });
  }
  const loginId = resolveUserLoginId(targetUser);
  if (!loginId) {
    return res.status(400).json({ error: '该用户未配置可用登录标识，无法解锁' });
  }
  const beforeLocks = await db.query(
    'SELECT username, ip, fail_count, first_fail_at, locked_until, updated_at FROM auth_login_attempts WHERE username = ?',
    [loginId]
  );
  await db.run('DELETE FROM auth_login_attempts WHERE username = ?', [loginId]);
  await logOperation({
    user: req.user,
    action: 'UNLOCK_USER',
    entity: 'user',
    entityId: Number(id),
    beforeData: {
      username: targetUser.username,
      login_id: loginId,
      lock_records: beforeLocks,
    },
    afterData: {
      username: targetUser.username,
      login_id: loginId,
      unlocked_count: beforeLocks.length,
    },
  });
  res.json({ ok: true, unlocked_count: beforeLocks.length });
});

app.delete('/api/users/:id', requireRole(['sysadmin']), async (req, res) => {
  const { id } = req.params;
  if (String(id) === String(req.user.id)) {
    return res.status(400).json({ error: '不能删除自己' });
  }
  const before = formatUserRow(await db.get(
    'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, totp_enabled, created_at FROM users WHERE id = ?',
    [id]
  ));
  if (!before) {
    return res.status(404).json({ error: '用户不存在' });
  }
  if (isBuiltinUsername(before.username)) {
    return res.status(400).json({ error: '内置账号不可删除' });
  }
  await db.run('DELETE FROM users WHERE id = ?', [id]);
  await logOperation({
    user: req.user,
    action: 'DELETE',
    entity: 'user',
    entityId: Number(id),
    beforeData: before,
  });
  res.json({ ok: true });
});

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
  const maxAttempts = clampNumber(login.maxAttempts, 5, 1, 20);
  const windowMinutes = clampNumber(login.windowMinutes, 15, 1, 1440);
  const lockMinutes = clampNumber(login.lockMinutes, 15, 1, 1440);
  const codeTtlSeconds = clampNumber(mfa.codeTtlSeconds, 300, 60, 1800);
  const forceAllUsers = mfa.forceAllUsers === true || security.forceAllUsersMfa === true;
  const captchaEnabled = captcha.enabled !== undefined ? !!captcha.enabled : true;
  const captchaTtlSeconds = clampNumber(captcha.ttlSeconds, 300, 60, 1800);
  const adminMfaMethods = Array.isArray(security.adminMfaMethods)
    ? security.adminMfaMethods
    : [];
  const passwordPolicy = normalizePasswordPolicy(security.passwordPolicy || {});
  const timeoutMinutes = clampNumber(
    security?.session?.timeoutMinutes ?? security.sessionTimeoutMinutes,
    DEFAULT_SESSION_TIMEOUT_MINUTES,
    5,
    DEFAULT_SESSION_TIMEOUT_MINUTES
  );
  const roleIpAllowlist = normalizeRoleIpAllowlist(security);
  return {
    login: {
      maxAttempts,
      windowMinutes,
      lockMinutes,
    },
    mfa: {
      codeTtlSeconds,
      forceAllUsers,
      adminMfaMethods: adminMfaMethods.filter(Boolean),
    },
    captcha: {
      enabled: captchaEnabled,
      ttlSeconds: captchaTtlSeconds,
    },
    passwordPolicy,
    session: { timeoutMinutes },
    roleIpAllowlist,
  };
};

const classifyError = (err) => {
  const message = (err && err.message ? err.message : '').toLowerCase();
  if (message.includes('配置不完整') || message.includes('配置')) return 'CONFIG_MISSING';
  if (message.includes('没有邮箱') || message.includes('没有手机号') || message.includes('没有企业微信')) {
    return 'INVALID_CONTACT';
  }
  if (message.includes('限制') || message.includes('rate') || message.includes('频繁')) {
    return 'RATE_LIMIT';
  }
  if (message.includes('拒绝') || message.includes('forbidden') || message.includes('invalid')) {
    return 'REJECTED';
  }
  return 'UNKNOWN';
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryConfig = (configs) => {
  const retry = configs.retry || {};
  const maxRetries = Number(retry.maxRetries ?? 2);
  const intervalMs = Number(retry.intervalMs ?? 2000);
  return {
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 2,
    intervalMs: Number.isFinite(intervalMs) ? intervalMs : 2000,
  };
};

const getRateLimitConfig = (configs) => {
  const rate = configs.rateLimit || {};
  const maxPerRun = Number(rate.maxPerRun ?? 200);
  return {
    maxPerRun: Number.isFinite(maxPerRun) ? maxPerRun : 200,
  };
};

const logOperation = async ({ user, action, entity, entityId, beforeData, afterData, system = 'reminder', requestIp }) => {
  try {
    const userId = Number(user?.id || 0);
    const username = String(user?.username || 'system');
    const logSystem = String(system || 'reminder').trim() || 'reminder';
    const sourceIp = String(requestIp || user?.request_ip || user?.requestIp || '').trim() || null;
    const beforeText = beforeData === undefined ? null : stableStringify(beforeData);
    const afterText = afterData === undefined ? null : stableStringify(afterData);
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
         'LOGIN', 'LOGIN_SUCCESS', 'LOGOUT', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGIN_BLOCKED',
         'LOGIN_IP_RESTRICTED',
         'LOGIN_MFA_REQUIRED', 'LOGIN_MFA_SETUP_REQUIRED', 'MFA_SEND', 'MFA_SEND_FAILED', 'MFA_VERIFY_OK', 'MFA_VERIFY_FAILED',
         'TOTP_ENABLED'
       )
         THEN 'sso'
       ELSE 'reminder'
     END
     WHERE log_system IS NULL OR log_system = ''`
  );
};

const insertImportJob = async ({
  user,
  type,
  filename,
  status,
  created = 0,
  skipped = 0,
  total = 0,
  errors = [],
  errorMessage = null,
}) => {
  try {
    await db.run(
      `INSERT INTO import_jobs
        (user_id, username, type, filename, status, created, skipped, total, error_count, errors_json, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ,
      [
        user?.id || 0,
        user?.username || 'system',
        String(type || ''),
        filename || null,
        String(status || 'DONE'),
        Number(created) || 0,
        Number(skipped) || 0,
        Number(total) || 0,
        Array.isArray(errors) ? errors.length : 0,
        Array.isArray(errors) ? JSON.stringify(errors) : null,
        errorMessage ? String(errorMessage) : null,
      ]
    );
  } catch (err) {
    // ignore logging failures
  }
};

const csvEscape = (value) => {
  const rawText = value === null || value === undefined ? '' : String(value);
  const ltrim = rawText.replace(/^[\s\r\n\t]+/, '');
  const raw = /^[=+\-@]/.test(ltrim) ? `'${rawText}` : rawText;
  const escaped = raw.replace(/\"/g, '""');
  return `"${escaped}"`;
};

const toCsv = (rows, headers) => {
  const head = headers.map((h) => csvEscape(h.label)).join(',');
  const body = rows
    .map((row) => headers.map((h) => csvEscape(row[h.key])).join(','))
    .join('\n');
  // UTF-8 BOM for Excel compatibility
  return `\ufeff${head}\n${body}\n`;
};

const toAuditActionZh = (value) => {
  const map = {
    LOGIN: '登录',
    LOGIN_SUCCESS: '登录成功',
    LOGOUT: '登出',
    LOGIN_FAILED: '登录失败',
    LOGIN_LOCKED: '登录锁定',
    LOGIN_BLOCKED: '账号被禁用',
    LOGIN_IP_RESTRICTED: 'IP受限',
    LOGIN_MFA_REQUIRED: '需要二次验证',
    LOGIN_MFA_SETUP_REQUIRED: '需要先配置二次验证',
    MFA_SEND: '发送验证码',
    MFA_SEND_FAILED: '验证码发送失败',
    MFA_VERIFY_OK: '验证码校验成功',
    MFA_VERIFY_FAILED: '验证码校验失败',
    TOTP_ENABLED: '开启谷歌认证',
    CREATE: '新增',
    UPDATE: '更新',
    DELETE: '删除',
    IMPORT: '导入',
    UPLOAD: '上传',
    CHANGE_PASSWORD: '修改密码',
    RESET_PASSWORD: '重置密码',
    ENABLE_USER: '启用用户',
    DISABLE_USER: '禁用用户',
    UNLOCK_USER: '解锁用户',
  };
  return map[String(value || '').trim()] || String(value || '');
};

const toAuditEntityZh = (value) => {
  const map = {
    auth: '认证/登录',
    user: '用户',
    customer: '客户',
    contact: '联系人',
    license: '授权',
    send_plan: '发送计划',
    send_configs: '发送配置',
    ticket: '工单',
    project: '项目',
    template: '模板',
    schedule: '排期',
    permission: '权限',
  };
  return map[String(value || '').trim()] || String(value || '');
};

const toAuditSystemZh = (value) => {
  const map = {
    reminder: '提醒系统',
    ticketing: '工单系统',
    cmdb: 'CMDB系统',
    sso: '统一登录',
  };
  return map[String(value || '').trim()] || String(value || '');
};

const getRequestIp = (req) => {
  return extractRequestIp(req);
};

const isLocked = ({ lockedUntilIso }) => {
  if (!lockedUntilIso) return false;
  const until = new Date(lockedUntilIso).getTime();
  return Number.isFinite(until) && until > Date.now();
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

const toMysqlDatetime = (date) =>
  date instanceof Date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;

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
  const crypto = require('crypto');
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

const normalizeScheduleConfig = (configs) => {
  const reminderSchedule = configs.reminderSchedule || {};
  let days = [];
  if (Array.isArray(reminderSchedule.days)) {
    days = reminderSchedule.days.map((d) => Number(d)).filter((d) => Number.isFinite(d));
  } else if (typeof reminderSchedule.days === 'string') {
    days = reminderSchedule.days
      .split(',')
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isFinite(d));
  }
  if (!days.length) days = [60, 30, 20];
  const hour = Number(reminderSchedule.hour ?? 9);
  const minute = Number(reminderSchedule.minute ?? 0);
  const graceDays = Number(reminderSchedule.graceDays ?? 0);
  const channels =
    Array.isArray(reminderSchedule.channels) && reminderSchedule.channels.length
      ? reminderSchedule.channels
      : ['email'];
  return {
    days,
    hour: Number.isFinite(hour) ? hour : 9,
    minute: Number.isFinite(minute) ? minute : 0,
    graceDays: Number.isFinite(graceDays) ? graceDays : 0,
    channels,
  };
};

const replaceTokens = (template, context) => {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

const buildContext = ({ contact, license, subject, message }) => ({
  contact_name: contact?.name || '',
  customer_name: contact?.customer_name || '',
  contact_phone: contact?.phone || '',
  contact_email: contact?.email || '',
  wecom_id: contact?.wecom_id || '',
  license_name: license?.name || '',
  end_date: license?.end_date || '',
  days_left: license?.days_left ?? '',
  subject: subject || '',
  message: message || '',
});

const buildSendContent = ({ subject, message, contact, license, configs, channel }) => {
  const reminderConfig = (configs && configs.reminder) || {};
  const subjectForContext = channel === 'email' ? subject || reminderConfig.subject || '' : '';
  const context = buildContext({ contact, license, subject: subjectForContext, message });
  const finalSubject =
    channel === 'email'
      ? subject || replaceTokens(reminderConfig.subject, context) || '授权到期提醒'
      : '';
  const finalMessage =
    message || replaceTokens(reminderConfig.message, context) || '授权即将到期，请及时续约。';
  return { finalSubject, finalMessage };
};

const normalizeCustomerIds = (rawIds, fallbackId) => {
  let ids = [];
  if (Array.isArray(rawIds)) {
    ids = rawIds;
  } else if (typeof rawIds === 'string') {
    ids = rawIds.split(',').map((v) => v.trim());
  }
  const cleaned = ids
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!cleaned.length && fallbackId) {
    const fallback = Number(fallbackId);
    if (Number.isFinite(fallback) && fallback > 0) return [fallback];
  }
  return Array.from(new Set(cleaned));
};

const syncContactCustomers = async (trx, contactId, customerIds) => {
  await trx.run('DELETE FROM contact_customers WHERE contact_id = ?', [contactId]);
  if (!customerIds.length) return;
  const values = [];
  customerIds.forEach((cid) => {
    values.push(contactId, cid);
  });
  const tuples = customerIds.map(() => '(?, ?)').join(',');
  await trx.run(`INSERT INTO contact_customers (contact_id, customer_id) VALUES ${tuples}`, values);
};

// Customers
app.get('/api/customers', requireRole(['admin']), async (req, res) => {
  const { search } = req.query;
  const where = [];
  const params = [];
  if (search) {
    where.push('name LIKE ?');
    params.push(`%${search}%`);
  }
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(`SELECT * FROM customers ${whereSql} ORDER BY id DESC`, params);
  res.json(rows);
});

app.post('/api/customers', requireRole(['admin']), async (req, res) => {
  const { name, juxin_sales, channel_sales } = req.body;
  const authzCreateCustomer = await authorizeReminderAction(req, 'customer:create', { customer_in_scope: false });
  if (!authzCreateCustomer.allow) return res.status(403).json({ error: authzCreateCustomer.reason || '无权限' });
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '客户名称不能为空' });
  }
  try {
    const info = await db.run(
      'INSERT INTO customers (name, juxin_sales, channel_sales) VALUES (?, ?, ?)',
      [name.trim(), juxin_sales || '', channel_sales || '']
    );
    const row = await db.get('SELECT * FROM customers WHERE id = ?', [info.insertId]);
    await logOperation({
      user: req.user,
      action: 'CREATE',
      entity: 'customer',
      entityId: row.id,
      afterData: row,
    });
    res.json(toJson(row));
  } catch (err) {
    res.status(400).json({ error: '客户名称已存在或数据错误' });
  }
});

app.put('/api/customers/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { name, juxin_sales, channel_sales } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '客户名称不能为空' });
  }
  try {
    const before = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    if (!before) return res.status(404).json({ error: '客户不存在' });
    const allowed = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
    const customerInScope = req.scope?.isAdmin ? true : allowed.has(Number(id));
    const authzUpdateCustomer = await authorizeReminderAction(req, 'customer:update', {
      customer_in_scope: customerInScope,
    });
    if (!authzUpdateCustomer.allow) return res.status(403).json({ error: authzUpdateCustomer.reason || '无权限' });
    await db.run(
      'UPDATE customers SET name = ?, juxin_sales = ?, channel_sales = ? WHERE id = ?',
      [name.trim(), juxin_sales || '', channel_sales || '', id]
    );
    const row = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    await logOperation({
      user: req.user,
      action: 'UPDATE',
      entity: 'customer',
      entityId: Number(id),
      beforeData: before,
      afterData: row,
    });
    res.json(toJson(row));
  } catch (err) {
    res.status(400).json({ error: '客户名称已存在或数据错误' });
  }
});

app.delete('/api/customers/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const allowed = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const customerInScope = req.scope?.isAdmin ? true : allowed.has(Number(id));
  const authzDeleteCustomer = await authorizeReminderAction(req, 'customer:delete', {
    customer_in_scope: customerInScope,
  });
  if (!authzDeleteCustomer.allow) return res.status(403).json({ error: authzDeleteCustomer.reason || '无权限' });
  const hasContacts = await db.get('SELECT COUNT(1) AS count FROM contact_customers WHERE customer_id = ?', [id]);
  if (Number(hasContacts?.count || 0) > 0) {
    return res.status(400).json({ error: '该客户下存在联系人，无法删除' });
  }
  const before = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
  await db.run('DELETE FROM customers WHERE id = ?', [id]);
  await logOperation({
    user: req.user,
    action: 'DELETE',
    entity: 'customer',
    entityId: Number(id),
    beforeData: before,
  });
  res.json({ ok: true });
});

// Contacts
app.get('/api/contacts', requireRole(['admin']), async (req, res) => {
  const { search, customer_id, is_active } = req.query;
  const where = [];
  const params = [];
  if (customer_id) {
    where.push('cc.customer_id = ?');
    params.push(customer_id);
  }
  if (is_active === '0' || is_active === '1') {
    where.push('contacts.is_active = ?');
    params.push(is_active);
  }
  if (search) {
    where.push('(contacts.name LIKE ? OR contacts.phone LIKE ? OR contacts.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT contacts.*,
      GROUP_CONCAT(DISTINCT customers.name ORDER BY customers.name SEPARATOR '、') AS customer_name,
      GROUP_CONCAT(DISTINCT customers.id ORDER BY customers.id SEPARATOR ',') AS customer_ids
     FROM contacts
     LEFT JOIN contact_customers cc ON cc.contact_id = contacts.id
     LEFT JOIN customers ON customers.id = cc.customer_id
     ${whereSql}
     GROUP BY contacts.id
     ORDER BY contacts.id DESC`,
    params
  );
  res.json(
    rows.map((row) => ({
      ...row,
      customer_ids: row.customer_ids
        ? row.customer_ids
            .split(',')
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id))
        : [],
    }))
  );
});

app.post('/api/contacts', requireRole(['admin']), async (req, res) => {
  const { customer_id, customer_ids, name, phone, email, wecom_id, is_active } = req.body;
  const normalizedCustomerIds = normalizeCustomerIds(customer_ids, customer_id);
  if (!normalizedCustomerIds.length) {
    return res.status(400).json({ error: '请选择客户名称' });
  }
  const allowedCustomerSet = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const customerIdsInScope = req.scope?.isAdmin
    ? true
    : normalizedCustomerIds.every((id) => allowedCustomerSet.has(Number(id)));
  const authzCreateContact = await authorizeReminderAction(req, 'contact:create', {
    customer_ids_in_scope: customerIdsInScope,
  });
  if (!authzCreateContact.allow) return res.status(403).json({ error: authzCreateContact.reason || '无权限' });
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '联系人不能为空' });
  }
  const primaryCustomerId = normalizedCustomerIds[0];
  const row = await db.transaction(async (trx) => {
    const info = await trx.run(
      'INSERT INTO contacts (customer_id, name, phone, email, wecom_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [
        primaryCustomerId,
        name.trim(),
        phone || '',
        email || '',
        wecom_id || '',
        is_active === 0 ? 0 : 1,
      ]
    );
    await syncContactCustomers(trx, info.insertId, normalizedCustomerIds);
    const result = await trx.get(
      `SELECT contacts.*,
        GROUP_CONCAT(DISTINCT customers.name ORDER BY customers.name SEPARATOR '、') AS customer_name,
        GROUP_CONCAT(DISTINCT customers.id ORDER BY customers.id SEPARATOR ',') AS customer_ids
       FROM contacts
       LEFT JOIN contact_customers cc ON cc.contact_id = contacts.id
       LEFT JOIN customers ON customers.id = cc.customer_id
       WHERE contacts.id = ?
       GROUP BY contacts.id`,
      [info.insertId]
    );
    return result;
  });
  await logOperation({
    user: req.user,
    action: 'CREATE',
    entity: 'contact',
    entityId: row.id,
    afterData: row,
  });
  res.json({
    ...toJson(row),
    customer_ids: row?.customer_ids
      ? row.customer_ids
          .split(',')
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id))
      : [],
  });
});

app.put('/api/contacts/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { customer_id, customer_ids, name, phone, email, wecom_id, is_active } = req.body;
  const normalizedCustomerIds = normalizeCustomerIds(customer_ids, customer_id);
  if (!normalizedCustomerIds.length) {
    return res.status(400).json({ error: '请选择客户名称' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '联系人不能为空' });
  }
  const before = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: '联系人不存在' });
  const allowedContactSet = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const currentLinks = await db.query(
    'SELECT customer_id FROM contact_customers WHERE contact_id = ?',
    [id]
  );
  const currentIds = currentLinks.map((row) => Number(row.customer_id));
  const customerIdsInScope = req.scope?.isAdmin
    ? true
    : currentIds.every((cid) => allowedContactSet.has(cid)) &&
      normalizedCustomerIds.every((cid) => allowedContactSet.has(Number(cid)));
  const authzUpdateContact = await authorizeReminderAction(req, 'contact:update', {
    customer_ids_in_scope: customerIdsInScope,
  });
  if (!authzUpdateContact.allow) return res.status(403).json({ error: authzUpdateContact.reason || '无权限' });
  const primaryCustomerId = normalizedCustomerIds[0];
  const row = await db.transaction(async (trx) => {
    await trx.run(
      'UPDATE contacts SET customer_id = ?, name = ?, phone = ?, email = ?, wecom_id = ?, is_active = ? WHERE id = ?',
      [primaryCustomerId, name.trim(), phone || '', email || '', wecom_id || '', is_active === 0 ? 0 : 1, id]
    );
    await syncContactCustomers(trx, Number(id), normalizedCustomerIds);
    const result = await trx.get(
      `SELECT contacts.*,
        GROUP_CONCAT(DISTINCT customers.name ORDER BY customers.name SEPARATOR '、') AS customer_name,
        GROUP_CONCAT(DISTINCT customers.id ORDER BY customers.id SEPARATOR ',') AS customer_ids
       FROM contacts
       LEFT JOIN contact_customers cc ON cc.contact_id = contacts.id
       LEFT JOIN customers ON customers.id = cc.customer_id
       WHERE contacts.id = ?
       GROUP BY contacts.id`,
      [id]
    );
    return result;
  });
  await logOperation({
    user: req.user,
    action: 'UPDATE',
    entity: 'contact',
    entityId: Number(id),
    beforeData: before,
    afterData: row,
  });
  res.json({
    ...toJson(row),
    customer_ids: row?.customer_ids
      ? row.customer_ids
          .split(',')
          .map((cid) => Number(cid))
          .filter((cid) => Number.isFinite(cid))
      : [],
  });
});

app.delete('/api/contacts/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const before = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: '联系人不存在' });
  const allowedDeleteContactSet = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const currentLinks = await db.query(
    'SELECT customer_id FROM contact_customers WHERE contact_id = ?',
    [id]
  );
  const currentIds = currentLinks.map((row) => Number(row.customer_id));
  const customerIdsInScope = req.scope?.isAdmin
    ? true
    : currentIds.every((cid) => allowedDeleteContactSet.has(cid));
  const authzDeleteContact = await authorizeReminderAction(req, 'contact:delete', {
    customer_ids_in_scope: customerIdsInScope,
  });
  if (!authzDeleteContact.allow) return res.status(403).json({ error: authzDeleteContact.reason || '无权限' });
  await db.run('DELETE FROM contacts WHERE id = ?', [id]);
  await logOperation({
    user: req.user,
    action: 'DELETE',
    entity: 'contact',
    entityId: Number(id),
    beforeData: before,
  });
  res.json({ ok: true });
});

// Licenses
app.get('/api/licenses', requireRole(['admin']), async (req, res) => {
  const { search, customer_id, status, quick, days, missing_screenshot } = req.query;
  const where = [];
  const params = [];
  if (customer_id) {
    where.push('licenses.customer_id = ?');
    params.push(customer_id);
  }
  if (status) {
    where.push('licenses.status = ?');
    params.push(status);
  }
  if (quick === 'expired') {
    where.push('licenses.end_date < CURDATE()');
  }
  if (quick === 'expiring') {
    const range = Number(days || 30);
    where.push('licenses.end_date >= CURDATE()');
    where.push('licenses.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)');
    params.push(Number.isFinite(range) ? range : 30);
  }
  if (search) {
    where.push('(licenses.name LIKE ? OR customers.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (missing_screenshot === '1') {
    where.push('(licenses.screenshot_url IS NULL OR licenses.screenshot_url = \'\')');
  }
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT licenses.*, customers.name AS customer_name
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     ${whereSql}
     ORDER BY (licenses.screenshot_url IS NULL OR licenses.screenshot_url = '') DESC, licenses.id DESC`,
    params
  );
  res.json(rows);
});

app.get('/api/licenses/expiring', requireRole(['admin']), async (req, res) => {
  const days = Number(req.query.days || 30);
  const where = [];
  const params = [];
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const scopeSql = where.length ? `AND ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT licenses.*, customers.name AS customer_name,
      DATEDIFF(licenses.end_date, CURDATE()) AS days_left
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE licenses.end_date >= CURDATE()
     AND licenses.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ${scopeSql}
     ORDER BY licenses.end_date ASC`,
    [days, ...params]
  );
  res.json(rows);
});

app.post('/api/licenses', requireRole(['admin']), async (req, res) => {
  const { customer_id, name, start_date, end_date, status, note, reminder_days } = req.body;
  if (!customer_id) {
    return res.status(400).json({ error: '请选择客户名称' });
  }
  const allowedLicenseSet = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const licenseInScope = req.scope?.isAdmin ? true : allowedLicenseSet.has(Number(customer_id));
  const authzCreateLicense = await authorizeReminderAction(req, 'license:create', {
    license_in_scope: licenseInScope,
  });
  if (!authzCreateLicense.allow) return res.status(403).json({ error: authzCreateLicense.reason || '无权限' });
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '授权名称不能为空' });
  }
  if (!end_date) {
    return res.status(400).json({ error: '到期日期不能为空' });
  }
  const info = await db.run(
    'INSERT INTO licenses (customer_id, name, start_date, end_date, status, note, reminder_days) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [customer_id, name.trim(), start_date || null, end_date, status || 'ACTIVE', note || '', reminder_days || null]
  );
  const row = await db.get(
    `SELECT licenses.*, customers.name AS customer_name
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE licenses.id = ?`,
    [info.insertId]
  );
  await logOperation({
    user: req.user,
    action: 'CREATE',
    entity: 'license',
    entityId: row.id,
    afterData: row,
  });
  res.json(toJson(row));
});

app.put('/api/licenses/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { customer_id, name, start_date, end_date, status, note, reminder_days } = req.body;
  if (!customer_id) {
    return res.status(400).json({ error: '请选择客户名称' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '授权名称不能为空' });
  }
  if (!end_date) {
    return res.status(400).json({ error: '到期日期不能为空' });
  }
  const before = await db.get('SELECT * FROM licenses WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: '授权不存在' });
  const allowedUpdateLicenseSet = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const licenseInScope = req.scope?.isAdmin
    ? true
    : allowedUpdateLicenseSet.has(Number(before.customer_id)) &&
      allowedUpdateLicenseSet.has(Number(customer_id));
  const authzUpdateLicense = await authorizeReminderAction(req, 'license:update', {
    license_in_scope: licenseInScope,
  });
  if (!authzUpdateLicense.allow) return res.status(403).json({ error: authzUpdateLicense.reason || '无权限' });
  await db.run(
    'UPDATE licenses SET customer_id = ?, name = ?, start_date = ?, end_date = ?, status = ?, note = ?, reminder_days = ? WHERE id = ?',
    [customer_id, name.trim(), start_date || null, end_date, status || 'ACTIVE', note || '', reminder_days || null, id]
  );
  const row = await db.get(
    `SELECT licenses.*, customers.name AS customer_name
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE licenses.id = ?`,
    [id]
  );
  await logOperation({
    user: req.user,
    action: 'UPDATE',
    entity: 'license',
    entityId: Number(id),
    beforeData: before,
    afterData: row,
  });
  res.json(toJson(row));
});

app.post('/api/licenses/:id/screenshot', requireRole(['admin']), uploadRateLimiter, screenshotUpload.single('file'), async (req, res) => {
  const { id } = req.params;
  const license = await db.get('SELECT * FROM licenses WHERE id = ?', [id]);
  if (!license) {
    return res.status(404).json({ error: '授权不存在' });
  }
  const okLicense = await ensureLicenseInScope(req.scope, id);
  const authzUploadScreenshot = await authorizeReminderAction(req, 'license:screenshot:create', {
    license_in_scope: okLicense,
  });
  if (!authzUploadScreenshot.allow) {
    return res.status(403).json({ error: authzUploadScreenshot.reason || '无权限' });
  }
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: '请选择截图文件' });
  }
  const magicMime = detectImageMimeByMagic(file.buffer);
  const allowedTypes = new Set(['image/jpeg', 'image/png']);
  if (!allowedTypes.has(String(file.mimetype || '').toLowerCase()) || !allowedTypes.has(magicMime)) {
    return res.status(400).json({ error: '仅支持上传jpg或png图片' });
  }
  const ext = magicMime === 'image/png' ? '.png' : '.jpg';
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const random = crypto.randomBytes(8).toString('hex');
  const filename = `license_${id}_${Date.now()}_${random}${ext}`;
  const filepath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(filepath, file.buffer);
  const url = `/uploads/${filename}`;
  let screenshotValid = null;
  let ocrText = '';
  let ocrError = null;
  try {
    const configs = await getConfigs();
    const text = await runAliyunOcr({ buffer: file.buffer, configs });
    ocrText = text;
    if (text) {
      const matched = matchOcrKeywords(text, configs.ocr);
      if (matched !== null) screenshotValid = matched;
    }
  } catch (err) {
    ocrError = err.message || 'OCR识别失败';
  }
  await db.run(
    'UPDATE licenses SET screenshot_url = ?, screenshot_valid = ?, screenshot_ocr_text = ? WHERE id = ?',
    [url, screenshotValid, ocrText || null, id]
  );
  if (license.screenshot_url && license.screenshot_url !== url) {
    await cleanupScreenshotFile(license.screenshot_url);
  }
  await logOperation({
    user: req.user,
    action: 'UPLOAD',
    entity: 'license_screenshot',
    entityId: Number(id),
    beforeData: { screenshot_url: license.screenshot_url || '' },
    afterData: { screenshot_url: url, screenshot_valid: screenshotValid, ocr_error: ocrError || '' },
  });
  res.json({
    ok: true,
    screenshot_url: url,
    screenshot_valid: screenshotValid,
    ocr_error: ocrError || null,
  });
});

app.delete('/api/licenses/:id/screenshot', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const license = await db.get('SELECT * FROM licenses WHERE id = ?', [id]);
  if (!license) {
    return res.status(404).json({ error: '授权不存在' });
  }
  const okLicense = await ensureLicenseInScope(req.scope, id);
  const authzDeleteScreenshot = await authorizeReminderAction(req, 'license:screenshot:delete', {
    license_in_scope: okLicense,
  });
  if (!authzDeleteScreenshot.allow) {
    return res.status(403).json({ error: authzDeleteScreenshot.reason || '无权限' });
  }
  await db.run(
    'UPDATE licenses SET screenshot_url = NULL, screenshot_valid = NULL, screenshot_ocr_text = NULL WHERE id = ?',
    [id]
  );
  await cleanupScreenshotFile(license.screenshot_url);
  await logOperation({
    user: req.user,
    action: 'DELETE',
    entity: 'license_screenshot',
    entityId: Number(id),
    beforeData: { screenshot_url: license.screenshot_url || '' },
    afterData: { screenshot_url: '' },
  });
  res.json({ ok: true });
});

app.get('/api/licenses/:id/screenshot/content', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const license = await db.get('SELECT id, screenshot_url FROM licenses WHERE id = ?', [id]);
  if (!license) {
    return res.status(404).json({ error: '授权不存在' });
  }
  const okLicense = await ensureLicenseInScope(req.scope, id);
  if (!okLicense) {
    return res.status(403).json({ error: '无权限访问该截图' });
  }
  if (!license.screenshot_url) {
    return res.status(404).json({ error: '截图不存在' });
  }
  const resolved = resolveScreenshotFilePath(license.screenshot_url);
  if (!resolved) {
    return res.status(404).json({ error: '截图路径无效' });
  }
  try {
    const fileBuffer = await fs.promises.readFile(resolved.fullPath);
    const mime = resolved.filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(fileBuffer);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return res.status(404).json({ error: '截图文件不存在' });
    }
    return res.status(500).json({ error: '读取截图失败' });
  }
});

app.delete('/api/licenses/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const before = await db.get('SELECT * FROM licenses WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: '授权不存在' });
  const allowedDeleteLicenseSet = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const licenseInScope = req.scope?.isAdmin ? true : allowedDeleteLicenseSet.has(Number(before.customer_id));
  const authzDeleteLicense = await authorizeReminderAction(req, 'license:delete', {
    license_in_scope: licenseInScope,
  });
  if (!authzDeleteLicense.allow) return res.status(403).json({ error: authzDeleteLicense.reason || '无权限' });
  await cleanupScreenshotFile(before.screenshot_url);
  await db.run('DELETE FROM licenses WHERE id = ?', [id]);
  await logOperation({
    user: req.user,
    action: 'DELETE',
    entity: 'license',
    entityId: Number(id),
    beforeData: before,
  });
  res.json({ ok: true });
});

// Autocomplete customers
app.get('/api/customers/autocomplete', requireRole(['admin']), async (req, res) => {
  const { q } = req.query;
  const where = ['name LIKE ?'];
  const params = [`%${q || ''}%`];
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const rows = await db.query(
    `SELECT id, name FROM customers WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT 20`,
    params
  );
  res.json(rows);
});

// Send configs
app.get('/api/send-configs', requireRole(['admin', 'sysadmin']), async (req, res) => {
  const rows = await db.query('SELECT `key`, value FROM send_configs');
  const result = rows.reduce((acc, row) => {
    acc[row.key] = JSON.parse(row.value);
    return acc;
  }, {});
  const masked = maskSecrets(result);
  if (req.user?.role === 'sysadmin') {
    return res.json({ security: masked.security || {} });
  }
  if (req.user?.role === 'admin') {
    const { security, ...businessConfigs } = masked;
    return res.json(businessConfigs);
  }
  return res.json(masked);
});

app.post('/api/send-configs', requireRole(['admin', 'sysadmin']), async (req, res) => {
  const configs = req.body || {};
  const incomingKeys = Object.keys(configs || {});
  const hasSecurityPayload = incomingKeys.includes('security');
  const hasBusinessPayload = incomingKeys.some((key) => key !== 'security');
  if (req.user?.role === 'sysadmin' && hasBusinessPayload) {
    return res.status(403).json({ error: '系统管理员仅可修改安全配置' });
  }
  if (req.user?.role === 'admin' && hasSecurityPayload) {
    return res.status(403).json({ error: '业务管理员不可修改安全配置' });
  }
  const existing = await getConfigs();
  const beforeSnapshot = existing;
  const locked = existing?.reminder?.locked;
  if (locked) {
    const incomingReminder = configs.reminder || existing.reminder || {};
    const existingReminder = existing.reminder || {};
    const sameTemplate =
      (incomingReminder.subject || '') === (existingReminder.subject || '') &&
      (incomingReminder.message || '') === (existingReminder.message || '');
    const isUnlock = existingReminder.locked === true && incomingReminder.locked === false;
    if (!sameTemplate && !isUnlock) {
      return res.status(400).json({ error: '提醒模板已锁定，无法修改' });
    }
  }
  const needsSecretKey =
    (configs.email && configs.email.pass && configs.email.pass !== SECRET_MASK) ||
    (configs.sms && configs.sms.accessKeySecret && configs.sms.accessKeySecret !== SECRET_MASK) ||
    (configs.wecom && configs.wecom.secret && configs.wecom.secret !== SECRET_MASK) ||
    (configs.ocr && configs.ocr.accessKeySecret && configs.ocr.accessKeySecret !== SECRET_MASK);
  if (needsSecretKey && !CONFIG_SECRET_KEY) {
    return res.status(400).json({ error: '请配置CONFIG_SECRET_KEY后再保存敏感信息' });
  }
  const nextConfigs = { ...existing, ...configs };
  if (configs.email) {
    const prev = existing.email || {};
    const merged = { ...prev, ...configs.email };
    merged.pass = applySecretUpdate({ incoming: configs.email.pass, existing: prev.pass });
    merged.pass = ensureEncrypted(merged.pass);
    nextConfigs.email = merged;
  }
  if (configs.sms) {
    const prev = existing.sms || {};
    const merged = { ...prev, ...configs.sms };
    merged.accessKeySecret = applySecretUpdate({
      incoming: configs.sms.accessKeySecret,
      existing: prev.accessKeySecret,
    });
    merged.accessKeySecret = ensureEncrypted(merged.accessKeySecret);
    nextConfigs.sms = merged;
  }
  if (configs.wecom) {
    const prev = existing.wecom || {};
    const merged = { ...prev, ...configs.wecom };
    merged.secret = applySecretUpdate({ incoming: configs.wecom.secret, existing: prev.secret });
    merged.secret = ensureEncrypted(merged.secret);
    nextConfigs.wecom = merged;
  }
  if (configs.ocr) {
    const prev = existing.ocr || {};
    const merged = { ...prev, ...configs.ocr };
    merged.accessKeySecret = applySecretUpdate({
      incoming: configs.ocr.accessKeySecret,
      existing: prev.accessKeySecret,
    });
    merged.accessKeySecret = ensureEncrypted(merged.accessKeySecret);
    nextConfigs.ocr = merged;
  }
  await db.transaction(async (trx) => {
    for (const [key, value] of Object.entries(nextConfigs)) {
      await trx.run(
        'INSERT INTO send_configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()',
        [key, JSON.stringify(value || {})]
      );
    }
  });
  await logOperation({
    user: req.user,
    action: 'UPDATE',
    entity: 'send_configs',
    entityId: 0,
    beforeData: beforeSnapshot,
    afterData: configs,
  });
  res.json({ ok: true });
});

const createMailer = (emailConfig) => {
  if (!emailConfig?.host) return null;
  return nodemailer.createTransport({
    host: emailConfig.host,
    port: Number(emailConfig.port || 465),
    secure: String(emailConfig.secure || '').toLowerCase() === 'true' || Number(emailConfig.port) === 465,
    auth: {
      user: emailConfig.user,
      pass: emailConfig.pass,
    },
  });
};

const sendEmail = async ({ contact, subject, message, configs }) => {
  const emailConfig = configs.email || {};
  if (!contact.email) {
    throw new Error('联系人没有邮箱');
  }
  const missing = [];
  if (!emailConfig.host) missing.push('SMTP服务器地址');
  if (!emailConfig.user) missing.push('用户名');
  if (!emailConfig.pass) missing.push('密码');
  if (missing.length) {
    throw new Error(`邮箱配置不完整：${missing.join('、')}`);
  }
  const transporter = createMailer(emailConfig);
  await transporter.sendMail({
    from: emailConfig.from || emailConfig.user,
    to: contact.email,
    subject,
    text: message,
  });
};

const buildTemplateParams = ({ smsConfig, context }) => {
  const raw = smsConfig.templateParams;
  let params = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      params = JSON.parse(raw);
    } catch (err) {
      params = null;
    }
  } else if (raw && typeof raw === 'object') {
    params = raw;
  }
  if (!params) {
    const key = smsConfig.templateParamKey || 'content';
    return { [key]: context.message };
  }
  const filled = {};
  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === 'string') {
      filled[key] = replaceTokens(value, context);
    } else {
      filled[key] = value;
    }
  });
  return filled;
};

const sendSmsAliyun = async ({ contact, message, subject, license, configs }) => {
  const sms = configs.sms || {};
  if (!contact.phone) {
    throw new Error('联系人没有手机号');
  }
  if (!sms.accessKeyId || !sms.accessKeySecret || !sms.signName || !sms.templateCode) {
    throw new Error('短信配置不完整');
  }
  const context = buildContext({ contact, license, subject, message });
  const client = new RPCClient({
    accessKeyId: sms.accessKeyId,
    accessKeySecret: sms.accessKeySecret,
    endpoint: sms.endpoint || 'https://dysmsapi.aliyuncs.com',
    apiVersion: sms.apiVersion || '2017-05-25',
  });
  const params = {
    PhoneNumbers: contact.phone,
    SignName: sms.signName,
    TemplateCode: sms.templateCode,
    TemplateParam: JSON.stringify(buildTemplateParams({ smsConfig: sms, context })),
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

const sendWecomWebhook = async ({ message, configs }) => {
  const wecom = configs.wecom || {};
  if (!wecom.webhook) {
    throw new Error('企业微信配置不完整');
  }
  const url = wecom.webhook.startsWith('http')
    ? wecom.webhook
    : `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${wecom.webhook}`;
  const payload = {
    msgtype: 'text',
    text: {
      content: message,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error('企业微信发送失败');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (data && data.errcode !== 0) {
    throw new Error(`企业微信发送失败: ${data.errmsg || data.errcode}`);
  }
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

const insertSendLog = async ({ contactId, licenseId, channels, status, errorCode, subject, message, error }) => {
  await db.run(
    'INSERT INTO send_logs (contact_id, license_id, channels, status, error_code, subject, message, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [contactId, licenseId, channels, status, errorCode, subject, message, error]
  );
};

const normalizeOcrRegion = (region) => {
  if (!region) return 'cn-beijing';
  if (region === 'cn-zhangjiakou' || region === 'cn-beijing') return region;
  return 'cn-beijing';
};

const resolveOcrEndpoint = (region) => {
  if (region === 'cn-zhangjiakou') return 'ocr.cn-zhangjiakou.aliyuncs.com';
  return 'ocr.cn-beijing.aliyuncs.com';
};

const extractOcrText = (data) => {
  if (!data) return '';
  let payload = data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (err) {
      return payload;
    }
  }
  if (payload.content) return String(payload.content);
  if (payload.prism_ocr) return String(payload.prism_ocr);
  if (payload.text) return String(payload.text);
  if (Array.isArray(payload.words)) return payload.words.join('');
  if (payload.result && typeof payload.result === 'string') return payload.result;
  return JSON.stringify(payload);
};

const runAliyunOcr = async ({ buffer, configs }) => {
  const ocr = configs.ocr || {};
  if (!ocr.enabled) {
    return '';
  }
  if (!ocr.accessKeyId || !ocr.accessKeySecret) {
    throw new Error('OCR配置不完整');
  }
  const region = normalizeOcrRegion(ocr.region);
  const endpoint = ocr.endpoint || resolveOcrEndpoint(region);
  const client = new RPCClient({
    accessKeyId: ocr.accessKeyId,
    accessKeySecret: ocr.accessKeySecret,
    endpoint,
    apiVersion: '2021-07-07',
    timeout: 10000,
  });
  const res = await client.request(
    'RecognizeGeneral',
    { body: buffer },
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } }
  );
  const content = extractOcrText(res?.Data ?? res?.data ?? res);
  return String(content || '');
};

const getOcrKeywords = (ocrConfig) => {
  const raw = ocrConfig?.keywords || '';
  return String(raw)
    .split(/[，,、]/)
    .map((v) => v.trim())
    .filter(Boolean);
};

const matchOcrKeywords = (text, ocrConfig) => {
  const keywords = getOcrKeywords(ocrConfig);
  if (!keywords.length) return null;
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized) return 0;
  const mode = ocrConfig?.matchMode === 'all' ? 'all' : 'any';
  if (mode === 'all') {
    return keywords.every((k) => normalized.includes(k)) ? 1 : 0;
  }
  return keywords.some((k) => normalized.includes(k)) ? 1 : 0;
};

const insertReminderLog = async ({ licenseId, contactId, channel, daysLeft, status, errorCode, error, isTest = 0 }) => {
  await db.run(
    'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [licenseId || 0, contactId || 0, channel, daysLeft || 0, status, errorCode || null, error || null, isTest]
  );
};

const calcDaysLeftValue = (endDate) => {
  if (!endDate) return 0;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return 0;
  const diff = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? diff : 0;
};

const normalizeWecomMode = (mode) => {
  if (mode === 'webhook' || mode === 'app' || mode === 'auto') return mode;
  return 'auto';
};

const sendToContacts = async ({
  contacts,
  channels,
  subject,
  message,
  license,
  isTest = false,
  logReminder = false,
  wecomMode = 'auto',
}) => {
  const configs = await getConfigs();
  const retryConfig = getRetryConfig(configs);
  const resolvedWecomMode = normalizeWecomMode(wecomMode);
  const results = [];
  for (const contact of contacts) {
    const logChannel = channels.includes('email') ? 'email' : channels[0];
    const { finalSubject: logSubject, finalMessage: logMessage } = buildSendContent({
      subject,
      message,
      contact,
      license,
      configs,
      channel: logChannel,
    });
    const channelResults = [];
    for (const channel of channels) {
      try {
        let attempt = 0;
        let lastError = null;
        let lastCode = null;
        const { finalSubject, finalMessage } = buildSendContent({
          subject,
          message,
          contact,
          license,
          configs,
          channel,
        });
        while (attempt <= retryConfig.maxRetries) {
          try {
            if (channel === 'email') {
              await sendEmail({ contact, subject: finalSubject, message: finalMessage, configs });
            }
            if (channel === 'sms') {
              await sendSmsAliyun({
                contact,
                message: finalMessage,
                subject: finalSubject,
                license,
                configs,
              });
            }
            if (channel === 'wecom') {
              const useWebhook =
                resolvedWecomMode === 'webhook' ||
                (resolvedWecomMode === 'auto' && configs.wecom?.webhook);
              if (useWebhook) {
                await sendWecomWebhook({ message: finalMessage, configs });
              } else {
                await sendWecomApp({ contact, message: finalMessage, configs });
              }
            }
            lastError = null;
            lastCode = null;
            break;
          } catch (err) {
            lastError = err;
            lastCode = classifyError(err);
            if (lastCode === 'CONFIG_MISSING' || lastCode === 'INVALID_CONTACT') {
              break;
            }
            if (attempt < retryConfig.maxRetries) {
              await delay(retryConfig.intervalMs);
            }
          }
          attempt += 1;
        }
        if (lastError) {
          channelResults.push({
            channel,
            status: 'FAILED',
            error: lastError.message,
            error_code: lastCode,
          });
        } else {
          channelResults.push({ channel, status: 'SENT' });
        }
      } catch (err) {
        channelResults.push({
          channel,
          status: 'FAILED',
          error: err.message,
          error_code: classifyError(err),
        });
      }
    }
    const hasFailure = channelResults.some((item) => item.status === 'FAILED');
    const errorCodes = channelResults
      .filter((item) => item.status === 'FAILED' && item.error_code)
      .map((item) => `${item.channel}:${item.error_code}`)
      .join('; ');
    await insertSendLog({
      contactId: contact.id,
      licenseId: license?.id || null,
      channels: JSON.stringify(channels),
      status: hasFailure ? 'PARTIAL' : 'SENT',
      errorCode: errorCodes || null,
      subject: logSubject,
      message: logMessage,
      error: hasFailure ? channelResults.map((c) => `${c.channel}:${c.error || ''}`).join('; ') : null,
    });
    if (logReminder && license?.id) {
      const daysLeft = license?.days_left ?? calcDaysLeftValue(license?.end_date);
      for (const result of channelResults) {
        await insertReminderLog({
          licenseId: license.id,
          contactId: contact.id,
          channel: result.channel,
          daysLeft,
          status: result.status === 'FAILED' ? 'FAILED' : 'SENT',
          errorCode: result.error_code || null,
          error: result.error || null,
          isTest: 0,
        });
      }
    }
    if (!isTest && license?.id) {
      // reminder logs are written elsewhere for scheduled sends
    }
    results.push({
      contactId: contact.id,
      name: contact.name,
      customer: contact.customer_name,
      channels: channelResults,
    });
  }
  return results;
};

const ensureContactsInScope = async (scope, contactIds = []) => {
  if (!scope || scope.isAdmin) return true;
  const ids = contactIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  const customerIds = (scope.customerIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id));
  if (!ids.length || !customerIds.length) return false;
  const row = await db.get(
    `SELECT COUNT(DISTINCT contacts.id) AS count
     FROM contacts
     JOIN contact_customers cc ON cc.contact_id = contacts.id
     WHERE contacts.id IN (${buildInClause(ids)})
     AND cc.customer_id IN (${buildInClause(customerIds)})`,
    [...ids, ...customerIds]
  );
  return Number(row?.count || 0) === ids.length;
};

const ensureLicenseInScope = async (scope, licenseId) => {
  if (!scope || scope.isAdmin) return true;
  const customerIds = (scope.customerIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id));
  if (!licenseId || !customerIds.length) return false;
  const row = await db.get(
    `SELECT 1 FROM licenses WHERE id = ? AND customer_id IN (${buildInClause(customerIds)})`,
    [licenseId, ...customerIds]
  );
  return !!row;
};

// Send
app.post('/api/send', requireRole(['admin']), async (req, res) => {
  const { contactIds, channels, subject, message, licenseId } = req.body;
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ error: '请选择联系人' });
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: '请选择发送渠道' });
  }
  const okContacts = await ensureContactsInScope(req.scope, contactIds);
  const okLicense = licenseId ? await ensureLicenseInScope(req.scope, licenseId) : undefined;
  const authzSend = await authorizeReminderAction(req, 'send:manual', {
    contacts_in_scope: okContacts,
    license_in_scope: okLicense,
  });
  if (!authzSend.allow) return res.status(403).json({ error: authzSend.reason || '无权限' });
  const contacts = await db.query(
    `SELECT contacts.*, customers.name AS customer_name
     FROM contacts JOIN customers ON customers.id = contacts.customer_id
     WHERE contacts.id IN (${contactIds.map(() => '?').join(',')})`,
    contactIds
  );
  const configs = await getConfigs();
  const rate = getRateLimitConfig(configs);
  if (contacts.length * channels.length > rate.maxPerRun) {
    return res.status(429).json({ error: '发送数量过大，请分批发送' });
  }
  const license =
    licenseId &&
    (await db.get(
      `SELECT licenses.*, customers.name AS customer_name,
        DATEDIFF(licenses.end_date, CURDATE()) AS days_left
       FROM licenses
       JOIN customers ON customers.id = licenses.customer_id
       WHERE licenses.id = ?`,
      [licenseId]
    ));

  const results = await sendToContacts({ contacts, channels, subject, message, license });
  res.json({ ok: true, results });
});

// Test senders
app.post('/api/test/email', requireRole(['admin']), async (req, res) => {
  const { email, subject, message } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: '请输入测试邮箱' });
  }
  const configs = await getConfigs();
  try {
    await sendEmail({
      contact: { email, name: '测试' },
      subject: subject || '测试邮件',
      message: message || '这是一封测试邮件。',
      configs,
    });
    await db.run(
      'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [0, 0, 'email', 0, 'SENT', null, null, 1]
    );
    res.json({ ok: true });
  } catch (err) {
    await db.run(
      'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [0, 0, 'email', 0, 'FAILED', classifyError(err), err.message, 1]
    );
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/test/sms', requireRole(['admin']), async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone) {
    return res.status(400).json({ error: '请输入测试手机号' });
  }
  const configs = await getConfigs();
  try {
    await sendSmsAliyun({
      contact: { phone, name: '测试' },
      subject: '测试短信',
      message: message || '这是一条测试短信。',
      license: null,
      configs,
    });
    await db.run(
      'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [0, 0, 'sms', 0, 'SENT', null, null, 1]
    );
    res.json({ ok: true });
  } catch (err) {
    await db.run(
      'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [0, 0, 'sms', 0, 'FAILED', classifyError(err), err.message, 1]
    );
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/test/wecom', requireRole(['admin']), async (req, res) => {
  const { userId, webhook, message } = req.body || {};
  const configs = await getConfigs();
  try {
    if (webhook) {
      await sendWecomWebhook({
        message: message || '这是一条测试企业微信消息。',
        configs: { ...configs, wecom: { ...configs.wecom, webhook } },
      });
    } else {
      if (!userId) {
        return res.status(400).json({ error: '请输入测试用户' });
      }
      await sendWecomApp({
        contact: { wecom_id: userId, name: '测试' },
        message: message || '这是一条测试企业微信消息。',
        configs,
      });
    }
    await db.run(
      'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [0, 0, 'wecom', 0, 'SENT', null, null, 1]
    );
    res.json({ ok: true });
  } catch (err) {
    await db.run(
      'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [0, 0, 'wecom', 0, 'FAILED', classifyError(err), err.message, 1]
    );
    res.status(400).json({ error: err.message });
  }
});

// Send plans
app.get('/api/send-plans', requireRole(['admin']), async (req, res) => {
  const where = [];
  const params = [];
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT send_plans.*, licenses.name AS license_name, licenses.end_date AS license_end_date, customers.name AS customer_name
     FROM send_plans
     JOIN licenses ON licenses.id = send_plans.license_id
     JOIN customers ON customers.id = licenses.customer_id
     ${whereSql}
     ORDER BY send_plans.id DESC`,
    params
  );
  res.json(
    rows.map((row) => ({
      ...row,
      contact_ids: JSON.parse(row.contact_ids || '[]'),
      channels: JSON.parse(row.channels || '[]'),
      enabled: row.enabled === 0 ? 0 : 1,
    }))
  );
});

app.post('/api/send-plans', requireRole(['admin']), async (req, res) => {
  const { name, license_id, contact_ids, channels, days, enabled, wecom_mode } = req.body || {};
  if (!name || !license_id) {
    return res.status(400).json({ error: '计划名称和授权必填' });
  }
  if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
    return res.status(400).json({ error: '请选择联系人' });
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: '请选择渠道' });
  }
  if (!days || !String(days).trim()) {
    return res.status(400).json({ error: '请填写提醒天数' });
  }
  const okContacts = await ensureContactsInScope(req.scope, contact_ids);
  const okLicense = await ensureLicenseInScope(req.scope, license_id);
  const authzCreatePlan = await authorizeReminderAction(req, 'send-plan:create', {
    contacts_in_scope: okContacts,
    license_in_scope: okLicense,
  });
  if (!authzCreatePlan.allow) return res.status(403).json({ error: authzCreatePlan.reason || '无权限' });
  const license = await db.get('SELECT end_date FROM licenses WHERE id = ?', [license_id]);
  const resolvedWecomMode = normalizeWecomMode(wecom_mode);
  const info = await db.run(
    'INSERT INTO send_plans (name, license_id, contact_ids, channels, days, wecom_mode, enabled, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      name.trim(),
      license_id,
      JSON.stringify(contact_ids),
      JSON.stringify(channels),
      days,
      resolvedWecomMode,
      enabled === 0 ? 0 : 1,
      null,
      license?.end_date || null,
    ]
  );
  const row = await db.get(
    `SELECT send_plans.*, licenses.name AS license_name, licenses.end_date AS license_end_date, customers.name AS customer_name
     FROM send_plans
     JOIN licenses ON licenses.id = send_plans.license_id
     JOIN customers ON customers.id = licenses.customer_id
     WHERE send_plans.id = ?`,
    [info.insertId]
  );
  await logOperation({
    user: req.user,
    action: 'CREATE',
    entity: 'send_plan',
    entityId: row.id,
    afterData: row,
  });
  res.json({
    ...row,
    contact_ids: JSON.parse(row.contact_ids || '[]'),
    channels: JSON.parse(row.channels || '[]'),
    enabled: row.enabled === 0 ? 0 : 1,
  });
});

app.put('/api/send-plans/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { name, license_id, contact_ids, channels, days, enabled, wecom_mode } = req.body || {};
  if (!name || !license_id) {
    return res.status(400).json({ error: '计划名称和授权必填' });
  }
  if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
    return res.status(400).json({ error: '请选择联系人' });
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: '请选择渠道' });
  }
  if (!days || !String(days).trim()) {
    return res.status(400).json({ error: '请填写提醒天数' });
  }
  const before = await db.get('SELECT * FROM send_plans WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: '计划不存在' });
  const okBefore = await ensureLicenseInScope(req.scope, before.license_id);
  const okContacts = await ensureContactsInScope(req.scope, contact_ids);
  const okLicense = await ensureLicenseInScope(req.scope, license_id);
  const authzUpdatePlan = await authorizeReminderAction(req, 'send-plan:update', {
    contacts_in_scope: okContacts,
    license_in_scope: okBefore && okLicense,
  });
  if (!authzUpdatePlan.allow) return res.status(403).json({ error: authzUpdatePlan.reason || '无权限' });
  const license = await db.get('SELECT end_date FROM licenses WHERE id = ?', [license_id]);
  const resolvedWecomMode = normalizeWecomMode(wecom_mode);
  await db.run(
    'UPDATE send_plans SET name = ?, license_id = ?, contact_ids = ?, channels = ?, days = ?, wecom_mode = ?, enabled = ?, start_date = ?, end_date = ? WHERE id = ?',
    [
      name.trim(),
      license_id,
      JSON.stringify(contact_ids),
      JSON.stringify(channels),
      days,
      resolvedWecomMode,
      enabled === 0 ? 0 : 1,
      null,
      license?.end_date || null,
      id,
    ]
  );
  const row = await db.get(
    `SELECT send_plans.*, licenses.name AS license_name, licenses.end_date AS license_end_date, customers.name AS customer_name
     FROM send_plans
     JOIN licenses ON licenses.id = send_plans.license_id
     JOIN customers ON customers.id = licenses.customer_id
     WHERE send_plans.id = ?`,
    [id]
  );
  await logOperation({
    user: req.user,
    action: 'UPDATE',
    entity: 'send_plan',
    entityId: Number(id),
    beforeData: before,
    afterData: row,
  });
  res.json({
    ...row,
    contact_ids: JSON.parse(row.contact_ids || '[]'),
    channels: JSON.parse(row.channels || '[]'),
    enabled: row.enabled === 0 ? 0 : 1,
  });
});

app.delete('/api/send-plans/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const before = await db.get('SELECT * FROM send_plans WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: '计划不存在' });
  const okLicense = await ensureLicenseInScope(req.scope, before.license_id);
  const authzDeletePlan = await authorizeReminderAction(req, 'send-plan:delete', {
    contacts_in_scope: true,
    license_in_scope: okLicense,
  });
  if (!authzDeletePlan.allow) return res.status(403).json({ error: authzDeletePlan.reason || '无权限' });
  await db.run('DELETE FROM send_plans WHERE id = ?', [id]);
  await logOperation({
    user: req.user,
    action: 'DELETE',
    entity: 'send_plan',
    entityId: Number(id),
    beforeData: before,
  });
  res.json({ ok: true });
});

app.post('/api/send-plans/send-now', requireRole(['admin']), async (req, res) => {
  const { plan_ids } = req.body || {};
  if (!Array.isArray(plan_ids) || plan_ids.length === 0) {
    return res.status(400).json({ error: '请选择发送计划' });
  }
  const ids = plan_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  if (!ids.length) return res.status(400).json({ error: '请选择发送计划' });
  const plans = await db.query(
    `SELECT send_plans.*, licenses.name AS license_name, licenses.end_date AS license_end_date,
      customers.name AS customer_name,
      DATEDIFF(licenses.end_date, CURDATE()) AS days_left
     FROM send_plans
     JOIN licenses ON licenses.id = send_plans.license_id
     JOIN customers ON customers.id = licenses.customer_id
     WHERE send_plans.id IN (${buildInClause(ids)})`,
    ids
  );
  if (!plans.length) return res.status(404).json({ error: '计划不存在' });

  let batchInScope = true;
  for (const plan of plans) {
    const okLicense = await ensureLicenseInScope(req.scope, plan.license_id);
    let contactIds = [];
    try {
      contactIds = JSON.parse(plan.contact_ids || '[]');
    } catch (err) {
      contactIds = [];
    }
    const okContacts = await ensureContactsInScope(req.scope, contactIds);
    if (!okLicense || !okContacts) {
      batchInScope = false;
      break;
    }
  }
  const authzSendNow = await authorizeReminderAction(req, 'send-plan:send-now', {
    contacts_in_scope: batchInScope,
    license_in_scope: batchInScope,
  });
  if (!authzSendNow.allow) return res.status(403).json({ error: authzSendNow.reason || '无权限' });

  const configs = await getConfigs();
  const rate = getRateLimitConfig(configs);
  let totalUnits = 0;
  for (const plan of plans) {
    let contactIds = [];
    let channels = [];
    try {
      contactIds = JSON.parse(plan.contact_ids || '[]');
    } catch (err) {
      contactIds = [];
    }
    try {
      channels = JSON.parse(plan.channels || '[]');
    } catch (err) {
      channels = [];
    }
    totalUnits += contactIds.length * channels.length;
  }
  if (totalUnits > rate.maxPerRun) {
    return res.status(429).json({ error: '发送数量过大，请分批发送' });
  }

  const results = [];
  for (const plan of plans) {
    let contactIds = [];
    let channels = [];
    try {
      contactIds = JSON.parse(plan.contact_ids || '[]');
    } catch (err) {
      contactIds = [];
    }
    try {
      channels = JSON.parse(plan.channels || '[]');
    } catch (err) {
      channels = [];
    }
    if (!contactIds.length || !channels.length) {
      results.push({ plan_id: plan.id, ok: false, error: '计划联系人或渠道为空' });
      continue;
    }
    const contacts = await db.query(
      `SELECT contacts.*, customers.name AS customer_name
       FROM contacts
       JOIN customers ON customers.id = contacts.customer_id
       WHERE contacts.is_active = 1
       AND contacts.id IN (${buildInClause(contactIds)})`,
      contactIds
    );
    if (!contacts.length) {
      results.push({ plan_id: plan.id, ok: false, error: '没有可发送的联系人（可能已停用或不在范围）' });
      continue;
    }
    const license = {
      id: plan.license_id,
      name: plan.license_name,
      end_date: plan.license_end_date,
      customer_name: plan.customer_name,
      days_left: plan.days_left,
    };
    try {
      const sendResult = await sendToContacts({
        contacts,
        channels,
        subject: null,
        message: null,
        license,
        logReminder: true,
        wecomMode: plan.wecom_mode,
      });
      results.push({ plan_id: plan.id, ok: true, results: sendResult });
    } catch (err) {
      results.push({ plan_id: plan.id, ok: false, error: err.message || '发送失败' });
    }
  }

  res.json({ ok: true, results });
});

app.get('/api/send-logs', requireRole(['admin']), async (req, res) => {
  const where = [];
  const params = [];
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT send_logs.*, contacts.name AS contact_name, customers.name AS customer_name,
      licenses.name AS license_name
     FROM send_logs
     JOIN contacts ON contacts.id = send_logs.contact_id
     JOIN customers ON customers.id = contacts.customer_id
     LEFT JOIN licenses ON licenses.id = send_logs.license_id
     ${whereSql}
     ORDER BY send_logs.id DESC LIMIT 200`,
    params
  );
  res.json(rows);
});

app.get('/api/operation-logs', requireRole(['auditor']), async (req, res) => {
  const { username, system, action, entity, date_from, date_to, limit } = req.query || {};
  const where = [];
  const params = [];
  const systemKey = String(system || 'reminder').trim() || 'reminder';
  where.push('log_system = ?');
  params.push(systemKey);
  if (username) {
    where.push('username LIKE ?');
    params.push(`%${username}%`);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (entity) {
    where.push('entity = ?');
    params.push(entity);
  }
  if (date_from) {
    where.push('created_at >= ?');
    params.push(date_from);
  }
  if (date_to) {
    where.push('created_at <= ?');
    params.push(date_to);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const take = Math.min(Math.max(Number(limit || 300), 1), 2000);
  const rows = await db.query(
    `SELECT
       id, user_id, username, log_system AS \`system\`, action, entity, entity_id,
       before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at
     FROM operation_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ?`,
    [...params, take]
  );
  res.json(rows);
});

app.get('/api/operation-logs/export', requireRole(['auditor']), async (req, res) => {
  const { username, system, action, entity, date_from, date_to } = req.query || {};
  const where = [];
  const params = [];
  const systemKey = String(system || 'reminder').trim() || 'reminder';
  where.push('log_system = ?');
  params.push(systemKey);
  if (username) {
    where.push('username LIKE ?');
    params.push(`%${username}%`);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (entity) {
    where.push('entity = ?');
    params.push(entity);
  }
  if (date_from) {
    where.push('created_at >= ?');
    params.push(date_from);
  }
  if (date_to) {
    where.push('created_at <= ?');
    params.push(date_to);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT id, username, log_system AS \`system\`, action, entity, entity_id, before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at
     FROM operation_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT 5000`,
    params
  );
  const localizedRows = rows.map((row) => ({
    ...row,
    system: toAuditSystemZh(row.system),
    action: toAuditActionZh(row.action),
    entity: toAuditEntityZh(row.entity),
  }));

  const csv = toCsv(localizedRows, [
    { key: 'id', label: 'ID' },
    { key: 'username', label: '用户' },
    { key: 'system', label: '系统' },
    { key: 'action', label: '动作' },
    { key: 'entity', label: '对象' },
    { key: 'entity_id', label: '对象ID' },
    { key: 'before_data', label: '变更前' },
    { key: 'after_data', label: '变更后' },
    { key: 'prev_hash', label: '前一条签名' },
    { key: 'signature', label: '当前签名' },
    { key: 'sign_version', label: '签名版本' },
    { key: 'request_ip', label: '来源IP' },
    { key: 'created_at', label: '时间' },
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=\"operation_logs.csv\"`);
  res.send(csv);
});

const verifyOperationLogChain = async (limitInput) => {
  const limit = Math.min(Math.max(Number(limitInput || 10000), 1), 50000);
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
};

app.get('/api/operation-logs/verify', requireRole(['auditor']), async (req, res) => {
  const result = await verifyOperationLogChain(req.query.limit);
  return res.json(result);
});

app.get('/api/operation-logs/verify/export', requireRole(['auditor']), async (req, res) => {
  const result = await verifyOperationLogChain(req.query.limit);
  const generatedAt = new Date();
  const filename = `audit-verify-report-${generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  const rows = [
    {
      generated_at: generatedAt.toISOString(),
      result: result.ok ? '通过' : '失败',
      checked: Number(result.checked || 0),
      latest_id: Number(result.latest_id || 0),
      failed_id: Number(result.failed_id || 0),
      reason: result.reason || '',
      verify_limit: Math.min(Math.max(Number(req.query.limit || 10000), 1), 50000),
    },
  ];
  const csv = toCsv(rows, [
    { key: 'generated_at', label: '核验时间' },
    { key: 'result', label: '核验结果' },
    { key: 'checked', label: '已校验条数' },
    { key: 'latest_id', label: '最新记录ID' },
    { key: 'failed_id', label: '失败记录ID' },
    { key: 'reason', label: '失败原因' },
    { key: 'verify_limit', label: '核验上限' },
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

app.get('/api/import-jobs', requireRole(['admin']), async (req, res) => {
  const { type, status, username, date_from, date_to, limit } = req.query || {};
  const where = [];
  const params = [];
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (username) {
    where.push('username LIKE ?');
    params.push(`%${username}%`);
  }
  if (date_from) {
    where.push('created_at >= ?');
    params.push(date_from);
  }
  if (date_to) {
    where.push('created_at <= ?');
    params.push(date_to);
  }
  if (req.scope && !req.scope.isAdmin) {
    where.push('user_id = ?');
    params.push(req.user.id);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const take = Math.min(Math.max(Number(limit || 300), 1), 2000);
  const rows = await db.query(
    `SELECT id, username, type, filename, status, created, skipped, total, error_count, error_message, created_at
     FROM import_jobs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ?`,
    [...params, take]
  );
  res.json(rows);
});

app.get('/api/import-jobs/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const row = await db.get('SELECT * FROM import_jobs WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  const authzImportJob = await authorizeReminderAction(req, 'import-job:read', {
    own_job: Number(row.user_id) === Number(req.user.id),
  });
  if (!authzImportJob.allow) return res.status(403).json({ error: authzImportJob.reason || '无权限' });
  let errors = [];
  try {
    errors = row.errors_json ? JSON.parse(row.errors_json) : [];
  } catch (err) {
    errors = [];
  }
  res.json({ ...row, errors });
});

app.post('/api/auth/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '请输入当前密码和新密码' });
  }
  const security = await getSecurityConfig();
  const passwordRuleError = validatePasswordComplexity(newPassword, security.passwordPolicy);
  if (passwordRuleError) {
    return res.status(400).json({ error: passwordRuleError });
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) {
    return res.status(400).json({ error: '用户不存在' });
  }
  const ok = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!ok) {
    return res.status(400).json({ error: '当前密码错误' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
  await logOperation({
    user: req.user,
    action: 'CHANGE_PASSWORD',
    entity: 'user',
    entityId: Number(user.id),
  });
  res.json({ ok: true });
});

app.post('/api/users/:id/reset-password', requireRole(['sysadmin']), async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  if (!newPassword) {
    return res.status(400).json({ error: '请输入新密码' });
  }
  const targetUser = await db.get('SELECT id, username FROM users WHERE id = ?', [id]);
  if (!targetUser) {
    return res.status(404).json({ error: '用户不存在' });
  }
  const security = await getSecurityConfig();
  const passwordRuleError = validatePasswordComplexity(newPassword, security.passwordPolicy);
  if (passwordRuleError) {
    return res.status(400).json({ error: passwordRuleError });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  await logOperation({
    user: req.user,
    action: 'RESET_PASSWORD',
    entity: 'user',
    entityId: Number(id),
    afterData: { username: targetUser.username },
  });
  res.json({ ok: true });
});

// Import (CSV)
app.post('/api/import/customers', requireRole(['admin']), importRateLimiter, upload.single('file'), async (req, res) => {
  const authzImportCustomers = await authorizeReminderAction(req, 'import:customers', {});
  if (!authzImportCustomers.allow) {
    return res.status(403).json({ error: authzImportCustomers.reason || '无权限' });
  }
  if (!req.file) {
    return res.status(400).json({ error: '请上传CSV或Excel文件' });
  }
  let records = [];
  try {
    records = parseImportFile(req.file);
  } catch (err) {
    await insertImportJob({
      user: req.user,
      type: 'customers',
      filename: req.file?.originalname,
      status: 'FAILED',
      errorMessage: '文件解析失败',
    });
    return res.status(400).json({ error: '文件解析失败' });
  }
  let created = 0;
  let skipped = 0;
  const errors = [];
  for (const [index, row] of records.entries()) {
    const name = row.name || row['客户名称'];
    if (!name) {
      skipped += 1;
      errors.push({ row: index + 1, reason: '缺少客户名称' });
      continue;
    }
    const juxin = row.juxin_sales || row['聚信销售'] || '';
    const channel = row.channel_sales || row['渠道销售'] || '';
    try {
      const info = await db.run(
        'INSERT INTO customers (name, juxin_sales, channel_sales) VALUES (?, ?, ?)',
        [String(name).trim(), String(juxin).trim(), String(channel).trim()]
      );
      created += 1;
      await logOperation({
        user: req.user,
        action: 'IMPORT',
        entity: 'customer',
        entityId: info.insertId,
        afterData: { name, juxin_sales: juxin, channel_sales: channel },
      });
    } catch (err) {
      skipped += 1;
      errors.push({ row: index + 1, reason: '客户名称重复或数据错误' });
    }
  }
  await insertImportJob({
    user: req.user,
    type: 'customers',
    filename: req.file?.originalname,
    status: 'DONE',
    created,
    skipped,
    total: records.length,
    errors,
  });
  res.json({ ok: true, created, skipped, total: records.length, errors });
});

app.post('/api/import/contacts', requireRole(['admin']), importRateLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传CSV或Excel文件' });
  }
  let records = [];
  try {
    records = parseImportFile(req.file);
  } catch (err) {
    await insertImportJob({
      user: req.user,
      type: 'contacts',
      filename: req.file?.originalname,
      status: 'FAILED',
      errorMessage: '文件解析失败',
    });
    return res.status(400).json({ error: '文件解析失败' });
  }
  let created = 0;
  let skipped = 0;
  const errors = [];
  let allowedNames = null;
  const customerIds = req.scope?.customerIds || [];
  if (customerIds.length) {
    const rows = await db.query(
      `SELECT id, name FROM customers WHERE id IN (${buildInClause(customerIds)})`,
      customerIds
    );
    allowedNames = new Set(rows.map((r) => r.name));
  }
  const unauthorized = [];
  records.forEach((row, idx) => {
    const customerName = row.customer_name || row['客户名称'];
    if (customerName && allowedNames && !allowedNames.has(String(customerName).trim())) {
      unauthorized.push({ row: idx + 1, reason: '无权限导入该客户' });
    }
  });
  const authzImportContacts = await authorizeReminderAction(req, 'import:contacts', {
    customer_names_in_scope: unauthorized.length === 0,
  });
  if (!authzImportContacts.allow || unauthorized.length) {
    await insertImportJob({
      user: req.user,
      type: 'contacts',
      filename: req.file?.originalname,
      status: 'FAILED',
      created: 0,
      skipped: unauthorized.length,
      total: records.length,
      errors: unauthorized,
      errorMessage: '存在无权限客户',
    });
    return res.status(403).json({ error: '无权限导入该客户', errors: unauthorized });
  }
  for (const [index, row] of records.entries()) {
    const customerName = row.customer_name || row['客户名称'];
    const name = row.name || row['联系人'];
    if (!customerName || !name) {
      skipped += 1;
      errors.push({ row: index + 1, reason: '缺少客户名称或联系人' });
      continue;
    }
    let customer = await db.get('SELECT * FROM customers WHERE name = ?', [customerName]);
    if (!customer) {
      try {
        const info = await db.run(
          'INSERT INTO customers (name, juxin_sales, channel_sales) VALUES (?, ?, ?)',
          [String(customerName).trim(), '', '']
        );
        customer = await db.get('SELECT * FROM customers WHERE id = ?', [info.insertId]);
      } catch (err) {
        skipped += 1;
        errors.push({ row: index + 1, reason: '客户创建失败' });
        continue;
      }
    }
    const phone = row.phone || row['电话'] || '';
    const email = row.email || row['邮箱'] || '';
    const wecom = row.wecom_id || row['企业微信'] || '';
    const isActiveRaw = row.is_active || row['状态'] || '1';
    const isActive = String(isActiveRaw) === '0' ? 0 : 1;
    try {
      const info = await db.run(
        'INSERT INTO contacts (customer_id, name, phone, email, wecom_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
        [customer.id, String(name).trim(), String(phone).trim(), String(email).trim(), String(wecom).trim(), isActive]
      );
      await db.run('INSERT INTO contact_customers (contact_id, customer_id) VALUES (?, ?)', [
        info.insertId,
        customer.id,
      ]);
      created += 1;
      await logOperation({
        user: req.user,
        action: 'IMPORT',
        entity: 'contact',
        entityId: info.insertId,
        afterData: { customer_id: customer.id, name, phone, email, wecom_id: wecom, is_active: isActive },
      });
    } catch (err) {
      skipped += 1;
      errors.push({ row: index + 1, reason: '联系人创建失败或重复' });
    }
  }
  await insertImportJob({
    user: req.user,
    type: 'contacts',
    filename: req.file?.originalname,
    status: 'DONE',
    created,
    skipped,
    total: records.length,
    errors,
  });
  res.json({ ok: true, created, skipped, total: records.length, errors });
});

app.get('/api/dashboard', requireRole(['admin']), async (req, res) => {
  const days = Number(req.query.days || 30);
  const range = Number.isFinite(days) ? days : 30;
  const { customer_id, sales, channel } = req.query || {};

  const licenseWhere = [];
  const licenseParams = [];
  if (customer_id) {
    licenseWhere.push('customers.id = ?');
    licenseParams.push(customer_id);
  }
  if (sales) {
    licenseWhere.push('(customers.juxin_sales = ? OR customers.channel_sales = ?)');
    licenseParams.push(sales, sales);
  }
  applyScopeFilter({ scope: req.scope, where: licenseWhere, params: licenseParams, column: 'customers.id' });
  const licenseWhereSql = licenseWhere.length ? `AND ${licenseWhere.join(' AND ')}` : '';

  const licenseDaysExpr = `DATEDIFF(licenses.end_date, CURDATE())`;

  const expiringRow = await db.get(
    `SELECT COUNT(1) AS count
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE licenses.end_date >= CURDATE()
     AND licenses.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ${licenseWhereSql}`,
    [range, ...licenseParams]
  );
  const expiring = Number(expiringRow?.count || 0);

  const todayRow = await db.get(
    `SELECT COUNT(1) AS count
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE DATE(licenses.end_date) = CURDATE()
     ${licenseWhereSql}`,
    licenseParams
  );
  const todayDue = Number(todayRow?.count || 0);

  const reminderWhere = [`reminder_logs.is_test = 0`];
  const reminderParams = [];
  if (channel) {
    reminderWhere.push('reminder_logs.channel = ?');
    reminderParams.push(channel);
  }
  if (customer_id) {
    reminderWhere.push('customers.id = ?');
    reminderParams.push(customer_id);
  }
  if (sales) {
    reminderWhere.push('(customers.juxin_sales = ? OR customers.channel_sales = ?)');
    reminderParams.push(sales, sales);
  }
  applyScopeFilter({ scope: req.scope, where: reminderWhere, params: reminderParams, column: 'customers.id' });
  // Limit dashboard charts to recent N days for better signal.
  reminderWhere.push(`DATE(reminder_logs.sent_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`);
  reminderParams.push(range);
  const reminderWhereSql = reminderWhere.length ? `WHERE ${reminderWhere.join(' AND ')}` : '';

  const agg = await db.get(
    `SELECT COUNT(1) AS total,
      SUM(CASE WHEN reminder_logs.status = 'SENT' THEN 1 ELSE 0 END) AS success
     FROM reminder_logs
     JOIN licenses ON licenses.id = reminder_logs.license_id
     JOIN customers ON customers.id = licenses.customer_id
     ${reminderWhereSql}`,
    reminderParams
  );

  const totalReminders = Number(agg.total || 0);
  const successCount = Number(agg.success || 0);
  const successRate = totalReminders === 0 ? 0 : Math.round((successCount / totalReminders) * 100);

  const channelBreakdownRows = await db.query(
    `SELECT reminder_logs.channel AS channel,
      COUNT(1) AS total,
      SUM(CASE WHEN reminder_logs.status = 'SENT' THEN 1 ELSE 0 END) AS success
     FROM reminder_logs
     JOIN licenses ON licenses.id = reminder_logs.license_id
     JOIN customers ON customers.id = licenses.customer_id
     ${reminderWhereSql}
     GROUP BY reminder_logs.channel`,
    reminderParams
  );

  const channelBreakdown = { email: { total: 0, success: 0 }, sms: { total: 0, success: 0 }, wecom: { total: 0, success: 0 } };
  channelBreakdownRows.forEach((r) => {
    const key = String(r.channel || '').trim();
    if (!key) return;
    if (!channelBreakdown[key]) channelBreakdown[key] = { total: 0, success: 0 };
    channelBreakdown[key] = {
      total: Number(r.total || 0),
      success: Number(r.success || 0),
    };
  });

  const trendRows = await db.query(
    `SELECT DATE(reminder_logs.sent_at) AS day,
      COUNT(1) AS total,
      SUM(CASE WHEN reminder_logs.status = 'SENT' THEN 1 ELSE 0 END) AS success
     FROM reminder_logs
     JOIN licenses ON licenses.id = reminder_logs.license_id
     JOIN customers ON customers.id = licenses.customer_id
     ${reminderWhereSql}
     GROUP BY DATE(reminder_logs.sent_at)
     ORDER BY DATE(reminder_logs.sent_at) ASC`,
    reminderParams
  );

  const failureRows = await db.query(
    `SELECT COALESCE(reminder_logs.error_code, 'UNKNOWN') AS code,
      COUNT(1) AS count
     FROM reminder_logs
     JOIN licenses ON licenses.id = reminder_logs.license_id
     JOIN customers ON customers.id = licenses.customer_id
     ${reminderWhereSql}
     AND reminder_logs.status = 'FAILED'
     GROUP BY COALESCE(reminder_logs.error_code, 'UNKNOWN')
     ORDER BY count DESC
     LIMIT 10`,
    reminderParams
  );

  const bucketRow = await db.get(
    `SELECT
      SUM(CASE WHEN days_left BETWEEN 0 AND 7 THEN 1 ELSE 0 END) AS b0_7,
      SUM(CASE WHEN days_left BETWEEN 8 AND 15 THEN 1 ELSE 0 END) AS b8_15,
      SUM(CASE WHEN days_left BETWEEN 16 AND 30 THEN 1 ELSE 0 END) AS b16_30,
      SUM(CASE WHEN days_left BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS b31_60,
      SUM(CASE WHEN days_left > 60 THEN 1 ELSE 0 END) AS b60p
     FROM (
       SELECT ${licenseDaysExpr} AS days_left
       FROM licenses
       JOIN customers ON customers.id = licenses.customer_id
       WHERE licenses.end_date >= CURDATE()
       ${licenseWhereSql}
     ) t`,
    licenseParams
  );

  const expiryBuckets = [
    { key: '0-7', label: '0-7天', count: Number(bucketRow?.b0_7 || 0) },
    { key: '8-15', label: '8-15天', count: Number(bucketRow?.b8_15 || 0) },
    { key: '16-30', label: '16-30天', count: Number(bucketRow?.b16_30 || 0) },
    { key: '31-60', label: '31-60天', count: Number(bucketRow?.b31_60 || 0) },
    { key: '60+', label: '60天以上', count: Number(bucketRow?.b60p || 0) },
  ];

  const salesTopRows = await db.query(
    `SELECT COALESCE(NULLIF(customers.juxin_sales, ''), NULLIF(customers.channel_sales, ''), '未分配') AS sales_name,
      COUNT(1) AS count
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE ${licenseDaysExpr} BETWEEN 0 AND 30
     ${licenseWhereSql}
     GROUP BY COALESCE(NULLIF(customers.juxin_sales, ''), NULLIF(customers.channel_sales, ''), '未分配')
     ORDER BY count DESC
     LIMIT 8`,
    licenseParams
  );

  const customerRiskRows = await db.query(
    `SELECT customers.name AS customer_name,
      COUNT(1) AS count
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE ${licenseDaysExpr} BETWEEN 0 AND 30
     ${licenseWhereSql}
     GROUP BY customers.id
     ORDER BY count DESC, customers.name ASC
     LIMIT 10`,
    licenseParams
  );

  res.json({
    expiring,
    todayDue,
    totalReminders,
    successRate,
    channelBreakdown,
    trend: trendRows.map((r) => ({ day: r.day, total: Number(r.total || 0), success: Number(r.success || 0) })),
    failureBreakdown: failureRows.map((r) => ({ code: r.code, count: Number(r.count || 0) })),
    expiryBuckets,
    salesTop: salesTopRows.map((r) => ({ name: r.sales_name, count: Number(r.count || 0) })),
    customerRisk: customerRiskRows.map((r) => ({ name: r.customer_name, count: Number(r.count || 0) })),
  });
});

app.get('/api/reminder-logs', requireRole(['admin']), async (req, res) => {
  const { customer_id, status, days_left, date_from, date_to, is_test, error_code } = req.query;
  const where = [];
  const params = [];
  if (customer_id) {
    where.push('customers.id = ?');
    params.push(customer_id);
  }
  if (status) {
    where.push('reminder_logs.status = ?');
    params.push(status);
  }
  if (days_left) {
    where.push('reminder_logs.days_left = ?');
    params.push(days_left);
  }
  if (date_from) {
    where.push('DATE(reminder_logs.sent_at) >= DATE(?)');
    params.push(date_from);
  }
  if (date_to) {
    where.push('DATE(reminder_logs.sent_at) <= DATE(?)');
    params.push(date_to);
  }
  if (is_test === '0' || is_test === '1') {
    where.push('reminder_logs.is_test = ?');
    params.push(is_test);
  }
  if (error_code) {
    where.push('reminder_logs.error_code = ?');
    params.push(error_code);
  }
  applyScopeFilter({ scope: req.scope, where, params, column: 'customers.id' });
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT reminder_logs.*, contacts.name AS contact_name, customers.name AS customer_name,
      licenses.name AS license_name
     FROM reminder_logs
     LEFT JOIN contacts ON contacts.id = reminder_logs.contact_id
     LEFT JOIN licenses ON licenses.id = reminder_logs.license_id
     LEFT JOIN customers ON customers.id = licenses.customer_id
     ${whereSql}
     ORDER BY reminder_logs.id DESC LIMIT 300`,
    params
  );
  res.json(rows);
});

app.post('/api/reminder-logs/:id/resend', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const log = await db.get(
    `SELECT reminder_logs.*, contacts.*, customers.name AS customer_name,
      customers.id AS customer_id,
      licenses.name AS license_name, licenses.end_date AS end_date
     FROM reminder_logs
     JOIN contacts ON contacts.id = reminder_logs.contact_id
     JOIN licenses ON licenses.id = reminder_logs.license_id
     JOIN customers ON customers.id = licenses.customer_id
     WHERE reminder_logs.id = ?`,
    [id]
  );
  if (!log) {
    return res.status(404).json({ error: '记录不存在' });
  }
  const allowedResendSet = new Set((req.scope?.customerIds || []).map((cid) => Number(cid)));
  const licenseInScope = req.scope?.isAdmin ? true : allowedResendSet.has(Number(log.customer_id));
  const authzResend = await authorizeReminderAction(req, 'reminder-log:resend', {
    license_in_scope: licenseInScope,
  });
  if (!authzResend.allow) return res.status(403).json({ error: authzResend.reason || '无权限' });
  const license = {
    id: log.license_id,
    name: log.license_name,
    end_date: log.end_date,
    customer_name: log.customer_name,
    days_left: log.days_left,
  };
  let status = 'SENT';
  let error = null;
  let errorCode = null;
  try {
    await sendToContacts({
      contacts: [log],
      channels: [log.channel],
      subject: null,
      message: null,
      license,
    });
  } catch (err) {
    status = 'FAILED';
    error = err.message;
    errorCode = classifyError(err);
  }
  await db.run(
    'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [log.license_id, log.contact_id, log.channel, log.days_left, status, errorCode, error, 0]
  );
  res.json({ ok: true, status, error });
});

const scheduleReminders = async () => {
  const configs = await getConfigs();
  const schedule = normalizeScheduleConfig(configs);
  const rate = getRateLimitConfig(configs);

  await db.run(
    `UPDATE licenses
     SET status = 'EXPIRED'
     WHERE status != 'EXPIRED'
     AND licenses.end_date < CURDATE()`
  );

  const plans = await db.query(
    `SELECT send_plans.*, licenses.end_date AS end_date, licenses.name AS license_name,
      customers.name AS customer_name,
      DATEDIFF(licenses.end_date, CURDATE()) AS days_left
     FROM send_plans
     JOIN licenses ON licenses.id = send_plans.license_id
     JOIN customers ON customers.id = licenses.customer_id
     WHERE send_plans.enabled = 1
     AND licenses.status = 'ACTIVE'
     AND licenses.end_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [schedule.graceDays || 0]
  );

  let sentCount = 0;
  for (const plan of plans) {
    const dayTargets = String(plan.days || '')
      .split(',')
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isFinite(d));
    if (!dayTargets.includes(plan.days_left)) continue;
    const contactIds = JSON.parse(plan.contact_ids || '[]');
    if (!contactIds.length) continue;
    const channels = JSON.parse(plan.channels || '[]');
    if (!channels.length) continue;
    const contacts = await db.query(
      `SELECT contacts.*, customers.name AS customer_name
       FROM contacts JOIN customers ON customers.id = contacts.customer_id
       WHERE contacts.is_active = 1
       AND contacts.id IN (${contactIds.map(() => '?').join(',')})`,
      contactIds
    );
    const today = new Date().toISOString().slice(0, 10);
    if (plan.start_date && today < plan.start_date) continue;
    if (plan.end_date && today > plan.end_date) continue;
    const license = {
      id: plan.license_id,
      name: plan.license_name,
      end_date: plan.end_date,
      customer_name: plan.customer_name,
      days_left: plan.days_left,
    };

    for (const channel of channels) {
      for (const contact of contacts) {
        const exists = await db.get(
          'SELECT 1 FROM reminder_sent WHERE license_id = ? AND contact_id = ? AND channel = ? AND days_left = ?',
          [plan.license_id, contact.id, channel, plan.days_left]
        );
        if (exists) continue;
        if (sentCount >= rate.maxPerRun) return;
        let status = 'SENT';
        let error = null;
        let errorCode = null;
        try {
          await sendToContacts({
            contacts: [contact],
            channels: [channel],
            subject: null,
            message: null,
            license,
            wecomMode: plan.wecom_mode,
          });
          await db.run(
            'INSERT INTO reminder_sent (license_id, contact_id, channel, days_left) VALUES (?, ?, ?, ?)',
            [plan.license_id, contact.id, channel, plan.days_left]
          );
        } catch (err) {
          status = 'FAILED';
          error = err.message;
          errorCode = classifyError(err);
        }
        await db.run(
          'INSERT INTO reminder_logs (license_id, contact_id, channel, days_left, status, error_code, error, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [plan.license_id, contact.id, channel, plan.days_left, status, errorCode, error, 0]
        );
        sentCount += 1;
      }
    }
  }
};

const startReminderCron = () => {
  (async () => {
    const configs = await getConfigs();
    const schedule = normalizeScheduleConfig(configs);
    const minute = Math.min(Math.max(schedule.minute, 0), 59);
    const hour = Math.min(Math.max(schedule.hour, 0), 23);
    const expression = `${minute} ${hour} * * *`;
    cron.schedule(expression, () => {
      scheduleReminders().catch((err) => {
        console.error('Reminder cron error', err);
      });
    });
    console.log(`Reminder cron scheduled at ${hour}:${String(minute).padStart(2, '0')}`);
  })();
};

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

const webDistPath = path.join(__dirname, '..', 'web', 'dist');
const webIndexPath = path.join(webDistPath, 'index.html');
const serveWeb = process.env.SERVE_WEB !== 'false';
if (serveWeb && fs.existsSync(webIndexPath)) {
  app.use(express.static(webDistPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.sendFile(webIndexPath);
  });
}

app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '上传文件过大' });
  }
  if (err) {
    console.error('Unhandled API error', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
  return next();
});

const start = async () => {
  validateSecurityBootstrap();
  await db.ready;
  await ensureBuiltinUsers();
  await backfillOperationLogSignatures();
  await backfillOperationLogSystems();
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    startReminderCron();
  });
};

start().catch((err) => {
  console.error('Server start failed', err);
  process.exit(1);
});

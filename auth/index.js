const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const db = require('../server/db');
const nodemailer = require('nodemailer');
const RPCClient = require('@alicloud/pop-core');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const net = require('net');
const {
  createCsrfToken,
  isCsrfTokenValid,
} = require('./csrf-security');
const {
  hashPassword,
  verifyPassword,
} = require('./password-security');
const {
  isWeakSecret,
  shouldRotateBuiltinPasswordHash,
} = require('./security-bootstrap');
const {
  buildSessionTokenPayload,
  createSessionId,
  isSessionRecordValid,
} = require('./session-security');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('../server/cors-origin');
const {
  buildHelmetCspDirectives,
} = require('../server/helmet-csp');
const {
  resolveSecurityStrictMode,
} = require('../server/security-strict-mode');
const {
  ALLOWED_USER_ROLES,
  createAdminCenterUsersService,
  normalizeAppAccess,
  normalizeDepartmentCode,
  normalizeUserRole,
  validateEmailFormat,
  validatePhoneFormat,
  validateUsernameFormat,
} = require('./admin-center-users');
const {
  createAdminCenterDepartmentsService,
} = require('./admin-center-departments');
const {
  createAdminCenterSecurityService,
} = require('./admin-center-security');
const {
  parseAdminCenterUserImportFile,
} = require('./admin-center-user-import');
const {
  buildImportedUserPasswordEmail,
  buildImportedUsersAdminSummaryEmail,
} = require('./admin-center-user-import-email');
const {
  createAuditCenterLogsService,
  serializeLogsAsCsv,
} = require('./audit-center-logs');
const {
  AUDIT_ACTION_OPTIONS,
  AUDIT_ENTITY_OPTIONS,
  AUDIT_PRESET_OPTIONS,
} = require('./audit-log-display');
const {
  SYSTEM_DISPLAY_OPTIONS,
  getSystemDisplayLabel,
  getSystemDisplayShortLabel,
  summarizeSystemAccess,
} = require('./system-access-display');
const {
  buildDownloadHeaderMeta,
  buildAdminCenterUsersExportWorkbook,
  buildUserImportFilename,
  buildUserImportTemplateWorkbook,
  buildUserImportWorkbook,
  importUsersFromRows,
} = require('../server/user-import');
const {
  ADMIN_CENTER_KEY,
  AUDIT_CENTER_KEY,
  DELIVERY_KEY,
  canAccessDedicatedCenter,
  parseAppAccessRaw,
  resolveUserAppAccess,
  SYSTEM_ACCESS_KEYS,
  defaultAppAccessByRole,
  getDedicatedCenterConfig,
} = require('./portal-routing');

const app = express();
const PORT = process.env.PORT || 5180;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE === 'true';
const AUTH_COOKIE_SAMESITE = String(process.env.AUTH_COOKIE_SAMESITE || 'lax').trim().toLowerCase() || 'lax';
const AUTH_CSRF_COOKIE_NAME = String(process.env.AUTH_CSRF_COOKIE_NAME || 'auth_csrf_token').trim() || 'auth_csrf_token';
const AUTH_CSRF_COOKIE_SECURE = process.env.CSRF_SECURE === 'true';
const CONFIG_SECRET_KEY = process.env.CONFIG_SECRET_KEY || '';
const SECRET_MASK = '******';
const BUILTIN_ACCOUNT_DEFAULT_PASSWORD = process.env.BUILTIN_ACCOUNT_DEFAULT_PASSWORD || '123456';
const BUILTIN_ACCOUNTS = [
  { username: 'admin', role: 'admin' },
  { username: 'sysadmin', role: 'sysadmin' },
  { username: 'auditor', role: 'auditor' },
  { username: 'editor', role: 'editor' },
  { username: 'reviewer', role: 'reviewer' },
];
const BUILTIN_ACCOUNT_USERNAMES = new Set(BUILTIN_ACCOUNTS.map((item) => item.username));
const AUDIT_SIGNING_KEY = process.env.AUDIT_SIGNING_KEY || JWT_SECRET;
const SECURITY_STRICT_MODE = resolveSecurityStrictMode(process.env);
const AUTH_LOGIN_URL = (() => {
  const adminCenterUrl = String(process.env.APP_ADMIN_CENTER_URL || '').trim();
  if (adminCenterUrl) {
    try {
      return new URL('/login', adminCenterUrl).toString();
    } catch (err) {
      // ignore invalid configured url
    }
  }
  const publicHost = String(process.env.PUBLIC_HOST || 'localhost').trim() || 'localhost';
  if (/^https?:\/\//i.test(publicHost)) {
    try {
      return new URL('/login', publicHost).toString();
    } catch (err) {
      // ignore invalid configured host
    }
  }
  return `http://${publicHost}:5180/login`;
})();

const parseOriginList = (raw) =>
  String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const isLocalHostname = (value) => {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.localhost')) return true;
  return false;
};

const isLocalOrigin = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    return isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
};

const isLocalOnlyDeployment = () => {
  const origins = parseOriginList(process.env.CORS_ORIGINS);
  if (!origins.length) return false;
  return origins.every((origin) => isLocalOrigin(origin));
};

const validateSecurityBootstrap = () => {
  const problems = [];
  if (isWeakSecret(JWT_SECRET, 32)) problems.push('JWT_SECRET 过弱（生产建议至少32位随机值）');
  if (isWeakSecret(AUDIT_SIGNING_KEY, 32)) problems.push('AUDIT_SIGNING_KEY 过弱（生产建议至少32位随机值）');
  if (isWeakSecret(CONFIG_SECRET_KEY, 32)) problems.push('CONFIG_SECRET_KEY 过弱（生产建议至少32位随机值）');
  if (String(BUILTIN_ACCOUNT_DEFAULT_PASSWORD || '').trim() === '123456') {
    problems.push('BUILTIN_ACCOUNT_DEFAULT_PASSWORD 仍为默认值');
  }
  if (!AUTH_COOKIE_SECURE && !isLocalOnlyDeployment()) {
    problems.push('AUTH_COOKIE_SECURE 在非本地部署中必须启用');
  }
  if (!problems.length) return;
  const text = `[SECURITY][auth] ${problems.join('；')}`;
  if (SECURITY_STRICT_MODE) {
    throw new Error(text);
  }
  console.warn(`${text}。当前为非严格模式，仅告警。`);
};

const DEFAULT_PASSWORD_POLICY = Object.freeze({
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
});
const DEFAULT_SESSION_TIMEOUT_MINUTES = 12 * 60;
const MAX_SESSION_TIMEOUT_MINUTES = 7 * 24 * 60;
const PRIVILEGED_IP_LIMIT_ROLES = new Set(['admin', 'sysadmin', 'auditor']);
const MAX_IMPORT_RECORDS = Number(process.env.MAX_IMPORT_RECORDS || 5000);
const IMPORT_UPLOAD_MAX_BYTES = Number(process.env.IMPORT_UPLOAD_MAX_BYTES || 3 * 1024 * 1024);

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

const getUserAppAccess = (user) => resolveUserAppAccess(user);

const canAccessSystem = (user, systemKey) => getUserAppAccess(user).includes(systemKey);
const isPasswordChangeRequired = (user) => Number(user?.must_change_password) === 1;
const buildAuthUserPayload = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  must_change_password: isPasswordChangeRequired(user) ? 1 : 0,
});
const sendPasswordChangeRequired = (res, user) => res.status(403).json({
  error: '首次登录请先修改密码',
  mustChangePassword: true,
  user: buildAuthUserPayload(user),
});

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
  const safeDecrypt = (value, fieldName) => {
    try {
      return decryptValue(value);
    } catch (err) {
      console.warn(`[SECURITY][auth] 配置项 ${fieldName} 解密失败，已降级为空值，请重新保存该密钥。`);
      return '';
    }
  };
  if (configs.email?.pass) configs.email.pass = safeDecrypt(configs.email.pass, 'email.pass');
  if (configs.sms?.accessKeySecret) configs.sms.accessKeySecret = safeDecrypt(configs.sms.accessKeySecret, 'sms.accessKeySecret');
  if (configs.wecom?.secret) configs.wecom.secret = safeDecrypt(configs.wecom.secret, 'wecom.secret');
  if (configs.ocr?.accessKeySecret) configs.ocr.accessKeySecret = safeDecrypt(configs.ocr.accessKeySecret, 'ocr.accessKeySecret');
  return configs;
};

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5180',
  'http://127.0.0.1:5180',
  'http://localhost:18080',
  'http://127.0.0.1:18080',
  'http://localhost:18081',
  'http://127.0.0.1:18081',
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

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: buildHelmetCspDirectives({ withNonce: true }),
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
const adminCenterImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_UPLOAD_MAX_BYTES },
});

const readCookieValue = (req, cookieName) => {
  const byParser = String(req.cookies?.[cookieName] || '').trim();
  if (byParser) return byParser;
  const cookieHeader = String(req.headers.cookie || '').trim();
  if (!cookieHeader) return '';
  const pairs = cookieHeader.split(';');
  for (const item of pairs) {
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const key = item.slice(0, idx).trim();
    if (key !== cookieName) continue;
    return decodeURIComponent(item.slice(idx + 1).trim());
  }
  return '';
};

const buildCsrfCookieOptions = () => ({
  httpOnly: true,
  secure: AUTH_CSRF_COOKIE_SECURE,
  sameSite: 'strict',
  path: '/',
});

const issueCsrfToken = (res) => {
  const token = createCsrfToken();
  res.cookie(AUTH_CSRF_COOKIE_NAME, token, buildCsrfCookieOptions());
  return token;
};

const validateCsrfToken = (req, res, next) => {
  if (req.path === '/auth/authorize') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = readCookieValue(req, AUTH_CSRF_COOKIE_NAME);
  const headerToken = String(req.headers['x-csrf-token'] || '').trim();
  if (isCsrfTokenValid({ cookieToken, headerToken })) return next();
  return res.status(403).json({ error: '安全校验失败，请刷新后重试' });
};

app.use('/api', validateCsrfToken);

app.get('/api/auth/csrf', (_req, res) => {
  res.json({ token: issueCsrfToken(res) });
});

const toMysqlDatetime = (date) =>
  date instanceof Date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;

const ensureBuiltinUsers = async () => {
  const hash = await hashPassword(BUILTIN_ACCOUNT_DEFAULT_PASSWORD);
  for (const account of BUILTIN_ACCOUNTS) {
    const expectedAccess = defaultAppAccessByRole(account.role);
    const row = await db.get('SELECT id, role, app_access, is_active, password_hash FROM users WHERE username = ?', [account.username]);
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
    const parsedAccess = parseAppAccessRaw(row.app_access);
    const currentAccess = Array.isArray(parsedAccess)
      ? Array.from(new Set(parsedAccess.map((item) => String(item || '').trim()).filter((item) => SYSTEM_ACCESS_KEYS.includes(item))))
      : [];
    const expectedSorted = [...expectedAccess].sort().join(',');
    const currentSorted = [...currentAccess].sort().join(',');
    if (!row.app_access || currentSorted !== expectedSorted) {
      await db.run('UPDATE users SET app_access = ? WHERE id = ?', [JSON.stringify(expectedAccess), row.id]);
    }
    if (Number(row.is_active) !== 1) {
      await db.run('UPDATE users SET is_active = 1 WHERE id = ?', [row.id]);
    }
    const shouldRotate = await shouldRotateBuiltinPasswordHash({
      passwordHash: row.password_hash,
      comparePassword: async (plain, passwordHash) => (await verifyPassword(plain, passwordHash)).ok,
      configuredPassword: BUILTIN_ACCOUNT_DEFAULT_PASSWORD,
    });
    if (shouldRotate) {
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.id]);
      console.warn(`[SECURITY][auth] 已为内建账号 ${account.username} 回填新的默认强口令哈希`);
    }
  }
};

const resolveSessionTimeoutMinutes = (securityConfig = null) => {
  const security = securityConfig || {};
  return clampNumber(
    security?.session?.timeoutMinutes,
    DEFAULT_SESSION_TIMEOUT_MINUTES,
    5,
    MAX_SESSION_TIMEOUT_MINUTES
  );
};

const createToken = async ({ user, sessionId, securityConfig = null }) => {
  const timeoutMinutes = resolveSessionTimeoutMinutes(securityConfig);
  return jwt.sign(buildSessionTokenPayload({ user, sessionId }), JWT_SECRET, {
    expiresIn: timeoutMinutes * 60,
  });
};

const createUserSession = async ({ user, securityConfig = null, requestIp = '', userAgent = '' }) => {
  const timeoutMinutes = resolveSessionTimeoutMinutes(securityConfig);
  const sessionId = createSessionId();
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
  await db.run(
    `INSERT INTO auth_user_sessions
      (session_id, user_id, username, role, issued_ip, user_agent, last_seen_at, last_seen_ip, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
    [
      sessionId,
      Number(user?.id || 0),
      String(user?.username || ''),
      String(user?.role || ''),
      String(requestIp || '').slice(0, 64) || null,
      String(userAgent || '').slice(0, 255) || null,
      String(requestIp || '').slice(0, 64) || null,
      toMysqlDatetime(expiresAt),
    ]
  );
  const token = await createToken({ user, sessionId, securityConfig });
  return { sessionId, token, expiresAt };
};

const revokeAuthSession = async ({ sessionId, reason = 'logout' } = {}) => {
  const value = String(sessionId || '').trim();
  if (!value) return;
  await db.run(
    `UPDATE auth_user_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revoked_reason = COALESCE(revoked_reason, ?)
     WHERE session_id = ?`,
    [String(reason || 'logout').slice(0, 64), value]
  );
};

const revokeUserSessions = async ({ userId, reason = 'password_change' } = {}) => {
  const id = Number(userId || 0);
  if (!id) return;
  await db.run(
    `UPDATE auth_user_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revoked_reason = COALESCE(revoked_reason, ?)
     WHERE user_id = ? AND revoked_at IS NULL`,
    [String(reason || 'password_change').slice(0, 64), id]
  );
};

const parseCookieToken = (req) => readCookieValue(req, AUTH_COOKIE_NAME);

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

const clearCsrfCookie = (res) => {
  res.clearCookie(AUTH_CSRF_COOKIE_NAME, buildCsrfCookieOptions());
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
    const sessionId = String(payload?.sid || '').trim();
    if (!sessionId) {
      clearAuthCookie(res);
      return res.status(401).json({ error: '登录已过期' });
    }
    const user = await db.get('SELECT id, role, is_active FROM users WHERE id = ?', [payload.id]);
    if (!user || Number(user.is_active) !== 1) {
      clearAuthCookie(res);
      return res.status(401).json({ error: '账号已失效，请联系系统管理员' });
    }
    const sessionRecord = await db.get(
      `SELECT session_id, user_id, revoked_at, expires_at
       FROM auth_user_sessions
       WHERE session_id = ?
       LIMIT 1`,
      [sessionId]
    );
    if (!isSessionRecordValid({ tokenSessionId: sessionId, sessionRecord })) {
      clearAuthCookie(res);
      return res.status(401).json({ error: '登录已过期' });
    }
    const security = await getSecurityConfig();
    const requestIp = getRequestIp(req);
    const ipCheck = checkRoleIpAccess({
      role: user.role || payload.role,
      ip: requestIp,
      securityConfig: security,
    });
    if (!ipCheck.allowed) {
      clearAuthCookie(res);
      return res.status(403).json({ error: '当前IP不在允许访问范围内，请联系系统管理员', ipRestricted: true });
    }
    await db.run(
      'UPDATE auth_user_sessions SET last_seen_at = NOW(), last_seen_ip = ? WHERE session_id = ?',
      [String(requestIp || '').slice(0, 64) || null, sessionId]
    );
    req.user = { ...payload, role: user.role || payload.role, request_ip: requestIp };
    req.authSession = sessionRecord;
    return next();
  } catch (err) {
    clearAuthCookie(res);
    return res.status(401).json({ error: '登录已过期' });
  }
};

app.use('/api', authMiddleware);

const buildUserScope = async (user) => {
  if (!user) {
    return {
      isAdmin: false,
      customerIds: [],
      contactIds: [],
      phone: null,
      department: null,
      managedDepartments: [],
      isDepartmentDocAdmin: false,
    };
  }
  const dbUser = await db.get('SELECT id, phone, department_code FROM users WHERE id = ?', [user.id]);
  const phone = dbUser?.phone || null;
  const departmentCode = normalizeDepartmentCode(dbUser?.department_code);
  const department = departmentCode
    ? await db.get(
      'SELECT code, name, is_active FROM departments WHERE code = ? LIMIT 1',
      [departmentCode]
    )
    : null;
  const managedDepartments = await db.query(
    `SELECT d.code, d.name, d.is_active
     FROM department_doc_admins dda
     JOIN departments d ON d.code = dda.department_code
     WHERE dda.user_id = ? AND dda.can_manage_docs = 1
     ORDER BY d.sort_order ASC, d.code ASC`,
    [user.id]
  );

  let customerIds = [];
  let contactIds = [];
  if (phone) {
    const contacts = await db.query(
      `SELECT c.id, cc.customer_id
       FROM contacts c
       JOIN contact_customers cc ON cc.contact_id = c.id
       WHERE c.phone = ?`,
      [phone]
    );
    customerIds = Array.from(
      new Set(contacts.map((c) => Number(c.customer_id)).filter((id) => Number.isFinite(id)))
    );
    contactIds = contacts.map((c) => Number(c.id)).filter((id) => Number.isFinite(id));
  }

  return {
    isAdmin: user.role === 'admin',
    customerIds,
    contactIds,
    phone,
    department: departmentCode
      ? {
        code: departmentCode,
        name: String(department?.name || departmentCode),
        is_active: Number(department?.is_active || 0) === 1 ? 1 : 0,
      }
      : null,
    managedDepartments: Array.isArray(managedDepartments)
      ? managedDepartments.map((item) => ({
        code: normalizeDepartmentCode(item.code),
        name: String(item.name || item.code || ''),
        is_active: Number(item.is_active || 0) === 1 ? 1 : 0,
      }))
      : [],
    isDepartmentDocAdmin: Array.isArray(managedDepartments) && managedDepartments.length > 0,
  };
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

const authorizeDelivery = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, DELIVERY_KEY)) return deny('无权限访问交付系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'delivery:read') {
    if (role === 'sysadmin') return deny('系统管理员不参与交付业务');
    return allow();
  }
  if (action === 'delivery:audit' || action === 'delivery:verify' || action === 'delivery:export') {
    if (role === 'auditor') return allow();
    return deny('仅审计员可访问交付审计能力');
  }
  if (
    action === 'delivery:write' ||
    action === 'delivery:workflow' ||
    action === 'delivery:phase' ||
    action === 'delivery:comment' ||
    action === 'delivery:schedule'
  ) {
    if (role === 'admin' || role === 'editor' || role === 'reviewer' || role === 'user' || role === 'sales') {
      return allow();
    }
    return deny('当前角色不可执行交付写操作');
  }
  return deny('不支持的授权动作');
};

const authorizeFaq = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'faq')) return deny('无权限访问文档管理系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'faq:read') return allow();
  if (action === 'faq:write') {
    if (role === 'admin' || role === 'editor') return allow();
    return deny('仅管理员或编辑可执行文档写操作');
  }
  if (action === 'faq:review') {
    if (role === 'admin' || role === 'reviewer') return allow();
    return deny('仅管理员或审核员可执行文档审核操作');
  }
  if (action === 'faq:audit') {
    if (role === 'auditor') return allow();
    return deny('仅审计管理员可查看文档审计信息');
  }
  return deny('不支持的授权动作');
};

const authorizeTender = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'tender')) return deny('无权限访问标书协同制作系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'tender:read') {
    if (role === 'admin' || role === 'editor' || role === 'sysadmin' || role === 'auditor') return allow();
    return deny('无权限访问标书协同制作系统');
  }
  if (action === 'tender:write' || action === 'tender:template:manage' || action === 'tender:ai:use') {
    if (role === 'admin' || role === 'editor') return allow();
    return deny('仅管理员或编辑可执行该操作');
  }
  if (action === 'tender:config:manage' || action === 'tender:ai:manage') {
    if (role === 'admin' || role === 'sysadmin') return allow();
    return deny('仅管理员或系统管理员可执行该操作');
  }
  if (action === 'tender:audit:read') {
    if (role === 'auditor') return allow();
    return deny('仅审计管理员可查看审计日志');
  }
  return deny('不支持的授权动作');
};

const authorizeTrainExam = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'train-exam')) return deny('无权限访问培训考试系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'train_exam:read') return allow();
  if (action === 'train_exam:content:write') {
    if (role === 'admin' || role === 'editor') return allow();
    return deny('仅管理员或编辑可维护培训内容');
  }
  if (action === 'train_exam:question:review' || action === 'train_exam:paper:publish') {
    if (role === 'admin' || role === 'reviewer') return allow();
    return deny('仅管理员或审核员可执行该操作');
  }
  if (action === 'train_exam:audit:read') {
    if (role === 'auditor') return allow();
    return deny('仅审计管理员可查看审计信息');
  }
  return deny('不支持的授权动作');
};

app.get('/api/auth/introspect', async (req, res) => {
  const user = await db.get(
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id, must_change_password FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const security = await getSecurityConfig();
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  if (mfaStatus.setupRequired) {
    return res.status(403).json({ error: '请先完成二次验证设置', mfaSetupRequired: true });
  }
  if (isPasswordChangeRequired(user)) {
    return sendPasswordChangeRequired(res, user);
  }
  const scope = await buildUserScope(user);
  const apps = getUserAppAccess(user);
  res.json({ user: buildAuthUserPayload(user), scope, apps });
});

app.post('/api/auth/authorize', async (req, res) => {
  const { system, action, resource } = req.body || {};
  const user = await db.get(
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id, must_change_password FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const security = await getSecurityConfig();
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  if (mfaStatus.setupRequired) {
    return res.status(403).json({
      allow: false,
      reason: '请先完成二次验证设置',
      mfaSetupRequired: true,
      user: buildAuthUserPayload(user),
    });
  }
  if (isPasswordChangeRequired(user)) {
    return res.status(403).json({
      allow: false,
      reason: '首次登录请先修改密码',
      mustChangePassword: true,
      user: buildAuthUserPayload(user),
    });
  }
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
  } else if (system === 'delivery') {
    result = authorizeDelivery(user, action, resource);
  } else if (system === 'sec-impl') {
    result = authorizeSecImpl(user, action);
  } else if (system === 'faq') {
    result = authorizeFaq(user, action);
  } else if (system === 'tender') {
    result = authorizeTender(user, action);
  } else if (system === 'train-exam') {
    result = authorizeTrainExam(user, action);
  }
  return res.json({ ...result, user: buildAuthUserPayload(user), scope, apps });
});

app.get('/api/auth/apps', async (req, res) => {
  const user = await db.get(
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id, must_change_password FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const security = await getSecurityConfig();
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  if (mfaStatus.setupRequired) {
    return res.json({
      user: buildAuthUserPayload(user),
      mfaSetupRequired: true,
      availableMethods: mfaStatus.availableMethods,
      apps: [],
    });
  }
  if (isPasswordChangeRequired(user)) {
    return sendPasswordChangeRequired(res, user);
  }
  const reminderUrl = process.env.APP_REMINDER_URL || 'http://localhost:18080';
  const deliveryURL = process.env.APP_DELIVERY_URL || 'http://localhost:18084';
  const cmdbURL = process.env.APP_CMDB_URL || 'http://localhost:8090';
  const inventoryURL = process.env.APP_INVENTORY_URL || 'http://localhost:18082';
  const deviceFlowURL = process.env.APP_DEVICE_FLOW_URL || 'http://localhost:18083';
  const faqURL = process.env.APP_FAQ_URL || 'http://localhost:18085';
  const tenderURL = process.env.APP_TENDER_URL || 'http://localhost:18086';
  const trainExamURL = process.env.APP_TRAIN_EXAM_URL || 'http://localhost:18087';
  const adminCenterURL = process.env.APP_ADMIN_CENTER_URL || 'http://localhost:5180/admin-center';
  const auditCenterURL = process.env.APP_AUDIT_CENTER_URL || 'http://localhost:5180/audit-center';
  const appAccess = getUserAppAccess(user);
  const apps = [];
  if (appAccess.includes(ADMIN_CENTER_KEY)) {
    apps.push({
      key: ADMIN_CENTER_KEY,
      name: '管理后台',
      url: adminCenterURL,
      allow: canAccessDedicatedCenter({ role: user.role, systemKey: ADMIN_CENTER_KEY }),
    });
  }
  if (appAccess.includes(AUDIT_CENTER_KEY)) {
    apps.push({
      key: AUDIT_CENTER_KEY,
      name: '审计中心',
      url: auditCenterURL,
      allow: canAccessDedicatedCenter({ role: user.role, systemKey: AUDIT_CENTER_KEY }),
    });
  }
  if (appAccess.includes('reminder')) {
    apps.push({ key: 'reminder', name: '授权到期提醒系统', url: reminderUrl, allow: true });
  }
  if (appAccess.includes(DELIVERY_KEY)) {
    const deliveryAuth = await authorizeDelivery(user, 'app:enter', {});
    apps.push({ key: 'delivery', name: '交付系统', url: deliveryURL, allow: !!deliveryAuth.allow });
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
  if (appAccess.includes('faq')) {
    const faqAuth = await authorizeFaq(user, 'app:enter');
    apps.push({ key: 'faq', name: '文档管理系统', url: faqURL, allow: !!faqAuth.allow });
  }
  if (appAccess.includes('tender')) {
    const tenderAuth = await authorizeTender(user, 'app:enter');
    apps.push({ key: 'tender', name: '标书协同制作系统', url: tenderURL, allow: !!tenderAuth.allow });
  }
  if (appAccess.includes('train-exam')) {
    const trainExamAuth = await authorizeTrainExam(user, 'app:enter');
    apps.push({ key: 'train-exam', name: '培训考试系统', url: trainExamURL, allow: !!trainExamAuth.allow });
  }
  return res.json({
    user: buildAuthUserPayload(user),
    apps: apps.filter((item) => item.allow),
  });
});

const RELEASE_VERSION = '5.7.4';
const DEDICATED_CENTER_VERSION = `v${RELEASE_VERSION}`;
const ADMIN_CENTER_ROLE_OPTIONS = Object.freeze([
  { value: 'user', label: '普通用户' },
  { value: 'editor', label: '业务管理员' },
  { value: 'reviewer', label: '审核用户' },
  { value: 'sysadmin', label: '系统管理员' },
  { value: 'auditor', label: '审计管理员' },
  { value: 'sales', label: '销售' },
]);
const ADMIN_CENTER_SYSTEM_OPTIONS = Object.freeze(
  SYSTEM_DISPLAY_OPTIONS.filter((item) => item.key !== ADMIN_CENTER_KEY && item.key !== AUDIT_CENTER_KEY)
);

const renderSystemAccessCheckboxes = (inputName, dataKey, options = ADMIN_CENTER_SYSTEM_OPTIONS) => options
  .map((item) => `<label class="access-pill"><input type="checkbox" name="${inputName}" data-${dataKey}="${item.key}" value="${item.key}" /><span>${item.label}</span></label>`)
  .join('');

const renderRoleOptions = (options = ADMIN_CENTER_ROLE_OPTIONS) => options
  .map((item) => `<option value="${item.value}">${item.label}</option>`)
  .join('');

const renderSelectOptions = (options = [], emptyLabel = '全部') => [
  `<option value="">${emptyLabel}</option>`,
  ...options.map((item) => `<option value="${item.value}">${item.label}</option>`),
].join('');

const fallbackAuditPresetButtonId = (key) => `auditPreset${String(key || '').slice(0, 1).toUpperCase()}${String(key || '').slice(1)}Btn`;

const renderAuditPresetButtons = () => AUDIT_PRESET_OPTIONS
  .map((item) => `<button id="${item.buttonId || fallbackAuditPresetButtonId(item.key)}" type="button" class="audit-filter-chip" data-audit-preset="${item.key}" title="${item.summary || item.label}">${item.label}</button>`)
  .join('');

const renderAdminCenterSections = () => ({
  shellTitle: '管理中心',
  heroName: '用户安全管理中心',
  heroTitle: '统一管理账号、访问权限与安全策略',
  heroSubtitle: '覆盖当前账号安全、系统用户维护、密码策略与高权限访问控制。',
  roleGuideText: '仅可维护账号、安全策略和用户，不展示业务系统数据菜单。',
  defaultTab: 'account',
  navItems: [
    { key: 'account', label: '账号安全' },
    { key: 'security', label: '安全配置' },
    { key: 'users', label: '用户管理' },
    { key: 'departments', label: '部门管理' },
  ],
  stats: [
    { id: 'primaryStatValue', label: '用户数量', value: '0' },
    { id: 'secondaryStatValue', label: '锁定账号', value: '0' },
  ],
  sections: `
    <section class="panel center-panel" data-tab-panel="account">
      <div class="panel-header">
        <div>
          <h2>账号安全</h2>
          <p>配置当前账号的谷歌认证、密码与二次验证方式。</p>
        </div>
        <div class="panel-actions muted">
          <span>当前账号变更会即时生效</span>
        </div>
      </div>
      <div class="panel-block account-tone-totp">
        <div class="block-head">
          <div>
            <h3>谷歌认证（当前账号）</h3>
            <div id="totpStatus" class="muted">正在读取谷歌认证状态...</div>
          </div>
          <div class="inline-actions">
            <button id="totpSetupBtn" class="ghost-btn" type="button">生成密钥</button>
            <button id="totpEnableBtn" class="primary-btn" type="button" disabled>启用谷歌认证</button>
          </div>
        </div>
        <div id="totpSecretWrap" class="import-errors" style="display:none">
          <div class="import-errors-title">密钥（手动录入谷歌认证器）</div>
          <div id="totpSecret" class="totp-secret"></div>
          <label class="form-label full-row">
            输入 6 位验证码
            <input id="totpCodeInput" class="form-control" placeholder="例如：123456" />
          </label>
          <div class="muted">请先在谷歌认证器中添加此密钥，再输入当前验证码完成启用。</div>
        </div>
      </div>
      <form id="accountPasswordForm" class="form-grid account-tone-password inline-actions">
        <label class="form-label">
          当前密码
          <input id="currentPassword" type="password" class="form-control" required />
        </label>
        <label class="form-label">
          新密码
          <input id="newPassword" type="password" class="form-control" required />
        </label>
        <div class="form-actions">
          <button class="primary-btn" type="submit">修改密码</button>
        </div>
      </form>
      <form id="accountMfaForm" class="form-grid account-tone-mfa">
        <label class="inline-check form-label full-row">
          开启二次验证
          <input id="accountMfaEnabled" type="checkbox" />
        </label>
        <div class="form-label full-row">
          验证方式（可多选）
          <div class="channel-row mfa-pill-row" id="accountMfaMethodList">
            <label class="mfa-pill" data-mfa-pill="email"><input type="checkbox" data-mfa-method="email" />邮箱</label>
            <label class="mfa-pill" data-mfa-pill="sms"><input type="checkbox" data-mfa-method="sms" />短信</label>
            <label class="mfa-pill" data-mfa-pill="wecom"><input type="checkbox" data-mfa-method="wecom" />企业微信</label>
            <label class="mfa-pill" data-mfa-pill="totp"><input type="checkbox" data-mfa-method="totp" />谷歌认证</label>
          </div>
          <div class="muted">未配置的方式会自动禁用；可先启用谷歌认证再纳入二次验证。</div>
        </div>
        <div class="form-actions">
          <button class="primary-btn" type="submit">保存二次验证</button>
        </div>
      </form>
      <div id="accountNotice" class="hint-line"></div>
    </section>

    <section class="panel center-panel" data-tab-panel="security" hidden>
      <div class="config-page-title">
        <h2>安全配置</h2>
        <p>统一维护登录限制、密码复杂度、会话超时、验证码与角色访问策略。</p>
      </div>
      <form id="adminSecurityForm" class="config-stack">
        <div class="config-card tone-sec-login">
          <div class="config-card-header">登录失败限制</div>
          <div class="config-card-body">
            <label class="form-label">
              登录最大失败次数
              <input id="loginMaxAttempts" type="number" min="1" class="form-control" />
            </label>
            <label class="form-label">
              统计窗口（分钟）
              <input id="loginWindowMinutes" type="number" min="1" class="form-control" />
            </label>
            <label class="form-label">
              锁定时长（分钟）
              <input id="loginLockMinutes" type="number" min="1" class="form-control" />
            </label>
          </div>
        </div>

        <div class="config-card tone-sec-login">
          <div class="config-card-header">密码复杂度策略</div>
          <div class="config-card-body">
            <label class="form-label">
              最小密码长度
              <input id="passwordMinLength" type="number" min="6" max="64" class="form-control" />
            </label>
            <label class="inline-check form-label">
              必须包含大写字母
              <input id="requireUppercase" type="checkbox" />
            </label>
            <label class="inline-check form-label">
              必须包含小写字母
              <input id="requireLowercase" type="checkbox" />
            </label>
            <label class="inline-check form-label">
              必须包含数字
              <input id="requireNumber" type="checkbox" />
            </label>
            <label class="inline-check form-label">
              必须包含特殊字符
              <input id="requireSpecial" type="checkbox" />
            </label>
          </div>
        </div>

        <div class="config-card tone-sec-login">
          <div class="config-card-header">会话超时退出</div>
          <div class="config-card-body">
            <label class="form-label">
              登录会话超时（分钟）
              <input id="sessionTimeoutMinutes" type="number" min="5" max="10080" class="form-control" />
            </label>
            <p class="muted full-row">超时后将强制退出并要求重新登录（默认 10080 分钟，即 7 天）。</p>
          </div>
        </div>

        <div class="config-card tone-sec-login">
          <div class="config-card-header">管理员 IP 访问限制</div>
          <div class="config-card-body">
            <label class="form-label full-row">
              admin 允许 IP（每行一个，支持逗号/分号分隔）
              <textarea id="roleIpAdmin" class="form-control" rows="3"></textarea>
            </label>
            <label class="form-label full-row">
              sysadmin 允许 IP
              <textarea id="roleIpSysadmin" class="form-control" rows="3"></textarea>
            </label>
            <label class="form-label full-row">
              auditor 允许 IP
              <textarea id="roleIpAuditor" class="form-control" rows="3"></textarea>
            </label>
            <p class="muted full-row">留空表示该角色不限制来源 IP。</p>
          </div>
        </div>

        <div class="config-card tone-sec-captcha">
          <div class="config-card-header">登录验证码</div>
          <div class="config-card-body">
            <label class="form-label">
              验证码有效期（秒）
              <input id="captchaTtlSeconds" type="number" min="60" class="form-control" />
            </label>
            <label class="inline-check form-label">
              启用登录验证码
              <input id="captchaEnabled" type="checkbox" />
            </label>
          </div>
        </div>

        <div class="config-card tone-sec-mfa">
          <div class="config-card-header">二次验证策略</div>
          <div class="config-card-body">
            <label class="inline-check form-label full-row">
              强制全员启用二次验证
              <input id="forceAllUsersMfa" type="checkbox" />
            </label>
            <label class="form-label">
              MFA 验证码有效期（秒）
              <input id="mfaCodeTtlSeconds" type="number" min="60" class="form-control" />
            </label>
            <div class="form-label full-row">
              管理员默认验证方式（可多选）
              <div class="channel-row mfa-pill-row">
                <label class="mfa-pill"><input type="checkbox" data-admin-mfa-method="email" />邮箱</label>
                <label class="mfa-pill"><input type="checkbox" data-admin-mfa-method="sms" />短信</label>
                <label class="mfa-pill"><input type="checkbox" data-admin-mfa-method="wecom" />企业微信</label>
                <label class="mfa-pill"><input type="checkbox" data-admin-mfa-method="totp" />谷歌认证</label>
              </div>
            </div>
          </div>
        </div>

        <div class="config-actions">
          <button class="ghost-btn" type="button" id="adminSecurityReloadBtn">重新加载</button>
          <button class="primary-btn" type="submit">保存安全配置</button>
        </div>
      </form>
      <div id="adminSecurityNotice" class="hint-line"></div>
    </section>

    <section class="panel center-panel" data-tab-panel="users" hidden>
      <div class="panel-header">
        <div>
          <h2>用户管理</h2>
          <p>集中维护账号、角色、登录标识和访问权限。</p>
        </div>
        <div class="panel-actions">
          <button id="adminUsersBulkDeleteBtn" type="button" class="ghost-btn">批量删除</button>
          <button id="adminUsersReloadBtn" type="button" class="ghost-btn">刷新列表</button>
        </div>
      </div>
      <form id="adminCreateUserForm" class="form-grid user-create-grid">
        <label class="form-label">
          账号
          <input name="username" class="form-control" placeholder="2-32 位中文/字母/数字" required />
        </label>
        <label class="form-label">
          邮箱
          <input name="email" type="email" class="form-control" placeholder="name@example.com" />
        </label>
        <label class="form-label">
          手机号
          <input name="phone" class="form-control" placeholder="13800000000" />
        </label>
        <label class="form-label">
          企业微信 ID
          <input name="wecom_id" class="form-control" placeholder="wecom-id" />
        </label>
        <label class="form-label">
          初始密码
          <input name="password" type="password" class="form-control" placeholder="Strong#1234" required />
          <span class="muted">密码需至少10位，包含大小写字母、数字、特殊字符。</span>
        </label>
        <label class="form-label">
          角色
          <select name="role" class="form-select">
            ${renderRoleOptions()}
          </select>
        </label>
        <label class="form-label">
          主归属部门
          <select name="department_code" class="form-select" id="adminCreateUserDepartment">
            <option value="">未分配</option>
          </select>
        </label>
        <label class="form-label">
          状态
          <select name="is_active" class="form-select">
            <option value="1">启用</option>
            <option value="0">禁用</option>
          </select>
        </label>
        <div class="form-label full-row">
          可访问系统（可多选）
          <div class="access-pill-grid">
            ${renderSystemAccessCheckboxes('app_access', 'system-access')}
          </div>
          <span id="adminCreateUserAccessHint" class="muted">可按用户职责勾选业务系统权限。</span>
        </div>
        <div class="form-actions">
          <button class="primary-btn" type="submit">新增用户</button>
          <button id="adminCreateUserResetBtn" class="ghost-btn" type="button">清空</button>
        </div>
      </form>
      <div class="import-row user-import-row">
        <label id="adminUserImportLabel" class="import-btn">
          <span id="adminUserImportLabelText">批量导入（Excel）</span>
          <input id="adminUserImportInput" type="file" accept=".xlsx,.xls" />
        </label>
        <button id="adminUserImportTemplateBtn" type="button" class="ghost-btn">下载模板</button>
        <button id="adminUserExportBtn" type="button" class="ghost-btn">导出用户</button>
        <div class="import-copy">
          <span class="muted">列：账号、角色、状态、可访问系统、邮箱、手机号、企业微信UserID（历史英文列头也兼容）</span>
          <span class="muted">可先下载模板，按示例行填写后再导入；填写邮箱后，系统会自动发送初始密码邮件，并给 admin 邮箱发送本次导入密码汇总。</span>
          <span id="adminUserImportSummary" class="muted"></span>
        </div>
      </div>
      <div id="adminCreateUserNotice" class="hint-line"></div>
      <div id="adminUsersNotice" class="hint-line"></div>
      <div id="adminUsersSelectionSummary" class="hint-line"></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="select-cell"><input id="adminUsersToggleAll" type="checkbox" aria-label="全选用户" /></th>
              <th>序号</th>
              <th>账号</th>
              <th>角色</th>
              <th>主归属部门</th>
              <th>状态</th>
              <th>锁定状态</th>
              <th>可访问系统</th>
              <th>二次验证</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="adminUsersBody">
            <tr><td colspan="11" class="empty">正在加载用户列表...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="adminEditModal" class="modal-shell" hidden>
        <div class="modal-backdrop" data-modal-close="adminEditModal"></div>
        <section class="modal-panel">
          <header class="modal-head">
            <div>
              <h3>编辑用户</h3>
            </div>
            <button type="button" class="ghost-btn" data-modal-close="adminEditModal">关闭</button>
          </header>
          <form id="adminEditUserForm" class="form-grid user-edit-grid">
            <input id="adminEditUserId" type="hidden" />
            <label class="form-label">
              账号
              <input id="adminEditUsername" class="form-control" readonly />
            </label>
            <label class="form-label">
              邮箱（用于二次验证）
              <input id="adminEditEmail" type="email" class="form-control" placeholder="例如：xxx@company.com" />
            </label>
            <label class="form-label">
              手机号（用于二次验证）
              <input id="adminEditPhone" class="form-control" placeholder="例如：13800000000" />
            </label>
            <label class="form-label">
              企业微信UserID（用于二次验证）
              <input id="adminEditWecomId" class="form-control" placeholder="例如：zhangsan" />
            </label>
            <label class="form-label">
              密码
              <input id="adminEditPassword" type="password" class="form-control" placeholder="留空则不修改" />
              <span class="muted">密码需至少10位，包含大小写字母、数字、特殊字符。</span>
            </label>
            <label class="form-label">
              角色
              <select id="adminEditRole" class="form-select">
                ${renderRoleOptions()}
              </select>
            </label>
            <label class="form-label">
              主归属部门
              <select id="adminEditDepartmentCode" class="form-select">
                <option value="">未分配</option>
              </select>
            </label>
            <label class="form-label">
              状态
              <select id="adminEditActive" class="form-select">
                <option value="1">启用</option>
                <option value="0">禁用</option>
              </select>
            </label>
            <div class="form-label full-row">
              可访问系统（可多选）
              <div class="access-pill-grid">
                ${renderSystemAccessCheckboxes('adminEditAppAccess', 'edit-system-access')}
              </div>
              <span id="adminEditUserAccessHint" class="muted">可按用户职责勾选业务系统权限。</span>
            </div>
            <div class="form-actions">
              <button type="button" class="ghost-btn" data-modal-close="adminEditModal">取消</button>
              <button class="primary-btn" type="submit">更新用户</button>
            </div>
          </form>
          <div id="adminEditUserNotice" class="hint-line"></div>
        </section>
      </div>
    </section>

    <section class="panel center-panel" data-tab-panel="departments" hidden>
      <div class="panel-header">
        <div>
          <h2>部门管理</h2>
          <p>维护部门主数据、用户主归属部门，以及各部门的部门文档管理员。</p>
        </div>
        <div class="panel-actions">
          <button id="adminDepartmentsReloadBtn" type="button" class="ghost-btn">刷新部门</button>
        </div>
      </div>
      <form id="adminDepartmentForm" class="form-grid user-create-grid">
        <label class="form-label">
          部门编码
          <input id="adminDepartmentCode" class="form-control" placeholder="如 TECH" required />
        </label>
        <label class="form-label">
          部门名称
          <input id="adminDepartmentName" class="form-control" placeholder="如 技术部" required />
        </label>
        <label class="form-label">
          排序
          <input id="adminDepartmentSortOrder" type="number" class="form-control" value="0" />
        </label>
        <label class="form-label">
          状态
          <select id="adminDepartmentActive" class="form-select">
            <option value="1">启用</option>
            <option value="0">禁用</option>
          </select>
        </label>
        <div class="form-label full-row">
          部门文档管理员
          <div id="adminDepartmentAdmins" class="access-pill-grid"></div>
          <span class="muted">部门管理员负责本部门文档分类维护与跨部门查看审批。</span>
        </div>
        <div class="form-actions">
          <button class="primary-btn" type="submit">保存部门</button>
          <button id="adminDepartmentResetBtn" class="ghost-btn" type="button">清空</button>
        </div>
      </form>
      <div id="adminDepartmentsNotice" class="hint-line"></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>部门编码</th>
              <th>部门名称</th>
              <th>排序</th>
              <th>状态</th>
              <th>部门文档管理员</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="adminDepartmentsBody">
            <tr><td colspan="6" class="empty">正在加载部门列表...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
});

const renderAuditCenterSections = () => ({
  shellTitle: '审计中心',
  heroName: '审计日志管理中心',
  heroTitle: '统一查看跨系统审计记录、验签与导出',
  heroSubtitle: '面向审计管理员，提供审计日志检索、链路校验和归档导出能力。',
  roleGuideText: '仅提供审计日志查询、链路校验与导出功能，不开放业务变更入口。',
  defaultTab: 'overview',
  navItems: [
    { key: 'overview', label: '审计总览' },
    { key: 'logs', label: '日志查询' },
    { key: 'verify', label: '校验与导出' },
  ],
  stats: [
    { id: 'primaryStatValue', label: '总命中', value: '0' },
    { id: 'secondaryStatValue', label: '覆盖系统', value: '0' },
  ],
  sections: `
    <section class="panel center-panel" data-tab-panel="overview">
      <div class="panel-header">
        <div>
          <h2>审计总览</h2>
          <p>按取证流程组织统一登录、提醒系统与各业务系统的操作审计记录。</p>
        </div>
      </div>
      <div class="audit-overview-rail">
        <article class="audit-overview-item">
          <span class="audit-overview-step">检索</span>
          <div>
            <strong>先按系统、事件与对象缩小范围</strong>
            <p>日志查询中的筛选项全部使用中文标签，不需要记英文动作和对象 key。</p>
          </div>
        </article>
        <article class="audit-overview-item">
          <span class="audit-overview-step">核对</span>
          <div>
            <strong>重点关注登录、权限与配置变更</strong>
            <p>登录与会话、用户与权限、配置变更三类预设可以直接落到高风险审计面板。</p>
          </div>
        </article>
        <article class="audit-overview-item">
          <span class="audit-overview-step">归档</span>
          <div>
            <strong>筛选结果可以直接校验并导出</strong>
            <p>校验与导出页会沿用当前筛选范围，适合留档、复核和提交审计附件。</p>
          </div>
        </article>
      </div>
      <div class="audit-overview-meta">
        <div class="audit-overview-metric">
          <span>最近刷新</span>
          <strong id="auditOverviewUpdated">尚未加载</strong>
        </div>
        <div class="audit-overview-metric">
          <span>当前默认范围</span>
          <strong>最近 100 条</strong>
        </div>
      </div>
      <div id="auditOverviewNotice" class="hint-line">进入“日志查询”后会自动加载最近一批审计记录。</div>
    </section>

	    <section class="panel center-panel" data-tab-panel="logs" hidden>
	      <div class="audit-command-grid">
	        <article class="audit-command-card audit-command-card-primary">
	          <div class="audit-command-head">
	            <div>
	              <span class="audit-kicker">日志查询</span>
	              <h2>审计取证工作台</h2>
	              <p>把原始动作码折叠为中文业务语义，先收窄范围，再顺着事件流回看用户、系统与对象线索。</p>
	            </div>
	            <div class="panel-actions">
	              <button id="auditLogsReloadBtn" type="button" class="ghost-btn">刷新日志</button>
	            </div>
	          </div>
	          <div class="audit-preset-row">
	            <span class="audit-preset-label">快速视角</span>
	            ${renderAuditPresetButtons()}
	          </div>
	          <form id="auditFilterForm" class="form-grid compact audit-filter-grid">
	            <label class="form-label">用户<input id="auditFilterUsername" class="form-control" placeholder="按账号、责任人或操作人检索" /></label>
	            <label class="form-label">系统
	              <select id="auditFilterSystem" class="form-select">
	                <option value="">全部系统</option>
	                <option value="sso">统一登录</option>
	                <option value="reminder">提醒系统</option>
	                <option value="delivery">交付系统</option>
	                <option value="cmdb">CMDB系统</option>
	                <option value="inventory">库存管理系统</option>
	                <option value="device-flow">设备流转系统</option>
	                <option value="faq">文档管理系统</option>
	                <option value="tender">标书协同制作系统</option>
	                <option value="train-exam">培训考试系统</option>
	              </select>
	            </label>
	            <label class="form-label">事件
	              <select id="auditFilterAction" class="form-select">
	                ${renderSelectOptions(AUDIT_ACTION_OPTIONS, '全部动作')}
	              </select>
	            </label>
	            <label class="form-label">对象
	              <select id="auditFilterEntity" class="form-select">
	                ${renderSelectOptions(AUDIT_ENTITY_OPTIONS, '全部对象')}
	              </select>
	            </label>
	            <label class="form-label audit-limit-field">条数上限<input id="auditFilterLimit" type="number" min="1" max="2000" value="100" class="form-control" /></label>
	            <div class="form-actions audit-filter-actions">
	              <button class="primary-btn" type="submit">查询日志</button>
	            </div>
	          </form>
	          <div class="audit-filter-note">所有动作、对象和系统展示都使用中文标签，日志结果区不再直接暴露内部英文 key。</div>
	        </article>
	        <aside class="audit-command-card audit-command-card-focus">
	          <div class="audit-focus-card">
	            <span class="audit-kicker">当前视角</span>
	            <strong id="auditFocusPreset">全部事件</strong>
	            <p id="auditFocusSummary">跨系统查看最近一批审计动态，适合先做全局排查。</p>
	          </div>
	          <div class="audit-focus-metrics">
	            <div class="audit-focus-metric">
	              <span>系统范围</span>
	              <strong id="auditFocusSystem">全部系统</strong>
	            </div>
	            <div class="audit-focus-metric">
	              <span>事件范围</span>
	              <strong id="auditFocusAction">全部动作</strong>
	            </div>
	            <div class="audit-focus-metric">
	              <span>对象范围</span>
	              <strong id="auditFocusEntity">全部对象</strong>
	            </div>
	            <div class="audit-focus-metric">
	              <span>查询上限</span>
	              <strong id="auditFocusLimit">100 条</strong>
	            </div>
	          </div>
	        </aside>
	      </div>
	      <section class="audit-stream-panel">
	        <div class="audit-results-bar">
	          <div>
	            <span class="audit-kicker">审计结果</span>
	            <strong>按时间倒序的事件流</strong>
	            <p id="auditResultsSummary">优先查看事件、主体、对象与时间线，快速判断是否需要进入导出或验签。</p>
	          </div>
	          <div class="audit-results-meta">
	            <span id="auditResultsCount">总命中 0 条</span>
	            <span id="auditResultsWindowCount">当前窗口 0 条</span>
	            <span id="auditResultsSystems">0 个系统</span>
	          </div>
	        </div>
	        <div id="auditLogsNotice" class="hint-line"></div>
	        <div class="audit-pagination">
	          <div id="auditPaginationSummary" class="audit-pagination-summary">每页 10 条，当前第 1 页</div>
	          <div class="audit-pagination-actions">
	            <button id="auditPrevPageBtn" type="button" class="ghost-btn">上一页</button>
	            <span id="auditPageIndicator" class="audit-page-indicator">第 0 / 0 页</span>
	            <button id="auditNextPageBtn" type="button" class="ghost-btn">下一页</button>
	          </div>
	        </div>
	        <div class="table-wrap audit-table-wrap">
	          <table class="data-table audit-data-table audit-stream-table">
	            <thead>
	              <tr>
	                <th>编号</th>
	                <th>事件</th>
	                <th>主体</th>
	                <th>IP地址</th>
	                <th>对象</th>
	                <th>时间</th>
	              </tr>
	            </thead>
	            <tbody id="auditLogsBody">
	              <tr><td colspan="6" class="empty">正在加载审计日志...</td></tr>
	            </tbody>
	          </table>
	        </div>
	      </section>
	    </section>
	
	    <section class="panel center-panel" data-tab-panel="verify" hidden>
	      <div class="panel-header">
	        <div>
	          <h2>校验与导出</h2>
	          <p>围绕当前筛选范围执行链路校验与归档导出，不需要重新设置上下文。</p>
	        </div>
	      </div>
	      <div class="audit-workbench">
	        <article class="audit-workbench-card tone-sec-captcha">
	          <div>
	            <span class="audit-kicker">链路校验</span>
	            <strong>校验审计链</strong>
	            <p>检查当前筛选范围内签名链是否连续，优先发现断链、篡改和记录缺口。</p>
	          </div>
	          <div class="audit-workbench-note">校验时会沿用“日志查询”中的条数上限设置。</div>
	          <div class="inline-actions">
	            <button id="auditVerifyBtn" type="button" class="primary-btn">校验审计链</button>
	          </div>
	        </article>
	        <article class="audit-workbench-card tone-sec-mfa">
	          <div>
	            <span class="audit-kicker">归档导出</span>
	            <strong>导出当前结果</strong>
	            <p>CSV 会沿用查询条件，并以中文标题导出，便于直接归档、复核和提交附件。</p>
	          </div>
	          <div class="audit-workbench-note">导出的系统、事件和对象列均使用中文展示值。</div>
	          <div class="inline-actions">
	            <button id="auditExportBtn" type="button" class="ghost-btn">导出 CSV</button>
	          </div>
        </article>
      </div>
      <div id="auditVerifyNotice" class="hint-line"></div>
    </section>
  `,
});

const renderDedicatedCenterPage = ({ nonce, config }) => {
  const normalizedKey = String(config?.key || '').trim().toLowerCase();
  const allowedRoles = ['admin', 'sysadmin', 'auditor']
    .filter((role) => canAccessDedicatedCenter({ role, systemKey: normalizedKey }));
  const centerDefinition = normalizedKey === ADMIN_CENTER_KEY
    ? renderAdminCenterSections()
    : renderAuditCenterSections();
  const navHtml = centerDefinition.navItems
    .map((item) => `<button type="button" data-center-tab="${item.key}"${item.key === centerDefinition.defaultTab ? ' class="active"' : ''}>${item.label}</button>`)
    .join('');
  const statsHtml = centerDefinition.stats
    .map((item) => `
      <div class="status-card">
        <span>${item.label}</span>
        <strong id="${item.id}">${item.value}</strong>
      </div>
    `)
    .join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${config.title}</title>
  <style>
    :root{
      --paper:#ffffff;
      --ink:#0f172a;
      --muted:#64748b;
      --line:rgba(148,163,184,.35);
      --accent:#2563eb;
      --accent-2:#0ea5e9;
      --bg:#f5f7fb;
      --shadow:0 14px 30px rgba(15,23,42,.12);
      --glow:0 0 0 1px rgba(59,130,246,.08),0 10px 24px rgba(37,99,235,.16);
    }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:radial-gradient(circle at top right,rgba(37,99,235,.12),transparent 45%),radial-gradient(circle at 20% 20%,rgba(14,165,233,.12),transparent 40%),linear-gradient(135deg,#f8fafc 0%,#eef2ff 38%,#f0fdf4 100%);color:var(--ink)}
    body{min-height:100vh}
    button,input,select,textarea{font:inherit}
    .shell{max-width:1760px;margin:0 auto;padding:24px clamp(14px,2vw,30px) 90px;display:grid;grid-template-columns:236px minmax(0,1fr);gap:clamp(16px,1.8vw,26px)}
    .content{display:flex;flex-direction:column;gap:24px;min-width:0}
    .sidebar{background:linear-gradient(160deg,rgba(255,255,255,.9),rgba(248,250,252,.9));border-radius:20px;border:1px solid rgba(148,163,184,.25);padding:22px 18px;display:flex;flex-direction:column;gap:20px;height:calc(100vh - 56px);position:sticky;top:20px;box-shadow:var(--glow);backdrop-filter:blur(12px);isolation:isolate;overflow:hidden}
    .sidebar::before{content:'';position:absolute;inset:-1px;border-radius:22px;padding:1px;background:linear-gradient(135deg,rgba(37,99,235,.7),rgba(14,165,233,.4),rgba(34,197,94,.5));-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.9;z-index:-1;filter:drop-shadow(0 0 12px rgba(59,130,246,.35))}
    .brand strong{font-size:20px;letter-spacing:.02em}
    .eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:11px;color:#94a3b8;margin:0 0 10px}
    .user-pill{margin-top:10px;font-size:12px;color:var(--ink);background:linear-gradient(135deg,rgba(37,99,235,.18),rgba(34,197,94,.18));padding:6px 12px;border-radius:999px;display:inline-flex}
    .menu{display:grid;gap:10px;flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:4px;align-content:start;grid-auto-rows:max-content}
    .menu button{border:1px solid transparent;background:transparent;color:#475569;padding:10px 12px;min-height:44px;border-radius:12px;text-align:left;font-size:14px;line-height:1.4;cursor:pointer}
    .menu button.active{background:linear-gradient(135deg,rgba(37,99,235,.18),rgba(14,165,233,.18));color:var(--accent);border-color:rgba(37,99,235,.35);font-weight:600}
    .sidebar-actions{display:grid;gap:10px;margin-top:8px}
    .brand-title{margin:6px 0 12px;font-size:30px;line-height:1.1}
    .brand-red{color:#d01c25;font-weight:700}
    .brand-blue{color:#2563eb;font-weight:700}
    .version-inline{margin-left:12px;font-size:12px;color:var(--muted);font-weight:600;padding:4px 8px;border-radius:999px;background:rgba(148,163,184,.12)}
    .hero{display:flex;justify-content:space-between;gap:24px;padding:26px 30px;background:linear-gradient(140deg,#ffffff,#f1f5ff 55%,#ecfeff);border-radius:22px;border:1px solid rgba(148,163,184,.35);box-shadow:var(--glow);position:relative;overflow:hidden}
    .hero::after{content:'';position:absolute;right:-120px;top:-120px;width:260px;height:260px;background:radial-gradient(circle,rgba(14,165,233,.18),transparent 70%);pointer-events:none}
    .hero::before{content:'';position:absolute;inset:0;background:linear-gradient(120deg,rgba(59,130,246,.12),transparent 40%,rgba(34,197,94,.12));opacity:.8;pointer-events:none}
    .hero-title{font-size:20px;margin:6px 0 12px;font-weight:600}
    .sub{color:var(--muted);max-width:560px;margin:0}
    .status{display:grid;gap:12px;min-width:180px}
    .status-card{background:rgba(255,255,255,.92);border-radius:14px;padding:16px 18px;border:1px solid rgba(148,163,184,.35);display:flex;flex-direction:column;gap:8px;box-shadow:var(--shadow);position:relative;overflow:hidden}
    .status-card strong{font-size:22px;color:var(--accent)}
    .role-guide-card{border:1px solid rgba(148,163,184,.3);border-radius:14px;background:linear-gradient(135deg,rgba(255,255,255,.95),rgba(241,245,255,.88));padding:12px 14px;box-shadow:var(--shadow)}
    .role-guide-title{font-size:14px;font-weight:700;color:var(--ink)}
    .role-guide-text{margin-top:6px;color:var(--muted);font-size:13px}
    .content-stack{display:grid;gap:24px}
    .center-panel[hidden]{display:none !important}
    .panel{background:rgba(255,255,255,.92);border-radius:20px;padding:22px;border:1px solid rgba(148,163,184,.35);box-shadow:var(--glow);backdrop-filter:blur(10px);position:relative;overflow:hidden}
    .panel::after{content:'';position:absolute;top:-60%;left:-20%;width:120%;height:120%;background:radial-gradient(circle,rgba(14,165,233,.12),transparent 55%);opacity:.6;pointer-events:none}
    .panel-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px;position:relative;z-index:1}
    .panel-header h2{margin:0 0 6px;font-size:22px}
    .panel-header p{margin:0;color:var(--muted)}
    .panel-actions,.inline-actions,.form-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .muted{color:var(--muted)}
    .primary-btn,.ghost-btn{height:44px;padding:0 16px;border-radius:12px;border:1px solid rgba(148,163,184,.35);font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:#fff;color:#0f172a}
    .primary-btn{background:linear-gradient(135deg,#2563eb,#0ea5e9);color:#fff;border:none;box-shadow:0 10px 18px rgba(37,99,235,.2)}
    .primary-btn:disabled,.ghost-btn:disabled{opacity:.55;cursor:not-allowed}
    .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px;padding:16px;border-radius:16px;background:linear-gradient(135deg,rgba(224,231,255,.55),rgba(226,232,240,.25));border:1px solid rgba(148,163,184,.25);position:relative;z-index:1}
    .form-grid.compact{grid-template-columns:repeat(5,minmax(0,1fr))}
    .form-grid .form-actions{align-self:end}
    .form-label{display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--ink)}
    .full-row{grid-column:1 / -1}
    .inline-check{flex-direction:row;align-items:center;gap:12px}
    .import-row{display:grid;gap:10px;margin:-4px 0 18px;position:relative;z-index:1}
    .user-import-row{grid-template-columns:auto auto auto minmax(0,1fr);align-items:start}
    .import-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:12px;border:1px solid rgba(148,163,184,.35);background:linear-gradient(135deg,#2563eb,#0ea5e9);color:#fff;cursor:pointer;box-shadow:0 10px 18px rgba(37,99,235,.2)}
    .import-btn input[type='file']{position:absolute;inset:0;opacity:0;cursor:pointer}
    .import-btn.disabled{opacity:.55;pointer-events:none}
    .import-copy{display:grid;gap:4px;min-width:0;padding-top:4px}
    .access-pill-grid{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px}
    .access-pill{display:inline-flex;align-items:center;gap:10px;padding:12px 16px;border-radius:999px;border:1px solid rgba(96,165,250,.45);background:rgba(255,255,255,.92);box-shadow:0 8px 18px rgba(59,130,246,.08);min-height:48px}
    .access-pill input{width:18px;height:18px;margin:0}
    .access-pill.active{border-color:rgba(37,99,235,.65);box-shadow:0 10px 22px rgba(37,99,235,.14)}
    .access-pill.disabled{opacity:.55}
    .form-control,.form-select,input,select,textarea{padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.45);background:rgba(255,255,255,.96);outline:none;transition:border .2s ease,box-shadow .2s ease}
    input:focus,select:focus,textarea:focus,button:focus-visible{border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,99,235,.12);outline:none}
    .panel-block{background:linear-gradient(140deg,rgba(248,250,252,.9),rgba(239,246,255,.9));border:1px solid rgba(226,232,240,.9);border-radius:16px;padding:16px;margin-bottom:20px;display:grid;gap:16px;position:relative;z-index:1}
    .block-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
    .block-head h3{margin:0 0 6px;font-size:18px}
    .import-errors{display:grid;gap:12px;padding:14px;border-radius:14px;background:rgba(255,255,255,.8);border:1px dashed rgba(148,163,184,.45)}
    .import-errors-title{font-size:13px;font-weight:700;color:#334155}
    .totp-secret{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;word-break:break-all}
    .hint-line{margin-top:12px;color:#64748b;font-size:13px;white-space:pre-wrap}
    .hint-line.error{color:#be123c}
    .channel-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
    .mfa-pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:1px solid rgba(148,163,184,.35);background:rgba(255,255,255,.85);box-shadow:0 6px 14px rgba(15,23,42,.08);transition:transform .2s ease,box-shadow .2s ease,border .2s ease}
    .mfa-pill input{width:16px;height:16px}
    .mfa-pill.active{border-color:rgba(59,130,246,.6);box-shadow:0 10px 18px rgba(59,130,246,.18)}
    .mfa-pill.disabled{opacity:.55}
    .account-tone-totp{background:linear-gradient(135deg,rgba(220,252,231,.55),rgba(219,234,254,.35));border:1px solid rgba(134,239,172,.35)}
    .account-tone-password{background:linear-gradient(135deg,rgba(254,240,138,.28),rgba(255,255,255,.9));border:1px solid rgba(251,191,36,.25)}
    .account-tone-mfa{background:linear-gradient(135deg,rgba(224,231,255,.55),rgba(248,250,252,.9));border:1px solid rgba(148,163,184,.25)}
    .config-page-title h2{margin:0 0 6px;font-size:24px}
    .config-page-title p{margin:0 0 18px;color:var(--muted)}
    .config-stack{display:grid;gap:18px}
    .config-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
    .config-card-header{padding:14px 18px;font-weight:600;background:#f8fafc;border-bottom:1px solid #e2e8f0}
    .config-card-body{padding:18px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
    .config-card-body .full-row{grid-column:1 / -1}
    .config-actions{display:flex;gap:12px;justify-content:flex-end}
    .tone-sec-login{background:linear-gradient(135deg,rgba(254,226,226,.42),rgba(255,255,255,.92))}
    .tone-sec-login .config-card-header{background:rgba(254,226,226,.62)}
    .tone-sec-captcha{background:linear-gradient(135deg,rgba(207,250,254,.45),rgba(255,255,255,.92))}
    .tone-sec-captcha .config-card-header{background:rgba(207,250,254,.66)}
    .tone-sec-mfa{background:linear-gradient(135deg,rgba(254,243,199,.5),rgba(255,255,255,.92))}
    .tone-sec-mfa .config-card-header{background:rgba(254,243,199,.7)}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;position:relative;z-index:1}
    .summary-card{border-radius:16px;padding:18px;display:grid;gap:12px;border:1px solid rgba(148,163,184,.22);background:rgba(255,255,255,.92);box-shadow:0 10px 24px rgba(15,23,42,.08)}
    .summary-card strong{font-size:18px}
    .table-wrap{overflow:auto;border:1px solid rgba(226,232,240,.9);border-radius:16px;position:relative;z-index:1;background:rgba(255,255,255,.9)}
    .data-table{width:100%;border-collapse:collapse;min-width:780px}
    .data-table th,.data-table td{padding:12px 14px;border-bottom:1px solid rgba(226,232,240,.8);text-align:left;font-size:14px;vertical-align:top}
    .data-table th{background:#f8fafc;color:#334155}
    .select-cell{width:52px;text-align:center !important}
    .select-cell input{width:16px;height:16px}
    .empty{text-align:center;color:#64748b}
    .chip-list{display:flex;flex-wrap:wrap;gap:8px}
    .chip{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;border:1px solid rgba(148,163,184,.35);background:#f8fafc;color:#334155;font-size:12px}
    .chip-more{background:#eff6ff;color:#1d4ed8;border-color:rgba(37,99,235,.22);font-weight:600}
    .access-cell{min-width:220px;max-width:320px}
    .table-actions{display:flex;flex-wrap:wrap;gap:8px}
    .tiny-btn{height:36px;padding:0 12px;border-radius:999px;border:1px solid rgba(37,99,235,.24);background:#fff;color:#1d4ed8;font-size:12px;cursor:pointer}
    .tiny-btn.danger{border-color:rgba(220,38,38,.24);color:#b91c1c}
    .tiny-btn:disabled{opacity:.55;cursor:not-allowed}
    .status-pill{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:600}
    .status-pill.warn{background:#fff7ed;color:#c2410c}
    .status-pill.muted{background:#f1f5f9;color:#475569}
    .factor-text{color:#475569}
    .modal-shell[hidden]{display:none !important}
    .modal-shell{position:fixed;inset:0;z-index:40;display:grid;place-items:center;padding:24px;overflow:auto}
    .modal-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.26);backdrop-filter:blur(4px)}
    .modal-panel{position:relative;z-index:1;width:min(1180px,100%);max-height:calc(100vh - 48px);overflow:auto;margin:0;background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(239,246,255,.96));border-radius:22px;border:1px solid rgba(148,163,184,.32);box-shadow:0 24px 60px rgba(15,23,42,.22);padding:22px}
    .modal-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}
    .modal-head h3{margin:0;font-size:22px}
    .user-edit-grid{margin-bottom:0}
	    .audit-kicker{display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:999px;background:rgba(15,23,42,.08);color:#334155;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
	    .audit-overview-rail{display:grid;gap:14px;position:relative;z-index:1}
	    .audit-overview-item{display:grid;grid-template-columns:92px minmax(0,1fr);gap:16px;align-items:start;padding:18px 20px;border-radius:22px;border:1px solid rgba(148,163,184,.18);background:linear-gradient(155deg,rgba(255,255,255,.95),rgba(236,242,255,.82));box-shadow:0 10px 24px rgba(15,23,42,.06)}
	    .audit-overview-step{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 14px;border-radius:999px;background:#dbe7ff;color:#1e3a8a;font-size:12px;font-weight:700;letter-spacing:.08em}
	    .audit-overview-item strong{display:block;font-size:17px;margin-bottom:6px}
	    .audit-overview-item p{margin:0;color:var(--muted);line-height:1.7}
	    .audit-overview-meta{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px;position:relative;z-index:1}
	    .audit-overview-metric{min-width:180px;padding:14px 16px;border-radius:18px;border:1px solid rgba(148,163,184,.2);background:rgba(255,255,255,.84);display:grid;gap:6px}
	    .audit-overview-metric span{font-size:12px;color:var(--muted)}
	    .audit-overview-metric strong{font-size:16px}
	    .audit-command-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.92fr);gap:18px;margin-bottom:18px;position:relative;z-index:1}
	    .audit-command-card{border-radius:24px;border:1px solid rgba(148,163,184,.2);padding:22px;display:grid;gap:18px;overflow:hidden;position:relative}
	    .audit-command-card::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at top left,rgba(59,130,246,.12),transparent 42%),radial-gradient(circle at bottom right,rgba(14,165,233,.09),transparent 32%);pointer-events:none}
	    .audit-command-card > *{position:relative;z-index:1}
	    .audit-command-card-primary{background:linear-gradient(160deg,rgba(249,251,255,.98),rgba(235,242,255,.94));box-shadow:0 16px 36px rgba(15,23,42,.08)}
	    .audit-command-card-focus{background:linear-gradient(165deg,rgba(15,23,42,.96),rgba(30,41,59,.92));color:#e2e8f0;box-shadow:0 18px 42px rgba(15,23,42,.18)}
	    .audit-command-card-focus .audit-kicker{background:rgba(255,255,255,.1);color:#dbeafe}
	    .audit-command-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
	    .audit-command-head h2{margin:10px 0 8px;font-size:30px;line-height:1.05;letter-spacing:-.03em}
	    .audit-command-head p{margin:0;max-width:720px;color:#475569;line-height:1.7}
	    .audit-preset-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
	    .audit-preset-label{font-size:12px;font-weight:700;color:#64748b;letter-spacing:.08em;text-transform:uppercase}
	    .audit-filter-grid{margin:0;padding:0;border:none;background:transparent;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}
	    .audit-limit-field{max-width:180px}
	    .audit-filter-actions{align-self:end}
	    .audit-filter-chip{min-height:40px;padding:0 15px;border-radius:999px;border:1px solid rgba(100,116,139,.22);background:rgba(255,255,255,.82);color:#334155;cursor:pointer;transition:transform .18s ease,background .18s ease,border-color .18s ease,box-shadow .18s ease}
	    .audit-filter-chip:hover{transform:translateY(-1px);border-color:rgba(37,99,235,.24);box-shadow:0 8px 18px rgba(15,23,42,.06)}
	    .audit-filter-chip.active{border-color:#0f172a;background:#0f172a;color:#f8fafc;font-weight:700;box-shadow:0 12px 22px rgba(15,23,42,.12)}
	    .audit-filter-note{font-size:13px;color:#475569;line-height:1.7}
	    .audit-focus-card{display:grid;gap:10px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,.12)}
	    .audit-focus-card strong{font-size:28px;line-height:1.08;letter-spacing:-.03em}
	    .audit-focus-card p{margin:0;color:rgba(226,232,240,.82);line-height:1.7}
	    .audit-focus-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
	    .audit-focus-metric{padding:14px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);display:grid;gap:8px}
	    .audit-focus-metric span{font-size:12px;color:rgba(191,219,254,.75)}
	    .audit-focus-metric strong{font-size:15px;color:#f8fafc}
	    .audit-stream-panel{padding:22px;border-radius:24px;border:1px solid rgba(148,163,184,.18);background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(242,247,255,.92));box-shadow:0 14px 30px rgba(15,23,42,.06);position:relative;z-index:1}
	    .audit-results-bar{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}
	    .audit-results-bar strong{display:block;font-size:24px;line-height:1.08;margin:8px 0 6px;letter-spacing:-.03em}
	    .audit-results-bar p{margin:0;color:var(--muted);font-size:13px;line-height:1.7}
	    .audit-results-meta{display:flex;flex-wrap:wrap;gap:10px}
	    .audit-results-meta span{display:inline-flex;align-items:center;min-height:36px;padding:0 13px;border-radius:999px;background:#eaf2ff;color:#1e40af;font-size:12px;font-weight:700;border:1px solid rgba(59,130,246,.16)}
	    .audit-table-wrap{background:rgba(255,255,255,.72);border-color:rgba(148,163,184,.16)}
	    .audit-data-table{min-width:860px}
	    .audit-stream-table th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;background:rgba(226,232,240,.44);color:#475569}
	    .audit-stream-table tbody tr:hover{background:rgba(226,232,240,.28)}
	    .audit-pagination{margin-top:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
	    .audit-pagination-summary{font-size:13px;color:#475569;line-height:1.6}
	    .audit-pagination-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
	    .audit-page-indicator{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 14px;border-radius:999px;background:#f8fafc;border:1px solid rgba(148,163,184,.2);color:#334155;font-size:12px;font-weight:700}
	    .audit-pagination .ghost-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;transform:none}
	    .audit-id-badge{display:inline-flex;align-items:center;justify-content:center;min-width:54px;min-height:30px;padding:0 10px;border-radius:999px;background:#f1f5f9;color:#0f172a;font-size:12px;font-weight:700;border:1px solid rgba(148,163,184,.24)}
	    .audit-event-cell,.audit-subject-cell,.audit-object-cell{display:grid;gap:8px}
	    .audit-subject-head,.audit-object-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
	    .audit-user-name{font-weight:700;color:#0f172a}
	    .audit-subject-meta,.audit-object-meta{font-size:12px;color:#64748b;line-height:1.6}
	    .audit-meta-chip,.audit-object-chip,.audit-event-chip{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(148,163,184,.24);background:#f8fafc;color:#334155;font-size:12px;font-weight:600;white-space:nowrap}
	    .audit-meta-chip{background:#eff6ff;color:#1d4ed8;border-color:rgba(59,130,246,.22)}
	    .audit-object-chip{background:#f8fafc;color:#475569}
	    .audit-event-chip.tone-session{background:#e0f2fe;color:#0c4a6e;border-color:rgba(14,165,233,.26)}
	    .audit-event-chip.tone-security{background:#eef2ff;color:#3730a3;border-color:rgba(99,102,241,.24)}
	    .audit-event-chip.tone-change{background:#ecfccb;color:#3f6212;border-color:rgba(132,204,22,.24)}
	    .audit-event-chip.tone-neutral{background:#f8fafc;color:#334155}
	    .audit-time{font-family:'SFMono-Regular',Consolas,'Liberation Mono','Courier New',monospace;color:#334155;font-size:12px;line-height:1.6}
	    .audit-workbench{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;position:relative;z-index:1}
	    .audit-workbench-card{border-radius:22px;padding:20px;border:1px solid rgba(148,163,184,.2);background:rgba(255,255,255,.92);display:grid;gap:14px;box-shadow:0 12px 26px rgba(15,23,42,.08)}
	    .audit-workbench-card strong{display:block;font-size:22px;line-height:1.08;margin-top:8px}
	    .audit-workbench-card p{margin:0;color:var(--muted);line-height:1.7}
	    .audit-workbench-note{font-size:13px;color:#475569;line-height:1.7}
	    .toast{padding:12px 16px;border-radius:14px;max-width:640px;box-shadow:var(--shadow)}
    .toast.info{background:#eff6ff;color:#1d4ed8}
    .toast.success{background:#e9f0ff;color:#2f6df6}
    .toast.error{background:#fff1f2;color:#be123c}
    @media (max-width: 1100px){.form-grid.compact{grid-template-columns:repeat(2,minmax(0,1fr))}}
	    @media (max-width: 960px){
	      .shell{grid-template-columns:1fr}
	      .sidebar{position:relative;height:auto}
	      .hero{flex-direction:column}
	      .config-card-body,.form-grid,.form-grid.compact{grid-template-columns:1fr}
	      .user-import-row{grid-template-columns:1fr}
	      .access-pill-grid{gap:10px}
	      .modal-shell{padding:8px}
	      .modal-panel{width:min(100%,1180px);margin:0;max-height:calc(100vh - 16px)}
	      .block-head{flex-direction:column}
	      .audit-overview-item{grid-template-columns:1fr}
	      .audit-command-grid{grid-template-columns:1fr}
	      .audit-command-head{flex-direction:column}
	      .audit-focus-metrics{grid-template-columns:1fr}
	      .audit-limit-field{max-width:none}
	      .audit-results-bar{flex-direction:column;align-items:flex-start}
	      .audit-preset-row{align-items:flex-start}
	      .audit-pagination{align-items:flex-start}
	    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <p class="eyebrow">统一身份认证</p>
        <strong>${centerDefinition.shellTitle}</strong>
        <div id="userPill" class="user-pill" style="display:none"></div>
      </div>
      <nav class="menu">
        ${navHtml}
      </nav>
      <div class="sidebar-actions">
        <button id="portalBtn" class="ghost-btn" type="button">返回门户</button>
        <button id="logoutBtn" class="ghost-btn logout" type="button">退出登录</button>
      </div>
    </aside>

    <div class="content">
      <header class="hero">
        <div>
          <h1 class="brand-title">
            <span class="brand-red">聚信</span>
            <span class="brand-blue">${centerDefinition.heroName}</span>
            <span class="version-inline">${DEDICATED_CENTER_VERSION}</span>
          </h1>
          <h3 class="hero-title">${centerDefinition.heroTitle}</h3>
          <p class="sub">${centerDefinition.heroSubtitle}</p>
        </div>
        <div class="status">
          ${statsHtml}
        </div>
      </header>

      <section id="roleGuide" class="role-guide-card" style="display:none">
        <div id="roleGuideTitle" class="role-guide-title"></div>
        <div id="roleGuideText" class="role-guide-text">${centerDefinition.roleGuideText}</div>
      </section>

      <div id="status" class="toast info">正在检查登录状态...</div>

      <main id="content" class="content-stack" style="display:none">
        ${centerDefinition.sections}
      </main>
    </div>
  </div>
  <script nonce="${nonce}">
    const systemKey = '${config.key}';
    const allowedRoles = ${JSON.stringify(allowedRoles)};
    const defaultTab = ${JSON.stringify(centerDefinition.defaultTab)};
    const centerRoleGuideText = ${JSON.stringify(centerDefinition.roleGuideText)};
    const centerApi = ${JSON.stringify(config.api || {})};
    const releaseVersion = ${JSON.stringify(RELEASE_VERSION)};
    const defaultPasswordPolicy = Object.freeze({
      minLength: 10,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
    });
    const systemAccessOptions = ${JSON.stringify(ADMIN_CENTER_SYSTEM_OPTIONS)};
    const systemDisplayOptions = ${JSON.stringify(SYSTEM_DISPLAY_OPTIONS)};
    const auditActionOptions = ${JSON.stringify(AUDIT_ACTION_OPTIONS)};
    const auditEntityOptions = ${JSON.stringify(AUDIT_ENTITY_OPTIONS)};
    const auditPresetOptions = ${JSON.stringify(AUDIT_PRESET_OPTIONS)};
    const defaultRoleIpAllowlist = Object.freeze({
      admin: [],
      sysadmin: [],
      auditor: [],
    });
    const roleLabelMap = {
      admin: '管理员',
      sysadmin: '系统管理员',
      auditor: '审计管理员',
      editor: '业务管理员',
      reviewer: '审核用户',
      user: '普通用户',
      viewer: '普通用户',
      sales: '销售',
    };
    const DEFAULT_AUDIT_PAGE_SIZE = 10;

    function clampNumber(value, fallback, min, max) {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.min(max, Math.max(min, Math.round(num)));
    }

    let csrfToken = '';
    let currentUser = null;
    let adminUsersRows = [];
    let adminSelectedUserIds = [];
    let adminDepartmentsRows = [];
    let auditLogsRows = [];
    let auditLogsMeta = {
      page: 1,
      pageSize: DEFAULT_AUDIT_PAGE_SIZE,
      total: 0,
      matchedTotal: 0,
      matchedTotalIsExact: true,
      totalPages: 0,
      hasMore: false,
      systems: 0,
      queryLimit: 100,
    };
    let currentEditUserRow = null;
    let adminUserImportUploading = false;
    let adminUserImportTemplateDownloading = false;
    let adminUserExporting = false;
    let adminUsersBulkDeleting = false;
    let adminUserImportResult = null;
    let adminSecurityRawState = {};
    let accountSecurityState = {
      enabled: false,
      methods: [],
      available: { email: false, sms: false, wecom: false, totp: false },
      totpEnabled: false,
      totpSecret: '',
    };
    const statusEl = document.getElementById('status');
    const contentEl = document.getElementById('content');
    const roleGuideEl = document.getElementById('roleGuide');
    const roleGuideTitleEl = document.getElementById('roleGuideTitle');
    const roleGuideTextEl = document.getElementById('roleGuideText');
    const userPillEl = document.getElementById('userPill');
    const portalBtn = document.getElementById('portalBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    function roleLabel(value) {
      return roleLabelMap[String(value || '').trim().toLowerCase()] || value || '-';
    }

    function getDepartmentName(departmentCode) {
      const code = String(departmentCode || '').trim().toUpperCase();
      if (!code) return '未分配';
      const row = adminDepartmentsRows.find((item) => String(item.code || '').trim().toUpperCase() === code);
      return row?.name || code;
    }

    function renderDepartmentOptions(selectedCode = '') {
      const selected = String(selectedCode || '').trim().toUpperCase();
      const rows = Array.isArray(adminDepartmentsRows) ? adminDepartmentsRows : [];
      const activeRows = rows.filter((item) => Number(item.is_active || 0) === 1 || String(item.code || '').trim().toUpperCase() === selected);
      const seen = new Set();
      const options = ['<option value="">未分配</option>'];
      activeRows.forEach((item) => {
        const code = String(item.code || '').trim().toUpperCase();
        if (!code || seen.has(code)) return;
        seen.add(code);
        const label = String(item.name || code).trim() || code;
        options.push('<option value="' + escapeHtml(code) + '"' + (code === selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>');
      });
      if (selected && !seen.has(selected)) {
        options.push('<option value="' + escapeHtml(selected) + '" selected>' + escapeHtml(selected) + '</option>');
      }
      return options.join('');
    }

    function syncDepartmentSelects() {
      const createSelect = document.getElementById('adminCreateUserDepartment');
      if (createSelect) {
        const currentValue = String(createSelect.value || '').trim().toUpperCase();
        createSelect.innerHTML = renderDepartmentOptions(currentValue);
        createSelect.value = currentValue;
      }
      const editSelect = document.getElementById('adminEditDepartmentCode');
      if (editSelect) {
        const currentValue = String(editSelect.value || '').trim().toUpperCase();
        editSelect.innerHTML = renderDepartmentOptions(currentValue);
        editSelect.value = currentValue;
      }
    }

    function renderDepartmentAdminPicker(selectedIds = []) {
      const container = document.getElementById('adminDepartmentAdmins');
      if (!container) return;
      const picked = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((item) => Number(item)).filter((item) => item > 0));
      const options = adminUsersRows
        .filter((row) => Number(row.is_active) === 1)
        .sort((left, right) => String(left.username || '').localeCompare(String(right.username || '')));
      if (!options.length) {
        container.innerHTML = '<span class="muted">请先创建用户，再设置部门管理员</span>';
        return;
      }
      container.innerHTML = options.map((row) => {
        const checked = picked.has(Number(row.id)) ? ' checked' : '';
        const code = String(row.department_code || '').trim().toUpperCase();
        const deptText = code ? (' · ' + getDepartmentName(code)) : '';
        return '<label class="mfa-pill"><input type="checkbox" data-department-admin-user="' + row.id + '"' + checked + ' />'
          + escapeHtml(String(row.username || '-'))
          + '<span class="muted">' + escapeHtml(deptText) + '</span></label>';
      }).join('');
    }

    function readSelectedDepartmentAdminIds() {
      return Array.from(document.querySelectorAll('[data-department-admin-user]:checked'))
        .map((input) => Number(input.dataset.departmentAdminUser || 0))
        .filter((id) => Number.isFinite(id) && id > 0);
    }

    function getSystemDisplayOption(key) {
      return systemDisplayOptions.find((item) => item.key === String(key || '').trim());
    }

    function getSystemDisplayLabel(key) {
      const item = getSystemDisplayOption(key);
      return item?.label || key || '-';
    }

    function getSystemDisplayShortLabel(key) {
      const item = getSystemDisplayOption(key);
      return item?.shortLabel || item?.label || key || '-';
    }

    function summarizeSystemAccess(keys, maxVisible = 2) {
      const labels = Array.isArray(keys)
        ? keys.map((key) => getSystemDisplayShortLabel(key)).filter(Boolean)
        : [];
      return {
        labels: labels.slice(0, maxVisible),
        overflowCount: Math.max(labels.length - maxVisible, 0),
      };
    }

    function getAuditActionOption(value) {
      return auditActionOptions.find((item) => item.value === String(value || '').trim());
    }

    function getAuditEntityOption(value) {
      return auditEntityOptions.find((item) => item.value === String(value || '').trim());
    }

    function getAuditPreset(value) {
      return auditPresetOptions.find((item) => item.key === String(value || '').trim());
    }

    function getAuditSystemLabel(key) {
      if (String(key || '').trim() === 'sso') return '统一登录';
      return getSystemDisplayShortLabel(key);
    }

    function getAuditActionLabel(key) {
      const item = getAuditActionOption(key);
      return item?.label || key || '-';
    }

    function getAuditActionTone(key) {
      const item = getAuditActionOption(key);
      return item?.tone || 'neutral';
    }

    function getAuditEntityLabel(key) {
      const item = getAuditEntityOption(key);
      return item?.label || key || '-';
    }

    function getAuditRequestIpLabel(row) {
      const action = String(row?.action || '').trim().toUpperCase();
      const entity = String(row?.entity || '').trim().toLowerCase();
      if (
        action === 'LOGOUT'
        || action.startsWith('LOGIN')
        || action.startsWith('MFA_')
        || action.startsWith('TOTP_')
        || entity === 'auth'
        || entity === 'user_mfa'
      ) {
        return '登录IP';
      }
      return '来源IP';
    }

    function getDefaultBusinessAccessByRole(role) {
      const normalizedRole = String(role || '').trim().toLowerCase();
      if (normalizedRole === 'editor') return ['faq', 'tender', 'train-exam'];
      if (normalizedRole === 'reviewer') return ['faq', 'train-exam'];
      if (normalizedRole === 'sales') return ['reminder', 'train-exam'];
      if (normalizedRole === 'admin') return systemAccessOptions.map((item) => item.key);
      return ['reminder', 'train-exam'];
    }

    function setCheckedValues(selector, values) {
      const selected = new Set(Array.isArray(values) ? values.map((item) => String(item || '').trim()) : []);
      document.querySelectorAll(selector).forEach((input) => {
        input.checked = selected.has(String(input.value || '').trim());
      });
    }

    function readCheckedValues(selector) {
      return Array.from(document.querySelectorAll(selector + ':checked'))
        .map((input) => String(input.value || '').trim())
        .filter(Boolean);
    }

    function syncAccessPillState(selector) {
      document.querySelectorAll(selector).forEach((input) => {
        const pill = input.closest('.access-pill');
        if (!pill) return;
        pill.classList.toggle('active', !!input.checked);
        pill.classList.toggle('disabled', !!input.disabled);
      });
    }

    function applyRoleAccessPreset({ role, selector, hintId, preferredValues = null }) {
      const normalizedRole = String(role || '').trim().toLowerCase();
      const inputs = Array.from(document.querySelectorAll(selector));
      let hintText = '';
      let nextValues = Array.isArray(preferredValues) ? preferredValues : getDefaultBusinessAccessByRole(normalizedRole);
      let disabled = false;

      if (normalizedRole === 'sysadmin') {
        nextValues = [];
        disabled = true;
        hintText = '系统管理员固定进入管理中心，不配置业务系统权限。';
      } else if (normalizedRole === 'auditor') {
        nextValues = [];
        disabled = true;
        hintText = '审计管理员固定进入审计中心，不配置业务系统权限。';
      } else if (normalizedRole === 'admin') {
        nextValues = systemAccessOptions.map((item) => item.key);
        hintText = '管理员默认可访问全部业务系统。';
      } else if (!Array.isArray(preferredValues)) {
        hintText = '可按用户职责勾选业务系统权限。';
      }

      const selected = new Set(nextValues);
      inputs.forEach((input) => {
        input.disabled = disabled;
        input.checked = selected.has(String(input.value || '').trim());
      });
      syncAccessPillState(selector);
      if (hintId) {
        const hintNode = document.getElementById(hintId);
        if (hintNode) hintNode.textContent = hintText;
      }
    }

    function setSurfaceStatus(text, type = 'info') {
      statusEl.className = 'toast ' + type;
      statusEl.textContent = text || '';
      statusEl.style.display = text ? 'block' : 'none';
    }

    function setHint(id, text, isError = false) {
      const node = document.getElementById(id);
      if (!node) return;
      node.className = isError ? 'hint-line error' : 'hint-line';
      node.textContent = text || '';
    }

    function parseJsonSafe(text) {
      try {
        return JSON.parse(text || '{}');
      } catch (_err) {
        return {};
      }
    }

    function getErrorText({ response, data, fallback }) {
      const payloadError = String(data?.error || '').trim();
      if (payloadError) return payloadError;
      if (response && response.toLowerCase().includes('csrf')) return '安全校验失败，请刷新后重试';
      return String(response || '').replace(/<[^>]*>/g, '').trim() || fallback;
    }

    async function loadCsrf() {
      const r = await fetch('/api/auth/csrf', { credentials: 'include' });
      if (!r.ok) throw new Error('CSRF_INIT_FAILED');
      const data = await r.json();
      csrfToken = String(data?.token || '');
      if (!csrfToken) throw new Error('CSRF_EMPTY');
      return csrfToken;
    }

    async function ensureCsrfReady() {
      if (csrfToken) return csrfToken;
      return loadCsrf();
    }

    async function requestJson(url, options = {}, retry = true) {
      const method = String(options.method || 'GET').trim().toUpperCase();
      const headers = { ...(options.headers || {}) };
      if (options.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        await ensureCsrfReady();
        headers['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
        method,
        headers,
      });
      const text = await response.text();
      const data = parseJsonSafe(text);
      if (response.status === 401) {
        window.location.href = '/portal?system=' + encodeURIComponent(systemKey);
        throw new Error('登录状态已失效');
      }
      if (!response.ok) {
        const message = getErrorText({ response: text, data, fallback: '请求失败' });
        if (retry && message.includes('安全校验失败')) {
          csrfToken = '';
          await loadCsrf();
          return requestJson(url, options, false);
        }
        throw new Error(message);
      }
      return data;
    }

    function extractFilenameFromContentDisposition(value) {
      const text = String(value || '').trim();
      if (!text) return '';
      const utf8Match = text.match(/filename\\*\\s*=\\s*UTF-8''([^;]+)/i);
      if (utf8Match && utf8Match[1]) {
        try {
          return decodeURIComponent(utf8Match[1].trim());
        } catch (_err) {
          return utf8Match[1].trim();
        }
      }
      const quotedMatch = text.match(/filename\\s*=\\s*\"([^\"]+)\"/i);
      if (quotedMatch && quotedMatch[1]) return quotedMatch[1].trim();
      const plainMatch = text.match(/filename\\s*=\\s*([^;]+)/i);
      if (plainMatch && plainMatch[1]) return plainMatch[1].trim();
      return '';
    }

    function readImportFilename(headers, fallback) {
      const explicit = String(headers?.get?.('X-Import-Filename') || '').trim();
      if (explicit) {
        try {
          return decodeURIComponent(explicit);
        } catch (_err) {
          return explicit;
        }
      }
      const contentDisposition = headers?.get?.('Content-Disposition') || '';
      const encodedMatch = String(contentDisposition).match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
      if (encodedMatch && encodedMatch[1]) {
        try {
          return decodeURIComponent(encodedMatch[1].trim());
        } catch (_err) {
          // fall back to filename=
        }
      }
      return extractFilenameFromContentDisposition(contentDisposition) || fallback;
    }

    function readImportSummary(headers) {
      const adminNotifyReasonRaw = String(headers.get('X-Import-Admin-Notify-Reason') || '').trim();
      let adminNotifyReason = '';
      if (adminNotifyReasonRaw) {
        try {
          adminNotifyReason = decodeURIComponent(adminNotifyReasonRaw);
        } catch (_err) {
          adminNotifyReason = adminNotifyReasonRaw;
        }
      }
      return {
        total: Number(headers.get('X-Import-Total') || 0),
        created: Number(headers.get('X-Import-Created') || 0),
        skipped: Number(headers.get('X-Import-Skipped') || 0),
        errorCount: Number(headers.get('X-Import-Error-Count') || 0),
        adminNotifyStatus: String(headers.get('X-Import-Admin-Notify-Status') || '').trim(),
        adminNotifyReason,
        filename: readImportFilename(headers, 'user-import-result.xlsx'),
      };
    }

    async function requestBlob(url, options = {}, retry = true) {
      const method = String(options.method || 'GET').trim().toUpperCase();
      const headers = { ...(options.headers || {}) };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        await ensureCsrfReady();
        headers['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
        method,
        headers,
      });
      const blob = await response.blob();
      if (response.status === 401) {
        window.location.href = '/portal?system=' + encodeURIComponent(systemKey);
        throw new Error('登录状态已失效');
      }
      if (!response.ok) {
        let text = '';
        try {
          text = await blob.text();
        } catch (_err) {
          text = '';
        }
        const data = parseJsonSafe(text);
        const message = getErrorText({ response: text, data, fallback: '请求失败' });
        if (retry && message.includes('安全校验失败')) {
          csrfToken = '';
          await loadCsrf();
          return requestBlob(url, options, false);
        }
        throw new Error(message);
      }
      return { response, blob };
    }

    function triggerFileDownload(blob, filename) {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function parseIpListInput(value) {
      if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
      }
      const text = String(value || '').trim();
      if (!text) return [];
      let items = [];
      try {
        const parsed = JSON.parse(text);
        items = Array.isArray(parsed) ? parsed : text.split(/[\\n,;]+/);
      } catch (_err) {
        items = text.split(/[\\n,;]+/);
      }
      return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
    }

    function normalizePositiveInt(value, fallback, min, max) {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.min(max, Math.max(min, Math.round(num)));
    }

    function normalizeSecurityConfig(securityInput) {
      const source = securityInput && typeof securityInput === 'object' ? securityInput : {};
      const login = source.login && typeof source.login === 'object' ? source.login : {};
      const mfa = source.mfa && typeof source.mfa === 'object' ? source.mfa : {};
      const captcha = source.captcha && typeof source.captcha === 'object' ? source.captcha : {};
      const passwordPolicy = source.passwordPolicy && typeof source.passwordPolicy === 'object' ? source.passwordPolicy : {};
      const session = source.session && typeof source.session === 'object' ? source.session : {};
      const roleIpAllowlist = source.roleIpAllowlist && typeof source.roleIpAllowlist === 'object' ? source.roleIpAllowlist : {};
      return {
        ...source,
        login: {
          maxAttempts: normalizePositiveInt(login.maxAttempts ?? 5, 5, 1, 20),
          windowMinutes: normalizePositiveInt(login.windowMinutes ?? 15, 15, 1, 1440),
          lockMinutes: normalizePositiveInt(login.lockMinutes ?? 15, 15, 1, 1440),
        },
        mfa: {
          ...mfa,
          codeTtlSeconds: normalizePositiveInt(mfa.codeTtlSeconds ?? 300, 300, 60, 1800),
        },
        captcha: {
          ...captcha,
          enabled: captcha.enabled !== false,
          ttlSeconds: normalizePositiveInt(captcha.ttlSeconds ?? 300, 300, 60, 1800),
        },
        forceAllUsersMfa: source.forceAllUsersMfa === true || mfa.forceAllUsers === true,
        adminMfaMethods: Array.isArray(source.adminMfaMethods) ? source.adminMfaMethods.filter(Boolean) : [],
        passwordPolicy: {
          minLength: normalizePositiveInt(passwordPolicy.minLength ?? defaultPasswordPolicy.minLength, 10, 6, 64),
          requireUppercase: passwordPolicy.requireUppercase !== false,
          requireLowercase: passwordPolicy.requireLowercase !== false,
          requireNumber: passwordPolicy.requireNumber !== false,
          requireSpecial: passwordPolicy.requireSpecial !== false,
        },
        session: {
          timeoutMinutes: normalizePositiveInt(session.timeoutMinutes ?? source.sessionTimeoutMinutes ?? 10080, 10080, 5, 10080),
        },
        roleIpAllowlist: {
          ...defaultRoleIpAllowlist,
          admin: parseIpListInput(roleIpAllowlist.admin ?? source.adminIpAllowlist),
          sysadmin: parseIpListInput(roleIpAllowlist.sysadmin ?? source.sysadminIpAllowlist),
          auditor: parseIpListInput(roleIpAllowlist.auditor ?? source.auditorIpAllowlist),
        },
      };
    }

    function setActiveTab(tabKey) {
      document.querySelectorAll('[data-center-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.centerTab === tabKey);
      });
      document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== tabKey;
      });
    }

    function updateStatCard(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = String(value ?? '0');
    }

    function syncAdminImportState() {
      const importInput = document.getElementById('adminUserImportInput');
      const importLabel = document.getElementById('adminUserImportLabel');
      const importLabelText = document.getElementById('adminUserImportLabelText');
      const templateBtn = document.getElementById('adminUserImportTemplateBtn');
      const exportBtn = document.getElementById('adminUserExportBtn');
      const summary = document.getElementById('adminUserImportSummary');
      const importBusy = adminUserImportUploading || adminUserImportTemplateDownloading || adminUserExporting;

      if (importInput) importInput.disabled = importBusy;
      if (importLabel) importLabel.classList.toggle('disabled', importBusy);
      if (importLabelText) {
        importLabelText.textContent = adminUserImportUploading ? '导入中...' : '批量导入（Excel）';
      }
      if (templateBtn) {
        templateBtn.disabled = importBusy;
        templateBtn.textContent = adminUserImportTemplateDownloading ? '模板下载中...' : '下载模板';
      }
      if (exportBtn) {
        exportBtn.disabled = importBusy;
        exportBtn.textContent = adminUserExporting ? '导出中...' : '导出用户';
      }
      if (summary) {
        summary.textContent = adminUserImportResult
          ? (
            '最近导入：' + adminUserImportResult.created + ' 成功 / '
            + adminUserImportResult.skipped + ' 跳过 / '
            + adminUserImportResult.total + ' 总数'
            + (
              adminUserImportResult.adminNotifyStatus
                ? ('；管理员汇总邮件：'
                  + adminUserImportResult.adminNotifyStatus
                  + (adminUserImportResult.adminNotifyReason ? '（' + adminUserImportResult.adminNotifyReason + '）' : '')
                )
                : ''
            )
          )
          : '';
      }
    }

    function normalizeAdminSelectedUserIds(ids) {
      const available = new Set((Array.isArray(adminUsersRows) ? adminUsersRows : []).map((row) => String(row.id)));
      return Array.from(
        new Set((Array.isArray(ids) ? ids : []).map((item) => String(item || '').trim()).filter((item) => available.has(item)))
      );
    }

    function syncAdminUserSelectionUi() {
      const selected = new Set(normalizeAdminSelectedUserIds(adminSelectedUserIds));
      adminSelectedUserIds = Array.from(selected);
      const rows = Array.isArray(adminUsersRows) ? adminUsersRows : [];
      const selectableCount = rows.length;
      const selectedCount = adminSelectedUserIds.length;
      const allChecked = selectableCount > 0 && selectedCount === selectableCount;
      const partiallyChecked = selectedCount > 0 && selectedCount < selectableCount;
      const toggleAll = document.getElementById('adminUsersToggleAll');
      const bulkDeleteBtn = document.getElementById('adminUsersBulkDeleteBtn');
      const summary = document.getElementById('adminUsersSelectionSummary');

      if (toggleAll) {
        toggleAll.checked = allChecked;
        toggleAll.indeterminate = partiallyChecked;
        toggleAll.disabled = selectableCount === 0 || adminUsersBulkDeleting;
      }
      if (bulkDeleteBtn) {
        bulkDeleteBtn.disabled = selectedCount === 0 || adminUsersBulkDeleting;
        bulkDeleteBtn.textContent = adminUsersBulkDeleting ? '批量删除中...' : '批量删除';
      }
      if (summary) {
        summary.textContent = selectedCount > 0
          ? ('已选择 ' + selectedCount + ' 个用户')
          : '可勾选多名用户后执行批量删除。';
      }
      document.querySelectorAll('[data-user-select-id]').forEach((input) => {
        const checked = selected.has(String(input.dataset.userSelectId || '').trim());
        input.checked = checked;
        input.disabled = adminUsersBulkDeleting;
      });
    }

    async function logout() {
      try {
        await requestJson('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({}),
        });
      } catch (_err) {
        // ignore logout failures and return to portal anyway
      }
      window.location.href = '/portal';
    }

    function syncUserIdentity() {
      if (!currentUser) return;
      if (userPillEl) {
        userPillEl.textContent = currentUser.username + ' · ' + roleLabel(currentUser.role);
        userPillEl.style.display = 'inline-flex';
      }
      if (roleGuideTitleEl) roleGuideTitleEl.textContent = '当前角色：' + roleLabel(currentUser.role);
      if (roleGuideTextEl) {
        const departmentName = currentUser?.scope?.department?.name || '';
        roleGuideTextEl.textContent = departmentName
          ? (centerRoleGuideText + ' 当前主归属部门：' + departmentName)
          : centerRoleGuideText;
      }
      if (roleGuideEl) roleGuideEl.style.display = 'block';
    }

    function renderUsers(rows) {
      const body = document.getElementById('adminUsersBody');
      if (!body) return;
      const list = Array.isArray(rows) ? rows : [];
      adminUsersRows = list;
      updateStatCard('primaryStatValue', list.length);
      updateStatCard('secondaryStatValue', list.filter((row) => row.lock_status === 'locked').length);
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="11" class="empty">当前没有用户数据</td></tr>';
        return;
      }
      body.innerHTML = list.map((row, index) => {
        const accessList = Array.isArray(row.app_access) ? row.app_access : [];
        const accessSummary = summarizeSystemAccess(accessList);
        const accessTitle = accessList.map((key) => getSystemDisplayLabel(key)).join('、');
        const access = accessSummary.labels.length
          ? '<div class="chip-list" title="' + escapeHtml(accessTitle) + '">'
            + accessSummary.labels.map((label) => '<span class="chip">' + escapeHtml(label) + '</span>').join('')
            + (accessSummary.overflowCount > 0 ? '<span class="chip chip-more">+' + accessSummary.overflowCount + '</span>' : '')
            + '</div>'
          : '<span class="factor-text">-</span>';
        const factorList = [];
        if (row.email) factorList.push('邮箱');
        if (row.phone) factorList.push('短信');
        if (row.wecom_id) factorList.push('企业微信');
        if (Number(row.totp_enabled) === 1) factorList.push('谷歌认证');
        const factorText = factorList.length ? escapeHtml(Array.from(new Set(factorList)).join('、')) : '-';
        const username = escapeHtml(row.username || '-');
        const role = escapeHtml(roleLabel(row.role || '-'));
        const department = escapeHtml(getDepartmentName(row.department_code));
        const status = Number(row.is_active) === 1
          ? '<span class="status-pill">启用</span>'
          : '<span class="status-pill muted">禁用</span>';
        const lockStatus = row.lock_status === 'locked'
          ? '<span class="status-pill warn">已锁定</span>'
          : '<span class="status-pill">正常</span>';
        const nextActive = Number(row.is_active) === 1 ? 0 : 1;
        const toggleLabel = Number(row.is_active) === 1 ? '禁用' : '启用';
        const unlockDisabled = row.lock_status === 'locked' ? '' : ' disabled';
        const selected = adminSelectedUserIds.includes(String(row.id));
        return '<tr>'
          + '<td class="select-cell"><input type="checkbox" data-user-select-id="' + row.id + '"' + (selected ? ' checked' : '') + ' aria-label="选择用户 ' + username + '" /></td>'
          + '<td>' + (index + 1) + '</td>'
          + '<td>' + username + '</td>'
          + '<td>' + role + '</td>'
          + '<td>' + department + '</td>'
          + '<td>' + status + '</td>'
          + '<td>' + lockStatus + '</td>'
          + '<td class="access-cell">' + access + '</td>'
          + '<td><span class="factor-text">' + factorText + '</span></td>'
          + '<td>' + escapeHtml(row.created_at || '-') + '</td>'
          + '<td><div class="table-actions">'
          + '<button type="button" class="tiny-btn" data-user-action="edit" data-user-id="' + row.id + '">编辑</button>'
          + '<button type="button" class="tiny-btn" data-user-action="toggle-active" data-user-id="' + row.id + '" data-next-active="' + nextActive + '" data-username="' + username + '">' + toggleLabel + '</button>'
          + '<button type="button" class="tiny-btn" data-user-action="unlock" data-user-id="' + row.id + '" data-username="' + username + '"' + unlockDisabled + '>解锁</button>'
          + '<button type="button" class="tiny-btn" data-user-action="reset-password" data-user-id="' + row.id + '" data-username="' + username + '">重置密码</button>'
          + '<button type="button" class="tiny-btn danger" data-user-action="delete" data-user-id="' + row.id + '" data-username="' + username + '">删除</button>'
          + '</div></td>'
          + '</tr>';
      }).join('');
    }

    function closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      modal.hidden = true;
    }

    function openModal(modalId) {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      modal.hidden = false;
    }

    function collectCreateUserPayload(form) {
      const formData = new FormData(form);
      const role = String(formData.get('role') || 'user').trim();
      let appAccess = readCheckedValues('[data-system-access]');
      if (role === 'sysadmin') appAccess = ['admin-center'];
      if (role === 'auditor') appAccess = ['audit-center'];
      return {
        username: String(formData.get('username') || '').trim(),
        password: String(formData.get('password') || '').trim(),
        role,
        department_code: String(formData.get('department_code') || '').trim().toUpperCase(),
        is_active: Number(formData.get('is_active') || 1) === 1 ? 1 : 0,
        email: String(formData.get('email') || '').trim(),
        phone: String(formData.get('phone') || '').trim(),
        wecom_id: String(formData.get('wecom_id') || '').trim(),
        app_access: appAccess,
      };
    }

    function resetCreateUserForm() {
      const form = document.getElementById('adminCreateUserForm');
      if (!form) return;
      form.reset();
      const roleSelect = form.querySelector('select[name="role"]');
      if (roleSelect) roleSelect.value = 'user';
      const activeSelect = form.querySelector('select[name="is_active"]');
      if (activeSelect) activeSelect.value = '1';
      const departmentSelect = form.querySelector('select[name="department_code"]');
      if (departmentSelect) departmentSelect.value = '';
      applyRoleAccessPreset({
        role: 'user',
        selector: '[data-system-access]',
        hintId: 'adminCreateUserAccessHint',
      });
    }

    function openEditUserModal(userId) {
      const row = adminUsersRows.find((item) => String(item.id) === String(userId));
      if (!row) {
        setHint('adminUsersNotice', '未找到要编辑的用户', true);
        return;
      }
      currentEditUserRow = row;
      document.getElementById('adminEditUserId').value = String(row.id || '');
      document.getElementById('adminEditUsername').value = String(row.username || '');
      document.getElementById('adminEditEmail').value = String(row.email || '');
      document.getElementById('adminEditPhone').value = String(row.phone || '');
      document.getElementById('adminEditWecomId').value = String(row.wecom_id || '');
      document.getElementById('adminEditPassword').value = '';
      document.getElementById('adminEditRole').value = String(row.role || 'user');
      document.getElementById('adminEditDepartmentCode').innerHTML = renderDepartmentOptions(row.department_code);
      document.getElementById('adminEditDepartmentCode').value = String(row.department_code || '').trim().toUpperCase();
      document.getElementById('adminEditActive').value = Number(row.is_active) === 1 ? '1' : '0';
      applyRoleAccessPreset({
        role: row.role,
        selector: '[data-edit-system-access]',
        hintId: 'adminEditUserAccessHint',
        preferredValues: Array.isArray(row.app_access) ? row.app_access : [],
      });
      setHint('adminEditUserNotice', '');
      openModal('adminEditModal');
    }

    function collectEditUserPayload() {
      const role = String(document.getElementById('adminEditRole')?.value || 'user').trim();
      let appAccess = readCheckedValues('[data-edit-system-access]');
      if (role === 'sysadmin') appAccess = ['admin-center'];
      if (role === 'auditor') appAccess = ['audit-center'];
      return {
        email: String(document.getElementById('adminEditEmail')?.value || '').trim(),
        phone: String(document.getElementById('adminEditPhone')?.value || '').trim(),
        wecom_id: String(document.getElementById('adminEditWecomId')?.value || '').trim(),
        password: String(document.getElementById('adminEditPassword')?.value || '').trim(),
        role,
        department_code: String(document.getElementById('adminEditDepartmentCode')?.value || '').trim().toUpperCase(),
        is_active: Number(document.getElementById('adminEditActive')?.value || 1) === 1 ? 1 : 0,
        app_access: appAccess,
      };
    }

    function resetDepartmentForm() {
      const codeInput = document.getElementById('adminDepartmentCode');
      const nameInput = document.getElementById('adminDepartmentName');
      const sortInput = document.getElementById('adminDepartmentSortOrder');
      const activeSelect = document.getElementById('adminDepartmentActive');
      if (codeInput) codeInput.value = '';
      if (nameInput) nameInput.value = '';
      if (sortInput) sortInput.value = '0';
      if (activeSelect) activeSelect.value = '1';
      renderDepartmentAdminPicker([]);
    }

    function openDepartmentEditor(departmentCode) {
      const row = adminDepartmentsRows.find((item) => String(item.code || '').trim().toUpperCase() === String(departmentCode || '').trim().toUpperCase());
      if (!row) {
        setHint('adminDepartmentsNotice', '未找到要编辑的部门', true);
        return;
      }
      document.getElementById('adminDepartmentCode').value = String(row.code || '');
      document.getElementById('adminDepartmentName').value = String(row.name || '');
      document.getElementById('adminDepartmentSortOrder').value = String(row.sort_order || 0);
      document.getElementById('adminDepartmentActive').value = Number(row.is_active) === 1 ? '1' : '0';
      renderDepartmentAdminPicker((row.admins || []).map((item) => Number(item.user_id || 0)));
      setHint('adminDepartmentsNotice', '已载入部门：' + String(row.name || row.code));
    }

    function renderDepartments(rows) {
      const body = document.getElementById('adminDepartmentsBody');
      if (!body) return;
      adminDepartmentsRows = Array.isArray(rows) ? rows : [];
      syncDepartmentSelects();
      if (adminUsersRows.length) renderUsers(adminUsersRows);
      if (!adminDepartmentsRows.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty">当前没有部门数据</td></tr>';
        return;
      }
      body.innerHTML = adminDepartmentsRows.map((row) => {
        const admins = Array.isArray(row.admins) && row.admins.length
          ? row.admins.map((item) => '<span class="chip">' + escapeHtml(String(item.username || item.user_id || '-')) + '</span>').join('')
          : '<span class="factor-text">未配置</span>';
        const status = Number(row.is_active) === 1
          ? '<span class="status-pill">启用</span>'
          : '<span class="status-pill muted">禁用</span>';
        return '<tr>'
          + '<td>' + escapeHtml(row.code || '-') + '</td>'
          + '<td>' + escapeHtml(row.name || '-') + '</td>'
          + '<td>' + escapeHtml(row.sort_order || 0) + '</td>'
          + '<td>' + status + '</td>'
          + '<td><div class="chip-list">' + admins + '</div></td>'
          + '<td><div class="table-actions">'
          + '<button type="button" class="tiny-btn" data-department-action="edit" data-department-code="' + escapeHtml(row.code || '') + '">编辑</button>'
          + '</div></td>'
          + '</tr>';
      }).join('');
    }

    async function loadAdminDepartments() {
      setHint('adminDepartmentsNotice', '正在加载部门配置...');
      try {
        const rows = await requestJson('/api/admin-center/departments');
        renderDepartments(rows);
        renderDepartmentAdminPicker(readSelectedDepartmentAdminIds());
        setHint('adminDepartmentsNotice', '部门配置已更新');
      } catch (error) {
        renderDepartments([]);
        renderDepartmentAdminPicker([]);
        setHint('adminDepartmentsNotice', error.message || '加载部门配置失败', true);
      }
    }

    async function onAdminDepartmentSubmit(event) {
      event.preventDefault();
      const code = String(document.getElementById('adminDepartmentCode')?.value || '').trim().toUpperCase();
      const name = String(document.getElementById('adminDepartmentName')?.value || '').trim();
      if (!code || !name) {
        setHint('adminDepartmentsNotice', '请填写部门编码和部门名称', true);
        return;
      }
      const payload = {
        name,
        sort_order: Number(document.getElementById('adminDepartmentSortOrder')?.value || 0),
        is_active: Number(document.getElementById('adminDepartmentActive')?.value || 1) === 1 ? 1 : 0,
        admin_user_ids: readSelectedDepartmentAdminIds(),
      };
      setHint('adminDepartmentsNotice', '正在保存部门配置...');
      try {
        await requestJson('/api/admin-center/departments/' + encodeURIComponent(code), {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        await loadAdminDepartments();
        await loadAdminUsers();
        setHint('adminDepartmentsNotice', '部门配置已保存');
      } catch (error) {
        setHint('adminDepartmentsNotice', error.message || '保存部门配置失败', true);
      }
    }

    function onAdminDepartmentsAction(event) {
      const button = event.target.closest('[data-department-action]');
      if (!button) return;
      const action = String(button.dataset.departmentAction || '').trim();
      const departmentCode = String(button.dataset.departmentCode || '').trim();
      if (action === 'edit' && departmentCode) {
        openDepartmentEditor(departmentCode);
      }
    }

    function syncAccountMfaState() {
      const enabledInput = document.getElementById('accountMfaEnabled');
      if (enabledInput) enabledInput.checked = accountSecurityState.enabled;
      const methodInputs = document.querySelectorAll('[data-mfa-method]');
      methodInputs.forEach((input) => {
        const method = String(input.dataset.mfaMethod || '');
        const available = !!accountSecurityState.available[method];
        const active = accountSecurityState.methods.includes(method);
        input.disabled = !available;
        input.checked = active;
        const pill = input.closest('.mfa-pill');
        if (pill) {
          pill.classList.toggle('active', active);
          pill.classList.toggle('disabled', !available);
        }
      });
      const totpStatus = document.getElementById('totpStatus');
      if (totpStatus) {
        if (accountSecurityState.totpEnabled) {
          totpStatus.textContent = '当前已启用谷歌认证，可直接纳入二次验证。';
        } else if (accountSecurityState.totpSecret) {
          totpStatus.textContent = '已生成密钥，请在认证器中录入后输入验证码完成启用。';
        } else {
          totpStatus.textContent = '当前未启用谷歌认证。';
        }
      }
      const totpEnableBtn = document.getElementById('totpEnableBtn');
      if (totpEnableBtn) totpEnableBtn.disabled = !accountSecurityState.totpSecret;
      const secretWrap = document.getElementById('totpSecretWrap');
      if (secretWrap) secretWrap.style.display = accountSecurityState.totpSecret ? 'grid' : 'none';
      const secretNode = document.getElementById('totpSecret');
      if (secretNode) secretNode.textContent = accountSecurityState.totpSecret || '';
    }

    async function loadAccountSecurity() {
      if (systemKey !== '${ADMIN_CENTER_KEY}') return;
      setHint('accountNotice', '正在加载账号安全配置...');
      try {
        const data = await requestJson('/api/auth/mfa/settings');
        accountSecurityState = {
          enabled: data.enabled === true,
          methods: Array.isArray(data.methods) ? data.methods : [],
          available: {
            email: !!data.has_email,
            sms: !!data.has_phone,
            wecom: !!data.has_wecom,
            totp: !!data.totp_enabled,
          },
          totpEnabled: !!data.totp_enabled,
          totpSecret: '',
        };
        syncAccountMfaState();
        setHint('accountNotice', '账号安全配置已加载');
      } catch (error) {
        setHint('accountNotice', error.message || '读取账号安全配置失败', true);
      }
    }

    async function onTotpSetup() {
      setHint('accountNotice', '正在生成谷歌认证密钥...');
      try {
        const data = await requestJson('/api/auth/totp/setup', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        accountSecurityState.totpSecret = String(data.secret || '');
        accountSecurityState.totpEnabled = false;
        syncAccountMfaState();
        setHint('accountNotice', '已生成密钥，请在谷歌认证器中添加后输入验证码。');
      } catch (error) {
        setHint('accountNotice', error.message || '生成谷歌认证密钥失败', true);
      }
    }

    async function onTotpEnable() {
      const code = String(document.getElementById('totpCodeInput')?.value || '').trim();
      if (!code) {
        setHint('accountNotice', '请输入谷歌验证码', true);
        return;
      }
      setHint('accountNotice', '正在启用谷歌认证...');
      try {
        await requestJson('/api/auth/totp/enable', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        const codeInput = document.getElementById('totpCodeInput');
        if (codeInput) codeInput.value = '';
        await loadAccountSecurity();
        setHint('accountNotice', '谷歌认证已启用，可勾选为当前账号的二次验证方式。');
      } catch (error) {
        setHint('accountNotice', error.message || '启用谷歌认证失败', true);
      }
    }

    async function onChangePassword(event) {
      event.preventDefault();
      const currentPassword = String(document.getElementById('currentPassword')?.value || '').trim();
      const newPassword = String(document.getElementById('newPassword')?.value || '').trim();
      if (!currentPassword || !newPassword) {
        setHint('accountNotice', '请输入当前密码和新密码', true);
        return;
      }
      setHint('accountNotice', '正在修改密码...');
      try {
        const result = await requestJson('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        event.currentTarget.reset();
        setHint('accountNotice', '密码已修改，正在返回登录页重新登录...');
        if (result.reauthRequired) {
          window.setTimeout(() => {
            window.location.href = '/portal';
          }, 1000);
        }
      } catch (error) {
        setHint('accountNotice', error.message || '修改密码失败', true);
      }
    }

    async function onSaveAccountMfaSettings(event) {
      event.preventDefault();
      const enabled = !!document.getElementById('accountMfaEnabled')?.checked;
      const methods = Array.from(document.querySelectorAll('[data-mfa-method]:checked'))
        .map((input) => String(input.dataset.mfaMethod || '').trim())
        .filter(Boolean);
      if (enabled && methods.length === 0) {
        setHint('accountNotice', '请至少选择一种可用的二次验证方式', true);
        return;
      }
      setHint('accountNotice', '正在保存二次验证配置...');
      try {
        await requestJson('/api/auth/mfa/settings', {
          method: 'POST',
          body: JSON.stringify({ enabled, methods }),
        });
        accountSecurityState.enabled = enabled;
        accountSecurityState.methods = methods;
        syncAccountMfaState();
        setHint('accountNotice', '二次验证配置已保存');
      } catch (error) {
        setHint('accountNotice', error.message || '保存二次验证配置失败', true);
      }
    }

    function applySecurityForm(data) {
      const normalized = normalizeSecurityConfig(data || {});
      adminSecurityRawState = normalized;
      const byId = (id) => document.getElementById(id);
      byId('loginMaxAttempts').value = normalized.login.maxAttempts;
      byId('loginWindowMinutes').value = normalized.login.windowMinutes;
      byId('loginLockMinutes').value = normalized.login.lockMinutes;
      byId('passwordMinLength').value = normalized.passwordPolicy.minLength;
      byId('requireUppercase').checked = normalized.passwordPolicy.requireUppercase !== false;
      byId('requireLowercase').checked = normalized.passwordPolicy.requireLowercase !== false;
      byId('requireNumber').checked = normalized.passwordPolicy.requireNumber !== false;
      byId('requireSpecial').checked = normalized.passwordPolicy.requireSpecial !== false;
      byId('sessionTimeoutMinutes').value = normalized.session.timeoutMinutes;
      byId('roleIpAdmin').value = (normalized.roleIpAllowlist.admin || []).join('\\n');
      byId('roleIpSysadmin').value = (normalized.roleIpAllowlist.sysadmin || []).join('\\n');
      byId('roleIpAuditor').value = (normalized.roleIpAllowlist.auditor || []).join('\\n');
      byId('captchaTtlSeconds').value = normalized.captcha.ttlSeconds;
      byId('captchaEnabled').checked = normalized.captcha.enabled !== false;
      byId('forceAllUsersMfa').checked = normalized.forceAllUsersMfa === true;
      byId('mfaCodeTtlSeconds').value = normalized.mfa.codeTtlSeconds;
      document.querySelectorAll('[data-admin-mfa-method]').forEach((input) => {
        const method = String(input.dataset.adminMfaMethod || '').trim();
        const checked = normalized.adminMfaMethods.includes(method);
        input.checked = checked;
        const pill = input.closest('.mfa-pill');
        if (pill) pill.classList.toggle('active', checked);
      });
    }

    function collectSecurityPayload() {
      const base = adminSecurityRawState && typeof adminSecurityRawState === 'object' ? adminSecurityRawState : {};
      const next = {
        ...base,
        login: {
          ...(base.login || {}),
          maxAttempts: Number(document.getElementById('loginMaxAttempts')?.value || 5),
          windowMinutes: Number(document.getElementById('loginWindowMinutes')?.value || 15),
          lockMinutes: Number(document.getElementById('loginLockMinutes')?.value || 15),
        },
        passwordPolicy: {
          ...(base.passwordPolicy || {}),
          minLength: Number(document.getElementById('passwordMinLength')?.value || 10),
          requireUppercase: !!document.getElementById('requireUppercase')?.checked,
          requireLowercase: !!document.getElementById('requireLowercase')?.checked,
          requireNumber: !!document.getElementById('requireNumber')?.checked,
          requireSpecial: !!document.getElementById('requireSpecial')?.checked,
        },
        session: {
          ...(base.session || {}),
          timeoutMinutes: Number(document.getElementById('sessionTimeoutMinutes')?.value || 10080),
        },
        roleIpAllowlist: {
          ...(base.roleIpAllowlist || {}),
          admin: parseIpListInput(document.getElementById('roleIpAdmin')?.value || ''),
          sysadmin: parseIpListInput(document.getElementById('roleIpSysadmin')?.value || ''),
          auditor: parseIpListInput(document.getElementById('roleIpAuditor')?.value || ''),
        },
        captcha: {
          ...(base.captcha || {}),
          enabled: !!document.getElementById('captchaEnabled')?.checked,
          ttlSeconds: Number(document.getElementById('captchaTtlSeconds')?.value || 300),
        },
        forceAllUsersMfa: !!document.getElementById('forceAllUsersMfa')?.checked,
        adminMfaMethods: Array.from(document.querySelectorAll('[data-admin-mfa-method]:checked'))
          .map((input) => String(input.dataset.adminMfaMethod || '').trim())
          .filter(Boolean),
        mfa: {
          ...(base.mfa || {}),
          codeTtlSeconds: Number(document.getElementById('mfaCodeTtlSeconds')?.value || 300),
        },
      };
      next.mfa.forceAllUsers = next.forceAllUsersMfa === true;
      return normalizeSecurityConfig(next);
    }

    async function loadAdminUsers() {
      setHint('adminUsersNotice', '正在刷新用户列表...');
      try {
        const rows = await requestJson(centerApi.usersList);
        renderUsers(rows);
        adminSelectedUserIds = normalizeAdminSelectedUserIds(adminSelectedUserIds);
        syncAdminUserSelectionUi();
        renderDepartmentAdminPicker(readSelectedDepartmentAdminIds());
        setHint('adminUsersNotice', '用户列表已更新');
      } catch (error) {
        renderUsers([]);
        adminSelectedUserIds = [];
        syncAdminUserSelectionUi();
        renderDepartmentAdminPicker([]);
        setHint('adminUsersNotice', error.message || '加载用户列表失败', true);
      }
    }

    async function onAdminUsersAction(event) {
      const button = event.target.closest('[data-user-action]');
      if (!button) return;
      const userId = String(button.dataset.userId || '').trim();
      const action = String(button.dataset.userAction || '').trim();
      const username = String(button.dataset.username || '').trim() || ('#' + userId);
      if (!userId || !action) return;
      let request = null;
      let successMessage = '操作成功';

      if (action === 'edit') {
        openEditUserModal(userId);
        return;
      }
      if (action === 'toggle-active') {
        const nextActive = Number(button.dataset.nextActive || 0) === 1 ? 1 : 0;
        const label = nextActive === 1 ? '启用' : '禁用';
        if (!window.confirm('确认' + label + '用户“' + username + '”吗？')) return;
        request = {
          url: centerApi.usersItemBase + '/' + encodeURIComponent(userId),
          options: {
            method: 'PUT',
            body: JSON.stringify({ is_active: nextActive }),
          },
        };
        successMessage = '已' + label + '用户：' + username;
      } else if (action === 'unlock') {
        request = {
          url: centerApi.usersItemBase + '/' + encodeURIComponent(userId) + '/unlock',
          options: { method: 'POST', body: JSON.stringify({}) },
        };
        successMessage = '已解锁用户：' + username;
      } else if (action === 'reset-password') {
        const newPassword = window.prompt('请输入用户“' + username + '”的新密码');
        if (newPassword === null) return;
        if (!String(newPassword).trim()) {
          setHint('adminUsersNotice', '新密码不能为空', true);
          return;
        }
        request = {
          url: centerApi.usersItemBase + '/' + encodeURIComponent(userId) + '/reset-password',
          options: {
            method: 'POST',
            body: JSON.stringify({ newPassword }),
          },
        };
        successMessage = '已重置密码：' + username;
      } else if (action === 'delete') {
        if (!window.confirm('确认删除用户“' + username + '”吗？此操作不可恢复。')) return;
        request = {
          url: centerApi.usersItemBase + '/' + encodeURIComponent(userId),
          options: { method: 'DELETE' },
        };
        successMessage = '已删除用户：' + username;
      }

      if (!request) return;
      const previousText = button.textContent;
      button.disabled = true;
      button.textContent = '处理中...';
      setHint('adminUsersNotice', '正在执行用户操作...');
      try {
        await requestJson(request.url, request.options);
        await loadAdminUsers();
        setHint('adminUsersNotice', successMessage);
      } catch (error) {
        setHint('adminUsersNotice', error.message || '用户操作失败', true);
      } finally {
        button.disabled = false;
        button.textContent = previousText;
      }
    }

    function onAdminUsersSelectionChange(event) {
      const checkbox = event.target.closest('[data-user-select-id]');
      if (!checkbox) return;
      const userId = String(checkbox.dataset.userSelectId || '').trim();
      if (!userId) return;
      const selected = new Set(adminSelectedUserIds);
      if (checkbox.checked) selected.add(userId);
      else selected.delete(userId);
      adminSelectedUserIds = Array.from(selected);
      syncAdminUserSelectionUi();
    }

    function onAdminUsersToggleAll(event) {
      const checked = !!event.target?.checked;
      adminSelectedUserIds = checked
        ? (Array.isArray(adminUsersRows) ? adminUsersRows.map((row) => String(row.id)) : [])
        : [];
      syncAdminUserSelectionUi();
    }

    async function onAdminUsersBulkDelete() {
      const ids = normalizeAdminSelectedUserIds(adminSelectedUserIds);
      if (!ids.length) {
        setHint('adminUsersNotice', '请先选择要删除的用户', true);
        return;
      }
      if (!window.confirm('确认批量删除已选中的 ' + ids.length + ' 个用户吗？此操作不可恢复。')) return;
      adminUsersBulkDeleting = true;
      syncAdminUserSelectionUi();
      setHint('adminUsersNotice', '正在批量删除用户...');
      try {
        const result = await requestJson(centerApi.usersBatchDelete, {
          method: 'POST',
          body: JSON.stringify({ ids }),
        });
        const failedItems = Array.isArray(result?.results)
          ? result.results.filter((item) => item.status === 'FAILED')
          : [];
        adminSelectedUserIds = [];
        await loadAdminUsers();
        const summary = '批量删除完成：已删除 ' + Number(result?.deleted || 0) + ' 个'
          + (failedItems.length
            ? ('；跳过 ' + failedItems.length + ' 个（' + failedItems.map((item) => item.error || ('#' + item.id)).join('；') + '）')
            : '');
        setHint('adminUsersNotice', summary);
      } catch (error) {
        setHint('adminUsersNotice', error.message || '批量删除用户失败', true);
      } finally {
        adminUsersBulkDeleting = false;
        syncAdminUserSelectionUi();
      }
    }

    async function loadAdminSecurity() {
      setHint('adminSecurityNotice', '正在加载安全配置...');
      try {
        const data = await requestJson(centerApi.securityGet);
        applySecurityForm(data || {});
        setHint('adminSecurityNotice', '安全配置已加载');
      } catch (error) {
        setHint('adminSecurityNotice', error.message || '加载安全配置失败', true);
      }
    }

    async function onAdminCreateUser(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = collectCreateUserPayload(form);
      setHint('adminCreateUserNotice', '正在创建用户...');
      try {
        const row = await requestJson(centerApi.usersCreate, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        resetCreateUserForm();
        setHint('adminCreateUserNotice', '已创建用户：' + row.username);
        await loadAdminUsers();
      } catch (error) {
        setHint('adminCreateUserNotice', error.message || '创建用户失败', true);
      }
    }

    async function onAdminEditUserSubmit(event) {
      event.preventDefault();
      const userId = String(document.getElementById('adminEditUserId')?.value || '').trim();
      if (!userId) {
        setHint('adminEditUserNotice', '缺少用户标识', true);
        return;
      }
      const payload = collectEditUserPayload();
      if (!payload.password) delete payload.password;
      setHint('adminEditUserNotice', '正在更新用户...');
      try {
        const row = await requestJson(centerApi.usersItemBase + '/' + encodeURIComponent(userId), {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setHint('adminEditUserNotice', '用户已更新：' + row.username);
        closeModal('adminEditModal');
        await loadAdminUsers();
      } catch (error) {
        setHint('adminEditUserNotice', error.message || '更新用户失败', true);
      }
    }

    async function onAdminImportUsers(file) {
      if (!file || adminUserImportUploading || adminUserImportTemplateDownloading) return;
      const formData = new FormData();
      formData.append('file', file);
      adminUserImportUploading = true;
      syncAdminImportState();
      setHint('adminUsersNotice', '正在导入用户...');
      try {
        const { response, blob } = await requestBlob(centerApi.usersImport, {
          method: 'POST',
          body: formData,
        });
        const summary = readImportSummary(response.headers);
        adminUserImportResult = summary;
        syncAdminImportState();
        triggerFileDownload(blob, summary.filename);
        const adminNotifyText = summary.adminNotifyStatus
          ? ('；管理员汇总邮件：' + summary.adminNotifyStatus + (summary.adminNotifyReason ? '（' + summary.adminNotifyReason + '）' : ''))
          : '';
        setHint('adminUsersNotice', '用户导入完成：' + summary.created + ' 成功 / ' + summary.skipped + ' 跳过' + adminNotifyText);
        await loadAdminUsers();
      } catch (error) {
        setHint('adminUsersNotice', error.message || '用户导入失败', true);
      } finally {
        adminUserImportUploading = false;
        syncAdminImportState();
      }
    }

    async function onAdminDownloadImportTemplate() {
      if (adminUserImportUploading || adminUserImportTemplateDownloading || adminUserExporting) return;
      adminUserImportTemplateDownloading = true;
      syncAdminImportState();
      setHint('adminUsersNotice', '正在下载导入模板...');
      try {
        const { response, blob } = await requestBlob(centerApi.usersImportTemplate);
        const fileName = readImportFilename(response.headers, '用户导入模板.xlsx');
        triggerFileDownload(blob, fileName);
        setHint('adminUsersNotice', '用户导入模板已开始下载');
      } catch (error) {
        setHint('adminUsersNotice', error.message || '下载模板失败', true);
      } finally {
        adminUserImportTemplateDownloading = false;
        syncAdminImportState();
      }
    }

    async function onAdminExportUsers() {
      if (adminUserImportUploading || adminUserImportTemplateDownloading || adminUserExporting) return;
      adminUserExporting = true;
      syncAdminImportState();
      setHint('adminUsersNotice', '正在导出全部用户...');
      try {
        const { response, blob } = await requestBlob(centerApi.usersExport);
        const fileName = readImportFilename(response.headers, '用户导出.xlsx');
        triggerFileDownload(blob, fileName);
        setHint('adminUsersNotice', '用户导出已开始下载');
      } catch (error) {
        setHint('adminUsersNotice', error.message || '导出用户失败', true);
      } finally {
        adminUserExporting = false;
        syncAdminImportState();
      }
    }

    async function onAdminSaveSecurity(event) {
      event.preventDefault();
      setHint('adminSecurityNotice', '正在保存安全配置...');
      try {
        await requestJson(centerApi.securitySave, {
          method: 'POST',
          body: JSON.stringify(collectSecurityPayload()),
        });
        setHint('adminSecurityNotice', '安全配置已保存');
      } catch (error) {
        setHint('adminSecurityNotice', error.message || '保存安全配置失败', true);
      }
    }

	    function getAuditQueryLimit() {
	      return String(document.getElementById('auditFilterLimit')?.value || '100').trim() || '100';
	    }

	    function normalizeAuditLogsPayload(payload) {
	      const source = payload && typeof payload === 'object' && !Array.isArray(payload)
	        ? payload
	        : { items: Array.isArray(payload) ? payload : [] };
	      const items = Array.isArray(source.items) ? source.items : [];
	      const pageSize = clampNumber(source.pageSize ?? source.page_size, auditLogsMeta.pageSize || DEFAULT_AUDIT_PAGE_SIZE, 1, 2000);
	      const total = source.total === undefined
	        ? items.length
	        : clampNumber(source.total, items.length, 0, 200000);
	      const matchedTotal = source.matchedTotal === undefined
	        ? total
	        : Math.max(total, clampNumber(source.matchedTotal, total, 0, 200000));
	      const totalPages = total
	        ? clampNumber(source.totalPages, Math.ceil(total / pageSize), 1, 100000)
	        : 0;
	      return {
	        items,
	        page: clampNumber(source.page, auditLogsMeta.page || 1, 1, 100000),
	        pageSize,
	        total,
	        matchedTotal,
	        matchedTotalIsExact: source.matchedTotalIsExact === undefined ? true : Boolean(source.matchedTotalIsExact),
	        totalPages,
	        hasMore: source.hasMore === undefined ? (totalPages > 0 && (Number(source.page || 1) < totalPages)) : Boolean(source.hasMore),
	        systems: source.systems === undefined
	          ? new Set(items.map((row) => String(row.system || '').trim()).filter(Boolean)).size
	          : clampNumber(source.systems, 0, 0, 1000),
	        queryLimit: clampNumber(source.queryLimit, Number(getAuditQueryLimit()) || 100, 1, 2000),
	      };
	    }

	    function formatAuditMatchedTotal(meta) {
	      const prefix = meta.matchedTotalIsExact ? '' : '至少 ';
	      return prefix + meta.matchedTotal + ' 条';
	    }

	    function renderAuditPagination(meta) {
	      const summaryEl = document.getElementById('auditPaginationSummary');
	      const indicatorEl = document.getElementById('auditPageIndicator');
	      const prevBtn = document.getElementById('auditPrevPageBtn');
	      const nextBtn = document.getElementById('auditNextPageBtn');
	      if (summaryEl) {
	        if (meta.total) {
	          const limitSuffix = meta.total >= meta.queryLimit ? ('，当前窗口已达到查询上限 ' + meta.queryLimit + ' 条') : '';
	          summaryEl.textContent = '每页 ' + meta.pageSize + ' 条，当前窗口第 ' + meta.page + ' / ' + meta.totalPages + ' 页，共 ' + meta.total + ' 条；总命中 ' + formatAuditMatchedTotal(meta) + limitSuffix;
	        } else {
	          summaryEl.textContent = '每页 ' + meta.pageSize + ' 条，当前没有命中记录';
	        }
	      }
	      if (indicatorEl) indicatorEl.textContent = meta.totalPages ? ('第 ' + meta.page + ' / ' + meta.totalPages + ' 页') : '第 0 / 0 页';
	      if (prevBtn) prevBtn.disabled = meta.page <= 1;
	      if (nextBtn) nextBtn.disabled = !meta.hasMore;
	    }

	    function renderAuditLogs(payload) {
	      const body = document.getElementById('auditLogsBody');
	      if (!body) return null;
	      const meta = normalizeAuditLogsPayload(payload);
	      const list = meta.items;
	      auditLogsRows = list;
	      auditLogsMeta = meta;
	      updateStatCard('primaryStatValue', meta.matchedTotalIsExact ? meta.matchedTotal : ('至少 ' + meta.matchedTotal));
	      updateStatCard('secondaryStatValue', meta.systems);
	      const countEl = document.getElementById('auditResultsCount');
	      const windowCountEl = document.getElementById('auditResultsWindowCount');
	      const systemsEl = document.getElementById('auditResultsSystems');
	      const summaryEl = document.getElementById('auditResultsSummary');
	      const updatedEl = document.getElementById('auditOverviewUpdated');
	      if (countEl) countEl.textContent = '总命中 ' + formatAuditMatchedTotal(meta);
	      if (windowCountEl) windowCountEl.textContent = '当前窗口 ' + meta.total + ' 条';
	      if (systemsEl) systemsEl.textContent = meta.systems + ' 个系统';
	      if (summaryEl) {
	        const limitSuffix = meta.total >= meta.queryLimit && meta.total > 0 ? (' 当前窗口已达到查询上限 ' + meta.queryLimit + ' 条。') : '';
	        summaryEl.textContent = meta.total
	          ? ('总命中 ' + formatAuditMatchedTotal(meta) + '，当前窗口 ' + meta.total + ' 条，覆盖 ' + meta.systems + ' 个系统，当前第 ' + meta.page + ' / ' + meta.totalPages + ' 页。' + limitSuffix)
	          : '当前筛选范围没有命中记录，可以切换预设或放宽条件后重新检索。';
	      }
	      if (updatedEl) updatedEl.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
	      renderAuditPagination(meta);
	      if (!list.length) {
	        body.innerHTML = '<tr><td colspan="6" class="empty">' + escapeHtml(meta.total ? '当前页没有记录，请返回上一页或重新检索。' : '当前没有审计日志') + '</td></tr>';
	        return meta;
	      }
	      body.innerHTML = list.map((row) => {
	        const actionTone = getAuditActionTone(row.action || '');
	        const requestIp = String(row.request_ip || '').trim();
	        const requestIpLabel = getAuditRequestIpLabel(row);
	        const systemLabel = getAuditSystemLabel(row.system || '-') || '-';
	        const entityLabel = getAuditEntityLabel(row.entity || '-');
	        const subjectMeta = row.user_id ? ('用户ID ' + row.user_id) : '用户ID 未记录';
	        const entityMeta = row.entity_id ? ('对象ID ' + row.entity_id) : '对象ID 未记录';
	        return '<tr>'
	          + '<td><span class="audit-id-badge">#' + escapeHtml(row.id) + '</span></td>'
	          + '<td><div class="audit-event-cell"><span class="audit-event-chip tone-' + escapeHtml(actionTone) + '">' + escapeHtml(getAuditActionLabel(row.action || '-')) + '</span></div></td>'
	          + '<td><div class="audit-subject-cell"><div class="audit-subject-head"><strong class="audit-user-name">' + escapeHtml(row.username || '-') + '</strong><span class="audit-meta-chip">' + escapeHtml(systemLabel) + '</span></div>'
	          + '<div class="audit-subject-meta">' + escapeHtml(subjectMeta) + '</div></div></td>'
	          + '<td><div class="audit-object-cell"><div class="audit-object-head"><span class="audit-meta-chip">' + escapeHtml(requestIpLabel) + '</span></div><div class="audit-time">' + escapeHtml(requestIp || '未记录') + '</div></div></td>'
	          + '<td><div class="audit-object-cell"><div class="audit-object-head"><span class="audit-object-chip">' + escapeHtml(entityLabel) + '</span></div><div class="audit-object-meta">' + escapeHtml(entityMeta) + '</div></div></td>'
	          + '<td><div class="audit-time">' + escapeHtml(row.created_at || '-') + '</div></td>'
	          + '</tr>';
	      }).join('');
	      return meta;
	    }

	    function updateAuditWorkbenchSummary(matchedPreset) {
	      const system = String(document.getElementById('auditFilterSystem')?.value || '').trim();
	      const action = String(document.getElementById('auditFilterAction')?.value || '').trim();
	      const entity = String(document.getElementById('auditFilterEntity')?.value || '').trim();
	      const limit = String(document.getElementById('auditFilterLimit')?.value || '100').trim() || '100';
	      const preset = matchedPreset || auditPresetOptions.find((item) => (
	        String(item.query?.system || '').trim() === system
	        && String(item.query?.action || '').trim() === action
	        && String(item.query?.entity || '').trim() === entity
	      ));
	      const setText = (id, text) => {
	        const target = document.getElementById(id);
	        if (target) target.textContent = text;
	      };
	      setText('auditFocusPreset', preset?.label || '自定义检索');
	      setText('auditFocusSummary', preset?.summary || '按当前筛选条件查看命中的审计事件，便于逐条复核。');
	      setText('auditFocusSystem', system ? (getAuditSystemLabel(system) || system) : '全部系统');
	      setText('auditFocusAction', action ? getAuditActionLabel(action) : '全部动作');
	      setText('auditFocusEntity', entity ? getAuditEntityLabel(entity) : '全部对象');
	      setText('auditFocusLimit', limit + ' 条');
	    }

	    function syncAuditPresetButtons() {
	      const system = String(document.getElementById('auditFilterSystem')?.value || '').trim();
	      const action = String(document.getElementById('auditFilterAction')?.value || '').trim();
	      const entity = String(document.getElementById('auditFilterEntity')?.value || '').trim();
	      const matched = auditPresetOptions.find((item) => (
        String(item.query?.system || '').trim() === system
        && String(item.query?.action || '').trim() === action
        && String(item.query?.entity || '').trim() === entity
      ));
	      document.querySelectorAll('[data-audit-preset]').forEach((node) => {
	        node.classList.toggle('active', node.dataset.auditPreset === matched?.key);
	      });
	      updateAuditWorkbenchSummary(matched);
	    }

    function applyAuditPreset(key) {
      const preset = getAuditPreset(key);
      if (!preset) return;
      const { system = '', action = '', entity = '' } = preset.query || {};
      const systemEl = document.getElementById('auditFilterSystem');
      const actionEl = document.getElementById('auditFilterAction');
      const entityEl = document.getElementById('auditFilterEntity');
      if (systemEl) systemEl.value = system;
      if (actionEl) actionEl.value = action;
      if (entityEl) entityEl.value = entity;
      syncAuditPresetButtons();
      loadAuditLogs(null, { resetPage: true });
    }

    function collectAuditQuery(options = {}) {
      const params = new URLSearchParams();
      const mappings = [
        ['username', 'auditFilterUsername'],
        ['system', 'auditFilterSystem'],
        ['action', 'auditFilterAction'],
        ['entity', 'auditFilterEntity'],
        ['limit', 'auditFilterLimit'],
      ];
      mappings.forEach(([key, id]) => {
        const value = String(document.getElementById(id)?.value || '').trim();
        if (value) params.set(key, value);
      });
      params.set('page', String(clampNumber(options.page, auditLogsMeta.page || 1, 1, 100000)));
      params.set('page_size', String(clampNumber(options.pageSize, auditLogsMeta.pageSize || DEFAULT_AUDIT_PAGE_SIZE, 1, 2000)));
      return params;
    }

    async function loadAuditLogs(event, options = {}) {
      if (event) event.preventDefault();
      const shouldResetPage = options.resetPage === true || event?.type === 'submit';
      const page = clampNumber(options.page, shouldResetPage ? 1 : (auditLogsMeta.page || 1), 1, 100000);
      const pageSize = clampNumber(options.pageSize, auditLogsMeta.pageSize || DEFAULT_AUDIT_PAGE_SIZE, 1, 2000);
      const params = collectAuditQuery({ page, pageSize });
      syncAuditPresetButtons();
      setHint('auditLogsNotice', '正在加载审计日志...');
      try {
        const payload = await requestJson(centerApi.logsList + '?' + params.toString());
        const meta = renderAuditLogs(payload);
        if (meta?.total) {
          setHint('auditLogsNotice', '审计日志已更新，总命中 ' + formatAuditMatchedTotal(meta) + '，当前窗口 ' + meta.total + ' 条，当前第 ' + meta.page + ' / ' + meta.totalPages + ' 页');
        } else {
          setHint('auditLogsNotice', '当前筛选范围没有命中记录');
        }
      } catch (error) {
        renderAuditLogs({
          items: [],
          page,
          pageSize,
          total: 0,
          matchedTotal: 0,
          matchedTotalIsExact: true,
          totalPages: 0,
          hasMore: false,
          systems: 0,
          queryLimit: Number(getAuditQueryLimit()) || 100,
        });
        setHint('auditLogsNotice', error.message || '加载审计日志失败', true);
      }
    }

    async function exportAuditLogs() {
      const exportLimit = Number(getAuditQueryLimit()) || 100;
      const params = collectAuditQuery({ page: 1, pageSize: exportLimit });
      const url = centerApi.logsExport + '?' + params.toString();
      setHint('auditVerifyNotice', '正在导出审计日志...');
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          const text = await response.text();
          let message = text || '导出审计日志失败';
          try {
            const data = text ? JSON.parse(text) : {};
            message = String(data.error || message).trim() || '导出审计日志失败';
          } catch (_err) {
            // keep raw response text
          }
          throw new Error(message);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().replaceAll(':', '-');
        link.href = objectUrl;
        link.download = 'audit-center-logs-' + stamp + '.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        setHint('auditVerifyNotice', '审计日志已导出');
      } catch (error) {
        setHint('auditVerifyNotice', error.message || '导出审计日志失败', true);
      }
    }

    async function verifyAuditChain() {
      setHint('auditVerifyNotice', '正在校验审计链...');
      try {
        const limit = String(document.getElementById('auditFilterLimit')?.value || '10000').trim();
        const system = String(document.getElementById('auditFilterSystem')?.value || '').trim();
        const params = new URLSearchParams();
        if (limit) params.set('limit', limit);
        if (system) params.set('system', system);
        const query = params.toString() ? ('?' + params.toString()) : '';
        const result = await requestJson(centerApi.logsVerify + query);
        if (result.ok) {
          setHint('auditVerifyNotice', '审计链校验通过，已检查 ' + result.checked + ' 条记录');
          return;
        }
        setHint('auditVerifyNotice', (result.reason || '审计链校验失败') + '（失败记录 ID: ' + (result.failed_id || '-') + '）', true);
      } catch (error) {
        setHint('auditVerifyNotice', error.message || '审计链校验失败', true);
      }
    }

    function initCenterFeatures() {
      setActiveTab(defaultTab);
      document.querySelectorAll('[data-center-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          setActiveTab(button.dataset.centerTab);
        });
      });
      if (systemKey === '${ADMIN_CENTER_KEY}') {
        document.getElementById('accountPasswordForm')?.addEventListener('submit', onChangePassword);
        document.getElementById('accountMfaForm')?.addEventListener('submit', onSaveAccountMfaSettings);
        document.getElementById('totpSetupBtn')?.addEventListener('click', onTotpSetup);
        document.getElementById('totpEnableBtn')?.addEventListener('click', onTotpEnable);
        document.querySelectorAll('[data-mfa-method]').forEach((input) => {
          input.addEventListener('change', () => {
            const pill = input.closest('.mfa-pill');
            if (pill) pill.classList.toggle('active', input.checked);
          });
        });
        document.querySelectorAll('[data-admin-mfa-method]').forEach((input) => {
          input.addEventListener('change', () => {
            const pill = input.closest('.mfa-pill');
            if (pill) pill.classList.toggle('active', input.checked);
          });
        });
        document.getElementById('adminUsersReloadBtn')?.addEventListener('click', loadAdminUsers);
        document.getElementById('adminUsersBulkDeleteBtn')?.addEventListener('click', onAdminUsersBulkDelete);
        document.getElementById('adminUsersToggleAll')?.addEventListener('change', onAdminUsersToggleAll);
        document.getElementById('adminUsersBody')?.addEventListener('click', onAdminUsersAction);
        document.getElementById('adminUsersBody')?.addEventListener('change', onAdminUsersSelectionChange);
        document.getElementById('adminCreateUserForm')?.addEventListener('submit', onAdminCreateUser);
        document.getElementById('adminCreateUserResetBtn')?.addEventListener('click', resetCreateUserForm);
        document.getElementById('adminEditUserForm')?.addEventListener('submit', onAdminEditUserSubmit);
        document.getElementById('adminDepartmentsReloadBtn')?.addEventListener('click', loadAdminDepartments);
        document.getElementById('adminDepartmentForm')?.addEventListener('submit', onAdminDepartmentSubmit);
        document.getElementById('adminDepartmentResetBtn')?.addEventListener('click', resetDepartmentForm);
        document.getElementById('adminDepartmentsBody')?.addEventListener('click', onAdminDepartmentsAction);
        document.getElementById('adminEditRole')?.addEventListener('change', (event) => {
          applyRoleAccessPreset({
            role: event.target.value,
            selector: '[data-edit-system-access]',
            hintId: 'adminEditUserAccessHint',
          });
        });
        document.querySelector('select[name="role"]')?.addEventListener('change', (event) => {
          applyRoleAccessPreset({
            role: event.target.value,
            selector: '[data-system-access]',
            hintId: 'adminCreateUserAccessHint',
          });
        });
        document.querySelectorAll('[data-system-access]').forEach((input) => {
          input.addEventListener('change', () => syncAccessPillState('[data-system-access]'));
        });
        document.querySelectorAll('[data-edit-system-access]').forEach((input) => {
          input.addEventListener('change', () => syncAccessPillState('[data-edit-system-access]'));
        });
        document.querySelectorAll('[data-modal-close="adminEditModal"]').forEach((node) => {
          node.addEventListener('click', () => closeModal('adminEditModal'));
        });
        document.getElementById('adminUserImportInput')?.addEventListener('change', (event) => {
          const file = event.target.files && event.target.files[0];
          onAdminImportUsers(file);
          event.target.value = '';
        });
        document.getElementById('adminUserImportTemplateBtn')?.addEventListener('click', onAdminDownloadImportTemplate);
        document.getElementById('adminUserExportBtn')?.addEventListener('click', onAdminExportUsers);
        document.getElementById('adminSecurityForm')?.addEventListener('submit', onAdminSaveSecurity);
        document.getElementById('adminSecurityReloadBtn')?.addEventListener('click', loadAdminSecurity);
        syncAdminImportState();
        syncAdminUserSelectionUi();
        resetCreateUserForm();
        resetDepartmentForm();
        loadAccountSecurity();
        loadAdminDepartments();
        loadAdminUsers();
        loadAdminSecurity();
        return;
      }
      document.getElementById('auditFilterForm')?.addEventListener('submit', loadAuditLogs);
      document.getElementById('auditLogsReloadBtn')?.addEventListener('click', loadAuditLogs);
      document.getElementById('auditExportBtn')?.addEventListener('click', exportAuditLogs);
      document.getElementById('auditVerifyBtn')?.addEventListener('click', verifyAuditChain);
      document.getElementById('auditPrevPageBtn')?.addEventListener('click', () => {
        if (auditLogsMeta.page <= 1) return;
        loadAuditLogs(null, { page: auditLogsMeta.page - 1 });
      });
      document.getElementById('auditNextPageBtn')?.addEventListener('click', () => {
        if (!auditLogsMeta.hasMore) return;
        loadAuditLogs(null, { page: auditLogsMeta.page + 1 });
      });
      document.querySelectorAll('[data-audit-preset]').forEach((node) => {
        node.addEventListener('click', () => applyAuditPreset(node.dataset.auditPreset));
      });
      ['auditFilterSystem', 'auditFilterAction', 'auditFilterEntity'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', syncAuditPresetButtons);
      });
      syncAuditPresetButtons();
      loadAuditLogs(null, { resetPage: true });
    }

    async function bootstrapCenter() {
      setSurfaceStatus('正在检查登录状态...', 'info');
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await response.json();
        if (response.status === 401) {
          window.location.href = '/portal?system=' + encodeURIComponent(systemKey);
          return;
        }
        if (response.status === 403 && data?.mustChangePassword) {
          window.location.href = '/portal';
          return;
        }
        const user = data;
        currentUser = user;
        const role = String(user?.role || '').trim().toLowerCase();
        const appAccess = Array.isArray(user?.app_access) ? user.app_access : [];
        if (!allowedRoles.includes(role) || !appAccess.includes(systemKey)) {
          setSurfaceStatus('当前账号无权访问该独立系统，请切换账号或返回门户。', 'error');
          return;
        }
        syncUserIdentity();
        setSurfaceStatus('');
        contentEl.style.display = 'grid';
        initCenterFeatures();
      } catch (error) {
        setSurfaceStatus('加载登录态失败，请刷新后重试。', 'error');
      }
    }

    portalBtn.addEventListener('click', () => {
      window.location.href = '/portal?mode=switch';
    });
    logoutBtn.addEventListener('click', logout);
    bootstrapCenter();
  </script>
</body>
</html>`;
};

const registerDedicatedCenterPage = (systemKey) => {
  const config = getDedicatedCenterConfig(systemKey);
  if (!config) return;
  app.get(`/${systemKey}`, (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderDedicatedCenterPage({
      nonce: res.locals.cspNonce || '',
      config,
    }));
  });
};

registerDedicatedCenterPage(ADMIN_CENTER_KEY);
registerDedicatedCenterPage(AUDIT_CENTER_KEY);

app.get('/portal', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const nonce = res.locals.cspNonce || '';
  const reminderUrl = process.env.APP_REMINDER_URL || 'http://localhost:18080';
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
    .title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
    .version-badge{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:999px;background:rgba(37,99,235,.1);color:#1d4ed8;font-size:12px;font-weight:700;white-space:nowrap}
    label{display:flex;flex-direction:column;gap:8px;margin:12px 0}
    input,select,button{border-radius:10px;border:1px solid rgba(148,163,184,.4);padding:0 12px;font-size:14px;height:40px}
    button{cursor:pointer}
    .primary{background:linear-gradient(135deg,#2563eb,#0ea5e9);color:#fff;border:none}
    .row{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:4px;align-items:center;width:100%}
    .captcha-title{display:block;font-size:24px;font-weight:600;line-height:1.2;margin:12px 0 8px}
    .app-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .app-item{border:1px solid rgba(148,163,184,.28);border-radius:12px;padding:12px;background:#f8fafc}
    .app-name{
      font-weight:700;
      font-size:15px;
      line-height:1.25;
      margin-bottom:8px;
      white-space:nowrap;
      overflow:visible;
      text-overflow:clip
    }
    @media (max-width: 980px){
      .app-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    @media (max-width: 680px){
      .app-grid{grid-template-columns:1fr}
    }
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
    .mfa-methods{display:grid;gap:10px;margin:12px 0}
    .mfa-method{
      display:flex;align-items:center;gap:8px;
      padding:8px 10px;border:1px solid rgba(148,163,184,.35);border-radius:10px;background:#f8fafc
    }
    .mfa-method input{margin:0}
    .mfa-method.disabled{opacity:.55}
    .mfa-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .secondary{background:#fff;color:#0f172a}
    .totp-box{
      margin-top:10px;padding:10px;border:1px dashed rgba(148,163,184,.5);border-radius:10px;background:#f8fafc
    }
    .totp-secret{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;word-break:break-all}
    .mfa-strong{margin-top:8px;font-weight:600;color:#1e293b}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card" id="loginCard">
      <div class="title-row">
        <h1 class="title"><span class="brand-red">聚信</span><span class="brand-blue">统一登录平台</span></h1>
        <span class="version-badge">${DEDICATED_CENTER_VERSION}</span>
      </div>
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
    <div id="forcePasswordCard" class="card" style="display:none">
      <h2 style="margin:0 0 12px">首次登录请先修改密码</h2>
      <div class="muted">为保障账号安全，首次登录后必须先修改密码，修改完成后再重新登录系统。</div>
      <form id="forcePasswordForm">
        <label>当前密码<input id="forceCurrentPassword" type="password" placeholder="请输入当前密码" /></label>
        <label>新密码<input id="forceNewPassword" type="password" placeholder="请输入新密码" /></label>
        <div class="mfa-actions">
          <button id="forcePasswordSubmitBtn" class="primary" type="submit">修改密码</button>
          <button id="forcePasswordLogoutBtn" class="secondary" type="button">退出登录</button>
        </div>
      </form>
      <div id="forcePasswordError" class="error"></div>
      <div id="forcePasswordHint" class="hint"></div>
    </div>
    <div id="mfaCard" class="card" style="display:none">
      <h2 style="margin:0 0 12px">二次验证</h2>
      <div class="muted">请输入二次验证码完成登录。</div>
      <div id="mfaMethods" class="mfa-methods"></div>
      <label>验证码<input id="mfaCode" placeholder="请输入6位验证码" /></label>
      <div class="mfa-actions">
        <button id="mfaSendBtn" class="secondary" type="button">发送验证码</button>
        <button id="mfaVerifyBtn" class="primary" type="button">验证并登录</button>
      </div>
      <div id="mfaError" class="error"></div>
      <div id="mfaHint" class="hint"></div>
    </div>
    <div id="mfaSetupCard" class="card" style="display:none">
      <h2 style="margin:0 0 12px">配置二次验证</h2>
      <div class="muted">系统管理员已开启强制二次验证，请先完成设置后再进入系统。</div>
      <div id="mfaSetupMethods" class="mfa-methods"></div>
      <div class="totp-box">
        <div class="mfa-strong">谷歌认证（可选）</div>
        <div id="totpStatus" class="hint">当前未启用谷歌认证。</div>
        <div id="totpSecretWrap" style="display:none">
          <div class="hint">请将以下密钥录入谷歌认证器：</div>
          <div id="totpSecret" class="totp-secret"></div>
        </div>
        <div class="mfa-actions">
          <button id="totpSetupBtn" class="secondary" type="button">生成谷歌密钥</button>
          <input id="totpCodeInput" placeholder="输入谷歌验证码" />
          <button id="totpEnableBtn" class="secondary" type="button">启用谷歌认证</button>
        </div>
      </div>
      <div class="mfa-actions">
        <button id="mfaSetupSaveBtn" class="primary" type="button">保存并重新登录</button>
        <button id="mfaSetupLogoutBtn" class="secondary" type="button">退出登录</button>
      </div>
      <div id="mfaSetupError" class="error"></div>
      <div id="mfaSetupHint" class="hint"></div>
    </div>
  </div>
  <script nonce="${nonce}">
    let csrfToken = '';
    let captchaToken = '';
    const portalParams = new URLSearchParams(window.location.search);
    const portalMode = String(portalParams.get('mode') || '').toLowerCase();
    const autoRedirectWindowMs = 8000;
    const privilegedDefaultSystemKeyByRole = {
      sysadmin: '${ADMIN_CENTER_KEY}',
      auditor: '${AUDIT_CENTER_KEY}',
    };
    const loopbackHostSet = new Set(['localhost', '127.0.0.1']);
    const portalSessionStorageKey = 'juxin_portal_session';
    const portalSessionQueryKey = 'portal_session';
    const mfaMethodMap = { email: '邮箱', sms: '短信', wecom: '企业微信', totp: '谷歌认证' };
    let mfaLoginState = { token: '', methods: [], method: '' };
    let mfaSetupState = { methods: [], forceAllUsersMfa: false, totpEnabled: false, totpSecret: '' };

    function parseJsonSafe(text) {
      try {
        return JSON.parse(text || '{}');
      } catch (_err) {
        return {};
      }
    }

    function getErrorText({ response, data, fallback }) {
      const payloadError = String(data?.error || '').trim();
      if (payloadError) return payloadError;
      if (response && response.includes('invalid csrf token')) return '安全校验失败，请刷新后重试';
      return String(response || '').replace(/<[^>]*>/g, '').trim() || fallback;
    }

    function hideAllCards() {
      const ids = ['loginCard', 'appsCard', 'forcePasswordCard', 'mfaCard', 'mfaSetupCard'];
      ids.forEach((id) => {
        const node = document.getElementById(id);
        if (node) node.style.display = 'none';
      });
    }

    async function ensureCsrfReady() {
      if (csrfToken) return csrfToken;
      await loadCsrf();
      return csrfToken;
    }
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
    function setForcePasswordError(msg){ document.getElementById('forcePasswordError').textContent = msg || ''; }
    function setForcePasswordHint(msg){ document.getElementById('forcePasswordHint').textContent = msg || ''; }
    function setMfaError(msg){ document.getElementById('mfaError').textContent = msg || ''; }
    function setMfaHint(msg){ document.getElementById('mfaHint').textContent = msg || ''; }
    function setMfaSetupError(msg){ document.getElementById('mfaSetupError').textContent = msg || ''; }
    function setMfaSetupHint(msg){ document.getElementById('mfaSetupHint').textContent = msg || ''; }

    function showForcePasswordCard() {
      hideAllCards();
      const card = document.getElementById('forcePasswordCard');
      if (card) card.style.display = 'block';
      const currentNode = document.getElementById('forceCurrentPassword');
      const newNode = document.getElementById('forceNewPassword');
      if (currentNode) currentNode.value = '';
      if (newNode) newNode.value = '';
      setForcePasswordError('');
      setForcePasswordHint('请先修改密码后再继续。');
    }

    async function onForcePasswordSubmit(event) {
      event.preventDefault();
      const currentPassword = String(document.getElementById('forceCurrentPassword')?.value || '').trim();
      const newPassword = String(document.getElementById('forceNewPassword')?.value || '').trim();
      if (!currentPassword || !newPassword) {
        setForcePasswordError('请输入当前密码和新密码');
        return;
      }
      setForcePasswordError('');
      setForcePasswordHint('正在修改密码...');
      try {
        await ensureCsrfReady();
        const r = await fetch('/api/auth/change-password', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const text = await r.text();
        const data = parseJsonSafe(text);
        if (!r.ok) throw new Error(getErrorText({ response: text, data, fallback: '修改密码失败' }));
        setForcePasswordHint('密码已修改，请重新登录。');
        window.setTimeout(() => {
          window.location.href = '/portal';
        }, 800);
      } catch (err) {
        setForcePasswordError(err.message || '修改密码失败');
      }
    }

    async function onForcePasswordLogout() {
      try {
        await ensureCsrfReady();
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({}),
        });
      } catch (_err) {
        // ignore
      }
      window.location.href = '/portal';
    }

    function renderMfaLoginMethods() {
      const root = document.getElementById('mfaMethods');
      if (!root) return;
      root.innerHTML = '';
      const methods = Array.isArray(mfaLoginState.methods) ? mfaLoginState.methods : [];
      methods.forEach((method, idx) => {
        const label = document.createElement('label');
        label.className = 'mfa-method';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'mfaMethod';
        input.value = method;
        input.checked = mfaLoginState.method ? mfaLoginState.method === method : idx === 0;
        input.addEventListener('change', () => {
          mfaLoginState.method = method;
          setMfaError('');
          setMfaHint(method === 'totp' ? '谷歌认证无需发送验证码，请直接输入验证码后登录。' : '');
          const sendBtn = document.getElementById('mfaSendBtn');
          if (sendBtn) sendBtn.disabled = method === 'totp';
        });
        label.appendChild(input);
        const text = document.createElement('span');
        text.textContent = mfaMethodMap[method] || method;
        label.appendChild(text);
        root.appendChild(label);
      });
      if (!mfaLoginState.method && methods.length) {
        mfaLoginState.method = methods[0];
      }
      const sendBtn = document.getElementById('mfaSendBtn');
      if (sendBtn) sendBtn.disabled = mfaLoginState.method === 'totp';
      setMfaHint(mfaLoginState.method === 'totp' ? '谷歌认证无需发送验证码，请直接输入验证码后登录。' : '');
    }

    function showMfaLogin(data) {
      mfaLoginState = {
        token: String(data?.mfaToken || ''),
        methods: Array.isArray(data?.methods) ? data.methods : [],
        method: Array.isArray(data?.methods) && data.methods.length ? data.methods[0] : '',
      };
      hideAllCards();
      const card = document.getElementById('mfaCard');
      if (card) card.style.display = 'block';
      const code = document.getElementById('mfaCode');
      if (code) code.value = '';
      setMfaError('');
      renderMfaLoginMethods();
    }

    async function onMfaSend() {
      if (!mfaLoginState.token || !mfaLoginState.method) {
        setMfaError('验证会话不存在，请重新登录');
        return;
      }
      if (mfaLoginState.method === 'totp') {
        setMfaHint('谷歌认证无需发送验证码，请直接输入验证码后登录。');
        return;
      }
      try {
        await ensureCsrfReady();
        const r = await fetch('/api/auth/mfa/send', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ mfaToken: mfaLoginState.token, method: mfaLoginState.method }),
        });
        const text = await r.text();
        const data = parseJsonSafe(text);
        if (!r.ok) throw new Error(getErrorText({ response: text, data, fallback: '验证码发送失败' }));
        setMfaError('');
        setMfaHint('验证码已发送，请注意查收。');
      } catch (err) {
        setMfaError(err.message || '验证码发送失败');
      }
    }

    async function onMfaVerify() {
      if (!mfaLoginState.token || !mfaLoginState.method) {
        setMfaError('验证会话不存在，请重新登录');
        return;
      }
      const code = String(document.getElementById('mfaCode')?.value || '').trim();
      if (!code) {
        setMfaError('请输入验证码');
        return;
      }
      try {
        await ensureCsrfReady();
        const r = await fetch('/api/auth/mfa/verify', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ mfaToken: mfaLoginState.token, method: mfaLoginState.method, code }),
        });
        const text = await r.text();
        const data = parseJsonSafe(text);
        if (!r.ok) throw new Error(getErrorText({ response: text, data, fallback: '验证失败' }));
        mfaLoginState = { token: '', methods: [], method: '' };
        if (data.mustChangePassword) {
          showForcePasswordCard();
          return;
        }
        await loadApps();
      } catch (err) {
        setMfaError(err.message || '验证失败');
      }
    }

    function renderMfaSetupMethods() {
      const root = document.getElementById('mfaSetupMethods');
      if (!root) return;
      root.innerHTML = '';
      const available = mfaSetupState.available || {};
      const normalizedSelected = (Array.isArray(mfaSetupState.methods) ? mfaSetupState.methods : []).filter((method) => available[method]);
      mfaSetupState.methods = normalizedSelected;
      ['email', 'sms', 'wecom', 'totp'].forEach((method) => {
        const item = document.createElement('label');
        item.className = 'mfa-method' + (available[method] ? '' : ' disabled');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = method;
        input.disabled = !available[method];
        input.checked = available[method] && mfaSetupState.methods.includes(method);
        input.addEventListener('change', () => {
          const set = new Set(mfaSetupState.methods);
          if (input.checked) set.add(method);
          else set.delete(method);
          mfaSetupState.methods = Array.from(set);
        });
        const text = document.createElement('span');
        text.textContent = (mfaMethodMap[method] || method) + (available[method] ? '' : '（未配置）');
        item.appendChild(input);
        item.appendChild(text);
        root.appendChild(item);
      });
      const totpStatus = document.getElementById('totpStatus');
      if (totpStatus) {
        totpStatus.textContent = mfaSetupState.available?.totp
          ? '当前已启用谷歌认证，可直接勾选保存。'
          : '当前未启用谷歌认证。';
      }
      const secretWrap = document.getElementById('totpSecretWrap');
      const secretNode = document.getElementById('totpSecret');
      if (secretNode) secretNode.textContent = mfaSetupState.totpSecret || '';
      if (secretWrap) secretWrap.style.display = mfaSetupState.totpSecret ? 'block' : 'none';
    }

    async function loadMfaSetupState() {
      const r = await fetch('/api/auth/mfa/settings', { credentials: 'include' });
      const text = await r.text();
      const data = parseJsonSafe(text);
      if (!r.ok) throw new Error(getErrorText({ response: text, data, fallback: '读取二次验证配置失败' }));
      const available = {
        email: !!data.has_email,
        sms: !!data.has_phone,
        wecom: !!data.has_wecom,
        totp: !!data.totp_enabled,
      };
      const methods = Array.isArray(data.methods) ? data.methods.filter((method) => available[method]) : [];
      mfaSetupState = {
        ...mfaSetupState,
        available,
        methods,
        forceAllUsersMfa: !!data.force_all_users_mfa,
        totpEnabled: !!data.totp_enabled,
      };
      renderMfaSetupMethods();
    }

    async function showMfaSetup() {
      hideAllCards();
      const card = document.getElementById('mfaSetupCard');
      if (card) card.style.display = 'block';
      setMfaSetupError('');
      setMfaSetupHint('');
      try {
        await loadMfaSetupState();
        const availableCount = Object.values(mfaSetupState.available || {}).filter(Boolean).length;
        if (!availableCount) {
          setMfaSetupError('当前账号未配置可用二次验证方式，请联系系统管理员补充邮箱/手机号/企业微信，或先启用谷歌认证。');
        }
      } catch (err) {
        setMfaSetupError(err.message || '读取二次验证配置失败');
      }
    }

    async function onTotpSetup() {
      try {
        await ensureCsrfReady();
        const r = await fetch('/api/auth/totp/setup', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({}),
        });
        const text = await r.text();
        const data = parseJsonSafe(text);
        if (!r.ok) throw new Error(getErrorText({ response: text, data, fallback: '生成谷歌密钥失败' }));
        mfaSetupState.totpSecret = String(data.secret || '');
        renderMfaSetupMethods();
        setMfaSetupError('');
        setMfaSetupHint('已生成密钥，请在认证器添加后输入验证码完成启用。');
      } catch (err) {
        setMfaSetupError(err.message || '生成谷歌密钥失败');
      }
    }

    async function onTotpEnable() {
      const code = String(document.getElementById('totpCodeInput')?.value || '').trim();
      if (!code) {
        setMfaSetupError('请输入谷歌验证码');
        return;
      }
      try {
        await ensureCsrfReady();
        const r = await fetch('/api/auth/totp/enable', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ code }),
        });
        const text = await r.text();
        const data = parseJsonSafe(text);
        if (!r.ok) throw new Error(getErrorText({ response: text, data, fallback: '启用谷歌认证失败' }));
        const codeInput = document.getElementById('totpCodeInput');
        if (codeInput) codeInput.value = '';
        mfaSetupState.totpSecret = '';
        await loadMfaSetupState();
        setMfaSetupError('');
        setMfaSetupHint('谷歌认证已启用，可在上方勾选后保存。');
      } catch (err) {
        setMfaSetupError(err.message || '启用谷歌认证失败');
      }
    }

    async function onMfaSetupSave() {
      const selected = (Array.isArray(mfaSetupState.methods) ? mfaSetupState.methods : []).filter((method) => mfaSetupState.available?.[method]);
      if (!selected.length) {
        setMfaSetupError('请至少选择一种可用验证方式');
        return;
      }
      try {
        await ensureCsrfReady();
        const r = await fetch('/api/auth/mfa/settings', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ enabled: true, methods: selected }),
        });
        const text = await r.text();
        const data = parseJsonSafe(text);
        if (!r.ok) throw new Error(getErrorText({ response: text, data, fallback: '保存二次验证设置失败' }));
        setMfaSetupError('');
        setMfaSetupHint('设置已保存，正在退出并要求重新登录...');
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({}),
          });
        } catch (_err) {
          // ignore
        }
        window.location.href = '/portal';
      } catch (err) {
        setMfaSetupError(err.message || '保存二次验证设置失败');
      }
    }

    async function onMfaSetupLogout() {
      try {
        await ensureCsrfReady();
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({}),
        });
      } catch (_err) {
        // ignore
      }
      window.location.href = '/portal';
    }

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
      const data = parseJsonSafe(text);
      if(!r.ok){
        const msg = getErrorText({ response: text, data, fallback: '登录失败' });
        setError(msg.includes('账号') && msg.includes('密码') ? '账号密码错误' : msg);
        await loadCsrf();
        await loadCaptcha();
        return;
      }
      ensurePortalSessionMarker();
      if (data.mfaRequired) {
        showMfaLogin(data);
        return;
      }
      if (data.mfaSetupRequired) {
        await showMfaSetup();
        return;
      }
      if (data.mustChangePassword) {
        showForcePasswordCard();
        return;
      }
      await loadApps();
    }

    async function loadApps(){
      const r = await fetch('/api/auth/apps',{credentials:'include'});
      const text = await r.text();
      const data = parseJsonSafe(text);
      if (!r.ok) {
        if (data.mustChangePassword) {
          showForcePasswordCard();
          return;
        }
        throw new Error(data.error || '登录状态已失效');
      }
      if (data.mustChangePassword) {
        showForcePasswordCard();
        return;
      }
      if (data.mfaSetupRequired) {
        await showMfaSetup();
        return;
      }
      const list = Array.isArray(data.apps)?data.apps:[];
      const userRole = String(data?.user?.role || '').trim().toLowerCase();
      const requestedSystem = String(portalParams.get('system') || '').trim();
      const root = document.getElementById('apps');
      root.innerHTML = '';
      if (!list.length) {
        throw new Error('当前账号没有可进入的系统');
      }
      const privilegedDefaultSystemKey = privilegedDefaultSystemKeyByRole[userRole] || '';
      if (!requestedSystem && portalMode !== 'switch' && privilegedDefaultSystemKey) {
        const preferred = list.find((item) => item.key === privilegedDefaultSystemKey) || list[0];
        if (preferred) {
          if (shouldThrottleRequestedRedirect(preferred.key)) {
            hideAllCards();
          } else {
            window.location.href = appendPortalSession(preferred.url);
            return;
          }
        }
      }
      if (requestedSystem && portalMode !== 'switch') {
        const target = list.find((item) => item.key === requestedSystem);
        if (target) {
          if (shouldThrottleRequestedRedirect(requestedSystem)) {
            hideAllCards();
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
        div.innerHTML = '<div class="app-name">'+app.name+'</div>';
        div.appendChild(btn);
        root.appendChild(div);
      });
      hideAllCards();
      const appsCard = document.getElementById('appsCard');
      if (appsCard) appsCard.style.display = 'block';
    }

    async function bootstrap(){
      const loginCard = document.getElementById('loginCard');
      stripPortalTokenQuery();
      if (!getPortalSessionMarker()) {
        hideAllCards();
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
        hideAllCards();
        if (loginCard) loginCard.style.display = 'block';
      }
      await loadCsrf();
      await loadCaptcha();
    }
    document.getElementById('loginForm').addEventListener('submit', login);
    document.getElementById('captchaImg').addEventListener('click', loadCaptcha);
    document.getElementById('mfaSendBtn').addEventListener('click', onMfaSend);
    document.getElementById('mfaVerifyBtn').addEventListener('click', onMfaVerify);
    document.getElementById('forcePasswordForm').addEventListener('submit', onForcePasswordSubmit);
    document.getElementById('forcePasswordLogoutBtn').addEventListener('click', onForcePasswordLogout);
    document.getElementById('totpSetupBtn').addEventListener('click', onTotpSetup);
    document.getElementById('totpEnableBtn').addEventListener('click', onTotpEnable);
    document.getElementById('mfaSetupSaveBtn').addEventListener('click', onMfaSetupSave);
    document.getElementById('mfaSetupLogoutBtn').addEventListener('click', onMfaSetupLogout);
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
         THEN 'delivery'
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

const getRequestIp = (req) => {
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
  const maxAttempts = clampNumber(login.maxAttempts, 5, 1, 20);
  const windowMinutes = clampNumber(login.windowMinutes, 15, 1, 1440);
  const lockMinutes = clampNumber(login.lockMinutes, 15, 1, 1440);
  const codeTtlSeconds = clampNumber(mfa.codeTtlSeconds, 300, 60, 1800);
  const forceAllUsers = mfa.forceAllUsers === true || security.forceAllUsersMfa === true;
  const captchaEnabled = captcha.enabled !== undefined ? !!captcha.enabled : true;
  const captchaTtlSeconds = clampNumber(captcha.ttlSeconds, 300, 60, 1800);
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

const adminCenterUsersService = createAdminCenterUsersService({
  db,
  hashPassword,
  getSecurityConfig,
  logOperation,
  builtinAccountUsernames: BUILTIN_ACCOUNT_USERNAMES,
});
const adminCenterDepartmentsService = createAdminCenterDepartmentsService({ db });
const adminCenterSecurityService = createAdminCenterSecurityService({
  db,
  logOperation,
});
const auditCenterRemoteBaseUrls = Object.freeze({
  inventory: process.env.AUDIT_SOURCE_INVENTORY_URL || 'http://localhost:5183',
  'device-flow': process.env.AUDIT_SOURCE_DEVICE_FLOW_URL || 'http://localhost:5184',
  delivery: process.env.AUDIT_SOURCE_DELIVERY_URL || 'http://localhost:5185',
  faq: process.env.AUDIT_SOURCE_FAQ_URL || 'http://localhost:5186',
  tender: process.env.AUDIT_SOURCE_TENDER_URL || 'http://localhost:5187',
  'train-exam': process.env.AUDIT_SOURCE_TRAIN_EXAM_URL || 'http://localhost:5188',
  cmdb: process.env.AUDIT_SOURCE_CMDB_URL || 'http://localhost:8088',
});
const auditCenterLogsService = createAuditCenterLogsService({
  db,
  computeAuditSignature,
  remoteBaseUrls: auditCenterRemoteBaseUrls,
});

const canUseDedicatedCenter = (user, systemKey) => canAccessDedicatedCenter({ role: user?.role, systemKey });

const sendApiError = (res, err, fallback = '请求失败') => {
  const statusCode = Number(err?.statusCode || 500);
  const error = String(err?.message || '').trim() || fallback;
  return res.status(statusCode).json({ error });
};

const validateImportedAdminCenterUserRow = (row) => {
  const usernameRuleError = validateUsernameFormat(row.username);
  if (usernameRuleError) return usernameRuleError;

  const nextRole = normalizeUserRole(row.role || 'user');
  if (!nextRole) return '角色不能为空';
  if (!ALLOWED_USER_ROLES.has(nextRole)) {
    return '角色不合法';
  }

  const emailRuleError = validateEmailFormat(row.email);
  if (emailRuleError) return emailRuleError;

  const phoneRuleError = validatePhoneFormat(row.phone);
  if (phoneRuleError) return phoneRuleError;

  try {
    normalizeDepartmentCode(row.department_code);
  } catch (err) {
    return String(err?.message || '部门编码格式不正确');
  }

  const nextAccess = normalizeAppAccess(row.app_access, nextRole);
  if (!nextAccess.length) return '请至少选择一个可访问系统';

  return '';
};

app.get('/api/admin-center/users', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const rows = await adminCenterUsersService.listUsers();
    return res.json(rows);
  } catch (err) {
    return sendApiError(res, err, '获取用户列表失败');
  }
});

app.get('/api/admin-center/users/export.xlsx', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const [users, departments] = await Promise.all([
      adminCenterUsersService.listUsers(),
      adminCenterDepartmentsService.listDepartments(),
    ]);
    const departmentNameMap = new Map(
      (Array.isArray(departments) ? departments : []).map((item) => [String(item.code || '').trim().toUpperCase(), String(item.name || '').trim()])
    );
    const roleLabelMap = new Map([
      ['admin', '管理员'],
      ['sysadmin', '系统管理员'],
      ['auditor', '审计管理员'],
      ['editor', '业务管理员'],
      ['reviewer', '审核用户'],
      ['user', '普通用户'],
      ['viewer', '普通用户'],
      ['sales', '销售'],
    ]);
    const exportRows = (Array.isArray(users) ? users : []).map((row) => {
      const mfaLabels = [];
      if (row.email) mfaLabels.push('邮箱');
      if (row.phone) mfaLabels.push('短信');
      if (row.wecom_id) mfaLabels.push('企业微信');
      if (Number(row.totp_enabled) === 1) mfaLabels.push('谷歌认证');
      const appAccessLabels = (Array.isArray(row.app_access) ? row.app_access : [])
        .map((key) => getSystemDisplayLabel(key))
        .filter(Boolean)
        .join('、');
      const departmentCode = String(row.department_code || '').trim().toUpperCase();
      return {
        username: String(row.username || ''),
        role_label: roleLabelMap.get(String(row.role || '').trim().toLowerCase()) || String(row.role || ''),
        department_name: departmentNameMap.get(departmentCode) || departmentCode || '未分配',
        status_label: Number(row.is_active) === 1 ? '启用' : '禁用',
        lock_status_label: row.lock_status === 'locked' ? '已锁定' : '正常',
        app_access_labels: appAccessLabels,
        email: String(row.email || ''),
        phone: String(row.phone || ''),
        wecom_id: String(row.wecom_id || ''),
        mfa_methods_label: mfaLabels.length ? Array.from(new Set(mfaLabels)).join('、') : '-',
        created_at: String(row.created_at || ''),
      };
    });
    const workbookBuffer = buildAdminCenterUsersExportWorkbook(exportRows);
    const download = buildDownloadHeaderMeta('用户导出.xlsx', 'user-export.xlsx');
    await logOperation({
      user: req.user,
      action: 'EXPORT',
      entity: 'user',
      afterData: {
        total: exportRows.length,
      },
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', download.contentDisposition);
    res.setHeader('X-Import-Filename', download.encodedFileName);
    return res.send(workbookBuffer);
  } catch (err) {
    return sendApiError(res, err, '导出用户失败');
  }
});

app.get('/api/admin-center/departments', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const rows = await adminCenterDepartmentsService.listDepartments();
    return res.json(rows);
  } catch (err) {
    return sendApiError(res, err, '获取部门列表失败');
  }
});

app.put('/api/admin-center/departments/:code', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const row = await adminCenterDepartmentsService.saveDepartment({
      code: req.params.code,
      payload: req.body || {},
    });
    await logOperation({
      user: req.user,
      action: 'UPDATE',
      entity: 'department',
      entityId: String(row.code || ''),
      afterData: row,
    });
    return res.json(row);
  } catch (err) {
    return sendApiError(res, err, '保存部门失败');
  }
});

app.post('/api/admin-center/users', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const row = await adminCenterUsersService.createUser({
      actor: req.user,
      payload: req.body || {},
    });
    return res.json(row);
  } catch (err) {
    return sendApiError(res, err, '创建用户失败');
  }
});

app.post('/api/admin-center/users/import', adminCenterImportUpload.single('file'), async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  let records = [];
  try {
    records = parseAdminCenterUserImportFile(req.file, { maxRecords: MAX_IMPORT_RECORDS });
  } catch (err) {
    return sendApiError(res, err, '解析导入文件失败');
  }

  try {
    const [security, configs] = await Promise.all([
      getSecurityConfig(),
      getConfigs(),
    ]);
    const result = await importUsersFromRows({
      rows: records,
      passwordPolicy: security?.passwordPolicy || DEFAULT_PASSWORD_POLICY,
      validateRow: validateImportedAdminCenterUserRow,
      findUserByUsername: async (username) => {
        const value = String(username || '').trim();
        if (!value) return null;
        return db.get('SELECT id FROM users WHERE username = ? LIMIT 1', [value]);
      },
      insertUser: async (payload) => adminCenterUsersService.createUser({
        actor: req.user,
        payload: {
          username: payload.username,
          password: payload.password,
          role: payload.role,
          is_active: payload.is_active,
          email: payload.email,
          phone: payload.phone,
          wecom_id: payload.wecom_id,
          app_access: payload.app_access,
          must_change_password: 1,
        },
      }),
      notifyUser: async ({ row, initialPassword }) => {
        if (!String(row.email || '').trim()) {
          return { status: 'SKIPPED', reason: '未填写邮箱' };
        }
        const emailContent = buildImportedUserPasswordEmail({
          username: row.username,
          initialPassword,
          loginUrl: AUTH_LOGIN_URL,
        });
        await sendEmail({
          contact: { email: row.email, name: row.username },
          subject: emailContent.subject,
          message: emailContent.message,
          configs,
        });
        return { status: 'SENT', reason: '' };
      },
      resolveInsertError: (err) => String(err?.message || '').trim() || '用户创建失败',
    });
    const importedUsers = result.resultRows
      .filter((item) => item.result === 'SUCCESS')
      .map((item) => ({
        username: item.username,
        email: records.find((row) => String(row?.username || '').trim() === String(item.username || '').trim())?.email || '',
        initialPassword: item.initial_password,
      }));
    let adminNotifyStatus = 'SKIPPED';
    let adminNotifyReason = '';
    if (!importedUsers.length) {
      adminNotifyReason = '本次没有成功导入用户';
    } else {
      const adminUser = await db.get('SELECT id, username, email FROM users WHERE username = ? LIMIT 1', ['admin']);
      if (!String(adminUser?.email || '').trim()) {
        adminNotifyReason = 'admin 未配置邮箱';
      } else {
        try {
          const summaryEmail = buildImportedUsersAdminSummaryEmail({
            loginUrl: AUTH_LOGIN_URL,
            rows: importedUsers,
          });
          await sendEmail({
            contact: { email: adminUser.email, name: adminUser.username || 'admin' },
            subject: summaryEmail.subject,
            message: summaryEmail.message,
            configs,
          });
          adminNotifyStatus = 'SENT';
        } catch (err) {
          adminNotifyStatus = 'FAILED';
          adminNotifyReason = String(err?.message || '').trim() || '管理员汇总邮件发送失败';
        }
      }
    }
    const emailSentCount = result.resultRows.filter((item) => item.notify_email_status === 'SENT').length;
    const emailFailedCount = result.resultRows.filter((item) => item.notify_email_status === 'FAILED').length;
    const emailSkippedCount = result.resultRows.filter((item) => item.notify_email_status === 'SKIPPED').length;

    await logOperation({
      user: req.user,
      action: 'IMPORT',
      entity: 'user',
      afterData: {
        total: result.total,
        created: result.created,
        skipped: result.skipped,
        error_count: result.errors.length,
        email_sent_count: emailSentCount,
        email_failed_count: emailFailedCount,
        email_skipped_count: emailSkippedCount,
        admin_notify_status: adminNotifyStatus,
        admin_notify_reason: adminNotifyReason || undefined,
      },
    });

    const fileName = buildUserImportFilename(new Date());
    const workbookBuffer = buildUserImportWorkbook(result.resultRows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Import-Total', String(result.total));
    res.setHeader('X-Import-Created', String(result.created));
    res.setHeader('X-Import-Skipped', String(result.skipped));
    res.setHeader('X-Import-Error-Count', String(result.errors.length));
    res.setHeader('X-Import-Admin-Notify-Status', adminNotifyStatus);
    res.setHeader('X-Import-Admin-Notify-Reason', encodeURIComponent(adminNotifyReason || ''));
    res.setHeader('X-Import-Filename', fileName);
    return res.send(workbookBuffer);
  } catch (err) {
    return sendApiError(res, err, '用户导入失败');
  }
});

app.get('/api/admin-center/users/template.xlsx', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  const download = buildDownloadHeaderMeta('用户导入模板.xlsx', 'user-import-template.xlsx');
  const workbookBuffer = buildUserImportTemplateWorkbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', download.contentDisposition);
  res.setHeader('X-Import-Filename', download.encodedFileName);
  return res.send(workbookBuffer);
});

app.put('/api/admin-center/users/:id', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const row = await adminCenterUsersService.updateUser({
      actor: req.user,
      targetId: req.params.id,
      payload: req.body || {},
    });
    return res.json(row);
  } catch (err) {
    return sendApiError(res, err, '更新用户失败');
  }
});

app.post('/api/admin-center/users/batch-delete', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const result = await adminCenterUsersService.deleteUsers({
      actor: req.user,
      targetIds: req.body?.ids,
    });
    return res.json(result);
  } catch (err) {
    return sendApiError(res, err, '批量删除用户失败');
  }
});

app.post('/api/admin-center/users/:id/unlock', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const result = await adminCenterUsersService.unlockUser({
      actor: req.user,
      targetId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return sendApiError(res, err, '解锁用户失败');
  }
});

app.post('/api/admin-center/users/:id/reset-password', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const result = await adminCenterUsersService.resetPassword({
      actor: req.user,
      targetId: req.params.id,
      newPassword: req.body?.newPassword,
    });
    return res.json(result);
  } catch (err) {
    return sendApiError(res, err, '重置密码失败');
  }
});

app.delete('/api/admin-center/users/:id', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const result = await adminCenterUsersService.deleteUser({
      actor: req.user,
      targetId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return sendApiError(res, err, '删除用户失败');
  }
});

app.get('/api/admin-center/security', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const security = await adminCenterSecurityService.getSecurity();
    return res.json(security);
  } catch (err) {
    return sendApiError(res, err, '获取安全配置失败');
  }
});

app.post('/api/admin-center/security', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const result = await adminCenterSecurityService.saveSecurity({
      actor: req.user,
      payload: req.body || {},
    });
    return res.json(result);
  } catch (err) {
    return sendApiError(res, err, '保存安全配置失败');
  }
});

app.get('/api/audit-center/logs', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, AUDIT_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问审计中心' });
  }
  try {
    const payload = await auditCenterLogsService.listLogs({
      query: req.query || {},
      authToken: getRequestAuthToken(req),
      cookieHeader: req.headers?.cookie || '',
    });
    return res.json(payload);
  } catch (err) {
    return sendApiError(res, err, '获取审计日志失败');
  }
});

app.get('/api/audit-center/logs/export', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, AUDIT_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问审计中心' });
  }
  try {
    const exportLimit = Number(req.query?.limit || req.query?.page_size || 300);
    const payload = await auditCenterLogsService.listLogs({
      query: {
        ...(req.query || {}),
        page: 1,
        page_size: exportLimit,
      },
      authToken: getRequestAuthToken(req),
      cookieHeader: req.headers?.cookie || '',
    });
    const csv = serializeLogsAsCsv(payload.items);
    const stamp = new Date().toISOString().replaceAll(':', '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-center-logs-${stamp}.csv"`);
    return res.send(`\uFEFF${csv}`);
  } catch (err) {
    return sendApiError(res, err, '导出审计日志失败');
  }
});

app.get('/api/audit-center/logs/verify', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, AUDIT_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问审计中心' });
  }
  try {
    const result = await auditCenterLogsService.verifyLogChain({
      limitInput: req.query?.limit,
      system: req.query?.system,
      authToken: getRequestAuthToken(req),
      cookieHeader: req.headers?.cookie || '',
    });
    return res.json(result);
  } catch (err) {
    return sendApiError(res, err, '审计链校验失败');
  }
});

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
  const passwordCheck = await verifyPassword(password, user.password_hash);
  if (passwordCheck.requiresPasswordReset) {
    await logLoginFailed({
      user: { id: user.id, username: user.username, role: user.role },
      reason: 'PASSWORD_RESET_REQUIRED_LEGACY_LENGTH',
    });
    return res.status(400).json({ error: '当前账号密码哈希需要重置，请联系系统管理员处理' });
  }
  if (!passwordCheck.ok) {
    const fail = await recordLoginFailure({ username: loginId, ip });
    await logLoginFailed({
      user: { id: user.id, username: user.username, role: user.role },
      reason: 'PASSWORD_MISMATCH',
      extra: { fail_count: fail.failCount, locked_until: fail.lockedUntil },
    });
    return res.status(400).json({ error: '账号或密码错误' });
  }
  if (passwordCheck.needsRehash) {
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id]);
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
    const { token } = await createUserSession({
      user,
      securityConfig: security,
      requestIp: ip,
      userAgent: req.headers['user-agent'],
    });
    setAuthCookie(res, token);
    await logOperation({
      user,
      action: 'LOGIN_MFA_SETUP_REQUIRED',
      entity: 'auth',
      entityId: 0,
      requestIp: ip,
      afterData: {
        username: user.username,
        role: user.role,
        ip,
        desired_methods: mfaStatus.desiredMethods,
        available_methods: mfaStatus.availableMethods,
      },
    });
    return res.json({
      mfaSetupRequired: true,
      forceAllUsersMfa: true,
      availableMethods: mfaStatus.availableMethods,
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

  const { token } = await createUserSession({
    user,
    securityConfig: security,
    requestIp: ip,
    userAgent: req.headers['user-agent'],
  });
  setAuthCookie(res, token);
  await logOperation({
    user,
    action: 'LOGIN_SUCCESS',
    entity: 'auth',
    entityId: 0,
    requestIp: ip,
    afterData: { username: user.username, role: user.role, ip, status: 'success' },
  });
  res.json({ token, user: buildAuthUserPayload(user), mustChangePassword: isPasswordChangeRequired(user) });
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
  const security = await getSecurityConfig();
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
      afterData: { username: user.username, role: user.role, ip: requestIp, allowlist: ipCheck.allowlist },
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
  const { token } = await createUserSession({
    user,
    securityConfig: security,
    requestIp,
    userAgent: req.headers['user-agent'],
  });
  setAuthCookie(res, token);
  await logOperation({
    user,
    action: 'LOGIN_SUCCESS',
    entity: 'auth',
    entityId: 0,
    requestIp,
    afterData: { username: user.username, role: user.role, ip: requestIp, status: 'success', mfa_method: method },
  });
  res.json({ token, user: buildAuthUserPayload(user), mustChangePassword: isPasswordChangeRequired(user) });
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
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id, department_code, must_change_password FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.json(null);
  const security = await getSecurityConfig();
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  if (isPasswordChangeRequired(user)) {
    return sendPasswordChangeRequired(res, user);
  }
  const scope = await buildUserScope(user);
  res.json({
    ...buildAuthUserPayload(user),
    app_access: getUserAppAccess(user),
    scope: {
      department: scope.department,
      managedDepartments: scope.managedDepartments,
      isDepartmentDocAdmin: scope.isDepartmentDocAdmin,
    },
    mfa_setup_required: mfaStatus.setupRequired,
    force_all_users_mfa: mfaStatus.forceAllUsers,
  });
});

app.post('/api/auth/logout', async (req, res) => {
  const requestIp = getRequestIp(req);
  await revokeAuthSession({ sessionId: req.authSession?.session_id || req.user?.sid, reason: 'logout' });
  clearAuthCookie(res);
  clearCsrfCookie(res);
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
  if (!user) return res.status(400).json({ error: '用户不存在' });
  const currentPasswordCheck = await verifyPassword(currentPassword, user.password_hash);
  if (currentPasswordCheck.requiresPasswordReset) {
    return res.status(400).json({ error: '当前账号密码哈希需要重置，请联系系统管理员处理' });
  }
  if (!currentPasswordCheck.ok) return res.status(400).json({ error: '当前密码错误' });
  const hash = await hashPassword(newPassword);
  await db.run('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', [hash, 0, req.user.id]);
  await revokeUserSessions({ userId: req.user.id, reason: 'password_change' });
  clearAuthCookie(res);
  clearCsrfCookie(res);
  await logOperation({
    user: req.user,
    action: 'CHANGE_PASSWORD',
    entity: 'user',
    entityId: Number(req.user.id),
  });
  res.json({ ok: true, reauthRequired: true });
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
  validateSecurityBootstrap();
  await db.ready;
  await ensureBuiltinUsers();
  await backfillOperationLogSignatures();
  await backfillOperationLogSystems();
  app.listen(PORT, () => {
    console.log(`Auth server running at http://localhost:${PORT}`);
  });
};

start();

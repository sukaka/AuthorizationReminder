const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
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
const SYSTEM_ACCESS_KEYS = ['reminder', 'ticketing', 'cmdb', 'inventory', 'device-flow', 'sec-impl', 'faq', 'tender', 'train-exam'];
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
const SECURITY_STRICT_MODE = process.env.SECURITY_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';

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
  if (r === 'sysadmin') return ['reminder', 'sec-impl', 'tender', 'train-exam'];
  if (r === 'auditor') return ['reminder', 'ticketing', 'cmdb', 'inventory', 'device-flow', 'sec-impl', 'faq', 'tender', 'train-exam'];
  if (r === 'editor') return ['faq', 'tender', 'train-exam'];
  if (r === 'reviewer') return ['faq', 'train-exam'];
  return ['reminder', 'train-exam'];
};

const getUserAppAccess = (user) => {
  if (!user) return [];
  if (user.role === 'admin') return [...SYSTEM_ACCESS_KEYS];
  const parsed = parseAppAccessRaw(user.app_access);
  const source = parsed === null ? defaultAppAccessByRole(user.role) : parsed;
  const normalized = Array.from(
    new Set(source.map((item) => String(item || '').trim()).filter((item) => SYSTEM_ACCESS_KEYS.includes(item)))
  );
  if (!normalized.includes('train-exam')) normalized.push('train-exam');
  return normalized;
};

const canAccessSystem = (user, systemKey) => getUserAppAccess(user).includes(systemKey);

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
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
}
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

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
    const currentAccess = getUserAppAccess({ role: account.role, app_access: row.app_access });
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

const authorizeFaq = (user, action) => {
  if (!user) return deny('未登录');
  if (!canAccessSystem(user, 'faq')) return deny('无权限访问FAQ系统');
  const role = String(user.role || '').toLowerCase();
  if (action === 'app:enter' || action === 'faq:read') return allow();
  if (action === 'faq:write') {
    if (role === 'admin' || role === 'editor') return allow();
    return deny('仅管理员或编辑可执行FAQ写操作');
  }
  if (action === 'faq:review') {
    if (role === 'admin' || role === 'reviewer') return allow();
    return deny('仅管理员或审核员可执行FAQ审核操作');
  }
  if (action === 'faq:audit') {
    if (role === 'auditor') return allow();
    return deny('仅审计管理员可查看FAQ审计信息');
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
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const security = await getSecurityConfig();
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  if (mfaStatus.setupRequired) {
    return res.status(403).json({ error: '请先完成二次验证设置', mfaSetupRequired: true });
  }
  const scope = await buildUserScope(user);
  const apps = getUserAppAccess(user);
  res.json({ user: { id: user.id, username: user.username, role: user.role }, scope, apps });
});

app.post('/api/auth/authorize', async (req, res) => {
  const { system, action, resource } = req.body || {};
  const user = await db.get(
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id FROM users WHERE id = ?',
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
      user: { id: user.id, username: user.username, role: user.role },
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
  } else if (system === 'sec-impl') {
    result = authorizeSecImpl(user, action);
  } else if (system === 'faq') {
    result = authorizeFaq(user, action);
  } else if (system === 'tender') {
    result = authorizeTender(user, action);
  } else if (system === 'train-exam') {
    result = authorizeTrainExam(user, action);
  }
  return res.json({ ...result, user: { id: user.id, username: user.username, role: user.role }, scope, apps });
});

app.get('/api/auth/apps', async (req, res) => {
  const user = await db.get(
    'SELECT id, username, role, app_access, mfa_enabled, mfa_methods, totp_enabled, totp_secret, email, phone, wecom_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(401).json({ error: '登录已过期' });
  const security = await getSecurityConfig();
  const mfaStatus = resolveUserMfaStatus({ user, securityConfig: security });
  if (mfaStatus.setupRequired) {
    return res.json({
      user: { id: user.id, username: user.username, role: user.role },
      mfaSetupRequired: true,
      availableMethods: mfaStatus.availableMethods,
      apps: [],
    });
  }
  const reminderUrl = process.env.APP_REMINDER_URL || 'http://localhost:8080';
  const ticketingUrl = process.env.APP_TICKETING_URL || 'http://localhost:8081';
  const cmdbURL = process.env.APP_CMDB_URL || 'http://localhost:8090';
  const inventoryURL = process.env.APP_INVENTORY_URL || 'http://localhost:8082';
  const deviceFlowURL = process.env.APP_DEVICE_FLOW_URL || 'http://localhost:8083';
  const secImplURL = process.env.APP_SEC_IMPL_URL || 'http://localhost:8084';
  const faqURL = process.env.APP_FAQ_URL || 'http://localhost:8085';
  const tenderURL = process.env.APP_TENDER_URL || 'http://localhost:8086';
  const trainExamURL = process.env.APP_TRAIN_EXAM_URL || 'http://localhost:8087';
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
    apps.push({ key: 'sec-impl', name: '实施记录系统', url: secImplURL, allow: !!secImplAuth.allow });
  }
  if (appAccess.includes('faq')) {
    const faqAuth = await authorizeFaq(user, 'app:enter');
    apps.push({ key: 'faq', name: 'FAQ系统', url: faqURL, allow: !!faqAuth.allow });
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
    user: { id: user.id, username: user.username, role: user.role },
    apps: apps.filter((item) => item.allow),
  });
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
    const sysadminDefaultSystemKey = 'reminder';
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
      const ids = ['loginCard', 'appsCard', 'mfaCard', 'mfaSetupCard'];
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
    function setMfaError(msg){ document.getElementById('mfaError').textContent = msg || ''; }
    function setMfaHint(msg){ document.getElementById('mfaHint').textContent = msg || ''; }
    function setMfaSetupError(msg){ document.getElementById('mfaSetupError').textContent = msg || ''; }
    function setMfaSetupHint(msg){ document.getElementById('mfaSetupHint').textContent = msg || ''; }

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
      await loadApps();
    }

    async function loadApps(){
      const r = await fetch('/api/auth/apps',{credentials:'include'});
      const text = await r.text();
      const data = parseJsonSafe(text);
      if (!r.ok) {
        throw new Error(data.error || '登录状态已失效');
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
      if (!requestedSystem && portalMode !== 'switch' && userRole === 'sysadmin') {
        const preferred = list.find((item) => item.key === sysadminDefaultSystemKey) || list[0];
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
    role: user.role,
    app_access: getUserAppAccess(user),
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
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
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

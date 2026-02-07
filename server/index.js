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

const app = express();
const PORT = process.env.PORT || 5179;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const CONFIG_SECRET_KEY = process.env.CONFIG_SECRET_KEY || '';
const SECRET_MASK = '******';

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
  return cloned;
};

const decryptSecrets = (configs) => {
  if (!configs) return configs;
  if (configs.email?.pass) configs.email.pass = decryptValue(configs.email.pass);
  if (configs.sms?.accessKeySecret) configs.sms.accessKeySecret = decryptValue(configs.sms.accessKeySecret);
  if (configs.wecom?.secret) configs.wecom.secret = decryptValue(configs.wecom.secret);
  return configs;
};

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const list = allowedOrigins.length ? allowedOrigins : defaultOrigins;
    if (list.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
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
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage() });

const csrfProtection = csurf({
  cookie: {
    key: 'csrf_token',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.CSRF_SECURE === 'true',
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
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  }
  const content = file.buffer.toString('utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
};

const toJson = (row) => (row ? { ...row } : null);

const ensureAdminUser = async () => {
  const existing = await db.get('SELECT COUNT(1) AS count FROM users');
  if (existing && Number(existing.count) > 0) return;
  const hash = bcrypt.hashSync('123456', 10);
  await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
    'admin',
    hash,
    'admin',
  ]);
};

const createToken = (user) =>
  jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });

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
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期' });
  }
};

const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: '无权限' });
  }
  return next();
};

app.use('/api', authMiddleware);

// Auth
app.get('/api/auth/captcha', async (req, res) => {
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
  if (rawUsername === 'admin') {
    loginId = 'admin';
    user = await db.get('SELECT * FROM users WHERE username = ?', ['admin']);
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
      afterData: { username: loginId, ip, fail_count: fail.failCount, locked_until: fail.lockedUntil },
    });
    return res.status(400).json({ error: '账号或密码错误' });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    const fail = await recordLoginFailure({ username: loginId, ip });
    await logOperation({
      user: { id: user.id, username: user.username, role: user.role },
      action: 'LOGIN_FAILED',
      entity: 'auth',
      entityId: 0,
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
  await logOperation({
    user,
    action: 'LOGIN',
    entity: 'auth',
    entityId: 0,
    afterData: { username: user.username, role: user.role },
  });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/mfa/send', async (req, res) => {
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

app.post('/api/auth/mfa/verify', async (req, res) => {
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
    afterData: { method },
  });
  const token = createToken(user);
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
  const user = await db.get('SELECT id, username, role FROM users WHERE id = ?', [req.user.id]);
  res.json(user || null);
});

app.post('/api/auth/logout', async (req, res) => {
  await logOperation({
    user: req.user,
    action: 'LOGOUT',
    entity: 'auth',
    entityId: 0,
  });
  res.json({ ok: true });
});

// Users (admin)
app.get('/api/users', requireRole(['admin']), async (req, res) => {
  const rows = await db.query(
    'SELECT id, username, role, email, phone, wecom_id, totp_enabled, created_at FROM users ORDER BY id DESC'
  );
  res.json(rows);
});

app.post('/api/users', requireRole(['admin']), async (req, res) => {
  const { username, password, role, email, phone, wecom_id } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = await db.run(
      'INSERT INTO users (username, password_hash, role, email, phone, wecom_id) VALUES (?, ?, ?, ?, ?, ?)',
      [username.trim(), hash, role || 'viewer', email || null, phone || null, wecom_id || null]
    );
    const row = await db.get(
      'SELECT id, username, role, email, phone, wecom_id, totp_enabled, created_at FROM users WHERE id = ?',
      [info.insertId]
    );
    await logOperation({
      user: req.user,
      action: 'CREATE',
      entity: 'user',
      entityId: row.id,
      afterData: row,
    });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: '账号已存在或数据错误' });
  }
});

app.put('/api/users/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { password, role, email, phone, wecom_id } = req.body || {};
  if (!password && !role && email === undefined && phone === undefined && wecom_id === undefined) {
    return res.status(400).json({ error: '没有可更新字段' });
  }
  const before = await db.get(
    'SELECT id, username, role, email, phone, wecom_id, totp_enabled, created_at FROM users WHERE id = ?',
    [id]
  );
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  }
  if (role) {
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
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
  const row = await db.get(
    'SELECT id, username, role, email, phone, wecom_id, totp_enabled, created_at FROM users WHERE id = ?',
    [id]
  );
  await logOperation({
    user: req.user,
    action: 'UPDATE',
    entity: 'user',
    entityId: Number(id),
    beforeData: before,
    afterData: row,
  });
  res.json(row);
});

app.delete('/api/users/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  if (String(id) === String(req.user.id)) {
    return res.status(400).json({ error: '不能删除自己' });
  }
  const before = await db.get(
    'SELECT id, username, role, email, phone, wecom_id, totp_enabled, created_at FROM users WHERE id = ?',
    [id]
  );
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
  const maxAttempts = Number(login.maxAttempts ?? 5);
  const windowMinutes = Number(login.windowMinutes ?? 15);
  const lockMinutes = Number(login.lockMinutes ?? 15);
  const codeTtlSeconds = Number(mfa.codeTtlSeconds ?? 300);
  const captchaEnabled = captcha.enabled !== undefined ? !!captcha.enabled : true;
  const captchaTtlSeconds = Number(captcha.ttlSeconds ?? 300);
  const adminMfaMethods = Array.isArray(security.adminMfaMethods)
    ? security.adminMfaMethods
    : [];
  return {
    login: {
      maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 5,
      windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : 15,
      lockMinutes: Number.isFinite(lockMinutes) ? lockMinutes : 15,
    },
    mfa: {
      codeTtlSeconds: Number.isFinite(codeTtlSeconds) ? codeTtlSeconds : 300,
      adminMfaMethods: adminMfaMethods.filter(Boolean),
    },
    captcha: {
      enabled: captchaEnabled,
      ttlSeconds: Number.isFinite(captchaTtlSeconds) ? captchaTtlSeconds : 300,
    },
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

const logOperation = async ({ user, action, entity, entityId, beforeData, afterData }) => {
  try {
    await db.run(
      'INSERT INTO operation_logs (user_id, username, action, entity, entity_id, before_data, after_data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        user?.id || 0,
        user?.username || 'system',
        action,
        entity,
        entityId,
        beforeData ? JSON.stringify(beforeData) : null,
        afterData ? JSON.stringify(afterData) : null,
      ]
    );
  } catch (err) {
    // ignore logging failures
  }
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
  const raw = value === null || value === undefined ? '' : String(value);
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

const buildSendContent = ({ subject, message, contact, license, configs }) => {
  const reminderConfig = (configs && configs.reminder) || {};
  const context = buildContext({ contact, license, subject, message });
  const finalSubject = subject || replaceTokens(reminderConfig.subject, context) || '授权到期提醒';
  const finalMessage =
    message || replaceTokens(reminderConfig.message, context) || '授权即将到期，请及时续约。';
  return { finalSubject, finalMessage };
};

// Customers
app.get('/api/customers', async (req, res) => {
  const { search } = req.query;
  const rows = search
    ? await db.query('SELECT * FROM customers WHERE name LIKE ? ORDER BY id DESC', [`%${search}%`])
    : await db.query('SELECT * FROM customers ORDER BY id DESC');
  res.json(rows);
});

app.post('/api/customers', requireRole(['admin', 'sales']), async (req, res) => {
  const { name, juxin_sales, channel_sales } = req.body;
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

app.put('/api/customers/:id', requireRole(['admin', 'sales']), async (req, res) => {
  const { id } = req.params;
  const { name, juxin_sales, channel_sales } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '客户名称不能为空' });
  }
  try {
    const before = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
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
  const hasContacts = await db.get('SELECT COUNT(1) AS count FROM contacts WHERE customer_id = ?', [id]);
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
app.get('/api/contacts', async (req, res) => {
  const { search, customer_id, is_active } = req.query;
  const where = [];
  const params = [];
  if (customer_id) {
    where.push('contacts.customer_id = ?');
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
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT contacts.*, customers.name AS customer_name
     FROM contacts
     JOIN customers ON customers.id = contacts.customer_id
     ${whereSql}
     ORDER BY contacts.id DESC`,
    params
  );
  res.json(rows);
});

app.post('/api/contacts', requireRole(['admin', 'sales']), async (req, res) => {
  const { customer_id, name, phone, email, wecom_id, is_active } = req.body;
  if (!customer_id) {
    return res.status(400).json({ error: '请选择客户名称' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '联系人不能为空' });
  }
  const info = await db.run(
    'INSERT INTO contacts (customer_id, name, phone, email, wecom_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
    [
      customer_id,
      name.trim(),
      phone || '',
      email || '',
      wecom_id || '',
      is_active === 0 ? 0 : 1,
    ]
  );
  const row = await db.get(
    `SELECT contacts.*, customers.name AS customer_name
     FROM contacts
     JOIN customers ON customers.id = contacts.customer_id
     WHERE contacts.id = ?`,
    [info.insertId]
  );
  await logOperation({
    user: req.user,
    action: 'CREATE',
    entity: 'contact',
    entityId: row.id,
    afterData: row,
  });
  res.json(toJson(row));
});

app.put('/api/contacts/:id', requireRole(['admin', 'sales']), async (req, res) => {
  const { id } = req.params;
  const { customer_id, name, phone, email, wecom_id, is_active } = req.body;
  if (!customer_id) {
    return res.status(400).json({ error: '请选择客户名称' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '联系人不能为空' });
  }
  const before = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
  await db.run(
    'UPDATE contacts SET customer_id = ?, name = ?, phone = ?, email = ?, wecom_id = ?, is_active = ? WHERE id = ?',
    [customer_id, name.trim(), phone || '', email || '', wecom_id || '', is_active === 0 ? 0 : 1, id]
  );
  const row = await db.get(
    `SELECT contacts.*, customers.name AS customer_name
     FROM contacts
     JOIN customers ON customers.id = contacts.customer_id
     WHERE contacts.id = ?`,
    [id]
  );
  await logOperation({
    user: req.user,
    action: 'UPDATE',
    entity: 'contact',
    entityId: Number(id),
    beforeData: before,
    afterData: row,
  });
  res.json(toJson(row));
});

app.delete('/api/contacts/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const before = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
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
app.get('/api/licenses', async (req, res) => {
  const { search, customer_id, status, quick, days } = req.query;
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
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT licenses.*, customers.name AS customer_name
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     ${whereSql}
     ORDER BY licenses.id DESC`,
    params
  );
  res.json(rows);
});

app.get('/api/licenses/expiring', async (req, res) => {
  const days = Number(req.query.days || 30);
  const rows = await db.query(
    `SELECT licenses.*, customers.name AS customer_name,
      DATEDIFF(licenses.end_date, CURDATE()) AS days_left
     FROM licenses
     JOIN customers ON customers.id = licenses.customer_id
     WHERE licenses.end_date >= CURDATE()
     AND licenses.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ORDER BY licenses.end_date ASC`,
    [days]
  );
  res.json(rows);
});

app.post('/api/licenses', requireRole(['admin', 'sales']), async (req, res) => {
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

app.put('/api/licenses/:id', requireRole(['admin', 'sales']), async (req, res) => {
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

app.delete('/api/licenses/:id', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const before = await db.get('SELECT * FROM licenses WHERE id = ?', [id]);
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
app.get('/api/customers/autocomplete', async (req, res) => {
  const { q } = req.query;
  const rows = await db.query(
    'SELECT id, name FROM customers WHERE name LIKE ? ORDER BY name ASC LIMIT 20',
    [`%${q || ''}%`]
  );
  res.json(rows);
});

// Send configs
app.get('/api/send-configs', async (req, res) => {
  const rows = await db.query('SELECT `key`, value FROM send_configs');
  const result = rows.reduce((acc, row) => {
    acc[row.key] = JSON.parse(row.value);
    return acc;
  }, {});
  res.json(maskSecrets(result));
});

app.post('/api/send-configs', requireRole(['admin']), async (req, res) => {
  const configs = req.body || {};
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
    (configs.wecom && configs.wecom.secret && configs.wecom.secret !== SECRET_MASK);
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

const sendToContacts = async ({ contacts, channels, subject, message, license, isTest = false }) => {
  const configs = await getConfigs();
  const retryConfig = getRetryConfig(configs);
  const results = [];
  for (const contact of contacts) {
    const { finalSubject, finalMessage } = buildSendContent({
      subject,
      message,
      contact,
      license,
      configs,
    });
    const channelResults = [];
    for (const channel of channels) {
      try {
        let attempt = 0;
        let lastError = null;
        let lastCode = null;
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
              if (configs.wecom?.webhook) {
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
      subject: finalSubject,
      message: finalMessage,
      error: hasFailure ? channelResults.map((c) => `${c.channel}:${c.error || ''}`).join('; ') : null,
    });
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

// Send
app.post('/api/send', requireRole(['admin', 'sales']), async (req, res) => {
  const { contactIds, channels, subject, message, licenseId } = req.body;
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ error: '请选择联系人' });
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: '请选择发送渠道' });
  }
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
app.get('/api/send-plans', requireRole(['admin', 'sales']), async (req, res) => {
  const rows = await db.query(
    `SELECT send_plans.*, licenses.name AS license_name, customers.name AS customer_name
     FROM send_plans
     JOIN licenses ON licenses.id = send_plans.license_id
     JOIN customers ON customers.id = licenses.customer_id
     ORDER BY send_plans.id DESC`
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

app.post('/api/send-plans', requireRole(['admin', 'sales']), async (req, res) => {
  const { name, license_id, contact_ids, channels, days, enabled, start_date, end_date } = req.body || {};
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
  const info = await db.run(
    'INSERT INTO send_plans (name, license_id, contact_ids, channels, days, enabled, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      name.trim(),
      license_id,
      JSON.stringify(contact_ids),
      JSON.stringify(channels),
      days,
      enabled === 0 ? 0 : 1,
      start_date || null,
      end_date || null,
    ]
  );
  const row = await db.get(
    `SELECT send_plans.*, licenses.name AS license_name, customers.name AS customer_name
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

app.put('/api/send-plans/:id', requireRole(['admin', 'sales']), async (req, res) => {
  const { id } = req.params;
  const { name, license_id, contact_ids, channels, days, enabled, start_date, end_date } = req.body || {};
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
  await db.run(
    'UPDATE send_plans SET name = ?, license_id = ?, contact_ids = ?, channels = ?, days = ?, enabled = ?, start_date = ?, end_date = ? WHERE id = ?',
    [
      name.trim(),
      license_id,
      JSON.stringify(contact_ids),
      JSON.stringify(channels),
      days,
      enabled === 0 ? 0 : 1,
      start_date || null,
      end_date || null,
      id,
    ]
  );
  const row = await db.get(
    `SELECT send_plans.*, licenses.name AS license_name, customers.name AS customer_name
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

app.delete('/api/send-plans/:id', requireRole(['admin', 'sales']), async (req, res) => {
  const { id } = req.params;
  const before = await db.get('SELECT * FROM send_plans WHERE id = ?', [id]);
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

app.get('/api/send-logs', async (req, res) => {
  const rows = await db.query(
    `SELECT send_logs.*, contacts.name AS contact_name, customers.name AS customer_name,
      licenses.name AS license_name
     FROM send_logs
     JOIN contacts ON contacts.id = send_logs.contact_id
     JOIN customers ON customers.id = contacts.customer_id
     LEFT JOIN licenses ON licenses.id = send_logs.license_id
     ORDER BY send_logs.id DESC LIMIT 200`
  );
  res.json(rows);
});

app.get('/api/operation-logs', requireRole(['admin']), async (req, res) => {
  const { username, action, entity, date_from, date_to, limit } = req.query || {};
  const where = [];
  const params = [];
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
    `SELECT *
     FROM operation_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ?`,
    [...params, take]
  );
  res.json(rows);
});

app.get('/api/operation-logs/export', requireRole(['admin']), async (req, res) => {
  const { username, action, entity, date_from, date_to } = req.query || {};
  const where = [];
  const params = [];
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
    `SELECT id, username, action, entity, entity_id, before_data, after_data, created_at
     FROM operation_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT 5000`,
    params
  );

  const csv = toCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'username', label: '用户' },
    { key: 'action', label: '动作' },
    { key: 'entity', label: '对象' },
    { key: 'entity_id', label: '对象ID' },
    { key: 'before_data', label: '变更前' },
    { key: 'after_data', label: '变更后' },
    { key: 'created_at', label: '时间' },
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=\"operation_logs.csv\"`);
  res.send(csv);
});

app.get('/api/import-jobs', requireRole(['admin', 'sales']), async (req, res) => {
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

app.get('/api/import-jobs/:id', requireRole(['admin', 'sales']), async (req, res) => {
  const { id } = req.params;
  const row = await db.get('SELECT * FROM import_jobs WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '记录不存在' });
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

app.post('/api/users/:id/reset-password', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  if (!newPassword) {
    return res.status(400).json({ error: '请输入新密码' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  await logOperation({
    user: req.user,
    action: 'RESET_PASSWORD',
    entity: 'user',
    entityId: Number(id),
  });
  res.json({ ok: true });
});

// Import (CSV)
app.post('/api/import/customers', requireRole(['admin', 'sales']), upload.single('file'), async (req, res) => {
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

app.post('/api/import/contacts', requireRole(['admin', 'sales']), upload.single('file'), async (req, res) => {
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

app.get('/api/dashboard', requireRole(['admin', 'sales']), async (req, res) => {
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

app.get('/api/reminder-logs', requireRole(['admin', 'sales']), async (req, res) => {
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
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT reminder_logs.*, contacts.name AS contact_name, customers.name AS customer_name,
      licenses.name AS license_name
     FROM reminder_logs
     LEFT JOIN contacts ON contacts.id = reminder_logs.contact_id
     LEFT JOIN customers ON customers.id = contacts.customer_id
     LEFT JOIN licenses ON licenses.id = reminder_logs.license_id
     ${whereSql}
     ORDER BY reminder_logs.id DESC LIMIT 300`,
    params
  );
  res.json(rows);
});

app.post('/api/reminder-logs/:id/resend', requireRole(['admin', 'sales']), async (req, res) => {
  const { id } = req.params;
  const log = await db.get(
    `SELECT reminder_logs.*, contacts.*, customers.name AS customer_name,
      licenses.name AS license_name, licenses.end_date AS end_date
     FROM reminder_logs
     JOIN contacts ON contacts.id = reminder_logs.contact_id
     JOIN customers ON customers.id = contacts.customer_id
     JOIN licenses ON licenses.id = reminder_logs.license_id
     WHERE reminder_logs.id = ?`,
    [id]
  );
  if (!log) {
    return res.status(404).json({ error: '记录不存在' });
  }
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
  return next(err);
});

const start = async () => {
  await db.ready;
  await ensureAdminUser();
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    startReminderCron();
  });
};

start().catch((err) => {
  console.error('Server start failed', err);
  process.exit(1);
});
